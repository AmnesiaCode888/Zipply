import * as fs from 'fs/promises'
import * as Diff from 'diff'
import { ToolBase, ToolParameterDef, ToolResult, ToolExecutionPolicy } from './ToolBase'
import { Blackboard } from '../core/Blackboard'
import {
  resolveWorkspacePath,
  isBinaryFile,
  assertFileNotStale,
  writeFileAtomic,
  recordReadFileState
} from './pathUtils'

export interface MatchRange {
  start: number
  end: number
  replacement: string
}

export function findUniqueEditRange(fileContent: string, target: string, replacement: string, relPath: string): { range?: MatchRange; error?: string } {
  const exactMatches: number[] = []
  let searchPos = 0
  while (searchPos < fileContent.length) {
    const idx = fileContent.indexOf(target, searchPos)
    if (idx === -1) break
    exactMatches.push(idx)
    searchPos = idx + target.length
  }

  if (exactMatches.length === 1) {
    const idx = exactMatches[0]
    return { range: { start: idx, end: idx + target.length, replacement } }
  }
  if (exactMatches.length > 1) {
    const matchLines = exactMatches.map((pos) => fileContent.slice(0, pos).split('\n').length)
    return {
      error: `Ошибка: целевой фрагмент найден ${exactMatches.length} раз(а) в '${relPath}' на строках: ${matchLines.join(', ')}.\nПожалуйста, добавьте 2-3 уникальные строки контекста перед или после target, чтобы указать однозначное место замены.`
    }
  }

  const fileLines = fileContent.split('\n')
  const lineOffsets: number[] = []
  let cursor = 0
  for (const line of fileLines) {
    lineOffsets.push(cursor)
    cursor += line.length + 1
  }
  const spanOffsets = (startLineIdx: number, lineCount: number): { start: number; end: number } => {
    const start = lineOffsets[startLineIdx]
    const lastIdx = startLineIdx + lineCount - 1
    const end = lineOffsets[lastIdx] + fileLines[lastIdx].length
    return { start, end }
  }

  const targetLines = target.split('\n')
  if (targetLines.length > 0 && targetLines.length <= fileLines.length) {
    // 2A: Match ignoring trailing whitespace
    const endTrimmedMatches: number[] = []
    for (let i = 0; i <= fileLines.length - targetLines.length; i++) {
      let matches = true
      for (let j = 0; j < targetLines.length; j++) {
        if (fileLines[i + j].trimEnd() !== targetLines[j].trimEnd()) {
          matches = false
          break
        }
      }
      if (matches) endTrimmedMatches.push(i)
    }

    if (endTrimmedMatches.length === 1) {
      const { start, end } = spanOffsets(endTrimmedMatches[0], targetLines.length)
      return { range: { start, end, replacement } }
    }
    if (endTrimmedMatches.length > 1) {
      return {
        error: `Ошибка: фрагмент найден ${endTrimmedMatches.length} раз(а) (на строках: ${endTrimmedMatches.map((l) => l + 1).join(', ')}). Добавьте больше контекстных строк вокруг target.`
      }
    }

    // 2B: Match ignoring leading and trailing whitespace (indentation-tolerant)
    const fullTrimmedMatches: number[] = []
    for (let i = 0; i <= fileLines.length - targetLines.length; i++) {
      let matches = true
      for (let j = 0; j < targetLines.length; j++) {
        if (fileLines[i + j].trim() !== targetLines[j].trim()) {
          matches = false
          break
        }
      }
      if (matches) fullTrimmedMatches.push(i)
    }

    if (fullTrimmedMatches.length === 1) {
      const matchLineIdx = fullTrimmedMatches[0]
      const firstNonEmpty = targetLines.findIndex((l) => l.trim().length > 0)
      const refIdx = firstNonEmpty >= 0 ? firstNonEmpty : 0
      const originalIndent = fileLines[matchLineIdx + refIdx].match(/^(\s*)/)?.[1] || ''
      const targetIndent = targetLines[refIdx].match(/^(\s*)/)?.[1] || ''

      const repLines = replacement.split('\n').map((line) => {
        if (line.trim().length === 0) return ''
        if (targetIndent && line.startsWith(targetIndent)) {
          return originalIndent + line.slice(targetIndent.length)
        }
        if (!targetIndent && originalIndent) {
          return originalIndent + line
        }
        return line
      })
      const { start, end } = spanOffsets(matchLineIdx, targetLines.length)
      return { range: { start, end, replacement: repLines.join('\n') } }
    }
    if (fullTrimmedMatches.length > 1) {
      return {
        error: `Ошибка: фрагмент найден ${fullTrimmedMatches.length} раз(а) (на строках: ${fullTrimmedMatches.map((l) => l + 1).join(', ')}). Добавьте больше контекстных строк вокруг target.`
      }
    }
  }

  // Diagnostic snippet if no match found
  const firstTargetLine = target.split('\n').find((l) => l.trim().length > 3)?.trim() || ''
  let closestLineIdx = -1
  if (firstTargetLine) {
    closestLineIdx = fileLines.findIndex((l) => l.includes(firstTargetLine))
    if (closestLineIdx === -1) {
      const tokens = firstTargetLine.split(/\s+/).filter((w) => w.length >= 1)
      let bestScore = 1
      for (let i = 0; i < fileLines.length; i++) {
        const score = tokens.filter((t) => fileLines[i].includes(t)).length
        if (score > bestScore) {
          bestScore = score
          closestLineIdx = i
        }
      }
    }
  }

  if (closestLineIdx !== -1) {
    const startSnippet = Math.max(0, closestLineIdx - 3)
    const endSnippet = Math.min(fileLines.length, closestLineIdx + 7)
    const snippet = fileLines
      .slice(startSnippet, endSnippet)
      .map((line, idx) => `${String(startSnippet + idx + 1).padStart(4, ' ')} | ${line}`)
      .join('\n')

    return {
      error: `Ошибка: целевой фрагмент не найден в '${relPath}'.\nПохожее место найдено около строки ${closestLineIdx + 1}:\n----------------------------------------\n${snippet}\n----------------------------------------\nУбедитесь, что ваш target в точности повторяет строки из файла выше (включая отступы и символы).`
    }
  }

  return {
    error: `Ошибка: целевой фрагмент не найден в файле '${relPath}'.\nИспользуйте инструмент read_file, чтобы прочитать актуальное содержимое файла перед редактированием.`
  }
}

