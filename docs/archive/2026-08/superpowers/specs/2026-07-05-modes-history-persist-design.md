> Created: 2026-07-05 15:34 (UTC+08:00)

# 任务分配模式与辩论模式历史记录持久化 — 设计书

## 1. 背景与问题

MultiChat Desk 的历史记录（`HistoryItem`）当前**唯一写入入口**是 `appStore.ts` 的 `sendMessageToAll`（约 1063 行起）。该方法在发送后完成三件事：

1. 采集各平台 URL，用 `shouldStartNewConversation` 判定新/旧对话；
2. 新对话则 `addHistory(newItem)`（含 `productMode`、`displayMode`、`urls`），旧对话则 `updateHistory`；
3. 创建 `turnId` 并调 `startMonitoring` 启动轮询，把各平台回复抓进 `ConversationTurn.responses`。

任务分配模式与辩论模式**都不走 `sendMessageToAll`**，因而绕过上述全部链路：

| 模式 | 发送路径 | 写历史 | 启动监控 |
|---|---|---|---|
| 普通/多AI | `sendMessageToAll` → webview | ✅ | ✅ |
| 任务分配 | `TaskModePanel.handleSend` → `webviewRefs.get(slot-N).sendMessage(combined)`（`TaskModePanel.tsx:68`） | ❌ | ❌ |
| 辩论 | `useDebateRunner` → `store.sendToSlot` → `webview.sendMessage`（`appStore.ts:1179`，`useDebateRunner.ts:54`） | ❌ | ❌ |

辅助证据：`useTaskSplit.ts` 与 `useDebateRunner.ts` 全文均无 `addHistory` / `updateHistory` / `startMonitoring` / `currentConversationId` 调用。辩论发言只进 `debateState`（纯内存），任务拆解只进 `taskState.subtasks`（纯内存），关窗/刷新即丢。

**结论**：这是一个功能缺口，两种模式从设计上就没接入持久化链路。

## 2. 目标

让任务分配模式与辩论模式的对话进入统一历史（`HistoryDrawer`），与普通模式同列展示、可恢复。具体：

- **任务分配模式**：发送子任务后写入历史，含用户输入与各 slot 的 AI 回复（接入 `startMonitoring`）。
- **辩论模式**：辩论结束时把辩题、各轮正/反方发言、两 slot 最终 URL 写入历史；恢复时重填辩论面板并加载两 slot URL。

## 3. 非目标

- 不改造普通模式 `sendMessageToAll` 的外部行为（仅内部抽取，行为保持等价）。
- 不支持"暂停中的辩论"恢复 webview 到中间某轮的页面状态（与普通模式"中途恢复"同周期，超出本次范围）。
- 不改动总结历史（`SummaryHistoryItem`）的存储与恢复路径。
- 不改动 `persist:shared` Session / Cookie 层。

## 4. 关键决策（已与用户确认）

1. **两种模式都修**。
2. **辩论落库结构**：在 `HistoryItem` 上**新增 `debateTurns?: DebateTurnRecord[]` 字段**，不复用 `turns`（`ConversationTurn.responses` 是 `Record<modelId, 单条>`，辩论一轮里同一 model 可能作为正反方各发言一次，会 Key 冲突）。
3. **辩论 URL 存储**：按 **slotIndex** 存最终 URL（新增 `slotUrls?: Record<number, string>` 或在 `debateTurns` 内携带），避开同 modelId 冲突；辩论**不走 `startMonitoring`**，回复由 `useDebateRunner` 现有 `getResponseFromSlot` 主动拉取后写入 `debateTurns`。
4. **辩论恢复目标**：恢复辩论面板（辩题/轮次/发言）+ 加载两 slot 最终 URL；不保证暂停中可恢复。
5. **任务分配恢复目标**：存用户输入 + AI 回复（接入监控），与普通模式体验一致。

## 5. 总体方案：共享历史原语 + 模式特化字段（方案 B）

把 `sendMessageToAll` 里"判定新/旧对话 → 写历史 → 采集 URL → 启动监控"这段抽成 store 内的**原子方法**，让三条发送路径共用。模式差异通过 `HistoryItem` 上的可选特化字段承载。

