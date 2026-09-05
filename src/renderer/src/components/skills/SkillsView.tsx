import React, { useState, useEffect, useCallback, useMemo } from 'react'
import {
  Search,
  Plus,
  Trash2,
  Edit3,
  Copy,
  Check,
  RefreshCw,
  ChevronDown,
  ChevronUp,
  FileCode2,
  FolderOpen,
  ArrowDownToLine,
  FolderTree
} from 'lucide-react'
import { SkillItemUI } from '../../env'
import { SkillEditorModal } from './SkillEditorModal'
import { SkillImportModal } from './SkillImportModal'
import { useAiSettingsContext } from '../../hooks/AiSettingsContext'
import './SkillsView.css'

export const SkillsView: React.FC = () => {
  const { config } = useAiSettingsContext()
  const [skills, setSkills] = useState<SkillItemUI[]>([])
  const [searchQuery, setSearchQuery] = useState('')
  const [filterType, setFilterType] = useState<'all' | 'core' | 'extra' | 'workspace' | 'external'>('all')
  const [isLoading, setIsLoading] = useState(true)
  const [editingSkill, setEditingSkill] = useState<SkillItemUI | null>(null)
  const [isEditorModalOpen, setIsEditorModalOpen] = useState(false)
  const [isImportModalOpen, setIsImportModalOpen] = useState(false)
  const [expandedSkillIds, setExpandedSkillIds] = useState<Set<string>>(new Set())
  const [copiedId, setCopiedId] = useState<string | null>(null)
  const [toastMessage, setToastMessage] = useState<string | null>(null)

  const showToast = (msg: string): void => {
    setToastMessage(msg)
    setTimeout(() => {
      setToastMessage((prev) => (prev === msg ? null : prev))
    }, 2400)
  }

  const workspacePath = (config as any)?.workspacePath || config?.baseDir || ''

  const loadSkills = useCallback(async (): Promise<void> => {
    try {
      setIsLoading(true)
      if (window.api?.skills?.getAll) {
        const data = await window.api.skills.getAll(workspacePath)
        setSkills(data || [])
      }
    } catch (err) {
      console.error('Failed to load skills:', err)
      showToast('Ошибка при загрузке навыков')
    } finally {
      setIsLoading(false)
    }
  }, [workspacePath])

  useEffect(() => {
    loadSkills()
  }, [loadSkills])

  const handleToggleExpand = (id: string): void => {
    setExpandedSkillIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) {
        next.delete(id)
      } else {
        next.add(id)
      }
      return next
    })
  }

  const handleToggleSkillEnabled = async (skill: SkillItemUI): Promise<void> => {
    try {
      const targetEnabled = skill.enabled === false ? true : false
      const res = await window.api.skills.toggleEnabled(skill.name, targetEnabled)
      if (res.success) {
        showToast(targetEnabled ? `Навык «${skill.name}» включен` : `Навык «${skill.name}» отключен`)
        await loadSkills()
      }
    } catch (err: any) {
      showToast(err?.message || 'Ошибка переключения')
    }
  }

  const handleToggleCore = async (skill: SkillItemUI): Promise<void> => {
    try {
      const res = await window.api.skills.toggleType(skill.name, skill.filePath)
      if (res.success) {
        showToast(
          res.newIsCore
            ? `«${skill.name}» теперь активен всегда`
            : `«${skill.name}» переведен в каталог`
        )
        await loadSkills()
      } else {
        showToast(res.error || 'Ошибка при переключении')
      }
    } catch (err: any) {
      showToast(err?.message || 'Ошибка переключения')
    }
  }

  const handleDelete = async (skill: SkillItemUI): Promise<void> => {
    if (!window.confirm(`Удалить навык «${skill.name}»?`)) {
      return
    }
    try {
      const res = await window.api.skills.delete(skill.name, skill.isCore, skill.filePath)
      if (res.success) {
        showToast(`Навык «${skill.name}» удален`)
        await loadSkills()
      } else {
        showToast(res.error || 'Не удалось удалить навык')
      }
    } catch (err: any) {
      showToast(err?.message || 'Ошибка при удалении')
    }
  }

  const handleOpenFolder = async (): Promise<void> => {
    try {
      if (window.api?.skills?.openFolder) {
        const res = await window.api.skills.openFolder()
        if (!res.success && res.error) {
          showToast(res.error)
        }
      }
    } catch {
      showToast('Не удалось открыть папку')
    }
  }

  const handleCopyContent = (skill: SkillItemUI): void => {
    navigator.clipboard.writeText(`# ${skill.name}\n\n${skill.description}\n\n${skill.content}`)
    setCopiedId(skill.id)
    showToast(`Текст «${skill.name}» скопирован`)
    setTimeout(() => {
      setCopiedId((prev) => (prev === skill.id ? null : prev))
    }, 1800)
  }

  const handleSaveSkill = async (data: {
    name: string
    description: string
    content: string
    isCore: boolean
    metadata?: { globs?: string[]; triggers?: string[]; tags?: string[] }
  }): Promise<void> => {
    const res = await window.api.skills.save(data)
    if (res.success) {
      showToast(`Навык «${data.name}» сохранен`)
      await loadSkills()
    } else {
      throw new Error(res.error || 'Не удалось сохранить навык')
    }
  }

  const [isSearching, setIsSearching] = useState(false)
  const [searchResults, setSearchResults] = useState<SkillItemUI[] | null>(null)

  const coreCount = useMemo(() => skills.filter((s) => s.isCore).length, [skills])
  const extraCount = useMemo(() => skills.filter((s) => !s.isCore).length, [skills])
  const workspaceCount = useMemo(
    () => skills.filter((s) => s.source === 'workspace').length,
    [skills]
  )
  const codexCount = useMemo(
    () => skills.filter((s) => s.source === 'codex').length,
    [skills]
  )

  useEffect(() => {
    if (!searchQuery.trim()) {
      setSearchResults(null)
      return
    }

    const timer = setTimeout(async () => {
      setIsSearching(true)
      try {
        if (window.api?.skills?.search) {
          const res = await window.api.skills.search(searchQuery, filterType, workspacePath, config)
          setSearchResults(res || [])
        }
      } catch (e) {
        console.warn('Skills search failed:', e)
      } finally {
        setIsSearching(false)
      }
    }, 160)

    return () => clearTimeout(timer)
  }, [searchQuery, filterType, workspacePath, config])

  const filteredSkills = useMemo(() => {
    if (searchQuery.trim() && searchResults !== null) {
      return searchResults
    }

    return skills.filter((s) => {
      if (filterType === 'core' && !s.isCore) return false
      if (filterType === 'extra' && s.isCore) return false
      if (filterType === 'workspace' && s.source !== 'workspace') return false
      if (filterType === 'external' && s.source !== 'codex') return false
      return true
    })
  }, [skills, filterType, searchQuery, searchResults])

  const getSourceBadge = (source: string, isFolder?: boolean) => {
    switch (source) {
      case 'workspace':
        return <span className="skill-source-badge ws">📁 Проект</span>
      case 'codex':
        return <span className="skill-source-badge codex">✨ Codex</span>
      default:
        return isFolder ? (
          <span className="skill-source-badge folder">📦 Пакет</span>
        ) : (
          <span className="skill-source-badge global">Глобальный</span>
        )
    }
  }

  const renderSkillCard = (skill: SkillItemUI): JSX.Element => {
    const isExpanded = expandedSkillIds.has(skill.id)
    const approxTokens = Math.round(skill.content.length / 3.5)
    const isSkillEnabled = skill.enabled !== false

    return (
      <div
        key={skill.id}
        className={`skill-card ${!isSkillEnabled ? 'is-disabled' : ''} ${skill.similarityScore && skill.similarityScore >= 60 ? 'high-relevance' : ''}`}
      >
        <div className="skill-card-top-row">
          <div className="skill-title-block">
            <h4 className="skill-name-heading">{skill.name}</h4>
            {getSourceBadge(skill.source, skill.isFolder)}
            {skill.similarityScore !== undefined && skill.similarityScore > 0 && (
              <span className={`skill-similarity-badge ${skill.similarityScore >= 75 ? 'top' : ''}`}>
                ⚡ {skill.similarityScore}% совпадение
              </span>
            )}
            {skill.matchReason && (
              <span className="skill-match-reason-pill">{skill.matchReason}</span>
            )}
            <span className="skill-tokens-badge">~{approxTokens} tok</span>
            {skill.files && skill.files.length > 0 && (
              <span className="skill-files-count-badge" title={skill.files.join('\n')}>
                <FolderTree size={11} />
                <span>{skill.files.length} файлов</span>
              </span>
            )}
          </div>

          <div className="skill-top-controls">
            {/* Quick Enable/Disable toggle */}
            <button
              className={`skill-power-pill ${isSkillEnabled ? 'active' : 'inactive'}`}
              onClick={() => handleToggleSkillEnabled(skill)}
              title={isSkillEnabled ? 'Нажмите, чтобы отключить навык' : 'Нажмите, чтобы включить навык'}
            >
              <span className="skill-power-dot" />
              <span>{isSkillEnabled ? 'Вкл' : 'Выкл'}</span>
            </button>

            {/* Core / Extra switch */}
            <button
              className={`skill-type-switch-pill ${skill.isCore ? 'is-core' : ''}`}
              onClick={() => handleToggleCore(skill)}
              title="Нажмите для переключения режима"
            >
              <span className="skill-type-dot" />
              <span>{skill.isCore ? 'В памяти' : 'По требованию'}</span>
            </button>
          </div>
        </div>

        <p className="skill-description-text">{skill.description}</p>

        {/* Metadata Tags, Globs, Triggers */}
        {(Boolean(skill.globs?.length) ||
          Boolean(skill.triggers?.length) ||
          Boolean(skill.tags?.length)) && (
          <div className="skill-chips-row">
            {skill.globs && skill.globs.length > 0 && (
              <div className="skill-meta-chip globs">
                <span>Маски:</span>
                <code>{skill.globs.join(', ')}</code>
              </div>
            )}
            {skill.triggers && skill.triggers.length > 0 && (
              <div className="skill-meta-chip triggers">
                <span>Триггеры:</span>
                <code>{skill.triggers.slice(0, 3).join(', ')}</code>
              </div>
            )}
            {skill.tags
              ?.filter(
                (t) =>
                  t !== 'global' &&
                  t !== 'core' &&
                  t !== 'extra' &&
                  t !== 'workspace' &&
                  t !== 'codex'
              )
              .map((t) => (
                <span key={t} className="skill-tag-pill">
                  #{t}
                </span>
              ))}
          </div>
        )}

        <div className="skill-instruction-box">
          <button
            className="skill-instruction-toggle-btn"
            onClick={() => handleToggleExpand(skill.id)}
          >
            <span>Инструкция ({skill.content.split('\n').length} строк)</span>
            {isExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
          </button>

          {isExpanded && <pre className="skill-code-preview">{skill.content}</pre>}
        </div>

        <div className="skill-card-footer-row">
          <span className="skill-status-tag">
            {!isSkillEnabled
              ? 'Отключен (агент игнорирует этот навык)'
              : skill.isCore
                ? 'Загружается в каждый запрос'
                : `Загружается через read_skill("${skill.name}")`}
          </span>

          <div className="skill-button-group">
            <button
              className="skill-ghost-btn"
              onClick={() => handleCopyContent(skill)}
              title="Скопировать"
            >
              {copiedId === skill.id ? (
                <>
                  <Check size={13} color="#ffffff" />
                  <span>Скопировано</span>
                </>
              ) : (
                <>
                  <Copy size={13} />
                  <span>Копировать</span>
                </>
              )}
            </button>

            <button
              className="skill-ghost-btn"
              onClick={() => {
                setEditingSkill(skill)
                setIsEditorModalOpen(true)
              }}
              title="Редактировать"
            >
              <Edit3 size={13} />
              <span>Изменить</span>
            </button>

            <button
              className="skill-ghost-btn danger"
              onClick={() => handleDelete(skill)}
              title="Удалить"
            >
              <Trash2 size={13} />
            </button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="skills-view-container">
      {/* Toast Notification */}
      {toastMessage && (
        <div className="skills-toast">
          <span>{toastMessage}</span>
        </div>
      )}

      <div className="skills-wrapper">
        {/* Header */}
        <div className="skills-header">
          <div className="skills-header-left">
            <h2 className="skills-page-title">Навыки и инструкции</h2>
            <p className="skills-page-subtitle">
              Универсальная библиотека правил Codex, Antigravity и кастомных навыков
            </p>
          </div>

          <div className="skills-header-right">
            <button
              className="skills-header-btn"
              onClick={handleOpenFolder}
              title="Открыть папку навыков в Проводнике"
            >
              <FolderOpen size={14} />
              <span>Папка</span>
            </button>

            <button
              className="skills-header-btn"
              onClick={() => setIsImportModalOpen(true)}
              title="Импорт из файлов, GitHub или Codex"
            >
              <ArrowDownToLine size={14} />
              <span>Импорт</span>
            </button>

            <button
              className="skills-icon-btn"
              onClick={loadSkills}
              title="Обновить список"
              disabled={isLoading}
            >
              <RefreshCw size={14} className={isLoading ? 'spinning' : ''} />
            </button>

            <button
              className="skills-create-btn"
              onClick={() => {
                setEditingSkill(null)
                setIsEditorModalOpen(true)
              }}
            >
              <Plus size={15} />
              <span>Новый навык</span>
            </button>
          </div>
        </div>

        {/* Top Metric Cards (Horizontal Grid) */}
        <div className="skills-metrics-grid">
          <div
            className={`skills-stat-box ${filterType === 'all' ? 'active' : ''}`}
            onClick={() => setFilterType('all')}
          >
            <span className="skills-stat-number">{skills.length}</span>
            <span className="skills-stat-label">Всего навыков</span>
          </div>

          <div
            className={`skills-stat-box ${filterType === 'core' ? 'active' : ''}`}
            onClick={() => setFilterType('core')}
          >
            <span className="skills-stat-number">{coreCount}</span>
            <span className="skills-stat-label">В памяти (Core)</span>
          </div>

          <div
            className={`skills-stat-box ${filterType === 'extra' ? 'active' : ''}`}
            onClick={() => setFilterType('extra')}
          >
            <span className="skills-stat-number">{extraCount}</span>
            <span className="skills-stat-label">По требованию (Extra)</span>
          </div>

          <div
            className={`skills-stat-box ${filterType === 'workspace' ? 'active' : ''}`}
            onClick={() => setFilterType('workspace')}
          >
            <span className="skills-stat-number">{workspaceCount}</span>
            <span className="skills-stat-label">В проекте (.skills)</span>
          </div>
        </div>

        {/* Controls: Search and Filter Tabs */}
        <div className="skills-controls-row">
          <div className="skills-search-field">
            <Search size={15} className="skills-search-icon" />
            <input
              type="text"
              placeholder="Поиск по имени, описанию, триггерам..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
            <div className="skills-search-trail">
              {isSearching && <RefreshCw size={13} className="skills-search-spinning-icon" />}
              {searchQuery && (
                <button
                  type="button"
                  className="skills-search-reset"
                  onClick={() => setSearchQuery('')}
                  title="Очистить поиск"
                >
                  ×
                </button>
              )}
            </div>
          </div>

          <div className="skills-segmented-tabs">
            <button
              className={`skills-tab-pill ${filterType === 'all' ? 'active' : ''}`}
              onClick={() => setFilterType('all')}
            >
              Все ({skills.length})
            </button>
            <button
              className={`skills-tab-pill ${filterType === 'core' ? 'active' : ''}`}
              onClick={() => setFilterType('core')}
            >
              Core ({coreCount})
            </button>
            <button
              className={`skills-tab-pill ${filterType === 'extra' ? 'active' : ''}`}
              onClick={() => setFilterType('extra')}
            >
              Extra ({extraCount})
            </button>
            <button
              className={`skills-tab-pill ${filterType === 'workspace' ? 'active' : ''}`}
              onClick={() => setFilterType('workspace')}
            >
              Проектные ({workspaceCount})
            </button>
            <button
              className={`skills-tab-pill ${filterType === 'external' ? 'active' : ''}`}
              onClick={() => setFilterType('external')}
            >
              Codex ({codexCount})
            </button>
          </div>
        </div>

        {/* Skills List */}
        <div className="skills-list-section">
          {isLoading ? (
            <div className="skills-loading-block">
              <RefreshCw size={20} className="spinning" />
              <span>Загрузка...</span>
            </div>
          ) : filteredSkills.length === 0 ? (
            <div className="skills-empty-block">
              <FileCode2 size={32} strokeWidth={1.5} color="var(--text-muted, #858585)" />
              <h4>Навыки не найдены</h4>
              <p>
                {searchQuery
                  ? 'По вашему запросу ничего не найдено.'
                  : 'Список навыков пуст. Нажмите «Новый навык» или «Импорт».'}
              </p>
            </div>
          ) : (
            filteredSkills.map(renderSkillCard)
          )}
        </div>
      </div>

      {/* Editor Modal */}
      <SkillEditorModal
        isOpen={isEditorModalOpen}
        skill={editingSkill}
        onClose={() => {
          setIsEditorModalOpen(false)
          setEditingSkill(null)
        }}
        onSave={handleSaveSkill}
      />

      {/* Import Modal */}
      <SkillImportModal
        isOpen={isImportModalOpen}
        onClose={() => setIsImportModalOpen(false)}
        onSuccess={(msg) => {
          showToast(msg)
          loadSkills()
        }}
      />
    </div>
  )
}

