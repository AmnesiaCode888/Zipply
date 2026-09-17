import React, { useState, useMemo, useCallback } from 'react'
import { ArrowLeft, Copy, Check, ExternalLink } from 'lucide-react'
import Prism from 'prismjs'
import 'prismjs/components/prism-javascript'
import 'prismjs/components/prism-typescript'
import 'prismjs/components/prism-jsx'
import 'prismjs/components/prism-tsx'
import 'prismjs/components/prism-json'
import 'prismjs/components/prism-css'
import 'prismjs/components/prism-python'
import 'prismjs/components/prism-bash'
import 'prismjs/components/prism-markdown'
import 'prismjs/components/prism-yaml'
import 'prismjs/components/prism-toml'
import 'prismjs/components/prism-sql'
import { diffLines } from 'diff'
import { FileIcon } from '../files/FileIcon'
import './CodeDiffViewer.css'

export interface CodeDiffViewerProps {
  filePath: string
  fileName?: string
  oldContent?: string
  newContent: string
  isDiff?: boolean
  stats?: { add: number; del: number }
  onBack?: () => void
}

function getPrismLanguage(filePath: string): string {
  const ext = filePath.split('.').pop()?.toLowerCase() || ''
  switch (ext) {
    case 'ts':
      return 'typescript'
    case 'tsx':
      return 'tsx'
    case 'js':
    case 'mjs':
    case 'cjs':
      return 'javascript'
    case 'jsx':
      return 'jsx'
    case 'json':
      return 'json'
    case 'css':
    case 'scss':
    case 'less':
      return 'css'
    case 'py':
      return 'python'
    case 'sh':
    case 'bash':
    case 'ps1':
    case 'cmd':
    case 'bat':
      return 'bash'
    case 'md':
    case 'markdown':
      return 'markdown'
    case 'yml':
    case 'yaml':
      return 'yaml'
    case 'toml':
      return 'toml'
    case 'sql':
      return 'sql'
    case 'html':
    case 'xml':
    case 'svg':
      return 'markup'
    default:
      return 'javascript'
  }
}

interface DiffLineItem {
  type: 'add' | 'del' | 'normal'
  content: string
  oldLineNumber?: number
  newLineNumber?: number
}

