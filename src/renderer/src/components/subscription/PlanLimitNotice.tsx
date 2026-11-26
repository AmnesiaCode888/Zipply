import React from 'react'
import { ArrowUpRight, CircleAlert, X } from '../../icons'

const PLANS_URL = 'https://web.zipply.my/plans'

interface PlanLimitNoticeProps {
  planLabel: string
  onDismiss: () => void
  onOpenPlans: () => void
}

export const PlanLimitNotice: React.FC<PlanLimitNoticeProps> = ({ planLabel, onDismiss, onOpenPlans }) => (
  <section
    role="status"
    aria-live="polite"
    className="flex w-full min-w-0 items-center gap-3 rounded-[20px] bg-surface-secondary px-4 py-3 border-none shadow-none"
  >
    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-control text-secondary">
      <CircleAlert size={17} strokeWidth={1.7} aria-hidden="true" />
    </span>
    <p className="min-w-0 flex-1 text-[14px] leading-[20px] text-secondary">
      <span className="font-medium text-primary">{planLabel}:</span> лимиты небольшие. Советуем перейти на новый тариф.
    </p>
    <a
      href={PLANS_URL}
      target="_blank"
      rel="noreferrer"
      onClick={onOpenPlans}
      className="inline-flex shrink-0 items-center gap-1 rounded-full bg-control px-3 py-2 text-[13px] font-medium text-primary hover:bg-control-hover active:scale-[0.98] border-none shadow-none"
    >
      Тарифы <ArrowUpRight size={14} strokeWidth={1.8} aria-hidden="true" />
    </a>
    <button
      type="button"
      aria-label="Скрыть уведомление о лимитах"
      onClick={onDismiss}
      className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-secondary hover:bg-control-hover hover:text-primary active:scale-95 border-none shadow-none"
    >
      <X size={15} strokeWidth={1.8} aria-hidden="true" />
    </button>
  </section>
)
