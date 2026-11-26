import { createHash } from 'crypto'
import type { OpenAiMessage } from '../core/ContextCompactor'
import { resolveMessageAttachments, sanitizeMessages as sanitizeChatMessages } from './chat/messageSanitizer'
import { buildResponsesBody, parseResponsesJson, parseResponsesStream } from './chat/responsesProtocol'
import { buildCompletionsBody, parseCompletionsResponse } from './chat/completionsProtocol'
import {
  usesResponsesApi,
  type ChatConfig,
  type ChatResponse,
  type ChatResponseStatus,
  type ChatResponseUsage,
  type OpenAiToolDefinition,
  type ToolCallChunk
} from './chat/types'

export type {
  ChatConfig,
  ChatResponse,
  ChatResponseStatus,
  ChatResponseUsage,
  OpenAiToolDefinition,
  ToolCallChunk
}

/**
 * ChatService — Streaming OpenAI & OpenRouter API client with reasoning & tool support.
 */
export class ChatService {
  static async chat(
    config: ChatConfig,
    messages: OpenAiMessage[],
    tools?: OpenAiToolDefinition[],
    onContentChunk?: (chunk: string) => void,
    onReasoningChunk?: (reasoningChunk: string) => void,
    onToolCallChunk?: (callId: string, name: string, argsDelta: string, fullArgs: string) => void,
    abortSignal?: AbortSignal
  ): Promise<ChatResponse> {
    const MAX_ATTEMPTS = 4
    let lastError: Error | null = null
    let emitted = false

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      if (abortSignal?.aborted) throw new Error('Cancelled by user.')

      try {
        return await this._sendRequest(
          config,
          messages,
          tools,
          (chunk) => { emitted = true; onContentChunk?.(chunk) },
          (chunk) => { emitted = true; onReasoningChunk?.(chunk) },
          (id, name, delta, full) => { emitted = true; onToolCallChunk?.(id, name, delta, full) },
          abortSignal
        )
      } catch (err: unknown) {
        const error = err instanceof Error ? err : new Error(String(err))
        if (abortSignal?.aborted || error.message === 'Cancelled by user.') {
          throw new Error('Cancelled by user.')
        }
        lastError = error
        if (emitted || error.message.startsWith('Не удалось открыть прикреплённ')) throw error
        // Context overflow requires compaction in the runner, not repeated identical requests.
        if (/(context.{0,30}(length|window|limit|exceed|large)|too many tokens|maximum context)/i.test(error.message)) throw error
        console.warn(`[ChatService] Attempt ${attempt} failed:`, error.message)

        if (attempt < MAX_ATTEMPTS) {
          const isConcurrency =
            error.message.includes('429') ||
            error.message.includes('concurrency') ||
            error.message.includes('Дождитесь')
          const delayMs = isConcurrency
            ? attempt * 2000 + Math.random() * 500
            : attempt * 1000 + Math.random() * 300
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

  static async classify(
    config: ChatConfig,
    messages: OpenAiMessage[],
    options: { maxTokens?: number; abortSignal?: AbortSignal } = {}
  ): Promise<ChatResponse> {
    const model = config.classifierModel?.trim()
    if (!model) {
      throw new Error('Настройте модель-классификатор в разделе «Модель и API».')
    }

    const requestedMaxTokens = options.maxTokens
    const maxTokens = typeof requestedMaxTokens === 'number' && Number.isFinite(requestedMaxTokens) && requestedMaxTokens > 0
      ? Math.max(1, Math.floor(requestedMaxTokens))
      : 256

    return this.chat(
      { ...config, model, stream: false, maxTokens, reasoningEffort: 'default' },
      messages,
      undefined,
      undefined,
      undefined,
      undefined,
      options.abortSignal
    )
  }

  static sanitizeMessages(messages: OpenAiMessage[], config?: ChatConfig): OpenAiMessage[] {
    return sanitizeChatMessages(messages, config)
  }

  private static async _sendRequest(
    config: ChatConfig,
    messages: OpenAiMessage[],
    tools?: OpenAiToolDefinition[],
    onContentChunk?: (chunk: string) => void,
    onReasoningChunk?: (reasoningChunk: string) => void,
    onToolCallChunk?: (callId: string, name: string, argsDelta: string, fullArgs: string) => void,
    abortSignal?: AbortSignal
  ): Promise<ChatResponse> {
    const authFetch = typeof config.authFetch === 'function'
      ? config.authFetch as (pathOrUrl: string, init?: RequestInit) => Promise<Response>
      : null

    const baseUrl = (config.baseUrl || 'https://openrouter.ai/api/v1').replace(/\/+$/, '')
    const useResponsesApi = usesResponsesApi(config)
    const url = authFetch
      ? (useResponsesApi ? '/api/code/responses' : '/api/code/chat/completions')
      : useResponsesApi
        ? (baseUrl.endsWith('/responses') ? baseUrl : `${baseUrl}/responses`)
        : (baseUrl.endsWith('/chat/completions') ? baseUrl : `${baseUrl}/chat/completions`)

    const isStreaming = config.stream !== false
    const isOpenAI = !authFetch && url.includes('api.openai.com')
    const isOpenRouter = !authFetch && url.includes('openrouter.ai')

    const sanitizedMessages = await resolveMessageAttachments(messages, config)
    const cleanModel = (config.model || 'deepseek/deepseek-chat').replace(/^models\//, '').trim()
    const cacheSeed = config.promptCacheKey
      || createHash('sha256').update(`${cleanModel}:${(config.workspacePath || '').trim()}:${typeof config.sessionId === 'string' ? config.sessionId : ''}`).digest('hex').slice(0, 32)

    const body = useResponsesApi
      ? buildResponsesBody(cleanModel, sanitizedMessages, tools, config, isStreaming, cacheSeed)
      : buildCompletionsBody({
          cleanModel,
          messages: sanitizedMessages,
          tools,
          config,
          isStreaming,
          isOpenAI,
          isOpenRouter,
          hasAuthFetch: Boolean(authFetch),
          cacheSeed
        })

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'HTTP-Referer': 'https://zipply.my',
      'X-Title': 'Zipply',
      'User-Agent': 'Zipply/0.1.0 (https://zipply.my)'
    }

    if (config.apiKey && config.apiKey.trim()) {
      headers['Authorization'] = `Bearer ${config.apiKey.trim()}`
    }

    const response = authFetch
      ? await authFetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
          signal: abortSignal
        })
      : await (config.requestTransport ?? fetch)(url, {
          method: 'POST',
          headers,
          body: JSON.stringify(body),
          signal: abortSignal
        })

    if (!response.ok) {
      const text = await response.text()
      let message = text.slice(0, 300)
      try {
        const parsed = JSON.parse(text)
        if (typeof parsed?.message === 'string') message = parsed.message
      } catch { /* keep raw text */ }
      if (response.status === 429) throw new Error(message || 'Лимит запросов исчерпан.')
      throw new Error(`API error HTTP ${response.status}: ${message}`)
    }

    if (useResponsesApi) {
      return isStreaming
        ? await parseResponsesStream(response, onContentChunk, onReasoningChunk, onToolCallChunk)
        : await parseResponsesJson(response, onContentChunk, onReasoningChunk)
    }

    return await parseCompletionsResponse(
      response,
      isStreaming,
      onContentChunk,
      onReasoningChunk,
      onToolCallChunk
    )
  }
}
