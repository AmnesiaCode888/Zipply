export type AgentApprovalKind = 'command' | 'file' | 'network' | 'mcp' | 'mcp_connection'

export interface AgentUsage {
  promptTokens: number
  completionTokens: number
  totalTokens: number
  /** Prompt tokens served from provider KV/prompt cache when reported. */
  cachedTokens?: number
  /** False when at least one provider response did not report usage. */
  complete?: boolean
  /** True when at least one usage value was estimated from serialized text length. */
  estimated?: boolean
  /** Estimation rule used when exact provider usage was unavailable. */
  estimateMethod?: string
}

export type AgentRunReason = 'completed' | 'incomplete' | 'cancelled' | 'error' | 'no_progress' | 'limit_rounds' | 'limit_tokens' | 'limit_time'
export type AgentVerificationStatus = 'verified' | 'unverified' | 'failed'
export type AgentTaskOutcome = 'answered' | 'verified' | 'unverified'
export interface AgentRunCheck {
  toolName: string
  command?: string
  passed: boolean
  result: string
  criterionId?: string
  criterionRevision?: number
  scopeHash?: string
  sourceCallId?: string
  stale?: boolean
  staleReason?: string
}
export interface AgentRunSummary {
  reason: AgentRunReason
  rounds: number
  usage: AgentUsage
  elapsedMs: number
  checks: AgentRunCheck[]
  verificationStatus: AgentVerificationStatus
  taskOutcome?: AgentTaskOutcome
  unverifiedCriteria: string[]
  message?: string
}

export interface AgentHistoryMessage {
  role: 'system' | 'developer' | 'user' | 'assistant' | 'tool'
  content: string | Array<{ type: string; text?: string; image_url?: { url: string } }> | null
  tool_calls?: Array<{ id: string; type: string; function: { name: string; arguments: string } }>
  reasoning_content?: string
  isProgressUpdate?: boolean
  tool_call_id?: string
  name?: string
}

export interface AgentToolProgress {
  message?: string
  elapsedSeconds?: number
  statusText?: string
  innerSteps?: unknown[]
  [key: string]: unknown
}

export type QuestionItem = { question: string; options: string[] }
export type QuestionRequest = QuestionItem | { questions: QuestionItem[] }
export type QuestionAnswer = string | string[] | null

export interface PlanStep {
  step: string
  status: 'pending' | 'in_progress' | 'completed'
}

export type AgentEvent =
  | { type: 'uncensored_mode_prompt'; promptId: string; sessionId: string; requestId: string }
  | { type: 'uncensored_mode_enabled'; requestId?: string }
  | { type: 'context_status'; estimatedTokens: number; limit: number; compacted: boolean; requestId?: string }
  | { type: 'tool_baseline'; callId: string; content: string; requestId?: string }
  | { type: 'approval_request'; approvalId: string; command: string; kind?: AgentApprovalKind; target?: string; cwd?: string; details?: string; serverId?: string; toolId?: string; toolName?: string; requestId?: string }
  | ({ type: 'question_request'; questionId: string; requestId?: string } & QuestionRequest)
  | { type: 'history'; messages: AgentHistoryMessage[]; requestId?: string }
  | { type: 'steer_applied'; content: string; requestId?: string }
  | { type: 'assistant_commentary'; content: string; roundId?: string; requestId?: string }
  | { type: 'token'; content: string; roundId?: string; requestId?: string }
  | { type: 'reasoning'; content: string; roundId?: string; requestId?: string }
  | { type: 'round_end'; roundId: string; hasToolCalls: boolean; requestId?: string }
  | {
      type: 'tool_start'
      callId: string
      toolName: string
      args: Record<string, unknown>
      displayLabel?: string
      displayTarget?: string
      roundId?: string
      requestId?: string
    }
  | {
      type: 'tool_call_stream'
      callId: string
      toolName?: string
      argsDelta?: string
      argsBuffer?: string
      roundId?: string
      requestId?: string
    }
  | ({
      type: 'tool_progress'
      callId: string
      message?: string
      executionStarted?: boolean
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
  | { type: 'run_summary'; summary: AgentRunSummary; requestId?: string }
  | { type: 'plan_update'; plan: PlanStep[]; explanation?: string; requestId?: string }
  | { type: 'done'; usage?: AgentUsage; requestId?: string }
  | { type: 'error'; message: string; requestId?: string }
