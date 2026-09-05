import React, { useState } from 'react'
import { Check, Copy } from 'lucide-react'
import { StepArgs } from '../../../types/chat'

interface CreatedFileViewerProps {
  args?: StepArgs
  result?: string
  target?: string
}

export const CreatedFileViewer: React.FC<CreatedFileViewerProps> = ({ result }) => {
  const [copied, setCopied] = useState(false)
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
      <button type="button" className="unified-copy-btn" onClick={handleCopy} title="Copy file">
        {copied ? <Check size={11} className="copied-check" strokeWidth={2.5} /> : <Copy size={11} />}
      </button>
      <div className="unified-code-scroll mono">
        {lines.map((line, i) => (
          <div key={i} className="unified-diff-row diff-add">
            <span className="diff-prefix-char">+</span>
            <span className="diff-code-text">{line || '\u00A0'}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

export default CreatedFileViewer
