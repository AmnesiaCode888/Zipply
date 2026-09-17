import React, { useState, useEffect, useRef, useCallback } from 'react'
import { Folder, Plus, X, Terminal, Trash2, Bot, History, Globe } from 'lucide-react'
import { WindowControls } from './WindowControls'
import { ProjectRef, ChatSession, StepItem } from '../types/chat'
import { ProjectFileTree } from './files/ProjectFileTree'
import { ActivityItem } from '../types/activity'
import { ActivityLogView } from './activity/ActivityLogView'
import { CodeDiffViewer } from './activity/CodeDiffViewer'
import { BrowserView } from './browser/BrowserView'
import { updateTerminalOutputLines } from '../utils/terminalUtils'
import './RightSidePanel.css'

export interface RightSidePanelProps {
  isOpen: boolean
  activeTab?: 'terminal' | 'files' | 'activity' | 'browser'
  onSelectTab?: (tab: 'terminal' | 'files' | 'activity' | 'browser') => void
  onClose?: () => void
  activeProject?: ProjectRef | null
  activeChat?: ChatSession | null
  panelWidth?: number
  onResize?: (newWidth: number) => void
}

interface CommandHistoryEntry {
  id: string
  command: string
  cwd: string
  output: string[]
  exitCode?: number | null
}

interface TerminalSession {
  id: string
  name: string
  cwd: string
  entries: CommandHistoryEntry[]
  inputVal: string
  isRunning: boolean
  activeRunId: string | null
  commandHistory: string[]
  historyIndex: number
  isAi?: boolean
  lastUsed?: number
}

function formatAiTabName(command: string): string {
  if (!command || !command.trim()) return 'cmd'
  const trimmed = command.trim()
  const parts = trimmed.split(/\s+/)
  let mainCmd = parts[0].replace(/.*[/\\]/, '')
  if (mainCmd.toLowerCase().endsWith('.exe')) mainCmd = mainCmd.slice(0, -4)
  if (mainCmd.toLowerCase().endsWith('.cmd')) mainCmd = mainCmd.slice(0, -4)

  if (['npm', 'npx', 'yarn', 'pnpm', 'cargo'].includes(mainCmd.toLowerCase()) && parts[1]) {
    const sub = parts[1] === 'run' && parts[2] ? parts[2] : parts[1]
    const combined = `${mainCmd} ${sub}`
    return combined.length > 14 ? combined.slice(0, 13) + '…' : combined
  }

  if (['python', 'python3', 'node', 'deno', 'bun'].includes(mainCmd.toLowerCase()) && parts[1]) {
    const script = parts[1].replace(/.*[/\\]/, '')
    const scriptName = script.split('.')[0] || script
    const combined = `${mainCmd} ${scriptName}`
    return combined.length > 14 ? combined.slice(0, 13) + '…' : combined
  }

  const shortName = mainCmd.length > 12 ? mainCmd.slice(0, 11) + '…' : mainCmd
  return shortName
}

const RIGHT_PANEL_STORAGE_KEY = 'zipply_right_panel_states'

export interface ProjectPanelState {
  sessions: TerminalSession[]
  activeSessionId: string
  activityItems: ActivityItem[]
  unreadActivityCount: number
  nextSessionCounter: number
}

function normalizeProjectKey(path?: string | null): string {
  if (!path || !path.trim()) return '__default__'
  return path.trim().toLowerCase().replace(/\\/g, '/').replace(/\/+$/, '')
}

function isDefaultProjectsFolder(folderPath?: string | null): boolean {
  if (!folderPath || !folderPath.trim()) return true
  const norm = normalizeProjectKey(folderPath)
  if (norm === 'd:/zipplyprojects' || norm === 'c:/zipplyprojects' || norm === '__default__') return true
  if (norm.endsWith('/zipplyprojects')) return true
  try {
    const saved = localStorage.getItem('zipply_ai_config')
    if (saved) {
      const cfg = JSON.parse(saved)
      if (cfg?.baseDir) {
        const baseNorm = normalizeProjectKey(cfg.baseDir)
        if (norm === baseNorm) return true
      }
    }
  } catch {}
  return false
}

function getPanelContextKey(project?: ProjectRef | null, chat?: ChatSession | null): string {
  const projectPath = project?.path?.trim()
  const isDefault = isDefaultProjectsFolder(projectPath)

  if (isDefault) {
    if (chat?.id) {
      return `chat_${chat.id}`
    }
    return '__default__'
  }

  return normalizeProjectKey(projectPath)
}

function extractActivityFromChat(chat?: ChatSession | null): ActivityItem[] {
  if (!chat || !chat.messages || !Array.isArray(chat.messages)) return []
  const items: ActivityItem[] = []
  const seen = new Set<string>()

  chat.messages.forEach((msg, msgIdx) => {
    if (!msg.segments || !Array.isArray(msg.segments)) return
    msg.segments.forEach((seg, segIdx) => {
      if (seg.type === 'tool_round' || seg.type === 'subagent_round') {
        const steps = (seg as any).steps
        if (Array.isArray(steps)) {
          steps.forEach((step: StepItem, stepIdx: number) => {
            const stepId = step.id || `act_${chat.id}_${msgIdx}_${segIdx}_${stepIdx}`
            if (seen.has(stepId)) return
            seen.add(stepId)

            if (step.type === 'edit' || step.type === 'create') {
              const filePath = (step.args?.path as string) || (step.args?.target_file as string) || step.target || ''
              const fileName = filePath ? filePath.replace(/.*[/\\]/, '') : step.action || 'файл'
              items.push({
                id: stepId,
                type: step.type === 'create' ? 'file_create' : 'file_edit',
                timestamp: Date.now() - (chat.messages.length - msgIdx) * 1000,
                title: fileName,
                filePath,
                newContent: (step.args?.newContent as string) || (step.args?.content as string) || step.result || '',
                oldContent: (step.args?.oldContent as string) || '',
                diffStats: step.stats ? { add: step.stats.add ?? 0, del: step.stats.del ?? 0 } : undefined,
                description: step.action || (step.type === 'create' ? `Создание: ${fileName}` : `Правка: ${fileName}`)
              })
            } else if (step.type === 'run') {
              const command = (step.args?.command as string) || step.target || step.action || ''
              items.push({
                id: stepId,
                type: 'terminal_command',
                timestamp: Date.now() - (chat.messages.length - msgIdx) * 1000,
                title: command,
                command,
                cwd: (step.args?.cwd as string) || chat.project?.path,
                description: `Выполнение: ${command}`
              })
            }
          })
        }
      }
    })
  })

  return items.reverse()
}

