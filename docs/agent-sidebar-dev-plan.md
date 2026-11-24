> Created: 2026-11-23 23:30 (Asia/Shanghai, UTC+08:00)

# 工作台本地 Agent 开发方案

在工作台右侧 AI 侧边栏中接入一个本地运行的 Agent（基于 Pi），复用现有 `WebviewCard` 卡片框架作为外壳，支持 AGENTS.md 自动加载、仓库级与全局级 Skills、三档权限模式与流式工具调用 UI。

本文档是完整开发方案，调研结论见：
- `docs/agent-sidebar-ui-research.md`（UI 选型、工具渲染、审批交互）
- `docs/pi-agent-ecosystem-research.md`（AGENTS.md / Skills / Shell 机制）
- `docs/agent-sidebar-dev-plan-review.md`（独立审查报告，本文档已按 P0/P1/P2 逐条修正）

---

## 一、需求拆解与决策结论

| 需求 | 结论 | 关键依据 |
|---|---|---|
| Agent 引擎 | `@earendil-works/pi-coding-agent` 的 `createAgentSession()` SDK（路径 A），消息状态自持 | 已封装工具装配/会话持久化/上下文压缩，且支持自定义工具与拦截钩子；核心零 native 依赖，Electron main 可直接 `import` |
| 外壳 | 复用 `WebviewCard` 框架：`compact + isolated + flat`，不挂 webview，content 区域换成 React Agent UI | 侧边栏已有 `slotIndex={99} isolated` 的 Webview 卡片挂载机制；Pi 是纯 TS 不需要 webview 容器 |
| 聊天 UI | `@assistant-ui/react` 的 `useExternalStoreRuntime` + `ChatModelAdapter` | 唯一为"非 Vercel AI SDK 后端"设计一等接入机制的库；消息源强制放 Zustand/主进程，正好对齐 |
| 流式渲染 | assistant-ui Thread viewport + `react-markdown`/`remark-gfm`（已有依赖） | 不自建流式增量渲染，避开 markdown 半成品、工具 part 交错、滚动跟随这些坑 |
| 工具渲染 | `makeAssistantToolUI` 按 `bash`/`edit`/`read` 注册折叠卡片；diff 用 `react-diff-view` | 业界收敛模式 = 消息流内联单行摘要 + drawer 展开；`diff2html`/monaco 都不合适 |
| AGENTS.md | Pi 自带 `DefaultResourceLoader`：cwd 向上递归到 git root + `~/.pi/agent` 全局层 + CLAUDE.md fallback | 不用自研；UI 只需暴露"注入了哪几个规则文件" |
| Skills | 项目级 `.agents/skills` + `.claude/skills`（兼容），全局级 `~/.pi/agent/skills`；解析 `name`/`description`/`allowed-tools`/`user-invocable`/`disable-model-invocation` | SKILL.md 已成事实标准；`allowed-tools` 直接对接权限模式；复用现有 `extraResources` 打包链路发内置 skill |
| Shell 工具 | `child_process.spawn`（优先）/ `execa`；PowerShell `-NoProfile -NonInteractive`；`shell-quote` 解析 | 不用 node-pty（Electron 要 electron-rebuild）；`shell-quote` 做命令链/重定向 AST 解析 |
| 权限模式 | 三档：`完全访问` / `受限模式`（默认）/ `只读模式`；受限模式按"白/灰/黑"三段式判定 | 对齐 Claude Code `default`/`acceptEdits`/`plan`；hard-deny 清单任何模式都拦 |
| 审批 UI | 内联审批卡片：`允许` / `总是允许[参数模式]` / `拒绝`；"总是允许"粒度到 `工具名+参数模式` | 对标 Claude Code 三档选项；assistant-ui `requires-action` part status 天然承载 |
| LLM 凭证 | **复用 Pi 自带 `AuthStorage`**（`~/.pi/agent/auth.json` 或自定义路径）+ `ModelRegistry.getProviderAuthStatus()`；设置页 UI 只做 provider 下拉 + key 输入，调 `AuthStorage.modify()` 写入 | Pi 已内置 40+ provider（anthropic/openai/deepseek/google/openrouter/…）+ OAuth 刷新 + 凭证 CRUD；不自建凭证结构 |

---

## 二、架构总览

