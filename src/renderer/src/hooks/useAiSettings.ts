import { useState, useCallback, useMemo, useEffect } from 'react'
import { AiConfig, AiProviderPreset, ConnectedProvider, DiscoveredLocalService } from '../types/settings'

export interface ProviderPresetInfo {
  id: AiProviderPreset
  name: string
  category: 'cloud' | 'local' | 'custom'
  defaultBaseUrl: string
  requiresKey: boolean
  placeholderKey?: string
  badge?: string
  defaultEmbeddingModel?: string
  recommendedEmbeddingModels?: string[]
}

export const PROVIDER_PRESETS: ProviderPresetInfo[] = [
  // Cloud
  {
    id: 'deepseek',
    name: 'DeepSeek',
    category: 'cloud',
    defaultBaseUrl: 'https://api.deepseek.com/v1',
    requiresKey: true,
    placeholderKey: 'sk-...',
    badge: 'Популярно',
    recommendedEmbeddingModels: ['text-embedding-3-small', 'nomic-embed-text', 'bge-m3']
  },
  {
    id: 'openai',
    name: 'OpenAI',
    category: 'cloud',
    defaultBaseUrl: 'https://api.openai.com/v1',
    requiresKey: true,
    placeholderKey: 'sk-proj-...',
    defaultEmbeddingModel: 'text-embedding-3-small',
    recommendedEmbeddingModels: ['text-embedding-3-small', 'text-embedding-3-large', 'text-embedding-ada-002']
  },
  {
    id: 'anthropic',
    name: 'Anthropic (Claude)',
    category: 'cloud',
    defaultBaseUrl: 'https://api.anthropic.com/v1',
    requiresKey: true,
    placeholderKey: 'sk-ant-...',
    recommendedEmbeddingModels: ['text-embedding-3-small', 'nomic-embed-text', 'bge-m3']
  },
  {
    id: 'openrouter',
    name: 'OpenRouter',
    category: 'cloud',
    defaultBaseUrl: 'https://openrouter.ai/api/v1',
    requiresKey: true,
    placeholderKey: 'sk-or-v1-...',
    badge: 'Универсально',
    defaultEmbeddingModel: 'openai/text-embedding-3-small',
    recommendedEmbeddingModels: ['openai/text-embedding-3-small', 'baai/bge-m3', 'cohere/embed-multilingual-v3.0']
  },
  {
    id: 'gemini',
    name: 'Google Gemini',
    category: 'cloud',
    defaultBaseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
    requiresKey: true,
    placeholderKey: 'AIzaSy...',
    defaultEmbeddingModel: 'text-embedding-004',
    recommendedEmbeddingModels: ['text-embedding-004']
  },
  {
    id: 'xai',
    name: 'xAI (Grok)',
    category: 'cloud',
    defaultBaseUrl: 'https://api.x.ai/v1',
    requiresKey: true,
    placeholderKey: 'xai-...'
  },
  {
    id: 'groq',
    name: 'Groq',
    category: 'cloud',
    defaultBaseUrl: 'https://api.groq.com/openai/v1',
    requiresKey: true,
    placeholderKey: 'gsk-...',
    badge: 'Сверхбыстро'
  },
  {
    id: 'mistral',
    name: 'Mistral AI',
    category: 'cloud',
    defaultBaseUrl: 'https://api.mistral.ai/v1',
    requiresKey: true,
    placeholderKey: 'Ключ Mistral',
    defaultEmbeddingModel: 'mistral-embed',
    recommendedEmbeddingModels: ['mistral-embed']
  },
  {
    id: 'together',
    name: 'Together AI',
    category: 'cloud',
    defaultBaseUrl: 'https://api.together.xyz/v1',
    requiresKey: true,
    placeholderKey: 'Ключ Together',
    defaultEmbeddingModel: 'togethercomputer/m2-bert-80M-8k-retrieval',
    recommendedEmbeddingModels: ['togethercomputer/m2-bert-80M-8k-retrieval', 'BAAI/bge-large-en-v1.5']
  },
  {
    id: 'perplexity',
    name: 'Perplexity',
    category: 'cloud',
    defaultBaseUrl: 'https://api.perplexity.ai',
    requiresKey: true,
    placeholderKey: 'pplx-...'
  },

  // Local (Key NOT required)
  {
    id: 'ollama',
    name: 'Ollama',
    category: 'local',
    defaultBaseUrl: 'http://localhost:11434/v1',
    requiresKey: false,
    badge: 'Локально',
    placeholderKey: 'Не требуется',
    defaultEmbeddingModel: 'nomic-embed-text',
    recommendedEmbeddingModels: ['nomic-embed-text', 'bge-m3', 'all-minilm']
  },
  {
    id: 'lmstudio',
    name: 'LM Studio',
    category: 'local',
    defaultBaseUrl: 'http://localhost:1234/v1',
    requiresKey: false,
    badge: 'Локально',
    placeholderKey: 'Не требуется',
    defaultEmbeddingModel: 'text-embedding-nomic-embed-text-v1.5',
    recommendedEmbeddingModels: ['text-embedding-nomic-embed-text-v1.5', 'bge-m3']
  },
  {
    id: 'vllm',
    name: 'vLLM / LocalAI',
    category: 'local',
    defaultBaseUrl: 'http://localhost:8000/v1',
    requiresKey: false,
    badge: 'Локально',
    placeholderKey: 'Не требуется',
    defaultEmbeddingModel: 'bge-m3',
    recommendedEmbeddingModels: ['bge-m3', 'nomic-embed-text']
  },

  // Custom
  {
    id: 'custom',
    name: 'Свой сервер',
    category: 'custom',
    defaultBaseUrl: 'https://api.example.com/v1',
    requiresKey: false,
    placeholderKey: 'Ключ (если требуется)',
    recommendedEmbeddingModels: ['text-embedding-3-small', 'nomic-embed-text', 'bge-m3']
  }
]

