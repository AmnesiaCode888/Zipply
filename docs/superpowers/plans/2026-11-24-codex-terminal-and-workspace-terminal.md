# Codex-Grade AI Terminal & Live Workspace Panel Terminal Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace Zipply's fragmented `spawn`-based terminal/process tools with a unified Codex-grade PTY terminal engine (`exec_command` + `write_stdin`) and add a live interactive Terminal tab to the right `WorkspacePanel` that mirrors everything the AI runs in real time alongside user shells.

**Architecture:** A single `TerminalSessionManager` in the Electron main process owns all PTY sessions (both AI-initiated and user-initiated), backed by `node-pty` with a deterministic `child_process.spawn` fallback for headless tests. AI tools (`exec_command`, `write_stdin`, plus backwards-compatible `terminal`/`process_*` adapters) consume normalized, ANSI-stripped, spill-to-disk output with `yield_time_ms` auto-backgrounding and AST-based `CommandPolicy`, while `TerminalIpcHandler` streams raw ANSI deltas over IPC to an `@xterm/xterm` view inside `WorkspacePanel` that auto-follows active AI commands and lets users run their own shells or intervene (`Ctrl+C` / stdin).

**Tech Stack:** Electron 33, TypeScript 5.9, React 18, Tailwind CSS, `node-pty` (ConPTY/PTY), `@xterm/xterm`, `@xterm/addon-fit`, `@xterm/addon-web-links`, `node:test` + `esbuild`.

## Global Constraints

- **Design system (`AGENTS.md` / Apple Minimalist Design):** Zero shadows (`shadow-none`, `boxShadow: 'none'`). Zero harsh white borders and zero focus-highlight borders (`border-none` or static `border-[0.5px] border-white/[0.03]`). Continuous squircles (`rounded-[14px]`–`rounded-[24px]`, circular/pill buttons `rounded-full`). Monochrome obsidian palette: `#0E0E0E` sidebar/panel, `#0A0A0A` terminal canvas, `#161616` cards/headers, `#222222` inactive pills, `#2C2C2C` / `bg-white/[0.04]` hover, `#FFFFFF` active actions.
- **Cross-platform:** Must work on Windows (`pwsh.exe` → `powershell.exe` fallback, ConPTY) and macOS/Linux (`$SHELL` → `/bin/bash` → `/bin/sh`, POSIX PTY).
- **Testability:** Every task must pass `npm run typecheck` and `node --test tests/<test>.test.cjs` without requiring a live GUI or native PTY build if `node-pty` is unavailable (graceful spawn fallback).
- **Backwards compatibility:** Existing `terminal`, `run_command`, `process_start`, `process_poll`, `process_stop`, `process_list` tool names and existing `tests/process-manager.test.cjs`, `tests/process-tool.test.cjs`, `tests/workspace-tabs.test.cjs` must continue passing.
- **Security:** `cwd` must always be validated via `inspectWorkspacePath` (no silent escape outside workspace). Sensitive env vars must be stripped before spawning child shells.

---

## File Map

**Create:**
- `src/shared/terminal.ts` — Shared types for terminal sessions, snapshots, deltas, IPC payloads, and AI/user origin metadata.
- `src/main/agent/services/TerminalOutputNormalizer.ts` — UTF-8 safe decoding, ANSI stripping, `\r` progress-bar collapsing, head/tail truncation, and spill-to-disk log persistence.
- `src/main/agent/services/TerminalSessionManager.ts` — Unified PTY session lifecycle manager (`node-pty` + `spawn` fallback), env sanitization, shell detection, debounced waiting (`yield_time_ms`), ring buffer for xterm replay, and live event emitter.
- `src/main/agent/tools/ExecCommandTool.ts` — Codex-style `exec_command` tool (auto-yields to background session, supports `yield_time_ms`, `tty`, `workdir`).
- `src/main/agent/tools/WriteStdinTool.ts` — Codex-style `write_stdin` tool (send chars, `SIGINT`/`SIGKILL`, or poll with quiet-window debounce + `tail_lines`).
- `src/main/ipc/TerminalIpcHandler.ts` — Electron IPC bridge for `terminal:list`, `terminal:create`, `terminal:attach`, `terminal:write`, `terminal:resize`, `terminal:signal`, `terminal:close`, and push `terminal:event`.
- `src/renderer/src/hooks/useTerminalSessions.ts` — React hook subscribing to `window.api.terminal` events, tracking AI + user sessions per chat, and managing `followAI` auto-selection.
- `src/renderer/src/components/layout/WorkspaceTerminal.tsx` — Apple Minimalist `@xterm/xterm` terminal panel with AI/User session switcher, live AI activity header, Follow-AI toggle, Stop/Ctrl+C, and `+ Новый терминал`.
- `tests/terminal-output-normalizer.test.cjs` — Unit tests for ANSI stripping, `\r` collapsing, truncation, and spill-to-disk.
- `tests/command-policy.test.cjs` — Unit tests for AST/tokenizer command classification (`read_only` / `workspace_write` / `dangerous`).
- `tests/terminal-session-manager.test.cjs` — Unit tests for session lifecycle, `yield_time_ms` auto-backgrounding, stdin/SIGINT, live events, and owner isolation.
- `tests/exec-command-tools.test.cjs` — Unit tests for `exec_command`, `write_stdin`, and `ToolExecutor` `noTruncate` + `cwd` security fixes.

