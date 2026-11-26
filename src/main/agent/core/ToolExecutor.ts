import { createHash } from 'crypto'
import * as fs from 'fs/promises'
import * as path from 'path'
import { AgentBase } from './AgentBase'
import { Blackboard } from './Blackboard'
import { ContextCompactor, type OpenAiMessage } from './ContextCompactor'
import { AttachmentResolver } from './AttachmentResolver'
import { OutputTruncator } from './OutputTruncator'
import { ToolExecutionPolicy, ToolResult, ToolBase, ToolParameterDef, ToolApprovalRequest } from '../tools/ToolBase'
import type { OpenAiToolDefinition } from '../services/ChatService'
import type { AgentEvent } from '../../../shared/agentEvents'
import { requiresConfirmation, classifyCommand } from './CommandPolicy'
import { resolveWorkspacePath, inspectWorkspacePath } from '../tools/pathUtils'
import { executionArgumentKey } from './toolArguments'
import { extractToolTargetPaths } from './ToolPathExtractor'
import { resolveSandboxPolicy, type SandboxPolicy } from '../../../shared/sandbox'
import type { JournalToolStart, JournalToolResult } from './RunJournal'

interface ToolExecutionHooks {
  shouldYield: () => boolean
  onBeforeExecution?: (callId: string, toolName: string, args: Record<string, unknown>) => Promise<void>
  onMutationStart?: (call: JournalToolStart) => Promise<string | undefined>
  onMutationResult?: (result: JournalToolResult) => Promise<void>
}

export interface FileVersionStamp {
  path: string
  mtimeMs: number
  size: number
  sha256?: string
}

async function captureFileVersions(paths: readonly string[]): Promise<FileVersionStamp[]> {
  const unique = Array.from(new Set(paths.filter(Boolean)))
  const stamps: FileVersionStamp[] = []
  for (const absPath of unique) {
    try {
      const stat = await fs.stat(absPath)
      let sha256: string | undefined
      if (stat.isFile() && stat.size <= 2_000_000) {
        const bytes = await fs.readFile(absPath)
        sha256 = createHash('sha256').update(bytes).digest('hex')
      }
      stamps.push({ path: absPath, mtimeMs: stat.mtimeMs, size: stat.size, ...(sha256 ? { sha256 } : {}) })
    } catch {
      stamps.push({ path: absPath, mtimeMs: -1, size: -1 })
    }
  }
  return stamps
}

async function areFileVersionsFresh(stamps?: readonly FileVersionStamp[]): Promise<boolean> {
  if (!stamps || stamps.length === 0) return true
  for (const stamp of stamps) {
    try {
      const stat = await fs.stat(stamp.path)
      if (stat.mtimeMs !== stamp.mtimeMs || stat.size !== stamp.size) return false
      if (stamp.sha256) {
        const bytes = await fs.readFile(stamp.path)
        const liveSha = createHash('sha256').update(bytes).digest('hex')
        if (liveSha !== stamp.sha256) return false
      }
    } catch {
      if (stamp.mtimeMs !== -1 || stamp.size !== -1) return false
    }
  }
  return true
}

function createScopedBlackboard(board: Blackboard, configOverride: Record<string, unknown>): Blackboard {
  const scoped = Object.create(board) as Blackboard
  scoped.getArtifact = <T = unknown>(key: string): T | undefined => {
    if (key === 'config') return configOverride as T
    return board.getArtifact<T>(key)
  }
  scoped.setArtifact = (key: string, value: unknown, notify?: boolean): void => {
    board.setArtifact(key, value, notify)
  }
  return scoped
}

export interface AgentToolCall {
  id: string
  name: string
  argumentsJson: string
}

export interface CachedToolResult {
  resultStr: string
  isError: boolean
  data?: unknown
  images?: string[]
  fileVersions?: FileVersionStamp[]
}

const DEFAULT_POLICY: ToolExecutionPolicy = {
  mutates: false,
  parallelSafe: true,
  cacheable: true
}

