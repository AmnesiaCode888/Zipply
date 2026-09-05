import { exec, spawn, execSync, ChildProcess } from 'child_process'
import path from 'path'
import * as fs from 'fs'
import { ToolBase, ToolParameterDef, ToolResult, ProgressCallback } from './ToolBase'
import { Blackboard } from '../core/Blackboard'
import { TerminalSessionManager } from '../../services/TerminalSessionManager'

function stripAnsi(text: string): string {
  return text.replace(/[\u001b\u009b][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><]/g, '')
}

function notifyRenderer(channel: string, data: any): void {
  try {
    const electron = require('electron')
    const BrowserWindow = electron.BrowserWindow || electron.remote?.BrowserWindow
    if (BrowserWindow && typeof BrowserWindow.getAllWindows === 'function') {
      const windows = BrowserWindow.getAllWindows()
      for (const win of windows) {
        if (!win.isDestroyed() && win.webContents) {
          win.webContents.send(channel, data)
        }
      }
    }
  } catch {
    // In headless test environments, safely no-op
  }
}

export interface ManagedProcess {
  id: string
  pid?: number
  command: string
  cwd: string
  workspaceRoot: string
  ownerRunId: string
  child: ChildProcess
  status: 'running' | 'exited' | 'killed'
  exitCode: number | string | null
  startTime: number
  lastActivityAt: number
  logs: string[]
  bytesReceived: number
}

/**
 * ProcessRegistry keeps background processes available across chat turns, but
 * does not grow forever. Exited processes are retained for a short period so
 * their logs can still be inspected, then pruned automatically.
 */
class ProcessRegistry {
  private processes: Map<string, ManagedProcess> = new Map()
  private counter = 0
  private readonly maxEntries = 100
  private readonly exitedRetentionMs = 30 * 60 * 1000

  createId(): string {
    this.counter++
    return `bg_${this.counter}`
  }

  add(id: string, procObj: ManagedProcess): void {
    this.cleanup()
    this.processes.set(id, procObj)
    this.enforceLimit()
  }

  get(idOrPid: string, workspaceRoot?: string): ManagedProcess | null {
    this.cleanup()
    const isWin = process.platform === 'win32'
    const isInWorkspace = (proc: ManagedProcess): boolean => {
      if (!workspaceRoot) return true
      return isWin
        ? proc.workspaceRoot.toLowerCase() === workspaceRoot.toLowerCase()
        : proc.workspaceRoot === workspaceRoot
    }
    let found: ManagedProcess | null = null
    const direct = this.processes.get(idOrPid)
    if (direct && isInWorkspace(direct)) {
      found = direct
    } else {
      const pid = Number(idOrPid)
      if (Number.isFinite(pid)) {
        for (const proc of this.processes.values()) {
          if (proc.pid === pid && isInWorkspace(proc)) {
            found = proc
            break
          }
        }
      }
    }
    if (found) found.lastActivityAt = Date.now()
    return found
  }

  list(workspaceRoot?: string): ManagedProcess[] {
    this.cleanup()
    const isWin = process.platform === 'win32'
    return Array.from(this.processes.values())
      .filter((proc) => {
        if (!workspaceRoot) return true
        return isWin
          ? proc.workspaceRoot.toLowerCase() === workspaceRoot.toLowerCase()
          : proc.workspaceRoot === workspaceRoot
      })
      .sort((a, b) => b.startTime - a.startTime)
  }

  private cleanup(): void {
    const now = Date.now()
    for (const [id, proc] of this.processes) {
      if (proc.status !== 'running' && now - proc.lastActivityAt > this.exitedRetentionMs) {
        this.processes.delete(id)
      }
    }
    this.enforceLimit()
  }

  private enforceLimit(): void {
    if (this.processes.size <= this.maxEntries) return
    const removable = Array.from(this.processes.values())
      .filter((proc) => proc.status !== 'running')
      .sort((a, b) => a.lastActivityAt - b.lastActivityAt)

    while (this.processes.size > this.maxEntries && removable.length > 0) {
      const proc = removable.shift()!
      this.processes.delete(proc.id)
    }
  }
}

