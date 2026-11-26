import React, { useEffect, useId, useRef } from 'react'
import { createPortal } from 'react-dom'
import { ArrowUpRight, Sparkles } from '../../icons'

const PLANS_URL = 'https://web.zipply.my/plans'

interface FreePlanPromptProps {
  onContinue: () => void
  onOpenPlans: () => void
}

export const FreePlanPrompt: React.FC<FreePlanPromptProps> = ({ onContinue, onOpenPlans }) => {
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
    <div
      className="fixed inset-0 z-[110] flex items-center justify-center bg-black/60 p-4 sm:p-5"
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        className="w-full max-w-[440px] rounded-[24px] bg-surface p-6 sm:p-7 border-none shadow-none"
        onKeyDown={event => {
          if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation() }
          if (event.key === 'Tab') {
            const focusable = event.currentTarget.querySelectorAll<HTMLElement>('a[href], button:not([disabled])')
            if (event.shiftKey && document.activeElement === focusable[0]) { event.preventDefault(); focusable[focusable.length - 1]?.focus() }
            else if (!event.shiftKey && document.activeElement === focusable[focusable.length - 1]) { event.preventDefault(); focusable[0]?.focus() }
          }
        }}
      >
        <div className="mb-5 flex h-12 w-12 items-center justify-center rounded-full bg-control text-primary">
          <Sparkles size={21} strokeWidth={1.7} aria-hidden="true" />
        </div>
        <h2 id={titleId} className="text-[22px] leading-[29px] font-semibold text-primary">У вас нет платной подписки</h2>
        <p id={descriptionId} className="mt-3 text-[15.5px] leading-[24px] text-secondary">
          На тарифе Free действуют небольшие лимиты. Вы можете продолжить работу или выбрать новый тариф, чтобы пользоваться Zipply свободнее.
        </p>
        <div className="mt-6 flex flex-col gap-2">
          <a
            href={PLANS_URL}
            target="_blank"
            rel="noreferrer"
            onClick={onOpenPlans}
            className="inline-flex min-h-[44px] w-full items-center justify-center gap-2 rounded-full bg-white px-4 py-2.5 text-[15px] font-medium text-black hover:bg-white/90 active:scale-[0.99] border-none shadow-none"
          >
            Посмотреть тарифы <ArrowUpRight size={16} strokeWidth={1.8} aria-hidden="true" />
          </a>
          <button
            ref={continueRef}
            type="button"
            onClick={onContinue}
            className="min-h-[44px] w-full rounded-full bg-control px-4 py-2.5 text-[15px] font-medium text-primary hover:bg-control-hover active:scale-[0.99] border-none shadow-none"
          >
            Продолжить с Free
          </button>
        </div>
      </div>
    </div>,
    document.body
  )
}
