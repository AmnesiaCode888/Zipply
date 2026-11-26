import type { ToolBase } from '../tools/ToolBase'
import { CyberSecCodeAudit, CyberSecPorts, CyberSecDns, CyberSecTls, CyberSecSecrets, CyberSecServerConfig, CyberSecHttpPosture } from './CyberSecTools'
import { AgentBase, type AgentContext } from '../core/AgentBase'
import { PluginManagerTool } from './PluginManagerTool'
import { SqliteInspectDatabase } from './SqliteTools'
import { PdfAnalyzeDocument } from './PdfTools'
import { pluginCatalog, type PluginCatalogEntry, type PluginId } from '../../../shared/plugins/catalog'

export interface ToolPackage extends PluginCatalogEntry {
  createTools: () => ToolBase[]
}

const toolFactories: Record<PluginId, () => ToolBase[]> = {
  cybersec: () => [new CyberSecCodeAudit(), new CyberSecSecrets(), new CyberSecServerConfig(), new CyberSecDns(), new CyberSecTls(), new CyberSecHttpPosture(), new CyberSecPorts()],
  sqlite: () => [new SqliteInspectDatabase()],
  pdf: () => [new PdfAnalyzeDocument()]
}

const catalogIds = new Set(pluginCatalog.map(plugin => plugin.id))
const unimplemented = pluginCatalog.filter(plugin => !toolFactories[plugin.id])
const unlisted = (Object.keys(toolFactories) as PluginId[]).filter(id => !catalogIds.has(id))
if (unimplemented.length || unlisted.length) {
  throw new Error(`Реестр плагинов не совпадает с каталогом: нет реализации [${unimplemented.map(item => item.id).join(', ')}], нет манифеста [${unlisted.join(', ')}].`)
}

export const builtInPackages: readonly ToolPackage[] = pluginCatalog.map(plugin => ({ ...plugin, createTools: toolFactories[plugin.id] }))
export const builtInPluginIds = builtInPackages.map(plugin => plugin.id)
export function createPluginTool(pluginId: string, toolId: string): ToolBase | undefined {
  const plugin = builtInPackages.find(item => item.id === pluginId)
  return plugin?.createTools().find(tool => tool.name === toolId)
}
export function getPluginToolIds(pluginId: string): string[] {
  return builtInPackages.find(item => item.id === pluginId)?.createTools().map(tool => tool.name) || []
}

export function validatePluginRegistry(baseToolNames: readonly string[] = [], packages: readonly ToolPackage[] = builtInPackages): string[] {
  const errors: string[] = []
  const seenPluginIds = new Set<string>()
  const seenToolIds = new Set<string>(['plugin_manager', ...baseToolNames.map(name => name.toLowerCase())])
  for (const plugin of packages) {
    const normalizedPluginId = plugin.id.toLowerCase()
    if (seenPluginIds.has(normalizedPluginId)) errors.push(`Повторяется ID плагина без учёта регистра: ${plugin.id}.`)
    seenPluginIds.add(normalizedPluginId)
    if (![plugin.name, plugin.version, plugin.summary, plugin.description, plugin.category, plugin.icon, plugin.safetyNotes].every(value => value.trim())) errors.push(`У плагина ${plugin.id} заполнены не все метаданные.`)
    if (!plugin.capabilities.length) errors.push(`У плагина ${plugin.id} не описаны возможности.`)
    if (!plugin.examples.length) errors.push(`У плагина ${plugin.id} нет примеров запросов.`)
    const tools = plugin.createTools()
    if (!tools.length) errors.push(`Плагин ${plugin.id} не содержит инструментов.`)
    for (const tool of tools) {
      const normalizedToolId = tool.name.toLowerCase()
      if (seenToolIds.has(normalizedToolId)) errors.push(`ID инструмента ${tool.name} конфликтует с другим инструментом, базовым инструментом или plugin_manager (без учёта регистра).`)
      seenToolIds.add(normalizedToolId)
      if (!tool.description.trim()) errors.push(`У инструмента ${tool.name} отсутствует описание.`)
    }
  }
  return errors
}

