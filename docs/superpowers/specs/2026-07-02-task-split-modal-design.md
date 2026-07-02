> Created: 2026-07-02 09:16 (+08:00)

# 任务分发拆解弹窗（TaskSplitModal）设计

## 背景与问题

task_assignment 模式的"拆解"按钮在失败时**完全静默**，用户表现为"点了没反应"：

- `TaskModePanel.tsx` 从 `useTaskSplit()` 只解构 `{ split, isLoading }`，丢弃 `error`，失败时不弹任何提示。
- `useTaskSplit.split()` 失败路径只 `setError(...)`，不抛出、无返回值，调用方无法感知。
- 失败场景：未配置总结供应商（`resolveProvider()` 返回 null，全新环境必现）、API Key 无效/网络错、模型未返回有效 JSON。

happy path（拆解成功 → inline 子任务列表 → 一键发送）链路本身完整，不应破坏。

## 目标

- 失败时弹 `TaskSplitModal`：显示进度+错误、可在弹窗内选拆解供应商+模型并**写回 `apiConfig` 持久化**、可编辑槽位→webview AI 绑定并**写回 `taskAssignmentSlots`**、可重试拆解。
- 成功后关弹窗，回到 inline 子任务列表与一键发送（happy path 不变）。

## 架构与分层

- 全部在 renderer 层。不碰 main / preload / IPC 契约。复用现有 `split-task` IPC、`taskSplitApi`、`useTaskSplit`。
- 新增 `src/renderer/src/components/modes/TaskSplitModal.tsx`（职责单一的恢复面）。
- 改 `src/renderer/src/hooks/useTaskSplit.ts`（`split` 返回结构化结果 + 新增 `persistProvider`）。
- 改 `src/renderer/src/components/modes/TaskModePanel.tsx`（触发逻辑 + 挂载弹窗 + 本地 open/error state）。
- 弹窗 open/error 用 `TaskModePanel` 本地 `useState`；选中供应商/模型/槽位写回走 `appStore` 现有 setter（持久化）。

## 组件：TaskSplitModal

### Props

```ts
interface TaskSplitModalProps {
  open: boolean
  initialError: string | null
  onClose: () => void
  showNotification: (type: 'success' | 'error' | 'info', msg: string, autoHide?: number) => void
}
```

### 内部结构

1. 头部：标题"任务拆解" + 关闭按钮。
2. 错误/进度区：loading 时 spinner+"拆解中…"；`error` 非空时红色错误文案。
3. 拆解模型区：供应商下拉（`apiConfig.providers` 仅 `enabled`）+ 模型下拉（该供应商下 `summaryModels`，按 `providerId` 过滤）。复用 `SummaryPanel` 中 `selectedProviderId`/`selectedAgent` 的取数与联动**模式**（不直接 import 组件，避免耦合）。下方"管理供应商"入口打开 `SettingsDrawer`。
4. 槽位分配区：`taskAssignmentSlots.map((slotModelId, i) => 一行)`——"槽位 {i}" + 下拉（候选 = `models`，value=`slotModelId`，onChange 调 `setTaskAssignmentSlot(i, newId)`）。
5. 底部：取消 + "拆解"按钮（disabled = 无供应商 / 无模型 / loading 中）。

### 交互流

- 打开时若 `apiConfig` 无可用 provider：供应商下拉为空并提示"未配置，请点管理供应商或新增"，"拆解"禁用。
- 用户选好供应商+模型后点"拆解"：先 `persistProvider(providerId, agentId)` 写回 `apiConfig`，再调 `split(query)`；loading 在弹窗内显示；成功 `onClose()` 回到 inline 子任务列表；失败则 `error` 显示在弹窗内，不关弹窗，可改选模型再重试。
- 槽位编辑即时写回 `taskAssignmentSlots`（复用 `setTaskAssignmentSlot`），与 WebviewCard 槽位切换一致；弹窗关闭后 inline 流程使用最新槽位。
- 弹窗 loading 中关窗：触发 `abort()`，避免悬挂请求。

## useTaskSplit 改造

- `split` 返回值由 `void` 改为 `{ ok: boolean; error?: string }`：成功 `{ok:true}`，失败 `{ok:false, error}`。内部仍维护 `isLoading`/`error` 供弹窗即时显示。
- 新增 `persistProvider(providerId: string, agentId: string): void`：写回 `apiConfig.activeProviderId` + `lastSelectedAgentId` 并 `storeSet('apiConfig', ...)`（复用 `appStore` 现有写回方式）。
- `resolveProvider` 逻辑不变；弹窗选完模型写回后 `resolveProvider` 即可取到。
- 复用既有 `abort` 与 `abortRef`。

## TaskModePanel 改造

- `handleSplit`：
  ```ts
  const r = await split(taskState.query)
  if (!r.ok) { setModalError(r.error ?? '拆解失败'); setModalOpen(true) }
  ```
- 渲染末尾挂载 `{modalOpen && <TaskSplitModal open initialError={modalError} onClose={...} showNotification={...} />}`。
- 其余（inline 子任务列表、`handleSend`、`handleNewRound`、`handleCancel`）不变。

## 数据流

```
点拆解 → handleSplit → split() → split-task IPC → taskSplitApi
  ├─ ok=true  → phase='split'，inline 子任务列表（不变）
  └─ ok=false → 打开 TaskSplitModal(initialError)
                 ├─ 选供应商/模型 → persistProvider 写回 apiConfig
                 ├─ 可编辑槽位 → setTaskAssignmentSlot 写回
                 └─ 点拆解 → split() 重试 → ok=true 关弹窗 / ok=false 留弹窗
```

## 错误处理

- 未配置供应商：弹窗内文案 + 下拉为空 + 拆解禁用 + 管理供应商入口。
- API Key 无效/网络错/非 JSON：`taskSplitApi` 已返回 `error` 文案，弹窗红字显示，可改模型重试。
- 弹窗 loading 中关窗：`abort()`。
- 写回配置失败（`storeSet` 不可用）：`console.warn` 不阻断（与现有 `storeSet` 调用一致）。

## 测试 / 验证（无自动化测试运行器）

- `npm run lint` + `npm run build`。
- `npm run dev` 手动验证：
  1. 未配置供应商 → 点拆解 → 弹窗提示+选拆解模型+拆解成功 → 弹窗关、inline 出现子任务列表。
  2. 已配置但 Key 错 → 点拆解 → 弹窗显示错误 → 改正确模型 → 重试成功。
  3. 弹窗内改槽位绑定 → 关弹窗 → 一键发送落到正确的 webview。
  4. happy path：已配置且 Key 正常 → 点拆解 → 不弹窗、inline 子任务列表出现、一键发送正常。

## 文件清单

- 新增：`src/renderer/src/components/modes/TaskSplitModal.tsx`
- 改：`src/renderer/src/hooks/useTaskSplit.ts`（`split` 返回值 + `persistProvider`）
- 改：`src/renderer/src/components/modes/TaskModePanel.tsx`（触发逻辑 + 挂载弹窗 + 本地 open/error state）
- 不动：main / preload / IPC / `taskSplitApi` / `selectors` / `webviewScripts`

## 风险

- 弹窗内供应商/模型下拉需与 `SummaryPanel` 取数口径一致（`enabled` provider + `summaryModels.providerId` 过滤），复用同一判定避免漂移。
- `split` 返回值变更属内部 API 变更，仅 `TaskModePanel` 与新弹窗两个调用点，影响可控。
