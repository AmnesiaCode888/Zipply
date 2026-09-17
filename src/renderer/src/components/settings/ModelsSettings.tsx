import React, { useState, useEffect, useCallback } from 'react'
import {
  Plus,
  Check,
  Eye,
  EyeOff,
  FolderOpen,
  Bot,
  Cpu,
  Globe,
  HardDrive,
  Zap,
  Server,
  Trash2,
  ChevronRight,
  ChevronDown,
  ArrowLeft,
  Activity,
  ShieldCheck,
  Compass,
  Radio,
  Terminal,
  RefreshCw,
  Search,
  CheckCircle2,
  KeyRound,
  Sliders
} from 'lucide-react'
import { useAiSettingsContext, PROVIDER_PRESETS } from '../../hooks/AiSettingsContext'
import { AiProviderPreset, ConnectedProvider, DiscoveredLocalService } from '../../types/settings'
import './ModelsSettings.css'

export const ModelsSettings: React.FC = () => {
  const {
    config,
    connectedProviders,
    activeProvider,
    testResult,
    setActiveProvider,
    addConnectedProvider,
    updateConnectedProvider,
    removeConnectedProvider,
    quickConnectLocalService,
    scanLocalServers,
    fetchRemoteModels,
    updateField,
    testConnection,
    selectDirectory
  } = useAiSettingsContext()

  // Navigation state: 'list' (main screen) vs 'connect' (provider setup screen)
  const [screen, setScreen] = useState<'list' | 'connect'>('list')
  const [editingId, setEditingId] = useState<string | null>(null)

  // Form state
  const [formPreset, setFormPreset] = useState<AiProviderPreset>('deepseek')
  const [formName, setFormName] = useState('DeepSeek')
  const [formBaseUrl, setFormBaseUrl] = useState('https://api.deepseek.com/v1')
  const [formApiKey, setFormApiKey] = useState('')
  const [formModel, setFormModel] = useState('')
  const [formFastModel, setFormFastModel] = useState('')
  const [enableEmbedding, setEnableEmbedding] = useState<boolean>(false)
  const [formEmbeddingModel, setFormEmbeddingModel] = useState('')
  const [formEmbeddingBaseUrl, setFormEmbeddingBaseUrl] = useState('')
  const [showEmbeddingAdvanced, setShowEmbeddingAdvanced] = useState(false)
  const [formContextLength, setFormContextLength] = useState<number>(32768)
  const [formTemperature, setFormTemperature] = useState<number>(0.7)
  const [formMaxTokens, setFormMaxTokens] = useState<number>(4096)
  const [showInferenceAdvanced, setShowInferenceAdvanced] = useState<boolean>(false)
  const [showKey, setShowKey] = useState(false)
  const [showTavilyKey, setShowTavilyKey] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)

  // Remote models fetched from router/provider
  const [fetchedModels, setFetchedModels] = useState<string[]>([])
  const [isFetchingModels, setIsFetchingModels] = useState(false)
  const [modelSearchQuery, setModelSearchQuery] = useState('')

  // Local AI server discovery state
  const [discoveredServices, setDiscoveredServices] = useState<DiscoveredLocalService[]>([])

  const handleScan = useCallback(async () => {
    try {
      const results = await scanLocalServers()
      setDiscoveredServices(results)
    } catch {
      // ignore
    }
  }, [scanLocalServers])

  // Run initial scan on mount
  useEffect(() => {
    handleScan()
  }, [handleScan])

  const getProviderIcon = (presetId: AiProviderPreset) => {
    switch (presetId) {
      case 'deepseek':
        return <Bot size={17} />
      case 'openai':
        return <Cpu size={17} />
      case 'anthropic':
        return <Compass size={17} />
      case 'openrouter':
        return <Globe size={17} />
      case 'gemini':
        return <Radio size={17} />
      case 'xai':
        return <Terminal size={17} />
      case 'groq':
        return <Zap size={17} />
      case 'mistral':
        return <Server size={17} />
      case 'together':
        return <Cpu size={17} />
      case 'perplexity':
        return <Globe size={17} />
      case 'ollama':
      case 'lmstudio':
      case 'vllm':
        return <HardDrive size={17} />
      case 'custom_provider':
        return <Globe size={17} />
      case 'custom':
      default:
        return <Server size={17} />
    }
  }

  const openConnectScreen = () => {
    setEditingId(null)
    const preset = PROVIDER_PRESETS[0]
    setFormPreset(preset.id)
    setFormName(preset.name)
    setFormBaseUrl(preset.defaultBaseUrl)
    setFormApiKey('')
    setFormModel('')
    setFormFastModel('')
    setEnableEmbedding(false)
    setFormEmbeddingModel(preset.defaultEmbeddingModel || '')
    setFormEmbeddingBaseUrl('')
    setShowEmbeddingAdvanced(false)
    setFormContextLength(preset.defaultContextLength || 32768)
    setFormTemperature(preset.defaultTemperature ?? 0.7)
    setFormMaxTokens(preset.defaultMaxTokens || 4096)
    setShowInferenceAdvanced(false)
    setFetchedModels([])
    setFormError(null)
    setModelSearchQuery('')
    setScreen('connect')
  }

  const openEditScreen = (prov: ConnectedProvider) => {
    setEditingId(prov.id)
    setFormPreset(prov.providerId)
    setFormName(prov.name)
    setFormBaseUrl(prov.baseUrl)
    setFormApiKey(prov.apiKey)
    setFormModel(prov.model || '')
    setFormFastModel(prov.fastModel || '')
    setEnableEmbedding(Boolean(prov.embeddingModel))
    setFormEmbeddingModel(prov.embeddingModel || '')
    setFormEmbeddingBaseUrl(prov.embeddingBaseUrl || '')
    setShowEmbeddingAdvanced(Boolean(prov.embeddingBaseUrl))
    const preset = PROVIDER_PRESETS.find((p) => p.id === prov.providerId)
    setFormContextLength(prov.contextLength || preset?.defaultContextLength || 32768)
    setFormTemperature(prov.temperature !== undefined ? prov.temperature : (preset?.defaultTemperature ?? 0.7))
    setFormMaxTokens(prov.maxTokens || preset?.defaultMaxTokens || 4096)
    setShowInferenceAdvanced(false)
    setFetchedModels(prov.models || [])
    setFormError(null)
    setModelSearchQuery('')
    setScreen('connect')
  }

  const handleSelectPresetChange = (presetId: AiProviderPreset) => {
    const preset = PROVIDER_PRESETS.find((p) => p.id === presetId)
    if (!preset) return

    // Check if we already have discovered local models for this preset
    const discovered = discoveredServices.find((s) => s.providerId === presetId)

    setFormPreset(preset.id)
    setFormName(preset.name)
    setFormBaseUrl(discovered?.baseUrl || preset.defaultBaseUrl)
    setFormApiKey('')
    setFormModel(discovered?.models?.[0] || '')
    setFormFastModel('')
    setFormEmbeddingModel(preset.defaultEmbeddingModel || '')
    setFormEmbeddingBaseUrl('')
    setShowEmbeddingAdvanced(false)
    if (preset.defaultContextLength) setFormContextLength(preset.defaultContextLength)
    if (preset.defaultTemperature !== undefined) setFormTemperature(preset.defaultTemperature)
    if (preset.defaultMaxTokens) setFormMaxTokens(preset.defaultMaxTokens)
    setShowInferenceAdvanced(false)
    setFetchedModels(discovered?.models || [])
    setFormError(null)
    setModelSearchQuery('')
  }

  const handleFetchModels = async () => {
    if (!formBaseUrl.trim()) {
      setFormError('Укажите Base URL для получения моделей')
      return
    }
    const currentPreset = PROVIDER_PRESETS.find((p) => p.id === formPreset) || PROVIDER_PRESETS[0]
    if (currentPreset.requiresKey && !formApiKey.trim()) {
      setFormError('Сначала введите API ключ')
      return
    }

    setIsFetchingModels(true)
    setFormError(null)
    try {
      const models = await fetchRemoteModels(formBaseUrl, formApiKey, formPreset)
      if (models.length > 0) {
        setFetchedModels(models)
        if (!formModel || !models.includes(formModel)) {
          // Exclude embedding models from main chat model default
          const nonEmbedding = models.filter((m) => !/embed|bge|nomic|ada/i.test(m))
          setFormModel(nonEmbedding.length > 0 ? nonEmbedding[0] : models[0])
        }
        // Only auto-select embedding model if user has enabled embeddings
        if (enableEmbedding && !formEmbeddingModel) {
          const embCandidate = models.find((m) => /embed|bge|nomic|ada/i.test(m))
          if (embCandidate) setFormEmbeddingModel(embCandidate)
        }
      } else {
        setFormError('Сервер не вернул список моделей. Проверьте правильность ключа/URL или введите имя модели вручную.')
      }
    } catch {
      setFormError('Ошибка при запросе списка моделей от сервера')
    } finally {
      setIsFetchingModels(false)
    }
  }

  const handleSaveAndConnect = () => {
    const currentPreset = PROVIDER_PRESETS.find((p) => p.id === formPreset) || PROVIDER_PRESETS[0]

    if (!formBaseUrl.trim()) {
      setFormError('Укажите Base URL эндпоинта')
      return
    }

    if (currentPreset.requiresKey && !formApiKey.trim()) {
      setFormError('Введите API ключ для авторизации')
      return
    }

    if (!formModel.trim()) {
      setFormError('Выберите или введите модель для работы')
      return
    }

    const resolvedFastModel = formFastModel.trim() || undefined
    const resolvedEmbeddingModel = enableEmbedding && formEmbeddingModel.trim() ? formEmbeddingModel.trim() : undefined
    const resolvedEmbeddingBaseUrl = enableEmbedding && formEmbeddingBaseUrl.trim() ? formEmbeddingBaseUrl.trim() : undefined

    if (editingId) {
      updateConnectedProvider(editingId, {
        providerId: formPreset,
        name: formName.trim() || currentPreset.name,
        baseUrl: formBaseUrl.trim(),
        apiKey: formApiKey.trim(),
        model: formModel.trim(),
        fastModel: resolvedFastModel,
        contextLength: formContextLength || 32768,
        temperature: formTemperature,
        maxTokens: formMaxTokens || 4096,
        embeddingModel: resolvedEmbeddingModel,
        embeddingBaseUrl: resolvedEmbeddingBaseUrl,
        models: fetchedModels.length > 0 ? fetchedModels : [formModel.trim()],
        requiresKey: currentPreset.requiresKey
      })
    } else {
      addConnectedProvider({
        providerId: formPreset,
        name: formName.trim() || currentPreset.name,
        baseUrl: formBaseUrl.trim(),
        apiKey: formApiKey.trim(),
        model: formModel.trim(),
        fastModel: resolvedFastModel,
        contextLength: formContextLength || 32768,
        temperature: formTemperature,
        maxTokens: formMaxTokens || 4096,
        embeddingModel: resolvedEmbeddingModel,
        embeddingBaseUrl: resolvedEmbeddingBaseUrl,
        models: fetchedModels.length > 0 ? fetchedModels : [formModel.trim()],
        requiresKey: currentPreset.requiresKey
      })
    }

    setFormError(null)
    setScreen('list')
  }

  const handleDeleteProvider = () => {
    if (editingId && connectedProviders.length > 1) {
      removeConnectedProvider(editingId)
      setScreen('list')
    }
  }

  const filteredModels = fetchedModels.filter((m) =>
    m.toLowerCase().includes(modelSearchQuery.toLowerCase())
  )

  // ════════════════════════════════════════════════════════════════════════
  // 1. DETAIL VIEW: PROVIDER SETUP
  // ════════════════════════════════════════════════════════════════════════
  if (screen === 'connect') {
    const currentPreset = PROVIDER_PRESETS.find((p) => p.id === formPreset) || PROVIDER_PRESETS[0]
    const isCustomCategory = currentPreset.category === 'custom'
    const isKeyReady = !currentPreset.requiresKey || isCustomCategory || formApiKey.trim().length > 0

    return (
      <div className="models-settings-root">
        {/* Top Navigation */}
        <div className="models-nav-bar">
          <button
            type="button"
            className="models-back-btn"
            onClick={() => setScreen('list')}
          >
            <ArrowLeft size={15} />
            <span>Назад к списку</span>
          </button>
        </div>

        {/* Hero Header */}
        <div className="models-hero-header">
          <h1 className="models-title-text">
            {editingId ? `Настройка: ${formName}` : 'Подключение провайдера'}
          </h1>
          <p className="models-desc-text">
            Выберите сервис, настройте адрес сервера и выберите модель для работы
          </p>
        </div>

        {/* Input Fields Stack */}
        <div className="models-inputs-group">
          {/* 1. Provider Selector */}
          <div className="models-input-block">
            <div className="input-label-row">
              <label htmlFor="provider-select" className="input-label-title">
                Провайдер ИИ
              </label>
              {currentPreset.badge && (
                <span className="preset-pill-badge">{currentPreset.badge}</span>
              )}
            </div>

            <div className="select-container-shell">
              <div className="select-icon-prefix">
                {getProviderIcon(currentPreset.id)}
              </div>
              <select
                id="provider-select"
                className="native-select-control"
                value={formPreset}
                onChange={(e) => handleSelectPresetChange(e.target.value as AiProviderPreset)}
              >
                <optgroup label="Облачные провайдеры (API Key)">
                  {PROVIDER_PRESETS.filter((p) => p.category === 'cloud').map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </optgroup>
                <optgroup label="Локальные сервисы (Без ключа)">
                  {PROVIDER_PRESETS.filter((p) => p.category === 'local').map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </optgroup>
                <optgroup label="Свой сервер / Провайдер">
                  {PROVIDER_PRESETS.filter((p) => p.category === 'custom').map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </optgroup>
              </select>
              <div className="select-chevron-suffix">
                <ChevronDown size={15} />
              </div>
            </div>
          </div>

          {/* 1.5 Connection Name (Editable title for custom or any provider) */}
          <div className="models-input-block">
            <div className="input-label-row">
              <label htmlFor="form-name" className="input-label-title">
                Название подключения
              </label>
              <span className="input-subtle-hint">Отображается в списке сервисов</span>
            </div>
            <div className="input-field-container">
              <input
                id="form-name"
                type="text"
                className="input-field-control"
                placeholder={currentPreset.name}
                value={formName}
                onChange={(e) => setFormName(e.target.value)}
                spellCheck={false}
              />
            </div>
          </div>

          {/* 2. API Key */}
          {isCustomCategory ? (
            <div className="models-input-block">
              <div className="input-label-row">
                <label htmlFor="form-key" className="input-label-title">
                  API Key
                </label>
                <span className="input-secure-pill optional">
                  <ShieldCheck size={12} />
                  <span>Опционально (если требуется)</span>
                </span>
              </div>

              <div className="input-field-container">
                <input
                  id="form-key"
                  type={showKey ? 'text' : 'password'}
                  className="input-field-control"
                  placeholder="sk-... (оставьте пустым, если сервер без авторизации)"
                  value={formApiKey}
                  onChange={(e) => {
                    setFormApiKey(e.target.value)
                    setFormError(null)
                  }}
                  spellCheck={false}
                />
                <button
                  type="button"
                  className="input-eye-toggle"
                  onClick={() => setShowKey(!showKey)}
                  title={showKey ? 'Скрыть ключ' : 'Показать ключ'}
                >
                  {showKey ? <EyeOff size={15} /> : <Eye size={15} />}
                </button>
              </div>
            </div>
          ) : currentPreset.requiresKey ? (
            <div className="models-input-block">
              <div className="input-label-row">
                <label htmlFor="form-key" className="input-label-title">
                  API Key
                </label>
                <span className="input-secure-pill">
                  <ShieldCheck size={12} />
                  <span>Локальное хранение</span>
                </span>
              </div>

              <div className="input-field-container">
                <input
                  id="form-key"
                  type={showKey ? 'text' : 'password'}
                  className="input-field-control"
                  placeholder={currentPreset.placeholderKey || 'sk-...'}
                  value={formApiKey}
                  onChange={(e) => {
                    setFormApiKey(e.target.value)
                    setFormError(null)
                  }}
                  spellCheck={false}
                  autoFocus
                />
                <button
                  type="button"
                  className="input-eye-toggle"
                  onClick={() => setShowKey(!showKey)}
                  title={showKey ? 'Скрыть ключ' : 'Показать ключ'}
                >
                  {showKey ? <EyeOff size={15} /> : <Eye size={15} />}
                </button>
              </div>
            </div>
          ) : (
            <div className="models-input-block">
              <div className="input-label-row">
                <label className="input-label-title">API Key</label>
                <span className="input-no-key-pill">Ключ не требуется</span>
              </div>
              <div className="input-no-key-desc">
                {(() => {
                  const discovered = discoveredServices.find((s) => s.providerId === currentPreset.id)
                  if (discovered) {
                    return `Сервер ${discovered.name} запущен на порту ${discovered.port} (${discovered.models.length} моделей доступно).`
                  }
                  return `Для локального сервиса ${currentPreset.name} авторизация не нужна.`
                })()}
              </div>
            </div>
          )}

          {/* 3. Base URL */}
          <div className="models-input-block">
            <div className="input-label-row">
              <label htmlFor="form-url" className="input-label-title">
                Base URL (Эндпоинт API)
              </label>
              <button
                type="button"
                className="input-subtle-action"
                onClick={() => setFormBaseUrl(currentPreset.defaultBaseUrl)}
              >
                Сбросить
              </button>
            </div>

            <div className="input-field-container">
              <input
                id="form-url"
                type="text"
                className="input-field-control"
                placeholder={currentPreset.defaultBaseUrl}
                value={formBaseUrl}
                onChange={(e) => {
                  setFormBaseUrl(e.target.value)
                  setFormError(null)
                }}
                spellCheck={false}
              />
            </div>
          </div>

          {/* 4. Model Selection - ONLY SHOWN AFTER API KEY IS ENTERED (or for local providers) */}
          {isKeyReady ? (
            <div className="models-input-block">
              <div className="input-label-row">
                <label htmlFor="form-model" className="input-label-title">
                  Выбор модели
                </label>
                <button
                  type="button"
                  className="fetch-models-action-btn"
                  onClick={handleFetchModels}
                  disabled={isFetchingModels}
                >
                  <RefreshCw size={12} className={isFetchingModels ? 'spin-icon' : ''} />
                  <span>{isFetchingModels ? 'Загрузка моделей...' : 'Получить модели от роутера'}</span>
                </button>
              </div>

              {/* Model Input */}
              <div className="input-field-container">
                <input
                  id="form-model"
                  type="text"
                  className="input-field-control"
                  placeholder="Введите имя модели или выберите из списка ниже..."
                  value={formModel}
                  onChange={(e) => {
                    setFormModel(e.target.value)
                    setFormError(null)
                  }}
                  spellCheck={false}
                />
              </div>

              {/* Router Models List (Pick 1 model from list) */}
              {fetchedModels.length > 0 && (
                <div className="router-models-picker-box">
                  <div className="models-search-bar">
                    <Search size={13} className="search-icon" />
                    <input
                      type="text"
                      className="search-input"
                      placeholder={`Поиск среди ${fetchedModels.length} моделей...`}
                      value={modelSearchQuery}
                      onChange={(e) => setModelSearchQuery(e.target.value)}
                    />
                    {modelSearchQuery && (
                      <button
                        type="button"
                        className="clear-search-btn"
                        onClick={() => setModelSearchQuery('')}
                      >
                        ✕
                      </button>
                    )}
                  </div>

                  <div className="models-scroll-list custom-scrollbar">
                    {filteredModels.length > 0 ? (
                      filteredModels.map((m) => {
                        const isSelected = formModel === m
                        const isEmbeddingCandidate = /embed|bge|nomic|ada/i.test(m)
                        const isVectorSelected = formEmbeddingModel === m

                        return (
                          <div
                            key={m}
                            className={`model-picker-item ${isSelected ? 'selected' : ''}`}
                            onClick={() => setFormModel(m)}
                          >
                            <div className="model-item-title-col">
                              <span className="model-name-text">{m}</span>
                              {isEmbeddingCandidate && (
                                <span className="model-embed-tag">Embedding</span>
                              )}
                            </div>
                            <div className="model-item-actions-row">
                              {isEmbeddingCandidate && (
                                <button
                                  type="button"
                                  className={`model-set-vector-btn ${isVectorSelected && enableEmbedding ? 'active' : ''}`}
                                  onClick={(e) => {
                                    e.stopPropagation()
                                    if (isVectorSelected && enableEmbedding) {
                                      setFormEmbeddingModel('')
                                      setEnableEmbedding(false)
                                    } else {
                                      setFormEmbeddingModel(m)
                                      setEnableEmbedding(true)
                                    }
                                  }}
                                  title={isVectorSelected && enableEmbedding ? 'Отключить векторную модель' : 'Выбрать как модель векторного поиска'}
                                >
                                  {isVectorSelected && enableEmbedding ? 'Векторная ✓' : '+ Вектор'}
                                </button>
                              )}
                              {isSelected ? (
                                <CheckCircle2 size={16} className="model-selected-icon" />
                              ) : (
                                <div className="model-radio-circle"></div>
                              )}
                            </div>
                          </div>
                        )
                      })
                    ) : (
                      <div className="no-models-found">Модель не найдена по запросу</div>
                    )}
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="key-required-notice-box">
              <KeyRound size={15} className="notice-icon" />
              <span>Введите API ключ выше, чтобы загрузить и выбрать доступные модели</span>
            </div>
          )}

          {/* 4.5. Fast Model (Watchdog, Summaries, Titles) */}
          <div className="models-input-block">
            <div className="input-label-row">
              <label htmlFor="form-fast-model" className="input-label-title">
                Быстрая модель (Fast Model)
              </label>
              {formFastModel && (
                <button
                  type="button"
                  className="input-subtle-action"
                  onClick={() => setFormFastModel('')}
                  title="Использовать основную модель"
                >
                  Сбросить на основную
                </button>
              )}
            </div>

            {/* Quick Preset Chips for Fast Models - only shown when real fast models exist */}
            {(() => {
              const fastCandidates = fetchedModels
                .filter((m) => /flash|mini|haiku|turbo|small|8b|7b|3b|1b/i.test(m) && !/embed|bge|nomic|ada/i.test(m) && m !== formModel)
                .slice(0, 5)

              if (fastCandidates.length === 0) return null

              return (
                <div className="embedding-preset-chips-row">
                  <span className="embedding-chips-title">Из роутера:</span>
                  {fastCandidates.map((fastPreset) => (
                    <button
                      key={fastPreset}
                      type="button"
                      className={`embedding-chip-btn ${formFastModel === fastPreset ? 'active' : ''}`}
                      onClick={() => setFormFastModel(formFastModel === fastPreset ? '' : fastPreset)}
                    >
                      <span>{fastPreset}</span>
                      {formFastModel === fastPreset && <Check size={11} />}
                    </button>
                  ))}
                </div>
              )
            })()}

            <div className="input-field-container">
              <input
                id="form-fast-model"
                type="text"
                className="input-field-control"
                placeholder={formModel ? `По умолчанию: ${formModel}` : 'Оставьте пустым для использования основной модели'}
                value={formFastModel}
                onChange={(e) => setFormFastModel(e.target.value)}
                spellCheck={false}
              />
            </div>
            <p className="field-hint-caption" style={{ marginTop: '6px', fontSize: '11px', color: 'rgba(255, 255, 255, 0.45)' }}>
              Используется для фоновых проверок, сторожа и резюме. Если не указана — совпадает с основной.
            </p>
          </div>

          {/* 5. Embedding / Vector Model Selection */}
          <div className="models-input-block">
            <div className="input-label-row">
              <label className="input-label-title" htmlFor="form-embedding-model">
                Модель вектора (Embeddings)
              </label>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span style={{ fontSize: '11px', color: enableEmbedding ? '#10b981' : 'rgba(255, 255, 255, 0.4)' }}>
                  {enableEmbedding ? 'Включена' : 'Выключена'}
                </span>
                <label className="smooth-toggle-switch" title={enableEmbedding ? 'Выключить векторную модель' : 'Включить векторную модель'}>
                  <input
                    type="checkbox"
                    checked={enableEmbedding}
                    onChange={(e) => {
                      const next = e.target.checked
                      setEnableEmbedding(next)
                      if (next && !formEmbeddingModel) {
                        const embCandidate = fetchedModels.find((m) => /embed|bge|nomic|ada/i.test(m))
                        setFormEmbeddingModel(embCandidate || currentPreset.defaultEmbeddingModel || 'text-embedding-3-small')
                      }
                    }}
                  />
                  <span className="toggle-thumb"></span>
                </label>
              </div>
            </div>

            {!enableEmbedding ? (
              <p className="field-hint-caption" style={{ margin: '4px 0 0 0', fontSize: '11px', color: 'rgba(255, 255, 255, 0.45)' }}>
                Отключено — поиск по навыкам и памяти работает через быстрый лексический поиск без запросов к эмбеддингам.
              </p>
            ) : (
              <>
                {/* Quick Preset Chips from router or preset */}
                {(() => {
                  const routerEmbCandidates = fetchedModels.filter((m) => /embed|bge|nomic|ada/i.test(m))
                  const listToShow = routerEmbCandidates.length > 0
                    ? routerEmbCandidates.slice(0, 4)
                    : (currentPreset.recommendedEmbeddingModels || [])
                  if (listToShow.length === 0) return null

                  return (
                    <div className="embedding-preset-chips-row">
                      <span className="embedding-chips-title">{routerEmbCandidates.length > 0 ? 'Из роутера:' : 'Рекомендации:'}</span>
                      {listToShow.map((embModel) => (
                        <button
                          key={embModel}
                          type="button"
                          className={`embedding-chip-btn ${formEmbeddingModel === embModel ? 'active' : ''}`}
                          onClick={() => setFormEmbeddingModel(formEmbeddingModel === embModel ? '' : embModel)}
                        >
                          <span>{embModel}</span>
                          {formEmbeddingModel === embModel && <Check size={11} />}
                        </button>
                      ))}
                      {formEmbeddingModel && (
                        <button
                          type="button"
                          className="embedding-chip-btn clear-chip"
                          onClick={() => setFormEmbeddingModel('')}
                          title="Очистить"
                        >
                          <span>✕ Очистить</span>
                        </button>
                      )}
                    </div>
                  )
                })()}

                {/* Embedding Model Input */}
                <div className="input-field-container">
                  <input
                    id="form-embedding-model"
                    type="text"
                    className="input-field-control"
                    placeholder={currentPreset.defaultEmbeddingModel || 'text-embedding-3-small / nomic-embed-text / bge-m3'}
                    value={formEmbeddingModel}
                    onChange={(e) => setFormEmbeddingModel(e.target.value)}
                    spellCheck={false}
                  />
                </div>

                {/* Optional Custom Base URL for embeddings */}
                <div className="embedding-custom-endpoint-wrap">
                  <button
                    type="button"
                    className="embedding-advanced-toggle-btn"
                    onClick={() => setShowEmbeddingAdvanced(!showEmbeddingAdvanced)}
                  >
                    <span>{showEmbeddingAdvanced ? '− Скрыть отдельный Base URL эмбеддингов' : '+ Указать отдельный Base URL для эмбеддингов'}</span>
                  </button>
                  {showEmbeddingAdvanced && (
                    <div className="input-field-container sub-input">
                      <input
                        type="text"
                        className="input-field-control"
                        placeholder="https://api.openai.com/v1 (если отличается от основного Base URL)"
                        value={formEmbeddingBaseUrl}
                        onChange={(e) => setFormEmbeddingBaseUrl(e.target.value)}
                        spellCheck={false}
                      />
                    </div>
                  )}
                </div>
              </>
            )}
          </div>

          {/* 6. Inference Parameters (Context Window, Temperature, Max Tokens) */}
          <div className="models-input-block inference-block">
            <div className="input-label-row">
              <label className="input-label-title" style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <Sliders size={13} style={{ color: '#38bdf8' }} />
                <span>Параметры инференса</span>
              </label>
              <button
                type="button"
                className="embedding-advanced-toggle-btn"
                style={{ padding: 0, margin: 0 }}
                onClick={() => setShowInferenceAdvanced(!showInferenceAdvanced)}
              >
                <span>{showInferenceAdvanced ? '− Скрыть параметры' : '+ Настроить параметры'}</span>
              </button>
            </div>

            {showInferenceAdvanced && (
              <div className="inference-controls-surface">
                {/* 6.1 Context Window */}
                <div className="inference-field-card">
                  <div className="inference-field-header">
                    <span className="inference-field-label">
                      Размер контекста (Context Length / num_ctx)
                    </span>
                    <span className="inference-value-badge ctx-badge">
                      {formContextLength ? `${Math.round(formContextLength / 1024)}K (${formContextLength.toLocaleString()} токенов)` : 'По умолчанию'}
                    </span>
                  </div>

                  {/* Preset chips */}
                  <div className="embedding-preset-chips-row">
                    {[
                      { label: '8K', value: 8192 },
                      { label: '16K', value: 16384 },
                      { label: '32K (реком.)', value: 32768 },
                      { label: '64K', value: 65536 },
                      { label: '128K', value: 131072 }
                    ].map((chip) => (
                      <button
                        key={chip.value}
                        type="button"
                        className={`embedding-chip-btn ${formContextLength === chip.value ? 'active' : ''}`}
                        onClick={() => setFormContextLength(chip.value)}
                      >
                        <span>{chip.label}</span>
                        {formContextLength === chip.value && <Check size={11} />}
                      </button>
                    ))}
                  </div>

                  <div className="input-field-container">
                    <input
                      type="number"
                      min={1024}
                      max={524288}
                      step={1024}
                      className="input-field-control"
                      placeholder="32768"
                      value={formContextLength === 0 ? '' : formContextLength}
                      onChange={(e) => {
                        const val = e.target.value
                        if (val === '') {
                          setFormContextLength(0)
                        } else {
                          const num = parseInt(val, 10)
                          if (!isNaN(num)) setFormContextLength(num)
                        }
                      }}
                      onBlur={() => {
                        if (!formContextLength || formContextLength < 1024) {
                          setFormContextLength(32768)
                        }
                      }}
                    />
                  </div>
                  <p className="field-hint-caption" style={{ marginTop: '5px', fontSize: '11px', color: 'rgba(255, 255, 255, 0.45)' }}>
                    Для Ollama, LM Studio, vLLM и локальных/кастомных серверов определяет объем памяти под системный промпт и диалог.
                  </p>
                </div>

                {/* 6.2 Temperature & Max Tokens row */}
                <div className="inference-dual-row">
                  {/* Temperature Card */}
                  <div className="inference-field-card">
                    <div className="inference-field-header">
                      <span className="inference-field-label">Температура</span>
                      <div className="temperature-input-wrap">
                        <input
                          type="number"
                          min={0}
                          max={2}
                          step={0.05}
                          className="temperature-number-input"
                          value={formTemperature}
                          onChange={(e) => {
                            const v = parseFloat(e.target.value)
                            if (!isNaN(v)) setFormTemperature(Math.max(0, Math.min(2.0, v)))
                          }}
                        />
                      </div>
                    </div>

                    {/* Temperature Preset Chips */}
                    <div className="embedding-preset-chips-row">
                      {[
                        { label: '0.2 Код', value: 0.2 },
                        { label: '0.7 Баланс', value: 0.7 },
                        { label: '1.0 Творчество', value: 1.0 }
                      ].map((chip) => (
                        <button
                          key={chip.value}
                          type="button"
                          className={`embedding-chip-btn ${Math.abs(formTemperature - chip.value) < 0.01 ? 'active' : ''}`}
                          onClick={() => setFormTemperature(chip.value)}
                        >
                          <span>{chip.label}</span>
                          {Math.abs(formTemperature - chip.value) < 0.01 && <Check size={11} />}
                        </button>
                      ))}
                    </div>

                    <div className="range-slider-container">
                      <input
                        type="range"
                        min="0"
                        max="2.0"
                        step="0.05"
                        className="temperature-slider-control"
                        value={formTemperature}
                        onChange={(e) => setFormTemperature(parseFloat(e.target.value))}
                      />
                    </div>
                    <p className="field-hint-caption" style={{ marginTop: '2px', fontSize: '11px', color: 'rgba(255, 255, 255, 0.45)' }}>
                      0.0–0.2 точный код и инструменты, 0.7 оптимальный баланс, 1.0+ генерация идей.
                    </p>
                  </div>

                  {/* Max Tokens Card */}
                  <div className="inference-field-card">
                    <div className="inference-field-header">
                      <span className="inference-field-label">Макс. токенов ответа</span>
                      <span className="inference-value-badge tokens-badge">
                        {formMaxTokens ? `${formMaxTokens.toLocaleString()} токенов` : 'По умолчанию'}
                      </span>
                    </div>

                    {/* Max tokens Preset Chips */}
                    <div className="embedding-preset-chips-row">
                      {[
                        { label: '2K', value: 2048 },
                        { label: '4K', value: 4096 },
                        { label: '8K', value: 8192 },
                        { label: '16K', value: 16384 },
                        { label: '32K', value: 32768 }
                      ].map((chip) => (
                        <button
                          key={chip.value}
                          type="button"
                          className={`embedding-chip-btn ${formMaxTokens === chip.value ? 'active' : ''}`}
                          onClick={() => setFormMaxTokens(chip.value)}
                        >
                          <span>{chip.label}</span>
                          {formMaxTokens === chip.value && <Check size={11} />}
                        </button>
                      ))}
                    </div>

                    <div className="input-field-container">
                      <input
                        type="number"
                        min={256}
                        max={131072}
                        step={512}
                        className="input-field-control"
                        placeholder="4096"
                        value={formMaxTokens === 0 ? '' : formMaxTokens}
                        onChange={(e) => {
                          const val = e.target.value
                          if (val === '') {
                            setFormMaxTokens(0)
                          } else {
                            const num = parseInt(val, 10)
                            if (!isNaN(num)) setFormMaxTokens(num)
                          }
                        }}
                        onBlur={() => {
                          if (!formMaxTokens || formMaxTokens < 256) {
                            setFormMaxTokens(4096)
                          }
                        }}
                      />
                    </div>
                    <p className="field-hint-caption" style={{ marginTop: '5px', fontSize: '11px', color: 'rgba(255, 255, 255, 0.45)' }}>
                      Максимальное количество токенов за один ответ (max_tokens / num_predict).
                    </p>
                  </div>
                </div>
              </div>
            )}
          </div>

          {formError && <div className="models-error-alert">{formError}</div>}
        </div>

        {/* Actions Footer */}
        <div className="models-detail-footer">
          <div className="footer-left-actions">
            <button
              type="button"
              className="models-test-action-btn"
              onClick={() => testConnection(formBaseUrl, formApiKey, formModel, formPreset)}
              disabled={testResult.status === 'testing' || !isKeyReady}
            >
              <Activity size={14} className={testResult.status === 'testing' ? 'spin-icon' : ''} />
              <span>{testResult.status === 'testing' ? 'Проверка...' : 'Проверить связь'}</span>
            </button>

            {testResult.status === 'success' && (
              <span className="models-ping-pill success">
                <Check size={12} strokeWidth={3} />
                <span>{testResult.latencyMs ? `${testResult.latencyMs}ms` : 'Работает'}</span>
              </span>
            )}
            {testResult.status === 'error' && (
              <span className="models-ping-pill error">
                <span>✕ {testResult.message}</span>
              </span>
            )}
          </div>

          <div className="footer-right-actions">
            {editingId && connectedProviders.length > 1 && (
              <button
                type="button"
                className="models-delete-btn"
                onClick={handleDeleteProvider}
                title="Удалить провайдера"
              >
                <Trash2 size={14} />
                <span>Удалить</span>
              </button>
            )}

            <button
              type="button"
              className="models-primary-save-btn"
              onClick={handleSaveAndConnect}
              disabled={!isKeyReady}
            >
              <span>{editingId ? 'Сохранить изменения' : 'Сохранить и подключить'}</span>
            </button>
          </div>
        </div>
      </div>
    )
  }

  // ════════════════════════════════════════════════════════════════════════
  // 2. MAIN VIEW: CONNECTED & DISCOVERED PROVIDERS LIST
  // ════════════════════════════════════════════════════════════════════════
  // Filter discovered local services that are not connected yet
  const unconnectedDiscovered = discoveredServices.filter(
    (ds) => !connectedProviders.some((cp) => cp.providerId === ds.providerId || cp.baseUrl.includes(String(ds.port)))
  )

  const hasAnyProviders = connectedProviders.length > 0 || unconnectedDiscovered.length > 0

  return (
    <div className="models-settings-root">
      {/* Top Header */}
      <div className="models-header-bar">
        <div className="header-titles-col">
          <h1 className="models-title-text">Конфигурация</h1>
          <p className="models-desc-text">
            Провайдеры ИИ, поиск в интернете и параметры системы
          </p>
        </div>

        <button
          type="button"
          className="models-add-btn"
          onClick={openConnectScreen}
        >
          <Plus size={14} strokeWidth={2.4} />
          <span>Подключить провайдера</span>
        </button>
      </div>

      {/* Providers List */}
      <div className="models-providers-list">
        {hasAnyProviders ? (
          <>
            {/* 1. Already Connected Providers */}
            {connectedProviders.map((prov) => {
              const isActive = prov.id === activeProvider?.id

              return (
                <div
                  key={prov.id}
                  className={`models-provider-card ${isActive ? 'active' : ''}`}
                  onClick={() => setActiveProvider(prov.id)}
                >
                  <div className="card-left-section">
                    <div className="provider-logo-box">
                      {getProviderIcon(prov.providerId)}
                    </div>
                    <div className="provider-info-block">
                      <div className="provider-title-row">
                        <span className="provider-main-name">{prov.name}</span>
                        {isActive ? (
                          <span className="status-badge-active">
                            <span className="status-dot"></span>
                            <span>Активен</span>
                          </span>
                        ) : (
                          <span className="status-badge-ready">Подключен</span>
                        )}
                      </div>
                      <span className="provider-model-subtitle">
                        {prov.model ? `Модель: ${prov.model}` : 'Модель не выбрана'}
                        {prov.fastModel && prov.fastModel !== prov.model ? ` • Fast: ${prov.fastModel}` : ''}
                        {prov.contextLength ? ` • ${Math.round(prov.contextLength / 1024)}k ctx` : ''}
                      </span>
                    </div>
                  </div>

                  <div className="card-right-section">
                    {isActive ? (
                      <button
                        type="button"
                        className="action-pill-btn active"
                        onClick={(e) => {
                          e.stopPropagation()
                          openEditScreen(prov)
                        }}
                      >
                        <span>Настроить</span>
                        <ChevronRight size={14} />
                      </button>
                    ) : (
                      <button
                        type="button"
                        className="action-pill-btn"
                        onClick={(e) => {
                          e.stopPropagation()
                          setActiveProvider(prov.id)
                        }}
                      >
                        Выбрать
                      </button>
                    )}
                  </div>
                </div>
              )
            })}

            {/* 2. Discovered Unconnected Local Providers (Ollama / LM Studio) */}
            {unconnectedDiscovered.map((service) => (
              <div
                key={service.providerId}
                className="models-provider-card discovered"
                onClick={() => quickConnectLocalService(service)}
              >
                <div className="card-left-section">
                  <div className="provider-logo-box">
                    {getProviderIcon(service.providerId)}
                  </div>
                  <div className="provider-info-block">
                    <div className="provider-title-row">
                      <span className="provider-main-name">{service.name}</span>
                      <span className="status-badge-active">
                        <span className="status-dot"></span>
                        <span>Порт {service.port} онлайн</span>
                      </span>
                    </div>
                    <span className="provider-model-subtitle">
                      {service.models.length > 0
                        ? `Обнаружено моделей: ${service.models.length} (${service.models.slice(0, 2).join(', ')}${service.models.length > 2 ? '...' : ''})`
                        : 'Локальный сервер запущен'}
                    </span>
                  </div>
                </div>

                <div className="card-right-section">
                  <button
                    type="button"
                    className="models-quick-setup-btn"
                    onClick={(e) => {
                      e.stopPropagation()
                      quickConnectLocalService(service)
                    }}
                  >
                    <Zap size={13} fill="currentColor" />
                    <span>Быстро поставить</span>
                  </button>
                </div>
              </div>
            ))}
          </>
        ) : (
          <div className="empty-providers-card">
            <div className="empty-providers-icon">
              <Bot size={24} />
            </div>
            <div className="empty-providers-info">
              <span className="empty-providers-title">Нет подключенных провайдеров</span>
              <span className="empty-providers-desc">
                Подключите ваш первый сервис (OpenAI, DeepSeek, Claude, Ollama и др.) для работы с ИИ
              </span>
            </div>
            <button
              type="button"
              className="models-primary-save-btn"
              onClick={openConnectScreen}
            >
              <Plus size={14} strokeWidth={2.4} />
              <span>Подключить</span>
            </button>
          </div>
        )}
      </div>

      {/* Workspace & Settings */}
      <div className="models-options-surface">
        {/* Workspace Directory */}
        <div className="option-row-item">
          <div className="option-info-box">
            <span className="option-headline">Папка проектов</span>
            <span className="option-subline">Основная рабочая директория</span>
          </div>
          <div className="workspace-controls-wrap">
            <span className="workspace-dir-badge">{config.baseDir || 'd:/zipplyprojects'}</span>
            <button
              type="button"
              className="workspace-browse-btn"
              onClick={selectDirectory}
            >
              <FolderOpen size={13} />
              <span>Обзор</span>
            </button>
          </div>
        </div>

        {/* Web Search Engine Selector */}
        <div className="option-row-item search-setting-row">
          <div className="option-info-box">
            <div className="option-title-with-badge">
              <span className="option-headline">Поиск в интернете</span>
              <span className="web-search-badge">Web Search</span>
            </div>
            <span className="option-subline">
              {config.searchProvider === 'tavily'
                ? 'Tavily API — поиск для ИИ (требуется API-ключ tavily.com)'
                : 'DuckDuckGo — встроенный бесплатный поиск без ключей и ограничений'}
            </span>
          </div>
          <div className="search-control-container">
            <div className="search-engine-toggle-group">
              <button
                type="button"
                className={`search-engine-pill ${(!config.searchProvider || config.searchProvider === 'duckduckgo') ? 'active' : ''}`}
                onClick={() => updateField('searchProvider', 'duckduckgo')}
              >
                DuckDuckGo
              </button>
              <button
                type="button"
                className={`search-engine-pill ${config.searchProvider === 'tavily' ? 'active' : ''}`}
                onClick={() => updateField('searchProvider', 'tavily')}
              >
                Tavily API
              </button>
            </div>

            {config.searchProvider === 'tavily' ? (
              <div className="tavily-key-input-wrapper">
                <div className="tavily-input-inner">
                  <input
                    type={showTavilyKey ? 'text' : 'password'}
                    className="tavily-key-input"
                    placeholder="tvly-..."
                    value={config.tavilyKey || ''}
                    onChange={(e) => updateField('tavilyKey', e.target.value)}
                    spellCheck={false}
                  />
                  <button
                    type="button"
                    className="tavily-eye-btn"
                    onClick={() => setShowTavilyKey(!showTavilyKey)}
                    title={showTavilyKey ? 'Скрыть ключ' : 'Показать ключ'}
                  >
                    {showTavilyKey ? <EyeOff size={14} /> : <Eye size={14} />}
                  </button>
                </div>
              </div>
            ) : (
              <div className="search-free-status-badge">
                <CheckCircle2 size={13} className="search-free-icon" />
                <span>Бесплатно • Без ключа</span>
              </div>
            )}
          </div>
        </div>

        {/* Vector Embeddings & Semantic Search Setting */}
        <div className="option-row-item embedding-setting-row">
          <div className="option-info-box">
            <div className="option-title-with-badge">
              <span className="option-headline">Векторный поиск и память (Embeddings)</span>
              <span className="vector-search-badge">Vector Model</span>
            </div>
            <span className="option-subline">
              {config.embeddingModel
                ? `Активна: ${config.embeddingModel} (семантический поиск включен)`
                : 'Отключено — используется быстрый лексический поиск (без запросов к роутеру).'}
            </span>
          </div>
          <div className="embedding-global-control">
            <label className="smooth-toggle-switch" title={config.embeddingModel ? 'Отключить векторный поиск' : 'Включить векторный поиск'}>
              <input
                type="checkbox"
                checked={Boolean(config.embeddingModel)}
                onChange={(e) => {
                  if (!e.target.checked) {
                    updateField('embeddingModel', '')
                  } else {
                    updateField('embeddingModel', activeProvider?.embeddingModel || 'text-embedding-3-small')
                  }
                }}
              />
              <span className="toggle-thumb"></span>
            </label>
            {Boolean(config.embeddingModel) && (
              <div className="input-field-container compact" style={{ minWidth: '220px' }}>
                <input
                  type="text"
                  className="input-field-control"
                  placeholder="text-embedding-3-small"
                  value={config.embeddingModel || ''}
                  onChange={(e) => updateField('embeddingModel', e.target.value)}
                  spellCheck={false}
                />
              </div>
            )}
          </div>
        </div>

        {/* Streaming Toggle */}
        <div className="option-row-item">
          <div className="option-info-box">
            <span className="option-headline">Потоковый вывод (Streaming)</span>
            <span className="option-subline">Отображать ответ в реальном времени</span>
          </div>
          <label className="smooth-toggle-switch">
            <input
              type="checkbox"
              checked={config.stream}
              onChange={(e) => updateField('stream', e.target.checked)}
            />
            <span className="toggle-thumb"></span>
          </label>
        </div>
      </div>
    </div>
  )
}

export default ModelsSettings
