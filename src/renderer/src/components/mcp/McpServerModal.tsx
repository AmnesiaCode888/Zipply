import React, { useState, useEffect } from 'react'
import { X, Plus, Trash2, Code2, Sliders, Server, AlertCircle } from 'lucide-react'
import { McpServerConfig, McpServerItemUI, McpTransport } from '../../types/mcp'
import './McpServerModal.css'

interface McpServerModalProps {
  isOpen: boolean
  server: McpServerItemUI | null
  onClose: () => void
  onSave: (data: Partial<McpServerConfig> & { name: string }) => Promise<void>
}

interface EnvPair {
  id: string
  key: string
  value: string
}

export const McpServerModal: React.FC<McpServerModalProps> = ({
  isOpen,
  server,
  onClose,
  onSave
}) => {
  const [activeTab, setActiveTab] = useState<'form' | 'json'>('form')
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [transport, setTransport] = useState<McpTransport>('stdio')
  const [command, setCommand] = useState('')
  const [argsStr, setArgsStr] = useState('')
  const [envPairs, setEnvPairs] = useState<EnvPair[]>([])
  const [url, setUrl] = useState('')
  const [cwd, setCwd] = useState('')
  const [enabled, setEnabled] = useState(true)
  const [jsonText, setJsonText] = useState('')
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const [isSaving, setIsSaving] = useState(false)

  useEffect(() => {
    if (isOpen) {
      setErrorMsg(null)
      if (server) {
        setName(server.name)
        setDescription(server.description || '')
        setTransport(server.transport || 'stdio')
        setCommand(server.command || '')
        setArgsStr(server.args ? server.args.join(' ') : '')
        setUrl(server.url || '')
        setCwd(server.cwd || '')
        setEnabled(server.enabled !== false)

        const envs: EnvPair[] = Object.entries(server.env || {}).map(([k, v]) => ({
          id: Math.random().toString(36).slice(2),
          key: k,
          value: v
        }))
        setEnvPairs(envs)

        const jsonRep = {
          command: server.command,
          args: server.args || [],
          env: server.env || {},
          url: server.url,
          transport: server.transport
        }
        setJsonText(JSON.stringify(jsonRep, null, 2))
      } else {
        setName('')
        setDescription('')
        setTransport('stdio')
        setCommand('npx')
        setArgsStr('')
        setUrl('')
        setCwd('')
        setEnvPairs([])
        setEnabled(true)
        setJsonText('{\n  "command": "npx",\n  "args": [],\n  "env": {}\n}')
      }
      setActiveTab('form')
    }
  }, [isOpen, server])

  if (!isOpen) return null

  const handleAddEnvPair = (): void => {
    setEnvPairs((prev) => [
      ...prev,
      { id: Math.random().toString(36).slice(2), key: '', value: '' }
    ])
  }

  const handleRemoveEnvPair = (id: string): void => {
    setEnvPairs((prev) => prev.filter((p) => p.id !== id))
  }

  const handleEnvChange = (id: string, field: 'key' | 'value', val: string): void => {
    setEnvPairs((prev) =>
      prev.map((p) => (p.id === id ? { ...p, [field]: val } : p))
    )
  }

  const handleParseArgs = (str: string): string[] => {
    // Smart split handling quoted arguments
    const matches = str.match(/(?:[^\s"']+|"[^"]*"|'[^']*')+/g) || []
    return matches.map((m) => m.replace(/^['"]|['"]$/g, ''))
  }

  const handleSyncJsonToForm = (): boolean => {
    try {
      const parsed = JSON.parse(jsonText)
      if (parsed.command) setCommand(parsed.command)
      if (Array.isArray(parsed.args)) setArgsStr(parsed.args.join(' '))
      if (parsed.url) setUrl(parsed.url)
      if (parsed.transport) setTransport(parsed.transport)
      if (parsed.env && typeof parsed.env === 'object') {
        const envs: EnvPair[] = Object.entries(parsed.env).map(([k, v]) => ({
          id: Math.random().toString(36).slice(2),
          key: k,
          value: String(v)
        }))
        setEnvPairs(envs)
      }
      setErrorMsg(null)
      return true
    } catch (err: any) {
      setErrorMsg(`Ошибка JSON: ${err.message}`)
      return false
    }
  }

  const handleTabChange = (tab: 'form' | 'json'): void => {
    if (tab === 'form' && activeTab === 'json') {
      const ok = handleSyncJsonToForm()
      if (!ok) return
    } else if (tab === 'json' && activeTab === 'form') {
      const envObj: Record<string, string> = {}
      for (const p of envPairs) {
        if (p.key.trim()) envObj[p.key.trim()] = p.value
      }
      const jsonRep = {
        command,
        args: handleParseArgs(argsStr),
        env: envObj,
        url: transport !== 'stdio' ? url : undefined,
        transport: transport !== 'stdio' ? transport : undefined
      }
      setJsonText(JSON.stringify(jsonRep, null, 2))
    }
    setActiveTab(tab)
  }

  const handleSubmit = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault()
    setErrorMsg(null)

    let finalCommand = command.trim()
    let finalArgs = handleParseArgs(argsStr)
    let finalEnv: Record<string, string> = {}
    let finalUrl = url.trim()
    let finalTransport = transport

    if (activeTab === 'json') {
      try {
        const parsed = JSON.parse(jsonText)
        finalCommand = parsed.command || ''
        finalArgs = Array.isArray(parsed.args) ? parsed.args : []
        finalEnv = parsed.env || {}
        finalUrl = parsed.url || ''
        finalTransport = parsed.transport || (finalUrl ? 'sse' : 'stdio')
      } catch (err: any) {
        setErrorMsg(`Неверный JSON: ${err.message}`)
        return
      }
    } else {
      for (const p of envPairs) {
        if (p.key.trim()) {
          finalEnv[p.key.trim()] = p.value
        }
      }
    }

    const cleanName = name.trim().toLowerCase().replace(/[^a-z0-9_-]/g, '_')
    if (!cleanName) {
      setErrorMsg('Укажите уникальный идентификатор сервера (имя)')
      return
    }

    if (finalTransport === 'stdio' && !finalCommand) {
      setErrorMsg('Укажите команду запуска (например, npx, uvx, node)')
      return
    }

    if (finalTransport === 'sse' && !finalUrl) {
      setErrorMsg('Укажите URL для подключения по SSE/HTTP')
      return
    }

    try {
      setIsSaving(true)
      await onSave({
        id: server?.id,
        name: cleanName,
        description: description.trim(),
        transport: finalTransport,
        command: finalCommand,
        args: finalArgs,
        env: finalEnv,
        url: finalUrl || undefined,
        cwd: cwd.trim() || undefined,
        enabled
      })
      onClose()
    } catch (err: any) {
      setErrorMsg(err.message || 'Ошибка сохранения')
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <div className="mcp-modal-overlay" onClick={onClose}>
      <div className="mcp-modal-container" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="mcp-modal-header">
          <div className="mcp-modal-title-group">
            <div className="mcp-modal-icon-badge">
              <Server size={17} />
            </div>
            <div>
              <h3 className="mcp-modal-title">
                {server ? 'Настройка MCP сервера' : 'Новый MCP сервер'}
              </h3>
              <p className="mcp-modal-subtitle">
                Подключение внешних инструментов контекста через stdio или SSE
              </p>
            </div>
          </div>

          <button type="button" className="mcp-modal-close-btn" onClick={onClose} title="Закрыть">
            <X size={16} />
          </button>
        </div>

        {/* Tab Switcher */}
        <div className="mcp-modal-mode-switch">
          <button
            type="button"
            className={`mcp-mode-pill ${activeTab === 'form' ? 'active' : ''}`}
            onClick={() => handleTabChange('form')}
          >
            <Sliders size={13} />
            <span>Параметры</span>
          </button>
          <button
            type="button"
            className={`mcp-mode-pill ${activeTab === 'json' ? 'active' : ''}`}
            onClick={() => handleTabChange('json')}
          >
            <Code2 size={13} />
            <span>JSON конфигурация</span>
          </button>
        </div>

        {/* Form Body */}
        <form onSubmit={handleSubmit} className="mcp-modal-body">
          {errorMsg && (
            <div className="mcp-modal-error-banner">
              <AlertCircle size={14} />
              <span>{errorMsg}</span>
            </div>
          )}

          {activeTab === 'form' ? (
            <>
              <div className="mcp-form-row">
                <div className="mcp-form-field flex-1">
                  <label>Идентификатор (Name)</label>
                  <input
                    type="text"
                    placeholder="e.g. sqlite, github, puppeteer, filesystem"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    required
                    autoFocus
                    spellCheck={false}
                  />
                </div>

                <div className="mcp-form-field" style={{ width: '150px' }}>
                  <label>Тип протокола</label>
                  <select
                    value={transport}
                    onChange={(e) => setTransport(e.target.value as McpTransport)}
                  >
                    <option value="stdio">stdio (процесс)</option>
                    <option value="sse">SSE / HTTP</option>
                  </select>
                </div>
              </div>

              <div className="mcp-form-field">
                <label>Описание (опционально)</label>
                <input
                  type="text"
                  placeholder="Краткое описание возможностей сервера"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                />
              </div>

              {transport === 'stdio' ? (
                <>
                  <div className="mcp-form-row">
                    <div className="mcp-form-field" style={{ width: '130px' }}>
                      <label>Команда</label>
                      <input
                        type="text"
                        placeholder="npx / uvx / node"
                        value={command}
                        onChange={(e) => setCommand(e.target.value)}
                        required
                        spellCheck={false}
                      />
                    </div>
                    <div className="mcp-form-field flex-1">
                      <label>Аргументы запуска (Args)</label>
                      <input
                        type="text"
                        placeholder="-y @modelcontextprotocol/server-sqlite --db-path ./mydb.sqlite"
                        value={argsStr}
                        onChange={(e) => setArgsStr(e.target.value)}
                        spellCheck={false}
                      />
                    </div>
                  </div>

                  <div className="mcp-form-field">
                    <label>Рабочая папка (CWD, опционально)</label>
                    <input
                      type="text"
                      placeholder="C:\Projects\my-app (по умолчанию текущая)"
                      value={cwd}
                      onChange={(e) => setCwd(e.target.value)}
                      spellCheck={false}
                    />
                  </div>
                </>
              ) : (
                <div className="mcp-form-field">
                  <label>URL сервера (SSE / HTTP Endpoint)</label>
                  <input
                    type="url"
                    placeholder="http://localhost:8000/sse"
                    value={url}
                    onChange={(e) => setUrl(e.target.value)}
                    required
                    spellCheck={false}
                  />
                </div>
              )}

              {/* Environment Variables Section */}
              <div className="mcp-env-section">
                <div className="mcp-env-header">
                  <label>Переменные окружения (Environment Variables)</label>
                  <button
                    type="button"
                    className="mcp-add-env-btn"
                    onClick={handleAddEnvPair}
                  >
                    <Plus size={12} />
                    <span>Добавить</span>
                  </button>
                </div>

                {envPairs.length === 0 ? (
                  <div className="mcp-env-empty">
                    <span>Нет переменных окружения (опционально)</span>
                  </div>
                ) : (
                  <div className="mcp-env-list">
                    {envPairs.map((pair) => (
                      <div key={pair.id} className="mcp-env-item-row">
                        <input
                          type="text"
                          placeholder="KEY (e.g. GITHUB_TOKEN)"
                          value={pair.key}
                          onChange={(e) => handleEnvChange(pair.id, 'key', e.target.value)}
                          className="env-key-inp"
                          spellCheck={false}
                        />
                        <input
                          type="text"
                          placeholder="VALUE"
                          value={pair.value}
                          onChange={(e) => handleEnvChange(pair.id, 'value', e.target.value)}
                          className="env-val-inp"
                          spellCheck={false}
                        />
                        <button
                          type="button"
                          className="mcp-env-del-btn"
                          onClick={() => handleRemoveEnvPair(pair.id)}
                          title="Удалить"
                        >
                          <Trash2 size={13} />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Active Switch */}
              <div className="mcp-toggle-row">
                <label className="mcp-toggle-label">
                  <input
                    type="checkbox"
                    checked={enabled}
                    onChange={(e) => setEnabled(e.target.checked)}
                  />
                  <span>Включить сервер сразу после сохранения</span>
                </label>
              </div>
            </>
          ) : (
            /* JSON View */
            <div className="mcp-json-editor-pane">
              <div className="mcp-form-field">
                <label>Идентификатор (Name)</label>
                <input
                  type="text"
                  placeholder="sqlite, github, etc."
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  required
                  spellCheck={false}
                />
              </div>

              <div className="mcp-form-field">
                <label>JSON Конфигурация</label>
                <textarea
                  className="mcp-json-textarea"
                  value={jsonText}
                  onChange={(e) => setJsonText(e.target.value)}
                  rows={9}
                  spellCheck={false}
                  placeholder={`{\n  "command": "npx",\n  "args": ["-y", "@modelcontextprotocol/server-sqlite"],\n  "env": {}\n}`}
                />
              </div>
            </div>
          )}

          {/* Footer Actions */}
          <div className="mcp-modal-footer">
            <button
              type="button"
              className="mcp-modal-cancel-btn"
              onClick={onClose}
              disabled={isSaving}
            >
              Отмена
            </button>
            <button
              type="submit"
              className="mcp-modal-submit-btn"
              disabled={isSaving}
            >
              {isSaving ? 'Сохранение...' : server ? 'Сохранить изменения' : 'Добавить сервер'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
