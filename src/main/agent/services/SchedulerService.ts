import fs from 'fs'
import path from 'path'
import { app, Notification, BrowserWindow } from 'electron'
import { AgentRunner } from '../core/AgentRunner'
import { agentRegistry } from '../core/AgentRegistry'
import { ChatConfig } from './ChatService'
import { LocalStorageService } from '../../services/LocalStorageService'

export type ScheduleType = 'once' | 'recurring'
export type ScheduleStatus = 'active' | 'completed' | 'cancelled' | 'paused' | 'paused_error' | 'missed'

export interface ScheduleLogEntry {
  timestamp: string
  status: 'success' | 'error' | 'skipped'
  message: string
  durationMs?: number
  resultSnippet?: string
}

export interface ScheduleItem {
  id: string
  title: string
  type: ScheduleType
  status: ScheduleStatus
  prompt: string
  chatId?: string
  workspacePath?: string
  delaySeconds?: number
  cronExpression?: string
  intervalSeconds?: number
  createdAt: string
  nextRunAt: string | null
  lastRunAt?: string
  executionCount: number
  maxIterations?: number
  notifyOs: boolean
  catchUp?: boolean
  lastError?: string
  consecutiveErrors: number
  logs: ScheduleLogEntry[]
}

export interface CreateScheduleOptions {
  type?: ScheduleType
  delaySeconds?: number
  cronExpression?: string
  intervalSeconds?: number
  prompt: string
  title?: string
  chatId?: string
  workspacePath?: string
  maxIterations?: number
  notifyOs?: boolean
  catchUp?: boolean
}

/**
 * Robust zero-dependency 5-field Cron parser & evaluator.
 */
export class CronEvaluator {
  static parseShorthand(expr: string): string {
    const clean = expr.trim().toLowerCase()
    if (clean === '@hourly') return '0 * * * *'
    if (clean === '@daily' || clean === '@midnight') return '0 0 * * *'
    if (clean === '@weekly') return '0 0 * * 0'
    if (clean === '@monthly') return '0 0 1 * *'
    return expr.trim()
  }

  static parseEveryShorthand(expr: string): number | null {
    const clean = expr.trim().toLowerCase()
    const match = clean.match(/^@every\s+(\d+)\s*(s|sec|m|min|h|hr|hour|d|day)?$/)
    if (!match) return null
    const val = parseInt(match[1], 10)
    const unit = match[2] || 's'
    if (unit.startsWith('s')) return val
    if (unit.startsWith('m')) return val * 60
    if (unit.startsWith('h')) return val * 3600
    if (unit.startsWith('d')) return val * 86400
    return val
  }

  static validateCron(expr: string): { valid: boolean; error?: string; normalized?: string } {
    const everySec = this.parseEveryShorthand(expr)
    if (everySec !== null) {
      if (everySec < 60) {
        return { valid: false, error: 'Interval must be at least 60 seconds (1 minute).' }
      }
      return { valid: true, normalized: `@every ${everySec}s` }
    }

    const standard = this.parseShorthand(expr)
    const parts = standard.split(/\s+/)
    if (parts.length !== 5) {
      return {
        valid: false,
        error: `Invalid cron format: expected 5 fields (minute hour dom month dow), got ${parts.length}. Example: "*/15 * * * *"`
      }
    }

    const [min, hour, dom, month, dow] = parts
    if (!this._validateField(min, 0, 59)) return { valid: false, error: `Invalid minute field: "${min}" (must be 0-59)` }
    if (!this._validateField(hour, 0, 23)) return { valid: false, error: `Invalid hour field: "${hour}" (must be 0-23)` }
    if (!this._validateField(dom, 1, 31)) return { valid: false, error: `Invalid day of month: "${dom}" (must be 1-31)` }
    if (!this._validateField(month, 1, 12)) return { valid: false, error: `Invalid month: "${month}" (must be 1-12)` }
    if (!this._validateField(dow, 0, 7)) return { valid: false, error: `Invalid day of week: "${dow}" (must be 0-7)` }

    return { valid: true, normalized: standard }
  }

