import { appStorage } from './appStorage'
import { ChatSession, Message } from '../types/chat'

const SESSIONS_STORAGE_KEY = 'zipply_chat_sessions_v1'
const ACTIVE_CHAT_ID_KEY = 'zipply_active_chat_id_v1'
export type CheckpointReceipt = string | { asynchronous: true } | null
let latestStorageError = ''

export function getStorageError(): string { return latestStorageError }

export function reportStorageError(message: string): void {
  latestStorageError = message
  if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') {
    window.dispatchEvent(new CustomEvent('zipply:storage-error', { detail: message }))
  }
}

function recoverSessions(): { sessions: ChatSession[] | null; failed: boolean } {
  try {
    const backup = window.api?.workspace?.loadSessions?.()
    if (backup?.errors?.length) reportStorageError('Некоторые резервные копии чатов не удалось прочитать. Проверьте файлы данных приложения.')
    if (backup?.sessions?.length) {
      const sessions = backup.sessions.map((s: ChatSession) => ({ ...s, messages: finishInterruptedMessages(s.messages) }))
      if (!backup.errors?.length) saveStoredSessions(sessions)
      return { sessions, failed: Boolean(backup.errors?.length) }
    }
    return { sessions: null, failed: Boolean(backup?.errors?.length) }
  } catch { reportStorageError('Не удалось прочитать резервные копии чатов.') }
  return { sessions: null, failed: true }
}

export const DEFAULT_SESSION_TITLE = 'Новый чат'

export function getDefaultWorkspacePath(sessionId: string): string {
  if (typeof window !== 'undefined' && window.api?.workspace?.defaultDir) {
    return `${window.api.workspace.defaultDir}/${sessionId}`.replace(/\\/g, '/')
  }
  return `workspaces/${sessionId}`
}

export function createNewSession(
  title: string = DEFAULT_SESSION_TITLE,
  folderPath?: string
): ChatSession {
  const now = Date.now()
  const id = `chat-${now}-${Math.random().toString(36).substring(2, 7)}`
  return {
    id,
    title,
    createdAt: now,
    updatedAt: now,
    messages: [],
    folderPath: folderPath || getDefaultWorkspacePath(id)
  }
}

/**
 * Persists a session in application storage, outside the project folder.
 */
export function syncSessionToDisk(session: ChatSession): Promise<boolean> {
  if (typeof window !== 'undefined' && window.api?.workspace?.saveSession) {
    return window.api.workspace.saveSession(session).then((result) => {
      if (result && !result.success) {
        reportStorageError('Не удалось сохранить резервную копию чата. Проверьте свободное место и права доступа.')
        return false
      }
      return true
    }).catch((err) => {
      console.warn('[chatStorageService] Failed to sync session to disk:', err)
      reportStorageError('Не удалось сохранить резервную копию чата. Проверьте свободное место и права доступа.')
      return false
    })
  }
  return Promise.resolve(false)
}

// Write the latest streamed messages without waiting for a React state update.
export function checkpointSessionMessages(sessionId: string, messages: Message[]): string | null {
  try {
    const raw = appStorage.getItem(SESSIONS_STORAGE_KEY)
    const sessions: ChatSession[] = raw ? JSON.parse(raw) : []
    if (!Array.isArray(sessions)) return null
    const index = sessions.findIndex((session) => session.id === sessionId)
    if (index < 0) return null
    const session = { ...sessions[index], messages, updatedAt: Date.now() }
    sessions[index] = session
    const saved = saveSessionsSnapshot(sessions)
    syncSessionToDisk(session)
    return saved
  } catch (error) {
    console.error('Failed to checkpoint chat:', error)
    reportStorageError('Не удалось сохранить промежуточное состояние чата. Экспортируйте важные диалоги.')
    return null
  }
}

export function isCurrentCheckpoint(snapshot: string | null): boolean {
  if (snapshot === null) return false
  try { return appStorage.getItem(SESSIONS_STORAGE_KEY) === snapshot } catch { return false }
}

// Read live checkpoints without treating active streams as interrupted.
export function readStoredSessionsSnapshot(snapshot?: string | null): ChatSession[] {
  try {
    const raw = snapshot === undefined ? appStorage.getItem(SESSIONS_STORAGE_KEY) : snapshot
    const value: unknown = JSON.parse(raw || '[]')
    return Array.isArray(value) ? value.filter((session): session is ChatSession =>
      Boolean(session && typeof session === 'object' && typeof (session as ChatSession).id === 'string' && Array.isArray((session as ChatSession).messages))) : []
  } catch { return [] }
}

