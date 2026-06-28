import { InputHook } from 'monio-napi'
import { BrowserWindow } from 'electron'
import { showToolbarAt } from './webviewManager' // 实现在 Task 3 中完成，当前有临时占位

let hook: InputHook | null = null
let isMouseDown = false
let startX = 0
let startY = 0
let startTime = 0
let lastClickTime = 0

// 判断当前激活窗口是否属于本应用，避免在本应用内划词弹窗
function isAppFocused(): boolean {
  return BrowserWindow.getAllWindows().some((win) => win.isFocused())
}

export function startInputHook(): void {
  if (hook) return
  hook = new InputHook()

  hook.onMouseDown((e) => {
    if (e.button === 0) { // 鼠标左键按下
      isMouseDown = true
      startX = e.x
      startY = e.y
      startTime = Date.now()
    }
  })

  hook.onMouseUp((e) => {
    if (e.button === 0 && isMouseDown) {
      isMouseDown = false
      const duration = Date.now() - startTime
      const distance = Math.sqrt(Math.pow(e.x - startX, 2) + Math.pow(e.y - startY, 2))

      // 拖拽划选判定：时长在 150ms 到 2000ms 之间，且物理像素偏移大于 15 像素
      if (duration >= 150 && duration <= 2000 && distance > 15) {
        if (!isAppFocused()) {
          handleTextSelection(e.x, e.y)
        }
      }
    }
  })

  // 监听双击检测（通过时间间隔自行判定，避免 e.clicks 字段不存在问题）
  hook.onClick((e) => {
    if (e.button === 0) {
      const now = Date.now()
      if (now - lastClickTime < 300) {
        if (!isAppFocused()) {
          handleTextSelection(e.x, e.y)
        }
        lastClickTime = 0
      } else {
        lastClickTime = now
      }
    }
  })

  try {
    hook.start()
    console.log('[InputHook] Hook started successfully')
  } catch (err) {
    console.error('[InputHook] Failed to start hook:', err)
  }
}

function handleTextSelection(x: number, y: number): void {
  console.log(`[InputHook] Detected selection gesture at x=${x}, y=${y}`)
  // 松手时不发按键复制，直接弹出悬浮工具条
  showToolbarAt(x, y)
}

export function stopInputHook(): void {
  if (hook) {
    try {
      hook.stop()
      hook.removeAllListeners()
      console.log('[InputHook] Hook stopped successfully')
    } catch (err) {
      console.error('[InputHook] Failed to stop hook:', err)
    }
    hook = null
  }
}
