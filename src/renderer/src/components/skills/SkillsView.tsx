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
import { CodexTransferModal } from './CodexTransferModal'
import { useAiSettingsContext } from '../../hooks/AiSettingsContext'
import './SkillsView.css'

export const SkillsView: React.FC = () => {
  const { config } = useAiSettingsContext()
  const [skills, setSkills] = useState<SkillItemUI[]>([])
  const [searchQuery, setSearchQuery] = useState('')
  const [filterType, setFilterType] = useState<string>('all')
  const [isLoading, setIsLoading] = useState(true)
  const [editingSkill, setEditingSkill] = useState<SkillItemUI | null>(null)
  const [isEditorModalOpen, setIsEditorModalOpen] = useState(false)
  const [isImportModalOpen, setIsImportModalOpen] = useState(false)
  const [isCodexTransferModalOpen, setIsCodexTransferModalOpen] = useState(false)
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
            ? `«${skill.name}» загружается в память`
            : `«${skill.name}» переведен в режим по требованию`
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
  const systemCount = useMemo(() => skills.filter((s) => s.category === 'system').length, [skills])
  const toolsCount = useMemo(() => skills.filter((s) => s.category === 'tools').length, [skills])
  const engineeringCount = useMemo(
    () => skills.filter((s) => s.category === 'engineering').length,
    [skills]
  )
  const workspaceCount = useMemo(
    () => skills.filter((s) => s.source === 'workspace' || s.category === 'workspace').length,
    [skills]
  )
  const codexCount = useMemo(
    () => skills.filter((s) => s.source === 'codex' || s.category === 'codex').length,
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
      if (filterType === 'all') return true
      if (filterType === 'core') return s.isCore
      if (filterType === 'system') return s.category === 'system'
      if (filterType === 'tools') return s.category === 'tools'
      if (filterType === 'engineering') return s.category === 'engineering'
      if (filterType === 'workspace') return s.source === 'workspace' || s.category === 'workspace'
      if (filterType === 'external') return s.source === 'codex' || s.category === 'codex'
      return (s.category || '').toLowerCase() === filterType.toLowerCase()
    })
  }, [skills, filterType, searchQuery, searchResults])

  const getCategoryBadgeLabel = (category?: string) => {
    switch ((category || '').toLowerCase()) {
      case 'system':
        return 'Система'
      case 'tools':
        return 'Инструмент'
      case 'engineering':
        return 'Разработка'
      case 'workspace':
        return 'Проект'
      case 'codex':
        return 'Codex'
      default:
        return 'Навык'
    }
  }

  const renderSkillCard = (skill: SkillItemUI): JSX.Element => {
    const isExpanded = expandedSkillIds.has(skill.id)
    const approxTokens = Math.round(skill.content.length / 3.5)
    const isSkillEnabled = skill.enabled !== false

    return (
      <div
        key={skill.id}
        className={`skill-card ${!isSkillEnabled ? 'is-disabled' : ''}`}
      >
        <div className="skill-card-top-row">
          <div className="skill-title-block">
            <h4 className="skill-name-heading">{skill.name}</h4>
            <span className="skill-badge category">{getCategoryBadgeLabel(skill.category)}</span>
            {skill.source === 'workspace' && (
              <span className="skill-badge source">Проект</span>
            )}
            {skill.source === 'codex' && (
              <span className="skill-badge source">Codex</span>
            )}
            <span className="skill-badge tokens">~{approxTokens} tok</span>
            {skill.files && skill.files.length > 0 && (
              <span className="skill-badge files" title={skill.files.join('\n')}>
                <FolderTree size={11} />
                <span>{skill.files.length}</span>
              </span>
            )}
          </div>

          <div className="skill-top-controls">
            <button
              className={`skill-switch-btn ${skill.isCore ? 'active' : ''}`}
              onClick={() => handleToggleCore(skill)}
              title={
                skill.isCore
                  ? 'В памяти: всегда загружен в системный контекст'
                  : 'По требованию: загружается агентом по необходимости'
              }
            >
              <span>{skill.isCore ? 'В памяти' : 'По требованию'}</span>
            </button>

            <button
              className={`skill-switch-btn power ${isSkillEnabled ? 'active' : ''}`}
              onClick={() => handleToggleSkillEnabled(skill)}
              title={isSkillEnabled ? 'Отключить навык' : 'Включить навык'}
            >
              <span className="skill-dot" />
              <span>{isSkillEnabled ? 'Вкл' : 'Выкл'}</span>
            </button>
          </div>
        </div>

        <p className="skill-description-text">{skill.description}</p>

        {/* Metadata: triggers & globs in clean monochrome */}
        {((skill.triggers && skill.triggers.length > 0) ||
          (skill.globs && skill.globs.length > 0)) && (
          <div className="skill-meta-row">
            {skill.triggers && skill.triggers.length > 0 && (
              <div className="skill-meta-item">
                <span className="skill-meta-label">Триггеры:</span>
                <span className="skill-meta-val">{skill.triggers.slice(0, 4).join(', ')}</span>
              </div>
            )}
            {skill.globs && skill.globs.length > 0 && (
              <div className="skill-meta-item">
                <span className="skill-meta-label">Маски:</span>
                <span className="skill-meta-val">{skill.globs.join(', ')}</span>
              </div>
            )}
          </div>
        )}

        <div className="skill-instruction-box">
          <button
            className="skill-instruction-toggle-btn"
            onClick={() => handleToggleExpand(skill.id)}
          >
            <span>Инструкция ({skill.content.split('\n').length} строк)</span>
            {isExpanded ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
          </button>

          {isExpanded && <pre className="skill-code-preview">{skill.content}</pre>}
        </div>

        <div className="skill-card-footer-row">
          <span className="skill-status-tag">
            {!isSkillEnabled
              ? 'Отключен'
              : skill.isCore
              ? 'В системном промпте'
              : `Загружается по требованию: read_skill("${skill.name}")`}
          </span>

          <div className="skill-button-group">
            <button
              className="skill-action-btn"
              onClick={() => handleCopyContent(skill)}
              title="Скопировать текст"
            >
              {copiedId === skill.id ? (
                <>
                  <Check size={12} />
                  <span>Скопировано</span>
                </>
              ) : (
                <>
                  <Copy size={12} />
                  <span>Копировать</span>
                </>
              )}
            </button>

            <button
              className="skill-action-btn"
              onClick={() => {
                setEditingSkill(skill)
                setIsEditorModalOpen(true)
              }}
              title="Редактировать навык"
            >
              <Edit3 size={12} />
              <span>Изменить</span>
            </button>

            <button
              className="skill-action-btn danger"
              onClick={() => handleDelete(skill)}
              title="Удалить навык"
            >
              <Trash2 size={12} />
            </button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="skills-view-container">
      {toastMessage && (
        <div className="skills-toast">
          <span>{toastMessage}</span>
        </div>
      )}

      <div className="skills-wrapper">
        {/* Header */}
        <div className="skills-header">
          <div className="skills-header-left">
            <h2 className="skills-page-title">Навыки</h2>
            <p className="skills-page-subtitle">
              Правила поведения, инструменты и стандарты разработки
            </p>
          </div>

          <div className="skills-header-right">
            <button
              className="skills-header-btn"
              onClick={handleOpenFolder}
              title="Открыть папку навыков в Проводнике"
            >
              <FolderOpen size={13} />
              <span>Папка</span>
            </button>

            <button
              className="skills-header-btn"
              onClick={() => setIsImportModalOpen(true)}
              title="Импорт из файлов или GitHub"
            >
              <ArrowDownToLine size={13} />
              <span>Импорт</span>
            </button>

            <button
              className="skills-icon-btn"
              onClick={loadSkills}
              title="Обновить"
              disabled={isLoading}
            >
              <RefreshCw size={13} className={isLoading ? 'spinning' : ''} />
            </button>

            <button
              className="skills-create-btn"
              onClick={() => {
                setEditingSkill(null)
                setIsEditorModalOpen(true)
              }}
            >
              <Plus size={14} />
              <span>Создать</span>
            </button>
          </div>
        </div>

        {/* Controls: Search and Tabs */}
        <div className="skills-controls-row">
          <div className="skills-search-field">
            <Search size={13} className="skills-search-icon" />
            <input
              type="text"
              placeholder="Поиск по названию или триггерам..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
            {isSearching ? (
              <RefreshCw size={11} className="skills-search-spinner spinning" />
            ) : searchQuery ? (
              <button
                type="button"
                className="skills-search-reset"
                onClick={() => setSearchQuery('')}
                title="Очистить"
              >
                ×
              </button>
            ) : null}
          </div>

          <div className="skills-segmented-tabs">
            <button
              className={`skills-tab-pill ${filterType === 'all' ? 'active' : ''}`}
              onClick={() => setFilterType('all')}
            >
              <span>Все</span>
              <span className="tab-count">{skills.length}</span>
            </button>
            <button
              className={`skills-tab-pill ${filterType === 'system' ? 'active' : ''}`}
              onClick={() => setFilterType('system')}
            >
              <span>Система</span>
              <span className="tab-count">{systemCount}</span>
            </button>
            <button
              className={`skills-tab-pill ${filterType === 'tools' ? 'active' : ''}`}
              onClick={() => setFilterType('tools')}
            >
              <span>Инструменты</span>
              <span className="tab-count">{toolsCount}</span>
            </button>
            <button
              className={`skills-tab-pill ${filterType === 'engineering' ? 'active' : ''}`}
              onClick={() => setFilterType('engineering')}
            >
              <span>Разработка</span>
              <span className="tab-count">{engineeringCount}</span>
            </button>
            {workspaceCount > 0 && (
              <button
                className={`skills-tab-pill ${filterType === 'workspace' ? 'active' : ''}`}
                onClick={() => setFilterType('workspace')}
              >
                <span>Проект</span>
                <span className="tab-count">{workspaceCount}</span>
              </button>
            )}
            {codexCount > 0 && (
              <button
                className={`skills-tab-pill ${filterType === 'external' ? 'active' : ''}`}
                onClick={() => setFilterType('external')}
              >
                <span>Codex</span>
                <span className="tab-count">{codexCount}</span>
              </button>
            )}
            <button
              className={`skills-tab-pill ${filterType === 'core' ? 'active' : ''}`}
              onClick={() => setFilterType('core')}
            >
              <span>В памяти</span>
              <span className="tab-count">{coreCount}</span>
            </button>
          </div>
        </div>

        {/* Skills List — Single Unified Stream */}
        <div className="skills-list-section">
          {isLoading ? (
            <div className="skills-loading-block">
              <RefreshCw size={16} className="spinning" />
              <span>Загрузка...</span>
            </div>
          ) : filteredSkills.length === 0 ? (
            <div className="skills-empty-block">
              <FileCode2 size={24} strokeWidth={1.5} />
              <h4>Ничего не найдено</h4>
              <p>По вашему запросу навыки не найдены.</p>
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

      {/* Codex Transfer Modal */}
      <CodexTransferModal
        isOpen={isCodexTransferModalOpen}
        onClose={() => setIsCodexTransferModalOpen(false)}
        onSuccess={(msg) => {
          showToast(msg)
          loadSkills()
        }}
        skills={skills}
      />
    </div>
  )
}
