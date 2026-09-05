import { StepItem } from '../types/chat'

/**
 * Extracts clean basename / short representation of a path or command
 */
function cleanTarget(target?: string): string {
  if (!target) return ''
  const trimmed = target.trim()
  if (trimmed.includes('/') || trimmed.includes('\\')) {
    const parts = trimmed.split(/[/\\]/)
    return parts[parts.length - 1] || trimmed
  }
  return trimmed
}

/**
 * Generates an instant high-quality human-readable summary (2-5 words) from tool steps
 */
export function getHeuristicRoundSummary(steps: StepItem[]): string {
  if (!steps || steps.length === 0) return ''

  const meaningfulSteps = steps.filter((s) => s.type !== 'thought')

  if (meaningfulSteps.length === 0) {
    const thoughtStep = steps.find((s) => s.type === 'thought' && s.result && String(s.result).trim())
    if (thoughtStep?.result) {
      const firstLine = String(thoughtStep.result)
        .trim()
        .split('\n')[0]
        .replace(/^[#\-*>\s]+/, '')
        .trim()
      if (firstLine && firstLine.length <= 40) {
        return firstLine
      }
    }
    return 'Анализ задачи'
  }

  const creates = meaningfulSteps.filter((s) => s.type === 'create')
  const edits = meaningfulSteps.filter((s) => s.type === 'edit')
  const reads = meaningfulSteps.filter((s) => s.type === 'read')
  const runs = meaningfulSteps.filter((s) => s.type === 'run')
  const greps = meaningfulSteps.filter((s) => s.type === 'grep')
  const searches = meaningfulSteps.filter((s) => s.type === 'web_search')

  // 1. Files created + edited
  if (creates.length > 0 && edits.length > 0) {
    if (creates.length === 1 && edits.length === 1) {
      return `Создан ${cleanTarget(creates[0].target)} и правка ${cleanTarget(edits[0].target)}`
    }
    return `Создание и правка файлов (${creates.length + edits.length})`
  }

  // 2. Only creates
  if (creates.length === 1) {
    return `Создан ${cleanTarget(creates[0].target)}`
  }
  if (creates.length > 1) {
    return `Создано ${creates.length} файлов`
  }

  // 3. Only edits
  if (edits.length === 1) {
    const file = cleanTarget(edits[0].target)
    if (runs.length > 0) {
      return `Правка ${file} и запуск`
    }
    return `Правка ${file}`
  }
  if (edits.length > 1) {
    if (runs.length > 0) {
      return `Правка файлов (${edits.length}) и запуск`
    }
    return `Правка ${edits.length} файлов`
  }

  // 4. Terminal runs
  if (runs.length > 0 && reads.length === 0 && greps.length === 0) {
    const cmd = cleanTarget(runs[0].target) || 'команды'
    const shortCmd = cmd.length > 24 ? cmd.slice(0, 24) + '...' : cmd
    return `Запуск ${shortCmd}`
  }

  // 5. Grep + Reads
  if (greps.length > 0 && reads.length > 0) {
    return `Поиск и анализ файлов проекта`
  }
  if (greps.length > 0) {
    const q = greps[0].target ? ` "${greps[0].target}"` : ''
    return `Поиск${q.length > 20 ? q.slice(0, 20) + '..."' : q}`
  }

  // 6. Reads only
  if (reads.length === 1) {
    return `Чтение ${cleanTarget(reads[0].target)}`
  }
  if (reads.length > 1) {
    if (reads.length <= 2) {
      return `Чтение ${cleanTarget(reads[0].target)} и ${cleanTarget(reads[1].target)}`
    }
    return `Анализ файлов (${reads.length})`
  }

  // 7. Web search
  if (searches.length > 0) {
    return 'Поиск в интернете'
  }

  // Fallback
  const first = meaningfulSteps[0]
  const target = cleanTarget(first.target)
  return `${first.action || 'Выполнение'}${target ? ' ' + target : ''}`.trim()
}
