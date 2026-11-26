import { useEffect } from 'react'

interface AppShortcutsOptions {
  onNewChat?: () => void
}

/**
 * Handles global application keyboard shortcuts.
 * - Cmd/Ctrl + N: Create new chat
 * - Cmd/Ctrl + Plus / Equal: Zoom in
 * - Cmd/Ctrl + Minus: Zoom out
 * - Cmd/Ctrl + 0: Reset zoom
 */
export function useAppShortcuts({ onNewChat }: AppShortcutsOptions) {
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const isCtrlOrMeta = e.metaKey || e.ctrlKey

      if (isCtrlOrMeta && e.key.toLowerCase() === 'n') {
        e.preventDefault()
        onNewChat?.()
        return
      }

      if (isCtrlOrMeta && (e.key === '=' || e.key === '+')) {
        e.preventDefault()
        window.api?.zoomIn?.()
        return
      }

      if (isCtrlOrMeta && (e.key === '-' || e.key === '_')) {
        e.preventDefault()
        window.api?.zoomOut?.()
        return
      }

      if (isCtrlOrMeta && e.key === '0') {
        e.preventDefault()
        window.api?.resetZoom?.()
        return
      }
    }

    const handleWheel = (e: WheelEvent) => {
      if (e.ctrlKey) {
        e.preventDefault()
        if (e.deltaY < 0) {
          window.api?.zoomIn?.()
        } else if (e.deltaY > 0) {
          window.api?.zoomOut?.()
        }
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    window.addEventListener('wheel', handleWheel, { passive: false })
    return () => {
      window.removeEventListener('keydown', handleKeyDown)
      window.removeEventListener('wheel', handleWheel)
    }
  }, [onNewChat])
}
