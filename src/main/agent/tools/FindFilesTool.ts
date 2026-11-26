import * as fs from 'fs/promises'
import * as path from 'path'
import picomatch from 'picomatch'
import { Blackboard } from '../core/Blackboard'
import { ToolBase, ToolExecutionPolicy, ToolParameterDef, ToolResult } from './ToolBase'
import { resolveWorkspacePath } from './pathUtils'
import { walkProject } from './projectWalk'
import { listWorkspaceFilesWithRg } from './ProjectSearchTool'

export class FindFilesTool extends ToolBase {
  get name(): string { return 'find_files' }
  get description(): string { return 'Находит относительные пути файлов в проекте по glob-шаблону (например, "**/*.ts"), соблюдая правила .gitignore.' }
  get parameters(): Record<string, ToolParameterDef> { return {
    pattern: { type: 'string', description: 'Glob-шаблон для поиска файлов, например "**/*.ts" или "src/**/*.tsx"', required: true, minLength: 1 },
    path: { type: 'string', description: 'Каталог относительно корня проекта для ограничения области поиска (по умолчанию корень проекта)' },
    limit: { type: 'integer', description: 'Максимальное количество возвращаемых путей файлов (от 1 до 200, по умолчанию 100).', minimum: 1, maximum: 200, default: 100 }
  } }
  getExecutionPolicy(): ToolExecutionPolicy { return { mutates: false, parallelSafe: true, cacheable: false } }
  validate(raw: string): string | null {
    try { const a = JSON.parse(raw); return typeof a.pattern === 'string' && a.pattern.trim() ? null : 'Ошибка: pattern обязателен.' }
    catch { return 'Ошибка: некорректный JSON аргументов.' }
  }
  async execute(raw: string, board: Blackboard, signal?: AbortSignal): Promise<ToolResult> {
    const error = this.validate(raw); if (error) return { formattedContent: error, error: true }
    const args = JSON.parse(raw); const limit = Math.max(1, Math.min(200, Math.floor(Number(args.limit) || 100)))
    const root = resolveWorkspacePath(board, args.path || '.').absPath
    const workspace = resolveWorkspacePath(board, '.').absPath
    try {
      const realWorkspace = await fs.realpath(workspace).catch(() => path.resolve(workspace))
      const realRoot = await fs.realpath(root).catch(() => path.resolve(root))
      const relSubdir = path.relative(realWorkspace, realRoot).replace(/\\/g, '/')
      const inSubdir = Boolean(relSubdir && relSubdir !== '.')

      const rgFiles = await listWorkspaceFilesWithRg(realWorkspace, signal)
      if (rgFiles !== null) {
        const match = picomatch(args.pattern, { dot: true, basename: !args.pattern.includes('/') })
        const matched: string[] = []
        let truncated = false
        for (const rel of rgFiles) {
          if (inSubdir && rel !== relSubdir && !rel.startsWith(`${relSubdir}/`)) continue
          const relToRoot = inSubdir ? rel.slice(relSubdir.length + 1) : rel
          if (match(relToRoot)) {
            if (matched.length >= limit) { truncated = true; break }
            matched.push(rel)
          }
        }
        return {
          formattedContent: (matched.join('\n') || 'Совпадений не найдено.') + (truncated ? '\n[Результаты ограничены; уточните путь или шаблон.]' : ''),
          data: { paths: matched, truncated },
          success: true
        }
      }

      const results: string[] = []
      const state = await walkProject(root, workspace, args.pattern, signal, async (_file, rel) => { results.push(rel); return results.length > limit })
      if (state.cancelled) return { formattedContent: 'Поиск отменён.', error: true }
      const truncated = state.truncated
      return { formattedContent: (results.slice(0, limit).join('\n') || 'Совпадений не найдено.') + (truncated ? '\n[Результаты ограничены; уточните путь или шаблон.]' : ''), data: { paths: results.slice(0, limit), truncated }, success: true }
    } catch (e) { return { formattedContent: `Ошибка поиска: ${e instanceof Error ? e.message : String(e)}`, error: true } }
  }
}
