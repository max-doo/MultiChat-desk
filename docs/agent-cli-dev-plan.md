# MultiChat Agent CLI 开发方案（PRD + 技术设计）

> Created: 2026-11-16 14:51 (Asia/Shanghai, UTC+08:00)；Revised: 2026-11-16 15:00（经独立 worker 深审后修订）

前置阅读：[CLI_FEASIBILITY_ASSESSMENT.md](CLI_FEASIBILITY_ASSESSMENT.md)（既有可行性评估，本方案是其 Phase 4 的具体化）。

---

## 第一部分：产品需求（PRD）

### 1. 背景与问题陈述

MultiChat 的核心能力是：通过多个常驻 Webview 会话接入不同 AI 平台网页版，完成消息发送、回复采集、深度研究模式切换等页面级自动化。当前这些能力只服务于应用内 UI。

本地 Agent 类工具（Devin、Codex、Claude Code 等）在工作流中经常需要调用外部 AI 完成网络调研、撰写方案、评审方案等子任务。WebAI-to-API 项目验证了一个方向：把网页版 AI 包装成本地可调用的服务，供 Agent 程序化消费。MultiChat 具备同等的底层能力（登录态共享、页面自动化、回复提取），但缺少面向 Agent 的统一入口。

**核心矛盾**：网页版 AI 的响应是异步且耗时的（普通问答数十秒，深度研究可达十分钟以上），而 CLI/MCP 调用天然是请求-响应模型。直接同步等待会导致调用方长时间阻塞、无法获知中间状态、超时失控。

**目标**：让本地 Agent 通过 CLI 提交 AI 任务后立刻拿到任务句柄，由 Agent 自行决定挂起时长，到期获取实时状态，最终自动捕获完整回复。

### 2. 目标与非目标

**目标（一期）**

1. Agent 可以通过一条 CLI 命令向指定 AI 平台提交自由文本 query，立即获得 `taskId`。
2. Agent 可以通过 CLI 查询任务实时状态（排队中 / 准备中 / 发送中 / 生成中 / 完成 / 失败 / 已取消）。
3. Agent 可以指定"挂起时长"（wait）：提交或查询时附带 `waitMs`，daemon 端阻塞等待任务进入终态或超时，返回当时的实时状态；支持反复调用直至完成。
4. 任务完成后，Agent 可以获取完整的 AI 回复（Markdown 正文）及会话 URL。
5. 支持在已存在的平台会话中追问（可选），默认每次任务开新对话。
6. 支持开启平台 Deep Research 模式（可选开关），覆盖"网络调研"类长耗时场景。
7. 全部输出提供稳定的 `--json` 机器可读格式与语义化错误码。

**非目标（一期）**

- **MCP Server 封装**：一期只交付 CLI（Agent 本身就能 spawn CLI）；MCP 作为二期适配层，协议设计已预留。
- **平台内模型切换自动化**：`model` 参数一期仅作声明性元数据透传记录，实际使用平台页面当前选中的模型；模型下拉菜单自动化为二期。
- **多平台聚合调用**（一次提交、多平台并行、结果聚合）：二期。
- **流式回复输出**（SSE / 逐字符增量）：一期返回状态快照与最终全文，不流式。
- **OpenAI 兼容 HTTP API**：不引入 TCP 监听端口，仅本地 IPC。
- **桌面 UI 变更**：不改变现有 UI 交互；后台任务对 UI 透明。

### 3. 用户与使用场景

**主要用户**：本地运行的编码/办公 Agent（CLI 调用方），以及编写自动化脚本的开发者。

**典型场景**（仅为举例，接口为通用 query 提交，不限定场景）：

| 场景 | 调用方式 |
|---|---|
| 网络调研 | `task submit --platform gemini --research --query "调研 X 技术选型"` → 挂起等待 → 拿报告 |
| 撰写方案 | `task submit --platform claude --query "基于以下上下文写实施方案：..."` → 轮询 → 拿方案全文 |
| 评审方案 | `task submit --platform chatgpt --query "评审这份方案的问题：..."` → 拿评审意见 |
| 追问澄清 | `task submit --platform chatgpt --conversation <url> --query "补充第 3 点"` |
| 检查进度 | `task status <taskId>` / `task status <taskId> --wait 120` |

