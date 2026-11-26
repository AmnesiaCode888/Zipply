import { createHash, randomUUID } from 'crypto'
import * as fs from 'fs/promises'
import * as path from 'path'
import type { AgentHistoryMessage, AgentRunSummary } from '../../../shared/agentEvents'
import type { ExtensionRef } from '../../../shared/extensions'
import { isExtensionRefs } from '../../../shared/extensions'
import type { AgentTaskState } from './Blackboard'
import { computeFileSnapshotHash, normalizePathKey } from './VerificationEvidence'
import { extractToolTargetPaths } from './ToolPathExtractor'

export interface JournalTargetHash {
  path: string
  beforeHash: string
  afterHash?: string
  expectedHashes?: string[]
}

export interface JournalToolEntry {
  callId: string
  toolName: string
  argsHash: string
  targetPaths?: JournalTargetHash[]
  status: 'started' | 'completed' | 'error' | 'aborted'
  reconciled?: boolean
  result?: string
  startedAt: number
  endedAt?: number
}

export interface RunJournalRecord {
  runId: string
  sessionId: string
  requestId: string
  agentId: string
  workspacePath: string
  status: 'running' | 'completed' | 'incomplete' | 'cancelled' | 'error' | 'interrupted'
  startedAt: number
  updatedAt: number
  taskState: AgentTaskState
  history: AgentHistoryMessage[]
  extensionRefs?: ExtensionRef[]
  pendingSteers: Array<{ id: string; content: string; receivedAt: number }>
  tools: JournalToolEntry[]
  summary?: AgentRunSummary
}

export interface JournalReconciliation {
  inFlightTools: Array<{
    toolName: string
    callId: string
    changes: Array<{ path: string; beforeHash: string; liveHash: string; modifiedOnDisk: boolean }>
  }>
  pendingSteers: string[]
  reconciliationNote: string
  recoveredWrites: Array<{ callId: string; liveHash: string }>
  hasAppliedMutation: boolean
}

export interface RunJournalCheckpoint {
  history: AgentHistoryMessage[]
  taskState: AgentTaskState
  appliedSteers?: readonly string[]
}

export interface JournalToolStart {
  callId: string
  toolName: string
  argsJson: string
  targetPaths?: string[]
  workspacePath?: string
}

export interface JournalToolResult {
  callId: string
  error: boolean
  result: string
  interrupted?: boolean
  notStarted?: boolean
}

type JournalProgress = Partial<RunJournalCheckpoint>
const UNKNOWN_SNAPSHOT = '__UNKNOWN__'
const FILE_MUTATIONS = new Set(['write_file', 'edit_file', 'apply_patch'])
const RESOLVED_WRITE_RESULT = 'Сверка журнала подтвердила, что файл уже содержит ожидаемый результат записи.'
const HISTORY_ROLES = new Set(['system', 'developer', 'user', 'assistant', 'tool'])

function canResumeJournal(record: RunJournalRecord | null): record is RunJournalRecord {
  if (!record) return false
  return record.status === 'running' || record.status === 'interrupted' || record.status === 'incomplete' ||
    ((record.status === 'error' || record.status === 'cancelled') &&
      (record.pendingSteers.length > 0 || record.tools.some(tool =>
        tool.status === 'started' || tool.status === 'aborted' || (tool.status === 'completed' && FILE_MUTATIONS.has(tool.toolName)))))
}

function parseHistory(value: unknown): AgentHistoryMessage[] | null {
  return Array.isArray(value) && value.every(message => message && HISTORY_ROLES.has(message.role))
    ? value as AgentHistoryMessage[]
    : null
}

function applyProgress(record: RunJournalRecord, progress: JournalProgress): void {
  if (progress.history) record.history = [...progress.history]
  if (progress.taskState) record.taskState = progress.taskState
  for (const text of progress.appliedSteers ?? []) {
    const index = record.pendingSteers.findIndex(steer => steer.content === text)
    if (index !== -1) record.pendingSteers.splice(index, 1)
  }
}

