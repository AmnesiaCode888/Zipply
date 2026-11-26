import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ArrowLeft,
  Check,
  ChevronRight,
  FileCode2,
  Folder,
  FolderTree,
  GitBranch,
  GitCompareArrows,
  List,
  Minus,
  Plus,
  RefreshCw,
  RotateCcw,
  Search
} from '../../icons'
import { appStorage } from '../../services/appStorage'
import { VSCodeFileIcon } from '../tools/VSCodeFileIcon'
import type {
  ChangeStatus,
  WorkspaceChangeEntry,
  WorkspaceChangesSummary,
  WorkspaceFileDiff
} from '../../../../shared/workspaceChanges'
import { ChangesDiffViewer, type DiffViewMode } from './ChangesDiffViewer'

interface WorkspaceChangesProps {
  folderPath?: string
  sessionId?: string
  onOpenFileInFiles?: (path: string) => void
  onCountChange?: (count: number) => void
}

type ScopeFilter = 'all' | 'ai'
type ListLayout = 'flat' | 'tree'

function uniquePathCount(entries: WorkspaceChangeEntry[]): number {
  return new Set(entries.map((entry) => entry.path)).size
}

const STATUS_BADGE: Record<ChangeStatus, { label: string; cls: string; title: string }> = {
  modified: { label: 'M', cls: 'text-primary', title: 'Изменён' },
  added: { label: 'A', cls: 'text-diff-add', title: 'Добавлен' },
  deleted: { label: 'D', cls: 'text-diff-remove', title: 'Удалён' },
  renamed: { label: 'R', cls: 'text-accent', title: 'Переименован' },
  copied: { label: 'C', cls: 'text-accent', title: 'Скопирован' },
  untracked: { label: 'U', cls: 'text-diff-add', title: 'Новый файл' },
  conflicted: { label: '!', cls: 'text-diff-remove', title: 'Конфликт слияния' }
}

function splitPathParts(relPath: string): { name: string; dir: string } {
  const norm = relPath.replace(/\\/g, '/')
  const idx = norm.lastIndexOf('/')
  if (idx < 0) return { name: norm, dir: '' }
  return { name: norm.slice(idx + 1), dir: norm.slice(0, idx) }
}

interface TreeGroup {
  dir: string
  entries: WorkspaceChangeEntry[]
}

function groupEntriesByDirectory(entries: WorkspaceChangeEntry[]): TreeGroup[] {
  const map = new Map<string, WorkspaceChangeEntry[]>()
  for (const entry of entries) {
    const { dir } = splitPathParts(entry.path)
    const key = dir || '.'
    let list = map.get(key)
    if (!list) {
      list = []
      map.set(key, list)
    }
    list.push(entry)
  }
  return Array.from(map.entries())
    .sort(([a], [b]) => (a === '.' ? -1 : b === '.' ? 1 : a.localeCompare(b)))
    .map(([dir, list]) => ({ dir, entries: list }))
}

