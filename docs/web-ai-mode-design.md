> Created: 2026-11-24 21:58 (UTC+8)

# 工作台 Agent「Web AI 模式」开发方案

## 一、背景与目标

当前工作台右侧的本地 Agent 走 **API 模式**：`AgentSessionService` 用 Pi `ModelRuntime` 管凭证/模型目录/usage，`createAgentSession` 建 Pi `AgentSession`，请求经 `model.api` 路由到各供应商的 HTTP 端点（OpenAI/Anthropic/Gemini/OpenRouter/magpie 等）。

本方案引入第二种运行内核 —— **Web AI 模式**：不配置任何 API Key，直接复用应用内 `persist:shared` Webview 已登录的网页版 AI（第一期：ChatGPT、Gemini、腾讯元宝、豆包、阿里千问）作为模型运行时。用户在 `AgentModelPicker` 里选「平台 → 平台内模型」，Agent 的工具循环、transcript、权限审批、会话历史全部复用现有侧边栏，仅把「向模型取回复」这一步从 HTTP API 换成驱动对应网页会话。

网络搜索与生图沿用既有实现（`web_search`/`image_gen` 两个 customTools，底层 `AgentTaskService` 驱动已登录平台），不新增链路。

### 1.1 关键事实（决定架构选型）

| 事实 | 出处 | 对本方案的意义 |
|---|---|---|
| `registerApiProvider({api, stream, streamSimple}, sourceId?)` | `pi-ai/dist/compat.d.ts:51` | **最小侵入注入点**：给自定义 `api` 注册流式实现，`streamSimple` 经 `resolveApiProvider` 自动分流，`createAgentSession` 完全不动 |
| `Api = KnownApi \| (string & {})` | `pi-ai/dist/types.d.ts:21` | `api='web'` 这类自定义标记 Pi 类型层接受，`ProviderModelConfig.api` 可写 |
| `streamSimple` 按 `model.api` 查注册表分流 | `pi-ai/compat.js` `resolveApiProvider(model.api)` | Web AI 模型标 `api='web'` 即路由到注册的 `WebAiStreamFn`；未注册 api 抛 `No API provider registered` |
| `markRuntimeStreamFunction(streamFn, modelRuntime)` | `agent-session.d.ts:29` | 自定义 streamFn 仍可声明「经 modelRuntime 解 auth」，compaction/统计路径据此跳过预解凭证 |
| `StreamFn` 签名 | `pi-agent-core/dist/types.d.ts:17` | `(model, context: TranscriptContext, options) => AssistantMessageEventStream` —— webview 驱动只需把 `context`（含 system+tools+messages）映射成网页 prompt + 采集流式回复 |
| `AssistantMessage.content` 含 `ToolCall`；`ToolResultMessage` | `pi-agent-core/dist/types.d.ts:382/435` | 从文本解析出的 `<tool_call>` 可塞进 assistant message 交给 agent-loop 执行；`argumentsError` 字段原生为「JSON 修复失败」预留 |
| `ModelSelector` 无 `modelPicker` 字段 | `selectors.ts:210` | **全平台统一缺口**：平台内模型切换是全新需求，需补 `modelPicker` steps 配置 |

### 1.2 架构选型：两种实现路线

调研后收敛出两条路线，**推荐路线 A**：

| | 路线 A：自定义 `StreamFn`（推荐） | 路线 B：`AgentRuntimeBackend` 上游分叉 |
|---|---|---|
| 思路 | Web AI 模型注册进 `ModelRegistry`（`api='web'`），并 `registerApiProvider({api:'web', stream, streamSimple})` 把该 api 的流式实现指向 `WebAiStreamFn`；`createAgentSession` 默认 `streamSimple` 自动分流，会话/工具/transcript/compaction/事件全走 Pi 原路 | 在 `AgentSessionService` 上游抽接口，Pi/Web 各实现一套会话运行时 |
| 优点 | 最小侵入——`createAgentSession` 一行不改；Pi 的工具循环、transcript、permission、`getContextUsage`/`getSessionStats`、`agent:event` 流**全部零成本复用**；侧边栏/store/IPC 几乎不动 | 概念上「内核」边界清晰 |
| 缺点 | Web AI 拿不到真 token usage、无原生 function-calling（需文本协议 tool_call）；`model` 对象是合成 projection | 要重写 Pi 已做好的会话编排；`AgentSession` 焊死 model/usage/compaction，分叉被迫伪造 SDK 内部对象，复杂度反而高 |
| 结论 | **采纳**。WAA 的 `waa-stream.ts` 正是把 transcript→网页流式回复桥成 `StreamFn` 的成熟蓝本 | 仅在 A 遇到 Pi 硬阻断时回退 |

