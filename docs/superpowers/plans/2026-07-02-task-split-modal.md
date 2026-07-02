# 任务分发拆解弹窗（TaskSplitModal）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** task_assignment 模式拆解失败时不再静默，弹出 `TaskSplitModal` 显示进度/错误、可在弹窗内选拆解供应商+模型（写回 `apiConfig`）、编辑槽位→webview 绑定（写回 `taskAssignmentSlots`）、重试拆解；成功后回 inline 流程。

**Architecture:** 纯 renderer 层。复用现有 `split-task` IPC / `taskSplitApi` / `useTaskSplit`。新增 `TaskSplitModal`，改造 `useTaskSplit`（`split` 返回 `{ok,error}`；移除内部 `error` state，错误统一经返回值传递 + 新增 `persistProvider`）与 `TaskModePanel`（失败开弹窗）。happy path 不变。

**Tech Stack:** TypeScript (strict), React 18, Zustand 4, Tailwind CSS 3, electron-vite。无测试运行器，验证 = `npm run lint` + `npm run build` + `npm run dev` 手动验证。

## Global Constraints

- 严格 TypeScript，禁止 `any` 静默错误；故意未用变量以 `_` 前缀。
- 仅 renderer 层改动；不动 main / preload / IPC / `taskSplitApi` / `selectors` / `webviewScripts`。
- 复用 `appStore` 现有 setter：`setApiConfig`（已内置 `storeSet('apiConfig')` 持久化，会剥离 `agentPrompts`，见 `appStore.ts:847-853`）、`setTaskAssignmentSlot`（已内置持久化，见 `appStore.ts:694-699`）、`setSettingsOpen`。
- 供应商取数口径：`apiConfig.providers.filter(p => p.enabled)`；模型取数口径：`summaryModels.filter(m => m.providerId === selectedProviderId)`。与 `SummaryPanel` 一致。
- 弹窗风格对齐现有 `ConfirmModal`/`RenameModal`：`z-[100]`、`bg-black/60 backdrop-blur-sm`、`animate-in fade-in/zoom-in-95`、遮罩层与内容层分离、Esc 关闭。
- 错误传递单一来源：`useTaskSplit.split` 返回 `{ok, error?}`，移除 hook 内部 `error` state（避免 inline/弹窗两路径"双写"语义模糊）。`isLoading` 仍由 hook 暴露供按钮态。
- 包管理器只用 npm。禁止擅自切分支。
- 每个任务结束跑 `npm run lint`（或对受影响文件 `npm run lint:fix`）+ `npm run build`，确保类型与构建通过。

---

## File Structure

- **Create** `src/renderer/src/components/modes/TaskSplitModal.tsx` — 出错恢复弹窗：进度/错误展示 + 拆解供应商/模型选择 + 槽位编辑 + 重试。单一职责。
- **Modify** `src/renderer/src/hooks/useTaskSplit.ts` — `split` 返回 `{ok,error}`，移除内部 `error` state；新增 `persistProvider(providerId, agentId)`；返回值 `{ split, abort, isLoading, persistProvider }`。
- **Modify** `src/renderer/src/components/modes/TaskModePanel.tsx` — `handleSplit` 检查返回值，失败开弹窗；挂载 `TaskSplitModal`；本地 `modalOpen`/`modalError` state。

---

### Task 1: `useTaskSplit` 返回结构化结果 + 新增 `persistProvider`（移除内部 error state）

**Files:**
- Modify: `src/renderer/src/hooks/useTaskSplit.ts`

**Interfaces:**
- Produces: `split(goal: string): Promise<{ ok: boolean; error?: string }>`；`persistProvider(providerId: string, agentId: string): void`；`useTaskSplit()` 返回 `{ split, abort, isLoading, persistProvider }`（**不再返回 `error`**）。
- Consumes: `appStore` 的 `apiConfig`、`setApiConfig`（已持久化）。

