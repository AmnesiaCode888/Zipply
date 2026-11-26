import { createHash } from 'crypto'
import * as fs from 'fs/promises'
import * as path from 'path'
import type { AgentRunCheck, AgentVerificationStatus } from '../../../shared/agentEvents'
import { walkProject } from '../tools/projectWalk'

export const MISSING_FILE_HASH = '__MISSING__'
export const UNAVAILABLE_WORKSPACE_SNAPSHOT = 'ws:unavailable'
const MAX_SNAPSHOT_BYTES = 64 * 1024 * 1024

export interface CriterionRecord {
  id: string
  text: string
  revision: number
}

export interface VerificationAttempt {
  criterionId?: string
  criterionRevision?: number
  sourceCallId: string
  toolName: string
  command?: string
  commandCwd?: string
  targetPath?: string
  requestedPath?: string
  fileAssertion?: { path: string; predicate: string; expected?: string }
  browserAssertion?: { url: string; text?: string; selector?: string }
  workspaceScope?: { root: string; paths: string[] }
  scopeHash: string
  passed: boolean
  stale: boolean
  staleReason?: string
  result: string
  createdAt: number
}

export function normalizePathKey(targetPath: string): string {
  const resolved = path.resolve(targetPath)
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved
}

export async function computeFileSnapshotHash(absPath: string): Promise<string> {
  const real = await fs.realpath(absPath).catch(() => path.resolve(absPath))
  try {
    const bytes = await fs.readFile(real)
    return createHash('sha256').update(bytes).digest('hex')
  } catch (err) {
    if ((err as NodeJS.ErrnoException)?.code === 'ENOENT') {
      return MISSING_FILE_HASH
    }
    throw err
  }
}

export async function computeWorkspaceSnapshotHash(
  workspaceRoot: string,
  trackedPaths: readonly string[] = []
): Promise<string> {
  try {
    const files = new Map<string, string>()
    const walked = await walkProject(workspaceRoot, workspaceRoot, undefined, undefined, async (absolute, relative) => {
      files.set(relative, absolute)
      return false
    })
    if (walked.truncated) return UNAVAILABLE_WORKSPACE_SNAPSHOT
    for (const target of trackedPaths) {
      const absolute = path.resolve(workspaceRoot, target)
      files.set(path.relative(workspaceRoot, absolute).replace(/\\/g, '/'), absolute)
    }
    const hash = createHash('sha256')
    let bytes = 0
    const targets = [...files].sort(([left], [right]) => left.localeCompare(right))
    for (let index = 0; index < targets.length; index += 16) {
      const batch = targets.slice(index, index + 16)
      const sizes = await Promise.all(batch.map(([, absolute]) => fs.stat(absolute).then(stat => stat.size).catch(error => {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return 0
        throw error
      })))
      bytes += sizes.reduce((total, size) => total + size, 0)
      if (bytes > MAX_SNAPSHOT_BYTES) return UNAVAILABLE_WORKSPACE_SNAPSHOT
      const hashes = await Promise.all(batch.map(([, absolute]) => computeFileSnapshotHash(absolute)))
      batch.forEach(([relative], offset) => hash.update(JSON.stringify([relative, hashes[offset]])))
    }
    return `ws:${hash.digest('hex')}`
  } catch {
    return UNAVAILABLE_WORKSPACE_SNAPSHOT
  }
}

