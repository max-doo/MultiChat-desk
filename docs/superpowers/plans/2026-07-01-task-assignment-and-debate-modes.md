# 任务分配模式 & 辩论模式 实现计划

> Created: 2026-07-01 21:33 (本地时间)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 MultiChat Desk 中落地两种新生产模式——任务分配（拆解→编辑→指派→一键发送）与辩论（左正方/右反方、全自动轮转、固定双窗、保留裁判评析总结），交互完全对齐已定稿的 `docs/mode-design-mock.html`。

**Architecture:** 渲染层引入两个模式专属的 ControlBar 中段渲染分支（任务模式：输入框保持原始 query + 上拉可编辑子任务弹层 + 拆解/发送按钮形态切换；辩论模式：左侧固定轮次 stepper + 输入框只负责主题 + 进行中圆点带横向滚动 + 右侧固定暂停/终止按钮），状态机托管在 `appStore` 中。主进程复用现有 `generate-summary` IPC 与 `summaryApi` 实现任务拆解（同一供应商、非流式单次返回 JSON）。辩论轮转通过新增的 store 单槽位发送 action 驱动两个已挂载 webview（`slot-0` 正方 / `slot-1` 反方），发言内容回传后构造对手发言作为下一轮 prompt。

**Tech Stack:** TypeScript (strict), React 18, Zustand 4, Tailwind CSS 3, Electron 28 IPC, Material Symbols, electron-vite。

## Global Constraints

- 包管理器只用 `npm`，禁止 yarn/pnpm。
- 严格 TypeScript，禁止 `any` 静默错误；故意未用变量以 `_` 前缀标记。
- IPC 契约四端同步：`src/main/ipcHandlers.ts` + `src/preload/index.ts` + `src/preload/index.d.ts` + 渲染层调用点；返回结构统一 `{ success, data?, error? }`。
- 分层边界：任务拆解请求落在 `src/main`；`src/preload` 仅桥接；UI/状态机/轮转逻辑落在 `src/renderer`。
- Webview 自动化复用现有 `webviewRefs.get('slot-<index>')` 与 `WebviewCardRef`（`sendMessage` / `insertText` / `getLatestResponse` / `clearInput`），不新增注入脚本、不改 `selectors.ts`。
- 辩论固定双窗：`productMode === 'debate'` 时 `displayMode` 锁 `two`、窗口数量分段控件禁用（Layout.tsx 已实现）。
- 不得顺手重构无关文件；每个任务结束跑 `npm run lint` + `npm run build`，最终在 `npm run dev` 手动验证。
- 颜色/玻璃态 token 复用现有：`glass-panel` / `glass-panel-heavy` / `shadow-soft` / `shadow-float` / `text-primary` / `text-secondary` / `bg-primary`，不新引设计变量。
- 输入框固定高度：辩论与任务模式中段面板高度恒定 96px（padding 12×2 + textarea 72px），轮次/子任务溢出仅在面板内横向滚动，不撑高、不撑爆窗口。
- 时间戳必须用终端 `Get-Date`/`date` 取真实时间，不得凭记忆捏造。
- 任何对外或难逆操作（提交、推送、打包）前需用户确认；本计划仅覆盖代码实现，提交信息遵循 Conventional Commits。

---

## 文件结构总览

**新增文件：**
- `src/main/api/taskSplitApi.ts` — 任务拆解请求与 JSON 解析（复用 `summaryApi` 的请求构造思路，非流式）。
- `src/main/config/taskSplitPrompt.ts` — 拆解系统提示词常量（要求输出严格 JSON 数组）。
- `src/renderer/src/components/modes/TaskModePanel.tsx` — 任务模式 ControlBar 中段（输入框 + 上拉子任务弹层 + 拆解/发送/取消按钮）。
- `src/renderer/src/components/modes/DebateModePanel.tsx` — 辩论模式 ControlBar 中段（轮次 stepper + 主题输入 / 进行中圆点 + 暂停/终止）。
- `src/renderer/src/components/modes/SubtaskList.tsx` — 子任务列表项（可编辑文本 + 模型指派 cycle + 删除 + 新增）。
- `src/renderer/src/hooks/useTaskSplit.ts` — 封装拆解 IPC 调用与加载/错误状态。
- `src/renderer/src/hooks/useDebateRunner.ts` — 辩论状态机驱动（start/pause/resume/stop/reset + 轮转调度）。

**修改文件：**
- `src/renderer/src/store/appStore.ts` — 新增 `debateSlots`、`debateTotalRounds`、`debateState`（phase/topic/rounds/...）、`taskState`（phase/query/subtasks/collapsed）、单槽位发送 action `sendToSlot` / `insertTextToSlot` / `getResponseFromSlot`。
- `src/renderer/src/components/ControlBar.tsx` — 中段按 `productMode` 分流到 `TaskModePanel` / `DebateModePanel`；功能组（生图/深度研究）在辩论模式下隐藏。
- `src/main/ipcHandlers.ts` — 新增 `split-task` IPC handler（调用 `taskSplitApi`，复用 `currentSummaryAbortController` 思路支持中止）。
- `src/preload/index.ts` + `src/preload/index.d.ts` — 暴露 `splitTask` 与 `abortSplitTask`。
- `src/renderer/src/config/selectors.ts` — **不改**（辩论轮转用现成 send/response，无需新选择器）。仅当验证发现某平台回复抓取不稳时再增量补选择器，作为 follow-up。

**职责边界：** 每个文件单一职责——`taskSplitApi` 只管 HTTP+解析；`taskSplitPrompt` 只管提示词；`TaskModePanel`/`DebateModePanel` 只管渲染与事件分发；`useDebateRunner` 只管状态机与时序；store 只管状态与 webview 编排。模式组件不直接 fetch，全部走 hooks/store。

---

## Task 1: 任务拆解后端 —— IPC + API + 提示词

**Files:**
- Create: `src/main/config/taskSplitPrompt.ts`
- Create: `src/main/api/taskSplitApi.ts`
- Modify: `src/main/ipcHandlers.ts`（新增 `split-task` 与 `abort-split-task` handler，复用 `currentSummaryAbortController`）
- Modify: `src/preload/index.ts`（暴露 `splitTask` / `abortSplitTask`）
- Modify: `src/preload/index.d.ts`（类型声明）

**Interfaces:**
- Consumes: 复用 `summaryApi.ts` 的 `buildRequestBody`? 否——拆解无需三明治上下文，直接构造 OpenAI 兼容 chat/completions 请求体。消费 `ApiConfig.activeProviderId` / `providers` / `summaryModels`（由渲染层解析后传入 apiKey/baseUrl/model）。
- Produces: `window.api.splitTask(params) => Promise<{ success; data?: TaskSubtask[]; error? }>`，`TaskSubtask = { text: string; suggestedModelId?: string }`；`window.api.abortSplitTask() => Promise<{ success; error? }>`。

- [ ] **Step 1: 写拆解提示词常量**

Create `src/main/config/taskSplitPrompt.ts`:

```ts
/**
 * 任务拆解系统提示词
 * 要求模型将用户目标拆解为可独立分配给不同 AI 的子任务，输出严格 JSON。
 */
export const TASK_SPLIT_SYSTEM_PROMPT = `你是一个任务拆解助手。用户会给出一个总目标，你需要把它拆解成若干个可以分别交给不同 AI 平台并行处理的独立子任务。

规则：
1. 子任务数量在 2 到 6 之间，依据目标复杂度合理拆分。
2. 每个子任务必须自带足够上下文，能脱离原目标独立理解（即把必要的背景写进子任务文本里）。
3. 子任务之间尽量互不依赖，可并行执行。
4. 只输出 JSON，禁止输出任何解释、markdown 代码块或多余文字。

输出格式（严格 JSON 数组）：
[
  { "text": "子任务1的完整描述" },
  { "text": "子任务2的完整描述" }
]`

/** 从模型输出中提取 JSON 子任务数组（容忍代码块包裹与前后多余文字） */
export function parseSubtasks(raw: string): { text: string; suggestedModelId?: string }[] {
  let s = (raw || '').trim()
  // 去除 ```json ... ``` 包裹
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/i)
  if (fence) s = fence[1].trim()
  // 截取第一个 [ 到最后一个 ]
  const start = s.indexOf('[')
  const end = s.lastIndexOf(']')
  if (start === -1 || end === -1 || end <= start) return []
  const slice = s.slice(start, end + 1)
  try {
    const arr = JSON.parse(slice) as unknown
    if (!Array.isArray(arr)) return []
    return arr
      .map((item) => {
        if (typeof item === 'string') return { text: item }
        if (item && typeof item === 'object' && typeof (item as any).text === 'string') {
          return { text: (item as any).text, suggestedModelId: (item as any).suggestedModelId }
        }
        return null
      })
      .filter((x): x is { text: string; suggestedModelId?: string } => !!x && x.text.trim().length > 0)
  } catch {
    return []
  }
}
```

> 注：`parseSubtasks` 内的 `(item as any)` 是对未定型外部 JSON 的解析收口，属合理边界；ESLint 的 `no-explicit-any` 会告警——在 Task 1 lint 步骤用 `// eslint-disable-next-line @typescript-eslint/no-explicit-any` 抑制（项目已有该规则告警先例）。

- [ ] **Step 2: 写拆解 API 模块**

