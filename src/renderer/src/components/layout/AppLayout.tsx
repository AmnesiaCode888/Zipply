import React from 'react'
import { TitleBar } from '../TitleBar'
import { SidebarContainer } from './SidebarContainer'
import { ResizerHandle } from './ResizerHandle'
import { ChatSession } from '../../types/chat'
import { WorkspacePanel } from './WorkspacePanel'
import { useWorkspacePanel } from '../../hooks/useWorkspacePanel'
import { useWorkspaceTabs } from '../../hooks/useWorkspaceTabs'
import type { FileDraft } from './WorkspaceFiles'
import { NavigationRail, type NavigationView } from './NavigationRail'
import type { SettingsTab } from '../settings/types'
import { closeWorkspaceTerminalTab, type AiTerminalSelection } from './WorkspaceTerminal'

interface AppLayoutProps {
  isSidebarOpen: boolean
  sidebarWidth: number
  isResizing: boolean
  onToggleSidebar: () => void
  onCreateChat: () => void
  startResizing: (e: React.MouseEvent) => void
  resetWidth: () => void
  sidebar: React.ReactNode
  children: React.ReactNode
  mainView?: NavigationView
  onNavigate: (view: 'chat' | 'schedules' | 'plugins') => void
  onOpenSettings: (tab?: SettingsTab) => void
  activeSession?: ChatSession
  onChangeFolder?: () => void
  onOpenFolder?: () => void
}

