import { appStorage } from '../services/appStorage'
import { useCallback, useEffect, useState } from 'react'

export interface WorkspaceTab {
  id: string
  title: string
  type?: 'files' | 'terminal' | 'ai-terminal' | 'changes' | 'subagents' | 'empty'
  pinned?: boolean
  filesBySession?: Record<string, { folderPath: string; path: string }>
}
interface TabsState { tabs: WorkspaceTab[]; activeTabId: string | null; nextId: number }
const STORAGE_KEY = 'zipply_workspace_tabs_v1'
export const initialTabsState: TabsState = {
  tabs: [{ id: '1', title: 'Zipply Терминал', type: 'ai-terminal', pinned: true }],
  activeTabId: '1',
  nextId: 2
}

function expectedTabTitle(tab: WorkspaceTab): string {
  if (tab.type === 'files') return 'Файлы'
  if (tab.type === 'terminal') return 'Терминал'
  if (tab.type === 'ai-terminal') return 'Zipply Терминал'
  if (tab.type === 'changes') return 'Изменения'
  if (tab.type === 'subagents') return 'Субагенты'
  if (tab.type === 'empty') return 'Новая вкладка'
  return `Вкладка ${tab.id}`
}

function sortPinnedFirst(tabs: WorkspaceTab[]): WorkspaceTab[] {
  const fixed = tabs.filter(tab => tab.type === 'ai-terminal').map(tab => tab.pinned ? tab : { ...tab, pinned: true })
  const pinned = tabs.filter(tab => tab.type !== 'ai-terminal' && tab.pinned)
  const unpinned = tabs.filter(tab => tab.type !== 'ai-terminal' && !tab.pinned)
  return [...fixed, ...pinned, ...unpinned]
}

export function loadTabs(): TabsState {
  try {
    const raw = appStorage.getItem(STORAGE_KEY)
    if (!raw) return initialTabsState
    const value: unknown = JSON.parse(raw)
    if (!value || typeof value !== 'object') return initialTabsState
    const state = value as Partial<TabsState>
    if (!Array.isArray(state.tabs) || !Number.isSafeInteger(state.nextId) || (state.nextId as number) < 1) return initialTabsState
    const ids = new Set<string>()
    for (const tab of state.tabs) {
      if (
        !tab ||
        typeof tab.id !== 'string' ||
        !/^[1-9]\d*$/.test(tab.id) ||
        !Number.isSafeInteger(Number(tab.id)) ||
        Number(tab.id) >= (state.nextId as number) ||
        (tab.type !== undefined && tab.type !== 'files' && tab.type !== 'terminal' && tab.type !== 'ai-terminal' && tab.type !== 'changes' && tab.type !== 'subagents' && tab.type !== 'empty') ||
        (tab.pinned !== undefined && typeof tab.pinned !== 'boolean') ||
        tab.title !== expectedTabTitle(tab) ||
        ids.has(tab.id)
      ) {
        return initialTabsState
      }
      if (
        tab.filesBySession !== undefined &&
        (tab.type !== 'files' ||
          !tab.filesBySession ||
          typeof tab.filesBySession !== 'object' ||
          Array.isArray(tab.filesBySession) ||
          Object.values(tab.filesBySession).some((item) => !item || typeof item.folderPath !== 'string' || typeof item.path !== 'string'))
      ) {
        return initialTabsState
      }
      ids.add(tab.id)
    }
    if (state.tabs.length ? typeof state.activeTabId !== 'string' || !ids.has(state.activeTabId) : state.activeTabId !== null) return initialTabsState
    const tabs = sortPinnedFirst(
      state.tabs.filter(
        (tab) => tab.type === 'files' || tab.type === 'terminal' || tab.type === 'ai-terminal' || tab.type === 'changes' || tab.type === 'subagents' || tab.type === 'empty' || tab.type === undefined
      )
    )
    const activeTabId = tabs.some((tab) => tab.id === state.activeTabId) ? state.activeTabId! : tabs[tabs.length - 1]?.id ?? null
    return { ...(state as TabsState), tabs, activeTabId }
  } catch {
    return initialTabsState
  }
}

