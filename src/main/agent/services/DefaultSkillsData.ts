/**
 * DefaultSkillsData — Dynamic, Non-Hardcoded Skills Loader for Zipply.
 *
 * All default skills are stored as genuine markdown files in `resources/skills/`.
 * This loader dynamically reads, parses, and provides them to SkillService without
 * hardcoding content inside TypeScript string literals.
 */

import fs from 'fs'
import path from 'path'
import { app } from 'electron'

export const DEFAULT_SKILLS_VERSION = 3

export interface DefaultSkillDefinition {
  fileName: string
  content: string
}

export class DefaultSkillsLoader {
  private static _resolvedSkillsDir: string | null = null

  /**
   * Resolves the directory where default skill markdown files are located.
   * Checks packaged Electron resources, app path, and project development root.
   */
  static getDefaultSkillsDir(): string {
    if (this._resolvedSkillsDir && fs.existsSync(this._resolvedSkillsDir)) {
      return this._resolvedSkillsDir
    }

    const candidates: string[] = []

    // 1. Packaged Electron resources
    if (process.resourcesPath) {
      candidates.push(path.join(process.resourcesPath, 'resources', 'skills'))
      candidates.push(path.join(process.resourcesPath, 'skills'))
    }

    // 2. Electron app path
    try {
      if (app && typeof app.getAppPath === 'function') {
        const appPath = app.getAppPath()
        candidates.push(path.join(appPath, 'resources', 'skills'))
        candidates.push(path.join(appPath, 'skills'))
      }
    } catch {}

    // 3. Workspace root relative to process.cwd()
    candidates.push(path.join(process.cwd(), 'resources', 'skills'))

    // 4. Relative to current file location (__dirname)
    try {
      if (typeof __dirname === 'string') {
        candidates.push(path.resolve(__dirname, '../../../../resources/skills'))
        candidates.push(path.resolve(__dirname, '../../../resources/skills'))
        candidates.push(path.resolve(__dirname, '../../resources/skills'))
      }
    } catch {}

    for (const candidate of candidates) {
      if (fs.existsSync(candidate)) {
        try {
          const files = fs.readdirSync(candidate).filter((f) => f.endsWith('.md') || f.endsWith('.mdc'))
          if (files.length > 0) {
            this._resolvedSkillsDir = candidate
            return candidate
          }
        } catch {}
      }
    }

    return path.join(process.cwd(), 'resources', 'skills')
  }

  /**
   * Dynamically loads all default skills from genuine markdown files in the skills directory.
   */
  static loadDefaultSkills(): DefaultSkillDefinition[] {
    const dir = this.getDefaultSkillsDir()
    const results: DefaultSkillDefinition[] = []

    if (fs.existsSync(dir)) {
      try {
        const entries = fs.readdirSync(dir, { withFileTypes: true })
        for (const entry of entries) {
          if (entry.isFile() && (entry.name.endsWith('.md') || entry.name.endsWith('.mdc'))) {
            try {
              const fullPath = path.join(dir, entry.name)
              const content = fs.readFileSync(fullPath, 'utf-8')
              if (content.trim()) {
                results.push({
                  fileName: entry.name,
                  content
                })
              }
            } catch (err) {
              console.warn(`[DefaultSkillsLoader] Failed to read ${entry.name}:`, err)
            }
          }
        }
      } catch (err) {
        console.warn(`[DefaultSkillsLoader] Failed to list directory ${dir}:`, err)
      }
    }

    return results
  }
}

/**
 * Transparent proxy for DEFAULT_SKILLS providing array compatibility
 * while dynamically querying the filesystem on access.
 */
export const DEFAULT_SKILLS: DefaultSkillDefinition[] = new Proxy([] as DefaultSkillDefinition[], {
  get(_target, prop) {
    const loaded = DefaultSkillsLoader.loadDefaultSkills()
    if (prop === 'length') return loaded.length
    if (prop === Symbol.iterator) return loaded[Symbol.iterator].bind(loaded)
    if (typeof prop === 'string' && !isNaN(Number(prop))) {
      return loaded[Number(prop)]
    }
    const val = (loaded as any)[prop]
    return typeof val === 'function' ? val.bind(loaded) : val
  }
})
