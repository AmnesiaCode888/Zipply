import React, { useState, useRef, useEffect, useCallback, useId, useLayoutEffect } from 'react'
import { useAutoResizeTextarea } from '../../hooks/useAutoResizeTextarea'
import { AiMode } from '../mode-selector'
import { ActionDrawer } from './ActionDrawer'
import { ChatActionRow } from './ChatActionRow'
import { ChatSession, ImageAttachment, Message } from '../../types/chat'
import { X, FileText } from '../../icons'
import { loadSettings, saveSettings, type AccessMode, type ReasoningEffort } from '../../services/settingsService'
import type { ExtensionRef } from '../../../../shared/extensions'
import { applyCommandChoice, CommandPalette, commandOptionId, extensionRefKey, getCommandChoices, readCommandToken } from './CommandPalette'
import type { CommandChoice, ExtensionCommandOption, ExtensionManagementPage } from './CommandPalette'

export type { ExtensionCommandOption, ExtensionManagementPage } from './CommandPalette'

export interface ChatInputProps {
  initialDraft?: ChatDraft
  onDraftChange?: (draft: ChatDraft) => void
  placeholder?: string
  mode?: AiMode
  onModeChange?: (mode: AiMode) => void
  uncensoredMode?: boolean
  onEnableUncensoredMode?: () => void
  onSend?: (message: string, planMode?: boolean, attachments?: ImageAttachment[], extensionRefs?: ExtensionRef[]) => void
  extensionOptions?: readonly ExtensionCommandOption[]
  onManageExtensions?: (page: ExtensionManagementPage) => void
  onAttach?: () => void
  isStreaming?: boolean
  onCancel?: () => void
  activeSession?: ChatSession
  contextStatus?: Message['contextStatus']
  contextCompacted?: boolean
  onChangeFolder?: () => void
  onOpenFolder?: () => void
}

export interface ChatDraft {
  value: string
  files: Array<{ id: string; file: File; preview: string }>
  planMode: boolean
  extensionRefs?: ExtensionRef[]
}

const MAX_ATTACHMENTS = 8
const MAX_ATTACHMENT_BYTES = 30 * 1024 * 1024

