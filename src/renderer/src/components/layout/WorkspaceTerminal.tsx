import React, { useCallback, useEffect, useRef, useState } from 'react'
import { ChevronDown, History, Layers, RefreshCw, Square, Terminal } from '../../icons'
import { useTerminalSessions } from '../../hooks/useTerminalSessions'
import { loadSettings } from '../../services/settingsService'
import { isTerminalLive, type TerminalSessionSnapshot, type TerminalSessionSummary } from '../../../../shared/terminal'
import { TerminalConsole } from './TerminalConsole'

interface WorkspaceTerminalProps {
  mode: 'user' | 'ai'
  tabId: string
  sessionId?: string
  folderPath?: string
  selection?: AiTerminalSelection
  onSelect?: (selection: AiTerminalSelection) => void
}

type TerminalApi = ReturnType<typeof useTerminalSessions>
type TerminalSection = 'commands' | 'background' | 'history'
export interface AiTerminalSelection {
  section?: TerminalSection
  terminalId?: string
}
const sections = [
  { id: 'commands', label: 'Команды', icon: Terminal },
  { id: 'background', label: 'Фоновые задачи', icon: Layers },
  { id: 'history', label: 'История', icon: History }
] as const

const actionClass = 'inline-flex h-8 shrink-0 items-center justify-center gap-1.5 rounded-full bg-control px-3 text-[13px] font-medium text-primary hover:bg-control-hover active:scale-95 disabled:opacity-50 border-none shadow-none'

function statusLabel(session: TerminalSessionSummary): string {
  if (session.status === 'starting') return 'Запуск'
  if (session.status === 'running') return 'Работает'
  if (session.status === 'stopped') return 'Остановлена'
  if (session.status === 'failed') return 'Ошибка запуска'
  if (session.exitCode === 0) return 'Завершена'
  return session.exitCode === null ? 'Прервана' : `Код ${session.exitCode}`
}

function TerminalEmpty({ children }: { children: string }) {
  return <div className="flex min-h-0 flex-1 items-center justify-center rounded-[20px] bg-canvas p-5 text-center text-[14px] leading-[21px] text-secondary">{children}</div>
}

function AgentTerminal({ api, selection, onSelect }: { api: TerminalApi; selection?: AiTerminalSelection; onSelect?: (selection: AiTerminalSelection) => void }) {
  const selectedId = selection?.terminalId
  const [stopState, setStopState] = useState<{ id: string; error?: string }>()
  const [refreshVersion, setRefreshVersion] = useState(0)
  const lastForeground = useRef<string>()
  const commands = api.sessions.filter(session => session.origin === 'ai' && !session.background).reverse()
  const background = api.sessions.filter(session => session.origin === 'ai' && session.background).reverse()
  const activeBackground = background.filter(session => isTerminalLive(session.status)).length
  const promoted = !selectedId && (!selection?.section || selection.section === 'commands')
    ? background.find(session => session.id === lastForeground.current)
    : undefined
  const selected = commands.find(session => session.id === selectedId) ?? background.find(session => session.id === selectedId) ?? promoted
  const lookupMissing = Boolean(selectedId && !selected && !api.loading)
  const defaultSection = commands.length || !background.length ? 'commands' : 'background'
  const section = selected ? (selected.background ? 'background' : 'commands')
    : selection?.section ?? (lookupMissing ? 'history' : defaultSection)
  const currentList = section === 'background' ? background : commands
  const current = section === 'history' ? undefined : selected ?? currentList.find(session => isTerminalLive(session.status)) ?? currentList[0]
  const stopping = current && stopState?.id === current.id ? stopState : undefined

  useEffect(() => {
    lastForeground.current = current && !current.background ? current.id : undefined
    if (promoted) onSelect?.({ terminalId: promoted.id })
  }, [current, promoted, onSelect])

  const stop = async (id: string) => {
    setStopState({ id })
    try {
      await api.sendSignal(id, 'SIGKILL')
      setStopState(previous => previous?.id === id ? undefined : previous)
    } catch {
      setStopState(previous => previous?.id === id ? { id, error: 'Не удалось остановить команду. Попробуйте ещё раз.' } : previous)
    }
  }

  return (
    <>
      <div role="group" aria-label="Разделы терминала" className="mb-2 flex w-fit max-w-full flex-wrap items-center gap-1 rounded-[20px] bg-surface-secondary p-1">
        {sections.map(({ id, label, icon: Icon }) => (
          <button key={id} type="button" aria-pressed={id === section}
            onClick={() => onSelect?.({ section: id })}
            className={`inline-flex h-8 items-center gap-1.5 rounded-full px-2.5 text-[13px] font-medium border-none shadow-none hover:bg-control-hover ${id === section ? 'bg-control text-primary' : 'text-secondary'}`}>
            <Icon size={14} aria-hidden="true" />
            {label}
            {id === 'background' && activeBackground > 0 && <span aria-label={`Активных задач: ${activeBackground}`} className="min-w-[18px] rounded-full bg-hover-strong px-1 text-center text-[11px] tabular-nums text-primary">{activeBackground}</span>}
          </button>
        ))}
      </div>
      {section === 'history' ? (
        <>
          <div className="mb-2 flex min-w-0 items-center justify-between gap-2">
            <p className="px-1 text-[13px] text-secondary">{lookupMissing ? 'Сессия больше недоступна. Открыт общий журнал чата.' : 'Журнал команд этого чата'}</p>
            <button type="button" className={actionClass} onClick={() => setRefreshVersion(version => version + 1)}>
              <RefreshCw size={13} aria-hidden="true" />Обновить
            </button>
          </div>
          <TerminalConsole {...api} refreshVersion={refreshVersion} />
        </>
      ) : current ? (
        <>
          <div className="mb-2 flex min-w-0 flex-wrap items-center gap-2">
            <div className="relative min-w-[110px] flex-1">
              <select aria-label={section === 'background' ? 'Выбрать фоновую задачу' : 'Выбрать команду'} title={current.command} value={current.id}
                onChange={event => onSelect?.({ terminalId: event.target.value })}
                className="h-9 w-full min-w-0 appearance-none truncate rounded-full bg-control pl-3 pr-8 text-[14px] font-medium text-primary outline-none border-none shadow-none cursor-pointer focus-visible:underline underline-offset-4">
                {currentList.map(session => <option key={session.id} value={session.id}>{session.title} · {statusLabel(session)}</option>)}
              </select>
              <ChevronDown size={14} aria-hidden="true" className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-secondary" />
            </div>
            {isTerminalLive(current.status) && (
              <button type="button" className={actionClass} onClick={() => void stop(current.id)} disabled={Boolean(stopping && !stopping.error)}>
                <Square size={12} aria-hidden="true" />Остановить
              </button>
            )}
          </div>
          {stopping?.error && <p role="alert" className="mb-2 px-1 text-[13px] text-secondary">{stopping.error}</p>}
          <TerminalConsole {...api} terminalId={current.id} />
        </>
      ) : (
        <TerminalEmpty>{api.loading ? 'Загрузка терминалов…' : api.listError || (section === 'background' ? 'В этом чате пока нет фоновых задач.' : 'Здесь появятся команды, которые запускает Zipply.')}</TerminalEmpty>
      )}
    </>
  )
}

