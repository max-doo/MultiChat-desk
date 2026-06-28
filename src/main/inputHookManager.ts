import { startListen, HookJs, EventJs } from 'monio-napi'
import { BrowserWindow } from 'electron'
import { showToolbarAt, hideToolbarWindow, getToolbarWindow, isPointInToolbar, setCachedSelectionText } from './webviewManager'
import { startUiaHelper, stopUiaHelper, readSelection } from './uiaSelectionHelper'

let hook: HookJs | null = null
let isMouseDown = false
let startX = 0
let startY = 0
let startTime = 0
let lastClickTime = 0

// 记录当前工具条弹出位置，用于距离判定自动收起
let currentToolbarPhysX = 0
let currentToolbarPhysY = 0

// 防止松手读取与上一次读取并发执行（UIA helper 单槽，并发会返回 null）
let isReading = false

// 鼠标按下时异步读取的"拖拽前选区快照"promise。松手时 await 它得到真值，
// 与松手时的选区对比：相同则视为旧选区未变（如拖窗口标题栏），不弹工具条。
// 存 promise 而非值：避免短拖拽在"读取未完成"时被当成无旧选区而误弹。
let selAtDownPromise: Promise<string | null> = Promise.resolve(null)

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
      // 拖拽开始前先异步快照当前选区，松手时对比以判定是否产生了"新"选区
      if (!isAppFocused()) {
        selAtDownPromise = readSelection().then((r) => r?.text ?? null)
      }
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

  // 启动 UIA 选区读取助手（随工具条开关与 before-quit 联动）
  startUiaHelper()

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
  // 并发守卫：上一次读取尚未结束时忽略新手势（UIA helper 单槽）
  if (isReading) return
  isReading = true
  try {
    // 松手后用 UIA 非侵入读取当前选区（不发 Ctrl+C，不杀终端进程、不抢 Word 工具条）
    const selAtUp = (await readSelection())?.text ?? ''
    // 拿到按下时的选区真值（promise 多半已 resolve，即时返回）
    const selAtDown = await selAtDownPromise

    // 旧选区未变（如拖窗口标题栏，应用里旧选区仍在）→ 不弹
    if (selAtDown !== null && selAtUp === selAtDown) {
      return
    }
    // 无选区（UIA 读不到，如 VS Code 编辑器/记事本）→ 不弹，安全降级
    if (!selAtUp || selAtUp.trim().length === 0) {
      return
    }
    console.log(`[InputHook] Detected text selection at x=${x}, y=${y}, len=${selAtUp.length}`)
    setCachedSelectionText(selAtUp)
    currentToolbarPhysX = x
    currentToolbarPhysY = y
    showToolbarAt(x, y)
  } finally {
    isReading = false
  }
}

export function stopInputHook(): void {
  stopUiaHelper()
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
