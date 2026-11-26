import * as fs from 'fs/promises'
import * as path from 'path'
import { createHash } from 'crypto'
import { readWorkspaceImage } from '../../services/ImageUploads'
import { ToolBase, ToolParameterDef, ToolResult, ToolExecutionPolicy } from './ToolBase'
import { Blackboard } from '../core/Blackboard'
import { resolveWorkspacePath, isBinaryFile, recordReadFileState } from './pathUtils'

interface ReadFileArgs { path: string; start_line?: number; line_count?: number }
interface ReadFileData {
  path: string
  sha256?: string
  startLine?: number
  endLine?: number
  totalLines?: number
  nextStartLine?: number
  truncated?: boolean
  omitted?: boolean
  content?: string
}

export class ReadFileTool extends ToolBase {
  get name(): string {
    return 'read_file'
  }

  get description(): string {
    return 'Читает текстовый файл с нумерацией строк или показывает модели изображение PNG, JPEG, GIF или WebP из рабочей папки.'
  }

  get parameters(): Record<string, ToolParameterDef> {
    return {
      path: {
        type: 'string',
        description: 'Относительный путь к файлу в рабочей директории',
        required: true
      },
      start_line: {
        type: 'integer',
        description: 'Номер начальной строки (начиная с 1). По умолчанию 1.',
        minimum: 1,
        default: 1
      },
      line_count: {
        type: 'integer',
        description: 'Количество строк для чтения, от 1 до 600 (по умолчанию 600).',
        minimum: 1,
        maximum: 600,
        default: 600
      }
    }
  }

  getExecutionPolicy(): ToolExecutionPolicy {
    return {
      mutates: false,
      parallelSafe: true,
      cacheable: true
    }
  }

  validate(argumentsJson: string): string | null {
    try {
      const args = JSON.parse(argumentsJson || '{}')
      if (!args.path || typeof args.path !== 'string') {
        return 'Ошибка: параметр "path" обязателен и должен быть строкой.'
      }
      return null
    } catch {
      return 'Ошибка: невалидный JSON аргументов.'
    }
  }

  async execute(argumentsJson: string, blackboard: Blackboard): Promise<ToolResult> {
    return this.read(JSON.parse(argumentsJson), blackboard)
  }

