import fs from 'fs'
import path from 'path'

export interface SymbolTag {
  name: string
  kind: 'class' | 'interface' | 'function' | 'method' | 'type' | 'const' | 'enum'
  line: number
  signature: string
  file: string
}

export interface FileAstSummary {
  filePath: string
  relPath: string
  mtimeMs: number
  tags: SymbolTag[]
  importedSymbols: Set<string>
}

interface RepoMapCache {
  records: Record<string, { mtimeMs: number; tags: SymbolTag[]; imports: string[] }>
}

/**
 * RepoMapService — SOTA AST-based repository map with Personalized PageRank (Aider pattern).
 * Extracts exported classes, methods, functions, interfaces, and signatures, builds a dependency graph,
 * and generates a compact, high-density codebase skeleton (~1000 tokens) for LLM system prompt context.
 */
export class RepoMapService {
  private static _cache: RepoMapCache = { records: {} }
  private static readonly MAX_FILES_TO_ANALYZE = 200
  private static readonly IGNORED_DIRS = new Set([
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
    'release'
  ])

  private static readonly SUPPORTED_EXTS = new Set([
    '.ts',
    '.tsx',
    '.js',
    '.jsx',
    '.mjs',
    '.py',
    '.cs',
    '.rs',
    '.go',
    '.java',
    '.cpp',
    '.h'
  ])

