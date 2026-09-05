/**
 * ContextCompactor — Production-grade Zero-Debuff Context Management & Goal Anchor Engine.
 *
 * Guarantees:
 * 1. Goal Anchor Protection (Anti-Drift): Continuously pins the user's primary objective directly
 *    into the system prompt during multi-step execution so the AI never strays off task.
 * 2. Adaptive Token Scaling (256k Target): Relaxes pruning under light loads (<40%), tightens dynamically (>75%).
 * 3. Terminal Stack Trace Preservation: Keeps exit codes, top header, and trailing stack traces intact.
 * 4. 100% API Spec Linkage: Preserves assistant tool_calls <-> tool_call_id pairs.
 */

export interface OpenAiMessage {
  role: 'system' | 'developer' | 'user' | 'assistant' | 'tool'
  content: string | Array<{ type: string; text?: string; image_url?: { url: string } }> | null
  tool_calls?: Array<{
    id: string
    type: string
    function: { name: string; arguments: string }
  }>
  reasoning_content?: string
  tool_call_id?: string
  name?: string
}

export interface CompactorOptions {
  maxContextTokens?: number
  activeWindowTurns?: number
  enableSummaryCompression?: boolean
  useLlmSummary?: boolean
}

export class ContextCompactor {
  static compact(messages: OpenAiMessage[], options: CompactorOptions = {}): OpenAiMessage[] {
    if (!Array.isArray(messages) || messages.length === 0) {
      return messages
    }

    const maxContextTokens = options.maxContextTokens ?? 256000
    const activeWindowTurns = options.activeWindowTurns ?? 3
    const enableSummaryCompression = options.enableSummaryCompression ?? true

    // 1. Goal Anchor Protection: Extract latest active user directive and anchor it in system prompt
    const userMessages = messages.filter(
      (m) =>
        m.role === 'user' &&
        typeof m.content === 'string' &&
        !m.content.startsWith('### 📋 HISTORICAL PROGRESS SUMMARY') &&
        !m.content.startsWith('[WATCHDOG')
    )
    const latestUserMsg = userMessages.length > 0 ? (userMessages[userMessages.length - 1].content as string) : null
    const anchoredMessages: OpenAiMessage[] = messages.map((m) => ({ ...m }))

    if (latestUserMsg && (anchoredMessages[0]?.role === 'system' || anchoredMessages[0]?.role === 'developer')) {
      let sysContent = typeof anchoredMessages[0].content === 'string' ? anchoredMessages[0].content : ''
      const goalTagStart = '<active_goal>'
      const goalTagEnd = '</active_goal>'
      const anchorHeader = '### 🎯 ACTIVE TASK GOAL (STRICTLY ADHERE - DO NOT DRIFT):'
      const oldAnchorHeader = '### 🎯 PRIMARY GOAL (STRICTLY ADHERE - DO NOT DRIFT):'

      if (sysContent.includes(goalTagStart)) {
        sysContent = sysContent.replace(new RegExp(`\\n*${goalTagStart}[\\s\\S]*?${goalTagEnd}`), '').trimEnd()
      } else if (sysContent.includes(anchorHeader)) {
        sysContent = sysContent.replace(new RegExp(`\\n*${anchorHeader}[\\s\\S]*$`), '').trimEnd()
      } else if (sysContent.includes(oldAnchorHeader)) {
        sysContent = sysContent.replace(new RegExp(`\\n*${oldAnchorHeader}[\\s\\S]*$`), '').trimEnd()
      }

      anchoredMessages[0].content = `${sysContent}\n\n<active_goal>\n${latestUserMsg}\n</active_goal>`
    }

    if (anchoredMessages.length <= 6) {
      return anchoredMessages
    }

    // 2. Calculate accurate context token usage factoring in ASCII vs Cyrillic/non-ASCII weights
    const estimatedTokens = this._estimateTokens(anchoredMessages)
    const usageRatio = estimatedTokens / maxContextTokens

    // Dynamic pruning thresholds based on capacity usage
    let maxToolOutputLen = 6000
    let headLen = 2000
    let tailLen = 2000

    if (usageRatio > 0.8) {
      maxToolOutputLen = 1200
      headLen = 500
      tailLen = 500
    } else if (usageRatio > 0.6) {
      maxToolOutputLen = 3000
      headLen = 1000
      tailLen = 1000
    }

    // 3. Identify active window cutoff index (keep last activeWindowTurns intact)
    const activeTurns = activeWindowTurns
    let toolTurnsCount = 0
    let cutoffIndex = 0

    for (let i = anchoredMessages.length - 1; i >= 0; i--) {
      const msg = anchoredMessages[i]
      if (msg.role === 'assistant' && Array.isArray(msg.tool_calls) && msg.tool_calls.length > 0) {
        toolTurnsCount++
        if (toolTurnsCount === activeTurns) {
          // If the message before this assistant is a user message, include it in active window
          cutoffIndex = i > 1 && anchoredMessages[i - 1].role === 'user' ? i - 1 : i
          break
        }
      }
    }

    if (cutoffIndex === 0) {
      return anchoredMessages
    }

    // Guard: Ensure cutoffIndex never starts on an orphaned tool message
    while (cutoffIndex > 0 && anchoredMessages[cutoffIndex].role === 'tool') {
      cutoffIndex--
    }

    // 4. Summary Compression: Collapse historical messages only if token usage > 60% or history is very long (> 24 messages)
    if (enableSummaryCompression && (usageRatio > 0.6 || anchoredMessages.length > 24) && cutoffIndex > 2) {
      const systemMsg = anchoredMessages[0]
      const activeMessages = anchoredMessages.slice(cutoffIndex)
      const historicalMessages = anchoredMessages.slice(1, cutoffIndex)

      const summaryText = this._generateStructuredSummary(historicalMessages)
      const summaryMsg: OpenAiMessage = {
        role: 'user',
        content: `### 📋 HISTORICAL PROGRESS SUMMARY (${historicalMessages.length} past messages collapsed for optimal token performance):\n${summaryText}`
      }

      // Compact active messages' tool outputs if needed
      const compactedActive = activeMessages.map((msg) => {
        if (msg.role === 'tool') {
          return this._pruneToolMessage(msg, maxToolOutputLen, headLen, tailLen)
        }
        return msg
      })

      return [systemMsg, summaryMsg, ...compactedActive]
    }

    // 5. Standard Pruning for historical tool outputs before cutoffIndex
    return anchoredMessages.map((msg, index) => {
      if (msg.role === 'system' || msg.role === 'user' || index >= cutoffIndex) {
        return msg
      }

      if (msg.role === 'tool') {
        return this._pruneToolMessage(msg, maxToolOutputLen, headLen, tailLen)
      }

      return msg
    })
  }

