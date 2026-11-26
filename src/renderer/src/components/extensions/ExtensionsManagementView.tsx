import { useEffect, useState } from 'react'
import {
  BookOpen, Check, ChevronDown, CircleAlert, CircleCheck, Database, LoaderCircle,
  Plus, Plug, RefreshCw, Search, Server, Trash2, Upload, Wrench
} from 'lucide-react'
import type { Plugin } from '../plugins/PluginLibrary'
import { plugins as pluginCatalog } from '../plugins/PluginLibrary'
import { PluginDetails } from '../plugins/PluginDetails'

export interface SkillManagementItem {
  id: string
  name: string
  description: string
  scope: 'user' | 'project' | 'package' | string
  source?: string
  revision: string
  userInvocable?: boolean
  disableModelInvocation?: boolean
  toolRefs?: string[]
}

export interface McpServerView {
  id: string
  transport: 'stdio' | 'http'
  state: 'disconnected' | 'connecting' | 'connected' | 'error' | string
  revision?: number
  authConfigured?: boolean
  protocolVersion?: string
  error?: string
}

export interface McpToolView {
  id: string
  serverId: string
  remoteName: string
  description?: string
  mutates?: boolean
}

export interface McpResourceView {
  serverId: string
  uri: string
  name?: string
  title?: string
  description?: string
  mimeType?: string
}

export interface McpPromptArgumentView {
  name: string
  description?: string
  required?: boolean
}

export interface McpPromptView {
  serverId: string
  name: string
  title?: string
  description?: string
  arguments?: McpPromptArgumentView[]
}

export interface TrustedMcpToolView {
  serverId: string
  toolId: string
  remoteName?: string
  toolName?: string
}

export type McpServerInput =
  | { id: string; transport: 'stdio'; command: string; args?: string[]; cwd?: string }
  | { id: string; transport: 'http'; url: string }

export interface ExtensionsManagementViewProps {
  page: 'all' | 'plugins' | 'skills' | 'mcp'
  onPageChange?: (page: ExtensionsManagementViewProps['page']) => void
  plugins?: readonly Plugin[]
  installedPluginIds?: readonly string[]
  selectedPluginId?: string | null
  pluginBusy?: boolean
  onInstallPlugin?: (id: string) => void | Promise<void>
  onRemovePlugin?: (id: string) => void | Promise<void>
  onSelectPlugin?: (id: string | null) => void
  onUsePlugin?: (plugin: Plugin) => void
  skills: readonly SkillManagementItem[]
  servers?: readonly McpServerView[]
  tools?: readonly McpToolView[]
  resources?: readonly McpResourceView[]
  prompts?: readonly McpPromptView[]
  trustedTools?: readonly TrustedMcpToolView[]
  busy?: boolean
  error?: string
  onRefresh?: () => void
  onImportSkill?: () => void | Promise<void>
  onSelectSkill?: (skill: SkillManagementItem) => void
  onAddServer?: (definition: McpServerInput, auth?: { headerName: string; headerValue: string }) => void | Promise<void>
  onSetServerAuth?: (serverId: string, headerName: string, headerValue: string) => void | Promise<void>
  onConnectServer?: (serverId: string) => void | Promise<void>
  onDisconnectServer?: (serverId: string) => void | Promise<void>
  onRemoveServer?: (serverId: string) => void | Promise<void>
  onSelectServer?: (server: McpServerView) => void | Promise<void>
  onRevokeToolTrust?: (serverId: string, toolId: string) => void | Promise<void>
  onSelectResource?: (resource: McpResourceView) => void
  onSelectPrompt?: (prompt: McpPromptView, args: Record<string, string>) => void
}

const fieldClass = 'min-w-0 rounded-[14px] bg-control px-3.5 py-3 text-[15px] leading-[22px] text-primary placeholder:text-muted outline-none border-none shadow-none'
const secondaryButtonClass = 'inline-flex min-h-9 items-center justify-center gap-2 rounded-full bg-control px-4 py-2 text-[14px] font-medium text-primary transition-colors hover:bg-control-hover active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-45 border-none shadow-none'
const quietButtonClass = 'inline-flex min-h-9 items-center justify-center gap-2 rounded-full px-3 py-2 text-[14px] font-medium text-secondary transition-colors hover:bg-hover hover:text-primary active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-45 border-none shadow-none'

function scopeLabel(scope: string): string {
  switch (scope) {
    case 'user': return 'Личные'
    case 'project': return 'Проект'
    case 'package': return 'Пакет'
    default: return scope || 'Личные'
  }
}

function stateLabel(state: string): string {
  switch (state) {
    case 'connected': return 'Подключён'
    case 'connecting': return 'Подключается'
    case 'error': return 'Ошибка'
    default: return 'Отключён'
  }
}

function splitLines(value: string): string[] {
  return value.split(/\r?\n/).map(line => line.trim()).filter(Boolean)
}

