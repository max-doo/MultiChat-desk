# CLI & Daemon Architecture Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 根据前期的可行性评估，将网页自动化执行内核从 Renderer UI 层抽离至主进程（Daemon），并通过本地 Named Pipe 提供一套供 Agent 或脚本直接调用的 CLI 入口。CLI **面向所有用户**，通过安装包内置分发，无需用户自行安装 Node.js。

**Architecture:**
1. **Shared Layer:** 新增 `src/shared/` 目录，存放 `selectors.ts` 和 `webviewScripts.ts`，主进程与渲染层共享纯数据与脚本字符串，无需 IPC 中转。
2. **Service Layer (Main Process):** 新增 `SessionManager` 和 `AutomationService`，接管过去由 Zustand/React 负责的 Webview 生命周期与 DOM 注入逻辑。
3. **Local IPC (Daemon Server):** 主进程启动一个 Node.js `net` 模块实现的 Named Pipe Server，监听 CLI 的命令。
4. **CLI Client:** 基于 `commander` 构建轻量级 CLI 脚本，通过 Named Pipe 与主进程通信，编译后随安装包分发，提供标准输出/JSON 输出。

**Tech Stack:** TypeScript, Electron Main Process, Node.js `net` (Named Pipes), Commander.js, electron-builder `extraResources`.

**实施顺序（风险最小化）：**
```
Task 1 (SessionManager)
  → Task 2 (AutomationService + Shared 迁移)
  → Task 3 (Named Pipe Daemon Server)        ← 原 Task 4
  → Task 4 (CLI Client + 安装包分发)         ← 原 Task 5
  → Task 5 (Renderer 重构)                   ← 原 Task 3，最后执行
```

---

## User Review Required

> [!WARNING]
> **Renderer UI 重构风险（Task 5）：** 本计划 Task 5 将会修改 `appStore.ts` 及其相关的 UI 组件逻辑，把原有的 `webviewTag` 和直接注入脚本的代码，重构为向 Main 进程发送 IPC 指令。该 Task 被调整至最后执行，需在 CLI 端到端验证完成后推进，并在 `npm run dev` 中充分回归所有平台的发送/接收逻辑。

> [!IMPORTANT]
> **多窗口/无头 Webview 设计：** 目前的自动化依赖 `<webview>` 标签嵌在 React 树中。在抽离到主进程后，计划使用主进程创建隐藏的 `BrowserWindow` 来作为常驻的会话容器，并使用 `webPreferences.partition = 'persist:shared'` 与现有 `<webview>` **共享登录态 Session**（已通过 Electron 官方文档验证）。请确认是否同意这种由 Main 完全控制 `WebContents` 的方式替代前端 `<webview>`，这对实现"常驻后台执行"至关重要。

---

## Open Questions

> [!NOTE]
> **CLI 分发方式（已决策）：** CLI 面向所有用户，采用"随安装包内置分发"方案。`src/cli/` 编译为独立 JS bundle（`out/cli/index.js`），通过 `electron-builder` 的 `extraResources` 打包进安装目录，并在安装目录提供 `multichat-cli.cmd`（Windows）/ `multichat-cli.sh`（macOS/Linux）封装脚本，脚本内部调用 Electron 内置的 Node 可执行文件（`resources/app/node_modules/.bin/` 路径或应用自带 Node）运行 CLI bundle，用户无需单独安装 Node.js。

> [!NOTE]
> **Daemon 未启动时的 CLI 行为：** 若 Daemon (主应用) 未启动，CLI 连接 Named Pipe 失败时，输出明确错误信息提示用户先启动 MultiChat 应用，不自动拉起隐藏进程（避免杀毒软件误报与无提示后台进程的用户体验风险）。

---

## Proposed Changes

### Task 1: 抽取执行内核 - Session Manager (Main Process)

负责管理长驻的网页会话实例，不依赖 UI 渲染。

**Files:**
- [NEW] `src/main/services/SessionManager.ts`

- [ ] **Step 1: 创建 SessionManager 框架**
  编写 `SessionManager.ts`，维护一个 Map 保存当前活跃的会话（区分各平台，如 `gemini`, `chatgpt`）。
  提供 `getOrCreateSession(platformId, url)` 方法，使用隐藏的 `BrowserWindow`（`show: false`，`partition: 'persist:shared'`）替代前端的 `<webview>`，与现有登录态共享同一 Session。

- [ ] **Step 2: 迁移拦截与注入逻辑**
  将 `webviewManager.ts` 中的 `getWebviewClickInterceptorScript` 与相关的 Google Auth 检测逻辑封装为公用模块，挂载到新的 Session WebContents 上。

- [ ] **Step 3: 导出并在 index.ts 初始化**
  在 `src/main/index.ts` 中引入并初始化单例 `sessionManager`。

---

