import type { OpenAiMessage, ResponsesOutputItem } from '../../core/ContextCompactor'
import {
  normalizeUsage,
  type ChatConfig,
  type ChatResponse,
  type ChatResponseStatus,
  type ChatResponseUsage,
  type OpenAiToolDefinition,
  type ToolCallChunk
} from './types'

function isResponsesOutputItem(item: unknown): item is ResponsesOutputItem {
  return typeof item === 'object' && item !== null && 'type' in item && typeof item.type === 'string'
}

function responsesOutputItems(value: unknown): ResponsesOutputItem[] {
  return Array.isArray(value) ? value.filter(isResponsesOutputItem) : []
}

function responsesCallId(item: ResponsesOutputItem): string {
  return typeof item.call_id === 'string' ? item.call_id : ''
}

function responsesOutputText(output: readonly ResponsesOutputItem[]): { content: string; reasoningContent: string } {
  const content: string[] = []
  const summary: string[] = []
  for (const item of output) {
    if (item.type === 'reasoning' && Array.isArray(item.summary)) {
      for (const part of item.summary) {
        if (typeof part?.text === 'string' && part.text) summary.push(part.text)
      }
    } else if (item.type === 'message' && Array.isArray(item.content)) {
      for (const part of item.content) {
        if ((part?.type === 'output_text' || part?.type === 'text') && typeof part.text === 'string') content.push(part.text)
      }
    }
  }
  return { content: content.join(''), reasoningContent: summary.join('\n') }
}

export function buildResponsesBody(
  cleanModel: string,
  messages: OpenAiMessage[],
  tools: OpenAiToolDefinition[] | undefined,
  config: ChatConfig,
  isStreaming: boolean,
  cacheSeed: string
): Record<string, unknown> {
  const instructionsParts: string[] = []
  const input: Array<Record<string, unknown>> = []

  for (const msg of messages) {
    if (msg.role === 'system' || msg.role === 'developer') {
      if (typeof msg.content === 'string' && msg.content.trim()) {
        instructionsParts.push(msg.content.trim())
      }
      continue
    }

    if (msg.role === 'user') {
      if (Array.isArray(msg.content)) {
        const parts = msg.content.map((part) => {
          if (part.type === 'image_url' && part.image_url?.url) {
            return { type: 'input_image', image_url: part.image_url.url }
          }
          return { type: 'input_text', text: part.text || '' }
        })
        input.push({ type: 'message', role: 'user', content: parts })
      } else {
        input.push({ type: 'message', role: 'user', content: msg.content || '' })
      }
      continue
    }

    if (msg.role === 'assistant') {
      const nativeOutput = msg.responsesOutput || []
      const nativeCalls = new Set<string>()
      for (const item of nativeOutput) {
        if (item.type === 'function_call') {
          const callId = responsesCallId(item)
          if (!callId) continue
          nativeCalls.add(callId)
        }
        input.push(item)
      }
      const hasCalls = Array.isArray(msg.tool_calls) && msg.tool_calls.length > 0
      if (!nativeOutput.some(item => item.type === 'message') && typeof msg.content === 'string' && msg.content.trim()
        && (!hasCalls || msg.content !== '(empty response)')) {
        input.push({ type: 'message', role: 'assistant', content: msg.content })
      }
      if (hasCalls) {
        for (const tc of msg.tool_calls!) {
          if (nativeCalls.has(tc.id)) continue
          input.push({
            type: 'function_call',
            call_id: tc.id,
            name: tc.function.name,
            arguments: tc.function.arguments || '{}'
          })
        }
      }
      continue
    }

    if (msg.role === 'tool') {
      input.push({
        type: 'function_call_output',
        call_id: msg.tool_call_id || '',
        output: typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content ?? '')
      })
    }
  }

  const body: Record<string, unknown> = {
    model: cleanModel,
    input,
    store: false,
    include: ['reasoning.encrypted_content'],
    stream: isStreaming,
    prompt_cache_key: cacheSeed
  }

  if (instructionsParts.length > 0) {
    body.instructions = instructionsParts.join('\n\n')
  }
  if (typeof config.temperature === 'number') {
    body.temperature = Math.max(0, Math.min(2.0, config.temperature))
  }
  if (typeof config.maxTokens === 'number' && config.maxTokens > 0) {
    body.max_output_tokens = config.maxTokens
  }
  if (tools && tools.length > 0) {
    body.tools = tools.map((tool) => ({
      type: 'function',
      name: tool.function.name,
      description: tool.function.description,
      parameters: tool.function.parameters
    }))
    body.tool_choice = 'auto'
  }
  if (config.reasoningEffort && config.reasoningEffort !== 'default') {
    body.reasoning = {
      effort: config.reasoningEffort,
      summary: 'auto'
    }
  }

  return body
}

