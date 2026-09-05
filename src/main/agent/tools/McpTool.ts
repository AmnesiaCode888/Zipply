import { ToolBase, ToolParameterDef, ToolResult, ToolExecutionPolicy, ProgressCallback } from './ToolBase'
import { Blackboard } from '../core/Blackboard'
import { McpService, McpDiscoveredTool } from '../services/McpService'

/**
 * CallMcpTool — Universal ToolBase for executing tools provided by active MCP servers.
 */
export class CallMcpTool extends ToolBase {
  get name(): string {
    return 'call_mcp_tool'
  }

  get description(): string {
    return 'Call a tool on an external MCP (Model Context Protocol) server (e.g. database query, github action, API integrations).'
  }

  get parameters(): Record<string, ToolParameterDef> {
    return {
      server_name: {
        type: 'string',
        description: 'The name or ID of the MCP server hosting the tool (e.g. "sqlite", "github", "filesystem").',
        required: true
      },
      tool_name: {
        type: 'string',
        description: 'The name of the MCP tool to execute.',
        required: true
      },
      arguments: {
        type: 'object',
        description: 'Arguments payload object to pass to the MCP tool.',
        required: false
      },
      description: {
        type: 'string',
        description: 'Short 2-4 word summary in Russian of what this MCP tool call is doing.',
        required: false
      }
    }
  }

  getExecutionPolicy(_args: Record<string, unknown> = {}): ToolExecutionPolicy {
    return {
      mutates: true,
      parallelSafe: false,
      cacheable: false
    }
  }

  async execute(
    argumentsJson: string,
    _blackboard: Blackboard,
    abortSignal?: AbortSignal,
    onProgress?: ProgressCallback
  ): Promise<ToolResult> {
    let args: Record<string, any> = {}
    try {
      args = JSON.parse(argumentsJson || '{}')
    } catch {
      return {
        formattedContent: 'Error: invalid JSON payload for call_mcp_tool.'
      }
    }

    const serverName = (args.server_name || '').trim()
    const toolName = (args.tool_name || '').trim()
    const toolArgs = args.arguments && typeof args.arguments === 'object' ? args.arguments : {}

    if (!serverName || !toolName) {
      return {
        formattedContent: 'Error: server_name and tool_name are required.'
      }
    }

    onProgress?.({
      message: `Выполнение MCP инструмента ${serverName}/${toolName}...`,
      statusText: 'running'
    })

    return McpService.callTool(serverName, toolName, toolArgs, abortSignal)
  }
}

/**
 * DynamicMcpToolWrapper — Wraps an individual discovered MCP tool as a native ToolBase.
 */
export class DynamicMcpToolWrapper extends ToolBase {
  private _mcpTool: McpDiscoveredTool

  constructor(mcpTool: McpDiscoveredTool) {
    super()
    this._mcpTool = mcpTool
  }

  get name(): string {
    // OpenAI / Gemini function naming format
    const sanitizedServer = this._mcpTool.serverName.replace(/[^a-zA-Z0-9_]/g, '_')
    const sanitizedTool = this._mcpTool.name.replace(/[^a-zA-Z0-9_]/g, '_')
    return `mcp_${sanitizedServer}_${sanitizedTool}`
  }

  get description(): string {
    const desc = this._mcpTool.description ? ` - ${this._mcpTool.description}` : ''
    return `[MCP: ${this._mcpTool.serverName}] ${this._mcpTool.name}${desc}`
  }

  get parameters(): Record<string, ToolParameterDef> {
    const schemaProps = this._mcpTool.inputSchema?.properties || {}
    const requiredKeys = new Set(this._mcpTool.inputSchema?.required || [])
    const res: Record<string, ToolParameterDef> = {}

    for (const [key, prop] of Object.entries(schemaProps)) {
      res[key] = {
        type: prop.type || 'string',
        description: prop.description || key,
        required: requiredKeys.has(key),
        enum: prop.enum,
        items: prop.items,
        properties: prop.properties
      }
    }

    // Always append optional description for Zipply standard logging
    if (!res.description) {
      res.description = {
        type: 'string',
        description: 'Short 2-4 word summary in Russian describing what this MCP tool call is doing.',
        required: false
      }
    }

    return res
  }

  getExecutionPolicy(_args: Record<string, unknown> = {}): ToolExecutionPolicy {
    return {
      mutates: true,
      parallelSafe: false,
      cacheable: false
    }
  }

  async execute(
    argumentsJson: string,
    _blackboard: Blackboard,
    abortSignal?: AbortSignal,
    onProgress?: ProgressCallback
  ): Promise<ToolResult> {
    let args: Record<string, any> = {}
    try {
      args = JSON.parse(argumentsJson || '{}')
    } catch {
      args = {}
    }

    onProgress?.({
      message: `Вызов MCP: ${this._mcpTool.serverName}/${this._mcpTool.name}...`,
      statusText: 'running'
    })

    return McpService.callTool(this._mcpTool.serverId, this._mcpTool.name, args, abortSignal)
  }
}

