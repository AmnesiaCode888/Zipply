import * as fs from 'fs/promises'
import * as path from 'path'
import { Blackboard } from '../../core/Blackboard'
import { ToolBase, type ToolResult, type ToolExecutionPolicy } from '../../tools/ToolBase'

const excluded = new Set(['.git', 'node_modules', 'dist', 'build', 'out', 'coverage', '.venv', 'venv', 'vendor'])
const MAX_FILES = 5000
const MAX_FILE_BYTES = 256 * 1024
const MAX_TOTAL_BYTES = 12 * 1024 * 1024
const MAX_FINDINGS = 100

type Finding = { rule: string; title: string; path: string; line: number }

const inside = (root: string, target: string): boolean => {
  const relative = path.relative(root, target)
  return relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative)
}

function configKind(file: string): 'nginx' | 'apache' | null {
  const base = path.basename(file).toLowerCase()
  const normalized = file.toLowerCase().replace(/\\/g, '/')
  if (base === '.htaccess' || base === 'httpd.conf' || base === 'apache2.conf' || /(?:^|\/)(?:apache|httpd)(?:\/|$)/.test(normalized)) return 'apache'
  if (base === 'nginx.conf' || base.endsWith('.nginx.conf') || /(?:^|\/)nginx(?:\/|$)/.test(normalized)) return 'nginx'
  return null
}

function inspectLine(line: string, kind: 'nginx' | 'apache'): Array<{ rule: string; title: string }> {
  const active = line.replace(/\s+#.*$/, '').trim()
  if (!active || active.startsWith('#')) return []
  if (kind === 'nginx') {
    const findings = []
    if (/^autoindex\s+on\s*;/i.test(active)) findings.push({ rule: 'nginx-autoindex', title: 'Включён просмотр списка файлов в каталогах (autoindex)' })
    if (/^server_tokens\s+on\s*;/i.test(active)) findings.push({ rule: 'nginx-server-tokens', title: 'В ответах раскрывается версия Nginx (server_tokens)' })
    return findings
  }

  const findings = []
  if (/^Options\b/i.test(active)) {
    const options = active.replace(/^Options\s+/i, '').replace(/;\s*$/, '').split(/\s+/)
    const enabled = options.some(option => /^\+Indexes$/i.test(option) || /^Indexes$/i.test(option) || /^All$/i.test(option))
    const disabled = options.some(option => /^-Indexes$/i.test(option))
    if (enabled && !disabled) findings.push({ rule: 'apache-indexes', title: 'Включён просмотр списка файлов в каталогах (Options Indexes)' })
  }
  if (/^TraceEnable\s+On\s*$/i.test(active)) findings.push({ rule: 'apache-trace', title: 'Включён HTTP TRACE (TraceEnable On)' })
  if (/^ServerTokens\s+Full\s*$/i.test(active)) findings.push({ rule: 'apache-server-tokens', title: 'Apache раскрывает подробную версию сервера (ServerTokens Full)' })
  return findings
}

export class CyberSecServerConfig extends ToolBase {
  get name(): string { return 'cybersec_audit_server_config' }
  get description(): string { return 'Ищет несколько известных рискованных директив в локальных конфигурациях Nginx и Apache. Только читает файлы, не применяет настройки и возвращает кандидаты для ручной проверки; это не полный аудит конфигурации.' }
  getExecutionPolicy(): ToolExecutionPolicy { return { mutates: false, parallelSafe: false, cacheable: false } }

  async execute(_argumentsJson: string, board: Blackboard, signal?: AbortSignal): Promise<ToolResult> {
    const config = board.getArtifact('config') as { workspacePath?: string } | undefined
    if (!config?.workspacePath?.trim()) return { error: true, formattedContent: 'Для аудита выберите папку проекта.' }
    if (signal?.aborted) return { error: true, formattedContent: 'Аудит конфигурации отменён.' }

    const findings: Finding[] = []
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
          if (++visited > MAX_FILES) { limited = true; break }
          if (excluded.has(entry.name.toLowerCase()) || entry.isSymbolicLink()) continue
          const full = path.join(dir, entry.name)
          if (entry.isDirectory()) { pending.push(full); continue }
          if (!entry.isFile() || entry.name.toLowerCase().startsWith('.env')) continue
          if (!entry.name.toLowerCase().endsWith('.conf') && entry.name.toLowerCase() !== '.htaccess') continue
          try {
            const real = await fs.realpath(full)
            if (!inside(root, real)) { skipped++; continue }
            const stat = await fs.stat(real)
            if (!stat.isFile() || stat.size > MAX_FILE_BYTES) { skipped++; continue }
            if (bytes + stat.size > MAX_TOTAL_BYTES) { limited = true; break }
            const content = await fs.readFile(real, 'utf8')
            bytes += stat.size; scanned++
            if (content.includes('\0')) { skipped++; continue }
            const kind = configKind(path.relative(root, real))
            if (!kind) continue
            const lines = content.split(/\r?\n/)
            for (let index = 0; index < lines.length; index++) {
              if (signal?.aborted) break
              for (const finding of inspectLine(lines[index], kind)) {
                findings.push({ ...finding, path: path.relative(root, real).replace(/\\/g, '/').replace(/[\u0000-\u001f\u007f]/g, '?').slice(0, 500), line: index + 1 })
                if (findings.length >= MAX_FINDINGS) { limited = true; break }
              }
              if (limited) break
            }
          } catch { skipped++ }
          if (limited) break
        }
      }
      if (signal?.aborted) return { error: true, formattedContent: 'Аудит конфигурации отменён.' }
      const summary = findings.length ? findings.map((f, index) => `${index + 1}. ${f.title} — ${f.path}:${f.line} [${f.rule}]`).join('\n') : 'Совпадений по встроенным правилам не найдено.'
      return { success: true, data: { findings, scanned, skipped, limited }, formattedContent: `Проверено конфигураций: ${scanned}; пропущено: ${skipped}${limited ? '; достигнут лимит проверки' : ''}.\n${summary}\nРезультаты основаны на шаблонах и требуют ручной проверки; отсутствие совпадений не означает отсутствие уязвимостей.` }
    } catch (error) { return { error: true, formattedContent: `Не удалось проверить конфигурацию: ${error instanceof Error ? error.message : String(error)}` } }
  }
}
