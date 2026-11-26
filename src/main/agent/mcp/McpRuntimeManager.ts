import { createHash, randomUUID } from 'node:crypto'
import {
  Client, StreamableHTTPClientTransport,
  type ClientOptions, type Prompt, type Resource, type Tool, type Transport
} from '@modelcontextprotocol/client'
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio'

export type McpServerDefinition =
  | { id: string; transport: 'stdio'; command: string; args?: string[]; cwd?: string }
  | { id: string; transport: 'http'; url: string }

export interface McpToolDescriptor {
  id: string
  serverId: string
  remoteName: string
  description: string
  inputSchema: Tool['inputSchema']
  mutates: true
  parallelSafe: false
  cacheable: false
}

export interface McpServerStatus {
  id: string
  state: 'disconnected' | 'connecting' | 'connected' | 'error'
  revision: number
  protocolVersion?: string
  error?: string
}

type Catalog = {
  tools: McpToolDescriptor[]
  resources: (Resource & { serverId: string })[]
  prompts: (Prompt & { serverId: string })[]
}

interface Connection {
  client: Client
  transport: Transport
}

export interface McpRuntimeOptions {
  getHeaders?: (serverId: string) => Record<string, string> | Promise<Record<string, string>>
  createConnection?: (definition: McpServerDefinition, options: ClientOptions, headers?: Record<string, string>) => Connection
}

interface Session {
  controller: AbortController
  connection?: Connection
  opening?: Promise<void>
  refresh?: Promise<void>
  dirty: boolean
}

interface Server {
  instanceId: string
  definition: McpServerDefinition
  status: McpServerStatus
  catalog: Catalog
  session?: Session
  closing?: Promise<void>
}

const emptyCatalog = (): Catalog => ({ tools: [], resources: [], prompts: [] })
const validText = (value: unknown): value is string =>
  typeof value === 'string' && value.trim().length > 0 && !value.includes('\0')

export function validateMcpServerDefinition(definition: McpServerDefinition): McpServerDefinition {
  if (!definition || typeof definition.id !== 'string' || !/^[a-zA-Z0-9_-]{1,64}$/.test(definition.id)) {
    throw new Error('Invalid MCP server ID')
  }
  const allowed = definition.transport === 'stdio' ? ['command', 'args', 'cwd'] : ['url']
  if (Object.keys(definition).some(key => !['id', 'transport', ...allowed].includes(key))) {
    throw new Error('Unexpected MCP server configuration field')
  }
  if (definition.transport === 'stdio') {
    if (!validText(definition.command) || (definition.cwd !== undefined && !validText(definition.cwd)) ||
      (definition.args !== undefined && (!Array.isArray(definition.args) ||
        !definition.args.every(arg => typeof arg === 'string' && !arg.includes('\0'))))) {
      throw new Error('Invalid MCP stdio command, arguments or working directory')
    }
  } else if (definition.transport === 'http' && validText(definition.url)) {
    let endpoint: URL
    try { endpoint = new URL(definition.url) } catch { throw new Error('Invalid MCP HTTP endpoint') }
    if (!['http:', 'https:'].includes(endpoint.protocol) || endpoint.username || endpoint.password) {
      throw new Error('Invalid MCP HTTP endpoint')
    }
  } else {
    throw new Error('Invalid MCP transport')
  }
  return structuredClone(definition)
}

function createConnection(def: McpServerDefinition, options: ClientOptions, headers?: Record<string, string>): Connection {
  const client = new Client({ name: 'zipply', version: '0.1.0' }, options)
  const transport = def.transport === 'stdio'
    ? new StdioClientTransport({ command: def.command, args: def.args, cwd: def.cwd, stderr: 'ignore' })
    : new StreamableHTTPClientTransport(new URL(def.url), { requestInit: { headers } })
  return { client, transport }
}

function describeTool(serverId: string, tool: Tool): McpToolDescriptor {
  // Provider function names are limited to 64 ASCII characters. Keep a readable
  // namespace and hash the original pair so punctuation, case and long names stay distinct.
  const digest = createHash('sha256').update(JSON.stringify([serverId, tool.name])).digest('hex').slice(0, 16)
  const prefix = ('mcp_' + serverId + '_' + tool.name).toLowerCase().replace(/[^a-z0-9_-]/g, '_').slice(0, 47)
  return {
    id: prefix + '_' + digest, serverId, remoteName: tool.name,
    description: (tool.description ?? '').slice(0, 4000), inputSchema: normalizeToolSchema(tool.inputSchema),
    mutates: true, parallelSafe: false, cacheable: false
  }
}

function normalizeToolSchema(value: Tool['inputSchema']): Tool['inputSchema'] {
  try {
    if (!value || typeof value !== 'object' || Array.isArray(value) || value.type !== 'object') throw new Error()
    const encoded = JSON.stringify(value)
    if (!encoded || Buffer.byteLength(encoded, 'utf8') > 64 * 1024) throw new Error()
    const cloned = JSON.parse(encoded) as Record<string, unknown>
    if (cloned.properties === undefined) cloned.properties = {}
    if (!cloned.properties || typeof cloned.properties !== 'object' || Array.isArray(cloned.properties)) throw new Error()
    return cloned as Tool['inputSchema']
  } catch {
    throw new Error('MCP tool has an invalid or oversized JSON input schema.')
  }
}

