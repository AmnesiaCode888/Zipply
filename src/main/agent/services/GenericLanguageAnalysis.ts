import { spawn, ChildProcessWithoutNullStreams } from 'child_process'
import * as fs from 'fs/promises'
import * as path from 'path'
import { fileURLToPath, pathToFileURL } from 'url'
import type { SandboxPolicy } from '../../../shared/sandbox'
import { processSandbox } from './ProcessSandbox'

export interface GenericRequest { operation: 'definition' | 'references' | 'diagnostics'; path: string; line?: number; column?: number; sourceText?: string; sandbox?: SandboxPolicy }
export interface LanguageServer { executable: string; args: string[]; languageId: string; name: string }
type Result = { items?: Array<Record<string, unknown>>; truncated?: boolean; error?: string }
type Launcher = (server: LanguageServer, root: string) => ChildProcessWithoutNullStreams

// Only these fixed commands and arguments may be selected. The caller chooses the
// file; neither a model nor a workspace file can supply an executable or args.
const languages: Record<string, { command: string; args: string[]; id: string }> = {
  '.c': { command: 'clangd', args: ['--background-index=false'], id: 'c' },
  '.h': { command: 'clangd', args: ['--background-index=false'], id: 'c' },
  '.cc': { command: 'clangd', args: ['--background-index=false'], id: 'cpp' },
  '.cpp': { command: 'clangd', args: ['--background-index=false'], id: 'cpp' },
  '.cxx': { command: 'clangd', args: ['--background-index=false'], id: 'cpp' },
  '.hpp': { command: 'clangd', args: ['--background-index=false'], id: 'cpp' },
  '.hh': { command: 'clangd', args: ['--background-index=false'], id: 'cpp' },
  '.hxx': { command: 'clangd', args: ['--background-index=false'], id: 'cpp' },
  '.cs': { command: 'csharp-ls', args: [], id: 'csharp' },
  '.go': { command: 'gopls', args: ['serve'], id: 'go' },
  '.rs': { command: 'rust-analyzer', args: [], id: 'rust' },
  '.lua': { command: 'lua-language-server', args: [], id: 'lua' },
  '.java': { command: 'jdtls', args: [], id: 'java' },
  '.html': { command: 'vscode-html-language-server', args: ['--stdio'], id: 'html' },
  '.css': { command: 'vscode-css-language-server', args: ['--stdio'], id: 'css' },
  '.scss': { command: 'vscode-css-language-server', args: ['--stdio'], id: 'scss' },
  '.yml': { command: 'yaml-language-server', args: ['--stdio'], id: 'yaml' },
  '.yaml': { command: 'yaml-language-server', args: ['--stdio'], id: 'yaml' },
  '.sh': { command: 'bash-language-server', args: ['start'], id: 'shellscript' },
  '.bash': { command: 'bash-language-server', args: ['start'], id: 'shellscript' },
  '.toml': { command: 'taplo', args: ['lsp', 'stdio'], id: 'toml' },
  '.php': { command: 'phpactor', args: ['language-server'], id: 'php' },
  '.kt': { command: 'kotlin-language-server', args: [], id: 'kotlin' },
  '.swift': { command: 'sourcekit-lsp', args: [], id: 'swift' }
}

export function hasLanguageServer(file: string): boolean { return Boolean(languages[path.extname(file).toLowerCase()]) }
export function languageServerName(file: string): string | undefined { return languages[path.extname(file).toLowerCase()]?.command }

export async function detectLanguageServer(file: string, searchPath = process.env.PATH || ''): Promise<LanguageServer | undefined> {
  const config = languages[path.extname(file).toLowerCase()]
  if (!config) return undefined
  // Ignore relative/empty PATH entries, including the current working directory.
  for (const dir of searchPath.split(path.delimiter)) {
    if (!dir || !path.isAbsolute(dir)) continue
    const candidate = path.join(dir, config.command + (process.platform === 'win32' ? '.exe' : ''))
    try {
      const real = await fs.realpath(candidate)
      if (!(await fs.stat(real)).isFile()) continue
      if (process.platform !== 'win32') await fs.access(real, 1)
      return { executable: real, args: [...config.args], languageId: config.id, name: config.command }
    } catch { /* Try the next PATH entry. */ }
  }
  return undefined
}

