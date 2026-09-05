import * as fs from 'fs'
import * as path from 'path'
import { AgentBase } from './AgentBase'
import { Blackboard } from './Blackboard'
import { ContextCompactor, OpenAiMessage } from './ContextCompactor'
import { ChatService, ChatConfig, ChatResponseUsage } from '../services/ChatService'
import { MemoryService } from '../services/MemoryService'
import { SessionSummaryService } from '../services/SessionSummaryService'
import { AutoExtractService } from '../services/AutoExtractService'
import { LinguisticPersonaService } from '../services/LinguisticPersonaService'
import { SkillService } from '../services/SkillService'
import { RepoMapService } from '../services/RepoMapService'
import { RuleService } from '../services/RuleService'
import { ToolExecutor } from './ToolExecutor'
import { WatchdogService, ToolLogEntry } from '../services/WatchdogService'
import { SystemPromptPipeline } from './SystemPromptPipeline'
import {
  IdentityProvider,
  McpCatalogProvider,
  ProjectRulesProvider,
  SkillsProvider,
  ToolStrategyProvider,
  EnvironmentProvider,
  MemoryProvider,
  LinguisticPersonaProvider,
  SandwichReminderProvider
} from './PromptProviders'
import type { AgentEvent } from '../../../shared/agentEvents'

// Initialize default prompt providers
if (SystemPromptPipeline.getProviders().length === 0) {
  SystemPromptPipeline.registerProvider(IdentityProvider)
  SystemPromptPipeline.registerProvider(McpCatalogProvider)
  SystemPromptPipeline.registerProvider(ProjectRulesProvider)
  SystemPromptPipeline.registerProvider(SkillsProvider)
  SystemPromptPipeline.registerProvider(ToolStrategyProvider)
  SystemPromptPipeline.registerProvider(EnvironmentProvider)
  SystemPromptPipeline.registerProvider(MemoryProvider)
  SystemPromptPipeline.registerProvider(LinguisticPersonaProvider)
  SystemPromptPipeline.registerProvider(SandwichReminderProvider)
}

export type { AgentEvent } from '../../../shared/agentEvents'
export type { CachedToolResult } from './ToolExecutor'

/**
 * AgentRunner owns run initialization and the model/tool loop.
 * Tool policy, validation, scheduling, caching, and result normalization live
 * in ToolExecutor so this class stays focused on orchestration.
 */
