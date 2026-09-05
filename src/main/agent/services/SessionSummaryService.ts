/**
 * SessionSummaryService — Medium-Term Memory via session summaries.
 *
 * Stores short AI-generated summaries of past sessions in a separate JSON file.
 * These are injected into the system prompt for relevant follow-up conversations.
 *
 * Features:
 * - Separate storage from long-term MemoryService (different file, different lifecycle)
 * - Keyword-based relevance matching for fast retrieval without embeddings
 * - Auto-prune: keeps last MAX_SESSIONS entries
 * - Thread-safe file writes
 */

import fs from 'fs'
import path from 'path'
import os from 'os'
import { app } from 'electron'

export interface SessionSummary {
  id: string
  chatId: string
  title: string
  summary: string       // 2-5 sentence summary of what happened
  keywords: string[]    // extracted keywords for relevance matching
  createdAt: string
  messageCount: number
}

interface SessionStore {
  sessions: SessionSummary[]
}

const MAX_SESSIONS = 20

export class SessionSummaryService {
  private static _filePath: string | null = null
  private static _cache: SessionStore | null = null

  static getFilePath(): string {
    if (!this._filePath) {
      let baseDir = ''
      try {
        if (app && typeof app.getPath === 'function') {
          baseDir = app.getPath('userData')
        }
      } catch {}
      if (!baseDir) {
        baseDir = process.env.APPDATA || (process.platform === 'darwin' ? path.join(os.homedir(), 'Library', 'Application Support', 'zipply') : path.join(os.homedir(), '.config', 'zipply'))
      }
      this._filePath = path.join(baseDir, 'zipply-sessions.json')
    }
    return this._filePath
  }

  private static _load(): SessionStore {
    if (this._cache) return this._cache

    try {
      const fp = this.getFilePath()
      let loadPath = fp
      let isLegacy = false

      if (!fs.existsSync(loadPath)) {
        const baseDir = path.dirname(fp)
        const legacyCandidates = [
          path.join(baseDir, 'zipple-sessions.json'),
          path.join(baseDir, 'clickcoder-sessions.json'),
          path.join(baseDir, 'clickcode-sessions.json'),
          path.join(baseDir, 'click-sessions.json'),
          path.join(process.cwd(), 'zipple-sessions.json'),
          path.join(process.cwd(), 'clickcoder-sessions.json'),
          path.join(process.cwd(), 'clickcode-sessions.json'),
          path.join(process.cwd(), 'click-sessions.json')
        ]
        for (const candidate of legacyCandidates) {
          if (fs.existsSync(candidate)) {
            loadPath = candidate
            isLegacy = true
            break
          }
        }
      }

      if (fs.existsSync(loadPath)) {
        const raw = fs.readFileSync(loadPath, 'utf8')
        const data = JSON.parse(raw)
        if (Array.isArray(data.sessions)) {
          this._cache = data
          if (isLegacy) {
            this._save(data)
          }
          return data
        }
      }
    } catch (e) {
      console.error('[SessionSummaryService] Load error:', e)
    }

    this._cache = { sessions: [] }
    return this._cache
  }

  private static _save(data: SessionStore): void {
    this._cache = data
    try {
      const filePath = this.getFilePath()
      const dir = path.dirname(filePath)
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true })
      }
      fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8')
    } catch (e) {
      console.error('[SessionSummaryService] Save error:', e)
    }
  }

  /**
   * Save a new session summary. Overwrites existing if same chatId.
   */
  static saveSummary(
    chatId: string,
    title: string,
    summary: string,
    keywords: string[],
    messageCount: number
  ): SessionSummary {
    const data = this._load()

    // Remove existing entry for same chatId
    data.sessions = data.sessions.filter((s) => s.chatId !== chatId)

    const entry: SessionSummary = {
      id: `sess_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      chatId,
      title,
      summary: summary.trim(),
      keywords: keywords.map((k) => k.toLowerCase().trim()).filter(Boolean),
      createdAt: new Date().toISOString(),
      messageCount
    }

    data.sessions.unshift(entry)

    // Prune if over limit
    if (data.sessions.length > MAX_SESSIONS) {
      data.sessions = data.sessions.slice(0, MAX_SESSIONS)
    }

    this._save(data)
    return entry
  }

  /**
   * Get the most relevant session summaries for a given query.
   * Returns top `limit` entries sorted by keyword relevance then recency.
   */
  static getRelevantSummaries(query: string, limit = 3): SessionSummary[] {
    const data = this._load()
    if (data.sessions.length === 0) return []

    // A short confirmation has no reliable topic signal. Returning recent sessions
    // here made unrelated old work leak into otherwise simple follow-up turns.
    if (!query || query.trim().length < 3) {
      return []
    }

    const queryTokens = this._tokenize(query)
    if (queryTokens.length === 0) return data.sessions.slice(0, limit)

    const scored = data.sessions.map((session) => {
      const sessionTokens = new Set([
        ...this._tokenize(session.title),
        ...this._tokenize(session.summary),
        ...session.keywords
      ])

      let matches = 0
      for (const qt of queryTokens) {
        for (const st of sessionTokens) {
          if (st.includes(qt) || qt.includes(st)) {
            matches++
            break
          }
        }
      }

      // Recency decay: sessions older than 7 days score lower
      const ageHours = (Date.now() - new Date(session.createdAt).getTime()) / (1000 * 3600)
      const recencyBonus = Math.max(0, 1 - ageHours / (24 * 7)) * 0.3

      return {
        session,
        matches,
        score: (matches / queryTokens.length) + (matches > 0 ? recencyBonus : 0)
      }
    })

    scored.sort((a, b) => b.score - a.score)

    return scored
      .filter((item) => item.matches > 0)
      .slice(0, limit)
      .map((item) => item.session)
  }

  /**
   * Get all session summaries.
   */
  static getAllSessions(): SessionSummary[] {
    return this._load().sessions
  }

  /**
   * Delete a specific session summary.
   */
  static deleteSession(id: string): boolean {
    const data = this._load()
    const before = data.sessions.length
    data.sessions = data.sessions.filter((s) => s.id !== id)
    if (data.sessions.length !== before) {
      this._save(data)
      return true
    }
    return false
  }

  /**
   * Clear all session summaries.
   */
  static clearAll(): void {
    this._save({ sessions: [] })
  }

  private static readonly _STOP_WORDS = new Set([
    'в', 'и', 'на', 'с', 'к', 'о', 'у', 'за', 'из', 'по', 'от', 'до', 'не', 'же', 'то', 'да', 'но', 'ли',
    'in', 'to', 'at', 'by', 'on', 'of', 'or', 'an', 'as', 'is', 'it', 'if', 'be', 'do', 'no', 'so', 'up', 'my', 'me'
  ])

  private static _tokenize(str: string): string[] {
    return str
      .toLowerCase()
      .replace(/[^\w\u0400-\u04FF\s]/g, ' ')
      .split(/\s+/)
      .filter((w) => w.length >= 2 && !SessionSummaryService._STOP_WORDS.has(w))
  }
}
