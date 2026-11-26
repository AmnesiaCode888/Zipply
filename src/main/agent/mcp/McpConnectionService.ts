import { createHash } from 'node:crypto'
import type { McpConfigStore, McpServerInput, StoredMcpServer } from './McpConfigStore'
import type { McpRegistryClient, McpRegistryEntry } from './McpRegistryClient'
import type { McpRuntimeManager, McpServerDefinition } from './McpRuntimeManager'

const MAX_PARALLEL_STARTS = 4
const MAX_SEARCH_CONNECTIONS = 3

export function mcpRegistryServerId(serverName: string): string {
  return 'registry_' + createHash('sha256').update(serverName).digest('hex').slice(0, 24)
}

export class McpConnectionService {
  private readonly installing = new Set<string>()

  constructor(
    private readonly config: McpConfigStore,
    private readonly runtime: McpRuntimeManager,
    private readonly registry?: McpRegistryClient
  ) {}

  list() {
    const statuses = new Map(this.runtime.listServers().map(status => [status.id, status]))
    const configured = this.config.list().map(server => {
      const status = statuses.get(server.id)
      return {
        id: server.id,
        transport: server.transport,
        state: status?.state ?? 'disconnected',
        authConfigured: server.authConfigured,
        ...(status?.error ? { error: status.error } : {})
      }
    })
    return { configured }
  }

  searchCatalog(query: string, signal?: AbortSignal): Promise<McpRegistryEntry[]> {
    if (!this.registry) throw new Error('Поиск MCP Registry недоступен.')
    return this.registry.search(query, signal)
  }

  getCatalogEntry(serverName: string): McpRegistryEntry | undefined {
    return this.registry?.getCached(serverName)
  }

  /** Persist a server added from the Extensions UI and register it for every chat. */
  add(definition: McpServerInput, authHeaders: Record<string, string> = {}): StoredMcpServer {
    this.requireReady(definition.id)
    if (this.runtime.listServers().some(server => server.id === definition.id)) {
      throw new Error('MCP-сервер с таким ID уже зарегистрирован.')
    }

    const stored = this.config.add(definition, authHeaders)
    try {
      this.runtime.registerServer(definition)
      return stored
    } catch (error) {
      try { this.config.remove(definition.id) } catch { /* Preserve the registration error; config storage reports its own failure on the next read. */ }
      throw error
    }
  }

  async connectCatalog(serverName: string, expectedEndpoint: string, signal?: AbortSignal) {
    if (!this.registry) throw new Error('Поиск MCP Registry недоступен.')
    const entry = await this.registry.resolve(serverName, expectedEndpoint, signal)
    const id = mcpRegistryServerId(entry.serverName)
    return this.installAndConnect({ id, transport: 'http', url: entry.endpoint }, signal)
  }

  async installAndConnect(definition: McpServerDefinition, signal?: AbortSignal) {
    this.requireReady(definition.id)
    const existing = this.config.list().find(server => server.id === definition.id)
    if (existing) {
      if (existing.transport !== definition.transport ||
          (existing.transport === 'http' && definition.transport === 'http' && existing.url !== definition.url)) {
        throw new Error('Под этим ID уже настроен другой MCP-сервер. Выберите другой ID.')
      }
      return this.connect(definition.id, signal)
    }

    this.installing.add(definition.id)
    let registered = false
    try {
      this.runtime.registerServer(definition)
      registered = true
      await this.runtime.connect(definition.id, signal, {})
      signal?.throwIfAborted()
      const status = this.runtime.getStatus(definition.id)
      if (status.state !== 'connected') throw new Error('MCP-сервер не завершил подключение.')
      this.config.add(definition)
      return status
    } catch (error) {
      if (registered) await this.runtime.removeServer(definition.id).catch(() => {})
      throw error
    } finally {
      this.installing.delete(definition.id)
    }
  }

  async connect(id: string, signal?: AbortSignal) {
    this.requireReady(id)
    await this.runtime.connect(id, signal)
    signal?.throwIfAborted()
    return this.runtime.getStatus(id)
  }

  /** A skill link may activate only an already configured remote server, never a local process. */
  async connectConfiguredRemote(id: string, signal?: AbortSignal): Promise<boolean> {
    const server = this.config.list().find(item => item.id === id && item.transport === 'http')
    if (!server) return false
    const status = await this.connect(id, signal)
    return status.state === 'connected'
  }

  /** Connect only remote profile servers that match a capability search. */
  async connectConfigured(query: string, signal?: AbortSignal): Promise<{ connected: string[]; failed: string[]; notAttempted: string[] }> {
    // Local processes remain an explicit Extensions action; a metadata search
    // must never start every saved stdio server or fan out to the whole profile.
    const configured = this.config.list().filter(server => server.transport === 'http')
    const configuredIds = new Set(configured.map(server => server.id))
    const active = new Set(this.runtime.listServers().filter(server => server.state === 'connected' && configuredIds.has(server.id)).map(server => server.id))
    const terms = [...new Set(query.toLocaleLowerCase().match(/[\p{L}\p{N}._-]{2,}/gu) ?? [])]
    const scored = configured.filter(server => !active.has(server.id)).map(server => {
      let host = ''
      let pathname = ''
      try { const endpoint = new URL(server.url); host = endpoint.hostname.toLocaleLowerCase(); pathname = endpoint.pathname.toLocaleLowerCase() } catch {}
      const score = terms.reduce((total, term) => total + (server.id.toLocaleLowerCase().includes(term) ? 4 : 0) + (host.includes(term) ? 3 : 0) + (pathname.includes(term) ? 1 : 0), 0)
      return { server, score }
    }).sort((left, right) => right.score - left.score || left.server.id.localeCompare(right.server.id))
    const matching = scored.filter(item => item.score > 0)
    if (configured.length === 1 && matching.length === 0 && scored[0]) matching.push(scored[0])
    const selected = matching.slice(0, MAX_SEARCH_CONNECTIONS)
    const selectedIds = new Set(selected.map(item => item.server.id))
    const connected = [...active]
    const failed: string[] = []
    let nextIndex = 0
    const worker = async (): Promise<void> => {
      while (nextIndex < selected.length) {
        signal?.throwIfAborted()
        const id = selected[nextIndex++].server.id
        try {
          await this.connect(id, signal)
          if (!connected.includes(id)) connected.push(id)
        } catch (error) {
          if (signal?.aborted) throw error
          failed.push(id)
        }
      }
    }
    await Promise.all(Array.from({ length: Math.min(MAX_PARALLEL_STARTS, selected.length) }, () => worker()))
    signal?.throwIfAborted()
    const notAttempted = configured.map(server => server.id).filter(id => !active.has(id) && !selectedIds.has(id))
    return { connected, failed, notAttempted }
  }

  requireReady(id: string): void {
    if (this.installing.has(id)) throw new Error('Сервер MCP уже подключается. Дождитесь результата.')
  }
}
