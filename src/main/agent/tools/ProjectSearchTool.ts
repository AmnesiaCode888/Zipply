import { spawn } from 'child_process'
import * as fs from 'fs/promises'
import * as path from 'path'
import { Worker } from 'worker_threads'
import picomatch from 'picomatch'
import { Blackboard } from '../core/Blackboard'
import { ToolBase, ToolExecutionPolicy, ToolParameterDef, ToolResult } from './ToolBase'
import { resolveWorkspacePath } from './pathUtils'
import { walkProject } from './projectWalk'

const ignored = ['!.git', '!node_modules', '!dist', '!build', '!out', '!coverage']
const MAX_FILE_BYTES = 1_000_000
interface SearchArgs { query: string; mode?: string; path?: string; regex?: boolean; case_sensitive?: boolean; glob?: string; context_lines?: number; limit?: number }
interface SearchOutput { lines: string[]; truncated: boolean; skippedLargeFiles?: number; largeFileCountUnknown?: boolean; engine?: 'rg' | 'fallback' }

/** List non-ignored files in workspace using ripgrep's native gitignore engine. */
export async function listWorkspaceFilesWithRg(workspace: string, signal?: AbortSignal): Promise<string[] | null> {
  const flags = ['--files', '--hidden', '--no-require-git', '--no-ignore-parent', '--no-ignore-global', '--no-ignore-exclude']
  for (const glob of ignored) flags.push('-g', glob)
  flags.push('.')
  return await new Promise((resolve, reject) => {
    const child = spawn('rg', flags, { cwd: workspace, windowsHide: true })
    const files: string[] = []
    let buffer = ''
    let settled = false
    const finish = (error?: Error, missing = false): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      signal?.removeEventListener('abort', onAbort)
      if (error) reject(error)
      else resolve(missing ? null : files)
    }
    const onAbort = (): void => { child.kill(); finish(new Error('Поиск отменён.')) }
    const timer = setTimeout(() => { child.kill(); finish(new Error('Превышено время ожидания поиска.')) }, 15000)
    if (signal?.aborted) return onAbort()
    signal?.addEventListener('abort', onAbort, { once: true })
    child.on('error', (error: NodeJS.ErrnoException) => error.code === 'ENOENT' ? finish(undefined, true) : finish(error))
    child.stdout.setEncoding('utf8')
    child.stdout.on('data', (chunk: string) => {
      buffer += chunk
      if (buffer.length > 4_000_000) { child.kill(); finish(); return }
      let idx: number
      while ((idx = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, idx).replace(/\r$/, '').replace(/\\/g, '/').replace(/^\.\//, '')
        buffer = buffer.slice(idx + 1)
        if (line) files.push(line)
      }
    })
    child.stderr.resume()
    child.on('close', (code) => {
      if (buffer.trim()) {
        files.push(buffer.trim().replace(/\\/g, '/').replace(/^\.\//, ''))
      }
      if (code === 0 || code === 1) finish()
      else if (!settled) finish(undefined, true)
    })
  })
}

/** Stream ripgrep's structured output so a large match cannot exhaust execFile's buffer. */
async function searchWithRg(
  workspace: string,
  root: string,
  args: SearchArgs,
  limit: number,
  context: number,
  signal?: AbortSignal
): Promise<SearchOutput | null> {
  const realWorkspace = await fs.realpath(workspace).catch(() => path.resolve(workspace))
  const realRoot = await fs.realpath(root).catch(() => path.resolve(root))
  const relSubdir = path.relative(realWorkspace, realRoot).replace(/\\/g, '/')
  const inSubdir = Boolean(relSubdir && relSubdir !== '.')
  const globMatch = args.glob ? picomatch(args.glob, { dot: true, basename: !args.glob.includes('/') }) : null

  let targets: string[] = ['.']
  let skippedLargeFiles: number | undefined

  if (args.mode === 'files' || inSubdir || globMatch) {
    const allFiles = await listWorkspaceFilesWithRg(realWorkspace, signal)
    if (allFiles === null) return null
    let filtered = allFiles.filter((rel) => !inSubdir || rel === relSubdir || rel.startsWith(`${relSubdir}/`))
    if (globMatch) {
      filtered = filtered.filter((rel) => {
        const relToRoot = inSubdir ? rel.slice(relSubdir.length + 1) : rel
        return globMatch(relToRoot)
      })
    }

    if (args.mode === 'files') {
      let scanner: RegexScanner | undefined
      const needle = args.case_sensitive ? args.query : args.query.toLowerCase()
      try {
        if (args.regex) scanner = new RegexScanner(args.query, Boolean(args.case_sensitive))
        const matched: string[] = []
        let truncated = false
        for (const rel of filtered) {
          const hit = scanner
            ? (await scanner.matches([rel], 1, signal)).length > 0
            : (args.case_sensitive ? rel : rel.toLowerCase()).includes(needle)
          if (hit) {
            if (matched.length >= limit) { truncated = true; break }
            matched.push(rel)
          }
        }
        return { lines: matched, truncated, engine: 'rg' }
      } finally {
        scanner?.close()
      }
    }

    if (filtered.length === 0) {
      return { lines: [], truncated: false, skippedLargeFiles: 0, engine: 'rg' }
    }

    if (filtered.length <= 500) {
      skippedLargeFiles = 0
      const smallFiles: string[] = []
      for (const rel of filtered) {
        try {
          const stat = await fs.stat(path.join(realWorkspace, rel))
          if (stat.size > MAX_FILE_BYTES) skippedLargeFiles++
          else smallFiles.push(rel)
        } catch { /* ignore vanished */ }
      }
      if (smallFiles.length === 0) {
        return { lines: [], truncated: false, skippedLargeFiles, engine: 'rg' }
      }
      if (smallFiles.length <= 150) {
        targets = smallFiles
      }
    }
  }

  const flags = ['--json', '--hidden', '--no-require-git', '--no-ignore-parent', '--no-ignore-global', '--no-ignore-exclude', '--color', 'never', '--max-filesize', String(MAX_FILE_BYTES), '--context', String(context)]
  if (targets.length === 1 && targets[0] === '.') {
    for (const glob of ignored) flags.push('-g', glob)
  }
  if (!args.regex) flags.push('--fixed-strings')
  if (!args.case_sensitive) flags.push('--ignore-case')
  flags.push('--', args.query, ...targets)

  return await new Promise((resolve, reject) => {
    const child = spawn('rg', flags, { cwd: realWorkspace, windowsHide: true })
    const lines: string[] = []
    let buffer = ''
    let stderr = ''
    let matches = 0
    let outputLength = 0
    let truncated = false
    let settled = false
    const finish = (error?: Error, fallbackToJs = false): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      signal?.removeEventListener('abort', onAbort)
      if (error) reject(error)
      else resolve(fallbackToJs ? null : { lines, truncated, skippedLargeFiles, largeFileCountUnknown: skippedLargeFiles === undefined, engine: 'rg' })
    }
    const onAbort = (): void => { child.kill(); finish(new Error('Поиск отменён.')) }
    const timer = setTimeout(() => { child.kill(); finish(new Error('Превышено время ожидания поиска.')) }, 15000)
    if (signal?.aborted) return onAbort()
    signal?.addEventListener('abort', onAbort, { once: true })
    child.on('error', (error: NodeJS.ErrnoException) => error.code === 'ENOENT' ? finish(undefined, true) : finish(error))
    child.stderr.on('data', (data: Buffer) => { stderr = (stderr + data.toString('utf8')).slice(0, 4000) })
    child.stdout.setEncoding('utf8')
    child.stdout.on('data', (data: string) => {
      buffer += data
      if (buffer.length > 2_000_000) { truncated = true; child.kill(); finish(); return }
      let end: number
      while (!settled && (end = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, end)
        buffer = buffer.slice(end + 1)
        try {
          const event = JSON.parse(line)
          if (event.type !== 'match' && event.type !== 'context') continue
          const filename = String(event.data.path?.text || '').replace(/\\/g, '/').replace(/^\.\//, '')
          if (inSubdir && filename !== relSubdir && !filename.startsWith(`${relSubdir}/`)) continue
          if (globMatch) {
            const relToRoot = inSubdir ? filename.slice(relSubdir.length + 1) : filename
            if (!globMatch(relToRoot)) continue
          }
          if (event.type === 'match' && ++matches > limit) { truncated = true; child.kill(); finish(); break }
          const text = String(event.data.lines?.text || '').replace(/\r?\n$/, '')
          const formatted = `${filename}${event.type === 'match' ? ':' : '-'}${event.data.line_number}${event.type === 'match' ? ':' : '-'}${text.slice(0, 1000)}${text.length > 1000 ? ' [строка усечена]' : ''}`
          outputLength += formatted.length + (lines.length ? 1 : 0)
          lines.push(formatted)
          if (outputLength > 28000) { truncated = true; child.kill(); finish(); break }
        } catch { /* Ignore unrecognized records. */ }
      }
    })
    child.on('close', (code) => {
      if (code === 0 || code === 1) finish()
      else if (code === 2 && args.regex) finish(undefined, true) // Regex syntax mismatch (e.g. JS lookbehind) -> JS fallback
      else if (!settled) finish(new Error(stderr.trim() || `rg завершился с кодом ${code}`))
    })
  })
}

/** Run potentially expensive user regexes off the main thread with a deadline. */
class RegexScanner {
  private worker: Worker
  constructor(pattern: string, sensitive: boolean) {
    this.worker = new Worker(`const { parentPort, workerData } = require('worker_threads'); const re = new RegExp(workerData.pattern, workerData.flags); parentPort.on('message', ({ lines, limit }) => { const matches = []; for (let i = 0; i < lines.length && matches.length < limit; i++) if (re.test(lines[i])) matches.push(i); parentPort.postMessage(matches) })`, { eval: true, workerData: { pattern, flags: sensitive ? 'u' : 'iu' } })
  }
  async matches(lines: string[], limit: number, signal?: AbortSignal): Promise<number[]> {
    return await new Promise((resolve, reject) => {
      let done = false
      const finish = (error?: Error, result?: number[]): void => { if (done) return; done = true; clearTimeout(timer); this.worker.removeListener('message', onMessage); this.worker.removeListener('error', onError); signal?.removeEventListener('abort', onAbort); error ? reject(error) : resolve(result || []) }
      const onMessage = (result: number[]): void => finish(undefined, result)
      const onError = (error: Error): void => finish(error)
      const onAbort = (): void => finish(new Error('Поиск отменён.'))
      const timer = setTimeout(() => finish(new Error('Регулярное выражение выполнялось слишком долго.')), 2000)
      this.worker.once('message', onMessage); this.worker.once('error', onError); signal?.addEventListener('abort', onAbort, { once: true })
      if (signal?.aborted) onAbort(); else this.worker.postMessage({ lines, limit })
    })
  }
  close(): void { void this.worker.terminate() }
}

async function fallback(root: string, workspace: string, args: SearchArgs, limit: number, context: number, signal?: AbortSignal): Promise<SearchOutput> {
  const output: string[] = []; let matches = 0; let chars = 0; let skippedLargeFiles = 0
  const scanner = args.regex ? new RegexScanner(args.query, Boolean(args.case_sensitive)) : undefined
  const needle = args.case_sensitive ? args.query : args.query.toLowerCase()
  try {
    const state = await walkProject(root, workspace, args.glob, signal, async (file, rel) => {
      if (args.mode === 'files') {
        const found = scanner ? (await scanner.matches([rel], 1, signal)).length > 0 : (args.case_sensitive ? rel : rel.toLowerCase()).includes(needle)
        if (found) { matches++; if (matches <= limit) output.push(rel) }
        return matches > limit
      }
      let data: Buffer
      try { const stat = await fs.stat(file); if (stat.size > MAX_FILE_BYTES) { skippedLargeFiles++; return false }; data = await fs.readFile(file); if (data.includes(0)) return false } catch { return false }
      const lines = data.toString('utf8').split(/\r?\n/)
      const indices = scanner ? await scanner.matches(lines, limit - matches + 1, signal) : lines.flatMap((line, index) => (args.case_sensitive ? line : line.toLowerCase()).includes(needle) ? [index] : []).slice(0, limit - matches + 1)
      const selected = new Set<number>()
      for (const index of indices) {
        if (++matches > limit) break
        for (let n = Math.max(0, index - context); n <= Math.min(lines.length - 1, index + context); n++) selected.add(n)
      }
      const matchIndices = new Set(indices.slice(0, Math.max(0, indices.length - (matches > limit ? 1 : 0))))
      for (const index of [...selected].sort((a, b) => a - b)) {
        const text = lines[index]; const marker = matchIndices.has(index) ? ':' : '-'
        const line = `${rel}${marker}${index + 1}${marker}${text.slice(0, 1000)}${text.length > 1000 ? ' [строка усечена]' : ''}`
        output.push(line); chars += line.length + 1
        if (chars > 28000) return true
      }
      return matches > limit
    })
    if (state.cancelled) throw new Error('Поиск отменён.')
    return { lines: output, truncated: state.truncated, skippedLargeFiles, engine: 'fallback' }
  } finally { scanner?.close() }
}

export class ProjectSearchTool extends ToolBase {
  get name(): string { return 'search_project' }
  get description(): string { return 'Ищет текст в файлах или имена файлов в проекте с учётом .gitignore; поддерживает регулярные выражения, glob-фильтр и контекстные строки.' }
  get parameters(): Record<string, ToolParameterDef> { return {
    query: { type: 'string', description: 'Текст или регулярное выражение для поиска', required: true, minLength: 1 },
    mode: { type: 'string', description: 'content — содержимое, files — имена', enum: ['content', 'files'] },
    path: { type: 'string', description: 'Папка поиска относительно проекта' },
    regex: { type: 'boolean', description: 'Интерпретировать query как регулярное выражение' },
    case_sensitive: { type: 'boolean', description: 'Учитывать регистр' },
    glob: { type: 'string', description: 'Фильтр путей в формате glob, например **/*.ts' },
    context_lines: { type: 'integer', description: 'Число окружающих строк, от 0 до 5.', minimum: 0, maximum: 5, default: 0 },
    limit: { type: 'integer', description: 'Максимум совпадений, от 1 до 200 (по умолчанию 100).', minimum: 1, maximum: 200, default: 100 }
  } }
  getExecutionPolicy(): ToolExecutionPolicy { return { mutates: false, parallelSafe: true, cacheable: false } }
  validate(raw: string): string | null {
    try { const args = JSON.parse(raw); if (typeof args.query !== 'string' || !args.query.trim()) return 'Ошибка: query обязателен.'; if (args.regex) { try { new RegExp(args.query, args.case_sensitive ? 'u' : 'iu') } catch { return 'Ошибка: некорректное регулярное выражение.' } }; return null }
    catch { return 'Ошибка: некорректный JSON аргументов.' }
  }
  async execute(raw: string, board: Blackboard, signal?: AbortSignal): Promise<ToolResult> {
    const error = this.validate(raw); if (error) return { formattedContent: error, error: true }
    const args = JSON.parse(raw) as SearchArgs
    const limit = Math.max(1, Math.min(200, Math.floor(Number(args.limit) || 100)))
    const context = Math.max(0, Math.min(5, Math.floor(Number(args.context_lines) || 0)))
    const root = resolveWorkspacePath(board, args.path || '.').absPath
    const workspace = resolveWorkspacePath(board, '.').absPath
    try {
      const result = (await searchWithRg(workspace, root, args, limit, context, signal)) || await fallback(root, workspace, args, limit, context, signal)
      const partial = result.truncated || Boolean(result.skippedLargeFiles || result.largeFileCountUnknown)
      const text = result.lines.join('\n') || (partial ? 'В просмотренной части совпадений не найдено.' : 'Совпадений не найдено.')
      const largeNotice = result.largeFileCountUnknown
        ? '\n[Файлы больше 1 МБ исключены из поиска. Число таких файлов неизвестно. Укажите конкретный путь или glob для проверки области поиска.]'
        : result.skippedLargeFiles ? `\n[${result.skippedLargeFiles} файл(ов) пропущено: размер превышает 1 МБ.]` : ''
      return {
        formattedContent: text + (result.truncated ? '\n[Результаты ограничены; уточните запрос или путь.]' : '') + largeNotice,
        data: {
          truncated: result.truncated,
          partial,
          skippedLargeFiles: result.largeFileCountUnknown ? null : result.skippedLargeFiles ?? 0,
          engine: result.engine
        },
        noTruncate: true,
        success: true
      }
    } catch (err) { return { formattedContent: `Ошибка поиска: ${err instanceof Error ? err.message : String(err)}`, error: true } }
  }
}
