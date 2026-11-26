import * as dns from 'dns/promises'
import * as net from 'net'
import { ToolBase, ToolParameterDef, ToolResult } from './ToolBase'
import { Blackboard } from '../core/Blackboard'
import { readResponseText } from './responseUtils'

function isPrivateOrBlockedIp(ip: string): boolean {
  const clean = ip.replace(/^\[|\]$/g, '').toLowerCase()
  if (clean.startsWith('::ffff:')) {
    return isPrivateOrBlockedIp(clean.slice('::ffff:'.length))
  }
  const v4 = net.isIPv4(clean)
  if (v4) {
    const parts = clean.split('.').map(Number)
    const [a, b] = parts
    if (a === 0 || a === 10 || a === 127) return true
    if (a === 169 && b === 254) return true // link-local / cloud metadata
    if (a === 172 && b >= 16 && b <= 31) return true
    if (a === 192 && b === 168) return true
    if (a === 100 && b >= 64 && b <= 127) return true // CGNAT
    return false
  }
  if (net.isIPv6(clean)) {
    if (clean === '::' || clean === '::1') return true
    if (/^(fc|fd)/i.test(clean)) return true // ULA fc00::/7
    if (/^fe[89ab]/i.test(clean)) return true // link-local fe80::/10
    return false
  }
  return false
}

async function assertPublicUrl(rawUrl: string): Promise<string | null> {
  let parsed: URL
  try { parsed = new URL(rawUrl) } catch { return 'Некорректный URL.' }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return 'Допустимы только протоколы http:// и https://.'
  }
  const host = parsed.hostname.replace(/^\[|\]$/g, '').toLowerCase()
  if (!host) return 'Не указан хост URL.'
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal')) {
    return `Доступ к локальному адресу запрещён: ${host}`
  }
  if (net.isIP(host)) {
    if (isPrivateOrBlockedIp(host)) {
      return `Доступ к приватному или локальному IP-адресу запрещён: ${host}`
    }
    return null
  }
  try {
    const records = await dns.lookup(host, { all: true })
    if (records.some((r) => isPrivateOrBlockedIp(r.address))) {
      return `Домен ${host} указывает на приватный или локальный IP-адрес; запрос запрещён.`
    }
  } catch {
    // Let fetch report DNS failure cleanly if offline or mocked in tests
  }
  return null
}

function extractMainHtml(html: string): string {
  const cleaned = html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<svg[\s\S]*?<\/svg>/gi, ' ')
    .replace(/<nav[\s\S]*?<\/nav>/gi, ' ')
    .replace(/<footer[\s\S]*?<\/footer>/gi, ' ')

  for (const tag of ['main', 'article']) {
    const openMatch = new RegExp(`<${tag}\\b[^>]*>`, 'i').exec(cleaned)
    if (!openMatch || openMatch.index === undefined) continue
    const contentStart = openMatch.index + openMatch[0].length
    const tagRe = new RegExp(`<(\\/?)${tag}\\b[^>]*>`, 'gi')
    tagRe.lastIndex = contentStart
    let depth = 1
    let m: RegExpExecArray | null
    while ((m = tagRe.exec(cleaned)) !== null) {
      if (m[1] === '/') depth--
      else depth++
      if (depth === 0) {
        return cleaned.slice(contentStart, m.index)
      }
    }
  }
  return cleaned
}

/**
 * WebTool — Fetch and read web page content.
 */
export class WebTool extends ToolBase {
  get name(): string {
    return 'read_page'
  }

  get description(): string {
    return 'Читает HTTP/HTTPS страницу, преобразует основной текст в Markdown и показывает исходный и конечный URL.'
  }

  get parameters(): Record<string, ToolParameterDef> {
    return {
      url: {
        type: 'string',
        description: 'Полный URL страницы с протоколом HTTP или HTTPS.',
        required: true,
        minLength: 8
      },
      offset_chars: {
        type: 'integer',
        description: 'Смещение в символах от начала текста страницы для пагинации; по умолчанию 0.',
        minimum: 0,
        default: 0
      },
      max_chars: {
        type: 'integer',
        description: 'Максимум символов результата; по умолчанию 25000.',
        minimum: 1000,
        maximum: 25000,
        default: 25000
      }
    }
  }