function createDefaultSession(cwd: string): TerminalSession {
  return {
    id: 'term_1',
    name: '1: powershell',
    cwd: cwd || '',
    entries: [],
    inputVal: '',
    isRunning: false,
    activeRunId: null,
    commandHistory: [],
    historyIndex: -1,
    lastUsed: Date.now()
  }
}

function loadPersistedProjectStates(): Record<string, ProjectPanelState> {
  try {
    const saved = localStorage.getItem(RIGHT_PANEL_STORAGE_KEY)
    if (saved) {
      const parsed = JSON.parse(saved)
      if (parsed && typeof parsed === 'object') {
        const cleaned: Record<string, ProjectPanelState> = {}
        for (const [k, v] of Object.entries(parsed)) {
          if (v && Array.isArray((v as any).sessions)) {
            cleaned[k] = {
              sessions: (v as any).sessions.map((s: TerminalSession) => ({
                ...s,
                isRunning: false,
                activeRunId: null,
                inputVal: ''
              })),
              activeSessionId: (v as any).activeSessionId || (v as any).sessions[0]?.id || 'term_1',
              activityItems: Array.isArray((v as any).activityItems) ? (v as any).activityItems : [],
              unreadActivityCount: 0,
              nextSessionCounter: (v as any).nextSessionCounter || 2
            }
          }
        }
        return cleaned
      }
    }
  } catch (e) {
    console.warn('[RightSidePanel] Failed to load stored panel states:', e)
  }
  return {}
}

function persistProjectStates(states: Record<string, ProjectPanelState>): void {
  try {
    const pruned: Record<string, any> = {}
    const keys = Object.keys(states)
    for (const k of keys.slice(-15)) {
      const p = states[k]
      if (!p) continue
      pruned[k] = {
        activeSessionId: p.activeSessionId,
        nextSessionCounter: p.nextSessionCounter,
        activityItems: (p.activityItems || []).slice(0, 30),
        sessions: (p.sessions || []).map((s) => ({
          id: s.id,
          name: s.name,
          cwd: s.cwd,
          isAi: s.isAi,
          commandHistory: (s.commandHistory || []).slice(-30),
          entries: (s.entries || []).slice(-20).map((e) => ({
            id: e.id,
            command: e.command,
            cwd: e.cwd,
            output: (e.output || []).slice(-100),
            exitCode: e.exitCode
          }))
        }))
      }
    }
    localStorage.setItem(RIGHT_PANEL_STORAGE_KEY, JSON.stringify(pruned))
  } catch (e) {
    console.warn('[RightSidePanel] Failed to persist panel states:', e)
  }
}