### 4. 功能需求

#### FR-1 任务提交

```
multichat task submit --platform <id> [--model <name>] [--research]
                      (--query <text> | --query-file <path> | stdin)
                      [--conversation <url>] [--timeout <sec>] [--wait <sec>]
```

- 必填：`--platform`（chatgpt / gemini / claude / grok / deepseek / qwen / kimi / doubao / perplexity / chatglm / yiyan / yuanbao / arena 等已配置选择器的平台）。
- `--model`：声明性元数据，记录进任务与结果；一期不做页面模型切换。
- `--research`：发送前在页面开启 Deep Research / 深度研究模式；平台未适配时立即返回 `CAPABILITY_UNSUPPORTED`。当前已适配 8 平台：chatgpt / perplexity / chatglm / gemini / grok / qwen / doubao / deepseek。
- query 支持三种输入方式，优先级：stdin（非 TTY）> `--query-file` > `--query`；统一上限 100,000 字符，超出返回 `INVALID_PARAMS`。
- `--conversation <url>`：在既有会话页面上追问；daemon 会校验 URL 属于该平台且是会话地址（非首页/登录页），不合法返回 `INVALID_PARAMS`。
- `--timeout`：任务级硬超时（秒），自进入 `preparing` 起计；默认普通 600、research 1800，上限 7200。
- `--wait`：本次调用在 daemon 端阻塞等待的秒数；缺省 0（提交后立即返回）。提交+等待在**同一次 IPC 请求**内完成，避免拿到 taskId 前的断开窗口产生孤儿任务。
- 同步校验先行：参数/平台/能力/URL 校验失败直接返回错误，**不产生 taskId**；校验通过返回 `{ taskId, phase, queuedPosition? }`。

#### FR-2 状态查询与挂起等待

```
multichat task status <taskId> [--wait <sec>]
```

- 返回任务视图：`{ taskId, phase, queuedPosition?, elapsedMs, replyChars, busy, conversationUrl?, error? }`。
- `--wait`：daemon 端长轮询，任务进入终态立即返回；超时返回当前状态（退出码 0，`phase` 表明仍在运行）。
- `replyChars` 让 Agent 不抓全文也能感知生成进度；`queuedPosition` 告知排队位次。
- 已结束的持久化任务：`status` 可读盘返回历史终态视图（见 §13）。

#### FR-3 结果获取

```
multichat task result <taskId>
```

- 统一返回 `{ taskId, phase, reply?, conversationUrl?, durationMs?, error? }`；`reply`（完整 Markdown）仅 `done` 时有值，非终态返回当前状态视图。
- 内存 miss 时读持久化记录；两者皆无 → `TASK_NOT_FOUND`。

#### FR-4 取消与列表

```
multichat task cancel <taskId>
multichat task list [--all] [--platform <id>]
```

- `cancel` 幂等：终态任务返回当前 phase（no-op）；`queued`/`preparing` 直接中止；`sending` 起标记取消、待页面脚本返回后置 `cancelled`——**此时 prompt 可能已发出**，回复仍会出现在网页端。
- `list`：活跃任务；`--all` 合并内存中已结束任务与磁盘持久化记录；`--platform` 过滤。

#### FR-5 平台能力清单

```
multichat platforms
```

- 返回已适配平台及能力标记：`{ id, deepResearch, busySignal: 'adapted' | 'generic', followUp }`。
- `busySignal` 表示完成检测是否有平台专用停止按钮选择器（仅 chatgpt / claude / gemini / deepseek 为 `adapted`），供 Agent 评估完成判定可靠度。

#### FR-6 会话与并发语义

- 每个平台一个后台会话窗口（`sessionKey = __agent_<platform>`），与 UI Webview 共享 `persist:shared` 登录态。
- 同一平台任务串行（FIFO 排队）；不同平台任务可并行。
- 默认每次任务导航到 `newConversationUrl` 开新对话；`--conversation` 恢复既有页面追问。
- 生成期间持续捕获 `conversationUrl` 供追问与溯源（部分平台发送后 URL 立即变化，部分平台第一轮结束才变化）。

#### FR-7 输出与错误契约

