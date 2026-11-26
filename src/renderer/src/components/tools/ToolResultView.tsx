import React from 'react'
import type { ToolCall } from '../../types/chat'

type Data = Record<string, unknown>

function asRecord(value: unknown): Data {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Data : {}
}

function asText(value: unknown, fallback = ''): string {
  return typeof value === 'string' || typeof value === 'number' ? String(value) : fallback
}

function asNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

const statusText: Record<string, string> = {
  starting: 'Запускается', running: 'Выполняется', completed: 'Завершён', error: 'Ошибка',
  passed: 'Проверка пройдена', failed: 'Проверка не пройдена', unverified: 'Не проверено'
}

function ResultShell({ children }: { children: React.ReactNode }) {
  return <div className="max-h-[320px] overflow-auto rounded-[14px] bg-surface-secondary px-4 py-3.5 select-text">{children}</div>
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return <div className="min-w-0 rounded-[12px] bg-surface px-3 py-2">
    <div className="text-[12px] leading-[17px] text-muted">{label}</div>
    <div className="mt-0.5 truncate text-[14px] leading-[20px] font-medium text-primary" title={String(value)}>{value}</div>
  </div>
}

function PlainOutput({ content }: { content: string }) {
  const trimmed = content.trim()
  let pretty = trimmed
  try {
    const parsed = JSON.parse(trimmed)
    if (parsed && typeof parsed === 'object') pretty = JSON.stringify(parsed, null, 2)
  } catch { /* Keep normal tool output as readable prose. */ }
  return <ResultShell>
    <pre className="m-0 whitespace-pre-wrap break-words font-sans text-[14px] leading-[22px] text-secondary">{pretty || 'Нет подробностей.'}</pre>
  </ResultShell>
}

function PlanResult({ data, content }: { data: Data; content: string }) {
  const plan = Array.isArray(data.plan) ? data.plan.map(asRecord) : []
  const criteria = Array.isArray(data.criteria) ? data.criteria.map(item => typeof item === 'string' ? item : asText(asRecord(item).text)) : []
  const explanation = asText(data.explanation)
  const completed = plan.filter(step => step.status === 'completed').length
  if (!plan.length) return <PlainOutput content={content} />
  return <ResultShell>
    <div className="mb-3 flex items-center justify-between gap-3">
      <div className="text-[15px] font-medium text-primary">План задачи</div>
      <span className="shrink-0 text-[13px] tabular-nums text-secondary">{completed} из {plan.length}</span>
    </div>
    <ol className="m-0 flex list-none flex-col gap-1.5 p-0">
      {plan.map((step, index) => {
        const state = asText(step.status, 'pending')
        const done = state === 'completed'
        const active = state === 'in_progress'
        return <li key={`${index}:${asText(step.step)}`} className="flex min-w-0 items-start gap-2.5 rounded-[12px] bg-surface px-3 py-2.5">
          <span className={`mt-0.5 flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full ${done ? 'bg-control text-primary' : active ? 'bg-control text-primary' : 'bg-surface-secondary text-muted'}`}>
            <span className="text-[11px] tabular-nums">{index + 1}</span>
          </span>
          <span className={`min-w-0 flex-1 text-[14px] leading-[21px] ${done ? 'text-secondary' : 'text-primary'}`}>{asText(step.step)}</span>
          {active && <span className="shrink-0 pt-0.5 text-[12px] leading-[18px] text-secondary">Сейчас</span>}
        </li>
      })}
    </ol>
    {explanation && <p className="m-0 mt-3 text-[13px] leading-[20px] text-secondary">{explanation}</p>}
    {criteria.length > 0 && <div className="mt-3 rounded-[12px] bg-surface px-3 py-2.5">
      <div className="mb-1 text-[12px] leading-[17px] text-muted">Критерии</div>
      <ul className="m-0 list-disc space-y-1 pl-4 text-[13px] leading-[20px] text-secondary">{criteria.map((criterion, index) => <li key={`${index}:${criterion}`}>{criterion}</li>)}</ul>
    </div>}
  </ResultShell>
}

