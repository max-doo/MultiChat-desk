# 历史记录 / 总结链路错乱修复计划

> Created: 2026-07-05 01:16 (+08:00)
> Revised: 2026-07-05 — 补充 P0-1b（`activeHistoryId` 与 `currentConversationId` 双标识源同步）、P0-3 空值刷新说明、P1-1 sandbox 验证、回归脚本第 7 条
> Revised: 2026-07-05 — 补充症状 6（未对话点总结用上次快照），明确归属 P0-2 修复范围，加回归脚本第 8 条

## 一、背景与问题陈述

历史记录与总结对话存在严重的跨对话串台错乱，用户可观察到的症状包括：

1. **恢复历史对话后发新消息**：新 turn 写入到错误的 historyItem（常串到另一条对话）。
2. **从总结历史恢复后**：刚恢复的 `modelResponses` / 消息内容在数秒后被覆盖成另一条对话的内容。
3. **点击"生成报告"做总结**：`modelResponses` 混入另一条对话的末轮回复。
4. **debate 模式恢复历史**：URL 加载到错误的槽位。
5. **快速连续发送 / 多模型并行发送**：偶尔丢轮或两条对话 ID 撞车互相覆盖。
6. **未进行任何对话直接点"生成报告"**：总结页直接显示上一次会话的历史快照（`history[0]` 的末轮回复），而非空内容。根因仍是 A——`MainPage.tsx:289` 的 `?? history[0]` 兜底在 `activeHistoryId`/`currentConversationId` 为空时拉进 `history[0]`；"三层兜底"注释（285-287 行）假设的前提是"本次有对话但 webview 抓空"，未覆盖"本次根本没发对话"场景。归属 P0-2 修复范围（289 改 `?? null` + P0-1 保证未对话时 `currentConversationId` 为 `null`）。

### 根因总览

经过系统化调试（Phase 1 根因调查），错乱由三个贯穿性设计缺陷叠加造成：

| 根因 | 性质 | 影响面 |
|---|---|---|
| **A. 用数组下标 `history[0]` 当"当前对话"标识** | 数据/逻辑缺陷 | 恢复、发送、总结三条链路全部受影响 |
| **B. ID 全部用 `Date.now().toString()`，可碰撞** | 数据缺陷 | 同毫秒操作覆盖/丢轮 |
| **C. `webviewRefs` 跨模式共享 Map + 反注册不校验 ref** | 并发/竞态缺陷 | 模式切换后 webview 串扰 |

其中 **A 是主因**：项目没有持久化的"当前对话 ID"状态，`monitor.currentConversationId` 只在监控期间存在，监控一结束所有"当前对话"查询只能退回 `history[0]`，而 `history` 数组会因新增/删除/分页裁剪随时重排。

### 不在本计划范围（P2，留后续）

- `history.length` / `historyLoadedCount` / `historyTotalCount` 三计数语义不一致导致的分页错位
- `shouldStartNewConversation` 的 URL query string 未比较（会话 id 放 query 的平台误判新旧对话）
- 内存裁剪 100 上限导致监控中 historyItem 被裁掉、`saveCurrentTurn` early return 丢轮
- `enforceDiskLimit` 与内存裁剪边界不一致

---

## 二、修复目标与范围

**范围**：P0（根因串台）+ P1（ID 碰撞 + debate 槽位 + webview 反注册）。

**预期结果**：恢复对话/总结时不再跨对话串台；ID 不再碰撞；debate 模式恢复槽位正确；模式切换后 webview 不串扰。

**不做**：不迁移旧数据（新旧 ID 共存）；不改 IPC 契约；不引入新依赖（`crypto.randomUUID()` 为 Electron/Chromium 内置）。

---

## 三、当前代码事实（修复前的精确快照）

### 3.1 数据结构

- `HistoryItem`：`src/renderer/src/store/appStore.ts:116-126`，`id` 兼作 conversationId。
- `ConversationTurn`：`appStore.ts:108-113`，`turnId: string`。
- `SummaryHistoryItem`：`appStore.ts:129-159`，含 `messages[]`、`selectedModels`、`modelResponses`、`urls`。
- store state 中**无** `currentConversationId` 字段；`activeHistoryId` 是 `MainPage` 的 `useState`（`MainPage.tsx:19`），不是 store 字段，无法跨页面/跨 hook 访问。

### 3.2 `history[0]` 当"当前对话"的全部出现点

