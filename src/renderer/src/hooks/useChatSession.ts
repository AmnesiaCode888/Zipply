import { useState, useCallback, useRef, useEffect } from 'react'
import {
  ChatSession,
  ChatMessage,
  MessageSegment,
  StepItem,
  StepType,
  StepStats,
  ProjectRef,
  SubagentRoundSegment,
  SwarmSubagentItem,
  WatchdogSegment,
  AttachedImage
} from '../types/chat'
import { AiConfig } from '../types/settings'
import { getHeuristicRoundSummary } from '../utils/summaryUtils'
import { dbSaveSessions, dbLoadSessions, dbSaveImage } from '../utils/indexedDb'
import type { AgentEvent, AgentUsage } from '../../../shared/agentEvents'

const SESSIONS_STORAGE_KEY = 'zipply_chat_sessions'

export interface UseChatSessionReturn {
  chats: ChatSession[]
  activeChatId: string | null
  activeChat: ChatSession | null
  isStreaming: boolean
  selectChat: (chatId: string) => void
  newChat: () => void
  deleteChat: (chatId: string) => void
  sendMessage: (text: string, project?: ProjectRef | null, images?: AttachedImage[]) => void
  cancelGeneration: () => void
}

const DUMMY_CHAT_IDS = new Set([
  'refactor-api',
  'auth-fix',
  'table-component',
  'query-opt',
  'payment-tests'
])

function getStoredSessions(): ChatSession[] {
  try {
    const saved = localStorage.getItem(SESSIONS_STORAGE_KEY) ||
                  localStorage.getItem('zipple_chat_sessions') ||
                  localStorage.getItem('clickcoder_chat_sessions') ||
                  localStorage.getItem('clickcode_chat_sessions') ||
                  localStorage.getItem('click_chat_sessions')
    if (saved) {
      const parsed = JSON.parse(saved)
      if (Array.isArray(parsed)) {
        const realChats = parsed.filter((c) => c && c.id && !DUMMY_CHAT_IDS.has(c.id))
        return realChats
      }
    }
  } catch (e) {
    console.warn('Failed to load chat sessions from localStorage:', e)
  }
  return []
}

function saveSessionsToStorage(sessions: ChatSession[], debounceFileMs = 1000): void {
  if (!Array.isArray(sessions)) return

  // 1. Persist full sessions to rock-solid OS filesystem store (protected against updates and cache wipes)
  if (window.api?.storage?.setStore) {
    window.api.storage.setStore('chats', sessions, debounceFileMs).catch((err) => {
      console.warn('[useChatSession] Failed to persist chats to file storage:', err)
    })
  }

  // 2. Also save to IndexedDB as secondary browser layer
  dbSaveSessions(sessions).catch((err) => {
    console.warn('[useChatSession] Failed to persist to IndexedDB:', err)
  })

  // 3. Save a fast cache to localStorage (with safe fallback if full)
  try {
    localStorage.setItem(SESSIONS_STORAGE_KEY, JSON.stringify(sessions))
  } catch (e) {
    try {
      // If localStorage is full, save metadata-only version to localStorage
      const lightweight = sessions.slice(0, 25).map((s) => ({
        ...s,
        messages: s.messages.map((m) => {
          if (m.images && m.images.length > 0) {
            return {
              ...m,
              images: m.images.map((img) => ({
                id: img.id,
                name: img.name,
                dataUrl: '', // Stripped in localStorage cache, fully preserved in IndexedDB & file storage
                size: img.size
              }))
            }
          }
          return m
        })
      }))
      localStorage.setItem(SESSIONS_STORAGE_KEY, JSON.stringify(lightweight))
    } catch {
      // ignore
    }
  }
}

function mapToolToStepType(toolName: string, action?: string): StepType {
  switch (toolName) {
    case 'file':
      if (action === 'edit' || action === 'delete' || action === 'move') return 'edit'
      if (action === 'write' || action === 'create_dir' || action === 'append') return 'create'
      return 'read'
    case 'grep_search':
      return 'grep'
    case 'terminal':
      return 'run'
    case 'search_web':
      return 'web_search'
    case 'read_page':
      return 'read_page'
    case 'memory':
      return 'memory'
    case 'schedule':
      return 'schedule'
    case 'ask_agent':
      return 'ask_agent'
    case 'read_skill':
      return 'read_skill'
    case 'save_skill':
      return 'save_skill'
    case 'call_mcp_tool':
      return 'mcp'
    default:
      if (toolName.startsWith('mcp_')) return 'mcp'
      return 'read'
  }
}

function getStepActionLabel(toolName: string, action?: string): string {
  switch (toolName) {
    case 'file':
      if (action === 'edit') return 'Edit'
      if (action === 'write' || action === 'append') return 'Create'
      if (action === 'delete') return 'Delete'
      if (action === 'list' || action === 'read_tree' || action === 'glob') return 'List'
      return 'Read'
    case 'grep_search':
      return 'Search'
    case 'terminal':
      return 'Run'
    case 'search_web':
      return 'Web Search'
    case 'read_page':
      return 'Read Web'
    case 'memory':
      return action === 'save' ? 'Remember' : 'Memory'
    case 'schedule':
      return 'Schedule'
    case 'ask_agent':
      return 'Subagent'
    case 'read_skill':
      return 'Load Skill'
    case 'save_skill':
      return 'Save Skill'
    case 'call_mcp_tool':
      return 'MCP Tool'
    default:
      if (toolName.startsWith('mcp_')) return 'MCP Tool'
      return 'Execute'
  }
}

