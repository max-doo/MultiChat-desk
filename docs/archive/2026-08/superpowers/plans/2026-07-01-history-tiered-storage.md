# History 分层存储实现计划：磁盘 1000 / 内存 100 + 手动加载更多

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 history/summaryHistory 的磁盘上限提到 1000、内存热区维持 100，并在抽屉底部加"加载更多"按钮按页拉取老记录，移除启动时的磁盘回写裁剪。

**Architecture:** 主进程新增只读分页 `historyManager`，写路径维持现有 `storeSet` 不变；磁盘 1000 上限由 `store-set` handler 单点 enforcement；renderer 内存维持 100 条，通过新增 IPC 按 `offset` 拉取磁盘分页追加进内存末尾。

**Tech Stack:** Electron 28, React 18, Zustand 4, TypeScript (strict), electron-store, react-virtuoso

## Global Constraints

- 严格 TypeScript，禁止 `any` 静默错误；故意未使用的变量以 `_` 前缀标记。
- IPC 改动必须四端同步：`src/main/ipcHandlers.ts` ↔ `src/preload/index.ts` ↔ `src/preload/index.d.ts` ↔ renderer 调用点。
- IPC 返回结构统一 `{ success: boolean; data?: T; error?: string }`。
- main 进程不能 import renderer 代码（分层边界），preload 同理。`HistoryItem`/`SummaryHistoryItem` 类型在 main 侧 `historyManager.ts` 本地定义、在 `index.d.ts` 本地声明，结构须与 `appStore.ts:96-135` 对齐（分页只读不写，结构兼容即可）。
- 不重构无关 store 逻辑；改动只限 history/summaryHistory 链路。
- 验证流程：`npm run lint` → `npm run build` → `npm run dev` 手动验证（项目无自动化测试运行器）。
- 提交遵循 Conventional Commits。

## File Structure

| File | Responsibility |
|------|---------------|
| `src/main/api/historyManager.ts` | NEW：只读分页 + 磁盘上限 enforcement；本地定义 HistoryItem/SummaryHistoryItem 类型 |
| `src/main/ipcHandlers.ts` | MODIFY：注册 4 个只读分页 IPC；改造 `store-set` 加磁盘 enforcement |
| `src/preload/index.ts` | MODIFY：暴露 4 个分页方法 |
| `src/preload/index.d.ts` | MODIFY：声明 4 个方法 + 本地 HistoryItem/SummaryHistoryItem 类型 |
| `src/renderer/src/store/appStore.ts` | MODIFY：新增 totalCount/loadMore 状态与 action；initializeStore 移除磁盘回写裁剪、读取 totalCount |
| `src/renderer/src/components/HistoryDrawer.tsx` | MODIFY：底部加"加载更多"按钮，搜索时禁用 |

---

### Task 1: 主进程 historyManager + 分页 IPC + 磁盘 enforcement

**Files:**
- Create: `src/main/api/historyManager.ts`
- Modify: `src/main/ipcHandlers.ts:10-15`（import）、`:536-538`（store-set 改造）、新增 4 个 handler

**Interfaces:**
- Consumes: `electron-store` 的 `Store<Record<string, unknown>>` 实例（已在 `ipcHandlers.ts` 顶部以 `store` 名存在）
- Produces:
  - `class HistoryManager`，方法：
    - `getHistoryPage(offset: number, limit: number): HistoryItem[]`
    - `getSummaryHistoryPage(offset: number, limit: number): SummaryHistoryItem[]`
    - `getHistoryTotalCount(): number`
    - `getSummaryHistoryTotalCount(): number`
    - `enforceDiskLimit(): void`
  - 导出常量 `DISK_LIMIT = 1000`
  - 导出类型 `HistoryItem`、`SummaryHistoryItem`

- [ ] **Step 1: 创建 `src/main/api/historyManager.ts`**

