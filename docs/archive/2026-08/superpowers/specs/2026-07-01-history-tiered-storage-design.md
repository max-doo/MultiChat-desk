# History 分层存储设计：磁盘 1000 / 内存 100 + 手动加载更多

> Created: 2026-07-01 22:24 (+08:00)

## 背景与动机

现状代码中 history / summaryHistory 的磁盘与内存上限**都是 100 条**，且 `initializeStore` 在启动时若磁盘超过 100 条会**回写磁盘**把磁盘也裁到 100 条（appStore.ts:1611-1614、:1622-1624）。这意味着老记录被**永久销毁**，对高频多模型重度用户构成数据丢失风险。

本设计把"数据保留"与"内存热区"分层：

- **磁盘保留最近 1000 条**，不销毁，作为数据保底。
- **内存只加载最近 100 条**，维持现状上限（Virtuoso 已解决渲染性能，100 条内存开销可忽略）。
- 用户需要更老记录时，点抽屉底部"加载更多"按钮按页拉取，每页 100 条追加进内存。

## 非目标（YAGNI）

- 不做 Virtuoso `endReached` 自动懒加载（其与 `filteredHistory` 过滤索引错位，复杂度高、收益低）。
- 不做后端搜索（搜索继续走内存过滤）。
- 不在 historyManager 中实现 append/update/delete 写方法（写路径维持现有 `storeSet` 直写）。
- 不把内存热区从 100 降到 50（Virtuoso 已解决渲染，100 条内存开销极小，降 50 无实测收益）。

## 架构

### 数据流

```
addHistory(item)
  → storeSet('history', 内存前100)            // renderer 维持现状，只写热区
  → 主进程 store.set + enforceDiskLimit(1000)  // 磁盘单点 enforcement，保留 1000

启动
  → initializeStore 读磁盘前 100 进内存（热区）
  → 读 totalCount（磁盘总量，用于按钮可见性判断）
  → 移除启动时的磁盘回写裁剪逻辑

点"加载更多"
  → historyGetPage(offset = 内存当前长度, limit = 100)
  → append 到内存末尾（磁盘顺序 新→旧，与内存前插顺序一致，append 天然正确）
```

### 关键设计决策

1. **手动按钮 vs endReached**：选手动按钮，彻底规避 Virtuoso `endReached` 与 `filteredHistory` 的索引错位问题。
2. **写路径不动**：renderer 的 `addHistory` / `removeHistory` 等维持 `storeSet` 直写；磁盘 1000 上限由主进程 `store-set` handler 单点 enforcement，renderer 无感知。
3. **类型单源**：主进程从 renderer 侧 `import { HistoryItem, SummaryHistoryItem }`，**不重定义**类型，杜绝双源真相。
4. **搜索隔离**：搜索框激活时禁用"加载更多"按钮并提示"仅在未搜索时可用"，避免分页污染搜索结果。

## 改动范围（4 处，全部最小化）

### 1. 主进程 — 新增 `src/main/api/historyManager.ts`

只读分页 manager，持有 `electron-store` 实例：

- `getHistoryPage(offset, limit): HistoryItem[]` — 磁盘全量 `slice(offset, offset+limit)`
- `getSummaryHistoryPage(offset, limit): SummaryHistoryItem[]`
- `getHistoryTotalCount(): number`
- `getSummaryHistoryTotalCount(): number`
- `enforceDiskLimit(): void` — 把 `history` / `summaryHistory` 各自裁到 `DISK_LIMIT = 1000`

类型从 renderer import，不重定义。`DISK_LIMIT` 常量定义于此文件。

### 2. 主进程 — `src/main/ipcHandlers.ts`

- 新增 4 个只读 IPC handler：
  - `history:get-page` → `historyManager.getHistoryPage(offset, limit)`
  - `history:get-total-count` → `historyManager.getHistoryTotalCount()`
  - `summary-history:get-page` → `historyManager.getSummaryHistoryPage(offset, limit)`
  - `summary-history:get-total-count` → `historyManager.getSummaryHistoryTotalCount()`
