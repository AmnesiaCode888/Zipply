import React, { useState, useMemo } from 'react'
import {
  Plus,
  PanelLeft,
  MessageSquare,
  FileText,
  SlidersHorizontal,
  Keyboard,
  Settings,
  ArrowLeft,
  Zap,
  Terminal,
  Lightbulb,
  History,
  Bookmark,
  Sparkles,
  Palette,
  User,
  Search,
  X,
  Trash2,
  HardDrive,
  Boxes
} from 'lucide-react'
import { ChatSession } from '../types/chat'
import { SettingsTab } from '../types/settings'
import './Sidebar.css'

interface SidebarProps {
  isOpen: boolean
  chats: ChatSession[]
  activeChatId: string | null
  activeNavTab: 'dialogs' | 'notes' | 'skills'
  selectedNotesCategory?: string
  onSelectNavTab: (tab: 'dialogs' | 'notes' | 'skills') => void
  onSelectNotesCategory?: (category: string) => void
  onSelectChat: (chatId: string) => void
  onDeleteChat?: (chatId: string) => void
  onToggleSidebar: () => void
  onNewChat?: () => void
  onNewNote?: () => void
  onNewSkill?: () => void
  isSettingsOpen?: boolean
  activeSettingsTab?: SettingsTab
  width?: number
  onResize?: (width: number) => void
  onSelectSettingsTab?: (tab: SettingsTab) => void
  onOpenSettings?: (tab?: SettingsTab) => void
  onCloseSettings?: () => void
}

const NOTE_SIDEBAR_CATEGORIES = [
  { id: 'all', label: 'Все заметки', icon: <Bookmark size={15} strokeWidth={1.8} /> },
  { id: 'user_preference', label: 'Личные правила', icon: <User size={15} strokeWidth={1.8} /> },
  { id: 'project_fact', label: 'Стек и Проект', icon: <Zap size={15} strokeWidth={1.8} /> },
  { id: 'procedural_workflow', label: 'Процессы', icon: <Terminal size={15} strokeWidth={1.8} /> },
  { id: 'fact', label: 'Общие знания', icon: <Lightbulb size={15} strokeWidth={1.8} /> },
  { id: 'persona', label: 'Стиль общения', icon: <Sparkles size={15} strokeWidth={1.8} /> },
  { id: 'sessions', label: 'Резюме сессий', icon: <History size={15} strokeWidth={1.8} /> }
]

