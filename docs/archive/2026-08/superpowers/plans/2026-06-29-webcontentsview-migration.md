> Created: 2026-06-29 21:25 (UTC+8)

# WebView → WebContentsView 完整迁移实施计划

> **For agentic workers:** 本计划为任务级粒度（中等粒度）。每个任务包含：改动文件（含行号锚点）、接口契约（Consumes/Produces）、改动要点、验证方式、风险。项目未配置自动化测试运行器，每个任务的验证门 = `npm run lint` → `npm run build` → `npm run dev` 手动验证（见 AGENTS.md「Testing Guidelines」）。因此本计划不采用 TDD 逐步写码，而是以「可独立验证的交付物」为任务边界。

**Goal:** 将 MultiChat Desk 从 Electron `<webview>` 标签架构完整迁移到 `WebContentsView`，彻底解决 ScriptProcessorNode 崩溃、OOPIF 渲染不稳定等历史问题，并获得官方长期维护的 webContents 控制能力。

**Architecture:** 前置升级 Electron 28→30+（WebContentsView 的硬性前提），随后在主进程新建 `WebContentsViewManager` 统一管理视图生命周期/bounds/z-order，通过新增的布局同步 IPC + 脚本执行 IPC + 事件转发 IPC 把渲染层从「直接操作 webview DOM」改为「IPC 驱动主进程 webContents」。渲染层保留 `WebviewCardRef` 命令式接口（IPC 实现），`appStore.webviewRefs` 的 Map 结构与 slot/modelId 查找逻辑保持不变，最大化降低上层（发送/总结/上传等链路）改动面。

**Tech Stack:** Electron 30+（`WebContentsView` / `BaseWindow.contentView` / `webContents`）、electron-vite、electron-builder、React 18、Zustand 4、TypeScript strict。

## 技术核验结论（context7 验证）

1. **API 形态**：`new WebContentsView({ webPreferences })` → `win.contentView.addChildView(view)` → `view.setBounds({x,y,width,height})` → `view.webContents.loadURL(...)` / `executeJavaScript(...)`。
2. **窗口类型**：`BrowserWindow` 继承自 `BaseWindow`，因此 `win.contentView.addChildView()` **在 BrowserWindow 上同样可用**——本项目无需从 `BrowserWindow` 迁到 `BaseWindow`，可保留现有窗口创建代码的主体。
3. **版本前提**：`WebContentsView` 与 `BaseWindow.contentView` 在 Electron 30+ 才可用；`BrowserView` 已废弃并由 `WebContentsView` 替代。→ 必须先完成 Electron 28→30+ 升级。
4. **可见性/层叠**：通过 `addChildView` / `removeChildView` 控制是否挂载，或用 `setBounds` 移出可见区 + `setVisible`（若版本支持）控制显隐；z-order 由 addChildView 顺序决定（后加者在上方）。
5. **webPreferences**：`WebContentsView` 构造选项接受 `webPreferences`，`partition: 'persist:shared'` 直接迁入，`webviewTag` 不再需要。

## Global Constraints

- **包管理器**：npm（禁止 yarn/pnpm）。新依赖须先确认（AGENTS.md）。
- **分层边界**：主进程能力/窗口/Session/IPC/数据；preload 仅安全桥接；渲染层仅 UI/状态/页面逻辑/Webview 交互。禁止跨层塞逻辑。
- **IPC 约束**：新增/修改 IPC 必须同步 `src/main/ipcHandlers.ts`、`src/preload/index.ts`、`src/preload/index.d.ts` 及渲染层调用点；返回结构统一 `{ success, data?, error? }`。
- **Webview 自动化约束**：选择器集中在 `config/selectors.ts`，注入脚本集中在 `utils/webviewScripts.ts`——**本次迁移这两个文件的内容不动**，只改调用方（从 webview DOM 调用改为主进程 webContents 调用）。
- **Session 约束**：所有 WebContentsView 共享 `persist:shared`；登录态全局，账户/Session 改动须评估全局影响。
- **验证流程**：`npm run lint` → `npm run build` → `npm run dev` 手动验证。无法在本机验证的须说明并给最小等价检查。
- **提交规范**：Conventional Commits；改动聚焦，不顺手重构。
- **时间戳**：写入任何时间戳前先 `Get-Date` 取真实时间。
- **Electron 目标版本**：≥30（建议执行时锁定为当前最新稳定版，并与 electron-builder / electron-vite 兼容矩阵核对后再 pin）。

## 关键现状锚点（来自代码审计）

