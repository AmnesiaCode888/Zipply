import React from 'react'
import { ChevronDown } from '../../icons'
import type { ToolCall } from '../../types/chat'
import { DiffViewer } from './DiffViewer'
import { VSCodeFileIcon } from './VSCodeFileIcon'
import { computeDiffCounts } from './utils/toolHelpers'

const actions: Record<string, string> = { create: 'Создан', update: 'Изменён', delete: 'Удалён' }

export const PatchFiles: React.FC<{ files: NonNullable<ToolCall['patchFiles']> }> = ({ files }) => (
  <div className="max-h-[420px] overflow-auto code-scrollbar p-2 select-text">
    <div className="flex items-center justify-between gap-3 px-3 pt-2 pb-2 text-[15px] leading-[22px] text-secondary">
      <span className="font-medium text-primary">Изменения</span>
      <span className="shrink-0">Файлов: {files.length}</span>
    </div>
    <div className="space-y-1">
      {files.map(file => {
        const counts = computeDiffCounts(undefined, file.diff)
        return <details key={file.path} className="group min-w-0">
          <summary className="flex min-w-0 cursor-pointer list-none items-center gap-2.5 rounded-[14px] px-3 py-2.5 text-[15px] leading-[22px] text-secondary hover:bg-hover [&::-webkit-details-marker]:hidden">
            <span aria-hidden="true" className="shrink-0"><VSCodeFileIcon filename={file.path} size={16} /></span>
            <span className="min-w-0 flex-1 truncate" title={file.path}><span className="text-primary">{file.path}</span> · {actions[file.action] || file.action}</span>
            <span className="shrink-0 text-[13px] tabular-nums" aria-label={`Добавлено ${counts.added}, удалено ${counts.removed}`}><span className="text-diff-add">+{counts.added}</span>{' '}<span className="text-diff-remove">−{counts.removed}</span></span>
            <ChevronDown size={15} strokeWidth={1.8} aria-hidden="true" className="shrink-0 transition-transform duration-200 group-open:rotate-180 motion-reduce:transition-none" />
          </summary>
          <div className="mx-2 mb-2 overflow-auto rounded-[14px] bg-canvas code-scrollbar"><DiffViewer diffText={file.diff} /></div>
        </details>
      })}
    </div>
  </div>
)