**Modify:**
- `package.json` — Add `node-pty`, `@xterm/xterm`, `@xterm/addon-fit`, `@xterm/addon-web-links`.
- `src/main/agent/core/CommandPolicy.ts` — Upgrade from 3-line regex to shell tokenizer + risk classifier (`classifyCommand` + `requiresConfirmation`).
- `src/main/agent/core/ToolExecutor.ts` — Respect `toolRes.noTruncate`, enforce `cwd` `inspectWorkspacePath` for command tools, allow `read_only` commands in `planMode` / `read-only` without clearing `resultCache`.
- `src/main/agent/core/PromptProviders.ts` — Fix hardcoded `Windows` OS, inject real OS + shell, update `<tool_guidelines>` for `exec_command` / `write_stdin`.
- `src/main/agent/tools/TerminalTool.ts` — Route through `TerminalSessionManager` so legacy `terminal` / `run_command` calls mirror live to the side panel and inherit UTF-8/exit-code/cwd fixes.
- `src/main/agent/tools/ToolRegistry.ts` & `src/main/agent/index.ts` — Register `exec_command` and `write_stdin` on `ZipplyAgent`.
- `src/main/ipc/AgentIpcHandler.ts` — Clean up terminal sessions on `agent:discardSession` / window destroy.
- `src/main/index.ts` — Register `TerminalIpcHandler` and call `terminalSessionManager.shutdown()` in `before-quit`.
- `src/preload/index.ts` — Expose `window.api.terminal` methods and `onEvent`.
- `src/renderer/src/hooks/useWorkspaceTabs.ts` — Add `type: 'terminal'` tab support and persistence validation.
- `src/renderer/src/components/layout/WorkspacePanel.tsx` — Enable the `"Терминал"` button (remove `disabled` / `"Скоро"`), render `WorkspaceTerminal`, and display live AI running indicator on terminal tab.
- `src/renderer/src/components/layout/AppLayout.tsx` — Wire terminal tab actions and cross-component "Open in Terminal" trigger from chat cards.
- `src/renderer/src/components/tools/TerminalTool.tsx` — Show `exitCode`, elapsed time, and an `"Открыть в терминале"` button linking to the live session in `WorkspacePanel`.

---

### Task 1: Shared Terminal Types & Dependencies

**Files:**
- Modify: `package.json`
- Create: `src/shared/terminal.ts`

**Interfaces:**
- Produces: `TerminalSessionOrigin`, `TerminalSessionStatus`, `TerminalOwner`, `TerminalSessionSummary`, `TerminalSessionSnapshot`, `TerminalEvent` in `src/shared/terminal.ts`.

- [ ] **Step 1: Install dependencies**

Run:
```bash
npm install node-pty @xterm/xterm @xterm/addon-fit @xterm/addon-web-links
```
Note: If `node-pty` fails native rebuild on the local machine during `npm install`, keep it as an `optionalDependency` or rebuild with `npx @electron/rebuild -f -w node-pty` — `TerminalSessionManager` in Task 4 will cleanly fall back to `spawn` when `node-pty` cannot be required.

- [ ] **Step 2: Create `src/shared/terminal.ts`**

```ts
export type TerminalSessionOrigin = 'ai' | 'user'
export type TerminalSessionStatus = 'starting' | 'running' | 'exited' | 'failed' | 'stopped'

export interface TerminalOwner {
  senderId: number
  sessionId: string
  workspace: string
}

export interface TerminalSessionSummary {
  id: string
  origin: TerminalSessionOrigin
  title: string
  command: string
  cwd: string
  shell: string
  tty: boolean
  status: TerminalSessionStatus
  exitCode: number | null
  signal: string | null
  startedAt: number
  endedAt?: number
  toolCallId?: string
}

export interface TerminalSessionSnapshot extends TerminalSessionSummary {
  /** Raw VT100/ANSI ring buffer for xterm.js replay on attach */
  rawBuffer: string
  /** Current monotonic character offset in the raw stream */
  rawCursor: number
}

export type TerminalEvent =
  | { type: 'session_created'; session: TerminalSessionSummary }
  | { type: 'session_output'; terminalId: string; chunk: string; cursor: number }
  | {
      type: 'session_state'
      terminalId: string
      status: TerminalSessionStatus
      exitCode: number | null
      signal: string | null
      endedAt?: number
    }
  | { type: 'session_closed'; terminalId: string }
```

- [ ] **Step 3: Verify typecheck**

Run: `npm run typecheck`
Expected: PASS (exit code 0)

- [ ] **Step 4: Commit**

```bash
git add package.json package-lock.json src/shared/terminal.ts
git commit -m "feat(terminal): add shared terminal types and xterm/pty dependencies"
```

---

### Task 2: LLM Output Normalizer & Spill-to-Disk Log Store

**Files:**
- Create: `src/main/agent/services/TerminalOutputNormalizer.ts`
- Test: `tests/terminal-output-normalizer.test.cjs`

**Interfaces:**
- Produces:
  - `stripAnsi(text: string): string`
  - `normalizeTerminalText(raw: string): string`
  - `formatForLlm(raw: string, options?: { maxLines?: number; maxChars?: number; spillDir?: string; sessionId?: string }): Promise<{ text: string; truncated: boolean; logPath?: string }>`

- [ ] **Step 1: Write the failing test in `tests/terminal-output-normalizer.test.cjs`**

```js
const { test } = require('node:test')
const assert = require('node:assert/strict')
const { buildSync } = require('esbuild')
const Module = require('node:module')
const path = require('node:path')
const fs = require('node:fs/promises')
const os = require('node:os')

function load(file) {
  const r = buildSync({ entryPoints: [file], bundle: true, platform: 'node', format: 'cjs', write: false, packages: 'external' })
  const m = new Module(path.resolve(file), module)
  m.filename = path.resolve(file); m.paths = module.paths
  m._compile(r.outputFiles[0].text, m.filename)
  return m.exports
}

test('normalizeTerminalText strips ANSI escapes and collapses carriage-return progress bars', () => {
  const { normalizeTerminalText } = load('src/main/agent/services/TerminalOutputNormalizer.ts')
  const raw = '\x1b[32mBuilding\x1b[0m\r\n10%\r50%\r100% done\n\x1b]0;Window Title\x07OK'
  assert.equal(normalizeTerminalText(raw), 'Building\n100% done\nOK')
})

test('formatForLlm preserves head+tail and spills full log to disk when oversized', async () => {
  const { formatForLlm } = load('src/main/agent/services/TerminalOutputNormalizer.ts')
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'zipply-norm-'))
  try {
    const lines = Array.from({ length: 400 }, (_, i) => `line-${i + 1}: payload`)
    const res = await formatForLlm(lines.join('\n'), { maxLines: 100, maxChars: 10000, spillDir: tmpDir, sessionId: 'term-1' })
    assert.equal(res.truncated, true)
    assert.ok(res.logPath)
    assert.match(res.text, /line-1: payload/)
    assert.match(res.text, /line-400: payload/)
    assert.match(res.text, /Полный лог сохранён:/)
    const full = await fs.readFile(res.logPath, 'utf8')
    assert.equal(full.split('\n').length, 400)
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true })
  }
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/terminal-output-normalizer.test.cjs`
Expected: FAIL (`Could not resolve "src/main/agent/services/TerminalOutputNormalizer.ts"`)

