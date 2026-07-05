# 任务分配与辩论模式历史记录持久化 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让任务分配模式与辩论模式的对话进入统一历史（`HistoryDrawer`），与普通模式同列展示、可恢复。

**Architecture:** 从 `sendMessageToAll` 抽取共享历史原语 `beginConversation`，三条发送路径（普通/任务分配/辩论）共用；模式差异通过 `HistoryItem` 上新增可选字段 `debateTurns` / `slotUrls` 承载。任务分配复用现有 `startMonitoring` 抓回复；辩论不走监控，由 `useDebateRunner` 现有 `getResponseFromSlot` 拉取后写入 `debateTurns`，结束时写 `slotUrls`。

**Tech Stack:** TypeScript (strict), Electron 28, React 18, Zustand 4。无自动化测试，验证 = `npm run lint` + `npm run build` + `npm run dev` 手动。

## Global Constraints

- 严格 TypeScript，禁用 `any`；未使用变量以 `_` 前缀标记。
- 包管理器只用 npm。
- 历史持久化走现有 `window.api.storeSet('history', ...)`，不改 IPC 契约，不动 `src/main/` 与 `src/preload/`。
- 不擅自切分支，全部在 `main` 上工作。
- 提交遵循 Conventional Commits。
- 时间戳必须通过终端命令获取，不得凭记忆捏造。
- 设计依据：`docs/superpowers/specs/2026-07-05-modes-history-persist-design.md`。

---

## File Structure

| 文件 | 责任 | 改动类型 |
|---|---|---|
| `src/renderer/src/store/appStore.ts` | 状态与历史原语；类型定义；store actions | 修改：扩类型 + 抽取 `beginConversation` + 新增 3 个 actions + 改 `sendMessageToAll` |
| `src/renderer/src/components/modes/TaskModePanel.tsx` | 任务分配发送入口 | 修改：`handleSend` 接入历史 + 监控 |
| `src/renderer/src/hooks/useDebateRunner.ts` | 辩论轮转驱动 | 修改：开始/发言后/结束时写历史 |
| `src/renderer/src/pages/MainPage.tsx` | 历史恢复入口 | 修改：`onSelectHistory` 新增 `debate` 分支 |
| `src/renderer/src/components/HistoryDrawer.tsx` | 历史列表展示 | 修改：辩论条目用 `debateTurns` 渲染 |

不新建文件。所有改动在 renderer 层内闭环。

---

## Task 1: 扩展历史类型与字段

**Files:**
- Modify: `src/renderer/src/store/appStore.ts:116-126`（`HistoryItem`）、`202-205`（`DebateRound` 区，新增 `DebateTurnRecord`）

**Interfaces:**
- Produces: `DebateTurnRecord` 类型、`HistoryItem.debateTurns` / `HistoryItem.slotUrls` 字段，供后续 Task 使用。

- [ ] **Step 1: 在 `DebateRound` 定义之后新增 `DebateTurnRecord`**

在 `src/renderer/src/store/appStore.ts`，找到（约 202-205 行）：

```ts
export interface DebateRound {
  proponent?: string  // 正方发言
  opponent?: string   // 反方发言
}
```

在其后追加：

```ts
// 辩论一轮的落库结构（与运行态 DebateRound 区分：落库带 modelId 与时间戳）
export interface DebateTurnRecord {
  round: number          // 第几轮（0-based）
  proponent?: { modelId: string; speech: string; timestamp: number }
  opponent?:  { modelId: string; speech: string; timestamp: number }
}
```

- [ ] **Step 2: 扩展 `HistoryItem`**

在 `src/renderer/src/store/appStore.ts`，找到（约 116-126 行）：

```ts
export interface HistoryItem {
  id: string
  createdAt: number
  updatedAt: number
  models: string[]
  title?: string
  turns: ConversationTurn[]
  urls?: Record<string, string>
  productMode?: ProductMode
  displayMode?: DisplayMode
}
```

改为（末尾追加两可选字段）：

```ts
export interface HistoryItem {
  id: string
  createdAt: number
  updatedAt: number
  models: string[]
  title?: string
  turns: ConversationTurn[]
  urls?: Record<string, string>
  productMode?: ProductMode
  displayMode?: DisplayMode
  // —— 仅辩论模式 ——
  debateTurns?: DebateTurnRecord[]       // 各轮正/反方发言
  slotUrls?: Record<number, string>      // slotIndex -> 最终 URL（避开同 modelId 冲突）
}
```

- [ ] **Step 3: lint + build 验证类型无报错**

Run: `npm run lint`
Expected: 无新增错误（类型追加可选字段不破坏现有调用）。

Run: `npm run build`
Expected: 类型检查通过，打包成功。

- [ ] **Step 4: Commit**

```bash
git add src/renderer/src/store/appStore.ts
git commit -m "feat(history): add debateTurns & slotUrls fields to HistoryItem"
```

---

## Task 2: 抽取共享原语 `beginConversation`

**Files:**
- Modify: `src/renderer/src/store/appStore.ts:346` 区（`AppState` 接口新增方法签名）、`1063-1145` 区（`sendMessageToAll` 内部抽取）

**Interfaces:**
- Consumes: `shouldStartNewConversation`、`addHistory`、`updateHistory`、`setNewSession`、`setCurrentConversationId`、`getDisplayedModels`、`waitForSavableUrl`（均已在 store 内存在）。
- Produces: `beginConversation(input) -> Promise<{ conversationId: string; isNew: boolean; lastItem: HistoryItem | null }>`，供 Task 3/4/5 调用。

- [ ] **Step 1: 在 `AppState` 接口新增 `beginConversation` 签名**

在 `src/renderer/src/store/appStore.ts`，找到（约 346 行）：

