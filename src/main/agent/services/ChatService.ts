import { OpenAiMessage } from '../core/ContextCompactor'
import { writeFileSync } from 'fs'
import { join } from 'path'
import { app } from 'electron'

export interface ChatConfig {
  baseUrl?: string
  apiKey?: string
  model?: string
  fastModel?: string
  temperature?: number
  maxTokens?: number
  stream?: boolean
  reasoningEffort?: string
  tavilyKey?: string
  searchProvider?: string
  baseDir?: string
  workspacePath?: string // per-chat working directory (overrides baseDir when set)
  allowDangerousCommands?: boolean // explicit opt-in for destructive shell commands
  // Memory & Personalization
  embeddingModel?: string
  embeddingBaseUrl?: string
  enableAutoExtract?: boolean
  enableSessionSummary?: boolean
  [key: string]: unknown
}

export interface ToolCallChunk {
  id: string
  name: string
  argumentsJson: string
}

export interface ChatResponseUsage {
  promptTokens: number
  completionTokens: number
  totalTokens: number
}

export interface ChatResponse {
  content: string
  reasoningContent: string
  toolCalls: ToolCallChunk[]
  usage?: ChatResponseUsage
}

export interface OpenAiToolDefinition {
  type: 'function'
  function: {
    name: string
    description: string
    parameters: {
      type: 'object'
      properties: Record<string, unknown>
      required?: string[]
    }
  }
}

/**
 * ChatService — OpenAI-compatible streaming API client with reasoning capture & tool support.
 */
export class ChatService {
  static async chat(
    config: ChatConfig,
    messages: OpenAiMessage[],
    tools?: OpenAiToolDefinition[],
    onContentChunk?: (chunk: string) => void,
    onReasoningChunk?: (reasoningChunk: string) => void,
    abortSignal?: AbortSignal
  ): Promise<ChatResponse> {
    const MAX_ATTEMPTS = 3
    let lastError: Error | null = null

    // Determine model candidate variations to try if proxy errors occur
    const rawModel = (config.model || 'gpt-4o').replace(/^models\//, '').trim()
    const candidateModels: string[] = [rawModel]

    // If double prefixed (e.g. "antigravity/antigravity/..."), add deduplicated variant
    const deduplicated = rawModel.replace(/^([a-zA-Z0-9_-]+\/)\1+/g, '$1')
    if (deduplicated !== rawModel) {
      candidateModels.push(deduplicated)
    }

    // If prefixed (e.g. "antigravity/gemini-3-flash"), add un-prefixed variant
    if (rawModel.includes('/')) {
      const parts = rawModel.split('/')
      const baseName = parts[parts.length - 1]
      if (baseName && !candidateModels.includes(baseName)) {
        candidateModels.push(baseName)
      }
    }

    // Common proxy alias fallbacks for gemini-3.7-flash
    if (rawModel.includes('gemini-3.7-flash') && !rawModel.includes('tiered')) {
      if (!candidateModels.includes('antigravity/antigravity/gemini-3.7-flash-tiered')) {
        candidateModels.push('antigravity/antigravity/gemini-3.7-flash-tiered')
      }
      if (!candidateModels.includes('antigravity/gemini-3-flash')) {
        candidateModels.push('antigravity/gemini-3-flash')
      }
    }

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      if (abortSignal?.aborted) throw new Error('Cancelled by user.')

      // Pick candidate model for this attempt if previous attempt failed
      const modelToTry = candidateModels[attempt - 1] || candidateModels[0]
      const attemptConfig: ChatConfig = { ...config, model: modelToTry }

      try {
        return await this._sendRequest(attemptConfig, messages, tools, onContentChunk, onReasoningChunk, abortSignal)
      } catch (err: unknown) {
        const error = err instanceof Error ? err : new Error(String(err))
        if (abortSignal?.aborted || error.message === 'Cancelled by user.') {
          throw new Error('Cancelled by user.')
        }
        lastError = error
        console.warn(`[ChatService] Attempt ${attempt} (model: ${modelToTry}) failed:`, error.message)

        if (attempt < MAX_ATTEMPTS) {
          const delayMs = attempt * 1000 + Math.random() * 400
          await new Promise<void>((resolve, reject) => {
            let t: NodeJS.Timeout
            const onAbort = (): void => {
              clearTimeout(t)
              reject(new Error('Cancelled by user.'))
            }
            t = setTimeout(() => {
              if (abortSignal) abortSignal.removeEventListener('abort', onAbort)
              resolve()
            }, delayMs)
            if (abortSignal) {
              if (abortSignal.aborted) {
                clearTimeout(t)
                reject(new Error('Cancelled by user.'))
                return
              }
              abortSignal.addEventListener('abort', onAbort, { once: true })
            }
          })
        }
      }
    }

    throw lastError || new Error('Request failed after max retries.')
  }

