import { useState, useRef, useEffect, useCallback } from 'react'
import { Message, ChatSession, ImageAttachment } from '../types/chat'
import { loadSettings, toChatConfig } from '../services/settingsService'
import type { AgentEvent, AgentHistoryMessage, QuestionAnswer, QuestionRequest } from '../../../shared/agentEvents'
import { buildAgentHistory } from '../services/agentHistory'
import type { ExtensionRef } from '../../../shared/extensions'
import { checkpointSessionMessages, reportStorageError } from '../services/chatStorageService'
import type { CheckpointReceipt } from '../services/chatStorageService'
import { temporaryChatTitle } from '../../../shared/chatTitle'
import { applyEventToBlocks, applyEventsToMessages } from '../services/agentEventReducer'
import { checkpointRuntimeMessages } from '../services/chatCheckpoint'

export { applyEventToBlocks, applyEventsToMessages }

interface UseChatProps {
  activeSession?: ChatSession
  sessions?: readonly ChatSession[]
  onUpdateSessionMessages?: (sessionId: string, messages: Message[], autoTitle?: string, checkpoint?: CheckpointReceipt, expectedTitle?: string) => void
  onEnableUncensoredMode?: (sessionId: string) => void
  historyRevision?: number
}

type PendingApproval = Extract<AgentEvent, { type: 'approval_request' }> & { requestId: string }
type PendingQuestion = { requestId: string; questionId: string } & QuestionRequest
type PendingUncensoredPrompt = Extract<AgentEvent, { type: 'uncensored_mode_prompt' }>

interface ChatRuntime {
  sessionId: string
  requestId: string
  assistantMessageId: string
  messages: Message[]
  pending: AgentEvent[]
  approval: PendingApproval | null
  question: PendingQuestion | null
  uncensoredPrompt: PendingUncensoredPrompt | null
  running: boolean
  cancelling: boolean
  restartAfterCorrection: boolean
  checkpointTimer: ReturnType<typeof setTimeout> | null
  checkpointVersion?: number
  checkpointInFlight?: boolean
  checkpointPending?: boolean
}

