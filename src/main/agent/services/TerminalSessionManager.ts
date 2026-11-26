import { ChildProcess, spawn } from 'child_process'
import { randomUUID } from 'crypto'
import { EventEmitter } from 'events'
import * as fs from 'fs/promises'
import * as path from 'path'
import { StringDecoder } from 'string_decoder'
import type {
  TerminalEvent,
  TerminalOwner,
  TerminalSessionOrigin,
  TerminalSessionSnapshot,
  TerminalSessionStatus,
  TerminalSessionSummary,
  TerminalShellPreference
} from '../../../shared/terminal'
import { isTerminalLive } from '../../../shared/terminal'
import type { SandboxPolicy, SandboxProfile } from '../../../shared/sandbox'
import { formatForLlm, normalizeTerminalText } from './TerminalOutputNormalizer'
import { ProcessSandbox, processSandbox } from './ProcessSandbox'
import { applyDependencyEnvironment } from './DependencyEnvironment'
import { CMD_SOURCE_ENV, commandShellArgs, interactiveShellArgs, resolveTerminalShell } from './TerminalShell'

interface PtyLike {
  pid: number
  write(data: string): void
  resize(cols: number, rows: number): void
  kill(signal?: string): void
  onData(listener: (data: string) => void): { dispose(): void }
  onExit(listener: (e: { exitCode: number; signal?: number }) => void): { dispose(): void }
}

interface NodePtyModule {
  spawn(
    file: string,
    args: string[] | string,
    options: { name?: string; cols?: number; rows?: number; cwd?: string; env?: Record<string, string> }
  ): PtyLike
}

interface SessionEntry {
  id: string
  owner: TerminalOwner
  requestId?: string
  toolCallId?: string
  origin: TerminalSessionOrigin
  background?: boolean
  sandboxProfile?: SandboxProfile
  title: string
  command: string
  cwd: string
  shell: string
  tty: boolean
  status: TerminalSessionStatus
  exitCode: number | null
  signal: string | null
  startedAt: number
  endedAt?: number
  rawBuffer: string
  rawOffset: number
  llmCursor: number
  pty?: PtyLike
  child?: ChildProcess
  sandboxCleanup?: () => Promise<void>
  cleanupPromise?: Promise<void>
  events: EventEmitter
  stopping: boolean
  exitSeen: boolean
  stopPromise?: Promise<void>
  closeFallbackTimer?: NodeJS.Timeout
}

export interface StartCommandOptions {
  owner: TerminalOwner
  command: string
  cwd: string
  requestId?: string
  toolCallId?: string
  shellPreference?: TerminalShellPreference
  title?: string
  background?: boolean
  autoBackground?: boolean
  yieldTimeMs?: number
  tty?: boolean
  cols?: number
  rows?: number
  maxLines?: number
  maxChars?: number
  dependencyPaths?: string[]
  sandbox?: SandboxPolicy
  abortSignal?: AbortSignal
  onSession?: (session: TerminalSessionSummary) => void
  onOutput?: (delta: string) => void
}

export interface CommandStepResult {
  session: TerminalSessionSummary
  output: string
  rawCursor: number
  truncated: boolean
  logPath?: string
}

const MAX_RAW_BUFFER = 512 * 1024
const RETENTION_MS = 30 * 60 * 1000
const MAX_RETAINED_ENDED = 30
const MAX_LIVE_GLOBAL = 24
const MAX_LIVE_PER_OWNER = 8
const QUIET_WINDOW_MS = 180

const SENSITIVE_ENV_RE = /(?:^|_)(?:API_KEY|SECRET|TOKEN|PASSWORD|PASSWD|PRIVATE_KEY|COOKIE|CREDENTIAL|AUTH)$/i

let cachedPtyModule: NodePtyModule | null | undefined

function loadNodePty(): NodePtyModule | null {
  if (cachedPtyModule !== undefined) return cachedPtyModule
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require('node-pty') as NodePtyModule
    cachedPtyModule = typeof mod?.spawn === 'function' ? mod : null
  } catch {
    cachedPtyModule = null
  }
  return cachedPtyModule
}

export function detectDefaultShell(): { shell: string; name: string } {
  return resolveTerminalShell('auto')
}

