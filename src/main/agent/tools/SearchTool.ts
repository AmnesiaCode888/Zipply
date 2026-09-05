import { ToolBase, ToolParameterDef, ToolResult } from './ToolBase'
import { Blackboard } from '../core/Blackboard'

interface SearchResultItem {
  title: string
  url: string
  snippet: string
}

/**
 * SearchTool — Web search via DuckDuckGo (free, keyless) and Tavily API.
 */
export class SearchTool extends ToolBase {
  get name(): string {
    return 'search_web'
  }

  get description(): string {
    return 'Search the web for current information, documentation, live facts, news, articles, and code references using DuckDuckGo or Tavily.'
  }

  get parameters(): Record<string, ToolParameterDef> {
    return {
      description: {
        type: 'string',
        description: 'Краткое действие (2-4 слова, напр. "Поиск в сети")',
        required: false
      },
      query: {
        type: 'string',
        description: 'Search query string (keywords or question)',
        required: true
      }
    }
  }

  /**
   * Helper to decode HTML entities in text
   */
  private decodeEntities(text: string): string {
    return text
      .replace(/&quot;/gi, '"')
      .replace(/&#39;/gi, "'")
      .replace(/&#x27;/gi, "'")
      .replace(/&amp;/gi, '&')
      .replace(/&lt;/gi, '<')
      .replace(/&gt;/gi, '>')
      .replace(/&mdash;/gi, '—')
      .replace(/&ndash;/gi, '–')
      .replace(/&hellip;/gi, '…')
      .replace(/&nbsp;/gi, ' ')
      .replace(/&#x([0-9a-fA-F]+);/gi, (_, hex) => {
        try {
          return String.fromCharCode(parseInt(hex, 16))
        } catch {
          return ''
        }
      })
      .replace(/&#([0-9]+);/gi, (_, dec) => {
        try {
          return String.fromCharCode(parseInt(dec, 10))
        } catch {
          return ''
        }
      })
      .replace(/\s+/g, ' ')
      .trim()
  }

  /**
   * Cleans text from HTML tags and decodes entities
   */
  private cleanHtml(html: string): string {
    return this.decodeEntities(html.replace(/<[^>]+>/g, ' '))
  }

  /**
   * Search DuckDuckGo using HTML endpoint (Zero API keys, completely free)
   */
  private async searchDuckDuckGo(
    query: string,
    maxResults = 6,
    abortSignal?: AbortSignal
  ): Promise<SearchResultItem[]> {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 15000)

    const onParentAbort = (): void => controller.abort()
    if (abortSignal) {
      if (abortSignal.aborted) controller.abort()
      else abortSignal.addEventListener('abort', onParentAbort, { once: true })
    }