| 位置 | 代码 | 修复后 |
|---|---|---|
| `MainPage.tsx:289` | `history.find((h) => h.id === activeHistoryId) ?? history[0]` | `history.find(h => h.id === currentConversationId) ?? null` |
| `MainPage.tsx:364` | 同上 | 同上 |
| `useSummaryPanel.ts:124` | `urls: history[0]?.urls` | `urls: history.find(h => h.id === currentConversationId)?.urls` |
| `SummaryPage.tsx:188` | `const latestItem = history[0]` | `history.find(h => h.id === currentConversationId)` |
| `appStore.ts:1091` | `const lastItem = history.length > 0 ? history[0] : null`（`sendMessageToAll` 续写判定基准） | `history.find(h => h.id === state.currentConversationId) ?? null` |

> **补充（2026-07-05 12:23）**：`appStore.ts:1091` 是实施前复审发现的第 5 处 `history[0]` 出现点，原 §3.2 表遗漏。`lastItem` 同时用于 (a) `isNewConv` 判定、(b) 续写分支 `conversationId = lastItem!.id`、(c) `updateHistory(conversationId, ...)`。若不修，恢复非 `history[0]` 的历史对话后续写仍会串到 `history[0]`，回归脚本第 7 条会失败。归入 P0-1 一并修复。

### 3.2b `activeHistoryId` —— 与 `currentConversationId` 并行的另一标识源（P0-1b 的事实基础）

`activeHistoryId` 是 `MainPage` 组件局部 `useState`（`MainPage.tsx:19`），**不是 store 字段**，语义为"回溯历史快照锚点"，与计划新增的 `currentConversationId`（监控/发新消息锚点）属两套标识。两者在恢复历史时应指向同一对话，但当前代码未强制同步。`activeHistoryId` 的全部使用点：

| 位置 | 用途 | 是否需同步 |
|---|---|---|
| `MainPage.tsx:19` | `useState` 定义，初值 `undefined` | — |
| `MainPage.tsx:21-24` | `activeHistoryIdRef` 镜像，供休眠调度器 useCallback 读最新值 | ref 自动跟随，无需改 |
| `MainPage.tsx:47-51` | `isNewSession` 为 true 时 `setActiveHistoryId(undefined)` | `currentConversationId` 由 `setNewSession(true)` 在 store 层同步清空（见 P0-1） |
| `MainPage.tsx:87-97` | `historySnapshots` useMemo：`history.find((h) => h.id === activeHistoryId)`，**快照显示核心路径** | 保留 `activeHistoryId`，不改（快照语义属于回溯态，与发消息锚点分离） |
| `MainPage.tsx:162` | 休眠调度器读 `activeHistoryIdRef.current` | ref 自动跟随，无需改 |
| `MainPage.tsx:289/364` | 发新消息 / 生成报告前的快照兜底 | **改为 `currentConversationId`**（P0-2）—— 此处必须用发消息锚点而非回溯锚点 |
| `MainPage.tsx:819` | 渲染条件 `!isHistoryMode || !activeHistoryId` | 保留 `activeHistoryId`（回溯态判断） |
| `MainPage.tsx:859` | 传 `activeHistoryId` 给 `HistoryDrawer` 高亮 | 保留 |
| `MainPage.tsx:860-870` | `onSelectHistory`：`setActiveHistoryId(item.id)` | **补 `setCurrentConversationId(item.id)`**（P0-1b） |

**关键衔接**：289/364 行改用 `currentConversationId` 后，恢复历史时若 `currentConversationId` 未同步设为 `item.id`，发新消息会查到错误的对话（仍串台）。因此 `onSelectHistory` 必须同时 set 两者。但 `historySnapshots`（87-97）等纯回溯显示路径**保留 `activeHistoryId`**——回溯快照语义与发消息锚点应分离，避免把"显示某条历史"和"往哪条对话写"耦合死。

### 3.3 ID 生成点（全部 `Date.now().toString()`）

| 位置 | 用途 |
|---|---|
| `appStore.ts:1102` | `conversationId` |
| `appStore.ts:1126` | `turnId = \`${conversationId}-${Date.now()}\`` |
| `useSummaryPanel.ts:133` | `summaryHistory.id` |
| `useSummaryPanel.ts:431` | user `ChatMessage.id` |
| `useSummaryPanel.ts:516` | assistant `ChatMessage.id = (Date.now()+1).toString()`（防碰撞 hack） |
| `useSummaryPanel.ts:559` | 同 516，另一处 assistant 消息 |

