# 更新提醒后台检查机制设计

> Created: 2026-07-18 13:32 (UTC+08:00)
> Updated: 2026-07-18 14:26 (UTC+08:00)

## 背景

MultiChat-desk 当前的「检查新版本」按钮只会打开 GitHub Releases 页面，无法判断是否真的存在新版本。本次实现的是轻量更新提醒，而不是自动下载或安装：应用启动后后台低频查询 GitHub 最新正式 Release，发现新版本后在设置抽屉的更新卡片上显示提醒，用户再手动打开发布页下载。

## 目标

- 应用启动后在主进程后台检查 GitHub 最新正式 Release。
- 使用现有 `electron-store` 持久化检查结果，默认 24 小时内不重复请求。
- 设置抽屉打开时立即显示已缓存的检查结果；后台检查完成后可实时刷新提醒。
- 用户可点击「重新检查」绕过缓存，主动发起一次检查。
- 发现更新时显示最新版本号，并提供「前往下载」外链。
- 有更新时在顶部「设置」按钮显示红点，并在设置抽屉、历史记录抽屉的 logo 处显示可点击的 `NEW` 标签。
- 网络失败不阻塞应用启动，也不清除上一次成功的更新结果。

## 非目标

- 不引入 `electron-updater`。
- 不自动下载、校验、安装、重启或替换应用文件。
- 不显示启动弹窗，不在主界面展示更新横幅。
- 不增加 release channel、预发布版本或增量包逻辑。
- 不修改 electron-builder 配置和发布流程。

## 方案选择

### 推荐方案：主进程后台检查 + electron-store 缓存 + IPC 状态推送

检查由主进程负责，避免依赖设置抽屉或 React 生命周期。主进程在 `app.whenReady()` 后延迟约 3 秒调度检查，减少启动阶段网络和 CPU 竞争；检查结果写入现有配置存储，安装版与便携版自然沿用各自的数据目录。

渲染层挂载 `AboutSection` 时先通过 IPC 读取缓存，并订阅后台状态变化。这样既能覆盖“后台检查已经完成后才打开设置”的场景，也能覆盖“设置已打开、后台检查随后完成”的场景。

### 不采用的方案

- 仅在打开设置时检查：无法真正后台检查，且 UI 生命周期会决定网络请求时机。
- 仅打开 Releases 页面：无法知道是否有新版本，不能提供可靠提醒。

## 数据模型与缓存策略

主进程维护结构化状态：

```typescript
interface UpdateResult {
  hasUpdate: boolean
  currentVersion: string
  latestVersion: string
  releaseUrl: string
}

interface UpdateState {
  status: 'idle' | 'checking' | 'ready' | 'error'
  result?: UpdateResult
  lastAttemptAt?: number
  lastSuccessAt?: number
  error?: string
}
```

缓存写入现有 `electron-store` 的独立键，不与用户设置或缓存导入导出字段混用。保存 `lastAttemptAt`、`lastSuccessAt`、最近一次成功的 `result`，失败时保留原有 `result`，避免一次网络波动让已经发现的更新提醒消失。

后台检查规则：

1. 启动后延迟约 3 秒执行。
2. 若 `lastAttemptAt` 距当前时间小于 24 小时，则跳过网络请求，直接使用缓存。
3. 超过 24 小时则请求 `https://api.github.com/repos/max-doo/MultiChat-desk/releases/latest`。
4. 用户点击「重新检查」时强制请求，但同一时间只允许一个请求在途。
5. 版本只接受 `X.Y.Z` 或 `vX.Y.Z`，按 major/minor/patch 数值比较；GitHub `latest` 接口本身只返回正式 Release。

## 主进程与 IPC

新增 `src/main/updater/checker.ts`，负责：

- 获取 `app.getVersion()`；
- 调用 GitHub API，携带 `User-Agent: MultiChat-Desk`；API 403 限流时回退到 GitHub `/releases/latest` 重定向页面获取正式 Release tag；
- 使用 10 秒 `AbortController` 超时；
- 校验响应字段与版本号；
- 统一返回 `{ success, data?, error? }`，不向 IPC 外抛网络错误；
- 管理缓存、低频调度和状态广播。

