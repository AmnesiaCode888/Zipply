import type { AgentHistoryMessage, AgentRunSummary, PlanStep } from '../../../shared/agentEvents'
import type { ExtensionRef } from '../../../shared/extensions'
export type MessageRole = 'user' | 'assistant'

export type ToolType = 'file_edit' | 'terminal' | 'file_read' | 'search' | 'thinking' | 'folder'

export interface ToolCall {
  id: string
  toolName?: string
  analysisDetail?: string
  processResult?: { id: string; status: string; output?: string; exitCode?: number | null; signal?: string | null; truncated?: boolean } | Array<{ id: string; status: string; command: string; cwd: string }>
  activity?: string
  type: ToolType
  label: string // e.g. "Терминал", "Написал", "Прочитал", "Поиск"
  targetName?: string // e.g. "File.cs", "npm run build"
  filePaths?: string[] // Individual paths for a batched read
  patchFiles?: Array<{ path: string; action: string; diff: string }>
  diff?: { added?: number; removed?: number }
  baseline?: string
  streamTarget?: string
  content?: string
  toolData?: unknown
  executionStarted?: boolean
  processLastOutputAt?: number
  status?: 'running' | 'completed' | 'error'
  defaultExpanded?: boolean
}

export type MessageBlock =
  | {
      type: 'thinking'
      id: string
      roundId?: string
      content: string
      startedAt?: number
      durationSec?: number
      isStreaming?: boolean
    }
  | {
      type: 'text'
      id: string
      roundId?: string
      isActivity?: boolean
      content: string
      isStreaming?: boolean
    }
  | {
      type: 'tool'
      id: string
      roundId?: string
      tool: ToolCall
    }

export interface ImageAttachment { name: string; path: string }

export interface Message {
  planMode?: boolean
  isProgressUpdate?: boolean
  contextStatus?: { estimatedTokens: number; limit: number; compacted: boolean }
  runSummary?: AgentRunSummary
  plan?: PlanStep[]
  attachments?: ImageAttachment[]
  /** Turn-scoped extension references; expanded content is resolved in the main process. */
  extensionRefs?: ExtensionRef[]
  activeFileToolId?: string
  agentHistory?: AgentHistoryMessage[]
  id: string
  role: MessageRole
  content?: string
  tools?: ToolCall[]
  blocks?: MessageBlock[]
  isStreaming?: boolean
}

export interface ChatSession {
  id: string
  title: string
  createdAt: number
  updatedAt: number
  messages: Message[]
  folderPath?: string
  uncensoredMode?: boolean
}

