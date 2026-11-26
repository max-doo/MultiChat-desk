# Electron 自动更新(OTA)设计

## 背景

当前 MultiChat 通过 electron-builder 发布三种发行物：Windows NSIS 安装版、Windows 便携 ZIP、macOS DMG。用户获取新版本完全依赖手动前往 GitHub Releases 下载重装，体验不佳。本设计在仅覆盖 NSIS 安装版的前提下，引入 electron-updater 实现应用内自动检测、下载、安装更新。

## 目标

- NSIS 安装版启动后自动静默检查是否有新版本
- 检测到新版本时，在 Settings Drawer 的「关于/更新」区块展示版本信息与操作按钮
- 用户主动点击「下载更新」后，展示下载进度
- 下载完成后用户点击「立即安装并重启」，应用退出并由 NSIS 静默安装，完成后自动重启
- 便携版与 macOS 版本在 UI 层面优雅降级（显示对应提示而非报错）
- 启用 electron-builder 差量更新(blockmap)，减少带宽消耗

## 非目标

- 不覆盖便携版 ZIP（electron-updater 不支持 ZIP 自动更新）
- 不覆盖 macOS DMG 自动更新（当前 macOS 未签名，electron-updater 要求 Apple Developer ID 签名）
- 不引入 release channel（stable/beta）概念，当前只有单一稳定通道
- 不在主界面显示顶部横幅或弹窗通知，所有更新信息仅在 Settings Drawer 中
- 不实现下载断点续传（electron-updater 本身不支持）

## 架构概览

```
┌─────────────────────────────────────────────────────────┐
│                    Renderer (React)                      │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────┐ │
│  │ UpdateSection │──│ useUpdater │──│ appStore.updater │ │
│  │(SettingsDrawer)│  │   (hook)   │  │ (Zustand slice) │ │
│  └─────────────┘  └─────────────┘  └─────────────────┘ │
└──────────────────────────┬──────────────────────────────┘
                           │ IPC (typed bridge)
┌──────────────────────────┼──────────────────────────────┐
│              Main Process (Node.js/Electron)              │
│  ┌───────────────────────┴─────────────────────────────┐ │
│  │              src/main/updater/index.ts               │ │
│  │  - autoUpdater 生命周期封装                          │ │
│  │  - 状态机: idle → checking → available              │ │
│  │          → downloading → downloaded → error          │ │
│  │  - emit('updater:state', state) 给渲染进程           │ │
│  └──────────────────────────────────────────────────────┘ │
│                    ▲                                     │
│     ┌──────────────┴──────────────┐                     │
│     │  src/main/ipcHandlers.ts     │                     │
│     │  - 'updater:check'           │                     │
│     │  - 'updater:download'        │                     │
│     │  - 'updater:install'         │                     │
│     │  - 'updater:getState'        │                     │
│     │  - 'updater:onState' (sub)   │                     │
│     └──────────────────────────────┘                     │
└─────────────────────────────────────────────────────────┘
                          ▲
                          │ GitHub Releases (latest.yml)
```

## 新增文件

- `src/main/updater/index.ts` — 主进程 updater 封装层
- `src/renderer/src/hooks/useUpdater.ts` — 渲染端事件订阅 hook
- `src/renderer/src/components/UpdateSection.tsx` — SettingsDrawer 内更新面板

## 改动文件

- `src/main/ipcHandlers.ts` — 注册 updater IPC handlers
- `src/main/index.ts` — 启动时调用 `initUpdater(isPortableMode())`
- `src/preload/index.ts` — 暴露 updater IPC 桥接方法
- `src/preload/index.d.ts` — 补充 `Window.api` 类型
- `src/renderer/src/store/appStore.ts` — 添加 `updater` slice
- `src/renderer/src/components/SettingsDrawer.tsx` — 挂载 UpdateSection
- `electron-builder.yml` — 增加 `publish` 与 `differentialPackage`

## IPC 契约

### 类型定义

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

### Window.api 新增

```typescript
window.api: {
  // ... existing APIs ...
  updaterCheck: () => Promise<{ success: boolean; error?: string }>
  updaterDownload: () => Promise<{ success: boolean; error?: string }>
  updaterInstall: () => Promise<void>
  updaterGetState: () => Promise<UpdateState>
  onUpdaterStateChange: (cb: (state: UpdateState) => void) => () => void
}
```

### IPC 通道映射

| 通道 | 方向 | 行为 |
|------|------|------|
| `updater:check` | R → M | 触发 `checkForUpdates()` |
| `updater:download` | R → M | 触发 `downloadUpdate()` |
| `updater:install` | R → M | 触发 `quitAndInstall()`（handler 先返回 `{success:true}` 再退出） |
| `updater:getState` | R → M | 获取当前状态快照 |
| `updater:onState` | M → R | 订阅/取消订阅状态变更事件 |

## 状态机

