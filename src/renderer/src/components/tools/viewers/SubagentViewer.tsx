import React, { useState } from 'react'
import {
  Loader2,
  ChevronDown,
  ChevronRight,
  Check
} from 'lucide-react'
import { StepArgs, StepItem } from '../../../types/chat'
import { renderMarkdown } from '../../MarkdownRenderer'
import { normalizeInnerStep } from '../../../hooks/useChatSession'
import { getStepIcon, formatStepTitle, isDeepThought, ToolStepContent } from '../ToolViewerRegistry'
import { getSubagentIcon } from '../../SubagentRound'
import '../../ToolRound.css'

interface SubagentViewerProps {
  args?: StepArgs
  result?: string
  data?: any
}

export const SubagentViewer: React.FC<SubagentViewerProps> = ({ args, result, data }) => {
  const [stepsExpanded, setStepsExpanded] = useState(true)
  const [openStepIds, setOpenStepIds] = useState<Set<string>>(new Set())
  const [renderedDetailIds, setRenderedDetailIds] = useState<Set<string>>(new Set())
  const [copied, setCopied] = useState(false)

  let rawSteps: any[] = []
  const agentId = (args?.agent_id as string) || data?.agentId || 'ask'
  const prompt = (args?.prompt as string) || data?.prompt || ''
  let finalAnswer = ''
  let isSwarm = false
  let swarmResults: any[] = []

  if (data?.allInnerSteps && Array.isArray(data.allInnerSteps)) {
    rawSteps = data.allInnerSteps
  } else if (data?.innerSteps && Array.isArray(data.innerSteps)) {
    rawSteps = data.innerSteps
  }

  if (data?.answer && typeof data.answer === 'string') {
    finalAnswer = data.answer
  } else if (data?.results && Array.isArray(data.results)) {
    isSwarm = true
    swarmResults = data.results
    const aggregated: any[] = []
    for (const r of data.results) {
      if (Array.isArray(r.innerSteps)) {
        aggregated.push(...r.innerSteps)
      }
    }
    if (aggregated.length > 0) {
      rawSteps = aggregated
    }
  } else if (typeof result === 'string' && result) {
    const match = result.match(/### Ответ субагента[^:]*:\n([\s\S]*)/)
    finalAnswer = match ? match[1].trim() : result
  }

  const normalizedSteps: StepItem[] = rawSteps.map(normalizeInnerStep)

  const partialAnswer = data?.partialAnswer as string | undefined
  const isDone = data?.answer !== undefined || data?.results !== undefined || (typeof result === 'string' && result && !data?.innerSteps)
  const isStreaming = !isDone && normalizedSteps.length > 0

  const toggleStep = (id: string): void => {
    setOpenStepIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
    setRenderedDetailIds((prev) => {
      if (prev.has(id)) return prev
      const next = new Set(prev)
      next.add(id)
      return next
    })
  }

  const handleCopy = (e: React.MouseEvent): void => {
    e.stopPropagation()
    const text = finalAnswer || partialAnswer || ''
    navigator.clipboard.writeText(text)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div className="subagent-viewer-root">
      {/* Header */}
      <div className="subagent-viewer-header">
        {getSubagentIcon(agentId, isSwarm, 13)}
        <span className="subagent-viewer-title">
          {isSwarm ? `Рой субагентов (${swarmResults.length})` : `Субагент · ${agentId}`}
        </span>
        {(finalAnswer || partialAnswer) && (
          <button type="button" className="subagent-copy-btn" onClick={handleCopy} title="Копировать ответ">
            {copied ? <Check size={10} strokeWidth={2.5} /> : <span>copy</span>}
          </button>
        )}
      </div>

      {/* Prompt pill */}
      {prompt && (
        <div className="subagent-viewer-prompt">{prompt.length > 120 ? prompt.slice(0, 120) + '…' : prompt}</div>
      )}

      {/* Steps accordion */}
      {normalizedSteps.length > 0 && (
        <div className="subagent-steps-block">
          <button
            type="button"
            className={`subagent-steps-toggle ${stepsExpanded ? 'expanded' : ''}`}
            onClick={() => setStepsExpanded((p) => !p)}
          >
            {isStreaming
              ? <Loader2 size={11} className="subagent-spin" />
              : <ChevronDown size={11} className={`subagent-steps-chevron ${stepsExpanded ? 'open' : ''}`} />
            }
            <span>
              {isStreaming ? 'Работает' : 'Worked at'} · {normalizedSteps.length}{' '}
              {isSwarm ? 'шагов (суммарно)' : 'шагов'}
            </span>
          </button>

          <div className={`subagent-steps-accordion ${stepsExpanded ? 'open' : ''}`}>
            <div className="worked-steps-list subagent-steps-list">
              {normalizedSteps.map((step) => {
                const isOpen = openStepIds.has(step.id)
                const hasDetails = Boolean(step.result || (step.args && Object.keys(step.args).length > 0))

                return (
                  <div key={step.id} className="worked-step-wrapper">
                    <div
                      className={`worked-step-row ${hasDetails ? 'has-details' : ''} ${isOpen ? 'detail-open' : ''}`}
                      onClick={() => hasDetails && toggleStep(step.id)}
                      role={hasDetails ? 'button' : undefined}
                      tabIndex={hasDetails ? 0 : undefined}
                    >
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
                            className={`step-detail-arrow ${isOpen ? 'open' : ''}`}
                          />
                        )}
                      </div>
                    </div>

                    {hasDetails && (
                      <div className={`detail-accordion-grid ${isOpen ? 'open' : ''}`}>
                        <div className="detail-accordion-content">
                          <div className="worked-step-detail-body">
                            {renderedDetailIds.has(step.id) ? (
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
      )}

      {/* Final answer */}
      {(finalAnswer || partialAnswer) && (
        <div className="subagent-viewer-answer">
          {renderMarkdown(finalAnswer || partialAnswer || '')}
        </div>
      )}

      {/* Swarm results */}
      {isSwarm && swarmResults.length > 0 && swarmResults.map((r: any, i: number) => (
        <div key={i} className="subagent-swarm-result">
          <div className="subagent-swarm-label">
            {getSubagentIcon(r.agentId || r.agentName, false, 11)}
            <span>{r.agentName || r.agentId || `Агент ${i + 1}`}</span>
          </div>
          {r.prompt && <div className="subagent-viewer-prompt">{r.prompt.slice(0, 100)}</div>}
          {r.answer && <div className="subagent-viewer-answer">{renderMarkdown(r.answer)}</div>}
        </div>
      ))}

      {/* Loading state */}
      {normalizedSteps.length === 0 && !finalAnswer && !partialAnswer && (
        <div className="subagent-viewer-empty">
          <Loader2 size={12} className="subagent-spin" />
          <span>Запуск субагента...</span>
        </div>
      )}
    </div>
  )
}

export default SubagentViewer
