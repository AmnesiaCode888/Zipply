export const DEFAULT_MODEL_CONTEXT_LENGTH = 500000

export const MODEL_CONTEXT_LENGTHS: Record<string, number> = {
  'deepseek-v4-1-flash-1017-uncensored': 500000,
  'glm-5-3-flash-uncensored': 500000,
  'zipply-ultra': 500000,
  'gpt-4o': 128000,
  'gpt-4o-mini': 128000,
  'gpt-4-turbo': 128000,
  'gpt-4.1': 1000000,
  'gpt-4.1-mini': 1000000,
  'gpt-4.1-nano': 1000000,
  'gpt-3.5-turbo': 16384,
  'o1': 200000,
  'o3': 200000,
  'o3-mini': 200000,
  'o4-mini': 200000,
  'gpt-5': 200000,
  'claude-3-5-sonnet': 200000,
  'claude-3-7-sonnet': 200000,
  'claude-sonnet-4': 200000,
  'claude-opus-4': 200000,
  'gemini-1.5-pro': 1000000,
  'gemini-2.0-flash': 1000000,
  'gemini-2.5-pro': 1000000,
  'gemini-2.5-flash': 1000000,
  'deepseek-chat': 128000,
  'deepseek-reasoner': 128000
}

export function getModelContextLength(model?: string, explicitOverride?: number): number {
  if (typeof explicitOverride === 'number' && Number.isFinite(explicitOverride) && explicitOverride > 0) {
    return Math.floor(explicitOverride)
  }
  const normalized = (model || '').trim().toLowerCase().replace(/^models\//, '')
  if (!normalized) return DEFAULT_MODEL_CONTEXT_LENGTH

  const slashIdx = normalized.indexOf('/')
  const bare = slashIdx >= 0 ? normalized.slice(slashIdx + 1) : normalized
  if (MODEL_CONTEXT_LENGTHS[normalized]) return MODEL_CONTEXT_LENGTHS[normalized]
  if (MODEL_CONTEXT_LENGTHS[bare]) return MODEL_CONTEXT_LENGTHS[bare]

  if (/^deepseek-v4/.test(bare)) return 500000
  if (/^glm-5/.test(bare)) return 500000
  if (/^(?:gpt-4\.1|gemini-(?:1\.5|2|3))/.test(bare)) return 1000000
  if (/^(?:claude-|o[134](?:$|[-._])|gpt-5|codex)/.test(bare)) return 200000
  if (/^(?:gpt-4o|gpt-4-turbo|deepseek-|qwen)/.test(bare)) return 128000
  if (/^gpt-3\.5/.test(bare)) return 16384

  return DEFAULT_MODEL_CONTEXT_LENGTH
}
