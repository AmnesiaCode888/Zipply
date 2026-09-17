export type SettingsTab = 'models' | 'mcp' | 'appearance' | 'shortcuts' | 'storage' | 'access'

export type AiProviderPreset =
  | 'deepseek'
  | 'openai'
  | 'anthropic'
  | 'openrouter'
  | 'gemini'
  | 'xai'
  | 'groq'
  | 'mistral'
  | 'together'
  | 'perplexity'
  | 'ollama'
  | 'lmstudio'
  | 'vllm'
  | 'custom'
  | 'custom_provider'

export interface ConnectedProvider {
  id: string
  providerId: AiProviderPreset
  name: string
  baseUrl: string
  apiKey: string
  model: string
  models?: string[]             // Dynamically fetched models from router/provider
  fastModel?: string
  embeddingModel?: string       // Embedding model for semantic vector search & memory
  embeddingBaseUrl?: string     // Custom embedding endpoint if different from baseUrl
  requiresKey?: boolean
  isCustom?: boolean
  // Inference options (Ollama, LM Studio, etc.)
  contextLength?: number
  temperature?: number
  maxTokens?: number
}

export interface DiscoveredLocalService {
  providerId: 'ollama' | 'lmstudio' | 'vllm'
  name: string
  port: number
  baseUrl: string
  models: string[]
  status: 'online'
  latencyMs?: number
}

export type SearchProviderType = 'duckduckgo' | 'tavily'

export interface AiConfig {
  providerPreset: AiProviderPreset
  baseUrl: string
  model: string
  fastModel?: string            // Fast / cheap model for background tasks (titles, summaries, extraction)
  apiKey: string
  searchProvider?: SearchProviderType
  tavilyKey?: string
  temperature: number
  maxTokens: number
  contextLength?: number
  stream: boolean
  baseDir?: string
  // Memory & Personalization
  embeddingModel?: string       // e.g. "text-embedding-3-small"
  embeddingBaseUrl?: string     // defaults to baseUrl if not set
  enableAutoExtract?: boolean   // auto-extract user facts after each session (default: true)
  enableSessionSummary?: boolean // save & recall session summaries (default: true)
  // Multi-Provider Storage
  connectedProviders?: ConnectedProvider[]
  activeProviderId?: string
}

export type ThemeType =
  | 'dark'
  | 'oled'
  | 'light'
  | 'midnight'
  | 'custom'

export type FontFamilyType =
  | 'Inter'
  | 'JetBrains Mono'
  | 'Fira Code'
  | 'Cascadia Code'
  | 'System'

export type AccentColorType =
  | 'blue'
  | 'emerald'
  | 'purple'
  | 'amber'
  | 'crimson'
  | 'cyan'
  | 'monochrome'
  | 'custom'

export interface CustomThemeColors {
  bgPrimary: string
  bgSidebar: string
  bgSurface: string
  textPrimary: string
  accentColor: string
}

export interface AppearanceConfig {
  theme: ThemeType
  fontFamily: FontFamilyType
  fontSize: number
  uiScale: number
  accentColor: AccentColorType
  accentCustomColor?: string
  compactMode: boolean
  smoothAnimations: boolean
  customTheme?: CustomThemeColors
}

export interface AccountProfile {
  name: string
  email: string
  role: string
  plan: 'Free' | 'Pro' | 'Enterprise'
  renewalDate: string
  avatarUrl?: string
}

export interface LimitsInfo {
  dailyRequestsUsed: number
  dailyRequestsTotal: number
  fastTokensUsed: number
  fastTokensTotal: number
  contextLimitK: number
  resetInMinutes: number
}

export interface TelegramConfig {
  token: string
  enabled: boolean
  allowedUsers: string[]
  autoStart: boolean
  defaultWorkspace?: string
  syncWithActiveChat?: boolean
  notifyOnDesktopDone?: boolean
}

export interface TelegramBotStatus {
  status: 'stopped' | 'starting' | 'running' | 'error'
  botInfo?: { id: number; username: string; firstName: string }
  error?: string
  lastActiveAt?: string
  currentModel?: string
}