export const PROVIDERS_LIST = PROVIDER_PRESETS

const STORAGE_KEY = 'zipply_ai_config'

export function persistConfig(updated: AiConfig): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(updated))
  } catch (e) {
    console.error('Failed to save AI config to localStorage:', e)
  }
  if (window.api?.storage?.setStore) {
    window.api.storage.setStore('config', updated, 300).catch((err) => {
      console.warn('Failed to save AI config to file storage:', err)
    })
  }
}

const DEFAULT_CONFIG: AiConfig = {
  providerPreset: 'deepseek',
  baseUrl: 'https://api.deepseek.com/v1',
  model: '',
  fastModel: '',
  apiKey: '',
  searchProvider: 'duckduckgo',
  tavilyKey: '',
  temperature: 0.7,
  maxTokens: 4096,
  stream: true,
  baseDir: '',
  embeddingModel: '',
  embeddingBaseUrl: '',
  enableAutoExtract: true,
  enableSessionSummary: true,
  connectedProviders: [],
  activeProviderId: undefined
}

export interface ConnectionTestResult {
  status: 'idle' | 'testing' | 'success' | 'error'
  message?: string
  latencyMs?: number
  providerId?: string
}

export async function fetchRemoteModels(baseUrl: string, apiKey?: string, providerId?: string): Promise<string[]> {
  const targetBaseUrl = (baseUrl || '').trim().replace(/\/+$/, '')
  if (!targetBaseUrl) return []

  // 1. Prefer Electron main process IPC to bypass browser CORS & network restrictions
  if (window.api?.models?.fetchRemote) {
    try {
      const models = await window.api.models.fetchRemote({
        baseUrl: targetBaseUrl,
        apiKey: apiKey?.trim(),
        providerId
      })
      if (Array.isArray(models) && models.length > 0) {
        return models
      }
    } catch (err) {
      console.warn('[useAiSettings] IPC fetchRemote failed, falling back:', err)
    }
  }

  // 2. Direct fetch fallback for browser / dev mode
  const candidateUrls: string[] = [
    targetBaseUrl.endsWith('/chat/completions')
      ? targetBaseUrl.replace(/\/chat\/completions$/, '/models')
      : `${targetBaseUrl}/models`
  ]
  if (!targetBaseUrl.endsWith('/v1')) {
    candidateUrls.push(`${targetBaseUrl}/v1/models`)
  }
  if (providerId === 'ollama' || targetBaseUrl.includes('11434')) {
    candidateUrls.push(`${targetBaseUrl.replace(/\/v1\/?$/, '')}/api/tags`)
  }

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'HTTP-Referer': 'https://zipply.fun',
    'X-Title': 'zipply'
  }
  if (apiKey && apiKey.trim()) {
    headers['Authorization'] = `Bearer ${apiKey.trim()}`
    if (targetBaseUrl.includes('openrouter.ai')) {
      headers['HTTP-Referer'] = 'https://zipply.fun'
      headers['X-Title'] = 'zipply'
    }
  }

  for (const url of candidateUrls) {
    try {
      const res = await fetch(url, {
        method: 'GET',
        headers,
        signal: AbortSignal.timeout(6000)
      })

      if (!res.ok) continue

      const data = await res.json()
      let rawList: any[] = []
      if (Array.isArray(data)) {
        rawList = data
      } else if (Array.isArray(data?.data)) {
        rawList = data.data
      } else if (Array.isArray(data?.models)) {
        rawList = data.models
      }

      const modelIds: string[] = rawList
        .map((item: any) => {
          if (typeof item === 'string') return item
          const id = item?.id || item?.name || item?.model || ''
          return typeof id === 'string' ? id.replace(/^models\//, '').trim() : ''
        })
        .filter((id: string) => typeof id === 'string' && id.trim().length > 0)

      const unique = Array.from(new Set(modelIds)).sort((a, b) => a.localeCompare(b))
      if (unique.length > 0) return unique
    } catch {}
  }

  return []
}

