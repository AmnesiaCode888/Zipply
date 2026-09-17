import React, { useState, useEffect, useCallback } from 'react'
import {
  Bot,
  Play,
  Square,
  KeyRound,
  Eye,
  EyeOff,
  Shield,
  FolderGit2,
  CheckCircle2,
  AlertCircle,
  Loader2,
  ExternalLink,
  HelpCircle,
  RefreshCw,
  Copy,
  Check,
  Cpu,
  Search,
  X
} from 'lucide-react'
import { TelegramConfig, TelegramBotStatus } from '../../types/settings'
import './AccessSettings.css'

export const AccessSettings: React.FC = () => {
  const [config, setConfig] = useState<TelegramConfig>({
    token: '',
    enabled: false,
    allowedUsers: [],
    autoStart: false,
    defaultWorkspace: ''
  })
  const [status, setStatus] = useState<TelegramBotStatus>({ status: 'stopped' })
  const [showToken, setShowToken] = useState(false)
  const [allowedUsersInput, setAllowedUsersInput] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [isTesting, setIsTesting] = useState(false)
  const [testResult, setTestResult] = useState<{ success?: boolean; message?: string } | null>(null)
  const [projects, setProjects] = useState<Array<{ name: string; path: string }>>([])
  const [copiedBotLink, setCopiedBotLink] = useState(false)
  const [saveSuccess, setSaveSuccess] = useState(false)
  const [availableModels, setAvailableModels] = useState<Array<{ id: string; name: string }>>([])
  const [selectedModel, setSelectedModel] = useState<string>('')
  const [isChangingModel, setIsChangingModel] = useState(false)
  const [modelSearchQuery, setModelSearchQuery] = useState('')
  const [projectSearchQuery, setProjectSearchQuery] = useState('')

  // Load config & status on mount
  const loadData = useCallback(async () => {
    try {
      if (window.api?.telegram) {
        const [cfg, st] = await Promise.all([
          window.api.telegram.getConfig(),
          window.api.telegram.getStatus()
        ])
        if (cfg) {
          setConfig(cfg)
          setAllowedUsersInput(Array.isArray(cfg.allowedUsers) ? cfg.allowedUsers.join(', ') : '')
        }
        if (st) {
          setStatus(st)
          if (st.currentModel) {
            setSelectedModel(st.currentModel)
          }
        }
        if (window.api.telegram.getModels) {
          const modelsList = await window.api.telegram.getModels()
          if (Array.isArray(modelsList) && modelsList.length > 0) {
            setAvailableModels(modelsList)
          }
        }
      }
      if (window.api?.projects) {
        const projList = await window.api.projects.list()
        if (Array.isArray(projList)) {
          setProjects(projList)
        }
      }
    } catch (err) {
      console.warn('[AccessSettings] Failed to load telegram config:', err)
    }
  }, [])

  useEffect(() => {
    loadData()

    // Subscribe to bot status events
    let unsubscribe: (() => void) | undefined
    if (window.api?.telegram?.onStatus) {
      unsubscribe = window.api.telegram.onStatus((newStatus) => {
        setStatus(newStatus)
        if (newStatus.currentModel) {
          setSelectedModel(newStatus.currentModel)
        }
        if (newStatus.status === 'running') {
          setConfig((prev) => ({ ...prev, enabled: true }))
        } else if (newStatus.status === 'stopped') {
          setConfig((prev) => ({ ...prev, enabled: false }))
        }
      })
    }

    return () => {
      if (unsubscribe) unsubscribe()
    }
  }, [loadData])

  // Save changes
  const handleSaveConfig = async (patch: Partial<TelegramConfig>) => {
    const updated = { ...config, ...patch }
    setConfig(updated)
    try {
      if (window.api?.telegram) {
        await window.api.telegram.saveConfig(patch)
        setSaveSuccess(true)
        setTimeout(() => setSaveSuccess(false), 2000)
      }
    } catch (err) {
      console.error('[AccessSettings] Error saving config:', err)
    }
  }

  // Handle model switch
  const handleModelChange = async (newModel: string) => {
    setSelectedModel(newModel)
    if (window.api?.telegram?.setModel) {
      setIsChangingModel(true)
      try {
        await window.api.telegram.setModel(newModel)
        setSaveSuccess(true)
        setTimeout(() => setSaveSuccess(false), 2000)
      } catch (err) {
        console.error('[AccessSettings] Error setting model:', err)
      } finally {
        setIsChangingModel(false)
      }
    }
  }

  // Handle allowed users change
  const handleAllowedUsersBlur = () => {
    const list = allowedUsersInput
      .split(/[,;\s]+/)
      .map((u) => u.trim())
      .filter(Boolean)
    handleSaveConfig({ allowedUsers: list })
  }

  // Toggle Bot Run
  const handleToggleBot = async () => {
    if (!window.api?.telegram) return
    setIsLoading(true)
    setTestResult(null)
    try {
      if (status.status === 'running') {
        await window.api.telegram.stop()
        setStatus({ status: 'stopped' })
        setConfig((prev) => ({ ...prev, enabled: false }))
      } else {
        // Save latest values first
        const list = allowedUsersInput
          .split(/[,;\s]+/)
          .map((u) => u.trim())
          .filter(Boolean)
        await window.api.telegram.saveConfig({
          token: config.token.trim(),
          allowedUsers: list,
          autoStart: config.autoStart,
          defaultWorkspace: config.defaultWorkspace
        })
        const newStatus = await window.api.telegram.start()
        setStatus(newStatus)
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      setStatus({ status: 'error', error: msg })
    } finally {
      setIsLoading(false)
    }
  }

  // Test Token
  const handleTestToken = async () => {
    if (!window.api?.telegram) return
    if (!config.token.trim()) {
      setTestResult({ success: false, message: 'Введите токен бота перед проверкой.' })
      return
    }

    setIsTesting(true)
    setTestResult(null)
    try {
      const res = await window.api.telegram.testToken(config.token.trim())
      if (res.valid && res.botInfo) {
        setTestResult({
          success: true,
          message: `Токен действителен! Бот: @${res.botInfo.username} (${res.botInfo.firstName})`
        })
      } else {
        setTestResult({
          success: false,
          message: res.error || 'Не удалось авторизовать бота с указанным токеном.'
        })
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      setTestResult({ success: false, message: msg })
    } finally {
      setIsTesting(false)
    }
  }

  const handleCopyBotLink = () => {
    if (status.botInfo?.username) {
      navigator.clipboard.writeText(`https://t.me/${status.botInfo.username}`)
      setCopiedBotLink(true)
      setTimeout(() => setCopiedBotLink(false), 2000)
    }
  }

  const filteredModels = availableModels.filter((m) => {
    if (!modelSearchQuery.trim()) return true
    const q = modelSearchQuery.toLowerCase()
    return m.id.toLowerCase().includes(q) || (m.name && m.name.toLowerCase().includes(q))
  })

  // Normal projects first, hidden/dot-folders after
  const normalProjects = projects.filter((p) => !p.name.startsWith('.'))
  const hiddenProjects = projects.filter((p) => p.name.startsWith('.'))
  const sortedProjects = [...normalProjects, ...hiddenProjects]

  const filteredProjects = sortedProjects.filter((p) => {
    if (!projectSearchQuery.trim()) return true
    const q = projectSearchQuery.toLowerCase()
    return p.name.toLowerCase().includes(q) || p.path.toLowerCase().includes(q)
  })

  const isRunning = status.status === 'running'
  const isStarting = status.status === 'starting'

  return (
    <div className="access-settings-root">
      {/* Header Bar */}
      <div className="access-header-bar">
        <div className="header-titles-col">
          <div className="header-title-flex">
            <h1 className="models-title-text">Telegram-бот</h1>
            <span className="appearance-chip-badge">Дистанционный доступ</span>
          </div>
          <p className="models-desc-text">
            Управляйте компьютером и запускайте задачи в Zipply прямо из Telegram со смартфона
          </p>
        </div>

        <div className="access-header-actions">
          <button
            type="button"
            className={isRunning ? 'btn-secondary-pill' : 'btn-primary-pill'}
            onClick={handleToggleBot}
            disabled={isLoading || isStarting}
          >
            {isLoading || isStarting ? (
              <>
                <Loader2 size={13} className="spin-icon" />
                <span>{isRunning ? 'Остановка...' : 'Запуск...'}</span>
              </>
            ) : isRunning ? (
              <>
                <Square size={13} fill="currentColor" />
                <span>Остановить бота</span>
              </>
            ) : (
              <>
                <Play size={13} fill="currentColor" />
                <span>Включить бота</span>
              </>
            )}
          </button>
        </div>
      </div>

      {/* Main Bot Hero Card */}
      <div className="access-hero-card">
        <div className="hero-left">
          <div className="hero-icon-box">
            <Bot size={20} strokeWidth={1.8} />
          </div>
          <div className="hero-info">
            <div className="hero-title-row">
              <span className="hero-name">
                {status.botInfo ? status.botInfo.firstName : 'Zipply Remote Bot'}
              </span>
              <span
                className={`status-badge ${
                  isRunning ? 'online' : status.status === 'error' ? 'error' : ''
                }`}
              >
                <span className="status-dot" />
                <span>
                  {isRunning
                    ? 'В сети'
                    : isStarting
                      ? 'Подключение...'
                      : status.status === 'error'
                        ? 'Ошибка'
                        : 'Остановлен'}
                </span>
              </span>
            </div>

            <div className="hero-meta">
              {status.botInfo ? (
                <button
                  type="button"
                  className="hero-link"
                  onClick={handleCopyBotLink}
                  title="Скопировать ссылку на бота"
                >
                  <span>@{status.botInfo.username}</span>
                  {copiedBotLink ? <Check size={11} /> : <Copy size={11} />}
                </button>
              ) : (
                <span className="hero-meta-item">Бот не запущен</span>
              )}

              <span className="hero-sep">•</span>
              <span className="hero-meta-item">Long Polling</span>

              {selectedModel && (
                <>
                  <span className="hero-sep">•</span>
                  <span className="hero-meta-item" title="Активная ИИ-модель">
                    {selectedModel}
                  </span>
                </>
              )}
            </div>
          </div>
        </div>

        <div className="hero-right">
          {isRunning && (
            <span className="status-badge online">
              <span className="status-dot" />
              <span>Хостится локально</span>
            </span>
          )}
        </div>
      </div>

      {status.status === 'error' && status.error && (
        <div
          className="access-feedback-chip error"
          style={{ width: '100%', boxSizing: 'border-box', padding: '10px 14px' }}
        >
          <AlertCircle size={15} style={{ flexShrink: 0 }} />
          <span>{status.error}</span>
        </div>
      )}

      {/* SECTION 1: Connection & Token */}
      <div className="access-section">
        <div className="access-section-head">
          <div className="access-section-title">Подключение и токен</div>
        </div>

        <div className="access-card">
          {/* Bot Token Input */}
          <div className="access-field-group">
            <div className="access-field-header">
              <label className="access-label" htmlFor="tg-token-input">
                <KeyRound size={13} strokeWidth={1.8} />
                <span>Токен Telegram-бота</span>
              </label>
              <a
                href="https://t.me/BotFather"
                target="_blank"
                rel="noreferrer"
                className="access-sub-link"
              >
                <span>Получить в @BotFather</span>
                <ExternalLink size={11} />
              </a>
            </div>

            <div className="access-input-row">
              <input
                id="tg-token-input"
                type={showToken ? 'text' : 'password'}
                className="access-input access-font-mono"
                placeholder="123456789:ABCdefGHIjklMNOpqrsTUVwxyz..."
                value={config.token}
                onChange={(e) => {
                  const val = e.target.value
                  setConfig((prev) => ({ ...prev, token: val }))
                }}
                onBlur={() => handleSaveConfig({ token: config.token.trim() })}
              />
              <button
                type="button"
                className="btn-icon-pill"
                onClick={() => setShowToken(!showToken)}
                title={showToken ? 'Скрыть токен' : 'Показать токен'}
              >
                {showToken ? <EyeOff size={14} /> : <Eye size={14} />}
              </button>
              <button
                type="button"
                className="btn-secondary-pill"
                onClick={handleTestToken}
                disabled={isTesting || !config.token.trim()}
              >
                {isTesting ? <Loader2 size={13} className="spin-icon" /> : <RefreshCw size={13} />}
                <span>Проверить</span>
              </button>
            </div>

            {testResult && (
              <div className={`access-feedback-chip ${testResult.success ? 'success' : 'error'}`}>
                {testResult.success ? <CheckCircle2 size={13} /> : <AlertCircle size={13} />}
                <span>{testResult.message}</span>
              </div>
            )}
          </div>

          {/* Allowed Users Security */}
          <div className="access-field-group">
            <div className="access-field-header">
              <label className="access-label" htmlFor="tg-allowed-users">
                <Shield size={13} strokeWidth={1.8} />
                <span>Разрешенные Telegram ID / Username</span>
              </label>
              <a
                href="https://t.me/userinfobot"
                target="_blank"
                rel="noreferrer"
                className="access-sub-link"
              >
                <span>Узнать ID в @userinfobot</span>
                <ExternalLink size={11} />
              </a>
            </div>

            <input
              id="tg-allowed-users"
              type="text"
              className="access-input access-font-mono"
              placeholder="123456789, @username"
              value={allowedUsersInput}
              onChange={(e) => setAllowedUsersInput(e.target.value)}
              onBlur={handleAllowedUsersBlur}
            />
            <p className="access-field-desc">
              Только указанные пользователи смогут отдавать команды агенту на вашем компьютере.
            </p>
          </div>
        </div>
      </div>

      {/* SECTION 2: Work Environment & AI Model */}
      <div className="access-section">
        <div className="access-section-head">
          <div className="access-section-title">Рабочее окружение и модель</div>
        </div>

        <div className="access-card">
          {/* Model Selector with Live Filter */}
          <div className="access-field-group">
            <div className="access-field-header">
              <label className="access-label" htmlFor="tg-model-select">
                <Cpu size={13} strokeWidth={1.8} />
                <span>Активная ИИ-модель</span>
              </label>
              {selectedModel && (
                <span className="appearance-chip-badge access-font-mono">
                  {selectedModel}
                </span>
              )}
            </div>

            <div className="access-search-filter-row">
              <div className="access-search-input-wrap">
                <Search size={13} className="search-icon" />
                <input
                  type="text"
                  className="access-search-input"
                  placeholder="Поиск модели (claude, deepseek, gemini, 4o)..."
                  value={modelSearchQuery}
                  onChange={(e) => setModelSearchQuery(e.target.value)}
                />
                {modelSearchQuery && (
                  <button
                    type="button"
                    className="access-search-clear-btn"
                    onClick={() => setModelSearchQuery('')}
                    title="Очистить поиск"
                  >
                    <X size={12} />
                  </button>
                )}
              </div>
              {modelSearchQuery && (
                <span className="access-search-count">
                  {filteredModels.length} из {availableModels.length}
                </span>
              )}
            </div>

            <select
              id="tg-model-select"
              className="access-select"
              value={selectedModel}
              onChange={(e) => handleModelChange(e.target.value)}
              disabled={isChangingModel}
            >
              {filteredModels.length === 0 && selectedModel ? (
                <option value={selectedModel}>{selectedModel}</option>
              ) : null}
              {filteredModels.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name || m.id}
                </option>
              ))}
            </select>
            <p className="access-field-desc">
              Используется для обработки задач с ПК и Telegram. Можно также переключать прямо в боте командами <code>/model</code> или <code>/models</code>.
            </p>
          </div>

          {/* Project Selector with Live Filter */}
          <div className="access-field-group">
            <div className="access-field-header">
              <label className="access-label" htmlFor="tg-project-select">
                <FolderGit2 size={13} strokeWidth={1.8} />
                <span>Рабочая папка по умолчанию (Проект)</span>
              </label>
            </div>

            <div className="access-search-filter-row">
              <div className="access-search-input-wrap">
                <Search size={13} className="search-icon" />
                <input
                  type="text"
                  className="access-search-input"
                  placeholder="Поиск проекта по названию..."
                  value={projectSearchQuery}
                  onChange={(e) => setProjectSearchQuery(e.target.value)}
                />
                {projectSearchQuery && (
                  <button
                    type="button"
                    className="access-search-clear-btn"
                    onClick={() => setProjectSearchQuery('')}
                    title="Очистить поиск"
                  >
                    <X size={12} />
                  </button>
                )}
              </div>
              {projectSearchQuery && (
                <span className="access-search-count">
                  {filteredProjects.length} из {projects.length}
                </span>
              )}
            </div>

            <select
              id="tg-project-select"
              className="access-select"
              value={config.defaultWorkspace || ''}
              onChange={(e) => handleSaveConfig({ defaultWorkspace: e.target.value })}
            >
              <option value="">Папка проектов по умолчанию (ZipplyProjects)</option>
              {filteredProjects.map((p) => (
                <option key={p.path} value={p.path}>
                  {p.name} ({p.path})
                </option>
              ))}
            </select>
            <p className="access-field-desc">
              Папка, в которой агент будет запускать код и редактировать файлы. Можно переключать в боте командой <code>/projects</code>.
            </p>
          </div>
        </div>
      </div>

      {/* SECTION 3: Automation & Sync Switches */}
      <div className="access-section">
        <div className="access-section-head">
          <div className="access-section-title">Автоматизация и синхронизация</div>
        </div>

        <div className="appearance-switches-list">
          {/* Autostart Toggle */}
          <div
            className="appearance-switch-card"
            onClick={() => handleSaveConfig({ autoStart: !config.autoStart })}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => e.key === 'Enter' && handleSaveConfig({ autoStart: !config.autoStart })}
          >
            <div className="switch-text-col">
              <div className="switch-main-title">Автозапуск бота</div>
              <div className="switch-desc-text">
                Включать Telegram-бота в фоновом режиме сразу при запуске Zipply
              </div>
            </div>
            <div className={`clean-switch-track ${config.autoStart ? 'active' : ''}`}>
              <div className="clean-switch-thumb" />
            </div>
          </div>

          {/* Sync with Active PC Chat */}
          <div
            className="appearance-switch-card"
            onClick={() =>
              handleSaveConfig({
                syncWithActiveChat: config.syncWithActiveChat === false ? true : false
              })
            }
            role="button"
            tabIndex={0}
            onKeyDown={(e) =>
              e.key === 'Enter' &&
              handleSaveConfig({
                syncWithActiveChat: config.syncWithActiveChat === false ? true : false
              })
            }
          >
            <div className="switch-text-col">
              <div className="switch-main-title">Синхронизация с активным чатом</div>
              <div className="switch-desc-text">
                Сообщения из Telegram будут дублироваться в открытый диалог на компьютере в реальном времени
              </div>
            </div>
            <div
              className={`clean-switch-track ${
                config.syncWithActiveChat !== false ? 'active' : ''
              }`}
            >
              <div className="clean-switch-thumb" />
            </div>
          </div>

          {/* Desktop Task Completion Notification */}
          <div
            className="appearance-switch-card"
            onClick={() =>
              handleSaveConfig({
                notifyOnDesktopDone: config.notifyOnDesktopDone === false ? true : false
              })
            }
            role="button"
            tabIndex={0}
            onKeyDown={(e) =>
              e.key === 'Enter' &&
              handleSaveConfig({
                notifyOnDesktopDone: config.notifyOnDesktopDone === false ? true : false
              })
            }
          >
            <div className="switch-text-col">
              <div className="switch-main-title">Уведомления о завершении задач</div>
              <div className="switch-desc-text">
                Присылать краткий отчёт в Telegram, когда агент завершил выполнение задачи на компьютере
              </div>
            </div>
            <div
              className={`clean-switch-track ${
                config.notifyOnDesktopDone !== false ? 'active' : ''
              }`}
            >
              <div className="clean-switch-thumb" />
            </div>
          </div>
        </div>
      </div>

      {/* SECTION 4: Minimalist Guide */}
      <div className="access-guide-card">
        <div className="guide-title">
          <HelpCircle size={13} />
          <span>Быстрый старт за 3 шага</span>
        </div>
        <div className="guide-steps">
          <div>
            1. Создайте бота в <a href="https://t.me/BotFather" target="_blank" rel="noreferrer">@BotFather</a> через команду <code>/newbot</code> и скопируйте API токен.
          </div>
          <div>
            2. Вставьте токен и ваш Telegram ID выше, затем нажмите <strong>«Включить бота»</strong>.
          </div>
          <div>
            3. Откройте бота со смартфона, нажмите <code>/start</code> и управляйте Zipply дистанционно.
          </div>
        </div>
      </div>

      {saveSuccess && (
        <div className="access-toast">
          <CheckCircle2 size={14} color="#34D399" />
          <span>Настройки сохранены</span>
        </div>
      )}
    </div>
  )
}

export default AccessSettings
