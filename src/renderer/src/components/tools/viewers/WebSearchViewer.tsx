import React, { useState } from 'react'
import { Check, Copy, ExternalLink, Globe } from 'lucide-react'
import { StepArgs } from '../../../types/chat'
import { renderMarkdown } from '../../MarkdownRenderer'

interface WebSearchViewerProps {
  args?: StepArgs
  result?: string
  data?: any
}

function cleanSnippet(text: string): string {
  if (!text) return ''
  return text
    .replace(/^ОтправитьОтмена\s*/i, '')
    .replace(/#{1,6}\s+/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function getHostName(urlStr: string): string {
  try {
    return new URL(urlStr).hostname.replace(/^www\./, '')
  } catch {
    return urlStr
  }
}

export const WebSearchViewer: React.FC<WebSearchViewerProps> = ({ args, result, data }) => {
  const [copied, setCopied] = useState(false)
  const query = (args?.query as string) || ''
  const text = typeof result === 'string' ? result : ''

  const handleCopy = (e: React.MouseEvent): void => {
    e.stopPropagation()
    navigator.clipboard.writeText(text)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const results = data?.results || []

  return (
    <div className="unified-tool-box">
      <button
        type="button"
        className="unified-copy-btn"
        onClick={handleCopy}
        title="Копировать результаты"
      >
        {copied ? <Check size={11} className="copied-check" strokeWidth={2.5} /> : <Copy size={11} />}
      </button>

      <div className="unified-code-scroll">
        {query && (
          <div className="web-search-query-bar">
            <Globe size={13} className="web-search-icon" />
            <span className="web-search-query-text">{query}</span>
            {results.length > 0 && (
              <span className="web-search-count-tag mono">{results.length} results</span>
            )}
          </div>
        )}

        {results.length > 0 ? (
          <div className="web-search-results-list">
            {results.map((r: any, i: number) => {
              const host = getHostName(r.url)
              const snippet = cleanSnippet(r.content || r.snippet || '')

              return (
                <div key={i} className="web-search-item">
                  <div className="web-search-item-header">
                    <a
                      href={r.url}
                      target="_blank"
                      rel="noreferrer"
                      className="web-search-title-link"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <span>{r.title || host}</span>
                      <ExternalLink size={10} className="web-ext-icon" />
                    </a>
                    <span className="web-search-domain">{host}</span>
                  </div>
                  {snippet && <div className="web-search-snippet">{snippet}</div>}
                </div>
              )
            })}
          </div>
        ) : (
          <div className="web-search-body-raw">{renderMarkdown(text) || 'Поиск завершён.'}</div>
        )}
      </div>
    </div>
  )
}

export default WebSearchViewer
