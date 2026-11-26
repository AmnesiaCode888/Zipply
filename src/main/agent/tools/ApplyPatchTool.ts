import * as fs from 'fs/promises'
import * as path from 'path'
import { createHash, randomUUID } from 'crypto'
import * as Diff from 'diff'
import { Blackboard } from '../core/Blackboard'
import {
  inspectWorkspacePath,
  resolveWorkspacePath,
  assertFileNotStale,
  recordReadFileState
} from './pathUtils'
import { findUniqueEditRange, type MatchRange } from './EditFileTool'
import { ToolBase, ToolExecutionPolicy, ToolParameterDef, ToolResult } from './ToolBase'

type Operation = {
  path: string
  action: 'create' | 'update' | 'delete'
  content?: string
  sha256?: string
  edits?: Array<{ target: string; replacement: string }>
  hunks?: PatchHunk[]
}
type PatchHunk = { anchor?: string; targetLines: string[]; replacementLines: string[] }
type Prepared = {
  operation: Operation
  actual: string
  display: string
  before: Buffer | null
  after: Buffer | null
  mode?: number
  diff: string
  temporary?: string
}

const hash = (bytes: Buffer): string => createHash('sha256').update(bytes).digest('hex')
const message = (error: unknown): string => error instanceof Error ? error.message : String(error)
const isMissing = (error: unknown): boolean => (error as NodeJS.ErrnoException).code === 'ENOENT'

export function parseCodexPatch(patchText: string): Operation[] {
  const lines = patchText.replace(/\r\n/g, '\n').split('\n')
  const beginIdx = lines.findIndex((line) => line.trim() === '*** Begin Patch')
  const endIdx = lines.findIndex((line, i) => i > beginIdx && line.trim() === '*** End Patch')
  if (beginIdx < 0 || endIdx < 0 || endIdx <= beginIdx) {
    throw new Error('Некорректный формат patch: требуются маркеры "*** Begin Patch" и "*** End Patch".')
  }

  const ops: Operation[] = []
  let i = beginIdx + 1
  while (i < endIdx) {
    const line = lines[i]
    if (!line.trim()) { i++; continue }

    if (line.startsWith('*** Add File: ')) {
      const filePath = line.slice('*** Add File: '.length).trim()
      if (!filePath) throw new Error('Пустой путь в *** Add File.')
      i++
      const body: string[] = []
      while (i < endIdx && !lines[i].startsWith('*** ')) {
        const cur = lines[i]
        if (cur.startsWith('+')) body.push(cur.slice(1))
        else if (cur === '\\ No newline at end of file') { /* ignore */ }
        else body.push(cur)
        i++
      }
      const noTrailing = i > 0 && lines[i - 1] === '\\ No newline at end of file'
      const content = body.length ? body.join('\n') + (noTrailing ? '' : '\n') : ''
      ops.push({ path: filePath, action: 'create', content })
      continue
    }

    if (line.startsWith('*** Delete File: ')) {
      const filePath = line.slice('*** Delete File: '.length).trim()
      if (!filePath) throw new Error('Пустой путь в *** Delete File.')
      ops.push({ path: filePath, action: 'delete' })
      i++
      continue
    }

    if (line.startsWith('*** Update File: ')) {
      const filePath = line.slice('*** Update File: '.length).trim()
      if (!filePath) throw new Error('Пустой путь в *** Update File.')
      i++
      let moveTo: string | undefined
      if (i < endIdx && lines[i].startsWith('*** Move to: ')) {
        moveTo = lines[i].slice('*** Move to: '.length).trim()
        i++
      }
      const hunks: PatchHunk[] = []
      while (i < endIdx && !lines[i].startsWith('*** ')) {
        let header = ''
        if (lines[i].startsWith('@@')) {
          header = lines[i].slice(2).trim()
          i++
        }
        const targetLines: string[] = []
        const replacementLines: string[] = []
        while (i < endIdx && !lines[i].startsWith('*** ') && !lines[i].startsWith('@@')) {
          const cur = lines[i]
          if (cur === '\\ No newline at end of file') { i++; continue }
          if (cur.startsWith('-')) targetLines.push(cur.slice(1))
          else if (cur.startsWith('+')) replacementLines.push(cur.slice(1))
          else if (cur.startsWith(' ')) {
            const text = cur.slice(1)
            targetLines.push(text)
            replacementLines.push(text)
          } else {
            targetLines.push(cur)
            replacementLines.push(cur)
          }
          i++
        }
        if (targetLines.length || replacementLines.length) {
          if (!targetLines.length && !header) throw new Error(`Вставка в ${filePath} требует контекста или якоря после @@.`)
          hunks.push({ anchor: header || undefined, targetLines, replacementLines })
        }
      }
      if (!hunks.length && !moveTo) {
        throw new Error(`Нет изменений в *** Update File: ${filePath}`)
      }
      if (hunks.length) {
        ops.push({ path: filePath, action: 'update', hunks })
      }
      if (moveTo && moveTo !== filePath) {
        // Handled cleanly as update + delete if caller moves; keep simple if moveTo matches
        throw new Error('*** Move to не поддерживается в одном шаге с патчем; используй create и delete.')
      }
      continue
    }

    throw new Error(`Неожиданная строка в patch: ${line}`)
  }

  if (ops.length < 1 || ops.length > 20) {
    throw new Error('Пакет patch должен содержать от 1 до 20 операций.')
  }
  return ops
}

