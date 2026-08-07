import { startListen, HookJs, EventJs } from 'monio-napi'
import { BrowserWindow, powerMonitor } from 'electron'
import { showToolbarAt, hideToolbarWindow, getToolbarWindow, isPointInToolbar, setCachedSelectionText } from './webviewManager'
import { startSelectionReader, stopSelectionReader, readPlatformSelection } from './platform/selectionReader'

let hook: HookJs | null = null
let hookHealthTimer: ReturnType<typeof setInterval> | null = null
let hookRetryTimer: ReturnType<typeof setTimeout> | null = null
let hookRetryAttempt = 0
let shouldRunInputHook = false
let lastHookEventAt = 0
let isMouseDown = false
let startX = 0
let startY = 0
let lastClickTime = 0

const HOOK_HEALTH_INTERVAL_MS = 5000
const HOOK_EVENT_STALE_MS = 15000
const RECENT_SYSTEM_INPUT_SECONDS = 5
const HOOK_RETRY_DELAYS_MS = [1000, 2000, 5000, 10000, 30000]

// 记录当前工具条弹出位置，用于距离判定自动收起
let currentToolbarPhysX = 0
let currentToolbarPhysY = 0

// 防止松手读取与上一次读取并发执行（UIA helper 单槽，并发会返回 null）
let isReading = false
let wheelSelectionTimer: ReturnType<typeof setTimeout> | null = null

// 鼠标按下时异步读取的"拖拽前选区快照"promise。松手时 await 它得到真值，
// 与松手时的选区对比：相同则视为旧选区未变（如拖窗口标题栏），不弹工具条。
// 存 promise 而非值：避免短拖拽在"读取未完成"时被当成无旧选区而误弹。
let selAtDownPromise: Promise<string | null> = Promise.resolve(null)

