export interface RendererSecretEvent {
  sender: { mainFrame: unknown }
  senderFrame: unknown
  returnValue: unknown
}

export interface RendererSecretStore {
  get(key: string): string
  set(key: string, value: string): void
}

export type RendererSecretIpcRegistrar = (
  channel: string,
  listener: (event: RendererSecretEvent, payload?: unknown) => void
) => void

const RENDERER_SECRET_KEYS = new Set(['apiKey', 'tavilyApiKey'])
const MAX_RENDERER_SECRET_LENGTH = 16_384
const DENIED = { error: 'Недопустимый ключ защищённого хранилища.' }

function isMainFrame(event: RendererSecretEvent): boolean {
  return event.senderFrame === event.sender.mainFrame
}

/** Keeps the legacy settings migration API away from main-process-only secrets. */
export function registerRendererSecretIpc(secrets: RendererSecretStore, register: RendererSecretIpcRegistrar): void {
  register('secrets:get', (event, key) => {
    if (!isMainFrame(event) || typeof key !== 'string' || !RENDERER_SECRET_KEYS.has(key)) {
      event.returnValue = DENIED
      return
    }
    try { event.returnValue = { value: secrets.get(key) } }
    catch { event.returnValue = { error: 'Защищённое хранилище недоступно.' } }
  })

  register('secrets:set', (event, payload) => {
    if (!isMainFrame(event) || payload === null || typeof payload !== 'object' || Array.isArray(payload)) {
      event.returnValue = DENIED
      return
    }
    const value = payload as Record<string, unknown>
    if (Object.keys(value).some(key => key !== 'key' && key !== 'value') ||
        typeof value.key !== 'string' || !RENDERER_SECRET_KEYS.has(value.key) ||
        typeof value.value !== 'string' || value.value.length > MAX_RENDERER_SECRET_LENGTH) {
      event.returnValue = DENIED
      return
    }
    try { secrets.set(value.key, value.value); event.returnValue = { ok: true } }
    catch { event.returnValue = { error: 'Защищённое хранилище недоступно.' } }
  })
}