### 3.4 `webviewRefs` 反注册

- `appStore.ts:869-870`：
  ```ts
  registerWebviewRef: (id, ref) => get().webviewRefs.set(id, ref),
  unregisterWebviewRef: (id) => get().webviewRefs.delete(id),
  ```
  `unregisterWebviewRef` 直接 `delete`，不校验 `ref` 是否就是当前注册的那个。
- `MainPage.tsx:101-119` 的 `getRefCallback`：注册时 `set(slotKey, ref)` + `set(id, ref)`；注销时传 `lastRef` 调 `unregisterWebviewRef(slotKey, lastRef)`。若新 ref 已覆盖旧 ref 而旧回调又触发 null，`delete` 会误删新 ref。

### 3.5 `getDisplayedModels` 漏参

- `MainPage.tsx:906`：`getDisplayedModels(models, targetDisplayMode, targetProductMode, taskAssignmentSlots, multiAiSlots)` —— 漏传 `debateSlots`。
- 对比 `MainPage.tsx:301` 同一调用传了 `debateSlots`，证明是漏写。
- `getDisplayedModels` 签名（`appStore.ts:419-426`）：`debateSlots?: [string, string]`，debate 模式下不传时走 `models[index % models.length]` 兜底（line 440-445 的 `debateSlots` 判空失败），返回默认前两个模型而非 debate 实际槽位 → 槽位错位。

### 3.6 `SummaryPage` init effect 依赖

- `SummaryPage.tsx:155-201`：`useEffect` 依赖数组含 `history`（line 201）。
- `pendingSummarySession` 消费后 `setPendingSummarySession(null)`（line 170），但监控写盘会触发 `history` 变化 → effect 重跑 → `initDoneRef.current=true` 走 fallback（188-200）→ 用 `history[0]` 覆盖刚恢复的 `modelResponses`。

### 3.7 `setNewSession` 与清空点

- `setNewSession`（`appStore.ts:998-1000`）：只改 `isNewSession`。
- `setProductMode`（`appStore.ts:692`）：切换模式时调 `setNewSession(true)`。
- `MainPage.tsx:47-51`：`isNewSession` 为 true 时 `setActiveHistoryId(undefined)`。
- `sendMessageToAll` 新对话分支（`appStore.ts:1114`）：`setNewSession(false)`。

`setNewSession(true)` 是注入 `currentConversationId` 清空的统一入口（模式切换、新会话都走它）。

---

## 四、详细修复方案

### P0-1：引入持久化 `currentConversationId` store 字段

**目标**：为"当前对话"提供持久化 ID 锚点，监控结束后仍存活，所有查询走 ID 查找。

**改动**：

1. **`src/renderer/src/store/appStore.ts`**
   - AppState 接口（约 388 行附近）：新增
     ```ts
     currentConversationId: string | null
     setCurrentConversationId: (id: string | null) => void
     ```
   - 初始 state（约 996 行附近）：`currentConversationId: null`
   - 新增 setter：
     ```ts
     setCurrentConversationId: (id) => set({ currentConversationId: id }),
     ```
   - `setNewSession`（998-1000）改为：
     ```ts
     setNewSession: (isNew: boolean) => {
       // 新会话标记时同步清空当前对话锚点，防止 history[0] 兜底串台
       set({ isNewSession: isNew, ...(isNew ? { currentConversationId: null } : {}) })
     },
     ```
   - `sendMessageToAll`（1091-1123）：
     - **续写判定基准（1091 行）**：`const lastItem = history.length > 0 ? history[0] : null` 改为按 `currentConversationId` 查找：
       ```ts
       const lastItem = state.currentConversationId
         ? history.find(h => h.id === state.currentConversationId) ?? null
         : null
       ```
       `isNewConv` 判定语义不变（`lastItem` 为 null 时走新对话分支，符合"无当前对话则开新对话"）。这是 P0-1 的核心补丁——不修则恢复非 `history[0]` 的对话续写仍串台。
     - 新对话分支：`addHistory(newItem)` 后 `set({ currentConversationId: conversationId })`（紧接 `setNewSession(false)` 之后）
     - 续写分支：`set({ currentConversationId: lastItem!.id })`（在 `updateHistory` 之前或之后；此时 `lastItem` 已按 `currentConversationId` 正确取到）
   - `startMonitoring`（1466-1474）：`set` 块内同步写 `currentConversationId: conversationId`（与 `monitor.currentConversationId` 并存，前者持久态，后者监控态）
   - `stopMonitoring`（1486-1494）：**不**清空 `currentConversationId`（监控结束 ≠ 对话结束），只清 monitor 字段
   - `removeHistories` / `removeHistory`（904-913）：若被删 id === `currentConversationId`，置 null
     ```ts
     removeHistories: (ids: string[]) => set((state) => {
       const newHistory = state.history.filter(item => !ids.includes(item.id))
       if (window.api?.storeSet) window.api.storeSet('history', newHistory)
       const cleared = ids.includes(state.currentConversationId ?? '')
       return {
         history: newHistory,
         ...(cleared ? { currentConversationId: null } : {})
       }
     }),
     ```

