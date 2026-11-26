> Created: 2026-11-24 10:21 (UTC+8)

# Agent 供应商设置、模型选择与上下文用量开发方案

## 一、背景与目标

工作台右侧的本地 Agent 目前已经能完成会话、工具调用与权限审批，但模型配置入口仍是一个从输入框右下角打开的独立弹窗。这个弹窗把"选模型"和"配供应商"混在一起：供应商只列了 9 个硬编码名称，Base URL 输入后不会真正写入运行时，模型标识靠手填，也没有 thinking 档位和上下文占用反馈。用户无法判断当前请求用了多少 context，也无法在不重启的情况下完成 OAuth 登录或切换到其他供应商的模型。

本次改造要达成四个目标：

1. 在全局设置抽屉里提供一个与现有设置项同风格的入口卡片，点击后打开独立的 Agent 配置弹窗；抽屉本身不铺开供应商列表。
2. 输入框旁的入口回归为纯粹的模型 Picker；选中模型后再单独选择 thinking level。
3. 在输入区持续显示 context 容量与占用，数据来自模型请求实际返回的 usage，而不是本地估算。
4. 直接复用 Pi SDK 已有的 `ModelRuntime` 作为统一 adapter，覆盖 OpenAI、Anthropic、Gemini、OpenRouter 及自定义 OpenAI 兼容端点，不另写协议适配层。

## 二、现状与根因

### 2.1 供应商列表是静态的

`src/main/services/AgentSessionService.ts` 的 `listProviders()` 返回一个写死的 9 项数组（magpie、anthropic、openai、deepseek、google、openrouter、groq、xai、mistral），没有使用 Pi 已经加载的 provider 目录。结果是：

- 用户已配置的 provider 只要不在这 9 项里就不会出现在界面上；
- 每个 provider 的认证方式、OAuth 支持、模型数量都无法反映真实状态；
- 新增自定义端点必须改代码。

### 2.2 Base URL 是"假"配置

`AgentSettingsModal` 把 `baseUrl` 作为 `setCredential` 的字段传入，但 `AgentSessionService.setCredential()` 的签名只接收 `{ type, key, env }`，`baseUrl` 在 IPC 边界就被丢弃。用户以为改了地址，实际请求仍然发往模型目录里的原地址。`getActiveModel()` 里的 `baseUrl` 也只是从模型对象读取，或在 magpie 场景硬编码回退，并不代表用户输入生效。

### 2.3 设置入口位置错误

`AgentComposer` 右下角的 `Settings2 + activeModel` 按钮同时承担"显示当前模型"和"打开配置弹窗"两个职责。`AgentSettingsModal` 内部又包含供应商、Key、模型名、权限模式、Skills 目录和命令放行名单，等于把全局配置塞进了对话输入区。这个入口既不符合"Picker 只负责选择"的直觉，也让侧边栏多出一层嵌套弹窗。

`SettingsDrawer` 在"命令行与 Agent 集成"之后已有"本地 Agent"区块，它的"配置"按钮打开 `AgentSettingsModal`。本次保留这个区块和它周围的全部设置项，只把按钮指向新的独立配置弹窗。供应商列表、认证操作和 Skills 配置都放在弹窗内部，抽屉不承载这些控件。

### 2.4 没有 thinking 与 context 反馈

Pi 的 `AgentSession` 已经提供 `getAvailableThinkingLevels()`、`supportsThinking()`、`getContextUsage()` 和 `getSessionStats()`，但当前主进程和渲染层都没有调用，事件流也没有把 `thinking_level_changed`、`compaction_end` 等状态变化同步到 UI。用户只能看到模型名，无法知道当前推理档位，也无法知道距离上下文上限还有多远。

### 2.5 已有可复用基础

`AgentSessionService` 已经用 `ModelRuntime.create({ authPath, modelsPath })` 初始化运行时，并通过 `createAgentSession({ modelRuntime })` 把同一个运行时交给会话。这意味着认证、模型目录、请求构造和流式解析都已经在 Pi 内部完成，本次只需要把它的能力暴露出来，而不是重新实现。

工作区里另有一批未提交的 Agent 改动（Skills 自动补全、命令放行名单、shell/编码模块），它们与本方案不冲突：本次只替换配置入口和模型/usage 数据源，保留 Skills 发现、权限审批与 shell 工具的现有行为。

## 三、开源实现调研

调研对象覆盖三类：与 Pi 同栈的桌面/本地 Agent、通用编码 Agent 的 context 展示、以及直接使用 Pi SDK 的第三方项目。

