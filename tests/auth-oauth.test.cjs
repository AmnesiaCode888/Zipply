const { test } = require('node:test')
const assert = require('node:assert/strict')
const crypto = require('node:crypto')
const { buildSync } = require('esbuild')
const Module = require('node:module')
const path = require('node:path')
const React = require('react')
const { renderToStaticMarkup } = require('react-dom/server')

function load(file) {
  const built = buildSync({ entryPoints: [file], bundle: true, platform: 'node', format: 'cjs', write: false, packages: 'external', loader: { '.svg': 'dataurl', '.png': 'dataurl' } })
  const mod = new Module(path.resolve(file), module)
  mod.filename = path.resolve(file); mod.paths = module.paths
  mod._compile(built.outputFiles[0].text, mod.filename)
  return mod.exports
}

function createMemorySecrets() {
  const store = new Map()
  return {
    get: key => store.get(key) || '',
    set: (key, value) => {
      if (value) store.set(key, value)
      else store.delete(key)
    },
    raw: store
  }
}

test('AuthService performs PKCE S256 login, loads profile/avatar/usage, refreshes once and revokes on logout', async () => {
  const { AuthService } = load('src/main/services/AuthService.ts')
  const secrets = createMemorySecrets()
  const requests = []
  let capturedChallenge = ''

  const fakeFetch = async (url, init = {}) => {
    requests.push({ url: String(url), method: init.method || 'GET', body: init.body, headers: init.headers })
    if (String(url).endsWith('/api/oauth/token')) {
      const payload = JSON.parse(init.body)
      if (payload.grant_type === 'authorization_code') {
        const computed = crypto.createHash('sha256').update(payload.code_verifier).digest('base64url')
        assert.equal(computed, capturedChallenge)
        return new Response(JSON.stringify({
          access_token: 'access-1',
          refresh_token: 'refresh-1',
          expires_in: 3600,
          scope: 'profile:read limits:read code:api'
        }), { status: 200, headers: { 'Content-Type': 'application/json' } })
      }
      if (payload.grant_type === 'refresh_token') {
        assert.equal(payload.refresh_token, 'refresh-1')
        return new Response(JSON.stringify({
          access_token: 'access-2',
          refresh_token: 'refresh-2',
          expires_in: 3600,
          scope: 'profile:read limits:read code:api'
        }), { status: 200, headers: { 'Content-Type': 'application/json' } })
      }
    }
    if (String(url).endsWith('/api/auth/me')) {
      return new Response(JSON.stringify({ displayName: 'Daniel', email: 'd@zipply.my', plan: 'pro' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      })
    }
    if (String(url).endsWith('/api/auth/me/avatar')) {
      return new Response(Buffer.from([1, 2, 3]), {
        status: 200,
        headers: { 'Content-Type': 'image/png' }
      })
    }
    if (String(url).endsWith('/api/auth/me/limits')) {
      return new Response(JSON.stringify({ remainingPercent: 80 }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      })
    }
    if (String(url).endsWith('/api/oauth/revoke')) {
      return new Response(JSON.stringify({ revoked: true }), { status: 200 })
    }
    return new Response('Not found', { status: 404 })
  }

  const auth = new AuthService({
    secrets,
    fetchFn: fakeFetch,
    openExternal: async (authUrl) => {
      const parsed = new URL(authUrl)
      assert.equal(parsed.searchParams.get('client_id'), 'zipply-code')
      assert.equal(parsed.searchParams.get('code_challenge_method'), 'S256')
      capturedChallenge = parsed.searchParams.get('code_challenge')
      const redirectUri = parsed.searchParams.get('redirect_uri')
      const state = parsed.searchParams.get('state')
      const cb = `${redirectUri}?code=test-code-123&state=${encodeURIComponent(state)}`
      await fetch(cb)
    }
  })

  const loggedIn = await auth.login()
  assert.equal(loggedIn.status, 'authenticated')
  assert.equal(loggedIn.profile.displayName, 'Daniel')
  assert.equal(loggedIn.usage.remainingPercent, 80)
  assert.match(loggedIn.avatarDataUrl, /^data:image\/png;base64,/)

  // Parallel refresh calls should execute only one refresh_token request
  const [t1, t2] = await Promise.all([auth.refreshAccessToken(), auth.refreshAccessToken()])
  assert.equal(t1, 'access-2')
  assert.equal(t2, 'access-2')
  const refreshCalls = requests.filter(r => r.url.endsWith('/api/oauth/token') && JSON.parse(r.body).grant_type === 'refresh_token')
  assert.equal(refreshCalls.length, 1)

  const loggedOut = await auth.logout()
  assert.equal(loggedOut.status, 'anonymous')
  assert.equal(loggedOut.profile, null)
  assert.equal(secrets.raw.size, 0)
})

test('SearchTool uses Zipply backend endpoint and handles 429 limits', async () => {
  const { SearchTool } = load('src/main/agent/tools/SearchTool.ts')
  const { Blackboard } = load('src/main/agent/core/Blackboard.ts')
  const tool = new SearchTool()

  const bbOk = new Blackboard()
  let usageUpdated = false
  bbOk.setArtifact('authFetch', async () => new Response(JSON.stringify({
    query: 'zipply',
    sources: [{ title: 'Zipply Docs', url: 'https://zipply.my', domain: 'zipply.my' }],
    snippets: 'Official docs'
  }), { status: 200 }))
  bbOk.setArtifact('onUsageUpdated', () => { usageUpdated = true })

  const resOk = await tool.execute(JSON.stringify({ query: 'zipply' }), bbOk)
  assert.equal(resOk.error, undefined)
  assert.equal(resOk.data.provider, 'zipply')
  assert.equal(usageUpdated, true)
  assert.match(resOk.formattedContent, /Official docs/)

  const bbLimit = new Blackboard()
  bbLimit.setArtifact('authFetch', async () => new Response(JSON.stringify({
    message: 'Лимит поиска исчерпан на сегодня',
    exhaustedWindows: ['daily']
  }), { status: 429 }))

  const resLimit = await tool.execute(JSON.stringify({ query: 'zipply' }), bbLimit)
  assert.equal(resLimit.error, true)
  assert.match(resLimit.formattedContent, /Лимит поиска исчерпан/)
})

test('ChatService sends chat requests to the Zipply backend through authFetch', async () => {
  const { ChatService } = load('src/main/agent/services/ChatService.ts')
  const calls = []
  const originalFetch = global.fetch
  global.fetch = async () => { throw new Error('direct fetch must not be used') }
  try {
    const result = await ChatService.chat(
      {
        model: 'base',
        stream: false,
        authFetch: async (url, init) => {
          calls.push({ url, body: JSON.parse(init.body), headers: init.headers })
          return Response.json({ choices: [{ message: { content: 'привет' } }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } })
        }
      },
      [{ role: 'user', content: 'hi' }]
    )
    assert.equal(result.content, 'привет')
    assert.equal(calls.length, 1)
    assert.equal(calls[0].url, '/api/code/chat/completions')
    assert.equal(calls[0].body.model, 'base')
    assert.equal(calls[0].headers.Authorization, undefined)
  } finally { global.fetch = originalFetch }
})

test('ChatService surfaces backend limit messages on 429', async () => {
  const { ChatService } = load('src/main/agent/services/ChatService.ts')
  await assert.rejects(
    ChatService.chat(
      {
        model: 'base',
        stream: false,
        authFetch: async () => Response.json({ message: 'Лимит запросов исчерпан.' }, { status: 429 })
      },
      [{ role: 'user', content: 'hi' }]
    ),
    /Лимит запросов исчерпан/
  )
})

test('AuthScreen renders sign-in gate, authorizing state and errors', () => {
  const prevWindow = global.window
  global.window = {}
  try {
    const { AuthScreen } = load('src/renderer/src/components/auth/AuthScreen.tsx')
    const anonHtml = renderToStaticMarkup(React.createElement(AuthScreen, {
      auth: { status: 'anonymous', profile: null, avatarDataUrl: null, usage: null, error: 'Ошибка сети', scope: null },
      busy: false,
      onLogin: () => {},
      onCancelLogin: () => {}
    }))
    assert.match(anonHtml, /Добро пожаловать в Zipply/)
    assert.match(anonHtml, /Войти через Zipply/)
    assert.match(anonHtml, /Ошибка сети/)

    const waitingHtml = renderToStaticMarkup(React.createElement(AuthScreen, {
      auth: { status: 'authorizing', profile: null, avatarDataUrl: null, usage: null, error: null, scope: null },
      busy: true,
      onLogin: () => {},
      onCancelLogin: () => {}
    }))
    assert.match(waitingHtml, /Ожидание входа/)
    assert.match(waitingHtml, /Отменить/)
  } finally {
    global.window = prevWindow
  }
})

test('authDisplay extracts telegramProfile name and fiveHours/week limits, TokenActivityCard renders heatmap', () => {
  const { getProfileDisplayName, getProfileSubtitle, getUsageWindows } = load('src/renderer/src/services/authDisplay.ts')
  const profile = {
    id: 'u1',
    telegramProfile: {
      displayName: 'Daniel P',
      username: 'amnesia'
    }
  }
  assert.equal(getProfileDisplayName(profile), 'Daniel P')
  assert.equal(getProfileSubtitle(profile), '@amnesia')

  const windows = getUsageWindows({
    fiveHours: { spent: 0.002, reserved: 0, limit: 0.01 },
    week: { spent: 0.05, reserved: 0, limit: 0.1 }
  })
  assert.equal(windows.length, 2)
  assert.equal(windows[0].remainingPercent, 80)
  assert.equal(windows[1].remainingPercent, 50)

  const { TokenActivityCard } = load('src/renderer/src/components/settings/tabs/TokenActivityCard.tsx')
  const html = renderToStaticMarkup(React.createElement(TokenActivityCard, {
    history: {
      fromDate: '2026-11-01',
      toDate: '2026-11-23',
      timeZoneId: 'Europe/Moscow',
      totalRequests: 42,
      totalUnits: 120,
      activeDays: 5,
      currentStreakDays: 3,
      longestStreakDays: 4,
      days: [
        { date: '2026-11-22', requests: 10, units: 30, level: 2 },
        { date: '2026-11-23', requests: 32, units: 90, level: 4 }
      ]
    }
  }))
  assert.match(html, /Активность токенов/)
  assert.match(html, /По дням/)
  assert.match(html, /По неделям/)
  assert.match(html, /Нарастающим итогом/)
  assert.match(html, /32 запр\./)
})

test('AuthService preserves session on omitted refresh_token, transient errors, and stale-token 401s', async () => {
  const { AuthService } = load('src/main/services/AuthService.ts')
  const secrets = createMemorySecrets()
  secrets.set('zipply_oauth_tokens_v1', JSON.stringify({
    accessToken: 'access-initial',
    refreshToken: 'refresh-initial',
    expiresAt: Date.now() + 3600_000,
    scope: 'profile:read'
  }))

  let refreshAttempt = 0
  let apiCallsWithLatest = 0
  const fakeFetch = async (url, init = {}) => {
    if (String(url).endsWith('/api/oauth/token')) {
      refreshAttempt += 1
      if (refreshAttempt === 1) {
        throw new Error('ECONNRESET')
      }
      if (refreshAttempt === 2) {
        return new Response(JSON.stringify({ error: 'temporarily_unavailable' }), { status: 400 })
      }
      // 3rd attempt succeeds WITHOUT returning a new refresh_token
      return new Response(JSON.stringify({
        access_token: 'access-refreshed',
        expires_in: 3600
      }), { status: 200, headers: { 'Content-Type': 'application/json' } })
    }
    if (String(url).endsWith('/api/test')) {
      const authHeader = new Headers(init.headers).get('Authorization')
      if (authHeader === 'Bearer access-initial') {
        return new Response('Unauthorized', { status: 401 })
      }
      if (authHeader === 'Bearer access-refreshed') {
        apiCallsWithLatest += 1
        return new Response(JSON.stringify({ ok: true }), { status: 200 })
      }
    }
    return new Response('Not found', { status: 404 })
  }

  const auth = new AuthService({
    secrets,
    fetchFn: fakeFetch,
    openExternal: async () => {},
    retryDelaysMs: [1, 1]
  })

  try {
    assert.equal(auth.getState().status, 'authenticated')

    // Two concurrent requests both receive 401 for access-initial; refresh retries transient errors
    // and succeeds once without rotating refresh_token.
    const [r1, r2] = await Promise.all([
      auth.authorizedFetch('/api/test'),
      auth.authorizedFetch('/api/test')
    ])
    assert.equal(r1.status, 200)
    assert.equal(r2.status, 200)
    assert.equal(apiCallsWithLatest, 2)
    assert.equal(refreshAttempt, 3)
    assert.equal(auth.getState().status, 'authenticated')

    const persisted = JSON.parse(secrets.get('zipply_oauth_tokens_v1'))
    assert.equal(persisted.accessToken, 'access-refreshed')
    assert.equal(persisted.refreshToken, 'refresh-initial')

    // Transient failure during proactive refresh must NOT log out the user.
    secrets.set('zipply_oauth_tokens_v1', JSON.stringify({
      accessToken: 'access-refreshed',
      refreshToken: 'refresh-initial',
      expiresAt: Date.now() + 1000,
      scope: 'profile:read'
    }))
    const auth2 = new AuthService({
      secrets,
      fetchFn: async () => new Response('Bad Gateway', { status: 502 }),
      openExternal: async () => {},
      retryDelaysMs: [1]
    })
    await auth2.ensureFreshSession()
    assert.equal(auth2.getState().status, 'authenticated')
    assert.ok(secrets.get('zipply_oauth_tokens_v1'))
    auth2.dispose()
  } finally {
    auth.dispose()
  }
})
