import { ToolBase, ToolParameterDef, ToolResult } from './ToolBase'
import { Blackboard } from '../core/Blackboard'
import { SkillService } from '../services/SkillService'

/**
 * ReadSkillTool — Allows the agent to lazily load detailed instructions for a skill from the catalog,
 * or inspect specific scripts / examples inside directory-based skills.
 */
export class ReadSkillTool extends ToolBase {
  get name(): string {
    return 'read_skill'
  }

  get description(): string {
    return 'Load complete step-by-step instructions, triggers, domain rules, or embedded script/example files for a specific skill from the available_skills catalog.'
  }

  get parameters(): Record<string, ToolParameterDef> {
    return {
      description: {
        type: 'string',
        description: 'Краткое действие (2-4 слова, напр. "Загрузка навыка")',
        required: false
      },
      skill_name: {
        type: 'string',
        description: 'Name of the skill from available_skills catalog (e.g. "code-standards", "git-workflows", "docker-management")',
        required: true
      },
      resource_path: {
        type: 'string',
        description: 'Optional relative path to a specific file/script inside the skill directory (e.g. "scripts/deploy.sh" or "examples/config.json")',
        required: false
      }
    }
  }

  async execute(argumentsJson: string, blackboard: Blackboard): Promise<ToolResult> {
    let args: any = {}
    try {
      args = JSON.parse(argumentsJson || '{}')
    } catch {
      return { formattedContent: 'Ошибка: некорректный JSON аргументов.' }
    }

    const skillName = args.skill_name || args.name
    if (!skillName || typeof skillName !== 'string') {
      return { formattedContent: 'Ошибка: параметр skill_name обязателен.' }
    }

    const resourcePath = typeof args.resource_path === 'string' ? args.resource_path.trim() : undefined
    const workspacePath = blackboard ? (blackboard.getArtifact('workspacePath') as string) : undefined

    const result = SkillService.readSkill(skillName.trim(), resourcePath, workspacePath)
    if (!result.success || (!result.content && !result.resourceContent)) {
      return { formattedContent: result.error || `Навык '${skillName}' не найден.` }
    }

    // Track loaded skill on blackboard so subagents can inherit it
    if (blackboard && result.content) {
      const loadedSkills = (blackboard.getArtifact('loaded_skills') as Array<{ name: string; content: string }>) || []
      if (!loadedSkills.some((s) => s.name.toLowerCase() === skillName.toLowerCase())) {
        loadedSkills.push({ name: skillName.trim(), content: result.content })
        blackboard.setArtifact('loaded_skills', loadedSkills)
      }
    }

    // If reading specific resource inside folder skill
    if (resourcePath && result.resourceContent) {
      return {
        formattedContent: `=== ФАЙЛ РЕСУРСА [${skillName}/${resourcePath}] ===\n\n${result.resourceContent}`,
        data: { skillName, resourcePath, loaded: true }
      }
    }

    const metaInfo: string[] = []
    if (result.metadata?.triggers && Array.isArray(result.metadata.triggers) && result.metadata.triggers.length > 0) {
      metaInfo.push(`Триггеры: ${result.metadata.triggers.join(', ')}`)
    }
    if (result.metadata?.globs && Array.isArray(result.metadata.globs) && result.metadata.globs.length > 0) {
      metaInfo.push(`Маски файлов: ${result.metadata.globs.join(', ')}`)
    }
    if (result.files && result.files.length > 0) {
      const filesPreview = result.files.slice(0, 8).join(', ')
      const moreCount = result.files.length > 8 ? ` (+ еще ${result.files.length - 8} файлов)` : ''
      metaInfo.push(`Вложенные файлы (${result.files.length}): ${filesPreview}${moreCount} (чтение: read_skill(skill_name="${skillName}", resource_path="..."))`)
    }

    const metaHeader = metaInfo.length > 0 ? `\n> [!NOTE]\n> ${metaInfo.join('\n> ')}\n` : ''

    return {
      formattedContent: `=== ИНСТРУКЦИЯ НАВЫКА [${skillName}] ===${metaHeader}\n\n${result.content}\n\nСоблюдай данные правила при дальнейшем выполнении задачи.`,
      data: { skillName, loaded: true, metadata: result.metadata, files: result.files }
    }
  }
}

/**
 * SaveSkillTool — Allows the agent to self-pack successful workflows into reusable skills.
 */
export class SaveSkillTool extends ToolBase {
  getExecutionPolicy(): { mutates: boolean; parallelSafe: boolean; cacheable: boolean } {
    return { mutates: true, parallelSafe: false, cacheable: false }
  }

  get name(): string {
    return 'save_skill'
  }

  get description(): string {
    return 'Save a reusable workflow, guide, or set of rules with triggers and file globs to the skills library for future sessions.'
  }

