
import { app, BrowserWindow } from 'electron'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import { join } from 'path'
import Store from 'electron-store'
import { initAgentPrompts } from './agentPrompts'
import { registerIpcHandlers } from './ipcHandlers'
import { createWindow, getMainWindow, openBrowserWindowInternal } from './webviewManager'

// ============ 便携模式支持 ============

// 检测是否为便携版运行模式
function isPortableMode(): boolean {
  try {
    const fs = require('fs')
    const portableMarker = join(app.getAppPath(), '..', 'portable.txt')
    return fs.existsSync(portableMarker)
  } catch {
    return false
  }
}

// 获取数据存储路径
function getDataPath(): string {
  if (isPortableMode()) {
    const portableDataPath = join(app.getAppPath(), '..', 'data')
    try {
      const fs = require('fs')
      if (!fs.existsSync(portableDataPath)) {
        fs.mkdirSync(portableDataPath, { recursive: true })
      }
      return portableDataPath
    } catch (e) {
      console.error('Failed to create portable data directory:', e)
      return app.getPath('userData')
    }
  }
  return app.getPath('userData')
}

// 配置 Session 数据路径
function configureSessionPath(): void {
  if (isPortableMode()) {
    const sessionDataPath = join(getDataPath(), 'session')
    app.setPath('userData', sessionDataPath)
    app.setPath('sessionData', sessionDataPath)
  }
}

// ============ 初始化 ============

// 在应用启动前配置路径
configureSessionPath()

const dataPath = getDataPath()
console.log('[Main] 数据目录:', dataPath)
console.log('[Main] 运行模式:', isPortableMode() ? '🎒 便携版' : '💿 安装版')

// 初始化数据目录
initAgentPrompts(dataPath)

// 初始化 electron-store
const store = new Store({
  name: is.dev ? 'config-dev' : 'config',
  cwd: dataPath
})

// ============ 应用生命周期 ============

app.whenReady().then(() => {
  // 设置应用 ID
  electronApp.setAppUserModelId('com.modelmash.app')

  // 优化快捷键
  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  // 注册所有 IPC 处理器
  // 注入依赖：Store 实例，获取主窗口函数，打开浏览器窗口函数
  registerIpcHandlers(store, getMainWindow, openBrowserWindowInternal)

  // 创建主窗口
  createWindow()

  app.on('activate', function () {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

// 所有窗口关闭时退出应用 (macOS 除外)
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
