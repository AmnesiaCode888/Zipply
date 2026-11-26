import { appStorage } from '../../services/appStorage'
import React, { useEffect, useMemo, useRef, useState } from 'react'
import {
  Palette,
  ShieldCheck,
  UserRound,
  X,
  ChevronLeft, Plus, Trash2, FolderClosed, FolderOpen, NewChat, Code2, Download
} from '../../icons'
import { Search, Bot, Database, Puzzle } from 'lucide-react'
import { VirtualChatRows } from './VirtualChatRows'
import { reportStorageError } from '../../services/chatStorageService'
import { ChatSession } from '../../types/chat'
import type { SettingsTab } from '../settings/types'
import { searchChats } from '../../services/chatSearch'
import type { ExtensionManagementPage } from '../chat-input/ChatInput'
import type { Plugin } from '../plugins/PluginLibrary'

export type SettingsCategory = SettingsTab

interface SidebarProps {
  className?: string
  sessions?: ChatSession[]
  activeChatId?: string
  approvalChatIds?: readonly string[]
  generatingTitleChatIds?: readonly string[]
  onCreateChat?: (folderPath?: string) => void
  onSelectChat?: (id: string) => void
  onSelectSearchResult?: (chatId: string, messageId?: string) => void
  onRenameChat?: (id: string, newTitle: string) => void
  onDeleteChat?: (id: string) => void
  mainView?: 'chat' | 'plugins' | 'settings'
  extensionPage?: ExtensionManagementPage
  installedPlugins?: readonly Plugin[]
  selectedPluginId?: string | null
  onSelectExtensionPage?: (page: ExtensionManagementPage) => void
  onSelectPlugin?: (id: string) => void
  activeSettingsTab?: SettingsCategory
  onSelectSettingsTab?: (category: SettingsCategory) => void
  onBackToChat?: () => void
  updateAvailable?: { version: string; releaseUrl: string } | null
  onOpenUpdateDownload?: () => void
  onDismissUpdate?: () => void
}

/**
 * Sidebar
 *
 * Clean, modern Apple-style sidebar for Zipply.
 * - In Chat mode: displays the project and chat lists.
 * - In Settings mode: displays navigation buttons (Темы, Модели, Безопасность) on full width with back button.
 * - Zero borders (border-none), zero shadows (shadow-none)
 */
