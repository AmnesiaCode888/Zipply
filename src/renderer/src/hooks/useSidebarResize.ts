import { appStorage } from '../services/appStorage'
import { useState, useCallback, useEffect, useRef } from 'react'

const STORAGE_KEY = 'zipply_sidebar_width'
const DEFAULT_WIDTH = 260
const MIN_WIDTH = 200
const MAX_WIDTH = 460

export function useSidebarResize() {
  const [width, setWidth] = useState<number>(() => {
    try {
      const saved = appStorage.getItem(STORAGE_KEY)
      if (saved) {
        const parsed = Number(saved)
        if (!isNaN(parsed) && parsed >= MIN_WIDTH && parsed <= MAX_WIDTH) {
          return parsed
        }
      }
    } catch {
      // ignore localStorage errors in non-browser or sandbox environments
    }
    return DEFAULT_WIDTH
  })

  const [isResizing, setIsResizing] = useState(false)
  const widthRef = useRef(width)
  widthRef.current = width

  const startResizing = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setIsResizing(true)
  }, [])

  const resetWidth = useCallback(() => {
    setWidth(DEFAULT_WIDTH)
    try {
      appStorage.setItem(STORAGE_KEY, String(DEFAULT_WIDTH))
    } catch {
      // ignore
    }
  }, [])

  useEffect(() => {
    if (!isResizing) return

    let frame = 0
    let pendingWidth = widthRef.current
    const handleMouseMove = (e: MouseEvent) => {
      pendingWidth = Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, e.clientX - 56))
      if (!frame) frame = requestAnimationFrame(() => {
        frame = 0
        widthRef.current = pendingWidth
        setWidth(pendingWidth)
      })
    }

    const handleMouseUp = () => {
      if (frame) cancelAnimationFrame(frame)
      frame = 0
      widthRef.current = pendingWidth
      setWidth(pendingWidth)
      setIsResizing(false)
      try {
        appStorage.setItem(STORAGE_KEY, String(pendingWidth))
      } catch {
        // ignore
      }
    }

    document.addEventListener('mousemove', handleMouseMove)
    document.addEventListener('mouseup', handleMouseUp)
    window.addEventListener('blur', handleMouseUp)
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'

    return () => {
      if (frame) cancelAnimationFrame(frame)
      document.removeEventListener('mousemove', handleMouseMove)
      document.removeEventListener('mouseup', handleMouseUp)
      window.removeEventListener('blur', handleMouseUp)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }
  }, [isResizing])

  return {
    sidebarWidth: width,
    isResizing,
    startResizing,
    resetWidth
  }
}
