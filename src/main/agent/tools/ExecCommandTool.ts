import * as path from 'path'
import { ToolBase, ToolResult, ProgressCallback, ToolExecutionPolicy, ToolParameterDef } from './ToolBase'
import { Blackboard } from '../core/Blackboard'
import { resolveWorkspacePath } from './pathUtils'
import { classifyCommand } from '../core/CommandPolicy'
import { terminalSessionManager } from '../services/TerminalSessionManager'
import { isTerminalLive, normalizeTerminalShell, type TerminalOwner, type TerminalShellPreference } from '../../../shared/terminal'
import { resolveSandboxPolicy, type SandboxPolicy } from '../../../shared/sandbox'

function resolveExecutionContext(
  blackboard: Blackboard,
  fallbackWorkspace: string
): { owner: TerminalOwner; requestId?: string; sandbox: SandboxPolicy; shellPreference: TerminalShellPreference; dependencyPaths: string[] } {
  const config = blackboard.getArtifact('config') as {
    processOwner?: TerminalOwner
    requestId?: string
    terminalShell?: unknown
    accessMode?: string
    planMode?: boolean
    sandbox?: Partial<SandboxPolicy>
    subagentDependencyPaths?: unknown
  } | undefined
  const sandbox = resolveSandboxPolicy(
    {
      accessMode: config?.accessMode,
      planMode: config?.planMode ?? Boolean(blackboard.getArtifact('planMode')),
      sandbox: config?.sandbox
    },
    fallbackWorkspace
  )
  return {
    owner: config?.processOwner ?? { senderId: 0, sessionId: 'local', workspace: path.resolve(fallbackWorkspace) },
    requestId: config?.requestId,
    shellPreference: normalizeTerminalShell(config?.terminalShell),
    sandbox,
    dependencyPaths: Array.isArray(config?.subagentDependencyPaths)
      ? config.subagentDependencyPaths.filter((value): value is string => typeof value === 'string' && path.isAbsolute(value))
      : []
  }
}

export class ExecCommandTool extends ToolBase {
  get name(): string {
    return 'exec_command'
  }

  get description(): string {
    return 'Выполняет команду в отдельном терминале проекта. Для сервера или наблюдателя используй background=true: вызов сразу вернёт session_id. Обычная команда ждёт до yield_time_ms и переходит в фон, если всё ещё работает. Используй write_stdin с session_id для вывода, ввода или остановки.'
  }

