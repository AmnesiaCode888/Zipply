import { execFile, spawn } from 'child_process'
import * as fs from 'fs/promises'
import * as path from 'path'
import { promisify } from 'util'
import type {
  ChangeScope,
  ChangeStatus,
  WorkspaceChangeEntry,
  WorkspaceChangesSummary,
  WorkspaceFileDiff
} from '../../../shared/workspaceChanges'
import {
  MAX_DIFF_BYTES,
  MAX_DIFF_LINES,
  buildSingleHunkPatch,
  countBufferLines,
  isBinaryBuffer,
  isBinaryFileHead,
  normalizePosix,
  parseUnifiedPatchToHunks,
  resolveInsideRoot,
  structuredDiffToHunks
} from './diffUtils'
import { isNoiseRelativePath } from './noiseFilter'

const execFileAsync = promisify(execFile)
const GIT_TIMEOUT = 15_000
const GIT_MAX_BUFFER = 8 * 1024 * 1024

export interface TrashOrRemoveFn {
  (absPath: string): Promise<void>
}

function runGit(args: string[], cwd: string): Promise<{ stdout: string; stderr: string }> {
  return execFileAsync('git', ['-c', 'core.quotepath=false', ...args], {
    cwd,
    windowsHide: true,
    timeout: GIT_TIMEOUT,
    maxBuffer: GIT_MAX_BUFFER,
    encoding: 'utf8'
  })
}

function runGitWithInput(args: string[], cwd: string, input: string): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn('git', ['-c', 'core.quotepath=false', ...args], {
      cwd,
      windowsHide: true
    })
    let stdout = ''
    let stderr = ''
    const timer = setTimeout(() => {
      child.kill()
      reject(new Error('Превышено время ожидания команды git.'))
    }, GIT_TIMEOUT)
    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    child.stdout.on('data', (chunk) => { stdout += chunk })
    child.stderr.on('data', (chunk) => { stderr += chunk })
    child.on('error', (err) => {
      clearTimeout(timer)
      reject(err)
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      if (code === 0) resolve({ stdout, stderr })
      else reject(new Error((stderr || stdout || `git exited with code ${code}`).trim()))
    })
    child.stdin.end(input, 'utf8')
  })
}

function mapGitCodeToStatus(code: string): ChangeStatus {
  switch (code) {
    case 'A': return 'added'
    case 'D': return 'deleted'
    case 'R': return 'renamed'
    case 'C': return 'copied'
    case 'U': return 'conflicted'
    case '?': return 'untracked'
    default: return 'modified'
  }
}

function parseNumstatZ(raw: string): Map<string, { added: number | null; removed: number | null; isBinary: boolean }> {
  const map = new Map<string, { added: number | null; removed: number | null; isBinary: boolean }>()
  if (!raw) return map
  const parts = raw.split('\0')
  let i = 0
  while (i < parts.length) {
    const token = parts[i++]
    if (!token) continue
    const match = /^(\d+|-)\t(\d+|-)\t(.*)$/.exec(token)
    if (!match) continue
    const [, addRaw, delRaw, pathPart] = match
    let filePath = pathPart
    // In `git diff --numstat -z`, renamed files have empty pathPart and next two tokens are old and new path
    if (!filePath && i + 1 < parts.length) {
      i++ // old path
      filePath = parts[i++] || ''
    }
    if (!filePath) continue
    const isBinary = addRaw === '-' || delRaw === '-'
    map.set(normalizePosix(filePath), {
      added: isBinary ? null : Number(addRaw),
      removed: isBinary ? null : Number(delRaw),
      isBinary
    })
  }
  return map
}

export class GitChangesDriver {
  private gitInstalledCache: { value: boolean; checkedAt: number } | null = null

