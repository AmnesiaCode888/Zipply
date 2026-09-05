/**
 * AutoExtractService — Automatic User Fact Extraction after each session.
 *
 * After a conversation ends, this service sends the dialogue to the LLM
 * with a specialized prompt asking it to extract valuable long-term facts:
 * - User's name, role, preferences
 * - Project tech stack, architecture decisions
 * - Explicit user rules ("always use TypeScript", "no Docker")
 * - Workflow preferences
 *
 * Extracted facts are deduplicated and saved to MemoryService.
 * Also generates a session summary for SessionSummaryService.
 *
 * Features:
 * - Max 8 facts per session to prevent memory spam
 * - Strict JSON schema output for reliable parsing
 * - Runs async (non-blocking) after conversation done
 * - Completely disabled if enableAutoExtract === false
 */

import { ChatService, ChatConfig } from './ChatService'
import { MemoryService } from './MemoryService'
import { SessionSummaryService } from './SessionSummaryService'
import { LinguisticPersonaService } from './LinguisticPersonaService'

export interface ExtractedFact {
  content: string
  category: 'user_preference' | 'project_fact' | 'procedural_workflow' | 'fact'
  subject?: string   // Specific entity/topic (e.g. "package_manager", "database", "user_name")
  importance: number  // 1-5
  tags: string[]
}

export interface ExtractionResult {
  facts: ExtractedFact[]
  sessionSummary: string
  sessionKeywords: string[]
  savedCount: number
}