  /**
   * Normalize and sanitize messages for strict compatibility with all OpenAI-compatible
   * endpoints, proxies, and routers (including Google Gemini, OmniRoute, LiteLLM, OpenRouter, DeepSeek).
   */
  static sanitizeMessages(messages: OpenAiMessage[], config?: ChatConfig): OpenAiMessage[] {
    if (!Array.isArray(messages) || messages.length === 0) {
      return [{ role: 'user', content: 'Hello' }]
    }

    // 1. Extract and merge all system messages into a single system instruction at index 0
    const systemContents: string[] = []
    const nonSystemMessages: OpenAiMessage[] = []

    for (const msg of messages) {
      if (!msg) continue
      if (msg.role === 'system' || msg.role === 'developer') {
        const text = typeof msg.content === 'string' ? msg.content.trim() : ''
        if (text) systemContents.push(text)
      } else {
        nonSystemMessages.push(msg)
      }
    }

    const result: OpenAiMessage[] = []

    const modelName = (config?.model || '').toLowerCase()
    const isReasoningOpenAi =
      modelName.includes('o1') ||
      modelName.includes('o3') ||
      (modelName.includes('gpt-4o') && !modelName.includes('mini'))
    const systemRole: 'system' | 'developer' = isReasoningOpenAi ? 'developer' : 'system'

    if (systemContents.length > 0) {
      result.push({
        role: systemRole,
        content: systemContents.join('\n\n')
      })
    }

    if (nonSystemMessages.length === 0) {
      result.push({ role: 'user', content: 'Hello' })
      return result
    }

    // 2. Track pending tool call IDs from the most recent assistant message with tool_calls
    let activeToolCallMap: Map<string, string> = new Map() // id -> tool name

    for (const rawMsg of nonSystemMessages) {
      const role = rawMsg.role

      if (role === 'assistant') {
        const hasToolCalls = Array.isArray(rawMsg.tool_calls) && rawMsg.tool_calls.length > 0
        let content = rawMsg.content

        if (typeof content === 'string') {
          content = content.trim()
        }

        if (hasToolCalls) {
          activeToolCallMap = new Map()
          const validToolCalls: NonNullable<OpenAiMessage['tool_calls']> = []

          for (const tc of rawMsg.tool_calls!) {
            const id = tc.id || `call_${Math.random().toString(36).slice(2)}`
            const name = tc.function?.name || 'tool'
            const args = tc.function?.arguments || '{}'
            validToolCalls.push({
              id,
              type: 'function',
              function: { name, arguments: args }
            })
            activeToolCallMap.set(id, name)
          }

          result.push({
            role: 'assistant',
            content: content || null,
            tool_calls: validToolCalls,
            ...(rawMsg.reasoning_content ? { reasoning_content: rawMsg.reasoning_content } : {})
          })
        } else {
          // Assistant message without tool calls
          activeToolCallMap = new Map()
          const safeContent = content || '(empty response)'

          // If previous message is also assistant (without tool calls), merge them
          const prev = result[result.length - 1]
          if (prev && prev.role === 'assistant' && !prev.tool_calls && typeof prev.content === 'string') {
            prev.content = `${prev.content}\n\n${safeContent}`
            if (rawMsg.reasoning_content) {
              prev.reasoning_content = prev.reasoning_content
                ? `${prev.reasoning_content}\n\n${rawMsg.reasoning_content}`
                : rawMsg.reasoning_content
            }
          } else {
            result.push({
              role: 'assistant',
              content: safeContent,
              ...(rawMsg.reasoning_content ? { reasoning_content: rawMsg.reasoning_content } : {})
            })
          }
        }
      } else if (role === 'tool') {
        const callId = rawMsg.tool_call_id || ''
        const toolName = rawMsg.name || (callId ? activeToolCallMap.get(callId) : undefined) || 'tool'
        let contentStr = typeof rawMsg.content === 'string' ? rawMsg.content.trim() : ''
        if (!contentStr) contentStr = '(completed with no output)'

        const prev = result[result.length - 1]
        // Check if there is an immediately preceding assistant or tool message that matches active tool calls
        const isPrecededByValidCall =
          prev &&
          ((prev.role === 'assistant' && Array.isArray(prev.tool_calls) && prev.tool_calls.some((tc) => tc.id === callId)) ||
            (prev.role === 'tool' && activeToolCallMap.has(callId)))

        if (isPrecededByValidCall && callId) {
          result.push({
            role: 'tool',
            tool_call_id: callId,
            name: toolName,
            content: contentStr
          })
        } else {
          // Orphaned tool response: convert to user message so Gemini/OpenAI won't reject turn order
          const fallbackUserMsg: OpenAiMessage = {
            role: 'user',
            content: `[Tool Result: ${toolName}]\n${contentStr}`
          }
          if (prev && prev.role === 'user' && typeof prev.content === 'string') {
            prev.content = `${prev.content}\n\n${fallbackUserMsg.content}`
          } else {
            result.push(fallbackUserMsg)
          }
        }
      } else {
        // User message (or unknown role normalized to user)
        activeToolCallMap = new Map()
        let userContent = rawMsg.content

        if (typeof userContent === 'string') {
          userContent = userContent.trim() || '(empty message)'
        } else if (!Array.isArray(userContent) || userContent.length === 0) {
          userContent = '(empty message)'
        }

        const prev = result[result.length - 1]
        if (prev && prev.role === 'user') {
          // Merge consecutive user messages
          if (typeof prev.content === 'string' && typeof userContent === 'string') {
            prev.content = `${prev.content}\n\n${userContent}`
          } else {
            result.push({
              role: 'user',
              content: userContent
            })
          }
        } else {
          result.push({
            role: 'user',
            content: userContent
          })
        }
      }
    }

    // Ensure first non-system message is a user message
    const firstNonSystemIdx = result.findIndex((m) => m.role !== 'system')
    if (firstNonSystemIdx !== -1 && result[firstNonSystemIdx].role !== 'user') {
      result.splice(firstNonSystemIdx, 0, { role: 'user', content: 'Continue' })
    }

    return result
  }

