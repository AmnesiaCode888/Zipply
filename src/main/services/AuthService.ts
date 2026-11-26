import * as crypto from 'crypto'
import * as http from 'http'
import { EventEmitter } from 'events'
import type { SecretStore } from './SecretStore'
import type { AuthState, UsageHistory, UsageInfo, UserProfile } from '../../shared/auth'

export const OAUTH_WEB_AUTHORIZE_URL = 'https://web.zipply.my/oauth/authorize'
export const OAUTH_API_BASE_URL = 'https://api.zipply.my'
export const OAUTH_CLIENT_ID = 'zipply-code'
export const OAUTH_SCOPES = 'profile:read limits:read code:api'

const SECRET_TOKENS_KEY = 'zipply_oauth_tokens_v1'
const LOGIN_TIMEOUT_MS = 5 * 60 * 1000
const TOKEN_EXPIRY_BUFFER_MS = 60 * 1000
const PROACTIVE_REFRESH_AHEAD_MS = 5 * 60 * 1000
const MAX_TIMER_DELAY_MS = 6 * 60 * 60 * 1000
const DEFAULT_RETRY_DELAYS_MS = [400, 1200]
const PROACTIVE_RETRY_BASE_MS = 30 * 1000
const PROACTIVE_RETRY_MAX_MS = 10 * 60 * 1000

interface StoredTokens {
  accessToken: string
  refreshToken: string
  expiresAt: number
  scope: string
}

export interface AuthServiceDeps {
  secrets: SecretStore
  openExternal: (url: string) => Promise<void>
  fetchFn?: typeof fetch
  retryDelaysMs?: number[]
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function renderCallbackPage(title: string, subtitle: string, isError = false): string {
  return `<!doctype html>
<html lang="ru">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>${escapeHtml(title)} — Zipply</title>
  <style>
    body {
      margin: 0;
      min-height: 100vh;
      display: grid;
      place-items: center;
      background: #0a0a0a;
      color: #f5f5f5;
      font-family: -apple-system, BlinkMacSystemFont, "Inter", "Segoe UI", sans-serif;
    }
    .card {
      max-width: 420px;
      margin: 24px;
      padding: 28px 32px;
      border-radius: 22px;
      background: #161616;
      text-align: center;
    }
    h1 {
      margin: 0 0 10px;
      font-size: 20px;
      font-weight: 600;
      color: ${isError ? '#ff6961' : '#ffffff'};
    }
    p {
      margin: 0;
      font-size: 15px;
      line-height: 22px;
      color: #9a9a9a;
    }
  </style>
</head>
<body>
  <div class="card">
    <h1>${escapeHtml(title)}</h1>
    <p>${escapeHtml(subtitle)}</p>
  </div>
</body>
</html>`
}

export class AuthService extends EventEmitter {
  private tokens: StoredTokens | null = null
  private state: AuthState = {
    status: 'anonymous',
    subscriptionReady: false,
    profile: null,
    avatarDataUrl: null,
    usage: null,
    history: null,
    error: null,
    scope: null
  }
  private refreshPromise: Promise<string | null> | null = null
  private activeLoginCancel: (() => void) | null = null
  private refreshTimer: ReturnType<typeof setTimeout> | null = null
  private proactiveFailureCount = 0
  private disposed = false
  private fetchFn: typeof fetch
  private retryDelaysMs: number[]

  constructor(private readonly deps: AuthServiceDeps) {
    super()
    this.fetchFn = deps.fetchFn || fetch
    this.retryDelaysMs = deps.retryDelaysMs ?? DEFAULT_RETRY_DELAYS_MS
    this.loadStoredTokens()
    if (this.tokens) {
      this.scheduleProactiveRefresh()
    }
  }

  getState(): AuthState {
    return { ...this.state }
  }

  private setState(patch: Partial<AuthState>): AuthState {
    this.state = { ...this.state, ...patch }
    this.emit('stateChanged', this.getState())
    return this.getState()
  }

