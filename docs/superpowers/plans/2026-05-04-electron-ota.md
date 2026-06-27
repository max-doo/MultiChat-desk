# Electron 自动更新(OTA)实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为 Windows NSIS 安装版引入 electron-updater 自动更新：启动静默检查、Settings Drawer 内展示更新状态、用户点击下载并重启安装。便携版与 macOS 优雅降级。

**Architecture:** 主进程新建 `src/main/updater/index.ts` 封装 electron-updater 生命周期与内存状态机，通过 IPC 单向推送状态到渲染端；渲染端在 Zustand store 维护 updater slice，由 `useUpdater` hook 在 App 根组件订阅；Settings Drawer 内挂载 `UpdateSection` 展示 UI。

**Tech Stack:** Electron 28, React 18, TypeScript, Zustand 4, electron-updater 6.x, electron-builder 24, Tailwind CSS 3

---

## 文件结构

| 文件 | 职责 |
|------|------|
| `src/main/updater/index.ts` | **新增** 主进程 updater 封装：autoUpdater 事件监听、状态机、对外 API |
| `src/main/ipcHandlers.ts` | **修改** 注册 4 个 updater IPC handler |
| `src/main/index.ts` | **修改** 启动时调用 `initUpdater(isPortableMode())` |
| `src/preload/index.ts` | **修改** 暴露 updater IPC 桥接方法 |
| `src/preload/index.d.ts` | **修改** `Window.api` 类型声明增加 updater API |
| `src/renderer/src/store/appStore.ts` | **修改** 增加 `updater` slice（含状态类型定义） |
| `src/renderer/src/hooks/useUpdater.ts` | **新增** 在 App 根组件挂载，订阅 IPC 状态变更并写入 store |
| `src/renderer/src/components/UpdateSection.tsx` | **新增** Settings Drawer 内的更新面板 UI |
| `src/renderer/src/components/SettingsDrawer.tsx` | **修改** 挂载 `<UpdateSection />` |
| `src/renderer/src/App.tsx` | **修改** 根组件挂载 `useUpdater()` |
| `electron-builder.yml` | **修改** 增加 `publish` 与 `differentialPackage` |

---

### Task 1: 安装 electron-updater

**Files:**
- Modify: `package.json`

- [ ] **Step 1: 安装依赖**

```bash
npm install electron-updater@^6
```

Expected: `package.json` 的 `dependencies` 中新增 `"electron-updater": "^6.x.x"`。

- [ ] **Step 2: Commit**

```bash
git add package.json package-lock.json
npm run build
```

Expected: `npm run build` 通过（无新增类型错误）。

```bash
git commit -m "chore: add electron-updater dependency

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: electron-builder.yml 配置

**Files:**
- Modify: `electron-builder.yml`

**上下文：** 新增 `publish` 配置使 electron-builder 自动生成 `latest.yml` 并支持上传到 GitHub Release；开启 `differentialPackage` 启用差量更新。

- [ ] **Step 1: 在 `electron-builder.yml` 末尾添加 publish 与差量配置**

找到文件末尾（portable 配置之后），添加：

```yaml
# ============ 自动更新配置 ============
publish:
  provider: github
  owner: max-doo
  repo: multichat

differentialPackage: true
```

- [ ] **Step 2: 确认便携版配置未被污染**

打开 `electron-builder-portable.yml`，确认其中**没有** `publish` 字段（该文件 `extends: electron-builder.yml`，但我们不需要它继承 publish，而它本身也没有 publish，符合要求）。

- [ ] **Step 3: Commit**

```bash
git add electron-builder.yml
git commit -m "chore: configure electron-builder publish and differential updates

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: 主进程 updater 模块

**Files:**
- Create: `src/main/updater/index.ts`

**上下文：** 封装 electron-updater 的全部生命周期。启动时若检测到便携版或 macOS，直接设 `disabled` 状态并跳过 autoUpdater 初始化。非便携 Windows 则监听所有事件，维护内存状态，并通过 callback 广播给 IPC handler。

- [ ] **Step 1: 创建 `src/main/updater/index.ts`**