function bounded<T>(value: T): T {
  if (Buffer.byteLength(JSON.stringify(value), 'utf8') > 256 * 1024) throw new Error('MCP result exceeds 256 KiB')
  return value
}

function combinedSignal(session: Session, caller?: AbortSignal): AbortSignal {
  const signal = caller ? AbortSignal.any([session.controller.signal, caller]) : session.controller.signal
  signal.throwIfAborted()
  return signal
}

function waitWithSignal<T>(operation: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return operation
  return new Promise((resolve, reject) => {
    const abort = () => reject(signal.reason)
    if (signal.aborted) abort()
    else signal.addEventListener('abort', abort, { once: true })
    operation.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort))
  })
}

async function closeConnection(connection?: Connection): Promise<void> {
  if (!connection) return
  if (connection.client.transport) await connection.client.close()
  else await connection.transport.close()
}

export class McpRuntimeManager {
  private readonly servers = new Map<string, Server>()
  private readonly catalogListeners = new Set<(serverId: string, revision: number) => void>()
  private disposed = false

  constructor(private readonly options: McpRuntimeOptions = {}) {}

  registerServer(definition: McpServerDefinition): void {
    if (this.disposed) throw new Error('MCP runtime is disposed')
    const def = validateMcpServerDefinition(definition)
    if (this.servers.has(def.id)) throw new Error('Duplicate MCP server ID')
    this.servers.set(def.id, { instanceId: randomUUID(), definition: def, status: { id: def.id, state: 'disconnected', revision: 0 }, catalog: emptyCatalog() })
  }

  private server(id: string): Server {
    const server = this.servers.get(id)
    if (!server) throw new Error('Unknown MCP server')
    return server
  }

  getStatus(id: string): McpServerStatus { return { ...this.server(id).status } }
  getServerInstanceId(id: string): string { return this.server(id).instanceId }
  getServerDefinition(id: string): McpServerDefinition { return structuredClone(this.server(id).definition) }
  listServers(): McpServerStatus[] { return [...this.servers.values()].map(server => ({ ...server.status })) }

  onCatalogChanged(listener: (serverId: string, revision: number) => void): () => void {
    this.catalogListeners.add(listener)
    return () => this.catalogListeners.delete(listener)
  }

  async connect(id: string, signal?: AbortSignal, initialHeaders?: Record<string, string>): Promise<void> {
    const server = this.server(id)
    if (server.closing) await waitWithSignal(server.closing, signal)
    signal?.throwIfAborted()
    if (this.disposed) throw new Error('MCP runtime is disposed')
    if (this.servers.get(id) !== server) throw new Error('MCP server registration changed')
    if (server.session) return waitWithSignal(server.session.opening ?? Promise.resolve(), signal)

    const session: Session = { controller: new AbortController(), dirty: false }
    server.session = session
    server.status.state = 'connecting'
    delete server.status.error
    const abort = () => { void this.disconnect(id).catch(() => {}) }
    signal?.addEventListener('abort', abort, { once: true })
    session.opening = this.open(server, session, initialHeaders).finally(() => signal?.removeEventListener('abort', abort))
    return waitWithSignal(session.opening, signal)
  }

  private async open(server: Server, session: Session, initialHeaders?: Record<string, string>): Promise<void> {
    const signal = session.controller.signal
    try {
      // SDK notifications are subscribed on both protocol eras. Serial refreshes
      // also handle a change arriving during the initial or a subsequent list.
      const changed = { autoRefresh: false, onChanged: () => {
        if (server.session !== session) return
        session.dirty = true
        if (server.status.state === 'connected') void this.refresh(server, session).catch(() => {
          if (server.session === session) void this.stop(server, 'error').catch(() => {})
        })
      } }
      const headers = server.definition.transport === 'http'
        ? await waitWithSignal(Promise.resolve(initialHeaders ?? this.options.getHeaders?.(server.definition.id)), signal)
        : undefined
      signal.throwIfAborted()
      const connection = (this.options.createConnection ?? createConnection)(server.definition, {
        versionNegotiation: { mode: 'auto', probe: { timeoutMs: server.definition.transport === 'stdio' ? 3000 : 15000 } },
        listChanged: { tools: changed, prompts: changed, resources: changed }
      }, headers)
      session.connection = connection
      connection.client.onclose = () => {
        if (server.session === session) void this.stop(server, 'error').catch(() => {})
      }
      await connection.client.connect(connection.transport, { signal })
      signal.throwIfAborted()
      await this.refresh(server, session)
      signal.throwIfAborted()
      server.status.protocolVersion = connection.client.getNegotiatedProtocolVersion()
      server.status.state = 'connected'
      this.notifyCatalogChanged(server)
    } catch (error) {
      if (server.session === session) this.detach(server, 'error', error instanceof Error ? error.message.slice(0, 1000) : String(error).slice(0, 1000))
      await closeConnection(session.connection)
      throw error
    }
  }

