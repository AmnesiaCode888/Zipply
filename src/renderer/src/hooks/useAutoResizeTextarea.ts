import { useRef, useEffect } from 'react'

interface AutoResizeOptions {
  value: string
  maxHeight?: number
}

// SRP: Only responsible for auto-height calculation logic on a textarea.
export function useAutoResizeTextarea({ value, maxHeight = 180 }: AutoResizeOptions) {
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    const textarea = textareaRef.current
    if (!textarea) return
    const resize = () => {
      textarea.style.height = 'auto'
      const scrollH = textarea.scrollHeight
      textarea.style.height = `${Math.min(scrollH, maxHeight)}px`
      textarea.style.overflowY = scrollH > maxHeight ? 'auto' : 'hidden'
    }
    resize()
    const observer = new ResizeObserver(resize)
    observer.observe(textarea)
    return () => observer.disconnect()
  }, [value, maxHeight])

  return textareaRef
}