function isWithinDirectory(root: string, target: string): boolean {
  const relative = path.relative(root, target)
  return relative === '' || (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative))
}

function isAllowedExternalRead(blackboard: Blackboard, actualPath: string, mutates: boolean, toolName: string): boolean {
  if (mutates || (toolName !== 'read_file' && toolName !== 'read_files')) return false
  const allowedPaths = blackboard.getArtifact('allowedExternalReadPaths') as Set<string> | undefined
  if (allowedPaths?.has(actualPath)) return true
  const allowedRoots = blackboard.getArtifact('allowedExternalReadRoots') as Set<string> | undefined
  if (!allowedRoots?.size) return false
  for (const root of allowedRoots) {
    if (isWithinDirectory(root, actualPath)) return true
  }
  return false
}

function modelToolContent(content: string, error: boolean, data?: unknown): string {
  const fields = data as { errorCode?: unknown; exitCode?: unknown; status?: unknown; partial?: unknown; truncated?: unknown } | undefined
  const metadata: Record<string, boolean | number | string> = {}
  if (error) {
    metadata.error = true
    if (typeof fields?.errorCode === 'string' && /^[a-z0-9_-]{1,64}$/i.test(fields.errorCode)) metadata.errorCode = fields.errorCode
    if (typeof fields?.exitCode === 'number' && Number.isInteger(fields.exitCode)) metadata.exitCode = fields.exitCode
    if (typeof fields?.status === 'string' && /^[a-z0-9_-]{1,32}$/i.test(fields.status)) metadata.status = fields.status
  }
  if (fields?.partial === true) metadata.partial = true
  if (fields?.truncated === true) metadata.truncated = true
  return Object.keys(metadata).length ? `${content}\n\n[tool_result ${JSON.stringify(metadata)}]` : content
}

export class ToolExecutor {
  static safeEmit(onEvent: (evt: AgentEvent) => void, evt: AgentEvent): void {
    try {
      onEvent(evt)
    } catch {
      // UI listeners must never crash agent loop
    }
  }

  static getPolicy(agent: AgentBase, toolName: string, args: Record<string, unknown>): ToolExecutionPolicy {
    const handler = agent.getHandler(toolName)
    if (!handler) return DEFAULT_POLICY
    return handler.getExecutionPolicy(args)
  }

  static buildToolDefs(agent: AgentBase, extraTools: ToolBase[] = [], readOnly = false): OpenAiToolDefinition[] {
    const allTools = [...agent.getTools(), ...extraTools].filter((tool) => !readOnly || !tool.getExecutionPolicy().mutates)
    const serializeSchemaProperties = (props: Record<string, ToolParameterDef> | undefined): Record<string, unknown> => {
      const result: Record<string, unknown> = {}
      if (!props) return result
      // Preserve tool-declared property order (e.g. path before content) while keeping
      // output deterministic across turns for KV-cache stability.
      for (const key of Object.keys(props)) {
        const param = props[key]
        const propDef: Record<string, unknown> = {
          type: param.type,
          description: param.description
        }
        if (param.enum) propDef.enum = param.enum
        for (const boundKey of ['minimum', 'maximum', 'minLength', 'maxLength', 'minItems', 'maxItems'] as const) {
          const value = param[boundKey]
          if (typeof value === 'number') propDef[boundKey] = value
        }
        if (param.items) propDef.items = param.items
        if (param.properties) propDef.properties = serializeSchemaProperties(param.properties)
        if (param.default !== undefined) propDef.default = param.default
        result[key] = propDef
      }
      return result
    }

    return allTools.map((tool) => {
      const paramEntries = Object.entries(tool.parameters || {}) as Array<[string, ToolParameterDef]>
      const properties = serializeSchemaProperties(tool.parameters)
      const required = paramEntries
        .filter(([, param]) => Boolean(param.required))
        .map(([key]) => key)
        .sort()

      return {
        type: 'function' as const,
        function: {
          name: tool.name,
          description: tool.description,
          parameters: (tool.getInputSchema?.() ?? {
            type: 'object' as const,
            properties,
            required: required.length > 0 ? required : undefined
          }) as OpenAiToolDefinition['function']['parameters']
        }
      }
    })
  }

