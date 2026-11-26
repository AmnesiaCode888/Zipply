import { AgentContext } from './AgentBase'
import { ChatConfig } from '../services/ChatService'

export type PromptTier = 'global_static' | 'session_static' | 'runtime_dynamic'

export interface PromptSectionProvider {
  id: string
  isStatic: boolean
  tier?: PromptTier
  render(context: AgentContext, config?: ChatConfig): string | null
}

export interface CompiledPrompt {
  /** Global invariant prompt instructions (Zone 1A). */
  staticPrefix: string
  /** Session-scoped static context: environment, plugins, user & project rules (Zone 1B). */
  sessionPrefix: string
  /** Combined immutable prefix for messages[0] (Zone 1A + Zone 1B). */
  systemPromptPrefix: string
  /** Per-turn runtime context intended for the dynamic tail (Zone 3). */
  dynamicSuffix: string
  /** Full prompt text (preserved for compatibility). */
  fullPrompt: string
  systemRole: 'system' | 'developer'
}

/**
 * Select `developer` only for OpenAI reasoning/frontier models that treat it as the
 * application-instruction channel; all other models/providers use `system`.
 */
export function resolveSystemRole(model?: string, _baseUrl?: string): 'system' | 'developer' {
  const raw = (model || '').trim().toLowerCase().replace(/^models\//, '')
  if (!raw) return 'system'

  const slashIdx = raw.indexOf('/')
  const modelId = slashIdx >= 0 ? raw.slice(slashIdx + 1) : raw
  if (slashIdx >= 0) {
    const provider = raw.slice(0, slashIdx)
    if (provider !== 'openai') return 'system'
  }

  return /^(?:o1(?!-(?:mini|preview))|o3|o4|gpt-5|codex)(?:$|[-._])/.test(modelId)
    ? 'developer'
    : 'system'
}

export class SystemPromptPipeline {
  private static _providers: PromptSectionProvider[] = []

  static registerProvider(provider: PromptSectionProvider): void {
    const existingIdx = this._providers.findIndex((p) => p.id === provider.id)
    if (existingIdx >= 0) {
      this._providers[existingIdx] = provider
    } else {
      this._providers.push(provider)
    }
  }

  static clearProviders(): void {
    this._providers = []
  }

  static getProviders(): PromptSectionProvider[] {
    return [...this._providers]
  }

  static compile(agentId: string, context: AgentContext, config: ChatConfig = {}): CompiledPrompt {
    const ctx: AgentContext = {
      ...context,
      agentId
    }

    const globalParts: string[] = []
    const sessionParts: string[] = []
    const dynamicParts: string[] = []
    const systemRole = resolveSystemRole(config.model, config.baseUrl)

    for (const provider of this._providers) {
      try {
        const rendered = provider.render(ctx, config)
        if (rendered && typeof rendered === 'string' && rendered.trim().length > 0) {
          const tier: PromptTier = provider.tier || (provider.isStatic ? 'global_static' : 'runtime_dynamic')
          if (tier === 'global_static') {
            globalParts.push(rendered.trim())
          } else if (tier === 'session_static') {
            sessionParts.push(rendered.trim())
          } else {
            dynamicParts.push(rendered.trim())
          }
        }
      } catch (err) {
        console.warn(`[SystemPromptPipeline] Provider '${provider.id}' render failed:`, err)
      }
    }

    const staticPrefix = globalParts.join('\n\n')
    const sessionPrefix = sessionParts.join('\n\n')
    const systemPromptPrefix = [staticPrefix, sessionPrefix].filter(Boolean).join('\n\n')
    const dynamicSuffix = dynamicParts.join('\n\n')
    const fullPrompt = [systemPromptPrefix, dynamicSuffix].filter(Boolean).join('\n\n')

    return {
      staticPrefix,
      sessionPrefix,
      systemPromptPrefix,
      dynamicSuffix,
      fullPrompt,
      systemRole
    }
  }
}
