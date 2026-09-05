import React from 'react'
import katex from 'katex'

/**
 * Renders a LaTeX string to an HTML span using KaTeX.
 * Returns null on parse error (falls back to raw text).
 */
function renderKatex(latex: string, displayMode: boolean, key: string): React.ReactNode {
  try {
    const html = katex.renderToString(latex, {
      displayMode,
      throwOnError: false,
      output: 'html',
    })
    return (
      <span
        key={key}
        className={displayMode ? 'math-block' : 'math-inline'}
        // biome-ignore lint/security/noDangerouslySetInnerHtml: KaTeX output is safe
        dangerouslySetInnerHTML={{ __html: html }}
      />
    )
  } catch {
    return null
  }
}

export type TableAlignment = 'left' | 'center' | 'right' | undefined

/**
 * Splits a markdown table line into cell strings, properly respecting:
 * - Backtick code spans (`...` or ``...``)
 * - Escaped pipes (\|)
 * - Leading and trailing pipes
 */
export function splitTableRow(line: string): string[] {
  let text = line.trim()
  if (text.startsWith('|')) {
    text = text.slice(1)
  }
  if (text.endsWith('|') && !text.endsWith('\\|')) {
    text = text.slice(0, -1)
  }

  const cells: string[] = []
  let current = ''
  let inCode = false
  let codeDelimiterLen = 0
  let i = 0

  while (i < text.length) {
    const char = text[i]

    // Escaped pipe \|
    if (char === '\\' && i + 1 < text.length && text[i + 1] === '|') {
      current += '\\|'
      i += 2
      continue
    }

    // Escaped backslash \\
    if (char === '\\' && i + 1 < text.length && text[i + 1] === '\\') {
      current += '\\\\'
      i += 2
      continue
    }

    // Code span delimiter run
    if (char === '`') {
      let runLen = 1
      while (i + runLen < text.length && text[i + runLen] === '`') {
        runLen++
      }

      if (!inCode) {
        inCode = true
        codeDelimiterLen = runLen
      } else if (runLen === codeDelimiterLen) {
        inCode = false
        codeDelimiterLen = 0
      }
      current += text.slice(i, i + runLen)
      i += runLen
      continue
    }

    // Table cell boundary (only outside inline code)
    if (char === '|' && !inCode) {
      cells.push(current.trim())
      current = ''
      i++
      continue
    }

    current += char
    i++
  }

  cells.push(current.trim())
  return cells
}

/**
 * Checks if a line is a markdown table separator (e.g. |---|:---:|---:| or ---|---).
 */
export function isSeparatorLine(line: string): boolean {
  const trimmed = line.trim()
  if (!trimmed || !trimmed.includes('|')) return false
  let inner = trimmed
  if (inner.startsWith('|')) inner = inner.slice(1)
  if (inner.endsWith('|') && !inner.endsWith('\\|')) inner = inner.slice(0, -1)
  inner = inner.trim()
  if (!inner) return false

  const parts = inner.split('|')
  if (parts.length === 0) return false
  return parts.every((p) => /^\s*:?-{1,}:?\s*$/.test(p))
}

/**
 * Checks if a line could be part of a markdown table.
 */
export function isTableLine(line: string): boolean {
  const trimmed = line.trim()
  if (!trimmed || trimmed.startsWith('```')) return false
  return trimmed.includes('|')
}

/**
 * Parses column alignments from a separator line.
 */
export function parseTableAlignments(separatorLine: string): TableAlignment[] {
  const parts = splitTableRow(separatorLine)
  return parts.map((part) => {
    const trimmed = part.trim()
    const startsWithColon = trimmed.startsWith(':')
    const endsWithColon = trimmed.endsWith(':')
    if (startsWithColon && endsWithColon) return 'center'
    if (endsWithColon) return 'right'
    if (startsWithColon) return 'left'
    return undefined
  })
}

/**
 * Parses inline markdown formatted text (**bold**, `code`, *italic*, [link](url), $math$, \(...\))
 * and returns React nodes.
 */
