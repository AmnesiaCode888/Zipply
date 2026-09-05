import React, { useState } from 'react'
import { Check, Copy, ExternalLink, Compass } from 'lucide-react'
import { StepArgs } from '../../../types/chat'
import { renderMarkdown } from '../../MarkdownRenderer'

interface WebPageViewerProps {
  args?: StepArgs
  result?: string
}

function getHostName(urlStr: string): string {
  try {
    return new URL(urlStr).hostname.replace(/^www\./, '')
  } catch {
    return urlStr
  }
}

export const WebPageViewer: React.FC<WebPageViewerProps> = ({ args, result }) => {
  const [copied, setCopied] = useState(false)
  const url = (args?.url as string) || ''
  const text = typeof result === 'string' ? result : ''

  const handleCopy = (e: React.MouseEvent): void => {
    e.stopPropagation()
    navigator.clipboard.writeText(text)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div className="unified-tool-box">
      <button
        type="button"
        className="unified-copy-btn"
        onClick={handleCopy}
        title="Копировать содержимое"
      >
        {copied ? <Check size={11} className="copied-check" strokeWidth={2.5} /> : <Copy size={11} />}
      </button>

      <div className="unified-code-scroll">
        {url && (
          <div className="web-search-query-bar">
            <Compass size={13} className="web-search-icon" />
            <a
              href={url}
              target="_blank"
              rel="noreferrer"
              className="web-page-url-link"
              onClick={(e) => e.stopPropagation()}
            >
              <span>{getHostName(url)}</span>
              <ExternalLink size={10} className="web-ext-icon" />
            </a>
          </div>
        )}
        <div className="web-search-body-raw">
          {renderMarkdown(text) || 'Чтение веб-страницы...'}
        </div>
      </div>
    </div>
  )
}

export default WebPageViewer