| 项目 | 与本需求相关的实现 | 可复用结论 |
|---|---|---|
| `D:\Project\mu-agent` | `src/gui/session-host.ts` 把 `ModelRuntime` 投影成 UI 快照；`settingsProviderView()` 逐个模型调用 `getAuth(model)` 判断可用性且不泄露密钥；`startProviderLogin` / `respondProviderAuth` / `cancelProviderAuth` 组成完整认证状态机；`SettingsPage.tsx` 用 provider 卡片展示认证来源、可用模型数和展开列表 | 认证状态机、Provider 投影结构和卡片信息层级可以直接移植；这是本次最主要的参考实现 |
| `minghinmatthewlam/pi-gui`（MIT） | `runtime-supervisor.ts` 用 `modelRuntime.login(providerId, 'api_key', interaction)` 完成持久化登录；`session-usage.ts` 在 turn 边界读取 `getSessionStats()` 与 `getContextUsage()`；`context-meter.tsx` 用圆环 + hover 卡片显示已用/容量/百分比；`custom-provider-store.ts` 把自定义端点原子写入 `models.json` | 登录应走 `login()` 而不是只写内存 Key；usage 不需要重算，直接透传 Pi 的统计；自定义端点必须落盘到 `models.json` 才能跨重启生效 |
| `openai/codex` | `codex-rs/tui/src/bottom_pane/footer.rs` 的 `context_window_line` 优先显示剩余百分比，退化时显示已用 token；`token_usage.rs` 明确 `total_tokens` 代表当前活跃上下文大小 | 文案应区分"已用/容量"与"剩余"；百分比和 token 数都不可得时要有降级文案，不能显示 0 |
| `opencode` | `packages/tui/src/util/session.ts` 取最后一条带 usage 的 assistant 消息，汇总 input/output/reasoning/cache，再除以模型 context limit | 上下文占用取"最近一次响应"而不是整个会话累计，避免把已压缩的历史重复计入 |
| `Cline` | `ContextWindow.tsx` 用 `lastApiReqTotalTokens / contextWindow` 画进度条，hover 展示输入、输出、缓存读写和百分比 | 进度条 + 明细浮层的交互可以照搬，但数据源换成 Pi 的 `ContextUsage` |

### 3.1 结论：不需要自研 model adapter

Pi 1.6.0 的 `ModelRuntime` 已经是完整的多供应商适配层：

- 在本机 Pi 1.6.0 上实测，`getProviders()` 返回 40 余个 provider、`getModels()` 返回约 1700 个模型；未登录时 `getAvailableSnapshot()` 只包含本地 magpie 一项。这些数量随版本、`models.json` 与凭据变化，代码不应写死，界面也不能用固定数量做布局假设；
- 每个 provider 暴露 `auth.apiKey` 与可选的 `auth.oauth`，其中 9 个支持 OAuth（anthropic、github-copilot、kimi-coding、meta、openai、openai-codex、openrouter、radius、xai）；
- `login(providerId, type, interaction)` 负责交互式输入、OAuth 回调、device code 和凭证持久化，`logout()` 负责清除；
- `Model` 自带 `api`、`baseUrl`、`input`、`reasoning`、`thinkingLevelMap`、`contextWindow`、`maxTokens`、`promptCache`、`cost`，请求构造与 usage 解析都在 SDK 内完成；
- `models.json` 支持 `providers.{id}.{ baseUrl, api, apiKey, authHeader, models, modelOverrides, headers }`，足以覆盖自定义 OpenAI 兼容端点。

因此本次不引入新的 HTTP 客户端或协议适配代码，只做三件事：把运行时投影成可序列化的 UI 数据、把认证交互桥接到 Electron IPC、把 usage 透传到渲染层。

### 3.2 与现有自研链路的边界

项目里另有一套用于"任务拆解/总结"的 API 配置（`config/requestBodyConfig.ts`、`api/taskSplitApi.ts`），它服务于 Webview 总结链路，与本地 Agent 的 `ModelRuntime` 不是同一条路径。本次不合并两者：Agent 的供应商配置写入应用数据目录下的 `agent/auth.json` 与 `agent/models.json`，不修改 `apiConfig.providers`。这样可以避免一次改动同时影响总结、任务拆解和历史数据的既有行为。

## 四、总体方案

### 4.1 分层

```
Renderer
  SettingsDrawer
    └─ 本地 Agent 入口卡片 ── 打开 AgentSettingsDialog
  AgentSettingsDialog（新，挂在 Layout）
    ├─ AgentProviderSettings ────── 供应商卡片 / 认证弹窗
    └─ AgentSkillsSettings ─────── Skills 目录 / 命令放行
  AgentComposer
    ├─ AgentModelPicker（新）────── 搜索 + 按 provider 分组 + 当前标记
    ├─ AgentThinkingPicker（新）─── 仅在 supportsThinking 时出现
    └─ AgentContextMeter（新）───── 容量、占用、百分比、明细
        │
        │ window.api.agent*
        ▼
Preload（仅类型化桥接）
        ▼
Main
  AgentSessionService
    ├─ ModelRuntime（Pi 提供，唯一 provider/model/auth 适配层）
    ├─ ProviderAuthController（新，移植 mu-agent 状态机）
    └─ SessionUsageReader（新，薄封装 getContextUsage/getSessionStats）
```

主进程负责所有涉及凭证、网络和文件的操作；渲染层只持有投影后的非敏感数据和操作状态。任何 API Key、OAuth access/refresh token 都不进入 IPC 返回值，也不写入 Zustand。

### 4.2 数据流

打开 Agent 配置弹窗时：

1. 渲染层调用 `agent:get-runtime-snapshot`；
2. 主进程先用 `getAvailableSnapshot()` 建立 `provider:model` 可用集合，再遍历 `getProviders()`，对每个 provider 读取 `getProviderAuthStatus()` 并投影模型；只有在快照为空或 provider 报错时才回退到逐个 `getAuth(model)` 校验；
3. 返回 provider 列表、模型列表、当前 active provider/model/thinking、可用 thinking 档位和 context 快照；
4. 渲染层渲染 Connected / 需要处理 / 可连接三组卡片。

