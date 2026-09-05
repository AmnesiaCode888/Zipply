import { ToolBase, ToolParameterDef, ToolResult, ProgressCallback } from './ToolBase'
import { Blackboard } from '../core/Blackboard'
import { AgentRunner } from '../core/AgentRunner'
import { agentRegistry } from '../core/AgentRegistry'

export interface AskSubTask {
  prompt?: string
  context?: string
  agent_id?: string
  model_tier?: 'fast' | 'inherit' | 'heavy'
}

/**
 * AskTool — Delegate tasks to specialized subagents in single or parallel swarm mode.
 */
export class AskTool extends ToolBase {
  private _runnerFn: any = null

  constructor(runnerFn: any = null) {
    super()
    this._runnerFn = runnerFn
  }

  get runnerFn(): any {
    if (!this._runnerFn) {
      this._runnerFn = AgentRunner.run.bind(AgentRunner)
    }
    return this._runnerFn
  }

  get name(): string {
    return 'ask_agent'
  }

  get description(): string {
    return 'Delegate deep research, document investigation, shell execution, web intelligence, or autonomous code editing to specialized subagent(s) in single or parallel swarm mode.'
  }

  getExecutionPolicy(): { mutates: boolean; parallelSafe: boolean; cacheable: boolean } {
    // A subagent may write files, launch processes, or mutate memory even when
    // the selected child agent is read-only, so keep delegation serialized.
    return { mutates: true, parallelSafe: false, cacheable: false }
  }

  get parameters(): Record<string, ToolParameterDef> {
    return {
      description: {
        type: 'string',
        description: 'Краткое действие (2-4 слова, напр. "Анализ данных субагентом")',
        required: false
      },
      prompt: {
        type: 'string',
        description: '[Single task] Task prompt or research question to delegate to the subagent',
        required: false
      },
      context: {
        type: 'string',
        description: 'Optional additional context, document snippets, paths, or background info for the subagent',
        required: false
      },
      agent_id: {
        type: 'string',
        description: 'Target subagent: architect (architecture planning & decomposition) | ask (read-only research/investigation) | worker (autonomous code edits/tests/builds) | terminal (shell operations) | web_search (online research). Default: "ask"',
        required: false,
        enum: ['architect', 'ask', 'worker', 'terminal', 'web_search']
      },
      model_tier: {
        type: 'string',
        description: 'Optional model tier for the subagent: "fast" (use fast lightweight model) | "inherit" (default, use main model) | "heavy"',
        required: false,
        enum: ['fast', 'inherit', 'heavy']
      },
      tasks: {
        type: 'array',
        description: '[Parallel swarm] List of 2-5 subtasks to execute concurrently (prompt strings or task objects)',
        required: false,
        items: {
          type: 'object',
          properties: {
            prompt: {
              type: 'string',
              description: 'Task prompt or instruction'
            },
            agent_id: {
              type: 'string',
              description: 'Subagent: architect | ask | worker | terminal | web_search',
              enum: ['architect', 'ask', 'worker', 'terminal', 'web_search']
            },
            context: {
              type: 'string',
              description: 'Additional context or file paths'
            },
            model_tier: {
              type: 'string',
              description: 'Model tier: fast | inherit | heavy',
              enum: ['fast', 'inherit', 'heavy']
            }
          }
        }
      }
    }
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
      return { formattedContent: 'Error: invalid JSON arguments for ask_agent.' }
    }

    const rawTasks = Array.isArray(args.tasks) ? args.tasks : []
    const parsedTasks: AskSubTask[] = rawTasks.map((t: any) => {
      if (typeof t === 'string') {
        try {
          const parsed = JSON.parse(t)
          if (parsed && typeof parsed === 'object') return parsed
        } catch {}
        return { prompt: t, agent_id: 'ask' }
      }
      return t
    })

    const tasksList: AskSubTask[] =
      parsedTasks.length > 0
        ? parsedTasks
        : args.prompt
          ? [{ prompt: args.prompt, context: args.context, agent_id: args.agent_id, model_tier: args.model_tier }]
          : []

    if (tasksList.length === 0) {
      return { formattedContent: 'Error: prompt or non-empty tasks parameter is required for ask_agent.' }
    }

    // Check subagent recursion depth to avoid infinite loops
    const currentDepth = Number(blackboard?.getArtifact('subagent_depth')) || 0
    if (currentDepth >= 3) {
      return { formattedContent: 'Error: maximum subagent call depth reached (3).' }
    }

    const baseConfig: any = blackboard?.getArtifact('config') || {}
    const workspacePath =
      (blackboard?.getArtifact('workspacePath') as string) || baseConfig.workspacePath || baseConfig.baseDir || process.cwd()
    const tavilyKey = (blackboard?.getArtifact('tavilyKey') as string) || baseConfig.tavilyKey || ''