```typescript
import { app } from 'electron'
import { autoUpdater } from 'electron-updater'

export interface UpdateInfo {
  version: string
  releaseDate: string
  releaseNotes?: string
}

export interface UpdateProgress {
  bytesPerSecond: number
  percent: number
  total: number
  transferred: number
}

export type UpdateStatus =
  | 'idle'
  | 'checking'
  | 'available'
  | 'downloading'
  | 'downloaded'
  | 'no-update'
  | 'error'
  | 'disabled'

export interface UpdateState {
  status: UpdateStatus
  currentVersion: string
  info?: UpdateInfo
  progress?: UpdateProgress
  error?: string
  disabledReason?: string
}

let currentState: UpdateState = {
  status: 'idle',
  currentVersion: app.getVersion()
}

const listeners = new Set<(state: UpdateState) => void>()

function setState(partial: Partial<UpdateState>): void {
  currentState = { ...currentState, ...partial }
  listeners.forEach(cb => cb(currentState))
}

export function getUpdateState(): UpdateState {
  return currentState
}

export function onUpdateStateChange(cb: (state: UpdateState) => void): () => void {
  listeners.add(cb)
  cb(currentState)
  return () => listeners.delete(cb)
}

export function initUpdater(isPortable: boolean): void {
  currentState.currentVersion = app.getVersion()

  if (isPortable) {
    setState({
      status: 'disabled',
      disabledReason: '当前为便携版，请前往 GitHub Releases 手动下载新版'
    })
    return
  }

  if (process.platform === 'darwin') {
    setState({
      status: 'disabled',
      disabledReason: 'macOS 需签名后启用自动更新'
    })
    return
  }

  autoUpdater.autoDownload = false

  autoUpdater.on('checking-for-update', () => {
    setState({ status: 'checking' })
  })

  autoUpdater.on('update-available', (info) => {
    setState({
      status: 'available',
      info: {
        version: info.version,
        releaseDate: info.releaseDate ?? '',
        releaseNotes: info.releaseNotes ?? undefined
      }
    })
  })

  autoUpdater.on('update-not-available', () => {
    setState({ status: 'no-update' })
  })

  autoUpdater.on('download-progress', (progressObj) => {
    setState({
      status: 'downloading',
      progress: {
        bytesPerSecond: progressObj.bytesPerSecond,
        percent: progressObj.percent,
        total: progressObj.total,
        transferred: progressObj.transferred
      }
    })
  })

  autoUpdater.on('update-downloaded', (info) => {
    setState({
      status: 'downloaded',
      info: {
        version: info.version,
        releaseDate: info.releaseDate ?? '',
        releaseNotes: info.releaseNotes ?? undefined
      }
    })
  })

  autoUpdater.on('error', (err) => {
    let errorMessage = err.message
    if (err.message.includes('net::')) {
      errorMessage = '检查更新失败，请检查网络连接'
    } else if (err.message.toLowerCase().includes('certificate')) {
      errorMessage = '安装包校验失败，建议重新下载'
    }
    setState({ status: 'error', error: errorMessage })
  })

  // 启动后延迟 8 秒自动检查
  setTimeout(() => {
    void autoUpdater.checkForUpdates()
  }, 8000)
}

export async function checkForUpdates(): Promise<{ success: boolean; error?: string }> {
  try {
    await autoUpdater.checkForUpdates()
    return { success: true }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return { success: false, error: message }
  }
}

export async function downloadUpdate(): Promise<{ success: boolean; error?: string }> {
  try {
    await autoUpdater.downloadUpdate()
    return { success: true }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return { success: false, error: message }
  }
}

export function quitAndInstall(): void {
  setImmediate(() => {
    autoUpdater.quitAndInstall(true, true)
  })
}
```

- [ ] **Step 2: Commit**

