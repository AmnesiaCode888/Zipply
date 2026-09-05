import { EventEmitter } from 'events'

export interface ScratchpadEntry {
  id: string
  hypothesis: string
  status: 'pending' | 'verified' | 'refuted'
  evidence?: string
  updatedAt: string
}

/**
 * Blackboard — Shared key-value store, working memory scratchpad & event bus for agent runs.
 * Supports child instances with parent inheritance.
 */
export class Blackboard extends EventEmitter {
  private _artifacts: Map<string, unknown> = new Map()
  private _scratchpad: Map<string, ScratchpadEntry> = new Map()
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

  // ── Working Memory (Scratchpad / Operational State) ─────────────────────────

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

    return `\n## Текущие рабочие гипотезы и статус проверки (Working Memory Scratchpad):\n${lines.join('\n')}\n`
  }

  createChild(): Blackboard {
    return new Blackboard(this)
  }

  clear(): void {
    this._artifacts.clear()
    this._scratchpad.clear()
  }
}

