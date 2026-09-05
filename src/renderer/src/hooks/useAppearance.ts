import { useState, useEffect, useCallback } from 'react'
import {
  AppearanceConfig,
  ThemeType,
  AccentColorType,
  CustomThemeColors
} from '../types/settings'

export const APPEARANCE_STORAGE_KEY = 'zipply_appearance_config'

export const DEFAULT_CUSTOM_THEME: CustomThemeColors = {
  bgPrimary: '#111111',
  bgSidebar: '#161616',
  bgSurface: '#1E1E1E',
  textPrimary: '#FFFFFF',
  accentColor: '#FFFFFF'
}

export const DEFAULT_APPEARANCE: AppearanceConfig = {
  theme: 'dark',
  accentColor: 'monochrome',
  fontFamily: 'Inter',
  fontSize: 14,
  uiScale: 100,
  compactMode: false,
  smoothAnimations: true,
  customTheme: DEFAULT_CUSTOM_THEME
}

export interface ThemeOption {
  id: ThemeType
  name: string
  subtitle: string
  tag?: string
  bgPrimary: string
  bgSurface: string
  bgSidebar: string
  accentColor: string
  textColor: string
  isDark: boolean
}

export const THEME_OPTIONS: ThemeOption[] = [
  {
    id: 'dark',
    name: 'Тёмная',
    subtitle: 'Классический нейтральный Carbon',
    tag: 'По умолчанию',
    bgPrimary: '#0D0D0D',
    bgSurface: '#1E1E1E',
    bgSidebar: '#121212',
    accentColor: '#FFFFFF',
    textColor: '#FFFFFF',
    isDark: true
  },
  {
    id: 'oled',
    name: 'OLED',
    subtitle: 'Абсолютный чёрный для OLED-дисплеев',
    tag: 'Контрастная',
    bgPrimary: '#000000',
    bgSurface: '#0E0E0E',
    bgSidebar: '#050505',
    accentColor: '#FFFFFF',
    textColor: '#FFFFFF',
    isDark: true
  },
  {
    id: 'light',
    name: 'Светлая',
    subtitle: 'Чистая, светлая и контрастная студия',
    tag: 'Светлая',
    bgPrimary: '#F4F5F8',
    bgSurface: '#FFFFFF',
    bgSidebar: '#ECEEF2',
    accentColor: '#2563EB',
    textColor: '#111827',
    isDark: false
  },
  {
    id: 'midnight',
    name: 'Полночь',
    subtitle: 'Глубокие индиго и тёмно-синие тона',
    tag: 'Ночная',
    bgPrimary: '#0A0E17',
    bgSurface: '#1E293B',
    bgSidebar: '#0F172A',
    accentColor: '#6366F1',
    textColor: '#F8FAFC',
    isDark: true
  }
]

export interface AccentOption {
  id: AccentColorType
  name: string
  color: string
}

export const ACCENT_OPTIONS: AccentOption[] = [
  { id: 'blue', name: 'Синий', color: '#3B82F6' },
  { id: 'emerald', name: 'Изумрудный', color: '#10B981' },
  { id: 'purple', name: 'Фиолетовый', color: '#8B5CF6' },
  { id: 'amber', name: 'Янтарный', color: '#F59E0B' },
  { id: 'crimson', name: 'Рубиновый', color: '#F43F5E' },
  { id: 'cyan', name: 'Бирюзовый', color: '#06B6D4' },
  { id: 'monochrome', name: 'Монохром', color: '#FFFFFF' }
]

function hexToRgb(hex: string): string {
  const clean = hex.replace('#', '')
  if (clean.length === 3) {
    const r = parseInt(clean[0] + clean[0], 16)
    const g = parseInt(clean[1] + clean[1], 16)
    const b = parseInt(clean[2] + clean[2], 16)
    return `${r}, ${g}, ${b}`
  }
  const r = parseInt(clean.substring(0, 2) || '00', 16)
  const g = parseInt(clean.substring(2, 4) || '00', 16)
  const b = parseInt(clean.substring(4, 6) || '00', 16)
  return `${r}, ${g}, ${b}`
}