```ts
  // 发送消息到所有启用的模型（从已输入的文本发送）
  sendMessageToAll: (message: string) => Promise<SendResult[]>
```

在其前一行插入：

```ts
  // 共享历史原语：判定新/旧对话并写入历史头部，返回 conversationId。
  // turnId 由调用方自行生成，本方法只管会话生命周期。
  beginConversation: (input: {
    successModelIds: string[]
    currentUrls: Record<string, string>
    productMode: ProductMode
    displayMode: DisplayMode
  }) => Promise<{ conversationId: string; isNew: boolean; lastItem: HistoryItem | null }>

```

- [ ] **Step 2: 在 store 实现区新增 `beginConversation` 实现**

在 `src/renderer/src/store/appStore.ts`，找到 `sendMessageToAll` 实现起始（约 1063 行）：

```ts
  sendMessageToAll: async (message: string): Promise<SendResult[]> => {
    const state = get()
    const { models, webviewRefs, addHistory, updateHistory, history, isNewSession, setNewSession, displayMode, productMode, taskAssignmentSlots, multiAiSlots, debateSlots } = state
```

在 `sendMessageToAll` 实现的**正上方**（与 `sendMessageToAll` 同级缩进，4 空格）插入新方法：

```ts
  beginConversation: async ({ successModelIds, currentUrls, productMode, displayMode }) => {
    const state = get()
    const { addHistory, updateHistory, history, isNewSession, setNewSession } = state

    // 续写判定基准：按 currentConversationId 查找当前对话，而非 history[0]。
    const lastItem = state.currentConversationId
      ? history.find(h => h.id === state.currentConversationId) ?? null
      : null
    const isNewConv = shouldStartNewConversation(
      currentUrls,
      lastItem?.urls,
      isNewSession
    )

    if (isNewConv) {
      const conversationId = crypto.randomUUID()
      const newItem: HistoryItem = {
        id: conversationId,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        models: successModelIds,
        turns: [],
        urls: currentUrls,
        productMode,
        displayMode,
      }
      addHistory(newItem)
      setNewSession(false)
      set({ currentConversationId: conversationId })
      return { conversationId, isNew: true, lastItem: null }
    }

    const conversationId = lastItem!.id
    const updatedUrls = { ...lastItem!.urls, ...currentUrls }
    updateHistory(conversationId, {
      urls: updatedUrls,
      updatedAt: Date.now(),
    })
    set({ currentConversationId: conversationId })
    return { conversationId, isNew: false, lastItem }
  },

```

> 注意：实现里引用的 `successModelIds` 等参数来自解构入参；TS 4.x 起对解构对象参数的类型从签名推断，无需显式标注。如 lint 报 `no-inferrable-types` 之外的错，按报错调整。

- [ ] **Step 3: 改造 `sendMessageToAll` 调用 `beginConversation`**

在 `src/renderer/src/store/appStore.ts`，定位 `sendMessageToAll` 内部从"立即获取当前各平台 URL"到"创建新 turn 并启动监控"之间这段（约 1087-1149 行），即：

```ts
    if (successModels.length > 0) {
      // 立即获取当前各平台 URL（用于判定新/旧对话）
      const currentUrls: Record<string, string> = {}
      await Promise.all(
        successModels.map(async (modelId) => {
          const ref = webviewRefs.get(modelId)
          if (!ref) return
          try {
            const url = ref.getCurrentUrl()
            if (url && url !== 'about:blank') {
              currentUrls[modelId] = url
            }
          } catch {
            // 忽略获取失败
          }
        })
      )

      // 续写判定基准：按 currentConversationId 查找当前对话，而非 history[0]。
      // history[0] 会因新增/删除/分页裁剪随时重排，恢复非首位历史后续写会串到 history[0]。
      const lastItem = state.currentConversationId
        ? history.find(h => h.id === state.currentConversationId) ?? null
        : null
      const isNewConv = shouldStartNewConversation(
        currentUrls,
        lastItem?.urls,
        isNewSession
      )

      let conversationId: string

      if (isNewConv) {
        // 新对话
        conversationId = crypto.randomUUID()
        const newItem: HistoryItem = {
          id: conversationId,
          createdAt: Date.now(),
          updatedAt: Date.now(),
          models: successModels,
          turns: [],
          urls: currentUrls,
          productMode,
          displayMode,
        }
        addHistory(newItem)
        setNewSession(false)
        // 持久化当前对话锚点，监控结束后仍可查询（替代 history[0] 兜底）
        set({ currentConversationId: conversationId })
      } else {
        // 继续现有对话
        conversationId = lastItem!.id
        const updatedUrls = { ...lastItem!.urls, ...currentUrls }
        updateHistory(conversationId, {
          urls: updatedUrls,
          updatedAt: Date.now(),
        })
        // 同步锚点（恢复历史后续写时 lastItem 已按 currentConversationId 正确取到）
        set({ currentConversationId: conversationId })
      }

      // 创建新 turn 并启动监控
      const turnId = `${conversationId}-${crypto.randomUUID()}`
      get().startMonitoring(conversationId, turnId, message, successModels)
```

替换为：

```ts
    if (successModels.length > 0) {
      // 立即获取当前各平台 URL（用于判定新/旧对话）
      const currentUrls: Record<string, string> = {}
      await Promise.all(
        successModels.map(async (modelId) => {
          const ref = webviewRefs.get(modelId)
          if (!ref) return
          try {
            const url = ref.getCurrentUrl()
            if (url && url !== 'about:blank') {
              currentUrls[modelId] = url
            }
          } catch {
            // 忽略获取失败
          }
        })
      )

      // 共享原语：判定新/旧对话 + 写历史头部
      const { conversationId } = await get().beginConversation({
        successModelIds: successModels,
        currentUrls,
        productMode,
        displayMode,
      })

      // 创建新 turn 并启动监控
      const turnId = `${conversationId}-${crypto.randomUUID()}`
      get().startMonitoring(conversationId, turnId, message, successModels)
```

