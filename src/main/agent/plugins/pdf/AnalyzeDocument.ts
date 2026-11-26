import * as fs from 'fs/promises'
import * as path from 'path'
import { Blackboard } from '../../core/Blackboard'
import { ToolBase, type ToolExecutionPolicy, type ToolParameterDef, type ToolResult } from '../../tools/ToolBase'
import { inspectWorkspacePath } from '../../tools/pathUtils'

const MAX_PDF_BYTES = 20 * 1024 * 1024
const MAX_EXTRACTED_CHARS = 120_000
const MAX_PAGES = 100

interface PdfParseResult {
  numpages: number
  numrender: number
  info?: Record<string, unknown> | null
  text: string
}

type PdfParser = (input: Buffer, options?: { max?: number }) => Promise<PdfParseResult>

function safeMetadata(value: unknown): string | undefined {
  if (typeof value !== 'string' && typeof value !== 'number') return undefined
  const result = String(value).replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 500)
  return result || undefined
}

export class PdfAnalyzeDocument extends ToolBase {
  constructor(private readonly parser?: PdfParser) { super() }
  get name(): string { return 'pdf_analyze_document' }
  get description(): string { return 'Извлекает текст и базовые метаданные PDF-файла из выбранной рабочей папки. Обрабатывает до 100 страниц и передаёт не более 120 000 символов; сканированные документы без текстового слоя требуют отдельного OCR.' }
  get parameters(): Record<string, ToolParameterDef> {
    return {
      path: { type: 'string', description: 'Путь к PDF-файлу внутри выбранной рабочей папки.', required: true, maxLength: 4096 }
    }
  }
  getExecutionPolicy(): ToolExecutionPolicy { return { mutates: false, parallelSafe: false, cacheable: false } }

  validate(argumentsJson: string): string | null {
    let args: unknown
    try { args = JSON.parse(argumentsJson) } catch { return 'Аргументы должны быть корректным JSON.' }
    if (!args || typeof args !== 'object' || Array.isArray(args)) return 'Аргументы должны быть JSON-объектом.'
    const filePath = (args as Record<string, unknown>).path
    return typeof filePath === 'string' && filePath.trim() ? null : 'Укажи путь к PDF-файлу.'
  }

  async execute(argumentsJson: string, board: Blackboard, signal?: AbortSignal): Promise<ToolResult> {
    let args: unknown
    try { args = JSON.parse(argumentsJson) } catch { return { error: true, formattedContent: 'Аргументы должны быть корректным JSON.' } }
    const filePath = args && typeof args === 'object' && !Array.isArray(args) ? (args as Record<string, unknown>).path : undefined
    if (typeof filePath !== 'string' || !filePath.trim()) return { error: true, formattedContent: 'Укажи путь к PDF-файлу.' }
    const config = board.getArtifact('config') as { workspacePath?: string } | undefined
    if (!config?.workspacePath?.trim()) return { error: true, formattedContent: 'Для анализа PDF выбери папку проекта.' }
    if (signal?.aborted) return { error: true, formattedContent: 'Анализ PDF отменён.' }
    if (path.extname(filePath).toLowerCase() !== '.pdf') return { error: true, formattedContent: 'Можно анализировать только файлы с расширением .pdf.' }

    try {
      const { actualPath, external } = await inspectWorkspacePath(board, filePath)
      if (external) return { error: true, formattedContent: 'PDF можно открывать только внутри выбранной рабочей папки.' }
      const stat = await fs.stat(actualPath)
      if (!stat.isFile()) return { error: true, formattedContent: 'Указанный путь не является файлом.' }
      if (stat.size <= 0 || stat.size > MAX_PDF_BYTES) return { error: true, formattedContent: 'Размер PDF должен быть от 1 байта до 20 МБ.' }
      const bytes = await fs.readFile(actualPath)
      if (bytes.byteLength > MAX_PDF_BYTES) return { error: true, formattedContent: 'Размер PDF превышает 20 МБ.' }
      if (bytes.subarray(0, 5).toString('ascii') !== '%PDF-') return { error: true, formattedContent: 'Файл не содержит заголовок PDF.' }
      if (signal?.aborted) return { error: true, formattedContent: 'Анализ PDF отменён.' }

      const parsePdf = this.parser || require('pdf-parse') as PdfParser
      const parsed = await parsePdf(bytes, { max: MAX_PAGES })
      if (signal?.aborted) return { error: true, formattedContent: 'Анализ PDF отменён.' }
      const extracted = typeof parsed.text === 'string' ? parsed.text.trim() : ''
      if (!extracted) return { error: true, formattedContent: 'В PDF не найден текстовый слой. Сканированные страницы без OCR распознать нельзя.' }

      const textTruncated = extracted.length > MAX_EXTRACTED_CHARS
      const text = textTruncated ? extracted.slice(0, MAX_EXTRACTED_CHARS) : extracted
      const info = parsed.info || {}
      const metadata = {
        ...(safeMetadata(info.Title) ? { title: safeMetadata(info.Title) } : {}),
        ...(safeMetadata(info.Author) ? { author: safeMetadata(info.Author) } : {}),
        ...(safeMetadata(info.Subject) ? { subject: safeMetadata(info.Subject) } : {}),
        ...(safeMetadata(info.Creator) ? { creator: safeMetadata(info.Creator) } : {}),
        ...(safeMetadata(info.Producer) ? { producer: safeMetadata(info.Producer) } : {}),
        ...(safeMetadata(info.CreationDate) ? { creationDate: safeMetadata(info.CreationDate) } : {}),
        ...(safeMetadata(info.ModDate) ? { modifiedDate: safeMetadata(info.ModDate) } : {})
      }
      const totalPages = Number.isInteger(parsed.numpages) ? parsed.numpages : 0
      const pagesParsed = Number.isInteger(parsed.numrender) ? parsed.numrender : 0
      const data = {
        path: filePath,
        totalPages,
        pagesParsed,
        pagesTruncated: pagesParsed < totalPages,
        metadata,
        wordCount: text.match(/\S+/g)?.length || 0,
        charCount: text.length,
        text,
        textTruncated
      }
      const title = metadata.title || path.basename(filePath)
      return {
        success: true,
        data,
        displayContent: `PDF «${title}»: ${totalPages} стр., извлечено ${data.wordCount} слов.`,
        formattedContent: `PDF: ${title}\nСтраниц: ${totalPages}${data.pagesTruncated ? ` (обработано первых ${pagesParsed})` : ''}\nМетаданные: ${Object.entries(metadata).map(([key, value]) => `${key}: ${value}`).join('; ') || 'не заданы'}\nСлов: ${data.wordCount}${textTruncated ? `\nТекст усечён до ${MAX_EXTRACTED_CHARS} символов.` : ''}\n\n${text}`
      }
    } catch (error) {
      return { error: true, formattedContent: `Не удалось разобрать PDF: ${error instanceof Error ? error.message : String(error)}` }
    }
  }
}
