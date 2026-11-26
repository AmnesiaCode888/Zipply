import { execFile } from 'child_process'
import { randomUUID } from 'crypto'
import * as fs from 'fs/promises'
import * as os from 'os'
import * as path from 'path'
import { promisify } from 'util'

const execFileAsync = promisify(execFile)

export interface WorktreeHandle {
  repoRoot: string
  worktreePath: string
  workspacePath: string
  baseTree: string
  dependencyPaths: string[]
  linkedDependencyPaths: string[]
  cleanup: () => Promise<void>
}

export interface WorktreeSummary {
  statusText: string
  diffText: string
  changedFiles: string[]
  patchPath?: string
  retainedPath?: string
}

const worktreeRoot = path.join(os.tmpdir(), 'zipply-worktrees')
const artifactRoot = path.join(os.tmpdir(), 'zipply-worktree-artifacts')

function isWithin(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate)
  return relative === '' || (!path.isAbsolute(relative) && relative !== '..' && !relative.startsWith(`..${path.sep}`))
}

async function snapshotTree(cwd: string, baseTree: string): Promise<string> {
  const index = path.join(os.tmpdir(), `zipply-index-${randomUUID()}`)
  const options = { cwd, windowsHide: true, timeout: 20000, env: { ...process.env, GIT_INDEX_FILE: index } }
  try {
    await execFileAsync('git', ['read-tree', baseTree], options)
    await execFileAsync('git', ['add', '-A', '--', '.'], options)
    const { stdout } = await execFileAsync('git', ['write-tree'], options)
    return stdout.trim()
  } finally {
    await fs.rm(index, { force: true }).catch(() => {})
  }
}

async function findWorkspaceDependencyPaths(repoRoot: string, cwd: string): Promise<string[]> {
  const root = path.resolve(repoRoot)
  let current = path.resolve(cwd)
  const dependencies: string[] = []
  while (isWithin(root, current)) {
    const source = path.join(current, 'node_modules')
    try {
      if ((await fs.stat(source)).isDirectory()) dependencies.push(source)
    } catch {
      // A directory without local dependencies can still use its parent package root.
    }
    if (path.relative(root, current) === '') break
    current = path.dirname(current)
  }
  return dependencies
}

async function linkWorkspaceDependencies(
  repoRoot: string,
  worktreePath: string,
  dependencyPaths: string[]
): Promise<string[]> {
  const root = path.resolve(repoRoot)
  const links: string[] = []
  for (const source of dependencyPaths) {
    const relative = path.relative(root, source)
    const insideRoot = !path.isAbsolute(relative) && relative !== '..' && !relative.startsWith(`..${path.sep}`)
    const link = insideRoot
      ? path.join(worktreePath, relative)
      : path.join(worktreePath, 'node_modules')
    try {
      await fs.lstat(link)
      continue
    } catch {}
    try {
      await fs.symlink(await fs.realpath(source), link, process.platform === 'win32' ? 'junction' : 'dir')
      links.push(link)
    } catch {
      // The child still receives NODE_PATH and PATH fallbacks when links are unavailable.
    }
  }
  return links
}

export class WorktreeManager {
  static async resolveRepoRoot(cwd: string): Promise<string | null> {
    try {
      const { stdout } = await execFileAsync('git', ['rev-parse', '--show-toplevel'], {
        cwd: path.resolve(cwd),
        windowsHide: true,
        timeout: 10000
      })
      const root = stdout.trim()
      return root ? path.resolve(root) : null
    } catch {
      return null
    }
  }

  static async create(cwd: string, label = 'agent', inheritedDependencyPaths: string[] = []): Promise<WorktreeHandle> {
    const repoRoot = await this.resolveRepoRoot(cwd)
    if (!repoRoot) {
      throw new Error('Рабочая папка не является git-репозиторием; git worktree недоступен.')
    }
    await fs.mkdir(worktreeRoot, { recursive: true })
    const safeLabel = label.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 24) || 'wt'
    const worktreePath = path.join(worktreeRoot, `${safeLabel}-${randomUUID().slice(0, 8)}`)
    const relativeWorkspace = path.relative(await fs.realpath(repoRoot), await fs.realpath(cwd))
    if (path.isAbsolute(relativeWorkspace) || relativeWorkspace === '..' || relativeWorkspace.startsWith(`..${path.sep}`)) {
      throw new Error('Рабочая папка находится вне Git-репозитория.')
    }
    const workspacePath = path.join(worktreePath, relativeWorkspace)
    const { stdout: ref } = await execFileAsync('git', ['rev-parse', 'HEAD'], { cwd: repoRoot, windowsHide: true, timeout: 10000 })
    const head = ref.trim()
    const baseTree = await snapshotTree(repoRoot, head)
    const dependencyPaths = [...new Set([
      ...await findWorkspaceDependencyPaths(repoRoot, cwd),
      ...inheritedDependencyPaths.filter(value => path.isAbsolute(value)).map(value => path.resolve(value))
    ])]

