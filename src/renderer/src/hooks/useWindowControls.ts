import { useState, useEffect, useCallback } from 'react'

export interface WindowControls {
  isMaximized: boolean
  minimize: () => void
  maximize: () => Promise<void>
  close: () => void
}

/**
 * Custom hook encapsulating Electron window control APIs with safe fallbacks
 */
export function useWindowControls(): WindowControls {
  const [isMaximized, setIsMaximized] = useState(false)

  useEffect(() => {
    let isMounted = true

    if (window.api?.window?.isMaximized) {
      window.api.window.isMaximized()
        .then((max) => {
          if (isMounted) {
            setIsMaximized(max)
          }
        })
        .catch(() => {})
    }

    return () => {
      isMounted = false
    }
  }, [])

  const minimize = useCallback((): void => {
    window.api?.window?.minimize?.()
  }, [])

  const maximize = useCallback(async (): Promise<void> => {
    try {
      const state = await window.api?.window?.maximize?.()
      setIsMaximized(Boolean(state))
    } catch {
      // safe fallback
    }
  }, [])

  const close = useCallback((): void => {
    window.api?.window?.close?.()
  }, [])

  return {
    isMaximized,
    minimize,
    maximize,
    close
  }
}

export default useWindowControls
