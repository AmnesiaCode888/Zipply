import React, { useState } from 'react'
import { Palette, Check, Plus } from '../../../icons'
import {
  DEFAULT_CUSTOM_THEME,
  type AppSettings,
  type AppTheme,
  type CustomThemeColors
} from '../../../services/settingsService'
import { SettingsHeader, cardClass, fieldClass } from './SettingsUI'

interface ThemesTabProps {
  settings: AppSettings
  onThemeSelect: (theme: AppTheme) => void
  onCustomThemeChange?: (customTheme: CustomThemeColors) => void
}

const PRESET_THEMES = [
  {
    id: 'obsidian' as const,
    name: 'Зипли',
    description: 'Фирменная тёмная тема Zipply',
    sidebar: '#121212',
    canvas: '#181818',
    surface: '#212121',
    accent: '#0A84FF',
    isLight: false
  },
  {
    id: 'light' as const,
    name: 'Светлая',
    description: 'Чистая светлая палитра',
    sidebar: '#EFEFF2',
    canvas: '#F8F8FA',
    surface: '#FFFFFF',
    accent: '#007AFF',
    isLight: true
  },
  {
    id: 'oled' as const,
    name: 'OLED',
    description: 'Глубокий чёрный для OLED-экранов',
    sidebar: '#000000',
    canvas: '#000000',
    surface: '#0D0D0D',
    accent: '#0A84FF',
    isLight: false
  },
  {
    id: 'claude' as const,
    name: 'Claude',
    description: 'Тёплый графит с терракотой',
    sidebar: '#1F1E1D',
    canvas: '#262624',
    surface: '#30302E',
    accent: '#D97757',
    isLight: false
  },
  {
    id: 'codex' as const,
    name: 'Codex',
    description: 'Тёмный графит Codex Desktop',
    sidebar: '#111111',
    canvas: '#0D0D0D',
    surface: '#171717',
    accent: '#3B82F6',
    isLight: false
  }
] as const

const COLOR_FIELDS: Array<{ key: keyof Omit<CustomThemeColors, 'name'>; label: string }> = [
  { key: 'canvas', label: 'Фон чата' },
  { key: 'sidebar', label: 'Боковая панель' },
  { key: 'surface', label: 'Карточки и ввод' },
  { key: 'control', label: 'Кнопки и плашки' },
  { key: 'accent', label: 'Акцент' },
  { key: 'textPrimary', label: 'Основной текст' },
  { key: 'textSecondary', label: 'Вторичный текст' }
]

