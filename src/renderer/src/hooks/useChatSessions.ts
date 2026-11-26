import { useState, useCallback, useEffect, useRef } from 'react'
import { ChatSession, Message } from '../types/chat'
import { chooseChatTitle } from '../../../shared/chatTitle'
import {
  loadStoredSessions,
  saveStoredSessions,
  loadActiveChatId,
  saveActiveChatId,
  createNewSession,
  syncSessionToDisk,
  isCurrentCheckpoint,
  readStoredSessionsSnapshot,
  getStoredSessionIds,
  finishInterruptedMessages,
  reportStorageError
} from '../services/chatStorageService'
import type { CheckpointReceipt } from '../services/chatStorageService'

function deleteBackup(id: string): void {
  const operation = window.api?.workspace?.deleteSession(id)
  operation?.then((result) => {
    if (!result.success) reportStorageError('Не удалось удалить резервную копию чата. Она может восстановиться при повреждении истории.')
  }).catch(() => reportStorageError('Не удалось удалить резервную копию чата. Она может восстановиться при повреждении истории.'))
}

function mergeStoredMessages(sessions: ChatSession[], unsaved: Set<string>): ChatSession[] {
  const stored = new Map(readStoredSessionsSnapshot().map(session => [session.id, session.messages]))
  return sessions.map(session => !unsaved.has(session.id) && stored.has(session.id) ? { ...session, messages: stored.get(session.id)! } : session)
}

function needsDefaultWorkspace(session: ChatSession): boolean {
  return !session.folderPath || session.folderPath.replace(/\\/g, '/').replace(/\/$/, '').endsWith(`/${session.id}`)
}

