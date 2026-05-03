# Webview AI 输出实时监控与自动保存 - 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 ModelMash 中实现后台静默监控 webview AI 输出，并在输出完成后自动将对话数据保存到本地，替代现有 history 存储方式。

**Architecture:** Store 中心化轮询方案。由 Zustand appStore 统一管理对各 webview 的定时轮询，通过内容稳定判定检测输出完成，完成后保存完整对话记录（用户问题 + 各平台 AI 回复 Markdown）。零 IPC 改动，零主进程改动。

**Tech Stack:** Electron 28, React 18, TypeScript, Zustand 4, Tailwind 3

---

## 文件变更总览

| 文件 | 操作 | 职责 |
|------|------|------|
| `src/renderer/src/store/appStore.ts` | 修改 | 核心：新数据模型、监控状态机、轮询逻辑、保存逻辑、发送流程重构 |
| `src/renderer/src/components/WebviewCard.tsx` | 修改 | `handleNewConversation` 重置 `isNewSession` |
| `src/renderer/src/components/HistoryDrawer.tsx` | 修改 | 适配 `turns[]` 格式展示 |

---

## 关键上下文

### 现有 HistoryItem（将被替换）

```typescript
// 当前格式（将被替换）
export interface HistoryItem {
  id: string
  message: string
  timestamp: number
  models: string[]
  responses?: Record<string, string>
  urls?: Record<string, string>
}
```

### 现有 sendMessageToAll 关键流程

1. 发送消息到各 webview
2. 成功后检查 `isNewSession` 和模型列表是否相同
3. 决定更新现有 history 还是新增
4. 异步等待 5 秒后获取各平台 URL
5. 更新 history 的 urls 字段

### 现有 AppState 中与 history 相关的部分

```typescript
interface AppState {
  history: HistoryItem[]
  addHistory: (item: HistoryItem) => void
  updateHistory: (id: string, updates: Partial<HistoryItem>) => void
  removeHistory: (id: string) => void
  removeHistories: (ids: string[]) => void
  // ...
}
```

---

## Task 1: 定义新数据模型和监控配置

**Files:**
- Modify: `src/renderer/src/store/appStore.ts`（类型定义部分，约第 65-110 行区域）

- [ ] **Step 1: 在 appStore.ts 的 HistoryItem 定义附近，添加新的数据模型类型**

找到现有 `HistoryItem` 的定义位置，在其**上方**添加新类型：

```typescript
// 对话轮次（一问一答）
export interface ConversationTurn {
  turnId: string
  userMessage: string
  timestamp: number
  responses: Record<string, string>  // modelId -> Markdown
}

// 历史记录（新格式，替代现有 HistoryItem）
export interface HistoryItem {
  id: string
  createdAt: number
  updatedAt: number
  models: string[]
  turns: ConversationTurn[]
  urls?: Record<string, string>
}
```

**注意：** 这段代码直接替换现有的 `HistoryItem` 定义（删除旧的、保留新的）。保留 `responses` 的旧字段不需要，因为数据已迁移到 `turns` 中。

**删除旧代码：**
```typescript
// 删除这整个旧定义块
export interface HistoryItem {
  id: string
  message: string
  timestamp: number
  models: string[]
  responses?: Record<string, string>
  urls?: Record<string, string>
}
```

- [ ] **Step 2: 添加监控配置常量**

在 `appStore.ts` 中，在导入语句之后、状态定义之前添加：

```typescript
// 监控配置常量
const MONITOR_CONFIG = {
  pollIntervalMs: 3000,                 // 每 3 秒轮询一次
  stableThreshold: 3,                   // 连续 3 次不变即判定完成（约 9 秒）
  maxMonitorDurationMs: 5 * 60 * 1000,  // 最长监控 5 分钟（防死等）
}
```

- [ ] **Step 3: 添加监控状态类型（文件作用域，不暴露）**

在 `MONITOR_CONFIG` 之后添加：

```typescript
// 监控状态类型（内部使用，不对外暴露）
interface PlatformMonitorState {
  lastContent: string
  stableCount: number
  isComplete: boolean
}

interface TurnMonitor {
  turnId: string
  userMessage: string
  platforms: Record<string, PlatformMonitorState>
}

interface MonitorState {
  isMonitoring: boolean
  currentConversationId: string | null
  currentTurn: TurnMonitor | null
  intervalId: ReturnType<typeof setInterval> | null
  startTime: number
}
```

