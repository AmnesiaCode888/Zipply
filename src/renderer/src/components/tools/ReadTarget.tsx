import React from 'react'
import type { ToolCall } from '../../types/chat'
import { VSCodeFileIcon } from './VSCodeFileIcon'

export function getReadTargets(tool: ToolCall): string[] {
  return tool.filePaths?.length ? tool.filePaths : tool.targetName ? [tool.targetName] : []
}

export const ReadTarget: React.FC<{ target: string }> = ({ target }) => {
  const isPage = /^https?:\/\//i.test(target)
  const name = isPage ? target : target.split(/[\\/]/).filter(Boolean).pop() || target
  return (
    <span className="inline-flex items-center gap-1 min-w-0 max-w-full" title={target}>
      {!isPage && <span aria-hidden="true" className="inline-flex shrink-0"><VSCodeFileIcon filename={name} size={15} /></span>}
      <span className="truncate min-w-0">{name}</span>
    </span>
  )
}
