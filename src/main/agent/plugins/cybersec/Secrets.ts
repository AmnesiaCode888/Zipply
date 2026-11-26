import * as fs from 'fs/promises'
import * as path from 'path'
import { Blackboard } from '../../core/Blackboard'
import { ToolBase, type ToolResult, type ToolExecutionPolicy } from '../../tools/ToolBase'

const excludedDirectories = new Set(['.git', 'node_modules', 'dist', 'build', 'out', 'coverage', '.venv', 'venv', 'vendor'])
const extensions = new Set(['.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs', '.py', '.yaml', '.yml', '.json', '.toml', '.ini', '.conf', '.properties', '.pem', '.key'])
const MAX_ENTRIES = 5000
const MAX_FILE_BYTES = 256 * 1024
const MAX_TOTAL_BYTES = 12 * 1024 * 1024
const MAX_FINDINGS = 100
const patterns = [
  { kind: 'GitHub token', pattern: /\bgh[pousr]_[A-Za-z0-9_]{20,}\b/ },
  { kind: 'AWS access key', pattern: /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/ },
  { kind: 'Private key', pattern: /-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/ }
]

const inside = (root: string, target: string): boolean => {
  const relative = path.relative(root, target)
  return relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative)
}

const safeRelativePath = (root: string, target: string): string =>
  path.relative(root, target).replace(/\\/g, '/').replace(/[\u0000-\u001f\u007f]/g, '?').slice(0, 500)

export class CyberSecSecrets extends ToolBase {
  get name(): string { return 'cybersec_scan_secrets' }
  get description(): string { return 'Ищет несколько распространённых форматов секретов в исходниках выбранного проекта. Значения полностью скрываются; результаты являются кандидатами и требуют проверки. Файлы .env и каталоги зависимостей пропускаются.' }
  getExecutionPolicy(): ToolExecutionPolicy { return { mutates: false, parallelSafe: false, cacheable: false } }

  async execute(_argumentsJson: string, board: Blackboard, signal?: AbortSignal): Promise<ToolResult> {
    const config = board.getArtifact('config') as { workspacePath?: string } | undefined
    if (!config?.workspacePath?.trim()) return { error: true, formattedContent: 'Для поиска секретов выберите папку проекта.' }
    if (signal?.aborted) return { error: true, formattedContent: 'Поиск секретов отменён.' }

    const findings: Array<{ kind: string; path: string; line: number }> = []
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
          if (++visited > MAX_ENTRIES) { limited = true; break }
          if (excludedDirectories.has(entry.name) || entry.isSymbolicLink()) continue
          const full = path.join(dir, entry.name)
          if (entry.isDirectory()) { pending.push(full); continue }
          if (!entry.isFile() || entry.name.toLowerCase().startsWith('.env')) continue
          if (!extensions.has(path.extname(entry.name).toLowerCase()) && entry.name.toLowerCase() !== 'dockerfile') continue
          try {
            const real = await fs.realpath(full)
            if (!inside(root, real)) { skipped++; continue }
            const stat = await fs.stat(real)
            if (!stat.isFile() || stat.size > MAX_FILE_BYTES) { skipped++; continue }
            if (bytes + stat.size > MAX_TOTAL_BYTES) { limited = true; break }
            const content = await fs.readFile(real, 'utf8')
            bytes += stat.size
            scanned++
            if (content.includes('\0')) { skipped++; continue }
            const lines = content.split(/\r?\n/)
            for (let index = 0; index < lines.length; index++) {
              for (const rule of patterns) {
                if (rule.pattern.test(lines[index])) {
                  findings.push({ kind: rule.kind, path: safeRelativePath(root, real), line: index + 1 })
                  if (findings.length >= MAX_FINDINGS) { limited = true; break }
                }
              }
              if (limited) break
            }
          } catch { skipped++ }
          if (limited) break
        }
      }
      if (signal?.aborted) return { error: true, formattedContent: 'Поиск секретов отменён.' }
      const summary = findings.length
        ? findings.map((finding, index) => `${index + 1}. Возможный ${finding.kind} — ${finding.path}:${finding.line} (значение скрыто)`).join('\n')
        : 'Совпадений по встроенным шаблонам не найдено.'
      return {
        success: true,
        data: { findings, scanned, skipped, limited },
        formattedContent: `Проверено файлов: ${scanned}; пропущено: ${skipped}${limited ? '; достигнут лимит проверки' : ''}.\n${summary}\nПроверка ищет ограниченный набор шаблонов; совпадения — кандидаты, а отсутствие совпадений не доказывает отсутствие секретов.`
      }
    } catch (error) {
      return { error: true, formattedContent: `Не удалось проверить проект: ${error instanceof Error ? error.message : String(error)}` }
    }
  }
}
