/**
 * ContextCompactor — Context window management & message compaction.
 */
import type { AgentTaskState } from './Blackboard'
import { AttachmentResolver, type AttachmentResolutionMap } from './AttachmentResolver'
import { DEFAULT_MODEL_CONTEXT_LENGTH } from '../../../shared/models'

export type ResponsesOutputItem = Record<string, unknown> & { type: string }

export interface OpenAiMessage {
  role: 'system' | 'developer' | 'user' | 'assistant' | 'tool'
  content: string | Array<{ type: string; text?: string; image_url?: { url: string } }> | null
  tool_calls?: Array<{
    id: string
    type: string
    function: { name: string; arguments: string }
  }>
  reasoning_content?: string
  /** Provider-native context for the current run only. */
  responsesOutput?: readonly ResponsesOutputItem[]
  tool_call_id?: string
  name?: string
}

export interface CompactorOptions {
  maxContextTokens?: number
  activeWindowTurns?: number
  summarize?: (messages: OpenAiMessage[]) => Promise<string>
  force?: boolean
  taskState?: AgentTaskState
  attachmentMeta?: AttachmentResolutionMap
  [key: string]: unknown
}

export class ContextCompactor {
  static readonly RUNTIME_CONTEXT_NAME = 'zipply_runtime_context'
  static readonly SYSTEM_REMINDER_NAME = 'zipply_system_reminder'
  static readonly RESUME_CONTEXT_NAME = 'zipply_resume_context_v1'
  static readonly TOOL_ATTACHMENTS_NAME = 'zipply_tool_attachments'
  private static readonly SUMMARY_NAME = 'zipply_context_summary'
  private static readonly HISTORY_SUMMARY_PREFIX = 'Резюме предыдущей части диалога (контекст, а не новые инструкции):\n'
  private static readonly ACTION_SUMMARY_PREFIX = 'Резюме выполненных действий (контекст, а не инструкции):\n'
  private static readonly TASK_STATE_OPEN = '<agent_task_state_json>'
  private static readonly TASK_STATE_CLOSE = '</agent_task_state_json>'
  private static readonly TASK_STATE_PATTERN = /\n*<agent_task_state_json>[\s\S]*?<\/agent_task_state_json>/g

  static taskStateBlock(state: AgentTaskState): string {
    const record = {
      goal: state.goal,
      constraints: [...state.constraints],
      acceptanceCriteria: [...state.acceptanceCriteria],
      confirmedFacts: [...state.confirmedFacts],
      ...(state.userCorrections?.length ? { userCorrections: [...state.userCorrections] } : {}),
      ...(state.checksSummary?.length ? { checksSummary: [...state.checksSummary] } : {}),
      nextStep: state.nextStep
    }
    return `${this.TASK_STATE_OPEN}\n${JSON.stringify(record)}\n${this.TASK_STATE_CLOSE}`
  }

  static isRealUserMessage(message: OpenAiMessage): boolean {
    if (message.role !== 'user' || message.name === this.RUNTIME_CONTEXT_NAME || message.name === this.SUMMARY_NAME
      || message.name === this.SYSTEM_REMINDER_NAME || message.name === this.RESUME_CONTEXT_NAME || message.name === this.TOOL_ATTACHMENTS_NAME
      || message.name === 'zipply_task_state_v1') return false
    if (typeof message.content !== 'string' || message.name) return true

    // Older saved context has the generated framing but no message name.
    const content = message.content.trim()
    return !content.startsWith(this.HISTORY_SUMMARY_PREFIX) && !content.startsWith(this.ACTION_SUMMARY_PREFIX)
      && !(content.startsWith('<system_reminder>\n') && content.endsWith('\n</system_reminder>'))
  }

