import React, { useEffect, useRef, useState } from 'react'
import { Clock3, LayoutGrid, LogIn, LogOut, Settings, UserRound } from '../../icons'
import { useAuth } from '../../hooks/useAuth'
import { getProfileBadge, getProfileDisplayName, getProfileInitial, getProfileSubtitle, getUsageWindows } from '../../services/authDisplay'
import type { SettingsTab } from '../settings/types'

function HomeIcon({ active }: { active: boolean }) {
  return <svg width="20" height="20" viewBox="0 0 24 24" fill={active ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M3.5 10.4 12 3.5l8.5 6.9v8.1a2 2 0 0 1-2 2h-4.2v-5.8H9.7v5.8H5.5a2 2 0 0 1-2-2z" />
  </svg>
}

function ScheduleIcon({ active }: { active: boolean }) {
  if (!active) return <Clock3 size={20} strokeWidth={1.7} aria-hidden="true" />
  return <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
    <path fillRule="evenodd" d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20ZM12 5.25a.75.75 0 0 1 .75.75v5.25H16a.75.75 0 0 1 0 1.5h-4a.75.75 0 0 1-.75-.75V6a.75.75 0 0 1 .75-.75Z" />
  </svg>
}

export type NavigationView = 'chat' | 'schedules' | 'plugins' | 'settings'

function NavigationRailView({ view, onNavigate, onSettings }: {
  view: NavigationView
  onNavigate: (view: 'chat' | 'schedules' | 'plugins') => void
  onSettings: (tab?: SettingsTab) => void
}) {
  const [menuOpen, setMenuOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)
  const profileRef = useRef<HTMLButtonElement>(null)
  const { auth, login, refresh, logout } = useAuth()
  const isAuthenticated = auth.status === 'authenticated'
  const displayName = getProfileDisplayName(auth.profile)
  const subtitle = getProfileSubtitle(auth.profile)
  const initial = getProfileInitial(auth.profile)
  const badge = getProfileBadge(auth.profile, auth.usage)
  const usageWindows = getUsageWindows(auth.usage)

  useEffect(() => {
    if (!menuOpen) return
    const closeOnOutside = (event: PointerEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) setMenuOpen(false)
    }
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { setMenuOpen(false); profileRef.current?.focus() }
    }
    document.addEventListener('pointerdown', closeOnOutside)
    document.addEventListener('keydown', closeOnEscape)
    return () => { document.removeEventListener('pointerdown', closeOnOutside); document.removeEventListener('keydown', closeOnEscape) }
  }, [menuOpen])

  return <nav aria-label="Основная навигация" className="relative z-40 flex w-14 shrink-0 flex-col items-center bg-sidebar px-1.5 pb-3 pt-2">
    <div className="flex flex-col items-center gap-2.5">
      {([
        ['chat', 'Главная'],
        ['schedules', 'Запланировано'],
        ['plugins', 'Расширения']
      ] as const).map(([id, label]) => <button key={id} type="button" aria-label={label} title={label}
        aria-current={view === id ? 'page' : undefined} onClick={() => { setMenuOpen(false); onNavigate(id) }}
        className={`flex h-10 w-10 items-center justify-center rounded-[12px] border-none shadow-none transition-colors active:scale-95 ${view === id ? 'bg-control text-strong' : 'text-secondary hover:bg-hover hover:text-primary'}`}>
        {id === 'chat' ? <HomeIcon active={view === id} /> : id === 'schedules' ? <ScheduleIcon active={view === id} /> : <LayoutGrid size={20} strokeWidth={1.7} fill={view === id ? 'currentColor' : 'none'} aria-hidden="true" />}
      </button>)}
    </div>
    <div ref={menuRef} className="relative mt-auto">
      {menuOpen && <div role="group" aria-label="Меню профиля" className="popup-glass absolute bottom-0 left-[48px] w-[264px] rounded-[23px] p-1 border-[0.5px] border-hairline shadow-none">
        <div className="flex items-center gap-3 px-3 py-2.5">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-full bg-control text-[13px] font-semibold text-primary">
            {isAuthenticated && auth.avatarDataUrl ? (
              <img src={auth.avatarDataUrl} alt={displayName} className="h-full w-full object-cover" draggable={false} />
            ) : isAuthenticated ? initial : (
              <UserRound size={16} strokeWidth={1.75} aria-hidden="true" />
            )}
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span className="truncate text-[14.5px] font-semibold text-primary">{displayName}</span>
              {isAuthenticated && badge && (
                <span className="shrink-0 rounded-full bg-control px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-primary">
                  {badge}
                </span>
              )}
            </div>
            {isAuthenticated && subtitle && (
              <p className="truncate text-[12px] leading-[16px] text-secondary">{subtitle}</p>
            )}
          </div>
        </div>
        {isAuthenticated && usageWindows.length > 0 && (
          <div className="mx-1.5 my-1 rounded-[16px] bg-hover px-3 py-2.5 space-y-2.5">
            {usageWindows.map(w => (
              <div key={w.label} className="space-y-1.5">
                <div className="flex items-center justify-between text-[12.5px] leading-none">
                  <span className="text-secondary">{w.label}</span>
                  <span className="font-semibold text-primary">{w.remainingPercent}%</span>
                </div>
                <div className="w-full h-[5px] rounded-full bg-track overflow-hidden">
                  <div
                    className="h-full rounded-full bg-accent transition-all duration-500 ease-out"
                    style={{ width: `${w.remainingPercent}%` }}
                  />
                </div>
              </div>
            ))}
          </div>
        )}
        <div className="my-1 mx-2.5 h-px bg-divider opacity-45" />
        <div className="flex flex-col gap-0.5">
          <button type="button" onClick={() => { setMenuOpen(false); onSettings('profile') }}
            className="flex w-full items-center gap-3 rounded-[19px] border-none px-3 py-2.5 text-left text-[15px] font-medium text-primary shadow-none transition-colors duration-150 hover:bg-hover active:bg-control-hover">
            <UserRound size={18} strokeWidth={1.75} aria-hidden="true" /><span>Профиль</span>
          </button>
          <button type="button" onClick={() => { setMenuOpen(false); onSettings('themes') }}
            className="flex w-full items-center gap-3 rounded-[19px] border-none px-3 py-2.5 text-left text-[15px] font-medium text-primary shadow-none transition-colors duration-150 hover:bg-hover active:bg-control-hover">
            <Settings size={18} strokeWidth={1.75} aria-hidden="true" /><span>Настройки</span>
          </button>
          <button type="button" onClick={() => {
            setMenuOpen(false)
            if (isAuthenticated) void logout()
            else void login()
          }}
            className="flex w-full items-center gap-3 rounded-[19px] border-none px-3 py-2.5 text-left text-[15px] font-medium text-primary shadow-none transition-colors duration-150 hover:bg-hover active:bg-control-hover">
            {isAuthenticated ? <LogOut size={18} strokeWidth={1.75} aria-hidden="true" /> : <LogIn size={18} strokeWidth={1.75} aria-hidden="true" />}
            <span>{isAuthenticated ? 'Выйти' : 'Войти'}</span>
          </button>
        </div>
      </div>}
      <button ref={profileRef} type="button" aria-label="Профиль" title="Профиль" aria-expanded={menuOpen} onClick={() => setMenuOpen(value => {
        const next = !value
        if (next && isAuthenticated) void refresh()
        return next
      })}
        className="flex h-10 w-10 items-center justify-center rounded-[12px] border-none text-primary shadow-none hover:bg-hover active:scale-95">
        <span className="flex h-8 w-8 items-center justify-center overflow-hidden rounded-full bg-control text-[13px] font-semibold">
          {isAuthenticated && auth.avatarDataUrl ? (
            <img src={auth.avatarDataUrl} alt={displayName} className="h-full w-full object-cover" draggable={false} />
          ) : isAuthenticated ? initial : (
            <UserRound size={16} strokeWidth={1.75} aria-hidden="true" />
          )}
        </span>
      </button>
    </div>
  </nav>
}

export const NavigationRail = React.memo(NavigationRailView)
