> Created: 2026-11-23 23:20 (Asia/Shanghai)

# AI 侧边栏 Agent 聊天界面技术调研

面向 `docs/prototypes/agent_sidebar_prototype.html` 已确认的原型（Model Picker + 消息流 + 可折叠思考/工具调用 + 权限模式输入框），调研三个问题：聊天 UI 框架选型、工具调用结果渲染、审批/确认 UI。前提：后端是自定义 agent runtime（Pi），不是 Vercel AI SDK。

## 1. 框架选型：assistant-ui vs Vercel AI Elements vs 自建

### 结论

**推荐 assistant-ui（`@assistant-ui/react`），用 `ExternalStoreRuntime` + 自定义 `ChatModelAdapter` 接入 Pi 事件流。** 改造成本最低，且它是三者中唯一为"非 AI SDK 后端"设计了一等接入机制的库。

**重要时效信息：Vercel AI Elements 已于 2025 年底宣布弃用**，官方迁移路径是将其组件并入 shadcn/ui registry 的 "AI Elements" 模式集（组件代码直接 copy 进项目，不再是 npm 依赖）。因此"AI Elements 作为一个库"已不存在，实质变成了"shadcn/ui 组件 + 自建状态层"路线，与自建的成本差距缩小，但它仍然假设你用 AI SDK 的 `useChat`/`UIMessage` 数据模型。

### 三者接入自定义事件流的机制对比

**assistant-ui**

- 包名：`@assistant-ui/react`（配 `@assistant-ui/react-markdown`、Tailwind 主题包）
- 接入机制：两层任选其一
  - `useExternalStoreRuntime`：你自己持有消息数组（Zustand store 正好），实现 `convertMessage`（把你的消息格式转成 assistant-ui 的 `ThreadMessage`）和 `onNew`（发送回调），runtime 负责渲染、滚动、分支、编辑重试。Pi 的流式事件 → 更新 Zustand → UI 自动增量渲染。这是最贴合本项目架构的路径：消息状态本来就应在主进程/Zustand，UI 层无状态。
  - `LocalRuntime` + `ChatModelAdapter`：实现 `async *run({ messages, abortSignal })` 生成器，yield 消息 delta，适合"消息由 UI 层管理"的形态。若 agent 会话需要跨页面存活，ExternalStore 更对。
- 工具调用：消息 parts 里有 `tool-call` 类型，内置 `ToolCallMessagePart` 组件 + `makeAssistantToolUI` 可按工具名注册自定义渲染卡片；工具审批用 "human tool"（见第 3 节）。
- 成本评估：原型里的顶部栏（Model Picker/新会话/历史）和底部输入区（附件、权限切换）都是自定义 UI，assistant-ui 不覆盖也不冲突；它替掉的是消息流、流式渲染、自动滚动、消息分支这些最难写的部分。预计接入工作 = 1 个 store 适配层 + 若干 ToolUI 组件 + 主题对齐 Tailwind。

**AI Elements（现 shadcn/ui AI 组件集）**

- 包名：无独立包，`npx ai-elements@latest`（或 shadcn CLI）把 `Conversation`、`Message`、`PromptInput`、`Tool`、`Reasoning`、`Approval` 等组件源码拷进项目
- 接入机制：组件是"哑"的展示组件，官方范例全部围绕 AI SDK 的 `useChat` + `UIMessage`（parts 数组：`text`、`reasoning`、`tool-*`、`data-*`）。接 Pi 的两条路：
  - 把 Pi 的事件流在适配层转成 `UIMessage` 形状，再喂给组件 —— 可行但要维护一个"伪 useChat"，状态、发送、停止、regenerate 都要自己实现；
  - 不用其数据模型，只用 `Conversation`/`Message`/`Reasoning`/`Tool` 的视觉壳 —— 那么它剩下的价值约等于一组 Tailwind 样式，与自建差距不大。
- 风险：弃用后靠 shadcn registry 分发，版本无锁定，升级靠重新 copy；组件假设 `UIMessage` parts 结构，和 Pi 的事件模型不匹配的部分（如 `data-*` 自定义 part）要自己造约定。
- 结论：除非团队明确想要"组件源码完全自有"且不介意自己写状态层，否则不推荐在 2026 年把它当库来引。

**自建**

如果两个库都不采用，React 18 + Tailwind + Zustand 下需要写的组件清单（按工作量排序）：

| 组件 | 要点 |
|---|---|
| `MessageList` | `react-virtuoso`（已在依赖里）虚拟滚动 + "跟随到底部"逻辑（用户在底部时自动滚，上翻后停止跟随并出"回到底部"按钮） |
| `StreamingText` | token 增量追加 + `react-markdown`/`remark-gfm`（已在依赖）增量渲染；长会话下 markdown 全量重解析是性能热点，需按段落 memo 或半成品代码块容错 |
| `ThinkingBlock` | 折叠 meta 行（用时 + chevron）+ 展开详情，原型已给出交互 |
| `ToolCallRow`/`ToolCallCard` | 单行摘要（图标 + 命令预览）→ 展开看 stdout/diff；按工具类型分发 `BashTool`/`EditTool`/`ReadTool` |
| `ApprovalCard` | 审批请求内联在消息流中（见第 3 节） |
| `Composer` | textarea 自适应高度、附件 chip、权限模式 popover、发送/停止切换（abortSignal） |
| `SessionMenu` | 新会话/历史列表，Zustand + 主进程持久化 |