export function sanitizeEnv(
  baseEnv: NodeJS.ProcessEnv,
  tty: boolean,
  nonInteractiveAi = true
): Record<string, string> {
  const result: Record<string, string> = {}
  for (const [key, value] of Object.entries(baseEnv)) {
    if (typeof value !== 'string') continue
    if (SENSITIVE_ENV_RE.test(key)) continue
    if (key === 'NODE_TEST_CONTEXT') continue
    result[key] = value
  }
  result.PYTHONIOENCODING = 'utf-8'
  result.TERM = tty ? 'xterm-256color' : 'dumb'
  if (tty) {
    result.COLORTERM = 'truecolor'
  }
  if (nonInteractiveAi) {
    result.CI = 'true'
    result.DEBIAN_FRONTEND = 'noninteractive'
    if (!tty) {
      result.NO_COLOR = '1'
      result.FORCE_COLOR = '0'
    }
  }
  return result
}

function summarizeCommandTitle(command: string, fallback: string): string {
  const clean = command.trim().replace(/\s+/g, ' ')
  if (!clean) return fallback
  return clean.length > 36 ? `${clean.slice(0, 35)}…` : clean
}

export class TerminalSessionManager extends EventEmitter {
  private entries = new Map<string, SessionEntry>()
  private readonly forceSpawnFallback: boolean
  private readonly sandbox: ProcessSandbox
  private logDir: string | null = null
  private logQueues = new Map<string, Promise<void>>()

  constructor(options?: { forceSpawnFallback?: boolean; logDir?: string; sandbox?: ProcessSandbox }) {
    super()
    this.setMaxListeners(0)
    this.forceSpawnFallback = Boolean(options?.forceSpawnFallback)
    this.sandbox = options?.sandbox ?? processSandbox
    if (options?.logDir) this.logDir = options.logDir
  }

  setLogDirectory(dir: string): void {
    this.logDir = dir
  }

  private aiLogPath(sessionId: string): string | null {
    if (!this.logDir || !sessionId) return null
    const safe = sessionId.replace(/[^a-zA-Z0-9._-]/g, '_')
    return path.join(this.logDir, `${safe}.log`)
  }

  private appendAiLog(sessionId: string, chunk: string): void {
    const filePath = this.aiLogPath(sessionId)
    if (!filePath || !chunk) return
    const prev = this.logQueues.get(sessionId) || Promise.resolve()
    const next = prev
      .catch(() => {})
      .then(async () => {
        await fs.mkdir(path.dirname(filePath), { recursive: true })
        await fs.appendFile(filePath, chunk, 'utf8')
        const stat = await fs.stat(filePath).catch(() => null)
        if (stat && stat.size > 2 * 1024 * 1024) {
          const content = await fs.readFile(filePath, 'utf8')
          await fs.writeFile(filePath, content.slice(-1024 * 1024), 'utf8')
        }
      })
      .catch(() => {})
    this.logQueues.set(sessionId, next)
    void next.finally(() => {
      if (this.logQueues.get(sessionId) === next) this.logQueues.delete(sessionId)
    })
  }

  async getAiLog(sessionId: string): Promise<string> {
    const pending = this.logQueues.get(sessionId)
    if (pending) await pending
    const filePath = this.aiLogPath(sessionId)
    if (filePath) {
      try {
        return await fs.readFile(filePath, 'utf8')
      } catch {
        // Fall back to in-memory buffers if file doesn't exist yet
      }
    }
    return [...this.entries.values()]
      .filter((e) => e.origin === 'ai' && e.owner.sessionId === sessionId)
      .sort((a, b) => a.startedAt - b.startedAt)
      .map((e) => e.rawBuffer)
      .join('')
  }

  private sameOwner(a: TerminalOwner, b: TerminalOwner): boolean {
    return (
      a.senderId === b.senderId &&
      a.sessionId === b.sessionId &&
      path.resolve(a.workspace) === path.resolve(b.workspace)
    )
  }

  private getEntry(owner: TerminalOwner, id: string): SessionEntry {
    const entry = this.entries.get(id)
    if (!entry || !this.sameOwner(owner, entry.owner)) {
      throw new Error('Терминальная сессия не найдена в текущем чате и рабочей папке.')
    }
    return entry
  }