> 注：曾考虑「给 `Agent` 注入自定义 `streamFn` 再传给 `createAgentSession`」，但 `createAgentSession` 的 `CreateAgentSessionOptions` **无 `agent` 字段**，它内部自造 `Agent`（`sdk.js` 硬编码 `streamSimple`）；`config.agent` 是 `AgentSession` 构造器（`agent-session.d.ts` `AgentSessionConfig.agent`）的参数，绕开 `createAgentSession` 直接 `new AgentSession` 需自行补齐 model/thinkingLevel 恢复、resourceLoader、cacheWarmer、`markRuntimeStreamFunction` 等逻辑，成本更高。`registerApiProvider` 是更小且公开导出的正路。

下文均按路线 A 展开。

---

## 二、现状复用盘点（已具备 vs 缺口）

Web AI 模式的执行层**大部分已在仓库里跑通**，唯一真正空白是「平台内模型选择器」。

### 2.1 已具备（直接复用）

- **登录态检测**：`AuthStateService`（`src/main/services/AuthStateService.ts`）双通道 —— cookie 名单命中→已登录；否则页面 localStorage 结论；`platformAuthCookieRules` 按值否决游客（元宝 `hy_user`、chatglm 等）。`agentTaskService.capabilities()` 已把 `signedIn`/`loginRequired`/`deepResearch`/`imageDownload`/`busySignal` 聚合输出。
- **发送/输入**：`generateSendMessageScript`（`webviewScripts.ts:1349`）— `findTextarea` 可见性过滤 → contenteditable/textarea 双写值链（Quill `insertText`、受控框架 `InputEvent('insertText')` 同步、重复守卫）→ `findSendButton` + Enter 兜底。中文站 `postInputDelay/clickDelay` 已按平台调优。
- **回复流式采集**：`generateGetLatestResponseScript`（`webviewScripts.ts:2155`）— 多候选 `messageContainer` 取最后可见项，Shadow DOM TreeWalker 穿透，HTML→Markdown；豆包 `findDoubaoMultiBlockRoot` 多块合并、ChatGPT `markdown-content-N` 合并。
- **完成判定**：`AgentTaskService.poll` 每 1.5s 并行读生命周期态（`generateWorkbenchLifecycleStateScript` ready/busy/authWall/authStrong）与回复文本；`busy` 由 `generationStopSelectors[platform]` 判；文本稳定计数 `stableCount` 收口。
- **后台会话**：`AgentTaskService` 已跑通 `__agent_<platform>` 后台 `WebContents`（`persist:shared`）+ per-platform FIFO 队列 + 就绪探针 + 会话 URL 续接。
- **生图/搜索工具**：`webSearchTool.ts`、`imageGenTool.ts` 已把「提示词包装 + 平台默认联网/生图」落成 pi customTools，经 `AgentTaskService.submit` 执行；生图落盘 `.multichat/image/` 并回链 `conversationUrl`。
- **会话 URL**：`conversationUrl.ts` 归一化各平台 `/c/{id}`、`/app/{id}`、`/chat/{id}` 形态与 canonical。
- **侧边栏**：`WorkbenchAiSidebar`/`AgentComposer`/`AgentModelPicker`/`AgentThinkingPicker`/`AgentContextMeter`/`AgentProviderSettings`/`agentSessionStore` 全部与「模型从哪来」解耦，只认 `AgentRuntimeSnapshot` + `agent:event`。

### 2.2 缺口（需新做）