### 5.1 新增/修改的类型（`src/renderer/src/store/appStore.ts` / `types/summary.ts`）

```ts
// appStore.ts — HistoryItem 扩展两个可选字段
export interface HistoryItem {
  id: string
  createdAt: number
  updatedAt: number
  models: string[]
  title?: string
  turns: ConversationTurn[]
  urls?: Record<string, string>          // 普通/任务分配：modelId -> URL
  productMode?: ProductMode
  displayMode?: DisplayMode
  // —— 新增 ——
  debateTurns?: DebateTurnRecord[]       // 仅辩论模式
  slotUrls?: Record<number, string>      // 仅辩论模式：slotIndex -> 最终 URL
}

// 辩论一轮的落库结构（与运行态 DebateRound 区分：落库带 modelId 与时间戳）
export interface DebateTurnRecord {
  round: number          // 第几轮（0-based）
  proponent?: { modelId: string; speech: string; timestamp: number }
  opponent?:  { modelId: string; speech: string; timestamp: number }
}
```

> 放置位置：`DebateTurnRecord` 与 `DebateState`/`DebateRound` 同区（`appStore.ts:202` 附近），就近维护。`HistoryItem` 已在 `appStore.ts:116`，就近扩展。

### 5.2 新增 store 原语（`appStore.ts`）

从 `sendMessageToAll` 抽取，行为保持等价。签名（最终以实现为准）：

```ts
// 判定新/旧对话并写入历史头部；返回 conversationId 与是否新对话
beginConversation: (input: {
  successModelIds: string[]
  currentUrls: Record<string, string>     // modelId -> URL（普通/任务分配）
  productMode: ProductMode
  displayMode: DisplayMode
}) => Promise<{ conversationId: string; isNew: boolean; lastItem: HistoryItem | null }>
// 注意：turnId 由调用方自行生成（`${conversationId}-${crypto.randomUUID()}`），
// beginConversation 只负责会话生命周期，不生成 turnId。

// 启动一轮监控（复用现有 startMonitoring 的内部逻辑，仅做薄封装/直接复用）
// 任务分配用；辩论不用
// startMonitoring 已存在，无需新增，直接调用即可。

// 辩论专用：落库一轮发言（upsert by round）
appendDebateTurnToHistory: (conversationId: string, record: DebateTurnRecord) => void

// 辩论专用：结束时写 slotUrls + 标记 updatedAt
finalizeDebateHistory: (conversationId: string, slotUrls: Record<number, string>) => void
```

**`beginConversation` 内部逻辑**（等价抽取自 `sendMessageToAll:1107-1145`）：

1. 取 `currentConversationId` → `history.find(h => h.id === ...)` 得 `lastItem`（沿用现有"按锚点查找，不依赖 history[0]"的约束）；
2. `shouldStartNewConversation(currentUrls, lastItem?.urls, isNewSession)`；
3. 新对话：`conversationId = crypto.randomUUID()`，`addHistory({ ...newItem, productMode, displayMode, turns: [] })`，`setNewSession(false)`，`set({ currentConversationId })`；
4. 旧对话：`conversationId = lastItem.id`，`updateHistory(conversationId, { urls: merged, updatedAt: now })`，`set({ currentConversationId })`；
5. 返回 `{ conversationId, isNew, lastItem }`。

> 抽取后 `sendMessageToAll` 改为调用 `beginConversation`，**外部行为不变**。这是本次改动中唯一触碰现有普通模式路径的点，需在 dev 中回归普通模式发送/续写/恢复。

### 5.3 任务分配模式数据流

`TaskModePanel.handleSend`（`TaskModePanel.tsx:52`）改造：

