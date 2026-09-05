import fs from 'fs/promises'
import fsSync from 'fs'
import path from 'path'
import { ToolBase, ToolParameterDef, ToolResult } from './ToolBase'
import { Blackboard } from '../core/Blackboard'

/**
 * FileTool — Perform file operations across the computer.
 * Default working directory is set in Blackboard as workspacePath.
 * Full access to any path (absolute or relative) is supported.
 */
export class FileTool extends ToolBase {
  get name(): string {
    return 'file'
  }

  get description(): string {
    return 'File & directory operations across the computer: read, write, edit, list, glob (find files by name/pattern), read_tree (folder tree), delete, create_dir, delete_dir, move, copy.'
  }

  getExecutionPolicy(args: Record<string, unknown> = {}) {
    const action = String(args.action || 'read').toLowerCase()
    const mutates = ['write', 'append', 'edit', 'delete', 'move', 'copy', 'create_dir', 'delete_dir'].includes(action)
    return { mutates, parallelSafe: !mutates, cacheable: !mutates }
  }

  get parameters(): Record<string, ToolParameterDef> {
    return {
      description: {
        type: 'string',
        description: 'Краткое действие (2-4 слова, напр. "Чтение файла")',
        required: false
      },
      action: {
        type: 'string',
        description:
          'Operation: read (view lines), edit (surgical replace or SEARCH/REPLACE blocks), write (create/overwrite), append, list (flat directory contents), glob (find files by name/pattern), read_tree (directory hierarchy tree), delete, create_dir, delete_dir, move, copy',
        required: true,
        enum: [
          'read',
          'list',
          'glob',
          'read_tree',
          'write',
          'append',
          'delete',
          'edit',
          'create_dir',
          'delete_dir',
          'move',
          'copy'
        ]
      },
      path: {
        type: 'string',
        description: 'Target file or directory path (absolute or relative to workspace)',
        required: false
      },
      content: {
        type: 'string',
        description: '[Required for write, append; or for edit with SEARCH/REPLACE blocks] Text content or blocks',
        required: false
      },
      pattern: {
        type: 'string',
        description: '[For glob] Wildcard pattern or filename keyword (e.g. *.ts, **/*.log, report*.xlsx)',
        required: false
      },
      dest_path: {
        type: 'string',
        description: '[Required for move, copy] Destination path',
        required: false
      },
      old_content: {
        type: 'string',
        description: '[For edit] Exact unique text to replace, or search/replace blocks payload (<<<<<<< SEARCH ... ======= ... >>>>>>>)',
        required: false
      },
      new_content: {
        type: 'string',
        description: '[Required for edit] Replacement text to insert, or search/replace blocks payload',
        required: false
      },
      start_line: {
        type: 'integer',
        description: '[For read & edit] First line number (1-indexed)',
        required: false
      },
      end_line: {
        type: 'integer',
        description: '[For read & edit] Last line number (1-indexed, inclusive)',
        required: false
      },
      overwrite: {
        type: 'boolean',
        description: '[For write] Overwrite if file exists (default: true)',
        required: false
      },
      max_depth: {
        type: 'integer',
        description: '[For read_tree] Directory traversal depth (default: 3, max: 6)',
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

  private _validateSafePath(targetPath: string, blackboard: Blackboard): string | null {
    const config = blackboard?.getArtifact('config') as { allowDangerousOperations?: boolean } | undefined
    if (config?.allowDangerousOperations === true) return null

    const normalized = path.normalize(targetPath).toLowerCase().replace(/\\/g, '/')
    const sensitivePatterns = [
      /[/\\]\.(ssh|gnupg|aws|azure|gcloud)($|[/\\])/i,
      /(^|[/\\])etc[/\\](shadow|passwd|sudoers)($|[/\\])/i,
      /[/\\]windows[/\\](system32|syswow64)[/\\](config|drivers[/\\]etc[/\\]hosts)($|[/\\])/i,
      /[/\\]\.(bashrc|bash_profile|zshrc|profile)($|[/\\])/i
    ]

    for (const pattern of sensitivePatterns) {
      if (pattern.test(normalized)) {
        return `Blocked access to sensitive system path "${targetPath}". To allow this, enable allowDangerousOperations.`
      }
    }
    return null
  }

  async execute(
    argumentsJson: string,
    blackboard: Blackboard,
    abortSignal?: AbortSignal,
    _onProgress?: (progress: Record<string, unknown>) => void
  ): Promise<ToolResult> {
    let args: any
    try {
      args = JSON.parse(argumentsJson || '{}')
    } catch {
      return { formattedContent: 'Error: invalid JSON arguments.' }
    }

    const action = args.action?.toLowerCase()
    if (!action) return { formattedContent: 'Error: action parameter is required.' }

    const targetPath = this._getResolvedPath(args.path, blackboard)
    const targetError = this._validateSafePath(targetPath, blackboard)
    if (targetError) return { formattedContent: targetError }

    if (args.dest_path) {
      const destPath = this._getResolvedPath(args.dest_path, blackboard)
      const destError = this._validateSafePath(destPath, blackboard)
      if (destError) return { formattedContent: destError }
    }

    try {
      switch (action) {
        case 'read':
          return await this._handleRead(targetPath, args)
        case 'write':
          return await this._handleWrite(targetPath, args)
        case 'append':
          return await this._handleAppend(targetPath, args)
        case 'edit':
          return await this._handleEdit(targetPath, args)
        case 'list':
          return await this._handleList(targetPath)
        case 'glob':
          return await this._handleGlob(targetPath, args.pattern || '*', abortSignal)
        case 'read_tree':
          return await this._handleReadTree(targetPath, Math.min(Number(args.max_depth) || 3, 6))
        case 'delete':
          return await this._handleDelete(targetPath)
        case 'create_dir':
          return await this._handleCreateDir(targetPath)
        case 'delete_dir':
          return await this._handleDeleteDir(targetPath)
        case 'move':
          return await this._handleMove(targetPath, this._getResolvedPath(args.dest_path, blackboard))
        case 'copy':
          return await this._handleCopy(targetPath, this._getResolvedPath(args.dest_path, blackboard))
        default:
          return { formattedContent: `Unknown file action: ${action}` }
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      return { formattedContent: `File error [${action}]: ${msg}` }
    }
  }

  private async _handleRead(filePath: string, args: any): Promise<ToolResult> {
    let stat
    try {
      stat = await fs.stat(filePath)
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      return { formattedContent: `File read error: ${msg}` }
    }

    if (stat.isDirectory()) {
      return { formattedContent: `Error: ${filePath} is a directory. Use action=list or action=read_tree instead.` }
    }

    const MAX_FILE_SIZE = 5 * 1024 * 1024 // 5 MB limit
    if (stat.size > MAX_FILE_SIZE) {
      return {
        formattedContent: `Error: file is too large to read into context (${(stat.size / 1024 / 1024).toFixed(2)} MB). Maximum allowed size is 5 MB.`
      }
    }

    const raw = await fs.readFile(filePath, 'utf8')
    const lines = raw.split('\n')

    const startLineArg = Number(args.start_line)
    const endLineArg = Number(args.end_line)

    if (Number.isFinite(startLineArg) && startLineArg > lines.length) {
      return {
        formattedContent: `Error: start_line ${Math.floor(startLineArg)} is beyond total file lines (${lines.length}).`
      }
    }

    let start = Number.isFinite(startLineArg) && startLineArg > 0 ? Math.floor(startLineArg) : 1
    let end = Number.isFinite(endLineArg) && endLineArg > 0 ? Math.floor(endLineArg) : lines.length

    if (start > lines.length) start = lines.length
    if (end > lines.length) end = lines.length
    if (end < start) end = start

    const sliced = lines.slice(start - 1, end)
    let formattedLines = sliced.map((l, i) => `${start + i}: ${l}`).join('\n')

    const MAX_CHAR_LIMIT = 30000
    let effectiveEnd = end
    if (formattedLines.length > MAX_CHAR_LIMIT) {
      let charCount = 0
      let fitLines = 0
      for (let i = 0; i < sliced.length; i++) {
        const lineStr = `${start + i}: ${sliced[i]}\n`
        if (charCount + lineStr.length > MAX_CHAR_LIMIT) break
        charCount += lineStr.length
        fitLines++
      }
      effectiveEnd = start + Math.max(fitLines - 1, 0)
      const truncatedContent = sliced.slice(0, fitLines).map((l, i) => `${start + i}: ${l}`).join('\n')
      const nextStart = effectiveEnd + 1
      const nextEnd = Math.min(nextStart + 300, lines.length)
      formattedLines = `${truncatedContent}\n\n[... Read output truncated at line ${effectiveEnd}/${lines.length}. To continue reading, call: action="read", start_line=${nextStart}, end_line=${nextEnd}]`
    }

    return {
      formattedContent: `Read file: ${filePath} (lines ${start}-${effectiveEnd}/${lines.length})\n[Note: Line numbers are for reference only; do not include line numbers in old_content when using action="edit"]\n\n${formattedLines}`,
      data: { path: filePath, startLine: start, endLine: effectiveEnd, totalLines: lines.length, content: sliced.slice(0, effectiveEnd - start + 1).join('\n') }
    }
  }

  private async _handleWrite(filePath: string, args: any): Promise<ToolResult> {
    const exists = fsSync.existsSync(filePath)
    if (exists && args.overwrite === false) {
      return { formattedContent: `Error: file already exists at ${filePath} and overwrite is explicitly set to false.` }
    }

    const content = typeof args.content === 'string' ? args.content : ''

    // Safety check: protect against accidental truncation / placeholder wipeouts
    if (exists && content) {
      try {
        const existingRaw = await fs.readFile(filePath, 'utf8')
        const existingLines = existingRaw.split('\n').length
        const newLines = content.split('\n').length

        // If existing file is substantial and new content is suspicious placeholder
        if (existingLines >= 40 && newLines < existingLines * 0.4) {
          const placeholderPattern = /(\/\/\s*\.\.\.\s*(existing|rest|remaining|code|same)|{\s*\/\*\s*\.\.\.\s*\*\/|\/\*\s*\.\.\.\s*(existing|rest|remaining|code|same))/i
          if (placeholderPattern.test(content)) {
            return {
              formattedContent: `Error: write content appears to contain truncation placeholder comments (e.g. "// ... existing code ..."). Overwrite cancelled to prevent code loss.\nTip: File has ${existingLines} lines. To modify specific functions, use action="edit" with start_line/end_line or exact old_content, or provide the complete implementation.`
            }
          }
        }
      } catch {
        // Fall through to normal write if read check fails
      }
    }

    await fs.mkdir(path.dirname(filePath), { recursive: true })
    await fs.writeFile(filePath, content, 'utf8')
    const linesCount = content ? content.split('\n').length : 0

    return {
      formattedContent: `Successfully wrote file: ${filePath} (${linesCount} lines)`,
      data: { path: filePath, linesCount, content }
    }
  }

  private async _handleAppend(filePath: string, args: any): Promise<ToolResult> {
    await fs.mkdir(path.dirname(filePath), { recursive: true })
    const appendContent = typeof args.content === 'string' ? args.content : ''
    await fs.appendFile(filePath, appendContent, 'utf8')
    return { formattedContent: `Successfully appended to file: ${filePath}` }
  }

  private _parseSearchReplaceBlocks(input: string): Array<{ search: string; replace: string }> {
    if (!input || typeof input !== 'string' || !input.includes('SEARCH')) return []

    const blocks: Array<{ search: string; replace: string }> = []
    const blockRegex = /<{3,8}\s*SEARCH\s*\r?\n([\s\S]*?)\r?\n={3,8}\s*\r?\n([\s\S]*?)\r?\n>{3,8}(?:\s*|$)/g
    let match: RegExpExecArray | null

    while ((match = blockRegex.exec(input)) !== null) {
      blocks.push({
        search: match[1],
        replace: match[2]
      })
    }

    return blocks
  }

  private _computeStringSimilarity(a: string, b: string): number {
    if (a === b) return 1.0
    if (!a || !b) return 0.0

    const aTrim = a.trim()
    const bTrim = b.trim()
    if (aTrim === bTrim) return 0.98

    // Word/Token overlap Jaccard
    const aWords = aTrim.split(/\s+/)
    const bWords = bTrim.split(/\s+/)
    const aSet = new Set(aWords)
    const bSet = new Set(bWords)
    let common = 0
    for (const w of aSet) {
      if (bSet.has(w)) common++
    }
    const jaccard = common / Math.max(aSet.size + bSet.size - common, 1)

    // Character length ratio check
    const lenRatio = Math.min(a.length, b.length) / Math.max(a.length, b.length, 1)

    return jaccard * 0.7 + lenRatio * 0.3
  }

  private _applySingleBlock(
    sourceText: string,
    searchBlock: string,
    replaceBlock: string
  ): { success: boolean; resultText: string; error?: string; linesAdded: number; linesDeleted: number } {
    let targetSearch = searchBlock.replace(/\r\n/g, '\n')
    let targetReplace = replaceBlock.replace(/\r\n/g, '\n')

    if (!targetSearch) {
      return { success: false, resultText: sourceText, error: 'Search block must not be empty.', linesAdded: 0, linesDeleted: 0 }
    }

    // Step 1: Direct exact match
    let matches = sourceText.split(targetSearch).length - 1
    if (matches === 1) {
      const resultText = sourceText.replace(targetSearch, () => targetReplace)
      return {
        success: true,
        resultText,
        linesAdded: targetReplace ? targetReplace.split('\n').length : 0,
        linesDeleted: targetSearch.split('\n').length
      }
    }

    // Step 2: Line number prefix stripping (e.g. "45: " or " 45 | ")
    const lineNumRegex = /^\s*\d+[:|]\s?/
    const strippedSearchLines = targetSearch.split('\n').map((l) => l.replace(lineNumRegex, ''))
    const strippedSearch = strippedSearchLines.join('\n')

    if (strippedSearch !== targetSearch) {
      matches = sourceText.split(strippedSearch).length - 1
      if (matches === 1) {
        const strippedReplace = targetReplace.split('\n').map((l) => l.replace(lineNumRegex, '')).join('\n')
        const resultText = sourceText.replace(strippedSearch, () => strippedReplace)
        return {
          success: true,
          resultText,
          linesAdded: strippedReplace ? strippedReplace.split('\n').length : 0,
          linesDeleted: strippedSearch.split('\n').length
        }
      }
      if (matches > 1) {
        return {
          success: false,
          resultText: sourceText,
          error: `Search block (after stripping line numbers) is ambiguous (${matches} matches). Please provide more surrounding lines.`,
          linesAdded: 0,
          linesDeleted: 0
        }
      }
      targetSearch = strippedSearch
    }

    // Step 3: Whitespace-tolerant and Indentation-insensitive line-by-line matching
    const rawLines = sourceText.split('\n')
    const searchLines = targetSearch.split('\n')
    const matchedIndices: number[] = []

    for (let i = 0; i <= rawLines.length - searchLines.length; i++) {
      let allMatch = true
      for (let j = 0; j < searchLines.length; j++) {
        if (rawLines[i + j].trim() !== searchLines[j].trim()) {
          allMatch = false
          break
        }
      }
      if (allMatch) {
        matchedIndices.push(i)
      }
    }

    if (matchedIndices.length === 1) {
      const startIdx = matchedIndices[0]
      const linesDel = searchLines.length

      // Preserve file's original leading indentation for replacement lines
      const baseIndentMatch = rawLines[startIdx].match(/^(\s*)/)
      const baseIndent = baseIndentMatch ? baseIndentMatch[1] : ''
      const searchBaseIndentMatch = searchLines[0].match(/^(\s*)/)
      const searchBaseIndent = searchBaseIndentMatch ? searchBaseIndentMatch[1] : ''

      const newLines = targetReplace
        ? targetReplace.split('\n').map((l) => {
            if (searchBaseIndent && l.startsWith(searchBaseIndent)) {
              return baseIndent + l.slice(searchBaseIndent.length)
            }
            return l
          })
        : []

      rawLines.splice(startIdx, linesDel, ...newLines)
      return {
        success: true,
        resultText: rawLines.join('\n'),
        linesAdded: newLines.length,
        linesDeleted: linesDel
      }
    }

    if (matchedIndices.length > 1) {
      const matchRanges = matchedIndices.map((sIdx) => `${sIdx + 1}-${sIdx + searchLines.length}`).join(', ')
      return {
        success: false,
        resultText: sourceText,
        error: `Search block matches ${matchedIndices.length} locations when ignoring whitespace (lines: ${matchRanges}). Please include more surrounding context lines to make it uniquely identifiable.`,
        linesAdded: 0,
        linesDeleted: 0
      }
    }

    // Step 4: Multi-Level Fuzzy Sliding Window Matching (Levenshtein / Similarity >= 0.85)
    if (searchLines.length >= 2) {
      let bestSimilarity = 0
      let bestIdx = -1
      const highSimMatches: { idx: number; sim: number }[] = []

      for (let i = 0; i <= rawLines.length - searchLines.length; i++) {
        const windowSlice = rawLines.slice(i, i + searchLines.length).join('\n')
        const sim = this._computeStringSimilarity(windowSlice, targetSearch)
        if (sim >= 0.85) {
          highSimMatches.push({ idx: i, sim })
        }
        if (sim > bestSimilarity) {
          bestSimilarity = sim
          bestIdx = i
        }
      }

      if (highSimMatches.length > 1) {
        // If there are multiple close matches (within 0.03 difference), report ambiguity
        const topMatches = highSimMatches.filter((m) => bestSimilarity - m.sim < 0.03)
        if (topMatches.length > 1) {
          const ranges = topMatches.map((m) => `${m.idx + 1}-${m.idx + searchLines.length}`).join(', ')
          return {
            success: false,
            resultText: sourceText,
            error: `Fuzzy search found multiple ambiguous close matches (lines: ${ranges}). Please include more surrounding context.`,
            linesAdded: 0,
            linesDeleted: 0
          }
        }
      }

      if (bestSimilarity >= 0.85 && bestIdx !== -1) {
        const linesDel = searchLines.length
        const newLines = targetReplace ? targetReplace.split('\n') : []
        rawLines.splice(bestIdx, linesDel, ...newLines)
        return {
          success: true,
          resultText: rawLines.join('\n'),
          linesAdded: newLines.length,
          linesDeleted: linesDel
        }
      }
    }

    // Check direct occurrence count if not matching
    if (matches > 1) {
      return {
        success: false,
        resultText: sourceText,
        error: `Search block is ambiguous (${matches} exact matches). Please provide more surrounding lines in SEARCH block.`,
        linesAdded: 0,
        linesDeleted: 0
      }
    }

    return {
      success: false,
      resultText: sourceText,
      error: `Search block not found in file. Verify exact text or indentation by calling action="read".`,
      linesAdded: 0,
      linesDeleted: 0
    }
  }

  private async _handleEdit(filePath: string, args: any): Promise<ToolResult> {
    const raw = await fs.readFile(filePath, 'utf8')
    const isCRLF = raw.includes('\r\n')
    let newRaw = raw
    let linesAdded = 0
    let linesDeleted = 0

    // Priority 1: Multi-block SEARCH/REPLACE parsing (Aider SOTA pattern)
    const possibleBlocksPayload = [args.content, args.new_content, args.old_content, args.blocks]
      .filter((v) => typeof v === 'string' && v.includes('SEARCH'))
      .join('\n')

    const parsedBlocks = this._parseSearchReplaceBlocks(possibleBlocksPayload)

    if (parsedBlocks.length > 0) {
      let currentNormalized = raw.replace(/\r\n/g, '\n')
      let totalAdded = 0
      let totalDeleted = 0

      for (let i = 0; i < parsedBlocks.length; i++) {
        const block = parsedBlocks[i]
        const applied = this._applySingleBlock(currentNormalized, block.search, block.replace)

        if (!applied.success) {
          const preview = block.search.slice(0, 100).replace(/\n/g, ' ')
          return {
            formattedContent: `Error applying SEARCH/REPLACE block ${i + 1}/${parsedBlocks.length} ("${preview}..."): ${applied.error}\nTip: Inspect the file with action="read" to verify exact code before editing.`
          }
        }

        currentNormalized = applied.resultText
        totalAdded += applied.linesAdded
        totalDeleted += applied.linesDeleted
      }

      newRaw = isCRLF ? currentNormalized.replace(/\r?\n/g, '\r\n') : currentNormalized
      await fs.writeFile(filePath, newRaw, 'utf8')

      return {
        formattedContent: `Successfully edited file: ${filePath} (applied ${parsedBlocks.length} SEARCH/REPLACE block${parsedBlocks.length > 1 ? 's' : ''})`,
        data: {
          path: filePath,
          stats: { add: totalAdded, del: totalDeleted, blocksCount: parsedBlocks.length }
        }
      }
    }

    // Priority 2: Direct old_content -> new_content replacement
    if (args.old_content !== undefined) {
      const normalizedRaw = raw.replace(/\r\n/g, '\n')
      const targetOld = String(args.old_content)
      const targetNew = String(args.new_content || '')

      const applied = this._applySingleBlock(normalizedRaw, targetOld, targetNew)
      if (!applied.success) {
        return {
          formattedContent: `Error editing file ${filePath}: ${applied.error}\nTip: Verify exact indentation/text, use start_line + end_line, or read the file first (do not include "line_number:" prefixes).`
        }
      }

      newRaw = isCRLF ? applied.resultText.replace(/\r?\n/g, '\r\n') : applied.resultText
      linesDeleted = applied.linesDeleted
      linesAdded = applied.linesAdded
    } else if (args.start_line !== undefined && args.end_line !== undefined) {
      // Priority 3: Line-range replacement
      const normalizedRaw = raw.replace(/\r\n/g, '\n')
      const lines = normalizedRaw.split('\n')
      const startLineArg = Number(args.start_line)
      const endLineArg = Number(args.end_line)

      if (!Number.isInteger(startLineArg) || !Number.isInteger(endLineArg)) {
        return { formattedContent: 'Error: start_line and end_line must be integer line numbers.' }
      }
      if (startLineArg < 1 || endLineArg < startLineArg || startLineArg > lines.length) {
        return { formattedContent: `Error: invalid edit range ${startLineArg}-${endLineArg}; file has ${lines.length} lines.` }
      }

      const start = startLineArg - 1
      const end = Math.min(endLineArg, lines.length)
      const replacement = String(args.new_content || '').replace(/\r\n/g, '\n')
      linesDeleted = end - start
      linesAdded = replacement ? replacement.split('\n').length : 0

      lines.splice(start, linesDeleted, ...(replacement ? replacement.split('\n') : []))
      newRaw = lines.join(isCRLF ? '\r\n' : '\n')
    } else {
      return { formattedContent: 'Error: edit requires old_content, SEARCH/REPLACE blocks, or start_line + end_line.' }
    }

    await fs.writeFile(filePath, newRaw, 'utf8')
    return {
      formattedContent: `Successfully edited file: ${filePath}`,
      data: {
        path: filePath,
        stats: { add: linesAdded, del: linesDeleted },
        old_content: args.old_content,
        new_content: args.new_content
      }
    }
  }

  private async _handleList(dirPath: string): Promise<ToolResult> {
    if (!fsSync.existsSync(dirPath)) {
      return { formattedContent: `Error: directory does not exist: ${dirPath}` }
    }
    let stat
    try {
      stat = await fs.stat(dirPath)
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      return { formattedContent: `Directory list error: ${msg}` }
    }
    if (!stat.isDirectory()) {
      return { formattedContent: `Error: ${dirPath} is a file, not a directory. Use action=read instead.` }
    }
    const items = await fs.readdir(dirPath, { withFileTypes: true })
    if (items.length === 0) {
      return { formattedContent: `Directory ${dirPath} is currently empty.` }
    }
    const formatted = items.map((item) => `${item.isDirectory() ? '[DIR] ' : '[FILE]'} ${item.name}`).join('\n')
    return { formattedContent: `Contents of ${dirPath}:\n\n${formatted}` }
  }

  private _globToRegExp(pattern: string): RegExp {
    const normalized = pattern.replace(/\\/g, '/')
    let source = ''

    for (let i = 0; i < normalized.length; i++) {
      const char = normalized[i]
      if (char === '*' && normalized[i + 1] === '*') {
        i++
        if (normalized[i + 1] === '/') {
          i++
          source += '(?:.*/)?'
        } else {
          source += '.*'
        }
      } else if (char === '*') {
        source += '[^/]*'
      } else if (char === '?') {
        source += '[^/]'
      } else if (char === '[') {
        const close = normalized.indexOf(']', i + 1)
        if (close !== -1) {
          const content = normalized.slice(i + 1, close)
          source += `[${content.replace(/\\/g, '')}]`
          i = close
        } else {
          source += '\\['
        }
      } else {
        source += char.replace(/[.+^${}()|\\]/g, '\\$&')
      }
    }

    return new RegExp(`^${source}$`, 'i')
  }

  private async _handleGlob(dirPath: string, pattern: string, abortSignal?: AbortSignal): Promise<ToolResult> {
    const results: string[] = []
    const rawPattern = String(pattern || '*').trim() || '*'
    const normalizedPattern = rawPattern.replace(/\\/g, '/')
    const hasPathSegment = normalizedPattern.includes('/')
    const hasGlobSyntax = /[*?[]/.test(normalizedPattern)
    const globRegex = this._globToRegExp(
      !hasPathSegment && hasGlobSyntax ? `**/${normalizedPattern}` : normalizedPattern
    )
    const looseName = normalizedPattern.toLowerCase()
    const IGNORED = new Set(['node_modules', '.git', 'dist', 'build', '.next', '__pycache__', '.venv', '.vs', '.idea'])

    const matches = (fullPath: string): boolean => {
      const relative = path.relative(dirPath, fullPath).replace(/\\/g, '/')
      const baseName = path.basename(fullPath)
      if (relative && globRegex.test(relative)) return true
      if (globRegex.test(baseName)) return true
      // Preserve the old convenient behavior for bare names such as App.jsx.
      return !hasPathSegment && !hasGlobSyntax && baseName.toLowerCase().includes(looseName)
    }

    const walk = async (curDir: string, depth = 0): Promise<void> => {
      if (depth > 8 || results.length >= 50 || abortSignal?.aborted) return
      let entries
      try {
        entries = (await fs.readdir(curDir, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))
      } catch {
        return
      }

      for (const entry of entries) {
        if (IGNORED.has(entry.name) || abortSignal?.aborted) continue
        const full = path.join(curDir, entry.name)
        if (entry.isDirectory()) {
          await walk(full, depth + 1)
        } else if (entry.isFile() && matches(full)) {
          results.push(full)
          if (results.length >= 50) return
        }
      }
    }

    try {
      const stat = await fs.stat(dirPath)
      if (stat.isFile()) {
        if (matches(dirPath)) results.push(dirPath)
      } else {
        await walk(dirPath)
      }
    } catch {
      // Keep the existing friendly empty-result behavior for missing paths.
    }
    return {
      formattedContent: `Found ${results.length}${results.length >= 50 ? '+' : ''} files matching "${rawPattern}" in ${dirPath}:\n\n${results.join('\n')}`,
      data: { pattern: rawPattern, path: dirPath, matches: results }
    }
  }

  private async _handleReadTree(dirPath: string, maxDepth: number): Promise<ToolResult> {
    const lines: string[] = []
    const IGNORED = new Set(['node_modules', '.git', 'dist', 'build', '.next', '__pycache__', '.venv', '.vs', '.idea'])

    async function walk(curDir: string, depth = 0, prefix = ''): Promise<void> {
      if (depth > maxDepth || lines.length >= 500) return
      let entries
      try {
        entries = await fs.readdir(curDir, { withFileTypes: true })
      } catch {
        return
      }

      for (let i = 0; i < entries.length; i++) {
        if (lines.length >= 500) {
          lines.push(`${prefix}... [tree truncated at 500 items]`)
          return
        }
        const entry = entries[i]
        if (IGNORED.has(entry.name)) continue
        const isLast = i === entries.length - 1
        const connector = isLast ? '└── ' : '├── '
        lines.push(`${prefix}${connector}${entry.name}${entry.isDirectory() ? '/' : ''}`)

        if (entry.isDirectory() && depth < maxDepth) {
          const childPrefix = prefix + (isLast ? '    ' : '│   ')
          await walk(path.join(curDir, entry.name), depth + 1, childPrefix)
        }
      }
    }

    lines.push(path.basename(dirPath) + '/')
    await walk(dirPath, 0, '')
    return { formattedContent: `Directory tree for ${dirPath}:\n\n${lines.join('\n')}` }
  }

  private async _handleDelete(filePath: string): Promise<ToolResult> {
    await fs.unlink(filePath)
    return { formattedContent: `Deleted file: ${filePath}` }
  }

  private async _handleCreateDir(dirPath: string): Promise<ToolResult> {
    await fs.mkdir(dirPath, { recursive: true })
    return { formattedContent: `Created directory: ${dirPath}` }
  }

  private async _handleDeleteDir(dirPath: string): Promise<ToolResult> {
    await fs.rm(dirPath, { recursive: true, force: true })
    return { formattedContent: `Deleted directory: ${dirPath}` }
  }

  private async _handleMove(src: string, dest: string): Promise<ToolResult> {
    await fs.mkdir(path.dirname(dest), { recursive: true })
    await fs.rename(src, dest)
    return { formattedContent: `Moved ${src} -> ${dest}` }
  }

  private async _handleCopy(src: string, dest: string): Promise<ToolResult> {
    await fs.mkdir(path.dirname(dest), { recursive: true })
    await fs.cp(src, dest, { recursive: true })
    return { formattedContent: `Copied ${src} -> ${dest}` }
  }
}
