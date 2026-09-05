import React from 'react'
import {
  Brain,
  FileText,
  FileCode2,
  Terminal,
  Search,
  Plus,
  Globe,
  Compass,
  Bookmark,
  Bot,
  Sparkles,
  Zap,
  Clock,
  Boxes
} from 'lucide-react'
import { StepItem, StepType } from '../../types/chat'
import { renderMarkdown } from '../MarkdownRenderer'
import { DiffViewer } from './viewers/DiffViewer'
import { FileCodeViewer } from './viewers/FileCodeViewer'
import { TerminalRunViewer } from './viewers/TerminalRunViewer'
import { GrepViewer } from './viewers/GrepViewer'
import { CreatedFileViewer } from './viewers/CreatedFileViewer'
import { WebSearchViewer } from './viewers/WebSearchViewer'
import { WebPageViewer } from './viewers/WebPageViewer'
import { MemoryViewer } from './viewers/MemoryViewer'
import { SubagentViewer } from './viewers/SubagentViewer'
import { McpViewer } from './viewers/McpViewer'

export interface ToolStepViewerProps {
  step: StepItem
}

/**
 * Registry of tool icons for each step type
 */
export function getStepIcon(type: StepType): React.ReactNode {
  switch (type) {
    case 'thought':
      return <Brain size={14} className="step-type-icon" />
    case 'edit':
      return <FileCode2 size={14} className="step-type-icon" />
    case 'run':
      return <Terminal size={14} className="step-type-icon" />
    case 'create':
      return <Plus size={14} className="step-type-icon" />
    case 'grep':
      return <Search size={14} className="step-type-icon" />
    case 'web_search':
      return <Globe size={14} className="step-type-icon" />
    case 'read_page':
      return <Compass size={14} className="step-type-icon" />
    case 'memory':
      return <Bookmark size={14} className="step-type-icon" />
    case 'schedule':
      return <Clock size={14} className="step-type-icon" />
    case 'ask_agent':
      return <Bot size={14} className="step-type-icon" />
    case 'read_skill':
      return <Zap size={14} className="step-type-icon" />
    case 'save_skill':
      return <Sparkles size={14} className="step-type-icon" />
    case 'mcp':
      return <Boxes size={14} className="step-type-icon" />
    case 'read':
    default:
      return <FileText size={14} className="step-type-icon" />
  }
}

/**
 * Formats a human-readable title for a step without duplication
 */
export const DEEP_THINKING_THRESHOLD_S = 10

export function isDeepThought(step: StepItem): boolean {
  return step.type === 'thought' && (step.durationSeconds ?? 0) >= DEEP_THINKING_THRESHOLD_S
}

export function formatStepTitle(step: StepItem): string {
  if (step.type === 'thought') {
    if (!step.durationSeconds) return 'Размышляю...'
    if (step.durationSeconds >= DEEP_THINKING_THRESHOLD_S) {
      return `Глубокое размышление · ${step.durationSeconds}с`
    }
    return `Размышлял ${step.durationSeconds}с`
  }
  if (step.type === 'web_search') {
    const q = step.target || (step.args?.query as string) || ''
    return q ? `Searched "${q}"` : 'Web search'
  }
  if (step.type === 'read_page') {
    const url = step.target || (step.args?.url as string) || ''
    return url ? `Read ${url}` : 'Read web page'
  }
  if (step.type === 'memory') {
    const act = (step.args?.action as string) || 'save'
    const cat = step.target || (step.args?.category as string) || ''
    return `Memory: ${act === 'save' ? 'Saved' : 'Searched'} ${cat}`.trim()
  }
  if (step.type === 'schedule') {
    const act = (step.args?.action as string) || 'create'
    const title = step.target || (step.args?.title as string) || ''
    if (act === 'create') {
      return title ? `Schedule: ${title}` : 'Scheduled task'
    }
    return `Schedule ${act}`
  }
  if (step.type === 'ask_agent') {
    const sub = step.target || (step.args?.agent_id as string) || ''
    return sub ? `Subagent: ${sub}` : 'Subagent'
  }
  if (step.type === 'run') {
    const cmd = step.target || (step.args?.command as string) || ''
    return cmd ? `Ran ${cmd}` : 'Ran command'
  }
  if (step.type === 'edit') {
    const path = step.target || (step.args?.path as string) || ''
    return path ? `Edited ${path}` : 'Edited file'
  }
  if (step.type === 'create') {
    const path = step.target || (step.args?.path as string) || ''
    return path ? `Created ${path}` : 'Created file'
  }
  if (step.type === 'read') {
    const path = step.target || (step.args?.path as string) || ''
    return path ? `Read ${path}` : 'Read file'
  }
  if (step.type === 'grep') {
    const q = step.target || (step.args?.query as string) || ''
    return q ? `Grep ${q}` : 'Grep search'
  }
  if (step.type === 'read_skill') {
    const name = step.target || (step.args?.skill_name as string) || ''
    return name ? `Подгружен навык: ${name}` : 'Загрузка навыка'
  }
  if (step.type === 'save_skill') {
    const name = step.target || (step.args?.skill_name as string) || ''
    return name ? `Сохранен навык: ${name}` : 'Сохранение навыка'
  }
  if (step.type === 'mcp') {
    const sName = (step.args?.server_name as string) || (step.args?.server as string) || ''
    const tName = (step.args?.tool_name as string) || (step.args?.tool as string) || step.target || ''
    return sName ? `MCP: ${sName}/${tName}` : `MCP: ${tName || 'Инструмент'}`
  }
  if (step.action && step.target) {
    return `${step.action} ${step.target}`
  }
  return step.action || step.target || 'Обработка...'
}