Create `src/main/api/taskSplitApi.ts`:

```ts
/**
 * Task Split API
 * 复用 OpenAI 兼容端点做一次性（非流式）任务拆解。
 */
import { TASK_SPLIT_SYSTEM_PROMPT, parseSubtasks } from '../config/taskSplitPrompt'

export interface SplitTaskParams {
  apiKey: string
  baseUrl?: string
  model: string
  goal: string
  temperature?: number
  maxTokens?: number
}

export interface SplitTaskResult {
  success: boolean
  data?: Array<{ text: string; suggestedModelId?: string }>
  error?: string
  aborted?: boolean
}

export async function splitTask(
  params: SplitTaskParams,
  signal: AbortSignal
): Promise<SplitTaskResult> {
  const goal = (params.goal || '').trim()
  if (!goal) return { success: false, error: '目标不能为空' }

  const baseUrl = (params.baseUrl || 'https://api.openai.com/v1').replace(/\/+$/, '')
  const apiUrl = `${baseUrl}/chat/completions`

  const body = {
    model: params.model,
    messages: [
      { role: 'system', content: TASK_SPLIT_SYSTEM_PROMPT },
      { role: 'user', content: `请拆解以下目标：\n\n${goal}` }
    ],
    temperature: params.temperature ?? 0.4,
    max_tokens: params.maxTokens ?? 1500,
    stream: false
  }

  try {
    const resp = await fetch(apiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${params.apiKey}`
      },
      body: JSON.stringify(body),
      signal
    })
    if (!resp.ok) {
      const text = await resp.text().catch(() => '')
      return { success: false, error: `拆解请求失败 (${resp.status}): ${text.slice(0, 200)}` }
    }
    const json = (await resp.json()) as { choices?: Array<{ message?: { content?: string } }> }
    const content = json.choices?.[0]?.message?.content || ''
    const subtasks = parseSubtasks(content)
    if (subtasks.length === 0) {
      return { success: false, error: '模型未返回有效子任务 JSON' }
    }
    return { success: true, data: subtasks }
  } catch (err) {
    if (signal.aborted) return { success: false, aborted: true, error: '已中止' }
    return { success: false, error: String(err) }
  }
}
```

- [ ] **Step 3: 在 ipcHandlers.ts 注册 handler**

Modify `src/main/ipcHandlers.ts`：在 `import { generateSummary, fetchModels } from './api/summaryApi'` 下方新增 import，并在 `abort-summary` / `generate-summary` handler 附近新增两个 handler。

新增 import 行（紧邻第 11 行 `generateSummary` import）：

```ts
import { splitTask } from './api/taskSplitApi'
```

在 `generate-summary` handler 块之后（约第 613 行后）插入：

```ts
    // IPC 处理器：任务拆解（复用总结的 AbortController 以支持中止）
    ipcMain.handle('split-task', async (_event, params: {
        apiKey: string
        baseUrl?: string
        model: string
        goal: string
        temperature?: number
        maxTokens?: number
    }) => {
        currentSummaryAbortController = new AbortController()
        const { signal } = currentSummaryAbortController
        try {
            const result = await splitTask(params, signal)
            currentSummaryAbortController = null
            return result
        } catch (error) {
            currentSummaryAbortController = null
            throw error
        }
    })

    // IPC 处理器：中止任务拆解
    ipcMain.handle('abort-split-task', async () => {
        if (currentSummaryAbortController) {
            currentSummaryAbortController.abort()
            currentSummaryAbortController = null
            return { success: true }
        }
        return { success: false, error: '没有正在进行的拆解请求' }
    })
```

> 复用 `currentSummaryAbortController` 是有意为之：拆解与总结不会并发进行，共用一个全局中止器即可，避免多套控制器。如后续需并发，再独立拆分。

- [ ] **Step 4: preload 暴露 API**

Modify `src/preload/index.ts`：在 `abortSummary` / `generateSummary` 的 `ipcRenderer.invoke` 邻近处新增两个方法（保持与现有风格一致）：

```ts
    splitTask: (params, onChunk) => ipcRenderer.invoke('split-task', params),
    abortSplitTask: () => ipcRenderer.invoke('abort-split-task'),
```

> 实际只需 `splitTask: (params) => ipcRenderer.invoke('split-task', params)`，去掉无用的 `onChunk` 形参（拆解非流式）。

Modify `src/preload/index.d.ts`：在 `abortSummary` 声明（约第 76 行）下方新增类型：

```ts
      splitTask: (params: {
        apiKey: string
        baseUrl?: string
        model: string
        goal: string
        temperature?: number
        maxTokens?: number
      }) => Promise<{ success: boolean; data?: Array<{ text: string; suggestedModelId?: string }>; error?: string; aborted?: boolean }>
      abortSplitTask: () => Promise<{ success: boolean; error?: string }>
```

- [ ] **Step 5: lint + build**

Run: `npm run lint`
Expected: 无新增 error（`taskSplitPrompt.ts` 的 `no-explicit-any` 需加 `// eslint-disable-next-line` 抑制，已在 Step 1 注明）

Run: `npm run build`
Expected: 类型检查通过，main/preload 打包成功

- [ ] **Step 6: Commit**

```bash
git add src/main/config/taskSplitPrompt.ts src/main/api/taskSplitApi.ts src/main/ipcHandlers.ts src/preload/index.ts src/preload/index.d.ts
git commit -m "feat: add task split backend (split-task IPC + taskSplitApi)"
```

---

## Task 2: Store 状态机与单槽位发送 action

**Files:**
- Modify: `src/renderer/src/store/appStore.ts`

**Interfaces:**
- Consumes: 现有 `webviewRefs`、`getDisplayedModels`、`models`、`apiConfig`、`summaryModels`。
- Produces: `debateSlots`/`setDebateSlot`、`debateTotalRounds`/`setDebateTotalRounds`、`debateState` + 一组 setter（`setDebatePhase`/`setDebateTopic`/`appendDebateRound`/`resetDebate`）、`taskState` + setter（`setTaskPhase`/`setTaskQuery`/`setTaskSubtasks`/`updateSubtask`/`addSubtask`/`removeSubtask`/`toggleTaskCollapsed`/`resetTask`）、单槽位 action `sendToSlot(slotIndex, message)` / `insertTextToSlot(slotIndex, message)` / `getResponseFromSlot(slotIndex)` / `clearInputOfSlot(slotIndex)`。

- [ ] **Step 1: 定义类型与 state 字段**

在 `appStore.ts` 类型区（`ProductMode`/`DisplayMode` 定义之后，约第 160 行后）新增：

```ts
// 任务分配模式状态机
export type TaskPhase = 'idle' | 'split' | 'sent'
export interface TaskSubtask {
  text: string
  modelId: string // 指派到的模型 id（槽位对应）
}
export interface TaskState {
  phase: TaskPhase
  query: string
  subtasks: TaskSubtask[]
  collapsed: boolean // 子任务弹层是否折叠
}

// 辩论模式状态机
export type DebatePhase = 'idle' | 'running' | 'paused' | 'finished'
export interface DebateRound {
  proponent?: string  // 正方发言
  opponent?: string   // 反方发言
}
export interface DebateState {
  phase: DebatePhase
  topic: string
  totalRounds: number
  currentRound: number // 已完成的全轮数
  currentTurn: 0 | 1   // 0=正方发言中, 1=反方发言中
  rounds: DebateRound[]
}
```

在 `AppState` interface 中新增字段声明（紧邻 `taskAssignmentSlots` 相关声明之后，约第 196 行后）：

```ts
  // 任务分配状态机（不持久化）
  taskState: TaskState
  setTaskPhase: (phase: TaskPhase) => void
  setTaskQuery: (query: string) => void
  setTaskSubtasks: (subtasks: TaskSubtask[]) => void
  updateSubtask: (index: number, patch: Partial<TaskSubtask>) => void
  addSubtask: () => void
  removeSubtask: (index: number) => void
  toggleTaskCollapsed: () => void
  resetTask: () => void

  // 辩论状态机（不持久化）
  debateSlots: [string, string] // [正方 modelId, 反方 modelId]
  setDebateSlot: (side: 0 | 1, modelId: string) => void
  debateTotalRounds: number
  setDebateTotalRounds: (n: number) => void
  debateState: DebateState
  setDebatePhase: (phase: DebatePhase) => void
  setDebateTopic: (topic: string) => void
  appendDebateSpeech: (round: number, turn: 0 | 1, speech: string) => void
  advanceDebateTurn: () => void
  resetDebate: () => void

  // 单槽位 webview 编排（辩论轮转用）
  sendToSlot: (slotIndex: number, message: string) => Promise<{ success: boolean; error?: string }>
  insertTextToSlot: (slotIndex: number, message: string) => Promise<{ success: boolean; error?: string }>
  getResponseFromSlot: (slotIndex: number, timeoutMs?: number) => Promise<string>
  clearInputOfSlot: (slotIndex: number) => Promise<void>
```

- [ ] **Step 2: 写初始值与 setter 实现**

在 store 初始 state 区（`taskAssignmentSlots` 初始值附近，约第 611 行后）新增：

