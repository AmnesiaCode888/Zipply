import * as path from 'path'

/** Adds read-only workspace dependency lookup for isolated child worktrees. */
export function applyDependencyEnvironment(env: Record<string, string>, dependencyPaths: string[] = []): void {
  const paths = [...new Set(dependencyPaths.filter(value => typeof value === 'string' && path.isAbsolute(value)).map(value => path.resolve(value)))]
  if (!paths.length) return

  const nodePaths = [...paths, env.NODE_PATH].filter((value): value is string => Boolean(value))
  env.NODE_PATH = [...new Set(nodePaths.join(path.delimiter).split(path.delimiter).filter(Boolean))].join(path.delimiter)

  const pathKey = Object.keys(env).find(key => key.toLowerCase() === 'path') || (process.platform === 'win32' ? 'Path' : 'PATH')
  const executablePaths = paths.map(value => path.join(value, '.bin'))
  env[pathKey] = [...new Set([...executablePaths, env[pathKey]].filter(Boolean) as string[])].join(path.delimiter)
}