```
          ┌─────────┐
          │  init   │ ← 便携版/macOS → status = 'disabled'
          └────┬────┘
               │
           ┌───▼────┐   ┌─────────┐
           │ 'idle' │──▶│'checking'│ (startup delay / 手动检查)
           └───┬────┘   └────┬────┘
               │             │
               │   ┌─────────┴─────────┐
               │   ▼                   ▼
               │ 'available'      'no-update'
               │ (有新版本)        (已是最新)
               │
               │     用户点击「下载」
               ▼
          'downloading'  ← downloadProgress
               │
               ▼
          'downloaded'   ← update-downloaded
               │
               │  用户点击「安装」
               ▼
          quitAndInstall()
               │
               ▼
          进程退出，NSIS 静默安装 → 自动重启
```

每次状态跃迁都通过 `updater:onState` 推送到渲染端。

## 数据流

1. `src/main/index.ts` 在 `app.whenReady()` 中调用 `initUpdater(isPortableMode())`
2. 若为非便携 Windows：
   - 配置 `autoUpdater` feedURL（由 electron-builder `publish` 自动注入）
   - 设置 `autoDownload: false`
   - 延迟 8 秒自动执行 `checkForUpdates()`
3. `updater/index.ts` 监听 `autoUpdater` 全部事件 → 维护内存状态 → 主动 `BrowserWindow.webContents.send('updater:state', state)`
4. 渲染端 `useUpdater` 通过 `onUpdaterStateChange` 订阅 → 写入 `appStore.updater` slice
5. `SettingsDrawer` 渲染时无条件挂载 `UpdateSection`；`UpdateSection` 读 `appStore.updater` 决定 UI

## UpdateSection UI 状态映射

| 状态 | 展示文案 | 交互 |
|------|---------|------|
| `idle` / `no-update` | 当前已是最新版本 vX.Y.Z | 「检查更新」按钮 |
| `checking` | 正在检查更新… | spinner，不可点击 |
| `available` | 发现新版本 vX.Y.Z（当前 vA.B.C） | 「下载更新」+ 链接"去 GitHub 查看" |
| `downloading` | 正在下载… X%（X MB / X MB） | 进度条 |
| `downloaded` | 新版本已下载完成 | 「立即安装并重启」 |
| `error` | 更新失败：{友好提示} | 「重试」按钮 |
| `disabled` | {disabledReason} | 「前往下载」外链（如适用） |

若 `info.releaseNotes` 非空，在状态为 `available` 或 `downloaded` 时展开折叠面板展示（复用项目已有 `react-markdown`）。

## 主进程模块 API

```typescript
// src/main/updater/index.ts

export function initUpdater(isPortable: boolean): void
export function checkForUpdates(): Promise<{ success: boolean; error?: string }>
export function downloadUpdate(): Promise<{ success: boolean; error?: string }>
export function quitAndInstall(): void
export function getUpdateState(): UpdateState
export function onUpdateStateChange(
  cb: (state: UpdateState) => void
): () => void
```

## 构建配置

`electron-builder.yml` 新增：

```yaml
publish:
  provider: github
  owner: max-doo
  repo: multichat

differentialPackage: true
```

便携版配置文件 `electron-builder-portable.yml` **不**设置 `publish`，避免旧客户端通过 `latest.yml` 误扫到便携版包。

## 发版流程

1. 开发者在本地确认所有修改已合并到发布分支
2. `git tag v1.1.0` 并 `git push origin v1.1.0`
3. 本地执行 `npm run build:win:nsis`
   - 或带自动发布：`npx electron-builder --win nsis --publish always --config electron-builder.yml`
4. electron-builder 自动创建/更新 GitHub Release 并上传 `latest.yml` + `.exe` + `.exe.blockmap`
5. 已安装的旧版客户端在下次启动时检测到新版本，进入 `available` 状态

## 错误处理

| 场景 | 判定方式 | 友好提示 | 前端行为 |
|------|---------|---------|---------|
| 网络断开/超时 | `error.message.includes('net::')` | 检查更新失败，请检查网络连接 | 保持 `error` 状态，可重试 |
| GitHub API 限流 | 403 | 访问更新服务器受限，请稍后再试 | 同上 |
| 下载取消 | user cancellation | 下载已取消 | 回退 `available` |
| 签名/校验失败 | `error.message` 包含 certificate/nsis | 安装包校验失败，建议重新下载 | 回退 `idle` |
| 便携版 | `isPortableMode()` | 当前为便携版，请前往 GitHub Releases 手动下载新版 | `disabled` |
| macOS 未签名 | `process.platform === 'darwin'` | macOS 需签名后启用自动更新 | `disabled` |
| 其他 | catch-all | 更新失败：{原始错误} | 可重试 |

## 验证方式

- `npm run lint` 无错误无警告
- `npm run build` 通过
- 手动验证 `npm run dev`：
  - 便携模式：打开 Settings，确认显示"便携版"提示
  - 非便携模式：Settings 里点击「检查更新」，观察状态流转（可临时将 `package.json` version 降一级如 `0.9.0` 以触发真实检测）
