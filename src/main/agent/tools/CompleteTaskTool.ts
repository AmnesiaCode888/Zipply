import { ToolBase, ToolParameterDef, ToolResult } from './ToolBase'
import { Blackboard } from '../core/Blackboard'

/**
 * CompleteTaskTool — Verification & Completion Gate (Cline / SWE-agent pattern).
 * Provides a formal contract for finishing tasks with verification details and summary.
 */
export class CompleteTaskTool extends ToolBase {
  get name(): string {
    return 'complete_task'
  }

  get description(): string {
    return 'Signal that the user assigned objective is fully accomplished and verified. Call this tool ONLY when all required changes and verification steps are complete.'
  }

  getExecutionPolicy() {
    return { mutates: false, parallelSafe: true, cacheable: false }
  }

  get parameters(): Record<string, ToolParameterDef> {
    return {
      description: {
        type: 'string',
        description: 'Краткое действие (2-4 слова, напр. "Завершение задачи")',
        required: false
      },
      summary: {
        type: 'string',
        description: 'Detailed Russian summary of what was accomplished, files created/modified, and results',
        required: true
      },
      verification_command: {
        type: 'string',
        description: 'Optional command executed to verify the result (e.g. npm test, npm run build, pytest)',
        required: false
      }
    }
  }

  async execute(argumentsJson: string, blackboard: Blackboard): Promise<ToolResult> {
    let args: any
    try {
      args = JSON.parse(argumentsJson || '{}')
    } catch {
      return { formattedContent: 'Error: invalid JSON arguments for complete_task.' }
    }

    const summary = typeof args.summary === 'string' ? args.summary.trim() : ''
    const verificationCommand = typeof args.verification_command === 'string' ? args.verification_command.trim() : ''

    if (!summary) {
      return { formattedContent: 'Error: summary parameter is required for complete_task.' }
    }

    if (blackboard && typeof blackboard.setArtifact === 'function') {
      blackboard.setArtifact('task_completed', true)
      blackboard.setArtifact('task_completion_summary', summary)
      if (verificationCommand) {
        blackboard.setArtifact('task_verification_command', verificationCommand)
      }
    }

    let output = `✅ Задача успешно завершена!\n\n${summary}`
    if (verificationCommand) {
      output += `\n\n🔍 Команда проверки: \`${verificationCommand}\``
    }

    return {
      formattedContent: output,
      data: {
        completed: true,
        summary,
        verificationCommand
      }
    }
  }
}