/**
 * Individual viewer components mapped by StepType (Open/Closed Principle)
 */
export const TOOL_VIEWERS: Record<StepType, React.FC<ToolStepViewerProps>> = {
  thought: ({ step }) => (
    <div className="step-thought-text thought-markdown">
      {renderMarkdown(step.result || '')}
    </div>
  ),
  edit: ({ step }) => (
    <DiffViewer
      args={step.args || { path: step.target, action: 'edit' }}
      result={step.result}
    />
  ),
  read: ({ step }) => (
    <FileCodeViewer
      args={step.args || { path: step.target, action: 'read' }}
      result={step.result}
    />
  ),
  run: ({ step }) => (
    <TerminalRunViewer
      args={step.args || { command: step.target, action: 'run' }}
      result={step.result}
    />
  ),
  grep: ({ step }) => (
    <GrepViewer
      args={step.args || { query: step.target }}
      result={step.result}
    />
  ),
  create: ({ step }) => (
    <CreatedFileViewer
      args={step.args || { path: step.target }}
      target={step.target}
      result={step.result}
    />
  ),
  web_search: ({ step }) => (
    <WebSearchViewer
      args={step.args || { query: step.target }}
      result={step.result}
      data={step.data}
    />
  ),
  read_page: ({ step }) => (
    <WebPageViewer
      args={step.args || { url: step.target }}
      result={step.result}
    />
  ),
  memory: ({ step }) => (
    <MemoryViewer
      args={step.args}
      result={step.result}
      data={step.data}
    />
  ),
  schedule: ({ step }) => (
    <div style={{ padding: '8px 0', fontSize: '13px', color: '#e2e2e6' }}>
      <div style={{ fontWeight: 550, marginBottom: 4, color: '#ffffff' }}>
        {(step.args?.action as string)?.toUpperCase() || 'SCHEDULE'}: {(step.args?.title as string) || step.target || (step.args?.type === 'once' ? 'Timer' : 'Task')}
      </div>
      <div style={{ color: '#9ca3af', fontSize: '12px', whiteSpace: 'pre-wrap', maxHeight: 180, overflowY: 'auto' }}>
        {step.result}
      </div>
    </div>
  ),
  ask_agent: ({ step }) => (
    <SubagentViewer
      args={step.args}
      result={step.result}
      data={step.data}
    />
  ),
  read_skill: ({ step }) => (
    <div style={{ padding: '8px 0', fontSize: '13px', color: '#e2e2e6' }}>
      <div style={{ fontWeight: 550, marginBottom: 6, color: '#ffffff' }}>
        Навык: {(step.args?.skill_name as string) || step.target || 'Custom'}
      </div>
      <div style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: '11.5px', color: '#9ca3af', whiteSpace: 'pre-wrap', maxHeight: 180, overflowY: 'auto' }}>
        {step.result}
      </div>
    </div>
  ),
  save_skill: ({ step }) => (
    <div style={{ padding: '8px 0', fontSize: '13px', color: '#e2e2e6' }}>
      <div style={{ fontWeight: 550, marginBottom: 4, color: '#ffffff' }}>
        Сохранен навык: {(step.args?.skill_name as string) || step.target || 'Custom'}
      </div>
      <div style={{ color: '#8e8e93', fontSize: '12px' }}>{step.result}</div>
    </div>
  ),
  mcp: ({ step }) => (
    <McpViewer
      args={step.args}
      result={step.result}
      data={step.data}
    />
  )
}

/**
 * Dynamic dispatcher rendering the appropriate viewer for a step
 */
export const ToolStepContent: React.FC<ToolStepViewerProps> = ({ step }) => {
  const Viewer = TOOL_VIEWERS[step.type]
  if (!Viewer) {
    return <div className="step-thought-text">{step.result}</div>
  }
  return <Viewer step={step} />
}