- `--json` 全局生效：stdout 只输出结构化数据，诊断/错误一律 stderr。
- 响应统一 `{ success, data?, error?, code? }`：`error` 保留人读字符串（向后兼容现有 `DaemonResponse`），`code` 为新增的稳定机器枚举（见 §10）。
- 退出码：成功/状态查询正常 = 0；参数错误 = 2；执行失败 = 1。

### 5. 依赖与前置条件

- MultiChat 桌面应用必须正在运行（daemon 在主进程内）；CLI 只做薄客户端。
- 目标平台已在任一 Webview/后台会话中完成登录（共享 `persist:shared`）。**注意**：UI 侧退出登录/切换账号会使运行中的 agent 任务失败（`AUTH_LOST`）。
- 网络可达目标平台站点；页面无验证码/登录墙拦截。

### 6. 验收标准

1. `task submit` 在 ≤2s 内返回 taskId（不等待页面发送完成）。
2. 普通 query 完成后 `task result` 返回与页面可见回复一致的 Markdown 全文。
3. `task status --wait N` 在任务完成时立即返回，未完成时约 N 秒后返回实时状态。
4. `--research` 在已适配平台触发深度研究并能取回报告正文；未适配平台报 `CAPABILITY_UNSUPPORTED`。
5. 同平台连续提交两个任务，第二个处于 `queued` 并在第一个完成后自动执行。
6. `--conversation` 追问落在同一会话页面（URL 不变）。
7. Agent 端全程只读 stdout 即可解析所有结果（`--json`）。
8. CLI 端中途断开的 `--wait` 不在 daemon 残留监听器（重复 N 次后 `task.list` 与日志无泄漏迹象）。

---

## 第二部分：技术设计

### 7. 总体架构

```
Agent / 脚本 (spawn)
    │
    ▼  stdout/stderr, --json
multichat-cli  (ELECTRON_RUN_AS_NODE → out/cli/index.js)
    │  Named Pipe \\.\pipe\multichat-daemon（Unix: sock；全平台 token）
    ▼  NDJSON request/response + waitMs 长轮询
Daemon ipcServer  (src/main/daemon/ipcServer.ts)
    │
    ▼  task.* 动作路由
AgentTaskService  (新增 src/main/services/AgentTaskService.ts)
    ├── 任务注册表 + 状态机 + per-platform FIFO 队列 + 轮询器 + 结果持久化
    ├── SessionManager     后台隐藏 BrowserWindow（persist:shared）
    ├── AutomationService  选择器/URL/注入发送/回复抓取
    └── webviewScripts     页面状态探测、回复提取、DR 开关脚本
```

借鉴 WebAI-to-API 的三个模式：

| WebAI-to-API | MultiChat 对应 |
|---|---|
| `ProviderSession` 持有 `PersistentTab` 池 | `SessionManager` 持有按 sessionKey 的隐藏窗口 |
| `ManagedPage` 租约（信号量 + 租约校验） | 任务对 sessionKey 的独占租用（lease，见 §11） |
| 请求级 abort + 确定性 teardown + 代际失效 | 任务 AbortController + 窗口销毁即任务终态 `SESSION_LOST` |

不引入 HTTP 端口；CLI 沿用现有 `ELECTRON_RUN_AS_NODE` 包装，零新运行时依赖。

### 8. 任务模型与状态机

```ts
type AgentTaskPhase =
  | 'queued'      // 已入队，等待平台会话空闲
  | 'preparing'   // 建会话/导航新对话/页面就绪检查
  | 'sending'     // 注入 prompt + 提交（可含 DR 开启步骤）
  | 'generating'  // 已提交，轮询回复直至稳定
  | 'done'        // 回复采集完成
  | 'failed'      // 任何阶段失败
  | 'cancelled'   // 调用方取消

interface AgentTask {
  id: string                    // UUID
  platform: string
  model?: string                // 声明元数据（一期不做页面切换）
  mode: 'chat' | 'deep_research'
  query: string                 // ≤ 100,000 字符
  sessionKey: string            // `__agent_${platform}`
  conversationUrl?: string      // 生成期间持续捕获
  followUpUrl?: string          // 入参 --conversation（已校验平台归属）
  phase: AgentTaskPhase
  reply: string                 // 当前已采集正文（generating 时为 partial）
  baseline: string              // 发送前页面最新回复，作差分基线
  replyChars: number
  stableCount: number
  emptyReads: number            // 连续空采计数（登录墙/页面异常升级用）
  busy: boolean                 // 页面停止按钮是否仍存在
  queuedPosition?: number
  createdAt: number             // submit 入队时刻
  startedAt?: number            // 进入 preparing 时刻（timeoutMs 起点）
  completedAt?: number
  timeoutMs: number             // 任务硬超时（preparing→终态）
  queueTimeoutMs: number        // 排队超时（默认 = timeoutMs）
  error?: { code: string; message: string }
  abort: AbortController        // 内部，不外传
  cancelRequested?: boolean     // sending 起置位，脚本返回后转 cancelled
}
```

