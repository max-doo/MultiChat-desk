import { startListen, HookJs, EventJs } from 'monio-napi'
import { BrowserWindow } from 'electron'
import { showToolbarAt, hideToolbarWindow, getToolbarWindow, isPointInToolbar } from './webviewManager'
import { getSelectedTextAsync } from './shortcutManager'

let hook: HookJs | null = null
let isMouseDown = false
let startX = 0
let startY = 0
let startTime = 0
let lastClickTime = 0

// 记录当前工具条弹出位置，用于距离判定自动收起
let currentToolbarPhysX = 0
let currentToolbarPhysY = 0

// 防止松手探测与工具条按钮触发并发执行，避免并发操作剪贴板导致旧值错乱还原
let isProbing = false

// 判断当前激活窗口是否属于本应用，避免在本应用内划词弹窗
function isAppFocused(): boolean {
  return BrowserWindow.getAllWindows().some((win) => win.isFocused())
}

function isLeftButton(button: unknown): boolean {
  return button === 0 || button === 'Left' || button === 'left'
}

// 处理单条输入事件。
// 注意：monio-napi 的 d.ts 把 startListen 回调参数标注为单个 EventJs，
// 但运行时实际按 EventJs[] 批量派发（NAPI-RS 侧用 Vec 派发）。
// 历次"工具条不触发"的根因即在此：直接读 event.eventType / event.mouse 会得到 undefined。
// 解包在 startListen 调用处完成，本函数只处理已解包的单个事件。
function processEvent(event: EventJs): void {
  const type = event.eventType

  // MousePressed (5)
  if (type === 5 && event.mouse) {
    if (isLeftButton(event.mouse.button)) {
      const activeWindow = getToolbarWindow()
      if (activeWindow && activeWindow.isVisible()) {
        const x = event.mouse.x ?? 0
        const y = event.mouse.y ?? 0
        if (!isPointInToolbar(x, y)) {
          hideToolbarWindow()
          currentToolbarPhysX = 0
        }
      }
      isMouseDown = true
      startX = event.mouse.x ?? 0
      startY = event.mouse.y ?? 0
      startTime = Date.now()
    }
  }
  // MouseReleased (6)
  else if (type === 6 && event.mouse) {
    if (isLeftButton(event.mouse.button) && isMouseDown) {
      isMouseDown = false
      const duration = Date.now() - startTime
      const x = event.mouse.x ?? 0
      const y = event.mouse.y ?? 0
      const distance = Math.sqrt(Math.pow(x - startX, 2) + Math.pow(y - startY, 2))

      if (duration >= 150 && duration <= 2000 && distance > 15) {
        if (!isAppFocused()) {
          void handleTextSelection(x, y)
        }
      }
    }
  }
  // MouseClicked (7)
  else if (type === 7 && event.mouse) {
    if (isLeftButton(event.mouse.button)) {
      const now = Date.now()
      const x = event.mouse.x ?? 0
      const y = event.mouse.y ?? 0
      if (now - lastClickTime < 300) {
        if (!isAppFocused()) {
          void handleTextSelection(x, y)
        }
        lastClickTime = 0
      } else {
        lastClickTime = now
      }
    }
  }
  // MouseMoved (8) or MouseDragged (9)
  else if ((type === 8 || type === 9) && event.mouse) {
    const activeWindow = getToolbarWindow()
    if (activeWindow && activeWindow.isVisible() && currentToolbarPhysX > 0) {
      const x = event.mouse.x ?? 0
      const y = event.mouse.y ?? 0
      const dist = Math.sqrt(Math.pow(x - currentToolbarPhysX, 2) + Math.pow(y - currentToolbarPhysY, 2))
      if (dist > 300) {
        hideToolbarWindow()
        currentToolbarPhysX = 0
      }
    }
  }
  // KeyPressed (2)
  else if (type === 2) {
    const activeWindow = getToolbarWindow()
    if (activeWindow && activeWindow.isVisible()) {
      hideToolbarWindow()
    }
  }
}

export function startInputHook(): void {
  if (hook) return

  try {
    // 兼容 d.ts 与运行时不符：payload 运行时为 EventJs[]，这里统一解包成单事件逐条处理
    hook = startListen((payload: EventJs | EventJs[]) => {
      const events = Array.isArray(payload) ? payload : [payload]
      for (const event of events) {
        processEvent(event)
      }
    })
    console.log('[InputHook] startListen started successfully')
  } catch (err) {
    console.error('[InputHook] Failed to startListen:', err)
  }
}

async function handleTextSelection(x: number, y: number): Promise<void> {
  // 并发守卫：上一次探测尚未结束时忽略新手势，避免并发清空/还原剪贴板
  if (isProbing) return
  isProbing = true
  try {
    // 松手后先探测是否真的有选中文本，无选中则不弹工具条。
    // keepClipboard=false：探测成功也不污染剪贴板（还原原值）；
    // 真正的复制/总结在用户点击工具条按钮时由 toolbar:trigger-action 再次触发。
    const text = await getSelectedTextAsync(false)
    if (!text || text.trim().length === 0) {
      return
    }
    console.log(`[InputHook] Detected text selection at x=${x}, y=${y}, len=${text.length}`)
    currentToolbarPhysX = x
    currentToolbarPhysY = y
    showToolbarAt(x, y)
  } finally {
    isProbing = false
  }
}

export function stopInputHook(): void {
  if (hook) {
    try {
      hook.stop()
      console.log('[InputHook] Hook stopped successfully')
    } catch (err) {
      console.error('[InputHook] Failed to stop hook:', err)
    }
    hook = null
  }
}
