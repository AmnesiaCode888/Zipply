import { app, BrowserWindow, ipcMain, powerMonitor, safeStorage, shell } from 'electron'
import * as fs from 'fs/promises'
import * as path from 'path'
import { electronApp, optimizer } from '@electron-toolkit/utils'
import { WindowManager } from './services/WindowManager'
import { WindowIpcHandler } from './ipc/WindowIpcHandler'
import { AgentIpcHandler } from './ipc/AgentIpcHandler'
import { AuthIpcHandler } from './ipc/AuthIpcHandler'
import { UpdateIpcHandler } from './ipc/UpdateIpcHandler'
import { WorkspaceIpcHandler } from './ipc/WorkspaceIpcHandler'
import { TerminalIpcHandler } from './ipc/TerminalIpcHandler'
import { AuthService } from './services/AuthService'
import { UpdateService } from './services/UpdateService'
import { SecretStore } from './services/SecretStore'
import { processManager } from './agent/services/ProcessManager'
import { terminalSessionManager } from './agent/services/TerminalSessionManager'
import { setupLinuxUserDataPath, migrateLegacyLinuxFolders } from './services/PlatformPaths'
import { PluginManager } from './agent/plugins/PluginManager'
import { RunJournalStore } from './agent/core/RunJournal'
import { AppStorage } from './services/AppStorage'
import { SessionStore } from './services/SessionStore'
import { WorkspaceChangesService } from './services/changes/WorkspaceChangesService'
import { McpConfigStore } from './agent/mcp/McpConfigStore'
import { McpRuntimeManager } from './agent/mcp/McpRuntimeManager'
import { McpTrustStore } from './agent/mcp/McpTrustStore'
import { createSkillRepository } from './agent/skills/createSkillRepository'
import { SkillImportService } from './agent/skills/SkillImportService'
import { McpConnectionService } from './agent/mcp/McpConnectionService'
import { McpRegistryClient } from './agent/mcp/McpRegistryClient'
import { registerRendererSecretIpc } from './ipc/RendererSecretIpc'

setupLinuxUserDataPath()

const windowManager = new WindowManager()
const windowIpcHandler = new WindowIpcHandler()

app.whenReady().then(async () => {
  await migrateLegacyLinuxFolders()

  const storage = new AppStorage(app.getPath('userData'))
  const sessions = new SessionStore(app.getPath('userData'))
  ipcMain.on('storage:get', (event, key: string) => {
    try { event.returnValue = storage.get(key) } catch { event.returnValue = { error: true } }
  })
  ipcMain.on('storage:set', (event, key: string, value: string | null) => {
    try { storage.set(key, value); event.returnValue = { ok: true } } catch { event.returnValue = { error: true } }
  })
  ipcMain.on('storage:keys', event => {
    try { event.returnValue = { keys: storage.keys() } } catch { event.returnValue = { error: true } }
  })
  ipcMain.handle('storage:prepareCheckpoint', async (_, { sessionId, messages }: { sessionId: string; messages: unknown[] }) => {
    try { return await storage.prepareCheckpoint(sessionId, messages) }
    catch (error) { return { status: 'error', error: error instanceof Error ? error.message : String(error) } }
  })
  ipcMain.on('storage:commitCheckpoint', (event, token: string) => {
    try {
      event.returnValue = storage.commitCheckpoint(token, session => {
        void sessions.saveCheckpoint(session).catch(() => {
          if (!event.sender.isDestroyed()) event.sender.send('storage:checkpointBackupError')
        })
      })
    } catch { event.returnValue = { status: 'error' } }
  })
  ipcMain.on('storage:discardCheckpoint', (_, token: string) => storage.discardCheckpoint(token))

  const secrets = new SecretStore(app.getPath('userData'), safeStorage)
  registerRendererSecretIpc(secrets, (channel, listener) => {
    ipcMain.on(channel, (event, payload) => listener(event, payload))
  })
  electronApp.setAppUserModelId('com.zipply.app')

  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  windowIpcHandler.register()
  const authService = new AuthService({
    secrets,
    openExternal: (url) => shell.openExternal(url)
  })
  new AuthIpcHandler(authService).register()
  void authService.initialize()
  const updateService = new UpdateService({
    currentVersion: app.getVersion(),
    isPackaged: app.isPackaged,
    openExternal: (url) => shell.openExternal(url)
  })
  new UpdateIpcHandler(updateService).register()
  updateService.start()
  powerMonitor.on('resume', () => {
    void authService.ensureFreshSession()
  })
  app.on('before-quit', () => {
    authService.dispose()
    updateService.dispose()
  })
  const pluginManager = new PluginManager(app.getPath('userData'))
  const mcpConfig = new McpConfigStore(app.getPath('userData'), secrets)
  const mcpTrust = new McpTrustStore(app.getPath('userData'))
  const mcpRuntime = new McpRuntimeManager({ getHeaders: serverId => mcpConfig.getHeaders(serverId) })
  try {
    for (const stored of mcpConfig.list()) {
      try { mcpRuntime.registerServer(mcpConfig.getDefinition(stored.id)) }
      catch (error) { console.warn(`[MCP] Не удалось загрузить сервер ${stored.id}:`, error) }
    }
  } catch (error) {
    console.warn('[MCP] Не удалось прочитать сохранённые серверы:', error)
  }
  const runJournal = new RunJournalStore(path.join(app.getPath('userData'), 'run-journals'))
  const workspaceChanges = new WorkspaceChangesService(app.getPath('userData'), (absPath) =>
    shell.trashItem(absPath).catch(() => fs.rm(absPath, { force: true }))
  )
  new AgentIpcHandler(pluginManager, authService, runJournal, workspaceChanges, {
    mcpRuntime, mcpConfig, mcpTrust,
    mcpConnections: new McpConnectionService(mcpConfig, mcpRuntime, new McpRegistryClient()),
    createSkillRepository: workspacePath => createSkillRepository(workspacePath, app.getPath('userData')),
    skillImport: new SkillImportService(app.getPath('userData'), path.join(app.getPath('home'), '.agents', 'skills'))
  }).register()
  const workspaceIpcHandler = new WorkspaceIpcHandler(pluginManager, sessions, workspaceChanges)
  workspaceIpcHandler.register()
  terminalSessionManager.setLogDirectory(path.join(app.getPath('userData'), 'terminal-logs'))
  new TerminalIpcHandler().register()
  windowManager.createMainWindow()

  shutdownExtensions = async () => {
    workspaceIpcHandler.closeAllWatchers()
    workspaceChanges.closeAllWatchers()
    await mcpRuntime.dispose()
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      windowManager.createMainWindow()
    }
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

let stoppingProcesses = false
let shutdownExtensions: (() => Promise<void>) | undefined
app.on('before-quit', (event) => {
  if (stoppingProcesses) return
  event.preventDefault()
  stoppingProcesses = true
  void Promise.allSettled([
    processManager.shutdown(),
    terminalSessionManager.shutdown(),
    shutdownExtensions?.()
  ]).finally(() => app.quit())
})
