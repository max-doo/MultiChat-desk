# CLI & Daemon Architecture Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 根据前期的可行性评估，将网页自动化执行内核从 Renderer UI 层抽离至主进程（Daemon），并通过本地 Named Pipe 提供一套供 Agent 或脚本直接调用的 CLI 入口。

**Architecture:** 
1. **Service Layer (Main Process):** 新增 `SessionManager` 和 `AutomationService`，接管过去由 Zustand/React 负责的 Webview 生命周期与 DOM 注入逻辑。
2. **Local IPC (Daemon Server):** 主进程启动一个 Node.js `net` 模块实现的 Named Pipe Server，监听 CLI 的命令。
3. **CLI Client:** 基于 `commander` 构建轻量级 Node CLI 脚本，通过 Named Pipe 与主进程通信，并提供标准输出/JSON输出。

**Tech Stack:** TypeScript, Electron Main Process, Node.js `net` (Named Pipes), Commander.js.

---

## User Review Required

> [!WARNING]
> **Renderer UI 重构风险：** 本计划 Task 3 将会修改 `appStore.ts` 及其相关的 UI 组件逻辑，把原有的 `webviewTag` 和直接注入脚本的代码，重构为向 Main 进程发送 IPC 指令。这可能会在过渡期间影响现有的前端稳定性，需要确保在 `npm run dev` 中充分验证所有平台的发送/接收逻辑。

> [!IMPORTANT]
> **多窗口/无头 Webview 设计：** 目前的自动化依赖 `<webview>` 标签嵌在 React 树中。在抽离到主进程后，计划使用主进程创建隐藏的 `BrowserWindow`（或 `WebContents` / `BrowserView`）来作为常驻的会话容器。请确认是否同意这种由 Main 完全控制 `WebContents` 的方式替代前端 `<webview>`，这对实现“常驻后台执行”至关重要。

## Open Questions

> [!NOTE]
> 1. CLI 的执行是否需要独立的二进制产物（如 `multichat-cli.exe`），还是复用现有的 Node 环境（如在安装包中附带 `.cmd` 脚本调用内部绑定的 Node 运行 CLI）？当前计划采用后者（配置 `package.json` 的 `bin`）。
> 2. CLI 命令调用时，如果 Daemon (主应用) 未启动，是否应该由 CLI 尝试拉起隐藏的主应用？当前计划为：若未启动则提示需先运行 `multichat daemon start`。

---

## Proposed Changes

### Task 1: 抽取执行内核 - Session Manager (Main Process)

负责管理长驻的网页会话实例，不依赖 UI 渲染。

**Files:**
- [NEW] `src/main/services/SessionManager.ts`

- [ ] **Step 1: 创建 SessionManager 框架**
  编写 `SessionManager.ts`，维护一个 Map 保存当前活跃的会话（区分各平台，如 `gemini`, `chatgpt`）。
  提供 `getOrCreateSession(platformId, url)` 方法，使用隐藏的 `BrowserWindow` 或 `WebContents` 替代前端的 `<webview>`。

- [ ] **Step 2: 迁移拦截与注入逻辑**
  将 `webviewManager.ts` 中的 `getWebviewClickInterceptorScript` 与相关的 Google Auth 检测逻辑封装为公用模块，或挂载到新的 Session WebContents 上。

- [ ] **Step 3: 导出并在 index.ts 初始化**
  在 `src/main/index.ts` 中引入并初始化单例 `sessionManager`。

### Task 2: 抽取执行内核 - Automation Service (Main Process)

负责执行具体的发送输入、点击按钮和轮询获取结果。

**Files:**
- [NEW] `src/main/services/AutomationService.ts`
- [MODIFY] `src/renderer/src/config/selectors.ts` -> [NEW] `src/main/config/selectors.ts` (上移到 Main 或 Shared)
- [MODIFY] `src/renderer/src/utils/webviewScripts.ts` -> [NEW] `src/main/utils/webviewScripts.ts` (上移到 Main)

- [ ] **Step 1: 移动 Selector 和 Scripts**
  将前端的 `selectors.ts` 和 `webviewScripts.ts` 移动到 `src/main/` 目录下（或共用的 `src/shared/`，根据项目已有规范，暂时放在 main 中并在预加载中按需暴露给需要的 UI）。

