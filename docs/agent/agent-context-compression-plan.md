> Created: 2026-11-24 14:21 (UTC+8)

# Agent 上下文压缩开发计划

## 一、背景与目标

工作台右侧的本地 Agent 基于 `@earendil-works/pi-coding-agent` SDK 运行。随着会话变长，模型侧输入 token 会持续增长，最终触发两类问题：

1. **工具调用结果过大**：`read` / `bash` / `powershell` 等工具把整段文件内容或终端输出写进上下文，单次结果可达数万 token。
2. **达到上下文窗口后被截断或报错**：pi 已经实现了基于阈值与溢出恢复的自动 compaction，但当前项目没有显式启用、没有可配置参数，也没有把压缩过程暴露给 UI。
3. **工具入参过大**：`bash` / `powershell` 的 `command`、`write` / `edit` 的 `content` 可能携带超长文本，直接推高下一次请求的 token。

目标是建立一套**可配置、可回退、复用 SDK 能力**的压缩链路：

- 工具结果在入库前按规则裁剪（先硬截断，必要时再走模型摘要）。
- 工具入参中的超长文本在进入 LLM 请求前裁剪。
- 达到上下文阈值后自动压缩；支持手动 `/compact`；压缩失败回退到 SDK 默认行为。
- 压缩模型默认复用当前会话模型（`ctx.model`），不另接供应商。
- 压缩提示词复用 pi 内置的 structured summary 模板（业界主流做法，见调研）。
- UI 能感知压缩事件、上下文用量、压缩状态。

## 二、业界主流压缩机制调研

| 机制 | 触发点 | 做法 | 代表实现 |
|------|--------|------|----------|
| **Auto-compaction（上下文达到窗口）** | `contextTokens > contextWindow - reserveTokens`，或 provider overflow / `stopReason:"length"` | 找 cut point → 序列化历史 → 调 LLM 生成 structured summary → 保留尾部最近消息继续 | pi `compaction.ts`、Claude Code `/compact`、Codex CLI compaction、LangChain `SummarizationMiddleware` |
| **Tool result 压缩** | 每次 tool 返回后、写入上下文前 | 超长输出硬截断 + 标记 `[... truncated N chars]`；或先落盘再回填摘要 | pi 内置 `serializeConversation` 截断到 2000 chars；`tool_result` 事件可改写 `content`/`structuredContent` |
| **Tool call 入参压缩** | `tool_call` 事件、LLM 请求前 | 改写 `event.input`（如 `bash.command`、`write.content`）；或注入占位符 + 把原文落盘 | pi `tool_call` 事件允许原地 mutation；`context`/`context_with_system` 事件可整体改写请求消息 |
| **Manual compaction** | 用户显式触发 `/compact [instructions]` | 同 auto-compaction，可带自定义指令聚焦摘要 | pi `session.compact(customInstructions)`、`/compact` 命令 |
| **Branch summarization** | `/tree` 切换分支 | 汇总被放弃分支，注入新分支 | pi `session_before_tree`；本项目暂不开放 tree UI，仅保留机制 |

### 主流压缩提示词结构（业界共识）

pi / Claude Code / LangChain 的 summary prompt 都收敛到同一套结构，本项目直接复用 pi 内置模板：

```
## Goal / Constraints & Preferences / Progress(Done|In Progress|Blocked)
## Key Decisions / Next Steps / Critical Context
<read-files>…</read-files><modified-files>…</modified-files>
```

规则要点：保留**精确文件路径、函数名、错误消息**；增量更新时保留旧摘要全部信息并更新进度；thinking 块不入摘要；tool result 在序列化时先截断。

## 三、现状与接入点分析

### 3.1 pi SDK 已提供的能力（无需重造）