/**
 * ManageMcpTool — Allows the AI agent to register, list, configure, toggle, or remove MCP servers in Zipply.
 */
export class ManageMcpTool extends ToolBase {
  get name(): string {
    return 'manage_mcp'
  }

  get description(): string {
    return 'Manage MCP (Model Context Protocol) servers in Zipply: add_server, list_servers, remove_server, toggle_server, get_server.'
  }

  get parameters(): Record<string, ToolParameterDef> {
    return {
      description: {
        type: 'string',
        description: 'Краткое действие (2-4 слова, напр. "Подключение MCP SQLite")',
        required: false
      },
      action: {
        type: 'string',
        description: 'Operation: add_server, list_servers, remove_server, toggle_server, get_server',
        required: true,
        enum: ['add_server', 'list_servers', 'remove_server', 'toggle_server', 'get_server']
      },
      name: {
        type: 'string',
        description: '[Required for add_server] Unique alphanumeric name of the MCP server (e.g. "sqlite", "filesystem", "github")',
        required: false
      },
      server_id: {
        type: 'string',
        description: '[Required for remove_server, toggle_server, get_server] Server ID or name',
        required: false
      },
      transport: {
        type: 'string',
        description: 'Transport type: stdio (default), sse, http',
        required: false,
        enum: ['stdio', 'sse', 'http']
      },
      command: {
        type: 'string',
        description: '[Required for stdio transport] Executable command (e.g. "npx", "uvx", "node", "python")',
        required: false
      },
      args: {
        type: 'array',
        description: 'Arguments to pass to the command (e.g. ["-y", "@modelcontextprotocol/server-sqlite", "--db-path", "data.db"])',
        required: false,
        items: { type: 'string' }
      },
      env: {
        type: 'object',
        description: 'Environment variables key-value map (e.g. {"GITHUB_PERSONAL_ACCESS_TOKEN": "..."})',
        required: false
      },
      url: {
        type: 'string',
        description: '[For sse/http transport] URL endpoint of the MCP server',
        required: false
      },
      cwd: {
        type: 'string',
        description: 'Working directory for the server process',
        required: false
      },
      server_description: {
        type: 'string',
        description: 'Human-readable description of what this MCP server provides',
        required: false
      },
      enabled: {
        type: 'boolean',
        description: 'Whether to enable and auto-connect the server (default: true)',
        required: false
      }
    }
  }

  getExecutionPolicy(args: Record<string, unknown> = {}): ToolExecutionPolicy {
    const action = String(args.action || '').toLowerCase()
    const mutates = ['add_server', 'remove_server', 'toggle_server'].includes(action)
    return {
      mutates,
      parallelSafe: !mutates,
      cacheable: false
    }
  }