  private static async _sendRequest(
    config: ChatConfig,
    messages: OpenAiMessage[],
    tools?: OpenAiToolDefinition[],
    onContentChunk?: (chunk: string) => void,
    onReasoningChunk?: (reasoningChunk: string) => void,
    abortSignal?: AbortSignal
  ): Promise<ChatResponse> {
    let baseUrl = (config.baseUrl || 'https://api.openai.com/v1').replace(/\/+$/, '')
    const url = baseUrl.endsWith('/chat/completions') ? baseUrl : `${baseUrl}/chat/completions`

    const isStreaming = config.stream !== false
    const isOpenAI = url.includes('api.openai.com')
    const isOpenRouter = url.includes('openrouter.ai')
    // Detect Gemini-like endpoints (direct Gemini, OmniRoute proxy to Gemini, or model name contains "gemini")
    const isGeminiLike = url.includes('generativelanguage.googleapis.com') ||
      (config.model || '').toLowerCase().includes('gemini')

    const sanitizedMessages = this.sanitizeMessages(messages, config)

    const cleanModel = (config.model || 'gpt-4o').replace(/^models\//, '').trim()

    // OmniRoute and similar proxies to Gemini often don't support SSE streaming,
    // returning 400 for stream:true. Force non-streaming for Gemini-like endpoints.
    const effectiveStreaming = isGeminiLike ? false : isStreaming

    const body: Record<string, unknown> = {
      model: cleanModel,
      messages: sanitizedMessages,
      stream: effectiveStreaming
    }

    // stream_options is only supported by official OpenAI API.
    // Google Gemini, OmniRoute, LiteLLM, and other proxies reject stream_options with 400 Invalid Argument.
    if (isStreaming && isOpenAI) {
      body.stream_options = { include_usage: true }
    }

    if (typeof config.temperature === 'number') {
      // Clamp temperature: Gemini models accept [0.0, 2.0], OpenAI same
      body.temperature = Math.max(0, Math.min(2.0, config.temperature))
    }

    if (typeof config.maxTokens === 'number' && config.maxTokens > 0) {
      // Some Gemini proxies reject max_tokens; skip for Gemini-like endpoints
      if (!isGeminiLike) {
        body.max_tokens = config.maxTokens
      }
    }

    if (tools && tools.length > 0) {
      // Deep-sanitize tool definitions for Gemini compatibility
      body.tools = isGeminiLike ? this._sanitizeToolsForGemini(tools) : tools
      // Gemini proxies may reject tool_choice; only send for OpenAI / OpenRouter
      if (isOpenAI || isOpenRouter) {
        body.tool_choice = 'auto'
      }
    }

    if (config.reasoningEffort && config.reasoningEffort !== 'default') {
      if (isOpenRouter) {
        body.reasoning = {
          effort: config.reasoningEffort
        }
      } else if (isOpenAI && ['none', 'low', 'medium', 'high'].includes(config.reasoningEffort)) {
        body.reasoning_effort = config.reasoningEffort
      }
      // Do NOT send unknown reasoning fields to custom/OmniRoute/Gemini endpoints
    }

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'HTTP-Referer': 'https://zipply.fun',
      'X-Title': 'zipply',
      'User-Agent': 'zipply/1.0.0 (https://zipply.fun)'
    }

    if (config.apiKey && config.apiKey.trim()) {
      headers['Authorization'] = `Bearer ${config.apiKey.trim()}`
    }

    const bodyJson = JSON.stringify(body)

    const response = await fetch(url, {
      method: 'POST',
      headers,
      body: bodyJson,
      signal: abortSignal
    })

    if (!response.ok) {
      const text = await response.text()

      // Some proxies (e.g. OmniRoute) return HTTP 400/404/500 but embed a valid chat completion
      // response inside the error body. Detect and extract it if it contains actual content or tool calls.
      const extracted = this._tryExtractEmbeddedResponse(text)
      if (extracted) {
        console.warn(`[ChatService] Proxy returned ${response.status} but embedded a valid response — extracting it.`)
        const choice = extracted.choices?.[0]
        const content = choice?.message?.content || ''
        const reasoning =
          choice?.message?.reasoning_content ||
          choice?.message?.reasoning ||
          choice?.message?.thought ||
          ''
        const toolCallsRaw = choice?.message?.tool_calls
        const toolCalls = Array.isArray(toolCallsRaw)
          ? toolCallsRaw.map((tc: any) => ({
              id: tc.id || `call_${Math.random().toString(36).slice(2)}`,
              name: tc.function?.name || '',
              argumentsJson: tc.function?.arguments || '{}'
            }))
          : []

        if (content) {
          onContentChunk?.(content)
        }

        return {
          content,
          reasoningContent: reasoning,
          toolCalls,
          usage: extracted.usage
            ? {
                promptTokens: extracted.usage.prompt_tokens || 0,
                completionTokens: extracted.usage.completion_tokens || 0,
                totalTokens: extracted.usage.total_tokens || 0
              }
            : undefined
        }
      }

      console.error(`[ChatService] API ${response.status} from ${url} (model: ${cleanModel}):`, text)
      // Dump request body keys and tool names for diagnosis
      const toolNames = Array.isArray(body.tools) ? (body.tools as any[]).map((t) => t.function?.name).join(', ') : 'none'
      const msgCount = Array.isArray(body.messages) ? (body.messages as any[]).length : 0
      const bodyKeys = Object.keys(body).join(', ')
      console.error(`[ChatService] Request details: keys=[${bodyKeys}], tools=[${toolNames}], messages=${msgCount}, bodySize=${bodyJson.length}`)
      // Dump full request body to a debug file for inspection
      try {
        const debugPath = join(app.getPath('userData'), 'debug_request_body.json')
        writeFileSync(debugPath, JSON.stringify(body, null, 2), 'utf-8')
        console.error(`[ChatService] Full request body dumped to: ${debugPath}`)
      } catch (dumpErr) {
        console.error('[ChatService] Failed to dump request body:', dumpErr)
      }
      throw new Error(`API ${response.status}: ${text.slice(0, 300)}`)
    }

    return await this._parseResponse(response, effectiveStreaming, onContentChunk, onReasoningChunk)
  }

