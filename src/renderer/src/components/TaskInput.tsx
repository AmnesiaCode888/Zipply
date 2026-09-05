import React, { useState, useRef, useEffect, useMemo, useCallback } from 'react'
import {
  Paintbrush,
  Zap,
  RefreshCw,
  FlaskConical,
  FileText,
  Layers,
  ShieldCheck,
  LayoutTemplate,
  Database,
  Code2,
  Server,
  GitCommit,
  Asterisk,
  Plus,
  ArrowUp,
  Folder,
  FolderPlus,
  FolderOpen,
  X,
  Check,
  Image as ImageIcon,
  ChevronRight,
  ListTodo,
  Maximize2
} from 'lucide-react'
import { getModelDisplayName } from '../utils/modelUtils'
import { SettingsTab } from '../types/settings'
import { ProjectRef, AttachedImage } from '../types/chat'
import { useProjects } from '../hooks/useProjects'
import { extractPathsFromText, basenamePath } from '../utils/projects'
import { processImageFile, isImageFile } from '../utils/imageUtils'
import { dbLoadImage } from '../utils/indexedDb'
import './TaskInput.css'

interface SuggestionItem {
  id: string
  label: string
  prompt: string
  icon: React.ReactNode
}

interface TaskInputProps {
  onSubmit?: (text: string, project?: ProjectRef | null, images?: AttachedImage[]) => void
  onOpenSettings?: (tab?: SettingsTab) => void
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

const AttachedImageCard: React.FC<{
  img: AttachedImage
  onRemove: (id: string) => void
  onPreview?: (img: AttachedImage) => void
}> = ({ img, onRemove, onPreview }) => {
  const [dataUrl, setDataUrl] = useState<string>(img.dataUrl || '')
  const [loading, setLoading] = useState(!img.dataUrl && !!img.id)
  const [hasError, setHasError] = useState(false)

  useEffect(() => {
    if (img.dataUrl && img.dataUrl !== 'data:,' && img.dataUrl.length > 50) {
      setDataUrl(img.dataUrl)
      setHasError(false)
      setLoading(false)
    } else if (img.id) {
      setLoading(true)
      dbLoadImage(img.id)
        .then((loaded) => {
          if (loaded && loaded !== 'data:,' && loaded.length > 50) {
            setDataUrl(loaded)
            setHasError(false)
          } else {
            setHasError(true)
          }
        })
        .catch(() => setHasError(true))
        .finally(() => setLoading(false))
    }
  }, [img.dataUrl, img.id])

  const formattedSize = img.size
    ? img.size < 1024 * 1024
      ? `${Math.round(img.size / 1024)} KB`
      : `${(img.size / (1024 * 1024)).toFixed(1)} MB`
    : null

  const handlePreview = (): void => {
    onPreview?.({ ...img, dataUrl: dataUrl || img.dataUrl })
  }

  return (
    <div
      className="task-attached-image-card"
      title={`${img.name}${formattedSize ? ` (${formattedSize})` : ''} • Нажмите для просмотра`}
      onClick={handlePreview}
    >
      {loading ? (
        <div className="task-attached-image-skeleton">
          <div className="task-attached-skeleton-shimmer" />
        </div>
      ) : dataUrl && !hasError ? (
        <div className="task-attached-image-thumb-box">
          <img
            src={dataUrl}
            alt={img.name}
            className="task-attached-image-thumb"
            onError={() => setHasError(true)}
          />
          <div className="task-attached-hover-overlay">
            <Maximize2 size={14} className="task-attached-hover-icon" strokeWidth={2.2} />
          </div>
        </div>
      ) : (
        <div className="task-attached-image-fallback">
          <div className="task-attached-fallback-icon-wrap">
            <ImageIcon size={18} className="task-attached-fallback-icon" strokeWidth={1.8} />
          </div>
          <span className="task-attached-fallback-name">{img.name}</span>
        </div>
      )}

      <button
        type="button"
        className="task-attached-image-remove"
        onClick={(e) => {
          e.stopPropagation()
          onRemove(img.id)
        }}
        title="Удалить"
        aria-label="Remove image"
      >
        <X size={10} strokeWidth={2.6} />
      </button>
    </div>
  )
}

/**
 * Splits prompt text and wraps every detected path in a highlight span.
 * The FIRST path is the project folder (blue), the rest are plain references.
 */
function renderHighlightedText(text: string, paths: string[]): React.ReactNode[] {
  if (paths.length === 0) return [text]
  const pattern = paths.map(escapeRegExp).join('|')
  const re = new RegExp(`(${pattern})`, 'g')
  const nodes: React.ReactNode[] = []
  let last = 0
  let m: RegExpExecArray | null
  let i = 0
  let isFirst = true
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) nodes.push(text.slice(last, m.index))
    const isProject = isFirst
    isFirst = false
    nodes.push(
      <span
        key={`path-hl-${i++}`}
        className={isProject ? 'path-highlight project' : 'path-highlight ref'}
        data-path={m[1]}
      >
        {m[1]}
      </span>
    )
    last = m.index + m[1].length
  }
  if (last < text.length) nodes.push(text.slice(last))
  return nodes
}

