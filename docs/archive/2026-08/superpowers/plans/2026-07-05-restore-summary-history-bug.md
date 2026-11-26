# Restore Summary History Bug Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ensure that restoring summary history correctly loads and renders the historical models on the left-side cards panel, even when the current main page layout/active models differ from the history.

**Architecture:** Instead of using the main page's current active `displayedModels` layout to filter historical responses, we will derive the list of models to render from `restoreHistoryData.modelResponses` when a historical session is active. Additionally, we will ensure that missing model definitions fall back gracefully to their IDs.

**Known follow-up / out of scope (recorded here to avoid fixing one bug and introducing another):**
- `restoreHistoryData` is consumed by `useSummaryPanel.ts` via `useEffect([restoreHistoryData])` (lines ~272-292), which sets `currentSummaryHistoryIdRef.current = restoreHistoryData.historyId`. While `restoreHistoryData` stays non-null, any new summary the user sends (first-send or follow-up, which do NOT go through `pendingSummarySession`) will be written back to the **old** history entry instead of starting fresh. Task 1 Step 3 only clears `restoreHistoryData` on the `pendingSummarySession` path (already done at `SummaryPage.tsx:179`) — it does not cover the "already on summary page in restored state → user sends new summary" path. Fully fixing that requires touching the send flow in `useSummaryPanel` and is out of scope for this plan; it is tracked as a follow-up. The verification step 7 below checks for it but does not block this plan.

**Tech Stack:** React, TypeScript, Zustand

---

### Task 1: Update SummaryPage.tsx to render historical models correctly

