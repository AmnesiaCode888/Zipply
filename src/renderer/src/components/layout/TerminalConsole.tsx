import React, { useRef, useState } from 'react'
import type { useTerminalSessions } from '../../hooks/useTerminalSessions'

type TerminalApi = ReturnType<typeof useTerminalSessions>
interface TerminalConsoleProps extends Pick<TerminalApi, 'attachSession' | 'loadAiLog' | 'subscribeOutput' | 'resizeSession' | 'writeToSession'> {
  terminalId?: string
  interactive?: boolean
  refreshVersion?: number
}

function readXtermTheme() {
  if (typeof window === 'undefined') {
    return { background: '#181818', foreground: '#ECECEC', cursor: '#ECECEC' }
  }
  const styles = getComputedStyle(document.documentElement)
  const read = (name: string, fallback: string) => styles.getPropertyValue(name).trim() || fallback
  const isLight = document.documentElement.getAttribute('data-theme') === 'light'
  const bg = read('--bg-canvas', '#181818')
  const fg = read('--text-primary', '#ECECEC')
  const muted = read('--text-muted', '#686868')
  const selection = isLight ? 'rgba(0, 0, 0, 0.16)' : 'rgba(255, 255, 255, 0.16)'
  const add = read('--diff-add', isLight ? '#1A7F37' : '#30D158')
  const remove = read('--diff-remove', isLight ? '#CF222E' : '#FF453A')
  const accent = read('--accent', '#0A84FF')
  return {
    background: bg,
    foreground: fg,
    cursor: fg,
    cursorAccent: bg,
    selectionBackground: selection,
    black: isLight ? '#111113' : '#1A1A1A',
    red: remove,
    green: add,
    yellow: isLight ? '#9A6700' : '#FCD34D',
    blue: accent,
    magenta: isLight ? '#8250DF' : '#D8B4FE',
    cyan: isLight ? '#0550AE' : '#67E8F9',
    white: fg,
    brightBlack: muted,
    brightRed: remove,
    brightGreen: add,
    brightYellow: isLight ? '#9A6700' : '#FDE68A',
    brightBlue: accent,
    brightMagenta: isLight ? '#8250DF' : '#E9D5FF',
    brightCyan: isLight ? '#0550AE' : '#A5F3FC',
    brightWhite: read('--text-strong', '#FFFFFF')
  }
}


export function TerminalConsole({
  terminalId, interactive = false, refreshVersion, attachSession, loadAiLog, subscribeOutput, resizeSession, writeToSession
}: TerminalConsoleProps) {
  const host = useRef<HTMLDivElement>(null)
  const [error, setError] = useState('')
  React.useEffect(() => {
    const container = host.current
    if (!container) return
    let disposed = false
    let cleanup: (() => void) | undefined
    setError('')

    const mount = async () => {
      const [{ Terminal }, { FitAddon }, { WebLinksAddon }] = await Promise.all([
        import('@xterm/xterm'),
        import('@xterm/addon-fit'),
        import('@xterm/addon-web-links')
      ])
      if (disposed) return
      const term = new Terminal({
        theme: readXtermTheme(),
        fontFamily: '"SF Mono", SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace',
        fontSize: 14.5,
        lineHeight: 1.45,
        cursorBlink: interactive,
        cursorStyle: 'bar',
        disableStdin: !interactive,
        scrollback: 10000,
        convertEol: true
      })
      const fit = new FitAddon()
      term.loadAddon(fit)
      term.loadAddon(new WebLinksAddon())
      term.open(container)
      const fitTerminal = () => {
        fit.fit()
        if (terminalId && term.cols > 0 && term.rows > 0) resizeSession(terminalId, term.cols, term.rows)
      }

      const resize = new ResizeObserver(fitTerminal)
      resize.observe(container)
      const theme = new MutationObserver(() => { term.options.theme = readXtermTheme() })
      theme.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'data-theme-scheme'] })
      let cursor: number | undefined
      let pending = ''
      let pendingCursor = 0
      const unsubscribe = terminalId ? subscribeOutput((id, chunk, next) => {
        if (id !== terminalId) return
        if (cursor === undefined) {
          pending = (pending + chunk).slice(-512 * 1024)
          pendingCursor = next
          return
        }
        if (next <= cursor) return
        term.write(chunk.slice(-Math.min(chunk.length, next - cursor)))
        cursor = next
      }) : undefined
      const input = interactive && terminalId ? term.onData(chars => {
        if (cursor !== undefined) writeToSession(terminalId, chars)
      }) : undefined
      cleanup = () => {
        unsubscribe?.()
        input?.dispose()
        resize.disconnect()
        theme.disconnect()
        term.dispose()
      }
      fitTerminal()

      if (terminalId) {
        const snapshot = await attachSession(terminalId)
        if (disposed) return
        if (!snapshot) throw new Error('Вывод этой сессии недоступен.')
        term.write(snapshot.rawBuffer)
        cursor = snapshot.rawCursor
        if (pendingCursor > cursor) {
          term.write(pending.slice(-Math.min(pending.length, pendingCursor - cursor)))
          cursor = pendingCursor
        }
        pending = ''
      } else {
        const log = await loadAiLog()
        if (!disposed) term.write(log || '\x1b[2mИстория терминала пока пуста.\x1b[0m\r\n')
      }
    }

    void mount().catch(() => {
      if (!disposed) setError(terminalId ? 'Не удалось открыть вывод сессии.' : 'Не удалось загрузить историю терминала.')
    })
    return () => {
      disposed = true
      cleanup?.()
    }
  }, [terminalId, interactive, refreshVersion, attachSession, loadAiLog, subscribeOutput, resizeSession, writeToSession])

  return (
    <div className="relative flex min-h-0 min-w-0 flex-1 overflow-hidden rounded-[20px] bg-canvas">
      <div ref={host} className="h-full w-full overflow-hidden p-3.5" />
      {error && <p role="alert" className="absolute inset-x-3.5 top-3.5 text-[14px] text-secondary">{error}</p>}
    </div>
  )
}