- **改造现有 `store-set` handler**：写完后若 `key === 'history' || key === 'summaryHistory'`，调用 `historyManager.enforceDiskLimit()`。
- 所有返回结构统一 `{ success: true, data }`。
- IPC 契约同步：`ipcHandlers.ts` ↔ `preload/index.ts` ↔ `preload/index.d.ts` ↔ renderer 调用点。

### 3. preload — `index.ts` + `index.d.ts`

暴露并声明类型：

- `historyGetPage(offset, limit): Promise<{ success: boolean; data?: HistoryItem[]; error?: string }>`
- `historyGetTotalCount(): Promise<{ success: boolean; data?: number; error?: string }>`
- `summaryHistoryGetPage(offset, limit): Promise<{ success: boolean; data?: SummaryHistoryItem[]; error?: string }>`
- `summaryHistoryGetTotalCount(): Promise<{ success: boolean; data?: number; error?: string }>`

### 4. renderer — `appStore.ts` + `HistoryDrawer.tsx`

**appStore.ts：**

- `AppState` 新增：`historyTotalCount: number`、`summaryHistoryTotalCount: number`、`loadMoreHistory(): Promise<void>`、`loadMoreSummaryHistory(): Promise<void>`
- `loadMoreHistory`：调 `window.api.historyGetPage(history.length, 100)`，成功则 `set` 把 `data` append 到 `history` 末尾；同时刷新 `historyTotalCount`（防止边界变化）。
- `loadMoreSummaryHistory`：同模式。
- `initializeStore`：
  - history 加载段：保留读磁盘前 100 进内存（热区逻辑），**移除** `:1611-1614` 的磁盘回写裁剪；改用 `window.api.historyGetTotalCount()` 填充 `historyTotalCount`。
  - summaryHistory 加载段：同理移除 `:1622-1624` 回写裁剪；填充 `summaryHistoryTotalCount`。
  - 旧格式迁移逻辑（`:1586-1605`）保留不变。
- `addHistory` / `addSummaryHistory` 的 `slice(0, 100)` 维持不变（内存热区上限 100）。

**HistoryDrawer.tsx：**

- 从 store 解构新增的 `historyTotalCount`、`summaryHistoryTotalCount`、`loadMoreHistory`、`loadMoreSummaryHistory`。
- 抽屉底部加"加载更多"按钮，**可见条件** = `内存条数 < totalCount`（即还有更老记录未加载）。
- **禁用条件** = `searchQuery !== ''`（搜索激活时禁用，并提示"仅在未搜索时可用"）。
- 点击调用 `loadMoreHistory()` / `loadMoreSummaryHistory()`（按 `activeTab` 分支）。
- loading 态：按钮文案切"加载中..."并禁用，防止重复点击。

## 错误处理

- IPC 失败时 `loadMoreHistory` 静默 catch，按钮恢复可点（不阻断 UI）；控制台 `console.error`。
- `enforceDiskLimit` 内部异常不应影响 `store-set` 主流程：try/catch 包裹，失败仅记日志。
- `historyGetPage` 返回空数组时（offset 越界），按钮按 `内存条数 < totalCount` 判断仍正确隐藏。

## 验证计划

项目无自动化测试，遵循 `npm run lint` → `npm run build` → `npm run dev` 手动验证：

1. **lint + build 通过**。
2. **磁盘 enforcement**：构造 >1000 条 history（dev 下脚本注入或手动快速发送），确认磁盘 config.json 中 `history` 数组长度 ≤ 1000，旧于 1000 的被淘汰。
3. **启动不裁剪磁盘**：磁盘有 500 条时启动，确认磁盘仍为 500（不再被回写裁到 100）；内存为 100；`historyTotalCount = 500`。
4. **加载更多**：磁盘 300 条，内存 100，点"加载更多"→ 内存变 200，再点 → 300，按钮消失（`100→200→300 = totalCount`）。
5. **搜索隔离**：搜索激活时"加载更多"禁用且有提示。
6. **写路径不回归**：新增 / 删除 / 重命名 history 仍正常落盘，且磁盘上限仍 1000。
7. **summaryHistory 对称**：重复 3-6 验证总结历史。
