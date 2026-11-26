/**
 * OutputTruncator — Smart Head/Tail Truncation for Agent Tool Outputs.
 *
 * Prevents context window explosion while preserving the most informative signals:
 * - Head: Initial command parameters, headers, and start of operation
 * - Tail: Final execution status, summary, and stack trace / error messages
 */
export class OutputTruncator {
  private static readonly DEFAULT_MAX_LINES = 250
  private static readonly DEFAULT_HEAD_LINES = 60
  private static readonly DEFAULT_TAIL_LINES = 140
  private static readonly DEFAULT_MAX_CHARS = 35000

  /**
   * Truncates long multi-line tool outputs using a Head/Tail strategy.
   */
  static truncate(
    content: string,
    maxLines = this.DEFAULT_MAX_LINES,
    headLines = this.DEFAULT_HEAD_LINES,
    tailLines = this.DEFAULT_TAIL_LINES,
    maxChars = this.DEFAULT_MAX_CHARS
  ): string {
    if (!content || typeof content !== 'string') return ''

    // 1. Line-based Head/Tail truncation
    const lines = content.split('\n')
    let result = content

    if (lines.length > maxLines) {
      const omittedCount = lines.length - headLines - tailLines
      if (omittedCount > 0) {
        const head = lines.slice(0, headLines)
        const tail = lines.slice(lines.length - tailLines)

        result = [
          ...head,
          `\n... [ВЫВОД УСЕЧЕН: пропущено ${omittedCount} строк] ...\n`,
          ...tail
        ].join('\n')
      }
    }

    // 2. Absolute character-limit safety guard
    if (result.length > maxChars) {
      const half = Math.floor((maxChars - 200) / 2)
      const headPart = result.slice(0, half)
      const tailPart = result.slice(result.length - half)
      result = `${headPart}\n\n... [ВЫВОД УСЕЧЕН: пропущено ${result.length - 2 * half} символов] ...\n\n${tailPart}`
    }

    return result
  }
}
