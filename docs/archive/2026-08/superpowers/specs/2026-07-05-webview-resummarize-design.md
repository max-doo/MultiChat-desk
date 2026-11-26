> Created: 2026-07-05 01:02 (+08:00)

# Webview 模式重新总结与空回复守卫 设计

## 背景与问题

总结页的 webview 模式存在两个相互关联的问题：

### 问题 A：webview 模式无重新总结入口

`SummaryPanel.tsx` 中 webview 模式的 composer 由 `summaryFired` 锁定：

- 首次发送（`handleWebviewSend`）后 `summaryFired` 置 `true`，composer 永久锁死。
- 仅在以下两种情况解锁：
  1. `onReset` 触发 —— 但 `onReset` 绑定的 `add_circle`「新对话」按钮**只在 API 模式头部渲染**（`summarySource === 'api'` 分支），webview 模式的 JSX 完全没有这个按钮。
  2. `webviewSummary.phase` 进入 `'error'` / `'aborted'`（`SummaryPanel.tsx:207-211` 的 `useEffect`）。

因此一旦首次总结走完 `done` 相位，用户再也无法在 webview 模式重新发起总结，必须切走/重进页面或触发报错才能解锁。

`onReset` 内部逻辑已完整（`SummaryPanel.tsx:121-127`）：
- 清 `webviewHistoryIdRef.current = null`
- `setSummaryFired(false)`
- webview 模式下调用 `webviewSummaryRef.current?.resetToInitial()`（该方法加载 `newConversationUrl`，见 `WebviewCard.tsx:816-875`）

**结论**：`onReset` 已是稳定的闭环路径，webview 模式只缺一个触发它的按钮。

### 问题 B：空回复 bug

两层：

**B1 — 发送前不校验回复内容**

`handleWebviewSend`（`SummaryPanel.tsx:339-386`）仅检查 `selectedModels.length === 0`，不检查这些选中模型在 `modelResponses` 中是否真有非空回复内容。当模型未爬到回复（`modelResponses[id]` 为空/undefined）时，仍可发送，发出去的总结 prompt 里 `<context>` 块全是空的 `<model_output>`。

webview 模式的 `sendDisabled`（`SummaryPanel.tsx:1170`）同样只看 `selectedModels.length === 0`，按钮不会因此灰掉。

对比 API 模式 `handleGenerateSummary`（`useSummaryPanel.ts:396-401`）有 `modelOutputs.length === 0` → `'所选模型暂无回复内容'` 的守卫，webview 模式缺这层。

**B2 — 发送后轮询读不到文本时静默锁死**

`useWebviewSummary.ts` 的 `finish`（`:65-88`）只在 `finalText && kind === 'done'` 时产 assistant 消息。当轮询一直读不到文本（平台未登录、确实无回复、选择器失配但未抛异常）时：

- idle 超时（`STREAM_IDLE_TIMEOUT_MS=4000`，`:122-127`）或 hard 超时（`:129-132`）触发 `finish('done')`。
- `finalText` 为空 → 不产消息、不报错，phase 置 `'done'`。
- `isGenerating` 变 false，`summaryFired` 仍为 `true` → UI 呈现「锁死 + 空白 + 无提示」。

唯一会报错的是「连续 5 次读取异常」（`consecutiveFailsRef >= 5`，`:112-119`），但「读到了但内容为空」不在此列。

## 设计目标

1. webview 模式下提供显式的「新对话」入口，重置 webview 到新会话 URL 并解锁 composer。
2. 发送前拦截「选中模型均无回复」的情况，与 API 模式口径一致。
3. 发送后轮询超时且无文本时显式报错并解锁，消除静默锁死。

## 改动范围

仅两个文件：

- `src/renderer/src/components/SummaryPanel.tsx`（新对话按钮 + 发送前守卫 + sendDisabled + webview 模式错误展示 + 收窄 API 模式错误块条件）
- `src/renderer/src/hooks/useWebviewSummary.ts`（`finish` 空文本走 error）

不涉及 IPC、preload、main、selectors、WebviewCard 内部实现，无跨层影响。

## 详细设计

### A. webview 模式「新对话」按钮

**位置**：webview 模式 composer 区块（`summarySource === 'webview'` 的 IIFE，`SummaryPanel.tsx:1164-1261`）内，发送按钮左侧。

**实现**：复用 hook 已暴露的 `handleResetChat`（`useSummaryPanel.ts:308-310` → `doResetChat` → 触发 `onReset`）。

```tsx
<button
  type="button"
  onClick={handleResetChat}
  disabled={messages.length === 0 && !streamingContent}
  className="shrink-0 flex items-center justify-center w-9 h-9 rounded-md text-text-secondary hover:text-text-primary hover:bg-gray-100 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
  title="开启新对话"
  aria-label="开启新对话"
>
  <span className="material-symbols-outlined text-xl">add_circle</span>
</button>
```

