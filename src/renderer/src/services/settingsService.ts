import { appStorage } from './appStorage'
import { isValidChatSessions } from '../../../shared/chatValidation'
import { DEFAULT_MODEL_CONTEXT_LENGTH, getModelContextLength } from '../../../shared/models'
import { normalizeTerminalShell, type TerminalShellPreference } from '../../../shared/terminal'
import { ChatSession } from '../types/chat'

export type AppTheme = 'obsidian' | 'light' | 'oled' | 'claude' | 'codex' | 'custom'
export type AccessMode = 'read-only' | 'confirm' | 'automatic' | 'unrestricted'
export type ReasoningEffort = 'off' | 'low' | 'high' | 'max'

export interface CustomThemeColors {
  name: string
  canvas: string
  sidebar: string
  surface: string
  control: string
  accent: string
  textPrimary: string
  textSecondary: string
}

export const DEFAULT_CUSTOM_THEME: CustomThemeColors = {
  name: 'Моя тема',
  canvas: '#0D1117',
  sidebar: '#121720',
  surface: '#19202B',
  control: '#232C3B',
  accent: '#0A84FF',
  textPrimary: '#E6EDF3',
  textSecondary: '#8B949E'
}

export interface AppSettings {
  theme: AppTheme
  customTheme?: CustomThemeColors
  defaultModel: string
  reasoningEffort?: ReasoningEffort
  systemPrompt: string
  localOnly: boolean
  accessMode: AccessMode
  terminalShell: TerminalShellPreference
}

const SETTINGS_KEY = 'zipply_app_settings_v1'
export const DEFAULT_CONTEXT_LENGTH = DEFAULT_MODEL_CONTEXT_LENGTH
export const DEFAULT_ZIPPLY_MODEL = 'deepseek-v4-1-flash-1017-uncensored'
export const DEFAULT_REASONING_EFFORT: ReasoningEffort = 'high'

export const DEFAULT_AGENT_INSTRUCTION = 'Помогай с вопросами, исследованиями и разработкой. Подбирай глубину ответа под задачу и честно сообщай о проверках и ограничениях.'

const DEFAULT_SETTINGS: AppSettings = {
  theme: 'obsidian',
  defaultModel: DEFAULT_ZIPPLY_MODEL,
  reasoningEffort: DEFAULT_REASONING_EFFORT,
  systemPrompt: DEFAULT_AGENT_INSTRUCTION,
  localOnly: true,
  accessMode: 'confirm',
  terminalShell: 'auto'
}

const VALID_THEMES: ReadonlySet<string> = new Set(['obsidian', 'light', 'oled', 'claude', 'codex', 'custom'])

export function loadSettings(): AppSettings {
  try {
    const raw = appStorage.getItem(SETTINGS_KEY)
    const parsed = raw ? JSON.parse(raw) : {}
    delete parsed.contextLength
    delete parsed.apiKey
    delete parsed.tavilyApiKey
    delete parsed.openRouterModel
    delete parsed.classifierModel
    delete parsed.baseUrl
    return {
      ...DEFAULT_SETTINGS,
      ...parsed,
      theme: VALID_THEMES.has(parsed.theme) ? parsed.theme : 'obsidian',
      customTheme: parsed.customTheme && typeof parsed.customTheme === 'object'
        ? { ...DEFAULT_CUSTOM_THEME, ...parsed.customTheme }
        : undefined,
      systemPrompt: parsed.systemPrompt === 'Ты первоклассный ИИ-разработчик и ассистент. Отвечай предельно кратко, емко и по существу, без лишней воды и пустых вступлений. В задачах с кодом действуй напрямую через инструменты.' ? DEFAULT_SETTINGS.systemPrompt : (parsed.systemPrompt ?? DEFAULT_SETTINGS.systemPrompt),
      accessMode: ['read-only', 'confirm', 'automatic', 'unrestricted'].includes(parsed.accessMode) ? parsed.accessMode : 'confirm',
      terminalShell: normalizeTerminalShell(parsed.terminalShell)
    }
  } catch {
    return DEFAULT_SETTINGS
  }
}

