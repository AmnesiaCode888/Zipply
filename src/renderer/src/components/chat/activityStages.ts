import type { MessageBlock } from '../../types/chat'
import { isFileEditOrWrite } from '../tools/utils/toolHelpers'

type ActivityBlock = MessageBlock
export type ActivityItem =
  | { kind: 'activity'; id: string; title: string; blocks: ActivityBlock[] }
  | { kind: 'block'; block: MessageBlock }

/** Group consecutive work without modifying the stored message or its order. */
export function buildActivityItems(blocks: MessageBlock[], isStreaming = false): ActivityItem[] {
  const items: ActivityItem[] = []
  let current: Extract<ActivityItem, { kind: 'activity' }> | undefined
  let pending: Array<Extract<MessageBlock, { type: 'thinking' | 'text' }>> = []
  const flush = (): void => { if (current) items.push(current); current = undefined }
  const flushPending = (): void => {
    if (current) current.blocks.push(...pending)
    else for (const block of pending) items.push({ kind: 'block', block })
    pending = []
  }

  for (const block of blocks) {
    if (block.type === 'thinking') {
      flushPending()
      flush()
      items.push({ kind: 'block', block })
      continue
    }
    if (block.type === 'text' && block.isActivity) { pending.push(block); continue }
    if (block.type !== 'tool' || isFileEditOrWrite(block.tool)) {
      flushPending()
      flush()
      items.push({ kind: 'block', block })
      continue
    }
    if (!current) {
      current = { kind: 'activity', id: block.id, title: 'Работа над задачей', blocks: [] }
    }
    current.blocks.push(...pending, block)
    pending = []
  }
  if (isStreaming && pending.some(block => block.isStreaming)) {
    flush()
    for (const block of pending) items.push({ kind: 'block', block })
  } else { flushPending(); flush() }
  return items
}