  /**
   * Extract AST symbols and signatures from a single file based on language patterns.
   */
  static extractSymbols(content: string, filePath: string): { tags: SymbolTag[]; imports: Set<string> } {
    const tags: SymbolTag[] = []
    const imports = new Set<string>()
    const ext = path.extname(filePath).toLowerCase()
    const lines = content.split('\n')

    // 1. TypeScript / JavaScript (.ts, .tsx, .js, .jsx, .mjs)
    if (['.ts', '.tsx', '.js', '.jsx', '.mjs'].includes(ext)) {
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim()
        if (!line || line.startsWith('//') || line.startsWith('/*') || line.startsWith('*')) continue

        // Track imports (for dependency graph)
        const importMatch = line.match(/import\s+(?:\{([^}]+)\}|([a-zA-Z0-9_$]+))\s+from/i)
        if (importMatch) {
          const named = importMatch[1]
          const defaultImport = importMatch[2]
          if (named) {
            named.split(',').forEach((s) => {
              const sym = s.trim().split(/\s+as\s+/)[0].trim()
              if (sym) imports.add(sym)
            })
          }
          if (defaultImport) imports.add(defaultImport.trim())
        }

        // Classes
        const classMatch = line.match(/(?:export\s+)?(?:abstract\s+)?class\s+([a-zA-Z0-9_$]+)(?:\s+extends\s+([a-zA-Z0-9_$]+))?(?:\s+implements\s+([^{]+))?/i)
        if (classMatch) {
          tags.push({
            name: classMatch[1],
            kind: 'class',
            line: i + 1,
            signature: line.replace(/\{.*$/, '').trim(),
            file: filePath
          })
          continue
        }

        // Interfaces
        const ifaceMatch = line.match(/(?:export\s+)?interface\s+([a-zA-Z0-9_$]+)(?:<[^>]+>)?(?:\s+extends\s+([^{]+))?/i)
        if (ifaceMatch) {
          tags.push({
            name: ifaceMatch[1],
            kind: 'interface',
            line: i + 1,
            signature: line.replace(/\{.*$/, '').trim(),
            file: filePath
          })
          continue
        }

        // Type aliases
        const typeMatch = line.match(/(?:export\s+)?type\s+([a-zA-Z0-9_$]+)(?:<[^>]+>)?\s*=/i)
        if (typeMatch) {
          tags.push({
            name: typeMatch[1],
            kind: 'type',
            line: i + 1,
            signature: line.slice(0, 100).trim(),
            file: filePath
          })
          continue
        }

        // Functions
        const funcMatch = line.match(/(?:export\s+)?(?:async\s+)?function\s+([a-zA-Z0-9_$]+)\s*\(([^)]*)\)(?::\s*([^{]+))?/i)
        if (funcMatch) {
          tags.push({
            name: funcMatch[1],
            kind: 'function',
            line: i + 1,
            signature: line.replace(/\{.*$/, '').trim(),
            file: filePath
          })
          continue
        }

        // Arrow functions / exported constants
        const constMatch = line.match(/export\s+const\s+([a-zA-Z0-9_$]+)(?::\s*([^=]+))?\s*=\s*(?:async\s*)?\(([^)]*)\)/i)
        if (constMatch) {
          tags.push({
            name: constMatch[1],
            kind: 'function',
            line: i + 1,
            signature: `export const ${constMatch[1]}(${constMatch[3] || ''})`,
            file: filePath
          })
          continue
        }

        // Class methods / static methods
        const methodMatch = line.match(/(?:(?:public|protected|private|static|async)\s+)+([a-zA-Z0-9_$]+)\s*\(([^)]*)\)(?::\s*([^{]+))?/i)
        if (methodMatch && !['if', 'for', 'while', 'switch', 'catch'].includes(methodMatch[1])) {
          tags.push({
            name: methodMatch[1],
            kind: 'method',
            line: i + 1,
            signature: line.replace(/\{.*$/, '').trim(),
            file: filePath
          })
        }
      }
    } else if (ext === '.py') {
      // 2. Python (.py)
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim()
        if (!line || line.startsWith('#')) continue

        // Imports
        const pyImport = line.match(/(?:from\s+[\w.]+\s+import\s+([\w,\s]+)|import\s+([\w,\s]+))/i)
        if (pyImport) {
          const raw = (pyImport[1] || pyImport[2] || '').split(',')
          raw.forEach((s) => {
            const sym = s.trim().split(/\s+as\s+/)[0].trim()
            if (sym) imports.add(sym)
          })
        }

        // Classes
        const pyClass = line.match(/^class\s+([a-zA-Z0-9_]+)(?:\(([^)]*)\))?:/i)
        if (pyClass) {
          tags.push({
            name: pyClass[1],
            kind: 'class',
            line: i + 1,
            signature: line.replace(/:$/, '').trim(),
            file: filePath
          })
          continue
        }

        // Functions and Methods
        const pyDef = line.match(/^(?:async\s+)?def\s+([a-zA-Z0-9_]+)\s*\(([^)]*)\)(?:\s*->\s*([^:]+))?:/i)
        if (pyDef) {
          const isMethod = lines[i].startsWith('    ') || lines[i].startsWith('\t')
          tags.push({
            name: pyDef[1],
            kind: isMethod ? 'method' : 'function',
            line: i + 1,
            signature: line.replace(/:$/, '').trim(),
            file: filePath
          })
        }
      }
    } else if (ext === '.cs') {
      // 3. C# (.cs)
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim()
        if (!line || line.startsWith('//')) continue

        const csClass = line.match(/(?:public|internal|protected|private)?\s*(?:static|abstract|sealed)?\s*class\s+([a-zA-Z0-9_]+)/i)
        if (csClass) {
          tags.push({
            name: csClass[1],
            kind: 'class',
            line: i + 1,
            signature: line.replace(/\{.*$/, '').trim(),
            file: filePath
          })
          continue
        }

        const csIface = line.match(/(?:public|internal)?\s*interface\s+([a-zA-Z0-9_]+)/i)
        if (csIface) {
          tags.push({
            name: csIface[1],
            kind: 'interface',
            line: i + 1,
            signature: line.replace(/\{.*$/, '').trim(),
            file: filePath
          })
          continue
        }

        const csMethod = line.match(/(?:public|protected|private|internal)\s+(?:static|virtual|override|async)?\s*([a-zA-Z0-9_<>[\],]+)\s+([a-zA-Z0-9_]+)\s*\(([^)]*)\)/i)
        if (csMethod && !['if', 'for', 'while', 'switch'].includes(csMethod[2])) {
          tags.push({
            name: csMethod[2],
            kind: 'method',
            line: i + 1,
            signature: line.replace(/\{.*$/, '').trim(),
            file: filePath
          })
        }
      }
    } else if (ext === '.rs') {
      // 4. Rust (.rs)
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim()
        if (!line || line.startsWith('//')) continue

        const rsStruct = line.match(/(?:pub(?:\([^)]+\))?\s+)?(?:struct|enum)\s+([a-zA-Z0-9_]+)/i)
        if (rsStruct) {
          tags.push({
            name: rsStruct[1],
            kind: 'class',
            line: i + 1,
            signature: line.replace(/\{.*$/, '').trim(),
            file: filePath
          })
          continue
        }

        const rsTrait = line.match(/(?:pub(?:\([^)]+\))?\s+)?trait\s+([a-zA-Z0-9_]+)/i)
        if (rsTrait) {
          tags.push({
            name: rsTrait[1],
            kind: 'interface',
            line: i + 1,
            signature: line.replace(/\{.*$/, '').trim(),
            file: filePath
          })
          continue
        }

        const rsFn = line.match(/(?:pub(?:\([^)]+\))?\s+)?(?:async\s+)?fn\s+([a-zA-Z0-9_]+)\s*(?:<[^>]+>)?\s*\(([^)]*)\)(?:\s*->\s*([^{]+))?/i)
        if (rsFn) {
          tags.push({
            name: rsFn[1],
            kind: 'function',
            line: i + 1,
            signature: line.replace(/\{.*$/, '').trim(),
            file: filePath
          })
        }
      }
    }

    return { tags, imports }
  }

