import * as path from 'path'

export function sessionFilePath(userData: string, sessionId: string): string {
  if (!/^[a-zA-Z0-9_-]+$/.test(sessionId)) throw new Error('Некорректный идентификатор чата')
  return path.join(userData, 'sessions', `${sessionId}.json`)
}