const registry = new ProcessRegistry()

/**
 * TerminalTool — Execute terminal commands and manage background process lifecycle.
 */
export class TerminalTool extends ToolBase {
  get name(): string {
    return 'terminal'
  }

  get description(): string {
    return 'Execute shell commands in the terminal, inspect open IDE terminal tabs/history (including what the user typed), and manage background process lifecycle (run, list_terminals, read_terminal, start_background, list_processes, get_logs, send_input, kill).'
  }

  getExecutionPolicy(): { mutates: boolean; parallelSafe: boolean; cacheable: boolean } {
    // Terminal actions can observe or affect external process state. Keep the
    // whole tool serialized to preserve the previous conservative behavior.
    return { mutates: true, parallelSafe: false, cacheable: false }
  }

  get parameters(): Record<string, ToolParameterDef> {
    return {
      description: {
        type: 'string',
        description: 'Краткое действие (2-4 слова, напр. "Сборка проекта")',
        required: false
      },
      action: {
        type: 'string',
        description:
          'Action: run (default, executes shell command), list_terminals (list all open IDE terminal tabs & status), read_terminal (read command history/output/user input from open terminal), start_background (long-running server/watcher), list_processes, get_logs, send_input, kill',
        required: false,
        enum: [
          'run',
          'list_terminals',
          'read_terminal',
          'start_background',
          'list_processes',
          'get_logs',
          'send_input',
          'kill'
        ]
      },
      command: {
        type: 'string',
        description: '[Required for run, start_background] Command line to execute (PowerShell on Windows)',
        required: false
      },
      cwd: {
        type: 'string',
        description: 'Working directory for command execution (absolute or relative to workspace)',
        required: false
      },
      session_id: {
        type: 'string',
        description:
          '[For read_terminal, send_input, run] IDE terminal tab ID (e.g. "term_1", "term_ai_..."), or "active" (default), or "all"',
        required: false
      },
      timeout: {
        type: 'integer',
        description: '[For run] Execution timeout in seconds (default: 120, max: 600)',
        required: false
      },
      process_id: {
        type: 'string',
        description: '[Required for get_logs, kill; optional for send_input] Background process ID (e.g. bg_1) or PID',
        required: false
      },
      input: {
        type: 'string',
        description: '[Required for send_input] Text string to write to process stdin',
        required: false
      },
      lines: {
        type: 'integer',
        description: '[For get_logs, read_terminal] Number of recent log lines to return (default: 100)',
        required: false
      }
    }
  }

  private _getResolvedCwd(cwdArg?: string, blackboard?: Blackboard): string {
    const workspace = (blackboard?.getArtifact('workspacePath') as string) || process.cwd()
    if (cwdArg && typeof cwdArg === 'string') {
      return path.isAbsolute(cwdArg) ? path.normalize(cwdArg) : path.normalize(path.join(workspace, cwdArg))
    }
    return workspace
  }

  private _getRunId(blackboard?: Blackboard): string {
    return (blackboard?.getArtifact('agentRunId') as string) || 'unscoped'
  }

  private _getWorkspaceRoot(blackboard?: Blackboard): string {
    return path.normalize((blackboard?.getArtifact('workspacePath') as string) || process.cwd())
  }