export const WorkspaceChanges: React.FC<WorkspaceChangesProps> = ({
  folderPath,
  sessionId = '',
  onOpenFileInFiles,
  onCountChange
}) => {
  const [summary, setSummary] = useState<WorkspaceChangesSummary | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [showListMobile, setShowListMobile] = useState(true)
  const [diffState, setDiffState] = useState<{ id?: string; data?: WorkspaceFileDiff; loading?: boolean; error?: string }>({})
  const [viewMode, setViewMode] = useState<DiffViewMode>(() => {
    try {
      return appStorage.getItem('zipply_changes_diff_mode') === 'split' ? 'split' : 'unified'
    } catch {
      return 'unified'
    }
  })
  const [listLayout, setListLayout] = useState<ListLayout>(() => {
    try {
      return appStorage.getItem('zipply_changes_list_layout') === 'tree' ? 'tree' : 'flat'
    } catch {
      return 'flat'
    }
  })
  const [scopeFilterSelection, setScopeFilterSelection] = useState<ScopeFilter | null>(null)
  const [includeNoise, setIncludeNoise] = useState(false)
  const [collapsedDirs, setCollapsedDirs] = useState<Set<string>>(() => new Set())
  const [query, setQuery] = useState('')
  const [commitMessage, setCommitMessage] = useState('')
  const [committing, setCommitting] = useState(false)
  const [actionError, setActionError] = useState('')
  const [confirmDiscardId, setConfirmDiscardId] = useState<string | null>(null)
  const [confirmDiscardAll, setConfirmDiscardAll] = useState(false)
  const [discardingAll, setDiscardingAll] = useState(false)
  const [busyEntryId, setBusyEntryId] = useState<string | null>(null)
  const [busyHunkIndex, setBusyHunkIndex] = useState<number | null>(null)
  const [initBusy, setInitBusy] = useState(false)

  const containerRef = useRef<HTMLDivElement>(null)
  const summaryRequestRef = useRef(0)
  const diffRequestRef = useRef(0)
  const [containerWidth, setContainerWidth] = useState(0)
  const [listWidth, setListWidth] = useState(() => {
    try {
      const saved = Number(appStorage.getItem('zipply_changes_list_width'))
      return saved >= 200 && saved <= 520 ? saved : 276
    } catch {
      return 276
    }
  })
  const [resizingList, setResizingList] = useState(false)
  const listWidthRef = useRef(listWidth)
  const maxListWidth = Math.min(520, Math.max(200, containerWidth ? containerWidth - 260 : 520))
  const displayedListWidth = Math.min(listWidth, maxListWidth)
  listWidthRef.current = listWidth
  const canSplit = containerWidth === 0 || containerWidth - displayedListWidth >= 560
  const effectiveViewMode: DiffViewMode = viewMode === 'split' && canSplit ? 'split' : 'unified'

  const setSavedListWidth = useCallback(
    (value: number) => {
      const next = Math.max(200, Math.min(maxListWidth, Math.round(value)))
      listWidthRef.current = next
      setListWidth(next)
      try {
        appStorage.setItem('zipply_changes_list_width', String(next))
      } catch {
        /* ignore */
      }
    },
    [maxListWidth]
  )

  useEffect(() => {
    const node = containerRef.current
    if (!node) return
    const observer = new ResizeObserver((entries) => setContainerWidth(entries[0].contentRect.width))
    observer.observe(node)
    return () => observer.disconnect()
  }, [folderPath])

  useEffect(() => {
    if (!resizingList) return
    let frame = 0
    const move = (event: PointerEvent) => {
      const bounds = containerRef.current?.getBoundingClientRect()
      if (bounds) {
        listWidthRef.current = Math.max(
          200,
          Math.min(520, Math.max(200, bounds.width - 260), Math.round(bounds.right - event.clientX))
        )
        if (!frame) frame = requestAnimationFrame(() => { frame = 0; setListWidth(listWidthRef.current) })
      }
    }
    const stop = () => {
      if (frame) cancelAnimationFrame(frame)
      frame = 0
      setListWidth(listWidthRef.current)
      setResizingList(false)
      try {
        appStorage.setItem('zipply_changes_list_width', String(listWidthRef.current))
      } catch {
        /* ignore */
      }
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', stop)
    window.addEventListener('pointercancel', stop)
    window.addEventListener('blur', stop)
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
    return () => {
      if (frame) cancelAnimationFrame(frame)
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', stop)
      window.removeEventListener('pointercancel', stop)
      window.removeEventListener('blur', stop)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }
  }, [resizingList])

  const loadSummary = useCallback(
    async (silent = false) => {
      const api = window.api?.changes
      if (!api || !folderPath) return
      const requestId = ++summaryRequestRef.current
      if (!silent) setLoading(true)
      try {
        const res = await api.getSummary(sessionId, folderPath, includeNoise)
        if (requestId !== summaryRequestRef.current) return
        if (res.error || !res.data) {
          setError(res.error || 'Не удалось получить список изменений.')
          return
        }
        setError('')
        setSummary(res.data)
        onCountChange?.(res.data.totals.files)
      } catch {
        if (requestId !== summaryRequestRef.current) return
        setError('Не удалось получить список изменений.')
      } finally {
        if (requestId === summaryRequestRef.current) setLoading(false)
      }
    },
    [folderPath, sessionId, includeNoise, onCountChange]
  )

  useEffect(() => {
    setSummary(null)
    setSelectedId(null)
    setDiffState({})
    setConfirmDiscardId(null)
    setConfirmDiscardAll(false)
    setActionError('')
    if (!folderPath) return
    void loadSummary(false)
    const api = window.api?.changes
    if (!api) return
    api.watch(folderPath)
    const unsubscribe = api.onUpdated((payload) => {
      if (payload.folderPath === folderPath || payload.folderPath.toLowerCase() === folderPath.toLowerCase()) {
        void loadSummary(true)
      }
    })
    return () => {
      unsubscribe()
      api.unwatch(folderPath)
    }
  }, [folderPath, sessionId, loadSummary])

  const entries = summary?.entries ?? []
  const aiEntries = useMemo(() => entries.filter((e) => e.touchedByChat), [entries])
  const aiCount = useMemo(() => uniquePathCount(aiEntries), [aiEntries])
  const allPathCount = useMemo(() => uniquePathCount(entries), [entries])
  const scopeFilter = scopeFilterSelection ?? (aiCount > 0 ? 'ai' : 'all')

  useEffect(() => {
    if (scopeFilterSelection === 'ai' && aiCount === 0) {
      setScopeFilterSelection(null)
    }
  }, [scopeFilterSelection, aiCount])

  const scopedEntries = useMemo(
    () => (scopeFilter === 'ai' ? aiEntries : entries),
    [aiEntries, entries, scopeFilter]
  )
  const scopeTotals = useMemo(() => {
    let added = 0
    let removed = 0
    for (const entry of scopedEntries) {
      if (typeof entry.added === 'number') added += entry.added
      if (typeof entry.removed === 'number') removed += entry.removed
    }
    return { files: uniquePathCount(scopedEntries), added, removed }
  }, [scopedEntries])

  const filteredEntries = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return scopedEntries
    return scopedEntries.filter((e) => e.path.toLowerCase().includes(q))
  }, [scopedEntries, query])

  const selectedEntry = useMemo(
    () => filteredEntries.find((e) => e.id === selectedId) || filteredEntries[0] || null,
    [filteredEntries, selectedId]
  )

  useEffect(() => {
    if (!selectedEntry) {
      diffRequestRef.current += 1
      setSelectedId(null)
      setDiffState({})
      return
    }
    if (selectedId !== selectedEntry.id) {
      setSelectedId(selectedEntry.id)
    }
  }, [selectedEntry, selectedId])

  const loadDiff = useCallback(
    async (entry: WorkspaceChangeEntry, silent = false) => {
      const api = window.api?.changes
      if (!api || !folderPath) return
      const requestId = ++diffRequestRef.current
      if (!silent) setDiffState({ id: entry.id, loading: true })
      try {
        const res = await api.getFileDiff(sessionId, folderPath, entry.path, entry.scope, entry.status)
        if (requestId !== diffRequestRef.current) return
        if (res.error || !res.data) {
          setDiffState({ id: entry.id, error: res.error || 'Не удалось загрузить diff.' })
          return
        }
        setDiffState({ id: entry.id, data: res.data })
      } catch {
        if (requestId !== diffRequestRef.current) return
        setDiffState({ id: entry.id, error: 'Не удалось загрузить diff.' })
      }
    },
    [folderPath, sessionId]
  )

  useEffect(() => {
    if (!selectedEntry) return
    void loadDiff(selectedEntry, diffState.id === selectedEntry.id && Boolean(diffState.data))
  }, [selectedEntry?.id, summary, loadDiff])

  const stagedEntries = useMemo(
    () => filteredEntries.filter((e) => e.scope === 'staged'),
    [filteredEntries]
  )
  const unstagedEntries = useMemo(
    () => filteredEntries.filter((e) => e.scope === 'unstaged'),
    [filteredEntries]
  )
  const sessionEntries = useMemo(
    () => filteredEntries.filter((e) => e.scope === 'session'),
    [filteredEntries]
  )

  const handleSetViewMode = (mode: DiffViewMode) => {
    setViewMode(mode)
    try {
      appStorage.setItem('zipply_changes_diff_mode', mode)
    } catch {
      /* ignore */
    }
  }

  const handleSetListLayout = (layout: ListLayout) => {
    setListLayout(layout)
    try {
      appStorage.setItem('zipply_changes_list_layout', layout)
    } catch {
      /* ignore */
    }
  }

  const handleStage = async (paths: string[], entryId?: string) => {
    const api = window.api?.changes
    if (!api || !folderPath || !paths.length) return
    setActionError('')
    if (entryId) setBusyEntryId(entryId)
    const res = await api.stage(folderPath, paths)
    setBusyEntryId(null)
    if (res.error) {
      setActionError(res.error)
      return
    }
    await loadSummary(true)
  }

  const handleUnstage = async (paths: string[], entryId?: string) => {
    const api = window.api?.changes
    if (!api || !folderPath || !paths.length) return
    setActionError('')
    if (entryId) setBusyEntryId(entryId)
    const res = await api.unstage(folderPath, paths)
    setBusyEntryId(null)
    if (res.error) {
      setActionError(res.error)
      return
    }
    await loadSummary(true)
  }

  const handleDiscard = async (entry: WorkspaceChangeEntry) => {
    const api = window.api?.changes
    if (!api || !folderPath) return
    setActionError('')
    setBusyEntryId(entry.id)
    const res = await api.discard(sessionId, folderPath, entry.path, entry.scope, entry.status)
    setBusyEntryId(null)
    setConfirmDiscardId(null)
    if (res.error) {
      setActionError(res.error)
      return
    }
    await loadSummary(true)
  }

  const handleDiscardAll = async () => {
    const api = window.api?.changes
    if (!api?.discardAll || !folderPath || discardingAll) return
    setActionError('')
    setDiscardingAll(true)
    const res = await api.discardAll(sessionId, folderPath, scopeFilter === 'ai')
    setDiscardingAll(false)
    setConfirmDiscardAll(false)
    if (res.error) {
      setActionError(res.error)
      return
    }
    await loadSummary(true)
  }

  const handleRevertHunk = async (hunkIndex: number) => {
    const api = window.api?.changes
    if (!api || !folderPath || !selectedEntry) return
    setActionError('')
    setBusyHunkIndex(hunkIndex)
    const res = await api.revertHunk(sessionId, folderPath, selectedEntry.path, selectedEntry.scope, hunkIndex)
    setBusyHunkIndex(null)
    if (res.error) {
      setActionError(res.error)
      await loadSummary(true)
      return
    }
    await loadSummary(true)
  }

  const handleCommit = async () => {
    const api = window.api?.changes
    if (!api || !folderPath || !commitMessage.trim() || committing) return
    setActionError('')
    setCommitting(true)
    const res = await api.commit(folderPath, commitMessage)
    setCommitting(false)
    if (res.error) {
      setActionError(res.error)
      return
    }
    setCommitMessage('')
    await loadSummary(true)
  }

  const handleInitRepo = async () => {
    const api = window.api?.changes
    if (!api || !folderPath || initBusy) return
    setActionError('')
    setInitBusy(true)
    const res = await api.initRepo(folderPath)
    setInitBusy(false)
    if (res.error) {
      setActionError(res.error)
      return
    }
    await loadSummary(true)
  }

  if (!folderPath) {
    return (
      <p className="m-auto px-5 text-center text-[15px] text-secondary">
        Рабочая папка чата ещё не готова.
      </p>
    )
  }

  const renderEntryRow = (entry: WorkspaceChangeEntry, compactDir = false) => {
    const { name, dir } = splitPathParts(entry.path)
    const badge = STATUS_BADGE[entry.status]
    const isSelected = selectedEntry?.id === entry.id
    const isBusy = busyEntryId === entry.id
    return (
      <div
        key={entry.id}
        className={`group flex items-center gap-2 rounded-[12px] px-2.5 py-2 transition-colors ${
          isSelected ? 'bg-control text-primary' : 'text-secondary hover:bg-hover hover:text-primary'
        }`}
      >
        <button
          type="button"
          onClick={() => {
            setSelectedId(entry.id)
            setConfirmDiscardId(null)
            setShowListMobile(false)
          }}
          title={entry.oldPath ? `${entry.oldPath} → ${entry.path}` : entry.path}
          className="flex min-w-0 flex-1 items-center gap-2.5 border-none bg-transparent text-left cursor-pointer"
        >
          <span aria-hidden="true" className="flex shrink-0">
            <VSCodeFileIcon filename={name} size={16} />
          </span>
          <span className="min-w-0 flex-1">
            <span className="flex items-center gap-1.5">
              <span className={`truncate text-[14px] leading-[20px] ${isSelected ? 'text-primary font-medium' : 'text-primary'}`}>
                {name}
              </span>
              {entry.touchedByChat && (
                <span title="Этот файл изменял ИИ в текущей сессии" className="shrink-0 rounded-full bg-accent-soft px-1.5 py-0.5 text-[10px] font-semibold text-accent">
                  ИИ
                </span>
              )}
            </span>
            {!compactDir && dir && <span className="block truncate text-[12px] leading-[16px] text-muted">{dir}</span>}
          </span>
        </button>

        <div className="flex shrink-0 items-center gap-1">
          {(entry.added !== null || entry.removed !== null) && (
            <span className="hidden sm:inline-flex items-center gap-1 text-[11.5px] tabular-nums text-muted mr-0.5">
              {entry.added ? <span className="text-diff-add">+{entry.added}</span> : null}
              {entry.removed ? <span className="text-diff-remove">−{entry.removed}</span> : null}
            </span>
          )}
          <span
            title={badge.title}
            className={`w-4 text-center font-mono text-[12px] font-semibold ${badge.cls}`}
          >
            {badge.label}
          </span>

          {entry.scope === 'unstaged' && summary?.mode === 'git' && (
            <button
              type="button"
              disabled={isBusy}
              title="Подготовить файл для коммита"
              aria-label={`Подготовить ${entry.path}`}
              onClick={() => void handleStage([entry.path], entry.id)}
              className="flex h-6 w-6 items-center justify-center rounded-full border-none text-secondary opacity-0 group-hover:opacity-100 focus-visible:opacity-100 hover:bg-hover-strong hover:text-primary cursor-pointer"
            >
              <Plus size={13} />
            </button>
          )}
          {entry.scope === 'staged' && summary?.mode === 'git' && (
            <button
              type="button"
              disabled={isBusy}
              title="Снять подготовку файла для коммита"
              aria-label={`Убрать ${entry.path} из индекса`}
              onClick={() => void handleUnstage([entry.path], entry.id)}
              className="flex h-6 w-6 items-center justify-center rounded-full border-none text-secondary opacity-0 group-hover:opacity-100 focus-visible:opacity-100 hover:bg-hover-strong hover:text-primary cursor-pointer"
            >
              <Minus size={13} />
            </button>
          )}
        </div>
      </div>
    )
  }

  const renderEntryCollection = (items: WorkspaceChangeEntry[], sectionKey: string) => {
    if (listLayout === 'flat') {
      return <div className="space-y-0.5">{items.map((e) => renderEntryRow(e, false))}</div>
    }
    const groups = groupEntriesByDirectory(items)
    return (
      <div className="space-y-1">
        {groups.map((group) => {
          const key = `${sectionKey}:${group.dir}`
          const collapsed = collapsedDirs.has(key)
          if (group.dir === '.') {
            return (
              <div key={key} className="space-y-0.5">
                {group.entries.map((e) => renderEntryRow(e, true))}
              </div>
            )
          }
          return (
            <div key={key}>
              <button
                type="button"
                aria-expanded={!collapsed}
                onClick={() =>
                  setCollapsedDirs((prev) => {
                    const next = new Set(prev)
                    if (next.has(key)) next.delete(key)
                    else next.add(key)
                    return next
                  })
                }
                className="flex h-8 w-full items-center gap-1.5 rounded-[10px] border-none px-2 text-left text-[12.5px] text-secondary hover:bg-hover hover:text-primary cursor-pointer"
              >
                <ChevronRight
                  size={13}
                  className={`shrink-0 transition-transform duration-150 ${collapsed ? '' : 'rotate-90'}`}
                />
                <Folder size={13} className="shrink-0 text-muted" />
                <span className="min-w-0 flex-1 truncate">{group.dir}</span>
                <span className="shrink-0 text-[11px] tabular-nums text-muted">{group.entries.length}</span>
              </button>
              {!collapsed && (
                <div className="pl-3 space-y-0.5">
                  {group.entries.map((e) => renderEntryRow(e, true))}
                </div>
              )}
            </div>
          )
        })}
      </div>
    )
  }

  return (
    <div
      ref={containerRef}
      style={{ '--workspace-changes-width': `${displayedListWidth}px` } as React.CSSProperties}
      className={`workspace-changes flex min-h-0 min-w-0 flex-1 ${resizingList ? 'workspace-changes-resizing' : ''} ${
        selectedEntry && !showListMobile ? 'workspace-changes-selected' : ''
      }`}
    >
      {/* List Pane */}
      <aside
        aria-label="Список изменённых файлов"
        className="workspace-changes-list flex min-h-0 min-w-0 flex-col rounded-[20px] bg-surface-secondary m-2"
      >
        <div className="flex h-14 shrink-0 items-center gap-1.5 px-4">
          {summary?.mode === 'git' ? (
            <GitBranch size={16} className="shrink-0 text-secondary" />
          ) : (
            <GitCompareArrows size={16} className="shrink-0 text-secondary" />
          )}
          <span
            className="min-w-0 flex-1 truncate text-[15px] font-medium text-primary"
            title={summary?.mode === 'git' ? `Ветка: ${summary.branch || 'HEAD'}` : 'Отличие от первого снимка рабочей папки в этом чате'}
          >
            {summary?.mode === 'git' ? summary.branch || 'Git' : 'С начала сессии'}
          </span>
          <button
            type="button"
            aria-label={listLayout === 'tree' ? 'Показать списком' : 'Показать деревом'}
            title={listLayout === 'tree' ? 'Показать списком' : 'Показать деревом'}
            onClick={() => handleSetListLayout(listLayout === 'tree' ? 'flat' : 'tree')}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border-none text-secondary hover:bg-hover hover:text-primary active:scale-95 cursor-pointer"
          >
            {listLayout === 'tree' ? <List size={15} /> : <FolderTree size={15} />}
          </button>
          <button
            type="button"
            aria-label="Обновить изменения"
            title="Обновить изменения"
            onClick={() => void loadSummary(false)}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border-none text-secondary hover:bg-hover hover:text-primary active:scale-95 cursor-pointer"
          >
            <RefreshCw size={15} className={loading ? 'animate-spin' : ''} />
          </button>
        </div>

        {/* Summary totals + actions */}
        {summary && (
          <div className="flex flex-wrap items-center justify-between gap-2 px-4 pb-2.5 text-[12.5px] text-secondary">
            <span className="tabular-nums">
              Файлов: <span className="text-primary font-medium">{scopeTotals.files}</span>
              {(scopeTotals.added > 0 || scopeTotals.removed > 0) && (
                <>
                  {' · '}
                  <span className="text-diff-add">+{scopeTotals.added}</span>{' '}
                  <span className="text-diff-remove">−{scopeTotals.removed}</span>
                </>
              )}
            </span>
            <div className="flex items-center gap-1.5">
              {entries.length > 0 && (
                <button
                  type="button"
                  onClick={() => setConfirmDiscardAll((prev) => !prev)}
                  className="rounded-full border-none bg-control px-2.5 py-1 text-[11.5px] font-medium text-secondary hover:bg-control-hover hover:text-diff-remove active:scale-95 cursor-pointer"
                >
                  Откатить все
                </button>
              )}
              {summary.mode === 'session' && !summary.hasGitFolder && summary.gitInstalled && (
                <button
                  type="button"
                  disabled={initBusy}
                  onClick={() => void handleInitRepo()}
                  className="rounded-full border-none bg-control px-2.5 py-1 text-[11.5px] font-medium text-primary hover:bg-control-hover active:scale-95 cursor-pointer"
                >
                  {initBusy ? 'Инициализация…' : 'Включить Git'}
                </button>
              )}
            </div>
          </div>
        )}

        {confirmDiscardAll && (
          <div className="mx-3 mb-2.5 flex flex-col gap-2 rounded-[14px] bg-surface p-3">
            <span className="text-[12.5px] leading-[18px] text-primary">
              {scopeFilter === 'ai'
                ? `Откатить файлы, которых касался ИИ (${aiCount})? Все изменения в этих файлах будут отменены.`
                : `Откатить все изменения в папке (${allPathCount})?`}
            </span>
            <div className="flex items-center justify-end gap-1.5">
              <button
                type="button"
                onClick={() => setConfirmDiscardAll(false)}
                className="h-7 rounded-full border-none bg-control px-3 text-[12px] text-secondary hover:bg-control-hover hover:text-primary cursor-pointer"
              >
                Отмена
              </button>
              <button
                type="button"
                disabled={discardingAll}
                onClick={() => void handleDiscardAll()}
                className="h-7 rounded-full border-none bg-diff-remove px-3 text-[12px] font-medium text-white active:scale-95 disabled:opacity-50 cursor-pointer"
              >
                {discardingAll ? 'Откат…' : 'Откатить'}
              </button>
            </div>
          </div>
        )}

        {/* Scope switcher: All vs AI-touched (like Claude Code / Cursor Review) */}
        {aiCount > 0 && (
          <div className="mx-3 mb-2.5 flex h-8 items-center rounded-full bg-surface p-0.5">
            <button
              type="button"
              aria-pressed={scopeFilter === 'all'}
              onClick={() => setScopeFilterSelection('all')}
              className={`h-7 flex-1 rounded-full border-none text-[12px] font-medium cursor-pointer transition-colors ${
                scopeFilter === 'all' ? 'bg-control text-primary' : 'text-secondary hover:text-primary'
              }`}
            >
              Вся папка · {allPathCount}
            </button>
            <button
              type="button"
              aria-pressed={scopeFilter === 'ai'}
              title="Файлы, которые ИИ изменял в текущей сессии"
              onClick={() => setScopeFilterSelection('ai')}
              className={`h-7 flex-1 rounded-full border-none text-[12px] font-medium cursor-pointer transition-colors ${
                scopeFilter === 'ai' ? 'bg-control text-primary' : 'text-secondary hover:text-primary'
              }`}
            >
              Файлы ИИ · {aiCount}
            </button>
          </div>
        )}

        {summary?.mode === 'session' && summary.hasGitFolder && !summary.gitInstalled && (
          <p className="mx-3 mb-2 rounded-[12px] bg-surface px-3 py-2 text-[12.5px] leading-[18px] text-secondary">
            В папке есть .git, но утилита git не найдена в PATH — показаны изменения сессии.
          </p>
        )}

        {summary?.truncated && (
          <p className="mx-3 mb-2 rounded-[12px] bg-surface px-3 py-2 text-[12px] leading-[17px] text-secondary">
            Папка крупная: фоновый снимок ограничен по объёму, но правки ИИ и редактора отслеживаются полностью.
          </p>
        )}

        {/* Git Commit Form */}
        {summary?.mode === 'git' && (
          <div className="mx-3 mb-2.5 flex flex-col gap-2 rounded-[16px] bg-surface p-2.5">
            <textarea
              rows={2}
              value={commitMessage}
              onChange={(e) => setCommitMessage(e.target.value)}
              onKeyDown={(e) => {
                if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
                  e.preventDefault()
                  void handleCommit()
                }
              }}
              placeholder="Сообщение коммита"
              aria-label="Сообщение коммита"
              className="w-full resize-none rounded-[10px] border-none bg-transparent px-1.5 py-1 text-[13.5px] leading-[20px] text-primary placeholder:text-muted outline-none"
            />
            <p className="px-1.5 text-[11.5px] leading-[16px] text-muted">
              Коммит включает все подготовленные изменения Git, даже если фильтр скрывает часть файлов.
            </p>
            <button
              type="button"
              disabled={committing || !commitMessage.trim() || !entries.some((e) => e.scope === 'staged')}
              onClick={() => void handleCommit()}
              className="flex h-8 w-full items-center justify-center gap-1.5 rounded-full border-none bg-accent px-3 text-[13px] font-medium text-on-accent hover:bg-accent-hover active:scale-95 disabled:opacity-40 disabled:cursor-default cursor-pointer transition-colors"
            >
              <Check size={14} strokeWidth={2} />
              <span>
                {committing
                  ? 'Коммит…'
                  : `Закоммитить${entries.some((e) => e.scope === 'staged') ? ` (${entries.filter((e) => e.scope === 'staged').length})` : ''}`}
              </span>
            </button>
          </div>
        )}

        {scopedEntries.length > 5 && (
          <div className="mx-3 mb-2 flex h-8 items-center gap-2 rounded-full bg-surface px-3">
            <Search size={13} className="shrink-0 text-muted" />
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Фильтр файлов…"
              aria-label="Фильтр изменённых файлов"
              className="w-full border-none bg-transparent text-[13px] text-primary placeholder:text-muted outline-none"
            />
          </div>
        )}

        {(error || actionError) && (
          <p role="alert" className="mx-3 mb-2 rounded-[12px] bg-surface px-3 py-2 text-[12.5px] leading-[18px] text-diff-remove">
            {actionError || error}
          </p>
        )}

        <div className="min-h-0 flex-1 overflow-auto px-2 pb-3 space-y-3">
          {loading && !summary ? (
            <p className="px-3 py-2 text-[13.5px] text-secondary">Загрузка изменений…</p>
          ) : filteredEntries.length === 0 ? (
            <div className="flex flex-col items-center justify-center px-4 py-10 text-center">
              <GitCompareArrows size={22} strokeWidth={1.5} className="mb-2 text-muted" />
              <p className="text-[14px] text-secondary">
                {entries.length > 0 ? 'Нет файлов по этому фильтру' : (summary?.hiddenNoiseCount ?? 0) > 0 ? 'Видимых изменений нет' : 'Рабочая папка чиста'}
              </p>
              <p className="mt-1 text-[12.5px] text-muted">
                {entries.length > 0
                  ? 'Выберите другой режим или измените поисковый запрос.'
                  : (summary?.hiddenNoiseCount ?? 0) > 0
                    ? `Скрыто служебных файлов: ${summary?.hiddenNoiseCount}. Их можно показать внизу списка.`
                    : 'Новые правки появятся здесь автоматически'}
              </p>
            </div>
          ) : summary?.mode === 'git' ? (
            <>
              {stagedEntries.length > 0 && (
                <div>
                  <div className="flex items-center justify-between px-2.5 pb-1">
                    <span className="text-[11.5px] font-semibold uppercase tracking-wide text-secondary">
                      Для коммита · {stagedEntries.length}
                    </span>
                    <button
                      type="button"
                      onClick={() => void handleUnstage(stagedEntries.map((e) => e.path))}
                      className="rounded-full border-none bg-transparent px-2 py-0.5 text-[11.5px] text-secondary hover:bg-hover hover:text-primary cursor-pointer"
                    >
                      Убрать все
                    </button>
                  </div>
                  {renderEntryCollection(stagedEntries, 'staged')}
                </div>
              )}

              {unstagedEntries.length > 0 && (
                <div>
                  <div className="flex items-center justify-between px-2.5 pb-1">
                    <span className="text-[11.5px] font-semibold uppercase tracking-wide text-secondary">
                      Не подготовлено · {unstagedEntries.length}
                    </span>
                    <button
                      type="button"
                      onClick={() => void handleStage(unstagedEntries.map((e) => e.path))}
                      className="rounded-full border-none bg-transparent px-2 py-0.5 text-[11.5px] text-secondary hover:bg-hover hover:text-primary cursor-pointer"
                    >
                      Подготовить все
                    </button>
                  </div>
                  {renderEntryCollection(unstagedEntries, 'unstaged')}
                </div>
              )}
            </>
          ) : (
            <div>
              <div className="px-2.5 pb-1">
                <span className="text-[11.5px] font-semibold uppercase tracking-wide text-secondary">
                  {scopeFilter === 'ai' ? `Файлы, затронутые ИИ · ${sessionEntries.length}` : `Все изменения · ${sessionEntries.length}`}
                </span>
              </div>
              {renderEntryCollection(sessionEntries, 'session')}
            </div>
          )}
        </div>

        {/* Quiet footer for hidden noise (.venv, __pycache__, node_modules, etc.) */}
        {((summary?.hiddenNoiseCount ?? 0) > 0 || includeNoise) && (
          <div className="flex shrink-0 items-center justify-between gap-2 px-4 py-2.5 text-[12px] text-muted">
            <span className="truncate">
              {includeNoise
                ? 'Показаны служебные файлы'
                : `Скрыто служебных: ${summary?.hiddenNoiseCount ?? 0}`}
            </span>
            <button
              type="button"
              onClick={() => setIncludeNoise((prev) => !prev)}
              className="shrink-0 rounded-full border-none bg-transparent px-2 py-0.5 text-[12px] text-secondary hover:bg-hover hover:text-primary cursor-pointer"
            >
              {includeNoise ? 'Скрыть' : 'Показать'}
            </button>
          </div>
        )}
      </aside>

      {/* Resizer */}
      <div
        role="separator"
        aria-label="Изменить ширину списка изменений"
        aria-orientation="vertical"
        aria-valuemin={200}
        aria-valuemax={maxListWidth}
        aria-valuenow={displayedListWidth}
        tabIndex={0}
        title="Перетащите для изменения ширины; двойной щелчок — сброс"
        className="workspace-changes-resizer"
        onPointerDown={(event) => {
          if (event.button !== 0) return
          event.preventDefault()
          setResizingList(true)
        }}
        onDoubleClick={() => setSavedListWidth(276)}
        onKeyDown={(event) => {
          if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
            event.preventDefault()
            setSavedListWidth(displayedListWidth + (event.key === 'ArrowLeft' ? 16 : -16))
          } else if (event.key === 'Home') {
            event.preventDefault()
            setSavedListWidth(200)
          } else if (event.key === 'End') {
            event.preventDefault()
            setSavedListWidth(maxListWidth)
          }
        }}
      />

      {/* Diff Preview Pane */}
      <div className="workspace-changes-preview flex min-h-0 min-w-0 flex-1 flex-col rounded-[20px] bg-canvas m-2 ml-0">
        {selectedEntry ? (
          <>
            <div className="flex h-14 shrink-0 items-center gap-2 px-3">
              <button
                type="button"
                aria-label="Назад к списку изменений"
                title="Назад к списку"
                onClick={() => setShowListMobile(true)}
                className="workspace-changes-back h-8 w-8 items-center justify-center rounded-full border-none text-secondary hover:bg-hover cursor-pointer"
              >
                <ArrowLeft size={17} />
              </button>

              <div className="flex h-[34px] min-w-0 flex-1 items-center gap-2 rounded-full bg-surface px-3" title={selectedEntry.path}>
                <span aria-hidden="true" className="flex shrink-0">
                  <VSCodeFileIcon filename={splitPathParts(selectedEntry.path).name} size={16} />
                </span>
                <span className="min-w-0 truncate text-[13.5px] text-secondary">
                  {selectedEntry.path.split('/').join(' / ')}
                </span>
                <span className="shrink-0 rounded-full bg-control px-2 py-0.5 text-[11px] text-secondary">
                  {selectedEntry.scope === 'staged'
                    ? 'Для коммита'
                    : selectedEntry.scope === 'unstaged'
                    ? 'Не подготовлено'
                    : 'Сессия'}
                </span>
              </div>

              {canSplit && (
                <div
                  role="group"
                  aria-label="Режим отображения diff"
                  className="flex h-[34px] shrink-0 items-center rounded-full bg-surface p-0.5"
                >
                  <button
                    type="button"
                    aria-pressed={effectiveViewMode === 'unified'}
                    onClick={() => handleSetViewMode('unified')}
                    className={`h-7 rounded-full border-none px-3 text-[12.5px] font-medium cursor-pointer transition-colors ${
                      effectiveViewMode === 'unified' ? 'bg-control text-primary' : 'text-secondary hover:text-primary'
                    }`}
                  >
                    Единый
                  </button>
                  <button
                    type="button"
                    aria-pressed={effectiveViewMode === 'split'}
                    onClick={() => handleSetViewMode('split')}
                    className={`h-7 rounded-full border-none px-3 text-[12.5px] font-medium cursor-pointer transition-colors ${
                      effectiveViewMode === 'split' ? 'bg-control text-primary' : 'text-secondary hover:text-primary'
                    }`}
                  >
                    Две колонки
                  </button>
                </div>
              )}

              {onOpenFileInFiles && selectedEntry.status !== 'deleted' && (
                <button
                  type="button"
                  onClick={() => onOpenFileInFiles(selectedEntry.path)}
                  title="Открыть во вкладке «Файлы»"
                  className="hidden sm:inline-flex h-[34px] shrink-0 items-center gap-1.5 rounded-full border-none bg-control px-3 text-[13px] text-secondary hover:bg-control-hover hover:text-primary active:scale-95 cursor-pointer transition-colors"
                >
                  <FileCode2 size={14} />
                  <span>Открыть</span>
                </button>
              )}

              <button
                type="button"
                disabled={busyEntryId === selectedEntry.id}
                onClick={() => setConfirmDiscardId(confirmDiscardId === selectedEntry.id ? null : selectedEntry.id)}
                title="Откатить все изменения в файле"
                className="inline-flex h-[34px] shrink-0 items-center gap-1.5 rounded-full border-none bg-control px-3 text-[13px] text-secondary hover:bg-control-hover hover:text-diff-remove active:scale-95 disabled:opacity-40 cursor-pointer transition-colors"
              >
                <RotateCcw size={14} />
                <span>Откатить</span>
              </button>
            </div>

            {confirmDiscardId === selectedEntry.id && (
              <div className="mx-3 mb-2.5 flex flex-wrap items-center justify-between gap-2 rounded-[14px] bg-surface px-3.5 py-2.5">
                <span className="text-[13.5px] text-primary">
                  {selectedEntry.status === 'untracked' || selectedEntry.status === 'added'
                    ? 'Удалить созданный файл в корзину?'
                    : 'Откатить все изменения в этом файле?'}
                </span>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setConfirmDiscardId(null)}
                    className="h-7 rounded-full border-none bg-control px-3 text-[12.5px] font-medium text-secondary hover:bg-control-hover hover:text-primary cursor-pointer"
                  >
                    Отмена
                  </button>
                  <button
                    type="button"
                    disabled={busyEntryId === selectedEntry.id}
                    onClick={() => void handleDiscard(selectedEntry)}
                    className="h-7 rounded-full border-none bg-diff-remove px-3 text-[12.5px] font-medium text-white active:scale-95 disabled:opacity-50 cursor-pointer"
                  >
                    {busyEntryId === selectedEntry.id ? 'Откат…' : 'Подтвердить'}
                  </button>
                </div>
              </div>
            )}

            {diffState.id !== selectedEntry.id || diffState.loading ? (
              <p className="p-4 text-[14px] text-secondary">Загрузка diff…</p>
            ) : diffState.error ? (
              <div className="p-4 text-[14px] text-secondary">
                <p>Не удалось загрузить diff: {diffState.error}</p>
                <button
                  type="button"
                  onClick={() => void loadDiff(selectedEntry, false)}
                  className="mt-2 rounded-full border-none text-primary underline cursor-pointer"
                >
                  Повторить
                </button>
              </div>
            ) : diffState.data ? (
              <ChangesDiffViewer
                diff={diffState.data}
                viewMode={effectiveViewMode}
                busyHunkIndex={busyHunkIndex}
                canRevertHunk={selectedEntry.status !== 'untracked' && selectedEntry.status !== 'added' && selectedEntry.status !== 'deleted'}
                onRevertHunk={(hunkIdx) => void handleRevertHunk(hunkIdx)}
              />
            ) : null}
          </>
        ) : (
          <div className="m-auto flex max-w-sm flex-col items-center gap-2.5 px-5 text-center">
            <GitCompareArrows size={28} strokeWidth={1.5} className="text-muted" />
            <p className="text-[15px] font-medium text-primary">Нет выбранного файла</p>
            <p className="text-[13.5px] leading-5 text-secondary">
              {entries.length > 0
                ? 'Выберите файл справа, чтобы посмотреть изменения.'
                : 'Когда агент, терминал или редактор изменят файлы, они появятся здесь.'}
            </p>
          </div>
        )}
      </div>
    </div>
  )
}
