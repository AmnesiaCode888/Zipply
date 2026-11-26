import React, { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { ChatSession } from '../../types/chat'
import { ChatItem } from './ChatItem'

const ROW_HEIGHT = 38
const OVERSCAN = 6
const VIRTUALIZE_AFTER = 50

interface Props {
  sessions: ChatSession[]
  scrollRef: React.RefObject<HTMLDivElement>
  activeChatId: string
  approvalChatIds: readonly string[]
  generatingTitleChatIds: readonly string[]
  onSelect: (id: string) => void
  onRename: (id: string, title: string) => void
  onDelete: (id: string) => void
}

/** Window rows against the shared sidebar scroller; keep a focused row mounted. */
export function VirtualChatRows({ sessions, scrollRef, activeChatId, approvalChatIds, generatingTitleChatIds, onSelect, onRename, onDelete }: Props) {
  const listRef = useRef<HTMLDivElement>(null)
  const [range, setRange] = useState({ start: 0, end: Math.min(sessions.length, 30) })
  const [pinnedId, setPinnedId] = useState<string | null>(null)
  const pendingFocus = useRef<number | null>(null)
  const virtual = sessions.length > VIRTUALIZE_AFTER

  useEffect(() => {
    if (!virtual) return
    const list = listRef.current
    const scroll = scrollRef.current
    if (!list || !scroll) return
    let frame = 0
    const update = () => {
      frame = 0
      const viewport = scroll.getBoundingClientRect()
      const bounds = list.getBoundingClientRect()
      const start = Math.max(0, Math.min(sessions.length, Math.floor((viewport.top - bounds.top) / ROW_HEIGHT) - OVERSCAN))
      const end = Math.max(start, Math.min(sessions.length, Math.ceil((viewport.bottom - bounds.top) / ROW_HEIGHT) + OVERSCAN))
      setRange(previous => previous.start === start && previous.end === end ? previous : { start, end })
    }
    const schedule = () => { if (!frame) frame = requestAnimationFrame(update) }
    const observer = new ResizeObserver(schedule)
    observer.observe(scroll)
    observer.observe(list)
    scroll.addEventListener('scroll', schedule, { passive: true })
    scroll.addEventListener('transitionend', schedule)
    update()
    return () => { observer.disconnect(); scroll.removeEventListener('scroll', schedule); scroll.removeEventListener('transitionend', schedule); cancelAnimationFrame(frame) }
  }, [scrollRef, sessions.length, virtual])

  useLayoutEffect(() => {
    const index = pendingFocus.current
    if (index === null || index < range.start || index >= range.end) return
    const row = listRef.current?.querySelector<HTMLElement>(`[data-virtual-row="${index}"] [role="button"]`)
    if (row) { pendingFocus.current = null; row.focus({ preventScroll: true }) }
  }, [range])

  const focusIndex = (index: number) => {
    const list = listRef.current
    const scroll = scrollRef.current
    if (!list || !scroll || index < 0 || index >= sessions.length) return
    pendingFocus.current = index
    const top = list.getBoundingClientRect().top - scroll.getBoundingClientRect().top + scroll.scrollTop + index * ROW_HEIGHT
    scroll.scrollTop = Math.max(0, top - (index < range.start ? 0 : scroll.clientHeight - ROW_HEIGHT))
    const start = Math.max(0, index - OVERSCAN)
    setRange({ start, end: Math.min(sessions.length, index + Math.ceil(scroll.clientHeight / ROW_HEIGHT) + OVERSCAN) })
  }

  const start = virtual ? Math.min(range.start, sessions.length) : 0
  const end = virtual ? Math.min(range.end, sessions.length) : sessions.length
  const pinnedIndex = virtual && pinnedId ? sessions.findIndex(session => session.id === pinnedId) : -1
  const indices = Array.from({ length: Math.max(0, end - start) }, (_, i) => start + i)
  if (pinnedIndex >= 0 && (pinnedIndex < start || pinnedIndex >= end)) indices.push(pinnedIndex)
  indices.sort((a, b) => a - b)
  const approvals = new Set(approvalChatIds)
  const generating = new Set(generatingTitleChatIds)

  return <div ref={listRef} role="list" aria-label="Чаты" style={virtual ? { position: 'relative', height: sessions.length * ROW_HEIGHT } : undefined}>
    {virtual && start > 0 && <button type="button" aria-label="Предыдущие чаты" onFocus={() => focusIndex(start - 1)} style={{ position: 'absolute', top: start * ROW_HEIGHT, width: 1, height: 1, opacity: 0 }} />}
    {indices.map(index => {
      const session = sessions[index]
      return <div key={session.id} role="listitem" aria-posinset={index + 1} aria-setsize={sessions.length} data-virtual-row={virtual ? index : undefined}
        onFocusCapture={() => setPinnedId(session.id)}
        onBlurCapture={event => {
          const row = event.currentTarget
          requestAnimationFrame(() => {
            const active = document.activeElement
            if (row.contains(active) || active?.closest('[role="dialog"]')) return
            setPinnedId(previous => previous === session.id ? null : previous)
          })
        }}
        style={virtual ? { position: 'absolute', top: index * ROW_HEIGHT, left: 0, right: 0, height: ROW_HEIGHT } : undefined}>
        <ChatItem session={session} isActive={session.id === activeChatId} waitingForApproval={approvals.has(session.id)} generatingTitle={generating.has(session.id)} onSelect={onSelect} onRename={onRename} onDelete={onDelete} />
      </div>
    })}
    {virtual && end < sessions.length && <button type="button" aria-label="Следующие чаты" onFocus={() => focusIndex(end)} style={{ position: 'absolute', top: end * ROW_HEIGHT, width: 1, height: 1, opacity: 0 }} />}
  </div>
}