function SkillSection({
  skills, busy, searching, onImportSkill, onSelectSkill, heading = 'Навыки', compactWhenEmpty = false
}: Pick<ExtensionsManagementViewProps, 'skills' | 'busy' | 'onImportSkill' | 'onSelectSkill'> & { searching: boolean; heading?: string; compactWhenEmpty?: boolean }) {
  const [importError, setImportError] = useState('')
  const importSkill = async (): Promise<void> => {
    setImportError('')
    try { await onImportSkill?.() }
    catch (cause) { setImportError(cause instanceof Error ? cause.message : 'Не удалось импортировать навык.') }
  }
  return (
    <section aria-label="Навыки" className="space-y-5">
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-3"><h2 className="text-[16px] font-semibold text-primary">{heading}</h2><span className="text-[13px] text-muted">{skills.length}</span></div>
        {onImportSkill && <button type="button" onClick={() => void importSkill()} disabled={busy} className={quietButtonClass}><Upload size={16} aria-hidden="true" />Импортировать</button>}
      </div>
      {importError && <p role="alert" className="text-[14px] leading-[21px] text-secondary">{importError}</p>}
      {skills.length === 0 ? !compactWhenEmpty && <p className="py-2 text-[14px] leading-[21px] text-secondary">{searching ? 'Навыки не найдены.' : 'Навыки появятся здесь после добавления SKILL.md.'}</p> : <div className="grid grid-cols-1 gap-x-8 sm:grid-cols-2">
        {skills.map(skill => <article key={skill.id} className="flex min-h-[72px] min-w-0 items-center gap-3 py-3">
          <span className="flex h-11 w-11 shrink-0 items-center justify-center"><BookOpen size={24} strokeWidth={1.6} className="text-secondary" aria-hidden="true" /></span>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1"><h3 className="truncate text-[15px] font-medium leading-[22px] text-primary" title={skill.name}>{skill.name}</h3><span className="text-[12px] text-muted">{scopeLabel(skill.scope)}</span></div>
            <p className="mt-0.5 truncate text-[14px] leading-[21px] text-secondary" title={skill.description || undefined}>{skill.description || 'Инструкции для специальных задач.'}</p>
            <div className="mt-1 flex flex-wrap gap-x-2 text-[12px] leading-[18px] text-muted">
              <span>{skill.userInvocable === false ? 'Команда / недоступна' : 'Команда / доступна'}</span>
              {skill.disableModelInvocation && <span>Автовызов выключен</span>}
              {skill.source && <span className="truncate" title={skill.source}>{skill.source}</span>}
            </div>
            {(skill.toolRefs?.length ?? 0) > 0 && <p className="mt-1 truncate text-[12px] leading-[18px] text-muted" title={skill.toolRefs?.join(', ')}>
              Инструменты: {skill.toolRefs?.map(reference => reference.split('/').at(-1)?.replace(/^(?:core:|plugin:|mcp:)/, '')).join(', ')}
            </p>}
          </div>
          <button type="button" disabled={busy || !onSelectSkill || skill.userInvocable === false} onClick={() => onSelectSkill?.(skill)} className="inline-flex h-[34px] shrink-0 items-center justify-center gap-1.5 rounded-full border-none px-3 text-[14px] font-medium text-secondary transition-colors hover:bg-control hover:text-primary active:scale-95 disabled:opacity-40" title={skill.userInvocable === false ? 'Этот навык нельзя запускать вручную' : 'Добавить навык в черновик'}>
            <Plus size={16} aria-hidden="true" />Добавить
          </button>
        </article>)}
      </div>}
      {skills.length > 0 && <p className="text-[12px] leading-[18px] text-muted">Навыки подхватываются агентом автоматически по задаче или по команде / в чате.</p>}
    </section>
  )
}

