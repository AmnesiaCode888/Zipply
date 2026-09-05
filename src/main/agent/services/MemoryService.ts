import fs from 'fs'
import path from 'path'
import os from 'os'
import { app } from 'electron'
import { EmbeddingService, EmbeddingConfig } from './EmbeddingService'
import { ChatService, ChatConfig } from './ChatService'

export type MemoryCategory = 'user_preference' | 'project_fact' | 'procedural_workflow' | 'fact'

export interface MemoryItem {
  id: string
  category: MemoryCategory
  subject?: string      // Key entity/topic (e.g. "package_manager", "database", "user_role") for conflict resolution
  content: string
  tags: string[]
  importance: number
  createdAt: string
  updatedAt: string
  embedding?: number[]  // Optional semantic vector — populated when embedding model is configured
  hitCount?: number     // How many times this memory was retrieved — boosts importance over time
}

export interface MemoryStoreData {
  memories: MemoryItem[]
  coreSummary?: string            // Ultra-dense global essence of user's core stack, rules, preferences
  coreSummaryUpdatedAt?: string   // When coreSummary was last updated
  coreSummaryHash?: string        // Hash of memories to prevent redundant LLM re-summarization
}

const MAX_MEMORIES = 50
const STABLE_ANCHOR_LIMIT = 2
const DEFAULT_RELEVANT_LIMIT = 3
const MIN_SEMANTIC_SIMILARITY = 0.38
const MIN_LEXICAL_MATCH_RATIO = 0.15

export class MemoryService {
  private static _filePath: string | null = null
  private static _cache: MemoryStoreData | null = null
  private static _isSummarizing = false
  private static _summaryDebounceTimer: ReturnType<typeof setTimeout> | null = null

