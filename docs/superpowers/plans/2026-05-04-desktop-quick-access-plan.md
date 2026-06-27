# Desktop Quick Access Feature Implementation Plan v2

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 MultiChat 成为可常驻桌面的 AI 助手:关闭主窗后留存系统托盘;按全局快捷键瞬时召唤共享会话的精简 Webview 弹窗;选中文本后用快捷键召唤并自动注入文本(MVP)。

**Architecture:** Electron 主进程统一管理两个 BrowserWindow(主窗、Quick Window)和 Tray;Quick Window 是无边框置顶窗口,加载 `#quick` hash 路由复用现有 React 应用,共用 `persist:shared` Session;新增几条 IPC 通道实现召唤、文本注入、跨窗口状态广播。**不引入任何 C++ 扩展**(robotjs / uiohook-napi)。

**Tech Stack:** Electron 28(`Tray`、`globalShortcut`、`clipboard`、`screen`)、React 18 hash 路由、Zustand 4(用 `subscribe` 做跨窗口广播)、TypeScript 严格模式、electron-store 持久化。

> **测试约定:** 项目无单元测试运行器(见 CLAUDE.md "No test runner is configured")。每个 Task 的验证步骤为 `npm run lint` + `npm run build` + `npm run dev` 中的手动验证清单 + commit。

---

## 0. 与初版计划的差异

| 项 | 初版 | 本版 |
|---|---|---|
| Quick Window 路由 | React Router `/#/quick` 或 `?mode=quick` | 项目无 React Router,沿用 `App.tsx:19-28` 的 `window.location.hash` 分支,新增 `#quick` |
| 文件名 | `windowManager` | `src/main/webviewManager.ts`(实际文件名) |
| 划词文本提取 | 同时声称"无 C++ 依赖"和"用 robotjs"(自相矛盾) | 仅依赖剪贴板:用户先 `Ctrl+C`,再按召唤键自动读 `clipboard.readText()`。悬浮 Toolbar 拆到独立计划 |
| 状态映射字段 | "slotModelIds"(项目不存在) | 用真实存在的 `models: ModelConfig[]` 数组顺序 + `enabled` |
| 状态同步 | "用 zustand-ipc"(未装) | 主进程作总线,新增 `state:broadcast` IPC + Zustand `subscribe` 监听变更 |
| 默认快捷键 | `Alt+Space`(Windows 系统占用) | `CommandOrControl+Shift+Space`(召唤)、`CommandOrControl+Shift+C`(带文本召唤) |
| Quick Window Session | 未指定 | 显式 `partition: 'persist:shared'`,与主窗 Webview 共用登录态 |
| 退出守卫 | "提供一个 flag"(模糊) | 显式 `let isQuitting = false` + setter,`before-quit` 中翻转 |
| IPC 契约 | 文字描述 | 直接列签名表,与 `preload/index.d.ts` 强制对齐 |
| 全局划词悬浮条 | 在本计划中 | **推迟到独立计划**(见 §5),需 `uiohook-napi` 评估 |

## 1. 文件结构与责任

**主进程**
- 修改 `src/main/index.ts` —— 注册 Tray、`isQuitting`/`before-quit` 钩子、Quick Window 创建、走 shortcutManager 注册全局快捷键
- 修改 `src/main/webviewManager.ts` —— 新增 `createQuickWindow()` / `getQuickWindow()` / `createTray()` / `destroyTray()` / `setQuitting()` / `getIsQuitting()`;主窗 `close` 改为转 `hide()`
- 修改 `src/main/ipcHandlers.ts` —— 注册 `tray:*` / `quick:*` / `shortcut:*` / `state:broadcast` 处理器
- 创建 `src/main/shortcutManager.ts` —— 集中管理 `globalShortcut` 注册、冲突回滚、electron-store 持久化
- 创建 `src/main/stateBus.ts` —— 跨窗口状态转发,封装 `webContents.send('state:remote-update', …)`

**预加载**
- 修改 `src/preload/index.ts` —— 暴露新方法到 `window.api`
- 修改 `src/preload/index.d.ts` —— 同步类型声明(项目硬要求)

**渲染层**
- 修改 `src/renderer/src/App.tsx` —— `currentPage` 类型加 `'quick'`,`checkHash` 增加 `#quick` 分支(仍走 `initializeStore`)
- 创建 `src/renderer/src/pages/QuickPage.tsx` —— 全屏渲染单个 `WebviewCard`,本地维护 activeId,接收注入事件
- 修改 `src/renderer/src/store/appStore.ts` —— 在 `initializeStore` 末尾订阅 `onRemoteStateUpdate` + 用 Zustand `subscribe` 监听 `models`/`apiConfig` 变更并广播
- 修改 `src/renderer/src/components/SettingsDrawer.tsx` —— 增加"快捷键与系统托盘"分组

**资源**
- 创建 `assets/tray-icon.png`(Windows/Linux 用,32x32 PNG)
- 创建 `assets/tray-iconTemplate.png`(macOS 用,16x16 黑白模板)
  - 资源缺失时主进程回退到 `assets/logo.png`,保证不阻塞实施

## 2. IPC 契约(必须 main + preload + d.ts 三处同步)

所有 invoke handler 返回 `{ success: boolean; data?: T; error?: string }`(项目既有约定)。事件类(`webContents.send`)单向推送。

