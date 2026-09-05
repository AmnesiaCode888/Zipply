import { AgentBase, AgentContext } from '../core/AgentBase'
import { SystemPromptPipeline } from '../core/SystemPromptPipeline'

/**
 * WebSearchAgent — Web research specialist for documentation, live APIs, and online articles.
 */
export class WebSearchAgent extends AgentBase {
  get id(): string {
    return 'web_search'
  }

  get name(): string {
    return 'WebSearchAgent'
  }

  getSystemPrompt(context: AgentContext): string {
    return SystemPromptPipeline.compile(this.id, context).fullPrompt
  }
}