```typescript
/**
 * History Manager
 * 只读分页访问 + 磁盘上限 enforcement。
 * 写路径仍由 renderer 通过 store-set 直写，本类不参与写入，仅在 store-set 后 enforce 磁盘上限。
 */
import type Store from 'electron-store'

/** 与 appStore.ts 的 HistoryItem 结构对齐（分页只读，结构兼容即可） */
export interface HistoryItem {
  id: string
  createdAt: number
  updatedAt: number
  models: string[]
  title?: string
  turns: Array<{
    turnId: string
    userMessage: string
    timestamp: number
    responses: Record<string, string>
  }>
  urls?: Record<string, string>
  productMode?: string
  displayMode?: string
}

/** 与 appStore.ts 的 SummaryHistoryItem 结构对齐（精简到分页所需字段） */
export interface SummaryHistoryItem {
  id: string
  title: string
  timestamp: number
  messages: Array<{ role: string; content: string }>
  selectedModels: string[]
}

export const DISK_LIMIT = 1000

export class HistoryManager {
  constructor(private store: Store<Record<string, unknown>>) {}

  private getHistory(): HistoryItem[] {
    return (this.store.get('history') as HistoryItem[] | undefined) ?? []
  }

  private getSummaryHistory(): SummaryHistoryItem[] {
    return (this.store.get('summaryHistory') as SummaryHistoryItem[] | undefined) ?? []
  }

  private setHistory(items: HistoryItem[]): void {
    this.store.set('history', items)
  }

  private setSummaryHistory(items: SummaryHistoryItem[]): void {
    this.store.set('summaryHistory', items)
  }

  getHistoryPage(offset: number, limit: number): HistoryItem[] {
    return this.getHistory().slice(offset, offset + limit)
  }

  getSummaryHistoryPage(offset: number, limit: number): SummaryHistoryItem[] {
    return this.getSummaryHistory().slice(offset, offset + limit)
  }

  getHistoryTotalCount(): number {
    return this.getHistory().length
  }

  getSummaryHistoryTotalCount(): number {
    return this.getSummaryHistory().length
  }

  /**
   * 把 history / summaryHistory 磁盘数组各自裁到 DISK_LIMIT。
   * 在 store-set 写 history/summaryHistory 后由 ipcHandlers 调用。
   * 异常不影响主流程：调用方已 try/catch 包裹。
   */
  enforceDiskLimit(): void {
    const history = this.getHistory()
    if (history.length > DISK_LIMIT) {
      this.setHistory(history.slice(0, DISK_LIMIT))
    }
    const summaryHistory = this.getSummaryHistory()
    if (summaryHistory.length > DISK_LIMIT) {
      this.setSummaryHistory(summaryHistory.slice(0, DISK_LIMIT))
    }
  }
}
```

- [ ] **Step 2: 在 `src/main/ipcHandlers.ts` 顶部加 import**

在 `:15`（`broadcastStateChange` 那行之后）新增一行：

```typescript
import { HistoryManager } from './api/historyManager'
```

- [ ] **Step 3: 在 `registerIpcHandlers` 内实例化 historyManager**

在 `:531`（`// IPC 处理器：存储操作` 注释前）新增：

```typescript
    // History 分页与磁盘上限管理（只读分页 + store-set 后 enforce）
    const historyManager = new HistoryManager(store)

```

- [ ] **Step 4: 改造 `store-set` handler 加磁盘 enforcement**

把 `:536-538` 的：

```typescript
    ipcMain.handle('store-set', (_event, key: string, value: unknown) => {
        store.set(key, value)
    })
```

替换为：

```typescript
    ipcMain.handle('store-set', (_event, key: string, value: unknown) => {
        store.set(key, value)
        // 写 history/summaryHistory 后 enforce 磁盘上限 1000
        if (key === 'history' || key === 'summaryHistory') {
            try {
                historyManager.enforceDiskLimit()
            } catch (err) {
                console.error('[historyManager] enforceDiskLimit failed:', err)
            }
        }
    })
```

- [ ] **Step 5: 新增 4 个只读分页 handler**

在 `store-delete` handler（`:540-542`）之后新增：

```typescript
    // History 分页（只读）
    ipcMain.handle('history:get-page', (_event, offset: number, limit: number) => {
        return { success: true, data: historyManager.getHistoryPage(offset, limit) }
    })

    ipcMain.handle('history:get-total-count', () => {
        return { success: true, data: historyManager.getHistoryTotalCount() }
    })

    ipcMain.handle('summary-history:get-page', (_event, offset: number, limit: number) => {
        return { success: true, data: historyManager.getSummaryHistoryPage(offset, limit) }
    })

    ipcMain.handle('summary-history:get-total-count', () => {
        return { success: true, data: historyManager.getSummaryHistoryTotalCount() }
    })
```

