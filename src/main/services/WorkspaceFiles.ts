import * as fs from 'fs/promises'
import * as path from 'path'
import type { WorkspaceFileEntry, WorkspaceFilePreview, WorkspaceDiagnostics } from '../../shared/workspaceFiles'
import { analyze } from '../agent/services/TypeScriptAnalysis'
import { randomUUID } from 'crypto'
import { analyzePython } from '../agent/services/PythonAnalysis'
import { analyzeGeneric, detectLanguageServer, hasLanguageServer, languageServerName } from '../agent/services/GenericLanguageAnalysis'

const MAX_FILE_SIZE = 2_000_000
const MAX_IMAGE_PREVIEW_SIZE = 15_000_000
const MAX_VIDEO_PREVIEW_SIZE = 50_000_000

const IMAGE_MIME_BY_EXT: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.bmp': 'image/bmp',
  '.ico': 'image/x-icon',
  '.avif': 'image/avif'
}

const VIDEO_MIME_BY_EXT: Record<string, string> = {
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.mov': 'video/quicktime',
  '.m4v': 'video/mp4',
  '.ogv': 'video/ogg'
}

async function resolveInside(root: string, relative: string): Promise<string> {
  if (typeof root !== 'string' || !path.isAbsolute(root) || typeof relative !== 'string' || path.isAbsolute(relative)) throw new Error('Недопустимый путь.')
  const actualRoot = await fs.realpath(root)
  const actual = await fs.realpath(path.resolve(actualRoot, relative || '.'))
  const rel = path.relative(actualRoot, actual)
  if (rel === '..' || rel.startsWith(`..${path.sep}`) || path.isAbsolute(rel)) throw new Error('Путь находится вне рабочей папки.')
  return actual
}

export async function listWorkspaceFiles(root: string, relative: string): Promise<WorkspaceFileEntry[]> {
  const directory = await resolveInside(root, relative)
  const entries = await fs.readdir(directory, { withFileTypes: true })
  const result: WorkspaceFileEntry[] = []
  for (const entry of entries) {
    const entryPath = path.join(relative, entry.name)
    let kind: WorkspaceFileEntry['kind']
    if (entry.isSymbolicLink()) {
      try {
        const stat = await fs.stat(await resolveInside(root, entryPath))
        if (!stat.isDirectory() && !stat.isFile()) continue
        kind = stat.isDirectory() ? 'directory' : 'file'
      } catch { continue }
    } else if (entry.isDirectory()) kind = 'directory'
    else if (entry.isFile()) kind = 'file'
    else continue
    result.push({ name: entry.name, path: entryPath, kind })
  }
  return result.sort((a, b) => a.kind === b.kind ? a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }) : a.kind === 'directory' ? -1 : 1)
}

export async function resolveWorkspaceRevealPath(root: string, relative: string): Promise<string> {
  const target = await resolveInside(root, relative)
  await fs.stat(target)
  return target
}

async function readExactBytes(handle: fs.FileHandle, maxSize: number, statSize: number): Promise<Buffer> {
  const buffer = Buffer.alloc(Math.min(maxSize + 1, statSize + 1))
  let totalRead = 0
  while (totalRead < buffer.length) {
    const { bytesRead } = await handle.read(buffer, totalRead, buffer.length - totalRead, totalRead)
    if (bytesRead === 0) break
    totalRead += bytesRead
  }
  if (totalRead > maxSize) throw new Error('Файл превышает допустимый размер.')
  if (totalRead > statSize) throw new Error('Файл изменился во время чтения. Попробуйте ещё раз.')
  return buffer.subarray(0, totalRead)
}