  validate(argumentsJson: string): string | null {
    try {
      const args = JSON.parse(argumentsJson || '{}')
      const url = args.url?.trim()
      if (!url) return 'Ошибка: параметр url обязателен.'
      let parsed: URL
      try { parsed = new URL(url) } catch { return 'Ошибка: укажите корректный полный URL.' }
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        return 'Ошибка: URL должен начинаться с http:// или https://'
      }
      if (args.offset_chars !== undefined && (!Number.isInteger(args.offset_chars) || args.offset_chars < 0)) {
        return 'Ошибка: offset_chars должен быть неотрицательным целым числом.'
      }
    } catch {
      return 'Ошибка: некорректный JSON аргументов.'
    }
    return null
  }

  async execute(argumentsJson: string, _blackboard: Blackboard, abortSignal?: AbortSignal): Promise<ToolResult> {
    let args: any
    try {
      args = JSON.parse(argumentsJson || '{}')
    } catch {
      return { formattedContent: 'Ошибка: некорректный JSON аргументов.', error: true }
    }

    const url = args.url?.trim()
    const ssrfError = await assertPublicUrl(url)
    if (ssrfError) {
      return { formattedContent: ssrfError, error: true }
    }

    const requestedMax = args.max_chars === undefined ? 25000 : Number(args.max_chars)
    const maxChars = Math.max(1000, Math.min(25000, Number.isFinite(requestedMax) ? Math.floor(requestedMax) : 25000))
    const requestedOffset = args.offset_chars === undefined ? 0 : Number(args.offset_chars)
    const offsetChars = Math.max(0, Number.isFinite(requestedOffset) ? Math.floor(requestedOffset) : 0)

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
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
          Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
        },
        signal: controller.signal
      })

      if (!response.ok) {
        return { formattedContent: `HTTP ${response.status} ${response.statusText} — ${url}`, error: true }
      }

      const finalUrl = response.url || url
      let finalProtocol: string
      try { finalProtocol = new URL(finalUrl).protocol } catch { return { formattedContent: `Некорректный конечный URL: ${finalUrl}`, error: true } }
      if (finalProtocol !== 'http:' && finalProtocol !== 'https:') return { formattedContent: `Недопустимый конечный URL: ${finalUrl}`, error: true }
      const finalSsrf = await assertPublicUrl(finalUrl)
      if (finalSsrf) return { formattedContent: `Недопустимый конечный URL (${finalUrl}): ${finalSsrf}`, error: true }

      const contentType = (response.headers.get('content-type') || '').split(';')[0].trim().toLowerCase()
      if (contentType && !['text/html', 'application/xhtml+xml', 'text/plain'].includes(contentType)) {
        return { formattedContent: `Неподдерживаемый тип страницы: ${contentType}. Содержимое не прочитано. URL: ${finalUrl}`, error: true }
      }

      const html = await readResponseText(response)
      if (html.startsWith('%PDF-')) return { formattedContent: `Неподдерживаемый тип страницы: PDF. Содержимое не прочитано. URL: ${finalUrl}`, error: true }
      const title = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1].replace(/<[^>]+>/g, '').trim() || ''
      const main = extractMainHtml(html)

      // Convert HTML to clean structured Markdown/Text
      const text = main
        .replace(/<h1[^>]*>([\s\S]*?)<\/h1>/gi, '\n# $1\n')
        .replace(/<h2[^>]*>([\s\S]*?)<\/h2>/gi, '\n## $1\n')
        .replace(/<h3[^>]*>([\s\S]*?)<\/h3>/gi, '\n### $1\n')
        .replace(/<h[4-6][^>]*>([\s\S]*?)<\/h[4-6]>/gi, '\n#### $1\n')
        .replace(/<pre[^>]*><code[^>]*>([\s\S]*?)<\/code><\/pre>/gi, '\n```\n$1\n```\n')
        .replace(/<code[^>]*>([\s\S]*?)<\/code>/gi, '`$1`')
        .replace(/<a\s+[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi, (_, href, linkText) => {
          const cleanLink = linkText.replace(/<[^>]+>/g, '').trim()
          if (!cleanLink) return ''
          let absolute = href
          try { absolute = new URL(href, finalUrl).href } catch { /* Preserve malformed links as text. */ }
          return ` [${cleanLink}](${absolute}) `
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

      if (!text) return { formattedContent: `Страница не содержит доступного текста: ${finalUrl}`, error: true }
      const sliced = text.slice(offsetChars)
      const truncated = sliced.length > maxChars
      const content =
        truncated ? sliced.slice(0, maxChars) + `\n\n[...содержимое усечено до ${maxChars} символов]` : sliced

      return {
        formattedContent: `Прочитанная страница: ${title || finalUrl}\nИсходный URL: ${url}\nКонечный URL: ${finalUrl}\nСтатус: HTTP ${response.status}\nУсечено: ${truncated ? 'да' : 'нет'}\n\n${content}`,
        data: { url, finalUrl, title, status: response.status, truncated, length: text.length, offset_chars: offsetChars, content }
      }
    } catch (e: unknown) {
      const err = e as Error
      if (err.name === 'AbortError' || abortSignal?.aborted) {
        return { formattedContent: 'Загрузка страницы была отменена или превышен таймаут.', error: true }
      }
      return { formattedContent: `Ошибка сети при чтении ${url}: ${err.message}`, error: true }
    } finally {
      clearTimeout(timeout)
      if (abortSignal) abortSignal.removeEventListener('abort', onParentAbort)
    }
  }
}
