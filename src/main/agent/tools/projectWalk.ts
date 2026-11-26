import * as fs from 'fs/promises'
import * as path from 'path'
import ignore, { Ignore } from 'ignore'
import picomatch from 'picomatch'

const ignoredNames = new Set(['.git', 'node_modules', 'dist', 'build', 'out', 'coverage'])
export const MAX_VISITED = 5000

/** Walk without following symlinks; nested ignore rules are scoped to their directory. */
export async function walkProject(root: string, workspace: string, glob: string | undefined, signal: AbortSignal | undefined, visit: (absolute: string, relative: string) => Promise<boolean>): Promise<{ truncated: boolean; cancelled: boolean }> {
  const match = glob ? picomatch(glob, { dot: true, basename: !glob.includes('/') }) : () => true
  let visited = 0
  let stopped = false
  const walk = async (dir: string, relative: string, rules: Array<{ base: string; matcher: Ignore }>): Promise<void> => {
    if (stopped || signal?.aborted) return
    try {
      const contents = await fs.readFile(path.join(dir, '.gitignore'), 'utf8')
      rules = [...rules, { base: dir, matcher: ignore().add(contents) }]
    } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
    const entries = await fs.readdir(dir, { withFileTypes: true })
    entries.sort((a, b) => a.name.localeCompare(b.name))
    for (const entry of entries) {
      if (signal?.aborted || stopped) break
      if (ignoredNames.has(entry.name) || entry.isSymbolicLink()) continue
      const item = relative ? `${relative}/${entry.name}` : entry.name
      const isDirectory = entry.isDirectory()
      if (!isDirectory && !entry.isFile()) continue
      const full = path.join(dir, entry.name)
      let ignored = false
      for (const { base, matcher } of rules) {
        const sub = path.relative(base, full).replace(/\\/g, '/')
        const result = matcher.test(isDirectory ? `${sub}/` : sub)
        if (result.ignored) ignored = true
        else if (result.unignored) ignored = false
      }
      if (ignored) continue
      if (isDirectory) { await walk(full, item, rules); continue }
      if (++visited > MAX_VISITED) { stopped = true; break }
      if (match(item) && await visit(full, item)) stopped = true
    }
  }
  const actualRoot = await fs.realpath(root)
  const actualWorkspace = await fs.realpath(workspace)
  const relativeRoot = path.relative(actualWorkspace, actualRoot)
  const inside = relativeRoot !== '..' && !relativeRoot.startsWith(`..${path.sep}`) && !path.isAbsolute(relativeRoot)
  const inherited: Array<{ base: string; matcher: Ignore }> = []
  if (inside && relativeRoot) {
    let current = actualWorkspace
    const parts = relativeRoot.split(path.sep)
    for (const part of parts) {
      try { inherited.push({ base: current, matcher: ignore().add(await fs.readFile(path.join(current, '.gitignore'), 'utf8')) }) }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
      current = path.join(current, part)
    }
  }
  await walk(actualRoot, '', inherited)
  return { truncated: stopped, cancelled: Boolean(signal?.aborted) }
}