export function normalizeInnerStep(s: any): StepItem {
  const toolName = s.name || s.type || 'tool'
  const action = s.args?.action || (typeof s.action === 'string' ? s.action : undefined)
  const stepType: StepType =
    s.type === 'thought'
      ? 'thought'
      : s.type && s.type !== 'tool'
        ? (s.type as StepType)
        : mapToolToStepType(toolName, action)

  const actionLabel = s.action || getStepActionLabel(toolName, action)
  const targetLabel = s.target || getStepTarget(toolName, s.args || {})

  let stats: StepStats | undefined = s.stats
  if (!stats && s.args) {
    if (s.args.old_content && s.args.new_content) {
      stats = {
        add: String(s.args.new_content).split('\n').length,
        del: String(s.args.old_content).split('\n').length
      }
    } else if (s.args.new_content) {
      stats = { add: String(s.args.new_content).split('\n').length }
    } else if (stepType === 'create' && s.args.content) {
      stats = { add: String(s.args.content).split('\n').length }
    }
  }

  return {
    id: s.id || `sub-step-${Math.random().toString(36).slice(2)}`,
    type: stepType,
    action: actionLabel,
    target: targetLabel,
    stats,
    isDone: s.status === 'done' || s.isDone === true || Boolean(s.result && s.status !== 'loading'),
    result: s.result ?? (s.content ? String(s.content) : undefined),
    args: s.args || {},
    data: s.data,
    error: s.error ?? (s.status === 'error'),
    durationSeconds: s.durationSeconds
  }
}

