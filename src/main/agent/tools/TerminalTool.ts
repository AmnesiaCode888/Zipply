import * as path from 'path'
import { ToolBase, ToolResult, ProgressCallback, ToolExecutionPolicy } from './ToolBase'
import { Blackboard } from '../core/Blackboard'
import { resolveWorkspacePath } from './pathUtils'
import { classifyCommand } from '../core/CommandPolicy'
import { terminalSessionManager } from '../services/TerminalSessionManager'
import { normalizeTerminalShell, type TerminalOwner } from '../../../shared/terminal'
import { resolveSandboxPolicy, type SandboxPolicy } from '../../../shared/sandbox'

/**
 * TerminalTool — Backwards-compatible shell command tool backed by TerminalSessionManager.
 * Streams live output to both the chat card and the WorkspacePanel Terminal tab.
 */
export class TerminalTool extends ToolBase {
  get name(): string {
    return 'terminal'
  }

  get description(): string {
    return 'Выполняет короткие команды shell в проекте (предпочитай exec_command для новых вызовов с авто-переходом в фон).'
  }

  get parameters() {
    return {
      command: {
        type: 'string',
        description: 'Команда shell для проекта.',
        required: true
      },
      cwd: {
        type: 'string',
        description: 'Относительный путь к подпапке в проекте, где запустить команду (по умолчанию - корень проекта).'
      },
      timeout_ms: {
        type: 'number',
        description: 'Таймаут в миллисекундах; по умолчанию 60000 (60 секунд).'
      }
    }
  }

  getExecutionPolicy(args: Record<string, unknown> = {}): ToolExecutionPolicy {
    const rawCmd = args.command || args.cmd || ''
    const command = Array.isArray(rawCmd) ? rawCmd.join(' ') : String(rawCmd || '')
    if (command.trim() && classifyCommand(command).risk === 'read_only') {
      return { mutates: false, parallelSafe: true, cacheable: false }
    }
    return { mutates: true, parallelSafe: false, cacheable: false }
  }

  validate(argumentsJson: string): string | null {
    try {
      const args = JSON.parse(argumentsJson || '{}')
      const rawCmd = args.command || args.cmd
      if (!rawCmd) {
        return 'Ошибка: параметр command обязателен и не может быть пустым.'
      }
      if (typeof rawCmd !== 'string' && !Array.isArray(rawCmd)) {
        return 'Ошибка: параметр command должен быть строкой или массивом строк.'
      }
      if (typeof rawCmd === 'string' && !rawCmd.trim()) {
        return 'Ошибка: параметр command не может быть пустым.'
      }
      return null
    } catch {
      return 'Ошибка: невалидный JSON аргументов.'
    }
  }

  async execute(
    argumentsJson: string,
    blackboard: Blackboard,
    abortSignal?: AbortSignal,
    onProgress?: ProgressCallback
  ): Promise<ToolResult> {
    const args = JSON.parse(argumentsJson || '{}')
    let rawCmd = args.command || args.cmd || ''
    if (Array.isArray(rawCmd)) rawCmd = rawCmd.join(' ')
    const command = String(rawCmd || '').trim()

    const timeoutMs =
      typeof args.timeout_ms === 'number' && args.timeout_ms > 0 ? Math.min(args.timeout_ms, 60000) : 60000

    let resolved: ReturnType<typeof resolveWorkspacePath>
    try {
      resolved = resolveWorkspacePath(blackboard, args.cwd || '.')
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      return { formattedContent: `Ошибка пути cwd: ${msg}`, error: true }
    }

    if (abortSignal?.aborted) {
      return { formattedContent: 'Команда отменена пользователем.', error: true }
    }

    const config = blackboard.getArtifact('config') as {
      processOwner?: TerminalOwner
      requestId?: string
      terminalShell?: unknown
      accessMode?: string
      planMode?: boolean
      sandbox?: Partial<SandboxPolicy>
      subagentDependencyPaths?: unknown
    } | undefined
    const owner: TerminalOwner = config?.processOwner || {
      senderId: 0,
      sessionId: 'local',
      workspace: path.resolve(resolved.workspaceRoot)
    }
    const sandbox = resolveSandboxPolicy(
      {
        accessMode: config?.accessMode,
        planMode: config?.planMode ?? Boolean(blackboard.getArtifact('planMode')),
        sandbox: config?.sandbox
      },
      resolved.workspaceRoot
    )

    const startedAt = Date.now()
    let streamedOutput = ''
    let lastEmit = 0

    try {
      const res = await terminalSessionManager.startCommand({
        owner,
        requestId: config?.requestId,
        shellPreference: normalizeTerminalShell(config?.terminalShell),
        command,
        cwd: resolved.absPath,
        yieldTimeMs: timeoutMs,
        tty: false,
        sandbox,
        dependencyPaths: Array.isArray(config?.subagentDependencyPaths)
          ? config.subagentDependencyPaths.filter((value): value is string => typeof value === 'string' && path.isAbsolute(value))
          : [],
        abortSignal,
        onSession: (session) => onProgress?.({ data: { terminalSessionId: session.id } }),
        onOutput: (delta) => {
          streamedOutput = (streamedOutput + delta).slice(-32000)
          const now = Date.now()
          if (now - lastEmit >= 100) {
            lastEmit = now
            onProgress?.({ output: streamedOutput, message: streamedOutput })
          }
        }
      })

      const elapsedMs = Math.max(0, Date.now() - startedAt)
      if (res.session.status === 'running' || res.session.status === 'starting') {
        await terminalSessionManager.sendSignal(owner, res.session.id, 'SIGKILL').catch(() => {})
        return {
          formattedContent: `Превышено время ожидания (${timeoutMs / 1000} сек) выполнения команды:\n${command}\n\nПолученный вывод:\n${res.output}`,
          data: { terminalSessionId: res.session.id, exitCode: -1, command, elapsedMs },
          error: true
        }
      }

      const exitCode = res.session.exitCode ?? -1
      const body = res.output.trim() || '(команда выполнена без вывода)'
      const errorCode = res.session.status === 'failed'
        ? 'SPAWN_FAILED'
        : exitCode !== 0
          ? `EXIT_${exitCode}`
          : undefined
      const data = {
        terminalSessionId: res.session.id,
        status: res.session.status,
        exitCode,
        command,
        cwd: resolved.relPath,
        elapsedMs,
        stdout: res.output,
        stderr: '',
        ...(errorCode ? { errorCode } : {}),
        ...(res.logPath ? { logPath: res.logPath } : {})
      }

      if (exitCode === 0) {
        return {
          formattedContent: `$ ${command}\n\n${body}\n\n(завершено с кодом ${exitCode})`,
          data,
          success: true
        }
      }

      return {
        formattedContent: `$ ${command}\n\n${body}\n\n(завершено с ошибкой: код ${exitCode})`,
        data,
        error: true
      }
    } catch (err) {
      return {
        formattedContent: `Ошибка процесса: ${err instanceof Error ? err.message : String(err)}`,
        error: true
      }
    }
  }
}
