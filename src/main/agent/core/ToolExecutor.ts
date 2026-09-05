import fs from 'fs'
import path from 'path'
import { AgentBase } from './AgentBase'
import { Blackboard } from './Blackboard'
import { OpenAiMessage } from './ContextCompactor'
import { OutputTruncator } from './OutputTruncator'
import { MemoryService } from '../services/MemoryService'
import { LinterService } from '../services/LinterService'
import { ToolExecutionPolicy, ToolResult, ToolBase, ToolParameterDef } from '../tools/ToolBase'
import type { AgentEvent } from '../../../shared/agentEvents'

export interface AgentToolCall {
  id: string
  name: string
  argumentsJson: string
}

export interface CachedToolResult {
  resultStr: string
  isError: boolean
  data?: unknown
}

const DEFAULT_MUTATING_POLICY: ToolExecutionPolicy = {
  mutates: true,
  parallelSafe: false,
  cacheable: false
}

/**
 * Owns everything related to tool execution. AgentRunner remains responsible
 * for the model loop, while this class handles policy, validation, scheduling,
 * result normalization, and cache invalidation.
 */
export class ToolExecutor {
  static safeEmit(onEvent: (evt: AgentEvent) => void, evt: AgentEvent): void {
    try {
      onEvent(evt)
    } catch {
      // UI listeners must never break the agent loop.
    }
  }

  static getPolicy(agent: AgentBase, toolName: string, args: Record<string, unknown>): ToolExecutionPolicy {
    const handler = agent.getHandler(toolName)
    if (!handler) {
      if (toolName.startsWith('mcp_') || toolName === 'call_mcp_tool') {
        const lowerName = toolName.toLowerCase()
        const isReadOnlyMcp =
          lowerName.includes('read') ||
          lowerName.includes('get') ||
          lowerName.includes('list') ||
          lowerName.includes('search') ||
          lowerName.includes('find') ||
          lowerName.includes('view') ||
          lowerName.includes('fetch') ||
          lowerName.includes('query') ||
          lowerName.includes('inspect')
        if (isReadOnlyMcp) {
          return { mutates: false, parallelSafe: true, cacheable: true }
        }
        return { mutates: true, parallelSafe: false, cacheable: false }
      }
      return DEFAULT_MUTATING_POLICY
    }
    return handler.getExecutionPolicy(args)
  }

  static buildToolDefs(agent: AgentBase, extraTools: ToolBase[] = []) {
    const allTools = [...agent.getTools(), ...extraTools]
    return allTools.map((tool) => {
      const properties: Record<string, unknown> = {}
      const required: string[] = []

      for (const [key, param] of Object.entries(tool.parameters || {}) as Array<[string, ToolParameterDef]>) {
        const propDef: Record<string, unknown> = {
          type: param.type,
          description: param.description
        }
        if (param.enum) propDef.enum = param.enum
        if (param.items) {
          if (typeof param.items === 'object' && param.items !== null) {
            const itemsCopy = { ...(param.items as Record<string, unknown>) }
            if ('default' in itemsCopy) delete itemsCopy.default
            propDef.items = itemsCopy
          } else {
            propDef.items = param.items
          }
        }
        // Note: Do NOT add propDef.default = param.default because Google Gemini OpenAPI Schema
        // strictly rejects "default" attributes with HTTP 400 "Request contains an invalid argument".
        properties[key] = propDef
        if (param.required) required.push(key)
      }

      return {
        type: 'function' as const,
        function: {
          name: tool.name,
          description: tool.description,
          parameters: {
            type: 'object' as const,
            properties,
            ...(required.length > 0 ? { required } : {})
          }
        }
      }
    })
  }