interface UserShell {
  tabId: string
  sessionId: string
  folderPath?: string
  creation: Promise<TerminalSessionSnapshot>
}

const userShells = new Map<string, UserShell>()

function releaseUserShell(key: string, shell: UserShell): void {
  userShells.delete(key)
  void shell.creation.then(snapshot => window.api?.terminal?.close(shell.sessionId, snapshot.id, shell.folderPath)).catch(() => {})
}

export function closeWorkspaceTerminalTab(tabId: string): void {
  for (const [key, shell] of userShells) {
    if (shell.tabId === tabId) releaseUserShell(key, shell)
  }
}

function UserTerminal({ api, tabId, sessionId, folderPath }: { api: TerminalApi; tabId: string; sessionId: string; folderPath?: string }) {
  const [terminalId, setTerminalId] = useState<string>()
  const [error, setError] = useState('')
  const [launchVersion, setLaunchVersion] = useState(0)
  const key = JSON.stringify([tabId, sessionId, folderPath])
  const restart = useCallback(() => {
    const shell = userShells.get(key)
    if (shell) releaseUserShell(key, shell)
    setTerminalId(undefined)
    setError('')
    setLaunchVersion(version => version + 1)
  }, [key])

  useEffect(() => {
    const terminals = window.api?.terminal
    if (!terminals) { setError('Терминал недоступен.'); return }
    let cancelled = false
    let shell = userShells.get(key)
    if (!shell) {
      const creation = terminals.create(sessionId, folderPath, 100, 28, loadSettings().terminalShell)
      shell = { tabId, sessionId, folderPath, creation }
      userShells.set(key, shell)
    }
    const { creation } = shell
    void creation.then(snapshot => {
      if (!cancelled) setTerminalId(snapshot.id)
    }, () => {
      if (userShells.get(key)?.creation === creation) userShells.delete(key)
      if (!cancelled) setError('Не удалось запустить терминал.')
    })
    return () => { cancelled = true }
  }, [key, tabId, sessionId, folderPath, launchVersion])

  const session = api.sessions.find(item => item.id === terminalId)
  const isEnded = terminalId && !api.loading && (!session || !isTerminalLive(session.status))
  return (
    <>
      <div className="mb-2 flex min-w-0 items-center justify-between gap-2 px-1">
        <p className="truncate text-[14px] text-secondary">{session ? `${session.shell} · ${statusLabel(session)}` : 'Личный терминал'}</p>
        {(isEnded || error) && <button type="button" className={actionClass} onClick={restart}><RefreshCw size={13} aria-hidden="true" />Перезапустить</button>}
      </div>
      {terminalId ? <TerminalConsole {...api} terminalId={terminalId} interactive />
        : <TerminalEmpty>{error || 'Запуск терминала…'}</TerminalEmpty>}
    </>
  )
}

export const WorkspaceTerminal = React.memo(function WorkspaceTerminal(props: WorkspaceTerminalProps) {
  const api = useTerminalSessions(props.sessionId, props.folderPath)
  return (
    <div className="m-2 mt-0 flex min-h-0 min-w-0 flex-1 flex-col rounded-[20px] border-none shadow-none">
      {!props.sessionId ? <TerminalEmpty>Выберите чат, чтобы открыть терминал.</TerminalEmpty>
        : props.mode === 'ai' ? <AgentTerminal api={api} selection={props.selection} onSelect={props.onSelect} />
          : <UserTerminal api={api} tabId={props.tabId} sessionId={props.sessionId} folderPath={props.folderPath} />}
    </div>
  )
})
