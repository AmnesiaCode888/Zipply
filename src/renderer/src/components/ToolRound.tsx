import React, { memo, useState } from 'react'
import { ChevronDown, ChevronRight, Loader2 } from 'lucide-react'
import { StepItem } from '../types/chat'
import { SlotMachineReel } from './tools/SlotMachineReel'
import { getStepIcon, formatStepTitle, isDeepThought, ToolStepContent } from './tools/ToolViewerRegistry'
import { getHeuristicRoundSummary } from '../utils/summaryUtils'
import './ToolRound.css'
import './ToolCall.css'

interface ToolRoundProps {
  steps?: StepItem[]
  isThinking?: boolean
  totalWorkedSeconds?: number
  summary?: string
}

export const ToolRound: React.FC<ToolRoundProps> = memo(function ToolRound({
  steps = [],
  isThinking = false,
  totalWorkedSeconds,
  summary
}: ToolRoundProps) {
  const [isExpanded, setIsExpanded] = useState(false)
  const [openDetailIds, setOpenDetailIds] = useState<Set<string>>(new Set())
  // Heavy step content (diffs, terminal output, markdown) is rendered ONLY after its
  // detail is opened at least once. Before that the collapsed accordion has no content,
  // so opening the main list doesn't lay out megabytes of hidden DOM in one frame.
  const [renderedDetailIds, setRenderedDetailIds] = useState<Set<string>>(new Set())

  // Filter out empty thought steps when round has completed
  const visibleSteps = steps.filter((step) => {
    if (step.type === 'thought' && (!step.result || !String(step.result).trim()) && !isThinking) {
      return false
    }
    return true
  })

  const toggleDetail = (stepId: string): void => {
    setOpenDetailIds((prev) => {
      const next = new Set(prev)
      if (next.has(stepId)) {
        next.delete(stepId)
      } else {
        next.add(stepId)
      }
      return next
    })
    setRenderedDetailIds((prev) => {
      if (prev.has(stepId)) return prev
      const next = new Set(prev)
      next.add(stepId)
      return next
    })
  }

  if (!visibleSteps || visibleSteps.length === 0) {
    if (isThinking) {
      return (
        <div className="tool-round-container is-streaming">
          <SlotMachineReel />
        </div>
      )
    }
    return null
  }

  const workedTime =
    totalWorkedSeconds ||
    visibleSteps.reduce((acc, s) => acc + (s.durationSeconds || 1), 0) ||
    1

  const activeStep = visibleSteps[visibleSteps.length - 1]
  const displaySummary = summary || getHeuristicRoundSummary(visibleSteps)

  return (
    <div className={`tool-round-container ${isThinking ? 'is-streaming' : 'is-done'}`}>
      {/* ─── 1. COLLAPSED REEL BAR (Visible during streaming when not expanded) ─── */}
      {isThinking && !isExpanded ? (
        <div
          className="streaming-bar-interactive"
          onClick={() => setIsExpanded(true)}
          role="button"
          tabIndex={0}
          title="Нажмите, чтобы развернуть шаги"
        >
          <SlotMachineReel activeStep={activeStep} />
          <ChevronDown size={14} className="streaming-expand-chevron" />
        </div>
      ) : (
        /* ─── 2. SUMMARY HEADER BUTTON (Click to toggle smooth accordion) ─── */
        <button
          type="button"
          className={`worked-summary-btn ${isExpanded ? 'expanded' : ''}`}
          onClick={() => setIsExpanded((prev) => !prev)}
          title={isExpanded ? 'Свернуть' : 'Нажмите, чтобы развернуть шаги'}
        >
          {isThinking ? (
            <span className="streaming-live-header">
              <Loader2 size={13} className="streaming-spin-icon" />
              <span>Running tools ({visibleSteps.length} steps)...</span>
            </span>
          ) : (
            <span className="worked-summary-text">
              <span className="worked-summary-time">Worked for {workedTime}s</span>
              {displaySummary ? (
                <>
                  <span className="worked-summary-dot">·</span>
                  <span className="worked-summary-desc">{displaySummary}</span>
                </>
              ) : null}
            </span>
          )}
          <ChevronDown size={14} className={`worked-chevron ${isExpanded ? 'open' : ''}`} />
        </button>
      )}

      {/* ─── 3. BUTTER-SMOOTH CSS GRID ACCORDION CONTAINER ─── */}
      <div className={`accordion-grid ${isExpanded ? 'open' : ''}`}>
        <div className="accordion-content">
          <div className="worked-steps-list">
            {visibleSteps.map((step) => {
              // ask_agent: show detail if we have innerSteps OR final result
              const hasDetails = step.type === 'ask_agent'
                ? Boolean(step.result || (step.data && (step.data as any).innerSteps?.length))
                : Boolean(step.result)

              // Auto-open ask_agent step while it's actively running (innerSteps present but not done)
              const isAutoOpen = step.type === 'ask_agent' && !step.isDone && Boolean((step.data as any)?.innerSteps?.length)
              const isDetailOpen = openDetailIds.has(step.id) || isAutoOpen

              return (
                <div key={step.id} className="worked-step-wrapper">
                  <div
                    className={`worked-step-row ${hasDetails ? 'has-details' : ''} ${isDetailOpen ? 'detail-open' : ''}`}
                    onClick={() => hasDetails && toggleDetail(step.id)}
                    role={hasDetails ? 'button' : undefined}
                    tabIndex={hasDetails ? 0 : undefined}
                  >
                    {/* Left: Icon + Action & Target */}
                    <div className="worked-step-left">
                      <span className="step-icon-wrapper">
                        {getStepIcon(step.type)}
                      </span>
                      <span className={`worked-step-name ${isDeepThought(step) ? 'is-deep-thought' : ''}`}>
                        {formatStepTitle(step)}
                      </span>
                      {isDeepThought(step) && (
                        <span className="deep-thought-badge" aria-label="Extended thinking">
                          deep
                        </span>
                      )}
                    </div>

                    {/* Right: Stats (+add -del) + Arrow › */}
                    <div className="worked-step-right">
                      {step.stats && (
                        <div className="step-stats-group">
                          {step.stats.add !== undefined && (
                            <span className="step-stat-add mono">+{step.stats.add}</span>
                          )}
                          {step.stats.del !== undefined && (
                            <span className="step-stat-del mono">−{step.stats.del}</span>
                          )}
                        </div>
                      )}

                      {hasDetails && (
                        <ChevronRight
                          size={14}
                          className={`step-detail-arrow ${isDetailOpen ? 'open' : ''}`}
                        />
                      )}
                    </div>
                  </div>

                  {/* ─── 4. BUTTER-SMOOTH INDIVIDUAL STEP DETAIL ACCORDION ─── */}
                  {hasDetails && (
                    <div className={`detail-accordion-grid ${isDetailOpen ? 'open' : ''}`}>
                      <div className="detail-accordion-content">
                        <div className="worked-step-detail-body">
                          {/* ask_agent: always render live (no lazy gate — needs live innerSteps updates) */}
                          {/* Other tools: render only after first open to avoid heavy DOM upfront */}
                          {(step.type === 'ask_agent' || renderedDetailIds.has(step.id)) ? (
                            <ToolStepContent step={step} />
                          ) : null}
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      </div>
    </div>
  )
})

export default ToolRound