```ts
  taskState: { phase: 'idle', query: '', subtasks: [], collapsed: false },
  setTaskPhase: (phase) => set((s) => ({ taskState: { ...s.taskState, phase } })),
  setTaskQuery: (query) => set((s) => ({ taskState: { ...s.taskState, query } })),
  setTaskSubtasks: (subtasks) => set((s) => ({ taskState: { ...s.taskState, subtasks } })),
  updateSubtask: (index, patch) => set((s) => {
    const subtasks = s.taskState.subtasks.map((st, i) => i === index ? { ...st, ...patch } : st)
    return { taskState: { ...s.taskState, subtasks } }
  }),
  addSubtask: () => set((s) => {
    const enabledModels = s.models.filter(m => m.enabled)
    const fallback = s.models[0]
    const modelId = (enabledModels[s.taskState.subtasks.length % Math.max(1, enabledModels.length)] || fallback)?.id || ''
    return { taskState: { ...s.taskState, subtasks: [...s.taskState.subtasks, { text: '新增子任务', modelId }] } }
  }),
  removeSubtask: (index) => set((s) => ({
    taskState: { ...s.taskState, subtasks: s.taskState.subtasks.filter((_, i) => i !== index) }
  })),
  toggleTaskCollapsed: () => set((s) => ({ taskState: { ...s.taskState, collapsed: !s.taskState.collapsed } })),
  resetTask: () => set({ taskState: { phase: 'idle', query: '', subtasks: [], collapsed: false } }),

  debateSlots: ['chatgpt', 'gemini'],
  setDebateSlot: (side, modelId) => set((s) => {
    const slots = [...s.debateSlots] as [string, string]
    slots[side] = modelId
    return { debateSlots: slots }
  }),
  debateTotalRounds: 3,
  setDebateTotalRounds: (n) => set({ debateTotalRounds: Math.max(1, Math.min(10, Math.floor(n) || 1)) }),
  debateState: { phase: 'idle', topic: '', totalRounds: 3, currentRound: 0, currentTurn: 0, rounds: [] },
  setDebatePhase: (phase) => set((s) => ({ debateState: { ...s.debateState, phase } })),
  setDebateTopic: (topic) => set((s) => ({ debateState: { ...s.debateState, topic } })),
  appendDebateSpeech: (round, turn, speech) => set((s) => {
    const rounds = [...s.debateState.rounds]
    if (!rounds[round]) rounds[round] = {}
    rounds[round] = { ...rounds[round], [turn === 0 ? 'proponent' : 'opponent']: speech }
    return { debateState: { ...s.debateState, rounds } }
  }),
  advanceDebateTurn: () => set((s) => {
    const { currentTurn, currentRound, totalRounds } = s.debateState
    if (currentTurn === 0) {
      return { debateState: { ...s.debateState, currentTurn: 1 } }
    }
    const nextRound = currentRound + 1
    if (nextRound >= totalRounds) {
      return { debateState: { ...s.debateState, currentTurn: 0, currentRound: totalRounds, phase: 'finished' } }
    }
    return { debateState: { ...s.debateState, currentTurn: 0, currentRound: nextRound } }
  }),
  resetDebate: () => set((s) => ({
    debateState: { phase: 'idle', topic: '', totalRounds: s.debateTotalRounds, currentRound: 0, currentTurn: 0, rounds: [] }
  })),
```

- [ ] **Step 3: 写单槽位发送 action**

在 `sendMessageToAll` 实现之后（约第 830 行块之后）新增单槽位版本：

```ts
  sendToSlot: async (slotIndex, message) => {
    const { webviewRefs } = get()
    const ref = webviewRefs.get(`slot-${slotIndex}`)
    if (!ref) return { success: false, error: `slot-${slotIndex} 未注册` }
    try {
      const r = await ref.sendMessage(message)
      return { success: r.success, error: r.error }
    } catch (err) {
      return { success: false, error: String(err) }
    }
  },
  insertTextToSlot: async (slotIndex, message) => {
    const { webviewRefs } = get()
    const ref = webviewRefs.get(`slot-${slotIndex}`)
    if (!ref) return { success: false, error: `slot-${slotIndex} 未注册` }
    try {
      const r = await ref.insertText(message)
      return { success: r.success, error: r.error }
    } catch (err) {
      return { success: false, error: String(err) }
    }
  },
  getResponseFromSlot: async (slotIndex, timeoutMs = 8000) => {
    const { webviewRefs } = get()
    const ref = webviewRefs.get(`slot-${slotIndex}`)
    if (!ref) return ''
    const deadline = Date.now() + timeoutMs
    let last = ''
    // 轮询：等回复稳定（与 monitor 思路一致，但只针对单槽位、轻量）
    while (Date.now() < deadline) {
      const cur = await ref.getLatestResponse().catch(() => '')
      if (cur && cur.trim().length > 0 && cur === last) break
      last = cur
      await new Promise((r) => setTimeout(r, 1000))
    }
    return last
  },
  clearInputOfSlot: async (slotIndex) => {
    const { webviewRefs } = get()
    const ref = webviewRefs.get(`slot-${slotIndex}`)
    if (ref) await ref.clearInput().catch(() => {})
  },
```

- [ ] **Step 4: getDisplayedModels 接入 debateSlots**

修改 `getDisplayedModels`（约第 329 行）：在 `productMode === 'debate'` 分支中按 `debateSlots` 取模型。当前函数签名没有 `debateSlots` 形参，需扩展。修改为：

```ts
export function getDisplayedModels(
  models: ModelConfig[],
  displayMode: DisplayMode,
  productMode?: ProductMode,
  taskAssignmentSlots?: string[],
  multiAiSlots?: string[],
  debateSlots?: [string, string]
): ModelConfig[] {
  let displayCount: number
  if (productMode === 'debate') {
    displayCount = 2
  } else {
    switch (displayMode) {
      case 'one': displayCount = 1; break
      case 'two': displayCount = 2; break
      case 'four': displayCount = 4; break
      case 'three':
      default: displayCount = 3; break
    }
  }

  if (productMode === 'debate' && debateSlots) {
    return Array.from({ length: 2 }, (_, index) => {
      const slotId = debateSlots[index]
      return models.find(m => m.id === slotId) || models[index % models.length]
    })
  }

  if (productMode === 'task_assignment' && taskAssignmentSlots) {
    return Array.from({ length: displayCount }, (_, index) => {
      const slotId = taskAssignmentSlots[index]
      return models.find(m => m.id === slotId) || models[index % models.length]
    })
  }

  if (multiAiSlots) {
    return Array.from({ length: displayCount }, (_, index) => {
      const slotId = multiAiSlots[index]
      return models.find(m => m.id === slotId) || models[index % models.length]
    })
  }

  return models.slice(0, displayCount)
}
```

> `debateSlots` 设为可选形参，避免破坏现有未传该参数的调用点（MainPage/ControlBar 现有调用仍可工作，debate 分支会回退到 `models.slice`）。Task 4 会在 debate 渲染处补传 `debateSlots`。

- [ ] **Step 5: 全量检索 getDisplayedModels 调用点并补 debateSlots**

用 Grep 找到所有 `getDisplayedModels(` 调用点，对 `productMode === 'debate'` 可能出现的调用（MainPage `displayedModels`/`modeModels`/`mountedWebviews` 初始化）补传 `debateSlots`。至少修改 `MainPage.tsx` 中三处：

```ts
const displayedModels = useMemo(() => {
  return getDisplayedModels(models, displayMode, productMode, taskAssignmentSlots, multiAiSlots, debateSlots)
}, [models, displayMode, productMode, taskAssignmentSlots, multiAiSlots, debateSlots])
```

`modeModels` 的 debate 分支：

```ts
debate: getDisplayedModels(models, 'two', 'debate', taskAssignmentSlots, multiAiSlots, debateSlots)
```

`mountedWebviews` 初始化：

```ts
const count = getDisplayedModels(models, displayMode, productMode, taskAssignmentSlots, multiAiSlots, debateSlots).length
```

并在 MainPage 顶部 `useAppStore` 选择器补 `const debateSlots = useAppStore((state) => state.debateSlots)`。

- [ ] **Step 6: setProductMode 联动 debate 锁定**

检查现有 `setProductMode`（约第 590 行附近）——确认切到 debate 时已锁 `displayMode='two'`、`resetPaneRatios()`。若已实现则跳过；若 `multiAiSlots` 初始化逻辑未同步 `debateSlots` 持久化，则补 `window.api.storeSet('debateSlots', slots)` 到 `setDebateSlot`（持久化可选，初版可不持久化，留 follow-up）。

- [ ] **Step 7: lint + build**

Run: `npm run lint && npm run build`
Expected: 通过；`getDisplayedModels` 新增可选参数不破坏旧调用。

- [ ] **Step 8: Commit**

```bash
git add src/renderer/src/store/appStore.ts src/renderer/src/pages/MainPage.tsx
git commit -m "feat: add task/debate state machines and single-slot send actions in appStore"
```

---

## Task 3: useTaskSplit hook —— 拆解调用封装

**Files:**
- Create: `src/renderer/src/hooks/useTaskSplit.ts`

**Interfaces:**
- Consumes: `window.api.splitTask` / `window.api.abortSplitTask`、`apiConfig`（取 activeProvider + lastSelectedAgentId/summaryModels 解析 model）、`useAppStore` 的 `taskState` setter。
- Produces: `useTaskSplit()` => `{ split(goal): Promise<void>; abort(): void; isLoading: boolean; error: string | null }`。

