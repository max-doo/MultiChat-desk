import { BrowserWindow } from 'electron'
import { registerWebviewHandlers, setupSharedSessionUserAgent } from '../webviewManager'

/**
 * 后台长驻会话管理服务
 * 负责管理长驻的网页会话实例（无头窗口），不依赖 UI 渲染，
 * 与现有的登录态共享 persist:shared Session。
 */
export class SessionManager {
  private sessions = new Map<string, BrowserWindow>()

  public init(): void {
    setupSharedSessionUserAgent()
    console.log('[SessionManager] Initialized')
  }

  public getOrCreateSession(platformId: string, url?: string): BrowserWindow {
    let win = this.sessions.get(platformId)
    if (win && !win.isDestroyed()) {
      const currentUrl = win.webContents.getURL()
      if (url && (currentUrl === '' || currentUrl === 'about:blank')) {
        void win.loadURL(url)
      }
      return win
    }

    setupSharedSessionUserAgent()

    console.log(`[SessionManager] Creating headless session window for platform: ${platformId}`)
    win = new BrowserWindow({
      show: false,
      width: 1280,
      height: 800,
      webPreferences: {
        partition: 'persist:shared',
        sandbox: false,
        contextIsolation: true,
        nodeIntegration: false,
        backgroundThrottling: false
      }
    })

    registerWebviewHandlers(win.webContents)

    win.on('closed', () => {
      console.log(`[SessionManager] Session window closed for platform: ${platformId}`)
      this.sessions.delete(platformId)
    })

    if (url) {
      win.loadURL(url).catch((err) => {
        console.error(`[SessionManager] Failed to load URL ${url} for platform ${platformId}:`, err)
      })
    }

    this.sessions.set(platformId, win)
    return win
  }

  public getSession(platformId: string): BrowserWindow | undefined {
    const win = this.sessions.get(platformId)
    if (win && !win.isDestroyed()) {
      return win
    }
    if (win) {
      this.sessions.delete(platformId)
    }
    return undefined
  }

  public destroySession(platformId: string): boolean {
    const win = this.sessions.get(platformId)
    if (win) {
      if (!win.isDestroyed()) {
        // 任务主动清理必须真正销毁，绕过预览窗口的“关闭仅隐藏”。
        win.destroy()
      }
      this.sessions.delete(platformId)
      return true
    }
    return false
  }

  public destroyAllSessions(): void {
    console.log('[SessionManager] Destroying all active sessions')
    for (const win of this.sessions.values()) {
      if (!win.isDestroyed()) {
        win.destroy()
      }
    }
    this.sessions.clear()
  }

  public getActivePlatforms(): string[] {
    const active: string[] = []
    for (const [platformId, win] of this.sessions.entries()) {
      if (!win.isDestroyed()) {
        active.push(platformId)
      } else {
        this.sessions.delete(platformId)
      }
    }
    return active
  }
}

export const sessionManager = new SessionManager()
