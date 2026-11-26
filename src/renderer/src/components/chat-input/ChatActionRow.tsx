import React from 'react'
import { Plus, ArrowUp, Square, X, ListChecks } from '../../icons'
import { ModeSelector, AiMode, ReasoningEffort } from '../mode-selector'
import type { AccessMode } from '../../services/settingsService'
import type { Message } from '../../types/chat'
import { AccessSelector } from './AccessSelector'
import { ContextIndicator } from './ContextIndicator'

interface ChatActionRowProps {
  contextStatus?: Message['contextStatus']
  contextCompacted?: boolean
  isMenuOpen: boolean
  onToggleMenu: () => void
  buttonRef: React.RefObject<HTMLButtonElement>
  mode?: AiMode
  onModeChange?: (mode: AiMode) => void
  model?: string
  reasoningEffort?: ReasoningEffort
  onModelChange?: (modelId: string) => void
  onReasoningEffortChange?: (effort: ReasoningEffort) => void
  uncensoredMode?: boolean
  onEnableUncensoredMode?: () => void
  hasText: boolean
  isStreaming?: boolean
  onCancel?: () => void
  onSend: () => void
  planMode?: boolean
  onRemovePlan: () => void
  accessMode: AccessMode
  onAccessModeChange: (mode: AccessMode) => boolean
  disabled?: boolean
}

export const ChatActionRow: React.FC<ChatActionRowProps> = ({
  contextStatus,
  contextCompacted,
  isMenuOpen,
  onToggleMenu,
  buttonRef,
  mode,
  onModeChange,
  model,
  reasoningEffort,
  onModelChange,
  onReasoningEffortChange,
  uncensoredMode,
  onEnableUncensoredMode,
  hasText,
  isStreaming,
  onCancel,
  onSend,
  planMode,
  onRemovePlan,
  accessMode,
  onAccessModeChange,
  disabled
}) => {
  return (
    <div className="composer-actions flex shrink-0 flex-wrap items-center justify-between gap-y-1 mt-2.5 px-0.5 select-none">
      <div className="composer-actions-primary flex flex-wrap items-center min-w-0 max-w-full gap-1">
        {/* Toggle Action Menu Button (+) */}
        <button
        ref={buttonRef}
        type="button"
        disabled={disabled}
        onClick={onToggleMenu}
        aria-label="Действия"
        aria-expanded={isMenuOpen}
        className={`w-[34px] h-[34px] shrink-0 rounded-full flex items-center justify-center transition-all duration-200 cursor-pointer focus:outline-none active:scale-90 border-none shadow-none ${
          isMenuOpen
            ? 'bg-hover-strong text-primary'
            : 'bg-control hover:bg-control-hover text-secondary hover:text-primary'
        }`}
      >
        <Plus
          size={17}
          strokeWidth={2.2}
          className={`transition-transform duration-200 ease-out ${
            isMenuOpen ? 'rotate-45 text-strong' : 'rotate-0'
          }`}
        />
        </button>
        <AccessSelector value={accessMode} onChange={onAccessModeChange} planMode={planMode} onExitPlan={onRemovePlan} disabled={disabled} />
        {planMode && <div className="max-w-full overflow-hidden"><div className="plan-chip-slide flex items-center gap-1 max-w-full"><span aria-hidden="true" className="h-4 w-px shrink-0 rounded-full bg-divider" /><button type="button" disabled={disabled} onClick={onRemovePlan} aria-label="Выключить режим плана" title="Выключить режим плана" className="h-[34px] min-w-0 max-w-full inline-flex items-center gap-1.5 rounded-full bg-transparent px-2.5 text-[14.5px] text-primary hover:bg-control-hover active:scale-95 transition-colors border-none shadow-none cursor-pointer focus:outline-none"><ListChecks size={15} className="shrink-0" aria-hidden="true" /><span className="truncate">План</span><X size={14} className="shrink-0" aria-hidden="true" /></button></div></div>}
      </div>

      {contextStatus && <div className="composer-actions-context flex-1 min-w-0 flex justify-end px-2">
        <ContextIndicator status={contextStatus} compacted={Boolean(contextCompacted)} />
      </div>}

      {/* Right action group: Mode selector + Send button */}
      <div className="composer-actions-secondary flex flex-wrap items-center gap-2 shrink-0 max-w-full">
        <ModeSelector
          model={model}
          reasoningEffort={reasoningEffort}
          onModelChange={onModelChange}
          onReasoningEffortChange={onReasoningEffortChange}
          value={mode}
          onChange={onModeChange}
          uncensoredMode={uncensoredMode}
          onEnableUncensoredMode={onEnableUncensoredMode}
        />

        {/* Send / Stop button */}
        {isStreaming && !hasText ? (
          <button
            type="button"
            onClick={onCancel}
            aria-label="Остановить генерацию"
            className="w-[34px] h-[34px] rounded-full flex items-center justify-center transition-all duration-200 focus:outline-none border-none shadow-none bg-control hover:bg-control-hover active:scale-95 cursor-pointer text-primary"
          >
            <Square size={13} fill="currentColor" />
          </button>
        ) : (
          <button
            type="button"
            onClick={onSend}
            aria-label={isStreaming ? 'Отправить поправку' : 'Отправить'}
            disabled={!hasText}
            className={`
              w-[34px] h-[34px] rounded-full flex items-center justify-center
              transition-all duration-200 focus:outline-none shadow-none border-none
              ${
                hasText
                  ? 'bg-accent hover:bg-accent-hover active:scale-95 cursor-pointer'
                  : 'bg-control cursor-default'
              }
            `}
          >
            <ArrowUp
              size={17}
              strokeWidth={2.4}
              className={hasText ? 'text-on-accent' : 'text-muted'}
            />
          </button>
        )}
      </div>
    </div>
  )
}
