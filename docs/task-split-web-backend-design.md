> Created: 2026-11-20 09:25 (+08:00)

# 任务拆解改走后台 Web AI —— 设计方案

## 1. 背景与目标

「任务分配」模式目前通过 `split-task` IPC 调用一个 OpenAI 兼容的 HTTP API（`src/main/api/taskSplitApi.ts`），是全项目唯一依赖「API 模式」的功能：设置里要维护供应商、Key、模型表（`apiConfig.providers` / `summaryModels`），拆解弹层里要选供应商与模型。目标是把拆解的**功能实现**改为参照思维导图的后台方式（SessionManager + AutomationService 驱动一个已登录的 Web AI 平台），从而彻底移除 API 模式。**交互在现有任务分配界面的基础上修改**，不引入导图侧边栏的形态。

非目标：思维导图、笔记、总结链路不变；`apiConfig` 类型保留，继续承担 `summaryPrompts` / `systemPrompt` / `lastWebviewSummaryPlatform`，只是删掉供应商相关字段。

## 2. 现状链路

- 渲染层：`useTaskSplit.split()`（`src/renderer/src/hooks/useTaskSplit.ts`）解析 `apiConfig.activeProviderId` + `summaryModels` 得 `apiKey/baseUrl/model`，调 `window.api.splitTask(...)`。
- 主进程：`ipcHandlers.ts` 的 `split-task` 持 `AbortController`，委托 `taskSplitApi.splitTask()` 发 `POST {baseUrl}/chat/completions`，请求体经 `requestBodyConfig.buildRequestBody` 适配供应商差异。
- 解析：`config/taskSplitPrompt.ts` 的 `buildTaskSplitSystemPrompt(windowCount)` 是完整中文系统提示词（恰好 N 个互不依赖的横向子任务、严格 JSON），`parseSubtasks()` 容忍代码块包裹提取 `[{text, suggestedModelId?}]`。**目标态改为 XML 标签**（见 3.3）。
- 交互：`TaskModePanel` 控制条（输入目标 → 「拆解」→ `TaskSplitModal` 上拉弹层选供应商+模型 → `SubtaskList` 上拉层 → `inserted` → `sent`）。首次拆解直接用已持久化供应商发起；失败或无配置时弹层出现，承载配置与错误。

## 3. 目标链路（功能实现参照思维导图）

### 3.1 主进程新服务 `TaskSplitService`（`src/main/services/TaskSplitService.ts`）

与 `MindmapService` 同构，但只做「单轮提问 → 收集一条回复 → 解析子任务」，不持久化文档：

- **状态机**：`TaskSplitTask { id, platform, goal, phase }`，`phase ∈ loading | generating | done | error | cancelled`；同一时刻只允许一个非终态任务。经 `tasksplit:task-changed` 事件广播；`ownerId` 记发起窗口用于 `show`/`cancel` 归属校验。done 时 `task.subtasks` 携带解析结果。
- **后台网页**：`sessionKey = '__tasksplit_<id>'`，`automationService.ensureSessionReady(platform, key, restore)`；终态隐藏网页沿用导图闲置保留策略（`idle`/`lastPage`/定时释放），让「查看拆解网页」可恢复同一窗口。
- **发送**：提示词与用户目标拼在同一条用户消息中（Web 平台没有 system 角色），经 `automationService.executeCommand(platform, prompt, key, { signal })` 发送。无附件上传。
- **采集**：直接复用 `generateMindmapResponseScript(selectors, 'markdown')`（把判定标签常量参数化为 `task_split`），1.5s 轮询。完成判定 = 下述三态解析达到 `ready` 且文本两轮稳定（stable >= 2）；`pending` 继续等，`invalid` 在 idle 稳定后才报错——避免流式中途半块被误当失败。总超时 90–120s。错误消息与导图同构：含阶段、原因，建议「查看拆解网页」。
- **取消/查看**：`cancel` 随时可取消（无 saving 阶段）；`show` 经 `showBackgroundPreview` 弹预览窗，登录失效/验证码由用户在网页内处理。

### 3.2 IPC 契约

```
tasksplit:start   (goal, platform, windowCount) -> { success, data?: TaskSplitTask }
tasksplit:task    () -> { success, data?: TaskSplitTask | null }
tasksplit:cancel  (id) -> { success, error? }
tasksplit:show    (id) -> { success, error? }
'tasksplit:task-changed' 事件 -> TaskSplitTask
```

