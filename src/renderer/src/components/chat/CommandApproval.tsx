import React from 'react'
import { CodeBlock } from './CodeBlock'
import type { AgentEvent } from '../../../../shared/agentEvents'

interface CommandApprovalProps {
  approval: Extract<AgentEvent, { type: 'approval_request' }> & { requestId: string }
  onApproval?: (approved: boolean, trustTool?: boolean) => void
}

export const CommandApproval: React.FC<CommandApprovalProps> = ({ approval, onApproval }) => {
  if (approval.kind === 'mcp_connection') {
    return <div className="flex w-full justify-center px-4 pb-3" role="dialog" aria-labelledby="mcp-connection-title" onKeyDown={event => {
      if (event.key === 'Escape') { event.stopPropagation(); onApproval?.(false) }
    }}>
      <div className="w-full max-w-[740px] rounded-[20px] bg-surface p-5">
        <h2 id="mcp-connection-title" className="text-[19px] font-semibold text-primary">{approval.command}</h2>
        <p className="mt-2 text-[15px] leading-[22px] text-secondary">Zipply сохранит сервер в расширениях и откроет его инструменты для этого чата.</p>
        <p className="mt-3 break-all rounded-[14px] bg-surface-secondary px-4 py-3 text-[14.5px] font-mono leading-[24px] text-primary">{approval.details}</p>
        <div className="mt-5 flex flex-wrap justify-end gap-2">
          <button type="button" onClick={() => onApproval?.(false)} className="rounded-full border-none bg-control px-5 py-2 text-[15px] text-secondary shadow-none hover:bg-control-hover active:scale-95">Отмена</button>
          <button type="button" onClick={() => onApproval?.(true)} className="rounded-full border-none bg-accent px-5 py-2 text-[15px] font-medium text-on-accent shadow-none hover:bg-accent-hover active:scale-95">Подключить</button>
        </div>
      </div>
    </div>
  }

  let fileDetails: { content?: unknown; target?: unknown; replacement?: unknown; edits?: unknown } | null = null
  if (approval.kind === 'file' && approval.details) {
    try {
      const parsed = JSON.parse(approval.details)
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) fileDetails = parsed
    } catch { /* Show the original details when they cannot be parsed. */ }
  }
  const isWrite = typeof fileDetails?.content === 'string'
  const isEdit = typeof fileDetails?.target === 'string' && typeof fileDetails?.replacement === 'string'
  const edits = Array.isArray(fileDetails?.edits) ? fileDetails.edits.filter((edit): edit is { target: string; replacement: string } => !!edit && typeof edit.target === 'string' && typeof edit.replacement === 'string') : []
  const language = approval.target?.split(/[\\/]/).pop()?.split('.').pop() || ''
  const codeSection = (label: string, code: string): React.ReactNode => (
    <section className="min-w-0">
      <h3 className="px-1 text-[14px] font-medium text-secondary">{label}</h3>
      {code.length ? <CodeBlock language={language} code={code} /> : <div className="mt-2 rounded-[16px] bg-surface-secondary px-4 py-3 text-[14px] text-secondary">Пустое содержимое</div>}
    </section>
  )
  return (
    <div className="flex w-full min-h-0 justify-center px-4 pb-3" role="dialog" aria-live="polite" aria-labelledby="command-approval-title" onKeyDown={(event) => { if (event.key === 'Escape') { event.stopPropagation(); onApproval?.(false) } }}>
      <div className="w-full min-h-0 max-w-[760px] max-h-[40vh] overflow-y-auto code-scrollbar rounded-[24px] bg-surface p-5 border-none shadow-none">
        <h2 id="command-approval-title" className="text-[19px] font-semibold text-primary">{approval.kind === 'mcp' ? 'Вызов инструмента MCP' : approval.kind === 'file' ? 'Доступ к файлу или папке' : approval.kind === 'network' ? 'Сетевая проверка' : 'Выполнение команды'}</h2>
        <p className="mt-2 text-[15px] leading-[22px] text-secondary">{approval.kind === 'mcp' ? `Параметры будут переданы серверу «${approval.serverId || approval.target || 'MCP'}». Содержимое инструмента может изменять внешние данные.` : approval.kind === 'file' ? 'Проверьте путь и действие перед продолжением.' : approval.kind === 'network' ? approval.details : 'Проверьте команду перед выполнением. Терминал работает на вашем компьютере и не ограничен проверками файлов проекта.'}</p>
        {approval.cwd && <p className="mt-3 text-[14px] text-secondary break-all">Рабочая папка: {approval.cwd}</p>}
        {approval.target && (approval.kind === 'file' || approval.kind === 'mcp') && <p className="mt-3 text-[14px] text-secondary break-all">{approval.kind === 'mcp' ? 'Сервер' : 'Файл'}: {approval.target}</p>}
        {isWrite && <p className="mt-2 text-[14px] leading-[21px] text-secondary">Файл будет записан целиком; существующее содержимое будет заменено.</p>}
        {approval.kind === 'file' && (isWrite || isEdit || edits.length > 0) ? (
          <div className="mt-4 max-h-[min(48vh,420px)] overflow-auto code-scrollbar rounded-[16px] bg-surface-secondary p-3 space-y-4 select-text">
            {isWrite && codeSection('Новое содержимое', fileDetails!.content as string)}
            {isEdit && codeSection('Было · фрагмент для поиска', fileDetails!.target as string)}
            {isEdit && codeSection('Станет · замена', fileDetails!.replacement as string)}
            {edits.map((edit, index) => <React.Fragment key={index}>{codeSection(`Было · правка ${index + 1}`, edit.target)}{codeSection(`Станет · правка ${index + 1}`, edit.replacement)}</React.Fragment>)}
          </div>
        ) : (
          <pre className="mt-4 max-h-[min(48vh,420px)] overflow-auto whitespace-pre-wrap break-words rounded-[14px] bg-surface-secondary p-4 text-[14.5px] leading-[24px] font-mono text-primary select-text code-scrollbar">{approval.kind === 'file' || approval.kind === 'mcp' ? approval.details : approval.command}</pre>
        )}

        <div className="mt-5 flex flex-wrap justify-end gap-2">
          <button type="button" onClick={() => onApproval?.(false)} className="rounded-full bg-control px-5 py-2 text-[15px] text-secondary border-none shadow-none cursor-pointer hover:bg-control-hover active:scale-95">Отмена</button>
          {approval.kind === 'mcp' && approval.toolId && <button type="button" onClick={() => onApproval?.(true, true)} className="rounded-full bg-control px-5 py-2 text-[15px] font-medium text-primary border-none shadow-none cursor-pointer hover:bg-control-hover active:scale-95">Разрешить и запомнить для инструмента</button>}
          <button type="button" onClick={() => onApproval?.(true)} className="rounded-full bg-accent px-5 py-2 text-[15px] font-medium text-on-accent border-none shadow-none cursor-pointer hover:bg-accent-hover active:scale-95">{approval.kind === 'mcp' ? 'Разрешить один раз' : 'Разрешить'}</button>
        </div>
      </div>
    </div>
  )
}
