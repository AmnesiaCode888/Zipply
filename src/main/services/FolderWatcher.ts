import * as fsSync from 'fs'
import * as path from 'path'

interface WatchRecord {
  watcher: fsSync.FSWatcher | null
  folderPath: string
  listeners: Set<(folderPath: string) => void>
  timer: NodeJS.Timeout | null
}

export interface FolderWatcherOptions {
  shouldIgnore?: (filename: string | null) => boolean
  debounceMs?: number
  notifyDebounceMs?: number
}

/**
 * Watches directories for filesystem changes with per-folder listener
 * deduplication and debounced change notifications.
 */
export class FolderWatcher {
  private watchers = new Map<string, WatchRecord>()
  private readonly shouldIgnore?: (filename: string | null) => boolean
  private readonly debounceMs: number
  private readonly notifyDebounceMs: number

  constructor(options: FolderWatcherOptions = {}) {
    this.shouldIgnore = options.shouldIgnore
    this.debounceMs = options.debounceMs ?? 250
    this.notifyDebounceMs = options.notifyDebounceMs ?? 60
  }

  private scheduleNotify(record: WatchRecord, delayMs: number): void {
    if (record.timer) clearTimeout(record.timer)
    record.timer = setTimeout(() => {
      record.timer = null
      for (const listener of record.listeners) listener(record.folderPath)
    }, delayMs)
  }

  watch(folderPath: string, listener: (folderPath: string) => void): () => void {
    const resolved = path.resolve(folderPath)
    let record = this.watchers.get(resolved)
    if (!record) {
      const listeners = new Set<(folderPath: string) => void>()
      const trigger = (filename: string | Buffer | null) => {
        const name = filename ? String(filename) : null
        if (this.shouldIgnore?.(name)) return
        const current = this.watchers.get(resolved)
        if (current) this.scheduleNotify(current, this.debounceMs)
      }
      let watcher: fsSync.FSWatcher | null = null
      try {
        watcher = fsSync.watch(resolved, { recursive: true }, (_, filename) => trigger(filename))
      } catch {
        try {
          watcher = fsSync.watch(resolved, (_, filename) => trigger(filename))
        } catch {
          watcher = null
        }
      }
      watcher?.on('error', () => {
        // Keep app resilient if folder is deleted or unmounted
      })
      record = { watcher, folderPath: resolved, listeners, timer: null }
      this.watchers.set(resolved, record)
    }
    record.listeners.add(listener)
    return () => {
      const current = this.watchers.get(resolved)
      if (!current) return
      current.listeners.delete(listener)
      if (current.listeners.size === 0) {
        if (current.timer) clearTimeout(current.timer)
        current.watcher?.close()
        this.watchers.delete(resolved)
      }
    }
  }

  notifyChanged(folderPath: string): void {
    const resolved = path.resolve(folderPath)
    const record = this.watchers.get(resolved)
    if (!record) return
    this.scheduleNotify(record, this.notifyDebounceMs)
  }

  closeAll(): void {
    for (const record of this.watchers.values()) {
      if (record.timer) clearTimeout(record.timer)
      record.watcher?.close()
    }
    this.watchers.clear()
  }
}