  private static _validateField(field: string, min: number, max: number): boolean {
    if (field === '*') return true
    if (field.startsWith('*/')) {
      const step = parseInt(field.slice(2), 10)
      return Number.isInteger(step) && step > 0 && step <= max
    }
    const subparts = field.split(',')
    for (const sp of subparts) {
      if (sp.includes('-')) {
        const [start, end] = sp.split('-').map((v) => parseInt(v, 10))
        if (!Number.isInteger(start) || !Number.isInteger(end) || start < min || end > max || start > end) return false
      } else {
        const num = parseInt(sp, 10)
        if (!Number.isInteger(num) || num < min || num > max) return false
      }
    }
    return true
  }

  static getNextDate(expr: string, fromDate: Date = new Date()): Date | null {
    const everySec = this.parseEveryShorthand(expr)
    if (everySec !== null) {
      return new Date(fromDate.getTime() + everySec * 1000)
    }

    const validation = this.validateCron(expr)
    if (!validation.valid || !validation.normalized) return null

    const parts = validation.normalized.split(/\s+/)
    const [minPat, hourPat, domPat, monthPat, dowPat] = parts

    const current = new Date(fromDate.getTime())
    // Advance to next whole minute (0 seconds, 0 ms)
    current.setSeconds(0, 0)
    current.setMinutes(current.getMinutes() + 1)

    // Check up to 525,600 minutes ahead (1 year)
    const maxIterations = 525600
    for (let i = 0; i < maxIterations; i++) {
      const curMin = current.getMinutes()
      const curHour = current.getHours()
      const curDom = current.getDate()
      const curMonth = current.getMonth() + 1
      const curDow = current.getDay() // 0 = Sunday, 1 = Monday...

      if (
        this._matches(curMin, minPat, 0, 59) &&
        this._matches(curHour, hourPat, 0, 23) &&
        this._matches(curMonth, monthPat, 1, 12) &&
        this._matches(curDom, domPat, 1, 31) &&
        (this._matches(curDow, dowPat, 0, 7) || (curDow === 0 && this._matches(7, dowPat, 0, 7)))
      ) {
        return new Date(current.getTime())
      }

      current.setMinutes(current.getMinutes() + 1)
    }

    return null
  }

  private static _matches(val: number, pattern: string, min: number, max: number): boolean {
    if (pattern === '*') return true
    if (pattern.startsWith('*/')) {
      const step = parseInt(pattern.slice(2), 10)
      return (val - min) % step === 0
    }
    const subparts = pattern.split(',')
    return subparts.some((sp) => {
      if (sp.includes('-')) {
        const [start, end] = sp.split('-').map((v) => parseInt(v, 10))
        return val >= start && val <= end
      }
      return val === parseInt(sp, 10)
    })
  }
}

/**
 * SchedulerService — Enterprise-grade Background Scheduling & Cron Engine.
 */
export class SchedulerService {
  private static _filePath: string | null = null
  private static _items: Map<string, ScheduleItem> = new Map()
  private static _activeTimers: Map<string, NodeJS.Timeout> = new Map()
  private static _activeExecutions: Set<string> = new Set()
  private static _initialized = false

  static readonly MAX_ACTIVE_SCHEDULES = 20
  static readonly MAX_STORED_SCHEDULES = 100
  static readonly MIN_ONCE_DELAY_SECONDS = 5
  static readonly MIN_CRON_INTERVAL_SECONDS = 60
  static readonly DEFAULT_MAX_ITERATIONS = 50
  static readonly CIRCUIT_BREAKER_ERRORS = 3
  static readonly TASK_TIMEOUT_MS = 180000 // 3 minutes

  static getFilePath(): string {
    if (!this._filePath) {
      const baseDir = app ? app.getPath('userData') : process.env.APPDATA || process.cwd()
      this._filePath = path.join(baseDir, 'zipply-schedules.json')
    }
    return this._filePath
  }