  get parameters(): Record<string, ToolParameterDef> {
    return {
      description: {
        type: 'string',
        description: 'Краткое действие (2-4 слова, напр. "Сохранение навыка")',
        required: false
      },
      skill_name: {
        type: 'string',
        description: 'Short unique skill name in kebab-case (e.g. "data-cleaning", "powershell-recipes", "prisma-setup")',
        required: true
      },
      skill_description: {
        type: 'string',
        description: 'One-sentence summary of the skill for the catalog (when to use it)',
        required: true
      },
      instructions: {
        type: 'string',
        description: 'Step-by-step markdown instructions, commands, and rules',
        required: true
      },
      globs: {
        type: 'array',
        description: 'Optional file glob patterns related to this skill (e.g. ["prisma/**", "*.prisma"])',
        required: false,
        items: { type: 'string' }
      },
      triggers: {
        type: 'array',
        description: 'Optional keyword triggers (e.g. ["migration", "prisma", "schema"])',
        required: false,
        items: { type: 'string' }
      },
      tags: {
        type: 'array',
        description: 'Optional categorization tags (e.g. ["database", "backend"])',
        required: false,
        items: { type: 'string' }
      },
      is_core: {
        type: 'boolean',
        description: 'If true, skill is always loaded in system prompt. If false, loaded on-demand via read_skill (default: false)',
        required: false
      }
    }
  }

  async execute(argumentsJson: string, _blackboard: Blackboard): Promise<ToolResult> {
    let args: any = {}
    try {
      args = JSON.parse(argumentsJson || '{}')
    } catch {
      return { formattedContent: 'Ошибка: некорректный JSON аргументов.' }
    }

    const name = args.skill_name || args.name
    const desc = args.skill_description || args.description
    const instructions = args.instructions || args.content
    const isCore = Boolean(args.is_core)
    const globs = Array.isArray(args.globs) ? args.globs.map(String) : undefined
    const triggers = Array.isArray(args.triggers) ? args.triggers.map(String) : undefined
    const tags = Array.isArray(args.tags) ? args.tags.map(String) : undefined

    if (!name || !desc || !instructions) {
      return { formattedContent: 'Ошибка: параметры skill_name, skill_description и instructions обязательны.' }
    }

    const result = SkillService.saveSkill(name, desc, instructions, isCore, { globs, triggers, tags })
    if (!result.success) {
      return { formattedContent: `Ошибка при сохранении навыка: ${result.error}` }
    }

    const typeStr = isCore ? 'постоянных (Core)' : 'каталоге по требованию (Extra)'
    return {
      formattedContent: `Успех: навык '${name}' успешно сохранен в ${typeStr}. Теперь он доступен для последующих задач.`,
      data: { skillName: name, isCore, saved: true }
    }
  }
}

/**
 * ListSkillsTool — Allows the agent to list all active, extra, workspace, and system skills.
 */
export class ListSkillsTool extends ToolBase {
  get name(): string {
    return 'list_skills'
  }

  get description(): string {
    return 'List all available skills across global library, project workspace, and system catalogs with their descriptions and file patterns.'
  }

  get parameters(): Record<string, ToolParameterDef> {
    return {
      description: {
        type: 'string',
        description: 'Краткое действие (2-4 слова, напр. "Список навыков")',
        required: false
      },
      filter: {
        type: 'string',
        description: 'Optional filter: "all", "core", "extra", "workspace"',
        required: false
      }
    }
  }

  async execute(argumentsJson: string, blackboard: Blackboard): Promise<ToolResult> {
    let args: any = {}
    try {
      args = JSON.parse(argumentsJson)
    } catch {}

    const workspacePath = blackboard ? (blackboard.getArtifact('workspacePath') as string) : undefined
    const skills = SkillService.getAllSkills(workspacePath)

    const filter = args.filter || 'all'
    const filtered = skills.filter((s) => {
      if (filter === 'core') return s.isCore
      if (filter === 'extra') return !s.isCore
      if (filter === 'workspace') return s.source === 'workspace' || s.source === 'cursor' || s.source === 'codex'
      return true
    })

    if (filtered.length === 0) {
      return { formattedContent: 'Навыки не найдены.' }
    }

    const list = filtered.map((s) => {
      const parts = [`- **${s.name}** [${s.isCore ? 'Core' : 'Extra'}] (${s.source}): ${s.description}`]
      if (s.triggers && s.triggers.length > 0) parts.push(`  • Триггеры: ${s.triggers.slice(0, 4).join(', ')}`)
      if (s.globs && s.globs.length > 0) parts.push(`  • Маски: \`${s.globs.slice(0, 3).join(', ')}\``)
      if (s.files && s.files.length > 0) parts.push(`  • Файлы: ${s.files.length} шт. (scripts/references)`)
      return parts.join('\n')
    })

    return {
      formattedContent: `=== ДОСТУПНЫЕ НАВЫКИ (${filtered.length}) ===\n\n${list.join('\n\n')}\n\nДля загрузки любого навыка используй: \`read_skill(skill_name="...")\`.`,
      data: { count: filtered.length, skills: filtered.map((s) => ({ name: s.name, description: s.description, source: s.source, isCore: s.isCore })) }
    }
  }
}

