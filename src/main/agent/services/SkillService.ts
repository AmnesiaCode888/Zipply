import fs from 'fs'
import path from 'path'
import os from 'os'
import { app, shell } from 'electron'
import { EmbeddingService, EmbeddingConfig } from './EmbeddingService'
import { DEFAULT_SKILLS, DEFAULT_SKILLS_VERSION } from './DefaultSkillsData'

export interface SkillMetadata {
  name?: string
  description?: string
  globs?: string[]
  triggers?: string[]
  tags?: string[]
  tools?: string[]
  isCore?: boolean
  alwaysApply?: boolean
  version?: string
  author?: string
  [key: string]: unknown
}

export type SkillSourceType = 'global' | 'workspace' | 'codex' | 'cursor'

export interface SkillItem {
  id: string
  name: string
  description: string
  content: string
  isCore: boolean
  source: SkillSourceType
  tags: string[]
  globs?: string[]
  triggers?: string[]
  tools?: string[]
  createdAt: string
  updatedAt: string
  filePath: string
  isFolder?: boolean
  files?: string[]
  enabled?: boolean
  suite?: string
  category?: string
  categoryLabel?: string
  categoryIcon?: string
  embedding?: number[]
  similarityScore?: number
  matchReason?: string
  matchedTriggers?: string[]
}

export interface SkillEmbeddingRecord {
  hash: string
  embedding: number[]
  updatedAt: string
}

interface SkillEmbeddingsCacheData {
  records: Record<string, SkillEmbeddingRecord>
}

export class SkillService {
  private static _skillsDir: string | null = null
  private static _embeddingsCache: SkillEmbeddingsCacheData | null = null

  static getSkillsDir(): string {
    if (!this._skillsDir) {
      let baseDir = ''
      try {
        if (app && typeof app.getPath === 'function') {
          baseDir = app.getPath('userData')
        }
      } catch {}
      if (!baseDir) {
        baseDir = process.env.APPDATA || (process.platform === 'darwin' ? path.join(os.homedir(), 'Library', 'Application Support', 'zipply') : path.join(os.homedir(), '.config', 'zipply'))
      }
      this._skillsDir = path.join(baseDir, 'skills')
    }
    return this._skillsDir
  }

  static getEmbeddingsCachePath(): string {
    return path.join(this.getSkillsDir(), 'skills_embeddings.json')
  }

  private static _loadEmbeddingsCache(): SkillEmbeddingsCacheData {
    if (this._embeddingsCache) return this._embeddingsCache
    try {
      const p = this.getEmbeddingsCachePath()
      if (fs.existsSync(p)) {
        const raw = fs.readFileSync(p, 'utf-8')
        const data = JSON.parse(raw)
        if (data && typeof data.records === 'object') {
          this._embeddingsCache = data
          return data
        }
      }
    } catch (e) {
      console.warn('[SkillService] Failed to load embeddings cache:', e)
    }
    this._embeddingsCache = { records: {} }
    return this._embeddingsCache
  }

  private static _saveEmbeddingsCache(data: SkillEmbeddingsCacheData): void {
    this._embeddingsCache = data
    try {
      const p = this.getEmbeddingsCachePath()
      const dir = path.dirname(p)
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
      fs.writeFileSync(p, JSON.stringify(data, null, 2), 'utf-8')
    } catch (e) {
      console.warn('[SkillService] Failed to save embeddings cache:', e)
    }
  }

  static getSkillHash(skill: SkillItem): string {
    const raw = `${skill.id}:${skill.name}:${skill.description}:${(skill.triggers || []).join(',')}:${(skill.globs || []).join(',')}:${(skill.tags || []).join(',')}:${skill.content.slice(0, 3000)}`
    let h = 5381
    for (let i = 0; i < raw.length; i++) {
      h = ((h << 5) + h) ^ raw.charCodeAt(i)
      h = h >>> 0
    }
    return h.toString(16)
  }