  /**
   * Keep the existing shell-based command UX (pipes, redirects and npm scripts
   * still work), but stop clearly destructive commands before spawning a child.
   * An explicit config flag can opt into the old unrestricted behavior.
   */
  private _validateCommand(command: unknown, blackboard: Blackboard): string | null {
    if (typeof command !== 'string' || !command.trim()) {
      return 'Error: command parameter is required for this terminal action.'
    }

    const config = (blackboard.getArtifact('config') as { allowDangerousCommands?: boolean } | undefined)
    if (config?.allowDangerousCommands === true) return null

    const normalized = command.toLowerCase().replace(/\s+/g, ' ').trim()
    const dangerousPatterns = process.platform === 'win32'
      ? [
          /(^|[;&|])\s*(format|diskpart|shutdown|restart-computer)\b/,
          /\b(remove-item|rm|ri)\b.*-recurse\b.*-force\b/,
          /\b(remove-item|rm|ri)\b.*-force\b.*-recurse\b/,
          /\b(del|erase|rd|rmdir)\b.*\/(s|q)\b/,
          /\bgit\s+reset\s+--hard\b/,
          /\bgit\s+clean\s+-[^\n]*f/,
          /\bgit\s+push\s+[^\n]*--force(?:-with-lease)?\b/,
          /\b(powershell|pwsh)\b.*-(?:enc|encodedcommand)\b/i,
          /\b(frombase64string)\b/i,
          /\b(iex|invoke-expression)\b/i,
          /\bnode\s+-(?:e|eval)\b.*(rmSync|unlinkSync|rmdirSync)/i,
          /\bpython(?:3)?\s+-c\b.*(rmtree|unlink|remove)/i
        ]
      : [
          /(^|[;&|])\s*rm\s+-[^\n]*r[^\n]*f\b/,
          /\bgit\s+reset\s+--hard\b/,
          /\bgit\s+clean\s+-[^\n]*f/,
          /\bgit\s+push\s+[^\n]*--force(?:-with-lease)?\b/,
          /\b(mkfs|shutdown|reboot)\b/,
          /\bdd\s+if=/,
          /\bcurl\b[^\n|]*\|\s*(sh|bash)\b/,
          /\bwget\b[^\n|]*\|\s*(sh|bash)\b/,
          /\bpython(?:3)?\s+-c\b.*(rmtree|unlink|remove)/i,
          /\bnode\s+-(?:e|eval)\b.*(rmSync|unlinkSync|rmdirSync)/i
        ]

    if (dangerousPatterns.some((pattern) => pattern.test(normalized))) {
      return 'Blocked potentially destructive shell command. Review it explicitly, or set allowDangerousCommands=true for a trusted local run.'
    }
    return null
  }

  /**
   * Two-sided Smart Head/Tail Truncation (Claude Code & OpenHands SOTA pattern).
   * Retains the first 35 lines (launch/init logs) and last 85 lines (compiler errors, exit status,
   * stack traces), omitting noisy intermediate log lines for optimal LLM context efficiency.
   */
  private _smartTruncateOutput(output: string, maxHeadLines = 35, maxTailLines = 85, maxTotalChars = 28000): string {
    if (!output) return ''
    const lines = output.split('\n')
    if (lines.length <= (maxHeadLines + maxTailLines) && output.length <= maxTotalChars) {
      return output
    }

    let processed = output
    if (lines.length > (maxHeadLines + maxTailLines)) {
      const head = lines.slice(0, maxHeadLines).join('\n')
      const tail = lines.slice(-maxTailLines).join('\n')
      const omitted = lines.length - (maxHeadLines + maxTailLines)
      processed = `${head}\n\n[... Omitted ${omitted} intermediate log lines for context optimization ...]\n\n${tail}`
    }

    if (processed.length > maxTotalChars) {
      const headChars = Math.floor(maxTotalChars * 0.3)
      const tailChars = Math.floor(maxTotalChars * 0.7)
      const head = processed.slice(0, headChars)
      const tail = processed.slice(-tailChars)
      processed = `${head}\n\n[... Omitted middle output characters ...]\n\n${tail}`
    }

    return processed
  }

