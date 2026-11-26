import React from 'react'
import { PanelLeft, PanelRight, Folder, FolderOpen } from '../icons'
import { useWindowControls } from '../hooks/useWindowControls'
import { ChatSession } from '../types/chat'
import packageJson from '../../../../package.json'

interface TitleBarProps {
  isSidebarOpen?: boolean
  sidebarWidth?: number | string
  isResizing?: boolean
  onToggleSidebar?: () => void
  onCreateChat?: () => void
  showNewChat?: boolean
  activeSession?: ChatSession
  onChangeFolder?: () => void
  onOpenFolder?: () => void
  isWorkspaceOpen?: boolean
  onToggleWorkspace?: () => void
}

function formatFolderDisplay(folderPath?: string): string {
  if (!folderPath) return 'Папка проекта'
  const normalized = folderPath.replace(/\\/g, '/')
  const parts = normalized.split('/').filter(Boolean)
  if (parts.length >= 2) {
    return `${parts[parts.length - 2]}/${parts[parts.length - 1]}`
  }
  return parts[parts.length - 1] || folderPath
}

// SRP: Pure display component. All window logic and state live in useWindowControls.
const TitleBarView: React.FC<TitleBarProps> = ({
  isSidebarOpen = true,
  sidebarWidth = 260,
  isResizing = false,
  onToggleSidebar,
  activeSession,
  onChangeFolder,
  onOpenFolder,
  isWorkspaceOpen = false,
  onToggleWorkspace
}) => {
  const { close, minimize, maximize } = useWindowControls()

  return (
    <div
      className="w-full h-10 flex items-center select-none shrink-0 bg-sidebar"
      style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
    >
      {/* Sidebar top header area — perfectly aligns with the sidebar width */}
      <div
        style={{
          width: isSidebarOpen ? (typeof sidebarWidth === 'number' ? `${sidebarWidth}px` : sidebarWidth) : '44px',
          WebkitAppRegion: 'no-drag'
        } as React.CSSProperties}
        className={`h-full flex items-center justify-between px-3 shrink-0 ${
          isResizing ? '' : 'transition-[width] duration-250 ease-out'
        }`}
      >
        {/* Toggle sidebar button */}
        {onToggleSidebar && (
          <button
            onClick={onToggleSidebar}
            title={isSidebarOpen ? 'Скрыть панель' : 'Показать панель'}
            aria-label="Toggle Sidebar"
            className="w-8 h-8 rounded-lg flex items-center justify-center text-secondary hover:text-primary hover:bg-hover-strong active:scale-95 transition-all duration-150 focus:outline-none cursor-pointer"
          >
            <PanelLeft size={18} strokeWidth={1.75} />
          </button>
        )}

        {isSidebarOpen && (
          <div className="flex min-w-0 flex-1 items-baseline justify-center gap-1.5 px-1 pointer-events-none">
            <span className="truncate text-[14px] font-semibold tracking-tight text-primary">Zipply</span>
            <span className="shrink-0 text-[10px] font-medium text-secondary">v{packageJson.version}</span>
          </div>
        )}


      </div>

      {/* Draggable space over the chat area with centered workspace pill */}
      <div className="flex-1 h-full flex items-center justify-center min-w-0 px-2 pointer-events-none">
        {activeSession?.folderPath && (
          <div
            style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
            onClick={onChangeFolder}
            title={`Рабочая папка: ${activeSession.folderPath}\nНажмите, чтобы сменить`}
            className="pointer-events-auto flex items-center gap-1.5 h-6 px-2.5 rounded-full bg-hover hover:bg-hover-strong active:scale-[0.98] text-secondary hover:text-primary text-[12px] font-medium transition-all duration-150 cursor-pointer border-none shadow-none group max-w-[280px]"
          >
            <Folder
              size={12.5}
              strokeWidth={1.75}
              className="text-secondary group-hover:text-primary shrink-0 transition-colors"
            />
            <span className="truncate tracking-tight">{formatFolderDisplay(activeSession.folderPath)}</span>
            {onOpenFolder && (
              <span
                role="button"
                onClick={(e) => {
                  e.stopPropagation()
                  onOpenFolder()
                }}
                title="Открыть в проводнике"
                className="ml-0.5 p-0.5 rounded-full hover:bg-hover-strong text-muted hover:text-primary transition-colors"
              >
                <FolderOpen size={11.5} strokeWidth={1.75} />
              </span>
            )}
          </div>
        )}
      </div>

      {/* Window controls */}
      <div
        className="flex items-center gap-1 px-2"
        style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
      >
        {onToggleWorkspace && (
          <button type="button" onClick={onToggleWorkspace}
            aria-label={isWorkspaceOpen ? 'Закрыть рабочую панель' : 'Открыть рабочую панель'}
            aria-expanded={isWorkspaceOpen} aria-controls="workspace-panel"
            title={isWorkspaceOpen ? 'Закрыть рабочую панель' : 'Открыть рабочую панель'}
            className="workspace-toggle w-8 h-8 rounded-full border-none shadow-none flex items-center justify-center text-secondary hover:text-primary hover:bg-hover-strong transition-colors duration-150 cursor-pointer">
            <PanelRight size={18} strokeWidth={1.75} />
          </button>
        )}
        <button
          onClick={minimize}
          aria-label="Minimize"
          title="Свернуть"
          className="w-[26px] h-[26px] rounded-full border-none shadow-none flex items-center justify-center text-secondary hover:text-primary hover:bg-control active:scale-95 transition-colors duration-150 focus:outline-none cursor-pointer"
        >
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" aria-hidden="true">
            <path d="M3 7h8" />
          </svg>
        </button>

        <button
          onClick={maximize}
          aria-label="Maximize"
          title="Развернуть / восстановить"
          className="w-[26px] h-[26px] rounded-full border-none shadow-none flex items-center justify-center text-secondary hover:text-primary hover:bg-control active:scale-95 transition-colors duration-150 focus:outline-none cursor-pointer"
        >
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" aria-hidden="true">
            <rect x="3" y="3" width="8" height="8" rx="1" />
          </svg>
        </button>

        <button
          onClick={close}
          aria-label="Close"
          title="Закрыть"
          className="w-[26px] h-[26px] rounded-full border-none shadow-none flex items-center justify-center text-secondary hover:bg-[#E5484D] hover:text-white active:scale-95 transition-colors duration-150 focus:outline-none cursor-pointer"
        >
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" aria-hidden="true">
            <path d="M3 3l8 8M11 3l-8 8" />
          </svg>
        </button>
      </div>
    </div>
  )
}

export const TitleBar = React.memo(TitleBarView)
