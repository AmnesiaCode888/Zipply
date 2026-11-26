import * as fs from 'fs/promises'
import * as path from 'path'
import { randomUUID, createHash } from 'crypto'
import { zipSync, unzipSync, strToU8, strFromU8 } from 'fflate'
import { isValidChatSessions } from '../../shared/chatValidation'
import { readImage, saveImage } from './ImageUploads'
import { readDocumentBytes, saveDocument } from './DocumentUploads'

type ArchiveSession = { id: string; folderPath?: string; messages: unknown[]; [key: string]: unknown }
const MAX_ARCHIVE = 120 * 1024 * 1024
const MAX_CONTENT = 100 * 1024 * 1024
const MAX_ENTRIES = 2000
const imagePattern = /^\.zipply\/uploads\/[a-f0-9-]{36}\.(png|jpg|webp|gif|txt|md|log|csv|tsv|json|pdf|docx|xlsx)$/

function imagePaths(session: ArchiveSession): Set<string> {
  const found = new Set<string>()
  const visit = (value: unknown): void => {
    if (typeof value === 'string') {
      for (const match of value.matchAll(/zipply-(?:upload|document):(\.zipply\/uploads\/[a-f0-9-]{36}\.(?:png|jpg|webp|gif|txt|md|log|csv|tsv|json|pdf|docx|xlsx))/g)) found.add(match[1])
      // Context snapshots are JSON strings containing image references.
      if ((value.includes('zipply-upload:') || value.includes('zipply-document:')) && value.startsWith('[')) {
        try { visit(JSON.parse(value)) } catch { /* normal text is not a snapshot */ }
      }
    } else if (Array.isArray(value)) value.forEach(visit)
    else if (value && typeof value === 'object') {
      const object = value as Record<string, unknown>
      if (typeof object.path === 'string' && imagePattern.test(object.path) && typeof object.name === 'string') found.add(object.path)
      Object.values(object).forEach(visit)
    }
  }
  visit(session.messages)
  return found
}

export async function createChatArchive(sessions: ArchiveSession[]): Promise<Uint8Array> {
  if (!isValidChatSessions(sessions)) throw new Error('Неверный формат истории чатов.')
  const portableSessions = sessions.map(({ folderPath: _folderPath, ...session }) => session)
  const images: Record<string, string> = {}
  const files: Record<string, Uint8Array> = {}
  let size = 0
  for (const [index, session] of sessions.entries()) {
    for (const image of imagePaths(session)) {
      const bytes = /\.(png|jpg|webp|gif)$/.test(image)
        ? Buffer.from((await readImage(session.folderPath || '', image)).split(',')[1], 'base64')
        : await readDocumentBytes(session.folderPath || '', image)
      size += bytes.length
      if (size > MAX_CONTENT || Object.keys(files).length >= MAX_ENTRIES) throw new Error('История слишком велика для экспорта.')
      const key = `images/${index}/${path.posix.basename(image)}`
      files[key] = bytes
      images[key] = createHash('sha256').update(bytes).digest('hex')
    }
  }
  files['manifest.json'] = strToU8(JSON.stringify({ version: 1, sessions: portableSessions, images }))
  if (files['manifest.json'].length > 20 * 1024 * 1024 || size + files['manifest.json'].length > MAX_CONTENT) throw new Error('История слишком велика для экспорта.')
  const result = zipSync(files, { level: 6 })
  if (result.length > MAX_ARCHIVE) throw new Error('Архив слишком велик.')
  return result
}

export async function restoreChatArchive(data: Uint8Array, root: string): Promise<ArchiveSession[]> {
  if (!(data instanceof Uint8Array) || data.length > MAX_ARCHIVE || data.length < 22) throw new Error('Архив повреждён или слишком велик.')
  let total = 0
  let count = 0
  const names = new Set<string>()
  const sizes = new Map<string, number>()
  const files = unzipSync(data, { filter: entry => {
    if (++count > MAX_ENTRIES || names.has(entry.name) || !/^(manifest\.json|images\/\d+\/[a-f0-9-]{36}\.(png|jpg|webp|gif|txt|md|log|csv|tsv|json|pdf|docx|xlsx))$/.test(entry.name)) throw new Error('Недопустимое содержимое архива.')
    names.add(entry.name)
    sizes.set(entry.name, entry.originalSize)
    if (entry.compression === 0 && entry.size !== entry.originalSize) throw new Error('Архив повреждён.')
    total += entry.originalSize
    if (entry.originalSize > 20 * 1024 * 1024 || total > MAX_CONTENT) throw new Error('Архив слишком велик.')
    return true
  } })
  for (const [name, bytes] of Object.entries(files)) {
    if (bytes.length !== sizes.get(name)) throw new Error('Архив повреждён.')
  }
  let manifest: { version?: unknown; sessions?: unknown; images?: Record<string, string> }
  try { manifest = JSON.parse(strFromU8(files['manifest.json'])) } catch { throw new Error('Не удалось прочитать описание архива.') }
  if (!manifest || manifest.version !== 1 || !isValidChatSessions(manifest.sessions)) throw new Error('Неверный формат истории чатов.')
  const sessions = manifest.sessions as ArchiveSession[]
  const expected = new Set(['manifest.json'])
  for (const [index, session] of sessions.entries()) {
    for (const image of imagePaths(session)) {
      const key = `images/${index}/${path.posix.basename(image)}`
      expected.add(key)
      if (!files[key]) throw new Error(`В архиве отсутствует изображение: ${image}`)
      if (!manifest.images || manifest.images[key] !== createHash('sha256').update(files[key]).digest('hex')) throw new Error(`Изображение повреждено: ${image}`)
    }
  }
  if ([...names].some(name => !expected.has(name))) throw new Error('Архив содержит лишние файлы.')
  const transaction = path.join(root, randomUUID())
  try {
    await fs.mkdir(transaction, { recursive: true })
    const restored: ArchiveSession[] = []
    for (const [index, session] of sessions.entries()) {
      const folderPath = path.join(transaction, String(index))
      await fs.mkdir(folderPath)
      for (const image of imagePaths(session)) {
        const key = `images/${index}/${path.posix.basename(image)}`
        const isImage = /\.(png|jpg|webp|gif)$/.test(image)
        const saved = isImage ? await saveImage(folderPath, path.posix.basename(image), files[key]) : await saveDocument(folderPath, path.posix.basename(image), files[key])
        await fs.rename(path.join(folderPath, saved.path), path.join(folderPath, image))
        // Ensure the saved file is valid and accessible through the normal reader.
        if (isImage) await readImage(folderPath, image)
        else await readDocumentBytes(folderPath, image)
      }
      restored.push({ ...session, folderPath })
    }
    return restored
  } catch (error) {
    await fs.rm(transaction, { recursive: true, force: true })
    throw error
  }
}