export async function scanLocalServers(): Promise<DiscoveredLocalService[]> {
  // 1. Prefer Electron main process IPC to bypass browser CORS & network restrictions
  if (window.api?.models?.scanLocal) {
    try {
      const results = await window.api.models.scanLocal()
      if (Array.isArray(results)) {
        return results
      }
    } catch (err) {
      console.warn('[useAiSettings] IPC scanLocal failed, falling back:', err)
    }
  }

  // 2. Direct browser / dev mode fallback
  const targets: Array<{
    providerId: 'ollama' | 'lmstudio' | 'vllm'
    name: string
    port: number
    baseUrl: string
    testUrls: string[]
  }> = [
    {
      providerId: 'ollama',
      name: 'Ollama',
      port: 11434,
      baseUrl: 'http://localhost:11434/v1',
      testUrls: ['http://127.0.0.1:11434/api/tags', 'http://localhost:11434/api/tags']
    },
    {
      providerId: 'lmstudio',
      name: 'LM Studio',
      port: 1234,
      baseUrl: 'http://localhost:1234/v1',
      testUrls: ['http://127.0.0.1:1234/v1/models', 'http://localhost:1234/v1/models']
    },
    {
      providerId: 'vllm',
      name: 'vLLM / LocalAI',
      port: 8000,
      baseUrl: 'http://localhost:8000/v1',
      testUrls: ['http://127.0.0.1:8000/v1/models', 'http://localhost:8000/v1/models']
    }
  ]

  const discovered: DiscoveredLocalService[] = []
  await Promise.all(
    targets.map(async (t) => {
      const startTime = performance.now()
      for (const url of t.testUrls) {
        try {
          const res = await fetch(url, { signal: AbortSignal.timeout(1500) })
          if (res.ok) {
            const latencyMs = Math.round(performance.now() - startTime)
            let models: string[] = []
            try {
              const data = await res.json()
              const rawList = Array.isArray(data) ? data : data?.data || data?.models || []
              models = rawList
                .map((m: any) => {
                  if (typeof m === 'string') return m.trim()
                  const id = m?.id || m?.name || m?.model || ''
                  return typeof id === 'string' ? id.replace(/^models\//, '').trim() : ''
                })
                .filter((id: string) => id.length > 0)
            } catch {}
            const uniqueModels = Array.from(new Set(models)).sort((a, b) => a.localeCompare(b))
            discovered.push({
              providerId: t.providerId,
              name: t.name,
              port: t.port,
              baseUrl: t.baseUrl,
              models: uniqueModels,
              status: 'online',
              latencyMs
            })
            return
          }
        } catch {}
      }
    })
  )

  return discovered
}

export function useAiSettings() {
  const [config, setConfig] = useState<AiConfig>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY) ||
                    localStorage.getItem('zipple_ai_config') ||
                    localStorage.getItem('clickcoder_ai_config') ||
                    localStorage.getItem('clickcode_ai_config') ||
                    localStorage.getItem('click_ai_config')
      if (saved) {
        const parsed = JSON.parse(saved)
        let providers: ConnectedProvider[] = parsed.connectedProviders || []
        
        // Auto-migration only if there was an actual configured API key or local provider
        if ((!providers || providers.length === 0) && (parsed.apiKey || parsed.providerPreset === 'ollama' || parsed.providerPreset === 'lmstudio')) {
          const matchingPreset = PROVIDER_PRESETS.find((p) => p.id === (parsed.providerPreset || 'deepseek'))
          const initial: ConnectedProvider = {
            id: `prov-${parsed.providerPreset || 'deepseek'}-${Date.now()}`,
            providerId: parsed.providerPreset || 'deepseek',
            name: matchingPreset?.name || 'DeepSeek',
            baseUrl: parsed.baseUrl || matchingPreset?.defaultBaseUrl || 'https://api.deepseek.com/v1',
            apiKey: parsed.apiKey || '',
            model: parsed.model || '',
            fastModel: parsed.fastModel || '',
            requiresKey: matchingPreset?.requiresKey ?? true
          }
          providers = [initial]
        }

        const activeId = parsed.activeProviderId || (providers.length > 0 ? providers[0].id : undefined)

        return {
          ...DEFAULT_CONFIG,
          ...parsed,
          connectedProviders: providers,
          activeProviderId: activeId,
          baseDir: parsed.baseDir || DEFAULT_CONFIG.baseDir,
          fastModel: parsed.fastModel || DEFAULT_CONFIG.fastModel
        }
      }
    } catch (e) {
      console.warn('Failed to load AI config from localStorage:', e)
    }
    return DEFAULT_CONFIG
  })

  const [testResult, setTestResult] = useState<ConnectionTestResult>({ status: 'idle' })
  const [saveStatus, setSaveStatus] = useState<boolean>(false)

  // Hydrate from persistent local storage on mount & resolve cross-platform paths.
  // Both async calls run in parallel via Promise.all to avoid race conditions where
  // one setConfig call overwrites changes made by the other.
  useEffect(() => {
    const fetchFileConfig = window.api?.storage?.getStore
      ? window.api.storage.getStore<Partial<AiConfig>>('config').catch(() => null)
      : Promise.resolve(null)

    const fetchInfo = window.api?.storage?.getInfo
      ? window.api.storage.getInfo().catch(() => null)
      : Promise.resolve(null)

    Promise.all([fetchFileConfig, fetchInfo]).then(([fileConfig, info]) => {
      setConfig((prev) => {
        let next = { ...prev }

        // 1. Merge file config (wins over in-memory defaults)
        if (fileConfig && typeof fileConfig === 'object' && Object.keys(fileConfig).length > 0) {
          next = { ...next, ...fileConfig }
        }

        // 2. Set platform-correct baseDir if not already set or if it's still an obsolete default
        if (info?.defaultProjectsDir) {
          const normalizedBase = (next.baseDir || '').replace(/\\/g, '/').toLowerCase()
          const isObsoleteDefault = normalizedBase === 'd:/clickprojects' || normalizedBase === 'd:/zippleprojects'
          const isDefault = !next.baseDir || isObsoleteDefault || normalizedBase === 'd:/zipplyprojects'
          const isNotWin = info.platform !== 'win32'

          if ((isDefault && isNotWin) || isObsoleteDefault || !next.baseDir) {
            next = { ...next, baseDir: info.defaultProjectsDir }
          }
        }

        try {
          localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
        } catch {}
        return next
      })
    })
  }, [])

  const saveConfig = useCallback((newConfig: AiConfig) => {
    setConfig(newConfig)
    persistConfig(newConfig)
    setSaveStatus(true)
    setTimeout(() => setSaveStatus(false), 2000)
  }, [])

  const connectedProviders = useMemo(() => {
    return config.connectedProviders || []
  }, [config.connectedProviders])

  const activeProvider = useMemo(() => {
    if (!connectedProviders || connectedProviders.length === 0) return undefined
    return connectedProviders.find((p) => p.id === config.activeProviderId) || connectedProviders[0]
  }, [connectedProviders, config.activeProviderId])

  const setActiveProvider = useCallback((providerId: string) => {
    setConfig((prev) => {
      const providers = prev.connectedProviders || []
      const target = providers.find((p) => p.id === providerId)
      if (!target) return prev

      const updated: AiConfig = {
        ...prev,
        activeProviderId: providerId,
        providerPreset: target.providerId,
        baseUrl: target.baseUrl,
        apiKey: target.apiKey,
        model: target.model || '',
        fastModel: target.fastModel || target.model || '',
        embeddingModel: target.embeddingModel !== undefined ? target.embeddingModel : prev.embeddingModel,
        embeddingBaseUrl: target.embeddingBaseUrl !== undefined ? target.embeddingBaseUrl : prev.embeddingBaseUrl
      }

      persistConfig(updated)
      return updated
    })
  }, [])

  const addConnectedProvider = useCallback((newProv: Omit<ConnectedProvider, 'id'>) => {
    const id = `prov-${newProv.providerId}-${Date.now()}`
    const fullProvider: ConnectedProvider = {
      ...newProv,
      id,
      fastModel: newProv.fastModel || newProv.model || ''
    }

    setConfig((prev) => {
      const currentList = prev.connectedProviders || []
      const updatedList = [...currentList, fullProvider]

      const updated: AiConfig = {
        ...prev,
        connectedProviders: updatedList,
        activeProviderId: id,
        providerPreset: fullProvider.providerId,
        baseUrl: fullProvider.baseUrl,
        apiKey: fullProvider.apiKey,
        model: fullProvider.model || '',
        fastModel: fullProvider.fastModel || fullProvider.model || '',
        embeddingModel: fullProvider.embeddingModel !== undefined ? fullProvider.embeddingModel : prev.embeddingModel,
        embeddingBaseUrl: fullProvider.embeddingBaseUrl !== undefined ? fullProvider.embeddingBaseUrl : prev.embeddingBaseUrl
      }

      persistConfig(updated)
      return updated
    })
  }, [])

  const updateConnectedProvider = useCallback((id: string, updates: Partial<ConnectedProvider>) => {
    setConfig((prev) => {
      const currentList = prev.connectedProviders || []
      const updatedList = currentList.map((p) => {
        if (p.id === id) {
          const nextModel = updates.model !== undefined ? updates.model : p.model
          const nextFastModel = updates.fastModel !== undefined ? updates.fastModel : (updates.model || p.fastModel || nextModel)
          return { ...p, ...updates, fastModel: nextFastModel }
        }
        return p
      })
      const isCurrentActive = prev.activeProviderId === id

      const updated: AiConfig = {
        ...prev,
        connectedProviders: updatedList,
        ...(isCurrentActive
          ? {
              baseUrl: updates.baseUrl !== undefined ? updates.baseUrl : prev.baseUrl,
              apiKey: updates.apiKey !== undefined ? updates.apiKey : prev.apiKey,
              model: updates.model !== undefined ? updates.model : prev.model,
              fastModel: updates.fastModel !== undefined ? updates.fastModel : (updates.model || prev.fastModel || updates.model || prev.model),
              providerPreset: updates.providerId !== undefined ? updates.providerId : prev.providerPreset,
              embeddingModel: updates.embeddingModel !== undefined ? updates.embeddingModel : prev.embeddingModel,
              embeddingBaseUrl: updates.embeddingBaseUrl !== undefined ? updates.embeddingBaseUrl : prev.embeddingBaseUrl
            }
          : {})
      }

      persistConfig(updated)
      return updated
    })
  }, [])

  const removeConnectedProvider = useCallback((id: string) => {
    setConfig((prev) => {
      const currentList = prev.connectedProviders || []
      const updatedList = currentList.filter((p) => p.id !== id)
      let nextActiveId = prev.activeProviderId
      let nextActiveProv = updatedList[0]

      if (prev.activeProviderId === id) {
        nextActiveId = updatedList.length > 0 ? updatedList[0].id : undefined
        nextActiveProv = updatedList[0]
      }

      const updated: AiConfig = {
        ...prev,
        connectedProviders: updatedList,
        activeProviderId: nextActiveId,
        ...(nextActiveProv
          ? {
              providerPreset: nextActiveProv.providerId,
              baseUrl: nextActiveProv.baseUrl,
              apiKey: nextActiveProv.apiKey,
              model: nextActiveProv.model || '',
              fastModel: nextActiveProv.fastModel || nextActiveProv.model || '',
              embeddingModel: nextActiveProv.embeddingModel || '',
              embeddingBaseUrl: nextActiveProv.embeddingBaseUrl || ''
            }
          : {
              model: '',
              fastModel: '',
              apiKey: '',
              embeddingModel: '',
              embeddingBaseUrl: ''
            })
      }

      persistConfig(updated)
      return updated
    })
  }, [])

  const updateField = useCallback(<K extends keyof AiConfig>(field: K, value: AiConfig[K]) => {
    setConfig((prev) => {
      const updated = {
        ...prev,
        [field]: value
      }
      persistConfig(updated)
      return updated
    })
  }, [])

  const resetDefaults = useCallback(() => {
    setConfig(DEFAULT_CONFIG)
    persistConfig(DEFAULT_CONFIG)
  }, [])

  const testConnection = useCallback(async (customBaseUrl?: string, customKey?: string, customModel?: string, providerId?: string) => {
    setTestResult({ status: 'testing' })
    const targetBaseUrl = (customBaseUrl || config.baseUrl || '').trim().replace(/\/+$/, '')
    const targetApiKey = (customKey !== undefined ? customKey : config.apiKey || '').trim()
    const targetModel = (customModel || config.model || '').trim()

    // 1. Prefer IPC testConnection
    if (window.api?.models?.testConnection) {
      try {
        const res = await window.api.models.testConnection({
          baseUrl: targetBaseUrl,
          apiKey: targetApiKey,
          model: targetModel,
          providerId: providerId || config.providerPreset
        })
        setTestResult({
          status: res.status,
          message: res.message,
          latencyMs: res.latencyMs
        })
        return
      } catch (err: unknown) {
        console.warn('[useAiSettings] IPC testConnection failed:', err)
      }
    }

    // 2. Fallback
    const startTime = performance.now()
    try {
      if (!targetBaseUrl) {
        setTestResult({ status: 'error', message: 'Укажите корректный Base URL' })
        return
      }

      const models = await fetchRemoteModels(targetBaseUrl, targetApiKey, providerId)
      const latency = Math.round(performance.now() - startTime)
      if (models.length > 0) {
        setTestResult({
          status: 'success',
          message: `Связь установлена (${models.length} моделей)`,
          latencyMs: latency
        })
      } else {
        setTestResult({
          status: 'error',
          message: 'Сервер не отвечает на запрос списка моделей'
        })
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Ошибка подключения'
      setTestResult({ status: 'error', message: msg })
    }
  }, [config])

  const selectDirectory = useCallback(async () => {
    try {
      if (window.api?.dialog?.selectDirectory) {
        const selected = await window.api.dialog.selectDirectory(config.baseDir)
        if (selected) {
          updateField('baseDir', selected)
        }
      }
    } catch (err) {
      console.error('Failed to open directory dialog:', err)
    }
  }, [config.baseDir, updateField])

  const quickConnectLocalService = useCallback((service: DiscoveredLocalService) => {
    setConfig((prev) => {
      const providers = prev.connectedProviders || []
      const existing = providers.find(
        (p) => p.providerId === service.providerId || p.baseUrl.includes(String(service.port))
      )

      let updatedList: ConnectedProvider[]
      let activeId: string

      if (existing) {
        activeId = existing.id
        const modelToSet =
          service.models.length > 0
            ? service.models.includes(existing.model)
              ? existing.model
              : service.models[0]
            : existing.model || ''

        updatedList = providers.map((p) =>
          p.id === existing.id
            ? {
                ...p,
                baseUrl: service.baseUrl,
                models: service.models.length > 0 ? service.models : p.models,
                model: modelToSet,
                fastModel: modelToSet
              }
            : p
        )
      } else {
        activeId = `prov-${service.providerId}-${Date.now()}`
        const modelToSet = service.models.length > 0 ? service.models[0] : ''
        const preset = PROVIDER_PRESETS.find((p) => p.id === service.providerId)
        const newProv: ConnectedProvider = {
          id: activeId,
          providerId: service.providerId,
          name: service.name,
          baseUrl: service.baseUrl,
          apiKey: '',
          model: modelToSet,
          models: service.models,
          fastModel: modelToSet,
          embeddingModel: preset?.defaultEmbeddingModel || '',
          requiresKey: false
        }
        updatedList = [...providers, newProv]
      }

      const activeTarget = updatedList.find((p) => p.id === activeId)
      const updated: AiConfig = {
        ...prev,
        connectedProviders: updatedList,
        activeProviderId: activeId,
        providerPreset: service.providerId,
        baseUrl: service.baseUrl,
        apiKey: '',
        model: activeTarget?.model || '',
        fastModel: activeTarget?.fastModel || activeTarget?.model || '',
        embeddingModel: activeTarget?.embeddingModel || prev.embeddingModel || ''
      }

      persistConfig(updated)
      return updated
    })
  }, [])

  return {
    config,
    presets: PROVIDER_PRESETS,
    connectedProviders,
    activeProvider,
    testResult,
    saveStatus,
    setActiveProvider,
    addConnectedProvider,
    updateConnectedProvider,
    removeConnectedProvider,
    quickConnectLocalService,
    scanLocalServers,
    fetchRemoteModels,
    updateField,
    saveConfig,
    resetDefaults,
    testConnection,
    selectDirectory
  }
}

export default useAiSettings
