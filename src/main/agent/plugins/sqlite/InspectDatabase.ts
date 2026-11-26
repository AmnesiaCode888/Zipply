import * as fs from 'fs/promises'
import * as path from 'path'
import { Blackboard } from '../../core/Blackboard'
import { ToolBase, type ToolExecutionPolicy, type ToolParameterDef, type ToolResult } from '../../tools/ToolBase'
import { inspectWorkspacePath } from '../../tools/pathUtils'

const MAX_DATABASE_BYTES = 32 * 1024 * 1024
const MAX_SQL_CHARS = 10_000
const MAX_COLUMNS = 100
const MAX_METADATA_ITEMS = 1_000
const MAX_CELL_CHARS = 8_000
const MAX_OUTPUT_CHARS = 256_000
const MAX_ROWS = 200
const DEFAULT_ROWS = 50

type SqlValue = string | number | null | Uint8Array | bigint

interface SqlStatement {
  bind(values?: unknown[] | Record<string, unknown>): boolean
  getColumnNames(): string[]
  step(): boolean
  get(): SqlValue[]
  free(): void
}

interface SqlDatabase {
  prepare(sql: string, values?: unknown[] | Record<string, unknown>): SqlStatement
  close(): void
}

interface SqlEngine {
  Database: new (data?: Uint8Array) => SqlDatabase
}

type InitSqlJs = () => Promise<SqlEngine>
const initSqlJs = require('sql.js/dist/sql-wasm-inline.js') as InitSqlJs
let sqlEnginePromise: Promise<SqlEngine> | undefined

function getSqlEngine(): Promise<SqlEngine> {
  sqlEnginePromise ||= initSqlJs()
  return sqlEnginePromise
}

interface SqliteArguments extends Record<string, unknown> {
  path: string
  operation: 'tables' | 'describe' | 'query'
  table?: string
  sql?: string
  maxRows?: number
}

function parseArguments(argumentsJson: string): SqliteArguments | string {
  let args: unknown
  try { args = JSON.parse(argumentsJson) } catch { return 'Аргументы должны быть корректным JSON.' }
  if (!args || typeof args !== 'object' || Array.isArray(args)) return 'Аргументы должны быть JSON-объектом.'
  const value = args as Record<string, unknown>
  if (typeof value.path !== 'string' || !value.path.trim()) return 'Укажи путь к файлу базы данных.'
  if (!['tables', 'describe', 'query'].includes(String(value.operation))) return 'Операция должна быть tables, describe или query.'
  if (value.operation === 'describe' && (typeof value.table !== 'string' || !value.table.trim())) return 'Для операции describe укажи имя таблицы.'
  if (value.operation === 'query' && (typeof value.sql !== 'string' || !value.sql.trim())) return 'Для операции query укажи SELECT-запрос.'
  if (value.maxRows !== undefined && (!Number.isInteger(value.maxRows) || (value.maxRows as number) < 1)) return `maxRows должен быть положительным целым числом.`
  if (typeof value.maxRows === 'number' && value.maxRows > MAX_ROWS) value.maxRows = MAX_ROWS
  return value as SqliteArguments
}