  private toSummary(entry: SessionEntry): TerminalSessionSummary {
    return {
      id: entry.id,
      origin: entry.origin,
      ...(entry.background ? { background: true } : {}),
      ...(entry.sandboxProfile ? { sandboxProfile: entry.sandboxProfile } : {}),
      title: entry.title,
      command: entry.command,
      cwd: entry.cwd,
      shell: entry.shell,
      tty: entry.tty,
      status: entry.status,
      exitCode: entry.exitCode,
      signal: entry.signal,
      startedAt: entry.startedAt,
      ...(entry.endedAt !== undefined ? { endedAt: entry.endedAt } : {}),
      ...(entry.toolCallId ? { toolCallId: entry.toolCallId } : {})
    }
  }

  private emitTerminalEvent(owner: TerminalOwner, event: TerminalEvent): void {
    this.emit('terminal_event', owner, event)
  }

  private emitState(entry: SessionEntry): void {
    this.emitTerminalEvent(entry.owner, {
      type: 'session_state',
      terminalId: entry.id,
      status: entry.status,
      exitCode: entry.exitCode,
      signal: entry.signal,
      endedAt: entry.endedAt,
      background: entry.background
    })
  }

  private prune(): void {
    const now = Date.now()
    for (const [id, entry] of this.entries) {
      if (entry.endedAt && now - entry.endedAt > RETENTION_MS) {
        this.entries.delete(id)
        this.emitTerminalEvent(entry.owner, { type: 'session_closed', terminalId: id })
      }
    }
    const ended = [...this.entries.values()]
      .filter((e) => e.endedAt !== undefined)
      .sort((a, b) => (a.endedAt || 0) - (b.endedAt || 0))
    for (const entry of ended.slice(0, Math.max(0, ended.length - MAX_RETAINED_ENDED))) {
      this.entries.delete(entry.id)
      this.emitTerminalEvent(entry.owner, { type: 'session_closed', terminalId: entry.id })
    }
  }

  private checkLimits(owner: TerminalOwner): void {
    this.prune()
    const live = [...this.entries.values()].filter((e) => !e.endedAt)
    if (live.length >= MAX_LIVE_GLOBAL || live.filter((e) => this.sameOwner(e.owner, owner)).length >= MAX_LIVE_PER_OWNER) {
      throw new Error('Достигнут лимит активных терминальных сессий. Закройте неиспользуемые терминалы.')
    }
  }

  private appendRaw(entry: SessionEntry, chunk: string): void {
    if (!chunk) return
    entry.rawBuffer += chunk
    if (entry.rawBuffer.length > MAX_RAW_BUFFER) {
      const drop = entry.rawBuffer.length - MAX_RAW_BUFFER
      entry.rawBuffer = entry.rawBuffer.slice(drop)
      entry.rawOffset += drop
    }
    if (entry.origin === 'ai') {
      this.appendAiLog(entry.owner.sessionId, chunk)
    }
    const cursor = entry.rawOffset + entry.rawBuffer.length
    entry.events.emit('data', chunk)
    this.emitTerminalEvent(entry.owner, {
      type: 'session_output',
      terminalId: entry.id,
      chunk,
      cursor
    })
  }

  private finalizeEntry(
    entry: SessionEntry,
    status: TerminalSessionStatus,
    exitCode: number | null,
    signal: string | null
  ): void {
    if (entry.endedAt !== undefined) return
    if (entry.closeFallbackTimer) {
      clearTimeout(entry.closeFallbackTimer)
      entry.closeFallbackTimer = undefined
    }
    entry.exitSeen = true
    entry.status = status
    entry.exitCode = exitCode
    entry.signal = signal
    entry.endedAt = Date.now()
    if (entry.sandboxCleanup && !entry.cleanupPromise) {
      entry.cleanupPromise = entry.sandboxCleanup().catch(() => {})
    }
    if (entry.origin === 'ai') {
      const footer = `\x1b[2m[код ${exitCode ?? -1}]\x1b[0m\r\n\r\n`
      entry.rawBuffer += footer
      this.appendAiLog(entry.owner.sessionId, footer)
      this.emitTerminalEvent(entry.owner, {
        type: 'session_output',
        terminalId: entry.id,
        chunk: footer,
        cursor: entry.rawOffset + entry.rawBuffer.length
      })
    }
    entry.events.emit('end')
    this.emitState(entry)
    this.prune()
  }