- [ ] **Step 6: 验证 lint + build**

Run: `npm run lint`
Expected: 无新增 error。

Run: `npm run build`
Expected: 类型检查 + 打包通过。

- [ ] **Step 7: Commit**

```bash
git add src/main/api/historyManager.ts src/main/ipcHandlers.ts
git commit -m "feat: add history pagination manager with 1000-disk-limit enforcement"
```

---

### Task 2: preload 暴露并声明分页方法

**Files:**
- Modify: `src/preload/index.ts:75`（storeDelete 后新增 4 方法）
- Modify: `src/preload/index.d.ts:55`（storeDelete 后新增 4 方法 + 2 类型）

**Interfaces:**
- Consumes: Task 1 的 4 个 IPC channel：`history:get-page`、`history:get-total-count`、`summary-history:get-page`、`summary-history:get-total-count`
- Produces: `window.api.historyGetPage`、`window.api.historyGetTotalCount`、`window.api.summaryHistoryGetPage`、`window.api.summaryHistoryGetTotalCount`

- [ ] **Step 1: 在 `src/preload/index.ts` 的 `api` 对象里，`storeDelete`（:75）之后新增**

```typescript

  // History 分页（只读，磁盘 1000 / 内存 100 分层）
  historyGetPage: (offset: number, limit: number): Promise<{ success: boolean; data?: Array<{ id: string; createdAt: number; updatedAt: number; models: string[]; title?: string; turns: Array<{ turnId: string; userMessage: string; timestamp: number; responses: Record<string, string> }>; urls?: Record<string, string>; productMode?: string; displayMode?: string }>; error?: string }> =>
    ipcRenderer.invoke('history:get-page', offset, limit),
  historyGetTotalCount: (): Promise<{ success: boolean; data?: number; error?: string }> =>
    ipcRenderer.invoke('history:get-total-count'),
  summaryHistoryGetPage: (offset: number, limit: number): Promise<{ success: boolean; data?: Array<{ id: string; title: string; timestamp: number; messages: Array<{ role: string; content: string }>; selectedModels: string[] }>; error?: string }> =>
    ipcRenderer.invoke('summary-history:get-page', offset, limit),
  summaryHistoryGetTotalCount: (): Promise<{ success: boolean; data?: number; error?: string }> =>
    ipcRenderer.invoke('summary-history:get-total-count'),
```

- [ ] **Step 2: 在 `src/preload/index.d.ts` 顶部类型区新增本地类型**

在 `:23`（`AgentPromptFileItem` 接口之后、`declare global` 之前）新增：

```typescript
// History 分页 IPC 用到的只读结构（与 appStore.ts 的 HistoryItem/SummaryHistoryItem 对齐）
interface HistoryPageItem {
  id: string
  createdAt: number
  updatedAt: number
  models: string[]
  title?: string
  turns: Array<{
    turnId: string
    userMessage: string
    timestamp: number
    responses: Record<string, string>
  }>
  urls?: Record<string, string>
  productMode?: string
  displayMode?: string
}

interface SummaryHistoryPageItem {
  id: string
  title: string
  timestamp: number
  messages: Array<{ role: string; content: string }>
  selectedModels: string[]
}
```

- [ ] **Step 3: 在 `index.d.ts` 的 `Window['api']` 接口里，`storeDelete`（:55）之后新增 4 方法声明**

```typescript
      historyGetPage: (offset: number, limit: number) => Promise<{ success: boolean; data?: HistoryPageItem[]; error?: string }>
      historyGetTotalCount: () => Promise<{ success: boolean; data?: number; error?: string }>
      summaryHistoryGetPage: (offset: number, limit: number) => Promise<{ success: boolean; data?: SummaryHistoryPageItem[]; error?: string }>
      summaryHistoryGetTotalCount: () => Promise<{ success: boolean; data?: number; error?: string }>
```

- [ ] **Step 4: 验证 lint + build**

