

import { app, BrowserWindow, globalShortcut, nativeTheme, clipboard } from 'electron'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import { join } from 'path'
import { readdir, rm } from 'fs/promises'
import { tmpdir } from 'os'
import Store from 'electron-store'
import { initAgentPrompts } from './agentPrompts'
import { registerIpcHandlers } from './ipcHandlers'
import { createWindow, getMainWindow, openBrowserWindowInternal, setQuitting, createTray, destroyTray, createQuickWindow, getQuickWindow } from './webviewManager'

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

// 清理应用遗留的临时上传目录
async function cleanupTempUploadDirs(): Promise<void> {
  try {
    const tempRoot = tmpdir()
    const entries = await readdir(tempRoot, { withFileTypes: true })
    const multichatDirs = entries
      .filter(e => e.isDirectory() && e.name.startsWith('multichat-uploads-'))
      .map(e => join(tempRoot, e.name))

    for (const dir of multichatDirs) {
      try {
        await rm(dir, { recursive: true, force: true })
        console.log('[Main] 清理临时目录:', dir)
      } catch (e) {
        console.warn('[Main] 清理临时目录失败:', dir, e)
      }
    }
  } catch (e) {
    console.warn('[Main] 读取临时目录失败:', e)
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
  // 强制所有 Webview 和原生控件使用浅色模式，与应用 UI 保持一致
  nativeTheme.themeSource = 'light'

  // 清理遗留的临时文件
  void cleanupTempUploadDirs()

  // 设置应用 ID
  electronApp.setAppUserModelId('com.multichat.app')

  // 优化快捷键
  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  // 注册所有 IPC 处理器
  // 注入依赖：Store 实例，获取主窗口函数，打开浏览器窗口函数
  registerIpcHandlers(store, getMainWindow, openBrowserWindowInternal)

  // 创建主窗口
  createWindow()
  createQuickWindow()
  createTray()

  // 注册刷新快捷键 (Ctrl+R / Cmd+R / F5)
  // 在生产环境中 Ctrl+R 默认被禁用，这里手动注册
  const refreshShortcuts = ['CommandOrControl+R', 'F5']
  refreshShortcuts.forEach((shortcut) => {
    globalShortcut.register(shortcut, () => {
      const focusedWindow = BrowserWindow.getFocusedWindow()
      if (focusedWindow) {
        focusedWindow.webContents.reload()
      }
    })
  })

  // 召唤 Quick Window
  const summonAccelerator = 'CommandOrControl+Shift+Space'
  const summonOk = globalShortcut.register(summonAccelerator, () => {
    const qw = getQuickWindow()
    if (!qw) return
    if (qw.isVisible()) qw.hide()
    else { qw.show(); qw.focus() }
  })
  if (!summonOk) console.warn(`[Main] 召唤快捷键注册失败: ${summonAccelerator}`)

  // 剪贴板文本召唤与动作注入 (MVP 快捷键)
  const defaultActions = [
    { accelerator: 'CommandOrControl+Shift+S', action: 'summarize' as const },
    { accelerator: 'CommandOrControl+Shift+E', action: 'polish' as const },
    { accelerator: 'CommandOrControl+Shift+T', action: 'translate' as const },
    { accelerator: 'CommandOrControl+Shift+Q', action: 'raw' as const }
  ]
  defaultActions.forEach(({ accelerator, action }) => {
    const ok = globalShortcut.register(accelerator, () => {
      const text = clipboard.readText().trim()
      const qw = getQuickWindow()
      if (!qw) return
      qw.show()
      qw.focus()
      if (text) {
        setTimeout(() => {
          if (!qw.isDestroyed()) {
            qw.webContents.send('quick:inject-prompt', { text, action })
          }
        }, 300)
      }
    })
    if (!ok) console.warn(`[Main] 快捷操作注册失败: ${accelerator}`)
  })

  app.on('activate', function () {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('before-quit', () => {
  setQuitting(true)
  globalShortcut.unregisterAll()
  destroyTray()
})

// 所有窗口关闭时不再直接退出应用（让应用保留在系统托盘/后台运行）
app.on('window-all-closed', () => {
  // 不注销全局快捷键，以便在后台或托盘模式下随时唤醒
})
