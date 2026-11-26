import * as dns from 'node:dns/promises'
import * as net from 'node:net'
import * as tls from 'node:tls'
import { Blackboard } from '../../core/Blackboard'
import { ToolBase, type ToolExecutionPolicy, type ToolResult } from '../../tools/ToolBase'

const CONNECT_TIMEOUT_MS = 10_000
const MAX_HOST_LENGTH = 253

type TlsArgs = { host?: unknown; port?: unknown }
type ApprovalConfig = { confirmAction?: (action: { kind: 'network'; command: string; target: string; details: string }) => Promise<boolean> }

function isHost(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= MAX_HOST_LENGTH && !value.includes('%') && Boolean(
    net.isIP(value) || /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)*[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i.test(value)
  )
}

function formatSubject(subject: Record<string, string | string[] | undefined> | undefined): string {
  if (!subject) return 'не указано'
  const preferred = ['CN', 'O', 'OU', 'C']
  const display = (value: string | string[] | undefined) => Array.isArray(value) ? value.join(', ') : value
  const values = preferred.flatMap(key => subject[key] ? [`${key}=${display(subject[key])}`] : [])
  return (values.join(', ') || Object.entries(subject).map(([key, value]) => `${key}=${display(value)}`).join(', ') || 'не указано').slice(0, 500)
}

function resolveApprovedHost(host: string, signal: AbortSignal): Promise<string> {
  if (net.isIP(host)) return Promise.resolve(host)
  if (signal.aborted) return Promise.reject(new Error('Проверка отменена.'))
  return new Promise((resolve, reject) => {
    let settled = false
    const finish = (error?: Error, address?: string) => {
      if (settled) return
      settled = true
      signal.removeEventListener('abort', onAbort)
      if (error) reject(error)
      else resolve(address!)
    }
    const onAbort = () => finish(new Error('Проверка отменена.'))
    signal.addEventListener('abort', onAbort, { once: true })
    if (signal.aborted) { onAbort(); return }
    void dns.lookup(host, { verbatim: true }).then(result => finish(undefined, result.address), error => finish(new Error(`Не удалось разрешить имя: ${error instanceof Error ? error.message : String(error)}`)))
  })
}

function inspectTls(host: string, address: string, port: number, signal: AbortSignal): Promise<{ certificate: tls.PeerCertificate; protocol: string }> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) { reject(new Error('Проверка отменена.')); return }
    const servername = net.isIP(host) ? undefined : host
    const options: tls.ConnectionOptions = {
      host: address,
      port,
      ...(servername ? { servername } : {}),
      rejectUnauthorized: true,
      checkServerIdentity: (_servername, certificate) => tls.checkServerIdentity(host, certificate)
    }
    let socket: tls.TLSSocket
    try { socket = tls.connect(options) } catch (error) { reject(error); return }
    let settled = false
    const finish = (error?: Error, result?: { certificate: tls.PeerCertificate; protocol: string }) => {
      if (settled) return
      settled = true
      signal.removeEventListener('abort', onAbort)
      socket.removeListener('secureConnect', onSecureConnect)
      socket.removeListener('error', onError)
      socket.destroy()
      if (error) reject(error)
      else resolve(result!)
    }
    const onAbort = () => finish(new Error('Проверка отменена.'))
    const onError = (error: Error) => finish(error)
    const onSecureConnect = () => {
      if (!socket.authorized) {
        finish(new Error(`Сертификат не прошёл стандартную проверку доверия: ${socket.authorizationError || 'неизвестная ошибка'}.`))
        return
      }
      const certificate = socket.getPeerCertificate()
      if (!certificate || Object.keys(certificate).length === 0) { finish(new Error('Сервер не предоставил сертификат.')); return }
      finish(undefined, { certificate, protocol: socket.getProtocol() || 'не указано' })
    }
    socket.once('secureConnect', onSecureConnect)
    socket.once('error', onError)
    signal.addEventListener('abort', onAbort, { once: true })
    if (signal.aborted) onAbort()
  })
}