### Task 2: 抽取执行内核 - Automation Service (Main Process)

负责执行具体的发送输入、点击按钮和轮询获取结果。

**Files:**
- [NEW] `src/shared/config/selectors.ts`（从 renderer 迁入共享层）
- [NEW] `src/shared/utils/webviewScripts.ts`（从 renderer 迁入共享层）
- [MODIFY] `src/renderer/src/config/selectors.ts` → 改为 re-export from `../../../shared/config/selectors`
- [MODIFY] `src/renderer/src/utils/webviewScripts.ts` → 改为 re-export from `../../../shared/utils/webviewScripts`
- [NEW] `src/main/services/AutomationService.ts`

> [!IMPORTANT]
> **共享层迁移说明：** `selectors.ts`（615 行，纯数据/类型）和 `webviewScripts.ts`（纯字符串函数）均不依赖任何 Node.js API，可安全放入 `src/shared/`。主进程和渲染层各自 `import`，无需 IPC 中转，不违反分层约束。原 renderer 路径改为 re-export 文件，保持 renderer 内现有 import 路径不变，避免大面积改动。

- [ ] **Step 1: 建立 src/shared/ 目录并迁移**
  - 创建 `src/shared/config/` 和 `src/shared/utils/` 目录。
  - 将 `selectors.ts` 和 `webviewScripts.ts` 的实际内容**复制**到 `src/shared/` 对应路径。
  - 将 `src/renderer/src/config/selectors.ts` 改为纯 re-export：`export * from '../../../shared/config/selectors'`。
  - 将 `src/renderer/src/utils/webviewScripts.ts` 改为纯 re-export：`export * from '../../../shared/utils/webviewScripts'`。
  - 确认 `npm run build` 编译通过，renderer 内现有引用不受影响。

- [ ] **Step 2: 创建 AutomationService**
  编写 `AutomationService.ts`，引入 `SessionManager` 和 `src/shared/config/selectors`、`src/shared/utils/webviewScripts`。
  实现 `executeCommand(sessionId, prompt)`：在对应的 WebContents 上执行 `executeJavaScript` 注入内容并触发点击。
  实现 `collectResult(sessionId)`：注入查询脚本提取 DOM 输出。

- [ ] **Step 3: 测试基础执行能力**
  在 Main 进程暴露临时 IPC 供测试，验证是否能在隐藏 `WebContents` 中正确执行 prompt。

---

### Task 3: Local Named Pipe Server (Daemon)

在主进程中建立守护服务，监听本地 IPC，接受 CLI 发来的命令。

**Files:**
- [NEW] `src/main/daemon/ipcServer.ts`
- [MODIFY] `src/main/index.ts`

- [ ] **Step 1: 创建 Named Pipe Server**
  在 `ipcServer.ts` 中使用 Node `net.createServer` 监听特定路径：
  - Windows: `\\.\pipe\multichat-daemon`
  - macOS/Linux: `/tmp/multichat-daemon.sock`

- [ ] **Step 2: 定义请求/响应协议**
  实现基于 JSON 行的简单协议（newline-delimited JSON）。解析传入的 `{ action: 'exec', model: 'gemini', prompt: '...' }`，映射至 `AutomationService`。统一响应结构：`{ success: boolean, data?: unknown, error?: string }`。

- [ ] **Step 3: 主进程挂载**
  在 `src/main/index.ts` 的 `app.whenReady()` 后，调用 `startDaemonServer()`。

---

### Task 4: CLI Client + 安装包分发

构建外部命令行入口，通过 Named Pipe 将参数发给 Daemon，并配置随安装包分发供所有用户使用。

**Files:**
- [NEW] `src/cli/index.ts`
- [NEW] `src/cli/commands.ts`
- [NEW] `src/cli/client.ts`（Named Pipe 客户端封装）
- [NEW] `scripts/build-cli.ts`（CLI 独立打包脚本，使用 esbuild）
- [NEW] `build/multichat-cli.cmd`（Windows 安装包内的 wrapper 脚本）
- [NEW] `build/multichat-cli.sh`（macOS/Linux wrapper 脚本）
- [MODIFY] `package.json`（新增 `build:cli` script）
- [MODIFY] `electron-builder.yml`（新增 `extraResources`）

- [ ] **Step 1: 安装依赖**
  安装 `commander`（生产依赖）。安装 `esbuild`（devDependency，用于独立打包 CLI bundle）。

- [ ] **Step 2: 实现基础命令结构**
  在 `commands.ts` 使用 `commander` 注册以下子命令：
  - `daemon status`：检测 Daemon 是否运行。
  - `exec --model <m> --prompt <p>`：向 Daemon 发送执行指令并等待结果。
  - `collect --session <id>`：获取指定会话的执行结果。

