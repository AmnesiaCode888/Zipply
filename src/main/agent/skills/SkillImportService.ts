import { createHash, randomUUID } from 'node:crypto'
import { constants } from 'node:fs'
import { lstat, mkdir, open, realpath, rename, rm } from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { Unzip, UnzipInflate, UnzipPassThrough } from 'fflate'
import type { SkillCatalogItem } from '../../../shared/extensionCatalog'
import { SkillRepository } from './SkillRepository'

const SKILL_FILE = 'SKILL.md'
const PROVENANCE_FILE = '.zipply-install.json'
const MAX_SKILL_BYTES = 1024 * 1024
const MAX_SUPPORT_FILE_BYTES = 2 * 1024 * 1024
const MAX_ARCHIVE_BYTES = 10 * 1024 * 1024
const MAX_ARCHIVE_OUTPUT_BYTES = 10 * 1024 * 1024
const MAX_ARCHIVE_ENTRIES = 256
const MAX_ARCHIVE_PATH_LENGTH = 1024
const EOCD_SIGNATURE = 0x06054b50
const CENTRAL_SIGNATURE = 0x02014b50
const LOCAL_SIGNATURE = 0x04034b50

interface ZipEntry {
  name: string
  compressedSize: number
  originalSize: number
  checksum: number
  localOffset: number
  compression: number
}

function invalidArchive(message: string): Error {
  return Object.assign(new Error(message), { code: 'INVALID_SKILL_ARCHIVE' })
}

function decodeUtf8(bytes: Uint8Array): string {
  try { return new TextDecoder('utf-8', { fatal: true }).decode(bytes) }
  catch { throw new Error('SKILL.md должен быть корректным UTF-8.') }
}

const CRC32_TABLE = Uint32Array.from({ length: 256 }, (_, index) => {
  let value = index
  for (let bit = 0; bit < 8; bit++) value = (value >>> 1) ^ ((value & 1) ? 0xedb88320 : 0)
  return value >>> 0
})

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff
  for (const byte of bytes) crc = (crc >>> 8) ^ CRC32_TABLE[(crc ^ byte) & 0xff]
  return (crc ^ 0xffffffff) >>> 0
}

