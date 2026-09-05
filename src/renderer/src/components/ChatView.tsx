import React, { useState, useRef, useEffect, useCallback } from 'react'
import {
  Plus,
  ArrowUp,
  Square,
  Folder,
  FolderPlus,
  FolderOpen,
  Check,
  X,
  Image as ImageIcon,
  ChevronRight,
  ListTodo,
  Maximize2
} from 'lucide-react'
import { ChatMessage, ChatSession, AttachedImage, ProjectRef } from '../types/chat'
import { useProjects } from '../hooks/useProjects'
import { ToolRound } from './ToolRound'
import { SubagentRound } from './SubagentRound'
import { WatchdogCard } from './WatchdogCard'
import { StreamingMarkdown } from './StreamingMarkdown'
import { getModelDisplayName } from '../utils/modelUtils'
import { processImageFile, isImageFile } from '../utils/imageUtils'
import { dbLoadImage } from '../utils/indexedDb'
import { SettingsTab } from '../types/settings'
import './ChatView.css'

interface ChatViewProps {
  chat: ChatSession
  isStreaming?: boolean
  onSendMessage: (text: string, project?: ProjectRef | null, images?: AttachedImage[]) => void
  onCancel?: () => void
  onOpenSettings?: (tab?: SettingsTab) => void
}

interface MessageRowProps {
  message: ChatMessage
  isLastMsg: boolean
  isStreaming: boolean
  onTick: () => void
  onImageClick?: (img: AttachedImage) => void
}

const ImageThumb: React.FC<{
  img: AttachedImage
  onClick?: (img: AttachedImage) => void
}> = ({ img, onClick }) => {
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

  const handleClick = (): void => {
    onClick?.({ ...img, dataUrl: dataUrl || img.dataUrl })
  }

  return (
    <div
      className="chat-user-image-thumb-card"
      onClick={handleClick}
      title={`${img.name}${formattedSize ? ` (${formattedSize})` : ''} • Нажмите для просмотра`}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          handleClick()
        }
      }}
    >
      {loading ? (
        <div className="chat-user-image-skeleton">
          <div className="chat-user-skeleton-shimmer" />
        </div>
      ) : hasError || !dataUrl ? (
        <div className="chat-user-image-fallback">
          <div className="chat-user-fallback-icon-wrap">
            <ImageIcon size={20} className="chat-user-fallback-icon" strokeWidth={1.8} />
          </div>
          <span className="chat-user-fallback-name">{img.name}</span>
        </div>
      ) : (
        <div className="chat-user-image-wrap">
          <img
            src={dataUrl}
            alt={img.name}
            className="chat-user-image-img"
            onError={() => setHasError(true)}
          />
          <div className="chat-user-image-overlay">
            <Maximize2 size={16} className="chat-user-expand-icon" strokeWidth={2.4} />
          </div>
        </div>
      )}
    </div>
  )
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
      className="chat-attached-image-card"
      title={`${img.name}${formattedSize ? ` (${formattedSize})` : ''} • Нажмите для просмотра`}
      onClick={handlePreview}
    >
      {loading ? (
        <div className="chat-attached-image-skeleton">
          <div className="chat-attached-skeleton-shimmer" />
        </div>
      ) : dataUrl && !hasError ? (
        <div className="chat-attached-image-thumb-box">
          <img
            src={dataUrl}
            alt={img.name}
            className="chat-attached-image-thumb"
            onError={() => setHasError(true)}
          />
          <div className="chat-attached-hover-overlay">
            <Maximize2 size={14} className="task-attached-hover-icon" strokeWidth={2.2} />
          </div>
        </div>
      ) : (
        <div className="chat-attached-image-fallback">
          <div className="chat-attached-fallback-icon-wrap">
            <ImageIcon size={18} className="chat-attached-fallback-icon" strokeWidth={1.8} />
          </div>
          <span className="chat-attached-fallback-name">{img.name}</span>
        </div>
      )}

      <button
        type="button"
        className="chat-attached-image-remove"
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
 * Memoized message row: during streaming only the LAST assistant message changes,
 * so the rest of the conversation skips re-rendering on every token.
 */