  async isGitInstalled(): Promise<boolean> {
    const now = Date.now()
    if (this.gitInstalledCache && now - this.gitInstalledCache.checkedAt < 30_000) {
      return this.gitInstalledCache.value
    }
    try {
      await execFileAsync('git', ['--version'], { windowsHide: true, timeout: 5000 })
      this.gitInstalledCache = { value: true, checkedAt: now }
      return true
    } catch {
      this.gitInstalledCache = { value: false, checkedAt: now }
      return false
    }
  }

  async resolveRepoRoot(cwd: string): Promise<string | null> {
    try {
      const { stdout } = await runGit(['rev-parse', '--show-toplevel'], path.resolve(cwd))
      const root = stdout.trim()
      return root ? path.resolve(root) : null
    } catch {
      return null
    }
  }

  async hasGitMarker(folderPath: string): Promise<boolean> {
    try {
      let current = path.resolve(folderPath)
      while (true) {
        try {
          await fs.access(path.join(current, '.git'))
          return true
        } catch {
          const parent = path.dirname(current)
          if (parent === current) return false
          current = parent
        }
      }
    } catch {
      return false
    }
  }

  private async hasHead(folderPath: string): Promise<boolean> {
    try {
      await runGit(['rev-parse', '--verify', 'HEAD'], folderPath)
      return true
    } catch {
      return false
    }
  }

  private async getBranch(folderPath: string): Promise<string | null> {
    try {
      const { stdout } = await runGit(['symbolic-ref', '--short', 'HEAD'], folderPath)
      const branch = stdout.trim()
      if (branch) return branch
    } catch {
      // detached HEAD or unborn branch
    }
    try {
      const { stdout } = await runGit(['rev-parse', '--short', 'HEAD'], folderPath)
      const sha = stdout.trim()
      return sha ? `HEAD (${sha})` : null
    } catch {
      return 'main (без коммитов)'
    }
  }

  private async toRepoRelative(repoRoot: string, folderPath: string, relPath: string): Promise<string> {
    const abs = await resolveInsideRoot(folderPath, relPath)
    const realRoot = await fs.realpath(repoRoot)
    return normalizePosix(path.relative(realRoot, abs))
  }

  private async readGitObjectText(repoRoot: string, spec: string): Promise<string | null> {
    try {
      const { stdout } = await execFileAsync('git', ['-c', 'core.quotepath=false', 'show', spec], {
        cwd: repoRoot,
        windowsHide: true,
        timeout: GIT_TIMEOUT,
        maxBuffer: MAX_DIFF_BYTES + 1024,
        encoding: 'buffer' as unknown as BufferEncoding
      }) as unknown as { stdout: Buffer }
      const buf = Buffer.isBuffer(stdout) ? stdout : Buffer.from(stdout)
      if (buf.byteLength > MAX_DIFF_BYTES || isBinaryBuffer(buf)) return null
      return buf.toString('utf8')
    } catch {
      return null
    }
  }

