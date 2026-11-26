export type ChangesMode = 'git' | 'session'

export type ChangeStatus =
  | 'modified'
  | 'added'
  | 'deleted'
  | 'renamed'
  | 'copied'
  | 'untracked'
  | 'conflicted'

export type ChangeScope = 'staged' | 'unstaged' | 'session'

export interface WorkspaceChangeEntry {
  id: string
  path: string
  oldPath?: string
  status: ChangeStatus
  scope: ChangeScope
  added: number | null
  removed: number | null
  isBinary: boolean
  touchedByChat?: boolean
}

export interface WorkspaceChangesSummary {
  mode: ChangesMode
  folderPath: string
  repoRoot?: string
  branch?: string | null
  gitInstalled: boolean
  hasGitFolder: boolean
  truncated?: boolean
  hiddenNoiseCount?: number
  entries: WorkspaceChangeEntry[]
  totals: {
    files: number
    added: number
    removed: number
  }
}

export interface DiffHunkLine {
  type: 'context' | 'add' | 'del'
  oldLine?: number
  newLine?: number
  text: string
}

export interface DiffHunk {
  id: string
  index: number
  header: string
  oldStart: number
  oldLines: number
  newStart: number
  newLines: number
  lines: DiffHunkLine[]
}

export interface WorkspaceFileDiff {
  path: string
  oldPath?: string
  scope: ChangeScope
  status: ChangeStatus
  kind: 'text' | 'binary' | 'too-large' | 'empty'
  hunks: DiffHunk[]
  oldText?: string
  newText?: string
  truncated?: boolean
  warning?: string
}

export type WorkspaceChangesResult<T> = { data: T; error?: never } | { data?: never; error: string }