Run: `npm run lint`
Expected: 无新增 error。

Run: `npm run build`
Expected: 通过。

- [ ] **Step 5: Commit**

```bash
git add src/preload/index.ts src/preload/index.d.ts
git commit -m "feat: expose history pagination API in preload"
```

---

### Task 3: renderer store 新增 totalCount/loadMore + 移除启动磁盘裁剪

**Files:**
- Modify: `src/renderer/src/store/appStore.ts`（AppState 接口、store 实现、initializeStore 的 history/summaryHistory 段）

**Interfaces:**
- Consumes: Task 2 的 `window.api.historyGetPage`、`window.api.historyGetTotalCount`、`window.api.summaryHistoryGetPage`、`window.api.summaryHistoryGetTotalCount`
- Produces:
  - state: `historyTotalCount: number`、`summaryHistoryTotalCount: number`
  - actions: `loadMoreHistory(): Promise<void>`、`loadMoreSummaryHistory(): Promise<void>`

- [ ] **Step 1: 定位 AppState 接口中 history 相邻字段，确认插入点**

Run: `grep -n "summaryHistory:" src/renderer/src/store/appStore.ts | head -1`
Expected: 显示 `summaryHistory:` 的行号（约 863 附近）。在其附近的接口定义段确认 `history` / `summaryHistory` 字段位置，准备在其后插入 totalCount 与 loadMore 声明。

- [ ] **Step 2: 在 AppState 接口里新增 state 与 action 声明**

先找到接口中 `summaryHistory:` 字段声明（约 :863）以及 `removeSummaryHistories` 的声明行。在 `removeSummaryHistories` 声明之后新增：

```typescript
  // History 分页：磁盘总量 + 加载更多
  historyTotalCount: number
  summaryHistoryTotalCount: number
  loadMoreHistory: () => Promise<void>
  loadMoreSummaryHistory: () => Promise<void>
```

- [ ] **Step 3: 在 store 实现里给 state 初值**

在 `summaryHistory: []`（约 :863）的实现行之前或之后新增初值：

```typescript
  historyTotalCount: 0,
  summaryHistoryTotalCount: 0,
```

- [ ] **Step 4: 在 store 实现里，`removeSummaryHistories` 实现之后新增 loadMore action**

约在 :885 之后新增：

```typescript
  loadMoreHistory: async () => {
    const state = get()
    if (!window.api?.historyGetPage) return
    const result = await window.api.historyGetPage(state.history.length, 100)
    if (result.success && result.data) {
      set((s) => ({
        history: [...s.history, ...result.data!],
      }))
      // 刷新 totalCount，防止边界变化导致按钮态错位
      const countResult = await window.api.historyGetTotalCount()
      if (countResult.success && countResult.data !== undefined) {
        set({ historyTotalCount: countResult.data })
      }
    }
  },

  loadMoreSummaryHistory: async () => {
    const state = get()
    if (!window.api?.summaryHistoryGetPage) return
    const result = await window.api.summaryHistoryGetPage(state.summaryHistory.length, 100)
    if (result.success && result.data) {
      set((s) => ({
        summaryHistory: [...s.summaryHistory, ...result.data!],
      }))
      const countResult = await window.api.summaryHistoryGetTotalCount()
      if (countResult.success && countResult.data !== undefined) {
        set({ summaryHistoryTotalCount: countResult.data })
      }
    }
  },
```

- [ ] **Step 5: 移除 initializeStore 中 history 的磁盘回写裁剪，改为读 totalCount**

找到 `:1607-1616` 这段（`// 历史记录上限统一为 100 条...` 注释及之后的 trim 逻辑）。把：

```typescript
      } else {
        // 历史记录上限统一为 100 条（原上限 1000 会导致稳态内存偏高）。
        // 老用户首次加载时若已超过上限，仅取最近 100 条进内存，并回写磁盘淘汰旧数据。
        const trimmed = (storedHistory as HistoryItem[]).slice(0, 100)
        useAppStore.setState({ history: trimmed })
        if ((storedHistory as HistoryItem[]).length > trimmed.length) {
          window.api?.storeSet('history', trimmed)
          console.log(`[Store] History trimmed from ${storedHistory.length} to ${trimmed.length} items`)
        }
      }
```

