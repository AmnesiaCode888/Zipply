import { randomUUID } from 'crypto'
import { AgentBase, type AgentContext } from '../core/AgentBase'
import { AgentRunner } from '../core/AgentRunner'
import { Blackboard } from '../core/Blackboard'
import { RunBudget } from '../core/RunBudget'
import { WorktreeManager, type WorktreeHandle, type WorktreeSummary } from '../services/WorktreeManager'
import type { ChatConfig } from '../services/ChatService'
import { processManager, type ProcessOwner } from '../services/ProcessManager'
import { terminalSessionManager } from '../services/TerminalSessionManager'
import type { SandboxPolicy } from '../../../shared/sandbox'
import type { AgentEvent, AgentRunSummary } from '../../../shared/agentEvents'
import type { SubagentRole, SubagentSnapshot } from '../../../shared/subagents'
import { ProgressCallback, ToolBase, ToolExecutionPolicy, ToolParameterDef, ToolResult } from './ToolBase'
import { subagentManager, type SubagentManager } from '../services/SubagentManager'

const MAX_SUBAGENT_DEPTH = 2
const MAX_BATCH_SIZE = 4

const ROLE_INSTRUCTIONS: Record<SubagentRole, string> = {
  explorer: 'Ты — субагент-исследователь (explorer, только чтение). Быстро и точно изучи указанную область кодовой базы через инструменты поиска и чтения и верни сжатый отчёт с точными путями файлов, номерами строк и символами.',
  reviewer: 'Ты — субагент-ревьюер (reviewer, только чтение). Проверь код, диффы, граничные случаи и потенциальные баги, верни структурированный список замечаний с точными ссылками на файлы и строки.',
  worker: 'Ты — субагент-исполнитель (worker). Выполни порученную подзадачу аккуратно и точечно, проверь результат и верни краткий отчёт об изменениях и проверках.'
}

interface SpawnArgs {
  task?: string
  tasks?: string[]
  role?: SubagentRole
  max_rounds?: number
  use_worktree?: boolean
  wait?: boolean
  wait_timeout_ms?: number
}

interface SubagentOwner {
  senderId?: number
  sessionId?: string
}

function isRole(value: unknown): value is SubagentRole {
  return value === 'explorer' || value === 'reviewer' || value === 'worker'
}

function formatReport(snapshot: SubagentSnapshot): string {
  const usage = snapshot.usage ? `, токенов: ${snapshot.usage.totalTokens}${snapshot.usage.estimated ? ' (оценка)' : ''}` : ''
  const header = `[Отчёт субагента ${snapshot.id} (${snapshot.role}), статус: ${snapshot.status}, раундов: ${snapshot.rounds ?? 0}, вызовов: ${snapshot.toolCallsCount}${usage}, проверка: ${snapshot.verificationStatus ?? 'unverified'}]`
  const data = snapshot.resultData ?? {}
  const worktree = data.worktreeSummary as WorktreeSummary | undefined
  const patch = worktree?.changedFiles.length
    ? `\nИзменения в worktree (${worktree.changedFiles.length}): ${worktree.changedFiles.join(', ')}\nПолный Git-патч: ${worktree.patchPath}.${worktree.diffText ? `\nПредпросмотр патча:\n${worktree.diffText}` : ''}`
    : typeof data.worktreePath === 'string' ? `\nИзолированная копия сохранена: ${data.worktreePath}` : ''
  const dependencyNote = typeof data.dependenciesAvailable === 'boolean'
    ? `\nЗависимости проекта для команд: ${data.dependenciesAvailable ? `доступны (${Number(data.linkedDependencyCount) || 0} read-only links и env fallback)` : 'не найдены'}`
    : ''
  const checks = snapshot.checks?.length
    ? `\nПроверки:\n${snapshot.checks.map(check => `- ${check.toolName}${check.command ? ` (${check.command})` : ''}: ${check.passed ? 'ok' : 'fail'}${check.stale ? ' [устарела]' : ''}`).join('\n')}`
    : ''
  const body = [snapshot.summary, snapshot.error].filter(Boolean).join('\n') || '(субагент ещё не вернул отчёт)'
  return `${header}${checks}${patch}${dependencyNote}\n\n${body}`
}

export class SpawnAgentTool extends ToolBase {
  constructor(private readonly manager: SubagentManager = subagentManager) { super() }

  get name(): string { return 'spawn_agent' }

