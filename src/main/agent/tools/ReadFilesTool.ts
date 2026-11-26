import { Blackboard } from '../core/Blackboard'
import { ToolBase, ToolParameterDef, ToolResult } from './ToolBase'
import { ReadFileTool } from './ReadFileTool'
import { resolveWorkspacePath } from './pathUtils'

const MAX_BATCH_OUTPUT = 28_000
const MAX_FILE_OUTPUT = 8_000
const RESULT_METADATA_RESERVE = 100

export class ReadFilesTool extends ToolBase {
  get name(): string { return 'read_files' }
  get description(): string { return 'Пакетно читает 1–10 файлов или диапазонов строк за один вызов; общий вывод ограничен.' }
  get parameters(): Record<string, ToolParameterDef> {
    return {
      files: {
        type: 'array',
        description: 'От 1 до 10 файлов; у каждого можно задать диапазон строк.',
        required: true,
        minItems: 1,
        maxItems: 10,
        items: {
          type: 'object',
          properties: {
            path: { type: 'string', description: 'Путь к файлу.', minLength: 1 },
            start_line: { type: 'integer', description: 'Первая строка, начиная с 1.', minimum: 1 },
            line_count: { type: 'integer', description: 'Число строк, от 1 до 600.', minimum: 1, maximum: 600 }
          },
          required: ['path']
        }
      }
    }
  }
  validate(raw: string): string | null {
    try {
      const { files } = JSON.parse(raw)
      if (!Array.isArray(files) || files.length < 1 || files.length > 10) return 'Ошибка: files должен содержать от 1 до 10 файлов.'
      if (files.some((file) => !file || typeof file.path !== 'string' || !file.path.trim())) return 'Ошибка: у каждого файла должен быть path.'
      return null
    } catch { return 'Ошибка: некорректный JSON аргументов.' }
  }
  async execute(raw: string, board: Blackboard, signal?: AbortSignal): Promise<ToolResult> {
    const error = this.validate(raw)
    if (error) return { formattedContent: error, error: true }
    const files = JSON.parse(raw).files as Array<{ path: string; start_line?: number; line_count?: number }>
    const reader = new ReadFileTool()
    const output: string[] = []
    const results: unknown[] = []
    const images: string[] = []
    const notices = files.map((file, index) => {
      const { relPath } = resolveWorkspacePath(board, file.path)
      const displayPath = JSON.stringify(relPath.length > 140 ? `${relPath.slice(0, 69)}…${relPath.slice(-70)}` : relPath)
      return `[Пропущен файл №${index + 1} ${displayPath} из-за лимита вывода. Повторите запрос для этого файла.]`
    })
    // Keep room for a notice for every request whose result does not fit.
    let remaining = MAX_BATCH_OUTPUT - RESULT_METADATA_RESERVE - notices.reduce((length, notice) => length + notice.length + 2, 0)
    let hasError = false
    let truncated = false
    let hasOutput = false
    for (const [index, file] of files.entries()) {
      if (signal?.aborted) return { formattedContent: 'Чтение отменено.', error: true }
      const notice = notices[index]
      remaining += notice.length + 2
      const available = Math.min(MAX_FILE_OUTPUT, remaining - 2)
      const result = await reader.read(file, board, available)
      const omitted = result.data?.omitted === true || result.formattedContent.length > available
      const content = omitted ? notice : result.formattedContent
      output.push(content)
      remaining -= content.length + 2

      hasError ||= Boolean(result.error)
      hasOutput ||= !omitted && !result.error
      truncated ||= omitted || Boolean(result.data?.truncated)
      if (!omitted && result.images) images.push(...result.images)
      const { content: _content, ...metadata } = result.data || {}
      results.push({ path: file.path, error: Boolean(result.error), ...(omitted ? { omitted } : {}), data: result.data ? metadata : undefined })
    }
    return {
      formattedContent: output.join('\n\n'),
      data: { files: results, truncated, partial: truncated || (hasError && hasOutput) },
      images,
      noTruncate: true,
      success: !hasError,
      error: hasError
    }
  }
}