1. 现有按 slot 分组、`ref.sendMessage(combined)` 逻辑保留；
2. 收集 `successSlotIndices`（发送成功的 slot）；
3. 采集各 slot 当前 webview URL → 构造 `currentUrls: Record<modelId, string>`（任务分配 slot 与 modelId 一一对应，可用 modelId 作 key）；
4. 调 `beginConversation({ successModelIds, currentUrls, productMode: 'task_assignment', displayMode })` 得 `conversationId`；
5. 构造 `turnId = ${conversationId}-${crypto.randomUUID()}`，`userMessage` = 各 slot 发送的 `combined` 文本拼接（或"向 N 个槽位派发子任务"摘要），`models` = successModelIds；
6. 调 `startMonitoring(conversationId, turnId, userMessage, models)` —— 复用现有轮询，把各 slot 回复抓进 `turns[0].responses`。

> 任务分配一个 slot 可能收多条子任务合并发送，`userMessage` 取发送的 `combined` 全文即可，监控按 modelId 轮询 `getLatestResponse` 与普通模式无差异。

### 5.4 辩论模式数据流

辩论的回复由 `useDebateRunner` 现有 `getResponseFromSlot` 主动拉取（带 baseline 比对，120s 超时），**不接 `startMonitoring`**（避免双轮询冲突）。落库在两个时机：

**A. 辩论开始时**（`useDebateRunner.start`，`useDebateRunner.ts:86`）：

1. 采集两 slot 当前 URL → `currentUrls`（此时可能仍是上一对话的 URL，仅用于 `beginConversation` 判定新/旧）；
2. 调 `beginConversation({ successModelIds: [slot0ModelId, slot1ModelId], currentUrls, productMode: 'debate', displayMode: 'two' })` 得 `conversationId`；
3. 把 `conversationId` 存到 `useDebateRunner` 的 ref，供后续发言 upsert 用。

**B. 每轮发言拉取成功后**（`useDebateRunner.ts:76` `appendDebateSpeech` 之后）：

1. 调 `appendDebateTurnToHistory(conversationId, { round, proponent?/opponent? })`，store 内按 `round` upsert（同一轮第二次调用补齐 opponent，不覆盖 proponent）。

**C. 辩论结束时**（`phase` 转 `finished`，即 `useDebateRunner` 的 `stop`/空回复/超时/跑完所有轮路径，`useDebateRunner.ts:58/72/83`）：

1. 采集两 slot 最终 URL → `slotUrls: Record<number, string>`（按 slotIndex，不用 modelId）；
2. 调 `finalizeDebateHistory(conversationId, slotUrls)`，写 `slotUrls` + `updatedAt`。

> 辩论 `currentUrls` 用 modelId 作 key 传给 `beginConversation` 仅为复用判定逻辑；最终落库的 URL 用 `slotUrls`（按 slotIndex），二者独立，不冲突。

### 5.5 恢复逻辑（`MainPage.tsx` `onSelectHistory`，约 861 行）

现有恢复逻辑按 `item.productMode` 分支处理。新增两分支：

**任务分配**（`productMode === 'task_assignment'`）：
- 走现有"恢复模型/槽位 + 加载 `item.urls`"路径，无需特殊处理——`urls` 已按 modelId 存，与普通模式同构。`turns` 里的回复照常在历史详情展示。

**辩论**（`productMode === 'debate'`）：
- 切 `productMode='debate'`、`displayMode='two'`；
- 按 `item.models` 恢复两 slot 的模型（复用现有 `setActiveModels` + 槽位调整逻辑，`debate` 模式槽位用 `debateSlots`）；
- `setTimeout` 后按 `item.slotUrls` 加载两 slot URL（`slot-0`/`slot-1`）；
- 调一个新的 store action `restoreDebateState({ topic, rounds, totalRounds })`，把 `debateTurns` 反序列化回 `debateState.rounds`（`DebateRound` 形态），`phase` 置 `finished`（只读浏览，不允许续推），`currentRound` 置末轮。

> `DebateTurnRecord → DebateRound` 映射丢弃 `modelId`/`timestamp`（运行态不需要），只取 `proponent`/`opponent` 文本。

### 5.6 HistoryDrawer 展示

`HistoryDrawer.tsx` 列表项当前按 `productMode`/`turns` 渲染摘要。辩论条目 `turns` 为空数组，需改用 `debateTurns`：取辩题作标题、轮数作副标题。改动局限在列表项渲染函数（约 `HistoryDrawer.tsx:308` 附近），不触碰选择/删除逻辑。

