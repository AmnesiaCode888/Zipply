import React from 'react'
import { DiffViewer } from './DiffViewer'
import { highlightCodeTokens } from './syntaxTokenizer'
import { useFollowStream } from '../../hooks/useFollowStream'

export interface FileEditToolProps {
  fileName?: string
  diff?: { added?: number; removed?: number }
  diffText?: string
  oldCode?: string
  newCode?: string
  content?: string
  status?: 'running' | 'completed' | 'error'
}

const StreamingCodeLine = React.memo(({ line, index, isLast }: { line: string; index: number; isLast: boolean }) => (
  <div className="flex items-stretch min-w-full w-max px-3.5 py-[1px]">
    <span className="w-8 shrink-0 select-none text-muted text-right pr-3 text-[11px] font-mono">
      {index + 1}
    </span>
    <span className="text-primary whitespace-pre font-mono">
      {line ? highlightCodeTokens(line) : ' '}
      {isLast && <span className="inline-block w-1.5 h-3.5 ml-0.5 bg-primary align-middle" />}
    </span>
  </div>
))

export const FileEditTool: React.FC<FileEditToolProps> = ({
  diffText,
  oldCode,
  newCode,
  content = '',
  status
}) => {
  const { scrollRef, handleScroll } = useFollowStream(content, status === 'running')

  // Show the file content as the model generates the tool arguments.
  if (status === 'running') {
    const raw = content || ''
    const lines = raw ? raw.split('\n') : ['']

    return (
      <div
        ref={scrollRef}
        onScroll={handleScroll}
        className="w-full py-2.5 max-h-[320px] overflow-y-auto overflow-x-auto code-scrollbar bg-surface-secondary select-text"
      >
        <div className="min-w-full w-max flex flex-col font-mono text-[12px] leading-[20px]">
          {lines.map((line, idx) => (
            <StreamingCodeLine key={idx} line={line} index={idx} isLast={idx === lines.length - 1} />
          ))}
        </div>
      </div>
    )
  }

  // Final diff card upon completion
  return (
    <div className="w-full py-2 max-h-[320px] overflow-y-auto overflow-x-auto code-scrollbar bg-surface-secondary">
      <DiffViewer
        oldCode={oldCode}
        newCode={newCode}
        diffText={diffText || content}
      />
    </div>
  )
}

