import * as path from 'path'
import { Blackboard } from '../core/Blackboard'
import { processManager, ProcessOwner } from '../services/ProcessManager'
import { inspectWorkspacePath, resolveWorkspacePath } from './pathUtils'
import { ToolBase, ToolExecutionPolicy, ToolParameterDef, ToolResult } from './ToolBase'
import { resolveSandboxPolicy, type SandboxPolicy } from '../../../shared/sandbox'

type Action = 'start' | 'poll' | 'stop' | 'list'
export class ProcessTool extends ToolBase {
  constructor(private readonly action: Action) { super() }
  get name(): string { return `process_${this.action}` }
  get description(): string { return ({
    start: 'Запускает долгую команду в фоне текущего чата; вернёт process_id для process_poll и process_stop.',
    poll: 'Получает новые строки и статус процесса текущего чата; передавай process_id и последний cursor.',
    stop: 'Останавливает процесс и дочерние процессы текущего чата по process_id из start или list.',
    list: 'Показывает фоновые процессы текущего чата.'
  })[this.action] }
  get parameters(): Record<string, ToolParameterDef> {
    if (this.action === 'start') return { command: { type: 'string', required: true, description: 'Команда shell' }, cwd: { type: 'string', description: 'Папка внутри проекта' } }
    if (this.action === 'list') return {}
    return { process_id: { type: 'string', required: true, description: 'ID процесса текущего чата из process_start или process_list.', minLength: 1 }, ...(this.action === 'poll' ? { cursor: { type: 'integer', description: 'Последний курсор вывода, неотрицательное целое число.', minimum: 0 }, wait_ms: { type: 'integer', description: 'Время ожидания в миллисекундах, от 0 до 10000.', minimum: 0, maximum: 10000 } } : {}) }
  }
  getExecutionPolicy(): ToolExecutionPolicy { return { mutates: this.action === 'start' || this.action === 'stop', parallelSafe: false, cacheable: false } }
  validate(raw: string): string | null {
    try {
      const a = JSON.parse(raw)
      if (this.action === 'start' && (typeof a.command !== 'string' || !a.command.trim())) return 'Ошибка: требуется command.'
      if (this.action === 'start' && a.cwd !== undefined && typeof a.cwd !== 'string') return 'Ошибка: cwd должен быть строкой.'
      if ((this.action === 'stop' || this.action === 'poll') && (typeof a.process_id !== 'string' || !a.process_id)) return 'Ошибка: требуется process_id.'
      if (a.wait_ms !== undefined && (!Number.isInteger(a.wait_ms) || a.wait_ms < 0 || a.wait_ms > 10000)) return 'Ошибка: wait_ms должен быть от 0 до 10000.'
      if (a.cursor !== undefined && (!Number.isSafeInteger(a.cursor) || a.cursor < 0)) return 'Ошибка: некорректный cursor.'
      return null
    } catch { return 'Ошибка: некорректные аргументы.' }
  }
  async execute(raw: string, board: Blackboard, signal?: AbortSignal): Promise<ToolResult> {
    const error = this.validate(raw); if (error) return { error: true, formattedContent: error }
    const args = JSON.parse(raw)
    const config = board.getArtifact('config') as { processOwner?: ProcessOwner; requestId?: string; accessMode?: string; planMode?: boolean; sandbox?: Partial<SandboxPolicy>; subagentDependencyPaths?: unknown } | undefined
    if (!config?.processOwner || !config.requestId) return { error: true, formattedContent: 'Для управления процессом требуется активный чат.' }
    const owner = config.processOwner
    try {
      if (signal?.aborted) throw new Error('Действие отменено.')
      if (this.action === 'start') {
        const cwd = await inspectWorkspacePath(board, args.cwd || '.')
        if (cwd.external) throw new Error('Рабочая папка процесса должна находиться внутри проекта.')
        const root = resolveWorkspacePath(board, '.').absPath
        const sandbox = resolveSandboxPolicy({ accessMode: config.accessMode, planMode: config.planMode ?? Boolean(board.getArtifact('planMode')), sandbox: config.sandbox }, root)
        const dependencyPaths = Array.isArray(config.subagentDependencyPaths)
          ? config.subagentDependencyPaths.filter((value): value is string => typeof value === 'string' && path.isAbsolute(value))
          : []
        const result = await processManager.start(owner, config.requestId, args.command, cwd.actualPath, sandbox, dependencyPaths)
        if (signal?.aborted) { await processManager.stop(owner, result.id); throw new Error('Запуск отменён.') }
        return { success: true, formattedContent: `Процесс ${result.id}: ${result.status}`, data: result }
      }
      if (this.action === 'list') { const data = processManager.list(owner); return { success: true, formattedContent: JSON.stringify(data, null, 2), data } }
      if (this.action === 'stop') { await processManager.stop(owner, args.process_id); return { success: true, formattedContent: `Процесс ${args.process_id} остановлен.` } }
      const data = await processManager.poll(owner, args.process_id, args.cursor || 0, args.wait_ms || 0, signal)
      return { success: true, formattedContent: `Процесс ${data.id}: ${data.status}; курсор ${data.cursor}${data.truncated ? '; часть вывода удалена' : ''}\n${data.output}`, data }
    } catch (err) { return { error: true, formattedContent: `Ошибка процесса: ${err instanceof Error ? err.message : String(err)}` } }
  }
}
