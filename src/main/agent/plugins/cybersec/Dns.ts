import * as dns from 'node:dns/promises'
import { domainToASCII } from 'node:url'
import { Blackboard } from '../../core/Blackboard'
import { ToolBase, type ToolExecutionPolicy, type ToolResult } from '../../tools/ToolBase'

const RECORD_METHODS = {
  A: 'resolve4',
  AAAA: 'resolve6',
  CNAME: 'resolveCname',
  MX: 'resolveMx',
  NS: 'resolveNs',
  TXT: 'resolveTxt',
  CAA: 'resolveCaa'
} as const
type RecordType = keyof typeof RECORD_METHODS
const RECORD_TYPES = Object.keys(RECORD_METHODS) as RecordType[]
const MAX_HOST_LENGTH = 253
const MAX_RECORDS_PER_TYPE = 10
const MAX_TEXT_LENGTH = 256
const QUERY_TIMEOUT_MS = 8000

type DnsArgs = { host: string; types: RecordType[] }
type NetworkApproval = { confirmAction?: (action: { kind: 'network'; command: string; target: string; details: string }) => Promise<boolean> }

function normalizeHost(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > MAX_HOST_LENGTH + 1 || /[\s/:?#@%]/.test(value)) return null
  const withoutDot = value.endsWith('.') ? value.slice(0, -1) : value
  const ascii = domainToASCII(withoutDot).toLowerCase()
  if (!ascii || ascii.length > MAX_HOST_LENGTH) return null
  const labels = ascii.split('.')
  if (labels.some(label => !label || label.length > 63 || !/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(label))) return null
  if (labels.length < 2 || !/[a-z]/.test(labels.at(-1)!)) return null
  return ascii
}

function parseArgs(json: string): DnsArgs {
  const value: unknown = JSON.parse(json)
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Укажите домен и типы DNS-записей.')
  const args = value as Record<string, unknown>
  if (Object.keys(args).some(key => key !== 'host' && key !== 'types')) throw new Error('Допускаются только поля host и types.')
  const host = normalizeHost(args.host)
  if (!host) throw new Error('Укажите один корректный домен без URL, IP-адреса или маски.')
  if (!Array.isArray(args.types) || args.types.length < 1 || args.types.length > RECORD_TYPES.length || !args.types.every(type => typeof type === 'string' && RECORD_TYPES.includes(type as RecordType))) {
    throw new Error(`Выберите от 1 до ${RECORD_TYPES.length} типов: ${RECORD_TYPES.join(', ')}.`)
  }
  const types = args.types as RecordType[]
  if (new Set(types).size !== types.length) throw new Error('Типы DNS-записей не должны повторяться.')
  return { host, types }
}

function cleanText(value: unknown): string {
  return String(value ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').slice(0, MAX_TEXT_LENGTH)
}

function normalizeRecord(type: RecordType, record: unknown): unknown {
  if (type === 'TXT') return (record as string[]).map(cleanText).join('')
  if (type === 'A' || type === 'AAAA') {
    const value = record as { address: string; ttl?: number } | string
    return typeof value === 'string' ? value : { address: cleanText(value.address), ...(typeof value.ttl === 'number' ? { ttl: value.ttl } : {}) }
  }
  if (type === 'MX') {
    const value = record as { exchange: string; priority: number }
    return { exchange: cleanText(value.exchange), priority: value.priority }
  }
  if (type === 'CAA') {
    const value = record as { critical: number; issue?: string; issuewild?: string; iodef?: string }
    return { critical: value.critical, ...(value.issue ? { issue: cleanText(value.issue) } : {}), ...(value.issuewild ? { issuewild: cleanText(value.issuewild) } : {}), ...(value.iodef ? { iodef: cleanText(value.iodef) } : {}) }
  }
  return cleanText(record)
}

function isNoRecords(error: unknown): boolean {
  return Boolean(error && typeof error === 'object' && ['ENODATA', 'ENOTFOUND'].includes((error as NodeJS.ErrnoException).code || ''))
}

function safeError(error: unknown): string {
  const code = error && typeof error === 'object' ? (error as NodeJS.ErrnoException).code : undefined
  if (code === 'ENOTFOUND') return 'домен не найден'
  if (code === 'ESERVFAIL') return 'DNS-сервер вернул SERVFAIL'
  if (code === 'ETIMEOUT') return 'истекло время ожидания DNS-ответа'
  if (code === 'ECANCELLED') return 'запрос отменён'
  return 'DNS-запрос завершился ошибкой'
}

export class CyberSecDns extends ToolBase {
  get name(): string { return 'cybersec_dns_records' }
  get description(): string { return 'Запрашивает выбранные DNS-записи одного указанного домена (A, AAAA, CNAME, MX, NS, TXT, CAA). Перед запросами требуется подтверждение. Не перебирает поддомены и не сканирует сеть.' }
  get parameters() { return {
    host: { type: 'string', description: 'Один домен, например example.com; не URL и не IP-адрес.', required: true, maxLength: MAX_HOST_LENGTH },
    types: { type: 'array', description: 'Типы записей из A, AAAA, CNAME, MX, NS, TXT, CAA.', required: true, minItems: 1, maxItems: RECORD_TYPES.length, items: { type: 'string', enum: RECORD_TYPES } }
  } }
  getExecutionPolicy(): ToolExecutionPolicy { return { mutates: false, parallelSafe: false, cacheable: false } }

  validate(json: string): string | null {
    try { parseArgs(json); return null }
    catch (error) { return error instanceof Error ? error.message : 'Параметры DNS-запроса некорректны.' }
  }

  async execute(json: string, board: Blackboard, signal?: AbortSignal): Promise<ToolResult> {
    let args: DnsArgs
    try { args = parseArgs(json) }
    catch (error) { return { error: true, formattedContent: error instanceof Error ? error.message : 'Параметры DNS-запроса некорректны.' } }
    if (signal?.aborted) return { error: true, formattedContent: 'DNS-проверка отменена.' }

    const config = board.getArtifact('config') as NetworkApproval | undefined
    const approved = await config?.confirmAction?.({
      kind: 'network',
      command: `DNS ${args.host}: ${args.types.join(', ')}`,
      target: args.host,
      details: `Запрос выбранных DNS-записей (${args.types.join(', ')}) одного домена. Перебора имён и поддоменов нет.`
    })
    if (!approved || signal?.aborted) return { error: true, formattedContent: 'DNS-проверка не подтверждена или отменена.' }

    const resolver = new dns.Resolver()
    let timeout: NodeJS.Timeout | undefined
    let timedOut = false
    let cancelled = false
    const onAbort = () => { cancelled = true; resolver.cancel() }
    signal?.addEventListener('abort', onAbort, { once: true })
    if (signal?.aborted) onAbort()
    timeout = setTimeout(() => { timedOut = true; resolver.cancel() }, QUERY_TIMEOUT_MS)
    try {
      if (cancelled) return { error: true, formattedContent: 'DNS-проверка отменена.' }
      const records: Partial<Record<RecordType, unknown[]>> = {}
      const errors: Partial<Record<RecordType, string>> = {}
      const truncated: RecordType[] = []
      const results = await Promise.all(args.types.map(async type => {
        try {
          const method = RECORD_METHODS[type]
          const values = await resolver[method](args.host) as unknown[]
          return { type, values }
        } catch (error) {
          if (isNoRecords(error)) return { type, values: [] as unknown[] }
          return { type, error }
        }
      }))
      if (signal?.aborted || cancelled) return { error: true, formattedContent: 'DNS-проверка отменена.' }
      if (timedOut) return { error: true, formattedContent: 'DNS-проверка не завершилась за 8 секунд.' }
      for (const result of results) {
        if ('error' in result) errors[result.type] = safeError(result.error)
        else {
          if (result.values.length > MAX_RECORDS_PER_TYPE) truncated.push(result.type)
          records[result.type] = result.values.slice(0, MAX_RECORDS_PER_TYPE).map(value => normalizeRecord(result.type, value))
        }
      }
      if (Object.keys(records).length === 0) return { error: true, formattedContent: `Не удалось получить DNS-записи: ${Object.values(errors).join('; ') || 'попробуйте позже'}.` }

      const lines = args.types.flatMap(type => {
        if (errors[type]) return [`${type}: ${errors[type]}`]
        const values = records[type] || []
        return values.length ? [`${type}: ${JSON.stringify(values)}`] : [`${type}: записей нет`]
      })
      if (truncated.length) lines.push(`Для ${truncated.join(', ')} показаны первые ${MAX_RECORDS_PER_TYPE} записей (ответ ограничен).`)
      return {
        success: true,
        data: { host: args.host, records, errors, truncated },
        formattedContent: `DNS ${args.host}\n${lines.join('\n')}\nПроверены только выбранные типы; это снимок DNS-ответа, а не перебор поддоменов.`
      }
    } catch (error) {
      if (signal?.aborted || cancelled) return { error: true, formattedContent: 'DNS-проверка отменена.' }
      if (timedOut) return { error: true, formattedContent: 'DNS-проверка не завершилась за 8 секунд.' }
      return { error: true, formattedContent: `DNS-проверка завершилась ошибкой: ${safeError(error)}.` }
    } finally {
      if (timeout) clearTimeout(timeout)
      signal?.removeEventListener('abort', onAbort)
      resolver.cancel()
    }
  }
}