export async function parseResponsesJson(
  response: Response,
  onContentChunk?: (chunk: string) => void,
  onReasoningChunk?: (reasoningChunk: string) => void
): Promise<ChatResponse> {
  const json = await response.json()
  if (json?.status === 'failed' || json?.status === 'cancelled') {
    const detail = json?.error?.message || json.status
    throw new Error(`Ошибка провайдера: ${typeof detail === 'string' && detail.trim() ? detail.slice(0, 300) : 'неизвестная ошибка'}`)
  }
  const toolCalls: ToolCallChunk[] = []
  const responsesOutput = responsesOutputItems(json?.output)
  for (const item of responsesOutput) {
    if (item.type === 'function_call') {
      toolCalls.push({
        id: responsesCallId(item) || (typeof item.id === 'string' ? item.id : '') || `call_${Math.random().toString(36).slice(2)}`,
        name: typeof item.name === 'string' ? item.name : '',
        argumentsJson: typeof item.arguments === 'string' ? item.arguments : item.arguments !== undefined ? JSON.stringify(item.arguments) : ''
      })
    }
  }

  const { content, reasoningContent } = responsesOutputText(responsesOutput)
  if (content && onContentChunk) onContentChunk(content)
  if (reasoningContent && onReasoningChunk) onReasoningChunk(reasoningContent)

  const isIncomplete = json?.status === 'incomplete'
  const incompleteReason = typeof json?.incomplete_details?.reason === 'string' ? json.incomplete_details.reason : undefined
  return {
    content,
    reasoningContent,
    toolCalls,
    ...(responsesOutput.length ? { responsesOutput } : {}),
    usage: normalizeUsage(json?.usage),
    status: isIncomplete ? 'incomplete' : 'completed',
    ...(incompleteReason ? { incompleteReason } : {})
  }
}

