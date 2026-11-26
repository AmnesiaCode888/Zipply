import React, { useState, useMemo, useEffect, useRef } from 'react'
import { Message, MessageBlock, ToolCall, ImageAttachment } from '../types/chat'
import { ToolCallCard, isFileEditOrWrite } from './tools/ToolCallCard'
import { MarkdownRenderer } from './chat/MarkdownRenderer'
import { ChevronDown, RotateCcw, Square, AlertCircle, ArrowUpRight } from '../icons'
import { buildActivityItems, type ActivityItem } from './chat/activityStages'
import { ActivityLabel } from './ActivityLabel'
import { ThinkingBlock } from './ThinkingBlock'

const ActivityGroupAccordion: React.FC<{
  expanded: boolean
  children: React.ReactNode
}> = ({ expanded, children }) => {
  const [keepMounted, setKeepMounted] = useState(expanded)
  useEffect(() => {
    if (expanded) { setKeepMounted(true); return }
    if (!keepMounted) return
    const timer = window.setTimeout(() => setKeepMounted(false), 200)
    return () => window.clearTimeout(timer)
  }, [expanded, keepMounted])

  return (
    <div
      className={`grid transition-[grid-template-rows,opacity] duration-200 ease-out motion-reduce:transition-none ${
        expanded ? 'grid-rows-[1fr] opacity-100 pointer-events-auto' : 'grid-rows-[0fr] opacity-0 pointer-events-none'
      }`}
    >
      <div className="min-h-0 overflow-hidden">
        {(expanded || keepMounted) && (
          <div className="flex flex-col gap-1.5 pl-3.5 pt-1.5">
            {children}
          </div>
        )}
      </div>
    </div>
  )
}

interface ChatMessageItemProps {
  message: Message
  folderPath?: string
  onRetry?: () => void
  uiState?: MessageUIState
}

export interface MessageUIState {
  manualToggles: Record<string, boolean>
  groupToggles: Record<string, boolean>
  thoughtToggles: Record<string, boolean>
}

const ResponseNotice: React.FC<{ content: string; onRetry?: () => void; isStreaming?: boolean }> = ({ content, onRetry, isStreaming }) => {
  const detail = content.replace(/^⚠️\s*/, '').trim()
  const cancelled = /отмен[её]н[ао]? пользователем|cancelled by user/i.test(detail)
  const requestLimitReached = /лимит(?:\s+запросов)?\s+(?:исчерпан|превышен|достигнут)|(?:(?:request|usage)\s+limit|quota).{0,24}(?:exhausted|reached|exceeded)/i.test(detail)
  const Icon = cancelled ? Square : AlertCircle
  if (cancelled) {
    return (
      <div role="status" className="inline-flex max-w-full flex-wrap items-center gap-x-2.5 gap-y-1 py-1 text-[13px] leading-5 text-secondary">
        <Icon size={13} strokeWidth={1.8} className="shrink-0 opacity-70" />
        <span className="font-medium text-secondary">Ответ остановлен</span>
        {onRetry && !isStreaming && <button type="button" onClick={onRetry} className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[13px] leading-5 text-secondary hover:bg-surface hover:text-primary active:scale-95 transition-colors cursor-pointer border-none shadow-none">
          <RotateCcw size={12} className="shrink-0" />
          Продолжить
        </button>}
      </div>
    )
  }
  return (
    <div role="alert" className={`flex max-w-full items-start gap-3.5 rounded-[24px] bg-surface-secondary p-5 border-none shadow-none ${requestLimitReached ? 'w-full max-w-[38rem] sm:p-6' : 'w-fit'}`}>
      <span className="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-control text-secondary">
        <Icon size={18} strokeWidth={1.8} />
      </span>
      <div className="min-w-0 flex flex-col items-start gap-2">
        <div className="flex min-h-7 flex-wrap items-center gap-x-2 gap-y-1">
          <span className="text-[17px] leading-[24px] font-semibold text-primary">{requestLimitReached ? 'Лимит запросов исчерпан' : 'Не удалось завершить ответ'}</span>
        </div>
        {requestLimitReached
          ? <span className="max-w-[min(34rem,calc(100vw-8rem))] text-[15px] leading-[22px] text-secondary break-words">Попробуйте позже или выберите тариф с большим лимитом запросов.</span>
          : detail && <span className="max-w-[min(34rem,calc(100vw-8rem))] text-[15px] leading-[22px] text-secondary break-words">{detail}</span>}
        {requestLimitReached
          ? <div className="mt-2 flex flex-wrap items-center gap-2.5">
            <a href="https://web.zipply.my" target="_blank" rel="noreferrer" className="inline-flex min-h-10 items-center gap-2 rounded-full bg-white px-4 text-[14px] leading-5 font-semibold text-[#0A0A0A] hover:bg-white/90 active:scale-95 transition-colors cursor-pointer border-none shadow-none">
              Купить тариф
              <ArrowUpRight size={16} strokeWidth={2} aria-hidden="true" />
            </a>
            {onRetry && !isStreaming && <button type="button" onClick={onRetry} className="inline-flex min-h-10 items-center gap-2 rounded-full bg-control px-4 text-[14px] leading-5 font-medium text-primary hover:bg-control-hover active:scale-95 transition-colors cursor-pointer border-none shadow-none">
              <RotateCcw size={14} className="shrink-0 text-secondary" />
              Попробовать еще раз
            </button>}
          </div>
          : onRetry && !isStreaming && <button type="button" onClick={onRetry} className="mt-1 inline-flex min-h-9 items-center gap-2 rounded-full bg-control px-3.5 text-[14px] leading-5 font-medium text-primary hover:bg-control-hover active:scale-95 transition-colors cursor-pointer border-none shadow-none">
          <RotateCcw size={14} className="shrink-0 text-secondary" />
          Попробовать еще раз
        </button>}
      </div>
    </div>
  )
}