// Inspect IDs without performing startup recovery or rewriting streaming messages.
export function getStoredSessionIds(): string[] {
  try {
    const value: unknown = JSON.parse(appStorage.getItem(SESSIONS_STORAGE_KEY) || '[]')
    return Array.isArray(value) ? value.flatMap((session: unknown) =>
      session && typeof session === 'object' && typeof (session as { id?: unknown }).id === 'string'
        ? [(session as { id: string }).id] : []) : []
  } catch { return [] }
}

export function finishInterruptedMessages(messages: Message[]): Message[] {
  const now = Date.now()
  const interruptedAssistant = messages.findLast(message => message.role === 'assistant' && !message.isProgressUpdate)
  const restored = messages.map((message) => {
    if (!message.isStreaming) return message
    return {
      ...message,
      isStreaming: false,
      blocks: (message.blocks || []).map((block) => {
        if (block.type === 'tool') {
          return block.tool.status === 'running' ? { ...block, tool: { ...block.tool, status: 'error' as const } } : block
        }
        if (block.type === 'thinking' && block.isStreaming) {
          const duration = block.startedAt ? Math.max(1, Math.round((now - block.startedAt) / 1000)) : block.durationSec
          return { ...block, isStreaming: false, durationSec: duration }
        }
        return { ...block, isStreaming: false }
      }),
      tools: message.tools?.map((tool) => tool.status === 'running' ? { ...tool, status: 'error' as const } : tool)
    }
  })
  if (interruptedAssistant?.isStreaming) {
    restored.push({
      id: `${interruptedAssistant.id}-interrupted`,
      role: 'assistant',
      blocks: [{
        type: 'text',
        id: `err-${interruptedAssistant.id}-interrupted`,
        content: '⚠️ Предыдущий запуск был прерван.'
      }]
    })
  }
  return restored
}

/**
 * Loads all chat sessions from LocalStorage.
 * If empty or corrupted, initializes and returns a default starter session.
 */
export function loadStoredSessions(): ChatSession[] {
  try {
    const raw = appStorage.getItem(SESSIONS_STORAGE_KEY)
    if (raw) {
      const parsed = JSON.parse(raw)
      if (Array.isArray(parsed) && parsed.length > 0 && parsed.every((s: ChatSession) => s && typeof s.id === 'string' && Array.isArray(s.messages))) {
        let needsResave = false
        const sessions = parsed.map((s: any) => {
          if (!s.folderPath) {
            needsResave = true
            s = { ...s, folderPath: getDefaultWorkspacePath(s.id) }
          }
          if (Array.isArray(s.messages) && s.messages.some((message: Message) => message.isStreaming)) {
            needsResave = true
            return { ...s, messages: finishInterruptedMessages(s.messages) }
          }
          return s
        })
        if (needsResave) {
          saveStoredSessions(sessions)
        }
        return sessions
      }
    }

    const recovered = typeof window !== 'undefined' ? recoverSessions() : null
    if (recovered?.sessions?.length) return recovered.sessions
    if (recovered?.failed) return [createNewSession()]

    const starter = [createNewSession()]
    saveStoredSessions(starter)
    return starter
  } catch (error) {
    console.error('Failed to load chat sessions from LocalStorage:', error)
    const recovered = typeof window !== 'undefined' ? recoverSessions() : null
    if (recovered?.sessions?.length) return recovered.sessions
    return [createNewSession()]
  }
}

/**
 * Saves chat sessions to LocalStorage.
 */
function saveSessionsSnapshot(sessions: ChatSession[]): string | null {
  try {
    const snapshot = JSON.stringify(sessions)
    appStorage.setItem(SESSIONS_STORAGE_KEY, snapshot)
    return snapshot
  } catch (error) {
    console.error('Failed to save chat sessions to LocalStorage:', error)
    reportStorageError('Не удалось сохранить историю чатов. Проверьте свободное место и экспортируйте важные диалоги.')
    return null
  }
}

export function saveStoredSessions(sessions: ChatSession[]): boolean {
  return saveSessionsSnapshot(sessions) !== null
}

/**
 * Loads the active chat session ID from LocalStorage.
 */
export function loadActiveChatId(): string | null {
  try {
    return appStorage.getItem(ACTIVE_CHAT_ID_KEY)
  } catch {
    return null
  }
}

/**
 * Saves the active chat session ID to LocalStorage.
 */
export function saveActiveChatId(id: string): void {
  try {
    appStorage.setItem(ACTIVE_CHAT_ID_KEY, id)
  } catch (error) {
    console.error('Failed to save active chat ID to LocalStorage:', error)
  }
}
