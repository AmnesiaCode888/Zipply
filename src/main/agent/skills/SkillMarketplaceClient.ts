export interface MarketplaceSkill {
  slug: string
  name: string
  source: string
  installs: number
}

export interface DownloadedSkillPackage {
  skill: MarketplaceSkill
  commit: string
  files: Array<{ path: string; content: Uint8Array }>
}

/** Catalog/source boundary so another verified skills registry can be added without changing tool behavior. */
export interface SkillSourceProvider {
  search(query: string, signal?: AbortSignal): Promise<MarketplaceSkill[]>
  download(slug: string, signal?: AbortSignal): Promise<DownloadedSkillPackage>
}

interface SkillMarketplaceClientOptions {
  searchUrl?: string
  githubApiUrl?: string
  timeoutMs?: number
  cacheTtlMs?: number
  maxSearchBytes?: number
  maxTreeBytes?: number
  maxFileBytes?: number
  maxPackageBytes?: number
  maxFiles?: number
}

interface CacheEntry {
  expiresAt: number
  skill: MarketplaceSkill
}

interface GitTreeEntry {
  path: string
  mode: string
  type: string
  size?: number
}

const DEFAULT_SEARCH_URL = 'https://skills.sh/api/search'
const DEFAULT_GITHUB_API_URL = 'https://api.github.com'
const MAX_QUERY_LENGTH = 120
const MAX_RESULTS = 25
const MAX_TREE_ENTRIES = 20_000
const MAX_SKILL_BYTES = 1024 * 1024
const MAX_SUPPORT_FILE_BYTES = 2 * 1024 * 1024
const MAX_PACKAGE_BYTES = 10 * 1024 * 1024
const MAX_FILES = 128
const RESERVED_WINDOWS_NAME = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/i

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function validText(value: unknown, max: number): value is string {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= max &&
    !/[\u0000-\u001f\u007f]/.test(value)
}

function parseSource(value: unknown): { owner: string; repo: string; source: string } | undefined {
  if (!validText(value, 220)) return undefined
  const match = /^([A-Za-z0-9](?:[A-Za-z0-9-]{0,38}))\/([A-Za-z0-9._-]{1,100})$/.exec(value.trim())
  if (!match || match[2] === '.' || match[2] === '..') return undefined
  return { owner: match[1], repo: match[2], source: `${match[1]}/${match[2]}` }
}

function parseMarketplaceSkill(value: unknown): MarketplaceSkill | undefined {
  if (!isRecord(value) || !validText(value.id, 300) || !validText(value.name, 100)) return undefined
  const source = parseSource(value.source)
  if (!source || !Number.isSafeInteger(value.installs) || (value.installs as number) < 0) return undefined
  const slugParts = value.id.trim().split('/')
  if (slugParts.length < 3 || slugParts.length > 12 ||
      slugParts[0].toLowerCase() !== source.owner.toLowerCase() || slugParts[1].toLowerCase() !== source.repo.toLowerCase() ||
      slugParts.slice(2).some(part => !/^[a-zA-Z0-9._-]{1,100}$/.test(part) || part === '.' || part === '..')) return undefined
  return {
    slug: slugParts.join('/'),
    name: value.name.trim(),
    source: source.source,
    installs: value.installs as number
  }
}

function isAbortError(signal?: AbortSignal): Error {
  return signal?.reason instanceof Error ? signal.reason : new DOMException('The operation was aborted', 'AbortError')
}

async function readBoundedBytes(response: Response, maxBytes: number): Promise<Uint8Array> {
  const length = Number(response.headers.get('content-length') ?? 0)
  if (Number.isFinite(length) && length > maxBytes) throw new Error('Ответ источника навыка превышает допустимый размер.')
  if (!response.body) {
    const bytes = new Uint8Array(await response.arrayBuffer())
    if (bytes.byteLength > maxBytes) throw new Error('Ответ источника навыка превышает допустимый размер.')
    return bytes
  }
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      total += value.byteLength
      if (total > maxBytes) {
        await reader.cancel().catch(() => {})
        throw new Error('Ответ источника навыка превышает допустимый размер.')
      }
      chunks.push(value)
    }
  } finally {
    reader.releaseLock()
  }
  const output = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) { output.set(chunk, offset); offset += chunk.byteLength }
  return output
}

