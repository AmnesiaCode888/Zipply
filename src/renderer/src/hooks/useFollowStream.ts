import { useCallback, useEffect, useRef } from 'react'

export function isNearBottom(element: Pick<HTMLElement, 'scrollHeight' | 'clientHeight' | 'scrollTop'>): boolean {
  return element.scrollHeight - element.clientHeight - element.scrollTop <= 32
}

export function useFollowStream(content: string | undefined, active: boolean) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const following = useRef(true)

  const handleScroll = useCallback(() => {
    if (scrollRef.current) following.current = isNearBottom(scrollRef.current)
  }, [])

  useEffect(() => {
    const element = scrollRef.current
    if (active && element && following.current) element.scrollTop = element.scrollHeight
  }, [content, active])

  return { scrollRef, handleScroll }
}