export const CodeDiffViewer: React.FC<CodeDiffViewerProps> = ({
  filePath,
  fileName,
  oldContent,
  newContent,
  isDiff = false,
  stats,
  onBack
}) => {
  const hasOldContent = typeof oldContent === 'string' && oldContent !== newContent
  const [viewMode, setViewMode] = useState<'diff' | 'full'>(hasOldContent && isDiff ? 'diff' : 'full')
  const [copied, setCopied] = useState(false)

  const resolvedFileName = fileName || filePath.replace(/.*[/\\]/, '') || 'файл'
  const lang = useMemo(() => getPrismLanguage(filePath), [filePath])

  const diffItems = useMemo<DiffLineItem[]>(() => {
    if (!hasOldContent) return []
    const changes = diffLines(oldContent || '', newContent || '')
    let oldLine = 1
    let newLine = 1
    const items: DiffLineItem[] = []

    for (const change of changes) {
      const normalized = change.value.replace(/\r\n/g, '\n').replace(/\n$/, '')
      const lines = normalized.split('\n')
      for (const line of lines) {
        if (change.added) {
          items.push({
            type: 'add',
            content: line,
            newLineNumber: newLine++
          })
        } else if (change.removed) {
          items.push({
            type: 'del',
            content: line,
            oldLineNumber: oldLine++
          })
        } else {
          items.push({
            type: 'normal',
            content: line,
            oldLineNumber: oldLine++,
            newLineNumber: newLine++
          })
        }
      }
    }
    return items
  }, [oldContent, newContent, hasOldContent])

  const fullLines = useMemo(() => {
    return (newContent || '').replace(/\r\n/g, '\n').split('\n')
  }, [newContent])

  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(newContent)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }, [newContent])

  const handleReveal = useCallback(() => {
    if (filePath && window.api?.files?.reveal) {
      window.api.files.reveal(filePath)
    }
  }, [filePath])

  const highlightLine = useCallback(
    (code: string): string => {
      try {
        const grammar = Prism.languages[lang] || Prism.languages.javascript
        return Prism.highlight(code || '', grammar, lang)
      } catch {
        return code
      }
    },
    [lang]
  )

  return (
    <div className="code-viewer-container">
      {/* Minimal Header */}
      <div className="code-viewer-header">
        <div className="code-viewer-header-left">
          {onBack && (
            <button
              type="button"
              className="code-viewer-back-btn"
              onClick={onBack}
              title="Назад к списку"
              aria-label="Назад"
            >
              <ArrowLeft size={13} strokeWidth={2} />
            </button>
          )}
          <FileIcon name={resolvedFileName} isDirectory={false} size={15} />
          <div className="code-viewer-file-info">
            <span className="code-viewer-file-name" title={filePath}>
              {resolvedFileName}
            </span>
          </div>
          {stats && (stats.add > 0 || stats.del > 0) && (
            <span className="code-viewer-diff-badge">
              {stats.add > 0 && <span className="stat-add">+{stats.add}</span>}
              {stats.del > 0 && <span className="stat-del">-{stats.del}</span>}
            </span>
          )}
        </div>

        <div className="code-viewer-header-right">
          {hasOldContent && (
            <div className="code-viewer-mode-switch">
              <button
                type="button"
                className={`code-viewer-mode-btn ${viewMode === 'diff' ? 'active' : ''}`}
                onClick={() => setViewMode('diff')}
                title="Показать различия (Diff)"
              >
                Diff
              </button>
              <button
                type="button"
                className={`code-viewer-mode-btn ${viewMode === 'full' ? 'active' : ''}`}
                onClick={() => setViewMode('full')}
                title="Показать весь файл"
              >
                Файл
              </button>
            </div>
          )}

          <button
            type="button"
            className="code-viewer-btn"
            onClick={handleCopy}
            title={copied ? 'Скопировано!' : 'Копировать код'}
            aria-label="Копировать"
          >
            {copied ? <Check size={12} color="#27C93F" /> : <Copy size={12} strokeWidth={1.8} />}
          </button>

          <button
            type="button"
            className="code-viewer-btn"
            onClick={handleReveal}
            title="Показать в проводнике"
            aria-label="Показать в проводнике"
          >
            <ExternalLink size={12} strokeWidth={1.8} />
          </button>
        </div>
      </div>

      {/* Code / Diff Body */}
      <div className="code-viewer-body">
        <table className="code-viewer-table">
          <tbody>
            {viewMode === 'diff' && hasOldContent
              ? diffItems.map((item, idx) => {
                  const isAdd = item.type === 'add'
                  const isDel = item.type === 'del'
                  const rowClass = isAdd ? 'row-add' : isDel ? 'row-del' : ''
                  const symbol = isAdd ? '+' : isDel ? '-' : ' '

                  return (
                    <tr key={idx} className={`code-viewer-row ${rowClass}`}>
                      <td className="code-viewer-gutter gutter-diff">
                        {item.oldLineNumber ?? ''}
                      </td>
                      <td className="code-viewer-gutter gutter-diff">
                        {item.newLineNumber ?? ''}
                      </td>
                      <td className="code-viewer-gutter-symbol">{symbol}</td>
                      <td
                        className="code-viewer-content"
                        dangerouslySetInnerHTML={{
                          __html: highlightLine(item.content) || '<span class="code-viewer-empty-line">&nbsp;</span>'
                        }}
                      />
                    </tr>
                  )
                })
              : fullLines.map((line, idx) => (
                  <tr key={idx} className="code-viewer-row">
                    <td className="code-viewer-gutter">{idx + 1}</td>
                    <td
                      className="code-viewer-content"
                      dangerouslySetInnerHTML={{
                        __html: highlightLine(line) || '<span class="code-viewer-empty-line">&nbsp;</span>'
                      }}
                    />
                  </tr>
                ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

export default CodeDiffViewer
