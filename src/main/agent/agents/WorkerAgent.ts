import { AgentBase, AgentContext } from '../core/AgentBase'
import { SystemPromptPipeline } from '../core/SystemPromptPipeline'

/**
 * WorkerAgent — Autonomous focused task worker subagent with full filesystem and terminal execution capabilities.
 * Ideal for executing deep multi-step refactorings, test runs, file transformations, or builds in an isolated turn.
 */
export class WorkerAgent extends AgentBase {
  get id(): string {
    return 'worker'
  }

  get name(): string {
    return 'WorkerAgent'
  }

  get isReadOnly(): boolean {
    return false
  }

  getSystemPrompt(context: AgentContext): string {
    return SystemPromptPipeline.compile(this.id, context).fullPrompt
  }
}
