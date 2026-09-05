import React from 'react'
import katex from 'katex'
import { CopyButton } from './common/CopyButton'
import {
  parseInlineMarkdown,
  splitTableRow,
  isSeparatorLine,
  isTableLine,
  parseTableAlignments,
  TableAlignment,
} from '../utils/markdown'

function renderBlockMath(latex: string, key: string): React.ReactNode {
  try {
    const html = katex.renderToString(latex.trim(), {
      displayMode: true,
      throwOnError: false,
      output: 'html',
    })
    return (
      <div
        key={key}
        className="msg-math-block"
        // biome-ignore lint/security/noDangerouslySetInnerHtml: KaTeX output is safe
        dangerouslySetInnerHTML={{ __html: html }}
      />
    )
  } catch {
    return <pre key={key} className="msg-code-pre"><code>{latex}</code></pre>
  }
}

export { CopyButton }

export interface RenderMarkdownOptions {
  isStreaming?: boolean
}

export function renderMarkdown(
  text: string | undefined | null,
  options?: RenderMarkdownOptions
): React.ReactNode {
  const isStreaming = Boolean(options?.isStreaming)

  const renderCursor = (inCode = false): React.ReactNode => (
    <span
      key="streaming-cursor"
      className={`streaming-cursor ${inCode ? 'in-code' : ''}`}
      aria-hidden="true"
    />
  )

  if (!text) {
    return isStreaming ? (
      <p className="msg-p">
        {renderCursor()}
      </p>
    ) : null
  }

  const blocks: React.ReactNode[] = []

  // Pre-process: split on $$ blocks and \[...\] blocks before code block splitting
  // We handle this at the text level by replacing block math with placeholders,
  // then splitting on ``` for code blocks.
  // Strategy: split the entire text on ``` first, then within non-code parts,
  // detect $$ and \[...\] lines.

  const parts = text.split(/```/g)
  const totalParts = parts.length
  let cursorRendered = false

  const isNumberedList = (l: string): boolean => {
    return /^\d+[\.\)]\s+/.test(l)
  }

  const getNumberedContent = (l: string): string => {
    return l.replace(/^\d+[\.\)]\s+/, '')
  }

  parts.forEach((part, index) => {
    const isLastPart = index === totalParts - 1
    const isCodeBlock = index % 2 === 1

    if (isCodeBlock) {
      const lines = part.split('\n')
      const firstLine = lines[0]?.trim() || ''
      const lang = [
        'typescript', 'javascript', 'ts', 'js', 'css', 'html', 'json',
        'csharp', 'cs', 'python', 'py', 'markdown', 'md', 'bash', 'sh',
        'sql', 'yaml', 'yml', 'xml', 'rust', 'go', 'cpp', 'c'
      ].includes(firstLine.toLowerCase())
        ? firstLine.toLowerCase()
        : ''
      const codeLines = lang ? lines.slice(1) : lines
      const codeText = codeLines.join('\n').replace(/^\n+|\n+$/g, '')

      let codeCursor: React.ReactNode = null
      if (isStreaming && isLastPart) {
        codeCursor = renderCursor(true)
        cursorRendered = true
      }

      blocks.push(
        <div key={`code-${index}`} className="msg-code-container">
          <div className="msg-code-header">
            <span className="msg-code-lang">{lang || 'code'}</span>
            <CopyButton text={codeText} />
          </div>
          <pre className="msg-code-pre">
            <code>
              {codeText}
              {codeCursor}
            </code>
          </pre>
        </div>
      )
    } else {
      const lines = part.split('\n')
      let inList = false
      let listItems: React.ReactNode[] = []
      let inOrderedList = false
      let orderedItems: React.ReactNode[] = []
      let inTable = false
      let tableHeaders: string[] = []
      let tableAlignments: TableAlignment[] = []
      let tableRows: string[][] = []

      const flushLists = (keySuffix: string): void => {
        if (inList) {
          blocks.push(<ul key={`ul-${keySuffix}`} className="msg-list">{listItems}</ul>)
          listItems = []
          inList = false
        }
        if (inOrderedList) {
          blocks.push(<ol key={`ol-${keySuffix}`} className="msg-olist">{orderedItems}</ol>)
          orderedItems = []
          inOrderedList = false
        }
      }

      const flushTable = (keySuffix: string): void => {
        if (inTable && tableHeaders.length > 0) {
          blocks.push(
            <div key={`table-${keySuffix}`} className="msg-table-container">
              <table className="msg-table">
                <thead>
                  <tr>
                    {tableHeaders.map((h, hIdx) => (
                      <th
                        key={hIdx}
                        style={tableAlignments[hIdx] ? { textAlign: tableAlignments[hIdx] } : undefined}
                      >
                        {parseInlineMarkdown(h)}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {tableRows.map((r, rIdx) => (
                    <tr key={rIdx}>
                      {r.map((c, cIdx) => (
                        <td
                          key={cIdx}
                          style={tableAlignments[cIdx] ? { textAlign: tableAlignments[cIdx] } : undefined}
                        >
                          {parseInlineMarkdown(c)}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        }
        inTable = false
        tableHeaders = []
        tableAlignments = []
        tableRows = []
      }

      for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
        const line = lines[lineIdx]
        const trimmed = line.trim()
        const isLastLine = isLastPart && lineIdx === lines.length - 1

        // Table Detection
        if (isTableLine(line) && !inTable) {
          const nextLine = lines[lineIdx + 1]
          if (nextLine && isSeparatorLine(nextLine)) {
            flushLists(`${index}-${lineIdx}`)
            inTable = true
            tableHeaders = splitTableRow(line)
            tableAlignments = parseTableAlignments(nextLine)
            lineIdx++ // skip separator line
            continue
          }
        }

        if (inTable) {
          if (isTableLine(line)) {
            if (!isSeparatorLine(line)) {
              let cells = splitTableRow(line)
              if (tableHeaders.length > 0) {
                if (cells.length < tableHeaders.length) {
                  while (cells.length < tableHeaders.length) {
                    cells.push('')
                  }
                } else if (cells.length > tableHeaders.length) {
                  const head = cells.slice(0, tableHeaders.length - 1)
                  const tail = cells.slice(tableHeaders.length - 1).join(' | ')
                  cells = [...head, tail]
                }
              }
              tableRows.push(cells)
            }
            continue
          } else {
            flushTable(`${index}-${lineIdx}`)
          }
        }

        // Empty line
        if (!trimmed) {
          flushLists(`${index}-${lineIdx}`)
          continue
        }

        // Horizontal Rule
        if (/^(---|\*\*\*|___)$/.test(trimmed)) {
          flushLists(`${index}-${lineIdx}`)
          blocks.push(<hr key={`hr-${index}-${lineIdx}`} className="msg-hr" />)
          continue
        }

        // Block math: \[...\] (possibly multi-line, but handle single-line common case)
        if (trimmed.startsWith('\\[')) {
          flushLists(`${index}-${lineIdx}`)
          // collect until \]
          let mathContent = trimmed.slice(2)
          let closed = false
          if (mathContent.endsWith('\\]')) {
            mathContent = mathContent.slice(0, -2)
            closed = true
          } else {
            // multi-line: gather lines until \]
            let j = lineIdx + 1
            while (j < lines.length) {
              const nextTrimmed = lines[j].trim()
              lineIdx = j
              if (nextTrimmed.endsWith('\\]')) {
                mathContent += '\n' + nextTrimmed.slice(0, -2)
                closed = true
                break
              }
              mathContent += '\n' + nextTrimmed
              j++
            }
          }
          if (closed) {
            blocks.push(renderBlockMath(mathContent, `bmath-backslash-${index}-${lineIdx}`))
            continue
          } else {
            // not closed — render as paragraph
            flushLists(`${index}-${lineIdx}`)
          }
        }

        // Block math: $$...$$ (possibly multi-line)
        if (trimmed.startsWith('$$')) {
          flushLists(`${index}-${lineIdx}`)
          const afterOpen = trimmed.slice(2)
          // inline $$ on one line: $$expr$$
          if (afterOpen.endsWith('$$') && afterOpen.length > 2) {
            const latex = afterOpen.slice(0, -2)
            blocks.push(renderBlockMath(latex, `bmath-${index}-${lineIdx}`))
            continue
          }
          // opening $$ on its own line
          let mathContent = afterOpen
          let closed = false
          let j = lineIdx + 1
          while (j < lines.length) {
            const nextTrimmed = lines[j].trim()
            lineIdx = j
            if (nextTrimmed === '$$' || nextTrimmed.endsWith('$$')) {
              const extra = nextTrimmed === '$$' ? '' : nextTrimmed.slice(0, -2)
              mathContent += (mathContent ? '\n' : '') + extra
              closed = true
              break
            }
            mathContent += (mathContent ? '\n' : '') + nextTrimmed
            j++
          }
          if (closed) {
            blocks.push(renderBlockMath(mathContent, `bmath-${index}-${lineIdx}`))
            continue
          }
          // unclosed — fall through as paragraph
        }

        // Check if cursor should be appended to this line
        const shouldAppendCursor = isStreaming && isLastLine && !cursorRendered
        const lineCursor = shouldAppendCursor ? renderCursor() : null
        if (shouldAppendCursor) cursorRendered = true

        // Blockquotes
        if (trimmed.startsWith('> ') || trimmed === '>') {
          flushLists(`${index}-${lineIdx}`)
          const quoteText = trimmed.startsWith('> ') ? trimmed.slice(2) : trimmed.slice(1)
          blocks.push(
            <blockquote key={`quote-${index}-${lineIdx}`} className="msg-blockquote">
              {parseInlineMarkdown(quoteText)}
              {lineCursor}
            </blockquote>
          )
          continue
        }

        // Headers
        if (trimmed.startsWith('# ')) {
          flushLists(`${index}-${lineIdx}`)
          blocks.push(
            <h1 key={`h1-${index}-${lineIdx}`} className="msg-h1">
              {parseInlineMarkdown(trimmed.slice(2))}
              {lineCursor}
            </h1>
          )
          continue
        }
        if (trimmed.startsWith('## ')) {
          flushLists(`${index}-${lineIdx}`)
          blocks.push(
            <h2 key={`h2-${index}-${lineIdx}`} className="msg-h2">
              {parseInlineMarkdown(trimmed.slice(3))}
              {lineCursor}
            </h2>
          )
          continue
        }
        if (trimmed.startsWith('### ')) {
          flushLists(`${index}-${lineIdx}`)
          blocks.push(
            <h3 key={`h3-${index}-${lineIdx}`} className="msg-h3">
              {parseInlineMarkdown(trimmed.slice(4))}
              {lineCursor}
            </h3>
          )
          continue
        }
        if (trimmed.startsWith('#### ')) {
          flushLists(`${index}-${lineIdx}`)
          blocks.push(
            <h4 key={`h4-${index}-${lineIdx}`} className="msg-h4">
              {parseInlineMarkdown(trimmed.slice(5))}
              {lineCursor}
            </h4>
          )
          continue
        }

        // Bullet Lists (- or * or +)
        if (/^[-*+]\s+/.test(trimmed)) {
          if (inOrderedList) flushLists(`${index}-${lineIdx}`)
          inList = true
          const itemContent = trimmed.replace(/^[-*+]\s+/, '')
          listItems.push(
            <li key={`li-${index}-${lineIdx}`} className="msg-li">
              {parseInlineMarkdown(itemContent)}
              {lineCursor}
            </li>
          )
          continue
        }

        // Numbered Lists (1. 2. etc)
        if (isNumberedList(trimmed)) {
          if (inList) flushLists(`${index}-${lineIdx}`)
          inOrderedList = true
          const itemContent = getNumberedContent(trimmed)
          orderedItems.push(
            <li key={`oli-${index}-${lineIdx}`} className="msg-oli">
              {parseInlineMarkdown(itemContent)}
              {lineCursor}
            </li>
          )
          continue
        }

        // End active lists if we hit normal paragraph text
        flushLists(`${index}-${lineIdx}`)

        // Normal Paragraph
        blocks.push(
          <p key={`p-${index}-${lineIdx}`} className="msg-p">
            {parseInlineMarkdown(line)}
            {lineCursor}
          </p>
        )
      }

      flushLists(`end-${index}`)
      flushTable(`end-${index}`)
    }
  })

  // If streaming but no cursor was placed yet (e.g. trailing newlines or empty line)
  if (isStreaming && !cursorRendered) {
    blocks.push(
      <p key="p-stream-cursor" className="msg-p">
        {renderCursor()}
      </p>
    )
  }

  return <>{blocks}</>
}

export default renderMarkdown
