import React from 'react'
import { Check, ChevronDown, ShieldCheck } from '../../icons'
import type { ToolCall } from '../../types/chat'
import { CYBERSEC_CARD_TITLES } from '../../../../shared/toolPresentation'

type Row = { label: string; value: string; tone?: 'good' | 'warn' | 'bad' | 'muted' }
type Summary = { target: string; facts: string[]; rows: Row[]; note?: string; emptyLabel?: string; hiddenCount?: number }
type Data = Record<string, any>

const list = (value: unknown): any[] => Array.isArray(value) ? value : []
const record = (value: unknown): Data => value && typeof value === 'object' && !Array.isArray(value) ? value as Data : {}
const text = (value: unknown, fallback = '—'): string => typeof value === 'string' || typeof value === 'number' ? String(value) : fallback

function summarize(name: string, data: Data): Summary {
  if (name === 'cybersec_check_ports') {
    const results = list(data.results)
    const open = results.filter(item => item?.status === 'open')
    const counts = record(data.counts)
    return { target: text(data.host), facts: [`Открыто: ${text(counts.open, '0')}`, `Проверено: ${results.length}`], rows: open.slice(0, 30).map(item => ({ label: `${text(item.port)}/tcp`, value: 'Открыт' })), emptyLabel: 'Открытых портов не найдено.', note: 'TCP-подключение показывает доступность порта, но не определяет сервис.' }
  }
  if (name === 'cybersec_dns_records') {
    const records = record(data.records)
    const rows = Object.entries(records).flatMap(([kind, values]) => list(values).slice(0, 10).map(item => {
      const entry = record(item)
      const value = kind === 'MX' ? `${text(entry.exchange)} · приоритет ${text(entry.priority)}`
        : kind === 'CAA' ? [
            entry.critical !== undefined ? `critical=${text(entry.critical)}` : '',
            entry.issue ? `issue=${text(entry.issue)}` : '',
            entry.issuewild ? `issuewild=${text(entry.issuewild)}` : '',
            entry.iodef ? `iodef=${text(entry.iodef)}` : ''
          ].filter(Boolean).join(' · ') || 'Пустая запись CAA'
          : text(entry.address || entry.value || entry.target || entry.cname || entry.exchange || item)
      return { label: kind, value: value.slice(0, 220) }
    }))
    return { target: text(data.host), facts: [`Записей: ${rows.length}`], rows, emptyLabel: 'Для выбранных типов записей ничего не найдено.' }
  }
  if (name === 'cybersec_check_tls') {
    const cert = record(data.certificate)
    return { target: `${text(data.host)}:${text(data.port, '443')}`, facts: [`Протокол: ${text(data.protocol)}`], rows: [
      { label: 'Сертификат', value: 'Доверие и имя проверены' }, { label: 'Субъект', value: text(cert.subject) },
      { label: 'Издатель', value: text(cert.issuer) }, { label: 'Срок', value: `${text(cert.validFrom)} — ${text(cert.validTo)}` },
      { label: 'SHA-256', value: text(cert.fingerprint256) }
    ] }
  }
  if (name === 'cybersec_check_headers' || name === 'cybersec_check_http_posture') {
    const checks = list(data.checks).map(item => ({ label: text(item.name), value: item.present ? 'Обнаружено' : 'Не обнаружено', tone: item.present ? 'good' as const : 'warn' as const }))
    const cookies = list(data.cookies).map(item => ({ label: text(item.name), value: [item.secure && 'Secure', item.httpOnly && 'HttpOnly', item.sameSite && `SameSite=${item.sameSite}`].filter(Boolean).join(' · ') || 'Флаги не заданы', tone: item.secure && item.httpOnly ? 'good' as const : 'warn' as const }))
    const redirects = list(data.redirects).map((item, index) => ({ label: `Перенаправление ${index + 1}`, value: `${text(item.status)} → ${text(item.destination)}` }))
    return { target: text(data.url), facts: [`HTTP ${text(data.status)}`], rows: [...checks, ...cookies, ...redirects], note: data.finalUrl && data.finalUrl !== data.url ? `Итоговый адрес: ${text(data.finalUrl)}` : undefined }
  }
  if (name === 'cybersec_scan_secrets' || name === 'cybersec_audit_server_config' || name === 'cybersec_audit_project') {
    const findings = list(data.findings)
    const rows = findings.slice(0, 40).map(item => ({ label: text(item.kind || item.title || item.rule), value: `${text(item.path)}:${text(item.line)}`, tone: name === 'cybersec_scan_secrets' ? 'bad' as const : 'warn' as const }))
    return { target: 'Файлы проекта', facts: [`Совпадений: ${findings.length}`, `Проверено файлов: ${text(data.scanned, '0')}`], rows, hiddenCount: Math.max(0, findings.length - rows.length), emptyLabel: 'Совпадений не найдено.', note: 'Совпадения — кандидаты для ручной проверки.' }
  }
  if (name === 'cybersec_check_ssh_host_key') {
    const keys = list(data.keys)
    return { target: `${text(data.host)}:${text(data.port, '22')}`, facts: [`Ключей: ${keys.length}`], rows: keys.slice(0, 16).map(item => ({ label: text(item.type), value: text(item.fingerprint) })), note: 'Отпечаток нужно сверить по доверенному каналу.' }
  }
  if (name === 'cybersec_npm_audit') {
    const audit = record(data.summary), advisories = list(data.advisories)
    return { target: 'npm registry', facts: [`Уязвимостей: ${text(audit.total, String(advisories.length))}`, `Критических: ${text(audit.critical, '0')}`, `Высоких: ${text(audit.high, '0')}`], rows: advisories.slice(0, 25).map(item => ({ label: `${text(item.name)} · ${text(item.severity)}`, value: text(item.title), tone: item.severity === 'critical' || item.severity === 'high' ? 'bad' as const : 'warn' as const })), emptyLabel: 'Известных уязвимостей не найдено.', note: 'Зависимости не изменялись.' }
  }
  if (name === 'cybersec_probe_services') {
    const results = list(data.results)
    return { target: text(data.host), facts: [`Проверено портов: ${results.length}`], rows: results.slice(0, 10).map(item => ({ label: `${text(item.port)}/tcp`, value: text(item.banner || item.note || (item.status === 'response' ? 'Ответ получен' : 'Ответа нет')) })), note: 'Баннер сообщает сам сервис и не подтверждает версию.' }
  }
  return { target: 'Результат проверки', facts: [], rows: [] }
}