export function parseInlineMarkdown(text: string): React.ReactNode[] {
  const parts: React.ReactNode[] = []
  let currentText = ''
  let i = 0

  while (i < text.length) {
    // Escaped characters: \* \_ \` \[ \] \$ \| \\
    if (text[i] === '\\' && i + 1 < text.length && ['*', '_', '`', '[', ']', '$', '(', ')', '|', '\\'].includes(text[i + 1])) {
      currentText += text[i + 1]
      i += 2
      continue
    }

    // \(...\) inline LaTeX
    if (text.startsWith('\\(', i)) {
      if (currentText) { parts.push(currentText); currentText = '' }
      const closeIdx = text.indexOf('\\)', i + 2)
      if (closeIdx !== -1) {
        const latex = text.slice(i + 2, closeIdx)
        const node = renderKatex(latex, false, `math-inline-${i}`)
        parts.push(node ?? `\\(${latex}\\)`)
        i = closeIdx + 2
        continue
      } else {
        currentText += '\\('
        i += 2
        continue
      }
    }

    // $...$ inline LaTeX (not $$)
    if (text[i] === '$' && text[i + 1] !== '$') {
      const prevChar = i > 0 ? text[i - 1] : ' '
      const nextChar = text[i + 1] || ' '
      // Standard LaTeX rules: opening $ must not be preceded by alnum and not followed by whitespace or digit (currency amounts like $5)
      const isValidOpening = !/[a-zA-Z0-9]/.test(prevChar) && nextChar !== ' ' && nextChar !== '\t' && nextChar !== '\n' && !/^\d/.test(nextChar)

      if (isValidOpening) {
        const closeIdx = text.indexOf('$', i + 1)
        if (closeIdx !== -1) {
          const charBeforeClose = text[closeIdx - 1]
          const charAfterClose = text[closeIdx + 1] || ' '
          const latex = text.slice(i + 1, closeIdx)
          const isValidClosing = charBeforeClose !== ' ' && charBeforeClose !== '\t' && !/[0-9]/.test(charAfterClose) && !latex.includes('\n')
          // Must look like mathematical expression (contains math symbols, backslash commands, relations, or single variables)
          const looksLikeMath = /[\\_^=+\-*/<>∂∫∑∏√π]|\b[a-zA-Z]\b/.test(latex) && !/^\d+(?:[.,]\d+)?\s*(?:usd|eur|rub|руб|долл|cents?|dollars?)/i.test(latex)

          if (isValidClosing && looksLikeMath && latex.trim()) {
            if (currentText) { parts.push(currentText); currentText = '' }
            const node = renderKatex(latex, false, `math-dollar-${i}`)
            if (node) {
              parts.push(node)
              i = closeIdx + 1
              continue
            }
          }
        }
      }
      currentText += '$'
      i++
      continue
    }

    // **bold** or __bold__
    if (text.startsWith('**', i) || text.startsWith('__', i)) {
      const delim = text.slice(i, i + 2)
      if (currentText) { parts.push(currentText); currentText = '' }
      const closingIndex = text.indexOf(delim, i + 2)
      if (closingIndex !== -1) {
        parts.push(
          <strong key={`b-${i}`} className="md-bold">
            {parseInlineMarkdown(text.slice(i + 2, closingIndex))}
          </strong>
        )
        i = closingIndex + 2
        continue
      } else {
        currentText += delim
        i += 2
        continue
      }
    }

    // `code` or ``code with ` backtick``
    if (text[i] === '`') {
      let runLen = 1
      while (i + runLen < text.length && text[i + runLen] === '`') {
        runLen++
      }
      const delim = text.slice(i, i + runLen)
      const closingIndex = text.indexOf(delim, i + runLen)
      if (closingIndex !== -1) {
        if (currentText) { parts.push(currentText); currentText = '' }
        const codeContent = text.slice(i + runLen, closingIndex)
        parts.push(
          <code key={`code-${i}`} className="msg-inline-code">
            {codeContent}
          </code>
        )
        i = closingIndex + runLen
        continue
      } else {
        currentText += delim
        i += runLen
        continue
      }
    }

    // *italic* or _italic_ (with word-boundary check for _ so variable_names_with_underscores are not italicized)
    if (text[i] === '*' || (text[i] === '_' && (i === 0 || /\s/.test(text[i - 1])))) {
      const delim = text[i]
      if (currentText) { parts.push(currentText); currentText = '' }
      const closingIndex = text.indexOf(delim, i + 1)
      if (closingIndex !== -1 && closingIndex > i + 1) {
        parts.push(
          <em key={`em-${i}`} className="md-em">
            {parseInlineMarkdown(text.slice(i + 1, closingIndex))}
          </em>
        )
        i = closingIndex + 1
        continue
      } else {
        currentText += delim
        i += 1
        continue
      }
    }

    // [link](url)
    if (text[i] === '[') {
      const closingBracketIndex = text.indexOf(']', i + 1)
      if (closingBracketIndex !== -1 && text[closingBracketIndex + 1] === '(') {
        const closingParenIndex = text.indexOf(')', closingBracketIndex + 2)
        if (closingParenIndex !== -1) {
          if (currentText) { parts.push(currentText); currentText = '' }
          const linkText = text.slice(i + 1, closingBracketIndex)
          const rawLinkUrl = text.slice(closingBracketIndex + 2, closingParenIndex).trim()
          const isSafeUrl = /^(https?:\/\/|mailto:)/i.test(rawLinkUrl)
          if (isSafeUrl) {
            parts.push(
              <a
                key={`link-${i}`}
                href={rawLinkUrl}
                target="_blank"
                rel="noreferrer noopener"
                className="msg-link"
              >
                {parseInlineMarkdown(linkText)}
              </a>
            )
          } else {
            parts.push(parseInlineMarkdown(linkText))
          }
          i = closingParenIndex + 1
          continue
        }
      }
      currentText += '['
      i++
      continue
    }

    currentText += text[i]
    i++
  }

  if (currentText) parts.push(currentText)
  return parts
}

/**
 * Extracts basename from a file path
 */
export function getBaseName(filePath?: string): string {
  if (!filePath) return ''
  return filePath.split(/[/\\]/).pop() || filePath
}
