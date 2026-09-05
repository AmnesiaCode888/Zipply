import fs from 'fs'
import path from 'path'
import os from 'os'
import readline from 'readline'
import { spawn, ChildProcess } from 'child_process'
import { app } from 'electron'
import { LocalStorageService } from '../../services/LocalStorageService'
import type { ToolResult } from '../tools/ToolBase'

export type McpTransport = 'stdio' | 'sse' | 'http'
export type McpServerStatus = 'connected' | 'connecting' | 'disconnected' | 'error'

export interface McpToolParameter {
  type: string
  description?: string
  enum?: string[]
  items?: any
  properties?: Record<string, any>
  required?: string[]
  [key: string]: any
}

export interface McpDiscoveredTool {
  name: string
  serverName: string
  serverId: string
  description?: string
  inputSchema?: {
    type?: string
    properties?: Record<string, McpToolParameter>
    required?: string[]
    [key: string]: any
  }
}

export interface McpServerConfig {
  id: string
  name: string
  description?: string
  transport: McpTransport
  command?: string
  args?: string[]
  env?: Record<string, string>
  cwd?: string
  url?: string
  headers?: Record<string, string>
  enabled: boolean
  createdAt: string
  updatedAt: string
}

export interface McpServerItemUI extends McpServerConfig {
  status: McpServerStatus
  error?: string
  tools: McpDiscoveredTool[]
  lastConnectedAt?: string
}

interface PendingRequest {
  resolve: (value: any) => void
  reject: (reason: any) => void
  timer: NodeJS.Timeout
}

interface ActiveProcessInfo {
  process: ChildProcess
  serverConfig: McpServerConfig
  buffer: string
  nextRequestId: number
  pendingRequests: Map<number | string, PendingRequest>
  stderrLogs: string[]
  status: McpServerStatus
  error?: string
  tools: McpDiscoveredTool[]
  lastConnectedAt?: string
}

/**
 * McpService — Manages Model Context Protocol servers lifecycle,
 * JSON-RPC communication, tools discovery, and tool execution for Zipply.
 */
export class McpService {
  private static _processes: Map<string, ActiveProcessInfo> = new Map()
  private static _statusCache: Map<string, { status: McpServerStatus; error?: string; tools: McpDiscoveredTool[]; lastConnectedAt?: string }> = new Map()
  private static _isExitHookRegistered = false

  static getMcpCacheDir(): string {
    let baseDir = ''
    try {
      if (app && typeof app.getPath === 'function') {
        baseDir = app.getPath('userData')
      }
    } catch {}
    if (!baseDir) {
      baseDir = process.env.APPDATA || (process.platform === 'darwin' ? path.join(os.homedir(), 'Library', 'Application Support', 'zipply') : path.join(os.homedir(), '.config', 'zipply'))
    }
    const cacheDir = path.join(baseDir, 'mcp_cache')
    if (!fs.existsSync(cacheDir)) {
      try { fs.mkdirSync(cacheDir, { recursive: true }) } catch {}
    }
    return cacheDir
  }

  static cacheToolSchemas(serverName: string, tools: McpDiscoveredTool[]): void {
    try {
      const serverDir = path.join(this.getMcpCacheDir(), serverName.toLowerCase().replace(/[^a-z0-9_-]/g, '_'))
      if (!fs.existsSync(serverDir)) fs.mkdirSync(serverDir, { recursive: true })
      for (const t of tools) {
        const filePath = path.join(serverDir, `${t.name}.json`)
        fs.writeFileSync(filePath, JSON.stringify(t, null, 2), 'utf-8')
      }
    } catch (e) {
      console.warn('[McpService] Failed to cache tool schemas:', e)
    }
  }

  private static _killProcessTree(pid: number): void {
    try {
      if (process.platform === 'win32') {
        spawn('taskkill', ['/pid', String(pid), '/f', '/t'])
      } else {
        try {
          process.kill(-pid, 'SIGKILL')
        } catch {
          try {
            process.kill(pid, 'SIGKILL')
          } catch {}
        }
      }
    } catch (e) {
      console.warn(`[McpService] Error killing process tree ${pid}:`, e)
    }
  }

