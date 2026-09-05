import { FileTool } from './FileTool'
import { ToolParameterDef, ToolResult } from './ToolBase'
import { Blackboard } from '../core/Blackboard'

/**
 * ReadOnlyFileTool — Read-only subset of FileTool for AskAgent.
 */
export class ReadOnlyFileTool extends FileTool {
  get description(): string {
    return 'Read-only file operations: inspect file content (read), list directories (list), find files by glob (glob), or view folder structure (read_tree).'
  }

  get parameters(): Record<string, ToolParameterDef> {
    return {
      description: {
        type: 'string',
        description: 'Краткое действие (2-4 слова, напр. "Чтение файла")',
        required: false
      },
      action: {
        type: 'string',
        description: 'Read-only operation: read (view lines) | list (flat directory) | glob (find files by pattern) | read_tree (folder tree)',
        required: true,
        enum: ['read', 'list', 'glob', 'read_tree']
      },
      path: {
        type: 'string',
        description: 'Target file or directory path (absolute or relative to workspace)',
        required: false
      },
      pattern: {
        type: 'string',
        description: '[For glob] Wildcard pattern or search keyword (e.g. *.ts, **/*.log, report*.xlsx)',
        required: false
      },
      start_line: {
        type: 'integer',
        description: '[For read] First line number (1-indexed)',
        required: false
      },
      end_line: {
        type: 'integer',
        description: '[For read] Last line number (1-indexed, inclusive)',
        required: false
      },
      max_depth: {
        type: 'integer',
        description: '[For read_tree] Directory traversal depth (default: 3, max: 6)',
        required: false
      }
    }
  }

  async execute(argumentsJson: string, blackboard: Blackboard, abortSignal?: AbortSignal): Promise<ToolResult> {
    let args: any
    try {
      args = JSON.parse(argumentsJson || '{}')
    } catch {
      return { formattedContent: 'Error: invalid JSON arguments.' }
    }

    let action = args.action?.toLowerCase()
    if (!action && args.path) {
      action = 'read'
      args.action = 'read'
      argumentsJson = JSON.stringify(args)
    }
    const allowed = ['read', 'list', 'glob', 'read_tree']

    if (!allowed.includes(action)) {
      return {
        formattedContent: `AskAgent is strictly read-only. Action '${action}' is not permitted. Only read, list, glob, read_tree are allowed.`
      }
    }

    return super.execute(argumentsJson, blackboard, abortSignal)
  }
}
