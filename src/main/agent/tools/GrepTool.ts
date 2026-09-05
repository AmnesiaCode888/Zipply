import fs from 'fs/promises'
import path from 'path'
import { ToolBase, ToolParameterDef, ToolResult } from './ToolBase'
import { Blackboard } from '../core/Blackboard'

/**
 * GrepTool — High-speed text and regex search across workspace files.
 */
export class GrepTool extends ToolBase {
  get name(): string {
    return 'grep_search'
  }

  get description(): string {
    return 'High-speed text and regex search inside files across any directory on the computer. Returns matching file paths, line numbers, and line content snippets.'
  }

  get parameters(): Record<string, ToolParameterDef> {
    return {
      description: {
        type: 'string',
        description: 'Краткое действие (2-4 слова, напр. "Поиск в файлах")',
        required: false
      },
      query: {
        type: 'string',
        description: 'Text string or regex pattern to search for inside files',
        required: true
      },
      path: {
        type: 'string',
        description: 'Target directory or file path to search within (defaults to workspace or current directory)',
        required: false
      },
      is_regex: {
        type: 'boolean',
        description: 'If true, treats query as a regular expression (default: false)',
        required: false
      },
      case_sensitive: {
        type: 'boolean',
        description: 'If true, performs case-sensitive search (default: false)',
        required: false
      },
      includes: {
        type: 'string',
        description: 'File extension or glob filter (e.g. "*.ts", "*.py, *.json", "src/*")',
        required: false
      }
    }
  }

  private _getResolvedPath(targetPath?: string, blackboard?: Blackboard): string {
    const workspace = (blackboard?.getArtifact('workspacePath') as string) || process.cwd()
    if (!targetPath || typeof targetPath !== 'string') return workspace
    if (path.isAbsolute(targetPath)) return path.normalize(targetPath)
    return path.normalize(path.join(workspace, targetPath))
  }

