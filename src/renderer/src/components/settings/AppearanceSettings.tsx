import React, { useState } from 'react'
import { RotateCcw } from 'lucide-react'
import {
  useAppearance,
  ThemeOption,
  ACCENT_OPTIONS,
  DEFAULT_CUSTOM_THEME
} from '../../hooks/useAppearance'
import { ThemeType, AccentColorType, CustomThemeColors } from '../../types/settings'
import './AppearanceSettings.css'

interface ColorItemProps {
  label: string
  subtitle?: string
  value: string
  onChange: (color: string) => void
}

const ColorItem: React.FC<ColorItemProps> = ({ label, subtitle, value, onChange }) => (
  <div className="custom-color-item">
    <div className="custom-color-info">
      <span className="custom-color-title">{label}</span>
      {subtitle && <span className="custom-color-sub">{subtitle}</span>}
    </div>
    <div className="custom-color-picker-wrap">
      <div
        className="custom-color-swatch"
        style={{ backgroundColor: value }}
      >
        <input
          type="color"
          className="custom-color-input"
          value={value}
          onChange={(e) => onChange(e.target.value)}
        />
      </div>
      <span className="custom-color-hex">{value.toUpperCase()}</span>
    </div>
  </div>
)

export const AppearanceSettings: React.FC = () => {
  const {
    appearance,
    updateAppearance,
    updateAppearanceWithTransition,
    resetAppearance,
    themes
  } = useAppearance()

  const [customDraft, setCustomDraft] = useState<CustomThemeColors>(
    appearance.customTheme ?? DEFAULT_CUSTOM_THEME
  )

  const handleSelectTheme = (themeId: ThemeType, e: React.MouseEvent) => {
    if (themeId === appearance.theme) return
    const rect = e.currentTarget.getBoundingClientRect()
    const origin = {
      x: rect.left + rect.width / 2,
      y: rect.top + rect.height / 2
    }
    updateAppearanceWithTransition({ theme: themeId }, origin)
  }

  const handleSelectAccentPreset = (accId: AccentColorType, color: string) => {
    const nextDraft = { ...customDraft, accentColor: color }
    setCustomDraft(nextDraft)
    updateAppearance({
      accentColor: accId,
      accentCustomColor: color,
      customTheme: nextDraft
    })
  }

  const handleColorChange = (key: keyof CustomThemeColors, value: string) => {
    const next = { ...customDraft, [key]: value }
    setCustomDraft(next)
    if (key === 'accentColor') {
      updateAppearance({
        customTheme: next,
        accentColor: 'custom',
        accentCustomColor: value
      })
    } else {
      updateAppearance({ customTheme: next })
    }
  }

  const handleApplyCustomTheme = (e: React.MouseEvent) => {
    const rect = e.currentTarget.getBoundingClientRect()
    updateAppearanceWithTransition(
      {
        theme: 'custom',
        customTheme: customDraft,
        accentColor: 'custom',
        accentCustomColor: customDraft.accentColor
      },
      {
        x: rect.left + rect.width / 2,
        y: rect.top + rect.height / 2
      }
    )
  }

  const handleToggleCompact = () => {
    updateAppearance({ compactMode: !appearance.compactMode })
  }

  const handleToggleAnimations = () => {
    updateAppearance({ smoothAnimations: !appearance.smoothAnimations })
  }

  return (
    <div className="appearance-settings-root">
      {/* Header Bar */}
      <div className="appearance-header-bar">
        <div className="header-titles-col">
          <div className="header-title-flex">
            <h1 className="models-title-text">Темы и оформление</h1>
            <span className="appearance-chip-badge">5 тем</span>
          </div>
          <p className="models-desc-text">
            Персонализация цветовой палитры и визуальных параметров интерфейса
          </p>
        </div>

        <button
          type="button"
          className="models-scan-btn"
          onClick={resetAppearance}
          title="Сбросить к значениям по умолчанию"
        >
          <RotateCcw size={13} />
          <span>Сбросить</span>
        </button>
      </div>

      {/* SECTION 1: Themes Grid */}
      <div className="appearance-section">
        <div className="appearance-section-head">
          <div className="appearance-section-title">Цветовая тема</div>
          <div className="appearance-section-desc">
            Выберите оформление интерфейса для комфортной работы
          </div>
        </div>

        <div className="themes-grid">
          {themes.map((t: ThemeOption) => {
            const isSelected = appearance.theme === t.id
            return (
              <div
                key={t.id}
                className={`theme-card ${isSelected ? 'active' : ''}`}
                onClick={(e) => handleSelectTheme(t.id, e)}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => e.key === 'Enter' && handleSelectTheme(t.id, e as unknown as React.MouseEvent)}
              >
                {/* Visual Mini Mockup */}
                <div
                  className="theme-card-preview"
                  style={{ backgroundColor: t.bgPrimary }}
                >
                  <div
                    className="theme-preview-sidebar"
                    style={{ backgroundColor: t.bgSidebar }}
                  >
                    <div
                      className="mini-bar"
                      style={{ backgroundColor: t.accentColor, width: '80%' }}
                    />
                    <div
                      className="mini-bar"
                      style={{ backgroundColor: t.textColor, opacity: 0.2, width: '60%' }}
                    />
                    <div
                      className="mini-bar"
                      style={{ backgroundColor: t.textColor, opacity: 0.12, width: '70%' }}
                    />
                  </div>

                  <div className="theme-preview-body">
                    <div
                      className="mini-card"
                      style={{ backgroundColor: t.bgSurface }}
                    >
                      <div
                        className="mini-line"
                        style={{ backgroundColor: t.textColor, opacity: 0.7 }}
                      />
                      <div
                        className="mini-line short"
                        style={{ backgroundColor: t.accentColor, opacity: 0.9 }}
                      />
                    </div>
                  </div>
                </div>

                {/* Card Meta */}
                <div className="theme-card-meta">
                  <div className="theme-card-title-row">
                    <span className="theme-card-name">{t.name}</span>
                    {isSelected ? (
                      <span className="status-badge-active">
                        <span className="status-dot" />
                        <span>Активно</span>
                      </span>
                    ) : t.tag ? (
                      <span className="status-badge-ready">{t.tag}</span>
                    ) : null}
                  </div>

                  <span className="theme-card-subtitle">{t.subtitle}</span>

                  <div className="theme-card-palette">
                    <span
                      className="palette-dot"
                      style={{ backgroundColor: t.bgPrimary }}
                    />
                    <span
                      className="palette-dot"
                      style={{ backgroundColor: t.bgSidebar }}
                    />
                    <span
                      className="palette-dot"
                      style={{ backgroundColor: t.bgSurface }}
                    />
                    <span
                      className="palette-dot"
                      style={{ backgroundColor: t.accentColor }}
                    />
                  </div>
                </div>
              </div>
            )
          })}

          {/* Custom Theme Card */}
          {(() => {
            const isSelected = appearance.theme === 'custom'
            return (
              <div
                className={`theme-card ${isSelected ? 'active' : ''}`}
                onClick={(e) => handleSelectTheme('custom', e)}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => e.key === 'Enter' && handleSelectTheme('custom', e as unknown as React.MouseEvent)}
              >
                <div
                  className="theme-card-preview"
                  style={{ backgroundColor: customDraft.bgPrimary }}
                >
                  <div
                    className="theme-preview-sidebar"
                    style={{ backgroundColor: customDraft.bgSidebar }}
                  >
                    <div
                      className="mini-bar"
                      style={{ backgroundColor: customDraft.accentColor, width: '80%' }}
                    />
                    <div
                      className="mini-bar"
                      style={{ backgroundColor: customDraft.textPrimary, opacity: 0.2, width: '60%' }}
                    />
                    <div
                      className="mini-bar"
                      style={{ backgroundColor: customDraft.textPrimary, opacity: 0.12, width: '70%' }}
                    />
                  </div>

                  <div className="theme-preview-body">
                    <div
                      className="mini-card"
                      style={{ backgroundColor: customDraft.bgSurface }}
                    >
                      <div
                        className="mini-line"
                        style={{ backgroundColor: customDraft.textPrimary, opacity: 0.7 }}
                      />
                      <div
                        className="mini-line short"
                        style={{ backgroundColor: customDraft.accentColor, opacity: 0.9 }}
                      />
                    </div>
                  </div>
                </div>

                <div className="theme-card-meta">
                  <div className="theme-card-title-row">
                    <span className="theme-card-name">Кастомная</span>
                    {isSelected ? (
                      <span className="status-badge-active">
                        <span className="status-dot" />
                        <span>Активно</span>
                      </span>
                    ) : (
                      <span className="status-badge-ready">Custom</span>
                    )}
                  </div>

                  <span className="theme-card-subtitle">Персональная цветовая схема</span>

                  <div className="theme-card-palette">
                    <span
                      className="palette-dot"
                      style={{ backgroundColor: customDraft.bgPrimary }}
                    />
                    <span
                      className="palette-dot"
                      style={{ backgroundColor: customDraft.bgSidebar }}
                    />
                    <span
                      className="palette-dot"
                      style={{ backgroundColor: customDraft.bgSurface }}
                    />
                    <span
                      className="palette-dot"
                      style={{ backgroundColor: customDraft.accentColor }}
                    />
                  </div>
                </div>
              </div>
            )
          })()}
        </div>
      </div>

      {/* SECTION 2: Custom Theme Creator & Accent Color */}
      <div className="appearance-section">
        <div className="appearance-section-head">
          <div className="appearance-section-title">Настройка кастомной темы и акцента</div>
          <div className="appearance-section-desc">
            Настройте цветовую палитру интерфейса и выберите акцентный цвет
          </div>
        </div>

        <div className="custom-theme-surface">
          <div className="custom-theme-layout">
            {/* Color Rows */}
            <div className="custom-colors-column">
              <ColorItem
                label="Основной фон"
                subtitle="Главный экран и рабочая область"
                value={customDraft.bgPrimary}
                onChange={(v) => handleColorChange('bgPrimary', v)}
              />
              <ColorItem
                label="Боковая панель"
                subtitle="Фон навигации и списков диалогов"
                value={customDraft.bgSidebar}
                onChange={(v) => handleColorChange('bgSidebar', v)}
              />
              <ColorItem
                label="Поверхности и карточки"
                subtitle="Карточки настроек, поля ввода и блоки сообщений"
                value={customDraft.bgSurface}
                onChange={(v) => handleColorChange('bgSurface', v)}
              />
              <ColorItem
                label="Цвет текста"
                subtitle="Основной шрифт интерфейса"
                value={customDraft.textPrimary}
                onChange={(v) => handleColorChange('textPrimary', v)}
              />

              {/* Accent Color Picker & Presets */}
              <div className="custom-accent-section">
                <div className="custom-accent-header">
                  <span className="custom-color-title">Акцентный цвет</span>
                  <span className="custom-color-sub">
                    Цвет кнопок действий, переключателей и активных элементов
                  </span>
                </div>

                <div className="custom-accent-controls">
                  <div className="custom-accent-presets-row">
                    {ACCENT_OPTIONS.map((acc) => {
                      const isAccSelected =
                        appearance.accentColor === acc.id ||
                        customDraft.accentColor.toLowerCase() === acc.color.toLowerCase()
                      return (
                        <button
                          key={acc.id}
                          type="button"
                          className={`accent-dot-btn ${isAccSelected ? 'selected' : ''}`}
                          style={{ backgroundColor: acc.color }}
                          title={acc.name}
                          onClick={() => handleSelectAccentPreset(acc.id, acc.color)}
                        />
                      )
                    })}
                  </div>

                  <div className="custom-color-picker-wrap">
                    <div
                      className="custom-color-swatch"
                      style={{ backgroundColor: customDraft.accentColor }}
                    >
                      <input
                        type="color"
                        className="custom-color-input"
                        value={customDraft.accentColor}
                        onChange={(e) => handleColorChange('accentColor', e.target.value)}
                      />
                    </div>
                    <span className="custom-color-hex">{customDraft.accentColor.toUpperCase()}</span>
                  </div>
                </div>
              </div>
            </div>

            {/* Live Interactive Preview */}
            <div className="custom-preview-column">
              <div className="custom-preview-label">Предпросмотр темы</div>
              <div
                className="custom-mockup-frame"
                style={{ backgroundColor: customDraft.bgPrimary }}
              >
                <div
                  className="custom-mockup-sidebar"
                  style={{ backgroundColor: customDraft.bgSidebar }}
                >
                  <div
                    className="mockup-logo-dot"
                    style={{ backgroundColor: customDraft.accentColor }}
                  />
                  <div
                    className="mockup-nav-item active"
                    style={{ backgroundColor: customDraft.bgSurface }}
                  >
                    <div
                      className="mockup-line"
                      style={{ backgroundColor: customDraft.accentColor, width: '60%' }}
                    />
                  </div>
                  <div className="mockup-nav-item">
                    <div
                      className="mockup-line"
                      style={{ backgroundColor: customDraft.textPrimary, opacity: 0.3, width: '75%' }}
                    />
                  </div>
                  <div className="mockup-nav-item">
                    <div
                      className="mockup-line"
                      style={{ backgroundColor: customDraft.textPrimary, opacity: 0.2, width: '50%' }}
                    />
                  </div>
                </div>

                <div className="custom-mockup-content">
                  <div
                    className="mockup-chat-bubble ai"
                    style={{ backgroundColor: customDraft.bgSurface }}
                  >
                    <div
                      className="mockup-line"
                      style={{ backgroundColor: customDraft.textPrimary, opacity: 0.85, width: '85%' }}
                    />
                    <div
                      className="mockup-line"
                      style={{ backgroundColor: customDraft.textPrimary, opacity: 0.4, width: '60%' }}
                    />
                  </div>

                  <div
                    className="mockup-chat-bubble user"
                    style={{ backgroundColor: customDraft.accentColor }}
                  >
                    <div
                      className="mockup-line"
                      style={{ backgroundColor: '#FFFFFF', opacity: 0.95, width: '70%' }}
                    />
                  </div>

                  <div
                    className="mockup-input-bar"
                    style={{ backgroundColor: customDraft.bgSurface }}
                  >
                    <div
                      className="mockup-line"
                      style={{ backgroundColor: customDraft.textPrimary, opacity: 0.25, width: '45%' }}
                    />
                    <div
                      className="mockup-send-btn"
                      style={{ backgroundColor: customDraft.accentColor }}
                    />
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div className="custom-theme-actions">
            <button
              type="button"
              className={`action-pill-btn ${appearance.theme === 'custom' ? 'active' : ''}`}
              onClick={handleApplyCustomTheme}
            >
              {appearance.theme === 'custom' ? 'Кастомная тема активна' : 'Применить кастомную тему'}
            </button>
            <button
              type="button"
              className="models-scan-btn"
              onClick={() => {
                setCustomDraft(DEFAULT_CUSTOM_THEME)
                updateAppearance({
                  customTheme: DEFAULT_CUSTOM_THEME,
                  accentCustomColor: DEFAULT_CUSTOM_THEME.accentColor
                })
              }}
            >
              <RotateCcw size={12} />
              <span>Сбросить цвета</span>
            </button>
          </div>
        </div>
      </div>

      {/* SECTION 3: Preferences */}
      <div className="appearance-section">
        <div className="appearance-section-head">
          <div className="appearance-section-title">Параметры отображения</div>
        </div>

        <div className="appearance-switches-list">
          {/* Compact Mode */}
          <div className="appearance-switch-card" onClick={handleToggleCompact}>
            <div className="switch-text-col">
              <div className="switch-main-title">Компактный режим</div>
              <div className="switch-desc-text">
                Уменьшает отступы в боковой панели, истории диалогов и карточках ввода
              </div>
            </div>
            <div className={`clean-switch-track ${appearance.compactMode ? 'active' : ''}`}>
              <div className="clean-switch-thumb" />
            </div>
          </div>

          {/* Smooth Animations */}
          <div className="appearance-switch-card" onClick={handleToggleAnimations}>
            <div className="switch-text-col">
              <div className="switch-main-title">Плавные анимации</div>
              <div className="switch-desc-text">
                Плавные переходы между экранами и анимации открытия элементов
              </div>
            </div>
            <div className={`clean-switch-track ${appearance.smoothAnimations ? 'active' : ''}`}>
              <div className="clean-switch-thumb" />
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

export default AppearanceSettings