**设计说明：**
- 移除内部 `error` state：错误经返回值 `{ok, error?}` 传递。`TaskModePanel` 在 inline 失败路径用 `r.error` → `setModalError` → 开弹窗；弹窗内重试用同一返回值。这样错误只有一个消费点，避免 `error` state 成为无人读的死状态。
- `persistProvider` 直接写 `agentId` 不校验模型归属：`resolveProvider` 已有回退（`useTaskSplit.ts:27`，模型不存在时取该供应商下第一个 summaryModel），功能不会崩。语义上写入的 id 可能与实际生效模型不一致，但与 `SummaryPanel` 的有效性判断行为差异在可接受范围（弹窗内已强制用户选了合法模型）。

- [ ] **Step 1: 改 `split` 返回值类型、移除 `error` state、改所有返回点**

把 `src/renderer/src/hooks/useTaskSplit.ts` 顶部 import 与 hook 主体替换。完整替换文件第 1-82 行：

```ts
import { useState, useCallback, useRef, useEffect } from 'react'
import { useAppStore } from '../store/appStore'

/**
 * 封装任务拆解 IPC：复用总结供应商配置，调用 split-task。
 * 成功后写入 store 的 taskState.subtasks（按槽位顺序指派默认模型）。
 * 错误经返回值 { ok, error? } 传递，不维护内部 error state。
 */
export function useTaskSplit() {
  const [isLoading, setIsLoading] = useState(false)
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

  const split = useCallback(async (goal: string): Promise<{ ok: boolean; error?: string }> => {
    if (!goal.trim() || isLoading) return { ok: false, error: '目标为空或正在拆解中' }
    const provider = resolveProvider()
    if (!provider) {
      return { ok: false, error: '未配置可用的总结 API 供应商，请在弹窗中选择或先在设置中配置' }
    }
    setIsLoading(true)
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
      if (abortRef.current) return { ok: false, error: '已中止' }
      if (!result.success || !result.data) {
        return { ok: false, error: result.error || '拆解失败' }
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
      return { ok: true }
    } catch (err) {
      return { ok: false, error: String(err) }
    } finally {
      setIsLoading(false)
    }
  }, [isLoading, resolveProvider, models, setTaskSubtasks, setTaskPhase, toggleTaskCollapsed])

  // 写回拆解供应商+模型到 apiConfig（setApiConfig 已内置 storeSet 持久化，会剥离 agentPrompts）
  const persistProvider = useCallback((providerId: string, agentId: string) => {
    const setApiConfig = useAppStore.getState().setApiConfig
    const current = useAppStore.getState().apiConfig
    setApiConfig({
      ...current,
      activeProviderId: providerId,
      lastSelectedAgentId: agentId
    })
  }, [])

  const abort = useCallback(async () => {
    abortRef.current = true
    await window.api.abortSplitTask()
    setIsLoading(false)
  }, [])

  useEffect(() => () => { abortRef.current = true }, [])

  return { split, abort, isLoading, persistProvider }
}
```

- [ ] **Step 2: 校验类型与构建**

Run: `npm run build`
Expected: 通过。`TaskModePanel` 当前 `const { split, isLoading } = useTaskSplit()` 不解构 `error`，移除 `error` 不影响；`await split()` 仍合法。

- [ ] **Step 3: lint**

Run: `npm run lint`
Expected: 无新增警告。

- [ ] **Step 4: Commit**

```bash
git add src/renderer/src/hooks/useTaskSplit.ts
git commit -m "feat: return structured result from useTaskSplit and add persistProvider"
```

---

### Task 2: 新建 `TaskSplitModal` 组件

**Files:**
- Create: `src/renderer/src/components/modes/TaskSplitModal.tsx`

**Interfaces:**
- Consumes: `useAppStore`（`apiConfig`、`summaryModels`、`models`、`taskAssignmentSlots`、`setTaskAssignmentSlot`、`setSettingsOpen`、`taskState.query`）；`useTaskSplit()`（`split`、`abort`、`isLoading`、`persistProvider`）。
- Produces: `TaskSplitModal` 组件，props `{ open, initialError, onClose, showNotification }`。