const MessageRow: React.FC<MessageRowProps> = React.memo(function MessageRow({
  message,
  isLastMsg,
  isStreaming,
  onTick,
  onImageClick
}: MessageRowProps) {
  if (message.role === 'user') {
    return (
      <div className="chat-message-row user-row">
        <div className="chat-user-bubble-container">
          {message.images && message.images.length > 0 && (
            <div className="chat-user-images-gallery">
              {message.images.map((img) => (
                <ImageThumb key={img.id} img={img} onClick={onImageClick} />
              ))}
            </div>
          )}
          {message.text && <div className="chat-user-bubble">{message.text}</div>}
        </div>
      </div>
    )
  }

  return (
    <div className="chat-message-row assistant-row">
      {/* Multi-round Re-Act Segments */}
      {message.segments && message.segments.length > 0 ? (
        message.segments.map((seg, sIdx) => {
          if (seg.type === 'text') {
            if (!seg.content || !seg.content.trim()) return null
            const isLastSeg = sIdx === message.segments!.length - 1
            const isSegStreaming = isStreaming && isLastMsg && isLastSeg

            return (
              <div key={seg.id} className="assistant-commentary-text">
                <StreamingMarkdown
                  content={seg.content}
                  isStreaming={isSegStreaming}
                  onTick={onTick}
                />
              </div>
            )
          }

          if (seg.type === 'tool_round') {
            return (
              <ToolRound
                key={seg.id}
                steps={seg.steps}
                isThinking={seg.isThinking}
                totalWorkedSeconds={seg.totalWorkedSeconds}
                summary={seg.summary}
              />
            )
          }

          if (seg.type === 'subagent_round') {
            const isLastSeg = sIdx === message.segments!.length - 1
            const isSubagentStreaming = isStreaming && isLastMsg && isLastSeg && seg.isThinking
            return (
              <SubagentRound
                key={seg.id}
                segment={seg}
                isStreaming={isSubagentStreaming}
                onTick={onTick}
              />
            )
          }

          if (seg.type === 'watchdog') {
            return <WatchdogCard key={seg.id} segment={seg} />
          }

          return null
        })
      ) : (
        /* Fallback simple format or empty placeholder while thinking */
        <>
          {message.text ? (
            <div className="assistant-intro-text">
              <StreamingMarkdown
                content={message.text}
                isStreaming={isStreaming && isLastMsg}
                onTick={onTick}
              />
            </div>
          ) : message.isThinking ? (
            <ToolRound steps={[]} isThinking={true} />
          ) : null}
        </>
      )}
    </div>
  )
})

MessageRow.displayName = 'MessageRow'

