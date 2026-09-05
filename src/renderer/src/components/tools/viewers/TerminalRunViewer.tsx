import React, { useState } from 'react'
import { Check, Copy } from 'lucide-react'
import { StepArgs } from '../../../types/chat'

interface TerminalRunViewerProps {
  args?: StepArgs
  result?: string
}

export const TerminalRunViewer: React.FC<TerminalRunViewerProps> = ({ args, result }) => {
  const [copied, setCopied] = useState(false)
  const command = (args?.command as string) || ''
  const text = typeof result === 'string' ? result : ''

  let output = text
  if (text.includes('[exit code:')) {
    output = text.slice(0, text.lastIndexOf('[exit code:')).trimEnd()
  }

  const lines = output.trim().split('\n').filter(Boolean)

  const handleCopy = (e: React.MouseEvent): void => {
    e.stopPropagation()
    navigator.clipboard.writeText(command ? `$ ${command}\n${output}` : output)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div className="unified-terminal-box">
      <button type="button" className="unified-copy-btn" onClick={handleCopy} title="Copy output">
        {copied ? <Check size={11} className="copied-check" strokeWidth={2.5} /> : <Copy size={11} />}
      </button>

      <div className="terminal-stream-body mono">
        {command && (
          <div className="term-prompt-line">
            <span className="term-dollar">$</span>
            <span className="term-cmd-bold">{command}</span>
          </div>
        )}
        {lines.map((line, i) => {
          const isCheck = line.includes('✓') || line.includes('passed') || line.includes('built in')
          const isErr = /error|fail|exception/i.test(line) && !/node_modules/i.test(line)

          return (
            <div key={i} className={`term-output-row ${isCheck ? 'term-pass' : isErr ? 'term-fail' : ''}`}>
              <span className="term-row-txt">{line}</span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

export default TerminalRunViewer
