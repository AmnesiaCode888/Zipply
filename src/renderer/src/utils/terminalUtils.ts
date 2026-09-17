/**
 * Strip ANSI escape codes from terminal text.
 */
export function stripAnsiCodes(text: string): string {
  if (!text) return ''
  return text.replace(/[\u001b\u009b][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><]/g, '')
}

/**
 * Check if a line appears to be an in-progress progress bar or download indicator.
 */
export function isProgressBarLine(line: string): boolean {
  if (!line) return false
  const trimmed = line.trim()
  return (
    /\[[=\-#\s>.*]{3,}\]|\b\d{1,3}%\b|\b(?:downloading|uploading|fetching|installing|extracting|unpacking)\b.*\b\d+/i.test(
      trimmed
    ) ||
    /\b\d+(?:\.\d+)?\s*(?:MB|KB|GB|B)\s*\/\s*\d+(?:\.\d+)?\s*(?:MB|KB|GB|B)/i.test(trimmed) ||
    /^[|/\\-]\s+(?:downloading|fetching|loading|processing)/i.test(trimmed)
  )
}

/**
 * Update terminal lines array with incoming chunk.
 * Handles carriage return (\r) overwriting, CRLF normalisation,
 * and progress-bar deduplication to emulate real terminal behavior.
 */
export function updateTerminalOutputLines(
  existing: string[],
  incomingText: string,
  maxLines = 2000
): string[] {
  if (!incomingText) return existing

  const clean = stripAnsiCodes(incomingText)
  if (!clean) return existing

  const lines = [...existing]

  const startsWithCr = incomingText.startsWith('\r')

  // Normalize Windows CRLF to LF, and strip trailing \r or \n so split doesn't create trailing empty element
  const normalized = clean.replace(/\r\n/g, '\n')
  const trimmedEnd = normalized.replace(/[\r\n]+$/, '')
  if (!trimmedEnd) return lines

  const rawParts = trimmedEnd.split('\n')

  for (let i = 0; i < rawParts.length; i++) {
    let part = rawParts[i]

    // If part contains inline \r (e.g. "0%\r50%\r100%")
    if (part.includes('\r')) {
      const crParts = part.split('\r').filter((p) => p.length > 0)
      if (crParts.length > 0) {
        part = crParts[crParts.length - 1]
      }
    }

    const lastIsProgress = lines.length > 0 && isProgressBarLine(lines[lines.length - 1])
    const currentIsProgress = isProgressBarLine(part)

    if (i === 0 && startsWithCr && lines.length > 0) {
      // Explicit Carriage Return at start of chunk overwrites current line
      lines[lines.length - 1] = part
    } else if (currentIsProgress && lastIsProgress) {
      // Consecutive progress lines update in place
      lines[lines.length - 1] = part
    } else {
      lines.push(part)
    }
  }

  while (lines.length > 0 && lines[0] === '') {
    lines.shift()
  }

  if (lines.length > maxLines) {
    return lines.slice(-maxLines)
  }

  return lines
}
