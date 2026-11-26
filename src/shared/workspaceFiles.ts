export interface WorkspaceFileEntry { name: string; path: string; kind: 'file' | 'directory' }
export type WorkspaceFilesResult<T> = { data: T; error?: never } | { data?: never; error: string }
export interface WorkspaceDiagnostic { line: number; column: number; endLine?: number; endColumn?: number; message: string; category: string; code?: string | number }
export interface WorkspaceDiagnostics { supported: boolean; items: WorkspaceDiagnostic[]; truncated?: boolean; reason?: string; needsServer?: boolean; scope?: 'syntax' | 'semantic' }
export type WorkspaceFilePreview =
  | { kind: 'text'; text: string; size: number }
  | { kind: 'image'; mime: string; bytes: Uint8Array; size: number }
  | { kind: 'video'; mime: string; bytes: Uint8Array; size: number }
  | { kind: 'too-large'; size: number; maxSize: number; mediaType: 'image' | 'video' | 'text' }
  | { kind: 'binary'; size: number }
