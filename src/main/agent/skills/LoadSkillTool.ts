import * as path from 'node:path'
import { realpath } from 'node:fs/promises'
import { Blackboard } from '../core/Blackboard'
import { ToolBase, type ToolDisplayInfo, type ToolParameterDef, type ToolResult } from '../tools/ToolBase'
import { SkillRepository, type SkillDescriptor, type SkillScope } from './SkillRepository'
import type { SkillToolBindingStatus } from './SkillToolBindings'

type ActivateSkillTools = (references: readonly string[], signal?: AbortSignal) => Promise<SkillToolBindingStatus[]>

const SCOPE_PRIORITY: Record<SkillScope, number> = { project: 0, user: 1, package: 2 }

function resolveSkill(skills: readonly SkillDescriptor[], ref: string): SkillDescriptor | undefined {
  const trimmed = ref.trim()
  if (!trimmed) return undefined
  const byId = skills.find(item => item.id === trimmed && !item.disableModelInvocation)
  if (byId) return byId
  const lower = trimmed.toLocaleLowerCase()
  const byName = skills
    .filter(item => !item.disableModelInvocation && (item.name === trimmed || item.name.toLocaleLowerCase() === lower))
    .sort((left, right) => (SCOPE_PRIORITY[left.scope] ?? 9) - (SCOPE_PRIORITY[right.scope] ?? 9))
  return byName[0]
}

export class LoadSkillTool extends ToolBase {
  private readonly available: Map<string, SkillDescriptor>

  constructor(
    private readonly skills: readonly SkillDescriptor[] | (() => Promise<readonly SkillDescriptor[]>),
    private readonly repository: SkillRepository,
    private readonly activateTools: ActivateSkillTools
  ) {
    super()
    const initialSkills = typeof skills === 'function' ? [] : skills
    this.available = new Map(initialSkills.filter(skill => !skill.disableModelInvocation).map(skill => [skill.id, skill]))
  }

  get name(): string { return 'load_skill' }
  get description(): string {
    return 'Загружает инструкции выбранного навыка (SKILL.md), список его вспомогательных файлов и подключает связанные инструменты. Принимает имя навыка (name) или его ID. Чтобы прочитать конкретный файл внутри навыка, укажи resourcePath или используй read_file с путём внутри каталога навыка.'
  }
  get parameters(): Record<string, ToolParameterDef> {
    return {
      skillId: { type: 'string', description: 'Имя (name) или ID навыка из списка <available_skills> или результатов search_skills.', required: true },
      arguments: { type: 'string', description: 'Краткая задача или аргументы для этого навыка.', maxLength: 4096 },
      resourcePath: { type: 'string', description: 'Путь к одному UTF-8 текстовому файлу относительно корня навыка, например references/guide.md. Без этого параметра загружается SKILL.md и список файлов.', maxLength: 1024 }
    }
  }
  getExecutionPolicy() { return { mutates: false, parallelSafe: false, cacheable: false } }

  getDisplayInfo(args: Record<string, unknown> = {}): ToolDisplayInfo {
    const target = typeof args.skillId === 'string' ? args.skillId.trim() : ''
    const labelTarget = target.startsWith('skill:') ? '' : target
    return {
      label: 'Подключение навыка',
      ...(labelTarget ? { targetName: typeof args.resourcePath === 'string' && args.resourcePath.trim() ? `${labelTarget}/${args.resourcePath.trim()}` : labelTarget } : {})
    }
  }

  async execute(argumentsJson: string, board: Blackboard, signal?: AbortSignal): Promise<ToolResult> {
    let args: { skillId?: unknown; arguments?: unknown; resourcePath?: unknown }
    try { args = JSON.parse(argumentsJson || '{}') } catch { return { error: true, formattedContent: 'Некорректные аргументы load_skill.' } }
    if (typeof args.skillId !== 'string' || !args.skillId.trim()) return { error: true, formattedContent: 'Укажи имя или ID навыка из списка <available_skills>.' }
    if (args.arguments !== undefined && (typeof args.arguments !== 'string' || args.arguments.length > 4096)) {
      return { error: true, formattedContent: 'Аргументы навыка должны быть строкой до 4096 символов.' }
    }
    if (args.resourcePath !== undefined && (typeof args.resourcePath !== 'string' || !args.resourcePath.trim() || args.resourcePath.length > 1024)) {
      return { error: true, formattedContent: 'resourcePath должен быть непустым относительным путём длиной до 1024 символов.' }
    }
    try {
      const currentSkills = typeof this.skills === 'function' ? await this.skills() : [...this.available.values()]
      const skill = resolveSkill(currentSkills, args.skillId)
      if (!skill) return { error: true, formattedContent: `Навык «${args.skillId.trim()}» не найден или запрещён для автоматического вызова.` }

      const skillDirectory = await realpath(path.dirname(skill.bodyPath)).catch(() => path.dirname(skill.bodyPath))
      if (board && typeof board.getArtifact === 'function' && typeof board.setArtifact === 'function') {
        const allowedRoots = (board.getArtifact('allowedExternalReadRoots') as Set<string> | undefined) || new Set<string>()
        allowedRoots.add(skillDirectory)
        board.setArtifact('allowedExternalReadRoots', allowedRoots)
      }

      if (typeof args.resourcePath === 'string') {
        const bytes = await this.repository.loadSupportFile(skill, args.resourcePath, skill.revision)
        let resource: string
        try { resource = new TextDecoder('utf-8', { fatal: true }).decode(bytes) }
        catch { return { error: true, formattedContent: 'Файл навыка не является UTF-8 текстом. Для чтения поддерживаются текстовые инструкции и справочные файлы.' } }
        const boundedResource = resource.length > 80_000
          ? `${resource.slice(0, 80_000)}\n[файл навыка сокращён до 80 000 символов]`
          : resource
        return {
          success: true,
          formattedContent: `<skill_resource name=${JSON.stringify(skill.name)} path=${JSON.stringify(args.resourcePath)} directory=${JSON.stringify(skillDirectory)}>\n${boundedResource}\n</skill_resource>`,
          displayContent: `Файл ${args.resourcePath} навыка «${skill.name}» загружен.`
        }
      }

      const body = await this.repository.loadBody(skill, skill.revision)
      const supportFiles = await this.repository.listSupportFiles(skill)
      const toolBindings = await this.activateTools(skill.toolRefs, signal)
      const toolBindingSummary = toolBindings.length
        ? `\n\n<skill_tool_links>\n${JSON.stringify(toolBindings)}\n</skill_tool_links>`
        : ''
      const filesSummary = supportFiles.length
        ? `\n\n<skill_files>\n${supportFiles.map(file => `- ${file}`).join('\n')}\n</skill_files>`
        : ''
      return {
        success: true,
        formattedContent: `<activated_skill name=${JSON.stringify(skill.name)} scope=${JSON.stringify(skill.scope)} source=${JSON.stringify(skill.source)} directory=${JSON.stringify(skillDirectory)}>\n${body.trim()}\n</activated_skill>${filesSummary}${toolBindingSummary}${typeof args.arguments === 'string' && args.arguments.trim() ? `\n\n<skill_task>\n${args.arguments.trim()}\n</skill_task>` : ''}`,
        displayContent: `Навык «${skill.name}» загружен.`
      }
    } catch (error) {
      return { error: true, formattedContent: error instanceof Error ? `Не удалось загрузить навык: ${error.message}` : 'Не удалось загрузить навык.' }
    }
  }
}
