import type { OpenAiMessage } from '../../core/ContextCompactor'
import { applyAnthropicCacheControl } from './messageSanitizer'
import {
  normalizeUsage,
  type ChatConfig,
  type ChatResponse,
  type ChatResponseStatus,
  type ChatResponseUsage,
  type OpenAiToolDefinition,
  type ToolCallChunk
} from './types'

export interface CompletionsBodyOptions {
  cleanModel: string
  messages: OpenAiMessage[]
  tools: OpenAiToolDefinition[] | undefined
  config: ChatConfig
  isStreaming: boolean
  isOpenAI: boolean
  isOpenRouter: boolean
  hasAuthFetch: boolean
  cacheSeed: string
}

export function buildCompletionsBody(options: CompletionsBodyOptions): Record<string, unknown> {
  const { cleanModel, messages, tools, config, isStreaming, isOpenAI, isOpenRouter, hasAuthFetch, cacheSeed } = options
  const supportsPromptCacheKey = isOpenAI || (!isOpenRouter && !hasAuthFetch && /^((openai\/)?(gpt-|o[134])|codex)/i.test(cleanModel))
  const wireMessages = isOpenRouter && /^anthropic\//i.test(cleanModel)
    ? applyAnthropicCacheControl(messages)
    : messages

  const body: Record<string, unknown> = {
    model: cleanModel,
    messages: wireMessages,
    stream: isStreaming
  }

  if (isStreaming && (isOpenAI || isOpenRouter)) {
    body.stream_options = { include_usage: true }
  }
  if (supportsPromptCacheKey || config.promptCacheKey) {
    body.prompt_cache_key = cacheSeed
  }
  if (typeof config.temperature === 'number') {
    body.temperature = Math.max(0, Math.min(2.0, config.temperature))
  }
  if (typeof config.maxTokens === 'number' && config.maxTokens > 0) {
    body.max_tokens = config.maxTokens
  }
  if (tools && tools.length > 0) {
    body.tools = tools
    body.tool_choice = 'auto'
  }
  if (config.reasoningEffort && config.reasoningEffort !== 'default') {
    if (isOpenRouter) {
      body.reasoning = { effort: config.reasoningEffort }
    } else if (isOpenAI || hasAuthFetch) {
      body.reasoning_effort = config.reasoningEffort
    }
  }

  return body
}

export async function parseCompletionsResponse(
  response: Response,
  isStreaming: boolean,
  onContentChunk?: (chunk: string) => void,
  onReasoningChunk?: (reasoningChunk: string) => void,
  onToolCallChunk?: (callId: string, name: string, argsDelta: string, fullArgs: string) => void
): Promise<ChatResponse> {
  if (!isStreaming) {
    const json = await response.json()
    const choice = json?.choices?.[0]
    const finishReason = typeof choice?.finish_reason === 'string' ? choice.finish_reason : undefined
    let content = choice?.message?.content || ''
    let reasoning =
      choice?.message?.reasoning_content ||
      choice?.message?.reasoning ||
      choice?.message?.thought ||
      ''
    if (content.includes('<think>')) {
      const thinkMatch = content.match(/<think>([\s\S]*?)(?:<\/think>|$)/)
      if (thinkMatch) {
        if (!reasoning) reasoning = thinkMatch[1].trim()
        content = content.replace(/<think>[\s\S]*?(?:<\/think>|$)/, '').trim()
      }
    }
    const toolCallsRaw = choice?.message?.tool_calls
    const toolCalls = Array.isArray(toolCallsRaw)
      ? toolCallsRaw.map((tc: any) => ({
          id: tc.id || `call_${Math.random().toString(36).slice(2)}`,
          name: tc.function?.name || '',
          argumentsJson: typeof tc.function?.arguments === 'string' ? tc.function.arguments : ''
        }))
      : []

    if (content && onContentChunk) onContentChunk(content)
    if (reasoning && onReasoningChunk) onReasoningChunk(reasoning)

    const status: ChatResponseStatus =
      finishReason === 'length' || finishReason === 'content_filter' ? 'incomplete' : 'completed'

    return {
      content,
      reasoningContent: reasoning,
      toolCalls,
      usage: normalizeUsage(json.usage),
      status,
      ...(finishReason ? { finishReason } : {}),
      ...(status === 'incomplete' && finishReason ? { incompleteReason: finishReason } : {})
    }
  }

  return parseCompletionsStream(response, onContentChunk, onReasoningChunk, onToolCallChunk)
}

