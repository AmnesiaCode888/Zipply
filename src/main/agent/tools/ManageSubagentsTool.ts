import { Blackboard } from '../core/Blackboard'
import { SubagentManager, subagentManager, type SubagentScope } from '../services/SubagentManager'
import { ProgressCallback, ToolBase, ToolExecutionPolicy, ToolParameterDef, ToolResult } from './ToolBase'

type Action = 'list' | 'status' | 'wait' | 'steer' | 'interrupt' | 'stop' | 'resume'
const ACTIONS: Action[] = ['list', 'status', 'wait', 'steer', 'interrupt', 'stop', 'resume']

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function formatSnapshot(snapshot: ReturnType<SubagentManager['get']>): string {
  const header = `[${snapshot.id}] ${snapshot.role} · ${snapshot.status}`
  const details = [
    `Задача: ${snapshot.task}`,
    snapshot.activity ? `Активность: ${snapshot.activity}` : '',
    snapshot.summary ? `Отчёт: ${snapshot.summary}` : '',
    snapshot.error ? `Ошибка: ${snapshot.error}` : '',
    snapshot.rounds !== undefined ? `Раундов: ${snapshot.rounds}` : '',
    snapshot.toolCallsCount ? `Вызовов инструментов: ${snapshot.toolCallsCount}` : '',
    snapshot.usage ? `Токенов: ${snapshot.usage.totalTokens}${snapshot.usage.estimated ? ' (оценка)' : ''}` : '',
    snapshot.verificationStatus ? `Проверка: ${snapshot.verificationStatus}` : '',
    typeof snapshot.resultData?.dependenciesAvailable === 'boolean'
      ? `Зависимости для worker: ${snapshot.resultData.dependenciesAvailable ? 'доступны' : 'не найдены'}`
      : '',
    snapshot.resultData?.worktreePath ? `Worktree: ${String(snapshot.resultData.worktreePath)}` : '',
    Array.isArray(snapshot.resultData?.changedFiles) && snapshot.resultData.changedFiles.length
      ? `Изменённые файлы: ${(snapshot.resultData.changedFiles as unknown[]).map(String).join(', ')}`
      : '',
    typeof snapshot.resultData?.patchPath === 'string' ? `Патч: ${snapshot.resultData.patchPath}` : ''
  ].filter(Boolean)
  return `${header}\n${details.join('\n')}`
}

export class ManageSubagentsTool extends ToolBase {
  constructor(private readonly manager: SubagentManager = subagentManager) { super() }

  get name(): string { return 'manage_agents' }

  get description(): string {
    return 'Список и управление дочерними задачами: статус, ожидание отчёта, steer, interrupt, stop или resume. После spawn_agent используй wait, если результат нужен в текущем ответе.'
  }

  get parameters(): Record<string, ToolParameterDef> {
    return {
      action: {
        type: 'string',
        description: 'Операция со списком или дочерней задачей.',
        required: true,
        enum: ACTIONS
      },
      agent_id: {
        type: 'string',
        description: 'ID субагента для всех операций, кроме list.'
      },
      message: {
        type: 'string',
        description: 'Новая инструкция для steer.'
      },
      timeout_ms: {
        type: 'integer',
        description: 'Максимальное время ожидания wait; от 0 до 120000 мс, по умолчанию 30000.',
        minimum: 0,
        maximum: 120_000,
        default: 30_000
      }
    }
  }

  getExecutionPolicy(): ToolExecutionPolicy {
    return { mutates: false, parallelSafe: false, cacheable: false }
  }

  validate(raw: string): string | null {
    let args: Record<string, unknown>
    try {
      const parsed: unknown = JSON.parse(raw || '{}')
      if (!isRecord(parsed)) return 'Ошибка: аргументы manage_agents должны быть JSON-объектом.'
      args = parsed
    } catch {
      return 'Ошибка: некорректный JSON аргументов manage_agents.'
    }
    if (!ACTIONS.includes(args.action as Action)) return 'Ошибка: укажите действие list, status, wait, steer, interrupt, stop или resume.'
    if (args.action !== 'list' && (typeof args.agent_id !== 'string' || !args.agent_id.trim())) {
      return 'Ошибка: для этой операции нужен agent_id.'
    }
    if (args.action === 'steer' && (typeof args.message !== 'string' || !args.message.trim())) {
      return 'Ошибка: steer требует непустой message.'
    }
    if (args.timeout_ms !== undefined && (!Number.isInteger(args.timeout_ms) || Number(args.timeout_ms) < 0 || Number(args.timeout_ms) > 120_000)) {
      return 'Ошибка: timeout_ms должен быть целым числом от 0 до 120000.'
    }
    return null
  }

  async execute(raw: string, board: Blackboard, abortSignal?: AbortSignal, _onProgress?: ProgressCallback): Promise<ToolResult> {
    const validation = this.validate(raw)
    if (validation) return { formattedContent: validation, error: true }
    const args = JSON.parse(raw) as { action: Action; agent_id?: string; message?: string; timeout_ms?: number }
    const config = board.getArtifact('config') as {
      requestId?: string
      subagentOwner?: { senderId?: number; sessionId?: string }
    } | undefined
    const rootRunId = String(board.getArtifact('rootAgentRunId') || board.getArtifact('agentRunId') || config?.requestId || '')
    const scope: SubagentScope = {
      rootRunId,
      ...(typeof config?.subagentOwner?.senderId === 'number' ? { senderId: config.subagentOwner.senderId } : {}),
      ...(typeof config?.subagentOwner?.sessionId === 'string' && config.subagentOwner.sessionId
        ? { sessionId: config.subagentOwner.sessionId }
        : {})
    }
    const callerId = board.getArtifact<string>('subagentId')
    const visible = (): Set<string> => new Set(this.manager.list(scope, callerId).map(item => item.id))

    try {
      if (args.action === 'list') {
        const subagents = this.manager.list(scope, callerId)
        return {
          formattedContent: subagents.length ? subagents.map(formatSnapshot).join('\n\n') : 'В этом запуске субагентов пока нет.',
          data: { action: 'list', subagents }
        }
      }

      const id = args.agent_id!.trim()
      if (!visible().has(id)) throw new Error('Этот субагент не принадлежит текущему запуску или дочерней ветке.')
      let snapshot: ReturnType<SubagentManager['get']>
      switch (args.action) {
        case 'status':
          snapshot = this.manager.get(scope, id)
          break
        case 'wait':
          snapshot = await this.manager.wait(scope, id, args.timeout_ms ?? 30_000, abortSignal)
          break
        case 'steer':
          snapshot = this.manager.steer(scope, id, args.message!)
          break
        case 'interrupt':
          snapshot = await this.manager.interrupt(scope, id, true)
          break
        case 'stop':
          snapshot = await this.manager.stop(scope, id, { recursive: true })
          break
        case 'resume':
          snapshot = this.manager.resume(scope, id)
          break
      }
      return {
        formattedContent: formatSnapshot(snapshot),
        data: { action: args.action, subagent: snapshot }
      }
    } catch (error) {
      return { formattedContent: error instanceof Error ? error.message : String(error), error: true }
    }
  }
}
