import type { WorkspaceDiagnostic } from '../../../../shared/workspaceFiles'

export interface DiagnosticSpan { text: string; category?: 'Error' | 'Warning' }
export function diagnosticSpans(text: string, diagnostics: WorkspaceDiagnostic[]): DiagnosticSpan[] {
  const starts = [0]
  for (let index = 0; index < text.length; index++) if (text.charCodeAt(index) === 10) starts.push(index + 1)
  const offset = (line: number, column: number): number | null => {
    if (!Number.isInteger(line) || line < 1 || line > starts.length || !Number.isFinite(column)) return null
    const start = starts[line - 1]
    const end = line < starts.length ? starts[line] - 1 : text.length
    return Math.max(start, Math.min(end, start + Math.max(0, column - 1)))
  }
  const ranges: { start: number; end: number; category: 'Error' | 'Warning' }[] = []
  for (const item of diagnostics.slice(0, 100)) {
    let start = offset(item.line, item.column)
    if (start === null || !text.length) continue
    let end = offset(item.endLine ?? item.line, item.endColumn ?? item.column + 1) ?? start + 1
    if (end <= start) { if (start === text.length) start--; end = start + 1 }
    ranges.push({ start, end: Math.min(text.length, end), category: item.category === 'Error' ? 'Error' : 'Warning' })
  }
  ranges.sort((a, b) => a.start - b.start || b.end - a.end)
  const merged: typeof ranges = []
  for (const range of ranges) {
    const previous = merged[merged.length - 1]
    if (previous && range.start <= previous.end) { previous.end = Math.max(previous.end, range.end); if (range.category === 'Error') previous.category = 'Error' }
    else merged.push({ ...range })
  }
  const result: DiagnosticSpan[] = []
  let cursor = 0
  for (const range of merged) {
    if (range.start > cursor) result.push({ text: text.slice(cursor, range.start) })
    result.push({ text: text.slice(range.start, range.end), category: range.category })
    cursor = range.end
  }
  if (cursor < text.length) result.push({ text: text.slice(cursor) })
  return result
}