export class CyberSecTls extends ToolBase {
  get name(): string { return 'cybersec_check_tls' }
  get description(): string { return 'Проверяет TLS-соединение и сертификат одного явно указанного сервера со стандартной проверкой доверия. Перед сетевым запросом требуется подтверждение. Не сканирует порты и не отключает проверку сертификата.' }
  get parameters() { return {
    host: { type: 'string', description: 'Один домен или IP-адрес разрешённой цели.', required: true },
    port: { type: 'integer', description: 'TCP-порт TLS-сервиса, по умолчанию 443.', minimum: 1, maximum: 65535 }
  } }
  getExecutionPolicy(): ToolExecutionPolicy { return { mutates: false, parallelSafe: false, cacheable: false } }

  validate(json: string): string | null {
    try {
      const args: TlsArgs = JSON.parse(json)
      if (!args || typeof args !== 'object' || !isHost(args.host)) return 'Укажите один домен или IP-адрес без схемы, маски и диапазона.'
      if (args.port !== undefined && (!Number.isInteger(args.port) || (args.port as number) < 1 || (args.port as number) > 65535)) return 'Порт должен быть целым числом от 1 до 65535.'
      return null
    } catch { return 'Аргументы TLS-проверки некорректны.' }
  }

  async execute(json: string, board: Blackboard, signal?: AbortSignal): Promise<ToolResult> {
    const validation = this.validate(json)
    if (validation) return { error: true, formattedContent: validation }
    const args = JSON.parse(json) as { host: string; port?: number }
    const host = args.host
    const port = args.port ?? 443
    const config = board.getArtifact('config') as ApprovalConfig | undefined
    if (signal?.aborted) return { error: true, formattedContent: 'Проверка отменена.' }
    const approved = await config?.confirmAction?.({
      kind: 'network',
      command: `TLS ${host}:${port}`,
      target: `${host}:${port}`,
      details: 'Одно TLS-подключение к одному явно указанному серверу. Проверка цепочки доверия и имени сертификата включена.'
    })
    if (!approved || signal?.aborted) return { error: true, formattedContent: 'TLS-проверка не подтверждена или отменена.' }

    const controller = new AbortController()
    const abortState: { reason: 'cancel' | 'timeout' } = { reason: 'timeout' }
    const onAbort = () => { abortState.reason = 'cancel'; controller.abort() }
    signal?.addEventListener('abort', onAbort, { once: true })
    if (signal?.aborted) onAbort()
    const timeout = setTimeout(() => controller.abort(), CONNECT_TIMEOUT_MS)
    try {
      const address = await resolveApprovedHost(host, controller.signal)
      const { certificate, protocol } = await inspectTls(host, address, port, controller.signal)
      if (signal?.aborted) return { error: true, formattedContent: 'Проверка отменена.' }
      const data = {
        host,
        address,
        port,
        protocol,
        certificate: {
          subject: formatSubject(certificate.subject),
          subjectAltName: (certificate.subjectaltname || '').slice(0, 1000) || 'не указано',
          issuer: formatSubject(certificate.issuer),
          validFrom: certificate.valid_from || 'не указано',
          validTo: certificate.valid_to || 'не указано',
          fingerprint256: certificate.fingerprint256 || 'не указано'
        }
      }
      return { success: true, data, formattedContent: `TLS ${host}:${port} → ${address}.
Протокол: ${protocol}.
Сертификат доверенный, имя сервера проверено.
Субъект: ${data.certificate.subject}
Имена: ${data.certificate.subjectAltName}
Издатель: ${data.certificate.issuer}
Действует: ${data.certificate.validFrom} — ${data.certificate.validTo}
Отпечаток SHA-256: ${data.certificate.fingerprint256}${!net.isIP(host) ? `
SNI: ${host}` : ''}` }
    } catch (error) {
      const reason = controller.signal.aborted ? (abortState.reason === 'cancel' ? 'Проверка отменена.' : 'Истекло время TLS-проверки.') : error instanceof Error ? error.message : String(error)
      return { error: true, formattedContent: `TLS-проверка ${host}:${port} не выполнена: ${reason}` }
    } finally {
      clearTimeout(timeout)
      signal?.removeEventListener('abort', onAbort)
    }
  }
}
