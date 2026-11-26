import React from 'react'
import { RotateCcw, Check } from '../../icons'
import { ActivityLabel } from '../ActivityLabel'
import { ZIPPLY_MODELS } from './constants'
import { ModelOption, ReasoningEffort, ReasoningLevelInfo } from './types'
import { ModeSliderTrack } from './ModeSliderTrack'

interface ModePopoverProps {
  isOpen: boolean
  activeModel: ModelOption
  activeEffort: ReasoningEffort
  activeEffortInfo: ReasoningLevelInfo
  onSelectModel: (modelId: string) => void
  onSelectEffort: (effort: ReasoningEffort) => void
  isDefault: boolean
  isMax: boolean
  isUncensored: boolean
  isResetSpinning: boolean
  onReset: (e: React.MouseEvent) => void
  trackRef: React.RefObject<HTMLDivElement>
  pointerHandlers: {
    onPointerDown: (e: React.PointerEvent<HTMLDivElement>) => void
    onPointerMove: (e: React.PointerEvent<HTMLDivElement>) => void
    onPointerUp: (e: React.PointerEvent<HTMLDivElement>) => void
    onPointerCancel: () => void
    onMouseLeave: () => void
  }
  isDragging: boolean
  currentFraction: number
  activeFillWidthStyle: string
  maxOpacity: number
  hoveredIndex: number | null
  thumbLeftStyle: string
}

export const ModePopover: React.FC<ModePopoverProps> = ({
  isOpen,
  activeModel,
  activeEffort,
  activeEffortInfo,
  onSelectModel,
  onSelectEffort,
  isDefault,
  isMax,
  isUncensored,
  isResetSpinning,
  onReset,
  trackRef,
  pointerHandlers,
  isDragging,
  currentFraction,
  activeFillWidthStyle,
  maxOpacity,
  hoveredIndex,
  thumbLeftStyle
}) => {
  return (
    <div
      aria-hidden={!isOpen}
      className={`
        absolute bottom-[calc(100%+8px)] right-0 z-50
        popup-glass w-[288px] rounded-[23px] p-1
        flex flex-col shadow-none border-[0.5px] border-hairline
        transition-all duration-300
        ${
          isOpen
            ? 'opacity-100 scale-100 translate-y-0 pointer-events-auto'
            : 'invisible opacity-0 scale-[0.95] translate-y-1.5 pointer-events-none'
        }
      `}
      style={{
        transformOrigin: 'bottom right',
        transitionTimingFunction: 'cubic-bezier(0.22, 1, 0.36, 1)'
      }}
    >
      <div className="px-2.5 pt-2 pb-1.5 flex flex-col gap-2.5">
        {/* Header: Reasoning Power */}
        <div className="flex items-start justify-between px-0.5">
          <div className="flex flex-col items-start select-none">
            <span className="text-[12px] font-medium text-secondary leading-none">
              Мощность
            </span>
            <span
              className={`text-[15px] font-semibold tracking-tight mt-1 leading-none transition-colors duration-250 ${
                isUncensored
                  ? isMax
                    ? 'text-[#FF9F0A]'
                    : 'text-[#FF453A]'
                  : isMax
                    ? 'text-[#A855F7]'
                    : activeEffort === 'off'
                      ? 'text-secondary'
                      : 'text-accent'
              }`}
            >
              <ActivityLabel variant="access" text={activeEffortInfo.title} />
            </span>
          </div>

          <button
            type="button"
            disabled={isDefault}
            onClick={onReset}
            title="Сбросить на Zipply Pro · high"
            aria-label="Сбросить модель и мощность по умолчанию"
            className="w-7 h-7 rounded-full flex items-center justify-center text-secondary hover:text-primary hover:bg-hover disabled:opacity-35 disabled:cursor-default transition-colors focus:outline-none cursor-pointer border-none shadow-none"
          >
            <RotateCcw
              size={13}
              strokeWidth={2.2}
              className={`transition-transform duration-450 ease-out ${
                isResetSpinning ? '-rotate-180 text-strong' : ''
              }`}
            />
          </button>
        </div>

        {/* Stepped Reasoning Effort Slider */}
        <ModeSliderTrack
          trackRef={trackRef}
          pointerHandlers={pointerHandlers}
          activeEffort={activeEffort}
          onSelectEffort={onSelectEffort}
          isDragging={isDragging}
          currentFraction={currentFraction}
          activeFillWidthStyle={activeFillWidthStyle}
          maxOpacity={maxOpacity}
          isMax={isMax}
          isUncensored={isUncensored}
          hoveredIndex={hoveredIndex}
          thumbLeftStyle={thumbLeftStyle}
        />
      </div>

      <div className="h-px bg-divider opacity-45 mx-2.5 my-1" />

      {/* Model Selection Cards */}
      <div className="flex flex-col gap-0.5" role="radiogroup" aria-label="Выбор модели">
        {ZIPPLY_MODELS.map(item => {
          const selected = item.id === activeModel.id
          return (
            <div key={item.id} className="relative group">
              <button
                type="button"
                role="radio"
                aria-checked={selected}
                aria-description={item.description}
                disabled={!item.isAvailable}
                onClick={() => {
                  if (item.isAvailable) onSelectModel(item.id)
                }}
                className={`w-full flex items-center justify-between gap-2.5 px-3 py-2.5 rounded-[19px] text-left transition-colors duration-150 border-none shadow-none focus:outline-none ${
                  !item.isAvailable
                    ? 'opacity-45 cursor-not-allowed bg-transparent'
                    : selected
                      ? 'bg-control text-primary cursor-pointer'
                      : 'bg-transparent hover:bg-hover active:bg-control-hover text-primary cursor-pointer'
                }`}
              >
                <span className="min-w-0 flex-1 truncate text-[14.5px] font-medium text-primary leading-[20px]">
                  {item.displayName}
                </span>
                {item.isAvailable && (
                  <span
                    aria-hidden="true"
                    className={`w-[18px] h-[18px] shrink-0 rounded-full flex items-center justify-center transition-colors ${
                      selected
                        ? 'bg-accent text-on-accent'
                        : 'bg-track text-transparent'
                    }`}
                  >
                    {selected && <Check size={11} strokeWidth={2.75} />}
                  </span>
                )}
              </button>
              <div
                role="tooltip"
                className="pointer-events-none absolute right-[calc(100%+10px)] top-1/2 -translate-y-1/2 translate-x-1 opacity-0 group-hover:opacity-100 group-hover:translate-x-0 group-focus-within:opacity-100 group-focus-within:translate-x-0 transition-all duration-150 popup-glass rounded-[14px] px-3 py-1.5 border-[0.5px] border-hairline shadow-none text-[12.5px] font-medium leading-[18px] text-primary whitespace-nowrap z-50"
              >
                {item.description}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
