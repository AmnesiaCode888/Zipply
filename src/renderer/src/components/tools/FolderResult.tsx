import React from 'react'
import type { ToolCall } from '../../types/chat'
import { VSCodeFileIcon } from './VSCodeFileIcon'

type Entry = { path: string; name: string; depth: number; folder: boolean; size?: string }

function parseEntries(content: string): Entry[] {
  const lines = content.split(/\r?\n/)
  const separator = lines.findIndex(line => /^={3,}$/.test(line.trim()))
  return lines.slice(separator >= 0 ? separator + 1 : 0).flatMap(line => {
    if (!line.trim() || line.trim() === '(папка пуста)' || line.trim().startsWith('... [Вывод ограничен')) return []
    const depth = Math.floor((line.length - line.trimStart().length) / 2)
    const raw = line.trim()
    const folder = raw.startsWith('📁') || /\/$/.test(raw)
    const name = raw.replace(/^[📁📄]\s*/, '').replace(/\s+\([\d.]+\s*KB\)$/, '').replace(/\/$/, '')
    const size = /\((\d+(?:\.\d+)?)\s*KB\)$/.exec(raw)?.[1]
    return [{ path: name, name: name.split(/[\\/]/).pop() || name, depth, folder, size }]
  })
}

export const FolderResult: React.FC<{ tool: ToolCall }> = ({ tool }) => {
  const content = tool.content || ''
  const data = tool.toolData && typeof tool.toolData === 'object' ? tool.toolData as Record<string, unknown> : {}
  const entries = parseEntries(content)
  const count = typeof data.itemCount === 'number' ? data.itemCount : entries.length
  const truncated = data.truncated === true || content.includes('Вывод ограничен')
  const path = typeof data.path === 'string' ? data.path : tool.targetName || '.'
  if (tool.status === 'error') return <div className="rounded-[14px] bg-surface-secondary px-4 py-3.5 text-[14px] leading-[22px] text-secondary">{content || `Не удалось открыть папку ${path}.`}</div>
  return <div className="max-h-[320px] overflow-auto rounded-[14px] bg-surface-secondary p-3 select-text">
    <div className="mb-2.5 flex min-w-0 items-center justify-between gap-3 px-2">
      <div className="min-w-0 truncate text-[14px] font-medium text-primary" title={path}>{path === '.' ? 'Рабочая папка' : path}</div>
      <span className="shrink-0 text-[12px] text-secondary">{count} {count === 1 ? 'элемент' : 'элементов'}</span>
    </div>
    {entries.length > 0 ? <div className="flex flex-col gap-0.5">
      {entries.map((entry, index) => <div key={`${entry.path}:${index}`} className="flex min-w-0 items-center gap-2 rounded-[10px] px-2.5 py-1.5 hover:bg-hover" style={{ paddingLeft: `${10 + Math.min(entry.depth, 8) * 16}px` }}>
        {!entry.folder && <span aria-hidden="true" className="inline-flex shrink-0"><VSCodeFileIcon filename={entry.name} size={15} /></span>}
        <span className="min-w-0 flex-1 truncate text-[13px] leading-[19px] text-primary" title={entry.path}>{entry.name}</span>
        {entry.size && <span className="shrink-0 text-[11px] leading-[16px] text-muted">{entry.size} KB</span>}
      </div>)}
      {truncated && <p className="m-0 px-2.5 pt-2 text-[12px] leading-[18px] text-muted">Список сокращён. Укажите подпапку, чтобы сузить просмотр.</p>}
    </div> : <div className="px-2 py-3 text-[14px] leading-[21px] text-secondary">Папка пуста.</div>}
  </div>
}
