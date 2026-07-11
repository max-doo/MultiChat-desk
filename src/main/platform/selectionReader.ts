/**
 * 跨平台选区读取边界。
 *
 * Windows 继续使用 UIA helper；macOS 不得启动 PowerShell。macOS 原生 AX
 * reader 尚未随当前 Windows 开发环境提供时，返回明确的能力错误，避免
 * 静默改写剪贴板或误报“读取成功”。
 */
import { systemPreferences } from 'electron'
import { execFile } from 'child_process'
import { readSelection as readWindowsSelection, startUiaHelper, stopUiaHelper, type SelectionResult } from '../uiaSelectionHelper'

export type SelectionPermissionStatus = 'granted' | 'denied' | 'unknown' | 'unsupported'

export interface PlatformSelectionResult extends SelectionResult {
  error?: 'permission-denied' | 'unsupported' | 'no-selection'
}

const MACOS_SELECTION_SCRIPT = `
tell application "System Events"
  set frontProcess to first application process whose frontmost is true
  set focusedElement to focused UI element of frontProcess
  return value of attribute "AXSelectedText" of focusedElement
end tell
`

export function startSelectionReader(): void {
  if (process.platform === 'win32') startUiaHelper()
}

export function stopSelectionReader(): void {
  if (process.platform === 'win32') stopUiaHelper()
}

export function getAccessibilityPermissionStatus(): SelectionPermissionStatus {
  if (process.platform !== 'darwin') return 'unsupported'
  try {
    return systemPreferences.isTrustedAccessibilityClient(false) ? 'granted' : 'denied'
  } catch {
    return 'unknown'
  }
}

export function requestAccessibilityPermission(): SelectionPermissionStatus {
  if (process.platform !== 'darwin') return 'unsupported'
  try {
    // Electron 42 exposes the standard macOS consent prompt through this API.
    systemPreferences.isTrustedAccessibilityClient(true)
    return getAccessibilityPermissionStatus()
  } catch {
    return 'unknown'
  }
}

export async function readPlatformSelection(): Promise<PlatformSelectionResult | null> {
  if (process.platform === 'win32') return readWindowsSelection()
  if (process.platform === 'darwin') {
    if (getAccessibilityPermissionStatus() !== 'granted') {
      return { text: '', proc: '', cls: '', hasText: false, error: 'permission-denied' }
    }

    return await new Promise<PlatformSelectionResult>((resolve) => {
      execFile('/usr/bin/osascript', ['-e', MACOS_SELECTION_SCRIPT], { timeout: 1200 }, (error, stdout, stderr) => {
        if (error) {
          const detail = `${error.message}\n${stderr}`.toLowerCase()
          const permissionDenied = detail.includes('not authorized') || detail.includes('not permitted') || detail.includes('-25211')
          resolve({ text: '', proc: '', cls: '', hasText: false, error: permissionDenied ? 'permission-denied' : 'no-selection' })
          return
        }
        const text = stdout.replace(/\r?\n$/, '')
        resolve({ text, proc: '', cls: '', hasText: text.trim().length > 0, error: text.trim().length > 0 ? undefined : 'no-selection' })
      })
    })
  }
  return {
    text: '',
    proc: '',
    cls: '',
    hasText: false,
    error: 'unsupported'
  }
}
