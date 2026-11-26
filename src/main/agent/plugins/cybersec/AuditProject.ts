import * as fs from 'fs/promises'
import * as path from 'path'
import { Blackboard } from '../../core/Blackboard'
import { ToolBase, type ToolResult, type ToolExecutionPolicy } from '../../tools/ToolBase'

const excluded = new Set(['.git', 'node_modules', 'dist', 'build', 'out', 'coverage', '.venv', 'venv', 'vendor'])
const extensions = new Set(['.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs', '.py', '.yaml', '.yml', '.json', '.toml', '.ini', '.conf', '.properties'])
const rules = [
  { id: 'tls-node-env', title: 'Проверка TLS отключена через NODE_TLS_REJECT_UNAUTHORIZED', pattern: /\bNODE_TLS_REJECT_UNAUTHORIZED\b\s*[:=]\s*['"]?0\b/i },
  { id: 'tls-node-option', title: 'Проверка TLS отключена в настройках клиента', pattern: /\brejectUnauthorized\s*:\s*false\b/i },
  { id: 'tls-python', title: 'Возможное отключение проверки TLS', pattern: /\bverify\s*=\s*False\b/ },
  { id: 'debug-mode', title: 'Включён режим отладки; проверьте окружение', pattern: /\bDEBUG\s*[:=]\s*(?:True|true)\b/ },
  { id: 'dynamic-eval', title: 'Динамическое выполнение eval: проверьте источник данных', pattern: /\beval\s*\(/ },
  { id: 'python-shell', title: 'Запуск subprocess с shell=True: проверьте аргументы', pattern: /\bsubprocess\.[a-z_]+\s*\([^\n]*\bshell\s*=\s*True\b/ },
  { id: 'html-injection', title: 'Запись HTML напрямую: проверьте обработку недоверенного ввода', pattern: /\b(?:innerHTML\s*=|dangerouslySetInnerHTML\s*=)/ },
  { id: 'docker-root', title: 'Контейнер явно запускается от root', pattern: /^\s*USER\s+(?:root|0)(?:\s|$)/i }
]

const inside = (root: string, target: string): boolean => {
  const relative = path.relative(root, target)
  return relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative)
}

export class CyberSecCodeAudit extends ToolBase {
  get name(): string { return 'cybersec_audit_project' }
  get description(): string { return 'Проверяет код и конфигурации выбранного проекта по ограниченному набору шаблонов безопасности. Не выполняет код и не изменяет файлы. Возвращает кандидаты для ручной проверки, а не подтверждённые уязвимости.' }
  getExecutionPolicy(): ToolExecutionPolicy { return { mutates: false, parallelSafe: false, cacheable: false } }

  async execute(_argumentsJson: string, board: Blackboard, signal?: AbortSignal): Promise<ToolResult> {
    const config = board.getArtifact('config') as { workspacePath?: string } | undefined
    if (!config?.workspacePath?.trim()) return { error: true, formattedContent: 'Для аудита выберите папку проекта.' }
    const findings: Array<{ rule: string; title: string; path: string; line: number }> = []
    let visited = 0, scanned = 0, skipped = 0, bytes = 0, limited = false
    try {
      const root = await fs.realpath(config.workspacePath)
      const pending = [root]
      while (pending.length && !signal?.aborted && !limited) {
        const dir = pending.pop()!
        const entries = await fs.readdir(dir, { withFileTypes: true })
        entries.sort((a, b) => a.name.localeCompare(b.name))
        for (const entry of entries) {
          if (signal?.aborted) break
          if (++visited > 5000) { limited = true; break }
          if (excluded.has(entry.name) || entry.isSymbolicLink()) continue
          const full = path.join(dir, entry.name)
          if (entry.isDirectory()) { pending.push(full); continue }
          if (!entry.isFile() || entry.name.startsWith('.env')) continue
          if (!extensions.has(path.extname(entry.name).toLowerCase()) && entry.name.toLowerCase() !== 'dockerfile') continue
          try {
            const real = await fs.realpath(full)
            if (!inside(root, real)) { skipped++; continue }
            const stat = await fs.stat(real)
            if (!stat.isFile() || stat.size > 256 * 1024) { skipped++; continue }
            if (bytes + stat.size > 12 * 1024 * 1024) { limited = true; break }
            const content = await fs.readFile(real, 'utf8')
            bytes += stat.size; scanned++
            if (content.includes('\0')) { skipped++; continue }
            const lines = content.split(/\r?\n/)
            for (let index = 0; index < lines.length; index++) {
              const line = lines[index]
              if (/^\s*(?:#|\/\/|\*|<!--)/.test(line)) continue
              for (const rule of rules) {
                if (rule.id === 'docker-root' && entry.name.toLowerCase() !== 'dockerfile') continue
                if (rule.pattern.test(line)) findings.push({ rule: rule.id, title: rule.title, path: path.relative(root, real).replace(/\\/g, '/').replace(/[\u0000-\u001f\u007f]/g, '?').slice(0, 500), line: index + 1 })
                if (findings.length >= 100) { limited = true; break }
              }
              if (limited) break
            }
          } catch { skipped++ }
          if (limited) break
        }
      }
      if (signal?.aborted) return { error: true, formattedContent: 'Аудит отменён.' }
      const summary = findings.length ? findings.map((f, index) => `${index + 1}. ${f.title} — ${f.path}:${f.line} [${f.rule}]`).join('\n') : 'Совпадений по встроенным правилам не найдено.'
      return { success: true, data: { findings, scanned, skipped, limited }, formattedContent: `Проверено файлов: ${scanned}; пропущено: ${skipped}${limited ? '; достигнут лимит проверки' : ''}.\n${summary}\nРезультаты основаны на шаблонах и требуют ручной проверки; отсутствие совпадений не означает отсутствие уязвимостей.` }
    } catch (error) { return { error: true, formattedContent: `Не удалось проверить проект: ${error instanceof Error ? error.message : String(error)}` } }
  }
}