export const ChatView: React.FC<ChatViewProps> = ({
  chat,
  isStreaming = false,
  onSendMessage,
  onCancel,
  onOpenSettings
}) => {
  const [inputText, setInputText] = useState('')
  const [attachedImages, setAttachedImages] = useState<AttachedImage[]>([])
  const [activeProject, setActiveProject] = useState<ProjectRef | null>(chat.project || null)
  const [showMenu, setShowMenu] = useState(false)
  const [showProjectsSubmenu, setShowProjectsSubmenu] = useState(false)
  const [showNewFolder, setShowNewFolder] = useState(false)
  const [newFolderName, setNewFolderName] = useState('')
  const [isDragging, setIsDragging] = useState(false)
  const [previewImage, setPreviewImage] = useState<AttachedImage | null>(null)

  const messagesEndRef = useRef<HTMLDivElement>(null)
  const scrollContainerRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const submenuTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const isUserScrolledUpRef = useRef<boolean>(false)

  const { projects, createProject, browseProject } = useProjects()

  const modelName = getModelDisplayName()
  const hasText = inputText.trim().length > 0
  const hasImages = attachedImages.length > 0
  const canSend = hasText || hasImages

  // Keep active project in sync if chat.project changes
  useEffect(() => {
    if (chat.project) {
      setActiveProject(chat.project)
    }
  }, [chat.project])

  const scrollToBottom = useCallback((behavior: ScrollBehavior = 'smooth'): void => {
    if (messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior })
    }
  }, [])

  // Auto-scroll when messages update, if the user hasn't scrolled up.
  useEffect(() => {
    if (isUserScrolledUpRef.current) return
    if (isStreaming) {
      if (scrollContainerRef.current) {
        scrollContainerRef.current.scrollTop = scrollContainerRef.current.scrollHeight
      }
    } else {
      scrollToBottom('smooth')
    }
  }, [chat.messages, isStreaming, scrollToBottom])

  // Track manual scrolling to avoid locking user when they scroll up
  const handleScroll = (e: React.UIEvent<HTMLDivElement>): void => {
    const el = e.currentTarget
    const distanceToBottom = el.scrollHeight - el.scrollTop - el.clientHeight
    isUserScrolledUpRef.current = distanceToBottom > 80
  }

  // Smooth scroll callback during stream typewriter ticks
  const handleStreamTick = useCallback((): void => {
    if (!isUserScrolledUpRef.current && scrollContainerRef.current) {
      const el = scrollContainerRef.current
      el.scrollTop = el.scrollHeight
    }
  }, [])

  const handleSend = (): void => {
    if (isStreaming) {
      onCancel?.()
      return
    }
    if (!inputText.trim() && attachedImages.length === 0) return
    isUserScrolledUpRef.current = false
    onSendMessage(inputText.trim(), activeProject, attachedImages.length > 0 ? attachedImages : undefined)
    setInputText('')
    setAttachedImages([])
    setShowMenu(false)
    setShowProjectsSubmenu(false)
    setShowNewFolder(false)
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto'
    }
  }

  const handleInput = (e: React.ChangeEvent<HTMLTextAreaElement>): void => {
    const v = e.target.value
    setInputText(v)
    if (v.endsWith('@')) {
      setShowMenu(true)
      setShowProjectsSubmenu(true)
    }
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto'
      const nextH = Math.min(textareaRef.current.scrollHeight, 180)
      textareaRef.current.style.height = `${nextH}px`
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>): void => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    } else if (e.key === 'Escape') {
      if (previewImage) {
        setPreviewImage(null)
      } else if (showMenu) {
        setShowMenu(false)
        setShowProjectsSubmenu(false)
        setShowNewFolder(false)
      } else if (inputText) {
        e.preventDefault()
        setInputText('')
      }
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
    setActiveProject(p)
    setShowMenu(false)
    setShowProjectsSubmenu(false)
    setShowNewFolder(false)
    setInputText((t) => (t.endsWith('@') ? t.slice(0, -1) : t))
  }, [])

  const handleCreateFolder = async (): Promise<void> => {
    const name = newFolderName.trim()
    if (!name) return
    const created = await createProject(name)
    if (created) {
      setActiveProject(created)
      setNewFolderName('')
      setShowNewFolder(false)
      setShowMenu(false)
      setShowProjectsSubmenu(false)
    }
  }

  const handleBrowse = async (): Promise<void> => {
    const p = await browseProject()
    if (p) {
      setActiveProject(p)
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

  return (
    <div className="chat-view-container">
      {/* Scrollable Message Feed */}
      <div
        ref={scrollContainerRef}
        className="chat-messages-scroll"
        onScroll={handleScroll}
      >
        <div className="chat-messages-wrapper">
          {chat.messages.map((message: ChatMessage, messageIndex: number) => (
            <MessageRow
              key={message.id}
              message={message}
              isLastMsg={messageIndex === chat.messages.length - 1}
              isStreaming={isStreaming}
              onTick={handleStreamTick}
              onImageClick={(img) => setPreviewImage(img)}
            />
          ))}
          <div ref={messagesEndRef} />
        </div>
      </div>

      {/* Floating Bottom Input Bar — Same Design as Main TaskInput */}
      <div className="chat-bottom-input-container">
        <div
          className={`chat-bottom-task-card ${isDragging ? 'dragging-over' : ''}`}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
        >
          {/* Attached Images Preview Row */}
          {attachedImages.length > 0 && (
            <div className="chat-attached-images-row">
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

          <div className="chat-task-prompt-row">
            <div className="chat-task-prefix-icon" aria-hidden="true">
              <svg
                width="16"
                height="16"
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

            <textarea
              ref={textareaRef}
              className="chat-task-textarea"
              placeholder={isStreaming ? 'zipply выполняет задачу...' : 'Напиши сообщение...'}
              value={inputText}
              onChange={handleInput}
              onKeyDown={handleKeyDown}
              onPaste={handlePaste}
              disabled={isStreaming}
              rows={1}
              spellCheck={false}
            />
          </div>

          <div className="chat-task-actions-row">
            <div className="chat-task-left-controls" ref={menuRef}>
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
                className={`chat-task-add-btn ${showMenu ? 'active' : ''}`}
                title="Добавить изображение или выбрать проект"
                aria-label="Add image or choose project"
                onClick={toggleMenu}
              >
                <Plus size={15} strokeWidth={2.4} />
              </button>

              {showMenu && (
                <div className="chat-task-add-menu">
                  <button
                    type="button"
                    className="chat-task-add-menu-item"
                    onClick={handleAttachClick}
                    onMouseEnter={() => handleMenuItemHover('attach')}
                  >
                    <ImageIcon size={16} className="chat-task-add-menu-icon" strokeWidth={1.8} />
                    <span className="chat-task-add-menu-label">Прикрепить изображение</span>
                  </button>

                  <button
                    type="button"
                    className="chat-task-add-menu-item"
                    onClick={() => {
                      setShowMenu(false)
                      setShowProjectsSubmenu(false)
                    }}
                    onMouseEnter={() => handleMenuItemHover('plan')}
                  >
                    <ListTodo size={16} className="chat-task-add-menu-icon" strokeWidth={1.8} />
                    <span className="chat-task-add-menu-label">Создать план</span>
                  </button>

                  <div
                    className="chat-task-add-menu-item-wrapper"
                    onMouseEnter={() => handleMenuItemHover('projects')}
                    onMouseLeave={handleProjectsItemLeave}
                  >
                    <button
                      type="button"
                      className={`chat-task-add-menu-item task-projects-trigger ${showProjectsSubmenu ? 'active' : ''}`}
                      onClick={() => setShowProjectsSubmenu((v) => !v)}
                    >
                      <Folder size={16} className="chat-task-add-menu-icon" strokeWidth={1.8} />
                      <span className="chat-task-add-menu-label">Проекты</span>
                      <ChevronRight size={14} className="chat-task-add-menu-arrow" strokeWidth={1.8} />
                    </button>

                    {showProjectsSubmenu && (
                      <div
                        className="chat-project-picker-submenu"
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
                              const isSelected = activeProject?.path === p.path
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

              {activeProject && (
                <div
                  className="chat-project-tag"
                  title={`Папка: ${activeProject.path} (нажмите для смены)`}
                >
                  <span className="chat-project-tag-btn" onClick={toggleMenu}>
                    <Folder size={12} strokeWidth={2} />
                    <span>{activeProject.name}</span>
                  </span>
                  <button
                    type="button"
                    className="chat-project-tag-clear"
                    onClick={(e) => {
                      e.stopPropagation()
                      setActiveProject(null)
                    }}
                    title="Убрать проект"
                    aria-label="Remove project"
                  >
                    <X size={11} strokeWidth={2.4} />
                  </button>
                </div>
              )}
            </div>

            <div className="chat-task-right-controls">
              <button
                type="button"
                className="chat-task-model-pill"
                onClick={() => onOpenSettings?.('models')}
                title="Выбрать модель ИИ в настройках"
              >
                {modelName}
              </button>

              <button
                type="button"
                className={`chat-task-run-btn ${canSend ? 'has-text' : ''} ${isStreaming ? 'is-streaming' : ''}`}
                title={
                  isStreaming
                    ? 'Остановить генерацию'
                    : canSend
                      ? 'Отправить (Enter)'
                      : 'Введите сообщение'
                }
                aria-label={isStreaming ? 'Cancel generation' : 'Send message'}
                onClick={handleSend}
                disabled={!isStreaming && !canSend}
              >
                {isStreaming ? (
                  <Square size={13} fill="currentColor" />
                ) : (
                  <ArrowUp size={15} strokeWidth={2.5} />
                )}
              </button>
            </div>
          </div>
        </div>
      </div>

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
            <img src={previewImage.dataUrl} alt={previewImage.name} className="image-lightbox-img" />
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

export default ChatView