  private loadStoredTokens(): void {
    try {
      const raw = this.deps.secrets.get(SECRET_TOKENS_KEY)
      if (!raw) return
      const parsed = JSON.parse(raw) as Partial<StoredTokens>
      if (parsed && typeof parsed.accessToken === 'string' && typeof parsed.refreshToken === 'string') {
        this.tokens = {
          accessToken: parsed.accessToken,
          refreshToken: parsed.refreshToken,
          expiresAt: typeof parsed.expiresAt === 'number' ? parsed.expiresAt : 0,
          scope: typeof parsed.scope === 'string' ? parsed.scope : OAUTH_SCOPES
        }
        this.state = {
          ...this.state,
          status: 'authenticated',
          subscriptionReady: false,
          scope: this.tokens.scope
        }
      }
    } catch {
      this.tokens = null
    }
  }

  private saveTokens(tokens: StoredTokens | null): void {
    this.tokens = tokens
    if (tokens) {
      this.proactiveFailureCount = 0
      this.scheduleProactiveRefresh()
    } else {
      this.clearRefreshTimer()
    }
    try {
      this.deps.secrets.set(SECRET_TOKENS_KEY, tokens ? JSON.stringify(tokens) : '')
    } catch (error) {
      console.warn('[AuthService] Failed to persist OAuth tokens:', error)
    }
  }

  private clearRefreshTimer(): void {
    if (this.refreshTimer) {
      clearTimeout(this.refreshTimer)
      this.refreshTimer = null
    }
  }

  private scheduleProactiveRefresh(overrideDelayMs?: number): void {
    this.clearRefreshTimer()
    if (this.disposed || !this.tokens?.refreshToken) return

    let delayMs: number
    if (typeof overrideDelayMs === 'number') {
      delayMs = overrideDelayMs
    } else {
      const targetAt = this.tokens.expiresAt - PROACTIVE_REFRESH_AHEAD_MS
      delayMs = Math.max(1_000, targetAt - Date.now())
    }
    const clampedDelay = Math.min(delayMs, MAX_TIMER_DELAY_MS)

    this.refreshTimer = setTimeout(() => {
      this.refreshTimer = null
      if (this.disposed || !this.tokens) return
      // If we hit the MAX_TIMER_DELAY_MS cap and the token is not yet due, re-arm the timer.
      if (Date.now() < this.tokens.expiresAt - PROACTIVE_REFRESH_AHEAD_MS) {
        this.scheduleProactiveRefresh()
        return
      }
      void this.runProactiveRefresh()
    }, clampedDelay)
    this.refreshTimer.unref?.()
  }

  private async runProactiveRefresh(): Promise<void> {
    if (this.disposed || !this.tokens) return
    const refreshed = await this.refreshAccessToken()
    if (refreshed || !this.tokens || this.disposed) return
    this.proactiveFailureCount += 1
    const backoff = Math.min(
      PROACTIVE_RETRY_BASE_MS * Math.pow(2, this.proactiveFailureCount - 1),
      PROACTIVE_RETRY_MAX_MS
    )
    this.scheduleProactiveRefresh(backoff)
  }

  async ensureFreshSession(): Promise<void> {
    if (this.disposed || !this.tokens) return
    if (Date.now() >= this.tokens.expiresAt - PROACTIVE_REFRESH_AHEAD_MS) {
      await this.runProactiveRefresh()
    } else {
      this.scheduleProactiveRefresh()
    }
  }

  dispose(): void {
    this.disposed = true
    this.clearRefreshTimer()
    this.cancelLogin()
  }

  async initialize(): Promise<AuthState> {
    if (!this.tokens) return this.getState()
    await this.ensureFreshSession()
    await this.refreshProfileAndUsage()
    return this.getState()
  }

  cancelLogin(): AuthState {
    if (this.activeLoginCancel) {
      this.activeLoginCancel()
      this.activeLoginCancel = null
    }
    if (this.state.status === 'authorizing') {
      this.setState({
        status: this.tokens ? 'authenticated' : 'anonymous',
        error: null
      })
    }
    return this.getState()
  }

