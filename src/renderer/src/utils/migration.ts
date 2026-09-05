/**
 * migration.ts — Automatic client-side migration of localStorage keys and settings
 * from legacy ClickCoder / clickcode namespaces into zipple.
 */

export function runClientMigration(): void {
  if (typeof window === 'undefined' || !window.localStorage) return

  const MIGRATIONS = [
    {
      target: 'zipply_ai_config',
      sources: ['zipple_ai_config', 'clickcoder_ai_config', 'clickcode_ai_config', 'click_ai_config']
    },
    {
      target: 'zipply_appearance_config',
      sources: ['zipple_appearance_config', 'clickcoder_appearance_config', 'clickcode_appearance_config', 'click_appearance_config']
    },
    {
      target: 'zipply_chat_sessions',
      sources: ['zipple_chat_sessions', 'clickcoder_chat_sessions', 'clickcode_chat_sessions', 'click_chat_sessions']
    },
    {
      target: 'zipply_projects',
      sources: ['zipple_projects', 'clickcoder_projects', 'clickcode_projects', 'click_projects']
    }
  ]

  for (const item of MIGRATIONS) {
    try {
      const existingTarget = localStorage.getItem(item.target)
      if (!existingTarget) {
        for (const src of item.sources) {
          const val = localStorage.getItem(src)
          if (val) {
            localStorage.setItem(item.target, val)
            console.log(`[Migration] Migrated localStorage key ${src} -> ${item.target}`)
            break
          }
        }
      }
    } catch (e) {
      console.warn(`[Migration] Error migrating key ${item.target}:`, e)
    }
  }
}