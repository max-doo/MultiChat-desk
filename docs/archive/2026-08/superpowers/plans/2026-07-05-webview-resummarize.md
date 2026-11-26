# Webview 模式重新总结与空回复守卫 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 给 webview 总结模式加「新对话」按钮以支持重新总结，并修补发送前/后两处空回复守卫，消除 composer 锁死空白。

**Architecture:** 复用 `useSummaryPanel` 已有的 `handleResetChat → onReset` 闭环（已含 `resetToInitial()` + `setSummaryFired(false)`），只在 webview 模式 JSX 补一个触发按钮；发送前加 `selectedModels` 非空回复守卫；`useWebviewSummary.finish` 在空文本时改走 `error` 相位；并在 webview 模式补一块 `webviewSummary.error || error` 的错误展示（原 API 错误块收窄到 api 模式，避免重复）。

**Tech Stack:** TypeScript (strict), React 18, Electron 28 webview, Zustand。无新依赖。

## Global Constraints

- 严格 TypeScript，禁止 `any` 静默错误；故意未使用变量以 `_` 前缀标记。
- 不做无关重构；改动严格限定在下方「Files」列出的两个文件。
- 不改 IPC / preload / main / selectors / WebviewCard 内部实现。
- 提交消息遵循 Conventional Commits（`feat:` / `fix:`）。
- 项目无自动化测试运行器；验证 = `npm run lint` → `npm run build` → `npm run dev` 手动验证。
- 文案使用简体中文，与现有提示风格一致（如「所选模型暂无回复内容」「未检测到回复」）。
- 不擅自切分支（仓库 Working Rules）；在当前 `main` 分支上工作，按 task 频繁提交。

## Spec Reference

设计文档：`docs/superpowers/specs/2026-07-05-webview-resummarize-design.md`

## Files

- **Modify** `src/renderer/src/components/SummaryPanel.tsx`
  - 收窄 API 模式错误块条件（`:813`）
  - webview 模式 IIFE 内补错误展示块 + 「新对话」按钮 + `sendDisabled` 改为按回复内容判定（`:1164-1170`、`return JSX` 顶部、发送按钮左侧）
  - `handleWebviewSend` 开头加发送前空回复守卫（`:339` 之后）
- **Modify** `src/renderer/src/hooks/useWebviewSummary.ts`
  - `finish` 在 `kind==='done'` 且 `finalText` 为空时改走 `error` 相位（`:65-88`）

---

### Task 1: `useWebviewSummary.finish` 空文本走 error

**Files:**
- Modify: `src/renderer/src/hooks/useWebviewSummary.ts:65-88`

**Interfaces:**
- Consumes: `setPhase`, `setError`（同文件 `useState` 已声明，`:41-43`）；`lastTextRef`、`cleanupPolling`、`isRunningRef`、`onAssistantMessageRef`（同文件已有）。
- Produces: `finish` 行为变更——`kind==='done'` 且 `lastTextRef.current` 为空时，phase 置 `'error'` 并设置 error 文案，不再产空 assistant 消息、不再置 `'done'`。`kind==='aborted'` 与有文本的 `'done'` 分支不变。Task 3 的 webview 模式错误展示块会消费这里的 `error`。

- [ ] **Step 1: 改 `finish`，空 done 走 error**

把 `src/renderer/src/hooks/useWebviewSummary.ts:65-88` 的 `finish` 整体替换为：

```ts
  const finish = useCallback((kind: 'done' | 'aborted') => {
    cleanupPolling()
    isRunningRef.current = false
    const finalText = lastTextRef.current
    if (kind === 'done') {
      if (!finalText) {
        // 轮询超时但未读到任何回复文本（平台未登录 / 确实无回复 / 选择器失配但未抛异常）：
        // 报错并解锁。phase='error' 会触发 SummaryPanel 的解锁 effect。
        setPhase('error')
        setError('未检测到回复，请确认是否已登录该平台或是否已有回复内容')
        return
      }
      const timestamp = Date.now()
      onAssistantMessageRef.current({
        id: `webview-${timestamp}-${Math.random().toString(36).slice(2, 9)}`,
        role: 'assistant',
        content: finalText,
        timestamp,
        versions: [
          {
            content: finalText,
            timestamp,
            modelId: 'webview',
            modelName: 'Webview'
          }
        ],
        currentVersionIndex: 0
      })
    }
    setPhase(kind)
  }, [])
```

- [ ] **Step 2: 类型检查 + lint**