状态流转：

```
submit → queued ──(会话空闲)→ preparing → sending → generating → done
              │                  │           │          │
              └─(queueTimeout)→──┴───────────┴──────────┴→ failed
              └──────────(cancel 任意时刻可入)───────────→ cancelled
```

**preparing 阶段细分**（修正：`ensureSessionReady` 只保证窗口存在并等待"已在加载"的页面，不负责导航）：

1. `sessionManager.getOrCreateSession(sessionKey)` — 窗口不存在则以平台 URL 创建；存在则原样返回（可能停在旧会话页）。
2. **显式导航**：新对话 → `await win.loadURL(selectors.newConversationUrl)`；追问 → `await win.loadURL(followUpUrl)`。`loadURL` 的 Promise resolve 即 `did-finish-load`、reject 即 `did-fail-load`，再加 ~1.5s 水合等待。
3. **就绪探针循环**：`generateMindmapPageStateScript` → `{ ready, busy }`，直到 `ready=true`；30s deadline 未就绪 → `PAGE_NOT_READY`（覆盖未登录/验证码场景）。
4. **空白校验**：新对话任务采集一次回复确认无历史消息（`NOT_BLANK_CONVERSATION`）；追问任务采集 `baseline` 供差分。
5. research 模式 → `generateEnableDeepResearchScript(selectors.researchMode)`（隐藏窗口为纯 DOM 操作，可复用；含 hover 步骤的平台需实测）。

**sending**：`generateSendMessageScript` 注入并提交，**对 agent 任务强制开启 verifySubmission**（确认输入框清空才算提交成功；现有实现仅附件场景启用，需给该生成函数加显式开关）。返回失败 → `SEND_FAILED`。

**generating**：进入轮询（§9），每轮顺带刷新 `conversationUrl`。

**取消语义**：`queued`/`preparing` 直接 abort；`sending`/`generating` 置 `cancelRequested`，当前页面脚本返回后转 `cancelled`（页面脚本不可中途撤销，prompt 可能已发出）。

**终态顺序固定**（crash 一致性）：① 写持久化结果 → ② emit phase-change（唤醒 wait 订阅）→ ③ 释放租约 + 出队下一个。

窗口在任务中途被销毁 → `failed(SESSION_LOST)`（借鉴 poisoned page 不可复用原则：不自动重建续跑）。

### 9. 回复完成检测（核心算法）

把渲染层 `appStore.pollPlatforms` 的范式下沉到主进程，每任务一个轮询循环：

```
interval = 1500ms（generating 阶段）
每轮：
  1. executeJavaScript(generateMindmapPageStateScript) → { ready, busy }
  2. executeJavaScript(generateGetLatestResponseScript) → text
  3. 顺带捕获 conversationUrl = wc.getURL()（规范化后存 task）
  4. 判定：
     - text 为空或 === baseline：
         emptyReads++；ready=false 且 emptyReads ≥ 8 → 升级失败
         （URL 跳登录页 → AUTH_LOST；否则 PAGE_NOT_READY）
         否则 stableCount = 0，继续
     - text !== lastText → lastText = text, stableCount = 0, emptyReads = 0
     - text === lastText && !busy → stableCount++
     - stableCount >= threshold → done（reply = lastText）
     - Date.now() > startedAt + timeoutMs → failed(TASK_TIMEOUT)
```

要点（均有现成实现可复用）：