function VerificationResult({ data, content, browser }: { data: Data; content: string; browser?: boolean }) {
  const passed = data.passed === true || /^PASS:/i.test(content)
  const status = passed ? 'Проверка пройдена' : data.passed === false || /^FAIL:/i.test(content) ? 'Проверка не пройдена' : 'Проверка завершена'
  const path = asText(data.path || data.url)
  const pageTitle = asText(data.title)
  const checks = [
    ['Ошибок консоли', asNumber(data.consoleErrors)],
    ['Ошибок страницы', asNumber(data.pageErrors)],
    ['Ошибок сети', asNumber(data.httpErrors)]
  ].filter((entry): entry is [string, number] => entry[1] !== undefined)
  return <ResultShell>
    <div className="flex min-w-0 items-start gap-3">
      <div className="min-w-0 flex-1">
        <div className="text-[15px] leading-[22px] font-medium text-primary">{status}</div>
        {browser && pageTitle && <div className="mt-0.5 truncate text-[13px] leading-[19px] text-primary" title={pageTitle}>{pageTitle}</div>}
        {path && <div className="mt-0.5 truncate text-[13px] leading-[19px] text-secondary" title={path}>{path}</div>}
      </div>
    </div>
    {(checks.length > 0 || typeof data.predicate === 'string' || typeof data.criterionId === 'string') && <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
      {typeof data.predicate === 'string' && <Stat label="Условие" value={asText(data.predicate)} />}
      {checks.map(([label, value]) => <Stat key={label} label={label} value={value} />)}
      {typeof data.criterionId === 'string' && <Stat label="Критерий" value={asText(data.criterionId)} />}
      {typeof data.status === 'string' && browser && <Stat label="Страница" value={`HTTP ${asText(data.status)}`} />}
    </div>}
    {checks.length === 0 && typeof data.predicate !== 'string' && <p className="m-0 mt-3 text-[14px] leading-[22px] text-secondary">{content.replace(/^PASS:\s*browser_verify\s*\([^)]*\)\s*/i, '').replace(/^FAIL:\s*browser_verify\s*\([^)]*\)\s*/i, '')}</p>}
    {typeof data.screenshotPath === 'string' && <div className="mt-3 truncate text-[12px] leading-[18px] text-muted" title={data.screenshotPath}>Снимок сохранён: {data.screenshotPath}</div>}
  </ResultShell>
}

function AgentResult({ data, content }: { data: Data; content: string }) {
  const role = asText(data.role)
  const status = asText(data.status, 'completed')
  const roleLabels: Record<string, string> = { explorer: 'Исследователь', reviewer: 'Ревьюер', worker: 'Исполнитель' }
  const summary = asText(data.summary)
  const checks = Array.isArray(data.checks) ? data.checks.map(asRecord) : []
  return <ResultShell>
    <div className="flex flex-wrap items-center justify-between gap-2">
      <div className="text-[15px] font-medium text-primary">{roleLabels[role] || 'Субагент'}</div>
      <span className="rounded-full bg-surface px-2.5 py-1 text-[12px] leading-[17px] text-secondary">{statusText[status] || status}</span>
    </div>
    <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
      {asNumber(data.rounds) !== undefined && <Stat label="Раундов" value={asNumber(data.rounds)!} />}
      {asNumber(data.toolCallsCount) !== undefined && <Stat label="Действий" value={asNumber(data.toolCallsCount)!} />}
      {typeof data.verificationStatus === 'string' && <Stat label="Проверка" value={statusText[asText(data.verificationStatus)] || asText(data.verificationStatus)} />}
    </div>
    {summary && <p className="m-0 mt-3 whitespace-pre-wrap break-words text-[14px] leading-[22px] text-secondary">{summary}</p>}
    {!summary && <p className="m-0 mt-3 whitespace-pre-wrap break-words text-[14px] leading-[22px] text-secondary">{content}</p>}
    {checks.length > 0 && <div className="mt-3 flex flex-col gap-1.5">
      {checks.map((check, index) => <div key={`${index}:${asText(check.toolName)}`} className="flex min-w-0 items-center gap-2 text-[13px] leading-[19px]">
        <span className="min-w-0 flex-1 truncate text-secondary">{asText(check.toolName, 'Проверка')}{check.command ? ` · ${asText(check.command)}` : ''}</span>
        <span className="shrink-0 text-muted">{check.passed === true ? 'готово' : 'не пройдена'}</span>
      </div>)}
    </div>}
    {summary && content.trim() && content.trim() !== summary.trim() && <details className="mt-3 rounded-[12px] bg-surface px-3 py-2.5">
      <summary className="cursor-pointer text-[13px] leading-[20px] text-secondary">Полный отчёт</summary>
      <pre className="m-0 mt-2 whitespace-pre-wrap break-words font-sans text-[12px] leading-[19px] text-muted">{content}</pre>
    </details>}
  </ResultShell>
}

