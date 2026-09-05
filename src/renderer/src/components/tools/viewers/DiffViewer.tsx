import React, { useState } from 'react'
import { Check, Copy } from 'lucide-react'
import { StepArgs } from '../../../types/chat'

interface DiffViewerProps {
  args?: StepArgs
  result?: string
}

interface DiffLine {
  t: 'add' | 'del' | 'ctx'
  txt: string
}

export const DiffViewer: React.FC<DiffViewerProps> = ({ args, result }) => {
  const [copied, setCopied] = useState(false)
  const oldC = (args?.old_content || args?.oldContent) as string | undefined
  const newC = (args?.new_content || args?.newContent) as string | undefined

  const lines: DiffLine[] = []
  if (oldC !== undefined || newC !== undefined) {
    ;(oldC || '').split('\n').forEach((l: string) => lines.push({ t: 'del', txt: l }))
    ;(newC || '').split('\n').forEach((l: string) => lines.push({ t: 'add', txt: l }))
  } else if (typeof result === 'string') {
    result.split('\n').forEach((l: string) => {
      if (l.startsWith('-')) {
        lines.push({ t: 'del', txt: l.slice(1) })
      } else if (l.startsWith('+')) {
        lines.push({ t: 'add', txt: l.slice(1) })
      } else {
        lines.push({ t: 'ctx', txt: l })
      }
    })
  }

  const handleCopy = (e: React.MouseEvent): void => {
    e.stopPropagation()
    const diffRaw = typeof result === 'string' ? result : ''
    navigator.clipboard.writeText(diffRaw)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div className="unified-tool-box">
      <button type="button" className="unified-copy-btn" onClick={handleCopy} title="Copy diff">
        {copied ? <Check size={11} className="copied-check" strokeWidth={2.5} /> : <Copy size={11} />}
      </button>
      <div className="unified-code-scroll mono">
        {lines.map((l, i) => (
          <div key={i} className={`unified-diff-row diff-${l.t}`}>
            <span className="diff-prefix-char">{l.t === 'del' ? '−' : l.t === 'add' ? '+' : ' '}</span>
            <span className="diff-code-text">{l.txt}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

export default DiffViewer
