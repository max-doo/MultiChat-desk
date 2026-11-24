> Created: 2026-11-23 23:19 (Asia/Shanghai, UTC+08:00)

# 工作台本地 Agent 开发方案 · 独立审查报告

审查对象：`docs/agent-sidebar-dev-plan.md`（下称"方案"）。对照依据：用户原始需求 7 条、代码事实（`WorkbenchAiSidebar.tsx` / `workbenchStore.ts` / `appStore.ts` / `historyManager.ts` / `cliIntegration.ts` / `electron-builder*.yml` / `preload`）、两份调研报告（`agent-sidebar-ui-research.md`、`pi-agent-ecosystem-research.md`）、原型 `docs/prototypes/agent_sidebar_prototype.html`。

---

## 结论：需修改（有 2 个 P0/P1 级缺口 + 多处代码事实偏差）

方案的技术选型方向正确：Pi SDK 自持消息状态 + assistant-ui `ExternalStoreRuntime`、spawn+shell-quote 而非 node-pty、复用 `DefaultResourceLoader` 做 AGENTS.md/Skills、三档权限引擎放主进程——这些与两份调研报告结论一致，没有过度设计。但存在以下必须修正的问题：

1. **P0：API Key / 模型供给链路完全缺失**。方案有 `agentSetModel` IPC 和"SWE-2 · Devin"状态指示，却没有任何一节说明本地 Agent 的 LLM 凭证从哪来（`~/.pi` 自配？复用现有 `requestBodyConfig` 供应商配置？还是新增设置页？）。没有这条链路，M1 验收点"输入文本拿到流式回复"无法通过。
2. **P0：会话恢复语义含糊 + 历史结构与代码事实不符**。方案选 `SessionManager.inMemory()` 等于放弃 Pi 自带的落盘恢复，同时声称"结构对齐现有 HistoryManager"——但现有 `HistoryItem` 是 `{ models: string[], turns: ConversationTurn[]（responses: Record<modelId, md>）, productMode }`，既没有 `platform` 字段也没有 `messages` 数组，方案写的 `{ id, platform: 'local-agent', title, messages }` 是虚构结构。
3. **多处代码事实偏差**（字段名 `activeProjectRoot` 不存在应为 `workspacePath`；下拉数据源在 `WebviewCard` 内部而非 `WorkbenchAiSidebar`；`window.api.showOpenDialog` 不存在应为 `selectFile`；`index.d.ts`/`env.d.ts` 是自动派生不需手改）。

修正以上缺口与事实错误后，方案可执行。

---

## 逐条问题清单

### P0（阻断性错误，必须修正才能实施）

**P0-1 ｜ HistoryManager 会话结构与代码事实不符**
- 定位：方案 §3.7"会话与历史持久化"
- 问题：方案写"结构对齐现有 `{ id, platform: 'local-agent', title, createdAt, messages }`"。实际 `src/shared/types/history.ts` 的 `HistoryItem` 没有 `platform` 字段、没有 `messages` 数组——真实结构是 `{ id, createdAt, updatedAt, models: string[], title?, turns: ConversationTurn[], urls?, productMode?, displayMode?, debateTurns?, slotUrls? }`，其中 `ConversationTurn = { turnId, userMessage, timestamp, responses: Record<modelId, markdown> }`。`HistoryManager`（`src/main/api/historyManager.ts`）只按 `conversation`/`summary` 两种 kind 分目录，不认识 `platform`。
- 后果：照方案实现，`agent-<id>.json` 落盘后会被现有历史列表/读取逻辑当成畸形数据（`turns` 缺失、`models` 缺失），历史菜单恢复必然报错或显示空白。
- 建议：二选一——(a) 扩展 `HistoryItem`：新增可选 `productMode: 'agent'`（或复用 `'workbench'` + `models: ['local-agent']`），把 agent 消息折叠进 `turns[].responses`（user→turn.userMessage，assistant text+工具摘要→turn.responses['local-agent']），优点是复用现有列表/导出/迁移机制；(b) 明确声明 agent 会话走独立存储（`history/agent-sessions/` 新 kind），HistoryManager 加第三种 kind，不混入现有 conversation 列表。无论哪条，方案必须给出与 `HistoryItem`/`HistoryListItem` 实际字段对齐的结构草案。

