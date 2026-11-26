import { AiMode, ModeInfo, ModelOption, ReasoningEffort, ReasoningLevelInfo } from './types'

export const DEFAULT_MODEL_ID = 'deepseek-v4-1-flash-1017-uncensored'
export const DEFAULT_REASONING_EFFORT: ReasoningEffort = 'high'

export const ZIPPLY_MODELS: readonly ModelOption[] = [
  {
    id: 'deepseek-v4-1-flash-1017-uncensored',
    displayName: 'Zipply Pro',
    shortName: 'Pro',
    description: 'Без цензуры (100%)',
    isAvailable: true
  },
  {
    id: 'glm-5-3-flash-uncensored',
    displayName: 'Zipply Lite',
    shortName: 'Lite',
    description: 'Цензура снята ~на 80%',
    isAvailable: true
  },
  {
    id: 'zipply-ultra',
    displayName: 'Zipply Ultra',
    shortName: 'Ultra',
    description: 'Скоро появится',
    isAvailable: false
  }
] as const

export const REASONING_LEVELS: readonly ReasoningLevelInfo[] = [
  { value: 'off', label: 'off', title: 'Без рассуждений' },
  { value: 'low', label: 'low', title: 'Лёгкое' },
  { value: 'high', label: 'high', title: 'Глубокое' },
  { value: 'max', label: 'max', title: 'Максимум' }
] as const

const LEGACY_MODEL_MAP: Record<string, string> = {
  base: DEFAULT_MODEL_ID,
  pro: DEFAULT_MODEL_ID,
  max: DEFAULT_MODEL_ID,
  ultra: DEFAULT_MODEL_ID,
  low: 'glm-5-3-flash-uncensored'
}

export function resolveModelOption(modelId?: string): ModelOption {
  const normalized = (modelId || '').trim()
  const mappedId = LEGACY_MODEL_MAP[normalized] || normalized
  return ZIPPLY_MODELS.find(m => m.id === mappedId && m.isAvailable) || ZIPPLY_MODELS[0]
}

export function resolveReasoningLevel(effort?: string): ReasoningLevelInfo {
  return REASONING_LEVELS.find(r => r.value === effort) || REASONING_LEVELS[2]
}

// Kept for compatibility with legacy callers
export const AI_MODES: readonly AiMode[] = ['low', 'pro', 'ultra'] as const

export const MODE_INFO_MAP: Record<AiMode, ModeInfo> = {
  low: { label: 'low', sublabel: 'Низкая мощность' },
  pro: { label: 'pro', sublabel: 'Средняя мощность' },
  ultra: { label: 'ultra', sublabel: 'Максимальная мощность' }
}
