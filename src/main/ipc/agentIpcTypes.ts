import type { McpRuntimeManager } from '../agent/mcp/McpRuntimeManager'
import type { McpConfigStore } from '../agent/mcp/McpConfigStore'
import type { McpTrustStore } from '../agent/mcp/McpTrustStore'
import type { McpConnectionService } from '../agent/mcp/McpConnectionService'
import type { SkillRepository } from '../agent/skills/SkillRepository'
import type { SkillImportService } from '../agent/skills/SkillImportService'

export interface AgentExtensionServices {
  mcpRuntime?: McpRuntimeManager
  mcpConfig?: McpConfigStore
  mcpConnections?: McpConnectionService
  mcpTrust?: McpTrustStore
  createSkillRepository?: (workspacePath?: string) => Promise<SkillRepository>
  skillImport?: SkillImportService
}

export function requireMainFrame(event: { senderFrame: unknown; sender: { mainFrame: unknown } }): void {
  if (event.senderFrame !== event.sender.mainFrame) {
    throw new Error('Недопустимый источник запроса.')
  }
}
