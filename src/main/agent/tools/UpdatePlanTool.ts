import { Blackboard, normalizeAgentTaskState } from '../core/Blackboard'
import { ToolBase, ToolExecutionPolicy, ToolParameterDef, ToolResult } from './ToolBase'
import type { AgentEvent, PlanStep } from '../../../shared/agentEvents'

const VALID_STATUSES = new Set(['pending', 'in_progress', 'completed'])

export class UpdatePlanTool extends ToolBase {
  get name(): string {
    return 'update_plan'
  }

  get description(): string {
    return 'Обновляет структурированный план шагов, критерии приёмки и подтверждённые факты текущей задачи в памяти агента и интерфейсе.'
  }

  get parameters(): Record<string, ToolParameterDef> {
    return {
      plan: {
        type: 'array',
        description: 'От 1 до 12 последовательных шагов плана со статусами pending, in_progress или completed.',
        required: true,
        minItems: 1,
        maxItems: 12,
        items: {
          type: 'object',
          properties: {
            step: { type: 'string', description: 'Краткое описание шага.', minLength: 1 },
            status: { type: 'string', description: 'Текущий статус шага.', enum: ['pending', 'in_progress', 'completed'] }
          },
          required: ['step', 'status']
        }
      },
      explanation: {
        type: 'string',
        description: 'Краткое пояснение причины обновления плана.'
      },
      acceptance_criteria: {
        type: 'array',
        description: 'Явные критерии приёмки задачи (например: "tests pass").',
        items: { type: 'string', minLength: 1 }
      },
      confirmed_facts: {
        type: 'array',
        description: 'Ключевые факты, подтверждённые инструментами в проекте.',
        items: { type: 'string', minLength: 1 }
      }
    }
  }

  getExecutionPolicy(): ToolExecutionPolicy {
    return { mutates: false, parallelSafe: false, cacheable: false }
  }

  validate(raw: string): string | null {
    try {
      const args = JSON.parse(raw || '{}')
      if (!Array.isArray(args.plan) || args.plan.length < 1 || args.plan.length > 12) {
        return 'Ошибка: plan должен содержать от 1 до 12 шагов.'
      }
      let inProgressCount = 0
      for (const item of args.plan) {
        if (!item || typeof item !== 'object' || typeof item.step !== 'string' || !item.step.trim()) {
          return 'Ошибка: каждый шаг плана должен содержать непустую строку step.'
        }
        if (!VALID_STATUSES.has(item.status)) {
          return 'Ошибка: статус шага должен быть pending, in_progress или completed.'
        }
        if (item.status === 'in_progress') inProgressCount++
      }
      if (inProgressCount > 1) {
        return 'Ошибка: одновременно в статусе in_progress может находиться не более одного шага.'
      }
      return null
    } catch {
      return 'Ошибка: некорректный JSON аргументов update_plan.'
    }
  }

  async execute(raw: string, board: Blackboard): Promise<ToolResult> {
    const err = this.validate(raw)
    if (err) return { formattedContent: err, error: true }

    const args = JSON.parse(raw) as {
      plan: PlanStep[]
      explanation?: string
      acceptance_criteria?: string[]
      confirmed_facts?: string[]
    }

    const normalizedPlan: PlanStep[] = args.plan.map((item) => ({
      step: item.step.trim(),
      status: item.status
    }))
    const explanation = typeof args.explanation === 'string' && args.explanation.trim() ? args.explanation.trim() : undefined

    const prev = board.getTaskState()
    const currentStep = normalizedPlan.find((p) => p.status === 'in_progress') || normalizedPlan.find((p) => p.status === 'pending')
    const merged = normalizeAgentTaskState({
      goal: prev?.goal || '',
      constraints: prev?.constraints || [],
      acceptanceCriteria: Array.isArray(args.acceptance_criteria) ? args.acceptance_criteria : (prev?.acceptanceCriteria || []),
      confirmedFacts: Array.isArray(args.confirmed_facts) ? args.confirmed_facts : (prev?.confirmedFacts || []),
      userCorrections: prev?.userCorrections,
      nextStep: currentStep ? currentStep.step : (normalizedPlan.every((p) => p.status === 'completed') ? 'Все шаги завершены' : prev?.nextStep || '')
    })
    board.setTaskState(merged)
    if (Array.isArray(args.acceptance_criteria)) {
      board.setArtifact('planUpdatedCriteriaInRun', true, false)
    }
    const criteriaRecords = board.getCriterionRecords()
    board.setArtifact('plan', { explanation, plan: normalizedPlan, criteria: criteriaRecords })

    const emitEvent = board.getArtifact('emitEvent') as ((evt: AgentEvent) => void) | undefined
    emitEvent?.({ type: 'plan_update', plan: normalizedPlan, ...(explanation ? { explanation } : {}) })

    const summaryLines = normalizedPlan.map((p) => {
      const mark = p.status === 'completed' ? '[x]' : p.status === 'in_progress' ? '[>]' : '[ ]'
      return `${mark} ${p.step}`
    })
    const criteriaText = criteriaRecords.length > 0
      ? `\nКритерии приёмки:\n${criteriaRecords.map((c) => `- ${c.id} (r${c.revision}): ${c.text}`).join('\n')}`
      : ''

    return {
      success: true,
      formattedContent: `План обновлён (${normalizedPlan.filter((p) => p.status === 'completed').length}/${normalizedPlan.length} готово):\n${summaryLines.join('\n')}${criteriaText}`,
      data: { plan: normalizedPlan, explanation, criteria: criteriaRecords }
    }
  }
}
