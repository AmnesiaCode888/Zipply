import React, { useRef } from 'react'
import { Check, ExternalLink } from '../../icons'
import { CodeBlock } from './CodeBlock'

export interface RenderMarkdownOptions {
  isStreaming?: boolean
}

/**
 * Parses inline markdown: **bold**, `code`, *italic*, [link](url)
 */
export function parseInlineMarkdown(text: string): React.ReactNode[] {
  const parts: React.ReactNode[] = []
  let currentText = ''
  let i = 0

  while (i < text.length) {
    // Escaped characters: \* \_ \` \[ \] \\
    if (text[i] === '\\' && i + 1 < text.length && ['*', '_', '`', '[', ']', '\\'].includes(text[i + 1])) {
      currentText += text[i + 1]
      i += 2
      continue
    }

    // ~~strikethrough~~
    if (text.startsWith('~~', i)) {
      if (currentText) {
        parts.push(currentText)
        currentText = ''
      }
      const closeIdx = text.indexOf('~~', i + 2)
      if (closeIdx !== -1) {
        parts.push(
          <del key={`del-${i}`} className="line-through text-secondary">
            {parseInlineMarkdown(text.slice(i + 2, closeIdx))}
          </del>
        )
        i = closeIdx + 2
        continue
      }
    }

    // **bold**
    if (text.startsWith('**', i) || text.startsWith('__', i)) {
      const delim = text.slice(i, i + 2)
      if (currentText) {
        parts.push(currentText)
        currentText = ''
      }
      const closeIdx = text.indexOf(delim, i + 2)
      if (closeIdx !== -1) {
        parts.push(
          <strong key={`b-${i}`} className="font-semibold text-strong">
            {parseInlineMarkdown(text.slice(i + 2, closeIdx))}
          </strong>
        )
        i = closeIdx + 2
        continue
      }
    }

    // `code`
    if (text[i] === '`') {
      let runLen = 1
      while (i + runLen < text.length && text[i + runLen] === '`') {
        runLen++
      }
      const delim = text.slice(i, i + runLen)
      const closeIdx = text.indexOf(delim, i + runLen)
      if (closeIdx !== -1) {
        if (currentText) {
          parts.push(currentText)
          currentText = ''
        }
        const codeText = text.slice(i + runLen, closeIdx)
        parts.push(
          <code
            key={`c-${i}`}
            className="font-sans font-normal text-[15px] leading-[22px] tracking-[-0.005em] bg-hover-strong text-primary px-1.5 py-[1px] rounded-[7px] select-text"
          >
            {codeText}
          </code>
        )
        i = closeIdx + runLen
        continue
      }
    }

    // *italic* (with boundary check)
    if (text[i] === '*' || (text[i] === '_' && (i === 0 || /\s/.test(text[i - 1])))) {
      const delim = text[i]
      if (currentText) {
        parts.push(currentText)
        currentText = ''
      }
      const closeIdx = text.indexOf(delim, i + 1)
      if (closeIdx !== -1 && closeIdx > i + 1) {
        parts.push(
          <em key={`em-${i}`} className="italic text-primary">
            {parseInlineMarkdown(text.slice(i + 1, closeIdx))}
          </em>
        )
        i = closeIdx + 1
        continue
      }
    }

    // [link](url)
    if (text[i] === '[') {
      const closeBracket = text.indexOf(']', i + 1)
      if (closeBracket !== -1 && text[closeBracket + 1] === '(') {
        const closeParen = text.indexOf(')', closeBracket + 2)
        if (closeParen !== -1) {
          if (currentText) {
            parts.push(currentText)
            currentText = ''
          }
          const linkText = text.slice(i + 1, closeBracket)
          const rawUrl = text.slice(closeBracket + 2, closeParen).trim()
          const isSafe = /^https?:\/\//i.test(rawUrl)

          if (isSafe) {
            parts.push(
              <a
                key={`a-${i}`}
                href={rawUrl}
                target="_blank"
                rel="noreferrer noopener"
                className="inline-flex items-center gap-0.5 text-accent hover:text-accent-hover hover:underline transition-colors select-text cursor-pointer"
              >
                <span>{parseInlineMarkdown(linkText)}</span>
                <ExternalLink size={11} className="inline opacity-70 shrink-0 ml-0.5" />
              </a>
            )
          } else {
            parts.push(parseInlineMarkdown(linkText))
          }
          i = closeParen + 1
          continue
        }
      }
    }

    currentText += text[i]
    i++
  }

  if (currentText) parts.push(currentText)
  return parts
}

