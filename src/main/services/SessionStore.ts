import * as fs from 'fs/promises'
import * as fsSync from 'fs'
import * as path from 'path'
import { sessionFilePath } from './SessionPaths'

export class SessionStore {
  private pending = new Map<string, Promise<void>>()
  constructor(private userData: string) {}
  loadAllSync(): { sessions: Array<{ id: string; [key: string]: unknown }>; errors: string[] } {
    const dir = path.join(this.userData, 'sessions')
    const sessions: Array<{ id: string; [key: string]: unknown }> = []
    const errors: string[] = []
    let entries: string[]
    try { entries = fsSync.readdirSync(dir) }
    catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') errors.push('Не удалось прочитать резервные копии чатов')
      return { sessions, errors }
    }
    for (const entry of entries) {
      if (!entry.endsWith('.json')) continue
      try {
        const session = JSON.parse(fsSync.readFileSync(path.join(dir, entry), 'utf8'))
        if (!session || typeof session.id !== 'string' || `${session.id}.json` !== entry || !Array.isArray(session.messages)) throw new Error('invalid session')
        sessions.push(session)
      } catch { errors.push(entry) }
    }
    sessions.sort((a, b) => Number(b.updatedAt || 0) - Number(a.updatedAt || 0))
    return { sessions, errors }
  }
  private enqueue(id: string, operation: () => Promise<void>): Promise<void> {
    const previous = this.pending.get(id) || Promise.resolve()
    const current = previous.catch(() => {}).then(operation)
    this.pending.set(id, current)
    void current.finally(() => { if (this.pending.get(id) === current) this.pending.delete(id) }).catch(() => {})
    return current
  }
  save(session: { id: string; [key: string]: unknown }): Promise<void> {
    const target = sessionFilePath(this.userData, session.id)
    const data = JSON.stringify(session, null, 2)
    return this.enqueue(session.id, async () => {
      await fs.mkdir(path.dirname(target), { recursive: true })
      const temp = `${target}.tmp`
      await fs.writeFile(temp, data, 'utf8')
      await fs.rename(temp, target)
    })
  }
  // Checkpoint payloads are private IPC snapshots, so their serialization can
  // happen after enqueueing without delaying the synchronous commit response.
  saveCheckpoint(session: { id: string; [key: string]: unknown }): Promise<void> {
    const target = sessionFilePath(this.userData, session.id)
    return this.enqueue(session.id, async () => {
      const data = JSON.stringify(session, null, 2)
      await fs.mkdir(path.dirname(target), { recursive: true })
      const temp = `${target}.tmp`
      await fs.writeFile(temp, data, 'utf8')
      await fs.rename(temp, target)
    })
  }
  remove(id: string): Promise<void> {
    const target = sessionFilePath(this.userData, id)
    return this.enqueue(id, () => fs.rm(target, { force: true }))
  }
}
