import { AgentBase, AgentContext } from '../core/AgentBase'
import { SystemPromptPipeline } from '../core/SystemPromptPipeline'

/**
 * TerminalAgent — Expert shell command execution and process lifecycle specialist.
 */
export class TerminalAgent extends AgentBase {
  get id(): string {
    return 'terminal'
  }

  get name(): string {
    return 'TerminalAgent'
  }

  getSystemPrompt(context: AgentContext): string {
    return SystemPromptPipeline.compile(this.id, context).fullPrompt
  }
}
