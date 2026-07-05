# 更新提醒 OTA MVP 设计（纯提醒版）

> Created: 2026-07-05 12:04 (UTC+08:00)

## 背景

当前 MultiChat 通过 electron-builder 发布三种发行物：Windows NSIS 安装版、Windows 便携 ZIP、macOS DMG。用户获取新版本完全依赖手动前往 GitHub Releases 查看与下载，应用内无任何更新感知能力。

本设计在**最低成本**前提下引入"更新提醒"：在 Settings Drawer 的「关于」区块，将「使用说明」与「检查更新」放在一起。用户主动点击后，应用查询 GitHub Releases 最新版本，与本地版本对比，发现新版本即提示并提供跳转下载外链。

## 目标

- Settings Drawer 内新增「关于」区块，集中放置当前版本号、使用说明入口、检查更新入口
- 用户点击「检查更新」后，查询 GitHub Releases 最新版本并与本地版本对比
- 发现新版本时显示新版号并提供「前往下载」外链（跳转默认浏览器到 Release 页面）
- 无新版本 / 检查失败时给出对应友好提示，可重试
- 全平台一致行为：NSIS 安装版、便携版、macOS 均只做"提醒"，不涉及自动下载或安装

## 非目标

- **不引入 electron-updater**，不做自动下载、进度条、自动安装、重启
- **不修改打包配置**：不新增 `publish` 字段，不生成 `latest.yml`，不改动发版流程
- **不做启动自动检查**：仅用户手动点击触发，避免后台打扰与 GitHub API 限流压力
- **不引入 release channel**（stable/beta）概念
- **不实现半自动/全自动 OTA**：`2026-05-04-electron-ota-design.md` 所述的 electron-updater 半自动方案作为未来升级路径保留，本次不实施
- 不在主界面显示顶部横幅或弹窗通知，所有信息仅在 Settings Drawer「关于」区块内

## 与既有 OTA 文档的关系

仓库已存在 `docs/superpowers/specs/2026-05-04-electron-ota-design.md`（半自动 electron-updater 方案）及其配套实施计划，但**尚未实施**（`src/main/updater/` 目录不存在）。本 MVP 与之互不冲突：

- 本设计走"纯 fetch + 提醒"路线，零打包改动、零新依赖（除复用现有 `react-markdown`）
- 旧设计走"electron-updater + 自动下载安装"路线，依赖 `publish` 配置与 NSIS 自动更新
- 两者为同一功能的不同实现档次；本 MVP 先落地，旧方案作为后续升级路径保留

为避免与旧方案文件混淆，本设计的主进程文件命名为 `src/main/updater/checker.ts`（旧方案假设的是 `src/main/updater/index.ts`）。两者不会同时存在。

## 架构概览

```
┌─────────────────────────────────────────────────┐
│                 Renderer (React)                │
│  ┌───────────────┐                              │
│  │  AboutSection │  本地 useState 管理检查状态   │
│  │ (SettingsDrawer)│                            │
│  └───────┬───────┘                              │
└──────────┼──────────────────────────────────────┘
           │ window.api.updateCheck()
┌──────────┼──────────────────────────────────────┐
│          ▼          Main Process (Electron)     │
│  ┌────────────────────────────────────────────┐ │
│  │        src/main/updater/checker.ts         │ │
│  │  - fetch GitHub Releases API              │ │
│  │  - semver 数值比较                        │ │
│  │  - 返回结构化 UpdateCheckResult           │ │
│  └────────────────▲───────────────────────────┘ │
│                   │                              │
│     ┌─────────────┴──────────────┐               │
│     │  src/main/ipcHandlers.ts    │              │
│     │  - 'update:check' (invoke)  │              │
│     └────────────────────────────┘               │
└──────────────────────────────────────────────────┘
                          │
                          ▼
              GitHub Releases API
   https://api.github.com/repos/max-doo/multichat/releases/latest
```

## 新增文件

- `src/main/updater/checker.ts` — 主进程更新检查器：fetch GitHub API + 版本比较 + 结构化返回
- `src/renderer/src/components/AboutSection.tsx` — Settings Drawer 内「关于」区块 UI

