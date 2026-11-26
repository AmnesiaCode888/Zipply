import React from 'react'
import { ChevronDown, Copy, Check } from '../../icons'
import { ToolType } from '../../types/chat'
import { VSCodeFileIcon } from './VSCodeFileIcon'
import { computeDiffCounts, computeStreamingDiffCounts } from './utils/toolHelpers'
import NumberTicker from '../ui/number-ticker-02'
import { ActivityLabel } from '../ActivityLabel'

export interface ToolHeaderProps {
  type: ToolType
  toolName?: string
  label: string
  status?: 'running' | 'completed' | 'error'
  isExpanded: boolean
  onToggle?: () => void
  onCopy?: (e: React.MouseEvent) => void
  copied?: boolean
  hasBody?: boolean
  targetName?: string
  diff?: { added?: number; removed?: number }
  baseline?: string
  diffText?: string
  content?: string
  isFileEdit?: boolean
}

// Universal ToolHeader:
// 1. For "Написал" / "Редактировал" (isFileEdit):
//    - Cursor-style diff pill with a file type icon, readable path, and diff counters.
//    - Pure Inter font (font-sans), zero monospace in header/counters, green/red diff stats.
// 2. For agent tools:
//    - A compact text row with an action label, target, and chevron
export const ToolHeader: React.FC<ToolHeaderProps> = ({
  toolName = '',
  label,
  status = 'completed',
  isExpanded,
  onToggle,
  onCopy,
  copied = false,
  hasBody = false,
  targetName,
  diff,
  baseline,
  diffText,
  content,
  isFileEdit = false
}) => {
  const isRunning = status === 'running'

  const latestPreview = React.useRef({ baseline, content })
  latestPreview.current = { baseline, content }
  const [liveCounts, setLiveCounts] = React.useState(() =>
    isFileEdit && isRunning ? computeStreamingDiffCounts(baseline, content) : null
  )

  React.useEffect(() => {
    if (!isFileEdit || !isRunning) return undefined
    let lastBaseline: string | undefined
    let lastContent: string | undefined
    let calculated = false
    const update = (): void => {
      const { baseline: previous, content: current } = latestPreview.current
      if (calculated && previous === lastBaseline && current === lastContent) return
      lastBaseline = previous
      lastContent = current
      calculated = true
      const next = computeStreamingDiffCounts(previous, current)
      setLiveCounts((old) => old?.added === next?.added && old?.removed === next?.removed ? old : next)
    }
    update()
    const interval = setInterval(update, 200)
    return () => clearInterval(interval)
  }, [isFileEdit, isRunning])

  const counts = React.useMemo(() => {
    if (!isFileEdit) return { added: 0, removed: 0 }
    if (isRunning) {
      if (liveCounts) return liveCounts
      if (typeof content === 'string' && content.length > 0) {
        const lineCount = content.split('\n').length - (content.endsWith('\n') ? 1 : 0)
        return { added: lineCount, removed: 0 }
      }
      return null
    }
    return computeDiffCounts(diff, diffText, content)
  }, [isFileEdit, isRunning, liveCounts, diff, diffText, content])

  // =========================================================================
  // 1. MODE: "Написал" / "Редактировал" -> Cursor-Style Diff Pill Header
  // =========================================================================
  if (isFileEdit) {
    const rawTarget = targetName && targetName !== 'файл...' ? targetName : ''
    const displayPath = rawTarget || (label !== 'Написал' && label !== 'Редактировал' ? label : 'файл')

    return (
      <div
        role="button"
        tabIndex={hasBody ? 0 : -1}
        aria-expanded={hasBody ? isExpanded : undefined}
        onKeyDown={(event) => { if (hasBody && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); onToggle?.() } }}
        onClick={hasBody ? onToggle : undefined}
        className={`w-full px-3 py-1.5 flex items-center justify-between select-none outline-none focus:outline-none transition-colors duration-150 ${
          hasBody ? 'cursor-pointer hover:bg-surface-elevated' : 'cursor-default'
        } bg-surface`}
      >
        {/* Left: File type icon + Path + Diff counters in Inter font */}
        <div className="flex items-center gap-2 min-w-0 flex-1 mr-2" title={displayPath}>
          <span className="w-4 h-4 flex items-center justify-center shrink-0">
            <VSCodeFileIcon filename={displayPath} size={15} />
          </span>
          <span data-shining-text={isRunning ? 'true' : undefined} className={`text-primary font-sans font-medium text-[15px] truncate ${isRunning ? 'shining-text' : ''}`}>
            {displayPath}
          </span>
          {status === 'error' && <span className="text-secondary shrink-0">ошибка</span>}
          <span title={isRunning ? 'Предварительный подсчёт во время генерации' : 'Добавлено строк'} className="text-diff-add font-sans font-normal text-[14px] shrink-0 ml-1.5">
            +{counts ? <NumberTicker value={counts.added} currency={null} decimals={0} /> : '…'}
          </span>
          <span title={isRunning ? 'Предварительный подсчёт во время генерации' : 'Удалено строк'} className="text-diff-remove font-sans font-normal text-[14px] shrink-0 ml-1">
            -{counts ? <NumberTicker value={counts.removed} currency={null} decimals={0} /> : '…'}
          </span>
        </div>

        {/* Right: Copy button (when expanded) + Chevron */}
        <div className="flex items-center gap-2 shrink-0">
          {isExpanded && hasBody && onCopy && (
            <button
              type="button"
              onClick={onCopy}
              className="flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[12px] font-sans text-secondary hover:text-primary hover:bg-hover-strong transition-colors focus:outline-none cursor-pointer border-none shadow-none"
              title="Скопировать"
            >
              {copied ? (
                <>
                  <Check size={12} className="text-diff-add" />
                  <span className="text-diff-add">Скопировано</span>
                </>
              ) : (
                <>
                  <Copy size={12} />
                  <span>Копировать</span>
                </>
              )}
            </button>
          )}

          {hasBody && (
            <span className="p-0.5 text-secondary hover:text-primary transition-colors">
              <ChevronDown
                size={13}
                strokeWidth={2}
                className={`transition-transform duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] ${
                  isExpanded ? 'rotate-180' : 'rotate-0'
                }`}
              />
            </span>
          )}
        </div>
      </div>
    )
  }

  // =========================================================================
  // 2. MODE: Agent tools — a compact text row.
  // =========================================================================
  let cleanTarget = (targetName || '').trim()
  if (cleanTarget === '.' || cleanTarget === './' || cleanTarget === 'файлы проекта' || cleanTarget === label) {
    cleanTarget = ''
  }

  const readableToolName = toolName.replace(/^mcp_/, '').replace(/[_-]+/g, ' ').trim()
  const knownLabels: Record<string, string> = {
    browser_verify: 'Проверка интерфейса',
    load_skill: 'Подключение навыка',
    search_skills: 'Поиск навыка',
    install_skill: 'Установка навыка',
    save_skill: 'Сохранение навыка',
    search_tools: 'Поиск инструментов',
    plugin_manager: 'Управление плагинами',
    verify_file: 'Проверка файла',
    code_intelligence: 'Анализ кода',
    update_plan: 'План задачи',
    spawn_agent: 'Субагент',
    ask_user: 'Уточнение'
  }
  const actionLabel = label === 'Инструмент'
    ? knownLabels[toolName] || (readableToolName ? readableToolName.charAt(0).toLocaleUpperCase('ru-RU') + readableToolName.slice(1) : label)
    : label

  let displayLabel = actionLabel
  if (cleanTarget) {
    displayLabel = `${actionLabel} ${cleanTarget}`
  }

  const friendlyTarget = cleanTarget

  return (
    <div className="w-full flex items-center justify-between">
      <button
        type="button"
        onClick={hasBody ? onToggle : undefined}
        aria-expanded={hasBody ? isExpanded : undefined}
        className={`group inline-flex max-w-full min-w-0 items-center gap-1.5 text-[15px] font-sans leading-[22px] text-secondary hover:text-primary transition-colors select-none focus:outline-none border-none shadow-none bg-transparent p-0 ${
          hasBody ? 'cursor-pointer' : 'cursor-default'
        }`}
      >
        {isRunning && (
          <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-secondary" aria-label="Выполняется" />
        )}

        <span className="flex min-w-0 max-w-[560px] flex-wrap items-center gap-x-1.5" title={displayLabel}>
          <span className={`truncate text-[15px] leading-[22px] font-medium ${isRunning ? 'text-primary' : 'text-secondary group-hover:text-primary'}`}>
            <ActivityLabel text={actionLabel} shining={isRunning} />
          </span>
          {friendlyTarget && <span className="min-w-0 truncate text-[14px] leading-[20px] text-muted">{friendlyTarget}</span>}
        </span>
        {status === 'error' && <span className="shrink-0 whitespace-nowrap text-[13px] leading-[19px] text-diff-remove">Ошибка</span>}

        {/* Subtle Chevron matching ThinkingBlock */}
        {hasBody && (
          <ChevronDown
            size={14}
            strokeWidth={1.8}
            className={`shrink-0 text-secondary group-hover:text-primary transition-transform duration-200 ease-out ml-0.5 ${
              isExpanded ? 'rotate-180' : 'rotate-0'
            }`}
          />
        )}
      </button>

      {/* Copy button when expanded */}
      {isExpanded && hasBody && onCopy && (
        <button
          type="button"
          onClick={onCopy}
          className="flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[12px] font-sans text-secondary hover:text-primary hover:bg-hover-strong transition-colors focus:outline-none cursor-pointer border-none shadow-none"
          title="Скопировать"
        >
          {copied ? (
            <>
              <Check size={12} className="text-diff-add" />
              <span className="text-diff-add">Скопировано</span>
            </>
          ) : (
            <>
              <Copy size={12} />
              <span>Копировать</span>
            </>
          )}
        </button>
      )}
    </div>
  )
}
