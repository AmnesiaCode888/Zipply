import { ipcMain } from 'electron'
import type { McpServerInput } from '../agent/mcp/McpConfigStore'
import { requireMainFrame, type AgentExtensionServices } from './agentIpcTypes'

/**
 * Registers IPC endpoints for MCP server configuration, connections, and tool trust.
 */
export class McpIpcHandler {
  constructor(
    private readonly extensions: AgentExtensionServices,
    private readonly onServerReset: (serverId: string) => void
  ) {}

  private get mcpConnections() {
    return this.extensions.mcpConnections
  }

  register(): void {
    ipcMain.handle('mcp:addServer', (event, definition: unknown, auth: unknown) => {
      requireMainFrame(event)
      if (!this.mcpConnections || !definition || typeof definition !== 'object') throw new Error('MCP runtime недоступен.')
      let headers: Record<string, string> = {}
      if (auth !== undefined) {
        if (!auth || typeof auth !== 'object' || Array.isArray(auth)) throw new Error('Некорректные данные авторизации MCP.')
        const value = auth as Record<string, unknown>
        if (Object.keys(value).some(key => key !== 'headerName' && key !== 'headerValue') || typeof value.headerName !== 'string' || typeof value.headerValue !== 'string') {
          throw new Error('Некорректные данные авторизации MCP.')
        }
        if (value.headerValue) headers = { [value.headerName]: value.headerValue }
      }
      return this.mcpConnections.add(definition as McpServerInput, headers)
    })

    ipcMain.handle('mcp:setAuth', async (event, payload: unknown) => {
      requireMainFrame(event)
      if (!this.extensions.mcpConfig || !payload || typeof payload !== 'object') throw new Error('Настройки MCP недоступны.')
      const value = payload as Record<string, unknown>
      if (typeof value.serverId !== 'string' || typeof value.headerName !== 'string' || typeof value.headerValue !== 'string') {
        throw new Error('Некорректные данные авторизации MCP.')
      }
      this.mcpConnections?.requireReady(value.serverId)
      this.onServerReset(value.serverId)
      await this.extensions.mcpRuntime?.disconnect(value.serverId)
      this.extensions.mcpTrust?.revokeServer(value.serverId)
      this.extensions.mcpConfig.setAuthHeaders(value.serverId, value.headerValue ? { [value.headerName]: value.headerValue } : {})
      return true
    })

    ipcMain.handle('mcp:connect', async (event, serverId: unknown) => {
      requireMainFrame(event)
      if (!this.mcpConnections || typeof serverId !== 'string') throw new Error('MCP runtime недоступен.')
      return this.mcpConnections.connect(serverId)
    })

    ipcMain.handle('mcp:disconnect', async (event, serverId: unknown) => {
      requireMainFrame(event)
      if (!this.extensions.mcpRuntime || typeof serverId !== 'string') throw new Error('MCP runtime недоступен.')
      this.mcpConnections?.requireReady(serverId)
      await this.extensions.mcpRuntime.disconnect(serverId)
      return this.extensions.mcpRuntime.getStatus(serverId)
    })

    ipcMain.handle('mcp:removeServer', async (event, serverId: unknown) => {
      requireMainFrame(event)
      if (!this.extensions.mcpRuntime || !this.extensions.mcpConfig || typeof serverId !== 'string') throw new Error('MCP runtime недоступен.')
      this.mcpConnections?.requireReady(serverId)
      this.extensions.mcpTrust?.revokeServer(serverId)
      this.onServerReset(serverId)
      await this.extensions.mcpRuntime.removeServer(serverId)
      this.extensions.mcpConfig.remove(serverId)
      return true
    })

    ipcMain.handle('mcp:revokeToolTrust', (event, serverId: unknown, toolId: unknown) => {
      requireMainFrame(event)
      if (typeof serverId !== 'string' || typeof toolId !== 'string') throw new Error('Некорректный идентификатор MCP-инструмента.')
      this.extensions.mcpTrust?.revoke(serverId, toolId)
      return true
    })
  }
}