const isMinimalBlock = (block: MessageBlock): boolean => {
  if (block.type === 'thinking') return true
  if (block.type === 'tool') {
    return !isFileEditOrWrite(block.tool)
  }
  return false
}

interface ParsedContentSegment {
  type: 'thought' | 'text'
  content: string
}

function parseTextAndThoughts(raw: string): ParsedContentSegment[] {
  if (!raw) return []
  // Matches <thought>...</thought> (or unclosed at end) and <think>...</think> (or unclosed at end)
  const pattern = /(<thought>[\s\S]*?(?:<\/thought>|$)|<think>[\s\S]*?(?:<\/think>|$))/gi
  const parts = raw.split(pattern)
  const segments: ParsedContentSegment[] = []

  for (const part of parts) {
    if (!part) continue
    const lower = part.toLowerCase()
    if (lower.startsWith('<thought>') || lower.startsWith('<think>')) {
      const clean = part
        .replace(/<\/?thought>/gi, '')
        .replace(/<\/?think>/gi, '')
        .trim()
      if (clean) {
        segments.push({ type: 'thought', content: clean })
      }
    } else {
      const trimmed = part.trim()
      if (trimmed) {
        segments.push({ type: 'text', content: part })
      }
    }
  }

  return segments.length > 0 ? segments : [{ type: 'text', content: raw }]
}

// Apple Intelligence / Modern AI style:
// - User message: compact dark pill on the right (#222222).
// - Assistant message: natural interleaved flow with smart compact spacing.
// - Auto-accordion for file writing: active/running file opens; previously written files collapse.
// - React.memo + contentVisibility for maximum streaming performance without lag.
const SavedImage: React.FC<{ attachment: ImageAttachment; folderPath?: string }> = ({ attachment, folderPath }) => {
  const placeholderRef = useRef<HTMLDivElement>(null)
  const imageKey = JSON.stringify([folderPath, attachment.path])
  const [visibleImageKey, setVisibleImageKey] = useState('')
  const nearViewport = visibleImageKey === imageKey
  const [loadedImage, setLoadedImage] = useState<{ key: string; url: string } | null>(null)
  const [failedImageKey, setFailedImageKey] = useState('')
  const url = loadedImage?.key === imageKey ? loadedImage.url : ''
  const failed = failedImageKey === imageKey
  useEffect(() => {
    const placeholder = placeholderRef.current
    if (!placeholder) return
    if (typeof IntersectionObserver === 'undefined') { setVisibleImageKey(imageKey); return }

    const observer = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (entry.target === placeholder) setVisibleImageKey(entry.isIntersecting ? imageKey : '')
      }
    }, { rootMargin: '400px 0px' })
    observer.observe(placeholder)
    return () => observer.disconnect()
  }, [imageKey])
  useEffect(() => {
    let active = true
    if (!nearViewport) {
      setLoadedImage(null)
      setFailedImageKey('')
      return () => { active = false }
    }
    setLoadedImage(null)
    setFailedImageKey('')
    if (!folderPath || !window.api?.workspace?.readImage) { setFailedImageKey(imageKey); return }
    window.api.workspace.readImage(folderPath, attachment.path).then((result) => {
      if (!active) return
      if (result.dataUrl) setLoadedImage({ key: imageKey, url: result.dataUrl })
      else setFailedImageKey(imageKey)
    }).catch(() => { if (active) setFailedImageKey(imageKey) })
    return () => { active = false }
  }, [folderPath, attachment.path, imageKey, nearViewport])
  return <div ref={placeholderRef} className="inline-block">
    {url ? <img src={url} alt={attachment.name} title={attachment.name} className="max-w-[220px] max-h-[220px] rounded-[14px] object-contain" /> :
      <span className="inline-block rounded-[14px] bg-surface px-3 py-2 text-[14px] text-secondary">{failed ? `Не удалось открыть: ${attachment.name}` : attachment.name}</span>}
  </div>
}

