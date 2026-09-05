import React, { useState, memo } from 'react'
import {
  Terminal,
  Globe,
  Network,
  FileCode2,
  ChevronDown,
  ChevronRight,
  Loader2,
  Copy,
  Check
} from 'lucide-react'
import { SubagentRoundSegment, StepItem, SwarmSubagentItem } from '../types/chat'
import { SlotMachineReel } from './tools/SlotMachineReel'
import {
  getStepIcon,
  formatStepTitle,
  isDeepThought,
  ToolStepContent
} from './tools/ToolViewerRegistry'
import { getHeuristicRoundSummary } from '../utils/summaryUtils'
import { StreamingMarkdown } from './StreamingMarkdown'
import { renderMarkdown } from './MarkdownRenderer'
import './SubagentRound.css'
import './ToolRound.css'
import './ToolCall.css'

export function getSubagentIcon(agentId?: string, isSwarm?: boolean, size: number = 13): React.ReactNode {
  if (isSwarm) {
    return <Network size={size} className="subagent-bot-icon" />
  }
  const id = (agentId || '').toLowerCase()
  if (id.includes('terminal') || id.includes('bash') || id.includes('cmd') || id.includes('shell')) {
    return <Terminal size={size} className="subagent-bot-icon" />
  }
  if (id.includes('web') || id.includes('search') || id.includes('browser') || id.includes('net')) {
    return <Globe size={size} className="subagent-bot-icon" />
  }
  if (id.includes('code') || id.includes('dev') || id.includes('edit')) {
    return <FileCode2 size={size} className="subagent-bot-icon" />
  }
  return null
}

interface SubagentRoundProps {
  segment: SubagentRoundSegment
  isStreaming?: boolean
  onTick?: () => void
}

