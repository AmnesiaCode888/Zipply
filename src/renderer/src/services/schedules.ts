import { appStorage } from './appStorage'
export type Frequency = 'once' | 'daily' | 'weekly'
export interface Schedule { id: string; prompt: string; folderPath: string; frequency: Frequency; nextRun: number; enabled: boolean }
const KEY = 'zipply_schedules_v1'

export function nextOccurrence(time: number, frequency: Frequency): number {
  if (frequency === 'once') return time
  const date = new Date(time)
  date.setDate(date.getDate() + (frequency === 'daily' ? 1 : 7))
  return date.getTime()
}

export function claimDueSchedules(tasks: Schedule[], now: number, runningSince: number): { tasks: Schedule[]; due: Schedule[] } {
  const due: Schedule[] = []
  const updated = tasks.map(task => {
    if (!task.enabled || task.nextRun > now) return task
    if (task.nextRun >= runningSince) due.push(task)
    if (task.frequency === 'once') return { ...task, enabled: false }
    let nextRun = task.nextRun
    while (nextRun <= now) nextRun = nextOccurrence(nextRun, task.frequency)
    return { ...task, nextRun }
  })
  return { tasks: updated, due }
}

export function loadSchedules(): Schedule[] {
  try {
    const value = JSON.parse(appStorage.getItem(KEY) || '[]')
    if (!Array.isArray(value)) return []
    return value.filter((item): item is Schedule => item && typeof item.id === 'string' && typeof item.prompt === 'string' && typeof item.folderPath === 'string' && ['once', 'daily', 'weekly'].includes(item.frequency) && Number.isFinite(item.nextRun) && typeof item.enabled === 'boolean')
  } catch { return [] }
}
export function saveSchedules(tasks: Schedule[]): boolean {
  try { appStorage.setItem(KEY, JSON.stringify(tasks)); return true } catch { return false }
}
