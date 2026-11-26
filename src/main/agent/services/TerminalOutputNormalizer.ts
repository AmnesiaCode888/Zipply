import * as fs from 'fs/promises'
import * as os from 'os'
import * as path from 'path'

// CSI sequences, OSC sequences (BEL or ST terminated), and single-char ESC codes
const ANSI_REGEX = /\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|\x1b\[[0-?]*[ -/]*[@-~]|\x1b[@-Z\\-_]/g

export function stripAnsi(text: string): string {
  return text.replace(ANSI_REGEX, '')
}

/**
 * Normalizes raw PTY/pipe output for LLM consumption:
 * - Strips ANSI/VT100 escape codes
 * - Converts CRLF to LF
 * - Resolves bare CR (\r) progress-bar overwrites by keeping the final segment per line
 */
export function normalizeTerminalText(raw: string): string {
  if (!raw) return ''
  const clean = stripAnsi(raw).replace(/\r\n/g, '\n')
  return clean
    .split('\n')
    .map((line) => {
      if (!line.includes('\r')) return line
      const parts = line.split('\r')
      for (let i = parts.length - 1; i >= 0; i--) {
        if (parts[i].length > 0) return parts[i]
      }
      return ''
    })
    .join('\n')
}

export interface FormatForLlmOptions {
  maxLines?: number
  maxChars?: number
  spillDir?: string
  sessionId?: string
}

export async function formatForLlm(
  raw: string,
  options: FormatForLlmOptions = {}
): Promise<{ text: string; truncated: boolean; logPath?: string }> {
  const maxLines = options.maxLines ?? 220
  const maxChars = options.maxChars ?? 16000
  const normalized = normalizeTerminalText(raw)
  const lines = normalized.split('\n')

  if (lines.length <= maxLines && normalized.length <= maxChars) {
    return { text: normalized, truncated: false }
  }

  let logPath: string | undefined
  try {
    const dir = options.spillDir || path.join(os.tmpdir(), 'zipply-terminal-logs')
    await fs.mkdir(dir, { recursive: true })
    const safeId = (options.sessionId || `cmd-${Date.now()}`).replace(/[^a-zA-Z0-9_-]/g, '_')
    logPath = path.join(dir, `${safeId}.log`)
    await fs.writeFile(logPath, normalized, 'utf8')
  } catch {
    // Spill-to-disk is best-effort; truncation still protects LLM context.
  }

  let result = normalized
  if (lines.length > maxLines) {
    const headCount = Math.max(20, Math.floor(maxLines * 0.3))
    const tailCount = Math.max(40, maxLines - headCount)
    const omitted = lines.length - headCount - tailCount
    if (omitted > 0) {
      result = [
        ...lines.slice(0, headCount),
        `\n... [пропущено ${omitted} строк вывода] ...\n`,
        ...lines.slice(lines.length - tailCount)
      ].join('\n')
    }
  }

  if (result.length > maxChars) {
    const headChars = Math.floor((maxChars - 240) * 0.35)
    const tailChars = Math.max(200, maxChars - 240 - headChars)
    const omittedChars = result.length - headChars - tailChars
    result = `${result.slice(0, headChars)}\n\n... [пропущено ${omittedChars} символов] ...\n\n${result.slice(-tailChars)}`
  }

  const notice = logPath ? `\n[Полный лог сохранён: ${logPath}]` : ''
  return { text: result + notice, truncated: true, logPath }
}
