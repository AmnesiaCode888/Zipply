import type { AgentBase } from './AgentBase'
import { parseCodexPatch } from '../tools/ApplyPatchTool'

export interface ExtractedToolTarget {
  path: string
  isFile: boolean
  isMutation: boolean
}

const FILE_PATH_TOOLS = new Set([
  'read_file',
  'write_file',
  'edit_file',
  'verify_file',
  'code_intelligence'
])

const DIR_OR_PATH_TOOLS = new Set([
  'list_dir',
  'search_project',
  'find_files'
])

const CMD_TOOLS = new Set([
  'exec_command',
  'terminal',
  'run_command',
  'process_start'
])

export function extractToolTargetPaths(
  toolName: string,
  rawArgumentsJson: string,
  agent?: Pick<AgentBase, 'getHandler'>
): ExtractedToolTarget[] {
  let args: Record<string, unknown>
  try {
    const parsed: unknown = JSON.parse(rawArgumentsJson || '{}')
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return []
    args = parsed as Record<string, unknown>
  } catch {
    return []
  }

  const handler = agent?.getHandler(toolName)
  const mutatesByPolicy = handler ? handler.getExecutionPolicy(args).mutates : false

  if (toolName === 'apply_patch') {
    if (typeof args.patch === 'string' && args.patch.trim()) {
      try {
        return parseCodexPatch(args.patch)
          .filter((op) => typeof op.path === 'string' && op.path.trim().length > 0)
          .map((op) => ({ path: op.path, isFile: true, isMutation: true }))
      } catch {
        return []
      }
    }
    if (Array.isArray(args.operations)) {
      const targets: ExtractedToolTarget[] = []
      for (const op of args.operations as Array<{ path?: unknown }>) {
        if (typeof op?.path === 'string' && op.path.trim()) {
          targets.push({ path: op.path, isFile: true, isMutation: true })
        }
      }
      return targets
    }
    return []
  }

  if (toolName === 'read_files') {
    if (!Array.isArray(args.files)) return []
    const targets: ExtractedToolTarget[] = []
    for (const item of args.files as Array<{ path?: unknown }>) {
      if (typeof item?.path === 'string' && item.path.trim()) {
        targets.push({ path: item.path, isFile: true, isMutation: false })
      }
    }
    return targets
  }

  if (FILE_PATH_TOOLS.has(toolName)) {
    const p = args.path || args.filePath || args.file_path || args.filepath || args.filename || args.file
    if (typeof p === 'string' && p.trim()) {
      const isMutation = toolName === 'write_file' || toolName === 'edit_file' ? true : mutatesByPolicy
      return [{ path: p, isFile: true, isMutation }]
    }
    return []
  }

  if (DIR_OR_PATH_TOOLS.has(toolName)) {
    const p = args.path
    if (typeof p === 'string' && p.trim()) {
      return [{ path: p, isFile: false, isMutation: false }]
    }
    return []
  }

  if (CMD_TOOLS.has(toolName)) {
    const cwd = args.cwd || args.workdir
    if (typeof cwd === 'string' && cwd.trim()) {
      return [{ path: cwd, isFile: false, isMutation: mutatesByPolicy }]
    }
    return []
  }

  return []
}
