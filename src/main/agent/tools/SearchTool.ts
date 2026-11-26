import { ToolBase, ToolParameterDef, ToolResult } from './ToolBase'
import { Blackboard } from '../core/Blackboard'
import { readResponseText } from './responseUtils'

interface SearchResultItem {
  title: string
  url: string
  snippet: string
}

/**
 * SearchTool — Searches via Zipply Backend (`POST /api/code/tools/search`) when authenticated,
 * with Bing RSS and DuckDuckGo fallbacks.
 */
export class SearchTool extends ToolBase {
  get name(): string {
    return 'search_web'
  }

  get description(): string {
    return 'Ищет актуальную информацию в интернете и возвращает сниппеты со ссылками. Страницы не читает; для полного текста вызови read_page.'
  }

  get parameters(): Record<string, ToolParameterDef> {
    return {
      query: {
        type: 'string',
        description: 'Непустой точный поисковый запрос.',
        required: true,
        minLength: 1
      },
      max_results: {
        type: 'integer',
        description: 'Количество результатов; по умолчанию 6.',
        minimum: 1,
        maximum: 6,
        default: 6
      }
    }
  }

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

  private cleanHtml(html: string): string {
    return this.decodeEntities(html.replace(/<[^>]+>/g, ' '))
  }

  private async searchDuckDuckGo(
    query: string,
    maxResults = 6,
    abortSignal?: AbortSignal
  ): Promise<SearchResultItem[]> {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(new Error('DuckDuckGo search timeout')), 15000)

    const onParentAbort = (): void => {
      controller.abort(abortSignal?.reason || new Error('Aborted by user'))
    }
    if (abortSignal) {
      if (abortSignal.aborted) {
        controller.abort(abortSignal.reason || new Error('Aborted by user'))
      } else {
        abortSignal.addEventListener('abort', onParentAbort, { once: true })
      }
    }

    try {
      const ddgUrl = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`
      const response = await fetch(ddgUrl, {
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
          Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'ru-RU,ru;q=0.9,en-US;q=0.8,en;q=0.7'
        },
        signal: controller.signal
      })

      if (!response.ok) {
        throw new Error(`DuckDuckGo returned HTTP ${response.status} ${response.statusText}`)
      }

      const html = await readResponseText(response)
      const results: SearchResultItem[] = []

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

          if (resultUrl.includes('uddg=')) {
            try {
              const parsed = new URL(resultUrl, 'https://duckduckgo.com')
              resultUrl = decodeURIComponent(parsed.searchParams.get('uddg') || resultUrl)
            } catch {
              // fallback
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

  private async searchZipplyApi(
    query: string,
    authFetch: (pathOrUrl: string, init?: RequestInit) => Promise<Response>,
    maxResults = 6,
    abortSignal?: AbortSignal
  ): Promise<{ snippets?: string; results: SearchResultItem[]; rateLimitedMessage?: string }> {
    const controller = new AbortController()
    const timeout = setTimeout(() => {
      controller.abort(new Error('Zipply search timeout (25s)'))
    }, 25000)

    const onParentAbort = (): void => {
      controller.abort(abortSignal?.reason || new Error('Aborted by user'))
    }
    if (abortSignal) {
      if (abortSignal.aborted) {
        controller.abort(abortSignal.reason || new Error('Aborted by user'))
      } else {
        abortSignal.addEventListener('abort', onParentAbort, { once: true })
      }
    }

    try {
      const response = await authFetch('/api/code/tools/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query }),
        signal: controller.signal
      })

      if (response.status === 429) {
        const errBody = (await response.json().catch(() => ({}))) as { message?: string }
        return {
          results: [],
          rateLimitedMessage: errBody?.message || 'Лимит веб-поиска исчерпан.'
        }
      }

      if (!response.ok) {
        const text = await readResponseText(response)
        throw new Error(`Zipply search error ${response.status}: ${text}`)
      }

      const data = JSON.parse(await readResponseText(response)) as {
        query?: string
        sources?: Array<{ title?: string; url?: string; domain?: string }>
        snippets?: string
      }

      const results: SearchResultItem[] = (Array.isArray(data.sources) ? data.sources : [])
        .slice(0, maxResults)
        .map(source => ({
          title: source.title || source.domain || 'Источник',
          url: source.url || '',
          snippet: source.domain ? `Источник: ${source.domain}` : ''
        }))

      return {
        snippets: typeof data.snippets === 'string' ? data.snippets : '',
        results
      }
    } finally {
      clearTimeout(timeout)
      if (abortSignal) abortSignal.removeEventListener('abort', onParentAbort)
    }
  }

  /**
   * Search Bing RSS endpoint (Completely free, zero keys, highly reliable)
   */
  private async searchBingRss(
    query: string,
    maxResults = 6,
    abortSignal?: AbortSignal
  ): Promise<SearchResultItem[]> {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(new Error('Bing RSS timeout (15s)')), 15000)

    const onParentAbort = (): void => {
      controller.abort(abortSignal?.reason || new Error('Aborted by user'))
    }
    if (abortSignal) {
      if (abortSignal.aborted) {
        controller.abort(abortSignal.reason || new Error('Aborted by user'))
      } else {
        abortSignal.addEventListener('abort', onParentAbort, { once: true })
      }
    }

    try {
      const url = `https://www.bing.com/search?q=${encodeURIComponent(query)}&format=rss`
      const response = await fetch(url, {
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
        },
        signal: controller.signal
      })

