import { createHash } from 'node:crypto'
import { constants } from 'node:fs'
import { lstat, open, readdir, realpath } from 'node:fs/promises'
import * as path from 'node:path'
import { isMap, parseDocument } from 'yaml'

const SKILL_FILENAME = 'SKILL.md'
const MAX_SKILL_BYTES = 512 * 1024
const MAX_SUPPORT_FILE_BYTES = 2 * 1024 * 1024
const MAX_SUPPORT_PATH_LENGTH = 1024
const FRONTMATTER_DELIMITER = /^---[ \t]*\r?$/

export type SkillScope = 'user' | 'project' | 'package'

export interface SkillRoot {
  path: string
  scope: SkillScope
  source: string
  /** Optional containment boundary for project-scoped roots. */
  boundaryPath?: string
}

export interface SkillDescriptor {
  id: string
  name: string
  description: string
  scope: SkillScope
  source: string
  bodyPath: string
  revision: string
  disableModelInvocation: boolean
  userInvocable: boolean
  metadata: Record<string, unknown>
  /** Zipply-specific optional links to tools that the skill teaches the model to use. */
  toolRefs: string[]
}

function parseToolRefs(metadata: Record<string, unknown>): string[] {
  const value = metadata.zipply_tools
  if (typeof value !== 'string') return []

  const supported = /^(?:core:[a-zA-Z0-9_-]{1,128}|plugin:[a-zA-Z0-9_-]{1,64}\/[a-zA-Z0-9_-]{1,128}|mcp:[a-zA-Z0-9_-]{1,64}\/[a-zA-Z0-9_-]{1,128})$/
  return [...new Set(value.split(/\s+/).filter(reference => supported.test(reference)))].slice(0, 24)
}

function revisionOf(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex')
}

function skillId(root: SkillRoot, bodyPath: string): string {
  return `skill:${createHash('sha256').update(JSON.stringify([root.scope, root.source, bodyPath])).digest('hex')}`
}

function repositoryError(code: 'INVALID_SKILL_PATH' | 'INVALID_SKILL_METADATA' | 'STALE_SKILL_REVISION', message: string) {
  return Object.assign(new Error(message), { code })
}

function isWithin(boundary: string, target: string): boolean {
  const relative = path.relative(boundary, target)
  return relative === '' || (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative))
}

function parseFrontmatter(bytes: Buffer) {
  const firstLineEnd = bytes.indexOf(10)
  if (firstLineEnd === -1 || !FRONTMATTER_DELIMITER.test(bytes.toString('utf8', 0, firstLineEnd).replace(/^\uFEFF/, ''))) {
    throw repositoryError('INVALID_SKILL_METADATA', 'SKILL.md must begin with YAML frontmatter.')
  }

  const metadataStart = firstLineEnd + 1
  for (let lineStart = metadataStart; lineStart < bytes.length;) {
    const newline = bytes.indexOf(10, lineStart)
    const lineEnd = newline === -1 ? bytes.length : newline
    if (bytes[lineStart] === 45 && FRONTMATTER_DELIMITER.test(bytes.toString('utf8', lineStart, lineEnd))) {
      const document = parseDocument(bytes.toString('utf8', metadataStart, lineStart))
      if (document.errors.length || document.warnings.length || !isMap(document.contents)) {
        throw repositoryError('INVALID_SKILL_METADATA', 'SKILL.md frontmatter must be a valid YAML mapping.')
      }

      const fields = document.toJS({ maxAliasCount: 0 }) as Record<string, unknown>
      const { name, description, 'disable-model-invocation': disableModelInvocation = false,
        'user-invocable': userInvocable = true, ...metadata } = fields
      if (typeof name !== 'string' || !name.trim() || name.trim().length > 120 || typeof description !== 'string' || !description.trim() || description.trim().length > 2000 ||
          /[\u0000-\u001f\u007f]/.test(name) || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(description) ||
          typeof disableModelInvocation !== 'boolean' || typeof userInvocable !== 'boolean') {
        throw repositoryError('INVALID_SKILL_METADATA', 'SKILL.md requires a name (up to 120 characters), description (up to 2000 characters) and valid invocation flags.')
      }
      return {
        name: name.trim(),
        description: description.trim(),
        disableModelInvocation,
        userInvocable,
        metadata,
        bodyStart: newline === -1 ? bytes.length : newline + 1
      }
    }
    lineStart = lineEnd + 1
  }

  throw repositoryError('INVALID_SKILL_METADATA', 'SKILL.md frontmatter is missing its closing delimiter.')
}