Run: `npm run lint`
Expected: PASS，无新警告（`useWebviewSummary.ts` 无未使用变量；`setError` 已在文件中声明并被现有 `consecutiveFails` 分支使用，本步新增一处调用）。

- [ ] **Step 3: 提交**

```bash
git add src/renderer/src/hooks/useWebviewSummary.ts
git commit -m "fix(webview-summary): 轮询超时无文本时走 error 相位并报错，消除静默锁死"
```

---

### Task 2: `handleWebviewSend` 发送前空回复守卫

**Files:**
- Modify: `src/renderer/src/components/SummaryPanel.tsx:339-341`（`handleWebviewSend` 开头）

**Interfaces:**
- Consumes: `selectedModels`（props）、`modelResponses`（props）、`setError`（`useSummaryPanel` 解构）。
- Produces: `handleWebviewSend` 在选中模型均无非空回复时 `setError` 并 `return`，不创建 user 消息、不调 `webviewSummary.startSummary`、不置 `summaryFired`。Task 3 的 webview 模式错误块会展示该 `error`。

- [ ] **Step 1: 在 `handleWebviewSend` 开头加守卫**

`src/renderer/src/components/SummaryPanel.tsx:339-341` 当前为：

```ts
  const handleWebviewSend = useCallback(() => {
    if (selectedModels.length === 0) return

    const summaryTemplate = summaryPrompts.find(a => a.id === summaryMode)
```

替换为：

```ts
  const handleWebviewSend = useCallback(() => {
    if (selectedModels.length === 0) return

    // 发送前守卫：选中模型中至少一个有非空回复内容，与 API 模式 modelOutputs.length===0 口径一致
    const hasAnyReply = selectedModels.some(id => (modelResponses[id] || '').trim().length > 0)
    if (!hasAnyReply) {
      setError('所选模型暂无回复内容，请先在对话页获取回复')
      return
    }

    const summaryTemplate = summaryPrompts.find(a => a.id === summaryMode)
```

- [ ] **Step 2: 检查 `handleWebviewSend` 的 `useCallback` 依赖数组**

`handleWebviewSend` 的依赖数组在 `:386`：

```ts
  }, [summaryMode, summaryPrompts, selectedModels, models, customPrompt, setMessages, addSummaryHistory, webviewPlatformId, webviewSummary, modelResponses, setSummaryFired, history])
```

`modelResponses` 已在依赖中，`setError` 来自 `useSummaryPanel` 解构（非 state，是 hook 返回的 setter，稳定引用）。无需新增依赖项。确认不引入 lint 警告。

- [ ] **Step 3: lint + build**

Run: `npm run lint`
Expected: PASS

Run: `npm run build`
Expected: PASS（类型检查通过）

- [ ] **Step 4: 提交**

```bash
git add src/renderer/src/components/SummaryPanel.tsx
git commit -m "fix(webview-summary): 发送前校验选中模型是否有回复内容，避免空总结"
```

---

### Task 3: webview 模式错误展示 + 新对话按钮 + sendDisabled 改造

**Files:**
- Modify: `src/renderer/src/components/SummaryPanel.tsx:813`（收窄 API 错误块）
- Modify: `src/renderer/src/components/SummaryPanel.tsx:1164-1172`（IIFE 内加错误块 + sendDisabled 改造）
- Modify: `src/renderer/src/components/SummaryPanel.tsx:1247-1257`（发送按钮左侧加新对话按钮）

**Interfaces:**
- Consumes: `webviewSummary.error`、`webviewSummary.isGenerating`（`useWebviewSummary` 返回）；`error`、`handleResetChat`、`messages`、`streamingContent`（`useSummaryPanel` 解构）；`selectedModels`、`modelResponses`（props）。
- Produces: webview 模式可见的错误提示与「新对话」按钮入口；`sendDisabled` 在无回复时也禁用发送按钮。

- [ ] **Step 1: 收窄 API 模式错误块条件，避免 webview 模式重复显示**

`src/renderer/src/components/SummaryPanel.tsx:813-817` 当前为：

```tsx
      {/* 错误提示 */}
      {error && (
        <div className="mb-4 px-4 py-2 bg-red-900/30 border border-red-700 rounded-md text-red-400 text-sm shrink-0">
          {error}
        </div>
      )}
```

替换为（仅加 `summarySource === 'api' &&` 条件）：

