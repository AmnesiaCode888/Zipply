import { ToolBase, ToolParameterDef, ToolResult } from './ToolBase'
import { Blackboard } from '../core/Blackboard'

/**
 * WebTool — Fetch and read web page content.
 */
export class WebTool extends ToolBase {
  get name(): string {
    return 'read_page'
  }

  get description(): string {
    return 'Fetch and read the full text content of a web page by its URL.'
  }

  get parameters(): Record<string, ToolParameterDef> {
    return {
      description: {
        type: 'string',
        description: 'Краткое действие (2-4 слова, напр. "Чтение документации")',
        required: false
      },
      url: {
        type: 'string',
        description: 'Full HTTP/HTTPS URL of the webpage to fetch and convert to markdown',
        required: true
      }
    }
  }

  validate(argumentsJson: string): string | null {
    try {
      const args = JSON.parse(argumentsJson || '{}')
      const url = args.url?.trim()
      if (!url) return 'Error: url parameter is required.'
      if (!/^https?:\/\//i.test(url)) {
        return 'Error: URL must start with http:// or https://'
      }
    } catch {
      return 'Error: invalid JSON arguments.'
    }
    return null
  }

  async execute(argumentsJson: string, _blackboard: Blackboard, abortSignal?: AbortSignal): Promise<ToolResult> {
    let args: any
    try {
      args = JSON.parse(argumentsJson || '{}')
    } catch {
      return { formattedContent: 'Error: invalid JSON arguments.' }
    }

    const url = args.url?.trim()

    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 20000)

    const onParentAbort = (): void => controller.abort()
    if (abortSignal) {
      if (abortSignal.aborted) controller.abort()
      else abortSignal.addEventListener('abort', onParentAbort, { once: true })
    }

    try {
      const response = await fetch(url, {
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (compatible; zipply/1.0)',
          Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
        },
        signal: controller.signal
      })

      if (!response.ok) {
        return { formattedContent: `HTTP ${response.status} ${response.statusText} — ${url}` }
      }

      const html = await response.text()

      // Convert HTML to clean structured Markdown/Text
      const text = html
        .replace(/<script[\s\S]*?<\/script>/gi, ' ')
        .replace(/<style[\s\S]*?<\/style>/gi, ' ')
        .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
        .replace(/<svg[\s\S]*?<\/svg>/gi, ' ')
        .replace(/<footer[\s\S]*?<\/footer>/gi, ' ')
        .replace(/<h1[^>]*>([\s\S]*?)<\/h1>/gi, '\n# $1\n')
        .replace(/<h2[^>]*>([\s\S]*?)<\/h2>/gi, '\n## $1\n')
        .replace(/<h3[^>]*>([\s\S]*?)<\/h3>/gi, '\n### $1\n')
        .replace(/<h[4-6][^>]*>([\s\S]*?)<\/h[4-6]>/gi, '\n#### $1\n')
        .replace(/<pre[^>]*><code[^>]*>([\s\S]*?)<\/code><\/pre>/gi, '\n```\n$1\n```\n')
        .replace(/<code[^>]*>([\s\S]*?)<\/code>/gi, '`$1`')
        .replace(/<a\s+[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi, (_, href, linkText) => {
          const cleanLink = linkText.replace(/<[^>]+>/g, '').trim()
          if (!cleanLink) return ''
          return ` [${cleanLink}](${href}) `
        })
        .replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, '\n- $1')
        .replace(/<tr[^>]*>([\s\S]*?)<\/tr>/gi, '\n$1')
        .replace(/<td[^>]*>([\s\S]*?)<\/td>/gi, ' | $1')
        .replace(/<th[^>]*>([\s\S]*?)<\/th>/gi, ' | $1')
        .replace(/<p[^>]*>([\s\S]*?)<\/p>/gi, '\n\n$1\n\n')
        .replace(/<br\s*\/?>/gi, '\n')
        .replace(/<[^>]+>/g, ' ')
        .replace(/&nbsp;/gi, ' ')
        .replace(/&amp;/gi, '&')
        .replace(/&lt;/gi, '<')
        .replace(/&gt;/gi, '>')
        .replace(/&quot;/gi, '"')
        .replace(/&#39;/gi, "'")
        .replace(/&mdash;/gi, '—')
        .replace(/&ndash;/gi, '–')
        .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
        .replace(/&#([0-9]+);/gi, (_, dec) => String.fromCharCode(parseInt(dec, 10)))
        .replace(/[ \t]+/g, ' ')
        .replace(/\n\s*\n\s*\n+/g, '\n\n')
        .trim()

      const MAX = 25000
      const content =
        text.length > MAX ? text.slice(0, MAX) + '\n\n[...content truncated to 25000 chars]' : text

      return {
        formattedContent: `Page: ${url}\n\n${content}`,
        data: { url, length: text.length, content }
      }
    } catch (e: unknown) {
      const err = e as Error
      if (err.name === 'AbortError' || abortSignal?.aborted) {
        return { formattedContent: 'Page fetch timed out or was cancelled.' }
      }
      return { formattedContent: `Network error reading ${url}: ${err.message}` }
    } finally {
      clearTimeout(timeout)
      if (abortSignal) abortSignal.removeEventListener('abort', onParentAbort)
    }
  }
}