**P0-2 ｜ LLM 凭证/模型供给链路缺失**
- 定位：方案整体（§2 架构图、§4 IPC `agentSetModel`、§6 M1 验收）
- 问题：方案假设 `createAgentSession()` 开箱就能跑，但 Pi 底层 `pi-ai` 需要 provider 凭证（API key / base URL / model id）。方案没有任何一节说明：凭证存哪（electron-store？`~/.pi/agent/settings.json`？环境变量？）、模型列表从哪来（内置清单？复用 `config/requestBodyConfig.ts` 的供应商配置？）、`agentSetModel` 的可选值枚举、无凭证时的 UI 表现。
- 后果：M1"输入文本能拿到流式回复"无法实现；用户装好功能后面对一个永远报错的 agent。
- 建议：补一节"模型与凭证配置"：明确走 `~/.pi` 自配 vs MultiChat 设置页托管 vs 复用任务拆解 API 的供应商配置；给出 `agentListModels()` IPC 或静态清单；`agentPrompt` 在无凭证时返回结构化错误供 UI 提示去设置页。

### P1（重要缺陷，影响功能完整性或验收）

**P1-1 ｜ 工作区字段名错误 + 未处理"未打开项目"边界**
- 定位：方案 §3.5"`cwd` 参数 = 用户在工作台打开的项目根目录（从 `workbenchStore.activeProjectRoot` 拿）"
- 问题：`workbenchStore` 中不存在 `activeProjectRoot`，真实字段是 `workspacePath: string | null`（`workbenchStore.ts:145`）。更关键的是 `workspacePath` 可为 null（工作台允许不打开文件夹也能用 AI 侧边栏），方案全文未定义此时 agent 行为——需求 7 只覆盖"打开的任意项目目录"，没说不打开项目时怎么办。
- 建议：字段名改为 `workspacePath`；补边界策略：`workspacePath === null` 时 composer 禁用 + 提示"先打开工作目录"，或 fallback 到一个安全的默认 cwd（如用户主目录）并在 header 明示当前工作目录。

**P1-2 ｜ Model Picker 注入位置与代码结构不符**
- 定位：方案 §3.1"在 `WorkbenchAiSidebar` 的下拉数据源处，向 `availableModels` 前面插入一个伪条目"
- 问题：下拉的**数据源与渲染都在 `WebviewCard.tsx` 内部**（`availableModels` 计算于 `WebviewCard.tsx:290`，下拉是 `CustomDropdown`）。`WorkbenchAiSidebar` 里的 `const availableModels = models` 只用于 `currentModel` 的 find 和挂载循环，**不是**下拉数据源。伪条目若只插进 sidebar 的 `availableModels`，`WebviewCard` 内部下拉不会出现"本地 Agent"项；若把伪模型塞进 `appStore.models`，又会污染全局（主界面多 AI/任务分配/辩论全都会看到它）。
- 另外：方案说"按 `currentModel.id === 'local-agent'` 分叉渲染"可行（`currentModel` find 于 sidebar 的 `availableModels`，插伪条目后能命中），但分叉点必须在 `availableModels.map(...)` 挂载循环**之外**——否则循环会给 'local-agent' 也渲染一个 `WebviewCard`（拿不存在的 `model.url`）。方案没写清分叉点在循环外还是循环内。
- 建议：改为明确的两层方案——(a) `WebviewCard` 增加可选 `extraModelOptions?: DropdownOption[]` prop（或 `modelOptionsOverride`），由 `WorkbenchAiSidebar` 在 `captureContext==='workbench'` 时注入"本地 Agent"项；(b) sidebar 渲染改为 `{currentModel.id === 'local-agent' ? <AgentCard/> : availableModels.map(→WebviewCard)}`；`handleModelChange('local-agent')` 时**不要**把它加进 `mountedSidebarModels`（那是 webview 挂载集合）。

