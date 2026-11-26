import { app } from 'electron'
import * as path from 'path'
import * as os from 'os'
import * as fs from 'fs/promises'

/**
 * Returns the base data directory for Zipply on Linux adhering to the XDG Base Directory specification.
 * Falls back to ~/.local/share/zipply if XDG_DATA_HOME is not set.
 */
export function getLinuxDataDir(homeDir?: string): string {
  const xdgData = process.env.XDG_DATA_HOME && process.env.XDG_DATA_HOME.trim()
  if (xdgData) {
    return path.join(xdgData, 'zipply')
  }
  const home = homeDir || (typeof app !== 'undefined' && app.getPath ? app.getPath('home') : (process.env.HOME || os.homedir()))
  return path.join(home, '.local', 'share', 'zipply')
}

/**
 * Returns the default root directory for chat workspaces.
 * On Linux: ~/.local/share/zipply/workspaces (or $XDG_DATA_HOME/zipply/workspaces)
 * On Windows/macOS: ~/Zipply/workspaces
 */
export function getDefaultWorkspacesDir(platform = process.platform, homeDir?: string): string {
  if (platform === 'linux') {
    return path.join(getLinuxDataDir(homeDir), 'workspaces')
  }
  const home = homeDir || (typeof app !== 'undefined' && app.getPath ? app.getPath('home') : (process.env.HOME || os.homedir()))
  return path.join(home, 'Zipply', 'workspaces')
}

/**
 * Configures Electron's userData path on Linux to live in $XDG_DATA_HOME/zipply (~/.local/share/zipply)
 * instead of the default ~/.config/zipply or polluting the user's home directory.
 */
export function setupLinuxUserDataPath(homeDir?: string): void {
  if (!process.env.ZIPPLY_E2E_ROOT) {
    try {
      if (typeof app !== 'undefined' && typeof app.setPath === 'function') {
        app.setPath('userData', process.platform === 'linux' ? getLinuxDataDir(homeDir) : path.join(app.getPath('appData'), 'zipply'))
      }
    } catch (err) {
      console.error('[PlatformPaths] Failed to set Linux userData path:', err)
    }
  }
}

/**
 * Migrates legacy folders on Linux:
 * 1. Moves any workspaces from ~/Zipply/workspaces to ~/.local/share/zipply/workspaces and removes ~/Zipply.
 * 2. Copies existing secrets.json and sessions from ~/.config/zipply if they exist and target does not.
 */
export async function migrateLegacyLinuxFolders(homeDir?: string): Promise<void> {
  if (process.platform !== 'linux' || process.env.ZIPPLY_E2E_ROOT) return
  const home = homeDir || (typeof app !== 'undefined' && app.getPath ? app.getPath('home') : (process.env.HOME || os.homedir()))
  if (!home) return

  // 1. Migrate ~/Zipply/workspaces -> ~/.local/share/zipply/workspaces
  try {
    const legacyZipply = path.join(home, 'Zipply')
    const legacyWorkspaces = path.join(legacyZipply, 'workspaces')
    const targetWorkspaces = getDefaultWorkspacesDir('linux', home)

    try {
      const stats = await fs.stat(legacyWorkspaces)
      if (stats.isDirectory()) {
        await fs.mkdir(targetWorkspaces, { recursive: true })
        const entries = await fs.readdir(legacyWorkspaces)
        for (const entry of entries) {
          const from = path.join(legacyWorkspaces, entry)
          const to = path.join(targetWorkspaces, entry)
          try {
            await fs.rename(from, to)
          } catch {
            await fs.cp(from, to, { recursive: true })
            await fs.rm(from, { recursive: true, force: true })
          }
        }
        await fs.rm(legacyWorkspaces, { recursive: true, force: true }).catch(() => {})
      }
    } catch {}

    // Clean up empty ~/Zipply folder if it exists and has no other files
    try {
      const remaining = await fs.readdir(legacyZipply)
      if (remaining.length === 0) {
        await fs.rm(legacyZipply, { recursive: true, force: true }).catch(() => {})
      }
    } catch {}
  } catch {}

  // 2. Migrate legacy ~/.config/zipply/{secrets.json, sessions} -> ~/.local/share/zipply/
  try {
    const xdgConfig = process.env.XDG_CONFIG_HOME && process.env.XDG_CONFIG_HOME.trim()
      ? process.env.XDG_CONFIG_HOME.trim()
      : path.join(home, '.config')
    const legacyConfigDir = path.join(xdgConfig, 'zipply')
    const targetDataDir = getLinuxDataDir(home)

    try {
      await fs.access(legacyConfigDir)
    } catch {
      return
    }

    await fs.mkdir(targetDataDir, { recursive: true })

    const legacySecrets = path.join(legacyConfigDir, 'secrets.json')
    const targetSecrets = path.join(targetDataDir, 'secrets.json')
    try {
      await fs.access(legacySecrets)
      try {
        await fs.access(targetSecrets)
      } catch {
        await fs.copyFile(legacySecrets, targetSecrets)
      }
    } catch {}

    const legacySessions = path.join(legacyConfigDir, 'sessions')
    const targetSessions = path.join(targetDataDir, 'sessions')
    try {
      const stats = await fs.stat(legacySessions)
      if (stats.isDirectory()) {
        await fs.mkdir(targetSessions, { recursive: true })
        const entries = await fs.readdir(legacySessions)
        for (const entry of entries) {
          const from = path.join(legacySessions, entry)
          const to = path.join(targetSessions, entry)
          try {
            await fs.access(to)
          } catch {
            await fs.copyFile(from, to)
          }
        }
      }
    } catch {}
  } catch {}
}