- **baseline 必须发送前采集**（`readPassiveResponse` 同思路）；新对话 baseline 为空（经空白校验）。
- **busy = 停止按钮存在**：`generationStopSelectors` 仅适配 chatgpt / claude / gemini / deepseek 4 平台，其余平台回退通用 `aria-label*="Stop"` 可能恒 false。
- **stableThreshold 分档**：`adapted` 平台 = 3 轮（≈4.5s 稳定，对齐渲染层 3s×3 ≈ 9s 的量级）；`generic` 平台与 `deep_research` 模式 = 8 轮（≈12s 稳定）兜底，防止 busy 信号缺失时把生成中的部分回复误判为完成。
- **空内容不计稳定**：生成中可能瞬时读空，不覆盖已采内容。
- **轮询只读 DOM、单次 executeJavaScript 设 10s 超时**（对齐 `readPassiveResponse` 的保护）。
- research 模式回复优先取 `reportContainer`——`generateGetLatestResponseScript` 已实现 report 容器提取与 shadow DOM/iframe 处理，直接复用。

### 10. Daemon 协议扩展（NDJSON over Pipe）

新增 `task.*` 动作命名空间，旧 `status/exec/collect` 保留不动。

| action | 请求字段 | 响应 data |
|---|---|---|
| `task.submit` | `platform, query, model?, mode?, conversationUrl?, timeoutMs?, queueTimeoutMs?, waitMs?` | `{ taskId, phase, queuedPosition? }` 或等 `waitMs` 后 `AgentTaskView` |
| `task.status` | `taskId, waitMs?` | `AgentTaskView`（waitMs>0 时长轮询） |
| `task.result` | `taskId` | `{ taskId, phase, reply?, conversationUrl?, durationMs?, error? }` |
| `task.cancel` | `taskId` | `{ taskId, phase }` |
| `task.list` | `includeFinished?: bool, platform?: string` | `AgentTaskView[]` |
| `platforms` | – | `[{ id, deepResearch, busySignal, followUp }]` |

`AgentTaskView`（对外视图，剔除内部字段）：

```ts
{ taskId, platform, model?, mode, phase, queuedPosition?, replyChars, busy,
  elapsedMs, conversationUrl?, error?: { code, message } }
```

**长轮询与原子性**：`waitMs` 置于 `task.submit`/`task.status` 请求内，daemon 在提交/查询后直接进入等待，**同一次 NDJSON 往返**完成——避免"submit 响应发出但 wait 请求未达"的孤儿任务窗口。`waitMs` 可选，缺省 0 = 立即返回当前状态。

**socket 生命周期清理**（重要）：`handleRequest` 的 `await` 不会被 socket `'close'` 中断。每个 pending wait 必须注册 `socket.once('close', …)` 解除 phase 订阅并 resolve；CLI 每请求新建 socket，断开即放弃响应。app `before-quit` 时先 `agentTaskService.shutdown()`（取消运行中任务、将所有 pending wait 以 `SESSION_LOST` resolve），再 `stopDaemonServer()`。

**同步校验**：`INVALID_PARAMS` / `PLATFORM_UNKNOWN` / `CAPABILITY_UNSUPPORTED`（含 `--conversation` URL 校验）在 `handleRequest` 内直接返回，不创建任务。

**响应契约**：`{ success, data?, error?, code? }`——`error` 保持 `string`（兼容现有 `DaemonResponse` 与 CLI `handleCommandResponse`），新增顶层 `code` 稳定枚举；`AgentTaskView.error` 为 `{code,message}` 对象（位于 `data` 内，无兼容负担）。

**客户端 socket 超时**：`src/cli/client.ts` 目前固定 `setTimeout(10_000)` 为 idle 超时；含 `waitMs` 的请求需放宽为 `waitMs + 5000`。

**错误码枚举**（`code` 顶层字段，机器可判）：