> `beginConversation` 内部已处理 `setNewSession(false)` 与 `set({ currentConversationId })`，原 `sendMessageToAll` 后段（约 1151 行起的 5 秒后 URL 兜底采集）保持不动。注意保留 `successModels.length > 0` 块内紧接其后的 `;(async () => { await sleep(5000) ... })()` 那段 URL 兜底逻辑不动。

- [ ] **Step 4: 检查 `sendMessageToAll` 顶部解构的未使用变量**

抽取后 `sendMessageToAll` 顶部解构里的 `addHistory`、`updateHistory`、`history`、`isNewSession`、`setNewSession` 可能不再被该方法体内直接使用（已移入 `beginConversation`）。lint 会报 `no-unused-vars`。

定位 `sendMessageToAll` 第一行解构（约 1065 行）：

```ts
    const { models, webviewRefs, addHistory, updateHistory, history, isNewSession, setNewSession, displayMode, productMode, taskAssignmentSlots, multiAiSlots, debateSlots } = state
```

把确认不再被 `sendMessageToAll` 体内直接使用的标识符删掉。判断方法：在 `sendMessageToAll` 方法体内（从 1066 行到方法结束 `},`）搜索每个变量；只在该方法体内出现的才删。**不要**靠猜——逐个 grep。`displayMode`、`productMode`、`models`、`webviewRefs`、`taskAssignmentSlots`、`multiAiSlots`、`debateSlots` 大概率仍被 `getDisplayedModels` 调用使用，保留。删后形如（最终以实际 grep 结果为准）：

```ts
    const { models, webviewRefs, displayMode, productMode, taskAssignmentSlots, multiAiSlots, debateSlots } = state
```

- [ ] **Step 5: lint + build**

Run: `npm run lint`
Expected: 无 `no-unused-vars`、无类型错误。

Run: `npm run build`
Expected: 通过。

- [ ] **Step 6: Commit**

```bash
git add src/renderer/src/store/appStore.ts
git commit -m "refactor(history): extract beginConversation primitive shared by send paths"
```

---

## Task 3: 任务分配模式接入历史 + 监控

**Files:**
- Modify: `src/renderer/src/components/modes/TaskModePanel.tsx:52-77`（`handleSend`）

**Interfaces:**
- Consumes: `beginConversation`、`startMonitoring`（store），`getDisplayedModels`、`waitForSavableUrl`。
- Produces: 任务分配发送后产生 `HistoryItem`（`productMode='task_assignment'`，含 `turns[0]` 回复）。

- [ ] **Step 1: 在 `TaskModePanel` 顶部补充 store 选择器与 import**

在 `src/renderer/src/components/modes/TaskModePanel.tsx` 顶部 import 区（1-5 行）找到：

```ts
import { useRef, useState } from 'react'
import { useAppStore } from '../../store/appStore'
import { useTaskSplit } from '../../hooks/useTaskSplit'
import SubtaskList from './SubtaskList'
import TaskSplitModal from './TaskSplitModal'
```

改为：

```ts
import { useRef, useState } from 'react'
import { useAppStore, getDisplayedModels } from '../../store/appStore'
import { useTaskSplit } from '../../hooks/useTaskSplit'
import SubtaskList from './SubtaskList'
import TaskSplitModal from './TaskSplitModal'
import { waitForSavableUrl } from '../../store/appStore'
import type { WebviewCardRef } from '../WebviewCard'
```

> 如 `WebviewCardRef` 已从别处导入或类型名不同，以 `WebviewCard.tsx` 实际导出名为准（grep `export.*WebviewCardRef`）。`waitForSavableUrl` 在 `appStore.ts:672` 导出为 `export const`，可从该模块导入。

- [ ] **Step 2: 在组件内补充所需 store 字段**

在 `src/renderer/src/components/modes/TaskModePanel.tsx`，找到组件内选择器区（约 20-26 行）：

```ts
  const taskState = useAppStore((s) => s.taskState)
  const setTaskQuery = useAppStore((s) => s.setTaskQuery)
  const setTaskPhase = useAppStore((s) => s.setTaskPhase)
  const setTaskSubtasks = useAppStore((s) => s.setTaskSubtasks)
  const resetTask = useAppStore((s) => s.resetTask)
  const webviewRefs = useAppStore((s) => s.webviewRefs)
  const { split, isLoading } = useTaskSplit()
```

在其后追加（补 `displayMode`、`taskAssignmentSlots`、`models`）：

```ts
  const displayMode = useAppStore((s) => s.displayMode)
  const taskAssignmentSlots = useAppStore((s) => s.taskAssignmentSlots)
  const models = useAppStore((s) => s.models)
```

- [ ] **Step 3: 改造 `handleSend`，接入历史 + 监控**

在 `src/renderer/src/components/modes/TaskModePanel.tsx`，找到 `handleSend`（约 52-77 行）：

```ts
  const handleSend = async () => {
    if (taskState.subtasks.length === 0) return
    setTaskPhase('sent')
    const bySlot = new Map<number, string[]>()
    taskState.subtasks.forEach((st) => {
      const slotIndex = Math.max(0, st.slotIndex)
      if (!bySlot.has(slotIndex)) bySlot.set(slotIndex, [])
      bySlot.get(slotIndex)!.push(st.text)
    })
    let okCount = 0
    let failCount = 0
    for (const [slotIndex, texts] of bySlot) {
      const ref = webviewRefs.get(`slot-${slotIndex}`)
      if (!ref) { failCount++; continue }
      const combined = texts.map((t, i) => `【子任务${i + 1}】\n${t}`).join('\n\n')
      try {
        const r = await ref.sendMessage(combined)
        if (r.success) okCount++; else failCount++
      } catch {
        failCount++
      }
    }
    if (failCount === 0) showNotification('success', `已向 ${okCount} 个槽位发送子任务`)
    else if (okCount === 0) showNotification('error', '所有槽位发送失败')
    else showNotification('info', `${okCount} 成功，${failCount} 失败`)
  }
```