## 改动文件

- `src/main/ipcHandlers.ts` — 注册 `update:check` IPC handler
- `src/preload/index.ts` — 暴露 `updateCheck()` 桥接方法
- `src/preload/index.d.ts` — 补充 `UpdateCheckResult` 类型与 `window.api.updateCheck` 声明
- `src/renderer/src/components/SettingsDrawer.tsx` — 挂载 `<AboutSection />`

## IPC 契约

### 类型定义

```typescript
interface UpdateCheckResult {
  hasUpdate: boolean
  currentVersion: string   // 去 v 前缀，如 "1.1.0"
  latestVersion: string    // 去 v 前缀，如 "1.2.0"
  releaseUrl: string       // GitHub Release HTML 页面 URL
  releaseNotes?: string    // Release body（markdown 原文），可能为空
}
```

### Window.api 新增

```typescript
window.api: {
  // ... existing APIs ...
  updateCheck: () => Promise<{ success: boolean; data?: UpdateCheckResult; error?: string }>
}
```

### IPC 通道映射

| 通道 | 方向 | 行为 |
|------|------|------|
| `update:check` | R → M | 调用 `checkForUpdate()`，返回 `{ success, data?, error? }` |

仅此一个 invoke 通道，无单向 push、无订阅。一次性请求/响应，渲染端组件用本地 `useState` 管理结果，不进 Zustand 全局 store。

## 主进程模块 API

```typescript
// src/main/updater/checker.ts

export interface UpdateCheckResult {
  hasUpdate: boolean
  currentVersion: string
  latestVersion: string
  releaseUrl: string
  releaseNotes?: string
}

export async function checkForUpdate(): Promise<{
  success: boolean
  data?: UpdateCheckResult
  error?: string
}>
```

### 实现要点

1. **获取最新版本**：`fetch('https://api.github.com/repos/max-doo/multichat/releases/latest')`，附带 `User-Agent: MultiChat-Desk` 头（GitHub API 要求）。超时控制：用 `AbortController` 设 10s 超时。
2. **解析**：从 JSON 取 `tag_name`（如 `v1.2.0`）、`html_url`（Release 页面）、`body`（release notes）。
3. **版本比较**：去除 `v` 前缀，按 `.` 拆段，逐段转数值比较。自写 ~15 行，不引 semver 库。仅支持 `major.minor.patch` 三段；若任一方格式异常，判 `hasUpdate: false` 并在 error 中记录"版本号解析失败"，前端按"暂时无法获取更新信息"提示。
4. **当前版本**：`app.getVersion()`。
5. **返回**：成功且解析完成 → `{ success: true, data: {...} }`；网络/HTTP 错误 → `{ success: false, error: <友好提示> }`。

## 数据流

1. 用户在 Settings Drawer 打开「关于」区块，点击「检查更新」
2. `AboutSection` 调用 `window.api.updateCheck()`，按钮进入"检查中…"禁用态
3. 主进程 `checkForUpdate()` fetch GitHub API、解析、对比版本
4. 返回 `{ success, data?, error? }`
5. `AboutSection` 根据结果渲染：
   - `success && data.hasUpdate` → 显示新版号 + 「前往下载」+ 可展开 release notes
   - `success && !data.hasUpdate` → "当前已是最新版本"
   - `!success` → 显示 error 文案 + 「重试」
6. 「前往下载」「使用说明」均通过 `window.api.openBrowserWindow(url)` 在默认浏览器打开

## AboutSection UI

挂在 SettingsDrawer 内容区，建议置于现有设置项之后、底部固定区域之前。

```
┌─ 关于 ────────────────────────────────────┐
│  当前版本            v1.1.0               │
│                                            │
│  [使用说明 ↗]        [检查更新]            │
│                                            │
│  （检查后动态展示其一）                    │
│   • 有更新：发现新版本 v1.2.0              │
│             [前往下载 ↗]  ▾ 查看更新说明   │
│   • 无更新：当前已是最新版本               │
│   • 失败：  {error 友好提示}  [重试]        │
└────────────────────────────────────────────┘
```

### 状态映射