| 现状 | 位置 |
|---|---|
| Electron 版本 `^28.0.0` | `package.json:52` |
| electron-builder `^24.9.1` / electron-vite `^2.0.0` | `package.json:53-54` |
| `webviewTag: true` + `partition: 'persist:shared'`（主窗口） | `src/main/webviewManager.ts:389-396` |
| 同上（快捷窗口） | `src/main/webviewManager.ts:688-695` |
| `did-attach-webview` 监听（主/快捷） | `src/main/webviewManager.ts:444-447, 723-726` |
| `registerWebviewHandlers(webContents)`（UA/权限/注入/弹窗） | `src/main/webviewManager.ts:461-671` |
| 点击拦截 + AudioContext patch 注入脚本 | `src/main/webviewManager.ts:186-352`（patch 在 271-314） |
| `tryInject`（mainFrame.executeJavaScript） | `src/main/webviewManager.ts:549-574` |
| `<webview>` JSX 唯一渲染点 | `src/renderer/src/components/WebviewCard.tsx:1070-1078` |
| 9 类 webview DOM 事件绑定 | `src/renderer/src/components/WebviewCard.tsx:221-359` |
| 渲染层 `executeJavaScript` 调用（11 处） | `src/renderer/src/components/WebviewCard.tsx:422,462,482,503,534,559,607,626,648,670,703` |
| `WebviewCardRef` 接口 | `src/renderer/src/components/WebviewCard.tsx:105-120` |
| `webviewRefs: Map<string, WebviewCardRef>` | `src/renderer/src/store/appStore.ts:216,616-618` |
| `webviewRefs` 消费点（发送/清空/上传/深度研究/图片/取响应） | `src/renderer/src/store/appStore.ts:709-1184` |
| `webContents.fromId`（鼠标点击/文件拖拽） | `src/main/ipcHandlers.ts:445,486,520` |
| `getWebContentsId()` 渲染层调用 | `src/renderer/src/components/WebviewCard.tsx:523`、`Layout.tsx:217`、`geminiCanvasExtractor.ts:406` |
| preload webview 相关 IPC（`send-mouse-click`/`dispatch-file-drop`） | `src/preload/index.ts:66-70`、`index.d.ts:51-52` |
| 上下文菜单 webview 检测 `closest('webview')` / `querySelectorAll('webview')` | `src/renderer/src/components/Layout.tsx:135,214` |
| Gemini Canvas 提取器（WebviewAPI 接口） | `src/renderer/src/utils/geminiCanvasExtractor.ts:35-38,206-406` |
| 后台无头 Session 窗口（同样用 persist:shared + registerWebviewHandlers） | `src/main/services/SessionManager.ts:44,53` |

---

## Phase 1：Electron 大版本升级（28 → 30+）

> 此阶段**保留 `webviewTag: true`**，仅做版本升级与回归，先把「升级本身」的风险隔离出来。这是后续 WebContentsView 迁移的硬前提。

### Task 1.1：升级 Electron 及构建链依赖

**Files:**
- Modify: `package.json:52-54`（`electron` / `electron-builder` / `electron-vite`）
- Modify: `package-lock.json`（由 `npm install` 自动更新）

**改动要点:**
- 将 `electron` 升到 ≥30（执行时锁定最新稳定版）。
- 同步核对并升级 `electron-builder`、`electron-vite`、`vite` 到与目标 Electron 兼容的版本（查 electron-vite 仓库 README 的兼容矩阵）。
- 审查 Electron 28→30 的 Breaking Changes（`app`/`BrowserWindow`/`session`/`webPreferences` 默认值变化、Node 版本要求、`contextIsolation`/`sandbox` 默认等）逐条对照本项目用法。
- `package.json` 的 `engines`/Node 版本要求若需调整同步更新。

**验证:**
- `npm install` 无 peer 警告致命错误。
- `npm run lint` 通过。
- `npm run build` 通过（类型检查 + 打包 main/preload/renderer）。
- `npm run dev` 启动，主窗口与快捷窗口均能打开 webview。

**风险:** 🟡 中。Breaking Changes 可能影响 `persist:shared` 行为、`sandbox:false`+`contextIsolation:true` 组合下的预加载脚本。若 `electron-vite` 大版本跳跃引入配置不兼容，需同步 `electron.vite.config.ts`。

### Task 1.2：Electron 30+ 上的 webview 基线回归

**Files:** 无代码改动（验证任务）

**改动要点:**
- 在新 Electron 版本上，对 10+ AI 平台逐一触发：加载、登录、发送、上传、深度研究/图片生成开关、取响应、Gemini Canvas 提取、Google Auth 跳转回流。
- 确认 `persist:shared` 登录态、UA 去除 `Electron/版本`、`disable-quic`/`disable-blink-features`/`use-angle=gl` 三个命令行开关仍生效。
- 记录任何因 Chromium 120→新版 Web API 变化导致的注入脚本异常（注入脚本内容本阶段**不修**，仅记录）。

**验证:**
- `npm run dev` 中逐平台走查，结果写入 SESSION_LOG（`--context`）。
- 若某平台注入脚本失效，作为 Task 1.x 补丁任务立项（修复 `webviewScripts.ts` 对应脚本），不得拖到 Phase 2。

**风险:** 🟡 中。Web API 变化可能在个别平台暴露，是本阶段最可能出现的实质性阻塞。

### Task 1.3：移除 AudioContext patch 临时补丁

**Files:**
- Modify: `src/main/webviewManager.ts:263-314`（删除 `createScriptProcessor` patch 分支）
- 参考评估文档「Workaround 清单」：Chromium 121+ 已修复 `ScriptProcessorNode::Process()` use-after-free。

**改动要点:**
- 升级到 Chromium 121+ 后，移除针对 `aliyun.com` / `qwen.ai` 的 AudioContext patch（保留其余点击拦截 / `window.open` 拦截逻辑）。
- **不**移除 `disable-quic` / `disable-blink-features`（与 Clash TUN / Cloudflare 相关，非 webview 问题）。

**验证:**
- `npm run build` 通过。
- `npm run dev` 中打开 Qwen/通义平台，触发含音频指纹的页面，确认不再 `STATUS_ACCESS_VIOLATION` 崩溃（连续操作 5 分钟无崩溃）。