export async function readWorkspacePreview(root: string, relative: string): Promise<WorkspaceFilePreview> {
  const file = await resolveInside(root, relative)
  const ext = path.extname(file).toLowerCase()
  const imageMime = IMAGE_MIME_BY_EXT[ext]
  const videoMime = VIDEO_MIME_BY_EXT[ext]

  const handle = await fs.open(file, 'r')
  try {
    const stat = await handle.stat()
    if (!stat.isFile()) throw new Error('Это не файл.')

    if (imageMime) {
      if (stat.size > MAX_IMAGE_PREVIEW_SIZE) {
        return { kind: 'too-large', size: stat.size, maxSize: MAX_IMAGE_PREVIEW_SIZE, mediaType: 'image' }
      }
      const bytes = await readExactBytes(handle, MAX_IMAGE_PREVIEW_SIZE, stat.size)
      return { kind: 'image', mime: imageMime, bytes: new Uint8Array(bytes), size: bytes.byteLength }
    }

    if (videoMime) {
      if (stat.size > MAX_VIDEO_PREVIEW_SIZE) {
        return { kind: 'too-large', size: stat.size, maxSize: MAX_VIDEO_PREVIEW_SIZE, mediaType: 'video' }
      }
      const bytes = await readExactBytes(handle, MAX_VIDEO_PREVIEW_SIZE, stat.size)
      return { kind: 'video', mime: videoMime, bytes: new Uint8Array(bytes), size: bytes.byteLength }
    }

    if (stat.size > MAX_FILE_SIZE) {
      return { kind: 'too-large', size: stat.size, maxSize: MAX_FILE_SIZE, mediaType: 'text' }
    }
    const bytes = await readExactBytes(handle, MAX_FILE_SIZE, stat.size)
    if (bytes.includes(0)) return { kind: 'binary', size: bytes.byteLength }
    try {
      return { kind: 'text', text: new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes), size: bytes.byteLength }
    } catch {
      return { kind: 'binary', size: bytes.byteLength }
    }
  } finally {
    await handle.close()
  }
}

export async function readWorkspaceText(root: string, relative: string): Promise<string> {
  const file = await resolveInside(root, relative)
  const handle = await fs.open(file, 'r')
  try {
    const stat = await handle.stat()
    if (!stat.isFile()) throw new Error('Это не файл.')
    if (stat.size > MAX_FILE_SIZE) throw new Error('Файл больше 2 МБ.')
    const buffer = Buffer.alloc(Math.min(MAX_FILE_SIZE + 1, stat.size + 1))
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0)
    if (bytesRead > MAX_FILE_SIZE) throw new Error('Файл больше 2 МБ.')
    if (bytesRead > stat.size) throw new Error('Файл изменился во время чтения. Попробуйте ещё раз.')
    const bytes = buffer.subarray(0, bytesRead)
    if (bytes.includes(0)) throw new Error('Бинарный файл нельзя показать как текст.')
    try { return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes) }
    catch { throw new Error('Бинарный файл или неподдерживаемая кодировка.') }
  } finally { await handle.close() }
}

const pendingWrites = new Map<string, Promise<void>>()
export async function writeWorkspaceText(root: string, relative: string, expected: string, content: string): Promise<void> {
  if (typeof expected !== 'string' || typeof content !== 'string' || Buffer.byteLength(content, 'utf8') > MAX_FILE_SIZE) throw new Error('Недопустимое содержимое или размер файла больше 2 МБ.')
  const file = await resolveInside(root, relative)
  const previous = pendingWrites.get(file) || Promise.resolve()
  const operation = previous.catch(() => {}).then(async () => {
    if (await readWorkspaceText(root, relative) !== expected) throw new Error('Файл изменился на диске. Сохранение отменено; скопируйте свои изменения и откройте файл заново.')
    const stat = await fs.stat(file)
    const temporary = path.join(path.dirname(file), `.zipply-${randomUUID()}.tmp`)
    let created = false
    try {
      await fs.writeFile(temporary, content, { encoding: 'utf8', flag: 'wx', mode: stat.mode }); created = true
      if (await resolveInside(root, relative) !== file || await readWorkspaceText(root, relative) !== expected) throw new Error('Файл изменился на диске. Сохранение отменено.')
      await fs.rename(temporary, file); created = false
    } finally { if (created) await fs.unlink(temporary).catch(() => {}) }
  })
  pendingWrites.set(file, operation)
  try { await operation } finally { if (pendingWrites.get(file) === operation) pendingWrites.delete(file) }
}