- `createAgentSession` 默认开启 auto-compaction（`enabled:true`，`reserveTokens:16384`，`keepRecentTokens:20000`）。
- `AgentSession.compact(customInstructions?)` 手动压缩、`setAutoCompactionEnabled(bool)` 开关、`isCompacting` 状态、`getContextUsage()` 读取占用。
- 事件钩子（`pi.on(...)`）：
  - `tool_call` —— 可原地改写 `event.input`（入参压缩）。
  - `tool_result` —— 可改写返回 `content`/`structuredContent`/`details`/`isError`（结果压缩）。
  - `context` / `context_with_system` —— 可整体替换发给 LLM 的消息数组（兜底压缩）。
  - `session_before_compact` —— 接管摘要生成，返回自定义 `compaction` 或 `cancel`。
  - `session_compact_failed` —— 失败回调（仅扩展内部可见，不进 `session.subscribe`/`agent:event`，UI 失败提示改用 `compaction_end.errorMessage`）。
  - `session_before_tree` —— 分支摘要。
- `serializeConversation(convertToLlm(messages))` 把消息序列化为摘要用文本（内置 2000 字符截断）。
- `ctx.modelRegistry.complete(model, {messages}, {signal, cacheRetention:'none'})` 发起压缩调用，`ctx.model` 即当前模型。
- `settingsManager.getCompactionEnabled/getCompactionReserveTokens/getCompactionKeepRecentTokens(model)` 读取 per-model 覆盖；`SettingsManager.create(cwd, agentDir)` 走 `agentDir/settings.json` 与 `.pi/settings.json` 两级合并。

### 3.2 当前项目的接入缺口

`AgentSessionService` 目前只做了 session 生命周期、权限拦截、事件转发、模型/供应商管理，**没有接压缩链路**：

- 未注册任何 extension，`tool_call`/`tool_result`/`context`/`session_before_compact` 均未消费。
- `createAgentSession` 未传 `settingsManager`，压缩参数（reserve/keepRecent）只有 SDK 默认值，无法随模型覆盖、也无法被用户设置项调节。
- 未暴露 `session.compact()` 的手动入口，UI 也没有压缩中的状态提示（`isCompacting`、`compaction_start/end` 事件只在 `STATUS_EVENTS` 里列了 `compaction_end`）。
- `AgentContextMeter` 只显示占用，无"压缩"交互。

### 3.3 关键文件

| 文件 | 作用 |
|------|------|
| `src/main/services/AgentSessionService.ts` | session 创建/`wireSession`/事件转发/模型设置；在这里挂 extension 与 settingsManager |
| `src/main/services/AgentResourceLoader.ts` | `DefaultResourceLoader` 封装；加 `extensionFactories` / `additionalExtensionPaths` 传入压缩扩展 |
| `src/main/ipcHandlers.ts` | `agent:*` IPC 注册；加 `agent:compact`、`agent:set-auto-compaction`、`agent:get-compaction-config`、`agent:set-compaction-config` |
| `src/preload/index.ts` + `index.d.ts` | IPC 契约同步 |
| `src/shared/types/agentRuntime.ts` | `AgentSessionStatus`/`AgentRuntimeSnapshot` 扩展 `compaction` 状态字段 |
| `src/renderer/src/store/agentSessionStore.ts` | `compaction_start/end` 状态、压缩中标记、压缩配置读写 |
| `src/renderer/src/components/workbench/agent/AgentContextMeter.tsx` | 显示压缩中状态 + "立即压缩"按钮（可选） |
| `src/main/extensions/contextCompression.ts`（新增） | 压缩扩展本体：`tool_call`/`tool_result`/`session_before_compact` 处理 |

## 四、设计方案

### 4.1 总体架构：一个 Inline Extension + SettingsManager 注入

不新开压缩引擎，把压缩逻辑做成一个 **InlineExtension** 交给 `DefaultResourceLoader` 加载（`extensionFactories` 传入，避免落盘 `.ts` 再被 jiti 加载的路径/打包问题），并给 `createAgentSession` 传入 `settingsManager`（`SettingsManager.create(cwd, agentDir)`），让压缩参数既可被代码默认值控制、又能被 `agentDir/settings.json` 与 `<cwd>/.pi/settings.json` 覆盖。