function validateArchivePath(name: string): void {
  if (!name || name.length > MAX_ARCHIVE_PATH_LENGTH || name.includes('\0') || /[\u0000-\u001f\u007f]/.test(name) || name.includes('\\') ||
    name.startsWith('/') || /^[a-zA-Z]:/.test(name)) throw invalidArchive('В ZIP обнаружен недопустимый путь.')
  const segments = name.split('/')
  if (segments.some((segment, index) => segment === '..' || segment === '.' || (!segment && index !== segments.length - 1) ||
    /[:*?"<>|]/.test(segment) || /[. ]$/.test(segment) || segment.length > 255 ||
    /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/i.test(segment))) {
    throw invalidArchive('В ZIP обнаружен путь вне архива.')
  }
}

function inspectZip(bytes: Uint8Array): ZipEntry[] {
  if (bytes.length > MAX_ARCHIVE_BYTES) throw invalidArchive('ZIP превышает допустимый размер.')
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const minEocd = Math.max(0, bytes.length - 22 - 0xffff)
  let eocd = -1
  for (let offset = bytes.length - 22; offset >= minEocd; offset--) {
    if (view.getUint32(offset, true) !== EOCD_SIGNATURE) continue
    const commentLength = view.getUint16(offset + 20, true)
    if (offset + 22 + commentLength === bytes.length) { eocd = offset; break }
  }
  if (eocd < 0) throw invalidArchive('ZIP имеет повреждённый или неподдерживаемый каталог.')

  const disk = view.getUint16(eocd + 4, true)
  const centralDisk = view.getUint16(eocd + 6, true)
  const entriesOnDisk = view.getUint16(eocd + 8, true)
  const entryCount = view.getUint16(eocd + 10, true)
  const centralSize = view.getUint32(eocd + 12, true)
  const centralOffset = view.getUint32(eocd + 16, true)
  if (disk !== 0 || centralDisk !== 0 || entriesOnDisk !== entryCount ||
    entryCount === 0xffff || centralSize === 0xffffffff || centralOffset === 0xffffffff ||
    entryCount > MAX_ARCHIVE_ENTRIES || centralOffset + centralSize !== eocd) {
    throw invalidArchive('ZIP использует многотомный, ZIP64 или неподдерживаемый формат.')
  }

  const entries: ZipEntry[] = []
  const entryKinds = new Map<string, 'file' | 'directory'>()
  let cursor = centralOffset
  let totalUncompressed = 0
  for (let index = 0; index < entryCount; index++) {
    if (cursor + 46 > eocd || view.getUint32(cursor, true) !== CENTRAL_SIGNATURE) throw invalidArchive('В ZIP повреждён каталог файлов.')
    const versionMadeBy = view.getUint16(cursor + 4, true)
    const flags = view.getUint16(cursor + 8, true)
    const compression = view.getUint16(cursor + 10, true)
    const checksum = view.getUint32(cursor + 16, true)
    const compressedSize = view.getUint32(cursor + 20, true)
    const originalSize = view.getUint32(cursor + 24, true)
    const nameLength = view.getUint16(cursor + 28, true)
    const extraLength = view.getUint16(cursor + 30, true)
    const commentLength = view.getUint16(cursor + 32, true)
    const externalAttributes = view.getUint32(cursor + 38, true)
    const localOffset = view.getUint32(cursor + 42, true)
    const recordEnd = cursor + 46 + nameLength + extraLength + commentLength
    if (recordEnd > eocd || (flags & 1) !== 0 || compressedSize === 0xffffffff || originalSize === 0xffffffff || localOffset === 0xffffffff) {
      throw invalidArchive('ZIP содержит зашифрованный или ZIP64-файл.')
    }
    const name = decodeUtf8(bytes.subarray(cursor + 46, cursor + 46 + nameLength))
    validateArchivePath(name)

    const directory = name.endsWith('/')
    const normalizedName = directory ? name.slice(0, -1) : name
    if (!normalizedName) throw invalidArchive('В ZIP обнаружен недопустимый путь.')
    if (entryKinds.has(normalizedName)) throw invalidArchive('В ZIP повторяется путь файла или каталога.')
    const kind = directory ? 'directory' : 'file'
    for (let parent = path.posix.dirname(normalizedName); parent !== '.'; parent = path.posix.dirname(parent)) {
      if (entryKinds.get(parent) === 'file') throw invalidArchive('Пути в ZIP конфликтуют между файлом и каталогом.')
    }
    if (kind === 'file' && [...entryKinds.keys()].some(existing => existing.startsWith(`${normalizedName}/`))) {
      throw invalidArchive('Пути в ZIP конфликтуют между файлом и каталогом.')
    }
    entryKinds.set(normalizedName, kind)

    const creatorOs = versionMadeBy >>> 8
    const unixType = (externalAttributes >>> 16) & 0xf000
    if (unixType === 0xa000 || (creatorOs === 3 && unixType !== 0 && unixType !== 0x8000 && unixType !== 0x4000)) {
      throw invalidArchive('В ZIP запрещены символьные ссылки и специальные файлы.')
    }
    if (directory && originalSize !== 0) throw invalidArchive('Каталог ZIP не должен содержать данные.')
    if (creatorOs === 3 && ((unixType === 0x4000) !== directory)) {
      throw invalidArchive('Тип объекта в ZIP не совпадает с его путём.')
    }
    totalUncompressed += originalSize
    if (!Number.isSafeInteger(totalUncompressed) || totalUncompressed > MAX_ARCHIVE_OUTPUT_BYTES) {
      throw invalidArchive('Распакованный размер ZIP превышает допустимый лимит.')
    }
    if (compressedSize > MAX_ARCHIVE_BYTES || localOffset + 30 > centralOffset || view.getUint32(localOffset, true) !== LOCAL_SIGNATURE) {
      throw invalidArchive('В ZIP обнаружена некорректная запись файла.')
    }
    const localFlags = view.getUint16(localOffset + 6, true)
    const localCompression = view.getUint16(localOffset + 8, true)
    const localNameLength = view.getUint16(localOffset + 26, true)
    const localExtraLength = view.getUint16(localOffset + 28, true)
    const localNameStart = localOffset + 30
    const dataStart = localNameStart + localNameLength + localExtraLength
    const localName = decodeUtf8(bytes.subarray(localNameStart, localNameStart + localNameLength))
    if (localFlags !== flags || (localFlags & (1 | 0x40)) !== 0 || localCompression !== compression || localName !== name || dataStart + compressedSize > centralOffset) {
      throw invalidArchive('Запись ZIP не совпадает с каталогом.')
    }

    if (!directory) entries.push({ name, compressedSize, originalSize, checksum, localOffset, compression })
    cursor = recordEnd
  }
  if (cursor !== eocd) throw invalidArchive('Размер каталога ZIP не совпадает с его содержимым.')
  return entries
}

async function readRegularFile(filePath: string, maxBytes: number): Promise<Buffer> {
  const before = await lstat(filePath)
  if (!before.isFile() || before.isSymbolicLink() || before.size > maxBytes) throw new Error('Выбранный файл не является обычным файлом допустимого размера.')
  const canonical = await realpath(filePath)
  const handle = await open(canonical, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0))
  try {
    const opened = await handle.stat()
    if (!opened.isFile() || opened.dev !== before.dev || opened.ino !== before.ino || await realpath(filePath) !== canonical) {
      throw new Error('Файл изменился во время импорта.')
    }
    if (opened.size > maxBytes) throw new Error('Выбранный файл превышает допустимый размер.')
    const chunks: Buffer[] = []
    let total = 0
    let position = 0
    const buffer = Buffer.allocUnsafe(64 * 1024)
    while (true) {
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, position)
      if (bytesRead === 0) break
      total += bytesRead
      if (total > maxBytes) throw new Error('Выбранный файл превышает допустимый размер.')
      chunks.push(Buffer.from(buffer.subarray(0, bytesRead)))
      position += bytesRead
    }
    const after = await handle.stat()
    if (after.size > maxBytes || after.size !== total || after.mtimeMs !== opened.mtimeMs) throw new Error('Файл изменился во время импорта.')
    return Buffer.concat(chunks, total)
  } finally { await handle.close() }
}

