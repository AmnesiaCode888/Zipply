import React, { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { Message } from '../../types/chat'
import { DEFAULT_CONTEXT_LENGTH } from '../../services/settingsService'

interface ContextIndicatorProps {
  status: NonNullable<Message['contextStatus']>
  compacted: boolean
}

export const ContextIndicator: React.FC<ContextIndicatorProps> = ({ status, compacted }) => {
  const [open, setOpen] = useState(false)
  const [pinned, setPinned] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const popupRef = useRef<HTMLDivElement>(null)
  const [position, setPosition] = useState({ left: 0, bottom: 0, width: 0, maxHeight: 0 })
  const effectiveLimit = typeof status.limit === 'number' && status.limit > 0 ? status.limit : DEFAULT_CONTEXT_LENGTH
  const percentage = Math.round(status.estimatedTokens / effectiveLimit * 100)
  const fill = Math.max(0, Math.min(100, percentage))
  const used = status.estimatedTokens.toLocaleString('ru-RU')
  const limit = effectiveLimit.toLocaleString('ru-RU')

  useEffect(() => {
    if (!open) return
    const onOutside = (event: MouseEvent): void => {
      if (!rootRef.current?.contains(event.target as Node) && !popupRef.current?.contains(event.target as Node)) { setOpen(false); setPinned(false) }
    }
    const onEscape = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') { setOpen(false); setPinned(false) }
    }
    document.addEventListener('mousedown', onOutside)
    document.addEventListener('keydown', onEscape)
    return () => { document.removeEventListener('mousedown', onOutside); document.removeEventListener('keydown', onEscape) }
  }, [open])

  useLayoutEffect(() => {
    if (!open) return
    const place = (): void => {
      const rect = rootRef.current?.getBoundingClientRect()
      if (!rect) return
      const width = Math.min(300, window.innerWidth - 32)
      setPosition({ left: Math.max(16, Math.min(rect.right - width, window.innerWidth - width - 16)), bottom: window.innerHeight - rect.top, width, maxHeight: Math.max(40, Math.min(380, rect.top - 24)) })
    }
    place()
    window.addEventListener('resize', place)
    window.addEventListener('scroll', place, true)
    return () => { window.removeEventListener('resize', place); window.removeEventListener('scroll', place, true) }
  }, [open])

  return <div ref={rootRef} className="relative min-w-0 inline-flex" onMouseEnter={() => setOpen(true)} onMouseLeave={() => { if (!pinned && !rootRef.current?.contains(document.activeElement)) setOpen(false) }} onBlur={event => { if (!pinned && !event.currentTarget.contains(event.relatedTarget as Node)) setOpen(false) }}>
    <button type="button" aria-label={`Контекст: примерно ${percentage}%`} aria-expanded={open} aria-controls="context-details" onFocus={() => setOpen(true)} onClick={() => { if (pinned) { setPinned(false); setOpen(false) } else { setPinned(true); setOpen(true) } }} className="inline-flex min-w-0 items-center gap-1.5 rounded-full bg-transparent py-2 text-secondary border-none shadow-none cursor-pointer focus:outline-none">
      <span aria-hidden="true" className="composer-context-bar block h-[5px] w-10 min-w-0 overflow-hidden rounded-full bg-track"><span className="block h-full rounded-full bg-primary" style={{ width: `${fill}%` }} /></span>
      <span aria-hidden="true" className="shrink-0 text-[12px] leading-none tabular-nums">{percentage}%</span>
    </button>
    {open && createPortal(<div ref={popupRef} id="context-details" role="region" aria-label="Сведения о контексте" className="fixed z-[100] pb-2" style={{ left: position.left, bottom: position.bottom, width: position.width }}>
      <div style={{ maxHeight: position.maxHeight }} className="popup-glass overflow-y-auto rounded-[22px] p-3.5 text-left border-[0.5px] border-hairline shadow-none">
        <div className="px-1 pt-0.5">
          <div className="flex items-center justify-between gap-3"><span className="text-[16px] font-medium leading-[22px] text-primary">Контекст</span><span className="text-[14px] font-medium leading-[22px] text-primary tabular-nums">≈{percentage}%</span></div>
          <p className="mt-1 text-[13px] leading-[19px] text-secondary">Объём последнего запроса</p>
        </div>
        <div role="progressbar" aria-label="Заполненность контекста" aria-valuemin={0} aria-valuemax={100} aria-valuenow={fill} aria-valuetext={`Примерно ${percentage}%`} className="mt-4 h-[6px] overflow-hidden rounded-full bg-control border-none shadow-none"><div className="h-full rounded-full bg-primary" style={{ width: `${fill}%` }} /></div>
        <div className="mt-3 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 px-1 text-[13px] leading-[20px]"><span className="text-secondary">Токены</span><span className="text-primary tabular-nums">≈{used} / {limit}</span></div>
        <p className="mt-3 px-1 text-[12px] leading-[18px] text-secondary">Примерная оценка. Доступный контекст модели может отличаться.</p>
        {compacted && <div className="mt-3 rounded-[14px] bg-control px-3 py-2.5 text-[12px] leading-[18px] text-secondary"><span className="block text-[13px] font-medium text-primary">Контекст сжимался</span><span>Ранее часть данных была сокращена или пересказана. История чата сохранена.</span></div>}
      </div>
    </div>, document.body)}
  </div>
}
