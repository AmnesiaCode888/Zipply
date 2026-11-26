import * as fs from 'fs/promises'
import * as path from 'path'
import { randomUUID } from 'crypto'
import { unzipSync } from 'fflate'

const MAX_BYTES = 20 * 1024 * 1024
const MAX_EXTRACTED = 120_000
const extensions = new Set(['txt', 'md', 'log', 'csv', 'tsv', 'json', 'pdf', 'docx', 'xlsx'])
const uploadPattern = /^\.zipply\/uploads\/[a-f0-9-]{36}\.(txt|md|log|csv|tsv|json|pdf|docx|xlsx)$/

async function directory(workspace: string, create: boolean): Promise<string> {
  if (!path.isAbsolute(workspace || '')) throw new Error('Рабочая папка не указана.')
  const root = await fs.realpath(workspace)
  const parent = path.join(root, '.zipply')
  if (create) await fs.mkdir(parent, { recursive: true })
  const realParent = await fs.realpath(parent)
  if (path.dirname(realParent) !== root) throw new Error('Папка загрузок находится вне рабочей папки.')
  const dir = path.join(realParent, 'uploads')
  if (create) await fs.mkdir(dir, { recursive: true })
  const realDir = await fs.realpath(dir)
  if (path.dirname(realDir) !== realParent) throw new Error('Папка загрузок находится вне рабочей папки.')
  return realDir
}

export async function saveDocument(workspace: string, name: string, input: Uint8Array): Promise<{ name: string; path: string }> {
  const cleanName = typeof name === 'string' ? name.split(/[\\/]/).pop()?.slice(0, 255) || '' : ''
  const ext = path.extname(cleanName).slice(1).toLowerCase()
  if (!extensions.has(ext)) throw new Error('Формат документа не поддерживается.')
  if (!(input instanceof Uint8Array) || !input.byteLength || input.byteLength > MAX_BYTES) throw new Error('Размер документа должен быть от 1 байта до 20 МБ.')
  const bytes = Buffer.from(input)
  if (ext === 'pdf' && bytes.subarray(0, 5).toString() !== '%PDF-') throw new Error('Некорректный PDF-файл.')
  if (['docx', 'xlsx'].includes(ext) && (bytes[0] !== 0x50 || bytes[1] !== 0x4b)) throw new Error('Некорректный документ Office.')
  const dir = await directory(workspace, true)
  const filename = `${randomUUID()}.${ext}`
  await fs.writeFile(path.join(dir, filename), bytes, { flag: 'wx' })
  return { name: cleanName, path: `.zipply/uploads/${filename}` }
}

export async function readDocumentBytes(workspace: string, relativePath: string): Promise<Buffer> {
  if (typeof relativePath !== 'string' || !uploadPattern.test(relativePath)) throw new Error('Недопустимый путь к документу.')
  const dir = await directory(workspace, false)
  const target = await fs.realpath(path.join(dir, path.basename(relativePath)))
  if (path.dirname(target) !== dir) throw new Error('Документ находится вне папки загрузок.')
  const stat = await fs.stat(target)
  if (!stat.isFile() || stat.size > MAX_BYTES) throw new Error('Документ слишком велик.')
  return fs.readFile(target)
}

export async function extractDocument(workspace: string, relativePath: string): Promise<string> {
  const bytes = await readDocumentBytes(workspace, relativePath)
  const ext = path.extname(relativePath).slice(1)
  let text = ''
  if (ext === 'pdf') {
    const parse = require('pdf-parse') as (input: Buffer) => Promise<{ text: string }>
    text = (await parse(bytes)).text
  } else if (ext === 'docx' || ext === 'xlsx') {
    let total = 0
    let count = 0
    unzipSync(bytes, { filter: entry => {
      if (++count > 5000 || (total += entry.originalSize) > 100 * 1024 * 1024) throw new Error('Документ слишком велик после распаковки.')
      return false
    } })
    if (ext === 'docx') {
      const mammoth = require('mammoth') as typeof import('mammoth')
      text = (await mammoth.extractRawText({ buffer: bytes })).value
    } else {
      const ExcelJS = require('exceljs') as typeof import('exceljs')
      const workbook = new ExcelJS.Workbook()
      await workbook.xlsx.load(bytes as any)
      const lines: string[] = []
      let countChars = 0
      workbook.eachSheet(sheet => {
        if (countChars > MAX_EXTRACTED) return
        lines.push(`Лист: ${sheet.name}`)
        sheet.eachRow(row => {
          if (countChars > MAX_EXTRACTED) return
          const line: string[] = []
          row.eachCell({ includeEmpty: true }, (cell, col) => { line[col - 1] = cell.text })
          const joined = line.join('\t')
          countChars += joined.length + 1
          lines.push(joined)
        })
      })
      text = lines.join('\n')
    }
  } else {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  }
  if (!text.trim()) throw new Error('В документе не найден текст; сканы без распознавания текста не поддерживаются.')
  return text.length > MAX_EXTRACTED ? `${text.slice(0, MAX_EXTRACTED)}\n[Документ усечён до 120 000 символов.]` : text
}
