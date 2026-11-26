import { ChildProcess, spawn } from 'child_process'
import { randomUUID } from 'crypto'
import { EventEmitter } from 'events'
import * as path from 'path'
import { StringDecoder } from 'string_decoder'
import { windowsJobCommand } from './WindowsProcessJob'
import { processSandbox } from './ProcessSandbox'
import { applyDependencyEnvironment } from './DependencyEnvironment'
import type { SandboxPolicy } from '../../../shared/sandbox'

export interface ProcessOwner { senderId: number; sessionId: string; workspace: string }
type ProcessStatus = 'starting' | 'running' | 'exited' | 'failed' | 'stopped'
interface Entry {
  id: string; owner: ProcessOwner; requestId: string; command: string; cwd: string; child: ChildProcess
  status: ProcessStatus; exitCode: number | null; signal: string | null; output: string; offset: number
  events: EventEmitter; endedAt?: number; stopping: boolean; exitSeen: boolean; stopPromise?: Promise<void>
  cleanupPromise?: Promise<void>
}
const MAX_OUTPUT = 256 * 1024
const RETENTION = 30 * 60 * 1000

export class ProcessManager {
  private entries = new Map<string, Entry>()
  private sameOwner(a: ProcessOwner, b: ProcessOwner): boolean { return a.senderId === b.senderId && a.sessionId === b.sessionId && path.resolve(a.workspace) === path.resolve(b.workspace) }
  private get(owner: ProcessOwner, id: string): Entry {
    const entry = this.entries.get(id)
    if (!entry || !this.sameOwner(owner, entry.owner)) throw new Error('Процесс не найден в текущем чате и рабочей папке.')
    return entry
  }
  private prune(): void {
    for (const [id, entry] of this.entries) if (entry.endedAt && Date.now() - entry.endedAt > RETENTION) this.entries.delete(id)
    const completed = [...this.entries.values()].filter(entry => entry.endedAt).sort((a, b) => a.endedAt! - b.endedAt!)
    for (const entry of completed.slice(0, Math.max(0, completed.length - 20))) this.entries.delete(entry.id)
  }
  async start(owner: ProcessOwner, requestId: string, command: string, cwd: string, sandboxPolicy?: SandboxPolicy, dependencyPaths: string[] = []): Promise<{ id: string; status: ProcessStatus }> {
    this.prune()
    const live = [...this.entries.values()].filter(e => !e.endedAt)
    if (live.length >= 20 || live.filter(e => this.sameOwner(e.owner, owner)).length >= 5) throw new Error('Достигнут лимит активных процессов.')
    const win = process.platform === 'win32'
    const shell = win ? 'powershell.exe' : '/bin/bash'
    const rawArgs = win ? ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', `[Console]::OutputEncoding = [System.Text.UTF8Encoding]::UTF8; $OutputEncoding = [System.Text.UTF8Encoding]::UTF8; ${windowsJobCommand(command)}`] : ['-c', command]
    const policy: SandboxPolicy = sandboxPolicy ?? { profile: 'workspace-write', network: 'off', writableRoots: [path.resolve(owner.workspace || cwd)] }
    const env = { ...process.env, PYTHONIOENCODING: 'utf-8', FORCE_COLOR: '0', NO_COLOR: '1' } as Record<string, string>
    applyDependencyEnvironment(env, dependencyPaths)
    const prepared = await processSandbox.prepareSpawn({
      shell,
      args: rawArgs,
      cwd,
      workspaceRoot: owner.workspace || cwd,
      env,
      policy
    })
    const child = spawn(prepared.command, prepared.args, { cwd: prepared.cwd, detached: !win, windowsHide: true, env: prepared.env })
    const entry: Entry = { id: randomUUID(), owner, requestId, command, cwd, child, status: 'starting', exitCode: null, signal: null, output: '', offset: 0, events: new EventEmitter(), stopping: false, exitSeen: false }
    entry.events.setMaxListeners(0)
    this.entries.set(entry.id, entry)
    const runCleanup = (): void => {
      if (prepared.cleanup && !entry.cleanupPromise) {
        entry.cleanupPromise = prepared.cleanup().catch(() => {})
      }
    }
    const append = (text: string): void => { entry.output += text; if (entry.output.length > MAX_OUTPUT) { const drop = entry.output.length - MAX_OUTPUT; entry.output = entry.output.slice(drop); entry.offset += drop }; entry.events.emit('change') }
    for (const stream of [child.stdout, child.stderr]) if (stream) { const decoder = new StringDecoder('utf8'); stream.on('data', (chunk: Buffer) => append(decoder.write(chunk))); stream.on('end', () => { const rest = decoder.end(); if (rest) append(rest) }) }
    child.on('error', (error) => { runCleanup(); append(`Ошибка запуска: ${error.message}`); entry.status = 'failed'; entry.endedAt = Date.now(); entry.events.emit('change') })
    child.on('exit', (code, signal) => { entry.exitSeen = true; if (entry.stopping && entry.status !== 'failed') entry.status = 'stopped'; entry.exitCode = code; entry.signal = signal; entry.events.emit('change') })
    child.on('close', (code, signal) => { runCleanup(); if (entry.status !== 'failed') entry.status = entry.stopping ? 'stopped' : 'exited'; entry.exitCode = code; entry.signal = signal; entry.endedAt = Date.now(); entry.events.emit('change'); this.prune() })
    await new Promise<void>((resolve, reject) => { child.once('spawn', resolve); child.once('error', reject) })
    if (!entry.endedAt) entry.status = 'running'
    return { id: entry.id, status: entry.status }
  }
  async poll(owner: ProcessOwner, id: string, cursor = 0, waitMs = 0, signal?: AbortSignal): Promise<{ id: string; status: ProcessStatus; output: string; cursor: number; truncated: boolean; exitCode: number | null; signal: string | null }> {
    const entry = this.get(owner, id)
    if (!Number.isSafeInteger(cursor) || cursor < 0) throw new Error('Некорректный курсор вывода.')
    if (signal?.aborted) throw new Error('Ожидание отменено.')
    if (!entry.endedAt && cursor >= entry.offset + entry.output.length && waitMs > 0) {
      await new Promise<void>((resolve, reject) => {
        const done = (): void => { clearTimeout(timer); entry.events.removeListener('change', done); signal?.removeEventListener('abort', abort); resolve() }
        const abort = (): void => { clearTimeout(timer); entry.events.removeListener('change', done); signal?.removeEventListener('abort', abort); reject(new Error('Ожидание отменено.')) }
        const timer = setTimeout(done, Math.min(waitMs, 10000))
        entry.events.once('change', done); signal?.addEventListener('abort', abort, { once: true }); if (signal?.aborted) abort()
      })
    }
    const start = Math.max(0, Math.min(cursor - entry.offset, entry.output.length))
    let output = entry.output.slice(start, start + 28000)
    let lineCount = 0
    for (let i = 0; i < output.length; i++) if (output[i] === '\n' && ++lineCount === 200) { output = output.slice(0, i + 1); break }
    if (output.length && /[\uD800-\uDBFF]/.test(output[output.length - 1])) output = output.slice(0, -1)
    return { id, status: entry.status, output, cursor: entry.offset + start + output.length, truncated: cursor < entry.offset, exitCode: entry.exitCode, signal: entry.signal }
  }
  list(owner: ProcessOwner): Array<{ id: string; command: string; cwd: string; status: ProcessStatus }> {
    this.prune(); return [...this.entries.values()].filter(e => this.sameOwner(e.owner, owner)).map(e => ({ id: e.id, command: e.command, cwd: e.cwd, status: e.status }))
  }
  async stop(owner: ProcessOwner, id: string): Promise<void> {
    const entry = this.get(owner, id)
    if (entry.endedAt || entry.exitSeen) return
    if (entry.stopPromise) return entry.stopPromise
    entry.stopping = true
    entry.stopPromise = new Promise<void>((resolve, reject) => {
      const pid = entry.child.pid
      if (!pid) { entry.stopping = false; reject(new Error('Процесс ещё не получил PID.')); return }
      let finished = false
      const finish = (error?: Error): void => { if (finished) return; finished = true; clearTimeout(timer); entry.child.removeListener('exit', exited); if (error) { entry.stopping = false; reject(error) } else resolve() }
      const exited = (): void => finish()
      const timer = setTimeout(() => finish(new Error('Не удалось подтвердить завершение процесса.')), 5000)
      entry.child.once('exit', exited)
      if (entry.endedAt) { finish(); return }
      if (process.platform === 'win32') {
        const killer = spawn('taskkill', ['/pid', String(pid), '/T', '/F'], { windowsHide: true })
        killer.once('error', error => finish(error)); killer.once('close', code => { if (code !== 0 && !entry.endedAt) finish(new Error(`taskkill: код ${code}`)) })
      } else { try { process.kill(-pid, 'SIGKILL') } catch (error) { if (!entry.endedAt) finish(error as Error); else finish() } }
    }).finally(() => { entry.stopPromise = undefined })
    return entry.stopPromise
  }
  async stopRequest(owner: ProcessOwner, requestId: string): Promise<void> { await Promise.allSettled([...this.entries.values()].filter(e => this.sameOwner(e.owner, owner) && e.requestId === requestId && !e.endedAt).map(e => this.stop(owner, e.id))) }
  async stopSenderRequest(senderId: number, requestId: string): Promise<void> { await Promise.allSettled([...this.entries.values()].filter(e => e.owner.senderId === senderId && e.requestId === requestId && !e.endedAt).map(e => this.stop(e.owner, e.id))) }
  async stopSession(senderId: number, sessionId: string): Promise<void> { await Promise.allSettled([...this.entries.values()].filter(e => e.owner.senderId === senderId && e.owner.sessionId === sessionId && !e.endedAt).map(e => this.stop(e.owner, e.id))) }
  async stopSender(senderId: number): Promise<void> { await Promise.allSettled([...this.entries.values()].filter(e => e.owner.senderId === senderId && !e.endedAt).map(e => this.stop(e.owner, e.id))) }
  async shutdown(): Promise<void> { await Promise.allSettled([...this.entries.values()].filter(e => !e.endedAt).map(e => this.stop(e.owner, e.id))) }
}

export const processManager = new ProcessManager()
