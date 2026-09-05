import { app, shell, BrowserWindow, ipcMain, dialog } from 'electron'
import * as fs from 'fs'
import { join, normalize } from 'path'
import { runAgent } from './agent/index'
import { ChatService } from './agent/services/ChatService'
import { MemoryService } from './agent/services/MemoryService'
import { SessionSummaryService } from './agent/services/SessionSummaryService'
import { LinguisticPersonaService } from './agent/services/LinguisticPersonaService'
import { SkillService } from './agent/services/SkillService'
import { SchedulerService } from './agent/services/SchedulerService'
import { McpService } from './agent/services/McpService'
import { LocalStorageService } from './services/LocalStorageService'

app.name = 'Zipply'

let mainWindow: BrowserWindow | null = null
const activeControllers: Map<string, AbortController> = new Map()

function safeSend(target: any, channel: string, ...args: any[]): void {
  try {
    if (target && typeof target.isDestroyed === 'function' && !target.isDestroyed()) {
      target.send(channel, ...args)
      return
    }
  } catch {
    try {
      if (mainWindow && !mainWindow.isDestroyed() && mainWindow.webContents && target !== mainWindow.webContents) {
        mainWindow.webContents.send(channel, ...args)
      }
    } catch {}
  }
}

function createWindow(): void {
  const iconPath = fs.existsSync(join(__dirname, '../../resources/icon.png'))
    ? join(__dirname, '../../resources/icon.png')
    : join(app.getAppPath(), 'resources/icon.png')

  mainWindow = new BrowserWindow({
    width: 1100,
    height: 780,
    minWidth: 800,
    minHeight: 550,
    show: false,
    frame: false,
    autoHideMenuBar: true,
    backgroundColor: '#0D0D0D',
    icon: iconPath,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true
    }
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow?.show()
    mainWindow?.focus()
  })

  mainWindow.webContents.on('did-finish-load', () => {
    if (!mainWindow?.isVisible()) {
      mainWindow?.show()
      mainWindow?.focus()
    }
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  // HMR for renderer base on electron-vite cli.
  // Load the remote URL for development or the local html file for production.
  if (process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

app.whenReady().then(() => {
  // Initialize Persistent Local Storage, Background Scheduler & Default Skills
  LocalStorageService.init()
  SchedulerService.init()
  SkillService.init()

  // Window controls
  ipcMain.handle('window:minimize', (event) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    win?.minimize()
  })

  ipcMain.handle('window:maximize', (event) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (win) {
      if (win.isMaximized()) {
        win.unmaximize()
      } else {
        win.maximize()
      }
      return win.isMaximized()
    }
    return false
  })

  ipcMain.handle('window:close', (event) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    win?.close()
  })

  ipcMain.handle('window:isMaximized', (event) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    return win?.isMaximized() ?? false
  })

  // Projects: list existing folders under the base workspace directory
  ipcMain.handle('projects:list', async (_event, baseDir?: string) => {
    const defaultBase = LocalStorageService.getDefaultProjectsDir()
    const base =
      baseDir && typeof baseDir === 'string' && baseDir.trim()
        ? normalize(baseDir.trim())
        : defaultBase
    try {
      if (!fs.existsSync(base)) {
        await fs.promises.mkdir(base, { recursive: true })
        return []
      }
      const entries = await fs.promises.readdir(base, { withFileTypes: true })
      return entries
        .filter((e) => e.isDirectory())
        .map((e) => ({ name: e.name, path: join(base, e.name) }))
        .sort((a, b) => a.name.localeCompare(b.name))
    } catch {
      return []
    }
  })

  // Projects: create a new folder under the base workspace directory
  ipcMain.handle('projects:create', async (_event, baseDir?: string, name?: string) => {
    const defaultBase = LocalStorageService.getDefaultProjectsDir()
    const base =
      baseDir && typeof baseDir === 'string' && baseDir.trim()
        ? normalize(baseDir.trim())
        : defaultBase
    const folderName = (name || '').trim()
    if (!folderName) return null
    const full = join(base, folderName)
    try {
      await fs.promises.mkdir(full, { recursive: true })
      return { name: folderName, path: full }
    } catch (err) {
      console.warn('[projects:create] Failed to create folder:', err)
      return null
    }
  })

  // Directory Selection Dialog
  ipcMain.handle('dialog:selectDirectory', async (event, defaultPath?: string) => {
    const win = BrowserWindow.fromWebContents(event.sender) || mainWindow
    const result = await dialog.showOpenDialog(win || undefined as any, {
      title: 'Выберите рабочую папку проектов ИИ',
      properties: ['openDirectory', 'createDirectory', 'promptToCreate'],
      defaultPath: defaultPath || undefined
    })
    if (result.canceled || !result.filePaths || result.filePaths.length === 0) {
      return null
    }
    return result.filePaths[0]
  })

  // Agent chat
  ipcMain.on('agent:chat', async (event, { history, settings, requestId, agentId }) => {
    if (activeControllers.has(requestId)) {
      try {
        activeControllers.get(requestId)?.abort()
      } catch {}
      activeControllers.delete(requestId)
    }

    const controller = new AbortController()
    activeControllers.set(requestId, controller)

    try {
      await runAgent(
        agentId || 'zipply',
        history,
        settings,
        (agentEvent) => {
          safeSend(event.sender, 'agent:event', { ...agentEvent, requestId })
        },
        controller.signal
      )
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      safeSend(event.sender, 'agent:event', { type: 'error', message: msg, requestId })
    } finally {
      activeControllers.delete(requestId)
    }
  })

  ipcMain.on('agent:cancel', (_, { requestId }) => {
    const controller = activeControllers.get(requestId)
    if (controller) {
      controller.abort()
      activeControllers.delete(requestId)
    }
  })

  ipcMain.handle('agent:generateTitle', async (_, { userMessage, settings }) => {
    try {
      const messages: any[] = [
        {
          role: 'system',
          content:
            'Ты ассистент, создающий короткие названия для чата (3-5 слов), без кавычек и точек в конце. На языке сообщения.'
        },
        {
          role: 'user',
          content: `Придумай краткое название для этого диалога по первому сообщению:\n${userMessage}`
        }
      ]
      const rawModel = (settings?.fastModel && settings.fastModel.trim()) || settings?.model || 'gpt-4o'
      const modelToUse = rawModel.replace(/^models\//, '').trim()
      let res
      try {
        res = await ChatService.chat({ ...settings, model: modelToUse, maxTokens: 50, stream: false }, messages)
      } catch (fastErr) {
        if (settings?.model && settings.model.trim() !== modelToUse) {
          const fallbackModel = settings.model.replace(/^models\//, '').trim()
          res = await ChatService.chat({ ...settings, model: fallbackModel, maxTokens: 50, stream: false }, messages)
        } else {
          throw fastErr
        }
      }
      const title = res?.content?.trim().replace(/^["'«`]+|["'»`]+$/g, '')
      if (title && title.length < 60) return title
    } catch (e) {
      console.warn('[GenerateTitle] AI title fallback:', e instanceof Error ? e.message : e)
    }
    return userMessage.length > 30 ? userMessage.slice(0, 30) + '...' : userMessage
  })

  ipcMain.handle('agent:generateRoundSummary', async (_, { steps, userMessage, settings }) => {
    try {
      if (!steps || !Array.isArray(steps) || steps.length === 0) return null
      const simplifiedSteps = steps
        .filter((s: any) => s.type !== 'thought' || Boolean(s.result))
        .slice(0, 8)
        .map((s: any) => ({
          type: s.type,
          action: s.action,
          target: s.target,
          resultSnippet: typeof s.result === 'string' ? s.result.slice(0, 100) : undefined
        }))

      const messages: any[] = [
        {
          role: 'system',
          content:
            'Ты помощник, который кратко описывает выполненные действия агента в 2-5 словах. Примеры: "Создание тестов для API", "Редактирование настроек Vitest", "Поиск по кодовой базе", "Запуск сборки проекта", "Анализ зависимостей". Без точек в конце, без кавычек, на русском языке.'
        },
        {
          role: 'user',
          content: `Контекст: ${userMessage || 'Действия'}\nШаги:\n${JSON.stringify(simplifiedSteps)}`
        }
      ]
      const rawModel = (settings?.fastModel && settings.fastModel.trim()) || settings?.model || 'gpt-4o'
      const modelToUse = rawModel.replace(/^models\//, '').trim()
      let res
      try {
        res = await ChatService.chat(
          { ...settings, model: modelToUse, maxTokens: 40, temperature: 0.3, stream: false },
          messages
        )
      } catch (fastErr) {
        if (settings?.model && settings.model.trim() !== modelToUse) {
          const fallbackModel = settings.model.replace(/^models\//, '').trim()
          res = await ChatService.chat(
            { ...settings, model: fallbackModel, maxTokens: 40, temperature: 0.3, stream: false },
            messages
          )
        } else {
          throw fastErr
        }
      }
      const summary = res?.content?.trim().replace(/^["'«`]+|["'»`.]+$|\.$/g, '')
      if (summary && summary.length < 70) return summary
    } catch (e) {
      console.warn('[GenerateRoundSummary] AI round summary fallback:', e instanceof Error ? e.message : e)
    }
    return null
  })

  // Memory & Core Summary
  ipcMain.handle('memory:getAll', () => MemoryService.getAllMemories())
  ipcMain.handle('memory:add', (_, memoryData) => MemoryService.addMemory(memoryData))
  ipcMain.handle('memory:update', (_, { id, patch }) => MemoryService.updateMemory(id, patch))
  ipcMain.handle('memory:delete', (_, id) => MemoryService.deleteMemory(id))
  ipcMain.handle('memory:search', (_, { query, category, settings }) =>
    MemoryService.searchMemoriesAsync(query, category, settings)
  )
  ipcMain.handle('memory:clear', () => MemoryService.clearAll())
  ipcMain.handle('memory:getCoreSummary', () => MemoryService.getCoreSummary())
  ipcMain.handle('memory:updateCoreSummary', (_, summary: string) => {
    MemoryService.updateCoreSummary(summary)
    return true
  })
  ipcMain.handle('memory:generateCoreSummary', (_, { settings, force }) =>
    MemoryService.generateCoreSummaryAsync(settings, force)
  )

  // Linguistic Persona (Human Communication Style)
  ipcMain.handle('persona:get', () => LinguisticPersonaService.getPersona())
  ipcMain.handle('persona:update', (_, patch) => LinguisticPersonaService.updatePersona(patch))
  ipcMain.handle('persona:generate', (_, { settings, force }) =>
    LinguisticPersonaService.synthesizeProfileAsync(settings, force)
  )

  // Session Summaries (Medium-Term Memory)
  ipcMain.handle('session:getAll', () => SessionSummaryService.getAllSessions())
  ipcMain.handle('session:getRelevant', (_, { query, limit }) =>
    SessionSummaryService.getRelevantSummaries(query, limit || 3)
  )
  ipcMain.handle('session:delete', (_, id) => SessionSummaryService.deleteSession(id))
  ipcMain.handle('session:clear', () => SessionSummaryService.clearAll())

  // Skills Engine (Universal Codex, Cursor, Antigravity & User Skills)
  ipcMain.handle('skills:getAll', (_, workspacePath?: string) => SkillService.getAllSkills(workspacePath))
  ipcMain.handle('skills:search', (_, { query, filterType, workspacePath, settings }) => {
    const embeddingConfig = settings
      ? {
          baseUrl: settings.baseUrl,
          apiKey: settings.apiKey,
          embeddingModel: settings.embeddingModel,
          embeddingBaseUrl: settings.embeddingBaseUrl
        }
      : undefined
    return SkillService.searchSkillsAsync(query, {
      workspacePath,
      filterType,
      embeddingConfig
    })
  })
  ipcMain.handle('skills:save', (_, { name, description, content, isCore, metadata }) =>
    SkillService.saveSkill(name, description, content, isCore, metadata)
  )
  ipcMain.handle('skills:delete', (_, { name, isCore, sourcePath }) =>
    SkillService.deleteSkill(name, isCore, sourcePath)
  )
  ipcMain.handle('skills:toggleType', (_, { name, sourcePath }) =>
    SkillService.toggleSkillType(name, sourcePath)
  )
  ipcMain.handle('skills:read', (_, { name, resourcePath, workspacePath }) =>
    SkillService.readSkill(name, resourcePath, workspacePath)
  )
  ipcMain.handle('skills:importFromPath', (_, { filePath, isCore }) =>
    SkillService.importSkillFromPath(filePath, isCore)
  )
  ipcMain.handle('skills:importFromUrl', (_, { url, isCore }) =>
    SkillService.importSkillFromUrl(url, isCore)
  )
  ipcMain.handle('skills:toggleEnabled', (_, { name, enabled }) =>
    SkillService.toggleSkillEnabled(name, enabled)
  )
  ipcMain.handle('skills:togglePackage', (_, { skillNames, enabled }) =>
    SkillService.togglePackageEnabled(skillNames, enabled)
  )
  ipcMain.handle('skills:deleteMultiple', (_, { items }) =>
    SkillService.deleteMultipleSkills(items)
  )
  ipcMain.handle('skills:openFolder', () => SkillService.openSkillsFolder())
  ipcMain.handle('skills:syncExternal', () => SkillService.syncFromExternalLocations())
  ipcMain.handle('skills:selectSkillFileOrDir', async (event) => {
    const win = BrowserWindow.fromWebContents(event.sender) || mainWindow
    const res = await dialog.showOpenDialog(win || (undefined as any), {
      title: 'Выберите файл навыка (.md, .mdc, SKILL.md) или папку навыка',
      properties: ['openFile', 'openDirectory'],
      filters: [
        { name: 'Файлы навыков и Markdown', extensions: ['md', 'mdc', 'txt'] },
        { name: 'Все файлы', extensions: ['*'] }
      ]
    })
    if (res.canceled || !res.filePaths || res.filePaths.length === 0) return null
    return res.filePaths[0]
  })

  // Background Task Scheduler
  ipcMain.handle('schedule:getAll', () => SchedulerService.getAllSchedules())
  ipcMain.handle('schedule:get', (_, id: string) => SchedulerService.getSchedule(id))
  ipcMain.handle('schedule:create', (_, options) => SchedulerService.createSchedule(options))
  ipcMain.handle('schedule:cancel', (_, id: string) => SchedulerService.cancelSchedule(id))
  ipcMain.handle('schedule:pause', (_, id: string) => SchedulerService.pauseSchedule(id))
  ipcMain.handle('schedule:resume', (_, id: string) => SchedulerService.resumeSchedule(id))
  ipcMain.handle('schedule:trigger', (_, id: string) => SchedulerService.triggerTask(id))

  // Model Context Protocol (MCP) Server Management
  ipcMain.handle('mcp:getAllServers', () => McpService.getAllServers())
  ipcMain.handle('mcp:saveServer', async (_, server) => {
    try {
      const res = await McpService.saveServer(server)
      return { success: true, server: res }
    } catch (err: any) {
      return { success: false, error: err.message }
    }
  })
  ipcMain.handle('mcp:deleteServer', (_, id: string) => {
    try {
      McpService.deleteServer(id)
      return { success: true }
    } catch (err: any) {
      return { success: false, error: err.message }
    }
  })
  ipcMain.handle('mcp:toggleServer', async (_, { id, enabled }) => {
    try {
      const res = await McpService.toggleServer(id, enabled)
      return { success: true, server: res }
    } catch (err: any) {
      return { success: false, error: err.message }
    }
  })
  ipcMain.handle('mcp:testConnection', async (_, id: string) => {
    try {
      return await McpService.testConnection(id)
    } catch (err: any) {
      return { success: false, error: err.message }
    }
  })
  ipcMain.handle('mcp:getTools', async (_, serverId?: string) => {
    const all = await McpService.getActiveTools()
    if (serverId) {
      return all.filter((t) => t.serverId === serverId)
    }
    return all
  })
  ipcMain.handle('mcp:importConfig', (_, jsonContent: string) => {
    return McpService.importConfig(jsonContent)
  })
  ipcMain.handle('mcp:exportConfig', () => {
    return McpService.exportConfig()
  })

  // Models & Router Fetching
  ipcMain.handle('models:fetchRemote', async (_, options) => {
    const { ModelFetcherService } = await import('./agent/services/ModelFetcherService')
    return ModelFetcherService.fetchRemoteModels(options)
  })
  ipcMain.handle('models:testConnection', async (_, options) => {
    const { ModelFetcherService } = await import('./agent/services/ModelFetcherService')
    return ModelFetcherService.testConnection(options)
  })
  ipcMain.handle('models:scanLocal', async () => {
    const { ModelFetcherService } = await import('./agent/services/ModelFetcherService')
    return ModelFetcherService.scanLocalServers()
  })

  // Persistent Cross-Platform Local Storage
  ipcMain.handle('storage:getInfo', () => LocalStorageService.getSystemPathsInfo())
  ipcMain.handle('storage:getMetrics', () => LocalStorageService.getMetrics())
  ipcMain.handle('storage:getStore', (_, { storeName, defaultValue }) =>
    LocalStorageService.getStore(storeName, defaultValue)
  )
  ipcMain.handle('storage:setStore', (_, { storeName, data, debounceMs }) => {
    LocalStorageService.setStore(storeName, data, debounceMs || 0)
    return true
  })
  ipcMain.handle('storage:getItem', (_, { key, defaultValue }) =>
    LocalStorageService.getItem(key, defaultValue)
  )
  ipcMain.handle('storage:setItem', (_, { key, value }) => {
    LocalStorageService.setItem(key, value)
    return true
  })
  ipcMain.handle('storage:removeItem', (_, key) => {
    LocalStorageService.removeItem(key)
    return true
  })
  ipcMain.handle('storage:openFolder', () => LocalStorageService.openStorageFolder())

  ipcMain.handle('storage:exportBackup', async (event) => {
    const win = BrowserWindow.fromWebContents(event.sender) || mainWindow
    const archive = LocalStorageService.exportBackupArchive()
    const dateStr = new Date().toISOString().slice(0, 10)
    const saveRes = await dialog.showSaveDialog(win || (undefined as any), {
      title: 'Экспорт полной резервной копии Zipply',
      defaultPath: `zipply-backup-${dateStr}.json`,
      filters: [{ name: 'Zipply Backup JSON', extensions: ['json'] }]
    })
    if (saveRes.canceled || !saveRes.filePath) return { success: false, cancelled: true }
    try {
      fs.writeFileSync(saveRes.filePath, JSON.stringify(archive, null, 2), 'utf8')
      return { success: true, filePath: saveRes.filePath }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      return { success: false, error: msg }
    }
  })

  ipcMain.handle('storage:importBackup', async (event) => {
    const win = BrowserWindow.fromWebContents(event.sender) || mainWindow
    const openRes = await dialog.showOpenDialog(win || (undefined as any), {
      title: 'Восстановление из резервной копии Zipply',
      properties: ['openFile'],
      filters: [{ name: 'Zipply Backup JSON', extensions: ['json'] }]
    })
    if (openRes.canceled || !openRes.filePaths || openRes.filePaths.length === 0) {
      return { success: false, cancelled: true }
    }
    try {
      const raw = fs.readFileSync(openRes.filePaths[0], 'utf8')
      const archive = JSON.parse(raw)
      return LocalStorageService.importBackupArchive(archive)
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      return { success: false, error: `Не удалось прочитать файл: ${msg}` }
    }
  })

  createWindow()

  app.on('activate', function () {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('before-quit', () => {
  try {
    McpService.stopAll()
  } catch {}
})

app.on('window-all-closed', () => {
  try {
    McpService.stopAll()
  } catch {}
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