  /**
   * Initialize scheduler, load persisted tasks, and re-arm timers.
   */
  static init(): void {
    if (this._initialized) return
    this._initialized = true

    try {
      this._load()
      this._armAll()
      console.log(`[SchedulerService] Initialized with ${this._items.size} tasks (${this._countActive()} active).`)
    } catch (err) {
      console.error('[SchedulerService] Initialization error:', err)
    }
  }

  private static _countActive(): number {
    return Array.from(this._items.values()).filter((i) => i.status === 'active').length
  }

  private static _load(): void {
    const fp = this.getFilePath()
    let loadPath = fp
    let isLegacy = false

    if (!fs.existsSync(loadPath)) {
      const baseDir = path.dirname(fp)
      const legacyCandidates = [
        path.join(baseDir, 'zipple-schedules.json'),
        path.join(baseDir, 'clickcoder-schedules.json'),
        path.join(baseDir, 'clickcode-schedules.json'),
        path.join(baseDir, 'click-schedules.json'),
        path.join(process.cwd(), 'zipple-schedules.json'),
        path.join(process.cwd(), 'clickcoder-schedules.json'),
        path.join(process.cwd(), 'clickcode-schedules.json'),
        path.join(process.cwd(), 'click-schedules.json')
      ]
      for (const candidate of legacyCandidates) {
        if (fs.existsSync(candidate)) {
          loadPath = candidate
          isLegacy = true
          break
        }
      }
    }

    if (!fs.existsSync(loadPath)) return
    try {
      const raw = fs.readFileSync(loadPath, 'utf8')
      const data = JSON.parse(raw)
      if (Array.isArray(data.items)) {
        this._items.clear()
        for (const item of data.items) {
          if (item && item.id) {
            this._items.set(item.id, item)
          }
        }
        if (isLegacy) {
          this._save()
        }
      }
    } catch (e) {
      console.warn('[SchedulerService] Failed to load schedules file:', e)
    }
  }

  private static _save(): void {
    try {
      const fp = this.getFilePath()
      const dir = path.dirname(fp)
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })

      // Auto-prune old completed/cancelled items if over limit
      let allItems = Array.from(this._items.values())
      if (allItems.length > this.MAX_STORED_SCHEDULES) {
        const active = allItems.filter((i) => i.status === 'active')
        const inactive = allItems
          .filter((i) => i.status !== 'active')
          .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
          .slice(0, this.MAX_STORED_SCHEDULES - active.length)

        this._items.clear()
        for (const item of [...active, ...inactive]) {
          this._items.set(item.id, item)
        }
        allItems = Array.from(this._items.values())
      }

