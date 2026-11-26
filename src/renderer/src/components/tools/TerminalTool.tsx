import React from 'react'
import { useFollowStream } from '../../hooks/useFollowStream'

export interface TerminalToolProps {
  command?: string
  output?: string
  status?: 'running' | 'completed' | 'error'
  terminalSessionId?: string
  background?: boolean
  exitCode?: number | null
  elapsedMs?: number
}

export const TerminalTool: React.FC<TerminalToolProps> = ({
  command,
  output,
  status = 'completed',
  terminalSessionId,
  background,
  exitCode,
  elapsedMs
}) => {
  const { scrollRef, handleScroll } = useFollowStream(output, status === 'running')

  const cleanOutput = output?.trim() || ''

  const openInSideTerminal = (): void => {
    window.dispatchEvent(new CustomEvent('zipply:open-terminal', { detail: { terminalId: terminalSessionId } }))
  }

  return (
    <div
      ref={scrollRef}
      onScroll={handleScroll}
      className="w-full p-3.5 max-h-[280px] overflow-y-auto overflow-x-auto code-scrollbar bg-surface-secondary select-text"
    >
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        {command ? (
          <div className="font-mono text-[14.5px] leading-[24px] select-text flex min-w-0 flex-1 items-center gap-2" title={command}>
            <span className="text-secondary select-none" aria-hidden="true">$</span>
            <span className="truncate text-primary font-medium">{command}</span>
          </div>
        ) : (
          <div />
        )}
        <div className="flex shrink-0 items-center gap-2">
          {background && exitCode == null && status !== 'error' && <span className="text-[12px] text-secondary">Фоновая задача</span>}
          {typeof exitCode === 'number' && status !== 'running' && (
            <span className="text-[11.5px] font-mono text-secondary">
              код {exitCode}{typeof elapsedMs === 'number' ? ` · ${elapsedMs} мс` : ''}
            </span>
          )}
          <button
            type="button"
            onClick={openInSideTerminal}
            className="inline-flex h-7 items-center gap-1 rounded-full bg-control px-2.5 text-[12px] font-medium text-secondary hover:bg-control-hover hover:text-primary active:scale-95 border-none shadow-none cursor-pointer"
          >
            {terminalSessionId ? 'В терминале' : 'Журнал терминала'}
          </button>
        </div>
      </div>
      <pre className="font-mono text-[14.5px] leading-[24px] text-secondary whitespace-pre select-text m-0">
        {cleanOutput || (status === 'running' ? 'Выполнение команды...' : '(нет вывода)')}
        {status === 'running' && (
          <span className="inline-block w-1.5 h-3.5 bg-primary opacity-70 ml-1.5 align-middle" />
        )}
      </pre>
    </div>
  )
}