export class EditFileTool extends ToolBase {
  get name(): string {
    return 'edit_file'
  }

  get description(): string {
    return 'Заменяет фрагменты текста в существующем файле: используйте target и replacement для одной замены либо массив edits для нескольких непересекающихся замен.'
  }

  get parameters(): Record<string, ToolParameterDef> {
    return {
      path: {
        type: 'string',
        description: 'Относительный путь к файлу в рабочей директории проекта',
        required: true,
        minLength: 1
      },
      target: {
        type: 'string',
        description: 'Точный уникальный фрагмент существующего текста для замены; используется вместе с replacement.',
        required: false
      },
      replacement: {
        type: 'string',
        description: 'Новый фрагмент текста для замены target; используется вместе с target.',
        required: false
      },
      edits: {
        type: 'array',
        description: 'От 1 до 50 уникальных непересекающихся замен; не используйте одновременно с target/replacement.',
        minItems: 1,
        maxItems: 50,
        items: {
          type: 'object',
          properties: {
            target: { type: 'string', description: 'Уникальный текущий фрагмент текста.', minLength: 1 },
            replacement: { type: 'string', description: 'Новый фрагмент текста для замены target.' }
          },
          required: ['target', 'replacement']
        }
      }
    }
  }

  getExecutionPolicy(): ToolExecutionPolicy {
    return {
      mutates: true,
      parallelSafe: false,
      cacheable: false
    }
  }

  validate(argumentsJson: string): string | null {
    try {
      const args = JSON.parse(argumentsJson || '{}')
      const filePath = args.path || args.filePath || args.file_path || args.filepath || args.filename
      if (!filePath || typeof filePath !== 'string') {
        return 'Ошибка: параметр "path" обязателен и должен быть строкой.'
      }
      if (args.edits !== undefined) {
        if (!Array.isArray(args.edits) || args.edits.length === 0 || args.edits.length > 50 || args.target !== undefined || args.replacement !== undefined) return 'Ошибка: edits должен содержать от 1 до 50 замен и не сочетаться с target/replacement.'
        if (args.edits.some((edit: any) => !edit || typeof edit.target !== 'string' || !edit.target.trim() || typeof edit.replacement !== 'string')) return 'Ошибка: каждая замена должна содержать непустой target и строковый replacement.'
        return null
      }
      if (typeof args.target !== 'string' || args.target.trim().length === 0) {
        return 'Ошибка: параметр "target" обязателен и не может быть пустым.'
      }
      if (typeof args.replacement !== 'string') {
        return 'Ошибка: параметр "replacement" обязателен и должен быть строкой.'
      }
      return null
    } catch {
      return 'Ошибка: невалидный JSON аргументов.'
    }
  }