发起登录时：

1. 渲染层调用 `agent:login-provider({ providerId, type })`；
2. 主进程创建 `operationId`，异步执行 `modelRuntime.login()`，立即返回 `running` 快照；
3. SDK 通过 `interaction.prompt()` 请求输入时，主进程把 prompt 挂到 operation 上并通过 `agent:provider-auth-changed` 事件推送；
4. 渲染层展示输入框或选项，用户提交后调用 `agent:respond-provider-auth({ operationId, value })`；
5. SDK 通过 `interaction.notify()` 发出授权 URL 或 device code 时，同样经事件推送；
6. 登录成功后主进程刷新模型目录，把 operation 置为 `success`，渲染层重新拉取快照。

发送消息后：

1. Pi 在响应结束时更新内部 usage；
2. 主进程在 `message_end`、`agent_end`、`compaction_end`、`thinking_level_changed` 事件上附带最新的 usage 快照；
3. 渲染层更新 context meter，不需要额外轮询。

## 五、主进程设计

### 5.1 运行时快照

新增可序列化类型，放在 `src/shared/types/agentRuntime.ts`（主进程与渲染层从同一份类型导入，渲染层的 `types/agent.ts` 只做重导出）：

```ts
export type AgentThinkingLevel =
  | 'off' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max'

export interface AgentProviderModel {
  providerId: string
  id: string
  name: string
  available: boolean
  reasoning: boolean
  input: Array<'text' | 'image'>
  contextWindow: number
  maxTokens: number
}

export interface AgentProvider {
  id: string
  name: string
  configured: boolean
  authType?: 'api_key' | 'oauth'
  authSource?: 'stored' | 'runtime' | 'environment' | 'fallback'
    | 'models_json_key' | 'models_json_command'
  authLabel?: string
  apiKeyAvailable: boolean
  oauthAvailable: boolean
  oauthName?: string
  oauthLoginLabel?: string
  isSubscription?: boolean
  modelCount: number
  availableModelCount: number
  models: AgentProviderModel[]
  error?: string
}

export interface AgentContextUsage {
  tokens: number | null
  contextWindow: number
  percent: number | null
}

export interface AgentRuntimeSnapshot {
  providers: AgentProvider[]
  active: {
    providerId: string
    modelId: string
    modelName: string
    thinkingLevel: AgentThinkingLevel
    availableThinkingLevels: AgentThinkingLevel[]
    supportsThinking: boolean
  }
  context: AgentContextUsage | null
  stats: {
    input: number
    output: number
    cacheRead: number
    cacheWrite: number
    total: number
    cost: number
  } | null
}
```

投影规则：

- `configured` 取 `getProviderAuthStatus(provider.id).configured`，同时兼容"某个模型 `getAuth()` 成功但状态尚未刷新"的情况；
- `available` 优先取 `getAvailableSnapshot()` 的集合；快照不可用时才回退到 `await modelRuntime.getAuth(model)`，成功即视为可用；解析过程中拿到的 apiKey 立即登记到脱敏集合，不返回；
- `authType` 由 `isUsingOAuth()` 决定，`authSource` 与 `authLabel` 直接透传状态字段；
- `apiKeyAvailable` 只在 `provider.auth.apiKey?.login` 存在时为真，避免给"仅环境变量"的 provider 渲染一个点了没反应的按钮；
- `error` 取 `modelRuntime.getError()` 中与当前 provider 相关的部分，或 `getAuth()` 的异常信息，并经过 `safeError()` 截断到 2000 字符。

`getAvailableSnapshot()` 本身是同步的，打开设置不需要逐模型做网络或认证解析；只有回退路径才按 `providerId` 做 5 秒 TTL 缓存。登录、退出、刷新模型后主动失效。

### 5.2 认证状态机

移植 `mu-agent` 的 `ProviderAuthController`，保持同样的语义：

```ts
interface AuthOperation {
  id: string
  providerId: string
  providerName: string
  type: 'api_key' | 'oauth'
  status: 'running' | 'waiting' | 'success' | 'error' | 'cancelled'
  prompt?: {
    id: string
    type: 'text' | 'secret' | 'manual_code' | 'select'
    message: string
    placeholder?: string
    options?: Array<{ id: string; label: string; description?: string }>
  }
  events: Array<{
    type: 'info' | 'auth_url' | 'device_code' | 'progress'
    message?: string
    url?: string
    instructions?: string
    userCode?: string
    verificationUri?: string
    intervalSeconds?: number
    expiresInSeconds?: number
    links?: Array<{ url: string; label?: string }>
  }>
  error?: string
}
```

实现要点：

- 用 `Map<string, InternalAuthOperation>` 保存进行中的操作，`randomUUID()` 生成 id；
- 同一 provider 同时只允许一个 `running` 或 `waiting` 操作，重复请求返回 409 语义的错误；
- `requestAuthPrompt()` 返回一个 Promise，把 resolve/reject 和 `prompt.id` 一起存进 operation；`respondProviderAuth()` 校验 id 与选项合法性后 resolve；
- `cancelProviderAuth()` 设置 `status = 'cancelled'` 并 `AbortController.abort()`，同时 reject 挂起的 prompt；
- `notifyAuth()` 只接受 `http:` / `https:` URL，消息、说明、选项文本都经 `safeError()` 与长度截断；
- 操作结束后保留 10 分钟供 UI 展示结果，`setTimeout(...).unref()` 避免阻止进程退出；
- 主进程关闭时对所有 operation 调用 abort 并清空 Map。