1. **平台内 model picker 选择器**：`ModelSelector` 无 `modelPicker`/`modelMenu` 字段，五平台均未配「打开模型菜单 → 读选项 → 切换」。复用现有 `AutomationStep`/`findElement`/`menuOpenerFallback`/`aria-haspopup=menu` 步进框架即可，但每个平台打开钮与选项容器需实测。
2. **Web AI 模型的 Pi 注册**：需把「平台 + 平台内模型」合成 `Model<Api>`（`api='web'`）挂进 `ModelRegistry`（参照 `CustomGatewayProvider`/`MAGPIE_PROVIDER` 的注册路径），并 `registerApiProvider({api:'web', …})` 让 `streamSimple` 分流到 `WebAiStreamFn`。
3. **`WebAiStreamFn`**：把 `TranscriptContext`（system+tools+历史）折叠成网页 prompt、提交到对应平台会话、把 DOM 流式增量翻成 `AssistantMessageEvent` 流。
4. **网页侧模型菜单自动化**：新增 `generateSelectModelScript`（读当前模型、列可选项、点击目标项、确认生效）。
5. **文本协议 tool_call**：Web AI 无原生 function-calling，需 `<tool_call>{json}</tool_call>` 信封 + JSON 修复 + `invalid_tool_call` 回环（WAA `tool-call.ts` 蓝本）——**否则 Agent 无法用工具**。这是路线 A 最大的功能工作量。
6. **上下文折叠**：Pi transcript → 单条网页 prompt 的 `transform_messages` 折叠（WAA `session_manager.py` 的 `<user_query>/<tool_result>` 标签方案）。
7. **元宝/豆包/千问的 `generationStopSelectors`**：目前仅 genericStops 兜底，建议补中文「停止」aria 专属项。

---

## 三、WAA 可迁移资产（已核实）

`D:\Project\WebAI-to-API` 是 Python + Playwright，物理层不可直接搬，但**两份协议设计**可直接做蓝本：

- **`agent/src/waa-stream.ts`**：自定义 `StreamFn` 全链路 —— transcript→wire 映射、`conversation_id` 捕获/注入/持久化/404 重导引（rebootstrap）、SSE chunk→`AssistantMessageEvent` 翻译、`final_text` 权威校正、超限先全量重试再 emergency-tail 降级。**对应 MultiChat-desk 的 `WebAiStreamFn`**。
- **`agent/src/tool-call.ts`**：`<tool_call>{json}</tool_call>` 信封检测 + 两级 JSON 修复（补尾括号/字符串内转义）+ `invalid_tool_call` 伪工具回错。**对应文本协议工具调用**。
- **`agent/src/compress.ts`**：确定性三区压缩（Zone A system 不动 / Zone B `<context_summary>` 胶囊 / Zone C verbatim tail 按 user 边界切），**零模型成本**，适合网页端（上下文不可控且压缩本身耗网页额度）。**对应 Web AI 的上下文折叠**。
- **`src/app/services/providers/gemini/session_manager.py:transform_messages`**：把 OpenAI messages 折成 `<user_query>/<tool_result>` 标签文本。**对应 transcript→prompt 折叠**。
- **`src/app/services/providers/gemini/browser_adapter.py` 与 `scripts/gemini_scripts.py`**：Gemini Quill `insert_text` 注入、`STREAM_EXTRACTOR_SCRIPT`（MutationObserver + `computeDelta` chunk/rewrite 双模式 + stop 按钮消失判 done + `collectResponseImages`）。**对照 `webviewScripts.ts` 补 Gemini 特例**。
- **`src/app/services/browser/errors.py`**：错误分层（`TransientSessionError`/`SessionNotAliveError`/`BrowserGenerationMismatchError`/`ConversationBusyError`）。**对应 Web AI 错误码**。
- **`src/app/services/multimodal.py`**：附件 MIME 白名单 + 限额（8 文件/100MB）。**对应 `generatePasteFileUploadScript` 的调用侧校验**。
- **不迁移**：Playwright runtime/engine/session 物理层、`webapi_adapter`/`webapi_client`（非 DOM 私有 API）、`AuthManager`/`account_registry`（由 `persist:shared` + `AuthStateService` 覆盖）。

---

## 四、总体设计

### 4.1 分层

