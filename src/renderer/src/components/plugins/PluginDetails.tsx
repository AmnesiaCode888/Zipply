import type { Plugin } from './PluginLibrary'

export function PluginDetails({ plugin, onRemove, busy = false }: { plugin: Plugin; onRemove: () => void; busy?: boolean }) {
  const Artwork = plugin.icon

  return <main className="h-full w-full overflow-y-auto bg-canvas">
    <div className="mx-auto w-full max-w-[920px] px-5 pb-12 pt-8 sm:px-8">
      <header className="flex flex-wrap items-center gap-4">
        <Artwork size={64} className="shrink-0" />
        <div className="min-w-0 flex-1">
          <h1 className="text-[26px] font-bold tracking-tight text-primary">{plugin.name}</h1>
          <p className="mt-1 text-[14px] leading-[21px] text-secondary">{plugin.summary}</p>
        </div>
        <button type="button" disabled={busy} onClick={onRemove} aria-label="Удалить из моих плагинов" className="rounded-full border-none bg-surface px-4 py-2.5 text-[14px] font-medium text-secondary transition-colors hover:bg-surface-elevated hover:text-primary disabled:opacity-40">Удалить</button>
      </header>

      <section aria-label="Примеры запросов" className="mt-7 flex min-h-[200px] flex-col items-center justify-center gap-3 rounded-[22px] bg-[linear-gradient(120deg,#10213A_0%,#163B6B_100%)] px-5 py-7">
        {plugin.examples.slice(0, 2).map(example => <div key={example} className="flex w-full max-w-[570px] items-center gap-3 rounded-[18px] bg-surface px-4 py-3.5 text-[15px] leading-[22px] text-primary">
          <Artwork size={20} className="shrink-0" />
          <span><span className="font-medium text-accent">{plugin.name}</span> {example}</span>
        </div>)}
      </section>

      <p className="mt-7 text-[15px] leading-[24px] text-primary">{plugin.description}</p>

      <section className="mt-9">
        <div className="mb-4 flex items-center gap-2">
          <h2 className="text-[17px] font-semibold text-primary">Возможности</h2>
          <span className="text-[14px] text-secondary">{plugin.capabilities.length}</span>
        </div>
        <div className="space-y-1">
          {plugin.capabilities.map(({ title, description }) => (
            <article key={title} className="flex items-start gap-3 py-2.5">
              <Artwork size={24} className="mt-0.5 shrink-0" />
              <div>
                <h3 className="text-[15px] font-medium leading-[22px] text-primary">{title}</h3>
                <p className="mt-0.5 text-[14px] leading-[21px] text-secondary">{description}</p>
              </div>
            </article>
          ))}
        </div>
      </section>

      <section className="mt-9">
        <h2 className="text-[17px] font-semibold text-primary">Информация</h2>
        <dl className="mt-4 grid grid-cols-[130px_1fr] gap-y-2.5 text-[14px] leading-[21px]">
          <dt className="text-secondary">Категория</dt><dd className="text-primary">{plugin.category}</dd>
          <dt className="text-secondary">Статус</dt><dd className="text-primary">Установлен</dd>
        </dl>
        <p className="mt-4 text-[13px] leading-[20px] text-secondary">{plugin.safetyNotes}</p>
      </section>
    </div>
  </main>
}
