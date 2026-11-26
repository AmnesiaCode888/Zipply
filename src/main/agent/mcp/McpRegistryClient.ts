export interface McpRegistryEntry {
  serverName: string
  title: string
  description: string
  version: string
  endpoint: string
  websiteUrl?: string
  repositoryUrl?: string
}

interface McpRegistryClientOptions {
  baseUrl?: string
  cacheTtlMs?: number
  timeoutMs?: number
  maxResponseBytes?: number
}

interface CachedSearch {
  expiresAt: number
  entries: McpRegistryEntry[]
}

const DEFAULT_BASE_URL = 'https://registry.modelcontextprotocol.io/v0.1/servers'
const MAX_QUERY_LENGTH = 120
const MAX_RESULTS = 20
const DEFAULT_MAX_RESPONSE_BYTES = 1024 * 1024

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function cleanText(value: unknown, maxLength: number): value is string {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= maxLength &&
    !/[\u0000-\u001f\u007f]/.test(value)
}

function validHttpsUrl(value: unknown): value is string {
  if (!cleanText(value, 2048) || /[{}]/.test(value)) return false
  try {
    const endpoint = new URL(value)
    return endpoint.protocol === 'https:' && !endpoint.username && !endpoint.password && !endpoint.hash
  } catch {
    return false
  }
}

function parseEntry(value: unknown): McpRegistryEntry | undefined {
  if (!isRecord(value)) return undefined
  const server = isRecord(value.server) ? value.server : value
  const status = value.status ?? server.status
  if (typeof status === 'string' && status.toLowerCase() !== 'active') return undefined
  if (!cleanText(server.name, 200) || !/^[a-zA-Z0-9.-]+\/[a-zA-Z0-9._-]+$/.test(server.name) ||
      !cleanText(server.version, 255) || !cleanText(server.description, 2000)) return undefined

  const remotes = Array.isArray(server.remotes) ? server.remotes : []
  const remote = remotes.find(candidate =>
    isRecord(candidate) && candidate.type === 'streamable-http' && validHttpsUrl(candidate.url))
  if (!isRecord(remote) || !validHttpsUrl(remote.url)) return undefined

  const title = cleanText(server.title, 160) ? server.title.trim() : server.name
  const websiteUrl = validHttpsUrl(server.websiteUrl) ? server.websiteUrl : undefined
  const repositoryUrl = isRecord(server.repository) && validHttpsUrl(server.repository.url) ? server.repository.url : undefined
  return {
    serverName: server.name,
    title,
    description: server.description.trim(),
    version: server.version,
    endpoint: remote.url,
    ...(websiteUrl ? { websiteUrl } : {}),
    ...(repositoryUrl ? { repositoryUrl } : {})
  }
}

function aborted(signal?: AbortSignal): Error {
  if (signal?.reason instanceof Error) return signal.reason
  return new DOMException('The operation was aborted', 'AbortError')
}

/** Read-only search and verification for the public MCP Registry. Registry metadata is untrusted. */
export class McpRegistryClient {
  private readonly baseUrl: URL
  private readonly cacheTtlMs: number
  private readonly timeoutMs: number
  private readonly maxResponseBytes: number
  private readonly cache = new Map<string, CachedSearch>()

  constructor(
    private readonly fetcher: typeof fetch = globalThis.fetch,
    options: McpRegistryClientOptions = {}
  ) {
    this.baseUrl = new URL(options.baseUrl ?? DEFAULT_BASE_URL)
    if (this.baseUrl.protocol !== 'https:') throw new Error('Registry endpoint must use HTTPS.')
    this.cacheTtlMs = Number.isFinite(options.cacheTtlMs) && options.cacheTtlMs! >= 0
      ? Math.min(options.cacheTtlMs!, 60 * 60 * 1000)
      : 10 * 60 * 1000
    this.timeoutMs = Number.isFinite(options.timeoutMs) && options.timeoutMs! > 0
      ? Math.min(options.timeoutMs!, 30_000)
      : 8_000
    this.maxResponseBytes = Number.isFinite(options.maxResponseBytes) && options.maxResponseBytes! > 0
      ? Math.min(options.maxResponseBytes!, DEFAULT_MAX_RESPONSE_BYTES)
      : DEFAULT_MAX_RESPONSE_BYTES
  }