```
Renderer（复用）
  WorkbenchAiSidebar → AgentComposer
    ├─ AgentModelPicker      ← snapshot.providers[].models[]（平台=provider，平台内模型=model）
    ├─ AgentThinkingPicker   ← web 模型返回 ['off']，自动禁用
    ├─ AgentContextMeter     ← context=null / 估算字符占比
    └─ AgentProviderSettings ← kind='web' 时显示「打开页面登录」而非 key/OAuth
        │ window.api.agent*
        ▼
Preload（类型化桥接，加 web 相关方法）  ▼
Main
  AgentSessionService（现有）
    ├─ ModelRuntime（Pi）— API 模式不变
    ├─ WebAiModelCatalog（新）— 把平台+模型注册成 Model<Api> 进 ModelRegistry，api 标记 'web'
    └─ registerApiProvider({api='web', stream, streamSimple})（新，init 时一次）
         —— createAgentSession 默认 streamSimple 按 model.api 自动分流到 WebAiStreamFn
  WebAiStreamFn（新，src/main/services/webAi/）
    ├─ ContextFlattener      — TranscriptContext → 单条网页 prompt（含 system+tools 说明+历史折叠）
    ├─ ToolCallCodec         — <tool_call> 信封编解码 + JSON 修复 + invalid_tool_call 回环
    ├─ WebAiSessionPool      — webContents ↔ 平台会话映射，idle 超时/失效重开（复用 SessionManager 的 __agent_ 会话，借鉴 AgentTaskService 队列/轮询）
    └─ 每平台 Adapter        — chatgpt/gemini/yuanbao/doubao/qwen 的发送/读流/选模型 hook
  selectors.ts              — ModelSelector 增 modelPicker{open,options,apply} steps
  webviewScripts.ts         — 增 generateSelectModelScript / generateStreamDeltaScript
```

### 4.2 Web AI 模型的注册与识别

- 每个「平台 → 平台内模型」合成一个 `Model<Api>`：`api='web'`（自定义 api 标记，`Api` 类型允许任意 string）、`baseUrl` 记平台 URL、`id` 记 `web/<platform>/<model-id>`，`provider` 记平台 id；平台→模型的区分靠 `id`/`provider` 承载，`api` 统一为 `'web'` 走同一套 `WebAiStreamFn`。
- `WebAiModelCatalog` 参照 `CustomGatewayProvider`/`MAGPIE_PROVIDER` 的 `registerProvider`/`applyGatewayCatalog` 路径（`AgentSessionService.ts:298-353`）把 catalog 写进 `ModelRegistry`。「是否暴露给 picker」不由 `getAvailableSnapshot` 决定（它只看 `configured`），而由 `buildProviders` 投影层按登录态覆写 `available`（见 4.3）。
- **`registerApiProvider` 时机**：`AgentSessionService.init()`（`ModelRuntime.create` 后）一次性调用 `registerApiProvider({ api='web', stream: webAiStreamFn.stream, streamSimple: webAiStreamFn.streamSimple }, 'webai')`（`webAiStreamFn` 为 `WebAiStreamFn` 实例）；`unregisterApiProviders('webai')` 用于清理。此后 `model.api==='web'` 的模型经默认 `streamSimple` 自动路由到 `WebAiStreamFn`，`createAgentSession` 无需任何改动。
- `buildProviders()`（`AgentSessionService.ts:1871`）投影时给 web provider 加 `kind:'web'`、`signedIn`、`loginRequired`（**为 `AgentProvider` 新增字段**，当前类型无这三项），`models[]` 即平台内可选模型（静态清单 + 可选实测探测）。
- `AgentModelPicker` 不动结构：平台显示为 provider 分组、平台内模型为 item。picker 已按 provider 分组，天然满足「平台 → 模型」两级。

### 4.3 登录态过滤的落点

`getAvailableSnapshot` 的判据是 `configured`——由 `ModelRuntime` 的 auth 解析（stored credential / runtime apiKey / env / configuredRequestAuthStatus）得出，**不是「apiKey 字段非空」**。web provider 根本没有 `apiKey` 概念，在 `ModelRuntime` 视角下默认 `configured:false`。**「只暴露已登录平台」必须在 `buildProviders` 投影层做**：给 `kind:'web'` 的 provider 按 `AuthStateService.signedIn` 同时覆写 provider 级 `configured` 与 `models[].available`（未登录→`available:false` 并标「需登录」），而不是「已经 configured，只需再盖一层」。`loginRequiredPlatforms`（qwen 等）未登录时 `WebAiSessionPool.submit` 直接 `AUTH_REQUIRED`。

