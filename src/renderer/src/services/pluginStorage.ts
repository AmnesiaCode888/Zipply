const KEY = 'zipply_demo_plugins_v1'

export function loadInstalledPlugins(): string[] {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(KEY) || '[]')
    return Array.isArray(value) ? [...new Set(value.filter((id): id is string => typeof id === 'string').map(id => id === 'sentinel' ? 'cybersec' : id))] : []
  } catch { return [] }
}

/** Remove the old renderer-side placeholder state after migration succeeds. */
export function clearLegacyInstalledPlugins(): void {
  try { localStorage.removeItem(KEY) } catch { /* The main-process copy remains authoritative. */ }
}
