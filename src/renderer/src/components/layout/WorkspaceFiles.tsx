import { appStorage } from '../../services/appStorage'
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ArrowLeft, ChevronDown, ChevronRight, CircleAlert, FileCode2, Folder, FolderOpen, RefreshCw } from '../../icons'
import { VSCodeFileIcon } from '../tools/VSCodeFileIcon'
import type { WorkspaceDiagnostics, WorkspaceFileEntry, WorkspaceFilePreview } from '../../../../shared/workspaceFiles'
import { loadEditorSettings } from '../../services/editorSettings'
import { diagnosticSpans } from './diagnosticSpans'

type HighlightJob = { id: number; file: string; text: string }

interface DirectoryState { entries?: WorkspaceFileEntry[]; error?: string; loading?: boolean }
export interface FileDraft { original: string; text: string }

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} Б`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} КБ`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} МБ`
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} ГБ`
}

function entriesEqual(a: WorkspaceFileEntry[] | undefined, b: WorkspaceFileEntry[]): boolean {
  if (!a || a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) {
    if (a[i].name !== b[i].name || a[i].path !== b[i].path || a[i].kind !== b[i].kind) return false
  }
  return true
}

function previewsEqual(a: WorkspaceFilePreview | undefined, b: WorkspaceFilePreview): boolean {
  if (!a || a.kind !== b.kind) return false
  if (a.kind === 'text' && b.kind === 'text') return a.text === b.text
  if (a.kind === 'binary' && b.kind === 'binary') return a.size === b.size
  if (a.kind === 'too-large' && b.kind === 'too-large') return a.size === b.size && a.maxSize === b.maxSize && a.mediaType === b.mediaType
  if ((a.kind === 'image' && b.kind === 'image') || (a.kind === 'video' && b.kind === 'video')) {
    if (a.mime !== b.mime || a.size !== b.size || a.bytes.byteLength !== b.bytes.byteLength) return false
    for (let i = 0; i < a.bytes.byteLength; i++) {
      if (a.bytes[i] !== b.bytes[i]) return false
    }
    return true
  }
  return false
}

function isSameWatchFolder(a: string, b: string): boolean {
  const normA = a.replace(/[\\/]+$/, '').replace(/\\/g, '/')
  const normB = b.replace(/[\\/]+$/, '').replace(/\\/g, '/')
  if (normA === normB) return true
  return (window.api?.platform === 'win32' || window.api?.platform === undefined) && normA.toLowerCase() === normB.toLowerCase()
}

const Directory: React.FC<{ root: string; path: string; depth: number; selected: string | null; onSelect: (path: string) => void; refresh: number }> = React.memo(({ root, path, depth, selected, onSelect, refresh }) => {
  const [state, setState] = useState<DirectoryState>({ loading: true })
  const [expanded, setExpanded] = useState<Set<string>>(() => {
    const parts = selected?.replace(/\\/g, '/').split('/') || []
    const parent = path.replace(/\\/g, '/')
    const parentParts = parent ? parent.split('/').length : 0
    return new Set(parts.length > parentParts + 1 ? [[...parts.slice(0, parentParts), parts[parentParts]].join('/')] : [])
  })
  const [retry, setRetry] = useState(0)
  const [visited, setVisited] = useState<Set<string>>(() => new Set(expanded))
  useEffect(() => {
    let live = true
    setState(previous => (previous.entries ? previous : { loading: true }))
    window.api.workspace.listFiles(root, path).then(result => {
      if (!live) return
      setState(previous => {
        if (result.error) return { error: result.error }
        const entries = result.data || []
        return entriesEqual(previous.entries, entries) ? previous : { entries }
      })
    }).catch(() => { if (live) setState({ error: 'Не удалось прочитать папку.' }) })
    return () => { live = false }
  }, [root, path, refresh, retry])
  if (state.loading) return <p className="px-4 py-2 text-[13px] text-secondary">Загрузка…</p>
  if (state.error) return <div className="px-4 py-2 text-[13px] leading-5 text-secondary"><p>Не удалось открыть папку: {state.error}</p><button type="button" onClick={() => setRetry(value => value + 1)} className="mt-1 rounded-full border-none text-primary underline cursor-pointer">Повторить</button></div>
  if (!state.entries?.length) return <p className="px-4 py-2 text-[13px] text-secondary">Папка пуста</p>
  return <ul className="m-0 list-none p-0">{state.entries.map(entry => {
    const isDirectory = entry.kind === 'directory'
    const entryKey = entry.path.replace(/\\/g, '/')
    const open = expanded.has(entryKey)
    return <li key={entry.path}>
      <button type="button" aria-expanded={isDirectory ? open : undefined} title={entry.name} onClick={() => {
        if (!isDirectory) { onSelect(entry.path); return }
        setVisited(previous => new Set(previous).add(entryKey))
        setExpanded(previous => { const next = new Set(previous); if (next.has(entryKey)) next.delete(entryKey); else next.add(entryKey); return next })
      }} style={{ paddingLeft: `${10 + depth * 16}px` }} className={`flex h-9 w-full min-w-0 items-center gap-2 rounded-[12px] border-none pr-3 text-left text-[15px] leading-[22px] cursor-pointer ${selected === entry.path ? 'bg-control text-primary' : 'text-secondary hover:bg-hover hover:text-primary'}`}>
        {isDirectory ? <ChevronRight size={15} className={`shrink-0 transition-transform duration-200 ${open ? 'rotate-90' : ''}`} /> : <span className="w-[15px] shrink-0" />}
        {!isDirectory && <span aria-hidden="true" className="flex shrink-0"><VSCodeFileIcon filename={entry.name} size={16} /></span>}
        <span className="truncate">{entry.name}</span>
      </button>
      {isDirectory && visited.has(entryKey) && <div className={`workspace-directory-children ${open ? 'is-open' : ''}`}><div><Directory root={root} path={entry.path} depth={depth + 1} selected={selected} onSelect={onSelect} refresh={refresh} /></div></div>}
    </li>
  })}</ul>
})

