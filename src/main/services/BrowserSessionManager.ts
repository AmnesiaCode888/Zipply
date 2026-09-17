import { BrowserWindow } from 'electron'

export interface BrowserActionRequest {
  requestId: string
  action:
    | 'navigate'
    | 'screenshot'
    | 'click'
    | 'type'
    | 'scroll'
    | 'get_content'
    | 'new_tab'
    | 'close_tab'
    | 'list_tabs'
    | 'switch_tab'
  url?: string
  selector?: string
  text?: string
  direction?: 'up' | 'down'
  amount?: number
  tabId?: string
}

export interface BrowserActionResponse {
  requestId: string
  success: boolean
  data?: any
  error?: string
}

interface PendingRequest {
  resolve: (response: BrowserActionResponse) => void
  reject: (err: Error) => void
  timer: NodeJS.Timeout
}

export class BrowserSessionManager {
  private static _instance: BrowserSessionManager | null = null
  private _pendingRequests: Map<string, PendingRequest> = new Map()

  static getInstance(): BrowserSessionManager {
    if (!this._instance) {
      this._instance = new BrowserSessionManager()
    }
    return this._instance
  }

  /**
   * Execute an action via the renderer's embedded browser.
   */
  async executeAction(
    action: BrowserActionRequest['action'],
    params: Partial<Omit<BrowserActionRequest, 'action' | 'requestId'>> = {},
    timeoutMs = 35000
  ): Promise<BrowserActionResponse> {
    const windows = BrowserWindow.getAllWindows()
    const activeWindow = windows.find((w) => !w.isDestroyed() && w.webContents)

    if (!activeWindow) {
      return {
        requestId: 'none',
        success: false,
        error: 'No active Zipply window available to execute browser actions.'
      }
    }

    const requestId = `br_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`
    const request: BrowserActionRequest = {
      requestId,
      action,
      ...params
    }

    return new Promise<BrowserActionResponse>((resolve, reject) => {
      const timer = setTimeout(() => {
        this._pendingRequests.delete(requestId)
        resolve({
          requestId,
          success: false,
          error: `Browser action '${action}' timed out after ${Math.round(timeoutMs / 1000)}s.`
        })
      }, timeoutMs)

      this._pendingRequests.set(requestId, { resolve, reject, timer })

      try {
        // 1. Ensure the right panel opens and selects 'browser' tab so user sees the action live
        activeWindow.webContents.send('browser:openView', { tab: 'browser' })

        // 2. Brief delay (150ms) to ensure React applies state update and mounts view
        setTimeout(() => {
          if (!activeWindow.isDestroyed()) {
            activeWindow.webContents.send('browser:action:request', request)
          }
        }, 150)
      } catch (err: unknown) {
        clearTimeout(timer)
        this._pendingRequests.delete(requestId)
        const msg = err instanceof Error ? err.message : String(err)
        resolve({
          requestId,
          success: false,
          error: `Failed to dispatch browser action: ${msg}`
        })
      }
    })
  }

  /**
   * Handle response from renderer for a browser action.
   */
  handleResponse(response: BrowserActionResponse): void {
    if (!response || !response.requestId) return
    const pending = this._pendingRequests.get(response.requestId)
    if (pending) {
      clearTimeout(pending.timer)
      this._pendingRequests.delete(response.requestId)
      pending.resolve(response)
    }
  }

  /**
   * Clean up all pending requests on window close or shutdown.
   */
  cleanup(): void {
    for (const [id, pending] of this._pendingRequests) {
      clearTimeout(pending.timer)
      pending.resolve({
        requestId: id,
        success: false,
        error: 'Browser session terminated.'
      })
    }
    this._pendingRequests.clear()
  }
}
