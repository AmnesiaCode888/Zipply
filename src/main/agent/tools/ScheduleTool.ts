import { ToolBase, ToolParameterDef, ToolResult } from './ToolBase'
import { Blackboard } from '../core/Blackboard'
import { SchedulerService, ScheduleType } from '../services/SchedulerService'

/**
 * ScheduleTool — Allows the agent to schedule one-shot timers or recurring cron tasks.
 */
export class ScheduleTool extends ToolBase {
  get name(): string {
    return 'schedule'
  }

  get description(): string {
    return 'Schedule one-shot timers or recurring cron tasks to automate background checks, delayed reminders, and periodic PC workflows.'
  }

  getExecutionPolicy(args: Record<string, unknown> = {}) {
    const action = String(args.action || 'list').toLowerCase()
    const mutates = ['create', 'cancel', 'pause', 'resume'].includes(action)
    return { mutates, parallelSafe: !mutates, cacheable: !mutates }
  }

  get parameters(): Record<string, ToolParameterDef> {
    return {
      description: {
        type: 'string',
        description: 'Краткое действие (2-4 слова, напр. "Установка таймера")',
        required: false
      },
      action: {
        type: 'string',
        description: 'Action: create | list | cancel | pause | resume | get_logs',
        required: true,
        enum: ['create', 'list', 'cancel', 'pause', 'resume', 'get_logs']
      },
      type: {
        type: 'string',
        description: '[For create] Schedule type: "once" (timer after delay) or "recurring" (cron expression / interval)',
        required: false,
        enum: ['once', 'recurring']
      },
      delay_seconds: {
        type: 'integer',
        description: '[For once] Delay in seconds before execution (min: 5, e.g. 300 for 5 minutes, 3600 for 1 hour)',
        required: false
      },
      cron_expression: {
        type: 'string',
        description:
          '[For recurring] Standard 5-field cron string (e.g. "*/15 * * * *" = every 15m, "0 9 * * 1-5" = weekdays at 9am, "@hourly")',
        required: false
      },
      interval_seconds: {
        type: 'integer',
        description: '[For recurring] Simple interval in seconds (min: 60, e.g. 900 for every 15 min)',
        required: false
      },
      prompt: {
        type: 'string',
        description: '[Required for create] Instruction / prompt for the agent to execute when triggered',
        required: false
      },
      title: {
        type: 'string',
        description: 'Short human-readable title or label for the scheduled task',
        required: false
      },
      max_iterations: {
        type: 'integer',
        description: '[For recurring] Maximum number of trigger runs before auto-stopping (default: 50)',
        required: false
      },
      notify_os: {
        type: 'boolean',
        description: 'Whether to show native desktop notification when the task completes (default: true)',
        required: false
      },
      task_id: {
        type: 'string',
        description: '[Required for cancel, pause, resume, get_logs] Target schedule ID (e.g. "sched_171...")',
        required: false
      }
    }
  }

