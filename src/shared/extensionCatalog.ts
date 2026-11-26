export interface SkillCatalogItem {
  id: string
  name: string
  description: string
  scope: 'user' | 'project' | 'package'
  source: string
  revision: string
  disableModelInvocation: boolean
  userInvocable: boolean
  toolRefs?: string[]
}

export type McpServerDefinition =
  | { id: string; transport: 'stdio'; command: string; args?: string[]; cwd?: string }
  | { id: string; transport: 'http'; url: string }

export type McpServerCatalogItem = McpServerDefinition & {
  state: 'disconnected' | 'connecting' | 'connected' | 'error'
  revision: number
  protocolVersion?: string
  authConfigured: boolean
  error?: string
}

export interface McpToolCatalogItem {
  id: string
  serverId: string
  remoteName: string
  description: string
  mutates: true
  parallelSafe: false
  cacheable: false
}

export interface McpResourceCatalogItem {
  serverId: string
  uri: string
  name?: string
  title?: string
  description?: string
  mimeType?: string
}

export interface McpPromptArgumentCatalogItem {
  name: string
  description?: string
  required?: boolean
}

export interface McpPromptCatalogItem {
  serverId: string
  name: string
  title?: string
  description?: string
  arguments?: McpPromptArgumentCatalogItem[]
}

export interface TrustedMcpToolCatalogItem {
  serverId: string
  toolId: string
  toolName: string
  trustedAt: number
}

export interface ExtensionCatalog {
  skills: SkillCatalogItem[]
  servers: McpServerCatalogItem[]
  tools: McpToolCatalogItem[]
  resources: McpResourceCatalogItem[]
  prompts: McpPromptCatalogItem[]
  trustedMcpTools: TrustedMcpToolCatalogItem[]
}