2. **`src/renderer/src/pages/MainPage.tsx`**
   - `onSelectHistory`（860-870）：在 `setActiveHistoryId(item.id)` 同行后补 `appStore.setCurrentConversationId(item.id)`（`appStore` 已在 862 行通过 `useAppStore.getState()` 取得）
   - 顶部 `useAppStore` selector 解构处（38-42 行附近）：如需在渲染期使用，补 `const currentConversationId = useAppStore((s) => s.currentConversationId)`
   - `useEffect`（47-51）的 `isNewSession` 清空分支：`setActiveHistoryId(undefined)` 已有，`currentConversationId` 由 `setNewSession(true)` 在 store 层清空，无需在此重复

### P0-1b：`activeHistoryId` 与 `currentConversationId` 双标识源同步策略

**背景**：见 3.2b。`activeHistoryId`（MainPage 局部 state，回溯快照锚点）与 `currentConversationId`（store 持久字段，发消息/监控锚点）是两套语义，恢复历史时必须同步，否则 P0-2 改完 289/364 后仍会串台。

**同步规则**：

| 触发点 | `activeHistoryId` | `currentConversationId` | 谁负责同步 |
|---|---|---|---|
| `onSelectHistory`（恢复历史） | `setActiveHistoryId(item.id)` 已有 | **补 `setCurrentConversationId(item.id)`** | P0-1b 在 MainPage 改 |
| `setNewSession(true)`（新会话/模式切换） | 由 47-51 effect 清为 `undefined` | 由 P0-1 在 store 层清为 `null` | 各自清空，无需显式同步 |
| `sendMessageToAll` 新对话分支 | 不涉及（新对话非回溯态） | `set({ currentConversationId: conversationId })`（P0-1） | P0-1 在 store 改 |
| `sendMessageToAll` 续写分支 | 不涉及 | `set({ currentConversationId: lastItem!.id })`（P0-1） | P0-1 在 store 改 |
| `removeHistories` 删除当前对话 | 由 47-51 effect 间接触发（`isNewSession` 不一定变） | 置 `null`（P0-1） | 见下方补充 |

**改动**：

1. **`src/renderer/src/pages/MainPage.tsx` 顶部 selector**（38-42 行附近）：补
   ```ts
   const currentConversationId = useAppStore((s) => s.currentConversationId)
   ```
   供 289/364 行渲染期查询使用（P0-2 依赖）。`useEffect`（47-51）的 `isNewSession` 清空分支：`setActiveHistoryId(undefined)` 已有，`currentConversationId` 由 `setNewSession(true)` 在 store 层清空，无需在此重复 set。

2. **`src/renderer/src/pages/MainPage.tsx` `onSelectHistory`**（860-870）：在 `setActiveHistoryId(item.id)` 紧接其后补 `appStore.setCurrentConversationId(item.id)`。两 set 必须紧邻，确保后续 `sendMessageToAll` / 289 行查询读到同一 ID。

3. **`removeHistories` 后的 `activeHistoryId` 清理**（计划 P0-1 已让 store 层清 `currentConversationId`，但 `activeHistoryId` 是 MainPage 局部 state，store 改不到）：
   - 现状：删除当前对话后，`activeHistoryId` 仍指向已删 ID，`historySnapshots`（87-97）会 `find` 不到返回空快照——**不会串台但会残留脏 ID**。
   - 处理：不在本计划强改 `activeHistoryId`（它是局部 state，需经 props/事件回流 MainPage，跨层改动大）。残留脏 ID 的副作用仅是"高亮一条已删历史"，无串台风险（`find` 不到走空兜底）。**记为已知限制**，在 Done Criteria 注明。
   - 若要彻底修：`HistoryDrawer` 删除后通过 `onSelectHistory(null)` 或新增 `onHistoryRemoved` 回调通知 MainPage 清 `activeHistoryId` —— **超出本计划范围，留 P2**。