// 判断当前激活窗口是否属于本应用，避免在本应用内划词弹窗
function isAppFocused(): boolean {
  return BrowserWindow.getAllWindows().some((win) => !win.isDestroyed() && win.isVisible() && win.isFocused())
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
      selAtDownPromise = Promise.resolve(null)
      // 拖拽开始前先异步快照当前选区，松手时对比以判定是否产生了"新"选区
      if (!isAppFocused()) {
        selAtDownPromise = readPlatformSelection().then((r) => r?.text ?? null)
      }
    }
  }
  // MouseReleased (6)
  else if (type === 6 && event.mouse) {
    if (isLeftButton(event.mouse.button) && isMouseDown) {
      isMouseDown = false
      const x = event.mouse.x ?? 0
      const y = event.mouse.y ?? 0
      const distance = Math.sqrt(Math.pow(x - startX, 2) + Math.pow(y - startY, 2))

      // 距离只过滤明显非拖拽操作；是否形成了本次新选区由 UIA 快照对比确认。
      // 不增加时长门槛：原生事件时间在不同后端上的语义并不稳定，且快速或
      // 长距离选词都可能是合法操作，不能在进入 UIA 校验前提前丢弃。
      if (distance > 15) {
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
  // MouseWheel (10)：滚动不会产生新的 MouseReleased，但 TextArea 中的选区
  // 仍然可能被用户通过滚动定位/扩展。停止滚动后读取一次当前选区，避免每个
  // wheel 事件都启动 UIA 请求。
  else if (type === 10 && event.wheel) {
    if (wheelSelectionTimer) clearTimeout(wheelSelectionTimer)
    const x = event.wheel.x ?? 0
    const y = event.wheel.y ?? 0
    wheelSelectionTimer = setTimeout(() => {
      wheelSelectionTimer = null
      if (!isAppFocused()) {
        void handleTextSelection(x, y, false)
      }
    }, 120)
  }
  // KeyPressed (2)
  else if (type === 2) {
    const activeWindow = getToolbarWindow()
    if (activeWindow && activeWindow.isVisible()) {
      hideToolbarWindow()
    }
  }
}

function stopHookHealthMonitor(): void {
  if (hookHealthTimer) {
    clearInterval(hookHealthTimer)
    hookHealthTimer = null
  }
}

function clearHookRetry(): void {
  if (hookRetryTimer) {
    clearTimeout(hookRetryTimer)
    hookRetryTimer = null
  }
}

function scheduleHookRetry(reason: string): void {
  if (!shouldRunInputHook || hookRetryTimer) return

  const delayIndex = Math.min(hookRetryAttempt, HOOK_RETRY_DELAYS_MS.length - 1)
  const delay = HOOK_RETRY_DELAYS_MS[delayIndex]
  hookRetryAttempt += 1
  console.warn(`[InputHook] Scheduling restart in ${delay}ms (${reason})`)
  hookRetryTimer = setTimeout(() => {
    hookRetryTimer = null
    if (!shouldRunInputHook) return
    console.warn(`[InputHook] Retrying native hook (${reason})`)
    startInputHook()
  }, delay)
}

function restartNativeHook(reason: string): void {
  if (!shouldRunInputHook) return

  console.warn(`[InputHook] Restarting native hook (${reason})`)
  // 复用完整停止流程，同时重置手势状态并重启 UIA helper。只替换原生监听链路，
  // 不触碰工具条 BrowserWindow，避免后台恢复后可见按钮失去交互能力。
  stopInputHook()
  if (!startInputHook()) {
    console.warn(`[InputHook] Native hook restart failed (${reason}); automatic retry scheduled`)
  }
}

function startHookHealthMonitor(): void {
  stopHookHealthMonitor()
  hookHealthTimer = setInterval(() => {
    if (!shouldRunInputHook) return
    if (!hook) {
      scheduleHookRetry('native hook is missing')
      return
    }

    let running = false
    try {
      running = hook.isRunning
    } catch {
      running = false
    }
    if (!running) {
      restartNativeHook('isRunning=false')
      return
    }

    // isRunning=true 只代表 native 对象仍存在，不能证明回调线程仍在派发事件。
    // 系统刚发生过输入、但 Hook 已长时间没有任何回调时，判定事件流静默失活。
    try {
      const systemIdleSeconds = powerMonitor.getSystemIdleTime()
      if (
        systemIdleSeconds <= RECENT_SYSTEM_INPUT_SECONDS &&
        Date.now() - lastHookEventAt >= HOOK_EVENT_STALE_MS
      ) {
        restartNativeHook(`no events for ${Date.now() - lastHookEventAt}ms while system is active`)
      }
    } catch (error) {
      console.warn(`[InputHook] Failed to read system idle time: ${String(error)}`)
    }
  }, HOOK_HEALTH_INTERVAL_MS)
}

export function startInputHook(): boolean {
  shouldRunInputHook = true
  clearHookRetry()
  if (hook) {
    try {
      if (hook.isRunning) {
        startHookHealthMonitor()
        return true
      }
    } catch {
      // 读取 native hook 状态失败，按失效处理并重建。
    }
    try { hook.stop() } catch { /* already stopped */ }
    hook = null
  }

  // 启动 UIA 选区读取助手（随工具条开关与 before-quit 联动）
  startSelectionReader()

  try {
    // 兼容 d.ts 与运行时不符：payload 运行时为 EventJs[]，这里统一解包成单事件逐条处理
    const startedHook = startListen((payload: EventJs | EventJs[]) => {
      lastHookEventAt = Date.now()
      const events = Array.isArray(payload) ? payload : [payload]
      for (const event of events) {
        processEvent(event)
      }
    })
    if (!startedHook.isRunning) {
      try { startedHook.stop() } catch { /* already stopped */ }
      throw new Error('native hook reported isRunning=false immediately after startListen')
    }
    hook = startedHook
    lastHookEventAt = Date.now()
    hookRetryAttempt = 0
    console.log('[InputHook] startListen started successfully')
    startHookHealthMonitor()
    return true
  } catch (err) {
    hook = null
    stopHookHealthMonitor()
    console.error('[InputHook] Failed to startListen:', err)
    scheduleHookRetry('startListen failed')
    return false
  }
}

async function handleTextSelection(x: number, y: number, compareWithDownSnapshot = true): Promise<void> {
  // 并发守卫：上一次读取尚未结束时忽略新手势（UIA helper 单槽）
  if (isReading) return
  isReading = true
  try {
    // 拖拽触发需要拿到按下时的选区真值；滚轮触发没有新的按下快照，
    // 不能拿上一次拖拽的快照来判定“旧选区未变”。
    const selAtDown = compareWithDownSnapshot ? await selAtDownPromise : null
    // 松手后用 UIA 非侵入读取当前选区（不发 Ctrl+C，不杀终端进程、不抢 Word 工具条）
    const selAtUp = (await readPlatformSelection())?.text ?? ''

    // 旧选区未变（如拖窗口标题栏，应用里旧选区仍在）→ 不弹
    if (compareWithDownSnapshot && selAtDown !== null && selAtUp === selAtDown) {
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
  shouldRunInputHook = false
  clearHookRetry()
  hookRetryAttempt = 0
  stopHookHealthMonitor()
  if (wheelSelectionTimer) {
    clearTimeout(wheelSelectionTimer)
    wheelSelectionTimer = null
  }
  stopSelectionReader()
  if (hook) {
    try {
      hook.stop()
      console.log('[InputHook] Hook stopped successfully')
    } catch (err) {
      console.error('[InputHook] Failed to stop hook:', err)
    }
    hook = null
  }
  lastHookEventAt = 0
  isMouseDown = false
  lastClickTime = 0
  currentToolbarPhysX = 0
  currentToolbarPhysY = 0
  selAtDownPromise = Promise.resolve(null)
}
