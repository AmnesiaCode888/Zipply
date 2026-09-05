import { Blackboard } from '../core/Blackboard'

export interface ToolParameterDef {
  type: string
  description: string
  required?: boolean
  enum?: string[]
  items?: Record<string, unknown>
  properties?: Record<string, ToolParameterDef>
  default?: unknown
}

export interface ToolResult {
  formattedContent: string
  data?: unknown
  error?: boolean | string
  success?: boolean
}

export interface ToolExecutionPolicy {
  /** The tool/action can change files, processes, memory, or other state. */
  mutates: boolean
  /** The call is safe to run alongside another call from the same model turn. */
  parallelSafe: boolean
  /** The result remains valid until the next mutating call. */
  cacheable: boolean
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

  get parameters(): Record<string, ToolParameterDef> {
    return {}
  }

  getExecutionPolicy(_args: Record<string, unknown> = {}): ToolExecutionPolicy {
    return { mutates: false, parallelSafe: true, cacheable: true }
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