async function readSkillFile(rootPath: string, folder: string) {
  const directory = path.join(rootPath, folder)
  const file = path.join(directory, SKILL_FILENAME)
  const invalidPath = () => repositoryError('INVALID_SKILL_PATH', 'Skill path must resolve to a regular SKILL.md inside its root.')

  if (!(await lstat(directory)).isDirectory()) throw invalidPath()
  const before = await lstat(file)
  if (!before.isFile()) throw invalidPath()
  const bodyPath = await realpath(file)
  if (path.basename(bodyPath) !== SKILL_FILENAME || path.relative(file, bodyPath) !== '') throw invalidPath()

  const handle = await open(bodyPath, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0))
  try {
    const opened = await handle.stat()
    if (!opened.isFile() || opened.size > MAX_SKILL_BYTES || opened.dev !== before.dev || opened.ino !== before.ino ||
        await realpath(file) !== bodyPath) {
      throw invalidPath()
    }
    return { bodyPath, bytes: await handle.readFile() }
  } finally {
    await handle.close()
  }
}

function validateSupportPath(relativePath: string): string[] {
  if (typeof relativePath !== 'string' || !relativePath || relativePath.length > MAX_SUPPORT_PATH_LENGTH ||
      relativePath.includes('\\') || relativePath.startsWith('/') || /^[a-zA-Z]:/.test(relativePath)) {
    throw repositoryError('INVALID_SKILL_PATH', 'Supporting file path must be relative to the skill directory.')
  }
  const segments = relativePath.split('/')
  if (segments.some(segment => !segment || segment === '.' || segment === '..' || /[:*?"<>|]/.test(segment) ||
      /[. ]$/.test(segment) || segment.length > 255 || /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/i.test(segment))) {
    throw repositoryError('INVALID_SKILL_PATH', 'Supporting file path contains an unsafe segment.')
  }
  if (segments.length === 1 && segments[0] === SKILL_FILENAME) {
    throw repositoryError('INVALID_SKILL_PATH', 'Use loadBody to read SKILL.md.')
  }
  return segments
}

async function readSupportFile(skillDirectory: string, relativePath: string): Promise<Buffer> {
  const segments = validateSupportPath(relativePath)
  const canonicalSkillDirectory = await realpath(skillDirectory)
  let parentPath = canonicalSkillDirectory
  for (const segment of segments.slice(0, -1)) {
    parentPath = path.join(parentPath, segment)
    const info = await lstat(parentPath)
    if (!info.isDirectory() || info.isSymbolicLink()) {
      throw repositoryError('INVALID_SKILL_PATH', 'Supporting file path must not pass through a link or non-directory.')
    }
    const canonicalParent = await realpath(parentPath)
    if (!isWithin(canonicalSkillDirectory, canonicalParent)) {
      throw repositoryError('INVALID_SKILL_PATH', 'Supporting file resolves outside the skill directory.')
    }
    parentPath = canonicalParent
  }

  const filePath = path.join(parentPath, segments[segments.length - 1])
  if (!isWithin(canonicalSkillDirectory, filePath)) {
    throw repositoryError('INVALID_SKILL_PATH', 'Supporting file resolves outside the skill directory.')
  }
  const before = await lstat(filePath)
  if (!before.isFile() || before.isSymbolicLink() || before.size > MAX_SUPPORT_FILE_BYTES) {
    throw repositoryError('INVALID_SKILL_PATH', 'Supporting file must be a regular file within the size limit.')
  }
  const canonicalFile = await realpath(filePath)
  if (!isWithin(canonicalSkillDirectory, canonicalFile)) {
    throw repositoryError('INVALID_SKILL_PATH', 'Supporting file resolves outside the skill directory.')
  }
  const handle = await open(canonicalFile, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0))
  try {
    const opened = await handle.stat()
    if (!opened.isFile() || opened.size > MAX_SUPPORT_FILE_BYTES || opened.dev !== before.dev || opened.ino !== before.ino ||
        await realpath(filePath) !== canonicalFile) {
      throw repositoryError('INVALID_SKILL_PATH', 'Supporting file changed while it was being opened.')
    }
    const chunks: Buffer[] = []
    let total = 0
    let position = 0
    const buffer = Buffer.allocUnsafe(64 * 1024)
    while (true) {
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, position)
      if (bytesRead === 0) break
      total += bytesRead
      if (total > MAX_SUPPORT_FILE_BYTES) {
        throw repositoryError('INVALID_SKILL_PATH', 'Supporting file exceeds the size limit.')
      }
      chunks.push(Buffer.from(buffer.subarray(0, bytesRead)))
      position += bytesRead
    }
    const after = await handle.stat()
    if (after.size !== total || after.mtimeMs !== opened.mtimeMs || await realpath(filePath) !== canonicalFile) {
      throw repositoryError('INVALID_SKILL_PATH', 'Supporting file changed while it was being read.')
    }
    return Buffer.concat(chunks, total)
  } finally {
    await handle.close()
  }
}

