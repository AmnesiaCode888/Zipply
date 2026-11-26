import * as fs from 'fs'
import * as path from 'path'
import * as fsAsync from 'fs/promises'
import { randomUUID } from 'crypto'

const CHAT_KEY = 'zipply_chat_sessions_v1'
type ChatSession = { id: string; [key: string]: unknown }
type PreparedCheckpoint = { temp: string; revision: number; session: ChatSession; release: () => void; timer: ReturnType<typeof setTimeout> }
type PrepareResult = { status: 'ready'; token: string } | { status: 'missing' | 'superseded' }

/** Small origin-independent values. Each key is replaced atomically. */
export class AppStorage {
  private dir: string
  private chatMutation = 0
  private chatRevision = 0
  private checkpointQueue: Promise<void> = Promise.resolve()
  private prepared = new Map<string, PreparedCheckpoint>()
  constructor(userData: string) { this.dir = path.join(userData, 'storage') }
  private file(key: string): string {
    if (!/^zipply_[a-zA-Z0-9_]+$/.test(key)) throw new Error('Invalid storage key')
    return path.join(this.dir, `${key}.json`)
  }
  get(key: string): { exists: boolean; value: string | null } {
    try {
      const item = JSON.parse(fs.readFileSync(this.file(key), 'utf8'))
      if (!item || !(typeof item.value === 'string' || item.value === null)) throw new Error('Invalid storage value')
      return { exists: true, value: item.value }
    } catch (error: any) {
      if (error?.code === 'ENOENT') return { exists: false, value: null }
      throw error
    }
  }
  set(key: string, value: string | null): void {
    if (value !== null && typeof value !== 'string') throw new Error('Invalid storage value')
    const file = this.file(key)
    fs.mkdirSync(this.dir, { recursive: true })
    const temp = `${file}.${process.pid}.tmp`
    fs.writeFileSync(temp, JSON.stringify({ value }), { mode: 0o600 })
    fs.renameSync(temp, file)
    if (key === CHAT_KEY) { this.chatMutation++; this.chatRevision++ }
  }
  prepareCheckpoint(sessionId: string, messages: unknown[]): Promise<PrepareResult> {
    if (typeof sessionId !== 'string' || !/^[a-zA-Z0-9_-]+$/.test(sessionId) || !Array.isArray(messages)) return Promise.reject(new Error('Некорректный контрольный снимок чата'))
    const expectedMutation = this.chatMutation
    const previous = this.checkpointQueue
    let release!: () => void
    this.checkpointQueue = new Promise<void>(resolve => { release = resolve })
    const run = async (): Promise<PrepareResult> => {
      if (expectedMutation !== this.chatMutation) { release(); return { status: 'superseded' } }
      const file = this.file(CHAT_KEY)
      const revision = this.chatRevision
      let raw: string
      // A Windows async read holds the destination open across event-loop turns,
      // which can make an intervening atomic rename fail with EPERM.
      try { raw = fs.readFileSync(file, 'utf8') }
      catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') { release(); return { status: 'missing' } }
        throw error
      }
      if (revision !== this.chatRevision) { release(); return { status: 'superseded' } }
      const item = JSON.parse(raw)
      if (!item || typeof item.value !== 'string') throw new Error('Некорректная история чатов')
      const sessions: unknown = JSON.parse(item.value)
      if (!Array.isArray(sessions)) throw new Error('Некорректная история чатов')
      const index = sessions.findIndex(session => session && typeof session === 'object' && session.id === sessionId)
      if (index < 0) { release(); return { status: 'missing' } }
      const session = { ...sessions[index], messages, updatedAt: Date.now() } as ChatSession
      sessions[index] = session
      const token = randomUUID()
      const temp = `${file}.${process.pid}.checkpoint-${token}.tmp`
      let retained = false
      try {
        await fsAsync.mkdir(this.dir, { recursive: true })
        await fsAsync.writeFile(temp, JSON.stringify({ value: JSON.stringify(sessions) }), { mode: 0o600 })
        if (revision !== this.chatRevision) return { status: 'superseded' }
        const timer = setTimeout(() => this.discardCheckpoint(token), 30_000)
        timer.unref()
        this.prepared.set(token, { temp, revision, session, release, timer })
        retained = true
        return { status: 'ready', token }
      } finally { if (!retained) { await fsAsync.rm(temp, { force: true }).catch(() => {}); release() } }
    }
    return previous.then(run).catch(error => { release(); throw error })
  }
  commitCheckpoint(token: string, onCommit?: (session: ChatSession) => void): { status: 'saved' | 'superseded' | 'missing' } {
    const prepared = this.prepared.get(token)
    if (!prepared) return { status: 'missing' }
    this.prepared.delete(token)
    clearTimeout(prepared.timer)
    try {
      if (prepared.revision !== this.chatRevision) return { status: 'superseded' }
      fs.renameSync(prepared.temp, this.file(CHAT_KEY))
      this.chatRevision++
      onCommit?.(prepared.session)
      return { status: 'saved' }
    } finally { void fsAsync.rm(prepared.temp, { force: true }).catch(() => {}); prepared.release() }
  }
  discardCheckpoint(token: string): void {
    const prepared = this.prepared.get(token)
    if (!prepared) return
    this.prepared.delete(token)
    clearTimeout(prepared.timer)
    void fsAsync.rm(prepared.temp, { force: true }).catch(() => {})
    prepared.release()
  }
  keys(): string[] {
    try { return fs.readdirSync(this.dir).filter(name => /^zipply_[a-zA-Z0-9_]+\.json$/.test(name)).map(name => name.slice(0, -5)).filter(key => this.get(key).value !== null) }
    catch (error: any) { if (error?.code === 'ENOENT') return []; throw error }
  }
}