const registryErrors = validatePluginRegistry()
if (registryErrors.length) throw new Error(`Некорректный реестр плагинов: ${registryErrors.join(' ')}`)

/** Build a run-scoped snapshot; never mutate the shared agent registry. */
export function createAgentSnapshot(baseAgent: AgentBase, ids: readonly string[], options: { getLoadedToolIds?: () => readonly string[]; loadTool?: (pluginId: string, toolId: string) => void; runOnlyToolIds?: readonly string[] } = {}): AgentBase {
  const allBaseToolNames = [...baseAgent.getTools(), ...(baseAgent.getLegacyTools?.() || [])].map(tool => tool.name)
  const registryErrors = validatePluginRegistry(allBaseToolNames)
  if (registryErrors.length) throw new Error(`Некорректный реестр плагинов для агента ${baseAgent.id}: ${registryErrors.join(' ')}`)
  class RunAgent extends AgentBase {
    get id(): string { return baseAgent.id }
    get name(): string { return baseAgent.name }
    get isReadOnly(): boolean { return baseAgent.isReadOnly }
    getAvailablePluginsSummary(): string {
      return builtInPackages
        .filter(plugin => ids.includes(plugin.id))
        .map(plugin => `- ${plugin.name} (${plugin.id}): ${plugin.summary}`)
        .join('\n')
    }
    getSystemPrompt(context: AgentContext): string {
      const summaries = this.getAvailablePluginsSummary()
      const basePrompt = baseAgent.getSystemPrompt({ ...context, availablePluginsSummary: summaries })
      if (basePrompt.includes('<available_plugins>')) return basePrompt
      return `${basePrompt}\n\n<available_plugins>\nУстановленные плагины; чтобы узнать детали или подключить отдельный инструмент, используй plugin_manager.\n${summaries}\n</available_plugins>`
    }
  }
  const agent = new RunAgent()
  for (const tool of [...baseAgent.getTools()].sort((a, b) => a.name.localeCompare(b.name))) agent.addTool(tool)
  for (const tool of (baseAgent.getLegacyTools?.() || [])) agent.addLegacyTool(tool)
  const installed = new Set(ids)
  const loaded = new Set([
    ...(options.getLoadedToolIds?.() || []),
    ...(options.runOnlyToolIds || [])
  ].filter(toolId => ids.some(pluginId => Boolean(createPluginTool(pluginId, toolId)))))
  agent.addTool(new PluginManagerTool({
    installedPluginIds: [...installed],
    plugins: pluginCatalog,
    getLoadedToolIds: () => [...loaded],
    getPluginTools: pluginId => builtInPackages.find(plugin => plugin.id === pluginId)?.createTools() || [],
    loadTool: (pluginId, toolId) => {
      if (!installed.has(pluginId)) throw new Error(`Плагин ${pluginId} не установлен в этом чате.`)
      const tool = createPluginTool(pluginId, toolId)
      if (!tool) throw new Error(`Неизвестный инструмент ${toolId} в плагине ${pluginId}.`)
      if (agent.getHandler(toolId)) {
        if (!loaded.has(toolId)) throw new Error(`Инструмент ${toolId} уже занят базовым агентом.`)
        return
      }
      options.loadTool?.(pluginId, toolId)
      agent.addTool(tool)
      loaded.add(toolId)
    }
  }))
  for (const toolId of loaded) {
    const pluginId = ids.find(id => Boolean(createPluginTool(id, toolId)))
    const tool = pluginId ? createPluginTool(pluginId, toolId) : undefined
    if (!tool) continue
    if (agent.getHandler(tool.name)) throw new Error(`Конфликт имени инструмента плагина: ${tool.name}`)
    agent.addTool(tool)
  }
  return agent
}
