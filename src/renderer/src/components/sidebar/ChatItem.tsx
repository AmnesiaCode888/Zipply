import React, { useState, useRef, useEffect, useLayoutEffect, useId } from 'react'
import { Pencil, Trash2 } from '../../icons'
import { ChatSession } from '../../types/chat'
import { createPortal } from 'react-dom'
import { ActivityLabel } from '../ActivityLabel'

interface ChatItemProps {
  session: ChatSession
  isActive: boolean
  waitingForApproval?: boolean
  generatingTitle?: boolean
  onSelect: (id: string) => void
  onRename: (id: string, newTitle: string) => void
  onDelete: (id: string) => void
}

export const ChatItem: React.FC<ChatItemProps> = React.memo(({
  session,
  isActive,
  waitingForApproval = false,
  generatingTitle = false,
  onSelect,
  onRename,
  onDelete
}) => {
  const [isEditing, setIsEditing] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [isDeleting, setIsDeleting] = useState(false)
  const [editTitle, setEditTitle] = useState(session.title)
  const titleBeforeGeneration = useRef(session.title || 'Новый чат')
  if (!generatingTitle) titleBeforeGeneration.current = session.title || 'Новый чат'
  const dialogTitleId = useId()
  const dialogDescriptionId = useId()
  const cancelDeleteRef = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    if (!confirmDelete) return
    const previousFocus = document.activeElement as HTMLElement | null
    cancelDeleteRef.current?.focus()
    return () => { if (previousFocus?.isConnected) previousFocus.focus() }
  }, [confirmDelete])
  const inputRef = useRef<HTMLInputElement>(null)
  const rowRef = useRef<HTMLDivElement>(null)
  const hoverTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [previewOpen, setPreviewOpen] = useState(false)
  const [previewPosition, setPreviewPosition] = useState({ left: 0, top: 0, width: 0 })
  const firstMessage = session.messages.find(message => message.role === 'user' && message.content?.trim())?.content?.trim().replace(/\s+/g, ' ')
  const closePreview = () => {
    if (hoverTimer.current) clearTimeout(hoverTimer.current)
    hoverTimer.current = null
    setPreviewOpen(false)
  }
  useEffect(() => () => { if (hoverTimer.current) clearTimeout(hoverTimer.current) }, [])
  useLayoutEffect(() => {
    if (!previewOpen) return
    const place = () => {
      const rect = rowRef.current?.getBoundingClientRect()
      if (!rect) return
      const width = Math.min(300, window.innerWidth - 24)
      setPreviewPosition({ left: Math.max(12, Math.min(rect.right + 8, window.innerWidth - width - 12)), top: Math.max(12, Math.min(rect.top, window.innerHeight - 220)), width })
    }
    place()
    window.addEventListener('resize', place)
    window.addEventListener('scroll', place, true)
    return () => { window.removeEventListener('resize', place); window.removeEventListener('scroll', place, true) }
  }, [previewOpen])

  useEffect(() => {
    setEditTitle(session.title)
  }, [session.title])

  useEffect(() => {
    if (isEditing) {
      inputRef.current?.focus()
      inputRef.current?.select()
    }
  }, [isEditing])

  const handleStartEdit = (e: React.MouseEvent) => {
    e.stopPropagation()
    closePreview()
    setIsEditing(true)
  }

  const handleSaveEdit = () => {
    const trimmed = editTitle.trim()
    if (trimmed && trimmed !== session.title) {
      onRename(session.id, trimmed)
    } else {
      setEditTitle(session.title)
    }
    setIsEditing(false)
  }

  const handleCancelEdit = () => {
    setEditTitle(session.title)
    setIsEditing(false)
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      handleSaveEdit()
    } else if (e.key === 'Escape') {
      e.preventDefault()
      handleCancelEdit()
    }
  }

  const handleDelete = (e: React.MouseEvent) => {
    e.stopPropagation()
    closePreview()
    setConfirmDelete(true)
  }

  return (
    <div className={`chat-item-motion overflow-hidden origin-top transition-[max-height,opacity,transform] duration-200 ease-out motion-reduce:transition-none ${isDeleting ? 'max-h-0 opacity-0 -translate-y-1' : 'max-h-24 opacity-100 translate-y-0'}`}>
      <div className="min-h-0 pb-0.5">
        <div
          ref={rowRef}
          onMouseEnter={() => { if (!isEditing && !confirmDelete) hoverTimer.current = setTimeout(() => setPreviewOpen(true), 450) }}
          onMouseLeave={closePreview}
          onFocus={(event) => { if (event.target === event.currentTarget && !isEditing) setPreviewOpen(true) }}
          onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node)) closePreview() }}
          onClick={() => !isEditing && onSelect(session.id)}
          onDoubleClick={handleStartEdit}
          role="button"
          tabIndex={0}
          aria-label={session.title || 'Новый чат'}
          aria-current={isActive ? 'page' : undefined}
          onKeyDown={(event) => { if (event.target === event.currentTarget && !isEditing && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); onSelect(session.id) } }}
          className={`group relative w-full px-3 py-[7px] rounded-[10px] flex items-center gap-2 select-none cursor-pointer border-none shadow-none transition-colors duration-150 ${
            isActive
              ? 'bg-control text-primary'
              : 'text-primary hover:bg-hover'
          }`}
        >
          {/* Title / Inline input */}
          <div className="flex-1 min-w-0 group-hover:pr-14 group-focus-within:pr-14">
            {isEditing ? (
              <input
                ref={inputRef}
                type="text"
                value={editTitle}
                onChange={(e) => setEditTitle(e.target.value)}
                onBlur={handleSaveEdit}
                onKeyDown={handleKeyDown}
                onClick={(e) => e.stopPropagation()}
                className="h-[22px] w-full box-border bg-surface text-primary text-[15px] leading-[18px] px-2 py-0.5 rounded-[8px] outline-none"
              />
            ) : (
              <span
                className="flex min-w-0 items-center text-[15px] leading-[22px] font-normal"
              >
                <ActivityLabel text={generatingTitle ? titleBeforeGeneration.current : (session.title || 'Новый чат')} shining={generatingTitle} />
              </span>
            )}
          </div>

          {/* Hover action buttons */}
          {!isEditing && (
            <div className={`absolute ${waitingForApproval ? 'right-8' : 'right-2'} flex items-center gap-0.5 opacity-0 invisible group-hover:visible group-hover:opacity-100 group-focus-within:visible group-focus-within:opacity-100 transition-opacity`}>
              <button
                onClick={handleStartEdit}
                title="Переименовать"
                className="p-1.5 rounded-full text-secondary hover:text-primary hover:bg-hover-strong active:scale-95 transition-all border-none shadow-none"
              >
                <Pencil size={13.5} />
              </button>
              <button
                onClick={handleDelete}
                title="Удалить"
                className="p-1.5 rounded-full text-secondary hover:text-primary hover:bg-hover-strong active:scale-95 transition-all cursor-pointer border-none shadow-none"
              >
                <Trash2 size={13.5} className="transition-transform active:scale-90" />
              </button>
            </div>
          )}
          {waitingForApproval && (
            <span role="img" aria-label="Ожидает подтверждения инструмента" title="Ожидает подтверждения инструмента"
              className="w-[15px] h-[15px] shrink-0 rounded-full bg-primary text-canvas text-[10px] leading-none font-bold flex items-center justify-center border-none shadow-none">
              !
            </span>
          )}
        </div>
      </div>
      {previewOpen && !isEditing && !confirmDelete && createPortal(
        <div role="tooltip" className="fixed z-[100] pointer-events-none popup-glass rounded-[20px] p-4 text-left border-[0.5px] border-hairline shadow-none" style={previewPosition}>
          <div className="text-[15px] leading-[22px] font-semibold text-primary break-words">{session.title || 'Новый чат'}</div>
          <p className="mt-2 text-[13px] leading-[19px] text-secondary break-words" style={{ display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{firstMessage || (session.messages.some(message => message.attachments?.length) ? 'Чат с вложениями' : 'Пока нет сообщений')}</p>
          <div className="mt-3 flex flex-wrap gap-x-3 gap-y-1 text-[12px] leading-[18px] text-secondary"><span>Сообщений: {session.messages.length}</span>{Number.isFinite(session.updatedAt) && session.updatedAt > 0 && <span>{new Date(session.updatedAt).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short', year: 'numeric' })}</span>}</div>
        </div>, document.body
      )}
      {confirmDelete && createPortal(
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 px-4" onMouseDown={(event) => { if (event.target === event.currentTarget) setConfirmDelete(false) }}>
          <div role="dialog" aria-modal="true" aria-labelledby={dialogTitleId} aria-describedby={dialogDescriptionId}
            onKeyDown={(event) => {
              if (event.key === 'Escape') { event.stopPropagation(); setConfirmDelete(false) }
              if (event.key === 'Tab') {
                const buttons = event.currentTarget.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')
                if (event.shiftKey && document.activeElement === buttons[0]) { event.preventDefault(); buttons[buttons.length - 1]?.focus() }
                else if (!event.shiftKey && document.activeElement === buttons[buttons.length - 1]) { event.preventDefault(); buttons[0]?.focus() }
              }
            }} className="w-full max-w-[400px] rounded-[24px] bg-surface p-6 border-none shadow-none">
            <h2 id={dialogTitleId} className="text-[19px] leading-[26px] font-semibold text-primary">Удалить чат?</h2>
            <p id={dialogDescriptionId} className="mt-3 text-[15px] leading-[23px] text-secondary break-words">История чата «{session.title}» будет удалена без возможности восстановления.</p>
            <div className="mt-6 flex justify-end gap-2">
              <button ref={cancelDeleteRef} type="button" onClick={() => setConfirmDelete(false)} className="rounded-full bg-control px-5 py-2.5 text-[15px] text-primary hover:bg-control-hover border-none shadow-none">Отмена</button>
              <button type="button" onClick={() => { setConfirmDelete(false); setIsDeleting(true); window.setTimeout(() => onDelete(session.id), 180) }} className="rounded-full bg-accent hover:bg-accent-hover px-5 py-2.5 text-[15px] font-medium text-on-accent active:scale-95 border-none shadow-none">Удалить</button>
            </div>
          </div>
        </div>, document.body
      )}
    </div>
  )
})
