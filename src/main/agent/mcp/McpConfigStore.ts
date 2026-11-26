import { randomUUID } from 'node:crypto'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { validateMcpServerDefinition, type McpServerDefinition } from './McpRuntimeManager'

export interface McpSecretStore {
  get(key: string): string
  set(key: string, value: string): void
}

export type McpServerInput = McpServerDefinition

export type StoredMcpServer = McpServerDefinition & {
  /** True when credentials exist in the OS-backed secret store. The values are never returned here. */
  authConfigured: boolean
}

interface PersistedServer {
  definition: McpServerDefinition
  authConfigured: boolean
}

interface PersistedState {
  version: 1
  servers: PersistedServer[]
}

export interface McpConfigStoreOptions {
  maxServers?: number
  maxConfigBytes?: number
}

const DEFAULT_MAX_SERVERS = 64
const DEFAULT_MAX_CONFIG_BYTES = 1024 * 1024
const MAX_ID_LENGTH = 64
const MAX_ARGS = 128
const MAX_ARG_LENGTH = 8192
const MAX_TOTAL_ARG_LENGTH = 32 * 1024
const MAX_HEADERS = 32
const MAX_HEADER_NAME_LENGTH = 128
const MAX_HEADER_VALUE_LENGTH = 4096
const MAX_TOTAL_HEADER_LENGTH = 16 * 1024
const SECRET_PREFIX = 'mcp-server:'
const FORBIDDEN_HEADERS = new Set(['connection', 'content-length', 'host', 'transfer-encoding', 'upgrade'])
const SENSITIVE_ARG = /(?:api[-_]?key|access[-_]?token|auth(?:orization)?|password|passwd|secret|token|bearer)/i

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function cleanText(value: unknown, maxLength: number, allowEmpty = false): value is string {
  return typeof value === 'string' && value.length <= maxLength && !/[\u0000-\u001f\u007f]/.test(value) &&
    (allowEmpty || value.trim().length > 0)
}