  static getSkillSemanticText(skill: SkillItem): string {
    const parts = [
      `Навык: ${skill.name}`,
      `Описание: ${skill.description}`
    ]
    if (skill.triggers && skill.triggers.length > 0) {
      parts.push(`Триггеры / Ключевые слова: ${skill.triggers.join(', ')}`)
    }
    if (skill.tags && skill.tags.length > 0) {
      parts.push(`Теги: ${skill.tags.join(', ')}`)
    }
    if (skill.globs && skill.globs.length > 0) {
      parts.push(`Файловые маски и расширения: ${skill.globs.join(', ')}`)
    }
    if (skill.content) {
      const bodySnippet = skill.content.slice(0, 2000).replace(/#+\s*/g, '')
      parts.push(`Инструкции:\n${bodySnippet}`)
    }
    return parts.join('\n')
  }

  static getDisabledSkillsPath(): string {
    return path.join(this.getSkillsDir(), 'disabled_skills.json')
  }

  static getDisabledSkills(): Set<string> {
    try {
      const p = this.getDisabledSkillsPath()
      if (fs.existsSync(p)) {
        const data = JSON.parse(fs.readFileSync(p, 'utf-8'))
        if (Array.isArray(data)) return new Set(data.map((x) => String(x).toLowerCase().trim()))
      }
    } catch {}
    return new Set()
  }

  static saveDisabledSkills(set: Set<string>): void {
    try {
      const p = this.getDisabledSkillsPath()
      const dir = path.dirname(p)
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
      fs.writeFileSync(p, JSON.stringify(Array.from(set), null, 2), 'utf-8')
    } catch (e) {
      console.warn('[SkillService] Failed to save disabled skills:', e)
    }
  }

  static toggleSkillEnabled(nameOrId: string, enabled?: boolean): { success: boolean; enabled: boolean } {
    this.init()
    const set = this.getDisabledSkills()
    const key = nameOrId.toLowerCase().trim()
    const safeKey = this.sanitizeSkillName(key)
    
    // Find matching skill to grab its full canonical name & ID
    const all = this.getAllSkills()
    const match = all.find(
      (s) => s.name.toLowerCase() === key || s.id.toLowerCase() === key || this.sanitizeSkillName(s.name) === safeKey
    )

    const isCurrentlyDisabled = match
      ? match.enabled === false
      : set.has(key) || set.has(safeKey)
    const newEnabled = enabled !== undefined ? enabled : isCurrentlyDisabled

    const keysToUpdate = new Set<string>([key, safeKey])
    if (match) {
      keysToUpdate.add(match.name.toLowerCase().trim())
      keysToUpdate.add(match.id.toLowerCase().trim())
      keysToUpdate.add(this.sanitizeSkillName(match.name))
    }

    for (const k of keysToUpdate) {
      if (newEnabled) {
        set.delete(k)
      } else {
        set.add(k)
      }
    }
    this.saveDisabledSkills(set)
    return { success: true, enabled: newEnabled }
  }

  static togglePackageEnabled(skillNamesOrIds: string[], enabled: boolean): { success: boolean; count: number } {
    this.init()
    const set = this.getDisabledSkills()
    let count = 0
    for (const item of skillNamesOrIds) {
      const key = item.toLowerCase().trim()
      if (enabled) {
        if (set.delete(key)) count++
      } else {
        if (!set.has(key)) {
          set.add(key)
          count++
        }
      }
    }
    this.saveDisabledSkills(set)
    return { success: true, count }
  }

  static deleteMultipleSkills(items: Array<{ name: string; isCore?: boolean; sourcePath?: string }>): { success: boolean; deletedCount: number } {
    this.init()
    let deletedCount = 0
    for (const item of items) {
      const res = this.deleteSkill(item.name, item.isCore, item.sourcePath)
      if (res.success) deletedCount++
    }
    return { success: true, deletedCount }
  }

  static getCategoryMeta(categoryKey: string): { label: string; icon: string } {
    const clean = (categoryKey || 'custom').toLowerCase().trim()
    switch (clean) {
      case 'system':
        return { label: 'Системные правила', icon: 'ShieldAlert' }
      case 'tools':
        return { label: 'Инструменты Zipply', icon: 'Wrench' }
      case 'engineering':
        return { label: 'Разработка и стек', icon: 'Cpu' }
      case 'workspace':
        return { label: 'Текущий проект', icon: 'FolderGit2' }
      case 'codex':
        return { label: 'Codex', icon: 'Sparkles' }
      case 'claude':
        return { label: 'Claude / Инструкции', icon: 'Bot' }
      case 'custom':
        return { label: 'Пользовательские', icon: 'User' }
      default:
        return { label: clean.charAt(0).toUpperCase() + clean.slice(1), icon: 'Folder' }
    }
  }

  static getDisabledCategoriesPath(): string {
    return path.join(this.getSkillsDir(), 'disabled_categories.json')
  }

  static getDisabledCategories(): Set<string> {
    try {
      const p = this.getDisabledCategoriesPath()
      if (fs.existsSync(p)) {
        const data = JSON.parse(fs.readFileSync(p, 'utf-8'))
        if (Array.isArray(data)) return new Set(data.map((x) => String(x).toLowerCase().trim()))
      }
    } catch {}
    return new Set()
  }

  static saveDisabledCategories(set: Set<string>): void {
    try {
      const p = this.getDisabledCategoriesPath()
      const dir = path.dirname(p)
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
      fs.writeFileSync(p, JSON.stringify(Array.from(set), null, 2), 'utf-8')
    } catch (e) {
      console.warn('[SkillService] Failed to save disabled categories:', e)
    }
  }

  static toggleCategoryEnabled(categoryKey: string, enabled: boolean, workspacePath?: string): { success: boolean; count: number } {
    this.init()
    const targetCat = (categoryKey || '').toLowerCase().trim()
    const allSkills = this.getAllSkills(workspacePath)
    const catSkills = allSkills.filter((s) => (s.category || 'custom').toLowerCase() === targetCat)
    
    const disabledSkills = this.getDisabledSkills()
    let count = 0

    for (const skill of catSkills) {
      const nameKey = skill.name.toLowerCase().trim()
      const idKey = skill.id.toLowerCase().trim()
      if (enabled) {
        if (disabledSkills.delete(nameKey)) count++
        disabledSkills.delete(idKey)
      } else {
        if (!disabledSkills.has(nameKey)) {
          disabledSkills.add(nameKey)
          count++
        }
        disabledSkills.add(idKey)
      }
    }
    this.saveDisabledSkills(disabledSkills)

    const disabledCats = this.getDisabledCategories()
    if (enabled) {
      disabledCats.delete(targetCat)
    } else {
      disabledCats.add(targetCat)
    }
    this.saveDisabledCategories(disabledCats)

    return { success: true, count }
  }

  static transferSkills(
    items: Array<{ name: string; sourcePath: string; isFolder?: boolean }>,
    targetCategory: string = 'custom',
    isCore: boolean = false
  ): { success: boolean; count: number; error?: string } {
    this.init()
    try {
      const cleanCat = this.sanitizeSkillName(targetCategory || 'custom')
      const targetDir = isCore ? this.getCoreDir() : path.join(this.getExtraDir(), cleanCat)
      if (!fs.existsSync(targetDir)) {
        fs.mkdirSync(targetDir, { recursive: true })
      }

      let count = 0
      for (const item of items) {
        if (!item.sourcePath || !fs.existsSync(item.sourcePath)) continue
        const safeName = this.sanitizeSkillName(item.name || path.basename(item.sourcePath))
        const stats = fs.statSync(item.sourcePath)

        if (stats.isDirectory()) {
          const dest = path.join(targetDir, safeName)
          if (fs.existsSync(dest)) {
            fs.rmSync(dest, { recursive: true, force: true })
          }
          fs.cpSync(item.sourcePath, dest, { recursive: true })

          // Update frontmatter in transferred folder skill
          const skillMd = path.join(dest, 'SKILL.md')
          const lowercaseMd = path.join(dest, 'skill.md')
          const targetMd = fs.existsSync(skillMd) ? skillMd : fs.existsSync(lowercaseMd) ? lowercaseMd : null
          if (targetMd) {
            try {
              const raw = fs.readFileSync(targetMd, 'utf-8')
              const { metadata, body } = this.parseRawContent(raw)
              metadata.isCore = isCore
              if (!isCore) metadata.category = cleanCat
              const yaml = Object.entries(metadata)
                .map(([k, v]) => `${k}: ${typeof v === 'object' ? JSON.stringify(v) : v}`)
                .join('\n')
              fs.writeFileSync(targetMd, `---\n${yaml}\n---\n\n${body}`, 'utf-8')
            } catch {}
          }
          count++
        } else if (stats.isFile()) {
          const dest = path.join(targetDir, `${safeName}.md`)
          try {
            const raw = fs.readFileSync(item.sourcePath, 'utf-8')
            const { metadata, body } = this.parseRawContent(raw)
            metadata.isCore = isCore
            if (!isCore) metadata.category = cleanCat
            const yaml = Object.entries(metadata)
              .map(([k, v]) => `${k}: ${typeof v === 'object' ? JSON.stringify(v) : v}`)
              .join('\n')
            fs.writeFileSync(dest, `---\n${yaml}\n---\n\n${body}`, 'utf-8')
          } catch {
            fs.copyFileSync(item.sourcePath, dest)
          }
          count++
        }
      }

      return { success: true, count }
    } catch (e: any) {
      console.error('[SkillService] Failed to transfer skills:', e)
      return { success: false, count: 0, error: e?.message || 'Ошибка переноса навыков' }
    }
  }

  static getCoreDir(): string {
    return path.join(this.getSkillsDir(), 'core')
  }

  static getExtraDir(): string {
    return path.join(this.getSkillsDir(), 'extra')
  }

  /**
   * Ensure standard directories exist and seed default skills if empty
   */
  static init(): void {
    try {
      const coreDir = this.getCoreDir()
      const extraDir = this.getExtraDir()

      if (!fs.existsSync(coreDir)) {
        fs.mkdirSync(coreDir, { recursive: true })
      }
      if (!fs.existsSync(extraDir)) {
        fs.mkdirSync(extraDir, { recursive: true })
      }

      this._seedDefaultSkills()
    } catch (err) {
      console.error('[SkillService] Failed to initialize skills directories:', err)
    }
  }

  private static _seedDefaultSkills(): void {
    try {
      const extraDir = this.getExtraDir()
      const versionFile = path.join(this.getSkillsDir(), '.skills_version')
      let installedVersion = 0

      if (fs.existsSync(versionFile)) {
        try {
          installedVersion = parseInt(fs.readFileSync(versionFile, 'utf-8').trim(), 10) || 0
        } catch {}
      }

      const shouldUpdate = installedVersion < DEFAULT_SKILLS_VERSION

      for (const skill of DEFAULT_SKILLS) {
        const targetPath = path.join(extraDir, skill.fileName)
        if (!fs.existsSync(targetPath) || shouldUpdate) {
          fs.writeFileSync(targetPath, skill.content, 'utf-8')
        }
      }

      if (shouldUpdate) {
        try {
          fs.writeFileSync(versionFile, String(DEFAULT_SKILLS_VERSION), 'utf-8')
        } catch {}
      }
    } catch (e) {
      console.warn('[SkillService] Failed to seed default skills:', e)
    }
  }

  static sanitizeSkillName(name: string): string {
    return (
      path
        .basename(name)
        .toLowerCase()
        .replace(/\.(md|mdc)$/i, '')
        .replace(/_/g, '-')
        .replace(/[^a-z0-9-]/g, '-')
        .replace(/-+/g, '-')
        .replace(/^-|-$/g, '') || 'custom-skill'
    )
  }

  /**
   * Parse frontmatter and content from raw markdown / mdc content
   */
  static parseRawContent(rawContent: string): { metadata: SkillMetadata; body: string } {
    const trimmed = rawContent.trim()
    if (!trimmed.startsWith('---')) {
      const lines = trimmed.split('\n')
      let description = ''
      let body = trimmed

      if (lines.length > 0) {
        const firstLine = lines[0].trim()
        if (firstLine.startsWith('#')) {
          description = firstLine.replace(/^#+\s*(Описание:?|Description:?)?\s*/i, '').trim()
          body = lines.slice(1).join('\n').trim()
        } else if (firstLine.toLowerCase().startsWith('description:')) {
          description = firstLine.replace(/^description:\s*/i, '').trim()
          body = lines.slice(1).join('\n').trim()
        }
      }

      return {
        metadata: { description: description || undefined },
        body
      }
    }

    const endFmIdx = trimmed.indexOf('---', 3)
    if (endFmIdx === -1) {
      return { metadata: {}, body: trimmed }
    }

    const frontmatterText = trimmed.slice(3, endFmIdx).trim()
    const body = trimmed.slice(endFmIdx + 3).trim()
    const metadata: SkillMetadata = {}

    for (const line of frontmatterText.split('\n')) {
      const match = line.match(/^([a-zA-Z0-9_-]+):\s*(.*)$/)
      if (!match) continue
      const key = match[1].trim()
      let val = match[2].trim()

      if (val.startsWith('[') && val.endsWith(']')) {
        try {
          val = val.replace(/'/g, '"')
          metadata[key] = JSON.parse(val)
        } catch {
          metadata[key] = val
            .slice(1, -1)
            .split(',')
            .map((s) => s.trim().replace(/^["']|["']$/g, ''))
            .filter(Boolean)
        }
      } else if (val.startsWith('"') && val.endsWith('"')) {
        metadata[key] = val.slice(1, -1)
      } else if (val.startsWith("'") && val.endsWith("'")) {
        metadata[key] = val.slice(1, -1)
      } else if (val === 'true') {
        metadata[key] = true
      } else if (val === 'false') {
        metadata[key] = false
      } else {
        metadata[key] = val
      }
    }

    return { metadata, body }
  }

  private static _parseSkillPath(
    targetPath: string,
    isCore: boolean,
    source: SkillSourceType,
    subCategory?: string
  ): SkillItem | null {
    try {
      if (!fs.existsSync(targetPath)) return null
      const stats = fs.statSync(targetPath)

      let mdFilePath = targetPath
      let isFolder = false
      let files: string[] = []

      if (stats.isDirectory()) {
        isFolder = true
        const skillMd = path.join(targetPath, 'SKILL.md')
        const lowercaseMd = path.join(targetPath, 'skill.md')
        const readmeMd = path.join(targetPath, 'README.md')

        if (fs.existsSync(skillMd)) {
          mdFilePath = skillMd
        } else if (fs.existsSync(lowercaseMd)) {
          mdFilePath = lowercaseMd
        } else if (fs.existsSync(readmeMd)) {
          mdFilePath = readmeMd
        } else {
          const firstMd = fs.readdirSync(targetPath).find((f) => f.endsWith('.md'))
          if (firstMd) {
            mdFilePath = path.join(targetPath, firstMd)
          } else {
            return null
          }
        }

        try {
          const listDirRecursive = (dir: string, base: string): string[] => {
            const entries = fs.readdirSync(dir, { withFileTypes: true })
            let res: string[] = []
            for (const entry of entries) {
              if (entry.name.startsWith('.') || entry.name === 'node_modules') continue
              const rel = path.join(base, entry.name).replace(/\\/g, '/')
              if (entry.isDirectory()) {
                res = res.concat(listDirRecursive(path.join(dir, entry.name), rel))
              } else {
                res.push(rel)
              }
            }
            return res
          }
          files = listDirRecursive(targetPath, '')
        } catch {}
      }

      const rawContent = fs.readFileSync(mdFilePath, 'utf-8')
      const folderOrFileName = isFolder
        ? path.basename(targetPath)
        : path.basename(targetPath).replace(/\.(md|mdc)$/i, '')

      const { metadata, body } = this.parseRawContent(rawContent)
      const name =
        typeof metadata.name === 'string' && metadata.name.trim()
          ? metadata.name.trim()
          : folderOrFileName

      const description =
        typeof metadata.description === 'string' && metadata.description.trim()
          ? metadata.description.trim()
          : `${name} skill guidelines`

      const effectiveIsCore = metadata.isCore !== undefined ? Boolean(metadata.isCore) : isCore

      const tags = Array.isArray(metadata.tags)
        ? metadata.tags.map(String)
        : [source, effectiveIsCore ? 'core' : 'extra']

      const globs = Array.isArray(metadata.globs) ? metadata.globs.map(String) : undefined
      const triggers = Array.isArray(metadata.triggers) ? metadata.triggers.map(String) : undefined
      const tools = Array.isArray(metadata.tools) ? metadata.tools.map(String) : undefined

      const id = `${source}-${effectiveIsCore ? 'core' : 'extra'}-${this.sanitizeSkillName(name)}`
      const disabledSet = this.getDisabledSkills()
      const isSkillDisabled = disabledSet.has(name.toLowerCase()) || disabledSet.has(id.toLowerCase())

      // Resolve category
      let category = ''
      const lowerName = name.toLowerCase()
      const lowerTags = tags.map((t) => t.toLowerCase())

      if (typeof metadata.category === 'string' && metadata.category.trim()) {
        category = metadata.category.trim().toLowerCase()
      } else if (source === 'codex') {
        category = 'codex'
      } else if (source === 'workspace') {
        category = 'workspace'
      } else if (subCategory && typeof subCategory === 'string' && subCategory.trim()) {
        category = subCategory.trim().toLowerCase()
      } else if (
        lowerName.startsWith('tool-') ||
        lowerName.startsWith('tools-') ||
        lowerTags.includes('tools') ||
        lowerTags.includes('tool')
      ) {
        category = 'tools'
      } else if (
        [
          'when-stuck',
          'systematic-debugging',
          'web-research-troubleshooting',
          'skills-continuous-evolution',
          'chat-history-reflection'
        ].includes(lowerName) ||
        lowerTags.includes('system')
      ) {
        category = 'system'
      } else if (
        [
          'test-driven-development',
          'frontend-modern-web',
          'backend-api-architecture',
          'database-migrations-sql',
          'performance-profiling',
          'code-standards',
          'git-workflows',
          'docker-management',
          'mcp-builder'
        ].includes(lowerName) ||
        lowerTags.includes('engineering') ||
        lowerTags.includes('code') ||
        lowerTags.includes('architecture')
      ) {
        category = 'engineering'
      } else if (effectiveIsCore) {
        category = 'system'
      } else {
        category = 'custom'
      }

      const meta = this.getCategoryMeta(category)

      return {
        id,
        name,
        description,
        content: body || rawContent,
        isCore: effectiveIsCore,
        source,
        tags,
        globs,
        triggers,
        tools,
        createdAt: stats.birthtime ? stats.birthtime.toISOString() : new Date().toISOString(),
        updatedAt: stats.mtime ? stats.mtime.toISOString() : new Date().toISOString(),
        filePath: targetPath,
        isFolder,
        files: isFolder ? files : undefined,
        enabled: !isSkillDisabled,
        category,
        categoryLabel: meta.label,
        categoryIcon: meta.icon
      }
    } catch (err) {
      console.warn(`[SkillService] Error parsing skill path ${targetPath}:`, err)
      return null
    }
  }

  private static _scanDirectory(
    dirPath: string,
    isCore: boolean,
    source: SkillSourceType,
    subCategory?: string
  ): SkillItem[] {
    const results: SkillItem[] = []
    if (!fs.existsSync(dirPath)) return results

    try {
      const entries = fs.readdirSync(dirPath, { withFileTypes: true })
      
      for (const entry of entries) {
        if (entry.name.startsWith('.')) continue
        const fullPath = path.join(dirPath, entry.name)

        if (entry.isDirectory()) {
          const isSingleSkillDir =
            fs.existsSync(path.join(fullPath, 'SKILL.md')) ||
            fs.existsSync(path.join(fullPath, 'skill.md')) ||
            fs.existsSync(path.join(fullPath, 'README.md'))

          if (isSingleSkillDir) {
            const item = this._parseSkillPath(fullPath, isCore, source, subCategory)
            if (item) results.push(item)
          } else if (!subCategory) {
            // It's a category subfolder (e.g. tools, system, engineering, custom)
            const subItems = this._scanDirectory(fullPath, isCore, source, entry.name)
            results.push(...subItems)
          }
        } else if (
          entry.isFile() &&
          (entry.name.endsWith('.md') || entry.name.endsWith('.mdc'))
        ) {
          const item = this._parseSkillPath(fullPath, isCore, source, subCategory)
          if (item) results.push(item)
        }
      }
    } catch (e) {
      console.warn(`[SkillService] Error scanning directory ${dirPath}:`, e)
    }

    return results
  }

  /**
   * Traverses directory tree upwards from startDir to the repository/workspace root.
   */
  static getHierarchyDirectories(startDir: string): string[] {
    const dirs = new Set<string>()
    if (!startDir || typeof startDir !== 'string') return []
    const trimmed = startDir.trim()
    if (!trimmed || !fs.existsSync(trimmed)) return []

    let current = path.normalize(trimmed)
    while (true) {
      dirs.add(current)
      const gitMarker = path.join(current, '.git')
      const parent = path.dirname(current)
      if (fs.existsSync(gitMarker) || parent === current) {
        break
      }
      current = parent
    }

    return Array.from(dirs)
  }

  static getAllSkills(workspacePath?: string): SkillItem[] {
    this.init()
    const map = new Map<string, SkillItem>()

    const coreSkills = this._scanDirectory(this.getCoreDir(), true, 'global')
    for (const s of coreSkills) map.set(s.name.toLowerCase(), s)

    const extraSkills = this._scanDirectory(this.getExtraDir(), false, 'global')
    for (const s of extraSkills) {
      if (!map.has(s.name.toLowerCase())) {
        map.set(s.name.toLowerCase(), s)
      }
    }

    const ws = workspacePath && typeof workspacePath === 'string' ? workspacePath.trim() : ''
    const targetDirsToScan = this.getHierarchyDirectories(ws)

    for (const dir of targetDirsToScan) {
      const agentsSkillsDir = path.join(dir, '.agents', 'skills')
      for (const s of this._scanDirectory(agentsSkillsDir, false, 'workspace')) {
        map.set(`agents-${s.name.toLowerCase()}`, s)
      }

      const wsSkillsDir = path.join(dir, '.skills')
      for (const s of this._scanDirectory(wsSkillsDir, false, 'workspace')) {
        if (!map.has(`ws-${s.name.toLowerCase()}`) && !map.has(`agents-${s.name.toLowerCase()}`)) {
          map.set(`ws-${s.name.toLowerCase()}`, s)
        }
      }
      const wsSkillsDirPlain = path.join(dir, 'skills')
      if (fs.existsSync(wsSkillsDirPlain)) {
        for (const s of this._scanDirectory(wsSkillsDirPlain, false, 'workspace')) {
          if (!map.has(`ws-${s.name.toLowerCase()}`) && !map.has(`agents-${s.name.toLowerCase()}`)) {
            map.set(`ws-${s.name.toLowerCase()}`, s)
          }
        }
      }

      const wsCodexSkillsDir = path.join(dir, '.codex', 'skills')
      for (const s of this._scanDirectory(wsCodexSkillsDir, false, 'codex')) {
        map.set(`codex-${s.name.toLowerCase()}`, s)
      }

      const wsClaudeSkillsDir = path.join(dir, '.claude', 'skills')
      for (const s of this._scanDirectory(wsClaudeSkillsDir, false, 'workspace')) {
        map.set(`claude-${s.name.toLowerCase()}`, s)
      }

      const claudeMd = path.join(dir, 'CLAUDE.md')
      if (fs.existsSync(claudeMd) && !map.has('claude-instructions')) {
        const item = this._parseSkillPath(claudeMd, true, 'workspace')
        if (item) {
          item.name = 'claude-instructions'
          item.description = 'Project instructions from CLAUDE.md'
          map.set('claude-instructions', item)
        }
      }
    }

    try {
      const homeDir = os.homedir()

      const userAgentsSkills = path.join(homeDir, '.agents', 'skills')
      if (fs.existsSync(userAgentsSkills)) {
        for (const s of this._scanDirectory(userAgentsSkills, false, 'workspace')) {
          if (!map.has(s.name.toLowerCase()) && !map.has(`agents-${s.name.toLowerCase()}`)) {
            map.set(`sys-agents-${s.name.toLowerCase()}`, s)
          }
        }
      }

      const userSkills = path.join(homeDir, '.skills')
      if (fs.existsSync(userSkills)) {
        for (const s of this._scanDirectory(userSkills, false, 'global')) {
          if (!map.has(s.name.toLowerCase()) && !map.has(`sys-agents-${s.name.toLowerCase()}`)) {
            map.set(`sys-skills-${s.name.toLowerCase()}`, s)
          }
        }
      }


      // ~/.codex/skills
      const userCodexSkills = path.join(homeDir, '.codex', 'skills')
      if (fs.existsSync(userCodexSkills)) {
        for (const s of this._scanDirectory(userCodexSkills, false, 'codex')) {
          if (!map.has(s.name.toLowerCase())) {
            map.set(`sys-codex-${s.name.toLowerCase()}`, s)
          }
        }
      }

      // ~/.kiro/skills, ~/.lmstudio/skills, ~/.qoder/skills, ~/.qwen/skills
      const otherAgents = ['.kiro', '.lmstudio', '.qoder', '.qwen']
      for (const agentDir of otherAgents) {
        const p = path.join(homeDir, agentDir, 'skills')
        if (fs.existsSync(p)) {
          for (const s of this._scanDirectory(p, false, 'workspace')) {
            if (!map.has(s.name.toLowerCase())) {
              map.set(`sys-${agentDir.replace('.', '')}-${s.name.toLowerCase()}`, s)
            }
          }
        }
      }
    } catch {}

    return Array.from(map.values())
  }

  /**
   * Formats all Core skills into a structured section for system prompt
   */
  static getCoreSkillsPrompt(workspacePath?: string): string {
    const allSkills = this.getAllSkills(workspacePath)
    const coreSkills = allSkills.filter((s) => s.isCore && s.enabled !== false)

    if (coreSkills.length === 0) return ''

    const sections: string[] = []
    for (const skill of coreSkills) {
      if (skill.content.trim()) {
        const badge = skill.source === 'workspace' ? ' [PROJECT]' : skill.source === 'codex' ? ' [CODEX]' : ''
        sections.push(`### [CORE-SKILL${badge}: ${skill.name}]\n${skill.content.trim()}`)
      }
    }

    if (sections.length === 0) return ''

    return `\n\n=== ПОСТОЯННЫЕ НАВЫКИ И ПРАВИЛА (Активны всегда) ===\n${sections.join('\n\n')}`
  }

  private static readonly _STOP_WORDS = new Set([
    'в', 'и', 'на', 'с', 'к', 'о', 'у', 'за', 'из', 'по', 'от', 'до', 'не', 'же', 'то', 'да', 'но', 'ли',
    'in', 'to', 'at', 'by', 'on', 'of', 'or', 'an', 'as', 'is', 'it', 'if', 'be', 'do', 'no', 'so', 'up', 'my', 'me'
  ])

  private static _tokenize(str: string): Set<string> {
    return new Set(
      str
        .toLowerCase()
        .replace(/[^\w\u0400-\u04FF\s]/g, ' ')
        .split(/\s+/)
        .filter((w) => w.length >= 2 && !SkillService._STOP_WORDS.has(w))
    )
  }

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
   * Enrich a single skill with vector embedding, leveraging persistent cache.
   */
  static async enrichSkillEmbedding(
    skill: SkillItem,
    config: EmbeddingConfig
  ): Promise<number[] | null> {
    if (!config.embeddingModel?.trim()) return null
    const cache = this._loadEmbeddingsCache()
    const hash = this.getSkillHash(skill)
    const existing = cache.records[skill.id]

    if (existing && existing.hash === hash && Array.isArray(existing.embedding) && existing.embedding.length > 0) {
      skill.embedding = existing.embedding
      return existing.embedding
    }

    const textToEmbed = this.getSkillSemanticText(skill)
    try {
      const embedding = await EmbeddingService.getEmbedding(textToEmbed, config)
      if (embedding && embedding.length > 0) {
        skill.embedding = embedding
        cache.records[skill.id] = {
          hash,
          embedding,
          updatedAt: new Date().toISOString()
        }
        this._saveEmbeddingsCache(cache)
        return embedding
      }
    } catch (e) {
      console.warn(`[SkillService] Failed to generate embedding for skill ${skill.name}:`, e)
    }
    return null
  }

  /**
   * Pre-calculate embeddings for all skills in background (non-blocking).
   */
  static async enrichSkillEmbeddingsAsync(
    config: EmbeddingConfig,
    workspacePath?: string
  ): Promise<number> {
    if (!config.embeddingModel?.trim()) return 0
    const skills = this.getAllSkills(workspacePath)
    let enriched = 0

    for (const skill of skills) {
      try {
        const cache = this._loadEmbeddingsCache()
        const hash = this.getSkillHash(skill)
        if (cache.records[skill.id]?.hash === hash) continue

        const vec = await this.enrichSkillEmbedding(skill, config)
        if (vec) {
          enriched++
          await new Promise<void>((r) => setTimeout(r, 40))
        }
      } catch {}
    }
    return enriched
  }

  /**
   * High-accuracy Hybrid Vector Search for Skills:
   * Combines Semantic Cosine Embedding Similarity with Keyword/Trigger matching & Token Overlap.
   */
  static async searchSkillsAsync(
    query: string = '',
    options: {
      workspacePath?: string
      filterType?: string
      embeddingConfig?: EmbeddingConfig
      limit?: number
    } = {}
  ): Promise<Array<SkillItem & { similarityScore?: number; matchReason?: string; matchedTriggers?: string[] }>> {
    const allSkills = this.getAllSkills(options.workspacePath)
    let filtered = allSkills

    const filter = (options.filterType || 'all').toLowerCase().trim()
    if (filter === 'core') filtered = filtered.filter((s) => s.isCore)
    else if (filter === 'extra') filtered = filtered.filter((s) => !s.isCore)
    else if (filter === 'workspace') filtered = filtered.filter((s) => s.source === 'workspace' || s.category === 'workspace')
    else if (filter === 'external' || filter === 'codex') filtered = filtered.filter((s) => s.source === 'codex' || s.category === 'codex')
    else if (filter !== 'all') filtered = filtered.filter((s) => (s.category || '').toLowerCase() === filter)

    const cleanQuery = query.trim()
    if (!cleanQuery) {
      return filtered.map((s) => ({ ...s }))
    }

    const queryLower = cleanQuery.toLowerCase()
    const queryTokens = this._tokenize(cleanQuery)
    const embeddingConfig = options.embeddingConfig

    // 1. Get query embedding if vector search is configured
    let queryEmbedding: number[] | null = null
    if (embeddingConfig?.embeddingModel?.trim()) {
      try {
        queryEmbedding = await EmbeddingService.getEmbedding(cleanQuery, embeddingConfig)
      } catch (e) {
        console.warn('[SkillService] Query embedding failed, falling back to lexical:', e)
      }
    }

    // 2. Score each skill with semantic & lexical signals
    const cache = this._loadEmbeddingsCache()

    const scored = await Promise.all(
      filtered.map(async (skill) => {
        let semanticSim = 0
        let lexicalScore = 0
        const matchedTriggers: string[] = []
        let matchReason = ''

        // --- Semantic Vector Similarity ---
        if (queryEmbedding) {
          let skillVec = skill.embedding
          if (!skillVec || skillVec.length === 0) {
            const hash = this.getSkillHash(skill)
            const cached = cache.records[skill.id]
            if (cached && cached.hash === hash) {
              skillVec = cached.embedding
              skill.embedding = cached.embedding
            } else if (embeddingConfig) {
              skillVec = (await this.enrichSkillEmbedding(skill, embeddingConfig)) || undefined
            }
          }

          if (skillVec && skillVec.length > 0) {
            semanticSim = EmbeddingService.cosineSimilarity(queryEmbedding, skillVec)
          }
        }

        // --- Lexical & Keyword Matching ---
        const nameLower = skill.name.toLowerCase()
        const descLower = skill.description.toLowerCase()
        const contentSnippet = skill.content.slice(0, 800).toLowerCase()

        // Trigger matching (Strongest signal: 10 pts per match)
        if (skill.triggers && skill.triggers.length > 0) {
          for (const tr of skill.triggers) {
            const trLower = tr.toLowerCase()
            if (queryLower.includes(trLower) || trLower.includes(queryLower)) {
              matchedTriggers.push(tr)
              lexicalScore += 10
            }
          }
        }

        // File globs & extensions matching (8 pts)
        if (skill.globs && skill.globs.length > 0) {
          for (const glob of skill.globs) {
            const ext = glob.match(/\.([a-z0-9]+)$/i)?.[1]?.toLowerCase()
            if (ext && (queryLower.includes(`.${ext}`) || queryLower.includes(ext))) {
              lexicalScore += 8
              if (!matchReason) matchReason = `Файловая маска: ${glob}`
            }
            const cleanGlob = glob.replace(/[*.\/]/g, '').toLowerCase()
            if (cleanGlob.length >= 3 && queryLower.includes(cleanGlob)) {
              lexicalScore += 6
            }
          }
        }

        // Name and description keyword overlap (3-6 pts)
        for (const token of queryTokens) {
          if (nameLower.includes(token)) {
            lexicalScore += 6
            if (!matchReason) matchReason = `Имя совпадает с «${token}»`
          } else if (descLower.includes(token)) {
            lexicalScore += 3
          } else if (contentSnippet.includes(token)) {
            lexicalScore += 1
          }
        }

        // Domain concept expansion for common high-impact skills:
        const isAppCreation = /(?:^|[^a-zа-яё0-9])(соцсеть|твиттер|twitter|мессенджер|чат|сайт|сервис|веб|портал|магазин|платформ|fullstack|бэкенд|фронтенд|приложени)(?:$|[^a-zа-яё0-9])/iu.test(queryLower)
        if (isAppCreation) {
          if (nameLower.includes('frontend-modern-web') || nameLower.includes('backend-api-architecture')) {
            lexicalScore += 16
            if (!matchReason) matchReason = 'Разработка веб-сервиса / приложения'
          }
        }

        const isTrouble = /(?:^|[^a-zа-яё0-9])(запутался|тупик|не получается|по кругу|одно и то же|херн|фигн|не работает|застрял|долго)(?:$|[^a-zа-яё0-9])/iu.test(queryLower)
        if (isTrouble && nameLower.includes('when-stuck')) {
          lexicalScore += 18
          if (!matchReason) matchReason = 'Помощь при затруднениях / выходе из тупика'
        }

        // Category match bonus
        if (skill.category && queryLower.includes(skill.category.toLowerCase())) {
          lexicalScore += 8
          if (!matchReason) matchReason = `Раздел: ${skill.categoryLabel || skill.category}`
        }
        if (skill.categoryLabel && queryLower.includes(skill.categoryLabel.toLowerCase())) {
          lexicalScore += 8
          if (!matchReason) matchReason = `Раздел: ${skill.categoryLabel}`
        }

        const jaccard = this._jaccardSimilarity(cleanQuery, `${skill.name} ${skill.description}`)

        if (matchedTriggers.length > 0) {
          matchReason = `Триггеры: ${matchedTriggers.join(', ')}`
        }

        // Hybrid combined score (0..100)
        let combinedScore = 0
        if (queryEmbedding && semanticSim > 0) {
          const normalizedLexical = Math.min(1.0, lexicalScore / 20 + jaccard)
          const raw = semanticSim * 0.65 + normalizedLexical * 0.35
          combinedScore = Math.round(Math.min(100, Math.max(0, raw * 100)))
          if (semanticSim >= 0.75 && !matchReason) {
            matchReason = 'Семантическое соответствие'
          }
        } else {
          const raw = Math.min(1.0, lexicalScore / 18 + jaccard * 0.6)
          combinedScore = Math.round(Math.min(100, Math.max(0, raw * 100)))
        }

        return {
          ...skill,
          similarityScore: combinedScore,
          matchedTriggers: matchedTriggers.length > 0 ? matchedTriggers : undefined,
          matchReason: matchReason || undefined
        }
      })
    )

    scored.sort((a, b) => (b.similarityScore || 0) - (a.similarityScore || 0))

    const limit = options.limit || 50
    const filteredResults = scored.filter((s) => (s.similarityScore || 0) > 0)
    return (filteredResults.length > 0 ? filteredResults : scored).slice(0, limit)
  }

  /**
   * Deterministic, Prefix-Stable Extra Skills Catalog for System Prompt.
   * Grouped into a semantic ontology by sections/categories.
   * Enables optimal LLM Prompt Caching across conversational turns.
   */
  static getStableSkillsCatalogPrompt(workspacePath: string = ''): string {
    const allSkills = this.getAllSkills(workspacePath)
    const extraSkills = allSkills.filter((s) => !s.isCore && s.enabled !== false)
    if (extraSkills.length === 0) return ''

    // Group skills by category
    const catMap = new Map<string, { label: string; skills: SkillItem[] }>()

    for (const skill of extraSkills) {
      const catKey = skill.category || 'custom'
      if (!catMap.has(catKey)) {
        catMap.set(catKey, {
          label: skill.categoryLabel || this.getCategoryMeta(catKey).label,
          skills: []
        })
      }
      catMap.get(catKey)!.skills.push(skill)
    }

    // Deterministic category order
    const priority = ['system', 'tools', 'engineering', 'workspace', 'codex', 'claude', 'custom']
    const sortedCats = Array.from(catMap.entries()).sort(([a], [b]) => {
      const idxA = priority.indexOf(a)
      const idxB = priority.indexOf(b)
      if (idxA !== -1 && idxB !== -1) return idxA - idxB
      if (idxA !== -1) return -1
      if (idxB !== -1) return 1
      return a.localeCompare(b)
    })

    const categoryBlocks: string[] = []

    for (const [catKey, catData] of sortedCats) {
      const skillLines: string[] = []
      catData.skills.sort((a, b) => a.name.localeCompare(b.name))
      for (const skill of catData.skills) {
        const attrs: string[] = [
          `name="${skill.name}"`,
          `desc="${skill.description.replace(/"/g, "'")}"`
        ]
        if (skill.triggers && skill.triggers.length > 0) {
          attrs.push(`triggers="${skill.triggers.slice(0, 4).join(', ')}"`)
        }
        if (skill.globs && skill.globs.length > 0) {
          attrs.push(`globs="${skill.globs.slice(0, 3).join(', ')}"`)
        }
        if (skill.source && skill.source !== 'global') {
          attrs.push(`source="${skill.source}"`)
        }
        if (skill.files && skill.files.length > 0) {
          attrs.push(`files="${skill.files.slice(0, 3).join(', ')}"`)
        }
        skillLines.push(`    <skill ${attrs.join(' ')}/>`)
      }
      categoryBlocks.push(`  <category id="${catKey}" title="${catData.label}">\n${skillLines.join('\n')}\n  </category>`)
    }

    return `\n\n=== КАТАЛОГ НАВЫКОВ ПО РАЗДЕЛАМ (Онтология знаний Zipply) ===
У тебя есть встроенная библиотека проверенных инженерных руководств, правил и инструментов.
Ты ОБЯЗАНА использовать навыки перед выполнением сложных задач или при возникновении трудностей:
<available_skills>
<skills_ontology>
${categoryBlocks.join('\n')}
</skills_ontology>
</available_skills>
Для изучения любого навыка вызови: \`read_skill(skill_name="...")\`.
Для поиска по ключевым словам или теме вызови: \`search_skills(query="...")\`.
Для просмотра всех навыков раздела вызови: \`list_skills(category="...")\`.`
  }

  /**
   * Generates a strict Turn-1 Auto-Enforcement Directive when high-confidence skill match is detected.
   * Prevents the agent from rushing into code generation before inspecting domain rules.
   */
  static async getEnforcementDirectiveAsync(
    userQueryText: string = '',
    workspacePath: string = '',
    embeddingConfig?: EmbeddingConfig,
    historyTurnCount: number = 0
  ): Promise<string> {
    if (!userQueryText || userQueryText.trim().length < 3 || historyTurnCount > 1) {
      return ''
    }

    const searchResults = await this.searchSkillsAsync(userQueryText, {
      workspacePath,
      filterType: 'extra',
      embeddingConfig,
      limit: 1
    })

    const top = searchResults.find((s) => s.enabled !== false)
    if (!top) return ''

    const score = top.similarityScore || 0
    const hasTriggers = top.matchedTriggers && top.matchedTriggers.length > 0
    const isStrongMatch = score >= 70 || hasTriggers

    if (!isStrongMatch) return ''

    const reason = top.matchReason ? ` (${top.matchReason})` : ''
    return `> [!CRITICAL_SKILL_ENFORCEMENT]
> ДЛЯ ТЕКУЩЕЙ ЗАДАЧИ ОБНАРУЖЕН СПЕЦИАЛИЗИРОВАННЫЙ НАВЫК: \`${top.name}\`${reason}.
> ТВОЕ ПЕРВОЕ ДЕЙСТВИЕ НА ЭТОМ ШАГЕ — ВЫЗВАТЬ:
> \`read_skill(skill_name="${top.name}")\`
> СТРОГО ЗАПРЕЩЕНО писать код или выполнять команды в терминале ДО прочтения правил и инструкций этого навыка.`
  }


  /**
   * Formats relevant Extra skills into an ultra-compact catalog for system prompt
   * with Vector Semantic ranking and intelligent recommendations.
   */
  static async getExtraSkillsCatalogPromptAsync(
    userQueryText: string = '',
    workspacePath: string = '',
    embeddingConfig?: EmbeddingConfig
  ): Promise<string> {
    const allSkills = this.getAllSkills(workspacePath)
    const extraSkills = allSkills.filter((s) => !s.isCore && s.enabled !== false)
    if (extraSkills.length === 0) return ''

    let selectedSkills: SkillItem[] = extraSkills
    let topRecommendedSkill: string | null = null

    if (userQueryText && userQueryText.trim().length >= 2) {
      const searchResults = await this.searchSkillsAsync(userQueryText, {
        workspacePath,
        filterType: 'extra',
        embeddingConfig,
        limit: 8
      })

      const enabledResults = searchResults.filter((s) => s.enabled !== false)
      if (enabledResults.length > 0) {
        selectedSkills = enabledResults
        const top = enabledResults[0]
        if (top && (top.similarityScore || 0) >= 55) {
          topRecommendedSkill = top.name
        }
      }
    }

    const catalogEntries: string[] = []
    for (const skill of selectedSkills.slice(0, 8)) {
      const isRecommended = skill.name === topRecommendedSkill
      const attrList: string[] = [`name="${skill.name}"`, `desc="${skill.description.replace(/"/g, "'")}"`]
      if (isRecommended) {
        attrList.push('recommended="true"')
      }
      if (skill.triggers && skill.triggers.length > 0) {
        attrList.push(`triggers="${skill.triggers.slice(0, 4).join(', ')}"`)
      }
      if (skill.globs && skill.globs.length > 0) {
        attrList.push(`globs="${skill.globs.slice(0, 3).join(', ')}"`)
      }
      if (skill.source && skill.source !== 'global') {
        attrList.push(`source="${skill.source}"`)
      }
      if (skill.files && skill.files.length > 0) {
        attrList.push(`files="${skill.files.slice(0, 3).join(', ')}"`)
      }
      catalogEntries.push(`  <skill ${attrList.join(' ')}/>`)
    }

    if (catalogEntries.length === 0) return ''

    const recommendationDirective = topRecommendedSkill
      ? `\n> [!IMPORTANT]\n> Для текущей задачи обнаружен подходящий навык: \`${topRecommendedSkill}\`. Вызови \`read_skill(skill_name="${topRecommendedSkill}")\` перед началом работы, чтобы следовать его правилам.\n`
      : ''

    return `\n\n=== КАТАЛОГ ДОПОЛНИТЕЛЬНЫХ НАВЫКОВ (По требованию) ===
Если задача требует специфических знаний или правил из списка ниже, вызови инструмент \`read_skill(skill_name)\` ПЕРЕД выполнением:${recommendationDirective}
<available_skills>
${catalogEntries.join('\n')}
</available_skills>`
  }

  /**
   * Synchronous fallback for legacy callers.
   */
  static getExtraSkillsCatalogPrompt(
    userQueryText: string = '',
    workspacePath: string = ''
  ): string {
    const allSkills = this.getAllSkills(workspacePath)
    const extraSkills = allSkills.filter((s) => !s.isCore && s.enabled !== false)

    let selectedSkills = extraSkills
    let topRecommendedSkill: string | null = null

    if (userQueryText) {
      const queryLower = userQueryText.toLowerCase()
      const queryTokens = new Set(queryLower.split(/[\s,.:;!?(){}\[\]"']+/).filter((t) => t.length > 2))

      const scored = extraSkills.map((skill) => {
        let score = 0
        const nameLower = skill.name.toLowerCase()
        const descLower = skill.description.toLowerCase()

        if (skill.triggers && skill.triggers.length > 0) {
          for (const trigger of skill.triggers) {
            const trLower = trigger.toLowerCase()
            if (queryLower.includes(trLower)) score += 6
          }
        }

        if (skill.globs && skill.globs.length > 0) {
          for (const glob of skill.globs) {
            const extMatch = glob.match(/\.([a-z0-9]+)$/i)
            if (extMatch && queryLower.includes(`.${extMatch[1].toLowerCase()}`)) score += 4
            const keyword = glob.replace(/[*.\/]/g, '').toLowerCase()
            if (keyword.length > 2 && queryLower.includes(keyword)) score += 3
          }
        }

        for (const token of queryTokens) {
          if (nameLower.includes(token)) score += 3
          if (descLower.includes(token)) score += 1
        }

        if (skill.source === 'workspace' || skill.source === 'cursor') score += 1
        return { skill, score }
      })

      scored.sort((a, b) => b.score - a.score)
      if (scored.length > 0 && scored[0].score >= 6) {
        topRecommendedSkill = scored[0].skill.name
      }
      selectedSkills = scored.slice(0, 8).map((s) => s.skill)
    }

    const catalogEntries: string[] = []
    for (const skill of selectedSkills) {
      const isRecommended = skill.name === topRecommendedSkill
      const attrList: string[] = [`name="${skill.name}"`, `desc="${skill.description.replace(/"/g, "'")}"`]
      if (isRecommended) attrList.push('recommended="true"')
      if (skill.triggers && skill.triggers.length > 0) attrList.push(`triggers="${skill.triggers.slice(0, 4).join(', ')}"`)
      if (skill.globs && skill.globs.length > 0) attrList.push(`globs="${skill.globs.slice(0, 3).join(', ')}"`)
      if (skill.source && skill.source !== 'global') attrList.push(`source="${skill.source}"`)
      if (skill.files && skill.files.length > 0) attrList.push(`files="${skill.files.slice(0, 3).join(', ')}"`)
      catalogEntries.push(`  <skill ${attrList.join(' ')}/>`)
    }

    if (catalogEntries.length === 0) return ''

    const recommendationDirective = topRecommendedSkill
      ? `\n> [!IMPORTANT]\n> Для текущей задачи обнаружен подходящий навык: \`${topRecommendedSkill}\`. Вызови \`read_skill(skill_name="${topRecommendedSkill}")\` перед началом работы, чтобы следовать его правилам.\n`
      : ''

    return `\n\n=== КАТАЛОГ ДОПОЛНИТЕЛЬНЫХ НАВЫКОВ (По требованию) ===
Если задача требует специфических знаний или правил из списка ниже, вызови инструмент \`read_skill(skill_name)\` ПЕРЕД выполнением:${recommendationDirective}
<available_skills>
${catalogEntries.join('\n')}
</available_skills>`
  }

  /**
   * Read skill content by name safely. Supports reading internal sub-resources (scripts/examples) as well.
   */
  static readSkill(
    skillName: string,
    resourcePath?: string,
    workspacePath?: string
  ): {
    success: boolean
    content?: string
    metadata?: SkillMetadata
    resourceContent?: string
    files?: string[]
    error?: string
  } {
    const allSkills = this.getAllSkills(workspacePath)
    const cleanQuery = this.sanitizeSkillName(skillName)

    // Direct match by name or ID
    let found = allSkills.find(
      (s) =>
        s.name.toLowerCase() === skillName.toLowerCase() ||
        this.sanitizeSkillName(s.name) === cleanQuery ||
        s.id.toLowerCase() === skillName.toLowerCase()
    )

    // Fuzzy match fallback
    if (!found) {
      found = allSkills.find(
        (s) =>
          this.sanitizeSkillName(s.name).includes(cleanQuery) ||
          cleanQuery.includes(this.sanitizeSkillName(s.name))
      )
    }

    if (!found) {
      return { success: false, error: `Навык '${skillName}' не найден в каталоге.` }
    }

    // If a specific sub-resource was requested (e.g. scripts/build.ps1 or examples/test.ts)
    if (resourcePath && found.isFolder) {
      try {
        const safeRel = path.normalize(resourcePath).replace(/^(\.\.[\/\\])+/, '')
        const fullResPath = path.join(found.filePath, safeRel)
        if (fs.existsSync(fullResPath) && fs.statSync(fullResPath).isFile()) {
          const resContent = fs.readFileSync(fullResPath, 'utf-8')
          return {
            success: true,
            content: found.content,
            resourceContent: resContent,
            files: found.files,
            metadata: {
              name: found.name,
              description: found.description,
              globs: found.globs,
              triggers: found.triggers,
              tags: found.tags,
              tools: found.tools,
              isCore: found.isCore
            }
          }
        } else {
          return {
            success: false,
            error: `Файл '${resourcePath}' не найден внутри навыка '${found.name}'. Доступные файлы: ${(found.files || []).join(', ')}`
          }
        }
      } catch (err: any) {
        return { success: false, error: `Ошибка при чтении ресурса: ${err?.message || err}` }
      }
    }

    return {
      success: true,
      content: found.content,
      files: found.files,
      metadata: {
        name: found.name,
        description: found.description,
        globs: found.globs,
        triggers: found.triggers,
        tags: found.tags,
        tools: found.tools,
        isCore: found.isCore
      }
    }
  }

  /**
   * Save or update a skill file with YAML frontmatter metadata
   */
  static saveSkill(
    name: string,
    description: string,
    content: string,
    isCore: boolean = false,
    metadata?: { globs?: string[]; triggers?: string[]; tags?: string[]; tools?: string[] }
  ): { success: boolean; skill?: SkillItem; error?: string } {
    this.init()
    const safeName = this.sanitizeSkillName(name)
    const targetDir = isCore ? this.getCoreDir() : this.getExtraDir()
    const otherDir = isCore ? this.getExtraDir() : this.getCoreDir()

    const targetPath = path.join(targetDir, `${safeName}.md`)
    const oldPathInOther = path.join(otherDir, `${safeName}.md`)

    try {
      // If was previously in other dir, remove from there
      if (fs.existsSync(oldPathInOther)) {
        fs.unlinkSync(oldPathInOther)
      }

      // If content already contains frontmatter, strip it to avoid duplication
      const { body } = this.parseRawContent(content)
      const cleanBody = (body || content).trim()

      const globs = metadata?.globs || []
      const triggers = metadata?.triggers || []
      const tags = metadata?.tags || []
      const tools = metadata?.tools || []

      // Format markdown content with clean YAML frontmatter header
      const frontmatterLines = [
        '---',
        `name: ${safeName}`,
        `description: ${description.trim()}`
      ]
      if (globs.length > 0) frontmatterLines.push(`globs: ${JSON.stringify(globs)}`)
      if (triggers.length > 0) frontmatterLines.push(`triggers: ${JSON.stringify(triggers)}`)
      if (tags.length > 0) frontmatterLines.push(`tags: ${JSON.stringify(tags)}`)
      if (tools.length > 0) frontmatterLines.push(`tools: ${JSON.stringify(tools)}`)
      frontmatterLines.push('---', '', cleanBody, '')

      fs.writeFileSync(targetPath, frontmatterLines.join('\n'), 'utf-8')

      const parsed = this._parseSkillPath(targetPath, isCore, 'global')
      if (parsed) {
        return { success: true, skill: parsed }
      }
      return { success: true }
    } catch (err: any) {
      console.error('[SkillService] Failed to save skill:', err)
      return { success: false, error: err?.message || 'Не удалось сохранить навык' }
    }
  }

  /**
   * Delete a skill file or folder
   */
  static deleteSkill(name: string, isCore?: boolean, sourcePath?: string): { success: boolean; error?: string } {
    this.init()
    const safeName = this.sanitizeSkillName(name)
    let deleted = false

    // If direct sourcePath is provided or found in library
    let targetFileOrDir = sourcePath
    if (!targetFileOrDir) {
      const all = this.getAllSkills()
      const found = all.find(
        (s) => s.name.toLowerCase() === name.toLowerCase() || this.sanitizeSkillName(s.name) === safeName
      )
      if (found && found.filePath) {
        targetFileOrDir = found.filePath
      }
    }

    if (targetFileOrDir && fs.existsSync(targetFileOrDir)) {
      try {
        const stats = fs.statSync(targetFileOrDir)
        if (stats.isDirectory()) {
          fs.rmSync(targetFileOrDir, { recursive: true, force: true })
        } else {
          fs.unlinkSync(targetFileOrDir)
        }
        return { success: true }
      } catch (e: any) {
        return { success: false, error: e?.message }
      }
    }

    // Check core dir
    if (isCore === undefined || isCore === true) {
      const corePath = path.join(this.getCoreDir(), `${safeName}.md`)
      const coreDirFolder = path.join(this.getCoreDir(), safeName)
      if (fs.existsSync(corePath)) {
        try {
          fs.unlinkSync(corePath)
          deleted = true
        } catch {}
      }
      if (fs.existsSync(coreDirFolder)) {
        try {
          fs.rmSync(coreDirFolder, { recursive: true, force: true })
          deleted = true
        } catch {}
      }
    }

    // Check extra dir
    if (isCore === undefined || isCore === false) {
      const extraPath = path.join(this.getExtraDir(), `${safeName}.md`)
      const extraDirFolder = path.join(this.getExtraDir(), safeName)
      if (fs.existsSync(extraPath)) {
        try {
          fs.unlinkSync(extraPath)
          deleted = true
        } catch {}
      }
      if (fs.existsSync(extraDirFolder)) {
        try {
          fs.rmSync(extraDirFolder, { recursive: true, force: true })
          deleted = true
        } catch {}
      }
    }

    return { success: deleted, error: deleted ? undefined : `Навык '${name}' не найден` }
  }

  /**
   * Toggle a skill between Core (always loaded) and Extra (on-demand)
   */
  static toggleSkillType(name: string, sourcePath?: string): { success: boolean; newIsCore?: boolean; error?: string } {
    this.init()
    const safeName = this.sanitizeSkillName(name)

    let resolvedPath = sourcePath
    if (!resolvedPath) {
      const all = this.getAllSkills()
      const found = all.find(
        (s) => s.name.toLowerCase() === name.toLowerCase() || this.sanitizeSkillName(s.name) === safeName
      )
      if (found && found.filePath) {
        resolvedPath = found.filePath
      }
    }

    const corePath = path.join(this.getCoreDir(), `${safeName}.md`)
    const extraPath = path.join(this.getExtraDir(), `${safeName}.md`)
    const coreFolder = path.join(this.getCoreDir(), safeName)
    const extraFolder = path.join(this.getExtraDir(), safeName)

    try {
      // 1. Direct path resolution if file is in a category subfolder or core
      if (resolvedPath && fs.existsSync(resolvedPath)) {
        const stats = fs.statSync(resolvedPath)
        const isCurrentlyInCore = resolvedPath.replace(/\\/g, '/').includes('/skills/core')

        if (isCurrentlyInCore) {
          // Move from Core to Extra (custom subfolder)
          const targetExtraDir = path.join(this.getExtraDir(), 'custom')
          if (!fs.existsSync(targetExtraDir)) fs.mkdirSync(targetExtraDir, { recursive: true })

          if (stats.isDirectory()) {
            const dest = path.join(targetExtraDir, safeName)
            fs.cpSync(resolvedPath, dest, { recursive: true })
            fs.rmSync(resolvedPath, { recursive: true, force: true })
          } else {
            const dest = path.join(targetExtraDir, `${safeName}.md`)
            fs.copyFileSync(resolvedPath, dest)
            fs.unlinkSync(resolvedPath)
          }
          return { success: true, newIsCore: false }
        } else if (resolvedPath.replace(/\\/g, '/').includes('/skills/extra')) {
          // Move from Extra to Core
          const targetCoreDir = this.getCoreDir()
          if (stats.isDirectory()) {
            const dest = path.join(targetCoreDir, safeName)
            fs.cpSync(resolvedPath, dest, { recursive: true })
            fs.rmSync(resolvedPath, { recursive: true, force: true })
          } else {
            const dest = path.join(targetCoreDir, `${safeName}.md`)
            fs.copyFileSync(resolvedPath, dest)
            fs.unlinkSync(resolvedPath)
          }
          return { success: true, newIsCore: true }
        }
      }

      // 1. Single file in Core -> Move to Extra
      if (fs.existsSync(corePath)) {
        const content = fs.readFileSync(corePath, 'utf-8')
        fs.writeFileSync(extraPath, content, 'utf-8')
        fs.unlinkSync(corePath)
        return { success: true, newIsCore: false }
      }
      // 2. Single file in Extra -> Move to Core
      if (fs.existsSync(extraPath)) {
        const content = fs.readFileSync(extraPath, 'utf-8')
        fs.writeFileSync(corePath, content, 'utf-8')
        fs.unlinkSync(extraPath)
        return { success: true, newIsCore: true }
      }
      // 3. Folder in Core -> Move to Extra
      if (fs.existsSync(coreFolder)) {
        fs.cpSync(coreFolder, extraFolder, { recursive: true })
        fs.rmSync(coreFolder, { recursive: true, force: true })
        return { success: true, newIsCore: false }
      }
      // 4. Folder in Extra -> Move to Core
      if (fs.existsSync(extraFolder)) {
        fs.cpSync(extraFolder, coreFolder, { recursive: true })
        fs.rmSync(extraFolder, { recursive: true, force: true })
        return { success: true, newIsCore: true }
      }

      // 5. If sourcePath provided (e.g. from workspace or cursor), toggle frontmatter isCore
      if (sourcePath && fs.existsSync(sourcePath)) {
        const stats = fs.statSync(sourcePath)
        const targetFile = stats.isDirectory() ? path.join(sourcePath, 'SKILL.md') : sourcePath
        if (fs.existsSync(targetFile)) {
          const raw = fs.readFileSync(targetFile, 'utf-8')
          const { metadata, body } = this.parseRawContent(raw)
          const newCore = !(metadata.isCore || metadata.alwaysApply)
          metadata.isCore = newCore
          delete metadata.alwaysApply

          const yamlBlock = Object.entries(metadata)
            .map(([k, v]) => `${k}: ${typeof v === 'object' ? JSON.stringify(v) : v}`)
            .join('\n')
          const newContent = `---\n${yamlBlock}\n---\n\n${body}`
          fs.writeFileSync(targetFile, newContent, 'utf-8')
          return { success: true, newIsCore: newCore }
        }
      }

      return { success: false, error: `Навык '${name}' не найден` }
    } catch (err: any) {
      console.error('[SkillService] Failed to toggle skill type:', err)
      return { success: false, error: err?.message || 'Не удалось переместить навык' }
    }
  }

  /**
   * Import a skill from a local file or directory
   */
  static importSkillFromPath(
    srcPath: string,
    isCore: boolean = false
  ): { success: boolean; skill?: SkillItem; count?: number; error?: string } {
    this.init()
    try {
      if (!fs.existsSync(srcPath)) {
        return { success: false, error: `Путь не существует: ${srcPath}` }
      }

      const stats = fs.statSync(srcPath)
      const targetDir = isCore ? this.getCoreDir() : this.getExtraDir()

      // Case A: A single markdown / mdc / rules file
      if (stats.isFile()) {
        const ext = path.extname(srcPath).toLowerCase()
        const baseName = path.basename(srcPath, ext)
        const safeName = this.sanitizeSkillName(baseName)
        const targetPath = path.join(targetDir, `${safeName}.md`)

        const rawContent = fs.readFileSync(srcPath, 'utf-8')
        const { metadata, body } = this.parseRawContent(rawContent)

        metadata.name = metadata.name || safeName
        metadata.description = metadata.description || `Импортированный навык ${safeName}`

        const frontmatterLines = ['---', `name: ${metadata.name}`, `description: ${metadata.description}`]
        if (metadata.globs && metadata.globs.length > 0) frontmatterLines.push(`globs: ${JSON.stringify(metadata.globs)}`)
        if (metadata.triggers && metadata.triggers.length > 0) frontmatterLines.push(`triggers: ${JSON.stringify(metadata.triggers)}`)
        if (metadata.tags && metadata.tags.length > 0) frontmatterLines.push(`tags: ${JSON.stringify(metadata.tags)}`)
        frontmatterLines.push('---', '', body || rawContent)

        fs.writeFileSync(targetPath, frontmatterLines.join('\n'), 'utf-8')

        const parsed = this._parseSkillPath(targetPath, isCore, 'global')
        return { success: true, skill: parsed || undefined, count: 1 }
      }

      // Case B: A Directory
      if (stats.isDirectory()) {
        // Subcase B1: The directory is itself a single skill (has SKILL.md or README.md)
        const hasSkillMd =
          fs.existsSync(path.join(srcPath, 'SKILL.md')) ||
          fs.existsSync(path.join(srcPath, 'skill.md')) ||
          fs.existsSync(path.join(srcPath, 'README.md'))

        if (hasSkillMd) {
          const dirName = path.basename(srcPath)
          const safeName = this.sanitizeSkillName(dirName)
          const targetSkillDir = path.join(targetDir, safeName)

          // Copy entire skill folder with scripts and resources
          fs.cpSync(srcPath, targetSkillDir, { recursive: true })
          const parsed = this._parseSkillPath(targetSkillDir, isCore, 'global')
          return { success: true, skill: parsed || undefined, count: 1 }
        }

        // Subcase B2: The directory is a collection of skills (e.g. folder with multiple .md or skill folders)
        const entries = fs.readdirSync(srcPath, { withFileTypes: true })
        let importedCount = 0

        for (const entry of entries) {
          if (entry.name.startsWith('.')) continue
          const fullEntryPath = path.join(srcPath, entry.name)

          if (entry.isDirectory()) {
            const subSkillMd =
              fs.existsSync(path.join(fullEntryPath, 'SKILL.md')) ||
              fs.existsSync(path.join(fullEntryPath, 'skill.md'))
            if (subSkillMd) {
              const safeSubName = this.sanitizeSkillName(entry.name)
              fs.cpSync(fullEntryPath, path.join(targetDir, safeSubName), { recursive: true })
              importedCount++
            }
          } else if (entry.isFile() && (entry.name.endsWith('.md') || entry.name.endsWith('.mdc'))) {
            const safeName = this.sanitizeSkillName(path.basename(entry.name, path.extname(entry.name)))
            const targetPath = path.join(targetDir, `${safeName}.md`)
            fs.copyFileSync(fullEntryPath, targetPath)
            importedCount++
          }
        }

        if (importedCount > 0) {
          return { success: true, count: importedCount }
        }

        return { success: false, error: 'В выбранной папке не найдено файлов навыков (.md, .mdc или SKILL.md)' }
      }

      return { success: false, error: 'Неподдерживаемый тип объекта' }
    } catch (err: any) {
      console.error('[SkillService] Import from path failed:', err)
      return { success: false, error: err?.message || 'Ошибка импорта файла/папки' }
    }
  }

  /**
   * Import skill from URL or GitHub repository (e.g. heygen-com/hyperframes or https://github.com/...)
   */
  static async importSkillFromUrl(
    urlStr: string,
    isCore: boolean = false
  ): Promise<{ success: boolean; skill?: SkillItem; error?: string }> {
    this.init()
    try {
      let rawInput = urlStr.trim()
      let candidateUrls: string[] = []

      // If user typed owner/repo (e.g. heygen-com/hyperframes)
      if (/^[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+$/.test(rawInput)) {
        candidateUrls.push(
          `https://raw.githubusercontent.com/${rawInput}/main/SKILL.md`,
          `https://raw.githubusercontent.com/${rawInput}/master/SKILL.md`,
          `https://raw.githubusercontent.com/${rawInput}/main/README.md`,
          `https://raw.githubusercontent.com/${rawInput}/master/README.md`
        )
      } else if (rawInput.includes('github.com')) {
        if (rawInput.includes('/blob/')) {
          candidateUrls.push(
            rawInput.replace('github.com', 'raw.githubusercontent.com').replace('/blob/', '/')
          )
        } else {
          // GitHub repository root e.g. https://github.com/owner/repo
          const match = rawInput.match(/github\.com\/([^\/]+)\/([^\/]+)/)
          if (match) {
            const owner = match[1]
            const repo = match[2].replace(/\.git$/, '')
            candidateUrls.push(
              `https://raw.githubusercontent.com/${owner}/${repo}/main/SKILL.md`,
              `https://raw.githubusercontent.com/${owner}/${repo}/master/SKILL.md`,
              `https://raw.githubusercontent.com/${owner}/${repo}/main/README.md`,
              `https://raw.githubusercontent.com/${owner}/${repo}/master/README.md`
            )
          } else {
            candidateUrls.push(rawInput)
          }
        }
      } else {
        candidateUrls.push(rawInput)
      }

      let fetchedContent = ''
      let successfulUrl = ''

      for (const candidate of candidateUrls) {
        try {
          const resp = await fetch(candidate, {
            headers: { 'User-Agent': 'zipply-Skills-Installer/1.0' }
          })
          if (resp.ok) {
            const text = await resp.text()
            if (text && text.length >= 10) {
              fetchedContent = text
              successfulUrl = candidate
              break
            }
          }
        } catch {}
      }

      if (!fetchedContent) {
        return {
          success: false,
          error: `Не удалось загрузить навык из '${rawInput}'. Проверьте адрес или наличие SKILL.md/README.md в репозитории.`
        }
      }

      const { metadata, body } = this.parseRawContent(fetchedContent)
      let skillName = metadata.name

      if (!skillName) {
        try {
          const u = new URL(successfulUrl)
          const segments = u.pathname.split('/').filter(Boolean)
          if (segments.length >= 2) {
            skillName = segments[1] // repo name
          } else {
            skillName = path.basename(u.pathname, path.extname(u.pathname))
          }
        } catch {}
      }

      skillName = this.sanitizeSkillName(skillName || 'imported-skill')
      const targetDir = isCore ? this.getCoreDir() : this.getExtraDir()
      const targetPath = path.join(targetDir, `${skillName}.md`)

      const desc = metadata.description || `Импортирован из ${rawInput}`
      const frontmatterLines = ['---', `name: ${skillName}`, `description: ${desc}`]
      if (metadata.globs && metadata.globs.length > 0) frontmatterLines.push(`globs: ${JSON.stringify(metadata.globs)}`)
      if (metadata.triggers && metadata.triggers.length > 0) frontmatterLines.push(`triggers: ${JSON.stringify(metadata.triggers)}`)
      if (metadata.tags && metadata.tags.length > 0) frontmatterLines.push(`tags: ${JSON.stringify(metadata.tags)}`)
      frontmatterLines.push('---', '', body || fetchedContent)

      fs.writeFileSync(targetPath, frontmatterLines.join('\n'), 'utf-8')

      const parsed = this._parseSkillPath(targetPath, isCore, 'global')
      return { success: true, skill: parsed || undefined }
    } catch (err: any) {
      console.error('[SkillService] Import from URL failed:', err)
      return { success: false, error: err?.message || 'Не удалось загрузить навык по ссылке' }
    }
  }

  /**
   * Open the skills directory in OS file manager (Windows Explorer / Finder)
   */
  static openSkillsFolder(): { success: boolean; path: string; error?: string } {
    try {
      this.init()
      const dir = this.getSkillsDir()
      shell.openPath(dir)
      return { success: true, path: dir }
    } catch (err: any) {
      return { success: false, path: '', error: err?.message || 'Не удалось открыть папку' }
    }
  }

  /**
   * Auto-discover and sync skills from standard external tools (~/.skills, ~/.codex/skills, ~/.cursor/rules)
   */
  static syncFromExternalLocations(): { success: boolean; importedCount: number; skills: SkillItem[]; error?: string } {
    this.init()
    try {
      const homeDir = os.homedir()
      let count = 0

      // Sync from ~/.skills
      const userSkills = path.join(homeDir, '.skills')
      if (fs.existsSync(userSkills)) {
        const res = this.importSkillFromPath(userSkills, false)
        if (res.success && res.count) count += res.count
      }

      // Sync from ~/.codex/skills
      const userCodex = path.join(homeDir, '.codex', 'skills')
      if (fs.existsSync(userCodex)) {
        const res = this.importSkillFromPath(userCodex, false)
        if (res.success && res.count) count += res.count
      }

      // Sync from ~/.cursor/rules
      const userCursor = path.join(homeDir, '.cursor', 'rules')
      if (fs.existsSync(userCursor)) {
        const res = this.importSkillFromPath(userCursor, false)
        if (res.success && res.count) count += res.count
      }

      const all = this.getAllSkills()
      return { success: true, importedCount: count, skills: all }
    } catch (err: any) {
      return { success: false, importedCount: 0, skills: [], error: err?.message || 'Ошибка синхронизации' }
    }
  }
}

