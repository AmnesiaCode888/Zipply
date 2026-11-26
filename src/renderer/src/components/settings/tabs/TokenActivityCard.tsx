import React, { useMemo, useState } from 'react'
import type { UsageHistory, UsageHistoryDay } from '../../../../../shared/auth'

type ActivityMode = 'daily' | 'weekly' | 'cumulative'

const LEVEL_STYLES = [
  'var(--bg-track, #242424)',
  'color-mix(in srgb, var(--accent, #0A84FF) 28%, var(--bg-track, #242424))',
  'color-mix(in srgb, var(--accent, #0A84FF) 52%, var(--bg-track, #242424))',
  'var(--accent, #0A84FF)',
  'color-mix(in srgb, var(--accent, #0A84FF) 68%, var(--text-strong, #FFFFFF))'
] as const

const MONTH_FORMATTER = new Intl.DateTimeFormat('ru-RU', { month: 'short' })
const DAY_FORMATTER = new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'short', year: 'numeric' })

function parseIsoDate(iso: string): Date {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(y, (m || 1) - 1, d || 1)
}

function getDayColor(day: UsageHistoryDay): string {
  const effectiveLevel = day.level > 0
    ? day.level
    : (day.requests > 0 || day.units > 0)
      ? 1
      : 0
  const idx = Math.max(0, Math.min(4, Math.round(effectiveLevel)))
  return LEVEL_STYLES[idx]
}

interface HoveredInfo {
  title: string
  meta: string
  xPct: number
}

