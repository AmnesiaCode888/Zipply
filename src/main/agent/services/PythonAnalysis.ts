import { spawn } from 'child_process'
import * as fs from 'fs/promises'
import * as path from 'path'
import { fileURLToPath, pathToFileURL } from 'url'
import type { SandboxPolicy } from '../../../shared/sandbox'
import { processSandbox } from './ProcessSandbox'

export interface PythonRequest { operation: 'definition' | 'references' | 'diagnostics'; path: string; line?: number; column?: number; sourceText?: string; sandbox?: SandboxPolicy }
type Result = { items?: Array<Record<string, unknown>>; truncated?: boolean; error?: string }

/** Each request has its own bundled server and is terminated on completion. */
export async function analyzePython(request: PythonRequest, root: string, signal?: AbortSignal): Promise<Result> {
  if (signal?.aborted) return { error: 'Анализ отменён.' }
  let serverPath: string
  try { serverPath = require.resolve('pyright/langserver.index.js') }
  catch { return { error: 'Анализ Python недоступен: пакет pyright не установлен.' } }
  let source: string
  try { source = request.sourceText ?? await fs.readFile(request.path, 'utf8') }
  catch (error) { return { error: `Не удалось прочитать файл: ${error instanceof Error ? error.message : String(error)}` } }
  if (signal?.aborted) return { error: 'Анализ отменён.' }
  const lines = source.split(/\r?\n/)
  if (request.operation !== 'diagnostics' && (!request.line || !request.column || request.line > lines.length || request.column > lines[request.line - 1].length + 1)) return { error: 'Координаты за пределами файла.' }
  const rootReal = await fs.realpath(root)
  const uri = pathToFileURL(request.path).href
  const policy: SandboxPolicy = request.sandbox ?? { profile: 'read-only', network: 'off', writableRoots: [] }
  let prepared
  try {
    prepared = await processSandbox.prepareSpawn({
      shell: process.execPath,
      args: [serverPath, '--stdio'],
      cwd: rootReal,
      workspaceRoot: rootReal,
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' } as Record<string, string>,
      policy
    })
  } catch (err) {
    return { error: `Не удалось изолировать анализатор Python: ${err instanceof Error ? err.message : String(err)}` }
  }
  if (signal?.aborted) {
    await prepared.cleanup?.().catch(() => {})
    return { error: 'Анализ отменён.' }
  }

  return new Promise((resolve) => {
    const child = spawn(prepared.command, prepared.args, {
      cwd: prepared.cwd, windowsHide: true, env: prepared.env, stdio: ['pipe', 'pipe', 'pipe']
    })
    let done = false, buffer = Buffer.alloc(0), responseStarted = false, requestSent = false
    let id = 0
    const pending = new Map<number, (message: any) => void>()
    const finish = (result: Result): void => {
      if (done) return
      done = true; clearTimeout(timer); signal?.removeEventListener('abort', cancel)
      child.stdin.destroy()
      const finalize = (res: Result): void => {
        void (prepared.cleanup ? prepared.cleanup().catch(() => {}) : Promise.resolve()).finally(() => resolve(res))
      }
      if (child.exitCode !== null || child.signalCode !== null) { finalize(result); return }
      let resolved = false
      const complete = (): void => { if (!resolved) { resolved = true; clearTimeout(cleanup); finalize(result) } }
      const cleanup = setTimeout(complete, 2000)
      child.once('close', complete)
      if (!child.kill()) complete()
    }
    const cancel = (): void => finish({ error: 'Анализ отменён.' })
    const timer = setTimeout(() => finish({ error: 'Превышено время анализа Python (20 секунд).' }), 20000)
    signal?.addEventListener('abort', cancel, { once: true })
    if (signal?.aborted) { cancel(); return }
    const send = (message: object): void => {
      const json = JSON.stringify(message)
      child.stdin.write(`Content-Length: ${Buffer.byteLength(json)}\r\n\r\n${json}`)
    }
    const call = (method: string, params: unknown, callback: (m: any) => void): void => {
      const current = ++id; pending.set(current, callback); send({ jsonrpc: '2.0', id: current, method, params })
    }
    const notify = (method: string, params: unknown): void => send({ jsonrpc: '2.0', method, params })
    const startNavigation = (): void => {
      if (requestSent || done || request.operation === 'diagnostics') return
      requestSent = true
      const method = request.operation === 'definition' ? 'textDocument/definition' : 'textDocument/references'
      call(method, { textDocument: { uri }, position: { line: request.line! - 1, character: request.column! - 1 }, ...(request.operation === 'references' ? { context: { includeDeclaration: true } } : {}) }, (answer) => {
        if (answer.error) finish({ error: `Ошибка анализа Python: ${answer.error.message}` })
        else void locations(answer.result)
      })
    }
    const locations = async (value: any): Promise<void> => {
      const raw = Array.isArray(value) ? value : value ? [value] : []
      const items: Array<Record<string, unknown>> = []
      for (const location of raw.slice(0, 1000)) {
        try {
          const rawUri = location.uri || location.targetUri
          const range = location.range || location.targetSelectionRange
          if (typeof rawUri !== 'string' || !range?.start) continue
          const file = await fs.realpath(fileURLToPath(rawUri))
          const rel = path.relative(rootReal, file)
          if (rel === '..' || rel.startsWith(`..${path.sep}`) || path.isAbsolute(rel)) continue
          items.push({ path: rel.replace(/\\/g, '/'), line: range.start.line + 1, column: range.start.character + 1 })
        } catch { /* Exclude external, invalid and missing locations. */ }
      }
      finish({ items: items.slice(0, 100), truncated: raw.length > 100 })
    }
    child.stdout.on('data', (chunk: Buffer) => {
      buffer = Buffer.concat([buffer, chunk])
      if (buffer.length > 8 * 1024 * 1024) { finish({ error: 'Ответ анализатора Python превышает лимит.' }); return }
      while (!done) {
        const end = buffer.indexOf('\r\n\r\n'); if (end < 0) break
        const header = buffer.subarray(0, end).toString('ascii')
        const match = /content-length:\s*(\d+)/i.exec(header)
        if (!match) { finish({ error: 'Некорректный ответ анализатора Python.' }); return }
        const length = Number(match[1]); if (length > 8 * 1024 * 1024) { finish({ error: 'Ответ анализатора Python превышает лимит.' }); return }
        if (buffer.length < end + 4 + length) break
        let message: any
        try { message = JSON.parse(buffer.subarray(end + 4, end + 4 + length).toString('utf8')) }
        catch { finish({ error: 'Некорректный JSON анализатора Python.' }); return }
        buffer = buffer.subarray(end + 4 + length)
        if (message.id !== undefined && message.method) { send({ jsonrpc: '2.0', id: message.id, result: message.method === 'workspace/configuration' ? (message.params?.items || []).map(() => ({})) : null }); continue }
        if (message.id !== undefined) { const handler = pending.get(message.id); pending.delete(message.id); handler?.(message); continue }
        let sameFile = false
        if (typeof message.params?.uri === 'string') { try { sameFile = path.resolve(fileURLToPath(message.params.uri)).toLowerCase() === path.resolve(request.path).toLowerCase() } catch { /* Ignore malformed URIs. */ } }
        if (responseStarted && message.method === 'textDocument/publishDiagnostics' && sameFile) {
          if (request.operation !== 'diagnostics') { startNavigation(); continue }
          const diagnostics = message.params.diagnostics || []
          const items = diagnostics.slice(0, 100).filter((d: any) => d?.range?.start && typeof d.message === 'string').map((d: any) => ({ path: path.relative(rootReal, request.path).replace(/\\/g, '/'), line: d.range.start.line + 1, column: d.range.start.character + 1, endLine: (d.range.end?.line ?? d.range.start.line) + 1, endColumn: (d.range.end?.character ?? d.range.start.character + 1) + 1, category: d.severity === 1 ? 'Error' : 'Warning', code: d.code || d.source || 'pyright', message: d.message }))
          finish({ items, truncated: diagnostics.length > 100 })
        }
      }
    })
    child.stderr.resume()
    child.stdin.on('error', (error) => finish({ error: `Ошибка связи с анализатором Python: ${error.message}` }))
    child.on('error', (error) => finish({ error: `Не удалось запустить анализатор Python: ${error.message}` }))
    child.on('exit', (code) => finish({ error: `Анализатор Python завершился с кодом ${code}.` }))
    call('initialize', { processId: process.pid, rootUri: pathToFileURL(rootReal).href, workspaceFolders: [{ uri: pathToFileURL(rootReal).href, name: path.basename(rootReal) }], capabilities: { workspace: { workspaceFolders: true } }, initializationOptions: {} }, (message) => {
      if (message.error) { finish({ error: `Ошибка запуска анализатора Python: ${message.error.message}` }); return }
      notify('initialized', {})
      responseStarted = true
      notify('textDocument/didOpen', { textDocument: { uri, languageId: 'python', version: 1, text: source } })
    })
  })
}
