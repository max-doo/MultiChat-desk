# 任务分配模式总结逻辑优化 — 设计

> Created: 2026-07-05 20:45 (local)

## 背景

任务分配模式（`productMode === 'task_assignment'`）下"生成总结"按钮存在两个体验问题：

1. **未置灰**：从未发送任何任务时按钮仍可点击，点击后进入爬取流程，抓到 0 个有效回复才报错，体验差。辩论模式已有 `debateState.phase !== 'finished'` 的置灰判定，任务分配模式缺少对称逻辑。
2. **预设提示词不对**：从任务分配模式进入总结页时，`MainPage.handleGenerateReport` 在非辩论分支不传 `presetSummaryMode`，导致 `useSummaryPanel` 用默认值 `'1'`（综合最佳）。任务分配语义是"多子任务结果合成可交付成品"，对应预设应为 `'4'`（成稿汇总）。

## 目标

- 任务分配模式下，未发送任何任务时"生成总结"按钮显灰禁用；发送过任务后点亮。
- 从任务分配模式进入总结页时，模板下拉默认选中「成稿汇总」(id='4')。
- 不影响多 AI 模式与辩论模式现有行为。

## 判定信号

按钮置灰信号（用户已确认采用"当前对话+模式匹配"）：

```ts
const taskHasSent = !!currentConversationId
  && history.find(h => h.id === currentConversationId)?.productMode === 'task_assignment'
```

理由：`currentConversationId` 是跨模式共享锚点（multi_ai / task_assignment / debate 共用），单看它非空会因 multi_ai 会话残留而误点亮。叠加 `productMode === 'task_assignment'` 校验后，仅当当前对话确实由任务分配模式发起才点亮。`HistoryItem.productMode` 在 `beginConversation` 写入时已可靠落字段（`appStore.ts:1153`）。

## 改动

### 1. `src/renderer/src/components/ControlBar.tsx`

"生成总结"按钮（约 843-863 行）：

- 新增从 store 读取 `currentConversationId`、`history`、`productMode`（部分已读）。
- 计算 `taskHasSent`（见上）。
- `disabled` 在现有 `productMode === 'debate' && debateState.phase !== 'finished'` 基础上，追加 `|| (productMode === 'task_assignment' && !taskHasSent)`。
- 置灰样式沿用辩论分支：`bg-gray-200 text-gray-400 cursor-not-allowed`。
- `onClick` 增加同条件 early-return 防御（与 disabled 一致，防止事件竞态）。

### 2. `src/renderer/src/pages/MainPage.tsx`

`handleGenerateReport` 非辩论分支构造 `pendingSummarySession` 处（约 332-338 行），追加：

```ts
presetSummaryMode: productMode === 'task_assignment' ? '4' : undefined,
```

- `'4'` = 「成稿汇总」（`appStore.ts:581-587`，描述"任务拆解后多子任务结果合成可交付成品"）。
- 与辩论分支 `presetSummaryMode: '3'`（`MainPage.tsx:258`）对称。
- 多 AI 模式保持 `undefined`，沿用默认 `'1'`，不改动其行为。

## 数据流

`MainPage.handleGenerateReport` → `setPendingSummarySession({ ..., presetSummaryMode: '4' })` → `SummaryPage` 读取 `session.presetSummaryMode` → `setPresetSummaryMode('4')` → 透传 `SummaryPanel` → `useSummaryPanel` 初始化 `useState(() => presetSummaryMode ?? '1')` → 选中「成稿汇总」。

## 非目标

- 不改 multi_ai 模式按钮置灰行为（保持现状，始终可点）。
- 不改 IPC、总结链路、`requestBodyConfig`。
- 不改 `defaultSummaryPrompts` 内容或 id。

## 验证

- `npm run lint` → `npm run build` → `npm run dev`
- 任务分配模式：未发送任务时按钮显灰不可点；发送一次任务后按钮点亮可点。
- 从任务分配进入总结页：模板下拉默认选中「成稿汇总」。
- 多 AI 模式进入总结页：模板仍为「综合最佳」（回归）。
- 辩论模式按钮置灰/点亮逻辑不受影响（回归）。