/**
 * SearchSkillTool — Allows the agent to find relevant skills using semantic vector and trigger search.
 */
export class SearchSkillTool extends ToolBase {
  get name(): string {
    return 'search_skills'
  }

  get description(): string {
    return 'Perform semantic vector and trigger-based search to find the most relevant skills, rules, or procedural workflows for a given task or topic.'
  }

  get parameters(): Record<string, ToolParameterDef> {
    return {
      description: {
        type: 'string',
        description: 'Краткое действие (2-4 слова, напр. "Поиск навыка")',
        required: false
      },
      query: {
        type: 'string',
        description: 'Search query or task description in natural language (e.g. "docker deployment", "git rebase merge conflicts", "mcp server")',
        required: true
      },
      limit: {
        type: 'number',
        description: 'Max number of results to return (default: 5)',
        required: false
      }
    }
  }

  async execute(argumentsJson: string, blackboard: Blackboard): Promise<ToolResult> {
    let args: any = {}
    try {
      args = JSON.parse(argumentsJson || '{}')
    } catch {
      return { formattedContent: 'Ошибка: некорректный JSON аргументов.' }
    }

    const query = args.query || args.search || ''
    if (!query || typeof query !== 'string') {
      return { formattedContent: 'Ошибка: параметр query обязателен.' }
    }

    const limit = typeof args.limit === 'number' ? Math.min(15, Math.max(1, args.limit)) : 5
    const workspacePath = blackboard ? (blackboard.getArtifact('workspacePath') as string) : undefined
    const baseConfig: any = blackboard ? blackboard.getArtifact('config') : {}
    const embeddingConfig = {
      baseUrl: baseConfig?.baseUrl,
      apiKey: baseConfig?.apiKey,
      embeddingModel: baseConfig?.embeddingModel,
      embeddingBaseUrl: baseConfig?.embeddingBaseUrl
    }

    const results = await SkillService.searchSkillsAsync(query, {
      workspacePath,
      embeddingConfig,
      limit
    })

    if (results.length === 0) {
      return { formattedContent: `По запросу "${query}" подходящих навыков не найдено.` }
    }

    const lines = results.map((s, idx) => {
      const matchScore = s.similarityScore ? ` [${s.similarityScore}% совпадение]` : ''
      const reason = s.matchReason ? ` (${s.matchReason})` : ''
      const parts = [`${idx + 1}. **${s.name}**${matchScore}${reason}: ${s.description}`]
      if (s.triggers && s.triggers.length > 0) parts.push(`   • Триггеры: ${s.triggers.slice(0, 4).join(', ')}`)
      if (s.globs && s.globs.length > 0) parts.push(`   • Маски файлов: \`${s.globs.slice(0, 3).join(', ')}\``)
      return parts.join('\n')
    })

    return {
      formattedContent: `=== НАЙДЕННЫЕ НАВЫКИ ПО ЗАПРОСУ "${query}" (${results.length}) ===\n\n${lines.join('\n\n')}\n\nЧтобы прочитать подробную инструкцию навыка, вызови: \`read_skill(skill_name="${results[0].name}")\`.`,
      data: {
        query,
        count: results.length,
        skills: results.map((s) => ({
          name: s.name,
          description: s.description,
          similarityScore: s.similarityScore,
          matchReason: s.matchReason
        }))
      }
    }
  }
}

/**
 * DeleteSkillTool — Allows the agent to delete custom or extra skills by name.
 */
export class DeleteSkillTool extends ToolBase {
  get name(): string {
    return 'delete_skill'
  }

  get description(): string {
    return 'Delete a skill from the skills library by name or file path.'
  }

  get parameters(): Record<string, ToolParameterDef> {
    return {
      description: {
        type: 'string',
        description: 'Краткое действие (2-4 слова, напр. "Удаление навыка")',
        required: false
      },
      skill_name: {
        type: 'string',
        description: 'Name of the skill to delete (e.g. "my-custom-skill")',
        required: true
      },
      source_path: {
        type: 'string',
        description: 'Optional direct path to skill file or folder to delete',
        required: false
      }
    }
  }

  async execute(argumentsJson: string): Promise<ToolResult> {
    let args: any = {}
    try {
      args = JSON.parse(argumentsJson || '{}')
    } catch {
      return { formattedContent: 'Ошибка: некорректный JSON аргументов.' }
    }

    const skillName = (args.skill_name || args.name || '').trim()
    if (!skillName) {
      return { formattedContent: 'Ошибка: параметр skill_name обязателен.' }
    }

    const sourcePath = typeof args.source_path === 'string' ? args.source_path.trim() : undefined
    const res = SkillService.deleteSkill(skillName, undefined, sourcePath)

    if (res.success) {
      return {
        formattedContent: `Успех: навык '${skillName}' успешно удален из библиотеки.`,
        data: { skillName, deleted: true }
      }
    }

    return {
      formattedContent: res.error || `Не удалось удалить навык '${skillName}'. Возможно, он не существует или доступ заблокирован.`,
      data: { skillName, deleted: false }
    }
  }
}