登录成功后必须调用 `modelRuntime.refresh({ allowNetwork: false, providers: [providerId] })` 刷新该 provider 的可用模型，再广播快照变化。`logout()` 之后同样刷新，避免模型 Picker 继续展示已失效的条目。

### 5.3 凭证持久化

不再手写 `auth.json`。当前 `setCredential()` 直接拼 JSON 写入文件，既不支持 OAuth 字段，也绕过了 Pi 的串行写锁。改造后：

- API Key 登录统一走 `modelRuntime.login(providerId, 'api_key', interaction)`，由 SDK 通过 `CredentialStore.modify()` 原子写入 `agent/auth.json`；
- OAuth 登录走 `modelRuntime.login(providerId, 'oauth', interaction)`，refresh token 的刷新与轮换由 SDK 在锁内完成；
- 退出登录走 `modelRuntime.logout(providerId)`；
- 删除现有的 `setCredential` / `deleteCredential` IPC，或保留为内部兼容方法但改为调用上述 API；渲染层不再直接传 Key。

这样做的直接收益是：OAuth token 过期后 SDK 能自动刷新，不会因为手写文件缺少 `expires` 字段而反复失败。

### 5.4 自定义端点

当前 UI 允许输入 Base URL，但运行时并未生效。正确做法是把自定义端点写入 `agent/models.json`：

```jsonc
{
  "providers": {
    "my-endpoint": {
      "name": "My Endpoint",
      "baseUrl": "https://example.com/v1",
      "api": "openai-completions",
      "apiKey": "unused",
      "models": [
        {
          "id": "my-model",
          "name": "My Model",
          "reasoning": false,
          "input": ["text"],
          "contextWindow": 128000,
          "maxTokens": 8192
        }
      ]
    }
  }
}
```

实现约束：

- provider id 必须匹配 `^[a-z0-9][a-z0-9-]{0,63}$`，避免与内置 provider 冲突；
- `baseUrl` 只接受 `http:` / `https:`；
- 至少配置一个模型，模型 id 在同一 provider 内唯一；
- 写入采用"读现有 JSON → 合并 → 临时文件 → rename"的原子替换，保留其他 provider 的内容；
- 写入后调用 `modelRuntime.refresh({ allowNetwork: false })`；`refresh()` 会重新 `ModelConfig.load(modelsPath)` 并重组 provider，因此磁盘配置立即生效。`registerProvider()` 只改内存，下一次 `refresh()` 就会被覆盖，不能作为持久化手段；
- 真正的 API Key 仍通过 `login(id, 'api_key')` 写入 `auth.json`，`models.json` 里的 `apiKey` 只作为"该 provider 需要认证"的占位。

如果本次只要求"复用 Pi 面板"，自定义端点可以放到第二阶段；但文档与 UI 不应继续保留一个无效的 Base URL 输入框。第一阶段的处理方式是隐藏该输入，等 `models.json` 写入链路完成后再开放。

### 5.5 thinking level

`AgentSession` 已提供：

- `setThinkingLevel(level, { persist })`：超出模型能力时会自动 clamp；
- `getAvailableThinkingLevels()`：返回当前模型支持的档位；
- `supportsThinking()`：模型是否支持推理；
- `thinking_level_changed` 事件：无论来自 UI 还是其他入口，都会通知。

新增 `agent:set-thinking-level`，参数为 `{ sessionId, level }`。主进程调用 `session.setThinkingLevel(level, { persist: true })`，然后用 `session.thinkingLevel` 和 `getAvailableThinkingLevels()` 回读实际生效值。不要把用户请求的档位直接写进 store，因为模型可能把 `xhigh` clamp 成 `high`。

切换模型时，Pi 会根据新模型重新 clamp thinking；主进程必须在 `setModel` 成功后回读并广播，避免 UI 显示旧档位。

### 5.6 context 与 usage

`getContextUsage()` 的语义需要严格按 SDK 实现理解：

- 模型没有 `contextWindow` 时返回 `undefined`；
- 刚完成 compaction、还没有新的 assistant usage 时返回 `{ tokens: null, percent: null }`；
- 其余情况返回"最近一次 assistant 响应的 `usage.totalTokens` + 之后新增消息的估算值"。

因此 UI 必须能表达三种状态：有数值、暂时未知、模型不支持统计。不能把 `null` 当成 0，也不能用 `input + output` 自行重算。

`getSessionStats()` 返回整个会话的累计 token 与成本（包含已被压缩的历史），适合放在 hover 明细里，不适合作为 context 占用。两者职责分开：

- context meter 主体使用 `getContextUsage()`；
- hover 卡片下半部分展示 `getSessionStats()` 的累计输入、输出、缓存读、缓存写、总 token 与成本。

主进程在以下时机读取并附带快照：

- `message_end`：一次 assistant 响应结束，usage 已更新；
- `agent_end`：整个 turn 结束；
- `compaction_end`：压缩完成，`tokens` 可能变为 `null`；
- `thinking_level_changed`：档位变化；
- 会话创建、恢复、切换模型后。