export async function parseCompletionsStream(
  response: Response,
  onContentChunk?: (chunk: string) => void,
  onReasoningChunk?: (reasoningChunk: string) => void,
  onToolCallChunk?: (callId: string, name: string, argsDelta: string, fullArgs: string) => void
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
  let pendingThink = ''
  let seenDone = false
  let finishReason: string | undefined
  const toolCallsBuf: Record<number, { id: string; streamId: string; name: string; argumentsJson: string }> = {}
  let usage: ChatResponseUsage | undefined = undefined

  const emitThinkText = (text: string): void => {
    if (!text) return
    if (inThinkTag) {
      reasoningBuf += text
      onReasoningChunk?.(text)
    } else {
      contentBuf += text
      onContentChunk?.(text)
    }
  }

  const processLine = (trimmed: string): boolean => {
    if (!trimmed) return false
    if (trimmed === 'data: [DONE]') {
      seenDone = true
      // The provider has completed the response; do not wait for the
      // underlying connection to close or treat a later reset as failure.
      void reader.cancel().catch(() => {})
      return true
    }
    if (!trimmed.startsWith('data: ')) return false

    let chunk: any
    try {
      chunk = JSON.parse(trimmed.slice(6))
    } catch {
      return false
    }

    if (chunk.error) {
      const detail = typeof chunk.error === 'string' ? chunk.error : chunk.error.message
      throw new Error(`Ошибка провайдера: ${typeof detail === 'string' && detail.trim() ? detail.slice(0, 300) : 'неизвестная ошибка'}`)
    }

    if (chunk.usage) {
      usage = normalizeUsage(chunk.usage)
    }

    const choice = chunk.choices?.[0]
    if (!choice) return false

    if (typeof choice.finish_reason === 'string' && choice.finish_reason) {
      finishReason = choice.finish_reason
    }

    const delta = choice.delta
    if (!delta) return false

    // Explicit reasoning fields (DeepSeek R1/V3, OpenRouter)
    const explicitReasoning = delta.reasoning_content || delta.reasoning || delta.thought
    if (explicitReasoning) {
      reasoningBuf += explicitReasoning
      onReasoningChunk?.(explicitReasoning)
    }

    // Content chunks (also parsing inline <think>...</think> tags if emitted)
    if (delta.content) {
      pendingThink += delta.content
      while (pendingThink) {
        const tag = inThinkTag ? '</think>' : '<think>'
        const tagIndex = pendingThink.indexOf(tag)
        if (tagIndex !== -1) {
          emitThinkText(pendingThink.slice(0, tagIndex))
          pendingThink = pendingThink.slice(tagIndex + tag.length)
          inThinkTag = !inThinkTag
          continue
        }

        // Keep only a suffix that could complete the current tag in a later chunk.
        let prefixLength = Math.min(tag.length - 1, pendingThink.length)
        while (prefixLength > 0 && !pendingThink.endsWith(tag.slice(0, prefixLength))) prefixLength--
        const completeLength = pendingThink.length - prefixLength
        emitThinkText(pendingThink.slice(0, completeLength))
        pendingThink = pendingThink.slice(completeLength)
        break
      }
    }

    // Streaming tool calls
    if (Array.isArray(delta.tool_calls)) {
      for (const tc of delta.tool_calls) {
        const idx = typeof tc.index === 'number' ? tc.index : 0
        if (!toolCallsBuf[idx]) {
          const id = tc.id || `call_${Math.random().toString(36).slice(2)}`
          toolCallsBuf[idx] = {
            id,
            streamId: id,
            name: tc.function?.name || '',
            argumentsJson: tc.function?.arguments || ''
          }
        } else {
          if (tc.id) toolCallsBuf[idx].id = tc.id
          if (tc.function?.name) {
            const namePart = tc.function.name as string
            const currentName = toolCallsBuf[idx].name
            if (!currentName) toolCallsBuf[idx].name = namePart
            else if (namePart.startsWith(currentName)) toolCallsBuf[idx].name = namePart
            else if (namePart !== currentName && !currentName.endsWith(namePart)) toolCallsBuf[idx].name += namePart
          }
          if (tc.function?.arguments) toolCallsBuf[idx].argumentsJson += tc.function.arguments
        }

        if ((tc.function?.arguments || (tc.function?.name && toolCallsBuf[idx].argumentsJson)) && onToolCallChunk) {
          onToolCallChunk(
            toolCallsBuf[idx].streamId,
            toolCallsBuf[idx].name,
            tc.function.arguments || '',
            toolCallsBuf[idx].argumentsJson
          )
        }
      }
    }
    return false
  }

  try {
    readStream: while (true) {
      const { done, value } = await reader.read()
      if (done) {
        const rest = decoder.decode()
        if (rest) buffer += rest
        if (buffer.trim()) processLine(buffer.trim())
        break
      }

      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() || ''

      for (const line of lines) {
        if (processLine(line.trim())) break readStream
      }
    }
  } finally {
    emitThinkText(pendingThink)
    reader.releaseLock()
  }

  const toolCalls: ToolCallChunk[] = Object.values(toolCallsBuf).map((tc) => ({
    id: tc.id || `call_${Math.random().toString(36).slice(2)}`,
    name: tc.name,
    argumentsJson: tc.argumentsJson,
    ...(tc.streamId !== tc.id ? { streamId: tc.streamId } : {})
  }))

  let status: ChatResponseStatus
  if (finishReason === 'length' || finishReason === 'content_filter') {
    status = 'incomplete'
  } else if (seenDone || finishReason === 'stop' || finishReason === 'tool_calls' || finishReason === 'function_call') {
    status = 'completed'
  } else {
    status = 'truncated_stream'
  }

  return {
    content: contentBuf,
    reasoningContent: reasoningBuf,
    toolCalls,
    usage,
    status,
    ...(finishReason ? { finishReason } : {}),
    ...(status === 'incomplete' && finishReason ? { incompleteReason: finishReason } : {})
  }
}