| 通道 | 方向 | 签名 | 说明 |
|---|---|---|---|
| `tray:show-main` | renderer → main(invoke) | `() => Promise<{success}>` | 显示主窗(托盘菜单或 Quick Window 调用) |
| `tray:hide-main` | renderer → main | `() => Promise<{success}>` | 隐藏主窗到托盘 |
| `tray:quit-app` | renderer → main | `() => Promise<{success}>` | 设 `isQuitting=true` 后 `app.quit()` |
| `quick:show` | renderer → main | `(opts?: {focus?: boolean}) => Promise<{success}>` | 显示 Quick Window |
| `quick:hide` | renderer → main | `() => Promise<{success}>` | 隐藏 Quick Window |
| `quick:inject-prompt` | main → renderer(quick)(send) | `{text: string; action: 'summarize'\|'polish'\|'translate'\|'raw'}` | 召唤后自动注入文本到 WebviewCard 输入框 |
| `shortcut:get-all` | renderer → main | `() => Promise<{success; data: ShortcutMap}>` | 读取已配置的全局快捷键 |
| `shortcut:update` | renderer → main | `(id: ShortcutId, accelerator: string) => Promise<{success; error?}>` | 解注旧值,注册新值,失败回滚 |
| `state:broadcast` | renderer → main | `(key: string, value: unknown) => Promise<{success}>` | 主进程转发到所有其他 renderer |
| `state:remote-update` | main → renderer(send) | `{key: string; value: unknown}` | 由 `state:broadcast` 触发 |

类型补充(放在 `preload/index.d.ts`):
```ts
type ShortcutId = 'summon' | 'summonWithText'
type ShortcutMap = Record<ShortcutId, string>
type QuickInjectAction = 'summarize' | 'polish' | 'translate' | 'raw'
```

---

## 3. 任务清单

### Task 1: 主窗关闭转隐藏 + isQuitting 守卫

**Files:**
- Modify: `src/main/webviewManager.ts`(模块状态 + `createWindow` 关闭监听)
- Modify: `src/main/index.ts`(`before-quit` 钩子)

- [ ] **Step 1: 在 `webviewManager.ts` 模块状态区(`webviewManager.ts:14` 附近)增加退出标志和 setter/getter**

```ts
let isQuitting = false
export function setQuitting(v: boolean): void { isQuitting = v }
export function getIsQuitting(): boolean { return isQuitting }
```

- [ ] **Step 2: 修改 `createWindow()`,在 `mainWindow.on('ready-to-show', ...)` 之后追加 close 拦截**

```ts
mainWindow.on('close', (e) => {
  if (!isQuitting) {
    e.preventDefault()
    mainWindow?.hide()
  }
})
```

- [ ] **Step 3: 在 `index.ts` 顶部 import `setQuitting`,并在 `app.whenReady().then(...)` 之外增加 `before-quit` 钩子**

```ts
import { createWindow, getMainWindow, openBrowserWindowInternal, setQuitting } from './webviewManager'

app.on('before-quit', () => {
  setQuitting(true)
  globalShortcut.unregisterAll()
})
```

`window-all-closed` 保持现状,因为 `hide()` 不会触发它(没有窗口被销毁)。

- [ ] **Step 4: `npm run lint` + `npm run build`**

预期:lint 0 警告;build 输出 `out/main/index.js`、`out/preload/index.js`、`out/renderer/index.html`。

- [ ] **Step 5: `npm run dev` 验证**

- 主窗启动后点击右上 X,主窗隐藏不退出
- Windows 任务管理器可看到 MultiChat 进程仍存在
- 在终端 `Ctrl+C` 终止 dev,清理重启

- [ ] **Step 6: Commit**

```
git add src/main/webviewManager.ts src/main/index.ts
git commit -m "feat: intercept main window close to hide instead of quit"
```

---

### Task 2: 系统托盘与三项菜单

**Files:**
- Modify: `src/main/webviewManager.ts`
- Modify: `src/main/index.ts`
- Modify: `src/main/ipcHandlers.ts`
- Modify: `src/preload/index.ts`
- Modify: `src/preload/index.d.ts`

托盘资源缺失时回退到 `assets/logo.png`。等本 Task 验收时再让用户/设计提供专用托盘图标。

- [ ] **Step 1: 在 `webviewManager.ts` 顶部 import,模块状态增加 tray**

```ts
import { app, BrowserWindow, shell, nativeImage, Tray, Menu, type WebFrameMain } from 'electron'

let tray: Tray | null = null
export function getTray(): Tray | null { return tray }
```

- [ ] **Step 2: 在 `webviewManager.ts` 增加 `getTrayIconPath()` 与 `createTray()` / `destroyTray()`**

```ts
function getTrayIconPath(): string {
  const file = process.platform === 'darwin' ? 'tray-iconTemplate.png' : 'tray-icon.png'
  const candidate = join(app.getAppPath(), 'assets', file)
  try { require('fs').accessSync(candidate); return candidate } catch { return getIconPngPath() }
}

export function createTray(): void {
  if (tray) return
  const iconPath = getTrayIconPath()
  const image = nativeImage.createFromPath(iconPath)
  if (process.platform === 'darwin') image.setTemplateImage(true)
  tray = new Tray(image)
  tray.setToolTip('MultiChat')

  const contextMenu = Menu.buildFromTemplate([
    { label: '显示主界面', click: () => { mainWindow?.show(); mainWindow?.focus() } },
    { label: '召唤快捷弹窗', click: () => {
        const qw = quickWindow
        if (!qw) return
        qw.show(); qw.focus()
      } },
    { type: 'separator' },
    { label: '退出', click: () => { setQuitting(true); app.quit() } }
  ])
  tray.setContextMenu(contextMenu)

  tray.on('click', () => {
    if (!mainWindow) return
    if (mainWindow.isVisible()) mainWindow.hide()
    else { mainWindow.show(); mainWindow.focus() }
  })
}

export function destroyTray(): void {
  tray?.destroy()
  tray = null
}
```

(`quickWindow` 在 Task 3 加,这里先引用变量名;先实现 createTray 时注释掉 quickWindow 一行,等 Task 3 完成再恢复。或保持代码原样,Task 3 完成后立即可用)

> 简化:Task 2 此处的"召唤快捷弹窗"先写 `console.log('quick window not yet implemented')`,Task 3 完成后再修正为 `quickWindow.show()`。

