import React, { useCallback, useEffect, useRef, useState } from 'react'
import { Bot } from 'lucide-react'
import { Plus, X, Folder, Terminal, GitCompareArrows, Pin } from '../../icons'
import type { WorkspaceTab } from '../../hooks/useWorkspaceTabs'
import { WorkspaceFiles } from './WorkspaceFiles'
import type { FileDraft } from './WorkspaceFiles'
import { WorkspaceTerminal, type AiTerminalSelection } from './WorkspaceTerminal'
import { WorkspaceChanges } from './WorkspaceChanges'
import { VSCodeFileIcon } from '../tools/VSCodeFileIcon'
import { SubagentActivityPanel } from '../chat/SubagentActivityPanel'

function revealTab(list: HTMLElement, tab: HTMLElement): void {
  const bounds = list.getBoundingClientRect()
  const rect = tab.getBoundingClientRect()
  if (tab.hasAttribute('data-fixed-terminal-tab')) return
  const fixedWidth = list.querySelector('[data-fixed-terminal-tab]')?.getBoundingClientRect().width ?? 0
  const visibleLeft = bounds.left + fixedWidth
  const offset = rect.left < visibleLeft ? rect.left - visibleLeft - 4 : rect.right > bounds.right ? rect.right - bounds.right + 4 : 0
  if (offset) list.scrollBy({ left: offset, behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' })
}

interface WorkspacePanelProps {
  width: number
  maxWidth: number
  replace: boolean
  resizing: boolean
  onStartResize: () => void
  onResetWidth: () => void
  onSetWidth: (width: number) => void
  tabs: WorkspaceTab[]
  activeTabId: string | null
  folderPath?: string
  sessionId?: string
  terminalSelection?: AiTerminalSelection
  onSelectTerminal?: (selection: AiTerminalSelection) => void
  onChooseFiles: (id: string) => void
  onChooseTerminal?: (id: string) => void
  onChooseChanges?: (id: string) => void
  onChooseSubagents?: (id: string) => void
  onChooseFile: (id: string, sessionId: string, folderPath: string, path: string) => void
  onOpenFileInFiles?: (path: string) => void
  fileDrafts?: Record<string, FileDraft>
  onEditFile?: (folder: string, file: string, original: string, text: string) => void
  onSavedFile?: (folder: string, file: string, original: string, saved: string, text: string) => void
  onAddTab: () => void
  onAddFilesTab?: () => void
  onAddTerminalTab?: () => void
  onAddChangesTab?: () => void
  onAddSubagentsTab?: () => void
  onSelectTab: (id: string) => void
  onCloseTab: (id: string) => void
  onTogglePinTab?: (id: string) => void
  onMoveTab: (id: string, targetId: string, after: boolean) => void
}

const WorkspacePanelView: React.FC<WorkspacePanelProps> = ({ width, maxWidth, replace, resizing, onStartResize, onResetWidth, onSetWidth, tabs, activeTabId, folderPath, sessionId, terminalSelection, onSelectTerminal, fileDrafts = {}, onEditFile, onSavedFile, onChooseFiles, onChooseTerminal, onChooseChanges, onChooseSubagents, onChooseFile, onOpenFileInFiles, onAddTab, onAddFilesTab, onAddTerminalTab, onAddChangesTab, onAddSubagentsTab, onSelectTab, onCloseTab, onTogglePinTab, onMoveTab }) => {
  const [tabMenu, setTabMenu] = useState<{ id: string; x: number; y: number } | null>(null)
  const [activeSubagentCount, setActiveSubagentCount] = useState(0)
  useEffect(() => {
    if (!tabMenu) return
    const close = () => setTabMenu(null)
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setTabMenu(null) }
    window.addEventListener('click', close)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('click', close)
      window.removeEventListener('keydown', onKey)
    }
  }, [tabMenu])
  const selectFile = useCallback((path: string) => {
    if (activeTabId && sessionId && folderPath) onChooseFile(activeTabId, sessionId, folderPath, path)
  }, [activeTabId, sessionId, folderPath, onChooseFile])
  const tabListRef = useRef<HTMLDivElement>(null)
  const addButtonRef = useRef<HTMLButtonElement>(null)
  const pendingClosures = useRef(new Map<string, number>())
  const [closingTabs, setClosingTabs] = useState<Set<string>>(() => new Set())
  const draggedTab = useRef<string | null>(null)
  const [dragging, setDragging] = useState<string | null>(null)
  const [dropTarget, setDropTarget] = useState<string | null>(null)
  const selectedFile = (tab: WorkspaceTab): string | undefined => {
    const selection = sessionId ? tab.filesBySession?.[sessionId] : undefined
    return selection?.folderPath === folderPath ? selection?.path : undefined
  }
  const titleForTab = (tab: WorkspaceTab): string => {
    if (tab.type === 'subagents') return `Субагенты${activeSubagentCount > 0 ? ` · ${activeSubagentCount}` : ''}`
    return selectedFile(tab)?.split(/[\\/]/).pop() || tab.title
  }
  const activeTab = tabs.find(tab => tab.id === activeTabId)
  const showingSubagents = activeTab?.type === 'subagents'
  useEffect(() => {
    const list = tabListRef.current
    if (!list) return
    let frame = 0
    let target = 0
    let position = 0
    let lastTime = 0
    const step = (time: number) => {
      const factor = 1 - Math.exp(-(time - lastTime) / 90)
      lastTime = time
      target = Math.min(target, Math.max(0, list.scrollWidth - list.clientWidth))
      position += (target - position) * factor
      list.scrollLeft = position
      if (Math.abs(target - position) < 0.5) { list.scrollLeft = target; frame = 0; return }
      frame = requestAnimationFrame(step)
    }
    const onWheel = (event: WheelEvent) => {
      if (!event.deltaY || Math.abs(event.deltaX) > Math.abs(event.deltaY)) return
      const max = list.scrollWidth - list.clientWidth
      if (max <= 0) return
      event.preventDefault()
      const delta = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? list.clientWidth : 1)
      target = Math.max(0, Math.min(max, (frame ? target : list.scrollLeft) + delta))
      if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
        cancelAnimationFrame(frame); frame = 0; list.scrollLeft = target
      } else if (!frame) {
        position = list.scrollLeft
        lastTime = performance.now()
        frame = requestAnimationFrame(step)
      }
    }
    list.addEventListener('wheel', onWheel, { passive: false })
    return () => { list.removeEventListener('wheel', onWheel); cancelAnimationFrame(frame) }
  }, [])
  useEffect(() => () => {
    for (const [id, timer] of pendingClosures.current) { window.clearTimeout(timer); onCloseTab(id) }
    pendingClosures.current.clear()
  }, [onCloseTab])
  useEffect(() => {
    const list = tabListRef.current
    const selected = activeTabId && document.getElementById(`workspace-tab-${activeTabId}`)
    if (!list || !selected) return
    if (selected.parentElement) revealTab(list, selected.parentElement)
  }, [activeTabId])
  const closeTab = (tab: WorkspaceTab, index: number, restoreFocus: boolean): void => {
    if (pendingClosures.current.has(tab.id)) return
    const next = activeTabId === tab.id ? tabs[index + 1] || tabs[index - 1] : tabs.find(item => item.id === activeTabId)
    const finish = () => {
      pendingClosures.current.delete(tab.id)
      setClosingTabs(previous => { const updated = new Set(previous); updated.delete(tab.id); return updated })
      onCloseTab(tab.id)
      if (restoreFocus) requestAnimationFrame(() => next ? document.getElementById(`workspace-tab-${next.id}`)?.focus() : addButtonRef.current?.focus())
    }
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) { finish(); return }
    setClosingTabs(previous => new Set(previous).add(tab.id))
    pendingClosures.current.set(tab.id, window.setTimeout(finish, 180))
  }
  return (
  <section id="workspace-panel" role="region" aria-label="Рабочая панель" data-workspace-mode={replace ? 'replace' : 'split'}
    className="workspace-panel relative h-full min-w-0 shrink-0 overflow-hidden bg-sidebar border-none shadow-none"
    style={{ width: replace ? '100%' : `${width}px` }}>
    {!replace && <div role="separator" aria-label="Изменить ширину рабочей панели" aria-orientation="vertical"
      aria-valuemin={320} aria-valuemax={maxWidth} aria-valuenow={width} tabIndex={0}
      title="Перетащите для изменения ширины; двойной щелчок — сброс"
      onMouseDown={event => { event.preventDefault(); onStartResize() }} onDoubleClick={onResetWidth}
      onKeyDown={event => {
        if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
          event.preventDefault()
          onSetWidth(width + (event.key === 'ArrowLeft' ? 16 : -16))
        } else if (event.key === 'Home') { event.preventDefault(); onSetWidth(320) }
        else if (event.key === 'End') { event.preventDefault(); onSetWidth(maxWidth) }
      }}
      className={`workspace-resizer absolute left-0 top-0 bottom-0 z-[60] w-3 cursor-col-resize ${resizing ? 'select-none' : ''}`} />}
    <div className="flex h-full min-w-0 flex-col">
      <div className="flex h-[56px] shrink-0 min-w-0 items-center justify-start px-3">
        <div className="flex min-w-0 justify-start">
        <div className="flex min-w-0 max-w-full items-center gap-1">
        <div ref={tabListRef} role="tablist" aria-label="Рабочие вкладки"
          className="no-scrollbar flex min-w-0 items-center gap-1 overflow-x-auto">
          {tabs.map((tab, index) => {
            const fixed = tab.type === 'ai-terminal'
            const active = activeTabId === tab.id
            return (
            <div key={tab.id} draggable={!fixed && !closingTabs.has(tab.id)} data-fixed-terminal-tab={fixed ? '' : undefined}
              onDragStart={event => {
                if ((event.target as HTMLElement).closest('[data-close-workspace-tab]')) { event.preventDefault(); return }
                draggedTab.current = tab.id; setDragging(tab.id)
                event.dataTransfer.effectAllowed = 'move'; event.dataTransfer.setData('text/plain', tab.id)
              }}
              onDragOver={event => {
                if (fixed || !draggedTab.current || draggedTab.current === tab.id) return
                event.preventDefault(); event.dataTransfer.dropEffect = 'move'; setDropTarget(tab.id)
                const list = tabListRef.current
                if (list) { const bounds = list.getBoundingClientRect(); if (event.clientX < bounds.left + 30) list.scrollLeft -= 24; else if (event.clientX > bounds.right - 30) list.scrollLeft += 24 }
              }}
              onDrop={event => {
                if (fixed || !draggedTab.current) return
                event.preventDefault()
                const bounds = event.currentTarget.getBoundingClientRect()
                onMoveTab(draggedTab.current, tab.id, event.clientX >= bounds.left + bounds.width / 2)
                draggedTab.current = null; setDragging(null); setDropTarget(null)
              }}
              onDragEnd={() => { draggedTab.current = null; setDragging(null); setDropTarget(null) }}
              onMouseDown={event => { if (!fixed && event.button === 1 && !tab.pinned) { event.preventDefault(); closeTab(tab, index, false) } }}
              onContextMenu={fixed ? undefined : event => { event.preventDefault(); setTabMenu({ id: tab.id, x: event.clientX, y: event.clientY }) }}
              onAnimationEnd={event => { if (event.animationName === 'workspace-tab-enter' && tab.id === activeTabId && tabListRef.current) revealTab(tabListRef.current, event.currentTarget) }}
              className={fixed ? 'sticky left-0 z-10 flex h-[34px] shrink-0 items-center bg-sidebar pr-1' : `workspace-tab ${closingTabs.has(tab.id) ? 'workspace-tab-closing' : ''} ${dragging === tab.id ? 'opacity-40' : ''} ${dropTarget === tab.id ? 'bg-control-hover' : ''} group flex h-[34px] ${tab.pinned ? 'w-auto max-w-[180px]' : 'w-[170px]'} shrink-0 items-center overflow-hidden rounded-[10px] ${active ? 'bg-control text-primary' : 'text-secondary hover:bg-hover'}`}>
              <button type="button" role="tab" id={`workspace-tab-${tab.id}`} aria-selected={active}
                disabled={closingTabs.has(tab.id)}
                aria-controls="workspace-tab-content" aria-keyshortcuts={fixed ? undefined : 'Alt+Shift+ArrowLeft Alt+Shift+ArrowRight Delete'} tabIndex={active ? 0 : -1} title={fixed ? 'Закреплённый терминал Zipply' : `${titleForTab(tab)} · ПКМ — закрепить`} onClick={() => onSelectTab(tab.id)}
                onKeyDown={event => {
                  if (event.key === 'Delete' && !fixed && !tab.pinned) { event.preventDefault(); closeTab(tab, index, true); return }
                  if (event.altKey && event.shiftKey && (event.key === 'ArrowLeft' || event.key === 'ArrowRight')) {
                    event.preventDefault()
                    const direction = event.key === 'ArrowLeft' ? -1 : 1
                    const target = tabs[index + direction]
                    if (!fixed && target && target.type !== 'ai-terminal') onMoveTab(tab.id, target.id, direction > 0)
                    return
                  }
                  if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
                  event.preventDefault()
                  const nextIndex = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : (index + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length
                  const next = tabs[nextIndex]
                  onSelectTab(next.id)
                  document.getElementById(`workspace-tab-${next.id}`)?.focus()
                }}
                className={`h-full min-w-0 flex-1 truncate rounded-full pl-3.5 text-left text-[14px] font-medium border-none shadow-none ${fixed ? `pr-3.5 cursor-pointer ${active ? 'bg-control text-primary' : 'text-secondary hover:bg-hover'}` : 'pr-1 cursor-grab active:cursor-grabbing'}`}>
                <span className="flex min-w-0 items-center gap-2">{tab.type === 'terminal' || fixed ? <Terminal className="shrink-0" size={15} aria-hidden="true" /> : tab.type === 'changes' ? <span className="flex shrink-0" aria-hidden="true"><GitCompareArrows size={14} /></span> : tab.type === 'subagents' ? <Bot className="shrink-0" size={15} aria-hidden="true" /> : selectedFile(tab) && <span className="flex shrink-0" aria-hidden="true"><VSCodeFileIcon filename={selectedFile(tab)!.split(/[\\/]/).pop()} size={15} /></span>}<span className="truncate">{titleForTab(tab)}</span>{folderPath && selectedFile(tab) && fileDrafts[JSON.stringify([folderPath, selectedFile(tab)])] && <span className="shrink-0 text-[10px]" aria-label="Есть несохранённые изменения">●</span>}</span>
              </button>
              {!fixed && (tab.pinned ? (
                <button type="button" draggable={false} aria-label={`Открепить вкладку ${tab.title}`} title="Открепить вкладку" onClick={() => onTogglePinTab?.(tab.id)}
                  className="workspace-tab-action mr-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-secondary hover:bg-hover-strong hover:text-primary border-none shadow-none cursor-pointer">
                  <Pin size={13} strokeWidth={1.8} />
                </button>
              ) : (
                <button type="button" data-close-workspace-tab draggable={false} disabled={closingTabs.has(tab.id)} aria-label={`Закрыть вкладку ${tab.title}`} title="Закрыть вкладку" onClick={event => closeTab(tab, index, event.detail === 0)}
                  className="workspace-tab-action mr-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-secondary hover:bg-hover-strong hover:text-primary border-none shadow-none cursor-pointer">
                  <X size={14} strokeWidth={1.8} />
                </button>
              ))}
            </div>
          )})}
        </div>
        <button ref={addButtonRef} type="button" aria-label="Добавить вкладку" title="Добавить вкладку" onClick={onAddTab}
          className="workspace-tab-action flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded-full text-secondary hover:bg-control hover:text-primary active:scale-95 border-none shadow-none cursor-pointer">
          <Plus size={18} strokeWidth={1.8} />
        </button>
        </div>
        </div>
      </div>
      <div id="workspace-tab-content" role={activeTabId ? 'tabpanel' : undefined} aria-labelledby={activeTabId ? `workspace-tab-${activeTabId}` : undefined}
        className="flex min-h-0 flex-1 border-none shadow-none">
        <div className={showingSubagents ? 'flex min-h-0 min-w-0 flex-1' : 'hidden'}>
          <SubagentActivityPanel sessionId={sessionId} onActiveCountChange={setActiveSubagentCount} />
        </div>
        {!showingSubagents && (activeTab?.type === 'files'
          ? <WorkspaceFiles key={`${activeTabId}:${sessionId}:${folderPath}`} folderPath={folderPath} sessionId={sessionId} selected={selectedFile(activeTab)} drafts={fileDrafts} onEdit={onEditFile} onSaved={onSavedFile} onSelect={selectFile} />
          : activeTab?.type === 'terminal'
            ? <WorkspaceTerminal key={JSON.stringify(['user', activeTabId, sessionId, folderPath])} mode="user" tabId={activeTabId!} sessionId={sessionId} folderPath={folderPath} />
            : activeTab?.type === 'ai-terminal'
              ? <WorkspaceTerminal key={JSON.stringify(['ai', sessionId, folderPath])} mode="ai" tabId={activeTabId!} sessionId={sessionId} folderPath={folderPath} selection={terminalSelection} onSelect={onSelectTerminal} />
              : activeTab?.type === 'changes'
                ? <WorkspaceChanges key={`changes:${activeTabId}:${sessionId}:${folderPath}`} folderPath={folderPath} sessionId={sessionId} onOpenFileInFiles={onOpenFileInFiles} />
                : <div className="m-auto w-full max-w-[320px] px-5">
                    <p className="mb-4 text-[15px] text-secondary">Выберите, что открыть</p>
                    <div className="flex flex-col gap-1">
                      <button type="button" onClick={() => activeTabId ? onChooseFiles(activeTabId) : onAddFilesTab?.()} className="flex h-12 items-center gap-3 rounded-[14px] border-none px-3 text-left text-[16px] text-primary hover:bg-hover cursor-pointer"><Folder size={18} />Файлы</button>
                      <button type="button" onClick={() => activeTabId ? onChooseTerminal?.(activeTabId) : onAddTerminalTab?.()} className="flex h-12 items-center gap-3 rounded-[14px] border-none px-3 text-left text-[16px] text-primary hover:bg-hover cursor-pointer"><Terminal size={18} />Терминал</button>
                      <button type="button" onClick={() => activeTabId ? onChooseChanges?.(activeTabId) : onAddChangesTab?.()} className="flex h-12 items-center gap-3 rounded-[14px] border-none px-3 text-left text-[16px] text-primary hover:bg-hover cursor-pointer"><GitCompareArrows size={18} />Изменения</button>
                      <button type="button" onClick={() => activeTabId ? onChooseSubagents?.(activeTabId) : onAddSubagentsTab?.()} className="flex h-12 items-center gap-3 rounded-[14px] border-none px-3 text-left text-[16px] text-primary hover:bg-hover focus-visible:outline-none cursor-pointer"><Bot size={18} />Субагенты</button>
                    </div>
                  </div>)}
      </div>
    </div>
    {tabMenu && (() => {
      const target = tabs.find(t => t.id === tabMenu.id)
      if (!target) return null
      return (
        <div
          role="menu"
          style={{ left: Math.min(tabMenu.x, window.innerWidth - 180), top: Math.min(tabMenu.y, window.innerHeight - 100) }}
          className="fixed z-[100] min-w-[160px] rounded-[14px] bg-surface/95 p-1 backdrop-blur-md border-[0.5px] border-white/[0.03] shadow-none"
        >
          <button
            type="button"
            role="menuitem"
            onClick={() => { onTogglePinTab?.(target.id); setTabMenu(null) }}
            className="flex h-9 w-full items-center gap-2.5 rounded-[10px] px-3 text-left text-[14px] text-primary hover:bg-hover border-none shadow-none cursor-pointer"
          >
            <Pin size={14} strokeWidth={1.8} />
            {target.pinned ? 'Открепить' : 'Закрепить'}
          </button>
          {!target.pinned && (
            <button
              type="button"
              role="menuitem"
              onClick={() => { const idx = tabs.findIndex(t => t.id === target.id); if (idx >= 0) closeTab(target, idx, false); setTabMenu(null) }}
              className="flex h-9 w-full items-center gap-2.5 rounded-[10px] px-3 text-left text-[14px] text-secondary hover:bg-hover hover:text-primary border-none shadow-none cursor-pointer"
            >
              <X size={14} strokeWidth={1.8} />
              Закрыть
            </button>
          )}
        </div>
      )
    })()}
  </section>
  )
}

export const WorkspacePanel = React.memo(WorkspacePanelView)

