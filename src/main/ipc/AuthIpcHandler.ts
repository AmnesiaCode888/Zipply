import { BrowserWindow, ipcMain } from 'electron'
import type { AuthService } from '../services/AuthService'

export class AuthIpcHandler {
  constructor(private readonly auth: AuthService) {}

  register(): void {
    const assertMainFrame = (event: Electron.IpcMainInvokeEvent): void => {
      if (event.senderFrame !== event.sender.mainFrame) {
        throw new Error('Недопустимый источник запроса.')
      }
    }

    ipcMain.handle('auth:getState', (event) => {
      assertMainFrame(event)
      return this.auth.getState()
    })

    ipcMain.handle('auth:login', (event) => {
      assertMainFrame(event)
      return this.auth.login()
    })

    ipcMain.handle('auth:cancelLogin', (event) => {
      assertMainFrame(event)
      return this.auth.cancelLogin()
    })

    ipcMain.handle('auth:refresh', (event) => {
      assertMainFrame(event)
      return this.auth.refreshProfileAndUsage()
    })

    ipcMain.handle('auth:logout', (event) => {
      assertMainFrame(event)
      return this.auth.logout()
    })

    this.auth.on('stateChanged', (state) => {
      for (const win of BrowserWindow.getAllWindows()) {
        if (!win.isDestroyed() && !win.webContents.isDestroyed()) {
          win.webContents.send('auth:stateChanged', state)
        }
      }
    })
  }
}