  async login(): Promise<AuthState> {
    if (this.activeLoginCancel) {
      this.activeLoginCancel()
      this.activeLoginCancel = null
    }

    const codeVerifier = crypto.randomBytes(32).toString('base64url')
    const codeChallenge = crypto.createHash('sha256').update(codeVerifier).digest('base64url')
    const expectedState = crypto.randomUUID()

    this.setState({ status: 'authorizing', error: null })

    let server: http.Server | null = null
    let timeoutId: ReturnType<typeof setTimeout> | null = null

    const cleanup = (): void => {
      if (timeoutId) {
        clearTimeout(timeoutId)
        timeoutId = null
      }
      if (server) {
        try {
          server.close()
        } catch {}
        server = null
      }
      this.activeLoginCancel = null
    }

    let boundRedirectUri = ''

    try {
      const code = await new Promise<string>((resolve, reject) => {
        let settled = false
        const finish = (err: Error | null, authCode?: string): void => {
          if (settled) return
          settled = true
          cleanup()
          if (err) reject(err)
          else if (authCode) resolve(authCode)
          else reject(new Error('Не получен код авторизации'))
        }

        this.activeLoginCancel = () => finish(new Error('Вход отменён'))

        server = http.createServer((req, res) => {
          try {
            const reqUrl = new URL(req.url || '/', 'http://127.0.0.1')
            if (reqUrl.pathname !== '/callback') {
              res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' })
              res.end('Not found')
              return
            }

            const errorParam = reqUrl.searchParams.get('error')
            const errorDesc = reqUrl.searchParams.get('error_description')
            const codeParam = reqUrl.searchParams.get('code')
            const stateParam = reqUrl.searchParams.get('state')

            if (errorParam) {
              const message = errorDesc || `Ошибка авторизации: ${errorParam}`
              res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' })
              res.end(renderCallbackPage('Не удалось войти', message, true))
              finish(new Error(message))
              return
            }

            if (!codeParam || stateParam !== expectedState) {
              res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' })
              res.end(renderCallbackPage('Ошибка проверки', 'Некорректный state или отсутствует код авторизации.', true))
              finish(new Error('Некорректный параметр state при авторизации'))
              return
            }

            res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
            res.end(renderCallbackPage('Вход выполнен', 'Можете закрыть эту вкладку и вернуться в Zipply.'))
            finish(null, codeParam)
          } catch (err) {
            res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' })
            res.end('Internal error')
            finish(err instanceof Error ? err : new Error('Ошибка обработки callback'))
          }
        })

        server.on('error', err => finish(err))
        server.listen(0, '127.0.0.1', () => {
          const address = server?.address()
          if (!address || typeof address === 'string') {
            finish(new Error('Не удалось запустить локальный callback-сервер'))
            return
          }
          boundRedirectUri = `http://127.0.0.1:${address.port}/callback`
          const params = new URLSearchParams({
            client_id: OAUTH_CLIENT_ID,
            redirect_uri: boundRedirectUri,
            scope: OAUTH_SCOPES,
            state: expectedState,
            code_challenge: codeChallenge,
            code_challenge_method: 'S256'
          })
          const authUrl = `${OAUTH_WEB_AUTHORIZE_URL}?${params.toString()}`
          timeoutId = setTimeout(() => finish(new Error('Время ожидания входа истекло')), LOGIN_TIMEOUT_MS)

          void this.deps.openExternal(authUrl).catch(err => {
            finish(err instanceof Error ? err : new Error('Не удалось открыть браузер для входа'))
          })
        })
      })

      await this.exchangeCodeForTokens(code, boundRedirectUri, codeVerifier)
      await this.refreshProfileAndUsage()
      return this.getState()
    } catch (error) {
      cleanup()
      const msg = error instanceof Error ? error.message : 'Ошибка входа'
      return this.setState({
        status: this.tokens ? 'authenticated' : 'anonymous',
        error: msg === 'Вход отменён' ? null : msg
      })
    }
  }

