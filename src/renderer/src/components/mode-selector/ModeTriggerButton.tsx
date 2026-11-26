import React from 'react'
import { ChevronDown } from '../../icons'
import { SmoothActivityLabel } from '../ActivityLabel'
import { ModelOption, ReasoningEffort } from './types'

interface ModeTriggerButtonProps {
  activeModel: ModelOption
  activeEffort: ReasoningEffort
  isOpen: boolean
  onClick: () => void
}

export const ModeTriggerButton: React.FC<ModeTriggerButtonProps> = ({
  activeModel,
  activeEffort,
  isOpen,
  onClick
}) => {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={`Модель: ${activeModel.displayName}, мощность: ${activeEffort}`}
      aria-expanded={isOpen}
      className={`
        h-[34px] max-w-full rounded-full px-3 flex items-center justify-center gap-1.5
        transition-all duration-250 cursor-pointer select-none focus:outline-none border-none shadow-none
        ${
          isOpen
            ? 'bg-control text-primary'
            : 'bg-transparent hover:bg-hover active:scale-95 text-secondary hover:text-primary'
        }
      `}
    >
      <span className="text-[14px] font-medium tracking-tight whitespace-nowrap inline-flex items-center">
        <SmoothActivityLabel text={`${activeModel.shortName} · ${activeEffort}`} />
      </span>
      <ChevronDown
        size={14}
        strokeWidth={2.2}
        className={`transition-transform duration-250 text-secondary shrink-0 ${
          isOpen ? 'rotate-180 text-strong' : ''
        }`}
      />
    </button>
  )
}