function fileHash(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

function isInsideWorkspace(relativePath: string): boolean {
  return Boolean(relativePath) && relativePath !== '..' && !relativePath.startsWith(`..${path.sep}`) && !path.isAbsolute(relativePath)
}

export class RunJournalStore {
  private readonly dir: string
  private writeQueues = new Map<string, Promise<void>>()

  constructor(storageDir: string) {
    this.dir = path.resolve(storageDir)
  }

  private fileForSession(sessionId: string): string {
    const safe = sessionId.replace(/[^a-zA-Z0-9_-]/g, '_') || 'default'
    return path.join(this.dir, `${safe}.json`)
  }

  private enqueue<T>(sessionId: string, fn: () => Promise<T>): Promise<T> {
    const key = this.fileForSession(sessionId)
    const prev = this.writeQueues.get(key) ?? Promise.resolve()
    const next = prev.then(fn, fn)
    const pending = next.then(() => {}, () => {})
    this.writeQueues.set(key, pending)
    void pending.then(() => {
      if (this.writeQueues.get(key) === pending) this.writeQueues.delete(key)
    })
    return next
  }

  private async readUnsafe(sessionId: string): Promise<RunJournalRecord | null> {
    try {
      const raw = await fs.readFile(this.fileForSession(sessionId), 'utf8')
      const parsed = JSON.parse(raw) as RunJournalRecord
      if (!parsed || typeof parsed !== 'object' || parsed.sessionId !== sessionId ||
        typeof parsed.runId !== 'string' || typeof parsed.workspacePath !== 'string' ||
        typeof parsed.agentId !== 'string' || typeof parsed.taskState?.goal !== 'string' ||
        !Array.isArray(parsed.tools) || !parsed.tools.every(tool => tool && typeof tool.callId === 'string' &&
          (tool.targetPaths === undefined || (Array.isArray(tool.targetPaths) && tool.targetPaths.every(target =>
            target && typeof target.path === 'string' && typeof target.beforeHash === 'string' &&
            (target.expectedHashes === undefined || Array.isArray(target.expectedHashes)))))) ||
        !Array.isArray(parsed.pendingSteers) || !parsed.pendingSteers.every(steer => steer && typeof steer.content === 'string')) return null
      const history = parseHistory(parsed.history)
      if (!history) return null
      if (parsed.extensionRefs !== undefined && !isExtensionRefs(parsed.extensionRefs)) return null
      const legacyIndex = history.findLastIndex(message => message.name === 'zipply_context_snapshot')
      if (legacyIndex !== -1) {
        const { content } = history[legacyIndex]
        const snapshot = typeof content === 'string' ? parseHistory(JSON.parse(content)) : null
        if (!snapshot) return null
        parsed.history = [...snapshot, ...history.slice(legacyIndex + 1)]
      }
      return parsed
    } catch {
      return null
    }
  }

  private async writeUnsafe(record: RunJournalRecord): Promise<void> {
    await fs.mkdir(this.dir, { recursive: true })
    const target = this.fileForSession(record.sessionId)
    const temp = `${target}.${randomUUID()}.tmp`
    try {
      const handle = await fs.open(temp, 'wx')
      try {
        await handle.writeFile(`${JSON.stringify(record, null, 2)}\n`, 'utf8')
        await handle.sync()
      } finally {
        await handle.close()
      }
      await fs.rename(temp, target)
    } finally {
      await fs.unlink(temp).catch(() => {})
    }
  }

  async load(sessionId: string): Promise<RunJournalRecord | null> {
    return this.enqueue(sessionId, () => this.readUnsafe(sessionId))
  }

  isResumable(record: RunJournalRecord | null): record is RunJournalRecord {
    return canResumeJournal(record)
  }

  async startRun(input: {
    runId: string
    sessionId: string
    requestId: string
    agentId: string
    workspacePath: string
    taskState: AgentTaskState
    history: AgentHistoryMessage[]
    extensionRefs?: ExtensionRef[]
    resumeRunId?: string
    recoveredWrites?: JournalReconciliation['recoveredWrites']
  }): Promise<RunJournalRecord> {
    return this.enqueue(input.sessionId, async () => {
      const previous = input.resumeRunId ? await this.readUnsafe(input.sessionId) : null
      if (input.resumeRunId && (!canResumeJournal(previous) || previous.runId !== input.resumeRunId)) {
        throw new Error('Журнал возобновляемого запуска изменился.')
      }
      const now = Date.now()
      for (const recovery of input.recoveredWrites ?? []) {
        const tool = previous?.tools.find(entry => entry.callId === recovery.callId)
        if (!tool || tool.status === 'completed' || tool.targetPaths?.length !== 1) continue
        const [target] = tool.targetPaths
        if (!target.expectedHashes?.includes(recovery.liveHash)) continue
        target.afterHash = recovery.liveHash
        tool.status = 'completed'
        tool.reconciled = true
        tool.result = RESOLVED_WRITE_RESULT
        tool.endedAt = now
      }
      const record: RunJournalRecord = {
        runId: input.runId,
        sessionId: input.sessionId,
        requestId: input.requestId,
        agentId: input.agentId,
        workspacePath: input.workspacePath,
        status: 'running',
        startedAt: now,
        updatedAt: now,
        taskState: input.taskState,
        history: [...input.history],
        ...(input.extensionRefs !== undefined ? { extensionRefs: input.extensionRefs } : previous?.extensionRefs ? { extensionRefs: previous.extensionRefs } : {}),
        pendingSteers: previous?.pendingSteers ?? [],
        tools: previous?.tools ?? []
      }
      await this.writeUnsafe(record)
      return record
    })
  }

  async recordToolStart(
    sessionId: string,
    input: JournalToolStart,
    runId?: string,
    progress?: JournalProgress
  ): Promise<string | undefined> {
    return this.enqueue(sessionId, async () => {
      const record = await this.readUnsafe(sessionId)
      if (!record || (runId && (record.runId !== runId || record.status !== 'running'))) {
        if (runId) throw new Error('Активный журнал запуска недоступен.')
        return
      }
      const rawTargets = input.targetPaths ?? extractToolTargetPaths(input.toolName, input.argsJson)
        .filter(target => target.isFile)
        .map(target => path.resolve(input.workspacePath ?? record.workspacePath, target.path))
      let expectedHashes: string[] | undefined
      if (input.toolName === 'write_file') {
        try {
          const content = JSON.parse(input.argsJson).content
          if (typeof content === 'string') {
            expectedHashes = [...new Set([fileHash(content), fileHash(content.replace(/\r?\n/g, '\r\n'))])]
          }
        } catch {}
      }
      const targetSnapshots: JournalTargetHash[] = []
      for (const absPath of new Set(rawTargets.map(target => path.resolve(target)))) {
        const beforeHash = await computeFileSnapshotHash(absPath).catch(() => UNKNOWN_SNAPSHOT)
        targetSnapshots.push({ path: absPath, beforeHash, ...(expectedHashes ? { expectedHashes } : {}) })
      }
      const target = targetSnapshots[0]
      if (input.toolName === 'write_file' && targetSnapshots.length === 1 && expectedHashes?.includes(target.beforeHash) &&
        record.tools.some(tool => tool.reconciled && tool.targetPaths?.some(previous =>
          normalizePathKey(previous.path) === normalizePathKey(target.path) && previous.afterHash === target.beforeHash))) {
        return RESOLVED_WRITE_RESULT
      }
      if (progress) applyProgress(record, progress)
      record.tools.push({
        callId: input.callId,
        toolName: input.toolName,
        argsHash: fileHash(input.argsJson || '').slice(0, 16),
        ...(targetSnapshots.length ? { targetPaths: targetSnapshots } : {}),
        status: 'started',
        startedAt: Date.now()
      })
      record.updatedAt = Date.now()
      await this.writeUnsafe(record)
    })
  }

  async recordToolResult(
    sessionId: string,
    input: JournalToolResult,
    runId?: string,
    progress?: JournalProgress
  ): Promise<void> {
    await this.enqueue(sessionId, async () => {
      const record = await this.readUnsafe(sessionId)
      if (!record || (runId && (record.runId !== runId || record.status !== 'running'))) return
      const index = record.tools.findIndex(t => t.callId === input.callId && t.status === 'started')
      if (index === -1) return
      const target = record.tools[index]
      if (input.notStarted) {
        record.tools.splice(index, 1)
      } else {
        target.status = input.interrupted ? 'aborted' : input.error ? 'error' : 'completed'
        target.result = input.result.slice(0, 2000)
        target.endedAt = Date.now()
        for (const entry of target.targetPaths ?? []) {
          entry.afterHash = await computeFileSnapshotHash(entry.path).catch(() => UNKNOWN_SNAPSHOT)
        }
      }
      if (progress) applyProgress(record, progress)
      record.updatedAt = Date.now()
      await this.writeUnsafe(record)
    })
  }

  async updateProgress(
    sessionId: string,
    input: JournalProgress,
    runId?: string
  ): Promise<void> {
    await this.enqueue(sessionId, async () => {
      const record = await this.readUnsafe(sessionId)
      if (!record || (runId && (record.runId !== runId || record.status !== 'running'))) return
      applyProgress(record, input)
      record.updatedAt = Date.now()
      await this.writeUnsafe(record)
    })
  }

  async appendSteer(sessionId: string, content: string, runId?: string): Promise<void> {
    const trimmed = content.trim()
    if (!trimmed) return
    await this.enqueue(sessionId, async () => {
      const record = await this.readUnsafe(sessionId)
      if (!record || (runId && (record.runId !== runId || record.status !== 'running'))) return
      record.pendingSteers.push({
        id: `steer_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
        content: trimmed,
        receivedAt: Date.now()
      })
      record.updatedAt = Date.now()
      await this.writeUnsafe(record)
    })
  }

  async finishRun(
    sessionId: string,
    status: RunJournalRecord['status'],
    summary?: AgentRunSummary,
    finalHistory?: AgentHistoryMessage[],
    runId?: string
  ): Promise<void> {
    await this.enqueue(sessionId, async () => {
      const record = await this.readUnsafe(sessionId)
      if (!record || (runId && (record.runId !== runId || record.status !== 'running'))) return
      for (const t of record.tools) {
        if (t.status === 'started') {
          t.status = 'aborted'
          t.endedAt = Date.now()
        }
      }
      record.status = status
      if (summary) record.summary = summary
      if (finalHistory) record.history = [...finalHistory]
      record.updatedAt = Date.now()
      await this.writeUnsafe(record)
    })
  }

  async reconcileDiskState(record: RunJournalRecord): Promise<JournalReconciliation> {
    const inFlight = record.tools.filter((t) => t.status === 'started' || t.status === 'aborted')
    const inFlightTools: JournalReconciliation['inFlightTools'] = []
    const lines: string[] = []
    const recoveredWrites: JournalReconciliation['recoveredWrites'] = []
    let hasAppliedMutation = false
    const liveHashes = new Map<string, Promise<string>>()
    const readLive = (targetPath: string): Promise<string> => {
      const key = normalizePathKey(targetPath)
      let snapshot = liveHashes.get(key)
      if (!snapshot) {
        snapshot = computeFileSnapshotHash(targetPath).catch(() => UNKNOWN_SNAPSHOT)
        liveHashes.set(key, snapshot)
      }
      return snapshot
    }

    for (const tool of inFlight) {
      const changes: Array<{ path: string; beforeHash: string; liveHash: string; modifiedOnDisk: boolean }> = []
      for (const target of tool.targetPaths || []) {
        const liveHash = await readLive(target.path)
        const modifiedOnDisk = liveHash !== target.beforeHash
        changes.push({
          path: target.path,
          beforeHash: target.beforeHash,
          liveHash,
          modifiedOnDisk
        })
        const rel = record.workspacePath ? path.relative(record.workspacePath, target.path) : target.path
        const matchesExpected = target.expectedHashes?.includes(liveHash)
        if (matchesExpected && tool.toolName === 'write_file' && tool.targetPaths?.length === 1) {
          recoveredWrites.push({ callId: tool.callId, liveHash })
          if (modifiedOnDisk && target.beforeHash !== UNKNOWN_SNAPSHOT && isInsideWorkspace(rel)) hasAppliedMutation = true
        }
        const state = matchesExpected
          ? `${modifiedOnDisk ? 'изменён до ожидаемого состояния' : 'уже содержит ожидаемое содержимое'}. Повторная запись не требуется`
          : liveHash === UNKNOWN_SNAPSHOT || target.beforeHash === UNKNOWN_SNAPSHOT
            ? 'не удалось сверить. Сначала проверь его содержимое и состояние рабочего дерева'
            : modifiedOnDisk
              ? 'изменён по сравнению с состоянием до вызова. Возможны частичная запись или правки пользователя. Сначала прочитай файл и сохрани существующие изменения'
              : 'не изменён'
        lines.push(`- Прерванный вызов ${tool.toolName} (${rel || target.path}): файл на диске ${state}.`)
      }
      if (!tool.targetPaths?.length) {
        lines.push(tool.toolName.startsWith('mcp_')
          ? `- Прерванный вызов ${tool.toolName} (${tool.callId}): неизвестно, выполнил ли внешний MCP-сервер действие. Сначала проверь его состояние; не повторяй вызов, пока не установишь результат.`
          : `- Прерванный вызов ${tool.toolName} (${tool.callId}): результат не был зафиксирован до прерывания.`)
      }
      inFlightTools.push({ toolName: tool.toolName, callId: tool.callId, changes })
    }

    const completedTargets = new Set<string>()
    for (const tool of [...record.tools].reverse()) {
      if (tool.status !== 'completed' || !FILE_MUTATIONS.has(tool.toolName)) continue
      for (const target of tool.targetPaths ?? []) {
        const key = normalizePathKey(target.path)
        if (completedTargets.has(key) || !target.afterHash || target.afterHash === UNKNOWN_SNAPSHOT) continue
        completedTargets.add(key)
        const liveHash = await readLive(target.path)
        const relativePath = path.relative(record.workspacePath, target.path)
        if (liveHash === target.afterHash) {
          if (target.beforeHash !== target.afterHash && target.beforeHash !== UNKNOWN_SNAPSHOT && isInsideWorkspace(relativePath)) {
            hasAppliedMutation = true
          }
        } else {
          const rel = relativePath || target.path
          lines.push(`- После сохранённой операции ${tool.toolName} (${rel}) файл отличается от зафиксированного результата. Сначала прочитай его и сохрани существующие изменения.`)
        }
      }
    }

    const pendingSteers = record.pendingSteers.map((s) => s.content)
    const reconciliationNote = lines.length > 0
      ? `<system_reminder>\nВозобновление прерванного запуска (${record.runId}): проверь состояние перед повтором действий:\n${lines.join('\n')}\n</system_reminder>`
      : ''

    return {
      inFlightTools,
      pendingSteers,
      reconciliationNote,
      recoveredWrites,
      hasAppliedMutation
    }
  }
}