  async read(args: ReadFileArgs, blackboard: Blackboard, maxOutputChars = 30_000): Promise<ToolResult & { data?: ReadFileData }> {
    const { absPath, relPath, workspaceRoot } = resolveWorkspacePath(blackboard, args.path)

    if (['.png', '.jpg', '.jpeg', '.webp', '.gif'].includes(path.extname(absPath).toLowerCase())) {
      try {
        await readWorkspaceImage(workspaceRoot, relPath)
        return {
          formattedContent: `Изображение «${relPath}» передано модели для просмотра.`,
          data: { path: relPath }, images: [relPath], success: true
        }
      } catch (error) {
        return { formattedContent: `Ошибка чтения изображения '${relPath}': ${error instanceof Error ? error.message : String(error)}`, error: true }
      }
    }

    let content: string
    let sha256: string
    try {
      const stat = await fs.stat(absPath)
      if (stat.size > 2_000_000) return { formattedContent: `Ошибка: файл '${relPath}' больше 2 МБ; используйте поиск по проекту.`, error: true }
      if (await isBinaryFile(absPath)) {
        return {
          formattedContent: `Ошибка: файл '${relPath}' является бинарным, текстовое чтение невозможно.`,
          error: true
        }
      }
      const bytes = await fs.readFile(absPath)
      sha256 = createHash('sha256').update(bytes).digest('hex')
      content = bytes.toString('utf-8')
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      const isNotFound = (err as NodeJS.ErrnoException)?.code === 'ENOENT'
      let hint = ''
      if (isNotFound) {
        const targetName = path.basename(relPath)
        if (targetName) {
          const suggestions = await findSimilarFiles(workspaceRoot, targetName)
          if (suggestions.length > 0) {
            hint = `\nВозможно, вы имели в виду:\n${suggestions.map((s) => `- ${s}`).join('\n')}`
          }
        }
      }
      return {
        formattedContent: `Ошибка чтения файла '${relPath}': ${msg}${hint}`,
        error: true
      }
    }

    // Normalize newlines
    const lines = content.replace(/\r\n/g, '\n').split('\n')
    const totalLines = lines.length

    const startLine = Math.max(1, parseInt(String(args.start_line || 1), 10) || 1)
    const requestedCount = Math.max(1, Math.min(600, parseInt(String(args.line_count || 600), 10) || 600))
    const requestedEnd = Math.min(totalLines, startLine + requestedCount - 1)

    if (startLine > totalLines && totalLines > 0) {
      return {
        formattedContent: `Файл '${relPath}' содержит всего ${totalLines} строк (запрошена строка ${startLine}).`,
        error: true
      }
    }

    const heading = (endLine: number): string => {
      const header = `Файл: ${relPath} (строки ${startLine}–${endLine} из ${totalLines})`
      return `${header}\nSHA-256: ${sha256}\n${'='.repeat(Math.min(header.length, 60))}\n`
    }
    const footer = (endLine: number, lineTruncated: boolean): string => {
      const limitNotice = endLine < requestedEnd ? '\n[Вывод ограничен.]' : ''
      const lineNotice = lineTruncated ? '\n[Содержимое длинной строки усечено по лимиту вывода.]' : ''
      const rest = endLine < totalLines ? `\n[Осталось ещё ${totalLines - endLine} строк. Используйте start_line=${endLine + 1} для продолжения.]` : ''
      return limitNotice + lineNotice + rest
    }

    // Reserve enough room to describe the actual range even if the next line cannot fit.
    const maxDigits = String(requestedEnd).length
    const footerReserve = footer(startLine - 1, true).length + maxDigits
    let remaining = maxOutputChars - heading(requestedEnd).length - footerReserve
    const selectedLines: string[] = []
    const formattedLines: string[] = []
    let lineTruncated = false
    for (let lineNumber = startLine; lineNumber <= requestedEnd; lineNumber++) {
      const line = lines[lineNumber - 1]
      const selected = line.length > 4000 ? `${line.slice(0, 4000)} [строка усечена по лимиту]` : line
      const formatted = `${String(lineNumber).padStart(maxDigits, ' ')} | ${selected}`
      const length = formatted.length + (formattedLines.length ? 1 : 0)
      if (length > remaining) break
      remaining -= length
      lineTruncated ||= selected !== line
      selectedLines.push(selected)
      formattedLines.push(formatted)
    }

    if (!selectedLines.length) {
      return {
        formattedContent: `Файл '${relPath}' не помещается в оставшийся лимит вывода. Используйте read_file с start_line=${startLine}.`,
        data: { path: relPath, totalLines, nextStartLine: startLine, omitted: true, truncated: true }
      }
    }

    await recordReadFileState(blackboard, absPath, sha256)
    const endLine = startLine + selectedLines.length - 1

    return {
      formattedContent: `${heading(endLine)}${formattedLines.join('\n')}${footer(endLine, lineTruncated)}`,
      data: {
        path: relPath,
        sha256,
        startLine,
        endLine,
        totalLines,
        ...(endLine < totalLines ? { nextStartLine: endLine + 1 } : {}),
        truncated: endLine < requestedEnd || lineTruncated,
        content: selectedLines.join('\n')
      },
      noTruncate: true,
      success: true
    }
  }
}

const IGNORED_HINT_DIRS = new Set([
  'node_modules',
  '.git',
  'dist',
  'build',
  'out',
  '.next',
  'coverage',
  '.cache'
])

/**
 * Searches workspaceRoot in BFS order for files matching targetName (case-insensitive),
 * bounded by entry count and timeout so large repositories never stall.
 */
async function findSimilarFiles(workspaceRoot: string, targetName: string): Promise<string[]> {
  const MAX_ENTRIES = 5000
  const MAX_SUGGESTIONS = 5
  const TIMEOUT_MS = 150

  const targetLower = targetName.toLowerCase()
  const deadline = Date.now() + TIMEOUT_MS
  const queue: string[] = [workspaceRoot]
  const matches: string[] = []
  let visited = 0

  while (queue.length > 0 && matches.length < MAX_SUGGESTIONS && visited < MAX_ENTRIES && Date.now() < deadline) {
    const dir = queue.shift()!
    let entries
    try {
      entries = await fs.readdir(dir, { withFileTypes: true })
    } catch {
      continue
    }

    for (const entry of entries) {
      if (++visited > MAX_ENTRIES || Date.now() >= deadline) break
      if (entry.isDirectory()) {
        if (!IGNORED_HINT_DIRS.has(entry.name) && !entry.name.startsWith('.')) {
          queue.push(path.join(dir, entry.name))
        }
      } else if (entry.isFile() && entry.name.toLowerCase() === targetLower) {
        matches.push(path.relative(workspaceRoot, path.join(dir, entry.name)).replace(/\\/g, '/'))
        if (matches.length >= MAX_SUGGESTIONS) break
      }
    }
  }

  return matches
}