- [ ] **Step 4: Commit**

```bash
git add src/renderer/src/store/appStore.ts
git commit -m "feat(store): add new HistoryItem types and monitor config

- Replace old HistoryItem with turns-based model
- Add ConversationTurn, PlatformMonitorState, TurnMonitor types
- Add MONITOR_CONFIG constants"
```

---

## Task 2: 添加监控状态到 AppState

**Files:**
- Modify: `src/renderer/src/store/appStore.ts`（AppState interface，约第 115-200 行）

- [ ] **Step 1: 在 AppState interface 中添加监控状态和 action**

找到 `AppState` 的 `getAllResponses` 声明位置（约第 175 行），在其**下方**添加：

```typescript
  // 监控状态（不持久化）
  monitor: MonitorState
  startMonitoring: (conversationId: string, turnId: string, userMessage: string, models: string[]) => void
  stopMonitoring: () => void
  pollPlatforms: () => Promise<void>
  saveCurrentTurn: () => void
```

- [ ] **Step 2: Commit**

```bash
git add src/renderer/src/store/appStore.ts
git commit -m "feat(store): add monitor state to AppState interface"
```

---

## Task 3: 添加工具函数（URL 归一化 + 新对话判定）

**Files:**
- Modify: `src/renderer/src/store/appStore.ts`（在 `MONITOR_CONFIG` 类型之后、useAppStore 创建之前的位置）

- [ ] **Step 1: 添加 URL 归一化函数**

在 `useAppStore` 创建调用之前（约第 295 行之前），添加纯工具函数：

```typescript
/**
 * 归一化 URL：只保留 origin + pathname，忽略 query 参数
 */
function normalizeUrl(url: string): string {
  if (!url || url === 'about:blank') return ''
  try {
    const u = new URL(url)
    return `${u.origin}${u.pathname}`
  } catch {
    return url
  }
}
```

- [ ] **Step 2: 添加新对话判定函数**

紧跟其后：

```typescript
/**
 * 判定是否应该开始新对话
 * @param currentUrls 当前各平台 URL
 * @param previousUrls 上次保存的 URL
 * @param isNewSession 是否显式标记为新会话
 */
function shouldStartNewConversation(
  currentUrls: Record<string, string>,
  previousUrls: Record<string, string> | undefined,
  isNewSession: boolean
): boolean {
  if (isNewSession) return true
  if (!previousUrls || Object.keys(previousUrls).length === 0) return true

  const currentKeys = Object.keys(currentUrls)
  const previousKeys = Object.keys(previousUrls)

  if (currentKeys.length !== previousKeys.length) return true
  if (!currentKeys.every(k => previousKeys.includes(k))) return true

  for (const modelId of currentKeys) {
    const curr = normalizeUrl(currentUrls[modelId])
    const prev = normalizeUrl(previousUrls[modelId])
    if (curr && prev && curr !== prev) return true
  }

  return false
}
```

- [ ] **Step 3: Commit**

```bash
git add src/renderer/src/store/appStore.ts
git commit -m "feat(store): add URL normalization and conversation detection utilities"
```

---

## Task 4: 初始化监控状态

**Files:**
- Modify: `src/renderer/src/store/appStore.ts`（useAppStore 初始状态，约第 295 行区域）

- [ ] **Step 1: 在 useAppStore 的初始状态中添加 monitor**

找到 `useAppStore = create<AppState>((set, get) => ({` 的初始状态定义，在现有状态之后添加：

```typescript
  // 监控状态（不持久化）
  monitor: {
    isMonitoring: false,
    currentConversationId: null,
    currentTurn: null,
    intervalId: null,
    startTime: 0,
  },
```

- [ ] **Step 2: Commit**

```bash
git add src/renderer/src/store/appStore.ts
git commit -m "feat(store): initialize monitor state in store"
```

---

## Task 5: 实现监控核心逻辑（startMonitoring / stopMonitoring / pollPlatforms / saveCurrentTurn）

**Files:**
- Modify: `src/renderer/src/store/appStore.ts`（在 useAppStore 内部，与现有 action 并列的位置）

- [ ] **Step 1: 添加 startMonitoring action**