  get description(): string {
    return 'Быстро запускает одного или несколько изолированных субагентов. Возвращает ID сразу, чтобы основная задача могла продолжиться параллельно. Используй manage_agents({action:"wait", agent_id}) для получения отчёта; wait:true оставляет совместимый синхронный режим. Фоновые worker запускаются в отдельных Git worktree.'
  }

  get parameters(): Record<string, ToolParameterDef> {
    return {
      task: {
        type: 'string',
        description: 'Одна чёткая и самодостаточная задача. Укажи task или tasks.',
        minLength: 1
      },
      tasks: {
        type: 'array',
        description: `Список из 1–${MAX_BATCH_SIZE} независимых задач, которые можно выполнять одновременно. Укажи task или tasks.`,
        minItems: 1,
        maxItems: MAX_BATCH_SIZE,
        items: { type: 'string', minLength: 1 }
      },
      role: {
        type: 'string',
        description: 'Роль для всех задач: explorer (только чтение, по умолчанию), reviewer (только чтение) или worker (изменения кода).',
        enum: ['explorer', 'reviewer', 'worker'],
        default: 'explorer'
      },
      max_rounds: {
        type: 'integer',
        description: 'Максимум раундов на каждого субагента (от 1 до 30, по умолчанию 15).',
        minimum: 1,
        maximum: 30,
        default: 15
      },
      use_worktree: {
        type: 'boolean',
        description: 'Для фонового worker worktree создаётся автоматически. Укажи false только если используешь wait:true и разрешаешь правки в общей папке.',
        default: true
      },
      wait: {
        type: 'boolean',
        description: 'Ждать завершения перед возвратом результата. По умолчанию false: вернуть ID сразу.',
        default: false
      },
      wait_timeout_ms: {
        type: 'integer',
        description: 'Лимит ожидания в режиме wait, от 0 до 120000 мс; по умолчанию 30000.',
        minimum: 0,
        maximum: 120_000,
        default: 30_000
      }
    }
  }

  getExecutionPolicy(args: Record<string, unknown> = {}): ToolExecutionPolicy {
    const isWorker = args.role === 'worker'
    const isolatedWorktree = isWorker && (
      args.use_worktree === true || (args.wait !== true && args.use_worktree !== false)
    )
    return {
      mutates: isWorker && !isolatedWorktree,
      parallelSafe: !isWorker || isolatedWorktree,
      cacheable: false
    }
  }

  validate(raw: string): string | null {
    let args: unknown
    try { args = JSON.parse(raw || '{}') }
    catch { return 'Ошибка: некорректный JSON аргументов spawn_agent.' }
    if (!args || typeof args !== 'object' || Array.isArray(args)) return 'Ошибка: аргументы spawn_agent должны быть JSON-объектом.'
    const value = args as Record<string, unknown>
    const hasTask = typeof value.task === 'string' && Boolean(value.task.trim())
    const hasTasks = Array.isArray(value.tasks)
    if (hasTask === hasTasks) return 'Ошибка: укажи ровно одно поле: task или tasks.'
    if (hasTasks) {
      const taskList = value.tasks as unknown[]
      if (taskList.length < 1 || taskList.length > MAX_BATCH_SIZE ||
        !taskList.every((task: unknown) => typeof task === 'string' && task.trim())) {
        return `Ошибка: tasks должен содержать от 1 до ${MAX_BATCH_SIZE} непустых строк.`
      }
    }
    if (value.task !== undefined && (typeof value.task !== 'string' || !value.task.trim())) {
      return 'Ошибка: task должен быть непустой строкой.'
    }
    if (value.role !== undefined && !isRole(value.role)) return 'Ошибка: role должен быть explorer, reviewer или worker.'
    if (value.max_rounds !== undefined && (!Number.isInteger(value.max_rounds) || Number(value.max_rounds) < 1 || Number(value.max_rounds) > 30)) {
      return 'Ошибка: max_rounds должен быть целым числом от 1 до 30.'
    }
    if (value.use_worktree !== undefined && typeof value.use_worktree !== 'boolean') return 'Ошибка: use_worktree должен быть boolean.'
    if (value.wait !== undefined && typeof value.wait !== 'boolean') return 'Ошибка: wait должен быть boolean.'
    if (value.wait_timeout_ms !== undefined && (!Number.isInteger(value.wait_timeout_ms) || Number(value.wait_timeout_ms) < 0 || Number(value.wait_timeout_ms) > 120_000)) {
      return 'Ошибка: wait_timeout_ms должен быть целым числом от 0 до 120000.'
    }
    if (value.role === 'worker' && value.wait !== true && value.use_worktree === false) {
      return 'Ошибка: фоновой worker требует use_worktree:true. Для общей рабочей папки укажи wait:true.'
    }
    return null
  }