**关键设计点（修订）：**
- **中止逻辑可靠化**：`!open` 时组件 `return null` 但 React 实例不卸载，依赖 `isLoading` 变化的 cleanup 不可靠。改为：`onClose` 内显式 `if (isLoading) abort()`；并加 Esc 键监听。
- **Esc 关闭 + loading 中 Esc 中止**：对齐 `RenameModal` 的 Esc 处理。
- **`CustomDropdown` props 对齐**：`value: T | null`（传 `string` 合法），`onChange: (value: T) => void`，`renderContent?: (onClose) => ReactNode`，`displayText?: string`。见 `CustomDropdown.tsx:18-49`。
- 弹窗 z-index / 遮罩 / 动画对齐 `ConfirmModal`/`RenameModal`。

- [ ] **Step 1: 创建组件文件**

创建 `src/renderer/src/components/modes/TaskSplitModal.tsx`，完整内容：

```tsx
import { useState, useEffect, useCallback } from 'react'
import { useAppStore } from '../../store/appStore'
import { useTaskSplit } from '../../hooks/useTaskSplit'
import CustomDropdown from '../CustomDropdown'

interface TaskSplitModalProps {
  open: boolean
  initialError: string | null
  onClose: () => void
  showNotification: (type: 'success' | 'error' | 'info', msg: string, autoHide?: number) => void
}

function TaskSplitModal({ open, initialError, onClose, showNotification }: TaskSplitModalProps): JSX.Element | null {
  const apiConfig = useAppStore((s) => s.apiConfig)
  const summaryModels = useAppStore((s) => s.summaryModels)
  const models = useAppStore((s) => s.models)
  const taskAssignmentSlots = useAppStore((s) => s.taskAssignmentSlots)
  const setTaskAssignmentSlot = useAppStore((s) => s.setTaskAssignmentSlot)
  const setSettingsOpen = useAppStore((s) => s.setSettingsOpen)
  const query = useAppStore((s) => s.taskState.query)
  const { split, abort, isLoading, persistProvider } = useTaskSplit()

  const enabledProviders = apiConfig.providers.filter(p => p.enabled)
  const [providerId, setProviderId] = useState(apiConfig.activeProviderId || '')
  const [agentId, setAgentId] = useState(apiConfig.lastSelectedAgentId || '')
  const [error, setError] = useState<string | null>(initialError)

  // 打开时同步当前配置；initialError 变化时同步错误
  useEffect(() => {
    if (open) {
      setProviderId(apiConfig.activeProviderId || '')
      setAgentId(apiConfig.lastSelectedAgentId || '')
      setError(initialError)
    }
  }, [open, initialError, apiConfig.activeProviderId, apiConfig.lastSelectedAgentId])

  // 关闭前若仍在 loading，显式中止（!open 时组件 return null 不卸载，cleanup 不可靠）
  const closeWithAbort = useCallback(() => {
    if (isLoading) void abort()
    onClose()
  }, [isLoading, abort, onClose])

  // Esc 关闭
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeWithAbort()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, closeWithAbort])

  if (!open) return null

  const providerModels = summaryModels.filter(m => m.providerId === providerId)
  const selectedProvider = enabledProviders.find(p => p.id === providerId)
  const selectedModel = providerModels.find(m => m.id === agentId)

  const handleProviderChange = (newProviderId: string) => {
    setProviderId(newProviderId)
    const newModels = summaryModels.filter(m => m.providerId === newProviderId)
    const stillValid = agentId && newModels.some(m => m.id === agentId)
    setAgentId(stillValid ? agentId : (newModels[0]?.id || ''))
  }

  const handleSplit = async () => {
    if (!providerId || !agentId) {
      setError('请先选择供应商和模型')
      return
    }
    persistProvider(providerId, agentId)
    setError(null)
    const r = await split(query)
    if (r.ok) {
      showNotification('success', '拆解完成')
      onClose()
    } else {
      setError(r.error || '拆解失败')
    }
  }

  const canSplit = !!providerId && !!agentId && !isLoading

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
      {/* 遮罩层 */}
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm animate-in fade-in duration-200"
        onClick={closeWithAbort}
      />
      {/* 弹窗内容 */}
      <div className="relative w-[480px] max-w-[90vw] bg-app border border-gray-200 rounded-2xl shadow-2xl p-6 animate-in zoom-in-95 duration-200">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-bold text-text-primary">任务拆解</h2>
          <button onClick={closeWithAbort} className="text-text-secondary hover:text-text-primary">
            <span className="material-symbols-outlined">close</span>
          </button>
        </div>

        {/* 进度 / 错误 */}
        {isLoading && (
          <div className="flex items-center gap-2 mb-4 text-text-secondary text-sm">
            <span className="material-symbols-outlined animate-spin">sync</span>
            拆解中…
          </div>
        )}
        {error && !isLoading && (
          <div className="mb-4 px-3 py-2 rounded-md bg-red-50 border border-red-200 text-red-600 text-sm">
            {error}
          </div>
        )}

        {/* 拆解模型区 */}
        <div className="mb-4">
          <div className="text-xs font-medium text-text-secondary mb-2">拆解模型</div>
          <div className="flex items-center gap-2">
            <CustomDropdown
              value={providerId}
              onChange={handleProviderChange}
              placeholder="选择供应商"
              className="min-w-[120px]"
              displayText={selectedProvider?.name || '选择供应商'}
              renderContent={(onCloseDropdown) => (
                <>
                  {enabledProviders.map(p => (
                    <button
                      key={p.id}
                      onClick={() => { handleProviderChange(p.id); onCloseDropdown() }}
                      className={`block w-full px-3 py-2 text-left text-sm transition-colors hover:bg-gray-100 whitespace-nowrap ${providerId === p.id ? 'text-primary bg-primary/5' : 'text-text-secondary'}`}
                    >
                      {p.name}
                    </button>
                  ))}
                  {enabledProviders.length === 0 && (
                    <div className="px-3 py-2 text-gray-500 text-xs whitespace-nowrap">请先启用供应商</div>
                  )}
                </>
              )}
            />
            <CustomDropdown
              value={agentId}
              onChange={setAgentId}
              placeholder="选择模型"
              className="min-w-[120px]"
              displayText={selectedModel?.name || '选择模型'}
              renderContent={(onCloseDropdown) => (
                <>
                  {providerModels.map(m => (
                    <button
                      key={m.id}
                      onClick={() => { setAgentId(m.id); onCloseDropdown() }}
                      className={`block w-full px-3 py-2 text-left text-sm transition-colors hover:bg-gray-100 whitespace-nowrap ${agentId === m.id ? 'text-primary bg-primary/5' : 'text-text-secondary'}`}
                    >
                      {m.name}
                    </button>
                  ))}
                  {providerModels.length === 0 && (
                    <div className="px-3 py-2 text-gray-500 text-xs whitespace-nowrap">该供应商下无模型</div>
                  )}
                </>
              )}
            />
          </div>
          <button
            onClick={() => { closeWithAbort(); setSettingsOpen(true) }}
            className="mt-2 text-xs text-primary hover:underline"
          >
            管理供应商…
          </button>
        </div>

        {/* 槽位分配区 */}
        <div className="mb-4">
          <div className="text-xs font-medium text-text-secondary mb-2">槽位分配（每个槽位 = 一个 webview 窗口）</div>
          <div className="flex flex-col gap-2">
            {taskAssignmentSlots.map((slotModelId, i) => {
              const slotModel = models.find(m => m.id === slotModelId)
              return (
                <div key={i} className="flex items-center gap-2">
                  <span className="text-sm text-text-secondary w-12">槽位 {i}</span>
                  <CustomDropdown
                    value={slotModelId}
                    onChange={(newId) => setTaskAssignmentSlot(i, newId)}
                    placeholder="选择 AI"
                    className="min-w-[160px]"
                    displayText={slotModel?.name || '选择 AI'}
                    renderContent={(onCloseDropdown) => (
                      <>
                        {models.map(m => (
                          <button
                            key={m.id}
                            onClick={() => { setTaskAssignmentSlot(i, m.id); onCloseDropdown() }}
                            className={`block w-full px-3 py-2 text-left text-sm transition-colors hover:bg-gray-100 whitespace-nowrap ${slotModelId === m.id ? 'text-primary bg-primary/5' : 'text-text-secondary'}`}
                          >
                            {m.name}
                          </button>
                        ))}
                      </>
                    )}
                  />
                </div>
              )
            })}
          </div>
        </div>

        {/* 底部 */}
        <div className="flex items-center justify-end gap-2">
          <button
            onClick={closeWithAbort}
            disabled={isLoading}
            className="px-3 py-1.5 rounded-xl bg-sidebar text-text-secondary hover:bg-gray-100 border border-gray-200 text-sm disabled:opacity-50 disabled:cursor-not-allowed"
          >
            取消
          </button>
          <button
            onClick={handleSplit}
            disabled={!canSplit}
            className="px-4 py-1.5 rounded-xl bg-primary text-white hover:opacity-90 text-sm disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isLoading ? '拆解中…' : '拆解'}
          </button>
        </div>
      </div>
    </div>
  )
}

export default TaskSplitModal
```