  /**
   * Some proxies (e.g. OmniRoute to Gemini) return HTTP 400/404 with the error body containing
   * a valid OpenAI-format chat completion JSON embedded in the "message" field.
   * Example: {"error":{"message":"[400]: {\"id\":\"chatcmpl-...\",\"choices\":[...]}"}}
   * This method tries to extract and parse that embedded response only if it has real content.
   */
  private static _tryExtractEmbeddedResponse(errorText: string): any | null {
    try {
      const errorJson = JSON.parse(errorText)
      const msg = errorJson?.error?.message
      if (typeof msg !== 'string') return null

      // Pattern: "[400]: {json...}" or "[404]: {json...}" or "[STATUS]: {json...}"
      const match = msg.match(/^\[\d+\]:\s*(\{.+\})$/s)
      if (!match) return null

      const embedded = JSON.parse(match[1])
      if (embedded?.choices && Array.isArray(embedded.choices) && embedded.choices.length > 0) {
        const choice = embedded.choices[0]
        const content = choice?.message?.content
        const hasContent = typeof content === 'string' && content.trim().length > 0
        const hasToolCalls = Array.isArray(choice?.message?.tool_calls) && choice.message.tool_calls.length > 0
        const hasReasoning = Boolean(
          choice?.message?.reasoning_content ||
          choice?.message?.reasoning ||
          choice?.message?.thought
        )

        if (hasContent || hasToolCalls || hasReasoning) {
          return embedded
        }
      }
    } catch {
      // Not an embedded response — fall through to normal error handling
    }
    return null
  }