  async execute(raw: string, board: Blackboard, abortSignal?: AbortSignal, onProgress?: ProgressCallback): Promise<ToolResult> {
    const validationError = this.validate(raw)
    if (validationError) return { formattedContent: validationError, error: true }
    const args = JSON.parse(raw) as SpawnArgs
    const role = args.role || 'explorer'
    const tasks = (args.tasks || [args.task!]).map(task => task.trim())
    const maxRounds = args.max_rounds ?? 15
    const wait = args.wait === true
    const parentConfig = (board.getArtifact('config') as ChatConfig | undefined) || {}
    const parentTools = (board.getArtifact('parentAgentTools') as ToolBase[] | undefined) || []
    const parentBudget = board.getArtifact('runBudget')
    const sharedBudget = parentBudget instanceof RunBudget ? parentBudget : undefined
    const rootRunId = String(board.getArtifact('rootAgentRunId') || board.getArtifact('agentRunId') || parentConfig.requestId || '')
    const depth = Number(board.getArtifact('subagentDepth') || 0)
    if (depth >= MAX_SUBAGENT_DEPTH) {
      return { formattedContent: `Ошибка: достигнута максимальная глубина вложенности субагентов (${MAX_SUBAGENT_DEPTH}).`, error: true }
    }
    const owner = parentConfig.subagentOwner as SubagentOwner | undefined
    const inheritedDependencyPaths = Array.isArray(parentConfig.subagentDependencyPaths)
      ? parentConfig.subagentDependencyPaths.filter((value): value is string => typeof value === 'string')
      : []
    const parentOwner = parentConfig.processOwner as ProcessOwner | undefined
    const senderId = owner?.senderId ?? parentOwner?.senderId
    const sessionId = owner?.sessionId ?? parentOwner?.sessionId
    const callerId = board.getArtifact<string>('subagentId')
    const started: SubagentSnapshot[] = []
    const failures: string[] = []

    for (const task of tasks) {
      const readOnly = role !== 'worker'
      const wantsWorktree = role === 'worker' && (args.use_worktree === true || (!wait && args.use_worktree !== false))
      const reservation = sharedBudget ? sharedBudget.tryReserveChild() : undefined
      if (sharedBudget && !reservation) {
        failures.push(`Бюджет исчерпан для задачи: ${task}`)
        continue
      }

      let worktreeHandle: WorktreeHandle | undefined
      if (wantsWorktree) {
        try {
          worktreeHandle = await WorktreeManager.create(parentConfig.workspacePath || process.cwd(), `sub-${role}`, inheritedDependencyPaths)
        } catch (error) {
          reservation?.release()
          failures.push(`Не удалось создать worktree для задачи «${task}»: ${error instanceof Error ? error.message : String(error)}`)
          continue
        }
      }

      const childRequestId = randomUUID()
      const workspacePath = worktreeHandle?.workspacePath || parentConfig.workspacePath || process.cwd()
      const childProcessOwner: ProcessOwner = {
        senderId: senderId ?? parentOwner?.senderId ?? 0,
        sessionId: childRequestId,
        workspace: workspacePath
      }
      const childAgent = this.createChildAgent(role, readOnly, parentTools, depth + 1)
      const childBoard = board.createChild()
      childBoard.setArtifact('subagentDepth', depth + 1, false)
      if (reservation) childBoard.setArtifact('runBudget', reservation.budget, false)

      const remainingTime = sharedBudget?.remainingTimeMs() ?? parentConfig.runLimits?.timeMs
      const maxBudgetTokens = sharedBudget?.getMaxTokens() ?? parentConfig.runLimits?.tokens
      const childConfig: ChatConfig = {
        ...parentConfig,
        workspacePath,
        requestId: childRequestId,
        processOwner: childProcessOwner,
        subagentDependencyPaths: worktreeHandle?.dependencyPaths ?? inheritedDependencyPaths,
        ...(worktreeHandle ? {
          sandbox: { ...parentConfig.sandbox as Partial<SandboxPolicy>, writableRoots: [worktreeHandle.workspacePath] },
          resumeHasAppliedMutation: false
        } : {}),
        accessMode: readOnly ? 'read-only' : parentConfig.accessMode,
        planMode: readOnly ? false : parentConfig.planMode,
        classifyUncensoredMode: false,
        promptUncensoredMode: undefined,
        askUser: undefined,
        taskState: {
          goal: task,
          constraints: readOnly ? ['Режим только для чтения: не изменяй файлы'] : [],
          acceptanceCriteria: [],
          confirmedFacts: [],
          nextStep: ''
        },
        runLimits: {
          rounds: maxRounds,
          ...(typeof maxBudgetTokens === 'number' && maxBudgetTokens > 0 ? { tokens: maxBudgetTokens } : {}),
          ...(typeof remainingTime === 'number' && remainingTime >= 0 ? { timeMs: remainingTime } : {})
        }
      }

      let childHistory: import('../core/ContextCompactor').OpenAiMessage[] = [{ role: 'user', content: task }]
      let childSummary: AgentRunSummary | undefined
      let finalText = ''
      let errorMessage = ''
      let toolCallsCount = 0
      const stopChildResources = async (): Promise<void> => {
        await Promise.allSettled([
          terminalSessionManager.stopRequest(childProcessOwner.senderId, childRequestId),
          processManager.stopRequest(childProcessOwner, childRequestId)
        ])
      }

      try {
        const snapshot = this.manager.spawn({
          rootRunId,
          ...(callerId ? { parentId: callerId } : {}),
          ...(senderId !== undefined ? { senderId } : {}),
          ...(sessionId ? { sessionId } : {}),
          role,
          task,
          parentAbortSignal: abortSignal,
          run: async ({ id, signal, consumeSteers }) => {
            childBoard.setArtifact('subagentId', id, false)
            childConfig.consumeSteers = consumeSteers
            const onChildAbort = (): void => { void stopChildResources() }
            signal.addEventListener('abort', onChildAbort, { once: true })
            try {
              await AgentRunner.run(childAgent, childHistory, childConfig, (event: AgentEvent) => {
                if (event.type === 'tool_start') {
                  toolCallsCount++
                  this.manager.update(id, { toolCallsCount, activity: `Инструмент: ${event.toolName}` })
                  if (wait) onProgress?.({ statusText: `Субагент ${id.slice(0, 8)}: ${event.toolName}`, message: `Субагент ${id.slice(0, 8)}: ${event.toolName}` })
                } else if (event.type === 'history') {
                  childHistory = event.messages as import('../core/ContextCompactor').OpenAiMessage[]
                  const latest = [...event.messages].reverse().find(message =>
                    message.role === 'assistant' && !message.isProgressUpdate && typeof message.content === 'string'
                  )
                  if (latest && typeof latest.content === 'string') {
                    finalText = latest.content
                    this.manager.update(id, { summary: finalText })
                  }
                } else if (event.type === 'run_summary') {
                  childSummary = event.summary
                  this.manager.update(id, {
                    rounds: event.summary.rounds,
                    usage: event.summary.usage,
                    verificationStatus: event.summary.verificationStatus,
                    checks: event.summary.checks
                  })
                } else if (event.type === 'error') {
                  errorMessage = event.message
                }
              }, signal, childBoard)
            } catch (error) {
              errorMessage = error instanceof Error ? error.message : String(error)
            } finally {
              signal.removeEventListener('abort', onChildAbort)
            }

            const reason = childSummary?.reason
            const failed = Boolean(errorMessage && !signal.aborted) || Boolean(reason && !['completed', 'cancelled'].includes(reason))
            const error = failed ? errorMessage || childSummary?.message || `Субагент завершился со статусом ${reason}.` : undefined
            return {
              summary: finalText.trim() || '(субагент не вернул текстового отчёта)',
              ...(error ? { error } : {}),
              rounds: childSummary?.rounds ?? 0,
              toolCallsCount,
              usage: childSummary?.usage,
              verificationStatus: childSummary?.verificationStatus ?? 'unverified',
              checks: childSummary?.checks ?? []
            }
          },
          onTerminal: async (_status, result) => {
            reservation?.release()
            await stopChildResources()
            if (!worktreeHandle) return
            const summary = await WorktreeManager.summarize(worktreeHandle.worktreePath, worktreeHandle.baseTree).catch(() => undefined)
            let retained = true
            if (summary && summary.changedFiles.length === 0 && !summary.retainedPath) {
              retained = !(await worktreeHandle.cleanup().then(() => true, () => false))
            }
            return {
              resultData: {
                ...(retained ? { worktreePath: worktreeHandle.worktreePath } : {}),
                dependenciesAvailable: worktreeHandle.dependencyPaths.length > 0,
                linkedDependencyCount: worktreeHandle.linkedDependencyPaths.length,
                ...(summary ? {
                  worktreeSummary: {
                    statusText: summary.statusText,
                    diffText: summary.diffText,
                    changedFiles: summary.changedFiles,
                    patchPath: summary.patchPath,
                    retainedPath: summary.retainedPath
                  },
                  patchPath: summary.patchPath,
                  changedFiles: summary.changedFiles,
                  retainedPath: summary.retainedPath
                } : { patchError: 'Не удалось собрать сводку worktree; рабочая копия сохранена.' }),
                ...(result?.resultData || {})
              }
            }
          }
        })
        started.push(snapshot)
      } catch (error) {
        reservation?.release()
        await stopChildResources()
        await worktreeHandle?.cleanup().catch(() => {})
        failures.push(error instanceof Error ? error.message : String(error))
      }
    }

    const snapshots = wait
      ? await Promise.all(started.map(snapshot => this.manager.wait(
          { rootRunId, ...(senderId !== undefined ? { senderId } : {}), ...(sessionId ? { sessionId } : {}) },
          snapshot.id,
          args.wait_timeout_ms ?? 30_000,
          abortSignal
        )))
      : started
    const body = snapshots.map(snapshot => wait ? formatReport(snapshot) :
      `Субагент запущен. ID: ${snapshot.id}\nРоль: ${snapshot.role}\nЗадача: ${snapshot.task}\nСтатус: ${snapshot.status}\nДля отчёта вызови manage_agents({action:"wait", agent_id:"${snapshot.id}"}).`
    )
    if (failures.length) body.push(`Не удалось запустить часть задач:\n${failures.map(message => `- ${message}`).join('\n')}`)
    if (!snapshots.length) return { formattedContent: body.join('\n\n') || 'Не удалось запустить субагента.', error: true }

    const single = snapshots.length === 1 ? snapshots[0] : undefined
    const data = single
      ? {
          agentId: single.id,
          role: single.role,
          status: single.status,
          summary: single.summary || single.task,
          rounds: single.rounds,
          toolCallsCount: single.toolCallsCount,
          usage: single.usage,
          verificationStatus: single.verificationStatus,
          checks: single.checks,
          error: single.error,
          subagents: snapshots
        }
      : { status: wait ? 'completed' : 'running', subagents: snapshots }
    return {
      success: !failures.length && snapshots.every(snapshot => snapshot.status !== 'failed'),
      error: Boolean(failures.length) || snapshots.some(snapshot => snapshot.status === 'failed'),
      formattedContent: body.join('\n\n'),
      data
    }
  }

