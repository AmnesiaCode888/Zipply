/**
 * PromptProviders — Modular Section Providers for SystemPromptPipeline.
 *
 * Implements the best practices from:
 * - Hermes Agent: <thought> CoT reasoning tag, structured XML tool execution protocol.
 * - OpenAI Codex CLI: Zero-filler brevity, non-interactive shell execution, anti-thrashing rule.
 * - Google Gemini CLI: Strict static/dynamic caching boundary, <RULE[path]> tags, Sandwich prompting.
 * - OpenCode (SST): Dedicated tool guidelines, provider awareness, clean project instructions.
 */

import * as path from 'path'
import { PromptSectionProvider } from './SystemPromptPipeline'
import { AgentContext } from './AgentBase'
import { ChatConfig } from '../services/ChatService'
import { SessionSummary } from '../services/SessionSummaryService'

/**
 * 1. Base Identity, Persona & Hermes CoT Protocol (Static Cached Layer)
 */
export const IdentityProvider: PromptSectionProvider = {
  id: 'identity',
  isStatic: true,
  render(context: AgentContext): string {
    const agentId = (context.agentId as string) || 'zipply'

    let roleDescription = ''
    switch (agentId) {
      case 'worker':
        roleDescription = `You are WorkerAgent, an autonomous execution specialist in zipply. Your role is to execute scoped technical tasks (surgical code edits, builds, tests, scripts) efficiently and completely.`
        break
      case 'architect':
        roleDescription = `You are ArchitectAgent, an elite principal software architect in zipply. Your role is to deeply analyze requirements, inspect repo architecture, and design clean, robust, verified implementation blueprints (DO NOT Generate Diff Blocks).`
        break
      case 'ask':
        roleDescription = `You are AskAgent, an expert read-only AI research, data investigation, document analysis, and system consulting specialist in zipply.`
        break
      case 'terminal':
        roleDescription = `You are TerminalAgent, an expert system operations, shell automation, and CLI execution specialist in zipply.`
        break
      case 'web_search':
        roleDescription = `You are WebSearchAgent, an expert web research, online intelligence, and documentation specialist in zipply.`
        break
      case 'zipply':
      default:
        roleDescription = `You are zipply, an elite autonomous AI software engineer and digital teammate with full computer and filesystem access, deep web intelligence, terminal execution, subagent swarm delegation, persistent Long-Term Memory, and on-demand Skills.`
        break
    }

    return `<Identity>
${roleDescription}

## Cognitive & Operational Protocol (Hermes CoT & Codex SOTA):
1. **Think Before Action (Hermes CoT)**: On non-trivial reasoning, planning, or multi-step tasks, write your concise internal rationale inside <thought>...</thought> tags before calling tools.
2. **Read-Before-Write Invariant**: ALWAYS inspect target files and symbol definitions using \`file(action="read")\` or \`grep_search\` before attempting modifications.
3. **Action-First & Zero-Filler**: Avoid empty conversational pleasantries ("Sure!", "I'd be glad to help!"). Proceed straight to the technical solution or tool execution.
4. **Anti-Thrashing Rule**: If a tool or command fails twice with the same error, STOP immediately. Do NOT repeat the exact same tool call. Re-read the full error message, inspect the codebase, and revise your hypothesis.
5. **Non-Interactive Execution**: Never invoke commands that require interactive user confirmation or stdin prompts. Always supply automated non-interactive flags (e.g. \`-y\`, \`--no-interactive\`, \`-m\`).
</Identity>`
  }
}

/**
 * 2. Static MCP Tool Catalog (Static Cached Layer)
 */
export const McpCatalogProvider: PromptSectionProvider = {
  id: 'mcp_catalog',
  isStatic: true,
  render(context: AgentContext): string | null {
    const mcpCatalog = (context.mcpCatalogPrompt as string) || ''
    if (!mcpCatalog.trim()) return null

    return `<mcp_catalog>
${mcpCatalog.trim()}
</mcp_catalog>`
  }
}

/**
 * 3. Project Guidelines & Rules in Isolated XML Tags (Static Cached Layer)
 */
export const ProjectRulesProvider: PromptSectionProvider = {
  id: 'project_rules',
  isStatic: true,
  render(context: AgentContext): string | null {
    const rules = (context.projectRulesPrompt as string) || ''
    if (!rules.trim()) return null

    return `<user_rules>
The following are project-specific guidelines and instructions that you MUST ALWAYS FOLLOW WITHOUT EXCEPTION:
${rules.trim()}
</user_rules>`
  }
}

