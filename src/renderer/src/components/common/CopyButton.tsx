import React, { useState } from 'react'
import { Check, Copy } from 'lucide-react'

interface CopyButtonProps {
  text: string
  className?: string
  title?: string
  showLabel?: boolean
}

export const CopyButton: React.FC<CopyButtonProps> = ({
  text,
  className = 'code-copy-btn',
  title = 'Скопировать',
  showLabel = true
}) => {
  const [copied, setCopied] = useState(false)

  const handleCopy = async (e: React.MouseEvent): Promise<void> => {
    e.stopPropagation()
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch (err) {
      console.error('Failed to copy: ', err)
    }
  }

  return (
    <button
      onClick={handleCopy}
      className={className}
      title={title}
      type="button"
      aria-label="Copy to clipboard"
    >
      {copied ? (
        <>
          <Check size={showLabel ? 12 : 13} className="copied-check" strokeWidth={2.2} />
          {showLabel && <span className="copied-text">Скопировано</span>}
        </>
      ) : (
        <>
          <Copy size={showLabel ? 12 : 13} strokeWidth={1.8} />
          {showLabel && <span>Копировать</span>}
        </>
      )}
    </button>
  )
}

export default CopyButton
