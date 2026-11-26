import { ToolCall, MessageBlock } from '../../types/chat'

export type WorkflowStep =
  | {
      type: 'thinking'
      id: string
      content: string
      durationSec?: number
    }
  | {
      type: 'text'
      id: string
      content: string
    }
  | {
      type: 'tool'
      id: string
      tool: ToolCall
      executionDurationMs?: number
    }

export interface MockScenario {
  id?: string
  title?: string
  steps: WorkflowStep[]
}

export interface StreamController {
  cancel: () => void
}

export type StreamUpdateCallback = (blocks: MessageBlock[], isFinished: boolean) => void

export interface IStreamEngine {
  stream(scenario: MockScenario, onUpdate: StreamUpdateCallback): StreamController
}
