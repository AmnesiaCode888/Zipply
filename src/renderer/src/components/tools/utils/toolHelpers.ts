export interface DiffCounts {
  added: number
  removed: number
}

/** A bounded, provisional diff for the content received so far. */
export function computeStreamingDiffCounts(baseline?: string, content?: string): DiffCounts | null {
  if (baseline === undefined || content === undefined) return null

  const lineCount = (text: string): number => text ? text.split('\n').length - (text.endsWith('\n') ? 1 : 0) : 0
  if (!baseline) {
    if (content === undefined) return null
    return { added: lineCount(content), removed: 0 }
  }
  if (!content) {
    return { added: 0, removed: lineCount(baseline) }
  }

  const changes = diffLines(baseline, content, { timeout: 8, maxEditLength: 256 })
  if (changes) {
    return changes.reduce((counts, part) => {
      if (part.added) counts.added += lineCount(part.value)
      if (part.removed) counts.removed += lineCount(part.value)
      return counts
    }, { added: 0, removed: 0 })
  }

  // For very large rewrites, use the differing middle as a quick estimate.
  const oldLines = baseline.match(/[^\n]*\n|[^\n]+$/g) || []
  const newLines = content.match(/[^\n]*\n|[^\n]+$/g) || []
  let start = 0
  while (start < oldLines.length && start < newLines.length && oldLines[start] === newLines[start]) start++
  let oldEnd = oldLines.length
  let newEnd = newLines.length
  while (oldEnd > start && newEnd > start && oldLines[oldEnd - 1] === newLines[newEnd - 1]) { oldEnd--; newEnd-- }
  return { added: newEnd - start, removed: oldEnd - start }
}

/**
 * Check if tool represents a file edit or creation operation
 */
export const isFileEditOrWrite = (tool: { type?: string; label?: string }): boolean => {
  if (tool.type === 'file_edit') return true
  const lowerLabel = (tool.label || '').toLowerCase()
  return (
    lowerLabel.includes('написал') ||
    lowerLabel.includes('редакт') ||
    lowerLabel.includes('создал') ||
    lowerLabel.includes('записал') ||
    lowerLabel.includes('write') ||
    lowerLabel.includes('edit')
  )
}

/**
 * Check if tool represents a file read operation
 */
export const isReadTool = (tool: { type?: string; label?: string }): boolean => {
  if (tool.type === 'file_read') return true
  const lowerLabel = (tool.label || '').toLowerCase().trim()
  return lowerLabel === 'read' || lowerLabel.startsWith('read ') || lowerLabel.includes('прочитал')
}

/**
 * Check if tool represents a search operation
 */
export const isSearchTool = (tool: { type?: string; label?: string }): boolean => {
  if (tool.type === 'search') return true
  const lowerLabel = (tool.label || '').toLowerCase().trim()
  return lowerLabel === 'search' || lowerLabel.startsWith('search ') || lowerLabel.includes('поиск')
}

/**
 * Computes line diff count (+added, -removed) from diff object or diff text
 */
export const computeDiffCounts = (
  diff?: { added?: number; removed?: number },
  diffText?: string,
  content?: string
): DiffCounts => {
  if (diff && (diff.added !== undefined || diff.removed !== undefined)) {
    return {
      added: diff.added ?? 0,
      removed: diff.removed ?? 0
    }
  }

  const text = diffText || content || ''
  let added = 0
  let removed = 0
  let hasDiffMarkers = false
  const lines = text.split('\n')
  for (const line of lines) {
    if (line.startsWith('+') && !line.startsWith('+++')) {
      added++
      hasDiffMarkers = true
    } else if (line.startsWith('-') && !line.startsWith('---')) {
      removed++
      hasDiffMarkers = true
    }
  }
  if (!hasDiffMarkers && text.trim().length > 0) {
    const lineCount = text.split('\n').length - (text.endsWith('\n') ? 1 : 0)
    return { added: lineCount, removed: 0 }
  }
  return { added, removed }
}
import { diffLines } from 'diff'

