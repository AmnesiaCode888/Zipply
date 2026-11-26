import { useRef, useEffect, useCallback } from 'react'
import { Message } from '../types/chat'

interface UseChatScrollOptions {
  messages: Message[]
}

/**
 * Encapsulates intelligent auto-scrolling behavior for chat messages:
 * - Direct instant scroll updates batched via requestAnimationFrame (0 compositor lockups).
 * - Tracks user scroll intent to prevent interrupting reading history.
 * - Dynamic height tracking (ResizeObserver) for expanding tool accordions and thinking blocks.
 */
export function useChatScroll({ messages }: UseChatScrollOptions) {
  const scrollContainerRef = useRef<HTMLDivElement>(null)
  const messagesListRef = useRef<HTMLDivElement>(null)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const isNearBottomRef = useRef(true)
  const rafIdRef = useRef<number | null>(null)
  const lastUserIdRef = useRef(findLastUserMessageId(messages))

  // Track if user has manually scrolled up to avoid interrupting reading history
  const handleScroll = useCallback(() => {
    const el = scrollContainerRef.current
    if (!el) return
    const distanceToBottom = el.scrollHeight - el.scrollTop - el.clientHeight
    isNearBottomRef.current = distanceToBottom < 160
  }, [])

  // Auto-scroll to bottom on messages update when near bottom
  useEffect(() => {
    const lastUserId = findLastUserMessageId(messages)
    if (lastUserId && lastUserId !== lastUserIdRef.current) isNearBottomRef.current = true
    lastUserIdRef.current = lastUserId
    if (!isNearBottomRef.current) return

    if (rafIdRef.current) cancelAnimationFrame(rafIdRef.current)
    rafIdRef.current = requestAnimationFrame(() => {
      const el = scrollContainerRef.current
      if (el && isNearBottomRef.current) {
        el.scrollTop = el.scrollHeight
      }
    })

    return () => {
      if (rafIdRef.current) cancelAnimationFrame(rafIdRef.current)
    }
  }, [messages])

  // ResizeObserver: follows dynamic height changes (tool cards unrolling, thinking blocks expanding)
  useEffect(() => {
    const listEl = messagesListRef.current
    if (!listEl) return

    let animId: number | null = null
    let widthSettleTimer: number | null = null
    const scrollEl = scrollContainerRef.current
    let previousWidth = scrollEl?.clientWidth ?? 0

    const observer = new ResizeObserver(() => {
      const currentWidth = scrollEl?.clientWidth ?? previousWidth
      if (Math.abs(currentWidth - previousWidth) > 0.5) {
        previousWidth = currentWidth
        if (animId) cancelAnimationFrame(animId)
        animId = null
        if (widthSettleTimer !== null) window.clearTimeout(widthSettleTimer)
        widthSettleTimer = window.setTimeout(() => {
          widthSettleTimer = null
          if (!isNearBottomRef.current) return
          animId = requestAnimationFrame(() => {
            animId = null
            const el = scrollContainerRef.current
            if (el && isNearBottomRef.current) el.scrollTop = el.scrollHeight
          })
        }, 120)
        return
      }
      if (!isNearBottomRef.current) return
      if (animId) cancelAnimationFrame(animId)
      animId = requestAnimationFrame(() => {
        animId = null
        const el = scrollContainerRef.current
        if (el && isNearBottomRef.current) {
          el.scrollTop = el.scrollHeight
        }
      })
    })

    observer.observe(listEl)
    if (scrollEl) observer.observe(scrollEl)

    return () => {
      observer.disconnect()
      if (animId) cancelAnimationFrame(animId)
      if (widthSettleTimer !== null) window.clearTimeout(widthSettleTimer)
    }
  }, [])

  return {
    scrollContainerRef,
    messagesListRef,
    messagesEndRef,
    handleScroll,
    pauseAutoScroll: () => { isNearBottomRef.current = false }
  }
}

function findLastUserMessageId(messages: Message[]): string | undefined {
  for (let index = messages.length - 1; index >= 0; index--) {
    if (messages[index].role === 'user') return messages[index].id
  }
  return undefined
}