function AddServerForm({
  busy, onAddServer
}: Pick<ExtensionsManagementViewProps, 'busy' | 'onAddServer'>) {
  const [open, setOpen] = useState(false)
  const [transport, setTransport] = useState<'stdio' | 'http'>('stdio')
  const [id, setId] = useState('')
  const [command, setCommand] = useState('')
  const [args, setArgs] = useState('')
  const [cwd, setCwd] = useState('')
  const [url, setUrl] = useState('')
  const [headerName, setHeaderName] = useState('Authorization')
  const [headerValue, setHeaderValue] = useState('')
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  const submit = async (event: React.FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault()
    if (!onAddServer) return
    setError('')
    const normalizedId = id.trim()
    const definition = transport === 'stdio'
      ? { id: normalizedId, transport, command: command.trim(), args: splitLines(args), ...(cwd.trim() ? { cwd: cwd.trim() } : {}) } as const
      : { id: normalizedId, transport, url: url.trim() } as const
    if (!/^[a-zA-Z0-9_-]{1,64}$/.test(normalizedId)) {
      setError('ID: от 1 до 64 латинских букв, цифр, дефисов или подчёркиваний.')
      return
    }
    if (transport === 'stdio' && !command.trim()) {
      setError('Укажите путь к исполняемой программе. Аргументы вводятся отдельно, по одному на строку.')
      return
    }
    if (transport === 'http') {
      try {
        const endpoint = new URL(url.trim())
        if (!['http:', 'https:'].includes(endpoint.protocol) || endpoint.username || endpoint.password) throw new Error('invalid')
      } catch {
        setError('Укажите корректный URL сервера без логина и пароля в адресе.')
        return
      }
    }
    setSaving(true)
    try {
      const auth = transport === 'http' && headerValue ? { headerName: headerName.trim() || 'Authorization', headerValue } : undefined
      await onAddServer(definition, auth)
      setId('')
      setCommand('')
      setArgs('')
      setCwd('')
      setUrl('')
      setHeaderValue('')
      setOpen(false)
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Не удалось сохранить сервер.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <section className={open ? 'w-full rounded-[20px] bg-surface px-5 py-5 sm:px-6' : 'flex justify-end'}>
      <div className="flex items-center justify-between gap-4">
        {open && <h3 className="text-[16px] font-semibold text-primary">Новый сервер</h3>}
        <button type="button" onClick={() => setOpen(value => !value)} aria-expanded={open} className={open ? quietButtonClass : secondaryButtonClass}>
          {open ? 'Закрыть' : <><Plus size={16} aria-hidden="true" />Добавить сервер</>}
        </button>
      </div>
      {open && <form onSubmit={event => void submit(event)} className="mt-4 space-y-4">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_180px]">
          <label className="flex min-w-0 flex-col gap-1.5 text-[13px] font-medium text-secondary">
            ID сервера
            <input required value={id} onChange={event => setId(event.target.value)} placeholder="например, filesystem" maxLength={64} className={fieldClass} />
          </label>
          <label className="flex flex-col gap-1.5 text-[13px] font-medium text-secondary">
            Подключение
            <select value={transport} onChange={event => setTransport(event.target.value as 'stdio' | 'http')} className={`${fieldClass} appearance-none`}>
              <option value="stdio">Локальный stdio</option>
              <option value="http">Streamable HTTP</option>
            </select>
          </label>
        </div>
        {transport === 'stdio' ? <>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <label className="flex min-w-0 flex-col gap-1.5 text-[13px] font-medium text-secondary">
              Исполняемая программа
              <input required value={command} onChange={event => setCommand(event.target.value)} placeholder="npx, uvx или полный путь" className={fieldClass} />
            </label>
            <label className="flex min-w-0 flex-col gap-1.5 text-[13px] font-medium text-secondary">
              Рабочая папка <span className="font-normal text-muted">необязательно</span>
              <input value={cwd} onChange={event => setCwd(event.target.value)} placeholder="Путь к папке" className={fieldClass} />
            </label>
          </div>
          <label className="flex min-w-0 flex-col gap-1.5 text-[13px] font-medium text-secondary">
            Аргументы <span className="font-normal text-muted">по одному на строку, без shell-обёртки</span>
            <textarea value={args} onChange={event => setArgs(event.target.value)} rows={3} placeholder={'-y\n@modelcontextprotocol/server-filesystem\nC:\\Projects'} className={`${fieldClass} resize-y font-mono text-[14px]`} />
          </label>
        </> : <label className="flex min-w-0 flex-col gap-1.5 text-[13px] font-medium text-secondary">
          URL сервера
          <input required type="url" value={url} onChange={event => setUrl(event.target.value)} placeholder="https://example.com/mcp" className={fieldClass} />
        </label>}
        {transport === 'http' && <div className="grid grid-cols-1 gap-3 sm:grid-cols-[190px_1fr]">
          <label className="flex min-w-0 flex-col gap-1.5 text-[13px] font-medium text-secondary">
            Заголовок авторизации
            <input value={headerName} onChange={event => setHeaderName(event.target.value)} placeholder="Authorization" className={fieldClass} />
          </label>
          <label className="flex min-w-0 flex-col gap-1.5 text-[13px] font-medium text-secondary">
            Значение <span className="font-normal text-muted">вводится только при сохранении</span>
            <input type="password" autoComplete="new-password" value={headerValue} onChange={event => setHeaderValue(event.target.value)} placeholder="Оставьте пустым, если авторизация не нужна" className={fieldClass} />
          </label>
        </div>}
        {error && <p role="alert" className="rounded-[14px] bg-surface-secondary px-3.5 py-3 text-[14px] leading-[21px] text-secondary">{error}</p>}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="max-w-[540px] text-[12px] leading-[18px] text-muted">Секрет авторизации не отображается после сохранения.</p>
          <button type="submit" disabled={saving || busy || !onAddServer} className={secondaryButtonClass}>{saving ? 'Сохраняю…' : 'Сохранить сервер'}</button>
        </div>
      </form>}
    </section>
  )
}