事件负载保持现有 `agent:event` 不变；主进程只在 `message_end`、`agent_end`、`agent_settled`、`compaction_end`、`thinking_level_changed`、`model_select` 上额外推送一条 `agent:session-status`，避免在每条事件里重复携带大对象。渲染层同时保留 `agent:get-session-status`，用于会话创建、恢复与切换模型后主动拉取。

## 六、IPC 契约

所有新增方法返回 `{ success, data?, error? }`，错误信息经过脱敏。

| 通道 | 参数 | 返回 | 说明 |
|---|---|---|---|
| `agent:get-runtime-snapshot` | 无 | `AgentRuntimeSnapshot` | 配置弹窗与 Picker 共用的主数据源 |
| `agent:get-session-status` | `{ sessionId }` | `{ active, context, stats }` | 事件后刷新 usage 与 thinking |
| `agent:set-thinking-level` | `{ sessionId, level }` | `AgentActiveModel` | 回读 clamp 后的实际档位与可用档位；`sessionId` 为空时只持久化选择 |
| `agent:login-provider` | `{ providerId, type }` | `AuthOperation` | 异步启动，立即返回 running |
| `agent:respond-provider-auth` | `{ operationId, value }` | `AuthOperation` | 提交 text/secret/select 输入 |
| `agent:cancel-provider-auth` | `{ operationId }` | `AuthOperation` | 取消并 abort |
| `agent:logout-provider` | `{ providerId }` | `AgentRuntimeSnapshot` | 清除凭证并刷新目录 |
| `agent:refresh-provider-models` | `{ providerId }` | `AgentRuntimeSnapshot` | 强制网络刷新该 provider |
| `agent:set-model` | `{ sessionId, provider, model }` | `{ success }` | 保留现有通道；成功后由 `agent:get-session-status` 回读 active |
| `agent:set-custom-provider` | `{ id, name, baseUrl, api, models }` | `AgentRuntimeSnapshot` | 第二阶段；写入 `models.json` |

事件：

- `agent:provider-auth-changed`：`{ operation: AuthOperation }`，登录状态、prompt、授权 URL、device code 变化时推送；
- `agent:runtime-changed`：`{ reason: 'login' | 'logout' | 'refresh' | 'model' }`，提示渲染层重新拉取快照。
- `agent:session-status`：`{ sessionId, status }`，在 turn 结束、压缩、档位或模型变化时推送最新 active/context/stats。

`src/preload/index.ts` 增加对应方法；`src/preload/index.d.ts` 与 `src/renderer/src/env.d.ts` 继续从 `API` 类型派生，不手写重复接口。`src/renderer/src/types/agent.ts` 的 `AgentIpcApi` 同步补齐，`agentSessionStore` 增加 `snapshot`、`authOperations`、`sessionStatus` 三个状态。

## 七、渲染层设计

### 7.1 设置抽屉入口与独立配置弹窗

`SettingsDrawer.tsx` 保留现有的"本地 Agent"区块（位于"命令行与 Agent 集成"之后）和它周围的所有设置项，只把"配置"按钮改为打开 `AgentSettingsDialog`。抽屉里不出现供应商列表、模型列表或 Skills 控件，避免把完整配置塞进 500px 的抽屉。

入口卡片沿用现有设置区块的写法：

```tsx
<div>
  <h3 className="flex items-center gap-2 font-semibold text-text-primary mb-4">
    <AppIcon name="smart_toy" size={20} className="text-primary" />
    本地 Agent
  </h3>
  <div className="p-4 rounded-xl glass-panel flex items-center justify-between">
    <div>
      <div className="text-sm text-text-primary font-medium">Agent 配置</div>
      <div className="text-xs text-text-secondary mt-1">模型凭证、全局 Skills 目录与命令放行名单</div>
    </div>
    <button type="button" onClick={openAgentSettings}>配置</button>
  </div>
</div>
```

`AgentSettingsDialog` 挂载在 `Layout.tsx`，而不是挂在抽屉内部。原因是模型 Picker 的空状态也需要打开它，此时抽屉通常是关闭的；把弹窗放在全局布局上可以保证入口与层级一致。弹窗沿用 `ModelOrderModal` 的视觉规范：全屏遮罩、`glass-panel-heavy`、`max-w-xl`、`max-h-[85vh]`、右上角圆形关闭按钮。弹窗顶部用两个 tab 区分"供应商"与"Skills 与放行"，正文区域独立滚动。

供应商 tab 内的卡片不使用新的视觉语言，沿用 `glass-panel`、`text-text-primary`、`text-text-secondary`、`rounded-lg` 和现有的 hover 背景。每个 provider 一行：

- 左侧状态点 + provider 名称 + provider id（等宽小字）；
- 第二行显示认证来源标签（"已登录"、"环境变量"、"models.json"、"未配置"）与 `可用数/总数` 个模型；
- 右侧操作：`API Key`、`OAuth 登录`（按 `oauthLoginLabel` 显示）、`退出登录`（仅 stored/runtime 来源）、刷新图标、展开模型；
- 展开后按模型列出名称、思考/图像能力标签与 context 窗口；
- 错误信息用现有红色提示条展示，不弹 alert。

provider 较多时按三组折叠：`已连接`（configured 且可用模型数大于 0）、`需要处理`（configured 但 0 可用，或有 error）、`可连接`（未配置）。默认只展开已连接组，其余组显示数量。搜索框按名称与 id 过滤，避免几十个 provider 直接铺满弹窗。