```
AgentSessionService
  └─ createAgentSession({ sessionManager, resourceLoader, settingsManager, ... })
        └─ resourceLoader (AgentResourceLoader)
              └─ DefaultResourceLoader({ extensionFactories: [contextCompressionExtension], ... })
                    └─ contextCompressionExtension(pi)
                          ├─ on("tool_call")      → 入参超长裁剪
                          ├─ on("tool_result")    → 结果超长裁剪/摘要
                          ├─ on("session_before_compact") → 自定义摘要（用 ctx.model）
                          └─ on("session_compact_failed") → 失败上报/回退
```

### 4.2 压缩策略（三层，按触发点）

**第 1 层：工具入参裁剪（`tool_call`）**
- 针对 `bash`/`powershell` 的 `command`、`write`/`edit` 的 `content` 等已知超长字段，超阈值（默认 ~20000 chars / 可配）时把正文落盘到 `agentDir/compression/inputs/<toolCallId>.txt`，把 `event.input` 改写为占位符 `[原 N 字符已存至 <path>，可用 read 工具按需读取]`。
- 保留字段名/参数结构，mutation `event.input` 即可（SDK 明确支持，无需重校验）。
- 不裁剪短入参、不影响 deny/审批链路。

**第 2 层：工具结果裁剪（`tool_result`）**
- 读取 `event.content` 中 `type==='text'` 的块，累计字符数。
- ≤ `toolResultSoftCap`（默认 8000 chars）不处理；超过则：
  - 先把原始结果落盘 `agentDir/compression/results/<toolCallId>.txt`；
  - 若配置 `toolResultUseModel` 且当前模型可用 → 用 `ctx.modelRegistry.complete(ctx.model, …)` 生成 1–2 段保留关键路径/错误/行号的摘要替换 `content`（**注意：此调用串行阻塞该结果入库，长会话里每条超长结果都会多一次 LLM 往返；默认关，开启时加 30s `signal` 超时**）；
  - 否则硬截断为 `softCap` + `[... truncated N chars, full output saved to <path>]`。
- `structuredContent` 同步替换或清除（SDK：改 `content` 不改 `structuredContent` 会丢后者，保持一致）。
- 失败（模型调用异常/超时/中止）→ 回退硬截断，不阻断工具结果入库。

**第 3 层：达到上下文窗口后的会话压缩（`session_before_compact`）**
- 复用 SDK 默认流程找 cut point；在钩子里决定是否自定义摘要。
- 默认 `mode='sdk'`：直接 `return undefined`，走 pi 默认 `generateSummary`（即上面那套 structured prompt），**这是推荐默认**，零模型额外设计成本。
- `mode='custom'`：用 `ctx.model`（当前模型，满足"默认调用当前的模型"）+ 同结构 prompt（可带 `customInstructions`），返回 `{compaction:{summary, firstKeptEntryId, tokensBefore, usage}}`。
  - **`isSplitTurn` 分支**：当 `preparation.isSplitTurn` 为 true 时，`turnPrefixMessages` 是被截断的用户消息段前缀，pi 会对其单独生成摘要再与历史摘要合并；custom 模式须分别处理 `messagesToSummarize`（历史摘要）与 `turnPrefixMessages`（当前 turn 前缀摘要），而非拼成一条。`serializeConversation(convertToLlm(…))` 分两次调用。
- 自定义摘要失败/为空 → `return undefined` 回退 SDK 默认；`{cancel:true}` 仅保留给显式用户取消。
- `customInstructions`（来自 `session.compact(instr)` 手动调用）透传进 prompt，聚焦摘要。

**兜底：`context` 事件（后续迭代，v1 不实现）**
- 预留位：仅当后续需要时，在 `context` 里对超大 `toolResult` 消息再做一次摘要替换。v1 不做，避免与 1/2 层重复、防止同一条结果被压缩两次。