在 `useAppStore` 内部，在 `setReportData` 之后（约第 693 行之前，store 结束前），添加以下四个 action：

```typescript
  // ========== 监控 Action ==========

  startMonitoring: (conversationId: string, turnId: string, userMessage: string, models: string[]) => {
    const { monitor } = get()

    // 如果已有轮询器在运行，先停止
    if (monitor.intervalId) {
      clearInterval(monitor.intervalId)
    }

    // 初始化各平台监控状态
    const platforms: Record<string, PlatformMonitorState> = {}
    for (const modelId of models) {
      platforms[modelId] = {
        lastContent: '',
        stableCount: 0,
        isComplete: false,
      }
    }

    const turnMonitor: TurnMonitor = {
      turnId,
      userMessage,
      platforms,
    }

    // 启动轮询
    const intervalId = setInterval(() => {
      get().pollPlatforms()
    }, MONITOR_CONFIG.pollIntervalMs)

    set({
      monitor: {
        isMonitoring: true,
        currentConversationId: conversationId,
        currentTurn: turnMonitor,
        intervalId,
        startTime: Date.now(),
      },
    })
  },
```

- [ ] **Step 2: 添加 stopMonitoring action**

紧跟其后：

```typescript
  stopMonitoring: () => {
    const { monitor } = get()
    if (monitor.intervalId) {
      clearInterval(monitor.intervalId)
    }
    set({
      monitor: {
        isMonitoring: false,
        currentConversationId: null,
        currentTurn: null,
        intervalId: null,
        startTime: 0,
      },
    })
  },
```

- [ ] **Step 3: 添加 pollPlatforms action**

紧跟其后：

```typescript
  pollPlatforms: async () => {
    const { monitor, webviewRefs, models, displayMode, history } = get()
    if (!monitor.isMonitoring || !monitor.currentTurn) return

    // 超时检测
    if (Date.now() - monitor.startTime > MONITOR_CONFIG.maxMonitorDurationMs) {
      get().saveCurrentTurn()
      get().stopMonitoring()
      return
    }

    const displayedModels = getDisplayedModels(models, displayMode)
    let allComplete = true

    for (const model of displayedModels) {
      const state = monitor.currentTurn.platforms[model.id]
      if (!state || state.isComplete) continue

      const ref = webviewRefs.get(model.id)
      if (!ref) {
        state.isComplete = true
        continue
      }

      try {
        const content = await ref.getLatestResponse()

        if (content !== state.lastContent) {
          state.lastContent = content
          state.stableCount = 0
        } else {
          state.stableCount++
          if (state.stableCount >= MONITOR_CONFIG.stableThreshold) {
            state.isComplete = true
          }
        }
      } catch {
        // 获取失败，不影响其他平台，继续轮询
      }

      if (!state.isComplete) {
        allComplete = false
      }
    }

    // 保存当前进度（即使未全部完成）
    get().saveCurrentTurn()

    if (allComplete) {
      get().stopMonitoring()
    }
  },
```

- [ ] **Step 4: 添加 saveCurrentTurn action**

紧跟其后：

```typescript
  saveCurrentTurn: () => {
    const { monitor, history } = get()
    if (!monitor.currentTurn || !monitor.currentConversationId) return

    const { currentConversationId, currentTurn } = monitor
    const historyItem = history.find(h => h.id === currentConversationId)
    if (!historyItem) return

    // 构建 responses（只包含有内容的平台）
    const responses: Record<string, string> = {}
    for (const [modelId, state] of Object.entries(currentTurn.platforms)) {
      if (state.lastContent) {
        responses[modelId] = state.lastContent
      }
    }

    // 查找是否已有同 turn
    const existingTurnIndex = historyItem.turns.findIndex(
      t => t.turnId === currentTurn.turnId
    )

    const turn: ConversationTurn = {
      turnId: currentTurn.turnId,
      userMessage: currentTurn.userMessage,
      timestamp: Date.now(),
      responses,
    }

    const newTurns = existingTurnIndex >= 0
      ? historyItem.turns.map((t, i) => (i === existingTurnIndex ? turn : t))
      : [...historyItem.turns, turn]

    const updatedItem: HistoryItem = {
      ...historyItem,
      turns: newTurns,
      updatedAt: Date.now(),
    }

    const newHistory = history.map(h =>
      h.id === currentConversationId ? updatedItem : h
    )

    set({ history: newHistory })
    if (window.api?.storeSet) {
      window.api.storeSet('history', newHistory)
    }
  },
```

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/store/appStore.ts
git commit -m "feat(store): implement monitor core logic

