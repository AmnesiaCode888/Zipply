import { spawnSync } from 'child_process'
import { existsSync } from 'fs'
import * as path from 'path'
import { normalizeTerminalShell, terminalShells } from '../../../shared/terminal'

interface TerminalShell {
  shell: string
  name: string
  kind: 'powershell' | 'cmd' | 'posix' | 'fish'
}

let defaultShell: TerminalShell | undefined

function identify(shell: string, name = path.basename(shell)): TerminalShell {
  const base = path.basename(shell).toLowerCase().replace(/\.exe$/, '')
  const kind = base === 'powershell' || base === 'pwsh' ? 'powershell' : base === 'cmd' ? 'cmd' : base === 'fish' ? 'fish' : 'posix'
  return { shell, name, kind }
}

export function resolveTerminalShell(preference: unknown): TerminalShell {
  const profile = normalizeTerminalShell(preference)
  if (profile !== 'auto') {
    if (profile === 'cmd' && process.platform === 'win32') {
      return identify(path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'cmd.exe'), terminalShells.cmd)
    }
    if (profile === 'git-bash') {
      const candidates = [process.env.ProgramW6432, process.env.ProgramFiles, process.env['ProgramFiles(x86)'], process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Programs')]
        .filter((root): root is string => Boolean(root))
        .map(root => path.join(root, 'Git', 'bin', 'bash.exe'))
      return identify(candidates.find(existsSync) ?? candidates[0] ?? 'bash.exe', terminalShells[profile])
    }
    const shell = process.platform === 'win32' ? `${profile}.exe` : profile
    return identify(shell, terminalShells[profile])
  }
  if (defaultShell) return defaultShell
  if (process.platform === 'win32') {
    const probe = spawnSync('where.exe', ['pwsh.exe'], { windowsHide: true, timeout: 2000 })
    defaultShell = probe.status === 0 ? identify('pwsh.exe', terminalShells.pwsh) : identify('powershell.exe', 'PowerShell')
  } else {
    defaultShell = identify(process.env.SHELL?.trim() || '/bin/bash')
  }
  return defaultShell
}

export const CMD_SOURCE_ENV = 'ZIPPLY_TERMINAL_CMD_SOURCE'

export function commandShellArgs({ shell, kind }: TerminalShell, command: string): string[] | string {
  if (kind === 'cmd') {
    // The inner cmd inherits UTF-8. Delayed expansion passes the source without parsing it in the outer cmd.
    return `/d /v:on /s /c "chcp 65001>nul & "${shell}" /d /s /c "!${CMD_SOURCE_ENV}!""`
  }
  if (kind === 'powershell') {
    const wrapped = [
      '[Console]::OutputEncoding = [System.Text.UTF8Encoding]::UTF8',
      '$OutputEncoding = [System.Text.UTF8Encoding]::UTF8',
      `& { ${command} }`,
      'if (-not $?) { if ($null -ne $LASTEXITCODE -and $LASTEXITCODE -ne 0) { exit $LASTEXITCODE } else { exit 1 } }',
      'if ($null -ne $LASTEXITCODE -and $LASTEXITCODE -ne 0) { exit $LASTEXITCODE }',
      'exit 0'
    ].join('; ')
    return ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', wrapped]
  }
  return ['-c', command]
}

export function interactiveShellArgs({ shell, kind }: TerminalShell): string[] | string {
  if (kind === 'powershell') return ['-NoLogo']
  if (kind === 'cmd') return `/d /s /c "chcp 65001>nul & "${shell}" /d"`
  const base = path.basename(shell).toLowerCase().replace(/\.exe$/, '')
  return base === 'zsh' || base === 'bash' ? ['-il'] : ['-i']
}