export const Sidebar: React.FC<SidebarProps> = ({
  isOpen,
  chats,
  activeChatId,
  activeNavTab = 'dialogs',
  selectedNotesCategory = 'all',
  width = 260,
  onResize,
  onSelectNavTab,
  onSelectNotesCategory,
  onSelectChat,
  onDeleteChat,
  onToggleSidebar,
  onNewChat,
  onNewNote,
  onNewSkill,
  isSettingsOpen = false,
  activeSettingsTab = 'models',
  onSelectSettingsTab,
  onOpenSettings,
  onCloseSettings
}) => {
  const isDraggingRef = React.useRef<boolean>(false)
  const startXRef = React.useRef<number>(0)
  const startWidthRef = React.useRef<number>(260)

  const handleStartResize = React.useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault()
      e.stopPropagation()
      isDraggingRef.current = true
      startXRef.current = e.clientX
      startWidthRef.current = width || 260

      document.body.classList.add('is-resizing-sidebar')

      const handleMouseMove = (ev: MouseEvent) => {
        if (!isDraggingRef.current) return
        const deltaX = ev.clientX - startXRef.current
        const rawNewWidth = startWidthRef.current + deltaX
        const minW = 200
        const rightPanelEl = document.querySelector('.right-panel-container.open') as HTMLElement | null
        const currentRightPanelW = rightPanelEl ? rightPanelEl.offsetWidth : 0
        const maxW = Math.max(minW, Math.min(window.innerWidth - currentRightPanelW - 380, 460))
        const clamped = Math.max(minW, Math.min(rawNewWidth, maxW))
        onResize?.(clamped)
      }

      const handleMouseUp = () => {
        isDraggingRef.current = false
        document.body.classList.remove('is-resizing-sidebar')
        window.removeEventListener('mousemove', handleMouseMove)
        window.removeEventListener('mouseup', handleMouseUp)
      }

      window.addEventListener('mousemove', handleMouseMove)
      window.addEventListener('mouseup', handleMouseUp)
    },
    [width, onResize]
  )
  const [chatSearch, setChatSearch] = useState('')

  const filteredChats = useMemo(() => {
    if (!chatSearch.trim()) return chats
    const q = chatSearch.toLowerCase().trim()
    return chats.filter(
      (c) =>
        c.title.toLowerCase().includes(q) ||
        (c.project?.name && c.project.name.toLowerCase().includes(q))
    )
  }, [chats, chatSearch])

  const todayChats = filteredChats.filter(
    (c) => c.dateGroup === 'Сегодня' || c.dateGroup === 'СЕГОДНЯ' || !c.dateGroup
  )
  const yesterdayChats = filteredChats.filter(
    (c) => c.dateGroup === 'Вчера' || c.dateGroup === 'ВЧЕРА'
  )
  const olderChats = filteredChats.filter(
    (c) =>
      c.dateGroup &&
      c.dateGroup !== 'Сегодня' &&
      c.dateGroup !== 'СЕГОДНЯ' &&
      c.dateGroup !== 'Вчера' &&
      c.dateGroup !== 'ВЧЕРА'
  )

  const renderChatItem = (chat: ChatSession) => {
    const isActive = activeChatId === chat.id
    return (
      <div
        key={chat.id}
        className={`sidebar-history-item-row ${isActive ? 'active' : ''}`}
      >
        <button
          type="button"
          className="sidebar-history-item"
          onClick={() => onSelectChat(chat.id)}
          title={chat.title}
        >
          <span className="sidebar-chat-title">{chat.title}</span>
          {chat.project?.name && (
            <span className="sidebar-project-tag" title={chat.project.path}>
              {chat.project.name}
            </span>
          )}
        </button>
        {onDeleteChat && (
          <button
            type="button"
            className="sidebar-chat-delete-btn"
            onClick={(e) => {
              e.stopPropagation()
              onDeleteChat(chat.id)
            }}
            title="Удалить диалог"
            aria-label="Удалить диалог"
          >
            <Trash2 size={13} strokeWidth={1.8} />
          </button>
        )}
      </div>
    )
  }

  const settingsCategories: { id: SettingsTab; label: string; icon: React.ReactNode }[] = [
    { id: 'models', label: 'Конфигурация', icon: <SlidersHorizontal size={17} strokeWidth={1.8} /> },
    { id: 'mcp', label: 'MCP Серверы', icon: <Boxes size={17} strokeWidth={1.8} /> },
    { id: 'appearance', label: 'Темы и оформление', icon: <Palette size={17} strokeWidth={1.8} /> },
    { id: 'shortcuts', label: 'Горячие клавиши', icon: <Keyboard size={17} strokeWidth={1.8} /> },
    { id: 'storage', label: 'Локальное хранилище', icon: <HardDrive size={17} strokeWidth={1.8} /> }
  ]

  const handleOpenSettingsTab = (tab: SettingsTab): void => {
    if (onOpenSettings) {
      onOpenSettings(tab)
    } else if (onSelectSettingsTab) {
      onSelectSettingsTab(tab)
    }
  }

  const handleNavClick = (tab: 'dialogs' | 'notes' | 'skills'): void => {
    if (isSettingsOpen && onCloseSettings) {
      onCloseSettings()
    }
    onSelectNavTab(tab)
  }

  return (
    <aside
      className={`sidebar-container ${isOpen ? 'open' : 'closed'}`}
      style={isOpen && width ? { width } : undefined}
      aria-label="Sidebar navigation"
    >
      <div className="sidebar-inner">
        {/* Sidebar Header (60px) */}
        <div className="sidebar-header">
          {isSettingsOpen ? (
            <button
              type="button"
              className="sidebar-new-chat-btn"
              title="Назад к чатам"
              onClick={onCloseSettings}
            >
              <ArrowLeft size={14} strokeWidth={2.4} />
              <span>Чаты</span>
            </button>
          ) : activeNavTab === 'notes' ? (
            <button
              type="button"
              className="sidebar-new-chat-btn"
              title="Новая заметка"
              onClick={onNewNote || onNewChat}
            >
              <Plus size={14} strokeWidth={2.4} />
              <span>Добавить</span>
            </button>
          ) : activeNavTab === 'skills' ? (
            <button
              type="button"
              className="sidebar-new-chat-btn"
              title="Новый навык"
              onClick={onNewSkill || onNewChat}
            >
              <Plus size={14} strokeWidth={2.4} />
              <span>Навык</span>
            </button>
          ) : (
            <button
              type="button"
              className="sidebar-new-chat-btn"
              title="Новый чат"
              onClick={onNewChat}
            >
              <Plus size={14} strokeWidth={2.4} />
              <span>Новый чат</span>
            </button>
          )}

          <button
            type="button"
            className="sidebar-close-btn"
            title="Закрыть панель"
            aria-label="Close sidebar"
            onClick={onToggleSidebar}
          >
            <PanelLeft size={20} strokeWidth={1.8} />
          </button>
        </div>

        {/* Middle Section: Settings Menu OR Main Sidebar Navigation */}
        {isSettingsOpen ? (
          <div className="sidebar-history-scroll">
            <div className="sidebar-group">
              <div className="sidebar-group-title">Настройки</div>
              <div className="sidebar-group-list">
                {settingsCategories.map((cat) => (
                  <button
                    key={cat.id}
                    type="button"
                    className={`sidebar-nav-item ${activeSettingsTab === cat.id ? 'active' : ''}`}
                    onClick={() => onSelectSettingsTab?.(cat.id)}
                  >
                    {cat.icon}
                    <span>{cat.label}</span>
                  </button>
                ))}
              </div>
            </div>
          </div>
        ) : (
          <>
            {/* Top Navigation Tabs: Диалоги, Заметки & Навыки */}
            <nav className="sidebar-nav">
              <button
                type="button"
                className={`sidebar-nav-item ${activeNavTab === 'dialogs' ? 'active' : ''}`}
                onClick={() => handleNavClick('dialogs')}
              >
                <MessageSquare size={16} strokeWidth={1.8} />
                <span>Диалоги</span>
              </button>

              <button
                type="button"
                className={`sidebar-nav-item ${activeNavTab === 'notes' ? 'active' : ''}`}
                onClick={() => handleNavClick('notes')}
              >
                <FileText size={16} strokeWidth={1.8} />
                <span>Заметки</span>
              </button>

              <button
                type="button"
                className={`sidebar-nav-item ${activeNavTab === 'skills' ? 'active' : ''}`}
                onClick={() => handleNavClick('skills')}
              >
                <Zap size={16} strokeWidth={1.8} />
                <span>Навыки</span>
              </button>
            </nav>

            <div className="sidebar-divider" />

            {/* Content Area: Chat History, Notes Categories, or Skills info */}
            {activeNavTab === 'notes' ? (
              <div className="sidebar-history-scroll">
                <div className="sidebar-group">
                  <div className="sidebar-group-title">Категории базы знаний</div>
                  <div className="sidebar-group-list">
                    {NOTE_SIDEBAR_CATEGORIES.map((cat) => (
                      <button
                        key={cat.id}
                        type="button"
                        className={`sidebar-history-item ${selectedNotesCategory === cat.id ? 'active' : ''}`}
                        onClick={() => onSelectNotesCategory?.(cat.id)}
                        title={cat.label}
                      >
                        <span className="sidebar-cat-icon">{cat.icon}</span>
                        <span>{cat.label}</span>
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            ) : activeNavTab === 'skills' ? (
              <div className="sidebar-history-scroll">
                <div className="sidebar-group">
                  <div className="sidebar-group-title">Навыки агента</div>
                  <div className="sidebar-empty-state" style={{ padding: '24px 12px', textAlign: 'center', lineHeight: '1.4' }}>
                    <span>Управление системными инструкциями и навыками</span>
                  </div>
                </div>
              </div>
            ) : (
              /* Dialogs History List */
              <>
                <div className="sidebar-chat-search-wrap">
                  <Search size={14} strokeWidth={1.8} className="sidebar-chat-search-icon" />
                  <input
                    type="text"
                    className="sidebar-chat-search-input"
                    placeholder="Поиск диалогов..."
                    value={chatSearch}
                    onChange={(e) => setChatSearch(e.target.value)}
                    spellCheck={false}
                  />
                  {chatSearch && (
                    <button
                      type="button"
                      className="sidebar-chat-search-clear"
                      onClick={() => setChatSearch('')}
                      title="Очистить"
                    >
                      <X size={12} strokeWidth={2.2} />
                    </button>
                  )}
                </div>

                <div className="sidebar-history-scroll">
                  {todayChats.length > 0 && (
                    <div className="sidebar-group">
                      <div className="sidebar-group-title">Сегодня</div>
                      <div className="sidebar-group-list">
                        {todayChats.map(renderChatItem)}
                      </div>
                    </div>
                  )}

                  {yesterdayChats.length > 0 && (
                    <div className="sidebar-group">
                      <div className="sidebar-group-title">Вчера</div>
                      <div className="sidebar-group-list">
                        {yesterdayChats.map(renderChatItem)}
                      </div>
                    </div>
                  )}

                  {olderChats.length > 0 && (
                    <div className="sidebar-group">
                      <div className="sidebar-group-title">Ранее</div>
                      <div className="sidebar-group-list">
                        {olderChats.map(renderChatItem)}
                      </div>
                    </div>
                  )}

                  {todayChats.length === 0 && yesterdayChats.length === 0 && olderChats.length === 0 && (
                    <div className="sidebar-empty-state">
                      <span>{chatSearch.trim() ? 'Ничего не найдено' : 'Нет истории диалогов'}</span>
                    </div>
                  )}
                </div>
              </>
            )}
          </>
        )}

        {/* Bottom Settings Button */}
        <div className="sidebar-bottom-bar">
          <button
            type="button"
            className={`sidebar-bottom-btn ${isSettingsOpen ? 'active' : ''}`}
            onClick={() => {
              if (isSettingsOpen) {
                onCloseSettings?.()
              } else {
                handleOpenSettingsTab('models')
              }
            }}
            title="Настройки"
          >
            <Settings size={16} strokeWidth={1.8} />
            <span className="sidebar-bottom-label">Настройки</span>
          </button>
        </div>
      </div>
      <div
        className="sidebar-resizer"
        onMouseDown={handleStartResize}
        title="Перетащите для изменения ширины"
      />
    </aside>
  )
}

export default Sidebar
