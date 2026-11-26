import * as fs from 'fs/promises'
import * as path from 'path'
import ignore, { Ignore } from 'ignore'
import { ToolBase, ToolParameterDef, ToolResult, ToolExecutionPolicy } from './ToolBase'
import { Blackboard } from '../core/Blackboard'
import { resolveWorkspacePath } from './pathUtils'

const IGNORED_NAMES = new Set([
  '.git',
  'node_modules',
  'dist',
  'out',
  '.next',
  'build',
  '.turbo',
  '.vscode',
  '.idea',
  'coverage'
])

const MAX_LIST_ENTRIES = 300

export class ListDirTool extends ToolBase {
  get name(): string {
    return 'list_dir'
  }

  get description(): string {
    return 'Показывает содержимое папки с учётом .gitignore; рекурсивный просмотр ограничен 3 уровнями и 300 записями.'
  }

  get parameters(): Record<string, ToolParameterDef> {
    return {
      path: {
        type: 'string',
        description: 'Относительный путь к директории (по умолчанию "." — корень рабочей папки)'
      },
      recursive: {
        type: 'boolean',
        description: 'Включить рекурсивный просмотр до 3 уровней (по умолчанию false).'
      }
    }
  }

  getExecutionPolicy(): ToolExecutionPolicy {
    return {
      mutates: false,
      parallelSafe: true,
      cacheable: true
    }
  }

  validate(): string | null {
    return null
  }

  private async loadInheritedIgnores(workspaceRoot: string, targetAbs: string): Promise<Array<{ base: string; matcher: Ignore }>> {
    const rules: Array<{ base: string; matcher: Ignore }> = []
    const realWorkspace = await fs.realpath(workspaceRoot).catch(() => path.resolve(workspaceRoot))
    const realTarget = await fs.realpath(targetAbs).catch(() => path.resolve(targetAbs))
    const rel = path.relative(realWorkspace, realTarget)
    const inside = rel !== '..' && !rel.startsWith(`..${path.sep}`) && !path.isAbsolute(rel)
    if (!inside) return rules

    let current = realWorkspace
    const parts = rel && rel !== '.' ? rel.split(path.sep).filter(Boolean) : []
    for (const part of parts) {
      try {
        const raw = await fs.readFile(path.join(current, '.gitignore'), 'utf8')
        rules.push({ base: current, matcher: ignore().add(raw) })
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err
      }
      current = path.join(current, part)
    }
    return rules
  }

  private async scanDir(
    currentAbs: string,
    currentRel: string,
    isRecursive: boolean,
    depth: number,
    rules: Array<{ base: string; matcher: Ignore }>,
    state: { truncated: boolean; count: number },
    maxDepth = 3
  ): Promise<string[]> {
    if (depth > maxDepth || state.count >= MAX_LIST_ENTRIES) return []

    let entries
    try {
      entries = await fs.readdir(currentAbs, { withFileTypes: true })
    } catch (error) {
      throw new Error(`Не удалось прочитать папку ${currentRel || currentAbs}: ${error instanceof Error ? error.message : String(error)}`)
    }

    let nextRules = rules
    try {
      const gitignore = await fs.readFile(path.join(currentAbs, '.gitignore'), 'utf8')
      nextRules = [...rules, { base: currentAbs, matcher: ignore().add(gitignore) }]
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err
    }

    const result: string[] = []
    const indent = '  '.repeat(depth)

    // Sort folders first, then files
    const sorted = entries.sort((a, b) => {
      if (a.isDirectory() && !b.isDirectory()) return -1
      if (!a.isDirectory() && b.isDirectory()) return 1
      return a.name.localeCompare(b.name)
    })

    for (const entry of sorted) {
      if (IGNORED_NAMES.has(entry.name)) continue

      const itemRel = currentRel ? `${currentRel}/${entry.name}` : entry.name
      const itemAbs = path.join(currentAbs, entry.name)
      const isDir = entry.isDirectory()

      let isIgnored = false
      for (const { base, matcher } of nextRules) {
        const sub = path.relative(base, itemAbs).replace(/\\/g, '/')
        if (!sub || sub.startsWith('..')) continue
        const testRes = matcher.test(isDir ? `${sub}/` : sub)
        if (testRes.ignored) isIgnored = true
        else if (testRes.unignored) isIgnored = false
      }
      if (isIgnored) continue

      if (state.count >= MAX_LIST_ENTRIES) {
        state.truncated = true
        break
      }
      state.count++

      if (isDir) {
        result.push(`${indent}📁 ${entry.name}/`)
        if (isRecursive && depth < maxDepth) {
          const sub = await this.scanDir(itemAbs, itemRel, isRecursive, depth + 1, nextRules, state, maxDepth)
          result.push(...sub)
        }
      } else {
        let sizeStr = ''
        try {
          const stat = await fs.stat(itemAbs)
          const sizeKb = (stat.size / 1024).toFixed(1)
          sizeStr = ` (${sizeKb} KB)`
        } catch {}
        result.push(`${indent}📄 ${entry.name}${sizeStr}`)
      }
    }

    return result
  }

  async execute(argumentsJson: string, blackboard: Blackboard): Promise<ToolResult> {
    let args: any = {}
    try {
      args = JSON.parse(argumentsJson || '{}')
    } catch {}

    const target = args.path || '.'
    const isRecursive = Boolean(args.recursive)
    const { absPath, relPath, workspaceRoot } = resolveWorkspacePath(blackboard, target)

    try {
      const stat = await fs.stat(absPath)
      if (!stat.isDirectory()) {
        return {
          formattedContent: `Ошибка: '${relPath}' не является директорией.`,
          error: true
        }
      }
    } catch {
      return {
        formattedContent: `Директория '${relPath}' не найдена.`,
        error: true
      }
    }

    let items: string[]
    const state = { truncated: false, count: 0 }
    try {
      const inherited = await this.loadInheritedIgnores(workspaceRoot, absPath)
      items = await this.scanDir(absPath, '', isRecursive, 0, inherited, state)
    } catch (error) {
      return { formattedContent: `Ошибка чтения папки '${relPath}': ${error instanceof Error ? error.message : String(error)}`, error: true }
    }

    const header = `Содержимое папки: ${relPath === '.' ? 'Корень проекта' : relPath}`
    const body = items.length > 0 ? items.join('\n') : '(папка пуста)'
    const footer = state.truncated ? `\n... [Вывод ограничен ${MAX_LIST_ENTRIES} записями; уточните подпапку или используйте find_files.]` : ''
    const output = `${header}\n${'='.repeat(Math.min(header.length, 50))}\n${body}${footer}`

    return {
      formattedContent: output,
      data: {
        path: relPath,
        itemCount: items.length,
        truncated: state.truncated
      },
      success: true
    }
  }
}