function isLightColor(hex: string): boolean {
  const clean = hex.replace('#', '')
  const r = parseInt(clean.substring(0, 2) || '00', 16)
  const g = parseInt(clean.substring(2, 4) || '00', 16)
  const b = parseInt(clean.substring(4, 6) || '00', 16)
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255
  return luminance > 0.5
}

function darkenColor(hex: string, amount = 0.15): string {
  const clean = hex.replace('#', '')
  const r = Math.max(0, Math.round(parseInt(clean.substring(0, 2) || '00', 16) * (1 - amount)))
  const g = Math.max(0, Math.round(parseInt(clean.substring(2, 4) || '00', 16) * (1 - amount)))
  const b = Math.max(0, Math.round(parseInt(clean.substring(4, 6) || '00', 16) * (1 - amount)))
  return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`
}

/**
 * Executes a state update with a silky-smooth circular view transition originating from click coordinates
 */
export function executeWithThemeTransition(
  callback: () => void,
  origin?: { x: number; y: number }
): void {
  const doc = document as unknown as {
    startViewTransition?: (cb: () => void) => { ready: Promise<void> }
  }

  if (
    typeof doc.startViewTransition !== 'function' ||
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  ) {
    callback()
    return
  }

  const x = origin?.x ?? window.innerWidth / 2
  const y = origin?.y ?? window.innerHeight / 2
  const maxRadius = Math.hypot(
    Math.max(x, window.innerWidth - x),
    Math.max(y, window.innerHeight - y)
  )

  try {
    const transition = doc.startViewTransition(() => {
      callback()
    })

    transition.ready
      .then(() => {
        document.documentElement.animate(
          {
            clipPath: [
              `circle(0px at ${x}px ${y}px)`,
              `circle(${maxRadius}px at ${x}px ${y}px)`
            ]
          },
          {
            duration: 380,
            easing: 'cubic-bezier(0.2, 0, 0, 1)',
            pseudoElement: '::view-transition-new(root)'
          }
        )
      })
      .catch(() => {})
  } catch {
    callback()
  }
}

export function applyAppearanceToDOM(config: AppearanceConfig): void {
  const root = document.documentElement
  if (!root) return

  // Theme
  root.setAttribute('data-theme', config.theme)

  // Accent
  if (config.accentColor === 'custom' && config.accentCustomColor) {
    root.setAttribute('data-accent', 'custom')
    const acc = config.accentCustomColor
    root.style.setProperty('--accent-primary', acc)
    root.style.setProperty('--accent-hover', darkenColor(acc, 0.15))
    root.style.setProperty('--accent-light', `rgba(${hexToRgb(acc)}, 0.15)`)
    root.style.setProperty('--accent-glow', `rgba(${hexToRgb(acc)}, 0.25)`)
    root.style.setProperty('--accent-text', acc)
    root.style.setProperty('--accent-rgb', hexToRgb(acc))
    root.style.setProperty('--accent-contrast', isLightColor(acc) ? '#0F172A' : '#FFFFFF')
  } else {
    root.setAttribute('data-accent', config.accentColor)
    root.style.removeProperty('--accent-primary')
    root.style.removeProperty('--accent-hover')
    root.style.removeProperty('--accent-light')
    root.style.removeProperty('--accent-glow')
    root.style.removeProperty('--accent-text')
    root.style.removeProperty('--accent-rgb')
    root.style.removeProperty('--accent-contrast')
  }

  // Custom theme colors
  if (config.theme === 'custom' && config.customTheme) {
    const ct = config.customTheme
    root.style.setProperty('--custom-bg-primary', ct.bgPrimary)
    root.style.setProperty('--custom-bg-sidebar', ct.bgSidebar)
    root.style.setProperty('--custom-bg-surface', ct.bgSurface)
    root.style.setProperty('--custom-text-primary', ct.textPrimary)
    root.style.setProperty('--custom-accent', ct.accentColor)
  }

  // Font family
  const fontFamilyMap: Record<string, string> = {
    Inter: "'Inter Variable', 'Inter', -apple-system, BlinkMacSystemFont, sans-serif",
    'JetBrains Mono': "'JetBrains Mono', monospace",
    'Fira Code': "'Fira Code', 'JetBrains Mono', monospace",
    'Cascadia Code': "'Cascadia Code', 'JetBrains Mono', monospace",
    System: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif"
  }
  const family = fontFamilyMap[config.fontFamily] || fontFamilyMap['Inter']
  root.style.setProperty('--font-custom-family', family)

  // Font size
  root.style.setProperty('--app-font-size-base', `${config.fontSize || 14}px`)

  // UI scale
  if (config.uiScale && config.uiScale !== 100) {
    root.style.setProperty('--app-ui-scale', `${config.uiScale / 100}`)
  } else {
    root.style.removeProperty('--app-ui-scale')
  }

  // Compact Mode
  if (config.compactMode) {
    root.setAttribute('data-compact', 'true')
  } else {
    root.removeAttribute('data-compact')
  }

  // Smooth Animations
  if (config.smoothAnimations === false) {
    root.setAttribute('data-no-animations', 'true')
  } else {
    root.removeAttribute('data-no-animations')
  }
}

export function persistAppearance(updated: AppearanceConfig): void {
  try {
    localStorage.setItem(APPEARANCE_STORAGE_KEY, JSON.stringify(updated))
  } catch (e) {
    console.warn('Failed to save appearance config to localStorage:', e)
  }
  if (window.api?.storage?.setStore) {
    window.api.storage.setStore('appearance', updated, 300).catch((err) => {
      console.warn('Failed to save appearance config to file storage:', err)
    })
  }
}

export function useAppearance() {
  const [appearance, setAppearanceState] = useState<AppearanceConfig>(() => {
    try {
      const saved = localStorage.getItem(APPEARANCE_STORAGE_KEY) ||
                    localStorage.getItem('zipple_appearance_config') ||
                    localStorage.getItem('clickcoder_appearance_config') ||
                    localStorage.getItem('clickcode_appearance_config') ||
                    localStorage.getItem('click_appearance_config')
      if (saved) {
        const parsed = JSON.parse(saved)
        if (parsed.accentColor === 'blue') {
          parsed.accentColor = 'monochrome'
        }
        return { ...DEFAULT_APPEARANCE, ...parsed }
      }
    } catch (e) {
      console.warn('Failed to load appearance config:', e)
    }
    return DEFAULT_APPEARANCE
  })

  // Hydrate from persistent file storage
  useEffect(() => {
    if (window.api?.storage?.getStore) {
      window.api.storage
        .getStore<Partial<AppearanceConfig>>('appearance')
        .then((fileData) => {
          if (fileData && typeof fileData === 'object' && Object.keys(fileData).length > 0) {
            setAppearanceState((prev) => {
              const merged = { ...prev, ...fileData }
              try {
                localStorage.setItem(APPEARANCE_STORAGE_KEY, JSON.stringify(merged))
              } catch {}
              return merged
            })
          }
        })
        .catch(() => {})
    }
  }, [])

  // Apply on mount and changes
  useEffect(() => {
    applyAppearanceToDOM(appearance)
  }, [appearance])

  const setAppearance = useCallback((newConfig: AppearanceConfig | ((prev: AppearanceConfig) => AppearanceConfig)) => {
    setAppearanceState((prev) => {
      const updated = typeof newConfig === 'function' ? newConfig(prev) : newConfig
      persistAppearance(updated)
      return updated
    })
  }, [])

  const updateAppearance = useCallback((partial: Partial<AppearanceConfig>) => {
    setAppearance((prev) => ({ ...prev, ...partial }))
  }, [setAppearance])

  const updateAppearanceWithTransition = useCallback(
    (partial: Partial<AppearanceConfig>, origin?: { x: number; y: number }) => {
      executeWithThemeTransition(() => {
        setAppearance((prev) => ({ ...prev, ...partial }))
      }, origin)
    },
    [setAppearance]
  )

  const resetAppearance = useCallback(() => {
    executeWithThemeTransition(() => {
      setAppearance(DEFAULT_APPEARANCE)
    })
  }, [setAppearance])

  return {
    appearance,
    setAppearance,
    updateAppearance,
    updateAppearanceWithTransition,
    resetAppearance,
    themes: THEME_OPTIONS,
    accents: ACCENT_OPTIONS
  }
}