export function useWorkspaceTabs() {
  const [state, setState] = useState<TabsState>(loadTabs)
  useEffect(() => {
    setState((previous) => {
      if (previous.tabs.some((tab) => tab.type === 'ai-terminal')) return previous
      const id = String(previous.nextId)
      return {
        tabs: sortPinnedFirst([...previous.tabs, { id, title: 'Zipply Терминал', type: 'ai-terminal', pinned: true }]),
        activeTabId: previous.activeTabId ?? id,
        nextId: previous.nextId + 1
      }
    })
  }, [])
  useEffect(() => {
    try {
      appStorage.setItem(STORAGE_KEY, JSON.stringify(state))
    } catch {
      /* Keep tabs available for this session. */
    }
  }, [state])
  const addTab = useCallback(
    () =>
      setState((previous) => {
        const id = String(previous.nextId)
        return { tabs: [...previous.tabs, { id, title: 'Новая вкладка', type: 'empty' }], activeTabId: id, nextId: previous.nextId + 1 }
      }),
    []
  )
  const addFilesTab = useCallback(
    () =>
      setState((previous) => {
        const id = String(previous.nextId)
        return { tabs: [...previous.tabs, { id, title: 'Файлы', type: 'files' }], activeTabId: id, nextId: previous.nextId + 1 }
      }),
    []
  )
  const addTerminalTab = useCallback(
    () =>
      setState((previous) => {
        const id = String(previous.nextId)
        return { tabs: [...previous.tabs, { id, title: 'Терминал', type: 'terminal' }], activeTabId: id, nextId: previous.nextId + 1 }
      }),
    []
  )
  const addChangesTab = useCallback(
    () =>
      setState((previous) => {
        const id = String(previous.nextId)
        return { tabs: [...previous.tabs, { id, title: 'Изменения', type: 'changes' }], activeTabId: id, nextId: previous.nextId + 1 }
      }),
    []
  )
  const addSubagentsTab = useCallback(
    () =>
      setState((previous) => {
        const id = String(previous.nextId)
        return { tabs: [...previous.tabs, { id, title: 'Субагенты', type: 'subagents' }], activeTabId: id, nextId: previous.nextId + 1 }
      }),
    []
  )
  const addAiTerminalTab = useCallback(
    () =>
      setState((previous) => {
        const existing = previous.tabs.find((tab) => tab.type === 'ai-terminal')
        if (existing) return { ...previous, activeTabId: existing.id }
        const id = String(previous.nextId)
        return {
          tabs: sortPinnedFirst([...previous.tabs, { id, title: 'Zipply Терминал', type: 'ai-terminal', pinned: true }]),
          activeTabId: id,
          nextId: previous.nextId + 1
        }
      }),
    []
  )
  const selectTab = useCallback(
    (id: string) => setState((previous) => (previous.tabs.some((tab) => tab.id === id) ? { ...previous, activeTabId: id } : previous)),
    []
  )
  const setTabFiles = useCallback(
    (id: string) =>
      setState((previous) => ({
        ...previous,
        tabs: previous.tabs.map((tab) => (tab.id === id ? { ...tab, type: 'files', title: 'Файлы' } : tab))
      })),
    []
  )
  const setTabTerminal = useCallback(
    (id: string) =>
      setState((previous) => ({
        ...previous,
        tabs: previous.tabs.map((tab) => (tab.id === id ? { ...tab, type: 'terminal', title: 'Терминал', filesBySession: undefined } : tab))
      })),
    []
  )
  const setTabChanges = useCallback(
    (id: string) =>
      setState((previous) => ({
        ...previous,
        tabs: previous.tabs.map((tab) => (tab.id === id ? { ...tab, type: 'changes', title: 'Изменения', filesBySession: undefined } : tab))
      })),
    []
  )
  const setTabSubagents = useCallback(
    (id: string) =>
      setState((previous) => ({
        ...previous,
        tabs: previous.tabs.map((tab) => (tab.id === id ? { ...tab, type: 'subagents', title: 'Субагенты', filesBySession: undefined } : tab))
      })),
    []
  )
  const openFileInFilesTab = useCallback(
    (sessionId: string, folderPath: string, filePath: string) =>
      setState((previous) => {
        const existing = previous.tabs.find((tab) => tab.type === 'files')
        if (existing) {
          return {
            ...previous,
            activeTabId: existing.id,
            tabs: previous.tabs.map((tab) =>
              tab.id === existing.id
                ? { ...tab, filesBySession: { ...tab.filesBySession, [sessionId]: { folderPath, path: filePath } } }
                : tab
            )
          }
        }
        const id = String(previous.nextId)
        return {
          tabs: [...previous.tabs, { id, title: 'Файлы', type: 'files', filesBySession: { [sessionId]: { folderPath, path: filePath } } }],
          activeTabId: id,
          nextId: previous.nextId + 1
        }
      }),
    []
  )
  const setTabAiTerminal = useCallback(
    (id: string) =>
      setState((previous) => ({
        ...previous,
        tabs: sortPinnedFirst(
          previous.tabs.map((tab) =>
            tab.id === id ? { ...tab, type: 'ai-terminal', title: 'Zipply Терминал', filesBySession: undefined } : tab
          )
        )
      })),
    []
  )
  const togglePinTab = useCallback(
    (id: string) =>
      setState((previous) => ({
        ...previous,
        tabs: sortPinnedFirst(
          previous.tabs.map((tab) => (tab.id === id && tab.type !== 'ai-terminal' ? { ...tab, pinned: !tab.pinned } : tab))
        )
      })),
    []
  )
  const setTabFile = useCallback(
    (id: string, sessionId: string, folderPath: string, path: string) =>
      setState((previous) => ({
        ...previous,
        tabs: previous.tabs.map((tab) =>
          tab.id === id && tab.type === 'files'
            ? { ...tab, filesBySession: { ...tab.filesBySession, [sessionId]: { folderPath, path } } }
            : tab
        )
      })),
    []
  )
  const closeTab = useCallback(
    (id: string) =>
      setState((previous) => {
        const index = previous.tabs.findIndex((tab) => tab.id === id)
        if (index < 0 || previous.tabs[index]?.pinned) return previous
        const tabs = previous.tabs.filter((tab) => tab.id !== id)
        const activeTabId = previous.activeTabId === id ? tabs[Math.min(index, tabs.length - 1)]?.id ?? null : previous.activeTabId
        return { ...previous, tabs, activeTabId }
      }),
    []
  )
  const moveTab = useCallback(
    (id: string, targetId: string, after: boolean) =>
      setState((previous) => {
        const from = previous.tabs.findIndex((tab) => tab.id === id)
        const target = previous.tabs.findIndex((tab) => tab.id === targetId)
        if (from < 0 || target < 0 || from === target) return previous
        if (previous.tabs[from]?.type === 'ai-terminal' || previous.tabs[target]?.type === 'ai-terminal') return previous
        if (Boolean(previous.tabs[from]?.pinned) !== Boolean(previous.tabs[target]?.pinned)) return previous
        const tabs = [...previous.tabs]
        const [tab] = tabs.splice(from, 1)
        const destination = tabs.findIndex((item) => item.id === targetId) + (after ? 1 : 0)
        tabs.splice(destination, 0, tab)
        return { ...previous, tabs }
      }),
    []
  )
  return {
    ...state,
    addTab,
    addFilesTab,
    addTerminalTab,
    addChangesTab,
    addSubagentsTab,
    addAiTerminalTab,
    selectTab,
    closeTab,
    moveTab,
    togglePinTab,
    setTabFiles,
    setTabTerminal,
    setTabChanges,
    setTabSubagents,
    setTabAiTerminal,
    setTabFile,
    openFileInFilesTab
  }
}
