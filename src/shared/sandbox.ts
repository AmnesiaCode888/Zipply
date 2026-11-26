import * as path from 'path'

export type SandboxAccessMode = 'read-only' | 'confirm' | 'automatic' | 'unrestricted'
export type SandboxProfile = 'read-only' | 'workspace-write' | 'unrestricted'
export type SandboxNetworkPolicy = 'off' | 'on'
export type SandboxBackend = 'windows-restricted' | 'linux-bwrap' | 'macos-seatbelt' | 'none'

export interface SandboxPolicy {
  profile: SandboxProfile
  network: SandboxNetworkPolicy
  writableRoots: string[]
  backend?: SandboxBackend
}

export interface SandboxPolicyConfigLike {
  accessMode?: SandboxAccessMode | string
  planMode?: boolean
  sandbox?: Partial<SandboxPolicy>
}

export function resolveSandboxPolicy(
  config: SandboxPolicyConfigLike | undefined,
  workspaceRoot: string
): SandboxPolicy {
  const resolvedRoot = path.resolve(workspaceRoot || process.cwd())

  if (config?.planMode || config?.accessMode === 'read-only') {
    return {
      profile: 'read-only',
      network: 'off',
      writableRoots: []
    }
  }

  let defaultProfile: SandboxProfile
  if (config?.accessMode === 'unrestricted') {
    defaultProfile = 'unrestricted'
  } else {
    defaultProfile = 'workspace-write'
  }

  const profile: SandboxProfile =
    config?.sandbox?.profile === 'read-only' ||
    config?.sandbox?.profile === 'workspace-write' ||
    config?.sandbox?.profile === 'unrestricted'
      ? config.sandbox.profile
      : defaultProfile

  const network: SandboxNetworkPolicy =
    config?.sandbox?.network === 'on' || config?.sandbox?.network === 'off'
      ? config.sandbox.network
      : profile === 'unrestricted'
        ? 'on'
        : 'off'

  const writableRoots =
    profile === 'read-only'
      ? []
      : Array.isArray(config?.sandbox?.writableRoots) && config.sandbox.writableRoots.length > 0
        ? config.sandbox.writableRoots.map((p) => path.resolve(p))
        : [resolvedRoot]

  return {
    profile,
    network,
    writableRoots
  }
}