interface InlineMarkdownCache {
  content: string
  stableLength: number
  stableText: string
}

const INLINE_SYNTAX_MARKER_CHARS = '*_~`[]\\'
const INLINE_STREAM_TAIL_LENGTH = 128

const InlineMarkdown = React.memo(({ text, isStreaming = false }: { text: string; isStreaming?: boolean }) => {
  const cacheRef = useRef<InlineMarkdownCache | null>(null)

  if (!isStreaming) {
    cacheRef.current = null
    return <>{parseInlineMarkdown(text)}</>
  }

  let cache = cacheRef.current
  if (!cache || !text.startsWith(cache.content)) {
    cache = { content: '', stableLength: 0, stableText: '' }
    cacheRef.current = cache
  }

  if (text !== cache.content) {
    const mutableText = text.slice(cache.stableLength)
    let firstSyntaxMarker = -1
    for (const marker of INLINE_SYNTAX_MARKER_CHARS) {
      const markerIndex = mutableText.indexOf(marker)
      if (markerIndex !== -1 && (firstSyntaxMarker === -1 || markerIndex < firstSyntaxMarker)) {
        firstSyntaxMarker = markerIndex
      }
    }
    let stableSuffixLength = firstSyntaxMarker !== -1
      ? firstSyntaxMarker
      : Math.max(0, mutableText.length - INLINE_STREAM_TAIL_LENGTH)

    // Keep surrogate pairs intact when a plain-text prefix is committed.
    if (
      stableSuffixLength > 0 &&
      stableSuffixLength < mutableText.length &&
      /[\uD800-\uDBFF]/.test(mutableText[stableSuffixLength - 1]) &&
      /[\uDC00-\uDFFF]/.test(mutableText[stableSuffixLength])
    ) {
      stableSuffixLength--
    }

    if (stableSuffixLength > 0) {
      cache.stableText += mutableText.slice(0, stableSuffixLength)
      cache.stableLength += stableSuffixLength
    }
    cache.content = text
  }

  return <>{cache.stableText}{parseInlineMarkdown(text.slice(cache.stableLength))}</>
})

type PendingMarkdownBlock = 'none' | 'list' | 'table-candidate' | 'table'

interface MarkdownStreamCache {
  content: string
  scanOffset: number
  lineStart: number
  stableOffset: number
  fenceOpen: boolean
  pendingBlock: PendingMarkdownBlock
  tableCandidateEnd: number
  completedNodes: React.ReactNode[]
  nextChunkKey: number
}

function createMarkdownStreamCache(): MarkdownStreamCache {
  return {
    content: '',
    scanOffset: 0,
    lineStart: 0,
    stableOffset: 0,
    fenceOpen: false,
    pendingBlock: 'none',
    tableCandidateEnd: 0,
    completedNodes: [],
    nextChunkKey: 0,
  }
}

function isMarkdownListLine(line: string): boolean {
  const trimmed = line.trim()
  return /^[-*+]\s+/.test(trimmed) || /^\d+[.)]\s+/.test(trimmed)
}

function isMarkdownTableDivider(line: string): boolean {
  const trimmed = line.trim()
  if (!trimmed.includes('|') || !trimmed.includes('-')) return false
  let segments = trimmed.split('|')
  if (trimmed.startsWith('|')) segments = segments.slice(1)
  if (trimmed.endsWith('|')) segments = segments.slice(0, -1)
  return segments.length > 0 && segments.every((segment) => /^:?-{2,}:?$/.test(segment.trim()))
}

