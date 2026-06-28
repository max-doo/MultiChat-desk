import { BrowserWindow } from 'electron'
import { registerWebviewHandlers, setupSharedSessionUserAgent } from '../webviewManager'

/**
 * 后台长驻会话管理服务
 * 负责管理长驻的网页会话实例（无头窗口），不依赖 UI 渲染，
 * 与现有的登录态共享 persist:shared Session。
 */
export class SessionManager {
  private sessions = new Map<string, BrowserWindow>()

  /**
   * 初始化会话管理器
   */
  public init(): void {
    setupSharedSessionUserAgent()
    console.log('[SessionManager] Initialized')
  }

  /**
   * 获取或创建指定平台的后台长驻会话窗口
   * @param platformId 平台标识，例如 'gemini', 'chatgpt'
   * @param url 初始化加载的网址
   */
  public getOrCreateSession(platformId: string, url?: string): BrowserWindow {
    let win = this.sessions.get(platformId)
    if (win && !win.isDestroyed()) {
      const currentUrl = win.webContents.getURL()
      if (url && (currentUrl === '' || currentUrl === 'about:blank')) {
        void win.loadURL(url)
      }
      return win
    }

    // 确保 User-Agent 设置正确
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

    // 挂载拦截与注入逻辑（链接拦截、Google Auth检测、脚本注入等）
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

  /**
   * 获取指定平台的当前活跃会话窗口
   */
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

  /**
   * 销毁指定平台的后台会话
   */
  public destroySession(platformId: string): boolean {
    const win = this.sessions.get(platformId)
    if (win) {
      if (!win.isDestroyed()) {
        win.close()
      }
      this.sessions.delete(platformId)
      return true
    }
    return false
  }

  /**
   * 销毁所有后台会话窗口
   */
  public destroyAllSessions(): void {
    console.log('[SessionManager] Destroying all active sessions')
    for (const win of this.sessions.values()) {
      if (!win.isDestroyed()) {
        win.close()
      }
    }
    this.sessions.clear()
  }

  /**
   * 获取所有当前活跃的平台 ID 列表
   */
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
