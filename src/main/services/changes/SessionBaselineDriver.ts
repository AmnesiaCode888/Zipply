import * as Diff from 'diff'
import { createHash } from 'crypto'
import * as fs from 'fs/promises'
import * as path from 'path'
import { promisify } from 'util'
import * as zlib from 'zlib'
import ignore, { Ignore } from 'ignore'
import type {
  ChangeStatus,
  WorkspaceChangeEntry,
  WorkspaceChangesSummary,
  WorkspaceFileDiff
} from '../../../shared/workspaceChanges'
import { writeFileAtomic } from '../../agent/tools/pathUtils'
import {
  MAX_DIFF_BYTES,
  MAX_DIFF_LINES,
  buildSingleHunkPatch,
  countBufferLines,
  isBinaryBuffer,
  normalizePosix,
  resolveInsideRoot,
  structuredDiffToHunks
} from './diffUtils'
import { isIgnoredDirName, isIgnoredFileName, isNoiseRelativePath, isPythonVenvDir } from './noiseFilter'
import type { TrashOrRemoveFn } from './GitChangesDriver'

const gzipAsync = promisify(zlib.gzip)
const gunzipAsync = promisify(zlib.gunzip)

const MAX_SCAN_FILES = 2000
const MAX_SCAN_FILE_BYTES = 512 * 1024
const MAX_PRE_EDIT_BYTES = 2 * 1024 * 1024
const MAX_BLOB_CACHE_BYTES = 32 * 1024 * 1024

interface BaselineEntry {
  state: 'existing' | 'absent'
  blobHash?: string
  isBinary?: boolean
  size?: number
  mtimeMs?: number
  mode?: number
  source: 'scan' | 'agent' | 'editor' | 'terminal'
  touchedByChat?: boolean
}

interface SessionBaselineManifest {
  version: 1
  folderPath: string
  createdAt: number
  updatedAt: number
  initialScanDone: boolean
  initialScanTruncated: boolean
  totalBlobBytes: number
  entries: Record<string, BaselineEntry>
}

function sha256(buf: Buffer): string {
  return createHash('sha256').update(buf).digest('hex')
}

function safeSessionDirName(sessionId: string): string {
  return sessionId.replace(/[^a-zA-Z0-9_-]/g, '_') || 'default'
}

export class SessionBaselineDriver {
  private readonly baseDir: string
  private queues = new Map<string, Promise<void>>()

  constructor(userDataDir: string) {
    this.baseDir = path.join(userDataDir, 'changes-sessions')
  }

  private sessionDir(sessionId: string): string {
    return path.join(this.baseDir, safeSessionDirName(sessionId))
  }

  private manifestPath(sessionId: string): string {
    return path.join(this.sessionDir(sessionId), 'manifest.json')
  }

  private blobPath(sessionId: string, hash: string): string {
    return path.join(this.sessionDir(sessionId), 'blobs', `${hash}.gz`)
  }

  private enqueue<T>(sessionId: string, fn: () => Promise<T>): Promise<T> {
    const prev = this.queues.get(sessionId) ?? Promise.resolve()
    const next = prev.then(fn, fn)
    this.queues.set(sessionId, next.then(() => {}, () => {}))
    return next
  }

  private async readManifest(sessionId: string, folderPath: string): Promise<SessionBaselineManifest> {
    const resolvedFolder = path.resolve(folderPath)
    try {
      const raw = await fs.readFile(this.manifestPath(sessionId), 'utf8')
      const parsed = JSON.parse(raw) as SessionBaselineManifest
      if (parsed && parsed.version === 1 && path.resolve(parsed.folderPath) === resolvedFolder) {
        return parsed
      }
      // Folder changed for this session — reset baseline store cleanly
      await fs.rm(this.sessionDir(sessionId), { recursive: true, force: true }).catch(() => {})
    } catch {
      // Missing or corrupted manifest -> start fresh
    }
    const now = Date.now()
    return {
      version: 1,
      folderPath: resolvedFolder,
      createdAt: now,
      updatedAt: now,
      initialScanDone: false,
      initialScanTruncated: false,
      totalBlobBytes: 0,
      entries: {}
    }
  }

  private async writeManifest(sessionId: string, manifest: SessionBaselineManifest): Promise<void> {
    const dir = this.sessionDir(sessionId)
    await fs.mkdir(dir, { recursive: true })
    manifest.updatedAt = Date.now()
    const target = this.manifestPath(sessionId)
    const tmp = `${target}.${process.pid}.${Date.now()}.tmp`
    await fs.writeFile(tmp, JSON.stringify(manifest), 'utf8')
    await fs.rename(tmp, target)
  }