替换为：

```ts
  const handleSend = async () => {
    if (taskState.subtasks.length === 0) return
    setTaskPhase('sent')
    const bySlot = new Map<number, string[]>()
    taskState.subtasks.forEach((st) => {
      const slotIndex = Math.max(0, st.slotIndex)
      if (!bySlot.has(slotIndex)) bySlot.set(slotIndex, [])
      bySlot.get(slotIndex)!.push(st.text)
    })

    // 记录每个 slot 发送的组合文本（用于历史 userMessage）与成功与否
    const sentTexts: Record<number, string> = {}
    const successSlotIndices: number[] = []
    let okCount = 0
    let failCount = 0
    for (const [slotIndex, texts] of bySlot) {
      const ref = webviewRefs.get(`slot-${slotIndex}`)
      if (!ref) { failCount++; continue }
      const combined = texts.map((t, i) => `【子任务${i + 1}】\n${t}`).join('\n\n')
      try {
        const r = await ref.sendMessage(combined)
        if (r.success) {
          okCount++
          successSlotIndices.push(slotIndex)
          sentTexts[slotIndex] = combined
        } else {
          failCount++
        }
      } catch {
        failCount++
      }
    }
    if (failCount === 0) showNotification('success', `已向 ${okCount} 个槽位发送子任务`)
    else if (okCount === 0) showNotification('error', '所有槽位发送失败')
    else showNotification('info', `${okCount} 成功，${failCount} 失败`)

    // —— 接入历史 + 监控（仅当至少一个 slot 成功）——
    if (successSlotIndices.length === 0) return
    const store = useAppStore.getState()
    const slotModels = getDisplayedModels(models, displayMode, 'task_assignment', taskAssignmentSlots)
    const successModelIds = successSlotIndices.map(i => slotModels[i]?.id).filter(Boolean) as string[]
    if (successModelIds.length === 0) return

    // 采集当前 URL（modelId 作 key，任务分配 slot↔modelId 一一对应）
    const currentUrls: Record<string, string> = {}
    await Promise.all(successSlotIndices.map(async (slotIndex) => {
      const ref = webviewRefs.get(`slot-${slotIndex}`)
      const modelId = slotModels[slotIndex]?.id
      if (!ref || !modelId) return
      try {
        const savable = await waitForSavableUrl(modelId, ref)
        if (savable) currentUrls[modelId] = savable
      } catch { /* 忽略 */ }
    }))

    const { conversationId } = await store.beginConversation({
      successModelIds,
      currentUrls,
      productMode: 'task_assignment',
      displayMode,
    })
    const userMessage = successSlotIndices.map(i => `【slot ${i + 1}】${sentTexts[i]}`).join('\n\n')
    const turnId = `${conversationId}-${crypto.randomUUID()}`
    store.startMonitoring(conversationId, turnId, userMessage, successModelIds)
  }
```

- [ ] **Step 4: lint + build**

Run: `npm run lint`
Expected: 无错误。

Run: `npm run build`
Expected: 通过。

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/components/modes/TaskModePanel.tsx
git commit -m "feat(task-assignment): persist sent subtasks & monitor AI replies into history"
```

---

## Task 4: 辩论模式落库（开始/发言后/结束）

**Files:**
- Modify: `src/renderer/src/store/appStore.ts`（`AppState` 接口新增 3 签名 + 实现）、`src/renderer/src/hooks/useDebateRunner.ts`

**Interfaces:**
- Consumes: `beginConversation`（Task 2）、`debateState`、`debateSlots`、`webviewRefs`、`waitForSavableUrl`。
- Produces: `appendDebateTurnToHistory`、`finalizeDebateHistory`、`restoreDebateState` 三个 store actions，供 Task 4（前两个）与 Task 5（第三个）调用。

- [ ] **Step 1: 在 `AppState` 接口新增三个辩论历史 actions 签名**

在 `src/renderer/src/store/appStore.ts`，找到 `resetDebate` 签名（约 272 行）：

```ts
  resetDebate: () => void
```

在其后追加：

```ts
  // 辩论历史：按 round upsert 一轮发言（同轮第二次调用补齐 opponent，不覆盖 proponent）
  appendDebateTurnToHistory: (conversationId: string, record: DebateTurnRecord) => void
  // 辩论结束：写两 slot 最终 URL + updatedAt
  finalizeDebateHistory: (conversationId: string, slotUrls: Record<number, string>) => void
  // 恢复历史：把落库的 debateTurns 反序列化回运行态 debateState（phase='finished'，只读浏览）
  restoreDebateState: (input: { topic: string; totalRounds: number; debateTurns: DebateTurnRecord[] }) => void
```

- [ ] **Step 2: 在 store 实现区新增三个 actions 实现**

在 `src/renderer/src/store/appStore.ts`，找到 `resetDebate` 实现（约 787-789 行）：

```ts
  resetDebate: () => set((s) => ({
    debateState: { phase: 'idle', topic: '', totalRounds: s.debateTotalRounds, currentRound: 0, currentTurn: 0, rounds: [] }
  })),