export function useChat({ activeSession, sessions, onUpdateSessionMessages, onEnableUncensoredMode, historyRevision = 0 }: UseChatProps = {}) {
  const [, setVersion] = useState(0)
  const activeSessionRef = useRef(activeSession)
  const sessionsRef = useRef(sessions)
  const updateRef = useRef(onUpdateSessionMessages)
  const enableUncensoredModeRef = useRef(onEnableUncensoredMode)
  const revisionRef = useRef(historyRevision)
  const historyGenerationRef = useRef(0)
  const runtimesRef = useRef(new Map<string, ChatRuntime>())
  const requestsRef = useRef(new Map<string, ChatRuntime>())
  const restartCorrectionRef = useRef<(runtime: ChatRuntime) => void>(() => {})
  const titleRequestsRef = useRef(new Map<string, object>())
  const approvalChatIdsCacheRef = useRef<{ signature: string; ids: string[] }>({ signature: '[]', ids: [] })
  const generatingTitleChatIdsCacheRef = useRef<{ signature: string; ids: string[] }>({ signature: '[]', ids: [] })
  const viewsRef = useRef(new Map<string, Message[]>())
  const rafIdRef = useRef<number | null>(null)
  activeSessionRef.current = activeSession
  sessionsRef.current = sessions
  updateRef.current = onUpdateSessionMessages
  enableUncensoredModeRef.current = onEnableUncensoredMode

  const refresh = (): void => setVersion(version => version + 1)

  const checkpoint = (runtime: ChatRuntime, forceSync = false): void => {
    checkpointRuntimeMessages(
      runtime,
      forceSync,
      () => runtimesRef.current.get(runtime.sessionId) === runtime,
      (sessionId, savedMessages, receipt) => updateRef.current?.(sessionId, savedMessages, undefined, receipt)
    )
  }

  const processRuntime = (runtime: ChatRuntime, forceCheckpoint = false): void => {
    const batch = runtime.pending.splice(0)
    const activeMessageId = runtime.assistantMessageId
    if (batch.length) {
      const cancelledForCorrection = runtime.restartAfterCorrection && batch.some(event => event.type === 'run_summary' && event.summary.reason === 'cancelled')
      const visibleBatch = cancelledForCorrection
        ? batch.map(event => event.type === 'error' ? { type: 'done' as const, requestId: event.requestId } : event)
        : batch
      runtime.messages = applyEventsToMessages(runtime.messages, visibleBatch, runtime.assistantMessageId)
      if (cancelledForCorrection) {
        const message = runtime.messages.find(item => item.id === activeMessageId)
        if (message?.blocks) message.blocks = message.blocks.map(block => block.type === 'tool' && block.tool.status === 'running'
          ? { ...block, tool: { ...block.tool, status: 'error' } }
          : block)
      }
      const activeAssistant = [...runtime.messages].reverse().find(message => message.role === 'assistant' && message.isStreaming)
      if (activeAssistant) runtime.assistantMessageId = activeAssistant.id
      viewsRef.current.set(runtime.sessionId, runtime.messages)
    }
    const terminal = batch.some(event => event.type === 'done' || event.type === 'error')
    if (terminal) {
      runtime.running = false
      runtime.approval = null
      runtime.question = null
      runtime.uncensoredPrompt = null
      requestsRef.current.delete(runtime.requestId)
    }
    if (terminal || forceCheckpoint) checkpoint(runtime, terminal)
    if (batch.length || terminal) refresh()
  }

  const flushAll = (): void => {
    if (rafIdRef.current !== null) cancelAnimationFrame(rafIdRef.current)
    rafIdRef.current = null
    for (const runtime of runtimesRef.current.values()) {
      if (runtime.pending.length) processRuntime(runtime)
    }
  }

  const discardChat = (sessionId: string): void => {
    window.api?.agent?.discardSession?.(sessionId)
    const runtime = runtimesRef.current.get(sessionId)
    if (runtime) {
      if (runtime.checkpointTimer) clearTimeout(runtime.checkpointTimer)
      requestsRef.current.delete(runtime.requestId)
      runtimesRef.current.delete(sessionId)
      if (runtime.running) window.api?.agent?.cancel(runtime.requestId)
    }
    viewsRef.current.delete(sessionId)
    titleRequestsRef.current.delete(sessionId)
  }

  const discardForHistoryReplacement = useCallback(() => {
    historyGenerationRef.current++
    if (rafIdRef.current !== null) cancelAnimationFrame(rafIdRef.current)
    rafIdRef.current = null
    for (const sessionId of [...runtimesRef.current.keys()]) discardChat(sessionId)
    viewsRef.current.clear()
    titleRequestsRef.current.clear()
    refresh()
  }, [])

  useEffect(() => {
    if (historyRevision !== revisionRef.current) {
      revisionRef.current = historyRevision
      discardForHistoryReplacement()
    }
  }, [historyRevision])

  useEffect(() => {
    if (!sessionsRef.current) return
    const existing = new Set(sessionsRef.current.map(session => session.id))
    let removed = false
    for (const sessionId of runtimesRef.current.keys()) {
      if (!existing.has(sessionId)) { discardChat(sessionId); removed = true }
    }
    if (removed) refresh()
  }, [sessions])

  useEffect(() => {
    const unsubscribeStorage = window.api?.storage?.onCheckpointBackupError?.(() => reportStorageError('Не удалось сохранить резервную копию чата. Проверьте свободное место и права доступа.'))
    const onBeforeUnload = (): void => {
      flushAll()
      for (const runtime of runtimesRef.current.values()) {
        if (runtime.uncensoredPrompt) {
          const { requestId, sessionId, promptId } = runtime.uncensoredPrompt
          window.api?.agent?.answerUncensoredMode(requestId, sessionId, promptId, false)
          runtime.uncensoredPrompt = null
        }
        if (runtime.running) checkpoint(runtime, true)
      }
    }
    window.addEventListener('beforeunload', onBeforeUnload)
    const unsubscribe = window.api?.agent?.onEvent?.((event: AgentEvent) => {
      if (!event.requestId) return
      const runtime = requestsRef.current.get(event.requestId)
      if (!runtime || !runtime.running) return
      if (event.type === 'uncensored_mode_prompt') {
        if (event.sessionId !== runtime.sessionId || runtime.cancelling) {
          window.api?.agent?.answerUncensoredMode(event.requestId, event.sessionId, event.promptId, false)
          return
        }
        runtime.uncensoredPrompt = event
        refresh()
        return
      }
      if (event.type === 'uncensored_mode_enabled') {
        enableUncensoredModeRef.current?.(runtime.sessionId)
        return
      }
      if (event.type === 'approval_request') {
        runtime.approval = { ...event, requestId: event.requestId }
        refresh()
        return
      }
      if (event.type === 'question_request') {
        runtime.question = { ...event, requestId: event.requestId }
        refresh()
        return
      }
      runtime.pending.push(event)
      if (!runtime.checkpointTimer) {
        runtime.checkpointTimer = setTimeout(() => processRuntime(runtime, true), 1000)
      }
      if (event.type === 'done' || event.type === 'error') {
        processRuntime(runtime)
        restartCorrectionRef.current(runtime)
        return
      }
      if (rafIdRef.current === null) {
        rafIdRef.current = requestAnimationFrame(() => {
          rafIdRef.current = null
          for (const item of runtimesRef.current.values()) {
            if (item.pending.length) processRuntime(item)
          }
        })
      }
    })
    return () => {
      window.removeEventListener('beforeunload', onBeforeUnload)
      unsubscribe?.()
      unsubscribeStorage?.()
      flushAll()
      for (const runtime of runtimesRef.current.values()) {
        if (runtime.running) {
          checkpoint(runtime, true)
          window.api?.agent?.cancel(runtime.requestId)
        }
        if (runtime.checkpointTimer) clearTimeout(runtime.checkpointTimer)
      }
      requestsRef.current.clear()
      runtimesRef.current.clear()
    }
  }, [])

  const cancelStream = useCallback(() => {
    const sessionId = activeSessionRef.current?.id
    const runtime = sessionId ? runtimesRef.current.get(sessionId) : undefined
    if (!runtime?.running || runtime.cancelling) return
    processRuntime(runtime)
    runtime.approval = null
    runtime.question = null
    runtime.uncensoredPrompt = null
    runtime.cancelling = true
    window.api?.agent?.cancel(runtime.requestId)
    refresh()
  }, [])

  const startRun = (
    session: ChatSession,
    messages: Message[],
    assistantMessageId: string,
    history: AgentHistoryMessage[],
    planMode: boolean,
    classifyUncensoredMode: boolean,
    latestUserText: string,
    resumeInterrupted: boolean,
    extensionRefs: ExtensionRef[]
  ): void => {
    const settings = loadSettings()
    const requestId = 'req_' + Date.now() + '_' + Math.random().toString(36).slice(2, 9)
    const runtime: ChatRuntime = {
      sessionId: session.id, requestId, assistantMessageId, messages, pending: [],
      approval: null, question: null, uncensoredPrompt: null, running: true, cancelling: false,
      restartAfterCorrection: false, checkpointTimer: null
    }
    runtimesRef.current.set(session.id, runtime)
    requestsRef.current.set(requestId, runtime)
    refresh()
    const config = {
      ...toChatConfig(settings, settings.defaultModel, session.folderPath),
      planMode,
      uncensoredMode: session.uncensoredMode === true,
      classifyUncensoredMode: classifyUncensoredMode && session.uncensoredMode !== true,
      ...(latestUserText ? { latestUserText } : {})
    }
    if (resumeInterrupted && window.api?.agent?.resume) {
      window.api.agent.resume(session.id, config, requestId, 'zipply', history, extensionRefs)
    } else {
      window.api?.agent?.chat(history, config, requestId, 'zipply', session.id, extensionRefs)
    }
    return
  }

  const sendMessageForSession = useCallback((session: ChatSession | undefined, text: string, planMode = false, attachments: ImageAttachment[] = [], classifyUncensoredMode = true, reuseLastUserMessage = false, resumeInterrupted = false, extensionRefs: ExtensionRef[] = []) => {
    const trimmed = text.trim()
    if ((!trimmed && !attachments.length && !extensionRefs.length) || !session) return

    const activeRuntime = runtimesRef.current.get(session.id)
    if (activeRuntime?.running) {
      processRuntime(activeRuntime)
      if (activeRuntime.running) {
        const correction: Message = {
          id: `user-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
          role: 'user', content: trimmed,
          ...(planMode ? { planMode: true } : {}),
          ...(attachments.length ? { attachments } : {}),
          ...(extensionRefs.length ? { extensionRefs } : {})
        }
        activeRuntime.messages = [...activeRuntime.messages, correction]
        viewsRef.current.set(session.id, activeRuntime.messages)
        checkpoint(activeRuntime)
        updateRef.current?.(session.id, activeRuntime.messages)
        if (!activeRuntime.cancelling && !attachments.length && !extensionRefs.length && trimmed && window.api?.agent?.steer) {
          activeRuntime.approval = null
          window.api.agent.steer(activeRuntime.requestId, session.id, trimmed)
          refresh()
          return
        }
        activeRuntime.restartAfterCorrection = true
        if (!activeRuntime.cancelling) {
          if (activeRuntime.uncensoredPrompt) {
            const prompt = activeRuntime.uncensoredPrompt
            window.api?.agent?.answerUncensoredMode(prompt.requestId, prompt.sessionId, prompt.promptId, false)
          }
          activeRuntime.approval = null
          activeRuntime.question = null
          activeRuntime.uncensoredPrompt = null
          activeRuntime.cancelling = true
          window.api?.agent?.cancel(activeRuntime.requestId)
        }
        refresh()
        return
      }
    }

    const previous = viewsRef.current.get(session.id) || session.messages || []
    const lastMessage = previous[previous.length - 1]
    const userMessage: Message | undefined = reuseLastUserMessage && lastMessage?.role === 'user'
      ? undefined
      : { id: 'user-' + Date.now(), role: 'user', content: trimmed, ...(planMode ? { planMode: true } : {}), ...(attachments.length ? { attachments } : {}) }
    if (userMessage && extensionRefs.length) userMessage.extensionRefs = extensionRefs
    const assistantMsgId = `assistant-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
    const placeholder: Message = { id: assistantMsgId, role: 'assistant', content: '', blocks: [], isStreaming: true }
    const messages = [...previous, ...(userMessage ? [userMessage] : []), placeholder]
    viewsRef.current.set(session.id, messages)
    const autoTitle = temporaryChatTitle(trimmed)
    checkpointSessionMessages(session.id, messages)
    updateRef.current?.(session.id, messages, autoTitle)

    const history = buildAgentHistory(previous)
    if (userMessage) history.push(...buildAgentHistory([userMessage]))
    startRun(session, messages, assistantMsgId, history, planMode, classifyUncensoredMode, trimmed ? text : '', resumeInterrupted, extensionRefs)

    if (previous.length === 0 && session.title === 'Новый чат' && trimmed && window.api?.agent?.generateTitle) {
      const settings = loadSettings()
      const titleConfig = {
        ...toChatConfig(settings, settings.defaultModel, session.folderPath),
        planMode,
        uncensoredMode: session.uncensoredMode === true,
        classifyUncensoredMode: false
      }
      const generation = historyGenerationRef.current
      const titleRequest = {}
      titleRequestsRef.current.set(session.id, titleRequest)
      refresh()
      void window.api.agent.generateTitle(trimmed, titleConfig).then(title => {
        if (!title || historyGenerationRef.current !== generation || titleRequestsRef.current.get(session.id) !== titleRequest) return
        const currentRuntime = runtimesRef.current.get(session.id)
        if (currentRuntime?.pending.length) processRuntime(currentRuntime)
        const latestMessages = viewsRef.current.get(session.id)
        if (latestMessages) updateRef.current?.(session.id, latestMessages, title, null, autoTitle)
      }).catch(() => {}).finally(() => {
        if (titleRequestsRef.current.get(session.id) === titleRequest) {
          titleRequestsRef.current.delete(session.id)
          refresh()
        }
      })
    }
  }, [])

  restartCorrectionRef.current = runtime => {
    if (!runtime.restartAfterCorrection || runtime.running || runtimesRef.current.get(runtime.sessionId) !== runtime) return
    const session = sessionsRef.current?.find(item => item.id === runtime.sessionId)
    const latestUser = [...runtime.messages].reverse().find(message => message.role === 'user')
    if (!session || !latestUser) return
    sendMessageForSession(session, latestUser.content || '', latestUser.planMode === true, latestUser.attachments || [], true, true, false, latestUser.extensionRefs || [])
  }

  const sendMessage = useCallback((text: string, planMode = false, attachments: ImageAttachment[] = [], extensionRefs: ExtensionRef[] = []) => {
    sendMessageForSession(activeSessionRef.current, text, planMode, attachments, true, false, false, extensionRefs)
  }, [sendMessageForSession])

  const retry = useCallback(async () => {
    const session = activeSessionRef.current
    if (!session || runtimesRef.current.get(session.id)?.running) return

    const previous = viewsRef.current.get(session.id) || session.messages || []
    if (previous.length === 0) return

    const lastIndex = previous.length - 1
    const lastMsg = previous[lastIndex]
    const agent = window.api?.agent
    const generation = historyGenerationRef.current
    let resumeInterrupted = false
    if (agent?.resume && agent.getJournal) {
      try {
        const journal = await agent.getJournal(session.id)
        if (journal?.active === true) return
        resumeInterrupted = journal?.canResume === true
      } catch { /* Legacy retry can use the chat history. */ }
      if (activeSessionRef.current?.id !== session.id || historyGenerationRef.current !== generation ||
        runtimesRef.current.get(session.id)?.running || (viewsRef.current.get(session.id) || activeSessionRef.current.messages) !== previous) return
    }

    if (lastMsg.role === 'user') {
      const text = lastMsg.content || ''
      if (text || lastMsg.attachments?.length) {
        viewsRef.current.set(session.id, previous.slice(0, lastIndex))
        sendMessageForSession(session, text, lastMsg.planMode === true, lastMsg.attachments, false, false, resumeInterrupted, lastMsg.extensionRefs || [])
        return
      }
    }

    if (lastMsg.role !== 'assistant') return

    const cleanBlocks = (lastMsg.blocks || []).filter(
      b => !(b.type === 'text' && (b.id?.startsWith('err-') || b.content?.startsWith('⚠️')))
    )
    const updatedLastMsg: Message = {
      ...lastMsg,
      content: lastMsg.content?.startsWith('⚠️') ? '' : lastMsg.content,
      blocks: cleanBlocks,
      isStreaming: true
    }

    const messages = [...previous.slice(0, lastIndex), updatedLastMsg]
    viewsRef.current.set(session.id, messages)
    checkpointSessionMessages(session.id, messages)
    updateRef.current?.(session.id, messages)

    let history: AgentHistoryMessage[] = lastMsg.agentHistory?.length
      ? buildAgentHistory([...previous.slice(0, lastIndex), { ...lastMsg, blocks: cleanBlocks }])
      : buildAgentHistory(previous.slice(0, lastIndex))
    if (history.length === 0) history = buildAgentHistory(previous)

    const lastHistoryItem = history[history.length - 1]
    if (lastHistoryItem && lastHistoryItem.role === 'assistant' && !lastHistoryItem.tool_calls?.length) {
      history.push({ role: 'user', content: 'Попробуй еще раз и продолжи работу над задачей.' })
    }

    const latestUser = [...previous.slice(0, lastIndex)].reverse().find(message => message.role === 'user')
    startRun(
      session,
      messages,
      updatedLastMsg.id,
      history,
      latestUser?.planMode === true,
      false,
      '',
      resumeInterrupted,
      latestUser?.extensionRefs || []
    )
  }, [sendMessageForSession])

  const sessionId = activeSession?.id
  const current = sessionId ? runtimesRef.current.get(sessionId) : undefined
  const messages = sessionId ? (viewsRef.current.get(sessionId) || activeSession?.messages || []) : []
  const currentApprovalChatIds = [...runtimesRef.current.values()]
    .filter(runtime => runtime.running && (runtime.approval || runtime.question || runtime.uncensoredPrompt))
    .map(runtime => runtime.sessionId)
  const approvalSignature = JSON.stringify(currentApprovalChatIds)
  if (approvalChatIdsCacheRef.current.signature !== approvalSignature) {
    approvalChatIdsCacheRef.current = { signature: approvalSignature, ids: currentApprovalChatIds }
  }
  const currentGeneratingTitleChatIds = [...titleRequestsRef.current.keys()]
  const generatingTitleSignature = JSON.stringify(currentGeneratingTitleChatIds)
  if (generatingTitleChatIdsCacheRef.current.signature !== generatingTitleSignature) {
    generatingTitleChatIdsCacheRef.current = { signature: generatingTitleSignature, ids: currentGeneratingTitleChatIds }
  }

  const respondToUncensoredPrompt = useCallback((prompt: PendingUncensoredPrompt, enabled: boolean) => {
    const runtime = requestsRef.current.get(prompt.requestId)
    if (!runtime?.running || runtime.cancelling || runtime.sessionId !== prompt.sessionId || runtime.uncensoredPrompt?.promptId !== prompt.promptId) return
    window.api?.agent?.answerUncensoredMode(prompt.requestId, prompt.sessionId, prompt.promptId, enabled)
    runtime.uncensoredPrompt = null
    refresh()
  }, [])
  const respondToQuestion = useCallback((answer: QuestionAnswer) => {
    const runtime = activeSessionRef.current?.id ? runtimesRef.current.get(activeSessionRef.current.id) : undefined
    if (!runtime?.question) return
    window.api?.agent?.answer(runtime.requestId, runtime.question.questionId, answer)
    runtime.question = null
    refresh()
  }, [])
  const respondToApproval = useCallback((approved: boolean, trustTool = false) => {
    const runtime = activeSessionRef.current?.id ? runtimesRef.current.get(activeSessionRef.current.id) : undefined
    if (!runtime?.approval) return
    window.api?.agent?.approve(runtime.requestId, runtime.approval.approvalId, approved, trustTool)
    runtime.approval = null
    refresh()
  }, [])

  return {
    messages,
    isStreaming: Boolean(current?.running),
    sendMessage,
    sendMessageForSession,
    retry,
    cancelStream,
    discardChat,
    discardForHistoryReplacement,
    approval: current?.approval || null,
    question: current?.question || null,
    uncensoredPrompt: [...runtimesRef.current.values()].find(runtime => runtime.running && runtime.uncensoredPrompt)?.uncensoredPrompt || null,
    respondToUncensoredPrompt,
    approvalChatIds: approvalChatIdsCacheRef.current.ids,
    generatingTitleChatIds: generatingTitleChatIdsCacheRef.current.ids,
    runningChatIds: [...runtimesRef.current.values()].filter(runtime => runtime.running).map(runtime => runtime.sessionId),
    respondToQuestion,
    respondToApproval
  }
}
