import type { AgentEvent, AgentHistoryMessage, QuestionAnswer } from '../shared/agentEvents'
import type { AuthState } from '../shared/auth'
import type { UpdateState } from '../shared/updates'
import type { TerminalEvent, TerminalSessionSnapshot, TerminalSessionSummary, TerminalShellPreference } from '../shared/terminal'
import type { ChangeScope, ChangeStatus, WorkspaceChangesResult, WorkspaceChangesSummary, WorkspaceFileDiff } from '../shared/workspaceChanges'
import type { ExtensionRef } from '../shared/extensions'
import type { ExtensionCatalog, McpServerDefinition, SkillCatalogItem } from '../shared/extensionCatalog'
import type { SubagentEvent, SubagentSnapshot } from '../shared/subagents'

export interface WindowApi {
  platform?: NodeJS.Platform
  auth: {
    getState: () => Promise<AuthState>
    login: () => Promise<AuthState>
    cancelLogin: () => Promise<AuthState>
    refresh: () => Promise<AuthState>
    logout: () => Promise<AuthState>
    onStateChanged: (callback: (state: AuthState) => void) => () => void
  }
  updates?: {
    getState: () => Promise<UpdateState>
    check: () => Promise<UpdateState>
    openDownload: () => Promise<void>
    onStateChanged: (callback: (state: UpdateState) => void) => () => void
  }
  storage: {
    get: (key: string) => { value?: string | null; exists?: boolean; error?: boolean }
    set: (key: string, value: string | null) => { ok?: boolean; error?: boolean }
    keys: () => { keys?: string[]; error?: boolean }
    prepareCheckpoint?: (sessionId: string, messages: unknown[]) => Promise<{ status: 'ready' | 'missing' | 'superseded' | 'error'; token?: string; error?: string }>
    commitCheckpoint?: (token: string) => { status: 'saved' | 'missing' | 'superseded' | 'error' }
    discardCheckpoint?: (token: string) => void
    onCheckpointBackupError?: (callback: () => void) => () => void
  }
  plugins: {
    list: (legacy: string[]) => Promise<string[]>
    setInstalled: (id: string, installed: boolean) => Promise<string[]>
  }
  extensions: {
    list: (workspacePath?: string) => Promise<ExtensionCatalog>
    importSkill: () => Promise<SkillCatalogItem | null>
  }
  mcp: {
    addServer: (definition: McpServerDefinition, auth?: { headerName: string; headerValue: string }) => Promise<unknown>
    setAuth: (serverId: string, headerName: string, headerValue: string) => Promise<boolean>
    connect: (serverId: string) => Promise<unknown>
    disconnect: (serverId: string) => Promise<unknown>
    removeServer: (serverId: string) => Promise<boolean>
    revokeToolTrust: (serverId: string, toolId: string) => Promise<boolean>
  }
  secrets: {
    get: (key: string) => { value?: string; error?: string }
    set: (key: string, value: string) => { ok?: boolean; error?: string }
  }
  minimize: () => void
  maximize: () => void
  close: () => void
  zoomIn?: () => void
  zoomOut?: () => void
  resetZoom?: () => void
  getZoom?: () => number
  agent: {
    chat: (history: any[], settings: any, requestId: string, agentId?: string, sessionId?: string, extensionRefs?: ExtensionRef[]) => void
    steer?: (requestId: string, sessionId: string, text: string) => void
    resume?: (sessionId: string, settings: any, requestId: string, agentId?: string, fallbackHistory?: AgentHistoryMessage[], extensionRefs?: ExtensionRef[]) => void
    getJournal?: (sessionId: string) => Promise<any>
    listSubagents: (sessionId: string) => Promise<SubagentSnapshot[]>
    controlSubagent: (sessionId: string, agentId: string, action: 'stop' | 'interrupt' | 'resume') => Promise<SubagentSnapshot>
    onSubagentEvent: (callback: (event: SubagentEvent) => void) => () => void
    discardSession: (sessionId: string) => void
    cancel: (requestId: string) => void
    approve: (requestId: string, approvalId: string, approved: boolean, trustTool?: boolean) => void
    answer: (requestId: string, questionId: string, answer: QuestionAnswer) => void
    answerUncensoredMode: (requestId: string, sessionId: string, promptId: string, enabled: boolean) => void
    explainCommand: (requestId: string, approvalId: string) => Promise<{ explanation?: string; error?: string }>
    generateTitle: (userMessage: string, settings: any) => Promise<string | null>
    onEvent: (callback: (event: AgentEvent) => void) => () => void
    removeListeners: () => void
  }
  workspace: {
    listFiles: (folderPath: string, relativePath: string) => Promise<import('../shared/workspaceFiles').WorkspaceFilesResult<import('../shared/workspaceFiles').WorkspaceFileEntry[]>>
    readText: (folderPath: string, relativePath: string) => Promise<import('../shared/workspaceFiles').WorkspaceFilesResult<string>>
    readPreview?: (folderPath: string, relativePath: string) => Promise<import('../shared/workspaceFiles').WorkspaceFilesResult<import('../shared/workspaceFiles').WorkspaceFilePreview>>
    revealFile?: (folderPath: string, relativePath: string) => Promise<import('../shared/workspaceFiles').WorkspaceFilesResult<boolean>>
    writeText: (folderPath: string, relativePath: string, expected: string, content: string, sessionId?: string) => Promise<import('../shared/workspaceFiles').WorkspaceFilesResult<boolean>>
    diagnostics: (folderPath: string, relativePath: string, runServer?: boolean, sourceText?: string) => Promise<import('../shared/workspaceFiles').WorkspaceFilesResult<import('../shared/workspaceFiles').WorkspaceDiagnostics>>
    cancelDiagnostics: () => void
    exportArchive: (sessions: any[]) => Promise<{ bytes?: Uint8Array; error?: string }>
    importArchive: (bytes: Uint8Array) => Promise<{ sessions?: any[]; error?: string }>
    saveDocument: (folderPath: string, name: string, bytes: Uint8Array) => Promise<{ attachment?: { name: string; path: string }; error?: string }>
    saveImage: (folderPath: string, name: string, bytes: Uint8Array) => Promise<{ attachment?: { name: string; path: string }; error?: string }>
    readImage: (folderPath: string, imagePath: string) => Promise<{ dataUrl?: string; error?: string }>
    loadSessions: () => { sessions: any[]; errors: string[] }
    defaultDir: string
    create: (
      sessionId: string,
      title?: string,
      customPath?: string
    ) => Promise<{ success: boolean; folderPath?: string; error?: string }>
    saveSession: (session: any) => Promise<{ success: boolean; error?: string }>
    deleteSession: (sessionId: string) => Promise<{ success: boolean; error?: string }>
    selectFolder: () => Promise<string | null>
    openFolder: (folderPath: string) => Promise<{ success: boolean; error?: string }>
    getDefaultDir: () => Promise<string>
    watch?: (folderPath: string) => void
    unwatch?: (folderPath: string) => void
    onUpdated?: (callback: (payload: { folderPath: string }) => void) => () => void
  }
  terminal?: {
    list: (sessionId: string, workspace?: string) => Promise<TerminalSessionSummary[]>
    getAiLog?: (sessionId: string) => Promise<string>
    create: (sessionId: string, workspace?: string, cols?: number, rows?: number, shell?: TerminalShellPreference) => Promise<TerminalSessionSnapshot>
    attach: (sessionId: string, terminalId: string, workspace?: string) => Promise<TerminalSessionSnapshot>
    write: (sessionId: string, terminalId: string, chars: string, workspace?: string) => void
    resize: (sessionId: string, terminalId: string, cols: number, rows: number, workspace?: string) => void
    signal: (sessionId: string, terminalId: string, signal: 'SIGINT' | 'SIGKILL', workspace?: string) => Promise<{ ok: boolean }>
    close: (sessionId: string, terminalId: string, workspace?: string) => Promise<{ ok: boolean }>
    onEvent: (callback: (payload: { sessionId: string; workspace: string; event: TerminalEvent }) => void) => () => void
  }
  changes?: {
    getSummary: (sessionId: string, folderPath: string, includeNoise?: boolean) => Promise<WorkspaceChangesResult<WorkspaceChangesSummary>>
    getFileDiff: (
      sessionId: string,
      folderPath: string,
      filePath: string,
      scope: ChangeScope,
      status: ChangeStatus
    ) => Promise<WorkspaceChangesResult<WorkspaceFileDiff>>
    stage: (folderPath: string, paths: string[]) => Promise<WorkspaceChangesResult<boolean>>
    unstage: (folderPath: string, paths: string[]) => Promise<WorkspaceChangesResult<boolean>>
    discard: (
      sessionId: string,
      folderPath: string,
      filePath: string,
      scope: ChangeScope,
      status: ChangeStatus
    ) => Promise<WorkspaceChangesResult<boolean>>
    discardAll?: (
      sessionId: string,
      folderPath: string,
      onlyChatTouched?: boolean
    ) => Promise<WorkspaceChangesResult<{ discarded: number }>>
    revertHunk: (
      sessionId: string,
      folderPath: string,
      filePath: string,
      scope: ChangeScope,
      hunkIndex: number
    ) => Promise<WorkspaceChangesResult<boolean>>
    commit: (folderPath: string, message: string) => Promise<WorkspaceChangesResult<{ sha: string }>>
    initRepo: (folderPath: string) => Promise<WorkspaceChangesResult<boolean>>
    watch: (folderPath: string) => void
    unwatch: (folderPath: string) => void
    onUpdated: (callback: (payload: { folderPath: string }) => void) => () => void
  }
}

declare global {
  interface Window {
    api: WindowApi
  }
}

