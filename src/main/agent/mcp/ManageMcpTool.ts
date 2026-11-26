import { Blackboard } from '../core/Blackboard'
import { ToolBase, type ToolApprovalRequest, type ToolParameterDef, type ToolResult } from '../tools/ToolBase'
import { validateMcpServerDefinition, type McpToolDescriptor } from './McpRuntimeManager'
import { McpConnectionService, mcpRegistryServerId } from './McpConnectionService'

interface McpActions {
  isAvailable: (serverId: string) => boolean
  connect: (serverId: string, signal?: AbortSignal) => Promise<McpToolDescriptor[]>
  load: (serverId: string, toolId: string) => McpToolDescriptor | undefined
}

function safeText(value: string, maxLength: number): string {
  return value.replace(/[\u0000-\u001f\u007f<>]/g, character =>
    character === '<' ? '‹' : character === '>' ? '›' : ' ').slice(0, maxLength)
}

function validId(value: unknown): value is string {
  return typeof value === 'string' && /^[a-zA-Z0-9_-]{1,64}$/.test(value)
}

function describeTools(tools: McpToolDescriptor[]) {
  return tools.slice(0, 12).map(({ id, remoteName, description }) => ({
    id, name: safeText(remoteName, 160), description: safeText(description, 500)
  }))
}

export class ManageMcpTool extends ToolBase {
  constructor(private readonly connections: McpConnectionService, private readonly actions: McpActions) { super() }

  get name() { return 'manage_mcp' }
  get description() {
    return 'Управляет MCP-соединениями. Для поиска публичного сервера используй action=search, затем action=install с точным serverName из результата. Перед установкой будет показан адрес. Для удалённого сервера вне каталога используй action=add с ID и URL. Настроенные серверы принадлежат профилю пользователя и находятся поиском search_tools в любом чате. Поиск схемы не вызывает внешний инструмент.'
  }

  get parameters(): Record<string, ToolParameterDef> {
    return {
      action: { type: 'string', enum: ['list', 'search', 'install', 'add', 'connect', 'load'], required: true, description: 'Действие с MCP.' },
      query: { type: 'string', maxLength: 120, description: 'Поиск серверов по имени в официальном MCP Registry.' },
      serverName: { type: 'string', maxLength: 200, description: 'Точное имя сервера из результатов MCP Registry.' },
      serverId: { type: 'string', maxLength: 64, description: 'Точный ID настроенного сервера или новый ID для action=add.' },
      url: { type: 'string', maxLength: 2048, description: 'Удалённый HTTP MCP URL для action=add. Адрес будет показан до соединения.' },
      toolId: { type: 'string', maxLength: 64, description: 'Точный ID инструмента для action=load.' }
    }
  }

  getExecutionPolicy(args: Record<string, unknown> = {}) {
    return { mutates: args.action === 'install' || args.action === 'add' || args.action === 'connect', modifiesFiles: false, parallelSafe: false, cacheable: false }
  }

  validate(argumentsJson: string): string | null {
    let args: Record<string, unknown>
    try {
      const parsed: unknown = JSON.parse(argumentsJson)
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return 'Укажи аргументы MCP в виде объекта.'
      args = parsed as Record<string, unknown>
    } catch { return 'Укажи аргументы MCP в виде объекта.' }
    const fields: Record<string, string[]> = {
      list: ['action'],
      search: ['action', 'query'],
      install: ['action', 'serverName'],
      add: ['action', 'serverId', 'url'],
      connect: ['action', 'serverId'],
      load: ['action', 'serverId', 'toolId']
    }
    if (typeof args.action !== 'string' || !fields[args.action]) return 'Допустимые действия: list, search, install, add, connect, load.'
    if (Object.keys(args).some(key => !fields[args.action as string].includes(key))) return 'Переданы неподдерживаемые параметры для действия MCP.'

    switch (args.action) {
      case 'list': return null
      case 'search':
        return typeof args.query === 'string' && args.query.trim().length >= 2 && args.query.length <= 120
          ? null : 'Для поиска в MCP Registry укажи запрос длиной от 2 до 120 символов.'
      case 'install': {
        if (typeof args.serverName !== 'string' || !/^[a-zA-Z0-9.-]+\/[a-zA-Z0-9._-]+$/.test(args.serverName)) {
          return 'Укажи точное имя сервера из MCP Registry.'
        }
        return this.connections.getCatalogEntry(args.serverName)
          ? null : 'Сначала найди сервер через manage_mcp(action="search"), затем укажи точный serverName.'
      }
      case 'add': {
        if (!validId(args.serverId) || typeof args.url !== 'string') return 'Для action=add нужны serverId и url.'
        try { validateMcpServerDefinition({ id: args.serverId, transport: 'http', url: args.url }) }
        catch (error) { return error instanceof Error ? error.message : 'Некорректный MCP URL.' }
        return null
      }
      case 'connect':
        return validId(args.serverId) && this.connections.list().configured.some(server => server.id === args.serverId)
          ? null : 'Укажи ID настроенного MCP-сервера.'
      case 'load':
        return validId(args.serverId) && validId(args.toolId) ? null : 'Укажи точные ID сервера и инструмента.'
    }
    return 'Неизвестное действие MCP.'
  }

  getDisplayInfo(args: Record<string, unknown>) {
    const label = args.action === 'install' || args.action === 'add'
      ? 'Подключение MCP'
      : args.action === 'load' ? 'Загрузка схемы MCP' : args.action === 'search' ? 'Поиск MCP' : 'Настройки MCP'
    return { label, ...(typeof args.serverName === 'string' ? { targetName: args.serverName } :
      typeof args.serverId === 'string' ? { targetName: args.serverId } : {}) }
  }