/**
 * 4. Skills System: Core Skills & On-Demand Catalog (Static Cached Layer)
 */
export const SkillsProvider: PromptSectionProvider = {
  id: 'skills_catalog',
  isStatic: true,
  render(context: AgentContext): string | null {
    const coreSkills = (context.coreSkillsPrompt as string) || ''
    const extraSkills = (context.extraSkillsCatalogPrompt as string) || ''
    if (!coreSkills.trim() && !extraSkills.trim()) return null

    return `<skills_system>
${coreSkills.trim()}
${extraSkills.trim()}
</skills_system>`
  }
}

/**
 * 5. Universal Tool Routing, Diffs & Safety Guidelines (Static Cached Layer)
 */
export const ToolStrategyProvider: PromptSectionProvider = {
  id: 'tool_strategy',
  isStatic: true,
  render(context: AgentContext): string {
    const agentId = (context.agentId as string) || 'zipply'
    const isReadOnly = agentId === 'architect' || agentId === 'ask'

    if (isReadOnly) {
      return `<tool_guidelines>
## Read-Only Inspection Strategy:
- Inspect code using \`file(action="read", start_line=..., end_line=...)\` or search with \`grep_search\`.
- Use \`file(action="glob")\` to locate files by pattern and \`file(action="read_tree")\` for hierarchy.
- Base your analysis and answers strictly on verified file contents and cited line ranges.
</tool_guidelines>`
    }

    return `<tool_guidelines>
## File Operations & Non-Invasive Diffs (Anti-Truncation SOTA):
1. **Inspecting Files**: Use \`file(action="read", path="...", start_line=..., end_line=...)\` (100–300 lines). Line numbers in output are for reference only.
2. **Search Inside Files**: Use \`grep_search(query="...", path="...", includes="...")\` for regex/text search.
3. **Modifying Existing Files (Surgical Edits)**: ALWAYS use \`file(action="edit", path="...", old_content="...", new_content="...")\`.
   - NEVER rewrite whole existing files (>60 lines) with \`action="write"\` — full rewrites risk truncation and wiped code.
   - For multi-block edits, provide SEARCH/REPLACE blocks in \`new_content\`:
     \`\`\`
     <<<<<<< SEARCH
     [exact existing code]
     =======
     [new replacement code]
     >>>>>>>
     \`\`\`
   - NEVER copy line numbers (e.g. \`45: \`) into search blocks.
   - **Linter & Diagnostic Self-Healing**: If tool output reports \`[SYNTAX ERROR REJECTED 🛑]\` or \`[LINTER FEEDBACK ⚠️]\`, immediately fix the reported issue in your next turn.
4. **Creating Files**: Use \`file(action="write", path="...", content="...")\`.

## PowerShell & Shell Execution Directives (Windows):
- Commands execute in **PowerShell (UTF-8)** in non-interactive mode.
- Use PowerShell syntax: \`Select-Object -First N\`, \`Get-Content\`, \`$env:VAR = "val"\`. Use \`;\` for chaining.
- In PowerShell, declare arrays as \`@(item1, item2)\`, NEVER \`[item1, item2]\`.
- In ESM projects (\`"type": "module"\`), run Node scripts with \`.mjs\` or ES imports.
- NEVER run destructive commands (\`rm -rf\`, \`Remove-Item -Recurse -Force\`, \`git reset --hard\`, \`del /s /q\`) — use \`file\` tool actions instead.

## IDE Terminals & Background Process Awareness:
- You have direct access and visibility into all open terminal tabs in the IDE (both AI-launched and user interactive tabs).
- When the user asks you to check something in the terminal, inspect what they typed, check build/test errors, or verify a server:
  1. Call \`terminal(action="read_terminal")\` to read recent commands, user inputs, outputs, and exit codes (reads the active terminal, or pass \`session_id="all"\` or specific ID).
  2. Call \`terminal(action="list_terminals")\` to see all open IDE terminal tabs, their status (RUNNING / IDLE), PID, and CWD.
  3. Call \`terminal(action="send_input", session_id="...", input="...")\` to send stdin input into running terminal programs.
  4. For background daemons / dev watchers, use \`terminal(action="start_background", command="...")\`.
</tool_guidelines>`
  }
}