function McpServerCard({
  server, tools, resources, prompts, busy, onConnectServer, onDisconnectServer, onRemoveServer, onSelectServer, onSetServerAuth, onSelectResource, onSelectPrompt, runAction
}: {
  server: McpServerView
  tools: readonly McpToolView[]
  resources: readonly McpResourceView[]
  prompts: readonly McpPromptView[]
  busy?: boolean
  onConnectServer?: ExtensionsManagementViewProps['onConnectServer']
  onDisconnectServer?: ExtensionsManagementViewProps['onDisconnectServer']
  onRemoveServer?: ExtensionsManagementViewProps['onRemoveServer']
  onSelectServer?: ExtensionsManagementViewProps['onSelectServer']
  onSetServerAuth?: ExtensionsManagementViewProps['onSetServerAuth']
  onSelectResource?: ExtensionsManagementViewProps['onSelectResource']
  onSelectPrompt?: ExtensionsManagementViewProps['onSelectPrompt']
  runAction: (action: () => void | Promise<void>) => Promise<void>
}) {
  const [expanded, setExpanded] = useState(false)
  const [authOpen, setAuthOpen] = useState(false)
  const [authHeaderName, setAuthHeaderName] = useState('Authorization')
  const [authHeaderValue, setAuthHeaderValue] = useState('')
  const [promptArgs, setPromptArgs] = useState<Record<string, Record<string, string>>>({})
  const serverTools = tools.filter(tool => tool.serverId === server.id)
  const serverResources = resources.filter(resource => resource.serverId === server.id)
  const serverPrompts = prompts.filter(prompt => prompt.serverId === server.id)
  const connected = server.state === 'connected'
  const connecting = server.state === 'connecting'

  return (
    <article className="py-3">
      <div className="flex flex-wrap items-start gap-3 py-2 sm:items-center">
        <span className="flex h-11 w-11 shrink-0 items-center justify-center"><Server size={24} strokeWidth={1.6} className="text-secondary" aria-hidden="true" /></span>
        <div className="min-w-[160px] flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <h3 className="text-[15px] font-medium leading-[22px] text-primary">{server.id}</h3>
            <span className="text-[12px] text-muted">{server.transport === 'stdio' ? 'stdio' : 'HTTP'}</span>
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-[13px] text-secondary">
            {connected ? <CircleCheck size={14} aria-hidden="true" /> : connecting ? <LoaderCircle size={14} className="animate-spin" aria-hidden="true" /> : server.state === 'error' ? <CircleAlert size={14} aria-hidden="true" /> : <Plug size={14} aria-hidden="true" />}
            <span>{stateLabel(server.state)}</span>
            {server.protocolVersion && <span className="text-muted">MCP {server.protocolVersion}</span>}
            {connected && <span className="text-muted">{serverTools.length} инструментов · {serverResources.length} ресурсов · {serverPrompts.length} промптов</span>}
          </div>
          {server.error && <p className="mt-1 text-[13px] leading-[20px] text-secondary">{server.error}</p>}
        </div>
        <div className="ml-auto flex flex-wrap items-center justify-end gap-1">
          {connected && <button type="button" onClick={() => setExpanded(value => !value)} aria-expanded={expanded} className={quietButtonClass}>
            <span>{expanded ? 'Скрыть содержимое' : 'Показать содержимое'}</span><ChevronDown size={15} className={expanded ? 'rotate-180 transition-transform' : 'transition-transform'} aria-hidden="true" />
          </button>}
          {connected && <button type="button" disabled={busy || !onSelectServer} onClick={() => void runAction(() => onSelectServer?.(server))} className={secondaryButtonClass}>Использовать в чате</button>}
          {server.transport === 'http' && <button type="button" disabled={busy || !onSetServerAuth} onClick={() => setAuthOpen(value => !value)} aria-expanded={authOpen} className={quietButtonClass}>{server.authConfigured ? 'Изменить доступ' : 'Настроить доступ'}</button>}
          {connected ? <button type="button" disabled={busy} onClick={() => void runAction(() => onDisconnectServer?.(server.id))} className={quietButtonClass}>Отключить</button>
            : <button type="button" disabled={busy || connecting || !onConnectServer} onClick={() => void runAction(() => onConnectServer?.(server.id))} className={secondaryButtonClass}>{connecting ? 'Подключается…' : 'Подключить'}</button>}
          <button type="button" disabled={busy || connecting} onClick={() => void runAction(() => onRemoveServer?.(server.id))} aria-label={`Удалить сервер ${server.id}`} title="Удалить сервер" className={quietButtonClass}><Trash2 size={16} aria-hidden="true" /></button>
        </div>
      </div>

      {authOpen && <form onSubmit={event => {
        event.preventDefault()
        if (!authHeaderValue.trim() || !onSetServerAuth) return
        void runAction(async () => {
          await onSetServerAuth(server.id, authHeaderName.trim() || 'Authorization', authHeaderValue)
          setAuthHeaderValue('')
          setAuthOpen(false)
        })
      }} className="mt-3 grid grid-cols-1 gap-3 rounded-[18px] bg-surface-secondary p-4 sm:grid-cols-[190px_1fr_auto] sm:items-end">
        <label className="flex min-w-0 flex-col gap-1.5 text-[13px] font-medium text-secondary">Имя заголовка
          <input value={authHeaderName} onChange={event => setAuthHeaderName(event.target.value)} maxLength={128} className={`${fieldClass} py-2`} />
        </label>
        <label className="flex min-w-0 flex-col gap-1.5 text-[13px] font-medium text-secondary">Новое значение
          <input type="password" autoComplete="new-password" required value={authHeaderValue} onChange={event => setAuthHeaderValue(event.target.value)} maxLength={4096} placeholder="Текущее значение не показывается" className={`${fieldClass} py-2`} />
        </label>
        <button type="submit" disabled={busy || !authHeaderValue.trim()} className={secondaryButtonClass}>Сохранить</button>
        <div className="flex flex-wrap items-center gap-2 sm:col-span-3">
          {server.authConfigured && <button type="button" disabled={busy} onClick={() => void runAction(async () => {
            await onSetServerAuth?.(server.id, 'Authorization', '')
            setAuthOpen(false)
          })} className={quietButtonClass}>Удалить авторизацию</button>}
          <button type="button" disabled={busy} onClick={() => { setAuthHeaderValue(''); setAuthOpen(false) }} className={quietButtonClass}>Закрыть</button>
        </div>
      </form>}

      {expanded && connected && <div className="mt-3 space-y-6 rounded-[20px] bg-surface-secondary px-5 py-5 sm:px-6">
        <section>
          <h4 className="mb-2 flex items-center gap-2 text-[14px] font-semibold text-primary"><Wrench size={15} aria-hidden="true" /> Инструменты <span className="font-normal text-muted">{serverTools.length}</span></h4>
          {serverTools.length === 0 ? <p className="text-[14px] text-secondary">Нет инструментов.</p> : <div>
            {serverTools.map(tool => <div key={tool.id} className="flex flex-wrap items-start justify-between gap-2 py-2.5">
              <div className="min-w-0 flex-1"><p className="break-all text-[14px] font-medium text-primary">{tool.remoteName}</p>{tool.description && <p className="mt-1 text-[13px] leading-[19px] text-secondary">{tool.description}</p>}</div>
              <span className="shrink-0 rounded-full bg-control px-2.5 py-1 text-[11px] text-secondary">{tool.mutates === false ? 'чтение' : 'внешнее действие'}</span>
            </div>)}
          </div>}
        </section>
        <section>
          <h4 className="mb-2 flex items-center gap-2 text-[14px] font-semibold text-primary"><Database size={15} aria-hidden="true" /> Ресурсы <span className="font-normal text-muted">{serverResources.length}</span></h4>
          {serverResources.length === 0 ? <p className="text-[14px] text-secondary">Нет ресурсов.</p> : <div>
            {serverResources.map(resource => <div key={resource.uri} className="flex flex-wrap items-center gap-3 py-2.5">
              <div className="min-w-0 flex-1"><p className="text-[14px] font-medium text-primary">{resource.title || resource.name || resource.uri}</p><p className="mt-1 break-all font-mono text-[12px] leading-[18px] text-muted">{resource.uri}</p></div>
              <button type="button" disabled={!onSelectResource} onClick={() => onSelectResource?.(resource)} className={quietButtonClass}>Добавить в сообщение</button>
            </div>)}
          </div>}
        </section>
        <section>
          <h4 className="mb-2 flex items-center gap-2 text-[14px] font-semibold text-primary"><BookOpen size={15} aria-hidden="true" /> Промпты <span className="font-normal text-muted">{serverPrompts.length}</span></h4>
          {serverPrompts.length === 0 ? <p className="text-[14px] text-secondary">Нет промптов.</p> : <div className="space-y-3">
            {serverPrompts.map(prompt => {
              const key = `${prompt.serverId}:${prompt.name}`
              const values = promptArgs[key] ?? {}
              const ready = (prompt.arguments ?? []).filter(argument => argument.required).every(argument => values[argument.name]?.trim())
              return <div key={key} className="py-2">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div><p className="text-[14px] font-medium text-primary">{prompt.title || prompt.name}</p>{prompt.description && <p className="mt-1 text-[13px] leading-[19px] text-secondary">{prompt.description}</p>}</div>
                  <button type="button" disabled={!ready || !onSelectPrompt} onClick={() => onSelectPrompt?.(prompt, values)} className={quietButtonClass}>Добавить в сообщение</button>
                </div>
                {(prompt.arguments ?? []).length > 0 && <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
                  {(prompt.arguments ?? []).map(argument => <label key={argument.name} className="flex min-w-0 flex-col gap-1 text-[12px] text-secondary">
                    {argument.name}{argument.required ? ' · обязательно' : ' · можно пропустить'}
                    <input value={values[argument.name] ?? ''} onChange={event => setPromptArgs(previous => ({ ...previous, [key]: { ...(previous[key] ?? {}), [argument.name]: event.target.value } }))} placeholder={argument.description || 'Значение'} className={`${fieldClass} py-2 text-[13px]`} />
                  </label>)}
                </div>}
              </div>
            })}
          </div>}
        </section>
      </div>}
    </article>
  )
}