    // Cap maximum parallel subagents at 5
    const boundedTasks = tasksList.slice(0, 5)

    // Shared state across all concurrent subagent tasks in this AskTool call
    const taskStepsMap: Map<number, any[]> = new Map()
    const taskAnswersMap: Map<number, string> = new Map()

    const getAllInnerSteps = (): any[] => {
      const all: any[] = []
      for (let i = 0; i < boundedTasks.length; i++) {
        const steps = taskStepsMap.get(i)
        if (steps && steps.length > 0) {
          all.push(...steps)
        }
      }
      return all
    }

    const getTotalToolCount = (): number => {
      let count = 0
      for (let i = 0; i < boundedTasks.length; i++) {
        const steps = taskStepsMap.get(i)
        if (steps) {
          count += steps.filter((s) => s.type !== 'thought').length
        }
      }
      return count
    }

    const runSingleTask = async (taskItem: AskSubTask, index: number) => {
      const prompt = taskItem.prompt || ''
      const targetAgentId = taskItem.agent_id || args.agent_id || 'ask'

      let subAgent: any
      try {
        subAgent = agentRegistry.getAgent(targetAgentId)
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err)
        return {
          agentName: targetAgentId,
          prompt,
          answer: `Error invoking subagent: ${msg}`,
          innerSteps: [],
          error: true
        }
      }

      let subModel = baseConfig.model
      const tier = taskItem.model_tier || args.model_tier || 'inherit'
      if (tier === 'fast') {
        subModel = baseConfig.fastModel || baseConfig.subagentModel || baseConfig.model
      }

      const searchProvider =
        (blackboard?.getArtifact('searchProvider') as string) || baseConfig.searchProvider || 'duckduckgo'

      const subConfig = {
        ...baseConfig,
        model: subModel,
        baseDir: workspacePath,
        workspacePath,
        tavilyKey,
        searchProvider
      }

      const loadedSkills =
        (blackboard?.getArtifact('loaded_skills') as Array<{ name: string; content: string }>) || []
      let activeSkillsContext = ''
      if (loadedSkills.length > 0) {
        activeSkillsContext =
          '### Активные навыки (загружены сессией):\n' +
          loadedSkills.map((s) => `#### [Навык: ${s.name}]\n${s.content}`).join('\n\n')
      }

      const promptParts = [prompt]
      if (taskItem.context) {
        promptParts.push(`### Additional Context / Files:\n${taskItem.context}`)
      }
      if (activeSkillsContext) {
        promptParts.push(activeSkillsContext)
      }

      const fullPrompt = promptParts.join('\n\n')

      const history = [{ role: 'user', content: fullPrompt }]
      const childBlackboard = blackboard ? blackboard.createChild() : null
      if (childBlackboard) {
        childBlackboard.setArtifact('subagent_depth', String(currentDepth + 1), false)
      }

      let accumulatedAnswer = ''
      const innerSteps: any[] = []
      let currentThinkStep: any = null

      const mapSubagentStepType = (toolName: string, action?: string): string => {
        switch (toolName) {
          case 'file':
            if (action === 'edit' || action === 'delete' || action === 'move') return 'edit'
            if (action === 'write' || action === 'create_dir' || action === 'append') return 'create'
            return 'read'
          case 'grep_search':
            return 'grep'
          case 'terminal':
            return 'run'
          case 'search_web':
            return 'web_search'
          case 'read_page':
            return 'read_page'
          case 'memory':
            return 'memory'
          case 'schedule':
            return 'schedule'
          case 'read_skill':
            return 'read_skill'
          case 'save_skill':
            return 'save_skill'
          default:
            return 'read'
        }
      }

      const getSubagentActionLabel = (toolName: string, action?: string): string => {
        switch (toolName) {
          case 'file':
            if (action === 'edit') return 'Edit'
            if (action === 'write' || action === 'append') return 'Create'
            if (action === 'delete') return 'Delete'
            if (action === 'list' || action === 'read_tree' || action === 'glob') return 'List'
            return 'Read'
          case 'grep_search':
            return 'Search'
          case 'terminal':
            return 'Run'
          case 'search_web':
            return 'Web Search'
          case 'read_page':
            return 'Read Web'
          case 'memory':
            return action === 'save' ? 'Remember' : 'Memory'
          case 'schedule':
            return 'Schedule'
          case 'read_skill':
            return 'Load Skill'
          case 'save_skill':
            return 'Save Skill'
          default:
            return 'Execute'
        }
      }