export function toChatConfig(settings: AppSettings, mode?: string, workspacePath?: string) {
  const model = (mode || settings.defaultModel || DEFAULT_ZIPPLY_MODEL).trim() || DEFAULT_ZIPPLY_MODEL
  return {
    model,
    reasoningEffort: settings.reasoningEffort || DEFAULT_REASONING_EFFORT,
    contextLength: getModelContextLength(model),
    systemPrompt: settings.systemPrompt,
    accessMode: settings.accessMode,
    terminalShell: normalizeTerminalShell(settings.terminalShell),
    workspacePath: (workspacePath || '').trim(),
    stream: true
  }
}

export function saveSettings(settings: AppSettings): boolean {
  try {
    const cleanSettings: AppSettings = {
      theme: settings.theme,
      ...(settings.customTheme ? { customTheme: settings.customTheme } : {}),
      defaultModel: settings.defaultModel || DEFAULT_ZIPPLY_MODEL,
      reasoningEffort: settings.reasoningEffort || DEFAULT_REASONING_EFFORT,
      systemPrompt: settings.systemPrompt,
      localOnly: settings.localOnly,
      accessMode: settings.accessMode,
      terminalShell: normalizeTerminalShell(settings.terminalShell)
    }
    appStorage.setItem(SETTINGS_KEY, JSON.stringify(cleanSettings))
    return true
  } catch (error) {
    console.error('Failed to save settings:', error)
    return false
  }
}

const CUSTOM_THEME_VARS = [
  '--bg-canvas',
  '--bg-sidebar',
  '--bg-surface',
  '--bg-surface-elevated',
  '--bg-surface-secondary',
  '--bg-control',
  '--bg-control-hover',
  '--bg-hover',
  '--bg-hover-strong',
  '--bg-track',
  '--border-subtle',
  '--border-hairline',
  '--text-primary',
  '--text-secondary',
  '--text-muted',
  '--text-white',
  '--text-strong',
  '--accent',
  '--accent-hover',
  '--accent-soft',
  '--text-on-accent',
  '--scrollbar-thumb',
  '--scrollbar-thumb-hover',
  '--scrollbar-thumb-active'
] as const

