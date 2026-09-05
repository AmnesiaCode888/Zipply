import { AgentBase, AgentContext } from '../core/AgentBase'
import { SystemPromptPipeline } from '../core/SystemPromptPipeline'

/**
 * AskAgent — Read-only research, investigation, document analysis & architectural consultant subagent.
 */
export class AskAgent extends AgentBase {
  get id(): string {
    return 'ask'
  }

  get name(): string {
    return 'AskAgent'
  }

  get isReadOnly(): boolean {
    return true
  }

  getSystemPrompt(context: AgentContext): string {
    return SystemPromptPipeline.compile(this.id, context).fullPrompt
  }
}
