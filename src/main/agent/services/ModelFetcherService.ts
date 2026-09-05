export interface FetchModelsOptions {
  baseUrl: string
  apiKey?: string
  providerId?: string
}

export interface TestConnectionOptions {
  baseUrl: string
  apiKey?: string
  model?: string
  providerId?: string
}

export interface TestConnectionResult {
  status: 'success' | 'error'
  message: string
  latencyMs?: number
}

export interface DiscoveredLocalService {
  providerId: 'ollama' | 'lmstudio' | 'vllm'
  name: string
  port: number
  baseUrl: string
  models: string[]
  status: 'online'
  latencyMs?: number
}

export class ModelFetcherService {
  /**
   * Scan local ports for running Ollama, LM Studio, or vLLM servers
   */
  static async scanLocalServers(): Promise<DiscoveredLocalService[]> {
    const targets: Array<{
      providerId: 'ollama' | 'lmstudio' | 'vllm'
      name: string
      port: number
      baseUrl: string
      hosts: string[]
      endpoints: string[]
    }> = [
      {
        providerId: 'ollama',
        name: 'Ollama',
        port: 11434,
        baseUrl: 'http://localhost:11434/v1',
        hosts: ['http://127.0.0.1:11434', 'http://localhost:11434'],
        endpoints: ['/api/tags', '/v1/models']
      },
      {
        providerId: 'lmstudio',
        name: 'LM Studio',
        port: 1234,
        baseUrl: 'http://localhost:1234/v1',
        hosts: ['http://127.0.0.1:1234', 'http://localhost:1234'],
        endpoints: ['/v1/models']
      },
      {
        providerId: 'vllm',
        name: 'vLLM / LocalAI',
        port: 8000,
        baseUrl: 'http://localhost:8000/v1',
        hosts: ['http://127.0.0.1:8000', 'http://localhost:8000'],
        endpoints: ['/v1/models']
      }
    ]

    const discovered: DiscoveredLocalService[] = []

    await Promise.all(
      targets.map(async (target) => {
        const startTime = performance.now()
        for (const host of target.hosts) {
          for (const endpoint of target.endpoints) {
            const url = `${host}${endpoint}`
            try {
              const res = await fetch(url, {
                method: 'GET',
                headers: { 'Content-Type': 'application/json' },
                signal: AbortSignal.timeout(1500)
              })

              if (res.ok) {
                const latencyMs = Math.round(performance.now() - startTime)
                let models: string[] = []
                try {
                  const data = await res.json()
                  let rawList: any[] = []
                  if (Array.isArray(data)) {
                    rawList = data
                  } else if (Array.isArray(data?.data)) {
                    rawList = data.data
                  } else if (Array.isArray(data?.models)) {
                    rawList = data.models
                  }

                  models = rawList
                    .map((item: any) => {
                      if (typeof item === 'string') return item.trim()
                      const id = item?.id || item?.name || item?.model || ''
                      return typeof id === 'string' ? id.replace(/^models\//, '').trim() : ''
                    })
                    .filter((id: string) => id.length > 0)
                } catch {
                  // Port is open and responding with 200 even if JSON parse failed
                }

                // Deduplicate models
                const uniqueModels = Array.from(new Set(models)).sort((a, b) => a.localeCompare(b))

                discovered.push({
                  providerId: target.providerId,
                  name: target.name,
                  port: target.port,
                  baseUrl: target.baseUrl,
                  models: uniqueModels,
                  status: 'online',
                  latencyMs
                })
                return // Target found, stop checking this target's other endpoints/hosts
              }
            } catch {
              // Port not open or request timed out, continue checking
            }
          }
        }
      })
    )

    return discovered
  }
  /**
   * Fetch all available models from an AI provider or router (OpenAI, OpenRouter, DeepSeek, Ollama, etc.)
   */
  static async fetchRemoteModels(options: FetchModelsOptions): Promise<string[]> {
    const rawBaseUrl = (options.baseUrl || '').trim().replace(/\/+$/, '')
    if (!rawBaseUrl) return []

    const apiKey = (options.apiKey || '').trim()
    const providerId = options.providerId || ''

    // Build candidate URLs
    const candidateUrls: string[] = []

    if (rawBaseUrl.endsWith('/chat/completions')) {
      candidateUrls.push(rawBaseUrl.replace(/\/chat\/completions$/, '/models'))
    } else {
      candidateUrls.push(`${rawBaseUrl}/models`)
      if (!rawBaseUrl.endsWith('/v1')) {
        candidateUrls.push(`${rawBaseUrl}/v1/models`)
      }
    }

    // Provider specific candidates
    if (providerId === 'ollama' || rawBaseUrl.includes('11434')) {
      const rootUrl = rawBaseUrl.replace(/\/v1\/?$/, '')
      candidateUrls.unshift(`${rawBaseUrl}/models`, `${rootUrl}/api/tags`)
    }

    if (providerId === 'gemini' || rawBaseUrl.includes('generativelanguage.googleapis.com')) {
      if (apiKey) {
        candidateUrls.push(`https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`)
      }
    }

    if (providerId === 'anthropic' || rawBaseUrl.includes('anthropic.com')) {
      candidateUrls.unshift('https://api.anthropic.com/v1/models')
    }

    // Build request headers
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'HTTP-Referer': 'https://zipply.fun',
      'X-Title': 'zipply',
      'User-Agent': 'zipply/1.0.0 (https://zipply.fun)'
    }

    if (apiKey) {
      headers['Authorization'] = `Bearer ${apiKey}`
      if (providerId === 'anthropic' || rawBaseUrl.includes('anthropic.com')) {
        headers['x-api-key'] = apiKey
        headers['anthropic-version'] = '2023-06-01'
      }
      if (rawBaseUrl.includes('openrouter.ai')) {
        headers['HTTP-Referer'] = 'https://zipply.fun'
        headers['X-Title'] = 'zipply'
      }
    }

    for (const url of candidateUrls) {
      try {
        const response = await fetch(url, {
          method: 'GET',
          headers,
          signal: AbortSignal.timeout(8000)
        })

        if (!response.ok) {
          continue
        }

        const data = await response.json()
        let rawList: any[] = []

        if (Array.isArray(data)) {
          rawList = data
        } else if (Array.isArray(data?.data)) {
          rawList = data.data
        } else if (Array.isArray(data?.models)) {
          rawList = data.models
        }

        if (rawList && rawList.length > 0) {
          const modelIds: string[] = rawList
            .map((item: any) => {
              if (typeof item === 'string') return item.trim()
              const id = item?.id || item?.name || item?.model || ''
              // Handle Ollama / Google Gemini model name prefixes
              if (typeof id === 'string') {
                return id.replace(/^models\//, '').trim()
              }
              return ''
            })
            .filter((id: string) => id.length > 0)

          const uniqueModels = Array.from(new Set(modelIds)).sort((a, b) => a.localeCompare(b))
          if (uniqueModels.length > 0) {
            return uniqueModels
          }
        }
      } catch (err) {
        console.warn(`[ModelFetcherService] Failed to fetch from ${url}:`, err)
      }
    }

    return []
  }

  /**
   * Test connection to provider endpoint and measure latency
   */
  static async testConnection(options: TestConnectionOptions): Promise<TestConnectionResult> {
    const startTime = performance.now()
    const rawBaseUrl = (options.baseUrl || '').trim().replace(/\/+$/, '')
    const apiKey = (options.apiKey || '').trim()
    const model = (options.model || '').trim()

    if (!rawBaseUrl) {
      return {
        status: 'error',
        message: 'Укажите корректный Base URL'
      }
    }

    try {
      // 1. Try fetching models list first
      const models = await this.fetchRemoteModels({
        baseUrl: rawBaseUrl,
        apiKey,
        providerId: options.providerId
      })

      if (models.length > 0) {
        const latency = Math.round(performance.now() - startTime)
        return {
          status: 'success',
          message: `Связь установлена (${models.length} моделей доступно)`,
          latencyMs: latency
        }
      }

      // 2. Fallback: minimal chat completion ping if model is provided
      if (model) {
        const chatUrl = rawBaseUrl.endsWith('/chat/completions')
          ? rawBaseUrl
          : `${rawBaseUrl}/chat/completions`

        const headers: Record<string, string> = {
          'Content-Type': 'application/json',
          'HTTP-Referer': 'https://zipply.fun',
          'X-Title': 'zipply',
          'User-Agent': 'zipply/1.0.0 (https://zipply.fun)'
        }
        if (apiKey) {
          headers['Authorization'] = `Bearer ${apiKey}`
        }

        const res = await fetch(chatUrl, {
          method: 'POST',
          headers,
          body: JSON.stringify({
            model,
            messages: [{ role: 'user', content: 'hi' }],
            max_tokens: 1
          }),
          signal: AbortSignal.timeout(8000)
        })

        const latency = Math.round(performance.now() - startTime)

        if (res.ok) {
          return {
            status: 'success',
            message: `Модель "${model}" отвечает`,
            latencyMs: latency
          }
        } else {
          const errText = await res.text().catch(() => '')
          return {
            status: 'error',
            message: `Ошибка сервера (HTTP ${res.status}): ${errText.slice(0, 80)}`
          }
        }
      }

      return {
        status: 'error',
        message: 'Сервер не отвечает на запрос списка моделей'
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Ошибка подключения'
      return {
        status: 'error',
        message: msg.includes('timeout') ? 'Таймаут подключения к серверу' : msg
      }
    }
  }
}
