import * as fs from 'fs'
import * as path from 'path'
import { randomUUID } from 'crypto'
import { builtInPluginIds, getPluginToolIds } from './BuiltInPlugins'

interface PluginState {
  installed: string[]
  loadedBySession: Record<string, string[]>
}

/** Only bundled, trusted packages are supported. State is owned by the main process. */
export class PluginManager {
  private readonly file: string
  private state: PluginState | null = null
  constructor(userData: string) { this.file = path.join(userData, 'plugins.json') }

  private normalizeIds(value: unknown, valid: readonly string[]): string[] {
    if (!Array.isArray(value)) return []
    const known = new Set(valid)
    return [...new Set(value.filter((id): id is string => typeof id === 'string').map(id => id === 'sentinel' ? 'cybersec' : id).filter(id => known.has(id)))]
  }

  private normalizeState(value: unknown): PluginState {
    const raw = value && typeof value === 'object' ? value as { installed?: unknown; loadedBySession?: unknown } : {}
    const installed = this.normalizeIds(raw.installed, builtInPluginIds)
    const loadedBySession: Record<string, string[]> = {}
    if (raw.loadedBySession && typeof raw.loadedBySession === 'object' && !Array.isArray(raw.loadedBySession)) {
      for (const [sessionId, ids] of Object.entries(raw.loadedBySession)) {
        if (!/^[a-zA-Z0-9_-]{1,200}$/.test(sessionId)) continue
        loadedBySession[sessionId] = this.normalizeIds(ids, installed.flatMap(pluginId => getPluginToolIds(pluginId)))
      }
    }
    return { installed, loadedBySession }
  }

  private load(legacy?: unknown): PluginState {
    if (this.state) return this.state
    try {
      const data: unknown = JSON.parse(fs.readFileSync(this.file, 'utf8'))
      if (!data || typeof data !== 'object' || !Array.isArray((data as { installed?: unknown }).installed)) throw new Error('Некорректный файл состояния плагинов.')
      this.state = this.normalizeState(data)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      if (legacy === undefined) return { installed: [], loadedBySession: {} }
      const migrated = this.normalizeState({ installed: legacy })
      this.save(migrated)
      this.state = migrated
    }
    return this.state
  }

  private save(state: PluginState): void {
    fs.mkdirSync(path.dirname(this.file), { recursive: true })
    const tmp = `${this.file}.${randomUUID()}.tmp`
    try {
      fs.writeFileSync(tmp, JSON.stringify({ version: 2, ...state }), { encoding: 'utf8', flag: 'wx' })
      fs.renameSync(tmp, this.file)
    } finally { try { fs.unlinkSync(tmp) } catch {} }
  }

  private commit(state: PluginState): void {
    this.save(state)
    this.state = state
  }

  list(legacy?: unknown): string[] { return [...this.load(legacy).installed] }

  setInstalled(id: unknown, installed: unknown): string[] {
    if (typeof id !== 'string' || !builtInPluginIds.includes(id) || typeof installed !== 'boolean') throw new Error('Неизвестный плагин или действие.')
    const state = this.load()
    const nextInstalled = installed ? [...new Set([...state.installed, id])] : state.installed.filter(item => item !== id)
    const loadedBySession = Object.fromEntries(Object.entries(state.loadedBySession).map(([sessionId, tools]) => [sessionId, installed ? tools : tools.filter(toolId => !getPluginToolIds(id).includes(toolId))]))
    this.commit({ installed: nextInstalled, loadedBySession })
    return [...nextInstalled]
  }

  getLoadedToolIds(sessionId: string): string[] {
    if (!/^[a-zA-Z0-9_-]{1,200}$/.test(sessionId)) return []
    const state = this.load()
    const installedToolIds = state.installed.flatMap(pluginId => getPluginToolIds(pluginId))
    const valid = new Set(installedToolIds)
    const loaded = this.normalizeIds(state.loadedBySession[sessionId], installedToolIds).filter(toolId => valid.has(toolId))
    return [...loaded]
  }

  loadTool(sessionId: string, pluginId: unknown, toolId: unknown): string[] {
    if (!/^[a-zA-Z0-9_-]{1,200}$/.test(sessionId)) throw new Error('Некорректный идентификатор чата.')
    if (typeof pluginId !== 'string' || typeof toolId !== 'string') throw new Error('Неизвестный инструмент.')
    const state = this.load()
    if (!state.installed.includes(pluginId)) throw new Error(`Плагин ${pluginId} не установлен.`)
    if (!getPluginToolIds(pluginId).includes(toolId)) throw new Error(`Неизвестный инструмент ${toolId} в плагине ${pluginId}.`)
    const loadedBySession = { ...state.loadedBySession, [sessionId]: [...new Set([...(state.loadedBySession[sessionId] || []), toolId])] }
    this.commit({ ...state, loadedBySession })
    return [...loadedBySession[sessionId]]
  }

  removeChat(sessionId: string): void {
    if (!/^[a-zA-Z0-9_-]{1,200}$/.test(sessionId)) return
    const state = this.load()
    if (!(sessionId in state.loadedBySession)) return
    const loadedBySession = { ...state.loadedBySession }
    delete loadedBySession[sessionId]
    this.commit({ ...state, loadedBySession })
  }
}