  private spawnBackend(
    entry: SessionEntry,
    shell: string,
    args: string[] | string,
    env: Record<string, string>,
    cols: number,
    rows: number,
    preferPty: boolean
  ): void {
    const ptyMod = !this.forceSpawnFallback && preferPty ? loadNodePty() : null
    if (ptyMod) {
      try {
        const ptyProc = ptyMod.spawn(shell, args, {
          name: 'xterm-256color',
          cols,
          rows,
          cwd: entry.cwd,
          env
        })
        entry.pty = ptyProc
        entry.tty = true
        entry.status = 'running'
        ptyProc.onData((data) => this.appendRaw(entry, data))
        ptyProc.onExit(({ exitCode, signal }) => {
          const finalStatus: TerminalSessionStatus = entry.stopping ? 'stopped' : 'exited'
          this.finalizeEntry(entry, finalStatus, exitCode ?? null, signal ? String(signal) : null)
        })
        this.emitState(entry)
        return
      } catch {
        // Fall through to child_process.spawn
      }
    }

    const isWin = process.platform === 'win32'
    const onSpawnError = (error: Error): void => {
      this.appendRaw(entry, `\r\nОшибка запуска: ${error.message}\r\n`)
      this.finalizeEntry(entry, 'failed', -1, null)
    }
    let child: ChildProcess
    try {
      child = spawn(shell, typeof args === 'string' ? [args] : args, {
        cwd: entry.cwd,
        env,
        detached: !isWin,
        windowsHide: true,
        windowsVerbatimArguments: typeof args === 'string',
        stdio: ['pipe', 'pipe', 'pipe']
      })
    } catch (error) {
      onSpawnError(error instanceof Error ? error : new Error(String(error)))
      return
    }
    entry.child = child
    entry.tty = false

    const wireStream = (stream: NodeJS.ReadableStream | null): void => {
      if (!stream) return
      const decoder = new StringDecoder('utf8')
      stream.on('data', (buf: Buffer) => this.appendRaw(entry, decoder.write(buf)))
      stream.on('end', () => {
        const rest = decoder.end()
        if (rest) this.appendRaw(entry, rest)
      })
    }
    wireStream(child.stdout)
    wireStream(child.stderr)

    child.on('spawn', () => {
      if (!entry.endedAt) {
        entry.status = 'running'
        this.emitState(entry)
      }
    })
    child.on('error', onSpawnError)
    child.on('exit', (code, signal) => {
      entry.exitSeen = true
      entry.exitCode = code
      entry.signal = signal
      // Guard against orphaned children holding stdio handles open forever
      if (!entry.endedAt && !entry.closeFallbackTimer) {
        entry.closeFallbackTimer = setTimeout(() => {
          if (!entry.endedAt) {
            const finalStatus: TerminalSessionStatus = entry.stopping ? 'stopped' : 'exited'
            this.finalizeEntry(entry, finalStatus, code, signal)
          }
        }, 500)
      }
    })
    child.on('close', (code, signal) => {
      if (entry.status !== 'failed') {
        const finalStatus: TerminalSessionStatus = entry.stopping ? 'stopped' : 'exited'
        this.finalizeEntry(entry, finalStatus, code, signal)
      }
    })
  }