function orderedPatchRanges(source: string, hunks: readonly PatchHunk[], filePath: string): MatchRange[] {
  const lines = source.split('\n')
  let offset = 0
  const offsets = lines.map((line) => {
    const start = offset
    offset += line.length + 1
    return start
  })
  let cursor = 0
  return hunks.map(({ anchor, targetLines, replacementLines }) => {
    if (anchor) {
      let anchorLine = lines.findIndex((line, index) => index >= cursor && line.trim() === anchor)
      if (anchorLine < 0) anchorLine = lines.findIndex((line, index) => index >= cursor && line.includes(anchor))
      if (anchorLine < 0) throw new Error(`Якорь "@@ ${anchor}" не найден после предыдущей правки в ${filePath}.`)
      cursor = anchorLine + 1
    }

    const replacement = replacementLines.join('\n')
    if (!targetLines.length) {
      const start = offsets[cursor] ?? source.length
      return { start, end: start, replacement: cursor < lines.length ? `${replacement}\n` : `\n${replacement}` }
    }

    let startLine = -1
    for (const normalize of [(line: string) => line, (line: string) => line.trimEnd(), (line: string) => line.trim()]) {
      const target = targetLines.map(normalize)
      for (let index = cursor; index <= lines.length - target.length; index++) {
        if (!target.every((line, relativeIndex) => normalize(lines[index + relativeIndex]) === line)) continue
        if (startLine >= 0) throw new Error(`Фрагмент в ${filePath} повторяется. Добавьте якорь после @@ или контекстные строки.`)
        startLine = index
        if (anchor) break
      }
      if (startLine >= 0) break
    }
    if (startLine < 0) throw new Error(`Фрагмент не найден после якоря или предыдущей правки в ${filePath}.`)

    cursor = startLine + targetLines.length
    const start = offsets[startLine]
    const end = offsets[cursor - 1] + lines[cursor - 1].length
    const matched = source.slice(start, end)
    const target = targetLines.join('\n')
    // Reuse the same indentation adjustment as JSON edits for a whitespace-tolerant match.
    const adjusted = target && matched !== target ? findUniqueEditRange(matched, target, replacement, filePath).range : undefined
    return adjusted
      ? { start: start + adjusted.start, end: start + adjusted.end, replacement: adjusted.replacement }
      : { start, end, replacement }
  })
}

