import * as path from 'path'
import { ToolBase, ToolResult, ToolExecutionPolicy, ToolParameterDef } from './ToolBase'
import { Blackboard } from '../core/Blackboard'
import { resolveWorkspacePath } from './pathUtils'
import { terminalSessionManager } from '../services/TerminalSessionManager'
import type { TerminalOwner } from '../../../shared/terminal'

export class WriteStdinTool extends ToolBase {
  get name(): string {
    return 'write_stdin'
  }

  get description(): string {
    return 'Отправляет ввод (chars) или сигнал (SIGINT/SIGKILL) в активную терминальную сессию по session_id из exec_command, либо с пустым chars ждёт новую порцию вывода.'
  }

  get parameters(): Record<string, ToolParameterDef> {
    return {
      session_id: {
        type: 'string',
        description: 'ID активной терминальной сессии из exec_command.',
        required: true,
        minLength: 1
      },
      chars: {
        type: 'string',
        description: 'Символы для отправки в stdin (например "y\\n"). Оставь пустым, чтобы просто дождаться нового вывода.'
      },
      yield_time_ms: {
        type: 'integer',
        description: 'Сколько миллисекунд ждать нового вывода или завершения (по умолчанию 2500, макс 30000).',
        minimum: 0,
        maximum: 30000,
        default: 2500
      },
      tail_lines: {
        type: 'integer',
        description: 'Если указано, вернуть последние N строк всего вывода сессии (удобно для длинных сборок).',
        minimum: 1,
        maximum: 500
      },
      signal: {
        type: 'string',
        description: 'Сигнал остановки процесса: SIGINT (Ctrl+C) или SIGKILL (принудительно).',
        enum: ['SIGINT', 'SIGKILL']
      }
    }
  }

  getExecutionPolicy(args: Record<string, unknown> = {}): ToolExecutionPolicy {
    const hasInput = typeof args.chars === 'string' && args.chars.length > 0
    const hasSignal = typeof args.signal === 'string' && args.signal.length > 0
    const mutates = hasInput || hasSignal
    return { mutates, parallelSafe: false, cacheable: false }
  }

  validate(argumentsJson: string): string | null {
    try {
      const args = JSON.parse(argumentsJson || '{}')
      if (typeof args.session_id !== 'string' || !args.session_id.trim()) {
        return 'Ошибка: параметр session_id обязателен.'
      }
      if (args.chars !== undefined && typeof args.chars !== 'string') {
        return 'Ошибка: параметр chars должен быть строкой.'
      }
      if (args.signal !== undefined && args.signal !== 'SIGINT' && args.signal !== 'SIGKILL') {
        return 'Ошибка: signal должен быть SIGINT или SIGKILL.'
      }
      return null
    } catch {
      return 'Ошибка: невалидный JSON аргументов.'
    }
  }

  async execute(
    argumentsJson: string,
    blackboard: Blackboard,
    abortSignal?: AbortSignal
  ): Promise<ToolResult> {
    const valErr = this.validate(argumentsJson)
    if (valErr) return { formattedContent: valErr, error: true }

    const args = JSON.parse(argumentsJson || '{}')
    const config = blackboard.getArtifact('config') as { processOwner?: TerminalOwner } | undefined
    const fallbackRoot = resolveWorkspacePath(blackboard, '.').workspaceRoot
    const owner: TerminalOwner = config?.processOwner || {
      senderId: 0,
      sessionId: 'local',
      workspace: path.resolve(fallbackRoot)
    }

    try {
      const res = await terminalSessionManager.writeInput(
        owner,
        args.session_id,
        typeof args.chars === 'string' ? args.chars : '',
        {
          yieldTimeMs: typeof args.yield_time_ms === 'number' ? args.yield_time_ms : 2500,
          tailLines: typeof args.tail_lines === 'number' ? args.tail_lines : undefined,
          maxLines: typeof args.tail_lines === 'number' ? Math.max(220, args.tail_lines) : undefined,
          signal: args.signal
        },
        abortSignal
      )

      const body = res.output.trim() || '(нет нового вывода)'
      const statusText =
        res.session.status === 'running' || res.session.status === 'starting'
          ? `сессия ${res.session.id} продолжает работу`
          : `сессия ${res.session.id} завершена (${res.session.status}, код ${res.session.exitCode ?? -1})`

      const exitCode = res.session.exitCode
      const isFailure = res.session.status === 'failed' || (res.session.status === 'exited' && exitCode !== 0)
      const errorCode = res.session.status === 'failed'
        ? 'SPAWN_FAILED'
        : isFailure && typeof exitCode === 'number'
          ? `EXIT_${exitCode}`
          : undefined

      return {
        formattedContent: `${body}\n\n(${statusText})`,
        data: {
          terminalSessionId: res.session.id,
          background: res.session.background,
          status: res.session.status,
          exitCode,
          command: res.session.command,
          ...(errorCode ? { errorCode } : {}),
          ...(res.logPath ? { logPath: res.logPath } : {})
        },
        error: isFailure,
        success: res.session.status === 'running' || exitCode === 0
      }
    } catch (err) {
      return {
        formattedContent: `Ошибка write_stdin: ${err instanceof Error ? err.message : String(err)}`,
        error: true
      }
    }
  }
}