  static async executeCalls(
    agent: AgentBase,
    toolCalls: AgentToolCall[],
    messages: OpenAiMessage[],
    blackboard: Blackboard,
    onEvent: (evt: AgentEvent) => void,
    abortSignal?: AbortSignal,
    resultCache?: Map<string, CachedToolResult>
  ): Promise<boolean> {
    const safeEmit = (evt: AgentEvent): void => this.safeEmit(onEvent, evt)
    if (!toolCalls || toolCalls.length === 0) return true

    const policies = toolCalls.map((toolCall) => {
      const args = this.parseArgs(toolCall.argumentsJson || '{}')
      return this.getPolicy(agent, toolCall.name, args)
    })
    const hasUnsafeParallelCall = policies.some((policy) => !policy.parallelSafe || policy.mutates)
    const hasMutatingCall = policies.some((policy) => policy.mutates)

    const executeOne = async (tc: AgentToolCall, batchPolicy: ToolExecutionPolicy) => {
      const callId = tc.id || `call_${Math.random().toString(36).slice(2)}`
      const argsJson = tc.argumentsJson || '{}'
      const parsedArgs = this.parseArgs(argsJson)
      const callKey = `${tc.name}:${argsJson}`

      if (!hasUnsafeParallelCall && batchPolicy.cacheable && resultCache?.has(callKey)) {
        const cached = resultCache.get(callKey)!
        safeEmit({ type: 'tool_start', callId, toolName: tc.name, args: parsedArgs })
        safeEmit({
          type: 'tool_result',
          callId,
          result: cached.resultStr,
          error: cached.isError,
          data: cached.data
        })
        return {
          aborted: false,
          msg: { role: 'tool' as const, tool_call_id: callId, name: tc.name, content: cached.resultStr },
          isMutating: false
        }
      }

      if (abortSignal?.aborted) {
        safeEmit({ type: 'tool_result', callId, result: 'Cancelled by user.', error: true })
        return {
          aborted: true,
          msg: { role: 'tool' as const, tool_call_id: callId, name: tc.name, content: 'Cancelled by user.' },
          isMutating: batchPolicy.mutates
        }
      }

      const validationError = this.validateParams(agent, tc.name, argsJson)
      if (validationError) {
        safeEmit({ type: 'tool_start', callId, toolName: tc.name, args: parsedArgs })
        safeEmit({ type: 'tool_result', callId, result: validationError, error: true })
        return {
          aborted: false,
          msg: { role: 'tool' as const, tool_call_id: callId, name: tc.name, content: validationError },
          isMutating: batchPolicy.mutates
        }
      }

      safeEmit({ type: 'tool_start', callId, toolName: tc.name, args: parsedArgs })

      let resultStr = ''
      let isError = false
      let toolResult: ToolResult | null = null

      // Pre-execution snapshot for file rollback protection (SWE-agent pattern)
      let preEditFilePath: string | null = null
      let preEditSnapshot: string | null = null
      let preEditExisted = false

      if (tc.name === 'file' && batchPolicy.mutates) {
        const fileAction = String(parsedArgs.action || '').toLowerCase()
        if (['write', 'edit', 'append'].includes(fileAction)) {
          const workspace = (blackboard?.getArtifact('workspacePath') as string) || process.cwd()
          const rawTarget = parsedArgs.path as string | undefined
          if (rawTarget) {
            preEditFilePath = path.isAbsolute(rawTarget) ? path.normalize(rawTarget) : path.normalize(path.join(workspace, rawTarget))
            try {
              if (fs.existsSync(preEditFilePath)) {
                preEditExisted = true
                preEditSnapshot = fs.readFileSync(preEditFilePath, 'utf8')
              }
            } catch {}
          }
        }
      }

      try {
        const handler = agent.getHandler(tc.name)
        if (handler) {
          toolResult = await handler.execute(argsJson, blackboard, abortSignal, (progress) => {
            safeEmit({
              type: 'tool_progress',
              callId,
              message: progress.message,
              elapsedSeconds: progress.elapsedSeconds,
              statusText: progress.statusText,
              innerSteps: Array.isArray(progress.innerSteps) ? progress.innerSteps : undefined,
              data: progress
            })
          })
          resultStr = toolResult.formattedContent || ''
        } else if (tc.name.startsWith('mcp_')) {
          // Dynamic MCP tool dispatch: match against registered servers and tools
          const { McpService } = await import('../services/McpService')
          const allServers = McpService.getAllServers()

          let targetServerId: string | null = null
          let targetToolName: string | null = null

          for (const s of allServers) {
            const sanitizedServer = s.name.replace(/[^a-zA-Z0-9_]/g, '_')
            const prefix = `mcp_${sanitizedServer}_`
            if (tc.name.startsWith(prefix)) {
              const rawToolPart = tc.name.slice(prefix.length)
              const matchedTool = (s.tools || []).find((t) => {
                const sanitizedTool = t.name.replace(/[^a-zA-Z0-9_]/g, '_')
                return sanitizedTool === rawToolPart || t.name === rawToolPart
              })
              targetServerId = s.id
              targetToolName = matchedTool ? matchedTool.name : rawToolPart
              break
            }
          }

          if (!targetServerId) {
            const parts = tc.name.slice(4).split('_')
            targetServerId = parts[0]
            targetToolName = parts.slice(1).join('_')
          }

          toolResult = await McpService.callTool(targetServerId, targetToolName || '', parsedArgs, abortSignal)
          resultStr = toolResult.formattedContent || ''
          isError = !toolResult.success
        } else {
          resultStr = `Unknown tool: ${tc.name}`
          isError = true
        }
      } catch (err: unknown) {
        const error = err instanceof Error ? err : new Error(String(err))
        if (abortSignal?.aborted || error.message === 'Cancelled by user.') {
          safeEmit({ type: 'tool_result', callId, result: 'Cancelled by user.', error: true })
          return {
            aborted: true,
            msg: { role: 'tool' as const, tool_call_id: callId, name: tc.name, content: 'Cancelled by user.' },
            isMutating: batchPolicy.mutates
          }
        }
        resultStr = `Error executing ${tc.name}: ${error.message}`
        isError = true
      }

      if (abortSignal?.aborted) {
        safeEmit({ type: 'tool_result', callId, result: 'Cancelled by user.', error: true })
        return {
          aborted: true,
          msg: { role: 'tool' as const, tool_call_id: callId, name: tc.name, content: 'Cancelled by user.' },
          isMutating: batchPolicy.mutates
        }
      }

      // Run automated diagnostic check & rollback if a file was modified (SWE-agent SOTA closed-loop)
      if (tc.name === 'file' && batchPolicy.mutates && !isError && !resultStr.startsWith('Error') && preEditFilePath) {
        const workspace = (blackboard?.getArtifact('workspacePath') as string) || process.cwd()
        try {
          const linterFeedback = await LinterService.checkFileAsync(preEditFilePath, workspace)
          if (linterFeedback) {
            if (LinterService.isFatalSyntaxError(linterFeedback)) {
              // Rollback file to preserve integrity
              try {
                if (preEditExisted && preEditSnapshot !== null) {
                  fs.writeFileSync(preEditFilePath, preEditSnapshot, 'utf8')
                } else if (!preEditExisted && fs.existsSync(preEditFilePath)) {
                  fs.unlinkSync(preEditFilePath)
                }
                resultStr = `[SYNTAX ERROR REJECTED 🛑] File changes caused a fatal syntax error and were automatically rolled back to preserve codebase integrity:\n${linterFeedback}\n\nPlease inspect the error and provide the corrected code.`
                isError = true
              } catch (rollbackErr) {
                resultStr += `\n\n${linterFeedback}\n(Warning: rollback attempt failed: ${rollbackErr})`
              }
            } else {
              resultStr += `\n\n${linterFeedback}`
            }
          }
        } catch {
          // Non-critical diagnostic failure
        }
      }

      resultStr = OutputTruncator.truncate(resultStr)

      safeEmit({
        type: 'tool_result',
        callId,
        result: resultStr,
        error: isError,
        data: toolResult?.data
      })

      if (resultCache && batchPolicy.cacheable && !isError) {
        resultCache.set(callKey, { resultStr, isError, data: toolResult?.data })
      }

      if (tc.name === 'memory' && parsedArgs.action === 'save') {
        const savedMemory = toolResult?.data as { id?: unknown } | undefined
        const blackboardConfig = blackboard.getArtifact('config') as {
          baseUrl?: string
          apiKey?: string
          embeddingModel?: string
          embeddingBaseUrl?: string
        } | undefined
        if (typeof savedMemory?.id === 'string' && blackboardConfig?.embeddingModel?.trim()) {
          MemoryService.enrichWithEmbedding(savedMemory.id, {
            baseUrl: blackboardConfig.baseUrl,
            apiKey: blackboardConfig.apiKey,
            embeddingModel: blackboardConfig.embeddingModel,
            embeddingBaseUrl: blackboardConfig.embeddingBaseUrl
          }).catch(() => {})
        }
      }

      return {
        aborted: false,
        msg: { role: 'tool' as const, tool_call_id: callId, name: tc.name, content: resultStr },
        isMutating: batchPolicy.mutates
      }
    }

    const runSequentially = async () => {
      const ordered: Array<Awaited<ReturnType<typeof executeOne>>> = []
      for (let i = 0; i < toolCalls.length; i++) {
        ordered.push(await executeOne(toolCalls[i], policies[i]))
      }
      return ordered
    }

    const results = hasUnsafeParallelCall
      ? await runSequentially()
      : await Promise.all(toolCalls.map((toolCall, index) => executeOne(toolCall, policies[index])))

    let anyAborted = false
    let anyMutating = false
    for (const result of results) {
      messages.push(result.msg)
      if (result.aborted) anyAborted = true
      if (result.isMutating) anyMutating = true
    }

    if ((anyMutating || hasMutatingCall) && resultCache) {
      resultCache.clear()
    }

    return !anyAborted && !abortSignal?.aborted
  }

