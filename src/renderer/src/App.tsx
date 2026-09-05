import React, { useState, useEffect, useCallback } from 'react'
import { TitleBar } from './components/TitleBar'
import { TaskInput } from './components/TaskInput'
import { Sidebar } from './components/Sidebar'
import { ChatView } from './components/ChatView'
import { NotesView } from './components/notes/NotesView'
import { SkillsView } from './components/skills/SkillsView'
import { SettingsView } from './components/settings/SettingsView'
import { RightSidePanel } from './components/RightSidePanel'
import { useChatSession } from './hooks/useChatSession'
import { useAppearance } from './hooks/useAppearance'
import { AiSettingsProvider, useAiSettingsContext } from './hooks/AiSettingsContext'
import { SettingsTab } from './types/settings'
import { ProjectRef, AttachedImage } from './types/chat'


const AppInner: React.FC = () => {
  useAppearance()
  const { config } = useAiSettingsContext()
  const [isSidebarOpen, setIsSidebarOpen] = useState(false)
  const [isRightPanelOpen, setIsRightPanelOpen] = useState(false)
  const [rightPanelTab, setRightPanelTab] = useState<'terminal' | 'files'>('terminal')
  const [isSettingsOpen, setIsSettingsOpen] = useState(false)
  const [activeSettingsTab, setActiveSettingsTab] = useState<SettingsTab>('models')
  const [activeNavTab, setActiveNavTab] = useState<'dialogs' | 'notes' | 'skills'>('dialogs')
  const [selectedNotesCategory, setSelectedNotesCategory] = useState<string>('all')
  const [isAddingNoteTrigger, setIsAddingNoteTrigger] = useState<boolean>(false)

  const {
    chats,
    activeChatId,
    activeChat,
    isStreaming,
    selectChat,
    newChat,
    deleteChat,
    sendMessage,
    cancelGeneration
  } = useChatSession(config)

  const handleToggleSidebar = (): void => {
    setIsSidebarOpen((prev) => !prev)
  }

  const [sidebarWidth, setSidebarWidth] = useState<number>(() => {
    try {
      const saved = localStorage.getItem('zipply_sidebar_width')
      if (saved) {
        const val = parseInt(saved, 10)
        if (!isNaN(val) && val >= 200 && val <= 460) return val
      }
    } catch {}
    return 260
  })

  const handleResizeSidebar = useCallback((newWidth: number) => {
    setSidebarWidth(newWidth)
    try {
      localStorage.setItem('zipply_sidebar_width', String(newWidth))
    } catch {}
  }, [])

  const [rightPanelWidth, setRightPanelWidth] = useState<number>(() => {
    try {
      const saved = localStorage.getItem('zipply_right_panel_width')
      if (saved) {
        const val = parseInt(saved, 10)
        if (!isNaN(val) && val >= 300 && val <= 1200) return val
      }
    } catch {}
    return 440
  })

  const handleResizeRightPanel = useCallback((newWidth: number) => {
    setRightPanelWidth(newWidth)
    try {
      localStorage.setItem('zipply_right_panel_width', String(newWidth))
    } catch {}
  }, [])

  const handleToggleRightPanel = useCallback((): void => {
    setIsRightPanelOpen((prev) => !prev)
  }, [])

  const handleOpenSettings = useCallback((tab: SettingsTab = 'models'): void => {
    setIsSettingsOpen(true)
    setActiveSettingsTab(tab)
    setIsSidebarOpen(true)
  }, [])

  const handleCloseSettings = useCallback((): void => {
    setIsSettingsOpen(false)
  }, [])

  const handleSelectNavTab = useCallback((tab: 'dialogs' | 'notes' | 'skills'): void => {
    setIsSettingsOpen(false)
    setActiveNavTab(tab)
  }, [])

  const handleSelectChat = useCallback(
    (chatId: string): void => {
      setIsSettingsOpen(false)
      setActiveNavTab('dialogs')
      selectChat(chatId)
    },
    [selectChat]
  )

  const handleNewChat = useCallback((): void => {
    setIsSettingsOpen(false)
    setActiveNavTab('dialogs')
    newChat()
  }, [newChat])

  const handleNewNote = useCallback((): void => {
    setIsSettingsOpen(false)
    setActiveNavTab('notes')
    setIsAddingNoteTrigger(true)
  }, [])

  const handleNewSkill = useCallback((): void => {
    setIsSettingsOpen(false)
    setActiveNavTab('skills')
  }, [])

  const handleSendMessage = useCallback(
    (text: string, project?: ProjectRef | null, images?: AttachedImage[]): void => {
      setIsSettingsOpen(false)
      setActiveNavTab('dialogs')
      sendMessage(text, project, images)
    },
    [sendMessage]
  )

  // Keyboard shortcuts: Ctrl+, (Settings), Ctrl+N (New chat), Ctrl+B (Toggle sidebar), Ctrl+F (Search), Ctrl+Shift+C (Copy code), Ctrl+1/2/3, Escape
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent): void => {
      const isCmdOrCtrl = e.ctrlKey || e.metaKey
      const code = e.code
      const key = e.key ? e.key.toLowerCase() : ''

      // Ctrl+, -> Toggle Settings (English Comma, Russian б, etc.)
      if (isCmdOrCtrl && !e.shiftKey && (code === 'Comma' || key === ',' || key === 'б' || key === '<')) {
        e.preventDefault()
        setIsSettingsOpen((prev) => {
          const next = !prev
          if (next) setIsSidebarOpen(true)
          return next
        })
        return
      }

      // Ctrl+N -> New Chat (English N, Russian т)
      if (isCmdOrCtrl && !e.shiftKey && (code === 'KeyN' || key === 'n' || key === 'т')) {
        e.preventDefault()
        handleNewChat()
        return
      }

      // Ctrl+B -> Toggle Sidebar (English B, Russian и)
      if (isCmdOrCtrl && !e.shiftKey && (code === 'KeyB' || key === 'b' || key === 'и')) {
        e.preventDefault()
        handleToggleSidebar()
        return
      }

      // Ctrl+Shift+C -> Copy last code block
      if (isCmdOrCtrl && e.shiftKey && (code === 'KeyC' || key === 'c' || key === 'с')) {
        e.preventDefault()
        const codeEls = document.querySelectorAll('pre code, .hljs, pre')
        if (codeEls.length > 0) {
          const lastCodeEl = codeEls[codeEls.length - 1]
          const codeText = lastCodeEl.textContent || ''
          if (codeText) {
            navigator.clipboard.writeText(codeText)
          }
        }
        return
      }

      // Ctrl+F -> Search across active view (Notes, Skills, or Chat history)
      if (isCmdOrCtrl && !e.shiftKey && (code === 'KeyF' || key === 'f' || key === 'а')) {
        e.preventDefault()
        if (activeNavTab === 'notes') {
          const inp = document.querySelector<HTMLInputElement>('.notes-search-input')
          inp?.focus()
          inp?.select()
        } else if (activeNavTab === 'skills') {
          const inp = document.querySelector<HTMLInputElement>('.skills-search-field input')
          inp?.focus()
          inp?.select()
        } else {
          setIsSidebarOpen(true)
          const inp = document.querySelector<HTMLInputElement>('.sidebar-chat-search-input')
          if (inp) {
            inp.focus()
            inp.select()
          }
        }
        return
      }

      // Ctrl+1 / Ctrl+2 / Ctrl+3 -> Switch Navigation Tabs
      if (isCmdOrCtrl && (code === 'Digit1' || key === '1')) {
        e.preventDefault()
        handleSelectNavTab('dialogs')
        return
      }
      if (isCmdOrCtrl && (code === 'Digit2' || key === '2')) {
        e.preventDefault()
        handleSelectNavTab('notes')
        return
      }
      if (isCmdOrCtrl && (code === 'Digit3' || key === '3')) {
        e.preventDefault()
        handleSelectNavTab('skills')
        return
      }

      // Ctrl+` (Backquote / ё) or Ctrl+J -> Toggle Right Terminal Panel
      if (
        isCmdOrCtrl &&
        !e.shiftKey &&
        (code === 'Backquote' || key === '`' || key === 'ё' || code === 'KeyJ' || key === 'j' || key === 'о')
      ) {
        e.preventDefault()
        handleToggleRightPanel()
        return
      }

      // Escape -> Close settings or right panel
      if (e.key === 'Escape') {
        if (isSettingsOpen) {
          e.preventDefault()
          setIsSettingsOpen(false)
          return
        }
        if (isRightPanelOpen) {
          e.preventDefault()
          setIsRightPanelOpen(false)
          return
        }
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => {
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [isSettingsOpen, isRightPanelOpen, activeNavTab, handleNewChat, handleToggleSidebar, handleToggleRightPanel, handleSelectNavTab])

  return (
    <div className="app-container">
      <Sidebar
        isOpen={isSidebarOpen}
        chats={chats}
        activeChatId={activeChatId}
        activeNavTab={activeNavTab}
        selectedNotesCategory={selectedNotesCategory}
        width={sidebarWidth}
        onResize={handleResizeSidebar}
        onSelectNavTab={handleSelectNavTab}
        onSelectNotesCategory={setSelectedNotesCategory}
        onSelectChat={handleSelectChat}
        onDeleteChat={deleteChat}
        onToggleSidebar={handleToggleSidebar}
        onNewChat={handleNewChat}
        onNewNote={handleNewNote}
        onNewSkill={handleNewSkill}
        isSettingsOpen={isSettingsOpen}
        activeSettingsTab={activeSettingsTab}
        onSelectSettingsTab={setActiveSettingsTab}
        onOpenSettings={handleOpenSettings}
        onCloseSettings={handleCloseSettings}
      />
      <div className="app-main-area">
        <TitleBar
          isSidebarOpen={isSidebarOpen}
          chatTitle={activeNavTab === 'dialogs' && activeChat ? activeChat.title : null}
          isSettingsOpen={isSettingsOpen}
          activeSettingsTab={activeSettingsTab}
          activeNavTab={activeNavTab}
          isRightPanelOpen={isRightPanelOpen}
          onToggleSidebar={handleToggleSidebar}
          onToggleRightPanel={handleToggleRightPanel}
          onNewChat={
            activeNavTab === 'notes'
              ? handleNewNote
              : activeNavTab === 'skills'
                ? handleNewSkill
                : handleNewChat
          }
          onDeleteChat={activeChat ? () => deleteChat(activeChat.id) : undefined}
          onCloseSettings={handleCloseSettings}
        />
        <main className="app-content">
          {isSettingsOpen ? (
            <SettingsView
              activeTab={activeSettingsTab}
              onSelectTab={setActiveSettingsTab}
              onCloseSettings={handleCloseSettings}
            />
          ) : activeNavTab === 'notes' ? (
            <NotesView
              initialCategory={selectedNotesCategory}
              onCategoryChange={setSelectedNotesCategory}
              isAddingTrigger={isAddingNoteTrigger}
              onResetAddingTrigger={() => setIsAddingNoteTrigger(false)}
            />
          ) : activeNavTab === 'skills' ? (
            <SkillsView />
          ) : activeChat ? (
            <ChatView
              chat={activeChat}
              isStreaming={isStreaming}
              onSendMessage={handleSendMessage}
              onCancel={cancelGeneration}
              onOpenSettings={handleOpenSettings}
            />
          ) : (
            <TaskInput
              onSubmit={handleSendMessage}
              onOpenSettings={handleOpenSettings}
            />
          )}
        </main>
      </div>
      <RightSidePanel
        isOpen={isRightPanelOpen}
        activeTab={rightPanelTab}
        onSelectTab={setRightPanelTab}
        panelWidth={rightPanelWidth}
        onResize={handleResizeRightPanel}
        onClose={() => setIsRightPanelOpen(false)}
        activeProject={activeChat?.project || null}
      />
    </div>
  )
}

export const App: React.FC = () => {
  return (
    <AiSettingsProvider>
      <AppInner />
    </AiSettingsProvider>
  )
}

export default App

