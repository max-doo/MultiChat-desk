# 划词弹出悬浮工具条（Selection Floating Toolbar）实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 实现类似豆包与桌面划词翻译的悬浮工具条。用户在任何外部应用中划选文本松开鼠标后，系统直接在光标位置上方弹出无焦点（`focusable: false`）的悬浮工具条（松手时不默认触发复制，避免剪贴板污染）；当用户点击工具条上的操作按钮时，才实时获取选中文本，并复制或一键注入到 MultiChat 快捷窗口（Quick Window）执行 AI 操作。

**Architecture:** 
1. 在主进程中利用 Rust napi 原生包 `monio-napi` 注册全局鼠标/键盘钩子，在鼠标左键松开（mouseup）或双击时通过时间和物理位移检测划选动作（过滤本应用窗口获焦的情况）。
2. 判定划选动作后，直接调用 Electron `screen` API 进行逻辑坐标系定位与边界适配，在光标位置上方弹出悬浮工具条（不提前发按键模拟复制，保持外部应用选区高亮不变）。
3. 当用户点击悬浮工具条上的按钮触发操作时，主进程复用既有成熟的 `getSelectedTextAsync()` 提取选中文本（对于 AI 总结/翻译自动备份与还原原剪贴板，对于复制动作直接更新剪贴板）。
4. 创建一个 `focusable: false` 的 frameless `BrowserWindow`（懒加载 `#toolbar` 路由），接收操作并与现有的 `quickWindow` 联动。

**Tech Stack:** Electron 28、`monio-napi` (Rust N-API 库，免编译)、React 18 hash 路由、Tailwind CSS 3、TypeScript。

---

## 计划涉及文件清单