认证弹窗通过 `createPortal` 挂到 `document.body`，避免被配置弹窗的滚动容器裁剪；内容是独立的 `AgentAuthDialog`：

- 顶部：provider 名称 + 状态徽标（处理中/等待输入/已完成/失败/已取消）；
- 中部：事件列表，`auth_url` 渲染为"打开授权页面"链接，`device_code` 同时显示验证地址和可复制的 user code；
- 底部：根据 `prompt.type` 渲染 text/password/select；`select` 的选项来自 `prompt.options`，提交的是 option id；
- 操作：`取消` 始终可用（结束态隐藏），`提交` 在输入为空时禁用；
- 关闭弹窗不等于取消登录：如果 operation 仍在 running，关闭后可在 provider 卡片上看到"进行中"并重新打开。

### 7.2 模型 Picker

`AgentComposer` 右下角改为两个独立控件：

1. 模型按钮：显示当前模型名（过长截断），点击打开 `AgentModelPicker`；
2. thinking 按钮：仅在 `supportsThinking` 为真时显示，显示当前档位（如"高"），点击打开档位列表。

Picker 结构参考 `mu-agent` 的 `ModelSelectPopover`：

- 顶部固定搜索框，自动聚焦，`Esc` 先清空搜索再关闭；
- 列表按 provider 分组，组头显示 provider 名称与可用数；每组内只列 `available` 的模型，避免用户选到必然失败的条目；
- 当前模型用 `bg-blue-50/50` 与右侧对勾标记；
- 每项第二行显示 provider id 与 context 窗口（如 `262k`），不写解释性句子；
- 空结果显示"没有可用模型"，并在下方给一个"打开供应商设置"的文字按钮，点击后直接打开独立配置弹窗，不要求先打开抽屉；
- 选择后立即调用 `agent:set-model`，成功后关闭 Picker；失败时在 Picker 内显示脱敏错误，不关闭，便于重试。

Picker 的宽度以输入区为准（约 320px），最大高度 320px，内部滚动；不使用全屏 modal，避免遮挡消息流。

thinking 列表只渲染 `availableThinkingLevels`，不硬编码四档。标签使用简短中文：关闭、极低、低、中、高、极高、最大；`off` 仅在模型确实允许关闭时出现。

### 7.3 context meter

位置放在输入框下方、发送按钮左侧，与权限模式同一行。默认紧凑态只显示一段等宽文本：

```
12.4k/262k · 5%
```

规则：

- `tokens === null` 时显示 `待更新`，hover 说明"上下文占用将在下次模型响应后更新"；
- `contextWindow` 缺失或为 0 时不渲染该控件，避免出现无意义的分母；
- 新会话 usage 全为 0 时不渲染，避免出现 `0/262k` 的噪声；
- 百分比四舍五入到整数；`> 90%` 用 `text-rose-600`，`> 70%` 用 `text-amber-600`，其余 `text-text-secondary`；
- 数字格式化：小于 1000 显示原值，小于 1M 用一位小数的 `k`，大于等于 1M 用一位小数的 `M`；
- 点击或 hover 展开明细卡片，显示：
  - 已用 / 容量 / 百分比；
  - 累计输入、输出、缓存读、缓存写；
  - 累计成本（若模型 cost 为 0 则显示"未计费"）；
  - compaction 后若 `tokens` 为 null，显示"压缩完成，等待下一次响应"。

不要在紧凑态显示"剩余 95%"与"已用 5%"两套语义混用。统一采用"已用 / 容量 · 百分比"，与 Cline、opencode 的口径一致；如果后续要对齐 Codex 的"context left"，只在 hover 卡片里补充一行"剩余"，主体保持不变。

### 7.4 输入区布局

420px 宽度下，底部工具栏分三段：

- 左：附件、权限模式；
- 中：context meter（可压缩为仅百分比）；
- 右：模型按钮、thinking 按钮、发送/停止。

当宽度不足时按以下顺序降级：context meter 先隐藏 token 数只留百分比；再隐藏百分比只留一个细进度点；模型名截断到 96px；thinking 按钮只留图标。不要换行，避免输入框高度跳动。

### 7.5 设置入口的迁移

- 删除 `AgentComposer` 的 `onOpenSettings` prop 与 `Settings2` 图标；
- 删除 `AgentCard` 中的 `settingsOpen` 状态与 `<AgentSettingsModal>`；
- 删除 `AgentSettingsModal.tsx`，把其中仍然需要的 Skills 目录与命令放行名单迁移到独立配置弹窗的"Skills 与放行"tab（权限模式继续由输入区入口负责）；
- 删除 `SettingsDrawer` 里现有的 `agentSettingsOpen` 本地状态与 `<AgentSettingsModal>` 渲染，只保留入口按钮；
- 在 `agentSessionStore` 增加 `openAgentSettings()`，内部调用 `useAgentSettingsDialogStore.getState().open()`，不依赖抽屉是否打开；
- `WorkbenchAiSidebar` 不需要改动，`AgentCard` 顶部现有的"本地 Agent / Webview 平台"下拉保持不变，它负责切换侧边栏承载的内容，不是模型选择器。

## 八、状态与事件同步

`agentSessionStore` 新增：

```ts
snapshot: AgentRuntimeSnapshot | null
authOperations: Record<string, AuthOperation>
sessionStatus: { active; context; stats } | null
snapshotLoading: boolean
```