/** Launch only after the caller has obtained approval for the trusted server and workspace. */
export async function analyzeGeneric(request: GenericRequest, root: string, server: LanguageServer, signal?: AbortSignal, launcher?: Launcher): Promise<Result> {
  if (signal?.aborted) return { error: 'Анализ отменён.' }
  let rootReal: string, target: string, source: string
  try {
    rootReal = await fs.realpath(root); target = await fs.realpath(request.path)
    const rel = path.relative(rootReal, target)
    if (rel === '..' || rel.startsWith('..' + path.sep) || path.isAbsolute(rel)) return { error: 'Файл находится вне рабочей папки.' }
    source = request.sourceText ?? await fs.readFile(target, 'utf8')
  } catch (e) { return { error: `Не удалось прочитать файл: ${e instanceof Error ? e.message : String(e)}` } }
  if (signal?.aborted) return { error: 'Анализ отменён.' }
  if (!['diagnostics', 'definition', 'references'].includes(request.operation)) return { error: 'Операция не поддерживается.' }
  const lines = source.split(/\r?\n/)
  if (request.operation !== 'diagnostics' && (!Number.isInteger(request.line) || !Number.isInteger(request.column) || request.line! < 1 || request.column! < 1 || request.line! > lines.length || request.column! > lines[request.line! - 1].length + 1)) return { error: 'Координаты за пределами файла.' }
  const uri = pathToFileURL(target).href
  const policy: SandboxPolicy = request.sandbox ?? { profile: 'read-only', network: 'off', writableRoots: [] }
  let prepared: Awaited<ReturnType<typeof processSandbox.prepareSpawn>> | undefined
  if (!launcher) {
    try {
      prepared = await processSandbox.prepareSpawn({
        shell: server.executable,
        args: server.args,
        cwd: rootReal,
        workspaceRoot: rootReal,
        env: { ...process.env } as Record<string, string>,
        policy
      })
    } catch (e) {
      return { error: `Не удалось изолировать ${server.name}: ${e instanceof Error ? e.message : String(e)}` }
    }
    if (signal?.aborted) {
      await prepared.cleanup?.().catch(() => {})
      return { error: 'Анализ отменён.' }
    }
  }
  return new Promise((resolve) => {
    let child: ChildProcessWithoutNullStreams
    try {
      child = launcher
        ? launcher(server, rootReal)
        : spawn(prepared!.command, prepared!.args, { cwd: prepared!.cwd, env: prepared!.env, windowsHide: true, stdio: 'pipe', shell: false })
    } catch (e) {
      void prepared?.cleanup?.().catch(() => {}).finally(() => resolve({ error: `Не удалось запустить ${server.name}: ${e instanceof Error ? e.message : String(e)}` }))
      return
    }
    let done = false, buffer = Buffer.alloc(0), opened = false, id = 0
    const pending = new Map<number, (response: any) => void>()
    const finish = (result: Result): void => {
      if (done) return
      done = true; clearTimeout(timer); signal?.removeEventListener('abort', cancel)
      child.stdin.destroy(); child.kill()
      void (prepared?.cleanup ? prepared.cleanup().catch(() => {}) : Promise.resolve()).finally(() => resolve(result))
    }
    const cancel = (): void => finish({ error: 'Анализ отменён.' })
    const timer = setTimeout(() => finish({ error: `Превышено время анализа ${server.name}; результат не получен.` }), 20000)
    signal?.addEventListener('abort', cancel, { once: true })
    if (signal?.aborted) { cancel(); return }
    const send = (message: object): void => { if (done) return; const json = JSON.stringify(message); child.stdin.write(`Content-Length: ${Buffer.byteLength(json)}\r\n\r\n${json}`) }
    const call = (method: string, params: unknown, callback: (response: any) => void): void => { const n = ++id; pending.set(n, callback); send({ jsonrpc: '2.0', id: n, method, params }) }
    const locations = async (value: any): Promise<void> => {
      const raw = Array.isArray(value) ? value : value ? [value] : []
      const items: Array<Record<string, unknown>> = []
      for (const entry of raw.slice(0, 1000)) {
        try {
          const targetUri = entry.uri || entry.targetUri, range = entry.range || entry.targetSelectionRange
          if (typeof targetUri !== 'string' || !Number.isInteger(range?.start?.line) || !Number.isInteger(range?.start?.character) || range.start.line < 0 || range.start.character < 0) continue
          const file = await fs.realpath(fileURLToPath(targetUri)); const rel = path.relative(rootReal, file)
          if (rel === '..' || rel.startsWith('..' + path.sep) || path.isAbsolute(rel)) continue
          items.push({ path: rel.replace(/\\/g, '/'), line: range.start.line + 1, column: range.start.character + 1 })
        } catch { /* Ignore external, nonexistent and malformed locations. */ }
      }
      finish({ items: items.slice(0, 100), truncated: raw.length > 100 })
    }
    child.stdout.on('data', (chunk: Buffer) => {
      buffer = Buffer.concat([buffer, chunk]); if (buffer.length > 8 * 1024 * 1024) { finish({ error: 'Ответ сервера превышает лимит.' }); return }
      while (!done) {
        const end = buffer.indexOf('\r\n\r\n'); if (end < 0) break
        const match = /(?:^|\r\n)content-length:\s*(\d+)\s*(?:\r\n|$)/i.exec(buffer.subarray(0, end).toString('ascii'))
        if (!match || Number(match[1]) > 8 * 1024 * 1024) { finish({ error: 'Некорректный ответ сервера.' }); return }
        const length = Number(match[1]); if (buffer.length < end + 4 + length) break
        let m: any; try { m = JSON.parse(buffer.subarray(end + 4, end + 4 + length).toString('utf8')) } catch { finish({ error: 'Некорректный JSON сервера.' }); return }
        buffer = buffer.subarray(end + 4 + length)
        if (m.id !== undefined && m.method) {
          if (m.method === 'workspace/configuration') send({ jsonrpc: '2.0', id: m.id, result: (m.params?.items || []).map(() => null) })
          else if (m.method === 'workspace/workspaceFolders') send({ jsonrpc: '2.0', id: m.id, result: [{ uri: pathToFileURL(rootReal).href, name: path.basename(rootReal) }] })
          else send({ jsonrpc: '2.0', id: m.id, error: { code: -32601, message: 'Method not supported' } })
          continue
        }
        if (m.id !== undefined) { const handler = pending.get(m.id); pending.delete(m.id); handler?.(m); continue }
        let sameFile = false
        if (typeof m.params?.uri === 'string') {
          try {
            const received = path.resolve(fileURLToPath(m.params.uri)), expected = path.resolve(target)
            sameFile = process.platform === 'win32' ? received.toLowerCase() === expected.toLowerCase() : received === expected
          } catch { /* Ignore non-file and invalid URIs. */ }
        }
        if (opened && request.operation === 'diagnostics' && m.method === 'textDocument/publishDiagnostics' && sameFile && Array.isArray(m.params.diagnostics)) {
          const list = m.params.diagnostics
          const items = list.slice(0, 100).filter((d: any) => d?.range?.start && typeof d.message === 'string').map((d: any) => ({ path: path.relative(rootReal, target).replace(/\\/g, '/'), line: d.range.start.line + 1, column: d.range.start.character + 1, endLine: (d.range.end?.line ?? d.range.start.line) + 1, endColumn: (d.range.end?.character ?? d.range.start.character + 1) + 1, category: d.severity === 1 ? 'Error' : 'Warning', code: d.code ?? server.name, message: d.message }))
          finish({ items, truncated: list.length > 100 })
        }
      }
    })
    child.stderr.resume()
    child.stdin.on('error', () => finish({ error: `Соединение с ${server.name} закрыто.` }))
    child.on('error', (e) => finish({ error: `Не удалось запустить ${server.name}: ${e.message}` }))
    child.on('exit', (code) => finish({ error: `Сервер ${server.name} завершился с кодом ${code}.` }))
    call('initialize', { processId: process.pid, rootUri: pathToFileURL(rootReal).href, workspaceFolders: [{ uri: pathToFileURL(rootReal).href, name: path.basename(rootReal) }], capabilities: { general: { positionEncodings: ['utf-16'] }, workspace: { workspaceFolders: true } } }, (response) => {
      if (response.error) { finish({ error: `Ошибка инициализации ${server.name}: ${response.error.message}` }); return }
      const caps = response.result?.capabilities || {}
      if (caps.positionEncoding && caps.positionEncoding !== 'utf-16') { finish({ error: 'Сервер не поддерживает позиции UTF-16.' }); return }
      if (request.operation === 'definition' && !caps.definitionProvider || request.operation === 'references' && !caps.referencesProvider) { finish({ error: 'Сервер не поддерживает эту операцию.' }); return }
      send({ jsonrpc: '2.0', method: 'initialized', params: {} }); opened = true
      send({ jsonrpc: '2.0', method: 'textDocument/didOpen', params: { textDocument: { uri, languageId: server.languageId, version: 1, text: source } } })
      if (request.operation !== 'diagnostics') call(request.operation === 'definition' ? 'textDocument/definition' : 'textDocument/references', { textDocument: { uri }, position: { line: request.line! - 1, character: request.column! - 1 }, ...(request.operation === 'references' ? { context: { includeDeclaration: true } } : {}) }, (answer) => { if (answer.error) finish({ error: `Ошибка ${server.name}: ${answer.error.message}` }); else void locations(answer.result) })
    })
  })
}
