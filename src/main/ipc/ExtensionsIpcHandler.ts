import { BrowserWindow, dialog, ipcMain } from 'electron'
import type { PluginManager } from '../agent/plugins/PluginManager'
import type { ExtensionCatalog, SkillCatalogItem } from '../../shared/extensionCatalog'
import { requireMainFrame, type AgentExtensionServices } from './agentIpcTypes'

/**
 * Registers IPC endpoints for skills catalog, skill imports, and built-in plugins.
 */
export class ExtensionsIpcHandler {
  constructor(
    private readonly plugins: PluginManager,
    private readonly extensions: AgentExtensionServices
  ) {}

  register(): void {
    ipcMain.handle('extensions:list', async (event, workspacePath?: unknown): Promise<ExtensionCatalog> => {
      requireMainFrame(event)
      const skills = this.extensions.createSkillRepository && typeof workspacePath === 'string'
        ? await this.extensions.createSkillRepository(workspacePath)
        : this.extensions.createSkillRepository ? await this.extensions.createSkillRepository() : undefined
      const safeSkills: SkillCatalogItem[] = skills
        ? (await skills.discover()).map(({ bodyPath: _bodyPath, metadata: _metadata, ...item }) => item)
        : []
      const storedServers = this.extensions.mcpConfig?.list() ?? []
      const runtime = this.extensions.mcpRuntime
      const servers = storedServers.map(server => {
        const status = runtime?.listServers().find(item => item.id === server.id) ?? { id: server.id, state: 'disconnected' as const, revision: 0 }
        return { ...server, ...status, authConfigured: server.authConfigured }
      })
      let trustedMcpTools: ExtensionCatalog['trustedMcpTools'] = []
      try { trustedMcpTools = this.extensions.mcpTrust?.list() ?? [] }
      catch (error) { console.warn('[MCP] Не удалось прочитать список доверенных инструментов:', error) }
      return {
        skills: safeSkills,
        servers,
        tools: runtime?.listTools().map(({ inputSchema: _schema, ...tool }) => tool) ?? [],
        resources: runtime?.listResources() ?? [],
        prompts: runtime?.listPrompts() ?? [],
        trustedMcpTools
      }
    })

    ipcMain.handle('extensions:importSkill', async event => {
      requireMainFrame(event)
      if (!this.extensions.skillImport) throw new Error('Импорт навыков недоступен.')
      const options = {
        properties: ['openFile'] as Array<'openFile'>,
        filters: [{ name: 'Навык Codex', extensions: ['md', 'zip'] }]
      }
      const owner = BrowserWindow.fromWebContents(event.sender)
      const result = owner
        ? await dialog.showOpenDialog(owner, options)
        : await dialog.showOpenDialog(options)
      const selectedPath = result.filePaths[0]
      if (result.canceled || !selectedPath) return null
      return this.extensions.skillImport.importFile(selectedPath)
    })

    ipcMain.handle('plugins:list', (event, legacy: unknown) => {
      requireMainFrame(event)
      return this.plugins.list(legacy)
    })

    ipcMain.handle('plugins:setInstalled', (event, id: unknown, installed: unknown) => {
      requireMainFrame(event)
      return this.plugins.setInstalled(id, installed)
    })
  }
}
