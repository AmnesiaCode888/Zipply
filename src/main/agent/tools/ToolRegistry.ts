import { ToolBase } from './ToolBase'
import { SearchTool } from './SearchTool'
import { WebTool } from './WebTool'
import { FileTool } from './FileTool'
import { TerminalTool } from './TerminalTool'
import { GrepTool } from './GrepTool'
import { AskTool } from './AskTool'
import { MemoryTool } from './MemoryTool'
import { ReadSkillTool, SaveSkillTool, ListSkillsTool, SearchSkillTool, DeleteSkillTool } from './SkillTool'
import { ScheduleTool } from './ScheduleTool'
import { CallMcpTool, ManageMcpTool } from './McpTool'
import { CompleteTaskTool } from './CompleteTaskTool'

/**
 * ToolRegistry — Central registry for all agent tools.
 */
export class ToolRegistry {
  private _tools: Map<string, ToolBase> = new Map()

  register(tool: ToolBase): this {
    this._tools.set(tool.name.toLowerCase(), tool)
    return this
  }

  getTool(name: string): ToolBase {
    const tool = this._tools.get(name.toLowerCase())
    if (!tool) throw new Error(`Tool '${name}' not found in registry.`)
    return tool
  }

  getTools(): ToolBase[] {
    return Array.from(this._tools.values())
  }
}

// Singleton with default tools registered
export const toolRegistry = new ToolRegistry()
toolRegistry
  .register(new SearchTool())
  .register(new WebTool())
  .register(new FileTool())
  .register(new TerminalTool())
  .register(new GrepTool())
  .register(new AskTool())
  .register(new MemoryTool())
  .register(new ReadSkillTool())
  .register(new SaveSkillTool())
  .register(new ListSkillsTool())
  .register(new SearchSkillTool())
  .register(new DeleteSkillTool())
  .register(new ScheduleTool())
  .register(new CallMcpTool())
  .register(new ManageMcpTool())
  .register(new CompleteTaskTool())

