import { Message, MessageBlock, ToolCall } from '../types/chat'
import type { AgentEvent } from '../../../shared/agentEvents'
import { inferToolActivity } from '../../../shared/activity'
import { resolveToolPresentation } from '../../../shared/toolPresentation'
import { extractToolArgsFromRecord, parsePartialToolArgs } from './partialToolArgs'

// Keep incomplete arguments out of persisted chat history while accumulating
// only the deltas sent by the main process.
interface StreamedToolArgumentState {
  raw: string
  lastParsedLength: number
}

const streamedToolArguments = new WeakMap<ToolCall, StreamedToolArgumentState>()

function isFileEditTool(name: string): boolean {
  return name === 'write_file' || name === 'edit_file'
}

export function finalizeStreamingBlocks(blocks: MessageBlock[], now = Date.now()): void {
  // Streaming blocks are appended at the tail, and opening a later block
  // finalizes its predecessor. This keeps completion constant-time even when
  // a long answer has accumulated many historical blocks.
  const index = blocks.length - 1
  const block = blocks[index]
  if (block?.type === 'thinking' && block.isStreaming) {
    const duration = block.startedAt
      ? Math.max(1, Math.round((now - block.startedAt) / 1000))
      : block.durationSec
    blocks[index] = { ...block, isStreaming: false, durationSec: duration }
  } else if (block?.type === 'text' && block.isStreaming) {
    blocks[index] = { ...block, isStreaming: false }
  }
}

function finalizeBlocks(blocks: MessageBlock[]): MessageBlock[] {
  const now = Date.now()
  return blocks.map(block => {
    if (block.type === 'thinking' && block.isStreaming) {
      const duration = block.startedAt ? Math.max(1, Math.round((now - block.startedAt) / 1000)) : block.durationSec
      return { ...block, isStreaming: false, durationSec: duration }
    }
    if (block.type === 'text' && block.isStreaming) return { ...block, isStreaming: false }
    return block
  })
}

function nextAssistantMessageId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
}