| 组件本地状态 | 展示 | 交互 |
|---|---|---|
| `idle`（初始/重置后） | 仅显示当前版本号 | 「使用说明」+「检查更新」可点 |
| `checking` | "正在检查…" | 「检查更新」disabled 显示"检查中…" |
| `has-update` | 发现新版本 vX.Y.Z | 「前往下载」外链 + 可展开 release notes |
| `no-update` | 当前已是最新版本 | 可再次「检查更新」 |
| `error` | {友好提示} | 「重试」按钮 |

### 外链

- 「使用说明」→ `openBrowserWindow('https://github.com/max-doo/multichat#readme')`（或后续指定的 docs 路径，待实现时与维护者确认最终 URL）
- 「前往下载」→ `openBrowserWindow(data.releaseUrl)`
- release notes 用 `react-markdown` + `remark-gfm` 折叠展示（复用项目已有依赖）

## 错误处理

| 场景 | 判定方式 | 友好提示 | 前端行为 |
|---|---|---|---|
| 网络失败/超时 | fetch reject 或 AbortController 触发 | 检查失败，请检查网络后重试 | `error` 态，可重试 |
| GitHub API 限流 (403) | `response.status === 403` | 更新服务繁忙，请稍后再试 | `error` 态，可重试 |
| GitHub API 其他非 200 | `!response.ok` | 暂时无法获取更新信息 | `error` 态，可重试 |
| 响应体结构异常 | 解析 `tag_name`/`html_url` 失败 | 暂时无法获取更新信息 | `error` 态，可重试 |
| 版本号格式异常 | 拆段/转数值失败 | 暂时无法获取更新信息 | `error` 态，可重试 |

所有错误均不抛出到 IPC 之外，统一封装为 `{ success: false, error }` 返回。

## 平台一致性

纯提醒版不涉及安装/签名，**全平台行为一致**：

- Windows NSIS 安装版：提醒 + 跳转下载
- Windows 便携 ZIP：提醒 + 跳转下载
- macOS DMG：提醒 + 跳转下载

无需旧设计里的 `disabled` 降级状态机。

## 验证方式

- `npm run lint` 无错误无新增 warning
- `npm run build` 通过，无类型错误
- `npm run dev` 手动验证：
  1. 打开 Settings Drawer → 「关于」区块，确认显示当前版本号 `v1.1.0`
  2. 点击「使用说明」，确认在默认浏览器打开 GitHub README
  3. 点击「检查更新」，观察状态流转：
     - 当前为最新 → `no-update`："当前已是最新版本"
     - 临时将 `package.json` version 改为 `0.0.1` 重启 dev → `has-update`：显示新版号 + 「前往下载」+ 可展开 release notes（验证后恢复版本号）
     - 断网或改一个不存在的 repo 名 → `error`：显示友好提示 + 「重试」
  4. 点击「前往下载」，确认在默认浏览器打开对应 Release 页面

## 风险与备注

- **GitHub API 未认证限流**：60 次/小时/IP。仅手动触发、单次请求，正常使用不会触达上限。若未来加启动自动检查需重新评估。
- **版本号格式假设**：仅支持 `vX.Y.Z` / `X.Y.Z` 三段。若未来发 pre-release（`1.2.0-beta`）需扩展比较逻辑——当前 MVP 不支持，按"格式异常"处理。
- **release notes 内容**：直接渲染 GitHub Release body 的 markdown 原文，未做 XSS 过滤。`react-markdown` 默认不执行内联 HTML 脚本，风险可控；body 来自维护者自己发布的 Release，非用户输入。
- **发布渠道**：沿用 GitHub Releases（owner: max-doo / repo: multichat）。若后续迁移到自建/对象存储，需改 `checkForUpdate` 内的 URL 与解析逻辑。

## 工作量评估

- 难度：**低**
- 估时：半天 ~ 1 天
- 风险点：仅网络请求与版本号比较，无安装/重启/签名/打包改动
- 依赖的现成基建均已就位：`openBrowserWindow`、IPC `{success,data,error}` 约定、`react-markdown`、`remark-gfm`、`app.getVersion()`
