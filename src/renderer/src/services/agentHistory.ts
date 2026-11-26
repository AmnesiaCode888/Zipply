import type { AgentHistoryMessage } from '../../../shared/agentEvents'
import type { Message } from '../types/chat'

function toModelHistoryMessage(message: AgentHistoryMessage): AgentHistoryMessage | null {
  const { isProgressUpdate, ...modelMessage } = message
  if (!isProgressUpdate) return modelMessage
  if (modelMessage.role !== 'assistant' || !modelMessage.tool_calls?.length) return null
  return { ...modelMessage, content: null }
}

export function buildAgentHistory(messages: Message[]): AgentHistoryMessage[] {
  const history: AgentHistoryMessage[] = []
  for (const message of messages) {
    if (message.role === 'assistant' && message.agentHistory?.length) {
      for (const item of message.agentHistory) {
        if (item.name === 'zipply_context_snapshot' && typeof item.content === 'string') {
          try {
            const snapshot = JSON.parse(item.content)
            if (Array.isArray(snapshot)) {
              history.splice(0, history.length, ...snapshot.map(toModelHistoryMessage).filter((entry): entry is AgentHistoryMessage => Boolean(entry)))
              continue
            }
          } catch { /* Ignore damaged snapshot and retain the existing history. */ }
        }
        const modelMessage = toModelHistoryMessage(item)
        if (modelMessage) history.push(modelMessage)
      }
      continue
    }
    if (message.isProgressUpdate) continue
    const content = message.content || message.blocks?.filter((block) => block.type === 'text' && !block.id?.startsWith('err-') && !block.content?.startsWith('⚠️')).map((block) => block.type === 'text' ? block.content : '').join('\n\n') || ''
    if (message.role === 'user' && message.attachments?.length) {
      history.push({ role: 'user', content: [
        ...(content ? [{ type: 'text', text: content }] : []),
        ...message.attachments.flatMap((attachment) => /\.(png|jpg|webp|gif)$/.test(attachment.path) ? [
          { type: 'text', text: `Изображение: ${attachment.name} (${attachment.path})` },
          { type: 'image_url', image_url: { url: `zipply-upload:${attachment.path}` } }
        ] : [{ type: 'text', text: `Документ: ${attachment.name} (${attachment.path})` }, { type: 'text', text: `zipply-document:${attachment.path}` }])
      ] })
    } else if (content) history.push({ role: message.role, content })
    else if (message.role === 'user' && message.extensionRefs?.length) {
      // Keep a real user turn for a selected Skill, MCP prompt/resource or plugin
      // even when the composer text is empty. The reference itself and its content
      // stay outside provider history and are resolved for this run in main.
      history.push({ role: 'user', content: 'Используй выбранные расширения для выполнения запроса.' })
    }
  }
  return history
}