`split-task`、`abort-split-task`、`fetch-models` 删除；`taskSplitApi.ts`、`requestBodyConfig.ts` 删除；`taskSplitPrompt.ts` 保留（唯一被复用的 API 侧资产）。preload `window.api` 同步替换，`index.d.ts`/`env.d.ts` 不变式成立。

### 3.3 输出格式：XML 标签（替代 JSON）

JSON 数组在 Web 回复里双重脆：`parseSubtasks` 取「首个 `[` 到末个 `]`」会被子任务文本本身的 `[]` 或前置解释撑坏，且 JSON 字符串内换行需 `\n`、模型常直接打真换行导致 `JSON.parse` 失败。改为与导图同构的标签格式：

```
<task_split>
<subtask>子任务1的完整描述，可多行</subtask>
<subtask>子任务2的完整描述</subtask>
</task_split>
```

- 提示词约定：整个回复只输出一个 `<task_split>` 块，块外无文字，不强求代码块包裹；子任务文本放 `<subtask>` 内、允许真换行；恰好 `windowCount` 个 `<subtask>`。提示词首部加一句「请按以下要求拆解我的目标，只输出 `<task_split>…</task_split>`」，示例含一个跨行子任务。
- 解析 `parseSubtasksXml(text)`，三态：`SUBTASK_TAGS = {begin:'<task_split>', end:'</task_split>'}`。先把 `&lt;(\/?task_split|subtask)&gt;` 实体还原（同导图 `&lt;mindmap&gt;` 处理），按行归一 `</?subtask>` 标签；`extractMindmapTaggedBlock` 定位唯一 `<task_split>` 块（缺 `</task_split>` → `pending`、多份块或错位 → `invalid`、`ready` 得块）；`ready` 后按 `<subtask>…</subtask>` 逐段切，`trim()` 非空即收；数量少于 `windowCount` 报错、多于截取。不用 CDATA/属性。
- `taskSplitPrompt.ts` 同步改：`buildTaskSplitSystemPrompt` 输出格式段落改 XML；`parseSubtasks` 改标签解析，返回 `{text, suggestedModelId?}[]`（`suggestedModelId` 无新来源则删字段）。

### 3.4 渲染层（在现有交互基础上修改）

交互骨架与现在完全一致：控制条 + 上拉弹层。改动点只是把「供应商+模型」换成「平台」，并给后台任务加「查看网页」：

- `useTaskSplit.split(goal, platform)`：仍用 `getDisplayedModels(...task_assignment)` 算 `slotCount` 作 `windowCount`，调 `tasksplit:start` 并记下返回 `task.id` 作 `pendingTaskId`；`isLoading` 由 `onTaskSplitChanged`/`tasksplit:task` 驱动（invoke 即刻返回，完成靠事件）。成功时沿用现逻辑写 `taskState.subtasks`（轮询 `slotIndex`/`modelId`）、`setTaskPhase('split')`。
- **归属校验**：结果到来时同时校验 `task.id === pendingTaskId` 且 `taskState.query === task.goal`：前者挡住「取消后输入相同目标、旧任务迟到 done 顶掉新进度」，后者挡住拆解中改动目标的错配。
- 平台选择进入**原 `TaskSplitModal` 弹层**：供应商/模型两个下拉替换为一个「拆解平台」下拉（logo + 名称，候选 = 已启用 `models`）；持久化到 `apiConfig.taskSplitPlatform`（与模板字段同键，无须新增 store 键），默认取第一个已启用平台。
- 弹层保留其原有职责：首次/失败时出现，承载平台选择、进度（「正在通过 {平台} 拆解…」）、错误文本、按钮「取消」「拆解/重试」，新增一行「查看拆解网页」链接调 `tasksplit:show`。
- 拆解进行中：控制条按钮仍是菊花（现行为）；弹层若开着显示进度行并可取消；未开则与现状一样任务在后台完成。
- **子任务可编辑**：`SubtaskList` 的 textarea 本就可编辑（`updateSubtask` 写回 store），保持不变。

### 3.5 设置抽屉与 store 清理