替换为：

```typescript
      } else {
        // 内存热区上限 100；磁盘上限 1000 由 store-set handler 的 enforceDiskLimit 兜底，启动不再回写裁剪磁盘。
        const hotHistory = (storedHistory as HistoryItem[]).slice(0, 100)
        useAppStore.setState({ history: hotHistory })
      }
```

- [ ] **Step 6: 在 history 加载段之后读取 totalCount**

在 Step 5 替换的 `}` 之后（即 history 的 `if (storedHistory && storedHistory.length > 0) {...}` 块之后、`const storedSummaryHistory = ...` 之前）新增：

```typescript
    // 读取磁盘历史总量（用于"加载更多"按钮可见性）
    const historyCountResult = await window.api.historyGetTotalCount()
    if (historyCountResult.success && historyCountResult.data !== undefined) {
      useAppStore.setState({ historyTotalCount: historyCountResult.data })
    }
```

- [ ] **Step 7: 移除 initializeStore 中 summaryHistory 的磁盘回写裁剪，改为读 totalCount**

找到 `:1618-1626` 这段。把：

```typescript
    const storedSummaryHistory = await window.api.storeGet('summaryHistory') as SummaryHistoryItem[] | undefined
    if (storedSummaryHistory) {
      const trimmedSummary = storedSummaryHistory.slice(0, 100)
      useAppStore.setState({ summaryHistory: trimmedSummary })
      if (storedSummaryHistory.length > trimmedSummary.length) {
        window.api?.storeSet('summaryHistory', trimmedSummary)
        console.log(`[Store] SummaryHistory trimmed from ${storedSummaryHistory.length} to ${trimmedSummary.length} items`)
      }
    }
```

替换为：

```typescript
    const storedSummaryHistory = await window.api.storeGet('summaryHistory') as SummaryHistoryItem[] | undefined
    if (storedSummaryHistory) {
      // 内存热区上限 100；磁盘上限 1000 由 store-set handler 兜底，启动不再回写裁剪磁盘。
      const hotSummary = storedSummaryHistory.slice(0, 100)
      useAppStore.setState({ summaryHistory: hotSummary })
    }

    // 读取磁盘总结历史总量
    const summaryCountResult = await window.api.summaryHistoryGetTotalCount()
    if (summaryCountResult.success && summaryCountResult.data !== undefined) {
      useAppStore.setState({ summaryHistoryTotalCount: summaryCountResult.data })
    }
```

- [ ] **Step 8: 验证 lint + build**

Run: `npm run lint`
Expected: 无新增 error。

Run: `npm run build`
Expected: 通过。

- [ ] **Step 9: Commit**

```bash
git add src/renderer/src/store/appStore.ts
git commit -m "feat: add loadMore/totalCount to store; drop startup disk trimming"
```

---

### Task 4: HistoryDrawer 底部"加载更多"按钮

**Files:**
- Modify: `src/renderer/src/components/HistoryDrawer.tsx:30`（解构）、`:255-354`（对话 Virtuoso 后插按钮）、`:355-440+`（总结 Virtuoso 后插按钮）

**Interfaces:**
- Consumes: Task 3 的 `historyTotalCount`、`summaryHistoryTotalCount`、`loadMoreHistory`、`loadMoreSummaryHistory`
- Produces: 抽屉底部"加载更多"按钮，搜索时禁用

- [ ] **Step 1: 在组件顶部加 loading state**

在 `:30` 的解构行之前新增：

```typescript
  const [isLoadingMore, setIsLoadingMore] = useState(false)
```

- [ ] **Step 2: 扩展解构，加入 totalCount 与 loadMore**

把 `:30`：

```typescript
  const { history, summaryHistory, removeHistories, removeSummaryHistories, updateHistory, updateSummaryHistory, models } = useAppStore()
```

替换为：

```typescript
  const {
    history,
    summaryHistory,
    historyTotalCount,
    summaryHistoryTotalCount,
    loadMoreHistory,
    loadMoreSummaryHistory,
    removeHistories,
    removeSummaryHistories,
    updateHistory,
    updateSummaryHistory,
    models
  } = useAppStore()
```

- [ ] **Step 3: 新增 handleLoadMore 回调**