const SidebarView: React.FC<SidebarProps> = ({
  className = '',
  sessions = [],
  activeChatId = '',
  approvalChatIds = [],
  generatingTitleChatIds = [],
  onCreateChat = () => {},
  onSelectChat = () => {},
  onSelectSearchResult = () => {},
  onRenameChat = () => {},
  onDeleteChat = () => {},
  mainView = 'chat',
  extensionPage = 'all',
  installedPlugins = [],
  selectedPluginId = null,
  onSelectExtensionPage = () => {},
  onSelectPlugin = () => {},
  activeSettingsTab = 'themes',
  onSelectSettingsTab = () => {},
  onBackToChat = () => {},
  updateAvailable = null,
  onOpenUpdateDownload = () => {},
  onDismissUpdate,
}) => {
  const [projects, setProjects] = useState<string[]>(() => {
    try { const value = JSON.parse(appStorage.getItem('zipply_projects_v1') || '[]'); return Array.isArray(value) ? value.filter((p): p is string => typeof p === 'string') : [] } catch { return [] }
  })
  const [expanded, setExpanded] = useState<string[]>([])
  const [closingProjects, setClosingProjects] = useState<string[]>([])
  const chatScrollRef = useRef<HTMLDivElement>(null)
  const projectTimers = useRef(new Map<string, number>())
  useEffect(() => () => { for (const timer of projectTimers.current.values()) window.clearTimeout(timer) }, [])
  const toggleProject = (key: string, open: boolean) => {
    const oldTimer = projectTimers.current.get(key)
    if (oldTimer) window.clearTimeout(oldTimer)
    projectTimers.current.delete(key)
    if (open && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setClosingProjects(previous => [...previous.filter(item => item !== key), key])
      projectTimers.current.set(key, window.setTimeout(() => { projectTimers.current.delete(key); setClosingProjects(previous => previous.filter(item => item !== key)) }, 220))
    } else setClosingProjects(previous => previous.filter(item => item !== key))
    setExpanded(previous => open ? previous.filter(item => item !== key) : [...previous.filter(item => item !== key), key])
  }
  const [showAllProjects, setShowAllProjects] = useState(false)
  const pathKey = (path: string) => path.replace(/\\/g, '/').replace(/\/$/, '').toLowerCase()
  const saveProjects = (next: string[]) => {
    try { appStorage.setItem('zipply_projects_v1', JSON.stringify(next)); setProjects(next) }
    catch { reportStorageError('Не удалось сохранить список проектов.') }
  }
  const addProject = async () => {
    const path = await window.api?.workspace?.selectFolder()
    if (!path) return
    setShowAllProjects(true)
    if (!projects.some(project => pathKey(project) === pathKey(path))) saveProjects([...projects, path])
    setExpanded(previous => previous.includes(pathKey(path)) ? previous : [...previous, pathKey(path)])
  }
  const [query, setQuery] = useState('')
  const [settingsQuery, setSettingsQuery] = useState('')
  const settingsSearch = settingsQuery.trim().toLocaleLowerCase('ru')
  const settingsSections = ([
    ['profile', 'Профиль', UserRound, 'аккаунт версия обновления update'],
    ['themes', 'Оформление', Palette],
    ['agent', 'Агент', Bot, 'оболочка терминала shell powershell cmd bash zsh'],
    ['editor', 'Редактор', Code2],
    ['security', 'Безопасность', ShieldCheck],
    ['data', 'Данные', Database]
  ] as const).filter(([, label, , keywords = '']) => `${label} ${keywords}`.toLocaleLowerCase('ru').includes(settingsSearch))
  const [isSearchOpen, setIsSearchOpen] = useState(false)
  const searchButtonRef = useRef<HTMLButtonElement>(null)
  const closeSearch = () => {
    setQuery('')
    setIsSearchOpen(false)
  }
  const results = useMemo(() => searchChats(sessions, query), [sessions, query])
  return (
    <aside
      className={`w-full shrink-0 h-full flex flex-col bg-sidebar select-none font-sans ${className}`}
    >
      {mainView === 'settings' ? (
        /* ================= 1. SIDEBAR IN SETTINGS MODE ================= */
        <div className="w-full h-full flex flex-col">
          <div className="px-3 pt-3 pb-2 shrink-0 flex items-center gap-2">
            <button
              type="button"
              onClick={onBackToChat}
              aria-label="Назад к чату"
              title="Назад к чату"
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[10px] border-none text-secondary hover:text-primary hover:bg-hover transition-colors cursor-pointer"
            >
              <ChevronLeft size={18} strokeWidth={2} aria-hidden="true" />
            </button>
            <h2 className="text-[19px] font-semibold text-primary">Настройки</h2>
          </div>

          <div className="mx-2 mt-2 mb-1 px-3 h-9 shrink-0 flex items-center gap-2 rounded-full bg-control border-none shadow-none"><Search size={16} className="shrink-0 text-secondary" aria-hidden="true" /><input type="search" value={settingsQuery} onChange={event => setSettingsQuery(event.target.value)} placeholder="Поиск настроек" aria-label="Поиск разделов настроек" className="min-w-0 w-full bg-transparent text-[14px] text-primary placeholder:text-secondary outline-none border-none shadow-none" /></div>
          <nav aria-label="Разделы настроек" className="flex-1 min-h-0 overflow-y-auto px-2 space-y-1 pt-1">
            {settingsSections.map(([id, label, Icon]) => (
              <React.Fragment key={id}>
              {(id === 'profile' || id === 'agent' || id === 'security') && <p className="px-3.5 pt-4 pb-1 text-[12.5px] font-semibold text-secondary">{id === 'profile' ? 'АККАУНТ И ПРИЛОЖЕНИЕ' : id === 'agent' ? 'РАБОТА АГЕНТА' : 'ДОСТУП И ДАННЫЕ'}</p>}
              <button type="button" onClick={() => onSelectSettingsTab(id)}
                aria-current={activeSettingsTab === id ? 'page' : undefined}
                className={`w-full flex min-h-9 items-center gap-2.5 px-3 py-[7px] rounded-[10px] text-[15px] leading-[22px] transition-colors cursor-pointer text-left border-none shadow-none ${activeSettingsTab === id ? 'bg-control text-primary' : 'text-primary hover:bg-hover'}`}>
                <Icon size={18} strokeWidth={1.75} className="shrink-0" /><span>{label}</span>
              </button>
              </React.Fragment>
            ))}
            {!settingsSections.length && <p className="px-3.5 py-3 text-[14px] text-secondary">Разделы не найдены</p>}
          </nav>
        </div>
      ) : mainView === 'plugins' ? (
        <div className="w-full h-full flex flex-col">
          <h2 className="px-5 pt-5 pb-3 text-[19px] font-semibold text-primary">Плагины</h2>
          <div className="px-2">
            <button type="button" onClick={() => onSelectExtensionPage('plugins')} aria-current={extensionPage === 'plugins' && !selectedPluginId ? 'page' : undefined} className={`flex min-h-9 w-full items-center gap-2.5 rounded-[14px] border-none px-3 py-[7px] text-left text-[15px] leading-[22px] transition-colors ${extensionPage === 'plugins' && !selectedPluginId ? 'bg-control text-primary' : 'text-primary hover:bg-hover'}`}>
              <Puzzle size={18} strokeWidth={1.75} aria-hidden="true" />Библиотека
            </button>
          </div>
          <div className="px-3.5 pt-5 pb-2 shrink-0">
            <p className="text-[12.5px] font-semibold text-secondary">УСТАНОВЛЕННЫЕ</p>
          </div>
          <nav aria-label="Установленные плагины" className="flex-1 min-h-0 overflow-y-auto px-2">
            {installedPlugins.length === 0 ? <p className="px-1.5 py-1 text-[14px] leading-[21px] text-secondary">Установленных плагинов пока нет.</p> : installedPlugins.map(({ id, name, icon: Icon }) => (
              <button key={id} type="button" onClick={() => onSelectPlugin(id)} aria-current={selectedPluginId === id ? 'page' : undefined} className={`flex min-h-9 w-full items-center gap-2.5 rounded-[14px] border-none px-3 py-[7px] text-left text-[15px] leading-[22px] transition-colors ${selectedPluginId === id ? 'bg-control text-primary' : 'text-primary hover:bg-hover'}`}>
                <Icon size={24} className="shrink-0" /><span className="truncate">{name}</span>
              </button>
            ))}
          </nav>
        </div>
      ) : (
        /* ================= 2. SIDEBAR IN CHAT MODE ================= */
        <>
          <div className="px-2 pt-2 pb-1 flex items-center gap-1">
            <button type="button" onClick={() => onCreateChat()} className="flex-1 min-w-0 flex items-center gap-2 px-3 py-2.5 rounded-[10px] text-left text-[15px] font-medium leading-[22px] text-primary hover:bg-hover active:scale-[0.985] transition-colors border-none shadow-none"><NewChat size={18} className="shrink-0" aria-hidden="true" /><span className="truncate">Новый чат</span></button>
            <button ref={searchButtonRef} type="button" aria-label={isSearchOpen ? 'Закрыть поиск' : 'Открыть поиск по чатам'} aria-expanded={isSearchOpen} title={isSearchOpen ? 'Закрыть поиск' : 'Поиск по чатам'} onClick={() => isSearchOpen ? closeSearch() : setIsSearchOpen(true)} className="w-9 h-9 shrink-0 flex items-center justify-center rounded-full text-secondary hover:text-primary hover:bg-hover active:scale-95 transition-colors border-none shadow-none cursor-pointer">
              {isSearchOpen ? <X size={18} aria-hidden="true" /> : <Search size={18} strokeWidth={1.75} strokeLinecap="round" aria-hidden="true" />}
            </button>
          </div>
          <div aria-hidden={!isSearchOpen} className={`grid shrink-0 transition-[grid-template-rows,opacity,margin] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none ${isSearchOpen ? 'grid-rows-[1fr] opacity-100 mt-1 mb-1' : 'grid-rows-[0fr] opacity-0 mt-0 mb-0 pointer-events-none'}`}>
            <div className="min-h-0 overflow-hidden">
            <div className="mx-2 px-3 h-10 flex items-center gap-2 rounded-full bg-surface border-none shadow-none">
            <Search size={17} className="shrink-0 text-secondary" aria-hidden="true" />
            <input autoFocus type="search" value={query} onChange={event => setQuery(event.target.value)} onKeyDown={event => {
              if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); closeSearch(); searchButtonRef.current?.focus() }
            }} placeholder="Поиск по чатам" aria-label="Поиск по чатам и сообщениям" tabIndex={isSearchOpen ? 0 : -1} className="min-w-0 flex-1 bg-transparent text-[15px] leading-[22px] text-primary placeholder:text-secondary outline-none border-none shadow-none" />
            </div>
            </div>
          </div>
          {/* Chat list */}
          <div className="flex-1 flex flex-col min-h-0 overflow-hidden px-2 pb-1">
            {query.trim() ? <div className="flex-1 min-h-0 overflow-y-auto" aria-label="Результаты поиска">
              {results.length === 0 ? <p role="status" className="px-3 py-3 text-[14px] text-secondary">Ничего не найдено</p> : results.map((result, index) => <button key={`${result.chatId}:${result.messageId || 'title'}:${index}`} type="button" onClick={() => { onSelectSearchResult(result.chatId, result.messageId); closeSearch() }} className="w-full text-left px-3 py-2.5 rounded-[14px] hover:bg-hover border-none shadow-none">
                <span className="block truncate text-[15px] leading-[22px] text-primary">{result.title}</span>
                <span className="block mt-0.5 text-[13px] leading-[19px] text-secondary break-words">{result.snippet}</span>
              </button>)}
            </div> : <div ref={chatScrollRef} data-chat-scroll className="flex-1 min-h-0 overflow-y-auto">
              <div className="flex items-center pl-3 pr-1 pt-4 pb-1"><span className="flex-1 text-[12.5px] font-semibold text-secondary">Проекты</span><button type="button" aria-label="Добавить проект" title="Добавить проект" onClick={addProject} className="w-7 h-7 flex items-center justify-center rounded-full text-secondary hover:text-primary hover:bg-hover border-none shadow-none"><Plus size={18} strokeWidth={1.75} strokeLinecap="round" aria-hidden="true" /></button></div>
              {(showAllProjects ? projects : projects.slice(0, 5)).map(path => {
                const key = pathKey(path)
                const open = expanded.includes(key)
                const projectSessions = sessions.filter(session => session.folderPath && pathKey(session.folderPath) === key)
                const name = path.replace(/\\/g, '/').replace(/\/$/, '').split('/').pop() || path
                return <div key={key}>
                  <div className="group relative flex items-center rounded-[10px] transition-colors hover:bg-hover">
                    <button type="button" aria-expanded={open} title={path} onClick={() => toggleProject(key, open)} className="min-w-0 w-full flex items-center gap-2 px-3 py-2 text-left text-[15px] leading-[22px] text-primary group-hover:pr-[68px] group-focus-within:pr-[68px] border-none shadow-none">{open ? <FolderOpen size={18} strokeWidth={1.75} className="shrink-0" aria-hidden="true" /> : <FolderClosed size={18} strokeWidth={1.75} className="shrink-0" aria-hidden="true" />}<span className="truncate">{name}</span></button>
                    <div className="absolute right-1 flex items-center opacity-0 invisible group-hover:visible group-hover:opacity-100 group-focus-within:visible group-focus-within:opacity-100 transition-opacity"><button type="button" aria-label={`Новый чат в ${name}`} title="Новый чат в проекте" onClick={() => { setExpanded(previous => previous.includes(key) ? previous : [...previous, key]); onCreateChat(path) }} className="w-7 h-7 flex items-center justify-center rounded-full text-secondary hover:text-primary hover:bg-hover-strong active:scale-95 transition-colors border-none shadow-none"><NewChat size={17} aria-hidden="true" /></button>
                    <button type="button" aria-label={`Убрать проект ${name}`} title="Убрать проект из списка" onClick={() => saveProjects(projects.filter(item => pathKey(item) !== key))} className="w-7 h-7 flex items-center justify-center rounded-full text-secondary hover:text-primary border-none shadow-none"><Trash2 size={15} /></button></div>
                  </div>
                  <div aria-hidden={!open} className={`grid transition-[grid-template-rows,opacity] duration-200 ease-out motion-reduce:transition-none ${open ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0'}`}><div className={`min-h-0 overflow-hidden ${open ? 'visible' : 'invisible'}`}><div className="pl-6">{(open || closingProjects.includes(key)) && <VirtualChatRows sessions={projectSessions} scrollRef={chatScrollRef} activeChatId={activeChatId} approvalChatIds={approvalChatIds} generatingTitleChatIds={generatingTitleChatIds} onSelect={onSelectChat} onRename={onRenameChat} onDelete={onDeleteChat} />}{open && projectSessions.length === 0 && <p className="px-3 py-2 text-[14px] text-secondary">Нет чатов</p>}</div></div></div>
                </div>
              })}
              {projects.length > 5 && <button type="button" onClick={() => setShowAllProjects(value => !value)} className="w-full px-3 py-2 text-left text-[15px] leading-[22px] text-secondary hover:text-primary hover:bg-hover rounded-[10px] border-none shadow-none">{showAllProjects ? 'Показать меньше' : 'Показать больше'}</button>}
              <div className="px-3 pt-6 pb-2 text-[12.5px] font-semibold text-secondary">Недавние</div>
              <VirtualChatRows sessions={[...sessions].sort((a, b) => b.updatedAt - a.updatedAt)} scrollRef={chatScrollRef} activeChatId={activeChatId} approvalChatIds={approvalChatIds} generatingTitleChatIds={generatingTitleChatIds} onSelect={onSelectChat} onRename={onRenameChat} onDelete={onDeleteChat} />
            </div>}
          </div>
          {updateAvailable && (
            <div className="px-2 pb-2 pt-1 shrink-0">
              <div className="flex items-center gap-1.5 rounded-[14px] bg-surface hover:bg-surface-elevated px-2.5 py-2 transition-colors border-none shadow-none">
                <button
                  type="button"
                  onClick={onOpenUpdateDownload}
                  className="min-w-0 flex-1 flex items-center gap-2.5 text-left border-none shadow-none cursor-pointer focus:outline-none"
                >
                  <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-control text-primary">
                    <Download size={14} aria-hidden="true" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13.5px] font-medium leading-[18px] text-primary">
                      Доступна v{updateAvailable.version}
                    </span>
                    <span className="block truncate text-[12px] leading-[16px] text-secondary">
                      Скачать на zipply.my
                    </span>
                  </span>
                </button>
                {onDismissUpdate && (
                  <button
                    type="button"
                    onClick={onDismissUpdate}
                    aria-label="Скрыть уведомление об обновлении"
                    title="Скрыть"
                    className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-secondary hover:text-primary hover:bg-control border-none shadow-none cursor-pointer focus:outline-none"
                  >
                    <X size={13} aria-hidden="true" />
                  </button>
                )}
              </div>
            </div>
          )}

        </>
      )}
    </aside>
  )
}

export const Sidebar = React.memo(SidebarView)
