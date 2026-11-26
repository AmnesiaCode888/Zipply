import React from 'react'
import { Paperclip, ListChecks, Folder, FolderOpen, Slash } from '../../icons'

interface ActionDrawerProps {
  isOpen: boolean
  isClosing: boolean
  drawerRef: React.RefObject<HTMLDivElement>
  onAttachClick: () => void
  onPlanClick: () => void
  onCommandsClick?: () => void
  planMode: boolean
  onAgentTeamClick: () => void
  folderPath?: string
  onChangeFolder?: () => void
  onOpenFolder?: () => void
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

export const ActionDrawer: React.FC<ActionDrawerProps> = ({
  isOpen,
  isClosing,
  drawerRef,
  onPlanClick,
  planMode,
  onAttachClick,
  onCommandsClick,
  folderPath,
  onChangeFolder,
  onOpenFolder
}) => {
  if (!isOpen) return null

  return (
    <div
      ref={drawerRef}
      className="absolute left-[24px] right-[24px] z-10 max-h-[calc(60vh-44px)] overflow-y-auto"
      style={{
        bottom: 'calc(100% - 24px)'
      }}
    >
      {/* Action Drawer Card — Slides smoothly up from behind the input field */}
      <div
        className={`popup-glass w-full rounded-t-[26px] px-3 pt-3 pb-8 flex flex-col gap-1 border-t-[0.5px] border-x-[0.5px] border-hairline shadow-none pointer-events-auto font-sans ${
          isClosing ? 'animate-drawer-slide-down' : 'animate-drawer-slide-up'
        }`}
      >
        {/* 1. Прикрепить */}
        <button
          type="button"
          onClick={onAttachClick}
          title="Прикрепить файлы"
          className="w-full flex items-center gap-3.5 px-4 py-2.5 rounded-full text-[16px] font-medium tracking-tight text-secondary hover:text-primary hover:bg-hover-strong active:scale-[0.99] transition-all duration-150 cursor-pointer focus:outline-none text-left select-none group border-none shadow-none"
        >
          <Paperclip
            size={18}
            strokeWidth={1.8}
            className="shrink-0 text-secondary group-hover:text-primary transition-colors"
          />
          <span className="leading-none">Прикрепить файлы</span>
        </button>

        {onCommandsClick && (
          <button
            type="button"
            data-action="commands"
            onClick={onCommandsClick}
            className="w-full flex items-center gap-3.5 px-4 py-2.5 rounded-full text-[16px] font-medium tracking-tight text-secondary hover:text-primary hover:bg-hover-strong active:scale-[0.99] transition-all duration-150 cursor-pointer focus:outline-none text-left select-none group border-none shadow-none"
          >
            <Slash size={18} strokeWidth={1.8} className="shrink-0" aria-hidden="true" />
            <span className="leading-none">Команды</span>
          </button>
        )}

        {/* 2. Сделай план */}
        <button
          type="button"
          onClick={onPlanClick}
          className="w-full flex items-center gap-3.5 px-4 py-2.5 rounded-full text-[16px] font-medium tracking-tight text-secondary hover:text-primary hover:bg-hover-strong active:scale-[0.99] transition-all duration-150 cursor-pointer focus:outline-none text-left select-none group border-none shadow-none"
        >
          <ListChecks
            size={18}
            strokeWidth={1.8}
            className="shrink-0 text-secondary group-hover:text-primary transition-colors"
          />
          <span className="leading-none">{planMode ? 'Выключить режим плана' : 'Сделай план'}</span>
        </button>

        {/* 3. Команда агентов */}
        <button
          type="button"
          disabled
          title="Команда агентов появится позже"
          className="w-full flex items-center gap-3.5 px-4 py-2.5 rounded-full text-[16px] font-medium tracking-tight text-secondary hover:text-primary hover:bg-hover-strong active:scale-[0.99] transition-all duration-150 cursor-pointer focus:outline-none text-left select-none group border-none shadow-none"
        >
          <svg
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="shrink-0 text-secondary group-hover:text-primary transition-colors"
          >
            <circle cx="6" cy="6" r="3" />
            <circle cx="18" cy="6" r="3" />
            <circle cx="6" cy="18" r="3" />
            <circle cx="18" cy="18" r="3" />
            <path d="M8.5 8.5l7 7M15.5 8.5l-7 7" />
          </svg>
          <span className="leading-none opacity-50">Команда агентов · скоро</span>
        </button>

        {/* 4. Рабочая папка */}
        {folderPath && onChangeFolder && (
          <div className="w-full flex items-center justify-between px-4 py-2.5 rounded-full text-[16px] font-medium tracking-tight text-secondary hover:text-primary hover:bg-hover-strong active:scale-[0.99] transition-all duration-150 text-left select-none group border-none shadow-none">
            <button
              type="button"
              onClick={onChangeFolder}
              className="flex-1 flex items-center gap-3.5 min-w-0 bg-transparent border-none text-left cursor-pointer focus:outline-none p-0 text-secondary group-hover:text-primary"
            >
              <Folder
                size={18}
                strokeWidth={1.8}
                className="shrink-0 text-secondary group-hover:text-primary transition-colors"
              />
              <span className="leading-none truncate max-w-[200px]">
                {formatFolderDisplay(folderPath)}
              </span>
            </button>
            <div className="flex items-center gap-1 shrink-0">
              {onOpenFolder && (
                <button
                  type="button"
                  onClick={onOpenFolder}
                  title="Открыть в проводнике"
                  className="p-1 rounded-full text-muted hover:text-primary hover:bg-hover-strong transition-colors focus:outline-none cursor-pointer"
                >
                  <FolderOpen size={16} strokeWidth={1.8} />
                </button>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