  async execute(argumentsJson: string, blackboard: Blackboard): Promise<ToolResult> {
    let args: any = {}
    try {
      args = JSON.parse(argumentsJson || '{}')
    } catch {
      return { formattedContent: 'Error: invalid JSON arguments for schedule tool.' }
    }

    const action = String(args.action || 'list').toLowerCase()

    // --- CREATE ---
    if (action === 'create') {
      const prompt = args.prompt?.trim()
      if (!prompt) {
        return { formattedContent: 'Error: parameter "prompt" is required for creating a schedule.' }
      }

      const workspace = (blackboard?.getArtifact('workspacePath') as string) || ''
      const res = SchedulerService.createSchedule({
        type: args.type as ScheduleType,
        delaySeconds: Number(args.delay_seconds) || undefined,
        cronExpression: args.cron_expression,
        intervalSeconds: Number(args.interval_seconds) || undefined,
        prompt,
        title: args.title,
        workspacePath: workspace,
        maxIterations: Number(args.max_iterations) || undefined,
        notifyOs: args.notify_os !== false,
        catchUp: args.catch_up === true
      })

      if (!res.success || !res.item) {
        return { formattedContent: `Failed to create schedule: ${res.error || 'Unknown error'}` }
      }

      const item = res.item
      const typeLabel = item.type === 'once' ? `One-shot timer (${item.delaySeconds}s delay)` : `Recurring (${item.cronExpression || item.intervalSeconds + 's'})`
      const nextTimeStr = item.nextRunAt ? new Date(item.nextRunAt).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : 'N/A'

      return {
        formattedContent: `✅ Scheduled task created successfully!\n\n• ID: ${item.id}\n• Title: "${item.title}"\n• Type: ${typeLabel}\n• Next run: ${nextTimeStr} (${item.nextRunAt})\n• Prompt: "${item.prompt}"\n• OS Notification: ${item.notifyOs ? 'Enabled' : 'Disabled'}\n\nThe system will automatically wake up and execute this task in the background at the specified time.`,
        data: item
      }
    }

    // --- LIST ---
    if (action === 'list') {
      const all = SchedulerService.getAllSchedules()
      if (all.length === 0) {
        return { formattedContent: 'No scheduled tasks found.' }
      }

      const active = all.filter((s) => s.status === 'active')
      const other = all.filter((s) => s.status !== 'active')

      let out = `Scheduled Tasks (${all.length} total, ${active.length} active):\n\n`
      for (const item of all) {
        const statusIcon = item.status === 'active' ? '🟢' : item.status === 'paused' ? '🟡' : item.status === 'paused_error' ? '🔴' : '⚪'
        const nextStr = item.nextRunAt ? new Date(item.nextRunAt).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }) : 'None'
        out += `${statusIcon} [${item.id}] "${item.title}" | Status: ${item.status.toUpperCase()} | Runs: ${item.executionCount}${item.maxIterations ? '/' + item.maxIterations : ''}\n`
        out += `   Timing: ${item.type === 'once' ? `Once (in ${item.delaySeconds}s)` : `Cron (${item.cronExpression})`} | Next: ${nextStr}\n`
        out += `   Prompt: ${item.prompt.slice(0, 100)}${item.prompt.length > 100 ? '...' : ''}\n\n`
      }

      return { formattedContent: out.trim(), data: all }
    }

    // --- CANCEL ---
    if (action === 'cancel') {
      const taskId = args.task_id?.trim()
      if (!taskId) return { formattedContent: 'Error: "task_id" is required for action="cancel".' }

      const success = SchedulerService.cancelSchedule(taskId)
      return {
        formattedContent: success ? `✅ Scheduled task ${taskId} cancelled.` : `Error: task ${taskId} not found.`
      }
    }

    // --- PAUSE ---
    if (action === 'pause') {
      const taskId = args.task_id?.trim()
      if (!taskId) return { formattedContent: 'Error: "task_id" is required for action="pause".' }

      const success = SchedulerService.pauseSchedule(taskId)
      return {
        formattedContent: success ? `⏸️ Scheduled task ${taskId} paused.` : `Error: task ${taskId} not found or not active.`
      }
    }

    // --- RESUME ---
    if (action === 'resume') {
      const taskId = args.task_id?.trim()
      if (!taskId) return { formattedContent: 'Error: "task_id" is required for action="resume".' }

      const success = SchedulerService.resumeSchedule(taskId)
      return {
        formattedContent: success ? `▶️ Scheduled task ${taskId} resumed.` : `Error: task ${taskId} not found or not paused.`
      }
    }

    // --- GET_LOGS ---
    if (action === 'get_logs') {
      const taskId = args.task_id?.trim()
      if (!taskId) return { formattedContent: 'Error: "task_id" is required for action="get_logs".' }

      const item = SchedulerService.getSchedule(taskId)
      if (!item) return { formattedContent: `Error: task ${taskId} not found.` }

      if (item.logs.length === 0) {
        return { formattedContent: `No execution logs for task ${taskId} (has not triggered yet).` }
      }

      let out = `Execution Logs for [${item.id}] "${item.title}" (${item.logs.length} runs):\n\n`
      for (const log of item.logs) {
        const time = new Date(log.timestamp).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
        const icon = log.status === 'success' ? '✅' : log.status === 'skipped' ? '⚠️' : '❌'
        out += `${icon} [${time}] (${log.durationMs ? log.durationMs + 'ms' : 'N/A'}) Status: ${log.status.toUpperCase()}\n`
        out += `   ${log.message}\n\n`
      }

      return { formattedContent: out.trim(), data: item.logs }
    }

    return { formattedContent: `Error: unknown schedule action "${action}". Supported: create, list, cancel, pause, resume, get_logs.` }
  }
}