function ResultRows({ rows }: { rows: Row[] }) {
  return <div className="space-y-1">{rows.map((row, index) => {
    const valueTone = row.tone === 'bad' ? 'text-diff-remove' : row.tone === 'good' ? 'text-primary' : 'text-secondary'
    return <div key={`${index}:${row.label}`} className="grid min-w-0 grid-cols-[minmax(100px,0.8fr)_minmax(0,1.5fr)] gap-3 text-[13px] leading-[20px]">
      <span className="text-secondary">{row.label}</span><span className={`min-w-0 break-words ${valueTone}`}>{row.value}</span>
    </div>
  })}</div>
}

export function CyberSecToolCard({ tool, isExpanded, onToggle, onCopy, copied }: { tool: ToolCall; isExpanded: boolean; onToggle: () => void; onCopy: (event: React.MouseEvent) => void; copied: boolean }) {
  const name = tool.toolName || ''
  const data = record(tool.toolData)
  const summary = Object.keys(data).length ? summarize(name, data) : undefined
  const title = CYBERSEC_CARD_TITLES[name] || tool.label
  const target = summary?.target || tool.targetName
  const displayLabel = target ? `${tool.label || `CyberSec · ${title}`} ${target}` : tool.label || `CyberSec · ${title}`
  const canExpand = Boolean(tool.content || summary)
  return <div className="w-full">
    <div className="w-full flex items-center justify-between">
      <button type="button" onClick={canExpand ? onToggle : undefined} aria-expanded={canExpand ? isExpanded : undefined}
        className={`group inline-flex max-w-full min-w-0 items-center gap-1.5 text-[15px] font-sans leading-[22px] text-secondary hover:text-primary transition-colors select-none focus:outline-none border-none shadow-none bg-transparent p-0 ${canExpand ? 'cursor-pointer' : 'cursor-default'}`}>
        <ShieldCheck size={15} className="cybersec-inline-plugin-icon shrink-0" aria-hidden="true" />
        {tool.status === 'running' && <span className="w-1.5 h-1.5 rounded-full bg-secondary shrink-0" aria-label="Выполняется" />}
        <span data-shining-text={tool.status === 'running' ? 'true' : undefined} className={`truncate min-w-0 max-w-[520px] ${tool.status === 'running' ? 'shining-text' : ''}`} title={displayLabel}>{displayLabel}</span>
        {tool.status === 'error' && <span className="shrink-0 text-diff-remove" role="status" aria-label="Не удалось выполнить" title="Не удалось выполнить">Ошибка</span>}
        {canExpand && <ChevronDown size={14} strokeWidth={1.8} className={`shrink-0 ml-0.5 transition-transform duration-200 ease-out ${isExpanded ? 'rotate-180' : ''}`} />}
      </button>
      {isExpanded && canExpand && <button type="button" onClick={onCopy} className="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[12px] font-sans text-secondary hover:text-primary hover:bg-hover-strong transition-colors focus:outline-none cursor-pointer border-none shadow-none bg-transparent" title="Скопировать вывод">
        {copied ? <><Check size={12} /><span>Скопировано</span></> : <span>Копировать</span>}
      </button>}
    </div>
    {canExpand && isExpanded && <div className="rounded-[14px] bg-surface-secondary overflow-hidden my-1 px-3.5 py-3 select-text">
      {summary ? <>
        {summary.facts.length > 0 && <div className="mb-2 text-[13px] font-medium leading-[20px] text-primary">{summary.facts.join(' · ')}</div>}
        {summary.rows.length > 0 ? <ResultRows rows={summary.rows} /> : <p className="m-0 text-[13px] leading-[20px] text-secondary">{summary.emptyLabel || 'Совпадений не найдено.'}</p>}
        {summary.hiddenCount ? <p className="m-0 mt-2 text-[13px] text-secondary">И ещё {summary.hiddenCount} совпадений.</p> : null}
        {summary.note && <p className="m-0 mt-2 text-[12px] leading-[18px] text-secondary">{summary.note}</p>}
      </> : <div className="text-[13px] leading-[20px] text-secondary whitespace-pre-wrap break-words">{tool.content || 'Ожидание результата…'}</div>}
    </div>}
  </div>
}