  async execute(
    argumentsJson: string,
    blackboard: Blackboard,
    abortSignal?: AbortSignal,
    onProgress?: ProgressCallback
  ): Promise<ToolResult> {
    let args: any
    try {
      args = JSON.parse(argumentsJson || '{}')
    } catch {
      return { formattedContent: 'Error: invalid JSON arguments.' }
    }

    const action = (args.action || 'run').toLowerCase()
    const runCwd = this._getResolvedCwd(args.cwd, blackboard)

    try {
      if (action === 'run' || action === 'start_background') {
        const commandError = this._validateCommand(args.command, blackboard)
        if (commandError) return { formattedContent: commandError }
      }

      switch (action) {
        case 'run':
          return await this._handleRun(args, runCwd, abortSignal, onProgress)
        case 'list_terminals':
          return await this._handleListTerminals()
        case 'read_terminal':
          return await this._handleReadTerminal(args)
        case 'start_background':
          return await this._handleStartBackground(args, runCwd, blackboard)
        case 'list_processes':
          return await this._handleListProcesses(blackboard)
        case 'get_logs':
          return await this._handleGetLogs(args, blackboard)
        case 'send_input':
          return await this._handleSendInput(args, blackboard)
        case 'kill':
          return await this._handleKill(args, blackboard)
        default:
          return { formattedContent: `Error: unsupported terminal action '${action}'.` }
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      return { formattedContent: `Terminal execution error [${action}]: ${msg}` }
    }
  }

  private _handleRun(
    args: any,
    runCwd: string,
    abortSignal?: AbortSignal,
    onProgress?: ProgressCallback
  ): Promise<ToolResult> {
    return new Promise((resolve) => {
      const command = args.command
      if (!command || typeof command !== 'string') {
        return resolve({ formattedContent: 'Error: command parameter is required for run action.' })
      }

      let settled = false
      const finish = (result: ToolResult): void => {
        if (settled) return
        settled = true
        resolve(result)
      }

      const isWin = process.platform === 'win32'
      const timeoutMs = Math.min(Number(args.timeout) || 120, 600) * 1000

      if (!fs.existsSync(runCwd)) {
        try {
          fs.mkdirSync(runCwd, { recursive: true })
        } catch {}
      }

      const cmdToRun = isWin
        ? `$OutputEncoding = [Console]::InputEncoding = [Console]::OutputEncoding = [System.Text.Encoding]::UTF8; ${command}`
        : command

      const shell = isWin ? (process.env.POWERSHELL_PATH || 'powershell.exe') : (process.env.SHELL || '/bin/sh')
      let onAbort: (() => void) | null = null
      const startTime = Date.now()
      let bytesReceived = 0

      onProgress?.({ message: '', elapsedSeconds: 0 })

      const progressTimer = setInterval(() => {
        const elapsedSeconds = Math.floor((Date.now() - startTime) / 1000)
        const msg =
          bytesReceived > 0
            ? bytesReceived > 1024
              ? Math.round(bytesReceived / 1024) + ' КБ'
              : bytesReceived + ' байт'
            : ''
        onProgress?.({ message: msg, elapsedSeconds })
      }, 1000)

      const runId = `ai_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`
      const targetSessionId = args.session_id || `term_ai_${runId}`
      const sessionManager = TerminalSessionManager.getInstance()

      notifyRenderer('terminal:ai:start', { runId, command, cwd: runCwd })

      const child = exec(
        cmdToRun,
        {
          cwd: runCwd,
          shell: shell as string,
          timeout: timeoutMs,
          maxBuffer: 10 * 1024 * 1024,
          encoding: 'utf8'
        },
        (error, stdout, stderr) => {
          clearInterval(progressTimer)
          if (onAbort && abortSignal) {
            abortSignal.removeEventListener('abort', onAbort)
          }

          const exitCode = error ? ((error as any).code ?? 1) : 0
          sessionManager.recordCommandExit(runId, exitCode)
          notifyRenderer('terminal:ai:exit', { runId, code: exitCode })

          const combined = (stdout || '') + (stderr ? `\n[STDERR]\n${stderr}` : '')
          let cleanOutput = stripAnsi(combined).trim()

          cleanOutput = this._smartTruncateOutput(cleanOutput)

          if (error && (error as any).killed) {
            return finish({
              formattedContent: `Command timed out after ${args.timeout || 120}s:\n\n${cleanOutput}\n\nTip: If this command starts a long-running server or daemon, use action="start_background" instead.`
            })
          }

          if (error && (error as any).code) {
            return finish({
              formattedContent: `Command exited with code ${(error as any).code}:\n\n${cleanOutput || error.message}`,
              data: { command, cwd: runCwd, exitCode: (error as any).code, error: true }
            })
          }

          return finish({
            formattedContent: cleanOutput || 'Command executed with no output.',
            data: { cwd: runCwd, command, exitCode: 0 }
          })
        }
      )

      sessionManager.recordCommandStart({
        sessionId: targetSessionId,
        runId,
        command,
        cwd: runCwd,
        initiator: 'ai',
        pid: child.pid
      })

      if (child.stdout) {
        child.stdout.on('data', (chunk) => {
          bytesReceived += chunk ? chunk.length : 0
          const text = stripAnsi(chunk ? chunk.toString('utf8') : '')
          if (text) {
            sessionManager.appendOutput(runId, text)
            notifyRenderer('terminal:ai:data', { runId, text })
          }
        })
      }

      if (child.stderr) {
        child.stderr.on('data', (chunk) => {
          bytesReceived += chunk ? chunk.length : 0
          const text = stripAnsi(chunk ? chunk.toString('utf8') : '')
          if (text) {
            sessionManager.appendOutput(runId, text)
            notifyRenderer('terminal:ai:data', { runId, text })
          }
        })
      }

      const killProcessTree = (): void => {
        if (!child) return
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
        }
      }

      if (abortSignal) {
        if (abortSignal.aborted) {
          clearInterval(progressTimer)
          killProcessTree()
          return finish({ formattedContent: 'Terminal command cancelled by user.' })
        }
        onAbort = () => {
          clearInterval(progressTimer)
          killProcessTree()
          finish({ formattedContent: 'Terminal command cancelled by user.' })
        }
        abortSignal.addEventListener('abort', onAbort, { once: true })
      }
    })
  }