**P1-3 ｜ 会话恢复语义含糊：inMemory 与"恢复历史会话"自相矛盾**
- 定位：方案 §3.7 + §4 `agentResumeSession`
- 问题：选 `SessionManager.inMemory()` 意味着进程重启/刷新后 Pi 会话内存态消失。`agentResumeSession` 要"恢复历史会话到内存"，但方案没说恢复后是**可继续对话**（需要把历史消息重新喂给模型，tool-call 结构会降级为文本）还是**只读回放**。Pi 自带 `SessionManager` 持久化变体（`~/.pi` JSONL）被显式排除，等于放弃了现成的续聊能力。
- 建议：二选一并写清——(a) 接受降级：恢复 = 重建 `messages` 喂 context，注明"工具调用细节在续聊中退化为文本摘要"；(b) 用 Pi 的文件 SessionManager 指定存到 `history/agent-sessions/` 而非默认 `~/.pi`，恢复与续聊都免费获得。推荐 (b)，成本更低且语义正确。

**P1-4 ｜ 拖拽工作台文件到 Agent 的交互断裂**
- 定位：方案 §3.2 AgentCard
- 问题：现有侧边栏支持把工作台文件树节点拖进面板上传给 AI（`WORKBENCH_UPLOAD_NODES_EVENT` / `handleDrop` / `uploadFilesToCurrentModel`，整套管线绑在 webview `ref.uploadFile` 上）。AgentCard 不是 webview，这套管线对它失效。方案只覆盖了 composer 的 `+` 附件按钮，没提文件树拖拽/右键"发送到 AI"这两个既有入口在 local-agent 下的行为。
- 后果：用户把文件树文件拖进侧边栏或右键发送时，若当前选中 local-agent，现有代码会走 `uploadFilesToCurrentModel` → `ensureSidebarLive('local-agent')` → 拿不到 webview ref → toast 报错。
- 建议：方案补一条适配——`uploadFilesToCurrentModel`/`handleSendFile`/`handleSendImage`/`handleUploadNodes` 四个入口在 `currentModel.id==='local-agent'` 时改走 agent 附件通道（文件路径直接作为 `@path` 或 attachment 传给 `agentPrompt`，比 webview 上传还简单）。

### P2（细节偏差/风险，建议修正但不阻断）

**P2-1 ｜ IPC 方法名与现有契约不符**
- 定位：方案 §3.2"调 `window.api.showOpenDialog`"
- 问题：preload 中没有 `showOpenDialog`，现有的是 `window.api.selectFile(): Promise<string | null>`（单选，`ipcHandlers.ts:498` 的 `select-file`）。附件需要多选时还得扩该 handler 或新增 `select-files`。
- 建议：改为"`window.api.selectFile`（或扩展为多选 `selectFiles`）"。

**P2-2 ｜ IPC 契约"四处同步"表述不精确**
- 定位：方案 §4"四处同步：`index.ts` + `index.d.ts` + `ipcHandlers.ts` + `env.d.ts`"
- 问题：`index.d.ts` 与 `env.d.ts` 都是 `declare global { api: API }` 从 preload `API` 类型自动派生，不维护重复接口（AGENTS.md 已声明）。实际要同步的是 `preload/index.ts`（方法）+ `ipcHandlers.ts`（handler）+ 渲染层调用点，两个 d.ts 零改动。
- 建议：改为"`preload/index.ts` 加方法 + `ipcHandlers.ts` 加 handler，类型自动派生"。

