import React, { useState } from 'react'
import { Check, Copy } from 'lucide-react'
import { StepArgs } from '../../../types/chat'

interface FileCodeViewerProps {
  args?: StepArgs
  result?: string
}

export const FileCodeViewer: React.FC<FileCodeViewerProps> = ({ args, result }) => {
  const [copied, setCopied] = useState(false)
  const start = Number(args?.start_line) || 1
  const text = typeof result === 'string' ? result : ''
  const lines = text.split('\n')

  const handleCopy = (e: React.MouseEvent): void => {
    e.stopPropagation()
    navigator.clipboard.writeText(text)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div className="unified-tool-box">
      <button type="button" className="unified-copy-btn" onClick={handleCopy} title="Copy code">
        {copied ? <Check size={11} className="copied-check" strokeWidth={2.5} /> : <Copy size={11} />}
      </button>
      <div className="unified-code-scroll mono">
        {lines.map((line, i) => (
          <div key={i} className="unified-code-row">
            <span className="unified-ln">{start + i}</span>
            <span className="unified-code-text">{line || '\u00A0'}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

export default FileCodeViewer
