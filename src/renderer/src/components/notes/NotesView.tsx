import React, { useState, useEffect, useCallback, useRef } from 'react'
import {
  Search,
  Plus,
  Trash2,
  Edit3,
  Check,
  X,
  Clock,
  Tag,
  AlertCircle,
  RefreshCw,
  History,
  Copy,
  Pin,
  Bookmark,
  FileText,
  User,
  Zap,
  Terminal,
  Lightbulb,
  Sparkles
} from 'lucide-react'
import { useAiSettingsContext } from '../../hooks/AiSettingsContext'
import { MemoryItemUI, SessionSummaryUI, LinguisticPersonaUI } from '../../env'
import './NotesView.css'

interface CategoryDef {
  id: string
  label: string
  icon: React.ReactNode
}

const CATEGORIES: CategoryDef[] = [
  { id: 'all', label: 'Все заметки', icon: <Bookmark size={13} strokeWidth={1.8} /> },
  { id: 'user_preference', label: 'Личные правила', icon: <User size={13} strokeWidth={1.8} /> },
  { id: 'project_fact', label: 'Стек и Проект', icon: <Zap size={13} strokeWidth={1.8} /> },
  { id: 'procedural_workflow', label: 'Процессы', icon: <Terminal size={13} strokeWidth={1.8} /> },
  { id: 'fact', label: 'Общие знания', icon: <Lightbulb size={13} strokeWidth={1.8} /> },
  { id: 'persona', label: 'Стиль общения', icon: <Sparkles size={13} strokeWidth={1.8} /> },
  { id: 'sessions', label: 'Резюме сессий', icon: <History size={13} strokeWidth={1.8} /> }
]

const PERSONA_TONES: Array<{
  id: 'adaptive' | 'casual' | 'direct' | 'friendly' | 'mentor'
  label: string
  desc: string
  badge: string
}> = [
  {
    id: 'adaptive',
    label: 'Адаптивный (зеркалит стиль)',
    desc: 'Органично подстраивается под сленг ("вассап", "ку", "йоу"), тон и краткость пользователя без официоза.',
    badge: 'Рекомендуется'
  },
  {
    id: 'casual',
    label: 'Коллега (Неформальный)',
    desc: 'Живой разговор на равных, легкий тон, как будто вы сидите рядом за соседними столами.',
    badge: 'Живой'
  },
  {
    id: 'direct',
    label: 'Прямой и краткий',
    desc: 'Предельная точность, сразу код и решение, минимум рассуждений.',
    badge: 'Быстро'
  },
  {
    id: 'friendly',
    label: 'Дружелюбный напарник',
    desc: 'Поддерживающий тон, подробные понятные объяснения с заботой о деталях.',
    badge: 'Мягкий'
  },
  {
    id: 'mentor',
    label: 'Опытный ментор',
    desc: 'Тон старшего инженера: структурированные инсайты, архитектурные советы и лучшие практики.',
    badge: 'Senior'
  }
]

interface NotesViewProps {
  initialCategory?: string
  onCategoryChange?: (category: string) => void
  isAddingTrigger?: boolean
  onResetAddingTrigger?: () => void
}