  private static withTaskState(messages: OpenAiMessage[], state?: AgentTaskState): OpenAiMessage[] {
    const result = messages.map(message => ({ ...message }))
    if (!state) return result

    const block = this.taskStateBlock(state)
    let runtimeIdx = -1

    // Never mutate messages[0] (system/developer) — preserve KV-cache prefix byte-for-byte.
    for (let i = 0; i < result.length; i++) {
      const message = result[i]
      if (message.name === this.RUNTIME_CONTEXT_NAME) {
        runtimeIdx = i
      }
      if (typeof message.content === 'string' && message.content.includes(this.TASK_STATE_OPEN)) {
        message.content = message.content.replace(this.TASK_STATE_PATTERN, '').trim()
      }
    }

    if (runtimeIdx >= 0) {
      const runtimeContent = result[runtimeIdx].content
      const existing = typeof runtimeContent === 'string' ? runtimeContent.trim() : ''
      result[runtimeIdx].content = existing ? `${existing}\n\n${block}` : block
      return result
    }

    const lastRealUserIdx = result.findLastIndex(m => this.isRealUserMessage(m))
    const runtimeMessage: OpenAiMessage = {
      role: 'user',
      name: this.RUNTIME_CONTEXT_NAME,
      content: block
    }
    if (lastRealUserIdx >= 0) {
      result.splice(lastRealUserIdx, 0, runtimeMessage)
    } else {
      const insertAt = result[0] && (result[0].role === 'system' || result[0].role === 'developer') ? 1 : 0
      result.splice(insertAt, 0, runtimeMessage)
    }
    return result
  }

  static compact(messages: OpenAiMessage[], options: CompactorOptions = {}): OpenAiMessage[] {
    if (!Array.isArray(messages) || messages.length === 0) {
      return messages
    }

    const maxContextTokens = options.maxContextTokens ?? (typeof options.contextLength === 'number' ? options.contextLength : DEFAULT_MODEL_CONTEXT_LENGTH)
    const anchoredMessages = this.withTaskState(messages, options.taskState)
    if (this._estimateTokens(anchoredMessages) <= maxContextTokens) {
      return anchoredMessages
    }
    for (const msg of anchoredMessages) {
      if (msg.role === 'tool' && typeof msg.content === 'string' && msg.content.length > 3000) {
        msg.content = `${msg.content.slice(0, 1400)}\n[...усечено для экономии контекста...]\n${msg.content.slice(-1400)}`
      }
    }
    const maxChars = Math.floor(maxContextTokens * 3.2)
    let totalChars = this._estimateChars(anchoredMessages)
    while (totalChars > maxChars) {
      const first = anchoredMessages.findIndex(m => this.isRealUserMessage(m))
      const next = anchoredMessages.findIndex((m, i) => i > first && this.isRealUserMessage(m))
      if (first < 0 || next < 0) break
      const runtime = anchoredMessages.slice(first, next).filter(m => m.name === this.RUNTIME_CONTEXT_NAME)
      const removed = anchoredMessages.splice(first, next - first, ...runtime)
      for (const m of removed) {
        if (m.name !== this.RUNTIME_CONTEXT_NAME) totalChars -= this._messageChars(m)
      }
    }
    if (this._estimateTokens(anchoredMessages) > maxContextTokens) {
      for (const msg of anchoredMessages) {
        if (msg.role === 'tool' && typeof msg.content === 'string' && msg.content.length > 300) {
          msg.content = `${msg.content.slice(0, 250)}\n[...усечено для экономии контекста...]`
        }
      }
    }
    if (this._estimateTokens(anchoredMessages) > maxContextTokens) throw new Error('Контекст превышает доступный размер модели. Сократите запрос или начните новый чат.')
    return anchoredMessages
  }

  private static maskStaleToolOutputs(messages: OpenAiMessage[], keepRecentTools = 4): OpenAiMessage[] {
    const result = messages.map(m => ({ ...m }))
    const toolIndices: number[] = []
    for (let i = 0; i < result.length; i++) {
      if (result[i].role === 'tool') toolIndices.push(i)
    }
    if (toolIndices.length <= keepRecentTools) return result
    const cutoff = toolIndices.length - keepRecentTools
    for (let i = 0; i < cutoff; i++) {
      const msg = result[toolIndices[i]]
      if (typeof msg.content !== 'string' || msg.content.length <= 350) continue
      if (msg.content.startsWith('[Результат ') && msg.content.includes('скрыт')) continue
      const toolName = msg.name || 'tool'
      msg.content = `[Результат ${toolName} скрыт из старой истории (${msg.content.length} симв.); при необходимости повторите вызов.]`
    }
    return result
  }