- [ ] **Step 1: 写 hook**

Create `src/renderer/src/hooks/useTaskSplit.ts`:

```ts
import { useState, useCallback, useRef, useEffect } from 'react'
import { useAppStore } from '../store/appStore'

/**
 * 封装任务拆解 IPC：复用总结供应商配置，调用 split-task。
 * 成功后写入 store 的 taskState.subtasks（按槽位顺序指派默认模型）。
 */
export function useTaskSplit() {
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const abortRef = useRef(false)

  const apiConfig = useAppStore((s) => s.apiConfig)
  const summaryModels = useAppStore((s) => s.summaryModels)
  const models = useAppStore((s) => s.models)
  const setTaskSubtasks = useAppStore((s) => s.setTaskSubtasks)
  const setTaskPhase = useAppStore((s) => s.setTaskPhase)
  const toggleTaskCollapsed = useAppStore((s) => s.toggleTaskCollapsed)

  const resolveProvider = useCallback(() => {
    const providerId = apiConfig.activeProviderId
    const provider = apiConfig.providers.find(p => p.id === providerId && p.enabled)
    if (!provider) return null
    // 解析 model：优先 lastSelectedAgentId 对应的 summaryModel，否则取该供应商下第一个 summaryModel
    const agentId = apiConfig.lastSelectedAgentId
    let model = summaryModels.find(m => m.id === agentId && m.providerId === provider.id)?.name
    if (!model) model = summaryModels.find(m => m.providerId === provider.id)?.name
    if (!model) return null
    return { apiKey: provider.apiKey, baseUrl: provider.baseUrl, model }
  }, [apiConfig, summaryModels])

  const split = useCallback(async (goal: string) => {
    if (!goal.trim() || isLoading) return
    const provider = resolveProvider()
    if (!provider) {
      setError('未配置可用的总结 API 供应商，请先在设置中配置')
      return
    }
    setIsLoading(true)
    setError(null)
    abortRef.current = false
    try {
      const result = await window.api.splitTask({
        apiKey: provider.apiKey,
        baseUrl: provider.baseUrl,
        model: provider.model,
        goal,
        temperature: 0.4,
        maxTokens: 1500
      })
      if (abortRef.current) return
      if (!result.success || !result.data) {
        setError(result.error || '拆解失败')
        return
      }
      // 按槽位顺序指派默认模型（启用模型优先）
      const enabled = models.filter(m => m.enabled)
      const subtasks = result.data.map((st, i) => ({
        text: st.text,
        modelId: (enabled[i % Math.max(1, enabled.length)] || models[0])?.id || ''
      }))
      setTaskSubtasks(subtasks)
      setTaskPhase('split')
      // 展开弹层
      if (useAppStore.getState().taskState.collapsed) toggleTaskCollapsed()
    } catch (err) {
      if (!abortRef.current) setError(String(err))
    } finally {
      setIsLoading(false)
    }
  }, [isLoading, resolveProvider, models, setTaskSubtasks, setTaskPhase, toggleTaskCollapsed])

  const abort = useCallback(async () => {
    abortRef.current = true
    await window.api.abortSplitTask()
    setIsLoading(false)
  }, [])

  useEffect(() => () => { abortRef.current = true }, [])

  return { split, abort, isLoading, error }
}
```

- [ ] **Step 2: lint + build**

Run: `npm run lint && npm run build`
Expected: 通过

- [ ] **Step 3: Commit**

```bash
git add src/renderer/src/hooks/useTaskSplit.ts
git commit -m "feat: add useTaskSplit hook for task decomposition IPC"
```

---

## Task 4: 任务模式面板 TaskModePanel + SubtaskList

**Files:**
- Create: `src/renderer/src/components/modes/SubtaskList.tsx`
- Create: `src/renderer/src/components/modes/TaskModePanel.tsx`
- Modify: `src/renderer/src/components/ControlBar.tsx`（中段分流）

**Interfaces:**
- Consumes: `useTaskSplit` hook、`taskState` + setter、`models`、ControlBar 现有 `insertTextToAll`/`sendMessageToAll` 思路（但任务模式需按子任务 modelId 路由到对应槽位——见 Step 3 的 send 实现）。
- Produces: `<TaskModePanel />` 自包含任务模式中段渲染。

> 关键交互（对齐 mock）：idle 阶段输入框可编辑、显示「拆解」按钮；点击拆解后 phase=split，输入框只读仍显示原 query，上方出现可编辑子任务弹层（可折叠，不占垂直高度），「拆解」按钮变「一键发送」；点「取消」回到 idle 可编辑；点「一键发送」后 phase=sent，按子任务 modelId 分组发到各槽位。

- [ ] **Step 1: 写 SubtaskList 组件**

Create `src/renderer/src/components/modes/SubtaskList.tsx`:

```tsx
import { useAppStore, type TaskSubtask } from '../../store/appStore'

interface SubtaskListProps {
  subtasks: TaskSubtask[]
  collapsed: boolean
}

/**
 * 任务模式的子任务上拉列表：每项可编辑文本、cycle 切换指派模型、删除、底部新增。
 * 列表绝对定位在输入框上方（bottom:100%），折叠时不占垂直空间。
 */
function SubtaskList({ subtasks, collapsed }: SubtaskListProps): JSX.Element | null {
  const models = useAppStore((s) => s.models)
  const updateSubtask = useAppStore((s) => s.updateSubtask)
  const removeSubtask = useAppStore((s) => s.removeSubtask)
  const addSubtask = useAppStore((s) => s.addSubtask)
  const toggleTaskCollapsed = useAppStore((s) => s.toggleTaskCollapsed)

  if (collapsed) {
    return (
      <div className="absolute bottom-full left-0 right-0 mb-2 z-40">
        <button
          onClick={toggleTaskCollapsed}
          className="w-full flex items-center justify-between px-4 py-2 rounded-xl glass-panel shadow-float text-sm text-text-primary hover:bg-white/60"
        >
          <span className="flex items-center gap-2">
            <span className="material-symbols-outlined text-base text-primary">checklist</span>
            {subtasks.length} 个子任务（已折叠）
          </span>
          <span className="material-symbols-outlined text-base text-text-secondary">expand_more</span>
        </button>
      </div>
    )
  }

  return (
    <div className="absolute bottom-full left-0 right-0 mb-2 z-40 max-h-[280px] overflow-y-auto rounded-2xl glass-panel-heavy shadow-float border border-gray-200 p-3">
      <div className="flex items-center justify-between mb-2 px-1">
        <span className="text-xs font-bold text-text-secondary flex items-center gap-1.5">
          <span className="material-symbols-outlined text-base text-primary">checklist</span>
          {subtasks.length} 个子任务 · 可编辑与指派
        </span>
        <button
          onClick={toggleTaskCollapsed}
          className="text-text-secondary hover:text-primary"
          title="折叠"
        >
          <span className="material-symbols-outlined text-base">expand_less</span>
        </button>
      </div>
      <div className="flex flex-col gap-2">
        {subtasks.map((st, i) => {
          const assigned = models.find(m => m.id === st.modelId)
          return (
            <div key={i} className="flex items-start gap-2 bg-white/60 rounded-xl p-2">
              <span className="flex-shrink-0 w-6 h-6 rounded-full bg-primary/10 text-primary text-xs font-bold flex items-center justify-center mt-0.5">
                {i + 1}
              </span>
              <textarea
                value={st.text}
                onChange={(e) => updateSubtask(i, { text: e.target.value })}
                rows={1}
                className="flex-grow min-w-0 bg-transparent border-0 focus:ring-0 focus:outline-none text-sm text-text-primary resize-none p-0"
                style={{ lineHeight: '20px' }}
              />
              <div className="flex flex-col items-center gap-1 flex-shrink-0">
                <button
                  onClick={() => {
                    const enabled = models.filter(m => m.enabled)
                    const cur = enabled.findIndex(m => m.id === st.modelId)
                    const next = enabled[(cur + 1) % Math.max(1, enabled.length)]
                    if (next) updateSubtask(i, { modelId: next.id })
                  }}
                  className="flex items-center gap-1 px-2 py-1 rounded-lg bg-blue-50 text-primary text-xs font-medium hover:bg-blue-100"
                  title="切换指派模型"
                >
                  <img src={assigned?.logo} alt="" className="w-3.5 h-3.5" onError={(e) => e.currentTarget.style.display = 'none'} />
                  {assigned?.name || '未指派'}
                </button>
                <button
                  onClick={() => removeSubtask(i)}
                  className="text-text-secondary hover:text-red-500"
                  title="删除"
                >
                  <span className="material-symbols-outlined text-base">close</span>
                </button>
              </div>
            </div>
          )
        })}
      </div>
      <button
        onClick={addSubtask}
        className="mt-2 w-full flex items-center justify-center gap-1 py-1.5 rounded-xl border border-dashed border-gray-300 text-text-secondary hover:text-primary hover:border-primary text-sm"
      >
        <span className="material-symbols-outlined text-base">add</span>
        新增子任务
      </button>
    </div>
  )
}

export default SubtaskList
```

- [ ] **Step 2: 写 TaskModePanel 组件**

Create `src/renderer/src/components/modes/TaskModePanel.tsx`:

```tsx
import { useRef } from 'react'
import { useAppStore } from '../../store/appStore'
import { useTaskSplit } from '../../hooks/useTaskSplit'
import SubtaskList from './SubtaskList'

interface TaskModePanelProps {
  showNotification: (type: 'success' | 'error' | 'info', msg: string, autoHide?: number) => void
}

/**
 * 任务模式 ControlBar 中段：
 * - idle: 输入框可编辑 query，按钮=拆解
 * - split: 输入框只读显示原 query，上方子任务弹层，按钮=一键发送；取消回到 idle
 * - sent: 已发送
 */
function TaskModePanel({ showNotification }: TaskModePanelProps): JSX.Element {
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const taskState = useAppStore((s) => s.taskState)
  const setTaskQuery = useAppStore((s) => s.setTaskQuery)
  const setTaskPhase = useAppStore((s) => s.setTaskPhase)
  const setTaskSubtasks = useAppStore((s) => s.setTaskSubtasks)
  const resetTask = useAppStore((s) => s.resetTask)
  const models = useAppStore((s) => s.models)
  const taskAssignmentSlots = useAppStore((s) => s.taskAssignmentSlots)
  const webviewRefs = useAppStore((s) => s.webviewRefs)
  const { split, isLoading } = useTaskSplit()

  const isSplit = taskState.phase === 'split'
  const isSent = taskState.phase === 'sent'

  const handleSplit = async () => {
    if (!taskState.query.trim() || isLoading) return
    await split(taskState.query)
  }

  const handleCancel = () => {
    setTaskPhase('idle')
    setTaskSubtasks([])
    setTimeout(() => textareaRef.current?.focus(), 50)
    showNotification('info', '已取消拆解，可继续编辑')
  }

  // 一键发送：按子任务 modelId 分组，每个槽位发送其指派的子任务文本
  const handleSend = async () => {
    if (taskState.subtasks.length === 0) return
    setTaskPhase('sent')
    // 按槽位 index（0..n）聚合文本；槽位模型 = taskAssignmentSlots[index]
    const bySlot = new Map<number, string[]>()
    taskState.subtasks.forEach((st) => {
      // 找到该 modelId 对应的槽位 index
      let slotIndex = taskAssignmentSlots.findIndex(id => id === st.modelId)
      if (slotIndex === -1) slotIndex = 0
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

  const handleNewRound = () => {
    resetTask()
    setTimeout(() => textareaRef.current?.focus(), 50)
  }

  return (
    <div className="relative flex-grow flex items-center gap-4 p-3 rounded-[24px] glass-panel-heavy shadow-float focus-within:border-gray-200 focus-within:ring-1 focus-within:ring-gray-200" style={{ height: '96px', flexShrink: 0, boxSizing: 'border-box' }}>
      {/* 子任务弹层（仅 split 阶段） */}
      {isSplit && <SubtaskList subtasks={taskState.subtasks} collapsed={taskState.collapsed} />}

      {/* 输入框 */}
      <textarea
        ref={textareaRef}
        value={taskState.query}
        onChange={(e) => { if (taskState.phase === 'idle') setTaskQuery(e.target.value) }}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey && taskState.phase === 'idle') {
            e.preventDefault()
            handleSplit()
          }
        }}
        readOnly={isSplit || isSent}
        placeholder={isSent ? '子任务已发送，点击右侧新建一轮拆解' : '输入总目标，点击拆解自动分配子任务…'}
        className="flex-grow bg-transparent border-0 focus:ring-0 focus:outline-none text-text-primary placeholder-text-secondary p-0 resize-none disabled:cursor-not-allowed"
        style={{ lineHeight: '24px', height: '72px', overflowY: 'auto' }}
      />

      {/* 按钮区 */}
      <div className="flex items-center gap-2 flex-shrink-0 self-end">
        {isSplit && (
          <button
            onClick={handleCancel}
            className="px-3 py-1.5 rounded-xl bg-gray-200 text-gray-600 hover:bg-gray-300 text-sm"
          >
            取消
          </button>
        )}
        {isSent ? (
          <button
            onClick={handleNewRound}
            className="h-12 w-12 rounded-full bg-primary text-white hover:opacity-90 flex items-center justify-center"
            title="新建一轮拆解"
          >
            <span className="material-symbols-outlined">add</span>
          </button>
        ) : (
          <button
            onClick={isSplit ? handleSend : handleSplit}
            disabled={isLoading || (!isSplit && !taskState.query.trim())}
            className={`rounded-full disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center justify-center gap-1.5 ${
              isSplit
                ? 'bg-primary text-white hover:opacity-90 px-4 h-12'
                : taskState.query.trim() ? 'bg-primary text-white hover:opacity-90 h-12 w-12' : 'h-12 w-12 bg-gray-100 hover:bg-gray-200 text-text-secondary'
            }`}
            title={isSplit ? '一键发送所有子任务' : '拆解总目标'}
          >
            {isLoading ? (
              <span className="material-symbols-outlined animate-spin">sync</span>
            ) : isSplit ? (
              <>
                <span className="material-symbols-outlined">send</span>
                <span className="text-sm font-bold">一键发送</span>
              </>
            ) : (
              <span className="material-symbols-outlined">call_split</span>
            )}
          </button>
        )}
      </div>
    </div>
  )
}

export default TaskModePanel
```

- [ ] **Step 3: ControlBar 中段分流**

Modify `src/renderer/src/components/ControlBar.tsx`：

3a. 顶部新增 import：

```tsx
import TaskModePanel from './modes/TaskModePanel'
import DebateModePanel from './modes/DebateModePanel'
```

（DebateModePanel 在 Task 5 创建，此处先 import 会导致 build 失败——所以 Task 4 先只接 TaskModePanel，DebateModePanel 的 import 与分支在 Task 5 完成后补。**调整执行顺序：Task 4 只接 task_assignment 分支，debate 分支保持现有输入框。Task 5 接 debate 分支并补 import。**）

3b. 在中段输入框 `<div className="relative flex-grow flex gap-4 p-3 ...">` 外层做条件分流。将现有中段 `div` 包进一个条件：`productMode === 'task_assignment'` 时渲染 `<TaskModePanel showNotification={showNotification} />`，否则渲染现有输入框。修改 return 内中段起始处：

```tsx
          {/* 中间：输入框（按模式分流） */}
          {productMode === 'task_assignment' ? (
            <TaskModePanel showNotification={showNotification} />
          ) : productMode === 'debate' ? (
            <DebateModePanel showNotification={showNotification} />
          ) : (
            <div className="relative flex-grow flex gap-4 p-3 rounded-[24px] glass-panel-heavy shadow-float ...">
              {/* ...现有输入框内容不变... */}
            </div>
          )}
```

> Task 4 阶段 `DebateModePanel` 尚未创建，因此 Task 4 暂时只写 `task_assignment` 分支，debate 分支保留原输入框（即三元先写成 `productMode === 'task_assignment' ? <TaskModePanel/> : <现有div>`）。Task 5 再把三元扩展为三分支并加 DebateModePanel import。

3c. ControlBar 顶部需取 `productMode`：

```tsx
const productMode = useAppStore((s) => s.productMode)
```

加入现有 `useAppStore(...)` 解构附近。

- [ ] **Step 4: lint + build + dev 手动验证**

Run: `npm run lint && npm run build`
Expected: 通过

Run: `npm run dev`，手动验证：
1. 标题栏切到「任务分配」模式。
2. 输入框输入总目标，点拆解（需先在设置配置好总结 API 供应商），观察上方出现子任务列表。
3. 编辑子任务文本、cycle 切换指派模型、删除、新增。
4. 折叠/展开子任务列表，确认折叠后不占垂直高度。
5. 点「一键发送」，确认子任务按槽位发送到对应 webview。
6. 点「取消」回到 idle，输入框恢复可编辑。

> 若拆解 API 未配置，应显示 error 通知「未配置可用的总结 API 供应商」。

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/components/modes/SubtaskList.tsx src/renderer/src/components/modes/TaskModePanel.tsx src/renderer/src/components/ControlBar.tsx
git commit -m "feat: implement task assignment mode panel (split/edit/send)"
```

---

## Task 5: useDebateRunner hook —— 辩论状态机驱动

**Files:**
- Create: `src/renderer/src/hooks/useDebateRunner.ts`

**Interfaces:**
- Consumes: `debateState` + setter、`debateSlots`、`sendToSlot`、`getResponseFromSlot`、`clearInputOfSlot`。
- Produces: `useDebateRunner()` => `{ start(topic): void; pause(): void; resume(): void; stop(): void; reset(): void }`。状态变更全部落回 `debateState`。

> 轮转逻辑（对齐 mock `runNextTurn`）：
> - turn=0（正方）：第 0 轮 prompt = 主题；第 N>0 轮 prompt = 「对方上一轮发言：{opponentSpeech}，请作为正方反驳」。发到 slot-0，等待回复，存入 `rounds[round].proponent`，`advanceDebateTurn` → turn=1。
> - turn=1（反方）：prompt = 「对方本轮发言：{proponentSpeech}，请作为反方反驳」。发到 slot-1，等待回复，存入 `rounds[round].opponent`，`advanceDebateTurn` → 若 round+1>=totalRounds 则 finished，否则 turn=0、round+1。
> - 暂停：phase=paused，清除定时器，中断当前 await（通过 abort 标志）。
> - 恢复：phase=running，重新 runNextTurn。
> - 终止：phase=finished，清定时器。
> - 重置：resetDebate。

- [ ] **Step 1: 写 hook**

Create `src/renderer/src/hooks/useDebateRunner.ts`:

```ts
import { useRef, useCallback, useEffect } from 'react'
import { useAppStore } from '../store/appStore'

