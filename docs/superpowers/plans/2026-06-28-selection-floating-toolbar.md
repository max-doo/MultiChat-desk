# 划词弹出悬浮工具条（Selection Floating Toolbar）实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 实现类似豆包的划词弹出工具条。用户在任何外部应用中选中文本后，系统自动模拟 `Ctrl+C` / `Cmd+C` 复制文本并弹出无焦点的悬浮工具条；用户点击工具条按钮可以复制文本或一键注入到 MultiChat 快捷窗口（Quick Window）执行 AI 操作。

**Architecture:** 
1. 在主进程中利用 Rust napi 原生包 `monio-napi` 注册全局鼠标/键盘钩子，在鼠标左键松开（mouseup）或双击时检测划选动作。
2. 判定划选后，通过 `monio-napi` 模拟按键向系统写入复制指令，并备份/还原原剪贴板内容以获取选中的文本。
3. 创建一个 `focusable: false` 的 frameless `BrowserWindow`（加载 `#toolbar` 路由），在鼠标位置上方弹出，接收操作并与现有的 `quickWindow` 联动。

**Tech Stack:** Electron 28、`monio-napi` (Rust N-API 库，免编译)、React 18 hash 路由、Tailwind CSS 3、TypeScript。

---

## 计划涉及文件清单

