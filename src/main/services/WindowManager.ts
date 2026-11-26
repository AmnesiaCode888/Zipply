/// <reference types="electron-vite/node" />

import { BrowserWindow, shell } from 'electron'
import { join } from 'path'
import { is } from '@electron-toolkit/utils'
import icon from '../../../resources/icon.png?asset'

export class WindowManager {
  private mainWindow: BrowserWindow | null = null

  public createMainWindow(): BrowserWindow {
    this.mainWindow = new BrowserWindow({
      width: 1000,
      height: 700,
      minWidth: 400,
      minHeight: 300,
      show: false,
      frame: false,
      transparent: false,
      backgroundColor: '#0E0E0E',
      icon,
      roundedCorners: true,
      hasShadow: true,
      autoHideMenuBar: true,
      webPreferences: {
        preload: join(__dirname, '../preload/index.js'),
        sandbox: false,
        contextIsolation: true
      }
    })

    this.mainWindow.on('ready-to-show', () => {
      this.mainWindow?.show()
    })

    this.mainWindow.webContents.setWindowOpenHandler((details) => {
      shell.openExternal(details.url)
      return { action: 'deny' }
    })

    if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
      this.mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
    } else {
      this.mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
    }

    this.mainWindow.on('closed', () => {
      this.mainWindow = null
    })

    return this.mainWindow
  }

  public getMainWindow(): BrowserWindow | null {
    return this.mainWindow
  }
}