export function applyEventToBlocks(
  event: AgentEvent,
  blocks: MessageBlock[],
  lastMsg: Message
): void {
  switch (event.type) {
    case 'context_status': {
      lastMsg.contextStatus = { estimatedTokens: event.estimatedTokens, limit: event.limit, compacted: event.compacted || Boolean(lastMsg.contextStatus?.compacted) }
      break
    }
    case 'history': {
      lastMsg.agentHistory = event.messages
      break
    }
    case 'run_summary': {
      lastMsg.runSummary = event.summary
      break
    }
    case 'plan_update': {
      lastMsg.plan = event.plan
      break
    }
    case 'reasoning': {
      const lastBlock = blocks[blocks.length - 1]
      if (!(lastBlock?.type === 'thinking' && lastBlock.roundId === event.roundId)) {
        finalizeStreamingBlocks(blocks)
      }
      if (lastBlock && lastBlock.type === 'thinking' && lastBlock.roundId === event.roundId) {
        blocks[blocks.length - 1] = {
          ...lastBlock,
          content: lastBlock.content + event.content,
          isStreaming: true
        }
      } else {
        blocks.push({
          type: 'thinking',
          roundId: event.roundId,
          id: `thinking-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          content: event.content,
          startedAt: Date.now(),
          isStreaming: true
        })
      }
      break
    }
    case 'token': {
      const lastBlock = blocks[blocks.length - 1]
      if (!(lastBlock?.type === 'text' && lastBlock.roundId === event.roundId)) {
        finalizeStreamingBlocks(blocks)
      }
      if (lastBlock && lastBlock.type === 'text' && lastBlock.roundId === event.roundId) {
        blocks[blocks.length - 1] = {
          ...lastBlock,
          content: lastBlock.content + event.content,
          isStreaming: true
        }
      } else {
        blocks.push({
          type: 'text',
          roundId: event.roundId,
          id: `text-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          content: event.content,
          isStreaming: true
        })
      }
      break
    }

    case 'round_end': {
      if (event.hasToolCalls) {
        for (let index = 0; index < blocks.length; index++) {
          const block = blocks[index]
          if (block.type === 'text' && block.roundId === event.roundId) blocks[index] = { ...block, isActivity: true }
        }
      }
      break
    }

    case 'tool_call_stream': {
      finalizeStreamingBlocks(blocks)

      const toolIdx = blocks.findIndex((b) => b.type === 'tool' && b.id === event.callId)
      const previousBlock = blocks[toolIdx]
      const previousArgs = previousBlock?.type === 'tool' ? streamedToolArguments.get(previousBlock.tool) : undefined
      const rawArgs = event.argsBuffer ?? ((previousArgs?.raw || '') + (event.argsDelta || ''))
      const parsedArgs = parsePartialToolArgs(rawArgs)
      const { path, content, command, target: streamTarget, query, files, filePaths } = parsedArgs
      const toolName = event.toolName || ''
      let activity = inferToolActivity(toolName)
      let completeArgs: Record<string, unknown> | undefined
      try {
        completeArgs = JSON.parse(rawArgs)
        activity = inferToolActivity(toolName, completeArgs)
      } catch { /* Use the tool-specific fallback until arguments are complete. */ }
      if (isFileEditTool(toolName)) lastMsg.activeFileToolId = event.callId

      const presentation = resolveToolPresentation({
        toolName,
        args: completeArgs,
        parsedPath: path,
        parsedCommand: command,
        parsedQuery: query,
        parsedFiles: files,
        isStreaming: true
      })

      if (toolIdx === -1) {
        blocks.push({
          type: 'tool',
          id: event.callId,
          roundId: event.roundId,
          tool: {
            id: event.callId,
            toolName,
            activity,
            type: presentation.type,
            label: presentation.label,
            targetName: presentation.targetName,
            filePaths: toolName === 'read_files' ? filePaths : undefined,
            content: content || '',
            streamTarget,
            status: 'running',
            defaultExpanded: true
          }
        })
      } else if (blocks[toolIdx].type === 'tool') {
        const current = blocks[toolIdx] as { type: 'tool'; id: string; tool: ToolCall }
        const prevTarget = current.tool.targetName && current.tool.targetName !== 'файл...' ? current.tool.targetName : ''
        blocks[toolIdx] = {
          ...current,
          tool: {
            ...current.tool,
            toolName,
            activity: activity ?? current.tool.activity,
            type: presentation.type,
            label: presentation.label,
            targetName: presentation.targetName || prevTarget,
            filePaths: toolName === 'read_files' ? filePaths ?? current.tool.filePaths : current.tool.filePaths,
            content: content !== undefined ? content : current.tool.content,
            streamTarget: streamTarget ?? current.tool.streamTarget,
            status: 'running'
          }
        }
      }
      const updatedBlock = blocks[toolIdx === -1 ? blocks.length - 1 : toolIdx]
      if (updatedBlock?.type === 'tool') streamedToolArguments.set(updatedBlock.tool, {
        raw: rawArgs,
        lastParsedLength: rawArgs.length
      })
      break
    }

    case 'tool_baseline': {
      const idx = blocks.findIndex((b) => b.type === 'tool' && b.id === event.callId)
      const block = blocks[idx]
      if (block?.type === 'tool' && block.tool.status === 'running') {
        blocks[idx] = { ...block, tool: { ...block.tool, baseline: event.content } }
        const updated = blocks[idx]
        const argsState = streamedToolArguments.get(block.tool)
        if (updated.type === 'tool' && argsState !== undefined) streamedToolArguments.set(updated.tool, argsState)
      }
      break
    }

    case 'tool_start': {
      finalizeStreamingBlocks(blocks)

      const parsedArgs = extractToolArgsFromRecord(event.args)
      const presentation = resolveToolPresentation({
        toolName: event.toolName,
        args: event.args,
        parsedFiles: parsedArgs.files
      })
      const label = event.displayLabel || presentation.label
      const targetName = event.displayTarget || presentation.targetName
      const activity = inferToolActivity(event.toolName, event.args)
      const existingIdx = blocks.findIndex((b) => b.type === 'tool' && b.id === event.callId)
      if (existingIdx !== -1 && blocks[existingIdx].type === 'tool') {
        const curr = blocks[existingIdx] as Extract<MessageBlock, { type: 'tool' }>
        const prevTarget = curr.tool.targetName && curr.tool.targetName !== 'файл...' ? curr.tool.targetName : ''
        blocks[existingIdx] = {
          ...curr,
          roundId: event.roundId ?? curr.roundId,
          tool: {
            ...curr.tool,
            toolName: event.toolName,
            analysisDetail: presentation.analysisDetail ?? curr.tool.analysisDetail,
            activity: activity ?? curr.tool.activity,
            type: presentation.type,
            label,
            targetName: targetName || prevTarget,
            filePaths: event.toolName === 'read_files' ? parsedArgs.filePaths : curr.tool.filePaths,
            content: isFileEditTool(event.toolName) ? parsedArgs.content ?? curr.tool.content : curr.tool.content,
            streamTarget: parsedArgs.target ?? curr.tool.streamTarget,
            status: 'running'
          }
        }
      } else {
        blocks.push({
          type: 'tool',
          id: event.callId,
          roundId: event.roundId,
          tool: {
            id: event.callId,
            toolName: event.toolName,
            analysisDetail: presentation.analysisDetail,
            activity,
            type: presentation.type,
            label,
            targetName,
            filePaths: event.toolName === 'read_files' ? parsedArgs.filePaths : undefined,
            content: isFileEditTool(event.toolName) ? parsedArgs.content : undefined,
            streamTarget: parsedArgs.target,
            status: 'running',
            defaultExpanded: true
          }
        })
      }
      break
    }

    case 'tool_progress': {
      const toolIdx = blocks.findIndex((b) => b.type === 'tool' && b.id === event.callId)
      if (toolIdx !== -1 && blocks[toolIdx].type === 'tool') {
        const current = blocks[toolIdx] as { type: 'tool'; id: string; tool: ToolCall }
        const progressOutput = (event as any).output || (event as any).message
        const terminalId = (event.data as { terminalSessionId?: unknown } | undefined)?.terminalSessionId
        blocks[toolIdx] = {
          ...current,
          tool: {
            ...current.tool,
            status: 'running',
            executionStarted: event.executionStarted || current.tool.executionStarted,
            ...(typeof terminalId === 'string' ? { toolData: event.data } : {}),
            content: progressOutput !== undefined ? String(progressOutput) : current.tool.content
          }
        }
      }
      break
    }

    case 'tool_result': {
      const toolIdx = blocks.findIndex((b) => b.type === 'tool' && b.id === event.callId)
      if (toolIdx !== -1 && blocks[toolIdx].type === 'tool') {
        const current = blocks[toolIdx] as { type: 'tool'; id: string; tool: ToolCall }
        const diffData = (event.data as any)?.diff
        const resultPath = (event.data as any)?.path
        const processData = current.tool.toolName?.startsWith('process_') && !event.error ? event.data as { id?: string; output?: string } | undefined : undefined
        const previousProcess = processData?.id ? [...blocks].reverse().find(block => block.type === 'tool' && !Array.isArray(block.tool.processResult) && block.tool.processResult?.id === processData.id) : undefined
        const previousOutputAt = previousProcess?.type === 'tool' ? previousProcess.tool.processLastOutputAt : undefined
        const prevTarget = current.tool.targetName && current.tool.targetName !== 'файл...' ? current.tool.targetName : ''
        blocks[toolIdx] = {
          ...current,
          tool: {
            ...current.tool,
            targetName: resultPath || prevTarget || current.tool.targetName,
            status: event.error ? 'error' : 'completed',
            content: event.result,
            toolData: event.data,
            processResult: current.tool.toolName?.startsWith('process_') && !event.error ? (event.data as ToolCall['processResult']) : undefined,
            processLastOutputAt: processData?.id ? (processData.output ? Date.now() : previousOutputAt ?? Date.now()) : undefined,
            patchFiles: Array.isArray((event.data as any)?.files) && (event.data as any).files.every((file: any) => typeof file?.path === 'string' && typeof file?.action === 'string' && typeof file?.diff === 'string') ? (event.data as any).files : current.tool.patchFiles,
            diff: diffData || current.tool.diff
          }
        }
      }
      break
    }

    case 'done': {
      lastMsg.isStreaming = false
      finalizeStreamingBlocks(blocks)
      break
    }

    case 'error': {
      lastMsg.isStreaming = false
      finalizeStreamingBlocks(blocks)
      for (let i = 0; i < blocks.length; i++) {
        const b = blocks[i]
        if (b.type === 'tool' && b.tool.status === 'running') {
          blocks[i] = { ...b, tool: { ...b.tool, status: 'error' } }
        }
      }
      blocks.push({
        type: 'text',
        id: `err-${Date.now()}`,
        content: `⚠️ ${event.message}`,
        isStreaming: false
      })
      break
    }
  }
}

