import { Blackboard } from '../core/Blackboard'
import type { AgentApprovalKind } from '../../../shared/agentEvents'

export interface ToolParameterDef {
  type: string
  description: string
  required?: boolean
  enum?: string[]
  minimum?: number
  maximum?: number
  minLength?: number
  maxLength?: number
  minItems?: number
  maxItems?: number
  items?: Record<string, unknown>
  properties?: Record<string, ToolParameterDef>
  default?: unknown
}

export interface ToolResult {
  formattedContent: string
  /** Optional concise renderer-only text; model output remains formattedContent. */
  displayContent?: string
  data?: unknown
  error?: boolean | string
  success?: boolean
  noTruncate?: boolean
  images?: string[]
}

export interface ToolExecutionPolicy {
  mutates: boolean
  parallelSafe: boolean
  cacheable: boolean
  /** False for tools that may have external side effects (e.g. launching an LSP) without modifying workspace files. */
  modifiesFiles?: boolean
  /** True for user-safe skill management tools that should not pop up a confirmation dialog in confirm mode. */
  skipApproval?: boolean
}

export interface ToolApprovalRequest {
  kind: AgentApprovalKind
  /** Whether an explicit tool approval always wins or follows the selected access mode. */
  approvalPolicy?: 'always' | 'respect_access_mode'
  command: string
  target?: string
  cwd?: string
  details?: string
  serverId?: string
  toolId?: string
  toolName?: string
  trustFingerprint?: string
}

export interface ToolDisplayInfo {
  label: string
  targetName?: string
}

export type ProgressCallback = (progress: {
  message?: string
  elapsedSeconds?: number
  statusText?: string
  [key: string]: unknown
}) => void

/**
 * ToolBase — Abstract base class for all agent tools.
 */
export abstract class ToolBase {
  abstract get name(): string
  abstract get description(): string

  /** Complete provider schema for tools whose JSON Schema cannot be represented by ToolParameterDef. */
  getInputSchema?(): Record<string, unknown> | undefined

  get parameters(): Record<string, ToolParameterDef> {
    return {}
  }

  getExecutionPolicy(_args: Record<string, unknown> = {}): ToolExecutionPolicy {
    return { mutates: false, parallelSafe: true, cacheable: true }
  }

  getApprovalRequest?(_args: Record<string, unknown> = {}): ToolApprovalRequest | undefined {
    return undefined
  }

  getDisplayInfo?(_args: Record<string, unknown> = {}): ToolDisplayInfo | undefined {
    return undefined
  }

  abstract execute(
    argumentsJson: string,
    blackboard: Blackboard,
    abortSignal?: AbortSignal,
    onProgress?: ProgressCallback
  ): Promise<ToolResult>

  validate(_argumentsJson: string): string | null {
    return null
  }
}
