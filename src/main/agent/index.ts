/**
 * Agent entry point for zipply.
 * Wires tools into agents and exports runAgent and runZipply.
 */
import { agentRegistry } from './core/AgentRegistry'
import { toolRegistry } from './tools/ToolRegistry'
import { AgentRunner, AgentEvent } from './core/AgentRunner'
import { ReadOnlyFileTool } from './tools/ReadOnlyFileTool'
import { OpenAiMessage } from './core/ContextCompactor'
import { ChatConfig } from './services/ChatService'

const zipplyAgent = agentRegistry.getAgent('zipply')
const askAgent = agentRegistry.getAgent('ask')
const terminalAgent = agentRegistry.getAgent('terminal')
const webSearchAgent = agentRegistry.getAgent('web_search')
const workerAgent = agentRegistry.getAgent('worker')
const architectAgent = agentRegistry.getAgent('architect')

// 1. zipply Master Agent Tools
zipplyAgent.addTool(toolRegistry.getTool('file'))
zipplyAgent.addTool(toolRegistry.getTool('grep_search'))
zipplyAgent.addTool(toolRegistry.getTool('terminal'))
zipplyAgent.addTool(toolRegistry.getTool('search_web'))
zipplyAgent.addTool(toolRegistry.getTool('read_page'))
zipplyAgent.addTool(toolRegistry.getTool('ask_agent'))
zipplyAgent.addTool(toolRegistry.getTool('memory'))
zipplyAgent.addTool(toolRegistry.getTool('read_skill'))
zipplyAgent.addTool(toolRegistry.getTool('save_skill'))
zipplyAgent.addTool(toolRegistry.getTool('delete_skill'))
zipplyAgent.addTool(toolRegistry.getTool('list_skills'))
zipplyAgent.addTool(toolRegistry.getTool('schedule'))
zipplyAgent.addTool(toolRegistry.getTool('call_mcp_tool'))
zipplyAgent.addTool(toolRegistry.getTool('manage_mcp'))
zipplyAgent.addTool(toolRegistry.getTool('complete_task'))

// 2. Wire read-only tools into AskAgent
askAgent.addTool(new ReadOnlyFileTool())
askAgent.addTool(toolRegistry.getTool('grep_search'))
askAgent.addTool(toolRegistry.getTool('search_web'))
askAgent.addTool(toolRegistry.getTool('read_page'))
askAgent.addTool(toolRegistry.getTool('read_skill'))
askAgent.addTool(toolRegistry.getTool('call_mcp_tool'))

// 3. Wire tools into TerminalAgent
terminalAgent.addTool(toolRegistry.getTool('terminal'))
terminalAgent.addTool(toolRegistry.getTool('file'))
terminalAgent.addTool(toolRegistry.getTool('grep_search'))
terminalAgent.addTool(toolRegistry.getTool('read_skill'))
terminalAgent.addTool(toolRegistry.getTool('call_mcp_tool'))

// 4. Wire tools into WebSearchAgent
webSearchAgent.addTool(toolRegistry.getTool('search_web'))
webSearchAgent.addTool(toolRegistry.getTool('read_page'))
webSearchAgent.addTool(toolRegistry.getTool('grep_search'))
webSearchAgent.addTool(toolRegistry.getTool('read_skill'))

// 5. Wire tools into WorkerAgent
workerAgent.addTool(toolRegistry.getTool('file'))
workerAgent.addTool(toolRegistry.getTool('grep_search'))
workerAgent.addTool(toolRegistry.getTool('terminal'))
workerAgent.addTool(toolRegistry.getTool('search_web'))
workerAgent.addTool(toolRegistry.getTool('read_page'))
workerAgent.addTool(toolRegistry.getTool('read_skill'))
workerAgent.addTool(toolRegistry.getTool('save_skill'))
workerAgent.addTool(toolRegistry.getTool('delete_skill'))
workerAgent.addTool(toolRegistry.getTool('list_skills'))
workerAgent.addTool(toolRegistry.getTool('call_mcp_tool'))
workerAgent.addTool(toolRegistry.getTool('manage_mcp'))
workerAgent.addTool(toolRegistry.getTool('complete_task'))

// 6. Wire read-only inspection tools into ArchitectAgent
architectAgent.addTool(new ReadOnlyFileTool())
architectAgent.addTool(toolRegistry.getTool('grep_search'))
architectAgent.addTool(toolRegistry.getTool('search_web'))
architectAgent.addTool(toolRegistry.getTool('read_page'))
architectAgent.addTool(toolRegistry.getTool('read_skill'))
architectAgent.addTool(toolRegistry.getTool('call_mcp_tool'))

/**
 * Run selected agent for one turn.
 */
export async function runAgent(
  agentId: string,
  history: OpenAiMessage[],
  settings: ChatConfig,
  onEvent: (evt: AgentEvent) => void,
  abortSignal?: AbortSignal
): Promise<void> {
  const targetId = agentId || 'zipply'
  let agent
  try {
    agent = agentRegistry.getAgent(targetId)
  } catch {
    agent = zipplyAgent
  }
  await AgentRunner.run(agent, history, settings, onEvent, abortSignal)
}

/**
 * Run zipply master agent
 */
export async function runZipply(
  history: OpenAiMessage[],
  settings: ChatConfig,
  onEvent: (evt: AgentEvent) => void,
  abortSignal?: AbortSignal
): Promise<void> {
  await runAgent('zipply', history, settings, onEvent, abortSignal)
}

export const runZipple = runZipply
export const runClick = runZipply

export * from './core/AgentBase'
export * from './core/AgentRegistry'
export * from './core/AgentRunner'
export * from './core/Blackboard'
export * from './core/ContextCompactor'
export * from './core/ToolExecutor'
export * from './services/ChatService'
export * from './services/MemoryService'
export * from './services/EmbeddingService'
export * from './services/SessionSummaryService'
export * from './services/AutoExtractService'
export * from './services/SkillService'
export * from './services/SchedulerService'
export * from './tools/ToolBase'
export * from './tools/ToolRegistry'
export * from './tools/SkillTool'
export * from './tools/ScheduleTool'
export * from './tools/McpTool'
export * from './services/McpService'
export * from './services/LinterService'
export * from './services/RepoMapService'
export * from './services/RuleService'
export * from './tools/CompleteTaskTool'
export * from './agents/ArchitectAgent'


