import { AgentBase, AgentContext } from '../core/AgentBase'
import { SystemPromptPipeline } from '../core/SystemPromptPipeline'

/**
 * ZipplyAgent — Master agent.
 */
export class ZipplyAgent extends AgentBase {
  get id(): string {
    return 'zipply'
  }

  get name(): string {
    return 'Zipply'
  }

  getSystemPrompt(context: AgentContext): string {
    return SystemPromptPipeline.compile(this.id, context).systemPromptPrefix
  }
}
