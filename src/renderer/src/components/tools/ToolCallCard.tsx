import React, { useState, useRef, useEffect } from 'react'
import { ChevronDown } from '../../icons'
import { ToolCall } from '../../types/chat'
import { ToolHeader } from './ToolHeader'
import { FileEditTool } from './FileEditTool'
import { FileReadTool } from './FileReadTool'
import { SearchTool } from './SearchTool'
import { FolderResult } from './FolderResult'
import { TerminalTool } from './TerminalTool'
import { getReadTargets, ReadTarget } from './ReadTarget'
import { ProcessResult } from './ProcessResult'
import { PatchFiles } from './PatchFiles'
import { CyberSecToolCard } from './CyberSecToolCard'
import { ToolResultView } from './ToolResultView'
import { MarkdownRenderer } from '../chat/MarkdownRenderer'

interface ToolCallCardProps {
  tool: ToolCall
  isExpanded?: boolean
  onToggle?: () => void
}

import { isFileEditOrWrite, isReadTool, isSearchTool } from './utils/toolHelpers'

export { isFileEditOrWrite, isReadTool, isSearchTool }

const WebPageResult: React.FC<{ tool: ToolCall }> = ({ tool }) => {
  const data = tool.toolData && typeof tool.toolData === 'object' ? tool.toolData as Record<string, unknown> : {}
  const pageContent = typeof data.content === 'string' ? data.content : tool.content || ''
  const title = typeof data.title === 'string' && data.title ? data.title : tool.targetName || 'Веб-страница'
  const url = typeof data.finalUrl === 'string' ? data.finalUrl : tool.targetName || ''
  return <div className="max-h-[360px] overflow-auto rounded-[14px] bg-surface-secondary px-4 py-3.5 select-text">
    <div className="mb-3 min-w-0 rounded-[12px] bg-surface px-3 py-2.5">
      <div className="truncate text-[14px] leading-[20px] font-medium text-primary" title={title}>{title}</div>
      {url && <div className="mt-0.5 truncate text-[12px] leading-[18px] text-muted" title={url}>{url}</div>}
      {typeof data.status === 'number' && <div className="mt-1 text-[12px] leading-[18px] text-secondary">HTTP {data.status}{data.truncated ? ' · Показана часть страницы' : ''}</div>}
    </div>
    {pageContent ? <MarkdownRenderer content={pageContent} /> : <p className="m-0 text-[14px] leading-[22px] text-secondary">Содержимое страницы недоступно.</p>}
  </div>
}

const shellToolNames = new Set(['exec_command', 'write_stdin', 'run_command', 'terminal', 'execute_command', 'bash', 'sh'])

