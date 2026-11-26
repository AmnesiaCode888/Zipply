import React from 'react'
import type { ToolCall } from '../../types/chat'

const statusLabels: Record<string, string> = {
  starting: 'Запускается', running: 'Работает', exited: 'Завершён', failed: 'Ошибка запуска', stopped: 'Остановлен'
}

export const ProcessResult: React.FC<{ result?: ToolCall['processResult']; content?: string }> = ({ result, content }) => {
  if (Array.isArray(result)) {
    return <div className="space-y-2 p-3 max-h-[280px] overflow-auto code-scrollbar select-text">
      {result.length === 0 ? <p className="text-[15px] leading-[22px] text-secondary">Процессов пока нет.</p> : result.map(process => (
        <div key={process.id} className="rounded-[14px] bg-surface p-3 min-w-0">
          <div className="flex flex-wrap items-center justify-between gap-2 text-[15px] leading-[22px]"><span className="text-primary break-all">{process.command}</span><span className="text-secondary">{statusLabels[process.status] || process.status}</span></div>
          <p className="mt-1 text-[13px] leading-[20px] text-secondary break-all">{process.cwd}</p>
          <p className="text-[13px] leading-[20px] text-muted break-all">ID: {process.id}</p>
        </div>
      ))}
    </div>
  }
  if (!result || typeof result !== 'object' || typeof result.status !== 'string') {
    return <pre className="p-3.5 max-h-[280px] overflow-auto code-scrollbar font-mono text-[14.5px] leading-[24px] text-secondary whitespace-pre-wrap break-words select-text">{content || 'Ожидание результата…'}</pre>
  }
  return <div className="p-3.5 max-h-[280px] overflow-auto code-scrollbar select-text">
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[15px] leading-[22px] text-secondary">
      <span className="text-primary">{statusLabels[result.status] || result.status}</span>
      {typeof result.exitCode === 'number' && <span>Код выхода: {result.exitCode}</span>}
      {result.signal && <span>Сигнал: {result.signal}</span>}
    </div>
    <p className="mt-1 text-[13px] leading-[20px] text-muted break-all">ID: {result.id}</p>
    {result.truncated && <p className="mt-2 text-[15px] leading-[22px] text-secondary">Часть предыдущего вывода удалена.</p>}
    {typeof result.output === 'string' && <pre className="mt-3 font-mono text-[14.5px] leading-[24px] text-secondary whitespace-pre-wrap break-words">{result.output || '(нет нового вывода)'}</pre>}
  </div>
}