  private async _handleStartBackground(args: any, runCwd: string, blackboard: Blackboard): Promise<ToolResult> {
    const command = args.command
    if (!command || typeof command !== 'string') {
      return { formattedContent: 'Error: command parameter is required for start_background action.' }
    }

    const isWin = process.platform === 'win32'
    const id = registry.createId()

    if (!fs.existsSync(runCwd)) {
      try {
        fs.mkdirSync(runCwd, { recursive: true })
      } catch {}
    }

    const cmdToRun = isWin
      ? `$OutputEncoding = [Console]::InputEncoding = [Console]::OutputEncoding = [System.Text.Encoding]::UTF8; ${command}`
      : command

    const shell = isWin ? (process.env.POWERSHELL_PATH || 'powershell.exe') : (process.env.SHELL || '/bin/sh')

    let child: ChildProcess
    try {
      child = spawn(cmdToRun, [], {
        cwd: runCwd,
        shell: shell as string,
        stdio: ['pipe', 'pipe', 'pipe'],
        detached: false
      })
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      return { formattedContent: `Failed to spawn process: ${msg}` }
    }

    const procObj: ManagedProcess = {
      id,
      pid: child.pid,
      command,
      cwd: runCwd,
      workspaceRoot: this._getWorkspaceRoot(blackboard),
      ownerRunId: this._getRunId(blackboard),
      child,
      status: 'running',
      exitCode: null,
      startTime: Date.now(),
      lastActivityAt: Date.now(),
      logs: [],
      bytesReceived: 0
    }

    const sessionManager = TerminalSessionManager.getInstance()
    sessionManager.recordCommandStart({
      sessionId: `term_ai_${id}`,
      runId: id,
      command,
      cwd: runCwd,
      initiator: 'ai',
      child,
      pid: child.pid
    })

    notifyRenderer('terminal:ai:start', { runId: id, command, cwd: runCwd, isBackground: true })

    const appendLog = (data: Buffer | string): void => {
      if (!data) return
      const clean = stripAnsi(data.toString())
      procObj.bytesReceived += clean.length
      procObj.lastActivityAt = Date.now()
      sessionManager.appendOutput(id, clean)
      notifyRenderer('terminal:ai:data', { runId: id, text: clean })
      const lines = clean.split(/\r?\n/)
      for (const line of lines) {
        if (line.trim().length > 0) {
          procObj.logs.push(line)
        }
      }
      if (procObj.logs.length > 3000) {
        procObj.logs = procObj.logs.slice(-3000)
      }
    }

    if (child.stdout) child.stdout.on('data', appendLog)
    if (child.stderr) child.stderr.on('data', appendLog)

    child.on('exit', (code, signal) => {
      procObj.status = 'exited'
      procObj.exitCode = code !== null ? code : signal
      procObj.lastActivityAt = Date.now()
      sessionManager.recordCommandExit(id, procObj.exitCode as number | null)
      notifyRenderer('terminal:ai:exit', { runId: id, code: procObj.exitCode })
    })

    child.on('error', (err) => {
      procObj.status = 'exited'
      procObj.lastActivityAt = Date.now()
      procObj.logs.push(`[SYSTEM ERROR]: ${err.message}`)
      sessionManager.recordCommandExit(id, 1)
      notifyRenderer('terminal:ai:exit', { runId: id, code: 1 })
    })

    registry.add(id, procObj)

    await new Promise((resolve) => setTimeout(resolve, 1500))

    const initialLogs = procObj.logs.slice(-20).join('\n')
    const statusStr =
      procObj.status === 'running'
        ? `Started background process '${id}' (PID: ${child.pid}). Status: RUNNING.`
        : `Started background process '${id}' (PID: ${child.pid}). Status: EXITED (code ${procObj.exitCode}).`

    return {
      formattedContent: `${statusStr}\n\nInitial output:\n${initialLogs || '(no output generated yet)'}\n\nUse action="get_logs" with process_id="${id}" to check logs later, or action="kill" to stop it.`,
      data: { process_id: id, pid: child.pid, status: procObj.status, command }
    }
  }