export const ThemesTab: React.FC<ThemesTabProps> = ({ settings, onThemeSelect, onCustomThemeChange }) => {
  const [editorOpen, setEditorOpen] = useState(settings.theme === 'custom')
  const custom = { ...DEFAULT_CUSTOM_THEME, ...settings.customTheme }

  const handleOpenCustom = () => {
    if (!settings.customTheme) {
      onCustomThemeChange?.(custom)
    }
    onThemeSelect('custom')
    setEditorOpen(true)
  }

  const updateColor = (key: keyof CustomThemeColors, value: string) => {
    onCustomThemeChange?.({ ...custom, [key]: value })
  }

  return (
    <div className="space-y-6">
      <SettingsHeader
        icon={Palette}
        title="Оформление"
        description="Выберите цветовую палитру интерфейса. Тема применяется сразу."
      />

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3" role="group" aria-label="Тема оформления">
        {PRESET_THEMES.map((item) => {
          const active = settings.theme === item.id
          const barStrong = item.isLight ? 'rgba(0,0,0,0.16)' : 'rgba(255,255,255,0.18)'
          const barSoft = item.isLight ? 'rgba(0,0,0,0.08)' : 'rgba(255,255,255,0.09)'
          return (
            <button
              key={item.id}
              type="button"
              aria-pressed={active}
              onClick={() => onThemeSelect(item.id)}
              className={`w-full p-4 rounded-[20px] text-left flex flex-col gap-4 border-none shadow-none transition-colors cursor-pointer ${
                active ? 'bg-control' : 'bg-surface hover:bg-surface-elevated'
              }`}
            >
              <span aria-hidden="true" className="w-full h-24 rounded-[14px] flex overflow-hidden p-2 gap-2" style={{ backgroundColor: item.sidebar }}>
                <span className="w-[26%] rounded-[8px]" style={{ backgroundColor: item.surface }} />
                <span className="flex-1 rounded-[8px] flex flex-col justify-between p-2" style={{ backgroundColor: item.canvas }}>
                  <span className="w-2/3 h-2 rounded-full" style={{ backgroundColor: barStrong }} />
                  <span className="flex items-center gap-1.5">
                    <span className="flex-1 h-4 rounded-full" style={{ backgroundColor: barSoft }} />
                    <span className="w-4 h-4 rounded-full shrink-0" style={{ backgroundColor: item.accent }} />
                  </span>
                </span>
              </span>
              <span className="flex items-start justify-between gap-2 w-full">
                <span>
                  <span className="block text-[16px] font-medium text-primary">{item.name}</span>
                  <span className="block mt-1 text-[14px] leading-[21px] text-secondary">{item.description}</span>
                </span>
                {active && <Check size={18} className="shrink-0 text-accent" />}
              </span>
            </button>
          )
        })}

        {/* 6th card: Add / Custom Theme */}
        <button
          type="button"
          aria-pressed={settings.theme === 'custom'}
          onClick={handleOpenCustom}
          className={`w-full p-4 rounded-[20px] text-left flex flex-col gap-4 border-none shadow-none transition-colors cursor-pointer ${
            settings.theme === 'custom' ? 'bg-control' : 'bg-surface hover:bg-surface-elevated'
          }`}
        >
          {settings.theme === 'custom' ? (
            <span aria-hidden="true" className="w-full h-24 rounded-[14px] flex overflow-hidden p-2 gap-2" style={{ backgroundColor: custom.sidebar }}>
              <span className="w-[26%] rounded-[8px]" style={{ backgroundColor: custom.surface }} />
              <span className="flex-1 rounded-[8px] flex flex-col justify-between p-2" style={{ backgroundColor: custom.canvas }}>
                <span className="w-2/3 h-2 rounded-full opacity-40" style={{ backgroundColor: custom.textPrimary }} />
                <span className="flex items-center gap-1.5">
                  <span className="flex-1 h-4 rounded-full" style={{ backgroundColor: custom.control }} />
                  <span className="w-4 h-4 rounded-full shrink-0" style={{ backgroundColor: custom.accent }} />
                </span>
              </span>
            </span>
          ) : (
            <span aria-hidden="true" className="w-full h-24 rounded-[14px] flex items-center justify-center bg-surface-elevated">
              <span className="flex h-10 w-10 items-center justify-center rounded-full bg-control text-primary">
                <Plus size={20} strokeWidth={1.8} />
              </span>
            </span>
          )}
          <span className="flex items-start justify-between gap-2 w-full">
            <span>
              <span className="block text-[16px] font-medium text-primary">
                {settings.theme === 'custom' ? (custom.name || 'Своя тема') : 'Добавить тему'}
              </span>
              <span className="block mt-1 text-[14px] leading-[21px] text-secondary">
                Настройте свои цвета интерфейса
              </span>
            </span>
            {settings.theme === 'custom' && <Check size={18} className="shrink-0 text-accent" />}
          </span>
        </button>
      </div>

      {(editorOpen || settings.theme === 'custom') && (
        <div className={cardClass}>
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-[16px] font-semibold text-primary">Настройка своей темы</h2>
            <button
              type="button"
              onClick={() => onCustomThemeChange?.(DEFAULT_CUSTOM_THEME)}
              className="rounded-full px-3.5 py-1.5 bg-surface-elevated hover:bg-control text-[13px] font-medium text-secondary hover:text-primary border-none shadow-none cursor-pointer"
            >
              Сбросить
            </button>
          </div>

          <div className="pt-1">
            <label htmlFor="custom-theme-name" className="block text-[13.5px] text-secondary mb-1.5">
              Название темы
            </label>
            <input
              id="custom-theme-name"
              type="text"
              value={custom.name}
              onChange={(e) => updateColor('name', e.target.value)}
              placeholder="Моя тема"
              className={fieldClass}
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
            {COLOR_FIELDS.map(({ key, label }) => (
              <label
                key={key}
                className="flex items-center justify-between gap-3 rounded-[14px] bg-surface-elevated px-3.5 py-2.5 cursor-pointer"
              >
                <span className="text-[14px] text-primary">{label}</span>
                <span className="flex items-center gap-2">
                  <span className="text-[12.5px] font-mono text-secondary uppercase">{custom[key]}</span>
                  <input
                    type="color"
                    value={custom[key]}
                    onChange={(e) => updateColor(key, e.target.value)}
                    className="h-7 w-7 cursor-pointer rounded-full border-none bg-transparent p-0"
                  />
                </span>
              </label>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