  async getSummary(
    folderPath: string,
    repoRoot: string,
    touchedPaths?: Set<string>,
    includeNoise = false
  ): Promise<WorkspaceChangesSummary> {
    const [realFolder, realRoot] = await Promise.all([
      fs.realpath(folderPath).catch(() => path.resolve(folderPath)),
      fs.realpath(repoRoot).catch(() => path.resolve(repoRoot))
    ])
    const toFolderRel = (repoRel: string): string =>
      normalizePosix(path.relative(realFolder, path.join(realRoot, repoRel)))

    const [branch, statusRes, unstagedNumRes, stagedNumRes] = await Promise.all([
      this.getBranch(folderPath),
      runGit(['status', '--porcelain=v1', '-z', '-uall', '--', '.'], folderPath),
      runGit(['diff', '--numstat', '-z', '--', '.'], folderPath).catch(() => ({ stdout: '' })),
      runGit(['diff', '--cached', '--numstat', '-z', '--', '.'], folderPath).catch(() => ({ stdout: '' }))
    ])

    const unstagedStats = parseNumstatZ(unstagedNumRes.stdout)
    const stagedStats = parseNumstatZ(stagedNumRes.stdout)
    const entries: WorkspaceChangeEntry[] = []
    let hiddenNoiseCount = 0

    const tokens = statusRes.stdout.split('\0')
    let i = 0
    while (i < tokens.length) {
      const record = tokens[i++]
      if (!record || record.length < 4) continue
      const x = record[0]
      const y = record[1]
      const repoFilePath = normalizePosix(record.slice(3))
      const filePath = toFolderRel(repoFilePath)
      let oldPath: string | undefined
      if (x === 'R' || x === 'C' || y === 'R' || y === 'C') {
        const nextToken = tokens[i++]
        if (nextToken) oldPath = toFolderRel(normalizePosix(nextToken))
      }
      const touched = touchedPaths?.has(filePath) || false

      // Filter generated paths in every Git state, not only untracked files.
      if (!includeNoise && !touched && isNoiseRelativePath(filePath)) {
        hiddenNoiseCount++
        continue
      }

      if (x === '?' && y === '?') {
        let added: number | null = null
        let isBinary = false
        try {
          const abs = await resolveInsideRoot(folderPath, filePath)
          const stat = await fs.stat(abs)
          if (stat.isFile()) {
            if (await isBinaryFileHead(abs)) {
              isBinary = true
            } else if (stat.size <= 512_000) {
              const buf = await fs.readFile(abs)
              added = countBufferLines(buf)
            }
          }
        } catch {
          // ignore unreadable untracked entry
        }
        entries.push({
          id: `unstaged:${filePath}`,
          path: filePath,
          status: 'untracked',
          scope: 'unstaged',
          added,
          removed: isBinary ? null : 0,
          isBinary,
          touchedByChat: touched
        })
        continue
      }

      const isConflict =
        x === 'U' ||
        y === 'U' ||
        (x === 'A' && y === 'A') ||
        (x === 'D' && y === 'D')

      if (isConflict) {
        const stat = unstagedStats.get(repoFilePath)
        entries.push({
          id: `unstaged:${filePath}`,
          path: filePath,
          status: 'conflicted',
          scope: 'unstaged',
          added: stat?.added ?? null,
          removed: stat?.removed ?? null,
          isBinary: stat?.isBinary ?? false,
          touchedByChat: touched
        })
        continue
      }

      if (x !== ' ' && x !== '?') {
        const stat = stagedStats.get(repoFilePath)
        entries.push({
          id: `staged:${filePath}`,
          path: filePath,
          ...(oldPath ? { oldPath } : {}),
          status: mapGitCodeToStatus(x),
          scope: 'staged',
          added: stat?.added ?? null,
          removed: stat?.removed ?? null,
          isBinary: stat?.isBinary ?? false,
          touchedByChat: touched
        })
      }

      if (y !== ' ' && y !== '?') {
        const stat = unstagedStats.get(repoFilePath)
        entries.push({
          id: `unstaged:${filePath}`,
          path: filePath,
          ...(oldPath && x === ' ' ? { oldPath } : {}),
          status: mapGitCodeToStatus(y),
          scope: 'unstaged',
          added: stat?.added ?? null,
          removed: stat?.removed ?? null,
          isBinary: stat?.isBinary ?? false,
          touchedByChat: touched
        })
      }
    }

    entries.sort((a, b) => {
      if (Boolean(a.touchedByChat) !== Boolean(b.touchedByChat)) {
        return a.touchedByChat ? -1 : 1
      }
      return a.path.localeCompare(b.path)
    })

    const uniqueFiles = new Set<string>()
    let totalAdded = 0
    let totalRemoved = 0
    for (const entry of entries) {
      uniqueFiles.add(entry.path)
      if (typeof entry.added === 'number') totalAdded += entry.added
      if (typeof entry.removed === 'number') totalRemoved += entry.removed
    }

    return {
      mode: 'git',
      folderPath,
      repoRoot,
      branch,
      gitInstalled: true,
      hasGitFolder: true,
      ...(hiddenNoiseCount > 0 ? { hiddenNoiseCount } : {}),
      entries,
      totals: {
        files: uniqueFiles.size,
        added: totalAdded,
        removed: totalRemoved
      }
    }
  }