在 Step 2 解构之后（约原 :30 之后）新增：

```typescript
  // 是否还有更老的磁盘记录未加载进内存
  const hasMoreHistory = history.length < historyTotalCount
  const hasMoreSummaryHistory = summaryHistory.length < summaryHistoryTotalCount

  const handleLoadMore = async (type: 'conversation' | 'summary'): Promise<void> => {
    if (isLoadingMore) return
    // 搜索激活时分页会与过滤索引错位，禁用加载更多
    if (searchQuery.trim() !== '') return
    setIsLoadingMore(true)
    try {
      if (type === 'conversation') {
        await loadMoreHistory()
      } else {
        await loadMoreSummaryHistory()
      }
    } catch (err) {
      console.error('[HistoryDrawer] loadMore failed:', err)
    } finally {
      setIsLoadingMore(false)
    }
  }
```

- [ ] **Step 4: 在对话历史 Virtuoso 之后插入"加载更多"按钮**

找到对话 Virtuoso 的闭合 `/>`（约 :353），它在一个三元表达式分支里。在该 `/>` 之后、外层 `: 354` 的 `)` 之前，无法直接插（因为是三元表达式）。改为：把整个对话分支从三元改为带尾随按钮的结构。

把 `:264-354` 这段（从 `<Virtuoso` 到 `/>` 结束）的 Virtuoso 闭合后，原结构是：

```tsx
              <Virtuoso
                data={filteredHistory}
                itemContent={(_index, item) => {
                  ...
                }}
              />
            )
```

替换为（用 Fragment 包裹 Virtuoso + 按钮）：

```tsx
              <>
                <Virtuoso
                  data={filteredHistory}
                  itemContent={(_index, item) => {
                    const isSelected = selectedIds.includes(item.id)
                    const isActive = activeHistoryId === item.id
                    return (
                      <div className="pb-3">
                        {/* ...原 itemContent 内部 JSX 保持不变... */}
                      </div>
                    )
                  }}
                />
                {hasMoreHistory && (
                  <button
                    onClick={() => handleLoadMore('conversation')}
                    disabled={isLoadingMore || searchQuery.trim() !== ''}
                    className="w-full mt-2 py-2 text-sm text-text-secondary hover:text-primary border border-gray-200 rounded-lg transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {isLoadingMore ? '加载中...' : searchQuery.trim() !== '' ? '搜索时不支持加载更多' : '加载更多历史记录'}
                  </button>
                )}
              </>
            )
```

注意：`itemContent` 内部那段从 `const isSelected = selectedIds.includes(item.id)` 到 `</div>` 闭合的完整 JSX（原 :266-351）必须**原样保留**，只是缩进随 Fragment 调整。实施时务必逐行核对，不要漏掉任何子节点。

- [ ] **Step 5: 在总结历史 Virtuoso 之后插入"加载更多"按钮**

找到总结 Virtuoso（约 :363 起）的闭合 `/>`，对其做与 Step 4 相同的 Fragment 包裹处理，在 `/>` 之后插入：

```tsx
                {hasMoreSummaryHistory && (
                  <button
                    onClick={() => handleLoadMore('summary')}
                    disabled={isLoadingMore || searchQuery.trim() !== ''}
                    className="w-full mt-2 py-2 text-sm text-text-secondary hover:text-primary border border-gray-200 rounded-lg transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {isLoadingMore ? '加载中...' : searchQuery.trim() !== '' ? '搜索时不支持加载更多' : '加载更多总结历史'}
                  </button>
                )}
```

同样用 `<>...</>` Fragment 把 Virtuoso 和这个按钮一起包起来。总结 Virtuoso 的 `itemContent` 内部 JSX 原样保留。

- [ ] **Step 6: 验证 lint + build**

Run: `npm run lint`
Expected: 无新增 error。

Run: `npm run build`
Expected: 通过。

- [ ] **Step 7: Commit**

```bash
git add src/renderer/src/components/HistoryDrawer.tsx
git commit -m "feat: add load-more button to HistoryDrawer"
```

---

### Task 5: 端到端手动验证

**Files:** 无（仅验证）

- [ ] **Step 1: 启动 dev**