function cacheStableMarkdownThrough(cache: MarkdownStreamCache, content: string, boundary: number): void {
  if (boundary <= cache.stableOffset) return

  const stableMarkdown = content.slice(cache.stableOffset, boundary)
  if (stableMarkdown) {
    cache.completedNodes = [...cache.completedNodes,
      <React.Fragment key={`stable-markdown-${cache.nextChunkKey++}`}>
        {renderMarkdownBlocks(stableMarkdown, false)}
      </React.Fragment>
    ]
  }
  cache.stableOffset = boundary
}

function processCompletedMarkdownLine(cache: MarkdownStreamCache, content: string, lineEnd: number): void {
  const lineStart = cache.lineStart
  const line = content.slice(lineStart, lineEnd - 1)
  const trimmed = line.trim()

  if (cache.pendingBlock === 'list') {
    if (isMarkdownListLine(line)) return
    cacheStableMarkdownThrough(cache, content, lineStart)
    cache.pendingBlock = 'none'
  } else if (cache.pendingBlock === 'table-candidate') {
    if (isMarkdownTableDivider(line)) {
      cache.pendingBlock = 'table'
      return
    }
    cacheStableMarkdownThrough(cache, content, cache.tableCandidateEnd)
    cache.pendingBlock = 'none'
  } else if (cache.pendingBlock === 'table') {
    if (trimmed && line.includes('|')) return
    cacheStableMarkdownThrough(cache, content, lineStart)
    cache.pendingBlock = 'none'
  }

  if (!trimmed) {
    cacheStableMarkdownThrough(cache, content, lineEnd)
  } else if (isMarkdownListLine(line)) {
    cache.pendingBlock = 'list'
  } else if (line.includes('|')) {
    cache.pendingBlock = 'table-candidate'
    cache.tableCandidateEnd = lineEnd
  } else {
    cacheStableMarkdownThrough(cache, content, lineEnd)
  }
}

function advanceMarkdownStreamCache(cache: MarkdownStreamCache, content: string): void {
  while (cache.scanOffset < content.length) {
    const remainingLength = content.length - cache.scanOffset

    // A final one or two backticks may become a fence delimiter on the next update.
    if (
      remainingLength < 3 &&
      content[cache.scanOffset] === '`' &&
      Array.from(content.slice(cache.scanOffset)).every((character) => character === '`')
    ) break

    if (content.startsWith('```', cache.scanOffset)) {
      if (cache.fenceOpen) {
        cache.scanOffset += 3
        cache.fenceOpen = false
        cacheStableMarkdownThrough(cache, content, cache.scanOffset)
        cache.pendingBlock = 'none'
        cache.lineStart = cache.scanOffset
      } else {
        cacheStableMarkdownThrough(cache, content, cache.scanOffset)
        cache.pendingBlock = 'none'
        cache.fenceOpen = true
        cache.scanOffset += 3
      }
      continue
    }

    if (!cache.fenceOpen && content[cache.scanOffset] === '\n') {
      const lineEnd = cache.scanOffset + 1
      processCompletedMarkdownLine(cache, content, lineEnd)
      cache.scanOffset = lineEnd
      cache.lineStart = lineEnd
      continue
    }

    cache.scanOffset++
  }

  cache.content = content
}

/**
 * Full Markdown Document Renderer with Apple Minimalist Design
 */