**Files:**
- Modify: [SummaryPage.tsx](file:///c:/Project/MultiChat-desk/src/renderer/src/pages/SummaryPage.tsx#L43-L46)
- Modify: [SummaryPage.tsx](file:///c:/Project/MultiChat-desk/src/renderer/src/pages/SummaryPage.tsx#L113-L149)

- [ ] **Step 1: Update the renderableModels calculation logic**
Update `renderableModels` definition so that when `restoreHistoryData` is present, it retrieves the model configs corresponding to the keys of `restoreHistoryData.modelResponses` (with proper fallback for any models not currently present in the global configurations).

In [SummaryPage.tsx](file:///c:/Project/MultiChat-desk/src/renderer/src/pages/SummaryPage.tsx), change:
```typescript
  const renderableModels = useMemo(() => {
    return displayedModels.filter(m => (modelResponses[m.id] || '').trim().length > 0)
  }, [displayedModels, modelResponses])
```
to:
```typescript
  const renderableModels = useMemo(() => {
    if (restoreHistoryData) {
      // 恢复历史记录时，不受当前主页面窗口显示的 displayedModels 限制，而是使用历史记录中实际有回复的模型
      const historicalModelIds = Object.keys(restoreHistoryData.modelResponses || {})
      return historicalModelIds
        .map(id => {
          const found = models.find(m => m.id === id)
          if (found) return found
          // 兜底，避免历史记录中的模型在当前配置中不存在
          return {
            id,
            name: id,
            url: '',
            logo: '',
            enabled: true
          }
        })
        .filter(m => (modelResponses[m.id] || '').trim().length > 0)
    }
    return displayedModels.filter(m => (modelResponses[m.id] || '').trim().length > 0)
  }, [displayedModels, modelResponses, restoreHistoryData, models])
```

- [ ] **Step 2: Clear snapshotModelIds upon history restoration**
Update the `handleRestoreHistory` function in [SummaryPage.tsx](file:///c:/Project/MultiChat-desk/src/renderer/src/pages/SummaryPage.tsx) to clear `snapshotModelIds` by calling `setSnapshotModelIds([])`.

Change:
```typescript
  // 抽取恢复历史记录的逻辑
  const handleRestoreHistory = (item: SummaryHistoryItem): void => {
    console.log('[SummaryPage] 恢复历史记录:', item)

    // 记录当前激活的历史记录 ID
    setActiveHistoryId(item.id)
    setIsLoadingResponses(true)

    // 恢复选中的模型
    if (item.selectedModels && item.selectedModels.length > 0) {
      setSelectedModels(item.selectedModels)
      console.log('[SummaryPage] 恢复选中模型:', item.selectedModels)
    }
```
to:
```typescript
  // 抽取恢复历史记录的逻辑
  const handleRestoreHistory = (item: SummaryHistoryItem): void => {
    console.log('[SummaryPage] 恢复历史记录:', item)

    // 记录当前激活的历史记录 ID
    setActiveHistoryId(item.id)
    setIsLoadingResponses(true)
    // 恢复历史记录时，清空当前激活的本地历史快照 ID 列表，避免旧快照横幅依然显示
    setSnapshotModelIds([])

    // 恢复选中的模型
    if (item.selectedModels && item.selectedModels.length > 0) {
      setSelectedModels(item.selectedModels)
      console.log('[SummaryPage] 恢复选中模型:', item.selectedModels)
    }
```

- [ ] **Step 3: Audit `restoreHistoryData` clearing paths**
The `pendingSummarySession` branch of the init `useEffect` already calls `setRestoreHistoryData(null)` at `SummaryPage.tsx:179`, so entering the summary page fresh from the main page correctly leaves historical mode. **Do NOT remove this.** Confirm by inspection that no other code path sets `restoreHistoryData` to a stale value while the user is mid-flow. If a future change adds a new entry path into the summary page, it must also clear `restoreHistoryData` — add a code comment at `SummaryPage.tsx:179` noting this invariant:
```typescript
      // 新进入总结页（非历史恢复）必须清空 restoreHistoryData，否则 renderableModels 会一直走历史分支，
      // 且 useSummaryPanel 的 useEffect([restoreHistoryData]) 会让新总结写回旧历史。
      setRestoreHistoryData(null)
```

---

### Task 2: Enhance useSummaryPanel.ts to fall back for missing historical models

**Files:**
- Modify: [useSummaryPanel.ts](file:///c:/Project/MultiChat-desk/src/renderer/src/hooks/useSummaryPanel.ts#L387-L397)
- Modify: [useSummaryPanel.ts](file:///c:/Project/MultiChat-desk/src/renderer/src/hooks/useSummaryPanel.ts#L711-L721)

- [ ] **Step 1: Fall back to model ID in the initial send flow**
Update line 387-397 of `useSummaryPanel.ts` to fall back to `id` as `name` if `models.find` returns `undefined`.

Change:
```typescript
      modelOutputs = selectedModels
        .map(id => {
          const model = models.find(m => m.id === id)
          const response = snapshot[id]
          if (model && response) {
            return { name: model.name, content: response }
          }
          return null
        })
        .filter((x): x is { name: string; content: string } => Boolean(x))
```
to:
```typescript
      modelOutputs = selectedModels
        .map(id => {
          const model = models.find(m => m.id === id)
          const response = snapshot[id]
          if (response) {
            return { name: model?.name || id, content: response }
          }
          return null
        })
        .filter((x): x is { name: string; content: string } => Boolean(x))
```

- [ ] **Step 2: Fall back to model ID in the regeneration flow**
Update line 711-721 of `useSummaryPanel.ts` to also support fallback naming for missing models.

Change:
```typescript
      modelOutputs = selectedModels
        .map(id => {
          const model = models.find(m => m.id === id)
          const response = capturedModelResponses[id] ?? modelResponses[id]
          if (model && response) {
            return { name: model.name, content: response }
          }
          return null
        })
        .filter((x): x is { name: string; content: string } => Boolean(x))
```
to:
```typescript
      modelOutputs = selectedModels
        .map(id => {
          const model = models.find(m => m.id === id)
          const response = capturedModelResponses[id] ?? modelResponses[id]
          if (response) {
            return { name: model?.name || id, content: response }
          }
          return null
        })
        .filter((x): x is { name: string; content: string } => Boolean(x))
```

---

### Task 3: Compile and Manually Verify the Changes

- [ ] **Step 1: Check lint and type errors**
Run: `npm run lint` and `npm run build` to verify there are no TypeScript or compilation errors.

- [ ] **Step 2: Start the application**
Run: `npm run dev` to start the development workspace.

- [ ] **Step 3: Perform verification steps**
1. Select A and B models on the main page. Start a conversation, then go to the summary page and generate a summary (which saves to history).
2. Change the main page models to C and D (so that they do not overlap with A and B).
3. Open the summary history drawer, restore the saved summary.
4. Verify that A and B models' card responses show up correctly in the left-hand panel.
5. Verify that no snapshot model banners are displayed.
6. Verify that click on "regenerate summary" works.
7. **Regression check for the `restoreHistoryData` clearing invariant:** After restoring history (step 3), navigate back to the main page, start a new conversation with the current models, and re-enter the summary page. Verify the left panel now reflects the new models' responses, not the old restored history. (Note: the deeper "send a new summary while still on the restored summary page" path is a known follow-up, see Architecture section — it is acceptable if that specific path still writes back to the old history, but document the observed behavior.)
