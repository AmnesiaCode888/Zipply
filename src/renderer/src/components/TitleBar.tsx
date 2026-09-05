import React from 'react'
import { PanelLeft, X, Trash2, Terminal } from 'lucide-react'
import { WindowControls } from './WindowControls'
import { SettingsTab } from '../types/settings'
import './TitleBar.css'

interface TitleBarProps {
  isSidebarOpen?: boolean
  chatTitle?: string | null
  isSettingsOpen?: boolean
  activeSettingsTab?: SettingsTab
  activeNavTab?: 'dialogs' | 'notes' | 'skills'
  isRightPanelOpen?: boolean
  onToggleSidebar?: () => void
  onToggleRightPanel?: () => void
  onNewChat?: () => void
  onDeleteChat?: () => void
  onCloseSettings?: () => void
}

const SETTINGS_TAB_NAMES: Record<SettingsTab, string> = {
  models: 'Конфигурация',
  mcp: 'MCP Серверы',
  appearance: 'Темы и оформление',
  shortcuts: 'Горячие клавиши',
  storage: 'Локальное хранилище'
}

export const TitleBar: React.FC<TitleBarProps> = ({
  isSidebarOpen = false,
  chatTitle = null,
  isSettingsOpen = false,
  activeSettingsTab = 'models',
  activeNavTab = 'dialogs',
  isRightPanelOpen = false,
  onToggleSidebar,
  onToggleRightPanel,
  onNewChat,
  onDeleteChat,
  onCloseSettings
}) => {
  const handleDoubleClick = (): void => {
    window.api?.window?.maximize?.()
  }

  return (
    <header className="titlebar" onDoubleClick={handleDoubleClick}>
      {isSettingsOpen ? (
        <div className="top-nav-left chat-mode">
          {!isSidebarOpen && (
            <button
              type="button"
              className="sidebar-toggle-btn"
              title="Боковая панель"
              aria-label="Боковая панель"
              onClick={onToggleSidebar}
            >
              <PanelLeft size={20} strokeWidth={1.8} />
            </button>
          )}

          <div className="chat-titlebar-title">
            <span className="chat-title-text">
              Настройки / {SETTINGS_TAB_NAMES[activeSettingsTab]}
            </span>
          </div>

          {onCloseSettings && (
            <button
              type="button"
              className="settings-close-pill"
              onClick={onCloseSettings}
              title="Закрыть настройки (Esc)"
            >
              <X size={13} strokeWidth={2.2} />
              <span>Закрыть</span>
            </button>
          )}
        </div>
      ) : activeNavTab === 'skills' ? (
        <div className="top-nav-left chat-mode">
          {!isSidebarOpen && (
            <button
              type="button"
              className="sidebar-toggle-btn"
              title="Боковая панель"
              aria-label="Боковая панель"
              onClick={onToggleSidebar}
            >
              <PanelLeft size={20} strokeWidth={1.8} />
            </button>
          )}

          <div className="chat-titlebar-title">
            <span className="chat-title-text">Библиотека навыков (Skills)</span>
          </div>
        </div>
      ) : activeNavTab === 'notes' ? (
        <div className="top-nav-left chat-mode">
          {!isSidebarOpen && (
            <button
              type="button"
              className="sidebar-toggle-btn"
              title="Боковая панель"
              aria-label="Боковая панель"
              onClick={onToggleSidebar}
            >
              <PanelLeft size={20} strokeWidth={1.8} />
            </button>
          )}

          <div className="chat-titlebar-title">
            <span className="chat-title-text">Заметки и Память ИИ</span>
          </div>
        </div>
      ) : chatTitle ? (
        <div className="top-nav-left chat-mode">
          {!isSidebarOpen && (
            <button
              type="button"
              className="sidebar-toggle-btn"
              title="Боковая панель"
              aria-label="Боковая панель"
              onClick={onToggleSidebar}
            >
              <PanelLeft size={20} strokeWidth={1.8} />
            </button>
          )}

          <div className="chat-titlebar-title" title={chatTitle}>
            <span className="chat-title-text">{chatTitle}</span>
          </div>

          {onDeleteChat && (
            <button
              type="button"
              className="chat-titlebar-delete-btn"
              onClick={onDeleteChat}
              title="Удалить этот диалог"
              aria-label="Удалить этот диалог"
            >
              <Trash2 size={14} strokeWidth={1.8} />
            </button>
          )}
        </div>
      ) : (
        <div className={`top-nav-left ${isSidebarOpen ? 'hidden' : ''}`}>
          <button
            type="button"
            className="new-chat-pill"
            title="Новый чат"
            onClick={onNewChat}
          >
            Новый чат
          </button>

          <button
            type="button"
            className="sidebar-toggle-btn"
            title="Боковая панель"
            aria-label="Боковая панель"
            onClick={onToggleSidebar}
          >
            <PanelLeft size={20} strokeWidth={1.8} />
          </button>
        </div>
      )}

      <div className="titlebar-drag-spacer" />

      {!isRightPanelOpen && (
        <div className="titlebar-right-closed">
          {onToggleRightPanel && (
            <button
              type="button"
              className="titlebar-terminal-btn"
              title="Открыть терминал (Ctrl+`)"
              aria-label="Терминал"
              onClick={onToggleRightPanel}
            >
              <Terminal size={14} strokeWidth={2} />
            </button>
          )}

          <WindowControls />
        </div>
      )}
    </header>
  )
}

export default TitleBar
