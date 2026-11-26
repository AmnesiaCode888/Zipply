import { BrowserWindow, ipcMain } from 'electron'
import type { UpdateService } from '../services/UpdateService'

export class UpdateIpcHandler {
  constructor(private readonly updateService: UpdateService) {}

  public register(): void {
    ipcMain.handle('updates:getState', () => this.updateService.getState())
    ipcMain.handle('updates:check', () => this.updateService.checkForUpdates({ manual: true }))
    ipcMain.handle('updates:openDownload', () => this.updateService.openDownloadPage())

    this.updateService.on('state-changed', (state) => {
      for (const win of BrowserWindow.getAllWindows()) {
        if (!win.isDestroyed()) {
          win.webContents.send('updates:stateChanged', state)
        }
      }
    })
  }
}
