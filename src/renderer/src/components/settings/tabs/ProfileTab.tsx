import React, { useEffect, useRef } from 'react'
import { Download, LogOut, RefreshCw, UserRound } from '../../../icons'
import type { AuthState } from '../../../../../shared/auth'
import { ZIPPLY_DOWNLOAD_URL, type UpdateState } from '../../../../../shared/updates'
import {
  getProfileBadge,
  getProfileDisplayName,
  getProfileInitial,
  getProfileSubtitle,
  getUsageRemainingPercent,
  getUsageWindows
} from '../../../services/authDisplay'
import { SettingsHeader, cardClass } from './SettingsUI'
import { TokenActivityCard } from './TokenActivityCard'

interface ProfileTabProps {
  auth: AuthState
  busy: boolean
  onLogin: () => void
  onCancelLogin: () => void
  onRefresh: () => void
  onLogout: () => void
  updateState?: UpdateState
  onCheckUpdates?: () => void
  onOpenUpdateDownload?: () => void
}

function formatResetAt(iso?: string): string | null {
  if (!iso) return null
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return null
  return new Intl.DateTimeFormat('ru-RU', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit'
  }).format(date)
}

function formatDaysRu(count: number): string {
  const mod100 = count % 100
  const mod10 = count % 10
  if (mod100 >= 11 && mod100 <= 14) return `${count} дней`
  if (mod10 === 1) return `${count} день`
  if (mod10 >= 2 && mod10 <= 4) return `${count} дня`
  return `${count} дней`
}

