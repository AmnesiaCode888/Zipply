import { isExtensionRefs } from './extensions'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function optionalType(value: unknown, type: 'string' | 'boolean' | 'number'): boolean {
  return value === undefined || (typeof value === type && (type !== 'number' || Number.isFinite(value)))
}

function hasUniqueIds(values: unknown[], validate: (value: unknown) => boolean): boolean {
  const ids = new Set<string>()
  return values.every((value) => {
    if (!isRecord(value) || typeof value.id !== 'string' || !value.id || ids.has(value.id) || !validate(value)) return false
    ids.add(value.id)
    return true
  })
}

function isProcessResult(value: unknown): boolean {
  if (value === undefined) return true
  if (Array.isArray(value)) return value.every(item => isRecord(item) && ['id', 'status', 'command', 'cwd'].every(key => typeof item[key] === 'string'))
  return isRecord(value) && typeof value.id === 'string' && typeof value.status === 'string' &&
    optionalType(value.output, 'string') && optionalType(value.truncated, 'boolean') &&
    (value.exitCode === null || optionalType(value.exitCode, 'number')) &&
    (value.signal === null || optionalType(value.signal, 'string'))
}

function isTool(value: unknown): boolean {
  if (!isRecord(value) || typeof value.id !== 'string' || !value.id || typeof value.label !== 'string' ||
    !['file_edit', 'terminal', 'file_read', 'search', 'thinking', 'folder'].includes(String(value.type))) return false
  if (!['targetName', 'baseline', 'streamTarget', 'content', 'activity', 'toolName', 'analysisDetail'].every((key) => optionalType(value[key], 'string')) ||
    !isProcessResult(value.processResult) ||
    (value.filePaths !== undefined && (!Array.isArray(value.filePaths) || !value.filePaths.every((path) => typeof path === 'string'))) ||
    (value.patchFiles !== undefined && (!Array.isArray(value.patchFiles) || !value.patchFiles.every((file) => isRecord(file) && typeof file.path === 'string' && typeof file.action === 'string' && typeof file.diff === 'string'))) ||
    !optionalType(value.defaultExpanded, 'boolean') ||
    (value.status !== undefined && !['running', 'completed', 'error'].includes(String(value.status)))) return false
  return value.diff === undefined || (isRecord(value.diff) && optionalType(value.diff.added, 'number') && optionalType(value.diff.removed, 'number'))
}

function isBlock(value: unknown): boolean {
  if (!isRecord(value)) return false
  if (!optionalType(value.roundId, 'string') || !optionalType(value.isActivity, 'boolean')) return false
  if (value.type === 'tool') return isTool(value.tool)
  return (value.type === 'text' || value.type === 'thinking') && typeof value.content === 'string' &&
    optionalType(value.isStreaming, 'boolean') && optionalType(value.durationSec, 'number') && optionalType(value.startedAt, 'number')
}

function isHistoryMessage(value: unknown): boolean {
  if (!isRecord(value) || !['system', 'developer', 'user', 'assistant', 'tool'].includes(String(value.role))) return false
  const contentValid = value.content === null || typeof value.content === 'string' ||
    (Array.isArray(value.content) && value.content.every((part: unknown) => isRecord(part) && typeof part.type === 'string' &&
      optionalType(part.text, 'string') && (part.image_url === undefined || (isRecord(part.image_url) && typeof part.image_url.url === 'string'))))
  return contentValid && ['reasoning_content', 'tool_call_id', 'name'].every((key) => optionalType(value[key], 'string')) &&
    (value.tool_calls === undefined || (Array.isArray(value.tool_calls) && value.tool_calls.every((call: unknown) =>
      isRecord(call) && typeof call.id === 'string' && typeof call.type === 'string' && isRecord(call.function) &&
      typeof call.function.name === 'string' && typeof call.function.arguments === 'string')))
}

function isMessage(value: unknown): boolean {
  if (!isRecord(value) || (value.role !== 'user' && value.role !== 'assistant') ||
    !optionalType(value.content, 'string') || !optionalType(value.isStreaming, 'boolean') ||
    !optionalType(value.activeFileToolId, 'string') || !optionalType(value.planMode, 'boolean') ||
    (value.extensionRefs !== undefined && !isExtensionRefs(value.extensionRefs))) return false
  return (value.contextStatus === undefined || (isRecord(value.contextStatus) && typeof value.contextStatus.estimatedTokens === 'number' && Number.isFinite(value.contextStatus.estimatedTokens) && value.contextStatus.estimatedTokens >= 0 && typeof value.contextStatus.limit === 'number' && Number.isFinite(value.contextStatus.limit) && value.contextStatus.limit > 0 && typeof value.contextStatus.compacted === 'boolean')) &&
    (value.blocks === undefined || (Array.isArray(value.blocks) && hasUniqueIds(value.blocks, isBlock))) &&
    (value.tools === undefined || (Array.isArray(value.tools) && hasUniqueIds(value.tools, isTool))) &&
    (value.agentHistory === undefined || (Array.isArray(value.agentHistory) && value.agentHistory.every(isHistoryMessage))) &&
    (value.attachments === undefined || (Array.isArray(value.attachments) && value.attachments.every((item: unknown) => isRecord(item) && typeof item.name === 'string' && typeof item.path === 'string' && /^\.zipply\/uploads\/[a-f0-9-]{36}\.(png|jpg|webp|gif|txt|md|log|csv|tsv|json|pdf|docx|xlsx)$/.test(item.path))))
}

export function isValidChatSessions(parsed: unknown): boolean {
  const ids = new Set<string>()
  return Array.isArray(parsed) && parsed.length > 0 && parsed.every((session: unknown) => {
    if (!isRecord(session) || typeof session.id !== 'string' || !/^[a-zA-Z0-9_-]+$/.test(session.id) || ids.has(session.id) ||
      typeof session.title !== 'string' || typeof session.createdAt !== 'number' || !Number.isFinite(session.createdAt) ||
      typeof session.updatedAt !== 'number' || !Number.isFinite(session.updatedAt) || !optionalType(session.folderPath, 'string') ||
      !optionalType(session.uncensoredMode, 'boolean') ||
      !Array.isArray(session.messages) || !hasUniqueIds(session.messages, isMessage)) return false
    ids.add(session.id)
    return true
  })
}
