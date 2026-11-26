import type { AttachmentResolutionMap } from '../../core/AttachmentResolver'
import type { AgentTaskState } from '../../core/Blackboard'
import type { ResponsesOutputItem } from '../../core/ContextCompactor'
import type { JournalToolStart, JournalToolResult, RunJournalCheckpoint } from '../../core/RunJournal'
import type { QuestionAnswer, QuestionRequest } from '../../../../shared/agentEvents'
import type { TerminalShellPreference } from '../../../../shared/terminal'
import type { ExtensionRef } from '../../../../shared/extensions'

export interface ChatConfig {
  baseUrl?: string
  apiKey?: string
  model?: string
  fastModel?: string
  classifierModel?: string
  uncensoredMode?: boolean
  classifyUncensoredMode?: boolean
  /** User-authored text before attachment metadata is added to history. */
  latestUserText?: string
  promptUncensoredMode?: () => Promise<boolean>
  askUser?: (request: QuestionRequest) => Promise<QuestionAnswer>
  temperature?: number
  maxTokens?: number
  contextLength?: number
  stream?: boolean
  reasoningEffort?: string
  requestTransport?: typeof fetch
  tavilyKey?: string
  systemPrompt?: string
  workspacePath?: string
  terminalShell?: TerminalShellPreference
  taskState?: AgentTaskState
  attachmentMeta?: AttachmentResolutionMap
  consumeSteers?: () => string[]
  resumeContext?: string
  resumeHasAppliedMutation?: boolean
  onRunCheckpoint?: (checkpoint: RunJournalCheckpoint) => Promise<void>
  onMutationStart?: (call: JournalToolStart, checkpoint?: RunJournalCheckpoint) => Promise<string | undefined>
  onMutationResult?: (result: JournalToolResult, checkpoint?: RunJournalCheckpoint) => Promise<void>
  runLimits?: { rounds?: number; tokens?: number; timeMs?: number }
  apiMode?: 'chat_completions' | 'responses'
  promptCacheKey?: string
  /** Validated by main IPC and scoped to this one turn. */
  extensionRefs?: ExtensionRef[]
  /** Main-process-only, one-turn context resolved from selected extensions. */
  extensionRuntimeContext?: string
  /** Canonical external directories (e.g., activated skill folders) readable without confirmation. */
  allowedExternalReadRoots?: string[]
  /** Main-process-only owner identity for subagent IPC scoping. */
  subagentOwner?: { senderId: number; sessionId?: string }
  /** Read-only dependency roots inherited by an isolated child worktree. */
  subagentDependencyPaths?: string[]
  [key: string]: unknown
}

export interface ToolCallChunk {
  id: string
  name: string
  argumentsJson: string
  streamId?: string
}

export interface ChatResponseUsage {
  promptTokens: number
  completionTokens: number
  totalTokens: number
  cachedTokens?: number
  complete?: boolean
}

export type ChatResponseStatus = 'completed' | 'incomplete' | 'truncated_stream'

export interface ChatResponse {
  content: string
  reasoningContent: string
  toolCalls: ToolCallChunk[]
  responsesOutput?: readonly ResponsesOutputItem[]
  usage?: ChatResponseUsage
  status: ChatResponseStatus
  finishReason?: string
  incompleteReason?: string
}

export interface OpenAiToolDefinition {
  type: 'function'
  function: {
    name: string
    description: string
    parameters: Record<string, unknown> & {
      type: 'object'
      properties: Record<string, unknown>
      required?: string[]
    }
  }
}

export function normalizeUsage(usage: any): ChatResponseUsage | undefined {
  if (!usage || typeof usage !== 'object') return undefined
  const isCount = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0
  const hasPrompt = isCount(usage.prompt_tokens) || isCount(usage.input_tokens)
  const hasCompletion = isCount(usage.completion_tokens) || isCount(usage.output_tokens)
  const promptTokens = isCount(usage.prompt_tokens)
    ? usage.prompt_tokens
    : isCount(usage.input_tokens) ? usage.input_tokens : 0
  const completionTokens = isCount(usage.completion_tokens)
    ? usage.completion_tokens
    : isCount(usage.output_tokens) ? usage.output_tokens : 0
  const totalTokens = isCount(usage.total_tokens) ? usage.total_tokens : 0
  const cachedTokens = isCount(usage.prompt_tokens_details?.cached_tokens)
    ? usage.prompt_tokens_details.cached_tokens
    : isCount(usage.input_tokens_details?.cached_tokens)
      ? usage.input_tokens_details.cached_tokens
      : isCount(usage.cache_read_input_tokens)
        ? usage.cache_read_input_tokens
        : undefined
  return {
    promptTokens,
    completionTokens,
    totalTokens,
    ...(cachedTokens !== undefined ? { cachedTokens } : {}),
    complete: hasPrompt && hasCompletion && isCount(usage.total_tokens)
  }
}

export function usesResponsesApi(config?: ChatConfig): boolean {
  return config?.apiMode === 'responses' || /\/responses\/*$/.test(config?.baseUrl || '')
}