async function atomicWriteSkillMetadata(directory: string, content: Uint8Array): Promise<void> {
  const target = path.join(directory, PROVENANCE_FILE)
  try {
    const existing = await lstat(target)
    if (!existing.isFile() || existing.isSymbolicLink() || existing.size > 64 * 1024) {
      throw new Error('Служебный файл происхождения навыка занят небезопасным объектом.')
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }
  const temporary = path.join(directory, `${PROVENANCE_FILE}.${randomUUID()}.tmp`)
  try {
    const handle = await open(temporary, 'wx', 0o600)
    try { await handle.writeFile(content); await handle.sync() } finally { await handle.close() }
    await rename(temporary, target)
  } finally { await rm(temporary, { force: true }).catch(() => {}) }
}

async function unzipSelectedFiles(bytes: Uint8Array, selected: readonly ZipEntry[]): Promise<Map<string, Buffer>> {
  if (!selected.length) throw invalidArchive('Архив не содержит файлов выбранного навыка.')
  if (selected.length > MAX_ARCHIVE_ENTRIES) throw invalidArchive('В выбранном навыке слишком много файлов.')
  for (const entry of selected) {
    const maxBytes = entry.name.endsWith(`/${SKILL_FILE}`) || entry.name === SKILL_FILE
      ? MAX_SKILL_BYTES
      : MAX_SUPPORT_FILE_BYTES
    if (entry.originalSize > maxBytes || entry.compressedSize > MAX_ARCHIVE_BYTES) {
      throw invalidArchive(`Файл ${entry.name} превышает допустимый размер.`)
    }
    if (entry.compression !== 0 && entry.compression !== 8) {
      throw invalidArchive(`Файл ${entry.name} использует неподдерживаемое сжатие.`)
    }
  }

  return new Promise((resolve, reject) => {
    let settled = false
    let totalSize = 0
    const selectedByName = new Map<string, ZipEntry>(selected.map(entry => [entry.name, entry] as const))
    const output = new Map<string, Buffer>()
    const finishError = (error: Error): void => {
      if (settled) return
      settled = true
      reject(error)
    }
    const finishIfComplete = (): void => {
      if (settled || output.size !== selectedByName.size) return
      settled = true
      resolve(output)
    }
    const unzip = new Unzip(file => {
      const entry = selectedByName.get(file.name)
      if (!entry) return
      if (output.has(file.name) || (file.originalSize !== undefined && file.originalSize !== entry.originalSize)) {
        void file.terminate()
        finishError(invalidArchive('ZIP содержит повторный или несогласованный файл навыка.'))
        return
      }
      let size = 0
      const chunks: Buffer[] = []
      const maxBytes = file.name.endsWith(`/${SKILL_FILE}`) || file.name === SKILL_FILE
        ? MAX_SKILL_BYTES
        : MAX_SUPPORT_FILE_BYTES
      file.ondata = (error, chunk, final) => {
        if (error) { finishError(invalidArchive(`Не удалось распаковать файл ${file.name} из ZIP.`)); return }
        size += chunk.length
        totalSize += chunk.length
        if (size > maxBytes || totalSize > MAX_ARCHIVE_OUTPUT_BYTES) {
          void file.terminate()
          finishError(invalidArchive('Распакованные файлы навыка превышают допустимый размер.'))
          return
        }
        chunks.push(Buffer.from(chunk))
        if (final) {
          const contents = Buffer.concat(chunks, size)
          if (size !== entry.originalSize || crc32(contents) !== entry.checksum) {
            finishError(invalidArchive(`Размер или контрольная сумма файла ${file.name} не совпадает с каталогом ZIP.`))
            return
          }
          output.set(file.name, contents)
          finishIfComplete()
        }
      }
      file.start()
    })
    unzip.register(UnzipInflate)
    unzip.register(UnzipPassThrough)
    try {
      unzip.push(bytes, true)
      if (!settled && output.size !== selectedByName.size) {
        finishError(invalidArchive('Не удалось полностью распаковать выбранный навык из ZIP.'))
      }
    } catch {
      finishError(invalidArchive('ZIP повреждён или использует неподдерживаемое сжатие.'))
    }
  })
}

function skillFolderName(name: string, files: ReadonlyMap<string, Uint8Array>): string {
  if (/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name)) return name
  const hash = createHash('sha256')
  for (const [relativePath, bytes] of [...files.entries()].sort(([left], [right]) => left.localeCompare(right))) {
    hash.update(`${relativePath.length}:`).update(relativePath).update(`${bytes.byteLength}:`).update(bytes)
  }
  const digest = hash.digest('hex').slice(0, 16)
  const slug = name.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48) || 'skill'
  return `${slug}-${digest}`
}