  private static _registerExitHook(): void {
    if (this._isExitHookRegistered) return
    this._isExitHookRegistered = true
    process.once('exit', () => {
      this.stopAll()
    })
  }

  /**
   * Get all registered MCP server configurations.
   */
  static getAllServers(): McpServerItemUI[] {
    const configs: McpServerConfig[] = LocalStorageService.getStore<McpServerConfig[]>('mcp_servers', [])
    return configs.map((c) => {
      const active = this._processes.get(c.id)
      const cached = this._statusCache.get(c.id)
      return {
        ...c,
        status: active?.status || cached?.status || (c.enabled ? 'disconnected' : 'disconnected'),
        error: active?.error || cached?.error,
        tools: active?.tools || cached?.tools || [],
        lastConnectedAt: active?.lastConnectedAt || cached?.lastConnectedAt
      }
    })
  }

  /**
   * Save or update an MCP server configuration.
   */
  static async saveServer(data: Partial<McpServerConfig> & { name: string }): Promise<McpServerItemUI> {
    const configs: McpServerConfig[] = LocalStorageService.getStore<McpServerConfig[]>('mcp_servers', [])
    const id = data.id || `mcp_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`
    const now = new Date().toISOString()

    const sanitizedName = data.name.trim().toLowerCase().replace(/[^a-z0-9_-]/g, '_')
    if (!sanitizedName) {
      throw new Error('Имя сервера не может быть пустым')
    }

    const existingIdx = configs.findIndex((c) => c.id === id || (c.name.toLowerCase() === sanitizedName && c.id !== id))
    if (existingIdx >= 0 && configs[existingIdx].id !== id) {
      throw new Error(`Сервер с именем «${sanitizedName}» уже существует`)
    }

    const config: McpServerConfig = {
      id,
      name: sanitizedName,
      description: data.description || '',
      transport: data.transport || 'stdio',
      command: data.command?.trim() || '',
      args: Array.isArray(data.args) ? data.args : [],
      env: data.env || {},
      cwd: data.cwd?.trim() || undefined,
      url: data.url?.trim() || undefined,
      headers: data.headers || {},
      enabled: data.enabled !== false,
      createdAt: data.createdAt || now,
      updatedAt: now
    }

    const targetIdx = configs.findIndex((c) => c.id === id)
    if (targetIdx >= 0) {
      configs[targetIdx] = config
    } else {
      configs.push(config)
    }

    LocalStorageService.setStore('mcp_servers', configs, 0)

    // If server was running, restart it to apply changes
    if (this._processes.has(id)) {
      this.stopServer(id)
    }

    if (config.enabled) {
      try {
        await this.startServer(config)
      } catch (err) {
        console.warn(`[McpService] Auto-start for ${config.name} encountered error:`, err)
      }
    }

    return this.getServer(id)!
  }

  /**
   * Delete an MCP server configuration and stop its process.
   */
  static deleteServer(id: string): boolean {
    this.stopServer(id)
    this._statusCache.delete(id)

    const configs: McpServerConfig[] = LocalStorageService.getStore<McpServerConfig[]>('mcp_servers', [])
    const filtered = configs.filter((c) => c.id !== id)
    LocalStorageService.setStore('mcp_servers', filtered, 0)
    return true
  }

  /**
   * Toggle server enabled state.
   */
  static async toggleServer(id: string, enabled?: boolean): Promise<McpServerItemUI> {
    const configs: McpServerConfig[] = LocalStorageService.getStore<McpServerConfig[]>('mcp_servers', [])
    const target = configs.find((c) => c.id === id)
    if (!target) {
      throw new Error(`Сервер с id "${id}" не найден`)
    }

    target.enabled = typeof enabled === 'boolean' ? enabled : !target.enabled
    target.updatedAt = new Date().toISOString()
    LocalStorageService.setStore('mcp_servers', configs, 0)

    if (target.enabled) {
      await this.startServer(target)
    } else {
      this.stopServer(id)
    }

    return this.getServer(id)!
  }

  /**
   * Get single server UI status.
   */
  static getServer(id: string): McpServerItemUI | null {
    const all = this.getAllServers()
    return all.find((s) => s.id === id) || null
  }

