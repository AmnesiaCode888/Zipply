import React, { useState, useEffect } from 'react'
import { X, Check, AlertCircle } from 'lucide-react'
import { SkillItemUI } from '../../env'
import './SkillEditorModal.css'

interface SkillEditorModalProps {
  isOpen: boolean
  skill: SkillItemUI | null
  onClose: () => void
  onSave: (data: {
    name: string
    description: string
    content: string
    isCore: boolean
    metadata?: { globs?: string[]; triggers?: string[]; tags?: string[] }
  }) => Promise<void>
}

export const SkillEditorModal: React.FC<SkillEditorModalProps> = ({
  isOpen,
  skill,
  onClose,
  onSave
}) => {
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [content, setContent] = useState('')
  const [globsStr, setGlobsStr] = useState('')
  const [triggersStr, setTriggersStr] = useState('')
  const [tagsStr, setTagsStr] = useState('')
  const [isCore, setIsCore] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (skill) {
      setName(skill.name)
      setDescription(skill.description)
      setContent(skill.content)
      setGlobsStr(skill.globs ? skill.globs.join(', ') : '')
      setTriggersStr(skill.triggers ? skill.triggers.join(', ') : '')
      setTagsStr(skill.tags ? skill.tags.filter((t) => t !== 'global' && t !== 'core' && t !== 'extra').join(', ') : '')
      setIsCore(skill.isCore)
    } else {
      setName('')
      setDescription('')
      setContent('')
      setGlobsStr('')
      setTriggersStr('')
      setTagsStr('')
      setIsCore(false)
    }
    setError(null)
  }, [skill, isOpen])

  if (!isOpen) return null

  const handleSubmit = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault()
    const cleanName = name.trim().toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9_-]/g, '')
    const cleanDesc = description.trim()
    const cleanContent = content.trim()

    if (!cleanName) {
      setError('Укажите имя навыка (латинские буквы, дефис)')
      return
    }
    if (!cleanDesc) {
      setError('Укажите краткое описание для каталога')
      return
    }
    if (!cleanContent) {
      setError('Заполните текст инструкции')
      return
    }

    const globs = globsStr
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
    const triggers = triggersStr
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
    const tags = tagsStr
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)

    try {
      setIsSubmitting(true)
      setError(null)
      await onSave({
        name: cleanName,
        description: cleanDesc,
        content: cleanContent,
        isCore,
        metadata: {
          globs: globs.length > 0 ? globs : undefined,
          triggers: triggers.length > 0 ? triggers : undefined,
          tags: tags.length > 0 ? tags : undefined
        }
      })
      onClose()
    } catch (err: any) {
      setError(err?.message || 'Ошибка при сохранении навыка')
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <div className="skill-modal-overlay" onClick={onClose}>
      <div className="skill-modal-container" onClick={(e) => e.stopPropagation()}>
        <div className="skill-modal-header">
          <div className="skill-modal-title-wrap">
            <h3>{skill ? 'Редактировать навык' : 'Новый навык'}</h3>
          </div>
          <button className="skill-modal-close-btn" onClick={onClose} aria-label="Закрыть">
            <X size={15} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="skill-modal-form">
          {error && (
            <div className="skill-modal-error">
              <AlertCircle size={15} />
              <span>{error}</span>
            </div>
          )}

          <div className="skill-modal-field">
            <label>Имя навыка (kebab-case):</label>
            <input
              type="text"
              placeholder="например: docker-debug, vitest-setup"
              value={name}
              onChange={(e) => setName(e.target.value)}
              disabled={Boolean(skill)}
              required
            />
            <span className="skill-modal-hint">Используется агентом: read_skill("{name || 'name'}")</span>
          </div>

          <div className="skill-modal-field">
            <label>Описание (для каталога):</label>
            <input
              type="text"
              placeholder="Краткая суть: когда и зачем применять этот навык"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              required
            />
          </div>

          <div className="skill-modal-grid-2">
            <div className="skill-modal-field">
              <label>Маски файлов (globs):</label>
              <input
                type="text"
                placeholder="*.ts, src/**/*.tsx, Dockerfile"
                value={globsStr}
                onChange={(e) => setGlobsStr(e.target.value)}
              />
              <span className="skill-modal-hint">Через запятую</span>
            </div>

            <div className="skill-modal-field">
              <label>Ключевые триггеры:</label>
              <input
                type="text"
                placeholder="docker, compose, контейнер"
                value={triggersStr}
                onChange={(e) => setTriggersStr(e.target.value)}
              />
              <span className="skill-modal-hint">Слова для автоподбора</span>
            </div>
          </div>

          <div className="skill-modal-field">
            <label>Теги категории:</label>
            <input
              type="text"
              placeholder="devops, backend, clean-code"
              value={tagsStr}
              onChange={(e) => setTagsStr(e.target.value)}
            />
          </div>

          <div className="skill-modal-field">
            <label>Режим работы:</label>
            <div className="skill-type-toggle-group">
              <button
                type="button"
                className={`skill-type-btn ${!isCore ? 'active' : ''}`}
                onClick={() => setIsCore(false)}
              >
                <div className="skill-type-btn-content">
                  <strong>Extra (По требованию)</strong>
                  <span>ИИ видит в каталоге и загружает по необходимости</span>
                </div>
              </button>
              <button
                type="button"
                className={`skill-type-btn ${isCore ? 'active' : ''}`}
                onClick={() => setIsCore(true)}
              >
                <div className="skill-type-btn-content">
                  <strong>Core (Постоянный)</strong>
                  <span>Активен в системном промпте всегда</span>
                </div>
              </button>
            </div>
          </div>

          <div className="skill-modal-field">
            <div className="skill-instructions-label-row">
              <label>Инструкция (Markdown):</label>
              <span className="skill-format-badge">Markdown</span>
            </div>
            <textarea
              className="skill-modal-textarea"
              placeholder="# Инструкции:&#10;1. Перед началом...&#10;2. Проверь..."
              value={content}
              onChange={(e) => setContent(e.target.value)}
              rows={8}
              required
            />
          </div>

          <div className="skill-modal-actions">
            <button type="button" className="skill-btn-secondary" onClick={onClose} disabled={isSubmitting}>
              Отмена
            </button>
            <button type="submit" className="skill-btn-primary" disabled={isSubmitting}>
              {isSubmitting ? (
                <span>Сохранение...</span>
              ) : (
                <>
                  <Check size={14} strokeWidth={2.4} />
                  <span>{skill ? 'Сохранить' : 'Создать'}</span>
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