      const getSubagentTarget = (toolName: string, tArgs: Record<string, any> = {}): string => {
        if (tArgs.description) return String(tArgs.description)
        if (toolName === 'file') return tArgs.path || tArgs.dest_path || ''
        if (toolName === 'grep_search') return tArgs.query ? `"${tArgs.query}"` : ''
        if (toolName === 'terminal') return tArgs.command || tArgs.action || ''
        if (toolName === 'search_web') return tArgs.query ? `"${tArgs.query}"` : ''
        if (toolName === 'read_page') return tArgs.url || ''
        if (toolName === 'memory') return tArgs.content || tArgs.action || ''
        if (toolName === 'schedule') return tArgs.title || tArgs.prompt || tArgs.action || ''
        if (toolName === 'read_skill') return tArgs.skill_name || ''
        if (toolName === 'save_skill') return tArgs.skill_name || ''
        return ''
      }

      const subOnEvent = (evt: any) => {
        if (evt.type === 'token') {
          accumulatedAnswer += evt.content
          taskAnswersMap.set(index, accumulatedAnswer)
          if (typeof onProgress === 'function') {
            const allSteps = getAllInnerSteps()
            const totalTools = getTotalToolCount()
            onProgress({
              statusText: boundedTasks.length > 1
                ? `[Субагент ${index + 1}/${boundedTasks.length}] ${subAgent.name}: Отвечает... (тулок суммарно: ${totalTools})`
                : `[${subAgent.name}]: Отвечает...`,
              innerSteps: allSteps,
              data: {
                taskIndex: index,
                agentId: subAgent.id,
                agentName: subAgent.name,
                prompt,
                partialAnswer: accumulatedAnswer,
                taskInnerSteps: [...innerSteps],
                allInnerSteps: allSteps,
                totalToolsCount: totalTools
              }
            })
          }
        } else if (evt.type === 'reasoning') {
          if (!currentThinkStep) {
            currentThinkStep = {
              id: `sub_think_${Date.now()}_${Math.random()}`,
              type: 'thought',
              name: 'thought',
              action: 'Thinking',
              target: '',
              args: {},
              content: evt.content,
              status: 'loading',
              result: evt.content,
              error: false
            }
            innerSteps.push(currentThinkStep)
          } else {
            currentThinkStep.content += evt.content
            currentThinkStep.result = currentThinkStep.content
          }
          taskStepsMap.set(index, [...innerSteps])
          if (typeof onProgress === 'function') {
            try {
              const allSteps = getAllInnerSteps()
              const totalTools = getTotalToolCount()
              onProgress({
                statusText: boundedTasks.length > 1
                  ? `[Субагент ${index + 1}/${boundedTasks.length}] ${subAgent.name}: Размышляет... (тулок суммарно: ${totalTools})`
                  : `[${subAgent.name}]: Размышляет...`,
                innerSteps: allSteps,
                data: {
                  taskIndex: index,
                  agentId: subAgent.id,
                  agentName: subAgent.name,
                  prompt,
                  taskInnerSteps: [...innerSteps],
                  allInnerSteps: allSteps,
                  totalToolsCount: totalTools
                }
              })
            } catch {}
          }
        } else if (evt.type === 'tool_start') {
          currentThinkStep = null
          const action = evt.args?.action
          const sType = mapSubagentStepType(evt.toolName, action)
          const sAction = getSubagentActionLabel(evt.toolName, action)
          const sTarget = getSubagentTarget(evt.toolName, evt.args || {})

          let stats: { add?: number; del?: number } | undefined = undefined
          if (evt.args?.old_content && evt.args?.new_content) {
            stats = {
              add: String(evt.args.new_content).split('\n').length,
              del: String(evt.args.old_content).split('\n').length
            }
          } else if (evt.args?.new_content) {
            stats = { add: String(evt.args.new_content).split('\n').length }
          }

          const toolStep = {
            id: evt.callId || `sub_call_${Math.random().toString(36).slice(2)}`,
            type: sType,
            name: evt.toolName,
            action: sAction,
            target: sTarget,
            args: evt.args || {},
            stats,
            status: 'loading',
            result: null,
            error: false
          }
          innerSteps.push(toolStep)
          taskStepsMap.set(index, [...innerSteps])

          if (typeof onProgress === 'function') {
            try {
              const allSteps = getAllInnerSteps()
              const totalTools = getTotalToolCount()
              onProgress({
                statusText: boundedTasks.length > 1
                  ? `[Субагент ${index + 1}/${boundedTasks.length}] ${subAgent.name}: ${evt.toolName}... (тулок суммарно: ${totalTools})`
                  : `[${subAgent.name}]: ${evt.toolName}... (тулок: ${totalTools})`,
                innerSteps: allSteps,
                data: {
                  taskIndex: index,
                  agentId: subAgent.id,
                  agentName: subAgent.name,
                  prompt,
                  taskInnerSteps: [...innerSteps],
                  allInnerSteps: allSteps,
                  totalToolsCount: totalTools
                }
              })
            } catch {}
          }
        } else if (evt.type === 'tool_result') {
          const target = innerSteps.find((s) => s.id === evt.callId)
          if (target) {
            target.status = evt.error ? 'error' : 'done'
            target.result = evt.result
            target.error = evt.error
            if (evt.data?.stats) {
              target.stats = evt.data.stats
            } else if (target.args?.old_content && target.args?.new_content) {
              target.stats = {
                add: String(target.args.new_content).split('\n').length,
                del: String(target.args.old_content).split('\n').length
              }
            } else if (target.args?.new_content || (target.type === 'create' && target.args?.content)) {
              target.stats = { add: String(target.args.new_content || target.args?.content).split('\n').length }
            }
          }
          taskStepsMap.set(index, [...innerSteps])

          if (typeof onProgress === 'function') {
            try {
              const allSteps = getAllInnerSteps()
              const totalTools = getTotalToolCount()
              onProgress({
                statusText: boundedTasks.length > 1
                  ? `[Субагент ${index + 1}/${boundedTasks.length}] ${subAgent.name}: выполнено (тулок суммарно: ${totalTools})`
                  : `[${subAgent.name}]: выполнено (тулок: ${totalTools})`,
                innerSteps: allSteps,
                data: {
                  taskIndex: index,
                  agentId: subAgent.id,
                  agentName: subAgent.name,
                  prompt,
                  taskInnerSteps: [...innerSteps],
                  allInnerSteps: allSteps,
                  totalToolsCount: totalTools
                }
              })
            } catch {}
          }
        }
      }