export const ProfileTab: React.FC<ProfileTabProps> = ({
  auth,
  busy,
  onLogin,
  onCancelLogin,
  onRefresh,
  onLogout,
  updateState,
  onCheckUpdates,
  onOpenUpdateDownload
}) => {
  const isAuthenticated = auth.status === 'authenticated'
  const isAuthorizing = auth.status === 'authorizing'
  const displayName = getProfileDisplayName(auth.profile)
  const subtitle = getProfileSubtitle(auth.profile)
  const badge = getProfileBadge(auth.profile, auth.usage)
  const initial = getProfileInitial(auth.profile)
  const remainingPercent = getUsageRemainingPercent(auth.usage)
  const windows = getUsageWindows(auth.usage)
  const didInitialRefresh = useRef(false)

  useEffect(() => {
    if (isAuthenticated && !didInitialRefresh.current) {
      didInitialRefresh.current = true
      onRefresh()
    }
  }, [isAuthenticated, onRefresh])

  const maxDayRequests = auth.history?.days?.length
    ? Math.max(...auth.history.days.map(d => d.requests || 0))
    : 0

  const effectiveUpdate: UpdateState = updateState ?? {
    currentVersion: '0.1.0',
    status: 'idle',
    latestVersion: null,
    releaseName: null,
    releaseUrl: ZIPPLY_DOWNLOAD_URL,
    publishedAt: null,
    checkedAt: null,
    error: null
  }
  const updateSubtitle =
    effectiveUpdate.status === 'checking'
      ? 'Проверяем наличие обновлений…'
      : effectiveUpdate.status === 'available' && effectiveUpdate.latestVersion
        ? `Доступна новая версия v${effectiveUpdate.latestVersion}`
        : effectiveUpdate.status === 'up-to-date'
          ? 'Установлена актуальная версия'
          : effectiveUpdate.status === 'error'
            ? (effectiveUpdate.error || 'Не удалось проверить обновления')
            : 'Проверка релизов на GitHub · загрузка на zipply.my'

  const updatesCard = (
    <div>
      <h2 className="mb-3 text-[15px] font-semibold text-primary">Обновления приложения</h2>
      <div className={cardClass}>
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-[15px] font-medium text-primary">
                Zipply v{effectiveUpdate.currentVersion}
              </span>
              {effectiveUpdate.status === 'available' && effectiveUpdate.latestVersion && (
                <span className="rounded-full bg-control px-2.5 py-0.5 text-[11.5px] font-semibold text-primary">
                  v{effectiveUpdate.latestVersion}
                </span>
              )}
            </div>
            <p className="mt-1 text-[13.5px] leading-[20px] text-secondary">
              {updateSubtitle}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {effectiveUpdate.status === 'available' && onOpenUpdateDownload && (
              <button
                type="button"
                onClick={onOpenUpdateDownload}
                className="inline-flex items-center gap-1.5 rounded-full px-4 py-2 bg-accent hover:bg-accent-hover text-[13.5px] font-medium text-on-accent active:scale-95 transition-all border-none shadow-none cursor-pointer"
              >
                <Download size={14} aria-hidden="true" />
                <span>Скачать на zipply.my</span>
              </button>
            )}
            {onCheckUpdates && (
              <button
                type="button"
                onClick={onCheckUpdates}
                disabled={effectiveUpdate.status === 'checking'}
                className="inline-flex items-center gap-1.5 rounded-full px-4 py-2 bg-surface-elevated hover:bg-control text-[13.5px] font-medium text-primary active:scale-95 transition-all disabled:opacity-50 disabled:cursor-not-allowed border-none shadow-none cursor-pointer"
              >
                <RefreshCw
                  size={14}
                  strokeWidth={1.75}
                  className={effectiveUpdate.status === 'checking' ? 'animate-spin' : ''}
                  aria-hidden="true"
                />
                <span>Проверить</span>
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )

  return (
    <div className="space-y-7">
      {auth.error && (
        <div role="alert" className="rounded-[20px] bg-surface px-5 py-4 text-[14.5px] leading-[22px] text-secondary border-none shadow-none">
          {auth.error}
        </div>
      )}

      {!isAuthenticated ? (
        <>
          <SettingsHeader
            icon={UserRound}
            title="Профиль"
            description="Аккаунт Zipply и текущие лимиты использования."
          />
          <div className={cardClass}>
            <div className="flex items-center gap-4">
              <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-surface-elevated text-secondary">
                <UserRound size={24} strokeWidth={1.75} aria-hidden="true" />
              </div>
              <div className="min-w-0 flex-1">
                <h2 className="text-[17px] font-semibold text-primary">Вход в аккаунт Zipply</h2>
                <p className="mt-1 text-[14px] leading-[21px] text-secondary">
                  {isAuthorizing
                    ? 'Завершите вход в открывшемся окне браузера.'
                    : 'Войдите через браузер, чтобы синхронизировать профиль, лимиты и веб-поиск.'}
                </p>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-3 pt-2">
              {isAuthorizing ? (
                <button
                  type="button"
                  onClick={onCancelLogin}
                  className="rounded-full px-5 py-2.5 bg-surface-elevated hover:bg-control text-[14.5px] font-medium text-primary active:scale-95 transition-all border-none shadow-none cursor-pointer"
                >
                  Отменить вход
                </button>
              ) : (
                <button
                  type="button"
                  onClick={onLogin}
                  disabled={busy}
                  className="rounded-full px-5 py-2.5 bg-accent hover:bg-accent-hover text-[14.5px] font-medium text-on-accent active:scale-95 transition-all disabled:opacity-50 disabled:cursor-not-allowed border-none shadow-none cursor-pointer"
                >
                  Войти через Zipply
                </button>
              )}
            </div>
          </div>
          {updatesCard}
        </>
      ) : (
        <>
          {/* Centered Hero Profile Header */}
          <div className="relative flex flex-col items-center text-center pt-2 pb-1">
            <div className="absolute right-0 top-0 flex items-center gap-2">
              <button
                type="button"
                onClick={onRefresh}
                disabled={busy}
                aria-label="Обновить данные профиля"
                title="Обновить"
                className="flex h-9 w-9 items-center justify-center rounded-full bg-surface hover:bg-surface-elevated text-secondary hover:text-primary active:scale-95 transition-all disabled:opacity-50 border-none shadow-none cursor-pointer"
              >
                <RefreshCw size={15} strokeWidth={1.75} className={busy ? 'animate-spin' : ''} aria-hidden="true" />
              </button>
              <button
                type="button"
                onClick={onLogout}
                disabled={busy}
                aria-label="Выйти из аккаунта"
                title="Выйти"
                className="inline-flex h-9 items-center gap-1.5 rounded-full px-3.5 bg-surface hover:bg-surface-elevated text-[13.5px] font-medium text-secondary hover:text-primary active:scale-95 transition-all disabled:opacity-50 border-none shadow-none cursor-pointer"
              >
                <LogOut size={14} strokeWidth={1.75} aria-hidden="true" />
                <span>Выйти</span>
              </button>
            </div>

            <div className="h-20 w-20 overflow-hidden rounded-full bg-control flex items-center justify-center">
              {auth.avatarDataUrl ? (
                <img
                  src={auth.avatarDataUrl}
                  alt={displayName}
                  className="h-full w-full object-cover select-none pointer-events-none"
                  draggable={false}
                />
              ) : (
                <span className="text-[26px] font-semibold text-primary select-none">{initial}</span>
              )}
            </div>

            <div className="mt-3.5 flex items-center justify-center gap-2 flex-wrap">
              <h1 className="text-[22px] font-bold tracking-tight text-primary">{displayName}</h1>
              {badge && (
                <span className="px-2 py-0.5 rounded-full bg-control text-[11px] font-semibold text-primary tracking-wider uppercase select-none">
                  {badge}
                </span>
              )}
            </div>

            {subtitle && (
              <p className="mt-0.5 text-[14.5px] text-secondary">{subtitle}</p>
            )}
          </div>

          {/* Horizontal Summary Stats Bar */}
          {auth.history && (
            <div className="rounded-[20px] bg-surface px-3 py-4 grid grid-cols-2 sm:grid-cols-5 gap-y-4">
              {([
                ['Всего запросов', String(auth.history.totalRequests)],
                ['Максимум за день', String(maxDayRequests)],
                ['Активных дней', String(auth.history.activeDays)],
                ['Самая длинная серия', formatDaysRu(auth.history.longestStreakDays)],
                ['Текущая серия', formatDaysRu(auth.history.currentStreakDays)]
              ] as const).map(([label, value], idx) => (
                <div
                  key={label}
                  className={`flex flex-col items-center justify-center text-center px-3 ${
                    idx > 0 ? 'sm:border-l sm:border-subtle' : ''
                  }`}
                >
                  <span className="text-[17px] font-semibold text-primary leading-tight">{value}</span>
                  <span className="mt-1 text-[12px] leading-[16px] text-secondary">{label}</span>
                </div>
              ))}
            </div>
          )}

          {/* Usage Limits */}
          <div>
            <h2 className="mb-3 text-[15px] font-semibold text-primary">Лимиты использования</h2>
            <div className={cardClass}>
              {windows.length > 0 ? (
                <div className="space-y-4">
                  {windows.map((w) => {
                    const resetLabel = formatResetAt(w.resetsAt)
                    return (
                      <div key={w.label} className="space-y-2">
                        <div className="flex items-center justify-between text-[14.5px]">
                          <span className="font-medium text-primary">{w.label}</span>
                          <span className="text-secondary">
                            Осталось <strong className="font-medium text-primary">{w.remainingPercent}%</strong>
                          </span>
                        </div>
                        <div className="w-full h-[6px] rounded-full bg-track overflow-hidden">
                          <div
                            className="h-full rounded-full bg-accent transition-all duration-500 ease-out"
                            style={{ width: `${w.remainingPercent}%` }}
                          />
                        </div>
                        {resetLabel && (
                          <p className="text-[12.5px] text-secondary">
                            Обновление лимита: {resetLabel}
                          </p>
                        )}
                      </div>
                    )
                  })}
                </div>
              ) : remainingPercent !== null ? (
                <div className="space-y-2.5">
                  <div className="flex items-center justify-between text-[14.5px]">
                    <span className="font-medium text-primary">Доступный остаток</span>
                    <span className="font-medium text-primary">{remainingPercent}%</span>
                  </div>
                  <div className="w-full h-[6px] rounded-full bg-track overflow-hidden">
                    <div
                      className="h-full rounded-full bg-accent transition-all duration-500 ease-out"
                      style={{ width: `${remainingPercent}%` }}
                    />
                  </div>
                </div>
              ) : (
                <p className="text-[14.5px] leading-[22px] text-secondary">
                  {auth.usage ? 'Аккаунт активен. Лимиты обновляются автоматически при запросах.' : busy ? 'Загрузка данных о лимитах…' : 'Данные о лимитах пока не получены. Нажмите «Обновить».'}
                </p>
              )}
            </div>
          </div>

          {/* Token Activity Heatmap */}
          <TokenActivityCard history={auth.history} />

          {/* App Version & Updates */}
          {updatesCard}
        </>
      )}
    </div>
  )
}