**风险:** 🟢 低（前提是 Task 1.1 已升到 ≥Chromium 121）。若崩溃复现，回滚 patch 并记为未决项。

**Phase 1 出口条件:** Electron 30+ 上现有 `<webview>` 架构全平台回归通过，AudioContext patch 已移除。提交基线 commit。

---

## Phase 2：主进程 WebContentsView 基础设施

> 此阶段在主进程建立新架构的「地基」：视图管理器、ID 映射、布局同步 IPC、脚本执行 IPC、导航 IPC、事件转发 IPC、handler 适配、preload 契约。此阶段可与现有 webview 架构**并存**（webviewTag 仍为 true），新模块独立可测。

### Task 2.1：新建 `WebContentsViewManager` 模块

**Files:**
- Create: `src/main/webContentsViewManager.ts`

**Interfaces:**
- Consumes: `BrowserWindow`（来自 `webviewManager.ts` 的 `mainWindow`/`quickWindow`）、`session.fromPartition('persist:shared')`、`registerWebviewHandlers(webContents)`（`webviewManager.ts:461`）。
- Produces（导出函数签名，供后续任务依赖）:
  ```ts
  // 在指定窗口上创建并挂载一个 WebContentsView，返回主进程持有的句柄 id
  createView(windowId: number, opts: {
    slotKey: string;          // 'slot-0' 或 modelId，与渲染层 webviewRefs 键对齐
    partition?: string;       // 默认 'persist:shared'
    webPreferences?: Partial<WebPreferences>;
  }): { viewId: string; webContentsId: number };

  setViewBounds(windowId: number, viewId: string, bounds: { x: number; y: number; width: number; height: number }): void;
  showView(windowId: number, viewId: string): void;   // addChildView 或 setVisible
  hideView(windowId: number, viewId: string): void;   // removeChildView 或移出可见区
  focusView(windowId: number, viewId: string): void;
  removeView(windowId: number, viewId: string): void;
  getViewById(viewId: string): WebContentsView | undefined;
  getWebContentsIdByViewId(viewId: string): number | undefined;
  ```

**改动要点:**
- 内部维护 `Map<windowId, Map<viewId, { view, slotKey, webContentsId }>>`。
- `createView` 构造 `new WebContentsView({ webPreferences: { partition, ...opts } })`，`win.contentView.addChildView(view)`，调用既有 `registerWebviewHandlers(view.webContents)` 复用 UA/权限/注入/弹窗逻辑。
- `setBounds` 直接转发 `view.setBounds(bounds)`；加 0 宽高防御（width/height ≤ 0 时跳过，避免渲染异常）。
- `show/hide`：用 `addChildView`/`removeChildView` 切换挂载（保证不活跃视图不占渲染资源），并记录 z-order 顺序；活跃视图最后 addChild 以置顶。
- `removeView`：`win.contentView.removeChildView(view)` + 清理映射 + 注销事件。

**验证:**
- `npm run lint` + `npm run build` 通过。
- `npm run dev`：临时在 `index.ts` `whenReady` 后用 `createView` 建一个 view 加载 https://example.com，`setBounds` 定到右侧，确认渲染、`removeView` 后消失。验证后删除临时代码。

**风险:** 🔴 高。这是新架构核心模块；`addChildView/removeChildView` 频繁切换在多视图下可能引入闪烁，需在 Task 4.2 压测。z-order 与 React overlay 层级冲突在 Task 3.7 解决。

### Task 2.2：webContentsId / viewId / slotKey 映射注册表

**Files:**
- Modify: `src/main/webContentsViewManager.ts`（Task 2.1 内部表对外暴露查询能力）
- 可能 Modify: `src/main/webviewManager.ts`（导出窗口 id 查询，或由 manager 自管 windowId）

**Interfaces:**
- Consumes: `createView` 产出的 `{ viewId, webContentsId, slotKey }`。
- Produces:
  ```ts
  resolveSlotKey(viewId: string): string | undefined;
  resolveViewIdByWebContentsId(webContentsId: number): string | undefined;
  resolveViewIdBySlotKey(windowId: number, slotKey: string): string | undefined;
  ```

**改动要点:**
- 把 Task 2.1 的内部 Map 扩展为可双向查询：`slotKey ↔ viewId ↔ webContentsId`。
- 渲染层 `getWebContentsId()` 的等价能力改由 `resolveViewIdBySlotKey` + `getWebContentsIdByViewId` 提供（供 `send-mouse-click`/`dispatch-file-drop`/Gemini Canvas 提取器使用）。

**验证:** lint + build；dev 中用临时日志打印三向解析结果正确。

**风险:** 🟡 中。映射不一致会导致脚本执行/事件转发打到错误视图，需在 Task 3.x 联调暴露。

### Task 2.3：布局同步 IPC 系统

**Files:**
- Modify: `src/main/ipcHandlers.ts`（新增 `webview:set-bounds` 等 handler）
- Modify: `src/preload/index.ts`、`src/preload/index.d.ts`（新增 `setWebviewBounds` 等）
- 渲染侧接入在 Task 3.1

**Interfaces:**
- Produces（IPC 契约，返回 `{ success }`）:
  ```ts
  // preload
  setWebviewBounds(windowId: number, viewId: string, bounds: Rect): Promise<{success: boolean; error?: string}>;
  ```
