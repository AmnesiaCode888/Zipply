import * as fs from 'fs/promises'
import * as path from 'path'

export const IGNORED_DIR_NAMES = new Set([
  '.git',
  '.hg',
  '.svn',
  'node_modules',
  '.pnpm-store',
  '.yarn',
  '.venv',
  'venv',
  'env',
  '.env',
  'virtualenv',
  '__pycache__',
  '.pytest_cache',
  '.mypy_cache',
  '.ruff_cache',
  '.tox',
  '.nox',
  '.eggs',
  'dist',
  'build',
  'out',
  'coverage',
  '.next',
  '.nuxt',
  '.output',
  '.svelte-kit',
  '.turbo',
  '.parcel-cache',
  '.cache',
  '.gradle',
  '.idea',
  '.vs',
  'target',
  'vendor',
  'Pods',
  'bin',
  'obj'
])

const IGNORED_DIR_SUFFIXES = ['.egg-info', '.dist-info']

const IGNORED_FILE_NAMES = new Set(['.DS_Store', 'Thumbs.db', 'desktop.ini'])

const IGNORED_FILE_EXTENSIONS = new Set([
  '.pyc',
  '.pyo',
  '.pyd',
  '.class',
  '.o',
  '.obj',
  '.a',
  '.so',
  '.dylib',
  '.dll',
  '.swp',
  '.swo',
  '.tmp'
])

export function isIgnoredDirName(name: string): boolean {
  if (IGNORED_DIR_NAMES.has(name)) return true
  const lower = name.toLowerCase()
  for (const suffix of IGNORED_DIR_SUFFIXES) {
    if (lower.endsWith(suffix)) return true
  }
  return false
}

export function isIgnoredFileName(name: string): boolean {
  if (IGNORED_FILE_NAMES.has(name)) return true
  const lower = name.toLowerCase()
  for (const ext of IGNORED_FILE_EXTENSIONS) {
    if (lower.endsWith(ext)) return true
  }
  return false
}

/**
 * Checks whether any path segment in a POSIX relative path belongs to a known
 * dependency/build/venv/cache directory or generated noise file.
 */
export function isNoiseRelativePath(posixRelPath: string): boolean {
  const clean = posixRelPath.replace(/\\/g, '/').replace(/^\.\//, '')
  if (!clean) return false
  const parts = clean.split('/')
  const fileName = parts[parts.length - 1]
  if (isIgnoredFileName(fileName)) return true
  for (let i = 0; i < parts.length - 1; i++) {
    if (isIgnoredDirName(parts[i])) return true
  }
  return false
}

/**
 * Detects Python virtual environments even when named arbitrarily (e.g. `myenv/`),
 * by checking for `pyvenv.cfg` inside the directory.
 */
export async function isPythonVenvDir(absDir: string): Promise<boolean> {
  try {
    await fs.access(path.join(absDir, 'pyvenv.cfg'))
    return true
  } catch {
    return false
  }
}