export const TokenActivityCard: React.FC<{ history: UsageHistory | null }> = ({ history }) => {
  const [mode, setMode] = useState<ActivityMode>('daily')
  const [hovered, setHovered] = useState<HoveredInfo | null>(null)

  const { weeks, monthLabels, weeklyTotals, cumulativePoints, maxCumulative } = useMemo(() => {
    const days = history?.days ?? []
    if (days.length === 0) {
      return {
        weeks: [] as Array<Array<UsageHistoryDay | null>>,
        monthLabels: [] as Array<{ col: number; label: string }>,
        weeklyTotals: [] as Array<{ label: string; value: number; requests: number; units: number }>,
        cumulativePoints: [] as Array<{ date: string; value: number; requests: number }>,
        maxCumulative: 0
      }
    }

    const firstDate = parseIsoDate(days[0].date)
    const leadingEmpty = (firstDate.getDay() + 6) % 7
    const padded: Array<UsageHistoryDay | null> = [
      ...Array.from({ length: leadingEmpty }, () => null),
      ...days
    ]

    const cols: Array<Array<UsageHistoryDay | null>> = []
    for (let i = 0; i < padded.length; i += 7) {
      const slice = padded.slice(i, i + 7)
      while (slice.length < 7) slice.push(null)
      cols.push(slice)
    }

    const rawLabels: Array<{ col: number; label: string }> = []
    let lastMonth = -1
    cols.forEach((col, colIdx) => {
      const firstReal = col.find((d): d is UsageHistoryDay => d !== null)
      if (!firstReal) return
      const dt = parseIsoDate(firstReal.date)
      const month = dt.getMonth()
      if (month !== lastMonth) {
        const raw = MONTH_FORMATTER.format(dt)
        rawLabels.push({ col: colIdx, label: raw.endsWith('.') ? raw : `${raw}.` })
        lastMonth = month
      }
    })

    const labels: Array<{ col: number; label: string }> = []
    for (let i = 0; i < rawLabels.length; i++) {
      const curr = rawLabels[i]
      const next = rawLabels[i + 1]
      if (next && next.col - curr.col < 3) continue
      if (cols.length - curr.col < 2) continue
      labels.push(curr)
    }

    const weekSums = cols.map((col, idx) => {
      const real = col.filter((d): d is UsageHistoryDay => d !== null)
      const requests = real.reduce((sum, d) => sum + (d.requests || 0), 0)
      const units = real.reduce((sum, d) => sum + (d.units || 0), 0)
      const value = units > 0 ? units : requests
      const first = real[0]
      const last = real[real.length - 1]
      const label = first && last && first.date !== last.date
        ? `${DAY_FORMATTER.format(parseIsoDate(first.date))} – ${DAY_FORMATTER.format(parseIsoDate(last.date))}`
        : first
          ? DAY_FORMATTER.format(parseIsoDate(first.date))
          : `Неделя ${idx + 1}`
      return { label, value, requests, units }
    })

    let running = 0
    const cumPoints = days.map(d => {
      running += (d.units && d.units > 0 ? d.units : d.requests) || 0
      return { date: d.date, value: running, requests: d.requests || 0 }
    })

    return {
      weeks: cols,
      monthLabels: labels,
      weeklyTotals: weekSums,
      cumulativePoints: cumPoints,
      maxCumulative: running
    }
  }, [history])

  const maxWeekly = useMemo(
    () => Math.max(1, ...weeklyTotals.map(w => w.value)),
    [weeklyTotals]
  )

  const formatDayMeta = (requests: number, units: number) => {
    const parts = [`${requests} запр.`]
    if (units > 0) parts.push(`${units} ед.`)
    return parts.join(' · ')
  }

  const tooltipAlignClass = hovered
    ? hovered.xPct < 18
      ? 'translate-x-0'
      : hovered.xPct > 82
        ? '-translate-x-full'
        : '-translate-x-1/2'
    : '-translate-x-1/2'

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-[15px] font-semibold text-primary">Активность токенов</h2>
        <div role="tablist" aria-label="Режим отображения активности" className="flex items-center gap-4 text-[13.5px]">
          {([
            ['daily', 'По дням'],
            ['weekly', 'По неделям'],
            ['cumulative', 'Нарастающим итогом']
          ] as const).map(([id, label]) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={mode === id}
              onClick={() => { setHovered(null); setMode(id) }}
              className={`border-none bg-transparent p-0 transition-colors cursor-pointer ${
                mode === id ? 'font-medium text-primary' : 'text-secondary hover:text-primary'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {!history || history.days.length === 0 ? (
        <div className="rounded-[20px] bg-surface p-5">
          <p className="text-[14.5px] leading-[22px] text-secondary">
            История активности пока недоступна.
          </p>
        </div>
      ) : (
        <div className="relative w-full" onMouseLeave={() => setHovered(null)}>
          {hovered && (
            <div
              role="tooltip"
              className={`pointer-events-none absolute -top-11 z-20 rounded-[10px] bg-surface-elevated px-2.5 py-1.5 text-[12px] leading-[16px] border-[0.5px] border-subtle shadow-none whitespace-nowrap ${tooltipAlignClass}`}
              style={{ left: `${hovered.xPct}%` }}
            >
              <div className="font-medium text-primary">{hovered.title}</div>
              <div className="text-secondary">{hovered.meta}</div>
            </div>
          )}

          {mode === 'daily' ? (
            <div className="w-full space-y-2 pt-1">
              <div
                className="grid w-full gap-[3px]"
                style={{ gridTemplateColumns: `repeat(${weeks.length}, minmax(0, 1fr))` }}
              >
                {weeks.map((col, colIdx) => (
                  <div key={colIdx} className="flex flex-col gap-[3px]">
                    {col.map((day, rowIdx) => (
                      day ? (
                        <div
                          key={day.date}
                          aria-label={`${DAY_FORMATTER.format(parseIsoDate(day.date))}: ${formatDayMeta(day.requests || 0, day.units || 0)}`}
                          onMouseEnter={() => setHovered({
                            title: DAY_FORMATTER.format(parseIsoDate(day.date)),
                            meta: formatDayMeta(day.requests || 0, day.units || 0),
                            xPct: ((colIdx + 0.5) / Math.max(1, weeks.length)) * 100
                          })}
                          className="w-full aspect-square rounded-[3px] transition-transform duration-100 hover:scale-125"
                          style={{ backgroundColor: getDayColor(day) }}
                        />
                      ) : (
                        <div key={`empty-${colIdx}-${rowIdx}`} className="w-full aspect-square" />
                      )
                    ))}
                  </div>
                ))}
              </div>
              <div className="relative h-4 w-full text-[11.5px] text-secondary">
                {monthLabels.map((m, idx) => (
                  <span
                    key={`${m.label}-${idx}`}
                    className="absolute top-0 whitespace-nowrap"
                    style={{ left: `${(m.col / weeks.length) * 100}%` }}
                  >
                    {m.label}
                  </span>
                ))}
              </div>
            </div>
          ) : mode === 'weekly' ? (
            <div className="flex h-[116px] items-end gap-[3px] pt-2">
              {weeklyTotals.map((w, idx) => {
                const heightPct = w.value > 0 ? Math.max(8, Math.round((w.value / maxWeekly) * 100)) : 4
                return (
                  <div
                    key={`${w.label}-${idx}`}
                    onMouseEnter={() => setHovered({
                      title: w.label,
                      meta: formatDayMeta(w.requests, w.units),
                      xPct: ((idx + 0.5) / Math.max(1, weeklyTotals.length)) * 100
                    })}
                    className="flex-1 min-w-0 rounded-t-[3px] transition-opacity hover:opacity-80"
                    style={{
                      height: `${heightPct}%`,
                      backgroundColor: w.value > 0 ? 'var(--accent, #0A84FF)' : 'var(--bg-track, #242424)'
                    }}
                  />
                )
              })}
            </div>
          ) : (
            <div
              className="relative h-[116px] w-full pt-2"
              onMouseMove={(e) => {
                if (cumulativePoints.length === 0) return
                const rect = e.currentTarget.getBoundingClientRect()
                const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / Math.max(1, rect.width)))
                const idx = Math.min(cumulativePoints.length - 1, Math.round(ratio * (cumulativePoints.length - 1)))
                const pt = cumulativePoints[idx]
                setHovered({
                  title: DAY_FORMATTER.format(parseIsoDate(pt.date)),
                  meta: `Накоплено: ${pt.value} (${pt.requests} запр. за день)`,
                  xPct: ratio * 100
                })
              }}
            >
              <svg viewBox="0 0 600 100" preserveAspectRatio="none" className="h-full w-full overflow-visible">
                {(() => {
                  if (cumulativePoints.length === 0) return null
                  const maxVal = Math.max(1, maxCumulative)
                  const pts = cumulativePoints.length === 1
                    ? [cumulativePoints[0], cumulativePoints[0]]
                    : cumulativePoints
                  const coords = pts.map((pt, i) => {
                    const x = (i / (pts.length - 1)) * 600
                    const y = 96 - (pt.value / maxVal) * 88
                    return `${x.toFixed(1)},${y.toFixed(1)}`
                  })
                  const linePath = `M ${coords.join(' L ')}`
                  const areaPath = `${linePath} L 600,100 L 0,100 Z`
                  return (
                    <>
                      <path d={areaPath} fill="var(--accent-soft, rgba(10, 132, 255, 0.16))" />
                      <path d={linePath} fill="none" stroke="var(--accent, #0A84FF)" strokeWidth="2" strokeLinejoin="round" />
                    </>
                  )
                })()}
              </svg>
            </div>
          )}
        </div>
      )}
    </section>
  )
}
