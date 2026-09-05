import { contextBridge, ipcRenderer, webFrame } from 'electron'

// Set crisp +10% zoom for comfortable desktop experience
try {
  webFrame.setZoomFactor(1.1)
} catch {
  // ignore
}

// Custom APIs for renderer
const api = {
  window: {
    minimize: () => ipcRenderer.invoke('window:minimize'),
    maximize: () => ipcRenderer.invoke('window:maximize'),
    close: () => ipcRenderer.invoke('window:close'),
    isMaximized: () => ipcRenderer.invoke('window:isMaximized')
  },
  agent: {
    chat: (history: any[], settings: any, requestId: string, agentId?: string) =>
      ipcRenderer.send('agent:chat', { history, settings, requestId, agentId }),
    cancel: (requestId: string) => ipcRenderer.send('agent:cancel', { requestId }),
    generateTitle: (userMessage: string, settings: any) =>
      ipcRenderer.invoke('agent:generateTitle', { userMessage, settings }),
    generateRoundSummary: (steps: any[], userMessage: string, settings: any) =>
      ipcRenderer.invoke('agent:generateRoundSummary', { steps, userMessage, settings }),
    onEvent: (callback: (event: any) => void) => {
      const listener = (_: any, event: any) => callback(event)
      ipcRenderer.on('agent:event', listener)
      return () => {
        ipcRenderer.removeListener('agent:event', listener)
      }
    },
    removeListeners: () => {
      ipcRenderer.removeAllListeners('agent:event')
    }
  },
  memory: {
    getAll: () => ipcRenderer.invoke('memory:getAll'),
    add: (memoryData: any) => ipcRenderer.invoke('memory:add', memoryData),
    update: (id: string, patch: any) => ipcRenderer.invoke('memory:update', { id, patch }),
    delete: (id: string) => ipcRenderer.invoke('memory:delete', id),
    search: (query?: string, category?: string, settings?: any) =>
      ipcRenderer.invoke('memory:search', { query, category, settings }),
    clear: () => ipcRenderer.invoke('memory:clear'),
    getCoreSummary: () => ipcRenderer.invoke('memory:getCoreSummary'),
    updateCoreSummary: (summary: string) => ipcRenderer.invoke('memory:updateCoreSummary', summary),
    generateCoreSummary: (settings?: any, force?: boolean) =>
      ipcRenderer.invoke('memory:generateCoreSummary', { settings, force })
  },
  persona: {
    get: () => ipcRenderer.invoke('persona:get'),
    update: (patch: any) => ipcRenderer.invoke('persona:update', patch),
    generate: (settings?: any, force?: boolean) =>
      ipcRenderer.invoke('persona:generate', { settings, force })
  },
  session: {
    getAll: () => ipcRenderer.invoke('session:getAll'),
    getRelevant: (query: string, limit?: number) => ipcRenderer.invoke('session:getRelevant', { query, limit }),
    delete: (id: string) => ipcRenderer.invoke('session:delete', id),
    clear: () => ipcRenderer.invoke('session:clear')
  },
  skills: {
    getAll: (workspacePath?: string) => ipcRenderer.invoke('skills:getAll', workspacePath),
    search: (query: string, filterType?: string, workspacePath?: string, settings?: any) =>
      ipcRenderer.invoke('skills:search', { query, filterType, workspacePath, settings }),
    save: (data: {
      name: string
      description: string
      content: string
      isCore?: boolean
      metadata?: { globs?: string[]; triggers?: string[]; tags?: string[]; tools?: string[] }
    }) => ipcRenderer.invoke('skills:save', data),
    delete: (name: string, isCore?: boolean, sourcePath?: string) =>
      ipcRenderer.invoke('skills:delete', { name, isCore, sourcePath }),
    toggleType: (name: string, sourcePath?: string) =>
      ipcRenderer.invoke('skills:toggleType', { name, sourcePath }),
    read: (name: string, resourcePath?: string, workspacePath?: string) =>
      ipcRenderer.invoke('skills:read', { name, resourcePath, workspacePath }),
    importFromPath: (filePath: string, isCore?: boolean) =>
      ipcRenderer.invoke('skills:importFromPath', { filePath, isCore }),
    importFromUrl: (url: string, isCore?: boolean) =>
      ipcRenderer.invoke('skills:importFromUrl', { url, isCore }),
    toggleEnabled: (name: string, enabled?: boolean) =>
      ipcRenderer.invoke('skills:toggleEnabled', { name, enabled }),
    togglePackage: (skillNames: string[], enabled: boolean) =>
      ipcRenderer.invoke('skills:togglePackage', { skillNames, enabled }),
    deleteMultiple: (items: Array<{ name: string; isCore?: boolean; sourcePath?: string }>) =>
      ipcRenderer.invoke('skills:deleteMultiple', { items }),
    openFolder: () => ipcRenderer.invoke('skills:openFolder'),
    syncExternal: () => ipcRenderer.invoke('skills:syncExternal'),
    selectSkillFileOrDir: () => ipcRenderer.invoke('skills:selectSkillFileOrDir')
  },
  schedule: {
    getAll: () => ipcRenderer.invoke('schedule:getAll'),
    get: (id: string) => ipcRenderer.invoke('schedule:get', id),
    create: (options: any) => ipcRenderer.invoke('schedule:create', options),
    cancel: (id: string) => ipcRenderer.invoke('schedule:cancel', id),
    pause: (id: string) => ipcRenderer.invoke('schedule:pause', id),
    resume: (id: string) => ipcRenderer.invoke('schedule:resume', id),
    trigger: (id: string) => ipcRenderer.invoke('schedule:trigger', id)
  },
  mcp: {
    getAllServers: () => ipcRenderer.invoke('mcp:getAllServers'),
    saveServer: (server: any) => ipcRenderer.invoke('mcp:saveServer', server),
    deleteServer: (id: string) => ipcRenderer.invoke('mcp:deleteServer', id),
    toggleServer: (id: string, enabled?: boolean) => ipcRenderer.invoke('mcp:toggleServer', { id, enabled }),
    testConnection: (id: string) => ipcRenderer.invoke('mcp:testConnection', id),
    getTools: (serverId?: string) => ipcRenderer.invoke('mcp:getTools', serverId),
    importConfig: (jsonContent: string) => ipcRenderer.invoke('mcp:importConfig', jsonContent),
    exportConfig: () => ipcRenderer.invoke('mcp:exportConfig')
  },
  dialog: {
    selectDirectory: (defaultPath?: string) => ipcRenderer.invoke('dialog:selectDirectory', defaultPath)
  },
  projects: {
    list: (baseDir?: string) => ipcRenderer.invoke('projects:list', baseDir),
    create: (baseDir: string, name: string) => ipcRenderer.invoke('projects:create', baseDir, name)
  },
  models: {
    fetchRemote: (data: { baseUrl: string; apiKey?: string; providerId?: string }) =>
      ipcRenderer.invoke('models:fetchRemote', data),
    testConnection: (data: { baseUrl: string; apiKey?: string; model?: string; providerId?: string }) =>
      ipcRenderer.invoke('models:testConnection', data),
    scanLocal: () => ipcRenderer.invoke('models:scanLocal')
  },
  storage: {
    getInfo: () => ipcRenderer.invoke('storage:getInfo'),
    getMetrics: () => ipcRenderer.invoke('storage:getMetrics'),
    getStore: <T = any>(storeName: string, defaultValue?: T) =>
      ipcRenderer.invoke('storage:getStore', { storeName, defaultValue }),
    setStore: <T = any>(storeName: string, data: T, debounceMs?: number) =>
      ipcRenderer.invoke('storage:setStore', { storeName, data, debounceMs }),
    getItem: <T = any>(key: string, defaultValue?: T) =>
      ipcRenderer.invoke('storage:getItem', { key, defaultValue }),
    setItem: (key: string, value: any) =>
      ipcRenderer.invoke('storage:setItem', { key, value }),
    removeItem: (key: string) =>
      ipcRenderer.invoke('storage:removeItem', key),
    openFolder: () => ipcRenderer.invoke('storage:openFolder'),
    exportBackup: () => ipcRenderer.invoke('storage:exportBackup'),
    importBackup: () => ipcRenderer.invoke('storage:importBackup')
  },
  setZoomFactor: (factor: number) => {
    try {
      webFrame.setZoomFactor(factor)
    } catch {
      // ignore
    }
  }
}

if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('api', api)
  } catch (error) {
    console.error(error)
  }
} else {
  // @ts-ignore (define in dts)
  window.api = api
}
