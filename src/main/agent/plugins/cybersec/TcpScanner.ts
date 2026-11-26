                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            import * as net from 'net'
import { lookup } from 'dns/promises'
import type { ProgressCallback } from '../../tools/ToolBase'

export type PortStatus = 'open' | 'closed' | 'timeout' | 'error'
export interface PortResult { port: number; status: PortStatus }
export const MAX_PORTS = 1024
const CONCURRENCY = 32
const CONNECT_TIMEOUT_MS = 1500

export function parsePorts(args: { ports?: unknown; port_range?: unknown }): { ports: number[]; description: string } {
  if ((args.ports !== undefined) === (args.port_range !== undefined)) throw new Error('Укажите список ports или диапазон port_range.')
  if (args.port_range !== undefined) {
    if (typeof args.port_range !== 'string') throw new Error('Диапазон должен быть строкой, например 1-1024.')
    const match = /^\s*(\d{1,5})\s*-\s*(\d{1,5})\s*$/.exec(args.port_range)
    if (!match) throw new Error('Диапазон должен быть указан как начало-конец, например 1-1024.')
    const start = Number(match[1]), end = Number(match[2])
    if (start < 1 || end > 65535 || end < start || end - start + 1 > MAX_PORTS) throw new Error(`Допустим диапазон из 1–${MAX_PORTS} портов от 1 до 65535.`)
    return { ports: Array.from({ length: end - start + 1 }, (_, index) => start + index), description: `${start}-${end}` }
  }
  if (!Array.isArray(args.ports) || args.ports.length < 1 || args.ports.length > MAX_PORTS || !args.ports.every(port => Number.isInteger(port) && port >= 1 && port <= 65535)) throw new Error(`Укажите список из 1–${MAX_PORTS} TCP-портов от 1 до 65535.`)
  const ports = [...new Set(args.ports as number[])].sort((a, b) => a - b)
  return { ports, description: ports.join(', ') }
}

export function isSingleHost(host: unknown): host is string {
  return typeof host === 'string' && host.length <= 253 && !host.includes('%') && Boolean(net.isIP(host) || /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)*[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i.test(host))
}

/** Resolve once after approval and use that address for every connection. */
export async function resolveHost(host: string, signal?: AbortSignal): Promise<string> {
  if (signal?.aborted) throw new Error('Проверка отменена.')
  if (net.isIP(host)) return host
  return await new Promise<string>((resolve, reject) => {
    let done = false
    const finish = (error?: Error, address?: string) => {
      if (done) return
      done = true; clearTimeout(timeout); signal?.removeEventListener('abort', onAbort)
      if (error) reject(error); else resolve(address!)
    }
    const onAbort = () => finish(new Error('Проверка отменена.'))
    const timeout = setTimeout(() => finish(new Error('Истекло время разрешения имени.')), 5000)
    signal?.addEventListener('abort', onAbort, { once: true })
    if (signal?.aborted) { onAbort(); return }
    void lookup(host, { verbatim: true }).then(result => finish(undefined, result.address), error => finish(new Error(`Не удалось разрешить имя: ${error instanceof Error ? error.message : String(error)}`)))
  })
}

function checkPort(address: string, port: number, signal?: AbortSignal): Promise<PortStatus> {
  return new Promise(resolve => {
    if (signal?.aborted) { resolve('error'); return }
    let socket: net.Socket
    try { socket = net.createConnection({ host: address, port }) } catch { resolve('error'); return }
    let done = false
    const finish = (status: PortStatus) => {
      if (done) return
      done = true; signal?.removeEventListener('abort', onAbort); socket.destroy(); resolve(status)
    }
    const onAbort = () => finish('error')
    socket.once('connect', () => finish('open'))
    socket.once('timeout', () => finish('timeout'))
    socket.once('error', error => finish((error as NodeJS.ErrnoException).code === 'ECONNREFUSED' ? 'closed' : 'error'))
    signal?.addEventListener('abort', onAbort, { once: true })
    if (signal?.aborted) { onAbort(); return }
    socket.setTimeout(CONNECT_TIMEOUT_MS)
  })
}

export async function scanTcp(address: string, ports: number[], signal?: AbortSignal, onProgress?: ProgressCallback): Promise<PortResult[]> {
  const results: PortResult[] = new Array(ports.length)
  let next = 0, complete = 0
  const interval = Math.max(1, Math.ceil(ports.length / 20))
  const worker = async () => {
    while (!signal?.aborted) {
      const index = next++
      if (index >= ports.length) return
      results[index] = { port: ports[index], status: await checkPort(address, ports[index], signal) }
      complete++
      if (!signal?.aborted && (complete % interval === 0 || complete === ports.length)) {
        try { onProgress?.({ message: `Проверено портов: ${complete} из ${ports.length}`, statusText: `${complete}/${ports.length}` }) } catch { /* Progress cannot interrupt a scan. */ }
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, ports.length) }, () => worker()))
  return results.filter(Boolean)
}