- [ ] **Step 3: 实现客户端通信机制**
  在 `client.ts` 中封装通过 `net.connect` 连接 Named Pipe、发送 JSON 行并等待返回结果的 Promise 逻辑。连接失败时输出明确提示："MultiChat 应用未运行，请先启动 MultiChat"，并以非零 exit code 退出。

- [ ] **Step 4: JSON 标准输出支持**
  确保命令能处理 `--json` 参数，使得 `stdout` 直接吐出结构化的执行结果，非零 exit code 处理错误。`stderr` 用于日志/错误信息，`stdout` 仅输出数据，便于管道使用。

- [ ] **Step 5: 配置独立打包与安装包分发**
  - 在 `package.json` 中新增 `"build:cli": "esbuild src/cli/index.ts --bundle --platform=node --target=node18 --outfile=out/cli/index.js"`，将 CLI 编译为单文件 bundle（无需 `node_modules`）。
  - 在 `build/multichat-cli.cmd`（Windows）中写入：
    ```batch
    @echo off
    "%~dp0..\resources\app.asar.unpacked\node\node.exe" "%~dp0..\resources\cli\index.js" %*
    ```
    或更简洁地使用 Electron 自带 Node：
    ```batch
    @echo off
    "%~dp0..\MultiChat.exe" --run-cli %*
    ```
    （具体调用方式根据 Electron 内置 Node 路径决定，验证时以实际路径为准。）
  - 在 `electron-builder.yml` 中新增：
    ```yaml
    extraResources:
      - from: out/cli/index.js
        to: cli/index.js
    extraFiles:
      - from: build/multichat-cli.cmd
        to: multichat-cli.cmd    # Windows: 安装根目录
    ```
  - 更新 `build:win:nsis` 等 script，在 `npm run build` 后先执行 `npm run build:cli`。

---

### Task 5: 重构 Renderer 与 Main 的通信桥梁

让现有的桌面 UI 接入新的 Main 进程执行引擎。**此 Task 影响范围最大，在 Task 1–4 全部验证通过后方可推进。**

**Files:**
- [MODIFY] `src/main/ipcHandlers.ts`
- [MODIFY] `src/preload/index.ts`
- [MODIFY] `src/preload/index.d.ts`
- [MODIFY] `src/renderer/src/store/appStore.ts`

- [ ] **Step 1: 定义新的 IPC 契约**
  在 `ipcHandlers.ts` 增加 `automation:start-session`, `automation:send-prompt`, `automation:collect` 等接口，返回统一结构 `{ success, data?, error? }`，并在 preload 中同步暴露。

- [ ] **Step 2: 改造 Zustand 编排逻辑**
  修改 `appStore.ts`，将原本直接调用 `webviewRef.current.executeJavaScript` 的逻辑，改为调用对应的 `window.api.automationSendPrompt` 等接口，并完整处理异步状态（排队、执行中、完成、超时、中止）。

- [ ] **Step 3: UI 兼容调整**
  确保 UI 层正确反映状态更新（排队、执行中、完成）。UI 仍然可以通过共享 `persist:shared` session 获取登录状态。

---

## Verification Plan

### Automated Tests
- 无现成的测试运行器，故依赖本地构建验证。
- 每个 Task 完成后运行 `npm run lint` 和 `npm run build`（含 `npm run build:cli`）确保各层类型检查和引用修改无误。

### Manual Verification

1. **Task 1–2 基础能力验证：**
   运行 `npm run dev`，通过 DevTools Console 或临时 IPC 触发，确认隐藏 `BrowserWindow` 能在 `persist:shared` session 下正常加载平台页面并执行 DOM 注入。

2. **Task 3–4 CLI 端到端验证（开发期，使用 npx tsx）：**
   - 保持桌面端运行（`npm run dev`）。
   - 另开终端执行 `npx tsx src/cli/index.ts daemon status`，预期输出 `Daemon is running`。
   - 执行 `npx tsx src/cli/index.ts exec --model gemini --prompt "测试CLI连接"`，预期返回执行状态。
   - 验证 `--json` flag 时控制台仅输出干净的 JSON 结果。

3. **CLI 安装包分发验证（Task 4 Step 5 完成后）：**
   - 执行 `npm run build:win:nsis` 打包安装包。
   - 安装后，在**未安装 Node.js 的机器**上（或 `PATH` 中无 Node 的环境下），在安装目录打开终端执行 `.\multichat-cli.cmd daemon status`，确认 CLI 可正常运行。
   - 验证 `--json` 输出与 macOS/Linux 的 wrapper 脚本在对应平台上等效运行。

4. **Task 5 桌面 UI 完整性回归：**
   运行 `npm run dev`，执行完整的"发送问题 → 等待 → 返回结果"流程，验证 `appStore` 到 `Main Service` 的接力是否正常，确保所有平台 UI 均无退化。
