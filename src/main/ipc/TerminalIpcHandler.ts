import { ipcMain, webContents, type IpcMainInvokeEvent, type IpcMainEvent, type WebContents } from 'electron'
import * as path from 'path'
import { terminalSessionManager } from '../agent/services/TerminalSessionManager'
import { normalizeTerminalShell, type TerminalEvent, type TerminalOwner } from '../../shared/terminal'

function assertMainFrame(event: IpcMainInvokeEvent | IpcMainEvent): void {
  if (event.senderFrame !== event.sender.mainFrame) {
    throw new Error('Недопустимый источник запроса.')
  }
}

function ownerFrom(senderId: number, sessionId: unknown, workspace: unknown): TerminalOwner {
  if (typeof sessionId !== 'string' || !sessionId.trim()) {
    throw new Error('Требуется активный чат.')
  }
  const resolvedWorkspace =
    typeof workspace === 'string' && workspace.trim() ? path.resolve(workspace.trim()) : path.resolve(process.cwd())
  return { senderId, sessionId: sessionId.trim(), workspace: resolvedWorkspace }
}

export class TerminalIpcHandler {
  private watchedSenders = new Set<number>()
  private onTerminalEvent = (owner: TerminalOwner, event: TerminalEvent): void => {
    if (!owner.senderId) return
    const target = webContents.fromId(owner.senderId)
    if (!target || target.isDestroyed()) return
    this.watchSender(target)
    try {
      target.send('terminal:event', { sessionId: owner.sessionId, workspace: owner.workspace, event })
    } catch {
      // Renderer may have closed mid-stream
    }
  }

  private watchSender(sender: WebContents): void {
    const senderId = sender.id
    if (this.watchedSenders.has(senderId)) return
    this.watchedSenders.add(senderId)
    sender.once('destroyed', () => {
      this.watchedSenders.delete(senderId)
      void terminalSessionManager.stopSender(senderId)
    })
  }

  register(): void {
    terminalSessionManager.on('terminal_event', this.onTerminalEvent)

    ipcMain.handle('terminal:list', (event, payload: { sessionId?: string; workspace?: string }) => {
      assertMainFrame(event)
      this.watchSender(event.sender)
      const owner = ownerFrom(event.sender.id, payload?.sessionId, payload?.workspace)
      return terminalSessionManager.list(owner)
    })

    ipcMain.handle('terminal:getAiLog', async (event, payload: { sessionId?: string }) => {
      assertMainFrame(event)
      this.watchSender(event.sender)
      if (typeof payload?.sessionId !== 'string' || !payload.sessionId.trim()) {
        return ''
      }
      return await terminalSessionManager.getAiLog(payload.sessionId.trim())
    })

    ipcMain.handle(
      'terminal:create',
      async (event, payload: { sessionId?: string; workspace?: string; cols?: number; rows?: number; shell?: unknown }) => {
        assertMainFrame(event)
        this.watchSender(event.sender)
        const owner = ownerFrom(event.sender.id, payload?.sessionId, payload?.workspace)
        return await terminalSessionManager.startInteractiveShell(
          owner,
          owner.workspace,
          typeof payload?.cols === 'number' ? payload.cols : 100,
          typeof payload?.rows === 'number' ? payload.rows : 28,
          normalizeTerminalShell(payload?.shell)
        )
      }
    )

    ipcMain.handle(
      'terminal:attach',
      (event, payload: { sessionId?: string; workspace?: string; terminalId?: string }) => {
        assertMainFrame(event)
        this.watchSender(event.sender)
        const owner = ownerFrom(event.sender.id, payload?.sessionId, payload?.workspace)
        if (typeof payload?.terminalId !== 'string' || !payload.terminalId) {
          throw new Error('Требуется terminalId.')
        }
        return terminalSessionManager.attach(owner, payload.terminalId)
      }
    )

    ipcMain.on(
      'terminal:write',
      (event, payload: { sessionId?: string; workspace?: string; terminalId?: string; chars?: string }) => {
        try {
          assertMainFrame(event)
          const owner = ownerFrom(event.sender.id, payload?.sessionId, payload?.workspace)
          if (typeof payload?.terminalId === 'string' && typeof payload?.chars === 'string') {
            terminalSessionManager.writeUserInput(owner, payload.terminalId, payload.chars)
          }
        } catch {
          // Ignore writes to closed/missing terminals
        }
      }
    )

    ipcMain.on(
      'terminal:resize',
      (event, payload: { sessionId?: string; workspace?: string; terminalId?: string; cols?: number; rows?: number }) => {
        try {
          assertMainFrame(event)
          const owner = ownerFrom(event.sender.id, payload?.sessionId, payload?.workspace)
          if (
            typeof payload?.terminalId === 'string' &&
            typeof payload?.cols === 'number' &&
            typeof payload?.rows === 'number'
          ) {
            terminalSessionManager.resize(owner, payload.terminalId, payload.cols, payload.rows)
          }
        } catch {
          // Ignore resize on closed terminals
        }
      }
    )

    ipcMain.handle(
      'terminal:signal',
      async (
        event,
        payload: { sessionId?: string; workspace?: string; terminalId?: string; signal?: 'SIGINT' | 'SIGKILL' }
      ) => {
        assertMainFrame(event)
        const owner = ownerFrom(event.sender.id, payload?.sessionId, payload?.workspace)
        if (typeof payload?.terminalId !== 'string' || !payload.terminalId) {
          throw new Error('Требуется terminalId.')
        }
        const sig = payload?.signal === 'SIGKILL' ? 'SIGKILL' : 'SIGINT'
        await terminalSessionManager.sendSignal(owner, payload.terminalId, sig)
        return { ok: true }
      }
    )

    ipcMain.handle(
      'terminal:close',
      async (event, payload: { sessionId?: string; workspace?: string; terminalId?: string }) => {
        assertMainFrame(event)
        const owner = ownerFrom(event.sender.id, payload?.sessionId, payload?.workspace)
        if (typeof payload?.terminalId !== 'string' || !payload.terminalId) {
          throw new Error('Требуется terminalId.')
        }
        await terminalSessionManager.close(owner, payload.terminalId)
        return { ok: true }
      }
    )
  }
}