  private createChildAgent(role: SubagentRole, readOnly: boolean, parentTools: ToolBase[], nextDepth: number): AgentBase {
    class SubAgent extends AgentBase {
      get id(): string { return `subagent_${role}` }
      get name(): string { return `Zipply ${role}` }
      get isReadOnly(): boolean { return readOnly }
      getRoleInstructions(): { role: string; instructions: string } {
        return { role, instructions: ROLE_INSTRUCTIONS[role] }
      }
      getSystemPrompt(context: AgentContext): string {
        return [
          ROLE_INSTRUCTIONS[role],
          context.workspacePath ? `Рабочая директория: ${context.workspacePath}` : '',
          context.projectRules ? `Правила проекта:\n${context.projectRules}` : '',
          'Отвечай строго по фактам из прочитанных файлов и результатов инструментов.'
        ].filter(Boolean).join('\n\n')
      }
    }

    const child = new SubAgent()
    for (const tool of parentTools) {
      if (['ask_user', 'update_plan', 'plugin_manager', 'manage_mcp'].includes(tool.name)) continue
      if (tool.name === 'spawn_agent' && nextDepth >= MAX_SUBAGENT_DEPTH) continue
      if (readOnly && tool.getExecutionPolicy().mutates) continue
      child.addTool(tool)
    }
    return child
  }
}
