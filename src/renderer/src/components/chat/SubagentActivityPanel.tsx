import React from 'react'
import { Bot, Pause, Play, StopCircle } from 'lucide-react'
import type { SubagentSnapshot, SubagentStatus } from '../../../../shared/subagents'

interface SubagentActivityPanelProps {
  sessionId?: string
  onActiveCountChange?: (count: number) => void
}

const STATUS_LABEL: Record<SubagentStatus, string> = {
  queued: 'в очереди',
  running: 'работает',
  stopping: 'останавливается',
  interrupted: 'приостановлен',
  completed: 'готово',
  failed: 'ошибка',
  cancelled: 'остановлен'
}

const ROLE_LABEL: Record<SubagentSnapshot['role'], string> = {
  explorer: 'Исследователь',
  reviewer: 'Ревьюер',
  worker: 'Исполнитель'
}

function mergeSnapshots(current: SubagentSnapshot[], incoming: SubagentSnapshot[]): SubagentSnapshot[] {
  const byId = new Map(current.map(item => [item.id, item]))
  for (const item of incoming) {
    const old = byId.get(item.id)
    if (!old || item.updatedAt >= old.updatedAt) byId.set(item.id, item)
  }
  return [...byId.values()].sort((a, b) => b.updatedAt - a.updatedAt)
}

