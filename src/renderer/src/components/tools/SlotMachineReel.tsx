import React, { useState, useEffect, useRef } from 'react'
import { Brain } from 'lucide-react'
import { StepItem } from '../../types/chat'
import { getStepIcon, formatStepTitle } from './ToolViewerRegistry'

export interface SlotMachineReelProps {
  activeStep?: StepItem
}

export const SlotMachineReel: React.FC<SlotMachineReelProps> = ({ activeStep }) => {
  const [currentStep, setCurrentStep] = useState<StepItem | undefined>(activeStep)
  const [prevStep, setPrevStep] = useState<StepItem | undefined>(undefined)
  const [isAnimating, setIsAnimating] = useState(false)
  const prevStepRef = useRef<StepItem | undefined>(activeStep)

  useEffect(() => {
    if (!activeStep) return

    if (prevStepRef.current && prevStepRef.current.id !== activeStep.id) {
      setPrevStep(prevStepRef.current)
      setCurrentStep(activeStep)
      setIsAnimating(true)

      const timer = setTimeout(() => {
        setIsAnimating(false)
        setPrevStep(undefined)
      }, 380)

      prevStepRef.current = activeStep
      return () => clearTimeout(timer)
    } else {
      setCurrentStep(activeStep)
      prevStepRef.current = activeStep
      return undefined
    }
  }, [activeStep?.id])

  if (!currentStep) {
    return (
      <div className="slot-machine-viewport">
        <div className="reel-item reel-current">
          <span className="step-icon-wrapper">
            <Brain size={14} className="step-type-icon" />
          </span>
          <span className="streaming-text">Thinking...</span>
        </div>
      </div>
    )
  }

  return (
    <div className="slot-machine-viewport">
      {/* Exiting previous step item */}
      {isAnimating && prevStep && (
        <div className="reel-item reel-exit">
          <span className="step-icon-wrapper">
            {getStepIcon(prevStep.type)}
          </span>
          <span className="streaming-text">{formatStepTitle(prevStep)}</span>
          {prevStep.stats && (
            <div className="step-stats-group">
              {prevStep.stats.add !== undefined && (
                <span className="step-stat-add mono">+{prevStep.stats.add}</span>
              )}
              {prevStep.stats.del !== undefined && (
                <span className="step-stat-del mono">−{prevStep.stats.del}</span>
              )}
            </div>
          )}
        </div>
      )}

      {/* Entering current step item */}
      <div className={`reel-item ${isAnimating ? 'reel-enter' : 'reel-current'}`}>
        <span className="step-icon-wrapper">
          {getStepIcon(currentStep.type)}
        </span>
        <span className="streaming-text">{formatStepTitle(currentStep)}</span>
        {currentStep.stats && (
          <div className="step-stats-group">
            {currentStep.stats.add !== undefined && (
              <span className="step-stat-add mono">+{currentStep.stats.add}</span>
            )}
            {currentStep.stats.del !== undefined && (
              <span className="step-stat-del mono">−{currentStep.stats.del}</span>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

export default SlotMachineReel