function unwrap(value: string): string {
  const trimmed = value.trim()
  return /^(`|").*\1$/s.test(trimmed) ? trimmed.slice(1, -1) : trimmed
}

export function fileAssertionCoversCriterion(assertion: NonNullable<VerificationAttempt['fileAssertion']>, criterion: CriterionRecord): boolean {
  const match = /^(`[^`]+`|"[^"]+"|\S+)\s+(exists|has|contains|equals|not_contains|does not contain)\b(?:\s+([\s\S]+))?$/i.exec(criterion.text)
  if (!match) return false
  const normalize = (value: string): string => normalizePathKey(unwrap(value).replace(/\\/g, '/'))
  const predicate = match[2].toLowerCase().replace('does not contain', 'not_contains').replace(/^has$/, 'contains')
  const matchingPredicate = predicate === assertion.predicate || (predicate === 'contains' && assertion.predicate === 'equals')
  if (normalize(match[1]) !== normalize(assertion.path) || !matchingPredicate) return false
  if (predicate === 'exists') return !match[3]
  return match[3] !== undefined && unwrap(match[3]).replace(/\r\n/g, '\n') === assertion.expected?.replace(/\r\n/g, '\n')
}

const verificationCommands = [
  /^(?:npm|pnpm|yarn|bun)\s+(?:(?:run|run-script)\s+)?(?:test|lint|typecheck|check|build|verify|validate)(?=[:\s]|$)/i,
  /^(?:(?:npx|bunx)\s+|(?:npm|pnpm|yarn|bun)\s+(?:exec|x)\s+)?(?:tsc|eslint|vitest|jest|mocha|pytest|playwright\s+test)(?=\s|$)/i,
  /^node\s+--test(?=\s|$)/i,
  /^(?:python3?|py)\s+-m\s+(?:pytest|unittest)(?=\s|$)/i,
  /^(?:cargo|go|dotnet|gradlew?|mvnw?)\s+(?:test|check|build|verify)(?=\s|$)/i
]

export function isVerificationCommand(command: string): boolean {
  const value = command.trim()
  return !/[\r\n;&|<>`$]/.test(value) && verificationCommands.some(pattern => pattern.test(value))
}

export function syncCriterionRecords(prev: readonly CriterionRecord[], nextTexts: readonly string[]): CriterionRecord[] {
  const cleaned = nextTexts
    .filter((text): text is string => typeof text === 'string' && text.trim().length > 0)
    .map((text) => text.trim())
  if (cleaned.length === 0) return []

  const exactByText = new Map<string, CriterionRecord[]>()
  for (const record of prev) {
    const bucket = exactByText.get(record.text) || []
    bucket.push(record)
    exactByText.set(record.text, bucket)
  }

  let maxNum = 0
  for (const record of prev) {
    const match = /^c_(\d+)$/.exec(record.id)
    if (match) maxNum = Math.max(maxNum, Number(match[1]))
  }

  const reusedIds = new Set<string>()
  const result: Array<CriterionRecord | null> = cleaned.map((text) => {
    const bucket = exactByText.get(text)
    if (bucket && bucket.length > 0) {
      const matched = bucket.shift()!
      reusedIds.add(matched.id)
      return { ...matched }
    }
    return null
  })

  for (let i = 0; i < cleaned.length; i++) {
    if (result[i]) continue
    const candidateAtSlot = prev[i]
    if (candidateAtSlot && !reusedIds.has(candidateAtSlot.id)) {
      reusedIds.add(candidateAtSlot.id)
      result[i] = {
        id: candidateAtSlot.id,
        text: cleaned[i],
        revision: candidateAtSlot.revision + 1
      }
      continue
    }
    maxNum += 1
    const newId = `c_${maxNum}`
    reusedIds.add(newId)
    result[i] = {
      id: newId,
      text: cleaned[i],
      revision: 1
    }
  }

  return result as CriterionRecord[]
}

function commandCoversCriterion(attempt: VerificationAttempt, criterion: CriterionRecord): boolean {
  if (!attempt.command || !attempt.commandCwd || !attempt.workspaceScope || !isVerificationCommand(attempt.command)) return false
  const scoped = /^in\s+(`[^`]+`|"[^"]+"|\S+):\s+(.+)$/i.exec(criterion.text)
  const expected = unwrap((scoped?.[2] ?? criterion.text).replace(/\s+(?:passes|succeeds|exits with (?:code )?0|проходит)\.?$/i, ''))
  const expectedCwd = path.resolve(attempt.workspaceScope.root, scoped ? unwrap(scoped[1]) : '.')
  return isVerificationCommand(expected) && expected === attempt.command.trim() &&
    normalizePathKey(attempt.commandCwd) === normalizePathKey(expectedCwd)
}

function browserCoversCriterion(assertion: NonNullable<VerificationAttempt['browserAssertion']>, criterion: CriterionRecord): boolean {
  const text = /^([\s\S]+?)\s+(?:displays|shows|contains|отображает)\s+([\s\S]+)$/i.exec(criterion.text)
  const selector = /^([\s\S]+?)\s+has visible selector\s+([\s\S]+)$/i.exec(criterion.text)
  const match = text ?? selector
  if (!match || unwrap(match[2]) !== (text ? assertion.text : assertion.selector)) return false
  const url = match[1].match(/(?:https?|file):\/\/[^\s`"']+/i)?.[0]
  if (!url) return Boolean(text)
  try {
    return new URL(url).href === new URL(assertion.url).href
  } catch {
    return false
  }
}

export class VerificationTracker {
  private criteria: CriterionRecord[] = []
  private attempts: VerificationAttempt[] = []

  constructor(initialCriteria: readonly CriterionRecord[] = []) {
    this.criteria = initialCriteria.map((c) => ({ ...c }))
  }

  syncCriteria(records: readonly CriterionRecord[]): void {
    this.criteria = records.map((c) => ({ ...c }))
    const byId = new Map(this.criteria.map((c) => [c.id, c]))
    for (const attempt of this.attempts) {
      if (attempt.stale || !attempt.criterionId) continue
      const current = byId.get(attempt.criterionId)
      if (!current || current.revision !== attempt.criterionRevision) {
        attempt.stale = true
        attempt.staleReason = current ? 'criterion_updated' : 'criterion_removed'
      }
    }
  }

  getCriteria(): CriterionRecord[] {
    return this.criteria.map((c) => ({ ...c }))
  }

  getCriterion(id?: string): CriterionRecord | undefined {
    if (!id) return undefined
    return this.criteria.find((c) => c.id === id)
  }

  recordAttempt(input: Omit<VerificationAttempt, 'stale' | 'createdAt'>): void {
    const matched = this.getCriterion(input.criterionId)
    this.attempts.push({
      ...input,
      ...(matched ? { criterionRevision: input.criterionRevision ?? matched.revision } : {}),
      stale: input.scopeHash === UNAVAILABLE_WORKSPACE_SNAPSHOT,
      ...(input.scopeHash === UNAVAILABLE_WORKSPACE_SNAPSHOT ? { staleReason: 'workspace_snapshot_unavailable' } : {}),
      createdAt: Date.now()
    })
  }

  invalidatePaths(absPaths: readonly string[], reason = 'file_modified'): void {
    const keys = new Set(absPaths.map(normalizePathKey))
    for (const attempt of this.attempts) {
      if (attempt.stale) continue
      if (attempt.targetPath) {
        if (keys.has(normalizePathKey(attempt.targetPath))) {
          attempt.stale = true
          attempt.staleReason = reason
        }
      } else {
        // Workspace-wide shell checks become stale once any workspace file is modified.
        attempt.stale = true
        attempt.staleReason = reason
      }
    }
  }

  invalidateAll(reason = 'workspace_mutated'): void {
    for (const attempt of this.attempts) {
      if (attempt.stale) continue
      attempt.stale = true
      attempt.staleReason = reason
    }
  }

  async recheckLiveFiles(): Promise<void> {
    const checkedScopes = new Map<string, Promise<string>>()
    for (const attempt of this.attempts) {
      if (attempt.stale || (!attempt.targetPath && !attempt.workspaceScope)) continue
      try {
        let liveHash: string
        if (attempt.targetPath) {
          const requested = attempt.requestedPath ?? attempt.targetPath
          const actual = await fs.realpath(requested).catch(() => path.resolve(requested))
          if (normalizePathKey(actual) !== normalizePathKey(attempt.targetPath)) {
            attempt.stale = true
            attempt.staleReason = 'file_target_changed'
            continue
          }
          liveHash = await computeFileSnapshotHash(actual)
        } else {
          const { root, paths } = attempt.workspaceScope!
          const key = JSON.stringify([root, paths])
          let snapshot = checkedScopes.get(key)
          if (!snapshot) {
            snapshot = computeWorkspaceSnapshotHash(root, paths)
            checkedScopes.set(key, snapshot)
          }
          liveHash = await snapshot
        }
        if (liveHash !== attempt.scopeHash) {
          attempt.stale = true
          attempt.staleReason = attempt.targetPath ? 'file_changed_after_verify' : 'workspace_changed_after_verify'
        }
      } catch {
        attempt.stale = true
        attempt.staleReason = 'file_unreadable'
      }
    }
  }

  private latestForCriterion(criterion: CriterionRecord): VerificationAttempt | undefined {
    for (let i = this.attempts.length - 1; i >= 0; i--) {
      const attempt = this.attempts[i]
      if (attempt.stale) continue
      if (attempt.criterionId && (attempt.criterionId !== criterion.id || attempt.criterionRevision !== criterion.revision)) continue
      if (attempt.fileAssertion && fileAssertionCoversCriterion(attempt.fileAssertion, criterion)) return attempt
      if (attempt.browserAssertion && attempt.criterionId === criterion.id && browserCoversCriterion(attempt.browserAssertion, criterion)) return attempt
      if (commandCoversCriterion(attempt, criterion)) {
        return attempt
      }
    }
    return undefined
  }

  unverifiedCriteria(): CriterionRecord[] {
    return this.criteria.filter((criterion) => {
      const latest = this.latestForCriterion(criterion)
      return !latest?.passed
    })
  }

  computeStatus(): AgentVerificationStatus {
    if (this.criteria.length > 0) {
      const missing = this.unverifiedCriteria()
      if (missing.length === 0) return 'verified'
      if (this.criteria.some((c) => this.latestForCriterion(c)?.passed === false)) {
        return 'failed'
      }
      const latestActive = [...this.attempts].reverse().find((a) => !a.stale)
      if (latestActive && !latestActive.passed) {
        return 'failed'
      }
      return 'unverified'
    }

    const latestActive = [...this.attempts].reverse().find((a) => !a.stale && (
      !a.passed || a.fileAssertion || a.browserAssertion?.text || a.browserAssertion?.selector ||
      (a.workspaceScope && a.command && isVerificationCommand(a.command))
    ))
    if (!latestActive) return 'unverified'
    return latestActive.passed ? 'verified' : 'failed'
  }

  toRunChecks(): AgentRunCheck[] {
    return this.attempts.map((a) => ({
      toolName: a.toolName,
      ...(a.command ? { command: a.command } : {}),
      passed: a.passed,
      result: a.result,
      ...(a.criterionId ? { criterionId: a.criterionId } : {}),
      ...(a.criterionRevision !== undefined ? { criterionRevision: a.criterionRevision } : {}),
      ...(a.scopeHash ? { scopeHash: a.scopeHash } : {}),
      ...(a.sourceCallId ? { sourceCallId: a.sourceCallId } : {}),
      ...(a.stale ? { stale: true, ...(a.staleReason ? { staleReason: a.staleReason } : {}) } : {})
    }))
  }
}
