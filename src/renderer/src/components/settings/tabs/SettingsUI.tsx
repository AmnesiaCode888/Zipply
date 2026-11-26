import React, { useState } from 'react'
import { Eye, EyeOff, type LucideIcon } from '../../../icons'

export const fieldClass = 'w-full min-w-0 bg-surface-elevated text-primary placeholder-muted text-[15px] leading-[23px] px-4 py-3 rounded-[14px] outline-none border-none shadow-none select-text'
export const cardClass = 'p-5 bg-surface rounded-[20px] flex flex-col gap-3 border-none shadow-none'

export function SettingsHeader({ title, description }: { icon: LucideIcon; title: string; description: string }) {
  return <header><h1 className="text-[26px] font-bold text-primary tracking-tight">{title}</h1><p className="mt-2 text-[15px] leading-[23px] text-secondary">{description}</p></header>
}

export function SettingRow({ title, description, children }: { title: React.ReactNode; description: React.ReactNode; children: React.ReactNode }) {
  return <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 sm:gap-6 py-2"><div className="min-w-0"><div className="text-[15px] font-medium text-primary">{title}</div><p className="mt-1 text-[14px] leading-[21px] text-secondary">{description}</p></div><div className="shrink-0 sm:max-w-[45%]">{children}</div></div>
}

export function SettingsSwitch({ id, checked, onChange }: { id: string; checked: boolean; onChange: (checked: boolean) => void }) {
  return <span className="relative inline-flex items-center"><input id={id} role="switch" type="checkbox" checked={checked} onChange={event => onChange(event.target.checked)} className="peer sr-only" /><span aria-hidden="true" className={`relative h-6 w-11 rounded-full transition-colors ${checked ? 'bg-accent' : 'bg-track'}`}><span className={`absolute top-1 h-4 w-4 rounded-full transition-all ${checked ? 'left-6 bg-on-accent' : 'left-1 bg-primary'}`} /></span><span aria-hidden="true" className="absolute -right-3 hidden text-primary peer-focus-visible:inline">•</span></span>
}

export function Field({ id, label, description, children }: { id: string; label: string; description: string; children: React.ReactNode }) {
  return <div className={cardClass}><div><label htmlFor={id} className="text-[16px] font-medium text-primary">{label}</label><p className="mt-1 text-[14px] leading-[21px] text-secondary">{description}</p></div>{children}</div>
}

export function SecretField({ id, value, onChange, placeholder }: { id: string; value: string; onChange: (value: string) => void; placeholder: string }) {
  const [visible, setVisible] = useState(false)
  return <div className="relative"><input id={id} type={visible ? 'text' : 'password'} value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder} autoComplete="off" className={`${fieldClass} pr-12 font-mono`} /><button type="button" onClick={() => setVisible(!visible)} aria-label={visible ? 'Скрыть ключ' : 'Показать ключ'} className="absolute right-3 top-1/2 -translate-y-1/2 p-2 rounded-full text-secondary hover:text-primary border-none shadow-none">{visible ? <EyeOff size={17} /> : <Eye size={17} />}</button></div>
}