**P2-3 ｜ `agentResolveApproval` 的 requestId 需不可猜测**
- 定位：方案 §4 `agentResolveApproval(requestId, decision)`
- 问题：renderer 任何代码都能调该 IPC。若 requestId 是自增序号或可预测值，恶意/故障脚本可枚举 requestId 伪造"允许"，绕过审批。方案没写生成要求。
- 建议：补一句"requestId 由主进程 `crypto.randomUUID()` 生成，renderer 只能从 `agent:approval-request` 事件获得"。

**P2-4 ｜ Pi 包 scope 与调研报告不一致，需以 npm 实测定版**
- 定位：方案 §五 vs `pi-agent-ecosystem-research.md:5`
- 问题：调研报告写 `@mariozechner/pi-coding-agent`，方案写 `@earendil-works/pi-coding-agent` 并称 `@mariozechner/*` 为"旧 scope 已弃"。两份文档相互矛盾。
- 建议：实施前跑 `npm view pi-coding-agent` / `npm view @earendil-works/pi-coding-agent` 确认当前 canonical 包名与最新版本；把调研报告的 scope 一并修正（或在方案中注明"调研报告写作时的旧 scope"）。

**P2-5 ｜ 内置 skill `multichat-cli` 注入本地 agent 的语义未澄清**
- 定位：方案 §3.5"复用现有 `.agents/skills/multichat-cli` 打包链路，运行时从 `resources/skill/` 挂到 loader"
- 问题：`multichat-cli` 这个 skill 的内容是"教别的 agent 调 MultiChat CLI 向 webview 平台发消息"。把它注入本项目自己的本地 agent 等于让本地 agent 学会驱动 ChatGPT/Gemini 等网页平台——这可能是刻意设计（本地 agent 编排远端平台），也可能不是。方案没说明意图。
- 建议：明确一句：若有意让本地 agent 编排 webview 平台，保留并写进需求；若只是顺手复用打包链路，则内置 skill 目录应与 multichat-cli 分离（如 `resources/agent-skills/`）。

**P2-6 ｜ 双事件通道可合并（微优化）**
- 定位：方案 §4 `agent:event` + `agent:approval-request`
- 问题：两条 m→r 通道可合并为一条 `{type: 'event'|'approval', ...}`，少一个监听注册点。
- 建议：可选，不构成缺陷；保持现状也可接受。

**P2-7 ｜ 方案自述"已验证 API"未全部在调研中验证**
- 定位：方案全文引用的 `createAgentSession()`、`SessionManager.inMemory()`、`getAgentsFiles()`、`skillsOverride`、`agentsFilesOverride`、`FileUploadData`
- 问题：`DefaultResourceLoader`/`skillsOverride`/`agentsFilesOverride`/`getAgentsFiles` 在调研报告中有出处；`createAgentSession`/`SessionManager.inMemory()`/`FileUploadData` 未在调研中出现，属于基于 Pi README 的推断。
- 建议：M1 前先写 20 行 PoC 脚本验证这几个 API 的存在性与签名（`node -e "import('@earendil-works/pi-coding-agent').then(m=>console.log(Object.keys(m)))"`），方案中标注"API 名以 1.6 实测为准"。

**P2-8 ｜ 原型"历史"是菜单形式，方案实现成本被低估**
- 定位：方案 §3.2"`历史`：下拉列出主进程 HistoryManager 里 agent 会话"
- 问题：原型中"历史"是一个有标题分组（"对话历史"小标题）+ 条目的菜单，且现有 `WebviewCard` header 只有下拉 + 自定义 `headerActions` 一个槽位——方案要在 AgentCard header 里新做"新会话按钮 + 历史菜单 + 折叠按钮"三件套，其中历史菜单需要列表数据加载态/空态/条目删除，不是一句话的事。
- 建议：实施时注意历史菜单的完整状态设计；工作量评估上把 header 三件套从"复用"降级为"新做"。

---

## 需求覆盖核对表