function McpSection({
  servers, tools, resources, prompts, trustedTools, busy,
  onAddServer, onConnectServer, onDisconnectServer, onRemoveServer, onSelectServer,
  onSetServerAuth, onRevokeToolTrust, onSelectResource, onSelectPrompt, searching, heading = 'MCP', compactWhenEmpty = false, configuredServerCount
}: ExtensionsManagementViewProps & { servers: readonly McpServerView[]; searching: boolean; heading?: string; compactWhenEmpty?: boolean; configuredServerCount?: number }) {
  const [actionError, setActionError] = useState('')
  const runAction = async (action: () => void | Promise<void>): Promise<void> => {
    setActionError('')
    try {
      await action()
    } catch (error) {
      setActionError(error instanceof Error ? error.message : 'Не удалось выполнить действие MCP.')
    }
  }
  return <section aria-label="MCP" className="space-y-5">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div className="flex items-center gap-3"><h2 className="text-[16px] font-semibold text-primary">{heading}</h2><span className="text-[13px] text-muted">{servers.length}</span></div>
      <AddServerForm busy={busy} onAddServer={onAddServer} />
    </div>
    {actionError && <p role="alert" className="text-[14px] leading-[21px] text-secondary">{actionError}</p>}
    {(servers.length > 0 || !compactWhenEmpty) && <div className="space-y-3">
      {servers.length === 0 ? !compactWhenEmpty && <p className="py-2 text-[14px] leading-[21px] text-secondary">{searching ? 'Серверы не найдены.' : 'Подключённых серверов пока нет.'}</p> : servers.map(server => <McpServerCard key={server.id} server={server} tools={tools ?? []} resources={resources ?? []} prompts={prompts ?? []} busy={busy} onConnectServer={onConnectServer} onDisconnectServer={onDisconnectServer} onRemoveServer={onRemoveServer} onSelectServer={onSelectServer} onSetServerAuth={onSetServerAuth} onSelectResource={onSelectResource} onSelectPrompt={onSelectPrompt} runAction={runAction} />)}
    </div>}
    {(trustedTools?.length ?? 0) > 0 && <section aria-label="Доверенные инструменты" className="pt-3">
      <div className="flex items-baseline justify-between gap-3"><h3 className="text-[16px] font-semibold text-primary">Доверенные инструменты</h3><span className="text-[13px] text-muted">{trustedTools?.length ?? 0}</span></div>
      <div className="mt-2 grid grid-cols-1 gap-x-8 sm:grid-cols-2">
        {trustedTools?.map(tool => <div key={`${tool.serverId}:${tool.toolId}`} className="flex min-w-0 items-center gap-3 rounded-[20px] px-2 py-3 transition-colors hover:bg-hover">
          <Wrench size={20} className="shrink-0 text-secondary" aria-hidden="true" />
          <div className="min-w-0 flex-1"><p className="truncate text-[14px] font-medium text-primary" title={tool.remoteName || tool.toolName || tool.toolId}>{tool.remoteName || tool.toolName || tool.toolId}</p><p className="mt-0.5 truncate text-[12px] leading-[18px] text-muted">{tool.serverId}</p></div>
          <button type="button" disabled={busy || !onRevokeToolTrust} onClick={() => void runAction(() => onRevokeToolTrust?.(tool.serverId, tool.toolId))} className={quietButtonClass}>Отозвать</button>
        </div>)}
      </div>
    </section>}
    {(configuredServerCount ?? servers.length) > 0 && <p className="flex items-start gap-2 text-[12px] leading-[18px] text-muted"><CircleAlert size={14} className="mt-0.5 shrink-0" aria-hidden="true" />Передавайте данные только доверенным серверам.</p>}
  </section>
}