export const SubagentActivityPanel: React.FC<SubagentActivityPanelProps> = ({ sessionId, onActiveCountChange }) => {
  const [items, setItems] = React.useState<SubagentSnapshot[]>([])
  const [busyIds, setBusyIds] = React.useState<Set<string>>(() => new Set())
  const [selectedId, setSelectedId] = React.useState<string | null>(null)

  React.useEffect(() => {
    setItems([])
    setSelectedId(null)
    if (!sessionId || !window.api?.agent?.listSubagents) return
    let current = true
    void window.api.agent.listSubagents(sessionId)
      .then(result => { if (current) setItems(previous => mergeSnapshots(previous, result)) })
      .catch(() => {})
    const unsubscribe = window.api.agent.onSubagentEvent?.(event => {
      if (current && event.subagent.sessionId === sessionId) {
        setItems(previous => mergeSnapshots(previous, [event.subagent]))
      }
    })
    return () => {
      current = false
      unsubscribe?.()
    }
  }, [sessionId])

  const activeCount = items.filter(item => ['queued', 'running', 'stopping'].includes(item.status)).length
  React.useEffect(() => { onActiveCountChange?.(activeCount) }, [activeCount, onActiveCountChange])

  const control = React.useCallback(async (item: SubagentSnapshot, action: 'stop' | 'interrupt' | 'resume') => {
    if (!sessionId || !window.api?.agent?.controlSubagent) return
    setBusyIds(previous => new Set(previous).add(item.id))
    try {
      const updated = await window.api.agent.controlSubagent(sessionId, item.id, action)
      setItems(previous => mergeSnapshots(previous, [updated]))
    } catch {
      // The stream event or a later list refresh remains the source of truth.
    } finally {
      setBusyIds(previous => {
        const next = new Set(previous)
        next.delete(item.id)
        return next
      })
    }
  }, [sessionId])

  const selected = items.find(item => item.id === selectedId)
  const activeItems = items.filter(item => ['queued', 'running', 'stopping'].includes(item.status))
  const recentItems = items.filter(item => !['queued', 'running', 'stopping'].includes(item.status))
  const visibleItems = [...activeItems, ...recentItems]

  const controls = (item: SubagentSnapshot): React.ReactElement => {
    const busy = busyIds.has(item.id)
    const canStop = ['queued', 'running', 'stopping', 'interrupted'].includes(item.status)
    return <div className="flex shrink-0 items-center gap-1">
      {item.status === 'running' && <button type="button" disabled={busy} onClick={() => void control(item, 'interrupt')} aria-label={`Приостановить: ${item.task}`} title="Приостановить" className="flex h-8 w-8 items-center justify-center rounded-full bg-control text-secondary hover:bg-hover disabled:opacity-40 active:scale-95 border-none shadow-none focus-visible:outline-none cursor-pointer"><Pause size={15} /></button>}
      {item.status === 'interrupted' && <button type="button" disabled={busy} onClick={() => void control(item, 'resume')} aria-label={`Продолжить: ${item.task}`} title="Продолжить" className="flex h-8 w-8 items-center justify-center rounded-full bg-control text-secondary hover:bg-hover disabled:opacity-40 active:scale-95 border-none shadow-none focus-visible:outline-none cursor-pointer"><Play size={15} /></button>}
      {canStop && <button type="button" disabled={busy} onClick={() => void control(item, 'stop')} aria-label={`Остановить: ${item.task}`} title="Остановить" className="flex h-8 w-8 items-center justify-center rounded-full bg-control text-secondary hover:bg-hover disabled:opacity-40 active:scale-95 border-none shadow-none focus-visible:outline-none cursor-pointer"><StopCircle size={15} /></button>}
    </div>
  }

  if (!sessionId || visibleItems.length === 0) return <div className="m-auto flex max-w-[320px] flex-col items-center px-6 text-center">
    <span className="mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-surface text-secondary"><Bot size={19} strokeWidth={1.7} /></span>
    <p className="text-[16px] font-medium leading-[23px] text-primary">Субагентов пока нет</p>
    <p className="mt-1.5 text-[14px] leading-[20px] text-secondary">Активные и недавние запуски появятся здесь.</p>
  </div>

  if (selected) return <div className="flex min-h-0 min-w-0 flex-1 flex-col bg-canvas">
    <div className="shrink-0 px-5 pb-4 pt-5">
      <button type="button" onClick={() => setSelectedId(null)} className="mb-3 inline-flex h-9 items-center gap-2 rounded-full px-3 text-[14px] font-medium text-secondary hover:bg-hover hover:text-primary border-none shadow-none focus-visible:outline-none cursor-pointer">← К списку</button>
      <div className="flex items-center gap-2.5">
        <span className="flex h-8 w-8 items-center justify-center rounded-full bg-surface text-secondary"><span className="text-[14px] font-semibold">{ROLE_LABEL[selected.role].slice(0, 1)}</span></span>
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-[17px] font-semibold leading-[23px] text-primary">{ROLE_LABEL[selected.role]}</h2>
          <p className="text-[13px] leading-[19px] text-secondary">{STATUS_LABEL[selected.status]}</p>
        </div>
        {controls(selected)}
      </div>
      <p className="mt-3 text-[15px] leading-[22px] text-primary">{selected.task}</p>
    </div>
    <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-5 no-scrollbar">
      {selected.activity && <section className="mb-3 rounded-[16px] bg-surface-secondary p-4"><h3 className="mb-1 text-[12.5px] font-semibold uppercase tracking-wide text-secondary">Текущая активность</h3><p className="text-[15px] leading-[22px] text-primary">{selected.activity}</p></section>}
      {selected.error && <section className="mb-3 rounded-[16px] bg-surface-secondary p-4"><h3 className="mb-1 text-[12.5px] font-semibold uppercase tracking-wide text-secondary">Ошибка</h3><p className="whitespace-pre-wrap text-[14px] leading-[21px] text-primary">{selected.error}</p></section>}
      {selected.summary && <section className="mb-3 rounded-[16px] bg-surface-secondary p-4"><h3 className="mb-1 text-[12.5px] font-semibold uppercase tracking-wide text-secondary">Результат</h3><p className="whitespace-pre-wrap text-[14px] leading-[21px] text-primary">{selected.summary}</p></section>}
      <section className="mb-3 rounded-[16px] bg-surface-secondary p-4">
        <h3 className="mb-2 text-[12.5px] font-semibold uppercase tracking-wide text-secondary">Запуск</h3>
        <p className="text-[14px] leading-[21px] text-secondary">Раундов: {selected.rounds ?? 0} · вызовов инструментов: {selected.toolCallsCount}</p>
        {selected.usage && <p className="mt-1 text-[14px] leading-[21px] text-secondary">Токенов: {selected.usage.totalTokens}{selected.usage.estimated ? ' (оценка)' : ''}</p>}
        {selected.verificationStatus && <p className="mt-1 text-[14px] leading-[21px] text-secondary">Проверка: {selected.verificationStatus}</p>}
      </section>
      {!!selected.checks?.length && <section className="rounded-[16px] bg-surface-secondary p-4">
        <h3 className="mb-2 text-[12.5px] font-semibold uppercase tracking-wide text-secondary">Проверки</h3>
        <ul className="flex flex-col gap-1.5">{selected.checks.map((check, index) => <li key={`${check.toolName}:${index}`} className="text-[14px] leading-[21px] text-secondary">{check.passed ? '✓' : '·'} {check.toolName}{check.command ? ` (${check.command})` : ''}{check.stale ? ' · устарела' : ''}</li>)}</ul>
      </section>}
    </div>
  </div>

  return <div className="flex min-h-0 min-w-0 flex-1 flex-col bg-canvas">
    <div className="shrink-0 px-5 pb-4 pt-5">
      <h2 className="text-[19px] font-semibold leading-[25px] text-primary">Субагенты</h2>
      <p className="mt-1 text-[14px] leading-[20px] text-secondary">{activeCount ? `${activeCount} ${activeCount === 1 ? 'выполняется' : 'выполняются'}` : 'Активных запусков нет'}</p>
    </div>
    <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-4 no-scrollbar">
      {activeItems.length > 0 && <section aria-label="Активные субагенты">
        <h3 className="px-2 pb-2 pt-1 text-[12.5px] font-semibold uppercase tracking-wide text-secondary">Активные</h3>
        <ul className="flex flex-col gap-2">{activeItems.map(item => <li key={item.id} className="flex min-w-0 items-center gap-2 rounded-[16px] bg-surface-secondary p-2.5">
          <button type="button" onClick={() => setSelectedId(item.id)} aria-label={`Открыть: ${ROLE_LABEL[item.role]} — ${item.task}`} className="flex min-w-0 flex-1 flex-col items-start rounded-[12px] px-1.5 py-1 text-left text-primary hover:bg-control border-none shadow-none focus-visible:outline-none cursor-pointer">
            <span className="flex w-full min-w-0 items-center gap-2"><span className="shrink-0 text-[13px] text-secondary">{ROLE_LABEL[item.role]}</span><span className="shrink-0 text-secondary">·</span><span className="shrink-0 text-[13px] text-secondary">{STATUS_LABEL[item.status]}</span></span>
            <span className="mt-0.5 w-full truncate text-[14px] leading-[20px]">{item.task}</span>
            {item.activity && <span className="mt-0.5 w-full truncate text-[13px] leading-[19px] text-secondary">{item.activity}</span>}
          </button>
          {controls(item)}
        </li>)}</ul>
      </section>}
      {recentItems.length > 0 && <section aria-label="Недавние субагенты" className={activeItems.length ? 'mt-5' : ''}>
        <h3 className="px-2 pb-2 pt-1 text-[12.5px] font-semibold uppercase tracking-wide text-secondary">Недавние</h3>
        <ul className="flex flex-col gap-2">{recentItems.map(item => <li key={item.id} className="flex min-w-0 items-center gap-2 rounded-[16px] bg-surface-secondary p-2.5">
          <button type="button" onClick={() => setSelectedId(item.id)} aria-label={`Открыть: ${ROLE_LABEL[item.role]} — ${item.task}`} className="flex min-w-0 flex-1 flex-col items-start rounded-[12px] px-1.5 py-1 text-left text-primary hover:bg-control border-none shadow-none focus-visible:outline-none cursor-pointer">
            <span className="flex w-full min-w-0 items-center gap-2"><span className="shrink-0 text-[13px] text-secondary">{ROLE_LABEL[item.role]}</span><span className="shrink-0 text-secondary">·</span><span className="shrink-0 text-[13px] text-secondary">{STATUS_LABEL[item.status]}</span></span>
            <span className="mt-0.5 w-full truncate text-[14px] leading-[20px]">{item.task}</span>
            {(item.error || item.summary) && <span className="mt-0.5 w-full truncate text-[13px] leading-[19px] text-secondary">{item.error || item.summary}</span>}
          </button>
          {controls(item)}
        </li>)}</ul>
      </section>}
    </div>
  </div>
}