- [ ] **Step 3: 在 `index.ts` 启动时 `createTray()`,`before-quit` 中销毁**

```ts
import { createTray, destroyTray, setQuitting } from './webviewManager'

app.whenReady().then(() => {
  // ... 现有代码
  registerIpcHandlers(store, getMainWindow, openBrowserWindowInternal)
  createWindow()
  createTray()  // 新增
  // ... 快捷键注册等
})

app.on('before-quit', () => {
  setQuitting(true)
  globalShortcut.unregisterAll()
  destroyTray()
})
```

- [ ] **Step 4: 在 `ipcHandlers.ts` 注册三个托盘 handler**

文件顶部 import:
```ts
import { setQuitting } from './webviewManager'
```

在 `registerIpcHandlers` 函数体内追加:
```ts
ipcMain.handle('tray:show-main', () => {
  const w = getMainWindow()
  if (w) { w.show(); w.focus() }
  return { success: true }
})
ipcMain.handle('tray:hide-main', () => {
  getMainWindow()?.hide()
  return { success: true }
})
ipcMain.handle('tray:quit-app', () => {
  setQuitting(true)
  app.quit()
  return { success: true }
})
```

注意 `app` 在文件顶部已经 import;若没有就从 `electron` 加上。

- [ ] **Step 5: preload 暴露**

`src/preload/index.ts`:
```ts
trayShowMain: () => ipcRenderer.invoke('tray:show-main'),
trayHideMain: () => ipcRenderer.invoke('tray:hide-main'),
trayQuitApp: () => ipcRenderer.invoke('tray:quit-app'),
```

- [ ] **Step 6: d.ts 同步**

`src/preload/index.d.ts`,在 `api: { ... }` 内追加:
```ts
trayShowMain: () => Promise<{success: boolean; error?: string}>
trayHideMain: () => Promise<{success: boolean; error?: string}>
trayQuitApp: () => Promise<{success: boolean; error?: string}>
```

- [ ] **Step 7: lint + build**

- [ ] **Step 8: 在 `npm run dev` 验证**

- 启动后系统托盘出现 MultiChat 图标(用 logo 回退即可)
- 单击托盘:主窗显示/隐藏切换
- 右键三项菜单:"显示主界面 / 召唤快捷弹窗(暂无效) / 退出"
- 点击"退出"后任务管理器进程消失

- [ ] **Step 9: Commit**

```
git add src/main/webviewManager.ts src/main/index.ts src/main/ipcHandlers.ts src/preload/index.ts src/preload/index.d.ts
git commit -m "feat: system tray with show/hide/quit menu"
```

---

### Task 3: Quick Window 创建与默认召唤快捷键

**Files:**
- Modify: `src/main/webviewManager.ts`
- Modify: `src/main/index.ts`
- Modify: `src/main/ipcHandlers.ts`
- Modify: `src/preload/index.ts`
- Modify: `src/preload/index.d.ts`

- [ ] **Step 1: 在 `webviewManager.ts` 模块状态增加 `quickWindow` 与 getter**

放在 `let mainWindow: BrowserWindow | null = null` 之下:
```ts
let quickWindow: BrowserWindow | null = null
export function getQuickWindow(): BrowserWindow | null { return quickWindow }
```

- [ ] **Step 2: 实现 `createQuickWindow()`**

```ts
export function createQuickWindow(): void {
  if (quickWindow) return
  quickWindow = new BrowserWindow({
    width: 800,
    height: 600,
    show: false,
    frame: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    backgroundColor: '#ffffff',
    icon: getWindowIcon(),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false,
      webviewTag: true,
      partition: 'persist:shared'
    }
  })

  quickWindow.on('blur', () => {
    if (quickWindow && !quickWindow.isDestroyed()) quickWindow.hide()
  })

  quickWindow.on('close', (e) => {
    if (!isQuitting) { e.preventDefault(); quickWindow?.hide() }
  })

  quickWindow.on('closed', () => { quickWindow = null })

  const hash = 'quick'
  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    void quickWindow.loadURL(`${process.env['ELECTRON_RENDERER_URL']}/#${hash}`)
  } else {
    void quickWindow.loadFile(join(__dirname, '../renderer/index.html'), { hash })
  }
}
```

- [ ] **Step 3: 在 `index.ts` 启动时预创建 Quick Window 并修正 Task 2 的占位**

```ts
import { createWindow, createTray, destroyTray, createQuickWindow, getQuickWindow, setQuitting } from './webviewManager'

app.whenReady().then(() => {
  // ... 现有代码 ...
  createWindow()
  createQuickWindow()  // 预创建,加快首次召唤
  createTray()
  // ...
})
```

把 Task 2 中"召唤快捷弹窗"占位换回真实实现:
```ts
{ label: '召唤快捷弹窗', click: () => {
    const qw = getQuickWindow()
    if (!qw) return
    qw.show(); qw.focus()
  } },
```

- [ ] **Step 4: 在 `index.ts` 注册全局召唤快捷键**

替换原有快捷键注册块(`index.ts:114-124`):
```ts
// 刷新快捷键
;['CommandOrControl+R', 'F5'].forEach((shortcut) => {
  globalShortcut.register(shortcut, () => {
    const focusedWindow = BrowserWindow.getFocusedWindow()
    if (focusedWindow) focusedWindow.webContents.reload()
  })
})