动作：

- `fetchSnapshot()`：调用 `agent:get-runtime-snapshot`，失败时保留旧快照并记录错误；
- `fetchSessionStatus()`：调用 `agent:get-session-status`，在 `message_end`、`agent_end`、`compaction_end`、`thinking_level_changed`、`resumeSession`、`setModel` 后触发；
- `setThinkingLevel(level)`：调用 IPC 后用返回值覆盖本地状态，不乐观写入；
- `startProviderLogin` / `respondProviderAuth` / `cancelProviderAuth` / `logoutProvider` / `refreshProviderModels`：分别更新 `authOperations` 与 `snapshot`；
- `setModel` 改为接收 `{ providerId, modelId }`，成功后同时刷新 `sessionStatus`。

事件处理保持现有 `handleAgentEvent` 的 switch，只增加"触发刷新"的分支，不在事件里直接计算 token。这样即使 Pi 后续调整 `getContextUsage()` 的实现，UI 也不需要改。

## 九、安全与错误处理

- 渲染层永远拿不到 API Key、OAuth access token、refresh token；`AuthOperation` 只包含状态、提示文本和授权 URL；
- 所有 provider 名称、模型名、错误消息在跨 IPC 前经过 `safeError()`，替换已登记的密钥与 `Bearer xxx`；
- 授权 URL 只允许 `http:` / `https:`，拒绝 `file:`、`javascript:` 等协议；
- `respondProviderAuth` 对 `select` 校验值必须属于 `prompt.options`，对输入长度设上限（100k）；
- 自定义 provider id 使用白名单正则，baseUrl 做协议校验，写入前校验至少一个模型；
- 登录、退出、刷新模型期间禁用对应按钮，避免并发操作同一 provider；
- 主进程退出时 abort 所有 auth operation，并调用 `modelRuntime.settleCredentialWrites()`，防止轮换中的 token 丢失。

## 十、兼容与迁移

- 现有 `agent/auth.json` 与 `agent/models.json` 继续由 Pi 读取，不需要迁移；手工写入的 `{ type: 'api_key', key }` 结构本身合法；
- 现有 `agent:set-credential` / `agent:delete-credential` 若保留，内部改为调用 `login` / `logout`，避免两套写入路径；
- `agent:list-providers` 与 `agent:get-active-model` 可以保留一个版本来兼容旧调用，但渲染层全部迁移到 `agent:get-runtime-snapshot` 后应删除，减少重复数据源；
- `AgentSettingsModal` 删除后，任何引用它的测试或文档需要同步更新；
- 自定义端点的 `models.json` 写入属于新增能力，不改变已有 provider 的配置；若用户已有同名 provider，UI 必须提示覆盖而不是静默替换。

## 十一、验收标准

### 11.1 自动化检查

- `pnpm run lint`
- `npx tsc --noEmit -p tsconfig.node.json --composite false --incremental false`
- `npx tsc --noEmit -p tsconfig.web.json --composite false --incremental false`
- `pnpm run build`

### 11.2 桌面手工验收

在 `pnpm run dev` 中逐项执行：

1. 打开全局设置抽屉，原有设置区块完整可见；"本地 Agent"入口卡片样式与相邻区块一致，抽屉内没有供应商列表；
2. 点击入口的"配置"打开独立弹窗，供应商与 Skills 分两个 tab，遮罩、圆角与关闭按钮与"模型下拉列表排序"等现有弹窗一致；
3. 已配置的 provider 显示"已登录"和正确的可用模型数；未配置的 provider 显示"未配置"且不显示"退出登录"；
4. 对支持 API Key 的 provider 点击 `API Key`，输入一个错误 Key，界面显示脱敏错误且不泄露输入；输入正确 Key 后状态变为已连接，模型数增加；
5. 对支持 OAuth 的 provider 点击登录，能看到授权链接或 device code；完成授权后弹窗显示成功，provider 卡片同步更新；
6. 在授权等待输入时关闭弹窗，重新打开仍能看到进行中的操作；点击取消后状态变为已取消，provider 未被标记为已连接；
7. 在输入区点击模型按钮，只看到 Picker，不再出现设置弹窗；搜索、分组、当前标记、选择后关闭均正常；
8. 选择一个支持推理的模型后出现 thinking 按钮，档位列表与模型能力一致；切换到不支持推理的模型后按钮消失，且不会残留旧档位；
9. 发送一条消息，context meter 在响应结束后更新；hover 能看到输入/输出/缓存/成本明细；百分比与 token 数一致；
10. 触发一次 compaction（长会话或手动压缩），压缩后 meter 显示"待更新"，下一次响应后恢复数值；
11. 切换到另一个 provider 的模型，context 容量随模型变化，thinking 档位按新模型重新 clamp；
12. 重启应用后，已登录 provider、当前模型和 thinking 档位保持；
13. 断开网络后刷新模型，界面显示错误但不影响已有会话继续使用缓存目录。

### 11.3 回归检查

- 侧边栏顶部的"本地 Agent / Webview 平台"切换仍正常，不影响 Webview 卡片的挂载；
- 权限审批卡片、Skills 自动补全、附件注入、停止生成不受影响；
- 设置抽屉中的其他区块（快捷键、缓存、CLI 集成）布局未被挤压；
- 420px 默认宽度下输入区不换行、不溢出，折叠侧边栏后恢复无异常。