  private async storeBlob(sessionId: string, manifest: SessionBaselineManifest, raw: Buffer): Promise<{ hash: string; storedBytes: number }> {
    const hash = sha256(raw)
    const dest = this.blobPath(sessionId, hash)
    try {
      const stat = await fs.stat(dest)
      return { hash, storedBytes: stat.size }
    } catch {
      await fs.mkdir(path.dirname(dest), { recursive: true })
      const gz = await gzipAsync(raw)
      await fs.writeFile(dest, gz)
      manifest.totalBlobBytes += gz.byteLength
      return { hash, storedBytes: gz.byteLength }
    }
  }

  private async loadBlob(sessionId: string, hash: string): Promise<Buffer | null> {
    try {
      const gz = await fs.readFile(this.blobPath(sessionId, hash))
      return await gunzipAsync(gz)
    } catch {
      return null
    }
  }

  private async walkWorkspaceFiles(
    folderPath: string,
    maxFiles: number,
    includeNoise = false
  ): Promise<{ files: Array<{ absPath: string; relPath: string }>; truncated: boolean; hiddenNoiseCount: number }> {
    const files: Array<{ absPath: string; relPath: string }> = []
    let truncated = false
    let hiddenNoiseCount = 0
    let root: string
    try {
      root = await fs.realpath(folderPath)
    } catch {
      return { files, truncated, hiddenNoiseCount }
    }

    const walk = async (dir: string, relDir: string, rules: Array<{ base: string; matcher: Ignore }>): Promise<void> => {
      if (truncated) return
      try {
        const gitignore = await fs.readFile(path.join(dir, '.gitignore'), 'utf8')
        rules = [...rules, { base: dir, matcher: ignore().add(gitignore) }]
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== 'ENOENT') return
      }

      let entries
      try {
        entries = await fs.readdir(dir, { withFileTypes: true })
      } catch {
        return
      }
      entries.sort((a, b) => a.name.localeCompare(b.name))

      for (const entry of entries) {
        if (truncated) break
        if (entry.name === '.git' || entry.isSymbolicLink()) continue
        const rel = relDir ? `${relDir}/${entry.name}` : entry.name
        const abs = path.join(dir, entry.name)
        const isDir = entry.isDirectory()
        if (!isDir && !entry.isFile()) continue

        if (!includeNoise) {
          if (isDir) {
            if (isIgnoredDirName(entry.name) || (await isPythonVenvDir(abs))) {
              hiddenNoiseCount++
              continue
            }
          } else if (isIgnoredFileName(entry.name)) {
            hiddenNoiseCount++
            continue
          }
        }

        let ignored = false
        for (const { base, matcher } of rules) {
          const sub = path.relative(base, abs).replace(/\\/g, '/')
          const test = matcher.test(isDir ? `${sub}/` : sub)
          if (test.ignored) ignored = true
          else if (test.unignored) ignored = false
        }
        if (ignored) continue

        if (isDir) {
          await walk(abs, rel, rules)
        } else {
          if (files.length >= maxFiles) {
            truncated = true
            break
          }
          files.push({ absPath: abs, relPath: normalizePosix(rel) })
        }
      }
    }

