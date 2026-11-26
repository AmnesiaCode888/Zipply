import { Blackboard } from '../../core/Blackboard'
import { ToolBase, type ToolResult, type ToolExecutionPolicy, type ProgressCallback } from '../../tools/ToolBase'
import { isSingleHost, MAX_PORTS, parsePorts, resolveHost, scanTcp } from './TcpScanner'

const serviceHints: Record<number, string> = { 21: 'FTP', 22: 'SSH', 25: 'SMTP', 53: 'DNS', 80: 'HTTP', 110: 'POP3', 143: 'IMAP', 443: 'HTTPS', 445: 'SMB', 3306: 'MySQL', 3389: 'RDP', 5432: 'PostgreSQL', 6379: 'Redis', 8080: 'HTTP-alt' }

type ScanArgs = { host?: unknown; ports?: unknown; port_range?: unknown }

export class CyberSecPorts extends ToolBase {
  get name(): string { return 'cybersec_check_ports' }
  get description(): string { return 'Сканирует TCP-порты одного разрешённого хоста обычными подключениями: список ports либо диапазон port_range, максимум 1024 порта. Перед сетевыми действиями требуется подтверждение. UDP, SYN-сканирование и определение версий сервисов не поддерживаются.' }
  get parameters() { return {
    host: { type: 'string', description: 'Один домен или IP-адрес разрешённой цели.', required: true },
    ports: { type: 'array', description: 'Список TCP-портов. Укажите либо ports, либо port_range.', minItems: 1, maxItems: MAX_PORTS, items: { type: 'integer', minimum: 1, maximum: 65535 } },
    port_range: { type: 'string', description: 'Диапазон TCP-портов, например 1-1024. Не более 1024 портов; использовать вместо ports.' }
  } }
  getExecutionPolicy(): ToolExecutionPolicy { return { mutates: false, parallelSafe: false, cacheable: false } }
  validate(json: string): string | null {
    try {
      const args: ScanArgs = JSON.parse(json)
      if (!args || typeof args !== 'object' || !isSingleHost(args.host)) return 'Укажите один домен или IP-адрес без схемы, маски и диапазона.'
      parsePorts(args)
      return null
    } catch (error) { return error instanceof Error ? error.message : 'Аргументы проверки портов некорректны.' }
  }
  async execute(json: string, board: Blackboard, signal?: AbortSignal, onProgress?: ProgressCallback): Promise<ToolResult> {
    const validation = this.validate(json)
    if (validation) return { error: true, formattedContent: validation }
    const args = JSON.parse(json) as { host: string; ports?: number[]; port_range?: string }
    const { ports, description } = parsePorts(args)
    const config = board.getArtifact('config') as { confirmAction?: (action: { kind: 'network'; command: string; target: string; details: string }) => Promise<boolean> } | undefined
    if (signal?.aborted) return { error: true, formattedContent: 'Проверка отменена.' }
    const approved = await config?.confirmAction?.({ kind: 'network', command: `TCP ${args.host}: ${description}`, target: args.host, details: `Проверка ${ports.length} TCP-портов одного хоста: обычные подключения, до 32 одновременно. Для домена будет выбран один IP-адрес.` })
    if (!approved || signal?.aborted) return { error: true, formattedContent: 'Проверка портов не подтверждена или отменена.' }
    try {
      const started = Date.now()
      const address = await resolveHost(args.host, signal)
      const results = await scanTcp(address, ports, signal, onProgress)
      if (signal?.aborted) return { error: true, formattedContent: 'Проверка портов отменена.' }
      const counts = { open: 0, closed: 0, timeout: 0, error: 0 }
      for (const result of results) counts[result.status]++
      const open = results.filter(result => result.status === 'open')
      const lines = open.slice(0, 100).map(result => `${result.port}/tcp: подключение установлено${serviceHints[result.port] ? ` (обычно ${serviceHints[result.port]}; сервис не определён)` : ''}`)
      if (open.length > 100) lines.push(`Показаны первые 100 из ${open.length} открытых портов.`)
      const summary = `TCP ${args.host}${address !== args.host ? ` (${address})` : ''}: проверено ${results.length}; открыто ${counts.open}, отклонено ${counts.closed}, тайм-аут ${counts.timeout}, ошибок ${counts.error}.`
      const allFailed = counts.error === results.length
      const detail = allFailed ? 'Не удалось проверить ни одного порта: все подключения завершились ошибкой.' : lines.join('\n') || 'Открытых портов не обнаружено.'
      return { success: !allFailed, ...(allFailed ? { error: true } : {}), data: { host: args.host, address, results, counts, elapsedMs: Date.now() - started }, formattedContent: `${summary}\n${detail}\nПодсказки по номерам портов не подтверждают тип сервиса; тайм-аут не доказывает, что порт закрыт.` }
    } catch (error) { return { error: true, formattedContent: `Проверка портов не выполнена: ${error instanceof Error ? error.message : String(error)}` } }
  }
}