```

在其后追加（与 `resetDebate` 同级缩进）：

```ts
  appendDebateTurnToHistory: (conversationId, record) => set((state) => {
    const item = state.history.find(h => h.id === conversationId)
    if (!item) return {} // 会话不存在（半成品/被删），静默丢弃
    const existing = item.debateTurns ?? []
    const idx = existing.findIndex(t => t.round === record.round)
    let nextTurns: DebateTurnRecord[]
    if (idx === -1) {
      nextTurns = [...existing, record]
    } else {
      // upsert：补齐另一方，不覆盖已有方
      const prev = existing[idx]
      nextTurns = existing.slice()
      nextTurns[idx] = {
        round: record.round,
        proponent: record.proponent ?? prev.proponent,
        opponent: record.opponent ?? prev.opponent,
      }
    }
    const newHistory = state.history.map(h =>
      h.id === conversationId ? { ...h, debateTurns: nextTurns, updatedAt: Date.now() } : h
    )
    if (window.api?.storeSet) window.api.storeSet('history', newHistory)
    return { history: newHistory }
  }),

  finalizeDebateHistory: (conversationId, slotUrls) => set((state) => {
    const newHistory = state.history.map(h =>
      h.id === conversationId ? { ...h, slotUrls, updatedAt: Date.now() } : h
    )
    if (window.api?.storeSet) window.api.storeSet('history', newHistory)
    return { history: newHistory }
  }),

  restoreDebateState: ({ topic, totalRounds, debateTurns }) => set((s) => {
    // 落库结构 -> 运行态 DebateRound（只取文本，丢弃 modelId/timestamp）
    const rounds: DebateRound[] = debateTurns
      .slice().sort((a, b) => a.round - b.round)
      .map(t => ({ proponent: t.proponent?.speech, opponent: t.opponent?.speech }))
    const lastRound = debateTurns.length > 0
      ? Math.max(...debateTurns.map(t => t.round))
      : -1
    return {
      debateState: {
        phase: 'finished',
        topic,
        totalRounds,
        currentRound: lastRound + 1,
        currentTurn: 0,
        rounds,
      }
    }
  }),
```

- [ ] **Step 3: lint + build（先验证 store 自身无误）**

Run: `npm run lint`
Expected: 无错误。

Run: `npm run build`
Expected: 通过。

- [ ] **Step 4: Commit（store 侧）**

```bash
git add src/renderer/src/store/appStore.ts
git commit -m "feat(history): add debate persist actions (append/finalize/restore)"
```

- [ ] **Step 5: 在 `useDebateRunner` 顶部加 conversationId ref**

在 `src/renderer/src/hooks/useDebateRunner.ts`，找到（10-12 行）：

```ts
  const abortRef = useRef(false)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
```

改为：

```ts
  const abortRef = useRef(false)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const conversationIdRef = useRef<string | null>(null)
```

- [ ] **Step 6: 在 `useDebateRunner` 顶部 import `waitForSavableUrl`**

在 `src/renderer/src/hooks/useDebateRunner.ts`，找到（1-3 行）：

```ts
import { useRef, useCallback, useEffect } from 'react'
import { useAppStore } from '../store/appStore'
import { buildDebatePrompt } from '../utils/debatePrompts'
```

改为：

```ts
import { useRef, useCallback, useEffect } from 'react'
import { useAppStore, waitForSavableUrl } from '../store/appStore'
import { buildDebatePrompt } from '../utils/debatePrompts'
```

- [ ] **Step 7: 抽出"取两 slot 最终 URL"的小工具**

在 `src/renderer/src/hooks/useDebateRunner.ts`，找到 `clearTimer` 函数（13-15 行）：

```ts
  const clearTimer = () => {
    if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null }
  }
```

在其后追加（组件内函数）：

```ts
  // 采集两 slot 的最终 URL（按 slotIndex，避开同 modelId 冲突）
  const collectSlotUrls = async (): Promise<Record<number, string>> => {
    const { webviewRefs, debateSlots, models } = useAppStore.getState()
    const result: Record<number, string> = {}
    for (const slotIndex of [0, 1] as const) {
      const ref = webviewRefs.get(`slot-${slotIndex}`)
      const modelId = debateSlots[slotIndex]
      if (!ref || !modelId) continue
      try {
        const savable = await waitForSavableUrl(modelId, ref)
        if (savable) result[slotIndex] = savable
      } catch { /* 忽略 */ }
    }
    return result
  }
```

- [ ] **Step 8: `start` 时调用 `beginConversation` 并存 conversationId**

在 `src/renderer/src/hooks/useDebateRunner.ts`，找到 `start`（约 86-97 行）：

```ts
  const start = useCallback((topic: string) => {
    if (!topic.trim()) return
    abortRef.current = false
    clearTimer()
    const store = useAppStore.getState()
    store.setDebateTopic(topic)
    // 重置回合
    useAppStore.setState((s) => ({
      debateState: { ...s.debateState, phase: 'running', currentRound: 0, currentTurn: 0, rounds: [], totalRounds: s.debateTotalRounds }
    }))
    runNextTurn()
  }, [runNextTurn])
```

改为（同步签名不变，但内部 fire-and-forget 调 `beginConversation`）：

```ts
  const start = useCallback((topic: string) => {
    if (!topic.trim()) return
    abortRef.current = false
    clearTimer()
    const store = useAppStore.getState()
    store.setDebateTopic(topic)
    // 重置回合
    useAppStore.setState((s) => ({
      debateState: { ...s.debateState, phase: 'running', currentRound: 0, currentTurn: 0, rounds: [], totalRounds: s.debateTotalRounds }
    }))
    // 创建/续写历史会话（异步，不阻塞首轮流转）
    void (async () => {
      const { webviewRefs, debateSlots, displayMode } = useAppStore.getState()
      const currentUrls: Record<string, string> = {}
      for (const slotIndex of [0, 1] as const) {
        const ref = webviewRefs.get(`slot-${slotIndex}`)
        const modelId = debateSlots[slotIndex]
        if (!ref || !modelId) continue
        try {
          const url = ref.getCurrentUrl()
          if (url && url !== 'about:blank') currentUrls[modelId] = url
        } catch { /* 忽略 */ }
      }
      const successModelIds = debateSlots.filter(Boolean) as string[]
      const { conversationId } = await useAppStore.getState().beginConversation({
        successModelIds,
        currentUrls,
        productMode: 'debate',
        displayMode: displayMode === 'two' ? 'two' : 'two',
      })
      conversationIdRef.current = conversationId
    })()
    runNextTurn()
  }, [runNextTurn])