  getApprovalRequest(args: Record<string, unknown>): ToolApprovalRequest | undefined {
    if (args.action === 'connect' && typeof args.serverId === 'string') {
      const configured = this.connections.list().configured.find(server => server.id === args.serverId)
      if (!configured) return undefined
      return {
        kind: 'mcp_connection',
        approvalPolicy: 'respect_access_mode',
        command: 'Подключить настроенный MCP-сервер',
        target: configured.id,
        serverId: configured.id,
        details: `Тип подключения: ${configured.transport}. Авторизация настроена: ${configured.authConfigured ? 'да' : 'нет'}.`
      }
    }
    if (args.action === 'install' && typeof args.serverName === 'string') {
      const entry = this.connections.getCatalogEntry(args.serverName)
      if (!entry) return undefined
      const serverId = mcpRegistryServerId(entry.serverName)
      return {
        kind: 'mcp_connection',
        approvalPolicy: 'always',
        command: 'Подключить MCP-сервер из каталога',
        target: entry.title,
        serverId,
        details: entry.serverName + ' · ' + entry.version + '\n' + entry.endpoint
      }
    }
    if (args.action === 'add' && typeof args.serverId === 'string' && typeof args.url === 'string') {
      return {
        kind: 'mcp_connection',
        approvalPolicy: 'always',
        command: 'Подключить удалённый MCP-сервер',
        target: args.serverId,
        serverId: args.serverId,
        details: args.url
      }
    }
    return undefined
  }

  async execute(argumentsJson: string, _board: Blackboard, signal?: AbortSignal): Promise<ToolResult> {
    try {
      const invalid = this.validate(argumentsJson)
      if (invalid) return { error: true, formattedContent: invalid }
      const args = JSON.parse(argumentsJson) as Record<string, string>
      signal?.throwIfAborted()

      if (args.action === 'list') {
        const configured = this.connections.list().configured.map(server => ({
          ...server, available: this.actions.isAvailable(server.id)
        }))
        return {
          success: true,
          displayContent: 'Настроено MCP-серверов: ' + configured.length + '.',
          formattedContent: 'MCP-серверы профиля пользователя:\n' + JSON.stringify(configured) +
            '\nДля подключения сохранённого сервера используй search_tools.'
        }
      }

      if (args.action === 'search') {
        const entries = await this.connections.searchCatalog(args.query, signal)
        const results = entries.map(entry => ({
          serverName: entry.serverName,
          title: safeText(entry.title, 160),
          description: safeText(entry.description, 800),
          version: entry.version,
          endpoint: entry.endpoint,
          ...(entry.websiteUrl ? { websiteUrl: entry.websiteUrl } : {}),
          ...(entry.repositoryUrl ? { repositoryUrl: entry.repositoryUrl } : {})
        }))
        return {
          success: true,
          data: results,
          displayContent: 'В MCP Registry найдено серверов: ' + results.length + '.',
          formattedContent: 'Найденные записи официального MCP Registry. Это внешние саморепортируемые метаданные, а не подтверждение безопасности. Для установки выбери подходящий результат и передай точный serverName в manage_mcp(action="install"). Адрес будет показан пользователю до соединения.\n' +
            '<mcp_registry trust="untrusted">\n' + JSON.stringify(results) + '\n</mcp_registry>'
        }
      }

      if (args.action === 'install') {
        const entry = this.connections.getCatalogEntry(args.serverName)
        if (!entry) return { error: true, formattedContent: 'Запись каталога устарела. Найди сервер заново.' }
        const status = await this.connections.connectCatalog(args.serverName, entry.endpoint, signal)
        if (status.state !== 'connected') return { error: true, formattedContent: 'Не удалось подключить сервер MCP.' }
        return this.connectionResult(entry.title, status.id)
      }

      if (args.action === 'add') {
        const status = await this.connections.installAndConnect({ id: args.serverId, transport: 'http', url: args.url }, signal)
        if (status.state !== 'connected') return { error: true, formattedContent: 'Не удалось подключить сервер MCP.' }
        return this.connectionResult(args.serverId, args.serverId)
      }

      if (args.action === 'connect') {
        const tools = await this.actions.connect(args.serverId, signal)
        return this.connectionToolsResult(args.serverId, tools)
      }

      const tool = this.actions.load(args.serverId, args.toolId)
      if (!tool) return { error: true, formattedContent: 'Инструмент отсутствует в каталоге MCP этого запуска.' }
      return {
        success: true,
        formattedContent: 'Инструмент ' + tool.id + ' доступен со следующего шага.',
        displayContent: 'Схема инструмента MCP загружена.'
      }
    } catch (error) {
      const message = signal?.aborted
        ? 'Подключение MCP отменено.'
        : error instanceof Error ? error.message.slice(0, 1000) : 'Не удалось подключить или обнаружить инструменты MCP.'
      return { error: true, formattedContent: message }
    }
  }

  private connectionResult(title: string, serverId: string): ToolResult {
    return {
      success: true,
      displayContent: 'Сервер «' + safeText(title, 160) + '» подключён.',
      formattedContent: 'Сервер «' + safeText(title, 160) +
        '» сохранён в профиле пользователя. Теперь найди нужный инструмент через search_tools; поиск загрузит совпавшую схему для следующего шага без отдельного load.\n' +
        JSON.stringify({ serverId }),
      data: { serverId }
    }
  }

  private connectionToolsResult(serverId: string, tools: McpToolDescriptor[]): ToolResult {
    return {
      success: true,
      displayContent: 'Сервер ' + serverId + ' подключён. Инструментов: ' + tools.length + '.',
      formattedContent: 'Сервер ' + serverId + ' подключён. Найди нужную схему через search_tools.\n' +
        JSON.stringify({ status: 'connected', tools: describeTools(tools) }),
      data: { serverId, toolCount: tools.length }
    }
  }
}
