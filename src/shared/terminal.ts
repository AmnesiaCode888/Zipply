import type { SandboxProfile } from './sandbox'

export type TerminalSessionOrigin = 'ai' | 'user'
export type TerminalSessionStatus = 'starting' | 'running' | 'exited' | 'failed' | 'stopped'

export const terminalShells = {
  auto: 'Автоматически',
  pwsh: 'PowerShell 7',
  powershell: 'Windows PowerShell',
  cmd: 'Командная строка',
  'git-bash': 'Git Bash',
  bash: 'Bash',
  zsh: 'Zsh',
  sh: 'sh'
} as const

export type TerminalShellPreference = keyof typeof terminalShells

export function normalizeTerminalShell(value: unknown): TerminalShellPreference {
  return typeof value === 'string' && Object.hasOwn(terminalShells, value) ? value as TerminalShellPreference : 'auto'
}

export function isTerminalLive(status: TerminalSessionStatus): boolean {
  return status === 'starting' || status === 'running'
}

export interface TerminalOwner {
  senderId: number
  sessionId: string
  workspace: string
}

export interface TerminalSessionSummary {
  id: string
  origin: TerminalSessionOrigin
  background?: boolean
  sandboxProfile?: SandboxProfile
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
      background?: boolean
    }
  | { type: 'session_closed'; terminalId: string }