```
┌─ WorkbenchPage ─────────────────────────────────────────────┐
│  rightPane = 'ai'                                            │
│  └─ WorkbenchAiSidebar                                       │
│       ├─ Model Picker（新增 "本地 Agent" 选项，仅工作台模式可见）│
│       ├─ 当前 model = webview 平台 → 现有 WebviewCard 逻辑      │
│       └─ 当前 model = 'local-agent' → AgentCard (新增)         │
│            ├─ 顶部栏：新会话 / 历史 / 折叠                     │
│            ├─ assistant-ui Thread（消息流）                   │
│            └─ Composer（附件 + 权限模式 + 发送/停止）           │
└──────────────────────────────────────────────────────────────┘
         │ IPC (window.api.agent*)
         ▼
┌─ Main 进程 ──────────────────────────────────────────────────┐
│  AgentSessionService（新）                                    │
│   ├─ Pi AgentSession（createAgentSession, cwd=用户项目目录）   │
│   ├─ PermissionEngine（新）：三档模式 + 白/灰/黑策略表 + allowlist│
│   ├─ SkillLoader（薄封装 DefaultResourceLoader + .claude 兼容） │
│   ├─ ShellTool（新）：spawn/execa + shell-quote 解析           │
│   └─ EventBridge：Pi AgentEvent → webContents.send            │
└──────────────────────────────────────────────────────────────┘
```

**数据流（一次 prompt）**：
1. Renderer 调 `window.api.agentPrompt(sessionId, text)` → 主进程 `AgentSession.prompt(text)`
2. Pi 发 `agent_start → turn_start → message_update×N → tool_execution_* → agent_end`
3. `EventBridge` 把每个 `AgentEvent` 经 `webContents.send('agent:event', {sessionId, event})` 推到 renderer
4. Renderer 的 `PiEventAdapter` 把事件增量写进 Zustand `agentSessionStore`
5. `useExternalStoreRuntime` 的 `convertMessage` 把 store 消息转成 `ThreadMessage` 渲染
6. 需审批的 `tool_execution_start` 在受限模式下被 `PermissionEngine` 挂起 → 经 IPC 推 `approval_request` → UI 渲染审批卡片 → 用户点击 → `agentResolveApproval` → `PermissionEngine` 放行/拒绝 → Pi 继续执行

---

## 三、模块拆分与落地细节

### 3.1 Model Picker 扩展

**改动点**：`WorkbenchAiSidebar.tsx`（分叉渲染）+ `WebviewCard.tsx`（下拉注入）

下拉数据源与渲染实际在 `WebviewCard.tsx` 内部（`availableModels` 计算于 WebviewCard:290，下拉是 `CustomDropdown`），sidebar 里的 `availableModels` 只是挂载循环用的数组。因此分两层处理：

- **`WebviewCard` 加 prop** `extraModelOptions?: DropdownOption[]`：在现有 `modelOptions` 前面拼接该数组，仅注入 UI 选项不进 `appStore.models`（避免污染主界面多 AI/任务分配/辩论）。
- **`WorkbenchAiSidebar`**：
  - 向 `WebviewCard` 传 `extraModelOptions = [{ value: 'local-agent', label: '本地 Agent', logo: <AgentIcon/> }]`，仅当 `captureContext === 'workbench'`（实际就是本侧边栏场景）。
  - `handleModelChange` 拦截：选中 `'local-agent'` 时只调 `setSidebarModelId(modelId)`，**不加入** `mountedSidebarModels`（那是 webview 挂载集合）。
  - 渲染分叉放 `availableModels.map(→WebviewCard)` **之外**：`{currentModel.id === 'local-agent' ? <AgentCard/> : <webview 挂载循环>}`。这样 'local-agent' 不会被 `availableModels.find` 命中后去渲染不存在的 webview。
- `sidebarModelId` 允许存 `'local-agent'`；`workbench_sidebarModelId` 持久化不变。
- `mountedSidebarModels` 机制保留：切到 Agent 时 webview 卡片容器 `display:none`（webview 实例不销毁），与现有行为一致。
- `currentModel` 计算：`availableModels.find(m => m.id === sidebarModelId)` 需把伪条目也算进去（在 sidebar 的 `availableModels` 前面插一条），否则切到 'local-agent' 后 `currentModel` 回退到第一个 webview 模型。

**原型对照**：下拉第一项"本地 Agent"带 Active badge + 蓝色图标，下面 webview 平台列表不变。