### 4.3 压缩模型选择

- 默认：**`ctx.model`**（当前会话模型），满足"需要调用模型时默认用当前的模型"。
- 预留 `compression.modelOverride`（`provider/modelId`，v1 不做 UI）：经 `ctx.modelRegistry.find(provider, modelId)` 解析，解析不到回退 `ctx.model`。
- 压缩调用 `cacheRetention:'none'`、独立 `sessionId`（`uuidv7()`）、透传 `event.signal`，`maxTokens` 按 `model.maxTokens` 收紧到 `min(8192, model.maxTokens)`。
- 与 pi 默认一致：摘要请求不算 cache 写，避免污染会话缓存。

### 4.4 配置模型（SettingsManager + UI）

`agentDir/settings.json`（SDK 原生位置，只放 SDK 认识的 `compaction.*`）+ 项目 `.pi/settings.json`；**`compression.*` 自定义项放 electron-store，不写入 `settings.json`**，避免 SettingsManager 对未知键做 schema 校验时报错。

```jsonc
// agentDir/settings.json —— SDK 原生 section
{
  "compaction": {
    "enabled": true,
    "reserveTokens": 16384,
    "keepRecentTokens": 20000,
    "modelOverrides": { "provider/model-id": { "reserveTokens": 400000 } }
  }
}
// electron-store（config.json）—— 本项目自定义 section，键名 agent_compression
{
  "agent_compression": {
    "toolCallMaxChars": 20000,
    "toolResultSoftCap": 8000,
    "toolResultHardCap": 20000,
    "toolResultUseModel": false,    // true=超长结果用当前模型摘要，false=硬截断
    "summarizerMode": "sdk",        // "sdk"=pi 默认摘要 | "custom"=自定义 prompt
    "modelOverride": null           // "provider/modelId"（v1 预留，无 UI），null=用当前模型
  }
}
```

- `compaction.*` 由 `settingsManager` 原生消费（SDK 内部读），`AgentSessionService` 通过 `getCompactionSettings(model)` 查询生效值。
- `agent_compression` 是我们自己的键，`AgentSessionService` 从 electron-store 读取（与 `agent_active_model` 等现有键一致），注入到 extension 工厂闭包；改配置时需重建 session 或对 `session.setAutoCompactionEnabled` 热更。
- `modelOverrides` 沿用 SDK 原生结构，键必须是精确 `provider/modelId`。

### 4.5 手动压缩入口

- IPC `agent:compact { sessionId, instructions? }` → `session.compact(instructions)`。
- UI：在 `AgentContextMeter` 加"立即压缩"按钮（占用 >0 时可点，压缩中禁用转圈）；占用超过 ~80% 时给醒目提示。
- 事件：`compaction_start`（转圈，需加进 `STATUS_EVENTS`）、`compaction_end {reason,result,aborted,willRetry,errorMessage}`（刷新 context/stats；`errorMessage`/`aborted` 做失败 toast）；`session_compact_failed` 只用于扩展内部日志，不进 UI。
- **手动压缩前置**：`session.compact()` 会先 abort 当前 agent run；agent 正在 streaming 时按钮禁用或二次确认。
- 权限：压缩只读历史 + 调模型，不需要走 PermissionEngine。

### 4.6 事件与 UI 状态

`agentRuntime.ts` 扩展：

```ts
interface AgentSessionStatus { active: AgentActiveModel; context: AgentContextUsage|null; stats: AgentSessionStats|null;
  compaction: { enabled: boolean; isCompacting: boolean; reserveTokens: number; keepRecentTokens: number; lastResult?: { tokensBefore:number; summaryChars:number; at:number } } }
```

`agentSessionStore`：监听 `compaction_start`（`STATUS_EVENTS` 需补此项）/ `compaction_end` → `isCompacting` 标记、`fetchSessionStatus` 刷新 meter；`compaction_end.errorMessage` → 错误提示。`AgentComposer` 输入框在 `isCompacting` 时禁用发送或显示"压缩中…"。