  async execute(argumentsJson: string, blackboard: Blackboard): Promise<ToolResult> {
    const validationError = this.validate(argumentsJson)
    if (validationError) return { formattedContent: validationError, error: true }
    const args = JSON.parse(argumentsJson)
    const filePath = args.path || args.filePath || args.file_path || args.filepath || args.filename
    const { absPath, relPath } = resolveWorkspacePath(blackboard, filePath)

    let rawContent: string
    try {
      if (await isBinaryFile(absPath)) {
        return {
          formattedContent: `Ошибка: файл '${relPath}' является бинарным и не может быть отредактирован.`,
          error: true
        }
      }
      const staleError = await assertFileNotStale(blackboard, absPath, relPath)
      if (staleError) return { formattedContent: staleError, error: true }
      rawContent = await fs.readFile(absPath, 'utf-8')
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      return {
        formattedContent: `Ошибка: невозможно открыть файл '${relPath}' для редактирования: ${msg}`,
        error: true
      }
    }

    const isCrlf = rawContent.includes('\r\n')
    const fileContent = rawContent.replace(/\r\n/g, '\n')
    const editItems: Array<{ target: string; replacement: string }> = Array.isArray(args.edits)
      ? args.edits.map((e: { target: string; replacement: string }) => ({
          target: e.target.replace(/\r\n/g, '\n'),
          replacement: e.replacement.replace(/\r\n/g, '\n')
        }))
      : [{
          target: String(args.target).replace(/\r\n/g, '\n'),
          replacement: String(args.replacement).replace(/\r\n/g, '\n')
        }]

    if (editItems.length === 1 && editItems[0].target === editItems[0].replacement) {
      return {
        formattedContent: `Предупреждение: target и replacement идентичны в '${relPath}', изменений не требуется.`,
        error: false,
        data: { changed: false },
        success: true
      }
    }

    const changes: MatchRange[] = []
    for (let index = 0; index < editItems.length; index++) {
      const item = editItems[index]
      const found = findUniqueEditRange(fileContent, item.target, item.replacement, relPath)
      if (found.error || !found.range) {
        const prefix = editItems.length > 1 ? `Ошибка в правке ${index + 1} для '${relPath}'; файл не изменён.\n` : ''
        return { formattedContent: `${prefix}${found.error || 'Фрагмент не найден.'}`, error: true }
      }
      const { start, end } = found.range
      if (changes.some((change) => start < change.end && end > change.start)) {
        return { formattedContent: `Ошибка: замена ${index + 1} пересекается с другой заменой в '${relPath}'; файл не изменён.`, error: true }
      }
      changes.push(found.range)
    }

    let newContent = fileContent
    for (const change of changes.sort((a, b) => b.start - a.start)) {
      newContent = newContent.slice(0, change.start) + change.replacement + newContent.slice(change.end)
    }

    if (newContent === fileContent) {
      return { formattedContent: `Файл '${relPath}' не изменился.`, success: true, data: { changed: false } }
    }

    const finalContentToWrite = isCrlf ? newContent.replace(/\n/g, '\r\n') : newContent
    try {
      const nextSha = await writeFileAtomic(absPath, finalContentToWrite)
      await recordReadFileState(blackboard, absPath, nextSha)
    } catch (error) {
      return {
        formattedContent: `Ошибка записи '${relPath}': ${error instanceof Error ? error.message : String(error)}`,
        error: true
      }
    }

    const patch = Diff.createPatch(relPath, fileContent, newContent)
    const diffLines = Diff.diffLines(fileContent, newContent)
    let addedCount = 0
    let removedCount = 0
    for (const part of diffLines) {
      const lines = part.value.replace(/\n$/, '').split('\n').length
      if (part.added) addedCount += lines
      else if (part.removed) removedCount += lines
    }

    return {
      formattedContent: patch.trim(),
      data: {
        path: relPath,
        changed: true,
        diff: { added: addedCount, removed: removedCount },
        lines: newContent.split('\n').length
      },
      noTruncate: true,
      success: true
    }
  }
}
