import React from 'react'
import { Bot } from '../../../icons'
import { Field, SettingsHeader, fieldClass } from './SettingsUI'
import { DEFAULT_AGENT_INSTRUCTION } from '../../../services/settingsService'
import { terminalShells, type TerminalShellPreference } from '../../../../../shared/terminal'

interface AgentTabProps {
  instruction: string
  onChange: (value: string) => void
  terminalShell: TerminalShellPreference
  onShellChange: (value: TerminalShellPreference) => void
}

export function AgentTab({ instruction, onChange, terminalShell, onShellChange }: AgentTabProps): React.ReactElement {
  const platform = typeof window !== 'undefined' ? window.api?.platform : undefined
  const shells: TerminalShellPreference[] = platform === 'win32'
    ? ['auto', 'pwsh', 'powershell', 'cmd', 'git-bash']
    : ['auto', 'bash', 'zsh', 'sh', 'pwsh']
  if (!shells.includes(terminalShell)) shells.push(terminalShell)

  return (
    <div className="space-y-6">
      <SettingsHeader icon={Bot} title="Агент" description="Настройте, как Zipply помогает вам в новых запросах." />
      <Field id="terminal-shell" label="Оболочка терминала" description="Используется в новых личных терминалах и новых запросах к агенту. Выберите установленную оболочку.">
        <select id="terminal-shell" value={terminalShell} onChange={event => onShellChange(event.target.value as TerminalShellPreference)} className={`${fieldClass} max-w-[300px] rounded-full cursor-pointer focus-visible:underline underline-offset-4`}>
          {shells.map(shell => <option key={shell} value={shell}>{terminalShells[shell]}</option>)}
        </select>
      </Field>
      <Field id="agent-instruction" label="Инструкция агенту" description="Опишите предпочтения к ответам и работе. Изменения применяются к новым запросам.">
        <textarea id="agent-instruction" rows={7} value={instruction} onChange={e => onChange(e.target.value)} className={`${fieldClass} resize-y min-h-[150px]`} />
        <p className="text-[14px] leading-[21px] text-secondary">Например: отвечай по-русски, объясняй решения и сначала изучай проект.</p>
        <div><button type="button" onClick={() => onChange(DEFAULT_AGENT_INSTRUCTION)} disabled={instruction === DEFAULT_AGENT_INSTRUCTION} className="rounded-full bg-surface-elevated px-4 py-2 text-[14px] text-primary disabled:opacity-40 border-none shadow-none">Восстановить стандартную</button></div>
      </Field>
    </div>
  )
}
