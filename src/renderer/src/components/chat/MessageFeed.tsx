import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Virtuoso, type VirtuosoHandle } from 'react-virtuoso'
import { Message } from '../../types/chat'
import { ChatMessageItem, type MessageUIState } from '../ChatMessageItem'

interface MessageFeedProps {
  sessionId?: string
  messages: Message[]
  searchTarget?: { messageId: string; sequence: number } | null
  onRetry?: () => void
  folderPath?: string
}

function lastUserId(messages: Message[]): string | undefined {
  for (let i = messages.length - 1; i >= 0; i--) if (messages[i].role === 'user') return messages[i].id
  return undefined
}

const MessageFeedView: React.FC<MessageFeedProps> = ({ sessionId, messages, onRetry, folderPath, searchTarget }) => {
  const list = useRef<VirtuosoHandle>(null)
  const root = useRef<HTMLDivElement>(null)
  const uiStates = useRef(new Map<string, MessageUIState>())
  const following = useRef(true)
  const lastSession = useRef(sessionId)
  const lastUser = useRef(lastUserId(messages))
  const lastSearch = useRef<string | undefined>(undefined)
  const skipFollowingOnce = useRef(false)
  const [selectionActive, setSelectionActive] = useState(false)
  const [keyboardFocus, setKeyboardFocus] = useState(false)

  useLayoutEffect(() => {
    if (lastSession.current === sessionId) return
    lastSession.current = sessionId
    following.current = true
    lastUser.current = lastUserId(messages)
    if (!searchTarget && messages.length > 0) {
      list.current?.scrollToIndex({ index: messages.length - 1, align: 'end', behavior: 'auto' })
    }
  }, [sessionId, messages, searchTarget])

  const firstMessageId = messages[0]?.id
  const lastMessageId = messages[messages.length - 1]?.id
  useEffect(() => {
    const existing = new Set(messages.map(message => `${sessionId || ''}:${message.id}`))
    for (const id of uiStates.current.keys()) if (!existing.has(id)) uiStates.current.delete(id)
  }, [sessionId, messages.length, firstMessageId, lastMessageId])

  useEffect(() => {
    const update = () => {
      const selection = window.getSelection()
      setSelectionActive(Boolean(selection && !selection.isCollapsed && selection.anchorNode && root.current?.contains(selection.anchorNode)))
    }
    document.addEventListener('selectionchange', update)
    return () => document.removeEventListener('selectionchange', update)
  }, [])

  useLayoutEffect(() => {
    if (!searchTarget) { lastSearch.current = undefined; return }
    const searchKey = `${searchTarget.messageId}:${searchTarget.sequence}`
    if (lastSearch.current === searchKey) return
    const index = messages.findIndex(message => message.id === searchTarget.messageId)
    if (index < 0) return
    lastSearch.current = searchKey
    skipFollowingOnce.current = true
    following.current = false
    list.current?.scrollToIndex({ index, align: 'center', behavior: 'auto' })
  }, [searchTarget, messages])

  useEffect(() => {
    const currentUser = lastUserId(messages)
    if (skipFollowingOnce.current) { skipFollowingOnce.current = false; lastUser.current = currentUser; return }
    if (currentUser && currentUser !== lastUser.current) following.current = true
    lastUser.current = currentUser
    if (!following.current || !messages.length) return
    const frame = requestAnimationFrame(() => {
      if (following.current) list.current?.scrollToIndex({ index: 'LAST', align: 'end', behavior: 'auto' })
    })
    return () => cancelAnimationFrame(frame)
  }, [messages, searchTarget])

  const renderMessage = useCallback((index: number, message: Message) => {
    const stateKey = `${sessionId || ''}:${message.id}`
    let state = uiStates.current.get(stateKey)
    if (!state) {
      state = { manualToggles: {}, groupToggles: {}, thoughtToggles: {} }
      uiStates.current.set(stateKey, state)
    }
    const isFirst = index === 0
    return <div data-message-id={message.id} className={`w-full max-w-[760px] mx-auto px-4 ${message.isProgressUpdate ? 'pb-1.5' : 'pb-3.5'} ${isFirst ? 'pt-4' : ''}`}>
      <ChatMessageItem message={message} folderPath={folderPath} uiState={state} onRetry={index === messages.length - 1 ? onRetry : undefined} />
    </div>
  }, [sessionId, folderPath, onRetry, messages.length])

  if (!messages.length) return <div data-message-feed className="flex-1 overflow-y-auto py-3 flex flex-col items-center select-text no-scrollbar">
    <div className="h-[50vh] w-full max-w-[760px] px-4 flex flex-col items-center justify-center text-center select-none">
      <span className="text-[22px] font-semibold text-primary tracking-tight mb-2">Чем я могу помочь?</span>
      <span className="text-[15px] text-secondary max-w-sm">Задайте вопрос, опишите задачу или попросите написать код.</span>
    </div>
  </div>

  const initialIndex = searchTarget ? messages.findIndex(message => message.id === searchTarget.messageId) : -1
  return <div ref={root} className="flex-1 min-h-0 min-w-0 select-text" onFocusCapture={event => {
    if ((event.target as HTMLElement).matches(':focus-visible')) setKeyboardFocus(true)
  }} onBlurCapture={event => {
    if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setKeyboardFocus(false)
  }}>
    <Virtuoso ref={list} data={messages} data-message-feed style={{ height: '100%' }} className="no-scrollbar"
      initialTopMostItemIndex={{ index: initialIndex >= 0 ? initialIndex : messages.length - 1, align: initialIndex >= 0 ? 'center' : 'end' }}
      computeItemKey={(_index, message) => message.id}
      defaultItemHeight={180}
      increaseViewportBy={selectionActive || keyboardFocus ? 4000 : { top: 600, bottom: 600 }}
      atBottomThreshold={160}
      atBottomStateChange={value => { following.current = value }}
      followOutput={atBottom => atBottom ? 'auto' : false}
      itemContent={renderMessage} />
  </div>
}

export const MessageFeed = React.memo(MessageFeedView)