  private refresh(server: Server, session: Session): Promise<void> {
    if (session.refresh) return session.refresh
    const client = session.connection!.client
    const options = { signal: session.controller.signal, cacheMode: 'refresh' as const }
    const reload = async () => {
      do {
        session.dirty = false
        const caps = client.getServerCapabilities()
        const [tools, resources, prompts] = await Promise.all([
          caps?.tools ? client.listTools(undefined, options).then(page => page.tools) : [],
          caps?.resources ? client.listResources(undefined, options).then(page => page.resources) : [],
          caps?.prompts ? client.listPrompts(undefined, options).then(page => page.prompts) : []
        ])
        options.signal.throwIfAborted()
        const serverId = server.definition.id
        server.catalog = {
          tools: tools.map(tool => describeTool(serverId, tool)),
          resources: resources.map(item => ({ ...item, serverId })),
          prompts: prompts.map(item => ({ ...item, serverId }))
        }
        server.status.revision++
        if (server.status.state === 'connected') this.notifyCatalogChanged(server)
      } while (session.dirty)
    }
    session.refresh = reload().finally(() => { session.refresh = undefined })
    return session.refresh
  }

  private notifyCatalogChanged(server: Server): void {
    for (const listener of this.catalogListeners) {
      try { listener(server.definition.id, server.status.revision) } catch { /* Catalog listeners are advisory. */ }
    }
  }

  private listed(id?: string): Server[] {
    return (id === undefined ? [...this.servers.values()] : [this.server(id)]).filter(server => server.status.state === 'connected')
  }

  listTools(id?: string): McpToolDescriptor[] {
    return structuredClone(this.listed(id).flatMap(server => server.catalog.tools))
  }
  listResources(id?: string): Catalog['resources'] {
    return structuredClone(this.listed(id).flatMap(server => server.catalog.resources))
  }
  listPrompts(id?: string): Catalog['prompts'] {
    return structuredClone(this.listed(id).flatMap(server => server.catalog.prompts))
  }

  private active(id: string, caller?: AbortSignal) {
    const server = this.server(id)
    const session = server.session
    if (!session?.connection || server.status.state !== 'connected') throw new Error('MCP server is disconnected')
    return { client: session.connection.client, signal: combinedSignal(session, caller) }
  }

  async readResource(serverId: string, uri: string, abort?: AbortSignal) {
    const { client, signal } = this.active(serverId, abort)
    return bounded(await client.readResource({ uri }, { signal, cacheMode: 'bypass' }))
  }

  async getPrompt(serverId: string, name: string, args: Record<string, string> = {}, abort?: AbortSignal) {
    const { client, signal } = this.active(serverId, abort)
    return bounded(await client.getPrompt({ name, arguments: args }, { signal }))
  }

  async callTool(toolId: string, args: Record<string, unknown>, abort?: AbortSignal, expectedServerInstanceId?: string) {
    for (const server of this.listed()) {
      const tool = server.catalog.tools.find(tool => tool.id === toolId)
      if (!tool) continue
      if (expectedServerInstanceId !== undefined && server.instanceId !== expectedServerInstanceId) throw new Error('MCP server configuration changed while the tool was awaiting approval.')
      const { client, signal } = this.active(tool.serverId, abort)
      return bounded(await client.callTool({ name: tool.remoteName, arguments: args }, { signal }))
    }
    throw new Error('Unknown MCP tool')
  }

  private detach(server: Server, state: 'error' | 'disconnected', error?: string): void {
    const session = server.session
    server.session = undefined
    server.catalog = emptyCatalog()
    server.status = { id: server.definition.id, state, revision: server.status.revision + 1, ...(error ? { error } : {}) }
    session?.controller.abort()
    this.notifyCatalogChanged(server)
  }

  private stop(server: Server, state: 'error' | 'disconnected'): Promise<void> {
    const session = server.session
    if (!session) {
      if (state === 'disconnected') server.status.state = state
      return server.closing ?? Promise.resolve()
    }
    this.detach(server, state)
    server.closing = (async () => {
      try { await closeConnection(session.connection) }
      finally { await session.opening?.catch(() => {}) }
    })().finally(() => { server.closing = undefined })
    return server.closing
  }

  disconnect(id: string): Promise<void> { return this.stop(this.server(id), 'disconnected') }

  async removeServer(id: string): Promise<void> {
    const server = this.servers.get(id)
    if (!server) return
    await this.stop(server, 'disconnected')
    if (this.servers.get(id) === server) this.servers.delete(id)
  }

  async dispose(): Promise<void> {
    this.disposed = true
    await Promise.all([...this.servers.values()].map(server => this.stop(server, 'disconnected')))
  }
}
