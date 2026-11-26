import { appStorage } from '../services/appStorage'
import { useCallback, useEffect, useRef, useState } from 'react'

const WIDTH_KEY = 'zipply_workspace_width'
const OPEN_KEY = 'zipply_workspace_open'
const DEFAULT_WIDTH = 440
const MIN_WIDTH = 320
const MIN_CHAT = 360
const MAX_WIDTH = 2000
const RAIL_WIDTH = 56

function readWidth(): number {
  try {
    const stored = appStorage.getItem(WIDTH_KEY)
    const value = Number(stored)
    return stored !== null && Number.isFinite(value) && value >= MIN_WIDTH && value <= MAX_WIDTH ? value : DEFAULT_WIDTH
  } catch { return DEFAULT_WIDTH }
}
function readOpen(): boolean {
  try { return appStorage.getItem(OPEN_KEY) === 'true' } catch { return false }
}
function save(key: string, value: string): void {
  try { appStorage.setItem(key, value) } catch { /* Storage may be unavailable. */ }
}

export function useWorkspacePanel(isChat: boolean, sidebarOpen: boolean, sidebarWidth: number) {
  const [open, setOpen] = useState(readOpen)
  const [width, setWidth] = useState(readWidth)
  const [viewportWidth, setViewportWidth] = useState(() => window.innerWidth)
  const [viewportResizing, setViewportResizing] = useState(false)
  const [resizing, setResizing] = useState(false)
  const widthRef = useRef(width)
  if (!resizing) widthRef.current = width
  const visible = open && isChat
  // Keep this calculation in sync with SidebarContainer's responsive width.
  const actualSidebarWidth = sidebarOpen ? Math.min(sidebarWidth, Math.max(44, viewportWidth - 416)) : 0
  const available = viewportWidth - RAIL_WIDTH - actualSidebarWidth
  const replace = visible && available < MIN_WIDTH + MIN_CHAT
  const hideSidebar = replace && available < MIN_WIDTH
  const effectiveAvailable = viewportWidth - RAIL_WIDTH - (hideSidebar ? 0 : actualSidebarWidth)
  const maxWidth = Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, effectiveAvailable - MIN_CHAT))
  const displayedWidth = Math.min(width, maxWidth)
  const maxWidthRef = useRef(maxWidth)
  maxWidthRef.current = maxWidth

  useEffect(() => {
    let frame = 0
    let timer = 0
    const onResize = () => {
      setViewportResizing(true)
      if (!frame) frame = requestAnimationFrame(() => { frame = 0; setViewportWidth(window.innerWidth) })
      window.clearTimeout(timer)
      timer = window.setTimeout(() => setViewportResizing(false), 150)
    }
    window.addEventListener('resize', onResize)
    return () => { window.removeEventListener('resize', onResize); cancelAnimationFrame(frame); window.clearTimeout(timer) }
  }, [])
  useEffect(() => {
    if (!resizing) return
    let frame = 0
    const move = (event: MouseEvent) => {
      widthRef.current = Math.round(Math.max(MIN_WIDTH, Math.min(maxWidthRef.current, window.innerWidth - event.clientX)))
      if (!frame) frame = requestAnimationFrame(() => { frame = 0; setWidth(widthRef.current) })
    }
    const stop = () => { cancelAnimationFrame(frame); frame = 0; setWidth(widthRef.current); setResizing(false); save(WIDTH_KEY, String(widthRef.current)) }
    document.addEventListener('mousemove', move)
    document.addEventListener('mouseup', stop)
    window.addEventListener('blur', stop)
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
    return () => {
      document.removeEventListener('mousemove', move)
      document.removeEventListener('mouseup', stop)
      window.removeEventListener('blur', stop)
      cancelAnimationFrame(frame)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }
  }, [resizing])
  useEffect(() => { if (!visible || replace) setResizing(false) }, [visible, replace])
  const toggle = useCallback(() => setOpen(previous => { const next = !previous; save(OPEN_KEY, String(next)); return next }), [])
  const openPanel = useCallback(() => setOpen(() => { save(OPEN_KEY, 'true'); return true }), [])
  const startResize = useCallback(() => setResizing(true), [])
  const setSavedWidth = useCallback((value: number) => {
    const next = Math.max(MIN_WIDTH, Math.min(maxWidth, value))
    setWidth(next)
    save(WIDTH_KEY, String(next))
  }, [maxWidth])
  const resetWidth = useCallback(() => {
    setWidth(DEFAULT_WIDTH)
    save(WIDTH_KEY, String(DEFAULT_WIDTH))
  }, [])
  return { open, visible, replace, hideSidebar, resizing, viewportResizing, displayedWidth, maxWidth, toggle, openPanel,
    startResize, resetWidth, setSavedWidth }
}