**disabled 口径**：`messages.length === 0 && !streamingContent`，与 API 模式新对话按钮（`SummaryPanel.tsx:639`）一致；生成中（`webviewSummary.isGenerating`）由 `composerLocked` 隐式覆盖——但为避免生成中点新对话打断，额外加 `|| webviewSummary.isGenerating` 守卫。

**为什么不在 WebviewCard 头部加按钮**：`WebviewCard.handleNewConversation`（`WebviewCard.tsx:1165-1177`）只 `loadURL(newConversationUrl)`，不清总结对话消息、不解 `summaryFired`、不清 `webviewHistoryIdRef`，需要在 SummaryPanel 侧再接回调同步状态，耦合更重；且按钮离 composer 远，"新对话=清总结"心智不直观。复用 `handleResetChat` 走 `onReset` 闭环最省。

### B1. 发送前空回复守卫

**`handleWebviewSend` 开头加守卫**（`SummaryPanel.tsx:339` 之后）：

```ts
const hasAnyReply = selectedModels.some(id => (modelResponses[id] || '').trim().length > 0)
if (!hasAnyReply) {
  setError('所选模型暂无回复内容，请先在对话页获取回复')
  return
}
```

口径与 API 模式 `modelOutputs.length === 0` 一致：选中模型中至少一个有非空回复。注意保留现有 `if (selectedModels.length === 0) return`（无选中模型时无意义提示，直接 return）。

**`sendDisabled` 同步**（`SummaryPanel.tsx:1170`）：

```ts
const hasAnyReply = selectedModels.some(id => (modelResponses[id] || '').trim().length > 0)
const sendDisabled = composerLocked || !hasAnyReply
```

让按钮在无回复时也灰掉，避免用户点了才看到 error 提示。`title` 也可相应补充「无回复内容」提示，但非必须。

**边界**：`modelResponses` 为空对象时 `hasAnyReply` 为 false，按钮灰；历史恢复时 `modelResponses` 由 `restoreHistoryData` 填充，正常情况有内容。

### B2. 发送后轮询空文本走 error

**`useWebviewSummary.ts` 的 `finish` 改动**（`:65-88`）：

当前：

```ts
const finish = useCallback((kind: 'done' | 'aborted') => {
  cleanupPolling()
  isRunningRef.current = false
  const finalText = lastTextRef.current
  if (finalText && kind === 'done') {
    // 产 assistant 消息...
  }
  setPhase(kind)
}, [])
```

改为：

```ts
const finish = useCallback((kind: 'done' | 'aborted') => {
  cleanupPolling()
  isRunningRef.current = false
  const finalText = lastTextRef.current
  if (kind === 'done') {
    if (!finalText) {
      // 轮询超时但未读到任何回复文本：报错并解锁（phase=error 会触发 SummaryPanel 的解锁 effect）
      setPhase('error')
      setError('未检测到回复，请确认是否已登录该平台或是否已有回复内容')
      return
    }
    // 产 assistant 消息（原逻辑）...
  }
  setPhase(kind)
}, [])
```

**为什么走 error 而非 done**：`SummaryPanel.tsx:207-211` 已有 `phase ∈ {error, aborted}` → `setSummaryFired(false)` 的 effect，走 error 即可自动解锁 composer 允许重试，无需额外接线。`done` 相位保持"成功且有内容"的语义，避免误触发后续依赖 `done` 的逻辑（如 `waitForSavableUrl` 记录会话 URL，`SummaryPanel.tsx:314-327`）。

**配套：webview 模式错误展示**。`SummaryPanel.tsx:813-817` 的错误提示块在 `summarySource === 'api'` 分支之外，两种模式都渲染，但它读的是 `useSummaryPanel` 暴露的 `error`（API 模式状态），**不读 `webviewSummary.error`**。因此 webview 模式下 `useWebviewSummary` 设置的 `error` 当前对用户不可见。

需要在 webview 模式也展示 `webviewSummary.error`。最小改法：在 webview 模式 IIFE 内（`SummaryPanel.tsx:1164` 的 `(() => { ... })()` 返回的 JSX 顶部，`WebviewCard` 之前）加一个错误提示块：

```tsx
{webviewSummary.error && (
  <div className="px-3 py-2 bg-red-900/30 border border-red-700 rounded-md text-red-400 text-sm shrink-0">
    {webviewSummary.error}
  </div>
)}
```

同时，B1 发送前守卫用的 `setError` 是 `useSummaryPanel` 的 `error`，在 webview 模式下也不可见。为统一，B1 的错误提示也放进这个 webview 模式错误块。方案：在 webview 模式 IIFE 内用一个合并的本地 `error` 变量展示：

```tsx
const webviewModeError = webviewSummary.error || (/* 见 B1：发送前守卫产生的 error */)
```