function CodeIntelligenceResult({ data, content }: { data: Data; content: string }) {
  const items = Array.isArray(data.items) ? data.items.map(asRecord) : []
  if (!items.length) return <PlainOutput content={content} />
  const truncated = data.truncated === true
  return <ResultShell>
    <div className="mb-3 flex items-center justify-between gap-3">
      <div className="text-[15px] font-medium text-primary">Результаты анализа</div>
      <span className="shrink-0 text-[13px] text-secondary">{items.length}{truncated ? '+' : ''} совпадений</span>
    </div>
    <div className="flex flex-col gap-1.5">
      {items.map((item, index) => {
        const location = [asText(item.path), asText(item.line), asText(item.column)].filter(Boolean).join(':')
        const title = asText(item.name || item.kind || item.category || item.code, asText(item.path, 'Найдено'))
        const detail = asText(item.message || item.text || item.code)
        return <div key={`${index}:${location}`} className="min-w-0 rounded-[12px] bg-surface px-3 py-2.5">
          <div className="flex min-w-0 flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
            <span className="min-w-0 truncate text-[14px] leading-[20px] font-medium text-primary" title={title}>{title}</span>
            {location && <span className="shrink-0 text-[12px] leading-[18px] text-muted">{location}</span>}
          </div>
          {detail && <p className="m-0 mt-1 whitespace-pre-wrap break-words text-[13px] leading-[20px] text-secondary">{detail}</p>}
        </div>
      })}
    </div>
  </ResultShell>
}

function GenericToolResult({ tool }: { tool: ToolCall }) {
  const data = asRecord(tool.toolData)
  const name = tool.toolName || ''
  if (name === 'update_plan') return <PlanResult data={data} content={tool.content || ''} />
  if (name === 'verify_file') return <VerificationResult data={data} content={tool.content || ''} />
  if (name === 'browser_verify') return <VerificationResult data={data} content={tool.content || ''} browser />
  if (name === 'spawn_agent') return <AgentResult data={data} content={tool.content || ''} />
  if (name === 'code_intelligence') return <CodeIntelligenceResult data={data} content={tool.content || ''} />

  if (name === 'ask_user') {
    const answer = (tool.content || '').replace(/^Ответ пользователя:\s*/i, '').trim()
    return <ResultShell>
      <div className="min-w-0 text-[14px] leading-[22px] text-primary">{answer || 'Уточнение пропущено.'}</div>
    </ResultShell>
  }

  if (name.startsWith('mcp_')) {
    return <ResultShell>
      <div className="mb-2 text-[14px] leading-[20px] font-medium text-primary">Ответ внешнего инструмента</div>
      <pre className="m-0 whitespace-pre-wrap break-words font-sans text-[14px] leading-[22px] text-secondary">{tool.content || 'Инструмент не вернул текстовый результат.'}</pre>
    </ResultShell>
  }

  if (name.startsWith('plugin_') || name === 'plugin_manager' || name === 'load_skill' || name === 'save_skill' || name === 'install_skill') {
    return <ResultShell>
      <div className="mb-2 text-[14px] leading-[20px] font-medium text-primary">Результат расширения</div>
      <pre className="m-0 whitespace-pre-wrap break-words font-sans text-[14px] leading-[22px] text-secondary">{tool.content || 'Нет дополнительных сведений.'}</pre>
    </ResultShell>
  }

  if (name) return <PlainOutput content={tool.content || 'Инструмент завершил работу.'} />
  return <PlainOutput content={tool.content || 'Нет подробностей.'} />
}

export const ToolResultView: React.FC<{ tool: ToolCall }> = ({ tool }) => <GenericToolResult tool={tool} />