- [ ] **Step 2: 创建 AutomationService**
  编写 `AutomationService.ts`，引入 `SessionManager`。
  实现 `executeCommand(sessionId, prompt)`：在对应的 WebContents 上执行 `executeJavaScript` 注入内容并触发点击。
  实现 `collectResult(sessionId)`：注入查询脚本提取 DOM 输出。

- [ ] **Step 3: 测试基础执行能力**
  在 Main 进程暴露临时 IPC 供测试，验证是否能在隐藏 `WebContents` 中正确执行 prompt。

### Task 3: 重构 Renderer 与 Main 的通信桥梁

让现有的桌面 UI 接入新的 Main 进程执行引擎。

**Files:**
- [MODIFY] `src/main/ipcHandlers.ts`
- [MODIFY] `src/preload/index.ts`
- [MODIFY] `src/preload/index.d.ts`
- [MODIFY] `src/renderer/src/store/appStore.ts`

- [ ] **Step 1: 定义新的 IPC 契约**
  在 `ipcHandlers.ts` 增加 `automation-start-session`, `automation-send-prompt`, `automation-collect` 等接口，并在 preload 中暴露。

- [ ] **Step 2: 改造 Zustand 编排逻辑**
  修改 `appStore.ts`，将原本直接调用 `webviewRef.current.executeJavaScript` 的逻辑，改为调用对应的 `window.api.automationSendPrompt` 等接口。

- [ ] **Step 3: UI 兼容调整**
  确保 UI 层正确反映状态更新（排队、执行中、完成）。UI 仍然可以通过共享 `persist:shared` session 获取登录状态。

### Task 4: Local Named Pipe Server (Daemon)

在主进程中建立守护服务，监听本地 IPC，接受 CLI 发来的命令。

**Files:**
- [NEW] `src/main/daemon/ipcServer.ts`
- [MODIFY] `src/main/index.ts`

- [ ] **Step 1: 创建 Named Pipe Server**
  在 `ipcServer.ts` 中使用 Node `net.createServer` 监听特定路径（Windows 下如 `\\\\.\\pipe\\multichat-daemon`）。

- [ ] **Step 2: 定义请求/响应协议**
  实现基于 JSON 行的简单协议。解析传入的 `{ action: 'exec', model: 'gemini', prompt: '...' }`，映射至 `AutomationService`。

- [ ] **Step 3: 主进程挂载**
  在 `src/main/index.ts` 的 `app.whenReady()` 后，调用 `startDaemonServer()`。

### Task 5: 编写单次命令 CLI Client

构建外部命令行入口，通过 Named Pipe 将参数发给 Daemon。

**Files:**
- [NEW] `src/cli/index.ts`
- [NEW] `src/cli/commands.ts`
- [MODIFY] `package.json`

- [ ] **Step 1: 安装依赖**
  安装 `commander`。更新 `package.json`，在 scripts 中添加 CLI 测试命令。

- [ ] **Step 2: 实现基础命令结构**
  在 `commands.ts` 使用 `commander` 注册 `daemon status`, `exec --model <m> --prompt <p>`, `collect` 等子命令。

- [ ] **Step 3: 实现客户端通信机制**
  编写通过 `net.connect` 连接 Named Pipe、发送 JSON 并等待返回结果的 Promise 逻辑。

- [ ] **Step 4: JSON 标准输出支持**
  确保命令能处理 `--json` 参数，使得 `stdout` 直接吐出结构化的执行结果，非零 exit code 处理错误。

## Verification Plan

### Automated Tests
- 无现成的测试运行器，故依赖本地构建验证。
- 运行 `npm run lint` 和 `npm run build` 确保各层类型检查和引用修改无误。

### Manual Verification
1. **桌面 UI 完整性：** 运行 `npm run dev`，打开桌面端，执行常规的“发送问题 -> 等待 -> 返回结果”流程，验证 `appStore` 到 `Main Service` 的接力是否正常工作。
2. **CLI 独立执行验证：**
   - 保持桌面端或 Daemon 后台运行。
   - 打开另一个终端，执行 `npx tsx src/cli/index.ts daemon status`，预期输出 `Daemon is running`。
   - 执行 `npx tsx src/cli/index.ts exec --model gemini --prompt "测试CLI连接"`，预期返回成功接手并返回执行状态。
   - 验证 `--json` flag 时控制台仅输出干净的 JSON 结果。
