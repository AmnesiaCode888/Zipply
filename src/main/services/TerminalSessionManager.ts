import { ChildProcess, execSync } from 'child_process'

function stripAnsi(text: string): string {
  return text.replace(/[\u001b\u009b][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><]/g, '')
}

export interface TerminalCommandEntry {
  id: string
  command: string
  cwd: string
  initiator: 'user' | 'ai'
  timestamp: number
  output: string[]
  exitCode: number | null
}

export interface TerminalSessionInfo {
  id: string
  name: string
  cwd: string
  isAi?: boolean
  isRunning: boolean
  activeRunId: string | null
  activePid?: number
  lastActivity: number
  entries: TerminalCommandEntry[]
}

/**
 * TerminalSessionManager — Centralized Registry of all IDE Terminal Sessions & Processes.
 * Bridges Renderer UI tabs, main process shell runners, and AI agent tools.
 */
export class TerminalSessionManager {
  private static _instance: TerminalSessionManager | null = null

  private sessions: Map<string, TerminalSessionInfo> = new Map()
  private activeProcesses: Map<string, { child: ChildProcess; sessionId: string; runId: string }> = new Map()
  private activeSessionId: string | null = null

  private readonly maxOutputLinesPerEntry = 2000
  private readonly maxEntriesPerSession = 50

  public static getInstance(): TerminalSessionManager {
    if (!TerminalSessionManager._instance) {
      TerminalSessionManager._instance = new TerminalSessionManager()
    }
    return TerminalSessionManager._instance
  }

  /**
   * Reset instance (useful for unit tests).
   */
  public static resetInstance(): void {
    if (TerminalSessionManager._instance) {
      TerminalSessionManager._instance.killAll()
      TerminalSessionManager._instance = null
    }
  }

  // --- Session Registration & Sync ---

  public registerOrUpdateSession(meta: {
    id: string
    name?: string
    cwd?: string
    isAi?: boolean
    isRunning?: boolean
  }): TerminalSessionInfo {
    let session = this.sessions.get(meta.id)
    if (!session) {
      session = {
        id: meta.id,
        name: meta.name || (meta.isAi ? 'AI Terminal' : 'powershell'),
        cwd: meta.cwd || process.cwd(),
        isAi: !!meta.isAi,
        isRunning: !!meta.isRunning,
        activeRunId: null,
        lastActivity: Date.now(),
        entries: []
      }
      this.sessions.set(meta.id, session)
      if (!this.activeSessionId) {
        this.activeSessionId = meta.id
      }
    } else {
      if (meta.name !== undefined) session.name = meta.name
      if (meta.cwd !== undefined) session.cwd = meta.cwd
      if (meta.isAi !== undefined) session.isAi = meta.isAi
      if (meta.isRunning !== undefined) session.isRunning = meta.isRunning
      session.lastActivity = Date.now()
    }
    return session
  }

  public syncFromRenderer(
    rendererSessions: Array<{
      id: string
      name: string
      cwd: string
      isAi?: boolean
      isRunning?: boolean
      activeRunId?: string | null
    }>,
    activeId?: string
  ): void {
    if (activeId) {
      this.activeSessionId = activeId
    }

    const currentIds = new Set(rendererSessions.map((s) => s.id))

    // Prune closed sessions that are not running
    for (const [id, sess] of this.sessions) {
      if (!currentIds.has(id) && !sess.isRunning) {
        this.sessions.delete(id)
      }
    }

    // Update or register
    for (const rSess of rendererSessions) {
      const existing = this.sessions.get(rSess.id)
      if (existing) {
        existing.name = rSess.name
        existing.cwd = rSess.cwd
        existing.isAi = !!rSess.isAi
        if (rSess.isRunning !== undefined) existing.isRunning = rSess.isRunning
        if (rSess.activeRunId !== undefined) existing.activeRunId = rSess.activeRunId
        existing.lastActivity = Date.now()
      } else {
        this.registerOrUpdateSession(rSess)
      }
    }
  }

  public setActiveSessionId(sessionId: string): void {
    if (this.sessions.has(sessionId)) {
      this.activeSessionId = sessionId
    }
  }

  public getActiveSessionId(): string | null {
    return this.activeSessionId
  }

  public removeSession(sessionId: string): void {
    const session = this.sessions.get(sessionId)
    if (session) {
      if (session.activeRunId) {
        this.killProcess(session.activeRunId)
      }
      this.sessions.delete(sessionId)
    }
    if (this.activeSessionId === sessionId) {
      const remaining = Array.from(this.sessions.keys())
      this.activeSessionId = remaining.length > 0 ? remaining[0] : null
    }
  }