const SubagentContentView: React.FC<{
  steps: StepItem[]
  agentId?: string
  prompt?: string
  answer?: string
  partialAnswer?: string
  isThinking?: boolean
  isStreaming?: boolean
  onTick?: () => void
  openDetailIds: Set<string>
  renderedDetailIds: Set<string>
  toggleDetail: (stepId: string) => void
}> = ({
  steps,
  agentId,
  prompt,
  answer,
  partialAnswer,
  isThinking = false,
  isStreaming = false,
  onTick,
  openDetailIds,
  renderedDetailIds,
  toggleDetail
}) => {
  const [copied, setCopied] = useState(false)
  const visibleSteps = steps.filter((step) => {
    if (step.type === 'thought' && (!step.result || !String(step.result).trim()) && !isThinking) {
      return false
    }
    return true
  })

  const handleCopy = (e: React.MouseEvent): void => {
    e.stopPropagation()
    const text = answer || partialAnswer || ''
    if (!text) return
    navigator.clipboard.writeText(text)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const hasAnswer = Boolean(answer || partialAnswer)

  return (
    <div className="subagent-body-wrapper">
      {/* ── Subagent Task/Prompt ── */}
      {prompt && (
        <div className="subagent-task-line" title={prompt}>
          <span className="subagent-task-prefix">Задача:</span>
          <span className="subagent-task-text">{prompt}</span>
        </div>
      )}

      {/* ── Steps List (No left bar, clean rows) ── */}
      {visibleSteps.length > 0 && (
        <div className="worked-steps-list subagent-steps-list">
          {visibleSteps.map((step) => {
            const hasDetails = Boolean(
              step.result || (step.args && Object.keys(step.args).length > 0)
            )
            const isDetailOpen = openDetailIds.has(step.id)

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
                    <span
                      className={`worked-step-name ${isDeepThought(step) ? 'is-deep-thought' : ''}`}
                    >
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

                {/* Step Detail Body with Full Tool Viewers */}
                {hasDetails && (
                  <div className={`detail-accordion-grid ${isDetailOpen ? 'open' : ''}`}>
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
      )}

      {/* ── Subagent Answer Box ── */}
      {hasAnswer && (
        <div className="subagent-answer-card">
          <div className="subagent-answer-header">
            <div className="subagent-answer-title">
              {getSubagentIcon(agentId, false, 12)}
              <span>Ответ субагента</span>
            </div>
            <button
              type="button"
              className="subagent-answer-copy"
              onClick={handleCopy}
              title="Скопировать ответ"
            >
              {copied ? (
                <>
                  <Check size={11} strokeWidth={2.5} />
                  <span>Скопировано</span>
                </>
              ) : (
                <>
                  <Copy size={11} />
                  <span>Копировать</span>
                </>
              )}
            </button>
          </div>

          <div className="subagent-answer-content">
            {isStreaming && partialAnswer && !answer ? (
              <StreamingMarkdown
                content={partialAnswer}
                isStreaming={true}
                onTick={onTick}
              />
            ) : (
              renderMarkdown(answer || partialAnswer || '')
            )}
          </div>
        </div>
      )}
    </div>
  )
}

export const SubagentRound: React.FC<SubagentRoundProps> = memo(function SubagentRound({
  segment,
  isStreaming = false,
  onTick
}: SubagentRoundProps) {
  const [isExpanded, setIsExpanded] = useState(false)
  const [openDetailIds, setOpenDetailIds] = useState<Set<string>>(new Set())
  const [renderedDetailIds, setRenderedDetailIds] = useState<Set<string>>(new Set())
  const [activeSwarmTab, setActiveSwarmTab] = useState<number>(0)

  const isThinking = Boolean(segment.isThinking)
  const isSwarm = Boolean(segment.isSwarm && segment.swarmResults && segment.swarmResults.length > 0)
  const swarmList: SwarmSubagentItem[] = segment.swarmResults || []

  // Cumulative all steps across subagents in swarm mode or single subagent
  const allSubagentSteps: StepItem[] = isSwarm && swarmList.length > 0
    ? swarmList.flatMap((sw) => sw.steps || [])
    : (segment.steps || [])

  const effectiveSteps = allSubagentSteps.length > 0 ? allSubagentSteps : (segment.steps || [])

  const visibleSteps = effectiveSteps.filter((step) => {
    if (step.type === 'thought' && (!step.result || !String(step.result).trim()) && !isThinking) {
      return false
    }
    return true
  })

  const totalStepsCount = visibleSteps.length

  const toggleDetail = (stepId: string): void => {
    setOpenDetailIds((prev) => {
      const next = new Set(prev)
      if (next.has(stepId)) next.delete(stepId)
      else next.add(stepId)
      return next
    })
    setRenderedDetailIds((prev) => {
      if (prev.has(stepId)) return prev
      const next = new Set(prev)
      next.add(stepId)
      return next
    })
  }

  const workedTime =
    segment.totalWorkedSeconds ||
    visibleSteps.reduce((acc, s) => acc + (s.durationSeconds || 1), 0) ||
    1

  const activeStep = visibleSteps[visibleSteps.length - 1]
  const displaySummary =
    segment.summary ||
    getHeuristicRoundSummary(visibleSteps) ||
    (segment.prompt ? segment.prompt.slice(0, 60) : '')

  const agentLabel = segment.agentName || segment.agentId || 'AskAgent'

  return (
    <div className={`tool-round-container subagent-round-root ${isThinking ? 'is-streaming' : 'is-done'}`}>
      {/* ─── 1. COLLAPSED STREAMING BAR ─── */}
      {isThinking && !isExpanded ? (
        <div
          className="streaming-bar-interactive"
          onClick={() => setIsExpanded(true)}
          role="button"
          tabIndex={0}
          title="Нажмите, чтобы развернуть шаги субагента"
        >
          <div className="subagent-streaming-left">
            <span className="subagent-streaming-agent-name">
              {isSwarm ? `Рой (${swarmList.length})` : agentLabel}
            </span>
            <span className="worked-summary-dot">·</span>
            <SlotMachineReel activeStep={activeStep} />
            {totalStepsCount > 0 && (
              <>
                <span className="worked-summary-dot">·</span>
                <span className="subagent-total-steps-badge mono">
                  {totalStepsCount} {totalStepsCount === 1 ? 'шаг' : totalStepsCount < 5 ? 'шага' : 'шагов'}
                </span>
              </>
            )}
          </div>
          <ChevronDown size={14} className="streaming-expand-chevron" />
        </div>
      ) : (
        /* ─── 2. SUMMARY HEADER BUTTON ─── */
        <button
          type="button"
          className={`worked-summary-btn ${isExpanded ? 'expanded' : ''}`}
          onClick={() => setIsExpanded((prev) => !prev)}
          title={isExpanded ? 'Свернуть' : 'Нажмите, чтобы развернуть'}
        >
          {isThinking ? (
            <span className="streaming-live-header">
              <Loader2 size={13} className="streaming-spin-icon" />
              <span>{isSwarm ? `Рой субагентов (${swarmList.length})` : agentLabel}</span>
              <span className="worked-summary-dot">·</span>
              <span>
                Running tools ({totalStepsCount} {totalStepsCount === 1 ? 'step' : 'steps'} total)...
              </span>
            </span>
          ) : (
            <span className="worked-summary-text">
              <span className="subagent-header-agent-name">
                {isSwarm ? `Рой субагентов (${swarmList.length})` : `Субагент · ${agentLabel}`}
              </span>
              <span className="worked-summary-dot">·</span>
              <span className="worked-summary-time">Worked for {workedTime}s</span>
              {totalStepsCount > 0 && (
                <>
                  <span className="worked-summary-dot">·</span>
                  <span className="worked-summary-count">
                    {totalStepsCount} {totalStepsCount === 1 ? 'шаг' : totalStepsCount < 5 ? 'шага' : 'шагов'}
                  </span>
                </>
              )}
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

      {/* ─── 3. BUTTER-SMOOTH ACCORDION CONTAINER ─── */}
      <div className={`accordion-grid ${isExpanded ? 'open' : ''}`}>
        <div className="accordion-content">
          {/* Swarm Subagent Tabs if multi-agent swarm */}
          {isSwarm && swarmList.length > 1 && (
            <div className="subagent-swarm-tabbar">
              {swarmList.map((swItem, idx) => {
                const swStepsCount = (swItem.steps || []).filter(
                  (s) => s.type !== 'thought' || (s.result && String(s.result).trim()) || isThinking
                ).length
                return (
                  <button
                    key={idx}
                    type="button"
                    className={`subagent-tab-btn ${activeSwarmTab === idx ? 'active' : ''}`}
                    onClick={() => setActiveSwarmTab(idx)}
                  >
                    {getSubagentIcon(swItem.agentId, false, 12)}
                    <span>{swItem.agentName || swItem.agentId || `Агент ${idx + 1}`}</span>
                    {swStepsCount > 0 && <span className="subagent-tab-count">({swStepsCount})</span>}
                    {swItem.isThinking && <Loader2 size={10} className="subagent-tab-spin" />}
                  </button>
                )
              })}
            </div>
          )}

          {isSwarm && swarmList.length > 0 ? (
            (() => {
              const currentSwarmItem = swarmList[activeSwarmTab] || swarmList[0]
              return (
                <SubagentContentView
                  steps={currentSwarmItem.steps || []}
                  agentId={currentSwarmItem.agentId}
                  prompt={currentSwarmItem.prompt}
                  answer={currentSwarmItem.answer}
                  partialAnswer={currentSwarmItem.partialAnswer}
                  isThinking={currentSwarmItem.isThinking}
                  isStreaming={isStreaming}
                  onTick={onTick}
                  openDetailIds={openDetailIds}
                  renderedDetailIds={renderedDetailIds}
                  toggleDetail={toggleDetail}
                />
              )
            })()
          ) : (
            <SubagentContentView
              steps={visibleSteps}
              agentId={segment.agentId}
              prompt={segment.prompt}
              answer={segment.answer}
              partialAnswer={segment.partialAnswer}
              isThinking={isThinking}
              isStreaming={isStreaming}
              onTick={onTick}
              openDetailIds={openDetailIds}
              renderedDetailIds={renderedDetailIds}
              toggleDetail={toggleDetail}
            />
          )}
        </div>
      </div>
    </div>
  )
})

export default SubagentRound