/**
 * 5. Dynamic Runtime Environment, Workspace & AST Map (Dynamic Suffix Layer)
 */
export const EnvironmentProvider: PromptSectionProvider = {
  id: 'environment',
  isStatic: false,
  render(context: AgentContext): string {
    const workspace = (context.workspacePath as string)?.trim() || ''
    const projectName = workspace ? path.basename(workspace) : ''
    const now = new Date().toLocaleDateString('ru-RU', {
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    })

    const repoMap =
      typeof context.repoMapPrompt === 'string' && context.repoMapPrompt.trim()
        ? `\n<repo_map>\n${context.repoMapPrompt.trim()}\n</repo_map>`
        : ''

    const workspaceInfo = workspace
      ? `- Active Workspace: "${projectName}" (Root: ${workspace})
- Default base path for file operations and commands is ${workspace}.
- All features, questions, and code references pertain to this workspace by default.`
      : `- No specific workspace folder bound — full computer filesystem access is available.`

    return `<runtime_environment>
- Current Date: ${now}
- Host OS: Windows (PowerShell UTF-8)
${workspaceInfo}${repoMap}
</runtime_environment>`
  }
}

/**
 * 6. Long-Term Memory & Past Sessions (Dynamic Suffix Layer)
 */
export const MemoryProvider: PromptSectionProvider = {
  id: 'memory_context',
  isStatic: false,
  render(context: AgentContext): string | null {
    const memories = context.memories || []
    const sessionSummaries: SessionSummary[] = (context.sessionSummaries as SessionSummary[]) || []
    const coreSummary = ((context.coreSummary as string)?.trim() || '').slice(0, 700)

    if (!coreSummary && memories.length === 0 && sessionSummaries.length === 0) {
      return null
    }

    let memoryList = ''
    if (memories.length > 0) {
      memoryList = memories
        .map(
          (m) =>
            `- [${(m.category || 'fact').toUpperCase()}${m.importance && m.importance >= 4 ? ' ⭐' : ''}] ${m.content.slice(0, 400)}`
        )
        .join('\n')
    }

    let sessionList = ''
    if (sessionSummaries.length > 0) {
      sessionList = sessionSummaries
        .map((s) => {
          const date = new Date(s.createdAt).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' })
          return `• [${date}] "${s.title}": ${s.summary.slice(0, 400)}`
        })
        .join('\n')
    }

    return `<memory_context>
## Memory Compass: Reference only. Current user request and real filesystem state always take priority.
${coreSummary ? `\n### Core Memory Essence:\n${coreSummary}\n` : ''}
${memoryList ? `\n### Specific Rules & Facts:\n${memoryList}\n` : ''}
${sessionList ? `\n### Relevant Past Sessions:\n${sessionList}\n` : ''}
</memory_context>`
  }
}

/**
 * 7. Linguistic Persona & Style (Dynamic Suffix Layer)
 */
export const LinguisticPersonaProvider: PromptSectionProvider = {
  id: 'linguistic_persona',
  isStatic: false,
  render(context: AgentContext): string | null {
    const persona = (context.linguisticPersonaPrompt as string) || ''
    if (!persona.trim()) return null
    return `<communication_style>\n${persona.trim()}\n</communication_style>`
  }
}

/**
 * 9. Sandwich Reminder & JIT Micro-Agents (Dynamic Suffix Layer)
 */
export const SandwichReminderProvider: PromptSectionProvider = {
  id: 'sandwich_reminder',
  isStatic: false,
  render(context: AgentContext): string {
    const enforcement = (context.enforcementDirective as string) || ''
    const scratchpad = (context.scratchpadPrompt as string) || ''
    const microagents = (context.activeMicroagents as string[]) || []

    const microagentSection =
      microagents.length > 0
        ? `\n<microagents_knowledge>\n${microagents.join('\n\n')}\n</microagents_knowledge>`
        : ''

    return `<system_reminder>
- Execute required actions directly with tools rather than giving passive advice.
- When finished, summarize modifications and verification results in Russian.
${enforcement ? `\n${enforcement.trim()}` : ''}
${scratchpad ? `\n<scratchpad>\n${scratchpad.trim()}\n</scratchpad>` : ''}${microagentSection}
</system_reminder>`
  }
}