### 4.4 会话执行（路线 A 核心）

用户选了 `api='web'` 的模型后，Pi 默认 `streamSimple` 经 `resolveApiProvider('web')` 命中已注册的 `WebAiStreamFn`，每次模型请求自动走到下面这条链；`AgentSessionService` 的三处 `createAgentSession`（`:980`/`:1067`/`:1309`）**完全不用改**。

`WebAiStreamFn(model, context, options)` 内部：

1. `ContextFlattener` 把 `context`（`TranscriptContext`：system message + tools 定义 + messages）折叠成一条网页 prompt——组装分「身份层（复用 `AgentResourceLoader` 的 system prompt）+ WAA 式 web 契约段 + `<tools>` 现渲染」三层，见 4.6.1；历史按 WAA 标签方案折叠；超长走 `compress.ts` 式确定性压缩。
2. `WebAiSessionPool.acquire(platform)` 取该平台后台 `WebContents`（经 `sessionManager.getOrCreateSession('__agent_<platform>')` 复用 `persist:shared` 会话；FIFO 队列与轮询/完成判定借鉴 `AgentTaskService`，但 `AgentTaskService` 只暴露 `submit/getView/cancel` 一次性任务 API，**不能直接复用**，需 `WebAiSessionPool` 自管租约或让 `AgentTaskService` 开放会话租约），导航到 `newConversationUrl` 或续接 `conversationUrl`。第一期固定用 `persist:shared` 当前默认账号，不做 Gemini `/u/{n}` 多账号选择。
3. 若目标模型 ≠ 页面当前模型 → `generateSelectModelScript` 切到 `context`/`model` 指定项。
4. `generateSendMessageScript` 提交 prompt。
5. 流式：`generateStreamDeltaScript` 注入 MutationObserver 轮询增量（或主进程 1.5s 轮询 `generateGetLatestResponseScript` 取快照算 delta），翻成 `AssistantMessageEvent`（`text-delta`/`text-end`/`done`/`error`）。
6. 回复里检出 `<tool_call>` → 产出一个 tool_call 类型的 assistant message 让 Pi agent-loop 执行工具；检出异常 → 错误事件。
7. `options.signal` 中止 → 点停止钮 + 释放会话租约。

**transcript 落盘归属**：`WebAiStreamFn` **不写历史**——Pi `AgentSession`/`SessionManager` 在 `message_end` 等事件里自动 `appendMessage` 统一持久化 user/assistant/tool 消息。streamFn 只负责把增量事件喂回 agent-loop；不要在 streamFn 里另写一套 transcript（否则与 Pi 落盘重复）。

**平台会话互斥（硬约束）**：`WebAiSessionPool` 与 `AgentTaskService`（`web_search`/`image_gen` 工具）都经 `sessionManager.getOrCreateSession('__agent_<platform>')`，**是同一个物理 `WebContents`**。`AgentTaskService` 靠 `queues`/`running` 做 per-session 串行，但不认识 `WebAiSessionPool` 的租约——两条链同时 `acquire` 同一 `__agent_<platform>` 会被两处脚本驱动打架。因此必须二选一：① `WebAiSessionPool` 与 `AgentTaskService` **共享同一把 per-platform 会话锁**（把锁/队列上提到 `SessionManager` 或公共层）；② `web_search`/`image_gen` 的 `resolvePlatform` 显式排除当前 Agent 持有的平台。设计取 ①。

### 4.5 登录态识别