  async getFileDiff(
    folderPath: string,
    repoRoot: string,
    filePath: string,
    scope: ChangeScope,
    status: ChangeStatus
  ): Promise<WorkspaceFileDiff> {
    const cleanPath = normalizePosix(filePath)
    if (status === 'untracked') {
      const abs = await resolveInsideRoot(folderPath, cleanPath)
      const stat = await fs.stat(abs)
      if (!stat.isFile()) {
        return { path: cleanPath, scope, status, kind: 'empty', hunks: [] }
      }
      if (stat.size > MAX_DIFF_BYTES) {
        return { path: cleanPath, scope, status, kind: 'too-large', hunks: [] }
      }
      const buf = await fs.readFile(abs)
      if (isBinaryBuffer(buf)) {
        return { path: cleanPath, scope, status, kind: 'binary', hunks: [] }
      }
      const text = buf.toString('utf8').replace(/\r\n/g, '\n')
      const lineCount = countBufferLines(buf)
      if (lineCount > MAX_DIFF_LINES) {
        return { path: cleanPath, scope, status, kind: 'too-large', hunks: [] }
      }
      const { hunks } = structuredDiffToHunks(cleanPath, '', text)
      return {
        path: cleanPath,
        scope,
        status,
        kind: hunks.length ? 'text' : 'empty',
        hunks,
        oldText: '',
        newText: text
      }
    }

    const args = scope === 'staged'
      ? ['diff', '--cached', '--no-color', '--unified=3', '--relative', '--', cleanPath]
      : ['diff', '--no-color', '--unified=3', '--relative', '--', cleanPath]

    const { stdout } = await runGit(args, folderPath)
    if (Buffer.byteLength(stdout, 'utf8') > MAX_DIFF_BYTES) {
      return { path: cleanPath, scope, status, kind: 'too-large', hunks: [] }
    }

    const parsed = parseUnifiedPatchToHunks(stdout)
    if (parsed.isBinary) {
      return { path: cleanPath, scope, status, kind: 'binary', hunks: [] }
    }
    if (parsed.hunks.length === 0) {
      return { path: cleanPath, scope, status, kind: 'empty', hunks: [] }
    }

    let oldText: string | undefined
    let newText: string | undefined
    try {
      const repoRel = await this.toRepoRelative(repoRoot, folderPath, cleanPath)
      if (scope === 'staged') {
        const hasHeadRef = await this.hasHead(folderPath)
        oldText = status === 'added' || !hasHeadRef ? '' : (await this.readGitObjectText(repoRoot, `HEAD:${repoRel}`)) ?? undefined
        newText = status === 'deleted' ? '' : (await this.readGitObjectText(repoRoot, `:${repoRel}`)) ?? undefined
      } else {
        oldText = (await this.readGitObjectText(repoRoot, `:${repoRel}`)) ?? undefined
        if (oldText === undefined && (await this.hasHead(folderPath))) {
          oldText = (await this.readGitObjectText(repoRoot, `HEAD:${repoRel}`)) ?? undefined
        }
        if (status === 'deleted') {
          newText = ''
        } else {
          const abs = await resolveInsideRoot(folderPath, cleanPath)
          const stat = await fs.stat(abs)
          if (stat.size <= MAX_DIFF_BYTES) {
            const buf = await fs.readFile(abs)
            if (!isBinaryBuffer(buf)) newText = buf.toString('utf8').replace(/\r\n/g, '\n')
          }
        }
      }
    } catch {
      // Fallback to hunks-only if reading full sides fails
    }

    return {
      path: cleanPath,
      scope,
      status,
      kind: 'text',
      hunks: parsed.hunks,
      oldText,
      newText,
      ...(status === 'conflicted' ? { warning: 'В файле есть маркеры конфликта слияния. Разрешите конфликт перед коммитом.' } : {})
    }
  }

