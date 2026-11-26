import * as fs from 'fs/promises'
import * as path from 'path'
import { Blackboard } from './Blackboard'
import type { ChatConfig } from '../services/ChatService'
import { inspectWorkspacePath } from '../tools/pathUtils'

export const MAX_PROJECT_RULES_BYTES = 32 * 1024 // 32 KiB (OpenAI Codex standard)

const RULE_FILENAMES = ['AGENTS.override.md', 'AGENTS.md'] as const
const TRUNCATION_NOTICE = '\n[...усечено по лимиту 32 KiB; прочитайте файл полностью при необходимости...]'

export interface ProjectRulesSession {
  workspaceRoot: string
  workspaceCanonical: string
  loadedDirs: Set<string>
  usedBytes: number
  remainingBytes: number
  initialPrompt: string
}

function sliceUtf8ByBytes(text: string, maxBytes: number): string {
  if (maxBytes <= 0) return ''
  const buf = Buffer.from(text, 'utf8')
  if (buf.length <= maxBytes) return text
  let end = maxBytes
  // Avoid cutting in the middle of a multi-byte UTF-8 character
  while (end > 0 && (buf[end] & 0b1100_0000) === 0b1000_0000) {
    end--
  }
  return buf.subarray(0, end).toString('utf8')
}

async function findGitRoot(startDir: string): Promise<string | null> {
  let current = path.resolve(startDir)
  while (true) {
    try {
      await fs.stat(path.join(current, '.git'))
      return current
    } catch {
      const parent = path.dirname(current)
      if (parent === current) return null
      current = parent
    }
  }
}

function directoryChain(fromDir: string, toDir: string): string[] {
  const from = path.resolve(fromDir)
  const to = path.resolve(toDir)
  const rel = path.relative(from, to)
  if (rel.startsWith('..') || path.isAbsolute(rel)) return [to]
  const dirs = [from]
  if (!rel || rel === '.') return dirs
  let current = from
  for (const part of rel.split(path.sep).filter(Boolean)) {
    current = path.join(current, part)
    dirs.push(current)
  }
  return dirs
}

async function readDirRuleFile(
  dir: string,
  workspaceRoot: string,
  blackboard: Blackboard,
  config: ChatConfig,
  isAncestorAboveWorkspace: boolean
): Promise<{ fileName: string; displayPath: string; content: string } | null> {
  for (const fileName of RULE_FILENAMES) {
    const candidate = path.join(dir, fileName)
    let inspected: { actualPath: string; external: boolean }
    try {
      inspected = await inspectWorkspacePath(blackboard, candidate)
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code
      if (code === 'ENOENT' || code === 'ENOTDIR') continue
      throw err
    }

    let stat
    try {
      stat = await fs.stat(inspected.actualPath)
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code
      if (code === 'ENOENT' || code === 'ENOTDIR') continue
      throw err
    }
    if (!stat.isFile()) continue

    if (inspected.external) {
      const confirm = config.confirmAction as ((action: {
        kind: 'file'
        command: string
        target: string
        cwd: string
        details: string
      }) => Promise<boolean>) | undefined
      const approved = confirm
        ? await confirm({
            kind: 'file',
            command: '',
            target: inspected.actualPath,
            cwd: workspaceRoot,
            details: `Чтение правил проекта ${fileName}`
          })
        : false
      if (!approved) {
        if (isAncestorAboveWorkspace) return null
        throw new Error(`Доступ к внешнему файлу ${fileName} отклонён.`)
      }
    }

    const content = await fs.readFile(inspected.actualPath, 'utf8')
    const rel = path.relative(workspaceRoot, candidate).replace(/\\/g, '/')
    const displayPath = rel && rel !== '' ? rel : fileName
    return { fileName, displayPath, content }
  }
  return null
}

function appendSectionWithinBudget(
  sections: string[],
  header: string,
  content: string,
  remainingBytes: number
): { addedBytes: number; exhausted: boolean } {
  const trimmed = content.trim()
  if (!trimmed || remainingBytes <= 0) {
    return { addedBytes: 0, exhausted: remainingBytes <= 0 }
  }

  const fullSection = `${header}\n${trimmed}`
  const fullBytes = Buffer.byteLength(fullSection, 'utf8')
  if (fullBytes <= remainingBytes) {
    sections.push(fullSection)
    return { addedBytes: fullBytes, exhausted: false }
  }

  const overhead = Buffer.byteLength(`${header}\n${TRUNCATION_NOTICE}`, 'utf8')
  if (remainingBytes <= overhead + 16) {
    return { addedBytes: 0, exhausted: true }
  }
  const clipped = sliceUtf8ByBytes(trimmed, remainingBytes - overhead).trimEnd()
  const truncatedSection = `${header}\n${clipped}${TRUNCATION_NOTICE}`
  sections.push(truncatedSection)
  return { addedBytes: Buffer.byteLength(truncatedSection, 'utf8'), exhausted: true }
}

