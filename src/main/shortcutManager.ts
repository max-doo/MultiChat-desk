import { globalShortcut, clipboard, BrowserWindow } from 'electron'
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
      if (!ok) console.warn(`[ShortcutManager] 快捷操作注册失败: ${key}`)
    }
  })
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