export class ApplyPatchTool extends ToolBase {
  get name(): string { return 'apply_patch' }
  get description(): string {
    return 'Атомарно применяет пакет из 1–20 изменений к файлам проекта. Предпочитай компактный текстовый формат patch ("*** Begin Patch\\n*** Update File: ...\\n@@\\n-старое\\n+новое\\n*** Add File: ...\\n*** Delete File: ...\\n*** End Patch") или передай массив operations. Лимит — 1 МБ.'
  }
  get parameters(): Record<string, ToolParameterDef> {
    return {
      patch: {
        type: 'string',
        description: 'Текстовый патч в формате Codex (*** Begin Patch ... *** End Patch). Якорь @@ строка указывает, после какой строки искать правку. Указывайте правки в порядке строк. Не используй одновременно с operations.'
      },
      operations: {
        type: 'array',
        description: 'Альтернативный JSON-пакет операций create, update или delete (1–20 файлов).',
        minItems: 1,
        maxItems: 20,
        items: {
          type: 'object',
          properties: {
            path: { type: 'string', description: 'Путь внутри проекта.', minLength: 1 },
            action: { type: 'string', description: 'create требует content; update требует edits; delete удаляет файл.', enum: ['create', 'update', 'delete'] },
            content: { type: 'string', description: 'Полное содержимое для create.' },
            sha256: { type: 'string', description: 'Необязательный SHA-256 текущего файла для проверки перед delete.', minLength: 64, maxLength: 64 },
            edits: {
              type: 'array',
              description: 'От 1 до 50 замен для update.',
              minItems: 1,
              maxItems: 50,
              items: {
                type: 'object',
                properties: {
                  target: { type: 'string', description: 'Уникальный текущий фрагмент.', minLength: 1 },
                  replacement: { type: 'string', description: 'Новый фрагмент.' }
                },
                required: ['target', 'replacement']
              }
            }
          },
          required: ['path', 'action']
        }
      }
    }
  }

  getExecutionPolicy(): ToolExecutionPolicy { return { mutates: true, parallelSafe: false, cacheable: false } }

  validate(raw: string): string | null {
    try {
      if (Buffer.byteLength(raw) > 1024 * 1024) return 'Ошибка: пакет превышает 1 МБ.'
      const data = JSON.parse(raw)
      if (typeof data.patch === 'string' && data.operations === undefined) {
        if (!data.patch.trim()) return 'Ошибка: patch не может быть пустым.'
        try {
          parseCodexPatch(data.patch)
          return null
        } catch (err) {
          return `Ошибка: ${message(err)}`
        }
      }
      if (data.patch !== undefined && data.operations !== undefined) {
        return 'Ошибка: используй либо patch, либо operations, но не оба сразу.'
      }
      if (!Array.isArray(data.operations) || data.operations.length < 1 || data.operations.length > 20) {
        return 'Ошибка: требуется от 1 до 20 файлов.'
      }
      for (const op of data.operations) {
        if (!op || typeof op.path !== 'string' || !op.path.trim() || !['create', 'update', 'delete'].includes(op.action)) return 'Ошибка: некорректный путь или действие.'
        if (op.action === 'create' && typeof op.content !== 'string') return 'Ошибка: create требует content.'
        if (op.action === 'delete' && op.sha256 !== undefined && (typeof op.sha256 !== 'string' || !/^[a-f0-9]{64}$/i.test(op.sha256))) {
          return 'Ошибка: sha256 для delete должен быть 64-символьной hex-строкой.'
        }
        if (op.action === 'update' && (!Array.isArray(op.edits) || !op.edits.length || op.edits.length > 50 || op.edits.some((e: { target?: unknown; replacement?: unknown }) => !e || typeof e.target !== 'string' || !e.target.trim() || typeof e.replacement !== 'string'))) {
          return 'Ошибка: update требует от 1 до 50 точных замен.'
        }
      }
      return null
    } catch { return 'Ошибка: некорректный JSON пакета.' }
  }