    await walk(root, '', [])
    return { files, truncated, hiddenNoiseCount }
  }

  async ensureBaselineScan(sessionId: string, folderPath: string): Promise<void> {
    await this.enqueue(sessionId, async () => {
      const manifest = await this.readManifest(sessionId, folderPath)
      if (manifest.initialScanDone) return

      const { files, truncated } = await this.walkWorkspaceFiles(folderPath, MAX_SCAN_FILES)
      let budgetExceeded = truncated
      for (const file of files) {
        if (manifest.entries[file.relPath]) continue
        if (manifest.totalBlobBytes >= MAX_BLOB_CACHE_BYTES) {
          budgetExceeded = true
          break
        }
        try {
          const stat = await fs.stat(file.absPath)
          if (!stat.isFile() || stat.size > MAX_SCAN_FILE_BYTES) {
            budgetExceeded = true
            continue
          }
          const buf = await fs.readFile(file.absPath)
          if (isBinaryBuffer(buf)) continue
          const { hash } = await this.storeBlob(sessionId, manifest, buf)
          manifest.entries[file.relPath] = {
            state: 'existing',
            blobHash: hash,
            isBinary: false,
            size: stat.size,
            mtimeMs: stat.mtimeMs,
            mode: stat.mode,
            source: 'scan'
          }
        } catch {
          // skip unreadable files
        }
      }
      manifest.initialScanDone = true
      manifest.initialScanTruncated = budgetExceeded
      await this.writeManifest(sessionId, manifest)
    })
  }

  async capturePreEditBaseline(
    sessionId: string,
    folderPath: string,
    absTarget: string,
    source: 'agent' | 'editor'
  ): Promise<void> {
    await this.enqueue(sessionId, async () => {
      let realRoot: string
      try {
        realRoot = await fs.realpath(folderPath)
      } catch {
        return
      }
      const resolvedTarget = path.resolve(absTarget)
      const rel = path.relative(realRoot, resolvedTarget)
      if (!rel || rel === '.' || rel === '..' || rel.startsWith(`..${path.sep}`) || path.isAbsolute(rel)) {
        return
      }
      const relPath = normalizePosix(rel)
      const manifest = await this.readManifest(sessionId, folderPath)
      const existing = manifest.entries[relPath]
      if (existing) {
        if (source === 'agent' && !existing.touchedByChat) {
          existing.touchedByChat = true
          await this.writeManifest(sessionId, manifest)
        }
        return
      }

      try {
        const stat = await fs.stat(resolvedTarget)
        if (!stat.isFile()) return
        if (stat.size > MAX_PRE_EDIT_BYTES) {
          manifest.entries[relPath] = {
            state: 'existing',
            size: stat.size,
            mtimeMs: stat.mtimeMs,
            mode: stat.mode,
            source,
            touchedByChat: source === 'agent'
          }
        } else {
          const buf = await fs.readFile(resolvedTarget)
          const binary = isBinaryBuffer(buf)
          const { hash } = await this.storeBlob(sessionId, manifest, buf)
          manifest.entries[relPath] = {
            state: 'existing',
            blobHash: hash,
            isBinary: binary,
            size: stat.size,
            mtimeMs: stat.mtimeMs,
            mode: stat.mode,
            source,
            touchedByChat: source === 'agent'
          }
        }
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== 'ENOENT') return
        manifest.entries[relPath] = {
          state: 'absent',
          source,
          touchedByChat: source === 'agent'
        }
      }
      await this.writeManifest(sessionId, manifest)
    })
  }

  async getTouchedPaths(sessionId: string, folderPath: string): Promise<Set<string>> {
    return this.enqueue(sessionId, async () => {
      const manifest = await this.readManifest(sessionId, folderPath)
      const set = new Set<string>()
      for (const [relPath, entry] of Object.entries(manifest.entries)) {
        if (entry.touchedByChat) set.add(relPath)
      }
      return set
    })
  }

  async getSummary(
    sessionId: string,
    folderPath: string,
    gitInstalled: boolean,
    hasGitFolder: boolean,
    includeNoise = false
  ): Promise<WorkspaceChangesSummary> {
    await this.ensureBaselineScan(sessionId, folderPath)
    return this.enqueue(sessionId, async () => {
      const manifest = await this.readManifest(sessionId, folderPath)
      const { files: currentFiles, truncated, hiddenNoiseCount: walkHidden } = await this.walkWorkspaceFiles(
        folderPath,
        MAX_SCAN_FILES,
        includeNoise
      )
      let hiddenNoiseCount = walkHidden
      const currentMap = new Map<string, string>()
      for (const f of currentFiles) {
        currentMap.set(f.relPath, f.absPath)
      }

      const entries: WorkspaceChangeEntry[] = []

      // 1. Check files present at baseline
      for (const [relPath, base] of Object.entries(manifest.entries)) {
        if (!includeNoise && !base.touchedByChat && isNoiseRelativePath(relPath)) {
          hiddenNoiseCount++
          continue
        }
        if (base.state === 'absent') {
          const abs = currentMap.get(relPath)
          if (!abs) continue
          const stats = await this.computeNewFileStats(abs)
          entries.push({
            id: `session:${relPath}`,
            path: relPath,
            status: 'added',
            scope: 'session',
            added: stats.added,
            removed: stats.isBinary ? null : 0,
            isBinary: stats.isBinary,
            touchedByChat: base.touchedByChat
          })
          continue
        }

        const abs = currentMap.get(relPath)
        if (!abs) {
          // Verify on disk in case it was outside scan limit
          let stillExists = false
          try {
            const candidate = await resolveInsideRoot(folderPath, relPath)
            const st = await fs.stat(candidate)
            stillExists = st.isFile()
          } catch {
            stillExists = false
          }
          if (!stillExists) {
            let removed: number | null = null
            if (!base.isBinary && base.blobHash) {
              const oldBuf = await this.loadBlob(sessionId, base.blobHash)
              if (oldBuf) removed = countBufferLines(oldBuf)
            }
            entries.push({
              id: `session:${relPath}`,
              path: relPath,
              status: 'deleted',
              scope: 'session',
              added: base.isBinary ? null : 0,
              removed,
              isBinary: Boolean(base.isBinary),
              touchedByChat: base.touchedByChat
            })
            continue
          }
        }

        const targetAbs = abs || (await resolveInsideRoot(folderPath, relPath))
        try {
          const st = await fs.stat(targetAbs)
          if (st.size === base.size && st.mtimeMs === base.mtimeMs) continue
          const curBuf = st.size <= MAX_DIFF_BYTES ? await fs.readFile(targetAbs) : null
          if (!curBuf) {
            entries.push({
              id: `session:${relPath}`,
              path: relPath,
              status: 'modified',
              scope: 'session',
              added: null,
              removed: null,
              isBinary: Boolean(base.isBinary),
              touchedByChat: base.touchedByChat
            })
            continue
          }
          const curHash = sha256(curBuf)
          if (curHash === base.blobHash) continue
          const curBinary = isBinaryBuffer(curBuf)
          if (curBinary || base.isBinary || !base.blobHash) {
            entries.push({
              id: `session:${relPath}`,
              path: relPath,
              status: 'modified',
              scope: 'session',
              added: null,
              removed: null,
              isBinary: curBinary || Boolean(base.isBinary),
              touchedByChat: base.touchedByChat
            })
            continue
          }
          const oldBuf = await this.loadBlob(sessionId, base.blobHash)
          if (!oldBuf) {
            entries.push({
              id: `session:${relPath}`,
              path: relPath,
              status: 'modified',
              scope: 'session',
              added: null,
              removed: null,
              isBinary: false,
              touchedByChat: base.touchedByChat
            })
            continue
          }
          const { added, removed } = structuredDiffToHunks(
            relPath,
            oldBuf.toString('utf8'),
            curBuf.toString('utf8')
          )
          if (added === 0 && removed === 0) continue
          entries.push({
            id: `session:${relPath}`,
            path: relPath,
            status: 'modified',
            scope: 'session',
            added,
            removed,
            isBinary: false,
            touchedByChat: base.touchedByChat
          })
        } catch {
          // ignore transient read error
        }
      }

      // 2. Check new files created on disk (e.g. from terminal or external editor)
      for (const [relPath, abs] of currentMap) {
        if (manifest.entries[relPath]) continue
        const stats = await this.computeNewFileStats(abs)
        entries.push({
          id: `session:${relPath}`,
          path: relPath,
          status: 'added',
          scope: 'session',
          added: stats.added,
          removed: stats.isBinary ? null : 0,
          isBinary: stats.isBinary
        })
      }

      entries.sort((a, b) => {
        if (Boolean(a.touchedByChat) !== Boolean(b.touchedByChat)) {
          return a.touchedByChat ? -1 : 1
        }
        return a.path.localeCompare(b.path)
      })
      let totalAdded = 0
      let totalRemoved = 0
      for (const entry of entries) {
        if (typeof entry.added === 'number') totalAdded += entry.added
        if (typeof entry.removed === 'number') totalRemoved += entry.removed
      }

      return {
        mode: 'session',
        folderPath,
        gitInstalled,
        hasGitFolder,
        truncated: manifest.initialScanTruncated || truncated,
        ...(hiddenNoiseCount > 0 ? { hiddenNoiseCount } : {}),
        entries,
        totals: {
          files: entries.length,
          added: totalAdded,
          removed: totalRemoved
        }
      }
    })
  }

  private async computeNewFileStats(absPath: string): Promise<{ added: number | null; isBinary: boolean }> {
    try {
      const stat = await fs.stat(absPath)
      if (!stat.isFile()) return { added: 0, isBinary: false }
      if (stat.size > 512_000) {
        return { added: null, isBinary: false }
      }
      const buf = await fs.readFile(absPath)
      if (isBinaryBuffer(buf)) return { added: null, isBinary: true }
      return { added: countBufferLines(buf), isBinary: false }
    } catch {
      return { added: null, isBinary: false }
    }
  }

  async getFileDiff(
    sessionId: string,
    folderPath: string,
    filePath: string,
    status: ChangeStatus
  ): Promise<WorkspaceFileDiff> {
    const cleanPath = normalizePosix(filePath)
    return this.enqueue(sessionId, async () => {
      const manifest = await this.readManifest(sessionId, folderPath)
      const base = manifest.entries[cleanPath]

      let oldBuf: Buffer | null = null
      if (base?.state === 'existing') {
        if (base.isBinary) {
          return { path: cleanPath, scope: 'session', status, kind: 'binary', hunks: [] }
        }
        if (!base.blobHash) {
          return {
            path: cleanPath,
            scope: 'session',
            status,
            kind: 'too-large',
            hunks: [],
            warning: 'Исходная версия файла превысила лимит кэша снимков.'
          }
        }
        oldBuf = await this.loadBlob(sessionId, base.blobHash)
      }

      let curBuf: Buffer | null = null
      try {
        const abs = await resolveInsideRoot(folderPath, cleanPath)
        const stat = await fs.stat(abs)
        if (stat.isFile()) {
          if (stat.size > MAX_DIFF_BYTES) {
            return { path: cleanPath, scope: 'session', status, kind: 'too-large', hunks: [] }
          }
          curBuf = await fs.readFile(abs)
        }
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
          throw err
        }
      }

      if (curBuf && isBinaryBuffer(curBuf)) {
        return { path: cleanPath, scope: 'session', status, kind: 'binary', hunks: [] }
      }

      const oldText = (oldBuf ? oldBuf.toString('utf8') : '').replace(/\r\n/g, '\n')
      const newText = (curBuf ? curBuf.toString('utf8') : '').replace(/\r\n/g, '\n')
      if (oldText.split('\n').length > MAX_DIFF_LINES || newText.split('\n').length > MAX_DIFF_LINES) {
        return { path: cleanPath, scope: 'session', status, kind: 'too-large', hunks: [] }
      }

      const { hunks } = structuredDiffToHunks(cleanPath, oldText, newText)
      return {
        path: cleanPath,
        scope: 'session',
        status,
        kind: hunks.length ? 'text' : 'empty',
        hunks,
        oldText,
        newText
      }
    })
  }

  async discardFile(
    sessionId: string,
    folderPath: string,
    filePath: string,
    trashOrRemove: TrashOrRemoveFn
  ): Promise<void> {
    const cleanPath = normalizePosix(filePath)
    await this.enqueue(sessionId, async () => {
      const manifest = await this.readManifest(sessionId, folderPath)
      const base = manifest.entries[cleanPath]
      const abs = await resolveInsideRoot(folderPath, cleanPath)

      if (!base || base.state === 'absent') {
        await trashOrRemove(abs)
        return
      }
      if (!base.blobHash) {
        throw new Error('Исходная копия файла не была сохранена (файл превышал лимит снимка).')
      }
      const oldBuf = await this.loadBlob(sessionId, base.blobHash)
      if (!oldBuf) {
        throw new Error('Не удалось загрузить исходную копию файла из снимка сессии.')
      }
      await writeFileAtomic(abs, oldBuf, base.mode)
    })
  }

  async revertHunk(
    sessionId: string,
    folderPath: string,
    filePath: string,
    hunkIndex: number
  ): Promise<void> {
    const cleanPath = normalizePosix(filePath)
    await this.enqueue(sessionId, async () => {
      const manifest = await this.readManifest(sessionId, folderPath)
      const base = manifest.entries[cleanPath]
      if (!base || base.state !== 'existing' || !base.blobHash) {
        throw new Error('Построчный откат недоступен для этого файла; используйте откат файла целиком.')
      }
      const oldBuf = await this.loadBlob(sessionId, base.blobHash)
      if (!oldBuf) {
        throw new Error('Не удалось загрузить исходную копию файла.')
      }
      const abs = await resolveInsideRoot(folderPath, cleanPath)
      const curRaw = await fs.readFile(abs, 'utf8')
      const hadCrlf = curRaw.includes('\r\n')
      const oldText = oldBuf.toString('utf8').replace(/\r\n/g, '\n')
      const curText = curRaw.replace(/\r\n/g, '\n')
      const { hunks } = structuredDiffToHunks(cleanPath, oldText, curText)
      const hunk = hunks[hunkIndex]
      if (!hunk) {
        throw new Error('Выбранный блок изменений больше не актуален — список обновлён.')
      }
      const reversePatch = buildSingleHunkPatch(cleanPath, hunk, true)
      const patched = Diff.applyPatch(curText, reversePatch)
      if (patched === false) {
        throw new Error('Не удалось откатить блок — файл изменился. Список обновлён.')
      }
      const finalText = hadCrlf ? patched.replace(/\n/g, '\r\n') : patched
      await writeFileAtomic(abs, finalText, base.mode)
    })
  }

  async deleteSession(sessionId: string): Promise<void> {
    await this.enqueue(sessionId, async () => {
      await fs.rm(this.sessionDir(sessionId), { recursive: true, force: true }).catch(() => {})
    })
  }
}