export function useChatSessions() {
  const historyGenerationRef = useRef(0)
  const unsavedMessagesRef = useRef(new Set<string>())
  const copiedStartupSessionsRef = useRef(false)
  const [sessions, setSessions] = useState<ChatSession[]>(() => loadStoredSessions())
  const [activeChatId, setActiveChatId] = useState<string>(() => {
    const savedId = loadActiveChatId()
    const loadedSessions = loadStoredSessions()
    if (savedId && loadedSessions.some((s) => s.id === savedId)) {
      return savedId
    }
    return loadedSessions[0]?.id || ''
  })
  const [workspaceRevision, setWorkspaceRevision] = useState(0)
  const workspaceChecksRef = useRef(new Map<string, { generation: number; requestedPath: string | undefined; promise: Promise<{ id: string; requestedPath: string | undefined; folderPath: string } | null> }>())
  const persistSessions = (value: ChatSession[]): boolean => {
    const saved = saveStoredSessions(value)
    if (saved) {
      for (const session of value) {
        if (unsavedMessagesRef.current.has(session.id)) void syncSessionToDisk(session)
      }
      unsavedMessagesRef.current.clear()
    }
    return saved
  }

  // Copy existing local chats to application storage; leave legacy project files untouched.
  useEffect(() => {
    if (copiedStartupSessionsRef.current) return
    copiedStartupSessionsRef.current = true
    for (const session of loadStoredSessions()) {
      syncSessionToDisk(session)
      // Default workspaces are checked by the effect below; custom folders
      // still need the existing startup migration/creation behavior.
      if (session.folderPath && !needsDefaultWorkspace(session)) void window.api?.workspace?.create(session.id, session.title, session.folderPath)
    }
  }, [])

  // Ensure the default workspace directory exists for every chat. Sessions
  // created by createNewSession already carry their default folderPath, so
  // checking only for a missing path leaves new chat workspaces uncreated.
  useEffect(() => {
    if (typeof window === 'undefined' || !window.api?.workspace?.create) {
      return
    }

    const sessionsToEnsure = sessions.filter(needsDefaultWorkspace)
    const generation = historyGenerationRef.current
    const currentIds = new Set(sessionsToEnsure.map(session => session.id))
    for (const [id, check] of workspaceChecksRef.current) {
      if (check.generation !== generation || !currentIds.has(id)) workspaceChecksRef.current.delete(id)
    }
    if (sessionsToEnsure.length === 0) return

    let isMounted = true
    Promise.all(
      sessionsToEnsure.map((s) => {
        const existing = workspaceChecksRef.current.get(s.id)
        if (existing?.generation === generation && existing.requestedPath === s.folderPath) return existing.promise
        const promise = (async () => {
          try {
            const res = await window.api.workspace.create(s.id, s.title, s.folderPath)
            if (res?.success && res.folderPath) return { id: s.id, requestedPath: s.folderPath, folderPath: res.folderPath }
          } catch (err) {
            console.warn('[useChatSessions] Failed to create folder for session:', err)
          }
          return null
        })()
        workspaceChecksRef.current.set(s.id, { generation, requestedPath: s.folderPath, promise })
        void promise.then(result => {
          if (!result && workspaceChecksRef.current.get(s.id)?.promise === promise) workspaceChecksRef.current.delete(s.id)
        })
        return promise
      })
    ).then((results) => {
      if (!isMounted || generation !== historyGenerationRef.current) return
      const valid = results.filter((result): result is NonNullable<typeof result> => !!result && result.requestedPath !== result.folderPath)
      if (valid.length > 0) {
        setSessions((prev) => {
          if (generation !== historyGenerationRef.current) return prev
          const map = new Map(valid.map((v) => [v.id, v]))
          const changed = (s: ChatSession): boolean => {
            const result = map.get(s.id)
            return !!result && s.folderPath === result.requestedPath && s.folderPath !== result.folderPath
          }
          if (!prev.some(changed)) return prev
          const updated = mergeStoredMessages(prev, unsavedMessagesRef.current).map((s) => changed(s) ? { ...s, folderPath: map.get(s.id)!.folderPath } : s)
          persistSessions(updated)
          return updated
        })
      }
    })

    return () => {
      isMounted = false
    }
  // Chat message/title changes replace the sessions array frequently. Workspace
  // checks only need to run when the set of sessions is intentionally changed.
  // The workspace creation callbacks below cover new/default workspaces, while
  // this revision covers startup, clear, and import.
  }, [workspaceRevision])

  // Sync activeChatId to storage whenever it changes
  useEffect(() => {
    if (activeChatId) {
      saveActiveChatId(activeChatId)
    }
  }, [activeChatId])

  // Get current active session
  const activeSession = sessions.find((s) => s.id === activeChatId) || sessions[0]

  const createChat = useCallback((title?: string, customPath?: string, select = true): string => {
    const newSession = createNewSession(title, customPath)
    const generation = historyGenerationRef.current
    setSessions((prev) => {
      if (generation !== historyGenerationRef.current) return prev
      const updated = [newSession, ...mergeStoredMessages(prev, unsavedMessagesRef.current)]
      persistSessions(updated)
      return updated
    })
    if (needsDefaultWorkspace(newSession)) setWorkspaceRevision((revision) => revision + 1)
    if (select) setActiveChatId(newSession.id)

    // Asynchronously create folder on disk and ensure session.json
    if (typeof window !== 'undefined' && window.api?.workspace?.create && !needsDefaultWorkspace(newSession)) {
      window.api.workspace
        .create(newSession.id, newSession.title, customPath)
        .then((res) => {
          if (res?.success && res.folderPath) {
            setSessions((prev) => {
              if (generation !== historyGenerationRef.current) return prev
              if (!prev.some(s => s.id === newSession.id && s.folderPath === newSession.folderPath && s.folderPath !== res.folderPath)) return prev
              const updated = mergeStoredMessages(prev, unsavedMessagesRef.current).map((s) =>
                s.id === newSession.id && s.folderPath === newSession.folderPath ? { ...s, folderPath: res.folderPath } : s
              )
              persistSessions(updated)
              return updated
            })
          }
        })
        .catch((err) => {
          console.warn('[useChatSessions] Failed to create workspace directory:', err)
        })
    }

    return newSession.id
  }, [])

  const commitDraftChat = useCallback((session: ChatSession) => {
    const generation = historyGenerationRef.current
    setActiveChatId(session.id)
    const stored = readStoredSessionsSnapshot()
    if (!stored.some(item => item.id === session.id)) saveStoredSessions([session, ...stored])
    setSessions((prev) => {
      if (generation !== historyGenerationRef.current || prev.some(item => item.id === session.id)) return prev
      const updated = [session, ...mergeStoredMessages(prev, unsavedMessagesRef.current)]
      persistSessions(updated)
      return updated
    })
    if (needsDefaultWorkspace(session)) setWorkspaceRevision((revision) => revision + 1)
    if (needsDefaultWorkspace(session)) return
    void window.api?.workspace?.create(session.id, session.title, session.folderPath).then(result => {
      if (!result?.success || !result.folderPath) return
      setSessions(prev => {
        if (generation !== historyGenerationRef.current || !prev.some(item => item.id === session.id && item.folderPath === session.folderPath && item.folderPath !== result.folderPath)) return prev
        const updated = mergeStoredMessages(prev, unsavedMessagesRef.current).map(item => item.id === session.id && item.folderPath === session.folderPath ? { ...item, folderPath: result.folderPath } : item)
        persistSessions(updated)
        return updated
      })
    }).catch(error => console.warn('[useChatSessions] Failed to create workspace directory:', error))
  }, [])

  const selectChat = useCallback((id: string) => {
    setActiveChatId(id)
  }, [])

  const enableUncensoredMode = useCallback((sessionId: string): void => {
    const generation = historyGenerationRef.current
    setSessions((prev) => {
      if (generation !== historyGenerationRef.current || !prev.some(session => session.id === sessionId && session.uncensoredMode !== true)) return prev
      const updated = mergeStoredMessages(prev, unsavedMessagesRef.current).map((session) => {
        if (session.id !== sessionId) return session
        const updatedSession = { ...session, uncensoredMode: true }
        void syncSessionToDisk(updatedSession)
        return updatedSession
      })
      persistSessions(updated)
      return updated
    })
  }, [])

  const renameChat = useCallback((id: string, newTitle: string) => {
    const trimmed = newTitle.trim()
    if (!trimmed) return

    const generation = historyGenerationRef.current
    setSessions((prev) => {
      if (generation !== historyGenerationRef.current) return prev
      const updated = mergeStoredMessages(prev, unsavedMessagesRef.current).map((session) => {
        if (session.id !== id) return session
        const updatedSession = { ...session, title: trimmed, updatedAt: Date.now() }
        syncSessionToDisk(updatedSession)
        return updatedSession
      })
      persistSessions(updated)
      return updated
    })
  }, [])

  const changeChatFolder = useCallback((sessionId: string, newFolderPath: string) => {
    if (!newFolderPath) return
    const generation = historyGenerationRef.current
    setSessions((prev) => {
      if (generation !== historyGenerationRef.current) return prev
      const updated = mergeStoredMessages(prev, unsavedMessagesRef.current).map((s) => {
        if (s.id !== sessionId) return s
        const updatedSession = { ...s, folderPath: newFolderPath, updatedAt: Date.now() }
        syncSessionToDisk(updatedSession)
        return updatedSession
      })
      persistSessions(updated)
      return updated
    })
  }, [])

  const selectAndSetChatFolder = useCallback(
    async (sessionId: string): Promise<string | null> => {
      if (typeof window === 'undefined' || !window.api?.workspace?.selectFolder) {
        return null
      }
      try {
        const picked = await window.api.workspace.selectFolder()
        if (picked) {
          changeChatFolder(sessionId, picked)
          return picked
        }
      } catch (err) {
        console.error('[useChatSessions] Error selecting folder:', err)
      }
      return null
    },
    [changeChatFolder]
  )

  const openChatFolder = useCallback(async (folderPath?: string): Promise<void> => {
    if (!folderPath || typeof window === 'undefined' || !window.api?.workspace?.openFolder) {
      return
    }
    try {
      await window.api.workspace.openFolder(folderPath)
    } catch (err) {
      console.error('[useChatSessions] Error opening folder in explorer:', err)
    }
  }, [])

  const deleteChat = useCallback((id: string, onDeleted?: () => void) => {
    const generation = historyGenerationRef.current
    setSessions((prev) => {
      if (generation !== historyGenerationRef.current) return prev
      const updated = mergeStoredMessages(prev, unsavedMessagesRef.current).filter((s) => s.id !== id)
      // If no sessions left, create a fresh starter one
      const finalSessions = updated.length > 0 ? updated : [createNewSession()]
      if (!persistSessions(finalSessions)) return prev
      onDeleted?.()
      deleteBackup(id)

      // If deleted active session, fallback to the first available
      setActiveChatId((currentActive) => {
        if (currentActive === id) {
          return finalSessions[0].id
        }
        return currentActive
      })

      return finalSessions
    })
    setWorkspaceRevision((revision) => revision + 1)
  }, [])

  const updateSessionMessages = useCallback(
    (sessionId: string, newMessages: Message[], autoTitle?: string, checkpoint: CheckpointReceipt = null, expectedTitle?: string) => {
      const generation = historyGenerationRef.current
      if (checkpoint && typeof checkpoint !== 'string') {
        unsavedMessagesRef.current.delete(sessionId)
        if (unsavedMessagesRef.current.size === 0) {
          setSessions(prev => generation !== historyGenerationRef.current ? prev : prev.map(session => session.id === sessionId
            ? { ...session, title: chooseChatTitle(session.title, autoTitle, expectedTitle), messages: newMessages, updatedAt: Date.now() }
            : session))
          return
        }
        checkpoint = null
      }
      if (checkpoint) unsavedMessagesRef.current.delete(sessionId)
      setSessions((prev) => {
        if (generation !== historyGenerationRef.current) return prev
        const alreadyPersisted = isCurrentCheckpoint(checkpoint)
        const storedSession = readStoredSessionsSnapshot().find(session => session.id === sessionId)
        const checkpointSession = checkpoint ? readStoredSessionsSnapshot(checkpoint).find(session => session.id === sessionId) : undefined
        const latestMessages = storedSession && checkpointSession && JSON.stringify(storedSession.messages) !== JSON.stringify(checkpointSession.messages)
          ? storedSession.messages : newMessages
        const updated = mergeStoredMessages(prev, unsavedMessagesRef.current).map((session) => {
          if (session.id !== sessionId) return session
          const updatedSession = {
            ...session,
            title: chooseChatTitle(session.title, autoTitle, expectedTitle),
            messages: latestMessages,
            updatedAt: Date.now()
          }
          if (!alreadyPersisted) syncSessionToDisk(updatedSession)
          return updatedSession
        })
        if ((!alreadyPersisted || unsavedMessagesRef.current.size > 0) && !persistSessions(updated)) unsavedMessagesRef.current.add(sessionId)
        return updated
      })
    },
    []
  )

  const clearAllChats = useCallback((): boolean => {
    const oldIds = getStoredSessionIds()
    const fresh = createNewSession()
    const updated = [fresh]
    if (!saveStoredSessions(updated)) return false
    unsavedMessagesRef.current.clear()
    historyGenerationRef.current++
    for (const id of oldIds) deleteBackup(id)
    setSessions(updated)
    setActiveChatId(fresh.id)
    setWorkspaceRevision((revision) => revision + 1)
    return true
  }, [])

  const importSessions = useCallback((newSessions: ChatSession[]): boolean => {
    if (!newSessions || newSessions.length === 0) return false
    const oldIds = getStoredSessionIds()
    const importedSessions = newSessions.map((session) => ({ ...session, messages: finishInterruptedMessages(session.messages) }))
    if (!saveStoredSessions(importedSessions)) return false
    unsavedMessagesRef.current.clear()
    historyGenerationRef.current++
    const generation = historyGenerationRef.current
    void Promise.all(importedSessions.map(syncSessionToDisk)).then((saved) => {
      if (generation !== historyGenerationRef.current || !saved.every(Boolean)) return
      for (const id of oldIds) {
        if (!importedSessions.some((imported) => imported.id === id)) deleteBackup(id)
      }
    })
    setSessions(importedSessions)
    setActiveChatId(importedSessions[0].id)
    setWorkspaceRevision((revision) => revision + 1)
    return true
  }, [])

  return {
    sessions,
    activeChatId,
    activeSession,
    createChat,
    commitDraftChat,
    selectChat,
    enableUncensoredMode,
    renameChat,
    changeChatFolder,
    selectAndSetChatFolder,
    openChatFolder,
    deleteChat,
    updateSessionMessages,
    clearAllChats,
    importSessions
  }
}
