# Manual Input Fallback Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an edit/paste fallback button to model output cards, allowing users to manually paste crawled content when automatic crawling fails, and synchronize the content into summary states and history.

**Architecture:** Add an editing state within `ModelOutputCard`. Expose an `onContentChange` callback which is implemented in `SummaryPage` to update `modelResponses` state. Synchronize manual edits inside `useSummaryPanel` to ensure the captured responses snapshot and persistent history stay up-to-date.

**Tech Stack:** React 18, Tailwind CSS 3, Zustand 4, TypeScript

---

### Task 1: Update ModelOutputCard Props and Edit Mode State

**Files:**
- Modify: `src/renderer/src/components/ModelOutputCard.tsx`

- [ ] **Step 1: Declare the `onContentChange` callback prop and state**
  Add `onContentChange` to `ModelOutputCardProps` and implement the editing state using React hooks.
  Show an edit button using the material symbol icon `edit` to the left of the copy button.
  When clicked, toggle `isEditing` mode and populate `editedContent` (default to empty string if content is "暂无回复内容", otherwise current content).
  In edit mode, render a textarea and Save/Cancel buttons.

  ```tsx
  // Target code changes in src/renderer/src/components/ModelOutputCard.tsx:
  // In ModelOutputCardProps:
  interface ModelOutputCardProps {
    id: string
    name: string
    logo: string
    content: string
    selected: boolean
    onToggle: () => void
    badge?: string
    onContentChange?: (newContent: string) => void
  }

  // Inside ModelOutputCard component:
  const [isEditing, setIsEditing] = useState(false)
  const [editedContent, setEditedContent] = useState('')
  ```

- [ ] **Step 2: Add Edit Button and Textarea UI in ModelOutputCard.tsx**
  Add the edit button inside the header next to copy button, and conditionally render the textarea inside the content container.

  ```tsx
  // Edit button placement (to the left of Copy button, wrapped in a flex container):
  <div className="flex items-center gap-1">
    {onContentChange && (
      <button
        type="button"
        onClick={() => {
          if (isEditing) {
            setIsEditing(false)
          } else {
            setIsEditing(true)
            setEditedContent(content === '暂无回复内容' ? '' : content)
          }
        }}
        className={`w-8 h-8 rounded-lg flex items-center justify-center transition-colors ${
          isEditing
            ? 'text-primary bg-primary/10'
            : 'text-text-secondary hover:text-text-primary hover:bg-gray-100/50'
        }`}
        title={isEditing ? '取消编辑' : '手动粘贴/编辑内容'}
        aria-label={isEditing ? '取消编辑' : '手动粘贴/编辑内容'}
      >
        <span className="material-symbols-outlined text-base">edit</span>
      </button>
    )}
    <button
      onClick={handleCopyMarkdown}
      // ... existing copy button logic and classes
    >
      <span className="material-symbols-outlined text-base">content_copy</span>
    </button>
  </div>

  // Textarea rendering inside content container:
  {isEditing ? (
    <div className="flex flex-col gap-3">
      <textarea
        value={editedContent}
        onChange={(e) => setEditedContent(e.target.value)}
        placeholder="请在此处粘贴或输入内容作为爬取兜底..."
        className="w-full min-h-[150px] p-3 text-sm text-text-primary bg-sidebar/50 border border-gray-300 rounded-lg focus:outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/30 resize-y"
        autoFocus
      />
      <div className="flex justify-end gap-2">
        <button
          type="button"
          onClick={() => setIsEditing(false)}
          className="px-3 py-1.5 text-xs font-medium border border-gray-200 rounded-lg text-text-secondary hover:bg-gray-100/50 transition-colors"
        >
          取消
        </button>
        <button
          type="button"
          onClick={() => {
            onContentChange?.(editedContent)
            setIsEditing(false)
            if (!selected && editedContent.trim().length > 0) {
              onToggle()
            }
          }}
          className="px-3 py-1.5 text-xs font-medium bg-primary text-white rounded-lg hover:opacity-90 transition-opacity"
        >
          保存
        </button>
      </div>
    </div>
  ) : (
    // Existing Markdown render code block...
  )
  ```

---

### Task 2: Implement onContentChange Callback in SummaryPage

**Files:**
- Modify: `src/renderer/src/pages/SummaryPage.tsx`

- [ ] **Step 1: Pass the `onContentChange` handler to ModelOutputCard**
  Implement the callback on `ModelOutputCard` to update `modelResponses` state when manually edited content is saved.

  ```tsx
  // In SummaryPage.tsx renderableModels mapping:
  <ModelOutputCard
    key={model.id}
    id={model.id}
    name={model.name}
    logo={model.logo}
    content={modelResponses[model.id] || '暂无回复内容'}
    selected={selectedModels.includes(model.id)}
    onToggle={() => toggleModelSelection(model.id)}
    badge={snapshotModelIds.includes(model.id) ? '快照' : undefined}
    onContentChange={(newContent) => {
      setModelResponses(prev => ({
        ...prev,
        [model.id]: newContent
      }))
    }}
  />
  ```

---

### Task 3: Synchronize Manual Edits into Snapshot and Persistent History

**Files:**
- Modify: `src/renderer/src/hooks/useSummaryPanel.ts`

- [ ] **Step 1: Add a useEffect to listen to modelResponses changes and sync with snapshot and history**
  Add a synchronization effect inside `useSummaryPanel` to make sure edits propagate to the captured model responses and update the active history item immediately.
  **CRITICAL:** Ensure this new `useEffect` is defined AFTER the existing `useEffect([restoreHistoryData])` to avoid race conditions when switching history items.

  ```typescript
  // Add this inside the body of useSummaryPanel hook (AFTER the `useEffect([restoreHistoryData])`):
  useEffect(() => {
    if (Object.keys(capturedModelResponsesRef.current).length > 0) {
      const nextCaptured = { ...capturedModelResponsesRef.current }
      let changed = false
      for (const key of Object.keys(modelResponses)) {
        if (modelResponses[key] !== nextCaptured[key]) {
          nextCaptured[key] = modelResponses[key]
          changed = true
        }
      }
      if (changed) {
        setCapturedModelResponsesBoth(nextCaptured)
        // If we are actively editing inside a summary session, update its history immediately
        if (currentSummaryHistoryIdRef.current) {
          updateSummaryHistory(currentSummaryHistoryIdRef.current, {
            modelResponses: nextCaptured
          })
        }
      }
    }
  }, [modelResponses, updateSummaryHistory])
  ```

---

### Task 4: Linting and Project Verification

- [ ] **Step 1: Run TypeScript compiler & Linter checks**
  Run: `npm run lint`
  Expected: No linting or TypeScript compilation errors.

- [ ] **Step 2: Run build**
  Run: `npm run build`
  Expected: The project builds successfully with electron-vite.
