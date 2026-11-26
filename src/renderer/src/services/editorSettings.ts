import { appStorage } from './appStorage'
export interface EditorSettings { diagnostics: boolean; delay: 500 | 1000 | 2000; markers: boolean }
const KEY = 'zipply_editor_settings_v1'
export const defaultEditorSettings: EditorSettings = { diagnostics: true, delay: 1000, markers: true }
export function loadEditorSettings(): EditorSettings {
  try {
    const value = JSON.parse(appStorage.getItem(KEY) || '{}')
    return { diagnostics: typeof value.diagnostics === 'boolean' ? value.diagnostics : true, delay: [500, 1000, 2000].includes(value.delay) ? value.delay : 1000, markers: typeof value.markers === 'boolean' ? value.markers : true }
  } catch { return { ...defaultEditorSettings } }
}
export function saveEditorSettings(settings: EditorSettings): boolean {
  try { appStorage.setItem(KEY, JSON.stringify(settings)); window.dispatchEvent(new Event('zipply:editor-settings')); return true } catch { return false }
}
