import React, { useEffect, useLayoutEffect, useRef, useState } from 'react'

export const ActivityLabel: React.FC<{ text: string; variant?: 'access'; shining?: boolean }> = ({ text, variant, shining = false }) => {
  const [displayed, setDisplayed] = useState(text)
  const [erasing, setErasing] = useState(false)
  const [revision, setRevision] = useState(0)
  useEffect(() => {
    if (text === displayed) { setErasing(false); return }
    if (shining) { setDisplayed(text); setErasing(false); return }
    if (typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
      setDisplayed(text)
      setErasing(false)
      return
    }
    setErasing(true)
    const timer = setTimeout(() => {
      setDisplayed(text)
      setRevision(value => value + 1)
      setErasing(false)
    }, variant === 'access' ? 160 : 110)
    return () => clearTimeout(timer)
  }, [text, displayed, variant, shining])
  if (shining) return <span aria-hidden="true" data-shining-text="true" className="activity-label shining-text truncate min-w-0">{text}</span>
  return <span key={revision} aria-hidden="true" className={`activity-label truncate min-w-0 ${variant === 'access' ? 'access-label' : ''} ${erasing ? 'activity-label-erasing' : revision > 0 ? 'activity-label-revealing' : ''}`}>{displayed}</span>
}

/** Width-animated wrapper around ActivityLabel matching AccessSelector's pill transition. */
export const SmoothActivityLabel: React.FC<{ text: string; variant?: 'access'; shining?: boolean; className?: string }> = ({
  text,
  variant = 'access',
  shining = false,
  className = ''
}) => {
  const contentRef = useRef<HTMLSpanElement>(null)
  const [width, setWidth] = useState<number>()
  useLayoutEffect(() => {
    const element = contentRef.current
    if (!element) return
    const update = (): void => setWidth(element.getBoundingClientRect().width)
    update()
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(update)
    observer.observe(element)
    return () => observer.disconnect()
  }, [])
  return (
    <span className={`access-label-width ${className}`} style={{ width }}>
      <span ref={contentRef} className="inline-flex w-max">
        <ActivityLabel variant={variant} shining={shining} text={text} />
      </span>
    </span>
  )
}
