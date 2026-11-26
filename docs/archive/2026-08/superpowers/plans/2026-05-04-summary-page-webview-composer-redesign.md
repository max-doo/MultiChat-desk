# Webview Summary Composer Redesign — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Compress the right panel of `SummaryPage`'s Webview mode into a single-row bottom composer (mode pill + auto-grow input + send button), maximize the WebViewCard's vertical space, and lock the composer after first send so follow-ups go through the WebView's native input.

**Architecture:** All changes live in `src/renderer/src/components/SummaryPanel.tsx`. Add a `summaryFired` boolean state plus a phase-driven effect to drive composer disabled/locked visuals. Replace the current `summarySource === 'webview'` branch (top mode dropdown + top textarea + WebViewCard + bottom action bar) with a new layout where WebViewCard fills `flex-1 min-h-0` and a single 56px row composer sits at the bottom. API mode, the page header, the left output column, and the `useWebviewSummary` hook are untouched.

**Tech Stack:** React 18 + TypeScript + Tailwind 3 + existing `CustomDropdown`, `WebviewCard`, `useWebviewSummary` from this repo. No new dependencies. No new tests (project has no test runner — verification = `npm run lint` + `npm run build` + manual `npm run dev`).

**Reference spec:** `docs/superpowers/specs/2026-05-04-summary-page-webview-composer-redesign.md`

---

## File Structure

| File | Type | Responsibility |
|---|---|---|
| `src/renderer/src/components/SummaryPanel.tsx` | Modify | Add `summaryFired` state + reset effect; replace Webview branch (~lines 1007-1093) with new composer layout. |

No new files. No deletions.

---

## Task 1: Wire `summaryFired` state and phase-driven reset

**Files:**
- Modify: `src/renderer/src/components/SummaryPanel.tsx` (4 small edits across imports, state declarations, effects, and `handleWebviewSend`)

This task only touches non-rendering code. After it lands, the `summarySource === 'webview'` branch still renders the OLD layout — that gets replaced in Task 2. Splitting the state-machine wiring out first keeps each commit small and lets you confirm the type changes in isolation before the larger UI rewrite.

- [ ] **Step 1: Add `useEffect` to the React import**

Open `src/renderer/src/components/SummaryPanel.tsx`. Line 1 currently reads:

```tsx
import { useState, useRef, useMemo, useCallback } from 'react'
```

Replace with:

```tsx
import { useState, useRef, useMemo, useCallback, useEffect } from 'react'
```

- [ ] **Step 2: Declare the `summaryFired` state next to the other Webview-related useState**

Find line 111:

```tsx
  const [webviewPlatformId, setWebviewPlatformId] = useState<string>(lastWebviewPlatform)
```

Add immediately after it (so the state lives near the other Webview-mode locals):

```tsx
  const [webviewPlatformId, setWebviewPlatformId] = useState<string>(lastWebviewPlatform)
  // Webview composer 锁定标记：首次发送后置 true，组件卸载或 phase 进入 error/aborted 时归零
  const [summaryFired, setSummaryFired] = useState(false)
```

- [ ] **Step 3: Add a phase-driven reset effect right after the `webviewSummary` declaration**

Find lines 178-182:

```tsx
  const webviewSummary = useWebviewSummary({
    webviewRef: webviewSummaryRef,
    buildPrompt: buildWebviewPrompt,
    onAssistantMessage: handleWebviewAssistantMessage
  })
```

Insert immediately after the closing `})` of the hook call:

```tsx
  const webviewSummary = useWebviewSummary({
    webviewRef: webviewSummaryRef,
    buildPrompt: buildWebviewPrompt,
    onAssistantMessage: handleWebviewAssistantMessage
  })

  // phase 进入 error / aborted 时解锁 composer，允许重试；'done' 不解锁，引导用户去 WebView 自带输入框追问
  useEffect(() => {
    if (webviewSummary.phase === 'error' || webviewSummary.phase === 'aborted') {
      setSummaryFired(false)
    }
  }, [webviewSummary.phase])
```

- [ ] **Step 4: Set `summaryFired` to true at the end of `handleWebviewSend`**

Find lines 228-229:

```tsx
    webviewSummary.startSummary()
  }, [summaryMode, agentPrompts, selectedModels, models, customPrompt, setMessages, addSummaryHistory, webviewPlatformId, webviewSummary, modelResponses])
```

Replace with:

```tsx
    webviewSummary.startSummary()
    setSummaryFired(true)
  }, [summaryMode, agentPrompts, selectedModels, models, customPrompt, setMessages, addSummaryHistory, webviewPlatformId, webviewSummary, modelResponses, setSummaryFired])
```

(`setSummaryFired` is a stable useState setter so the dependency is technically unnecessary, but the existing array already lists `setMessages`, so we follow the same convention.)

- [ ] **Step 5: Verify the type-check is happy**

Run: `npm run lint`
Expected: passes. The project's lint config (`.eslintrc.cjs`) sets `@typescript-eslint/no-unused-vars` to `'warn'` (not `'error'`) and the `lint` script doesn't pass `--max-warnings 0`, so an unused-`summaryFired` **warning** in this intermediate state is acceptable and will be cleaned up automatically when Task 2 starts referencing the value from JSX. If you see a warning about `summaryFired` being declared but never used, that's expected — proceed.

- [ ] **Step 6: Verify the build still succeeds**

Run: `npm run build`
Expected: completes without TypeScript errors.

- [ ] **Step 7: Commit**

```bash
git add src/renderer/src/components/SummaryPanel.tsx
git commit -m "refactor(summary): add summaryFired state for Webview composer lock"
```

---

## Task 2: Replace the Webview branch with the single-row composer

**Files:**
- Modify: `src/renderer/src/components/SummaryPanel.tsx:1007-1093` (full replacement of the `summarySource === 'webview'` block)

This task carries the actual UX change. After it lands, the right panel of Webview mode contains exactly two children: the WebViewCard (`flex-1`) and a 56px composer (`shrink-0`).

- [ ] **Step 1: Add a textarea ref + auto-grow helper near the other refs**

Find line 113:

```tsx
  const webviewSummaryRef = useRef<WebviewCardRef>(null)
  const webviewHistoryIdRef = useRef<string | null>(null)
```

Add immediately after:

```tsx
  const webviewSummaryRef = useRef<WebviewCardRef>(null)
  const webviewHistoryIdRef = useRef<string | null>(null)
  const webviewComposerTextareaRef = useRef<HTMLTextAreaElement>(null)
```

- [ ] **Step 2: Add an auto-grow effect that runs whenever `customPrompt` or `summarySource` changes**

Insert this `useEffect` right after the one you added in Task 1 Step 3:

```tsx
  // 让 Webview 模式 composer 的 textarea 高度跟随内容增长，最多 5 行（120px）
  // 依赖 summarySource：当用户从 API 模式切回 Webview 时，textarea 重新挂载，
  // 需要触发一次重新计算高度，避免多行内容显示成单行。
  useEffect(() => {
    const ta = webviewComposerTextareaRef.current
    if (!ta) return
    ta.style.height = 'auto'
    ta.style.height = Math.min(ta.scrollHeight, 120) + 'px'
  }, [customPrompt, summarySource])
```

- [ ] **Step 3: Replace the entire Webview branch (lines 1007-1093) with the new layout**

Find the existing block:

```tsx
      {summarySource === 'webview' && (
        <div className="flex-1 flex flex-col overflow-hidden gap-3 min-h-0">
          {/* 模式选择器和用户指令 */}
          <div className="shrink-0 flex flex-col gap-2">
            <CustomDropdown
              ...
            />
            <textarea
              ...
              placeholder="输入额外的分析要求（可选）"
              ...
            />
          </div>

          {/* WebviewCard */}
          <div className="flex-1 min-h-0">
            <WebviewCard
              ...
            />
          </div>

          {/* 操作栏 */}
          <div className="shrink-0 flex items-center gap-2">
            <button
              ...
              onClick={handleWebviewSend}
              ...
            >
              {webviewSummary.isGenerating ? '已发送' : '开始 Webview 总结'}
            </button>
            <span className="text-xs text-gray-500">{`已选 ${selectedModels.length} 个模型`}</span>
            {webviewSummary.phase === 'uploading-file' && ( ... )}
            {webviewSummary.phase === 'sending' && ( ... )}
            {webviewSummary.phase === 'streaming' && ( ... )}
          </div>
        </div>
      )}
```

Replace it entirely with:

```tsx
      {summarySource === 'webview' && (() => {
        const composerLocked = summaryFired || webviewSummary.isGenerating
        const showLockedHint = summaryFired && !webviewSummary.isGenerating
        const placeholder = showLockedHint
          ? '已发送，请在右侧对话窗口继续追问'
          : '输入额外的分析要求（可选），按 Enter 发送'
        const sendDisabled = composerLocked || selectedModels.length === 0

        return (
          <div className="flex-1 flex flex-col overflow-hidden gap-2 min-h-0">
            {/* WebviewCard 占据除 composer 外的全部高度 */}
            <div className="flex-1 min-h-0">
              <WebviewCard
                ref={webviewSummaryRef}
                id={webviewPlatformId}
                name={webviewPlatformInfo.name}
                url={webviewPlatformInfo.url}
                logo={webviewPlatformInfo.logo || ''}
                enabled={true}
                slotIndex={0}
                compact
                onModelChange={(modelId) => setLastWebviewPlatform(modelId)}
              />
            </div>

            {/* 底部单行 composer */}
            <div
              className={`flex items-end gap-2 p-2 bg-gray-800 border border-gray-700 rounded-lg shrink-0 transition-colors ${
                composerLocked ? 'opacity-60' : 'focus-within:border-primary/50'
              }`}
            >
              {/* 模式选择 pill */}
              <CustomDropdown
                options={agentPrompts.map(p => ({ value: p.id, label: p.name, description: p.description }))}
                value={summaryMode}
                onChange={setSummaryMode}
                placeholder="总结模式"
                disabled={composerLocked}
                direction="up"
                dropdownWidth="min-w-max"
                className="min-w-max shrink-0"
                buttonClassName={`px-3 py-1.5 rounded-full text-sm flex items-center justify-between gap-2 transition-colors disabled:opacity-50 disabled:cursor-not-allowed min-w-max ${
                  summaryMode && agentPrompts.find(p => p.id === summaryMode)
                    ? 'bg-primary/10 border border-primary/50 text-primary hover:border-primary'
                    : 'bg-gray-700/50 border border-gray-600 text-gray-300 hover:border-gray-500'
                }`}
                renderOption={(option, isSelected, onSelect) => (
                  <button
                    onClick={onSelect}
                    className={`block w-full px-4 py-2 text-left text-sm transition-colors hover:bg-gray-700 ${
                      isSelected ? 'text-primary bg-primary/5' : 'text-gray-300'
                    }`}
                  >
                    <div className="flex flex-col items-start">
                      <div className="whitespace-nowrap">{option.label}</div>
                      {option.description && (
                        <div className={`text-[11px] ${isSelected ? 'text-primary/70' : 'text-gray-500'}`}>
                          {option.description}
                        </div>
                      )}
                    </div>
                  </button>
                )}
              />

              {/* 输入框 - 自动增长，单行 → 最多 5 行 */}
              <textarea
                ref={webviewComposerTextareaRef}
                value={customPrompt}
                onChange={(e) => setCustomPrompt(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault()
                    if (!sendDisabled) handleWebviewSend()
                  }
                }}
                placeholder={placeholder}
                disabled={composerLocked}
                rows={1}
                className="flex-1 resize-none bg-transparent text-sm text-gray-300 placeholder-gray-500 focus:outline-none disabled:cursor-not-allowed leading-5 py-1.5 max-h-[120px] overflow-y-auto"
              />

              {/* 发送按钮 */}
              <button
                type="button"
                onClick={handleWebviewSend}
                disabled={sendDisabled}
                className="shrink-0 flex items-center justify-center w-9 h-9 rounded-md bg-primary text-black hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                title={composerLocked ? '已发送' : '发送'}
                aria-label="发送"
              >
                <span className="material-symbols-outlined text-xl">send</span>
              </button>
            </div>
          </div>
        )
      })()}
```

Key behavioural mappings against the spec:

- `composerLocked = summaryFired || webviewSummary.isGenerating` — covers both phases `loading-page / uploading-file / sending / streaming` (via `isGenerating`) and the post-`done` permanent lock (via `summaryFired`).
- `showLockedHint` — true only after work has settled (`summaryFired && !isGenerating`). During active streaming, placeholder still shows the original copy because the user typically isn't reading the input during streaming and a transient hint flicker would be noisy.
- `sendDisabled` — also gates on `selectedModels.length === 0` (you can't summarise nothing).
- `disabled={composerLocked}` on textarea + dropdown + tinted via `opacity-60` on the wrapper provides three reinforcing visual cues.
- The auto-grow effect from Step 2 keeps height in sync with `customPrompt` length, capped at 120px (≈5 lines).

- [ ] **Step 4: Run lint**

Run: `npm run lint`
Expected: passes (0 errors).

- [ ] **Step 5: Run build**

Run: `npm run build`
Expected: completes without TypeScript errors.

- [ ] **Step 6: Manual visual verification in dev mode**

Run: `npm run dev`

Walk through the spec's verification list, checking each in turn:

1. Open MainPage → run a multi-model query → click the summary button to enter SummaryPage.
2. The default mode is Webview (per `apiConfig.summarySource ?? 'webview'`). The right panel should show **only**:
   - A WebViewCard occupying the bulk of the vertical space
   - A bottom composer with a mode pill on the left, a single-line textarea in the centre, and a send button on the right
   - **No** top mode dropdown, **no** top textarea, **no** "已选 N 个模型" / "正在生成回复" / "已发送" status text
3. Click into the textarea, type a few words → the textarea height stays at 1 row.
4. Press `Shift+Enter` once → height grows to 2 rows.
5. Type until you have ≥6 lines of text → height stops at ≈120px and an internal scrollbar appears.
6. Clear the textarea → height collapses back to 1 row.
7. Press `Enter` (with selected models > 0 and no text typed → fine, optional prompt) → composer immediately shows reduced opacity, send button greys out, textarea becomes uneditable, mode pill greys out and stops responding to clicks.
8. Wait for the WebView to stream a reply. After streaming completes:
   - Composer remains disabled (still 60% opacity).
   - Textarea placeholder switches to `已发送，请在右侧对话窗口继续追问`.
9. Click into the WebView's native input field, type a follow-up question → it works as expected (this is unchanged behaviour).
10. Click the page header's "返回对话窗口" button to go back to MainPage, then click the summary button again to re-enter SummaryPage. Composer should be enabled again (back to placeholder `输入额外的分析要求（可选），按 Enter 发送`).
11. Toggle the API/Webview switch in the page header to **API**. The right panel should look identical to before this work — top toolbar with provider/model/new-chat/settings, conversation area, two-row composer at the bottom. **Nothing** in the API branch should have changed.
12. Toggle back to Webview. The new layout should reappear instantly.
13. Left column (model output cards with checkboxes) should look identical to before — no padding, alignment, or width changes.

If any item fails, fix the regression and repeat from item 1. Do not proceed to commit until every item passes.

- [ ] **Step 7: Commit**

```bash
git add src/renderer/src/components/SummaryPanel.tsx
git commit -m "feat(summary): redesign Webview mode with single-row bottom composer

Replace the stacked layout (top mode dropdown + top textarea + bottom action bar)
with a single 56px-tall composer at the bottom: [mode pill][auto-grow input][send].
WebViewCard now fills all remaining vertical space. Composer locks after first
send and stays locked through the SummaryPanel lifetime; users continue follow-ups
via the WebView's native input. Status text indicators removed entirely. API mode
unchanged."
```

---

## Task 3: Update CHANGELOG.md

**Files:**
- Modify: `CHANGELOG.md`

CLAUDE.md requires appending one line per change to `CHANGELOG.md` formatted as `HH:MM | type: path - summary`, grouped under `## YYYY-MM-DD`.

- [ ] **Step 1: Read the current CHANGELOG to find the right insertion point**

Run: `cat CHANGELOG.md | head -30` (or use the Read tool).

If today's `## 2026-05-04` heading already exists, append a new line under it. If not, add a new heading at the top of the changelog (above any older day groups).

- [ ] **Step 2: Add the entry**

Use a timestamp matching when you ran Task 2's commit (use `date +"%H:%M"` to get the current time). Format:

```
HH:MM | feat: src/renderer/src/components/SummaryPanel.tsx - Webview 总结模式改用单行 composer，首发后锁定，移除冗余状态文字
```

If today's heading does not exist yet, the section becomes:

```markdown
## 2026-05-04

HH:MM | feat: src/renderer/src/components/SummaryPanel.tsx - Webview 总结模式改用单行 composer，首发后锁定，移除冗余状态文字
```

- [ ] **Step 3: Commit**

```bash
git add CHANGELOG.md
git commit -m "docs: log Webview composer redesign in CHANGELOG"
```

---

## Definition of Done

The plan is complete when:

- [ ] All steps in Tasks 1-3 are checked off.
- [ ] `npm run lint` passes with 0 errors.
- [ ] `npm run build` completes without TypeScript errors.
- [ ] Every item in Task 2 Step 6's manual verification list passes.
- [ ] Three commits exist on the current branch (state wiring, UI replacement, changelog).
- [ ] No files outside `src/renderer/src/components/SummaryPanel.tsx` and `CHANGELOG.md` are modified.