- Add startMonitoring, stopMonitoring, pollPlatforms, saveCurrentTurn
- Poll every 3s, stable after 3 consecutive unchanged reads
- Save partial progress even if not all platforms complete
- 5-minute timeout guard"
```

---

## Task 6: 重构 sendMessageToAll 整合监控

**Files:**
- Modify: `src/renderer/src/store/appStore.ts`（sendMessageToAll 函数，约第 457-590 行）

- [ ] **Step 1: 在 sendMessageToAll 中，在"发送成功后"立即获取 URL 并判定新/旧对话**

找到 `sendMessageToAll` 函数。在发送成功后（`const sendResults = await Promise.all(sendPromises)` 之后），替换现有的 history 创建/更新逻辑。

**保留**发送消息到 webview 的代码（到 `const sendResults = await Promise.all(sendPromises)` 为止）。

**替换**其后的所有逻辑（从 `const successModels = ...` 开始到 `set({ isSending: false, lastSendResults: results })` 之前）。

新逻辑如下：

```typescript
    const successModels = sendResults.filter((r) => r.success).map((r) => r.modelId)

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

      const lastItem = history.length > 0 ? history[0] : null
      const isNewConv = shouldStartNewConversation(
        currentUrls,
        lastItem?.urls,
        isNewSession
      )

      let conversationId: string

      if (isNewConv) {
        // 新对话
        conversationId = Date.now().toString()
        const newItem: HistoryItem = {
          id: conversationId,
          createdAt: Date.now(),
          updatedAt: Date.now(),
          models: successModels,
          turns: [],
          urls: currentUrls,
        }
        addHistory(newItem)
        setNewSession(false)
      } else {
        // 继续现有对话
        conversationId = lastItem!.id
        const updatedUrls = { ...lastItem!.urls, ...currentUrls }
        updateHistory(conversationId, {
          urls: updatedUrls,
          updatedAt: Date.now(),
        })
      }

      // 创建新 turn 并启动监控
      const turnId = `${conversationId}-${Date.now()}`
      get().startMonitoring(conversationId, turnId, message, successModels)

      // 异步获取可保存的 URL（兼容现有 Gemini URL 处理逻辑）
      // 保留原有的 waitForSavableUrl 逻辑用于更新 URLs
      const sleep = (ms: number): Promise<void> =>
        new Promise((resolve) => setTimeout(resolve, ms))

      const isGeminiConversationUrl = (rawUrl: string): boolean => {
        try {
          const u = new URL(rawUrl)
          if (u.origin !== 'https://gemini.google.com') return false
          const parts = u.pathname.split('/').filter(Boolean)
          if (parts[0] === 'app' && typeof parts[1] === 'string' && parts[1].length > 0) return true
          if (parts[0] === 'u' && parts[2] === 'app' && typeof parts[3] === 'string' && parts[3].length > 0) return true
          return false
        } catch {
          return false
        }
      }

      const normalizeGeminiConversationUrl = (rawUrl: string): string => {
        try {
          const u = new URL(rawUrl)
          const parts = u.pathname.split('/').filter(Boolean)
          let conversationId: string | undefined
          if (parts[0] === 'app') {
            conversationId = parts[1]
          } else if (parts[0] === 'u' && parts[2] === 'app') {
            conversationId = parts[3]
          }
          if (!conversationId) return ''
          return `https://gemini.google.com/app/${conversationId}`
        } catch {
          return ''
        }
      }

      const waitForSavableUrl = async (modelId: string, ref: WebviewCardRef): Promise<string> => {
        const timeoutMs = modelId === 'gemini' ? 30000 : 10000
        const deadline = Date.now() + timeoutMs
        while (Date.now() < deadline) {
          const currentUrl = ref.getCurrentUrl()
          if (currentUrl && currentUrl !== 'about:blank') {
            if (modelId === 'gemini') {
              if (isGeminiConversationUrl(currentUrl)) {
                return normalizeGeminiConversationUrl(currentUrl) || currentUrl
              }
            } else {
              return currentUrl
            }
          }
          await sleep(1000)
        }
        return ''
      }

      ;(async () => {
        await sleep(5000)
        const { webviewRefs: currentRefs } = get()
        const urls: Record<string, string> = {}

        await Promise.all(
          successModels.map(async (modelId) => {
            const ref = currentRefs.get(modelId)
            if (!ref) return
            try {
              const savableUrl = await waitForSavableUrl(modelId, ref)
              if (savableUrl) urls[modelId] = savableUrl
            } catch (error) {
              console.error(`获取模型 ${modelId} 的 URL 失败:`, error)
            }
          })
        )

        if (Object.keys(urls).length > 0) {
          updateHistory(conversationId, { urls })
        }
      })().catch((error) => console.error('异步获取 URL 失败:', error))
    }

    set({ isSending: false, lastSendResults: results })
    return results