export class SkillRepository {
  private readonly roots: readonly SkillRoot[]

  constructor(roots: readonly SkillRoot[]) {
    this.roots = roots.map(root => ({ ...root, path: path.resolve(root.path), ...(root.boundaryPath ? { boundaryPath: path.resolve(root.boundaryPath) } : {}) }))
  }

  async discover(): Promise<SkillDescriptor[]> {
    const skills = new Map<string, SkillDescriptor>()
    for (const root of this.roots) {
      try {
        const rootPath = await realpath(root.path)
        if (root.boundaryPath) {
          const boundaryPath = await realpath(root.boundaryPath)
          if (!isWithin(boundaryPath, rootPath)) continue
        }
        const folders = await readdir(rootPath, { withFileTypes: true })
        for (const folder of folders.sort((a, b) => a.name.localeCompare(b.name))) {
          if (!folder.isDirectory()) continue
          try {
            const { bodyPath, bytes } = await readSkillFile(rootPath, folder.name)
            const { name, description, disableModelInvocation, userInvocable, metadata } = parseFrontmatter(bytes)
            const id = skillId(root, bodyPath)
            skills.set(id, {
              id, name, description, disableModelInvocation, userInvocable, metadata, toolRefs: parseToolRefs(metadata), bodyPath,
              scope: root.scope, source: root.source, revision: revisionOf(bytes)
            })
          } catch {
            // A malformed or inaccessible skill does not block its siblings.
          }
        }
      } catch {
        // Optional skill roots may be missing or inaccessible.
      }
    }
    return [...skills.values()]
  }

