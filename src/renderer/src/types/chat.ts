export type StepType =
  | 'thought'
  | 'read'
  | 'edit'
  | 'run'
  | 'create'
  | 'grep'
  | 'web_search'
  | 'read_page'
  | 'memory'
  | 'schedule'
  | 'ask_agent'
  | 'read_skill'
  | 'save_skill'
  | 'mcp'

export interface StepStats {
  add?: number
  del?: number
}

export interface StepArgs {
  path?: string
  command?: string
  query?: string
  url?: string
  start_line?: number | string
  end_line?: number | string
  old_content?: string
  new_content?: string
  oldContent?: string
  newContent?: string
  action?: string
  prompt?: string
  agent_id?: string
  content?: string
  category?: string
  [key: string]: unknown
}

export interface StepItem {
  id: string
  type: StepType
  action: string
  target?: string
  durationSeconds?: number
  stats?: StepStats
  isDone: boolean
  result?: string
  args?: StepArgs
  data?: unknown
  error?: boolean
}

export interface ToolRoundSegment {
  type: 'tool_round'
  id: string
  steps: StepItem[]
  isThinking?: boolean
  totalWorkedSeconds?: number
  summary?: string
}

export interface TextSegment {
  type: 'text'
  id: string
  content: string
}

export interface SwarmSubagentItem {
  agentId: string
  agentName?: string
  prompt?: string
  answer?: string
  partialAnswer?: string
  steps: StepItem[]
  totalWorkedSeconds?: number
  summary?: string
  isThinking?: boolean
  error?: boolean
}

export interface SubagentRoundSegment {
  type: 'subagent_round'
  id: string
  callId: string
  agentId: string
  agentName?: string
  prompt?: string
  context?: string
  isThinking?: boolean
  totalWorkedSeconds?: number
  summary?: string
  steps: StepItem[]
  answer?: string
  partialAnswer?: string
  error?: boolean
  isSwarm?: boolean
  swarmResults?: SwarmSubagentItem[]
}

export interface WatchdogSegment {
  type: 'watchdog'
  id: string
  status: 'warn' | 'intervene'
  message: string
  toolCount: number
  resolved?: boolean  // set to true when the session completes — dims the card
}

export type MessageSegment = TextSegment | ToolRoundSegment | SubagentRoundSegment | WatchdogSegment

export interface AttachedImage {
  id: string
  name: string
  dataUrl: string
  size?: number
}

export interface ChatMessage {
  id: string
  role: 'user' | 'assistant'
  text?: string // user prompt or simple text fallback
  images?: AttachedImage[] // attached images if any
  segments?: MessageSegment[] // Interleaved text & tool rounds for Re-Act agent
  isThinking?: boolean
}

/**
 * A project = a working folder bound to a chat. The agent operates inside
 * `path` for every turn of that chat (workspacePath).
 */
export interface ProjectRef {
  name: string
  path: string
  lastUsedAt?: number
}

export interface ChatSession {
  id: string
  title: string
  dateGroup?: 'Сегодня' | 'Вчера' | 'СЕГОДНЯ' | 'ВЧЕРА' | string
  messages: ChatMessage[]
  project?: ProjectRef
}
