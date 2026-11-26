import { contextBridge, ipcRenderer, webFrame } from 'electron'
import type { AgentHistoryMessage, QuestionAnswer } from '../shared/agentEvents'
import type { AuthState } from '../shared/auth'
import type { UpdateState } from '../shared/updates'
import type { TerminalEvent, TerminalSessionSnapshot, TerminalSessionSummary, TerminalShellPreference } from '../shared/terminal'
import type { ChangeScope, ChangeStatus, WorkspaceChangesResult, WorkspaceChangesSummary, WorkspaceFileDiff } from '../shared/workspaceChanges'
import type { ExtensionRef } from '../shared/extensions'
import type { ExtensionCatalog, McpServerDefinition, SkillCatalogItem } from '../shared/extensionCatalog'
import type { SubagentEvent, SubagentSnapshot } from '../shared/subagents'

const api = {
  platform: process.platform,
  auth: {
    getState: (): Promise<AuthState> => ipcRenderer.invoke('auth:getState'),
    login: (): Promise<AuthState> => ipcRenderer.invoke('auth:login'),
    cancelLogin: (): Promise<AuthState> => ipcRenderer.invoke('auth:cancelLogin'),
    refresh: (): Promise<AuthState> => ipcRenderer.invoke('auth:refresh'),
    logout: (): Promise<AuthState> => ipcRenderer.invoke('auth:logout'),
    onStateChanged: (callback: (state: AuthState) => void): (() => void) => {
      const listener = (_: any, state: AuthState) => callback(state)
      ipcRenderer.on('auth:stateChanged', listener)
      return () => ipcRenderer.removeListener('auth:stateChanged', listener)
    }
  },
  updates: {
    getState: (): Promise<UpdateState> => ipcRenderer.invoke('updates:getState'),
    check: (): Promise<UpdateState> => ipcRenderer.invoke('updates:check'),
    openDownload: (): Promise<void> => ipcRenderer.invoke('updates:openDownload'),
    onStateChanged: (callback: (state: UpdateState) => void): (() => void) => {
      const listener = (_: unknown, state: UpdateState) => callback(state)
      ipcRenderer.on('updates:stateChanged', listener)
      return () => ipcRenderer.removeListener('updates:stateChanged', listener)
    }
  },
  storage: {
    get: (key: string): { value?: string | null; exists?: boolean; error?: boolean } => ipcRenderer.sendSync('storage:get', key),
    set: (key: string, value: string | null): { ok?: boolean; error?: boolean } => ipcRenderer.sendSync('storage:set', key, value),
    keys: (): { keys?: string[]; error?: boolean } => ipcRenderer.sendSync('storage:keys'),
    prepareCheckpoint: (sessionId: string, messages: unknown[]): Promise<{ status: 'ready' | 'missing' | 'superseded' | 'error'; token?: string; error?: string }> =>
      ipcRenderer.invoke('storage:prepareCheckpoint', { sessionId, messages }),
    commitCheckpoint: (token: string): { status: 'saved' | 'missing' | 'superseded' | 'error' } => ipcRenderer.sendSync('storage:commitCheckpoint', token),
    discardCheckpoint: (token: string): void => ipcRenderer.send('storage:discardCheckpoint', token),
    onCheckpointBackupError: (callback: () => void): (() => void) => {
      const listener = (): void => callback()
      ipcRenderer.on('storage:checkpointBackupError', listener)
      return () => ipcRenderer.removeListener('storage:checkpointBackupError', listener)
    }
  },
  plugins: {
    list: (legacy: string[]): Promise<string[]> => ipcRenderer.invoke('plugins:list', legacy),
    setInstalled: (id: string, installed: boolean): Promise<string[]> => ipcRenderer.invoke('plugins:setInstalled', id, installed)
  },
  extensions: {
    list: (workspacePath?: string): Promise<ExtensionCatalog> => ipcRenderer.invoke('extensions:list', workspacePath),
    importSkill: (): Promise<SkillCatalogItem | null> => ipcRenderer.invoke('extensions:importSkill')
  },
  mcp: {
    addServer: (definition: McpServerDefinition, auth?: { headerName: string; headerValue: string }): Promise<unknown> => ipcRenderer.invoke('mcp:addServer', definition, auth),
    setAuth: (serverId: string, headerName: string, headerValue: string): Promise<boolean> => ipcRenderer.invoke('mcp:setAuth', { serverId, headerName, headerValue }),
    connect: (serverId: string): Promise<unknown> => ipcRenderer.invoke('mcp:connect', serverId),
    disconnect: (serverId: string): Promise<unknown> => ipcRenderer.invoke('mcp:disconnect', serverId),
    removeServer: (serverId: string): Promise<boolean> => ipcRenderer.invoke('mcp:removeServer', serverId),
    revokeToolTrust: (serverId: string, toolId: string): Promise<boolean> => ipcRenderer.invoke('mcp:revokeToolTrust', serverId, toolId),
  },
  secrets: {
    get: (key: string): { value?: string; error?: string } => ipcRenderer.sendSync('secrets:get', key),
    set: (key: string, value: string): { ok?: boolean; error?: string } => ipcRenderer.sendSync('secrets:set', { key, value })
  },
  minimize: (): void => ipcRenderer.send('window:minimize'),
  maximize: (): void => ipcRenderer.send('window:maximize'),
  close: (): void => ipcRenderer.send('window:close'),
  zoomIn: (): void => webFrame.setZoomFactor(Number((webFrame.getZoomFactor() + 0.1).toFixed(2))),
  zoomOut: (): void => webFrame.setZoomFactor(Math.max(0.6, Number((webFrame.getZoomFactor() - 0.1).toFixed(2)))),
  resetZoom: (): void => webFrame.setZoomFactor(1),
  getZoom: (): number => webFrame.getZoomFactor(),
  agent: {
    chat: (history: any[], settings: any, requestId: string, agentId?: string, sessionId?: string, extensionRefs?: ExtensionRef[]): void =>
      ipcRenderer.send('agent:chat', { history, settings, requestId, agentId, sessionId, extensionRefs }),
    steer: (requestId: string, sessionId: string, text: string): void =>
      ipcRenderer.send('agent:steer', { requestId, sessionId, text }),
    resume: (sessionId: string, settings: any, requestId: string, agentId?: string, fallbackHistory?: AgentHistoryMessage[], extensionRefs?: ExtensionRef[]): void =>
      ipcRenderer.send('agent:resume', { sessionId, settings, requestId, agentId, fallbackHistory, extensionRefs }),
    getJournal: (sessionId: string): Promise<any> =>
      ipcRenderer.invoke('agent:getJournal', { sessionId }),
    listSubagents: (sessionId: string): Promise<SubagentSnapshot[]> =>
      ipcRenderer.invoke('agent:subagents:list', sessionId),
    controlSubagent: (sessionId: string, agentId: string, action: 'stop' | 'interrupt' | 'resume'): Promise<SubagentSnapshot> =>
      ipcRenderer.invoke('agent:subagents:control', { sessionId, agentId, action }),
    onSubagentEvent: (callback: (event: SubagentEvent) => void): (() => void) => {
      const listener = (_: unknown, event: SubagentEvent) => callback(event)
      ipcRenderer.on('agent:subagent', listener)
      return () => ipcRenderer.removeListener('agent:subagent', listener)
    },
    discardSession: (sessionId: string): void => ipcRenderer.send('agent:discardSession', { sessionId }),
    cancel: (requestId: string): void => ipcRenderer.send('agent:cancel', { requestId }),
    approve: (requestId: string, approvalId: string, approved: boolean, trustTool = false): void => ipcRenderer.send('agent:approval', { requestId, approvalId, approved, trustTool }),
    answer: (requestId: string, questionId: string, answer: QuestionAnswer): void => ipcRenderer.send('agent:answer', { requestId, questionId, answer }),
    answerUncensoredMode: (requestId: string, sessionId: string, promptId: string, enabled: boolean): void => ipcRenderer.send('agent:uncensoredModeAnswer', { requestId, sessionId, promptId, enabled }),
    explainCommand: (requestId: string, approvalId: string): Promise<{ explanation?: string; error?: string }> =>
      ipcRenderer.invoke('agent:explainCommand', { requestId, approvalId }),
    generateTitle: (userMessage: string, settings: any): Promise<string | null> =>
      ipcRenderer.invoke('agent:generateTitle', { userMessage, settings }),
    onEvent: (callback: (event: any) => void): (() => void) => {
      const listener = (_: any, event: any) => callback(event)
      ipcRenderer.on('agent:event', listener)
      return () => {
        ipcRenderer.removeListener('agent:event', listener)
      }
    },
    removeListeners: (): void => {
      ipcRenderer.removeAllListeners('agent:event')
    }
  },
  workspace: {
    listFiles: (folderPath: string, relativePath: string) => ipcRenderer.invoke('workspace:listFiles', { folderPath, relativePath }),
    readText: (folderPath: string, relativePath: string) => ipcRenderer.invoke('workspace:readText', { folderPath, relativePath }),
    readPreview: (folderPath: string, relativePath: string) => ipcRenderer.invoke('workspace:readPreview', { folderPath, relativePath }),
    revealFile: (folderPath: string, relativePath: string) => ipcRenderer.invoke('workspace:revealFile', { folderPath, relativePath }),
    writeText: (folderPath: string, relativePath: string, expected: string, content: string, sessionId?: string) => ipcRenderer.invoke('workspace:writeText', { folderPath, relativePath, expected, content, sessionId }),
    diagnostics: (folderPath: string, relativePath: string, runServer = false, sourceText?: string) => ipcRenderer.invoke('workspace:diagnostics', { folderPath, relativePath, runServer, sourceText }),
    cancelDiagnostics: () => ipcRenderer.send('workspace:cancelDiagnostics'),
    exportArchive: (sessions: any[]): Promise<{ bytes?: Uint8Array; error?: string }> => ipcRenderer.invoke('workspace:exportArchive', sessions),
    importArchive: (bytes: Uint8Array): Promise<{ sessions?: any[]; error?: string }> => ipcRenderer.invoke('workspace:importArchive', bytes),
    saveDocument: (folderPath: string, name: string, bytes: Uint8Array): Promise<{ attachment?: { name: string; path: string }; error?: string }> =>
      ipcRenderer.invoke('workspace:saveDocument', { folderPath, name, bytes }),
    saveImage: (folderPath: string, name: string, bytes: Uint8Array): Promise<{ attachment?: { name: string; path: string }; error?: string }> =>
      ipcRenderer.invoke('workspace:saveImage', { folderPath, name, bytes }),
    readImage: (folderPath: string, imagePath: string): Promise<{ dataUrl?: string; error?: string }> =>
      ipcRenderer.invoke('workspace:readImage', { folderPath, imagePath }),
    loadSessions: (): { sessions: any[]; errors: string[] } => ipcRenderer.sendSync('workspace:loadSessions'),
    defaultDir: ipcRenderer.sendSync('workspace:defaultDir') as string,
    create: (sessionId: string, title?: string, customPath?: string): Promise<{ success: boolean; folderPath?: string; error?: string }> =>
      ipcRenderer.invoke('workspace:create', { sessionId, title, customPath }),
    saveSession: (session: any): Promise<{ success: boolean; error?: string }> =>
      ipcRenderer.invoke('workspace:saveSession', { session }),
    deleteSession: (sessionId: string): Promise<{ success: boolean; error?: string }> =>
      ipcRenderer.invoke('workspace:deleteSession', { sessionId }),
    selectFolder: (): Promise<string | null> =>
      ipcRenderer.invoke('workspace:selectFolder'),
    openFolder: (folderPath: string): Promise<{ success: boolean; error?: string }> =>
      ipcRenderer.invoke('workspace:openFolder', { folderPath }),
    getDefaultDir: (): Promise<string> =>
      ipcRenderer.invoke('workspace:getDefaultDir'),
    watch: (folderPath: string): void => ipcRenderer.send('workspace:watch', { folderPath }),
    unwatch: (folderPath: string): void => ipcRenderer.send('workspace:unwatch', { folderPath }),
    onUpdated: (callback: (payload: { folderPath: string }) => void): (() => void) => {
      const listener = (_: unknown, payload: { folderPath: string }) => callback(payload)
      ipcRenderer.on('workspace:updated', listener)
      return () => ipcRenderer.removeListener('workspace:updated', listener)
    }
  },
  terminal: {
    list: (sessionId: string, workspace?: string): Promise<TerminalSessionSummary[]> =>
      ipcRenderer.invoke('terminal:list', { sessionId, workspace }),
    getAiLog: (sessionId: string): Promise<string> =>
      ipcRenderer.invoke('terminal:getAiLog', { sessionId }),
    create: (sessionId: string, workspace?: string, cols?: number, rows?: number, shell?: TerminalShellPreference): Promise<TerminalSessionSnapshot> =>
      ipcRenderer.invoke('terminal:create', { sessionId, workspace, cols, rows, shell }),
    attach: (sessionId: string, terminalId: string, workspace?: string): Promise<TerminalSessionSnapshot> =>
      ipcRenderer.invoke('terminal:attach', { sessionId, workspace, terminalId }),
    write: (sessionId: string, terminalId: string, chars: string, workspace?: string): void =>
      ipcRenderer.send('terminal:write', { sessionId, workspace, terminalId, chars }),
    resize: (sessionId: string, terminalId: string, cols: number, rows: number, workspace?: string): void =>
      ipcRenderer.send('terminal:resize', { sessionId, workspace, terminalId, cols, rows }),
    signal: (sessionId: string, terminalId: string, signal: 'SIGINT' | 'SIGKILL', workspace?: string): Promise<{ ok: boolean }> =>
      ipcRenderer.invoke('terminal:signal', { sessionId, workspace, terminalId, signal }),
    close: (sessionId: string, terminalId: string, workspace?: string): Promise<{ ok: boolean }> =>
      ipcRenderer.invoke('terminal:close', { sessionId, workspace, terminalId }),
    onEvent: (callback: (payload: { sessionId: string; workspace: string; event: TerminalEvent }) => void): (() => void) => {
      const listener = (_: unknown, payload: { sessionId: string; workspace: string; event: TerminalEvent }) => callback(payload)
      ipcRenderer.on('terminal:event', listener)
      return () => ipcRenderer.removeListener('terminal:event', listener)
    }
  },
  changes: {
    getSummary: (sessionId: string, folderPath: string, includeNoise = false): Promise<WorkspaceChangesResult<WorkspaceChangesSummary>> =>
      ipcRenderer.invoke('changes:getSummary', { sessionId, folderPath, includeNoise }),
    getFileDiff: (
      sessionId: string,
      folderPath: string,
      filePath: string,
      scope: ChangeScope,
      status: ChangeStatus
    ): Promise<WorkspaceChangesResult<WorkspaceFileDiff>> =>
      ipcRenderer.invoke('changes:getFileDiff', { sessionId, folderPath, filePath, scope, status }),
    stage: (folderPath: string, paths: string[]): Promise<WorkspaceChangesResult<boolean>> =>
      ipcRenderer.invoke('changes:stage', { folderPath, paths }),
    unstage: (folderPath: string, paths: string[]): Promise<WorkspaceChangesResult<boolean>> =>
      ipcRenderer.invoke('changes:unstage', { folderPath, paths }),
    discard: (
      sessionId: string,
      folderPath: string,
      filePath: string,
      scope: ChangeScope,
      status: ChangeStatus
    ): Promise<WorkspaceChangesResult<boolean>> =>
      ipcRenderer.invoke('changes:discard', { sessionId, folderPath, filePath, scope, status }),
    discardAll: (
      sessionId: string,
      folderPath: string,
      onlyChatTouched = false
    ): Promise<WorkspaceChangesResult<{ discarded: number }>> =>
      ipcRenderer.invoke('changes:discardAll', { sessionId, folderPath, onlyChatTouched }),
    revertHunk: (
      sessionId: string,
      folderPath: string,
      filePath: string,
      scope: ChangeScope,
      hunkIndex: number
    ): Promise<WorkspaceChangesResult<boolean>> =>
      ipcRenderer.invoke('changes:revertHunk', { sessionId, folderPath, filePath, scope, hunkIndex }),
    commit: (folderPath: string, message: string): Promise<WorkspaceChangesResult<{ sha: string }>> =>
      ipcRenderer.invoke('changes:commit', { folderPath, message }),
    initRepo: (folderPath: string): Promise<WorkspaceChangesResult<boolean>> =>
      ipcRenderer.invoke('changes:initRepo', { folderPath }),
    watch: (folderPath: string): void => ipcRenderer.send('changes:watch', { folderPath }),
    unwatch: (folderPath: string): void => ipcRenderer.send('changes:unwatch', { folderPath }),
    onUpdated: (callback: (payload: { folderPath: string }) => void): (() => void) => {
      const listener = (_: unknown, payload: { folderPath: string }) => callback(payload)
      ipcRenderer.on('changes:updated', listener)
      return () => ipcRenderer.removeListener('changes:updated', listener)
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
  // @ts-ignore
  window.api = api
}

