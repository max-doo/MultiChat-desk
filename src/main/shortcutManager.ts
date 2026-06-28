import { globalShortcut, clipboard, BrowserWindow } from 'electron'
import { writeFileSync, unlinkSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { execFile } from 'child_process'
import type Store from 'electron-store'
import { getQuickWindow, showAndFocusWindow } from './webviewManager'

export interface ShortcutConfig {
  summon: string
  summarize: string
  polish: string
  translate: string
  raw: string
  search: string
}

export const defaultShortcuts: ShortcutConfig = {
  summon: 'CommandOrControl+Shift+Space',
  summarize: '',
  polish: '',
  translate: '',
  raw: '',
  search: ''
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
      if (qw.isVisible() && qw.isFocused()) qw.hide()
      else showAndFocusWindow(qw)
    })
    if (!ok) console.warn(`[ShortcutManager] 召唤快捷键注册失败: ${config.summon}`)
  }

  // Actions
  const actions = [
    { key: config.summarize, action: 'summarize' as const },
    { key: config.polish, action: 'polish' as const },
    { key: config.translate, action: 'translate' as const },
    { key: config.raw, action: 'raw' as const },
    { key: config.search, action: 'search' as const }
  ]
  actions.forEach(({ key, action }) => {
    if (key) {
      const ok = globalShortcut.register(key, async () => {
        const qw = getQuickWindow()
        if (!qw) return

        // 1. 延迟等待 250ms，留给用户时间释放物理按键 (Ctrl, Shift 等)，避免修饰键冲突
        await sleep(250)

        // 2. 模拟 Ctrl+C 获取当前选中文本（此时焦点仍在外部活动窗口）
        const text = await getSelectedTextAsync()

        // 未获取到选中文本时，不通过划词快捷键召唤弹窗
        if (!text) return

        // 3. 展示并聚焦快捷窗口
        showAndFocusWindow(qw)

        if (text) {
          // 4. 等待窗口加载就绪后注入文本
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
 * 异步获取当前活动窗口选中的文本（仅限 Windows）。
 *
 * 执行策略：
 * 1. 备份当前剪贴板
 * 2. 清空剪贴板，以便精确侦测是否有新内容写入
 * 3. 运行轻量级 VBScript 发送 Ctrl+C 按键
 * 4. 等待 150ms 允许外部应用向剪贴板写入内容
 * 5. 读取剪贴板：有新内容则直接返回；否则还原剪贴板并兜底
 *
 * @param keepClipboard 若为 true（默认），获取成功后保持新内容在剪贴板；
 *                      若为 false，获取成功后还原原本的剪贴板内容。
 */
export async function getSelectedTextAsync(keepClipboard = true): Promise<string> {
  if (process.platform !== 'win32') {
    return clipboard.readText().trim()
  }

  // 1. 备份剪贴板
  const prevText = clipboard.readText()

  // 2. 清空剪贴板
  clipboard.clear()

  // 3. 模拟 Ctrl+C
  await simulateCopyWin32VBS()

  // 4. 等待 150ms 确保剪贴板数据就绪
  await sleep(150)

  // 5. 读新剪贴板
  const newText = clipboard.readText().trim()
  if (newText) {
    if (!keepClipboard && prevText) {
      clipboard.writeText(prevText)
    }
    return newText
  }

  // 无新内容，还原旧剪贴板并返回空字符串
  if (prevText) {
    clipboard.writeText(prevText)
  }
  return ''
}

/**
 * 利用 VBScript 模拟发送 Ctrl+C 到当前活动窗口。
 * VBScript (cscript.exe) 启动极快（约 10ms），绝不抢占窗口焦点或显示任何控制台窗口。
 */
function simulateCopyWin32VBS(): Promise<void> {
  return new Promise((resolve) => {
    const tempVbsPath = join(tmpdir(), `multichat-copy-${Date.now()}.vbs`)
    try {
      // 写入 VBS 脚本内容
      writeFileSync(tempVbsPath, 'Set w = CreateObject("WScript.Shell")\nw.SendKeys "^c"\n')

      // 使用 cscript 运行并隐藏窗口
      execFile('cscript.exe', ['//NoLogo', tempVbsPath], { timeout: 1500, windowsHide: true }, (err) => {
        if (err) {
          console.warn('[ShortcutManager] VBS 模拟复制执行出错:', err.message)
        }
        // 清理临时文件
        try {
          unlinkSync(tempVbsPath)
        } catch (cleanupErr) {
          console.warn('[ShortcutManager] 无法删除临时 VBS 文件:', cleanupErr)
        }
        resolve()
      })
    } catch (writeErr) {
      console.warn('[ShortcutManager] 写入/模拟复制脚本出错:', writeErr)
      resolve()
    }
  })
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
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
