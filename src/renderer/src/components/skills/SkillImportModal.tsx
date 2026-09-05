import React, { useState } from 'react'
import { X, FolderOpen, Globe, Zap, AlertCircle, ArrowDownToLine, RefreshCw } from 'lucide-react'

interface SkillImportModalProps {
  isOpen: boolean
  onClose: () => void
  onSuccess: (message: string) => void
}

export const SkillImportModal: React.FC<SkillImportModalProps> = ({
  isOpen,
  onClose,
  onSuccess
}) => {
  const [activeTab, setActiveTab] = useState<'file' | 'url' | 'sync'>('file')
  const [filePath, setFilePath] = useState('')
  const [url, setUrl] = useState('')
  const [isCore, setIsCore] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (!isOpen) return null

  const handleSelectFile = async (): Promise<void> => {
    try {
      if (window.api?.skills?.selectSkillFileOrDir) {
        const selected = await window.api.skills.selectSkillFileOrDir()
        if (selected) {
          setFilePath(selected)
          setError(null)
        }
      }
    } catch (err: any) {
      setError(err?.message || 'Ошибка выбора файла')
    }
  }

  const handleImportFile = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault()
    if (!filePath.trim()) {
      setError('Выберите файл или папку навыка')
      return
    }

    try {
      setIsLoading(true)
      setError(null)
      const res = await window.api.skills.importFromPath(filePath.trim(), isCore)
      if (res.success) {
        onSuccess(
          res.count && res.count > 1
            ? `Успешно импортировано ${res.count} навыков`
            : `Навык «${res.skill?.name || 'custom'}» успешно импортирован`
        )
        onClose()
      } else {
        setError(res.error || 'Ошибка при импорте')
      }
    } catch (err: any) {
      setError(err?.message || 'Не удалось импортировать')
    } finally {
      setIsLoading(false)
    }
  }

  const handleImportUrl = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault()
    if (!url.trim()) {
      setError('Укажите ссылку на навык')
      return
    }

    try {
      setIsLoading(true)
      setError(null)
      const res = await window.api.skills.importFromUrl(url.trim(), isCore)
      if (res.success) {
        onSuccess(`Навык «${res.skill?.name || 'custom'}» успешно установлен из сети`)
        onClose()
      } else {
        setError(res.error || 'Ошибка при загрузке по ссылке')
      }
    } catch (err: any) {
      setError(err?.message || 'Не удалось загрузить')
    } finally {
      setIsLoading(false)
    }
  }

  const handleSyncExternal = async (): Promise<void> => {
    try {
      setIsLoading(true)
      setError(null)
      const res = await window.api.skills.syncExternal()
      if (res.success) {
        onSuccess(
          res.importedCount > 0
            ? `Синхронизировано ${res.importedCount} навыков из Codex/Cursor`
            : 'Внешние навыки Codex/Cursor актуальны'
        )
        onClose()
      } else {
        setError(res.error || 'Ошибка синхронизации')
      }
    } catch (err: any) {
      setError(err?.message || 'Не удалось выполнить синхронизацию')
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <div className="skill-modal-overlay" onClick={onClose}>
      <div className="skill-modal-container import-modal" onClick={(e) => e.stopPropagation()}>
        <div className="skill-modal-header">
          <div className="skill-modal-title-wrap">
            <h3>Импорт и установка навыков</h3>
          </div>
          <button className="skill-modal-close-btn" onClick={onClose} aria-label="Закрыть">
            <X size={15} />
          </button>
        </div>

        {/* Import Tabs */}
        <div className="skill-import-tabs-header">
          <button
            type="button"
            className={`skill-import-tab-btn ${activeTab === 'file' ? 'active' : ''}`}
            onClick={() => {
              setActiveTab('file')
              setError(null)
            }}
          >
            <FolderOpen size={14} />
            <span>Файл / Папка</span>
          </button>

          <button
            type="button"
            className={`skill-import-tab-btn ${activeTab === 'url' ? 'active' : ''}`}
            onClick={() => {
              setActiveTab('url')
              setError(null)
            }}
          >
            <Globe size={14} />
            <span>GitHub / Ссылка</span>
          </button>

          <button
            type="button"
            className={`skill-import-tab-btn ${activeTab === 'sync' ? 'active' : ''}`}
            onClick={() => {
              setActiveTab('sync')
              setError(null)
            }}
          >
            <Zap size={14} />
            <span>Синхронизация Codex & Cursor</span>
          </button>
        </div>

        <div className="skill-modal-form">
          {error && (
            <div className="skill-modal-error">
              <AlertCircle size={15} />
              <span>{error}</span>
            </div>
          )}

          {/* TAB 1: FILE / FOLDER */}
          {activeTab === 'file' && (
            <form onSubmit={handleImportFile} className="skill-import-tab-pane">
              <p className="skill-import-description">
                Поддерживаются одиночные файлы (<code>.md</code>, <code>.mdc</code>), папки со <code>SKILL.md</code> и скриптами, а также каталоги с несколькими навыками.
              </p>

              <div className="skill-modal-field">
                <label>Путь к файлу или папке:</label>
                <div className="skill-import-path-row">
                  <input
                    type="text"
                    placeholder="C:\Users\...\my-skill или skills.md"
                    value={filePath}
                    onChange={(e) => setFilePath(e.target.value)}
                    required
                  />
                  <button
                    type="button"
                    className="skill-btn-secondary browse-btn"
                    onClick={handleSelectFile}
                  >
                    <FolderOpen size={14} />
                    <span>Обзор...</span>
                  </button>
                </div>
              </div>

              <div className="skill-modal-field">
                <label>Режим загрузки:</label>
                <div className="skill-type-toggle-group">
                  <button
                    type="button"
                    className={`skill-type-btn ${!isCore ? 'active' : ''}`}
                    onClick={() => setIsCore(false)}
                  >
                    <div className="skill-type-btn-content">
                      <strong>По требованию (Extra)</strong>
                      <span>Загружается ИИ через read_skill</span>
                    </div>
                  </button>
                  <button
                    type="button"
                    className={`skill-type-btn ${isCore ? 'active' : ''}`}
                    onClick={() => setIsCore(true)}
                  >
                    <div className="skill-type-btn-content">
                      <strong>Постоянный (Core)</strong>
                      <span>Активен в системном промпте</span>
                    </div>
                  </button>
                </div>
              </div>

              <div className="skill-modal-actions">
                <button type="button" className="skill-btn-secondary" onClick={onClose} disabled={isLoading}>
                  Отмена
                </button>
                <button type="submit" className="skill-btn-primary" disabled={isLoading || !filePath.trim()}>
                  {isLoading ? (
                    <span>Импорт...</span>
                  ) : (
                    <>
                      <ArrowDownToLine size={14} strokeWidth={2.4} />
                      <span>Импортировать</span>
                    </>
                  )}
                </button>
              </div>
            </form>
          )}

          {/* TAB 2: URL / GITHUB */}
          {activeTab === 'url' && (
            <form onSubmit={handleImportUrl} className="skill-import-tab-pane">
              <p className="skill-import-description">
                Укажите репозиторий GitHub (например, <code>heygen-com/hyperframes</code>), ссылку на репозиторий или прямую ссылку на Markdown-файл (<code>SKILL.md</code>).
              </p>

              <div className="skill-modal-field">
                <label>Репозиторий или URL навыка:</label>
                <input
                  type="text"
                  placeholder="heygen-com/hyperframes или https://github.com/..."
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  required
                />
              </div>

              <div className="skill-modal-field">
                <label>Режим загрузки:</label>
                <div className="skill-type-toggle-group">
                  <button
                    type="button"
                    className={`skill-type-btn ${!isCore ? 'active' : ''}`}
                    onClick={() => setIsCore(false)}
                  >
                    <div className="skill-type-btn-content">
                      <strong>По требованию (Extra)</strong>
                      <span>Загружается ИИ по триггеру</span>
                    </div>
                  </button>
                  <button
                    type="button"
                    className={`skill-type-btn ${isCore ? 'active' : ''}`}
                    onClick={() => setIsCore(true)}
                  >
                    <div className="skill-type-btn-content">
                      <strong>Постоянный (Core)</strong>
                      <span>Активен в системном промпте</span>
                    </div>
                  </button>
                </div>
              </div>

              <div className="skill-modal-actions">
                <button type="button" className="skill-btn-secondary" onClick={onClose} disabled={isLoading}>
                  Отмена
                </button>
                <button type="submit" className="skill-btn-primary" disabled={isLoading || !url.trim()}>
                  {isLoading ? (
                    <span>Загрузка...</span>
                  ) : (
                    <>
                      <ArrowDownToLine size={14} strokeWidth={2.4} />
                      <span>Установить навык</span>
                    </>
                  )}
                </button>
              </div>
            </form>
          )}

          {/* TAB 3: SYNC CODEX / CURSOR */}
          {activeTab === 'sync' && (
            <div className="skill-import-tab-pane">
              <p className="skill-import-description">
                Автоматическое обнаружение навыков и правил из стандартных директорий на вашем компьютере:
              </p>

              <div className="skill-sync-paths-list">
                <div className="skill-sync-path-item">
                  <Zap size={14} className="sync-icon" />
                  <div className="sync-info">
                    <strong>OpenAI Codex Skills</strong>
                    <span><code>~/.codex/skills/</code></span>
                  </div>
                </div>
                <div className="skill-sync-path-item">
                  <Zap size={14} className="sync-icon" />
                  <div className="sync-info">
                    <strong>Cursor Rules & MDC</strong>
                    <span><code>~/.cursor/rules/</code></span>
                  </div>
                </div>
              </div>

              <div className="skill-modal-actions">
                <button type="button" className="skill-btn-secondary" onClick={onClose} disabled={isLoading}>
                  Закрыть
                </button>
                <button
                  type="button"
                  className="skill-btn-primary"
                  onClick={handleSyncExternal}
                  disabled={isLoading}
                >
                  {isLoading ? (
                    <span>Поиск и синхронизация...</span>
                  ) : (
                    <>
                      <RefreshCw size={14} strokeWidth={2.4} />
                      <span>Синхронизировать сейчас</span>
                    </>
                  )}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