Run: `npm run dev`
Expected: 桌面窗口打开。

- [ ] **Step 2: 验证写路径不回归 + 磁盘 enforcement**

在 dev 中发送若干对话产生 history 条目，确认新增/重命名/删除历史正常落盘（检查 `%APPDATA%\MultiChat Desk-dev\config.json` 的 `history` 数组）。
说明：构造 >1000 条需脚本注入，本机若不便构造，最小等价验证 = 确认 `enforceDiskLimit` 在 store-set 后被调用（可在主进程临时加 `console.log` 验证 key 命中），并确认磁盘数组不会因启动被回写裁剪。

- [ ] **Step 3: 验证启动不再裁剪磁盘**

先在 config.json 手动塞入 500 条 history（可复制现有条目改 id），重启 dev。
Expected: 内存 100 条；磁盘仍 500 条（不再被回写裁到 100）；`historyTotalCount` 显示 500（可通过按钮可见性反推）。

- [ ] **Step 4: 验证加载更多**

磁盘 300 条时：内存 100 → 点"加载更多历史记录" → 内存 200 → 再点 → 300 → 按钮消失。
Expected: 按钮在 `内存条数 < totalCount` 时可见，等于后消失。

- [ ] **Step 5: 验证搜索隔离**

输入搜索词后，"加载更多"按钮禁用并显示"搜索时不支持加载更多"。
清空搜索词后按钮恢复可点。

- [ ] **Step 6: 验证 summaryHistory 对称**

对总结历史重复 Step 4-5。

- [ ] **Step 7: 记录 session log**

Run: `python .memory/session_log.py --done "history 分层存储：磁盘 1000/内存 100 + 加载更多按钮" --modified "src/main/api/historyManager.ts src/main/ipcHandlers.ts src/preload/index.ts src/preload/index.d.ts src/renderer/src/store/appStore.ts src/renderer/src/components/HistoryDrawer.tsx"`
Expected: SESSION_LOG.md 追加一条。

---

## Self-Review

### 1. Spec Coverage

| Spec 要求 | Task | 状态 |
|-----------|------|------|
| 磁盘上限 1000 | Task 1 (DISK_LIMIT + enforceDiskLimit + store-set 改造) | ✅ |
| 内存维持 100 | Task 3 (slice(0,100) 保留、初值不动 addHistory) | ✅ |
| 移除启动磁盘回写裁剪 | Task 3 Step 5/7 | ✅ |
| 手动加载更多按钮 | Task 4 | ✅ |
| 搜索时禁用 | Task 4 Step 3/4/5 | ✅ |
| 类型单源/不重定义跨层 | Global Constraints + Task 1 本地定义、Task 2 本地声明、结构对齐 | ✅ |
| summaryHistory 对称 | Task 1/2/3/4 全程对称 | ✅ |
| IPC 四端同步 | Task 1(handler) + Task 2(preload/d.ts) + Task 3(renderer 调用) | ✅ |

### 2. Placeholder Scan

- 无 "TBD"/"TODO"/"implement later"。
- Task 4 Step 4/5 的 "itemContent 内部 JSX 保持不变" 指向已存在的具体行（:266-351），并非凭空占位；实施时须逐行核对。
- 所有 code step 均含完整可运行代码。

### 3. Type Consistency

- `DISK_LIMIT` 在 Task 1 定义为 1000，全文一致使用。
- IPC channel 名四端一致：`history:get-page` / `history:get-total-count` / `summary-history:get-page` / `summary-history:get-total-count`。
- renderer 方法名 `historyGetPage` / `historyGetTotalCount` / `summaryHistoryGetPage` / `summaryHistoryGetTotalCount` 在 Task 2(preload/d.ts) 与 Task 3(store 调用) 一致。
- store 新增字段 `historyTotalCount` / `summaryHistoryTotalCount` / `loadMoreHistory` / `loadMoreSummaryHistory` 在 Task 3 声明+实现、Task 4 解构，命名一致。
- main 的 `HistoryItem`/`SummaryHistoryItem` 与 preload 的 `HistoryPageItem`/`SummaryHistoryPageItem` 结构对齐（字段集合一致，仅命名不同以避免跨层 import 冲突）。
