import React, { useState } from 'react'
import { X, ArrowDownToLine, FileCode, AlertCircle } from 'lucide-react'
import './McpImportModal.css'

interface McpImportModalProps {
  isOpen: boolean
  onClose: () => void
  onSuccess: (count: number) => void
}

export const McpImportModal: React.FC<McpImportModalProps> = ({
  isOpen,
  onClose,
  onSuccess
}) => {
  const [jsonText, setJsonText] = useState('')
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const [isImporting, setIsImporting] = useState(false)

  if (!isOpen) return null

  const handleImport = async (): Promise<void> => {
    setErrorMsg(null)
    const content = jsonText.trim()
    if (!content) {
      setErrorMsg('Вставьте конфигурацию в формате JSON')
      return
    }

    try {
      setIsImporting(true)
      const res = await window.api?.mcp?.importConfig(content)
      if (res?.success) {
        onSuccess(res.count || 0)
        onClose()
      } else {
        setErrorMsg(res?.error || 'Не удалось импортировать конфигурацию')
      }
    } catch (err: any) {
      setErrorMsg(err.message || 'Ошибка импорта')
    } finally {
      setIsImporting(false)
    }
  }

  const handleInsertSample = (): void => {
    const sample = {
      mcpServers: {
        sqlite: {
          command: 'uvx',
          args: ['mcp-server-sqlite', '--db-path', './test.db']
        },
        github: {
          command: 'npx',
          args: ['-y', '@modelcontextprotocol/server-github'],
          env: {
            GITHUB_PERSONAL_ACCESS_TOKEN: '<YOUR_TOKEN>'
          }
        },
        filesystem: {
          command: 'npx',
          args: ['-y', '@modelcontextprotocol/server-filesystem', 'C:\\Users']
        }
      }
    }
    setJsonText(JSON.stringify(sample, null, 2))
  }

  return (
    <div className="mcp-modal-overlay" onClick={onClose}>
      <div className="mcp-modal-container import-modal" onClick={(e) => e.stopPropagation()}>
        <div className="mcp-modal-header">
          <div className="mcp-modal-title-group">
            <div className="mcp-modal-icon-badge">
              <ArrowDownToLine size={17} />
            </div>
            <div>
              <h3 className="mcp-modal-title">Импорт MCP конфигурации</h3>
              <p className="mcp-modal-subtitle">
                Поддержка формата Claude Desktop, Cursor и Antigravity
              </p>
            </div>
          </div>

          <button type="button" className="mcp-modal-close-btn" onClick={onClose} title="Закрыть">
            <X size={16} />
          </button>
        </div>

        <div className="mcp-modal-body">
          {errorMsg && (
            <div className="mcp-modal-error-banner">
              <AlertCircle size={14} />
              <span>{errorMsg}</span>
            </div>
          )}

          <div className="mcp-import-info-box">
            <p>
              Вставьте JSON-конфигурацию с объектом <code>mcpServers</code> (например, из файла{' '}
              <code>claude_desktop_config.json</code>) или отдельное определение сервера.
            </p>
            <button
              type="button"
              className="mcp-sample-btn"
              onClick={handleInsertSample}
            >
              <FileCode size={12} />
              <span>Вставить пример</span>
            </button>
          </div>

          <div className="mcp-form-field">
            <label>JSON Конфигурация</label>
            <textarea
              className="mcp-json-textarea"
              rows={12}
              value={jsonText}
              onChange={(e) => setJsonText(e.target.value)}
              placeholder={`{\n  "mcpServers": {\n    "github": {\n      "command": "npx",\n      "args": ["-y", "@modelcontextprotocol/server-github"],\n      "env": { "GITHUB_PERSONAL_ACCESS_TOKEN": "..." }\n    }\n  }\n}`}
              spellCheck={false}
              autoFocus
            />
          </div>
        </div>

        <div className="mcp-modal-footer">
          <button
            type="button"
            className="mcp-modal-cancel-btn"
            onClick={onClose}
            disabled={isImporting}
          >
            Отмена
          </button>
          <button
            type="button"
            className="mcp-modal-submit-btn"
            onClick={handleImport}
            disabled={isImporting}
          >
            {isImporting ? 'Импорт...' : 'Импортировать'}
          </button>
        </div>
      </div>
    </div>
  )
}