- [ ] **Step 2: 校验 `CustomDropdown` 与类型**

Run: `npm run build`
Expected: 通过。`CustomDropdown` 泛型默认 `T=string`，`value: string` 合法赋给 `T | null`；`onChange` 传 `setAgentId`（`Dispatch<SetStateAction<string>>` 接收 `string` 兼容）。若类型报错，按 `CustomDropdown.tsx:18-49` 真实 props 调整。

- [ ] **Step 3: lint**

Run: `npm run lint`
Expected: 无新增警告。`useTaskSplit` 已不返回 `error`，本组件不解构 `error` 一致。

- [ ] **Step 4: Commit**

```bash
git add src/renderer/src/components/modes/TaskSplitModal.tsx
git commit -m "feat: add TaskSplitModal recovery surface for split failures"
```

---

### Task 3: `TaskModePanel` 失败开弹窗 + 挂载弹窗

**Files:**
- Modify: `src/renderer/src/components/modes/TaskModePanel.tsx`

**Interfaces:**
- Consumes: Task 1 的 `split` 返回 `{ok,error}`（不再有 `error` state）；Task 2 的 `TaskSplitModal`。
- Produces: `TaskModePanel` 在拆解失败时打开弹窗。

- [ ] **Step 1: 引入 `useState` 与 `TaskSplitModal`**

