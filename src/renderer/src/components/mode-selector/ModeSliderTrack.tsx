import React from 'react'
import { REASONING_LEVELS } from './constants'
import { ReasoningEffort } from './types'

interface ModeSliderTrackProps {
  trackRef: React.RefObject<HTMLDivElement>
  pointerHandlers: {
    onPointerDown: (e: React.PointerEvent<HTMLDivElement>) => void
    onPointerMove: (e: React.PointerEvent<HTMLDivElement>) => void
    onPointerUp: (e: React.PointerEvent<HTMLDivElement>) => void
    onPointerCancel: () => void
    onMouseLeave: () => void
  }
  activeEffort: ReasoningEffort
  onSelectEffort: (effort: ReasoningEffort) => void
  isDragging: boolean
  currentFraction: number
  activeFillWidthStyle: string
  maxOpacity: number
  isMax: boolean
  isUncensored: boolean
  hoveredIndex: number | null
  thumbLeftStyle: string
}

export const ModeSliderTrack: React.FC<ModeSliderTrackProps> = ({
  trackRef,
  pointerHandlers,
  activeEffort,
  onSelectEffort,
  isDragging,
  currentFraction,
  activeFillWidthStyle,
  maxOpacity,
  isMax,
  isUncensored,
  hoveredIndex,
  thumbLeftStyle
}) => {
  return (
    <div className="flex flex-col gap-1.5">
      <div
        ref={trackRef}
        role="slider"
        tabIndex={0}
        aria-label="Уровень мышления"
        aria-valuemin={0}
        aria-valuemax={REASONING_LEVELS.length - 1}
        aria-valuenow={REASONING_LEVELS.findIndex(r => r.value === activeEffort)}
        aria-valuetext={activeEffort}
        onPointerDown={pointerHandlers.onPointerDown}
        onPointerMove={pointerHandlers.onPointerMove}
        onPointerUp={pointerHandlers.onPointerUp}
        onPointerCancel={pointerHandlers.onPointerCancel}
        onMouseLeave={pointerHandlers.onMouseLeave}
        className="relative w-full h-[28px] flex items-center cursor-pointer select-none touch-none"
      >
        {/* Track Bar (22px) */}
        <div className="relative w-full h-[22px] bg-track rounded-full overflow-hidden flex items-center">
          {/* Primary active fill */}
          <div
            className={`absolute left-0 top-0 bottom-0 rounded-full pointer-events-none ${
              activeEffort === 'off'
                ? 'bg-control-hover'
                : isUncensored
                  ? 'bg-diff-remove'
                  : 'bg-accent'
            }`}
            style={{
              width: activeFillWidthStyle,
              transition: isDragging
                ? 'none'
                : 'width 260ms cubic-bezier(0.34, 1.45, 0.64, 1), background-color 250ms ease-out'
            }}
          />

          {/* Max accent fades in over base fill */}
          <div
            className={`absolute left-0 top-0 bottom-0 rounded-full pointer-events-none ${
              isUncensored
                ? 'bg-[#FF9F0A]'
                : 'bg-gradient-to-r from-[#8B5CF6] via-[#6366F1] to-[#0A84FF]'
            }`}
            style={{
              width: activeFillWidthStyle,
              opacity: maxOpacity,
              transition: isDragging
                ? 'none'
                : 'width 260ms cubic-bezier(0.34, 1.45, 0.64, 1), opacity 350ms cubic-bezier(0.22, 1, 0.36, 1)'
            }}
          />

          {/* Four reasoning effort steps */}
          {REASONING_LEVELS.map((level, idx) => {
            const fraction = idx / (REASONING_LEVELS.length - 1)
            const isCovered = Math.abs(currentFraction - fraction) < 0.08
            const isFilled = fraction < currentFraction - 0.04
            const isHovered = hoveredIndex === idx

            return (
              <div
                key={level.value}
                className={`
                  absolute top-1/2 -translate-y-1/2 -translate-x-1/2
                  w-[4.5px] h-[4.5px] rounded-full pointer-events-none
                  transition-all duration-200 ease-out
                  ${
                    isCovered
                      ? 'opacity-0 scale-75'
                      : isHovered
                        ? isFilled
                          ? 'bg-white opacity-100 scale-[1.7]'
                          : 'bg-primary opacity-100 scale-[1.6]'
                        : isFilled
                          ? isMax
                            ? isUncensored
                              ? 'bg-[#FFE4C7] opacity-90 scale-100'
                              : 'bg-[#E2E8F0] opacity-90 scale-100'
                            : isUncensored
                              ? 'bg-[#FFD1CC] opacity-90 scale-100'
                              : 'bg-[#BFE0FF] opacity-90 scale-100'
                          : 'bg-muted opacity-80 scale-100'
                  }
                `}
                style={{
                  left: `calc(14px + (100% - 28px) * ${fraction})`
                }}
              />
            )
          })}
        </div>

        {/* Circular Thumb Knob */}
        <div
          className={`
            absolute top-1/2 -translate-y-1/2 w-[28px] h-[28px] rounded-full bg-white
            flex items-center justify-center
            cursor-grab active:cursor-grabbing pointer-events-none z-10
            ${isDragging ? 'scale-[1.08]' : 'hover:scale-[1.04]'}
          `}
          style={{
            left: thumbLeftStyle,
            boxShadow: 'none',
            transition: isDragging
              ? 'transform 150ms ease'
              : 'left 260ms cubic-bezier(0.34, 1.45, 0.64, 1), transform 150ms ease'
          }}
        />
      </div>

      {/* Clickable step labels */}
      <div className="grid grid-cols-4 gap-1 px-0.5">
        {REASONING_LEVELS.map(level => {
          const selected = level.value === activeEffort
          return (
            <button
              key={level.value}
              type="button"
              onClick={() => onSelectEffort(level.value)}
              className={`py-0.5 rounded-full text-[12px] font-medium text-center transition-colors border-none shadow-none cursor-pointer focus:outline-none ${
                selected
                  ? 'text-primary bg-control'
                  : 'text-muted hover:text-secondary bg-transparent'
              }`}
            >
              {level.label}
            </button>
          )
        })}
      </div>
    </div>
  )
}
