export interface AgentUsage {
  promptTokens: number
  completionTokens: number
  totalTokens: number
}

export interface AgentToolProgress {
  message?: string
  elapsedSeconds?: number
  statusText?: string
  innerSteps?: unknown[]
  [key: string]: unknown
}

export type AgentEvent =
  | { type: 'token'; content: string; requestId?: string }
  | { type: 'reasoning'; content: string; requestId?: string }
  | {
      type: 'tool_start'
      callId: string
      toolName: string
      args: Record<string, unknown>
      requestId?: string
    }
  | ({
      type: 'tool_progress'
      callId: string
      message?: string
      elapsedSeconds?: number
      statusText?: string
      innerSteps?: unknown[]
      data?: unknown
      requestId?: string
    })
  | {
      type: 'tool_result'
      callId: string
      result: string
      error?: boolean
      data?: unknown
      requestId?: string
    }
  | { type: 'done'; usage?: AgentUsage; requestId?: string }
  | { type: 'error'; message: string; requestId?: string }
  | {
      type: 'watchdog'
      status: 'warn' | 'intervene'
      message: string
      toolCount: number
      requestId?: string
    }