```

**注意：** 这段代码嵌套在 `sendMessageToAll` 中。替换从 `const successModels = ...` 到 `set({ isSending: false, lastSendResults: results })` 之前的所有内容。`set({ isSending: false, lastSendResults: results })` 和 `return results` 保留在末尾。

- [ ] **Step 2: Commit**

```bash
git add src/renderer/src/store/appStore.ts
git commit -m "feat(store): refactor sendMessageToAll with integrated monitoring

- Get URLs immediately after send for conversation detection
- Use shouldStartNewConversation to decide new vs existing
- Start monitoring automatically after each send
- Keep async savable URL fetching for Gemini compatibility"
```

---

## Task 7: WebviewCard 重置 isNewSession

**Files:**
- Modify: `src/renderer/src/components/WebviewCard.tsx`（handleNewConversation，约第 565-573 行）

- [ ] **Step 1: 在 WebviewCard 的 handleNewConversation 中添加 isNewSession 重置**

找到 `handleNewConversation` 函数：

```typescript
const handleNewConversation = () => {
  const webview = webviewRef.current
  if (!webview) return
  const newUrl = selectors?.newConversationUrl
  if (!newUrl) return
  setLoadError(null)
  setIsLoading(true)
  webview.loadURL(newUrl)
}
```

在 `webview.loadURL(newUrl)` 之后添加一行：

```typescript
  webview.loadURL(newUrl)
  // 标记为新会话，下次发送时创建新 HistoryItem
  useAppStore.getState().setNewSession(true)
```

**注意：** `useAppStore` 已经在文件顶部导入（`import { useAppStore } from '../store/appStore'`），可以直接使用。

- [ ] **Step 2: Commit**

```bash
git add src/renderer/src/components/WebviewCard.tsx
git commit -m "feat(webview): reset isNewSession when starting new conversation"
```

---

## Task 8: HistoryDrawer 适配 turns[] 格式

**Files:**
- Modify: `src/renderer/src/components/HistoryDrawer.tsx`

- [ ] **Step 1: 读取现有 HistoryDrawer.tsx，了解其如何使用 history 数据**

执行：`Read src/renderer/src/components/HistoryDrawer.tsx`

- [ ] **Step 2: 修改列表项渲染，适配 turns[] 格式**

找到渲染 history 列表项的地方。将显示 `item.message` 改为显示 `item.turns[0]?.userMessage ?? '(无消息)'`。

如果列表项显示了 `item.responses`，改为显示各平台回复数量或摘要。例如：

```typescript
// 旧：
// <span>{item.message}</span>
// 新：
<span>{item.turns[0]?.userMessage ?? '(无消息)'}</span>
```

添加轮次信息显示：

```typescript
<span className="text-xs text-gray-500">
  {item.turns.length} 轮对话
</span>
```

- [ ] **Step 3: 修改详情展开/点击加载逻辑**

确保点击历史记录加载 URL 时仍使用 `item.urls`，这部分不变。

- [ ] **Step 4: Commit**

```bash
git add src/renderer/src/components/HistoryDrawer.tsx
git commit -m "feat(history): adapt HistoryDrawer to turns[] format

