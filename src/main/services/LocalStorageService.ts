import fs from 'fs'
import path from 'path'
import { app, shell } from 'electron'

export type StoreName = 'config' | 'appearance' | 'chats' | 'projects' | 'kv_store'

export interface SystemPathsInfo {
  platform: 'win32' | 'darwin' | 'linux' | string
  homeDir: string
  userDataDir: string
  storageDir: string
  defaultProjectsDir: string
}

export interface StorageMetrics {
  chatsCount: number
  projectsCount: number
  hasAiConfig: boolean
  hasAppearance: boolean
  storageSizeBytes: number
  lastUpdated: string
}

export interface BackupArchive {
  version: string
  exportedAt: string
  platform: string
  stores: Record<string, any>
  memories?: any
  persona?: any
  sessions?: any
  skills?: any
}

export class LocalStorageService {
  private static _storageDir: string | null = null
  private static _memoryCache: Map<string, any> = new Map()
  private static _debounceTimers: Map<string, NodeJS.Timeout> = new Map()

  /**
   * Initialize storage directory, migrate legacy data if detected, and ensure app consistency.
   */
  static init(): void {
    try {
      const dir = this.getStorageDir()
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true })
      }

      // Ensure default projects directory exists
      const defaultProj = this.getDefaultProjectsDir()
      if (!fs.existsSync(defaultProj)) {
        fs.mkdirSync(defaultProj, { recursive: true })
      }

      // Automatically migrate all legacy data from ClickCoder / clickcode namespaces
      this.migrateFromLegacy()
    } catch (err) {
      console.error('[LocalStorageService] Init error:', err)
    }
  }

  /**
   * Automatically detect and migrate all legacy data from Zipple / ClickCoder / clickcode / click directories.
   */
  static migrateFromLegacy(): void {
    try {
      const currentUserData = app ? app.getPath('userData') : ''
      if (!currentUserData) return

      const appDataParent = app ? app.getPath('appData') : (process.env.APPDATA || path.join(process.env.HOME || '', '.config'))
      const legacyFolderNames = ['zipple', 'Zipple', 'ClickCoder', 'clickcoder', 'ClickCode', 'clickcode', 'Click', 'click']

      const legacyDirs: string[] = []
      if (appDataParent && fs.existsSync(appDataParent)) {
        for (const name of legacyFolderNames) {
          const candidate = path.join(appDataParent, name)
          if (fs.existsSync(candidate) && path.normalize(candidate).toLowerCase() !== path.normalize(currentUserData).toLowerCase()) {
            legacyDirs.push(candidate)
          }
        }
      }

      // Add current userData folder and cwd as search origins for legacy filenames
      legacyDirs.push(currentUserData)
      if (process.cwd() && !legacyDirs.includes(process.cwd())) {
        legacyDirs.push(process.cwd())
      }

      const copyIfNotExists = (src: string, dest: string) => {
        try {
          if (fs.existsSync(src) && !fs.existsSync(dest)) {
            const destDir = path.dirname(dest)
            if (!fs.existsSync(destDir)) fs.mkdirSync(destDir, { recursive: true })
            fs.copyFileSync(src, dest)
            console.log(`[LocalStorageService] Migrated ${src} -> ${dest}`)
          }
        } catch (err) {
          console.warn(`[LocalStorageService] Migration copy error (${src} -> ${dest}):`, err)
        }
      }

      const copyDirRecursiveIfNotExists = (srcDir: string, destDir: string) => {
        try {
          if (!fs.existsSync(srcDir)) return
          if (!fs.existsSync(destDir)) fs.mkdirSync(destDir, { recursive: true })
          for (const item of fs.readdirSync(srcDir, { withFileTypes: true })) {
            const srcPath = path.join(srcDir, item.name)
            const destPath = path.join(destDir, item.name)
            if (item.isDirectory()) {
              copyDirRecursiveIfNotExists(srcPath, destPath)
            } else if (item.isFile() && !fs.existsSync(destPath)) {
              fs.copyFileSync(srcPath, destPath)
              console.log(`[LocalStorageService] Migrated item ${srcPath} -> ${destPath}`)
            }
          }
        } catch (err) {
          console.warn(`[LocalStorageService] Migration dir error (${srcDir} -> ${destDir}):`, err)
        }
      }

      const targetStorageDir = this.getStorageDir()
      const targetSkillsDir = path.join(currentUserData, 'skills')

      for (const legDir of legacyDirs) {
        // 1. Storage json stores (config.json, appearance.json, chats.json, projects.json, kv_store.json)
        const legStorage = path.join(legDir, 'storage')
        if (fs.existsSync(legStorage)) {
          const storeNames = ['config.json', 'appearance.json', 'chats.json', 'projects.json', 'kv_store.json']
          for (const sName of storeNames) {
            copyIfNotExists(path.join(legStorage, sName), path.join(targetStorageDir, sName))
          }
        }

        // 2. State JSON files (memory, persona, sessions, schedules)
        const memoryAliases = ['zipple-memory.json', 'clickcoder-memory.json', 'clickcode-memory.json', 'click-memory.json']
        for (const alias of memoryAliases) {
          copyIfNotExists(path.join(legDir, alias), path.join(currentUserData, 'zipply-memory.json'))
        }

        const personaAliases = ['zipple-persona.json', 'clickcoder-persona.json', 'clickcode-persona.json', 'click-persona.json']
        for (const alias of personaAliases) {
          copyIfNotExists(path.join(legDir, alias), path.join(currentUserData, 'zipply-persona.json'))
        }

        const sessionAliases = ['zipple-sessions.json', 'clickcoder-sessions.json', 'clickcode-sessions.json', 'click-sessions.json']
        for (const alias of sessionAliases) {
          copyIfNotExists(path.join(legDir, alias), path.join(currentUserData, 'zipply-sessions.json'))
        }

        const scheduleAliases = ['zipple-schedules.json', 'clickcoder-schedules.json', 'clickcode-schedules.json', 'click-schedules.json']
        for (const alias of scheduleAliases) {
          copyIfNotExists(path.join(legDir, alias), path.join(currentUserData, 'zipply-schedules.json'))
        }

        // 3. Skills folder
        const legSkills = path.join(legDir, 'skills')
        if (fs.existsSync(legSkills)) {
          copyDirRecursiveIfNotExists(legSkills, targetSkillsDir)
        }
      }
    } catch (e) {
      console.warn('[LocalStorageService] Legacy migration error:', e)
    }
  }

  /**
   * Root directory for all zipply persistent stores.
   * - Windows: %APPDATA%\zipply\storage
   * - Linux: ~/.config/zipply/storage
   * - macOS: ~/Library/Application Support/zipply/storage
   */
  static getStorageDir(): string {
    if (!this._storageDir) {
      const baseDir = app ? app.getPath('userData') : (process.env.APPDATA || process.env.HOME || process.cwd())
      this._storageDir = path.join(baseDir, 'storage')
    }
    return this._storageDir
  }

  /**
   * Returns OS-appropriate default project directory.
   */
  static getDefaultProjectsDir(): string {
    const isWin = process.platform === 'win32'
    const home = app ? app.getPath('home') : (process.env.USERPROFILE || process.env.HOME || 'd:/')

    if (isWin) {
      // If D:\ drive exists on Windows, check for D:/zipplyprojects, D:/zippleprojects, etc.
      try {
        if (fs.existsSync('D:/') || fs.existsSync('d:/')) {
          if (fs.existsSync('d:/zipplyprojects')) return path.normalize('d:/zipplyprojects')
          if (fs.existsSync('d:/ZipplyProjects')) return path.normalize('d:/ZipplyProjects')
          if (fs.existsSync('d:/zippleprojects')) return path.normalize('d:/zippleprojects')
          if (fs.existsSync('d:/ZippleProjects')) return path.normalize('d:/ZippleProjects')
          if (fs.existsSync('d:/clickprojects')) return path.normalize('d:/clickprojects')
          if (fs.existsSync('d:/ClickProjects')) return path.normalize('d:/ClickProjects')
          return path.normalize('d:/zipplyprojects')
        }
      } catch {}
      return path.join(home, 'ZipplyProjects')
    }

    // Linux and macOS: ~/ZipplyProjects
    return path.join(home, 'ZipplyProjects')
  }

  /**
   * Returns complete system and path information.
   */
  static getSystemPathsInfo(): SystemPathsInfo {
    const home = app ? app.getPath('home') : (process.env.HOME || process.env.USERPROFILE || '')
    const userData = app ? app.getPath('userData') : (process.env.APPDATA || '')
    return {
      platform: process.platform,
      homeDir: home,
      userDataDir: userData,
      storageDir: this.getStorageDir(),
      defaultProjectsDir: this.getDefaultProjectsDir()
    }
  }

  private static _getStoreFilePath(storeName: StoreName | string): string {
    const safeName = storeName.replace(/[^a-zA-Z0-9_-]/g, '_')
    return path.join(this.getStorageDir(), `${safeName}.json`)
  }

  /**
   * Atomic file write algorithm:
   * 1. Write content to `<file>.tmp`
   * 2. Flush file descriptor buffer (`fsync`)
   * 3. If original file exists, create a safety `<file>.bak`
   * 4. Atomically rename `<file>.tmp` to `<file>`
   */
  private static _atomicWriteSync(filePath: string, content: string): void {
    const dir = path.dirname(filePath)
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true })
    }

    const tmpPath = `${filePath}.tmp.${Date.now()}.${Math.random().toString(36).slice(2, 6)}`
    const bakPath = `${filePath}.bak`

    // 1. Write to tmp file with sync
    const fd = fs.openSync(tmpPath, 'w')
    fs.writeSync(fd, content, 0, 'utf8')
    fs.fsyncSync(fd)
    fs.closeSync(fd)

    // 2. Backup existing file
    try {
      if (fs.existsSync(filePath)) {
        fs.copyFileSync(filePath, bakPath)
      }
    } catch {}

    // 3. Rename tmp to target
    try {
      if (process.platform === 'win32' && fs.existsSync(filePath)) {
        try {
          fs.unlinkSync(filePath)
        } catch {}
      }
      fs.renameSync(tmpPath, filePath)
    } catch (err) {
      // Fallback copy if rename fails across partitions
      fs.copyFileSync(tmpPath, filePath)
      try {
        fs.unlinkSync(tmpPath)
      } catch {}
    }
  }

  /**
   * Read store from file with automatic .bak recovery on corrupted JSON.
   */
  static getStore<T = any>(storeName: StoreName | string, defaultValue: T | null = null): T {
    if (this._memoryCache.has(storeName)) {
      return this._memoryCache.get(storeName) as T
    }

    const filePath = this._getStoreFilePath(storeName)
    const bakPath = `${filePath}.bak`

    // 1. Try reading primary file
    if (fs.existsSync(filePath)) {
      try {
        const raw = fs.readFileSync(filePath, 'utf8')
        if (raw.trim()) {
          const parsed = JSON.parse(raw)
          this._memoryCache.set(storeName, parsed)
          return parsed as T
        }
      } catch (err) {
        console.warn(`[LocalStorageService] Corrupted store file '${storeName}', attempting .bak recovery...`, err)
      }
    }

    // 2. Try recovering from .bak file
    if (fs.existsSync(bakPath)) {
      try {
        const rawBak = fs.readFileSync(bakPath, 'utf8')
        if (rawBak.trim()) {
          const parsedBak = JSON.parse(rawBak)
          this._memoryCache.set(storeName, parsedBak)
          // Restore primary file from valid backup
          this._atomicWriteSync(filePath, rawBak)
          console.log(`[LocalStorageService] Successfully recovered store '${storeName}' from .bak`)
          return parsedBak as T
        }
      } catch (errBak) {
        console.error(`[LocalStorageService] Failed to recover store '${storeName}' from .bak:`, errBak)
      }
    }

    const fallback = defaultValue !== null ? defaultValue : ({} as unknown as T)
    this._memoryCache.set(storeName, fallback)
    return fallback
  }

  /**
   * Save store data (synchronous or debounced).
   */
  static setStore<T = any>(storeName: StoreName | string, data: T, debounceMs = 0): void {
    this._memoryCache.set(storeName, data)

    const doWrite = (): void => {
      try {
        const filePath = this._getStoreFilePath(storeName)
        const jsonStr = JSON.stringify(data, null, 2)
        this._atomicWriteSync(filePath, jsonStr)
      } catch (err) {
        console.error(`[LocalStorageService] Failed to write store '${storeName}':`, err)
      }
    }

    if (debounceMs > 0) {
      if (this._debounceTimers.has(storeName)) {
        clearTimeout(this._debounceTimers.get(storeName)!)
      }
      const timer = setTimeout(() => {
        this._debounceTimers.delete(storeName)
        doWrite()
      }, debounceMs)
      this._debounceTimers.set(storeName, timer)
    } else {
      doWrite()
    }
  }

  /**
   * Key-value generic store operations.
   */
  static getItem<T = any>(key: string, defaultValue: T | null = null): T {
    const kv = this.getStore<Record<string, any>>('kv_store', {})
    return (kv[key] !== undefined ? kv[key] : defaultValue) as T
  }

  static setItem(key: string, value: any): void {
    const kv = this.getStore<Record<string, any>>('kv_store', {})
    kv[key] = value
    this.setStore('kv_store', kv)
  }

  static removeItem(key: string): void {
    const kv = this.getStore<Record<string, any>>('kv_store', {})
    delete kv[key]
    this.setStore('kv_store', kv)
  }

  /**
   * Open the storage folder in the OS file explorer (Windows Explorer, macOS Finder, Linux Nautilus/Dolphin).
   */
  static async openStorageFolder(): Promise<{ success: boolean; path: string; error?: string }> {
    const folder = this.getStorageDir()
    try {
      if (!fs.existsSync(folder)) {
        fs.mkdirSync(folder, { recursive: true })
      }
      await shell.openPath(folder)
      return { success: true, path: folder }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      return { success: false, path: folder, error: msg }
    }
  }

  /**
   * Get storage statistics and metrics.
   */
  static getMetrics(): StorageMetrics {
    const dir = this.getStorageDir()
    let totalSize = 0

    try {
      if (fs.existsSync(dir)) {
        const files = fs.readdirSync(dir)
        for (const file of files) {
          const stat = fs.statSync(path.join(dir, file))
          if (stat.isFile()) totalSize += stat.size
        }
      }
    } catch {}

    const chats = this.getStore<any[]>('chats', [])
    const projects = this.getStore<any[]>('projects', [])
    const config = this.getStore<any>('config', null)
    const appearance = this.getStore<any>('appearance', null)

    return {
      chatsCount: Array.isArray(chats) ? chats.length : 0,
      projectsCount: Array.isArray(projects) ? projects.length : 0,
      hasAiConfig: Boolean(config && (config.apiKey || config.connectedProviders?.length)),
      hasAppearance: Boolean(appearance && appearance.theme),
      storageSizeBytes: totalSize,
      lastUpdated: new Date().toISOString()
    }
  }

  /**
   * Export a complete backup archive of all zipple data.
   */
  static exportBackupArchive(): BackupArchive {
    const storeFiles = ['config', 'appearance', 'chats', 'projects', 'kv_store']
    const stores: Record<string, any> = {}

    for (const name of storeFiles) {
      stores[name] = this.getStore(name, null)
    }

    const userDataDir = app ? app.getPath('userData') : ''
    let memories: any = null
    let persona: any = null
    let sessions: any = null
    const skills: Record<string, string> = {}

    // Read memories file if exists
    try {
      const memAliases = ['zipply-memory.json', 'zipple-memory.json', 'clickcoder-memory.json', 'clickcode-memory.json', 'click-memory.json']
      for (const alias of memAliases) {
        const memPath = path.join(userDataDir, alias)
        if (fs.existsSync(memPath)) {
          memories = JSON.parse(fs.readFileSync(memPath, 'utf8'))
          break
        }
      }
    } catch {}

    // Read persona file if exists
    try {
      const personaAliases = ['zipply-persona.json', 'zipple-persona.json', 'clickcoder-persona.json', 'clickcode-persona.json', 'click-persona.json']
      for (const alias of personaAliases) {
        const personaPath = path.join(userDataDir, alias)
        if (fs.existsSync(personaPath)) {
          persona = JSON.parse(fs.readFileSync(personaPath, 'utf8'))
          break
        }
      }
    } catch {}

    // Read sessions file if exists
    try {
      const sessAliases = ['zipply-sessions.json', 'zipple-sessions.json', 'clickcoder-sessions.json', 'clickcode-sessions.json', 'click-sessions.json']
      for (const alias of sessAliases) {
        const sessPath = path.join(userDataDir, alias)
        if (fs.existsSync(sessPath)) {
          sessions = JSON.parse(fs.readFileSync(sessPath, 'utf8'))
          break
        }
      }
    } catch {}

    // Read skills files if exists
    try {
      const skillsDir = path.join(userDataDir, 'skills')
      if (fs.existsSync(skillsDir)) {
        const readDirSkills = (sub: string) => {
          const subDir = path.join(skillsDir, sub)
          if (fs.existsSync(subDir)) {
            for (const f of fs.readdirSync(subDir).filter((x) => x.endsWith('.md'))) {
              skills[`${sub}/${f}`] = fs.readFileSync(path.join(subDir, f), 'utf8')
            }
          }
        }
        readDirSkills('core')
        readDirSkills('extra')
      }
    } catch {}

    return {
      version: '1.0.0',
      exportedAt: new Date().toISOString(),
      platform: process.platform,
      stores,
      memories,
      persona,
      sessions,
      skills
    }
  }

  /**
   * Import a backup archive and safely restore all data.
   */
  static importBackupArchive(archive: BackupArchive): { success: boolean; details: string; error?: string } {
    if (!archive || typeof archive !== 'object' || !archive.stores) {
      return { success: false, details: '', error: 'Некорректный формат файла резервной копии.' }
    }

    try {
      const userDataDir = app ? app.getPath('userData') : ''
      let restoredCount = 0

      // 1. Restore stores
      for (const [storeName, data] of Object.entries(archive.stores)) {
        if (data !== undefined && data !== null) {
          this.setStore(storeName, data, 0)
          restoredCount++
        }
      }

      // 2. Restore memories
      if (archive.memories) {
        const memPath = path.join(userDataDir, 'zipply-memory.json')
        this._atomicWriteSync(memPath, JSON.stringify(archive.memories, null, 2))
        restoredCount++
      }

      // 3. Restore persona
      if (archive.persona) {
        const personaPath = path.join(userDataDir, 'zipply-persona.json')
        this._atomicWriteSync(personaPath, JSON.stringify(archive.persona, null, 2))
        restoredCount++
      }

      // 4. Restore session summaries
      if (archive.sessions) {
        const sessPath = path.join(userDataDir, 'zipply-sessions.json')
        this._atomicWriteSync(sessPath, JSON.stringify(archive.sessions, null, 2))
        restoredCount++
      }

      // 5. Restore skills
      if (archive.skills && typeof archive.skills === 'object') {
        const skillsDir = path.join(userDataDir, 'skills')
        for (const [relPath, content] of Object.entries(archive.skills)) {
          if (typeof content === 'string') {
            const target = path.join(skillsDir, relPath)
            const d = path.dirname(target)
            if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true })
            fs.writeFileSync(target, content, 'utf8')
            restoredCount++
          }
        }
      }

      return {
        success: true,
        details: `Успешно восстановлено ${restoredCount} компонентов данных из архива от ${new Date(archive.exportedAt || Date.now()).toLocaleString()}`
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      return { success: false, details: '', error: `Ошибка при восстановлении: ${msg}` }
    }
  }
}
