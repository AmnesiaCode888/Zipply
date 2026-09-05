import { useState, useCallback, useEffect, useMemo } from 'react'
import { ProjectRef } from '../types/chat'
import { basenamePath } from '../utils/projects'

const PROJECTS_STORAGE_KEY = 'zipply_projects'
const MAX_RECENT = 20

function normalizeProjectPath(p: string): string {
  if (!p) return p
  return p.replace(/([dD]:[\\/])(?:clickprojects|zippleprojects)/gi, '$1zipplyprojects')
}

function getStoredProjects(): ProjectRef[] {
  try {
    const saved = localStorage.getItem(PROJECTS_STORAGE_KEY) ||
                  localStorage.getItem('zipple_projects') ||
                  localStorage.getItem('clickcoder_projects') ||
                  localStorage.getItem('clickcode_projects') ||
                  localStorage.getItem('click_projects')
    if (saved) {
      const parsed = JSON.parse(saved)
      if (Array.isArray(parsed)) {
        return parsed
          .filter((p) => p && p.path)
          .map((p) => {
            const cleanPath = normalizeProjectPath(p.path)
            return {
              name: p.name || basenamePath(cleanPath),
              path: cleanPath,
              lastUsedAt: p.lastUsedAt
            }
          })
      }
    }
  } catch {
    // ignore
  }
  return []
}

function persistProjects(projects: ProjectRef[]): void {
  try {
    localStorage.setItem(PROJECTS_STORAGE_KEY, JSON.stringify(projects))
  } catch {}
  if (window.api?.storage?.setStore) {
    window.api.storage.setStore('projects', projects, 300).catch(() => {})
  }
}

export interface UseProjectsReturn {
  /** Recent (localStorage) + existing folders under baseDir, deduped by path. */
  projects: ProjectRef[]
  createProject: (name: string) => Promise<ProjectRef | null>
  browseProject: () => Promise<ProjectRef | null>
}

export function useProjects(): UseProjectsReturn {
  const [recent, setRecent] = useState<ProjectRef[]>(getStoredProjects)
  const [baseProjects, setBaseProjects] = useState<ProjectRef[]>([])
  const [baseDir, setBaseDir] = useState<string>('d:/zipplyprojects')

  // Resolve baseDir and hydrate from file storage on mount
  useEffect(() => {
    // 1. Hydrate recent projects from file store
    if (window.api?.storage?.getStore) {
      window.api.storage
        .getStore<ProjectRef[]>('projects')
        .then((fileProjects) => {
          if (Array.isArray(fileProjects) && fileProjects.length > 0) {
            const normalized = fileProjects
              .filter((p) => p && p.path)
              .map((p) => {
                const cleanPath = normalizeProjectPath(p.path)
                return {
                  name: p.name || basenamePath(cleanPath),
                  path: cleanPath,
                  lastUsedAt: p.lastUsedAt
                }
              })
            setRecent(normalized)
            try {
              localStorage.setItem(PROJECTS_STORAGE_KEY, JSON.stringify(normalized))
            } catch {}
          }
        })
        .catch(() => {})
    }

    // 2. Fetch system default path and configured baseDir
    if (window.api?.storage?.getInfo) {
      window.api.storage
        .getInfo()
        .then((info) => {
          try {
            const saved = localStorage.getItem('zipply_ai_config') ||
                          localStorage.getItem('zipple_ai_config') ||
                          localStorage.getItem('clickcoder_ai_config') ||
                          localStorage.getItem('clickcode_ai_config') ||
                          localStorage.getItem('click_ai_config')
            if (saved) {
              const parsed = JSON.parse(saved)
              if (parsed?.baseDir && typeof parsed.baseDir === 'string' && parsed.baseDir.trim()) {
                setBaseDir(normalizeProjectPath(parsed.baseDir.trim()))
                return
              }
            }
          } catch {}
          if (info?.defaultProjectsDir) {
            setBaseDir(info.defaultProjectsDir)
          }
        })
        .catch(() => {})
    }
  }, [])

  const refreshBaseProjects = useCallback(async (): Promise<void> => {
    try {
      if (window.api?.projects?.list) {
        const list = await window.api.projects.list(baseDir)
        setBaseProjects(Array.isArray(list) ? list : [])
      }
    } catch {
      // ignore — listing is best-effort
    }
  }, [baseDir])

  useEffect(() => {
    refreshBaseProjects()
  }, [refreshBaseProjects])

  const addRecent = useCallback((p: ProjectRef): void => {
    setRecent((prev) => {
      const entry: ProjectRef = {
        name: p.name || basenamePath(p.path),
        path: p.path,
        lastUsedAt: Date.now()
      }
      const next = [entry, ...prev.filter((x) => x.path !== p.path)].slice(0, MAX_RECENT)
      persistProjects(next)
      return next
    })
  }, [])

  const createProject = useCallback(
    async (name: string): Promise<ProjectRef | null> => {
      const trimmed = name.trim()
      if (!trimmed) return null
      try {
        const created = window.api?.projects?.create
          ? await window.api.projects.create(baseDir, trimmed)
          : null
        if (created && created.path) {
          addRecent({ name: created.name || basenamePath(created.path), path: created.path })
          refreshBaseProjects()
          return created
        }
      } catch {
        // ignore
      }
      return null
    },
    [baseDir, addRecent, refreshBaseProjects]
  )

  const browseProject = useCallback(async (): Promise<ProjectRef | null> => {
    try {
      const path = window.api?.dialog?.selectDirectory
        ? await window.api.dialog.selectDirectory(baseDir)
        : null
      if (path) {
        const p: ProjectRef = { name: basenamePath(path), path }
        addRecent(p)
        return p
      }
    } catch {
      // ignore
    }
    return null
  }, [baseDir, addRecent])

  const projects = useMemo<ProjectRef[]>(() => {
    const seen = new Set<string>()
    const merged: ProjectRef[] = []
    for (const p of [...recent, ...baseProjects]) {
      if (!p || !p.path || seen.has(p.path)) continue
      seen.add(p.path)
      merged.push(p)
    }
    return merged
  }, [recent, baseProjects])

  return { projects, createProject, browseProject }
}

export default useProjects