function PluginSection({
  items, installedPluginIds = [], pluginBusy: busy, onInstallPlugin, onSelectPlugin, searching, heading = 'Плагины', showCount = true, singleColumn = false
}: Pick<ExtensionsManagementViewProps, 'installedPluginIds' | 'pluginBusy' | 'onInstallPlugin' | 'onSelectPlugin'> & { items: readonly Plugin[]; searching: boolean; heading?: string; showCount?: boolean; singleColumn?: boolean }) {
  const installed = new Set(installedPluginIds)
  const categories = [...new Set(items.map(plugin => plugin.category))]
  return <section aria-label="Плагины" className="space-y-8">
    <div className="flex items-center gap-3"><h2 className={heading === 'Библиотека' ? 'text-[15px] font-medium text-primary' : 'text-[16px] font-semibold text-primary'}>{heading}</h2>{showCount && <span className="text-[13px] text-muted">{items.length}</span>}</div>
    {items.length === 0 ? <p className="py-2 text-[14px] leading-[21px] text-secondary">{searching ? 'Плагины не найдены.' : 'Плагины недоступны.'}</p> : <div className="space-y-9">
      {categories.map(category => {
        const group = items.filter(plugin => plugin.category === category)
        return <div key={category}>
          <h3 className="mb-4 text-[16px] font-semibold text-primary">{category}</h3>
          <div className={`grid grid-cols-1 gap-x-8 ${singleColumn ? '' : 'sm:grid-cols-2'}`}>
            {group.map(plugin => {
              const Icon = plugin.icon
              const isInstalled = installed.has(plugin.id)
              return <article key={plugin.id} className="flex min-h-[72px] min-w-0 items-center gap-3 py-3">
                <Icon size={44} className="shrink-0" aria-hidden="true" />
                <div className="min-w-0 flex-1">
                  <h3 className="truncate text-[15px] font-medium leading-[22px] text-primary" title={plugin.name}>{plugin.name}</h3>
                  <p className="mt-0.5 text-[14px] leading-[21px] text-secondary">{plugin.summary}</p>
                </div>
                <button type="button" disabled={busy || (!isInstalled && !onInstallPlugin)} onClick={() => isInstalled ? onSelectPlugin?.(plugin.id) : void onInstallPlugin?.(plugin.id)} aria-label={isInstalled ? `Открыть ${plugin.name}` : `Установить ${plugin.name}`} title={isInstalled ? 'Открыть' : 'Установить'} className="flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded-full border-none bg-transparent text-secondary transition-colors hover:bg-hover hover:text-primary active:scale-95 disabled:opacity-40">
                  {isInstalled ? <Check size={17} aria-hidden="true" /> : <Plus size={17} aria-hidden="true" />}
                </button>
              </article>
            })}
          </div>
        </div>
      })}
    </div>}
  </section>
}