  /**
   * Deep-sanitize OpenAI tool definitions for Google Gemini compatibility.
   * Gemini's GenerativeLanguage API / OpenAI-compat proxy layer is strict about OpenAPI schemas:
   * - No "default" attribute anywhere in the schema tree
   * - No "required" inside nested "items" object schemas
   * - "integer" type is not always recognized → normalize to "number"
   * - No "properties" with complex nested objects inside "items"
   */
  private static _sanitizeToolsForGemini(tools: OpenAiToolDefinition[]): OpenAiToolDefinition[] {
    return tools.map((tool) => ({
      type: 'function' as const,
      function: {
        name: tool.function.name,
        description: tool.function.description,
        parameters: this._sanitizeSchemaForGemini(tool.function.parameters) as OpenAiToolDefinition['function']['parameters']
      }
    }))
  }

  private static _sanitizeSchemaForGemini(schema: Record<string, unknown>): Record<string, unknown> {
    const result: Record<string, unknown> = {}

    for (const [key, value] of Object.entries(schema)) {
      // Strip fields that Gemini / proxy translators may reject
      if (key === 'default') continue
      if (key === 'additionalProperties') continue
      // Strip "required" arrays — many Gemini proxy translators fail on this
      if (key === 'required') continue

      if (key === 'type' && value === 'integer') {
        // Gemini sometimes rejects "integer" — normalize to "number"
        result.type = 'number'
        continue
      }

      if (key === 'type' && value === 'boolean') {
        // Some Gemini proxy translators fail to convert "boolean" type;
        // use "string" with enum instead
        result.type = 'string'
        result.enum = ['true', 'false']
        continue
      }

      if (key === 'properties' && typeof value === 'object' && value !== null) {
        // Recursively sanitize all property definitions
        const cleanProps: Record<string, unknown> = {}
        for (const [propName, propDef] of Object.entries(value as Record<string, unknown>)) {
          if (typeof propDef === 'object' && propDef !== null) {
            cleanProps[propName] = this._sanitizeSchemaForGemini(propDef as Record<string, unknown>)
          } else {
            cleanProps[propName] = propDef
          }
        }
        result.properties = cleanProps
        continue
      }

      if (key === 'items' && typeof value === 'object' && value !== null) {
        // Sanitize items schema and strip nested required/default/properties for complex objects
        const itemsObj = value as Record<string, unknown>
        if (itemsObj.type === 'object' || itemsObj.properties) {
          // Flatten complex object items to string to avoid Gemini schema rejection
          result.items = { type: 'string' }
        } else {
          result.items = this._sanitizeSchemaForGemini(itemsObj)
        }
        continue
      }

      result[key] = value
    }

    return result
  }

  private static async _parseResponse(
    response: Response,
    isStreaming: boolean,
    onContentChunk?: (chunk: string) => void,
    onReasoningChunk?: (reasoningChunk: string) => void
  ): Promise<ChatResponse> {
    if (!isStreaming) {
      // Non-streaming: parse JSON body directly
      const json = await response.json()
      const choice = json?.choices?.[0]
      const content = choice?.message?.content || ''
      const reasoning =
        choice?.message?.reasoning_content ||
        choice?.message?.reasoning ||
        choice?.message?.thought ||
        ''
      const toolCallsRaw = choice?.message?.tool_calls
      const toolCalls = Array.isArray(toolCallsRaw)
        ? toolCallsRaw.map((tc: any) => ({
            id: tc.id || `call_${Math.random().toString(36).slice(2)}`,
            name: tc.function?.name || '',
            argumentsJson: tc.function?.arguments || '{}'
          }))
        : []

      // Emit content/reasoning to UI callbacks even in non-streaming mode
      // so that Gemini proxy responses (forced non-streaming) still display
      if (content && onContentChunk) onContentChunk(content)
      if (reasoning && onReasoningChunk) onReasoningChunk(reasoning)

      return {
        content,
        reasoningContent: reasoning,
        toolCalls,
        usage: json.usage
          ? {
              promptTokens: json.usage.prompt_tokens || 0,
              completionTokens: json.usage.completion_tokens || 0,
              totalTokens: json.usage.total_tokens || 0
            }
          : undefined
      }
    }
    return this._parseStream(response, onContentChunk, onReasoningChunk)
  }