      if (!response.ok) {
        throw new Error(`Bing returned HTTP ${response.status}`)
      }

      const xml = await readResponseText(response)
      const results: SearchResultItem[] = []
      const items = xml.split('<item>')

      for (let i = 1; i < items.length && results.length < maxResults; i++) {
        const item = items[i]
        const rawTitle = item.match(/<title>([\s\S]*?)<\/title>/)?.[1] || ''
        const rawLink = item.match(/<link>([\s\S]*?)<\/link>/)?.[1] || ''
        const rawDesc = item.match(/<description>([\s\S]*?)<\/description>/)?.[1] || ''

        const title = this.cleanHtml(rawTitle)
        const url = rawLink.trim()
        const snippet = this.cleanHtml(rawDesc)

        if (title && url) {
          results.push({ title, url, snippet })
        }
      }

      return results
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
    if (abortSignal?.aborted) {
      return { formattedContent: 'Поиск был отменен.', error: true }
    }

    let args: any
    try {
      args = JSON.parse(argumentsJson || '{}')
    } catch {
      return { formattedContent: 'Ошибка: некорректный JSON аргументов.', error: true }
    }

    const query = args.query?.trim()
    if (!query) {
      return { formattedContent: 'Ошибка: параметр query обязателен для поиска.', error: true }
    }

    const requestedResults = args.max_results === undefined ? 6 : Number(args.max_results)
    const maxResults = Math.max(1, Math.min(6, Number.isFinite(requestedResults) ? Math.floor(requestedResults) : 6))

    const authFetch = blackboard.getArtifact('authFetch') as
      | ((pathOrUrl: string, init?: RequestInit) => Promise<Response>)
      | undefined
    const onUsageUpdated = blackboard.getArtifact('onUsageUpdated') as (() => void) | undefined

    if (typeof authFetch === 'function') {
      try {
        const zipplyRes = await this.searchZipplyApi(query, authFetch, maxResults, abortSignal)
        onUsageUpdated?.()

        if (zipplyRes.rateLimitedMessage) {
          return {
            formattedContent: `Поиск недоступен: ${zipplyRes.rateLimitedMessage}`,
            error: true
          }
        }

        const results = zipplyRes.results.slice(0, maxResults)
        let out = ''
        if (zipplyRes.snippets) out += `${zipplyRes.snippets}\n\n`
        out += `Источники по запросу "${query}":\n`
        for (const r of results) {
          out += `\n### ${r.title}\nURL: ${r.url}\n${r.snippet}\n`
        }

        return {
          formattedContent: `Поисковые сниппеты, страницы не прочитаны.\n${out.trim()}`,
          data: { provider: 'zipply', query, snippets: zipplyRes.snippets, results }
        }
      } catch (err: any) {
        if (abortSignal?.aborted) {
          return { formattedContent: 'Поиск был отменен.', error: true }
        }
        console.warn(
          '[SearchTool] Zipply API search failed, falling back to Bing RSS / DuckDuckGo:',
          err?.message || err
        )
      }
    }

    // 1. Primary free provider: Bing RSS
    if (abortSignal?.aborted) {
      return { formattedContent: 'Поиск был отменен.', error: true }
    }
    try {
      const bingResults = await this.searchBingRss(query, maxResults, abortSignal)

      if (bingResults.length > 0) {
        let out = `Результаты поиска по запросу "${query}":\n`
        for (const r of bingResults) {
          out += `\n### ${r.title}\nURL: ${r.url}\n${r.snippet}\n`
        }

        return {
          formattedContent: `Поисковые сниппеты, страницы не прочитаны.\n${out.trim()}`,
          data: { provider: 'bing', query, results: bingResults }
        }
      }
    } catch (err: any) {
      if (abortSignal?.aborted) {
        return { formattedContent: 'Поиск был отменен.', error: true }
      }
      console.warn('[SearchTool] Bing RSS failed, trying DuckDuckGo fallback:', err?.message || err)
    }

    // 2. Fallback provider: DuckDuckGo
    if (abortSignal?.aborted) {
      return { formattedContent: 'Поиск был отменен.', error: true }
    }
    try {
      const ddgResults = await this.searchDuckDuckGo(query, maxResults, abortSignal)

      if (ddgResults.length > 0) {
        let out = `Результаты поиска по запросу "${query}":\n`
        for (const r of ddgResults) {
          out += `\n### ${r.title}\nURL: ${r.url}\n${r.snippet}\n`
        }

        return {
          formattedContent: `Поисковые сниппеты, страницы не прочитаны.\n${out.trim()}`,
          data: { provider: 'duckduckgo', query, results: ddgResults }
        }
      }

      return {
        formattedContent: `Ничего не найдено по запросу "${query}". Попробуйте уточнить ключевые слова.`,
        data: { query, results: [] }
      }
    } catch (e: unknown) {
      const err = e as Error
      if (err.name === 'AbortError' || abortSignal?.aborted) {
        return { formattedContent: 'Поиск был отменен или превышен таймаут.', error: true }
      }
      return { formattedContent: `Ошибка веб-поиска: ${err.message}`, error: true }
    }
  }
}
