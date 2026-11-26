import * as os from 'os'
import * as path from 'path'

export type CommandRisk = 'read_only' | 'workspace_write' | 'dangerous'

export interface CommandAssessment {
  risk: CommandRisk
  requiresConfirmation: boolean
  requiresNetwork?: boolean
  networkReason?: string
  reason?: string
  segments: string[]
  externalPaths?: string[]
}

/** Splits a shell command into pipeline/chain segments while respecting quotes. */
function splitShellSegments(command: string): string[] {
  const segments: string[] = []
  let current = ''
  let quote: '"' | "'" | null = null
  for (let i = 0; i < command.length; i++) {
    const ch = command[i]
    if (quote) {
      current += ch
      if (ch === '\\' && quote === '"' && i + 1 < command.length) {
        current += command[++i]
      } else if (ch === quote) {
        quote = null
      }
      continue
    }
    if (ch === '"' || ch === "'") {
      quote = ch
      current += ch
      continue
    }
    const two = command.slice(i, i + 2)
    if (two === '&&' || two === '||') {
      if (current.trim()) segments.push(current.trim())
      current = ''
      i++
      continue
    }
    if (ch === ';' || ch === '|' || ch === '\n') {
      if (current.trim()) segments.push(current.trim())
      current = ''
      continue
    }
    current += ch
  }
  if (current.trim()) segments.push(current.trim())
  return segments
}

