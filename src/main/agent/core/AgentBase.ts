/**
 * AgentBase — Abstract base class for all agents in zipply.
 */
import { ToolBase } from '../tools/ToolBase'

export interface AgentContext {
  agentId?: string
  workspacePath?: string
  coreSummary?: string
  linguisticPersonaPrompt?: string
  coreSkillsPrompt?: string
  extraSkillsCatalogPrompt?: string
  repoMapPrompt?: string
  projectRulesPrompt?: string
  scratchpadPrompt?: string
  enforcementDirective?: string
  mcpCatalogPrompt?: string
  activeMicroagents?: string[]
  memories?: Array<{
    category: string
    content: string
    importance?: number
    tags?: string[]
    hitCount?: number
  }>
  sessionSummaries?: Array<{
    id: string
    chatId: string
    title: string
    summary: string
    keywords: string[]
    createdAt: string
    messageCount: number
  }>
  [key: string]: unknown
}

export abstract class AgentBase {
  protected _tools: Map<string, ToolBase> = new Map()

  abstract get id(): string
  abstract get name(): string
  abstract getSystemPrompt(context: AgentContext): string

  get isReadOnly(): boolean {
    return false
  }

  addTool(tool: ToolBase): void {
    this._tools.set(tool.name.toLowerCase(), tool)
  }

  getTools(): ToolBase[] {
    return Array.from(this._tools.values())
  }

  getHandler(name: string): ToolBase | undefined {
    return this._tools.get(name.toLowerCase())
  }
}