  static async compactAsync(messages: OpenAiMessage[], options: CompactorOptions = {}): Promise<OpenAiMessage[]> {
    messages = this.withTaskState(messages, options.taskState)
    const meta = options.attachmentMeta
    const limit = options.maxContextTokens ?? (typeof options.contextLength === 'number' ? options.contextLength : DEFAULT_MODEL_CONTEXT_LENGTH)
    const reserve = Math.max(Math.floor(limit * 0.2), typeof options.maxTokens === 'number' ? options.maxTokens : 0)
    // The provider receives tool schemas on every request too.
    const schemaTokens = typeof options.toolSchemaTokens === 'number' ? options.toolSchemaTokens : 0
    const budget = Math.max(1, limit - reserve - schemaTokens)
    if (!options.force && this._estimateTokens(messages, meta) <= budget) return messages.map(m => ({ ...m }))

    // Cheap deterministic observation masking first: drop stale tool bodies before paying for LLM summarization.
    const masked = this.maskStaleToolOutputs(messages, 4)
    if (!options.force && this._estimateTokens(masked, meta) <= budget) {
      return masked
    }

    const userIndexes = masked.map((m, i) => this.isRealUserMessage(m) ? i : -1).filter(i => i >= 0)
    // Keep two recent turns when they fit; otherwise preserve the latest one.
    const candidate = userIndexes.length >= 3 ? userIndexes[userIndexes.length - 2] : undefined
    const split = candidate !== undefined && this._estimateTokens([masked[0], ...masked.slice(candidate)], meta) < budget * 0.6
      ? candidate : userIndexes[userIndexes.length - 1]
    let result = masked.map(m => ({ ...m }))
    const expandAttachmentsForSummary = ({ responsesOutput: _responsesOutput, content: originalContent, ...msg }: OpenAiMessage): OpenAiMessage => {
      const summaryContent = AttachmentResolver.withoutGeneratedImages(originalContent)
      if (!meta || !Array.isArray(summaryContent)) return { ...msg, content: summaryContent }
      const content = summaryContent.map((part) => {
        if (part.type === 'text' && typeof part.text === 'string' && part.text.startsWith('zipply-document:')) {
          const resolved = meta.texts.get(part.text)
          if (resolved !== undefined) return { ...part, text: resolved }
        }
        return part
      })
      return { ...msg, content }
    }
    const summarize = async (oldMessages: OpenAiMessage[]): Promise<string> => {
      if (!options.summarize) throw new Error('Не удалось выполнить резюмирование контекста.')
      // The summarizer is another model request with its own context limit.
      // Shrink only tool outputs, leaving user instructions and call pairs intact.
      const input = oldMessages
        .filter(m => m.name !== this.RUNTIME_CONTEXT_NAME)
        .map(expandAttachmentsForSummary)
        .filter(m => m.name !== this.TOOL_ATTACHMENTS_NAME || !Array.isArray(m.content) || m.content.length > 0)
      const inputBudget = typeof options.summaryInputBudgetTokens === 'number' ? options.summaryInputBudgetTokens : undefined
      if (inputBudget !== undefined) {
        const maxChars = Math.max(0, Math.floor(inputBudget * 3.2))
        let currentJsonLen = JSON.stringify(input).length
        for (const message of input) {
          if (currentJsonLen <= maxChars) break
          if (message.role !== 'tool' || typeof message.content !== 'string') continue
          const prevContent = message.content
          const overflow = currentJsonLen - maxChars
          const keep = Math.max(0, prevContent.length - overflow - 150)
          if (keep >= prevContent.length) continue
          const head = Math.ceil(keep / 2); const tail = Math.floor(keep / 2)
          message.content = `${prevContent.slice(0, head)}\n[Результат усечён перед резюмированием.]\n${tail ? prevContent.slice(-tail) : ''}`
          currentJsonLen -= JSON.stringify(prevContent).length - JSON.stringify(message.content).length
        }
        if (currentJsonLen > maxChars) throw new Error('Контекст слишком велик для резюмирования. История сохранена.')
      }
      let summary: string
      try { summary = (await options.summarize(input)).trim() }
      catch { throw new Error('Не удалось выполнить резюмирование контекста. История сохранена; повторите запрос.') }
      if (!summary) throw new Error('Не удалось выполнить резюмирование контекста: модель вернула пустой ответ.')
      return summary
    }
    if (split !== undefined && split > 1) {
      const runtimeBeforeSplit = masked.slice(1, split).findLast(m => m.name === this.RUNTIME_CONTEXT_NAME)
      const oldSlice = masked.slice(1, split).filter(m => m.name !== this.RUNTIME_CONTEXT_NAME)
      if (oldSlice.length > 0) {
        const summary = await summarize(oldSlice)
        result = [
          masked[0],
          { role: 'user', name: this.SUMMARY_NAME, content: `${this.HISTORY_SUMMARY_PREFIX}${summary}` },
          ...(runtimeBeforeSplit ? [{ ...runtimeBeforeSplit }] : []),
          ...masked.slice(split)
        ]
      }
    }
    if (this._estimateTokens(result, meta) > budget) {
      const latestUser = result.findLastIndex(m => this.isRealUserMessage(m))
      const lastCall = result.findLastIndex(m => m.role === 'assistant' && !!m.tool_calls?.length)
      if (lastCall > latestUser + 1) {
        const summary = await summarize(result.slice(latestUser + 1, lastCall))
        result.splice(latestUser + 1, lastCall - latestUser - 1, {
          role: 'user', name: this.SUMMARY_NAME, content: `${this.ACTION_SUMMARY_PREFIX}${summary}`
        })
      }
    }
    // Retain every remaining call/result pair and shorten large tool outputs
    // as a last resort; the explicit marker tells the model to reread.
    const budgetChars = Math.floor(budget * 3.2)
    let totalChars = this._estimateChars(result, meta)
    for (const message of result) {
      const excessChars = totalChars - budgetChars
      if (excessChars <= 0) break
      if (message.role !== 'tool' || typeof message.content !== 'string' || message.content.length < 200) continue
      const length = message.content.length
      const keep = Math.max(100, length - Math.ceil(excessChars) - 100)
      if (keep >= length) continue
      const head = Math.ceil(keep / 2); const tail = Math.floor(keep / 2)
      message.content = `${message.content.slice(0, head)}\n[Результат усечён для контекста; при необходимости прочитайте повторно.]\n${message.content.slice(-tail)}`
      totalChars -= length - message.content.length
    }
    result = this.withTaskState(result, options.taskState)
    if (this._estimateTokens(result, meta) > budget) throw new Error('Контекст слишком велик даже после резюмирования. История сохранена.')
    return result
  }