```tsx
      {/* 错误提示（API 模式）—— webview 模式的错误在下方 IIFE 内单独展示，避免重复 */}
      {summarySource === 'api' && error && (
        <div className="mb-4 px-4 py-2 bg-red-900/30 border border-red-700 rounded-md text-red-400 text-sm shrink-0">
          {error}
        </div>
      )}
```

- [ ] **Step 2: 在 webview 模式 IIFE 内加错误展示块 + 改造 sendDisabled**

`src/renderer/src/components/SummaryPanel.tsx:1164-1172` 当前为：

```tsx
      {summarySource === 'webview' && (() => {
        const composerLocked = summaryFired || webviewSummary.isGenerating
        const showLockedHint = summaryFired && !webviewSummary.isGenerating
        const placeholder = showLockedHint
          ? '已发送，请在右侧对话窗口继续追问'
          : '输入额外的分析要求（可选），按 Enter 发送'
        const sendDisabled = composerLocked || selectedModels.length === 0

        return (
```

替换为：

```tsx
      {summarySource === 'webview' && (() => {
        const composerLocked = summaryFired || webviewSummary.isGenerating
        const showLockedHint = summaryFired && !webviewSummary.isGenerating
        const placeholder = showLockedHint
          ? '已发送，请在右侧对话窗口继续追问'
          : '输入额外的分析要求（可选），按 Enter 发送'
        // 选中模型中至少一个有非空回复才允许发送（与 handleWebviewSend 守卫口径一致）
        const hasAnyReply = selectedModels.some(id => (modelResponses[id] || '').trim().length > 0)
        const sendDisabled = composerLocked || !hasAnyReply

        return (
          <div className="flex-1 flex flex-col overflow-hidden gap-2 min-h-0">
            {/* webview 模式错误提示：展示 useWebviewSummary.error 或 useSummaryPanel 的 error（发送前守卫） */}
            {(webviewSummary.error || error) && (
              <div className="px-3 py-2 bg-red-900/30 border border-red-700 rounded-md text-red-400 text-sm shrink-0">
                {webviewSummary.error || error}
              </div>
            )}

            {/* WebviewCard 占据除 composer 外的全部高度 */}
```

说明：原本 `return (` 后紧跟的 `<div className="flex-1 flex flex-col overflow-hidden gap-2 min-h-0">` 与 `{/* WebviewCard ... */}` 注释——本步在其内部顶部插入错误块。Step 2 的替换块已包含 `return (` + 外层 `<div>` 开标签 + 错误块 + 原 `WebviewCard` 注释行。后续 `WebviewCard` JSX 保持原样不动。

- [ ] **Step 3: 在发送按钮左侧加「新对话」按钮**

`src/renderer/src/components/SummaryPanel.tsx:1247-1257` 当前「发送按钮」前有一行注释 `{/* 发送按钮 */}` 紧接 `<button ...>`。在 `{/* 发送按钮 */}` 之前插入「新对话」按钮：

当前片段：

```tsx
              {/* 发送按钮 */}
              <button
                type="button"
                onClick={handleWebviewSend}
                disabled={sendDisabled}
                className="shrink-0 flex items-center justify-center w-9 h-9 rounded-md bg-primary text-white hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
```

替换为：

```tsx
              {/* 新对话按钮：重置 webview 到 newConversationUrl + 清总结对话 + 解锁 composer（复用 onReset 闭环） */}
              <button
                type="button"
                onClick={handleResetChat}
                disabled={messages.length === 0 && !streamingContent || webviewSummary.isGenerating}
                className="shrink-0 flex items-center justify-center w-9 h-9 rounded-md text-text-secondary hover:text-text-primary hover:bg-gray-100 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                title="开启新对话"
                aria-label="开启新对话"
              >
                <span className="material-symbols-outlined text-xl">add_circle</span>
              </button>

              {/* 发送按钮 */}
              <button
                type="button"
                onClick={handleWebviewSend}
                disabled={sendDisabled}
                className="shrink-0 flex items-center justify-center w-9 h-9 rounded-md bg-primary text-white hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
```

- [ ] **Step 4: 确认 `handleResetChat` 已在 `useSummaryPanel` 解构中**

`SummaryPanel.tsx:106-117` 的解构列表中已有 `handleResetChat`（`useSummaryPanel` 返回，见 `useSummaryPanel.ts:1061`）。无需新增解构。若不存在则需补，但当前已存在——本步为只读核对。

- [ ] **Step 5: lint + build**

Run: `npm run lint`
Expected: PASS，无未使用变量警告。

