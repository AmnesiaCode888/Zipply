import { createHash, randomUUID } from 'node:crypto'
import * as fs from 'node:fs'
import * as path from 'node:path'
import type { McpServerDefinition, McpToolDescriptor } from './McpRuntimeManager'

export interface TrustedMcpTool {
  serverId: string
  toolId: string
  toolName: string
  fingerprint: string
  trustedAt: number
}

interface State { version: 2; tools: TrustedMcpTool[] }
const validId = (value: unknown): value is string => typeof value === 'string' && /^[a-zA-Z0-9_-]{1,128}$/.test(value)

export function mcpToolTrustFingerprint(serverId: string, tool: McpToolDescriptor, definition?: McpServerDefinition): string {
  const configuration = definition?.transport === 'http'
    ? ['http', definition.url]
    : definition?.transport === 'stdio'
      ? ['stdio', definition.command, definition.args ?? [], definition.cwd ?? null]
      : undefined
  return createHash('sha256').update(JSON.stringify([
    serverId, configuration, tool.id, tool.remoteName, tool.description, tool.inputSchema
  ])).digest('hex')
}

/** Stores only the user's explicit per-tool trust choices; MCP metadata is not authority. */
export class McpTrustStore {
  private readonly file: string
  constructor(userDataPath: string) { this.file = path.join(userDataPath, 'mcp-trust.json') }

  private read(): State {
    try {
      const raw = fs.readFileSync(this.file, 'utf8')
      if (Buffer.byteLength(raw, 'utf8') > 256 * 1024) throw new Error('MCP trust store exceeds size limit')
      const parsed: unknown = JSON.parse(raw)
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('Invalid MCP trust store')
      const state = parsed as { version?: unknown; tools?: unknown }
      if (state.version === 1 && Array.isArray(state.tools) && state.tools.length <= 4096) {
        // Old grants were keyed only by tool ID. Discard them so changed schemas
        // require a new user decision instead of inheriting broad stale trust.
        return { version: 2, tools: [] }
      }
      if (state.version !== 2 || !Array.isArray(state.tools) || state.tools.length > 4096) throw new Error('Invalid MCP trust store')
      const tools: TrustedMcpTool[] = []
      const seen = new Set<string>()
      for (const value of state.tools) {
        if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid MCP trust entry')
        const entry = value as Record<string, unknown>
        if (!validId(entry.serverId) || !validId(entry.toolId) || typeof entry.toolName !== 'string' || entry.toolName.length > 256 ||
          typeof entry.fingerprint !== 'string' || !/^[a-f0-9]{64}$/.test(entry.fingerprint) ||
          typeof entry.trustedAt !== 'number' || !Number.isFinite(entry.trustedAt)) throw new Error('Invalid MCP trust entry')
        const key = `${entry.serverId}:${entry.toolId}`
        if (seen.has(key)) throw new Error('Duplicate MCP trust entry')
        seen.add(key)
        tools.push({ serverId: entry.serverId, toolId: entry.toolId, toolName: entry.toolName, fingerprint: entry.fingerprint, trustedAt: entry.trustedAt })
      }
      return { version: 2, tools }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { version: 2, tools: [] }
      throw error
    }
  }

  private write(state: State): void {
    fs.mkdirSync(path.dirname(this.file), { recursive: true })
    const temp = `${this.file}.${randomUUID()}.tmp`
    try {
      fs.writeFileSync(temp, `${JSON.stringify(state, null, 2)}\n`, { encoding: 'utf8', mode: 0o600, flag: 'wx' })
      fs.renameSync(temp, this.file)
    } finally { try { fs.unlinkSync(temp) } catch {} }
  }

  list(): TrustedMcpTool[] { return this.read().tools.map(tool => ({ ...tool })) }
  isTrusted(serverId: string, toolId: string, fingerprint: string): boolean {
    return this.read().tools.some(tool => tool.serverId === serverId && tool.toolId === toolId && tool.fingerprint === fingerprint)
  }
  trust(serverId: string, toolId: string, toolName: string, fingerprint: string): void {
    if (!validId(serverId) || !validId(toolId) || typeof toolName !== 'string' || !toolName.trim() || toolName.length > 256 || !/^[a-f0-9]{64}$/.test(fingerprint)) throw new Error('Invalid MCP trust target')
    const state = this.read()
    const existing = state.tools.findIndex(tool => tool.serverId === serverId && tool.toolId === toolId)
    const value = { serverId, toolId, toolName, fingerprint, trustedAt: Date.now() }
    if (existing >= 0) state.tools[existing] = value
    else state.tools.push(value)
    this.write(state)
  }
  revoke(serverId: string, toolId: string): void {
    const state = this.read()
    const tools = state.tools.filter(tool => tool.serverId !== serverId || tool.toolId !== toolId)
    if (tools.length !== state.tools.length) this.write({ version: 2, tools })
  }
  revokeServer(serverId: string): void {
    const state = this.read()
    const tools = state.tools.filter(tool => tool.serverId !== serverId)
    if (tools.length !== state.tools.length) this.write({ version: 2, tools })
  }
}
