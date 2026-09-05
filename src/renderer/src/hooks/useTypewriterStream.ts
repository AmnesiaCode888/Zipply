import { useState, useEffect, useRef } from 'react'

export interface UseTypewriterStreamOptions {
  onCharRendered?: () => void
}

export interface UseTypewriterStreamReturn {
  displayedText: string
  isTyping: boolean
}

/**
 * Long texts skip the frame-by-frame typewriter entirely: re-parsing the whole markdown
 * at 60fps for multi-KB answers is the #1 cause of UI lag during streaming.
 * Short snippets keep the animated effect.
 */
const TYPEWRITER_MAX_LENGTH = 1500

/**
 * Custom hook that animates streaming text with a smooth, adaptive character-by-character
 * typewriter effect that never lags behind the LLM token rate.
 */
export function useTypewriterStream(
  targetText: string = '',
  isStreaming: boolean = false,
  options?: UseTypewriterStreamOptions
): UseTypewriterStreamReturn {
  // If not streaming when mounted (e.g. history message), start directly at full length
  const [displayedLength, setDisplayedLength] = useState<number>(() => {
    return isStreaming ? 0 : (targetText ? targetText.length : 0)
  })

  const targetTextRef = useRef<string>(targetText)
  targetTextRef.current = targetText

  const isStreamingRef = useRef<boolean>(isStreaming)
  isStreamingRef.current = isStreaming

  const displayedLengthRef = useRef<number>(displayedLength)
  displayedLengthRef.current = displayedLength

  const onCharRenderedRef = useRef(options?.onCharRendered)
  onCharRenderedRef.current = options?.onCharRendered

  const rafIdRef = useRef<number | null>(null)

  useEffect(() => {
    const targetLen = targetText.length
    const currentLen = displayedLengthRef.current

    // If not streaming and we have already caught up or exceeded
    if (!isStreaming && currentLen >= targetLen) {
      if (currentLen > targetLen) {
        setDisplayedLength(targetLen)
        displayedLengthRef.current = targetLen
      }
      return
    }

    // Long content: render it all at once instead of a 60fps re-parse loop
    if (targetLen > TYPEWRITER_MAX_LENGTH) {
      if (currentLen !== targetLen) {
        displayedLengthRef.current = targetLen
        setDisplayedLength(targetLen)
      }
      return
    }

    const animate = (): void => {
      const target = targetTextRef.current
      const cur = displayedLengthRef.current
      const streaming = isStreamingRef.current
      const len = target.length
      const lag = len - cur

      if (lag <= 0) {
        if (cur > len) {
          displayedLengthRef.current = len
          setDisplayedLength(len)
        }
        rafIdRef.current = null
        return
      }

      // Adaptive rate typing step
      let step = 1

      if (!streaming) {
        // Stream completed or cancelled: catch up quickly to avoid trailing delay
        step = Math.max(2, Math.ceil(lag / 2))
        if (lag <= 5) step = lag
      } else {
        // Actively streaming tokens:
        // Tiny lag -> exactly 1 character for silky smooth typewriter feel
        if (lag <= 4) {
          step = 1
        } else if (lag <= 12) {
          step = 1
        } else if (lag <= 25) {
          step = 2
        } else if (lag <= 50) {
          step = 3
        } else if (lag <= 100) {
          step = Math.max(4, Math.ceil(lag / 12))
        } else {
          // Very fast token stream / burst: catch up smoothly without blocking
          step = Math.max(6, Math.ceil(lag / 8))
        }
      }

      // Check for UTF-16 surrogate pairs (e.g. emojis) to prevent broken character glitches
      const targetIdx = cur + step - 1
      if (targetIdx < len && targetIdx >= 0) {
        const code = target.charCodeAt(targetIdx)
        if (code >= 0xd800 && code <= 0xdbff) {
          step += 1
        }
      }

      const next = Math.min(len, cur + step)
      displayedLengthRef.current = next
      setDisplayedLength(next)

      if (onCharRenderedRef.current) {
        onCharRenderedRef.current()
      }

      if (next < len) {
        rafIdRef.current = requestAnimationFrame(animate)
      } else {
        rafIdRef.current = null
      }
    }

    if (rafIdRef.current === null) {
      rafIdRef.current = requestAnimationFrame(animate)
    }

    return () => {
      if (rafIdRef.current !== null) {
        cancelAnimationFrame(rafIdRef.current)
        rafIdRef.current = null
      }
    }
  }, [targetText, isStreaming])

  const displayedText = targetText.slice(0, displayedLength)
  const isTyping = isStreaming || displayedLength < targetText.length

  return {
    displayedText,
    isTyping
  }
}

export default useTypewriterStream