  private async exchangeCodeForTokens(code: string, redirectUri: string, codeVerifier: string): Promise<void> {
    const response = await this.fetchFn(`${OAUTH_API_BASE_URL}/api/oauth/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        grant_type: 'authorization_code',
        client_id: OAUTH_CLIENT_ID,
        code,
        redirect_uri: redirectUri,
        code_verifier: codeVerifier
      })
    })

    const data = (await response.json().catch(() => ({}))) as Record<string, any>
    if (!response.ok || !data.access_token || !data.refresh_token) {
      throw new Error(data.error_description || data.error || `Ошибка обмена кода (${response.status})`)
    }

    const expiresInSec = typeof data.expires_in === 'number' && data.expires_in > 0 ? data.expires_in : 3600
    const nextTokens: StoredTokens = {
      accessToken: String(data.access_token),
      refreshToken: String(data.refresh_token),
      expiresAt: Date.now() + expiresInSec * 1000,
      scope: typeof data.scope === 'string' ? data.scope : OAUTH_SCOPES
    }
    this.saveTokens(nextTokens)
    this.setState({
      status: 'authenticated',
      subscriptionReady: false,
      scope: nextTokens.scope,
      error: null
    })
  }

  async getValidAccessToken(): Promise<string | null> {
    if (!this.tokens) return null
    if (Date.now() < this.tokens.expiresAt - TOKEN_EXPIRY_BUFFER_MS) {
      return this.tokens.accessToken
    }
    return this.refreshAccessToken()
  }

  private isTransientOAuthError(status: number, errorCode: unknown): boolean {
    if (status === 429 || status >= 500) return true
    if (typeof errorCode === 'string') {
      const normalized = errorCode.toLowerCase()
      return normalized === 'temporarily_unavailable' || normalized === 'server_error'
    }
    return false
  }

  async refreshAccessToken(): Promise<string | null> {
    if (!this.tokens?.refreshToken) return null
    if (this.refreshPromise) return this.refreshPromise

    const currentRefresh = this.tokens.refreshToken
    this.refreshPromise = (async () => {
      try {
        const maxAttempts = this.retryDelaysMs.length + 1
        for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
          if (this.tokens?.refreshToken !== currentRefresh) {
            return this.tokens?.accessToken ?? null
          }

          let response: Response
          try {
            response = await this.fetchFn(`${OAUTH_API_BASE_URL}/api/oauth/token`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                grant_type: 'refresh_token',
                client_id: OAUTH_CLIENT_ID,
                refresh_token: currentRefresh
              })
            })
          } catch {
            if (attempt < this.retryDelaysMs.length) {
              await new Promise(resolve => setTimeout(resolve, this.retryDelaysMs[attempt]))
              continue
            }
            return null
          }

          const data = (await response.json().catch(() => ({}))) as Record<string, any>
          if (!response.ok || !data.access_token) {
            if (this.isTransientOAuthError(response.status, data.error)) {
              if (attempt < this.retryDelaysMs.length) {
                await new Promise(resolve => setTimeout(resolve, this.retryDelaysMs[attempt]))
                continue
              }
              return null
            }

            if (response.status === 400 || response.status === 401) {
              if (this.tokens?.refreshToken === currentRefresh) {
                this.saveTokens(null)
                this.setState({
                  status: 'anonymous',
                  subscriptionReady: false,
                  profile: null,
                  avatarDataUrl: null,
                  usage: null,
                  history: null,
                  scope: null,
                  error: 'Сессия истекла. Войдите в аккаунт снова.'
                })
              } else {
                return this.tokens?.accessToken ?? null
              }
            }
            return null
          }

          if (this.tokens?.refreshToken !== currentRefresh) {
            return this.tokens?.accessToken ?? null
          }

          const expiresInSec = typeof data.expires_in === 'number' && data.expires_in > 0 ? data.expires_in : 3600
          const nextRefreshToken = typeof data.refresh_token === 'string' && data.refresh_token
            ? data.refresh_token
            : currentRefresh
          const nextTokens: StoredTokens = {
            accessToken: String(data.access_token),
            refreshToken: nextRefreshToken,
            expiresAt: Date.now() + expiresInSec * 1000,
            scope: typeof data.scope === 'string' ? data.scope : this.tokens?.scope || OAUTH_SCOPES
          }
          this.saveTokens(nextTokens)
          this.setState({
            status: 'authenticated',
            scope: nextTokens.scope,
            error: null
          })
          return nextTokens.accessToken
        }
        return null
      } finally {
        this.refreshPromise = null
      }
    })()

    return this.refreshPromise
  }

  async authorizedFetch(pathOrUrl: string, init: RequestInit = {}): Promise<Response> {
    const url = pathOrUrl.startsWith('http') ? pathOrUrl : `${OAUTH_API_BASE_URL}${pathOrUrl}`
    if (!this.tokens) {
      throw new Error('Требуется вход в аккаунт Zipply')
    }

    const token = await this.getValidAccessToken()
    if (!token) {
      if (!this.tokens) {
        throw new Error('Сессия истекла. Войдите в аккаунт снова.')
      }
      throw new Error('Не удалось обновить сессию. Проверьте подключение к интернету.')
    }

    const send = (bearer: string): Promise<Response> => {
      const headers = new Headers(init.headers)
      headers.set('Authorization', `Bearer ${bearer}`)
      return this.fetchFn(url, { ...init, headers })
    }

    let response = await send(token)
    if (response.status === 401) {
      const latestToken = this.tokens?.accessToken
      if (latestToken && latestToken !== token) {
        response = await send(latestToken)
        if (response.status !== 401) return response
      }
      const refreshed = await this.refreshAccessToken()
      if (refreshed) {
        response = await send(refreshed)
      }
    }
    return response
  }

  async refreshProfileAndUsage(): Promise<AuthState> {
    if (!this.tokens) return this.getState()

    try {
      const timeZoneId = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
      const historyPath = `/api/auth/me/limits/history?days=365&timeZoneId=${encodeURIComponent(timeZoneId)}`

      const [meRes, avatarRes, limitsRes, historyRes] = await Promise.all([
        this.authorizedFetch('/api/auth/me'),
        this.authorizedFetch('/api/auth/me/avatar').catch(() => null),
        this.authorizedFetch('/api/auth/me/limits').catch(() => null),
        this.authorizedFetch(historyPath).catch(() => null)
      ])

      let usageRes = limitsRes
      if (usageRes && usageRes.status === 404) {
        usageRes = await this.authorizedFetch('/api/usage').catch(() => null)
      }

      let profile: UserProfile | null = this.state.profile
      if (meRes.ok) {
        profile = (await meRes.json().catch(() => null)) as UserProfile | null
      } else if (meRes.status === 401) {
        return this.setState({ subscriptionReady: true })
      }

      let avatarDataUrl: string | null = this.state.avatarDataUrl
      if (avatarRes) {
        if (avatarRes.ok) {
          const buf = Buffer.from(await avatarRes.arrayBuffer())
          const contentType = avatarRes.headers.get('content-type') || 'image/png'
          avatarDataUrl = `data:${contentType};base64,${buf.toString('base64')}`
        } else if (avatarRes.status === 404) {
          avatarDataUrl = null
        }
      }

      let usage: UsageInfo | null = this.state.usage
      if (usageRes && usageRes.ok) {
        usage = (await usageRes.json().catch(() => null)) as UsageInfo | null
      }

      let history: UsageHistory | null = this.state.history
      if (historyRes && historyRes.ok) {
        history = (await historyRes.json().catch(() => null)) as UsageHistory | null
      }

      return this.setState({
        status: this.tokens ? 'authenticated' : 'anonymous',
        subscriptionReady: true,
        profile,
        avatarDataUrl,
        usage,
        history,
        error: null
      })
    } catch (error) {
      return this.setState({
        subscriptionReady: true,
        error: error instanceof Error ? error.message : 'Не удалось загрузить профиль'
      })
    }
  }

  async logout(): Promise<AuthState> {
    const tokenToRevoke = this.tokens?.refreshToken || this.tokens?.accessToken
    if (tokenToRevoke) {
      try {
        await this.fetchFn(`${OAUTH_API_BASE_URL}/api/oauth/revoke`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token: tokenToRevoke })
        })
      } catch {
        // Ignore network errors during revoke so local sign-out always succeeds.
      }
    }

    this.saveTokens(null)
    return this.setState({
      status: 'anonymous',
      subscriptionReady: false,
      profile: null,
      avatarDataUrl: null,
      usage: null,
      history: null,
      error: null,
      scope: null
    })
  }
}
