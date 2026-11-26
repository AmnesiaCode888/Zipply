import React from 'react'
import type { ToolCall } from '../../types/chat'
import { CodeHighlight } from './CodeHighlight'

type ReadSection = { path: string; range?: string; startLine?: number; code: string }

function parseFormattedSections(content: string): ReadSection[] {
  const heading = /^Файл: (.+?) \(строки ([^)]+)\)\r?\nSHA-256:[^\r\n]*\r?\n=+\r?\n/gm
  const matches = [...content.matchAll(heading)]
  return matches.map((match, index) => {
    const start = (match.index ?? 0) + match[0].length
    const end = index + 1 < matches.length ? matches[index + 1].index ?? content.length : content.length
    const body = content.slice(start, end)
    const lines = body.split(/\r?\n/)
      .filter(line => !/^\[(?:Осталось ещё|Вывод ограничен|Содержимое длинной строки|Пропущен файл)/.test(line) && !/^Ошибка:/.test(line))
      .map(line => /^\s*\d+ \| (.*)$/.exec(line)?.[1] ?? line)
    return { path: match[1], range: match[2], startLine: Number(/^\d+/.exec(match[2])?.[0]) || 1, code: lines.join('\n').trimEnd() }
  })
}

export interface FileReadToolProps {
  tool: ToolCall
}

export const FileReadTool: React.FC<FileReadToolProps> = ({ tool }) => {
  const data = tool.toolData && typeof tool.toolData === 'object' ? tool.toolData as Record<string, unknown> : {}
  const rawCode = typeof data.content === 'string' ? data.content : undefined
  const formattedSections = parseFormattedSections(tool.content || '')
  const sections: ReadSection[] = rawCode !== undefined
    ? [{ path: tool.targetName || 'Файл', range: typeof data.startLine === 'number' && typeof data.endLine === 'number' ? `${data.startLine}–${data.endLine}` : undefined, startLine: typeof data.startLine === 'number' ? data.startLine : 1, code: rawCode }]
    : formattedSections

  return <div className="max-h-[360px] overflow-auto rounded-[14px] bg-surface-secondary p-2.5 select-text">
    {sections.length > 0 ? <div className="flex flex-col gap-1.5">
      {sections.map((section, index) => <div key={`${section.path}:${index}`} className="min-w-0 overflow-hidden rounded-[14px] bg-surface">
        <div className="flex min-w-0 items-center gap-2.5 px-3.5 py-2.5">
          <span className="min-w-0 flex-1 truncate text-[13px] leading-[19px] font-medium text-primary" title={section.path}>{section.path}</span>
          {section.range && <span className="shrink-0 text-[11px] leading-[16px] text-muted">строки {section.range}</span>}
        </div>
        <div className="overflow-x-auto px-3.5 pb-3 code-scrollbar">
          {section.code ? <CodeHighlight code={section.code} startLine={section.startLine} /> : <p className="m-0 py-2 text-[13px] leading-[20px] text-secondary">Нет строк для показа.</p>}
        </div>
      </div>)}
      {tool.content && formattedSections.length > 0 && <details className="rounded-[12px] px-3 py-2 text-[12px] leading-[18px] text-muted">
        <summary className="cursor-pointer">Сведения о чтении</summary>
        <pre className="m-0 mt-2 whitespace-pre-wrap break-words font-sans">{tool.content}</pre>
      </details>}
    </div> : <div className="rounded-[12px] bg-surface px-3.5 py-3">
      <div className="text-[14px] leading-[22px] text-secondary">{tool.content || 'Нет текстового содержимого.'}</div>
    </div>}
  </div>
}