4. **不改 `historySnapshots`（87-97）等纯回溯显示路径**：这些路径用 `activeHistoryId` 是正确的（显示快照语义），改成 `currentConversationId` 反而会让"查看历史 A 时显示历史 B 的快照"。

**验证点**（对应回归脚本第 7 条）：恢复历史 A（不删）→ 直接发新消息 → 新 turn 必须写入 A，不能串到 B。这条专门验证双标识源同步。

### P0-2：移除全部 `history[0]` 兜底，改为 ID 查找 + 显式 null

逐处替换（见 3.2 表）。每处替换后，下游链路对 `null` 做空值兜底：

1. **`MainPage.tsx:289`**
   ```ts
   // 改前
   const latestHistoryItem = history.find((h) => h.id === activeHistoryId) ?? history[0]
   const lastTurn = latestHistoryItem?.turns?.[latestHistoryItem.turns.length - 1]
   const lastResponses = lastTurn?.responses ?? {}
   // 改后
   const latestHistoryItem = history.find((h) => h.id === currentConversationId) ?? null
   const lastTurn = latestHistoryItem?.turns?.[latestHistoryItem.turns.length - 1]
   const lastResponses = lastTurn?.responses ?? {}
   ```
   `currentConversationId` 取自 store（P0-1 已在 MainPage 注入 selector）。`activeHistoryId` 不再用于此查询。

**附带修复症状 6**：未对话点"生成报告"时，`currentConversationId` 为 `null`（P0-1 让 `setNewSession(true)` 清空，应用启动初值也是 `null`），`find` 返回 `undefined` → `?? null` 得 `null` → 290 行 `lastResponses = {}` → 302-306 行不补任何历史快照 → `setPendingSummarySession({ modelResponses: {}, ... })` → SummaryPage 显示空内容而非旧快照。改前 `?? history[0]` 会拉进上一次会话的末轮回复，正是症状 6 的根因。

2. **`MainPage.tsx:364`**：同 289 改法（需读上下文确认是否同一函数，若是则提取局部变量复用）。

3. **`useSummaryPanel.ts:124`**：
   ```ts
   // 改前
   urls: history[0]?.urls,
   // 改后
   urls: history.find(h => h.id === currentConversationId)?.urls,
   ```
   `useSummaryPanel` 内需取 `currentConversationId`：在 hook 顶部 `const currentConversationId = useAppStore((s) => s.currentConversationId)`（hook 已有 `useAppStore` 调用先例）。

4. **`SummaryPage.tsx:188-200`**（fallback 分支）：
   ```ts
   // 改前
   const latestItem = history[0]
   const latestTurn = latestItem?.turns?.[latestItem.turns.length - 1]
   // 改后
   const latestItem = history.find(h => h.id === currentConversationId)
   const latestTurn = latestItem?.turns?.[latestItem.turns.length - 1]
   ```
   `SummaryPage` 顶部取 `const currentConversationId = useAppStore((s) => s.currentConversationId)`。

### P0-3：修复 `SummaryPage` init effect 覆盖刚恢复的内容

**问题**：`useEffect` 依赖 `history`（line 201），监控写盘触发重跑，覆盖刚恢复的内容。

**改动**：`src/renderer/src/pages/SummaryPage.tsx:155-201`

- 依赖数组从 `[initialHistoryItem, pendingSummarySession, displayedModels, history, setPendingSummarySession]` 改为 `[initialHistoryItem, pendingSummarySession, displayedModels, setPendingSummarySession]`（移除 `history`）
- fallback 分支（188-200）只在 `!initDoneRef.current` 时跑（已有该判断），移除 `history` 依赖后不再因 history 变化重入
- 若 `pendingSummarySession` 与 `initialHistoryItem` 都为空且已 init，effect 直接 return，不再走 fallback

**验证点**：确认 `pendingSummarySession` 与 `initialHistoryItem` 两条路径仍能正常触发（它们仍是依赖）。

**移除 `history` 依赖的语义影响**（评估补充）：

