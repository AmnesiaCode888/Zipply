import { Blackboard } from '../core/Blackboard'
import { ToolBase, type ToolParameterDef, type ToolResult } from '../tools/ToolBase'
import type { PluginCatalogEntry } from '../../../shared/plugins/catalog'

export interface PluginToolManagerOptions {
  installedPluginIds: string[]
  plugins: readonly PluginCatalogEntry[]
  getLoadedToolIds: () => readonly string[]
  getPluginTools: (pluginId: string) => ToolBase[]
  loadTool: (pluginId: string, toolId: string) => void
}

export class PluginManagerTool extends ToolBase {
  constructor(private readonly options: PluginToolManagerOptions) { super() }

  get name(): string { return 'plugin_manager' }
  get description(): string { return 'Показывает краткий каталог установленных плагинов, документацию выбранного плагина или инструмента, либо подключает один инструмент к этому чату. Загрузка только добавляет инструмент для следующего запроса и не выполняет его.' }
  getExecutionPolicy(): { mutates: boolean; parallelSafe: boolean; cacheable: boolean } { return { mutates: false, parallelSafe: false, cacheable: false } }
  get parameters(): Record<string, ToolParameterDef> {
    return {
      action: { type: 'string', description: 'Действие каталога плагинов.', enum: ['list', 'describe', 'load'], required: true },
      pluginId: { type: 'string', description: 'Идентификатор установленного плагина, например cybersec.' },
      toolId: { type: 'string', description: 'Идентификатор одного инструмента плагина, например cybersec_audit_project.' }
    }
  }

  async execute(argumentsJson: string, _board: Blackboard): Promise<ToolResult> {
    let args: { action?: string; pluginId?: string; toolId?: string }
    try { args = JSON.parse(argumentsJson || '{}') }
    catch { return { error: true, formattedContent: 'Некорректные аргументы plugin_manager.' } }
    if (!['list', 'describe', 'load'].includes(args.action || '')) return { error: true, formattedContent: 'Укажи действие list, describe или load.' }

    const installed = new Set(this.options.installedPluginIds)
    const loaded = new Set(this.options.getLoadedToolIds())
    if (args.action === 'list') {
      const catalog = this.options.plugins.filter(plugin => installed.has(plugin.id)).map(plugin => ({ id: plugin.id, name: plugin.name, version: plugin.version, summary: plugin.summary, status: 'installed', loadedTools: this.options.getPluginTools(plugin.id).map(tool => tool.name).filter(toolId => loaded.has(toolId)) }))
      return { success: true, data: catalog, formattedContent: catalog.length ? catalog.map(plugin => `${plugin.name} (${plugin.id}) — ${plugin.summary}${plugin.loadedTools.length ? `; загружено: ${plugin.loadedTools.join(', ')}` : '; инструменты не загружены'}`).join('\n') : 'Нет установленных плагинов.' }
    }

    if (!args.pluginId || !installed.has(args.pluginId)) return { error: true, formattedContent: 'Плагин не установлен или не существует.' }
    const plugin = this.options.plugins.find(item => item.id === args.pluginId)
    if (!plugin) return { error: true, formattedContent: 'Неизвестный плагин.' }
    if (!args.toolId) {
      if (args.action === 'load') return { error: true, formattedContent: 'Укажи toolId: за один раз загружается только один инструмент.' }
      const tools = this.toolsFor(plugin.id)
      return { success: true, data: { ...plugin, tools: tools.map(tool => ({ id: tool.name, description: tool.description, parameters: tool.parameters, loaded: loaded.has(tool.name) })) }, formattedContent: `${plugin.name}: ${plugin.summary}\n${tools.map(tool => `- ${tool.name}${loaded.has(tool.name) ? ' (загружен)' : ''}: ${tool.description}`).join('\n')}` }
    }

    const tool = this.toolsFor(plugin.id).find(item => item.name === args.toolId)
    if (!tool) return { error: true, formattedContent: `Неизвестный инструмент ${args.toolId} в плагине ${plugin.id}.` }
    const documentation = {
      plugin: plugin.name,
      id: tool.name,
      description: tool.description,
      parameters: tool.parameters,
      loaded: loaded.has(tool.name)
    }
    if (args.action === 'describe') {
      return { success: true, data: documentation, formattedContent: `${tool.name}: ${tool.description}\nПараметры: ${JSON.stringify(tool.parameters)}\nЗагружен в этом чате: ${loaded.has(tool.name) ? 'да' : 'нет'}` }
    }

    try {
      this.loadTool(plugin.id, tool.name)
      return { success: true, data: { ...documentation, loaded: true }, formattedContent: `Инструмент ${tool.name} добавлен в инструменты этого чата. Он будет доступен модели со следующего запроса; действие инструмента ещё не запускалось.` }
    } catch (error) {
      return { error: true, formattedContent: error instanceof Error ? error.message : String(error) }
    }
  }

  loadTool(pluginId: string, toolId: string): { tool: ToolBase; alreadyLoaded: boolean } {
    if (!this.options.installedPluginIds.includes(pluginId)) throw new Error(`Плагин ${pluginId} не установлен.`)
    const tool = this.toolsFor(pluginId).find(item => item.name === toolId)
    if (!tool) throw new Error(`Неизвестный инструмент ${toolId} в плагине ${pluginId}.`)
    const alreadyLoaded = this.options.getLoadedToolIds().includes(toolId)
    this.options.loadTool(pluginId, toolId)
    return { tool, alreadyLoaded }
  }

  describeTool(pluginId: string, toolId: string): string {
    if (!this.options.installedPluginIds.includes(pluginId)) throw new Error(`Плагин ${pluginId} не установлен.`)
    const plugin = this.options.plugins.find(item => item.id === pluginId)
    const tool = this.toolsFor(pluginId).find(item => item.name === toolId)
    if (!plugin || !tool) throw new Error(`Неизвестный инструмент ${toolId} в плагине ${pluginId}.`)
    return `${tool.name} (${plugin.name}): ${tool.description}`
  }

  private toolsFor(pluginId: string): ToolBase[] {
    // Creating the small bundled tool objects is cheap; their schemas and documentation
    // are returned only in response to a describe request.
    return this.options.getPluginTools(pluginId)
  }
}
