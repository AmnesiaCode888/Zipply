import { Blackboard } from '../../core/Blackboard'
import { ToolBase, type ToolResult, type ToolExecutionPolicy } from '../../tools/ToolBase'

const MAX_REDIRECTS = 5
const REQUEST_TIMEOUT_MS = 12_000

type CookieSummary = { name: string; secure: boolean; httpOnly: boolean; sameSite: string | null }
type RedirectSummary = { status: number; destination: string; followed: boolean }

function safeUrl(value: URL): string {
  return `${value.origin}${value.pathname}`
}

function parseCookies(headers: Headers): CookieSummary[] {
  const withSetCookie = headers as Headers & { getSetCookie?: () => string[] }
  const raw = withSetCookie.getSetCookie?.() ?? (headers.get('set-cookie') ? [headers.get('set-cookie')!] : [])
  return raw.slice(0, 20).flatMap(cookie => {
    const parts = cookie.split(';')
    const separator = parts[0].indexOf('=')
    if (separator < 1) return []
    const name = parts[0].slice(0, separator).trim().slice(0, 100)
    if (!/^[!#$%&'*+.^_`|~\w-]+$/.test(name)) return []
    const attributes = new Map(parts.slice(1).map(part => {
      const index = part.indexOf('=')
      return index < 0 ? [part.trim().toLowerCase(), ''] : [part.slice(0, index).trim().toLowerCase(), part.slice(index + 1).trim()]
    }))
    return [{ name, secure: attributes.has('secure'), httpOnly: attributes.has('httponly'), sameSite: attributes.get('samesite')?.slice(0, 20) ?? null }]
  })
}

export class CyberSecHttpPosture extends ToolBase {
  get name(): string { return 'cybersec_check_http_posture' }
  get description(): string { return 'Проверяет HTTP-ответ одного явно указанного URL: ограниченную цепочку перенаправлений и флаги cookies. Выполняет GET без учётных данных, ограничивает ответ и не раскрывает тело или значения cookies. Перед сетью нужно подтверждение.' }
  get parameters() { return { url: { type: 'string', description: 'HTTP(S) URL без параметров, фрагмента и встроенных учётных данных.', required: true } } }
  getExecutionPolicy(): ToolExecutionPolicy { return { mutates: false, parallelSafe: false, cacheable: false } }

  validate(json: string): string | null {
    try {
      const args = JSON.parse(json)
      if (typeof args.url !== 'string' || args.url.length > 2048) return 'Укажите полный URL длиной не более 2048 символов.'
      const url = new URL(args.url)
      if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.hash || url.search) return 'Нужен HTTP(S) URL без учётных данных, параметров и фрагмента.'
      return null
    } catch { return 'Укажите корректный HTTP(S) URL.' }
  }

  async execute(json: string, board: Blackboard, signal?: AbortSignal): Promise<ToolResult> {
    const validation = this.validate(json)
    if (validation) return { error: true, formattedContent: validation }
    const initial = new URL(JSON.parse(json).url as string)
    const config = board.getArtifact('config') as { confirmAction?: (action: { kind: 'network'; command: string; target: string; details: string }) => Promise<boolean> } | undefined
    if (signal?.aborted) return { error: true, formattedContent: 'Проверка отменена.' }
    const approved = await config?.confirmAction?.({ kind: 'network', command: `GET ${safeUrl(initial)}`, target: safeUrl(initial), details: 'Один HTTP GET с проверкой перенаправлений (до 5) только в пределах того же домена. Тело ответа не читается и не показывается; значения cookies скрыты.' })
    if (!approved || signal?.aborted) return { error: true, formattedContent: 'Сетевая проверка не подтверждена или отменена.' }

    const controller = new AbortController()
    const onAbort = () => controller.abort()
    signal?.addEventListener('abort', onAbort, { once: true })
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
    const redirects: RedirectSummary[] = []
    const cookies: CookieSummary[] = []
    let current = initial
    let response: Response | undefined
    try {
      for (;;) {
        if (controller.signal.aborted) throw new Error(signal?.aborted ? 'Проверка отменена.' : 'Истекло время запроса.')
        response = await fetch(current, { method: 'GET', redirect: 'manual', signal: controller.signal, headers: { accept: '*/*' } })
        cookies.push(...parseCookies(response.headers))
        const location = response.headers.get('location')
        const isRedirect = response.status >= 300 && response.status < 400 && Boolean(location)
        if (!isRedirect) break
        let destination: URL
        try { destination = new URL(location!, current) } catch { break }
        if (!['http:', 'https:'].includes(destination.protocol) || destination.username || destination.password) break
        const canFollow = destination.origin === initial.origin && redirects.length < MAX_REDIRECTS
        redirects.push({ status: response.status, destination: safeUrl(destination), followed: canFollow })
        try { await response.body?.cancel() } catch { /* Closing an unread response must not fail the check. */ }
        if (!canFollow) break
        current = destination
      }
      if (controller.signal.aborted) throw new Error(signal?.aborted ? 'Проверка отменена.' : 'Истекло время запроса.')
      const header = (name: string) => response!.headers.get(name)
      const csp = header('content-security-policy')
      const checks = [
        { name: 'Content-Security-Policy', present: Boolean(csp) },
        { name: 'X-Content-Type-Options: nosniff', present: header('x-content-type-options')?.toLowerCase().trim() === 'nosniff' },
        { name: 'Referrer-Policy', present: Boolean(header('referrer-policy')) },
        { name: 'Защита от встраивания', present: Boolean(header('x-frame-options') || /(?:^|;)\s*frame-ancestors\b/i.test(csp || '')) },
        ...(current.protocol === 'https:' ? [{ name: 'Strict-Transport-Security', present: Boolean(header('strict-transport-security')) }] : [])
      ]
      try { await response!.body?.cancel() } catch { /* The body is deliberately discarded. */ }
      const cookieText = cookies.length ? cookies.map(cookie => `${cookie.name}: Secure ${cookie.secure ? 'да' : 'нет'}, HttpOnly ${cookie.httpOnly ? 'да' : 'нет'}, SameSite ${cookie.sameSite ?? 'не задано'}`).join('\n') : 'Cookies не обнаружены.'
      const redirectText = redirects.length ? redirects.map(item => `${item.status} → ${item.destination}${item.followed ? '' : ' (не продолжено)'}`).join('\n') : 'Перенаправлений нет.'
      const blockedCrossOrigin = redirects.some(item => !item.followed && new URL(item.destination).origin !== initial.origin)
      return {
        success: true,
        data: { url: safeUrl(initial), finalUrl: safeUrl(current), status: response!.status, redirects, checks, cookies },
        formattedContent: `GET ${safeUrl(initial)} → HTTP ${response!.status} (${safeUrl(current)}).\nПеренаправления:\n${redirectText}\n\nЗащитные заголовки:\n${checks.map(item => `${item.present ? 'Есть' : 'Не обнаружено'}: ${item.name}`).join('\n')}\n\nФлаги cookies:\n${cookieText}${blockedCrossOrigin ? '\nПереход на другой домен остановлен: требуется отдельное подтверждение.' : ''}\nТело ответа и значения cookies не сохраняются и не выводятся.`
      }
    } catch (error) {
      return { error: true, formattedContent: `HTTP-проверка не выполнена: ${error instanceof Error ? error.message : String(error)}` }
    } finally {
      clearTimeout(timeout)
      signal?.removeEventListener('abort', onAbort)
      if (response?.body) try { await response.body.cancel() } catch { /* Ignore cancellation of an already-closed body. */ }
    }
  }
}
