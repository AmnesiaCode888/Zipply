import { useState, useRef, useEffect, useCallback } from 'react'
import { ReasoningEffort } from './types'
import {
  DEFAULT_MODEL_ID,
  DEFAULT_REASONING_EFFORT,
  REASONING_LEVELS,
  resolveModelOption,
  resolveReasoningLevel
} from './constants'

interface UseModeSliderProps {
  model?: string
  reasoningEffort?: ReasoningEffort
  onModelChange?: (modelId: string) => void
  onReasoningEffortChange?: (effort: ReasoningEffort) => void
}

export function useModeSlider({
  model,
  reasoningEffort,
  onModelChange,
  onReasoningEffortChange
}: UseModeSliderProps) {
  const [internalModel, setInternalModel] = useState<string>(DEFAULT_MODEL_ID)
  const [internalEffort, setInternalEffort] = useState<ReasoningEffort>(DEFAULT_REASONING_EFFORT)
  const [isOpen, setIsOpen] = useState(false)
  const [isDragging, setIsDragging] = useState(false)
  const [dragFraction, setDragFraction] = useState<number | null>(null)
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null)
  const [isResetSpinning, setIsResetSpinning] = useState(false)

  const containerRef = useRef<HTMLDivElement>(null)
  const trackRef = useRef<HTMLDivElement>(null)
  const pointerStartPos = useRef<{ x: number; y: number } | null>(null)

  const activeModel = resolveModelOption(model ?? internalModel)
  const activeEffortInfo = resolveReasoningLevel(reasoningEffort ?? internalEffort)
  const activeEffort = activeEffortInfo.value
  const activeIndex = REASONING_LEVELS.findIndex(item => item.value === activeEffort)
  const safeIndex = activeIndex === -1 ? 2 : activeIndex

  const setEffort = useCallback(
    (next: ReasoningEffort) => {
      setInternalEffort(next)
      onReasoningEffortChange?.(next)
    },
    [onReasoningEffortChange]
  )

  const setModel = useCallback(
    (nextModelId: string) => {
      setInternalModel(nextModelId)
      onModelChange?.(nextModelId)
    },
    [onModelChange]
  )

  const isDefault =
    activeModel.id === DEFAULT_MODEL_ID && activeEffort === DEFAULT_REASONING_EFFORT

  const handleReset = useCallback(
    (e: React.MouseEvent): void => {
      e.stopPropagation()
      setIsResetSpinning(true)
      setModel(DEFAULT_MODEL_ID)
      setEffort(DEFAULT_REASONING_EFFORT)
      setTimeout(() => setIsResetSpinning(false), 450)
    },
    [setEffort, setModel]
  )

  useEffect(() => {
    if (!isOpen) return

    const handleClickOutside = (e: MouseEvent): void => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false)
      }
    }

    const handleKeyDown = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        setIsOpen(false)
      } else if (!containerRef.current?.contains(e.target as Node)) {
        return
      } else if (e.key === 'ArrowRight' || e.key === 'ArrowUp') {
        e.preventDefault()
        const next = Math.min(REASONING_LEVELS.length - 1, safeIndex + 1)
        setEffort(REASONING_LEVELS[next].value)
      } else if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') {
        e.preventDefault()
        const prev = Math.max(0, safeIndex - 1)
        setEffort(REASONING_LEVELS[prev].value)
      }
    }

    document.addEventListener('mousedown', handleClickOutside)
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [isOpen, safeIndex, setEffort])

  const computeStepFromPointer = useCallback(
    (clientX: number): { index: number; fraction: number } => {
      if (!trackRef.current) {
        return { index: safeIndex, fraction: safeIndex / (REASONING_LEVELS.length - 1) }
      }
      const rect = trackRef.current.getBoundingClientRect()
      const travel = Math.max(1, rect.width - 28)
      const relX = clientX - (rect.left + 14)
      const fraction = Math.max(0, Math.min(1, relX / travel))
      const nearestIndex = Math.round(fraction * (REASONING_LEVELS.length - 1))
      return { index: nearestIndex, fraction }
    },
    [safeIndex]
  )

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>): void => {
    e.preventDefault()
    e.stopPropagation()
    pointerStartPos.current = { x: e.clientX, y: e.clientY }
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)

    const { index, fraction } = computeStepFromPointer(e.clientX)
    setEffort(REASONING_LEVELS[index].value)
    setDragFraction(fraction)
  }

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>): void => {
    if (!isDragging && !pointerStartPos.current) {
      const { index } = computeStepFromPointer(e.clientX)
      setHoveredIndex(index)
      return
    }

    if (!pointerStartPos.current) return
    e.preventDefault()

    const dx = Math.abs(e.clientX - pointerStartPos.current.x)
    const dy = Math.abs(e.clientY - pointerStartPos.current.y)

    if (!isDragging && (dx > 3 || dy > 3)) {
      setIsDragging(true)
    }

    const { index, fraction } = computeStepFromPointer(e.clientX)
    setDragFraction(fraction)
    const targetEffort = REASONING_LEVELS[index].value
    if (targetEffort !== activeEffort) {
      setEffort(targetEffort)
    }
  }

  const handlePointerUp = (e: React.PointerEvent<HTMLDivElement>): void => {
    e.preventDefault()
    pointerStartPos.current = null
    setIsDragging(false)
    setDragFraction(null)
    const { index } = computeStepFromPointer(e.clientX)
    setEffort(REASONING_LEVELS[index].value)
  }

  const handlePointerCancel = (): void => {
    pointerStartPos.current = null
    setIsDragging(false)
    setDragFraction(null)
    setHoveredIndex(null)
  }

  const handleMouseLeave = (): void => {
    if (!isDragging) {
      setHoveredIndex(null)
    }
  }

  const currentFraction =
    isDragging && dragFraction !== null
      ? dragFraction
      : safeIndex / (REASONING_LEVELS.length - 1)

  const maxStartFraction = (REASONING_LEVELS.length - 2) / (REASONING_LEVELS.length - 1)
  const maxProgress =
    currentFraction > maxStartFraction
      ? Math.min(1, Math.max(0, (currentFraction - maxStartFraction) / (1 - maxStartFraction)))
      : 0

  const maxOpacity = isDragging ? maxProgress : safeIndex === REASONING_LEVELS.length - 1 ? 1 : 0
  const isMax = activeEffort === 'max'

  const thumbLeftStyle = `calc((100% - 28px) * ${currentFraction})`
  const activeFillWidthStyle =
    currentFraction >= 0.98 ? '100%' : `calc(22px + (100% - 28px) * ${currentFraction})`

  return {
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
    pointerHandlers: {
      onPointerDown: handlePointerDown,
      onPointerMove: handlePointerMove,
      onPointerUp: handlePointerUp,
      onPointerCancel: handlePointerCancel,
      onMouseLeave: handleMouseLeave
    }
  }
}