export class AgentRunner {
  static async run(
    agent: AgentBase,
    history: OpenAiMessage[],
    config: ChatConfig,
    onEvent: (evt: AgentEvent) => void,
    abortSignal?: AbortSignal,
    parentBlackboard: Blackboard | null = null
  ): Promise<void> {
    const blackboard = parentBlackboard ? parentBlackboard.createChild() : new Blackboard()

    // Per-chat project folder wins; otherwise fall back to the configured base.
    // If neither is set, workspacePath stays empty — no project context is injected into the prompt.
    const rawWorkspace =
      config.workspacePath && typeof config.workspacePath === 'string' && config.workspacePath.trim()
        ? config.workspacePath.trim()
        : config.baseDir && typeof config.baseDir === 'string' && config.baseDir.trim()
          ? config.baseDir.trim()
          : ''

    let workspacePath = rawWorkspace ? path.normalize(rawWorkspace) : ''

    if (workspacePath) {
      try {
        if (!fs.existsSync(workspacePath)) {
          fs.mkdirSync(workspacePath, { recursive: true })
        }
      } catch (err) {
        console.warn(`[AgentRunner] Could not initialize directory at ${workspacePath}:`, err)
        if (!fs.existsSync(workspacePath)) workspacePath = process.cwd()
      }
    }

    blackboard.setArtifact('workspacePath', workspacePath)
    blackboard.setArtifact('agentRunId', `run_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`)
    blackboard.setArtifact('tavilyKey', config.tavilyKey || process.env.TAVILY_API_KEY || '')
    blackboard.setArtifact('searchProvider', config.searchProvider || 'duckduckgo')
    blackboard.setArtifact('config', config)

    const embeddingConfig = {
      baseUrl: config.baseUrl,
      apiKey: config.apiKey,
      embeddingModel: config.embeddingModel,
      embeddingBaseUrl: config.embeddingBaseUrl
    }

    const lastUserMsg = Array.isArray(history)
      ? [...history].reverse().find((m) => m.role === 'user')?.content || ''
      : ''
    const userQueryText = typeof lastUserMsg === 'string' ? lastUserMsg : ''

    const memories = await MemoryService.getTopMemoriesForQueryAsync(
      userQueryText,
      3,
      embeddingConfig,
      workspacePath
    )

    const userTurnCount = Array.isArray(history)
      ? history.filter((m) => m.role === 'user').length
      : 0
    const shouldInjectCoreSummary = userTurnCount <= 1 || userTurnCount % 8 === 0
    const coreSummary = shouldInjectCoreSummary ? MemoryService.getCoreSummary() : ''

    const linguisticPersonaPrompt = LinguisticPersonaService.getSystemPromptSection()
    const sessionSummaries = config.enableSessionSummary !== false
      ? SessionSummaryService.getRelevantSummaries(userQueryText, 1)
      : []
    const coreSkillsPrompt = SkillService.getCoreSkillsPrompt(workspacePath)
    const extraSkillsCatalogPrompt = SkillService.getStableSkillsCatalogPrompt(workspacePath)

    const activeFilesFromHistory: string[] = []
    if (Array.isArray(history)) {
      for (const msg of history) {
        if (msg.role === 'assistant' && Array.isArray(msg.tool_calls)) {
          for (const tc of msg.tool_calls) {
            try {
              const args = JSON.parse(tc.function?.arguments || '{}')
              if (args.path && typeof args.path === 'string') {
                activeFilesFromHistory.push(args.path)
              }
            } catch {}
          }
        }
      }
    }

    const repoMapPrompt = workspacePath
      ? await RepoMapService.getRepoMapAsync(workspacePath, activeFilesFromHistory)
      : ''
    const projectRulesPrompt = RuleService.getProjectRulesPrompt(workspacePath)
    const enforcementDirective = await SkillService.getEnforcementDirectiveAsync(
      userQueryText,
      workspacePath,
      embeddingConfig,
      userTurnCount
    )
    const scratchpadPrompt = blackboard.getScratchpadPrompt()

    // Fetch active dynamic MCP tools if any enabled servers are present
    let dynamicMcpWrappers: any[] = []
    let mcpCatalogSection = ''
    try {
      const { McpService } = await import('../services/McpService')
      const { DynamicMcpToolWrapper, CallMcpTool } = await import('../tools/McpTool')
      const activeMcpTools = await McpService.getActiveTools()

      if (activeMcpTools.length > 0) {
        // If 8 or fewer tools, register individually as native tools for direct zero-overhead calling
        if (activeMcpTools.length <= 8) {
          dynamicMcpWrappers = activeMcpTools.map((t) => new DynamicMcpToolWrapper(t))
        } else {
          // If > 8 tools (Lazy MCP Routing), register universal call_mcp_tool and inject compact catalog
          dynamicMcpWrappers = [new CallMcpTool()]
          mcpCatalogSection = McpService.getMcpCatalogPrompt(activeMcpTools)
        }
      }
    } catch {
      // ignore
    }

    const activeMicroagents = RuleService.getMatchingMicroagentHints(userQueryText)

    const agentContext = {
      agentId: agent.id,
      workspacePath,
      memories,
      sessionSummaries,
      coreSummary,
      linguisticPersonaPrompt,
      coreSkillsPrompt,
      extraSkillsCatalogPrompt,
      repoMapPrompt,
      projectRulesPrompt,
      scratchpadPrompt,
      enforcementDirective,
      activeMicroagents,
      mcpCatalogPrompt: mcpCatalogSection
    }

    const compiled = SystemPromptPipeline.compile(agent.id, agentContext, config)
    const systemPrompt = compiled.fullPrompt

    const messages: OpenAiMessage[] = [{ role: compiled.systemRole, content: systemPrompt }, ...history]
    const toolDefs = ToolExecutor.buildToolDefs(agent, dynamicMcpWrappers)
    let totalUsage: ChatResponseUsage | undefined
    let iteration = 0
    const MAX_ITERATIONS = 1000
    const resultCache = new Map<string, import('./ToolExecutor').CachedToolResult>()
    const safeEmit = (evt: AgentEvent): void => ToolExecutor.safeEmit(onEvent, evt)

    // ── Watchdog state ────────────────────────────────────────────────────────
    const toolLog: ToolLogEntry[] = []
    let toolCallsSinceLastCheck = 0
    let watchdogCooldown = 0            // tools remaining before next check is allowed
    let loopDone = false                // prevents race: verdict arriving after loop exits
    const BASE_WATCHDOG_INTERVAL = 6
    const WATCHDOG_COOLDOWN = 12        // cooldown after warning
    const WATCHDOG_LOG_WINDOW = 100

    while (true) {
      if (abortSignal?.aborted) {
        loopDone = true
        safeEmit({ type: 'error', message: 'Cancelled by user.' })
        return
      }

      iteration++
      if (iteration > MAX_ITERATIONS) {
        loopDone = true
        safeEmit({ type: 'error', message: 'Maximum iteration limit reached (1000).' })
        return
      }

      const compactedMessages = await ContextCompactor.compactAsync(messages, config)
      let response
      try {
        response = await ChatService.chat(
          config,
          compactedMessages,
          toolDefs.length > 0 ? toolDefs : undefined,
          (chunk) => safeEmit({ type: 'token', content: chunk }),
          (reasoningChunk) => safeEmit({ type: 'reasoning', content: reasoningChunk }),
          abortSignal
        )
      } catch (err: unknown) {
        const error = err instanceof Error ? err : new Error(String(err))
        safeEmit({
          type: 'error',
          message: abortSignal?.aborted || error.message === 'Cancelled by user.'
            ? 'Cancelled by user.'
            : error.message
        })
        return
      }

      if (response.usage) {
        totalUsage = totalUsage
          ? {
              promptTokens: totalUsage.promptTokens + response.usage.promptTokens,
              completionTokens: totalUsage.completionTokens + response.usage.completionTokens,
              totalTokens: totalUsage.totalTokens + response.usage.totalTokens
            }
          : response.usage
      }

      if (!response.toolCalls || response.toolCalls.length === 0) {
        const finalMsg: OpenAiMessage = { role: 'assistant', content: response.content || '' }
        if (response.reasoningContent) finalMsg.reasoning_content = response.reasoningContent
        messages.push(finalMsg)
        loopDone = true
        safeEmit({ type: 'done', usage: totalUsage })

        if (parentBlackboard === null && userQueryText && config.enableAutoExtract !== false) {
          this._runPostSessionExtraction(history, config, userQueryText).catch(() => {})
        }
        return
      }

      for (const toolCall of response.toolCalls) {
        if (!toolCall.id) {
          toolCall.id = `call_${Math.random().toString(36).slice(2)}`
        }
      }

      messages.push({
        role: 'assistant',
        content: response.content || null,
        tool_calls: response.toolCalls.map((toolCall) => ({
          id: toolCall.id,
          type: 'function',
          function: { name: toolCall.name, arguments: toolCall.argumentsJson || '{}' }
        })),
        ...(response.reasoningContent ? { reasoning_content: response.reasoningContent } : {})
      })

      const completed = await ToolExecutor.executeCalls(
        agent,
        response.toolCalls,
        messages,
        blackboard,
        onEvent,
        abortSignal,
        resultCache
      )

      if (!completed || abortSignal?.aborted) {
        loopDone = true
        safeEmit({ type: 'error', message: 'Cancelled by user.' })
        return
      }

      // ── Record tool calls into watchdog log ──────────────────────────────
      for (const toolCall of response.toolCalls) {
        let args: Record<string, unknown> = {}
        try { args = JSON.parse(toolCall.argumentsJson || '{}') } catch { /* ignore */ }

        // Find the corresponding tool result message (last tool message for this callId)
        const resultMsg = [...messages].reverse().find(
          (m) => m.role === 'tool' && (m as any).tool_call_id === toolCall.id
        )
        const resultStr = typeof resultMsg?.content === 'string' ? resultMsg.content : ''
        const isError = resultStr.toLowerCase().startsWith('[error') || resultStr.toLowerCase().startsWith('error:')

        // Summary: prefer description arg (agent fills this), else tool name
        const summary = (typeof args.description === 'string' && args.description.trim())
          ? args.description.trim()
          : toolCall.name

        toolLog.push({
          summary,
          error: isError,
          resultSnippet: resultStr.slice(0, 120)
        })
      }

      toolCallsSinceLastCheck += response.toolCalls.length
      if (watchdogCooldown > 0) watchdogCooldown = Math.max(0, watchdogCooldown - response.toolCalls.length)

      // ── Instant Deterministic Fast Check (0ms latency) ───────────────────
      const instantVerdict = WatchdogService.fastDeterministicCheck(toolLog)
      if (instantVerdict.status === 'intervene' && !abortSignal?.aborted && !loopDone) {
        toolCallsSinceLastCheck = 0
        watchdogCooldown = WATCHDOG_COOLDOWN
        safeEmit({
          type: 'watchdog',
          status: 'intervene',
          message: instantVerdict.message,
          toolCount: toolLog.length
        })
        messages.push({ role: 'user', content: `[WATCHDOG 🛑 DIRECTIVE] ${instantVerdict.message}` })
        continue
      }

      // ── Adaptive Interval Calculation ────────────────────────────────────
      const recentErrorsCount = toolLog.slice(-4).filter((e) => e.error).length
      const effectiveInterval = recentErrorsCount > 0 ? 3 : BASE_WATCHDOG_INTERVAL

      const shouldCheck =
        toolCallsSinceLastCheck >= effectiveInterval &&
        watchdogCooldown <= 0

      const recentTools = toolLog.slice(-8)
      const hasRepeatedSummaries = recentTools.some(
        (t) => recentTools.filter((other) => other.summary === t.summary).length >= 3
      )
      const hasRepeatedSnippets = recentTools.some(
        (t) =>
          t.resultSnippet.length > 20 &&
          recentTools.filter((other) => other.resultSnippet === t.resultSnippet).length >= 3
      )
      const recentAllSuccess =
        recentTools.length >= 4 &&
        recentTools.every((e) => !e.error) &&
        !hasRepeatedSummaries &&
        !hasRepeatedSnippets

      if (shouldCheck && !recentAllSuccess) {
        toolCallsSinceLastCheck = 0

        const watchdogAbort = new AbortController()
        const watchdogTimeout = setTimeout(() => watchdogAbort.abort(), 6_000)

        try {
          const verdict = await WatchdogService.analyse(
            toolLog.slice(-WATCHDOG_LOG_WINDOW),
            userQueryText,
            config,
            watchdogAbort.signal
          )
          clearTimeout(watchdogTimeout)

          // Discard result if loop already finished or was cancelled
          if (verdict.status !== 'continue' && !abortSignal?.aborted && !loopDone) {
            watchdogCooldown = WATCHDOG_COOLDOWN

            safeEmit({
              type: 'watchdog',
              status: verdict.status,
              message: verdict.message,
              toolCount: toolLog.length
            })

            const prefix = verdict.status === 'intervene'
              ? '[WATCHDOG \uD83D\uDED1 DIRECTIVE] '
              : '[WATCHDOG \u26A0\uFE0F HINT] '

            messages.push({ role: 'user', content: prefix + verdict.message })
          }
        } catch {
          // Non-critical: continue agent execution on watchdog timeout or failure
        } finally {
          clearTimeout(watchdogTimeout)
        }
      } else if (shouldCheck && recentAllSuccess) {
        toolCallsSinceLastCheck = 0
      }
    }
  }

