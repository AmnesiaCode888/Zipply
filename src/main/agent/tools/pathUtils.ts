import * as path from 'path'
import * as fs from 'fs/promises'
import { createHash, randomUUID } from 'crypto'
import { Blackboard } from '../core/Blackboard'
import { ChatConfig } from '../services/ChatService'

export interface ResolvedWorkspacePath {
  absPath: string
  relPath: string
  workspaceRoot: string
}

/**
 * Resolves a given path relative to the active chat's workspacePath in Blackboard.
 */
export function resolveWorkspacePath(blackboard: Blackboard, targetPath: string): ResolvedWorkspacePath {
  const config = blackboard.getArtifact('config') as ChatConfig | undefined
  const workspaceRoot = config?.workspacePath?.trim() || process.cwd()

  const cleanTarget = (targetPath || '').trim()
  if (!cleanTarget) {
    return {
      absPath: workspaceRoot,
      relPath: '.',
      workspaceRoot
    }
  }

  let absPath: string
  if (path.isAbsolute(cleanTarget)) {
    absPath = path.normalize(cleanTarget)
  } else {
    absPath = path.normalize(path.join(workspaceRoot, cleanTarget))
  }

  // Relative path display (using forward slashes for clean agent viewing)
  let relPath = path.relative(workspaceRoot, absPath).replace(/\\/g, '/')
  if (!relPath || relPath === '') {
    relPath = '.'
  }

  return {
    absPath,
    relPath,
    workspaceRoot
  }
}

// Resolve the nearest existing ancestor as well, so new files beneath symlinks
// are classified according to their actual destination.
async function canonicalPath(target: string): Promise<string> {
  let current = path.resolve(target)
  const suffix: string[] = []
  while (true) {
    try { return path.resolve(await fs.realpath(current), ...suffix.reverse()) }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      const parent = path.dirname(current)
      if (parent === current) throw error
      suffix.push(path.basename(current)); current = parent
    }
  }
}

export async function inspectWorkspacePath(blackboard: Blackboard, target: string): Promise<{ actualPath: string; external: boolean }> {
  const resolved = resolveWorkspacePath(blackboard, target)
  const [root, actualPath] = await Promise.all([canonicalPath(resolved.workspaceRoot), canonicalPath(resolved.absPath)])
  const relative = path.relative(root, actualPath)
  return { actualPath, external: relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative) }
}

/**
 * Checks if a file is likely binary by checking for null bytes in initial chunk.
 */
export async function isBinaryFile(filePath: string): Promise<boolean> {
  try {
    const handle = await fs.open(filePath, 'r')
    const buffer = Buffer.alloc(1024)
    const { bytesRead } = await handle.read(buffer, 0, 1024, 0)
    await handle.close()

    for (let i = 0; i < bytesRead; i++) {
      if (buffer[i] === 0) {
        return true
      }
    }
    return false
  } catch {
    return false
  }
}

function fileHashKey(absPath: string): string {
  const resolved = path.resolve(absPath)
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved
}

export function sha256Buffer(data: Buffer | string): string {
  return createHash('sha256').update(data).digest('hex')
}

export async function recordReadFileState(blackboard: Blackboard | undefined, absPath: string, sha256: string): Promise<void> {
  if (!blackboard || typeof blackboard.getArtifact !== 'function' || typeof blackboard.setArtifact !== 'function') return
  const real = await fs.realpath(absPath).catch(() => path.resolve(absPath))
  const map = (blackboard.getArtifact('readFileHashes') as Map<string, string> | undefined) || new Map<string, string>()
  map.set(fileHashKey(real), sha256)
  blackboard.setArtifact('readFileHashes', map)
}

export async function assertFileNotStale(
  blackboard: Blackboard | undefined,
  absPath: string,
  displayPath: string
): Promise<string | null> {
  if (!blackboard || typeof blackboard.getArtifact !== 'function') return null
  const map = blackboard.getArtifact('readFileHashes') as Map<string, string> | undefined
  if (!map || map.size === 0) return null
  const real = await fs.realpath(absPath).catch(() => path.resolve(absPath))
  const expected = map.get(fileHashKey(real))
  if (!expected) return null
  try {
    const bytes = await fs.readFile(real)
    if (sha256Buffer(bytes) !== expected) {
      return `Ошибка: файл '${displayPath}' изменился с момента последнего чтения. Прочитай его заново через read_file перед редактированием.`
    }
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      return `Ошибка: файл '${displayPath}' был удалён с момента последнего чтения. Проверь состояние через read_file.`
    }
  }
  return null
}

export async function writeFileAtomic(absPath: string, data: string | Buffer, mode?: number): Promise<string> {
  let targetPath = absPath
  let fileMode = mode
  try {
    targetPath = await fs.realpath(absPath)
    if (fileMode === undefined) {
      fileMode = (await fs.stat(targetPath)).mode
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    await fs.mkdir(path.dirname(absPath), { recursive: true })
  }
  const temporaryPath = path.join(path.dirname(targetPath), `.${path.basename(targetPath)}.${randomUUID()}.tmp`)
  try {
    const buf = typeof data === 'string' ? Buffer.from(data, 'utf8') : data
    await fs.writeFile(temporaryPath, buf, { flag: 'wx', ...(fileMode !== undefined ? { mode: fileMode } : {}) })
    await fs.rename(temporaryPath, targetPath)
    return sha256Buffer(buf)
  } finally {
    await fs.rm(temporaryPath, { force: true }).catch(() => {})
  }
}