- 移除后，用户停留在 SummaryPage 期间，主对话监控继续写盘导致 `history[0]` 的 `turns` 更新——SummaryPage **不会**因此自动刷新。这是**预期且正确**的行为：避免监控写盘覆盖刚恢复 / 刚抓取的总结内容（正是本条修复的 bug 本身）。
- fallback 分支（188-200）只在 `!initDoneRef.current` 首次 mount 时跑一次，正常进入都经 `pendingSummarySession`（164-182）或 `initialHistoryItem`（156-161）提前 return，故移除 `history` 依赖对正常路径无影响。
- 需在回归脚本第 3 条之外，额外确认：进入 SummaryPage 后停留 10s+ 期间主对话若有监控写盘，SummaryPage 内容不闪烁、不被覆盖（已含在第 3 条）。

**`useSummaryPanel.ts:124` 空值兜底**（评估补充，归入 P0-2 第 3 条）：

- `persistSummaryHistory` 可能在用户已离开主界面、`currentConversationId` 已被 `setNewSession(true)` 清空（`null`）时被调用，此时 `history.find(h => h.id === null)` 返回 `undefined`，`?.urls` 得 `undefined`。
- `SummaryHistoryItem.urls` 是可选字段（`urls?`），`undefined` 合法，不会破坏类型或持久化。
- 但需在回归脚本覆盖"生成报告 → `urls` 不丢"场景（第 2 条已含）：从主界面发消息后立即生成报告，`currentConversationId` 此时非空，`urls` 应正常写入总结记录。

### P1-1：全部 ID 改 `crypto.randomUUID()`

逐处替换（见 3.3 表）：

| 位置 | 改前 | 改后 |
|---|---|---|
| `appStore.ts:1102` | `Date.now().toString()` | `crypto.randomUUID()` |
| `appStore.ts:1126` | `` `${conversationId}-${Date.now()}` `` | `` `${conversationId}-${crypto.randomUUID()}` `` |
| `useSummaryPanel.ts:133` | `now.toString()` | `crypto.randomUUID()` |
| `useSummaryPanel.ts:431` | `Date.now().toString()` | `crypto.randomUUID()` |
| `useSummaryPanel.ts:516` | `(Date.now() + 1).toString()` | `crypto.randomUUID()` |
| `useSummaryPanel.ts:559` | `(Date.now() + 1).toString()` | `crypto.randomUUID()` |

- `now` 变量（`useSummaryPanel.ts:107`）仍用于 `timestamp: now`，保留不动。
- **兼容性**：读取旧记录时旧 `Date.now()` id 是合法 string，新旧共存，无需迁移。`crypto.randomUUID()` 在 Electron renderer（Chromium）可用，无新依赖。
- **sandbox 验证**（评估补充）：renderer 在 `contextIsolation` + `nodeIntegration: false` 下，`crypto.randomUUID()` 仍属 Web Crypto API（secure context，HTTPS/file/extension 上下文均可用），不依赖 Node。但为稳妥，实施后在 `npm run dev` 中 console 执行一次 `crypto.randomUUID()` 确认不抛错，再跑回归脚本第 4 条。

### P1-2：补 `debateSlots` 漏参

**改动**：`src/renderer/src/pages/MainPage.tsx:906`

```ts
// 改前
const currentDisplayedIds = getDisplayedModels(models, targetDisplayMode, targetProductMode, taskAssignmentSlots, multiAiSlots).map(m => m.id)
// 改后
const currentDisplayedIds = getDisplayedModels(models, targetDisplayMode, targetProductMode, taskAssignmentSlots, multiAiSlots, debateSlots).map(m => m.id)
```

确认 `debateSlots` 在该作用域可访问：`MainPage` 顶部 selector 已解构 `debateSlots`（`MainPage.tsx:34`），`onSelectHistory` 是 MainPage 组件体内闭包，直接引用即可，**无需额外取**。`sendMessageToAll` 内部也已解构 `debateSlots`（用于 301 行的正确调用），两处独立但同源。

### P1-3：加固 `webviewRefs` 反注册

**改动**：`src/renderer/src/store/appStore.ts:869-870`

```ts
// 改前
registerWebviewRef: (id, ref) => get().webviewRefs.set(id, ref),
unregisterWebviewRef: (id) => get().webviewRefs.delete(id),

// 改后
registerWebviewRef: (id, ref) => get().webviewRefs.set(id, ref),
unregisterWebviewRef: (id, ref) => {
  // 仅当当前注册的 ref 就是要注销的那个才删，避免新 ref 已覆盖后旧回调误删新 ref
  if (get().webviewRefs.get(id) === ref) get().webviewRefs.delete(id)
},
```

