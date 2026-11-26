import type { AgentUsage } from '../../../shared/agentEvents'
import type { ChatResponseUsage } from '../services/ChatService'

interface RootBudgetState {
  startedAt: number
  maxTokens?: number
  maxTimeMs?: number
  deadlineMs?: number
  reservedOutstanding: number
  treeBudgetTokens: number
  treeComplete: boolean
  treeEstimated: boolean
  treeUsage: {
    promptTokens: number
    completionTokens: number
    totalTokens: number
    cachedTokens?: number
  }
}

export interface RunBudgetReservation {
  readonly budget: RunBudget
  readonly reservedTokens: number
  release(): void
}

export class RunBudget {
  private readonly root: RootBudgetState
  private readonly parent: RunBudget | null
  private unspentReserve: number
  private ownBudgetTokens = 0
  private ownComplete = true
  private ownEstimated = false
  private ownUsage: {
    promptTokens: number
    completionTokens: number
    totalTokens: number
    cachedTokens?: number
  } = { promptTokens: 0, completionTokens: 0, totalTokens: 0 }

  constructor(options: {
    maxTokens?: number
    maxTimeMs?: number
    startedAt?: number
    parent?: RunBudget
    reservedTokens?: number
  } = {}) {
    if (options.parent) {
      this.parent = options.parent
      this.root = options.parent.root
      this.unspentReserve = Math.max(0, options.reservedTokens ?? 0)
    } else {
      this.parent = null
      this.unspentReserve = 0
      const startedAt = options.startedAt ?? Date.now()
      const maxTokens = typeof options.maxTokens === 'number' && options.maxTokens > 0 ? options.maxTokens : undefined
      const maxTimeMs = typeof options.maxTimeMs === 'number' && options.maxTimeMs > 0 ? options.maxTimeMs : undefined
      this.root = {
        startedAt,
        maxTokens,
        maxTimeMs,
        deadlineMs: maxTimeMs !== undefined ? startedAt + maxTimeMs : undefined,
        reservedOutstanding: 0,
        treeBudgetTokens: 0,
        treeComplete: true,
        treeEstimated: false,
        treeUsage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 }
      }
    }
  }

  getMaxTokens(): number | undefined {
    return this.root.maxTokens
  }

  getTimeLimitMs(): number | undefined {
    return this.root.maxTimeMs
  }

  remainingTimeMs(now = Date.now()): number | undefined {
    if (this.root.deadlineMs === undefined) return undefined
    return Math.max(0, this.root.deadlineMs - now)
  }

  isTimeLimitExceeded(now = Date.now()): boolean {
    return this.root.deadlineMs !== undefined && now >= this.root.deadlineMs
  }

  isTokenLimitExceeded(): boolean {
    const limit = this.root.maxTokens
    if (typeof limit !== 'number' || limit <= 0) return false
    return Math.max(this.root.treeUsage.totalTokens, this.root.treeBudgetTokens) >= limit
  }

  remainingTokens(): number {
    const limit = this.root.maxTokens
    if (typeof limit !== 'number' || limit <= 0) return Number.POSITIVE_INFINITY
    const used = Math.max(this.root.treeUsage.totalTokens, this.root.treeBudgetTokens)
    return Math.max(0, limit - used - this.root.reservedOutstanding)
  }

  isTreeEstimated(): boolean {
    return this.root.treeEstimated
  }

  recordUsage(usage?: ChatResponseUsage, estimate?: ChatResponseUsage): void {
    let addPrompt = 0
    let addCompletion = 0
    let addTotal = 0
    let addCached: number | undefined
    let complete = true
    let estimated = false
    let addBudget = 0

    if (!usage || usage.complete === false) {
      complete = false
      estimated = true
      if (usage) {
        addPrompt = usage.promptTokens || 0
        addCompletion = usage.completionTokens || 0
        addTotal = usage.totalTokens || addPrompt + addCompletion
        if (typeof usage.cachedTokens === 'number') addCached = usage.cachedTokens
      }
      addBudget = usage?.totalTokens || estimate?.totalTokens || 0
    } else {
      addPrompt = usage.promptTokens
      addCompletion = usage.completionTokens
      addTotal = usage.totalTokens
      if (typeof usage.cachedTokens === 'number') addCached = usage.cachedTokens
      addBudget = usage.totalTokens
    }

    const addToTotals = (
      target: { promptTokens: number; completionTokens: number; totalTokens: number; cachedTokens?: number }
    ): void => {
      target.promptTokens += addPrompt
      target.completionTokens += addCompletion
      target.totalTokens += addTotal
      if (addCached !== undefined || target.cachedTokens !== undefined) {
        target.cachedTokens = (target.cachedTokens || 0) + (addCached || 0)
      }
    }

    let cursor: RunBudget | null = this
    while (cursor) {
      addToTotals(cursor.ownUsage)
      cursor.ownBudgetTokens += addBudget
      if (!complete) cursor.ownComplete = false
      if (estimated) cursor.ownEstimated = true
      if (cursor.unspentReserve > 0 && addBudget > 0) {
        const consume = Math.min(cursor.unspentReserve, addBudget)
        cursor.unspentReserve -= consume
        this.root.reservedOutstanding = Math.max(0, this.root.reservedOutstanding - consume)
      }
      cursor = cursor.parent
    }

    addToTotals(this.root.treeUsage)
    this.root.treeBudgetTokens += addBudget
    if (!complete) this.root.treeComplete = false
    if (estimated) this.root.treeEstimated = true
  }

  getUsage(): AgentUsage {
    return {
      ...this.ownUsage,
      complete: this.ownComplete,
      ...(this.ownEstimated ? { estimated: true, estimateMethod: 'serialized characters ÷ 3.2' } : {})
    }
  }

  getTreeUsage(): AgentUsage {
    return {
      ...this.root.treeUsage,
      complete: this.root.treeComplete,
      ...(this.root.treeEstimated ? { estimated: true, estimateMethod: 'serialized characters ÷ 3.2' } : {})
    }
  }

  tryReserveChild(requestedReserve?: number): RunBudgetReservation | null {
    if (this.isTimeLimitExceeded() || this.isTokenLimitExceeded()) return null
    const limit = this.root.maxTokens
    if (typeof limit !== 'number' || limit <= 0) {
      const child = new RunBudget({ parent: this, reservedTokens: 0 })
      return { budget: child, reservedTokens: 0, release: () => {} }
    }

    const available = this.remainingTokens()
    if (available <= 0) return null

    let reserve: number
    if (typeof requestedReserve === 'number') {
      if (requestedReserve > available) return null
      reserve = Math.max(0, Math.floor(requestedReserve))
    } else {
      reserve = Math.min(available, Math.max(1, Math.floor(limit * 0.1)))
    }

    this.root.reservedOutstanding += reserve
    const child = new RunBudget({ parent: this, reservedTokens: reserve })
    let released = false
    return {
      budget: child,
      reservedTokens: reserve,
      release: () => {
        if (released) return
        released = true
        if (child.unspentReserve > 0) {
          this.root.reservedOutstanding = Math.max(0, this.root.reservedOutstanding - child.unspentReserve)
          child.unspentReserve = 0
        }
      }
    }
  }
}