const categories = [
  { id: 'all', label: 'Все' },
  { id: 'plugins', label: 'Плагины' },
  { id: 'skills', label: 'Навыки' },
  { id: 'mcp', label: 'MCP' }
] as const

export function ExtensionsManagementView(props: ExtensionsManagementViewProps) {
  const [query, setQuery] = useState('')
  useEffect(() => {
    if (props.selectedPluginId) setQuery('')
  }, [props.selectedPluginId])
  const normalizedQuery = query.trim().toLocaleLowerCase('ru')
  const searching = normalizedQuery.length > 0
  const plugins = props.plugins ?? pluginCatalog
  const selectedPlugin = props.selectedPluginId ? plugins.find(plugin => plugin.id === props.selectedPluginId) : undefined
  if (selectedPlugin && (props.page === 'all' || props.page === 'plugins')) {
    return <PluginDetails plugin={selectedPlugin} busy={props.pluginBusy} onRemove={() => { void props.onRemovePlugin?.(selectedPlugin.id) }} />
  }
  const skills = props.skills.filter(skill => `${skill.name} ${skill.description} ${skill.scope} ${skill.source ?? ''} ${skill.toolRefs?.join(' ') ?? ''}`.toLocaleLowerCase('ru').includes(normalizedQuery))
  const visiblePlugins = plugins.filter(plugin => `${plugin.name} ${plugin.summary} ${plugin.description} ${plugin.category} ${plugin.capabilities.map(capability => capability.title).join(' ')}`.toLocaleLowerCase('ru').includes(normalizedQuery))
  const servers = (props.servers ?? []).filter(server => {
    const serverTools = (props.tools ?? []).filter(tool => tool.serverId === server.id).map(tool => `${tool.remoteName} ${tool.description ?? ''}`).join(' ')
    const serverResources = (props.resources ?? []).filter(resource => resource.serverId === server.id).map(resource => `${resource.name ?? ''} ${resource.title ?? ''} ${resource.uri} ${resource.description ?? ''}`).join(' ')
    const serverPrompts = (props.prompts ?? []).filter(prompt => prompt.serverId === server.id).map(prompt => `${prompt.name} ${prompt.title ?? ''} ${prompt.description ?? ''}`).join(' ')
    return `${server.id} ${server.transport} ${server.state} ${serverTools} ${serverResources} ${serverPrompts}`.toLocaleLowerCase('ru').includes(normalizedQuery)
  })
  const counts = { all: plugins.length + props.skills.length + (props.servers?.length ?? 0), plugins: plugins.length, skills: props.skills.length, mcp: props.servers?.length ?? 0 }
  const filteredExtensionCount = visiblePlugins.length + skills.length + servers.length
  const singlePluginInAll = props.page === 'all' && visiblePlugins.length === 1
  const showPluginSection = props.page === 'plugins' || (props.page === 'all' && visiblePlugins.length > 0)
  const showSkillSection = props.page === 'skills' || (props.page === 'all' && (!searching || skills.length > 0))
  const showMcpSection = props.page === 'mcp' || (props.page === 'all' && (!searching || servers.length > 0))
  const noAllSearchResults = props.page === 'all' && searching && filteredExtensionCount === 0
  const pageCopy = {
    all: { title: 'Расширения', subtitle: 'Плагины, навыки и MCP — в одном месте.', search: 'Найти расширение' },
    plugins: { title: 'Плагины', subtitle: 'Инструменты для проверки и защиты цифровых проектов.', search: 'Искать плагины' },
    skills: { title: 'Навыки', subtitle: 'Личные и проектные инструкции для агента.', search: 'Искать навыки' },
    mcp: { title: 'MCP', subtitle: 'Подключения к серверам, инструментам, ресурсам и промптам.', search: 'Искать серверы MCP' }
  }[props.page]
  return <main className="h-full w-full overflow-y-auto bg-canvas">
    <div className="mx-auto w-full max-w-[1040px] px-6 pb-12 pt-8 sm:px-10 lg:px-14">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="max-w-[640px]">
          <h1 className="text-[26px] font-bold tracking-tight text-primary">{pageCopy.title}</h1>
          <p className="mt-2 text-[15px] leading-[23px] text-secondary">{pageCopy.subtitle}</p>
        </div>
        <div className="flex w-full items-center gap-2 sm:w-auto sm:shrink-0">
          <label className="flex h-10 min-w-0 flex-1 items-center gap-2 rounded-full bg-surface px-3.5 sm:w-[260px] sm:flex-none">
            <Search size={17} strokeWidth={1.75} className="shrink-0 text-secondary" aria-hidden="true" />
            <input type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder={pageCopy.search} aria-label="Поиск расширений" className="min-w-0 flex-1 border-none bg-transparent text-[14px] text-primary placeholder:text-secondary outline-none shadow-none" />
          </label>
          {props.onRefresh && <button type="button" onClick={props.onRefresh} disabled={props.busy} className={quietButtonClass} aria-label="Обновить список расширений" title="Обновить список"><RefreshCw size={16} className={props.busy ? 'animate-spin' : undefined} aria-hidden="true" /><span className="hidden sm:inline">Обновить</span></button>}
        </div>
      </header>
      <nav aria-label="Категории расширений" className="mt-7 flex flex-wrap items-center gap-1">
        {categories.map(({ id, label }) => <button key={id} type="button" onClick={() => props.onPageChange?.(id)} aria-current={props.page === id ? 'page' : undefined} className={`inline-flex min-h-9 items-center gap-2 rounded-full border-none px-4 py-2 text-[14px] font-medium shadow-none transition-colors active:scale-95 ${props.page === id ? 'bg-control text-primary' : 'bg-transparent text-secondary hover:bg-hover hover:text-primary'}`}>{label}<span className="text-[12px] text-muted">{counts[id]}</span></button>)}
      </nav>
      {props.error && <p role="alert" className="mt-4 text-[14px] leading-[21px] text-secondary">{props.error}</p>}
      <div className="mt-9 space-y-9">
        {noAllSearchResults && <p role="status" className="text-[15px] leading-[22px] text-secondary">Ничего не найдено</p>}
        {showPluginSection && <PluginSection heading={props.page === 'plugins' ? 'Библиотека' : 'Плагины'} showCount={props.page !== 'plugins'} singleColumn={singlePluginInAll} items={visiblePlugins} installedPluginIds={props.installedPluginIds} pluginBusy={props.pluginBusy} onInstallPlugin={props.onInstallPlugin} onSelectPlugin={props.onSelectPlugin} searching={searching} />}
        {showSkillSection && <SkillSection heading={props.page === 'skills' ? 'Список навыков' : 'Навыки'} compactWhenEmpty={props.page === 'all'} skills={skills} busy={props.busy} searching={searching} onImportSkill={props.onImportSkill} onSelectSkill={props.onSelectSkill} />}
        {showMcpSection && <McpSection {...props} heading={props.page === 'mcp' ? 'Серверы' : 'MCP'} compactWhenEmpty={props.page === 'all'} servers={servers} configuredServerCount={props.servers?.length ?? 0} searching={searching} />}
      </div>
    </div>
  </main>
}
