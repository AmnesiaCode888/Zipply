const CHAT_KEY = 'zipply_chat_sessions_v1'
let chatMutationVersion = 0

export function getChatStorageMutationVersion(): number { return chatMutationVersion }

// Migrate the current origin once. Chat backups also include histories from the
// other origin (development or packaged), which cannot read its localStorage.
function migrateChats(raw: string | null): string | null {
  const backups = window.api?.workspace?.loadSessions?.()
  if (backups?.errors?.length) throw new Error('Unable to read chat backups')
  let local: any[] = []
  if (raw) {
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) throw new Error('Invalid chat history')
    local = parsed
  }
  const merged = new Map<string, any>()
  for (const item of [...(backups?.sessions || []), ...local]) {
    if (!item || typeof item.id !== 'string' || !Array.isArray(item.messages)) throw new Error('Invalid chat history')
    const old = merged.get(item.id)
    if (!old || Number(item.updatedAt || 0) >= Number(old.updatedAt || 0)) merged.set(item.id, item)
  }
  return merged.size ? JSON.stringify([...merged.values()].sort((a, b) => Number(b.updatedAt || 0) - Number(a.updatedAt || 0))) : null
}

export const appStorage = {
  getItem(key: string): string | null {
    const bridge = typeof window !== 'undefined' ? window.api?.storage : undefined
    if (!bridge) return localStorage.getItem(key)
    const result = bridge.get(key)
    if (result.error) throw new Error('Unable to read application storage')
    if (result.exists) return result.value ?? null
    const legacy = localStorage.getItem(key)
    let value = key === CHAT_KEY ? migrateChats(legacy) : legacy
    if (key === 'zipply_app_settings_v1' && value) {
      const settings = JSON.parse(value)
      for (const secret of ['apiKey', 'tavilyApiKey']) {
        if (settings[secret]) {
          const vault = window.api?.secrets
          const existing = vault?.get(secret)
          if (!vault || existing?.error || (!existing?.value && !vault.set(secret, settings[secret]).ok)) throw new Error('Unable to migrate secret')
        }
        delete settings[secret]
      }
      value = JSON.stringify(settings)
    }
    if (value !== null && !bridge.set(key, value).ok) throw new Error('Unable to migrate application storage')
    return value
  },
  setItem(key: string, value: string): void {
    const bridge = typeof window !== 'undefined' ? window.api?.storage : undefined
    if (!bridge) { localStorage.setItem(key, value); if (key === CHAT_KEY) chatMutationVersion++; return }
    if (!bridge.set(key, value).ok) throw new Error('Unable to save application storage')
    if (key === CHAT_KEY) chatMutationVersion++
  },
  removeItem(key: string): void {
    const bridge = typeof window !== 'undefined' ? window.api?.storage : undefined
    if (!bridge) { localStorage.removeItem(key); if (key === CHAT_KEY) chatMutationVersion++; return }
    if (!bridge.set(key, null).ok) throw new Error('Unable to remove application storage')
    if (key === CHAT_KEY) chatMutationVersion++
  },
  keys(): string[] {
    const bridge = typeof window !== 'undefined' ? window.api?.storage : undefined
    if (!bridge) return Object.keys(localStorage)
    const result = bridge.keys()
    if (result.error) throw new Error('Unable to read application storage')
    return result.keys || []
  }
}