Run: `npm run build`
Expected: PASS

- [ ] **Step 6: 提交**

```bash
git add src/renderer/src/components/SummaryPanel.tsx
git commit -m "feat(webview-summary): 新增新对话按钮与错误展示，sendDisabled 按回复内容判定"
```

---

### Task 4: 端到端手动验证

**Files:** 无（仅运行验证）

- [ ] **Step 1: 启动开发态**

Run: `npm run dev`
Expected: 桌面窗口打开，无控制台报错。

- [ ] **Step 2: 验证新对话按钮闭环**

1. 在对话页向至少一个模型发送消息并获取回复。
2. 进入总结页，确认处于 webview 模式（`summarySource='webview'`）。
3. 选中有回复的模型，点发送 → 等待 webview 总结完成（`done`）。
4. 确认 composer 锁定、placeholder 变为「已发送，请在右侧对话窗口继续追问」、发送按钮左侧出现 `add_circle`「新对话」按钮。
5. 点击「新对话」→ 确认：webview 重新加载该平台新会话 URL；左侧总结对话消息清空；composer 解锁；可再次发送总结。
6. 空对话时（无 messages 且无 streamingContent）「新对话」按钮 disabled。

- [ ] **Step 3: 验证发送前空回复守卫**

1. 不在对话页发任何消息，直接进总结页（`modelResponses` 为空）。
2. 确认 webview 模式发送按钮灰掉（disabled）。
3. 确认错误块显示「所选模型暂无回复内容，请先在对话页获取回复」（若 `error` 被触发）—— 注：按钮灰掉时点不动，可通过临时选中一个无回复模型 + 用键盘 Enter 触发 `handleWebviewSend` 守卫观察 error 文案。

- [ ] **Step 4: 验证发送后空文本走 error**

1. 在 webview 模式选一个**未登录**的平台作为总结平台（或选一个不会有回复内容的平台会话）。
2. 选中有回复的模型（满足 B1 守卫），点发送。
3. 等待约 4s idle 超时。
4. 确认：错误块显示「未检测到回复，请确认是否已登录该平台或是否已有回复内容」；composer 解锁（`summaryFired` 被清）；无空白锁死、无 `done` 相位残留。

- [ ] **Step 5: 验证错误不重复显示**

1. 触发 Step 3 或 Step 4 的错误。
2. 确认 webview 模式下错误块只出现一次（API 模式错误块已收窄，不在 webview 模式渲染）。

- [ ] **Step 6: 回归 API 模式**

1. 切到 API 模式（`summarySource='api'`）。
2. 确认 API 模式头部「新对话」按钮、发送、重新生成、错误提示均正常。
3. 触发 API 模式错误（如未配置 API Key 发送）→ 确认错误块正常显示一次。

- [ ] **Step 7: 终态提交（如有验证中发现的微调）**

若验证中发现需微调文案/样式，修正后：

```bash
git add -A
git commit -m "fix(webview-summary): 验证后微调"
```

若无微调，跳过本步。

---

## Self-Review

**1. Spec coverage:**
- Spec A（新对话按钮）→ Task 3 Step 3。✓
- Spec B1（发送前守卫）→ Task 2 Step 1（`handleWebviewSend`）+ Task 3 Step 2（`sendDisabled`）。✓
- Spec B2（发送后空文本走 error）→ Task 1 Step 1。✓
- Spec「配套：webview 模式错误展示」→ Task 3 Step 2（错误块）+ Step 1（收窄 API 错误块）。✓
- Spec「不动的事」均未越界（不改 WebviewCard/selectors/IPC；`done` 不解锁；idle 超时不变；不 await `resetToInitial`）。✓

**2. Placeholder scan:** 无 TBD/TODO；每个 Step 都有完整代码或确切命令。✓

**3. Type consistency:** `hasAnyReply` 在 Task 2 与 Task 3 同名同口径（`selectedModels.some(id => (modelResponses[id]||'').trim().length>0)`）；`setError` 文案与 spec 一致；`handleResetChat`、`webviewSummary.error`、`webviewSummary.isGenerating` 均为代码库现有符号。✓

**注：** Task 3 Step 3 的 `disabled` 表达式 `messages.length === 0 && !streamingContent || webviewSummary.isGenerating`——`&&` 优先级高于 `||`，等价于 `(messages.length === 0 && !streamingContent) || webviewSummary.isGenerating`，语义正确（空对话时禁用，或生成中禁用）。无需加括号，TS/ESLint 不会警告。