  private async _handleListProcesses(blackboard: Blackboard): Promise<ToolResult> {
    const workspaceRoot = this._getWorkspaceRoot(blackboard)
    const list = registry.list(workspaceRoot)
    if (list.length === 0) {
      return { formattedContent: 'No background processes managed by zipply.' }
    }

    let out = `Background processes (${list.length}):\n\n`
    for (const p of list) {
      const elapsedSec = Math.floor((Date.now() - p.startTime) / 1000)
      const statusLabel = p.status === 'running' ? 'RUNNING' : `EXITED (${p.exitCode})`
      out += `• ID: ${p.id} | PID: ${p.pid} | Status: ${statusLabel} | Uptime: ${elapsedSec}s | Log lines: ${p.logs.length}\n`
      out += `  Command: ${p.command}\n`
      out += `  CWD: ${p.cwd}\n  Owner run: ${p.ownerRunId}\n\n`
    }

    return { formattedContent: out.trim() }
  }

  private async _handleGetLogs(args: any, blackboard: Blackboard): Promise<ToolResult> {
    const procId = args.process_id
    if (!procId) {
      return { formattedContent: 'Error: process_id parameter is required for get_logs action.' }
    }

    const proc = registry.get(procId, this._getWorkspaceRoot(blackboard))
    if (!proc) {
      return {
        formattedContent: `Error: process '${procId}' not found in registry. Use action="list_processes" to see active processes.`
      }
    }

    const limit = Math.min(Math.max(Number(args.lines) || 100, 1), 1000)
    const logsSlice = proc.logs.slice(-limit)
    const statusLabel = proc.status === 'running' ? 'RUNNING' : `EXITED (code ${proc.exitCode})`

    return {
      formattedContent: `Logs for process ${proc.id} (PID: ${proc.pid}, Status: ${statusLabel}):\n\n${logsSlice.join('\n') || '(no logs)'}`,
      data: { process_id: proc.id, totalLines: proc.logs.length, returnedLines: logsSlice.length }
    }
  }