- 删除：「API 供应商（多 Key 管理）」、「任务分配可用模型…同步/配置」两卡片及全部供应商校验/编辑/删除/`fetchModels` 逻辑。
- 保留：`summaryPrompts`、`systemPrompt`（兜底模板）、`lastWebviewSummaryPlatform`。
- 删除字段/类型：`ApiConfig.providers`、`activeProviderId`、`lastSelectedAgentId`、`summaryModels`、`ApiProvider`、`SummaryModel`、`defaultSummaryModels`。
- **迁移**：`apiConfig` 读取时剥掉不存在字段；`electron-store` 中 `summaryModels` 键迁移时 `storeDelete`。`ImportCacheConfirmModal` 的 `apiConfig` REDACTED-Key 合并分支随 providers 删除而简化。
- `TaskSplitModal.tsx` 改为新弹层组件（同文件改名重写），`useTaskSplit` 中 provider 解析删除。

## 4. 交互方案（现状基础上的最小改动）

阶段 `idle → splitting → split → inserted → sent`；`splitting` 替代原 `isLoading`：

| 阶段 | 输入框 | 按钮区 | 上拉层 |
|---|---|---|---|
| idle | 可编辑目标 | 「拆解任务」 | 无（需配置/上次错误时弹层出现） |
| splitting | 只读目标 | 菊花 | 若弹层开着：进度行 + 取消；否则无 |
| split | 只读目标 | 「确认」+「取消」 | `SubtaskList` 可编辑文本框 + 槽位指派 |
| inserted | 只读 | 「确认发送」+「取消」 | `SubtaskList` |
| 错误 | 恢复可编辑 | 「拆解任务」 | 弹层：平台下拉 + 错误 +「查看拆解网页」+「重试」「取消」 |

要点：

- 点击「拆解」直接用持久化平台发起，**不强制先选**；只有无平台可用或出错才弹层——与现在「已配置则直接拆」的行为一致。
- 「查看拆解网页」是唯一的排障入口，替代现在「去设置配 Key」的引导。
- 可离开：任务属主进程，切页不丢；回本页经 `tasksplit:task` 恢复进度。
- `split` 阶段子任务文本框可直接编辑（`updateSubtask`），改完再点「确认」注入槽位。

原型：`docs/prototypes/task-split-web.html`，按现有控制条与弹层样式实现六个状态。

## 5. 风险与边界

- **回复含多份块/冗长解释**：`extractMindmapTaggedBlock` 对多份 `<task_split>` 判 invalid、前置解释文本不影响块提取；流式半块走 `pending`，稳定后仍坏才 invalid。
- **平台吞标签**：某些平台把 `<…>` 当未知 HTML 剥掉标签但保留文本——`textContent` 读取仍拿到内容，若标签丢失则 invalid +「查看网页」。
- **登录态**：后台网页未登录 → ready 超时 → error +「查看拆解网页」引导登录。
- **同平台并发**：目标槽位 webview 与拆解后台窗口共 `persist:shared`，会话互相独立；拆解平台同时是槽位平台也不占槽位。
- **迟到页面脚本**：沿用导图 `releaseLateWindow`，abort/终态后迟到的会话窗口即毁。
- **多窗口**：`ownerId` 限制 cancel/show；`taskState` 是窗口本地 store，非发起窗口天然不显示。

## 6. 影响清单（实现时）

- 新增：`src/main/services/TaskSplitService.ts`、`src/shared/utils/taskSplit.ts`（`buildTaskSplitPrompt` + `parseSubtasksXml`）、`src/shared/types/taskSplit.ts`、IPC `tasksplit:start/task/cancel/show` + `tasksplit:task-changed`、preload 5 项、`apiConfig.taskSplitPlatform` 字段。
- 修改：`useTaskSplit.ts`（模块级共享 pending/loading/onError，双实例不重复 applyDone）、`TaskModePanel.tsx`（直接用持久化平台发起）、`TaskSplitModal.tsx`（平台下拉+进度+查看网页）、`SettingsDrawer.tsx`（删供应商/模型卡片与两个编辑弹窗）、`appStore.ts`（删 `ApiProvider`/`SummaryModel`/`summaryModels`，apiConfig 迁移剥字段）、`ipcHandlers.ts`、`preload/index.ts`、`generateMindmapResponseScript`（第 4 参 `tagName` 参数化 + root textContent 候选兜底）。
- 删除：`src/main/api/taskSplitApi.ts`、`src/main/config/requestBodyConfig.ts`、`src/main/config/taskSplitPrompt.ts`（拆解提示词迁入 `src/shared/utils/taskSplit.ts`）、`fetch-models`/`split-task`/`abort-split-task` IPC、设置供应商/模型 UI、`useTaskSplit` provider 解析。
- 验证：`npm run lint` 0 errors（16 warnings 全存量）；`npm run build` 通过；定向 `tsc` 无新增错误（存量错误与本次无关）。