    let linkedDependencyPaths: string[] = []
    await execFileAsync('git', ['worktree', 'add', '--detach', worktreePath, head], {
      cwd: repoRoot,
      windowsHide: true,
      timeout: 20000
    })
    try {
      await execFileAsync('git', ['read-tree', '--reset', '-u', baseTree], {
        cwd: worktreePath, windowsHide: true, timeout: 20000
      })
      await fs.mkdir(workspacePath, { recursive: true })
      linkedDependencyPaths = await linkWorkspaceDependencies(repoRoot, worktreePath, dependencyPaths)
    } catch (error) {
      for (const link of linkedDependencyPaths) await fs.rm(link, { recursive: true, force: true }).catch(() => {})
      await this.remove(repoRoot, worktreePath)
      throw error
    }

    return {
      repoRoot,
      worktreePath,
      workspacePath,
      baseTree,
      dependencyPaths,
      linkedDependencyPaths,
      cleanup: async () => {
        for (const link of linkedDependencyPaths) {
          await fs.rm(link, { recursive: true, force: true }).catch(() => {})
        }
        await this.remove(repoRoot, worktreePath)
      }
    }
  }

  static async summarize(worktreePath: string, baseTree = 'HEAD'): Promise<WorktreeSummary> {
    const resultTree = await snapshotTree(worktreePath, baseTree)
    const options = { cwd: worktreePath, windowsHide: true, timeout: 15000, maxBuffer: 32 * 1024 * 1024 }
    const diffArgs = ['diff', '--no-ext-diff', '--no-textconv', '--no-renames']
    const [{ stdout: rawStatus }, { stdout: ignored }] = await Promise.all([
      execFileAsync('git', [...diffArgs, '--name-status', '-z', baseTree, resultTree, '--'], options),
      execFileAsync('git', ['ls-files', '--others', '--ignored', '--exclude-standard', '--directory', '-z'], options)
    ])
    const ignoredPaths = ignored.split('\0').filter(Boolean).filter(file => !file.split(/[\\/]/).includes('node_modules'))
    const retention = ignoredPaths.length ? { retainedPath: worktreePath } : {}
    const status = rawStatus.split('\0').slice(0, -1)
    const changedFiles = status.filter((_, index) => index % 2 === 1)
    const statusText = changedFiles.map((file, index) => `${status[index * 2]} ${file}`).join('\n')
    if (changedFiles.length === 0) return { statusText, diffText: '', changedFiles, ...retention }
    const { stdout: patch } = await execFileAsync('git', [...diffArgs, '--binary', '--full-index', baseTree, resultTree, '--'], options)
    await fs.mkdir(artifactRoot, { recursive: true })
    const patchPath = path.join(artifactRoot, `worker-${randomUUID()}.patch`)
    await fs.writeFile(patchPath, patch, { flag: 'wx' })
    return { statusText, diffText: patch.slice(0, 12000), changedFiles, patchPath, ...retention }
  }

  static async remove(repoRoot: string, worktreePath: string): Promise<void> {
    if (path.dirname(path.resolve(worktreePath)) !== path.resolve(worktreeRoot)) return
    await execFileAsync('git', ['worktree', 'remove', '--force', worktreePath], {
      cwd: repoRoot,
      windowsHide: true,
      timeout: 15000
    }).catch(() => {})
    await fs.rm(worktreePath, { recursive: true, force: true }).catch(() => {})
    await execFileAsync('git', ['worktree', 'prune'], {
      cwd: repoRoot,
      windowsHide: true,
      timeout: 10000
    }).catch(() => {})
  }
}