```

> `displayMode === 'two' ? 'two' : 'two'` 是占位写法保留语义：辩论模式 displayMode 恒为 `'two'`（`appStore.ts:799` 强制约束）。如 lint 报冗余，直接写 `displayMode: 'two'`。

- [ ] **Step 9: 每轮发言拉取成功后写 `debateTurns`**

在 `src/renderer/src/hooks/useDebateRunner.ts`，找到发言拉取成功处（约 67-77 行）：

```ts
    const speech = await store.getResponseFromSlot(slotIndex, 120000, baseline)
    if (abortRef.current || useAppStore.getState().debateState.phase !== 'running') return

    // 空回复（超时未出现新回复或未稳定）→ 中止辩论，不再写占位回合继续推进
    if (!speech || !speech.trim()) {
      store.setDebatePhase('finished')
      return
    }

    store.appendDebateSpeech(currentRound, currentTurn, speech)
    store.advanceDebateTurn()
```

改为（在 `appendDebateSpeech` 之后补写历史）：

```ts
    const speech = await store.getResponseFromSlot(slotIndex, 120000, baseline)
    if (abortRef.current || useAppStore.getState().debateState.phase !== 'running') return

    // 空回复（超时未出现新回复或未稳定）→ 中止辩论，不再写占位回合继续推进
    if (!speech || !speech.trim()) {
      store.setDebatePhase('finished')
      return
    }

    store.appendDebateSpeech(currentRound, currentTurn, speech)
    store.advanceDebateTurn()

    // 落库本轮发言（按 round upsert；currentTurn=0 写 proponent，=1 写 opponent）
    const cid = conversationIdRef.current
    if (cid) {
      const modelId = useAppStore.getState().debateSlots[slotIndex]
      const record: import('../store/appStore').DebateTurnRecord = {
        round: currentRound,
        ...(currentTurn === 0
          ? { proponent: { modelId, speech, timestamp: Date.now() } }
          : { opponent: { modelId, speech, timestamp: Date.now() } }),
      }
      useAppStore.getState().appendDebateTurnToHistory(cid, record)
    }
```

> 用 `import('../store/appStore').DebateTurnRecord` 内联类型注解避免在文件顶部再加 import 行；如已在顶部 import 了该类型，直接用裸名 `DebateTurnRecord`。二选一，保持与文件既有风格一致。`modelId` 此处一定有值（slotIndex 由 `currentTurn` 来，且辩论两 slot 必须已配置才会 running），但 TS 可能需 `modelId!`，按 lint 调整。

- [ ] **Step 10: 辩论结束时 `finalizeDebateHistory`**

辩论结束有多个路径：跑完所有轮（`currentRound >= totalRounds` → `setDebatePhase('finished')`，约 45-48 行）、空回复中止（上面那段）、外部 `stop`。最稳妥的做法是在 `useDebateRunner` 暴露的 `stop`/`reset` 与 `runNextTurn` 内"phase 转 finished"后统一兜底。

在 `src/renderer/src/hooks/useDebateRunner.ts`，找到 `stop`（约 115-121 行）：

```ts
  const stop = useCallback(() => {
    const store = useAppStore.getState()
    if (store.debateState.phase === 'idle' || store.debateState.phase === 'finished') return
    abortRef.current = true
    clearTimer()
    store.setDebatePhase('finished')
  }, [])
```

改为：

```ts
  const stop = useCallback(() => {
    const store = useAppStore.getState()
    if (store.debateState.phase === 'idle' || store.debateState.phase === 'finished') return
    abortRef.current = true
    clearTimer()
    store.setDebatePhase('finished')
    void finalizeDebateHistory()
  }, [])
```

并新增 `finalizeDebateHistory` 内部函数（放在 `collectSlotUrls` 之后）：

```ts
  // 辩论结束兜底：采集两 slot 最终 URL 写入历史
  const finalizeDebateHistory = async () => {
    const cid = conversationIdRef.current
    if (!cid) return
    const slotUrls = await collectSlotUrls()
    useAppStore.getState().finalizeDebateHistory(cid, slotUrls)
    conversationIdRef.current = null
  }
```

> `runNextTurn` 里 `currentRound >= totalRounds` 与空回复两条 `setDebatePhase('finished')` 路径也需调 `finalizeDebateHistory`。因 `runNextTurn` 是 `useCallback` 且依赖闭包，最简做法：在那两处 `store.setDebatePhase('finished')` 之后各加 `void finalizeDebateHistoryRef.current()`，并把 `finalizeDebateHistory` 存进 ref。

- [ ] **Step 11: 让 `runNextTurn` 内的两条结束路径也调 finalize**

在 `src/renderer/src/hooks/useDebateRunner.ts`，`runNextTurn` 开头加 ref（在 `clearTimer` 定义之后追加）：

```ts
  const finalizeDebateHistoryRef = useRef<() => void>(() => {})
```

并把 Step 10 新增的 `finalizeDebateHistory` 函数改为普通 `const`，再用 effect 同步到 ref：

```ts
  const finalizeDebateHistory = async () => {
    const cid = conversationIdRef.current
    if (!cid) return
    const slotUrls = await collectSlotUrls()
    useAppStore.getState().finalizeDebateHistory(cid, slotUrls)
    conversationIdRef.current = null
  }
  useEffect(() => { finalizeDebateHistoryRef.current = finalizeDebateHistory })