  /**
   * Start an MCP server (stdio child process or SSE test).
   */
  static async startServer(config: McpServerConfig): Promise<McpDiscoveredTool[]> {
    this.stopServer(config.id)

    if (config.transport === 'sse' || config.transport === 'http') {
      return this._startSseServer(config)
    }

    // Default: stdio transport
    return this._startStdioServer(config)
  }

  /**
   * Start Stdio MCP Server.
   */
  private static async _startStdioServer(config: McpServerConfig): Promise<McpDiscoveredTool[]> {
    if (!config.command) {
      const err = 'Команда для запуска не указана'
      this._statusCache.set(config.id, { status: 'error', error: err, tools: [] })
      throw new Error(err)
    }

    this._statusCache.set(config.id, { status: 'connecting', tools: [] })
    this._registerExitHook()

    return new Promise((resolve, reject) => {
      try {
        const isWin = process.platform === 'win32'
        const child = spawn(config.command!, config.args || [], {
          cwd: config.cwd || undefined,
          env: {
            ...process.env,
            ...(config.env || {}),
            PYTHONIOENCODING: 'utf-8'
          },
          shell: isWin,
          stdio: ['pipe', 'pipe', 'pipe']
        })

        const procInfo: ActiveProcessInfo = {
          process: child,
          serverConfig: config,
          buffer: '',
          nextRequestId: 1,
          pendingRequests: new Map(),
          stderrLogs: [],
          status: 'connecting',
          tools: []
        }

        this._processes.set(config.id, procInfo)

        // Asynchronous non-blocking line reader for JSON-RPC (prevents 64KB OS Pipe Deadlock)
        const rl = readline.createInterface({
          input: child.stdout!,
          crlfDelay: Infinity
        })

        rl.on('line', (line: string) => {
          this._handleStdoutLine(procInfo, line)
        })

        child.stderr?.on('data', (chunk: Buffer | string) => {
          const text = chunk.toString()
          procInfo.stderrLogs.push(text)
          if (procInfo.stderrLogs.length > 50) procInfo.stderrLogs.shift()
        })

        child.on('error', (err) => {
          const msg = `Ошибка процесса: ${err.message}`
          procInfo.status = 'error'
          procInfo.error = msg
          this._statusCache.set(config.id, { status: 'error', error: msg, tools: [] })
          this._rejectAllPending(procInfo, new Error(msg))
          reject(new Error(msg))
        })

        child.on('exit', (code, signal) => {
          const exitMsg = code !== 0 ? `Процесс завершился с кодом ${code}` : `Процесс остановлен (${signal || 'exit'})`
          procInfo.status = code === 0 ? 'disconnected' : 'error'
          procInfo.error = code !== 0 ? exitMsg : undefined
          this._statusCache.set(config.id, {
            status: procInfo.status,
            error: procInfo.error,
            tools: procInfo.tools,
            lastConnectedAt: procInfo.lastConnectedAt
          })
          this._rejectAllPending(procInfo, new Error(exitMsg))
          this._processes.delete(config.id)
        })

        // Perform MCP Initialize Handshake
        this._initializeStdioMcp(procInfo)
          .then((tools) => {
            procInfo.status = 'connected'
            procInfo.tools = tools
            procInfo.lastConnectedAt = new Date().toISOString()
            procInfo.error = undefined
            this._statusCache.set(config.id, {
              status: 'connected',
              tools,
              lastConnectedAt: procInfo.lastConnectedAt
            })
            this.cacheToolSchemas(config.name, tools)
            resolve(tools)
          })
          .catch((err) => {
            procInfo.status = 'error'
            const fullError = err.message + (procInfo.stderrLogs.length > 0 ? `\n${procInfo.stderrLogs.slice(-5).join('')}` : '')
            procInfo.error = fullError
            this._statusCache.set(config.id, { status: 'error', error: fullError, tools: [] })
            this.stopServer(config.id)
            reject(new Error(fullError))
          })
      } catch (err: any) {
        const msg = `Не удалось запустить процесс: ${err?.message || err}`
        this._statusCache.set(config.id, { status: 'error', error: msg, tools: [] })
        reject(new Error(msg))
      }
    })
  }