function looksLikeShellCommand(command: string): boolean {
  // The process API accepts one executable path plus a separate argv array. Reject
  // shell syntax and inline flags while still permitting paths such as
  // "C:\\Program Files\\node.exe".
  return /[;&|<>`'"\r\n]/.test(command) || /\$\(/.test(command) || /\s+--?[a-z0-9]/i.test(command) ||
    /\s+(?:&&|\|\||\||;|>|<)\s*/.test(command)
}

function validateDefinition(value: unknown): McpServerDefinition {
  if (!record(value)) throw new Error('Некорректная конфигурация MCP-сервера.')
  const definition = validateMcpServerDefinition(value as McpServerDefinition)
  if (!/^[a-zA-Z0-9_-]{1,64}$/.test(definition.id)) throw new Error('Некорректный ID MCP-сервера.')

  if (definition.transport === 'stdio') {
    if (looksLikeShellCommand(definition.command)) throw new Error('Для stdio укажите путь к исполняемому файлу отдельно от аргументов.')
    if (definition.cwd !== undefined && (!path.isAbsolute(definition.cwd) || looksLikeShellCommand(definition.cwd))) {
      throw new Error('Рабочая папка MCP-сервера должна быть абсолютным путём.')
    }
    const args = definition.args ?? []
    if (args.length > MAX_ARGS || args.some(argument => argument.length > MAX_ARG_LENGTH)) {
      throw new Error('Слишком длинный список аргументов MCP-сервера.')
    }
    if (args.reduce((sum, argument) => sum + argument.length, 0) > MAX_TOTAL_ARG_LENGTH) {
      throw new Error('Общий размер аргументов MCP-сервера превышает лимит.')
    }
    if (args.some(argument => SENSITIVE_ARG.test(argument) || /^Bearer\s+/i.test(argument))) {
      throw new Error('Не передавайте секреты в аргументах процесса. Используйте защищённую настройку авторизации.')
    }
  } else {
    const endpoint = new URL(definition.url)
    if (endpoint.hash || [...endpoint.searchParams.keys()].some(key => /(?:token|secret|password|passwd|api[-_]?key|authorization|credential)/i.test(key))) {
      throw new Error('Уберите секреты и фрагмент из URL MCP-сервера; храните авторизацию отдельно.')
    }
  }

  return structuredClone(definition)
}

function validateHeaders(value: unknown): Record<string, string> {
  if (!record(value) || Object.keys(value).length > MAX_HEADERS) throw new Error('Некорректный набор заголовков авторизации.')
  const headers: Record<string, string> = {}
  const normalizedNames = new Set<string>()
  let total = 0
  for (const [rawName, rawValue] of Object.entries(value)) {
    const name = rawName.trim()
    if (!name || name.length > MAX_HEADER_NAME_LENGTH || !/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(name) || FORBIDDEN_HEADERS.has(name.toLowerCase())) {
      throw new Error(`Недопустимое имя заголовка: ${rawName}`)
    }
    if (normalizedNames.has(name.toLowerCase())) throw new Error(`Заголовок ${name} указан несколько раз.`)
    normalizedNames.add(name.toLowerCase())
    if (!cleanText(rawValue, MAX_HEADER_VALUE_LENGTH, true)) throw new Error(`Недопустимое значение заголовка ${name}.`)
    total += name.length + rawValue.length
    if (total > MAX_TOTAL_HEADER_LENGTH) throw new Error('Общий размер заголовков авторизации превышает лимит.')
    headers[name] = rawValue
  }
  return headers
}

/** Stores transport settings in userData and credentials only in the OS-backed SecretStore. */
export class McpConfigStore {
  private readonly file: string
  private readonly maxServers: number
  private readonly maxConfigBytes: number

  constructor(userDataPath: string, private readonly secrets?: McpSecretStore, options: McpConfigStoreOptions = {}) {
    if (!cleanText(userDataPath, 4096) || !path.isAbsolute(userDataPath)) throw new Error('Путь userData должен быть абсолютным.')
    this.file = path.join(userDataPath, 'mcp-servers.json')
    this.maxServers = Number.isInteger(options.maxServers) && options.maxServers! > 0
      ? Math.min(options.maxServers!, DEFAULT_MAX_SERVERS)
      : DEFAULT_MAX_SERVERS
    this.maxConfigBytes = Number.isInteger(options.maxConfigBytes) && options.maxConfigBytes! > 0
      ? Math.min(options.maxConfigBytes!, DEFAULT_MAX_CONFIG_BYTES)
      : DEFAULT_MAX_CONFIG_BYTES
  }

  private secretKey(serverId: string): string { return `${SECRET_PREFIX}${serverId}:headers` }

  private readState(): PersistedState {
    let raw: string
    try {
      const stat = fs.statSync(this.file)
      if (stat.size > this.maxConfigBytes) throw new Error('Файл настроек MCP превышает допустимый размер.')
      raw = fs.readFileSync(this.file, 'utf8')
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { version: 1, servers: [] }
      throw error
    }
    let parsed: unknown
    try { parsed = JSON.parse(raw) } catch { throw new Error('Файл настроек MCP повреждён.') }
    if (!record(parsed) || parsed.version !== 1 || !Array.isArray(parsed.servers) || parsed.servers.length > this.maxServers ||
      Object.keys(parsed).some(key => key !== 'version' && key !== 'servers')) {
      throw new Error('Файл настроек MCP имеет неподдерживаемый формат.')
    }
    const seen = new Set<string>()
    const servers: PersistedServer[] = parsed.servers.map((entry: unknown) => {
      if (!record(entry) || Object.keys(entry).some(key => key !== 'definition' && key !== 'authConfigured') || typeof entry.authConfigured !== 'boolean') {
        throw new Error('Некорректная запись MCP-сервера в файле настроек.')
      }
      const definition = validateDefinition(entry.definition)
      if (seen.has(definition.id)) throw new Error('В настройках MCP повторяется ID сервера.')
      seen.add(definition.id)
      return { definition, authConfigured: entry.authConfigured }
    })
    return { version: 1, servers }
  }

  private writeState(state: PersistedState): void {
    const serialized = `${JSON.stringify(state, null, 2)}\n`
    if (Buffer.byteLength(serialized, 'utf8') > this.maxConfigBytes) throw new Error('Файл настроек MCP превысит допустимый размер.')
    fs.mkdirSync(path.dirname(this.file), { recursive: true })
    const temporary = `${this.file}.${randomUUID()}.tmp`
    try {
      fs.writeFileSync(temporary, serialized, { encoding: 'utf8', flag: 'wx', mode: 0o600 })
      fs.renameSync(temporary, this.file)
    } finally {
      try { fs.unlinkSync(temporary) } catch {}
    }
  }

  list(): StoredMcpServer[] {
    return this.readState().servers.map(({ definition, authConfigured }) => ({ ...structuredClone(definition), authConfigured }))
  }

  getDefinition(id: string): McpServerDefinition {
    const server = this.readState().servers.find(item => item.definition.id === id)
    if (!server) throw new Error('Неизвестный MCP-сервер.')
    return structuredClone(server.definition)
  }

  add(input: McpServerInput, authHeaders: Record<string, string> = {}): StoredMcpServer {
    const definition = validateDefinition(input)
    const state = this.readState()
    if (state.servers.some(server => server.definition.id === definition.id)) throw new Error('MCP-сервер с таким ID уже существует.')
    if (state.servers.length >= this.maxServers) throw new Error('Достигнут лимит MCP-серверов.')
    const headers = validateHeaders(authHeaders)
    if (Object.keys(headers).length && definition.transport !== 'http') throw new Error('Заголовки авторизации поддерживаются только для HTTP MCP-серверов.')
    if (Object.keys(headers).length && !this.secrets) throw new Error('Защищённое хранилище недоступно.')
    const secretKey = this.secretKey(definition.id)
    const previousSecret = this.secrets?.get(secretKey) ?? ''
    const hasAuth = Object.keys(headers).length > 0
    if (hasAuth) this.secrets!.set(secretKey, JSON.stringify(headers))
    try {
      this.writeState({ ...state, servers: [...state.servers, { definition, authConfigured: hasAuth }] })
    } catch (error) {
      if (hasAuth) this.secrets!.set(secretKey, previousSecret)
      throw error
    }
    return { ...structuredClone(definition), authConfigured: hasAuth }
  }

  setAuthHeaders(serverId: string, input: Record<string, string>): void {
    const state = this.readState()
    const server = state.servers.find(item => item.definition.id === serverId)
    if (!server) throw new Error('Неизвестный MCP-сервер.')
    if (server.definition.transport !== 'http') throw new Error('Заголовки авторизации поддерживаются только для HTTP MCP-серверов.')
    if (!this.secrets) throw new Error('Защищённое хранилище недоступно.')
    const headers = validateHeaders(input)
    const secretKey = this.secretKey(serverId)
    const previous = this.secrets.get(secretKey)
    if (Object.keys(headers).length === 0) {
      this.secrets.set(secretKey, '')
      try {
        this.writeState({ ...state, servers: state.servers.map(item => item.definition.id === serverId ? { ...item, authConfigured: false } : item) })
      } catch (error) {
        if (previous) this.secrets.set(secretKey, previous)
        throw error
      }
      return
    }

    const encoded = JSON.stringify(headers)
    this.secrets.set(secretKey, encoded)
    try {
      this.writeState({ ...state, servers: state.servers.map(item => item.definition.id === serverId ? { ...item, authConfigured: true } : item) })
    } catch (error) {
      this.secrets.set(secretKey, previous)
      throw error
    }
  }

  getHeaders(serverId: string): Record<string, string> {
    const server = this.readState().servers.find(item => item.definition.id === serverId)
    if (!server) throw new Error('Неизвестный MCP-сервер.')
    if (!server.authConfigured) return {}
    if (!this.secrets) throw new Error('Защищённое хранилище недоступно.')
    const encoded = this.secrets.get(this.secretKey(serverId))
    if (!encoded) throw new Error('Заголовки авторизации отсутствуют в защищённом хранилище.')
    let parsed: unknown
    try { parsed = JSON.parse(encoded) } catch { throw new Error('Заголовки авторизации повреждены.') }
    return validateHeaders(parsed)
  }

  remove(id: string): boolean {
    const state = this.readState()
    const entry = state.servers.find(server => server.definition.id === id)
    if (!entry) return false
    const next = { ...state, servers: state.servers.filter(server => server.definition.id !== id) }
    if (entry.authConfigured && !this.secrets) throw new Error('Защищённое хранилище недоступно.')
    const secretKey = this.secretKey(id)
    const previousSecret = this.secrets?.get(secretKey) ?? ''
    if (previousSecret) this.secrets?.set(secretKey, '')
    try {
      this.writeState(next)
    } catch (error) {
      if (previousSecret) this.secrets?.set(secretKey, previousSecret)
      throw error
    }
    return true
  }
}