自建的核心成本不在单个组件，而在**流式增量渲染的边界情况**（不完整 markdown、工具 part 穿插在文本中间、中断恢复、多条流并发）和**滚动管理**。这两块 assistant-ui 已经踩过坑。除非对包体积/依赖极度敏感，自建省不下多少时间。

### 风险点

- assistant-ui 版本迭代快（0.x → 近期改名/拆包历史多），锁版本 + 升级时核对 `ExternalStoreRuntime` API 变更。
- assistant-ui 默认样式走其自有的 radix 组件体系，与项目现有 Tailwind 风格需要一层主题对齐（覆盖 CSS 变量/类名）。
- Electron webview 隔离无碍：agent UI 跑在主 renderer，不走 `<webview>`，无特殊问题。
- 不要用 `useChat`/`LocalRuntime` 让消息状态死在组件里——agent 会话跨页面/重启存活是产品需求，消息源必须在 store/主进程，所以 ExternalStore 路线是硬性约束，不是偏好。

## 2. 工具调用结果渲染

### 业界标准模式

对 Claude Code UI、Cursor、Zed、OpenHands、Cline 的横向观察，收敛出高度一致的模式：

- **消息流内联，不弹窗**：工具调用是消息流中的一个可折叠条目，占据一整行，不打断阅读节奏。
- **单行摘要 + 懒展开**：折叠态只显示「工具图标 + 动词短语 + 关键参数」，如 `⏺ Bash(npm run lint)`、`✓ Read src/app.ts`、`⟳ Running command…`。Claude Code/Cursor 都用 `过去分词/工具名(参数)` 句式；参数过长截断。
- **状态由图标和动画承载**：pending = 转圈，success = 对勾/灰色，error = 红色。不用文字标签说明状态。
- **展开是 drawer 不是 modal**：点击后向下展开内联面板（等宽字体、浅灰背景圆角块），显示命令、stdout/stderr、或 diff；再点收起。长输出默认截断 + "Show more"。
- **多工具聚合**：连续的多个工具调用可收成一组（Cursor 的 "Used N tools"、Claude Code 的 tool-use 段），原型中的"运行了命令/编辑了文件/已运行 git show"多行正是此形态。
- **Edit/Write 工具必出 diff**，Bash 出终端块，Read 出文件路径+行范围，不混用。

原型中的 `ToolCallRow`（`flex gap-2 text-xs font-mono-code` + chevron + 隐藏 drawer）与业界模式完全对齐，按原型实现即可。

### Diff 渲染库推荐

| 库 | 适配度 | 说明 |
|---|---|---|
| `react-diff-view` | **推荐** | 专为 unified diff 文本设计，`parseDiff` + `<Diff>` 组件，支持 split/unified 视图、hunk 折叠、代码高亮接入；Pi 的 edit 工具若产出 unified diff 可直接喂 |
| `diff`（jsdiff）+ 自绘 | 推荐备选 | 若 Pi 给的是"前后文本"而非 diff 文本，用 `diff.structuredPatch`/`diffLines` 生成后用十几行 Tailwind 自绘行块，包最小、样式完全可控 |
| `diff2html` | 一般 | 面向"把 diff 渲染成独立 HTML 页面"，样式自成体系，侧边栏内嵌定制成本高 |
| `@monaco-editor/react` DiffEditor | 不推荐用于消息流 | 体积大（需 worker 配置）、编辑器语义重；只在"点开看完整文件 diff"的二层详情页才值得考虑 |

推荐组合：**`react-diff-view` 渲染 diff；Bash 输出用带 `max-h` + `overflow-auto` 的 `<pre>` 终端块；行内代码/命令用 `JetBrains Mono`**（原型已用）。

### 风险点

- 长 stdout（几万行）直接进 React 树会卡：终端块要截尾保留（tail-f 语义）或虚拟化。
- 工具 part 与文本 part 交错出现时，消息渲染器必须按 part 数组保序渲染，不能"先文本后工具"重排。
- `react-diff-view` 需配套 diff 数据源；与 Pi 约定 edit 工具结果格式（unified diff 字符串）要写进接口契约。

## 3. 审批/确认 UI

### 业界形态

- **Claude Code**：终端内权限提示，三档选项 `Yes / Yes, and don't ask again for X / No`，对应 once → pattern → always；同时有全局权限模式（default / acceptEdits / plan / bypassPermissions）在启动或会话中切换——原型底部的"完全访问/受限模式/只读模式"正是这个全局层的 UI。
- **Cursor**：内联 approval 卡片，`Run / Skip`，命令旁有"always allow this command type"入口；Yolo/auto-run 模式全局放行。
- **OpenHands**：消息流内嵌 confirmation 卡片，显示待执行动作摘要 + Confirm/Reject，配合 security 风险等级标签。
- **Cline**：每条工具调用都是内联 Approve/Reject 按钮对，auto-approve 设置页按工具类型（read/edit/bash/mcp）细粒度开关。

