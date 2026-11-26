import { ipcMain, dialog, shell, app, BrowserWindow, webContents } from 'electron'
import * as fs from 'fs/promises'
import * as path from 'path'
import { SessionStore } from '../services/SessionStore'
import { saveImage, readImage } from '../services/ImageUploads'
import { saveDocument } from '../services/DocumentUploads'
import { createChatArchive, restoreChatArchive } from '../services/ChatArchive'
import { getDefaultWorkspacesDir } from '../services/PlatformPaths'
import { diagnoseWorkspaceFile, listWorkspaceFiles, readWorkspacePreview, readWorkspaceText, resolveWorkspaceRevealPath, writeWorkspaceText } from '../services/WorkspaceFiles'
import { PluginManager } from '../agent/plugins/PluginManager'
import type { WorkspaceChangesService } from '../services/changes/WorkspaceChangesService'
import { FolderWatcher } from '../services/FolderWatcher'
import { resolveInsideRoot } from '../services/changes/diffUtils'

interface SenderWatchEntry {
  refs: number
  unwatch: () => void
}

function shouldIgnoreWorkspaceFileWatchPath(filename: string | null): boolean {
  if (!filename) return false
  const norm = filename.replace(/\\/g, '/').replace(/^\.\//, '')
  if (
    norm.startsWith('.git/objects') ||
    norm.startsWith('.git/logs') ||
    norm === '.git/index.lock'
  ) {
    return true
  }
  const base = norm.split('/').pop() || ''
  return /^\.zipply-[^/]+\.tmp$/.test(base)
}

export class WorkspaceIpcHandler {
  private sessionStore: SessionStore | null = null
  private diagnostics = new Map<number, AbortController>()
  private fileWatchers = new Map<number, Map<string, SenderWatchEntry>>()
  private changeWatchers = new Map<number, Map<string, SenderWatchEntry>>()
  private readonly filesWatcher = new FolderWatcher({ shouldIgnore: shouldIgnoreWorkspaceFileWatchPath })
  constructor(private readonly plugins?: PluginManager, sessionStore?: SessionStore, private readonly changes?: WorkspaceChangesService) { this.sessionStore = sessionStore || null }
  private getDefaultWorkspacesDir(): string {
    return getDefaultWorkspacesDir()
  }

  register(): void {
    this.sessionStore ||= new SessionStore(app.getPath('userData'))
    ipcMain.handle('workspace:diagnostics', async (event, { folderPath, relativePath, runServer, sourceText }) => {
      const key = event.sender.id
      this.diagnostics.get(key)?.abort()
      const controller = new AbortController()
      this.diagnostics.set(key, controller)
      try { return { data: await diagnoseWorkspaceFile(folderPath, relativePath, controller.signal, runServer === true, sourceText) } }
      catch (error) { return { error: error instanceof Error ? error.message : String(error) } }
      finally { if (this.diagnostics.get(key) === controller) this.diagnostics.delete(key) }
    })
    ipcMain.on('workspace:cancelDiagnostics', event => { this.diagnostics.get(event.sender.id)?.abort() })
    ipcMain.handle('workspace:listFiles', async (_, { folderPath, relativePath }) => {
      try { return { data: await listWorkspaceFiles(folderPath, relativePath) } }
      catch (error) { return { error: error instanceof Error ? error.message : String(error) } }
    })
    ipcMain.handle('workspace:readText', async (_, { folderPath, relativePath }) => {
      try { return { data: await readWorkspaceText(folderPath, relativePath) } }
      catch (error) { return { error: error instanceof Error ? error.message : String(error) } }
    })
    ipcMain.handle('workspace:readPreview', async (_, { folderPath, relativePath }) => {
      try { return { data: await readWorkspacePreview(folderPath, relativePath) } }
      catch (error) { return { error: error instanceof Error ? error.message : String(error) } }
    })
    ipcMain.handle('workspace:revealFile', async (_, { folderPath, relativePath }) => {
      try {
        const target = await resolveWorkspaceRevealPath(folderPath, relativePath)
        shell.showItemInFolder(target)
        return { data: true }
      } catch (error) {
        return { error: error instanceof Error ? error.message : String(error) }
      }
    })
    ipcMain.handle('workspace:writeText', async (_, { folderPath, relativePath, expected, content, sessionId }) => {
      try {
        if (this.changes && typeof sessionId === 'string' && sessionId) {
          const abs = await resolveInsideRoot(folderPath, relativePath)
          await this.changes.capturePreEdit(sessionId, folderPath, abs, 'editor')
        }
        await writeWorkspaceText(folderPath, relativePath, expected, content)
        this.changes?.notifyChanged(folderPath)
        this.filesWatcher.notifyChanged(folderPath)
        return { data: true }
      }
      catch (error) { return { error: error instanceof Error ? error.message : String(error) } }
    })
    ipcMain.on('workspace:defaultDir', (event) => { event.returnValue = this.getDefaultWorkspacesDir() })
    ipcMain.on('workspace:loadSessions', (event) => {
      event.returnValue = this.sessionStore!.loadAllSync()
    })
    ipcMain.handle('workspace:saveImage', async (_, { folderPath, name, bytes }) => {
      try { return { attachment: await saveImage(folderPath, name, bytes) } }
      catch (error) { return { error: error instanceof Error ? error.message : String(error) } }
    })
    ipcMain.handle('workspace:saveDocument', async (_, { folderPath, name, bytes }) => {
      try { return { attachment: await saveDocument(folderPath, name, bytes) } }
      catch (error) { return { error: error instanceof Error ? error.message : String(error) } }
    })
    ipcMain.handle('workspace:readImage', async (_, { folderPath, imagePath }) => {
      try { return { dataUrl: await readImage(folderPath, imagePath) } }
      catch (error) { return { error: error instanceof Error ? error.message : String(error) } }
    })
    ipcMain.handle('workspace:exportArchive', async (_, sessions) => {
      try { return { bytes: await createChatArchive(sessions) } }
      catch (error) { return { error: error instanceof Error ? error.message : String(error) } }
    })
    ipcMain.handle('workspace:importArchive', async (_, bytes) => {
      try {
        const sessions = await restoreChatArchive(bytes, path.join(app.getPath('userData'), 'restored-workspaces'))
        return { sessions }
      } catch (error) { return { error: error instanceof Error ? error.message : String(error) } }
    })
    // 1. Create or ensure workspace directory for a chat session
    ipcMain.handle('workspace:create', async (_, { sessionId, title, customPath }) => {
      try {
        const targetDir = customPath || path.join(this.getDefaultWorkspacesDir(), sessionId)
        await fs.mkdir(targetDir, { recursive: true })

        return { success: true, folderPath: targetDir }
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err)
        console.error('[WorkspaceIpcHandler] Failed to create workspace directory:', msg)
        return { success: false, error: msg }
      }
    })

    // 2. Save session.json inside the session's workspace directory
    ipcMain.handle('workspace:saveSession', async (_, { session }) => {
      try {
        if (!session || typeof session.id !== 'string') {
          return { success: false, error: 'Идентификатор сессии не указан' }
        }
        await this.sessionStore!.save(session)
        return { success: true }
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err)
        console.error('[WorkspaceIpcHandler] Failed to save session.json:', msg)
        return { success: false, error: msg }
      }
    })

    ipcMain.handle('workspace:deleteSession', async (_, { sessionId }) => {
      try {
        await this.sessionStore!.remove(sessionId)
        this.plugins?.removeChat(sessionId)
        await this.changes?.deleteSession(sessionId)
        return { success: true }
      }
      catch (err: unknown) { return { success: false, error: err instanceof Error ? err.message : String(err) } }
    })

    // 3. Open system dialog to pick a folder
    ipcMain.handle('workspace:selectFolder', async (event) => {
      try {
        const win = BrowserWindow.fromWebContents(event.sender)
        const options: Electron.OpenDialogOptions = {
          properties: ['openDirectory', 'createDirectory'],
          title: 'Выберите рабочую папку для чата'
        }
        const result = win
          ? await dialog.showOpenDialog(win, options)
          : await dialog.showOpenDialog(options)
        if (!result.canceled && result.filePaths.length > 0) {
          return result.filePaths[0]
        }
        return null
      } catch (err: unknown) {
        console.error('[WorkspaceIpcHandler] Failed to select folder:', err)
        return null
      }
    })

    // 4. Open folder in native file manager (Windows Explorer / macOS Finder)
    ipcMain.handle('workspace:openFolder', async (_, { folderPath }) => {
      try {
        if (!folderPath) {
          return { success: false, error: 'Путь к папке пуст' }
        }
        // Ensure folder exists before opening
        await fs.mkdir(folderPath, { recursive: true })
        const res = await shell.openPath(folderPath)
        if (res) {
          return { success: false, error: res }
        }
        return { success: true }
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err)
        return { success: false, error: msg }
      }
    })

    // 5. Return default root workspace path
    ipcMain.handle('workspace:getDefaultDir', async () => {
      return this.getDefaultWorkspacesDir()
    })

    // 6. Workspace Changes (Git + Session Baseline)
    ipcMain.handle('changes:getSummary', async (_, { sessionId, folderPath, includeNoise }) => {
      try {
        if (!this.changes) throw new Error('Сервис изменений не инициализирован.')
        return { data: await this.changes.getSummary(sessionId || '', folderPath, includeNoise === true) }
      } catch (error) {
        return { error: error instanceof Error ? error.message : String(error) }
      }
    })
    ipcMain.handle('changes:getFileDiff', async (_, { sessionId, folderPath, filePath, scope, status }) => {
      try {
        if (!this.changes) throw new Error('Сервис изменений не инициализирован.')
        return { data: await this.changes.getFileDiff(sessionId || '', folderPath, filePath, scope, status) }
      } catch (error) {
        return { error: error instanceof Error ? error.message : String(error) }
      }
    })
    ipcMain.handle('changes:stage', async (_, { folderPath, paths }) => {
      try {
        if (!this.changes) throw new Error('Сервис изменений не инициализирован.')
        await this.changes.stage(folderPath, paths)
        return { data: true }
      } catch (error) {
        return { error: error instanceof Error ? error.message : String(error) }
      }
    })
    ipcMain.handle('changes:unstage', async (_, { folderPath, paths }) => {
      try {
        if (!this.changes) throw new Error('Сервис изменений не инициализирован.')
        await this.changes.unstage(folderPath, paths)
        return { data: true }
      } catch (error) {
        return { error: error instanceof Error ? error.message : String(error) }
      }
    })
    ipcMain.handle('changes:discard', async (_, { sessionId, folderPath, filePath, scope, status }) => {
      try {
        if (!this.changes) throw new Error('Сервис изменений не инициализирован.')
        await this.changes.discardFile(sessionId || '', folderPath, filePath, scope, status)
        return { data: true }
      } catch (error) {
        return { error: error instanceof Error ? error.message : String(error) }
      }
    })
    ipcMain.handle('changes:discardAll', async (_, { sessionId, folderPath, onlyChatTouched }) => {
      try {
        if (!this.changes) throw new Error('Сервис изменений не инициализирован.')
        return { data: await this.changes.discardAll(sessionId || '', folderPath, onlyChatTouched === true) }
      } catch (error) {
        return { error: error instanceof Error ? error.message : String(error) }
      }
    })
    ipcMain.handle('changes:revertHunk', async (_, { sessionId, folderPath, filePath, scope, hunkIndex }) => {
      try {
        if (!this.changes) throw new Error('Сервис изменений не инициализирован.')
        await this.changes.revertHunk(sessionId || '', folderPath, filePath, scope, hunkIndex)
        return { data: true }
      } catch (error) {
        return { error: error instanceof Error ? error.message : String(error) }
      }
    })
    ipcMain.handle('changes:commit', async (_, { folderPath, message }) => {
      try {
        if (!this.changes) throw new Error('Сервис изменений не инициализирован.')
        return { data: await this.changes.commit(folderPath, message) }
      } catch (error) {
        return { error: error instanceof Error ? error.message : String(error) }
      }
    })
    ipcMain.handle('changes:initRepo', async (_, { folderPath }) => {
      try {
        if (!this.changes) throw new Error('Сервис изменений не инициализирован.')
        await this.changes.initRepo(folderPath)
        return { data: true }
      } catch (error) {
        return { error: error instanceof Error ? error.message : String(error) }
      }
    })
    this.registerFolderWatch(
      'workspace:watch',
      'workspace:unwatch',
      'workspace:updated',
      this.fileWatchers,
      (folderPath, listener) => this.filesWatcher.watch(folderPath, listener)
    )
    this.registerFolderWatch(
      'changes:watch',
      'changes:unwatch',
      'changes:updated',
      this.changeWatchers,
      this.changes ? (folderPath, listener) => this.changes!.watch(folderPath, listener) : undefined
    )
  }

  private registerFolderWatch(
    watchChannel: string,
    unwatchChannel: string,
    updateChannel: string,
    watchers: Map<number, Map<string, SenderWatchEntry>>,
    subscribe?: (folderPath: string, listener: (changedFolder: string) => void) => () => void
  ): void {
    ipcMain.on(watchChannel, (event, { folderPath }: { folderPath?: string }) => {
      if (!subscribe || typeof folderPath !== 'string' || !folderPath.trim()) return
      const senderId = event.sender.id
      const resolved = path.resolve(folderPath)
      let byFolder = watchers.get(senderId)
      if (!byFolder) {
        byFolder = new Map()
        watchers.set(senderId, byFolder)
        event.sender.once('destroyed', () => {
          const map = watchers.get(senderId)
          if (map) {
            for (const entry of map.values()) entry.unwatch()
            watchers.delete(senderId)
          }
        })
      }
      const existing = byFolder.get(resolved)
      if (existing) {
        existing.refs += 1
        return
      }
      const unwatch = subscribe(resolved, (changedFolder) => {
        const target = webContents.fromId(senderId)
        if (!target || target.isDestroyed()) return
        try {
          target.send(updateChannel, { folderPath: changedFolder })
        } catch {
          // ignore closed renderer
        }
      })
      byFolder.set(resolved, { refs: 1, unwatch })
    })
    ipcMain.on(unwatchChannel, (event, { folderPath }: { folderPath?: string }) => {
      if (typeof folderPath !== 'string' || !folderPath.trim()) return
      const byFolder = watchers.get(event.sender.id)
      if (!byFolder) return
      const resolved = path.resolve(folderPath)
      const entry = byFolder.get(resolved)
      if (entry) {
        entry.refs -= 1
        if (entry.refs <= 0) {
          entry.unwatch()
          byFolder.delete(resolved)
        }
      }
    })
  }

  closeAllWatchers(): void {
    this.filesWatcher.closeAll()
    for (const map of this.fileWatchers.values()) {
      for (const entry of map.values()) entry.unwatch()
    }
    this.fileWatchers.clear()
    for (const map of this.changeWatchers.values()) {
      for (const entry of map.values()) entry.unwatch()
    }
    this.changeWatchers.clear()
  }
}