export const AppLayout: React.FC<AppLayoutProps> = ({
  isSidebarOpen,
  sidebarWidth,
  isResizing,
  onToggleSidebar,
  onCreateChat,
  startResizing,
  resetWidth,
  sidebar,
  children,
  mainView = 'chat',
  onNavigate,
  onOpenSettings,
  activeSession,
  onChangeFolder,
  onOpenFolder
}) => {
  const workspace = useWorkspacePanel(mainView === 'chat', isSidebarOpen, sidebarWidth)
  const workspaceTabs = useWorkspaceTabs()
  const [terminalSelections, setTerminalSelections] = React.useState<Record<string, AiTerminalSelection>>({})
  const terminalSelectionKey = activeSession ? JSON.stringify([activeSession.id, activeSession.folderPath]) : undefined
  const selectTerminal = React.useCallback((selection: AiTerminalSelection) => {
    if (terminalSelectionKey) setTerminalSelections(previous => ({ ...previous, [terminalSelectionKey]: selection }))
  }, [terminalSelectionKey])
  React.useEffect(() => {
    const onOpenTerminal = (event: Event) => {
      const terminalId: unknown = (event as CustomEvent<{ terminalId?: string }>).detail?.terminalId
      selectTerminal(typeof terminalId === 'string' ? { terminalId } : { section: 'history' })
      workspace.openPanel()
      workspaceTabs.addAiTerminalTab()
    }
    window.addEventListener('zipply:open-terminal', onOpenTerminal)
    return () => window.removeEventListener('zipply:open-terminal', onOpenTerminal)
  }, [selectTerminal, workspace.openPanel, workspaceTabs.addAiTerminalTab])
  const closeTab = React.useCallback((id: string) => {
    closeWorkspaceTerminalTab(id)
    workspaceTabs.closeTab(id)
  }, [workspaceTabs.closeTab])
  const [fileDrafts, setFileDrafts] = React.useState<Record<string, FileDraft>>({})
  const draftKey = (folder: string, file: string) => JSON.stringify([folder, file])
  const editFile = React.useCallback((folder: string, file: string, original: string, text: string) => {
    const key = draftKey(folder, file)
    setFileDrafts(previous => {
      const next = { ...previous }
      const base = previous[key]?.original ?? original
      if (text === base.replace(/\r\n?/g, '\n')) delete next[key]
      else next[key] = { original: base, text }
      return next
    })
  }, [])
  const savedFile = React.useCallback((folder: string, file: string, original: string, saved: string, text: string) => {
    const key = draftKey(folder, file)
    setFileDrafts(previous => {
      const draft = previous[key]
      if (!draft || draft.original !== original) return previous
      const next = { ...previous }
      if (draft.text === text) delete next[key]
      else next[key] = { ...draft, original: saved }
      return next
    })
  }, [])
  React.useEffect(() => {
    if (!Object.keys(fileDrafts).length) return
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = '' }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [fileDrafts])
  const [panelMounted, setPanelMounted] = React.useState(workspace.visible)
  const [panelExpanded, setPanelExpanded] = React.useState(workspace.visible)
  const lastReplace = React.useRef(workspace.replace)
  if (workspace.visible) lastReplace.current = workspace.replace
  React.useEffect(() => {
    if (workspace.visible) {
      setPanelMounted(true)
      let nextFrame = 0
      const frame = requestAnimationFrame(() => { nextFrame = requestAnimationFrame(() => setPanelExpanded(true)) })
      return () => { cancelAnimationFrame(frame); cancelAnimationFrame(nextFrame) }
    }
    setPanelExpanded(false)
    if (mainView !== 'chat' || window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setPanelMounted(false)
      return
    }
    const timer = window.setTimeout(() => setPanelMounted(false), 260)
    return () => window.clearTimeout(timer)
  }, [workspace.visible, mainView])
  const effectiveSidebarOpen = isSidebarOpen && !workspace.hideSidebar
  return (
    <div className="w-screen h-screen p-0 m-0 overflow-hidden bg-sidebar box-border flex flex-col select-none border-none shadow-none">
      {/* Resizing full-screen glass blocker to prevent pointer event trapping during drag */}
      {isResizing && <div className="fixed inset-0 z-50 cursor-col-resize select-none" />}

      {/* Top Title Bar */}
      <TitleBar
        isSidebarOpen={effectiveSidebarOpen}
        sidebarWidth={mainView === 'settings' ? `calc(56px + min(${sidebarWidth}px, 40vw))` : `calc(56px + min(${sidebarWidth}px, max(44px, calc(100vw - 416px))))`}
        isResizing={isResizing || workspace.viewportResizing}
        onToggleSidebar={onToggleSidebar}
        onCreateChat={onCreateChat}
        showNewChat={mainView === 'chat'}
        activeSession={mainView === 'chat' ? activeSession : undefined}
        onChangeFolder={onChangeFolder}
        onOpenFolder={onOpenFolder}
        isWorkspaceOpen={workspace.open}
        onToggleWorkspace={mainView === 'chat' ? workspace.toggle : undefined}
      />

      {/* Main Layout: Sidebar + Resizer + Chat Canvas / Settings */}
      <div className={`flex-1 flex min-h-0 relative overflow-hidden ${mainView === 'settings' ? 'settings-layout' : ''}`}>
        <NavigationRail view={mainView} onNavigate={onNavigate} onSettings={onOpenSettings} />
        <div data-app-frame className="relative flex min-h-0 min-w-0 flex-1 overflow-hidden rounded-[18px] border border-subtle bg-sidebar">
        <SidebarContainer
          isSidebarOpen={effectiveSidebarOpen}
          sidebarWidth={sidebarWidth}
          isResizing={isResizing || workspace.viewportResizing}
          compactSettings={mainView === 'settings'}
        >
          {sidebar}
        </SidebarContainer>

        {effectiveSidebarOpen && (
          <ResizerHandle
            sidebarWidth={mainView === 'settings' ? `min(${sidebarWidth}px, 40vw)` : `min(${sidebarWidth}px, max(44px, calc(100vw - 416px)))`}
            isResizing={isResizing}
            onMouseDown={startResizing as any}
            onDoubleClick={resetWidth}
          />
        )}

        <div data-content-pane className={`flex-1 flex min-w-0 min-h-0 overflow-hidden rounded-[18px] border border-subtle ${workspace.visible && !workspace.replace ? 'workspace-chat' : ''}`} style={{ display: workspace.replace ? 'none' : undefined }}>
          {children}
        </div>
        {panelMounted && mainView === 'chat' && <div className={`workspace-panel-wrap h-full min-w-0 overflow-hidden bg-sidebar ${workspace.resizing || workspace.viewportResizing || (workspace.visible && workspace.replace) ? 'workspace-panel-wrap-resizing' : ''}`} aria-hidden={!workspace.visible || undefined}
          style={{ flex: panelExpanded && lastReplace.current ? '1 1 0%' : '0 0 auto', width: panelExpanded && !lastReplace.current ? `${workspace.displayedWidth}px` : 0, pointerEvents: workspace.visible ? undefined : 'none' }}><WorkspacePanel width={workspace.displayedWidth} maxWidth={workspace.maxWidth}
          replace={lastReplace.current} resizing={workspace.resizing} onStartResize={workspace.startResize}
          onResetWidth={workspace.resetWidth} onSetWidth={workspace.setSavedWidth} tabs={workspaceTabs.tabs}
          activeTabId={workspaceTabs.activeTabId} folderPath={activeSession?.folderPath} sessionId={activeSession?.id} terminalSelection={terminalSelectionKey ? terminalSelections[terminalSelectionKey] : undefined} onSelectTerminal={selectTerminal} fileDrafts={fileDrafts} onEditFile={editFile} onSavedFile={savedFile} onAddTab={workspaceTabs.addTab} onAddFilesTab={workspaceTabs.addFilesTab} onAddTerminalTab={workspaceTabs.addTerminalTab} onAddChangesTab={workspaceTabs.addChangesTab} onAddSubagentsTab={workspaceTabs.addSubagentsTab} onSelectTab={workspaceTabs.selectTab} onCloseTab={closeTab} onTogglePinTab={workspaceTabs.togglePinTab} onMoveTab={workspaceTabs.moveTab} onChooseFiles={workspaceTabs.setTabFiles} onChooseTerminal={workspaceTabs.setTabTerminal} onChooseChanges={workspaceTabs.setTabChanges} onChooseSubagents={workspaceTabs.setTabSubagents} onChooseFile={workspaceTabs.setTabFile} onOpenFileInFiles={activeSession?.id && activeSession?.folderPath ? (path) => workspaceTabs.openFileInFilesTab(activeSession.id, activeSession.folderPath!, path) : undefined} /></div>}
        </div>
      </div>
    </div>
  )
}

