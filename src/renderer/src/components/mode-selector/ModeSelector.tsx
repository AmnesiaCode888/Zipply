import React from 'react'
import { ModeSelectorProps } from './types'
import { useModeSlider } from './useModeSlider'
import { ModePopover } from './ModePopover'
import { ModeTriggerButton } from './ModeTriggerButton'

export const ModeSelector: React.FC<ModeSelectorProps> = ({
  model,
  reasoningEffort,
  onModelChange,
  onReasoningEffortChange,
  uncensoredMode = false
}) => {
  const {
    containerRef,
    trackRef,
    isOpen,
    setIsOpen,
    activeModel,
    activeEffort,
    activeEffortInfo,
    setModel,
    setEffort,
    isDefault,
    isDragging,
    hoveredIndex,
    isResetSpinning,
    handleReset,
    currentFraction,
    maxOpacity,
    isMax,
    thumbLeftStyle,
    activeFillWidthStyle,
    pointerHandlers
  } = useModeSlider({
    model,
    reasoningEffort,
    onModelChange,
    onReasoningEffortChange
  })

  return (
    <div ref={containerRef} className="relative inline-flex items-center select-none">
      <ModePopover
        isOpen={isOpen}
        activeModel={activeModel}
        activeEffort={activeEffort}
        activeEffortInfo={activeEffortInfo}
        onSelectModel={setModel}
        onSelectEffort={setEffort}
        isDefault={isDefault}
        isMax={isMax}
        isUncensored={uncensoredMode}
        isResetSpinning={isResetSpinning}
        onReset={handleReset}
        trackRef={trackRef}
        pointerHandlers={pointerHandlers}
        isDragging={isDragging}
        currentFraction={currentFraction}
        activeFillWidthStyle={activeFillWidthStyle}
        maxOpacity={maxOpacity}
        hoveredIndex={hoveredIndex}
        thumbLeftStyle={thumbLeftStyle}
      />

      <ModeTriggerButton
        activeModel={activeModel}
        activeEffort={activeEffort}
        isOpen={isOpen}
        onClick={() => setIsOpen(prev => !prev)}
      />
    </div>
  )
}