  async search(query: string, signal?: AbortSignal): Promise<McpRegistryEntry[]> {
    const normalized = this.validateQuery(query)
    const key = normalized.toLocaleLowerCase('en')
    const cached = this.cache.get(key)
    if (cached && cached.expiresAt > Date.now()) return structuredClone(cached.entries)

    const entries = await this.fetchSearch(normalized, signal)
    this.cache.set(key, { expiresAt: Date.now() + this.cacheTtlMs, entries: structuredClone(entries) })
    while (this.cache.size > 64) this.cache.delete(this.cache.keys().next().value as string)
    return entries
  }

  getCached(serverName: string): McpRegistryEntry | undefined {
    const now = Date.now()
    for (const [key, item] of this.cache) {
      if (item.expiresAt <= now) { this.cache.delete(key); continue }
      const match = item.entries.find(entry => entry.serverName === serverName)
      if (match) return structuredClone(match)
    }
    return undefined
  }

  /** Rechecks registry data after approval and refuses to use a changed endpoint. */
  async resolve(serverName: string, expectedEndpoint: string, signal?: AbortSignal): Promise<McpRegistryEntry> {
    if (!cleanText(serverName, 200) || !cleanText(expectedEndpoint, 2048)) throw new Error('Некорректная запись каталога MCP.')
    const entries = await this.fetchSearch(serverName, signal)
    const current = entries.find(entry => entry.serverName === serverName)
    if (!current) throw new Error('Сервер больше не опубликован в MCP Registry или не поддерживает этот transport.')
    if (current.endpoint !== expectedEndpoint) {
      throw new Error('Адрес сервера в каталоге изменился после подтверждения. Найдите сервер заново и подтвердите новый адрес.')
    }
    return current
  }

  private validateQuery(query: string): string {
    if (!cleanText(query, MAX_QUERY_LENGTH) || query.trim().length < 2) {
      throw new Error('Для поиска в MCP Registry укажи не менее двух символов.')
    }
    return query.trim()
  }

  private async fetchSearch(query: string, signal?: AbortSignal): Promise<McpRegistryEntry[]> {
    signal?.throwIfAborted()
    const url = new URL(this.baseUrl)
    url.searchParams.set('search', query)
    url.searchParams.set('version', 'latest')
    url.searchParams.set('limit', String(MAX_RESULTS))

    const controller = new AbortController()
    const abort = () => controller.abort(signal?.reason)
    signal?.addEventListener('abort', abort, { once: true })
    const timeout = setTimeout(() => controller.abort(new Error('Registry request timed out.')), this.timeoutMs)
    try {
      const response = await this.fetcher(url, {
        method: 'GET',
        headers: { accept: 'application/json' },
        redirect: 'error',
        signal: controller.signal
      })
      if (!response.ok) throw new Error('MCP Registry вернул HTTP ' + response.status + '.')
      const contentLength = Number(response.headers.get('content-length') ?? 0)
      if (Number.isFinite(contentLength) && contentLength > this.maxResponseBytes) {
        throw new Error('Ответ MCP Registry превышает допустимый размер.')
      }
      const text = await response.text()
      if (Buffer.byteLength(text, 'utf8') > this.maxResponseBytes) throw new Error('Ответ MCP Registry превышает допустимый размер.')

      let parsed: unknown
      try { parsed = JSON.parse(text) } catch { throw new Error('MCP Registry вернул некорректный JSON.') }
      if (!isRecord(parsed) || !Array.isArray(parsed.servers) || parsed.servers.length > MAX_RESULTS) {
        throw new Error('MCP Registry вернул неподдерживаемый формат.')
      }
      return parsed.servers.map(parseEntry).filter((entry): entry is McpRegistryEntry => Boolean(entry)).slice(0, MAX_RESULTS)
    } catch (error) {
      if (signal?.aborted) throw aborted(signal)
      if (controller.signal.aborted) {
        if (controller.signal.reason instanceof Error && controller.signal.reason.message === 'Registry request timed out.') {
          throw new Error('Поиск в MCP Registry превысил время ожидания.')
        }
        throw aborted(controller.signal)
      }
      throw error
    } finally {
      clearTimeout(timeout)
      signal?.removeEventListener('abort', abort)
    }
  }
}