// 召唤 Quick Window
const summonAccelerator = 'CommandOrControl+Shift+Space'
const summonOk = globalShortcut.register(summonAccelerator, () => {
  const qw = getQuickWindow()
  if (!qw) return
  if (qw.isVisible()) qw.hide()
  else { qw.show(); qw.focus() }
})
if (!summonOk) console.warn(`[Main] 召唤快捷键注册失败: ${summonAccelerator}`)
```

(Task 7 会替换为 shortcutManager,这里先硬编码以确保 Task 3 可独立验证)

- [ ] **Step 5: 实现 `quick:show` / `quick:hide` IPC handler**

`ipcHandlers.ts`,顶部 import 增加 `getQuickWindow`,registerIpcHandlers 函数体内追加:
```ts
ipcMain.handle('quick:show', (_e, opts?: { focus?: boolean }) => {
  const qw = getQuickWindow()
  if (!qw) return { success: false, error: 'Quick Window not initialized' }
  qw.show()
  if (opts?.focus !== false) qw.focus()
  return { success: true }
})
ipcMain.handle('quick:hide', () => {
  getQuickWindow()?.hide()
  return { success: true }
})
```

- [ ] **Step 6: preload + d.ts**

`preload/index.ts`:
```ts
quickShow: (opts?: { focus?: boolean }) => ipcRenderer.invoke('quick:show', opts),
quickHide: () => ipcRenderer.invoke('quick:hide'),
```

`preload/index.d.ts`:
```ts
quickShow: (opts?: {focus?: boolean}) => Promise<{success: boolean; error?: string}>
quickHide: () => Promise<{success: boolean; error?: string}>
```

- [ ] **Step 7: lint + build**

- [ ] **Step 8: 在 `npm run dev` 验证**

(此时 `#quick` 路由还没实现,Quick Window 显示主页面是预期的——下个 Task 修)
- 启动后无可见 Quick Window
- 按 `Ctrl+Shift+Space`:出现 800×600 无边框窗口,内容是主页(暂时不对,Task 4 修)
- 失焦自动隐藏
- 再按 `Ctrl+Shift+Space` 重新召唤
- 托盘菜单"召唤快捷弹窗"也能召唤

- [ ] **Step 9: Commit**

```
git add src/main/webviewManager.ts src/main/index.ts src/main/ipcHandlers.ts src/preload/index.ts src/preload/index.d.ts
git commit -m "feat: quick window lifecycle and global summon shortcut"
```

---

### Task 4: 渲染层 `#quick` 路由与 QuickPage

**Files:**
- Modify: `src/renderer/src/App.tsx`
- Create: `src/renderer/src/pages/QuickPage.tsx`

- [ ] **Step 1: 修改 `App.tsx` currentPage 类型**

```tsx
const [currentPage, setCurrentPage] = useState<'main' | 'summary' | 'browser' | 'quick'>('main')
```

- [ ] **Step 2: 修改 `checkHash` 增加 `#quick` 分支**

注意 quick 仍需要走 init,因此 return false 不阻断后续 init:

```tsx
const checkHash = (): boolean => {
  if (window.location.hash.startsWith('#browser')) {
    setCurrentPage('browser')
    if (!isInitialized) setIsInitialized(true)
    return true  // browser 不需要 store init
  }
  if (window.location.hash.startsWith('#quick')) {
    setCurrentPage('quick')
    return false  // quick 需要走 init
  }
  return false
}
```

- [ ] **Step 3: 在 `App.tsx` 渲染分支增加 quick 页**

`return` 块中,在 `if (currentPage === 'browser')` 之后追加:
```tsx
if (currentPage === 'quick') {
  return (
    <Layout>
      <QuickPage />
    </Layout>
  )
}
```

并在文件顶部 `import QuickPage from './pages/QuickPage'`。

- [ ] **Step 4: 创建 `src/renderer/src/pages/QuickPage.tsx`**

```tsx
import { useRef, useEffect, useState } from 'react'
import { useAppStore } from '../store/appStore'
import WebviewCard, { WebviewCardRef } from '../components/WebviewCard'

export default function QuickPage(): JSX.Element {
  const models = useAppStore((s) => s.models)
  const [activeId, setActiveId] = useState<string | null>(null)
  const cardRef = useRef<WebviewCardRef>(null)

  // 取第一个 enabled 模型作为默认
  useEffect(() => {
    if (activeId && models.find((m) => m.id === activeId)?.enabled) return
    const first = models.find((m) => m.enabled)
    setActiveId(first?.id ?? null)
  }, [models, activeId])

  if (!activeId) {
    return (
      <div className="flex items-center justify-center h-full text-gray-400">
        无可用模型,请到主界面启用至少一个模型
      </div>
    )
  }

  const model = models.find((m) => m.id === activeId)
  if (!model) return <div className="h-full"></div>

  return (
    <div className="h-full w-full">
      <WebviewCard
        ref={cardRef}
        id={model.id}
        name={model.name}
        url={model.url}
        logo={model.logo}
        enabled={model.enabled}
        slotIndex={0}
        compact
        onModelChange={(modelId) => setActiveId(modelId)}
      />
    </div>
  )
}
```

`onModelChange` 覆写后 Quick Window 切换模型只改自身 activeId,不调用 `swapModelInSlot`,与主窗解耦。

- [ ] **Step 5: lint + build**

- [ ] **Step 6: 在 `npm run dev` 验证**

- 主窗启动,主进程已预创建 Quick Window 加载 `#quick`
- 按 `Ctrl+Shift+Space`,Quick Window 显示一张 WebviewCard(默认主窗第一个 enabled 模型)
- 切换 WebviewCard 顶部下拉,可在不同平台间切换
- 在 Quick Window 内登录(如 Gemini 选账号),关闭后回主窗,主窗的 Gemini 也是登录态(`persist:shared` 验证点)

- [ ] **Step 7: Commit**

```
git add src/renderer/src/App.tsx src/renderer/src/pages/QuickPage.tsx
git commit -m "feat: #quick hash route renders single WebviewCard"
```

---

### Task 5: 跨窗口状态同步广播

**Files:**
- Create: `src/main/stateBus.ts`
- Modify: `src/main/ipcHandlers.ts`
- Modify: `src/preload/index.ts`
- Modify: `src/preload/index.d.ts`
- Modify: `src/renderer/src/store/appStore.ts`