function tokenizeSegment(segment: string): string[] {
  const tokens: string[] = []
  const re = /"([^"\\]|\\.)*"|'[^']*'|[^\s]+/g
  let m: RegExpExecArray | null
  while ((m = re.exec(segment)) !== null) {
    tokens.push(m[0].replace(/^['"]|['"]$/g, ''))
  }
  return tokens
}

function stripQuotedText(segment: string): string {
  return segment
    .replace(/"([^"\\]|\\.)*"/g, ' "" ')
    .replace(/'[^']*'/g, " '' ")
}

const READ_ONLY_BINS = new Set([
  'ls', 'dir', 'pwd', 'cd', 'cat', 'type', 'head', 'tail', 'wc', 'echo', 'which', 'where',
  'whoami', 'hostname', 'uname', 'date', 'env', 'printenv', 'rg', 'grep', 'findstr', 'select-string',
  'tree', 'stat', 'file', 'get-childitem', 'get-content', 'get-location'
])

const READ_ONLY_GIT_SUBCOMMANDS = new Set([
  'status', 'diff', 'log', 'show', 'branch', 'tag', 'rev-parse', 'ls-files', 'blame', 'describe', 'remote'
])

const VERSION_ONLY_BINS = new Set([
  'node', 'npm', 'pnpm', 'yarn', 'python', 'python3', 'py', 'go', 'cargo', 'rustc', 'tsc', 'git'
])

const INTERPRETER_BINS = new Set([
  'sh', 'bash', 'zsh', 'dash', 'cmd', 'powershell', 'pwsh', 'node', 'python', 'python3', 'py', 'ruby', 'perl', 'iex', 'invoke-expression'
])

const NETWORK_PATTERNS: Array<{ re: RegExp; reason: string }> = [
  { re: /\b(?:curl|wget|irm|iwr|invoke-webrequest|invoke-restmethod|ssh|scp|sftp|rsync|nc|ncat|telnet|ftp)\b/i, reason: 'Сетевая утилита или удалённое подключение.' },
  { re: /\bgit\b(?:[^\n|;&]*?)\b(clone|fetch|pull|push|ls-remote|remote\s+update)\b/i, reason: 'Сетевая операция git с удалённым репозиторием.' },
  { re: /\b(?:npm|pnpm|yarn)\b[^\n|;&]*\b(?:install|i|add|update|up|ci|audit|publish|login|dlx|create)\b/i, reason: 'Установка или публикация пакетов через сеть.' },
  { re: /\b(?:pip|pip3|uv\s+pip|poetry)\b[^\n|;&]*\b(?:install|download|add|update|publish)\b/i, reason: 'Установка Python-пакетов через сеть.' },
  { re: /\b(?:cargo\s+(?:install|fetch|update)|go\s+(?:get|install)\s+\S+\.)/i, reason: 'Загрузка зависимостей через сеть.' }
]

const DANGEROUS_PATTERNS: Array<{ re: RegExp; reason: string }> = [
  { re: /\bgit\b(?:[^\n|;&]*?)\b(push|force-with-lease)\b/i, reason: 'Отправка изменений в удалённый репозиторий (git push).' },
  { re: /\bgit\b(?:[^\n|;&]*?)\b(reset\s+--hard|clean\s+-[a-z]*f)/i, reason: 'Необратимое удаление локальных изменений git.' },
  { re: /\bgit\b(?:[^\n|;&]*?)\bcheckout\b(?:[^\n|;&]*?)(?:--|\s\.(?:\s|$))/i, reason: 'Сброс незафиксированных изменений в рабочей копии (git checkout).' },
  { re: /\bgit\b(?:[^\n|;&]*?)\brestore\b(?![^\n|;&]*--staged\b)/i, reason: 'Сброс незафиксированных изменений в рабочей копии (git restore).' },
  { re: /\bgit\b(?:[^\n|;&]*?)\bstash\s+(?:drop|clear)\b/i, reason: 'Удаление сохранённых изменений из git stash.' },
  { re: /\b(?:npm|pnpm|yarn)\s+publish\b/i, reason: 'Публикация пакета.' },
  { re: /\b(?:rm|rmdir|del|erase)\b[^\n]*(?:-r|-R|\/s|--recursive)/i, reason: 'Рекурсивное удаление файлов.' },
  { re: /\bremove-item\b[^\n]*-recurse/i, reason: 'Рекурсивное удаление файлов (Remove-Item).' },
  { re: /\b(?:chmod|chown)\b[^\n]*(?:-R|--recursive)/i, reason: 'Рекурсивное изменение прав доступа или владельца.' },
  { re: /\b(?:powershell|pwsh)(?:\.exe)?\b[^\n]*-(?:e|enc|encodedcommand)\b/i, reason: 'Запуск закодированной команды PowerShell.' },
  { re: /\b(?:python|python3|py)(?:\.exe)?\b[^\n]*\s-c\b[^\n]*(?:rmtree|unlink|remove|rmdir|system|Popen|run\()/i, reason: 'Выполнение потенциально разрушительного inline-скрипта Python.' },
  { re: /\bnode(?:\.exe)?\b[^\n]*\s(?:-e|--eval)\b[^\n]*(?:rmSync|rmdirSync|unlinkSync|\brm\s*\(|execSync|spawnSync|writeFile)/i, reason: 'Выполнение потенциально разрушительного inline-скрипта Node.js.' },
  { re: /\b(?:curl|wget|irm|invoke-webrequest|invoke-restmethod)\b[^\n]*(?:-X\s*(?:POST|PUT|PATCH|DELETE)|--data|-d\s|-Method\s+(?:POST|PUT|PATCH|DELETE))/i, reason: 'Сетевой запрос с изменением данных.' },
  { re: /\b(?:curl|wget|irm|iwr)\b[^\n]*\|\s*(?:sh|bash|zsh|pwsh|powershell|iex|invoke-expression)\b/i, reason: 'Скачивание и немедное выполнение удалённого скрипта.' },
  { re: /\b(?:send-mailmessage|sendmail|format|mkfs|dd\s+if=|reg\s+delete|shutdown|reboot)\b/i, reason: 'Опасная системная или внешняя команда.' }
]

const PATH_LIKE_TOKEN_RE = /^(?:~(?:[/\\]|$)|[a-zA-Z]:[/\\]|\.\.(?:[/\\]|$)|.*[/\\]\.\.(?:[/\\]|$)|\/(?:[^/\s]+\/|etc|usr|var|home|root|tmp|opt|proc|sys|mnt|bin|sbin|dev|Users|Windows|Program))/i

function isExternalPathToken(rawToken: string, workspaceRoot: string): string | null {
  let token = rawToken.trim()
  if (!token || /^https?:\/\//i.test(token)) return null
  if (token.startsWith('--') && token.includes('=')) {
    token = token.slice(token.indexOf('=') + 1)
  }
  if (/^\/[a-zA-Z]{1,3}$/.test(token)) return null // Windows slash switches like /F, /T, /s
  if (!PATH_LIKE_TOKEN_RE.test(token)) return null
  if (token === '/dev/null') return null

  const resolved = token === '~' || token.startsWith('~/') || token.startsWith('~\\')
    ? path.resolve(os.homedir(), token.slice(2))
    : path.isAbsolute(token)
      ? path.resolve(token)
      : path.resolve(workspaceRoot, token)
  const rel = path.relative(path.resolve(workspaceRoot), resolved)
  if (rel === '..' || rel.startsWith(`..${path.sep}`) || path.isAbsolute(rel)) {
    return resolved
  }
  return null
}

function findExternalPaths(segments: string[], workspacePath?: string): string[] {
  if (!workspacePath || !workspacePath.trim()) return []
  const root = path.resolve(workspacePath)
  const found: string[] = []
  for (const segment of segments) {
    const tokens = tokenizeSegment(segment)
    const bin = (tokens[0] || '').toLowerCase().replace(/\.exe$/, '')
    const isInlineCode = INTERPRETER_BINS.has(bin) && tokens.some((t) => /^(-c|-e|--eval|-command|-c)$/i.test(t))
    for (let i = 1; i < tokens.length; i++) {
      const tok = tokens[i]
      if (isInlineCode && (tok.includes(' ') || tok.includes(';'))) continue
      const ext = isExternalPathToken(tok, root)
      if (ext && !found.includes(ext)) found.push(ext)
    }
  }
  return found
}

function isReadOnlySegment(segment: string): boolean {
  if (/[<>]|\$\(|`/.test(segment)) return false
  const tokens = tokenizeSegment(segment)
  if (!tokens.length) return true
  const bin = tokens[0].toLowerCase().replace(/\.exe$/, '')
  if (READ_ONLY_BINS.has(bin)) return true
  if (VERSION_ONLY_BINS.has(bin) && tokens.length === 2 && /^(-v|--version|-V)$/.test(tokens[1])) return true
  if (bin === 'git') {
    let i = 1
    while (i < tokens.length && tokens[i].startsWith('-')) {
      const flag = tokens[i]
      i += flag === '-C' || flag === '-c' || flag === '--git-dir' || flag === '--work-tree' ? 2 : 1
    }
    const sub = tokens[i]?.toLowerCase()
    if (!sub) return true
    if (sub === 'branch' && tokens.some((t) => /^(-d|-D|-m|-M|--delete|--move)$/.test(t))) return false
    if (sub === 'tag' && tokens.some((t) => /^(-d|--delete|-a|-s)$/.test(t))) return false
    if (sub === 'remote' && tokens.some((t) => /^(add|remove|rm|set-url|rename)$/i.test(t))) return false
    return READ_ONLY_GIT_SUBCOMMANDS.has(sub)
  }
  return false
}

function sanitizeSegmentForDangerCheck(segment: string): string {
  const tokens = tokenizeSegment(segment)
  const bin = (tokens[0] || '').toLowerCase().replace(/\.exe$/, '')
  // Keep full quoted contents for interpreters/pipes, strip quoted string literals
  // for search/commit/echo commands so message text never triggers false positives.
  if (INTERPRETER_BINS.has(bin)) return segment
  if (bin === 'curl' || bin === 'wget' || bin === 'irm' || bin === 'iwr') return segment
  return stripQuotedText(segment)
}

export function classifyCommand(command: string, workspacePath?: string): CommandAssessment {
  const segments = splitShellSegments(command)
  const sanitizedCommand = segments.map(sanitizeSegmentForDangerCheck).join(' ; ')
  const externalPaths = findExternalPaths(segments, workspacePath)
  const netMatch = NETWORK_PATTERNS.find(({ re }) => re.test(sanitizedCommand) || re.test(command))
  const networkFields = netMatch ? { requiresNetwork: true, networkReason: netMatch.reason } : { requiresNetwork: false }

  for (const { re, reason } of DANGEROUS_PATTERNS) {
    if (re.test(sanitizedCommand)) {
      return {
        risk: 'dangerous',
        requiresConfirmation: true,
        ...networkFields,
        reason,
        segments,
        ...(externalPaths.length ? { externalPaths } : {})
      }
    }
  }

  // Catch curl ... | bash across pipeline segments even when sanitized per-segment
  if (/\b(?:curl|wget|irm|iwr)\b[^\n]*\|\s*(?:sh|bash|zsh|pwsh|powershell|iex|invoke-expression)\b/i.test(command)) {
    return {
      risk: 'dangerous',
      requiresConfirmation: true,
      requiresNetwork: true,
      networkReason: 'Скачивание и немедленное выполнение удалённого скрипта.',
      reason: 'Скачивание и немедленное выполнение удалённого скрипта.',
      segments,
      ...(externalPaths.length ? { externalPaths } : {})
    }
  }

  const isReadOnly = segments.length > 0 && segments.every(isReadOnlySegment)
  if (externalPaths.length > 0) {
    return {
      risk: isReadOnly ? 'read_only' : 'workspace_write',
      requiresConfirmation: true,
      ...networkFields,
      reason: 'Команда обращается к пути за пределами рабочей папки.',
      segments,
      externalPaths
    }
  }

  if (isReadOnly) {
    return { risk: 'read_only', requiresConfirmation: false, ...networkFields, segments }
  }
  return { risk: 'workspace_write', requiresConfirmation: false, ...networkFields, segments }
}

export function requiresConfirmation(command: string, workspacePath?: string): boolean {
  return classifyCommand(command, workspacePath).requiresConfirmation
}