  async execute(
    argumentsJson: string,
    blackboard: Blackboard,
    _abortSignal?: AbortSignal,
    onProgress?: ProgressCallback
  ): Promise<ToolResult> {
    let args: Record<string, any> = {}
    try {
      args = JSON.parse(argumentsJson || '{}')
    } catch {
      return { formattedContent: 'Ошибка: некорректный JSON аргументов.' }
    }

    const action = (args.action || '').toLowerCase().trim()
    if (!action) {
      return { formattedContent: 'Ошибка: параметр action обязателен.' }
    }

    switch (action) {
      case 'list_servers': {
        const servers = McpService.getAllServers()
        if (servers.length === 0) {
          return {
            formattedContent: 'В Zipply пока нет зарегистрированных MCP-серверов. Для добавления используй action="add_server".',
            data: { count: 0, servers: [] }
          }
        }
        const list = servers.map((s) => {
          const toolsCount = s.tools?.length || 0
          const toolNames = toolsCount > 0 ? ` (инструменты: ${s.tools.slice(0, 5).map((t) => t.name).join(', ')}${toolsCount > 5 ? ` + еще ${toolsCount - 5}` : ''})` : ''
          const statusIcon = s.status === 'connected' ? '🟢' : s.status === 'connecting' ? '🟡' : s.status === 'error' ? '🔴' : '⚪'
          return `- **${s.name}** [${s.transport}] ${statusIcon} (${s.status})${toolNames}: ${s.description || 'нет описания'}\n  Команда: \`${s.command} ${(s.args || []).join(' ')}\``
        })
        return {
          formattedContent: `=== ЗАРЕГИСТРИРОВАННЫЕ MCP СЕРВЕРЫ (${servers.length}) ===\n\n${list.join('\n\n')}`,
          data: { count: servers.length, servers }
        }
      }

      case 'add_server': {
        const name = (args.name || args.server_name || '').trim()
        if (!name) {
          return { formattedContent: 'Ошибка: имя сервера (name) обязательно для add_server.' }
        }
        const transport = (args.transport || 'stdio').toLowerCase() as any
        const command = (args.command || '').trim()
        const url = (args.url || '').trim()

        if (transport === 'stdio' && !command) {
          return { formattedContent: 'Ошибка: параметр command обязателен для stdio MCP сервера (например, "npx", "uvx", "node").' }
        }
        if ((transport === 'sse' || transport === 'http') && !url) {
          return { formattedContent: 'Ошибка: параметр url обязателен для sse/http MCP сервера.' }
        }

        onProgress?.({
          message: `Регистрация и запуск MCP сервера «${name}»...`,
          statusText: 'running'
        })

        try {
          const saved = await McpService.saveServer({
            name,
            description: args.server_description || args.description || '',
            transport,
            command,
            args: Array.isArray(args.args) ? args.args.map(String) : [],
            env: typeof args.env === 'object' && args.env !== null ? args.env : {},
            cwd: args.cwd?.trim() || (blackboard?.getArtifact('workspacePath') as string) || undefined,
            url: url || undefined,
            enabled: args.enabled !== false
          })

          const toolsCount = saved.tools?.length || 0
          const toolList = toolsCount > 0 ? `\nОбнаружено инструментов (${toolsCount}): ${saved.tools.map((t) => `mcp_${saved.name}_${t.name}`).join(', ')}` : ''

          return {
            formattedContent: `Успех: MCP сервер «${saved.name}» успешно добавлен и зарегистрирован в Zipply!\nСтатус: ${saved.status}${toolList}\nСервер отображается в Настройках («MCP Серверы») и доступен для вызовов.`,
            data: saved
          }
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err)
          return { formattedContent: `Ошибка при добавлении MCP сервера «${name}»: ${msg}` }
        }
      }

      case 'remove_server': {
        const idOrName = (args.server_id || args.name || args.server_name || '').trim()
        if (!idOrName) {
          return { formattedContent: 'Ошибка: укажи server_id или name для remove_server.' }
        }
        const servers = McpService.getAllServers()
        const target = servers.find((s) => s.id === idOrName || s.name.toLowerCase() === idOrName.toLowerCase())
        if (!target) {
          return { formattedContent: `Ошибка: MCP сервер «${idOrName}» не найден.` }
        }
        McpService.deleteServer(target.id)
        return {
          formattedContent: `Успех: MCP сервер «${target.name}» удален из Zipply.`,
          data: { id: target.id, name: target.name }
        }
      }

      case 'toggle_server': {
        const idOrName = (args.server_id || args.name || args.server_name || '').trim()
        if (!idOrName) {
          return { formattedContent: 'Ошибка: укажи server_id или name для toggle_server.' }
        }
        const servers = McpService.getAllServers()
        const target = servers.find((s) => s.id === idOrName || s.name.toLowerCase() === idOrName.toLowerCase())
        if (!target) {
          return { formattedContent: `Ошибка: MCP сервер «${idOrName}» не найден.` }
        }
        try {
          const updated = await McpService.toggleServer(target.id, args.enabled)
          return {
            formattedContent: `Успех: MCP сервер «${updated.name}» ${updated.enabled ? 'включен и запущен' : 'отключен'}. Статус: ${updated.status}.`,
            data: updated
          }
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err)
          return { formattedContent: `Ошибка при переключении MCP сервера: ${msg}` }
        }
      }

      case 'get_server': {
        const idOrName = (args.server_id || args.name || args.server_name || '').trim()
        if (!idOrName) {
          return { formattedContent: 'Ошибка: укажи server_id или name для get_server.' }
        }
        const servers = McpService.getAllServers()
        const target = servers.find((s) => s.id === idOrName || s.name.toLowerCase() === idOrName.toLowerCase())
        if (!target) {
          return { formattedContent: `Ошибка: MCP сервер «${idOrName}» не найден.` }
        }
        return {
          formattedContent: `=== MCP СЕРВЕР [${target.name}] ===\nID: ${target.id}\nСтатус: ${target.status}\nТранспорт: ${target.transport}\nКоманда: ${target.command} ${(target.args || []).join(' ')}\nИнструменты (${target.tools.length}): ${target.tools.map((t) => t.name).join(', ') || 'нет'}`,
          data: target
        }
      }

      default:
        return { formattedContent: `Неизвестное действие MCP: ${action}. Доступные: add_server, list_servers, remove_server, toggle_server, get_server.` }
    }
  }
}