| code | 含义 | 阶段 |
|---|---|---|
| `DAEMON_UNAVAILABLE` | 应用未运行/管道不通/未授权 | client |
| `INVALID_PARAMS` | 参数缺失/非法/URL 归属错误/query 超限 | submit |
| `PLATFORM_UNKNOWN` | 平台无选择器配置 | submit |
| `CAPABILITY_UNSUPPORTED` | 如平台未适配 deep_research | submit |
| `PAGE_NOT_READY` | 就绪探针超时（未登录/验证码/加载失败）或 generating 持续空采 | preparing / generating |
| `AUTH_LOST` | generating 中页面跳转登录墙（含 UI 侧退出登录导致） | generating |
| `NOT_BLANK_CONVERSATION` | 新对话空白校验失败 | preparing |
| `SESSION_LOST` | 会话窗口中途销毁 / app 退出 | any |
| `SEND_FAILED` | 注入/提交失败（含 verifySubmission 未确认清空） | sending |
| `TASK_TIMEOUT` | 到达任务硬超时 | preparing→generating |
| `QUEUE_TIMEOUT` | 排队超过 queueTimeoutMs | queued |
| `TASK_CANCELLED` | 主动取消 | any |
| `TASK_NOT_FOUND` | taskId 内存与磁盘均无 | status/result/cancel |
| `INTERNAL` | 未分类异常 | any |

**既有 bug 修复（P0 前置）**：`ipcServer.ts` 的 `sendResponse` 引用了作用域外的 `req.token`——非 Windows 下**每次响应都抛 ReferenceError，CLI 当前在 macOS/Linux 完全不可用**。修复方式：鉴权移入 `handleRequest` 解析后统一执行，`sendResponse` 只做序列化写入。同时把 token 文件从 `\\.\pipe\*.token`（Windows 下非法路径，故原代码跳过校验）改为 `getDataPath()/daemon.token`，**全平台强制校验**。

**失败隔离**：任务失败不毒化 SessionManager/其他任务；窗口崩溃仅使本任务 `SESSION_LOST`。

### 11. 会话与并发模型

- **sessionKey = `__agent_${platform}`**：每平台一个后台窗口，复用 `SessionManager` + `persist:shared`；`webPreferences.backgroundThrottling=false` 已在 SessionManager 创建时设置（后台轮询必需）。
- **租约（lease）**：TaskService 新建 `Map<sessionKey, runningTaskId>` + 每 key FIFO 队列——**不复用 MindmapService 的 `idle` 字段**（那是"taskId 独占窗口"语义，与"platform 独占"不同）。任务进入 `preparing` 前取租约，终态按 §8 固定顺序释放并出队。同平台互斥避免输入框/页面状态互踩；跨平台天然并行。
- **导航由 TaskService 显式执行**：`getOrCreateSession` 不会替已加载窗口换址，`preparing` 必须自己 `await win.loadURL(target)` + 水合等待 + 就绪探针（复用 MindmapService 的 `readyDeadline` 循环模式）。
- **新对话**：目标 = `selectors.newConversationUrl`；就绪后做空白校验。
- **追问**：`followUpUrl` 先经 `isConversationUrlForPlatform(platformId, url)` 校验——需提取共享工具，合并 `MindmapService.sessionBinding`（origin + 会话路径/参数规则）与 `appStore.isSavableSessionUrl` 两套规则。
- **conversationUrl 捕获**：`generating` 轮询每轮读取 `wc.getURL()` 规范化存回（覆盖"发送后立即变"与"首轮结束才变"两类平台）。
- **窗口生命周期**：任务终态后窗口保留复用；一期不做 idle 释放，平台窗口上限 = 平台数。
- **UI 隔离**：sessionKey 前缀 `__agent_` 与 `__mindmap_` 同风格，互不抢占；与 UI webview 槽位无交集。

### 12. CLI 设计

```
multichat task submit --platform <id> [--model <name>] [--research]
                      (--query <text> | --query-file <path> | stdin)
                      [--conversation <url>] [--timeout <sec>] [--wait <sec>]
multichat task status <taskId> [--wait <sec>]
multichat task result <taskId>
multichat task cancel <taskId>
multichat task list [--all] [--platform <id>]
multichat platforms
multichat daemon status           # 既有
multichat exec / collect          # 既有，标注 deprecated 保留
```

实现要点：

- query 三通道：非 TTY stdin > `--query-file` > `--query`；统一上限 100,000 字符。
- `--wait` 直接翻译为请求内 `waitMs`（单次往返，见 §10）。
- 人读模式输出精简状态行 + 完成时打印 reply；`--json` 模式全量结构化输出，错误走 stderr（对齐既有 `handleCommandResponse` 与 stdout/stderr 分离纪律）。
- 退出码：0 成功；1 执行失败；2 参数错误。
- `submit` 响应在 `--json` 下固定 `{taskId, phase, queuedPosition?}`；`--wait` 后按 `AgentTaskView` 输出。

