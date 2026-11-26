import { useMemo, useState } from 'react'
import { Check, Plus, Puzzle, Search } from 'lucide-react'
import type { ComponentType } from 'react'
import { pluginCatalog, type PluginCatalogEntry } from '../../../../shared/plugins/catalog'
import { CyberSecArtwork } from './CyberSecArtwork'
import { PdfArtwork } from './PdfArtwork'
import { SqliteArtwork } from './SqliteArtwork'

export type Plugin = Omit<PluginCatalogEntry, 'icon'> & { icon: ComponentType<{ className?: string; size?: number }> }

const iconComponents: Record<string, Plugin['icon']> = { cybersec: CyberSecArtwork, sqlite: SqliteArtwork, pdf: PdfArtwork }
export const plugins: Plugin[] = pluginCatalog.map(plugin => ({ ...plugin, icon: iconComponents[plugin.icon] || Puzzle }))

const categories = [...new Set(plugins.map(plugin => plugin.category))]

export function PluginLibrary({ installedIds, onInstall, onSelect, busy = false }: { installedIds: string[]; onInstall: (id: string) => void; onSelect: (id: string) => void; busy?: boolean }) {
  const [query, setQuery] = useState('')
  const visiblePlugins = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase('ru')
    return plugins.filter(plugin => `${plugin.name} ${plugin.summary} ${plugin.description} ${plugin.category} ${plugin.capabilities.map(capability => capability.title).join(' ')}`.toLocaleLowerCase('ru').includes(normalized))
  }, [query])

  return (
    <main className="h-full w-full overflow-y-auto bg-canvas">
      <div className="mx-auto w-full max-w-[1040px] px-6 pb-12 pt-8 sm:px-10 lg:px-14">
        <header className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-[26px] font-bold tracking-tight text-primary">Плагины</h1>
            <p className="mt-2 text-[15px] leading-[23px] text-secondary">Инструменты для проверки и защиты цифровых проектов.</p>
          </div>
          <label className="flex h-10 w-full items-center gap-2 rounded-full bg-surface px-3.5 sm:w-[260px] sm:shrink-0">
            <Search size={17} strokeWidth={1.75} className="shrink-0 text-secondary" aria-hidden="true" />
            <input type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder="Искать плагины" aria-label="Поиск плагинов" className="min-w-0 flex-1 border-none bg-transparent text-[14px] text-primary placeholder:text-secondary outline-none shadow-none" />
          </label>
        </header>

        <div className="mt-8 flex items-center gap-3">
          <h2 className="text-[15px] font-medium text-primary">Библиотека</h2>
        </div>

        {visiblePlugins.length === 0 ? (
          <p role="status" className="mt-8 text-[14px] text-secondary">Плагины не найдены</p>
        ) : (
          <div className="mt-8 space-y-9">
            {categories.map(category => {
              const items = visiblePlugins.filter(plugin => plugin.category === category)
              if (!items.length) return null
              return (
                <section key={category}>
                  <h3 className="mb-4 text-[16px] font-semibold text-primary">{category}</h3>
                  <div className="grid grid-cols-1 gap-x-8 sm:grid-cols-2">
                    {items.map(({ id, name, summary, icon: Icon }) => (
                      <article key={id} className="flex min-h-[72px] min-w-0 items-center gap-3 py-3">
                        <Icon size={44} className="shrink-0" />
                        <div className="min-w-0 flex-1">
                          <h4 className="truncate text-[15px] font-medium leading-[22px] text-primary">{name}</h4>
                          <p className="mt-0.5 text-[14px] leading-[21px] text-secondary">{summary}</p>
                        </div>
                        <button type="button" disabled={busy} onClick={() => installedIds.includes(id) ? onSelect(id) : onInstall(id)} aria-label={installedIds.includes(id) ? `Открыть ${name}` : `Установить ${name}`} title={installedIds.includes(id) ? 'Открыть' : 'Установить'} className="flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded-full border-none bg-transparent text-secondary transition-colors hover:bg-hover hover:text-primary active:scale-95 disabled:opacity-40">
                          {installedIds.includes(id) ? <Check size={17} aria-hidden="true" /> : <Plus size={17} aria-hidden="true" />}
                        </button>
                      </article>
                    ))}
                  </div>
                </section>
              )
            })}
          </div>
        )}
      </div>
    </main>
  )
}