export const TaskInput: React.FC<TaskInputProps> = ({ onSubmit, onOpenSettings }) => {
  const [taskText, setTaskText] = useState('')
  const [project, setProject] = useState<ProjectRef | null>(null)
  const [attachedImages, setAttachedImages] = useState<AttachedImage[]>([])
  const [previewImage, setPreviewImage] = useState<AttachedImage | null>(null)
  const [showMenu, setShowMenu] = useState(false)
  const [showProjectsSubmenu, setShowProjectsSubmenu] = useState(false)
  const [showNewFolder, setShowNewFolder] = useState(false)
  const [newFolderName, setNewFolderName] = useState('')
  const [isDragging, setIsDragging] = useState(false)
  const [tooltip, setTooltip] = useState<{ x: number; y: number; text: string } | null>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const highlightRef = useRef<HTMLDivElement>(null)
  const suggestionsScrollRef = useRef<HTMLDivElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const submenuTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const { projects, createProject, browseProject } = useProjects()

  const modelName = getModelDisplayName()
  const hasText = taskText.trim().length > 0
  const hasImages = attachedImages.length > 0
  const canRun = hasText || hasImages

  // Paths typed straight into the prompt win over a picked project.
  // The FIRST path is treated as the project folder; the rest are references.
  const paths = useMemo(() => extractPathsFromText(taskText), [taskText])
  const detectedPath = paths[0] ?? null
  const effectiveProject: ProjectRef | null = detectedPath
    ? { name: basenamePath(detectedPath), path: detectedPath }
    : project

  // Whether a project is currently active (either typed or picked)
  const hasProject = Boolean(effectiveProject)

  const handleRun = (): void => {
    if (!taskText.trim() && attachedImages.length === 0) return
    onSubmit?.(taskText.trim(), effectiveProject, attachedImages.length > 0 ? attachedImages : undefined)
    setTaskText('')
    setAttachedImages([])
    setProject(null)
    setShowMenu(false)
    setShowProjectsSubmenu(false)
    setShowNewFolder(false)
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto'
    }
  }

  const handleInput = (e: React.ChangeEvent<HTMLTextAreaElement>): void => {
    const v = e.target.value
    setTaskText(v)
    if (v.endsWith('@')) {
      setShowMenu(true)
      setShowProjectsSubmenu(true)
    }
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto'
      textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 200)}px`
      if (highlightRef.current) {
        highlightRef.current.scrollTop = textareaRef.current.scrollTop
      }
    }
  }

  const handleTextareaScroll = (e: React.UIEvent<HTMLTextAreaElement>): void => {
    if (highlightRef.current) {
      highlightRef.current.scrollTop = e.currentTarget.scrollTop
    }
  }

  const handleTextareaMouseMove = (e: React.MouseEvent<HTMLTextAreaElement>): void => {
    const mirror = highlightRef.current
    if (!mirror) return
    const spans = mirror.querySelectorAll<HTMLElement>('.path-highlight')
    for (const span of Array.from(spans)) {
      const r = span.getBoundingClientRect()
      if (e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom) {
        const path = span.dataset.path || ''
        const label = span.classList.contains('project') ? 'Папка проекта' : 'Путь'
        setTooltip({ x: e.clientX, y: r.top, text: `${label}: ${path}` })
        return
      }
    }
    setTooltip(null)
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>): void => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleRun()
    } else if (e.key === 'Escape') {
      if (showMenu) {
        setShowMenu(false)
        setShowProjectsSubmenu(false)
        setShowNewFolder(false)
      } else if (taskText) {
        e.preventDefault()
        setTaskText('')
      }
    }
  }

  const handleSuggestionClick = (promptText: string): void => {
    setTaskText(promptText)
    if (textareaRef.current) {
      textareaRef.current.focus()
      textareaRef.current.style.height = 'auto'
      textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 200)}px`
    }
  }

  const handleWheel = (e: React.WheelEvent<HTMLDivElement>): void => {
    if (suggestionsScrollRef.current && e.deltaY !== 0) {
      suggestionsScrollRef.current.scrollLeft += e.deltaY * 1.3
    }
  }

  const toggleMenu = (): void => {
    setShowMenu((p) => {
      const next = !p
      if (!next) {
        setShowProjectsSubmenu(false)
        setShowNewFolder(false)
      }
      return next
    })
  }

  const handleAttachClick = (): void => {
    fileInputRef.current?.click()
    setShowMenu(false)
    setShowProjectsSubmenu(false)
  }

  const addImageFiles = async (files: File[]): Promise<void> => {
    for (const file of files) {
      if (!file || file.size === 0) continue
      const processed = await processImageFile(file)
      if (processed) {
        setAttachedImages((prev) => [...prev, processed])
      }
    }
  }

  const handleFileInputChange = (e: React.ChangeEvent<HTMLInputElement>): void => {
    const files = Array.from(e.target.files || [])
    if (files.length > 0) {
      addImageFiles(files)
    }
    e.target.value = ''
  }

  const removeImage = (id: string): void => {
    setAttachedImages((prev) => prev.filter((img) => img.id !== id))
  }

  const handlePaste = async (e: React.ClipboardEvent<HTMLTextAreaElement>): Promise<void> => {
    const items = e.clipboardData?.items
    const files = e.clipboardData?.files
    const imageFiles: File[] = []

    if (items && items.length > 0) {
      for (let i = 0; i < items.length; i++) {
        const item = items[i]
        if (item.type.startsWith('image/') || item.kind === 'file') {
          const file = item.getAsFile()
          if (file && isImageFile(file)) {
            imageFiles.push(file)
          }
        }
      }
    }

    if (imageFiles.length === 0 && files && files.length > 0) {
      for (let i = 0; i < files.length; i++) {
        const file = files[i]
        if (isImageFile(file)) {
          imageFiles.push(file)
        }
      }
    }

    if (imageFiles.length > 0) {
      e.preventDefault()
      await addImageFiles(imageFiles)
    }
  }

  const handleDragOver = (e: React.DragEvent): void => {
    e.preventDefault()
    e.stopPropagation()
    if (e.dataTransfer?.types?.includes('Files')) {
      setIsDragging(true)
    }
  }

  const handleDragLeave = (e: React.DragEvent): void => {
    e.preventDefault()
    e.stopPropagation()
    setIsDragging(false)
  }

  const handleDrop = async (e: React.DragEvent): Promise<void> => {
    e.preventDefault()
    e.stopPropagation()
    setIsDragging(false)

    const imageFiles: File[] = []

    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      for (let i = 0; i < e.dataTransfer.files.length; i++) {
        const file = e.dataTransfer.files[i]
        if (isImageFile(file)) {
          imageFiles.push(file)
        }
      }
    }

    if (imageFiles.length === 0 && e.dataTransfer.items && e.dataTransfer.items.length > 0) {
      for (let i = 0; i < e.dataTransfer.items.length; i++) {
        const item = e.dataTransfer.items[i]
        if (item.kind === 'file') {
          const file = item.getAsFile()
          if (file && isImageFile(file)) {
            imageFiles.push(file)
          }
        }
      }
    }

    if (imageFiles.length > 0) {
      await addImageFiles(imageFiles)
    }
  }


  const handleMenuItemHover = (type: 'attach' | 'plan' | 'projects'): void => {
    if (submenuTimerRef.current) {
      clearTimeout(submenuTimerRef.current)
      submenuTimerRef.current = null
    }
    if (type === 'attach' || type === 'plan') {
      setShowProjectsSubmenu(false)
    } else if (type === 'projects') {
      setShowProjectsSubmenu(true)
    }
  }

  const handleProjectsItemLeave = (): void => {
    if (submenuTimerRef.current) clearTimeout(submenuTimerRef.current)
    submenuTimerRef.current = setTimeout(() => {
      setShowProjectsSubmenu(false)
    }, 220)
  }

  const handleSubmenuEnter = (): void => {
    if (submenuTimerRef.current) {
      clearTimeout(submenuTimerRef.current)
      submenuTimerRef.current = null
    }
    setShowProjectsSubmenu(true)
  }

  const handleSubmenuLeave = (): void => {
    if (submenuTimerRef.current) clearTimeout(submenuTimerRef.current)
    submenuTimerRef.current = setTimeout(() => {
      setShowProjectsSubmenu(false)
    }, 220)
  }

  const selectProject = useCallback((p: ProjectRef): void => {
    setProject(p)
    setShowMenu(false)
    setShowProjectsSubmenu(false)
    setShowNewFolder(false)
    // Drop the trailing "@" trigger char if present
    setTaskText((t) => (t.endsWith('@') ? t.slice(0, -1) : t))
  }, [])

  const clearProject = (): void => {
    setProject(null)
    if (detectedPath) {
      setTaskText((t) =>
        t
          .replace(detectedPath, ' ')
          .replace(/\s+/g, ' ')
          .trim()
      )
    }
    if (textareaRef.current) textareaRef.current.focus()
  }

  const handleCreateFolder = async (): Promise<void> => {
    const name = newFolderName.trim()
    if (!name) return
    const created = await createProject(name)
    if (created) {
      setProject(created)
      setNewFolderName('')
      setShowNewFolder(false)
      setShowMenu(false)
      setShowProjectsSubmenu(false)
    }
  }

  const handleBrowse = async (): Promise<void> => {
    const p = await browseProject()
    if (p) {
      setProject(p)
      setShowMenu(false)
      setShowProjectsSubmenu(false)
      setShowNewFolder(false)
    }
  }

  // Close the menu on outside click / Escape
  useEffect(() => {
    const onDown = (e: MouseEvent): void => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setShowMenu(false)
        setShowProjectsSubmenu(false)
        setShowNewFolder(false)
      }
    }
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        setShowMenu(false)
        setShowProjectsSubmenu(false)
        setShowNewFolder(false)
      }
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
      if (submenuTimerRef.current) clearTimeout(submenuTimerRef.current)
    }
  }, [])

  const suggestions: SuggestionItem[] = [
    {
      id: 'bug-fix',
      label: 'Баг фикс',
      prompt: 'Проанализируй кодовую базу, найди скрытые баги, ошибки типизации и логические несоответствия, после чего аккуратно исправь их: ',
      icon: <Paintbrush size={16} strokeWidth={2} />
    },
    {
      id: 'optimize',
      label: 'Оптимизировать',
      prompt: 'Проведи профилирование и оптимизацию: устрани лишние ререндеры, неэффективные алгоритмы, утечки памяти и тяжелые вычисления в: ',
      icon: <Zap size={16} strokeWidth={2} />
    },
    {
      id: 'explain',
      label: 'Объяснить',
      prompt: 'Подробно разбери архитектуру, стек вызовов, поток данных и логику работы с наглядными пояснениями: ',
      icon: (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="6" cy="6" r="2.5" />
          <circle cx="18" cy="6" r="2.5" />
          <circle cx="6" cy="18" r="2.5" />
          <circle cx="18" cy="18" r="2.5" />
          <line x1="8" y1="8" x2="16" y2="16" />
          <line x1="16" y1="8" x2="8" y2="16" />
        </svg>
      )
    },
    {
      id: 'refactor',
      label: 'Рефакторинг',
      prompt: 'Сделай глубокий рефакторинг по принципам Clean Code, SOLID и DRY — упрости код, раздели ответственности и улучши читаемость: ',
      icon: <RefreshCw size={16} strokeWidth={2} />
    },
    {
      id: 'tests',
      label: 'Написать тесты',
      prompt: 'Напиши исчерпывающий набор unit и integration тестов с моками, проверкой граничных случаев и негативных сценариев для: ',
      icon: <FlaskConical size={16} strokeWidth={2} />
    },
    {
      id: 'docs',
      label: 'Документация',
      prompt: 'Составь подробную техническую документацию, JSDoc/TypeDoc комментарии, описание параметров и примеры вызова для: ',
      icon: <FileText size={16} strokeWidth={2} />
    },
    {
      id: 'architecture',
      label: 'Архитектура',
      prompt: 'Спроектируй масштабируемую архитектуру, схему модулей, интерфейсы взаимодействия и структуру каталогов для: ',
      icon: <Layers size={16} strokeWidth={2} />
    },
    {
      id: 'security',
      label: 'Безопасность',
      prompt: 'Проведи комплексный аудит безопасности: проверь валидацию входных данных, потенциальные уязвимости и авторизацию в: ',
      icon: <ShieldCheck size={16} strokeWidth={2} />
    },
    {
      id: 'ui-component',
      label: 'UI Компонент',
      prompt: 'Создай современный адаптивный React-компонент со стилизацией, плавной анимацией, доступностью (a11y) и строгими типами: ',
      icon: <LayoutTemplate size={16} strokeWidth={2} />
    },
    {
      id: 'sql',
      label: 'SQL Запрос',
      prompt: 'Напиши высокопроизводительный SQL-запрос с правильными индексами, планом выполнения, транзакциями и защитой от инъекций для: ',
      icon: <Database size={16} strokeWidth={2} />
    },
    {
      id: 'typescript',
      label: 'Типизация TS',
      prompt: 'Добавь строгую типизацию TypeScript: точные дженерики, утилитные типы, интерфейсы и валидацию схем для: ',
      icon: <Code2 size={16} strokeWidth={2} />
    },
    {
      id: 'api-endpoint',
      label: 'REST API',
      prompt: 'Разработай REST API эндпоинт с валидацией схемы DTO, обработкой ошибок, статус-кодами, логированием и типами для: ',
      icon: <Server size={16} strokeWidth={2} />
    },
    {
      id: 'git-commit',
      label: 'Git коммит',
      prompt: 'Изучи изменения через git diff и сформируй информативные коммиты по стандарту Conventional Commits (feat, fix, refactor) для: ',
      icon: <GitCommit size={16} strokeWidth={2} />
    },
    {
      id: 'regex',
      label: 'Regex',
      prompt: 'Составь оптимизированное регулярное выражение с именованными группами захвата, разбором граничных кейсов и тестами для: ',
      icon: <Asterisk size={16} strokeWidth={2} />
    }
  ]

  return (
    <div className="task-input-wrapper">
      <h1 className="task-title">Что делать?</h1>

      <div
        className={`task-card ${isDragging ? 'dragging-over' : ''}`}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        {/* Attached Images Preview Row */}
        {attachedImages.length > 0 && (
          <div className="task-attached-images-row">
            {attachedImages.map((img) => (
              <AttachedImageCard
                key={img.id}
                img={img}
                onRemove={removeImage}
                onPreview={setPreviewImage}
              />
            ))}
          </div>
        )}

        <div className="task-prompt-row">
          <div className="task-prefix-icon" aria-hidden="true">
            <svg
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.4"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <polyline points="4 6 11 12 4 18" />
              <line x1="13" y1="18" x2="20" y2="18" />
            </svg>
          </div>

          <div className="task-textarea-wrap">
            <div
              ref={highlightRef}
              className="task-textarea-highlight"
              aria-hidden="true"
            >
              {renderHighlightedText(taskText, paths)}
              {'\u200b'}
            </div>

            <textarea
              ref={textareaRef}
              className="task-textarea"
              placeholder="Describe your task..."
              value={taskText}
              onChange={handleInput}
              onKeyDown={handleKeyDown}
              onPaste={handlePaste}
              onScroll={handleTextareaScroll}
              onMouseMove={handleTextareaMouseMove}
              onMouseLeave={() => setTooltip(null)}
              rows={1}
              spellCheck={false}
            />
          </div>
        </div>

        <div className="task-actions-row">
          <div className="task-left-controls" ref={menuRef}>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/png,image/jpeg,image/webp,image/gif,image/bmp,image/svg+xml"
              multiple
              style={{ display: 'none' }}
              onChange={handleFileInputChange}
            />

            <button
              type="button"
              className={`task-add-btn ${showMenu ? 'active' : ''} ${effectiveProject ? 'has-project' : ''}`}
              title="Добавить изображение или выбрать проект"
              aria-label="Add image or choose project"
              onClick={toggleMenu}
            >
              <Plus size={15} strokeWidth={2.4} />
            </button>

            {showMenu && (
              <div className="task-add-menu">
                <button
                  type="button"
                  className="task-add-menu-item"
                  onClick={handleAttachClick}
                  onMouseEnter={() => handleMenuItemHover('attach')}
                >
                  <ImageIcon size={16} className="task-add-menu-icon" strokeWidth={1.8} />
                  <span className="task-add-menu-label">Прикрепить изображение</span>
                </button>

                <button
                  type="button"
                  className="task-add-menu-item"
                  onClick={() => {
                    setShowMenu(false)
                    setShowProjectsSubmenu(false)
                  }}
                  onMouseEnter={() => handleMenuItemHover('plan')}
                >
                  <ListTodo size={16} className="task-add-menu-icon" strokeWidth={1.8} />
                  <span className="task-add-menu-label">Создать план</span>
                </button>

                <div
                  className="task-add-menu-item-wrapper"
                  onMouseEnter={() => handleMenuItemHover('projects')}
                  onMouseLeave={handleProjectsItemLeave}
                >
                  <button
                    type="button"
                    className={`task-add-menu-item task-projects-trigger ${showProjectsSubmenu ? 'active' : ''}`}
                    onClick={() => setShowProjectsSubmenu((v) => !v)}
                  >
                    <Folder size={16} className="task-add-menu-icon" strokeWidth={1.8} />
                    <span className="task-add-menu-label">Проекты</span>
                    <ChevronRight size={14} className="task-add-menu-arrow" strokeWidth={1.8} />
                  </button>

                  {showProjectsSubmenu && (
                    <div
                      className="project-picker-submenu"
                      onMouseEnter={handleSubmenuEnter}
                      onMouseLeave={handleSubmenuLeave}
                    >
                      <div className="project-picker-header">
                        <span className="project-picker-title">Папка проекта</span>
                        <button
                          type="button"
                          className={`project-new-folder-btn ${showNewFolder ? 'active' : ''}`}
                          onClick={() => setShowNewFolder((v) => !v)}
                          title={showNewFolder ? 'Отмена' : 'Создать новую папку'}
                        >
                          <FolderPlus size={11} strokeWidth={2} />
                          <span>{showNewFolder ? 'Отмена' : 'Новая папка'}</span>
                        </button>
                      </div>

                      {showNewFolder && (
                        <div className="project-new-folder-row">
                          <input
                            className="project-new-folder-input"
                            placeholder="Название папки..."
                            value={newFolderName}
                            autoFocus
                            onChange={(e) => setNewFolderName(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') {
                                e.preventDefault()
                                handleCreateFolder()
                              } else if (e.key === 'Escape') {
                                setShowNewFolder(false)
                              }
                            }}
                          />
                          <button
                            type="button"
                            className="project-new-folder-create"
                            onClick={handleCreateFolder}
                            disabled={!newFolderName.trim()}
                          >
                            Создать
                          </button>
                        </div>
                      )}

                      <div className="project-picker-list">
                        {projects.length === 0 ? (
                          <div className="project-picker-empty">
                            <span>Нет сохранённых папок</span>
                          </div>
                        ) : (
                          projects.map((p) => {
                            const isSelected = effectiveProject?.path === p.path
                            return (
                              <button
                                key={p.path}
                                type="button"
                                className={`project-picker-item ${isSelected ? 'active' : ''}`}
                                onClick={() => selectProject(p)}
                                title={p.path}
                              >
                                <Folder size={13} className="project-picker-item-icon" strokeWidth={1.8} />
                                <div className="project-picker-item-meta">
                                  <span className="project-picker-item-name">{p.name}</span>
                                  <span className="project-picker-item-path">{p.path}</span>
                                </div>
                                {isSelected && (
                                  <Check size={12} className="project-picker-item-check" strokeWidth={2.4} />
                                )}
                              </button>
                            )
                          })
                        )}
                      </div>

                      <div className="project-picker-footer">
                        <button type="button" className="project-picker-browse" onClick={handleBrowse}>
                          <FolderOpen size={13} strokeWidth={1.8} />
                          <span>Выбрать папку…</span>
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}

            {effectiveProject && !detectedPath && (
              <div
                className="task-project-tag"
                title={`Папка: ${effectiveProject.path} (нажмите для смены)`}
              >
                <span className="task-project-tag-btn" onClick={toggleMenu}>
                  <Folder size={12} strokeWidth={2} />
                  <span>{effectiveProject.name}</span>
                </span>
                <button
                  type="button"
                  className="project-tag-clear"
                  onClick={(e) => {
                    e.stopPropagation()
                    clearProject()
                  }}
                  title="Убрать проект"
                  aria-label="Remove project"
                >
                  <X size={11} strokeWidth={2.4} />
                </button>
              </div>
            )}
          </div>

          <div className="task-right-controls">
            <button
              type="button"
              className="task-model-pill"
              onClick={() => onOpenSettings?.('models')}
              title="Выбрать модель ИИ в настройках"
            >
              {modelName}
            </button>

            <button
              type="button"
              className={`task-run-btn ${canRun ? 'has-text' : ''}`}
              title="Запустить"
              aria-label="Run task"
              onClick={handleRun}
            >
              <span className="run-icon-wrapper" aria-hidden="true">
                <ArrowUp size={15} strokeWidth={2.5} />
              </span>
              <span className="run-text-label">Run</span>
            </button>
          </div>
        </div>
      </div>

      {/* Horizontally Scrollable Quick Action Suggestions — smoothly emerges from under task card when a project is chosen */}
      <div className={`task-suggestions-wrapper ${hasProject ? 'is-visible' : ''}`}>
        <div className="task-suggestions-inner">
          <div
            ref={suggestionsScrollRef}
            className="task-suggestions-row"
            onWheel={handleWheel}
          >
            {suggestions.map((item) => (
              <button
                key={item.id}
                type="button"
                className="task-suggestion-pill"
                onClick={() => handleSuggestionClick(item.prompt)}
                tabIndex={hasProject ? 0 : -1}
              >
                <span className="task-suggestion-icon" aria-hidden="true">
                  {item.icon}
                </span>
                <span>{item.label}</span>
              </button>
            ))}
          </div>
        </div>
      </div>

      {tooltip && (
        <div className="task-tooltip" style={{ left: tooltip.x, top: tooltip.y - 8 }}>
          {tooltip.text}
        </div>
      )}

      {/* Full-size Image Lightbox Modal */}
      {previewImage && (
        <div className="image-lightbox-overlay" onClick={() => setPreviewImage(null)}>
          <div className="image-lightbox-container" onClick={(e) => e.stopPropagation()}>
            <button
              type="button"
              className="image-lightbox-close"
              onClick={() => setPreviewImage(null)}
              title="Закрыть (Esc)"
              aria-label="Close image preview"
            >
              <X size={16} strokeWidth={2.4} />
            </button>
            <img
              src={previewImage.dataUrl}
              alt={previewImage.name}
              className="image-lightbox-img"
            />
            <div className="image-lightbox-footer">
              <span className="image-lightbox-name">{previewImage.name}</span>
              {previewImage.size ? (
                <span className="image-lightbox-size">
                  {Math.round(previewImage.size / 1024)} KB
                </span>
              ) : null}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default TaskInput