  /**
   * Scan project directory, gather all code files, and build file summaries with mtime caching.
   */
  private static async _scanAndExtract(workspacePath: string): Promise<FileAstSummary[]> {
    const results: FileAstSummary[] = []
    const queue: string[] = [workspacePath]
    let filesCount = 0

    while (queue.length > 0 && filesCount < this.MAX_FILES_TO_ANALYZE) {
      const currentDir = queue.shift()!
      let entries: fs.Dirent[] = []
      try {
        entries = await fs.promises.readdir(currentDir, { withFileTypes: true })
      } catch {
        continue
      }

      for (const entry of entries) {
        if (entry.name.startsWith('.') || this.IGNORED_DIRS.has(entry.name)) continue
        const fullPath = path.join(currentDir, entry.name)

        if (entry.isDirectory()) {
          queue.push(fullPath)
        } else if (entry.isFile()) {
          const ext = path.extname(entry.name).toLowerCase()
          if (!this.SUPPORTED_EXTS.has(ext)) continue

          try {
            const stat = await fs.promises.stat(fullPath)
            if (stat.size > 2 * 1024 * 1024) continue // Skip huge files > 2MB

            const relPath = path.relative(workspacePath, fullPath).replace(/\\/g, '/')
            const cached = this._cache.records[fullPath]

            if (cached && cached.mtimeMs === stat.mtimeMs) {
              results.push({
                filePath: fullPath,
                relPath,
                mtimeMs: stat.mtimeMs,
                tags: cached.tags,
                importedSymbols: new Set(cached.imports)
              })
            } else {
              const content = await fs.promises.readFile(fullPath, 'utf8')
              const { tags, imports } = this.extractSymbols(content, fullPath)

              this._cache.records[fullPath] = {
                mtimeMs: stat.mtimeMs,
                tags,
                imports: Array.from(imports)
              }

              results.push({
                filePath: fullPath,
                relPath,
                mtimeMs: stat.mtimeMs,
                tags,
                importedSymbols: imports
              })
            }
            filesCount++
          } catch {}
        }
      }
    }

    return results
  }