/** Strip comments while respecting quoted strings and reject all but one statement. */
function normalizeSelect(sql: string): string | null {
  if (sql.length > MAX_SQL_CHARS) return null
  let output = ''
  let index = 0
  let ended = false
  while (index < sql.length) {
    const char = sql[index]
    const next = sql[index + 1]

    if (char === '-' && next === '-') {
      index += 2
      while (index < sql.length && sql[index] !== '\n' && sql[index] !== '\r') index++
      if (!ended) output += ' '
      continue
    }
    if (char === '/' && next === '*') {
      const close = sql.indexOf('*/', index + 2)
      if (close < 0) return null
      index = close + 2
      if (!ended) output += ' '
      continue
    }
    if (char === ';') {
      if (ended) return null
      ended = true
      index++
      continue
    }
    if (ended) {
      if (!/\s/.test(char)) return null
      index++
      continue
    }
    if (/['"`\[]/.test(char)) {
      const closeChar = char === '[' ? ']' : char
      output += char
      index++
      let closed = false
      while (index < sql.length) {
        const quoted = sql[index]
        output += quoted
        index++
        if (quoted === closeChar) {
          if (sql[index] === closeChar && closeChar !== ']') {
            output += sql[index]
            index++
          } else {
            closed = true
            break
          }
        }
      }
      if (!closed) return null
      continue
    }
    output += char
    index++
  }
  const normalized = output.trim()
  if (!/^SELECT\b/i.test(normalized)) return null
  if (/\b(?:randomblob|zeroblob|readfile|writefile|load_extension)\s*\(/i.test(normalized)) return null
  return normalized
}

function uniqueColumnNames(names: string[]): string[] {
  const used = new Map<string, number>()
  return names.map((rawName, index) => {
    const base = rawName || `column_${index + 1}`
    const count = (used.get(base) || 0) + 1
    used.set(base, count)
    return count === 1 ? base : `${base}_${count}`
  })
}

function renderCell(value: SqlValue): { value: unknown; clipped: boolean } {
  if (value instanceof Uint8Array) {
    return { value: { type: 'blob', bytes: value.byteLength, previewHex: Buffer.from(value.subarray(0, 32)).toString('hex') }, clipped: false }
  }
  if (typeof value === 'string' && value.length > MAX_CELL_CHARS) return { value: `${value.slice(0, MAX_CELL_CHARS)}…`, clipped: true }
  if (typeof value === 'bigint') return { value: value.toString(), clipped: false }
  return { value, clipped: false }
}

async function sidecarHasPendingWal(databasePath: string): Promise<boolean> {
  try { return (await fs.stat(`${databasePath}-wal`)).size > 0 }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false
    throw error
  }
}

export class SqliteInspectDatabase extends ToolBase {
  get name(): string { return 'sqlite_inspect_database' }
  get description(): string { return 'Только для чтения исследует файл SQLite в выбранной рабочей папке: перечисляет таблицы и колонки или выполняет ограниченный SELECT. При запросе smoke-test, если тестовой базы нет и режим разрешает запись, создай небольшую тестовую базу обычными инструментами, затем проверь её этим инспектором; не уточняй схему примера. В режиме «Только чтение» объясни блокировку. Существующие базы не изменяй.' }
  get parameters(): Record<string, ToolParameterDef> {
    return {
      path: { type: 'string', description: 'Путь к файлу .db, .sqlite или .sqlite3 внутри рабочей папки.', required: true, maxLength: 4096 },
      operation: { type: 'string', description: 'Что сделать с базой данных.', required: true, enum: ['tables', 'describe', 'query'] },
      table: { type: 'string', description: 'Имя таблицы или представления для describe.' },
      sql: { type: 'string', description: 'Один read-only SELECT-запрос; другие SQL-команды запрещены.', maxLength: MAX_SQL_CHARS },
      maxRows: { type: 'number', description: `Максимум строк результата, до ${MAX_ROWS}; по умолчанию ${DEFAULT_ROWS}.`, minimum: 1, maximum: MAX_ROWS }
    }
  }
  getExecutionPolicy(): ToolExecutionPolicy { return { mutates: false, parallelSafe: false, cacheable: false } }

  validate(argumentsJson: string): string | null {
    const args = parseArguments(argumentsJson)
    return typeof args === 'string' ? args : null
  }

  async execute(argumentsJson: string, board: Blackboard, signal?: AbortSignal): Promise<ToolResult> {
    const parsed = parseArguments(argumentsJson)
    if (typeof parsed === 'string') return { error: true, formattedContent: parsed }
    const config = board.getArtifact('config') as { workspacePath?: string } | undefined
    if (!config?.workspacePath?.trim()) return { error: true, formattedContent: 'Для анализа SQLite выбери папку проекта.' }
    if (signal?.aborted) return { error: true, formattedContent: 'Анализ SQLite отменён.' }

    const ext = path.extname(parsed.path).toLowerCase()
    if (!['.db', '.sqlite', '.sqlite3'].includes(ext)) return { error: true, formattedContent: 'Поддерживаются только файлы .db, .sqlite и .sqlite3.' }

    let database: SqlDatabase | undefined
    let statement: SqlStatement | undefined
    try {
      const { actualPath, external } = await inspectWorkspacePath(board, parsed.path)
      if (external) return { error: true, formattedContent: 'Базу SQLite можно открывать только внутри выбранной рабочей папки.' }
      const stat = await fs.stat(actualPath)
      if (!stat.isFile()) return { error: true, formattedContent: 'Указанный путь не является файлом.' }
      if (stat.size <= 0 || stat.size > MAX_DATABASE_BYTES) return { error: true, formattedContent: 'Размер базы должен быть от 1 байта до 32 МБ.' }
      if (await sidecarHasPendingWal(actualPath)) return { error: true, formattedContent: 'Рядом с базой есть непустой WAL-файл. Сначала закрой подключённое приложение или сделай checkpoint базы.' }
      if (signal?.aborted) return { error: true, formattedContent: 'Анализ SQLite отменён.' }

      const bytes = await fs.readFile(actualPath)
      if (bytes.byteLength > MAX_DATABASE_BYTES) return { error: true, formattedContent: 'Размер базы превышает 32 МБ.' }
      if (await sidecarHasPendingWal(actualPath)) return { error: true, formattedContent: 'Во время чтения базы появился непустой WAL-файл. Повтори анализ после закрытия базы или checkpoint.' }
      const SQL = await getSqlEngine()
      if (signal?.aborted) return { error: true, formattedContent: 'Анализ SQLite отменён.' }
      database = new SQL.Database(new Uint8Array(bytes))

      let data: Record<string, unknown>
      if (parsed.operation === 'tables') {
        statement = database.prepare(`SELECT name, type FROM sqlite_master WHERE type IN ('table', 'view') AND name NOT GLOB 'sqlite_*' ORDER BY type, name LIMIT ${MAX_METADATA_ITEMS + 1}`)
        const tables: Array<{ name: string; type: string }> = []
        let truncated = false
        while (statement.step()) {
          if (tables.length >= MAX_METADATA_ITEMS) { truncated = true; break }
          const [name, type] = statement.get()
          tables.push({ name: String(name), type: String(type) })
        }
        data = { operation: 'tables', tables, truncated }
      } else if (parsed.operation === 'describe') {
        const tableName = parsed.table!.trim()
        const exists = database.prepare("SELECT 1 FROM sqlite_master WHERE name = ? AND type IN ('table', 'view') LIMIT 1")
        let found = false
        try { exists.bind([tableName]); found = exists.step() }
        finally { exists.free() }
        if (!found) return { error: true, formattedContent: `Таблица или представление «${tableName}» не найдено.` }
        statement = database.prepare(`PRAGMA table_info("${tableName.replace(/"/g, '""')}")`)
        const columns: Array<Record<string, unknown>> = []
        let truncated = false
        while (statement.step()) {
          if (columns.length >= MAX_METADATA_ITEMS) { truncated = true; break }
          const [cid, name, type, notnull, defaultValue, primaryKey] = statement.get()
          columns.push({ cid, name, type, notNull: Boolean(notnull), defaultValue, primaryKey: Boolean(primaryKey) })
        }
        data = { operation: 'describe', table: tableName, columns, truncated }
      } else {
        const select = normalizeSelect(parsed.sql!)
        if (!select) return { error: true, formattedContent: 'Разрешён один SELECT-запрос без дополнительных команд или функций генерации больших данных.' }
        const limit = parsed.maxRows || DEFAULT_ROWS
        statement = database.prepare(`SELECT * FROM (${select}) AS zipply_result LIMIT ${limit + 1}`)
        const rawColumns = statement.getColumnNames()
        if (rawColumns.length > MAX_COLUMNS) return { error: true, formattedContent: `В результате слишком много колонок: максимум ${MAX_COLUMNS}.` }
        const columns = uniqueColumnNames(rawColumns)
        const rows: Array<Record<string, unknown>> = []
        let truncated = false
        let outputChars = 0
        while (statement.step()) {
          if (signal?.aborted) return { error: true, formattedContent: 'Анализ SQLite отменён.' }
          if (rows.length >= limit) { truncated = true; break }
          const values = statement.get()
          let clippedCell = false
          const row = Object.create(null) as Record<string, unknown>
          columns.forEach((column, index) => {
            const cell = renderCell(values[index])
            row[column] = cell.value
            clippedCell ||= cell.clipped
          })
          const rowChars = JSON.stringify(row).length
          if (outputChars + rowChars > MAX_OUTPUT_CHARS) { truncated = true; break }
          outputChars += rowChars
          rows.push(row)
          truncated ||= clippedCell
        }
        data = { operation: 'query', columns, rows, rowCount: rows.length, truncated }
      }

      const body = JSON.stringify(data, null, 2)
      return { success: true, data, formattedContent: body, displayContent: `SQLite: ${parsed.operation === 'tables' ? `${(data.tables as unknown[]).length} таблиц и представлений` : parsed.operation === 'describe' ? `${(data.columns as unknown[]).length} колонок в «${parsed.table}»` : `${(data.rows as unknown[]).length} строк`}.` }
    } catch (error) {
      return { error: true, formattedContent: `Не удалось прочитать базу SQLite: ${error instanceof Error ? error.message : String(error)}` }
    } finally {
      statement?.free()
      database?.close()
    }
  }
}