      try {
        if (typeof onProgress === 'function') {
          const allSteps = getAllInnerSteps()
          const totalTools = getTotalToolCount()
          onProgress({
            statusText: boundedTasks.length > 1
              ? `[Субагент ${index + 1}/${boundedTasks.length}] Запуск ${subAgent.name}... (тулок суммарно: ${totalTools})`
              : `Запуск ${subAgent.name}...`,
            innerSteps: allSteps,
            data: {
              taskIndex: index,
              agentId: subAgent.id,
              agentName: subAgent.name,
              prompt,
              taskInnerSteps: [...innerSteps],
              allInnerSteps: allSteps,
              totalToolsCount: totalTools
            }
          })
        }

        await this.runnerFn(subAgent, history, subConfig, subOnEvent, abortSignal, childBlackboard)

        for (const step of innerSteps) {
          if (step.type === 'think' || step.type === 'thought') step.status = 'done'
        }
        taskStepsMap.set(index, [...innerSteps])

        if (!accumulatedAnswer.trim()) {
          accumulatedAnswer = 'Субагент выполнил задачу.'
        }

        return {
          agentName: subAgent.name,
          agentId: subAgent.id,
          prompt,
          answer: accumulatedAnswer.trim(),
          innerSteps: innerSteps.map((s) => ({
            id: s.id,
            type: s.type || 'tool',
            name: s.name || s.type,
            action: s.action,
            target: s.target,
            args: s.args,
            stats: s.stats,
            result: s.result || s.content,
            status: s.status || 'done',
            error: s.error || false
          }))
        }
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err)
        return {
          agentName: subAgent.name,
          agentId: subAgent.id,
          prompt,
          answer: `Subagent execution error: ${msg}`,
          innerSteps: [],
          error: true
        }
      }
    }

    try {
      const results = await Promise.all(boundedTasks.map((t, i) => runSingleTask(t, i)))

      if (results.length === 1) {
        const res = results[0]
        const formattedText = `### Ответ субагента (${res.agentName}):\n${res.answer}`
        return {
          formattedContent: formattedText,
          data: {
            agentId: res.agentId,
            agentName: res.agentName,
            depth: currentDepth + 1,
            innerSteps: res.innerSteps,
            allInnerSteps: res.innerSteps,
            answer: res.answer,
            prompt: res.prompt
          }
        }
      }

      const combinedSummary = results
        .map((r, i) => `### Задача ${i + 1} (${r.agentName} — "${r.prompt}"):\n${r.answer}`)
        .join('\n\n')

      const allResultsSteps = results.flatMap((r) => r.innerSteps || [])

      return {
        formattedContent: `### Результаты выполнения субагентов (${results.length} задач):\n\n${combinedSummary}`,
        data: {
          swarm: true,
          tasksCount: results.length,
          depth: currentDepth + 1,
          innerSteps: allResultsSteps,
          allInnerSteps: allResultsSteps,
          results
        }
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      return { formattedContent: `Swarm execution error: ${msg}` }
    }
  }
}
