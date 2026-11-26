export function temporaryChatTitle(message: string): string {
  const text = message.trim().replace(/\s+/g, ' ')
  return text ? (text.length > 28 ? text.slice(0, 28) + '...' : text) : 'Изображение'
}

export function chooseChatTitle(current: string, proposed?: string, expected?: string): string {
  return proposed && (current === 'Новый чат' || (expected !== undefined && current === expected)) ? proposed : current
}

export function cleanGeneratedTitle(value: unknown): string | null {
  if (typeof value !== 'string' || /[\r\n]/.test(value.trim())) return null
  const title = value.trim().replace(/[.!?…]+$/, '').trim().replace(/^["'«`]+|["'»`]+$/g, '').trim()
  return title && title.length < 60 ? title : null
}
