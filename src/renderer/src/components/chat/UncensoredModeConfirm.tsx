import React, { useEffect, useId, useRef } from 'react'
import { createPortal } from 'react-dom'

interface UncensoredModeConfirmProps {
  chatTitle: string
  onContinue: () => void
  onEnable: () => void
}

export const UncensoredModeConfirm: React.FC<UncensoredModeConfirmProps> = ({ chatTitle, onContinue, onEnable }) => {
  const titleId = useId()
  const descriptionId = useId()
  const continueRef = useRef<HTMLButtonElement>(null)
  const dialogRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const previousFocus = document.activeElement as HTMLElement | null
    const appRoot = document.getElementById('root')
    const wasInert = appRoot?.hasAttribute('inert') === true
    appRoot?.setAttribute('inert', '')
    continueRef.current?.focus()
    const keepFocus = (event: FocusEvent): void => {
      if (event.target instanceof Node && !dialogRef.current?.contains(event.target)) continueRef.current?.focus()
    }
    document.addEventListener('focusin', keepFocus)
    return () => {
      document.removeEventListener('focusin', keepFocus)
      if (!wasInert) appRoot?.removeAttribute('inert')
      if (previousFocus?.isConnected) previousFocus.focus()
    }
  }, [])

  return createPortal(
    <div className="fixed inset-0 z-[110] flex items-center justify-center bg-black/60 p-4 sm:p-5" onMouseDown={event => { if (event.target === event.currentTarget) onContinue() }}>
      <div ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby={titleId} aria-describedby={descriptionId}
        className="w-full max-w-[420px] max-h-[min(80vh,560px)] overflow-y-auto rounded-[24px] bg-surface p-6 sm:p-7 border-none shadow-none"
        onKeyDown={event => {
          if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); onContinue() }
          if (event.key === 'Tab') {
            const buttons = event.currentTarget.querySelectorAll<HTMLButtonElement>('button')
            if (event.shiftKey && document.activeElement === buttons[0]) { event.preventDefault(); buttons[buttons.length - 1]?.focus() }
            else if (!event.shiftKey && document.activeElement === buttons[buttons.length - 1]) { event.preventDefault(); buttons[0]?.focus() }
          }
        }}>
        <h2 id={titleId} className="text-[22px] leading-[29px] font-semibold text-primary">Включить uncensored?</h2>
        <div id={descriptionId} className="mt-4 space-y-4 text-[15.5px] leading-[24px] text-secondary">
          <p>Похоже, обычная модель может отклонить такой запрос.</p>
          <div className="rounded-[16px] bg-surface-secondary px-4 py-3.5">
            <p className="break-words text-[14px] leading-[21px] text-secondary">Чат: <span className="text-primary">{chatTitle}</span></p>
            <p className="mt-2 text-[14px] leading-[21px]">Обработка таких запросов может расходовать больше лимитов. Режим останется включённым для этого чата.</p>
            <p className="mt-2 text-[14px] leading-[21px] text-primary">После включения отключить его в этом чате нельзя.</p>
          </div>
          <p>После выбора продолжится ответ на текущий запрос.</p>
        </div>
        <div className="mt-6 flex flex-col-reverse gap-2">
          <button ref={continueRef} type="button" onClick={onContinue} className="min-h-[44px] w-full rounded-full bg-control px-4 py-2.5 text-[15px] font-medium text-primary hover:bg-control-hover active:scale-[0.99] focus-visible:outline-none border-none shadow-none">Продолжить обычно</button>
          <button type="button" onClick={onEnable} className="min-h-[44px] w-full rounded-full bg-accent px-4 py-2.5 text-[15px] font-medium text-on-accent hover:bg-accent-hover active:scale-[0.99] focus-visible:outline-none border-none shadow-none">Включить uncensored</button>
        </div>
      </div>
    </div>, document.body
  )
}