```bash
git add src/main/updater/index.ts
git commit -m "feat: add main process updater module

Wraps electron-updater lifecycle with typed state machine and event broadcasting.
Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: IPC handlers

**Files:**
- Modify: `src/main/ipcHandlers.ts`

**上下文：** 注册 updater 相关 IPC handler，并将状态变更广播到主窗口。`registerIpcHandlers` 已接收 `getMainWindow` 参数，可直接复用。

- [ ] **Step 1: 导入 updater 模块**

在 `src/main/ipcHandlers.ts` 顶部现有 import 之后添加：

```typescript
import {
  checkForUpdates,
  downloadUpdate,
  quitAndInstall,
  getUpdateState,
  onUpdateStateChange
} from './updater'
```

- [ ] **Step 2: 在 `registerIpcHandlers` 函数体内注册 updater handlers**

在函数体内、现有 IPC handler 注册之后（`registerIpcHandlers` 函数结束前）添加：

```typescript
  // ============ Updater IPC ============

  // 将 updater 状态变更广播到主窗口
  const unsubscribeUpdater = onUpdateStateChange((state) => {
    const win = getMainWindow()
    if (win && !win.isDestroyed()) {
      win.webContents.send('updater:state', state)
    }
  })

  ipcMain.handle('updater:check', async () => {
    try {
      return await checkForUpdates()
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  ipcMain.handle('updater:download', async () => {
    try {
      return await downloadUpdate()
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  ipcMain.handle('updater:install', async () => {
    // 先返回成功再退出，避免 renderer 收到 IPC 异常
    quitAndInstall()
    return { success: true }
  })

  ipcMain.handle('updater:getState', async () => {
    return { success: true, data: getUpdateState() }
  })
```

**注意：** `unsubscribeUpdater` 目前不需要主动调用（应用生命周期内持续有效），如果未来需要清理，可在 `app.on('will-quit')` 中执行。

- [ ] **Step 3: Commit**

```bash
git add src/main/ipcHandlers.ts
git commit -m "feat: register updater IPC handlers

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: Preload 桥接

**Files:**
- Modify: `src/preload/index.ts`
- Modify: `src/preload/index.d.ts`

- [ ] **Step 1: 在 `src/preload/index.d.ts` 添加类型声明**

在 `src/preload/index.d.ts` 中，找到 `GetFileInfoResult` 接口之后、`declare global` 之前，添加 updater 类型：

```typescript
interface UpdateInfo {
  version: string
  releaseDate: string
  releaseNotes?: string
}

interface UpdateProgress {
  bytesPerSecond: number
  percent: number
  total: number
  transferred: number
}

type UpdateStatus =
  | 'idle'
  | 'checking'
  | 'available'
  | 'downloading'
  | 'downloaded'
  | 'no-update'
  | 'error'
  | 'disabled'

interface UpdateState {
  status: UpdateStatus
  currentVersion: string
  info?: UpdateInfo
  progress?: UpdateProgress
  error?: string
  disabledReason?: string
}
```

然后在 `window.api` 接口内、现有 API 之后添加：

```typescript
      // 自动更新
      updaterCheck: () => Promise<{ success: boolean; error?: string }>
      updaterDownload: () => Promise<{ success: boolean; error?: string }>
      updaterInstall: () => Promise<{ success: boolean }>
      updaterGetState: () => Promise<{ success: boolean; data?: UpdateState; error?: string }>
      onUpdaterStateChange: (callback: (state: UpdateState) => void) => (() => void)
```

- [ ] **Step 2: 在 `src/preload/index.ts` 暴露 API**

在 `src/preload/index.ts` 的 `api` 对象中、现有 `onGeminiAccountSwitched` 之后添加：

```typescript
  // 自动更新
  updaterCheck: (): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke('updater:check'),
  updaterDownload: (): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke('updater:download'),
  updaterInstall: (): Promise<{ success: boolean }> =>
    ipcRenderer.invoke('updater:install'),
  updaterGetState: (): Promise<{ success: boolean; data?: UpdateState; error?: string }> =>
    ipcRenderer.invoke('updater:getState'),
  onUpdaterStateChange: (callback: (state: UpdateState) => void): (() => void) => {
    const listener = (_event: Electron.IpcRendererEvent, state: UpdateState) => callback(state)
    ipcRenderer.on('updater:state', listener)
    return () => {
      ipcRenderer.removeListener('updater:state', listener)
    }
  }
```

- [ ] **Step 3: Commit**

```bash
git add src/preload/index.ts src/preload/index.d.ts
git commit -m "feat: expose updater IPC bridge in preload

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: Main 进程启动初始化

**Files:**
- Modify: `src/main/index.ts`

**上下文：** 在 `app.whenReady()` 中调用 `initUpdater`，传入便携模式检测结果。需要在 `registerIpcHandlers` 之前调用（因为 updater 初始化不依赖 IPC，但 IPC handler 中的 `onUpdateStateChange` 需要在 `initUpdater` 之后才能收到状态变更）。

- [ ] **Step 1: 导入 initUpdater**

在 `src/main/index.ts` 顶部，现有 import 之后添加：

```typescript
import { initUpdater } from './updater'
```

- [ ] **Step 2: 在 `app.whenReady()` 中调用 `initUpdater`**

在 `src/main/index.ts` 的 `app.whenReady().then(() => {` 回调内，找到 `registerIpcHandlers` 调用，在其**之前**添加：

```typescript
  // 初始化自动更新模块（必须在 IPC handler 注册之前，以便状态机就绪）
  initUpdater(isPortableMode())
```

添加后的 `app.whenReady()` 内部顺序应为：
1. `void cleanupTempUploadDirs()`
2. `electronApp.setAppUserModelId(...)`
3. `initUpdater(isPortableMode())` ← 新增
4. `registerIpcHandlers(...)`
5. `createWindow()`
6. 全局快捷键注册

- [ ] **Step 3: Commit**

```bash
git add src/main/index.ts
git commit -m "feat: initialize updater on app startup

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 7: Zustand store — updater slice

**Files:**
- Modify: `src/renderer/src/store/appStore.ts`

**上下文：** 在 `AppState` 接口和 store 初始化中添加 `updater` 状态与 `setUpdaterState` action。

- [ ] **Step 1: 在 `appStore.ts` 中定义 updater 类型**

在文件顶部、现有类型定义之后（`ApiConfig` 接口之后即可），添加：

```typescript
// 自动更新状态类型
interface UpdateInfo {
  version: string
  releaseDate: string
  releaseNotes?: string
}

interface UpdateProgress {
  bytesPerSecond: number
  percent: number
  total: number
  transferred: number
}

export type UpdateStatus =
  | 'idle'
  | 'checking'
  | 'available'
  | 'downloading'
  | 'downloaded'
  | 'no-update'
  | 'error'
  | 'disabled'

export interface UpdateState {
  status: UpdateStatus
  currentVersion: string
  info?: UpdateInfo
  progress?: UpdateProgress
  error?: string
  disabledReason?: string
}
```

- [ ] **Step 2: 在 `AppState` 接口中添加 updater 字段**

在 `AppState` 接口末尾、现有最后一个字段（`setReportData`）之后添加：

```typescript
  // 自动更新
  updater: UpdateState
  setUpdaterState: (state: UpdateState) => void
```

- [ ] **Step 3: 在 store 初始化中设置默认值**

在 `useAppStore = create<AppState>((set, get) => ({` 的对象体内、现有字段之后、最后闭合之前，添加：

```typescript
  // 自动更新
  updater: {
    status: 'idle',
    currentVersion: ''
  },
  setUpdaterState: (updater) => set({ updater })
```

- [ ] **Step 4: Commit**

```bash
git add src/renderer/src/store/appStore.ts
git commit -m "feat: add updater slice to app store

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 8: useUpdater hook + App.tsx 挂载

**Files:**
- Create: `src/renderer/src/hooks/useUpdater.ts`
- Modify: `src/renderer/src/App.tsx`

**上下文：** `useUpdater` 在组件挂载时获取初始状态并订阅 IPC 推送，状态变更时写入 Zustand store。在 `App.tsx` 根组件调用，确保全局订阅。

- [ ] **Step 1: 创建 `src/renderer/src/hooks/useUpdater.ts`**

```typescript
import { useEffect } from 'react'
import { useAppStore } from '../store/appStore'

export function useUpdater(): void {
  const setUpdaterState = useAppStore((state) => state.setUpdaterState)

  useEffect(() => {
    // 获取初始状态（防止错过启动时 push 的 event）
    void window.api.updaterGetState().then((result) => {
      if (result.success && result.data) {
        setUpdaterState(result.data)
      }
    })

    // 订阅后续状态变更
    const unsubscribe = window.api.onUpdaterStateChange((state) => {
      setUpdaterState(state)
    })

    return unsubscribe
  }, [setUpdaterState])
}
```

- [ ] **Step 2: 在 `App.tsx` 中挂载 `useUpdater`**

在 `src/renderer/src/App.tsx` 中，找到 `function App(): JSX.Element {` 之后的第一行，添加：

```typescript
  useUpdater()
```

同时在文件顶部 import 区域添加：

```typescript
import { useUpdater } from './hooks/useUpdater'
```

- [ ] **Step 3: Commit**

```bash
git add src/renderer/src/hooks/useUpdater.ts src/renderer/src/App.tsx
git commit -m "feat: add useUpdater hook and mount in App root

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 9: UpdateSection 组件

**Files:**
- Create: `src/renderer/src/components/UpdateSection.tsx`

**上下文：** Settings Drawer 内的更新面板，根据 `updater` store 状态渲染不同 UI。复用项目已有 `react-markdown` 展示 release notes。

- [ ] **Step 1: 创建 `src/renderer/src/components/UpdateSection.tsx`**

```tsx
import { useState, useCallback } from 'react'
import { useAppStore, type UpdateState, type UpdateStatus } from '../store/appStore'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

const STATUS_LABELS: Record<UpdateStatus, string> = {
  idle: '当前已是最新版本',
  checking: '正在检查更新…',
  available: '发现新版本',
  downloading: '正在下载更新…',
  downloaded: '新版本已下载完成',
  'no-update': '当前已是最新版本',
  error: '更新失败',
  disabled: '自动更新不可用'
}

function formatBytes(bytes: number): string {
  return (bytes / 1024 / 1024).toFixed(1) + ' MB'
}

export default function UpdateSection(): JSX.Element {
  const updater = useAppStore((state) => state.updater)
  const [isChecking, setIsChecking] = useState(false)
  const [showNotes, setShowNotes] = useState(false)

  const handleCheck = useCallback(async () => {
    setIsChecking(true)
    const result = await window.api.updaterCheck()
    setIsChecking(false)
    if (!result.success && result.error) {
      console.error('[UpdateSection] 检查更新失败:', result.error)
    }
  }, [])

  const handleDownload = useCallback(async () => {
    const result = await window.api.updaterDownload()
    if (!result.success && result.error) {
      console.error('[UpdateSection] 下载失败:', result.error)
    }
  }, [])

  const handleInstall = useCallback(async () => {
    await window.api.updaterInstall()
  }, [])

  const handleOpenReleases = useCallback(() => {
    window.api.openBrowserWindow('https://github.com/max-doo/multichat/releases')
  }, [])

  const { status, currentVersion, info, progress, error, disabledReason } = updater

  const isActionLoading = status === 'checking' || status === 'downloading'

  return (
    <div className="space-y-3">
      <h3 className="font-medium text-gray-300">关于 / 更新</h3>

      <div className="p-4 rounded-lg bg-gray-800/50 border border-gray-700 space-y-3">
        {/* 当前版本 */}
        <div className="flex items-center justify-between text-sm">
          <span className="text-gray-400">当前版本</span>
          <span className="text-gray-200 font-mono">{currentVersion || '—'}</span>
        </div>

        {/* 状态文案 */}
        <div className="text-sm">
          <span className="text-gray-400">{STATUS_LABELS[status]}</span>
          {status === 'available' && info && (
            <span className="text-primary ml-1">v{info.version}</span>
          )}
          {status === 'error' && error && (
            <span className="text-red-400 ml-1">{error}</span>
          )}
          {status === 'disabled' && disabledReason && (
            <span className="text-gray-500 ml-1">{disabledReason}</span>
          )}
        </div>

        {/* 下载进度 */}
        {status === 'downloading' && progress && (
          <div className="space-y-1">
            <div className="w-full h-2 bg-gray-700 rounded-full overflow-hidden">
              <div
                className="h-full bg-primary rounded-full transition-all duration-300"
                style={{ width: `${progress.percent}%` }}
              />
            </div>
            <div className="flex justify-between text-xs text-gray-500">
              <span>{progress.percent.toFixed(1)}%</span>
              <span>
                {formatBytes(progress.transferred)} / {formatBytes(progress.total)}
              </span>
            </div>
          </div>
        )}

        {/* 操作按钮 */}
        <div className="flex items-center gap-2 flex-wrap">
          {(status === 'idle' || status === 'no-update' || status === 'error') && (
            <button
              type="button"
              onClick={handleCheck}
              disabled={isActionLoading || isChecking}
              className="px-3 py-1.5 rounded bg-gray-700 hover:bg-gray-600 text-gray-200 text-sm transition-colors disabled:opacity-50"
            >
              {isChecking ? '检查中…' : '检查更新'}
            </button>
          )}

          {status === 'available' && (
            <>
              <button
                type="button"
                onClick={handleDownload}
                disabled={isActionLoading}
                className="px-3 py-1.5 rounded bg-primary hover:bg-primary/90 text-black text-sm font-medium transition-colors disabled:opacity-50"
              >
                下载更新
              </button>
              <button
                type="button"
                onClick={handleOpenReleases}
                className="px-3 py-1.5 rounded border border-gray-600 text-gray-300 text-sm hover:bg-gray-700 transition-colors"
              >
                去 GitHub 查看
              </button>
            </>
          )}

          {status === 'downloaded' && (
            <button
              type="button"
              onClick={handleInstall}
              className="px-3 py-1.5 rounded bg-primary hover:bg-primary/90 text-black text-sm font-medium transition-colors"
            >
              立即安装并重启
            </button>
          )}

          {status === 'disabled' && (
            <button
              type="button"
              onClick={handleOpenReleases}
              className="px-3 py-1.5 rounded border border-gray-600 text-gray-300 text-sm hover:bg-gray-700 transition-colors"
            >
              前往下载
            </button>
          )}
        </div>

        {/* Release Notes */}
        {info?.releaseNotes && (status === 'available' || status === 'downloaded') && (
          <div className="border-t border-gray-700 pt-2">
            <button
              type="button"
              onClick={() => setShowNotes((v) => !v)}
              className="text-xs text-primary hover:underline flex items-center gap-1"
            >
              <span className="material-symbols-outlined text-sm">
                {showNotes ? 'expand_less' : 'expand_more'}
              </span>
              {showNotes ? '收起更新说明' : '查看更新说明'}
            </button>
            {showNotes && (
              <div className="mt-2 text-sm text-gray-300 prose prose-invert prose-sm max-w-none">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>
                  {info.releaseNotes}
                </ReactMarkdown>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add src/renderer/src/components/UpdateSection.tsx
git commit -m "feat: add UpdateSection component for Settings Drawer

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 10: SettingsDrawer 集成

**Files:**
- Modify: `src/renderer/src/components/SettingsDrawer.tsx`

**上下文：** 在 SettingsDrawer 的可滚动内容区域内、模型排序 section 之后、底部固定区域之前，挂载 `<UpdateSection />`。

- [ ] **Step 1: 导入 UpdateSection**

在 `src/renderer/src/components/SettingsDrawer.tsx` 顶部现有 import 之后添加：

```typescript
import UpdateSection from './UpdateSection'
```

- [ ] **Step 2: 在 scrollable content 区域内插入 UpdateSection**

找到模型排序 section 的闭合位置（代码中 `{/* 模型排序 */}` section 结束后的 `</div>`，即关闭 `space-y-2` div 的那一行），在其**之后**、底部固定区域（`{/* 底部固定区域 */}`）**之前**，插入：

```tsx
          {/* 关于 / 更新 */}
          <UpdateSection />
```

插入后的结构示意（非完整代码）：

```tsx
          </div>  {/* 模型排序 space-y-2 闭合 */}

          {/* 关于 / 更新 */}
          <UpdateSection />

        </div>  {/* flex-1 overflow-y-auto 闭合 */}

        {/* 底部固定区域 */}
```

- [ ] **Step 3: Commit**

```bash
git add src/renderer/src/components/SettingsDrawer.tsx
git commit -m "feat: mount UpdateSection in SettingsDrawer

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 11: 验证

- [ ] **Step 1: ESLint 检查**

```bash
npm run lint
```

Expected: 无错误，无新增 warning（现有 warning 可忽略）。

- [ ] **Step 2: TypeScript 构建检查**

```bash
npm run build
```

Expected: 构建成功，`out/` 目录生成，无类型错误。

- [ ] **Step 3: 开发环境手动验证**

```bash
npm run dev
```

验证场景：

1. **便携模式验证**
   - 在 `build/portable.txt` 存在的前提下运行（或手动在 `src/main/index.ts` 中临时强制 `isPortableMode()` 返回 `true`）
   - 打开 Settings Drawer → 查看「关于/更新」
   - 预期：显示「当前为便携版，请前往 GitHub Releases 手动下载新版」+「前往下载」按钮

2. **非便携模式 — 检查更新**
   - 正常启动（确保不是便携模式）
   - 打开 Settings Drawer → 等待约 8 秒或点击「检查更新」
   - 预期：状态从 `idle` → `checking` → `no-update`（如果当前已是最新版）或 `available`（如果 GitHub 上有更高版本）

3. **版本降级触发真实检测（可选）**
   - 临时修改 `package.json` 的 `version` 为 `0.0.1`
   - 重新 `npm run dev`
   - 预期：启动后检测到 GitHub 上 `v1.0.0`，状态变为 `available`，显示新版本信息和「下载更新」按钮
   - **测试完成后务必恢复版本号**

4. **下载流程（仅在版本降级测试时）**
   - 点击「下载更新」
   - 预期：状态变为 `downloading`，显示进度条
   - 下载完成后状态变为 `downloaded」，显示「立即安装并重启」按钮

- [ ] **Step 4: 如有修复则 commit**

```bash
git add -A
git commit -m "fix: address lint/build issues from OTA implementation

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## 自审查

### Spec 覆盖检查

| Spec 要求 | 对应 Task |
|-----------|-----------|
| NSIS-only 自动更新 | Task 3 (`process.platform === 'darwin'` 和 `isPortable` 均设 `disabled`) |
| GitHub Releases 源 | Task 2 (`publish: github`) |
| 启动静默检查 | Task 3 (`setTimeout(..., 8000)` + `autoUpdater.checkForUpdates()`) |
| 点击后才下载 (`autoDownload: false`) | Task 3 (`autoUpdater.autoDownload = false`) |
| Settings Drawer 着陆 | Task 9 + Task 10 (`UpdateSection` 组件 + `SettingsDrawer` 挂载) |
| 状态机完整 | Task 3 (idle → checking → available/downloading/downloaded/error/no-update/disabled) |
| 差量更新 | Task 2 (`differentialPackage: true`) |
| 便携版优雅降级 | Task 3 (`isPortable` → `disabled` + `disabledReason`) |
| macOS 未签名处理 | Task 3 (`darwin` → `disabled` + 提示) |
| Release notes 展示 | Task 9 (`react-markdown` 折叠面板) |
| IPC 契约 | Task 4 + Task 5 (4 个 invoke handler + 1 个单向 push) |
| Zustand store slice | Task 7 (`updater` + `setUpdaterState`) |
| useUpdater hook 全局订阅 | Task 8 (App.tsx 挂载) |
| 错误分类与友好提示 | Task 3 (`error` 事件 listener 中的 message 映射) |

### Placeholder 扫描

无 TBD、TODO、"implement later"、"add appropriate error handling"、"Similar to Task N"。

### 类型一致性检查

- `UpdateState` / `UpdateStatus` / `UpdateInfo` / `UpdateProgress` 类型在以下位置一致：
  - `src/main/updater/index.ts`（主进程定义）
  - `src/preload/index.d.ts`（渲染端类型声明）
  - `src/renderer/src/store/appStore.ts`（store 内联定义 + 导出）
- IPC handler 名：`updater:check` / `updater:download` / `updater:install` / `updater:getState` / `updater:state`
  - main (Task 4)、preload (Task 5)、renderer hook (Task 8)、组件 (Task 9) 全部对齐
- `quitAndInstall` 调用方式：Task 3 定义 `setImmediate(() => autoUpdater.quitAndInstall(true, true))`，Task 4 handler 直接调用 `quitAndInstall()`