  async startCommand(options: StartCommandOptions): Promise<CommandStepResult> {
    this.checkLimits(options.owner)
    const selectedShell = resolveTerminalShell(options.shellPreference)
    const { shell, name } = selectedShell
    const yieldTimeMs = options.background ? 0 : Math.max(0, Math.min(60000, options.yieldTimeMs ?? 5000))
    const preferPty = options.tty === true
    const cols = options.cols ?? 120
    const rows = options.rows ?? 32
    const sandboxPolicy: SandboxPolicy = options.sandbox ?? {
      profile: 'workspace-write',
      network: 'off',
      writableRoots: [path.resolve(options.owner.workspace || options.cwd)]
    }
    const baseEnv = sanitizeEnv(process.env, preferPty, true)
    applyDependencyEnvironment(baseEnv, options.dependencyPaths)
    if (selectedShell.kind === 'cmd') baseEnv[CMD_SOURCE_ENV] = options.command
    const rawArgs = commandShellArgs(selectedShell, options.command)
    const prepared = await this.sandbox.prepareSpawn({
      shell,
      args: rawArgs,
      cwd: options.cwd,
      workspaceRoot: options.owner.workspace || options.cwd,
      env: baseEnv,
      policy: sandboxPolicy
    })
    try {
      if (options.abortSignal?.aborted) throw new Error('Команда отменена пользователем.')
      this.checkLimits(options.owner)
    } catch (error) {
      await prepared.cleanup?.().catch(() => {})
      throw error
    }
    const effectivePty = prepared.sandboxed ? false : preferPty

    const entry: SessionEntry = {
      id: randomUUID(),
      owner: options.owner,
      requestId: options.requestId,
      toolCallId: options.toolCallId,
      origin: 'ai',
      background: options.background === true,
      sandboxProfile: sandboxPolicy.profile,
      title: options.title?.trim().replace(/\s+/g, ' ').slice(0, 72) || summarizeCommandTitle(options.command, name),
      command: options.command,
      cwd: options.cwd,
      shell: name,
      tty: effectivePty,
      status: 'starting',
      exitCode: null,
      signal: null,
      startedAt: Date.now(),
      rawBuffer: '',
      rawOffset: 0,
      llmCursor: 0,
      sandboxCleanup: prepared.cleanup,
      events: new EventEmitter(),
      stopping: false,
      exitSeen: false
    }
    entry.events.setMaxListeners(0)
    this.entries.set(entry.id, entry)
    const summary = this.toSummary(entry)
    this.emitTerminalEvent(entry.owner, { type: 'session_created', session: summary })
    options.onSession?.(summary)

    // Emit command banner into raw buffer so xterm shows what the AI ran
    this.appendRaw(entry, `\x1b[2m$ ${options.command}\x1b[0m\r\n`)
    const bannerEnd = entry.rawOffset + entry.rawBuffer.length
    entry.llmCursor = bannerEnd

    this.spawnBackend(entry, prepared.command, prepared.windowsCommandLine ?? prepared.args, prepared.env, cols, rows, effectivePty)

    const onDataForward = (chunk: string): void => {
      options.onOutput?.(normalizeTerminalText(chunk))
    }
    if (options.onOutput) entry.events.on('data', onDataForward)

    try {
      await this.waitForYield(entry, yieldTimeMs, false, options.abortSignal)
    } catch (err) {
      if (options.abortSignal?.aborted) {
        await this.sendSignal(options.owner, entry.id, 'SIGKILL').catch(() => {})
      }
      throw err
    } finally {
      if (options.onOutput) entry.events.removeListener('data', onDataForward)
    }

    if (options.autoBackground && !entry.background && isTerminalLive(entry.status)) {
      entry.background = true
      this.emitState(entry)
    }
    return await this.collectLlmOutput(entry, undefined, options.maxLines, options.maxChars)
  }

  async startInteractiveShell(
    owner: TerminalOwner,
    cwd: string,
    cols = 100,
    rows = 28,
    shellPreference?: TerminalShellPreference
  ): Promise<TerminalSessionSnapshot> {
    this.checkLimits(owner)
    const selectedShell = resolveTerminalShell(shellPreference)
    const { shell, name } = selectedShell
    const entry: SessionEntry = {
      id: randomUUID(),
      owner,
      origin: 'user',
      title: name,
      command: '',
      cwd,
      shell: name,
      tty: true,
      status: 'starting',
      exitCode: null,
      signal: null,
      startedAt: Date.now(),
      rawBuffer: '',
      rawOffset: 0,
      llmCursor: 0,
      events: new EventEmitter(),
      stopping: false,
      exitSeen: false
    }
    entry.events.setMaxListeners(0)
    this.entries.set(entry.id, entry)
    this.emitTerminalEvent(entry.owner, { type: 'session_created', session: this.toSummary(entry) })

    const env = sanitizeEnv(process.env, true, false)
    const args = interactiveShellArgs(selectedShell)
    this.spawnBackend(entry, shell, args, env, cols, rows, true)

    return this.attach(owner, entry.id)
  }

  private waitForYield(
    entry: SessionEntry,
    yieldTimeMs: number,
    useQuietWindow: boolean,
    abortSignal?: AbortSignal
  ): Promise<void> {
    if (entry.endedAt !== undefined || yieldTimeMs <= 0) return Promise.resolve()
    if (abortSignal?.aborted) return Promise.reject(new Error('Операция отменена пользователем.'))

    return new Promise<void>((resolve, reject) => {
      let quietTimer: NodeJS.Timeout | undefined
      const cleanup = (): void => {
        clearTimeout(maxTimer)
        if (quietTimer) clearTimeout(quietTimer)
        entry.events.removeListener('end', onEnd)
        entry.events.removeListener('data', onData)
        abortSignal?.removeEventListener('abort', onAbort)
      }
      const onEnd = (): void => {
        cleanup()
        resolve()
      }
      const onData = (): void => {
        if (!useQuietWindow) return
        if (quietTimer) clearTimeout(quietTimer)
        quietTimer = setTimeout(() => {
          cleanup()
          resolve()
        }, QUIET_WINDOW_MS)
      }
      const onAbort = (): void => {
        cleanup()
        reject(new Error('Операция отменена пользователем.'))
      }
      const maxTimer = setTimeout(() => {
        cleanup()
        resolve()
      }, yieldTimeMs)

      entry.events.once('end', onEnd)
      if (useQuietWindow) entry.events.on('data', onData)
      abortSignal?.addEventListener('abort', onAbort, { once: true })
    })
  }