### 4.7 数据落盘

- 裁剪的原始入参/结果：`agentDir/compression/{inputs,results}/<toolCallId>.txt`，附 `meta`（toolName、sessionId、原始长度、时间戳），7 天 TTL 惰性清理，不进入会话历史、不外传。
- 摘要进 `CompactionEntry` 由 `SessionManager` 持久化到 session `.jsonl`（SDK 原生），`details` 记 `{readFiles, modifiedFiles, toolResultTruncated, toolCallTruncated}`。

## 五、压缩提示词（复用 pi 内置模板，业界最佳实践）

直接沿用 SDK 的 `SUMMARIZATION_PROMPT` / `UPDATE_SUMMARIZATION_PROMPT`（首次摘要 vs 增量更新），自定义模式原样复用，仅在 `customInstructions` 存在时追加 `Focus additionally on: <instructions>`。要点：保留精确文件路径/函数名/错误串；thinking 块剔除；tool result 序列化先截断。这与 Claude Code `/compact`、LangChain `SummarizationMiddleware` 的结构一致，避免自创格式。

## 六、实施步骤

1. **基础设施**：`AgentSessionService` 创建 `SettingsManager` 并传入 `createAgentSession`；`AgentResourceLoader` 增加 `extensionFactories` 透传。
2. **压缩扩展**：新增 `src/main/extensions/contextCompression.ts`，实现 `tool_call`/`tool_result`/`session_before_compact`/`session_compact_failed` 四个 handler + 落盘/截断/摘要工具函数。
3. **配置读取**：`AgentSessionService` 从 electron-store 读 `agent_compression` 键，注入 extension 闭包；`agent:get-compaction-config` / `agent:set-compaction-config` IPC 同时代理 `compaction.*`（`settingsManager` 查询）与 `agent_compression`（store 读写）。
4. **手动入口 + 状态**：`agent:compact` IPC、`agent:set-auto-compaction`；`AgentSessionStatus` 加 `compaction`；`STATUS_EVENTS` 补 `compaction_start`；store/UI 消费 `compaction_start/end`（`errorMessage`/`aborted` 做失败提示）。
5. **UI**：`AgentContextMeter` 加压缩状态与手动按钮；`AgentComposer` 压缩中态。
6. **契约同步**：`preload/index.ts`、`index.d.ts`、`renderer` 调用点、`agentRuntime.ts` 类型。

## 七、验证

- `pnpm run lint` + `pnpm run build` + 定向 `npx tsc --noEmit -p tsconfig.node.json` / `tsconfig.web.json`。
- `pnpm run dev` 手动：构造长会话（多轮大 `bash`/`read` 输出）→ 观察 `AgentContextMeter` 上升 → 触发 auto-compaction（`compaction_start/end` 事件、token 回落、summary 出现在 session .jsonl 的 `CompactionEntry`）→ 手动 `agent:compact` 验证自定义指令生效 → 关 `enabled` 验证不触发 → `toolResultUseModel` 开/关两条路径各验一次。

## 八、风险与边界

- **不重复造轮子**：auto-compaction 的 cut-point/投影/重试/持久化全部用 SDK；本项目只做"配置注入 + 出入参/结果裁剪 + 可选自定义摘要 + UI 状态"。
- **模型调用成本**：默认 `summarizerMode:'sdk'` + `toolResultUseModel:false`，0 额外模型调用；开 `custom`/`toolResultUseModel` 后每次压缩/每条超长结果多一次 `ctx.model` 调用，已在配置里显式开关。
- **回退**：任何自定义摘要失败 → `return undefined` 走 SDK 默认；`session_compact_failed` 只上报不吞错。
- **权限**：压缩链路不引入新的文件写权限之外的副作用（`agentDir/compression/*` 是应用数据目录）。
- **session 共享**：所有 Webview `persist:shared` 与此无关（压缩在 SDK 会话上下文内，不动 webview cookie）。