  async stage(folderPath: string, paths: string[]): Promise<void> {
    if (!paths.length) return
    await runGit(['add', '-A', '--', ...paths.map(normalizePosix)], folderPath)
  }

  async unstage(folderPath: string, paths: string[]): Promise<void> {
    if (!paths.length) return
    const clean = paths.map(normalizePosix)
    const hasHeadRef = await this.hasHead(folderPath)
    if (!hasHeadRef) {
      await runGit(['rm', '--cached', '-q', '--', ...clean], folderPath)
      return
    }
    try {
      await runGit(['restore', '--staged', '--', ...clean], folderPath)
    } catch {
      await runGit(['reset', '-q', 'HEAD', '--', ...clean], folderPath)
    }
  }

  async discardFile(
    folderPath: string,
    filePath: string,
    scope: ChangeScope,
    status: ChangeStatus,
    trashOrRemove: TrashOrRemoveFn
  ): Promise<void> {
    const clean = normalizePosix(filePath)
    if (status === 'untracked') {
      const abs = await resolveInsideRoot(folderPath, clean)
      await trashOrRemove(abs)
      return
    }
    if (scope === 'staged') {
      const hasHeadRef = await this.hasHead(folderPath)
      if (!hasHeadRef || status === 'added') {
        await this.unstage(folderPath, [clean])
        const abs = await resolveInsideRoot(folderPath, clean)
        await trashOrRemove(abs).catch(() => {})
        return
      }
      try {
        await runGit(['restore', '--staged', '--worktree', '--', clean], folderPath)
      } catch {
        await runGit(['reset', '-q', 'HEAD', '--', clean], folderPath)
        await runGit(['checkout', '--', clean], folderPath)
      }
      return
    }
    try {
      await runGit(['restore', '--worktree', '--', clean], folderPath)
    } catch {
      await runGit(['checkout', '--', clean], folderPath)
    }
  }

  async revertHunk(
    folderPath: string,
    repoRoot: string,
    filePath: string,
    scope: ChangeScope,
    hunkIndex: number
  ): Promise<void> {
    const clean = normalizePosix(filePath)
    const args = scope === 'staged'
      ? ['diff', '--cached', '--no-color', '--unified=3', '--relative', '--', clean]
      : ['diff', '--no-color', '--unified=3', '--relative', '--', clean]
    const { stdout } = await runGit(args, folderPath)
    const parsed = parseUnifiedPatchToHunks(stdout)
    const hunk = parsed.hunks[hunkIndex]
    if (!hunk) {
      throw new Error('Выбранный блок изменений больше не актуален — список обновлён.')
    }
    const repoRel = await this.toRepoRelative(repoRoot, folderPath, clean)
    const patch = buildSingleHunkPatch(repoRel, hunk, false)
    const applyArgs = scope === 'staged'
      ? ['apply', '--reverse', '--cached', '--unidiff-zero', '-']
      : ['apply', '--reverse', '--unidiff-zero', '-']
    await runGitWithInput(applyArgs, repoRoot, patch)
  }

  async commit(folderPath: string, message: string): Promise<{ sha: string }> {
    const trimmed = message.trim()
    if (!trimmed) {
      throw new Error('Введите сообщение коммита.')
    }
    await runGitWithInput(['commit', '-F', '-'], folderPath, `${trimmed}\n`)
    const { stdout } = await runGit(['rev-parse', '--short', 'HEAD'], folderPath).catch(() => ({ stdout: '' }))
    return { sha: stdout.trim() }
  }

  async initRepo(folderPath: string): Promise<void> {
    await runGit(['init'], folderPath)
  }
}