/**
 * 辩论轮转驱动：正方(slot-0) ↔ 反方(slot-1) 自动交替。
 * 通过 store 的 debateState 推进；本 hook 持有 abort 标志与定时器。
 */
export function useDebateRunner() {
  const abortRef = useRef(false)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const clearTimer = () => {
    if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null }
  }

  useEffect(() => () => { abortRef.current = true; clearTimer() }, [])

  const buildPrompt = (topic: string, round: number, turn: 0 | 1): string => {
    const state = useAppStore.getState().debateState
    const role = turn === 0 ? '正方' : '反方'
    const oppRole = turn === 0 ? '反方' : '正方'
    // 找对手最近一次发言
    let oppSpeech = ''
    if (turn === 0) {
      // 正方发言：对手是上一轮的反方
      oppSpeech = state.rounds[round - 1]?.opponent || ''
    } else {
      // 反方发言：对手是本轮的正方
      oppSpeech = state.rounds[round]?.proponent || ''
    }
    const header = `你是辩论的${role}。辩论主题：${topic}\n\n`
    if (round === 0 && turn === 0) {
      return `${header}请作为正方开场，陈述你的核心立场与论据（300 字以内）。`
    }
    return `${header}${oppRole}刚刚的发言：\n"""\n${oppSpeech}\n"""\n\n请作为${role}进行反驳（300 字以内）。`
  }

  const runNextTurn = useCallback(async () => {
    const store = useAppStore.getState()
    if (store.debateState.phase !== 'running') return
    if (abortRef.current) return

    const { currentRound, currentTurn, topic, totalRounds } = store.debateState
    if (currentRound >= totalRounds) {
      store.setDebatePhase('finished')
      return
    }

    const slotIndex = currentTurn // 0=正方 slot-0, 1=反方 slot-1
    const prompt = buildPrompt(topic, currentRound, currentTurn)

    // 发送 + 等待回复
    const sendRes = await store.sendToSlot(slotIndex, prompt)
    if (abortRef.current || useAppStore.getState().debateState.phase !== 'running') return
    if (!sendRes.success) {
      // 发送失败：标记 finished 并通知（通知由 UI 层读 phase 处理）
      store.setDebatePhase('finished')
      return
    }
    const speech = await store.getResponseFromSlot(slotIndex, 30000)
    if (abortRef.current || useAppStore.getState().debateState.phase !== 'running') return

    store.appendDebateSpeech(currentRound, currentTurn, speech || '（无回复）')
    store.advanceDebateTurn()

    // 下一轮稍作延迟
    const next = useAppStore.getState().debateState
    if (next.phase === 'running') {
      timerRef.current = setTimeout(() => { runNextTurn() }, 600)
    }
  }, [])

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

  const pause = useCallback(() => {
    const store = useAppStore.getState()
    if (store.debateState.phase !== 'running') return
    abortRef.current = true
    clearTimer()
    store.setDebatePhase('paused')
  }, [])

  const resume = useCallback(() => {
    const store = useAppStore.getState()
    if (store.debateState.phase !== 'paused') return
    abortRef.current = false
    store.setDebatePhase('running')
    runNextTurn()
  }, [runNextTurn])

  const stop = useCallback(() => {
    const store = useAppStore.getState()
    if (store.debateState.phase === 'idle' || store.debateState.phase === 'finished') return
    abortRef.current = true
    clearTimer()
    store.setDebatePhase('finished')
  }, [])

  const reset = useCallback(() => {
    abortRef.current = true
    clearTimer()
    useAppStore.getState().resetDebate()
  }, [])

  return { start, pause, resume, stop, reset }
}
```

> 说明：`getResponseFromSlot` 用轮询等回复稳定（与项目 monitor 思路一致）。`sendToSlot` 直接调 `webviewRef.sendMessage`（一步发送，不走两步 insert+enter，因为辩论无需用户确认）。如某平台 `sendMessage` 实现内部已是 insert+enter，则直接复用；若发现某些平台需两步，作为 follow-up 在 `WebviewCard.sendMessage` 内补。

- [ ] **Step 2: lint + build**

Run: `npm run lint && npm run build`
Expected: 通过

- [ ] **Step 3: Commit**

```bash
git add src/renderer/src/hooks/useDebateRunner.ts
git commit -m "feat: add useDebateRunner hook for debate turn rotation"
```

---

## Task 6: 辩论模式面板 DebateModePanel + 接入 ControlBar

**Files:**
- Create: `src/renderer/src/components/modes/DebateModePanel.tsx`
- Modify: `src/renderer/src/components/ControlBar.tsx`（补 debate 分支与 import、隐藏辩论模式下的生图/深度研究按钮、总结按钮在未 finished 时禁用）
- Modify: `src/renderer/src/components/Layout.tsx`（辩论进行中禁用模式切换分段控件，避免中途切走丢失会话——可选，见 Step 4）

**Interfaces:**
- Consumes: `useDebateRunner`、`debateState` + `debateSlots` + `setDebateSlot` + `debateTotalRounds` + `setDebateTotalRounds`、`models`。
- Produces: `<DebateModePanel showNotification />`。

> 布局（对齐 mock，恒定 96px 高）：
> - 左侧功能组：轮次 stepper（input + 减号 + 加号），idle 可调，running/paused/finished 置灰 disabled 但不消失。辩论模式下不渲染生图/深度研究按钮（在 ControlBar 层处理）。
> - 中段：idle 时 = 主题输入框 + 「开始辩论」按钮；running/paused/finished 时 = 状态信息 + 圆点列表（横向滚动，溢出仅在面板内）+ 右侧固定暂停/终止或重新开始按钮。
> - 圆点：每轮 2 个（正/反），done=对勾、active=radio_button_checked、待进行=空圆。active 自动 scrollIntoView。

- [ ] **Step 1: 写 DebateModePanel 组件**

Create `src/renderer/src/components/modes/DebateModePanel.tsx`:

```tsx
import { useRef, useEffect } from 'react'
import { useAppStore } from '../../store/appStore'
import { useDebateRunner } from '../../hooks/useDebateRunner'

interface DebateModePanelProps {
  showNotification: (type: 'success' | 'error' | 'info', msg: string, autoHide?: number) => void
}

/**
 * 辩论模式 ControlBar 中段（固定 96px 高）。
 * 左侧 funcGroup 区放轮次 stepper（由 ControlBar 渲染，本组件只渲染中段）。
 * 中段：idle=主题输入；进行中=圆点滚动条 + 右侧固定按钮。
 */
