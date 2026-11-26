import React, { useState, useEffect, useRef } from 'react'
import { AppSettings, AppTheme, CustomThemeColors, loadSettings, saveSettings, applyTheme, calculateStorageSize, importChatsFromJson } from '../../services/settingsService'
import { createSettingsAutosave, mergeSettingsDraft } from '../../services/settingsAutosave'
import { ChatSession } from '../../types/chat'
import { ThemesTab, ProfileTab, AgentTab, SecurityTab, DataTab } from './tabs'
import { useAuth } from '../../hooks/useAuth'
import { FullAccessConfirm } from '../chat-input/FullAccessConfirm'
import type { SettingsTab } from './types'
import type { UpdateState } from '../../../../shared/updates'
import { EditorTab } from './tabs/EditorTab'
import { ImportConfirm } from './ImportConfirm'
export type { SettingsTab } from './types'

export interface MainSettingsViewProps {
  activeTab: SettingsTab
  onClose: () => void
  sessions: ChatSession[]
  onClearChats: () => void
  onImportChats: (imported: ChatSession[]) => boolean
  updateState?: UpdateState
  onCheckUpdates?: () => void
  onOpenUpdateDownload?: () => void
}

// Keep a failed draft available if the user leaves settings and returns.
let unsavedChanges: Partial<AppSettings> | null = null

