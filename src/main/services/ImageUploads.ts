import * as fs from 'fs/promises'
import * as path from 'path'
import { randomUUID } from 'crypto'

const MAX_IMAGE_BYTES = 20 * 1024 * 1024
const UPLOAD_PATTERN = /^\.zipply\/uploads\/[a-f0-9-]{36}\.(png|jpg|webp|gif)$/

function imageType(bytes: Buffer): { mime: string; extension: string } {
  if (bytes.length > MAX_IMAGE_BYTES || !bytes.length) throw new Error('Изображение должно быть не больше 20 МБ.')
  if (bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return { mime: 'image/png', extension: 'png' }
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return { mime: 'image/jpeg', extension: 'jpg' }
  if (bytes.subarray(0, 6).toString('ascii') === 'GIF87a' || bytes.subarray(0, 6).toString('ascii') === 'GIF89a') return { mime: 'image/gif', extension: 'gif' }
  if (bytes.subarray(0, 4).toString('ascii') === 'RIFF' && bytes.subarray(8, 12).toString('ascii') === 'WEBP') return { mime: 'image/webp', extension: 'webp' }
  throw new Error('Поддерживаются только изображения PNG, JPEG, GIF и WebP.')
}

async function uploadDirectory(workspace: string, create: boolean): Promise<string> {
  if (typeof workspace !== 'string' || !path.isAbsolute(workspace)) throw new Error('Рабочая папка не указана.')
  const root = await fs.realpath(workspace)
  const dir = path.join(root, '.zipply', 'uploads')
  if (create) {
    const parent = path.join(root, '.zipply')
    await fs.mkdir(parent, { recursive: true })
    const realParent = await fs.realpath(parent)
    if (path.dirname(realParent) !== root) throw new Error('Папка загрузок находится вне рабочей папки.')
    await fs.mkdir(path.join(realParent, 'uploads'), { recursive: true })
  }
  const realDir = await fs.realpath(dir)
  const relative = path.relative(root, realDir)
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('Папка загрузок находится вне рабочей папки.')
  return realDir
}

export async function saveImage(workspace: string, name: string, input: Uint8Array): Promise<{ name: string; path: string }> {
  if (!(input instanceof Uint8Array) || input.byteLength > MAX_IMAGE_BYTES) throw new Error('Изображение должно быть не больше 20 МБ.')
  const bytes = Buffer.from(input)
  const { extension } = imageType(bytes)
  const dir = await uploadDirectory(workspace, true)
  const filename = `${randomUUID()}.${extension}`
  await fs.writeFile(path.join(dir, filename), bytes, { flag: 'wx' })
  return { name: typeof name === 'string' ? name.split(/[\\/]/).pop()?.slice(0, 255) || filename : filename, path: `.zipply/uploads/${filename}` }
}

export async function readImage(workspace: string, relativePath: string): Promise<string> {
  if (typeof relativePath !== 'string' || !UPLOAD_PATTERN.test(relativePath)) throw new Error('Недопустимый путь к изображению.')
  const dir = await uploadDirectory(workspace, false)
  const target = path.join(dir, path.basename(relativePath))
  const realTarget = await fs.realpath(target)
  if (path.dirname(realTarget) !== dir) throw new Error('Изображение находится вне папки загрузок.')
  const stat = await fs.stat(realTarget)
  if (!stat.isFile() || stat.size > MAX_IMAGE_BYTES) throw new Error('Изображение должно быть не больше 20 МБ.')
  const bytes = await fs.readFile(realTarget)
  const { mime } = imageType(bytes)
  return `data:${mime};base64,${bytes.toString('base64')}`
}

// Project images are read only after resolving symlinks inside the workspace.
export async function readWorkspaceImage(workspace: string, relativePath: string): Promise<string> {
  if (typeof relativePath !== 'string' || !relativePath || path.isAbsolute(relativePath)) throw new Error('Недопустимый путь к изображению.')
  const root = await fs.realpath(workspace || process.cwd())
  const target = await fs.realpath(path.resolve(root, relativePath))
  const relative = path.relative(root, target)
  if (!relative || relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) throw new Error('Изображение находится вне рабочей папки.')
  const stat = await fs.stat(target)
  if (!stat.isFile() || stat.size > MAX_IMAGE_BYTES) throw new Error('Изображение должно быть не больше 20 МБ.')
  const bytes = await fs.readFile(target)
  const { mime } = imageType(bytes)
  return `data:${mime};base64,${bytes.toString('base64')}`
}
