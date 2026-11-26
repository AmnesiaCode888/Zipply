import { Message } from '../types/chat'
import { checkpointSessionMessages } from './chatStorageService'
import type { CheckpointReceipt } from './chatStorageService'
import { getChatStorageMutationVersion } from './appStorage'

export interface CheckpointableRuntime {
  sessionId: string
  messages: Message[]
  running: boolean
  checkpointTimer: ReturnType<typeof setTimeout> | null
  checkpointVersion?: number
  checkpointInFlight?: boolean
  checkpointPending?: boolean
}

export function checkpointRuntimeMessages<T extends CheckpointableRuntime>(
  runtime: T,
  forceSync: boolean,
  isCurrentRuntime: () => boolean,
  onSaved: (sessionId: string, messages: Message[], receipt: CheckpointReceipt) => void
): void {
  if (runtime.checkpointTimer) clearTimeout(runtime.checkpointTimer)
  runtime.checkpointTimer = null
  if (!forceSync && runtime.checkpointInFlight) {
    runtime.checkpointPending = true
    return
  }
  if (forceSync) runtime.checkpointPending = false

  const version = runtime.checkpointVersion = (runtime.checkpointVersion || 0) + 1
  const messages = runtime.messages
  const saveSync = (): void => {
    const saved = checkpointSessionMessages(runtime.sessionId, runtime.messages)
    onSaved(runtime.sessionId, runtime.messages, saved)
  }

  const storage = window.api?.storage
  const prepare = !forceSync && storage?.prepareCheckpoint
  if (!prepare || !storage?.commitCheckpoint || !storage.discardCheckpoint) {
    saveSync()
    return
  }

  const mutationVersion = getChatStorageMutationVersion()
  const stillCurrent = (): boolean => isCurrentRuntime() && runtime.checkpointVersion === version
  runtime.checkpointInFlight = true

  const complete = (): void => {
    runtime.checkpointInFlight = false
    if (runtime.checkpointPending && runtime.running && isCurrentRuntime()) {
      runtime.checkpointPending = false
      checkpointRuntimeMessages(runtime, false, isCurrentRuntime, onSaved)
    }
  }

  try {
    void prepare(runtime.sessionId, messages).then(
      (result) => {
        try {
          if (result.status !== 'ready' || !result.token) {
            if (stillCurrent()) saveSync()
            return
          }
          if (!stillCurrent()) {
            storage.discardCheckpoint!(result.token)
            return
          }
          if (getChatStorageMutationVersion() !== mutationVersion) {
            storage.discardCheckpoint!(result.token)
            saveSync()
            return
          }
          if (storage.commitCheckpoint!(result.token).status !== 'saved') {
            saveSync()
            return
          }
          onSaved(runtime.sessionId, messages, { asynchronous: true })
        } finally {
          complete()
        }
      },
      () => {
        try {
          if (stillCurrent()) saveSync()
        } finally {
          complete()
        }
      }
    ).catch(() => {
      if (stillCurrent()) saveSync()
    })
  } catch {
    complete()
    saveSync()
  }
}
