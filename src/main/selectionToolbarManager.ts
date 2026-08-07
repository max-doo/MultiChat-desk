import type Store from 'electron-store'
import { getAccessibilityPermissionStatus } from './platform/selectionReader'
import { createToolbarWindow, destroyToolbarWindow, syncSelectionToolbarMenuState } from './webviewManager'
import { startInputHook, stopInputHook } from './inputHookManager'

export interface SelectionToolbarToggleResult {
  success: boolean
  error?: string
}

export function getSelectionToolbarEnabled(store: Store<Record<string, unknown>>): boolean {
  return store.get('selectionToolbarEnabled', false) === true
}

export function setSelectionToolbarEnabled(
  store: Store<Record<string, unknown>>,
  enabled: boolean
): SelectionToolbarToggleResult {
  if (enabled && process.platform === 'darwin' && getAccessibilityPermissionStatus() !== 'granted') {
    syncSelectionToolbarMenuState(getSelectionToolbarEnabled(store))
    return { success: false, error: '请先授予 macOS 辅助功能权限，然后重新开启划词工具条' }
  }

  if (enabled) {
    try {
      createToolbarWindow()
      if (!startInputHook()) {
        store.set('selectionToolbarEnabled', false)
        stopInputHook()
        destroyToolbarWindow()
        syncSelectionToolbarMenuState(false)
        return { success: false, error: '划词工具条监听启动失败，请稍后重试' }
      }
      store.set('selectionToolbarEnabled', true)
    } catch (error) {
      console.error('[InputHook] Failed to enable selection toolbar:', error)
      store.set('selectionToolbarEnabled', false)
      stopInputHook()
      destroyToolbarWindow()
      syncSelectionToolbarMenuState(false)
      return { success: false, error: '划词工具条启动失败，请稍后重试' }
    }
  } else {
    store.set('selectionToolbarEnabled', false)
    stopInputHook()
    destroyToolbarWindow()
  }

  syncSelectionToolbarMenuState(enabled)
  return { success: true }
}
