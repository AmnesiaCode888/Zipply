import type { ChatSession } from '../types/chat'

export interface ChatSearchResult { chatId: string; title: string; messageId?: string; snippet: string }

export function searchChats(sessions: ChatSession[], query: string): ChatSearchResult[] {
  const needle = query.trim().toLocaleLowerCase()
  if (!needle) return []
  const results: ChatSearchResult[] = []
  for (const session of sessions) {
    const title = session.title || 'Новый чат'
    if (title.toLocaleLowerCase().includes(needle)) results.push({ chatId: session.id, title, snippet: 'Название чата' })
    for (const message of session.messages) {
      const parts = [message.content || '', ...(message.blocks || []).filter(block => block.type === 'text' && !block.isActivity).map(block => block.type === 'text' ? block.content : '')]
      const content = parts.join(' ').replace(/\s+/g, ' ').trim()
      const index = content.toLocaleLowerCase().indexOf(needle)
      if (index < 0) continue
      const start = Math.max(0, index - 45)
      const end = Math.min(content.length, index + needle.length + 70)
      results.push({ chatId: session.id, title, messageId: message.id, snippet: `${start ? '…' : ''}${content.slice(start, end)}${end < content.length ? '…' : ''}` })
    }
  }
  return results
}