  private async collectLlmOutput(
    entry: SessionEntry,
    tailLines?: number,
    maxLines?: number,
    maxChars?: number
  ): Promise<CommandStepResult> {
    const startIdx = Math.max(0, Math.min(entry.llmCursor - entry.rawOffset, entry.rawBuffer.length))
    let rawSlice = entry.rawBuffer.slice(startIdx)
    entry.llmCursor = entry.rawOffset + entry.rawBuffer.length

    if (typeof tailLines === 'number' && tailLines > 0) {
      const normalized = normalizeTerminalText(entry.rawBuffer)
      const lines = normalized.split('\n')
      rawSlice = lines.slice(-tailLines).join('\n')
    }

    const effectiveMaxLines = maxLines ?? (typeof tailLines === 'number' && tailLines > 0 ? Math.max(220, tailLines) : undefined)
    const effectiveMaxChars = maxChars ?? (typeof tailLines === 'number' && tailLines > 0 ? Math.max(16000, Math.min(34000, tailLines * 120)) : undefined)
    if (entry.cleanupPromise) {
      await entry.cleanupPromise
    }
    const formatted = await formatForLlm(rawSlice, { sessionId: entry.id, maxLines: effectiveMaxLines, maxChars: effectiveMaxChars })
    return {
      session: this.toSummary(entry),
      output: formatted.text,
      rawCursor: entry.rawOffset + entry.rawBuffer.length,
      truncated: formatted.truncated,
      logPath: formatted.logPath
    }
  }

  async writeInput(
    owner: TerminalOwner,
    id: string,
    chars: string,
    options?: { yieldTimeMs?: number; tailLines?: number; maxLines?: number; maxChars?: number; signal?: 'SIGINT' | 'SIGKILL' },
    abortSignal?: AbortSignal
  ): Promise<CommandStepResult> {
    const entry = this.getEntry(owner, id)
    if (options?.signal) {
      await this.sendSignal(owner, id, options.signal)
      return await this.collectLlmOutput(entry, options.tailLines, options.maxLines, options.maxChars)
    }

    if (chars && !entry.endedAt) {
      if (entry.pty) {
        entry.pty.write(chars)
      } else if (entry.child?.stdin && !entry.child.stdin.destroyed) {
        entry.child.stdin.write(chars)
      }
    }

    const yieldTimeMs = Math.max(0, Math.min(30000, options?.yieldTimeMs ?? 2000))
    if (!entry.endedAt && yieldTimeMs > 0) {
      const hasUnread = entry.rawOffset + entry.rawBuffer.length > entry.llmCursor
      if (!hasUnread || chars.length > 0) {
        await this.waitForYield(entry, yieldTimeMs, true, abortSignal)
      }
    }

    return await this.collectLlmOutput(entry, options?.tailLines, options?.maxLines, options?.maxChars)
  }

  writeUserInput(owner: TerminalOwner, id: string, chars: string): void {
    const entry = this.getEntry(owner, id)
    if (entry.endedAt) return
    if (entry.pty) {
      entry.pty.write(chars)
    } else if (entry.child?.stdin && !entry.child.stdin.destroyed) {
      entry.child.stdin.write(chars.replace(/\r\n|\r/g, process.platform === 'win32' ? '\r\n' : '\n'))
    }
  }

  resize(owner: TerminalOwner, id: string, cols: number, rows: number): void {
    const entry = this.getEntry(owner, id)
    if (entry.endedAt || !entry.pty) return
    const safeCols = Math.max(20, Math.min(500, Math.floor(cols)))
    const safeRows = Math.max(5, Math.min(200, Math.floor(rows)))
    try {
      entry.pty.resize(safeCols, safeRows)
    } catch {
      // Ignore resize race while exiting
    }
  }

