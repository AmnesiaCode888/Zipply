export interface SkillExtensionRef {
  kind: 'skill'
  id: string
  label: string
  revision: string
  arguments?: string
}

export interface PluginExtensionRef {
  kind: 'plugin'
  id: string
  label: string
  revision?: string
}

export interface McpServerExtensionRef {
  kind: 'mcp_server'
  id: string
  label: string
  revision?: string
}

export interface McpPromptExtensionRef {
  kind: 'mcp_prompt'
  id: string
  serverId: string
  promptName: string
  label: string
  arguments?: Record<string, string>
  revision?: string
}

export interface McpResourceExtensionRef {
  kind: 'mcp_resource'
  id: string
  serverId: string
  uri: string
  label: string
  revision?: string
}

/** A small, serializable reference selected for one user turn. Never include expanded content or credentials. */
export type ExtensionRef = SkillExtensionRef | PluginExtensionRef | McpServerExtensionRef | McpPromptExtensionRef | McpResourceExtensionRef

const KIND_KEYS: Record<ExtensionRef['kind'], readonly string[]> = {
  skill: ['kind', 'id', 'label', 'revision', 'arguments'],
  plugin: ['kind', 'id', 'label', 'revision'],
  mcp_server: ['kind', 'id', 'label', 'revision'],
  mcp_prompt: ['kind', 'id', 'serverId', 'promptName', 'label', 'arguments', 'revision'],
  mcp_resource: ['kind', 'id', 'serverId', 'uri', 'label', 'revision']
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function isShortString(value: unknown, maxLength: number, allowEmpty = false): value is string {
  return typeof value === 'string' && value.length <= maxLength && !/[\u0000-\u001f\u007f]/.test(value) && (allowEmpty || value.trim().length > 0)
}

function hasOnlyKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const allowed = new Set(keys)
  return Object.keys(value).every(key => allowed.has(key))
}

function validArguments(value: unknown): value is Record<string, string> {
  if (!isRecord(value) || Object.keys(value).length > 24) return false
  let total = 0
  for (const [key, item] of Object.entries(value)) {
    if (!isShortString(key, 128) || !isShortString(item, 2048, true)) return false
    total += key.length + item.length
    if (total > 8192) return false
  }
  return true
}

function validRevision(value: unknown): value is string {
  return isShortString(value, 96) && /^[a-zA-Z0-9:_-]+$/.test(value)
}

export function isExtensionRef(value: unknown): value is ExtensionRef {
  if (!isRecord(value) || typeof value.kind !== 'string' || !Object.prototype.hasOwnProperty.call(KIND_KEYS, value.kind)) return false
  const kind = value.kind as ExtensionRef['kind']
  if (!hasOnlyKeys(value, KIND_KEYS[kind])) return false
  if (!isShortString(value.id, 512) || !isShortString(value.label, 180)) return false
  if (value.revision !== undefined && !validRevision(value.revision)) return false

  switch (kind) {
    case 'skill':
      return validRevision(value.revision) && (value.arguments === undefined || isShortString(value.arguments, 4096, true))
    case 'plugin':
    case 'mcp_server':
      return true
    case 'mcp_prompt':
      return isShortString(value.serverId, 256) && isShortString(value.promptName, 256) && (value.arguments === undefined || validArguments(value.arguments))
    case 'mcp_resource':
      return isShortString(value.serverId, 256) && isShortString(value.uri, 2048)
  }
}

export function isExtensionRefs(value: unknown): value is ExtensionRef[] {
  if (!Array.isArray(value) || value.length > 32 || !value.every(isExtensionRef)) return false
  const identities = value.map(ref => `${ref.kind}:${ref.id}`)
  return new Set(identities).size === identities.length
}

export function parseExtensionRefs(value: unknown): ExtensionRef[] {
  if (value === undefined || value === null) return []
  if (!isExtensionRefs(value)) throw new Error('Некорректный список ссылок на расширения.')
  return value
}