策略:用 Zustand 的 `subscribe` 监听 `models` 与 `apiConfig` 的变更并通过 `state:broadcast` 转发,避免逐个包装 setter。接收端用 `setState` 写入,**不再触发 broadcast**(因为只有 setter 走 set,subscribe 监听的也是 set,这里要用一个 `isApplyingRemote` 标志位避免回环)。

- [ ] **Step 1: 创建 `src/main/stateBus.ts`**

```ts
import type { WebContents } from 'electron'
import { getMainWindow, getQuickWindow } from './webviewManager'

export function broadcastState(originWebContentsId: number, key: string, value: unknown): void {
  const targets: (WebContents | undefined)[] = [
    getMainWindow()?.webContents,
    getQuickWindow()?.webContents
  ]
  for (const wc of targets) {
    if (!wc || wc.id === originWebContentsId) continue
    wc.send('state:remote-update', { key, value })
  }
}
```

- [ ] **Step 2: 在 `ipcHandlers.ts` 注册 `state:broadcast`**

文件顶部 import:
```ts
import { broadcastState } from './stateBus'
```

handler:
```ts
ipcMain.handle('state:broadcast', (event, key: string, value: unknown) => {
  broadcastState(event.sender.id, key, value)
  return { success: true }
})
```

- [ ] **Step 3: preload + d.ts**

`preload/index.ts`:
```ts
stateBroadcast: (key: string, value: unknown) => ipcRenderer.invoke('state:broadcast', key, value),
onRemoteStateUpdate: (cb: (payload: { key: string; value: unknown }) => void) => {
  const handler = (_e: Electron.IpcRendererEvent, payload: { key: string; value: unknown }): void => cb(payload)
  ipcRenderer.on('state:remote-update', handler)
  return () => { ipcRenderer.removeListener('state:remote-update', handler) }
}
```

`preload/index.d.ts`:
```ts
stateBroadcast: (key: string, value: unknown) => Promise<{success: boolean}>
onRemoteStateUpdate: (cb: (payload: {key: string; value: unknown}) => void) => () => void
```

- [ ] **Step 4: 在 `appStore.ts` 末尾增加广播订阅与远程接收**

文件末尾(在 store 创建之后)追加:

```ts
// ============ 跨窗口状态同步 ============
let isApplyingRemote = false

useAppStore.subscribe((state, prev) => {
  if (isApplyingRemote) return
  if (state.models !== prev.models) {
    void window.api.stateBroadcast('models', state.models)
  }
  if (state.apiConfig !== prev.apiConfig) {
    void window.api.stateBroadcast('apiConfig', state.apiConfig)
  }
})

function applyRemoteState(payload: { key: string; value: unknown }): void {
  isApplyingRemote = true
  try {
    if (payload.key === 'models') {
      useAppStore.setState({ models: payload.value as ModelConfig[] })
    } else if (payload.key === 'apiConfig') {
      useAppStore.setState({ apiConfig: payload.value as ApiConfig })
    }
  } finally {
    isApplyingRemote = false
  }
}
```

(注:zustand v4 的 `subscribe` 默认监听整个 state,回调签名 `(state, prev) => void`。若项目用了 `subscribeWithSelector` middleware 则用 `subscribe(selector, listener)` 形态;实施时按 `appStore.ts` 实际 import 调整。)

- [ ] **Step 5: 在 `initializeStore` 末尾(成功路径)订阅远程更新**

找到 `initializeStore` 函数结束前(成功 return 路径),增加:
```ts
const unsub = window.api.onRemoteStateUpdate(applyRemoteState)
// 模块级保留 unsub 供热重载场景下清理(可选)
;(window as unknown as { __mmStateUnsub?: () => void }).__mmStateUnsub = unsub
```

- [ ] **Step 6: lint + build**

注意 TS 严格模式下 `subscribe` 的回调签名要明确;若 lint 报 `@typescript-eslint/no-explicit-any`,把 `as ModelConfig[]` 等强转保留即可,不要用 any。

- [ ] **Step 7: 在 `npm run dev` 验证**

- 主窗启用/禁用 Kimi(改变 `models[].enabled`)
- 召唤 Quick Window,Kimi 出现/消失对应的下拉项
- 在 Quick Window 切换模型(只改 activeId,不广播),关掉再开主窗,主窗 slot 0 模型不变(QuickPage 与主窗解耦的验证点)
- 在主窗"设置→添加 API 供应商",保存。关掉主窗(隐藏到托盘),从托盘"显示主界面"重开,API 供应商列表保留(electron-store 持久化)。同时召唤 Quick Window,若有需要 apiConfig 的逻辑也能拿到最新值

- [ ] **Step 8: Commit**

```
git add src/main/stateBus.ts src/main/ipcHandlers.ts src/preload/index.ts src/preload/index.d.ts src/renderer/src/store/appStore.ts
git commit -m "feat: cross-window state broadcast bus for models and apiConfig"
```

---

### Task 6: 剪贴板召唤 MVP — 带文本召唤并自动注入

**Files:**
- Modify: `src/main/index.ts`
- Modify: `src/preload/index.ts`
- Modify: `src/preload/index.d.ts`
- Modify: `src/renderer/src/pages/QuickPage.tsx`

工作流:用户在外部应用 `Ctrl+C` → 按 `Ctrl+Shift+C` → 主进程 `clipboard.readText()` → 显示 Quick Window → `webContents.send('quick:inject-prompt', {text, action: 'raw'})` → QuickPage 收到后调 `cardRef.insertText(text)`(**不自动发送**,留给用户校对)。

- [ ] **Step 1: 在 `index.ts` 顶部 import `clipboard`**

```ts
import { app, BrowserWindow, globalShortcut, clipboard } from 'electron'
```

- [ ] **Step 2: 注册带文本召唤快捷键**

在 Task 3 注册的召唤快捷键之后追加:

```ts
const summonWithTextAccelerator = 'CommandOrControl+Shift+C'
const summonWithTextOk = globalShortcut.register(summonWithTextAccelerator, () => {
  const text = clipboard.readText().trim()
  const qw = getQuickWindow()
  if (!qw) return
  qw.show(); qw.focus()
  if (text) {
    // 略延迟以确保窗口可见 + Webview ready
    setTimeout(() => qw.webContents.send('quick:inject-prompt', { text, action: 'raw' }), 100)
  }
})
if (!summonWithTextOk) console.warn(`[Main] 带文本召唤快捷键注册失败: ${summonWithTextAccelerator}`)
```

- [ ] **Step 3: preload + d.ts**

`preload/index.ts`:
```ts
onQuickInject: (cb: (payload: { text: string; action: 'summarize'|'polish'|'translate'|'raw' }) => void) => {
  const handler = (_e: Electron.IpcRendererEvent, payload: { text: string; action: 'summarize'|'polish'|'translate'|'raw' }): void => cb(payload)
  ipcRenderer.on('quick:inject-prompt', handler)
  return () => { ipcRenderer.removeListener('quick:inject-prompt', handler) }
}
```

`preload/index.d.ts`:
```ts
onQuickInject: (cb: (payload: {text: string; action: 'summarize'|'polish'|'translate'|'raw'}) => void) => () => void
```

- [ ] **Step 4: 修改 `QuickPage.tsx` 监听注入事件**

在 `QuickPage` 函数体内增加:

```tsx
useEffect(() => {
  const unsub = window.api.onQuickInject(async ({ text, action }) => {
    if (!cardRef.current) return
    const prefixMap: Record<string, string> = {
      summarize: '请总结以下内容:\n\n',
      polish: '请润色以下文本:\n\n',
      translate: '请将以下内容翻译为中文:\n\n',
      raw: ''
    }
    const finalText = (prefixMap[action] ?? '') + text
    // 给 Webview 200ms 让其内部输入框焦点稳定
    await new Promise((r) => setTimeout(r, 200))
    await cardRef.current.insertText(finalText)
    // MVP 阶段不自动 send,让用户校对后手动发送
  })
  return unsub
}, [])
```

- [ ] **Step 5: lint + build**

- [ ] **Step 6: 在 `npm run dev` 验证**

- 在外部记事本输入"今天天气真好",`Ctrl+A` `Ctrl+C`
- 按 `Ctrl+Shift+C`,Quick Window 召唤,WebviewCard 输入框已含"今天天气真好"
- 不自动发送(用户可改可发)
- 剪贴板为空时仍召唤,只是不注入
- `Ctrl+Shift+C` 在某些应用是"打开开发者工具"或"复制",验证若注册失败时控制台有 warn(实施者按需降级到 `Ctrl+Shift+V`)

- [ ] **Step 7: Commit**

```
git add src/main/index.ts src/preload/index.ts src/preload/index.d.ts src/renderer/src/pages/QuickPage.tsx
git commit -m "feat: clipboard-based summon with text injection"
```

---

### Task 7: shortcutManager + 设置面板自定义快捷键

**Files:**
- Create: `src/main/shortcutManager.ts`
- Modify: `src/main/index.ts`
- Modify: `src/main/ipcHandlers.ts`
- Modify: `src/preload/index.ts`
- Modify: `src/preload/index.d.ts`
- Modify: `src/renderer/src/components/SettingsDrawer.tsx`

把 Task 3 / Task 6 中硬编码的快捷键迁移到 shortcutManager,并暴露设置 UI。

- [ ] **Step 1: 创建 `src/main/shortcutManager.ts`**

```ts
import { globalShortcut } from 'electron'
import type Store from 'electron-store'

export type ShortcutId = 'summon' | 'summonWithText'
export type ShortcutMap = Record<ShortcutId, string>

const DEFAULT_SHORTCUTS: ShortcutMap = {
  summon: 'CommandOrControl+Shift+Space',
  summonWithText: 'CommandOrControl+Shift+C'
}

const STORE_KEY = 'shortcuts'

const handlers: Record<ShortcutId, (() => void) | null> = {
  summon: null,
  summonWithText: null
}

export function setShortcutHandler(id: ShortcutId, handler: () => void): void {
  handlers[id] = handler
}

export function loadShortcuts(store: Store): ShortcutMap {
  const saved = store.get(STORE_KEY) as Partial<ShortcutMap> | undefined
  return { ...DEFAULT_SHORTCUTS, ...(saved ?? {}) }
}

export function registerAll(store: Store): { ok: boolean; failures: ShortcutId[] } {
  const map = loadShortcuts(store)
  const failures: ShortcutId[] = []
  for (const id of Object.keys(map) as ShortcutId[]) {
    const h = handlers[id]
    if (!h) continue
    if (!globalShortcut.register(map[id], h)) failures.push(id)
  }
  return { ok: failures.length === 0, failures }
}

export function updateShortcut(
  store: Store,
  id: ShortcutId,
  newAccelerator: string
): { success: boolean; error?: string } {
  const map = loadShortcuts(store)
  const oldAccelerator = map[id]
  const handler = handlers[id]
  if (!handler) return { success: false, error: 'no handler registered' }

  globalShortcut.unregister(oldAccelerator)
  if (!globalShortcut.register(newAccelerator, handler)) {
    globalShortcut.register(oldAccelerator, handler)
    return { success: false, error: '快捷键已被占用或无效' }
  }
  store.set(STORE_KEY, { ...map, [id]: newAccelerator })
  return { success: true }
}
```

- [ ] **Step 2: 在 `index.ts` 用 shortcutManager 替换硬编码**

删除 Task 3/6 中硬编码的 `globalShortcut.register('CommandOrControl+Shift+Space', ...)` 与 `'CommandOrControl+Shift+C'`,改为:

```ts
import { setShortcutHandler, registerAll } from './shortcutManager'

// ... 在 createTray() 之后

setShortcutHandler('summon', () => {
  const qw = getQuickWindow()
  if (!qw) return
  if (qw.isVisible()) qw.hide()
  else { qw.show(); qw.focus() }
})

setShortcutHandler('summonWithText', () => {
  const text = clipboard.readText().trim()
  const qw = getQuickWindow()
  if (!qw) return
  qw.show(); qw.focus()
  if (text) {
    setTimeout(() => qw.webContents.send('quick:inject-prompt', { text, action: 'raw' }), 100)
  }
})

const result = registerAll(store)
if (!result.ok) console.warn('[Main] 部分快捷键注册失败:', result.failures)
```

(`F5` / `CommandOrControl+R` 刷新快捷键保留独立的硬编码,不进 shortcutManager)

- [ ] **Step 3: 注册 IPC handler**

`ipcHandlers.ts` 顶部 import:
```ts
import { loadShortcuts, updateShortcut, type ShortcutId } from './shortcutManager'
```

handler:
```ts
ipcMain.handle('shortcut:get-all', () => {
  return { success: true, data: loadShortcuts(store) }
})
ipcMain.handle('shortcut:update', (_e, id: ShortcutId, accelerator: string) => {
  return updateShortcut(store, id, accelerator)
})
```

- [ ] **Step 4: preload + d.ts**

`preload/index.ts`:
```ts
shortcutGetAll: () => ipcRenderer.invoke('shortcut:get-all'),
shortcutUpdate: (id: 'summon'|'summonWithText', accelerator: string) =>
  ipcRenderer.invoke('shortcut:update', id, accelerator)
```

`preload/index.d.ts`:
```ts
shortcutGetAll: () => Promise<{success: boolean; data?: Record<'summon'|'summonWithText', string>; error?: string}>
shortcutUpdate: (id: 'summon'|'summonWithText', accelerator: string) => Promise<{success: boolean; error?: string}>
```

- [ ] **Step 5: 在 `SettingsDrawer.tsx` 增加"快捷键与系统托盘"分组**

在 SettingsDrawer 现有分组(API/外观/导出 等)同级位置追加。先在组件顶部增加 state + 加载:

```tsx
const [shortcuts, setShortcuts] = useState<{summon: string; summonWithText: string} | null>(null)

useEffect(() => {
  void window.api.shortcutGetAll().then((r) => {
    if (r.success && r.data) setShortcuts(r.data)
  })
}, [])

async function applyShortcut(id: 'summon' | 'summonWithText', value: string): Promise<void> {
  if (!shortcuts) return
  const r = await window.api.shortcutUpdate(id, value)
  if (!r.success) {
    alert(`更新失败: ${r.error ?? '未知错误'}`)
    // 回滚 UI
    void window.api.shortcutGetAll().then((rr) => {
      if (rr.success && rr.data) setShortcuts(rr.data)
    })
  } else {
    setShortcuts((s) => s ? { ...s, [id]: value } : s)
  }
}
```

UI(放在合适分组下,Tailwind 与项目其他分组保持一致):

```tsx
<div className="space-y-3">
  <div className="text-sm font-bold text-gray-200">快捷键与系统托盘</div>

  <div className="flex items-center gap-2">
    <label className="w-32 text-sm text-gray-400">召唤弹窗</label>
    <input
      value={shortcuts?.summon ?? ''}
      onChange={(e) => setShortcuts((s) => s ? { ...s, summon: e.target.value } : s)}
      className="flex-1 px-2 py-1 bg-gray-800 rounded text-sm font-mono"
      placeholder="CommandOrControl+Shift+Space"
    />
    <button
      onClick={() => shortcuts && void applyShortcut('summon', shortcuts.summon)}
      className="px-3 py-1 bg-primary rounded text-sm"
    >应用</button>
  </div>

  <div className="flex items-center gap-2">
    <label className="w-32 text-sm text-gray-400">带文本召唤</label>
    <input
      value={shortcuts?.summonWithText ?? ''}
      onChange={(e) => setShortcuts((s) => s ? { ...s, summonWithText: e.target.value } : s)}
      className="flex-1 px-2 py-1 bg-gray-800 rounded text-sm font-mono"
      placeholder="CommandOrControl+Shift+C"
    />
    <button
      onClick={() => shortcuts && void applyShortcut('summonWithText', shortcuts.summonWithText)}
      className="px-3 py-1 bg-primary rounded text-sm"
    >应用</button>
  </div>

  <p className="text-xs text-gray-500">
    Accelerator 语法见 Electron 文档:CommandOrControl/Alt/Shift + 字母数字。
    关闭主界面后按下快捷键可瞬时召唤精简会话窗口。
  </p>
</div>
```

具体插入位置参考 `SettingsDrawer.tsx` 现有分组分隔的 className(项目样式约定)。

- [ ] **Step 6: lint + build**

- [ ] **Step 7: 在 `npm run dev` 验证**

- 设置面板可见两条快捷键,默认值正确
- 把"召唤弹窗"改为 `Alt+W` 应用 → 立刻 `Alt+W` 能召唤,`Ctrl+Shift+Space` 失效
- 把"召唤弹窗"改为 `F5`(已被刷新占用 → 注册失败)→ 弹错误提示,UI 回滚到上一次值
- 完全退出应用并重启,自定义值持久化(electron-store 落盘)

- [ ] **Step 8: Commit**

```
git add src/main/shortcutManager.ts src/main/index.ts src/main/ipcHandlers.ts src/preload/index.ts src/preload/index.d.ts src/renderer/src/components/SettingsDrawer.tsx
git commit -m "feat: customizable global shortcuts in settings drawer"
```

---

## 4. 验收清单

完成全部 Task 后逐条核对(对应 §3 各 Task 的 dev 验证步骤):

