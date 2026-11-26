export interface HighlightRequest { code: string; grammar: string; detect: boolean; highlight: boolean }
export interface HighlightResult { grammar: string; html: string | null }
export type HighlightResponse = HighlightResult | 'retry' | null
type Job = { id: number; request: HighlightRequest; callback: (result: HighlightResponse) => void; cancelled: boolean }

/** One worker and a bounded pending queue for every code block in the renderer. */
export class CodeHighlightQueue {
  private worker: Worker | null = null
  private active: Job | null = null
  private pending: Job[] = []
  private sequence = 0
  private timer: ReturnType<typeof setTimeout> | null = null
  private disabled = false

  constructor(private createWorker: () => Worker, private maxPending = 64) {}

  request(request: HighlightRequest, callback: (result: HighlightResponse) => void): () => void {
    const job: Job = { id: ++this.sequence, request, callback, cancelled: false }
    if (this.disabled) { callback(null); return () => {} }
    if (this.pending.length >= this.maxPending) {
      callback('retry')
      return () => {}
    }
    this.pending.push(job)
    this.pump()
    return () => { job.cancelled = true; this.pending = this.pending.filter(item => item !== job) }
  }

  private fail(): void {
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
    this.worker?.terminate()
    this.worker = null
    this.disabled = true
    const jobs = [...(this.active ? [this.active] : []), ...this.pending]
    this.active = null
    this.pending = []
    for (const job of jobs) if (!job.cancelled) job.callback(null)
  }

  private pump(): void {
    if (this.active || this.disabled || !this.pending.length) return
    if (!this.worker) {
      try {
        this.worker = this.createWorker()
        this.worker.onmessage = (event: MessageEvent<HighlightResult & { id: number }>) => {
          const job = this.active
          if (!job || event.data.id !== job.id) return
          if (this.timer) clearTimeout(this.timer)
          this.timer = null
          this.active = null
          if (!job.cancelled) job.callback({ grammar: event.data.grammar, html: event.data.html })
          this.pump()
        }
        this.worker.onerror = () => this.fail()
        this.worker.onmessageerror = () => this.fail()
      } catch { this.fail(); return }
    }
    this.active = this.pending.shift()!
    try {
      this.worker.postMessage({ id: this.active.id, ...this.active.request })
      this.timer = setTimeout(() => this.fail(), 5000)
    } catch { this.fail() }
  }
}