    try {
      const ddgUrl = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`
      const response = await fetch(ddgUrl, {
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'ru-RU,ru;q=0.9,en-US;q=0.8,en;q=0.7'
        },
        signal: controller.signal
      })

      if (!response.ok) {
        throw new Error(`DuckDuckGo returned HTTP ${response.status} ${response.statusText}`)
      }

      const html = await response.text()
      const results: SearchResultItem[] = []

      // Result blocks are separated by class="result results_links...
      const blocks = html.split(/class=["']result results_links/i)
      for (let i = 1; i < blocks.length && results.length < maxResults; i++) {
        const block = blocks[i]

        const titleMatch = block.match(
          /<a[^>]*class=["']result__a["'][^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/i
        )
        const snippetMatch = block.match(
          /<a[^>]*class=["']result__snippet["'][^>]*>([\s\S]*?)<\/a>/i
        )

        if (titleMatch) {
          let resultUrl = titleMatch[1]

          // Extract real URL from DuckDuckGo redirect wrapper (/l/?uddg=...)
          if (resultUrl.includes('uddg=')) {
            try {
              const parsed = new URL(resultUrl, 'https://duckduckgo.com')
              resultUrl = decodeURIComponent(parsed.searchParams.get('uddg') || resultUrl)
            } catch {
              // fallback to original if parsing fails
            }
          }

          const rawTitle = titleMatch[2] || ''
          const rawSnippet = snippetMatch ? snippetMatch[1] : ''

          const title = this.cleanHtml(rawTitle)
          const snippet = this.cleanHtml(rawSnippet)

          if (title && resultUrl) {
            results.push({ title, url: resultUrl, snippet })
          }
        }
      }

      return results
    } finally {
      clearTimeout(timeout)
      if (abortSignal) abortSignal.removeEventListener('abort', onParentAbort)
    }
  }

  /**
   * Search Tavily API
   */
  private async searchTavily(
    query: string,
    tavilyKey: string,
    maxResults = 6,
    abortSignal?: AbortSignal
  ): Promise<{ answer?: string; results: SearchResultItem[] }> {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 15000)

    const onParentAbort = (): void => controller.abort()
    if (abortSignal) {
      if (abortSignal.aborted) controller.abort()
      else abortSignal.addEventListener('abort', onParentAbort, { once: true })
    }

    try {
      const response = await fetch('https://api.tavily.com/search', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${tavilyKey}`
        },
        body: JSON.stringify({
          api_key: tavilyKey,
          query,
          max_results: maxResults,
          include_answer: true,
          include_raw_content: false
        }),
        signal: controller.signal
      })

      if (!response.ok) {
        const text = await response.text()
        throw new Error(`Tavily error ${response.status}: ${text}`)
      }

      const data = (await response.json()) as any
      const results: SearchResultItem[] = (data.results || []).map((r: any) => ({
        title: r.title || 'Untitled',
        url: r.url || '',
        snippet: r.content || ''
      }))

      return {
        answer: data.answer,
        results
      }
    } finally {
      clearTimeout(timeout)
      if (abortSignal) abortSignal.removeEventListener('abort', onParentAbort)
    }
  }

  async execute(
    argumentsJson: string,
    blackboard: Blackboard,
    abortSignal?: AbortSignal
  ): Promise<ToolResult> {
    let args: any
    try {
      args = JSON.parse(argumentsJson || '{}')
    } catch {
      return { formattedContent: 'Error: invalid JSON arguments.' }
    }

    const query = args.query?.trim()
    if (!query) {
      return { formattedContent: 'Error: query parameter is required and cannot be empty.' }
    }

    const searchProvider =
      (blackboard.getArtifact('searchProvider') as string) || 'duckduckgo'
    const tavilyKey =
      (blackboard.getArtifact('tavilyKey') as string) || process.env.TAVILY_API_KEY || ''

    // If provider is Tavily and key is configured, attempt Tavily with DDG fallback
    if (searchProvider === 'tavily' && tavilyKey) {
      try {
        const tavilyRes = await this.searchTavily(query, tavilyKey, 6, abortSignal)
        let out = ''
        if (tavilyRes.answer) out += `Summary: ${tavilyRes.answer}\n\n`
        out += `Search results for "${query}" (via Tavily):\n`
        for (const r of tavilyRes.results) {
          out += `\n### ${r.title}\nURL: ${r.url}\n${r.snippet}\n`
        }

        return {
          formattedContent: out.trim(),
          data: { provider: 'tavily', query, answer: tavilyRes.answer, results: tavilyRes.results }
        }
      } catch (err: unknown) {
        console.warn('[SearchTool] Tavily search failed, falling back to DuckDuckGo:', err)
        // Fallback to DuckDuckGo below
      }
    }

    // Default & Free provider: DuckDuckGo
    try {
      const ddgResults = await this.searchDuckDuckGo(query, 6, abortSignal)

      if (ddgResults.length === 0) {
        return {
          formattedContent: `No search results found for "${query}" on DuckDuckGo. Try refining keywords.`,
          data: { provider: 'duckduckgo', query, results: [] }
        }
      }

      let out = `Search results for "${query}" (via DuckDuckGo):\n`
      for (const r of ddgResults) {
        out += `\n### ${r.title}\nURL: ${r.url}\n${r.snippet}\n`
      }

      return {
        formattedContent: out.trim(),
        data: { provider: 'duckduckgo', query, results: ddgResults }
      }
    } catch (e: unknown) {
      const err = e as Error
      if (err.name === 'AbortError' || abortSignal?.aborted) {
        return { formattedContent: 'Search timed out or was cancelled.' }
      }
      return { formattedContent: `Error searching web: ${err.message}` }
    }
  }
}
