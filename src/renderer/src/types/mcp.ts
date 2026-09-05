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

export interface ClaudeDesktopMcpConfig {
  mcpServers?: Record<
    string,
    {
      command?: string
      args?: string[]
      env?: Record<string, string>
      cwd?: string
      url?: string
      headers?: Record<string, string>
      transport?: McpTransport
    }
  >
}