| # | 原始需求 | 方案覆盖 | 核对结论 |
|---|---|---|---|
| 1 | 右侧 AI 侧边栏引入本地 Agent（基于 Pi），与 webview 平台并列 | §2 架构图、§3.2 `AgentCard` 与 `WebviewCard` 并列 | 覆盖，方向正确 |
| 2 | 复用 WebView 卡片 UI 外壳；Model Picker 加"本地 Agent"且仅工作台模式出现 | §3.1 伪条目 + `captureContext==='workbench'` 注入 | 覆盖但有代码事实偏差（P1-2：注入位置写错，需改为 `WebviewCard` 加 options prop） |
| 3 | 原型所有按钮接功能 | §3.2 header 三件套、§3.3 消息流/工具卡片、§3.2 Composer（附件/权限/子agent指示/发送停止） | 全部映射；P2-8 提示历史菜单成本被低估 |
| 4 | 支持 AGENTS.md 自动加载 | §3.5 `DefaultResourceLoader` 向上递归 + 全局层 + CLAUDE.md fallback | 覆盖，与调研一致 |
| 5 | 识别仓库级和全局级 skills | §3.5 `.agents/skills` + `.claude/skills` + `~/.pi/agent/skills` | 覆盖，与调研一致（P2-5 注意内置 skill 语义） |
| 6 | 三档权限：完全访问/受限(高危确认)/只读 | §3.4 PermissionEngine 白/灰/黑 + hard-deny + 审批卡片 + allowlist | 覆盖且设计完整（P2-3 requestId 需随机） |
| 7 | Agent 工作在用户打开的任意项目目录 | §3.5 cwd=用户项目根目录 | 字段名错误（`activeProjectRoot`→`workspacePath`）且未处理未打开项目的 null 边界（P1-1） |

**需求覆盖总结**：7 条全部有对应设计，无遗漏、无理解偏差；但 #2 和 #7 的实现描述与代码事实有偏差（见 P1-1/P1-2），#3 的历史菜单成本被低估（P2-8）。

---

## 审查维度汇总

- **a) 需求覆盖**：7/7 全覆盖，无漏项；2 条实现描述有代码事实偏差。
- **b) 代码事实核对**：`slotIndex=99`/`mountedSidebarModels`/`sidebarModelId`/`closeRightPane`/`workspacePath`/`persist:shared`/`cliIntegration`/`extraResources` skill 链路/`select-file` IPC 均验证存在；发现 `activeProjectRoot`（不存在）、`HistoryItem` 结构（虚构）、`showOpenDialog`（不存在）、下拉数据源归属（错误）4 处偏差。
- **c) 技术决策合理性**：选型与拆分粒度合理，无过度设计；assistant-ui 有调研支撑（自建流式渲染的坑确实多）；PermissionEngine/ResourceLoader/ShellTool/EventBridge 分层与项目 `services/` 惯例一致。唯一偏重的依赖是 `react-diff-view`——调研报告给了备选（`diff` + 自绘十几行），可接受。
- **d) 调研一致性**：与两份调研报告结论一致，无断章取义；唯一矛盾是 Pi 包 scope（方案 vs 调研报告不一致，见 P2-4，方案更可能正确）。
- **e) 风险遗漏**：发现 3 个方案未覆盖的风险——API key 供给（P0-2）、未打开项目时 cwd 为 null（P1-1）、`agentResolveApproval` requestId 可预测（P2-3）。方案已覆盖的 ESM/CJS、persist:shared 隔离、审批失效、长输出截尾、PowerShell/CMD 双套、审计日志、WASM asarUnpack 等风险识别到位。

---

## 审查过程说明

核对方式：`rg` 检索 + 通读 `WorkbenchAiSidebar.tsx`（1308 行全文）、`workbenchStore.ts` 关键段、`WebviewCard.tsx` 下拉段、`historyManager.ts`/`history.ts`、`electron-builder.yml`/`electron-builder-portable.yml`、`cliIntegration.ts`、`preload/index.ts`/`index.d.ts`/`env.d.ts`、原型 HTML 全文、两份调研报告全文。未修改任何被审查文件。