但 `useSummaryPanel` 的 `setError` 是状态 setter，B1 守卫调用后 `error` 状态更新，IIFE 内可读取该 `error`。因此 webview 模式错误块展示 `webviewSummary.error || error`（`error` 来自 `useSummaryPanel` 的解构），即可覆盖 B1 与 B2 两类错误。API 模式原有的 `error` 提示块（`:813-817`）保持不变。

**修订后的 webview 模式错误块**（放在 IIFE 返回 JSX 顶部）：

```tsx
{(webviewSummary.error || error) && (
  <div className="px-3 py-2 bg-red-900/30 border border-red-700 rounded-md text-red-400 text-sm shrink-0">
    {webviewSummary.error || error}
  </div>
)}
```

注意：`:813-817` 的 API 模式错误块在 webview 模式也会渲染（它在分支外），会重复显示 `error`。需把 `:813-817` 那个块收进 `summarySource === 'api'` 分支内，或在该块加 `summarySource === 'api' &&` 条件，避免 webview 模式重复显示。本设计采用后者（改 `:813` 为 `{summarySource === 'api' && error && (`），改动最小。

**aborted 分支不变**：用户主动终止仍走 `finish('aborted')`，保留已有"部分内容作为消息"的行为（虽然 webview 模式下 `finalText` 通常为空，aborted 时不产消息也合理）。

## 数据流

### 新对话按钮

```
点击「新对话」按钮
  → handleResetChat()  (useSummaryPanel)
  → doResetChat()
    → persistSummaryHistory(messages)  // 若有内容则存档
    → 清 messages / streamingContent / hasStartedChat / capturedModelResponses
    → onReset()
      → 清 webviewHistoryIdRef
      → setSummaryFired(false)         // 解锁 composer
      → webviewSummaryRef.current?.resetToInitial()  // 加载 newConversationUrl
  → composer 解锁，可再次发送总结
```

### 发送前守卫

```
点击发送
  → handleWebviewSend()
  → selectedModels.some(id => modelResponses[id] 非空) 为 false
  → setError('所选模型暂无回复内容...')，return
  → 不创建 user 消息、不调 startSummary、不置 summaryFired
```

### 发送后空文本

```
startSummary() → phase=streaming → 轮询
  → 一直读不到文本（非异常）
  → idle/hard 超时 → finish('done')
  → finalText 为空
    → setPhase('error') + setError('未检测到回复...')
  → SummaryPanel effect 监测 phase=error → setSummaryFired(false)
  → composer 解锁，用户可重试或开新对话
```

## 错误处理

- **新对话按钮**：复用 `resetToInitial`，其内部已处理 `did-fail-load`（`WebviewCard.tsx:849-860`）并返回 `{success, error}`。`onReset` 当前未 await 其结果、未展示错误。本设计保持现状（不扩大范围），若 `resetToInitial` 失败，webview 会进入自身 loadError 覆盖层，composer 仍解锁（`setSummaryFired(false)` 已执行）。后续可补 console.warn，非本任务必做。
- **发送前守卫**：纯前端校验，无异常路径。
- **发送后空文本**：走 error 相位，与现有 `consecutiveFailsRef >= 5` 报错共用解锁链路。

## 测试验证

无自动化测试运行器，按 AGENTS.md 在 `npm run dev` 手动验证：

1. `npm run lint` → `npm run build` 通过。
2. **新对话按钮**：
   - 进入总结页，切到 webview 模式，发送一次总结。
   - 确认 `done` 后 composer 锁定、出现「新对话」按钮。
   - 点击「新对话」→ webview 重新加载新会话 URL、左侧总结对话清空、composer 解锁、可再次发送。
   - 空对话时按钮 disabled。
3. **发送前守卫**：
   - 不在对话页发任何消息，直接进总结页（`modelResponses` 空）。
   - 确认 webview 模式发送按钮灰掉；强行 focus 也无法触发（`handleWebviewSend` 守卫 return）。
4. **发送后空文本**：
   - 选一个未登录的平台作 webview 总结平台，发送总结。
   - 确认超时后 webview 模式错误块显示「未检测到回复...」，composer 解锁，无空白锁死。
5. **错误展示不重复**：
   - webview 模式触发 B1/B2 错误时，错误块只出现一次（API 模式错误块已收窄，不在 webview 模式渲染）。
6. **回归**：API 模式新对话按钮、发送、重新生成、错误提示不受影响。

## 不做的事

- 不改 `WebviewCard` 内部、不改 selectors、不改 IPC。
- 不让 `done` 相位解锁 composer（与"新对话=重置平台会话"语义冲突，会导致总结对话与平台会话错位）。
- 不加长 idle 超时阈值（保持 4s，空文本直接报错更明确）。
- 不在 `onReset` 里 await `resetToInitial` 结果或弹错（保持现状，避免扩大范围）。
