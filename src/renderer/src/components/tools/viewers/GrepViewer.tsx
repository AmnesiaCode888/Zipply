import React from 'react'
import { StepArgs } from '../../../types/chat'
import { getBaseName } from '../../../utils/markdown'

interface GrepViewerProps {
  args?: StepArgs
  result?: string
}

export const GrepViewer: React.FC<GrepViewerProps> = ({ args, result }) => {
  const text = typeof result === 'string' ? result : ''
  const query = (args?.query as string) || ''

  const lines = text.split('\n').filter((l) => l.trim())
  const groups: Record<string, Array<{ lineNo: number; code: string }>> = {}
  for (const line of lines) {
    const m = line.match(/^([^:]+):(\d+):(.*)$/)
    if (m) {
      const [, file, lineNo, code] = m
      if (!groups[file]) groups[file] = []
      groups[file].push({ lineNo: parseInt(lineNo, 10), code })
    }
  }

  const groupEntries = Object.entries(groups).map(([file, matches]) => ({ file, matches }))

  if (groupEntries.length === 0) {
    return <div className="unified-empty-msg">No matches for "{query}"</div>
  }

  return (
    <div className="unified-tool-box">
      <div className="unified-code-scroll mono">
        {groupEntries.map((g, gi) => (
          <div key={gi} className="unified-grep-group">
            <div className="unified-grep-title">{getBaseName(g.file)}</div>
            {g.matches.map((m, mi) => (
              <div key={mi} className="unified-code-row">
                <span className="unified-ln">L{m.lineNo}</span>
                <span className="unified-code-text">{m.code}</span>
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  )
}

export default GrepViewer