export async function parseResponsesStream(
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
  let usage: ChatResponseUsage | undefined
  let completionStatus: ChatResponseStatus = 'truncated_stream'
  let incompleteReason: string | undefined
  let seenTerminalEvent = false
  let terminalOutput: ResponsesOutputItem[] = []
  const completedItems = new Map<number, ResponsesOutputItem>()
  type StreamCall = ToolCallChunk & { streamId: string }
  const orderedCalls: StreamCall[] = []
  const callsByIndex = new Map<number, StreamCall>()
  const callsByItemId = new Map<string, StreamCall>()

  const registerCall = (outputIndex: number | undefined, item: Record<string, unknown>, finished = false): StreamCall => {
    const itemId = typeof item?.id === 'string' ? item.id : ''
    const callId = typeof item.call_id === 'string' ? item.call_id : ''
    let entry = (itemId ? callsByItemId.get(itemId) : undefined)
      || (typeof outputIndex === 'number' ? callsByIndex.get(outputIndex) : undefined)
    if (!entry) {
      const id = callId || itemId || `call_${Math.random().toString(36).slice(2)}`
      entry = {
        id,
        streamId: itemId || id,
        name: typeof item?.name === 'string' ? item.name : '',
        argumentsJson: typeof item?.arguments === 'string' ? item.arguments : ''
      }
      orderedCalls.push(entry)
    } else {
      if (callId) entry.id = callId
      if (typeof item?.name === 'string' && item.name) entry.name = item.name
      if ((finished || !entry.argumentsJson) && typeof item.arguments === 'string') {
        entry.argumentsJson = item.arguments
      }
    }
    if (itemId) callsByItemId.set(itemId, entry)
    if (typeof outputIndex === 'number') callsByIndex.set(outputIndex, entry)
    return entry
  }

  const processLine = (trimmed: string): boolean => {
    if (!trimmed) return false
    if (trimmed === 'data: [DONE]') {
      void reader.cancel().catch(() => {})
      return true
    }
    if (!trimmed.startsWith('data: ')) return false

    let event: any
    try {
      event = JSON.parse(trimmed.slice(6))
    } catch {
      return false
    }

    if (event.error || event.type === 'error' || event.type === 'response.failed') {
      const detail = event.error?.message || event.response?.error?.message || (typeof event.error === 'string' ? event.error : '')
      throw new Error(`Ошибка провайдера: ${typeof detail === 'string' && detail.trim() ? detail.slice(0, 300) : 'неизвестная ошибка'}`)
    }

    if (event.type === 'response.reasoning_summary_text.delta' || event.type === 'response.reasoning_text.delta') {
      const delta = typeof event.delta === 'string' ? event.delta : ''
      if (delta) {
        reasoningBuf += delta
        onReasoningChunk?.(delta)
      }
    } else if (event.type === 'response.output_text.delta') {
      const delta = typeof event.delta === 'string' ? event.delta : ''
      if (delta) {
        contentBuf += delta
        onContentChunk?.(delta)
      }
    } else if (event.type === 'response.output_item.added') {
      if (event.item?.type === 'function_call') {
        registerCall(typeof event.output_index === 'number' ? event.output_index : undefined, event.item)
      }
    } else if (event.type === 'response.function_call_arguments.delta') {
      const delta = typeof event.delta === 'string' ? event.delta : ''
      let entry = (typeof event.item_id === 'string' ? callsByItemId.get(event.item_id) : undefined)
        || (typeof event.output_index === 'number' ? callsByIndex.get(event.output_index) : undefined)
      if (!entry) {
        entry = registerCall(typeof event.output_index === 'number' ? event.output_index : undefined, { id: event.item_id })
      }
      if (delta) {
        entry.argumentsJson += delta
        onToolCallChunk?.(entry.streamId, entry.name, delta, entry.argumentsJson)
      }
    } else if (event.type === 'response.function_call_arguments.done') {
      const entry = (typeof event.item_id === 'string' ? callsByItemId.get(event.item_id) : undefined)
        || (typeof event.output_index === 'number' ? callsByIndex.get(event.output_index) : undefined)
      if (entry && typeof event.arguments === 'string') {
        entry.argumentsJson = event.arguments
      }
    } else if (event.type === 'response.output_item.done') {
      const index = typeof event.output_index === 'number' ? event.output_index : undefined
      if (isResponsesOutputItem(event.item)) {
        if (index !== undefined) completedItems.set(index, event.item)
        if (event.item.type === 'function_call') registerCall(index, event.item, true)
      }
    } else if (event.type === 'response.incomplete') {
      seenTerminalEvent = true
      completionStatus = 'incomplete'
      terminalOutput = responsesOutputItems(event.response?.output)
      incompleteReason = typeof event.response?.incomplete_details?.reason === 'string'
        ? event.response.incomplete_details.reason
        : 'incomplete'
      if (event.response?.usage) {
        usage = normalizeUsage(event.response.usage)
      }
      void reader.cancel().catch(() => {})
      return true
    } else if (event.type === 'response.completed' || event.type === 'response.done') {
      seenTerminalEvent = true
      terminalOutput = responsesOutputItems(event.response?.output)
      if (event.response?.status === 'incomplete') {
        completionStatus = 'incomplete'
        incompleteReason = typeof event.response?.incomplete_details?.reason === 'string'
          ? event.response.incomplete_details.reason
          : 'incomplete'
      } else {
        completionStatus = 'completed'
      }
      if (event.response?.usage) {
        usage = normalizeUsage(event.response.usage)
      }
      void reader.cancel().catch(() => {})
      return true
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
    reader.releaseLock()
  }

  if (!seenTerminalEvent) {
    completionStatus = 'truncated_stream'
  }

  const byOutputIndex = <T>(entries: Map<number, T>): T[] =>
    [...entries].sort(([a], [b]) => a - b).map(([, value]) => value)
  const responsesOutput = terminalOutput.length ? terminalOutput : byOutputIndex(completedItems)
  const completeOutputCalls = terminalOutput.flatMap((item, index) =>
    item.type === 'function_call' ? [registerCall(index, item, true)] : [])
  const calls = terminalOutput.length ? completeOutputCalls : [...new Set([...byOutputIndex(callsByIndex), ...orderedCalls])]
  const toolCalls: ToolCallChunk[] = calls.map((tc) => ({
    id: tc.id,
    name: tc.name,
    argumentsJson: tc.argumentsJson,
    ...(tc.streamId !== tc.id ? { streamId: tc.streamId } : {})
  }))

  const terminalText = responsesOutputText(responsesOutput)
  if (!contentBuf && terminalText.content) onContentChunk?.(terminalText.content)
  if (!reasoningBuf && terminalText.reasoningContent) onReasoningChunk?.(terminalText.reasoningContent)

  return {
    content: contentBuf || terminalText.content,
    reasoningContent: reasoningBuf || terminalText.reasoningContent,
    toolCalls,
    ...(responsesOutput.length ? { responsesOutput } : {}),
    usage,
    status: completionStatus,
    ...(incompleteReason ? { incompleteReason } : {})
  }
}
