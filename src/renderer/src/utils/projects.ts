/**
 * Returns the last path segment of a Windows/Unix path.
 * `d:\zipplyprojects\my-bot` -> `my-bot`, `/home/user/app` -> `app`.
 */
export function basenamePath(p: string): string {
  const parts = p.replace(/[\\/]+$/, '').split(/[\\/]/)
  return parts[parts.length - 1] || p
}

// Matches an absolute path token:
//   - Windows:  C:\...  or  C:/...
//   - Home dir: ~/...
//   - Unix abs: /seg1/seg2  (requires at least TWO segments so a lone /word is ignored)
const PATH_RE_G =
  /(?:[a-zA-Z]:[\\/][^\s`"'<>|?*]+|~[\\/][^\s`"'<>|?*]+|\/[^\s`"'<>|?*\\/]+(?:[\\/][^\s`"'<>|?*]+)+)/g

/**
 * Extracts all absolute paths typed inside a free-text prompt, in order.
 * Heuristically ignores tokens that look like they're embedded in a URL or word.
 */
export function extractPathsFromText(text: string): string[] {
  const result: string[] = []
  let m: RegExpExecArray | null
  PATH_RE_G.lastIndex = 0
  while ((m = PATH_RE_G.exec(text)) !== null) {
    const idx = m.index
    const before = idx > 0 ? text[idx - 1] : ''
    // Skip if preceded by a letter, digit, dot, colon, or any unicode letter-like char
    // (catches Cyrillic etc. to avoid treating "текст/что-то/слово" as a path)
    if (before && /[^\s(,;!?[\]{}'"<>]/.test(before)) {
      continue
    }
    const p = m[0].replace(/[),.;:!?]+$/, '')
    if (!p || p === '/' || p === '~/' || p === '\\') continue
    result.push(p)
  }
  return result
}

/** First detected path, or null. */
export function extractPathFromText(text: string): string | null {
  return extractPathsFromText(text)[0] ?? null
}
