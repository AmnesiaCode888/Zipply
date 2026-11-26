import React from 'react'
import * as Diff from 'diff'
import { highlightCodeTokens } from './syntaxTokenizer'

interface DiffViewerProps {
  oldCode?: string
  newCode?: string
  diffText?: string
}

interface DiffLine {
  type: 'added' | 'removed' | 'unchanged'
  text: string
  oldLineNumber?: number
  newLineNumber?: number
}

export const DiffViewer: React.FC<DiffViewerProps> = ({ oldCode, newCode, diffText }) => {
  const lines: DiffLine[] = React.useMemo(() => {
    if (oldCode !== undefined && newCode !== undefined) {
      const changes = Diff.diffLines(oldCode, newCode)
      const result: DiffLine[] = []
      let oldLine = 1
      let newLine = 1

      for (const change of changes) {
        const changeLines = change.value.replace(/\n$/, '').split('\n')
        for (const line of changeLines) {
          if (change.added) {
            result.push({
              type: 'added',
              text: line,
              newLineNumber: newLine++
            })
          } else if (change.removed) {
            result.push({
              type: 'removed',
              text: line,
              oldLineNumber: oldLine++
            })
          } else {
            result.push({
              type: 'unchanged',
              text: line,
              oldLineNumber: oldLine++,
              newLineNumber: newLine++
            })
          }
        }
      }
      return result
    }

    // Parse unified diffText format (+, -, space)
    if (diffText) {
      const rawLines = diffText.replace(/\r\n/g, '\n').split('\n')
      const unified = rawLines.some(line => /^@@ -\d+(?:,\d+)? \+\d+(?:,\d+)? @@/.test(line))
      let oldLine = 1
      let newLine = 1
      let inHunk = !unified
      const result: DiffLine[] = []
      for (const line of rawLines) {
        if (unified) {
          const header = line.match(/^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/)
          if (header) { oldLine = Number(header[1]); newLine = Number(header[2]); inHunk = true; continue }
          if (!inHunk || line.startsWith('\\')) continue
        }
        if (line.startsWith('+')) {
          result.push({
            type: 'added',
            text: line.substring(1),
            newLineNumber: newLine++
          })
          continue
        }
        if (line.startsWith('-')) {
          result.push({
            type: 'removed',
            text: line.substring(1),
            oldLineNumber: oldLine++
          })
          continue
        }
        if (unified && !line.startsWith(' ')) continue
        const text = line.startsWith(' ') ? line.substring(1) : line
        result.push({
          type: 'unchanged',
          text,
          oldLineNumber: oldLine++,
          newLineNumber: newLine++
        })
      }
      return result
    }

    return []
  }, [oldCode, newCode, diffText])

  return (
    <div className="min-w-full w-max flex flex-col font-mono text-[14.5px] leading-[24px] select-text">
      {lines.map((line, idx) => {
        const isAdded = line.type === 'added'
        const isRemoved = line.type === 'removed'

        return (
          <div
            key={idx}
            className={`flex items-stretch min-w-full w-max px-3.5 py-[2px] transition-colors rounded-none ${
              isAdded
                ? 'diff-line-added'
                : isRemoved
                ? 'diff-line-removed'
                : 'hover:bg-hover'
            }`}
          >
            {/* Line gutter with numbers and +/- indicator */}
            <div className="flex items-center gap-1.5 select-none pr-3.5 text-[11px] font-mono tabular-nums text-muted shrink-0 w-[64px] justify-between">
              <span className={`w-5 text-right ${isRemoved ? 'text-diff-remove opacity-90 font-medium' : ''}`}>
                {line.oldLineNumber ?? ''}
              </span>
              <span className={`w-5 text-right ${isAdded ? 'text-diff-add opacity-90 font-medium' : ''}`}>
                {line.newLineNumber ?? ''}
              </span>
              <span
                className={`w-3 text-center font-bold ${
                  isAdded ? 'text-diff-add' : isRemoved ? 'text-diff-remove' : 'text-transparent'
                }`}
              >
                {isAdded ? '+' : isRemoved ? '-' : ' '}
              </span>
            </div>

            {/* Line content with syntax highlighting */}
            <span className="flex-1 whitespace-pre text-primary pr-4">
              {highlightCodeTokens(line.text)}
            </span>
          </div>
        )
      })}
    </div>
  )
}