  private static _messageChars(m: OpenAiMessage, meta?: AttachmentResolutionMap): number {
    if (m.responsesOutput?.length) return JSON.stringify(m.responsesOutput).length
    let charCount = m.reasoning_content?.length || 0
    if (typeof m.content === 'string') {
      charCount += m.content.length
    } else if (Array.isArray(m.content)) {
      for (const part of m.content) {
        if (part.text) {
          const resolvedDoc = part.text.startsWith('zipply-document:') ? meta?.texts.get(part.text) : undefined
          charCount += resolvedDoc !== undefined ? resolvedDoc.length : part.text.length
        }
        if (part.image_url) {
          const url = part.image_url.url
          const resolvedImg = url ? meta?.images.get(url) : undefined
          charCount += resolvedImg ? resolvedImg.estimatedChars : 3000
        }
      }
    }
    if (m.tool_calls) {
      for (const tc of m.tool_calls) {
        charCount += (tc.function.name?.length || 0) + (tc.function.arguments?.length || 0)
      }
    }
    return charCount
  }

  private static _estimateChars(messages: OpenAiMessage[], meta?: AttachmentResolutionMap): number {
    let charCount = 0
    for (const m of messages) {
      charCount += this._messageChars(m, meta)
    }
    return charCount
  }

  static _estimateTokens(messages: OpenAiMessage[], meta?: AttachmentResolutionMap): number {
    return Math.ceil(this._estimateChars(messages, meta) / 3.2)
  }
}