### 3.2 AgentCard（侧边栏 Agent 界面）

**位置**：`src/renderer/src/components/workbench/AgentCard.tsx`（新）

复用 `WebviewCard` 的外壳结构但**不继承**它，因为 header/content 完全不同：

```
<div className="flex flex-col h-full bg-white">          ← flat 外壳
  <header className="h-11 px-3 border-b flex ...">        ← 复用 WebviewCard 的 header 布局
    <ModelPickerDropdown />                                ← 复用现有下拉组件
    <div>+新会话 / 历史菜单 / 折叠按钮</div>
  </header>
  <div className="flex-1 flex flex-col min-h-0">
    <AssistantRuntimeProvider runtime={externalStoreRuntime}>
      <Thread />                                          ← assistant-ui 提供
    </AssistantRuntimeProvider>
    <AgentComposer />                                     ← 自建底部输入区
  </div>
</div>
```

**顶部栏三个按钮**（原型要求的全部功能）：
- `+` 新会话：`window.api.agentNewSession()`，清空当前 store 会话，focus 输入框
- `历史`：下拉列出主进程 agent 会话（见 §3.7），点击恢复。**注意这是新做不是复用**：现有 `WebviewCard` header 只有下拉 + `headerActions` 一个槽位，"新会话按钮 + 历史菜单 + 折叠按钮"三件套要在 `AgentCard` header 里重新实现（含列表加载态/空态/条目删除），工作量按新组件估
- `折叠`：`closeRightPane()`（已有 action）

**Composer**（原型底部输入区）：
- textarea 自适应高度，Enter 发送 / Shift+Enter 换行
- `+` 附件按钮：调 `window.api.selectFile()`（现有单选；多选需扩展 `select-files` handler），把选中文件路径以 `@path` 形式追加进 prompt（Pi 原生支持 `@file` 注入）
- 权限模式 selector：popover 三档，状态写 `agentSessionStore.permissionMode` + IPC 同步主进程
- 子 agent 状态指示：显示当前运行 model（`SWE-2 · Devin` 这类），运行中转圈
- 发送/停止圆形按钮：`isRunning` 时显示方块调 `agentAbort`，否则显示箭头调 `agentPrompt`

**文件树拖拽/右键"发送到 AI"适配**（现有入口不能断）：
现有 `WORKBENCH_UPLOAD_NODES_EVENT` / `handleDrop` / `uploadFilesToCurrentModel` 管线绑在 webview `ref.uploadFile` 上，`local-agent` 下拿不到 webview ref 会报错。处理：`uploadFilesToCurrentModel` / `handleSendFile` / `handleSendImage` / `handleUploadNodes` 四个入口在 `currentModel.id === 'local-agent'` 时改走 agent 附件通道——文件路径直接作为 `@path` 拼进 prompt（比 webview 上传还简单，不需要 FileUploadData）。

### 3.3 消息流与流式渲染

**接入方式**：`useExternalStoreRuntime`

```ts
// src/renderer/src/store/agentSessionStore.ts（新）
interface AgentMessage {
  id: string
  role: 'user' | 'assistant' | 'tool'
  content: PiContentPart[]   // text | reasoning | tool-call，按 contentIndex 排列
  status: 'running' | 'complete' | 'aborted' | 'error'
}

const runtime = useExternalStoreRuntime<AgentMessage>({
  messages: agentStore.currentMessages,
  convertMessage: (m) => ({
    role: m.role,
    content: m.content.map(partToThreadPart),  // → text/reasoning/tool-call parts
    status: m.status,
  }),
  onNew: async (text) => window.api.agentPrompt(sessionId, text),
  isRunning: agentStore.isRunning,
})
```

**Pi 事件 → Zustand 的适配器**（`PiEventAdapter.ts`，renderer 侧）：
- `message_update`：按 `ev.message`（累计 partial）覆盖更新当前 assistant message
- `tool_execution_start`：追加 `tool-call` part（`args` 流式）
- `tool_execution_end`：回填该 `toolCallId` 的 `result`/`isError`/`durationMs`
- `agent_end`：把最后一条 assistant message `status` 置 `complete`（或按 `error.reason === 'aborted'` 置 `aborted`）
- 并行工具执行时按 `toolCallId` 而非 index 回填
- **API 名以 1.6 实测为准**：`createAgentSession`/`SessionManager.inMemory()`/`FileUploadData` 等在调研中未逐一验证签名，M1 前先跑 `node -e "import('@earendil-works/pi-coding-agent').then(m=>console.log(Object.keys(m)))"` 确认导出