function getStepTarget(toolName: string, args: Record<string, any> = {}): string {
  if (args.description) return String(args.description)
  if (toolName === 'file') return args.path || args.dest_path || ''
  if (toolName === 'grep_search') return args.query ? `"${args.query}"` : ''
  if (toolName === 'terminal') return args.command || args.action || ''
  if (toolName === 'search_web') return args.query ? `"${args.query}"` : ''
  if (toolName === 'read_page') return args.url || ''
  if (toolName === 'memory') return args.content || args.action || ''
  if (toolName === 'schedule') return args.title || args.prompt || args.action || ''
  if (toolName === 'ask_agent') return args.prompt || args.agent_id || ''
  if (toolName === 'read_skill') return args.skill_name || ''
  if (toolName === 'save_skill') return args.skill_name || ''
  if (toolName === 'call_mcp_tool') return `${args.server_name || 'mcp'}/${args.tool_name || ''}`
  if (toolName.startsWith('mcp_')) return toolName.slice(4)
  return ''
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function normalizeAgentEvent(raw: unknown): AgentEvent | null {
  const event = asRecord(raw)
  if (!event || typeof event.type !== 'string') return null

  switch (event.type) {
    case 'token':
    case 'reasoning':
      return typeof event.content === 'string'
        ? { type: event.type, content: event.content }
        : null
    case 'tool_start': {
      const args = asRecord(event.args) || {}
      return typeof event.callId === 'string' && typeof event.toolName === 'string'
        ? { type: 'tool_start', callId: event.callId, toolName: event.toolName, args }
        : null
    }
    case 'tool_progress':
      return typeof event.callId === 'string'
        ? {
            type: 'tool_progress',
            callId: event.callId,
            message: typeof event.message === 'string' ? event.message : undefined,
            elapsedSeconds: typeof event.elapsedSeconds === 'number' ? event.elapsedSeconds : undefined,
            statusText: typeof event.statusText === 'string' ? event.statusText : undefined,
            innerSteps: Array.isArray(event.innerSteps) ? event.innerSteps : undefined,
            data: event.data
          }
        : null
    case 'tool_result':
      return typeof event.callId === 'string'
        ? {
            type: 'tool_result',
            callId: event.callId,
            result: typeof event.result === 'string' ? event.result : '',
            error: Boolean(event.error),
            data: event.data
          }
        : null
    case 'done': {
      const usage = asRecord(event.usage)
      const normalizedUsage: AgentUsage | undefined = usage &&
        typeof usage.promptTokens === 'number' &&
        typeof usage.completionTokens === 'number' &&
        typeof usage.totalTokens === 'number'
        ? {
            promptTokens: usage.promptTokens,
            completionTokens: usage.completionTokens,
            totalTokens: usage.totalTokens
          }
        : undefined
      return { type: 'done', usage: normalizedUsage }
    }
    case 'error':
      return {
        type: 'error',
        message: typeof event.message === 'string' ? event.message : 'Не удалось выполнить запрос'
      }
    case 'watchdog':
      return typeof event.status === 'string' && typeof event.message === 'string'
        ? {
            type: 'watchdog',
            status: event.status as 'warn' | 'intervene',
            message: event.message,
            toolCount: typeof event.toolCount === 'number' ? event.toolCount : 0
          }
        : null
    default:
      return null
  }
}

export function useChatSession(config?: AiConfig): UseChatSessionReturn {
  const [chats, setChats] = useState<ChatSession[]>(getStoredSessions)
  const [activeChatId, setActiveChatId] = useState<string | null>(null)
  const [isStreaming, setIsStreaming] = useState<boolean>(false)

  const currentRequestIdRef = useRef<string | null>(null)
  const activeChatIdRef = useRef<string | null>(null)
  const roundStartTimeRef = useRef<number>(Date.now())
  const chatsRef = useRef<ChatSession[]>(chats)
  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const isHydratedRef = useRef<boolean>(false)
  const wasStreamingRef = useRef<boolean>(false)
  const pendingTokensRef = useRef<string>('')
  const tokenFlushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pendingReasoningRef = useRef<string>('')
  const reasoningFlushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const streamingChatIdRef = useRef<string | null>(null)

  // Keep a always-current reference to config so callbacks don't go stale
  const configRef = useRef<AiConfig | undefined>(config)
  useEffect(() => {
    configRef.current = config
  }, [config])

  // Hydrate full sessions and images from persistent file storage or IndexedDB on initial mount
  useEffect(() => {
    let isCancelled = false

    const hydrate = async () => {
      try {
        let loadedChats: ChatSession[] | null = null

        // 1. Try loading from persistent OS file storage
        if (window.api?.storage?.getStore) {
          try {
            const fileSessions = await window.api.storage.getStore<ChatSession[]>('chats')
            if (Array.isArray(fileSessions) && fileSessions.length > 0) {
              const valid = fileSessions.filter((c) => c && c.id && !DUMMY_CHAT_IDS.has(c.id))
              if (valid.length > 0) {
                loadedChats = valid
              }
            }
          } catch (e) {
            console.warn('[useChatSession] Error hydrating from file storage:', e)
          }
        }

        // 2. Fallback to IndexedDB
        if (!loadedChats || loadedChats.length === 0) {
          try {
            const dbSessions = await dbLoadSessions()
            if (dbSessions && dbSessions.length > 0) {
              const valid = dbSessions.filter((c) => c && c.id && !DUMMY_CHAT_IDS.has(c.id))
              if (valid.length > 0) {
                loadedChats = valid
              }
            }
          } catch (err) {
            console.warn('[useChatSession] Error hydrating from IndexedDB:', err)
          }
        }

        // 3. Fallback to localStorage if still empty
        if (!loadedChats || loadedChats.length === 0) {
          const localSessions = getStoredSessions()
          if (localSessions.length > 0) {
            loadedChats = localSessions
          }
        }

        if (isCancelled) return

        if (loadedChats && loadedChats.length > 0) {
          setChats(loadedChats)
          chatsRef.current = loadedChats
          // Backfill into file store and IndexedDB if needed
          if (window.api?.storage?.setStore) {
            window.api.storage.setStore('chats', loadedChats, 0).catch(() => {})
          }
          dbSaveSessions(loadedChats).catch(() => {})
        }
      } finally {
        if (!isCancelled) {
          isHydratedRef.current = true
        }
      }
    }

    hydrate()

    return () => {
      isCancelled = true
    }
  }, [])

  // Keep refs synced
  useEffect(() => {
    activeChatIdRef.current = activeChatId
  }, [activeChatId])

  // Persist sessions DEBOUNCED. Only after hydration is complete to prevent overwriting disk storage with empty state.
  useEffect(() => {
    chatsRef.current = chats
    if (!isHydratedRef.current) return

    if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current)
    saveTimeoutRef.current = setTimeout(() => {
      saveTimeoutRef.current = null
      if (isHydratedRef.current) {
        saveSessionsToStorage(chatsRef.current, 1000)
      }
    }, 800)
  }, [chats])

  // Flush pending changes immediately when streaming transitions from running to stopped
  useEffect(() => {
    if (wasStreamingRef.current && !isStreaming) {
      if (isHydratedRef.current) {
        if (saveTimeoutRef.current) {
          clearTimeout(saveTimeoutRef.current)
          saveTimeoutRef.current = null
        }
        saveSessionsToStorage(chatsRef.current, 0)
      }
    }
    wasStreamingRef.current = isStreaming
  }, [isStreaming])

  // Never lose the tail of a conversation if the window closes before the debounce fires
  useEffect(() => {
    const flushOnClose = (): void => {
      if (isHydratedRef.current && saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current)
        saveTimeoutRef.current = null
        saveSessionsToStorage(chatsRef.current, 0)
      }
    }
    window.addEventListener('beforeunload', flushOnClose)
    return () => {
      window.removeEventListener('beforeunload', flushOnClose)
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current)
        saveTimeoutRef.current = null
      }
    }
  }, [])

  const activeChat = chats.find((c) => c.id === activeChatId) || null

  const selectChat = useCallback((chatId: string) => {
    setActiveChatId(chatId)
  }, [])

  const newChat = useCallback(() => {
    setActiveChatId(null)
  }, [])

  const deleteChat = useCallback((chatId: string) => {
    if (activeChatIdRef.current === chatId || streamingChatIdRef.current === chatId) {
      if (tokenFlushTimerRef.current) {
        clearTimeout(tokenFlushTimerRef.current)
        tokenFlushTimerRef.current = null
      }
      if (reasoningFlushTimerRef.current) {
        clearTimeout(reasoningFlushTimerRef.current)
        reasoningFlushTimerRef.current = null
      }
      pendingTokensRef.current = ''
      pendingReasoningRef.current = ''
      streamingChatIdRef.current = null
      if (currentRequestIdRef.current && window.api?.agent) {
        window.api.agent.cancel(currentRequestIdRef.current)
        currentRequestIdRef.current = null
      }
      setIsStreaming(false)
      setActiveChatId(null)
    }
    setChats((prev) => {
      const updated = prev.filter((c) => c.id !== chatId)
      if (isHydratedRef.current) {
        saveSessionsToStorage(updated, 0)
      }
      return updated
    })
  }, [])

  const cancelGeneration = useCallback(() => {
    if (tokenFlushTimerRef.current) {
      clearTimeout(tokenFlushTimerRef.current)
      tokenFlushTimerRef.current = null
    }
    if (reasoningFlushTimerRef.current) {
      clearTimeout(reasoningFlushTimerRef.current)
      reasoningFlushTimerRef.current = null
    }
    pendingTokensRef.current = ''
    pendingReasoningRef.current = ''
    streamingChatIdRef.current = null
    if (currentRequestIdRef.current && window.api?.agent) {
      window.api.agent.cancel(currentRequestIdRef.current)
      currentRequestIdRef.current = null
      setIsStreaming(false)
    }
  }, [])

  // Setup real-time IPC listener for zipply agent events
  useEffect(() => {
    if (!window.api?.agent) return

    const requestAiRoundSummary = (
      chatId: string,
      roundId: string,
      steps: StepItem[]
    ): void => {
      if (!window.api?.agent?.generateRoundSummary || !steps || steps.length === 0) return
      const aiSettings = configRef.current
      if (!aiSettings) return

      const session = chatsRef.current.find((s) => s.id === chatId)
      const userMsg = session?.messages.filter((m) => m.role === 'user').slice(-1)[0]?.text || ''

      window.api.agent
        .generateRoundSummary(steps, userMsg, aiSettings)
        .then((aiSummary) => {
          if (aiSummary && typeof aiSummary === 'string' && aiSummary.trim()) {
            setChats((prev) =>
              prev.map((sc) => {
                if (sc.id !== chatId) return sc
                const updatedMsgs = sc.messages.map((m) => {
                  if (!m.segments) return m
                  const updatedSegs = m.segments.map((seg) => {
                    if (seg.type === 'tool_round' && seg.id === roundId) {
                      return { ...seg, summary: aiSummary.trim() }
                    }
                    return seg
                  })
                  return { ...m, segments: updatedSegs }
                })
                return { ...sc, messages: updatedMsgs }
              })
            )
          }
        })
        .catch(() => {})
    }

    const flushPendingTokens = (): void => {
      if (tokenFlushTimerRef.current) {
        clearTimeout(tokenFlushTimerRef.current)
        tokenFlushTimerRef.current = null
      }
      const pending = pendingTokensRef.current
      if (!pending) return
      pendingTokensRef.current = ''

      const targetChatId = streamingChatIdRef.current || activeChatIdRef.current
      if (!targetChatId) return

      setChats((prev) =>
        prev.map((c) => {
          if (c.id !== targetChatId) return c
          const msgs = [...c.messages]
          if (msgs.length === 0) return c

          const lastMsgIndex = msgs.length - 1
          const assistantMsg = { ...msgs[lastMsgIndex] }
          if (assistantMsg.role !== 'assistant') return c

          const segments: MessageSegment[] = [...(assistantMsg.segments || [])]

          // If previous segment was an active tool round or subagent round, finalize its thinking state
          const lastSeg = segments[segments.length - 1]
          if (lastSeg && lastSeg.type === 'tool_round' && lastSeg.isThinking) {
            const elapsed = Math.max(1, Math.round((Date.now() - roundStartTimeRef.current) / 1000))
            const initialSummary = lastSeg.summary || getHeuristicRoundSummary(lastSeg.steps)
            const roundId = lastSeg.id
            const roundSteps = lastSeg.steps

            segments[segments.length - 1] = {
              ...lastSeg,
              isThinking: false,
              totalWorkedSeconds: lastSeg.totalWorkedSeconds || elapsed,
              summary: initialSummary,
              steps: lastSeg.steps.map((s) => ({ ...s, isDone: true }))
            }

            requestAiRoundSummary(targetChatId, roundId, roundSteps)
          } else if (lastSeg && lastSeg.type === 'subagent_round' && lastSeg.isThinking) {
            const elapsed = lastSeg.totalWorkedSeconds || Math.max(1, Math.round((Date.now() - roundStartTimeRef.current) / 1000))
            segments[segments.length - 1] = {
              ...lastSeg,
              isThinking: false,
              totalWorkedSeconds: elapsed,
              steps: lastSeg.steps.map((s: StepItem) => ({ ...s, isDone: true }))
            }
          }

          const lastSegIndex = segments.length - 1
          if (lastSegIndex >= 0 && segments[lastSegIndex].type === 'text') {
            const textSeg = segments[lastSegIndex] as { type: 'text'; id: string; content: string }
            segments[lastSegIndex] = {
              ...textSeg,
              content: textSeg.content + pending
            }
          } else {
            segments.push({
              id: `seg-text-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
              type: 'text',
              content: pending
            })
          }
          assistantMsg.segments = segments
          msgs[lastMsgIndex] = assistantMsg
          return { ...c, messages: msgs }
        })
      )
    }

    const flushPendingReasoning = (): void => {
      if (reasoningFlushTimerRef.current) {
        clearTimeout(reasoningFlushTimerRef.current)
        reasoningFlushTimerRef.current = null
      }
      const pending = pendingReasoningRef.current
      if (!pending) return
      pendingReasoningRef.current = ''

      const targetChatId = streamingChatIdRef.current || activeChatIdRef.current
      if (!targetChatId) return

      setChats((prev) =>
        prev.map((c) => {
          if (c.id !== targetChatId) return c
          const msgs = [...c.messages]
          if (msgs.length === 0) return c

          const lastMsgIndex = msgs.length - 1
          const assistantMsg = { ...msgs[lastMsgIndex] }
          if (assistantMsg.role !== 'assistant') return c

          const segments: MessageSegment[] = [...(assistantMsg.segments || [])]
          const lastSeg = segments[segments.length - 1]

          if (!lastSeg || lastSeg.type !== 'tool_round' || !lastSeg.isThinking) {
            roundStartTimeRef.current = Date.now()
            const newRound: MessageSegment = {
              id: `seg-tr-${Date.now()}`,
              type: 'tool_round',
              isThinking: true,
              steps: [
                {
                  id: `thought-${Date.now()}`,
                  type: 'thought',
                  action: 'Thinking',
                  isDone: false,
                  result: pending
                }
              ]
            }
            segments.push(newRound)
          } else {
            const tr = { ...lastSeg } as { type: 'tool_round'; id: string; steps: StepItem[]; isThinking?: boolean }
            const steps = [...tr.steps]
            const lastStep = steps[steps.length - 1]

            if (lastStep && lastStep.type === 'thought') {
              steps[steps.length - 1] = {
                ...lastStep,
                result: (lastStep.result || '') + pending
              }
            } else {
              steps.push({
                id: `thought-${Date.now()}`,
                type: 'thought',
                action: 'Thinking',
                isDone: false,
                result: pending
              })
            }
            tr.steps = steps
            segments[segments.length - 1] = tr
          }

          assistantMsg.segments = segments
          msgs[lastMsgIndex] = assistantMsg
          return { ...c, messages: msgs }
        })
      )
    }

    const unsubscribe = window.api.agent.onEvent((rawEvent: AgentEvent) => {
      const evt = normalizeAgentEvent(rawEvent)
      if (!evt) return

      const targetChatId = streamingChatIdRef.current || activeChatIdRef.current
      if (!targetChatId) return

      // 1. TOKEN: Streaming assistant text response (batched throttling)
      if (evt.type === 'token') {
        const token = evt.content || ''
        if (!token) return

        if (pendingReasoningRef.current) {
          flushPendingReasoning()
        }

        pendingTokensRef.current += token

        if (!tokenFlushTimerRef.current) {
          tokenFlushTimerRef.current = setTimeout(flushPendingTokens, 40)
        }
        return
      }

      // 2. REASONING: Streaming thoughts / chain of thought (batched throttling)
      if (evt.type === 'reasoning') {
        const rChunk = evt.content || ''
        if (!rChunk) return

        if (pendingTokensRef.current) {
          flushPendingTokens()
        }

        pendingReasoningRef.current += rChunk

        if (!reasoningFlushTimerRef.current) {
          reasoningFlushTimerRef.current = setTimeout(flushPendingReasoning, 40)
        }
        return
      }

      // Flush any pending streamed tokens or reasoning before handling structural events
      if (pendingTokensRef.current) flushPendingTokens()
      if (pendingReasoningRef.current) flushPendingReasoning()

      setChats((prev) =>
        prev.map((c) => {
          if (c.id !== targetChatId) return c
          const msgs = [...c.messages]
          if (msgs.length === 0) return c

          const lastMsgIndex = msgs.length - 1
          const assistantMsg = { ...msgs[lastMsgIndex] }
          if (assistantMsg.role !== 'assistant') return c

          const segments: MessageSegment[] = [...(assistantMsg.segments || [])]

          // 3. TOOL_START: New tool execution started
          // 3. TOOL_START: New tool execution started
          if (evt.type === 'tool_start') {
            const toolName = evt.toolName || 'tool'
            const args = evt.args || {}

            if (toolName === 'ask_agent') {
              // ── SUBAGENT START: Create dedicated SubagentRoundSegment ──
              const lastSeg = segments[segments.length - 1]
              if (lastSeg && lastSeg.type === 'tool_round' && lastSeg.isThinking) {
                const hasRealSteps = lastSeg.steps.some((s) => s.type !== 'thought')
                if (!hasRealSteps) {
                  segments.pop()
                } else {
                  const elapsed = Math.max(1, Math.round((Date.now() - roundStartTimeRef.current) / 1000))
                  segments[segments.length - 1] = {
                    ...lastSeg,
                    isThinking: false,
                    totalWorkedSeconds: lastSeg.totalWorkedSeconds || elapsed,
                    summary: lastSeg.summary || getHeuristicRoundSummary(lastSeg.steps),
                    steps: lastSeg.steps.map((s) => ({ ...s, isDone: true }))
                  }
                }
              } else if (lastSeg && lastSeg.type === 'subagent_round' && lastSeg.isThinking) {
                segments[segments.length - 1] = {
                  ...lastSeg,
                  isThinking: false,
                  steps: lastSeg.steps.map((s: StepItem) => ({ ...s, isDone: true }))
                }
              }

              roundStartTimeRef.current = Date.now()
              const targetAgentId = (args.agent_id as string) || 'ask'
              const agentDisplayName =
                targetAgentId === 'terminal'
                  ? 'TerminalAgent'
                  : targetAgentId === 'web_search'
                    ? 'WebSearchAgent'
                    : 'AskAgent'
              const isSwarm = Array.isArray(args.tasks) && args.tasks.length > 0

              const subagentSeg: SubagentRoundSegment = {
                id: `seg-subagent-${evt.callId || Date.now()}`,
                type: 'subagent_round',
                callId: evt.callId || '',
                agentId: targetAgentId,
                agentName: agentDisplayName,
                prompt: (args.prompt as string) || (typeof args.description === 'string' ? args.description : ''),
                context: (args.context as string) || '',
                isThinking: true,
                totalWorkedSeconds: 0,
                steps: [],
                isSwarm,
                swarmResults: isSwarm
                  ? (args.tasks as any[]).map((t) => ({
                      agentId: t.agent_id || 'ask',
                      agentName:
                        t.agent_id === 'terminal'
                          ? 'TerminalAgent'
                          : t.agent_id === 'web_search'
                            ? 'WebSearchAgent'
                            : 'AskAgent',
                      prompt: t.prompt || '',
                      steps: [],
                      isThinking: true,
                      totalWorkedSeconds: 0
                    }))
                  : undefined
              }

              segments.push(subagentSeg)
              assistantMsg.segments = segments
              msgs[lastMsgIndex] = assistantMsg
              return { ...c, messages: msgs }
            }

            // ── STANDARD TOOL START ──
            const lastSeg = segments[segments.length - 1]
            if (lastSeg && lastSeg.type === 'subagent_round' && lastSeg.isThinking) {
              segments[segments.length - 1] = {
                ...lastSeg,
                isThinking: false,
                steps: lastSeg.steps.map((s: StepItem) => ({ ...s, isDone: true }))
              }
            }

            const action = typeof args.action === 'string' ? args.action : undefined
            const stepType = mapToolToStepType(toolName, action)
            const actionLabel = getStepActionLabel(toolName, action)
            const targetLabel = getStepTarget(toolName, args)

            let stats: StepStats | undefined = undefined
            if (args.old_content && args.new_content) {
              stats = {
                add: String(args.new_content).split('\n').length,
                del: String(args.old_content).split('\n').length
              }
            } else if (args.new_content) {
              stats = { add: String(args.new_content).split('\n').length }
            }

            const newStep: StepItem = {
              id: evt.callId || `step-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
              type: stepType,
              action: actionLabel,
              target: targetLabel,
              stats,
              isDone: false,
              args
            }

            const currentLastSeg = segments[segments.length - 1]
            if (!currentLastSeg || currentLastSeg.type !== 'tool_round' || !currentLastSeg.isThinking) {
              roundStartTimeRef.current = Date.now()
              segments.push({
                id: `seg-tr-${Date.now()}`,
                type: 'tool_round',
                isThinking: true,
                steps: [newStep]
              })
            } else {
              const tr = { ...currentLastSeg } as { type: 'tool_round'; id: string; steps: StepItem[]; isThinking?: boolean }
              const steps = tr.steps.map((s) => (s.type === 'thought' ? { ...s, isDone: true } : s))
              tr.steps = [...steps, newStep]
              segments[segments.length - 1] = tr
            }

            assistantMsg.segments = segments
            msgs[lastMsgIndex] = assistantMsg
            return { ...c, messages: msgs }
          }

          // 4. TOOL_PROGRESS: Progress update on long-running step
          if (evt.type === 'tool_progress') {
            // Check if this progress belongs to a subagent_round
            const subIdx = segments.findIndex(
              (s) => s.type === 'subagent_round' && (s as SubagentRoundSegment).callId === evt.callId
            )
            if (subIdx >= 0) {
              const subSeg = { ...(segments[subIdx] as SubagentRoundSegment) }
              const rawInner = Array.isArray(evt.innerSteps) ? evt.innerSteps : []
              const normSteps = rawInner.map(normalizeInnerStep)
              const rawProgressData = asRecord(evt.data)
              const progressData = (rawProgressData?.data && typeof rawProgressData.data === 'object')
                ? asRecord(rawProgressData.data)
                : rawProgressData

              if (evt.elapsedSeconds) subSeg.totalWorkedSeconds = evt.elapsedSeconds
              if (typeof progressData?.partialAnswer === 'string') {
                subSeg.partialAnswer = progressData.partialAnswer
              }

              const tIdx = typeof progressData?.taskIndex === 'number' ? progressData.taskIndex : -1
              if (subSeg.isSwarm && subSeg.swarmResults && tIdx >= 0 && subSeg.swarmResults[tIdx]) {
                const updatedSwarm = [...subSeg.swarmResults]
                const rawTaskSteps = Array.isArray(progressData?.taskInnerSteps)
                  ? (progressData.taskInnerSteps as any[])
                  : rawInner
                const taskNormSteps = rawTaskSteps.map(normalizeInnerStep)

                updatedSwarm[tIdx] = {
                  ...updatedSwarm[tIdx],
                  steps: taskNormSteps,
                  partialAnswer: (typeof progressData?.partialAnswer === 'string' ? progressData.partialAnswer : updatedSwarm[tIdx].partialAnswer),
                  isThinking: true
                }
                subSeg.swarmResults = updatedSwarm

                // Accumulate all steps across all swarm subagents
                const allSwarmSteps: StepItem[] = []
                for (const sw of updatedSwarm) {
                  if (Array.isArray(sw.steps)) {
                    allSwarmSteps.push(...sw.steps)
                  }
                }
                subSeg.steps = allSwarmSteps.length > 0 ? allSwarmSteps : normSteps
              } else {
                subSeg.steps = normSteps
              }

              segments[subIdx] = subSeg
              assistantMsg.segments = segments
              msgs[lastMsgIndex] = assistantMsg
              return { ...c, messages: msgs }
            }

            const lastSegIndex = segments.length - 1
            if (lastSegIndex >= 0 && segments[lastSegIndex].type === 'tool_round') {
              const tr = { ...segments[lastSegIndex] } as { type: 'tool_round'; id: string; steps: StepItem[] }
              const steps = [...tr.steps]
              const targetIdx = evt.callId ? steps.findIndex((s) => s.id === evt.callId) : steps.length - 1
              if (targetIdx >= 0) {
                const existing = steps[targetIdx]
                const hasInnerSteps = Array.isArray(evt.innerSteps) && evt.innerSteps.length > 0
                const prevData = (existing.data && typeof existing.data === 'object') ? existing.data as Record<string, unknown> : {}
                steps[targetIdx] = {
                  ...existing,
                  durationSeconds: evt.elapsedSeconds || existing.durationSeconds,
                  data: hasInnerSteps
                    ? { ...prevData, innerSteps: evt.innerSteps, partialAnswer: (evt as any).data?.partialAnswer ?? (prevData.partialAnswer ?? '') }
                    : existing.data
                }
                tr.steps = steps
                segments[lastSegIndex] = tr
                assistantMsg.segments = segments
                msgs[lastMsgIndex] = assistantMsg
                return { ...c, messages: msgs }
              }
            }
          }

          // 5. TOOL_RESULT: Tool execution finished with result
          if (evt.type === 'tool_result') {
            // Check if this result belongs to a subagent_round
            const subIdx = segments.findIndex(
              (s) => s.type === 'subagent_round' && (s as SubagentRoundSegment).callId === evt.callId
            )
            if (subIdx >= 0) {
              const subSeg = { ...(segments[subIdx] as SubagentRoundSegment) }
              const resData = asRecord(evt.data)

              let normSteps = subSeg.steps
              if (resData?.allInnerSteps && Array.isArray(resData.allInnerSteps)) {
                normSteps = resData.allInnerSteps.map(normalizeInnerStep)
              } else if (resData?.innerSteps && Array.isArray(resData.innerSteps)) {
                normSteps = resData.innerSteps.map(normalizeInnerStep)
              }

              let finalAnswer = typeof evt.result === 'string' ? evt.result : ''
              if (resData?.answer && typeof resData.answer === 'string') {
                finalAnswer = resData.answer
              }

              const elapsed = subSeg.totalWorkedSeconds || Math.max(1, Math.round((Date.now() - roundStartTimeRef.current) / 1000))
              const roundSummary = subSeg.summary || getHeuristicRoundSummary(normSteps) || (subSeg.prompt ? subSeg.prompt.slice(0, 50) : '')

              subSeg.isThinking = false
              subSeg.steps = normSteps.map((s: StepItem) => ({ ...s, isDone: true }))
              subSeg.answer = finalAnswer
              subSeg.totalWorkedSeconds = elapsed
              subSeg.summary = roundSummary
              subSeg.error = evt.error

              if (resData?.swarm && Array.isArray(resData.results)) {
                subSeg.isSwarm = true
                const swarmItems: SwarmSubagentItem[] = resData.results.map((r: any) => ({
                  agentId: r.agentId || 'ask',
                  agentName:
                    r.agentName ||
                    (r.agentId === 'terminal'
                      ? 'TerminalAgent'
                      : r.agentId === 'web_search'
                        ? 'WebSearchAgent'
                        : 'AskAgent'),
                  prompt: r.prompt || '',
                  answer: r.answer || '',
                  steps: Array.isArray(r.innerSteps) ? r.innerSteps.map(normalizeInnerStep) : [],
                  isThinking: false,
                  error: r.error
                }))
                subSeg.swarmResults = swarmItems

                const allSwarmSteps: StepItem[] = []
                for (const sw of swarmItems) {
                  if (Array.isArray(sw.steps)) {
                    allSwarmSteps.push(...sw.steps)
                  }
                }
                if (allSwarmSteps.length > 0) {
                  subSeg.steps = allSwarmSteps.map((s) => ({ ...s, isDone: true }))
                }
              }

              segments[subIdx] = subSeg
              assistantMsg.segments = segments
              msgs[lastMsgIndex] = assistantMsg
              return { ...c, messages: msgs }
            }

            const lastSegIndex = segments.length - 1
            if (lastSegIndex >= 0 && segments[lastSegIndex].type === 'tool_round') {
              const tr = { ...segments[lastSegIndex] } as { type: 'tool_round'; id: string; steps: StepItem[] }
              const steps = [...tr.steps]
              const targetIdx = evt.callId ? steps.findIndex((s) => s.id === evt.callId) : steps.length - 1

              if (targetIdx >= 0) {
                const existing = steps[targetIdx]
                let calculatedStats = existing.stats

                const resultData = asRecord(evt.data)
                if (resultData?.stats) {
                  calculatedStats = resultData.stats as StepStats
                } else if (existing.type === 'create' && existing.args?.content) {
                  calculatedStats = { add: String(existing.args.content).split('\n').length }
                }

                steps[targetIdx] = {
                  ...existing,
                  isDone: true,
                  result: evt.result || '',
                  data: evt.data,
                  error: evt.error,
                  stats: calculatedStats
                }
                tr.steps = steps
                segments[lastSegIndex] = tr
                assistantMsg.segments = segments
                msgs[lastMsgIndex] = assistantMsg
                return { ...c, messages: msgs }
              }
            }
          }

          // 6. DONE: Full turn completed
          if (evt.type === 'done') {
            const elapsed = Math.max(1, Math.round((Date.now() - roundStartTimeRef.current) / 1000))
            const updatedSegments = segments
              .map((seg) => {
                if (seg.type === 'tool_round') {
                  const initialSummary = seg.summary || getHeuristicRoundSummary(seg.steps)
                  if (seg.isThinking) {
                    requestAiRoundSummary(targetChatId, seg.id, seg.steps)
                  }
                  return {
                    ...seg,
                    isThinking: false,
                    totalWorkedSeconds: seg.totalWorkedSeconds || elapsed,
                    summary: initialSummary,
                    steps: seg.steps.map((s) => ({ ...s, isDone: true }))
                  }
                }
                if (seg.type === 'subagent_round') {
                  const subSeg = seg as SubagentRoundSegment
                  let effectiveSteps = subSeg.steps
                  if (subSeg.isSwarm && subSeg.swarmResults && subSeg.swarmResults.length > 0) {
                    const allSwarmSteps: StepItem[] = []
                    for (const sw of subSeg.swarmResults) {
                      if (Array.isArray(sw.steps)) {
                        allSwarmSteps.push(...sw.steps)
                      }
                    }
                    if (allSwarmSteps.length > 0) {
                      effectiveSteps = allSwarmSteps
                    }
                  }

                  const initialSummary =
                    subSeg.summary ||
                    getHeuristicRoundSummary(effectiveSteps) ||
                    (subSeg.prompt ? subSeg.prompt.slice(0, 50) : '')
                  return {
                    ...subSeg,
                    isThinking: false,
                    totalWorkedSeconds: subSeg.totalWorkedSeconds || elapsed,
                    summary: initialSummary,
                    steps: effectiveSteps.map((s: StepItem) => ({ ...s, isDone: true }))
                  }
                }
                // Resolve watchdog cards: dim them when session completes
                if (seg.type === 'watchdog') return { ...seg, resolved: true }
                return seg
              })
              .filter((seg) => {
                if (seg.type === 'text') {
                  return Boolean(seg.content && seg.content.trim())
                }
                if (seg.type === 'tool_round') {
                  return seg.steps && seg.steps.length > 0
                }
                return true
              })

            assistantMsg.isThinking = false
            assistantMsg.segments = updatedSegments
            msgs[lastMsgIndex] = assistantMsg
            setIsStreaming(false)
            currentRequestIdRef.current = null
            streamingChatIdRef.current = null

            // Auto-generate title if this was the first prompt in a new session
            if (c.messages.length <= 2 && (c.title.startsWith('Новый диалог') || c.title.length > 30)) {
              const firstUserMsg = c.messages.find((m) => m.role === 'user')?.text || ''
              if (firstUserMsg) {
                const aiSettings = configRef.current

                if (window.api?.agent?.generateTitle && aiSettings) {
                  window.api.agent.generateTitle(firstUserMsg, aiSettings).then((generatedTitle) => {
                    if (generatedTitle) {
                      setChats((cur) =>
                        cur.map((session) =>
                          session.id === c.id ? { ...session, title: generatedTitle } : session
                        )
                      )
                    }
                  })
                }
              }
            }

            return { ...c, messages: msgs }
          }

          // 7. ERROR: Execution error
          if (evt.type === 'error') {
            const updatedSegments = segments.map((seg) => {
              if (seg.type === 'tool_round' || seg.type === 'subagent_round') {
                return { ...seg, isThinking: false }
              }
              // Resolve watchdog cards on error too
              if (seg.type === 'watchdog') return { ...seg, resolved: true }
              return seg
            })

            if (updatedSegments.length === 0 || !updatedSegments.some((s) => s.type === 'text')) {
              updatedSegments.push({
                id: `seg-err-${Date.now()}`,
                type: 'text',
                content: `Ошибка: ${evt.message || 'Не удалось выполнить запрос'}`
              })
            }

            assistantMsg.isThinking = false
            assistantMsg.segments = updatedSegments
            msgs[lastMsgIndex] = assistantMsg
            setIsStreaming(false)
            currentRequestIdRef.current = null
            streamingChatIdRef.current = null
            return { ...c, messages: msgs }
          }

          // 8. WATCHDOG: Warn or intervene signal from the watchdog agent
          if (evt.type === 'watchdog') {
            // Update the EXISTING watchdog card if one already exists
            // (prevents card spam when watchdog fires multiple times)
            const existingIdx = segments.findIndex((s) => s.type === 'watchdog')

            const watchdogSeg: WatchdogSegment = {
              id: existingIdx >= 0
                ? (segments[existingIdx] as WatchdogSegment).id
                : `seg-watchdog-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
              type: 'watchdog',
              status: evt.status,
              message: evt.message,
              toolCount: evt.toolCount,
              resolved: false
            }

            // Immutable update — never mutate the existing segments array directly
            const newSegments = existingIdx >= 0
              ? segments.map((s, idx) => (idx === existingIdx ? watchdogSeg : s))
              : [...segments, watchdogSeg]

            assistantMsg.segments = newSegments
            msgs[lastMsgIndex] = assistantMsg
            return { ...c, messages: msgs }
          }

          return c
        })
      )
    })

    return () => {
      if (tokenFlushTimerRef.current) {
        clearTimeout(tokenFlushTimerRef.current)
        tokenFlushTimerRef.current = null
      }
      if (reasoningFlushTimerRef.current) {
        clearTimeout(reasoningFlushTimerRef.current)
        reasoningFlushTimerRef.current = null
      }
      if (pendingTokensRef.current) flushPendingTokens()
      if (pendingReasoningRef.current) flushPendingReasoning()
      if (typeof unsubscribe === 'function') {
        unsubscribe()
      }
    }
  }, [])

  // Handle user message submission
  const sendMessage = useCallback((text: string, project?: ProjectRef | null, images?: AttachedImage[]): void => {
    if (!text.trim() && (!images || images.length === 0)) return

    // Read AI config from context (passed via prop -> ref) with safe defaults
    let aiConfig: any = {
      baseUrl: 'https://api.deepseek.com/v1',
      model: 'deepseek-chat',
      apiKey: '',
      stream: true,
      temperature: 0.7,
      maxTokens: 4096,
      baseDir: ''
    }
    if (configRef.current && typeof configRef.current === 'object') {
      aiConfig = { ...aiConfig, ...configRef.current }
    }


    const requestId = `req_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`
    currentRequestIdRef.current = requestId
    roundStartTimeRef.current = Date.now()
    setIsStreaming(true)

    const userMsg: ChatMessage = {
      id: `msg-${Date.now()}-u`,
      role: 'user',
      text: text,
      images: images && images.length > 0 ? images : undefined
    }

    if (images && images.length > 0) {
      for (const img of images) {
        dbSaveImage(img).catch(() => {})
      }
    }

    const assistantMsg: ChatMessage = {
      id: `msg-${Date.now()}-a`,
      role: 'assistant',
      isThinking: true,
      segments: []
    }

    let targetChatId = activeChatIdRef.current
    let conversationHistory: Array<{ role: 'user' | 'assistant'; content: any }> = []

    const formatUserPayload = (msgText: string, msgImages?: AttachedImage[]) => {
      if (msgImages && msgImages.length > 0) {
        const parts: any[] = [{ type: 'text', text: msgText || 'Image attachment' }]
        for (const img of msgImages) {
          parts.push({
            type: 'image_url',
            image_url: { url: img.dataUrl }
          })
        }
        return parts
      }
      return msgText
    }

    if (!targetChatId) {
      targetChatId = `chat-${Date.now()}`
      const cleanTitle = text.length > 32 ? `${text.slice(0, 32)}...` : text || 'Новый диалог'

      const newSession: ChatSession = {
        id: targetChatId,
        title: cleanTitle,
        dateGroup: 'Сегодня',
        messages: [userMsg, assistantMsg],
        ...(project ? { project: { name: project.name, path: project.path } } : {})
      }

      setChats((prev) => [newSession, ...prev])
      setActiveChatId(targetChatId)
      activeChatIdRef.current = targetChatId

      conversationHistory = [{ role: 'user', content: formatUserPayload(text, images) }]
    } else {
      const existingChat = chatsRef.current.find((c) => c.id === targetChatId)
      if (existingChat) {
        conversationHistory = existingChat.messages
          .map((m) => {
            let content = m.text || ''
            if (m.role === 'assistant' && m.segments && m.segments.length > 0) {
              const textParts: string[] = []
              const toolActions: string[] = []

              for (const seg of m.segments) {
                if (seg.type === 'text' && seg.content?.trim()) {
                  textParts.push(seg.content.trim())
                } else if (seg.type === 'tool_round') {
                  const summary = seg.summary || getHeuristicRoundSummary(seg.steps)
                  if (summary) {
                    toolActions.push(`[Действия: ${summary}]`)
                  }
                } else if (seg.type === 'subagent_round') {
                  const aName = seg.agentName || seg.agentId || 'Субагент'
                  const summary = seg.summary || (seg.prompt ? `Субагент (${aName}): ${seg.prompt}` : `Субагент (${aName})`)
                  if (summary) {
                    toolActions.push(`[${summary}]`)
                  }
                  if (seg.answer?.trim()) {
                    toolActions.push(`[Ответ субагента: ${seg.answer.trim()}]`)
                  }
                }
              }

              if (toolActions.length > 0 && textParts.length === 0) {
                content = toolActions.join('\n')
              } else if (toolActions.length > 0) {
                content = `${toolActions.join('\n')}\n\n${textParts.join('\n')}`
              } else {
                content = textParts.join('\n')
              }
            }
            if (m.role === 'user' && m.images && m.images.length > 0) {
              return { role: m.role, content: formatUserPayload(content, m.images) }
            }
            return { role: m.role, content: content.trim() }
          })
          .filter((m) => (Array.isArray(m.content) ? m.content.length > 0 : m.content.length > 0))
        conversationHistory.push({ role: 'user', content: formatUserPayload(text, images) })
      }

      setChats((prev) =>
        prev.map((c) => {
          if (c.id !== targetChatId) return c
          return {
            ...c,
            messages: [...c.messages, userMsg, assistantMsg]
          }
        })
      )
    }

    streamingChatIdRef.current = targetChatId
    pendingTokensRef.current = ''
    pendingReasoningRef.current = ''

    // Bind the working directory: explicit project > the chat's stored project
    const effectiveWorkspace =
      project?.path ||
      chatsRef.current.find((c) => c.id === targetChatId)?.project?.path ||
      undefined
    if (effectiveWorkspace) {
      aiConfig.workspacePath = effectiveWorkspace
    }

    // Call real zipply agent in Electron main process
    if (window.api?.agent?.chat) {
      window.api.agent.chat(conversationHistory, aiConfig, requestId, 'zipply')
    } else {
      console.warn('window.api.agent is not available in current environment')
      setIsStreaming(false)
    }
  }, [])

  return {
    chats,
    activeChatId,
    activeChat,
    isStreaming,
    selectChat,
    newChat,
    deleteChat,
    sendMessage,
    cancelGeneration
  }
}

export default useChatSession