- 主进程 handler 调用 `WebContentsViewManager.setViewBounds(...)`。

**改动要点:**
- 新增 `ipcMain.handle('webview:set-bounds', ...)`，做参数校验（viewId 存在、宽高 > 0）。
- 布局信息来源：渲染层宿主 `<div>` 的 `ResizeObserver` + `getBoundingClientRect()`，把相对窗口的 x/y/w/h 经 IPC 传主进程。
- **节流**：resize/侧边栏动画期间高频触发，主进程侧做 rAF 合并或最小间隔节流（建议 ≤16ms 合批），避免抖动。
- 窗口 resize：主进程 `win.on('resize')` 通知渲染层重算（渲染层也可直接监听 window resize），二选一并文档化。

**验证:** lint + build；dev 中拖动窗口、收展侧边栏、收展 Summary Panel，观察 view 跟随无残留/无错位。

**风险:** 🔴 高（评估列为核心挑战）。视觉抖动、动画期间不同步是主要风险，节流策略需在 Task 3.1 联调打磨。

### Task 2.4：脚本执行 IPC 通道

**Files:**
- Modify: `src/main/ipcHandlers.ts`、`src/preload/index.ts`、`src/preload/index.d.ts`

**Interfaces:**
- Produces:
  ```ts
  // preload
  executeWebviewScript(viewId: string, code: string, options?: { userGesture?: boolean })
    : Promise<{ success: boolean; data?: unknown; error?: string }>;
  ```
- 主进程：`view.webContents.executeJavaScript(code, userGesture)`，结果序列化回传（注意：返回值须可结构化克隆，已有脚本返回的是 string/对象，符合）。

**改动要点:**
- 取代渲染层 11 处 `webview.executeJavaScript(...)`（`WebviewCard.tsx`）以及 `Layout.tsx:220`、`geminiCanvasExtractor.ts` 的直接调用。
- 超时保护：复用现有 `Promise.race(400ms)` 模式（`WebviewCard.tsx:482,503`），在渲染层包裹 IPC 调用。
- `userGesture` 透传：发送/点击类脚本需要 `true`（对应现有 `mainFrame.executeJavaScript(script, true)`，`webviewManager.ts:554`）。

**验证:** lint + build；dev 中通过新 IPC 在某平台执行 `generateGetInputTextScript`，能正确回读输入框文本。

**风险:** 🟡 中。异步返回值序列化、userGesture 时机是注意点；注入脚本内容不变，逻辑风险低。

### Task 2.5：导航控制 IPC

**Files:**
- Modify: `src/main/ipcHandlers.ts`、`src/preload/index.ts`、`src/preload/index.d.ts`

**Interfaces:**
- Produces（统一 `{ success, data?, error? }`）:
  ```ts
  loadWebviewURL(viewId: string, url: string): Promise<{success: boolean; error?: string}>;
  reloadWebview(viewId: string): Promise<{success: boolean; error?: string}>;
  webviewGoBack(viewId: string): Promise<{success: boolean; data?: { canGoBack: boolean }}>;
  webviewGoForward(viewId: string): Promise<...>;
  webviewStop(viewId: string): Promise<...>;
  getWebviewURL(viewId: string): Promise<{success: boolean; data?: { url: string }}>;
  getWebviewNavState(viewId: string): Promise<{success: boolean; data?: { canGoBack: boolean; canGoForward: boolean }}>;
  clearWebviewHistory(viewId: string): Promise<...>;
  ```

**改动要点:**
- 主进程 handler 转发到 `view.webContents` 对应方法。
- 替换 `WebviewCard.tsx` 中 `loadURL/reload/goBack/goForward/canGoBack/canGoForward/stop/getURL/clearHistory`（行见审计表）。
- 注意 `loadURL` 现有「冷启动 src 不触发导航」的 200ms 重试逻辑（`WebviewCard.tsx:361-396`）改为：主进程直接 `loadURL`，失败时主进程侧重试或返回 error 由渲染层重试——选主进程侧重试更稳。

**验证:** lint + build；dev 中导航按钮前进/后退、地址栏 URL 同步、reload、清空历史均工作。

**风险:** 🟡 中。导航状态同步依赖事件转发（Task 2.6）。

### Task 2.6：事件转发 IPC（9 类事件）

**Files:**
- Modify: `src/main/webContentsViewManager.ts`（在 `createView` 内绑定 webContents 事件）
- Modify: `src/main/ipcHandlers.ts`（定义主→渲染 push 通道）
- Modify: `src/preload/index.ts`、`src/preload/index.d.ts`（暴露订阅 API）

**Interfaces:**
- Produces（主→渲染单向 push，`webContents.send` → `ipcRenderer.on`）:
  ```ts
  // preload：渲染层注册回调，按 viewId 分发
  onWebviewEvent(viewId: string, cb: (e: WebviewEventPayload) => void): () => void; // 返回取消订阅
  ```
  `WebviewEventPayload = { viewId: string; type: WebviewEventType; data?: any }`，`type` ∈ `did-start-loading | did-stop-loading | did-fail-load | did-navigate | did-navigate-in-page | dom-ready | did-finish-load | console-message | page-title-updated | render-process-gone`。