  async execute(raw: string, board: Blackboard, signal?: AbortSignal): Promise<ToolResult> {
    const invalid = this.validate(raw)
    if (invalid) return { error: true, formattedContent: invalid }
    const config = board.getArtifact('config') as { accessMode?: string; workspacePath?: string; confirmAction?: (action: { kind: 'file'; command: string; target: string; cwd: string; details: string }) => Promise<boolean> } | undefined
    if (board.getArtifact('planMode') || config?.accessMode === 'read-only') {
      return { error: true, formattedContent: 'Ошибка: пакет недоступен в режиме только для чтения.' }
    }

    const parsed = JSON.parse(raw) as { patch?: string; operations?: Operation[] }
    const operations = typeof parsed.patch === 'string'
      ? parseCodexPatch(parsed.patch)
      : (parsed.operations || [])

    const prepared: Prepared[] = []
    const seen = new Set<string>()
    const root = resolveWorkspacePath(board, '.').absPath
    const cancelled = (): void => { if (signal?.aborted) throw new Error('Операция отменена.') }

    try {
      for (const operation of operations) {
        cancelled()
        const inspected = await inspectWorkspacePath(board, operation.path)
        if (inspected.external) throw new Error(`Путь вне рабочей папки: ${operation.path}`)
        const actual = inspected.actualPath
        const key = process.platform === 'win32' ? actual.toLowerCase() : actual
        if (seen.has(key)) throw new Error(`Повторный путь: ${operation.path}`)
        seen.add(key)

        let before: Buffer | null = null
        let mode: number | undefined
        try {
          const stat = await fs.stat(actual)
          if (!stat.isFile()) throw new Error('Цель не является файлом.')
          if (stat.size > 2 * 1024 * 1024) throw new Error('Файл превышает 2 МБ.')
          before = await fs.readFile(actual)
          mode = stat.mode
        } catch (error) {
          if (!isMissing(error)) throw error
        }

        if (operation.action === 'create' && before !== null) throw new Error(`Файл уже существует: ${operation.path}`)
        if (operation.action !== 'create' && before === null) throw new Error(`Файл не найден: ${operation.path}`)

        if (operation.action !== 'create' && !operation.sha256) {
          const staleErr = await assertFileNotStale(board, actual, operation.path)
          if (staleErr) throw new Error(staleErr.replace(/^Ошибка:\s*/i, ''))
        }

        let original = ''
        if (before) {
          if (before.includes(0)) throw new Error(`Бинарный файл: ${operation.path}`)
          try { original = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(before) }
          catch { throw new Error(`Файл не в UTF-8: ${operation.path}`) }
        }
        if (operation.action === 'delete' && operation.sha256 && before && hash(before) !== operation.sha256.toLowerCase()) {
          throw new Error(`Хэш файла изменился: ${operation.path}`)
        }

        let next = operation.action === 'create' ? operation.content! : original
        if (operation.action === 'update') {
          const source = original.replace(/\r\n/g, '\n')
          const offsets: number[] = []
          for (let i = 0; i < original.length; i++) {
            offsets.push(i)
            if (original[i] === '\r' && original[i + 1] === '\n') i++
          }
          offsets.push(original.length)

          const changes: Array<{ start: number; end: number; replacement: string }> = []
          const ranges = typeof parsed.patch === 'string'
            ? orderedPatchRanges(source, operation.hunks!, operation.path)
            : operation.edits!.map((edit) => {
              const target = edit.target.replace(/\r\n/g, '\n')
              const replacement = edit.replacement.replace(/\r\n/g, '\n')
              const found = findUniqueEditRange(source, target, replacement, operation.path)
              if (found.error || !found.range) {
                throw new Error(found.error ? found.error.replace(/^Ошибка:\s*/i, '') : `Фрагмент отсутствует или неоднозначен: ${operation.path}`)
              }
              return found.range
            })
          for (const range of ranges) {
            const rawStart = offsets[range.start]
            const rawEnd = offsets[range.end]
            if (changes.some((c) => rawStart < c.end && rawEnd > c.start)) {
              throw new Error(`Правки пересекаются: ${operation.path}`)
            }
            const lineEnding = (original.slice(rawStart, rawEnd).match(/\r?\n/) || original.slice(rawStart).match(/\r?\n/) || original.match(/\r?\n/))?.[0] || '\n'
            changes.push({
              start: rawStart,
              end: rawEnd,
              replacement: range.replacement.replace(/\n/g, lineEnding)
            })
          }
          next = original
          for (const change of changes.sort((a, b) => b.start - a.start || b.end - a.end)) {
            next = next.slice(0, change.start) + change.replacement + next.slice(change.end)
          }
        }

        const after = operation.action === 'delete' ? null : Buffer.from(next, 'utf8')
        const display = path.relative(root, actual).replace(/\\/g, '/')
        const diff = Diff.createPatch(display, original, after ? after.toString('utf8') : '').trim()
        prepared.push({ operation, actual, display, before, after, mode, diff })
      }

      const details = prepared.map((item) => `${item.operation.action}: ${item.display}\n${item.diff}`).join('\n\n')
      if (config?.accessMode === 'confirm') {
        if (!config.confirmAction || !await config.confirmAction({ kind: 'file', command: '', target: `${prepared.length} файлов`, cwd: root, details })) {
          throw new Error('Пакет отклонён пользователем или подтверждение недоступно.')
        }
      }

      cancelled()
      const verify = async (item: Prepared): Promise<void> => {
        const inspected = await inspectWorkspacePath(board, item.operation.path)
        if (inspected.external || inspected.actualPath !== item.actual) throw new Error(`Путь изменился: ${item.display}`)
        let current: Buffer | null = null
        try { current = await fs.readFile(item.actual) } catch (error) { if (!isMissing(error)) throw error }
        if (item.before === null ? current !== null : current === null || hash(current) !== hash(item.before)) {
          throw new Error(`Файл изменился после подготовки: ${item.display}`)
        }
      }

      for (const item of prepared) await verify(item)
      for (const item of prepared) {
        if (item.after) {
          item.temporary = path.join(path.dirname(item.actual), `.${path.basename(item.actual)}.${randomUUID()}.tmp`)
          await fs.mkdir(path.dirname(item.actual), { recursive: true })
          await fs.writeFile(item.temporary, item.after, { flag: 'wx', mode: item.mode })
        }
      }
      for (const item of prepared) await verify(item)

      const applied: Prepared[] = []
      try {
        for (const item of prepared) {
          cancelled()
          await verify(item)
          if (!item.after) await fs.unlink(item.actual)
          else if (!item.before) {
            await fs.link(item.temporary!, item.actual)
            applied.push(item)
            await fs.unlink(item.temporary!)
            item.temporary = undefined
            continue
          } else {
            await fs.rename(item.temporary!, item.actual)
            item.temporary = undefined
          }
          applied.push(item)
        }
      } catch (error) {
        const restored: string[] = []
        const unrecovered: string[] = []
        for (const item of applied.reverse()) {
          try {
            let current: Buffer | null = null
            try { current = await fs.readFile(item.actual) } catch (e) { if (!isMissing(e)) throw e }
            if (item.after === null ? current !== null : current === null || hash(current) !== hash(item.after)) throw new Error('Файл изменён извне.')
            if (item.before === null) await fs.unlink(item.actual)
            else await fs.writeFile(item.actual, item.before, { mode: item.mode, flag: item.after === null ? 'wx' : 'w' })
            restored.push(item.display)
          } catch { unrecovered.push(item.display) }
        }
        return {
          error: true,
          formattedContent: `Ошибка применения: ${message(error)}\nВосстановлены: ${restored.join(', ') || 'нет'}\nТребуют проверки: ${unrecovered.join(', ') || 'нет'}`,
          data: { applied: applied.map((i) => i.display), restored, unrecovered }
        }
      }

      for (const item of prepared) {
        if (item.after) {
          await recordReadFileState(board, item.actual, hash(item.after))
        }
      }

      return {
        success: true,
        formattedContent: details,
        data: {
          changed: prepared.some(item => item.before === null || item.after === null || !item.before.equals(item.after)),
          files: prepared.map((i) => ({ path: i.display, action: i.operation.action, diff: i.diff }))
        },
        noTruncate: true
      }
    } catch (error) {
      return { error: true, formattedContent: `Ошибка пакета: ${message(error)}` }
    } finally {
      await Promise.all(prepared.filter((i) => i.temporary).map((i) => fs.rm(i.temporary!, { force: true }).catch(() => {})))
    }
  }
}
