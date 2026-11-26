import { randomUUID } from 'node:crypto'
import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { Blackboard } from '../core/Blackboard'
import { ToolBase, type ToolDisplayInfo, type ToolParameterDef, type ToolResult } from '../tools/ToolBase'
import { SkillRepository, type SkillDescriptor } from './SkillRepository'

const MAX_SKILL_BYTES = 64 * 1024
const SKILL_NAME_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

function isWithin(boundary: string, target: string): boolean {
  const relative = path.relative(boundary, target)
  return relative === '' || (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative))
}

function invalid(message: string): Error {
  return Object.assign(new Error(message), { code: 'INVALID_SKILL' })
}

async function ensureDirectory(parent: string, name: string, boundary: string): Promise<string> {
  const target = path.join(parent, name)
  try {
    const current = await fs.lstat(target)
    if (!current.isDirectory() || current.isSymbolicLink()) {
      throw invalid(`Каталог ${name} должен быть обычной папкой.`)
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    await fs.mkdir(target)
  }
  const canonical = await fs.realpath(target)
  if (!isWithin(boundary, canonical)) throw invalid(`Каталог ${name} находится вне допустимой области.`)
  return canonical
}

async function validateSkillMarkdown(markdown: string, userSkillsRoot: string): Promise<SkillDescriptor> {
  if (typeof markdown !== 'string' || !markdown.trim() || Buffer.byteLength(markdown, 'utf8') > MAX_SKILL_BYTES) {
    throw invalid(`Текст навыка должен занимать от 1 байта до ${MAX_SKILL_BYTES} байт.`)
  }
  await fs.mkdir(userSkillsRoot, { recursive: true, mode: 0o700 })
  const canonicalRoot = await fs.realpath(userSkillsRoot)
  const stagingPath = await fs.mkdtemp(path.join(canonicalRoot, '.skill-validate-'))
  try {
    const candidatePath = path.join(stagingPath, 'candidate')
    await fs.mkdir(candidatePath)
    const skillFile = path.join(candidatePath, 'SKILL.md')
    await fs.writeFile(skillFile, markdown, { encoding: 'utf8', flag: 'wx', mode: 0o600 })
    const repo = new SkillRepository([{ path: stagingPath, scope: 'user', source: 'zipply' }])
    const candidates = await repo.discover()
    if (candidates.length !== 1) throw invalid('SKILL.md должен содержать корректные YAML-метаданные (name и description) и непустую инструкцию.')
    const candidate = candidates[0]
    const body = await repo.loadBody(candidate, candidate.revision)
    if (!body.trim()) throw invalid('После YAML frontmatter добавь инструкцию навыка.')
    if (!SKILL_NAME_PATTERN.test(candidate.name) || candidate.name.length > 64 || candidate.description.length > 1024) {
      throw invalid('Укажи name в kebab-case до 64 символов и description до 1024 символов.')
    }
    const declaredToolRefs = candidate.metadata.zipply_tools
    if (declaredToolRefs !== undefined && (typeof declaredToolRefs !== 'string' ||
      declaredToolRefs.split(/\s+/).filter(Boolean).length !== candidate.toolRefs.length)) {
      throw invalid('В metadata.zipply_tools есть нераспознанные ссылки на инструменты.')
    }
    return candidate
  } finally {
    await fs.rm(stagingPath, { recursive: true, force: true }).catch(() => {})
  }
}

export class SaveSkillTool extends ToolBase {
  private readonly userSkillsRoot: string

  constructor(
    private readonly workspacePath?: string,
    userSkillsRoot = path.join(os.homedir(), '.agents', 'skills')
  ) {
    super()
    this.userSkillsRoot = path.resolve(userSkillsRoot)
  }

  get name(): string { return 'save_skill' }
  get description(): string {
    return 'Создаёт или обновляет активный Agent Skill (SKILL.md) напрямую, без черновиков и подтверждений. Используй, когда пользователь просит создать, сохранить или обновить навык, либо для фиксации проверенной повторяемой процедуры. Навык сразу доступен через load_skill.'
  }
  get parameters(): Record<string, ToolParameterDef> {
    return {
      markdown: {
        type: 'string',
        description: 'Полный SKILL.md со стандартным YAML frontmatter (kebab-case name до 64 символов, description до 1024 символов) и чёткими шагами инструкции.',
        required: true,
        minLength: 1,
        maxLength: MAX_SKILL_BYTES
      },
      scope: {
        type: 'string',
        enum: ['project', 'user'],
        description: 'Где сохранить навык: project (.agents/skills проекта) или user (~/.agents/skills). По умолчанию project, если открыта папка проекта, иначе user.'
      },
      overwrite: {
        type: 'boolean',
        description: 'Перезаписать существующий SKILL.md с тем же именем (по умолчанию true).'
      }
    }
  }

  getExecutionPolicy() {
    return {
      mutates: true,
      parallelSafe: false,
      cacheable: false,
      modifiesFiles: false,
      skipApproval: true
    }
  }

  getDisplayInfo(args: Record<string, unknown> = {}): ToolDisplayInfo {
    const scope = args.scope === 'user' ? 'личные' : args.scope === 'project' ? 'проект' : ''
    return { label: 'Сохранение навыка', ...(scope ? { targetName: scope } : {}) }
  }

  async execute(argumentsJson: string, _board: Blackboard): Promise<ToolResult> {
    let args: { markdown?: unknown; scope?: unknown; overwrite?: unknown }
    try { args = JSON.parse(argumentsJson || '{}') }
    catch { return { error: true, formattedContent: 'Некорректные аргументы save_skill.' } }
    if (typeof args.markdown !== 'string' || !args.markdown.trim()) {
      return { error: true, formattedContent: 'Передай полный текст SKILL.md в параметре markdown.' }
    }
    if (args.scope !== undefined && args.scope !== 'project' && args.scope !== 'user') {
      return { error: true, formattedContent: 'Параметр scope должен быть "project" или "user".' }
    }
    const targetScope: 'project' | 'user' = args.scope === 'user'
      ? 'user'
      : args.scope === 'project'
        ? 'project'
        : this.workspacePath?.trim()
          ? 'project'
          : 'user'
    const overwrite = args.overwrite !== false

    try {
      const descriptor = await validateSkillMarkdown(args.markdown, this.userSkillsRoot)
      let skillsDir: string
      let boundary: string
      if (targetScope === 'project') {
        if (!this.workspacePath?.trim()) {
          return { error: true, formattedContent: 'Для сохранения проектного навыка (scope="project") не выбрана рабочая папка; укажи scope="user".' }
        }
        boundary = await fs.realpath(path.resolve(this.workspacePath))
        const agentsDir = await ensureDirectory(boundary, '.agents', boundary)
        skillsDir = await ensureDirectory(agentsDir, 'skills', boundary)
      } else {
        await fs.mkdir(this.userSkillsRoot, { recursive: true, mode: 0o700 })
        boundary = await fs.realpath(this.userSkillsRoot)
        skillsDir = boundary
      }

      const skillDir = await ensureDirectory(skillsDir, descriptor.name, boundary)
      const destinationFile = path.join(skillDir, 'SKILL.md')
      let existed = false
      try {
        const existing = await fs.lstat(destinationFile)
        if (!existing.isFile() || existing.isSymbolicLink()) {
          throw invalid('Целевой файл SKILL.md занят небезопасным объектом.')
        }
        existed = true
        if (!overwrite) {
          return { error: true, formattedContent: `Навык «${descriptor.name}» уже существует. Укажи overwrite=true, чтобы обновить его.` }
        }
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      }

      const tempPath = path.join(skillDir, `.SKILL.md.${randomUUID()}.tmp`)
      try {
        await fs.writeFile(tempPath, args.markdown, { encoding: 'utf8', flag: 'wx', mode: 0o600 })
        await fs.rename(tempPath, destinationFile)
      } finally {
        await fs.unlink(tempPath).catch(() => {})
      }

      return {
        success: true,
        data: { name: descriptor.name, description: descriptor.description, scope: targetScope, path: destinationFile, updated: existed },
        displayContent: `Навык «${descriptor.name}» ${existed ? 'обновлён' : 'сохранён'} (${targetScope === 'project' ? '.agents/skills' : '~/.agents/skills'}).`,
        formattedContent: `Навык «${descriptor.name}» ${existed ? 'обновлён' : 'сохранён'} и сразу активен: ${destinationFile}. Он доступен через load_skill(skillId=${JSON.stringify(descriptor.name)}).`
      }
    } catch (error) {
      return { error: true, formattedContent: error instanceof Error ? error.message : 'Не удалось сохранить навык.' }
    }
  }
}
