import { EventEmitter } from 'events'
import { randomUUID } from 'crypto'
import type { AgentRunCheck, AgentUsage, AgentVerificationStatus } from '../../../shared/agentEvents'
import type { SubagentRole, SubagentSnapshot, SubagentStatus } from '../../../shared/subagents'

export type { SubagentRole, SubagentSnapshot, SubagentStatus } from '../../../shared/subagents'

export interface SubagentScope {
  rootRunId?: string
  senderId?: number
  sessionId?: string
}

export interface SubagentRunResult {
  summary?: string
  error?: string
  rounds?: number
  toolCallsCount?: number
  usage?: AgentUsage
  verificationStatus?: AgentVerificationStatus
  checks?: AgentRunCheck[]
  resultData?: Record<string, unknown>
}

export interface SubagentSpawnInput {
  rootRunId: string
  parentId?: string
  senderId?: number
  sessionId?: string
  role: SubagentRole
  task: string
  parentAbortSignal?: AbortSignal
  run: (context: {
    id: string
    signal: AbortSignal
    consumeSteers: () => string[]
  }) => Promise<SubagentRunResult>
  onTerminal?: (status: SubagentStatus, result?: SubagentRunResult) => Promise<SubagentRunResult | void> | SubagentRunResult | void
}

interface InternalSubagent {
  snapshot: SubagentSnapshot
  senderId?: number
  intent?: 'interrupt' | 'stop'
  parentAbortSignal?: AbortSignal
  parentAbortListener?: () => void
  controller?: AbortController
  run: SubagentSpawnInput['run']
  onTerminal?: SubagentSpawnInput['onTerminal']
  steers: string[]
  finalized: boolean
}

const TERMINAL = new Set<SubagentStatus>(['completed', 'failed', 'cancelled'])
const ACTIVE = new Set<SubagentStatus>(['queued', 'running', 'stopping'])
const DEFAULT_MAX_PER_ROOT = 4
const DEFAULT_MAX_GLOBAL = 12
const MAX_RETAINED_PER_OWNER = 80

function isTerminal(status: SubagentStatus): boolean {
  return TERMINAL.has(status)
}

/** Owns child-run lifecycle and keeps user-visible snapshots separate from child transcripts. */
export class SubagentManager extends EventEmitter {
  private readonly records = new Map<string, InternalSubagent>()
  private readonly maxConcurrentPerRoot: number
  private readonly maxConcurrentGlobal: number

  constructor(options: { maxConcurrentPerRoot?: number; maxConcurrentGlobal?: number } = {}) {
    super()
    this.setMaxListeners(0)
    this.maxConcurrentPerRoot = Math.max(1, Math.floor(options.maxConcurrentPerRoot ?? DEFAULT_MAX_PER_ROOT))
    this.maxConcurrentGlobal = Math.max(1, Math.floor(options.maxConcurrentGlobal ?? DEFAULT_MAX_GLOBAL))
  }

  spawn(input: SubagentSpawnInput): SubagentSnapshot {
    const rootRunId = input.rootRunId.trim()
    const task = input.task.trim()
    if (!rootRunId) throw new Error('Не задан корневой запуск субагентов.')
    if (!task) throw new Error('Поручение субагенту не может быть пустым.')
    if (typeof input.run !== 'function') throw new Error('Не задан исполнитель субагента.')

    const active = [...this.records.values()].filter(record => ACTIVE.has(record.snapshot.status))
    const activeForRoot = active.filter(record => record.snapshot.rootRunId === rootRunId).length
    if (activeForRoot >= this.maxConcurrentPerRoot) {
      throw new Error(`Достигнут лимит субагентов для запуска (${this.maxConcurrentPerRoot}).`)
    }
    if (active.length >= this.maxConcurrentGlobal) {
      throw new Error(`Достигнут общий лимит активных субагентов (${this.maxConcurrentGlobal}).`)
    }

    const now = Date.now()
    const id = randomUUID()
    const record: InternalSubagent = {
      snapshot: {
        id,
        ...(input.parentId ? { parentId: input.parentId } : {}),
        rootRunId,
        ...(input.sessionId ? { sessionId: input.sessionId } : {}),
        role: input.role,
        task,
        status: 'queued',
        createdAt: now,
        updatedAt: now,
        toolCallsCount: 0
      },
      senderId: input.senderId,
      parentAbortSignal: input.parentAbortSignal,
      run: input.run,
      onTerminal: input.onTerminal,
      steers: [],
      finalized: false
    }
    this.records.set(id, record)
    this.publish(record)

    if (input.parentAbortSignal?.aborted) {
      record.intent = 'stop'
      record.snapshot.status = 'cancelled'
      record.snapshot.error = 'Корневой запуск отменён до начала субагента.'
      this.publish(record)
      void this.finish(record, undefined)
    } else {
      if (input.parentAbortSignal) {
        record.parentAbortListener = () => { void this.stop({ rootRunId }, id, { recursive: true }) }
        input.parentAbortSignal.addEventListener('abort', record.parentAbortListener, { once: true })
      }
      void this.execute(record)
    }

    return this.toSnapshot(record)
  }