**工具卡片**：`makeAssistantToolUI` 注册三个：
- `BashToolUI`：单行 `已运行 <cmd 截断>` + chevron；展开 `<pre>` 终端块（stdout 截尾保留 200 行）
- `EditToolUI`：单行 `编辑了 <file>` + 文件 chip；展开 `react-diff-view` 渲染 unified diff
- `ReadToolUI`：单行 `读取 <file>:<lines>` + 行号范围；展开代码块
- 兜底 `ToolFallback`：通用 JSON 参数/结果

### 3.4 权限引擎（PermissionEngine）

**位置**：`src/main/services/PermissionEngine.ts`（新）

**三档模式**（与原型对齐）：

| 模式 | UI 文案 | 行为 |
|---|---|---|
| `full` | 完全访问 | 除 hard-deny 清单外全部自动放行；记录审计日志 |
| `restricted` | 受限模式（默认） | 白名单直放 / 灰名单弹审批 / 黑名单直拒 |
| `readonly` | 只读模式 | 只允许无副作用命令 + read/list/grep 工具；一切写操作直拒 |

**命令判定管线**（受限模式）：
```
rawCommand
  → shell-quote.parse() 得 op 序列
  → 拆链：遇 `&&`/`;`/`|`/`>` 把每一段单独判定，任一命中高危 → 整体升一级
  → 命令头匹配策略表：
      白名单：Get-*/ls/cat/git status|log|diff/npm ls|tsc --noEmit|eslint|vitest run|...
      黑名单：rm -rf /|Format-|del /s C:\|Set-Content $env:WINDIR|curl*|iex|reg delete|...
      灰名单：其它一切（含写文件工具 edit/write、未在白名单的命令）
  → 灰名单 → 挂起 → IPC 'agent:approval-request' → UI 审批卡片
```

**hard-deny 清单**（任何模式都拦，原型"完全访问"也要保留）：
- `rm -rf /`、fork bomb、写 `.ssh/`/`$env:WINDIR`、`format`、`dd of=/dev/`
- 管道进 `iex`/`Invoke-Expression`/`eval` 的远程执行模式
- `shutdown`、`Restart-Computer`、`Stop-Process -Name system` 级系统命令

**"总是允许"机制**：
- 粒度 `工具名 + 参数模式`：`bash + "npm *"`、`edit + "<workspace>/**"`
- 存主进程 `electron-store` key `agent_permission_allowlist`，结构 `[{ tool, pattern, createdAt }]`
- UI 审批卡片 `总是允许` 按钮带小箭头，点击后展开模式输入框（默认填当前命令的前缀模式）

### 3.5 Skills 与 AGENTS.md 加载

**位置**：`src/main/services/AgentResourceLoader.ts`（新，薄封装 `DefaultResourceLoader`）

- `cwd` 参数 = 用户在工作台打开的项目根目录（从 `workbenchStore.workspacePath` 拿，**类型 `string | null`**）。`workspacePath === null` 时的边界策略：composer 输入框禁用 + placeholder 提示"先在工作台打开一个文件夹"；或 fallback 到用户主目录并在 AgentCard header 显示当前 cwd。推荐前者——语义清晰且不会意外在用户主目录下扫 AGENTS.md/skills
- **AGENTS.md**：用 `DefaultResourceLoader` 默认行为，向上递归到 git root + `~/.pi/agent/AGENTS.md` 全局层；保留 `CLAUDE.md` fallback；暴露 `getAgentsFiles()` 给 UI 显示"已注入 N 个规则文件"
- **Skills**：
  - 项目级：`.agents/skills`（loader 默认）+ **额外加 `.claude/skills`** 扫描源（用 `skillsOverride` 扩展 loader）
  - 全局级：`~/.pi/agent/skills`（loader 默认）
  - frontmatter 解析 `name`/`description`/`allowed-tools`/`user-invocable`/`disable-model-invocation`，`allowed-tools` 透传给 `PermissionEngine` 做白名单判定依据
  - 应用内置 skill：**与 `multichat-cli` 分离**。`multichat-cli` 教外部 agent 调 MultiChat CLI 驱动 webview 平台，把它注入本地 agent 会改变语义（变成"本地 agent 编排远端平台"）。本期不加这个能力，内置 skill 走独立目录 `resources/agent-skills/`（复用 `extraResources` 打包模式，但内容与 multichat-cli 解耦）；将来若要做本地 agent 编排 webview 平台再单独设计
