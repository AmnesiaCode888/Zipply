import React, { useState } from 'react'
import {
  Globe,
  ExternalLink,
  Check,
  Copy,
  Camera,
  AlertCircle,
  MousePointer,
  Keyboard,
  ArrowDownUp,
  Layers,
  ChevronDown,
  ChevronRight,
  Maximize2,
  X
} from 'lucide-react'
import { StepItem } from '../../../types/chat'
import { renderMarkdown } from '../../MarkdownRenderer'

interface BrowserStepViewerProps {
  step: StepItem
}

function getHostName(urlStr: string): string {
  try {
    return new URL(urlStr).hostname.replace(/^www\./, '')
  } catch {
    return urlStr
  }
}

export const BrowserStepViewer: React.FC<BrowserStepViewerProps> = ({ step }) => {
  const [copied, setCopied] = useState(false)
  const [showFullImage, setShowFullImage] = useState(false)
  const [showElements, setShowElements] = useState(false)

  const args = step.args || {}
  const data = (step.data && typeof step.data === 'object') ? (step.data as Record<string, any>) : {}
  const action = (args.action as string) || (data.action as string) || 'navigate'
  const url = (args.url as string) || (data.url as string) || (step.target as string) || ''
  const title = (data.title as string) || ''
  const screenshot = (data.screenshot as string) || (args.screenshot as string) || ''
  const interactiveElements: any[] = Array.isArray(data.interactiveElements) ? data.interactiveElements : []
  const resultText = typeof step.result === 'string' ? step.result : ''
  const isError = Boolean(step.error || data.error || (resultText && resultText.startsWith('Browser error')))

  const handleCopy = (e: React.MouseEvent): void => {
    e.stopPropagation()
    const copyContent = resultText || url || ''
    navigator.clipboard.writeText(copyContent)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  // Get action tag badge name & icon
  const getActionInfo = (): { label: string; icon: React.ReactNode } => {
    switch (action) {
      case 'navigate':
        return { label: 'Переход', icon: <Globe size={11} /> }
      case 'screenshot':
        return { label: 'Скриншот', icon: <Camera size={11} /> }
      case 'click':
        return { label: 'Клик', icon: <MousePointer size={11} /> }
      case 'type':
        return { label: 'Ввод', icon: <Keyboard size={11} /> }
      case 'scroll':
        return { label: 'Скролл', icon: <ArrowDownUp size={11} /> }
      case 'new_tab':
        return { label: 'Новая вкладка', icon: <Layers size={11} /> }
      case 'close_tab':
        return { label: 'Закрытие вкладки', icon: <Layers size={11} /> }
      case 'switch_tab':
        return { label: 'Переключение', icon: <Layers size={11} /> }
      case 'list_tabs':
        return { label: 'Вкладки', icon: <Layers size={11} /> }
      case 'get_content':
      default:
        return { label: 'Браузер', icon: <Globe size={11} /> }
    }
  }

  const actionInfo = getActionInfo()

  return (
    <div className="unified-tool-box browser-step-viewer">
      <button
        type="button"
        className="unified-copy-btn"
        onClick={handleCopy}
        title="Копировать вывод браузера"
      >
        {copied ? <Check size={11} className="copied-check" strokeWidth={2.5} /> : <Copy size={11} />}
      </button>

      {/* Header bar with Action Pill, Link & Title */}
      <div className="browser-step-header">
        <div className="browser-step-action-tag">
          {actionInfo.icon}
          <span>{actionInfo.label}</span>
        </div>

        {url && (
          <a
            href={url}
            target="_blank"
            rel="noreferrer"
            className="browser-step-url-link"
            onClick={(e) => e.stopPropagation()}
            title={url}
          >
            <span className="browser-step-host">{getHostName(url)}</span>
            <ExternalLink size={10} className="browser-step-ext-icon" />
          </a>
        )}

        {title && <span className="browser-step-title" title={title}>{title}</span>}
      </div>

      {/* Error card (no code editor line numbers) */}
      {isError && (
        <div className="browser-step-error-banner">
          <AlertCircle size={14} className="browser-step-error-icon" />
          <div className="browser-step-error-content">
            <span className="browser-step-error-title">Ошибка браузера</span>
            <span className="browser-step-error-msg">
              {data.error || resultText.replace(/^Browser error \[[^\]]+\]:\s*/, '') || 'Не удалось выполнить действие в браузере.'}
            </span>
          </div>
        </div>
      )}

      {/* Screenshot preview */}
      {screenshot && (
        <div className="browser-step-screenshot-box">
          <div className="browser-step-screenshot-header">
            <div className="browser-step-screenshot-label">
              <Camera size={12} />
              <span>Снимок экрана</span>
            </div>
            <button
              type="button"
              className="browser-step-zoom-btn"
              onClick={() => setShowFullImage(true)}
              title="Открыть снимок на весь экран"
            >
              <Maximize2 size={11} />
              <span>Увеличить</span>
            </button>
          </div>
          <div
            className="browser-step-screenshot-thumb-wrapper"
            onClick={() => setShowFullImage(true)}
            role="button"
            tabIndex={0}
          >
            <img
              src={screenshot}
              alt="Снимок страницы браузера"
              className="browser-step-screenshot-img"
            />
          </div>
        </div>
      )}

      {/* Interactive elements list (collapsible) */}
      {interactiveElements.length > 0 && (
        <div className="browser-step-elements-section">
          <button
            type="button"
            className="browser-step-elements-toggle"
            onClick={() => setShowElements(!showElements)}
          >
            <div className="browser-step-elements-toggle-left">
              <Layers size={12} />
              <span>Интерактивные элементы</span>
              <span className="browser-step-elements-count-badge mono">{interactiveElements.length}</span>
            </div>
            {showElements ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
          </button>

          {showElements && (
            <div className="browser-step-elements-list">
              {interactiveElements.slice(0, 30).map((el: any) => (
                <div key={el.id} className="browser-step-element-row">
                  <span className="browser-step-element-id mono">#{el.id}</span>
                  <span className="browser-step-element-tag">&lt;{el.tag}&gt;</span>
                  {el.text && <span className="browser-step-element-text">"{el.text}"</span>}
                  {el.selector && <span className="browser-step-element-selector mono">{el.selector}</span>}
                </div>
              ))}
              {interactiveElements.length > 30 && (
                <div className="browser-step-elements-more">
                  ... и ещё {interactiveElements.length - 30} элементов
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Clean text output if not error */}
      {!isError && resultText && (
        <div className="browser-step-body-content">
          {renderMarkdown(resultText)}
        </div>
      )}

      {/* Fullscreen Screenshot Modal */}
      {showFullImage && screenshot && (
        <div
          className="browser-step-lightbox"
          onClick={() => setShowFullImage(false)}
          role="dialog"
        >
          <div className="browser-step-lightbox-content" onClick={(e) => e.stopPropagation()}>
            <div className="browser-step-lightbox-header">
              <span className="browser-step-lightbox-title">{title || url || 'Снимок экрана'}</span>
              <button
                type="button"
                className="browser-step-lightbox-close"
                onClick={() => setShowFullImage(false)}
              >
                <X size={16} />
              </button>
            </div>
            <div className="browser-step-lightbox-body">
              <img src={screenshot} alt="Полный снимок страницы" />
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default BrowserStepViewer
