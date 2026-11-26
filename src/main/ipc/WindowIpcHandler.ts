import { ipcMain, BrowserWindow } from 'electron'

export class WindowIpcHandler {
  public register(): void {
    ipcMain.on('window:minimize', (event) => {
      const win = BrowserWindow.fromWebContents(event.sender)
      win?.minimize()
    })

    ipcMain.on('window:maximize', (event) => {
      const win = BrowserWindow.fromWebContents(event.sender)
      if (win) {
        if (win.isMaximized()) {
          win.unmaximize()
        } else {
          win.maximize()
        }
      }
    })

    ipcMain.on('window:close', (event) => {
      const win = BrowserWindow.fromWebContents(event.sender)
      win?.close()
    })
  }
}