**改动要点:**
- `createView` 时对 `view.webContents` 绑定上述事件，`webContents.send('webview:event', { viewId, type, data })`。
- `console-message`：保留对 `__MM_LOG:` / `__OPEN_LINK:` 前缀的拦截逻辑（原在 `webviewManager.ts:576-598` 与渲染层 `WebviewCard.tsx:318`），决定拦截点：**主进程侧**保留 `__OPEN_LINK:` 处理（涉及打开外链/Google Auth，主进程处理更合适），`__MM_LOG:` 转发渲染层日志面板。
- `dom-ready` / `did-finish-load` / `did-frame-finish-load` 触发点击拦截脚本注入：复用 `tryInject`（`webviewManager.ts:549-574`），在主进程侧注入，不再需要渲染层触发。
- `render-process-gone` → 渲染层显示崩溃覆盖层（原 `WebviewCard.tsx:319-320`）。
- `did-fail-load` 的错误分类（no_network/dns/timeout/connection）逻辑从渲染层 `handleLoadFail` 迁到主进程或保留渲染层——**保留渲染层**（分类是 UI 状态，主进程只透传原始 error），减少迁移面。

**验证:** lint + build；dev 中 loading 覆盖层显隐、崩溃覆盖层、console 日志、标题更新、URL 跟随均与旧版一致。

**风险:** 🟡 中。事件时序（dom-ready 注入时机）与旧版须对齐，否则注入脚本晚到导致首屏发送失败。

### Task 2.7：`registerWebviewHandlers` 适配 WebContentsView

**Files:**
- Modify: `src/main/webviewManager.ts:461-671`（`registerWebviewHandlers` 签名/内部不变，确认对 `WebContentsView.webContents` 同样适用）

**改动要点:**
- `registerWebviewHandlers(webContents)` 本就接受 `webContents`，对 `WebContentsView.webContents` 直接复用。
- 校验 `will-navigate`/`did-navigate`/`did-navigate-in-page` 的 Google Auth 检测（`webviewManager.ts:472-545`）、`did-create-window`（601-631）、`setWindowOpenHandler`（633-670）在新架构下行为一致。
- `setWindowOpenHandler` 的弹窗拦截/Google Auth 路由对 WebContentsView 同样有效（webContents 级 API）。

**验证:** lint + build；dev 中触发 Google 登录跳转与回流（Gemini 平台），确认自动 reload 行为不变；外链点击走 `__OPEN_LINK:` 打开系统浏览器。

**风险:** 🟢 低（API 一致）。主要是回归验证。

### Task 2.8：preload 契约统一更新

**Files:**
- Modify: `src/preload/index.ts`、`src/preload/index.d.ts`

**改动要点:**
- 把 Task 2.3–2.6 新增的 IPC（`setWebviewBounds` / `executeWebviewScript` / 导航族 / `onWebviewEvent` / 视图生命周期 `createWebviewView` `removeWebviewView` `showWebviewView` `hideWebviewView`）全部在 preload 桥接 + `.d.ts` 类型同步。
- **保留** 现有 `sendMouseClick` / `dispatchFileDrop`（`index.ts:66-70`），但其入参 `webContentsId` 的获取方式改为由 `WebContentsViewManager.getWebContentsIdByViewId` 提供（Task 3.1/3.5 接入）。

**验证:** `npm run build`（preload 类型契约是构建门）；渲染层 `window.api.*` 调用点类型检查通过。

**风险:** 🟢 低。但**易遗漏同步**——IPC 约束要求四处同步，遗漏任一处构建/类型即失败，正好作为强校验。

**Phase 2 出口条件:** 主进程新基础设施完整、可独立创建/销毁/布局/注入/转发事件的 WebContentsView，preload 契约同步，lint+build 通过，dev 中临时原型 view 行为正确。提交基线 commit。

---

## Phase 3：渲染层适配

> 把渲染层从「直接持有 webview DOM」切换到「持有 viewId + 通过 IPC 驱动」。保留 `WebviewCardRef` 命令式接口与 `appStore.webviewRefs` 结构，把上层链路（发送/总结/上传/Canvas 提取）改动面压到最小。

### Task 3.1：`WebviewCard.tsx` 核心重构

**Files:**
- Modify: `src/renderer/src/components/WebviewCard.tsx`（`<webview>` 渲染 1070-1078、事件 221-359、executeJavaScript 11 处、loadURL/reload/nav 等）

**改动要点:**
- **DOM**：`<webview>` 替换为宿主 `<div ref={hostRef} data-mm-view-id={viewId} className="w-full h-full" />`。`WebviewCard` 挂载时：
  1. 调 `window.api.createWebviewView({ slotKey, windowId })` 拿 `viewId`；
  2. `new ResizeObserver(() => window.api.setWebviewBounds(windowId, viewId, rect))` 绑到 hostRef，初始触发一次；
  3. `window.api.onWebviewEvent(viewId, handleEvent)` 订阅事件，分发到原 `handleDomReady/handleLoadStart/...` 处理函数（逻辑尽量原样保留）。
- **执行脚本**：11 处 `webview.executeJavaScript(code)` → `window.api.executeWebviewScript(viewId, code, { userGesture: true })`，保留 400ms `Promise.race` 超时（`WebviewCard.tsx:482,503`）。
- **导航/URL**：`loadURL/reload/goBack/goForward/stop/getURL/clearHistory/canGo*` → 对应 IPC（Task 2.5）。
- **`getWebContentsId()`**（`:523`）→ `WebContentsViewManager.getWebContentsIdByViewId` 经新 IPC（或 preload 直接暴露查询）。
- **卸载**：`removeWebviewView(windowId, viewId)` + 取消 ResizeObserver + 取消事件订阅。
- **`useRef<Electron.WebviewTag>`**（`:128`）类型移除。