  /**
   * Perform the standard MCP initialization sequence:
   * 1. send "initialize" request
   * 2. send "notifications/initialized" notification
   * 3. send "tools/list" request
   */
  private static async _initializeStdioMcp(procInfo: ActiveProcessInfo): Promise<McpDiscoveredTool[]> {
    const initRes = await this._sendRpcRequest(procInfo, 'initialize', {
      protocolVersion: '2024-11-05',
      capabilities: {
        roots: { listChanged: true },
        sampling: {}
      },
      clientInfo: {
        name: 'Zipply',
        version: '0.4.0'
      }
    }, 12000)

    if (!initRes) {
      throw new Error('Сервер MCP не вернул ответ на initialize')
    }

    // Send initialized notification (no response expected)
    this._sendRpcNotification(procInfo, 'notifications/initialized', {})

    // Query tools list
    const toolsRes = await this._sendRpcRequest(procInfo, 'tools/list', {}, 8000)
    const rawTools = toolsRes?.tools || []

    const discovered: McpDiscoveredTool[] = rawTools.map((t: any) => ({
      name: t.name,
      serverName: procInfo.serverConfig.name,
      serverId: procInfo.serverConfig.id,
      description: t.description || '',
      inputSchema: this.sanitizeToolSchema(t.inputSchema)
    }))

    return discovered
  }

  /**
   * Sanitize and normalize external MCP JSON Schemas for OpenAI / Gemini / Claude compatibility.
   * Strips forbidden default attributes, normalizes empty properties, and handles types safely.
   */
  static sanitizeToolSchema(rawSchema: any): { type: string; properties: Record<string, any>; required?: string[] } {
    if (!rawSchema || typeof rawSchema !== 'object') {
      return { type: 'object', properties: {} }
    }

    const type = rawSchema.type || 'object'
    const rawProps = rawSchema.properties && typeof rawSchema.properties === 'object' ? rawSchema.properties : {}
    const cleanProps: Record<string, any> = {}

    for (const [key, val] of Object.entries(rawProps)) {
      if (!val || typeof val !== 'object') continue
      const propObj = val as Record<string, any>
      
      const cleanProp: Record<string, any> = {
        type: propObj.type || 'string',
        description: propObj.description || key
      }

      if (Array.isArray(propObj.enum)) {
        cleanProp.enum = propObj.enum
      }

      if (propObj.items && typeof propObj.items === 'object') {
        const itemsCopy = { ...propObj.items }
        delete itemsCopy.default
        cleanProp.items = itemsCopy
      }

      if (propObj.properties && typeof propObj.properties === 'object') {
        cleanProp.properties = this.sanitizeToolSchema(propObj).properties
      }

      cleanProps[key] = cleanProp
    }

    const required = Array.isArray(rawSchema.required)
      ? rawSchema.required.filter((k: any) => typeof k === 'string' && k in cleanProps)
      : undefined

    return {
      type,
      properties: cleanProps,
      ...(required && required.length > 0 ? { required } : {})
    }
  }

  /**
   * Generate an ultra-compact summary of active MCP servers and their available tools
   * for injection into the system prompt during Lazy MCP mode.
   */
  static getMcpCatalogPrompt(activeTools: McpDiscoveredTool[]): string {
    if (!activeTools || activeTools.length === 0) return ''

    const byServer = new Map<string, McpDiscoveredTool[]>()
    for (const t of activeTools) {
      const list = byServer.get(t.serverName) || []
      list.push(t)
      byServer.set(t.serverName, list)
    }

    const sections: string[] = [
      '## Доступные MCP Серверы и Инструменты (Model Context Protocol):',
      'Для вызова любого инструмента используй универсальный инструмент `call_mcp_tool(server_name, tool_name, arguments)`.'
    ]

    for (const [serverName, tools] of byServer.entries()) {
      const toolSummaries = tools.map((t) => {
        const paramKeys = Object.keys(t.inputSchema?.properties || {}).join(', ')
        const paramsStr = paramKeys ? `(params: ${paramKeys})` : '()'
        const descStr = t.description ? ` — ${t.description.slice(0, 100)}` : ''
        return `  - **${t.name}**${paramsStr}${descStr}`
      })

      sections.push(`### Сервер: \`${serverName}\`\n${toolSummaries.join('\n')}`)
    }

    return sections.join('\n\n')
  }