  /**
   * Post-session background task: extract user facts and backfill embeddings.
   * It is deliberately kept outside the hot model/tool loop.
   */
  private static async _runPostSessionExtraction(
    history: OpenAiMessage[],
    config: ChatConfig,
    userQuery: string
  ): Promise<void> {
    try {
      const conversationHistory = history
        .filter((message) => message.role === 'user' || message.role === 'assistant')
        .map((message) => ({
          role: message.role as 'user' | 'assistant',
          content: typeof message.content === 'string' ? message.content : ''
        }))
        .filter((message) => message.content.trim().length > 0)

      if (conversationHistory.length < 2) return

      const firstUserContent = conversationHistory.find((message) => message.role === 'user')?.content || userQuery
      let stableHash = 5381
      for (let i = 0; i < Math.min(firstUserContent.length, 200); i++) {
        stableHash = ((stableHash << 5) + stableHash) ^ firstUserContent.charCodeAt(i)
        stableHash = stableHash >>> 0
      }
      const chatId = `chat_${stableHash.toString(16)}`
      const chatTitle = userQuery.slice(0, 60)

      await AutoExtractService.extractAndSave(chatId, chatTitle, conversationHistory, config)

      if (config.embeddingModel?.trim()) {
        await MemoryService.backfillEmbeddings({
          baseUrl: config.baseUrl,
          apiKey: config.apiKey,
          embeddingModel: config.embeddingModel,
          embeddingBaseUrl: config.embeddingBaseUrl
        })
      }
    } catch (error) {
      console.warn('[AgentRunner] Post-session extraction error (non-critical):', error)
    }
  }
}