```

> `useEffect` 已在文件顶部 import（`useEffect` 见 1 行）。如未 import，补 import。

然后在 `runNextTurn` 的两处 `store.setDebatePhase('finished')` 后各加一行：

- 跑完所有轮处（约 45-48 行）：

```ts
    if (currentRound >= totalRounds) {
      store.setDebatePhase('finished')
      void finalizeDebateHistoryRef.current()
      return
    }
```

- 空回复处：

```ts
    if (!speech || !speech.trim()) {
      store.setDebatePhase('finished')
      void finalizeDebateHistoryRef.current()
      return
    }
```

- [ ] **Step 12: lint + build**

Run: `npm run lint`
Expected: 无错误。

Run: `npm run build`
Expected: 通过。

- [ ] **Step 13: Commit**

```bash
git add src/renderer/src/hooks/useDebateRunner.ts
git commit -m "feat(debate): persist debate turns & final slot URLs into history"
```

---

## Task 5: 历史恢复 — 辩论分支

**Files:**
- Modify: `src/renderer/src/pages/MainPage.tsx:861-930` 区（`onSelectHistory`）

**Interfaces:**
- Consumes: `restoreDebateState`（Task 4）、`setProductMode`、`setDisplayMode`、`setActiveModels`、`debateSlots`、`setDebateSlots`（如存在；否则用 `setActiveModels` 兜底）。
- Produces: 点开辩论历史 → 切模式 + 加载两 slot URL + 重填 `debateState`。

- [ ] **Step 1: 确认 `setDebateSlots` 是否存在**

Run（在仓库根）: `grep -n "setDebateSlots" src/renderer/src/store/appStore.ts`
Expected: 若有签名与实现，记录行号；若无，恢复时用 `useAppStore.setState({ debateSlots: [...] })` 兜底。本计划假设用 `setState` 兜底（更通用，不依赖未确认 action）。

- [ ] **Step 2: 在 `onSelectHistory` 内、URL 加载前新增辩论分支**

在 `src/renderer/src/pages/MainPage.tsx`，找到 `onSelectHistory` 内"3. 如果有保存的 URL，自动加载"注释（约 932 行）的**正上方**（即"3. 检查并切换模型到当前视图"那段 `}` 之后），插入辩论专用恢复逻辑。

定位锚点（约 930 行附近，`missingModelIds` 处理块结束的 `}` 之后、"3. 如果有保存的 URL"注释之前）：

```ts
            } else {
              setMultiAiSlots(newOrder)
            }
          }

          // 3. 如果有保存的 URL，自动加载
```

在 `}` 与 `// 3.` 之间插入：

```ts
          // —— 辩论模式专用恢复：重填 debateState + 按 slotIndex 加载 URL ——
          if (targetProductMode === 'debate' && item.debateTurns) {
            // 恢复两 slot 模型
            useAppStore.setState({ debateSlots: [item.models[0], item.models[1]] as [string, string] })
            // 重填辩论面板（只读浏览，phase='finished'）
            useAppStore.getState().restoreDebateState({
              topic: item.title ?? '',
              totalRounds: item.debateTurns.length,
              debateTurns: item.debateTurns,
            })
            // 按 slotUrls 加载两 slot（若辩论未 finalize 则 slotUrls 缺失，跳过 URL 加载）
            if (item.slotUrls) {
              setTimeout(() => {
                for (const slotIndex of [0, 1] as const) {
                  const url = item.slotUrls?.[slotIndex]
                  if (!url) continue
                  const ref = useAppStore.getState().webviewRefs.get(`slot-${slotIndex}`)
                  if (ref) ref.loadURL(url)
                }
              }, 0)
            }
            return // 辩论恢复不走下方普通 URL 加载
          }
```

> `return` 提前跳出，避免辩论条目再走普通 `item.urls` 加载（辩论 URL 在 `slotUrls`，不在 `urls`）。`setTimeout(0)` 保证模型/槽位切换后 webview ref 已注册——与下方普通 URL 加载的 `setTimeout` 同策略（约 934 行）。

- [ ] **Step 3: lint + build**

Run: `npm run lint`
Expected: 无错误。

Run: `npm run build`
Expected: 通过。

- [ ] **Step 4: Commit**

```bash
git add src/renderer/src/pages/MainPage.tsx
git commit -m "feat(history): restore debate panel & slot URLs from history"
```

---

## Task 6: 历史列表展示辩论条目

**Files:**
- Modify: `src/renderer/src/components/HistoryDrawer.tsx:328`（标题）、`364`（轮次）

**Interfaces:**
- Consumes: `HistoryItem.debateTurns`、`HistoryItem.title`。
- Produces: 辩论条目用辩题作标题、`debateTurns.length` 作轮数。

- [ ] **Step 1: 修改标题渲染，辩论条目用辩题**

在 `src/renderer/src/components/HistoryDrawer.tsx`，找到（约 328 行）：

```tsx
                            {item.title ?? item.turns[0]?.userMessage ?? '(无消息)'}
```

改为：

```tsx
                            {item.title
                              ?? (item.debateTurns && item.debateTurns.length > 0
                                ? `辩论：${item.debateTurns[0].proponent?.speech ?? ''}`.slice(0, 60)
                                : item.turns[0]?.userMessage)
                              ?? '(无消息)'}
```

> 辩论标题暂用"辩论：首句截断"。`item.title` 在 Task 5 恢复时设为辩题，但新建辩论历史时 `beginConversation` 未设 `title`——历史里 `title` 为 `undefined`，落到 `debateTurns` 兜底。后续可由用户重命名。