function DebateModePanel({ showNotification }: DebateModePanelProps): JSX.Element {
  const debateState = useAppStore((s) => s.debateState)
  const debateSlots = useAppStore((s) => s.debateSlots)
  const setDebateSlot = useAppStore((s) => s.setDebateSlot)
  const models = useAppStore((s) => s.models)
  const { start, pause, resume, stop, reset } = useDebateRunner()
  const dotsRef = useRef<HTMLDivElement>(null)

  const { phase, currentRound, currentTurn, totalRounds, rounds, topic } = debateState
  const isIdle = phase === 'idle'
  const isRunning = phase === 'running'
  const isPaused = phase === 'paused'
  const isFinished = phase === 'finished'

  // 自动滚动到当前圆点
  useEffect(() => {
    const active = dotsRef.current?.querySelector('.debate-dot.active') as HTMLElement | null
    if (active) active.scrollIntoView({ block: 'nearest', inline: 'center', behavior: 'smooth' })
  }, [currentRound, currentTurn, phase])

  // 完成时通知
  useEffect(() => {
    if (phase === 'finished') showNotification('success', '辩论已结束，可生成裁判评析', 0)
  }, [phase, showNotification])

  const handleStart = () => {
    if (!topic.trim()) { showNotification('error', '请输入辩论主题'); return }
    start(topic)
  }

  // 圆点数据：每轮 2 个
  const dots: { round: number; turn: 0 | 1 }[] = []
  for (let r = 0; r < totalRounds; r++) {
    dots.push({ round: r, turn: 0 })
    dots.push({ round: r, turn: 1 })
  }
  const doneIdx = currentRound * 2 + (currentTurn === 1 && !isIdle ? 1 : 0)

  const speakingRole = currentTurn === 0 ? '正方' : '反方'
  const speakingModel = models.find(m => m.id === (currentTurn === 0 ? debateSlots[0] : debateSlots[1]))

  if (isIdle) {
    return (
      <div className="relative flex-grow flex items-center gap-4 p-3 rounded-[24px] glass-panel-heavy shadow-float focus-within:border-gray-200 focus-within:ring-1 focus-within:ring-gray-200" style={{ height: '96px', flexShrink: 0, boxSizing: 'border-box' }}>
        <span className="material-symbols-outlined text-text-secondary flex-shrink-0">forum</span>
        <textarea
          value={topic}
          onChange={(e) => useAppStore.getState().setDebateTopic(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleStart() } }}
          placeholder="输入辩论主题，例如：AI 是否会取代程序员？"
          className="flex-grow bg-transparent border-0 focus:ring-0 focus:outline-none text-text-primary placeholder-text-secondary p-0 resize-none"
          style={{ lineHeight: '24px', height: '72px', overflowY: 'auto' }}
        />
        <button
          onClick={handleStart}
          disabled={!topic.trim()}
          className="rounded-full bg-primary text-white hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1.5 px-4 h-12 flex-shrink-0 self-end"
        >
          <span className="material-symbols-outlined">play_arrow</span>
          <span className="text-sm font-bold">开始辩论</span>
        </button>
      </div>
    )
  }

  // running / paused / finished
  return (
    <div className="relative flex-grow flex items-center gap-4 p-3 rounded-[24px] glass-panel-heavy shadow-float" style={{ height: '96px', flexShrink: 0, boxSizing: 'border-box', minWidth: 0, overflow: 'hidden' }}>
      {/* 左：状态信息 */}
      <div className="flex flex-col flex-shrink-0 min-w-[120px]">
        <span className="text-xs text-text-secondary">
          轮次 {Math.min(currentRound + 1, totalRounds)}/{totalRounds}
        </span>
        <span className="text-sm font-medium text-text-primary flex items-center gap-1">
          {isRunning && <span className="w-2 h-2 rounded-full bg-blue-500 animate-pulse" />}
          {isPaused && <span className="w-2 h-2 rounded-full bg-yellow-500" />}
          {isFinished && <span className="w-2 h-2 rounded-full bg-green-500" />}
          {isRunning ? `${speakingRole}发言中…` : isPaused ? `暂停于第${currentRound + 1}轮${speakingRole}` : `共${totalRounds}轮完成`}
        </span>
        <span className="text-xs text-text-secondary truncate">{speakingModel?.name}</span>
      </div>

      {/* 中：圆点滚动条 */}
      <div ref={dotsRef} className="flex items-center gap-2 flex-1 min-w-0 overflow-x-auto py-1" style={{ scrollbarWidth: 'thin' }}>
        {dots.map((d, i) => {
          let cls = 'debate-dot border border-gray-300 text-text-secondary bg-white/40'
          let icon = 'radio_button_unchecked'
          if (i < doneIdx || isFinished) { cls = 'debate-dot bg-green-100 text-green-600 border-green-300'; icon = 'check' }
          else if (i === doneIdx && (isRunning || isPaused)) { cls = 'debate-dot active bg-blue-50 text-primary border-blue-300 scale-110'; icon = 'radio_button_checked' }
          return (
            <div key={`${d.round}-${d.turn}`} className={`debate-dot ${cls} flex-shrink-0 w-7 h-7 rounded-full flex items-center justify-center transition-all`} title={`第${d.round + 1}轮 ${d.turn === 0 ? '正方' : '反方'}`}>
              <span className="material-symbols-outlined text-base">{icon}</span>
            </div>
          )
        })}
      </div>

      {/* 右：固定按钮 */}
      <div className="flex items-center gap-2 flex-shrink-0">
        {isRunning && (
          <button onClick={pause} className="px-3 py-2 rounded-xl bg-gray-200 text-gray-700 hover:bg-gray-300 text-sm flex items-center gap-1">
            <span className="material-symbols-outlined text-base">pause</span>暂停
          </button>
        )}
        {isPaused && (
          <button onClick={resume} className="px-3 py-2 rounded-xl bg-primary text-white hover:opacity-90 text-sm flex items-center gap-1">
            <span className="material-symbols-outlined text-base">play_arrow</span>继续
          </button>
        )}
        {(isRunning || isPaused) && (
          <button onClick={stop} className="px-3 py-2 rounded-xl bg-red-100 text-red-600 hover:bg-red-200 text-sm flex items-center gap-1">
            <span className="material-symbols-outlined text-base">stop</span>终止
          </button>
        )}
        {isFinished && (
          <button onClick={reset} className="h-10 w-10 rounded-full bg-primary text-white hover:opacity-90 flex items-center justify-center" title="新辩论">
            <span className="material-symbols-outlined">add</span>
          </button>
        )}
      </div>
    </div>
  )
}

export default DebateModePanel
```

- [ ] **Step 2: ControlBar 接入 debate 分支 + 轮次 stepper + 按钮显隐**

Modify `src/renderer/src/components/ControlBar.tsx`：

2a. 补 import（Task 4 已加 TaskModePanel import，此处补 DebateModePanel）：

```tsx
import DebateModePanel from './modes/DebateModePanel'
```

2b. 中段三元扩展为三分支（替换 Task 4 的二元）：

```tsx
          {/* 中间：输入框（按模式分流） */}
          {productMode === 'task_assignment' ? (
            <TaskModePanel showNotification={showNotification} />
          ) : productMode === 'debate' ? (
            <DebateModePanel showNotification={showNotification} />
          ) : (
            <div className="relative flex-grow flex gap-4 p-3 rounded-[24px] glass-panel-heavy shadow-float ...">
              {/* ...现有输入框内容不变... */}
            </div>
          )}
```

2c. 左侧功能组在辩论模式下：隐藏「AI 生图」「深度研究」按钮，改为渲染「轮次 stepper」。「开启新对话」按钮保留（辩论模式下作为「新辩论」入口也可，但 DebateModePanel 已有 reset；为避免重复，辩论模式下隐藏「开启新对话」）。修改左侧 func group `<div className="flex items-center gap-6">`：

```tsx
          {/* 左侧：功能按钮 */}
          <div className="flex items-center gap-6">
            {productMode === 'debate' ? (
              <DebateRoundStepper />
            ) : (
              <>
                {/* AI 生图切换 —— 现有按钮代码原样保留 */}
                {/* 深度研究切换 —— 现有按钮代码原样保留 */}
                {/* 新对话按钮 —— 现有代码原样保留 */}
              </>
            )}
          </div>
```

> 即：把现有三个按钮（生图/深度研究/新对话）整体包进 `productMode !== 'debate'` 的条件里，辩论分支渲染 `<DebateRoundStepper />`。

2d. 新增 `DebateRoundStepper` 内联组件（可放在 ControlBar 文件内，或独立文件。为减少文件数，内联在 ControlBar.tsx 顶部 import 之后）：

```tsx
/** 辩论轮次 stepper：input + 减号 + 加号；非 idle 置灰禁用但不消失 */
function DebateRoundStepper(): JSX.Element {
  const totalRounds = useAppStore((s) => s.debateTotalRounds)
  const setDebateTotalRounds = useAppStore((s) => s.setDebateTotalRounds)
  const phase = useAppStore((s) => s.debateState.phase)
  const disabled = phase !== 'idle'
  return (
    <div className={`flex flex-col items-center justify-center gap-2 text-xs font-medium ${disabled ? 'opacity-45 pointer-events-none' : 'text-text-secondary hover:text-primary'}`}>
      <div className="flex items-center gap-1.5">
        <button
          onClick={() => setDebateTotalRounds(totalRounds - 1)}
          disabled={disabled}
          className="w-7 h-7 rounded-full glass-panel shadow-soft flex items-center justify-center border border-transparent hover:border-blue-200 disabled:cursor-not-allowed"
        >
          <span className="material-symbols-outlined text-base">remove</span>
        </button>
        <input
          type="number"
          min={1}
          max={10}
          value={totalRounds}
          disabled={disabled}
          onChange={(e) => setDebateTotalRounds(parseInt(e.target.value, 10) || 1)}
          className="w-12 text-center bg-transparent border-0 focus:ring-0 focus:outline-none text-text-primary font-bold disabled:cursor-not-allowed"
        />
        <button
          onClick={() => setDebateTotalRounds(totalRounds + 1)}
          disabled={disabled}
          className="w-7 h-7 rounded-full glass-panel shadow-soft flex items-center justify-center border border-transparent hover:border-blue-200 disabled:cursor-not-allowed"
        >
          <span className="material-symbols-outlined text-base">add</span>
        </button>
      </div>
      <span>辩论轮次</span>
    </div>
  )
}
```

2e. 右侧「生成总结」按钮：辩论模式下 phase !== 'finished' 时禁用（tooltip「辩论结束后可生成裁判评析」）；finished 时启用。修改右侧按钮：

```tsx
          <button
            onClick={() => {
              if (productMode === 'debate') {
                if (debateState.phase !== 'finished') return
                // 辩论总结：把双方发言作为 modelOutputs 传入总结页
                // 复用 onGenerateReport，它会爬取 webview 回复；辩论场景下也可直接读 debateState.rounds
                onGenerateReport()
              } else if (isImageGeneration) {
                showNotification('info', '一键下载图片功能已记录 TODO')
              } else {
                onGenerateReport()
              }
            }}
            disabled={productMode === 'debate' && debateState.phase !== 'finished'}
            className={`flex-shrink-0 px-4 py-2 text-sm font-bold rounded-[24px] shadow-soft transition-opacity whitespace-nowrap flex items-center gap-2 ${
              productMode === 'debate' && debateState.phase !== 'finished'
                ? 'bg-gray-200 text-gray-400 cursor-not-allowed'
                : 'bg-primary text-white hover:opacity-90'
            }`}
          >
            <span className="material-symbols-outlined text-xl">{productMode === 'debate' ? 'gavel' : isImageGeneration ? 'download' : 'auto_awesome'}</span>
            {productMode === 'debate' ? '裁判评析' : isImageGeneration ? '一键下载' : '生成总结'}
          </button>
