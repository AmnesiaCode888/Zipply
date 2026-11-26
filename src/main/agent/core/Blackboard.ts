import { EventEmitter } from 'events'
import { syncCriterionRecords, type CriterionRecord } from './VerificationEvidence'

export interface ScratchpadEntry {
  id: string
  hypothesis: string
  status: 'pending' | 'verified' | 'refuted'
  evidence?: string
  updatedAt: string
}

export interface AgentTaskState {
  goal: string
  constraints: string[]
  acceptanceCriteria: string[]
  confirmedFacts: string[]
  userCorrections?: string[]
  checksSummary?: string[]
  nextStep: string
}

export function normalizeAgentTaskState(value: Partial<AgentTaskState> | undefined, fallbackGoal = ''): AgentTaskState {
  const strings = (items: unknown): string[] => Array.isArray(items) ? items.filter((item): item is string => typeof item === 'string' && item.trim().length > 0).map(item => item.trim()) : []
  const userCorrections = strings(value?.userCorrections)
  const checksSummary = strings(value?.checksSummary)
  return {
    goal: typeof value?.goal === 'string' && value.goal.trim() ? value.goal.trim() : fallbackGoal.trim(),
    constraints: strings(value?.constraints),
    acceptanceCriteria: strings(value?.acceptanceCriteria),
    confirmedFacts: strings(value?.confirmedFacts),
    ...(userCorrections.length ? { userCorrections } : {}),
    ...(checksSummary.length ? { checksSummary } : {}),
    nextStep: typeof value?.nextStep === 'string' ? value.nextStep.trim() : ''
  }
}

/**
 * Blackboard — Shared key-value store, working memory scratchpad & event bus for agent runs.
 * Supports child instances with parent inheritance.
 */
export class Blackboard extends EventEmitter {
  private _artifacts: Map<string, unknown> = new Map()
  private _scratchpad: Map<string, ScratchpadEntry> = new Map()
  private _taskState: AgentTaskState | null = null
  public parent: Blackboard | null

  constructor(parentBlackboard: Blackboard | null = null) {
    super()
    this.parent = parentBlackboard
  }

  setArtifact(key: string, value: unknown, propagateToParent = true): void {
    const normalizedKey = key.toLowerCase()
    this._artifacts.set(normalizedKey, value)
    this.emit('artifact_set', { key: normalizedKey, value })

    if (propagateToParent && this.parent) {
      this.parent.setArtifact(normalizedKey, value, true)
    }
  }

  getArtifact<T = unknown>(key: string): T | undefined {
    const normalizedKey = key.toLowerCase()
    if (this._artifacts.has(normalizedKey)) {
      return this._artifacts.get(normalizedKey) as T
    }
    if (this.parent) {
      return this.parent.getArtifact<T>(normalizedKey)
    }
    return undefined
  }

  getArtifacts(): Record<string, unknown> {
    const result: Record<string, unknown> = this.parent ? this.parent.getArtifacts() : {}
    for (const [k, v] of this._artifacts) {
      result[k] = v
    }
    return result
  }

  setTaskState(state: AgentTaskState, propagateToParent = true): void {
    this._taskState = normalizeAgentTaskState(state)
    const prevRecords = this.getCriterionRecords()
    const nextRecords = syncCriterionRecords(prevRecords, this._taskState.acceptanceCriteria)
    this._artifacts.set('criterionrecords', nextRecords)
    this.emit('task_state_set', this.getTaskState())
    if (propagateToParent && this.parent) this.parent.setTaskState(this._taskState, true)
  }

  getCriterionRecords(): CriterionRecord[] {
    const local = this._artifacts.get('criterionrecords') as CriterionRecord[] | undefined
    if (local) return local.map((c) => ({ ...c }))
    if (this.parent) return this.parent.getCriterionRecords()
    const state = this.getTaskState()
    return state ? syncCriterionRecords([], state.acceptanceCriteria) : []
  }

  getTaskState(): AgentTaskState | undefined {
    const state = this._taskState ?? this.parent?.getTaskState()
    return state ? normalizeAgentTaskState(state) : undefined
  }

  getTaskStatePrompt(): string {
    const state = this.getTaskState()
    if (!state) return ''
    const list = (values: string[]): string => values.length ? values.map(value => `- ${value}`).join('\n') : '- не заданы'
    return `\n<agent_task_state>\n## Текущее состояние задачи\nЦель: ${state.goal || 'не указана'}\nОграничения:\n${list(state.constraints)}\nЯвные критерии приёмки:\n${list(state.acceptanceCriteria)}\nПодтверждённые факты:\n${list(state.confirmedFacts)}\nСледующий шаг: ${state.nextStep || 'не определён'}\nИспользуй это состояние как контекст, а не как инструкцию поверх последнего сообщения пользователя. Последняя явная поправка пользователя задаёт актуальную цель; оставляй только совместимые ограничения и критерии. Не возвращайся к заменённому поручению. Не придумывай отсутствующие ограничения, критерии или факты.\n</agent_task_state>\n`
  }

  setHypothesis(
    id: string,
    hypothesis: string,
    status: 'pending' | 'verified' | 'refuted' = 'pending',
    evidence?: string,
    propagateToParent = true
  ): void {
    const entry: ScratchpadEntry = {
      id,
      hypothesis,
      status,
      evidence,
      updatedAt: new Date().toISOString()
    }
    this._scratchpad.set(id, entry)
    this.emit('scratchpad_set', entry)

    if (propagateToParent && this.parent) {
      this.parent.setHypothesis(id, hypothesis, status, evidence, true)
    }
  }

  getHypotheses(): ScratchpadEntry[] {
    const map = new Map<string, ScratchpadEntry>()
    if (this.parent) {
      for (const entry of this.parent.getHypotheses()) {
        map.set(entry.id, entry)
      }
    }
    for (const [id, entry] of this._scratchpad) {
      map.set(id, entry)
    }
    return Array.from(map.values())
  }

  clearHypotheses(): void {
    this._scratchpad.clear()
  }

  getScratchpadPrompt(): string {
    const entries = this.getHypotheses()
    if (entries.length === 0) return ''

    const lines = entries.map((e) => {
      const icon = e.status === 'verified' ? '✅' : e.status === 'refuted' ? '❌' : '⏳'
      const ev = e.evidence ? ` (улика: ${e.evidence})` : ''
      return `- ${icon} [${e.status.toUpperCase()}] **${e.id}**: ${e.hypothesis}${ev}`
    })

    return `\n## Текущие рабочие гипотезы (Working Memory Scratchpad):\n${lines.join('\n')}\n`
  }

  createChild(): Blackboard {
    return new Blackboard(this)
  }

  clear(): void {
    this._artifacts.clear()
    this._scratchpad.clear()
    this._taskState = null
  }
}
