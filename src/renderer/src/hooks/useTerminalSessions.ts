import { useCallback, useEffect, useRef, useState } from 'react'
import type { TerminalEvent, TerminalSessionSummary } from '../../../shared/terminal'

type OutputListener = (terminalId: string, chunk: string, cursor: number) => void
type SessionEvent = Exclude<TerminalEvent, { type: 'session_output' }>

function applySessionEvent(sessions: TerminalSessionSummary[], event: SessionEvent): TerminalSessionSummary[] {
  if (event.type === 'session_created') {
    return sessions.some(session => session.id === event.session.id) ? sessions : [...sessions, event.session]
  }
  if (event.type === 'session_closed') return sessions.filter(session => session.id !== event.terminalId)
  const { status, exitCode, signal, endedAt, background } = event
  return sessions.map(session => session.id === event.terminalId
    ? { ...session, status, exitCode, signal, endedAt, background: background ?? session.background }
    : session)
}

export function useTerminalSessions(sessionId?: string, folderPath?: string) {
  const [sessions, setSessions] = useState<TerminalSessionSummary[]>([])
  const [loading, setLoading] = useState(Boolean(sessionId))
  const [listError, setListError] = useState('')
  const outputListeners = useRef(new Set<OutputListener>())
  const subscribeOutput = useCallback((listener: OutputListener) => {
    outputListeners.current.add(listener)
    return () => { outputListeners.current.delete(listener) }
  }, [])

  useEffect(() => {
    const api = typeof window !== 'undefined' ? window.api?.terminal : undefined
    if (!api || !sessionId) {
      setLoading(false)
      return
    }
    let cancelled = false
    let pending: SessionEvent[] | undefined = []
    const workspaceKey = (workspace: string) => api && window.api.platform === 'win32'
      ? workspace.replace(/\\/g, '/').replace(/\/$/, '').toLowerCase()
      : workspace.replace(/\/$/, '')
    const unsubscribe = api.onEvent(({ sessionId: eventSessionId, workspace, event }) => {
      if (eventSessionId !== sessionId || (folderPath && workspaceKey(folderPath) !== workspaceKey(workspace))) return
      if (event.type === 'session_output') {
        for (const listener of outputListeners.current) listener(event.terminalId, event.chunk, event.cursor)
      } else if (pending) {
        pending.push(event)
      } else {
        setSessions(current => applySessionEvent(current, event))
      }
    })

    const initialize = (list: TerminalSessionSummary[]) => {
      if (cancelled) return
      const next = pending?.reduce(applySessionEvent, list) ?? list
      pending = undefined
      setSessions(next)
      setLoading(false)
    }
    void api.list(sessionId, folderPath).then(initialize, () => {
      if (cancelled) return
      setListError('Не удалось загрузить терминалы.')
      initialize([])
    })
    return () => {
      cancelled = true
      unsubscribe()
    }
  }, [sessionId, folderPath])

  const attachSession = useCallback(async (terminalId: string) => {
    if (!sessionId) return undefined
    return await window.api?.terminal?.attach(sessionId, terminalId, folderPath)
  }, [sessionId, folderPath])

  const loadAiLog = useCallback(async () => {
    if (!sessionId) return ''
    return await window.api?.terminal?.getAiLog?.(sessionId) ?? ''
  }, [sessionId])

  const writeToSession = useCallback((terminalId: string, chars: string) => {
    if (sessionId) window.api?.terminal?.write(sessionId, terminalId, chars, folderPath)
  }, [sessionId, folderPath])

  const resizeSession = useCallback((terminalId: string, cols: number, rows: number) => {
    if (sessionId) window.api?.terminal?.resize(sessionId, terminalId, cols, rows, folderPath)
  }, [sessionId, folderPath])

  const sendSignal = useCallback(async (terminalId: string, signal: 'SIGINT' | 'SIGKILL') => {
    if (sessionId) await window.api?.terminal?.signal(sessionId, terminalId, signal, folderPath)
  }, [sessionId, folderPath])

  return { sessions, loading, listError, subscribeOutput, attachSession, loadAiLog, writeToSession, resizeSession, sendSignal }
}