- AppState 接口（`appStore.ts:296`）：`unregisterWebviewRef: (id: string, ref: WebviewCardRef) => void`
- 调用点 `MainPage.tsx:113-114` 已传 `lastRef`，无需改
- `webviewRefs` 是 renderer 内部 store，不跨 IPC，**不需改 `src/preload/index.d.ts`**

---

## 五、关键文件清单

| 文件 | 改动项 |
|---|---|
| `src/renderer/src/store/appStore.ts` | P0-1 字段/setter/清空、P0-2（saveCurrentTurn 已正确，无需改）、P1-1 conversationId/turnId、P1-3 反注册 |
| `src/renderer/src/pages/MainPage.tsx` | P0-1 selector + 恢复锚定、P0-1b `onSelectHistory` 双 set 同步、P0-2 兜底移除（289/364）、P1-2 debateSlots |
| `src/renderer/src/pages/SummaryPage.tsx` | P0-2 fallback（188）、P0-3 effect 依赖（201） |
| `src/renderer/src/hooks/useSummaryPanel.ts` | P0-2 urls（124）、P1-1 summaryId/messageId（133/431/516/559） |

---

## 六、复用的现有实现

- `monitor.currentConversationId`（`appStore.ts:1469`）—— 已有的 ID 锚定机制，P0-1 是把它提升为顶层持久字段，监控态字段保留不动。
- `history.find(h => h.id === ...)` —— `saveCurrentTurn`（`appStore.ts:1588`）已用此正确写法，P0-2 是把它推广到所有"当前对话"查询。
- `crypto.randomUUID()` —— Electron/Chromium 内置，无新依赖（AGENTS.md 要求加生产依赖前确认，本方案不引入依赖）。

---

## 七、验证

按 AGENTS.md：`npm run lint` → `npm run build` → `npm run dev` 手动验证。

### 端到端回归脚本（在 dev 桌面环境）

1. **P0-1/P0-2 跨对话串台**
   - 开对话 A（发"你好"）→ 开对话 B（发"测试"）→ 在历史抽屉删掉 A → 在 B 里发第二条消息
   - **预期**：B 的 `turns` 正确新增 turn，A 的记录未被污染（已删）；总结页 `modelResponses` 只含 B 的回复

2. **P0-2 总结快照串台**
   - 同上场景，删 A 后在 B 点"生成报告"
   - **预期**：总结页 `modelResponses` 只含 B 的回复，不含 A 的

3. **P0-3 恢复总结被覆盖**
   - 从总结历史恢复一条 → 不操作，等 10s（让监控写盘触发 history 变化）
   - **预期**：`modelResponses` 未被覆盖，仍显示恢复时的内容

4. **P1-1 ID 碰撞**
   - 快速连续发两条消息（同毫秒内）→ 开 3+ 模型并行发送多次
   - **预期**：生成独立 historyItem，互不覆盖；无丢轮

5. **P1-2 debate 槽位**
   - debate 模式下开一条历史 → 恢复
   - **预期**：两个 webview 加载到正确的 debate 槽位

6. **P1-3 webview 反注册**
   - multi_ai → debate → multi_ai 切换数次 → 发消息
   - **预期**：消息发到当前可见模式的 webview，不发到隐藏模式

7. **P0-1b 双标识源同步**（评估新增）
   - 开对话 A（发"你好"）→ 开对话 B（发"测试"）→ 在历史抽屉点回 A（不删 B）→ 在 A 里直接发第二条消息
   - **预期**：新 turn 写入 A 的 `turns`，不串到 B；`activeHistoryId` 与 `currentConversationId` 同步指向 A。这条专测恢复历史后发新消息不串台，是 P0-1b 的核心验证。
   - 进阶：恢复 A 后停留不发消息，确认 `historySnapshots`（87-97）仍正确显示 A 的最后一轮快照（验证未误改回溯显示路径）。

