import { ChatService, ChatConfig } from './ChatService'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ToolLogEntry {
  /** Human-readable 2-4 word label supplied by the agent (description arg) */
  summary: string
  /** true = error result */
  error: boolean
  /** first 120 chars of result */
  resultSnippet: string
}

export type WatchdogStatus = 'continue' | 'warn' | 'intervene'

export interface WatchdogResult {
  status: WatchdogStatus
  message: string
}

// ---------------------------------------------------------------------------
// Task-type profiles
// ---------------------------------------------------------------------------

interface WatchdogProfile {
  loopHints: string
  progressHints: string
}

const PROFILES: Record<string, WatchdogProfile> = {
  debugging: {
    loopHints:
      'monitoring/tracing the same process repeatedly, launching background watchers that never capture data, asking user to click buttons multiple times without acting on results, repeating Linux commands that fail on Windows',
    progressHints:
      'found root cause, confirmed hypothesis, applied a fix, verified fix works'
  },
  coding: {
    loopHints:
      'the same build/lint error repeating with same approach, rewriting the same file multiple times, micro-reading the same file repeatedly in small slices without making edits, doubting standard language syntax (e.g. confusing C# with Dart), running tests that keep failing the same way without a new fix attempt',
    progressHints:
      'tests pass, build succeeds, feature implemented, surgical edits applied, refactor complete'
  },
  research: {
    loopHints:
      'searching the same query repeatedly, repeating search when API key is missing, reading the same URLs, finding no new information across 4+ steps',
    progressHints:
      'key fact found, source cited, summary drafted, question answered'
  },
  general: {
    loopHints: 'repeating the same action 3+ times with no new result, micro-reading slices of a single file, or oscillating without approach change',
    progressHints: 'task completed or meaningfully advanced'
  }
}

function detectProfile(userQuery: string): WatchdogProfile {
  const q = userQuery.toLowerCase()
  if (/\b(fix|bug|error|debug|не работает|сломан|crash|ошибка|починить|vpn|сеть|network)\b/.test(q))
    return PROFILES.debugging
  if (/\b(код|code|feature|компонент|component|implement|написать|создать|refactor|build)\b/.test(q))
    return PROFILES.coding
  if (/\b(найди|find|research|изучи|что такое|как работает|документация|статья)\b/.test(q))
    return PROFILES.research
  return PROFILES.general
}

// ---------------------------------------------------------------------------
// Log compression
// ---------------------------------------------------------------------------

/**
 * Converts raw tool entries into compact one-liners for the watchdog context.
 *
 * Key improvements vs naive version:
 * - Consecutive repeats are counted and annotated with success rate
 *   → all-✅ repeats are tagged "productive loop", not flagged as stuck
 * - Identical result snippets across *different* summaries are flagged
 *   → catches "smart loops" where agent changes action name but does the same thing
 * - Window is shown in full (up to 100 lines) for temporal context
 */
export function compressToolLog(entries: ToolLogEntry[], windowSize = 100): string {
  const slice = entries.slice(-windowSize)
  const lines: string[] = []
  let i = 0
  let displayIdx = 1 // sequential display index for the LLM — doesn't skip after collapse

  while (i < slice.length) {
    const entry = slice[i]

    // Count consecutive entries with the same summary
    let repeatCount = 1
    while (
      i + repeatCount < slice.length &&
      slice[i + repeatCount].summary === entry.summary
    ) {
      repeatCount++
    }

    const icon = entry.error ? '❌' : '✅'

    let repeatNote = ''
    if (repeatCount > 1) {
      const successCount = slice.slice(i, i + repeatCount).filter((e) => !e.error).length
      const allSuccess = successCount === repeatCount
      const allFail = successCount === 0
      const quality = allSuccess ? 'all✅' : allFail ? 'all❌ stuck' : `${successCount}/${repeatCount}✅`
      repeatNote = ` [×${repeatCount} ${quality}]`
    }

    // Detect identical result snippet vs previous entry (different summary but same outcome)
    const prevSnippet = i > 0 ? slice[i - 1].resultSnippet : ''
    const sameResultAsPrev =
      entry.resultSnippet.length > 20 && entry.resultSnippet === prevSnippet
    const sameResultNote = sameResultAsPrev && repeatCount === 1 ? ' [same result as previous action]' : ''

    const snippet = entry.resultSnippet.replace(/\n/g, ' ').slice(0, 120)
    lines.push(`[${displayIdx}] ${entry.summary} → ${snippet} ${icon}${repeatNote}${sameResultNote}`)
    i += repeatCount
    displayIdx++ // one line per compressed group, not per raw entry
  }

  return lines.join('\n')
}

// ---------------------------------------------------------------------------
// Watchdog LLM call
// ---------------------------------------------------------------------------