  public getSession(sessionId: string): TerminalSessionInfo | undefined {
    return this.sessions.get(sessionId)
  }

  public getAllSessions(): TerminalSessionInfo[] {
    return Array.from(this.sessions.values()).sort((a, b) => b.lastActivity - a.lastActivity)
  }

  // --- Command Execution & Process Lifecycle ---

  public recordCommandStart(params: {
    sessionId: string
    runId: string
    command: string
    cwd: string
    initiator: 'user' | 'ai'
    child?: ChildProcess
    pid?: number
  }): TerminalCommandEntry {
    const session = this.registerOrUpdateSession({
      id: params.sessionId,
      cwd: params.cwd,
      isRunning: true
    })

    session.isRunning = true
    session.activeRunId = params.runId
    session.activePid = params.pid || params.child?.pid
    session.lastActivity = Date.now()
    session.cwd = params.cwd

    if (params.child) {
      this.activeProcesses.set(params.runId, {
        child: params.child,
        sessionId: params.sessionId,
        runId: params.runId
      })
    }

    const entry: TerminalCommandEntry = {
      id: params.runId,
      command: params.command,
      cwd: params.cwd,
      initiator: params.initiator,
      timestamp: Date.now(),
      output: [],
      exitCode: null
    }

    session.entries.push(entry)
    if (session.entries.length > this.maxEntriesPerSession) {
      session.entries.shift()
    }

    return entry
  }

  public appendOutput(runId: string, text: string): void {
    const clean = stripAnsi(text)
    if (!clean) return

    const lines = clean.split(/\r?\n/)

    for (const session of this.sessions.values()) {
      const entry = session.entries.find((e) => e.id === runId)
      if (entry) {
        session.lastActivity = Date.now()
        for (const line of lines) {
          entry.output.push(line)
        }
        if (entry.output.length > this.maxOutputLinesPerEntry) {
          entry.output = entry.output.slice(-this.maxOutputLinesPerEntry)
        }
        return
      }
    }
  }

  public recordCommandExit(runId: string, exitCode: number | null): void {
    this.activeProcesses.delete(runId)

    for (const session of this.sessions.values()) {
      const entry = session.entries.find((e) => e.id === runId)
      if (entry) {
        entry.exitCode = exitCode
        if (session.activeRunId === runId) {
          session.isRunning = false
          session.activeRunId = null
          session.activePid = undefined
        }
        session.lastActivity = Date.now()
        return
      }
    }
  }

  // --- Stdin & Process Management ---

