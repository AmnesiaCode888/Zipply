import type { AgentEvent } from '../shared/agentEvents'

export interface ElectronAPI {
  window: {
    minimize: () => Promise<void>
    maximize: () => Promise<boolean>
    close: () => Promise<void>
    isMaximized: () => Promise<boolean>
  }
  agent: {
    chat: (history: any[], settings: any, requestId: string, agentId?: string) => void
    cancel: (requestId: string) => void
    generateTitle: (userMessage: string, settings: any) => Promise<string>
    generateRoundSummary: (steps: any[], userMessage: string, settings: any) => Promise<string | null>
    onEvent: (callback: (event: AgentEvent) => void) => () => void
    removeListeners: () => void
  }
  memory: {
    getAll: () => Promise<any[]>
    add: (memoryData: any) => Promise<any>
    update: (id: string, patch: any) => Promise<any>
    delete: (id: string) => Promise<boolean>
    search: (query?: string, category?: string | null, settings?: any) => Promise<any[]>
    clear: () => Promise<boolean>
    getCoreSummary: () => Promise<string>
    updateCoreSummary: (summary: string) => Promise<boolean>
    generateCoreSummary: (settings?: any, force?: boolean) => Promise<string>
  }
  persona: {
    get: () => Promise<any>
    update: (patch: any) => Promise<any>
    generate: (settings?: any, force?: boolean) => Promise<string>
  }
  session: {
    getAll: () => Promise<any[]>
    getRelevant: (query: string, limit?: number) => Promise<any[]>
    delete: (id: string) => Promise<boolean>
    clear: () => Promise<boolean>
  }
  skills: {
    getAll: (workspacePath?: string) => Promise<any[]>
    search: (query: string, filterType?: string, workspacePath?: string, settings?: any) => Promise<any[]>
    save: (data: {
      name: string
      description: string
      content: string
      isCore?: boolean
      metadata?: { globs?: string[]; triggers?: string[]; tags?: string[]; tools?: string[] }
    }) => Promise<{ success: boolean; skill?: any; error?: string }>
    delete: (name: string, isCore?: boolean, sourcePath?: string) =>
      Promise<{ success: boolean; error?: string }>
    toggleType: (name: string, sourcePath?: string) =>
      Promise<{ success: boolean; newIsCore?: boolean; error?: string }>
    read: (name: string, resourcePath?: string, workspacePath?: string) =>
      Promise<{ success: boolean; content?: string; resourceContent?: string; files?: string[]; metadata?: any; error?: string }>
    importFromPath: (filePath: string, isCore?: boolean) =>
      Promise<{ success: boolean; skill?: any; count?: number; error?: string }>
    importFromUrl: (url: string, isCore?: boolean) =>
      Promise<{ success: boolean; skill?: any; error?: string }>
    toggleEnabled: (name: string, enabled?: boolean) =>
      Promise<{ success: boolean; enabled: boolean }>
    togglePackage: (skillNames: string[], enabled: boolean) =>
      Promise<{ success: boolean; count: number }>
    deleteMultiple: (items: Array<{ name: string; isCore?: boolean; sourcePath?: string }>) =>
      Promise<{ success: boolean; deletedCount: number }>
    openFolder: () => Promise<{ success: boolean; path: string; error?: string }>
    syncExternal: () => Promise<{ success: boolean; importedCount: number; skills: any[]; error?: string }>
    selectSkillFileOrDir: () => Promise<string | null>
  }
  schedule: {
    getAll: () => Promise<any[]>
    get: (id: string) => Promise<any>
    create: (options: any) => Promise<{ success: boolean; item?: any; error?: string }>
    cancel: (id: string) => Promise<boolean>
    pause: (id: string) => Promise<boolean>
    resume: (id: string) => Promise<boolean>
    trigger: (id: string) => Promise<{ success: boolean; message: string }>
  }
  dialog: {
    selectDirectory: (defaultPath?: string) => Promise<string | null>
  }
  projects: {
    list: (baseDir?: string) => Promise<{ name: string; path: string }[]>
    create: (baseDir: string, name: string) => Promise<{ name: string; path: string } | null>
  }
  models: {
    fetchRemote: (data: { baseUrl: string; apiKey?: string; providerId?: string }) => Promise<string[]>
    testConnection: (data: { baseUrl: string; apiKey?: string; model?: string; providerId?: string }) =>
      Promise<{ status: 'success' | 'error'; message: string; latencyMs?: number }>
    scanLocal: () => Promise<Array<{
      providerId: 'ollama' | 'lmstudio' | 'vllm'
      name: string
      port: number
      baseUrl: string
      models: string[]
      status: 'online'
      latencyMs?: number
    }>>
  }
  storage: {
    getInfo: () => Promise<{
      platform: 'win32' | 'darwin' | 'linux' | string
      homeDir: string
      userDataDir: string
      storageDir: string
      defaultProjectsDir: string
    }>
    getMetrics: () => Promise<{
      chatsCount: number
      projectsCount: number
      hasAiConfig: boolean
      hasAppearance: boolean
      storageSizeBytes: number
      lastUpdated: string
    }>
    getStore: <T = any>(storeName: string, defaultValue?: T) => Promise<T>
    setStore: <T = any>(storeName: string, data: T, debounceMs?: number) => Promise<boolean>
    getItem: <T = any>(key: string, defaultValue?: T) => Promise<T>
    setItem: (key: string, value: any) => Promise<boolean>
    removeItem: (key: string) => Promise<boolean>
    openFolder: () => Promise<{ success: boolean; path: string; error?: string }>
    exportBackup: () => Promise<{ success: boolean; filePath?: string; cancelled?: boolean; error?: string }>
    importBackup: () => Promise<{ success: boolean; details?: string; cancelled?: boolean; error?: string }>
  }
  setZoomFactor: (factor: number) => void
}

declare global {
  interface Window {
    api: ElectronAPI
  }
}

export {}
