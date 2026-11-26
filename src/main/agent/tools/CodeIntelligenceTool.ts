import * as path from 'path'
import { Blackboard } from '../core/Blackboard'
import { analyze, AnalysisRequest } from '../services/TypeScriptAnalysis'
import { analyzePython, PythonRequest } from '../services/PythonAnalysis'
import { analyzeGeneric, detectLanguageServer, GenericRequest } from '../services/GenericLanguageAnalysis'
import { inspectWorkspacePath, resolveWorkspacePath } from './pathUtils'
import { ToolBase, ToolExecutionPolicy, ToolParameterDef, ToolResult } from './ToolBase'
import { resolveSandboxPolicy, type SandboxPolicy } from '../../../shared/sandbox'

export class CodeIntelligenceTool extends ToolBase {
  get name(): string { return 'code_intelligence' }
  get description(): string { return 'Семантическая навигация и диагностика: definition, references, diagnostics; для TypeScript/JavaScript также symbols и предпросмотр rename. TypeScript, JavaScript и Python встроены; для других языков нужен установленный LSP. Для definition/references/rename укажи line и column (с 1).' }
  get parameters(): Record<string, ToolParameterDef> { return {
    path: { type: 'string', description: 'Путь к файлу проекта', required: true },
    operation: { type: 'string', enum: ['definition', 'references', 'diagnostics', 'symbols', 'rename'], description: 'Вид анализа; rename только показывает места изменения', required: true },
    line: { type: 'integer', description: 'Строка символа с 1 для definition/references/rename.', minimum: 1 }, column: { type: 'integer', description: 'Столбец символа с 1 для definition/references/rename.', minimum: 1 }
  } }
  getExecutionPolicy(args: Record<string, unknown> = {}): ToolExecutionPolicy {
    const mutates = typeof args.path === 'string' && /\.(?:py|pyi|c|h|cc|cpp|cxx|hpp|cs|go|rs|lua|java)$/i.test(args.path)
    return { mutates, parallelSafe: false, cacheable: false, ...(mutates ? { modifiesFiles: false } : {}) }
  }
  validate(raw: string): string | null {
    try {
      const a = JSON.parse(raw)
      if (!['definition', 'references', 'diagnostics', 'symbols', 'rename'].includes(a.operation)) return 'Ошибка: неизвестная операция анализа.'
      if (typeof a.path !== 'string' || !/\.(?:ts|tsx|js|jsx|py|pyi|c|h|cc|cpp|cxx|hpp|cs|go|rs|lua|java)$/i.test(a.path)) return 'Ошибка: неподдерживаемый язык файла.'
      if (!/\.(?:ts|tsx|js|jsx)$/i.test(a.path) && ['symbols', 'rename'].includes(a.operation)) return 'Для этого языка доступны definition, references и diagnostics.'
      if (!['diagnostics', 'symbols'].includes(a.operation) && (!Number.isInteger(a.line) || a.line < 1 || !Number.isInteger(a.column) || a.column < 1)) return 'Ошибка: строка и столбец должны быть положительными целыми числами.'
      return null
    } catch { return 'Ошибка: некорректные аргументы анализа.' }
  }
  async execute(raw: string, board: Blackboard, signal?: AbortSignal): Promise<ToolResult> {
    const error = this.validate(raw); if (error) return { error: true, formattedContent: error }
    const args = JSON.parse(raw) as AnalysisRequest
    const config = board.getArtifact('config') as { accessMode?: string; planMode?: boolean; sandbox?: Partial<SandboxPolicy> } | undefined
    if (this.getExecutionPolicy({ path: args.path }).mutates && (board.getArtifact('planMode') || config?.accessMode === 'read-only')) return { error: true, formattedContent: 'Языковой сервер недоступен в режиме планирования и только для чтения: он может запускать программы проекта.' }
    const inspected = await inspectWorkspacePath(board, args.path)
    if (inspected.external) return { error: true, formattedContent: 'Анализ файлов вне рабочей папки не поддерживается.' }
    const root = resolveWorkspacePath(board, '.').absPath
    const resolvedSandbox = resolveSandboxPolicy({ accessMode: config?.accessMode, planMode: config?.planMode ?? Boolean(board.getArtifact('planMode')), sandbox: config?.sandbox }, root)
    const lspSandbox: SandboxPolicy = resolvedSandbox.profile === 'unrestricted'
      ? resolvedSandbox
      : { profile: 'read-only', network: 'off', writableRoots: [] }
    const target = { ...args, path: path.resolve(inspected.actualPath) }
    let result
    if (/\.pyi?$/i.test(args.path)) result = await analyzePython({ ...(target as PythonRequest), sandbox: lspSandbox }, root, signal)
    else if (/\.(?:ts|tsx|js|jsx)$/i.test(args.path)) result = await analyze(target, root, signal)
    else {
      const server = await detectLanguageServer(args.path)
      if (!server) return { error: true, formattedContent: 'Языковой сервер не найден в PATH. Установите подходящий сервер: clangd (C/C++), csharp-ls (C#), gopls (Go), rust-analyzer (Rust), lua-language-server (Lua) или jdtls (Java).' }
      result = await analyzeGeneric({ ...(target as GenericRequest), sandbox: lspSandbox }, root, server, signal)
    }
    if (result.error) return { error: true, formattedContent: `Ошибка анализа: ${result.error}` }
    const lines = (result.items || []).map((item) => `${item.path}:${item.line}:${item.column}${item.name ? ` ${item.name} (${item.kind})` : ''}${item.text ? ` ${item.text} (длина ${item.length}, префикс ${JSON.stringify(item.prefix)}, суффикс ${JSON.stringify(item.suffix)})` : ''}${item.code ? ` [${item.category} ${item.code}] ${item.message}` : ''}`)
    const output = `${'fallback' in result && result.fallback ? 'Конфигурация проекта не найдена; анализируется отдельный файл.\n' : ''}${args.operation === 'rename' ? 'Предпросмотр: файлы не изменены.\n' : ''}${lines.join('\n') || (args.operation === 'diagnostics' ? 'Ошибок не найдено.' : 'Совпадений не найдено.')}${result.truncated ? '\nРезультаты ограничены 100 записями.' : ''}`
    return { success: true, formattedContent: output.length > 25000 ? `${output.slice(0, 25000)}\nРезультат усечён.` : output, data: result }
  }
}
