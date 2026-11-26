import { globalShortcut, clipboard, BrowserWindow } from 'electron'
import { writeFileSync } from 'fs'
import { rm } from 'fs/promises'
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

  if (config.summon) {
    const ok = globalShortcut.register(config.summon, () => {
      const qw = getQuickWindow()
      if (!qw) return
      if (qw.isVisible() && qw.isFocused()) qw.hide()
      else showAndFocusWindow(qw)
    })
    if (!ok) console.warn(`[ShortcutManager] 召唤快捷键注册失败: ${config.summon}`)
  }

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

        await sleep(250)

        const text = await getSelectedTextAsync()

        // 未获取到选中文本时，不通过划词快捷键召唤弹窗
        if (!text) return

        showAndFocusWindow(qw)

        if (text) {
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

  const prevText = clipboard.readText()

  clipboard.clear()

  await simulateCopyWin32VBS()

  await sleep(150)

  const newText = clipboard.readText().trim()
  if (newText) {
    if (!keepClipboard && prevText) {
      clipboard.writeText(prevText)
    }
    return newText
  }

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
      writeFileSync(tempVbsPath, 'Set w = CreateObject("WScript.Shell")\nw.SendKeys "^c"\n')

      const child = execFile('cscript.exe', ['//NoLogo', tempVbsPath], { timeout: 1500, windowsHide: true }, (err) => {
        if (err) {
          console.warn('[ShortcutManager] VBS 模拟复制执行出错:', err.message)
        }
        // 异步清理临时文件（unlinkSync 在 AV 锁定时阻塞事件循环；改异步且忽略失败，
        // 残留由启动时 cleanupTempUploadDirs 兜底）
        rm(tempVbsPath, { force: true }).catch((cleanupErr) => {
          console.warn('[ShortcutManager] 无法删除临时 VBS 文件:', String(cleanupErr))
        })
        resolve()
      })

      // execFile 的 timeout 仅发 SIGTERM，Windows 下不一定杀掉 cscript.exe；
      // 超时后强制 kill 整个进程树，避免僵尸 cscript 占用
      child.on('exit', (code, _signal) => {
        if (code === null) {
          try { child.kill() } catch { /* 已退出 */ }
        }
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
