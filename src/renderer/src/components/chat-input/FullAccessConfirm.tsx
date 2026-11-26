import React from 'react'
import { createPortal } from 'react-dom'

interface FullAccessConfirmProps {
  onCancel: () => void
  onConfirm: () => void
  container?: Element | null
  placement?: 'anchored' | 'viewport'
}

export const FullAccessConfirm: React.FC<FullAccessConfirmProps> = ({ onCancel, onConfirm, container, placement = 'anchored' }) => {
  const content = <>
    <h2 id="full-access-title" className="text-[19px] font-semibold text-primary">Включить полный доступ?</h2>
    <p id="full-access-description" className="mt-3 text-[15px] leading-[22px] text-secondary">Агент сможет изменять файлы и запускать команды без подтверждения. Терминал не изолирован; некоторые опасные команды могут не распознаться. Доступ к файлам вне выбранной папки по-прежнему требует разрешения.</p>
    <div className="mt-5 flex justify-end gap-2">
      <button type="button" onClick={onCancel} className="rounded-full bg-control px-5 py-2 text-[15px] text-primary border-none shadow-none cursor-pointer hover:bg-control-hover">Отмена</button>
      <button type="button" onClick={onConfirm} className="rounded-full bg-accent px-5 py-2 text-[15px] font-medium text-on-accent border-none shadow-none cursor-pointer hover:bg-accent-hover active:scale-95">Включить</button>
    </div>
  </>
  const anchoredDialog = <div className="absolute bottom-full left-0 z-[100] mb-2 w-full max-w-[440px] max-h-[40vh] overflow-y-auto rounded-[24px] bg-surface p-6 border-none shadow-none" role="dialog" aria-labelledby="full-access-title" aria-describedby="full-access-description" onKeyDown={event => { if (event.key === 'Escape') { event.stopPropagation(); onCancel() } }}>{content}</div>
  if (container) return createPortal(anchoredDialog, container)
  if (placement === 'viewport') {
    const viewportDialog = <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 p-5" role="dialog" aria-modal="true" aria-labelledby="full-access-title" aria-describedby="full-access-description" onKeyDown={event => { if (event.key === 'Escape') { event.stopPropagation(); onCancel() } }}><div className="w-full max-w-[440px] max-h-[80vh] overflow-y-auto rounded-[24px] bg-surface p-6 border-none shadow-none">{content}</div></div>
    return typeof document === 'undefined' ? viewportDialog : createPortal(viewportDialog, document.body)
  }
  return anchoredDialog
}