  async sendSignal(owner: TerminalOwner, id: string, signal: 'SIGINT' | 'SIGKILL'): Promise<void> {
    const entry = this.getEntry(owner, id)
    if (entry.endedAt || entry.exitSeen) return

    if (signal === 'SIGINT') {
      if (entry.pty) {
        try {
          entry.pty.write('\x03')
        } catch {}
      } else if (entry.child?.pid) {
        try {
          if (process.platform === 'win32') {
            entry.child.kill('SIGINT')
          } else {
            process.kill(-entry.child.pid, 'SIGINT')
          }
        } catch {}
      }
      await this.waitForYield(entry, 1500, false)
      return
    }

    if (entry.stopPromise) return entry.stopPromise
    entry.stopping = true
    entry.stopPromise = new Promise<void>((resolve) => {
      const finish = (): void => {
        clearTimeout(timer)
        entry.events.removeListener('end', finish)
        resolve()
      }
      const timer = setTimeout(() => {
        if (!entry.endedAt) this.finalizeEntry(entry, 'stopped', entry.exitCode, 'SIGKILL')
        finish()
      }, 3000)
      entry.events.once('end', finish)

      const pid = entry.pty?.pid ?? entry.child?.pid
      if (entry.pty) {
        try {
          entry.pty.kill()
        } catch {}
      }
      if (pid) {
        if (process.platform === 'win32') {
          try {
            const killer = spawn('taskkill.exe', ['/pid', String(pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' })
            const killShell = () => { try { entry.child?.kill('SIGKILL') } catch {} }
            killer.once('error', killShell)
            killer.once('exit', (code) => { if (code !== 0) killShell() })
          } catch {
            try { entry.child?.kill('SIGKILL') } catch {}
          }
        } else {
          try {
            process.kill(-pid, 'SIGKILL')
          } catch {
            try {
              process.kill(pid, 'SIGKILL')
            } catch {}
          }
        }
      } else {
        this.finalizeEntry(entry, 'stopped', null, 'SIGKILL')
      }
    }).finally(() => {
      entry.stopPromise = undefined
    })
    return entry.stopPromise
  }

  attach(owner: TerminalOwner, id: string): TerminalSessionSnapshot {
    const entry = this.getEntry(owner, id)
    return {
      ...this.toSummary(entry),
      rawBuffer: entry.rawBuffer,
      rawCursor: entry.rawOffset + entry.rawBuffer.length
    }
  }

  list(owner: TerminalOwner): TerminalSessionSummary[] {
    this.prune()
    return [...this.entries.values()]
      .filter((e) => this.sameOwner(e.owner, owner))
      .sort((a, b) => a.startedAt - b.startedAt)
      .map((e) => this.toSummary(e))
  }

  async close(owner: TerminalOwner, id: string): Promise<void> {
    const entry = this.getEntry(owner, id)
    if (!entry.endedAt) {
      await this.sendSignal(owner, id, 'SIGKILL')
    }
    this.entries.delete(id)
    this.emitTerminalEvent(entry.owner, { type: 'session_closed', terminalId: id })
  }

  async stopRequest(senderId: number, requestId: string): Promise<void> {
    const targets = [...this.entries.values()].filter(
      (e) => e.owner.senderId === senderId && e.requestId === requestId && !e.endedAt
    )
    await Promise.allSettled(targets.map((e) => this.sendSignal(e.owner, e.id, 'SIGKILL')))
  }

  async stopSession(senderId: number, sessionId: string): Promise<void> {
    const targets = [...this.entries.values()].filter(
      (e) => e.owner.senderId === senderId && e.owner.sessionId === sessionId
    )
    await Promise.allSettled(targets.map((e) => this.close(e.owner, e.id)))
  }

  async stopSender(senderId: number): Promise<void> {
    const targets = [...this.entries.values()].filter((e) => e.owner.senderId === senderId)
    await Promise.allSettled(targets.map((e) => this.close(e.owner, e.id)))
  }

  async shutdown(): Promise<void> {
    const targets = [...this.entries.values()].filter((e) => !e.endedAt)
    await Promise.allSettled(targets.map((e) => this.sendSignal(e.owner, e.id, 'SIGKILL')))
    const cleanups = [...this.entries.values()].map((e) => e.cleanupPromise).filter(Boolean)
    await Promise.allSettled(cleanups)
    await Promise.allSettled([...this.logQueues.values()])
    this.entries.clear()
  }
}

export const terminalSessionManager = new TerminalSessionManager()
