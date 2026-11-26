import React from 'react'
import type { LucideIcon, LucideProps } from 'lucide-react'
export * from 'lucide-react'
import arrowUpUrl from './assets/openai-icons/arrowUp.svg'
import attachmentUrl from './assets/openai-icons/attachment.svg'
import botUrl from './assets/openai-icons/bot.svg'
import checkUrl from './assets/openai-icons/check.svg'
import dataManagementUrl from './assets/openai-icons/dataManagement.svg'
import deleteUrl from './assets/openai-icons/delete.svg'
import downArrowUrl from './assets/openai-icons/downArrow.svg'
import downloadUrl from './assets/openai-icons/download.svg'
import filesUrl from './assets/openai-icons/files.svg'
import linkUrl from './assets/openai-icons/link.svg'
import newChatUrl from './assets/openai-icons/newChat.svg'
import plusUrl from './assets/openai-icons/plus.svg'
import searchUrl from './assets/openai-icons/search.svg'
import settingsUrl from './assets/openai-icons/settings.svg'
import sidebarUrl from './assets/openai-icons/sidebar.svg'
import uploadUrl from './assets/openai-icons/upload.svg'

function icon(url: string): LucideIcon {
  // Vite may inline SVGs as data URLs containing spaces and quotes. CSS url()
  // needs a quoted, escaped value or Chromium silently drops the mask.
  const mask = `url("${url.replace(/"/g, '%22').replace(/#/g, '%23')}") center / contain no-repeat`
  return React.forwardRef<SVGSVGElement, LucideProps>(function OpenAIIcon({ size = 24, color, className, style, strokeWidth: _strokeWidth, absoluteStrokeWidth: _absoluteStrokeWidth, ...props }, ref) {
    return <svg ref={ref} width={size} height={size} viewBox="0 0 24 24" className={className} style={{ ...(color ? { color } : {}), ...style }} {...props}><foreignObject width="24" height="24"><div style={{ width: '100%', height: '100%', backgroundColor: 'currentColor', mask, WebkitMask: mask }} /></foreignObject></svg>
  }) as LucideIcon
}
export const Settings = icon(settingsUrl)
export const Search = icon(searchUrl)
export const Trash2 = icon(deleteUrl)
export const Plus = icon(plusUrl)
export const Check = icon(checkUrl)
export const ArrowUp = icon(arrowUpUrl)
export const Paperclip = icon(attachmentUrl)
export const PanelLeft = icon(sidebarUrl)
export const Folder = icon(filesUrl)
export const FolderClosed = icon(filesUrl)
export const ChevronDown = icon(downArrowUrl)
export const Database = icon(dataManagementUrl)
export const Upload = icon(uploadUrl)
export const Download = icon(downloadUrl)
export const Bot = icon(botUrl)
export const Link = icon(linkUrl)
export const NewChat = icon(newChatUrl)