export const RightSidePanel: React.FC<RightSidePanelProps> = ({
  isOpen,
  activeTab = 'terminal',
  onSelectTab,
  onClose,
  activeProject,
  activeChat,
  panelWidth = 440,
  onResize
}) => {
  const initialKey = getPanelContextKey(activeProject, activeChat)
  const defaultCwdRef = useRef<string>(activeProject?.path || '')
  const projectStatesRef = useRef<Record<string, ProjectPanelState>>(loadPersistedProjectStates())
  const currentProjectKeyRef = useRef<string>(initialKey)

  const initialChatActivities = extractActivityFromChat(activeChat)
  const initialProjectState = projectStatesRef.current[initialKey] || {
    sessions: [createDefaultSession(activeProject?.path || '')],
    activeSessionId: 'term_1',
    activityItems: initialChatActivities,
    unreadActivityCount: 0,
    nextSessionCounter: 2
  }

  const nextSessionCounter = useRef<number>(initialProjectState.nextSessionCounter)

  const [sessions, setSessions] = useState<TerminalSession[]>(initialProjectState.sessions)
  const [activeSessionId, setActiveSessionId] = useState<string>(initialProjectState.activeSessionId)
  const [draggedTabId, setDraggedTabId] = useState<string | null>(null)
  const [dragOverTabId, setDragOverTabId] = useState<string | null>(null)

  const initialMergedActivities = (() => {
    const saved = initialProjectState.activityItems || []
    const ids = new Set(saved.map((i) => i.id))
    const fresh = initialChatActivities.filter((i) => !ids.has(i.id))
    return [...fresh, ...saved]
  })()

  // Activity Log and Code Viewer state
  const [activityItems, setActivityItems] = useState<ActivityItem[]>(initialMergedActivities)
  const [unreadActivityCount, setUnreadActivityCount] = useState<number>(initialProjectState.unreadActivityCount)
  const [viewingItem, setViewingItem] = useState<{
    filePath: string
    fileName?: string
    oldContent?: string
    newContent: string
    isDiff?: boolean
    stats?: { add: number; del: number }
  } | null>(null)

  const containerRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const tabsListRef = useRef<HTMLDivElement>(null)

  // Resizing state & ref
  const isDraggingRef = useRef<boolean>(false)
  const startXRef = useRef<number>(0)
  const startWidthRef = useRef<number>(440)

  // Active session helper
  const activeSession = sessions.find((s) => s.id === activeSessionId) || sessions[0]

  const updateActiveSession = useCallback(
    (updater: (prev: TerminalSession) => Partial<TerminalSession>) => {
      setSessions((prev) =>
        prev.map((s) => {
          if (s.id === activeSessionId) {
            return { ...s, ...updater(s), lastUsed: Date.now() }
          }
          return s
        })
      )
    },
    [activeSessionId]
  )

  const handleSelectSession = useCallback((id: string) => {
    setActiveSessionId(id)
    setSessions((prev) =>
      prev.map((s) => (s.id === id ? { ...s, lastUsed: Date.now() } : s))
    )
  }, [])

  const handleTabDragStart = (e: React.DragEvent, id: string) => {
    e.dataTransfer.setData('text/plain', id)
    e.dataTransfer.effectAllowed = 'move'
    setDraggedTabId(id)
  }

  const handleTabDragOver = (e: React.DragEvent, id: string) => {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    if (dragOverTabId !== id) {
      setDragOverTabId(id)
    }
  }

  const handleTabDragLeave = () => {
    setDragOverTabId(null)
  }

  const handleTabDrop = (e: React.DragEvent, targetId: string) => {
    e.preventDefault()
    const sourceId = e.dataTransfer.getData('text/plain') || draggedTabId
    setDraggedTabId(null)
    setDragOverTabId(null)
    if (!sourceId || sourceId === targetId) return

    setSessions((prev) => {
      const srcIndex = prev.findIndex((s) => s.id === sourceId)
      const dstIndex = prev.findIndex((s) => s.id === targetId)
      if (srcIndex === -1 || dstIndex === -1) return prev

      const updated = [...prev]
      const [moved] = updated.splice(srcIndex, 1)
      updated.splice(dstIndex, 0, moved)
      return updated
    })
  }

  const handleTabDragEnd = () => {
    setDraggedTabId(null)
    setDragOverTabId(null)
  }

  // Auto-scroll output on updates
  useEffect(() => {
    if (containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight
    }
  }, [activeSession?.entries, activeSession?.isRunning, activeSession?.inputVal, activeSessionId])

  // Horizontal mouse wheel scrolling for terminal tabs
  useEffect(() => {
    const el = tabsListRef.current
    if (!el) return
    const handleWheel = (e: WheelEvent) => {
      if (e.deltaY !== 0) {
        e.preventDefault()
        el.scrollLeft += e.deltaY
      }
    }
    el.addEventListener('wheel', handleWheel, { passive: false })
    return () => el.removeEventListener('wheel', handleWheel)
  }, [activeTab, sessions.length])

  // Scroll active tab into view when active session changes
  useEffect(() => {
    if (activeTab === 'terminal' && tabsListRef.current) {
      const activeBtn = tabsListRef.current.querySelector<HTMLElement>('.terminal-tab-item.active')
      if (activeBtn) {
        activeBtn.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'nearest' })
      }
    }
  }, [activeSessionId, activeTab])

  // Sync default CWD from system
  useEffect(() => {
    window.api?.terminal?.getDefaultCwd?.().then((defaultDir) => {
      if (defaultDir) {
        defaultCwdRef.current = defaultDir
        setSessions((prev) =>
          prev.map((s) => (s.cwd ? s : { ...s, cwd: defaultDir }))
        )
      }
    })
  }, [])

  // Continuously sync active project state into projectStatesRef and debounced persist
  useEffect(() => {
    const curKey = currentProjectKeyRef.current
    projectStatesRef.current[curKey] = {
      sessions,
      activeSessionId,
      activityItems,
      unreadActivityCount,
      nextSessionCounter: nextSessionCounter.current
    }
    const timer = setTimeout(() => {
      persistProjectStates(projectStatesRef.current)
    }, 1000)
    return () => clearTimeout(timer)
  }, [sessions, activeSessionId, activityItems, unreadActivityCount])

  // Switch project/chat context and preserve per-project state
  useEffect(() => {
    const nextKey = getPanelContextKey(activeProject, activeChat)
    const prevKey = currentProjectKeyRef.current

    if (activeProject?.path) {
      defaultCwdRef.current = activeProject.path
    }

    if (prevKey === nextKey) {
      // Same project/chat context: merge any updated activities from the active chat
      if (activeChat) {
        const chatActivities = extractActivityFromChat(activeChat)
        if (chatActivities.length > 0) {
          setActivityItems((prev) => {
            const existingIds = new Set(prev.map((i) => i.id))
            const fresh = chatActivities.filter((i) => !existingIds.has(i.id))
            return fresh.length > 0 ? [...fresh, ...prev] : prev
          })
        }
      }
      return
    }

    // 1. Snapshot previous state immediately
    projectStatesRef.current[prevKey] = {
      sessions,
      activeSessionId,
      activityItems,
      unreadActivityCount,
      nextSessionCounter: nextSessionCounter.current
    }
    persistProjectStates(projectStatesRef.current)

    // 2. Switch current key
    currentProjectKeyRef.current = nextKey
    setViewingItem(null)

    // 3. Restore next project state or initialize fresh
    const chatActivities = extractActivityFromChat(activeChat)
    const targetState = projectStatesRef.current[nextKey]
    if (targetState && targetState.sessions && targetState.sessions.length > 0) {
      setSessions(targetState.sessions)
      setActiveSessionId(targetState.activeSessionId || targetState.sessions[0].id)

      const savedActivities = targetState.activityItems || []
      const existingIds = new Set(savedActivities.map((i) => i.id))
      const extraFromChat = chatActivities.filter((i) => !existingIds.has(i.id))
      setActivityItems([...extraFromChat, ...savedActivities])

      setUnreadActivityCount(targetState.unreadActivityCount || 0)
      nextSessionCounter.current = targetState.nextSessionCounter || 2
    } else {
      const freshCwd = activeProject?.path || defaultCwdRef.current || ''
      const freshSession = createDefaultSession(freshCwd)
      const freshState: ProjectPanelState = {
        sessions: [freshSession],
        activeSessionId: freshSession.id,
        activityItems: chatActivities,
        unreadActivityCount: 0,
        nextSessionCounter: 2
      }
      projectStatesRef.current[nextKey] = freshState
      setSessions(freshState.sessions)
      setActiveSessionId(freshState.activeSessionId)
      setActivityItems(chatActivities)
      setUnreadActivityCount(0)
      nextSessionCounter.current = 2
    }
  }, [activeProject?.path, activeChat?.id])

  // Focus input when terminal opens or tab switches
  useEffect(() => {
    if (isOpen && activeTab === 'terminal') {
      setTimeout(() => {
        inputRef.current?.focus()
      }, 50)
    }
  }, [isOpen, activeTab, activeSessionId, activeSession?.isRunning])

  // Subscribe to terminal output & exit events (Routes to proper session even in background)
  useEffect(() => {
    if (!window.api?.terminal) return

    const updateSessionOutput = (sessList: TerminalSession[], runId: string, text: string) => {
      return sessList.map((sess) => {
        const hasEntry = sess.entries.some((e) => e.id === runId)
        if (sess.activeRunId === runId || hasEntry) {
          return {
            ...sess,
            lastUsed: Date.now(),
            entries: sess.entries.map((item) => {
              if (item.id === runId) {
                return {
                  ...item,
                  output: updateTerminalOutputLines(item.output, text)
                }
              }
              return item
            })
          }
        }
        return sess
      })
    }

    const updateSessionExit = (sessList: TerminalSession[], runId: string, code?: number | null) => {
      return sessList.map((sess) => {
        const hasEntry = sess.entries.some((e) => e.id === runId)
        if (sess.activeRunId === runId || hasEntry) {
          return {
            ...sess,
            isRunning: false,
            activeRunId: null,
            lastUsed: Date.now(),
            entries: sess.entries.map((item) => {
              if (item.id === runId) {
                return {
                  ...item,
                  exitCode: code ?? 0
                }
              }
              return item
            })
          }
        }
        return sess
      })
    }

    const unsubData = window.api.terminal.onData(({ runId, text }) => {
      let matchedCurrent = false
      setSessions((prev) => {
        const hasMatch = prev.some((s) => s.activeRunId === runId || s.entries.some((e) => e.id === runId))
        if (hasMatch) {
          matchedCurrent = true
          return updateSessionOutput(prev, runId, text)
        }
        return prev
      })

      if (!matchedCurrent) {
        for (const [pKey, pState] of Object.entries(projectStatesRef.current)) {
          if (pKey === currentProjectKeyRef.current) continue
          const hasMatch = pState.sessions.some(
            (s) => s.activeRunId === runId || s.entries.some((e) => e.id === runId)
          )
          if (hasMatch) {
            projectStatesRef.current[pKey] = {
              ...pState,
              sessions: updateSessionOutput(pState.sessions, runId, text)
            }
            break
          }
        }
      }
    })

    const unsubExit = window.api.terminal.onExit(({ runId, code }) => {
      let matchedCurrent = false
      setSessions((prev) => {
        const hasMatch = prev.some((s) => s.activeRunId === runId || s.entries.some((e) => e.id === runId))
        if (hasMatch) {
          matchedCurrent = true
          return updateSessionExit(prev, runId, code)
        }
        return prev
      })

      if (!matchedCurrent) {
        for (const [pKey, pState] of Object.entries(projectStatesRef.current)) {
          if (pKey === currentProjectKeyRef.current) continue
          const hasMatch = pState.sessions.some(
            (s) => s.activeRunId === runId || s.entries.some((e) => e.id === runId)
          )
          if (hasMatch) {
            projectStatesRef.current[pKey] = {
              ...pState,
              sessions: updateSessionExit(pState.sessions, runId, code)
            }
            break
          }
        }
      }
      setTimeout(() => inputRef.current?.focus(), 50)
    })

    // AI Terminal listeners (Commands triggered by AI agent)
    const unsubAiStart = window.api.terminal.onAiStart?.(
      ({ runId, command, cwd, sessionId: forcedSessionId, isBackground }: any) => {
        const sessionId = forcedSessionId || (isBackground ? `term_bg_${runId}` : 'term_ai')
        const tabTitle = isBackground ? `⚙️ ${formatAiTabName(command)}` : '🤖 AI Terminal'

        const newEntry: CommandHistoryEntry = {
          id: runId,
          command,
          cwd: cwd || '.',
          output: [],
          exitCode: null
        }

        const targetProjectKey = cwd ? normalizeProjectKey(cwd) : currentProjectKeyRef.current
        const isCurrentProject =
          targetProjectKey === currentProjectKeyRef.current ||
          targetProjectKey === '__default__' ||
          !cwd

        if (isCurrentProject) {
          setSessions((prev) => {
            const existingIndex = prev.findIndex(
              (s) => s.id === sessionId || (!isBackground && s.isAi)
            )

            if (existingIndex !== -1) {
              return prev.map((s, idx) => {
                if (idx === existingIndex) {
                  return {
                    ...s,
                    id: sessionId,
                    name: isBackground ? tabTitle : '🤖 AI Terminal',
                    cwd: cwd || s.cwd,
                    isRunning: true,
                    activeRunId: runId,
                    lastUsed: Date.now(),
                    entries: [...s.entries, newEntry]
                  }
                }
                return s
              })
            }

            const freshAiSession: TerminalSession = {
              id: sessionId,
              name: tabTitle,
              cwd: cwd || defaultCwdRef.current || '.',
              entries: [newEntry],
              inputVal: '',
              isRunning: true,
              activeRunId: runId,
              commandHistory: [],
              historyIndex: -1,
              isAi: true,
              lastUsed: Date.now()
            }
            return [...prev, freshAiSession]
          })

          setActivityItems((prev) => [
            {
              id: `act_cmd_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
              type: 'terminal_command',
              timestamp: Date.now(),
              title: command,
              command,
              cwd,
              description: `Выполнение: ${command}`
            },
            ...prev
          ])
          setUnreadActivityCount((c) => c + 1)
          setActiveSessionId(sessionId)
        } else {
          // AI session started for background project
          const bgState = projectStatesRef.current[targetProjectKey]
          if (bgState) {
            const existingIndex = bgState.sessions.findIndex(
              (s) => s.id === sessionId || (!isBackground && s.isAi)
            )
            let updatedSessions = [...bgState.sessions]
            if (existingIndex !== -1) {
              updatedSessions[existingIndex] = {
                ...updatedSessions[existingIndex],
                id: sessionId,
                name: isBackground ? tabTitle : '🤖 AI Terminal',
                cwd: cwd || updatedSessions[existingIndex].cwd,
                isRunning: true,
                activeRunId: runId,
                lastUsed: Date.now(),
                entries: [...updatedSessions[existingIndex].entries, newEntry]
              }
            } else {
              updatedSessions.push({
                id: sessionId,
                name: tabTitle,
                cwd: cwd || '.',
                entries: [newEntry],
                inputVal: '',
                isRunning: true,
                activeRunId: runId,
                commandHistory: [],
                historyIndex: -1,
                isAi: true,
                lastUsed: Date.now()
              })
            }
            projectStatesRef.current[targetProjectKey] = {
              ...bgState,
              sessions: updatedSessions,
              activeSessionId: sessionId
            }
          }
        }
      }
    )

    const unsubAiData = window.api.terminal.onAiData?.(({ runId, text }) => {
      let matchedCurrent = false
      setSessions((prev) => {
        const hasMatch = prev.some((s) => s.activeRunId === runId || s.entries.some((e) => e.id === runId))
        if (hasMatch) {
          matchedCurrent = true
          return updateSessionOutput(prev, runId, text)
        }
        return prev
      })

      if (!matchedCurrent) {
        for (const [pKey, pState] of Object.entries(projectStatesRef.current)) {
          if (pKey === currentProjectKeyRef.current) continue
          const hasMatch = pState.sessions.some(
            (s) => s.activeRunId === runId || s.entries.some((e) => e.id === runId)
          )
          if (hasMatch) {
            projectStatesRef.current[pKey] = {
              ...pState,
              sessions: updateSessionOutput(pState.sessions, runId, text)
            }
            break
          }
        }
      }
    })

    const unsubAiExit = window.api.terminal.onAiExit?.(({ runId, code }) => {
      let matchedCurrent = false
      setSessions((prev) => {
        const hasMatch = prev.some((s) => s.activeRunId === runId || s.entries.some((e) => e.id === runId))
        if (hasMatch) {
          matchedCurrent = true
          return updateSessionExit(prev, runId, code)
        }
        return prev
      })

      if (!matchedCurrent) {
        for (const [pKey, pState] of Object.entries(projectStatesRef.current)) {
          if (pKey === currentProjectKeyRef.current) continue
          const hasMatch = pState.sessions.some(
            (s) => s.activeRunId === runId || s.entries.some((e) => e.id === runId)
          )
          if (hasMatch) {
            projectStatesRef.current[pKey] = {
              ...pState,
              sessions: updateSessionExit(pState.sessions, runId, code)
            }
            break
          }
        }
      }
    })

    return () => {
      unsubData?.()
      unsubExit?.()
      unsubAiStart?.()
      unsubAiData?.()
      unsubAiExit?.()
    }
  }, [])

  // Sync open terminal tabs with main process
  useEffect(() => {
    if (!window.api?.terminal?.syncSessions) return
    const payload = sessions.map((s) => ({
      id: s.id,
      name: s.name,
      cwd: s.cwd,
      isAi: s.isAi,
      isRunning: s.isRunning,
      activeRunId: s.activeRunId
    }))
    window.api.terminal.syncSessions(payload, activeSessionId)
  }, [sessions, activeSessionId])

  // Reset unread count when user opens activity tab
  useEffect(() => {
    if (activeTab === 'activity') {
      setUnreadActivityCount(0)
    }
  }, [activeTab])

  // Subscribe to agent tool events (files written, edited, deleted)
  useEffect(() => {
    if (!window.api?.agent?.onEvent) return

    const unsub = window.api.agent.onEvent((evt: any) => {
      if (evt?.type === 'tool_result' && evt?.data) {
        const d = evt.data
        if (d.fileAction) {
          const actionType =
            d.fileAction === 'created'
              ? 'file_create'
              : d.fileAction === 'deleted'
                ? 'file_delete'
                : 'file_edit'

          const rawPath = d.path || ''
          const fileName = rawPath ? rawPath.replace(/.*[/\\]/, '') : 'Файл'

          const newItem: ActivityItem = {
            id: `act_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
            type: actionType,
            timestamp: Date.now(),
            title: fileName,
            filePath: rawPath,
            isNew: d.isNew,
            oldContent: d.oldContent,
            newContent: d.newContent || d.content,
            diffStats: d.stats,
            description: evt.result ? String(evt.result).slice(0, 150) : undefined
          }

          setActivityItems((prev) => [newItem, ...prev])
          if (activeTab !== 'activity') {
            setUnreadActivityCount((c) => c + 1)
          }
        }
      }
    })

    return () => {
      unsub?.()
    }
  }, [activeTab])

  // Select activity item to view code / diff
  const handleSelectActivityItem = useCallback((item: ActivityItem) => {
    if (!item.filePath) return
    setViewingItem({
      filePath: item.filePath,
      fileName: item.title,
      oldContent: item.oldContent,
      newContent: item.newContent || '',
      isDiff: item.type === 'file_edit' && Boolean(item.oldContent),
      stats: item.diffStats
    })
  }, [])

  // Clear activity log
  const handleClearActivity = useCallback(() => {
    setActivityItems([])
    setViewingItem(null)
    setUnreadActivityCount(0)
  }, [])

  // Open file from ProjectFileTree into CodeDiffViewer
  const handleOpenFileFromTree = useCallback(async (filePath: string) => {
    if (!window.api?.files?.readFile) return
    try {
      const res = await window.api.files.readFile(filePath)
      if (res.success && res.content !== undefined) {
        setViewingItem({
          filePath,
          newContent: res.content,
          isDiff: false
        })
      }
    } catch (err) {
      console.error('Failed to read file from tree:', err)
    }
  }, [])

  // Clear active terminal content
  const handleClearActiveTerminal = useCallback(() => {
    updateActiveSession(() => ({
      entries: [],
      inputVal: '',
      historyIndex: -1
    }))
  }, [updateActiveSession])

  // Drag resizer handle
  const handleStartResize = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault()
      e.stopPropagation()
      isDraggingRef.current = true
      startXRef.current = e.clientX
      startWidthRef.current = panelWidth || 440

      document.body.classList.add('is-resizing-panel')

      const handleMouseMove = (ev: MouseEvent) => {
        if (!isDraggingRef.current) return
        const deltaX = startXRef.current - ev.clientX
        const rawNewWidth = startWidthRef.current + deltaX
        const sidebarEl = document.querySelector('.sidebar-container.open') as HTMLElement | null
        const currentSidebarW = sidebarEl ? sidebarEl.offsetWidth : 0
        const availableSpace = window.innerWidth - currentSidebarW - 340
        const maxW = Math.max(260, Math.min(availableSpace, 900))
        const minW = Math.min(260, maxW)
        const clamped = Math.max(minW, Math.min(rawNewWidth, maxW))
        onResize?.(clamped)
      }

      const handleMouseUp = () => {
        isDraggingRef.current = false
        document.body.classList.remove('is-resizing-panel')
        window.removeEventListener('mousemove', handleMouseMove)
        window.removeEventListener('mouseup', handleMouseUp)
      }

      window.addEventListener('mousemove', handleMouseMove)
      window.addEventListener('mouseup', handleMouseUp)
    },
    [panelWidth, onResize]
  )

  // Create new terminal session
  const handleCreateSession = useCallback(() => {
    const nextNum = nextSessionCounter.current++
    const newId = `term_${Date.now()}_${Math.random().toString(36).slice(2, 5)}`
    const newSession: TerminalSession = {
      id: newId,
      name: `${nextNum}: powershell`,
      cwd: defaultCwdRef.current || activeProject?.path || '',
      entries: [],
      inputVal: '',
      isRunning: false,
      activeRunId: null,
      commandHistory: [],
      historyIndex: -1
    }
    setSessions((prev) => [...prev, newSession])
    setActiveSessionId(newId)
    setTimeout(() => inputRef.current?.focus(), 50)
  }, [activeProject])

  // Close terminal session
  const handleCloseSession = useCallback(
    (sessionIdToClose: string) => {
      setSessions((prev) => {
        const target = prev.find((s) => s.id === sessionIdToClose)
        if (target?.activeRunId) {
          window.api?.terminal?.kill(target.activeRunId)
        }

        const remaining = prev.filter((s) => s.id !== sessionIdToClose)
        if (remaining.length === 0) {
          const freshId = `term_${Date.now()}`
          const fresh: TerminalSession = {
            id: freshId,
            name: '1: powershell',
            cwd: defaultCwdRef.current || activeProject?.path || '',
            entries: [],
            inputVal: '',
            isRunning: false,
            activeRunId: null,
            commandHistory: [],
            historyIndex: -1
          }
          nextSessionCounter.current = 2
          setActiveSessionId(freshId)
          return [fresh]
        }

        if (activeSessionId === sessionIdToClose) {
          const closedIdx = prev.findIndex((s) => s.id === sessionIdToClose)
          const newIdx = Math.max(0, closedIdx - 1)
          setActiveSessionId(remaining[newIdx].id)
        }

        return remaining
      })
      setTimeout(() => inputRef.current?.focus(), 50)
    },
    [activeSessionId, activeProject]
  )

  const handleOpenInTerminal = useCallback(
    (folderPath: string) => {
      if (!folderPath) return
      onSelectTab?.('terminal')
      if (activeSession && !activeSession.isRunning) {
        updateActiveSession((prev) => ({
          cwd: folderPath,
          entries: [
            ...prev.entries,
            {
              id: `nav_${Date.now()}`,
              command: `cd "${folderPath}"`,
              cwd: folderPath,
              output: [],
              exitCode: 0
            }
          ],
          inputVal: '',
          historyIndex: -1
        }))
      } else {
        const nextNum = nextSessionCounter.current++
        const newId = `term_${Date.now()}_${Math.random().toString(36).slice(2, 5)}`
        const newSession: TerminalSession = {
          id: newId,
          name: `${nextNum}: powershell`,
          cwd: folderPath,
          entries: [],
          inputVal: '',
          isRunning: false,
          activeRunId: null,
          commandHistory: [],
          historyIndex: -1
        }
        setSessions((prev) => [...prev, newSession])
        setActiveSessionId(newId)
      }
      setTimeout(() => inputRef.current?.focus(), 80)
    },
    [activeSession, onSelectTab, updateActiveSession]
  )

  const handleRunCommand = useCallback(
    (cmdToRun?: string) => {
      if (!activeSession) return
      const rawCmd = (cmdToRun !== undefined ? cmdToRun : activeSession.inputVal).trim()
      if (!rawCmd || activeSession.isRunning) return

      // Handle 'clear' or 'cls'
      if (rawCmd.toLowerCase() === 'clear' || rawCmd.toLowerCase() === 'cls') {
        updateActiveSession(() => ({
          entries: [],
          inputVal: '',
          historyIndex: -1
        }))
        return
      }

      // Handle drive letter change on Windows (e.g. "D:" or "d:")
      const driveMatch = rawCmd.match(/^([a-zA-Z]):$/)
      if (driveMatch) {
        const nextCwd = driveMatch[1].toUpperCase() + ':\\'
        updateActiveSession((prev) => ({
          cwd: nextCwd,
          entries: [
            ...prev.entries,
            {
              id: `drive_${Date.now()}`,
              command: rawCmd,
              cwd: prev.cwd || defaultCwdRef.current || '.',
              output: [],
              exitCode: 0
            }
          ],
          commandHistory:
            prev.commandHistory[prev.commandHistory.length - 1] === rawCmd
              ? prev.commandHistory
              : [...prev.commandHistory, rawCmd],
          historyIndex: -1,
          inputVal: ''
        }))
        return
      }

      // Handle 'cd' directory navigation
      const cdMatch = rawCmd.match(/^cd(?:\s+(.*))?$/i)
      if (cdMatch) {
        let rawTarget = (cdMatch[1] || '').trim().replace(/^["']|["']$/g, '')
        if (/^\/d\s+/i.test(rawTarget)) {
          rawTarget = rawTarget.replace(/^\/d\s+/i, '').trim().replace(/^["']|["']$/g, '')
        }
        let nextCwd = activeSession.cwd || defaultCwdRef.current
        if (!rawTarget || rawTarget === '~') {
          nextCwd = defaultCwdRef.current || activeProject?.path || process.cwd()
        } else if (/^[a-zA-Z]:[\\/]/.test(rawTarget)) {
          nextCwd = rawTarget
        } else if (rawTarget === '..' || rawTarget.startsWith('..')) {
          const parts = rawTarget.split(/[\\/]/)
          let cur = (activeSession.cwd || defaultCwdRef.current).replace(/[\\/]+$/, '')
          for (const p of parts) {
            if (p === '..') {
              const lastSlash = Math.max(cur.lastIndexOf('/'), cur.lastIndexOf('\\'))
              if (lastSlash > 2) cur = cur.slice(0, lastSlash)
              else if (lastSlash === 2 && cur[1] === ':') cur = cur.slice(0, 3)
            } else if (p && p !== '.') {
              cur = cur.endsWith('\\') || cur.endsWith('/') ? cur + p : cur + '\\' + p
            }
          }
          nextCwd = cur
        } else {
          const base = activeSession.cwd || defaultCwdRef.current
          nextCwd = base.endsWith('\\') || base.endsWith('/')
            ? base + rawTarget
            : base + '\\' + rawTarget
        }

        updateActiveSession((prev) => ({
          cwd: nextCwd,
          entries: [
            ...prev.entries,
            {
              id: `cd_${Date.now()}`,
              command: rawCmd,
              cwd: prev.cwd || defaultCwdRef.current || '.',
              output: [],
              exitCode: 0
            }
          ],
          commandHistory:
            prev.commandHistory[prev.commandHistory.length - 1] === rawCmd
              ? prev.commandHistory
              : [...prev.commandHistory, rawCmd],
          historyIndex: -1,
          inputVal: ''
        }))
        return
      }

      const runId = `cmd_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`
      const newEntry: CommandHistoryEntry = {
        id: runId,
        command: rawCmd,
        cwd: activeSession.cwd || defaultCwdRef.current || '.',
        output: [],
        exitCode: null
      }

      updateActiveSession((prev) => ({
        entries: [...prev.entries, newEntry],
        commandHistory:
          prev.commandHistory[prev.commandHistory.length - 1] === rawCmd
            ? prev.commandHistory
            : [...prev.commandHistory, rawCmd],
        historyIndex: -1,
        inputVal: '',
        isRunning: true,
        activeRunId: runId
      }))

      window.api?.terminal?.run({
        runId,
        command: rawCmd,
        cwd: activeSession.cwd || defaultCwdRef.current || undefined,
        sessionId: activeSession.id
      })
    },
    [activeSession, updateActiveSession, activeProject]
  )

  const handleStopCommand = useCallback(() => {
    if (!activeSession) return
    if (activeSession.activeRunId) {
      window.api?.terminal?.kill(activeSession.activeRunId)
      updateActiveSession((prev) => ({
        isRunning: false,
        activeRunId: null,
        entries: prev.entries.map((item) => {
          if (item.id === prev.activeRunId) {
            return {
              ...item,
              exitCode: 130,
              output: [...item.output, '^C']
            }
          }
          return item
        })
      }))
      setTimeout(() => inputRef.current?.focus(), 50)
    }
  }, [activeSession, updateActiveSession])

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>): void => {
    if (!activeSession) return

    if (e.key === 'Enter') {
      e.preventDefault()
      if (activeSession.isRunning) {
        const stdinText = activeSession.inputVal ?? ''
        window.api?.terminal?.sendInput({
          targetId: activeSession.activeRunId || activeSession.id,
          input: stdinText
        })
        updateActiveSession((prev) => ({
          inputVal: '',
          entries: prev.entries.map((item) => {
            if (item.id === prev.activeRunId) {
              return {
                ...item,
                output: [...item.output, `[stdin]: ${stdinText || '↵'}`]
              }
            }
            return item
          })
        }))
      } else {
        handleRunCommand()
      }
    }
 else if (e.key === 'ArrowUp') {
      e.preventDefault()
      if (activeSession.commandHistory.length === 0) return
      const nextIdx =
        activeSession.historyIndex === -1
          ? activeSession.commandHistory.length - 1
          : Math.max(0, activeSession.historyIndex - 1)
      updateActiveSession(() => ({
        historyIndex: nextIdx,
        inputVal: activeSession.commandHistory[nextIdx] || ''
      }))
    } else if (e.key === 'ArrowDown') {
      e.preventDefault()
      if (activeSession.historyIndex === -1) return
      const nextIdx = activeSession.historyIndex + 1
      if (nextIdx >= activeSession.commandHistory.length) {
        updateActiveSession(() => ({
          historyIndex: -1,
          inputVal: ''
        }))
      } else {
        updateActiveSession(() => ({
          historyIndex: nextIdx,
          inputVal: activeSession.commandHistory[nextIdx] || ''
        }))
      }
    } else if (e.key === 'c' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault()
      if (activeSession.isRunning) {
        handleStopCommand()
      } else {
        if (activeSession.inputVal) {
          updateActiveSession((prev) => ({
            entries: [
              ...prev.entries,
              {
                id: `cancel_${Date.now()}`,
                command: `${prev.inputVal} ^C`,
                cwd: prev.cwd || defaultCwdRef.current || '.',
                output: [],
                exitCode: null
              }
            ],
            inputVal: '',
            historyIndex: -1
          }))
        }
      }
    } else if (e.key === 'l' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault()
      updateActiveSession(() => ({
        entries: []
      }))
    }
  }

  const handleContainerClick = (): void => {
    const sel = window.getSelection()
    if (!sel || sel.toString().length === 0) {
      inputRef.current?.focus()
    }
  }

  const getPromptPath = (fullPath: string): string => {
    if (!fullPath) return 'C:\\'
    return fullPath
  }

  return (
    <aside
      className={`right-panel-container ${isOpen ? 'open' : 'closed'}`}
      style={isOpen && panelWidth ? { width: panelWidth } : undefined}
      aria-label="Правая панель"
    >
      {/* Resizer handle on left border */}
      <div
        className="right-panel-resizer"
        onMouseDown={handleStartResize}
        title="Перетащите для изменения ширины"
      />

      <div className="right-panel-inner">
        {/* Unified Top Header (60px) perfectly aligned with TitleBar */}
        <div className="right-panel-header">
          <div className="right-panel-header-tabs">
            <button
              type="button"
              className={`right-panel-icon-tab ${activeTab === 'terminal' ? 'active' : ''}`}
              onClick={() => {
                setViewingItem(null)
                onSelectTab?.('terminal')
              }}
              title="Терминал"
              aria-label="Терминал"
            >
              <Terminal size={15} strokeWidth={1.8} />
            </button>
            <button
              type="button"
              className={`right-panel-icon-tab ${activeTab === 'files' ? 'active' : ''}`}
              onClick={() => {
                setViewingItem(null)
                onSelectTab?.('files')
              }}
              title="Файлы проекта"
              aria-label="Файлы проекта"
            >
              <Folder size={15} strokeWidth={1.8} />
            </button>
            <button
              type="button"
              className={`right-panel-icon-tab ${activeTab === 'activity' ? 'active' : ''}`}
              onClick={() => {
                setViewingItem(null)
                setUnreadActivityCount(0)
                onSelectTab?.('activity')
              }}
              title="Лог действий и файлы"
              aria-label="Лог действий и файлы"
            >
              <History size={15} strokeWidth={1.8} />
              {unreadActivityCount > 0 && (
                <span className="right-panel-tab-badge">{unreadActivityCount}</span>
              )}
            </button>
            <button
              type="button"
              className={`right-panel-icon-tab ${activeTab === 'browser' ? 'active' : ''}`}
              onClick={() => {
                setViewingItem(null)
                onSelectTab?.('browser')
              }}
              title="Встроенный браузер"
              aria-label="Встроенный браузер"
            >
              <Globe size={15} strokeWidth={1.8} />
            </button>
          </div>

          <div className="right-panel-header-actions">
            {activeTab === 'terminal' && (
              <button
                type="button"
                className="right-panel-action-btn"
                onClick={handleClearActiveTerminal}
                title="Очистить терминал (Ctrl+L)"
                aria-label="Очистить"
              >
                <Trash2 size={13} strokeWidth={1.8} />
              </button>
            )}
            {activeTab === 'activity' && !viewingItem && activityItems.length > 0 && (
              <button
                type="button"
                className="right-panel-action-btn"
                onClick={handleClearActivity}
                title="Очистить лог действий"
                aria-label="Очистить лог"
              >
                <Trash2 size={13} strokeWidth={1.8} />
              </button>
            )}
            {onClose && (
              <button
                type="button"
                className="right-panel-action-btn close-panel"
                onClick={onClose}
                title="Закрыть панель (Esc)"
                aria-label="Закрыть"
              >
                <X size={14} strokeWidth={2} />
              </button>
            )}
            <div className="right-panel-divider" />
            <WindowControls />
          </div>
        </div>

        {activeTab === 'terminal' && (
          <div className="terminal-container-wrapper">
            {/* Terminal Tabs Strip */}
            <div className="terminal-tabs-bar">
              <div className="terminal-tabs-list" ref={tabsListRef}>
                {sessions.map((sess) => {
                  const isActive = sess.id === activeSessionId
                  const cleanTabTitle =
                    sess.name.replace(/[\u{1F300}-\u{1F9FF}]/gu, '').replace(/🤖/g, '').trim() || 'terminal'
                  const isDragging = draggedTabId === sess.id
                  const isDragOver = dragOverTabId === sess.id

                  return (
                    <button
                      key={sess.id}
                      type="button"
                      draggable={true}
                      onDragStart={(e) => handleTabDragStart(e, sess.id)}
                      onDragOver={(e) => handleTabDragOver(e, sess.id)}
                      onDragLeave={handleTabDragLeave}
                      onDrop={(e) => handleTabDrop(e, sess.id)}
                      onDragEnd={handleTabDragEnd}
                      className={`terminal-tab-item ${isActive ? 'active' : ''} ${sess.isAi ? 'ai-tab' : ''} ${isDragging ? 'dragging' : ''} ${isDragOver ? 'drag-over' : ''}`}
                      onClick={() => handleSelectSession(sess.id)}
                      title={`${cleanTabTitle}\n${sess.cwd}\n${sess.isRunning ? 'Выполняется...' : 'Завершено'}\n(Перетащите для изменения порядка)`}
                    >
                      {sess.isAi ? (
                        <Bot size={13} strokeWidth={1.8} className="terminal-tab-icon terminal-tab-icon-ai" />
                      ) : (
                        <Terminal size={12} strokeWidth={1.8} className="terminal-tab-icon" />
                      )}
                      <span className="terminal-tab-title">{cleanTabTitle}</span>
                      {sess.isRunning && (
                        <span className="terminal-running-dot" title="Выполняется фоновая команда..." />
                      )}
                      <span
                        className="terminal-tab-close"
                        onClick={(e) => {
                          e.stopPropagation()
                          handleCloseSession(sess.id)
                        }}
                        title={sessions.length > 1 ? 'Закрыть терминал' : 'Очистить / перезапустить терминал'}
                        aria-label="Закрыть терминал"
                      >
                        <X size={11} strokeWidth={2} />
                      </span>
                    </button>
                  )
                })}
              </div>

              <button
                type="button"
                className="terminal-add-tab-btn"
                onClick={handleCreateSession}
                title="Новый терминал"
                aria-label="Новый терминал"
              >
                <Plus size={13} strokeWidth={2.2} />
              </button>
            </div>

            {/* Active Terminal Canvas */}
            <div
              className="ide-terminal-canvas"
              ref={containerRef}
              onClick={handleContainerClick}
            >
              {/* Shell system banner */}
              <div className="ide-term-banner">
                Windows PowerShell [{activeSession?.name || 'powershell'}]
                <br />
                Copyright (C) Microsoft Corporation. All rights reserved.
              </div>

              {/* Render executed command history & outputs for active session */}
              {activeSession?.entries.map((entry) => (
                <div key={entry.id} className="ide-term-entry">
                  <div className="ide-term-line ide-term-cmd-row">
                    <span className="ide-term-ps">PS </span>
                    <span className="ide-term-path">{getPromptPath(entry.cwd)}&gt; </span>
                    <span className="ide-term-cmd">{entry.command}</span>
                  </div>

                  {entry.output.length > 0 && (
                    <div className="ide-term-output-stream">
                      {entry.output.map((line, idx) => {
                        const trimmed = line.trim()
                        if (!trimmed && idx === entry.output.length - 1) return null
                        const isErr =
                          /error|exception/i.test(trimmed) && !/node_modules/i.test(trimmed)

                        return (
                          <div
                            key={idx}
                            className={`ide-term-line ${isErr ? 'ide-term-err' : ''}`}
                          >
                            {line || '\u00A0'}
                          </div>
                        )
                      })}
                    </div>
                  )}
                </div>
              ))}

              {/* Active Inline Prompt Line */}
              {!activeSession?.isRunning ? (
                <div className="ide-term-line ide-term-active-line">
                  <span className="ide-term-ps">PS </span>
                  <span className="ide-term-path">
                    {getPromptPath(activeSession?.cwd || defaultCwdRef.current)}&gt;{' '}
                  </span>
                  <div className="ide-term-input-box">
                    <input
                      ref={inputRef}
                      type="text"
                      className="ide-term-real-input"
                      value={activeSession?.inputVal || ''}
                      onChange={(e) =>
                        updateActiveSession(() => ({ inputVal: e.target.value }))
                      }
                      onKeyDown={handleKeyDown}
                      autoFocus
                      spellCheck={false}
                      autoComplete="off"
                      autoCorrect="off"
                      autoCapitalize="off"
                    />
                  </div>
                </div>
              ) : (
                <div className="ide-term-line ide-term-active-line ide-term-running-line">
                  <span className="ide-term-ps ide-term-stdin-prompt">&gt; </span>
                  <div className="ide-term-input-box">
                    <input
                      ref={inputRef}
                      type="text"
                      className="ide-term-real-input"
                      placeholder="Ввод в процесс (stdin)... [Ctrl+C для отмены]"
                      value={activeSession?.inputVal || ''}
                      onChange={(e) =>
                        updateActiveSession(() => ({ inputVal: e.target.value }))
                      }
                      onKeyDown={handleKeyDown}
                      autoFocus
                      spellCheck={false}
                      autoComplete="off"
                      autoCorrect="off"
                      autoCapitalize="off"
                    />
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {activeTab === 'files' &&
          (viewingItem ? (
            <CodeDiffViewer
              filePath={viewingItem.filePath}
              fileName={viewingItem.fileName}
              oldContent={viewingItem.oldContent}
              newContent={viewingItem.newContent}
              isDiff={viewingItem.isDiff}
              stats={viewingItem.stats}
              onBack={() => setViewingItem(null)}
            />
          ) : (
            <ProjectFileTree
              rootPath={activeProject?.path || activeSession?.cwd || defaultCwdRef.current}
              onOpenInTerminal={handleOpenInTerminal}
              onOpenFile={handleOpenFileFromTree}
            />
          ))}

        {activeTab === 'activity' &&
          (viewingItem ? (
            <CodeDiffViewer
              filePath={viewingItem.filePath}
              fileName={viewingItem.fileName}
              oldContent={viewingItem.oldContent}
              newContent={viewingItem.newContent}
              isDiff={viewingItem.isDiff}
              stats={viewingItem.stats}
              onBack={() => setViewingItem(null)}
            />
          ) : (
            <ActivityLogView
              items={activityItems}
              onSelectItem={handleSelectActivityItem}
              onClearLog={handleClearActivity}
              activeProject={activeProject}
            />
          ))}

        <div
          className="browser-panel-tab-wrapper"
          style={{
            display: activeTab === 'browser' ? 'flex' : 'none',
            flex: 1,
            height: '100%',
            width: '100%',
            overflow: 'hidden'
          }}
        >
          <BrowserView />
        </div>
      </div>
    </aside>
  )
}

export default RightSidePanel