## 十二、实施顺序

1. **主进程投影层**：新增 `AgentRuntimeSnapshot`、`getRuntimeSnapshot()`、`getSessionStatus()`、`setThinkingLevel()`，先让 `agent:get-runtime-snapshot` 可用；
2. **认证状态机**：移植 `ProviderAuthController`，接通 `login/respond/cancel/logout/refresh` 与事件推送，替换手写 `auth.json`；
3. **IPC 与 store**：补齐 preload、类型、store 动作，保留旧通道直到渲染层迁移完成；
4. **配置弹窗**：保留抽屉里的"本地 Agent"入口卡片，把 `AgentProviderSettings`、`AgentAuthDialog`、`AgentSkillsSettings` 放进独立的 `AgentSettingsDialog` 并挂到 `Layout`，删除 `AgentSettingsModal` 与抽屉内的弹窗状态；
5. **输入区**：实现 `AgentModelPicker`、`AgentThinkingPicker`、`AgentContextMeter`，移除 `Settings2` 入口；
6. **自定义端点**（可选第二阶段）：实现 `models.json` 原子写入与 `agent:set-custom-provider`；
7. **验收**：按第十一节逐项执行，记录无法在本机验证的项与最小等价步骤。

### 12.1 改动文件清单

| 文件 | 改动 |
|---|---|
| `src/main/services/AgentSessionService.ts` | 删除硬编码 provider 列表与手写 `auth.json`；新增 `getRuntimeSnapshot()`、`getSessionStatus()`、`setThinkingLevel()`、`setModel` 返回值；接入 `ProviderAuthController` |
| `src/main/services/ProviderAuthController.ts`（新） | 移植 mu-agent 的登录状态机、prompt/event 转发、取消与 10 分钟清理 |
| `src/shared/types/agentRuntime.ts`（新） | 主进程与渲染层共享的运行时快照、认证操作与 usage 类型 |
| `src/main/services/redact.ts`（新） | `redactCredential()` / `safeError()`，主进程内共享 |
| `src/main/ipcHandlers.ts` | 新增第六节列出的通道，统一 `{ success, data?, error? }` |
| `src/preload/index.ts` | 增加对应桥接方法与两个事件订阅 |
| `src/renderer/src/types/agent.ts` | 重导出共享类型，扩展 `AgentIpcApi` |
| `src/renderer/src/store/agentSessionStore.ts` | 新增 `snapshot` / `authOperations` / `sessionStatus` 与对应动作，事件后刷新 |
| `src/renderer/src/components/SettingsDrawer.tsx` | 保留"本地 Agent"入口卡片与其余设置项，按钮改为打开独立弹窗 |
| `src/renderer/src/components/Layout.tsx` | 全局挂载 `AgentSettingsDialog` |
| `src/renderer/src/components/workbench/agent/AgentSettingsDialog.tsx`（新） | 独立配置弹窗，含"供应商"与"Skills 与放行"两个 tab |
| `src/renderer/src/components/workbench/agent/AgentProviderSettings.tsx`（新） | Provider 分组卡片、搜索、展开模型、操作按钮 |
| `src/renderer/src/components/workbench/agent/AgentSkillsSettings.tsx`（新） | 全局 Skills 目录与命令放行名单 |
| `src/renderer/src/components/workbench/agent/AgentAuthDialog.tsx`（新） | 认证状态、事件列表、prompt 输入、取消 |
| `src/renderer/src/store/agentSettingsDialogStore.ts`（新） | 配置弹窗的全局开关 |
| `src/renderer/src/components/workbench/agent/AgentModelPicker.tsx`（新） | 搜索、按 provider 分组、当前标记、空状态 |
| `src/renderer/src/components/workbench/agent/AgentThinkingPicker.tsx`（新） | 只渲染可用档位，显示当前值 |
| `src/renderer/src/components/workbench/agent/AgentContextMeter.tsx`（新） | 紧凑态文本 + hover 明细，三档颜色 |
| `src/renderer/src/components/workbench/agent/AgentComposer.tsx` | 移除 `onOpenSettings` 与 `Settings2`，接入三个新组件，处理宽度降级 |
| `src/renderer/src/components/workbench/AgentCard.tsx` | 删除 `settingsOpen` 与 `AgentSettingsModal` 渲染 |
| `src/renderer/src/components/workbench/agent/AgentSettingsModal.tsx` | 删除；Skills 目录、命令放行名单迁入独立配置弹窗 |
| `docs/DOCS_INDEX.md` | 登记本文档 |

`src/preload/index.d.ts` 与 `src/renderer/src/env.d.ts` 由 `API` 类型派生，不需要手写新接口，但要在类型检查中确认自动同步。

## 十三、明确不做

- 不新建一套通用 `ModelAdapter` 接口；Pi 的 `ModelRuntime` 已经是适配层，再包一层只会增加转换成本；
- 不把 Agent 的 provider 配置合并进 `apiConfig.providers`，避免影响总结与任务拆解链路；
- 不在渲染层解析或缓存任何凭证；
- 不做 token 估算的第二套算法，context 数值以 Pi 的 `getContextUsage()` 为唯一来源；
- 不在本次改造中调整 Webview 平台的模型下拉、任务分配或辩论逻辑。
