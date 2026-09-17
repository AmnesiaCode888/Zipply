export type ActivityActionType =
  | 'file_create'
  | 'file_edit'
  | 'file_delete'
  | 'terminal_command'
  | 'tool_other'

export interface ActivityItem {
  id: string
  type: ActivityActionType
  timestamp: number
  title: string
  description?: string
  filePath?: string
  isNew?: boolean
  oldContent?: string
  newContent?: string
  diffStats?: {
    add: number
    del: number
  }
  command?: string
  cwd?: string
  toolName?: string
  status?: 'success' | 'error'
}
