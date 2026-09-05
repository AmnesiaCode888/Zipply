import { AgentBase, AgentContext } from '../core/AgentBase'
import { SystemPromptPipeline } from '../core/SystemPromptPipeline'

/**
 * ZipplyAgent — Universal Autonomous AI Agent & Digital Teammate with Full PC Access.
 */
export class ZipplyAgent extends AgentBase {
  get id(): string {
    return 'zipply'
  }

  get name(): string {
    return 'zipply'
  }

  getSystemPrompt(context: AgentContext): string {
    return SystemPromptPipeline.compile(this.id, context).fullPrompt
  }
}
