import React, { useEffect, useRef, useState } from 'react'
import { Check } from '../../icons'
import type { AccessMode } from '../../services/settingsService'
import { FullAccessConfirm } from './FullAccessConfirm'
import { SmoothActivityLabel } from '../ActivityLabel'
import { createPortal } from 'react-dom'

const OPTIONS: ReadonlyArray<{ value: AccessMode; label: string; description: string }> = [
  { value: 'read-only', label: 'Только чтение', description: 'Без изменений' },
  { value: 'confirm', label: 'С подтверждением', description: 'Спрашивать разрешение' },
  { value: 'automatic', label: 'Автоматически', description: 'Агент действует самостоятельно; распознанные опасные команды требуют подтверждения.' },
  { value: 'unrestricted', label: 'Полный доступ', description: 'Команды и изменения без подтверждения; внешние пути по-прежнему запрашивают разрешение.' }
]

interface AccessSelectorProps {
  value: AccessMode
  onChange: (value: AccessMode) => boolean
  planMode?: boolean
  onExitPlan?: () => void
  disabled?: boolean
}

export const AccessSelector: React.FC<AccessSelectorProps> = ({ value, onChange, planMode, onExitPlan, disabled }) => {
  const [open, setOpen] = useState(false)
  const [error, setError] = useState(false)
  const [confirmFull, setConfirmFull] = useState(false)
  const [pendingPlanAccess, setPendingPlanAccess] = useState<AccessMode | null>(null)
  const [exitPlanAfterFull, setExitPlanAfterFull] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const optionsRef = useRef<Array<HTMLButtonElement | null>>([])
  const current = OPTIONS.find((option) => option.value === value) || OPTIONS[1]

  useEffect(() => {
    if (!open) return
    optionsRef.current[OPTIONS.findIndex((option) => option.value === (planMode ? 'read-only' : current.value))]?.focus()
    const onPointerDown = (event: MouseEvent): void => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false)
    }
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        setOpen(false)
        triggerRef.current?.focus()
      }
    }
    document.addEventListener('mousedown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('mousedown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open, current.value, planMode])

  const composer = rootRef.current?.closest('.composer-container')
  const focusComposer = (): void => { composer?.querySelector<HTMLTextAreaElement>('textarea[data-chat-composer]')?.focus() }

  const select = (next: AccessMode): void => {
    if (planMode) {
      if (next === 'read-only') { setOpen(false); triggerRef.current?.focus(); return }
      setOpen(false)
      setPendingPlanAccess(next)
      focusComposer()
      return
    }
    if (next === 'unrestricted' && value !== next) { setOpen(false); setConfirmFull(true); focusComposer(); return }
    if (!onChange(next)) {
      setError(true)
      return
    }
    setError(false)
    setOpen(false)
    triggerRef.current?.focus()
  }

  return (
    <div ref={rootRef} className="composer-access relative min-w-0 max-w-full shrink-0">
      <div
        role="menu"
        aria-label="Доступ агента"
        aria-hidden={!open}
        className={`popup-glass absolute bottom-[calc(100%+10px)] left-0 z-50 w-[268px] max-w-[calc(100vw-48px)] rounded-[23px] p-1 border-[0.5px] border-hairline shadow-none transition-all duration-200 ${
          open
            ? 'opacity-100 scale-100 translate-y-0 pointer-events-auto'
            : 'invisible opacity-0 scale-[0.96] translate-y-1 pointer-events-none'
        }`}
        style={{
          transformOrigin: 'bottom left',
          transitionTimingFunction: 'cubic-bezier(0.22, 1, 0.36, 1)'
        }}
      >
        <div className="px-3.5 pt-2.5 pb-1.5 text-[12px] font-medium text-secondary select-none">Доступ агента</div>
        <div className="flex flex-col gap-0.5">
          {OPTIONS.map((option, index) => {
            const isSelected = (planMode ? 'read-only' : value) === option.value
            return (
              <button
                key={option.value}
                ref={(node) => { optionsRef.current[index] = node }}
                type="button"
                role="menuitemradio"
                aria-checked={isSelected}
                onClick={() => select(option.value)}
                onKeyDown={(event) => {
                  if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
                    event.preventDefault()
                    const direction = event.key === 'ArrowDown' ? 1 : -1
                    optionsRef.current[(index + direction + OPTIONS.length) % OPTIONS.length]?.focus()
                  }
                }}
                className={`w-full flex items-start gap-2.5 rounded-[19px] px-3 py-2.5 text-left border-none shadow-none transition-colors duration-150 cursor-pointer focus:outline-none ${
                  isSelected
                    ? 'bg-control text-primary'
                    : 'bg-transparent hover:bg-hover active:bg-control-hover text-primary'
                }`}
              >
                <span className="min-w-0 flex-1">
                  <span className="block text-[14.5px] font-medium leading-[20px] text-primary">{option.label}</span>
                  <span className="block mt-0.5 text-[12.5px] leading-[17px] text-secondary">{option.description}</span>
                </span>
                {isSelected && <Check size={15} strokeWidth={2.25} className="mt-0.5 shrink-0 text-primary" />}
              </button>
            )
          })}
        </div>
        {planMode && <p className="px-3.5 pt-2 pb-2 text-[12.5px] leading-[17px] text-secondary">Чтобы сменить доступ, необходимо выключить режим плана.</p>}
        {error && <p role="alert" className="px-3.5 pt-2 pb-2 text-[12.5px] leading-[17px] text-secondary">Не удалось сохранить настройку. Проверьте защищённое хранилище.</p>}
      </div>
      {pendingPlanAccess && composer && createPortal(<div role="dialog" onKeyDown={event => { if (event.key === 'Escape') { event.stopPropagation(); setPendingPlanAccess(null) } }} aria-labelledby="plan-access-title" className="absolute bottom-full left-0 z-[100] mb-2 w-full max-w-[440px] max-h-[40vh] overflow-y-auto rounded-[24px] bg-surface p-6 border-none shadow-none"><h2 id="plan-access-title" className="text-[19px] font-semibold text-primary">Выключить режим плана?</h2><p className="mt-3 text-[15px] leading-[22px] text-secondary">Для смены доступа режим плана будет выключен.</p><div className="mt-5 flex justify-end gap-2"><button type="button" onClick={() => setPendingPlanAccess(null)} className="rounded-full bg-control px-5 py-2 text-[15px] text-primary border-none shadow-none">Отмена</button><button type="button" onClick={() => { const next = pendingPlanAccess; setPendingPlanAccess(null); if (next === 'unrestricted' && value !== next) { setExitPlanAfterFull(true); setConfirmFull(true); focusComposer() } else if (onChange(next)) { onExitPlan?.(); setError(false) } else { setOpen(true); setError(true) } }} className="rounded-full bg-control px-5 py-2 text-[15px] text-primary hover:bg-control-hover border-none shadow-none">Выключить и сменить доступ</button></div></div>, composer)}
      {confirmFull && <FullAccessConfirm container={composer} onCancel={() => { setConfirmFull(false); setExitPlanAfterFull(false) }} onConfirm={() => { if (onChange('unrestricted')) { if (exitPlanAfterFull) onExitPlan?.(); setExitPlanAfterFull(false); setConfirmFull(false); setError(false) } else { setExitPlanAfterFull(false); setConfirmFull(false); setOpen(true); setError(true) } }} />}
      <button ref={triggerRef} type="button" disabled={disabled} aria-label={planMode ? 'Доступ агента: Только чтение (режим плана)' : `Доступ агента: ${current.label}`} title={planMode ? 'Только чтение (режим плана)' : current.label} aria-haspopup="menu" aria-expanded={open} onClick={() => { setError(false); setOpen((prev) => !prev) }} className="h-[34px] max-w-full flex items-center gap-1.5 rounded-full px-2.5 text-[14.5px] font-normal text-secondary hover:text-primary hover:bg-hover active:scale-95 transition-colors border-none shadow-none cursor-pointer focus:outline-none">
        <span className="composer-access-full flex min-w-0 items-center"><SmoothActivityLabel text={planMode ? 'Только чтение' : current.label} /></span>
        <span aria-hidden="true" className="composer-access-compact">{planMode || value === 'read-only' ? 'Чтение' : value === 'confirm' ? 'Спросить' : value === 'automatic' ? 'Авто' : 'Полный'}</span>
      </button>
    </div>
  )
}