  get parameters(): Record<string, ToolParameterDef> {
    return {
      command: {
        type: 'string',
        description: 'Команда shell для выполнения в проекте.',
        required: true,
        minLength: 1
      },
      workdir: {
        type: 'string',
        description: 'Относительный путь к подпапке проекта (по умолчанию корень проекта).'
      },
      cwd: {
        type: 'string',
        description: 'Псевдоним workdir для обратной совместимости.'
      },
      yield_time_ms: {
        type: 'integer',
        description: 'Сколько миллисекунд ждать завершения команды перед возвратом session_id (по умолчанию 10000, макс 60000).',
        minimum: 0,
        maximum: 60000,
        default: 10000
      },
      background: {
        type: 'boolean',
        description: 'Сразу запустить в разделе фоновых задач без ожидания вывода.',
        default: false
      },
      title: {
        type: 'string',
        description: 'Краткое название для списка в терминале, например «Сервер разработки».',
        maxLength: 72
      },
      tty: {
        type: 'boolean',
        description: 'Запустить в интерактивном PTY (по умолчанию false; включай true только для REPL/TUI-утилит).',
        default: false
      },
      max_output_chars: {
        type: 'integer',
        description: 'Лимит символов вывода (по умолчанию 16000, макс 34000).',
        minimum: 1000,
        maximum: 34000,
        default: 16000
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
      if (!rawCmd || (typeof rawCmd !== 'string' && !Array.isArray(rawCmd))) {
        return 'Ошибка: параметр command обязателен и должен быть непустой строкой.'
      }
      if (typeof rawCmd === 'string' && !rawCmd.trim()) {
        return 'Ошибка: параметр command не может быть пустым.'
      }
      if (args.yield_time_ms !== undefined && (!Number.isFinite(args.yield_time_ms) || args.yield_time_ms < 0 || args.yield_time_ms > 60000)) {
        return 'Ошибка: yield_time_ms должен быть от 0 до 60000.'
      }
      if (args.background !== undefined && typeof args.background !== 'boolean') return 'Ошибка: background должен быть логическим значением.'
      if (args.title !== undefined && (typeof args.title !== 'string' || args.title.length > 72)) return 'Ошибка: title должен быть строкой длиной до 72 символов.'
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
    const valErr = this.validate(argumentsJson)
    if (valErr) return { formattedContent: valErr, error: true }

    const args = JSON.parse(argumentsJson || '{}')
    const rawCmd = args.command || args.cmd || ''
    const command = (Array.isArray(rawCmd) ? rawCmd.join(' ') : String(rawCmd)).trim()
    const yieldTimeMs = typeof args.yield_time_ms === 'number' ? args.yield_time_ms : 10000
    const tty = args.tty === true
    const maxChars = typeof args.max_output_chars === 'number' ? Math.max(1000, Math.min(34000, Math.floor(args.max_output_chars))) : undefined
    const targetCwd = typeof args.cwd === 'string' && args.cwd.trim() ? args.cwd : typeof args.workdir === 'string' && args.workdir.trim() ? args.workdir : '.'

    let resolved: ReturnType<typeof resolveWorkspacePath>
    try {
      resolved = resolveWorkspacePath(blackboard, targetCwd)
    } catch (err) {
      return { formattedContent: `Ошибка пути cwd: ${err instanceof Error ? err.message : String(err)}`, error: true }
    }

    if (abortSignal?.aborted) {
      return { formattedContent: 'Команда отменена пользователем.', error: true }
    }

    const { owner, requestId, sandbox, shellPreference, dependencyPaths } = resolveExecutionContext(blackboard, resolved.workspaceRoot)
    const startedAt = Date.now()
    let streamedOutput = ''
    let lastEmit = 0

    try {
      const res = await terminalSessionManager.startCommand({
        owner,
        requestId,
        shellPreference,
        command,
        background: args.background === true,
        autoBackground: true,
        title: args.title,
        cwd: resolved.absPath,
        yieldTimeMs,
        tty,
        maxChars,
        sandbox,
        dependencyPaths,
        abortSignal,
        onSession: (session) => onProgress?.({ data: { terminalSessionId: session.id, background: session.background } }),
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
      const live = isTerminalLive(res.session.status)
      const body = res.output.trim() || (live ? '(пока нет вывода)' : '(команда выполнена без вывода)')
      const exitCode = res.session.exitCode
      const isFailure = !live && (res.session.status !== 'exited' || exitCode !== 0)
      const errorCode = res.session.status === 'failed'
        ? 'SPAWN_FAILED'
        : isFailure && typeof exitCode === 'number'
          ? `EXIT_${exitCode}`
          : undefined
      const data = {
        terminalSessionId: res.session.id,
        status: res.session.status,
        background: res.session.background,
        exitCode,
        command,
        cwd: resolved.relPath,
        elapsedMs,
        ...(errorCode ? { errorCode } : {}),
        ...(res.logPath ? { logPath: res.logPath } : {})
      }

      if (live) {
        return {
          formattedContent: `$ ${command}\n\n${body}\n\n(команда продолжает работу в фоне; session_id: ${res.session.id}. Используй write_stdin для ожидания вывода, ввода или остановки.)`,
          data,
          success: true
        }
      }

      const numericExit = exitCode ?? -1
      if (!isFailure && numericExit === 0) {
        return {
          formattedContent: `$ ${command}\n\n${body}\n\n(завершено с кодом 0 за ${elapsedMs} мс)`,
          data,
          success: true
        }
      }

      return {
        formattedContent: `$ ${command}\n\n${body}\n\n(завершено с ошибкой: код ${numericExit})`,
        data,
        error: true
      }
    } catch (err) {
      return {
        formattedContent: `Ошибка выполнения команды: ${err instanceof Error ? err.message : String(err)}`,
        error: true
      }
    }
  }
}