const WorkspaceFilesView: React.FC<{ folderPath?: string; sessionId?: string; selected?: string; onSelect: (path: string) => void; drafts?: Record<string, FileDraft>; onEdit?: (folder: string, file: string, original: string, text: string) => void; onSaved?: (folder: string, file: string, original: string, saved: string, text: string) => void }> = ({ folderPath, sessionId, selected, onSelect, drafts = {}, onEdit, onSaved }) => {
  const [showTree, setShowTree] = useState(!selected)
  const [content, setContent] = useState<{ path?: string; preview?: WorkspaceFilePreview; error?: string; loading?: boolean }>({})
  const [mediaUrl, setMediaUrl] = useState<string | null>(null)
  const [diagnostics, setDiagnostics] = useState<{ data?: WorkspaceDiagnostics; loading?: boolean; error?: string; text?: string }>({})
  const [editorSettings, setEditorSettings] = useState(loadEditorSettings)
  const [highlighted, setHighlighted] = useState<{ text: string; html: string } | null>(null)
  const highlightWorkerRef = useRef<Worker | null>(null)
  const highlightJobRef = useRef<{ id: number; busy: boolean; pending: HighlightJob | null }>({ id: 0, busy: false, pending: null })
  const codeRef = useRef<HTMLTextAreaElement>(null)
  const highlightRef = useRef<HTMLPreElement>(null)
  const diagnosticRef = useRef<HTMLPreElement>(null)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState('')
  const draft = folderPath && selected ? drafts[JSON.stringify([folderPath, selected])] : undefined
  const activePreview = content.path === selected ? content.preview : undefined
  const original = activePreview?.kind === 'text' ? activePreview.text : undefined
  const editorText = draft?.text ?? original?.replace(/\r\n?/g, '\n')
  useEffect(() => {
    const update = () => setEditorSettings(loadEditorSettings())
    window.addEventListener('zipply:editor-settings', update)
    return () => window.removeEventListener('zipply:editor-settings', update)
  }, [])
  const containerRef = useRef<HTMLDivElement>(null)
  const [containerWidth, setContainerWidth] = useState(0)
  const [treeWidth, setTreeWidth] = useState(() => {
    try { const saved = Number(appStorage.getItem('zipply_files_tree_width')); return saved >= 180 && saved <= 1000 ? saved : 260 } catch { return 260 }
  })
  const [resizingTree, setResizingTree] = useState(false)
  const treeWidthRef = useRef(treeWidth)
  const maxTreeWidth = Math.min(1000, Math.max(180, containerWidth ? containerWidth - 240 : 1000))
  const displayedTreeWidth = Math.min(treeWidth, maxTreeWidth)
  treeWidthRef.current = treeWidth
  const setSavedTreeWidth = (value: number) => {
    const next = Math.max(180, Math.min(maxTreeWidth, Math.round(value)))
    treeWidthRef.current = next
    setTreeWidth(next)
    try { appStorage.setItem('zipply_files_tree_width', String(next)) } catch { /* Keep the width for this session. */ }
  }
  useEffect(() => {
    const node = containerRef.current
    if (!node) return
    const observer = new ResizeObserver(entries => setContainerWidth(entries[0].contentRect.width))
    observer.observe(node)
    return () => observer.disconnect()
  }, [folderPath])
  useEffect(() => {
    if (!resizingTree) return
    let frame = 0
    const move = (event: PointerEvent) => {
      const bounds = containerRef.current?.getBoundingClientRect()
      if (bounds) {
        treeWidthRef.current = Math.max(180, Math.min(1000, Math.max(180, bounds.width - 240), Math.round(bounds.right - event.clientX)))
        if (!frame) frame = requestAnimationFrame(() => { frame = 0; setTreeWidth(treeWidthRef.current) })
      }
    }
    const stop = () => { if (frame) cancelAnimationFrame(frame); frame = 0; setTreeWidth(treeWidthRef.current); setResizingTree(false); try { appStorage.setItem('zipply_files_tree_width', String(treeWidthRef.current)) } catch { /* Keep the width for this session. */ } }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', stop)
    window.addEventListener('pointercancel', stop)
    window.addEventListener('blur', stop)
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
    return () => { if (frame) cancelAnimationFrame(frame); window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', stop); window.removeEventListener('pointercancel', stop); window.removeEventListener('blur', stop); document.body.style.cursor = ''; document.body.style.userSelect = '' }
  }, [resizingTree])
  const selectFile = useCallback((path: string) => { onSelect(path); setShowTree(false) }, [onSelect])
  const [retry, setRetry] = useState(0)
  const [refresh, setRefresh] = useState(0)
  const draftRef = useRef(draft)
  draftRef.current = draft
  const previewTargetRef = useRef<{ folderPath?: string; selected?: string; retry: number }>({ retry: 0 })
  useEffect(() => {
    if (!folderPath) return
    const api = window.api?.workspace
    if (!api?.watch || !api.onUpdated) return
    api.watch(folderPath)
    const unsubscribe = api.onUpdated(payload => {
      if (isSameWatchFolder(payload.folderPath, folderPath)) {
        setRefresh(value => value + 1)
      }
    })
    return () => {
      unsubscribe()
      api.unwatch?.(folderPath)
    }
  }, [folderPath])
  useEffect(() => {
    const isTargetChange =
      previewTargetRef.current.folderPath !== folderPath ||
      previewTargetRef.current.selected !== selected ||
      previewTargetRef.current.retry !== retry
    previewTargetRef.current = { folderPath, selected, retry }
    if (!folderPath || !selected) { setContent({}); return }
    if (!isTargetChange && draftRef.current) return
    let live = true
    if (isTargetChange) {
      setContent({ path: selected, loading: true })
      setSaveError('')
    }
    const loadPreview = window.api.workspace.readPreview
      ? window.api.workspace.readPreview(folderPath, selected)
      : window.api.workspace.readText(folderPath, selected).then(result =>
          result.data !== undefined
            ? { data: { kind: 'text', text: result.data, size: result.data.length } as WorkspaceFilePreview }
            : { error: result.error || 'Не удалось прочитать файл.' }
        )
    loadPreview.then(result => {
      if (!live) return
      if (!isTargetChange && draftRef.current) return
      setContent(previous => {
        if (result.error) return { path: selected, error: result.error }
        if (result.data && previous.path === selected && !previous.error && !previous.loading && previewsEqual(previous.preview, result.data)) {
          return previous
        }
        return { path: selected, preview: result.data }
      })
    }).catch(() => {
      if (!live) return
      if (!isTargetChange && draftRef.current) return
      setContent({ path: selected, error: 'Не удалось прочитать файл.' })
    })
    return () => { live = false }
  }, [folderPath, selected, retry, refresh])
  useEffect(() => {
    if (!activePreview || (activePreview.kind !== 'image' && activePreview.kind !== 'video')) {
      setMediaUrl(null)
      return
    }
    const url = URL.createObjectURL(new Blob([new Uint8Array(activePreview.bytes)], { type: activePreview.mime }))
    setMediaUrl(url)
    return () => { URL.revokeObjectURL(url) }
  }, [activePreview])
  useEffect(() => {
    if (!editorSettings.diagnostics || !folderPath || !selected || original === undefined || editorText === undefined) { setDiagnostics({}); return }
    if (editorText.length > 200_000) { setDiagnostics({ error: 'Проверка отключена для файлов больше 200 000 символов.' }); return }
    let live = true
    let started = false
    setDiagnostics({ loading: true })
    const timer = window.setTimeout(() => {
      started = true
      window.api.workspace.diagnostics(folderPath, selected, true, editorText).then(result => {
        if (live) setDiagnostics(result.error ? { error: result.error, text: editorText } : { data: result.data, text: editorText })
      }).catch(() => { if (live) setDiagnostics({ error: 'Не удалось выполнить проверку.' }) })
    }, editorSettings.delay)
    return () => { live = false; window.clearTimeout(timer); if (started) window.api.workspace.cancelDiagnostics() }
  }, [folderPath, selected, original, editorText, editorSettings.diagnostics, editorSettings.delay])
  useEffect(() => {
    let worker: Worker
    try { worker = new Worker(new URL('./highlight.worker.ts', import.meta.url), { type: 'module' }) }
    catch { return }
    highlightWorkerRef.current = worker
    const queue = highlightJobRef.current
    worker.onmessage = (event: MessageEvent<{ id: number; text: string; html: string | null }>) => {
      if (event.data.id === queue.id && event.data.html !== null) setHighlighted({ text: event.data.text, html: event.data.html })
      const next = queue.pending
      queue.pending = null
      if (next) worker.postMessage(next)
      else queue.busy = false
    }
    worker.onerror = () => { worker.terminate(); highlightWorkerRef.current = null; queue.busy = false; queue.pending = null }
    return () => { worker.terminate(); highlightWorkerRef.current = null; queue.busy = false; queue.pending = null }
  }, [])
  useEffect(() => {
    const queue = highlightJobRef.current
    const id = ++queue.id
    queue.pending = null
    setHighlighted(null)
    if (!selected || editorText === undefined || editorText.length > 120_000) return
    const timer = window.setTimeout(() => {
      const worker = highlightWorkerRef.current
      if (!worker) return
      const job = { id, file: selected, text: editorText }
      if (queue.busy) queue.pending = job
      else { queue.busy = true; worker.postMessage(job) }
    }, 250)
    return () => window.clearTimeout(timer)
  }, [selected, editorText])
  const lineNumbers = useMemo(() => {
    if (editorText === undefined) return ''
    let count = 1
    for (let i = 0; i < editorText.length; i++) if (editorText.charCodeAt(i) === 10 && ++count > 20_000) return ''
    return Array.from({ length: count }, (_, i) => String(i + 1)).join('\n')
  }, [editorText])
  const currentDiagnostics = diagnostics.text === editorText ? diagnostics.data : undefined
  const markerItems = useMemo(() => {
    if (!editorSettings.markers || !currentDiagnostics?.supported) return []
    const byLine = new Map<number, typeof currentDiagnostics.items[number]>()
    for (const item of currentDiagnostics.items) if (item.line > 0 && !byLine.has(item.line)) byLine.set(item.line, item)
    return [...byLine.values()]
  }, [currentDiagnostics, editorSettings.markers])
  const underlines = useMemo(() => editorSettings.markers && editorText && currentDiagnostics?.supported && currentDiagnostics.items.length ? diagnosticSpans(editorText, currentDiagnostics.items) : [], [editorText, currentDiagnostics, editorSettings.markers])
  const goToDiagnostic = (line: number, column: number) => {
    const input = codeRef.current
    if (!input) return
    const lines = input.value.split('\n')
    const index = Math.min(lines.length - 1, Math.max(0, line - 1))
    let offset = 0
    for (let i = 0; i < index; i++) offset += lines[i].length + 1
    offset += Math.min(lines[index].length, Math.max(0, column - 1))
    input.focus(); input.setSelectionRange(offset, offset); input.scrollTop = Math.max(0, (line - 3) * 24)
    if (highlightRef.current) highlightRef.current.scrollTop = input.scrollTop
    if (diagnosticRef.current) diagnosticRef.current.scrollTop = input.scrollTop
  }
  const save = useCallback(async () => {
    if (!folderPath || !selected || !draft || saving) return
    const expected = draft.original, text = draft.text
    const endings = new Set(expected.match(/\r\n|\r|\n/g) || [])
    if (endings.size > 1) { setSaveError('В файле смешаны типы перевода строк. Сохранение отменено, чтобы не изменить их.'); return }
    const ending = endings.values().next().value || '\n'
    const saved = ending === '\n' ? text : text.replace(/\n/g, ending)
    setSaving(true); setSaveError('')
    try {
      const result = await window.api.workspace.writeText(folderPath, selected, expected, saved, sessionId)
      if (result.error) { setSaveError(result.error); return }
      onSaved?.(folderPath, selected, expected, saved, text)
      setContent(previous => previous.path === selected ? { path: selected, preview: { kind: 'text', text: saved, size: saved.length } } : previous)
    } catch { setSaveError('Не удалось сохранить файл.') }
    finally { setSaving(false) }
  }, [folderPath, sessionId, selected, draft, saving, onSaved])
  const revealSelected = useCallback(() => {
    if (!folderPath || !selected) return
    if (window.api.workspace.revealFile) {
      void window.api.workspace.revealFile(folderPath, selected)
    } else {
      void window.api.workspace.openFolder(folderPath)
    }
  }, [folderPath, selected])
  if (!folderPath) return <p className="m-auto px-5 text-center text-[15px] text-secondary">Рабочая папка чата ещё не готова.</p>
  const rootName = folderPath.replace(/[\\/]+$/, '').split(/[\\/]/).pop() || folderPath
  return <div ref={containerRef} style={{ '--workspace-tree-width': `${displayedTreeWidth}px` } as React.CSSProperties} className={`workspace-files flex min-h-0 min-w-0 flex-1 ${resizingTree ? 'workspace-files-resizing' : ''} ${selected && !showTree ? 'workspace-files-selected' : ''}`}>
    <aside aria-label="Файлы проекта" className="workspace-files-tree flex min-h-0 min-w-0 flex-col bg-surface-secondary rounded-[20px] m-2">
      <div className="flex h-14 shrink-0 items-center gap-2 px-4"><Folder size={17} className="shrink-0 text-secondary" /><span className="min-w-0 flex-1 truncate text-[15px] font-medium text-primary" title={folderPath}>{rootName}</span><button type="button" aria-label="Обновить файлы" title="Обновить файлы" onClick={() => setRefresh(value => value + 1)} className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border-none text-secondary hover:bg-hover cursor-pointer"><RefreshCw size={15} /></button></div>
      <p className="px-4 pb-2 text-[12.5px] font-semibold text-secondary opacity-80">Все файлы</p>
      <div className="min-h-0 flex-1 overflow-auto px-1 pb-3"><Directory root={folderPath} path="" depth={0} selected={selected || null} onSelect={selectFile} refresh={refresh} /></div>
    </aside>
    <div role="separator" aria-label="Изменить ширину списка файлов" aria-orientation="vertical" aria-valuemin={180} aria-valuemax={maxTreeWidth} aria-valuenow={displayedTreeWidth} tabIndex={0} title="Перетащите для изменения ширины; двойной щелчок — сброс" className="workspace-files-resizer" onPointerDown={event => { if (event.button !== 0) return; event.preventDefault(); setResizingTree(true) }} onDoubleClick={() => setSavedTreeWidth(260)} onKeyDown={event => { if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') { event.preventDefault(); setSavedTreeWidth(displayedTreeWidth + (event.key === 'ArrowLeft' ? 16 : -16)) } else if (event.key === 'Home') { event.preventDefault(); setSavedTreeWidth(180) } else if (event.key === 'End') { event.preventDefault(); setSavedTreeWidth(maxTreeWidth) } }} />
    <div className="workspace-files-preview flex min-h-0 min-w-0 flex-1 flex-col rounded-[20px] bg-canvas m-2 ml-0">
      {selected ? <>
        <div className="flex h-14 shrink-0 items-center gap-2 px-3">
          <button type="button" aria-label="Назад к файлам" title="Назад к файлам" onClick={() => setShowTree(true)} className="workspace-files-back h-8 w-8 items-center justify-center rounded-full border-none text-secondary hover:bg-hover cursor-pointer"><ArrowLeft size={17} /></button>
          <div className="flex h-[34px] min-w-0 flex-1 items-center gap-2 rounded-full bg-surface px-3" title={selected}>
            <span aria-hidden="true" className="flex shrink-0"><VSCodeFileIcon filename={selected.split(/[\\/]/).pop()} size={16} /></span>
            <span className="min-w-0 truncate text-[14px] text-secondary">{selected.replace(/\\/g, '/').split('/').join(' / ')}</span>
          </div>
          {draft && <span className="text-[12px] text-secondary" title="Есть несохранённые изменения">●</span>}
          <button type="button" onClick={revealSelected} title="Открыть в проводнике" aria-label="Открыть в проводнике" className="flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded-full border-none bg-control text-secondary hover:bg-control-hover hover:text-primary cursor-pointer transition-colors"><FolderOpen size={15} /></button>
          {activePreview?.kind === 'text' && <button type="button" disabled={!draft || saving || original === undefined} onClick={() => void save()} className="h-[34px] shrink-0 rounded-full border-none bg-control px-3.5 text-[13px] text-primary hover:bg-control-hover disabled:opacity-40 cursor-pointer disabled:cursor-default">{saving ? 'Сохранение…' : 'Сохранить'}</button>}
        </div>
        {saveError && <p role="alert" className="px-4 pb-2 text-[13px] text-secondary">{saveError}</p>}
        {content.path !== selected || content.loading ? <p className="p-4 text-[14px] text-secondary">Загрузка…</p> : content.error ? <div className="p-4 text-[14px] leading-6 text-secondary"><p>Не удалось открыть файл: {content.error}</p><button type="button" onClick={() => setRetry(value => value + 1)} className="mt-2 rounded-full border-none text-primary underline cursor-pointer">Повторить</button></div> : activePreview?.kind === 'image' ? (
          <div className="flex min-h-0 flex-1 flex-col items-center justify-center rounded-[16px] bg-surface-secondary mx-2 mb-2 p-4 overflow-hidden">
            {mediaUrl && <img src={mediaUrl} alt={selected.split(/[\\/]/).pop() || selected} className="max-h-full max-w-full rounded-[12px] object-contain select-none" />}
            <span className="mt-2 text-[12px] text-secondary">{formatFileSize(activePreview.size)}</span>
          </div>
        ) : activePreview?.kind === 'video' ? (
          <div className="flex min-h-0 flex-1 flex-col items-center justify-center rounded-[16px] bg-surface-secondary mx-2 mb-2 p-4 overflow-hidden">
            {mediaUrl && <video src={mediaUrl} controls playsInline preload="metadata" controlsList="nodownload" disablePictureInPicture className="max-h-full max-w-full rounded-[12px] bg-black" />}
            <span className="mt-2 text-[12px] text-secondary">{formatFileSize(activePreview.size)}</span>
          </div>
        ) : activePreview?.kind === 'too-large' || activePreview?.kind === 'binary' ? (
          <div className="m-auto flex max-w-sm flex-col items-center gap-3 rounded-[20px] bg-surface p-6 text-center">
            <FileCode2 size={26} strokeWidth={1.5} className="text-secondary" />
            <div className="text-[15px] font-medium text-primary break-all">{selected.split(/[\\/]/).pop()}</div>
            <p className="text-[13.5px] leading-5 text-secondary">
              {activePreview.kind === 'too-large'
                ? `Файл слишком большой для встроенного просмотра (${formatFileSize(activePreview.size)} при лимите ${formatFileSize(activePreview.maxSize)}).`
                : `Бинарный файл (${formatFileSize(activePreview.size)}) нельзя открыть как текст.`}
            </p>
            <button type="button" onClick={revealSelected} className="mt-1 inline-flex items-center gap-2 rounded-full border-none bg-accent hover:bg-accent-hover px-5 py-2 text-[14px] font-medium text-on-accent cursor-pointer active:scale-95 transition-colors">
              <FolderOpen size={15} />
              <span>Открыть в проводнике</span>
            </button>
          </div>
        ) : <>
          <div className="workspace-editor min-h-0 flex-1">
            <pre ref={highlightRef} aria-hidden="true" className="workspace-editor-highlight"><span className="workspace-editor-gutter"><span className="workspace-code-lines">{lineNumbers}</span>{markerItems.map(item => <span key={item.line} className={`workspace-diagnostic-marker ${item.category === 'Error' ? 'is-error' : 'is-warning'}`} style={{ top: `${(item.line - 1) * 24 + 9}px` }} />)}</span>{!highlighted || highlighted.text !== editorText ? <code>{editorText}</code> : <code dangerouslySetInnerHTML={{ __html: highlighted.html }} />}{'\n'}</pre>
            <pre ref={diagnosticRef} aria-hidden="true" className="workspace-editor-diagnostics">{underlines.map((part, index) => part.category ? <span key={index} className={`workspace-diagnostic-underline ${part.category === 'Error' ? 'is-error' : 'is-warning'}`}>{part.text}</span> : part.text)}{'\n'}</pre>
            <textarea ref={codeRef} aria-label="Редактор файла" spellCheck={false} wrap="off" value={editorText ?? ''} onChange={event => { if (original !== undefined) onEdit?.(folderPath, selected, original, event.target.value) }} onScroll={event => { for (const layer of [highlightRef.current, diagnosticRef.current]) if (layer) { layer.scrollTop = event.currentTarget.scrollTop; layer.scrollLeft = event.currentTarget.scrollLeft } }} onKeyDown={event => { if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') { event.preventDefault(); void save() } else if (event.key === 'Tab' && !event.shiftKey && !event.ctrlKey && !event.metaKey && original !== undefined) { event.preventDefault(); const input = event.currentTarget; const start = input.selectionStart; const next = input.value.slice(0, start) + '  ' + input.value.slice(input.selectionEnd); onEdit?.(folderPath, selected, original, next); requestAnimationFrame(() => { input.selectionStart = input.selectionEnd = start + 2 }) } }} className="workspace-editor-input" />
          </div>
          <div className="workspace-diagnostics shrink-0 mx-2 mb-2 rounded-[14px] px-3 py-2 text-[13px] leading-[20px] text-secondary" aria-live="polite">{!editorSettings.diagnostics ? 'Проверка выключена в настройках' : diagnostics.loading ? 'Проверка…' : diagnostics.error ? `Проверка недоступна: ${diagnostics.error}` : currentDiagnostics && !currentDiagnostics.supported ? currentDiagnostics.reason : currentDiagnostics && currentDiagnostics.items.length === 0 ? (currentDiagnostics.scope === 'syntax' ? 'Ошибок синтаксиса не найдено' : 'Ошибок не найдено') : currentDiagnostics && <details className="workspace-problems"><summary className="flex min-h-8 cursor-pointer list-none items-center gap-2 rounded-full px-2 text-[14px] font-medium text-primary hover:bg-hover"><CircleAlert size={16} className="shrink-0 text-diff-remove" /><span>Проблемы</span><span className="rounded-full bg-control px-2 text-[12px] leading-5 text-secondary">{currentDiagnostics.items.length}{currentDiagnostics.truncated ? '+' : ''}</span><ChevronDown size={15} className="workspace-problems-chevron ml-auto text-secondary" /></summary><ul className="mt-1 max-h-44 list-none space-y-1 overflow-auto p-0">{currentDiagnostics.items.map((item, index) => <li key={`${item.line}:${item.column}:${index}`}><button type="button" onClick={() => goToDiagnostic(item.line, item.column)} className="flex w-full items-start gap-3 rounded-[12px] border-none px-3 py-2.5 text-left text-secondary hover:bg-hover cursor-pointer"><span className="mt-0.5 shrink-0 rounded-full bg-control px-2 py-0.5 font-mono text-[12px] leading-5 text-primary">{item.line}:{item.column}</span><span className="min-w-0 text-[13.5px] leading-[21px]">{item.message}</span></button></li>)}</ul></details>}</div>
        </>}
      </> : <div className="m-auto flex flex-col items-center gap-3 px-4 text-center text-[14px] text-secondary"><FileCode2 size={24} strokeWidth={1.4} /><span>Выберите файл для просмотра</span></div>}
    </div>
  </div>
}

export const WorkspaceFiles = React.memo(WorkspaceFilesView)
