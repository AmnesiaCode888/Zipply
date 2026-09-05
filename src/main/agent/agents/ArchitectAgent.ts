import { AgentBase, AgentContext } from '../core/AgentBase'
import { SystemPromptPipeline } from '../core/SystemPromptPipeline'

/**
 * ArchitectAgent — Two-Phase Architecture Planning & System Design Specialist.
 * Evaluates requirements, inspects repo structure, and formulates high-precision,
 * step-by-step implementation blueprints without polluting code with preliminary diffs.
 */
export class ArchitectAgent extends AgentBase {
  get id(): string {
    return 'architect'
  }

  get name(): string {
    return 'ArchitectAgent'
  }

  get isReadOnly(): boolean {
    return true
  }

  getSystemPrompt(context: AgentContext): string {
    return SystemPromptPipeline.compile(this.id, context).fullPrompt
  }
}
