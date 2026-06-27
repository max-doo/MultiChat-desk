import { globalShortcut, clipboard, BrowserWindow } from 'electron'
import { execFileSync } from 'child_process'
import type Store from 'electron-store'
import { getQuickWindow } from './webviewManager'

export interface ShortcutConfig {
  summon: string
  summarize: string
  polish: string
  translate: string
  raw: string
}

export const defaultShortcuts: ShortcutConfig = {
  summon: 'CommandOrControl+Shift+Space',
  summarize: 'CommandOrControl+Shift+S',
  polish: 'CommandOrControl+Shift+E',
  translate: 'CommandOrControl+Shift+T',
  raw: 'CommandOrControl+Shift+Q'
}

let appStore: Store | null = null

export function initShortcutManager(store: Store): void {
  appStore = store
  registerAllShortcuts()
}

export function registerAllShortcuts(): void {
  globalShortcut.unregisterAll()

  // 重新注册刷新快捷键
  const refreshShortcuts = ['CommandOrControl+R', 'F5']
  refreshShortcuts.forEach((shortcut) => {
    globalShortcut.register(shortcut, () => {
      const focusedWindow = BrowserWindow.getFocusedWindow()
      if (focusedWindow) {
        focusedWindow.webContents.reload()
      }
    })
  })

  const config = getShortcuts()

  // Summon
  if (config.summon) {
    const ok = globalShortcut.register(config.summon, () => {
      const qw = getQuickWindow()
      if (!qw) return
      if (qw.isVisible()) qw.hide()
      else { qw.show(); qw.focus() }
    })
    if (!ok) console.warn(`[ShortcutManager] 召唤快捷键注册失败: ${config.summon}`)
  }

  // Actions
  const actions = [
    { key: config.summarize, action: 'summarize' as const },
    { key: config.polish, action: 'polish' as const },
    { key: config.translate, action: 'translate' as const },
    { key: config.raw, action: 'raw' as const }
  ]
  actions.forEach(({ key, action }) => {
    if (key) {
      const ok = globalShortcut.register(key, () => {
        const qw = getQuickWindow()
        if (!qw) return

        // ⚠️ 关键顺序：必须在 show/focus 之前完成复制，
        // 否则 Electron 窗口抢焦点后 SendKeys 会打到自己的窗口
        const text = getSelectedTextSync()

        // 展示快捷窗口
        qw.show()
        qw.focus()

        if (text) {
          // 窗口刚获得焦点，稍等渲染层准备好再注入
          setTimeout(() => {
            if (!qw.isDestroyed()) {
              qw.webContents.send('quick:inject-prompt', { text, action })
            }
          }, 300)
        }
      })
      if (!ok) console.warn(`[ShortcutManager] 快捷操作注册失败: ${key}`)
    }
  })
}

/**
 * 同步读取当前系统中被选中的文本（Windows 专用）。
 *
 * 执行顺序：
 * 1. 备份当前剪贴板
 * 2. 清空剪贴板（用于检测是否真有新内容写入）
 * 3. 通过 PowerShell SendKeys 同步模拟 Ctrl+C
 *    — 使用 execFileSync 确保在函数返回前模拟动作已完成
 *    — 此时调用方必须保证焦点仍在用户的原始窗口（在 show/focus 之前调用）
 * 4. 等待 120ms 让目标应用完成剪贴板写入（PowerShell 进程本身可能已耗时）
 * 5. 读新剪贴板；若无新内容则还原旧剪贴板并降级返回旧内容
 *
 * 非 Windows：直接返回现有剪贴板内容（用户仍需手动 Ctrl+C）。
 */
function getSelectedTextSync(): string {
  if (process.platform !== 'win32') {
    return clipboard.readText().trim()
  }

  // 1. 备份旧剪贴板
  const prevText = clipboard.readText()

  // 2. 清空剪贴板
  clipboard.clear()

  // 3. 同步模拟 Ctrl+C（焦点此时仍在用户原始窗口）
  try {
    // 使用 execFileSync 而非 execFile：确保在 show/focus 前完成按键模拟
    // -WindowStyle Hidden 避免 PowerShell 窗口闪烁
    const script = `Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.SendKeys]::SendWait('^c')`
    execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-Command', script], {
      timeout: 2000,
      windowsHide: true
    })
  } catch (err) {
    console.warn('[ShortcutManager] PowerShell SendKeys 失败:', (err as Error).message)
    // 失败时降级：还原旧剪贴板并返回旧内容
    if (prevText) clipboard.writeText(prevText)
    return prevText.trim()
  }

  // 4. 等待目标应用完成剪贴板写入
  //    PowerShell 执行本身已经消耗了一些时间，此处再等 120ms 兜底
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 120)

  // 5. 读新剪贴板
  const newText = clipboard.readText().trim()
  if (newText) {
    return newText
  }

  // 无新内容，还原旧剪贴板并降级
  if (prevText) clipboard.writeText(prevText)
  return prevText.trim()
}

export function getShortcuts(): ShortcutConfig {
  if (!appStore) return defaultShortcuts
  return (appStore.get('shortcuts') as ShortcutConfig) || defaultShortcuts
}

export function updateShortcuts(newConfig: Partial<ShortcutConfig>): { success: boolean; error?: string } {
  if (!appStore) return { success: false, error: 'Store not initialized' }
  const current = getShortcuts()
  const merged = { ...current, ...newConfig }
  appStore.set('shortcuts', merged)
  registerAllShortcuts()
  return { success: true }
}