const SYSTEM_PROMPT = `You are a Watchdog AI that reviews an agent's compressed action log to detect if it is stuck in a loop, hesitating/oscillating, or making genuine progress.

Output EXACTLY one of these three responses (no extra text, no markdown):
  CONTINUE
  WARN: <one concise sentence in the same language as the user query, max 20 words>
  INTERVENE: <one concise directive in the same language as the user query, max 25 words>

Evaluation rules:
- CONTINUE: agent is making progress, or it is too early to tell (fewer than 10 total actions)
- WARN: suspicious pattern emerging (e.g. repeated micro-reads of same file, 2-3 repeated errors, or missing key error) — suggest a better approach
- INTERVENE: agent is clearly looping, oscillating between rewrites, or repeating failed actions — give a concrete directive to change approach

When to say WARN:
- Same action appears 3+ times and is tagged "[×N all❌ stuck]"
- 3+ micro-reads of the same file in small slices without applying edits
- Repeating search_web when API key is missing
- 4+ entries tagged "[same result as previous action]" across different summaries

When to say INTERVENE:
- 4+ consecutive identical failing actions
- Agent repeatedly rewriting or reading the same file back and forth without progressing
- 7+ steps with no ✅ results or no progress toward the user goal
- Pattern of passive data-collection (monitoring, tracing, repeated reads) repeating 4+ times without direct action`

const WATCHDOG_TIMEOUT_MS = 8_000

export class WatchdogService {
  /**
   * Instant deterministic heuristic check that catches obvious loops and repetitive failures
   * with 0ms latency without waiting for LLM response.
   */
  static fastDeterministicCheck(entries: ToolLogEntry[]): WatchdogResult {
    if (!entries || entries.length < 2) return { status: 'continue', message: '' }

    const last = entries[entries.length - 1]
    const prev = entries[entries.length - 2]

    // Rule 1: Two consecutive identical failures
    if (last.error && prev.error && last.summary === prev.summary && last.resultSnippet === prev.resultSnippet) {
      return {
        status: 'intervene',
        message: `Действие "${last.summary}" дважды завершилось идентичной ошибкой. Немедленно смени подход или стратегию решения.`
      }
    }

    // Rule 2: Three consecutive failures in a row
    if (entries.length >= 3) {
      const last3 = entries.slice(-3)
      if (last3.every((e) => e.error)) {
        return {
          status: 'warn',
          message: 'Последние 3 вызова инструментов завершились ошибками. Проанализируй причину и проверь аргументы перед следующим действием.'
        }
      }
    }

    // Rule 3: 4+ repetitive identical results across actions
    if (entries.length >= 4) {
      const last4 = entries.slice(-4)
      const firstSnippet = last4[0].resultSnippet
      if (firstSnippet.length > 20 && last4.every((e) => e.resultSnippet === firstSnippet)) {
        return {
          status: 'intervene',
          message: 'Ты получаешь одинаковый результат уже 4 шага подряд. Пересмотри логику и выбери другой инструмент.'
        }
      }
    }

    // Rule 4: Micro-reading the same file repeatedly (4+ consecutive reads)
    if (entries.length >= 4) {
      const last4 = entries.slice(-4)
      const isReadSummary = (s: string): boolean => /чтение|read|file.*read|view/i.test(s)
      if (last4.every((e) => isReadSummary(e.summary) && !e.error)) {
        return {
          status: 'warn',
          message: 'Ты читаешь файлы уже 4 шага подряд без внесения изменений. Переходи к редактированию или проверке гипотезы.'
        }
      }
    }

    return { status: 'continue', message: '' }
  }

  /**
   * Analyse the last N tool calls and return a watchdog verdict.
   * Runs fast deterministic check first; if inconclusive, consults the cheap LLM prompt.
   * Hard-capped at 8 seconds — returns deterministic fallback on timeout.
   */
  static async analyse(
    entries: ToolLogEntry[],
    userQuery: string,
    config: ChatConfig,
    abortSignal?: AbortSignal
  ): Promise<WatchdogResult> {
    if (entries.length === 0) return { status: 'continue', message: '' }

    // Run 0ms deterministic check first
    const fastResult = this.fastDeterministicCheck(entries)
    if (fastResult.status === 'intervene') {
      return fastResult
    }

    const profile = detectProfile(userQuery)
    const compressedLog = compressToolLog(entries, 100)

    const userContent = `User's task: "${userQuery.slice(0, 200)}"

Typical loop patterns for this task type: ${profile.loopHints}
Signs of real progress: ${profile.progressHints}

Compressed action log (${entries.length} total tool calls, showing last ${Math.min(entries.length, 100)}):
${compressedLog}`

    try {
      const response = await ChatService.chat(
        {
          ...config,
          maxTokens: 80,
          stream: false,
          temperature: 0.2
        },
        [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: userContent }
        ],
        undefined,
        undefined,
        undefined,
        abortSignal
      )
      const parsed = WatchdogService._parseResponse((response.content || '').trim())
      if (parsed.status !== 'continue') {
        return parsed
      }
      return fastResult.status !== 'continue' ? fastResult : parsed
    } catch {
      // Timeout (abort) or API error — safely fall back to fast deterministic check
      return fastResult
    }
  }

  private static _parseResponse(raw: string): WatchdogResult {
    const cleaned = (raw || '').trim().replace(/^[*#`\s]+/, '')
    if (/^INTERVENE\s*:/i.test(cleaned)) {
      return { status: 'intervene', message: cleaned.replace(/^INTERVENE\s*:\s*/i, '').replace(/[*#`]+$/, '').trim() }
    }
    if (/^WARN\s*:/i.test(cleaned)) {
      return { status: 'warn', message: cleaned.replace(/^WARN\s*:\s*/i, '').replace(/[*#`]+$/, '').trim() }
    }
    return { status: 'continue', message: '' }
  }
}