- [ ] **Step 3: Implement `src/main/agent/services/TerminalOutputNormalizer.ts`**

```ts
import * as fs from 'fs/promises'
import * as os from 'os'
import * as path from 'path'

// CSI sequences, OSC sequences (BEL or ST terminated), and single-char ESC codes
const ANSI_REGEX = /\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|\x1b\[[0-?]*[ -/]*[@-~]|\x1b[@-Z\\-_]/g

export function stripAnsi(text: string): string {
  return text.replace(ANSI_REGEX, '')
}

/**
 * Normalizes raw PTY/pipe output for LLM consumption:
 * - Strips ANSI/VT100 escape codes
 * - Converts CRLF to LF
 * - Resolves bare CR (\r) progress-bar overwrites by keeping the final segment per line
 */
export function normalizeTerminalText(raw: string): string {
  if (!raw) return ''
  const clean = stripAnsi(raw).replace(/\r\n/g, '\n')
  return clean
    .split('\n')
    .map((line) => {
      if (!line.includes('\r')) return line
      const parts = line.split('\r')
      for (let i = parts.length - 1; i >= 0; i--) {
        if (parts[i].length > 0) return parts[i]
      }
      return ''
    })
    .join('\n')
}

export interface FormatForLlmOptions {
  maxLines?: number
  maxChars?: number
  spillDir?: string
  sessionId?: string
}

export async function formatForLlm(
  raw: string,
  options: FormatForLlmOptions = {}
): Promise<{ text: string; truncated: boolean; logPath?: string }> {
  const maxLines = options.maxLines ?? 220
  const maxChars = options.maxChars ?? 16000
  const normalized = normalizeTerminalText(raw)
  const lines = normalized.split('\n')

  if (lines.length <= maxLines && normalized.length <= maxChars) {
    return { text: normalized, truncated: false }
  }

  let logPath: string | undefined
  try {
    const dir = options.spillDir || path.join(os.tmpdir(), 'zipply-terminal-logs')
    await fs.mkdir(dir, { recursive: true })
    const safeId = (options.sessionId || `cmd-${Date.now()}`).replace(/[^a-zA-Z0-9_-]/g, '_')
    logPath = path.join(dir, `${safeId}.log`)
    await fs.writeFile(logPath, normalized, 'utf8')
  } catch {
    // Spill-to-disk is best-effort; truncation still protects LLM context.
  }

  let result = normalized
  if (lines.length > maxLines) {
    const headCount = Math.max(20, Math.floor(maxLines * 0.3))
    const tailCount = Math.max(40, maxLines - headCount)
    const omitted = lines.length - headCount - tailCount
    if (omitted > 0) {
      result = [
        ...lines.slice(0, headCount),
        `\n... [пропущено ${omitted} строк вывода] ...\n`,
        ...lines.slice(lines.length - tailCount)
      ].join('\n')
    }
  }

  if (result.length > maxChars) {
    const headChars = Math.floor((maxChars - 240) * 0.35)
    const tailChars = Math.max(200, maxChars - 240 - headChars)
    const omittedChars = result.length - headChars - tailChars
    result = `${result.slice(0, headChars)}\n\n... [пропущено ${omittedChars} символов] ...\n\n${result.slice(-tailChars)}`
  }

  const notice = logPath ? `\n[Полный лог сохранён: ${logPath}]` : ''
  return { text: result + notice, truncated: true, logPath }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/terminal-output-normalizer.test.cjs`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/main/agent/services/TerminalOutputNormalizer.ts tests/terminal-output-normalizer.test.cjs
git commit -m "feat(terminal): add ANSI/CR output normalizer with spill-to-disk logging"
```

---

### Task 3: AST/Tokenizer Shell Command Policy (`CommandPolicy.ts`)

**Files:**
- Modify: `src/main/agent/core/CommandPolicy.ts`
- Test: `tests/command-policy.test.cjs`

**Interfaces:**
- Produces:
  - `export type CommandRisk = 'read_only' | 'workspace_write' | 'dangerous'`
  - `export interface CommandAssessment { risk: CommandRisk; requiresConfirmation: boolean; reason?: string; segments: string[] }`
  - `export function classifyCommand(command: string): CommandAssessment`
  - `export function requiresConfirmation(command: string): boolean` (backwards-compatible)

- [ ] **Step 1: Write the failing test in `tests/command-policy.test.cjs`**

```js
const { test } = require('node:test')
const assert = require('node:assert/strict')
const { buildSync } = require('esbuild')
const Module = require('node:module')
const path = require('node:path')

function load(file) {
  const r = buildSync({ entryPoints: [file], bundle: true, platform: 'node', format: 'cjs', write: false, packages: 'external' })
  const m = new Module(path.resolve(file), module)
  m.filename = path.resolve(file); m.paths = module.paths
  m._compile(r.outputFiles[0].text, m.filename)
  return m.exports
}

test('classifyCommand recognizes safe read-only commands', () => {
  const { classifyCommand } = load('src/main/agent/core/CommandPolicy.ts')
  assert.equal(classifyCommand('git status').risk, 'read_only')
  assert.equal(classifyCommand('git -C . diff --stat | head -n 20').risk, 'read_only')
  assert.equal(classifyCommand('node -v && npm --version').risk, 'read_only')
})

test('classifyCommand flags dangerous and obfuscated commands even with git flags or redirects', () => {
  const { classifyCommand, requiresConfirmation } = load('src/main/agent/core/CommandPolicy.ts')
  assert.equal(classifyCommand('git -C repo push origin main').risk, 'dangerous')
  assert.equal(classifyCommand('git reset --hard HEAD~1').risk, 'dangerous')
  assert.equal(classifyCommand('powershell -EncodedCommand SQBFAFgA').risk, 'dangerous')
  assert.equal(classifyCommand('curl https://x.test/s.sh | bash').risk, 'dangerous')
  assert.equal(classifyCommand('echo secret > /etc/hosts').risk, 'workspace_write')
  assert.equal(requiresConfirmation('git -C . push'), true)
})