  static validateParams(agent: AgentBase, toolName: string, argumentsJson: string): string | null {
    const handler = agent.getHandler(toolName)
    if (!handler) return null

    const args = this.parseJson(argumentsJson)
    if (!args || Array.isArray(args)) {
      const trimmed = (argumentsJson || '').trim()
      const looksTruncated =
        trimmed.length > 200 && (!trimmed.endsWith('}') || trimmed.endsWith('...') || /"[^"]*$/.test(trimmed))
      if (looksTruncated) {
        return `Error: failed to parse arguments for ${toolName} because the payload was truncated (cut off by model output token limits).\nTip: DO NOT generate huge files at once with action="write". Use action="edit" for surgical modifications, or create files incrementally using action="write" followed by action="append".`
      }
      return `Error: failed to parse arguments for ${toolName}. Expected a JSON object.`
    }

    const missing: string[] = []
    for (const [key, param] of Object.entries(handler.parameters || {})) {
      if (param.required && (!(key in args) || args[key] === undefined || args[key] === null || args[key] === '')) {
        missing.push(key)
      }
    }
    if (missing.length > 0) {
      return `Error: missing required parameters for ${toolName}: ${missing.join(', ')}.`
    }

    try {
      const customError = handler.validate(argumentsJson)
      if (customError) return customError
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err)
      return `Validation error for ${toolName}: ${message}`
    }
    return null
  }

  static parseArgs(argumentsJson: string): Record<string, unknown> {
    const parsed = this.parseJson(argumentsJson)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {}
  }

  private static parseJson(argumentsJson: string): Record<string, unknown> | unknown[] | null {
    if (!argumentsJson || typeof argumentsJson !== 'string') return null
    const raw = argumentsJson.trim()
    if (!raw) return {}

    // 1. Direct standard parse attempt
    try {
      return JSON.parse(raw) as Record<string, unknown> | unknown[]
    } catch {}

    // 2. Defensive Recovery: strip markdown code block wrapping (```json ... ```)
    let cleaned = raw
    if (cleaned.startsWith('```')) {
      cleaned = cleaned.replace(/^```(?:json)?\s*\n?/, '').replace(/\n?```\s*$/, '').trim()
      try {
        return JSON.parse(cleaned) as Record<string, unknown> | unknown[]
      } catch {}
    }

    // 3. Defensive Recovery: Balance unclosed braces/brackets from token truncation
    try {
      let balanced = cleaned
      const openBraces = (balanced.match(/\{/g) || []).length
      const closeBraces = (balanced.match(/\}/g) || []).length
      if (openBraces > closeBraces) {
        balanced += '}'.repeat(openBraces - closeBraces)
      }
      const openBrackets = (balanced.match(/\[/g) || []).length
      const closeBrackets = (balanced.match(/\]/g) || []).length
      if (openBrackets > closeBrackets) {
        balanced += ']'.repeat(openBrackets - closeBrackets)
      }
      return JSON.parse(balanced) as Record<string, unknown> | unknown[]
    } catch {}

    return null
  }
}
