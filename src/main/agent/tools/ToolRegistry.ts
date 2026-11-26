import { ToolBase } from './ToolBase'
import { SearchTool } from './SearchTool'
import { WebTool } from './WebTool'
import { WriteFileTool } from './WriteFileTool'
import { ReadFileTool } from './ReadFileTool'
import { EditFileTool } from './EditFileTool'
import { ListDirTool } from './ListDirTool'
import { TerminalTool } from './TerminalTool'
import { RunCommandTool } from './RunCommandTool'
import { ExecCommandTool } from './ExecCommandTool'
import { WriteStdinTool } from './WriteStdinTool'
import { ProjectSearchTool } from './ProjectSearchTool'
import { FindFilesTool } from './FindFilesTool'
import { ReadFilesTool } from './ReadFilesTool'
import { CodeIntelligenceTool } from './CodeIntelligenceTool'
import { ProcessTool } from './ProcessTool'
import { ApplyPatchTool } from './ApplyPatchTool'
import { AskUserTool } from './AskUserTool'
import { UpdatePlanTool } from './UpdatePlanTool'
import { SpawnAgentTool } from './SpawnAgentTool'
import { ManageSubagentsTool } from './ManageSubagentsTool'
import { VerifyFileTool } from './VerifyFileTool'
import { BrowserVerifyTool } from './BrowserVerifyTool'

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
    const lower = name.toLowerCase()
    // Handle terminal aliases
    if (lower === 'terminal' || lower === 'run_command' || lower === 'execute_command' || lower === 'bash' || lower === 'sh') {
      const term = this._tools.get('terminal') || this._tools.get('run_command')
      if (term) return term
    }
    const tool = this._tools.get(lower)
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
  .register(new WriteFileTool())
  .register(new ReadFileTool())
  .register(new EditFileTool())
  .register(new ListDirTool())
  .register(new TerminalTool())
  .register(new RunCommandTool())
  .register(new ExecCommandTool())
  .register(new WriteStdinTool())
  .register(new ProjectSearchTool())
  .register(new FindFilesTool())
  .register(new ReadFilesTool())
  .register(new CodeIntelligenceTool())
  .register(new ProcessTool('start'))
  .register(new ProcessTool('poll'))
  .register(new ProcessTool('stop'))
  .register(new ProcessTool('list'))
  .register(new ApplyPatchTool())
  .register(new UpdatePlanTool())
  .register(new SpawnAgentTool())
  .register(new ManageSubagentsTool())
  .register(new VerifyFileTool())
  .register(new BrowserVerifyTool())
  .register(new AskUserTool())