export const MainSettingsView: React.FC<MainSettingsViewProps> = ({ activeTab, onClose, sessions, onClearChats, onImportChats, updateState, onCheckUpdates, onOpenUpdateDownload }) => {
  const [settings, setSettings] = useState<AppSettings>(() => mergeSettingsDraft(loadSettings(), unsavedChanges || {}))
  const settingsRef = useRef(settings)
  const changedKeys = useRef(new Set<keyof AppSettings>(Object.keys(unsavedChanges || {}) as (keyof AppSettings)[]))
  const [storageSize, setStorageSize] = useState(() => calculateStorageSize())
  const [storageError, setStorageError] = useState<'draft' | 'access' | null>(unsavedChanges ? 'draft' : null)
  const [confirmFull, setConfirmFull] = useState(false)
  const [pendingImport, setPendingImport] = useState<File | null>(null)
  const [dataMessage, setDataMessage] = useState('')
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved'>('idle')
  const { auth, busy: authBusy, login, cancelLogin, refresh, logout } = useAuth()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const saverRef = useRef<ReturnType<typeof createSettingsAutosave<AppSettings>>>()
  if (!saverRef.current) {
    saverRef.current = createSettingsAutosave(saveSettings, (ok, draft) => {
      if (ok) { unsavedChanges = null; changedKeys.current.clear() }
      else { unsavedChanges = Object.fromEntries([...changedKeys.current].map(key => [key, draft[key]])) as Partial<AppSettings> }
      setStorageError(ok ? null : 'draft')
      setSaveStatus(ok ? 'saved' : 'idle')
    })
    if (unsavedChanges) saverRef.current.update(settings)
  }
  const saver = saverRef.current

  useEffect(() => () => { saver.flush() }, [activeTab, saver])
  useEffect(() => () => { saver.flush(); saver.dispose() }, [saver])
  useEffect(() => {
    setStorageSize(calculateStorageSize())
  }, [activeTab])
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && pendingImport) { setPendingImport(null); return }
      if (e.key === 'Escape' && !confirmFull) { saver.flush(); onClose() }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [onClose, confirmFull, pendingImport, saver])

  const handleSettingChange = <K extends keyof AppSettings>(key: K, value: AppSettings[K]) => {
    const updated = { ...settingsRef.current, [key]: value }
    if (key === 'accessMode') {
      if (!saver.flush()) return
      if (!saveSettings(updated)) { setStorageError('access'); return }
      unsavedChanges = null
      setStorageError(null)
      setSaveStatus('saved')
    } else {
      changedKeys.current.add(key)
      setSaveStatus('saving')
      saver.update(updated)
    }
    settingsRef.current = updated
    setSettings(updated)
  }
  const handleThemeSelect = (theme: AppTheme) => { handleSettingChange('theme', theme); applyTheme(theme, settingsRef.current.customTheme) }
  const handleCustomThemeChange = (customTheme: CustomThemeColors) => {
    handleSettingChange('customTheme', customTheme)
    if (settingsRef.current.theme === 'custom') applyTheme('custom', customTheme)
  }
  const handleImportFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    setDataMessage('')
    setPendingImport(file)
    e.target.value = ''
  }
  const confirmImport = async () => {
    const file = pendingImport
    if (!file) return
    setPendingImport(null)
    try {
      let imported: ChatSession[]
      if (/\.zip$/i.test(file.name)) {
        if (file.size > 120 * 1024 * 1024) throw new Error('Архив слишком велик.')
        const result = await window.api.workspace.importArchive(new Uint8Array(await file.arrayBuffer()))
        if (!result.sessions) throw new Error(result.error || 'Не удалось прочитать архив.')
        imported = result.sessions
      } else imported = await importChatsFromJson(file)
      if (!onImportChats(imported)) throw new Error('Не удалось сохранить импортированную историю.')
      setStorageSize(calculateStorageSize())
      setDataMessage(`История импортирована: ${imported.length} чатов.`)
    }
    catch (err: any) { setDataMessage(err.message || 'Ошибка импорта') }
  }
  const handleExport = async () => {
    try {
      const result = await window.api.workspace.exportArchive(sessions)
      if (!result.bytes) throw new Error(result.error || 'Не удалось создать архив.')
      const blob = new Blob([new Uint8Array(result.bytes)], { type: 'application/zip' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `zipply-chats-${new Date().toISOString().slice(0, 10)}.zip`
      document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url)
      setDataMessage('Архив подготовлен для сохранения.')
    } catch (error) { setDataMessage(error instanceof Error ? error.message : 'Ошибка экспорта') }
  }
  const handleClearAll = () => { onClearChats(); setTimeout(() => setStorageSize(calculateStorageSize()), 80) }

  return <div className="flex-1 flex flex-col min-w-0 h-full relative overflow-y-auto no-scrollbar bg-canvas select-none font-sans">
    {confirmFull && <FullAccessConfirm placement="viewport" onCancel={() => setConfirmFull(false)} onConfirm={() => { handleSettingChange('accessMode', 'unrestricted'); setConfirmFull(false) }} />}
    <input ref={fileInputRef} type="file" accept=".zip,.json" className="hidden" onChange={handleImportFile} />
    <main className="w-full max-w-[720px] mx-auto px-4 sm:px-6 py-8 flex flex-col gap-7">
      {saveStatus !== 'idle' && !storageError && <p role="status" className="text-[13px] text-secondary text-right -mb-4">{saveStatus === 'saving' ? 'Сохранение…' : 'Сохранено'}</p>}
      {storageError && <div role="alert" className="p-4 rounded-[20px] bg-surface text-secondary text-[15px] leading-[23px]">{storageError === 'access' ? 'Не удалось изменить режим доступа. Проверьте защищённое хранилище и выберите режим снова.' : 'Не удалось сохранить настройки. Проверьте защищённое хранилище и попробуйте снова. Введённые значения сохранены в текущем сеансе.'} {storageError === 'draft' && <button type="button" onClick={() => saver.flush()} className="ml-2 rounded-full px-3 py-1 bg-surface-elevated text-primary border-none shadow-none">Повторить</button>}</div>}
      {activeTab === 'profile' && <ProfileTab auth={auth} busy={authBusy} onLogin={login} onCancelLogin={cancelLogin} onRefresh={refresh} onLogout={logout} updateState={updateState} onCheckUpdates={onCheckUpdates} onOpenUpdateDownload={onOpenUpdateDownload} />}
      {activeTab === 'themes' && <ThemesTab settings={settings} onThemeSelect={handleThemeSelect} onCustomThemeChange={handleCustomThemeChange} />}
      {activeTab === 'agent' && <AgentTab instruction={settings.systemPrompt} onChange={value => handleSettingChange('systemPrompt', value)} terminalShell={settings.terminalShell} onShellChange={value => handleSettingChange('terminalShell', value)} />}
      {activeTab === 'editor' && <EditorTab />}
      {activeTab === 'security' && <SecurityTab accessMode={settings.accessMode} onAccessModeChange={mode => mode === 'unrestricted' && settings.accessMode !== 'unrestricted' ? setConfirmFull(true) : handleSettingChange('accessMode', mode)} />}
      {activeTab === 'data' && <>{pendingImport && <ImportConfirm fileName={pendingImport.name} onCancel={() => setPendingImport(null)} onConfirm={confirmImport} />}{dataMessage && <p role="status" className="rounded-[20px] bg-surface px-5 py-4 text-[15px] text-secondary">{dataMessage}</p>}<DataTab storageSize={storageSize} chatCount={sessions.length} onExport={handleExport} onImportClick={() => fileInputRef.current?.click()} onClearAll={handleClearAll} /></>}
    </main>
  </div>
}
export default MainSettingsView