Agent 调用范式：

```bash
# 提交并最多挂起 120s；单次请求内完成，断开即放弃
multichat task submit --platform gemini --research --query "..." --wait 120 --json
multichat task status <taskId> --wait 120 --json    # 循环直至 phase=done
multichat task result <taskId> --json               # 取全文
```

### 13. 持久化

- 任务注册表：内存 `Map<taskId, AgentTask>`（daemon 随应用退出即失效，与页面生命周期一致）。
- 结果落盘：`<getDataPath()>/agent-tasks/<taskId>.json`——`done/failed` 终态时写入 `{ task, reply }`。`getDataPath()` 当前是 `src/main/index.ts` 私有函数且便携版会重定向（`<appPath>/../data`），**需导出**供 `AgentTaskService.init(dataPath)` 注入；注意便携版 `userData` 被重指到 `data/session`，任务结果应放数据根而非 session 目录。
- 读路径三级 fallback：`task.status`/`task.result` 内存 miss → 读盘返回终态历史视图；`TASK_NOT_FOUND` 仅在内存、磁盘均无记录时返回。`task.list --all` = 内存活跃 + 磁盘已结束合并。
- 保留策略：最多 200 条或 7 天，启动时惰性清理。不写正文进日志。

### 14. 改动文件清单

| 文件 | 改动 |
|---|---|
| `src/main/services/AgentTaskService.ts` | **新增**：任务注册表/状态机/租约队列/轮询/持久化/shutdown |
| `src/main/daemon/ipcServer.ts` | `task.*` 路由 + waitMs 长轮询（含 socket close 清理）+ 修复鉴权作用域 bug + token 全平台强制 |
| `src/main/index.ts` | 导出 `getDataPath()`；`agentTaskService.init(dataPath)`；`before-quit` 先 `agentTaskService.shutdown()` 再 `stopDaemonServer()` |
| `src/cli/commands.ts` | `task` 命令组 + `platforms` + query 三通道输入 |
| `src/cli/client.ts` | waitMs 请求的 socket 超时参数化；`DaemonResponse` 加 `code?` |
| `src/shared/types/agentTask.ts`（新文件） | 任务/视图/错误码契约，daemon/cli 共用 |
| `src/shared/utils/webviewScripts.ts` | `generateSendMessageScript` 增加 verifySubmission 显式开关（当前仅随 attachmentFileName 启用）；`generateMindmapPageStateScript`/`generateGetLatestResponseScript` 复用 |
| `src/shared/utils/`（conversationUrl 校验 util，新文件或并入现有） | `isConversationUrlForPlatform`：合并 `MindmapService.sessionBinding` 与 `appStore.isSavableSessionUrl` 规则 |
| `src/shared/config/selectors.ts` | 无需改动（researchMode/messageContainer/stop 选择器已有） |
| `src/main/services/MindmapService.ts` | 提取 `sessionBinding` URL 规范化逻辑供共享 util（小重构） |

IPC/preload 契约：本链路不经 renderer，**不需要** `preload/index.ts` 变更；保持分层纪律（daemon 直调 main 服务）。

### 15. 分阶段实施

**P0（最小闭环 + 前置修复）**

1. 修复 ipcServer 鉴权作用域 bug（非 Windows CLI 全挂）；token 文件迁至 `getDataPath()/daemon.token` 并全平台强制校验。
2. `task.*` 协议 + `AgentTaskView` + 同步校验 + waitMs 长轮询（含 socket close 清理）。
3. `AgentTaskService`：submit/status/result/cancel/list、per-platform FIFO 租约、显式导航 + 就绪探针、generating 轮询完成检测（分档 stableThreshold + 空采升级）、任务/排队双超时、终态固定顺序。
4. `generateSendMessageScript` verifySubmission 开关并启用。
5. CLI `task` 命令组 + `platforms` + stdin/file 输入 + waitMs 超时参数化。
6. 验证：gemini/chatgpt 各跑一次"提交→wait→result"，双任务排队，cancel 各阶段，CLI 中途断开不泄漏。

**P1**