- **检测**：完全复用 `AuthStateService.getAuthState(platform)`（cookie + localStorage 双通道 + 按值否决）。`capabilities()` 已输出 `signedIn`/`loginRequired`。
- **UI**：`AgentProvider` **新增** `kind:'web'`、`signedIn?:boolean`、`loginRequired?:boolean`（当前 `agentRuntime.ts` 的 `AgentProvider` 无这三字段，为类型扩展任务）。`AgentProviderSettings`/`AgentAuthDialog` 在 `kind==='web'` 时把「API Key/OAuth 表单」替换为「打开平台页登录」按钮 —— 点击后经 `agent:web-open-login` 把 `__agent_<platform>` 后台会话提到前台（或新开可见 `BrowserWindow` 到登录页），用户登录后 `AuthStateService` 复测，`signedIn:true` 后该 provider 模型在 picker 里 `available:true`。
- **未登录降级**：`signedIn===false` 的 provider 在 picker 中模型 `available:false` 并标记「需登录」；`loginRequiredPlatforms`（qwen 等）未登录时 `submit` 直接 `AUTH_REQUIRED`。
- **运行中退登**：Agent 正在跑时 `signedIn` 变 false（生成期跳登录页 `isAuthWallUrl` 命中或 `authStrong` 强信号）→ 当前 turn 失败回 `AUTH_LOST` 事件，session 保留；重登后可 resume 续跑，不丢 transcript。

### 4.6 工具调用（文本协议）

Web AI 模型无原生 function-calling，Agent 要用 shell/read/write/web_search/image_gen 必须走文本协议：

- `ContextFlattener` 在 system 段注入工具清单 + 调用格式（WAA `build_tools_prompt` 蓝本）：要求模型以 ` ```xml <tool_call>{"name":"..","arguments":{..}}</tool_call>``` ` 输出。
- `ToolCallCodec` 从流式文本检出 `<tool_call>` 块：完整 JSON→放行；截断/畸形→两级修复（补尾括号、字符串内转义），仍失败→合成 `invalid_tool_call` 伪工具回错让模型重试（WAA `tool-call.ts` 蓝本）。
- 检出后产出 Pi `AssistantMessage` 含 `toolCalls`，交给 agent-loop 正常执行 `beforeToolCall`（权限审批）→ tool → `toolResult` 追加进 transcript，下一 turn `ContextFlattener` 把 toolResult 折成 `<tool_result>` 段回喂网页。
- **能力边界**：文本 tool_call 依赖模型遵从格式，稳定性弱于原生；`auto` 权限模式风险更高（模型可伪造 tool_call），Web AI 模式建议默认收紧 `permissionMode` 或在 UI 标注。

### 4.6.1 系统提示词组装：身份复用 + WAA 式注入

Web AI 模式的 prompt 组装与 API 模式**不同**——API 模式靠 Pi 原生 channel（system message + tools 数组 + messages 结构），Web AI 模式必须把这整包**拍平成一条网页 prompt**。拆法分两层，身份/行为规范复用、注入方式用 WAA：

- **身份层（复用 API 模式，不写第二份）**：直接用 `AgentResourceLoader.getSystemPrompt()` + `getAppendSystemPrompt()`（`AgentSessionService.ts:969-976` 注入的 `envPrompt` 等追加段也在内），得到当前 Agent 的身份、行为规范、`AGENTS.md`/`CLAUDE.md` 项目上下文、skills 清单——**与 API 模式同源同一份**，不改内容。
- **注入方式（WAA 式，参照 `agent/src/system.ts`）**：API 模式的 system message 在 Web AI 里没有对应 channel，必须平铺成**单条文本**。WAA 的做法是把 Pi 那套 XML section 结构整段搬进 system 文本：`<capabilities>`（声明"你能读写文件、跑 shell"防模型谎称没权限）、`<tool_call_format>`（`<tool_call>{json}</tool_call>` 信封规范）、`<message_format>`（`<user_query>`/`<tool_result>`/`<system>`/`<file>` 标签语义）、`<rules>`（行为约束）、`<run_limits>`（工具轮数上限的诚实契约）、`<cwd>`。`ContextFlattener` 在身份层之后拼上这套 web 契约段。
- **`<tools>` 段（WAA `renderToolsPrompt` 蓝本，wire-build 时渲染）**：API 模式 tools 是结构化数组，Web AI 里要把当前声明的工具（除 `invalid_tool_call` 外）在**每次发 wire 请求时**现渲染成 `<tools>- name: desc\n  Parameters: {schema}</tools>` 文本段——保证声明集永远是 live 的单一事实源，不随历史漂移。
- **边界**：身份层的"本地 CLI agent、coding assistant"表述在 Web AI 语境下仍成立（WAA system.ts 同款措辞）；但 `<capabilities>` 里要补 Web 特有的一句——"网页会话内建的联网搜索/grounding 直接用、不经 `<tool_call>`，网页 canvas/文档产物用户打不开、交付只能走工作区文件"。
### 4.7 上下文与 usage

