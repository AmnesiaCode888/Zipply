import React, { useState } from 'react'
import { Code2 } from '../../../icons'
import { loadEditorSettings, saveEditorSettings, type EditorSettings } from '../../../services/editorSettings'
import { SettingsHeader, SettingRow, SettingsSwitch, cardClass } from './SettingsUI'

export const EditorTab: React.FC = () => {
  const [settings, setSettings] = useState(loadEditorSettings)
  const [error, setError] = useState(false)
  const change = (next: EditorSettings) => { if (saveEditorSettings(next)) { setSettings(next); setError(false) } else setError(true) }
  return <div className="space-y-6">
    <SettingsHeader icon={Code2} title="Редактор" description="Настройте проверку файлов и отображение проблем в коде." />
    {error && <p role="alert" className="text-[15px] text-secondary">Не удалось сохранить настройки редактора.</p>}
    <div><h2 className="mb-3 text-[15px] font-semibold text-primary">Проверка кода</h2><div className={cardClass}>
      <SettingRow title={<label htmlFor="editor-diagnostics">Проверять код при вводе</label>} description="Для некоторых языков используется установленный языковой сервер, который может запускать программы проекта."><SettingsSwitch id="editor-diagnostics" checked={settings.diagnostics} onChange={diagnostics => change({ ...settings, diagnostics })} /></SettingRow>
      <SettingRow title={<label htmlFor="editor-delay">Задержка проверки</label>} description="Проверка начнётся после паузы в наборе. Большая задержка снижает нагрузку."><select id="editor-delay" value={settings.delay} disabled={!settings.diagnostics} onChange={event => change({ ...settings, delay: Number(event.target.value) as EditorSettings['delay'] })} className="max-w-full rounded-full border-none bg-surface-elevated px-4 py-2 text-[14px] text-primary outline-none disabled:opacity-50"><option value={500}>0,5 секунды</option><option value={1000}>1 секунда</option><option value={2000}>2 секунды</option></select></SettingRow>
      <SettingRow title={<label htmlFor="editor-markers">Отметки ошибок</label>} description="Показывать отметки строк и подчёркивать проблемные участки кода."><SettingsSwitch id="editor-markers" checked={settings.markers} onChange={markers => change({ ...settings, markers })} /></SettingRow>
    </div></div>
  </div>
}