function parseHexRgb(hex: string): [number, number, number] | null {
  const clean = hex.trim().replace(/^#/, '')
  const normalized = clean.length === 3
    ? clean.split('').map(c => c + c).join('')
    : clean
  if (!/^[0-9a-fA-F]{6}$/.test(normalized)) return null
  return [
    parseInt(normalized.slice(0, 2), 16),
    parseInt(normalized.slice(2, 4), 16),
    parseInt(normalized.slice(4, 6), 16)
  ]
}

function isLightHex(hex: string): boolean {
  const rgb = parseHexRgb(hex)
  if (!rgb) return false
  const [r, g, b] = rgb.map(v => v / 255)
  const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b
  return luminance > 0.55
}

function shiftHex(hex: string, amount: number): string {
  const rgb = parseHexRgb(hex)
  if (!rgb) return hex
  const clamp = (n: number) => Math.max(0, Math.min(255, Math.round(n)))
  return `#${rgb.map(v => clamp(v + amount).toString(16).padStart(2, '0')).join('')}`
}

function hexAlpha(hex: string, alpha: number): string {
  const rgb = parseHexRgb(hex)
  if (!rgb) return `rgba(10, 132, 255, ${alpha})`
  return `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, ${alpha})`
}

export function applyTheme(theme: AppTheme, customTheme?: CustomThemeColors): void {
  const root = document.documentElement
  root.setAttribute('data-theme', theme)
  if (theme === 'custom') {
    const colors = { ...DEFAULT_CUSTOM_THEME, ...customTheme }
    const light = isLightHex(colors.canvas)
    const accent = colors.accent || '#0A84FF'
    const accentLight = isLightHex(accent)
    root.setAttribute('data-theme-scheme', light ? 'light' : 'dark')
    root.style.setProperty('--bg-canvas', colors.canvas)
    root.style.setProperty('--bg-sidebar', colors.sidebar)
    root.style.setProperty('--bg-surface', colors.surface)
    root.style.setProperty('--bg-surface-elevated', shiftHex(colors.surface, light ? -8 : 8))
    root.style.setProperty('--bg-surface-secondary', shiftHex(colors.canvas, light ? -5 : 8))
    root.style.setProperty('--bg-control', colors.control)
    root.style.setProperty('--bg-control-hover', shiftHex(colors.control, light ? -10 : 12))
    root.style.setProperty('--bg-hover', light ? 'rgba(0, 0, 0, 0.045)' : 'rgba(255, 255, 255, 0.05)')
    root.style.setProperty('--bg-hover-strong', light ? 'rgba(0, 0, 0, 0.085)' : 'rgba(255, 255, 255, 0.09)')
    root.style.setProperty('--bg-track', shiftHex(colors.control, light ? -6 : 4))
    root.style.setProperty('--border-subtle', light ? 'rgba(0, 0, 0, 0.08)' : 'rgba(255, 255, 255, 0.07)')
    root.style.setProperty('--border-hairline', light ? 'rgba(0, 0, 0, 0.05)' : 'rgba(255, 255, 255, 0.04)')
    root.style.setProperty('--text-primary', colors.textPrimary)
    root.style.setProperty('--text-secondary', colors.textSecondary)
    root.style.setProperty('--text-muted', shiftHex(colors.textSecondary, light ? 28 : -28))
    root.style.setProperty('--text-white', light ? '#0A0A0A' : '#FFFFFF')
    root.style.setProperty('--text-strong', light ? '#0A0A0A' : '#FFFFFF')
    root.style.setProperty('--accent', accent)
    root.style.setProperty('--accent-hover', shiftHex(accent, accentLight ? -16 : -14))
    root.style.setProperty('--accent-soft', hexAlpha(accent, 0.16))
    root.style.setProperty('--text-on-accent', accentLight ? '#111111' : '#FFFFFF')
    root.style.setProperty('--scrollbar-thumb', light ? 'rgba(0, 0, 0, 0.18)' : 'rgba(255, 255, 255, 0.18)')
    root.style.setProperty('--scrollbar-thumb-hover', light ? 'rgba(0, 0, 0, 0.34)' : 'rgba(255, 255, 255, 0.36)')
    root.style.setProperty('--scrollbar-thumb-active', light ? 'rgba(0, 0, 0, 0.5)' : 'rgba(255, 255, 255, 0.52)')
  } else {
    root.setAttribute('data-theme-scheme', theme === 'light' ? 'light' : 'dark')
    for (const key of CUSTOM_THEME_VARS) {
      root.style.removeProperty(key)
    }
  }
}

export function calculateStorageSize(): string {
  try {
    let totalBytes = 0
    for (const key of appStorage.keys()) {
      totalBytes += ((appStorage.getItem(key)?.length || 0) + key.length) * 2
    }
    if (totalBytes < 1024) return `${totalBytes} Б`
    if (totalBytes < 1024 * 1024) return `${(totalBytes / 1024).toFixed(1)} КБ`
    return `${(totalBytes / (1024 * 1024)).toFixed(2)} МБ`
  } catch {
    return '0 КБ'
  }
}

export function exportChatsToJson(sessions: ChatSession[]): void {
  const data = JSON.stringify(sessions, null, 2)
  const blob = new Blob([data], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `zipply-chats-${new Date().toISOString().slice(0, 10)}.json`
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

export function importChatsFromJson(file: File): Promise<ChatSession[]> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = (e) => {
      try {
        const parsed = JSON.parse(e.target?.result as string)
        const valid = isValidChatSessions(parsed)
        if (valid) {
          resolve(parsed as ChatSession[])
        } else {
          reject(new Error('Неверный формат чатов или идентификаторов. Существующая история не изменена.'))
        }
      } catch (err) {
        reject(err)
      }
    }
    reader.onerror = () => reject(new Error('Ошибка чтения файла'))
    reader.readAsText(file)
  })
}
