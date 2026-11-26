/**
 * AgentBase — Abstract base class for all agents in Zipply.
 */
import { ToolBase } from '../tools/ToolBase'

export interface AgentContext {
  agentId?: string
  role?: string
  roleInstructions?: string
  workspacePath?: string
  userRulesPrompt?: string
  projectRules?: string
  availablePluginsSummary?: string
  [key: string]: unknown
}

export abstract class AgentBase {
  protected _tools: Map<string, ToolBase> = new Map()
  protected _legacyTools: Map<string, ToolBase> = new Map()

  abstract get id(): string
  abstract get name(): string
  abstract getSystemPrompt(context: AgentContext): string

  get isReadOnly(): boolean {
    return false
  }

  getRoleInstructions?(): { role: string; instructions: string } | null

  getAvailablePluginsSummary?(): string

  addTool(tool: ToolBase): void {
    this._tools.set(tool.name.toLowerCase(), tool)
  }

  removeTool(name: string): void {
    this._tools.delete(name.toLowerCase())
  }

  /** Register deprecated/compatibility tools so legacy transcripts still execute without bloating model schemas. */
  addLegacyTool(tool: ToolBase): void {
    this._legacyTools.set(tool.name.toLowerCase(), tool)
  }

  getTools(): ToolBase[] {
    return Array.from(this._tools.values())
  }

  getLegacyTools(): ToolBase[] {
    return Array.from(this._legacyTools.values())
  }

  getHandler(name: string): ToolBase | undefined {
    const lower = name.toLowerCase()
    if (lower === 'terminal' || lower === 'run_command' || lower === 'execute_command' || lower === 'bash' || lower === 'sh') {
      return (
        this._tools.get('terminal') ||
        this._legacyTools.get('terminal') ||
        this._tools.get('run_command') ||
        this._legacyTools.get('run_command') ||
        this._tools.get('exec_command')
      )
    }
    return this._tools.get(lower) || this._legacyTools.get(lower)
  }
}
