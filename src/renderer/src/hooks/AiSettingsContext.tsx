import React, { createContext, useContext, ReactNode } from 'react'
import { useAiSettings, PROVIDER_PRESETS } from './useAiSettings'

// Re-export for convenience so consumers only need to import from one place
export { PROVIDER_PRESETS }

// The return type of useAiSettings — re-export for consumers
export type AiSettingsContextValue = ReturnType<typeof useAiSettings>

const AiSettingsContext = createContext<AiSettingsContextValue | null>(null)

/**
 * Wrap your component tree with this provider so all descendants share
 * a single instance of AI settings state instead of each creating their own.
 */
export const AiSettingsProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const value = useAiSettings()
  return <AiSettingsContext.Provider value={value}>{children}</AiSettingsContext.Provider>
}

/**
 * Use this hook in any component instead of calling useAiSettings() directly.
 * Throws if used outside of AiSettingsProvider.
 */
export function useAiSettingsContext(): AiSettingsContextValue {
  const ctx = useContext(AiSettingsContext)
  if (!ctx) {
    throw new Error('useAiSettingsContext must be used inside <AiSettingsProvider>')
  }
  return ctx
}