8. **症状 6：未对话点总结用上次快照**（调试新增）
   - 场景 a（应用启动）：冷启动应用 → 不发任何消息，直接点"生成报告"
   - 场景 b（新会话）：发完对话 A → 点"新会话"按钮（ControlBar）→ 不发消息直接点"生成报告"
   - 场景 c（切模式）：multi_ai 发完对话 → 切 debate 模式 → 不发消息直接点"生成报告"
   - **预期**：三场景下总结页 `modelResponses` 均为空（或仅显示"未获取到有效回复"），**不显示** A 或上一条会话的末轮回复快照。
   - 等价检查：若 dev 中难以稳定触发"未对话"，可在 ControlBar 点"新会话"后立即点"生成报告"，观察通知是否仍出现"（含 N 个历史快照）"——出现即说明 289 行 `history[0]` 兜底未修。

### 无法独立验证的项

- P1-1 的时钟回拨碰撞场景需多模型并行发送才能稳定复现；可在 dev 中开 3+ 模型并行发送多次发送验证不丢轮（等价检查）。

---

## 八、实施顺序与提交粒度

按 P0-1 → P0-1b → P0-2 → P0-3 → P1-1 → P1-2 → P1-3 顺序实施。建议分两个 Conventional Commits：

- `fix(history): 用 currentConversationId 替代 history[0] 作为当前对话标识`（P0-1/P0-1b/P0-2/P0-3）
- `fix(history): UUID 替代 Date.now id + debateSlots 漏参 + webview ref 反注册加固`（P1-1/P1-2/P1-3）

P0-1/P0-1b/P0-2 三者强耦合：`currentConversationId` 字段是 P0-1b 同步与 P0-2 查询的前提，必须同批落地。每步实施后跑 `npm run lint` + `npm run build`，全部完成后 `npm run dev` 跑回归脚本 1-8。

---

## 九、风险评估

| 改动 | 风险 | 缓解 |
|---|---|---|
| P0-1 `currentConversationId` 新字段 | 低：纯新增，不破坏既有字段 | 旧逻辑不依赖该字段，默认 null 安全 |
| P0-1b 双标识源同步 | 中：`onSelectHistory` 漏 set `currentConversationId` 会导致 P0-2 改完仍串台 | 两 set 紧邻；回归脚本第 7 条专测；`historySnapshots` 等回溯路径保留 `activeHistoryId` 不误改 |
| P0-1b 删除当前对话后 `activeHistoryId` 残留脏 ID | 低：`find` 不到走空兜底，无串台 | 记为已知限制（Done Criteria 注明）；彻底修留 P2 |
| P0-2 移除 `history[0]` 兜底 | 中：可能暴露原本被兜底掩盖的空值路径 | 每处下游对 null 显式兜底；`useSummaryPanel.ts:124` 返回 `undefined` 合法；回归脚本 1-3、7 覆盖 |
| P0-3 移除 effect `history` 依赖 | 中：可能影响"history 变化时刷新"的隐性依赖 | `pendingSummarySession`/`initialHistoryItem` 仍是依赖；fallback 仅首次跑；SummaryPage 停留期间不自动刷新是预期行为；回归脚本 3 覆盖 |
| P1-1 UUID | 低：新旧兼容，无数据迁移 | 不动旧记录；dev 中 console 验证 `crypto.randomUUID()` 不抛错 |
| P1-2 debateSlots 补参 | 低：对齐已有正确调用 | 仅影响 debate 模式 |
| P1-3 反注册校验 | 低：仅收紧删除条件 | 调用点已传 ref |

**blast radius**：全部改动在 renderer store / pages / hooks，无 IPC 改动（符合分层约束），无 main/preload 改动，无持久化结构改动。已知限制：删除当前对话后 `activeHistoryId` 残留脏 ID（无串台风险，留 P2）。

---

## 十、Done Criteria

- 行为落到正确层（renderer store / pages / hooks），IPC 契约端到端未变。
- 无关文件无改动。
- `npm run lint` + `npm run build` 通过。
- `crypto.randomUUID()` 在 dev console 验证不抛错（P1-1 sandbox 确认）。
- 回归脚本 1-8 在 dev 中实际触发通过；无法验证的项（ID 时钟回拨）已说明原因并给出等价检查。
- **已知限制已注明**：删除当前对话后 `activeHistoryId` 残留脏 ID（无串台风险，彻底修留 P2）。
- **行为变更已标注**：P0-3 移除 SummaryPage init effect 的 `history` 依赖后，停留在 SummaryPage 期间主对话监控写盘不再触发 SummaryPage 自动刷新——这是修复覆盖 bug 的预期行为，但属用户可感知的变化。
- 风险评估完成，blast radius 已界定。
- `python .memory/session_log.py` 在任务结束时记录。