7. `--research`：DR enable 脚本接入；`platforms` 能力标记落地；research 默认超时 1800s + 高档 stableThreshold。
8. conversationUrl 捕获与规范化（共享 `isConversationUrlForPlatform`）+ `--conversation` 追问。
9. 结果落盘与 TTL 清理 + status/result/list 三级 fallback。

**P2（另立项）**

10. `multichat mcp`：CLI 内嵌 stdio MCP server（`@modelcontextprotocol/sdk`），把 `task.submit/status/result/cancel` 暴露为 MCP tools；daemon 协议不变。
11. 模型切换自动化：`selectors` 增加 `modelPicker.steps`（同 researchMode 范式），`--model` 从声明变执行。
12. 多平台扇出：`task submit --platform a,b,c` → 返回 `groupId`，结果聚合视图。

### 16. 验证方案（无测试运行器）

- `npm run lint` → `npm run build` → `npm run dev`。
- 手工 E2E：`out/cli` 或 `node out/cli/index.js`（dev 下 `ELECTRON_RUN_AS_NODE=1`）。
  1. `task submit --platform gemini --query "你好" --wait 180 --json` → 断言终态 done、reply 非空。
  2. 同平台连续 submit ×2 → 第二单 phase=queued + queuedPosition=1 → 自动转正。
  3. `task status --wait 5` 于 generating 中 → 5s 后返回实时状态、exit 0。
  4. `task cancel` 于 generating 中 → cancelled、窗口可复用；sending 中 cancel → cancelled 但页面可能已发出（符合预期）。
  5. `--research`（chatgpt/gemini）→ 报告正文取回；`--platform claude --research` → `CAPABILITY_UNSUPPORTED`。
  6. 未启动应用时 CLI → `DAEMON_UNAVAILABLE`、stderr、exit 1。
  7. `--wait` 中 Ctrl+C 断开 CLI，重复 20 次后 daemon 无残留 wait 监听（日志/状态核查）。
  8. 未授权请求（改 token）→ `DAEMON_UNAVAILABLE`。
- 验收对照 §6 逐条打勾。

### 17. 安全与边界

- 仅本机 IPC（Named Pipe / Unix socket + token），不监听 TCP。
- **Windows 信任边界**（修订强化）：现有实现 `daemonToken=''` on win32 且 `\\.\pipe\*.token` 非法路径——**Windows 上管道完全无鉴权，任何本地进程可驱动已登录的 AI 会话**。P0 修复：token 文件改放 `getDataPath()/daemon.token`（0600），daemon 全平台强制校验，CLI 全平台读取附带。信任模型声明：本服务面向单用户桌面，防御目标是"其他低权限进程误连/滥用"，不防御同用户恶意进程。
- query 与 reply 视为敏感数据：日志只记 taskId/phase/尺寸；`task.submit`/`task.cancel` 各记一行审计行（taskId、action、时间戳），不落正文。
- 结果 JSON 目录随 `clean:store` 类清理策略对齐（数据根目录下）。
- 共享 `persist:shared` 登录态：后台窗口与 UI 同会话——UI 侧退出登录/切号会打断运行中任务（表现为 `AUTH_LOST`），属已知风险而非 bug；任何 Session/Cookie 变更需评估全局影响（AGENTS.md Session 约束）。

### 18. 风险与开放问题

- **回复完成判定**：依赖"停止按钮消失 + 内容稳定 N 轮"启发式。仅 4 平台有专用停止按钮选择器，`generic` 平台靠 8 轮稳定兜底，仍可能误判（过早截断或迟迟不判完成）。需按平台调参并保留硬超时兜底；`platforms` 的 `busySignal` 标记向调用方暴露可靠度。
- **登录态运行时失效**：共享 session 意味着 UI 操作可中断 agent 任务；`AUTH_LOST`/`PAGE_NOT_READY` 已作失败模式登记，但无法自动恢复，需人工重新登录。
- **页面异常**：登录过期、验证码、弹窗会使任务失败；空采升级机制把"无限等"收敛为 `PAGE_NOT_READY`。
- **daemon 协议演进**：`task.*` 命名空间独立于现有 `exec/collect`，旧命令保持兼容不改动。
- **同平台任务是否默认新对话**：本方案按"每次任务导航到 `newConversationUrl`"设计；若希望默认在当前页面直接发送（更快但污染上下文），仅需调整 `preparing` 阶段策略。