## 6. 边界与错误处理

- **辩论中途刷新/关窗**：`debateState` 在内存，刷新即丢；已写入的 `debateTurns` 已落盘，但辩论未 `finalize`，`slotUrls` 缺失。恢复此类半成品时：`debateTurns` 存在但 `slotUrls` 缺失 → 仍可只读浏览发言，不加载 URL，UI 提示"辩论未完成"。
- **任务分配发送部分失败**：`successModelIds` 只含成功 slot，`beginConversation` 按成功集合建会话；失败 slot 不进历史、不监控，与普通模式部分失败处理一致。
- **辩论同 model 双 slot**：`slotUrls` 按 slotIndex 存，不冲突；`debateTurns` 里 `proponent`/`opponent` 各带 `modelId`，即使两方同模型也能区分。
- **`beginConversation` 抽取的回归风险**：唯一触碰普通模式路径的点。需在 dev 中验证：新对话发送、续写（同一对话再发）、恢复非首位历史后续写（`currentConversationId` 锚点路径）。
- **历史条目上限**：`addHistory` 现有 `slice(0, 100)`，辩论/任务分配条目同样受此限，行为一致。
- **持久化**：`addHistory`/`updateHistory` 内部已 `window.api.storeSet('history', ...)`，新字段随对象一起序列化，无需改 IPC。

## 7. 受影响文件

| 文件 | 改动 |
|---|---|
| `src/renderer/src/store/appStore.ts` | 抽取 `beginConversation`；新增 `appendDebateTurnToHistory` / `finalizeDebateHistory` / `restoreDebateState`；扩展 `HistoryItem` 与 `DebateTurnRecord` 类型；`sendMessageToAll` 改调 `beginConversation` |
| `src/renderer/src/components/modes/TaskModePanel.tsx` | `handleSend` 接入 `beginConversation` + `startMonitoring` |
| `src/renderer/src/hooks/useDebateRunner.ts` | `start`/发言后/结束时分别调 `beginConversation` / `appendDebateTurnToHistory` / `finalizeDebateHistory` |
| `src/renderer/src/pages/MainPage.tsx` | `onSelectHistory` 新增 `task_assignment`（无特殊）/`debate`（恢复面板 + slotUrls）分支 |
| `src/renderer/src/components/HistoryDrawer.tsx` | 辩论条目用 `debateTurns` 渲染摘要 |

> 不涉及 `src/main/` 与 `src/preload/`：历史持久化走现有 `window.api.storeSet`/`storeGet`，IPC 契约不变。

## 8. 验证

项目无自动化测试，按 `AGENTS.md` 流程：`npm run lint` → `npm run build` → `npm run dev` 手动验证。

dev 最小验证清单：
1. **普通模式回归**（防 `beginConversation` 抽取破坏）：新对话发送 → 续写 → 恢复非首位历史后续写，确认不串台。
2. **任务分配**：拆解 → 派发 → 历史出现条目 → 点开恢复 → 各 slot 回复可见。
3. **辩论**：选同模型双 slot → 跑完 → 历史出现条目（辩题为标题）→ 点开恢复 → 面板重填发言 + 两 slot 加载 URL。
4. **辩论半成品**：跑到一半关窗 → 重开 → 历史条目存在 → 点开能只读浏览已发言轮次。
5. **任务分配部分失败**：断开一个 slot 的 webview → 派发 → 历史只记成功 slot。

## 9. 风险评估

- **中风险**：`beginConversation` 抽取改变 `sendMessageToAll` 内部结构。缓解：行为等价抽取，lint+build+dev 回归覆盖第 1 项。
- **低风险**：`HistoryItem` 新增可选字段，旧历史无该字段，渲染处用 `?.` 兜底，向后兼容。
- **低风险**：辩论 `debateState` 恢复只填 `rounds`，不碰 `currentTurn`/`currentRound` 的运行时语义（置 `finished` 后这些字段不再驱动流程）。