export async function diagnoseWorkspaceFile(root: string, relative: string, signal?: AbortSignal, runServer = false, sourceText?: string): Promise<WorkspaceDiagnostics> {
  const diskText = await readWorkspaceText(root, relative)
  if (sourceText !== undefined && (typeof sourceText !== 'string' || Buffer.byteLength(sourceText, 'utf8') > 2_000_000)) throw new Error('Текст для проверки превышает лимит 2 МБ.')
  const text = sourceText ?? diskText
  const ext = path.extname(relative).toLowerCase()
  if (ext === '.css') {
    const { default: postcss } = await import('postcss')
    try { postcss.parse(text, { from: undefined }); return { supported: true, items: [], scope: 'syntax' } }
    catch (error) {
      if (!(error instanceof postcss.CssSyntaxError)) throw error
      const line = error.line || 1, column = error.column || 1
      return { supported: true, scope: 'syntax', items: [{ line, column, endLine: error.endLine || line, endColumn: error.endColumn || column + 1, category: 'Error', message: error.reason }] }
    }
  }
  if (ext === '.jsonc') {
    const ts = await import('typescript')
    const result = ts.parseConfigFileTextToJson(relative, text)
    if (!result.error) return { supported: true, items: [], scope: 'syntax' }
    const before = text.slice(0, result.error.start ?? text.length).split('\n')
    const line = before.length, column = before[before.length - 1].length + 1
    return { supported: true, scope: 'syntax', items: [{ line, column, endLine: line, endColumn: column + Math.max(1, result.error.length || 1), category: 'Error', code: result.error.code, message: ts.flattenDiagnosticMessageText(result.error.messageText, '\n') }] }
  }
  if (ext === '.json') {
    try { JSON.parse(text); return { supported: true, items: [], scope: 'syntax' } }
    catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      const match = /position (\d+)/i.exec(message)
      const before = text.slice(0, match ? Number(match[1]) : text.length)
      const lines = before.split('\n')
      return { supported: true, scope: 'syntax', items: [{ line: lines.length, column: lines[lines.length - 1].length + 1, endLine: lines.length, endColumn: lines[lines.length - 1].length + 2, category: 'Error', message }] }
    }
  }
  const typescript = ['.js', '.jsx', '.mjs', '.cjs', '.ts', '.tsx', '.mts', '.cts'].includes(ext)
  const python = ['.py', '.pyi'].includes(ext)
  if (!typescript && !python && !hasLanguageServer(relative)) return { supported: false, items: [], reason: 'Диагностика для этого языка пока недоступна.' }
  if (!typescript && !runServer) return { supported: false, items: [], needsServer: true, reason: 'Языковой сервер может запускать программы проекта.' }
  const target = await resolveInside(root, relative)
  let result
  if (typescript) result = await analyze({ operation: 'diagnostics', path: target, sourceText: text }, root, signal)
  else if (python) result = await analyzePython({ operation: 'diagnostics', path: target, sourceText: text }, root, signal)
  else {
    const server = await detectLanguageServer(relative)
    if (!server) return { supported: false, items: [], needsServer: true, reason: `Языковой сервер ${languageServerName(relative)} не найден в PATH.` }
    result = await analyzeGeneric({ operation: 'diagnostics', path: target, sourceText: text }, root, server, signal)
  }
  if (result.error) throw new Error(result.error)
  return { supported: true, truncated: result.truncated, items: (result.items || []).filter(item => typeof item.line === 'number' && typeof item.column === 'number' && typeof item.message === 'string').map(item => ({ line: item.line as number, column: item.column as number, endLine: typeof item.endLine === 'number' ? item.endLine : undefined, endColumn: typeof item.endColumn === 'number' ? item.endColumn : undefined, message: item.message as string, category: String(item.category || 'Error'), code: typeof item.code === 'number' || typeof item.code === 'string' ? item.code : undefined })) }
}