const ChatInputView: React.FC<ChatInputProps> = ({
  initialDraft,
  onDraftChange,
  placeholder = 'Напиши что-нибудь…',
  mode,
  onModeChange,
  uncensoredMode,
  onEnableUncensoredMode,
  onSend,
  extensionOptions,
  onManageExtensions,
  onAttach,
  isStreaming,
  onCancel,
  activeSession,
  contextStatus,
  contextCompacted,
  onChangeFolder,
  onOpenFolder
}) => {
  const [value, setValue] = useState(initialDraft?.value || '')
  const [files, setFiles] = useState<ChatDraft['files']>(initialDraft?.files || [])
  const filesRef = useRef<ChatDraft['files']>(initialDraft?.files || [])
  const [attachmentError, setAttachmentError] = useState('')
  const [isUploading, setIsUploading] = useState(false)
  const [readingFiles, setReadingFiles] = useState(0)
  const mountedRef = useRef(true)
  const folderRef = useRef(activeSession?.folderPath)
  folderRef.current = activeSession?.folderPath
  useEffect(() => { mountedRef.current = true; return () => { mountedRef.current = false } }, [])
  const [accessMode, setAccessMode] = useState<AccessMode>(() => loadSettings().accessMode)
  const [selectedModel, setSelectedModel] = useState<string>(() => loadSettings().defaultModel)
  const [reasoningEffort, setReasoningEffort] = useState<ReasoningEffort>(() => loadSettings().reasoningEffort || 'high')
  const [planMode, setPlanMode] = useState(initialDraft?.planMode || false)
  const [extensionRefs, setExtensionRefs] = useState<ExtensionRef[]>(initialDraft?.extensionRefs ?? [])
  useEffect(() => { onDraftChange?.({ value, files, planMode, extensionRefs }) }, [value, files, planMode, extensionRefs, onDraftChange])
  const [isMenuOpen, setIsMenuOpen] = useState(false)
  const [isMenuClosing, setIsMenuClosing] = useState(false)
  const [caret, setCaret] = useState<number | null>(null)
  const [commandIndex, setCommandIndex] = useState(0)
  const [paletteDismissed, setPaletteDismissed] = useState(false)
  const [drawerPaletteOpen, setDrawerPaletteOpen] = useState(false)
  const [isComposing, setIsComposing] = useState(false)
  const paletteId = useId()
  const pendingCaret = useRef<number | null>(null)

  const textareaRef = useAutoResizeTextarea({ value })
  const menuRef = useRef<HTMLDivElement>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => () => { if (closeTimerRef.current) clearTimeout(closeTimerRef.current) }, [])
  useLayoutEffect(() => {
    if (pendingCaret.current === null) return
    textareaRef.current?.setSelectionRange(pendingCaret.current, pendingCaret.current)
    pendingCaret.current = null
  }, [value, textareaRef])

  const hasText = value.trim().length > 0 || files.length > 0 || extensionRefs.length > 0
  const commandsEnabled = extensionOptions !== undefined || onManageExtensions !== undefined
  const commandToken = caret === null || drawerPaletteOpen ? null : readCommandToken(value, caret)
  const commandQuery = drawerPaletteOpen ? { mode: 'slash', query: '' } as const : commandToken
  const commandChoices = getCommandChoices(commandQuery, extensionOptions ?? [], Boolean(onManageExtensions))
  const paletteOpen = commandsEnabled && !isUploading && !isComposing && !paletteDismissed && (!isMenuOpen || isMenuClosing) && (
    commandChoices.length > 0 || (commandQuery?.mode === 'resource' && !commandQuery.query)
  )
  const activeCommandIndex = Math.min(commandIndex, commandChoices.length - 1)

  const syncCaret = (input: HTMLTextAreaElement): void => {
    const next = input.selectionStart === input.selectionEnd ? input.selectionStart : null
    if (next !== caret) {
      setCaret(next)
      setCommandIndex(0)
      setPaletteDismissed(false)
    }
  }

  const dismissPalette = (): void => {
    setPaletteDismissed(true)
    setDrawerPaletteOpen(false)
  }

  const updateValue = (input: HTMLTextAreaElement): void => {
    setValue(input.value)
    setCaret(input.selectionStart === input.selectionEnd ? input.selectionStart : null)
    setCommandIndex(0)
    setPaletteDismissed(false)
    setDrawerPaletteOpen(false)
  }

  const chooseCommand = (choice: CommandChoice): void => {
    const next = applyCommandChoice(value, commandToken, choice, extensionRefs)
    if (next.caret !== null) {
      pendingCaret.current = next.caret
      setCaret(next.caret)
    }
    setValue(next.value)
    setExtensionRefs(next.extensionRefs)
    dismissPalette()
    if ('page' in choice) onManageExtensions?.(choice.page)
  }

  const updateFiles = (update: ChatDraft['files'] | ((previous: ChatDraft['files']) => ChatDraft['files'])): void => {
    const next = typeof update === 'function' ? update(filesRef.current) : update
    filesRef.current = next
    setFiles(next)
  }

  const handleAccessModeChange = (next: AccessMode): boolean => {
    if (!saveSettings({ ...loadSettings(), accessMode: next })) return false
    setAccessMode(next)
    return true
  }

  const handleModelChange = (nextModel: string): void => {
    if (saveSettings({ ...loadSettings(), defaultModel: nextModel })) {
      setSelectedModel(nextModel)
    }
  }

  const handleReasoningEffortChange = (nextEffort: ReasoningEffort): void => {
    if (saveSettings({ ...loadSettings(), reasoningEffort: nextEffort })) {
      setReasoningEffort(nextEffort)
    }
  }

  const closeMenu = useCallback(() => {
    if (!isMenuOpen || isMenuClosing) return
    setIsMenuClosing(true)
    closeTimerRef.current = setTimeout(() => {
      setIsMenuOpen(false)
      setIsMenuClosing(false)
      closeTimerRef.current = null
    }, 220)
  }, [isMenuOpen, isMenuClosing])

  const toggleMenu = useCallback(() => {
    if (isMenuClosing) {
      if (closeTimerRef.current) clearTimeout(closeTimerRef.current)
      closeTimerRef.current = null
      setIsMenuClosing(false)
      return
    }
    if (isMenuOpen) {
      closeMenu()
    } else {
      setIsMenuOpen(true)
      setIsMenuClosing(false)
    }
  }, [isMenuOpen, isMenuClosing, closeMenu])

  // Close on click outside or Escape
  useEffect(() => {
    if (!isMenuOpen) return

    const handleClickOutside = (e: MouseEvent): void => {
      const target = e.target as Node
      if (
        menuRef.current &&
        !menuRef.current.contains(target) &&
        buttonRef.current &&
        !buttonRef.current.contains(target)
      ) {
        closeMenu()
      }
    }

    const handleKeyDown = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        closeMenu()
      }
    }

    document.addEventListener('mousedown', handleClickOutside)
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [isMenuOpen, closeMenu])

  const handleSend = async (): Promise<void> => {
    if (!hasText || isUploading || readingFiles > 0) return
    if (files.length && !activeSession?.folderPath) { setAttachmentError('Рабочая папка ещё не готова.'); return }
    const folderPath = activeSession?.folderPath
    setIsUploading(true)
    setAttachmentError('')
    try {
      const attachments: ImageAttachment[] = []
      for (const item of files) {
        const save = item.file.type.startsWith('image/') ? window.api.workspace.saveImage : window.api.workspace.saveDocument
        const result = await save(folderPath!, item.file.name, new Uint8Array(await item.file.arrayBuffer()))
        if (!result.attachment) throw new Error(result.error || 'Не удалось сохранить изображение.')
        attachments.push(result.attachment)
      }
      if (!mountedRef.current) return
      if (folderRef.current !== folderPath) throw new Error('Рабочая папка изменилась. Отправьте сообщение ещё раз.')
      onSend?.(value.trim(), planMode, attachments, extensionRefs)
      setValue('')
      updateFiles([])
      setExtensionRefs([])
      dismissPalette()
    } catch (error) {
      if (mountedRef.current) setAttachmentError(error instanceof Error ? error.message : 'Не удалось сохранить изображение.')
    } finally {
      if (mountedRef.current) setIsUploading(false)
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>): void => {
    if (isComposing || e.nativeEvent.isComposing || e.keyCode === 229) return
    if (paletteOpen) {
      if (e.key === 'Escape') {
        e.preventDefault()
        dismissPalette()
        return
      }
      if (commandChoices.length && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
        e.preventDefault()
        const delta = e.key === 'ArrowDown' ? 1 : -1
        setCommandIndex((activeCommandIndex + delta + commandChoices.length) % commandChoices.length)
        return
      }
      if (e.key === 'Enter' && !e.shiftKey && activeCommandIndex >= 0) {
        e.preventDefault()
        chooseCommand(commandChoices[activeCommandIndex])
        return
      }
    }
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  const handleAttachClick = (): void => {
    closeMenu()
    if (isUploading) return
    if (onAttach) {
      onAttach()
    } else {
      fileInputRef.current?.click()
    }
  }

  const addFiles = (selected: File[]): void => {
    const supported = selected.filter((file) => (['image/png', 'image/jpeg', 'image/gif', 'image/webp'].includes(file.type) || /\.(txt|md|log|csv|tsv|json|pdf|docx|xlsx)$/i.test(file.name)) && file.size <= 20 * 1024 * 1024 && file.size > 0)
    const accepted: ChatDraft['files'] = []
    let totalBytes = filesRef.current.reduce((total, item) => total + item.file.size, 0)
    for (const file of supported) {
      if (filesRef.current.length + accepted.length >= MAX_ATTACHMENTS || totalBytes + file.size > MAX_ATTACHMENT_BYTES) continue
      accepted.push({ id: crypto.randomUUID(), file, preview: '' })
      totalBytes += file.size
    }
    const errors: string[] = []
    if (supported.length !== selected.length) errors.push('Поддерживаются изображения, PDF, DOCX, XLSX и текстовые файлы до 20 МБ.')
    if (accepted.length !== supported.length) errors.push('Можно прикрепить не более 8 файлов общим размером до 30 МБ.')
    setAttachmentError(errors.join(' '))
    updateFiles(previous => [...previous, ...accepted])
    for (const item of accepted) {
      if (!item.file.type.startsWith('image/')) continue
      const reader = new FileReader()
      setReadingFiles((count) => count + 1)
      reader.onloadend = () => { if (mountedRef.current) setReadingFiles((count) => count - 1) }
      reader.onload = () => {
        if (mountedRef.current && typeof reader.result === 'string') updateFiles(previous => previous.map(existing => existing.id === item.id ? { ...existing, preview: reader.result as string } : existing))
      }
      reader.onerror = () => {
        if (mountedRef.current) {
          updateFiles(previous => previous.filter(existing => existing.id !== item.id))
          setAttachmentError('Не удалось прочитать изображение.')
        }
      }
      reader.readAsDataURL(item.file)
    }
  }

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>): void => {
    addFiles(Array.from(e.target.files || []))
    e.target.value = ''
  }

  const handlePlanClick = (): void => {
    if (isUploading) return
    closeMenu()
    setPlanMode((prev) => !prev)
    setTimeout(() => textareaRef.current?.focus(), 50)
  }

  const handleCommandsClick = (): void => {
    closeMenu()
    textareaRef.current?.focus()
    setPaletteDismissed(false)
    setDrawerPaletteOpen(true)
    setCommandIndex(0)
  }

  const handleAgentTeamClick = (): void => {
    closeMenu()
    setValue((prev) => {
      const trimmed = prev.trim()
      if (!trimmed) return 'Команда агентов: '
      return trimmed.startsWith('Команда агентов') ? trimmed : `Команда агентов: ${trimmed}`
    })
    setTimeout(() => textareaRef.current?.focus(), 50)
  }

  return (
    <div className="composer-container relative w-full select-none">
      {/* Hidden File Input for Attachments */}
      <input
        ref={fileInputRef}
        type="file"
        multiple
        accept="image/png,image/jpeg,image/gif,image/webp,.txt,.md,.log,.csv,.tsv,.json,.pdf,.docx,.xlsx"
        className="hidden"
        onChange={handleFileChange}
      />

      {/* Action Drawer Popover */}
      <ActionDrawer
        isOpen={isMenuOpen}
        isClosing={isMenuClosing}
        drawerRef={menuRef}
        onAttachClick={handleAttachClick}
        onPlanClick={handlePlanClick}
        onCommandsClick={commandsEnabled ? handleCommandsClick : undefined}
        planMode={planMode}
        onAgentTeamClick={handleAgentTeamClick}
        folderPath={activeSession?.folderPath}
        onChangeFolder={() => {
          closeMenu()
          onChangeFolder?.()
        }}
        onOpenFolder={() => {
          closeMenu()
          onOpenFolder?.()
        }}
      />

      {paletteOpen && (
        <CommandPalette id={paletteId} choices={commandChoices} activeIndex={activeCommandIndex} resourceMode={commandQuery?.mode === 'resource'} onChoose={chooseCommand} />
      )}

      {/* Foreground Input Box */}
      <div
        data-composer-box
        className="relative z-20 w-full max-h-[40vh] bg-surface rounded-[24px] px-3.5 pt-2.5 pb-2 flex flex-col box-border border-[0.5px] border-hairline shadow-none"
        style={{
          minHeight: '80px'
        }}
      >
        <div className="min-h-0 overflow-y-auto">
        {extensionRefs.length > 0 && (
          <div className="flex flex-wrap gap-1.5 px-1 pb-2">
            {extensionRefs.map(ref => {
              const key = extensionRefKey(ref)
              return (
                <div key={key} className="flex h-7 max-w-full min-w-0 items-center gap-1 rounded-full bg-control pl-2.5 pr-1 text-[13px] text-primary">
                  <span className="truncate" title={ref.label}>{ref.label}</span>
                  <button type="button" aria-label={`Убрать ${ref.label}`} disabled={isUploading} onClick={() => setExtensionRefs(previous => previous.filter(item => extensionRefKey(item) !== key))} className="flex size-5 shrink-0 items-center justify-center rounded-full text-secondary hover:bg-hover-strong hover:text-primary focus:outline-none border-none shadow-none"><X size={13} aria-hidden="true" /></button>
                </div>
              )
            })}
          </div>
        )}
        {files.length > 0 && <div className="max-h-[22vh] overflow-y-auto flex flex-wrap gap-2 px-1 pb-2">
          {files.map((item) => <div key={item.id} className="relative rounded-[14px] bg-control overflow-hidden w-[76px] h-[76px]">
            {item.preview ? <img src={item.preview} alt={item.file.name} className="w-full h-full object-cover" /> : <div title={item.file.name} className="flex h-full flex-col items-center justify-center px-1 text-secondary"><FileText size={22} /><span className="w-full truncate text-center text-[11px]">{item.file.name}</span></div>}
            <button type="button" aria-label={`Убрать ${item.file.name}`} disabled={isUploading} onClick={() => updateFiles((previous) => previous.filter((file) => file.id !== item.id))} className="absolute top-1 right-1 w-6 h-6 flex items-center justify-center rounded-full bg-surface text-primary border-none shadow-none"><X size={14} /></button>
          </div>)}
        </div>}
        {files.some(item => !item.file.type.startsWith('image/')) && <p className="px-1 pb-2 text-[13px] leading-[19px] text-secondary">Документы: до 120 000 символов текста. PDF-сканы без текстового слоя не поддерживаются.</p>}
        {attachmentError && <div role="alert" className="px-1 pb-2 text-[14px] text-secondary">{attachmentError}</div>}
        {/* Text area */}
        <textarea
          data-chat-composer
          ref={textareaRef}
          rows={1}
          disabled={isUploading}
          value={value}
          aria-autocomplete={commandsEnabled ? 'list' : undefined}
          aria-controls={paletteOpen ? paletteId : undefined}
          aria-activedescendant={paletteOpen && activeCommandIndex >= 0 ? commandOptionId(paletteId, activeCommandIndex) : undefined}
          onChange={event => updateValue(event.currentTarget)}
          onFocus={event => syncCaret(event.currentTarget)}
          onSelect={event => syncCaret(event.currentTarget)}
          onBlur={() => {
            setCaret(null)
            dismissPalette()
          }}
          onCompositionStart={() => setIsComposing(true)}
          onCompositionEnd={event => {
            setIsComposing(false)
            updateValue(event.currentTarget)
          }}
          onKeyDown={handleKeyDown}
          onPaste={(event) => {
            const images = Array.from(event.clipboardData.files).filter((file) => file.type.startsWith('image/'))
            if (images.length) {
              event.preventDefault()
              const text = event.clipboardData.getData('text/plain')
              if (text) {
                const input = event.currentTarget
                const start = input.selectionStart
                const end = input.selectionEnd
                setValue(current => current.slice(0, start) + text + current.slice(end))
                requestAnimationFrame(() => { if (mountedRef.current) input.setSelectionRange(start + text.length, start + text.length) })
              }
              addFiles(images)
            }
          }}
          placeholder={placeholder}
          className="w-full bg-transparent text-primary placeholder-muted text-[16.5px] font-normal leading-[25px] resize-none focus:outline-none border-none p-0 px-1 m-0 select-text"
          style={{ minHeight: '28px', boxShadow: 'none', outline: 'none' }}
        />
        </div>

        {/* Actions row */}
        <ChatActionRow
          contextStatus={contextStatus}
          contextCompacted={contextCompacted}
          isMenuOpen={isMenuOpen}
          onToggleMenu={toggleMenu}
          buttonRef={buttonRef}
          mode={mode}
          onModeChange={onModeChange}
          model={selectedModel}
          reasoningEffort={reasoningEffort}
          onModelChange={handleModelChange}
          onReasoningEffortChange={handleReasoningEffortChange}
          uncensoredMode={uncensoredMode}
          onEnableUncensoredMode={onEnableUncensoredMode}
          hasText={hasText && !isUploading && readingFiles === 0}
          isStreaming={isStreaming}
          onCancel={onCancel}
          onSend={handleSend}
          planMode={planMode}
          onRemovePlan={() => { setPlanMode(false); textareaRef.current?.focus() }}
          accessMode={accessMode}
          onAccessModeChange={handleAccessModeChange}
          disabled={isUploading}
        />
      </div>
    </div>
  )
}

export const ChatInput = React.memo(ChatInputView)
