import React, { useState, useMemo } from 'react'
import {
  X,
  Sparkles,
  FolderTree,
  FileCode2,
  AlertCircle,
  FolderDown
} from 'lucide-react'
import { SkillItemUI } from '../../env'
import './CodexTransferModal.css'

interface CodexTransferModalProps {
  isOpen: boolean
  onClose: () => void
  onSuccess: (message: string) => void
  skills: SkillItemUI[]
}

export const CodexTransferModal: React.FC<CodexTransferModalProps> = ({
  isOpen,
  onClose,
  onSuccess,
  skills
}) => {
  const codexSkills = useMemo(() => {
    return skills.filter((s) => s.source === 'codex' || (s.category && s.category === 'codex'))
  }, [skills])

  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => {
    return new Set(codexSkills.map((s) => s.id))
  })
  const [targetCategory, setTargetCategory] = useState<'custom' | 'engineering' | 'tools' | 'system'>('custom')
  const [isCore, setIsCore] = useState(false)
  const [isTransferring, setIsTransferring] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (!isOpen) return null

  const handleToggleSelectAll = (): void => {
    if (selectedIds.size === codexSkills.length) {
      setSelectedIds(new Set())
    } else {
      setSelectedIds(new Set(codexSkills.map((s) => s.id)))
    }
  }

  const handleToggleItem = (id: string): void => {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) {
        next.delete(id)
      } else {
        next.add(id)
      }
      return next
    })
  }

  const handleTransfer = async (): Promise<void> => {
    const chosenSkills = codexSkills.filter((s) => selectedIds.has(s.id))
    if (chosenSkills.length === 0) {
      setError('Выберите хотя бы один навык для переноса')
      return
    }

    try {
      setIsTransferring(true)
      setError(null)

      const itemsToTransfer = chosenSkills.map((s) => ({
        name: s.name,
        sourcePath: s.filePath,
        isFolder: s.isFolder
      }))

      if (window.api?.skills?.transfer) {
        const res = await window.api.skills.transfer(itemsToTransfer, targetCategory, isCore)
        if (res.success) {
          onSuccess(
            `Успешно перенесено ${res.count} навыков из Codex в раздел «${targetCategory}»`
          )
          onClose()
        } else {
          setError(res.error || 'Ошибка при переносе навыков')
        }
      } else {
        setError('Функция переноса недоступна в текущем окружении')
      }
    } catch (err: any) {
      setError(err?.message || 'Не удалось перенести навыки')
    } finally {
      setIsTransferring(false)
    }
  }

  const isAllSelected = codexSkills.length > 0 && selectedIds.size === codexSkills.length

  return (
    <div className="skill-modal-overlay" onClick={onClose}>
      <div className="skill-modal-container codex-transfer-modal" onClick={(e) => e.stopPropagation()}>
        <div className="skill-modal-header">
          <div className="skill-modal-title-wrap">
            <div className="codex-transfer-title-icon">
              <Sparkles size={18} color="#a78bfa" />
            </div>
            <div>
              <h3>Перенос навыков из Codex в Zipply</h3>
              <p className="codex-transfer-subtitle">
                Перенос навыков в локальную библиотеку Zipply с полным сохранением вложенных файлов, скриптов и инструкций.
              </p>
            </div>
          </div>
          <button className="skill-modal-close-btn" onClick={onClose} aria-label="Закрыть">
            <X size={15} />
          </button>
        </div>

        {error && (
          <div className="skill-modal-error">
            <AlertCircle size={15} />
            <span>{error}</span>
          </div>
        )}

        <div className="codex-transfer-body">
          {codexSkills.length === 0 ? (
            <div className="codex-empty-state">
              <Sparkles size={28} className="codex-empty-icon" />
              <p>Внешние навыки Codex не найдены в ~/.codex/skills или .codex/skills проекта.</p>
            </div>
          ) : (
            <>
              <div className="codex-selection-header">
                <label className="codex-select-all-label">
                  <input
                    type="checkbox"
                    checked={isAllSelected}
                    onChange={handleToggleSelectAll}
                  />
                  <span>
                    Выбрать все ({selectedIds.size} из {codexSkills.length})
                  </span>
                </label>
              </div>

              <div className="codex-skills-list-container">
                {codexSkills.map((skill) => {
                  const isChecked = selectedIds.has(skill.id)
                  return (
                    <div
                      key={skill.id}
                      className={`codex-skill-item ${isChecked ? 'selected' : ''}`}
                      onClick={() => handleToggleItem(skill.id)}
                    >
                      <input
                        type="checkbox"
                        checked={isChecked}
                        onChange={() => {}} // handled by parent div
                        onClick={(e) => e.stopPropagation()}
                      />
                      <div className="codex-skill-item-info">
                        <div className="codex-skill-item-row">
                          <span className="codex-skill-item-name">{skill.name}</span>
                          {skill.isFolder ? (
                            <span className="codex-skill-item-badge folder" title="Пакетный навык с файлами">
                              <FolderTree size={11} />
                              <span>{skill.files?.length || 1} файлов</span>
                            </span>
                          ) : (
                            <span className="codex-skill-item-badge file">
                              <FileCode2 size={11} />
                              <span>.md</span>
                            </span>
                          )}
                        </div>
                        <p className="codex-skill-item-desc">{skill.description}</p>
                      </div>
                    </div>
                  )
                })}
              </div>

              {/* Destination Options */}
              <div className="codex-transfer-options-panel">
                <div className="codex-option-row">
                  <label className="codex-option-label">Целевой раздел в Zipply:</label>
                  <select
                    className="codex-option-select"
                    value={targetCategory}
                    onChange={(e) => setTargetCategory(e.target.value as any)}
                  >
                    <option value="custom">Пользовательские (custom)</option>
                    <option value="engineering">Разработка и стек (engineering)</option>
                    <option value="tools">Инструменты Zipply (tools)</option>
                    <option value="system">Системные правила (system)</option>
                  </select>
                </div>

                <div className="codex-option-row">
                  <label className="codex-option-label">Режим загрузки:</label>
                  <div className="codex-radio-group">
                    <label className="codex-radio-label">
                      <input
                        type="radio"
                        name="isCore"
                        checked={!isCore}
                        onChange={() => setIsCore(false)}
                      />
                      <span>По требованию (Extra) — загружается через read_skill</span>
                    </label>
                    <label className="codex-radio-label">
                      <input
                        type="radio"
                        name="isCore"
                        checked={isCore}
                        onChange={() => setIsCore(true)}
                      />
                      <span>В памяти всегда (Core) — в каждом запросе</span>
                    </label>
                  </div>
                </div>
              </div>
            </>
          )}
        </div>

        <div className="skill-modal-actions">
          <button type="button" className="skill-cancel-btn" onClick={onClose} disabled={isTransferring}>
            Отмена
          </button>
          <button
            type="button"
            className="skill-submit-btn codex-submit-btn"
            onClick={handleTransfer}
            disabled={isTransferring || selectedIds.size === 0 || codexSkills.length === 0}
          >
            {isTransferring ? (
              <span>Перенос...</span>
            ) : (
              <>
                <FolderDown size={14} />
                <span>Перенести в Zipply ({selectedIds.size})</span>
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  )
}
