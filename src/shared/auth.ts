export type AuthStatus = 'anonymous' | 'authorizing' | 'authenticated'

export interface TelegramProfile {
  telegramUserId?: number
  username?: string
  firstName?: string
  lastName?: string
  displayName?: string
  avatarUrl?: string
}

export interface UserProfile {
  id?: string
  email?: string
  name?: string
  displayName?: string
  username?: string
  plan?: string
  tier?: string
  isPro?: boolean
  telegramProfile?: TelegramProfile
  [key: string]: unknown
}

export interface UsageWindow {
  name?: string
  label?: string
  spent?: number
  reserved?: number
  used?: number
  limit?: number
  remaining?: number
  remainingApprox?: number
  remainingPercent?: number
  usedPercent?: number
  resetsAt?: string
  resetAt?: string
  [key: string]: unknown
}

export interface UsageInfo {
  fiveHours?: UsageWindow
  week?: UsageWindow
  active?: {
    plan?: string
    planId?: string
    tier?: string
    name?: string
    [key: string]: unknown
  } | null
  remainingPercent?: number
  usedPercent?: number
  used?: number
  limit?: number
  remaining?: number
  resetAt?: string
  windows?: UsageWindow[]
  exhaustedWindows?: unknown[]
  [key: string]: unknown
}

export interface UsageHistoryDay {
  date: string
  requests: number
  units: number
  level: number
}

export interface UsageHistory {
  fromDate: string
  toDate: string
  timeZoneId: string
  totalRequests: number
  totalUnits: number
  activeDays: number
  currentStreakDays: number
  longestStreakDays: number
  days: UsageHistoryDay[]
}

export interface AuthState {
  status: AuthStatus
  subscriptionReady: boolean
  profile: UserProfile | null
  avatarDataUrl: string | null
  usage: UsageInfo | null
  history: UsageHistory | null
  error: string | null
  scope: string | null
}
