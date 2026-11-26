import React, { useEffect, useRef } from 'react'
import { Blocks, FileText, Plug, Server, Settings, Sparkles } from 'lucide-react'
import { isExtensionRefs, type ExtensionRef } from '../../../../shared/extensions'

export interface ExtensionCommandOption {
  ref: ExtensionRef
  description?: string
  keywords?: readonly string[]
}

export type ExtensionManagementPage = 'all' | 'skills' | 'plugins' | 'mcp'

type ManagementChoice = { page: ExtensionManagementPage; label: string }
export type CommandChoice = ExtensionCommandOption | ManagementChoice

type CommandQuery = { mode: 'slash' | 'resource'; query: string }
type CommandToken = CommandQuery & { start: number; end: number }

const managementChoices: readonly ManagementChoice[] = [
  { page: 'all', label: 'Все расширения' },
  { page: 'skills', label: 'Навыки' },
  { page: 'plugins', label: 'Плагины' },
  { page: 'mcp', label: 'MCP' }
]

const extensionKinds = {
  skill: { icon: Sparkles, label: 'Навык' },
  plugin: { icon: Blocks, label: 'Плагин' },
  mcp_server: { icon: Server, label: 'Сервер MCP' },
  mcp_prompt: { icon: Plug, label: 'Промпт MCP' },
  mcp_resource: { icon: FileText, label: 'Ресурс MCP' }
} satisfies Record<ExtensionRef['kind'], { icon: typeof FileText; label: string }>

export function readCommandToken(value: string, caret: number): CommandToken | null {
  const before = value.slice(0, caret)
  const resourceAlias = before.match(/(?:^|\s)(\/resource(?:[ \t]+(\S*))?)$/i)
  const match = resourceAlias ?? before.match(/(?:^|\s)(([/@])(\S*))$/)
  if (!match) return null
  const query = resourceAlias ? match[2] ?? '' : match[3]
  const suffix = value.slice(caret).match(/^\S*/)?.[0] ?? ''
  if (resourceAlias && match[2] === undefined && suffix) return null
  return {
    mode: resourceAlias || match[2] === '@' ? 'resource' : 'slash',
    query: query.toLowerCase(),
    start: caret - match[1].length,
    end: caret + suffix.length
  }
}

export function getCommandChoices(
  token: CommandQuery | null,
  options: readonly ExtensionCommandOption[],
  includeManagement: boolean
): CommandChoice[] {
  if (!token) return []
  const resourceMode = token.mode === 'resource'
  const matches = options.filter(({ ref, keywords }) => {
    if ((ref.kind === 'mcp_resource') !== resourceMode) return false
    const terms = [ref.id, ref.label, ...keywords ?? []]
    if (ref.kind === 'mcp_prompt') terms.push(ref.promptName)
    if (ref.kind === 'mcp_resource') terms.push(ref.uri)
    return terms.some(term => term.toLowerCase().includes(token.query))
  })
  if (resourceMode || !includeManagement) return matches
  return [...managementChoices.filter(({ page, label }) => page.startsWith(token.query) || label.toLocaleLowerCase('ru').includes(token.query)), ...matches]
}

export function extensionRefKey(ref: ExtensionRef): string {
  return `${ref.kind}:${ref.id}`
}

export function applyCommandChoice(
  value: string,
  token: CommandToken | null,
  choice: CommandChoice,
  extensionRefs: ExtensionRef[]
): { value: string; caret: number | null; extensionRefs: ExtensionRef[] } {
  if ('ref' in choice && !extensionRefs.some(ref => extensionRefKey(ref) === extensionRefKey(choice.ref))) {
    const nextRefs = [...extensionRefs, choice.ref]
    if (!isExtensionRefs(nextRefs)) return { value, caret: null, extensionRefs }
    extensionRefs = nextRefs
  }
  return {
    value: token ? value.slice(0, token.start) + value.slice(token.end) : value,
    caret: token?.start ?? null,
    extensionRefs
  }
}

export function commandOptionId(id: string, index: number): string {
  return `${id}-${index}`
}

interface CommandPaletteProps {
  id: string
  choices: readonly CommandChoice[]
  activeIndex: number
  resourceMode: boolean
  onChoose: (choice: CommandChoice) => void
}

export function CommandPalette({ id, choices, activeIndex, resourceMode, onChoose }: CommandPaletteProps): React.JSX.Element {
  const activeOptionRef = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    activeOptionRef.current?.scrollIntoView({ block: 'nearest' })
  }, [activeIndex])

  return (
    <div className="absolute inset-x-0 bottom-[calc(100%+8px)] z-[15] max-h-[min(320px,40vh)] overflow-y-auto rounded-[22px] bg-surface-elevated p-1.5 border-none shadow-none">
      <div id={id} role="listbox" aria-label={resourceMode ? 'Ресурсы MCP' : 'Команды'}>
        {choices.map((choice, index) => {
          const kind = 'ref' in choice ? extensionKinds[choice.ref.kind] : null
          const Icon = kind?.icon ?? Settings
          const label = 'ref' in choice ? choice.ref.label : `/${choice.page}`
          const description = 'ref' in choice ? choice.description ?? kind?.label : choice.label
          const active = activeIndex === index
          return (
            <button
              key={'ref' in choice ? extensionRefKey(choice.ref) : choice.page}
              id={commandOptionId(id, index)}
              ref={active ? activeOptionRef : undefined}
              type="button"
              role="option"
              aria-selected={active}
              tabIndex={-1}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => onChoose(choice)}
              title={description}
              className={`flex min-h-10 w-full items-center gap-2.5 rounded-full px-3 py-1.5 text-left text-[15px] leading-[22px] text-primary border-none shadow-none focus:outline-none hover:bg-hover-strong ${active ? 'bg-control' : ''}`}
            >
              <Icon size={17} strokeWidth={1.8} className="shrink-0 text-secondary" aria-hidden="true" />
              <span className="shrink-0 max-w-[60%] truncate">{label}</span>
              <span className="min-w-0 truncate text-[13px] text-secondary">{description}</span>
            </button>
          )
        })}
      </div>
      {choices.length === 0 && <p role="status" className="px-3 py-2 text-[15px] text-secondary">Нет доступных ресурсов MCP</p>}
    </div>
  )
}