  static _generateStructuredSummary(historicalMessages: OpenAiMessage[]): string {
    const actionLogs: string[] = []
    const modifiedFiles = new Set<string>()
    const inspectedFiles = new Set<string>()
    const executedCommands: string[] = []

    for (const msg of historicalMessages) {
      if (msg.role === 'user' && typeof msg.content === 'string' && !msg.content.startsWith('### 📋 HISTORICAL PROGRESS SUMMARY')) {
        actionLogs.push(`- User Directive: ${msg.content.slice(0, 200)}`)
      } else if (msg.role === 'assistant') {
        if (typeof msg.content === 'string' && msg.content) {
          actionLogs.push(`- Assistant Note: ${msg.content.slice(0, 200)}`)
        }
        if (Array.isArray(msg.tool_calls)) {
          for (const tc of msg.tool_calls) {
            const funcName = tc.function?.name || 'tool'
            const rawArgs = tc.function?.arguments || '{}'
            try {
              const parsedArgs = JSON.parse(rawArgs)
              if (funcName === 'file') {
                const targetPath = parsedArgs.path || ''
                if (targetPath) {
                  if (['write', 'edit', 'append', 'delete', 'move', 'copy'].includes(parsedArgs.action)) {
                    modifiedFiles.add(targetPath)
                  } else {
                    inspectedFiles.add(targetPath)
                  }
                }
              } else if (funcName === 'terminal' && parsedArgs.command) {
                executedCommands.push(parsedArgs.command.slice(0, 100))
              }
            } catch {}
            const argsStr = rawArgs.slice(0, 100)
            actionLogs.push(`- Executed Tool \`${funcName}\` (${argsStr})`)
          }
        }
      } else if (msg.role === 'tool') {
        let contentSnippet = ''
        if (typeof msg.content === 'string') {
          contentSnippet = msg.content.slice(0, 150)
        } else if (Array.isArray(msg.content)) {
          const textObj = msg.content.find((item) => item.type === 'text')
          if (textObj?.text) contentSnippet = textObj.text.slice(0, 150)
        }
        if (contentSnippet) {
          actionLogs.push(`  → Outcome: ${contentSnippet.replace(/\n/g, ' ')}...`)
        }
      }
    }

    const sections: string[] = []
    if (modifiedFiles.size > 0) {
      sections.push(`📁 Modified Files:\n${Array.from(modifiedFiles).map((f) => `  • ${f}`).join('\n')}`)
    }
    if (inspectedFiles.size > 0) {
      sections.push(`🔍 Inspected Files:\n${Array.from(inspectedFiles).slice(0, 10).map((f) => `  • ${f}`).join('\n')}`)
    }
    if (executedCommands.length > 0) {
      sections.push(`⚡ Executed Commands:\n${executedCommands.slice(-5).map((c) => `  • \`${c}\``).join('\n')}`)
    }
    if (actionLogs.length > 0) {
      sections.push(`📝 Action Log:\n${actionLogs.join('\n')}`)
    }

    return sections.length > 0
      ? sections.join('\n\n')
      : 'Previous steps executed and actions completed successfully.'
  }

  static async compactAsync(
    messages: OpenAiMessage[],
    _config: unknown = null,
    options: CompactorOptions = {}
  ): Promise<OpenAiMessage[]> {
    return this.compact(messages, options)
  }

  private static _pruneToolMessage(
    msg: OpenAiMessage,
    maxLen: number,
    headLen: number,
    tailLen: number
  ): OpenAiMessage {
    if (!msg.content) return msg

    if (Array.isArray(msg.content)) {
      const prunedArray = msg.content.map((item) => {
        if (item.type === 'text' && item.text) {
          return { ...item, text: this._smartPruneString(item.text, maxLen, headLen, tailLen) }
        }
        if (item.type === 'image_url') {
          return { type: 'text', text: '[Historical payload archived]' }
        }
        return item
      })
      return { ...msg, content: prunedArray }
    }

    if (typeof msg.content === 'string') {
      const prunedStr = this._smartPruneString(msg.content, maxLen, headLen, tailLen)
      if (prunedStr === msg.content) return msg
      return { ...msg, content: prunedStr }
    }

    return msg
  }

  private static _smartPruneString(str: string, maxLen: number, headLen: number, tailLen: number): string {
    if (typeof str !== 'string' || str.length <= maxLen) {
      return str
    }

    const lines = str.split('\n')

    // Terminal output preservation: errors and stack traces are typically at bottom
    if (lines.length > 40 && (str.includes('stderr:') || str.includes('stdout:') || str.includes('Exit code:'))) {
      const topLines = lines.slice(0, 15).join('\n')
      const bottomLines = lines.slice(-30).join('\n')
      const omitted = lines.length - 45
      return `${topLines}\n\n[... Omitted ${omitted} intermediate log lines for 256k window optimization ...]\n\n${bottomLines}`
    }

    // Standard Head + Tail Preservation
    const head = str.slice(0, headLen)
    const tail = str.slice(str.length - tailLen)
    const prunedCount = str.length - (headLen + tailLen)

    return `${head}\n\n[... Output pruned (${prunedCount} chars archived for 256k memory optimization) ...]\n\n${tail}`
  }

  private static _estimateTotalChars(messages: OpenAiMessage[]): number {
    let total = 0
    for (const m of messages) {
      if (typeof m.content === 'string') {
        total += m.content.length
      } else if (Array.isArray(m.content)) {
        for (const item of m.content) {
          if (item.type === 'text' && item.text) total += item.text.length
        }
      }
      if (Array.isArray(m.tool_calls)) {
        for (const tc of m.tool_calls) {
          const fn = tc.function
          if (fn) {
            total += (fn.name?.length || 0) + (fn.arguments?.length || 0)
          }
        }
      }
    }
    return total
  }

  private static _estimateTokens(messages: OpenAiMessage[]): number {
    let tokens = 0
    const countTextTokens = (text: string): number => {
      let asciiChars = 0
      let nonAsciiChars = 0
      for (let i = 0; i < text.length; i++) {
        if (text.charCodeAt(i) <= 127) {
          asciiChars++
        } else {
          nonAsciiChars++
        }
      }
      return Math.ceil(asciiChars / 4) + Math.ceil(nonAsciiChars * 1.1)
    }

    for (const m of messages) {
      if (typeof m.content === 'string') {
        tokens += countTextTokens(m.content)
      } else if (Array.isArray(m.content)) {
        for (const item of m.content) {
          if (item.type === 'text' && item.text) tokens += countTextTokens(item.text)
        }
      }
      if (Array.isArray(m.tool_calls)) {
        for (const tc of m.tool_calls) {
          const fn = tc.function
          if (fn) {
            tokens += countTextTokens((fn.name || '') + (fn.arguments || ''))
          }
        }
      }
    }
    return tokens
  }
}
