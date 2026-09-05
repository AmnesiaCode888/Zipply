import React, { useState } from 'react'
import { Check, Copy, Bookmark, Tag } from 'lucide-react'
import { StepArgs } from '../../../types/chat'
import { renderMarkdown } from '../../MarkdownRenderer'

interface MemoryViewerProps {
  args?: StepArgs
  result?: string
  data?: any
}

export const MemoryViewer: React.FC<MemoryViewerProps> = ({ args, result, data }) => {
  const [copied, setCopied] = useState(false)
  const action = (args?.action as string) || 'save'
  const content = (args?.content as string) || data?.content || result || ''
  const category = (args?.category as string) || data?.category || 'fact'
  const tags: string[] = Array.isArray(data?.tags) ? data.tags : args?.tags ? String(args.tags).split(',') : []

  const handleCopy = (e: React.MouseEvent): void => {
    e.stopPropagation()
    navigator.clipboard.writeText(content)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const actLabel = action === 'save' ? 'Запись в память' : action === 'search' ? 'Поиск в памяти' : 'Память'

  return (
    <div className="unified-tool-box">
      <button type="button" className="unified-copy-btn" onClick={handleCopy} title="Копировать запись">
        {copied ? <Check size={11} className="copied-check" strokeWidth={2.5} /> : <Copy size={11} />}
      </button>

      <div className="unified-code-scroll">
        <div className="memory-viewer-header">
          <Bookmark size={13} className="memory-icon" />
          <span className="memory-title">{actLabel}</span>
          {category && <span className="memory-category-tag">{category}</span>}
        </div>

        <div className="memory-body-content">{renderMarkdown(content)}</div>

        {tags.length > 0 && (
          <div className="memory-tags-row">
            <Tag size={11} className="memory-tag-icon" />
            {tags.map((t, idx) => (
              <span key={idx} className="memory-tag-pill">
                #{t.trim()}
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

export default MemoryViewer
