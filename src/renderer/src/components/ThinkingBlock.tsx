import React, { useState, useEffect, useRef } from 'react'
import { ChevronDown } from '../icons'
import { useFollowStream } from '../hooks/useFollowStream'
import { ActivityLabel } from './ActivityLabel'

interface ThinkingBlockProps {
  content: string
  durationSec?: number
  startedAt?: number
  isStreaming?: boolean
  initialExpanded?: boolean
  onExpandedChange?: (expanded: boolean) => void
}

/**
 * ThinkingBlock
 *
 * Minimalist Thought block matching Zipply's compact metadata stream (Read / Search / Thought):
 * - Zero extra icons (no sparkles or heavy badges)
 * - Exact same typography as Search / Read: text-[15px] font-sans leading-[22px] text-[#8A8A8A]
 * - Smooth inline accordion with subtle ChevronDown
 * - Live real-time counter during streaming: "Размышляет (X с)…"
 * - Compact fixed max-height (max-h-[190px]) with internal scrolling (code-scrollbar)
 * - Auto-scrolls to the bottom during live streaming so user always sees newest thoughts
 * - Free mouse-wheel scrolling for inspecting past thoughts without bloating the canvas
 */
export const ThinkingBlock: React.FC<ThinkingBlockProps> = ({
  content,
  durationSec,
  startedAt,
  isStreaming = false,
  initialExpanded = false,
  onExpandedChange
}) => {
  const [isExpanded, setIsExpanded] = useState(initialExpanded)
  const [keepBodyMounted, setKeepBodyMounted] = useState(initialExpanded)
  useEffect(() => {
    if (isExpanded) { setKeepBodyMounted(true); return }
    if (!keepBodyMounted) return
    const timer = window.setTimeout(() => setKeepBodyMounted(false), 200)
    return () => window.clearTimeout(timer)
  }, [isExpanded, keepBodyMounted])
  const { scrollRef, handleScroll } = useFollowStream(content, isExpanded && isStreaming)

  const mountTimeRef = useRef<number>(startedAt || Date.now())
  const effectiveStartedAt = startedAt || mountTimeRef.current

  const [liveSec, setLiveSec] = useState<number>(() => {
    if (durationSec !== undefined) return durationSec
    return Math.max(1, Math.round((Date.now() - effectiveStartedAt) / 1000))
  })

  useEffect(() => {
    if (!isStreaming) {
      if (durationSec !== undefined) {
        setLiveSec(durationSec)
      }
      return
    }

    const start = startedAt || mountTimeRef.current
    const tick = () => {
      const now = Date.now()
      const elapsed = Math.max(1, Math.round((now - start) / 1000))
      setLiveSec(elapsed)
    }

    tick()
    const interval = setInterval(tick, 1000)
    return () => clearInterval(interval)
  }, [isStreaming, startedAt, durationSec])

  const cleanContent = (content || '')
    .replace(/<\/?thought>/gi, '')
    .replace(/<\/?think>/gi, '')
    .trim()

  const displaySec = durationSec !== undefined ? durationSec : (startedAt !== undefined || isStreaming ? liveSec : undefined)

  const labelText = isStreaming
    ? `Размышляет (${liveSec} с)…`
    : displaySec !== undefined
      ? `Размышлял ${displaySec} с`
      : 'Размышлял'

  return (
    <div className="w-full flex flex-col items-start select-text">
      <button
        type="button"
        onClick={() => { const next = !isExpanded; setIsExpanded(next); onExpandedChange?.(next) }}
        className="group inline-flex items-center gap-1.5 text-[15px] font-sans leading-[22px] text-secondary hover:text-primary transition-colors cursor-pointer select-none border-none shadow-none focus:outline-none bg-transparent p-0"
      >
        <ActivityLabel variant="access" shining={isStreaming} text={labelText} />
        <ChevronDown
          size={14}
          strokeWidth={1.8}
          className={`shrink-0 text-secondary group-hover:text-primary transition-transform duration-200 ease-out ${
            isExpanded ? 'rotate-180' : 'rotate-0'
          }`}
        />
      </button>

      <div
        className={`w-full grid transition-[grid-template-rows,opacity,margin] duration-200 ease-out motion-reduce:transition-none ${
          isExpanded && cleanContent
            ? 'grid-rows-[1fr] opacity-100 pointer-events-auto mt-1'
            : 'grid-rows-[0fr] opacity-0 pointer-events-none mt-0'
        }`}
      >
        <div className="min-h-0 overflow-hidden">
          {(isExpanded || keepBodyMounted) && cleanContent && (
            <div
              ref={scrollRef}
              onScroll={handleScroll}
              className="w-full max-h-[190px] overflow-y-auto pl-3.5 pr-2 py-1.5 rounded-[14px] bg-surface-secondary text-[15.5px] font-sans leading-[25px] text-secondary select-text break-words whitespace-pre-wrap code-scrollbar border-none shadow-none"
            >
              {cleanContent}
              {isStreaming && (
                <span className="inline-block w-1.5 h-3 ml-1 bg-primary opacity-60 align-middle" />
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

export default ThinkingBlock