  static async executeCalls(
    agent: AgentBase,
    toolCalls: AgentToolCall[],
    messages: OpenAiMessage[],
    blackboard: Blackboard,
    onEvent: (evt: AgentEvent) => void,
    abortSignal?: AbortSignal,
    resultCache: Map<string, CachedToolResult> = new Map(),
    hooks?: ToolExecutionHooks
  ): Promise<boolean> {
    // Approval dialogs and mutations are barriers. Results are appended in
    // provider order even when independent reads finish out of order.
    const start = messages.length
    const stop = (): boolean => {
      const superseded = !abortSignal?.aborted && hooks?.shouldYield()
      const completed = messages.slice(start)
      const byId = new Map(completed.map(message => [message.tool_call_id, message]))
      const ordered: OpenAiMessage[] = []
      for (const call of toolCalls) {
        let message = byId.get(call.id)
        if (!message) {
          const result = superseded
            ? 'Вызов заменён поправкой пользователя до исполнения.'
            : 'Вызов отменён до исполнения.'
          message = { role: 'tool', tool_call_id: call.id, name: call.name, content: result }
          this.safeEmit(onEvent, { type: 'tool_result', callId: call.id, result, error: true, ...(superseded ? { data: { supersededBySteer: true } } : {}) })
        }
        ordered.push(message)
      }
      messages.splice(start, messages.length - start, ...ordered)
      return false
    }
    const images: string[] = []
    let index = 0
    while (index < toolCalls.length) {
      if (abortSignal?.aborted || hooks?.shouldYield()) return stop()
      const group: AgentToolCall[] = []
      while (index < toolCalls.length && group.length < 4) {
        const call = toolCalls[index]
        const tool = agent.getHandler(call.name)
        let args: Record<string, unknown>
        try {
          if (!call.argumentsJson || !call.argumentsJson.trim()) break
          const parsed: unknown = JSON.parse(call.argumentsJson)
          if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) break
          args = parsed as Record<string, unknown>
        } catch { break }
        if (!tool) break
        const policy = tool.getExecutionPolicy(args)
        if (policy.mutates || !policy.parallelSafe) break
        // External reads/commands or dangerous checks may open confirmation dialogs, which must be serial.
        const isCmd = ['exec_command', 'terminal', 'run_command', 'process_start'].includes(tool.name)
        const paths = call.name === 'read_files' && Array.isArray(args.files)
          ? (args.files as Array<{ path?: unknown }>).map(f => f?.path)
          : ['read_file', 'list_dir', 'search_project', 'find_files', 'code_intelligence'].includes(tool.name)
            ? [args.path || '.']
            : isCmd
              ? [args.cwd || args.workdir || '.']
              : []
        let external = false
        for (const target of paths) {
          if (typeof target !== 'string') { external = true; break }
          try {
            const inspected = await inspectWorkspacePath(blackboard, target)
            if (inspected.external && !isAllowedExternalRead(blackboard, inspected.actualPath, policy.mutates, call.name)) {
              external = true; break
            }
          }
          catch { external = true; break }
        }
        if (!external && isCmd) {
          const rawCmd = args.command || args.cmd || ''
          const cmdText = Array.isArray(rawCmd) ? rawCmd.join(' ') : String(rawCmd)
          const wsRoot = resolveWorkspacePath(blackboard, '.').absPath
          const assessment = classifyCommand(cmdText, wsRoot)
          if (assessment.requiresConfirmation || (assessment.externalPaths && assessment.externalPaths.length > 0)) {
            external = true
          }
        }
        if (external) break
        group.push(call); index++
      }
      if (abortSignal?.aborted || hooks?.shouldYield()) return stop()
      if (!group.length) {
        if (!await this.executeSequential(agent, [toolCalls[index++]], messages, blackboard, onEvent, abortSignal, resultCache, images, hooks)) return stop()
        continue
      }
      const results = await Promise.all(group.map(async call => {
        const localMessages: OpenAiMessage[] = []
        const localImages: string[] = []
        const completed = await this.executeSequential(agent, [call], localMessages, blackboard, onEvent, abortSignal, resultCache, localImages, hooks)
        return { completed, localMessages, localImages }
      }))
      for (const result of results) { messages.push(...result.localMessages); images.push(...result.localImages) }
      if (results.some(result => !result.completed)) return stop()
    }
    if (abortSignal?.aborted) return stop()
    if (images.length) {
      const content = images.flatMap((imagePath) => AttachmentResolver.isGeneratedImageRef(imagePath)
        ? [{ type: 'image_url', image_url: { url: imagePath } }]
        : [
            { type: 'text', text: `Изображение из результата инструмента: ${imagePath}` },
            { type: 'image_url', image_url: { url: `zipply-workspace:${encodeURIComponent(imagePath)}` } }
          ])
      messages.push({ role: 'user', name: ContextCompactor.TOOL_ATTACHMENTS_NAME, content })
    }
    return true
  }

  private static async executeSequential(
    agent: AgentBase,
    toolCalls: AgentToolCall[],
    messages: OpenAiMessage[],
    blackboard: Blackboard,
    onEvent: (evt: AgentEvent) => void,
    abortSignal?: AbortSignal,
    resultCache: Map<string, CachedToolResult> = new Map(),
    images: string[] = [],
    hooks?: ToolExecutionHooks
  ): Promise<boolean> {
    for (const call of toolCalls) {
      if (abortSignal?.aborted || hooks?.shouldYield()) return false

      const tool = agent.getHandler(call.name)
      let parsedArgs: Record<string, unknown> = {}
      let invalidArgs = false
      try {
        if (!call.argumentsJson || !call.argumentsJson.trim()) {
          invalidArgs = true
        } else {
          const parsed: unknown = JSON.parse(call.argumentsJson)
          if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) invalidArgs = true
          else parsedArgs = parsed as Record<string, unknown>
        }
      } catch {
        invalidArgs = true
      }

      const displayInfo = tool?.getDisplayInfo?.(parsedArgs)
      this.safeEmit(onEvent, {
        type: 'tool_start',
        callId: call.id,
        toolName: call.name,
        args: parsedArgs,
        ...(displayInfo ? { displayLabel: displayInfo.label, displayTarget: displayInfo.targetName } : {})
      })

      if (invalidArgs) {
        const result = 'Ошибка: аргументы инструмента должны быть JSON-объектом.'
        messages.push({ role: 'tool', tool_call_id: call.id, name: call.name, content: result })
        this.safeEmit(onEvent, { type: 'tool_result', callId: call.id, result, error: true })
        continue
      }

      const accessConfig = blackboard.getArtifact('config') as { accessMode?: string } | undefined
      if (tool && (blackboard.getArtifact('planMode') || accessConfig?.accessMode === 'read-only') && tool.getExecutionPolicy(parsedArgs).mutates) {
        const result = blackboard.getArtifact('planMode')
          ? 'Ошибка: инструмент недоступен в режиме планирования.'
          : 'Ошибка: инструмент недоступен в режиме только для чтения.'
        messages.push({ role: 'tool', tool_call_id: call.id, name: call.name, content: result })
        this.safeEmit(onEvent, { type: 'tool_result', callId: call.id, result, error: true })
        continue
      }

      if (!tool) {
        const errResult = `Ошибка: инструмент '${call.name}' не найден.`
        messages.push({
          role: 'tool',
          tool_call_id: call.id,
          name: call.name,
          content: errResult
        })
        this.safeEmit(onEvent, {
          type: 'tool_result',
          callId: call.id,
          result: errResult,
          error: true
        })
        continue
      }

      const executionArguments = executionArgumentKey(call.argumentsJson)
      const valErr = tool.validate(executionArguments)
      if (valErr) {
        messages.push({
          role: 'tool',
          tool_call_id: call.id,
          name: tool.name,
          content: valErr
        })
        this.safeEmit(onEvent, {
          type: 'tool_result',
          callId: call.id,
          result: valErr,
          error: true
        })
        continue
      }

      const policy = this.getPolicy(agent, call.name, parsedArgs)
      const rawCommand = parsedArgs.command || parsedArgs.cmd || ''
      const commandText = Array.isArray(rawCommand) ? rawCommand.join(' ') : String(rawCommand)
      const isCommand = tool.name === 'exec_command' || tool.name === 'terminal' || tool.name === 'run_command' || tool.name === 'process_start'
      const config = blackboard.getArtifact('config') as {
        accessMode?: string
        planMode?: boolean
        sandbox?: Partial<SandboxPolicy>
        workspacePath?: string
        confirmCommand?: (command: string) => Promise<boolean>
        confirmAction?: (action: ToolApprovalRequest) => Promise<boolean>
        onBeforeMutate?: (targets: string[]) => Promise<void>
      } | undefined
      const workspaceRoot = resolveWorkspacePath(blackboard, '.').absPath
      const sandboxPolicy = resolveSandboxPolicy(
        { accessMode: config?.accessMode, planMode: config?.planMode ?? Boolean(blackboard.getArtifact('planMode')), sandbox: config?.sandbox },
        workspaceRoot
      )
      const commandAssessment = isCommand ? classifyCommand(commandText, workspaceRoot) : undefined
      const isAllowedSpillRead = (actual: string): boolean => isAllowedExternalRead(blackboard, actual, policy.mutates, tool.name)
      const isBatchRead = tool.name === 'read_files'
      const isFileTool = ['read_file', 'read_files', 'write_file', 'edit_file', 'verify_file', 'list_dir', 'search_project', 'find_files'].includes(tool.name)
      let external = false
      let actualTarget = String(parsedArgs.path || parsedArgs.filePath || parsedArgs.file_path || parsedArgs.filepath || parsedArgs.filename || '.')
      let resolvedFiles: Array<Record<string, unknown>> | undefined
      const rawCwd = typeof parsedArgs.cwd === 'string' && parsedArgs.cwd.trim()
        ? parsedArgs.cwd
        : typeof parsedArgs.workdir === 'string' && parsedArgs.workdir.trim()
          ? parsedArgs.workdir
          : ''
      if (isCommand && rawCwd) {
        try {
          const inspectedCwd = await inspectWorkspacePath(blackboard, rawCwd)
          external = inspectedCwd.external
        } catch (err) {
          const result = `Ошибка проверки пути cwd: ${err instanceof Error ? err.message : String(err)}`
          messages.push({ role: 'tool', tool_call_id: call.id, name: tool.name, content: result })
          this.safeEmit(onEvent, { type: 'tool_result', callId: call.id, result, error: true }); continue
        }
      }
      if (isCommand && commandAssessment?.externalPaths?.length) {
        external = true
        actualTarget = commandAssessment.externalPaths[0]
      }
      if (isBatchRead && Array.isArray(parsedArgs.files)) {
        resolvedFiles = []
        let denied = false
        try {
          for (const value of parsedArgs.files) {
            const file = value as Record<string, unknown>
            const inspected = await inspectWorkspacePath(blackboard, String(file.path))
            if (inspected.external && !isAllowedSpillRead(inspected.actualPath)) {
              const action = { kind: 'file' as const, command: '', target: inspected.actualPath, cwd: workspaceRoot, details: 'Чтение файла в пакетном запросе' }
              if (!config?.confirmAction || !await config.confirmAction(action) || abortSignal?.aborted) { denied = true; break }
            }
            resolvedFiles.push({ ...file, path: inspected.actualPath })
          }
        } catch (err) {
          const result = `Ошибка проверки пути: ${err instanceof Error ? err.message : String(err)}`
          messages.push({ role: 'tool', tool_call_id: call.id, name: tool.name, content: result })
          this.safeEmit(onEvent, { type: 'tool_result', callId: call.id, result, error: true }); continue
        }
        if (denied) {
          const result = 'Доступ к файлу отклонён пользователем или подтверждение недоступно.'
          messages.push({ role: 'tool', tool_call_id: call.id, name: tool.name, content: result })
          this.safeEmit(onEvent, { type: 'tool_result', callId: call.id, result, error: true }); continue
        }
      } else if (isFileTool) {
        try {
          const inspected = await inspectWorkspacePath(blackboard, actualTarget)
          actualTarget = inspected.actualPath
          external = inspected.external && !isAllowedSpillRead(inspected.actualPath)
        }
        catch (err) {
          const result = `Ошибка проверки пути: ${err instanceof Error ? err.message : String(err)}`
          messages.push({ role: 'tool', tool_call_id: call.id, name: tool.name, content: result })
          this.safeEmit(onEvent, { type: 'tool_result', callId: call.id, result, error: true }); continue
        }
      }
      const networkRequired = Boolean(isCommand && sandboxPolicy.network === 'off' && commandAssessment?.requiresNetwork)
      let execBoard: Blackboard = blackboard
      let askedEscalation = false
      const explicitApproval = tool.getApprovalRequest?.(parsedArgs)
      const requiresExplicitApproval = Boolean(explicitApproval && (
        explicitApproval.approvalPolicy !== 'respect_access_mode' || config?.accessMode !== 'unrestricted'
      ))
      if (requiresExplicitApproval || external || (config?.accessMode === 'confirm' && policy.mutates && !policy.skipApproval && tool.name !== 'apply_patch') || (isCommand && config?.accessMode !== 'unrestricted' && ((commandAssessment?.requiresConfirmation ?? requiresConfirmation(commandText, workspaceRoot)) || networkRequired))) {
        const isLanguageServer = tool.name === 'code_intelligence' && policy.mutates
        const kind: 'command' | 'file' | 'network' = networkRequired && !external
          ? 'network'
          : isCommand || isLanguageServer
            ? 'command'
            : 'file'
        const details = isLanguageServer
          ? 'Языковой сервер может запускать программы и читать конфигурацию проекта.'
          : isCommand
            ? [commandAssessment?.reason, networkRequired ? commandAssessment?.networkReason : undefined].filter(Boolean).join(' ')
            : JSON.stringify(parsedArgs, null, 2)
        const action: ToolApprovalRequest = explicitApproval ?? { kind, command: isLanguageServer ? `Анализ кода: ${String(parsedArgs.path || '')}` : commandText, target: isFileTool ? actualTarget : isCommand && commandAssessment?.externalPaths?.length ? commandAssessment.externalPaths[0] : String(parsedArgs.path || tool.name), cwd: resolveWorkspacePath(blackboard, isCommand ? String(rawCwd || '.') : '.').absPath, details }
        const approved = config?.confirmAction ? await config.confirmAction(action) : isCommand && config?.confirmCommand ? await config.confirmCommand(commandText) : false
        askedEscalation = true
        if (!approved || abortSignal?.aborted) {
          const result = action.kind === 'mcp_connection'
            ? 'Подключение MCP отклонено или отменено. Не повторяй запрос без нового указания пользователя.'
            : 'Команда отклонена пользователем или подтверждение недоступно.'
          messages.push({ role: 'tool', tool_call_id: call.id, name: tool.name, content: result })
          this.safeEmit(onEvent, { type: 'tool_result', callId: call.id, result, error: true })
          continue
        }
        if (isCommand && (external || networkRequired)) {
          const escalatedSandbox: SandboxPolicy = {
            profile: external ? 'unrestricted' : sandboxPolicy.profile,
            network: networkRequired || external ? 'on' : sandboxPolicy.network,
            writableRoots: sandboxPolicy.writableRoots
          }
          execBoard = createScopedBlackboard(blackboard, { ...(config || {}), sandbox: escalatedSandbox })
        }
      }
      const cacheKey = policy.cacheable ? `${call.name}:${executionArgumentKey(call.argumentsJson)}` : null

      if (cacheKey && resultCache.has(cacheKey)) {
        const cached = resultCache.get(cacheKey)!
        if (await areFileVersionsFresh(cached.fileVersions)) {
          if (cached.images) images.push(...cached.images)
          messages.push({
            role: 'tool',
            tool_call_id: call.id,
            name: tool.name,
            content: modelToolContent(cached.resultStr, cached.isError, cached.data)
          })
          this.safeEmit(onEvent, {
            type: 'tool_result',
            callId: call.id,
            result: cached.resultStr,
            error: cached.isError,
            data: cached.data
          })
          continue
        }
        resultCache.delete(cacheKey)
      }

      // Execute the resolved target rather than following the originally
      // requested symlink again after the approval dialog.
      const { activity: _activity, ...toolArgs } = parsedArgs
      const executionArgs = resolvedFiles ? JSON.stringify({ ...toolArgs, files: resolvedFiles }) : isFileTool && external ? JSON.stringify({ ...toolArgs, path: actualTarget }) : executionArguments
      const targets = policy.mutates && (hooks?.onMutationStart || config?.onBeforeMutate)
        ? extractToolTargetPaths(tool.name, executionArgs).filter(target => target.isFile)
            .map(target => resolveWorkspacePath(execBoard, target.path).absPath)
        : []
      if (abortSignal?.aborted || hooks?.shouldYield()) return false
      if (targets.length && config?.onBeforeMutate) await config.onBeforeMutate(targets).catch(() => {})
      if (hooks?.onBeforeExecution) await hooks.onBeforeExecution(call.id, tool.name, toolArgs)
      if (abortSignal?.aborted || hooks?.shouldYield()) return false
      const startMutation = policy.mutates ? hooks?.onMutationStart : undefined
      if (startMutation) {
        const reconciledResult = await startMutation({ callId: call.id, toolName: tool.name, argsJson: executionArgs, targetPaths: targets })
        if (abortSignal?.aborted || hooks?.shouldYield()) {
          if (reconciledResult === undefined) await hooks?.onMutationResult?.({ callId: call.id, error: true, result: '', notStarted: true })
          return false
        }
        if (reconciledResult !== undefined) {
          messages.push({ role: 'tool', tool_call_id: call.id, name: tool.name, content: reconciledResult })
          this.safeEmit(onEvent, { type: 'tool_result', callId: call.id, result: reconciledResult, data: { changed: false } })
          continue
        }
      }

      let toolRes: ToolResult
      try {
        if (['exec_command', 'write_stdin', 'terminal', 'run_command', 'execute_command', 'bash', 'sh', 'process_poll'].includes(tool.name)) {
          this.safeEmit(onEvent, { type: 'tool_progress', callId: call.id, executionStarted: true })
        }
        toolRes = await tool.execute(
          executionArgs,
          execBoard,
          abortSignal,
          (progress) => {
            this.safeEmit(onEvent, {
              type: 'tool_progress',
              callId: call.id,
              ...progress
            })
          }
        )
        if (
          isCommand &&
          toolRes.error &&
          !askedEscalation &&
          sandboxPolicy.profile !== 'unrestricted' &&
          config?.accessMode !== 'read-only' &&
          !blackboard.getArtifact('planMode') &&
          config?.confirmAction &&
          /\b(?:EPERM|EROFS|EACCES)\b|permission denied|operation not permitted|отказано в доступе|read-only|readonly/i.test(toolRes.formattedContent)
        ) {
          const retryApproved = await config.confirmAction({
            kind: 'command',
            command: commandText,
            target: commandAssessment?.externalPaths?.[0] || workspaceRoot,
            cwd: resolveWorkspacePath(blackboard, String(rawCwd || '.')).absPath,
            details: 'Команда ограничена OS sandbox. Разрешить однократный запуск без изоляции?'
          })
          if (retryApproved && !abortSignal?.aborted && !hooks?.shouldYield()) {
            const escalatedBoard = createScopedBlackboard(blackboard, {
              ...(config || {}),
              sandbox: { profile: 'unrestricted', network: 'on', writableRoots: [workspaceRoot] }
            })
            if (hooks?.onBeforeExecution) await hooks.onBeforeExecution(call.id, tool.name, toolArgs)
            if (!abortSignal?.aborted && !hooks?.shouldYield()) {
              toolRes = await tool.execute(
                executionArgs,
                escalatedBoard,
                abortSignal,
                (progress) => {
                  this.safeEmit(onEvent, {
                    type: 'tool_progress',
                    callId: call.id,
                    ...progress
                  })
                }
              )
            }
          }
        }
      } catch (err: unknown) {
        const error = err instanceof Error ? err : new Error(String(err))
        toolRes = {
          formattedContent: `Ошибка исполнения: ${error.message}`,
          error: true
        }
      }

      if (abortSignal?.aborted && policy.mutates && toolRes.error) {
        toolRes = { formattedContent: `Операция прервана во время выполнения; результат неизвестен, проверьте файл или состояние перед повтором.\n${toolRes.formattedContent}`, error: true }
      }

      const workspaceNotice = isFileTool && !config?.workspacePath?.trim()
        ? `Рабочая папка не выбрана. Используется: ${resolveWorkspacePath(blackboard, '.').absPath}\n\n`
        : ''
      const rawOutputContent = workspaceNotice + toolRes.formattedContent
      const outputContent = toolRes.noTruncate
        ? OutputTruncator.truncate(rawOutputContent, Number.POSITIVE_INFINITY, 60, 140, 35000)
        : OutputTruncator.truncate(rawOutputContent)
      const isError = Boolean(toolRes.error)

      const logPath = (toolRes.data as { logPath?: unknown } | undefined)?.logPath
      if (typeof logPath === 'string' && logPath.trim()) {
        const allowed = (blackboard.getArtifact('allowedExternalReadPaths') as Set<string> | undefined) || new Set<string>()
        const canonical = await inspectWorkspacePath(blackboard, logPath).then(r => r.actualPath).catch(() => logPath)
        allowed.add(canonical)
        blackboard.setArtifact('allowedExternalReadPaths', allowed)
      }

      if (policy.mutates && policy.modifiesFiles !== false) {
        resultCache.clear()
      } else if (cacheKey && !isError) {
        const cachedPaths = isBatchRead && resolvedFiles
          ? resolvedFiles.map((f) => String(f.path))
          : (tool.name === 'read_file' || tool.name === 'list_dir') && isFileTool
            ? [actualTarget]
            : []
        const fileVersions = cachedPaths.length > 0 ? await captureFileVersions(cachedPaths) : undefined
        resultCache.set(cacheKey, {
          resultStr: outputContent,
          isError,
          data: toolRes.data,
          images: toolRes.images,
          ...(fileVersions ? { fileVersions } : {})
        })
      }

      if (toolRes.images) images.push(...toolRes.images)
      messages.push({
        role: 'tool',
        tool_call_id: call.id,
        name: tool.name,
        content: modelToolContent(outputContent, isError, toolRes.data)
      })

      if (startMutation) {
        await hooks?.onMutationResult?.({
          callId: call.id, result: outputContent, error: isError, interrupted: Boolean(abortSignal?.aborted && isError)
        })
      }
      this.safeEmit(onEvent, {
        type: 'tool_result',
        callId: call.id,
        result: toolRes.displayContent || outputContent,
        error: isError,
        data: toolRes.data
      })
    }

    return true
  }
}
