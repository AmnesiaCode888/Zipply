import * as fs from 'fs/promises'
import * as path from 'path'
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

export class WriteFileTool extends ToolBase {
  get name(): string {
    return 'write_file'
  }

  get description(): string {
    return 'Создает новый файл или полностью перезаписывает существующий файл переданным содержимым.'
  }

  get parameters(): Record<string, ToolParameterDef> {
    return {
      path: {
        type: 'string',
        description: 'Относительный путь к файлу в рабочей директории (например: "src/App.tsx")',
        required: true
      },
      content: {
        type: 'string',
        description: 'Полное текстовое содержимое файла',
        required: true
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
      if (typeof args.content !== 'string') {
        return 'Ошибка: параметр "content" обязателен и должен быть строкой.'
      }
      return null
    } catch {
      return 'Ошибка: невалидный JSON аргументов.'
    }
  }

  async execute(argumentsJson: string, blackboard: Blackboard): Promise<ToolResult> {
    const args = JSON.parse(argumentsJson)
    const filePath = args.path || args.filePath || args.file_path || args.filepath || args.filename
    const { absPath, relPath } = resolveWorkspacePath(blackboard, filePath)
    const rawNewContent = String(args.content ?? '')

    let oldContent: string | null = null
    let isNewFile = true
    let mode: number | undefined

    try {
      const stat = await fs.stat(absPath)
      if (!stat.isFile()) {
        return { formattedContent: `Ошибка: '${relPath}' не является файлом.`, error: true }
      }
      if (await isBinaryFile(absPath)) {
        return { formattedContent: `Ошибка: файл '${relPath}' является бинарным и не может быть перезаписан как текст.`, error: true }
      }
      mode = stat.mode
      oldContent = await fs.readFile(absPath, 'utf-8')
      isNewFile = false
    } catch (error: unknown) {
      if ((error as NodeJS.ErrnoException)?.code !== 'ENOENT') {
        const message = error instanceof Error ? error.message : String(error)
        return {
          formattedContent: `Ошибка: невозможно прочитать файл '${relPath}' перед записью: ${message}`,
          error: true
        }
      }
    }

    if (!isNewFile) {
      const staleError = await assertFileNotStale(blackboard, absPath, relPath)
      if (staleError) return { formattedContent: staleError, error: true }
    }

    const hadCrlf = oldContent !== null && oldContent.includes('\r\n')
    const normalizedOld = oldContent !== null ? oldContent.replace(/\r\n/g, '\n') : ''
    const normalizedNew = rawNewContent.replace(/\r\n/g, '\n')
    const contentToWrite = hadCrlf ? normalizedNew.replace(/\n/g, '\r\n') : rawNewContent

    await fs.mkdir(path.dirname(absPath), { recursive: true })
    const nextSha = await writeFileAtomic(absPath, contentToWrite, mode)
    await recordReadFileState(blackboard, absPath, nextSha)

    let addedCount = 0
    let removedCount = 0
    let patch = ''

    if (isNewFile) {
      addedCount = normalizedNew.split('\n').length
      removedCount = 0
    } else {
      patch = Diff.createPatch(relPath, normalizedOld, normalizedNew)
      const diffLines = Diff.diffLines(normalizedOld, normalizedNew)
      for (const part of diffLines) {
        const lines = part.value.replace(/\n$/, '').split('\n').length
        if (part.added) addedCount += lines
        else if (part.removed) removedCount += lines
      }
    }

    const linesCount = normalizedNew.split('\n').length
    const bytesCount = Buffer.byteLength(contentToWrite, 'utf-8')

    const summary = isNewFile
      ? `✅ Файл '${relPath}' успешно создан (${linesCount} строк, ${bytesCount} байт).`
      : `✅ Файл '${relPath}' успешно перезаписан (+${addedCount} / -${removedCount} строк).`

    return {
      formattedContent: isNewFile ? summary : (patch.trim() || summary),
      data: {
        path: relPath,
        diff: { added: addedCount, removed: removedCount },
        isNewFile,
        changed: isNewFile || oldContent !== contentToWrite,
        lines: linesCount,
        bytes: bytesCount
      },
      noTruncate: true,
      success: true
    }
  }
}
