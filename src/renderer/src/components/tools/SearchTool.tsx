import React from 'react'
import type { ToolCall } from '../../types/chat'

type SearchResult = { title?: string; url?: string; snippet?: string }

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function text(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function SearchPanel({ children }: { children: React.ReactNode }) {
  return <div className="max-h-[320px] overflow-auto rounded-[14px] bg-surface-secondary p-3 select-text">{children}</div>
}

function NoResults({ content }: { content: string }) {
  const message = content.trim() || 'Результатов нет.'
  return <SearchPanel><p className="m-0 px-1 py-2 text-[14px] leading-[22px] text-secondary">{message}</p></SearchPanel>
}

function SearchFailure({ content }: { content: string }) {
  return <SearchPanel><div className="px-1 py-1.5">
    <div className="text-[14px] leading-[20px] font-medium text-primary">Поиск не выполнен</div><p className="m-0 mt-1 whitespace-pre-wrap break-words text-[13px] leading-[20px] text-secondary">{content || 'Инструмент вернул ошибку без описания.'}</p>
  </div></SearchPanel>
}

function WebResults({ results, content }: { results: SearchResult[]; content: string }) {
  if (results.length === 0) return <NoResults content={content} />
  return <SearchPanel>
    <p className="m-0 mb-2 px-2 text-[12px] leading-[18px] text-muted">Поисковые фрагменты; страницы ещё не открыты.</p>
    <div className="mb-2 flex items-center justify-between gap-3 px-2">
      <div className="text-[14px] font-medium text-primary">Найденные страницы</div>
      <span className="text-[12px] text-secondary">{results.length}</span>
    </div>
    <div className="flex flex-col gap-1">
      {results.map((result, index) => <div key={`${result.url || index}:${index}`} className="min-w-0 rounded-[12px] bg-surface px-3 py-2.5">
        <div className="flex min-w-0 items-start justify-between gap-3">
          <span className="min-w-0 text-[14px] leading-[20px] font-medium text-primary">{result.title || result.url || 'Страница без названия'}</span>
        </div>
        {result.url && <div className="mt-1 truncate text-[12px] leading-[18px] text-muted" title={result.url}>{result.url}</div>}
        {result.snippet && <p className="m-0 mt-1.5 text-[13px] leading-[20px] text-secondary">{result.snippet}</p>}
      </div>)}
    </div>
  </SearchPanel>
}

type Match = { path: string; line: number; text: string; context: boolean }

function parseMatches(content: string): Match[] {
  const matches: Match[] = []
  for (const line of content.split(/\r?\n/)) {
    const result = /^(.*?)(:|-)(\d+)(:|-)(.*)$/.exec(line)
    if (!result) continue
    matches.push({ path: result[1], line: Number(result[3]), text: result[5], context: result[2] === '-' || result[4] === '-' })
  }
  return matches
}

function ProjectMatches({ matches, content, notice }: { matches: Match[]; content: string; notice?: string }) {
  if (matches.length === 0) {
    const paths = content.split(/\r?\n/).map(line => line.trim()).filter(line => line && !line.startsWith('[') && !/совпадений не найдено/i.test(line))
    if (!paths.length) return <NoResults content={content} />
    return <SearchPanel>
      <div className="mb-2 flex items-center justify-between gap-3 px-2"><div className="text-[14px] font-medium text-primary">Найденные файлы</div><span className="text-[12px] text-secondary">{paths.length}</span></div>
      <div className="flex flex-col gap-1">{paths.map(path => <div key={path} className="flex min-w-0 items-center rounded-[12px] bg-surface px-3 py-2 text-[14px] leading-[20px] text-primary"><span className="min-w-0 truncate" title={path}>{path}</span></div>)}</div>
      {notice && <p className="m-0 px-2 pt-2 text-[12px] leading-[18px] text-muted">{notice}</p>}
    </SearchPanel>
  }

  const uniqueFiles = new Set(matches.map(match => match.path)).size
  return <SearchPanel>
    <div className="mb-2 flex items-center justify-between gap-3 px-2"><div className="text-[14px] font-medium text-primary">Совпадения в проекте</div><span className="text-[12px] text-secondary">{matches.length} · {uniqueFiles} {uniqueFiles === 1 ? 'файл' : 'файла'}</span></div>
    <div className="flex flex-col gap-1">
      {matches.map((match, index) => <div key={`${match.path}:${match.line}:${index}`} className="min-w-0 rounded-[12px] bg-surface px-3 py-2">
        <div className="flex min-w-0 items-center gap-2">
          <span className="min-w-0 flex-1 truncate text-[13px] leading-[19px] text-primary" title={match.path}>{match.path}</span>
          <span className="shrink-0 rounded-full bg-surface-secondary px-2 py-0.5 text-[11px] leading-[16px] tabular-nums text-muted">{match.line}</span>
        </div>
        {match.text && <div className={`mt-1.5 whitespace-pre-wrap break-words text-[12.5px] leading-[19px] ${match.context ? 'text-muted' : 'text-secondary'}`}>{match.text}</div>}
      </div>)}
    </div>
    {notice && <p className="m-0 px-2 pt-2 text-[12px] leading-[18px] text-muted">{notice}</p>}
  </SearchPanel>
}

export const SearchTool: React.FC<{ tool: ToolCall }> = ({ tool }) => {
  const data = record(tool.toolData)
  const content = tool.content || ''
  const results = Array.isArray(data.results) ? data.results.map(record).map(item => ({ title: text(item.title), url: text(item.url), snippet: text(item.snippet) })) : []
  const paths = Array.isArray(data.paths) ? data.paths.filter((item): item is string => typeof item === 'string') : []
  const name = tool.toolName || ''
  const skipped = typeof data.skippedLargeFiles === 'number' && data.skippedLargeFiles > 0
    ? `${data.skippedLargeFiles} крупных ${data.skippedLargeFiles === 1 ? 'файл пропущен' : 'файла пропущено'}`
    : data.skippedLargeFiles === null ? 'Не все крупные файлы попали в поиск' : ''
  const notice = [data.truncated === true && 'Показана часть результатов по лимиту', skipped].filter(Boolean).join(' · ')

  if (tool.status === 'error') return <SearchFailure content={content} />
  if (results.length || name === 'search_web') return <WebResults results={results} content={content} />
  if (paths.length) return <ProjectMatches matches={[]} content={paths.join('\n')} notice={notice} />
  return <ProjectMatches matches={parseMatches(content)} content={content} notice={notice} />
}
