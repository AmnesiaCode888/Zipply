import { Blackboard } from '../core/Blackboard'
import { ToolBase, ToolExecutionPolicy, ToolParameterDef, ToolResult } from './ToolBase'
import type { QuestionAnswer, QuestionItem, QuestionRequest } from '../../../shared/agentEvents'

export class AskUserTool extends ToolBase {
  get name(): string { return 'ask_user' }
  get description(): string { return 'Спрашивает пользователя, только если недостающая информация влияет на решение; пропуск ответа не означает согласия.' }
  get parameters(): Record<string, ToolParameterDef> { return {
    question: { type: 'string', description: 'Один самостоятельный вопрос; не используй вместе с questions.', minLength: 1, maxLength: 1000 },
    options: { type: 'array', description: 'До восьми вариантов для одиночного вопроса.', maxItems: 8, items: { type: 'string', minLength: 1, maxLength: 120 } },
    questions: { type: 'array', description: 'От одного до четырёх связанных вопросов; используй вместо question и options.', minItems: 1, maxItems: 4, items: { type: 'object', properties: { question: { type: 'string', description: 'Самостоятельный вопрос.', minLength: 1, maxLength: 1000 }, options: { type: 'array', items: { type: 'string', minLength: 1, maxLength: 120 }, maxItems: 8, description: 'До восьми вариантов.' } }, required: ['question'] } }
  } }
  getExecutionPolicy(): ToolExecutionPolicy { return { mutates: false, parallelSafe: false, cacheable: false } }
  validate(raw: string): string | null {
    try {
      const args = JSON.parse(raw)
      if (!args || typeof args !== 'object' || Array.isArray(args)) return 'Некорректные аргументы вопроса.'
      const validItem = (item: any): boolean => item && typeof item === 'object' && !Array.isArray(item) && typeof item.question === 'string' && !!item.question.trim() && item.question.length <= 1000 && (item.options === undefined || (Array.isArray(item.options) && item.options.length <= 8 && item.options.every((option: unknown) => typeof option === 'string' && !!option.trim() && option.length <= 120)))
      if (args.questions !== undefined) {
        if (args.question !== undefined || args.options !== undefined || !Array.isArray(args.questions) || args.questions.length < 1 || args.questions.length > 4 || !args.questions.every(validItem)) return 'Укажите от одного до четырёх корректных вопросов без отдельных question и options; каждый вопрос — до 1000 символов, до восьми вариантов по 120 символов.'
      } else if (!validItem(args)) return 'Укажите вопрос длиной до 1000 символов и не более восьми непустых вариантов длиной до 120 символов.'
      return null
    } catch { return 'Некорректные аргументы вопроса.' }
  }
  async execute(raw: string, board: Blackboard, signal?: AbortSignal): Promise<ToolResult> {
    const error = this.validate(raw)
    if (error) return { error: true, formattedContent: error }
    const args = JSON.parse(raw) as { question?: string; options?: string[]; questions?: Array<{ question: string; options?: string[] }> }
    const normalize = (item: { question: string; options?: string[] }): QuestionItem => ({ question: item.question.trim(), options: (item.options || []).map(option => option.trim()) })
    const request: QuestionRequest = args.questions ? { questions: args.questions.map(normalize) } : normalize({ question: args.question!, options: args.options })
    const config = board.getArtifact('config') as { askUser?: (request: QuestionRequest) => Promise<QuestionAnswer> } | undefined
    if (!config?.askUser || signal?.aborted) return { error: true, formattedContent: 'Не удалось задать вопрос пользователю.' }
    const answer = await config.askUser(request)
    if (signal?.aborted) return { error: true, formattedContent: 'Запрос уточнения отменён.' }
    if (answer === null) return { success: true, formattedContent: 'Пользователь пропустил уточнение и не дал ответа. Не считай это согласием.' }
    if ('questions' in request) {
      if (!Array.isArray(answer) || answer.length !== request.questions.length || answer.some(value => typeof value !== 'string' || !value.trim())) return { error: true, formattedContent: 'Не удалось получить ответы на все вопросы.' }
      return { success: true, formattedContent: request.questions.map((item, index) => `Вопрос: ${JSON.stringify(item.question)}\nОтвет пользователя: ${JSON.stringify(answer[index].trim())}`).join('\n\n') }
    }
    if (typeof answer !== 'string' || !answer.trim()) return { error: true, formattedContent: 'Не удалось получить ответ на вопрос.' }
    return { success: true, formattedContent: `Ответ пользователя: ${answer.trim()}` }
  }
}