把 `TaskModePanel.tsx` 顶部 import 改为：

```tsx
import { useRef, useState } from 'react'
import { useAppStore } from '../../store/appStore'
import { useTaskSplit } from '../../hooks/useTaskSplit'
import SubtaskList from './SubtaskList'
import TaskSplitModal from './TaskSplitModal'
```

- [ ] **Step 2: 添加本地弹窗 state**

在 `const { split, isLoading } = useTaskSplit()` 之后（约第 26 行后）插入：

```tsx
  const [modalOpen, setModalOpen] = useState(false)
  const [modalError, setModalError] = useState<string | null>(null)
```

- [ ] **Step 3: 改 `handleSplit` 检查返回值**

把现有 `handleSplit` 替换为：

```tsx
  const handleSplit = async () => {
    if (!taskState.query.trim() || isLoading) return
    const r = await split(taskState.query)
    if (!r.ok) {
      setModalError(r.error ?? '拆解失败')
      setModalOpen(true)
    }
  }
```

- [ ] **Step 4: 挂载弹窗**

在 `TaskModePanel` 的 `return` 内，最外层 `<div>` 闭合前（`</div>` 之前，约第 149 行前）插入：

```tsx
      <TaskSplitModal
        open={modalOpen}
        initialError={modalError}
        onClose={() => setModalOpen(false)}
        showNotification={showNotification}
      />
```

- [ ] **Step 5: 构建与 lint**

Run: `npm run build && npm run lint`
Expected: 通过。

- [ ] **Step 6: Commit**

```bash
git add src/renderer/src/components/modes/TaskModePanel.tsx
git commit -m "feat: open TaskSplitModal on split failure in TaskModePanel"
```

---

### Task 4: 手动验证（npm run dev）

**Files:** 无代码改动。

- [ ] **Step 1: 启动 dev**

Run: `npm run dev`

- [ ] **Step 2: 验证未配置供应商路径**

清空本地配置（`npm run clean:store`）或在设置里禁用所有供应商 → 切到"任务分配"模式 → 输入总目标 → 点"拆解"。
Expected: 弹出 `TaskSplitModal`，提示未配置；供应商下拉为空或提示"请先启用供应商"；"拆解"按钮禁用；点"管理供应商"能打开设置抽屉。