  /**
   * Personalized PageRank computation across repository files based on symbol definitions and references.
   */
  private static _calculatePageRank(
    summaries: FileAstSummary[],
    activeFiles: string[] = []
  ): Map<string, number> {
    const N = summaries.length
    if (N === 0) return new Map()

    const scores = new Map<string, number>()
    const normActive = new Set(activeFiles.map((f) => path.normalize(f).toLowerCase().replace(/\\/g, '/')))

    const isFileActive = (file: FileAstSummary): boolean => {
      const fullNorm = file.filePath.toLowerCase().replace(/\\/g, '/')
      const relNorm = file.relPath.toLowerCase().replace(/\\/g, '/')
      for (const act of normActive) {
        if (fullNorm === act || relNorm === act || fullNorm.endsWith('/' + act) || act.endsWith('/' + relNorm)) {
          return true
        }
      }
      return false
    }

    // Build symbol definition index: symbol_name -> file_paths[]
    const symbolDefMap = new Map<string, string[]>()
    for (const file of summaries) {
      for (const tag of file.tags) {
        if (tag.name.length > 2) {
          const existing = symbolDefMap.get(tag.name) || []
          existing.push(file.filePath)
          symbolDefMap.set(tag.name, existing)
        }
      }
    }

    // Build adjacency matrix (out-edges from file A to file B)
    const adj = new Map<string, Set<string>>()
    for (const file of summaries) {
      const targets = new Set<string>()
      for (const imp of file.importedSymbols) {
        const defFiles = symbolDefMap.get(imp)
        if (defFiles) {
          for (const targetFile of defFiles) {
            if (targetFile !== file.filePath) {
              targets.add(targetFile)
            }
          }
        }
      }
      adj.set(file.filePath, targets)
    }

    // Personalization vector (active files receive strong prior bias)
    const pVector = new Map<string, number>()
    let activeMatches = 0
    for (const file of summaries) {
      if (isFileActive(file)) {
        activeMatches++
      }
    }

    const defaultPrior = 1.0 / N
    for (const file of summaries) {
      if (activeMatches > 0 && isFileActive(file)) {
        pVector.set(file.filePath, 0.6 / activeMatches)
      } else {
        pVector.set(file.filePath, activeMatches > 0 ? 0.4 / (N - activeMatches || 1) : defaultPrior)
      }
      scores.set(file.filePath, defaultPrior)
    }

    // Power iteration PageRank (15 iterations)
    const damping = 0.85
    for (let iter = 0; iter < 15; iter++) {
      const nextScores = new Map<string, number>()

      for (const file of summaries) {
        let rankSum = 0
        for (const other of summaries) {
          const otherOut = adj.get(other.filePath)
          if (otherOut && otherOut.has(file.filePath) && otherOut.size > 0) {
            rankSum += (scores.get(other.filePath) || 0) / otherOut.size
          }
        }
        const newScore = (1 - damping) * (pVector.get(file.filePath) || defaultPrior) + damping * rankSum
        nextScores.set(file.filePath, newScore)
      }

      for (const [k, v] of nextScores) {
        scores.set(k, v)
      }
    }

    return scores
  }

  /**
   * Generates a high-density, AST-ranked repository skeleton map for LLM system prompt context.
   */
  static async getRepoMapAsync(
    workspacePath: string,
    activeFiles: string[] = [],
    maxTokens = 1000
  ): Promise<string> {
    if (!workspacePath || !fs.existsSync(workspacePath)) return ''

    try {
      const summaries = await this._scanAndExtract(workspacePath)
      if (summaries.length === 0) return ''

      const rankMap = this._calculatePageRank(summaries, activeFiles)

      // Sort files by PageRank score descending
      summaries.sort((a, b) => (rankMap.get(b.filePath) || 0) - (rankMap.get(a.filePath) || 0))

      const maxChars = maxTokens * 4
      const lines: string[] = []
      let totalChars = 0
      let renderedFilesCount = 0

      lines.push('### 🗺️ REPOSITORY ARCHITECTURE MAP (AST Skeleton & Signatures):')

      for (const file of summaries) {
        if (file.tags.length === 0) continue

        const fileHeader = `📁 ${file.relPath}:`
        const fileLines: string[] = [fileHeader]

        // Group tags: classes/interfaces first, then functions/methods
        const sortedTags = [...file.tags].sort((a, b) => {
          const aPriority = a.kind === 'class' ? 3 : a.kind === 'interface' || a.kind === 'type' ? 2 : 1
          const bPriority = b.kind === 'class' ? 3 : b.kind === 'interface' || b.kind === 'type' ? 2 : 1
          return bPriority - aPriority
        })

        const importantTags = sortedTags.slice(0, 15)
        for (const tag of importantTags) {
          const icon = tag.kind === 'class' ? 'class' : tag.kind === 'interface' ? 'interface' : tag.kind === 'type' ? 'type' : 'fn'
          fileLines.push(`  • [${icon}] ${tag.signature}`)
        }

        const blockStr = fileLines.join('\n') + '\n'
        if (totalChars + blockStr.length > maxChars) {
          const remaining = Math.max(summaries.length - renderedFilesCount, 0)
          if (remaining > 0) {
            lines.push(`... [Remaining ${remaining} files omitted for token budget]`)
          }
          break
        }

        lines.push(blockStr)
        totalChars += blockStr.length
        renderedFilesCount++
      }

      return lines.join('\n').trim()
    } catch (err) {
      console.warn('[RepoMapService] Failed to build repo map:', err)
      return ''
    }
  }
}
