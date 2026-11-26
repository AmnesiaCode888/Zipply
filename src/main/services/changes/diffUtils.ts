import * as Diff from 'diff'
import * as fs from 'fs/promises'
import * as path from 'path'
import type { DiffHunk, DiffHunkLine } from '../../../shared/workspaceChanges'

export const MAX_DIFF_BYTES = 1_500_000
export const MAX_DIFF_LINES = 20_000

export function isBinaryBuffer(buf: Buffer): boolean {
  const limit = Math.min(buf.length, 2048)
  for (let i = 0; i < limit; i++) {
    if (buf[i] === 0) return true
  }
  return false
}

export async function isBinaryFileHead(absPath: string): Promise<boolean> {
  try {
    const handle = await fs.open(absPath, 'r')
    try {
      const buf = Buffer.alloc(2048)
      const { bytesRead } = await handle.read(buf, 0, buf.length, 0)
      return isBinaryBuffer(buf.subarray(0, bytesRead))
    } finally {
      await handle.close()
    }
  } catch {
    return false
  }
}

export function countBufferLines(buf: Buffer): number {
  if (buf.length === 0) return 0
  let count = 1
  for (let i = 0; i < buf.length; i++) {
    if (buf[i] === 10) count++
  }
  if (buf[buf.length - 1] === 10) count--
  return count
}

export async function resolveInsideRoot(root: string, relative: string): Promise<string> {
  if (typeof root !== 'string' || !path.isAbsolute(root) || typeof relative !== 'string' || path.isAbsolute(relative)) {
    throw new Error('Недопустимый путь.')
  }
  const actualRoot = await fs.realpath(root)
  const target = path.resolve(actualRoot, relative || '.')
  let actual = target
  try {
    actual = await fs.realpath(target)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    const parent = path.dirname(target)
    try {
      const actualParent = await fs.realpath(parent)
      actual = path.join(actualParent, path.basename(target))
    } catch {
      actual = target
    }
  }
  const rel = path.relative(actualRoot, actual)
  if (rel === '..' || rel.startsWith(`..${path.sep}`) || path.isAbsolute(rel)) {
    throw new Error('Путь находится вне рабочей папки.')
  }
  return actual
}

export function normalizePosix(p: string): string {
  return p.replace(/\\/g, '/').replace(/^\.\//, '')
}

export function parseUnifiedPatchToHunks(patchText: string): { hunks: DiffHunk[]; isBinary: boolean } {
  const normalized = patchText.replace(/\r\n/g, '\n')
  const rawLines = normalized.split('\n')
  if (rawLines.some((l) => l.startsWith('Binary files ') || l === 'GIT binary patch')) {
    return { hunks: [], isBinary: true }
  }

  const hunks: DiffHunk[] = []
  let current: DiffHunk | null = null
  let oldLine = 0
  let newLine = 0

  for (const line of rawLines) {
    const headerMatch = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@(.*)$/.exec(line)
    if (headerMatch) {
      if (current) hunks.push(current)
      oldLine = Number(headerMatch[1])
      const oldLines = headerMatch[2] !== undefined ? Number(headerMatch[2]) : 1
      newLine = Number(headerMatch[3])
      const newLines = headerMatch[4] !== undefined ? Number(headerMatch[4]) : 1
      const index = hunks.length
      current = {
        id: `hunk-${index}`,
        index,
        header: line,
        oldStart: oldLine,
        oldLines,
        newStart: newLine,
        newLines,
        lines: []
      }
      continue
    }

    if (!current) continue
    if (line.startsWith('\\ No newline at end of file')) continue
    if (line.startsWith('diff --git ') || line.startsWith('--- ') || line.startsWith('+++ ')) {
      continue
    }

    if (line.startsWith('+')) {
      current.lines.push({ type: 'add', newLine: newLine++, text: line.slice(1) })
    } else if (line.startsWith('-')) {
      current.lines.push({ type: 'del', oldLine: oldLine++, text: line.slice(1) })
    } else if (line.startsWith(' ')) {
      current.lines.push({ type: 'context', oldLine: oldLine++, newLine: newLine++, text: line.slice(1) })
    }
  }

  if (current) hunks.push(current)
  return { hunks, isBinary: false }
}

export function structuredDiffToHunks(
  relPath: string,
  oldText: string,
  newText: string
): { hunks: DiffHunk[]; added: number; removed: number } {
  const normOld = oldText.replace(/\r\n/g, '\n')
  const normNew = newText.replace(/\r\n/g, '\n')
  const patch = Diff.structuredPatch(relPath, relPath, normOld, normNew, '', '', { context: 3 })
  let added = 0
  let removed = 0
  const hunks: DiffHunk[] = patch.hunks.map((h, index) => {
    let oldLine = h.oldStart
    let newLine = h.newStart
    const lines: DiffHunkLine[] = []
    for (const raw of h.lines) {
      if (raw.startsWith('\\')) continue
      if (raw.startsWith('+')) {
        added++
        lines.push({ type: 'add', newLine: newLine++, text: raw.slice(1) })
      } else if (raw.startsWith('-')) {
        removed++
        lines.push({ type: 'del', oldLine: oldLine++, text: raw.slice(1) })
      } else {
        lines.push({ type: 'context', oldLine: oldLine++, newLine: newLine++, text: raw.slice(1) })
      }
    }
    return {
      id: `hunk-${index}`,
      index,
      header: `@@ -${h.oldStart},${h.oldLines} +${h.newStart},${h.newLines} @@`,
      oldStart: h.oldStart,
      oldLines: h.oldLines,
      newStart: h.newStart,
      newLines: h.newLines,
      lines
    }
  })
  return { hunks, added, removed }
}

/**
 * Builds a forward unified patch for a single hunk (for `git apply --reverse`),
 * or a reversed unified patch (for `Diff.applyPatch(currentText, reversedPatch)`).
 */
export function buildSingleHunkPatch(relPath: string, hunk: DiffHunk, reverseForApplyPatch = false): string {
  const posix = normalizePosix(relPath)
  if (!reverseForApplyPatch) {
    const body = hunk.lines
      .map((l) => (l.type === 'add' ? `+${l.text}` : l.type === 'del' ? `-${l.text}` : ` ${l.text}`))
      .join('\n')
    return `--- a/${posix}\n+++ b/${posix}\n${hunk.header}\n${body}\n`
  }

  const revHeader = `@@ -${hunk.newStart},${hunk.newLines} +${hunk.oldStart},${hunk.oldLines} @@`
  const revBody = hunk.lines
    .map((l) => {
      if (l.type === 'add') return `-${l.text}`
      if (l.type === 'del') return `+${l.text}`
      return ` ${l.text}`
    })
    .join('\n')
  return `--- a/${posix}\n+++ b/${posix}\n${revHeader}\n${revBody}\n`
}