function isInside(parent: string, target: string): boolean {
  const relative = path.relative(parent, target)
  return Boolean(relative) && relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative)
}

function validateSkillPackagePath(relativePath: string): void {
  if (!relativePath || relativePath.length > MAX_ARCHIVE_PATH_LENGTH || relativePath.includes('\\') ||
      /[\u0000-\u001f\u007f]/.test(relativePath) || relativePath.startsWith('/') || /^[a-zA-Z]:/.test(relativePath)) {
    throw invalidArchive('В пакете навыка обнаружен недопустимый относительный путь.')
  }
  const segments = relativePath.split('/')
  if (segments.some(segment => !segment || segment === '.' || segment === '..' || /[:*?"<>|]/.test(segment) ||
      /[. ]$/.test(segment) || segment.length > 255 || /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/i.test(segment))) {
    throw invalidArchive('В пакете навыка обнаружен недопустимый относительный путь.')
  }
}

export class SkillImportService {
  private readonly userDataPath: string
  private readonly boundaryPath: string
  private readonly skillsPath: string

  constructor(userDataPath: string, skillsPath = path.join(userDataPath, 'skills')) {
    if (!path.isAbsolute(userDataPath)) throw new Error('Путь userData должен быть абсолютным.')
    this.userDataPath = path.resolve(userDataPath)
    if (!path.isAbsolute(skillsPath)) throw new Error('Путь к библиотеке навыков должен быть абсолютным.')
    this.skillsPath = path.resolve(skillsPath)
    if (isInside(this.userDataPath, this.skillsPath)) this.boundaryPath = this.userDataPath
    else {
      const homePath = path.resolve(os.homedir())
      if (!isInside(homePath, this.skillsPath)) throw new Error('Библиотека навыков должна находиться в userData или домашнем каталоге пользователя.')
      this.boundaryPath = homePath
    }
  }

  async importFile(filePath: string): Promise<SkillCatalogItem> {
    if (typeof filePath !== 'string' || !path.isAbsolute(filePath) || filePath.length > 4096) throw new Error('Укажите абсолютный путь к SKILL.md или ZIP-архиву.')
    const extension = path.extname(filePath).toLowerCase()
    let files: Map<string, Uint8Array>
    if (path.basename(filePath) === SKILL_FILE) {
      const content = await readRegularFile(filePath, MAX_SKILL_BYTES)
      files = new Map([[SKILL_FILE, content]])
    } else if (extension === '.zip') {
      const archive = await readRegularFile(filePath, MAX_ARCHIVE_BYTES)
      const entries = inspectZip(archive)
      const candidates = entries.filter(entry => path.posix.basename(entry.name) === SKILL_FILE)
      if (candidates.length !== 1) throw invalidArchive('ZIP должен содержать ровно один файл SKILL.md.')
      const skillDirectory = path.posix.dirname(candidates[0].name)
      const prefix = skillDirectory === '.' ? '' : `${skillDirectory}/`
      const selectedEntries = entries.filter(entry => entry.name.startsWith(prefix))
      const unpacked = await unzipSelectedFiles(archive, selectedEntries)
      files = new Map()
      for (const [archivePath, content] of unpacked) {
        const relativePath = archivePath.slice(prefix.length)
        validateSkillPackagePath(relativePath)
        files.set(relativePath, content)
      }
    } else {
      throw new Error('Можно импортировать только файл SKILL.md или ZIP-архив навыка.')
    }
    return this.importPackage([...files].map(([relativePath, content]) => ({ path: relativePath, content })))
  }

  /** Installs a validated, complete Agent Skill directory without executing package files. */
  async importPackage(
    files: readonly { path: string; content: Uint8Array }[],
    provenance?: { catalog: 'skills.sh'; slug: string; repository: string; commit: string }
  ): Promise<SkillCatalogItem> {
    if (!Array.isArray(files) || files.length === 0 || files.length > MAX_ARCHIVE_ENTRIES) {
      throw invalidArchive('Пакет навыка должен содержать от 1 до 256 файлов.')
    }
    const packageFiles = new Map<string, Uint8Array>()
    let totalBytes = 0
    for (const file of files) {
      if (!file || typeof file !== 'object' || typeof file.path !== 'string' || !(file.content instanceof Uint8Array)) {
        throw invalidArchive('Некорректная запись файла в пакете навыка.')
      }
      validateSkillPackagePath(file.path)
      if (packageFiles.has(file.path)) throw invalidArchive('В пакете навыка повторяется путь файла.')
      const maxBytes = file.path === SKILL_FILE ? MAX_SKILL_BYTES : MAX_SUPPORT_FILE_BYTES
      if (file.content.byteLength > maxBytes) throw invalidArchive(`Файл ${file.path} превышает допустимый размер.`)
      totalBytes += file.content.byteLength
      if (!Number.isSafeInteger(totalBytes) || totalBytes > MAX_ARCHIVE_OUTPUT_BYTES) {
        throw invalidArchive('Размер пакета навыка превышает допустимый лимит.')
      }
      packageFiles.set(file.path, Buffer.from(file.content))
    }
    const skillMarkdown = packageFiles.get(SKILL_FILE)
    if (!skillMarkdown) throw invalidArchive('В пакете навыка должен быть ровно один корневой SKILL.md.')
    decodeUtf8(skillMarkdown)
    if (!skillMarkdown.length) throw new Error('SKILL.md пустой или превышает допустимый размер.')
    const provenanceParts = provenance?.slug.split('/') ?? []
    if (provenance && (provenance.catalog !== 'skills.sh' || provenanceParts.length < 3 || provenanceParts.length > 12 ||
        provenanceParts.some(part => !/^[A-Za-z0-9._-]{1,100}$/.test(part) || part === '.' || part === '..') ||
        !/^[A-Za-z0-9-]{1,39}\/[A-Za-z0-9._-]{1,100}$/.test(provenance.repository) ||
        provenanceParts.slice(0, 2).join('/').toLowerCase() !== provenance.repository.toLowerCase() ||
        !/^[a-f0-9]{40,64}$/i.test(provenance.commit))) {
      throw invalidArchive('Некорректные данные источника пакета навыка.')
    }
    if (packageFiles.has(PROVENANCE_FILE)) throw invalidArchive('Путь служебных метаданных зарезервирован приложением.')
    return this.install(packageFiles, provenance)
  }

  private async install(
    files: ReadonlyMap<string, Uint8Array>,
    provenance?: { catalog: 'skills.sh'; slug: string; repository: string; commit: string }
  ): Promise<SkillCatalogItem> {
    if (files.size === 0 || files.size > MAX_ARCHIVE_ENTRIES || !files.has(SKILL_FILE)) {
      throw invalidArchive('Пакет навыка не содержит допустимого SKILL.md.')
    }
    let totalBytes = 0
    for (const [relativePath, content] of files) {
      validateSkillPackagePath(relativePath)
      const maxBytes = relativePath === SKILL_FILE ? MAX_SKILL_BYTES : MAX_SUPPORT_FILE_BYTES
      if (content.byteLength > maxBytes) throw invalidArchive(`Файл ${relativePath} превышает допустимый размер.`)
      totalBytes += content.byteLength
      if (!Number.isSafeInteger(totalBytes) || totalBytes > MAX_ARCHIVE_OUTPUT_BYTES) {
        throw invalidArchive('Размер пакета навыка превышает допустимый лимит.')
      }
    }
    const content = files.get(SKILL_FILE)!
    const provenanceBytes = provenance ? Buffer.from(`${JSON.stringify({
      version: 1,
      catalog: provenance.catalog,
      slug: provenance.slug,
      repository: provenance.repository,
      commit: provenance.commit.toLowerCase(),
      installedAt: new Date().toISOString(),
      files: [...files].map(([relativePath, bytes]) => ({ path: relativePath, sha256: createHash('sha256').update(bytes).digest('hex') }))
    }, null, 2)}\n`, 'utf8') : undefined
    const canonicalBoundary = await realpath(this.boundaryPath)
    const relativeSkillsPath = path.relative(this.boundaryPath, this.skillsPath)
    if (!relativeSkillsPath || relativeSkillsPath === '..' || relativeSkillsPath.startsWith(`..${path.sep}`) || path.isAbsolute(relativeSkillsPath)) {
      throw new Error('Каталог навыков должен быть отдельной папкой внутри разрешённой области.')
    }
    let canonicalSkillsPath = canonicalBoundary
    for (const segment of relativeSkillsPath.split(path.sep)) {
      if (!segment || segment === '.' || segment === '..') throw new Error('Недопустимый путь библиотеки навыков.')
      const nextPath = path.join(canonicalSkillsPath, segment)
      try { await mkdir(nextPath, { mode: 0o700 }) } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
      }
      const info = await lstat(nextPath)
      if (!info.isDirectory() || info.isSymbolicLink()) throw new Error('Каталог навыков не может проходить через ссылку или специальный объект.')
      const resolved = await realpath(nextPath)
      if (!isInside(canonicalBoundary, resolved)) throw new Error('Каталог навыков находится вне разрешённой области.')
      canonicalSkillsPath = resolved
    }

    const stagePath = path.join(canonicalSkillsPath, `.skill-import-${randomUUID()}`)
    const candidatePath = path.join(stagePath, 'candidate')
    if (!isInside(canonicalSkillsPath, stagePath)) throw new Error('Недопустимый путь импорта навыка.')
    try {
      await mkdir(candidatePath, { recursive: true, mode: 0o700 })
      for (const [relativePath, bytes] of files) {
        const segments = relativePath.split('/')
        const targetPath = path.join(candidatePath, ...segments)
        if (!isInside(candidatePath, targetPath)) throw invalidArchive('Путь файла выходит за пределы каталога навыка.')
        await mkdir(path.dirname(targetPath), { recursive: true, mode: 0o700 })
        const file = await open(targetPath, 'wx', 0o600)
        try { await file.writeFile(bytes); await file.sync() } finally { await file.close() }
      }
      if (provenanceBytes) await atomicWriteSkillMetadata(candidatePath, provenanceBytes)

      const stagingRepository = new SkillRepository([{ path: stagePath, scope: 'user', source: 'zipply' }])
      const candidates = await stagingRepository.discover()
      if (candidates.length !== 1) throw new Error('SKILL.md содержит некорректные YAML-метаданные.')
      const stagingSkill = candidates[0]
      const folderName = skillFolderName(stagingSkill.name, files)
      if ((await lstat(this.skillsPath)).isSymbolicLink()) throw new Error('Каталог навыков не может быть символьной ссылкой.')
      const currentBoundary = await realpath(this.boundaryPath)
      const currentSkillsPath = await realpath(this.skillsPath)
      if (currentBoundary !== canonicalBoundary || currentSkillsPath !== canonicalSkillsPath || !isInside(canonicalBoundary, currentSkillsPath)) {
        throw new Error('Каталог навыков изменился во время импорта.')
      }
      const target = path.join(canonicalSkillsPath, folderName)
      if (!isInside(canonicalSkillsPath, target)) throw new Error('Недопустимое имя навыка.')

      let reusedExistingSkill = false
      try {
        const existingStat = await lstat(target)
        if (!existingStat.isDirectory() || existingStat.isSymbolicLink()) throw new Error('Путь целевого навыка занят небезопасным объектом.')
        const existing = await readRegularFile(path.join(target, SKILL_FILE), MAX_SKILL_BYTES)
        if (!existing.equals(Buffer.from(content))) throw new Error('Импортированный навык уже существует с другим содержимым.')
        for (const [relativePath, bytes] of files) {
          const installedPath = path.join(target, ...relativePath.split('/'))
          const installedBytes = await readRegularFile(installedPath, relativePath === SKILL_FILE ? MAX_SKILL_BYTES : MAX_SUPPORT_FILE_BYTES)
          if (!installedBytes.equals(Buffer.from(bytes))) throw new Error('Импортированный навык уже существует с другим содержимым.')
        }
        reusedExistingSkill = true
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
        await rename(candidatePath, target)
      }
      if (reusedExistingSkill && provenanceBytes) await atomicWriteSkillMetadata(target, provenanceBytes)

      const installed = await new SkillRepository([{ path: canonicalSkillsPath, scope: 'user', source: 'zipply' }]).discover()
      const bodyPath = path.join(target, SKILL_FILE)
      const descriptor = installed.find(skill => skill.bodyPath === bodyPath)
      if (!descriptor) throw new Error('Импортированный навык не прошёл повторную проверку.')
      const { bodyPath: _bodyPath, metadata: _metadata, ...safe } = descriptor
      return safe
    } finally {
      const stageAbsolute = path.resolve(stagePath)
      if (isInside(canonicalSkillsPath, stageAbsolute)) await rm(stageAbsolute, { recursive: true, force: true }).catch(() => {})
    }
  }
}