export class ProjectRulesLoader {
  /**
   * Load hierarchical AGENTS.md / AGENTS.override.md from git root (if any) down to workspacePath,
   * bounded to MAX_PROJECT_RULES_BYTES (32 KiB).
   */
  static async loadInitial(
    workspacePath: string | undefined,
    blackboard: Blackboard,
    config: ChatConfig = {}
  ): Promise<ProjectRulesSession> {
    const trimmedRoot = workspacePath?.trim()
    if (!trimmedRoot) {
      return {
        workspaceRoot: '',
        workspaceCanonical: '',
        loadedDirs: new Set(),
        usedBytes: 0,
        remainingBytes: MAX_PROJECT_RULES_BYTES,
        initialPrompt: ''
      }
    }

    const resolvedRoot = path.resolve(trimmedRoot)
    const workspaceCanonical = await fs.realpath(resolvedRoot).catch(() => resolvedRoot)
    const inspectionBoard = (blackboard.getArtifact('config') as ChatConfig | undefined)?.workspacePath
      ? blackboard
      : (() => {
          const b = new Blackboard(blackboard)
          b.setArtifact('config', { ...config, workspacePath: resolvedRoot }, false)
          return b
        })()
    const gitRoot = await findGitRoot(resolvedRoot)
    const chain = gitRoot ? directoryChain(gitRoot, resolvedRoot) : [resolvedRoot]

    const loadedDirs = new Set<string>()
    const sections: string[] = []
    let usedBytes = 0
    let remainingBytes = MAX_PROJECT_RULES_BYTES

    for (const dir of chain) {
      const canonicalDir = await fs.realpath(dir).catch(() => path.resolve(dir))
      loadedDirs.add(canonicalDir)

      if (remainingBytes <= 0) continue

      const relToWorkspace = path.relative(workspaceCanonical, canonicalDir)
      const isAncestorAboveWorkspace = relToWorkspace === '..' || relToWorkspace.startsWith(`..${path.sep}`)
      const loaded = await readDirRuleFile(dir, resolvedRoot, inspectionBoard, config, isAncestorAboveWorkspace)
      if (!loaded) continue

      const header = `### ${loaded.fileName} (${loaded.displayPath})`
      const { addedBytes, exhausted } = appendSectionWithinBudget(sections, header, loaded.content, remainingBytes)
      usedBytes += addedBytes
      remainingBytes = Math.max(0, MAX_PROJECT_RULES_BYTES - usedBytes)
      if (exhausted) break
    }

    return {
      workspaceRoot: resolvedRoot,
      workspaceCanonical,
      loadedDirs,
      usedBytes,
      remainingBytes,
      initialPrompt: sections.join('\n\n')
    }
  }

  /**
   * Lazily discover nested AGENTS.md / AGENTS.override.md along paths touched by file tools
   * inside workspaceRoot without mutating the system prompt prefix.
   */
  static async loadForPaths(
    session: ProjectRulesSession,
    blackboard: Blackboard,
    targetPaths: readonly (string | { path: string; isFile?: boolean })[],
    config: ChatConfig = {}
  ): Promise<string> {
    if (!session.workspaceRoot || session.remainingBytes <= 0 || targetPaths.length === 0) {
      return ''
    }

    const sections: string[] = []

    for (const entry of targetPaths) {
      const rawTarget = typeof entry === 'string' ? entry : entry?.path
      const knownFile = typeof entry === 'object' && entry !== null ? entry.isFile === true : false
      if (!rawTarget || typeof rawTarget !== 'string' || session.remainingBytes <= 0) continue
      let inspected: { actualPath: string; external: boolean }
      try {
        inspected = await inspectWorkspacePath(blackboard, rawTarget)
      } catch {
        continue
      }
      if (inspected.external) continue

      let targetDir = inspected.actualPath
      const stat = await fs.stat(inspected.actualPath).catch(() => null)
      if (stat ? !stat.isDirectory() : (knownFile || path.extname(inspected.actualPath) !== '')) {
        targetDir = path.dirname(inspected.actualPath)
      }

      const dirs = directoryChain(session.workspaceCanonical, targetDir)
      for (const dir of dirs) {
        const canonicalDir = await fs.realpath(dir).catch(() => path.resolve(dir))
        if (session.loadedDirs.has(canonicalDir)) continue
        session.loadedDirs.add(canonicalDir)

        if (session.remainingBytes <= 0) continue
        const loaded = await readDirRuleFile(dir, session.workspaceRoot, blackboard, config, false).catch(() => null)
        if (!loaded) continue

        const header = `### ${loaded.fileName} (${loaded.displayPath})`
        const { addedBytes, exhausted } = appendSectionWithinBudget(sections, header, loaded.content, session.remainingBytes)
        session.usedBytes += addedBytes
        session.remainingBytes = Math.max(0, MAX_PROJECT_RULES_BYTES - session.usedBytes)
        if (exhausted) break
      }
    }

    return sections.join('\n\n')
  }
}
