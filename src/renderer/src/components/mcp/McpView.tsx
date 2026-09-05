import React, { useState, useEffect, useCallback, useMemo } from 'react'
import {
  Server,
  Plus,
  RefreshCw,
  ArrowDownToLine,
  ArrowUpFromLine,
  Search,
  Check,
  AlertCircle,
  Play,
  Square,
  Edit3,
  Trash2,
  ChevronDown,
  ChevronUp,
  Terminal,
  Globe,
  Key,
  Boxes,
  Zap,
  Sparkles
} from 'lucide-react'
import { McpServerConfig, McpServerItemUI, McpServerStatus } from '../../types/mcp'
import { McpServerModal } from './McpServerModal'
import { McpImportModal } from './McpImportModal'
import './McpView.css'

export const McpView: React.FC = () => {
  const [servers, setServers] = useState<McpServerItemUI[]>([])
  const [searchQuery, setSearchQuery] = useState('')
  const [filterStatus, setFilterStatus] = useState<'all' | 'connected' | 'disconnected' | 'error'>('all')
  const [isLoading, setIsLoading] = useState(true)
  const [expandedServerIds, setExpandedServerIds] = useState<Set<string>>(new Set())
  const [testingServerId, setTestingServerId] = useState<string | null>(null)
  const [editingServer, setEditingServer] = useState<McpServerItemUI | null>(null)
  const [isEditorModalOpen, setIsEditorModalOpen] = useState(false)
  const [isImportModalOpen, setIsImportModalOpen] = useState(false)
  const [toastMessage, setToastMessage] = useState<string | null>(null)

  const showToast = (msg: string): void => {
    setToastMessage(msg)
    setTimeout(() => {
      setToastMessage((prev) => (prev === msg ? null : prev))
    }, 2400)
  }

  const loadServers = useCallback(async (): Promise<void> => {
    try {
      setIsLoading(true)
      if (window.api?.mcp?.getAllServers) {
        const data = await window.api.mcp.getAllServers()
        setServers(data || [])
      }
    } catch (err) {
      console.error('Failed to load MCP servers:', err)
      showToast('Ошибка при загрузке MCP серверов')
    } finally {
      setIsLoading(false)
    }
  }, [])

  useEffect(() => {
    loadServers()
  }, [loadServers])

  const handleToggleExpand = (id: string): void => {
    setExpandedServerIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) {
        next.delete(id)
      } else {
        next.add(id)
      }
      return next
    })
  }

  const handleToggleServer = async (server: McpServerItemUI): Promise<void> => {
    try {
      const targetEnabled = server.enabled === false ? true : false
      const res = await window.api?.mcp?.toggleServer(server.id, targetEnabled)
      if (res?.success) {
        showToast(targetEnabled ? `Сервер «${server.name}» запущен` : `Сервер «${server.name}» остановлен`)
        await loadServers()
      } else {
        showToast(res?.error || 'Ошибка переключения')
      }
    } catch (err: any) {
      showToast(err?.message || 'Ошибка переключения')
    }
  }

  const handleTestConnection = async (server: McpServerItemUI): Promise<void> => {
    try {
      setTestingServerId(server.id)
      const res = await window.api?.mcp?.testConnection(server.id)
      if (res?.success) {
        const toolsCount = res.server?.tools?.length || 0
        const latency = res.latencyMs ? ` (${res.latencyMs}ms)` : ''
        showToast(`Подключено! Обнаружено ${toolsCount} инструментов${latency}`)
        await loadServers()
      } else {
        showToast(res?.error || 'Ошибка при подключении к серверу')
        await loadServers()
      }
    } catch (err: any) {
      showToast(err?.message || 'Ошибка подключения')
    } finally {
      setTestingServerId(null)
    }
  }

  const handleDelete = async (server: McpServerItemUI): Promise<void> => {
    if (!window.confirm(`Удалить MCP сервер «${server.name}»?`)) {
      return
    }
    try {
      const res = await window.api?.mcp?.deleteServer(server.id)
      if (res?.success) {
        showToast(`Сервер «${server.name}» удален`)
        await loadServers()
      } else {
        showToast(res?.error || 'Не удалось удалить сервер')
      }
    } catch (err: any) {
      showToast(err?.message || 'Ошибка при удалении')
    }
  }

  const handleExport = async (): Promise<void> => {
    try {
      const res = await window.api?.mcp?.exportConfig()
      if (res?.success && res.json) {
        navigator.clipboard.writeText(res.json)
        showToast('JSON конфигурация скопирована в буфер обмена')
      } else {
        showToast(res?.error || 'Ошибка экспорта')
      }
    } catch {
      showToast('Не удалось экспортировать конфигурацию')
    }
  }

  const handleSaveServer = async (data: Partial<McpServerConfig> & { name: string }): Promise<void> => {
    const res = await window.api?.mcp?.saveServer(data)
    if (res?.success) {
      showToast(`Сервер «${data.name}» сохранен`)
      await loadServers()
    } else {
      throw new Error(res?.error || 'Не удалось сохранить сервер')
    }
  }

  const connectedCount = useMemo(
    () => servers.filter((s) => s.status === 'connected' && s.enabled !== false).length,
    [servers]
  )
  const disconnectedCount = useMemo(
    () => servers.filter((s) => !s.enabled || s.status === 'disconnected').length,
    [servers]
  )
  const totalToolsCount = useMemo(
    () => servers.reduce((acc, s) => acc + (s.tools?.length || 0), 0),
    [servers]
  )

  const filteredServers = useMemo(() => {
    return servers.filter((s) => {
      if (filterStatus === 'connected' && (s.status !== 'connected' || s.enabled === false)) return false
      if (filterStatus === 'disconnected' && s.enabled !== false && s.status !== 'disconnected') return false
      if (filterStatus === 'error' && s.status !== 'error') return false

      if (!searchQuery.trim()) return true
      const q = searchQuery.toLowerCase().trim()
      return (
        s.name.toLowerCase().includes(q) ||
        (s.description && s.description.toLowerCase().includes(q)) ||
        (s.command && s.command.toLowerCase().includes(q)) ||
        (s.url && s.url.toLowerCase().includes(q)) ||
        (s.tools && s.tools.some((t) => t.name.toLowerCase().includes(q) || (t.description && t.description.toLowerCase().includes(q))))
      )
    })
  }, [servers, filterStatus, searchQuery])

  const renderStatusBadge = (status: McpServerStatus, isEnabled: boolean) => {
    if (!isEnabled) {
      return (
        <span className="mcp-status-badge disabled">
          <Square size={8} />
          <span>Отключен</span>
        </span>
      )
    }

    switch (status) {
      case 'connected':
        return (
          <span className="mcp-status-badge connected">
            <span className="mcp-live-dot" />
            <span>В сети</span>
          </span>
        )
      case 'connecting':
        return (
          <span className="mcp-status-badge connecting">
            <RefreshCw size={10} className="spinning" />
            <span>Подключение...</span>
          </span>
        )
      case 'error':
        return (
          <span className="mcp-status-badge error">
            <AlertCircle size={10} />
            <span>Ошибка</span>
          </span>
        )
      case 'disconnected':
      default:
        return (
          <span className="mcp-status-badge stopped">
            <Square size={8} />
            <span>Остановлен</span>
          </span>
        )
    }
  }

  const renderServerCard = (server: McpServerItemUI): JSX.Element => {
    const isExpanded = expandedServerIds.has(server.id)
    const isTesting = testingServerId === server.id
    const isEnabled = server.enabled !== false
    const tools = server.tools || []
    const envKeys = Object.keys(server.env || {})

    return (
      <div
        key={server.id}
        className={`mcp-card ${!isEnabled ? 'is-disabled' : ''} ${server.status === 'error' ? 'has-error' : ''}`}
      >
        {/* Top row */}
        <div className="mcp-card-top-row">
          <div className="mcp-card-identity">
            <div className="mcp-server-icon">
              {server.transport === 'sse' || server.transport === 'http' ? (
                <Globe size={16} />
              ) : (
                <Terminal size={16} />
              )}
            </div>

            <div className="mcp-title-wrap">
              <div className="mcp-title-heading-row">
                <h4 className="mcp-server-name">{server.name}</h4>
                {renderStatusBadge(server.status, isEnabled)}
                <span className="mcp-transport-pill">{server.transport}</span>
                {tools.length > 0 && (
                  <span className="mcp-tools-badge">
                    <Zap size={10} />
                    <span>{tools.length} инстр.</span>
                  </span>
                )}
              </div>

              {server.description && (
                <p className="mcp-server-desc">{server.description}</p>
              )}
            </div>
          </div>

          <div className="mcp-card-top-actions">
            <button
              className={`mcp-power-btn ${isEnabled ? 'active' : 'inactive'}`}
              onClick={() => handleToggleServer(server)}
              title={isEnabled ? 'Остановить сервер' : 'Запустить сервер'}
            >
              {isEnabled ? <Square size={12} /> : <Play size={12} />}
              <span>{isEnabled ? 'Вкл' : 'Выкл'}</span>
            </button>
          </div>
        </div>

        {/* Command or URL Info Banner */}
        <div className="mcp-command-banner">
          {server.transport === 'stdio' ? (
            <div className="mcp-cmd-snippet">
              <span className="mcp-cmd-prompt">$</span>
              <code>
                {server.command} {server.args ? server.args.join(' ') : ''}
              </code>
            </div>
          ) : (
            <div className="mcp-cmd-snippet">
              <span className="mcp-cmd-prompt">URL</span>
              <code>{server.url}</code>
            </div>
          )}

          {envKeys.length > 0 && (
            <div className="mcp-env-tags-row">
              <Key size={11} color="#8e8e93" />
              {envKeys.map((k) => (
                <span key={k} className="mcp-env-mini-pill" title={`${k}=••••••••`}>
                  {k}
                </span>
              ))}
            </div>
          )}
        </div>

        {/* Error message snippet if error */}
        {server.error && isEnabled && (
          <div className="mcp-error-snippet">
            <AlertCircle size={13} />
            <span>{server.error}</span>
          </div>
        )}

        {/* Discovered Tools Accordion */}
        {tools.length > 0 && (
          <div className="mcp-tools-drawer">
            <button
              type="button"
              className="mcp-tools-toggle-btn"
              onClick={() => handleToggleExpand(server.id)}
            >
              <div className="mcp-tools-toggle-left">
                <Boxes size={13} />
                <span>Доступные инструменты ({tools.length})</span>
              </div>
              {isExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
            </button>

            {isExpanded && (
              <div className="mcp-tools-list">
                {tools.map((t) => (
                  <div key={t.name} className="mcp-tool-item">
                    <div className="mcp-tool-header">
                      <code className="mcp-tool-name">{t.name}</code>
                      {t.inputSchema?.properties && Object.keys(t.inputSchema.properties).length > 0 && (
                        <span className="mcp-tool-params-count">
                          {Object.keys(t.inputSchema.properties).length} параметров
                        </span>
                      )}
                    </div>
                    {t.description && (
                      <p className="mcp-tool-desc">{t.description}</p>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Card Footer Actions */}
        <div className="mcp-card-footer">
          <div className="mcp-footer-status">
            {server.lastConnectedAt && (
              <span className="mcp-last-seen">
                Последнее подключение: {new Date(server.lastConnectedAt).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}
              </span>
            )}
          </div>

          <div className="mcp-footer-btn-group">
            <button
              type="button"
              className="mcp-ghost-action-btn"
              onClick={() => handleTestConnection(server)}
              disabled={isTesting}
              title="Проверить подключение и обновить инструменты"
            >
              <RefreshCw size={12} className={isTesting ? 'spinning' : ''} />
              <span>{isTesting ? 'Проверка...' : 'Переподключить'}</span>
            </button>

            <button
              type="button"
              className="mcp-ghost-action-btn"
              onClick={() => {
                setEditingServer(server)
                setIsEditorModalOpen(true)
              }}
              title="Редактировать параметры сервера"
            >
              <Edit3 size={12} />
              <span>Изменить</span>
            </button>

            <button
              type="button"
              className="mcp-ghost-action-btn danger"
              onClick={() => handleDelete(server)}
              title="Удалить сервер"
            >
              <Trash2 size={13} />
            </button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="mcp-view-container">
      {/* Toast Notification */}
      {toastMessage && (
        <div className="mcp-toast">
          <Check size={14} />
          <span>{toastMessage}</span>
        </div>
      )}

      <div className="mcp-wrapper">
        {/* Header */}
        <div className="mcp-header">
          <div className="mcp-header-left">
            <h2 className="mcp-page-title">MCP Серверы</h2>
            <p className="mcp-page-subtitle">
              Управление серверами инструментов и контекста Model Context Protocol
            </p>
          </div>

          <div className="mcp-header-right">
            <button
              className="mcp-header-btn"
              onClick={handleExport}
              title="Экспорт конфигурации в буфер обмена"
              disabled={servers.length === 0}
            >
              <ArrowUpFromLine size={14} />
              <span>Экспорт</span>
            </button>

            <button
              className="mcp-header-btn"
              onClick={() => setIsImportModalOpen(true)}
              title="Импорт из Claude Desktop или JSON"
            >
              <ArrowDownToLine size={14} />
              <span>Импорт</span>
            </button>

            <button
              className="mcp-icon-btn"
              onClick={loadServers}
              title="Обновить состояние серверов"
              disabled={isLoading}
            >
              <RefreshCw size={14} className={isLoading ? 'spinning' : ''} />
            </button>

            <button
              className="mcp-create-btn"
              onClick={() => {
                setEditingServer(null)
                setIsEditorModalOpen(true)
              }}
            >
              <Plus size={15} />
              <span>Новый сервер</span>
            </button>
          </div>
        </div>

        {/* Subtle AI Auto-Connect Tip */}
        <div className="mcp-subtle-tip">
          <Sparkles size={14} className="mcp-subtle-tip-icon" />
          <div className="mcp-subtle-tip-content">
            <span className="mcp-subtle-tip-title">Автоматическое подключение:</span>
            <span className="mcp-subtle-tip-desc">
              Вы можете просто написать в чате: <code>Создай и подключи MCP сервер для...</code> — и ИИ всё сделает сама.
            </span>
          </div>
        </div>

        {/* Top Metric Cards */}
        <div className="mcp-metrics-grid">
          <div
            className={`mcp-stat-box ${filterStatus === 'all' ? 'active' : ''}`}
            onClick={() => setFilterStatus('all')}
          >
            <span className="mcp-stat-number">{servers.length}</span>
            <span className="mcp-stat-label">Всего серверов</span>
          </div>

          <div
            className={`mcp-stat-box ${filterStatus === 'connected' ? 'active' : ''}`}
            onClick={() => setFilterStatus('connected')}
          >
            <span className="mcp-stat-number connected">{connectedCount}</span>
            <span className="mcp-stat-label">В сети (Connected)</span>
          </div>

          <div
            className="mcp-stat-box"
            style={{ cursor: 'default' }}
          >
            <span className="mcp-stat-number tools">{totalToolsCount}</span>
            <span className="mcp-stat-label">MCP инструментов</span>
          </div>

          <div
            className={`mcp-stat-box ${filterStatus === 'disconnected' ? 'active' : ''}`}
            onClick={() => setFilterStatus('disconnected')}
          >
            <span className="mcp-stat-number">{disconnectedCount}</span>
            <span className="mcp-stat-label">Остановлено</span>
          </div>
        </div>

        {/* Controls: Search and Filter Tabs */}
        <div className="mcp-controls-row">
          <div className="mcp-search-field">
            <Search size={15} className="mcp-search-icon" />
            <input
              type="text"
              placeholder="Поиск по серверам, командам или инструментам..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
            {searchQuery && (
              <button className="mcp-search-reset" onClick={() => setSearchQuery('')}>
                ×
              </button>
            )}
          </div>

          <div className="mcp-segmented-tabs">
            <button
              className={`mcp-tab-pill ${filterStatus === 'all' ? 'active' : ''}`}
              onClick={() => setFilterStatus('all')}
            >
              Все ({servers.length})
            </button>
            <button
              className={`mcp-tab-pill ${filterStatus === 'connected' ? 'active' : ''}`}
              onClick={() => setFilterStatus('connected')}
            >
              В сети ({connectedCount})
            </button>
            <button
              className={`mcp-tab-pill ${filterStatus === 'disconnected' ? 'active' : ''}`}
              onClick={() => setFilterStatus('disconnected')}
            >
              Остановлены ({disconnectedCount})
            </button>
          </div>
        </div>

        {/* Server Cards List */}
        <div className="mcp-list-section">
          {isLoading ? (
            <div className="mcp-loading-block">
              <RefreshCw size={20} className="spinning" />
              <span>Загрузка MCP серверов...</span>
            </div>
          ) : filteredServers.length === 0 ? (
            <div className="mcp-empty-block">
              <Server size={34} strokeWidth={1.5} color="#71717a" />
              <h4>{searchQuery ? 'Серверы не найдены' : 'Нет подключенных MCP серверов'}</h4>
              <p>
                {searchQuery
                  ? 'По вашему запросу ничего не найдено.'
                  : 'Подключите внешние инструменты (базы данных, GitHub, API, CLI) через протокол MCP. Также вы можете просто попросить ассистента в диалоге: «Создай и подключи MCP сервер для SQLite» — и ИИ всё сделает самостоятельно.'}
              </p>
              {!searchQuery && (
                <div className="mcp-empty-actions">
                  <button
                    className="mcp-empty-btn"
                    onClick={() => {
                      setEditingServer(null)
                      setIsEditorModalOpen(true)
                    }}
                  >
                    <Plus size={14} />
                    <span>Добавить сервер</span>
                  </button>
                  <button
                    className="mcp-empty-btn ghost"
                    onClick={() => setIsImportModalOpen(true)}
                  >
                    <ArrowDownToLine size={14} />
                    <span>Импорт JSON</span>
                  </button>
                </div>
              )}
            </div>
          ) : (
            filteredServers.map(renderServerCard)
          )}
        </div>
      </div>

      {/* Editor Modal */}
      <McpServerModal
        isOpen={isEditorModalOpen}
        server={editingServer}
        onClose={() => {
          setIsEditorModalOpen(false)
          setEditingServer(null)
        }}
        onSave={handleSaveServer}
      />

      {/* Import Modal */}
      <McpImportModal
        isOpen={isImportModalOpen}
        onClose={() => setIsImportModalOpen(false)}
        onSuccess={(count) => {
          showToast(`Успешно импортировано серверов: ${count}`)
          loadServers()
        }}
      />
    </div>
  )
}

export default McpView