  static getGlobalFilePath(): string {
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
      this._filePath = path.join(baseDir, 'zipply-memory.json')
    }
    return this._filePath
  }

  static getFilePath(): string {
    return this.getGlobalFilePath()
  }

  /**
   * Returns path to workspace project-local memory (.zipply/memory.json)
   */
  static getWorkspaceFilePath(workspacePath?: string): string | null {
    if (!workspacePath || typeof workspacePath !== 'string' || !workspacePath.trim()) return null
    const norm = path.normalize(workspacePath.trim())
    return path.join(norm, '.zipply', 'memory.json')
  }

  private static _projectCaches: Map<string, MemoryStoreData> = new Map()

  static _loadProjectData(workspacePath?: string): MemoryStoreData {
    const projPath = this.getWorkspaceFilePath(workspacePath)
    if (!projPath) return { memories: [] }

    if (this._projectCaches.has(projPath)) {
      return this._projectCaches.get(projPath)!
    }

    try {
      if (fs.existsSync(projPath)) {
        const raw = fs.readFileSync(projPath, 'utf8')
        const data = JSON.parse(raw)
        if (Array.isArray(data.memories)) {
          this._projectCaches.set(projPath, data)
          return data
        }
      }
    } catch (e) {
      console.warn('[MemoryService] Project memory load error:', e)
    }

    const initial: MemoryStoreData = { memories: [] }
    this._projectCaches.set(projPath, initial)
    return initial
  }

  static _saveProjectData(workspacePath: string, data: MemoryStoreData): void {
    const projPath = this.getWorkspaceFilePath(workspacePath)
    if (!projPath) return
    this._projectCaches.set(projPath, data)
    try {
      const dir = path.dirname(projPath)
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
      fs.writeFileSync(projPath, JSON.stringify(data, null, 2), 'utf8')
    } catch (e) {
      console.error('[MemoryService] Project memory save error:', e)
    }
  }

  private static _loadData(): MemoryStoreData {
    if (this._cache) {
      return this._cache
    }
    try {
      const filePath = this.getGlobalFilePath()
      let loadPath = filePath
      let isLegacy = false

      if (!fs.existsSync(loadPath)) {
        const baseDir = path.dirname(filePath)
        const legacyCandidates = [
          path.join(baseDir, 'zipple-memory.json'),
          path.join(baseDir, 'clickcoder-memory.json'),
          path.join(baseDir, 'clickcode-memory.json'),
          path.join(baseDir, 'click-memory.json'),
          path.join(process.cwd(), 'zipple-memory.json'),
          path.join(process.cwd(), 'clickcoder-memory.json'),
          path.join(process.cwd(), 'clickcode-memory.json'),
          path.join(process.cwd(), 'click-memory.json')
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
        if (Array.isArray(data.memories)) {
          this._cache = data
          if (isLegacy) {
            // Auto-persist immediately to new zipple-memory.json location
            this._saveData(data)
          }
          return data
        }
      }
    } catch (e) {
      console.error('[MemoryService] Load error:', e)
    }
    this._cache = { memories: [] }
    return this._cache
  }

  private static _saveData(data: MemoryStoreData): void {
    this._cache = data
    try {
      const filePath = this.getGlobalFilePath()
      const dir = path.dirname(filePath)
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true })
      }
      fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8')
    } catch (e) {
      console.error('[MemoryService] Save error:', e)
    }
  }

  private static readonly _STOP_WORDS = new Set([
    'в', 'и', 'на', 'с', 'к', 'о', 'у', 'за', 'из', 'по', 'от', 'до', 'не', 'же', 'то', 'да', 'но', 'ли',
    'in', 'to', 'at', 'by', 'on', 'of', 'or', 'an', 'as', 'is', 'it', 'if', 'be', 'do', 'no', 'so', 'up', 'my', 'me'
  ])

  // --- Tokenizer for Jaccard similarity fallback ---
  private static _tokenize(str: string): Set<string> {
    const synonymMap: Record<string, string> = {
      name: 'имя',
      user: 'пользователь',
      username: 'имя',
      language: 'язык',
      russian: 'русский',
      english: 'английский',
      style: 'стиль',
      tone: 'тон',
      danya: 'даня',
      daniil: 'даня'
    }

    return new Set(
      str
        .toLowerCase()
        .replace(/[^\w\u0400-\u04FF\s]/g, ' ')
        .split(/\s+/)
        .map((w) => synonymMap[w] || w)
        .filter((w) => w.length >= 2 && !MemoryService._STOP_WORDS.has(w))
    )
  }

  // Jaccard similarity between two strings (0..1) — used as fallback when no embeddings
  private static _jaccardSimilarity(a: string, b: string): number {
    const setA = this._tokenize(a)
    const setB = this._tokenize(b)
    if (setA.size === 0 && setB.size === 0) return 1
    if (setA.size === 0 || setB.size === 0) return 0
    let intersection = 0
    for (const token of setA) {
      if (setB.has(token)) intersection++
    }
    const union = setA.size + setB.size - intersection
    return intersection / union
  }

  /**
   * Fast hash of all memory contents to detect if memories changed.
   */
  private static _calculateMemoriesHash(memories: MemoryItem[]): string {
    const raw = memories
      .map((m) => `${m.id}:${m.importance}:${m.content}`)
      .sort()
      .join('|')
    let hash = 5381
    for (let i = 0; i < raw.length; i++) {
      hash = ((hash << 5) + hash) ^ raw.charCodeAt(i)
      hash = hash >>> 0
    }
    return hash.toString(16)
  }

  // --- Core Summary API (Global Memory Essence) ---

  static getCoreSummary(): string {
    return this._loadData().coreSummary || ''
  }

  static updateCoreSummary(summary: string): void {
    const data = this._loadData()
    data.coreSummary = (summary || '').trim()
    data.coreSummaryUpdatedAt = new Date().toISOString()
    this._saveData(data)
  }

  /**
   * Schedules a debounced background update of the Core Memory Summary.
   * If multiple memory updates occur in rapid succession, only one LLM call is executed.
   */
  static scheduleAutoSummaryUpdate(config: ChatConfig, delayMs = 5000): void {
    if (this._summaryDebounceTimer) clearTimeout(this._summaryDebounceTimer)
    this._summaryDebounceTimer = setTimeout(() => {
      this.generateCoreSummaryAsync(config, false).catch(() => {})
    }, delayMs)
  }

  /**
   * Synthesizes an ultra-concentrated, high-density Core Memory Summary (3-6 bullet points)
   * representing the absolute most critical user rules, tech stack, and constraints.
   * Uses change hashing to avoid redundant API calls.
   */
  static async generateCoreSummaryAsync(config: ChatConfig, force = false): Promise<string> {
    if (this._isSummarizing) return this.getCoreSummary()

    const data = this._loadData()
    const memories = data.memories

    if (memories.length === 0) {
      data.coreSummary = ''
      data.coreSummaryHash = ''
      data.coreSummaryUpdatedAt = new Date().toISOString()
      this._saveData(data)
      return ''
    }

    const currentHash = this._calculateMemoriesHash(memories)
    if (!force && data.coreSummaryHash === currentHash && data.coreSummary?.trim()) {
      return data.coreSummary
    }

    this._isSummarizing = true

    try {
      const formattedMemories = memories
        .sort((a, b) => (b.importance || 3) - (a.importance || 3))
        .map((m, idx) => `${idx + 1}. [${m.category}] (Важность ${m.importance}/5) ${m.content}`)
        .join('\n')

      const prompt = `Составь СВЕРХКОНЦЕНТРИРОВАННУЮ выжимку (Core Memory Essence) из базы знаний пользователя для системного промпта ИИ.

Выдели ТОЛЬКО самое главное (3-6 кратких пунктов):
- Стек технологий и ключевые соглашения проекта
- Главные личные правила и ограничения пользователя
- Важнейшие архитектурные и процедурные решения

Требования:
- Максимально плотный, емкий текст без лишних слов.
- Каждый пункт начинается с дефиса "- ".
- Никаких вводных фраз вроде "Вот выжимка:".
- Максимум 60-90 слов суммарно.

Все записи памяти:
${formattedMemories}`

      const modelToUse = (config.fastModel && config.fastModel.trim()) || config.model || 'gpt-4o'
      const response = await ChatService.chat(
        {
          ...config,
          model: modelToUse,
          maxTokens: 250,
          temperature: 0.1,
          stream: false
        },
        [
          { role: 'system', content: 'Ты ассистент сжатия контекста. Возвращай только сверхкомпактный список сути.' },
          { role: 'user', content: prompt }
        ]
      )

      const summary = response.content?.trim() || ''
      if (summary && summary.length > 5) {
        data.coreSummary = summary
        data.coreSummaryHash = currentHash
        data.coreSummaryUpdatedAt = new Date().toISOString()
        this._saveData(data)
        console.log('[MemoryService] Generated new Core Memory Summary:', summary)
      }

      return data.coreSummary || ''
    } catch (e) {
      console.warn('[MemoryService] Core summary generation error:', e)
      return data.coreSummary || ''
    } finally {
      this._isSummarizing = false
    }
  }

  // --- Public Memory API ---

  static getGlobalMemories(): MemoryItem[] {
    return this._loadData().memories
  }

  static getProjectMemories(workspacePath?: string): MemoryItem[] {
    if (!workspacePath) return []
    return this._loadProjectData(workspacePath).memories
  }

  /**
   * Get all active memories. If workspacePath is provided, combines workspace-specific
   * facts with global user preferences.
   */
  static getAllMemories(workspacePath?: string): MemoryItem[] {
    const globalData = this._loadData()
    if (!workspacePath) {
      return globalData.memories
    }

    const projData = this._loadProjectData(workspacePath)
    if (!projData.memories || projData.memories.length === 0) {
      return globalData.memories
    }

    // Merge project memories + global user preferences & high-importance anchors
    const seen = new Set<string>()
    const combined: MemoryItem[] = []

    for (const m of projData.memories) {
      seen.add(m.id)
      combined.push(m)
    }

    for (const m of globalData.memories) {
      if (!seen.has(m.id)) {
        combined.push(m)
      }
    }

    return combined
  }

  /**
   * Find memories similar to given content.
   * Uses cosine similarity if embeddings available, Jaccard otherwise.
   * Returns sorted by similarity descending.
   */
  static findSimilar(
    content: string,
    threshold = 0.35,
    embeddingOverride?: number[],
    workspacePath?: string
  ): Array<{ memory: MemoryItem; similarity: number }> {
    const memories = this.getAllMemories(workspacePath)

    // Semantic path: if query has an embedding and memories have embeddings
    const memoriesWithEmbeddings = memories.filter((m) => m.embedding && m.embedding.length > 0)
    if (embeddingOverride && memoriesWithEmbeddings.length > 0) {
      return memoriesWithEmbeddings
        .map((m) => ({
          memory: m,
          similarity: EmbeddingService.cosineSimilarity(embeddingOverride, m.embedding!)
        }))
        .filter((item) => item.similarity >= threshold)
        .sort((a, b) => b.similarity - a.similarity)
    }

    // Jaccard fallback
    return memories
      .map((m) => ({ memory: m, similarity: this._jaccardSimilarity(content, m.content) }))
      .filter((item) => item.similarity >= threshold)
      .sort((a, b) => b.similarity - a.similarity)
  }

  static addMemory({
    content,
    category = 'fact',
    subject,
    importance = 3,
    tags = [],
    workspacePath
  }: {
    content: string
    category?: string
    subject?: string
    importance?: number
    tags?: string[]
    workspacePath?: string
  }): { item: MemoryItem | null; duplicate: MemoryItem | null; scope?: 'global' | 'project' } {
    if (!content || typeof content !== 'string') return { item: null, duplicate: null }

    const cleanContent = content.trim()
    const validCategories: MemoryCategory[] = [
      'user_preference',
      'project_fact',
      'procedural_workflow',
      'fact'
    ]
    const cat: MemoryCategory = validCategories.includes(category as MemoryCategory)
      ? (category as MemoryCategory)
      : 'fact'

    // Determine target store: user_preferences are always global; project facts go to workspace if available
    const isProjectScope = Boolean(workspacePath && cat !== 'user_preference')
    const targetData = isProjectScope ? this._loadProjectData(workspacePath) : this._loadData()

    // 1. Entity Subject Match & Invalidation (Overwrites conflicting old facts for same entity)
    if (subject && subject.trim().length >= 2) {
      const normalizedSubj = subject.trim().toLowerCase()
      const existingEntity = targetData.memories.find(
        (m) => m.category === cat && m.subject?.toLowerCase() === normalizedSubj
      )
      if (existingEntity) {
        existingEntity.content = cleanContent
        existingEntity.importance = Math.max(existingEntity.importance || 3, Number(importance) || 3)
        existingEntity.updatedAt = new Date().toISOString()
        existingEntity.embedding = undefined // Invalidate embedding to re-embed fresh text
        if (Array.isArray(tags) && tags.length > 0) {
          existingEntity.tags = Array.from(new Set([...(existingEntity.tags || []), ...tags]))
        }
        if (isProjectScope && workspacePath) {
          this._saveProjectData(workspacePath, targetData)
        } else {
          this._saveData(targetData)
        }
        return { item: existingEntity, duplicate: existingEntity, scope: isProjectScope ? 'project' : 'global' }
      }
    }

    // 2. Exact match dedup & update
    const exactMatch = targetData.memories.find(
      (m) => m.content.toLowerCase() === cleanContent.toLowerCase()
    )
    if (exactMatch) {
      exactMatch.updatedAt = new Date().toISOString()
      exactMatch.importance = Math.max(exactMatch.importance || 3, Number(importance) || 3)
      if (subject) exactMatch.subject = subject.trim()
      if (Array.isArray(tags) && tags.length > 0) {
        exactMatch.tags = Array.from(new Set([...(exactMatch.tags || []), ...tags]))
      }
      if (isProjectScope && workspacePath) {
        this._saveProjectData(workspacePath, targetData)
      } else {
        this._saveData(targetData)
      }
      return { item: exactMatch, duplicate: exactMatch, scope: isProjectScope ? 'project' : 'global' }
    }

    // 3. Memory Consolidation (Upsert at high similarity >= 0.72)
    const similar = this.findSimilar(cleanContent, 0.72, undefined, workspacePath).filter((s) => s.memory.category === cat)
    if (similar.length > 0) {
      const target = similar[0].memory
      target.content = cleanContent
      target.importance = Math.max(target.importance || 3, Number(importance) || 3)
      if (subject) target.subject = subject.trim()
      target.updatedAt = new Date().toISOString()
      target.embedding = undefined // Invalidate embedding to re-embed fresh text
      if (Array.isArray(tags) && tags.length > 0) {
        target.tags = Array.from(new Set([...(target.tags || []), ...tags]))
      }
      if (isProjectScope && workspacePath) {
        this._saveProjectData(workspacePath, targetData)
      } else {
        this._saveData(targetData)
      }
      return { item: target, duplicate: target, scope: isProjectScope ? 'project' : 'global' }
    }

    const newMem: MemoryItem = {
      id: `mem_${isProjectScope ? 'p_' : ''}${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      category: cat,
      subject: subject ? subject.trim() : undefined,
      content: cleanContent,
      tags: Array.isArray(tags) ? tags.map((t) => String(t).trim().toLowerCase()).filter(Boolean) : [],
      importance: Math.min(5, Math.max(1, Number(importance) || 3)),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      hitCount: 0
    }

    targetData.memories.unshift(newMem)

    // 4. Auto-prune if over limit
    this._pruneIfOverLimit(targetData)

    if (isProjectScope && workspacePath) {
      this._saveProjectData(workspacePath, targetData)
    } else {
      this._saveData(targetData)
    }

    return { item: newMem, duplicate: null, scope: isProjectScope ? 'project' : 'global' }
  }

  /**
   * Asynchronously enrich a saved memory with its embedding vector.
   * Call after addMemory() without blocking the main flow.
   */
  static async enrichWithEmbedding(memoryId: string, config: EmbeddingConfig): Promise<void> {
    try {
      const data = this._loadData()
      const mem = data.memories.find((m) => m.id === memoryId)
      if (!mem || mem.embedding) return  // Already has embedding

      const embedding = await EmbeddingService.getEmbedding(mem.content, config)
      if (!embedding) return

      mem.embedding = embedding
      mem.updatedAt = new Date().toISOString()
      this._saveData(data)
    } catch (e) {
      console.warn('[MemoryService] Failed to enrich embedding:', e)
    }
  }

  /**
   * Backfill embeddings for all memories that don't have one yet.
   * Call once at startup or on demand (background, non-blocking).
   * Adds 50ms pause between API calls to avoid rate-limiting.
   */
  static async backfillEmbeddings(config: EmbeddingConfig): Promise<number> {
    if (!config.embeddingModel?.trim()) return 0

    // Get IDs of memories without embeddings (snapshot, not reference)
    const idsToEnrich = this._loadData()
      .memories
      .filter((m) => !m.embedding)
      .map((m) => m.id)

    let enriched = 0

    for (const id of idsToEnrich) {
      try {
        // Re-read each memory fresh to avoid stale cache races
        const freshData = this._loadData()
        const mem = freshData.memories.find((m) => m.id === id)
        if (!mem || mem.embedding) continue  // Already enriched by concurrent path

        const embedding = await EmbeddingService.getEmbedding(mem.content, config)
        if (embedding) {
          mem.embedding = embedding
          this._saveData(freshData)
          enriched++
        }

        // Small delay to avoid hammering the API
        await new Promise<void>((r) => setTimeout(r, 50))
      } catch {
        // Skip on error — non-critical path
      }
    }

    return enriched
  }

  /**
   * Update an existing memory by ID. Patch any subset of fields.
   */
  static updateMemory(
    id: string,
    patch: Partial<Pick<MemoryItem, 'content' | 'category' | 'subject' | 'importance' | 'tags'>>,
    workspacePath?: string
  ): MemoryItem | null {
    // 1. Check workspace project store first if workspacePath is provided
    if (workspacePath) {
      const projData = this._loadProjectData(workspacePath)
      const projMem = projData.memories.find((m) => m.id === id)
      if (projMem) {
        if (patch.content !== undefined) {
          projMem.content = patch.content.trim()
          projMem.embedding = undefined
        }
        if (patch.category !== undefined) projMem.category = patch.category
        if (patch.subject !== undefined) projMem.subject = patch.subject.trim() || undefined
        if (patch.importance !== undefined) projMem.importance = Math.min(5, Math.max(1, patch.importance))
        if (patch.tags !== undefined) {
          projMem.tags = patch.tags.map((t) => String(t).trim().toLowerCase()).filter(Boolean)
        }
        projMem.updatedAt = new Date().toISOString()
        this._saveProjectData(workspacePath, projData)
        return projMem
      }
    }

    // 2. Check global store
    const data = this._loadData()
    const mem = data.memories.find((m) => m.id === id)
    if (!mem) return null

    if (patch.content !== undefined) {
      mem.content = patch.content.trim()
      mem.embedding = undefined  // Invalidate old embedding when content changes
    }
    if (patch.category !== undefined) mem.category = patch.category
    if (patch.subject !== undefined) mem.subject = patch.subject.trim() || undefined
    if (patch.importance !== undefined) mem.importance = Math.min(5, Math.max(1, patch.importance))
    if (patch.tags !== undefined) {
      mem.tags = patch.tags.map((t) => String(t).trim().toLowerCase()).filter(Boolean)
    }
    mem.updatedAt = new Date().toISOString()

    this._saveData(data)
    return mem
  }

  static deleteMemory(id: string, workspacePath?: string): boolean {
    if (workspacePath) {
      const projData = this._loadProjectData(workspacePath)
      const initialProjLen = projData.memories.length
      projData.memories = projData.memories.filter((m) => m.id !== id)
      if (projData.memories.length !== initialProjLen) {
        this._saveProjectData(workspacePath, projData)
        return true
      }
    }

    const data = this._loadData()
    const initialLen = data.memories.length
    data.memories = data.memories.filter((m) => m.id !== id)
    if (data.memories.length !== initialLen) {
      this._saveData(data)
      return true
    }
    return false
  }

  static clearAll(): boolean {
    this._saveData({ memories: [], coreSummary: '', coreSummaryHash: '', coreSummaryUpdatedAt: new Date().toISOString() })
    return true
  }

  /**
   * Auto-prune: when over MAX_MEMORIES, remove oldest lowest-importance entries first.
   * Mutates `data` in place — call before _saveData.
   */
  private static _pruneIfOverLimit(data: MemoryStoreData): void {
    if (data.memories.length <= MAX_MEMORIES) return

    const sorted = [...data.memories].sort((a, b) => {
      if (a.importance !== b.importance) return a.importance - b.importance
      return new Date(a.updatedAt).getTime() - new Date(b.updatedAt).getTime()
    })

    const toRemove = new Set<string>()
    let excess = data.memories.length - MAX_MEMORIES

    for (const mem of sorted) {
      if (excess <= 0) break
      if (mem.importance >= 4) continue
      toRemove.add(mem.id)
      excess--
    }

    if (toRemove.size > 0) {
      data.memories = data.memories.filter((m) => !toRemove.has(m.id))
      console.log(`[MemoryService] Auto-pruned ${toRemove.size} low-importance memories (limit: ${MAX_MEMORIES})`)
    }
  }

  static searchMemories(query?: string, categoryFilter: string | null = null): MemoryItem[] {
    const memories = this.getAllMemories()
    let filtered = memories

    if (categoryFilter && categoryFilter !== 'all') {
      filtered = filtered.filter((m) => m.category === categoryFilter)
    }

    if (!query || !query.trim()) {
      return filtered
    }

    const scored = this._scoreMemories(filtered, query)
    return scored.filter((item) => item.matches > 0).map((item) => item.memory)
  }

  /**
   * Semantic Vector Search for the UI & IPC:
   * Returns memories scored and sorted by semantic cosine similarity or Jaccard.
   */
  static async searchMemoriesAsync(
    query?: string,
    categoryFilter: string | null = null,
    embeddingConfig?: EmbeddingConfig
  ): Promise<Array<MemoryItem & { similarityScore?: number }>> {
    const memories = this.getAllMemories()
    let filtered = memories

    if (categoryFilter && categoryFilter !== 'all') {
      filtered = filtered.filter((m) => m.category === categoryFilter)
    }

    if (!query || !query.trim()) {
      return filtered.map((m) => ({ ...m }))
    }

    const cleanQuery = query.trim()

    // Try semantic search if embedding model is configured
    if (embeddingConfig?.embeddingModel?.trim()) {
      try {
        const queryEmbedding = await EmbeddingService.getEmbedding(cleanQuery, embeddingConfig)
        if (queryEmbedding) {
          const scored = filtered.map((m) => {
            const cosSim = m.embedding && m.embedding.length > 0
              ? EmbeddingService.cosineSimilarity(queryEmbedding, m.embedding)
              : 0
            // If memory has no embedding yet, fallback to Jaccard
            const jaccardSim = this._jaccardSimilarity(cleanQuery, m.content)
            const similarity = Math.max(cosSim, jaccardSim)
            return {
              ...m,
              similarityScore: Math.round(similarity * 100)
            }
          })

          scored.sort((a, b) => (b.similarityScore || 0) - (a.similarityScore || 0))
          return scored.filter((item) => (item.similarityScore || 0) > 10)
        }
      } catch (e) {
        console.warn('[MemoryService] Vector search error, using lexical fallback:', e)
      }
    }

    // Lexical Jaccard fallback
    const scored = this._scoreMemories(filtered, cleanQuery)
    return scored
      .filter((item) => item.matches > 0)
      .map((item) => ({
        ...item.memory,
        similarityScore: Math.round(Math.min(100, item.score * 20))
      }))
  }

  /**
   * Get tiered memories for a query using semantic search when available,
   * Jaccard otherwise. Short/trivial messages receive only stable anchors.
   */
  static async getTopMemoriesForQueryAsync(
    query?: string,
    limit = DEFAULT_RELEVANT_LIMIT,
    embeddingConfig?: EmbeddingConfig,
    workspacePath?: string
  ): Promise<MemoryItem[]> {
    const memories = this.getAllMemories(workspacePath)
    if (memories.length === 0) return []

    const cleanQuery = query ? query.trim() : ''
    const anchors = this._getStableAnchors(memories)

    // Short confirmations do not need an embedding request or old task facts.
    const isTrivialQuery =
      !cleanQuery ||
      cleanQuery.length < 15 ||
      /^(да|нет|ок|хорошо|ясно|понятно|сделай|удали|запусти|покажи|продолжай|дальше|стоп|ready|done|ok|yes|no|next|вассап|ку|йоу|хай|привет)\b/i.test(
        cleanQuery
      )

    if (isTrivialQuery) return anchors

    const anchorIds = new Set(anchors.map((m) => m.id))
    let relevant: MemoryItem[] = []

    // Apply the relevance gate before importance weighting. Importance can rank
    // a matching fact higher, but must never make an unrelated fact a match.
    if (embeddingConfig?.embeddingModel?.trim()) {
      try {
        const queryEmbedding = await EmbeddingService.getEmbedding(cleanQuery, embeddingConfig)
        if (queryEmbedding) {
          const queryTokenCount = Math.max(1, this._tokenize(cleanQuery).size)
          const scored = memories
            .filter((m) => !anchorIds.has(m.id))
            .map((m) => {
              const lexical = this._scoreMemories([m], cleanQuery)[0]
              const semantic = m.embedding && m.embedding.length > 0
                ? EmbeddingService.cosineSimilarity(queryEmbedding, m.embedding)
                : 0
              const similarity = Math.max(semantic, this._jaccardSimilarity(cleanQuery, m.content))
              const hasLexicalMatch = lexical.matches / queryTokenCount >= MIN_LEXICAL_MATCH_RATIO
              return {
                memory: m,
                similarity,
                score: similarity * (m.importance || 3) *
                  (m.category === 'project_fact' ? 1.15 : m.category === 'procedural_workflow' ? 1.1 : 1),
                hasLexicalMatch
              }
            })
            .filter((item) => item.similarity >= MIN_SEMANTIC_SIMILARITY || item.hasLexicalMatch)
            .sort((a, b) => b.score - a.score)

          relevant = scored.slice(0, limit).map((item) => item.memory)
        }
      } catch (e) {
        console.warn('[MemoryService] Semantic search failed, falling back to Jaccard:', e)
      }
    }

    if (relevant.length === 0) {
      relevant = this.getTopMemoriesForQuery(cleanQuery, limit, workspacePath)
        .filter((m) => !anchorIds.has(m.id))
    }

    const results = [...anchors, ...relevant].slice(0, STABLE_ANCHOR_LIMIT + limit)
    this._incrementHitCounts(results.map((m) => m.id))
    return results
  }

  /**
   * Synchronous task-memory retrieval (Jaccard-based fallback).
   * Unrelated high-importance memories are intentionally excluded.
   */
  static getTopMemoriesForQuery(query?: string, limit = DEFAULT_RELEVANT_LIMIT, workspacePath?: string): MemoryItem[] {
    const memories = this.getAllMemories(workspacePath)
    if (memories.length === 0 || !query || query.trim().length < 3) return []

    const queryTokenCount = Math.max(1, this._tokenize(query).size)
    const scored = this._scoreMemories(memories, query)
      .filter((item) => item.matches / queryTokenCount >= MIN_LEXICAL_MATCH_RATIO)

    scored.sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score
      if (b.memory.importance !== a.memory.importance) return b.memory.importance - a.memory.importance
      return new Date(b.memory.updatedAt).getTime() - new Date(a.memory.updatedAt).getTime()
    })

    return scored.slice(0, limit).map((item) => item.memory)
  }

  private static _getStableAnchors(memories: MemoryItem[]): MemoryItem[] {
    return memories
      .filter((m) => m.category === 'user_preference' && (m.importance || 0) >= 4)
      .sort((a, b) =>
        (b.importance || 0) - (a.importance || 0) ||
        new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
      )
      .slice(0, STABLE_ANCHOR_LIMIT)
  }

  /**
   * Increment hit count for retrieved memories.
   * Batches the write with a debounce to avoid disk thrashing on every query.
   */
  private static _hitCountDirty: Set<string> = new Set()
  private static _hitCountTimer: ReturnType<typeof setTimeout> | null = null

  private static _incrementHitCounts(ids: string[]): void {
    if (ids.length === 0) return
    for (const id of ids) this._hitCountDirty.add(id)

    // Debounce: flush to disk after 5 seconds of no new hits
    if (this._hitCountTimer) clearTimeout(this._hitCountTimer)
    this._hitCountTimer = setTimeout(() => {
      this._flushHitCounts()
    }, 5000)
  }

  private static _flushHitCounts(): void {
    if (this._hitCountDirty.size === 0) return
    try {
      const data = this._loadData()
      for (const id of this._hitCountDirty) {
        const mem = data.memories.find((m) => m.id === id)
        if (mem) mem.hitCount = (mem.hitCount || 0) + 1
      }
      this._hitCountDirty.clear()
      this._hitCountTimer = null
      this._saveData(data)
    } catch {
      // Non-critical, swallow
    }
  }

  private static _scoreMemories(memories: MemoryItem[], query: string): Array<{ memory: MemoryItem; score: number; matches: number }> {
    const normalize = (str: string): string[] =>
      str
        .toLowerCase()
        .replace(/[^\w\u0400-\u04FF\s]/g, ' ')
        .split(/\s+/)
        .filter((w) => w.length >= 2 && !MemoryService._STOP_WORDS.has(w))

    const queryTokens = normalize(query)
    if (queryTokens.length === 0) {
      return memories.map((m) => ({ memory: m, score: 0, matches: 0 }))
    }

    return memories.map((mem) => {
      const contentTokens = normalize(mem.content)
      const tagTokens = (mem.tags || []).flatMap((t) => normalize(t))
      const allMemTokens = new Set([...contentTokens, ...tagTokens])

      let matches = 0
      for (const qToken of queryTokens) {
        for (const mToken of allMemTokens) {
          if (mToken.includes(qToken) || qToken.includes(mToken)) {
            matches++
            break
          }
        }
      }

      let categoryWeight = 1.0
      if (mem.category === 'user_preference') categoryWeight = 1.5
      if (mem.category === 'project_fact') categoryWeight = 1.3
      if (mem.category === 'procedural_workflow') categoryWeight = 1.2

      // Recency bonus: recently updated memories score slightly higher
      const daysSinceUpdate = (Date.now() - new Date(mem.updatedAt).getTime()) / (1000 * 60 * 60 * 24)
      const recencyBonus = Math.max(0, 1 - daysSinceUpdate / 30) * 0.2

      // Hit count bonus: frequently retrieved memories are more relevant
      const hitBonus = Math.min((mem.hitCount || 0) * 0.05, 0.5)

      const score = (matches / queryTokens.length) * (mem.importance || 3) * categoryWeight + recencyBonus + hitBonus
      return { memory: mem, score, matches }
    })
  }
}