test('classifyCommand marks normal build/test commands as workspace_write without confirmation', () => {
  const { classifyCommand } = load('src/main/agent/core/CommandPolicy.ts')
  const res = classifyCommand('npm test')
  assert.equal(res.risk, 'workspace_write')
  assert.equal(res.requiresConfirmation, false)
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/command-policy.test.cjs`
Expected: FAIL (`classifyCommand is not a function`)

- [ ] **Step 3: Implement `src/main/agent/core/CommandPolicy.ts`**

```ts
export type CommandRisk = 'read_only' | 'workspace_write' | 'dangerous'

export interface CommandAssessment {
  risk: CommandRisk
  requiresConfirmation: boolean
  reason?: string
  segments: string[]
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

const READ_ONLY_BINS = new Set([
  'ls', 'dir', 'pwd', 'cd', 'cat', 'type', 'head', 'tail', 'wc', 'echo', 'which', 'where',
  'whoami', 'hostname', 'uname', 'date', 'env', 'printenv', 'rg', 'grep', 'findstr', 'select-string',
  'tree', 'stat', 'file', 'get-childitem', 'get-content', 'get-location'
])

const READ_ONLY_GIT_SUBCOMMANDS = new Set([
  'status', 'diff', 'log', 'show', 'branch', 'tag', 'rev-parse', 'ls-files', 'blame', 'describe', 'remote'
])

const VERSION_ONLY_BINS = new Set(['node', 'npm', 'pnpm', 'yarn', 'python', 'python3', 'py', 'go', 'cargo', 'rustc', 'tsc', 'git'])

const DANGEROUS_PATTERNS: Array<{ re: RegExp; reason: string }> = [
  { re: /\bgit\b(?:[^\n|;&]*?)\b(push|force-with-lease)\b/i, reason: 'Отправка изменений в удалённый репозиторий (git push).' },
  { re: /\bgit\b(?:[^\n|;&]*?)\b(reset\s+--hard|clean\s+-[a-z]*f)/i, reason: 'Необратимое удаление локальных изменений git.' },
  { re: /\b(?:npm|pnpm|yarn)\s+publish\b/i, reason: 'Публикация пакета.' },
  { re: /\b(?:rm|rmdir|del|erase)\b[^\n]*(?:-r|-R|\/s|--recursive)/i, reason: 'Рекурсивное удаление файлов.' },
  { re: /\bremove-item\b[^\n]*-recurse/i, reason: 'Рекурсивное удаление файлов (Remove-Item).' },
  { re: /\b(?:powershell|pwsh)(?:\.exe)?\b[^\n]*-(?:e|enc|encodedcommand)\b/i, reason: 'Запуск закодированной команды PowerShell.' },
  { re: /\b(?:curl|wget|irm|invoke-webrequest|invoke-restmethod)\b[^\n]*(?:-X\s*(?:POST|PUT|PATCH|DELETE)|--data|-d\s|-Method\s+(?:POST|PUT|PATCH|DELETE))/i, reason: 'Сетевой запрос с изменением данных.' },
  { re: /\b(?:curl|wget|irm|iwr)\b[^\n]*\|\s*(?:sh|bash|zsh|pwsh|powershell|iex|invoke-expression)\b/i, reason: 'Скачивание и немедленное выполнение удалённого скрипта.' },
  { re: /\b(?:send-mailmessage|sendmail|format|mkfs|dd\s+if=|reg\s+delete|shutdown|reboot)\b/i, reason: 'Опасная системная или внешняя команда.' }
]

function isReadOnlySegment(segment: string): boolean {
  // Redirections, subshells, or assignment writes are not read-only
  if (/[<>]|\$\(|`/.test(segment)) return false
  const tokens = tokenizeSegment(segment)
  if (!tokens.length) return true
  const bin = tokens[0].toLowerCase().replace(/\.exe$/, '')
  if (READ_ONLY_BINS.has(bin)) return true
  if (VERSION_ONLY_BINS.has(bin) && tokens.length === 2 && /^(-v|--version|-V)$/.test(tokens[1])) return true
  if (bin === 'git') {
    // Skip global git flags like -C <dir>, --no-pager, -c k=v
    let i = 1
    while (i < tokens.length && tokens[i].startsWith('-')) {
      const flag = tokens[i]
      i += (flag === '-C' || flag === '-c' || flag === '--git-dir' || flag === '--work-tree') ? 2 : 1
    }
    const sub = tokens[i]?.toLowerCase()
    if (!sub) return true
    if (sub === 'branch' && tokens.some(t => /^(-d|-D|-m|-M|--delete|--move)$/.test(t))) return false
    if (sub === 'tag' && tokens.some(t => /^(-d|--delete|-a|-s)$/.test(t))) return false
    if (sub === 'remote' && tokens.some(t => /^(add|remove|rm|set-url|rename)$/i.test(t))) return false
    return READ_ONLY_GIT_SUBCOMMANDS.has(sub)
  }
  return false
}

export function classifyCommand(command: string): CommandAssessment {
  const segments = splitShellSegments(command)
  for (const { re, reason } of DANGEROUS_PATTERNS) {
    if (re.test(command)) {
      return { risk: 'dangerous', requiresConfirmation: true, reason, segments }
    }
  }
  if (segments.length > 0 && segments.every(isReadOnlySegment)) {
    return { risk: 'read_only', requiresConfirmation: false, segments }
  }
  return { risk: 'workspace_write', requiresConfirmation: false, segments }
}

export function requiresConfirmation(command: string): boolean {
  return classifyCommand(command).requiresConfirmation
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/command-policy.test.cjs`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/main/agent/core/CommandPolicy.ts tests/command-policy.test.cjs
git commit -m "feat(security): upgrade CommandPolicy with shell segment parser and risk classification"
```

---

### Task 4: Unified PTY `TerminalSessionManager`

**Files:**
- Create: `src/main/agent/services/TerminalSessionManager.ts`
- Test: `tests/terminal-session-manager.test.cjs`

**Interfaces:**
- Consumes: `src/shared/terminal.ts`, `src/main/agent/services/TerminalOutputNormalizer.ts`
- Produces:
  - `export class TerminalSessionManager extends EventEmitter`
  - `detectDefaultShell(): { shell: string; name: string }`
  - `sanitizeEnv(baseEnv: NodeJS.ProcessEnv, tty: boolean): Record<string, string>`
  - `startCommand(options: StartCommandOptions): Promise<{ session: TerminalSessionSummary; output: string; rawCursor: number; truncated: boolean; logPath?: string }>`
  - `startInteractiveShell(owner: TerminalOwner, cwd: string, cols?: number, rows?: number): Promise<TerminalSessionSnapshot>`
  - `writeInput(owner: TerminalOwner, id: string, chars: string, options?: { yieldTimeMs?: number; tailLines?: number; signal?: 'SIGINT' | 'SIGKILL' }, abortSignal?: AbortSignal): Promise<{ session: TerminalSessionSummary; output: string; truncated: boolean; logPath?: string }>`
  - `writeUserInput(owner: TerminalOwner, id: string, chars: string): void`
  - `resize(owner: TerminalOwner, id: string, cols: number, rows: number): void`
  - `sendSignal(owner: TerminalOwner, id: string, signal: 'SIGINT' | 'SIGKILL'): Promise<void>`
  - `attach(owner: TerminalOwner, id: string): TerminalSessionSnapshot`
  - `list(owner: TerminalOwner): TerminalSessionSummary[]`
  - `close(owner: TerminalOwner, id: string): Promise<void>`
  - `stopSession(senderId: number, sessionId: string): Promise<void>`
  - `stopSender(senderId: number): Promise<void>`
  - `shutdown(): Promise<void>`
  - `export const terminalSessionManager: TerminalSessionManager`

- [ ] **Step 1: Write the failing test in `tests/terminal-session-manager.test.cjs`**

```js
const { test } = require('node:test')
const assert = require('node:assert/strict')
const { buildSync } = require('esbuild')
const Module = require('node:module')
const path = require('node:path')

function load(file) {
  const r = buildSync({ entryPoints: [file], bundle: true, platform: 'node', format: 'cjs', write: false, packages: 'external' })
  const m = new Module(path.resolve(file), module)
  m.filename = path.resolve(file); m.paths = module.paths
  m._compile(r.outputFiles[0].text, m.filename)
  return m.exports
}

test('startCommand returns immediately when command finishes within yieldTimeMs', async () => {
  const { TerminalSessionManager } = load('src/main/agent/services/TerminalSessionManager.ts')
  const mgr = new TerminalSessionManager({ forceSpawnFallback: true })
  const owner = { senderId: 1, sessionId: 'chat-1', workspace: process.cwd() }
  try {
    const res = await mgr.startCommand({
      owner,
      command: 'node -e "console.log(\'hello-zipply\')"',
      cwd: process.cwd(),
      yieldTimeMs: 5000
    })
    assert.equal(res.session.status, 'exited')
    assert.equal(res.session.exitCode, 0)
    assert.match(res.output, /hello-zipply/)
  } finally {
    await mgr.shutdown()
  }
})

test('startCommand auto-backgrounds long commands and writeInput can interact & stop them', async () => {
  const { TerminalSessionManager } = load('src/main/agent/services/TerminalSessionManager.ts')
  const mgr = new TerminalSessionManager({ forceSpawnFallback: true })
  const owner = { senderId: 1, sessionId: 'chat-2', workspace: process.cwd() }
  const events = []
  mgr.on('terminal_event', (_owner, evt) => events.push(evt.type))
  try {
    const started = await mgr.startCommand({
      owner,
      command: 'node -e "console.log(\'ready\'); process.stdin.on(\'data\', d => { console.log(\'GOT:\' + d.toString().trim()); process.exit(0) })"',
      cwd: process.cwd(),
      yieldTimeMs: 600,
      tty: false
    })
    assert.equal(started.session.status, 'running')
    assert.ok(events.includes('session_created'))
    assert.ok(events.includes('session_output'))

    const replied = await mgr.writeInput(owner, started.session.id, 'ping\n', { yieldTimeMs: 3000 })
    assert.equal(replied.session.status, 'exited')
    assert.match(replied.output, /GOT:ping/)
  } finally {
    await mgr.shutdown()
  }
})

test('sanitizeEnv strips sensitive API keys and tokens', () => {
  const { sanitizeEnv } = load('src/main/agent/services/TerminalSessionManager.ts')
  const env = sanitizeEnv({ PATH: '/bin', OPENAI_API_KEY: 'sk-123', ZIPPLY_TOKEN: 'secret', HOME: '/home/u' }, true)
  assert.equal(env.OPENAI_API_KEY, undefined)
  assert.equal(env.ZIPPLY_TOKEN, undefined)
  assert.equal(env.TERM, 'xterm-256color')
  assert.equal(env.HOME, '/home/u')
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/terminal-session-manager.test.cjs`
Expected: FAIL (`Could not resolve "src/main/agent/services/TerminalSessionManager.ts"`)

- [ ] **Step 3: Implement `src/main/agent/services/TerminalSessionManager.ts`**

Key implementation details to include verbatim:
- Dynamic `require('node-pty')` wrapped in `try/catch` (plus `forceSpawnFallback` constructor option for deterministic tests).
- `detectDefaultShell()`: on Windows checks `pwsh.exe` via `where` (cached) and falls back to `powershell.exe`; on Unix uses `process.env.SHELL || '/bin/bash'`.
- PowerShell wrapper that preserves `$LASTEXITCODE` accurately without `Add-Type` C# compilation:
  ```powershell
  [Console]::OutputEncoding = [System.Text.UTF8Encoding]::UTF8; $OutputEncoding = [System.Text.UTF8Encoding]::UTF8; & { <command> }; if (-not $?) { if ($LASTEXITCODE -and $LASTEXITCODE -ne 0) { exit $LASTEXITCODE } else { exit 1 } }; exit 0
  ```
- `sanitizeEnv(baseEnv, tty)`: copies `baseEnv`, deletes keys matching `/(?:^|_)(API_KEY|SECRET|TOKEN|PASSWORD|PRIVATE_KEY|COOKIE)$/i` unless explicitly safe (`TERM`, `COLORTERM`), sets `PYTHONIOENCODING=utf-8`, `TERM = tty ? 'xterm-256color' : 'dumb'`, `DEBIAN_FRONTEND=noninteractive`, `CI=true` (for AI commands; omitted for interactive user shells so prompts/colors feel native!).
- Ring buffer (`MAX_RAW_BUFFER = 512 * 1024` chars) per session so `attach()` replays full ANSI history to `xterm.js` even if the user opens the side panel *after* the AI started a command.
- Monotonic `rawCursor` and per-session `llmCursor` so `writeInput` returns only new normalized output since last read, with a **180ms quiet-window debounce** after first new data arrives (so noisy builds batch cleanly instead of waking on every single byte).
- Graceful stop: `SIGINT` / `\x03` first, then `SIGKILL` / `taskkill /pid <pid> /T /F` after 2s timeout, plus a 500ms fallback resolve after `exit` if stdio handles stay open.
- Strict `sameOwner(a, b)` check on every method so chats/windows never access each other's terminals.
- Emit `'terminal_event', entry.owner, event` on every `session_created`, `session_output`, `session_state`, `session_closed`.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/terminal-session-manager.test.cjs`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/main/agent/services/TerminalSessionManager.ts tests/terminal-session-manager.test.cjs
git commit -m "feat(terminal): implement unified PTY TerminalSessionManager with spawn fallback"
```

---

### Task 5: Codex-Style Tools (`exec_command`, `write_stdin`) & Harness Fixes

**Files:**
- Create: `src/main/agent/tools/ExecCommandTool.ts`
- Create: `src/main/agent/tools/WriteStdinTool.ts`
- Modify: `src/main/agent/tools/TerminalTool.ts`
- Modify: `src/main/agent/core/ToolExecutor.ts:246-360`
- Modify: `src/main/agent/core/PromptProviders.ts:36-69`
- Modify: `src/main/agent/tools/ToolRegistry.ts`
- Modify: `src/main/agent/index.ts`
- Test: `tests/exec-command-tools.test.cjs`

**Interfaces:**
- Consumes: `terminalSessionManager`, `classifyCommand`, `inspectWorkspacePath`
- Produces:
  - `ExecCommandTool` (`name = 'exec_command'`, params: `command`, `cwd?`, `yield_time_ms?`, `tty?`)
  - `WriteStdinTool` (`name = 'write_stdin'`, params: `session_id`, `chars?`, `yield_time_ms?`, `tail_lines?`, `signal?`)
  - `ToolResult.data` includes `{ terminalSessionId, exitCode, status, elapsedMs, command, cwd, logPath? }`

- [ ] **Step 1: Write the failing test in `tests/exec-command-tools.test.cjs`**

```js
const { test } = require('node:test')
const assert = require('node:assert/strict')
const { buildSync } = require('esbuild')
const Module = require('node:module')
const path = require('node:path')

function load(file) {
  const r = buildSync({ entryPoints: [file], bundle: true, platform: 'node', format: 'cjs', write: false, packages: 'external' })
  const m = new Module(path.resolve(file), module)
  m.filename = path.resolve(file); m.paths = module.paths
  m._compile(r.outputFiles[0].text, m.filename)
  return m.exports
}

test('ExecCommandTool policy marks read-only commands as non-mutating and parallelSafe', () => {
  const { ExecCommandTool } = load('src/main/agent/tools/ExecCommandTool.ts')
  const tool = new ExecCommandTool()
  assert.deepEqual(tool.getExecutionPolicy({ command: 'git status' }), { mutates: false, parallelSafe: true, cacheable: false })
  assert.deepEqual(tool.getExecutionPolicy({ command: 'npm test' }), { mutates: true, parallelSafe: false, cacheable: false })
})

test('ToolExecutor respects toolRes.noTruncate and does not truncate 400-line file reads', async () => {
  const { ToolExecutor } = load('src/main/agent/core/ToolExecutor.ts')
  const { Blackboard } = load('src/main/agent/core/Blackboard.ts')
  const bigOutput = Array.from({ length: 400 }, (_, i) => `${i + 1} | line`).join('\n')
  const fakeTool = {
    name: 'read_file',
    description: 'test',
    parameters: {},
    validate: () => null,
    getExecutionPolicy: () => ({ mutates: false, parallelSafe: true, cacheable: true }),
    execute: async () => ({ formattedContent: bigOutput, noTruncate: true, success: true })
  }
  const fakeAgent = { getHandler: () => fakeTool, getTools: () => [fakeTool] }
  const messages = []
  const board = new Blackboard()
  board.setArtifact('config', { workspacePath: process.cwd() })
  await ToolExecutor.executeCalls(fakeAgent, [{ id: 'c1', name: 'read_file', argumentsJson: JSON.stringify({ path: 'package.json' }) }], messages, board, () => {})
  assert.equal(messages[0].content.split('\n').length, 400)
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/exec-command-tools.test.cjs`
Expected: FAIL (`ExecCommandTool.ts` not found + `noTruncate` currently ignored)

- [ ] **Step 3: Implement `ExecCommandTool.ts`, `WriteStdinTool.ts`, and update `TerminalTool.ts`**
- `ExecCommandTool.getExecutionPolicy(args)` calls `classifyCommand(command)`: if `risk === 'read_only'`, returns `{ mutates: false, parallelSafe: true, cacheable: false }`, else `{ mutates: true, parallelSafe: false, cacheable: false }`.
- `ExecCommandTool.execute()` validates `cwd` via `inspectWorkspacePath`, calls `terminalSessionManager.startCommand(...)`, streams live progress deltas to `onProgress`, and returns formatted output + `data: { terminalSessionId: session.id, exitCode, status, command, cwd, elapsedMs, logPath }`.
- `WriteStdinTool.execute()` calls `terminalSessionManager.writeInput(...)` and returns updated status + new normalized output.
- Update `TerminalTool.ts` to delegate internally to `terminalSessionManager.startCommand(...)` when `processOwner` is present (and still respect `timeout_ms` for backwards compatibility), so even legacy `terminal` calls appear live in the Workspace Terminal!

- [ ] **Step 4: Fix `ToolExecutor.ts`, `PromptProviders.ts`, `ToolRegistry.ts`, and `src/main/agent/index.ts`**
- In `ToolExecutor.ts`:
  - Add `exec_command` and `write_stdin` to `isCommand` check (`tool.name === 'exec_command' || tool.name === 'terminal' || tool.name === 'run_command' || tool.name === 'process_start'`).
  - Validate `cwd` for `isCommand` with `inspectWorkspacePath` so external `cwd` triggers `confirmAction` just like external files.
  - Respect `toolRes.noTruncate`:
    ```ts
    const rawOutput = workspaceNotice + toolRes.formattedContent
    const outputContent = toolRes.noTruncate ? rawOutput : OutputTruncator.truncate(rawOutput)
    ```
- In `PromptProviders.ts`:
  - Replace hardcoded `- Операционная система: Windows` with real `process.platform` + `detectDefaultShell().name`.
  - Update `<tool_guidelines>` to instruct the model to use `exec_command` (with `yield_time_ms`) and `write_stdin` for interactive or long-running commands.
- Register `ExecCommandTool` and `WriteStdinTool` in `ToolRegistry.ts` and add them to `zipplyAgent` in `src/main/agent/index.ts`.

- [ ] **Step 5: Run tests and typecheck**

Run: `node --test tests/exec-command-tools.test.cjs tests/process-manager.test.cjs tests/process-tool.test.cjs && npm run typecheck`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/main/agent/tools/ExecCommandTool.ts src/main/agent/tools/WriteStdinTool.ts src/main/agent/tools/TerminalTool.ts src/main/agent/core/ToolExecutor.ts src/main/agent/core/PromptProviders.ts src/main/agent/tools/ToolRegistry.ts src/main/agent/index.ts tests/exec-command-tools.test.cjs
git commit -m "feat(agent): add Codex-style exec_command/write_stdin tools and fix noTruncate + cwd checks"
```

---

### Task 6: Terminal Electron IPC & Preload Bridge

**Files:**
- Create: `src/main/ipc/TerminalIpcHandler.ts`
- Modify: `src/main/index.ts`
- Modify: `src/main/ipc/AgentIpcHandler.ts`
- Modify: `src/preload/index.ts`

**Interfaces:**
- Consumes: `terminalSessionManager`, `src/shared/terminal.ts`
- Produces: `window.api.terminal` (`list`, `create`, `attach`, `write`, `resize`, `signal`, `close`, `onEvent`)

- [ ] **Step 1: Create `src/main/ipc/TerminalIpcHandler.ts`**
- Register handlers with `event.senderFrame === event.sender.mainFrame` guard (matching `AgentIpcHandler.ts` security pattern):
  - `terminal:list` (`{ sessionId, workspace }`) → `terminalSessionManager.list(owner)`
  - `terminal:create` (`{ sessionId, workspace, cols, rows }`) → `terminalSessionManager.startInteractiveShell(owner, workspace, cols, rows)`
  - `terminal:attach` (`{ sessionId, workspace, terminalId }`) → `terminalSessionManager.attach(owner, terminalId)`
  - `terminal:write` (`{ sessionId, workspace, terminalId, chars }`) → `terminalSessionManager.writeUserInput(owner, terminalId, chars)`
  - `terminal:resize` (`{ sessionId, workspace, terminalId, cols, rows }`) → `terminalSessionManager.resize(owner, terminalId, cols, rows)`
  - `terminal:signal` (`{ sessionId, workspace, terminalId, signal }`) → `terminalSessionManager.sendSignal(owner, terminalId, signal)`
  - `terminal:close` (`{ sessionId, workspace, terminalId }`) → `terminalSessionManager.close(owner, terminalId)`
- Subscribe to `terminalSessionManager.on('terminal_event', (owner, evt) => ...)` and forward to the matching `webContents` (`webContents.fromId(owner.senderId)`) on channel `'terminal:event'` with `{ sessionId: owner.sessionId, event: evt }`.
- Watch `event.sender.once('destroyed', ...)` to clean up sender terminals.

- [ ] **Step 2: Wire `TerminalIpcHandler` in `src/main/index.ts` and cleanup in `AgentIpcHandler.ts`**
- Instantiate `new TerminalIpcHandler().register()` in `src/main/index.ts`.
- In `before-quit`, await `Promise.allSettled([processManager.shutdown(), terminalSessionManager.shutdown()])`.
- In `AgentIpcHandler.ts` on `agent:discardSession`, also call `void terminalSessionManager.stopSession(event.sender.id, sessionId)`.

- [ ] **Step 3: Expose `window.api.terminal` in `src/preload/index.ts`**
- Add `terminal: { list, create, attach, write, resize, signal, close, onEvent }` mirroring the exact `ipcRenderer.invoke` / `ipcRenderer.send` / `ipcRenderer.on` pattern used by `api.agent` and `api.workspace`.

- [ ] **Step 4: Verify typecheck**

Run: `npm run typecheck`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/main/ipc/TerminalIpcHandler.ts src/main/index.ts src/main/ipc/AgentIpcHandler.ts src/preload/index.ts
git commit -m "feat(ipc): add terminal IPC bridge and preload API for live PTY streaming"
```

---

### Task 7: Live Workspace Terminal UI (`WorkspaceTerminal.tsx`) & Tab Integration

**Files:**
- Create: `src/renderer/src/hooks/useTerminalSessions.ts`
- Create: `src/renderer/src/components/layout/WorkspaceTerminal.tsx`
- Modify: `src/renderer/src/hooks/useWorkspaceTabs.ts`
- Modify: `src/renderer/src/components/layout/WorkspacePanel.tsx`
- Modify: `src/renderer/src/components/layout/AppLayout.tsx`
- Modify: `src/renderer/src/components/tools/TerminalTool.tsx`
- Modify: `tests/workspace-tabs.test.cjs`

**Interfaces:**
- Consumes: `window.api.terminal`, `src/shared/terminal.ts`
- Produces:
  - `WorkspaceTab.type`: `'files' | 'terminal' | 'empty'`
  - `WorkspaceTerminal` component mounted in `WorkspacePanel`
  - Auto-follow AI terminal stream + interactive user shells + `"Открыть в терминале"` jump from chat cards.

- [ ] **Step 1: Update `useWorkspaceTabs.ts` and add unit test in `tests/workspace-tabs.test.cjs`**
- Extend `WorkspaceTab` type union to `'files' | 'terminal' | 'empty'`.
- Allow `tab.title === 'Терминал'` when `tab.type === 'terminal'` in `loadTabs()`.
- Add `addTerminalTab` and `setTabTerminal(id)` callbacks.
- Add test verifying terminal tabs serialize/restore via `loadTabs()` and that `WorkspacePanel` renders the enabled `"Терминал"` button without `"Скоро"`.

- [ ] **Step 2: Create `src/renderer/src/hooks/useTerminalSessions.ts`**
- Fetches initial `window.api.terminal.list(sessionId, folderPath)` when `sessionId` or `folderPath` changes.
- Subscribes to `window.api.terminal.onEvent`:
  - On `session_created`: appends session to list; if `session.origin === 'ai'` and `followAI` is true, automatically switches `activeTerminalId` to `session.id`!
  - On `session_output`: invokes registered `onOutput(terminalId, chunk)` listener directly (bypassing React state re-renders for 60fps xterm writes!).
  - On `session_state` / `session_closed`: updates session status/exitCode/endedAt in state.
- Exposes `sessions`, `activeTerminalId`, `setActiveTerminalId`, `followAI`, `setFollowAI`, `createUserShell()`, `sendSignal(id, sig)`, `closeSession(id)`, `hasRunningAI`.

- [ ] **Step 3: Create `src/renderer/src/components/layout/WorkspaceTerminal.tsx`**
- Strictly follows `AGENTS.md` Apple Minimalist Design:
  - Root container: `bg-[#0A0A0A] border-none shadow-none flex flex-col flex-1 min-h-0 min-w-0`.
  - **Top session strip** (`bg-[#0E0E0E]`): horizontal scrollable pill bar of sessions for the current chat:
    - Each pill (`rounded-full h-[30px] px-3 text-[13.5px] border-none shadow-none`):
      - Active: `bg-[#222222] text-primary`, inactive: `text-secondary hover:bg-white/[0.04]`.
      - AI sessions show a crisp subtle badge (`ИИ`) + animated monochrome pulse dot while `status === 'running'` + truncated command (`npm test`, `git status`).
      - User sessions show shell name (`PowerShell` / `bash`) + close `×` button.
    - Right controls:
      - `Следить за ИИ` toggle pill (`rounded-full`, active `#FFFFFF` text `#0A0A0A` or subtle `#222222`).
      - `+` button (`rounded-full w-[30px] h-[30px]`) to spawn a new interactive user shell in `folderPath`.
  - **Active session info bar** (shown when a session is selected, `bg-[#141414] px-3.5 py-2`):
    - Shows `$ <command>` (for AI) or `<cwd>`, status label (`Выполняется…` / `Завершён · код 0` / `Ошибка · код 1`), and action buttons:
      - If `status === 'running'`: **Остановить (Ctrl+C)** button (`rounded-full bg-[#222222] hover:bg-[#2C2C2C]`).
      - If AI session is running: hint/button to focus input if the user wants to answer a prompt directly.
  - **xterm.js viewport** (`flex-1 min-h-0 p-2 bg-[#0A0A0A]`):
    - Initializes `Terminal` from `@xterm/xterm` with obsidian theme (`background: '#0A0A0A'`, `foreground: '#E8E8E8'`, `cursor: '#FFFFFF'`, `selectionBackground: 'rgba(255,255,255,0.18)'`, `fontSize: 13.5`, `lineHeight: 1.45`, monospace font).
    - Loads `FitAddon` + `WebLinksAddon`, observes container resize via `ResizeObserver` → calls `fitAddon.fit()` + `window.api.terminal.resize(...)`.
    - On session switch: clears xterm, calls `window.api.terminal.attach(...)`, writes `snapshot.rawBuffer`, and pipes live `session_output` deltas directly into `term.write(chunk)`.
    - Pipes `term.onData(chars => window.api.terminal.write(...))` so user shells are 100% interactive and users can also type into waiting AI prompts.
  - **Empty state** (when no AI commands have run yet and no user shell is open): clean centered Apple Minimalist card with button **"Открыть терминал"** and caption *"Команды ИИ появятся здесь автоматически"*.

- [ ] **Step 4: Wire `WorkspacePanel.tsx`, `AppLayout.tsx`, and chat `TerminalTool.tsx`**
- In `WorkspacePanel.tsx`:
  - Enable the `"Терминал"` button in the empty-tab chooser (`onClick={() => activeTabId ? onChooseTerminal(activeTabId) : onAddTerminalTab?.()}`), removing `disabled` and `"Скоро"`.
  - Render `<WorkspaceTerminal />` when the active tab has `type === 'terminal'`.
  - Show a subtle live pulse indicator on the `"Терминал"` tab header whenever `hasRunningAI` is true.
- In `AppLayout.tsx`:
  - Pass `onChooseTerminal` / `onAddTerminalTab` and an `openTerminalSession(terminalId?: string)` handler (opens `WorkspacePanel` if closed, selects or creates a `terminal` tab, and focuses `terminalId`).
- In `src/renderer/src/components/tools/TerminalTool.tsx`:
  - Add optional `exitCode`, `elapsedMs`, `terminalSessionId`, and `onOpenInPanel` props; show a subtle `"В терминале ↗"` pill button that calls `onOpenInPanel(terminalSessionId)`.

- [ ] **Step 5: Run full test suite and build verification**

Run:
```bash
npm run typecheck
npm test
npm run build
```
Expected: All typechecks pass, all unit tests pass (including new terminal + policy + normalizer + workspace-tabs tests), and `electron-vite build` succeeds cleanly.

- [ ] **Step 6: Commit**

```bash
git add src/renderer/src/hooks/useTerminalSessions.ts src/renderer/src/components/layout/WorkspaceTerminal.tsx src/renderer/src/hooks/useWorkspaceTabs.ts src/renderer/src/components/layout/WorkspacePanel.tsx src/renderer/src/components/layout/AppLayout.tsx src/renderer/src/components/tools/TerminalTool.tsx tests/workspace-tabs.test.cjs
git commit -m "feat(ui): add live interactive WorkspaceTerminal panel mirroring AI commands"
```