- **AppendSystemPrompt**：支持 `~/.pi/agent/APPEND_SYSTEM_PROMPT.md` + `<cwd>/.pi/APPEND_SYSTEM_PROMPT.md`

### 3.5.1 模型与凭证配置（新增）

本地 Agent 的 LLM 调用走 `pi-ai` 的 provider 抽象。**凭证与 provider 注册表完全复用 Pi 自带实现，不自建**：

- **存储**：`AuthStorage`（`pi-coding-agent` 导出，`~/.pi/agent/auth.json` 默认路径，可传 `authPath` 指到 MultiChat 数据目录）。`Credential` 结构已定型：`{type:'api_key', key, env?}` 或 `{type:'oauth', ...}`，CRUD 走 `AuthStorage.modify(providerId, fn)`，UI 只需这层薄封装。
- **Provider 注册表**：`pi-ai` 内置 40+ provider（`anthropic`/`openai`/`deepseek`/`google`/`openrouter`/`groq`/`mistral`/`xai`/`together`/`fireworks`/`huggingface`/`github-copilot`/`openai-codex`/`qwen-*`/`zai`/`minimax`/`xiaomi`/`baseten`/`cerebras`/`cloudflare-*`/`amazon-bedrock`/`azure`/`google-vertex`/`vercel-ai-gateway`/`opencode`/`radius`/`meta`/`ant-ling`/`kimi-coding`/`moonshotai`/`nvidia`/…），每个 provider 有 `.models.js` 模型清单。
- **运行时**：`ModelRegistry`（`pi-coding-agent`）已封装 `getAvailable()`（只回有凭证的模型）、`getProviderAuthStatus(providerId)`、`streamSimple()`（自动带 auth）。`AgentSession` 的 `modelRuntime` 直接传它。

**设置页 UI**（新增"本地 Agent"区块，只做薄壳）：
- Provider 下拉：数据源 = `ModelRegistry.getAll()` 按 provider 分组，或静态展示常用 6-8 个（anthropic/openai/deepseek/google/openrouter/groq）+ "全部"展开
- API key 输入（password 型）：调 `window.api.agentSetCredential(providerId, {type:'api_key', key})` → 主进程 `AuthStorage.modify()`
- Model 选择：数据源 = `ModelRegistry.getModelsOfType('chat', providerId)`；已配置凭证的 provider 置顶
- 状态显示：复用 `ModelRegistry.getProviderAuthStatus()` 返回的 `{ok, error?}` 渲染"已配置/未配置/错误"

**凭证安全**：`agentSetCredential`/`agentDeleteCredential` 是唯一写口；读接口只回 `CredentialInfo`（`{providerId, type}`）不回 key；preload 不暴露任何读 key 的接口。

**PoC 前置**：M0 直接 `AuthStorage.create()` + `modify('anthropic', {type:'api_key', key: env.ANTHROPIC_API_KEY})` + `ModelRegistry.getAvailable()` 验证链路。

### 3.6 Shell 工具

**位置**：`src/main/services/ShellTool.ts`（新）

```ts
// 最小实现：spawn + powershell
import { spawn } from 'node:child_process'
spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', cmd], {
  cwd, env, timeout: 30_000,
})
// 复杂需求升级到 execa：流式输出、AbortSignal、maxBuffer
```

- 不接 node-pty（本期无交互式 TUI/REPL 需求）
- Windows 兼容：`.cmd`/`.bat` 必须走 `shell: true` 或显式 `cmd.exe /c`；`.ps1` 加 `-ExecutionPolicy Bypass`
- `shell-quote` 解析命令链喂给 `PermissionEngine`
- 长任务（dev server）：Pi 的 tmux 后端在 Windows 不可用，退化到 spawn + detached + 单独 session 跟踪（放二期）

### 3.7 会话与历史持久化

**关键修正**：不能用 `SessionManager.inMemory()`——那等于放弃 Pi 自带的落盘恢复，`agentResumeSession` 就只剩"重建 messages 喂 context"的降级语义（工具调用细节退化为文本）。同时现有 `HistoryItem` 结构（`{models[], turns[].responses: Record<modelId, md>, productMode}`）与 agent 会话模型不匹配，硬塞会让现有历史列表读到畸形数据。