收敛出的分层交互设计，直接可用于本项目：

**两层结构**

- **全局权限模式**（输入框旁的 selector，原型已有）：`完全访问`（自动放行可逆/低风险工具）→ `受限模式`（写操作需逐次确认）→ `只读模式`（禁写工具）。对应 Claude Code 的 permission modes。
- **单条审批卡片**（受限模式下内联在消息流）：工具图标 + 命令/diff 摘要 + 按钮组：`允许` / `总是允许「该模式」` / `拒绝`（拒绝可带输入理由回传给 agent）。

**按钮分层**

- `允许`：一次性放行，等价 approve once。
- `总是允许 X`：第二级/下拉项，按"模式"记忆——粒度建议做到 `工具名 + 参数模式`（如 `Bash(npm *)`、`Edit(限定工作区内文件)`），而不是整类工具全开，这是 Claude Code "don't ask again for git commands" 的做法，避免 always-allow-Bash 这种过宽授权。
- `拒绝`：默认继续让 agent 换方案；长按/下拉给"拒绝并停止"。
- 风险分级（可选增强）：OpenHands 的做法，按工具风险等级（只读/可逆写/不可逆）在卡片左上角用色点标出，"总是允许"只对低风险开放。

### assistant-ui 的 human tool 机制

assistant-ui 原生支持"客户端执行的 human-in-the-loop 工具"：

- 用 `makeAssistantToolUI({ toolName: "bash" })` 注册一个渲染组件，组件收到 `{ args, result, status, addResult }`。
- 对需要审批的工具，组件渲染审批卡片；用户点 `允许` 后由前端调用实际的执行器（这里走 IPC 通知 Pi 继续执行），执行结果通过 `addResult(result)` 回写，runtime 把结果作为 tool result 追加进对话流。
- 或者更贴合本项目的玩法：Pi 自己执行，`approval-request` 作为一种 `tool-call` part（status=`requires-action`）由 Pi 推给 UI；UI 的 ToolUI 组件渲染按钮，点击后只把审批决定经 IPC 发回主进程/Pi，Pi 继续跑并把结果作为同一 tool part 的状态更新推回。assistant-ui 的 tool-call part 支持 status 流转（`running → requires-action → complete/incomplete`），与这个模型正好同构。
- 关键映射：Pi 事件 `tool_approval_request` → tool part(status=requires-action)；`tool_result` → part(status=complete, result=...)。拒绝 = `addResult({ refused: reason })` 或自定义 data part。

### 集成方式小结

| 元素 | 实现 |
|---|---|
| 全局权限模式 | 自定义 popover（原型已设计），状态存 Zustand + IPC 同步给 Pi |
| 审批卡片 | `makeAssistantToolUI` 按工具名注册，或通用 `ApprovalToolUI` 渲染 `requires-action` part |
| 审批决定回传 | `window.api.agentResolveApproval(requestId, decision)` IPC → 主进程 → Pi |
| 记忆"总是允许" | 主进程侧维护 allowlist（工具名+参数模式），写 electron-store；UI 只在审批卡片提供入口 |

### 风险点

- **审批与事件源的一致性**：审批状态必须由 Pi（主进程）持有为准，UI 只是视图；避免 UI 层本地判"已批准"而 Pi 没收到，出现执行分叉。
- **超时与中断**：审批卡片挂着时用户发新消息/切会话/停止，要定义 card 的失效行为（建议：新用户消息自动视为此轮审批"跳过该工具"）。
- **"总是允许"的粒度**：只做"整类工具"级记忆会实质绕过权限模式；参数模式匹配（命令前缀/路径范围）必须在 Pi 侧判定，不能只在 UI 侧记住按钮。
- assistant-ui 的 human tool 语义是"前端执行工具"；本项目工具在 Pi（主进程）执行，要用它的 part status 机制而非其内置执行回调，避免概念错位。

## 选型汇总

| 决策点 | 推荐 |
|---|---|
| 聊天 UI 框架 | `@assistant-ui/react` + `useExternalStoreRuntime`，消息状态留在 Zustand/主进程 |
| Markdown/流式 | `react-markdown` + `remark-gfm`（已有），段落级 memo |
| 消息列表 | `react-virtuoso`（已有）或 assistant-ui 自带 Thread viewport |
| Diff | `react-diff-view`；无 diff 文本时 `diff` + 自绘 |
| 工具卡片 | `makeAssistantToolUI` 按 bash/edit/read 注册折叠卡片 |
| 审批 | 内联 approval part(status=requires-action) + 三档按钮；allowlist 存主进程 |
| 不建议 | AI Elements（已弃用、绑 AI SDK 模型）、monaco diff（过重）、自建流式层（收益低） |
