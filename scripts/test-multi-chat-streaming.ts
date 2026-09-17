import assert from 'assert'
import type { AgentEvent } from '../src/shared/agentEvents'

console.log('🧪 Starting Multi-Chat Streaming & Concurrency Verification Suite...\n')

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

export function normalizeAgentEvent(raw: unknown): AgentEvent | null {
  const event = asRecord(raw)
  if (!event || typeof event.type !== 'string') return null
  const requestId = typeof event.requestId === 'string' ? event.requestId : undefined

  switch (event.type) {
    case 'token':
    case 'reasoning':
      return typeof event.content === 'string'
        ? { type: event.type, content: event.content, requestId }
        : null
    case 'tool_start': {
      const args = asRecord(event.args) || {}
      return typeof event.callId === 'string' && typeof event.toolName === 'string'
        ? { type: 'tool_start', callId: event.callId, toolName: event.toolName, args, requestId }
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
            data: event.data,
            requestId
          }
        : null
    case 'tool_result':
      return typeof event.callId === 'string'
        ? {
            type: 'tool_result',
            callId: event.callId,
            result: typeof event.result === 'string' ? event.result : '',
            error: Boolean(event.error),
            data: event.data,
            requestId
          }
        : null
    case 'done': {
      const usage = asRecord(event.usage)
      const normalizedUsage =
        usage &&
        typeof usage.promptTokens === 'number' &&
        typeof usage.completionTokens === 'number' &&
        typeof usage.totalTokens === 'number'
          ? {
              promptTokens: usage.promptTokens,
              completionTokens: usage.completionTokens,
              totalTokens: usage.totalTokens
            }
          : undefined
      return { type: 'done', usage: normalizedUsage, requestId }
    }
    case 'error':
      return {
        type: 'error',
        message: typeof event.message === 'string' ? event.message : 'Не удалось выполнить запрос',
        requestId
      }
    case 'watchdog':
      return typeof event.status === 'string' && typeof event.message === 'string'
        ? {
            type: 'watchdog',
            status: event.status as 'warn' | 'intervene',
            message: event.message,
            toolCount: typeof event.toolCount === 'number' ? event.toolCount : 0,
            requestId
          }
        : null
    default:
      return null
  }
}

export class StreamRouter {
  activeRequests = new Map<string, string>() // requestId -> chatId
  chatRequests = new Map<string, string>()   // chatId -> requestId
  chatContents = new Map<string, string>()   // chatId -> text content
  chatStatus = new Map<string, 'streaming' | 'idle' | 'cancelled' | 'error'>()
  pendingTokens = new Map<string, string>()  // chatId -> pending token buffer

  startRequest(chatId: string, requestId: string) {
    this.activeRequests.set(requestId, chatId)
    this.chatRequests.set(chatId, requestId)
    this.chatStatus.set(chatId, 'streaming')
    if (!this.chatContents.has(chatId)) {
      this.chatContents.set(chatId, '')
    }
  }

  cancelRequest(chatId: string) {
    const requestId = this.chatRequests.get(chatId)
    if (requestId) {
      this.activeRequests.delete(requestId)
      this.chatRequests.delete(chatId)
      this.chatStatus.set(chatId, 'cancelled')
      this.pendingTokens.delete(chatId)
    }
  }

  routeEvent(rawEvent: unknown, activeChatId: string) {
    const evt = normalizeAgentEvent(rawEvent)
    if (!evt) return null

    const targetChatId = evt.requestId ? this.activeRequests.get(evt.requestId) : undefined
    if (!targetChatId) {
      return null
    }

    if (evt.type === 'token') {
      const prevPending = this.pendingTokens.get(targetChatId) || ''
      this.pendingTokens.set(targetChatId, prevPending + evt.content)
      const content = (this.chatContents.get(targetChatId) || '') + evt.content
      this.chatContents.set(targetChatId, content)
    } else if (evt.type === 'done') {
      this.activeRequests.delete(evt.requestId!)
      this.chatRequests.delete(targetChatId)
      this.chatStatus.set(targetChatId, 'idle')
      this.pendingTokens.delete(targetChatId)
    } else if (evt.type === 'error') {
      this.activeRequests.delete(evt.requestId!)
      this.chatRequests.delete(targetChatId)
      this.chatStatus.set(targetChatId, 'error')
      this.pendingTokens.delete(targetChatId)
    }

    return { targetChatId, evt }
  }
}

async function runVerification() {
  console.log('▶ Test 1: normalizeAgentEvent preserves requestId across all events...')
  const tokenEvt = normalizeAgentEvent({ type: 'token', content: 'Hello', requestId: 'req-1' })
  assert.strictEqual(tokenEvt?.type, 'token')
  assert.strictEqual(tokenEvt?.requestId, 'req-1')

  const toolStartEvt = normalizeAgentEvent({
    type: 'tool_start',
    callId: 'call-1',
    toolName: 'file',
    args: { path: 'test.ts' },
    requestId: 'req-1'
  })
  assert.strictEqual(toolStartEvt?.requestId, 'req-1')

  const doneEvt = normalizeAgentEvent({
    type: 'done',
    usage: { promptTokens: 10, completionTokens: 20, totalTokens: 30 },
    requestId: 'req-2'
  })
  assert.strictEqual(doneEvt?.requestId, 'req-2')
  console.log('  ✅ normalizeAgentEvent correctly retains requestId.\n')

  console.log('▶ Test 2: Stream routing isolation between two chats...')
  const router = new StreamRouter()
  router.startRequest('chat-A', 'req-A')
  router.startRequest('chat-B', 'req-B')

  let currentActiveChat = 'chat-B'

  router.routeEvent({ type: 'token', content: 'Hello from Chat A, part 1. ', requestId: 'req-A' }, currentActiveChat)
  router.routeEvent({ type: 'token', content: 'Chat B greeting! ', requestId: 'req-B' }, currentActiveChat)
  router.routeEvent({ type: 'token', content: 'Chat A part 2.', requestId: 'req-A' }, currentActiveChat)

  currentActiveChat = 'chat-A'
  router.routeEvent({ type: 'token', content: 'Chat B details.', requestId: 'req-B' }, currentActiveChat)

  assert.strictEqual(
    router.chatContents.get('chat-A'),
    'Hello from Chat A, part 1. Chat A part 2.',
    'Chat A should receive only Chat A tokens'
  )
  assert.strictEqual(
    router.chatContents.get('chat-B'),
    'Chat B greeting! Chat B details.',
    'Chat B should receive only Chat B tokens'
  )
  console.log('  ✅ No cross-chat token bleeding occurred even when switching activeChatId.\n')

  console.log('▶ Test 3: Cancelling Chat A does not affect Chat B...')
  router.cancelRequest('chat-A')
  assert.strictEqual(router.chatStatus.get('chat-A'), 'cancelled')
  assert.strictEqual(router.chatStatus.get('chat-B'), 'streaming')

  const lateRes = router.routeEvent({ type: 'token', content: 'Zombie token', requestId: 'req-A' }, currentActiveChat)
  assert.strictEqual(lateRes, null, 'Cancelled request events should be dropped safely')

  router.routeEvent({ type: 'done', requestId: 'req-B' }, currentActiveChat)
  assert.strictEqual(router.chatStatus.get('chat-B'), 'idle')
  console.log('  ✅ Cancelling Chat A leaves Chat B streaming until completion.\n')

  console.log('🎉 ALL MULTI-CHAT STREAMING VERIFICATIONS PASSED!')
}

runVerification().catch((err) => {
  console.error('❌ Verification failed:', err)
  process.exit(1)
})