> ⚠️ 验证完用 `clean:store` 清空过的配置需重新配置供应商/Key 后再继续后续步骤。

- [ ] **Step 3: 验证弹窗内选模型 + 重试成功**

在弹窗内（或经"管理供应商"配置后回到弹窗）选供应商+模型 → 点"拆解"。
Expected: 弹窗内显示"拆解中…"；成功后弹窗关闭、ControlBar 出现 inline 子任务列表（`SubtaskList`）；通知"拆解完成"。

- [ ] **Step 4: 验证 Key 错误重试**

在设置里配一个无效 Key 的供应商 → 点"拆解"。
Expected: 弹窗弹出并显示错误（如 `拆解请求失败 (401): ...`）；改选正确模型后重试成功。

- [ ] **Step 5: 验证槽位编辑**

弹窗内把某槽位改成另一个 AI → 关弹窗 → 点"一键发送"。
Expected: 子任务只发送到改后的槽位对应的 webview（`handleSend` 用最新 `taskAssignmentSlots`）。

- [ ] **Step 6: 验证中止与 Esc**

弹窗内点"拆解"开始 loading → 按 Esc 或点遮罩/取消。
Expected: 触发 `abort()`，loading 结束，弹窗关闭；不残留"拆解中…"状态。

- [ ] **Step 7: 验证 happy path 不回归**

配置正常供应商+Key → 点"拆解"。
Expected: 不弹窗，inline 子任务列表出现；"一键发送"正常分发。

- [ ] **Step 8: 记录 session log**

Run:
```bash
python .memory/session_log.py --done "任务分发拆解失败弹窗（TaskSplitModal）落地：拆解失败不再静默，弹窗内可选拆解模型并写回 apiConfig、可编辑槽位并写回 taskAssignmentSlots、可重试；移除 useTaskSplit 内部 error state 统一经返回值传递；Esc/遮罩关闭时显式中止；happy path 不变" --modified "src/renderer/src/hooks/useTaskSplit.ts" --added "src/renderer/src/components/modes/TaskSplitModal.tsx" --modified "src/renderer/src/components/modes/TaskModePanel.tsx"
```
若终端提示 `Consider promoting stable lessons`，按 AGENTS.md 把 lesson 写入 `.memory/KNOWLEDGE.md` 并把对应 `- lesson:` 改为 `- lesson(promoted):`。

---

## Self-Review 结果（修订版）

- **Spec 覆盖**：进度/错误展示、供应商+模型选择写回 `apiConfig`、槽位编辑写回 `taskAssignmentSlots`、重试、持久化、loading 中关窗 abort、Esc 关闭、happy path 不变、`split` 返回值改造 —— 全部覆盖。
- **错误传递单一来源（修订点）**：移除 `useTaskSplit` 内部 `error` state，错误仅经 `{ok, error?}` 返回值传递；`TaskModePanel` inline 失败 → `r.error` → 弹窗；弹窗内重试 → 同一返回值。无死状态。
- **中止可靠化（修订点）**：`!open` 时组件 `return null` 不卸载，旧 cleanup 不可靠；改为 `closeWithAbort` 在 `onClose`/遮罩/Esc/取消/管理供应商 各路径显式 `if (isLoading) abort()`。
- **弹窗风格对齐（修订点）**：`z-[100]`、`bg-black/60 backdrop-blur-sm`、`animate-in fade-in/zoom-in-95`、遮罩与内容分离、Esc 关闭 —— 与 `ConfirmModal`/`RenameModal` 一致。
- **类型一致性**：`split` 返回 `{ok,error}` Task1 定义、Task2/Task3 消费一致；`persistProvider(providerId, agentId)` 签名一致；`TaskSplitModal` props 三处一致；`CustomDropdown` `value: T | null` 接收 `string` 合法。
- **无占位符**：所有代码块完整。
- **风险已记**：`persistProvider` 不校验模型归属，`resolveProvider` 已有回退兜底（`useTaskSplit.ts:27`）；`clean:store` 后需重新配置。