**Interfaces:**
- Consumes: Task 2.3–2.6 全部 IPC。
- Produces: 对外 `WebviewCardRef` 接口签名**不变**（Task 3.2）。

**验证:** lint + build；dev 中单平台（先选一个非 Gemini 的简单平台）走通 加载→发送→取响应→清空→reload→前进后退。

**风险:** 🔴 高。本任务是迁移最大单点；ResizeObserver 与主进程 setBounds 的节流配合直接决定视觉稳定性。建议本任务**单平台**先打通，再在 Task 3.6 扩到多视图。

### Task 3.2：`WebviewCardRef` 接口保持与 IPC 实现对齐

**Files:**
- Modify: `src/renderer/src/components/WebviewCard.tsx:105-120`（实现体，接口签名不变）

**改动要点:**
- 接口 13 个方法签名保持不变，仅实现体从 webview DOM 调用改为 IPC。
- 确认所有返回结构仍为 `{ success, error? }` / `{ success, text? }` / `Promise<string>`，与 `appStore` 消费点（`appStore.ts:709-1184`）契约一致。

**验证:** `npm run build` 类型检查（`appStore` 消费点类型对齐是强校验）。

**风险:** 🟢 低。签名不变，上层无感。

### Task 3.3：`appStore.ts` 状态最小改动

**Files:**
- Modify（极小）: `src/renderer/src/store/appStore.ts:216,616-618`

**改动要点:**
- `webviewRefs: Map<string, WebviewCardRef>` **结构不变**，`registerWebviewRef/unregisterWebviewRef` 不变，所有 `webviewRefs.get('slot-${index}') || webviewRefs.get(model.id)` 查找逻辑（709-1184）**不动**。
- 唯一可能调整：若 `WebviewCard` 不再用 ref 暴露 DOM 而是暴露 viewId，确认 `WebviewCardRef` 仍是同一个对象引用——保持 `useImperativeHandle` 模式即可，无改动。

**验证:** lint + build；dev 中「发送到全部」「清空全部」「上传到全部」「深度研究/图片 全部」「取全部响应」逐项验证。

**风险:** 🟢 低。本任务的价值在于**确认无需改动**，避免误改引入回归。

### Task 3.4：`Layout.tsx` 上下文菜单 webview 检测改造

**Files:**
- Modify: `src/renderer/src/components/Layout.tsx:135,214-251`

**改动要点:**
- `target.closest('webview')`（:135）：webview DOM 已不存在。改为：右键坐标命中哪个宿主 `<div data-mm-view-id>`，或由主进程上下文菜单 IPC 直接带回 `viewId`/`webContentsId`（推荐后者——主进程已知点击落点对应的 WebContentsView）。
- `document.querySelectorAll('webview')` + `getWebContentsId()` 匹配（:214-217）：改为从 `appStore.webviewRefs` 取已注册 ref，或由主进程直接对目标 viewId 执行粘贴脚本。
- 粘贴脚本注入（:220-251 `wv.executeJavaScript`）：改为 `window.api.executeWebviewScript(viewId, pasteScript)`，或走现有 `ipcHandlers.ts:165` 的主进程粘贴通道（该通道已用 `webContents.executeJavaScript`，只需把 `webContentsId` 来源改成 viewId 解析）。

**验证:** lint + build；dev 中在 webview 内右键粘贴文本，确认粘贴到正确视图的输入框。

**风险:** 🟡 中。坐标→视图命中在多视图/有 overlay 时易错。

### Task 3.5：`geminiCanvasExtractor.ts` 的 `WebviewAPI` 适配

**Files:**
- Modify: `src/renderer/src/utils/geminiCanvasExtractor.ts:35-38,206,252,257,285,349,406`

**改动要点:**
- `WebviewAPI` 接口（:35-38）的 `getWebContentsId()` 与 `executeJavaScript()` 改为基于 viewId 的 IPC 实现：由调用方（`WebviewCard`/`useWebviewSummary`）传入 `{ viewId, getWebContentsId: () => ipcQuery, executeJavaScript: (c) => ipcExec }` 适配器， extractor 内部逻辑（CHECK_CANVAS / FIND_COPY_BUTTON / CLOSE_MENU / WAIT_FOR_COPY_TOAST / EXTRACT_LINKS）脚本内容不变。
- `getWebContentsId()`（:406）用于鼠标点击路由 → 改由 `WebContentsViewManager.getWebContentsIdByViewId`。

**验证:** lint + build；dev 中 Gemini Canvas 模式：检测 Canvas、定位复制按钮、关闭菜单、等待 toast、提取引用链接全流程。

**风险:** 🟡 中。Gemini Canvas 是交互最复杂的链路，回归优先级高。

### Task 3.6：页面级多视图接入（MainPage / QuickPage / 缓存池）

**Files:**
- Modify: `src/renderer/src/pages/MainPage.tsx:48-75,486-507,630-654`
- Modify: `src/renderer/src/pages/QuickPage.tsx:17-27,203-257`
- Modify: `src/renderer/src/components/QuickWindowCachedWebviews.tsx`（缓存池）