  private async _handleListTerminals(): Promise<ToolResult> {
    const sessionManager = TerminalSessionManager.getInstance()
    const content = sessionManager.listTerminals()
    return {
      formattedContent: content,
      data: {
        sessions: sessionManager.getAllSessions().map((s) => ({
          id: s.id,
          name: s.name,
          isRunning: s.isRunning,
          cwd: s.cwd,
          activePid: s.activePid,
          entriesCount: s.entries.length
        }))
      }
    }
  }

  private async _handleReadTerminal(args: any): Promise<ToolResult> {
    const sessionManager = TerminalSessionManager.getInstance()
    const targetSessionId = args.session_id || args.process_id
    const lines = Number(args.lines) || 120
    const content = sessionManager.readTerminalOutput(targetSessionId, lines)
    return {
      formattedContent: content,
      data: { sessionId: targetSessionId || 'active', lines }
    }
  }

  private async _handleSendInput(args: any, blackboard: Blackboard): Promise<ToolResult> {
    const targetId = args.session_id || args.process_id
    if (!targetId) {
      return { formattedContent: 'Error: session_id or process_id parameter is required for send_input action.' }
    }

    const inputStr = args.input !== undefined ? String(args.input) : ''

    // 1. Try sending input to active interactive terminal process
    const sessionManager = TerminalSessionManager.getInstance()
    const termResult = sessionManager.sendInput(targetId, inputStr)
    if (termResult.success) {
      return { formattedContent: `Successfully sent input to terminal process '${targetId}':\n${inputStr}` }
    }

    // 2. Fall back to ProcessRegistry background process
    const proc = registry.get(targetId, this._getWorkspaceRoot(blackboard))
    if (!proc) {
      return {
        formattedContent: `Error: neither active terminal nor background process found for ID '${targetId}'. ${termResult.message}`
      }
    }

    if (proc.status !== 'running' || !proc.child.stdin || proc.child.stdin.destroyed) {
      return { formattedContent: `Error: process ${proc.id} is not running or stdin is closed.` }
    }

    const textToSend = inputStr.endsWith('\n') ? inputStr : inputStr + '\n'

    try {
      proc.child.stdin.write(textToSend, 'utf8')
      sessionManager.appendOutput(proc.id, `[stdin]: ${inputStr}`)
      return { formattedContent: `Successfully sent input to process ${proc.id}:\n${inputStr}` }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      return { formattedContent: `Failed to write to stdin of process ${proc.id}: ${msg}` }
    }
  }

  private async _handleKill(args: any, blackboard: Blackboard): Promise<ToolResult> {
    const procId = args.process_id
    if (!procId) {
      return { formattedContent: 'Error: process_id parameter is required for kill action.' }
    }

    const proc = registry.get(procId, this._getWorkspaceRoot(blackboard))
    const pidToKill = proc ? proc.pid : Number(procId)

    if (!pidToKill || !Number.isFinite(pidToKill)) {
      return { formattedContent: `Error: invalid process_id or PID '${procId}'.` }
    }

    const isWin = process.platform === 'win32'
    let success = false
    let errMessage = ''

    if (isWin) {
      try {
        execSync(`taskkill /F /T /PID ${pidToKill}`, { stdio: 'ignore' })
        success = true
      } catch (err: unknown) {
        errMessage = err instanceof Error ? err.message : String(err)
      }
    } else {
      try {
        process.kill(-pidToKill, 'SIGKILL')
        success = true
      } catch {
        try {
          process.kill(pidToKill, 'SIGKILL')
          success = true
        } catch (err: unknown) {
          errMessage = err instanceof Error ? err.message : String(err)
        }
      }
    }

    if (proc) {
      proc.status = 'killed'
      if (proc.child && !proc.child.killed) {
        try {
          proc.child.kill('SIGKILL')
        } catch {}
      }
    }

    if (success) {
      return { formattedContent: `Successfully killed process ${procId} (PID: ${pidToKill}).` }
    } else {
      return {
        formattedContent: `Failed to kill process ${procId} (PID: ${pidToKill}): ${errMessage || 'Process might have already exited.'}`
      }
    }
  }
}