**方案：agent 会话走独立存储**（HistoryManager 加第三种 kind，不动现有 conversation/summary 结构）：

- **Pi 侧**：`SessionManager` 用文件持久化变体（不是 inMemory），session 目录指向 `history/agent-sessions/`（而不是默认 `~/.pi`）。恢复与续聊都是现成语义——`createAgentSession` 带 `sessionManager` 加载已有 session 文件即可继续对话。
- **MultiChat 侧**：`history/agent-sessions/` 目录下每个 session 一个文件，包含 Pi 的 messages + 元信息 `{ id, title, createdAt, updatedAt, cwd, model }`；`AgentHistoryIndex`（新）维护列表索引（id→title/时间/模型），供"对话历史"菜单快速列出。
- **HistoryManager 扩展**：`HistoryKind` 加 `'agent'`；`HistoryListItem` 加可选 `kind: 'agent'` 区分（不影响现有 conversation 列表）；现有列表 UI 若要展示 agent 会话可复用组件，只是数据源换目录。
- **消息双写**：Pi session 文件是权威（含 tool-call 结构）；Zustand `agentSessionStore` 是渲染层缓存，重启后从 Pi session 重建，保证 UI 恢复时不丢工具调用细节。

---

## 四、IPC 契约（新增）

`src/preload/index.ts` 加方法 + `src/main/ipcHandlers.ts` 加 handler + 渲染层调用点；`src/preload/index.d.ts` 与 `src/renderer/src/env.d.ts` 是 `declare global { api: API }` 自动派生类型，零改动。

| 方法 | 方向 | 载荷 | 说明 |
|---|---|---|---|
| `agentPrompt(sessionId, text, attachments?)` | r→m | `{sessionId, prompt}` | 发送用户消息 |
| `agentAbort(sessionId)` | r→m | `{sessionId}` | 终止当前 run |
| `agentNewSession(cwd)` | r→m | `{cwd}` | 新会话，返回 `{sessionId}` |
| `agentListSessions()` | r→m | - | 历史会话列表（`history/agent-sessions/` 索引） |
| `agentResumeSession(sessionId)` | r→m | `{sessionId}` | 恢复历史会话到内存 |
| `agentResolveApproval(requestId, decision)` | r→m | `{requestId, decision: 'allow' \| 'always' \| 'deny', pattern?}` | 审批回执 |
| `agentSetPermissionMode(sessionId, mode)` | r→m | `{mode}` | 切换三档权限 |
| `agentSetModel(sessionId, model)` | r→m | `{model}` | 切换底层 LLM |
| `agentListProviders()` | r→m | - | 返回 `[{providerId, displayName, configured, authStatus, models[]}]`（数据源 `ModelRegistry`/`AuthStorage.list()`，不含 key） |
| `agentSetCredential(providerId, cred)` | r→m | `{type:'api_key', key, env?}` | 写凭证 → `AuthStorage.modify()` |
| `agentDeleteCredential(providerId)` | r→m | `{providerId}` | 删凭证 → `AuthStorage.delete()` |
| `agentGetActiveModel()` | r→m | - | 当前 provider + model |
| `agent:event` | m→r | `{sessionId, event: AgentEvent}` | Pi 事件流 |
| `agent:approval-request` | m→r | `{requestId, sessionId, toolCallId, toolName, args, reason}` | 权限挂起请求 |

返回结构统一 `{ success, data?, error? }`。

**安全约束**：`requestId` 由主进程 `crypto.randomUUID()` 生成，renderer 只能从 `agent:approval-request` 事件获得；任何伪造/枚举 requestId 的调用直接拒绝。

---

## 五、依赖清单（新增）

| 包 | 用途 | 备注 |
|---|---|---|
| `@earendil-works/pi-coding-agent` | AgentSession + 内置工具 + DefaultResourceLoader | 核心，锁 ^1.x；**实施前 `npm view` 确认 canonical 包名**（调研报告写作时用 `@mariozechner/pi-coding-agent`，后迁移到 `@earendil-works`，以 npm 当前为准） |
| `@earendil-works/pi-agent-core` | 类型 + 底层事件（如路径 A 不够用再直接引用） | 传递依赖即可 |
| `@assistant-ui/react` | 聊天 UI runtime + Thread | 锁版本，升级时核对 `ExternalStoreRuntime` API |
| `@assistant-ui/react-markdown` | assistant-ui 的 markdown 集成 | 复用现有 `react-markdown`/`remark-gfm` |
| `react-diff-view` | unified diff 渲染 | 新增 |
| `shell-quote` | 命令链/重定向解析 | 新增，权限引擎用 |
| `execa` | shell 工具（可选升级） | 二期再加 |