export const NotesView: React.FC<NotesViewProps> = ({
  initialCategory = 'all',
  onCategoryChange,
  isAddingTrigger = false,
  onResetAddingTrigger
}) => {
  const { config } = useAiSettingsContext()

  const [memories, setMemories] = useState<MemoryItemUI[]>([])
  const [sessions, setSessions] = useState<SessionSummaryUI[]>([])
  const [coreSummary, setCoreSummary] = useState<string>('')
  const [persona, setPersona] = useState<LinguisticPersonaUI | null>(null)
  const [loading, setLoading] = useState<boolean>(true)
  const [searchQuery, setSearchQuery] = useState<string>('')
  const [selectedCategory, setSelectedCategory] = useState<string>(initialCategory)

  // Core Summary editing state
  const [isEditingCoreSummary, setIsEditingCoreSummary] = useState<boolean>(false)
  const [editCoreSummaryText, setEditCoreSummaryText] = useState<string>('')
  const [isGeneratingCoreSummary, setIsGeneratingCoreSummary] = useState<boolean>(false)

  // Linguistic Persona state
  const [isGeneratingPersona, setIsGeneratingPersona] = useState<boolean>(false)
  const [customPersonaPrompt, setCustomPersonaPrompt] = useState<string>('')

  // Form states for adding memory
  const [isAdding, setIsAdding] = useState<boolean>(false)
  const [newContent, setNewContent] = useState<string>('')
  const [newCategory, setNewCategory] = useState<'user_preference' | 'project_fact' | 'procedural_workflow' | 'fact'>('user_preference')
  const [newImportance, setNewImportance] = useState<number>(4)
  const [newTags, setNewTags] = useState<string>('')

  // Inline editing state for memories
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editContent, setEditContent] = useState<string>('')
  const [editCategory, setEditCategory] = useState<'user_preference' | 'project_fact' | 'procedural_workflow' | 'fact'>('user_preference')
  const [editImportance, setEditImportance] = useState<number>(3)
  const [editTags, setEditTags] = useState<string>('')

  const [copiedId, setCopiedId] = useState<string | null>(null)
  const [feedbackMsg, setFeedbackMsg] = useState<{ text: string; type: 'success' | 'error' } | null>(null)

  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const showFeedback = (text: string, type: 'success' | 'error' = 'success') => {
    setFeedbackMsg({ text, type })
    setTimeout(() => setFeedbackMsg(null), 2500)
  }

  // Handle external category changes
  useEffect(() => {
    if (initialCategory && initialCategory !== selectedCategory) {
      setSelectedCategory(initialCategory)
    }
  }, [initialCategory])

  // Handle external trigger for adding a note
  useEffect(() => {
    if (isAddingTrigger) {
      setIsAdding(true)
      onResetAddingTrigger?.()
      setTimeout(() => textareaRef.current?.focus(), 50)
    }
  }, [isAddingTrigger, onResetAddingTrigger])

  const handleSelectCategory = (catId: string) => {
    setSelectedCategory(catId)
    onCategoryChange?.(catId)
  }

  // Load all data from memory, sessions, core summary, and persona APIs
  const loadData = useCallback(async () => {
    setLoading(true)
    try {
      if (window.api?.memory) {
        if (searchQuery.trim()) {
          // Vector / Semantic Search
          const res = await window.api.memory.search(
            searchQuery.trim(),
            selectedCategory === 'all' || selectedCategory === 'sessions' || selectedCategory === 'persona' ? null : selectedCategory,
            config
          )
          setMemories(Array.isArray(res) ? res : [])
        } else {
          // All memories
          const res = await window.api.memory.getAll()
          if (Array.isArray(res)) {
            let list = res
            if (selectedCategory !== 'all' && selectedCategory !== 'sessions' && selectedCategory !== 'persona') {
              list = list.filter((m) => m.category === selectedCategory)
            }
            setMemories(list)
          }
        }

        // Load Core Summary
        if (window.api.memory.getCoreSummary) {
          const cs = await window.api.memory.getCoreSummary()
          setCoreSummary(cs || '')
        }
      }

      if (window.api?.session) {
        const sess = await window.api.session.getAll()
        setSessions(Array.isArray(sess) ? sess : [])
      }

      if (window.api?.persona) {
        const p = await window.api.persona.get()
        if (p) {
          setPersona(p)
          setCustomPersonaPrompt(p.customPrompt || '')
        }
      }
    } catch (err) {
      console.error('Failed to load notes & memories:', err)
    } finally {
      setLoading(false)
    }
  }, [searchQuery, selectedCategory, config])

  // Debounced search
  useEffect(() => {
    const timer = setTimeout(() => {
      loadData()
    }, 180)
    return () => clearTimeout(timer)
  }, [loadData])

  // Add memory
  const handleAddMemory = async () => {
    if (!newContent.trim()) {
      showFeedback('Введите текст заметки или правила', 'error')
      return
    }

    try {
      const tagArr = newTags.split(',').map((t) => t.trim()).filter(Boolean)
      const res = await window.api.memory.add({
        content: newContent.trim(),
        category: newCategory,
        importance: newImportance,
        tags: tagArr
      })

      if (res?.item) {
        showFeedback(res.duplicate ? 'Заметка обновлена' : 'Заметка сохранена')
        setNewContent('')
        setNewTags('')
        setIsAdding(false)
        loadData()
      }
    } catch (e) {
      showFeedback('Ошибка сохранения заметки', 'error')
    }
  }

  // Quick toggle pin/importance
  const handleTogglePin = async (item: MemoryItemUI) => {
    try {
      const newImp = item.importance >= 4 ? 2 : 5
      await window.api.memory.update(item.id, {
        content: item.content,
        category: item.category,
        importance: newImp,
        tags: item.tags
      })
      showFeedback(newImp >= 4 ? 'Заметка закреплена' : 'Закрепление снято')
      loadData()
    } catch (e) {
      showFeedback('Ошибка обновления статуса', 'error')
    }
  }

  // Start editing memory
  const startEdit = (item: MemoryItemUI) => {
    setEditingId(item.id)
    setEditContent(item.content)
    setEditCategory(item.category)
    setEditImportance(item.importance)
    setEditTags(item.tags?.join(', ') || '')
  }

  // Save edit memory
  const handleSaveEdit = async () => {
    if (!editingId || !editContent.trim()) return

    try {
      const tagArr = editTags.split(',').map((t) => t.trim()).filter(Boolean)
      const updated = await window.api.memory.update(editingId, {
        content: editContent.trim(),
        category: editCategory,
        importance: editImportance,
        tags: tagArr
      })

      if (updated) {
        showFeedback('Изменения сохранены')
        setEditingId(null)
        loadData()
      }
    } catch (e) {
      showFeedback('Ошибка обновления записи', 'error')
    }
  }

  // Delete memory
  const handleDelete = async (id: string) => {
    try {
      const success = await window.api.memory.delete(id)
      if (success) {
        showFeedback('Заметка удалена')
        loadData()
      }
    } catch (e) {
      showFeedback('Ошибка удаления', 'error')
    }
  }

  // Core Memory Summary Actions
  const handleSaveCoreSummary = async () => {
    try {
      if (window.api?.memory?.updateCoreSummary) {
        await window.api.memory.updateCoreSummary(editCoreSummaryText.trim())
        setCoreSummary(editCoreSummaryText.trim())
        setIsEditingCoreSummary(false)
        showFeedback('Главная выжимка сохранена')
      }
    } catch (e) {
      showFeedback('Ошибка сохранения выжимки', 'error')
    }
  }

  const handleGenerateCoreSummary = async () => {
    if (isGeneratingCoreSummary) return
    setIsGeneratingCoreSummary(true)
    try {
      if (window.api?.memory?.generateCoreSummary) {
        const generated = await window.api.memory.generateCoreSummary(config, true)
        if (generated) {
          setCoreSummary(generated)
          showFeedback('Выжимка успешно синтезирована ИИ')
        } else {
          showFeedback('Память пуста или нет данных для выжимки')
        }
      }
    } catch (e) {
      showFeedback('Ошибка генерации выжимки', 'error')
    } finally {
      setIsGeneratingCoreSummary(false)
    }
  }

  // Linguistic Persona Actions
  const handleUpdatePersonaTone = async (tone: 'adaptive' | 'casual' | 'direct' | 'friendly' | 'mentor') => {
    try {
      if (window.api?.persona) {
        const updated = await window.api.persona.update({ tone })
        setPersona(updated)
        showFeedback(`Тональность изменена: ${PERSONA_TONES.find((t) => t.id === tone)?.label}`)
      }
    } catch (e) {
      showFeedback('Ошибка обновления стиля', 'error')
    }
  }

  const handleTogglePersona = async () => {
    if (!persona) return
    try {
      if (window.api?.persona) {
        const updated = await window.api.persona.update({ enabled: !persona.enabled })
        setPersona(updated)
        showFeedback(updated.enabled ? 'Живой стиль включен' : 'Стиль временно отключен')
      }
    } catch (e) {
      showFeedback('Ошибка переключения стиля', 'error')
    }
  }

  const handleSavePersonaPrompt = async () => {
    try {
      if (window.api?.persona) {
        const updated = await window.api.persona.update({ customPrompt: customPersonaPrompt.trim() })
        setPersona(updated)
        showFeedback('Инструкции стиля сохранены')
      }
    } catch (e) {
      showFeedback('Ошибка сохранения инструкций', 'error')
    }
  }

  const handleGeneratePersonaProfile = async () => {
    if (isGeneratingPersona) return
    setIsGeneratingPersona(true)
    try {
      if (window.api?.persona) {
        const profile = await window.api.persona.generate(config, true)
        if (profile) {
          const fresh = await window.api.persona.get()
          setPersona(fresh)
          showFeedback('Стиль синтезирован по сессиям')
        } else {
          showFeedback('Недостаточно истории диалогов для анализа')
        }
      }
    } catch (e) {
      showFeedback('Ошибка синтеза стиля', 'error')
    } finally {
      setIsGeneratingPersona(false)
    }
  }

  // Copy to clipboard
  const handleCopy = (id: string, text: string) => {
    navigator.clipboard.writeText(text)
    setCopiedId(id)
    showFeedback('Скопировано в буфер')
    setTimeout(() => setCopiedId(null), 2000)
  }

  // Clear all memories
  const handleClearAll = async () => {
    if (window.confirm('Вы уверены, что хотите очистить все заметки и память? Действие необратимо.')) {
      try {
        await window.api.memory.clear()
        setCoreSummary('')
        showFeedback('База заметок очищена')
        loadData()
      } catch (e) {
        showFeedback('Ошибка очистки', 'error')
      }
    }
  }

  // Delete session
  const handleDeleteSession = async (id: string) => {
    try {
      await window.api.session.delete(id)
      showFeedback('Сессия удалена')
      loadData()
    } catch (e) {
      showFeedback('Ошибка удаления сессии', 'error')
    }
  }

  const getCategoryMeta = (cat: string) => {
    switch (cat) {
      case 'user_preference':
        return { label: 'Личное правило', icon: <User size={12} strokeWidth={1.8} /> }
      case 'project_fact':
        return { label: 'Стек / Проект', icon: <Zap size={12} strokeWidth={1.8} /> }
      case 'procedural_workflow':
        return { label: 'Процесс', icon: <Terminal size={12} strokeWidth={1.8} /> }
      default:
        return { label: 'Знание / Факт', icon: <Lightbulb size={12} strokeWidth={1.8} /> }
    }
  }

  const pinnedCount = memories.filter((m) => m.importance >= 4).length

  return (
    <div className="notes-view-root custom-scrollbar">
      <div className="notes-container">
        {/* Top Minimalist Header */}
        <header className="notes-header">
          <div className="notes-header-left">
            <div className="notes-header-badge">
              <Bookmark size={11} strokeWidth={1.8} />
              <span>База знаний & Стиль</span>
            </div>
            <h1 className="notes-title">Заметки и Память</h1>
            <p className="notes-subtitle">
              Правила, стек проекта, главная выжимка и живой стиль общения ИИ.
            </p>
          </div>

          <div className="notes-header-right">
            {selectedCategory !== 'persona' && selectedCategory !== 'sessions' && (
              <button
                type="button"
                className={`notes-create-btn ${isAdding ? 'active' : ''}`}
                onClick={() => {
                  setIsAdding(!isAdding)
                  if (!isAdding) {
                    setTimeout(() => textareaRef.current?.focus(), 50)
                  }
                }}
              >
                {isAdding ? <X size={14} strokeWidth={2} /> : <Plus size={14} strokeWidth={2} />}
                <span>{isAdding ? 'Отмена' : 'Новая заметка'}</span>
              </button>
            )}
          </div>
        </header>

        {/* Minimalist Stats Bar */}
        <div className="notes-stats-row">
          <div className="notes-stat-chip">
            <Bookmark size={11} strokeWidth={1.8} />
            <span>Записей: <strong>{memories.length}</strong></span>
          </div>

          {pinnedCount > 0 && (
            <div className="notes-stat-chip pinned">
              <Pin size={11} strokeWidth={1.8} />
              <span>Закреплено: <strong>{pinnedCount}</strong></span>
            </div>
          )}

          <div className="notes-stat-chip">
            <History size={11} strokeWidth={1.8} />
            <span>Сессий: <strong>{sessions.length}</strong></span>
          </div>

          {persona && (
            <div className={`notes-stat-chip ${persona.enabled ? 'persona-active' : ''}`}>
              <Sparkles size={11} strokeWidth={1.8} />
              <span>Стиль: <strong>{PERSONA_TONES.find((t) => t.id === persona.tone)?.label.split(' ')[0]}</strong></span>
            </div>
          )}
        </div>

        {/* Feedback Alert Toast */}
        {feedbackMsg && (
          <div className={`notes-feedback-toast ${feedbackMsg.type}`}>
            {feedbackMsg.type === 'success' ? <Check size={13} strokeWidth={2} /> : <AlertCircle size={13} strokeWidth={2} />}
            <span>{feedbackMsg.text}</span>
          </div>
        )}

        {/* Expandable Minimalist Composer Card */}
        {isAdding && (
          <div className="notes-composer-card">
            <div className="composer-header">
              <div className="composer-title-wrap">
                <Plus size={14} strokeWidth={2} />
                <span>Новая запись в память</span>
              </div>
              <button
                type="button"
                className="composer-close-btn"
                onClick={() => setIsAdding(false)}
                title="Закрыть"
              >
                <X size={14} strokeWidth={1.8} />
              </button>
            </div>

            <div className="composer-body">
              <textarea
                ref={textareaRef}
                className="notes-textarea"
                rows={3}
                placeholder="Введите правило или факт о проекте... (например: «Всегда использовать строгую типизацию TypeScript и модульный CSS»)"
                value={newContent}
                onChange={(e) => setNewContent(e.target.value)}
              />

              <div className="composer-controls-grid">
                <div className="composer-field">
                  <label>Категория</label>
                  <select
                    className="notes-select"
                    value={newCategory}
                    onChange={(e) => setNewCategory(e.target.value as any)}
                  >
                    <option value="user_preference">Личные правила и стиль кода</option>
                    <option value="project_fact">Стек и архитектура проекта</option>
                    <option value="procedural_workflow">Процессы и команды запуска</option>
                    <option value="fact">Общие знания и факты</option>
                  </select>
                </div>

                <div className="composer-field">
                  <label className="importance-label">
                    <span>Приоритет:</span>
                    <strong>
                      {newImportance} / 5 {newImportance >= 4 ? '(Закреплено)' : ''}
                    </strong>
                  </label>
                  <input
                    type="range"
                    min="1"
                    max="5"
                    step="1"
                    className="notes-slider"
                    value={newImportance}
                    onChange={(e) => setNewImportance(parseInt(e.target.value))}
                  />
                </div>

                <div className="composer-field full-width">
                  <label>Теги (через запятую)</label>
                  <input
                    type="text"
                    className="notes-input"
                    placeholder="react, typescript, css..."
                    value={newTags}
                    onChange={(e) => setNewTags(e.target.value)}
                  />
                </div>
              </div>
            </div>

            <div className="composer-footer">
              <button
                type="button"
                className="notes-btn-ghost"
                onClick={() => setIsAdding(false)}
              >
                Отмена
              </button>
              <button
                type="button"
                className="notes-btn-primary"
                onClick={handleAddMemory}
              >
                <Check size={13} strokeWidth={2} />
                <span>Сохранить</span>
              </button>
            </div>
          </div>
        )}

        {/* Search & Category Filter Bar */}
        <div className="notes-filter-bar">
          {/* Search Box */}
          {selectedCategory !== 'persona' && (
            <div className="notes-search-wrapper">
              <Search size={14} strokeWidth={1.8} className="notes-search-icon" />
              <input
                type="text"
                className="notes-search-input"
                placeholder="Поиск по заметкам и тегам..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
              {searchQuery && (
                <button
                  type="button"
                  className="notes-search-clear"
                  onClick={() => setSearchQuery('')}
                  title="Очистить"
                >
                  <X size={13} strokeWidth={1.8} />
                </button>
              )}
            </div>
          )}

          {/* Category Filter Pills */}
          <div className="notes-pills-row custom-scrollbar">
            {CATEGORIES.map((cat) => (
              <button
                key={cat.id}
                type="button"
                className={`notes-pill ${selectedCategory === cat.id ? 'active' : ''}`}
                onClick={() => handleSelectCategory(cat.id)}
              >
                <span className="pill-icon">{cat.icon}</span>
                <span>{cat.label}</span>
              </button>
            ))}
          </div>
        </div>

        {/* Global Core Memory Essence Card (Shown in memory categories) */}
        {selectedCategory !== 'sessions' && selectedCategory !== 'persona' && !searchQuery && (
          <div className="core-summary-card">
            <div className="core-summary-header">
              <div className="core-summary-title-wrap">
                <div className="core-summary-sparkle-icon">
                  <Sparkles size={13} strokeWidth={2} />
                </div>
                <div className="core-summary-titles">
                  <h3>Главная выжимка памяти (Core Memory Essence)</h3>
                  <span className="core-summary-subtitle">Сжатая суть базы знаний (добавляется в каждый промпт)</span>
                </div>
              </div>

              <div className="core-summary-actions">
                <button
                  type="button"
                  className="core-action-btn"
                  onClick={handleGenerateCoreSummary}
                  disabled={isGeneratingCoreSummary}
                  title="Синтезировать выжимку из всех заметок с помощью ИИ"
                >
                  <RefreshCw size={12} strokeWidth={1.8} className={isGeneratingCoreSummary ? 'spin-animation' : ''} />
                  <span>{isGeneratingCoreSummary ? 'Синтез...' : 'Синтезировать ИИ'}</span>
                </button>

                {!isEditingCoreSummary && (
                  <button
                    type="button"
                    className="core-action-btn edit"
                    onClick={() => {
                      setEditCoreSummaryText(coreSummary)
                      setIsEditingCoreSummary(true)
                    }}
                    title="Редактировать текст вручную"
                  >
                    <Edit3 size={12} strokeWidth={1.8} />
                    <span>Изменить</span>
                  </button>
                )}
              </div>
            </div>

            {isEditingCoreSummary ? (
              <div className="core-summary-edit-box">
                <textarea
                  className="notes-textarea core-edit"
                  rows={4}
                  value={editCoreSummaryText}
                  placeholder="- Основной стек: React + Vite + TypeScript&#10;- Предпочитает модульный CSS&#10;- Всегда запускать тесты перед коммитом"
                  onChange={(e) => setEditCoreSummaryText(e.target.value)}
                />
                <div className="core-edit-footer">
                  <button
                    type="button"
                    className="notes-btn-ghost compact"
                    onClick={() => setIsEditingCoreSummary(false)}
                  >
                    Отмена
                  </button>
                  <button
                    type="button"
                    className="notes-btn-primary compact"
                    onClick={handleSaveCoreSummary}
                  >
                    <Check size={12} strokeWidth={2} />
                    <span>Сохранить выжимку</span>
                  </button>
                </div>
              </div>
            ) : (
              <div className="core-summary-content">
                {coreSummary ? (
                  <div className="core-summary-text-rendered">
                    {coreSummary.split('\n').map((line, idx) => (
                      <div key={idx} className="core-summary-line">
                        {line}
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="core-summary-placeholder">
                    <span>Выжимка еще не создана. Нажмите «Синтезировать ИИ», чтобы автоматически сжать самое главное из заметок.</span>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* Main Content Area */}
        <div className="notes-content-area">
          {selectedCategory === 'persona' ? (
            /* Linguistic Persona Panel */
            <div className="persona-panel-card">
              <div className="persona-header-row">
                <div className="persona-header-title-wrap">
                  <div className="persona-icon-badge">
                    <Sparkles size={16} strokeWidth={2} />
                  </div>
                  <div>
                    <h2 className="persona-title">Стиль живого общения (Linguistic Persona)</h2>
                    <p className="persona-desc">
                      Настройка манеры речи ИИ. Адаптация под сленг, краткость, терминологию и тон напарника.
                    </p>
                  </div>
                </div>

                <div className="persona-toggle-wrap">
                  <button
                    type="button"
                    className={`persona-toggle-btn ${persona?.enabled ? 'enabled' : 'disabled'}`}
                    onClick={handleTogglePersona}
                    title={persona?.enabled ? 'Отключить персональный стиль' : 'Включить персональный стиль'}
                  >
                    <span className="toggle-indicator" />
                    <span>{persona?.enabled ? 'Стиль активен' : 'Отключен'}</span>
                  </button>
                </div>
              </div>

              {/* Persona Tone Presets Grid */}
              <div className="persona-section-block">
                <div className="persona-section-title">
                  <span>Тональность и манера речи</span>
                  <span className="persona-section-sub">Выберите базовый тон общения модели</span>
                </div>

                <div className="persona-tones-grid">
                  {PERSONA_TONES.map((tone) => {
                    const isSelected = persona?.tone === tone.id
                    return (
                      <div
                        key={tone.id}
                        className={`persona-tone-card ${isSelected ? 'selected' : ''}`}
                        onClick={() => handleUpdatePersonaTone(tone.id)}
                      >
                        <div className="tone-card-top">
                          <span className="tone-label">{tone.label}</span>
                          <span className="tone-badge">{tone.badge}</span>
                        </div>
                        <p className="tone-desc">{tone.desc}</p>
                      </div>
                    )
                  })}
                </div>
              </div>

              {/* AI Synthesized Linguistic Profile (From Sessions) */}
              <div className="persona-section-block">
                <div className="persona-section-title-row">
                  <div className="persona-section-title">
                    <span>Синтезированный профиль речи (ИИ-анализ)</span>
                    <span className="persona-section-sub">Автоматически выявленные особенности вашей речи из прошлых сессий</span>
                  </div>

                  <button
                    type="button"
                    className="core-action-btn"
                    onClick={handleGeneratePersonaProfile}
                    disabled={isGeneratingPersona}
                  >
                    <RefreshCw size={12} strokeWidth={1.8} className={isGeneratingPersona ? 'spin-animation' : ''} />
                    <span>{isGeneratingPersona ? 'Анализ...' : 'Синтезировать по сессиям'}</span>
                  </button>
                </div>

                <div className="persona-ai-profile-box">
                  {persona?.autoGeneratedProfile ? (
                    <p className="persona-ai-profile-text">
                      "{persona.autoGeneratedProfile}"
                    </p>
                  ) : (
                    <p className="persona-ai-profile-empty">
                      Профиль еще не синтезирован. Нажмите «Синтезировать по сессиям», чтобы ИИ проанализировал ваши диалоги.
                    </p>
                  )}
                </div>
              </div>

              {/* Custom User Style Rules Textarea */}
              <div className="persona-section-block">
                <div className="persona-section-title">
                  <span>Индивидуальные правила речи</span>
                  <span className="persona-section-sub">Ваши явные пожелания к стилю (например: «обращайся на ты», «без официоза», «отвечай емко»)</span>
                </div>

                <textarea
                  className="notes-textarea persona-custom-input"
                  rows={3}
                  placeholder="Например: Общайся свободно по-свойски, если здороваюсь 'вассап' — отвечай 'йоу'. Сразу давай код без лишних пояснений."
                  value={customPersonaPrompt}
                  onChange={(e) => setCustomPersonaPrompt(e.target.value)}
                />

                <div className="persona-save-row">
                  <button
                    type="button"
                    className="notes-btn-primary compact"
                    onClick={handleSavePersonaPrompt}
                  >
                    <Check size={12} strokeWidth={2} />
                    <span>Сохранить правила речи</span>
                  </button>
                </div>
              </div>
            </div>
          ) : selectedCategory === 'sessions' ? (
            /* Sessions Timeline View */
            <div className="sessions-list">
              {sessions.length === 0 ? (
                <div className="notes-empty-state">
                  <div className="empty-icon-wrap">
                    <History size={22} strokeWidth={1.6} />
                  </div>
                  <h3>История сессий пуста</h3>
                  <p>После завершения диалогов здесь автоматически будут сохраняться ключевые резюме.</p>
                </div>
              ) : (
                sessions.map((sess) => (
                  <div key={sess.id} className="session-item-card">
                    <div className="session-item-header">
                      <div className="session-header-left">
                        <span className="session-tag-pill">Сессия</span>
                        <h3 className="session-item-title">{sess.title}</h3>
                      </div>
                      <div className="session-header-right">
                        <span className="session-date-label">
                          <Clock size={11} strokeWidth={1.8} />
                          {new Date(sess.createdAt).toLocaleString('ru-RU', {
                            day: 'numeric',
                            month: 'short',
                            hour: '2-digit',
                            minute: '2-digit'
                          })}
                        </span>
                        <button
                          type="button"
                          className="card-action-btn delete"
                          onClick={() => handleDeleteSession(sess.id)}
                          title="Удалить сессию"
                        >
                          <Trash2 size={13} strokeWidth={1.8} />
                        </button>
                      </div>
                    </div>

                    <p className="session-body-text">{sess.summary}</p>

                    {sess.keywords && sess.keywords.length > 0 && (
                      <div className="session-keywords-list">
                        {sess.keywords.map((kw, i) => (
                          <span key={i} className="session-keyword-chip">
                            #{kw}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                ))
              )}
            </div>
          ) : (
            /* Memories / Notes List */
            <div className="notes-cards-list">
              {loading ? (
                <div className="notes-loading-state">
                  <RefreshCw size={18} strokeWidth={1.8} className="spin-animation" />
                  <span>Загрузка...</span>
                </div>
              ) : memories.length === 0 ? (
                <div className="notes-empty-state">
                  <div className="empty-icon-wrap">
                    <FileText size={22} strokeWidth={1.6} />
                  </div>
                  <h3>{searchQuery ? 'Ничего не найдено' : 'Записей пока нет'}</h3>
                  <p>
                    {searchQuery
                      ? 'Попробуйте изменить поисковый запрос или фильтр.'
                      : 'Добавьте первую заметку или правило, чтобы ИИ учитывал его в диалогах.'}
                  </p>
                  {!searchQuery && (
                    <button
                      type="button"
                      className="notes-btn-primary empty-action"
                      onClick={() => {
                        setIsAdding(true)
                        setTimeout(() => textareaRef.current?.focus(), 50)
                      }}
                    >
                      <Plus size={13} strokeWidth={2} />
                      <span>Создать заметку</span>
                    </button>
                  )}
                </div>
              ) : (
                memories.map((mem) => {
                  const isEditing = editingId === mem.id
                  const meta = getCategoryMeta(mem.category)
                  const isPinned = mem.importance >= 4

                  if (isEditing) {
                    return (
                      <div key={mem.id} className="note-card editing">
                        <div className="editing-header">
                          <span>Редактирование заметки</span>
                          <button
                            type="button"
                            className="editing-close-btn"
                            onClick={() => setEditingId(null)}
                          >
                            <X size={14} strokeWidth={1.8} />
                          </button>
                        </div>

                        <textarea
                          className="notes-textarea inline-edit"
                          rows={3}
                          value={editContent}
                          onChange={(e) => setEditContent(e.target.value)}
                        />

                        <div className="editing-toolbar">
                          <select
                            className="notes-select compact"
                            value={editCategory}
                            onChange={(e) => setEditCategory(e.target.value as any)}
                          >
                            <option value="user_preference">Личные правила</option>
                            <option value="project_fact">Стек / Проект</option>
                            <option value="procedural_workflow">Процессы</option>
                            <option value="fact">Общие знания</option>
                          </select>

                          <div className="slider-compact-wrap">
                            <span>Приоритет: {editImportance}/5</span>
                            <input
                              type="range"
                              min="1"
                              max="5"
                              value={editImportance}
                              onChange={(e) => setEditImportance(parseInt(e.target.value))}
                              className="notes-slider compact"
                            />
                          </div>

                          <input
                            type="text"
                            className="notes-input compact"
                            placeholder="Теги..."
                            value={editTags}
                            onChange={(e) => setEditTags(e.target.value)}
                          />

                          <div className="editing-actions">
                            <button
                              type="button"
                              className="notes-btn-ghost compact"
                              onClick={() => setEditingId(null)}
                            >
                              Отмена
                            </button>
                            <button
                              type="button"
                              className="notes-btn-primary compact"
                              onClick={handleSaveEdit}
                            >
                              <Check size={12} strokeWidth={2} />
                              <span>Сохранить</span>
                            </button>
                          </div>
                        </div>
                      </div>
                    )
                  }

                  return (
                    <div
                      key={mem.id}
                      className={`note-card ${isPinned ? 'pinned' : ''}`}
                    >
                      {/* Card Header Top */}
                      <div className="note-card-top">
                        <div className="card-badges-left">
                          <span className="note-category-badge">
                            {meta.icon}
                            <span>{meta.label}</span>
                          </span>

                          <div className="note-importance-dots" title={`Приоритет: ${mem.importance} из 5`}>
                            {[1, 2, 3, 4, 5].map((level) => (
                              <span
                                key={level}
                                className={`importance-dot ${level <= mem.importance ? 'filled' : ''}`}
                              />
                            ))}
                          </div>

                          {isPinned && (
                            <span className="note-pinned-chip">
                              <Pin size={10} strokeWidth={2} />
                              <span>Закреплено</span>
                            </span>
                          )}

                          {mem.similarityScore !== undefined && searchQuery && (
                            <span className="note-similarity-chip">
                              <span>{mem.similarityScore}% совпадение</span>
                            </span>
                          )}
                        </div>

                        {/* Hover Action Buttons */}
                        <div className="card-actions-right">
                          {mem.hitCount && mem.hitCount > 0 ? (
                            <span className="note-hit-badge" title="Количество обращений ИИ к этой записи">
                              {mem.hitCount} исп.
                            </span>
                          ) : null}

                          <button
                            type="button"
                            className={`card-action-btn pin ${isPinned ? 'active' : ''}`}
                            onClick={() => handleTogglePin(mem)}
                            title={isPinned ? 'Снять закрепление' : 'Закрепить в контексте'}
                          >
                            <Pin size={13} strokeWidth={1.8} />
                          </button>

                          <button
                            type="button"
                            className="card-action-btn"
                            onClick={() => handleCopy(mem.id, mem.content)}
                            title="Скопировать текст"
                          >
                            {copiedId === mem.id ? <Check size={13} strokeWidth={2} /> : <Copy size={13} strokeWidth={1.8} />}
                          </button>

                          <button
                            type="button"
                            className="card-action-btn"
                            onClick={() => startEdit(mem)}
                            title="Редактировать"
                          >
                            <Edit3 size={13} strokeWidth={1.8} />
                          </button>

                          <button
                            type="button"
                            className="card-action-btn delete"
                            onClick={() => handleDelete(mem.id)}
                            title="Удалить"
                          >
                            <Trash2 size={13} strokeWidth={1.8} />
                          </button>
                        </div>
                      </div>

                      {/* Content */}
                      <div className="note-card-content">
                        {mem.content}
                      </div>

                      {/* Card Bottom Footer */}
                      <div className="note-card-bottom">
                        <div className="note-tags-wrap">
                          {mem.tags && mem.tags.length > 0 ? (
                            mem.tags.map((tag, tIdx) => (
                              <span key={tIdx} className="note-tag-pill">
                                <Tag size={9} strokeWidth={1.8} />
                                <span>{tag}</span>
                              </span>
                            ))
                          ) : null}
                        </div>

                        <span className="note-updated-date">
                          {new Date(mem.updatedAt).toLocaleDateString('ru-RU', {
                            day: 'numeric',
                            month: 'short'
                          })}
                        </span>
                      </div>
                    </div>
                  )
                })
              )}
            </div>
          )}
        </div>

        {/* Minimalist Danger Clear Bar */}
        {memories.length > 0 && selectedCategory !== 'sessions' && selectedCategory !== 'persona' && (
          <footer className="notes-danger-footer">
            <div className="danger-text-wrap">
              <span className="danger-heading">Очистить базу знаний</span>
              <span className="danger-sub">Удалит все сохранённые заметки и правила.</span>
            </div>
            <button
              type="button"
              className="danger-btn-clear"
              onClick={handleClearAll}
            >
              <Trash2 size={12} strokeWidth={1.8} />
              <span>Очистить всё</span>
            </button>
          </footer>
        )}
      </div>
    </div>
  )
}

export default NotesView