function renderMarkdownBlocks(content: string, isStreaming: boolean): React.ReactNode[] {
  const renderCursor = (): React.ReactNode => (
    <span
      key="streaming-cursor"
      className="inline-block w-1.5 h-4 bg-primary ml-1 align-middle"
      aria-hidden="true"
    />
  )

  // Split content by code blocks
  const parts = content.split(/```/g)
  const totalParts = parts.length
  let cursorRendered = false

  const blocks: React.ReactNode[] = []

  parts.forEach((part, index) => {
    const isCodeBlock = index % 2 === 1
    const isLastPart = index === totalParts - 1

    if (isCodeBlock) {
      const lines = part.split('\n')
      const firstLine = lines[0]?.trim() || ''
      const isIdentifier = /^[a-zA-Z0-9_#+.-]+$/.test(firstLine) && firstLine.length <= 32
      const lang = isIdentifier ? firstLine.toLowerCase() : ''
      const codeLines = lang ? lines.slice(1) : lines
      const codeText = codeLines.join('\n').replace(/^\n+|\n+$/g, '')

      blocks.push(
        <CodeBlock key={`code-block-${index}`} language={lang} code={codeText} isStreaming={isStreaming && isLastPart} />
      )
    } else {
      const lines = part.split('\n')
      let inList = false
      let listItems: React.ReactNode[] = []
      let inOrderedList = false
      let orderedItems: React.ReactNode[] = []

      const flushLists = (keySuffix: string): void => {
        if (inList) {
          blocks.push(
            <ul key={`ul-${keySuffix}`} className="my-2 ml-5 list-disc space-y-1.5 text-primary text-[17px] leading-[28px]">
              {listItems}
            </ul>
          )
          listItems = []
          inList = false
        }
        if (inOrderedList) {
          blocks.push(
            <ol key={`ol-${keySuffix}`} className="my-2 ml-5 list-decimal space-y-1.5 text-primary text-[17px] leading-[28px]">
              {orderedItems}
            </ol>
          )
          orderedItems = []
          inOrderedList = false
        }
      }

      for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
        const line = lines[lineIdx]
        const trimmed = line.trim()
        const isLastLine = isLastPart && lineIdx === lines.length - 1

        if (!trimmed) {
          flushLists(`${index}-${lineIdx}`)
          continue
        }

        const shouldAppendCursor = isStreaming && isLastLine && !cursorRendered
        const lineCursor = shouldAppendCursor ? renderCursor() : null
        if (shouldAppendCursor) cursorRendered = true

        // Horizontal Rule
        if (/^(---|\*\*\*|___)$/.test(trimmed)) {
          flushLists(`${index}-${lineIdx}`)
          blocks.push(
            <div key={`hr-${index}-${lineIdx}`} className="w-full my-3 h-[1px] bg-control" />
          )
          continue
        }

        // Blockquotes (Apple style: neutral obsidian rounded pill, subtle hairline)
        if (trimmed.startsWith('> ') || trimmed === '>') {
          flushLists(`${index}-${lineIdx}`)
          const quoteText = trimmed.startsWith('> ') ? trimmed.slice(2) : trimmed.slice(1)
          blocks.push(
            <div
              key={`quote-${index}-${lineIdx}`}
              className="my-2 px-4 py-2.5 rounded-[12px] bg-surface text-secondary text-[16.5px] leading-[26px] border-none shadow-none"
            >
              <InlineMarkdown text={quoteText} isStreaming={isStreaming} />
              {lineCursor}
            </div>
          )
          continue
        }

        // Headers
        if (trimmed.startsWith('# ')) {
          flushLists(`${index}-${lineIdx}`)
          blocks.push(
            <h1 key={`h1-${index}-${lineIdx}`} className="text-[26px] font-bold text-primary tracking-tight mt-5 mb-2.5 leading-tight">
              <InlineMarkdown text={trimmed.slice(2)} isStreaming={isStreaming} />
              {lineCursor}
            </h1>
          )
          continue
        }
        if (trimmed.startsWith('## ')) {
          flushLists(`${index}-${lineIdx}`)
          blocks.push(
            <h2 key={`h2-${index}-${lineIdx}`} className="text-[22px] font-semibold text-primary tracking-tight mt-4 mb-2 leading-tight">
              <InlineMarkdown text={trimmed.slice(3)} isStreaming={isStreaming} />
              {lineCursor}
            </h2>
          )
          continue
        }
        if (trimmed.startsWith('### ')) {
          flushLists(`${index}-${lineIdx}`)
          blocks.push(
            <h3 key={`h3-${index}-${lineIdx}`} className="text-[19px] font-semibold text-primary mt-3.5 mb-1.5 leading-snug">
              <InlineMarkdown text={trimmed.slice(4)} isStreaming={isStreaming} />
              {lineCursor}
            </h3>
          )
          continue
        }
        if (trimmed.startsWith('#### ')) {
          flushLists(`${index}-${lineIdx}`)
          blocks.push(
            <h4 key={`h4-${index}-${lineIdx}`} className="text-[17px] font-semibold text-primary mt-3 mb-1 leading-snug">
              <InlineMarkdown text={trimmed.slice(5)} isStreaming={isStreaming} />
              {lineCursor}
            </h4>
          )
          continue
        }

        // Tables
        const isTableDivider = (s: string) => {
          const t = s.trim()
          if (!t.includes('|') || !t.includes('-')) return false
          let segs = t.split('|')
          if (t.startsWith('|')) segs = segs.slice(1)
          if (t.endsWith('|')) segs = segs.slice(0, -1)
          if (segs.length === 0) return false
          return segs.every((p) => /^:?-{2,}:?$/.test(p.trim()))
        }

        if (line.includes('|') && lineIdx + 1 < lines.length && isTableDivider(lines[lineIdx + 1])) {
          flushLists(`${index}-${lineIdx}`)
          let hLine = line.trim()
          if (hLine.startsWith('|')) hLine = hLine.slice(1)
          if (hLine.endsWith('|')) hLine = hLine.slice(0, -1)
          const headers = hLine.split('|').map((h) => h.trim())

          let sepLine = lines[lineIdx + 1].trim()
          if (sepLine.startsWith('|')) sepLine = sepLine.slice(1)
          if (sepLine.endsWith('|')) sepLine = sepLine.slice(0, -1)
          const sepParts = sepLine.split('|').map((s) => s.trim())
          const alignments = sepParts.map((s) => {
            const left = s.startsWith(':')
            const right = s.endsWith(':')
            if (left && right) return 'center'
            if (right) return 'right'
            return 'left'
          })

          const rows: string[][] = []
          let rIdx = lineIdx + 2
          while (rIdx < lines.length) {
            const curRow = lines[rIdx].trim()
            if (!curRow || !curRow.includes('|')) break
            let cleanRow = curRow
            if (cleanRow.startsWith('|')) cleanRow = cleanRow.slice(1)
            if (cleanRow.endsWith('|')) cleanRow = cleanRow.slice(0, -1)
            const cells = cleanRow.split('|').map((c) => c.trim())
            while (cells.length < headers.length) cells.push('')
            rows.push(cells)
            rIdx++
          }
          lineIdx = rIdx - 1

          blocks.push(
            <div
              key={`tbl-${index}-${lineIdx}`}
              className="w-full my-3 overflow-x-auto rounded-[14px] bg-surface-secondary border-none shadow-none"
            >
              <table className="w-full text-left text-[15px] border-collapse border-none">
                <thead>
                  <tr className="bg-surface-elevated text-primary">
                    {headers.map((h, hIdx) => (
                      <th
                        key={hIdx}
                        className={`px-3.5 py-2.5 border-none font-semibold text-[15px] text-primary ${
                          alignments[hIdx] === 'center'
                            ? 'text-center'
                            : alignments[hIdx] === 'right'
                            ? 'text-right'
                            : 'text-left'
                        }`}
                      >
                        <InlineMarkdown text={h} isStreaming={isStreaming} />
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((rowCells, rIndex) => (
                    <tr
                      key={rIndex}
                      className={`border-none transition-colors ${
                        rIndex % 2 === 1 ? 'bg-hover' : 'bg-transparent'
                      } hover:bg-hover-strong`}
                    >
                      {rowCells.map((cell, cIdx) => (
                        <td
                          key={cIdx}
                          className={`px-3.5 py-2.5 border-none text-primary text-[15.5px] leading-[23px] ${
                            alignments[cIdx] === 'center'
                              ? 'text-center'
                              : alignments[cIdx] === 'right'
                              ? 'text-right'
                              : 'text-left'
                          }`}
                        >
                          <InlineMarkdown text={cell} isStreaming={isStreaming} />
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
          continue
        }

        // Task List (- [ ] or - [x])
        const taskMatch = /^[-*+]\s+\[([ xX])\]\s+(.*)/.exec(trimmed)
        if (taskMatch) {
          if (inOrderedList) flushLists(`${index}-${lineIdx}`)
          inList = true
          const checked = taskMatch[1].toLowerCase() === 'x'
          const taskContent = taskMatch[2]
          listItems.push(
            <li key={`task-${index}-${lineIdx}`} className="leading-[28px] list-none -ml-4 flex items-start gap-2.5">
              <span
                className={`inline-flex items-center justify-center w-4.5 h-4.5 mt-0.5 rounded-[4px] shrink-0 border-none select-none transition-colors ${
                  checked ? 'bg-diff-add text-black' : 'bg-control text-transparent'
                }`}
              >
                {checked && <Check size={12} strokeWidth={3} />}
              </span>
              <span className={checked ? 'line-through text-secondary' : 'text-primary'}>
                <InlineMarkdown text={taskContent} isStreaming={isStreaming} />
                {lineCursor}
              </span>
            </li>
          )
          continue
        }

        // Bullet Lists
        if (/^[-*+]\s+/.test(trimmed)) {
          if (inOrderedList) flushLists(`${index}-${lineIdx}`)
          inList = true
          const itemContent = trimmed.replace(/^[-*+]\s+/, '')
          listItems.push(
            <li key={`li-${index}-${lineIdx}`} className="leading-[28px]">
              <InlineMarkdown text={itemContent} isStreaming={isStreaming} />
              {lineCursor}
            </li>
          )
          continue
        }

        // Numbered Lists
        if (/^\d+[\.\)]\s+/.test(trimmed)) {
          if (inList) flushLists(`${index}-${lineIdx}`)
          inOrderedList = true
          const itemContent = trimmed.replace(/^\d+[\.\)]\s+/, '')
          orderedItems.push(
            <li key={`oli-${index}-${lineIdx}`} className="leading-[28px]">
              <InlineMarkdown text={itemContent} isStreaming={isStreaming} />
              {lineCursor}
            </li>
          )
          continue
        }

        flushLists(`${index}-${lineIdx}`)

        // Paragraph
        blocks.push(
          <p key={`p-${index}-${lineIdx}`} className="text-primary text-[17px] leading-[28px] my-1.5 first:mt-0 last:mb-0 select-text break-words">
            <InlineMarkdown text={line} isStreaming={isStreaming} />
            {lineCursor}
          </p>
        )
      }

      flushLists(`end-${index}`)
    }
  })

  return blocks
}

function renderOpenCodeFence(content: string): React.ReactNode {
  const firstLineEnd = content.indexOf('\n', 3)
  const firstLine = (firstLineEnd === -1 ? content.slice(3) : content.slice(3, firstLineEnd)).trim()
  const hasLanguage = /^[a-zA-Z0-9_#+.-]+$/.test(firstLine) && firstLine.length <= 32
  const language = hasLanguage ? firstLine.toLowerCase() : ''
  let codeStart = hasLanguage ? (firstLineEnd === -1 ? content.length : firstLineEnd + 1) : 3
  let codeEnd = content.length

  while (codeStart < codeEnd && content[codeStart] === '\n') codeStart++
  while (codeEnd > codeStart && content[codeEnd - 1] === '\n') codeEnd--

  return <CodeBlock key="streaming-code-block" language={language} code={content.slice(codeStart, codeEnd)} isStreaming />
}

export const MarkdownRenderer: React.FC<{
  content?: string | null
  isStreaming?: boolean
}> = ({ content, isStreaming = false }) => {
  const streamCacheRef = useRef<MarkdownStreamCache | null>(null)

  if (!content) {
    streamCacheRef.current = null
    return isStreaming ? (
      <span className="inline-block w-1.5 h-4 bg-primary ml-1 align-middle" />
    ) : null
  }

  if (!isStreaming) {
    streamCacheRef.current = null
    return <div className="w-full flex flex-col">{renderMarkdownBlocks(content, false)}</div>
  }

  let streamCache = streamCacheRef.current
  if (!streamCache || !content.startsWith(streamCache.content)) {
    streamCache = createMarkdownStreamCache()
    streamCacheRef.current = streamCache
  }

  if (content !== streamCache.content) {
    advanceMarkdownStreamCache(streamCache, content)
  }

  const activeTail = content.slice(streamCache.stableOffset)
  return (
    <div className="w-full flex flex-col">
      {streamCache.completedNodes}
      {activeTail
        ? streamCache.fenceOpen
          ? renderOpenCodeFence(activeTail)
          : renderMarkdownBlocks(activeTail, true)
        : null}
    </div>
  )
}

export default MarkdownRenderer