export const ToolCallCard: React.FC<ToolCallCardProps> = ({
  tool,
  isExpanded: controlledExpanded,
  onToggle: controlledToggle
}) => {
  const isRead = isReadTool(tool)
  const isSearch = !isRead && isSearchTool(tool)
  const isFileEdit = !isRead && !isSearch && isFileEditOrWrite(tool)

  const [localExpanded, setLocalExpanded] = useState(() => {
    if (isRead || isSearch) return false
    if (tool.status === 'running') return true
    if (tool.type === 'terminal' && (tool.status === 'completed' || tool.status === 'error')) return false
    return tool.defaultExpanded ?? false
  })

  const isExpanded = controlledExpanded !== undefined ? controlledExpanded : localExpanded
  const [keepBodyMounted, setKeepBodyMounted] = useState(isExpanded)
  useEffect(() => {
    if (isExpanded) { setKeepBodyMounted(true); return }
    if (!keepBodyMounted) return
    const timer = window.setTimeout(() => setKeepBodyMounted(false), 200)
    return () => window.clearTimeout(timer)
  }, [isExpanded, keepBodyMounted])

  const [copied, setCopied] = useState(false)
  const cardRef = useRef<HTMLDivElement>(null)

  const handleToggle = () => {
    if (controlledToggle) {
      controlledToggle()
    } else {
      setLocalExpanded((prev) => !prev)
    }
  }

  const handleCopy = (e: React.MouseEvent) => {
    e.stopPropagation()
    let textToCopy = tool.content || tool.targetName || ''
    if (tool.type === 'file_edit') {
      textToCopy = textToCopy
        .split('\n')
        .map((l) => (l.startsWith('+') || l.startsWith('-') || l.startsWith(' ') ? l.substring(1) : l))
        .join('\n')
    }
    navigator.clipboard.writeText(textToCopy)
    setCopied(true)
    setTimeout(() => setCopied(false), 1800)
  }

  const renderContent = () => {
    switch (tool.type) {
      case 'file_edit':
        if (tool.status === 'error') return <ToolResultView tool={tool} />
        return (
          <FileEditTool
            fileName={tool.targetName}
            diff={tool.diff}
            content={tool.content}
            status={tool.status}
          />
        )
      case 'file_read':
        if (tool.status === 'error') return <ToolResultView tool={tool} />
        if (tool.toolName === 'verify_file' || tool.toolName === 'code_intelligence') return <ToolResultView tool={tool} />
        if (tool.toolName === 'read_page') return <WebPageResult tool={tool} />
        return <FileReadTool tool={tool} />
      case 'search':
        return <SearchTool tool={tool} />
      case 'terminal': {
        if (tool.patchFiles?.length) return <PatchFiles files={tool.patchFiles} />
        if (tool.toolName?.startsWith('process_')) return <ProcessResult result={tool.processResult} content={tool.content} />
        if (tool.toolName && !shellToolNames.has(tool.toolName)) return <ToolResultView tool={tool} />
        const termData = tool.toolData as { terminalSessionId?: string; background?: boolean; exitCode?: number | null; elapsedMs?: number } | undefined
        return (
          <TerminalTool
            command={tool.targetName}
            output={tool.content}
            status={tool.status}
            terminalSessionId={termData?.terminalSessionId}
            background={termData?.background}
            exitCode={termData?.exitCode}
            elapsedMs={termData?.elapsedMs}
          />
        )
      }
      case 'folder':
        return <FolderResult tool={tool} />
      default:
        return <ToolResultView tool={tool} />
    }
  }

  const hasBody = Boolean(tool.content || tool.targetName || tool.patchFiles?.length || tool.processResult)

  if (tool.toolName?.startsWith('cybersec_')) {
    return <CyberSecToolCard tool={tool} isExpanded={isExpanded} onToggle={handleToggle} onCopy={handleCopy} copied={copied} />
  }

  if (isRead || isSearch) {
    const displayTarget = tool.targetName || (isRead ? 'файл' : 'запрос')
    const readTargets = isRead ? getReadTargets(tool) : []
    return (
      <div ref={cardRef} className="w-full">
        <div className="flex min-w-0 items-center">
          <button type="button" aria-expanded={isExpanded} disabled={!tool.content} onClick={handleToggle}
            data-shining-text={tool.status === 'running' ? 'true' : undefined}
            className={`flex min-w-0 max-w-full items-center gap-1.5 p-0 text-[15px] leading-[22px] text-secondary hover:text-primary bg-transparent border-none shadow-none cursor-pointer disabled:cursor-default ${tool.status === 'running' ? 'shining-text' : ''}`}
            title={displayTarget}>
            <span className="shrink-0 whitespace-nowrap font-medium">{tool.label || (isRead ? 'Прочитал' : 'Поиск')}</span>
            {readTargets.length ? (
              <span className="inline-flex min-w-0 items-center gap-2 overflow-hidden">
                {readTargets.map((target, index) => <ReadTarget key={`${index}:${target}`} target={target} />)}
              </span>
            ) : <span className="truncate min-w-0">{displayTarget}</span>}
            {tool.analysisDetail && <span className="min-w-0 truncate text-muted" title={tool.analysisDetail}>· {tool.analysisDetail}</span>}
            {tool.status === 'running' && <span className="shrink-0 whitespace-nowrap text-muted">Выполняется</span>}
            {tool.status === 'error' && <span className="shrink-0 whitespace-nowrap text-diff-remove">Ошибка</span>}
            {tool.content && <ChevronDown
              size={14}
              strokeWidth={1.8}
              aria-hidden="true"
              className={`shrink-0 transition-transform duration-200 ease-out ${isExpanded ? 'rotate-180' : 'rotate-0'}`}
            />}
          </button>
        </div>
        {tool.content && (
          <div
            className={`grid transition-[grid-template-rows,opacity] duration-200 ease-out motion-reduce:transition-none ${
              isExpanded
                ? 'grid-rows-[1fr] opacity-100 pointer-events-auto'
                : 'grid-rows-[0fr] opacity-0 pointer-events-none'
            }`}
          >
            <div className="min-h-0 overflow-hidden">
              {(isExpanded || keepBodyMounted) && (
                <div className="my-1">
                  {isSearch
                    ? <SearchTool tool={tool} />
                    : tool.status === 'error'
                      ? <ToolResultView tool={tool} />
                    : tool.toolName === 'verify_file' || tool.toolName === 'code_intelligence'
                      ? <ToolResultView tool={tool} />
                      : tool.toolName === 'read_page'
                        ? <WebPageResult tool={tool} />
                        : <FileReadTool tool={tool} />}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    )
  }

  // =========================================================================
  // 3. "Написал" / "Редактировал" -> Cursor-Style Diff Pill Card with VS Code Icon
  // =========================================================================
  if (isFileEdit) {
    return (
      <div
        ref={cardRef}
        className="w-full rounded-[14px] bg-surface overflow-hidden select-none transition-colors border-none shadow-none"
      >
        <ToolHeader
          type={tool.type}
          toolName={tool.toolName}
          label={tool.label}
          status={tool.status}
          isExpanded={isExpanded}
          onToggle={handleToggle}
          onCopy={handleCopy}
          copied={copied}
          hasBody={hasBody}
          targetName={tool.targetName}
          diff={tool.diff}
          baseline={tool.streamTarget ?? tool.baseline}
          content={tool.content}
          isFileEdit={true}
        />

        {/* Accordion Body */}
        {hasBody && (
          <div
            className={`grid transition-[grid-template-rows,opacity] duration-200 ease-out motion-reduce:transition-none ${
              isExpanded
                ? 'grid-rows-[1fr] opacity-100 pointer-events-auto'
                : 'grid-rows-[0fr] opacity-0 pointer-events-none'
            }`}
          >
            <div className="min-h-0 overflow-hidden bg-surface-secondary">
              {(isExpanded || keepBodyMounted) && renderContent()}
            </div>
          </div>
        )}
      </div>
    )
  }

  // =========================================================================
  // 4. Other agent tools -> Semantic row with a result view when expanded
  // =========================================================================
  return (
    <div
      ref={cardRef}
      className="w-full select-none"
    >
      <ToolHeader
        type={tool.type}
        toolName={tool.toolName}
        label={tool.label}
        status={tool.status}
        isExpanded={isExpanded}
        onToggle={handleToggle}
        onCopy={handleCopy}
        copied={copied}
        hasBody={hasBody}
        targetName={tool.targetName}
        diff={tool.diff}
        content={tool.content}
        isFileEdit={false}
      />

      {/* Accordion Body in a neat rounded card */}
      {hasBody && (
        <div
          className={`grid transition-[grid-template-rows,opacity] duration-200 ease-out motion-reduce:transition-none ${
            isExpanded
              ? 'grid-rows-[1fr] opacity-100 pointer-events-auto'
              : 'grid-rows-[0fr] opacity-0 pointer-events-none'
          }`}
        >
          <div className="min-h-0 overflow-hidden">
            <div className="rounded-[14px] bg-surface-secondary overflow-hidden my-1">
              {(isExpanded || keepBodyMounted) && renderContent()}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
