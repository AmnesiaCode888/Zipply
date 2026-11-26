import * as fs from 'fs'
import * as path from 'path'

interface SecretCodec {
  isEncryptionAvailable(): boolean
  encryptString(value: string): Buffer
  decryptString(value: Buffer): string
}

export class SecretStore {
  private file: string
  constructor(userData: string, private codec: SecretCodec) { this.file = path.join(userData, 'secrets.json') }
  private read(): Record<string, string> {
    try { return JSON.parse(fs.readFileSync(this.file, 'utf8')) } catch (error: any) {
      if (error?.code === 'ENOENT') return {}
      throw error
    }
  }
  get(key: string): string {
    const value = this.read()[key]
    if (!value) return ''
    if (!this.codec.isEncryptionAvailable()) throw new Error('Защищённое хранилище недоступно')
    return this.codec.decryptString(Buffer.from(value, 'base64'))
  }
  set(key: string, value: string): void {
    if (!this.codec.isEncryptionAvailable()) throw new Error('Защищённое хранилище недоступно')
    const data = this.read()
    if (value) data[key] = this.codec.encryptString(value).toString('base64')
    else delete data[key]
    fs.mkdirSync(path.dirname(this.file), { recursive: true })
    const temp = `${this.file}.tmp`
    fs.writeFileSync(temp, JSON.stringify(data), { mode: 0o600 })
    fs.renameSync(temp, this.file)
  }
}
