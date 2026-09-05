import React, { useState, useEffect, useRef, useCallback } from 'react'
import { Folder, Plus, X, Terminal, Trash2, Bot } from 'lucide-react'
import { WindowControls } from './WindowControls'
import { ProjectRef } from '../types/chat'
import { ProjectFileTree } from './files/ProjectFileTree'
import './RightSidePanel.css'

export interface RightSidePanelProps {
  isOpen: boolean
  activeTab?: 'terminal' | 'files'
  onSelectTab?: (tab: 'terminal' | 'files') => void
  onClose?: () => void
  activeProject?: ProjectRef | null
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

export const RightSidePanel: React.FC<RightSidePanelProps> = ({
  isOpen,
  activeTab = 'terminal',
  onSelectTab,
  onClose,
  activeProject,
  panelWidth = 440,
  onResize
}) => {
  const defaultCwdRef = useRef<string>('')
  const nextSessionCounter = useRef<number>(2)

  const [sessions, setSessions] = useState<TerminalSession[]>(() => [
    {
      id: 'term_1',
      name: '1: powershell',
      cwd: activeProject?.path || '',
      entries: [],
      inputVal: '',
      isRunning: false,
      activeRunId: null,
      commandHistory: [],
      historyIndex: -1
    }
  ])
  const [activeSessionId, setActiveSessionId] = useState<string>('term_1')

  const containerRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

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
            return { ...s, ...updater(s) }
          }
          return s
        })
      )
    },
    [activeSessionId]
  )

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

  // Sync CWD with active project
  useEffect(() => {
    if (activeProject?.path) {
      defaultCwdRef.current = activeProject.path
      setSessions((prev) =>
        prev.map((s) => (s.entries.length === 0 ? { ...s, cwd: activeProject.path } : s))
      )
    }
  }, [activeProject])

  // Focus input when terminal opens or tab switches
  useEffect(() => {
    if (isOpen && activeTab === 'terminal') {
      setTimeout(() => {
        inputRef.current?.focus()
      }, 50)
    }
  }, [isOpen, activeTab, activeSessionId, activeSession?.isRunning])

  // Auto-scroll to bottom on new output or typing in active session
  useEffect(() => {
    if (containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight
    }
  }, [activeSession?.entries, activeSession?.isRunning, activeSession?.inputVal, activeSessionId])

  // Subscribe to terminal output & exit events (Routes to proper session even in background)
  useEffect(() => {
    if (!window.api?.terminal) return

    const unsubData = window.api.terminal.onData(({ runId, text }) => {
      setSessions((prev) =>
        prev.map((sess) => {
          const hasEntry = sess.entries.some((e) => e.id === runId)
          if (sess.activeRunId === runId || hasEntry) {
            const rawLines = text.split('\n')
            return {
              ...sess,
              entries: sess.entries.map((item) => {
                if (item.id === runId) {
                  return {
                    ...item,
                    output: [...item.output, ...rawLines]
                  }
                }
                return item
              })
            }
          }
          return sess
        })
      )
    })

    const unsubExit = window.api.terminal.onExit(({ runId, code }) => {
      setSessions((prev) =>
        prev.map((sess) => {
          const hasEntry = sess.entries.some((e) => e.id === runId)
          if (sess.activeRunId === runId || hasEntry) {
            return {
              ...sess,
              isRunning: false,
              activeRunId: null,
              entries: sess.entries.map((item) => {
                if (item.id === runId) {
                  return {
                    ...item,
                    exitCode: code
                  }
                }
                return item
              })
            }
          }
          return sess
        })
      )
      setTimeout(() => inputRef.current?.focus(), 50)
    })

    // AI Terminal listeners (Commands triggered by AI agent)
    const unsubAiStart = window.api.terminal.onAiStart?.(({ runId, command, cwd }) => {
      const sessionId = `term_ai_${runId}`
      const tabTitle = formatAiTabName(command)

      setSessions((prev) => {
        const newEntry: CommandHistoryEntry = {
          id: runId,
          command,
          cwd: cwd || '.',
          output: [],
          exitCode: null
        }

        const existing = prev.find((s) => s.id === sessionId)
        if (existing) {
          return prev.map((s) => {
            if (s.id === sessionId) {
              return {
                ...s,
                name: tabTitle,
                cwd: cwd || s.cwd,
                isRunning: true,
                activeRunId: runId,
                entries: [...s.entries, newEntry]
              }
            }
            return s
          })
        }

        const freshAiSession: TerminalSession = {
          id: sessionId,
          name: tabTitle,
          cwd: cwd || '.',
          entries: [newEntry],
          inputVal: '',
          isRunning: true,
          activeRunId: runId,
          commandHistory: [],
          historyIndex: -1,
          isAi: true
        }
        return [...prev, freshAiSession]
      })

      setActiveSessionId(sessionId)
    })

    const unsubAiData = window.api.terminal.onAiData?.(({ runId, text }) => {
      const targetSessionId = `term_ai_${runId}`
      setSessions((prev) =>
        prev.map((sess) => {
          const isTarget =
            sess.id === targetSessionId ||
            sess.activeRunId === runId ||
            sess.entries.some((e) => e.id === runId)
          if (isTarget) {
            const rawLines = text.split('\n')
            return {
              ...sess,
              entries: sess.entries.map((item) => {
                if (item.id === runId || sess.activeRunId === runId) {
                  return {
                    ...item,
                    output: [...item.output, ...rawLines]
                  }
                }
                return item
              })
            }
          }
          return sess
        })
      )
    })

    const unsubAiExit = window.api.terminal.onAiExit?.(({ runId, code }) => {
      const targetSessionId = `term_ai_${runId}`
      setSessions((prev) =>
        prev.map((sess) => {
          const isTarget =
            sess.id === targetSessionId ||
            sess.activeRunId === runId ||
            sess.entries.some((e) => e.id === runId)
          if (isTarget) {
            return {
              ...sess,
              isRunning: false,
              activeRunId: null,
              entries: sess.entries.map((item) => {
                if (item.id === runId || sess.activeRunId === runId) {
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
      )
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
        const minW = 280
        const sidebarEl = document.querySelector('.sidebar-container.open') as HTMLElement | null
        const currentSidebarW = sidebarEl ? sidebarEl.offsetWidth : 0
        const maxW = Math.max(minW, Math.min(window.innerWidth - currentSidebarW - 380, 850))
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

      // Handle 'cd' directory navigation
      const cdMatch = rawCmd.match(/^cd(?:\s+(.*))?$/i)
      if (cdMatch) {
        const rawTarget = (cdMatch[1] || '').trim().replace(/^["']|["']$/g, '')
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
        const stdinText = activeSession.inputVal
        if (stdinText) {
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
                  output: [...item.output, `[stdin]: ${stdinText}`]
                }
              }
              return item
            })
          }))
        }
      } else {
        handleRunCommand()
      }
    } else if (e.key === 'ArrowUp') {
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
              onClick={() => onSelectTab?.('terminal')}
              title="Терминал"
              aria-label="Терминал"
            >
              <Terminal size={15} strokeWidth={1.8} />
            </button>
            <button
              type="button"
              className={`right-panel-icon-tab ${activeTab === 'files' ? 'active' : ''}`}
              onClick={() => onSelectTab?.('files')}
              title="Файлы проекта"
              aria-label="Файлы проекта"
            >
              <Folder size={15} strokeWidth={1.8} />
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
              <div className="terminal-tabs-list">
                {sessions.map((sess) => {
                  const isActive = sess.id === activeSessionId
                  const cleanTabTitle =
                    sess.name.replace(/[\u{1F300}-\u{1F9FF}]/gu, '').replace(/🤖/g, '').trim() || 'terminal'
                  return (
                    <button
                      key={sess.id}
                      type="button"
                      className={`terminal-tab-item ${isActive ? 'active' : ''} ${sess.isAi ? 'ai-tab' : ''}`}
                      onClick={() => setActiveSessionId(sess.id)}
                      title={`${cleanTabTitle}\n${sess.cwd}\n${sess.isRunning ? 'Выполняется...' : 'Завершено'}`}
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
                      {sessions.length > 1 && (
                        <span
                          className="terminal-tab-close"
                          onClick={(e) => {
                            e.stopPropagation()
                            handleCloseSession(sess.id)
                          }}
                          title="Закрыть терминал"
                          aria-label="Закрыть терминал"
                        >
                          <X size={11} strokeWidth={2} />
                        </span>
                      )}
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

        {activeTab === 'files' && (
          <ProjectFileTree
            rootPath={activeProject?.path || activeSession?.cwd || defaultCwdRef.current}
            onOpenInTerminal={handleOpenInTerminal}
          />
        )}
      </div>
    </aside>
  )
}

export default RightSidePanel