**不引入**：`@mariozechner/*`（旧 scope 已弃）、`pi-tui`（终端 UI 不需要）、`pi-web-ui`（参考不依赖）、`node-pty`（无 TTY 需求）、`diff2html`/monaco diff（过重）。

**native/WASM 注意**：`pi-coding-agent` 的 `photon-node`（Rust WASM）只服务图片缩放，fallback 正常；`quickjs-wasi` 只在 codemode 扩展用，不启用即不触碰。打包时若启用图片 read，`photon_rs_bg.wasm` 需 `asarUnpack`。

---

## 六、实施顺序（建议里程碑）

| 里程碑 | 范围 | 验收点 |
|---|---|---|
| M0 | 凭证链路 PoC | `createAgentSession` 用 env `ANTHROPIC_API_KEY` 跑通一轮对话；`npm view` 确认包名 |
| M1 | AgentCard 骨架 + assistant-ui 接入 + Pi AgentSession | 在侧边栏输入文本能拿到流式回复；Model Picker 出现"本地 Agent"；未打开工作区时 composer 禁用 |
| M2 | 工具调用 UI：bash/edit/read 三卡片 + diff + 权限三档 + 凭证配置区 | 能看工具调用展开；只读模式禁写；设置页可配 provider/key |
| M3 | 受限模式审批流 + "总是允许" allowlist + hard-deny | 受限模式弹审批卡片；审批后执行；allowlist 持久化 |
| M4 | AGENTS.md + Skills 加载 + 项目 cwd 注入 | 工作目录下有 AGENTS.md 时 agent 行为体现规则；skill 可被路由 |
| M5 | 会话历史 + 新会话/恢复 + 边界情况（abort/切换/重启） | 历史菜单列出会话；刷新后会话可恢复 |
| M6 | 打包链路：resources skill、photon wasm、electron-builder 配置 | 打包后功能不退化 |

---

## 七、风险与对策

- **版本割裂**：`pi-web-ui@0.75.x` 依赖旧版 `pi-ai`，**不要混装** 0.75 和 1.6；参考代码思路但用 1.6 API
- **凭证安全**：API key 仅主进程 `AuthStorage`（JSON 文件）持有，`agentListProviders`/`agentGetActiveModel` 只回 `configured`/`CredentialInfo` 不回 key 本身；preload 不暴露任何读 key 的接口
- **未打开项目**：`workspacePath === null` 时 composer 禁用，不 fallback 到危险默认 cwd（避免在用户主目录误扫/误执行）
- **ESM/CJS**：pi 包是 `"type":"module"`，main bundle 若 CJS 需 `await import()` 动态加载
- **审批一致性**：审批状态以主进程 `PermissionEngine` 为准，UI 是视图；防 UI 本地判定与主进程分叉
- **审批失效**：用户在审批挂起时发新消息/切会话/点停止 → 该审批自动按"跳过该工具"处理
- **长输出**：bash stdout 几万行需截尾 + 虚拟化，防止 React 树卡死
- **PowerShell/CMD 双套**：策略表要覆盖 `rm`/`del`/`Remove-Item` 等双动词；执行 `.ps1` 脚本文件时受限模式整体升一级（脚本内部动作检测不到）
- **审计日志**：所有 shell 命令落盘（命令原文 + cwd + exitCode + timestamp），出问题是唯一回溯依据
- **assistant-ui 0.x 变动**：锁版本号，升级前看 `ExternalStoreRuntime`/`makeAssistantToolUI` changelog

---

## 八、明确不做（本期）

- 不接 node-pty / tmux 持久会话
- 不做插件市场（Pi 的 extension 体系只用于加载 skill/自定义工具）
- 不做 multi-agent / 子 agent 编排（Composer 旁的"子 agent 状态"只显示当前 model 名）
- 不做远端 agent 运行时（agent 只跑在本地主进程）
- 不改 `WebviewCard` 内部实现；Agent 是并列卡片不是其子类