- Display first turn's userMessage as title
- Show turn count in list items"
```

---

## Task 9: 向后兼容：旧格式 history 迁移

**Files:**
- Modify: `src/renderer/src/store/appStore.ts`（initializeStore 函数，约第 696-821 行）

- [ ] **Step 1: 在 initializeStore 中添加旧格式检测和迁移**

找到 `initializeStore` 函数中加载 history 的部分（约第 766 行）：

```typescript
const storedHistory = await window.api.storeGet('history') as HistoryItem[] | undefined
if (storedHistory) useAppStore.setState({ history: storedHistory })
```

替换为：

```typescript
    const storedHistory = await window.api.storeGet('history') as any[] | undefined
    if (storedHistory && storedHistory.length > 0) {
      // 检测是否为旧格式并迁移
      const isOldFormat = storedHistory.some(
        (item) => item && typeof item.message === 'string' && !Array.isArray(item.turns)
      )

      if (isOldFormat) {
        const migratedHistory: HistoryItem[] = storedHistory.map((old: any) => ({
          id: old.id || Date.now().toString(),
          createdAt: old.timestamp || Date.now(),
          updatedAt: old.timestamp || Date.now(),
          models: old.models || [],
          turns: [
            {
              turnId: `${old.id || Date.now()}-0`,
              userMessage: old.message || '',
              timestamp: old.timestamp || Date.now(),
              responses: old.responses || {},
            },
          ],
          urls: old.urls,
        }))
        useAppStore.setState({ history: migratedHistory })
        // 立即持久化新格式
        window.api?.storeSet('history', migratedHistory)
        console.log('[Store] History migrated from old format to turns-based format')
      } else {
        useAppStore.setState({ history: storedHistory as HistoryItem[] })
      }
    }
```

- [ ] **Step 2: Commit**

```bash
git add src/renderer/src/store/appStore.ts
git commit -m "feat(store): add history format migration for backward compatibility

- Detect old format (has 'message' field, no 'turns')
- Auto-migrate to new turns-based format on app start
- Persist migrated format immediately"
```

---

## Task 10: 验证

**Files:**
- 运行命令验证所有改动

- [ ] **Step 1: 运行 lint**

```bash
npm run lint
```

Expected: 无错误，无新增警告。

- [ ] **Step 2: 运行 build**

```bash
npm run build
```

Expected: 编译成功，无 TypeScript 错误。

- [ ] **Step 3: 手动功能验证**

```bash
npm run dev
```

测试场景：
1. **发送单轮消息**：启用 2-3 个平台，发送消息，等待约 10-15 秒，检查历史记录是否正确保存了 turns[0] 和各平台回复
2. **多轮累积**：在同一对话中发送第二条消息，检查历史记录是否累积到同一条记录的 turns[1]
3. **新对话判定**：点击某平台的"新对话"按钮，再发送消息，检查是否创建了新的 HistoryItem
4. **历史展示**：打开 HistoryDrawer，确认列表正确显示对话标题和轮次数
5. **关闭重启**：关闭应用后重新打开，确认历史记录仍然正确显示

- [ ] **Step 4: Commit（如果 build 通过）**

```bash
git add -A
git commit -m "feat: real-time webview output monitoring and auto-save

- Monitor AI output in background via polling (3s interval)
- Detect completion by content stability (3 consecutive unchanged reads)
- Save complete conversation turns (user message + AI responses per platform)
- Accumulate multiple turns into single HistoryItem per conversation
- Detect new conversation by URL change or explicit new-session signal
- Replace old history format with turns-based model
- Auto-migrate existing history on app start"
```

---

## 自检清单

### Spec Coverage

| 设计文档要求 | 对应任务 |
|-------------|---------|
| 新 HistoryItem 数据模型 | Task 1 |
| 监控配置常量 | Task 1 |
| 监控状态机 | Task 2, Task 4, Task 5 |
| URL 归一化 | Task 3 |
| 新对话判定 | Task 3, Task 6 |
| 轮询逻辑 | Task 5 |
| 保存逻辑 | Task 5 |
| sendMessageToAll 重构 | Task 6 |
| isNewSession 重置 | Task 7 |
| HistoryDrawer 适配 | Task 8 |
| 向后兼容迁移 | Task 9 |
| 验证 | Task 10 |

### Placeholder Scan

无 TBD、TODO、"implement later"、"add appropriate error handling" 等占位符。所有步骤包含具体代码。

### Type Consistency

- `ConversationTurn.turnId` 在各处一致使用
- `HistoryItem.turns` 类型在数据模型、保存逻辑、迁移逻辑中一致
- `PlatformMonitorState` 字段名在初始化和轮询中一致
