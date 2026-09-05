import React, { useState, useEffect, useRef } from 'react'
import { Sparkles, Zap, Brain, Clock, Bot } from 'lucide-react'
import { StepItem } from '../../types/chat'
import { getStepIcon, formatStepTitle } from './ToolViewerRegistry'

export interface SlotMachineReelProps {
  activeStep?: StepItem
}

interface ReelItemData {
  id: string
  icon: React.ReactNode
  text: string
  isStarting?: boolean
  stats?: { add?: number; del?: number }
}

const STARTING_STATUSES: { text: string; getIcon: () => React.ReactNode }[] = [
  {
    text: 'Начинаю...',
    getIcon: () => <Sparkles size={14} className="step-type-icon starting-pulse-icon" />
  },
  {
    text: 'Подключаюсь к модели...',
    getIcon: () => <Zap size={14} className="step-type-icon starting-pulse-icon" />
  },
  {
    text: 'Анализирую задачу...',
    getIcon: () => <Brain size={14} className="step-type-icon starting-pulse-icon" />
  },
  {
    text: 'Скоро начнет ответ...',
    getIcon: () => <Clock size={14} className="step-type-icon starting-pulse-icon" />
  },
  {
    text: 'Готовлю решение...',
    getIcon: () => <Bot size={14} className="step-type-icon starting-pulse-icon" />
  }
]

export const SlotMachineReel: React.FC<SlotMachineReelProps> = ({ activeStep }) => {
  const [startingIndex, setStartingIndex] = useState(0)

  // Current item reference for transitions
  const currentItemRef = useRef<ReelItemData>({
    id: activeStep?.id || 'start-0',
    icon: activeStep
      ? getStepIcon(activeStep.type)
      : STARTING_STATUSES[0].getIcon(),
    text: activeStep
      ? formatStepTitle(activeStep)
      : STARTING_STATUSES[0].text,
    isStarting: !activeStep,
    stats: activeStep?.stats
  })

  const [currentDisplay, setCurrentDisplay] = useState<ReelItemData>(currentItemRef.current)
  const [prevDisplay, setPrevDisplay] = useState<ReelItemData | undefined>(undefined)
  const [isAnimating, setIsAnimating] = useState(false)
  const animTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const triggerTransition = (newItem: ReelItemData): void => {
    if (animTimerRef.current) {
      clearTimeout(animTimerRef.current)
      animTimerRef.current = null
    }

    setPrevDisplay(currentItemRef.current)
    setCurrentDisplay(newItem)
    currentItemRef.current = newItem
    setIsAnimating(true)

    animTimerRef.current = setTimeout(() => {
      setIsAnimating(false)
      setPrevDisplay(undefined)
      animTimerRef.current = null
    }, 380)
  }

  // 1. Cycle starting statuses every 1.8s while activeStep is absent
  useEffect(() => {
    if (activeStep) return

    const interval = setInterval(() => {
      setStartingIndex((prev) => (prev + 1) % STARTING_STATUSES.length)
    }, 1800)

    return () => clearInterval(interval)
  }, [activeStep])

  // 2. Handle starting index change when waiting for the first step
  useEffect(() => {
    if (activeStep) return

    const cfg = STARTING_STATUSES[startingIndex]
    const newItem: ReelItemData = {
      id: `start-${startingIndex}`,
      icon: cfg.getIcon(),
      text: cfg.text,
      isStarting: true
    }

    if (currentItemRef.current.id !== newItem.id) {
      triggerTransition(newItem)
    }
  }, [startingIndex, activeStep])

  // 3. Handle activeStep changes (from starting status to tool, or tool to tool)
  useEffect(() => {
    if (!activeStep) return

    const newItem: ReelItemData = {
      id: activeStep.id,
      icon: getStepIcon(activeStep.type),
      text: formatStepTitle(activeStep),
      isStarting: false,
      stats: activeStep.stats
    }

    if (currentItemRef.current.id !== newItem.id) {
      triggerTransition(newItem)
    } else {
      currentItemRef.current = newItem
      setCurrentDisplay(newItem)
    }
  }, [activeStep?.id, activeStep?.stats?.add, activeStep?.stats?.del, activeStep?.result, activeStep?.action, activeStep?.target])

  useEffect(() => {
    return () => {
      if (animTimerRef.current) {
        clearTimeout(animTimerRef.current)
      }
    }
  }, [])

  return (
    <div className="slot-machine-viewport">
      {/* Exiting previous step item */}
      {isAnimating && prevDisplay && (
        <div className="reel-item reel-exit">
          <span className="step-icon-wrapper">
            {prevDisplay.icon}
          </span>
          <span className={`streaming-text ${prevDisplay.isStarting ? 'starting-status-text' : ''}`}>
            {prevDisplay.text}
          </span>
          {prevDisplay.stats && (
            <div className="step-stats-group">
              {prevDisplay.stats.add !== undefined && (
                <span className="step-stat-add mono">+{prevDisplay.stats.add}</span>
              )}
              {prevDisplay.stats.del !== undefined && (
                <span className="step-stat-del mono">−{prevDisplay.stats.del}</span>
              )}
            </div>
          )}
        </div>
      )}

      {/* Entering current step item */}
      <div className={`reel-item ${isAnimating ? 'reel-enter' : 'reel-current'}`}>
        <span className="step-icon-wrapper">
          {currentDisplay.icon}
        </span>
        <span className={`streaming-text ${currentDisplay.isStarting ? 'starting-status-text' : ''}`}>
          {currentDisplay.text}
        </span>
        {currentDisplay.stats && (
          <div className="step-stats-group">
            {currentDisplay.stats.add !== undefined && (
              <span className="step-stat-add mono">+{currentDisplay.stats.add}</span>
            )}
            {currentDisplay.stats.del !== undefined && (
              <span className="step-stat-del mono">−{currentDisplay.stats.del}</span>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

export default SlotMachineReel