  list(scope: SubagentScope, parentId?: string): SubagentSnapshot[] {
    this.validateScope(scope)
    return [...this.records.values()]
      .filter(record => this.matches(record, scope))
      .filter(record => !parentId || this.isDescendant(record, parentId))
      .sort((a, b) => a.snapshot.createdAt - b.snapshot.createdAt)
      .map(record => this.toSnapshot(record))
  }

  listForOwner(senderId: number, sessionId: string): SubagentSnapshot[] {
    return this.list({ senderId, sessionId })
  }

  get(scope: SubagentScope, id: string): SubagentSnapshot {
    const record = this.require(scope, id)
    return this.toSnapshot(record)
  }

  async wait(scope: SubagentScope, id: string, timeoutMs = 30_000, signal?: AbortSignal): Promise<SubagentSnapshot> {
    const record = this.require(scope, id)
    if (isTerminal(record.snapshot.status) || record.snapshot.status === 'interrupted') return this.toSnapshot(record)
    const boundedTimeout = Math.min(120_000, Math.max(0, Math.floor(timeoutMs)))
    if (boundedTimeout === 0 || signal?.aborted) return this.toSnapshot(record)

    return new Promise(resolve => {
      let settled = false
      const finish = (): void => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        this.removeListener('update', onUpdate)
        signal?.removeEventListener('abort', finish)
        resolve(this.toSnapshot(record))
      }
      const onUpdate = (snapshot: SubagentSnapshot): void => {
        if (snapshot.id === id && (isTerminal(snapshot.status) || snapshot.status === 'interrupted')) finish()
      }
      const timer = setTimeout(finish, boundedTimeout)
      this.on('update', onUpdate)
      signal?.addEventListener('abort', finish, { once: true })
      if (isTerminal(record.snapshot.status) || record.snapshot.status === 'interrupted') finish()
    })
  }

  steer(scope: SubagentScope, id: string, message: string): SubagentSnapshot {
    const record = this.require(scope, id)
    const text = message.trim()
    if (!text) throw new Error('Инструкция для субагента не может быть пустой.')
    if (record.snapshot.status !== 'running') throw new Error('Направить инструкцию можно только работающему субагенту.')
    record.steers.push(text)
    this.update(record.snapshot.id, { activity: 'Получена инструкция; применится на следующем безопасном шаге.' })
    return this.toSnapshot(record)
  }

  consumeSteers(id: string): string[] {
    const record = this.records.get(id)
    if (!record || record.steers.length === 0) return []
    const messages = record.steers.splice(0)
    this.update(id, { activity: 'Инструкция применена.' })
    return messages
  }

  update(id: string, patch: Partial<Omit<SubagentSnapshot, 'id' | 'rootRunId' | 'parentId' | 'sessionId' | 'role' | 'task' | 'createdAt'>>): SubagentSnapshot | undefined {
    const record = this.records.get(id)
    if (!record || isTerminal(record.snapshot.status)) return undefined
    Object.assign(record.snapshot, patch)
    this.publish(record)
    return this.toSnapshot(record)
  }

  async interrupt(scope: SubagentScope, id: string, recursive = true): Promise<SubagentSnapshot> {
    const record = this.require(scope, id)
    if (!isTerminal(record.snapshot.status) && record.snapshot.status !== 'interrupted') {
      record.intent = 'interrupt'
      if (record.snapshot.status !== 'queued') record.snapshot.status = 'stopping'
      record.snapshot.activity = 'Прерывание запрошено.'
      this.publish(record)
      record.controller?.abort()
      if (!record.controller) {
        record.snapshot.status = 'interrupted'
        record.snapshot.activity = 'Прервано до запуска; можно продолжить в этом запуске.'
        this.publish(record)
      }
    }
    if (recursive) await this.interruptDescendants(scope, id)
    return this.toSnapshot(record)
  }

  async stop(scope: SubagentScope, id: string, options: { recursive?: boolean } = {}): Promise<SubagentSnapshot> {
    const record = this.require(scope, id)
    if (!isTerminal(record.snapshot.status) && record.snapshot.status !== 'interrupted') {
      record.intent = 'stop'
      record.snapshot.status = 'stopping'
      record.snapshot.activity = 'Остановка запрошена.'
      this.publish(record)
      record.controller?.abort()
      if (!record.controller) await this.finish(record, { summary: 'Операция остановлена до запуска.' })
    } else if (record.snapshot.status === 'interrupted') {
      record.intent = 'stop'
      await this.finish(record, { summary: record.snapshot.summary, error: record.snapshot.error })
    }
    if (options.recursive !== false) await this.stopDescendants(scope, id)
    return this.toSnapshot(record)
  }

  resume(scope: SubagentScope, id: string): SubagentSnapshot {
    const record = this.require(scope, id)
    if (record.snapshot.status !== 'interrupted') throw new Error('Продолжить можно только прерванного субагента.')
    if (scope.rootRunId && record.snapshot.rootRunId !== scope.rootRunId) throw new Error('Продолжение доступно только в исходном запуске. Запустите новую задачу, чтобы создать новый субагент.')
    const active = [...this.records.values()].filter(candidate => ACTIVE.has(candidate.snapshot.status))
    if (active.filter(candidate => candidate.snapshot.rootRunId === record.snapshot.rootRunId).length >= this.maxConcurrentPerRoot) {
      throw new Error(`Достигнут лимит субагентов для запуска (${this.maxConcurrentPerRoot}).`)
    }
    if (active.length >= this.maxConcurrentGlobal) throw new Error(`Достигнут общий лимит активных субагентов (${this.maxConcurrentGlobal}).`)
    record.intent = undefined
    record.controller = undefined
    this.update(id, { status: 'queued', error: undefined, activity: 'Продолжение поставлено в очередь.' })
    void this.execute(record)
    return this.toSnapshot(record)
  }

  controlForOwner(senderId: number, sessionId: string, id: string, action: 'stop' | 'interrupt' | 'resume'): Promise<SubagentSnapshot> | SubagentSnapshot {
    const scope = { senderId, sessionId }
    if (action === 'stop') return this.stop(scope, id, { recursive: true })
    if (action === 'interrupt') return this.interrupt(scope, id, true)
    return this.resume(scope, id)
  }

  async stopForOwner(senderId: number, sessionId?: string): Promise<void> {
    const owned = [...this.records.values()].filter(record =>
      record.senderId === senderId && (!sessionId || record.snapshot.sessionId === sessionId)
    )
    const ownedIds = new Set(owned.map(record => record.snapshot.id))
    const roots = owned.filter(record => !record.snapshot.parentId || !ownedIds.has(record.snapshot.parentId))
    await Promise.all(roots.map(record => {
      const scope: SubagentScope = {
        senderId,
        ...(sessionId ? { sessionId } : record.snapshot.sessionId ? { sessionId: record.snapshot.sessionId } : { rootRunId: record.snapshot.rootRunId })
      }
      return this.stop(scope, record.snapshot.id, { recursive: true }).catch(() => undefined)
    }))
  }

  private async execute(record: InternalSubagent): Promise<void> {
    if (record.intent === 'stop' || isTerminal(record.snapshot.status)) return
    const controller = new AbortController()
    record.controller = controller
    record.snapshot.status = 'running'
    record.snapshot.activity = record.snapshot.activity || 'Запуск субагента.'
    this.publish(record)
    let result: SubagentRunResult | undefined
    try {
      result = await record.run({
        id: record.snapshot.id,
        signal: controller.signal,
        consumeSteers: () => this.consumeSteers(record.snapshot.id)
      })
    } catch (error) {
      result = { error: error instanceof Error ? error.message : String(error) }
    }

    if (record.intent === 'interrupt') {
      record.snapshot.status = 'interrupted'
      record.snapshot.activity = 'Прервано; можно продолжить в этом запуске.'
      record.snapshot.error = result?.error
      this.applyResult(record, result)
      this.publish(record)
      record.controller = undefined
      this.prune()
      return
    }
    await this.finish(record, result)
  }

  private async finish(record: InternalSubagent, result?: SubagentRunResult): Promise<void> {
    if (record.finalized) return
    if (result) this.applyResult(record, result)
    const wasStopped = record.intent === 'stop'
    record.snapshot.status = wasStopped ? 'cancelled' : result?.error ? 'failed' : 'completed'
    record.snapshot.activity = wasStopped ? 'Остановлено.' : result?.error ? 'Завершилось с ошибкой.' : 'Завершено.'
    record.snapshot.error = result?.error
    record.controller = undefined
    if (record.parentAbortSignal && record.parentAbortListener) {
      record.parentAbortSignal.removeEventListener('abort', record.parentAbortListener)
      record.parentAbortListener = undefined
    }
    record.finalized = true
    try {
      const enrichment = await record.onTerminal?.(record.snapshot.status, result)
      if (enrichment) {
        result = { ...result, ...enrichment }
        this.applyResult(record, enrichment)
      }
    } catch {}
    this.publish(record)
    this.prune()
  }

  private applyResult(record: InternalSubagent, result?: SubagentRunResult): void {
    if (!result) return
    if (result.summary !== undefined) record.snapshot.summary = result.summary
    if (result.rounds !== undefined) record.snapshot.rounds = result.rounds
    if (result.toolCallsCount !== undefined) record.snapshot.toolCallsCount = result.toolCallsCount
    if (result.usage !== undefined) record.snapshot.usage = result.usage
    if (result.verificationStatus !== undefined) record.snapshot.verificationStatus = result.verificationStatus
    if (result.checks !== undefined) record.snapshot.checks = result.checks
    if (result.resultData !== undefined) record.snapshot.resultData = result.resultData
  }

  private async stopDescendants(scope: SubagentScope, id: string): Promise<void> {
    for (const child of this.descendants(scope, id).reverse()) await this.stop(scope, child.snapshot.id, { recursive: false })
  }

  private async interruptDescendants(scope: SubagentScope, id: string): Promise<void> {
    for (const child of this.descendants(scope, id).reverse()) await this.interrupt(scope, child.snapshot.id, false)
  }

  private descendants(scope: SubagentScope, parentId: string): InternalSubagent[] {
    const candidates = [...this.records.values()].filter(record => this.matches(record, scope))
    const found: InternalSubagent[] = []
    const queue = [parentId]
    while (queue.length) {
      const parent = queue.shift()!
      for (const record of candidates) {
        if (record.snapshot.parentId === parent && !found.includes(record)) {
          found.push(record)
          queue.push(record.snapshot.id)
        }
      }
    }
    return found
  }

  private isDescendant(record: InternalSubagent, parentId: string): boolean {
    let current = record.snapshot.parentId
    while (current) {
      if (current === parentId) return true
      current = this.records.get(current)?.snapshot.parentId
    }
    return false
  }

  private require(scope: SubagentScope, id: string): InternalSubagent {
    this.validateScope(scope)
    const record = this.records.get(id)
    if (!record || !this.matches(record, scope)) throw new Error('Субагент не найден в текущем запуске или чате.')
    return record
  }

  private validateScope(scope: SubagentScope): void {
    if (!scope || (!scope.rootRunId && !(typeof scope.senderId === 'number' && scope.sessionId))) {
      throw new Error('Недостаточно данных владельца для управления субагентом.')
    }
  }

  private matches(record: InternalSubagent, scope: SubagentScope): boolean {
    return (!scope.rootRunId || record.snapshot.rootRunId === scope.rootRunId) &&
      (scope.senderId === undefined || record.senderId === scope.senderId) &&
      (!scope.sessionId || record.snapshot.sessionId === scope.sessionId)
  }

  private toSnapshot(record: InternalSubagent): SubagentSnapshot {
    return { ...record.snapshot, ...(record.snapshot.usage ? { usage: { ...record.snapshot.usage } } : {}), ...(record.snapshot.checks ? { checks: record.snapshot.checks.map(check => ({ ...check })) } : {}) }
  }

  private publish(record: InternalSubagent): void {
    record.snapshot.updatedAt = Date.now()
    try { this.emit('update', this.toSnapshot(record), record.senderId) } catch {}
  }

  private prune(): void {
    const inactive = [...this.records.values()].filter(record => !ACTIVE.has(record.snapshot.status))
    const byOwner = new Map<string, InternalSubagent[]>()
    for (const record of inactive) {
      const ownerKey = `${record.senderId ?? 'cli'}:${record.snapshot.sessionId ?? record.snapshot.rootRunId}`
      const list = byOwner.get(ownerKey) ?? []
      list.push(record)
      byOwner.set(ownerKey, list)
    }
    for (const records of byOwner.values()) {
      records.sort((a, b) => b.snapshot.updatedAt - a.snapshot.updatedAt)
      for (const record of records.slice(MAX_RETAINED_PER_OWNER)) this.records.delete(record.snapshot.id)
    }
  }
}

export const subagentManager = new SubagentManager()