- Web AI 拿不到真实 token usage：`AgentContextMeter` 显示 `context=null`（组件已容忍 `null`）或「字符数/估算上下文窗口」降级；`stats` 返回 null 或仅计字符。
- `supportsThinking` 返回 false、`availableThinkingLevels=['off']`，`AgentThinkingPicker` 自动禁用。
- compaction：Web AI 上下文窗口不可读 → `getContextUsage` 返回 `contextWindow=估算上限`、`tokens=null`，自动压缩按字符占比阈值触发确定性折叠而非模型压缩。

### 4.8 网络搜索与生图

「沿用 WebAI-to-API 实现」指复用 **MultiChat 已有的 `web_search`/`image_gen` customTools**——它们的底层（提示词包装 + 平台默认联网/生图 + `AgentTaskService` 驱动 `__agent_` 会话）正是 WebAI-to-API 思路的移植，**不新增链路、不再搬 WAA Python 侧实现**：

- `web_search`：`resolvePlatform` 选已登录平台，`AgentTaskService.submit` 发「请使用联网搜索…」提示词；`research=true` 走 `researchMode.steps` UI 开关（豆包/千问已下架，自动 `CAPABILITY_UNSUPPORTED`）。Web AI 模式下该工具照常可用（它本身就走 webview）；与 `WebAiSessionPool` 的会话抢占按 4.4 的共享锁处理。
- `image_gen`：`genImage:true` + 平台原生「生图」开关 steps + `imageDownload` 点击下载 + `generateExtractImagesScript` 提取，落盘 `.multichat/image/`。Agent 回复以 markdown `![](abs-path)` + backtick 路径内联，`AttachmentChips` 已识别 `imageFiles` 字段。
- 选择：搜索继续走「提示词包装 + 平台默认联网」（方案 A），不为「强制联网开关」给各平台补 `searchMode.steps`（维护重、收益低）。

---

## 五、平台适配要点与缺口

`selectors.ts` v20 已覆盖发送/生图/研究/下载/回复采集/会话 URL；**唯一全平台空白是 `modelPicker`**。豆包/千问 Deep Research 已下架（事实非缺口）。

| 能力 | ChatGPT | Gemini | 元宝 | 豆包 | 千问 |
|---|---|---|---|---|---|
| 登录态检测 | ✅ cookie | ✅ cookie（含 /u/ 多账号归一化） | ✅ cookie+按值否决游客 | ✅ cookie | ✅ cookie + loginRequired 策略标记（游客不可发送） |
| 发送（输入/按钮） | ✅ | ✅ Quill | ✅ | ✅ | ✅ |
| 停止/完成判定 | ✅ 专属 stop | ✅ 专属 stop | ⚠️ generic 兜底 | ⚠️ generic 兜底 | ⚠️ generic 兜底 |
| **平台内模型选择** | ❌ 需实测 | ❌ 需实测 | ❌ 需实测 | ❌ 需实测 | ❌ 需实测 |
| 流式采集 | ✅（含合并） | ✅ Shadow DOM | ✅ | ✅ 多块合并 | ✅ |
| 会话续接 URL | ✅ `/c/` | ✅ `/app/`、`/u/*/app/` | ✅ `/chat/` | ✅ `/chat/` | ✅ `/chat/` |
| 生图下载 | ✅ | ✅ 一键 | ✅ | ✅ | ✅ hover→popMenu |
| 深度研究 | ✅ | ✅ | ✅ | ❌ 已下架 | ❌ 已下架 |
| 适配难度 | 高（CF/登录墙） | 中高（Angular/Shadow DOM） | 中 | 中（弹层/多块） | 中高（须登录+hover） |

**Model picker 实测线索（写入 `modelPicker` steps 前须逐一在 `pnpm dev` webview 实测）**：