**改动要点:**
- `MainPage`：每个 slot 渲染 `WebviewCard`（已是 viewId 驱动），`getRefCallback` 注册到 `slot-${index}` + `modelId` 不变；历史恢复 `webviewRef.loadURL(finalUrl)`（:630-654）走 IPC loadURL 不变。
- `QuickPage`：`display: none` 切换非活跃视图（:203-257）→ 改为 `window.api.hideWebviewView`/`showWebviewView`（Task 2.1 show/hide），活跃视图置顶。
- `QuickWindowCachedWebviews`：缓存池从「隐藏的 `<webview>` DOM」改为「主进程常驻的 WebContentsView 池」——预创建 N 个 view，切换时 show/hide + setBounds，避免反复创建销毁。这是评估点名的「缓存池重新设计」。

**验证:** lint + build；dev 中多模型并行发送、模型切换（QuickWindow）、缓存命中复用、历史恢复全流程。

**风险:** 🔴 高。多视图 z-order + 缓存池生命周期是评估点名的高风险点，须重点压测切换抖动与内存。

### Task 3.7：CSS 清理与 overlay 层级管理

**Files:**
- Modify: 渲染层 CSS（`webview` 相关样式、loading/crash 覆盖层、搜索栏）
- 可能 Modify: `src/main/webContentsViewManager.ts`（overlay 用 `View` 实现）

**改动要点:**
- 移除 `<webview>` 专属 CSS。
- **关键架构问题**：WebContentsView 脱离 DOM，**无法被 DOM 元素遮挡**。当前 loading 覆盖层、crash 覆盖层、搜索栏是 DOM overlay，迁移后会被 WebContentsView 盖住。方案二选一：
  - **方案 A（推荐）**：覆盖层改用主进程 `View`（`new View()` + `setBackgroundColor` 透明 + 在其上渲染？——View 不支持 HTML，仅适合作纯色遮罩）。
  - **方案 B**：把 loading/crash 状态做成 **WebContentsView 自身的 setBounds 缩小或 hide** + 在宿主 `<div>` 内渲染 React overlay（因 view 被 hide/移出，DOM overlay 自然可见）。
  - 决策：loading/crash 期间 `hideView`（移出可见区），宿主 div 显示 React 状态层；正常时 showView 盖住宿主。这样复用现有 React overlay，改动最小。
- 搜索栏（若需浮于 webview 之上）：同上 hideView 期间显示，或独立 View。

**验证:** lint + build；dev 中 loading/crash 覆盖层正确显隐且不被 webview 遮挡；搜索栏可浮于 webview 之上。

**风险:** 🔴 高。overlay 层级是迁移后最容易出视觉 bug 的点，评估点名。

**Phase 3 出口条件:** 渲染层全部改用 IPC 驱动，单平台与多平台功能回归通过，overlay 层级正确，lint+build 通过。提交基线 commit。

---

## Phase 4：快捷窗口缓存池与多视图层叠打磨

### Task 4.1：QuickWindow 缓存池 WebContentsView 化

**Files:**
- Modify: `src/main/webContentsViewManager.ts`（池化 API：`acquirePooledView` / `releasePooledView`）
- Modify: `src/renderer/src/components/QuickWindowCachedWebviews.tsx`

**改动要点:**
- 主进程维护按 `modelId` 预创建的常驻 view 池，切换模型时 `showView(target) + hideView(others) + setBounds`，复用已加载会话。
- 池容量与淘汰策略对齐现有缓存池逻辑。

**验证:** dev 中 QuickWindow 连续切换 5+ 模型，观察首屏延迟、内存增长、切换抖动。

**风险:** 🟡 中。池内 view 的 Session 复用与 `persist:shared` 全局登录态须不冲突。

### Task 4.2：多视图层叠与显隐压测

**Files:** 无新文件（验证 + 微调）

**改动要点:**
- 7 webview 同存场景下：侧边栏收展、窗口 resize、Summary Panel 收展、模型切换、历史恢复，连续操作 5 分钟，记录抖动/错位/白屏。
- 调优 Task 2.3 的节流参数与 Task 2.1 show/hide 策略（addChildView/removeChildView vs setVisible）。

**验证:** 视觉稳定性主观评估 + 内存占用对比旧版（评估预期 -5~8%）。

**风险:** 🟡 中。可能暴露需要回退到 setVisible 方案的 case。

**Phase 4 出口条件:** 快捷窗口缓存池与多视图层叠在压测下稳定，无明显抖动。

---

## Phase 5：集成、回归、清理

### Task 5.1：移除 webviewTag 与残留 webview 配置

**Files:**
- Modify: `src/main/webviewManager.ts:389-396,688-695`（删 `webviewTag: true`，`partition` 已迁入 WebContentsView 构造）
- Modify: `src/main/services/SessionManager.ts:44,53`（后台无头窗口若仍用 webview 需同步迁；评估其是否必要）
- 全仓 grep `<webview` / `webviewTag` / `Electron.WebviewTag` / `getWebContentsId` 残留，清零。

**改动要点:**
- 确认无任何 `<webview>` 残留后，`webviewTag: false`（或删除该字段）。
- `did-attach-webview` 监听（`webviewManager.ts:444,723`）删除——已无 webview attach。

**验证:** lint + build；dev 中全功能回归；`grep -r "webviewTag\|<webview\|WebviewTag"` 返回空（除注释/文档）。