- [ ] 关闭主窗后任务管理器仍有 MultiChat 进程,系统托盘出现图标
- [ ] 托盘菜单"显示主界面 / 召唤快捷弹窗 / 退出"三项均工作
- [ ] 托盘"退出"后进程消失,Ctrl+Shift+Space 在其他应用按下不会触发任何东西(`unregisterAll` 验证)
- [ ] 按 Ctrl+Shift+Space 召唤 Quick Window:无边框、置顶、800×600、共享 `persist:shared` Session(主窗已登录的 Gemini 在 Quick Window 中也是登录态)
- [ ] Quick Window 失焦自动隐藏,再按召唤键重新出现
- [ ] Quick Window 切换模型只影响自身,主窗模型不变;反之主窗启用/禁用模型,Quick Window 下拉同步
- [ ] 在外部应用 Ctrl+C 文本后按 Ctrl+Shift+C,Quick Window 召唤且输入框已含文本(剪贴板为空时仍召唤,只是不注入)
- [ ] 设置面板修改召唤快捷键并应用后立即生效;无效/被占用的快捷键报错且不破坏现有快捷键
- [ ] 重启应用后自定义快捷键持久化
- [ ] 整个改动只触动 main / preload / renderer,不触动 `out/`、`dist/`,不引入新的 npm 依赖,不引入 `any`,`npm run lint` 与 `npm run build` 全绿
- [ ] CHANGELOG.md 已按"HH:MM | feat: 路径 - 摘要"追加每个 Task 一条;TODO.md 项目新增需求三条已标记完成或拆分

## 5. 推迟到独立计划:全局划词悬浮 Toolbar

**为什么推迟。** 该特性需要监听全局鼠标事件并跨进程读取选中文本——Electron 内置 API 无法做到。可行路径只有:
1. `uiohook-napi`(C++ 扩展)+ 模拟 `Ctrl+C` + 剪贴板备份恢复
2. 平台原生 Accessibility API(macOS AX、Windows UIA、Linux AT-SPI)

任一路径都涉及:
- node-gyp / prebuild-install 跨平台编译
- 杀软误报 / macOS Accessibility 权限申请
- 剪贴板恢复保险机制
- CI 与打包流程要预编译三平台 native binary

这超出了本计划"零 C++ 依赖"的边界,需独立评估。本计划交付后 Task 6 的"剪贴板召唤"已能覆盖大部分场景:用户先 `Ctrl+C` → 按 `Ctrl+Shift+C` → 在 Quick Window 内手动选 Agent 提示词。

后续若决定做悬浮条,新计划应包含:
- `uiohook-napi` 集成与三平台编译验证
- ToolbarWindow 设计(`focusable: true` + `setIgnoreMouseEvents(true, {forward:true})` 在非按钮区透明)
- 剪贴板备份/恢复(避免污染用户原内容)
- macOS Accessibility 权限申请引导界面
- Windows Defender / 火绒 等杀软白名单文档

## 6. 风险与边界

| 风险 | 缓解 |
|---|---|
| `Ctrl+Shift+C` 与浏览器/终端"复制"冲突 | shortcutManager 注册失败时 console.warn,提示用户在设置面板改 |
| `Alt+Space` 在 Windows 是窗口控制菜单 | 默认值已避开,使用 `Ctrl+Shift+Space` |
| Quick Window blur 自动隐藏冲突 | `WebviewCard` 内的 webview 子内容焦点变化不会触发外层 BrowserWindow 的 `blur`(blur 仅当焦点离开整个 BrowserWindow 才触发);若实测有意外隐藏,在 QuickPage 暂时按下 `Esc` 时主动 `quickHide` 替代 |
| 状态广播回环 | `state:broadcast` 用 `event.sender.id` 排除发送方;接收端 `applyRemoteState` 用 `isApplyingRemote` 标志位避免触发 subscribe 又广播 |
| `frame: false` Quick Window 无关闭按钮 | 失焦自动隐藏 + 召唤键 toggle;Alt+F4 被 `close` 拦截转 `hide()`;真正销毁通过托盘"退出" |
| Tray 资源缺失导致启动失败 | `getTrayIconPath()` 在文件不存在时回退到 `assets/logo.png`,确保 `new Tray(...)` 不抛 |
| `state:remote-update` 在 store 未初始化时到达 | `subscribeRemoteState` 仅在 `initializeStore` 成功路径调用,早于此到达的事件丢弃;后续 setter 触发的广播会重放 |
| Quick Window 与主窗 React app 各自一个 Zustand 实例 | 已通过 §Task 5 的广播实现关键 state 同步;非关键 state(对话历史、临时输入)不广播以避免 IPC 风暴 |
| `subscribe(state, prev)` 签名差异 | 项目用 zustand v4,`subscribe(listener)` 接收 `(state, prevState) => void`。若实施时报类型错误,改用 `subscribe(selector, listener)` 形态(若已装 `subscribeWithSelector` middleware)或仅用 `subscribe(listener)` 内部手动做引用比较 |
| 主窗未 ready 时 broadcastState 报错 | `getMainWindow()?.webContents` 已用可选链,`undefined` 时 for 循环跳过 |

## 7. 实施约定(项目通用,从 CLAUDE.md 摘录)

- 每完成一个 Task,在 `CHANGELOG.md` 加一条 `HH:MM | feat: <文件路径> - <摘要>`(同一日按 `## YYYY-MM-DD` 分组)
- 提交信息走 Conventional Commits(`feat:` / `fix:` / `refactor:` 等)
- IPC 改动**必须** main + preload + `preload/index.d.ts` 三处同步,否则渲染层类型漂移
- 不写日志/不持久化 API key、cookie、token、用户内容
- TypeScript 严格,不引入 `any`;无意未使用变量前缀 `_`
- 验证 = `npm run lint` + `npm run build` + `npm run dev` 中按 §3 各 Task 的手动清单