  private static async _parseStream(
    response: Response,
    onContentChunk?: (chunk: string) => void,
    onReasoningChunk?: (reasoningChunk: string) => void
  ): Promise<ChatResponse> {
    if (!response.body) {
      throw new Error('Response body is empty')
    }

    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''

    let contentBuf = ''
    let reasoningBuf = ''
    let inThinkTag = false
    const toolCallsBuf: Record<number, { id: string; name: string; argumentsJson: string }> = {}
    let usage: ChatResponseUsage | undefined = undefined

    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() || '' // keep last incomplete line

        for (const line of lines) {
          const trimmed = line.trim()
          if (!trimmed || trimmed === 'data: [DONE]') continue
          if (!trimmed.startsWith('data: ')) continue

          let chunk: any
          try {
            chunk = JSON.parse(trimmed.slice(6))
          } catch {
            continue
          }

          if (chunk.usage) {
            usage = {
              promptTokens: chunk.usage.prompt_tokens || 0,
              completionTokens: chunk.usage.completion_tokens || 0,
              totalTokens: chunk.usage.total_tokens || 0
            }
          }

          const choice = chunk.choices?.[0]
          if (!choice) continue

          const delta = choice.delta
          if (!delta) continue

          // Explicit reasoning fields (DeepSeek R1, OpenAI o1/o3, Groq, Together)
          const explicitReasoning = delta.reasoning_content || delta.reasoning || delta.thought
          if (explicitReasoning) {
            reasoningBuf += explicitReasoning
            onReasoningChunk?.(explicitReasoning)
          }

          // Normal text content (also handle inline <think> tags if model emits them in content)
          if (delta.content) {
            let token = delta.content
            while (token.length > 0) {
              if (inThinkTag) {
                const closeIdx = token.indexOf('</think>')
                if (closeIdx !== -1) {
                  const thinkPart = token.slice(0, closeIdx)
                  if (thinkPart) {
                    reasoningBuf += thinkPart
                    onReasoningChunk?.(thinkPart)
                  }
                  inThinkTag = false
                  token = token.slice(closeIdx + 8)
                } else {
                  reasoningBuf += token
                  onReasoningChunk?.(token)
                  token = ''
                }
              } else {
                const openIdx = token.indexOf('<think>')
                if (openIdx !== -1) {
                  const contentPart = token.slice(0, openIdx)
                  if (contentPart) {
                    contentBuf += contentPart
                    onContentChunk?.(contentPart)
                  }
                  inThinkTag = true
                  token = token.slice(openIdx + 7)
                } else {
                  contentBuf += token
                  onContentChunk?.(token)
                  token = ''
                }
              }
            }
          }

          // Tool call chunks
          if (delta.tool_calls) {
            for (const tc of delta.tool_calls) {
              const idx = tc.index ?? 0
              if (!toolCallsBuf[idx]) {
                toolCallsBuf[idx] = { id: '', name: '', argumentsJson: '' }
              }
              if (tc.id) toolCallsBuf[idx].id += tc.id
              if (tc.function?.name) toolCallsBuf[idx].name += tc.function.name
              if (tc.function?.arguments) toolCallsBuf[idx].argumentsJson += tc.function.arguments
            }
          }
        }
      }
    } finally {
      reader.releaseLock()
    }

    const finalToolCalls = Object.values(toolCallsBuf)
      .filter((tc) => tc.name || tc.argumentsJson)
      .map((tc) => ({
        id: tc.id || `call_${Math.random().toString(36).slice(2)}`,
        name: tc.name || 'tool',
        argumentsJson: tc.argumentsJson || '{}'
      }))

    return {
      content: contentBuf,
      reasoningContent: reasoningBuf,
      toolCalls: finalToolCalls,
      usage
    }
  }
}