新增 IPC：

| 通道 | 方向 | 用途 |
|---|---|---|
| `update:get-state` | Renderer → Main | 读取当前缓存状态 |
| `update:check` | Renderer → Main | 强制检查并返回最新状态 |
| `update:on-state` | Main → Renderer | 后台检查完成或状态改变时推送 |

同步修改 `src/main/ipcHandlers.ts`、`src/preload/index.ts`、`src/preload/index.d.ts` 与 `src/renderer/src/env.d.ts`，保持 preload 只做安全桥接，renderer 不直接请求 GitHub。

主进程在后台检查完成后向主窗口发送状态；如果主窗口尚未创建或当前没有可用的 renderer，则只保留持久化缓存，下一次 `update:get-state` 负责补读。

## 设置抽屉交互

沿用现有 `AboutSection` 挂载位置，并将更新状态同步到顶部和抽屉入口：

- 更新卡片采用单行布局，版本文字、状态文字和操作按钮保持在同一行。
- 初始态、无更新或失败态：显示「检查更新」/「重试」按钮。
- 检查中：按钮禁用，显示「检查中…」。
- 有更新：更新卡片只显示「前往下载」，不再显示没有意义的「检查更新」按钮；打开 `releaseUrl` 到默认浏览器。
- 顶部「设置」按钮显示红点；设置抽屉和历史记录抽屉的 logo 旁显示 `NEW`，点击 logo 区域打开同一个 `releaseUrl`。
- `src/renderer/src/hooks/useUpdateState.ts` 统一读取缓存并订阅状态推送，避免各入口自行维护更新状态。
- 失败：显示友好错误和「重试」按钮；如果已有缓存的更新结果，继续保留「有新版本」提醒。

不显示启动弹窗，不自动打开浏览器。所有红点和 `NEW` 标签都来自主进程实际检查结果。

## 错误处理与安全边界

- 网络异常、超时或 GitHub API 与 latest 页面均不可用：返回友好错误，应用继续工作；API 单独 403 时优先走 latest 页面回退，不立即判定失败。
- 响应缺少 `tag_name` 或 `html_url`、版本格式异常：视为检查失败。
- API 成功后才更新成功时间和结果缓存。
- 外链仅使用 API 返回的 HTTPS GitHub Release URL，打开动作继续走现有 `openBrowserWindow` 主进程入口。
- 不使用 GitHub Token，不把凭据写入应用。

## 验证计划

- `npm run lint`：确认 TypeScript/ESLint 与 IPC 类型同步。
- `npm run build`：确认 main/preload/renderer 构建通过。
- `npm run dev` 手动验证：
  1. 启动应用后打开设置，确认当前版本显示且无更新时显示最新状态。
  2. 将本地版本临时改为低版本或用可控的检查数据验证「发现新版本」提醒、版本号和 Release 外链；验证后恢复版本。
  3. 重启应用，确认 24 小时缓存不会重复请求，并能直接显示上次状态。
  4. 点击「重新检查」，确认按钮进入检查中状态并更新结果。
  5. 断网或模拟请求失败，确认应用不阻塞、错误可重试且已有更新缓存不消失。
- `git diff --check`：确认文档和代码无空白错误。
- 有更新状态下手动确认：设置卡片只显示「前往下载」；顶部设置按钮有红点；设置抽屉和历史记录抽屉 logo 均显示 `NEW` 且可打开发布页。

## 影响范围

预计新增/修改：

- 新增：`src/main/updater/checker.ts`
- 修改：`src/main/index.ts`、`src/main/ipcHandlers.ts`
- 修改：`src/preload/index.ts`、`src/preload/index.d.ts`、`src/renderer/src/env.d.ts`
- 新增：`src/renderer/src/hooks/useUpdateState.ts`
- 修改：`src/renderer/src/components/AboutSection.tsx`、`src/renderer/src/components/Layout.tsx`
- 修改：`src/renderer/src/components/SettingsDrawer.tsx`、`src/renderer/src/components/HistoryDrawer.tsx`

保留当前工作树中与本功能无关的 `HistoryDrawer.tsx`、`SettingsDrawer.tsx` 头部尺寸改动。
