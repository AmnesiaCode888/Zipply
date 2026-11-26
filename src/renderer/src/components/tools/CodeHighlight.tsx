import React from 'react'
import { highlightCodeTokens } from './syntaxTokenizer'

interface CodeHighlightProps {
  code: string
  startLine?: number
  language?: 'csharp' | 'typescript' | 'bash'
}

// Apple Dark Mode syntax highlighter with line numbers
export const CodeHighlight: React.FC<CodeHighlightProps> = ({ code, startLine = 1 }) => {
  const lines = code.trim().split('\n')

  return (
    <div className="flex min-w-full w-max flex-col font-mono text-[14px] leading-[24px] select-text">
      {lines.map((line, idx) => (
        <div key={idx} className="flex rounded-[8px] px-1 -mx-1 hover:bg-hover">
          <span className="w-9 shrink-0 select-none pr-3 text-right text-[12px] text-muted">
            {startLine + idx}
          </span>
          <span className="flex-1 whitespace-pre text-primary">
            {highlightCodeTokens(line)}
          </span>
        </div>
      ))}
    </div>
  )
}