export function applyEventsToMessages(messages: Message[], events: AgentEvent[], targetAssistantMessageId?: string): Message[] {
  if (!messages.length) return messages
  const updated = [...messages]
  const findActiveMessageId = (): string | undefined => {
    if (targetAssistantMessageId && updated.some(message => message.id === targetAssistantMessageId && message.role === 'assistant')) return targetAssistantMessageId
    for (let index = updated.length - 1; index >= 0; index--) {
      if (updated[index].role === 'assistant' && updated[index].isStreaming) return updated[index].id
    }
    for (let index = updated.length - 1; index >= 0; index--) {
      if (updated[index].role === 'assistant') return updated[index].id
    }
    return undefined
  }
  let activeMessageId = findActiveMessageId()

  for (const event of events) {
    const index = activeMessageId ? updated.findIndex(message => message.id === activeMessageId) : -1
    if (index < 0 || updated[index].role !== 'assistant') continue
    const current = updated[index]

    if (event.type === 'assistant_commentary') {
      const content = event.content.trim()
      if (!content) continue
      const currentBlocks = current.blocks || []
      const movedTools = currentBlocks.filter(block => block.type === 'tool' && block.roundId === event.roundId)
      const previousBlocks = currentBlocks.filter(block => {
        if (block.roundId !== event.roundId) return true
        return block.type !== 'text' && block.type !== 'thinking' && block.type !== 'tool'
      })
      const hasPreviousActivity = previousBlocks.length > 0 || Boolean(current.tools?.length)
      const placeholderId = nextAssistantMessageId('assistant')

      if (hasPreviousActivity) {
        updated[index] = { ...current, isStreaming: false, blocks: finalizeBlocks(previousBlocks) }
        const progress = {
          id: nextAssistantMessageId('progress'), role: 'assistant' as const, content,
          blocks: [], isProgressUpdate: true, isStreaming: false
        }
        const placeholder: Message = { id: placeholderId, role: 'assistant', blocks: movedTools, isStreaming: true }
        updated.splice(index + 1, 0, progress, placeholder)
      } else {
        updated[index] = { ...current, content, blocks: [], isProgressUpdate: true, isStreaming: false }
        const placeholder: Message = { id: placeholderId, role: 'assistant', blocks: movedTools, isStreaming: true }
        updated.splice(index + 1, 0, placeholder)
      }
      activeMessageId = placeholderId
      continue
    }

    const updatedMessage = { ...current }
    const blocks = [...(updatedMessage.blocks || [])]
    applyEventToBlocks(event, blocks, updatedMessage)
    updatedMessage.blocks = blocks
    updated[index] = updatedMessage
  }

  return updated
}
