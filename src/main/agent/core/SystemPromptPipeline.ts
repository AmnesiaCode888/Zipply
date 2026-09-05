/**
 * SystemPromptPipeline — Modular Prompt Assembly & Caching Engine (Symbiosis of Hermes, Codex, Gemini, OpenCode).
 *
 * Responsibilities:
 * 1. Cache-Friendly Partitioning: Strictly isolates Static Cached Prefix (Persona, Tools, Rules, Skills)
 *    from Dynamic Suffix (Date, Workspace State, RepoMap, Memory, Active Goals) to ensure maximum
 *    LLM Prompt Caching hits across Anthropic, Gemini, and OpenAI.
 * 2. Provider Role Adaptation: Automatically switches between `developer` (OpenAI o1/o3/4o) and `system` roles.
 * 3. XML Boundary Normalization: Ensures consistent tag scoping (<Identity>, <user_rules>, <tools>, etc.).
 */

import { AgentContext } from './AgentBase'
import { ChatConfig } from '../services/ChatService'

export interface PromptSectionProvider {
  id: string
  /**
   * Static sections are 100% deterministic and cache-stable (Persona, Rules, Skills, Tool Contracts).
   * Dynamic sections vary across turns or time (Timestamp, Workspace, Memory, Goal Anchors).
   */
  isStatic: boolean
  render(context: AgentContext, config?: ChatConfig): string | null
}

export interface CompiledPrompt {
  staticPrefix: string
  dynamicSuffix: string
  fullPrompt: string
  systemRole: 'system' | 'developer'
}

export class SystemPromptPipeline {
  private static _providers: PromptSectionProvider[] = []

  /**
   * Register a new prompt section provider.
   */
  static registerProvider(provider: PromptSectionProvider): void {
    const existingIdx = this._providers.findIndex((p) => p.id === provider.id)
    if (existingIdx >= 0) {
      this._providers[existingIdx] = provider
    } else {
      this._providers.push(provider)
    }
  }

  /**
   * Clear all registered providers (useful for testing or reinitialization).
   */
  static clearProviders(): void {
    this._providers = []
  }

  /**
   * Returns a copy of all active providers.
   */
  static getProviders(): PromptSectionProvider[] {
    return [...this._providers]
  }

  /**
   * Compiles the system prompt for a specific agent and context.
   */
  static compile(agentId: string, context: AgentContext, config: ChatConfig = {}): CompiledPrompt {
    const ctx: AgentContext = {
      ...context,
      agentId
    }

    const staticParts: string[] = []
    const dynamicParts: string[] = []

    // 1. Role determination (OpenAI o1/o3/4o -> developer, all others -> system)
    const modelName = (config.model || '').toLowerCase()
    const isReasoningOpenAi =
      modelName.includes('o1') ||
      modelName.includes('o3') ||
      (modelName.includes('gpt-4o') && !modelName.includes('mini'))
    const systemRole: 'system' | 'developer' = isReasoningOpenAi ? 'developer' : 'system'

    // 2. Render all registered section providers
    for (const provider of this._providers) {
      try {
        const rendered = provider.render(ctx, config)
        if (rendered && typeof rendered === 'string' && rendered.trim().length > 0) {
          if (provider.isStatic) {
            staticParts.push(rendered.trim())
          } else {
            dynamicParts.push(rendered.trim())
          }
        }
      } catch (err) {
        console.warn(`[SystemPromptPipeline] Provider '${provider.id}' render failed:`, err)
      }
    }

    const staticPrefix = staticParts.join('\n\n')
    const dynamicSuffix = dynamicParts.join('\n\n')
    const fullPrompt = [staticPrefix, dynamicSuffix].filter(Boolean).join('\n\n')

    return {
      staticPrefix,
      dynamicSuffix,
      fullPrompt,
      systemRole
    }
  }
}
