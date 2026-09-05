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
  KeyRound
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
  const [formEmbeddingModel, setFormEmbeddingModel] = useState('')
  const [formEmbeddingBaseUrl, setFormEmbeddingBaseUrl] = useState('')
  const [showEmbeddingAdvanced, setShowEmbeddingAdvanced] = useState(false)
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
    setFormEmbeddingModel(preset.defaultEmbeddingModel || '')
    setFormEmbeddingBaseUrl('')
    setShowEmbeddingAdvanced(false)
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
    setFormEmbeddingModel(prov.embeddingModel || '')
    setFormEmbeddingBaseUrl(prov.embeddingBaseUrl || '')
    setShowEmbeddingAdvanced(Boolean(prov.embeddingBaseUrl))
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
        // If no embedding model chosen yet and router provides one, auto-select it
        if (!formEmbeddingModel) {
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

    const resolvedFastModel = formFastModel.trim() || formModel.trim()

    if (editingId) {
      updateConnectedProvider(editingId, {
        providerId: formPreset,
        name: formName || currentPreset.name,
        baseUrl: formBaseUrl.trim(),
        apiKey: formApiKey.trim(),
        model: formModel.trim(),
        fastModel: resolvedFastModel,
        embeddingModel: formEmbeddingModel.trim() || undefined,
        embeddingBaseUrl: formEmbeddingBaseUrl.trim() || undefined,
        models: fetchedModels.length > 0 ? fetchedModels : [formModel.trim()],
        requiresKey: currentPreset.requiresKey
      })
    } else {
      addConnectedProvider({
        providerId: formPreset,
        name: formName || currentPreset.name,
        baseUrl: formBaseUrl.trim(),
        apiKey: formApiKey.trim(),
        model: formModel.trim(),
        fastModel: resolvedFastModel,
        embeddingModel: formEmbeddingModel.trim() || undefined,
        embeddingBaseUrl: formEmbeddingBaseUrl.trim() || undefined,
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
    const isKeyReady = !currentPreset.requiresKey || formApiKey.trim().length > 0

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
            {editingId ? `Настройка ${formName}` : 'Подключение провайдера'}
          </h1>
          <p className="models-desc-text">
            Выберите сервис, укажите ключ и выберите модель из списка
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
                <optgroup label="Свой сервер">
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

          {/* 2. API Key (Only if required) */}
          {currentPreset.requiresKey ? (
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
                                  className={`model-set-vector-btn ${isVectorSelected ? 'active' : ''}`}
                                  onClick={(e) => {
                                    e.stopPropagation()
                                    setFormEmbeddingModel(m)
                                  }}
                                  title="Выбрать как модель векторного поиска"
                                >
                                  {isVectorSelected ? 'Векторная ✓' : '+ Вектор'}
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
              <div className="input-label-with-badge">
                <label htmlFor="form-fast-model" className="input-label-title">
                  Быстрая модель (Fast Model)
                </label>
                <span className="vector-model-pill">Сторож и фоновые задачи</span>
              </div>
            </div>

            {/* Quick Preset Chips for Fast Models */}
            <div className="embedding-preset-chips-row">
              <span className="embedding-chips-title">Быстрый выбор:</span>
              {[
                'deepseek/deepseek-v4-flash-0731',
                'inception/mercury-2.5-preview'
              ].map((fastPreset) => (
                <button
                  key={fastPreset}
                  type="button"
                  className={`embedding-chip-btn ${formFastModel === fastPreset ? 'active' : ''}`}
                  onClick={() => setFormFastModel(fastPreset)}
                >
                  <span>{fastPreset}</span>
                  {formFastModel === fastPreset && <Check size={11} />}
                </button>
              ))}
              {formFastModel && (
                <button
                  type="button"
                  className="embedding-chip-btn"
                  onClick={() => setFormFastModel('')}
                  title="Использовать основную модель"
                >
                  <span>Основная ({formModel || 'по умолчанию'})</span>
                </button>
              )}
            </div>

            <div className="input-field-container">
              <input
                id="form-fast-model"
                type="text"
                className="input-field-control"
                placeholder={formModel ? `По умолчанию: ${formModel}` : 'Например: deepseek/deepseek-v4-flash-0731 или inception/mercury-2.5-preview'}
                value={formFastModel}
                onChange={(e) => setFormFastModel(e.target.value)}
                spellCheck={false}
              />
            </div>
            <p className="field-hint-caption" style={{ marginTop: '6px', fontSize: '11px', color: 'rgba(255, 255, 255, 0.45)' }}>
              Используется для Watchdog, генерации заголовков и резюме сессий. Можно ввести любую модель или выбрать из рекомендаций. Если не указана, используется основная.
            </p>
          </div>

          {/* 5. Embedding / Vector Model Selection */}
          <div className="models-input-block">
            <div className="input-label-row">
              <div className="input-label-with-badge">
                <label htmlFor="form-embedding-model" className="input-label-title">
                  Модель вектора (Embeddings)
                </label>
                <span className="vector-model-pill">Векторный поиск по навыкам</span>
              </div>
            </div>

            {/* Quick Preset Chips */}
            {currentPreset.recommendedEmbeddingModels && currentPreset.recommendedEmbeddingModels.length > 0 && (
              <div className="embedding-preset-chips-row">
                <span className="embedding-chips-title">Рекомендации:</span>
                {currentPreset.recommendedEmbeddingModels.map((embModel) => (
                  <button
                    key={embModel}
                    type="button"
                    className={`embedding-chip-btn ${formEmbeddingModel === embModel ? 'active' : ''}`}
                    onClick={() => setFormEmbeddingModel(embModel)}
                  >
                    <span>{embModel}</span>
                    {formEmbeddingModel === embModel && <Check size={11} />}
                  </button>
                ))}
              </div>
            )}

            {/* Embedding Model Input */}
            <div className="input-field-container">
              <input
                id="form-embedding-model"
                type="text"
                className="input-field-control"
                placeholder={currentPreset.defaultEmbeddingModel || 'Например: text-embedding-3-small или nomic-embed-text'}
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
                ? `Активная модель: ${config.embeddingModel} (семантический поиск по навыкам и памяти активен)`
                : 'Модель не указана — используется лексический поиск. Укажите text-embedding-3-small, nomic-embed-text или bge-m3 для включения векторного поиска.'}
            </span>
          </div>
          <div className="embedding-global-control">
            <div className="input-field-container compact">
              <input
                type="text"
                className="input-field-control"
                placeholder="text-embedding-3-small / nomic-embed-text"
                value={config.embeddingModel || ''}
                onChange={(e) => updateField('embeddingModel', e.target.value)}
                spellCheck={false}
              />
            </div>
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