  /**
   * Start/Test SSE MCP Server.
   */
  private static async _startSseServer(config: McpServerConfig): Promise<McpDiscoveredTool[]> {
    if (!config.url) {
      throw new Error('URL для подключения по SSE/HTTP не указан')
    }

    this._statusCache.set(config.id, { status: 'connecting', tools: [] })

    try {
      // Test endpoint with initialize or tools/list request
      const reqPayload = {
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/list',
        params: {}
      }

      const res = await fetch(config.url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(config.headers || {})
        },
        body: JSON.stringify(reqPayload)
      })

      if (!res.ok) {
        throw new Error(`HTTP Error ${res.status}: ${res.statusText}`)
      }

      const data: any = await res.json()
      const rawTools = data?.result?.tools || []

      const discovered: McpDiscoveredTool[] = rawTools.map((t: any) => ({
        name: t.name,
        serverName: config.name,
        serverId: config.id,
        description: t.description || '',
        inputSchema: t.inputSchema || { type: 'object', properties: {} }
      }))

      this._statusCache.set(config.id, {
        status: 'connected',
        tools: discovered,
        lastConnectedAt: new Date().toISOString()
      })
      this.cacheToolSchemas(config.name, discovered)

      return discovered
    } catch (err: any) {
      const msg = `Ошибка подключения к SSE: ${err?.message || err}`
      this._statusCache.set(config.id, { status: 'error', error: msg, tools: [] })
      throw new Error(msg)
    }
  }

  /**
   * Stop an MCP server process.
   */
  static stopServer(id: string): void {
    const procInfo = this._processes.get(id)
    if (procInfo) {
      try {
        this._rejectAllPending(procInfo, new Error('Сервер остановлен'))
        if (procInfo.process.pid) {
          this._killProcessTree(procInfo.process.pid)
        }
      } catch (e) {
        console.warn(`[McpService] Error stopping process ${id}:`, e)
      }
      this._processes.delete(id)
    }

    const cached = this._statusCache.get(id)
    if (cached && cached.status !== 'error') {
      this._statusCache.set(id, { ...cached, status: 'disconnected' })
    }
  }

  /**
   * Stop all active MCP server processes (for app shutdown).
   */
  static stopAll(): void {
    for (const id of this._processes.keys()) {
      this.stopServer(id)
    }
  }

  /**
   * Reconnect / Test connection for a server.
   */
  static async testConnection(id: string): Promise<{ success: boolean; server: McpServerItemUI; latencyMs?: number }> {
    const config = LocalStorageService.getStore<McpServerConfig[]>('mcp_servers', []).find((s) => s.id === id)
    if (!config) {
      throw new Error(`Сервер ${id} не найден`)
    }

    const startTime = Date.now()
    try {
      await this.startServer(config)
      const latencyMs = Date.now() - startTime
      return {
        success: true,
        server: this.getServer(id)!,
        latencyMs
      }
    } catch (err: any) {
      return {
        success: false,
        server: this.getServer(id)!,
        latencyMs: Date.now() - startTime
      }
    }
  }

  /**
   * Get all active discovered tools across all enabled MCP servers.
   */
  static async getActiveTools(): Promise<McpDiscoveredTool[]> {
    const servers = this.getAllServers().filter((s) => s.enabled)
    const allTools: McpDiscoveredTool[] = []

    for (const server of servers) {
      let proc = this._processes.get(server.id)
      if (!proc || proc.status !== 'connected') {
        try {
          const tools = await this.startServer(server)
          allTools.push(...tools)
        } catch (err) {
          console.warn(`[McpService] Failed to auto-connect ${server.name}:`, err)
        }
      } else {
        allTools.push(...proc.tools)
      }
    }

    return allTools
  }

  /**
   * Call a tool on an MCP server.
   */
  static async callTool(
    serverNameOrId: string,
    toolName: string,
    toolArgs: Record<string, unknown>,
    abortSignal?: AbortSignal
  ): Promise<ToolResult> {
    const allServers = this.getAllServers()
    const targetServer = allServers.find(
      (s) => s.id === serverNameOrId || s.name.toLowerCase() === serverNameOrId.toLowerCase()
    )

    if (!targetServer) {
      return {
        success: false,
        error: `MCP сервер «${serverNameOrId}» не найден в конфигурации`,
        formattedContent: `[Error: MCP server "${serverNameOrId}" not found]`
      }
    }

    // Ensure server is running
    let proc = this._processes.get(targetServer.id)
    if (targetServer.transport === 'stdio' && (!proc || proc.status !== 'connected')) {
      try {
        await this.startServer(targetServer)
        proc = this._processes.get(targetServer.id)
      } catch (err: any) {
        return {
          success: false,
          error: `Не удалось запустить сервер «${targetServer.name}»: ${err.message}`,
          formattedContent: `[Error: failed to start MCP server "${targetServer.name}": ${err.message}]`
        }
      }
    }

    if (abortSignal?.aborted) {
      return { success: false, error: 'Cancelled by user', formattedContent: 'Cancelled by user' }
    }

    try {
      if (targetServer.transport === 'sse' || targetServer.transport === 'http') {
        const payload = {
          jsonrpc: '2.0',
          id: Date.now(),
          method: 'tools/call',
          params: {
            name: toolName,
            arguments: toolArgs
          }
        }

        const res = await fetch(targetServer.url!, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(targetServer.headers || {})
          },
          body: JSON.stringify(payload),
          signal: abortSignal
        })

        const data: any = await res.json()
        if (data.error) {
          return {
            success: false,
            error: data.error.message || 'MCP Error',
            formattedContent: `[MCP Tool Error: ${data.error.message || 'Unknown'}]`
          }
        }

        return this._formatMcpResult(data.result)
      }

      // stdio call
      if (!proc) {
        throw new Error(`Процесс сервера «${targetServer.name}» не запущен`)
      }

      const res = await this._sendRpcRequest(
        proc,
        'tools/call',
        {
          name: toolName,
          arguments: toolArgs
        },
        60000,
        abortSignal
      )

      return this._formatMcpResult(res)
    } catch (err: any) {
      const errorMsg = err?.message || String(err)
      return {
        success: false,
        error: errorMsg,
        formattedContent: `[MCP Tool Execution Error in ${targetServer.name}/${toolName}: ${errorMsg}]`
      }
    }
  }

  /**
   * Format MCP response result into ToolResult.
   */
  private static _formatMcpResult(res: any): ToolResult {
    if (!res) {
      return { success: true, formattedContent: 'Tool executed with empty response.' }
    }

    const isError = Boolean(res.isError)
    const content = Array.isArray(res.content) ? res.content : []

    let textParts: string[] = []
    let images: string[] = []

    for (const item of content) {
      if (item.type === 'text' && typeof item.text === 'string') {
        textParts.push(item.text)
      } else if (item.type === 'image' && item.data) {
        const mime = item.mimeType || 'image/png'
        images.push(`data:${mime};base64,${item.data}`)
      } else if (typeof item === 'string') {
        textParts.push(item)
      } else {
        try {
          textParts.push(JSON.stringify(item, null, 2))
        } catch {
          // ignore
        }
      }
    }

    const formattedContent = textParts.length > 0 ? textParts.join('\n\n') : JSON.stringify(res, null, 2)

    return {
      success: !isError,
      formattedContent,
      error: isError ? formattedContent : undefined,
      data: {
        raw: res,
        images: images.length > 0 ? images : undefined
      }
    }
  }

  /**
   * Import configuration from standard Claude Desktop / Cursor / JSON format.
   */
  static importConfig(jsonContent: string): { success: boolean; count: number; error?: string } {
    try {
      const parsed = JSON.parse(jsonContent)
      const existingConfigs: McpServerConfig[] = LocalStorageService.getStore<McpServerConfig[]>('mcp_servers', [])
      let importedCount = 0

      // Case 1: Standard Claude Desktop / Cursor format: { "mcpServers": { "name": { "command": "...", "args": [...] } } }
      const serversObj = parsed.mcpServers && typeof parsed.mcpServers === 'object' ? parsed.mcpServers : parsed

      for (const [rawKey, val] of Object.entries(serversObj)) {
        if (!val || typeof val !== 'object') continue
        const item = val as any
        const name = rawKey.trim().toLowerCase().replace(/[^a-z0-9_-]/g, '_')
        if (!name) continue

        const id = `mcp_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`
        const newConfig: McpServerConfig = {
          id,
          name,
          description: item.description || '',
          transport: item.transport || (item.url ? 'sse' : 'stdio'),
          command: item.command || '',
          args: Array.isArray(item.args) ? item.args : [],
          env: item.env || {},
          cwd: item.cwd || undefined,
          url: item.url || undefined,
          headers: item.headers || {},
          enabled: item.enabled !== false,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        }

        const existingIdx = existingConfigs.findIndex((c) => c.name.toLowerCase() === name)
        if (existingIdx >= 0) {
          existingConfigs[existingIdx] = { ...newConfig, id: existingConfigs[existingIdx].id }
        } else {
          existingConfigs.push(newConfig)
        }
        importedCount++
      }

      LocalStorageService.setStore('mcp_servers', existingConfigs, 0)
      return { success: true, count: importedCount }
    } catch (err: any) {
      return { success: false, count: 0, error: `Неверный формат JSON: ${err.message}` }
    }
  }

  /**
   * Export all servers to standard JSON format.
   */
  static exportConfig(): { success: boolean; json?: string; error?: string } {
    try {
      const configs: McpServerConfig[] = LocalStorageService.getStore<McpServerConfig[]>('mcp_servers', [])
      const mcpServers: Record<string, any> = {}

      for (const c of configs) {
        mcpServers[c.name] = {
          command: c.command,
          args: c.args,
          env: Object.keys(c.env || {}).length > 0 ? c.env : undefined,
          cwd: c.cwd,
          url: c.url,
          transport: c.transport !== 'stdio' ? c.transport : undefined
        }
      }

      const output = JSON.stringify({ mcpServers }, null, 2)
      return { success: true, json: output }
    } catch (err: any) {
      return { success: false, error: err.message }
    }
  }

  /**
   * Fast health-check ping to check if an active stdio/sse server is alive.
   */
  static async pingServer(id: string): Promise<boolean> {
    const procInfo = this._processes.get(id)
    if (!procInfo || procInfo.status !== 'connected') return false
    try {
      await this._sendRpcRequest(procInfo, 'ping', {}, 3000)
      return true
    } catch {
      try {
        await this._sendRpcRequest(procInfo, 'tools/list', {}, 3000)
        return true
      } catch {
        return false
      }
    }
  }

  // ── JSON-RPC Internal Plumbing ───────────────────────────────────────────

  private static _handleStdoutLine(procInfo: ActiveProcessInfo, line: string): void {
    const trimmed = line.trim()
    if (!trimmed) return
    this._parseJsonRpcMessage(procInfo, trimmed)
  }

  private static _handleStdoutData(procInfo: ActiveProcessInfo, chunk: string): void {
    procInfo.buffer += chunk

    while (true) {
      // Check for Content-Length header framing if used
      if (procInfo.buffer.startsWith('Content-Length:')) {
        const headerEnd = procInfo.buffer.indexOf('\r\n\r\n')
        if (headerEnd === -1) break

        const match = procInfo.buffer.match(/Content-Length:\s*(\d+)/i)
        if (!match) {
          procInfo.buffer = procInfo.buffer.slice(headerEnd + 4)
          continue
        }

        const length = parseInt(match[1], 10)
        const bodyStart = headerEnd + 4
        if (procInfo.buffer.length < bodyStart + length) break

        const body = procInfo.buffer.slice(bodyStart, bodyStart + length)
        procInfo.buffer = procInfo.buffer.slice(bodyStart + length)
        this._parseJsonRpcMessage(procInfo, body)
        continue
      }

      // Line-delimited JSON
      const lineEnd = procInfo.buffer.indexOf('\n')
      if (lineEnd === -1) break

      const line = procInfo.buffer.slice(0, lineEnd).trim()
      procInfo.buffer = procInfo.buffer.slice(lineEnd + 1)

      if (line) {
        this._parseJsonRpcMessage(procInfo, line)
      }
    }
  }

  private static _parseJsonRpcMessage(procInfo: ActiveProcessInfo, text: string): void {
    let cleanJson = text
    // Handle cases where stdout contains banner prefixes before the JSON string
    if (!cleanJson.startsWith('{') && cleanJson.includes('{')) {
      const firstBrace = cleanJson.indexOf('{')
      const lastBrace = cleanJson.lastIndexOf('}')
      if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
        const prefix = cleanJson.slice(0, firstBrace).trim()
        if (prefix) {
          procInfo.stderrLogs.push(`[stdout-noise] ${prefix}`)
          if (procInfo.stderrLogs.length > 50) procInfo.stderrLogs.shift()
        }
        cleanJson = cleanJson.slice(firstBrace, lastBrace + 1)
      }
    }

    try {
      const msg = JSON.parse(cleanJson)
      if (msg && typeof msg === 'object' && msg.id !== undefined && procInfo.pendingRequests.has(msg.id)) {
        const pending = procInfo.pendingRequests.get(msg.id)!
        clearTimeout(pending.timer)
        procInfo.pendingRequests.delete(msg.id)

        if (msg.error) {
          pending.reject(new Error(msg.error.message || `JSON-RPC Error ${msg.error.code}`))
        } else {
          pending.resolve(msg.result)
        }
      }
    } catch {
      // Record non-JSON log lines into stderr logs for diagnostic inspection
      procInfo.stderrLogs.push(`[stdout] ${text.slice(0, 160)}`)
      if (procInfo.stderrLogs.length > 50) procInfo.stderrLogs.shift()
    }
  }

  private static _sendRpcRequest(
    procInfo: ActiveProcessInfo,
    method: string,
    params: any,
    timeoutMs: number = 30000,
    abortSignal?: AbortSignal
  ): Promise<any> {
    return new Promise((resolve, reject) => {
      if (abortSignal?.aborted) {
        return reject(new Error('Cancelled by user'))
      }

      const id = procInfo.nextRequestId++
      const payload = JSON.stringify({
        jsonrpc: '2.0',
        id,
        method,
        params
      }) + '\n'

      let onAbort: (() => void) | null = null

      const cleanup = () => {
        if (timer) clearTimeout(timer)
        procInfo.pendingRequests.delete(id)
        if (abortSignal && onAbort) {
          abortSignal.removeEventListener('abort', onAbort)
        }
      }

      const timer = setTimeout(() => {
        if (procInfo.pendingRequests.has(id)) {
          cleanup()
          reject(new Error(`MCP Request '${method}' timed out after ${timeoutMs}ms`))
        }
      }, timeoutMs)

      if (abortSignal) {
        onAbort = () => {
          if (procInfo.pendingRequests.has(id)) {
            cleanup()
            reject(new Error('Cancelled by user'))
          }
        }
        abortSignal.addEventListener('abort', onAbort, { once: true })
      }

      procInfo.pendingRequests.set(id, {
        resolve: (val) => { cleanup(); resolve(val) },
        reject: (err) => { cleanup(); reject(err) },
        timer
      })

      try {
        procInfo.process.stdin?.write(payload, 'utf8')
      } catch (err) {
        cleanup()
        reject(err)
      }
    })
  }

  private static _sendRpcNotification(procInfo: ActiveProcessInfo, method: string, params: any): void {
    try {
      const payload = JSON.stringify({
        jsonrpc: '2.0',
        method,
        params
      }) + '\n'
      procInfo.process.stdin?.write(payload, 'utf8')
    } catch (e) {
      console.warn(`[McpService] Failed to send notification ${method}:`, e)
    }
  }

  private static _rejectAllPending(procInfo: ActiveProcessInfo, err: Error): void {
    for (const [id, pending] of procInfo.pendingRequests.entries()) {
      clearTimeout(pending.timer)
      pending.reject(err)
    }
    procInfo.pendingRequests.clear()
  }
}
