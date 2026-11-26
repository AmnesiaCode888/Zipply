import * as fs from 'fs/promises'
import * as path from 'path'
import type {
  ChangeScope,
  ChangeStatus,
  WorkspaceChangesSummary,
  WorkspaceFileDiff
} from '../../../shared/workspaceChanges'
import { FolderWatcher } from '../FolderWatcher'
import { GitChangesDriver, type TrashOrRemoveFn } from './GitChangesDriver'
import { SessionBaselineDriver } from './SessionBaselineDriver'
import { isNoiseRelativePath } from './noiseFilter'

function shouldIgnoreWatchPath(filename: string | null): boolean {
  if (!filename) return false
  const norm = filename.replace(/\\/g, '/')
  if (norm.startsWith('.git/objects') || norm.startsWith('.git/logs')) return true
  if (norm.startsWith('.git/')) return false
  return isNoiseRelativePath(norm)
}

export class WorkspaceChangesService {
  readonly git = new GitChangesDriver()
  readonly baseline: SessionBaselineDriver
  private readonly trashOrRemove: TrashOrRemoveFn
  private readonly folderWatcher = new FolderWatcher({ shouldIgnore: shouldIgnoreWatchPath })

  constructor(userDataDir: string, trashOrRemove?: TrashOrRemoveFn) {
    this.baseline = new SessionBaselineDriver(userDataDir)
    this.trashOrRemove = trashOrRemove || (async (absPath: string) => {
      await fs.rm(absPath, { force: true })
    })
  }

  private async resolveMode(folderPath: string): Promise<{
    mode: 'git' | 'session'
    gitInstalled: boolean
    hasGitFolder: boolean
    repoRoot: string | null
  }> {
    const [gitInstalled, hasGitFolder] = await Promise.all([
      this.git.isGitInstalled(),
      this.git.hasGitMarker(folderPath)
    ])
    const repoRoot = gitInstalled ? await this.git.resolveRepoRoot(folderPath) : null
    return {
      mode: repoRoot ? 'git' : 'session',
      gitInstalled,
      hasGitFolder,
      repoRoot
    }
  }

  async ensureSessionBaseline(sessionId: string, folderPath: string): Promise<void> {
    if (!sessionId || !folderPath) return
    const { mode } = await this.resolveMode(folderPath)
    if (mode === 'session') {
      await this.baseline.ensureBaselineScan(sessionId, folderPath)
    }
  }

  async capturePreEdit(
    sessionId: string | undefined,
    folderPath: string | undefined,
    absTarget: string,
    source: 'agent' | 'editor'
  ): Promise<void> {
    if (!sessionId || !folderPath) return
    await this.baseline.capturePreEditBaseline(sessionId, folderPath, absTarget, source)
  }

  async getSummary(sessionId: string, folderPath: string, includeNoise = false): Promise<WorkspaceChangesSummary> {
    const resolved = path.resolve(folderPath)
    const { mode, gitInstalled, hasGitFolder, repoRoot } = await this.resolveMode(resolved)
    if (mode === 'git' && repoRoot) {
      const touched = sessionId ? await this.baseline.getTouchedPaths(sessionId, resolved).catch(() => new Set<string>()) : undefined
      return this.git.getSummary(resolved, repoRoot, touched, includeNoise)
    }
    return this.baseline.getSummary(sessionId, resolved, gitInstalled, hasGitFolder, includeNoise)
  }

  async getFileDiff(
    sessionId: string,
    folderPath: string,
    filePath: string,
    scope: ChangeScope,
    status: ChangeStatus
  ): Promise<WorkspaceFileDiff> {
    const resolved = path.resolve(folderPath)
    const { mode, repoRoot } = await this.resolveMode(resolved)
    if (mode === 'git' && repoRoot && scope !== 'session') {
      return this.git.getFileDiff(resolved, repoRoot, filePath, scope, status)
    }
    return this.baseline.getFileDiff(sessionId, resolved, filePath, status)
  }

  async stage(folderPath: string, paths: string[]): Promise<void> {
    const resolved = path.resolve(folderPath)
    await this.git.stage(resolved, paths)
    this.notifyChanged(resolved)
  }

  async unstage(folderPath: string, paths: string[]): Promise<void> {
    const resolved = path.resolve(folderPath)
    await this.git.unstage(resolved, paths)
    this.notifyChanged(resolved)
  }

  async discardFile(
    sessionId: string,
    folderPath: string,
    filePath: string,
    scope: ChangeScope,
    status: ChangeStatus
  ): Promise<void> {
    const resolved = path.resolve(folderPath)
    const { mode } = await this.resolveMode(resolved)
    if (mode === 'git' && scope !== 'session') {
      await this.git.discardFile(resolved, filePath, scope, status, this.trashOrRemove)
    } else {
      await this.baseline.discardFile(sessionId, resolved, filePath, this.trashOrRemove)
    }
    this.notifyChanged(resolved)
  }

  async discardAll(
    sessionId: string,
    folderPath: string,
    onlyChatTouched = false
  ): Promise<{ discarded: number }> {
    const resolved = path.resolve(folderPath)
    const summary = await this.getSummary(sessionId, resolved, false)
    const targets = onlyChatTouched
      ? summary.entries.filter((e) => e.touchedByChat)
      : summary.entries
    const seen = new Set<string>()
    let discarded = 0
    for (const entry of targets) {
      if (seen.has(entry.path)) continue
      seen.add(entry.path)
      await this.discardFile(sessionId, resolved, entry.path, entry.scope, entry.status)
      discarded++
    }
    return { discarded }
  }

  async revertHunk(
    sessionId: string,
    folderPath: string,
    filePath: string,
    scope: ChangeScope,
    hunkIndex: number
  ): Promise<void> {
    const resolved = path.resolve(folderPath)
    const { mode, repoRoot } = await this.resolveMode(resolved)
    if (mode === 'git' && repoRoot && scope !== 'session') {
      await this.git.revertHunk(resolved, repoRoot, filePath, scope, hunkIndex)
    } else {
      await this.baseline.revertHunk(sessionId, resolved, filePath, hunkIndex)
    }
    this.notifyChanged(resolved)
  }

  async commit(folderPath: string, message: string): Promise<{ sha: string }> {
    const resolved = path.resolve(folderPath)
    const result = await this.git.commit(resolved, message)
    this.notifyChanged(resolved)
    return result
  }

  async initRepo(folderPath: string): Promise<void> {
    const resolved = path.resolve(folderPath)
    await this.git.initRepo(resolved)
    this.notifyChanged(resolved)
  }

  async deleteSession(sessionId: string): Promise<void> {
    await this.baseline.deleteSession(sessionId)
  }

  watch(folderPath: string, listener: (folderPath: string) => void): () => void {
    return this.folderWatcher.watch(folderPath, listener)
  }

  notifyChanged(folderPath: string): void {
    this.folderWatcher.notifyChanged(folderPath)
  }

  closeAllWatchers(): void {
    this.folderWatcher.closeAll()
  }
}
