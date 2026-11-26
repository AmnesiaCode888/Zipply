import type { ReasoningEffort } from '../../services/settingsService'

export type AiMode = 'low' | 'pro' | 'ultra'
export type { ReasoningEffort }

export interface ModelOption {
  id: string
  displayName: string
  shortName: string
  description: string
  isAvailable: boolean
}

export interface ReasoningLevelInfo {
  value: ReasoningEffort
  label: string
  title: string
}

export interface ModeInfo {
  label: string
  sublabel: string
}

export interface ModeSelectorProps {
  model?: string
  reasoningEffort?: ReasoningEffort
  onModelChange?: (modelId: string) => void
  onReasoningEffortChange?: (effort: ReasoningEffort) => void
  value?: AiMode
  onChange?: (mode: AiMode) => void
  uncensoredMode?: boolean
  onEnableUncensoredMode?: () => void
}