```

> ControlBar 需取 `debateState`：`const debateState = useAppStore((s) => s.debateState)`。

- [ ] **Step 3: 辩论双方模型选择 —— WebviewCard header dropdown**

辩论模式下正方/反方模型通过 webview 卡片头部模型选择器切换（已有 `onModelChange` / `swapModelInSlot` 机制）。需确认 MainPage 在 debate 模式下渲染 WebviewCard 时把 `debateSlots[0]`/`debateSlots[1]` 作为初始模型，并 `onModelChange` 调 `setDebateSlot`。

检查 MainPage 渲染 WebviewCard 处（约第 400 行后）：当前 `displayedModels.map` 渲染时，对 debate 模式需传 `onModelChange={(newId) => setDebateSlot(index as 0|1, newId)}`。若现有代码已用 `swapModelInSlot`，需扩展 `swapModelInSlot` 识别 debate 模式调 `setDebateSlot`。

修改 `swapModelInSlot`（appStore.ts 约 674 行）在开头加 debate 分支：

```ts
  swapModelInSlot: (slotIndex: number, newModelId: string) => set((state) => {
    if (state.productMode === 'debate') {
      const slots = [...state.debateSlots] as [string, string]
      if (slotIndex === 0 || slotIndex === 1) slots[slotIndex] = newModelId
      return { debateSlots: slots }
    }
    if (state.productMode === 'task_assignment') {
      // ...现有逻辑
```

这样无需改 MainPage 的 `onModelChange` 绑定。

- [ ] **Step 4: 辩论进行中禁用模式切换（可选加固）**

Modify `src/renderer/src/components/Layout.tsx`：模式分段控件在 `debateState.phase === 'running' || 'paused'` 时加 `pointer-events-none opacity-50`，避免中途切走丢失会话。在模式 seg 容器加：

```tsx
className={`... ${productMode === 'debate' && (debateState.phase === 'running' || debateState.phase === 'paused') ? 'opacity-50 pointer-events-none' : ''}`}
```

Layout 顶部取 `const debateState = useAppStore((s) => s.debateState)`。此步可选，若时间紧可留 follow-up。

- [ ] **Step 5: lint + build + dev 手动验证**

Run: `npm run lint && npm run build`
Expected: 通过

Run: `npm run dev`，手动验证辩论模式：
1. 切到「辩论」模式，确认窗口锁双窗、窗口数量分段控件禁用。
2. 左侧出现轮次 stepper，可输入/加减调整（1-10）。
3. 正方/反方 webview 头部可切换模型。
4. 输入主题，点「开始辩论」，观察 phase→running，圆点亮起并自动滚动。
5. 轮次设到 8+，确认圆点在面板内横向滚动，不撑高面板、不撑爆窗口，右侧暂停/终止按钮固定。
6. 点暂停→继续→终止，观察 phase 正确流转。
7. 输入框/面板高度全程恒定 96px。
8. 结束后「裁判评析」按钮可点击，跳转总结页。

- [ ] **Step 6: Commit**

```bash
git add src/renderer/src/components/modes/DebateModePanel.tsx src/renderer/src/components/ControlBar.tsx src/renderer/src/store/appStore.ts src/renderer/src/components/Layout.tsx
git commit -m "feat: implement debate mode panel with round stepper and turn rotation"
```

---

## Task 7: 历史记录适配与模式间会话保持

**Files:**
- Modify: `src/renderer/src/store/appStore.ts`（`sendMessageToAll` / `addHistory` 记录 `productMode`）
- Modify: `src/renderer/src/pages/MainPage.tsx`（恢复历史时按 `productMode` 切换）

**Interfaces:**
- Consumes: 现有 `HistoryItem.productMode` 字段（已存在，第 104 行）。
- Produces: 任务/辩论发送的历史条目正确带 `productMode`；恢复历史时切到对应模式。

> `HistoryItem.productMode` 已定义但可能未充分使用。本任务确保任务分配与辩论的发送也写入正确 productMode，恢复时联动。

- [ ] **Step 1: 检查 sendMessageToAll 历史写入**

Grep `addHistory(` 在 `sendMessageToAll`（appStore.ts 约 854 行后），确认写入的 `HistoryItem` 带 `productMode: get().productMode`。若缺失则补：

```ts
addHistory({
  // ...现有字段
  productMode: get().productMode,
  displayMode: get().displayMode,
})
```

- [ ] **Step 2: 历史恢复联动模式**

检查 HistoryDrawer 恢复逻辑：恢复某条历史时若 `item.productMode` 存在，调 `setProductMode(item.productMode)`。Grep `setProductMode` 调用点，在历史恢复处补：

```ts
if (item.productMode) setProductMode(item.productMode)
```

> 若 HistoryDrawer 当前不直接切模式（仅恢复 webview URL），则作为 follow-up 记录，本任务至少保证写入正确。

- [ ] **Step 3: lint + build + dev 验证**

Run: `npm run lint && npm run build`
Run: `npm run dev`，发送一条任务模式消息，打开历史记录确认条目带任务模式标记。

- [ ] **Step 4: Commit**

```bash
git add src/renderer/src/store/appStore.ts src/renderer/src/pages/MainPage.tsx
git commit -m "feat: persist productMode in history and restore on reopen"
```

---

## Task 8: 文档与收尾

**Files:**
- Modify: `docs/mode-design-mock.html`（在顶部注释标注「已实现，见 src/renderer/src/components/modes/」）
- Run: `python .memory/session_log.py` 记录本次会话

- [ ] **Step 1: mock 顶部加实现说明注释**

在 `docs/mode-design-mock.html` `<head>` 后加注释：

```html
<!--
  状态：已落地实现（2026-07-01）
  实现位置：
    - 任务模式：src/renderer/src/components/modes/TaskModePanel.tsx + SubtaskList.tsx
    - 辩论模式：src/renderer/src/components/modes/DebateModePanel.tsx
    - 状态机：src/renderer/src/store/appStore.ts（taskState / debateState）
    - 拆解后端：src/main/api/taskSplitApi.ts + split-task IPC
  本文件保留为交互设计参考。
-->
```

- [ ] **Step 2: 运行 session_log.py**

```bash
python .memory/session_log.py --done "实现任务分配模式与辩论模式" --added "src/main/config/taskSplitPrompt.ts;src/main/api/taskSplitApi.ts;src/renderer/src/components/modes/TaskModePanel.tsx;src/renderer/src/components/modes/SubtaskList.tsx;src/renderer/src/components/modes/DebateModePanel.tsx;src/renderer/src/hooks/useTaskSplit.ts;src/renderer/src/hooks/useDebateRunner.ts" --modified "src/main/ipcHandlers.ts;src/preload/index.ts;src/preload/index.d.ts;src/renderer/src/store/appStore.ts;src/renderer/src/components/ControlBar.tsx;src/renderer/src/components/Layout.tsx;src/renderer/src/pages/MainPage.tsx;docs/mode-design-mock.html" --lesson "辩论轮转复用 webviewRefs.get('slot-N') 单槽位发送，无需改 WebviewCard；任务拆解复用 generate-summary 的 AbortController 全局中止器"
```

若终端输出 `Consider promoting stable lessons...`，则把对应 lesson 追加到 `.memory/KNOWLEDGE.md` 并把 SESSION_LOG 中该 `- lesson:` 改为 `- lesson(promoted):`。

- [ ] **Step 3: 最终全量验证**

Run: `npm run lint && npm run build`
Run: `npm run dev`，完整走查三种模式切换、任务拆解发送、辩论轮转、裁判评析。

- [ ] **Step 4: Commit**

```bash
git add docs/mode-design-mock.html SESSION_LOG.md .memory/KNOWLEDGE.md
git commit -m "docs: mark mode design mock as implemented and log session"
```

---

## 风险与 Follow-up

1. **getResponseFromSlot 轮询可靠性**：辩论发言回传依赖 `WebviewCardRef.getLatestResponse()`，不同平台回复抓取稳定性不一。若某平台超时取空，会在 `appendDebateSpeech` 写入「（无回复）」。Follow-up：在 `selectors.ts` 增量补强该平台回复选择器。
2. **sendMessage 两步 vs 一步**：辩论用 `sendMessage`（一步），任务模式用 `sendMessage`（一步）。若某些平台 `sendMessage` 内部未实现 insert+enter，需在 `WebviewCard.sendMessage` 内补齐。验证时重点观察。
3. **debateSlots 持久化**：初版未持久化 `debateSlots`/`debateTotalRounds`，重启回默认。Follow-up：补 `window.api.storeSet`。
4. **辩论进行中模式切换**：Task 6 Step 4 为可选加固；若未做，用户中途切模式可能丢失进行中辩论状态。
5. **任务模式子任务跨槽位发送**：当多个子任务指派同一模型时，会合并为一条消息发到该槽位。若需严格并行（同模型多窗口），需扩展 `taskAssignmentSlots` 允许重复——当前 `getDisplayedModels` 已支持同模型多槽位。
6. **IME/输入法**：任务模式输入框复用 ControlBar 现有 IME 处理（`isComposingRef`），需在 TaskModePanel 同步 `onCompositionStart/End`。Task 4 Step 2 的 textarea 已省略该处理——实现时需补回（参考 ControlBar 现有写法）。