- [ ] **Step 2: 修改轮次渲染，辩论条目用 `debateTurns.length`**

在 `src/renderer/src/components/HistoryDrawer.tsx`，找到（约 364 行）：

```tsx
                              <span className="text-gray-600">{item.turns.length} 轮</span>
```

改为：

```tsx
                              <span className="text-gray-600">
                                {item.productMode === 'debate' && item.debateTurns
                                  ? `${item.debateTurns.length} 轮辩论`
                                  : `${item.turns.length} 轮`}
                              </span>
```

- [ ] **Step 3: 同步修改重命名按钮的兜底标题**

同文件约 335 行：

```tsx
                                    openRename('conversation', item.id, item.title ?? item.turns[0]?.userMessage ?? '')
```

改为：

```tsx
                                    openRename('conversation', item.id, item.title
                                      ?? (item.debateTurns && item.debateTurns.length > 0
                                        ? `辩论：${item.debateTurns[0].proponent?.speech ?? ''}`.slice(0, 60)
                                        : item.turns[0]?.userMessage)
                                      ?? '')
```

- [ ] **Step 4: lint + build**

Run: `npm run lint`
Expected: 无错误。

Run: `npm run build`
Expected: 通过。

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/components/HistoryDrawer.tsx
git commit -m "feat(history): render debate entries with topic & round count"
```

---

## Task 7: 端到端手动验证

**Files:** 无（验证任务）

- [ ] **Step 1: 启动 dev**

Run: `npm run dev`
Expected: 桌面窗口打开，无控制台报错。

- [ ] **Step 2: 普通模式回归（防 `beginConversation` 抽取破坏）**

操作：多 AI 模式 → 输入消息发送 → 再发一条（续写同一对话）→ 打开历史 → 点开**非首位**历史条目 → 再发一条。
Expected: 历史出现条目；续写不串台；恢复非首位后续写落到正确条目（`currentConversationId` 锚点路径）。

- [ ] **Step 3: 任务分配模式**

操作：切到任务分配模式 → 输入总目标拆解 → 编辑子任务 → 一键派发 → 等各 slot AI 回复完成 → 打开历史。
Expected: 历史出现 `task_assignment` 条目，标题为派发文本；点开恢复后 turns 里能看到各 slot 回复。

- [ ] **Step 4: 辩论模式（同模型双 slot）**

操作：切到辩论模式 → 两 slot 选同一模型 → 输入辩题 → 跑完所有轮 → 打开历史。
Expected: 历史出现 `debate` 条目，标题含辩题，副标题"X 轮辩论"；点开 → 面板重填各轮发言（只读，phase=finished）+ 两 slot 加载最终 URL。

- [ ] **Step 5: 辩论半成品**

操作：辩论跑到一半 → 关闭窗口 → 重开 dev → 打开历史。
Expected: 历史有辩论条目（`debateTurns` 已落盘但 `slotUrls` 缺失）；点开能只读浏览已发言轮次，不加载 URL（slotUrls 缺失，跳过）。

- [ ] **Step 6: 任务分配部分失败**

操作：任务分配模式下，手动让一个 slot 的 webview 处于不可发送状态（如加载到非对话页）→ 派发。
Expected: 历史只记录成功 slot；失败 slot 不进历史。

- [ ] **Step 7: 记录验证结果**

如全部通过，在 `SESSION_LOG.md` 由 `session_log.py` 落一条；如有失败，记 `--unresolved`。命令：

```bash
python .memory/session_log.py --done "任务分配与辩论模式历史持久化实现并验证" --modified "src/renderer/src/store/appStore.ts" "src/renderer/src/components/modes/TaskModePanel.tsx" "src/renderer/src/hooks/useDebateRunner.ts" "src/renderer/src/pages/MainPage.tsx" "src/renderer/src/components/HistoryDrawer.tsx" --context "spec: docs/superpowers/specs/2026-07-05-modes-history-persist-design.md"
```

> 如终端输出"Consider promoting stable lessons…"，按 `AGENTS.md` 把高价值经验写进 `.memory/KNOWLEDGE.md` 并把对应 `- lesson:` 改成 `- lesson(promoted):`。

---

## Self-Review 结果

**1. Spec 覆盖：**
- spec §5.1 类型扩展 → Task 1 ✅
- spec §5.2 `beginConversation` 原语 → Task 2 ✅
- spec §5.3 任务分配数据流 → Task 3 ✅
- spec §5.4 辩论数据流（开始/发言后/结束）→ Task 4 ✅
- spec §5.5 恢复逻辑（debate 分支）→ Task 5 ✅；任务分配恢复走现有路径，spec 明示无需特殊处理，Task 5 注释已说明 ✅
- spec §5.6 HistoryDrawer 展示 → Task 6 ✅
- spec §6 边界（半成品/部分失败/同 model 双 slot）→ Task 7 Step 4/5/6 覆盖 ✅
- spec §8 验证清单 → Task 7 ✅

**2. 占位符扫描：** 无 TBD/TODO；每步含具体代码或具体命令。

**3. 类型一致性：**
- `DebateTurnRecord`：Task 1 定义，Task 4 Step 2/9 使用，签名一致 ✅
- `beginConversation`：Task 2 定义签名 `-> Promise<{ conversationId, isNew, lastItem }>`，Task 3/4 解构 `{ conversationId }`，一致 ✅
- `appendDebateTurnToHistory` / `finalizeDebateHistory` / `restoreDebateState`：Task 4 Step 1 签名与 Step 2 实现一致；Task 4 Step 9 调 `appendDebateTurnToHistory`、Task 5 调 `restoreDebateState` 一致 ✅
- `slotUrls: Record<number, string>`：Task 1 定义、Task 4 Step 2 写、Task 5 读，一致 ✅
