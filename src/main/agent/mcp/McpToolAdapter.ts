import { Blackboard } from '../core/Blackboard'
import { ToolBase, type ToolApprovalRequest, type ToolParameterDef, type ToolResult } from '../tools/ToolBase'
import { mcpToolTrustFingerprint } from './McpTrustStore'
import type { McpRuntimeManager, McpToolDescriptor } from './McpRuntimeManager'

type JsonSchema = Record<string, unknown>

function parameter(schema: JsonSchema, required = false, depth = 0): ToolParameterDef {
  const type = typeof schema.type === 'string' ? schema.type : 'string'
  const result: ToolParameterDef = {
    type,
    description: typeof schema.description === 'string' ? schema.description.slice(0, 1000) : '',
    ...(required ? { required: true } : {})
  }
  for (const key of ['minimum', 'maximum', 'minLength', 'maxLength', 'minItems', 'maxItems'] as const) {
    if (typeof schema[key] === 'number' && Number.isFinite(schema[key])) result[key] = schema[key] as number
  }
  if (Array.isArray(schema.enum) && schema.enum.every(item => typeof item === 'string')) result.enum = schema.enum.slice(0, 100) as string[]
  if (depth < 3 && schema.items && typeof schema.items === 'object' && !Array.isArray(schema.items)) {
    const item = schema.items as JsonSchema
    result.items = { type: typeof item.type === 'string' ? item.type : 'string', ...(typeof item.description === 'string' ? { description: item.description.slice(0, 1000) } : {}) }
  }
  if (depth < 3 && schema.properties && typeof schema.properties === 'object' && !Array.isArray(schema.properties)) {
    const properties = schema.properties as Record<string, JsonSchema>
    const requiredNames = Array.isArray(schema.required) ? new Set(schema.required.filter((name): name is string => typeof name === 'string')) : new Set<string>()
    result.properties = Object.fromEntries(Object.entries(properties).slice(0, 100).map(([name, item]) => [name, parameter(item, requiredNames.has(name), depth + 1)]))
  }
  return result
}

function resultText(result: Awaited<ReturnType<McpRuntimeManager['callTool']>>): string {
  const text = result.content.map(item => {
    if (item.type === 'text') return item.text
    if (item.type === 'image') return '[сервер вернул изображение]'
    if (item.type === 'audio') return '[сервер вернул аудио]'
    if (item.type === 'resource') return `[сервер вернул ресурс: ${item.resource.uri}]`
    return `[сервер вернул содержимое типа ${item.type}]`
  }).filter(Boolean)
  if (result.structuredContent !== undefined) text.push(`Структурированный результат:\n${JSON.stringify(result.structuredContent)}`)
  return text.join('\n\n') || (result.isError ? 'MCP-инструмент вернул ошибку без описания.' : 'MCP-инструмент завершился без текстового результата.')
}

export class McpToolAdapter extends ToolBase {
  private readonly serverInstanceId?: string
  private readonly trustFingerprint?: string
  constructor(private readonly serverId: string, private readonly descriptor: McpToolDescriptor, private readonly runtime: McpRuntimeManager) {
    super()
    try {
      this.serverInstanceId = runtime.getServerInstanceId(serverId)
      this.trustFingerprint = mcpToolTrustFingerprint(serverId, descriptor, runtime.getServerDefinition(serverId))
    } catch {
      this.serverInstanceId = undefined
      this.trustFingerprint = undefined
    }
  }

  get name(): string { return this.descriptor.id }
  get description(): string {
    const description = this.descriptor.description.trim() || 'Инструмент внешнего MCP-сервера.'
    return `${description}\nСервер: ${this.serverId}. Вызов передаёт параметры этому серверу; в режиме полного доступа запрос подтверждения отключён.`.slice(0, 4000)
  }
  get parameters(): Record<string, ToolParameterDef> {
    const schema = this.descriptor.inputSchema as unknown as JsonSchema
    if (!schema || typeof schema !== 'object' || Array.isArray(schema) || !schema.properties || typeof schema.properties !== 'object' || Array.isArray(schema.properties)) return {}
    const required = Array.isArray(schema.required) ? new Set(schema.required.filter((name): name is string => typeof name === 'string')) : new Set<string>()
    return Object.fromEntries(Object.entries(schema.properties as Record<string, JsonSchema>).slice(0, 100).map(([name, property]) => [name, parameter(property, required.has(name))]))
  }
  getInputSchema(): Record<string, unknown> {
    return structuredClone(this.descriptor.inputSchema as unknown as Record<string, unknown>)
  }
  getExecutionPolicy() { return { mutates: true, parallelSafe: false, cacheable: false } }

  getDisplayInfo() { return { label: `MCP · ${this.descriptor.remoteName}`, targetName: this.serverId } }

  getApprovalRequest(args: Record<string, unknown>): ToolApprovalRequest {
    let details = '{}'
    try {
      const serialized = JSON.stringify(args, null, 2)
      details = serialized.length > 12000
        ? `${serialized.slice(0, 12000)}\n\n[Показаны первые 12 000 символов. Сервер получит весь объект аргументов.]`
        : serialized
    } catch { details = '[не удалось отобразить аргументы]' }
    return {
      kind: 'mcp', approvalPolicy: 'respect_access_mode',
      command: `${this.serverId} · ${this.descriptor.remoteName}`,
      target: this.serverId, serverId: this.serverId, toolId: this.descriptor.id,
      toolName: this.descriptor.remoteName,
      ...(this.trustFingerprint ? { trustFingerprint: this.trustFingerprint } : {}),
      details
    }
  }

  async execute(argumentsJson: string, _board: Blackboard, abortSignal?: AbortSignal): Promise<ToolResult> {
    let args: Record<string, unknown>
    try {
      const parsed: unknown = JSON.parse(argumentsJson || '{}')
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('Expected an object')
      args = parsed as Record<string, unknown>
    } catch {
      return { error: true, formattedContent: 'Некорректные аргументы MCP-инструмента.' }
    }
    try {
      const result = await this.runtime.callTool(this.descriptor.id, args, abortSignal, this.serverInstanceId)
      const content = resultText(result)
      // MCP output is external data. ToolResult.data is an internal control
      // channel (for example, trusted local spill-log paths), so never copy
      // structured server content into it. resultText already serializes it
      // into the model-visible text result.
      return { formattedContent: content, error: result.isError === true }
    } catch (error) {
      return { error: true, formattedContent: `Ошибка MCP-инструмента: ${error instanceof Error ? error.message : String(error)}` }
    }
  }
}
