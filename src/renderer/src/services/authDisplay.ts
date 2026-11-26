import type { UsageInfo, UsageWindow, UserProfile } from '../../../shared/auth'

export function getProfileDisplayName(profile: UserProfile | null): string {
  if (!profile) return 'Аккаунт Zipply'
  const tg = profile.telegramProfile
  const fullName = [tg?.firstName, tg?.lastName].filter((s): s is string => typeof s === 'string' && s.trim().length > 0).join(' ').trim()
  const candidate =
    profile.displayName ||
    tg?.displayName ||
    fullName ||
    profile.name ||
    tg?.username ||
    profile.username ||
    profile.email
  return typeof candidate === 'string' && candidate.trim() ? candidate.trim() : 'Пользователь Zipply'
}

export function getProfileSubtitle(profile: UserProfile | null): string | null {
  if (!profile) return null
  const primary = getProfileDisplayName(profile)
  const email = typeof profile.email === 'string' ? profile.email.trim() : ''
  if (email && email !== primary) return email
  const username = (typeof profile.telegramProfile?.username === 'string' ? profile.telegramProfile.username : profile.username) || ''
  const cleanUsername = username.trim().replace(/^@/, '')
  if (cleanUsername && cleanUsername !== primary) return `@${cleanUsername}`
  return null
}

export function getProfileBadge(profile: UserProfile | null, usage?: UsageInfo | null): string | null {
  const activePlan = usage?.active?.plan || usage?.active?.tier || usage?.active?.name || usage?.active?.planId
  if (typeof activePlan === 'string' && activePlan.trim()) return activePlan.trim().toUpperCase()
  if (!profile) return null
  if (typeof profile.plan === 'string' && profile.plan.trim()) return profile.plan.trim().toUpperCase()
  if (typeof profile.tier === 'string' && profile.tier.trim()) return profile.tier.trim().toUpperCase()
  if (profile.isPro === true) return 'PRO'
  return null
}

export function getProfileInitial(profile: UserProfile | null): string {
  const name = getProfileDisplayName(profile)
  return (name[0] || 'Z').toUpperCase()
}

export function getWindowRemainingPercent(w?: UsageWindow | null): number | null {
  if (!w) return null
  if (typeof w.remainingPercent === 'number' && Number.isFinite(w.remainingPercent)) {
    return Math.max(0, Math.min(100, Math.round(w.remainingPercent)))
  }
  if (typeof w.usedPercent === 'number' && Number.isFinite(w.usedPercent)) {
    return Math.max(0, Math.min(100, Math.round(100 - w.usedPercent)))
  }
  if (typeof w.limit === 'number' && w.limit > 0) {
    const spent = typeof w.spent === 'number' ? w.spent : (typeof w.used === 'number' ? w.used : 0)
    const reserved = typeof w.reserved === 'number' ? w.reserved : 0
    const remaining = Math.max(0, w.limit - spent - reserved)
    return Math.max(0, Math.min(100, Math.round((remaining / w.limit) * 100)))
  }
  return null
}

export interface NormalizedUsageWindow {
  label: string
  remainingPercent: number
  usedPercent: number
  resetsAt?: string
}

export function getUsageWindows(usage: UsageInfo | null): NormalizedUsageWindow[] {
  if (!usage) return []
  const result: NormalizedUsageWindow[] = []

  const pushWindow = (label: string, w?: UsageWindow | null) => {
    const pct = getWindowRemainingPercent(w)
    if (pct === null) return
    result.push({
      label,
      remainingPercent: pct,
      usedPercent: 100 - pct,
      resetsAt: w?.resetsAt || w?.resetAt
    })
  }

  if (usage.fiveHours) pushWindow('За 5 часов', usage.fiveHours)
  if (usage.week) pushWindow('За неделю', usage.week)

  if (result.length === 0 && Array.isArray(usage.windows)) {
    usage.windows.forEach((w, idx) => {
      pushWindow(w.label || w.name || `Окно ${idx + 1}`, w)
    })
  }

  return result
}

export function getUsageRemainingPercent(usage: UsageInfo | null): number | null {
  if (!usage) return null
  const windows = getUsageWindows(usage)
  if (windows.length > 0) {
    return Math.min(...windows.map(w => w.remainingPercent))
  }
  return getWindowRemainingPercent(usage)
}