export const ChatMessageItem: React.FC<ChatMessageItemProps> = React.memo(({ message, onRetry, folderPath, uiState }) => {
  const isUser = message.role === 'user'
  const [manualToggles, setManualToggles] = useState<Record<string, boolean>>(() => uiState?.manualToggles || {})
  const [groupToggles, setGroupToggles] = useState<Record<string, boolean>>(() => uiState?.groupToggles || {})
  const textSegmentsCacheRef = useRef(new Map<string, {
    content: string
    hasThoughtOpen: boolean
    segments: ParsedContentSegment[]
  }>())
  const getTextSegments = (cacheKey: string, content: string): ParsedContentSegment[] => {
    const previous = textSegmentsCacheRef.current.get(cacheKey)
    if (previous && content.startsWith(previous.content)) {
      if (content === previous.content) return previous.segments
      if (!previous.hasThoughtOpen) {
        const newContent = content.slice(previous.content.length)
        const possibleOpening = previous.content.slice(-8) + newContent
        if (!/<(?:think|thought)>/i.test(possibleOpening)) {
          const segments = content ? [{ type: 'text' as const, content }] : []
          textSegmentsCacheRef.current.set(cacheKey, { content, hasThoughtOpen: false, segments })
          return segments
        }
      }
    }

    const segments = parseTextAndThoughts(content)
    textSegmentsCacheRef.current.set(cacheKey, {
      content,
      hasThoughtOpen: /<(?:think|thought)>/i.test(content),
      segments
    })
    return segments
  }

  const visibleBlocks = message.blocks ?? []
  const tools = message.blocks?.filter((block): block is Extract<MessageBlock, { type: 'tool' }> => block.type === 'tool').map(block => block.tool) ?? message.tools ?? []
  const activeTerminal = [...tools].reverse().find(tool => tool.status === 'running' && tool.executionStarted && ['terminal', 'run_command', 'execute_command', 'bash', 'sh'].includes(tool.toolName || ''))
  const latestTool = tools[tools.length - 1]
  const processes = new Map<string, { running: boolean; lastOutputAt: number }>()
  for (const tool of tools) {
    const result = !Array.isArray(tool.processResult) ? tool.processResult : undefined
    if (result?.id && tool.processLastOutputAt) processes.set(result.id, { running: ['running', 'starting'].includes(result.status), lastOutputAt: tool.processLastOutputAt })
    if (tool.toolName === 'process_stop' && tool.status === 'completed' && tool.targetName) processes.delete(tool.targetName)
  }
  const processId = latestTool?.toolName === 'process_poll' ? latestTool.targetName : !Array.isArray(latestTool?.processResult) ? latestTool?.processResult?.id : undefined
  const backgroundProcess = message.isStreaming && processId && ['process_start', 'process_poll'].includes(latestTool?.toolName || '') ? processes.get(processId) : undefined
  const waitingKey = activeTerminal ? `terminal:${activeTerminal.id}:${activeTerminal.content ?? ''}` : backgroundProcess?.running ? `process:${processId}:${backgroundProcess.lastOutputAt}` : undefined
  const [waitingTerminal, setWaitingTerminal] = useState<string | null>(null)
  useEffect(() => {
    setWaitingTerminal(null)
    if (!waitingKey) return undefined
    const delay = activeTerminal ? 3000 : Math.max(0, 3000 - (Date.now() - (backgroundProcess?.lastOutputAt ?? Date.now())))
    const timer = setTimeout(() => setWaitingTerminal(waitingKey), delay)
    return () => clearTimeout(timer)
  }, [waitingKey])

  // Find all file tools to coordinate auto-accordion behavior
  const fileToolIds = useMemo(() => {
    const ids: string[] = []
    if (message.blocks) {
      for (const b of message.blocks) {
        if (b.type === 'tool' && isFileEditOrWrite(b.tool)) {
          ids.push(b.tool.id)
        }
      }
    } else if (message.tools) {
      for (const t of message.tools) {
        if (isFileEditOrWrite(t)) {
          ids.push(t.id)
        }
      }
    }
    return ids
  }, [message.blocks, message.tools])

  // Active file tool:
  // - While a file tool is running, it stays open for real-time diff streaming
  // - Completed files close even when another action is still streaming.
  const autoActiveFileToolId = useMemo(() => {
    if (fileToolIds.length === 0) return null

    // 1. If any file tool is currently running, keep it open
    if (message.blocks) {
      const active = message.blocks.find((b) => b.type === 'tool' && b.id === message.activeFileToolId && b.tool.status === 'running')
      if (active?.type === 'tool') return active.tool.id
      for (const b of message.blocks) {
        if (b.type === 'tool' && isFileEditOrWrite(b.tool) && b.tool.status === 'running') {
          return b.tool.id
        }
      }
    } else if (message.tools) {
      for (const t of message.tools) {
        if (isFileEditOrWrite(t) && t.status === 'running') {
          return t.id
        }
      }
    }

    return null
  }, [fileToolIds, message.blocks, message.tools, message.isStreaming, message.activeFileToolId])

  const handleToggleTool = (toolId: string, currentExpanded: boolean) => {
    const next = { ...manualToggles, [toolId]: !currentExpanded }
    if (uiState) uiState.manualToggles = next
    setManualToggles(next)
  }

  const renderTool = (tool: ToolCall): React.ReactNode => {
    const isFile = isFileEditOrWrite(tool)
    const initialExpanded = isFile && tool.id === autoActiveFileToolId
    const expanded = manualToggles[tool.id] ?? initialExpanded
    return <ToolCallCard key={tool.id} tool={tool} isExpanded={expanded} onToggle={() => handleToggleTool(tool.id, expanded)} />
  }

  const renderThinking = (block: Extract<MessageBlock, { type: 'thinking' }>): React.ReactNode => (
    <ThinkingBlock
      content={block.content}
      durationSec={block.durationSec}
      startedAt={block.startedAt}
      isStreaming={block.isStreaming}
      initialExpanded={uiState?.thoughtToggles?.[block.id] ?? false}
      onExpandedChange={(expanded) => {
        if (uiState) uiState.thoughtToggles[block.id] = expanded
      }}
    />
  )

  const renderActivity = (stage: Extract<ActivityItem, { kind: 'activity' }>): React.ReactNode => {
    const expanded = groupToggles[stage.id] ?? false
    const tools = stage.blocks.filter((block): block is Extract<MessageBlock, { type: 'tool' }> => block.type === 'tool')
    const active = [...tools].reverse().find(block => block.tool.status === 'running')
    const latest = active || tools[tools.length - 1]
    const latestActivity = active ? active.tool.activity : [...tools].reverse().find(block => block.tool.activity)?.tool.activity
    const fallback = latest?.tool.toolName === 'ask_user' ? (active ? 'Уточняю' : 'Уточнение')
      : latest?.tool.label === 'Пакет правок' ? (active ? 'Изменяю файлы' : 'Изменение файлов')
      : latest?.tool.label === 'Анализ кода' ? (active ? 'Анализирую код' : 'Анализ кода')
      : latest?.tool.toolName?.startsWith('process_') || latest?.tool.label === 'Процесс' ? (active ? 'Управляю процессом' : 'Управление процессом')
      : latest?.tool.type === 'file_read' ? (active ? 'Читаю файлы' : 'Чтение файлов')
      : latest?.tool.type === 'search' ? (active ? 'Ищу информацию' : 'Поиск информации')
      : latest?.tool.type === 'folder' ? (active ? 'Просматриваю папку' : 'Просмотр папки')
      : latest?.tool.type === 'terminal' ? (active ? 'Выполняю команду' : 'Выполнение команды') : 'Действия агента'
    const isWaiting = Boolean(waitingKey && waitingTerminal === waitingKey && latest?.tool.id === (activeTerminal?.id || latestTool?.id))
    const isCompletedInferredRead = !active && tools.length > 1 && latest?.tool.type === 'file_read' && Boolean(latestActivity && /^читаю\b/i.test(latestActivity))
    const title = isWaiting ? 'Ожидаю ответ от терминала' : (latest?.tool.toolName === 'ask_user' || isCompletedInferredRead) ? fallback : latestActivity?.replace(/^работа\s+над\s+[^:—–-]+\s*[:—–-]\s*/i, '').trim() || fallback
    return <div key={stage.id} className="w-full">
      <button type="button" aria-expanded={expanded} aria-label={title} onClick={() => { const next = { ...groupToggles, [stage.id]: !expanded }; if (uiState) uiState.groupToggles = next; setGroupToggles(next) }}
        className="inline-flex max-w-full items-center gap-1.5 p-0 text-left text-[15px] leading-[22px] text-secondary hover:text-primary bg-transparent border-none shadow-none cursor-pointer">
        {isWaiting ? <span data-terminal-waiting="true" data-shining-text="true" aria-hidden="true" className="shining-text truncate min-w-0">{title}</span> : <ActivityLabel text={title} shining={Boolean(active)} />}
        <ChevronDown size={14} strokeWidth={1.8} aria-hidden="true" className={`shrink-0 transition-transform duration-200 ${expanded ? 'rotate-180' : ''}`} />
      </button>
      <ActivityGroupAccordion expanded={expanded}>
        {stage.blocks.map(block => block.type === 'thinking'
          ? <div key={block.id}>{renderThinking(block)}</div>
          : block.type === 'text'
            ? <div key={block.id} className="w-full select-text break-words"><MarkdownRenderer content={block.content} isStreaming={block.isStreaming} /></div>
            : renderTool(block.tool))}
      </ActivityGroupAccordion>
    </div>
  }

  if (isUser) {
    return (
      <div
        className="w-full flex justify-end"
        style={uiState ? undefined : { contentVisibility: 'auto', containIntrinsicSize: '0 50px' }}
      >
        <div className="bg-control text-primary text-[16.5px] leading-[26px] px-5 py-3 rounded-[20px] max-w-[78%] break-words select-text border-none shadow-none">
          {message.extensionRefs?.length ? <div className="mb-2 flex flex-wrap gap-1.5" aria-label="Выбранные расширения">{message.extensionRefs.map(ref => {
            const type = ref.kind === 'skill' ? 'Навык' : ref.kind === 'plugin' ? 'Плагин' : ref.kind === 'mcp_server' ? 'MCP' : ref.kind === 'mcp_prompt' ? 'Промпт' : 'Ресурс'
            return <span key={`${ref.kind}:${ref.id}`} title={ref.label} className="inline-flex max-w-full items-center rounded-full bg-surface px-2.5 py-1 text-[12px] leading-[17px] text-secondary"><span className="mr-1.5 shrink-0 text-muted">{type}</span><span className="truncate">{ref.label}</span></span>
          })}</div> : null}
          {message.attachments?.length ? <div className="flex flex-wrap gap-2 mb-2">{message.attachments.map((attachment) => /\.(png|jpg|webp|gif)$/.test(attachment.path) ? <SavedImage key={attachment.path} attachment={attachment} folderPath={folderPath} /> : <div key={attachment.path} className="rounded-[14px] bg-surface px-3 py-2 text-[14px] text-secondary">{attachment.name}</div>)}</div> : null}
          {message.content}
        </div>
      </div>
    )
  }

  // If interleaved blocks are present, render them in sequential flow with tight spacing between minimal lines
  if (visibleBlocks.length > 0) {
    return (
      <div
        className="w-full flex flex-col justify-start py-0.5"
        style={uiState ? undefined : { contentVisibility: 'auto', containIntrinsicSize: '0 80px' }}
      >
        {(() => {
          const items = buildActivityItems(visibleBlocks, message.isStreaming)
          return items.map((item, idx) => {
          const previous = idx > 0 ? items[idx - 1] : null
          const isCompact = item.kind === 'activity' || (item.kind === 'block' && isMinimalBlock(item.block))
          const previousCompact = previous?.kind === 'activity' || (previous?.kind === 'block' && isMinimalBlock(previous.block))
          const spacingClass = idx === 0 ? '' : (isCompact && previousCompact) ? 'mt-1' : (isCompact || previousCompact) ? 'mt-1.5' : 'mt-2'
          if (item.kind === 'activity') return <div key={item.id} className={spacingClass}>{renderActivity(item)}</div>
          const block = item.block
          if (block.type === 'tool') return <div key={block.id} className={spacingClass}>{renderTool(block.tool)}</div>
          if (block.type === 'thinking') return <div key={block.id} className={spacingClass}>{renderThinking(block)}</div>

          switch (block.type) {
            case 'text': {
              const segments = getTextSegments(`block:${block.id}`, block.content)
              const isErrorBlock = block.id?.startsWith('err-') || block.content?.startsWith('⚠️')
              if (isErrorBlock) return <div key={block.id} className={spacingClass}><ResponseNotice content={block.content} onRetry={onRetry} isStreaming={message.isStreaming} /></div>
              return (
                <div key={block.id} className={spacingClass}>
                  {segments.map((seg, sIdx) => {
                    const isLast = sIdx === segments.length - 1
                    if (seg.type === 'thought') {
                      const thoughtKey = `seg:${block.id}:${sIdx}`
                      return (
                        <div key={`seg-th-${sIdx}`} className={sIdx > 0 ? 'mt-1.5' : ''}>
                          <ThinkingBlock
                            content={seg.content}
                            isStreaming={block.isStreaming && isLast}
                            initialExpanded={uiState?.thoughtToggles?.[thoughtKey] ?? false}
                            onExpandedChange={(expanded) => {
                              if (uiState) uiState.thoughtToggles[thoughtKey] = expanded
                            }}
                          />
                        </div>
                      )
                    }
                    return (
                      <div
                        key={`seg-tx-${sIdx}`}
                        className={`w-full text-primary text-[17px] leading-[28px] tracking-[-0.01em] select-text break-words ${
                          sIdx > 0 ? 'mt-2' : ''
                        }`}
                      >
                        <MarkdownRenderer
                          content={seg.content}
                          isStreaming={block.isStreaming && isLast}
                        />
                      </div>
                    )
                  })}

                </div>
              )
            }
            default:
              return null
          }
        })})()}
      </div>
    )
  }

  if (visibleBlocks.length === 0 && !message.content && !(message.tools && message.tools.length > 0) && message.isStreaming) {
    return (
      <div
        role="status"
        className="w-full flex items-center py-1"
        style={uiState ? undefined : { contentVisibility: 'auto', containIntrinsicSize: '0 36px' }}
      >
        <span className="text-[15px] leading-[22px] font-medium text-secondary animate-pulse">
          Думаю…
        </span>
      </div>
    )
  }

  // Fallback for legacy messages
  return (
    <div
      className="w-full flex flex-col justify-start py-0.5"
      style={uiState ? undefined : { contentVisibility: 'auto', containIntrinsicSize: '0 80px' }}
    >
      {/* Tool calls */}
      {message.tools && message.tools.length > 0 && (
        <div className="flex flex-col w-full">
          {buildActivityItems(message.tools.map(tool => ({ type: 'tool' as const, id: tool.id, tool })), message.isStreaming).map(item => item.kind === 'activity' ? renderActivity(item) : item.block.type === 'tool' ? renderTool(item.block.tool) : null)}
        </div>
      )}

      {/* Assistant text stream */}
      {message.content && (
        <div className="w-full mt-2">
          {message.content.startsWith('⚠️') ? <ResponseNotice content={message.content} onRetry={onRetry} isStreaming={message.isStreaming} /> : <>
          {getTextSegments(`legacy:${message.id}`, message.content).map((seg, sIdx) => {
            if (seg.type === 'thought') {
              const thoughtKey = `legacy:${message.id}:${sIdx}`
              return (
                <div key={`legacy-th-${sIdx}`} className={sIdx > 0 ? 'mt-1.5' : ''}>
                  <ThinkingBlock
                    content={seg.content}
                    isStreaming={message.isStreaming}
                    initialExpanded={uiState?.thoughtToggles?.[thoughtKey] ?? false}
                    onExpandedChange={(expanded) => {
                      if (uiState) uiState.thoughtToggles[thoughtKey] = expanded
                    }}
                  />
                </div>
              )
            }
            return (
              <div
                key={`legacy-tx-${sIdx}`}
                className={`w-full text-primary text-[17px] leading-[28px] tracking-[-0.01em] select-text break-words ${
                  sIdx > 0 ? 'mt-2' : ''
                }`}
              >
                <MarkdownRenderer content={seg.content} isStreaming={message.isStreaming} />
              </div>
            )
          })}
          </>}
        </div>
      )}
    </div>
  )
})