      fs.writeFileSync(fp, JSON.stringify({ items: allItems, updatedAt: new Date().toISOString() }, null, 2), 'utf8')
    } catch (e) {
      console.error('[SchedulerService] Failed to save schedules:', e)
    }
  }

  private static _armAll(): void {
    const now = new Date()
    for (const item of this._items.values()) {
      if (item.status !== 'active') continue

      if (item.type === 'once') {
        const nextDate = item.nextRunAt ? new Date(item.nextRunAt) : null
        if (!nextDate || isNaN(nextDate.getTime())) {
          item.status = 'cancelled'
          continue
        }

        const diffMs = nextDate.getTime() - now.getTime()
        if (diffMs <= 0) {
          // Missed during offline/sleep
          if (item.catchUp && Math.abs(diffMs) < 7200000) {
            // Within 2 hours -> trigger immediately
            this._scheduleTimer(item.id, 1000)
          } else {
            item.status = 'missed'
            item.logs.push({
              timestamp: new Date().toISOString(),
              status: 'skipped',
              message: `Missed scheduled execution (was scheduled for ${item.nextRunAt}).`
            })
          }
        } else {
          this._scheduleTimer(item.id, diffMs)
        }
      } else if (item.type === 'recurring') {
        const nextDate = this._calculateNextRecurringDate(item, now)
        if (nextDate) {
          item.nextRunAt = nextDate.toISOString()
          const diffMs = Math.max(1000, nextDate.getTime() - now.getTime())
          this._scheduleTimer(item.id, diffMs)
        } else {
          item.status = 'completed'
        }
      }
    }
    this._save()
  }

  private static _calculateNextRecurringDate(item: ScheduleItem, fromDate: Date = new Date()): Date | null {
    if (item.intervalSeconds && item.intervalSeconds > 0) {
      return new Date(fromDate.getTime() + item.intervalSeconds * 1000)
    }
    if (item.cronExpression) {
      return CronEvaluator.getNextDate(item.cronExpression, fromDate)
    }
    return null
  }

  private static _scheduleTimer(taskId: string, delayMs: number): void {
    // Clear any existing handle
    if (this._activeTimers.has(taskId)) {
      clearTimeout(this._activeTimers.get(taskId)!)
      this._activeTimers.delete(taskId)
    }

    // Node timer max is ~24.8 days (2^31-1 ms)
    const MAX_TIMER_DELAY = 2147483647
    const actualDelay = Math.min(delayMs, MAX_TIMER_DELAY)

    const timer = setTimeout(() => {
      this._activeTimers.delete(taskId)
      this.triggerTask(taskId).catch((err) => {
        console.error(`[SchedulerService] Error triggering task ${taskId}:`, err)
      })
    }, actualDelay)

    this._activeTimers.set(taskId, timer)
  }

  /**
   * Create a new scheduled task.
   */
  static createSchedule(options: CreateScheduleOptions): { success: boolean; item?: ScheduleItem; error?: string } {
    this.init()

    if (this._countActive() >= this.MAX_ACTIVE_SCHEDULES) {
      return {
        success: false,
        error: `Active schedules limit reached (max ${this.MAX_ACTIVE_SCHEDULES}). Cancel unused tasks first.`
      }
    }

    const prompt = (options.prompt || '').trim()
    if (!prompt) {
      return { success: false, error: 'Parameter "prompt" is required.' }
    }

    const type: ScheduleType = options.type || (options.cronExpression ? 'recurring' : 'once')
    const now = new Date()
    let nextRunAt: Date | null = null
    let normalizedCron: string | undefined = undefined
    let intervalSeconds = options.intervalSeconds

    if (type === 'once') {
      const delay = Math.max(Number(options.delaySeconds) || this.MIN_ONCE_DELAY_SECONDS, this.MIN_ONCE_DELAY_SECONDS)
      if (delay > 31536000) {
        return { success: false, error: 'Delay cannot exceed 1 year (31,536,000 seconds).' }
      }
      nextRunAt = new Date(now.getTime() + delay * 1000)
    } else {
      if (options.cronExpression) {
        const val = CronEvaluator.validateCron(options.cronExpression)
        if (!val.valid) {
          return { success: false, error: val.error || 'Invalid cron expression.' }
        }
        normalizedCron = val.normalized
        nextRunAt = CronEvaluator.getNextDate(normalizedCron!, now)
      } else if (intervalSeconds && intervalSeconds >= this.MIN_CRON_INTERVAL_SECONDS) {
        nextRunAt = new Date(now.getTime() + intervalSeconds * 1000)
      } else {
        return {
          success: false,
          error: 'Recurring schedule requires "cron_expression" (e.g. "*/15 * * * *") or "intervalSeconds" (min 60s).'
        }
      }
    }

    if (!nextRunAt) {
      return { success: false, error: 'Could not calculate next execution time.' }
    }

    const id = `sched_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`
    const title = (options.title || '').trim() || (prompt.length > 40 ? prompt.slice(0, 40) + '...' : prompt)

    const item: ScheduleItem = {
      id,
      title,
      type,
      status: 'active',
      prompt,
      chatId: options.chatId,
      workspacePath: options.workspacePath,
      delaySeconds: type === 'once' ? Math.round((nextRunAt.getTime() - now.getTime()) / 1000) : undefined,
      cronExpression: normalizedCron,
      intervalSeconds,
      createdAt: now.toISOString(),
      nextRunAt: nextRunAt.toISOString(),
      executionCount: 0,
      maxIterations: type === 'recurring' ? (options.maxIterations || this.DEFAULT_MAX_ITERATIONS) : 1,
      notifyOs: options.notifyOs !== false,
      catchUp: options.catchUp === true,
      consecutiveErrors: 0,
      logs: []
    }

    this._items.set(id, item)
    this._save()

    const delayMs = Math.max(1000, nextRunAt.getTime() - now.getTime())
    this._scheduleTimer(id, delayMs)

    this._emit('scheduler:taskCreated', item)
    return { success: true, item }
  }

  /**
   * Triggers execution of a scheduled task.
   */
  static async triggerTask(taskId: string): Promise<{ success: boolean; message: string }> {
    const item = this._items.get(taskId)
    if (!item || item.status !== 'active') {
      return { success: false, message: `Task ${taskId} not found or not active.` }
    }

    if (this._activeExecutions.has(taskId)) {
      return { success: false, message: `Task ${taskId} is already executing.` }
    }

    this._activeExecutions.add(taskId)
    const startTime = Date.now()
    const now = new Date()

    this._emit('scheduler:taskTriggered', { taskId, title: item.title, prompt: item.prompt })

    let isSuccess = false
    let resultMessage = ''

    try {
      const config = (LocalStorageService.getStore('config', {}) as ChatConfig) || {}
      const effectiveWorkspace = item.workspacePath || config.workspacePath || config.baseDir || process.cwd()

      const agent = agentRegistry.getAgent('zipply')
      const scheduledPrompt = `[ФОНОВАЯ ЗАДАЧА ПО РАСПИСАНИЮ / SCHEDULED TASK #${item.id}]:\n${item.prompt}\n\nВыполни задачу прямо сейчас, используя необходимые инструменты, и сформируй четкий отчет.`

      const history = [{ role: 'user' as const, content: scheduledPrompt }]
      let accumulatedOutput = ''

      const controller = new AbortController()
      const timeoutId = setTimeout(() => controller.abort(), this.TASK_TIMEOUT_MS)

      const onAgentEvent = (evt: any) => {
        if (evt.type === 'token') {
          accumulatedOutput += evt.content
        }
        // Relay event to renderer windows so user sees live output if open
        this._broadcast('agent:event', { ...evt, isScheduled: true, scheduleId: item.id })
      }

      await AgentRunner.run(
        agent,
        history,
        {
          ...config,
          workspacePath: effectiveWorkspace,
          baseDir: effectiveWorkspace
        },
        onAgentEvent,
        controller.signal
      )

      clearTimeout(timeoutId)
      isSuccess = true
      resultMessage = accumulatedOutput.trim() || 'Фоновая задача успешно выполнена.'
      item.consecutiveErrors = 0
      item.lastError = undefined
    } catch (err: unknown) {
      const error = err instanceof Error ? err : new Error(String(err))
      isSuccess = false
      resultMessage = `Ошибка выполнения: ${error.message}`
      item.consecutiveErrors = (item.consecutiveErrors || 0) + 1
      item.lastError = error.message

      if (item.consecutiveErrors >= this.CIRCUIT_BREAKER_ERRORS && item.type === 'recurring') {
        item.status = 'paused_error'
        resultMessage += ` (Задача автоматически приостановлена после ${this.CIRCUIT_BREAKER_ERRORS} ошибок подряд)`
      }
    } finally {
      this._activeExecutions.delete(taskId)
    }

    const durationMs = Date.now() - startTime
    item.executionCount++
    item.lastRunAt = now.toISOString()
    item.logs.unshift({
      timestamp: now.toISOString(),
      status: isSuccess ? 'success' : 'error',
      message: resultMessage.slice(0, 500),
      durationMs,
      resultSnippet: resultMessage.slice(0, 150)
    })

    // Keep log count bounded
    if (item.logs.length > 30) item.logs = item.logs.slice(0, 30)

    // OS Notification
    if (item.notifyOs) {
      this._sendOsNotification(
        `zipply: ${item.title}`,
        isSuccess ? resultMessage.slice(0, 150) : `Ошибка: ${item.lastError}`
      )
    }

    // Schedule next run or complete
    if (item.status === 'active') {
      if (item.type === 'once') {
        item.status = 'completed'
        item.nextRunAt = null
      } else if (item.type === 'recurring') {
        if (item.maxIterations && item.executionCount >= item.maxIterations) {
          item.status = 'completed'
          item.nextRunAt = null
        } else {
          const nextDate = this._calculateNextRecurringDate(item, new Date())
          if (nextDate) {
            item.nextRunAt = nextDate.toISOString()
            const diffMs = Math.max(1000, nextDate.getTime() - Date.now())
            this._scheduleTimer(item.id, diffMs)
          } else {
            item.status = 'completed'
            item.nextRunAt = null
          }
        }
      }
    }

    this._save()
    this._emit('scheduler:taskCompleted', { item, isSuccess, message: resultMessage })
    return { success: isSuccess, message: resultMessage }
  }

  /**
   * Cancel or delete a schedule by ID.
   */
  static cancelSchedule(taskId: string): boolean {
    this.init()
    const item = this._items.get(taskId)
    if (!item) return false

    item.status = 'cancelled'
    item.nextRunAt = null

    if (this._activeTimers.has(taskId)) {
      clearTimeout(this._activeTimers.get(taskId)!)
      this._activeTimers.delete(taskId)
    }

    this._save()
    this._emit('scheduler:taskUpdated', item)
    return true
  }

  /**
   * Pause a recurring task.
   */
  static pauseSchedule(taskId: string): boolean {
    this.init()
    const item = this._items.get(taskId)
    if (!item || item.status !== 'active') return false

    item.status = 'paused'
    if (this._activeTimers.has(taskId)) {
      clearTimeout(this._activeTimers.get(taskId)!)
      this._activeTimers.delete(taskId)
    }

    this._save()
    this._emit('scheduler:taskUpdated', item)
    return true
  }

  /**
   * Resume a paused task.
   */
  static resumeSchedule(taskId: string): boolean {
    this.init()
    const item = this._items.get(taskId)
    if (!item || (item.status !== 'paused' && item.status !== 'paused_error')) return false

    item.status = 'active'
    item.consecutiveErrors = 0
    item.lastError = undefined

    const nextDate = item.type === 'once'
      ? new Date(Date.now() + (item.delaySeconds || 10) * 1000)
      : this._calculateNextRecurringDate(item, new Date())

    if (nextDate) {
      item.nextRunAt = nextDate.toISOString()
      const diffMs = Math.max(1000, nextDate.getTime() - Date.now())
      this._scheduleTimer(item.id, diffMs)
    }

    this._save()
    this._emit('scheduler:taskUpdated', item)
    return true
  }

  /**
   * List all schedules.
   */
  static getAllSchedules(): ScheduleItem[] {
    this.init()
    return Array.from(this._items.values()).sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    )
  }

  /**
   * Get specific schedule.
   */
  static getSchedule(taskId: string): ScheduleItem | null {
    this.init()
    return this._items.get(taskId) || null
  }

  private static _sendOsNotification(title: string, body: string): void {
    try {
      if (Notification && Notification.isSupported()) {
        const notif = new Notification({
          title,
          body,
          silent: false
        })
        notif.on('click', () => {
          const wins = BrowserWindow.getAllWindows()
          if (wins.length > 0) {
            const win = wins[0]
            if (win.isMinimized()) win.restore()
            win.show()
            win.focus()
          }
        })
        notif.show()
      }
    } catch (e) {
      console.warn('[SchedulerService] Notification failed:', e)
    }
  }

  private static _broadcast(channel: string, data: any): void {
    try {
      const wins = BrowserWindow.getAllWindows()
      for (const win of wins) {
        if (!win.isDestroyed()) {
          win.webContents.send(channel, data)
        }
      }
    } catch {}
  }

  private static _emit(event: string, data: any): void {
    this._broadcast(event, data)
  }
}
