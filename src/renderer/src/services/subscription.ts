import type { UsageInfo, UserProfile } from '../../../shared/auth'

export type SubscriptionCategory = 'premium' | 'free' | 'limited' | 'unknown'

export interface SubscriptionInfo {
  category: SubscriptionCategory
  planCode: string | null
  label: string | null
}

const PREMIUM_PLANS = new Set(['pro', 'max', 'pro-year', 'max-year', 'pro-max'])
const LIMITED_PLANS = new Set(['trial', 'lite', 'lite-year'])

function normalizePlanCode(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const normalized = value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase()
    .replace(/[\s_]+/g, '-')
    .replace(/-+/g, '-')
  return normalized || null
}

function readPlanCode(value: unknown): string | null {
  const direct = normalizePlanCode(value)
  if (direct) return direct
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null

  const record = value as Record<string, unknown>
  for (const key of ['plan', 'planId', 'tier', 'name', 'code', 'id']) {
    const candidate = normalizePlanCode(record[key])
    if (candidate) return candidate
  }
  return null
}

function planLabel(planCode: string | null): string | null {
  if (!planCode) return null
  if (planCode === 'trial') return 'Пробный тариф'
  if (planCode === 'lite-year') return 'Lite · годовой'
  if (planCode === 'lite') return 'Lite'
  if (planCode === 'free') return 'Free'
  if (planCode === 'pro-year') return 'Pro · годовой'
  if (planCode === 'max-year') return 'Max · годовой'
  if (planCode === 'pro' || planCode === 'max' || planCode === 'pro-max') return planCode.toUpperCase()
  return planCode
}

export function getSubscriptionInfo(profile: UserProfile | null, usage: UsageInfo | null): SubscriptionInfo {
  const profileRecord = profile as (UserProfile & Record<string, unknown>) | null
  const planCode = [
    usage?.active?.plan,
    usage?.active?.planId,
    usage?.active?.tier,
    usage?.active?.name,
    profile?.plan,
    profile?.tier,
    profileRecord?.subscription,
    profileRecord?.activeSubscription
  ].map(readPlanCode).find((value): value is string => Boolean(value)) ?? null

  if (planCode && PREMIUM_PLANS.has(planCode)) return { category: 'premium', planCode, label: planLabel(planCode) }
  if (planCode && LIMITED_PLANS.has(planCode)) return { category: 'limited', planCode, label: planLabel(planCode) }
  if (planCode === 'free' || (!planCode && profile?.isPro === false)) {
    return { category: 'free', planCode: planCode || 'free', label: 'Free' }
  }
  if (!planCode && profile?.isPro === true) return { category: 'premium', planCode: 'pro', label: 'PRO' }
  return { category: 'unknown', planCode, label: planLabel(planCode) }
}

export function getFreePlanConsentKey(profile: UserProfile | null): string | null {
  const identity = profile?.id || profile?.email || profile?.username || profile?.telegramProfile?.telegramUserId
  if (identity === undefined || identity === null || String(identity).trim() === '') return null
  return `zipply:free-plan-accepted:${encodeURIComponent(String(identity).trim().toLowerCase())}`
}

export function hasAcceptedFreePlan(key: string | null): boolean {
  if (!key || typeof window === 'undefined') return false
  try {
    return window.localStorage.getItem(key) === '1'
  } catch {
    return false
  }
}

export function rememberFreePlanAcceptance(key: string | null): boolean {
  if (!key || typeof window === 'undefined') return false
  try {
    window.localStorage.setItem(key, '1')
    return true
  } catch {
    return false
  }
}