export class AutoExtractService {
  /**
   * Extract facts from a completed conversation and save them.
   * Returns extraction result (or null if disabled/failed).
   * Non-blocking — call without await if needed.
   */
  static async extractAndSave(
    chatId: string,
    chatTitle: string,
    conversationHistory: Array<{ role: 'user' | 'assistant'; content: string }>,
    config: ChatConfig
  ): Promise<ExtractionResult | null> {
    // Respect user preference
    if (config.enableAutoExtract === false) return null

    // Only extract if there's meaningful content (at least 1 user message)
    const userMessages = conversationHistory.filter((m) => m.role === 'user')
    if (userMessages.length < 1) return null

    // Smart Skip: If the last user message was a trivial command or short acknowledgment ("ок", "да", "готово"),
    // skip running an expensive background extraction call for this turn!
    const lastUserMsg = userMessages[userMessages.length - 1]?.content?.trim() || ''
    if (
      lastUserMsg.length < 15 &&
      /^(да|нет|ок|хорошо|ясно|понятно|сделай|удали|запусти|покажи|продолжай|дальше|стоп|ready|done|ok|yes|no|next)\b/i.test(
        lastUserMsg
      )
    ) {
      return null
    }

    // Build condensed dialogue for extraction (limit size)
    const condensedHistory = conversationHistory
      .slice(-20)   // Last 20 messages max
      .map((m) => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content.slice(0, 500)}`)
      .join('\n')

    const extractionPrompt = `Analyze this conversation and extract:
1. Long-term valuable facts about the user, their preferences, and their project
2. A brief session summary

Return ONLY valid JSON in this exact format:
{
  "facts": [
    {
      "content": "fact text in Russian here",
      "category": "user_preference|project_fact|procedural_workflow|fact",
      "subject": "short_entity_key (e.g. package_manager, node_version, database, test_runner, user_name)",
      "importance": 1-5,
      "tags": ["tag1", "tag2"]
    }
  ],
  "sessionSummary": "2-4 sentence summary in Russian of what was accomplished in this session",
  "sessionKeywords": ["keyword1", "keyword2", "keyword3"]
}

Rules for facts:
- LANGUAGE REQUIREMENT: All extracted facts, session summary, and keywords MUST be written in RUSSIAN (на русском языке). Never write facts in English if the user/conversation is in Russian.
- subject: A short 1-3 word identifier of the entity or topic (e.g. "package_manager", "database", "user_role") used for automatic deduplication and conflict resolution when preferences change.
- ONLY extract facts with genuine long-term value (will still matter next week)
- user_preference: user name/role/language/timezone, coding style, framework preferences, explicit rules
- project_fact: project name, tech stack, DB names, ports, env vars, architecture decisions
- procedural_workflow: "always run tests before commit", "use pnpm not npm"
- fact: other lasting useful information
- importance 4-5: explicit user rules, name, core preferences
- importance 2-3: project context, preferences mentioned in passing
- NEVER extract: temporary bug details, code content, search results, obvious facts, intermediate debugging ports/flags, temporary workarounds, or unconfirmed suggestions that the user rejected.
- If the conversation was a failed attempt or ended in an unresolved bug, DO NOT record errors as architectural decisions.
- Maximum 8 facts total
- If no valuable facts found, return empty "facts" array

Conversation to analyze:
${condensedHistory}`

    try {
      const extractConfig: ChatConfig = {
        ...config,
        model: (config.fastModel && config.fastModel.trim()) || config.model, // Use fast background model
        maxTokens: 800,
        temperature: 0.1,
        stream: false
      }

      const messages = [
        {
          role: 'system' as const,
          content: 'You are a fact extraction assistant. Return only valid JSON, no markdown, no explanation.'
        },
        {
          role: 'user' as const,
          content: extractionPrompt
        }
      ]

      const response = await ChatService.chat(extractConfig, messages)
      const rawContent = response.content?.trim() || ''

      // Strip markdown code fences if present
      const jsonStr = rawContent
        .replace(/^```(?:json)?\s*/i, '')
        .replace(/\s*```$/, '')
        .trim()

      let parsed: any
      try {
        parsed = JSON.parse(jsonStr)
      } catch {
        console.warn('[AutoExtractService] Failed to parse extraction JSON:', jsonStr.slice(0, 300))
        return null
      }

      const facts: ExtractedFact[] = Array.isArray(parsed.facts)
        ? parsed.facts.slice(0, 8).filter(
            (f: any) =>
              f?.content &&
              typeof f.content === 'string' &&
              f.content.trim().length > 5
          )
        : []

      const sessionSummary =
        typeof parsed.sessionSummary === 'string' && parsed.sessionSummary.trim()
          ? parsed.sessionSummary.trim()
          : ''

      const sessionKeywords: string[] = Array.isArray(parsed.sessionKeywords)
        ? parsed.sessionKeywords.filter((k: any) => typeof k === 'string')
        : []

      // Project tag for workspace isolation
      const rawWs = config.workspacePath || config.baseDir || ''
      const projectName = rawWs ? rawWs.split(/[\\/]/).filter(Boolean).pop() : ''

      // Save facts to long-term memory with deduplication
      let savedCount = 0
      for (const fact of facts) {
        try {
          const tagsList = Array.isArray(fact.tags) ? [...fact.tags] : []
          if (fact.category === 'project_fact' && projectName && !tagsList.includes(projectName)) {
            tagsList.push(projectName)
          }

          const result = MemoryService.addMemory({
            content: fact.content,
            category: fact.category || 'fact',
            subject: fact.subject,
            importance: typeof fact.importance === 'number'
              ? Math.min(5, Math.max(1, fact.importance))
              : 3,
            tags: tagsList,
            workspacePath: rawWs
          })

          // Only count as saved if it's truly new (not a duplicate)
          if (result.item && !result.duplicate) {
            savedCount++
          }
        } catch (e) {
          console.warn('[AutoExtractService] Error saving fact:', e)
        }
      }

      // Save session summary to medium-term memory
      if (config.enableSessionSummary !== false && sessionSummary) {
        try {
          const messageCount = conversationHistory.length
          SessionSummaryService.saveSummary(
            chatId,
            chatTitle || 'Untitled Session',
            sessionSummary,
            sessionKeywords,
            messageCount
          )
          // Trigger debounced linguistic persona profile update based on latest sessions
          LinguisticPersonaService.scheduleProfileUpdate(config)
        } catch (e) {
          console.warn('[AutoExtractService] Error saving session summary:', e)
        }
      }

      // If new memories were saved, trigger debounced Core Summary update
      if (savedCount > 0) {
        MemoryService.scheduleAutoSummaryUpdate(config)
      }

      console.log(
        `[AutoExtractService] Extracted ${facts.length} facts, saved ${savedCount} new memories, ` +
        `session summary: ${sessionSummary ? 'yes' : 'no'}`
      )

      return { facts, sessionSummary, sessionKeywords, savedCount }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      // Don't log cancellation errors as they're expected
      if (!msg.includes('cancel') && !msg.includes('abort')) {
        console.warn('[AutoExtractService] Extraction failed:', msg)
      }
      return null
    }
  }
}