### 新增文件
* [inputHookManager.ts](file:///c:/Project/model-mash/src/main/inputHookManager.ts) - 全局输入事件监听及模拟按键的管理器。
* [ToolbarPage.tsx](file:///c:/Project/model-mash/src/renderer/src/pages/ToolbarPage.tsx) - 悬浮工具条的前端 UI 页面。

### 修改文件
* [package.json](file:///c:/Project/model-mash/package.json) - 添加 `monio-napi` 生产依赖。
* [index.ts](file:///c:/Project/model-mash/src/main/index.ts) - 注册和销毁 Input Hook 管理器。
* [webviewManager.ts](file:///c:/Project/model-mash/src/main/webviewManager.ts) - 创建和管理 Toolbar 窗口的生命周期及高DPI边界定位。
* [ipcHandlers.ts](file:///c:/Project/model-mash/src/main/ipcHandlers.ts) - 注册悬浮窗口所需的 IPC 处理器。
* [index.ts](file:///c:/Project/model-mash/src/preload/index.ts) - 桥接悬浮窗口的 `window.api` 方法。
* [index.d.ts](file:///c:/Project/model-mash/src/preload/index.d.ts) - 补充悬浮窗口的 TypeScript 类型声明。
* [App.tsx](file:///c:/Project/model-mash/src/renderer/src/App.tsx) - 注册 `#toolbar` hash 路由的分支。

---

## 任务清单

### Task 1: 引入 `monio-napi` 并搭建事件监听骨架

**Files:**
* Modify: [package.json](file:///c:/Project/model-mash/package.json)
* Create: [inputHookManager.ts](file:///c:/Project/model-mash/src/main/inputHookManager.ts)
* Modify: [index.ts](file:///c:/Project/model-mash/src/main/index.ts)

- [ ] **Step 1: 在 package.json 中引入 `monio-napi`**
  
  运行安装命令：
  ```powershell
  npm install monio-napi --save
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
  **验证标准**：启动应用后，在系统任意窗口点击或拖拽鼠标，主进程终端控制台（Console）应当实时打印对应的 `[InputHook] MouseDown` 和 `[InputHook] MouseUp` 物理像素坐标。

- [ ] **Step 5: 提交代码**
  ```powershell
  git add package.json src/main/inputHookManager.ts src/main/index.ts
  git commit -m "feat: add monio-napi dependency and initialize input hook manager"
  ```

---

### Task 2: 实现划词检测及模拟按键复制

**Files:**
* Modify: [inputHookManager.ts](file:///c:/Project/model-mash/src/main/inputHookManager.ts)

- [ ] **Step 1: 完善 inputHookManager.ts 以实现拖拽划词与双击选择的检测**
  
  修改 [src/main/inputHookManager.ts](file:///c:/Project/model-mash/src/main/inputHookManager.ts)：
  ```typescript
  import { InputHook, KeyJs, simulateKeyPress, simulateKeyTap, simulateKeyRelease } from 'monio-napi'
  import { clipboard } from 'electron'
  import { showToolbarAt } from './webviewManager' // 暂时声明，在 Task 3 中实现

  let hook: InputHook | null = null
  let isMouseDown = false
  let startX = 0
  let startY = 0
  let startTime = 0

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

    hook.onMouseUp(async (e) => {
      if (e.button === 0 && isMouseDown) {
        isMouseDown = false
        const duration = Date.now() - startTime
        const distance = Math.sqrt(Math.pow(e.x - startX, 2) + Math.pow(e.y - startY, 2))

        // 拖拽划选判定：时长在 150ms 到 2000ms 之间，且物理像素偏移大于 15 像素
        if (duration >= 150 && duration <= 2000 && distance > 15) {
          await handleTextSelection(e.x, e.y)
        }
      }
    })

    // 监听双击检测（暂由 MouseUp 距离为 0 且 clicks >= 2 简化判定）
    hook.onClick((e) => {
      if (e.button === 0 && e.clicks >= 2) {
        void handleTextSelection(e.x, e.y)
      }
    })

    try {
      hook.start()
    } catch (err) {
      console.error('[InputHook] Failed to start hook:', err)
    }
  }

  async function handleTextSelection(x: number, y: number): Promise<void> {
    const text = await copySelectedText()
    if (text && text.trim().length > 0) {
      console.log('[InputHook] Detected selected text:', text)
      showToolbarAt(x, y, text)
    }
  }

  async function copySelectedText(): Promise<string> {
    const backupText = clipboard.readText()
    clipboard.clear()

    const isMac = process.platform === 'darwin'
    const modifier = isMac ? KeyJs.MetaLeft : KeyJs.ControlLeft

    try {
      // 模拟 Ctrl+C / Cmd+C 按键组合
      simulateKeyPress(modifier)
      simulateKeyTap(KeyJs.KeyC)
      simulateKeyRelease(modifier)

      // 等待 100ms 确保外部进程将复制的文本写入剪贴板
      await new Promise((resolve) => setTimeout(resolve, 100))

      const copied = clipboard.readText()

      // 备份还原，不破坏用户的剪贴板历史
      if (backupText) {
        clipboard.writeText(backupText)
      }

      return copied
    } catch (err) {
      console.error('[InputHook] Simulation failed:', err)
      if (backupText) clipboard.writeText(backupText)
      return ''
    }
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

- [ ] **Step 2: 验证剪贴板模拟复制**
  
  修改 [webviewManager.ts](file:///c:/Project/model-mash/src/main/webviewManager.ts) 的底部临时占位导出，避免构建编译报错：
  ```typescript
  // 临时增加占位函数用于编译
  export function showToolbarAt(x: number, y: number, text: string): void {
    console.log(`[Temp] showToolbarAt called with: x=${x}, y=${y}, text=${text}`)
  }
  ```

  依次运行验证命令：
  ```powershell
  npm run lint
  npm run build
  npm run dev
  ```
  **验证标准**：在任意记事本或外部浏览器中划选文本，主进程终端控制台应能够即时打印 `[InputHook] Detected selected text: xxx` 且用户的原有剪贴板在粘贴（`Ctrl+V`）时依然保留原本的旧内容（证明备份与还原机制成功）。

- [ ] **Step 3: 提交代码**
  ```powershell
  git add src/main/inputHookManager.ts src/main/webviewManager.ts
  git commit -m "feat: implement global drag-selection detection and copy simulation"
  ```

---

### Task 3: 创建 `focusable: false` 的悬浮工具条窗口

**Files:**
* Modify: [webviewManager.ts](file:///c:/Project/model-mash/src/main/webviewManager.ts)

- [ ] **Step 1: 实现 Toolbar 窗口创建与显示逻辑，带高DPI缩放定位**
  
  修改 [src/main/webviewManager.ts](file:///c:/Project/model-mash/src/main/webviewManager.ts)，替换前面的占位 `showToolbarAt`：
  ```typescript
  import { getDisplayAtPoint } from 'monio-napi'

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
          focusable: false, // 核心：不夺取外部应用焦点，保持选择高亮
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

  export function showToolbarAt(physX: number, physY: number, text: string): void {
      if (!toolbarWindow) {
          createToolbarWindow()
      }
      if (!toolbarWindow) return

      // 获取当前物理坐标对应的显示器信息
      const display = getDisplayAtPoint(physX, physY)
      const scale = display ? display.scaleFactor : 1

      // 转换为逻辑坐标 (Electron setBounds 使用逻辑坐标)
      const logicalX = physX / scale
      const logicalY = physY / scale

      const width = 180
      const height = 38

      let targetX = logicalX - width / 2
      let targetY = logicalY - height - 12 // 在鼠标位置上方 12 像素弹出

      // 边界适配
      if (display) {
          const { x, y, width: dispW, height: dispH } = display.bounds
          if (targetY < y) {
              targetY = logicalY + 20 // 顶部溢出，翻转到光标下方
          }
          // 左右溢出内缩
          targetX = Math.max(x, Math.min(targetX, x + dispW - width))
      }

      toolbarWindow.setBounds({
          x: Math.round(targetX),
          y: Math.round(targetY),
          width,
          height
      })

      toolbarWindow.showInactive() // ⚠️ 必须 showInactive()
      toolbarWindow.webContents.send('toolbar:init-text', text)
  }

  export function hideToolbarWindow(): void {
      if (toolbarWindow && toolbarWindow.isVisible()) {
          toolbarWindow.hide()
      }
  }
  ```

- [ ] **Step 2: 在 `createWindow` 之后初始化该窗口**
  
  修改 [src/main/webviewManager.ts](file:///c:/Project/model-mash/src/main/webviewManager.ts) 的 `createWindow()` 函数尾部：
  ```typescript
  // 在 createWindow 尾端加上：
  createToolbarWindow()
  ```

- [ ] **Step 3: 运行并验证窗口编译**
  
  ```powershell
  npm run lint
  npm run build
  ```
  **验证标准**：确保主进程编译无误。

- [ ] **Step 4: 提交代码**
  ```powershell
  git add src/main/webviewManager.ts
  git commit -m "feat: create focusable-false toolbar window with high-DPI scaling positioning"
  ```

---

### Task 4: 注册 Preload IPC 桥梁及类型契约

**Files:**
* Modify: [index.ts](file:///c:/Project/model-mash/src/preload/index.ts)
* Modify: [index.d.ts](file:///c:/Project/model-mash/src/preload/index.d.ts)
* Modify: [ipcHandlers.ts](file:///c:/Project/model-mash/src/main/ipcHandlers.ts)

- [ ] **Step 1: 补充 Preload 桥梁实现**
  
  修改 [src/preload/index.ts](file:///c:/Project/model-mash/src/preload/index.ts)，在 `api` 导出中添加新方法：
  ```typescript
  // 加上这几个通道绑定
  toolbarAction: (payload: { text: string; action: 'summarize' | 'translate' | 'copy' }) => {
    ipcRenderer.send('toolbar:trigger-action', payload)
  },
  toolbarHide: () => {
    ipcRenderer.send('toolbar:hide')
  },
  onToolbarInit: (callback: (text: string) => void) => {
    const handler = (_event: unknown, text: string) => callback(text)
    ipcRenderer.on('toolbar:init-text', handler)
    return () => {
      ipcRenderer.off('toolbar:init-text', handler)
    }
  }
  ```

- [ ] **Step 2: 在 index.d.ts 声明 window.api 契约**
  
  修改 [src/preload/index.d.ts](file:///c:/Project/model-mash/src/preload/index.d.ts)：
  ```typescript
  // 在 api 结构内添加类型定义
  toolbarAction: (payload: { text: string; action: 'summarize' | 'translate' | 'copy' }) => void
  toolbarHide: () => void
  onToolbarInit: (callback: (text: string) => void) => () => void
  ```

- [ ] **Step 3: 注册 IPC Handler 实现**
  
  修改 [src/main/ipcHandlers.ts](file:///c:/Project/model-mash/src/main/ipcHandlers.ts)：
  ```typescript
  import { hideToolbarWindow } from './webviewManager'
  
  // 在 registerIpcHandlers 中添加：
  ipcMain.on('toolbar:hide', () => {
      hideToolbarWindow()
  })
  
  // toolbar:trigger-action 处理函数（留空用于 Task 5，在此先占位）
  ipcMain.on('toolbar:trigger-action', (_event, payload: { text: string; action: string }) => {
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

### Task 5: 开发前端 Toolbar 路由与 UI

**Files:**
* Modify: [App.tsx](file:///c:/Project/model-mash/src/renderer/src/App.tsx)
* Create: [ToolbarPage.tsx](file:///c:/Project/model-mash/src/renderer/src/pages/ToolbarPage.tsx)

- [ ] **Step 1: 在 App.tsx 中拦截 `#toolbar` 路由**
  
  修改 [src/renderer/src/App.tsx](file:///c:/Project/model-mash/src/renderer/src/App.tsx)：
  ```typescript
  // 在 App 组件的 hash 检查逻辑中加入：
  // 原有: const hash = window.location.hash
  // 修改为对 #toolbar 的支持：
  const hash = window.location.hash
  if (hash === '#toolbar') {
    return <ToolbarPage /> // 暂时声明，在 Step 2 中创建
  }
  ```
  同时在文件顶部导入：
  ```typescript
  import ToolbarPage from './pages/ToolbarPage'
  ```

- [ ] **Step 2: 创建并开发 ToolbarPage.tsx 页面**
  
  创建文件 [src/renderer/src/pages/ToolbarPage.tsx](file:///c:/Project/model-mash/src/renderer/src/pages/ToolbarPage.tsx)：
  ```tsx
  import React, { useEffect, useState } from 'react'

  export default function ToolbarPage(): JSX.Element {
    const [text, setText] = useState('')

    useEffect(() => {
      if (window.api?.onToolbarInit) {
        const unsub = window.api.onToolbarInit((selectedText) => {
          setText(selectedText)
        })
        return unsub
      }
      return undefined
    }, [])

    const handleAction = (action: 'summarize' | 'translate' | 'copy') => {
      if (window.api?.toolbarAction) {
        window.api.toolbarAction({ text, action })
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

- [ ] **Step 3: 验证渲染层编译**
  
  ```powershell
  npm run lint
  npm run build
  ```
  **验证标准**：React 页面成功加载且编译无误。

- [ ] **Step 4: Commit**
  ```powershell
  git add src/renderer/src/App.tsx src/renderer/src/pages/ToolbarPage.tsx
  git commit -m "feat: implement ToolbarPage routing and icon-bar UI"
  ```

---

### Task 6: 贯通 Toolbar 动作与现有的 Quick Window 并实现自动隐藏

**Files:**
* Modify: [ipcHandlers.ts](file:///c:/Project/model-mash/src/main/ipcHandlers.ts)
* Modify: [inputHookManager.ts](file:///c:/Project/model-mash/src/main/inputHookManager.ts)

- [ ] **Step 1: 编写 trigger-action 处理逻辑，驱动 quickWindow 实现文本注入**
  
  修改 [src/main/ipcHandlers.ts](file:///c:/Project/model-mash/src/main/ipcHandlers.ts)：
  ```typescript
  import { getQuickWindow, hideToolbarWindow } from './webviewManager'
  import { clipboard } from 'electron'
  
  // 修改 registerIpcHandlers 中的 toolbar:trigger-action 处理：
  ipcMain.on('toolbar:trigger-action', (_event, payload: { text: string; action: 'summarize' | 'translate' | 'copy' }) => {
      // 1. 隐藏悬浮工具栏
      hideToolbarWindow()
  
      if (payload.action === 'copy') {
          // 写入剪贴板
          clipboard.writeText(payload.text)
          return
      }
  
      // 2. 召唤并聚焦快捷窗口 (quickWindow)
      const qw = getQuickWindow()
      if (!qw) return
  
      qw.show()
      qw.focus()
  
      // 3. 延迟稍许等渲染层重新就绪后，直接向 quickWindow 注入 Prompt
      setTimeout(() => {
          if (!qw.isDestroyed()) {
              qw.webContents.send('quick:inject-prompt', {
                  text: payload.text,
                  action: payload.action
              })
          }
      }, 300)
  })
  ```

- [ ] **Step 2: 在 inputHookManager.ts 中接入“距离收起”与“键盘输入收起”策略**
  
  修改 [src/main/inputHookManager.ts](file:///c:/Project/model-mash/src/main/inputHookManager.ts)：
  ```typescript
  import { hideToolbarWindow } from './webviewManager'

  // 在 startInputHook() 中增加鼠标滑动超出范围收起和键盘收起：
  let currentToolbarPhysX = 0
  let currentToolbarPhysY = 0

  // 记录坐标以做距离判定
  async function handleTextSelection(x: number, y: number): Promise<void> {
    const text = await copySelectedText()
    if (text && text.trim().length > 0) {
      currentToolbarPhysX = x
      currentToolbarPhysY = y
      showToolbarAt(x, y, text)
    }
  }

  // 键盘按下（打字或 Esc）和鼠标移动超过范围时自动收起
  export function startInputHook(): void {
    if (hook) return
    hook = new InputHook()

    // 鼠标按下
    hook.onMouseDown((e) => {
      if (e.button === 0) {
        isMouseDown = true
        startX = e.x
        startY = e.y
        startTime = Date.now()
      }
    })

    // 鼠标弹起
    hook.onMouseUp(async (e) => {
      if (e.button === 0 && isMouseDown) {
        isMouseDown = false
        const duration = Date.now() - startTime
        const distance = Math.sqrt(Math.pow(e.x - startX, 2) + Math.pow(e.y - startY, 2))
        if (duration >= 150 && duration <= 2000 && distance > 15) {
          await handleTextSelection(e.x, e.y)
        }
      }
    })

    hook.onClick((e) => {
      if (e.button === 0 && e.clicks >= 2) {
        void handleTextSelection(e.x, e.y)
      }
    })

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

    // 监听键盘事件，有任何输入立马隐藏工具条（表明用户进入录入状态）
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
  并在文件顶部引入：
  ```typescript
  import { getToolbarWindow } from './webviewManager'
  ```

- [ ] **Step 3: 运行完整端到端测试**
  
  ```powershell
  npm run lint
  npm run build
  ```
  **验证步骤**：
  1. 打开任意外部浏览器窗口（如 Chrome 或 Edge）。
  2. 鼠标拖动高亮选择一小段文本并松开。
  3. 确认鼠标上方立刻浮现一个小巧圆润的白色毛玻璃悬浮条（不夺取焦点）。
  4. 点击悬浮条上的 “AI总结” 图标。
  5. 确认悬浮条淡出消失，快捷窗口（`quickWindow`）自动呼出并得到焦点，文本已被格式化为 Prompt 注入到快捷窗口的模型输入框并自动触发发送。
  6. 重新选择一段文本，让悬浮条浮出，点击“复制”，验证能把文本重复制写入系统剪贴板。
  7. 重新选择文本，让悬浮条浮出，不要点击，将鼠标移离 300 像素以上，验证悬浮条是否自动消失。

- [ ] **Step 4: 提交代码**
  ```powershell
  git add src/main/ipcHandlers.ts src/main/inputHookManager.ts
  git commit -m "feat: connect floating toolbar action with quickWindow and implement auto-dismiss policies"
  ```
