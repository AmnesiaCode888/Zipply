import type { AgentBase } from '../core/AgentBase'
import { PluginManagerTool } from '../plugins/PluginManagerTool'
import { McpToolAdapter } from '../mcp/McpToolAdapter'
import type { McpRuntimeManager, McpToolDescriptor } from '../mcp/McpRuntimeManager'

export interface SkillToolBindingStatus {
  reference: string
  status: string
}

export interface SkillToolBindingContext {
  agent: AgentBase
  installedPlugins: readonly string[]
  selectedMcpServers: ReadonlySet<string>
  canActivateMcpTools?: boolean
  mcp?: McpRuntimeManager
  loadMcpTool?: (serverId: string, toolId: string) => McpToolDescriptor | undefined
  connectConfiguredMcp?: (query: string, signal?: AbortSignal) => Promise<{ connected: string[]; failed: string[]; notAttempted?: string[] }>
  connectMcpServer?: (serverId: string, signal?: AbortSignal) => Promise<boolean>
}

export async function activateSkillToolBindings(
  references: readonly string[],
  context: SkillToolBindingContext,
  signal?: AbortSignal
): Promise<SkillToolBindingStatus[]> {
  const statuses: SkillToolBindingStatus[] = []
  for (const reference of references) {
    const core = /^core:([a-zA-Z0-9_-]{1,128})$/.exec(reference)
    if (core) {
      const tool = context.agent.getHandler(core[1])
      statuses.push({
        reference,
        status: tool ? `Встроенный инструмент ${tool.name} доступен в этом запуске.` : `Встроенный инструмент ${core[1]} недоступен для выбранного агента.`
      })
      continue
    }

    const plugin = /^plugin:([a-zA-Z0-9_-]{1,64})\/([a-zA-Z0-9_-]{1,128})$/.exec(reference)
    if (plugin) {
      const manager = context.agent.getHandler('plugin_manager')
      if (!context.installedPlugins.includes(plugin[1]) || !(manager instanceof PluginManagerTool)) {
        statuses.push({ reference, status: `Для ${reference} сначала установите плагин.` })
        continue
      }
      try {
        const activated = manager.loadTool(plugin[1], plugin[2])
        statuses.push({
          reference,
          status: activated.alreadyLoaded
            ? `Инструмент ${activated.tool.name} уже подключён.`
            : `Инструмент ${activated.tool.name} подключён и доступен со следующего шага.`
        })
      } catch (error) {
        statuses.push({ reference, status: error instanceof Error ? error.message : String(error) })
      }
      continue
    }

    const mcp = /^mcp:([a-zA-Z0-9_-]{1,64})\/([a-zA-Z0-9_-]{1,128})$/.exec(reference)
    if (mcp) {
      const [, serverId, toolId] = mcp
      if (context.canActivateMcpTools === false) {
        statuses.push({ reference, status: 'Инструмент MCP не подключён: текущий режим не разрешает вызовы внешних инструментов.' })
        continue
      }
      if (!context.selectedMcpServers.has(serverId)) {
        try {
          const connected = await context.connectMcpServer?.(serverId, signal)
          if (!connected) {
            statuses.push({ reference, status: `MCP-сервер «${serverId}» не настроен как удалённый HTTP-сервер профиля. Сначала настройте его в расширениях.` })
            continue
          }
        } catch (error) {
          statuses.push({ reference, status: error instanceof Error ? error.message : `Не удалось подключить MCP-сервер «${serverId}».` })
          continue
        }
      }
      const descriptor = context.mcp?.listTools().find(tool => tool.serverId === serverId && tool.id === toolId)
      if (!descriptor || !context.mcp) {
        statuses.push({ reference, status: `Инструмент ${reference} сейчас не опубликован выбранным сервером.` })
        continue
      }
      if (context.loadMcpTool) {
        if (!context.loadMcpTool(serverId, toolId)) {
          statuses.push({ reference, status: `Инструмент ${reference} сейчас недоступен.` })
          continue
        }
      } else if (!context.agent.getHandler(descriptor.id)) {
        context.agent.addTool(new McpToolAdapter(serverId, descriptor, context.mcp))
      }
      statuses.push({ reference, status: `Инструмент ${descriptor.remoteName} доступен через выбранный MCP-сервер.` })
      continue
    }

    statuses.push({ reference, status: 'Ссылка на инструмент не распознана и пропущена.' })
  }
  return statuses
}

export function describeSkillToolReference(reference: string, context: SkillToolBindingContext): string | undefined {
  const core = /^core:([a-zA-Z0-9_-]{1,128})$/.exec(reference)
  if (core) {
    const tool = context.agent.getHandler(core[1])
    return tool ? `${tool.name}: ${tool.description}` : undefined
  }

  const plugin = /^plugin:([a-zA-Z0-9_-]{1,64})\/([a-zA-Z0-9_-]{1,128})$/.exec(reference)
  if (plugin && context.installedPlugins.includes(plugin[1])) {
    const manager = context.agent.getHandler('plugin_manager')
    if (manager instanceof PluginManagerTool) {
      try {
        return manager.describeTool(plugin[1], plugin[2])
      } catch {
        return undefined
      }
    }
  }

  const mcp = /^mcp:([a-zA-Z0-9_-]{1,64})\/([a-zA-Z0-9_-]{1,128})$/.exec(reference)
  if (mcp && context.selectedMcpServers.has(mcp[1])) {
    const descriptor = context.mcp?.listTools().find(tool => tool.serverId === mcp[1] && tool.id === mcp[2])
    return descriptor ? `${descriptor.remoteName}: ${descriptor.description}` : undefined
  }

  return undefined
}