  async execute(argumentsJson: string, blackboard: Blackboard, abortSignal?: AbortSignal): Promise<ToolResult> {
    let args: any
    try {
      args = JSON.parse(argumentsJson || '{}')
    } catch {
      return { formattedContent: 'Error: invalid JSON arguments.' }
    }

    const queryStr = args.query
    if (!queryStr || typeof queryStr !== 'string') {
      return { formattedContent: 'Error: query parameter is required.' }
    }

    const searchPath = this._getResolvedPath(args.path, blackboard)
    const isRegex = Boolean(args.is_regex)
    const caseSensitive = Boolean(args.case_sensitive)
    const parseIncludeFilter = (includesArg?: string): ((filePath: string) => boolean) => {
      if (!includesArg || !includesArg.trim()) return () => true
      const rawPatterns = includesArg
        .split(',')
        .map((p) => p.trim())
        .filter(Boolean)

      const extensions = new Set<string>()
      const pathPatterns: string[] = []

      for (const p of rawPatterns) {
        if (/^\*?\.[a-z0-9_-]+$/i.test(p)) {
          const ext = p.startsWith('.') ? p.toLowerCase() : p.slice(p.indexOf('.')).toLowerCase()
          extensions.add(ext)
        } else {
          pathPatterns.push(p.toLowerCase().replace(/\\/g, '/'))
        }
      }

      return (filePath: string) => {
        const ext = path.extname(filePath).toLowerCase()
        if (extensions.size > 0 && extensions.has(ext)) return true
        if (extensions.size > 0 && pathPatterns.length === 0) return false

        const normalized = filePath.replace(/\\/g, '/').toLowerCase()
        const base = path.basename(filePath).toLowerCase()

        return pathPatterns.some((p) => {
          const clean = p.replace(/^\*+/, '').replace(/\*+$/, '')
          return normalized.includes(clean) || base.includes(clean)
        })
      }
    }

    const matchesFilter = parseIncludeFilter(args.includes)

    let regex: RegExp
    try {
      const flags = caseSensitive ? 'g' : 'gi'
      const pattern = isRegex ? queryStr : queryStr.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      regex = new RegExp(pattern, flags)
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      return { formattedContent: `Error: invalid regex pattern (${msg})` }
    }

    const IGNORED = new Set([
      'node_modules',
      '.git',
      'dist',
      'out',
      'build',
      '.next',
      '__pycache__',
      '.venv',
      '.vs',
      '.idea',
      'coverage',
      '.gemini',
      'package-lock.json'
    ])

    const matches: Array<{ file: string; lineNumber: number; content: string }> = []
    const MAX_MATCHES = 100
    let totalFilesScanned = 0

    const isBinaryExt = (filename: string): boolean => {
      const ext = path.extname(filename).toLowerCase()
      return [
        '.png',
        '.jpg',
        '.jpeg',
        '.gif',
        '.ico',
        '.pdf',
        '.zip',
        '.tar',
        '.gz',
        '.exe',
        '.dll',
        '.so',
        '.dylib',
        '.woff',
        '.woff2',
        '.ttf',
        '.mp3',
        '.mp4'
      ].includes(ext)
    }

    const scanFile = async (filePath: string): Promise<void> => {
      if (isBinaryExt(filePath)) return
      if (!matchesFilter(filePath)) return

      let stat
      try {
        stat = await fs.stat(filePath)
      } catch {
        return
      }
      if (stat.size > 5 * 1024 * 1024) return // Skip huge files > 5MB to avoid OOM

      totalFilesScanned++
      try {
        const raw = await fs.readFile(filePath, 'utf8')

        if (queryStr.includes('\n')) {
          regex.lastIndex = 0
          let match: RegExpExecArray | null
          while ((match = regex.exec(raw)) !== null) {
            if (matches.length >= MAX_MATCHES) break
            const matchedIndex = match.index
            const lineNumber = raw.slice(0, matchedIndex).split('\n').length
            const snippet = match[0].split(/\r?\n/)[0].trim().slice(0, 300)
            matches.push({
              file: filePath,
              lineNumber,
              content: snippet
            })
            if (!regex.global) break
            if (match[0].length === 0) {
              regex.lastIndex++
            }
          }
        } else {
          const lines = raw.split(/\r?\n/)
          for (let i = 0; i < lines.length; i++) {
            if (matches.length >= MAX_MATCHES) break
            const line = lines[i]
            regex.lastIndex = 0
            if (regex.test(line)) {
              matches.push({
                file: filePath,
                lineNumber: i + 1,
                content: line.trim().slice(0, 300)
              })
            }
          }
        }
      } catch {
        // Skip unreadable files silently
      }
    }

    const scanDirectory = async (curPath: string, depth = 0): Promise<void> => {
      if (depth > 8 || matches.length >= MAX_MATCHES || abortSignal?.aborted) return

      let stat
      try {
        stat = await fs.stat(curPath)
      } catch {
        return
      }

      if (!stat.isDirectory()) {
        await scanFile(curPath)
        return
      }

      let entries
      try {
        entries = await fs.readdir(curPath, { withFileTypes: true })
      } catch {
        return
      }

      for (const entry of entries) {
        if (matches.length >= MAX_MATCHES || abortSignal?.aborted) break
        if (IGNORED.has(entry.name)) continue

        const fullPath = path.join(curPath, entry.name)
        if (entry.isDirectory()) {
          await scanDirectory(fullPath, depth + 1)
        } else if (entry.isFile()) {
          await scanFile(fullPath)
        }
      }
    }

    await scanDirectory(searchPath)

    if (matches.length === 0) {
      return {
        formattedContent: `No matches found for "${queryStr}" in ${searchPath} (${totalFilesScanned} files scanned).`
      }
    }

    let output = `Found ${matches.length}${matches.length >= MAX_MATCHES ? '+' : ''} matches for "${queryStr}" across ${totalFilesScanned} scanned files:\n`

    let currentFile = ''
    for (const m of matches) {
      const relFile = path.relative(searchPath, m.file).replace(/\\/g, '/') || m.file
      if (currentFile !== m.file) {
        currentFile = m.file
        output += `\n${relFile}:\n`
      }
      output += `  ${m.lineNumber}: ${m.content}\n`
    }

    return {
      formattedContent: output.trim(),
      data: { query: queryStr, totalMatches: matches.length, totalFilesScanned, matches }
    }
  }
}