- ChatGPT：`button[data-testid^="model-switcher"]`（如 `model-switcher-dropdown-button`，文本=当前模型名）→ `role=menu`/`menuitemradio` 列表。
- Gemini：页面顶部/输入框旁 Angular `mat-menu`/`cdk-overlay` 下拉，按钮 aria 含档位名（Fast/Thinking/Pro）。
- 元宝：composer 附近含「Hunyuan/DeepSeek」文本的 `[role=button]`/`button[aria-label*=模型]`。
- 豆包：composer 附近含「豆包/DeepSeek/模型」的 `button[data-testid]`/`[role=button]`。
- 千问：composer 顶 `button[data-log-name]`/`[data-component-type]` + 文本含「Qwen」的项。

各平台实际可选模型清单随套餐/灰度变动，**以实测注入 `generateListModelsScript` 读回为准**，文档不写死。

---

## 六、实施拆解（建议里程碑）

1. **M1 基础设施**：`ModelSelector` 增 `modelPicker` 字段 + `generateSelectModelScript`/`generateListModelsScript` 注入脚本；补元宝/豆包/千问 `generationStopSelectors`。验收：五平台登录态/发送/读回/选模型在 `pnpm dev` 手测通过。
2. **M2 WebAiModelCatalog + 分流**：平台+模型注册进 `ModelRegistry`，`AgentModelPicker` 显示 web provider 分组（平台）→ 模型项；`kind:'web'`、`signedIn` 透传并按登录态覆写 `available`。**前置**：`AgentSessionService.init()` 已完成 `registerApiProvider`——未注册时第一个 web 会话 `resolveApiProvider('web')` 抛 `No API provider registered`。验收：picker 两级选择、未登录平台灰显「需登录」。
3. **M3 WebAiStreamFn（纯文本问答）**：ContextFlattener（无工具）+ WebAiSessionPool + 发送 + 流式采集 + 会话续接。验收：选 web 模型后单轮/多轮对话在侧边栏正常流式出字、transcript 落盘可恢复。
4. **M4 文本协议工具调用**：ToolCallCodec + system 注入工具说明 + `<tool_result>` 回喂；接 `beforeToolCall` 权限审批。验收：web 模型能调 shell/read/web_search 并完成一轮 agent-loop。
5. **M5 登录引导 + 收尾**：`kind='web'` 的 ProviderSettings 改「打开页面登录」；ContextMeter/ThinkingPicker 降级（两组件已容忍 `context=null`/`levels=['off']`，无需改代码）；搜索/生图工具与 WebAiSessionPool 共享 per-platform 会话锁；错误码对齐（Transient/NotAlive/Busy）。
6. **M6 验收**：派独立 worker 按本文件核对功能完整性 + DOM 实测五平台登录态与模型切换 + 回归 API 模式不受影响 + **双平台并发**（ChatGPT 网页 Agent 与 Gemini 网页 Agent 同时跑互不干扰）。

## 七、风险与边界

- **格式遵从**：文本协议 tool_call 依赖模型配合，Gemini/ChatGPT 较稳，豆包/元宝/千问需实测提示词调优；失败兜底为「当纯问答用」。
- **DOM 漂移**：model picker / 停止钮 / 回复容器随平台改版失效 → `modelPicker.steps` 用多候选 + `menuOpenerFallback`，并纳入选择器维护方法论（`docs/选择器维护方法论.md`）。
- **登录态共享**：`persist:shared` 全局共享，UI 退登→后台会话同步失效（`AUTH_LOST` 已有信号）；多账号 Gemini `/u/{n}/` 已识别。
- **额度/风控**：高频轮询与自动发送可能触发平台风控；`AgentTaskService` FIFO + ready 探针已限流，Web AI 模式沿用同池不放大并发。
- **额度/上下文**：网页端上下文窗口与计费不可见，usage 一律降级展示，不做假 token 数。
- **范围**：第一期只做五平台文本对话 + 工具调用 + 搜索/生图沿用；attachments 上传（`generatePasteFileUploadScript`）若需支持图生图/多模态，按 `multimodal.py` 白名单限额在 M4 后增量接入。

---

*本方案由主控 Agent 协调 4 个调研 worker（WAA 迁移审计 / MultiChat Agent 运行时梳理 / WAA 搜索生图专项 / 五平台 DOM 探测）+ 对 Pi SDK 源码（`pi-agent-core`/`pi-coding-agent` 1.6.0）的直接核实完成。*