  public sendInput(targetId: string, input: string): { success: boolean; message: string } {
    const cleanInput = input !== undefined ? String(input) : ''
    const textToSend = cleanInput.endsWith('\n') ? cleanInput : cleanInput + '\n'

    // Try finding by runId
    let procEntry = this.activeProcesses.get(targetId)

    // If not found, try finding by sessionId
    if (!procEntry) {
      const session = this.sessions.get(targetId)
      if (session?.activeRunId) {
        procEntry = this.activeProcesses.get(session.activeRunId)
      }
    }

    // If still not found, try active session
    if (!procEntry && (!targetId || targetId === 'active')) {
      if (this.activeSessionId) {
        const session = this.sessions.get(this.activeSessionId)
        if (session?.activeRunId) {
          procEntry = this.activeProcesses.get(session.activeRunId)
        }
      }
    }

    if (!procEntry || !procEntry.child || !procEntry.child.stdin || procEntry.child.stdin.destroyed) {
      return {
        success: false,
        message: `No running interactive process found for target '${targetId}'.`
      }
    }

    try {
      procEntry.child.stdin.write(textToSend, 'utf8')
      this.appendOutput(procEntry.runId, `[stdin]: ${cleanInput}`)
      return {
        success: true,
        message: `Input sent to process ${procEntry.runId}.`
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      return {
        success: false,
        message: `Failed to write to stdin: ${msg}`
      }
    }
  }

  public killProcess(targetId: string): boolean {
    let procEntry = this.activeProcesses.get(targetId)
    if (!procEntry) {
      const session = this.sessions.get(targetId)
      if (session?.activeRunId) {
        procEntry = this.activeProcesses.get(session.activeRunId)
      }
    }

    if (!procEntry || !procEntry.child) return false

    const child = procEntry.child
    const isWin = process.platform === 'win32'

    if (isWin && child.pid) {
      try {
        execSync(`taskkill /F /T /PID ${child.pid}`, { stdio: 'ignore' })
      } catch {
        try { child.kill('SIGKILL') } catch {}
      }
    } else if (child.pid) {
      try {
        process.kill(-child.pid, 'SIGKILL')
      } catch {
        try { child.kill('SIGKILL') } catch {}
      }
    } else {
      try { child.kill() } catch {}
    }

    this.recordCommandExit(procEntry.runId, 130)
    return true
  }

  public killAll(): void {
    for (const [runId] of this.activeProcesses) {
      this.killProcess(runId)
    }
    this.activeProcesses.clear()
  }

  // --- AI Inspection Queries ---

  public listTerminals(): string {
    const list = this.getAllSessions()
    if (list.length === 0) {
      return 'No terminal sessions currently open in IDE.'
    }

    let out = `Open IDE Terminal Sessions (${list.length}):\n\n`
    for (const sess of list) {
      const isCurrentActive = sess.id === this.activeSessionId ? ' [ACTIVE TAB]' : ''
      const statusLabel = sess.isRunning
        ? `RUNNING (PID: ${sess.activePid || 'unknown'}, RunID: ${sess.activeRunId})`
        : 'IDLE'
      const typeLabel = sess.isAi ? 'AI Tab' : 'User Tab'

      out += `• Session: "${sess.name}" (ID: ${sess.id})${isCurrentActive}\n`
      out += `  Type: ${typeLabel} | Status: ${statusLabel}\n`
      out += `  CWD: ${sess.cwd}\n`

      if (sess.entries.length > 0) {
        const lastEntry = sess.entries[sess.entries.length - 1]
        const initiatorLabel = lastEntry.initiator === 'user' ? '[USER]' : '[AI]'
        const exitStatus = lastEntry.exitCode !== null ? `exit ${lastEntry.exitCode}` : 'running'
        out += `  Last Command: ${initiatorLabel} ${lastEntry.command} (${exitStatus})\n`
        out += `  Total Commands Executed: ${sess.entries.length}\n`
      } else {
        out += `  Commands: (no commands executed yet)\n`
      }
      out += '\n'
    }

    return out.trim()
  }

  public readTerminalOutput(sessionId?: string, maxLines = 120): string {
    const targetSessionId = sessionId && sessionId !== 'active' && sessionId !== 'last'
      ? sessionId
      : this.activeSessionId || this.getAllSessions()[0]?.id

    if (!targetSessionId) {
      return 'No terminal sessions available to read.'
    }

    if (sessionId === 'all') {
      const all = this.getAllSessions()
      if (all.length === 0) return 'No terminal sessions available.'
      return all.map((s) => this._formatSessionOutput(s, Math.floor(maxLines / all.length) || 30)).join('\n\n' + '='.repeat(60) + '\n\n')
    }

    const session = this.sessions.get(targetSessionId)
    if (!session) {
      return `Terminal session '${targetSessionId}' not found. Use action="list_terminals" to see open terminals.`
    }

    return this._formatSessionOutput(session, maxLines)
  }

  private _formatSessionOutput(session: TerminalSessionInfo, maxLines: number): string {
    const statusLabel = session.isRunning ? `RUNNING (PID: ${session.activePid || '?'})` : 'IDLE'
    let out = `=== Terminal Tab: "${session.name}" (ID: ${session.id}) ===\n`
    out += `CWD: ${session.cwd} | Status: ${statusLabel} | Type: ${session.isAi ? 'AI Terminal' : 'User Terminal'}\n`

    if (session.entries.length === 0) {
      out += `\n(No commands have been run in this terminal tab yet)`
      return out
    }

    out += `\nCommand History (${session.entries.length} commands):\n`

    for (let i = 0; i < session.entries.length; i++) {
      const entry = session.entries[i]
      const initiatorTag = entry.initiator === 'user' ? '[USER INPUT]' : '[AI COMMAND]'
      const timeStr = new Date(entry.timestamp).toLocaleTimeString('ru-RU')
      const exitStr = entry.exitCode !== null ? `Exit Code: ${entry.exitCode}` : 'Still running'

      out += `\n--- [${i + 1}/${session.entries.length}] ${initiatorTag} at ${timeStr} in ${entry.cwd} ---\n`
      out += `> ${entry.command}\n`
      out += `Status: ${exitStr}\n`

      if (entry.output.length > 0) {
        const slice = entry.output.slice(-maxLines)
        out += `Output (${slice.length} lines):\n`
        out += slice.join('\n') + '\n'
      } else {
        out += `Output: (no output)\n`
      }
    }

    return out.trim()
  }
}