  async loadBody(descriptor: SkillDescriptor, expectedRevision?: string): Promise<string> {
    for (const root of this.roots) {
      if (root.scope !== descriptor.scope || root.source !== descriptor.source) continue
      const rootPath = await realpath(root.path).catch(() => undefined)
      if (!rootPath || !path.isAbsolute(descriptor.bodyPath)) continue
      if (root.boundaryPath) {
        const boundaryPath = await realpath(root.boundaryPath).catch(() => undefined)
        if (!boundaryPath || !isWithin(boundaryPath, rootPath)) continue
      }

      const relative = path.relative(rootPath, descriptor.bodyPath)
      const [folder, filename, ...remaining] = relative.split(path.sep)
      if (!folder || folder === '..' || path.isAbsolute(relative) || remaining.length ||
          filename !== SKILL_FILENAME || path.join(rootPath, relative) !== descriptor.bodyPath ||
          skillId(root, descriptor.bodyPath) !== descriptor.id) continue

      const { bodyPath, bytes } = await readSkillFile(rootPath, folder)
      if (descriptor.bodyPath !== bodyPath) break
      if (expectedRevision !== undefined && revisionOf(bytes) !== expectedRevision) {
        throw repositoryError('STALE_SKILL_REVISION', 'The skill changed since its metadata was loaded.')
      }
      return bytes.toString('utf8', parseFrontmatter(bytes).bodyStart)
    }
    throw repositoryError('INVALID_SKILL_PATH', 'Skill path is outside its configured root or does not match its identity.')
  }

  /** Lists relative paths of supporting files inside the skill directory (excluding SKILL.md and install metadata). */
  async listSupportFiles(descriptor: SkillDescriptor, maxFiles = 100): Promise<string[]> {
    const body = await this.loadBody(descriptor, descriptor.revision).then(() => true).catch(() => false)
    if (!body) return []
    const skillDir = await realpath(path.dirname(descriptor.bodyPath)).catch(() => undefined)
    if (!skillDir) return []

    const results: string[] = []
    const walk = async (currentDir: string, relPrefix: string): Promise<void> => {
      if (results.length >= maxFiles) return
      const entries = await readdir(currentDir, { withFileTypes: true }).catch(() => [])
      for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
        if (results.length >= maxFiles) break
        if (entry.isSymbolicLink()) continue
        const rel = relPrefix ? `${relPrefix}/${entry.name}` : entry.name
        if (rel === SKILL_FILENAME || rel === '.zipply-install.json') continue
        const full = path.join(currentDir, entry.name)
        const canonical = await realpath(full).catch(() => undefined)
        if (!canonical || !isWithin(skillDir, canonical)) continue
        if (entry.isDirectory()) {
          await walk(canonical, rel)
        } else if (entry.isFile()) {
          results.push(rel)
        }
      }
    }
    await walk(skillDir, '')
    return results
  }

  /** Reads a package resource without following links or allowing paths to escape the skill directory. */
  async loadSupportFile(descriptor: SkillDescriptor, relativePath: string, expectedRevision = descriptor.revision): Promise<Buffer> {
    for (const root of this.roots) {
      if (root.scope !== descriptor.scope || root.source !== descriptor.source) continue
      const rootPath = await realpath(root.path).catch(() => undefined)
      if (!rootPath || !path.isAbsolute(descriptor.bodyPath)) continue
      if (root.boundaryPath) {
        const boundaryPath = await realpath(root.boundaryPath).catch(() => undefined)
        if (!boundaryPath || !isWithin(boundaryPath, rootPath)) continue
      }

      const relative = path.relative(rootPath, descriptor.bodyPath)
      const [folder, filename, ...remaining] = relative.split(path.sep)
      if (!folder || folder === '..' || path.isAbsolute(relative) || remaining.length ||
          filename !== SKILL_FILENAME || path.join(rootPath, relative) !== descriptor.bodyPath ||
          skillId(root, descriptor.bodyPath) !== descriptor.id) continue

      const { bodyPath, bytes } = await readSkillFile(rootPath, folder)
      if (descriptor.bodyPath !== bodyPath) break
      if (revisionOf(bytes) !== expectedRevision) {
        throw repositoryError('STALE_SKILL_REVISION', 'The skill changed since its metadata was loaded.')
      }
      return readSupportFile(path.dirname(bodyPath), relativePath)
    }
    throw repositoryError('INVALID_SKILL_PATH', 'Skill path is outside its configured root or does not match its identity.')
  }
}