### 新增文件
* [inputHookManager.ts](file:///c:/Project/model-mash/src/main/inputHookManager.ts) - 全局输入事件监听及划词动作检测管理器。
* [ToolbarPage.tsx](file:///c:/Project/model-mash/src/renderer/src/pages/ToolbarPage.tsx) - 悬浮工具条的前端 UI 页面。

### 修改文件
* [package.json](file:///c:/Project/model-mash/package.json) - 添加 `monio-napi` 生产依赖。
* [electron-builder.yml](file:///c:/Project/model-mash/electron-builder.yml) - 配置 `asarUnpack` 原生库解压。
* [shortcutManager.ts](file:///c:/Project/model-mash/src/main/shortcutManager.ts) - 导出并增强 `getSelectedTextAsync` 支持是否保留剪贴板参数。
* [index.ts](file:///c:/Project/model-mash/src/main/index.ts) - 注册和销毁 Input Hook 管理器。
* [webviewManager.ts](file:///c:/Project/model-mash/src/main/webviewManager.ts) - 创建和管理 Toolbar 窗口的懒加载及基于原生 `screen` API 的边界定位。
* [ipcHandlers.ts](file:///c:/Project/model-mash/src/main/ipcHandlers.ts) - 注册悬浮窗口所需的 IPC 处理器。
* [index.ts](file:///c:/Project/model-mash/src/preload/index.ts) - 桥接悬浮窗口的 `window.api` 方法。
* [index.d.ts](file:///c:/Project/model-mash/src/preload/index.d.ts) - 补充悬浮窗口的 TypeScript 类型声明。
* [App.tsx](file:///c:/Project/model-mash/src/renderer/src/App.tsx) - 顶层短路拦截 `#toolbar` hash 路由。

---

## 任务清单

### Task 1: 引入 `monio-napi` 并配置打包与监听骨架

**Files:**
* Modify: [package.json](file:///c:/Project/model-mash/package.json)
* Modify: [electron-builder.yml](file:///c:/Project/model-mash/electron-builder.yml)
* Create: [inputHookManager.ts](file:///c:/Project/model-mash/src/main/inputHookManager.ts)
* Modify: [index.ts](file:///c:/Project/model-mash/src/main/index.ts)

- [ ] **Step 1: 引入 `monio-napi` 并配置原生模块解压**
  
  运行安装命令：
  ```powershell
  npm install monio-napi --save
  ```
  修改 [electron-builder.yml](file:///c:/Project/model-mash/electron-builder.yml)，在顶层添加原生模块解压配置，避免打包后找不到 `.node` 文件：
  ```yaml
  asarUnpack:
    - "**/*.node"
  ```

- [ ] **Step 2: 创建 inputHookManager.ts 并实现事件钩子骨架**
  
  创建文件 [src/main/inputHookManager.ts](file:///c:/Project/model-mash/src/main/inputHookManager.ts)：
  ```typescript
  import { InputHook } from 'monio-napi'

  let hook: InputHook | null = null

  export function startInputHook(): void {
    if (hook) return
    hook = new InputHook()

    hook.onMouseDown((e) => {
      console.log(`[InputHook] MouseDown: button=${e.button}, x=${e.x}, y=${e.y}`)
    })

    hook.onMouseUp((e) => {
      console.log(`[InputHook] MouseUp: button=${e.button}, x=${e.x}, y=${e.y}`)
    })

    try {
      hook.start()
      console.log('[InputHook] Hook started successfully')
    } catch (err) {
      console.error('[InputHook] Failed to start hook:', err)
    }
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
  ```

- [ ] **Step 3: 在主进程初始化与销毁流程中接入 Input Hook**
  
  修改 [src/main/index.ts](file:///c:/Project/model-mash/src/main/index.ts)：
  ```typescript
  // 在文件顶部 import 附近引入
  import { startInputHook, stopInputHook } from './inputHookManager'

  // 在 app.whenReady().then() 注册流程中加入
  app.whenReady().then(() => {
    // 既有初始化...
    startInputHook()
  })

  // 在 before-quit 钩子中释放资源
  app.on('before-quit', () => {
    stopInputHook()
    // 既有清理逻辑...
  })
  ```

- [ ] **Step 4: 编译并验证日志输出**
  
  依次运行验证命令：
  ```powershell
  npm run lint
  npm run build
  npm run dev
  ```
  **验证标准**：启动应用后，在系统任意窗口点击或拖拽鼠标，主进程控制台应当实时打印对应的 `[InputHook] MouseDown` 和 `[InputHook] MouseUp` 物理坐标。

- [ ] **Step 5: 提交代码**
  ```powershell
  git add package.json electron-builder.yml src/main/inputHookManager.ts src/main/index.ts
  git commit -m "feat: add monio-napi dependency and configure asarUnpack for native hooks"
  ```

---

### Task 2: 增强公共提取函数并实现划词动作检测

**Files:**
* Modify: [shortcutManager.ts](file:///c:/Project/model-mash/src/main/shortcutManager.ts)
* Modify: [inputHookManager.ts](file:///c:/Project/model-mash/src/main/inputHookManager.ts)

- [ ] **Step 1: 增强 shortcutManager.ts 导出 `getSelectedTextAsync`**
  
  修改 [src/main/shortcutManager.ts](file:///c:/Project/model-mash/src/main/shortcutManager.ts)，将原内部函数改为 `export` 并支持 `keepClipboard` 参数：
  ```typescript
  /**
   * 获取当前外部软件选中的文本。
   * @param keepClipboard 若为 true，获取成功后保持新内容在剪贴板；若为 false，获取成功后还原原本的剪贴板内容。
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
  ```

- [ ] **Step 2: 完善 inputHookManager.ts 实现动作检测（修复双击和过滤前台）**
  
  修改 [src/main/inputHookManager.ts](file:///c:/Project/model-mash/src/main/inputHookManager.ts)：
  ```typescript
  import { InputHook } from 'monio-napi'
  import { BrowserWindow } from 'electron'
  import { showToolbarAt } from './webviewManager' // 暂时声明，在 Task 3 中实现

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
      } catch (err) {
        console.error('[InputHook] Failed to stop hook:', err)
      }
      hook = null
    }
  }
  ```

- [ ] **Step 3: 验证划词动作检测**
  
  修改 [webviewManager.ts](file:///c:/Project/model-mash/src/main/webviewManager.ts) 的底部临时占位导出，避免构建编译报错：
  ```typescript
  // 临时增加占位函数用于编译
  export function showToolbarAt(x: number, y: number): void {
    console.log(`[Temp] showToolbarAt called with: x=${x}, y=${y}`)
  }
  ```

  依次运行验证命令：
  ```powershell
  npm run lint
  npm run build
  npm run dev
  ```
  **验证标准**：在第三方应用（如浏览器）中拖拽划选文本并松开鼠标，控制台打印 `[InputHook] Detected selection gesture at x=..., y=...`，且第三方应用的文字高亮保持不变。在本应用内部划词不会触发该日志。

- [ ] **Step 4: 提交代码**
  ```powershell
  git add src/main/shortcutManager.ts src/main/inputHookManager.ts src/main/webviewManager.ts
  git commit -m "refactor: export getSelectedTextAsync and implement selection gesture detection with app-focus filter"
  ```

---

### Task 3: 创建懒加载且统一逻辑坐标系的 Toolbar 窗口

**Files:**
* Modify: [webviewManager.ts](file:///c:/Project/model-mash/src/main/webviewManager.ts)

- [ ] **Step 1: 实现 Toolbar 窗口懒创建与定位（统一采用 `screen` 逻辑坐标系）**
  
  修改 [src/main/webviewManager.ts](file:///c:/Project/model-mash/src/main/webviewManager.ts)，替换临时占位：
  ```typescript
  import { screen } from 'electron'

  let toolbarWindow: BrowserWindow | null = null
  export function getToolbarWindow(): BrowserWindow | null { return toolbarWindow }

  export function createToolbarWindow(): void {
      if (toolbarWindow) return
      toolbarWindow = new BrowserWindow({
          width: 180,
          height: 38,
          frame: false,
          transparent: true,
          alwaysOnTop: true,
          skipTaskbar: true,
          resizable: false,
          minimizable: false,
          maximizable: false,
          focusable: false, // 核心：不夺取焦点，保持外部软件选区高亮
          show: false,
          backgroundColor: '#00000000',
          icon: getWindowIcon(),
          webPreferences: {
              preload: join(__dirname, '../preload/index.js'),
              sandbox: false,
              contextIsolation: true,
              nodeIntegration: false
          }
      })

      toolbarWindow.on('closed', () => { toolbarWindow = null })

      const hash = 'toolbar'
      if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
          void toolbarWindow.loadURL(`${process.env['ELECTRON_RENDERER_URL']}/#${hash}`)
      } else {
          void toolbarWindow.loadFile(join(__dirname, '../renderer/index.html'), { hash })
      }
  }

  export function showToolbarAt(physX: number, physY: number): void {
      if (!toolbarWindow) {
          createToolbarWindow()
      }
      if (!toolbarWindow) return

      // 定位与边界适配统一使用 Electron screen 逻辑坐标系，消除高DPI错位风险
      const display = screen.getDisplayNearestPoint({ x: physX, y: physY })
      const scale = display.scaleFactor || 1

      const logicalX = physX / scale
      const logicalY = physY / scale

      const width = 180
      const height = 38

      let targetX = logicalX - width / 2
      let targetY = logicalY - height - 12 // 在鼠标上方 12 逻辑像素弹出

      const { x, y, width: dispW } = display.bounds
      if (targetY < y) {
          targetY = logicalY + 20 // 顶部溢出时翻转到下方
      }
      targetX = Math.max(x, Math.min(targetX, x + dispW - width))

      toolbarWindow.setBounds({
          x: Math.round(targetX),
          y: Math.round(targetY),
          width,
          height
      })

      toolbarWindow.showInactive() // ⚠️ 必须 showInactive()
  }

  export function hideToolbarWindow(): void {
      if (toolbarWindow && toolbarWindow.isVisible()) {
          toolbarWindow.hide()
      }
  }
  ```
  *(注：保持懒加载策略，不于 `createWindow()` 尾部冗余初始化。)*

- [ ] **Step 2: 运行并验证窗口编译**
  
  ```powershell
  npm run lint
  npm run build
  ```
  **验证标准**：确保主进程定位逻辑编译无误。

- [ ] **Step 3: 提交代码**
  ```powershell
  git add src/main/webviewManager.ts
  git commit -m "feat: create focusable-false lazy toolbar window positioned via native screen logical bounds"
  ```

---

### Task 4: 注册 Preload IPC 桥梁及类型契约

**Files:**
* Modify: [index.ts](file:///c:/Project/model-mash/src/preload/index.ts)
* Modify: [index.d.ts](file:///c:/Project/model-mash/src/preload/index.d.ts)
* Modify: [ipcHandlers.ts](file:///c:/Project/model-mash/src/main/ipcHandlers.ts)

- [ ] **Step 1: 补充 Preload 桥梁实现**
  
  修改 [src/preload/index.ts](file:///c:/Project/model-mash/src/preload/index.ts)，在 `api` 中添加方法：
  ```typescript
  toolbarAction: (action: 'summarize' | 'translate' | 'copy') => {
    ipcRenderer.send('toolbar:trigger-action', { action })
  },
  toolbarHide: () => {
    ipcRenderer.send('toolbar:hide')
  }
  ```

- [ ] **Step 2: 在 index.d.ts 声明 window.api 契约**
  
  修改 [src/preload/index.d.ts](file:///c:/Project/model-mash/src/preload/index.d.ts)：
  ```typescript
  toolbarAction: (action: 'summarize' | 'translate' | 'copy') => void
  toolbarHide: () => void
  ```

- [ ] **Step 3: 注册 IPC Handler 实现**
  
  修改 [src/main/ipcHandlers.ts](file:///c:/Project/model-mash/src/main/ipcHandlers.ts)：
  ```typescript
  import { hideToolbarWindow } from './webviewManager'
  
  ipcMain.on('toolbar:hide', () => {
      hideToolbarWindow()
  })
  
  ipcMain.on('toolbar:trigger-action', (_event, payload: { action: string }) => {
      console.log('[IPC] toolbar:trigger-action payload:', payload)
  })
  ```

- [ ] **Step 4: 运行并验证类型与通道**
  
  ```powershell
  npm run lint
  npm run build
  ```
  **验证标准**：确保 Preload 及 IPC 无 TS 校验错误。

- [ ] **Step 5: Commit**
  ```powershell
  git add src/preload/index.ts src/preload/index.d.ts src/main/ipcHandlers.ts
  git commit -m "feat: expose toolbar IPC bridges and synchronize preload types"
  ```

---

### Task 5: 开发前端 Toolbar 路由与 UI（顶层短路拦截）

**Files:**
* Modify: [App.tsx](file:///c:/Project/model-mash/src/renderer/src/App.tsx)
* Create: [ToolbarPage.tsx](file:///c:/Project/model-mash/src/renderer/src/pages/ToolbarPage.tsx)

- [ ] **Step 1: 创建 ToolbarPage.tsx 页面**
  
  创建文件 [src/renderer/src/pages/ToolbarPage.tsx](file:///c:/Project/model-mash/src/renderer/src/pages/ToolbarPage.tsx)：
  ```tsx
  import React from 'react'

  export default function ToolbarPage(): JSX.Element {
    const handleAction = (action: 'summarize' | 'translate' | 'copy') => {
      if (window.api?.toolbarAction) {
        window.api.toolbarAction(action)
      }
    }

    return (
      <div className="h-screen w-screen flex items-center justify-center bg-transparent overflow-hidden">
        <div className="flex items-center gap-1 px-2.5 py-1 bg-white/95 border border-gray-200 shadow-md rounded-full backdrop-blur-md transition-all duration-200">
          {/* 复制按钮 */}
          <button
            type="button"
            onClick={() => handleAction('copy')}
            className="w-7 h-7 flex items-center justify-center rounded-full text-gray-500 hover:text-gray-800 hover:bg-gray-100 transition-colors duration-150"
            title="复制"
          >
            <span className="material-symbols-outlined text-base">content_copy</span>
          </button>
          
          <div className="w-[1px] h-3 bg-gray-200/80 mx-0.5" />

          {/* AI 总结按钮 */}
          <button
            type="button"
            onClick={() => handleAction('summarize')}
            className="w-7 h-7 flex items-center justify-center rounded-full text-blue-500 hover:text-blue-700 hover:bg-blue-50 transition-colors duration-150"
            title="AI总结"
          >
            <span className="material-symbols-outlined text-base">summarize</span>
          </button>

          {/* AI 翻译按钮 */}
          <button
            type="button"
            onClick={() => handleAction('translate')}
            className="w-7 h-7 flex items-center justify-center rounded-full text-purple-500 hover:text-purple-700 hover:bg-purple-50 transition-colors duration-150"
            title="翻译"
          >
            <span className="material-symbols-outlined text-base">translate</span>
          </button>
        </div>
      </div>
    )
  }
  ```

- [ ] **Step 2: 在 App.tsx 中顶层短路拦截 `#toolbar` 路由**
  
  修改 [src/renderer/src/App.tsx](file:///c:/Project/model-mash/src/renderer/src/App.tsx)，将原有 `function App()` 改名为 `MainApp()`，并在最底层导出全新包裹组件，实现真正与 Store 初始化隔离的毫秒级短路：
  ```tsx
  import ToolbarPage from './pages/ToolbarPage'

  // 将原本的 App 改名为 MainApp
  function MainApp(): JSX.Element {
    // 原有逻辑保持完全不变...
  }

  // 顶层优先拦截
  export default function App(): JSX.Element {
    if (window.location.hash === '#toolbar') {
      return <ToolbarPage />
    }
    return <MainApp />
  }
  ```

- [ ] **Step 3: 验证渲染层编译**
  
  ```powershell
  npm run lint
  npm run build
  ```
  **验证标准**：React 页面成功加载且编译无误。

- [ ] **Step 4: Commit**
  ```powershell
  git add src/renderer/src/App.tsx src/renderer/src/pages/ToolbarPage.tsx
  git commit -m "feat: implement stateless ToolbarPage UI with early short-circuit routing in App"
  ```

---

### Task 6: 贯通事件驱动提取与联动且支持距离/输入自动隐藏

**Files:**
* Modify: [ipcHandlers.ts](file:///c:/Project/model-mash/src/main/ipcHandlers.ts)
* Modify: [inputHookManager.ts](file:///c:/Project/model-mash/src/main/inputHookManager.ts)

- [ ] **Step 1: 编写 trigger-action 逻辑复用 `getSelectedTextAsync` 提取文本并唤起 QuickWindow**
  
  修改 [src/main/ipcHandlers.ts](file:///c:/Project/model-mash/src/main/ipcHandlers.ts)：
  ```typescript
  import { getQuickWindow, hideToolbarWindow } from './webviewManager'
  import { getSelectedTextAsync } from './shortcutManager'
  
  ipcMain.on('toolbar:trigger-action', async (_event, payload: { action: 'summarize' | 'translate' | 'copy' }) => {
      // 1. 立即隐藏悬浮工具栏
      hideToolbarWindow()
  
      // 2. 复用成熟方案按需提取文本。
      // 对于 copy 动作传入 true 保持更新；对于 summarize/translate 传入 false 还原剪贴板
      const keepClipboard = payload.action === 'copy'
      const text = await getSelectedTextAsync(keepClipboard)
      if (!text || text.trim().length === 0) {
          console.warn('[Toolbar] Failed to retrieve selected text on action click')
          return
      }
  
      if (payload.action === 'copy') {
          return
      }
  
      // 3. 召唤并聚焦快捷窗口 (严格遵循先复制后 focus 规则)
      const qw = getQuickWindow()
      if (!qw) return
  
      qw.show()
      qw.focus()
  
      // 4. 延迟 300ms 注入 Prompt
      setTimeout(() => {
          if (!qw.isDestroyed()) {
              qw.webContents.send('quick:inject-prompt', {
                  text,
                  action: payload.action
              })
          }
      }, 300)
  })
  ```

- [ ] **Step 2: 在 inputHookManager.ts 中接入“距离收起”与“键盘输入收起”策略**
  
  修改 [src/main/inputHookManager.ts](file:///c:/Project/model-mash/src/main/inputHookManager.ts)：
  ```typescript
  import { hideToolbarWindow, getToolbarWindow } from './webviewManager'

  let currentToolbarPhysX = 0
  let currentToolbarPhysY = 0

  function handleTextSelection(x: number, y: number): void {
    currentToolbarPhysX = x
    currentToolbarPhysY = y
    showToolbarAt(x, y)
  }

  export function startInputHook(): void {
    if (hook) return
    hook = new InputHook()

    // ... 既有 MouseDown / MouseUp / onClick 保持不变 ...

    // 监听鼠标移动，超过 300 物理像素即隐藏工具条
    hook.onMouseMove((e) => {
      const activeWindow = getToolbarWindow()
      if (activeWindow && activeWindow.isVisible() && currentToolbarPhysX > 0) {
        const dist = Math.sqrt(Math.pow(e.x - currentToolbarPhysX, 2) + Math.pow(e.y - currentToolbarPhysY, 2))
        if (dist > 300) {
          hideToolbarWindow()
          currentToolbarPhysX = 0
        }
      }
    })

    // 监听键盘事件，有任何按键输入立马隐藏工具条
    hook.onKeyDown((_e) => {
      const activeWindow = getToolbarWindow()
      if (activeWindow && activeWindow.isVisible()) {
        hideToolbarWindow()
      }
    })

    try {
      hook.start()
    } catch (err) {
      console.error('[InputHook] Failed to start hook:', err)
    }
  }
  ```

- [ ] **Step 3: 运行端到端与打包测试**
  
  ```powershell
  npm run lint
  npm run build
  npm run dev
  ```
  **验证步骤**：
  1. 在浏览器中划选或双击文字，验证上方瞬间出现白色毛玻璃悬浮条且不抢焦。
  2. 点击“AI总结”，验证悬浮条消失，调用 VBS 提取文字并唤起 QuickWindow 自动执行，用户原本的剪贴板历史在 `Ctrl+V` 时未被覆盖。
  3. 点击“复制”，验证文字成功写入系统剪贴板。
  4. 验证鼠标移开 $>300\text{px}$ 或敲击键盘时悬浮条静默收起。
  5. 运行 `npm run build:win:portable` 验证打包产物中 `.node` 原生依赖能正常加载且功能正常。

- [ ] **Step 4: 提交最终代码**
  ```powershell
  git add src/main/ipcHandlers.ts src/main/inputHookManager.ts
  git commit -m "feat: connect toolbar actions with quickWindow using shared getSelectedTextAsync and auto-dismiss"
  ```

---

## Risks & Known Gotchas

1. **安全软件与反作弊拦截**：通过 `monio-napi` 注册全局底层鼠标/键盘钩子（`WH_MOUSE_LL` / `WH_KEYBOARD_LL`），在极少数安装了严格安全防护或游戏反作弊系统（如 Vanguard、EAC）的环境下可能被拦截或误报。
2. **焦点与执行顺序（KNOWLEDGE.md 铁律）**：必须确保在执行 `qw.show() / qw.focus()` **前**完成选词复制提取，否则外部应用焦点丢失将导致复制失败。