function validateRelativePath(value: string): void {
  if (!value || value.length > 1024 || value.startsWith('/') || value.includes('\\') || /[\u0000-\u001f\u007f]/.test(value)) {
    throw new Error('Источник навыка содержит недопустимый путь.')
  }
  const segments = value.split('/')
  if (segments.some(segment => !segment || segment === '.' || segment === '..' || /[:*?"<>|]/.test(segment) ||
      segment.length > 255 || /[. ]$/.test(segment) || RESERVED_WINDOWS_NAME.test(segment))) {
    throw new Error('Источник навыка содержит недопустимый путь.')
  }
}

function normalizedName(value: string): string {
  return value.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
}

function parseTreeEntries(value: unknown): GitTreeEntry[] {
  if (!isRecord(value) || value.truncated === true || !Array.isArray(value.tree) || value.tree.length > MAX_TREE_ENTRIES) {
    throw new Error('GitHub вернул неполное или слишком большое дерево репозитория.')
  }
  const output: GitTreeEntry[] = []
  for (const entry of value.tree) {
    if (!isRecord(entry) || !validText(entry.path, 1024) || typeof entry.mode !== 'string' || typeof entry.type !== 'string') {
      throw new Error('GitHub вернул некорректную запись дерева репозитория.')
    }
    output.push({ path: entry.path, mode: entry.mode, type: entry.type, ...(typeof entry.size === 'number' ? { size: entry.size } : {}) })
  }
  return output
}

/** Read-only discovery and bounded package download from skills.sh and public GitHub. */
export class SkillMarketplaceClient implements SkillSourceProvider {
  private readonly searchUrl: URL
  private readonly githubApiUrl: URL
  private readonly timeoutMs: number
  private readonly cacheTtlMs: number
  private readonly maxSearchBytes: number
  private readonly maxTreeBytes: number
  private readonly maxFileBytes: number
  private readonly maxPackageBytes: number
  private readonly maxFiles: number
  private readonly cache = new Map<string, CacheEntry>()
  private readonly searchCache = new Map<string, { expiresAt: number; skills: MarketplaceSkill[] }>()

  constructor(private readonly fetcher: typeof fetch = globalThis.fetch, options: SkillMarketplaceClientOptions = {}) {
    this.searchUrl = new URL(options.searchUrl ?? DEFAULT_SEARCH_URL)
    this.githubApiUrl = new URL(options.githubApiUrl ?? DEFAULT_GITHUB_API_URL)
    if (this.searchUrl.protocol !== 'https:' || this.searchUrl.hostname !== 'skills.sh' || this.searchUrl.pathname !== '/api/search' ||
        this.searchUrl.username || this.searchUrl.password || this.searchUrl.search || this.searchUrl.hash ||
        this.githubApiUrl.protocol !== 'https:' || this.githubApiUrl.hostname !== 'api.github.com' || this.githubApiUrl.pathname !== '/' ||
        this.githubApiUrl.username || this.githubApiUrl.password || this.githubApiUrl.search || this.githubApiUrl.hash) {
      throw new Error('Skill marketplace endpoints must use the fixed HTTPS hosts.')
    }
    this.timeoutMs = Number.isFinite(options.timeoutMs) ? Math.min(Math.max(options.timeoutMs!, 500), 30_000) : 8_000
    this.cacheTtlMs = Number.isFinite(options.cacheTtlMs) ? Math.min(Math.max(options.cacheTtlMs!, 0), 60 * 60_000) : 5 * 60_000
    this.maxSearchBytes = Number.isFinite(options.maxSearchBytes) ? Math.min(Math.max(options.maxSearchBytes!, 1024), 1024 * 1024) : 512 * 1024
    this.maxTreeBytes = Number.isFinite(options.maxTreeBytes) ? Math.min(Math.max(options.maxTreeBytes!, 1024), 8 * 1024 * 1024) : 4 * 1024 * 1024
    this.maxFileBytes = Number.isFinite(options.maxFileBytes) ? Math.min(Math.max(options.maxFileBytes!, MAX_SKILL_BYTES), MAX_SUPPORT_FILE_BYTES) : MAX_SUPPORT_FILE_BYTES
    this.maxPackageBytes = Number.isFinite(options.maxPackageBytes) ? Math.min(Math.max(options.maxPackageBytes!, MAX_SKILL_BYTES), MAX_PACKAGE_BYTES) : MAX_PACKAGE_BYTES
    this.maxFiles = Number.isFinite(options.maxFiles) ? Math.min(Math.max(Math.floor(options.maxFiles!), 1), MAX_FILES) : MAX_FILES
  }

  async search(query: string, signal?: AbortSignal): Promise<MarketplaceSkill[]> {
    if (!validText(query, MAX_QUERY_LENGTH) || query.trim().length < 2) throw new Error('Укажи запрос длиной от 2 до 120 символов.')
    signal?.throwIfAborted()
    const normalized = query.trim()
    const key = normalized.toLocaleLowerCase('en')
    const cached = this.searchCache.get(key)
    if (cached && cached.expiresAt > Date.now()) return structuredClone(cached.skills)

    const url = new URL(this.searchUrl)
    url.searchParams.set('q', normalized)
    const response = await this.request(url, { headers: { accept: 'application/json' } }, signal, this.maxSearchBytes)
    let parsed: unknown
    try { parsed = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(response.bytes)) }
    catch { throw new Error('Каталог навыков вернул некорректный JSON.') }
    if (!isRecord(parsed) || !Array.isArray(parsed.skills) || parsed.skills.length > 200) {
      throw new Error('Каталог навыков вернул неподдерживаемый формат.')
    }
    const skills = parsed.skills.map(parseMarketplaceSkill).filter((item): item is MarketplaceSkill => Boolean(item)).slice(0, MAX_RESULTS)
    for (const skill of skills) this.cache.set(skill.slug, { expiresAt: Date.now() + this.cacheTtlMs, skill })
    while (this.cache.size > 500) this.cache.delete(this.cache.keys().next().value as string)
    this.searchCache.set(key, { expiresAt: Date.now() + this.cacheTtlMs, skills: structuredClone(skills) })
    while (this.searchCache.size > 64) this.searchCache.delete(this.searchCache.keys().next().value as string)
    return skills
  }

  async download(slug: string, signal?: AbortSignal): Promise<DownloadedSkillPackage> {
    signal?.throwIfAborted()
    const cached = this.cache.get(slug)
    if (!cached || cached.expiresAt <= Date.now()) throw new Error('Сначала найди навык заново; выбранный результат каталога устарел.')
    const skill = cached.skill
    const parsedSource = parseSource(skill.source)
    if (!parsedSource) throw new Error('Источник навыка не является публичным GitHub-репозиторием.')
    const apiRoot = new URL(this.githubApiUrl)
    const repoUrl = new URL(`/repos/${encodeURIComponent(parsedSource.owner)}/${encodeURIComponent(parsedSource.repo)}`, apiRoot)
    const repo = await this.getJson(repoUrl, signal, 256 * 1024)
    if (!isRecord(repo) || repo.private === true || !validText(repo.default_branch, 255)) {
      throw new Error('Навык доступен только в публичном GitHub-репозитории или репозиторий не найден.')
    }
    const branch = repo.default_branch
    const branchUrl = new URL(`${repoUrl.pathname}/branches/${encodeURIComponent(branch)}`, apiRoot)
    const branchInfo = await this.getJson(branchUrl, signal, 256 * 1024)
    const branchCommit = isRecord(branchInfo) && isRecord(branchInfo.commit) ? branchInfo.commit : undefined
    const commit = branchCommit?.sha
    const commitDetails = branchCommit && isRecord(branchCommit.commit) ? branchCommit.commit : undefined
    const commitTree = commitDetails && isRecord(commitDetails.tree) ? commitDetails.tree.sha : undefined
    if (typeof commit !== 'string' || !/^[a-f0-9]{40,64}$/i.test(commit) ||
        typeof commitTree !== 'string' || !/^[a-f0-9]{40,64}$/i.test(commitTree)) {
      throw new Error('GitHub не вернул точную ревизию для установки навыка.')
    }

    const treeUrl = new URL(`${apiRoot.origin}/repos/${encodeURIComponent(parsedSource.owner)}/${encodeURIComponent(parsedSource.repo)}/git/trees/${commitTree}`)
    treeUrl.searchParams.set('recursive', '1')
    const treeInfo = await this.getJson(treeUrl, signal, this.maxTreeBytes)
    const tree = parseTreeEntries(treeInfo)
    const skillMdPaths = tree.filter(entry => entry.type === 'blob' && (entry.path.endsWith('/SKILL.md') || entry.path === 'SKILL.md'))
    for (const entry of skillMdPaths) validateRelativePath(entry.path)
    const slugParts = skill.slug.split('/')
    const targetParts = slugParts.slice(2)
    const targetTail = targetParts.join('/').toLocaleLowerCase('en')
    const targetName = normalizedName(skill.name)
    let matches = skillMdPaths.filter(entry => {
      const parent = entry.path === 'SKILL.md' ? '' : entry.path.slice(0, -'/SKILL.md'.length)
      const lower = parent.toLocaleLowerCase('en')
      return lower === targetTail || lower.endsWith(`/${targetTail}`) || normalizedName(parent.split('/').at(-1) ?? '') === targetName
    })
    if (matches.length !== 1 && targetParts.length > 1) {
      const directPath = `${targetParts.join('/')}/SKILL.md`.toLocaleLowerCase('en')
      matches = skillMdPaths.filter(entry => entry.path.toLocaleLowerCase('en') === directPath || entry.path.toLocaleLowerCase('en').endsWith(`/${directPath}`))
    }
    if (matches.length === 0 && skillMdPaths.length === 1 && skillMdPaths[0].path === 'SKILL.md') matches = [skillMdPaths[0]]
    if (matches.length !== 1) throw new Error(matches.length ? 'В репозитории несколько похожих skill-папок. Установка отменена из-за неоднозначного пути.' : 'В репозитории не найдена однозначная папка SKILL.md для выбранного навыка.')
    const skillRoot = matches[0].path === 'SKILL.md' ? '' : matches[0].path.slice(0, -'/SKILL.md'.length)
    const prefix = skillRoot ? `${skillRoot}/` : ''
    const selectedScope = tree.filter(entry => skillRoot ? entry.path.startsWith(prefix) : true)
    if (selectedScope.some(entry => entry.mode === '120000' || entry.mode === '160000' || entry.type === 'commit')) {
      throw new Error('В навыке запрещены символьные ссылки и подмодули.')
    }
    const selected = selectedScope.filter(entry => entry.type === 'blob').sort((left, right) => left.path.localeCompare(right.path))
    if (selected.length === 0 || selected.length > this.maxFiles) throw new Error('Папка навыка содержит слишком много или слишком мало файлов.')
    for (const entry of selected) {
      validateRelativePath(entry.path)
      const relative = skillRoot ? entry.path.slice(prefix.length) : entry.path
      validateRelativePath(relative)
      const maxBytes = relative === 'SKILL.md' ? MAX_SKILL_BYTES : this.maxFileBytes
      if (!Number.isSafeInteger(entry.size) || (entry.size ?? 0) < 0 || (entry.size ?? 0) > maxBytes) {
        throw new Error(`Файл ${relative} превышает допустимый размер.`)
      }
    }

    const files: Array<{ path: string; content: Uint8Array }> = []
    let totalBytes = 0
    let next = 0
    const workers = Array.from({ length: Math.min(4, selected.length) }, async () => {
      while (true) {
        signal?.throwIfAborted()
        const index = next++
        if (index >= selected.length) return
        const entry = selected[index]
        const relative = skillRoot ? entry.path.slice(prefix.length) : entry.path
        const rawUrl = new URL(`https://raw.githubusercontent.com/${encodeURIComponent(parsedSource.owner)}/${encodeURIComponent(parsedSource.repo)}/${commit}/${entry.path.split('/').map(encodeURIComponent).join('/')}`)
        const response = await this.request(rawUrl, { headers: { accept: 'application/octet-stream' } }, signal, this.maxFileBytes)
        if (entry.size !== undefined && response.bytes.byteLength !== entry.size) throw new Error(`Файл ${relative} изменился во время загрузки.`)
        totalBytes += response.bytes.byteLength
        if (totalBytes > this.maxPackageBytes) throw new Error('Размер навыка превышает допустимый лимит.')
        files[index] = { path: relative, content: response.bytes }
      }
    })
    await Promise.all(workers)
    signal?.throwIfAborted()
    return { skill: structuredClone(skill), commit, files }
  }

  private async getJson(url: URL, signal: AbortSignal | undefined, maxBytes: number): Promise<unknown> {
    const response = await this.request(url, { headers: { accept: 'application/vnd.github+json', 'x-github-api-version': '2022-11-28' } }, signal, maxBytes)
    try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(response.bytes)) }
    catch { throw new Error('GitHub вернул некорректный JSON.') }
  }

  private async request(url: URL, init: RequestInit, signal: AbortSignal | undefined, maxBytes: number): Promise<{ bytes: Uint8Array }> {
    if (url.protocol !== 'https:' || (url.hostname !== 'skills.sh' && url.hostname !== 'api.github.com' && url.hostname !== 'raw.githubusercontent.com')) {
      throw new Error('Источник навыка использует неподдерживаемый адрес.')
    }
    signal?.throwIfAborted()
    const controller = new AbortController()
    const abort = () => controller.abort(signal?.reason)
    signal?.addEventListener('abort', abort, { once: true })
    const timeout = setTimeout(() => controller.abort(new Error('Skill download timed out.')), this.timeoutMs)
    try {
      const response = await this.fetcher(url, {
        ...init,
        method: 'GET',
        redirect: 'error',
        signal: controller.signal,
        headers: { 'user-agent': 'Zipply-Skill-Installer', ...init.headers }
      })
      if (!response.ok) throw new Error(`Не удалось загрузить источник навыка (HTTP ${response.status}).`)
      return { bytes: await readBoundedBytes(response, maxBytes) }
    } catch (error) {
      if (signal?.aborted) throw isAbortError(signal)
      if (controller.signal.aborted) {
        if (controller.signal.reason instanceof Error && controller.signal.reason.message === 'Skill download timed out.') {
          throw new Error('Загрузка навыка превысила время ожидания.')
        }
        throw isAbortError(controller.signal)
      }
      throw error
    } finally {
      clearTimeout(timeout)
      signal?.removeEventListener('abort', abort)
    }
  }
}