**风险:** 🟡 中。后台无头 Session 窗口（`SessionManager.ts`）若依赖 webview 须一并迁移，可能扩大范围——执行时先审计其用途。

### Task 5.2：10+ AI 平台全量回归

**Files:** 无（验证任务）

**改动要点:**
- 逐平台：加载、登录（含 Google Auth）、发送、插入文本、清空、上传文件、深度研究开关、图片生成开关、取响应、Gemini Canvas 提取、URL/导航同步、崩溃恢复、外链打开。
- 重点平台：Qwen/通义（验证 AudioContext patch 移除后无崩溃）、Gemini（Canvas + Google Auth）、ChatGPT/Claude 等高频平台。

**验证:** 结果写入 SESSION_LOG（`--context` 与 `--unresolved`）。

**风险:** 🔴 高（评估点名回归风险）。任一平台退化需立 patch 任务。

### Task 5.3：性能与内存基线对比

**Files:** 无（测量任务）

**改动要点:**
- 7 webview 场景内存占用、冷启动时间，对比 Electron 28+webview 旧基线（评估预期内存 -5~8%、冷启动 -~200ms）。
- 不达预期须分析（可能 addChildView/removeChildView 频繁导致反而上涨）。

**验证:** 数据记入 SESSION_LOG `--context`。

**风险:** 🟡 中。

### Task 5.4：清理、文档、记忆沉淀

**Files:**
- Modify: `docs/WEBCONTENTSVIEW_MIGRATION_ASSESSMENT.md`（追加「迁移已完成」状态行）
- Update: `CHANGELOG.md`（里程碑）
- Run: `python .memory/session_log.py`（按 Memory Layer 规范记录）
- 若有稳定经验：promote 至 `.memory/KNOWLEDGE.md` 并把 SESSION_LOG 对应 `- lesson:` 改 `- lesson(promoted):`

**改动要点:**
- 评估文档更新为「已完成」并记录实际工时/偏差。
- CHANGELOG 记录架构迁移里程碑。
- 跑 `session_log.py`，按提示 promote 稳定经验（如「WebContentsView overlay 不能被 DOM 遮挡，须 hideView 期间显示 React overlay」）。

**验证:** 文档/日志落盘；lint+build 最终通过。

**风险:** 🟢 低。

**Phase 5 出口条件:** webviewTag 清零、全平台回归通过、性能数据达标、文档与记忆沉淀完成。迁移结束。

---

## 自检（Self-Review）

**1. 评估覆盖扫描:**
- 项目现状（12-15 文件）：✅ 覆盖（webviewManager / WebviewCard / appStore / Layout / geminiCanvasExtractor / MainPage / QuickPage / QuickWindowCachedWebviews / ipcHandlers / preload / index.ts / SessionManager）。
- 升级可行性（Electron 30+ 前提）：✅ Phase 1。
- 收益（崩溃修复/稳定/内存/官方支持）：✅ Task 1.3、5.3、5.1。
- 高风险 1（Electron 升级）：✅ Task 1.1-1.2。
- 高风险 2（CSS→bounds）：✅ Task 2.3 + 3.1 + 3.7。
- 高风险 3（多视图层叠）：✅ Task 2.1/2.6 show/hide + 3.6 + 4.1/4.2。
- 中风险 4（事件重构 9 类）：✅ Task 2.6。
- 中风险 5（executeJavaScript 迁移 11 处）：✅ Task 2.4 + 3.1。
- 中风险 6（webContentsId 映射）：✅ Task 2.2。
- 低风险 7（注入脚本不变）：✅ 明确声明于 Global Constraints + 各任务脚本内容不动。
- 低风险 8（Session 共享不变）：✅ Task 2.1 partition 迁入。
- 工作量组件（12 项）：✅ 逐项映射到 Phase 1-5 任务。
- 替代方案：用户选定「仅完整迁移」（option C），本计划即 C 的完整展开。

**2. 占位符扫描:** 无 TBD/TODO/「适当处理」；每任务有具体文件:行号、接口签名、验证命令。脚本具体代码不展开（用户选定「任务级」粒度 + 注入脚本本就不改），属有意裁剪而非占位。

**3. 类型一致性:** `viewId`/`slotKey`/`webContentsId` 三元映射在 Task 2.1/2.2 定义后被 Task 2.3-2.6、3.1、3.4、3.5、4.1 一致使用；`WebviewCardRef` 接口签名在 Task 3.2 声明「不变」，与 `appStore` 消费点（Task 3.3）对齐；preload 契约命名（`setWebviewBounds`/`executeWebviewScript`/`onWebviewEvent`/导航族/`createWebviewView` 等）跨 Task 2.3-2.8 与 Task 3.1 一致。

**已知裁剪与未决项（执行时确认）:**
- Electron 具体目标小版本：执行时锁定，需与 electron-builder/electron-vite 兼容矩阵核对（Task 1.1）。
- overlay 方案 A/B 选择：Task 3.7 推荐方案 B，执行时验证。
- `SessionManager.ts` 后台无头窗口是否需一并迁移：Task 5.1 执行前审计。
- `setVisible` vs `addChildView/removeChildView`：Task 4.2 压测后定。
- 项目无自动化测试，所有「验证」均为 lint+build+dev 手动，无法本机完成的须列等价检查（AGENTS.md Done Criteria）。
