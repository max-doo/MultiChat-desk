# WebContentsView Bounds Sync Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Optimize WebContentsView bounds synchronization during resize by switching from blocking IPC invoke to non-blocking send and applying requestAnimationFrame throttling.

**Architecture:** Change `webview:set-bounds` IPC channel from `invoke/handle` (bidirectional, blocking) to `send/on` (unidirectional, fire-and-forget). In the renderer `WebviewCard.tsx`'s ResizeObserver, throttle the `setWebviewBounds` IPC call using `requestAnimationFrame` to prevent IPC channel flooding and reduce visual lag.

**Tech Stack:** TypeScript, React, Electron IPC

---

### Task 1: Update Preload IPC Signatures

**Files:**
- Modify: `src/preload/index.d.ts`
- Modify: `src/preload/index.ts`

- [ ] **Step 1: Update Type Definitions**

```typescript
// src/preload/index.d.ts
// Replace the existing setWebviewBounds signature:
      setWebviewBounds: (params: { viewId: string; bounds: { x: number; y: number; width: number; height: number } }) => void
```

- [ ] **Step 2: Update Preload Implementation**

```typescript
// src/preload/index.ts
// Replace the existing setWebviewBounds implementation:
  setWebviewBounds: (params: { viewId: string; bounds: { x: number; y: number; width: number; height: number } }): void =>
    ipcRenderer.send('webview:set-bounds', params),
```

- [ ] **Step 3: Run Validation**

Run: `npm run lint`
Expected: PASS (Wait until Task 3 completes for full build pass)

- [ ] **Step 4: Commit**

```bash
git add src/preload/index.d.ts src/preload/index.ts
git commit -m "refactor(ipc): change webview:set-bounds from invoke to send in preload"
```

### Task 2: Update Main Process IPC Handlers

**Files:**
- Modify: `src/main/ipcHandlers.ts`

- [ ] **Step 1: Change IPC Handler from handle to on**

```typescript
// src/main/ipcHandlers.ts
// Replace the webview:set-bounds ipcMain.handle block with:
    /**
     * webview:set-bounds (Task 2.3)
     * 设置 WebContentsView 的位置和大小
     */
    ipcMain.on('webview:set-bounds', (event, params: {
        viewId: string
        bounds: { x: number; y: number; width: number; height: number }
    }) => {
        try {
            const win = BrowserWindow.fromWebContents(event.sender)
            if (!win) throw new Error('No window found for sender')
            viewManager.setViewBounds(win.id, params.viewId, params.bounds)
        } catch (err: unknown) {
            console.error('[IPC] webview:set-bounds error:', err)
        }
    })
```

- [ ] **Step 2: Run Validation**

Run: `npm run lint`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add src/main/ipcHandlers.ts
git commit -m "refactor(ipc): use ipcMain.on instead of handle for webview:set-bounds"
```

### Task 3: Implement requestAnimationFrame Throttling in Renderer

**Files:**
- Modify: `src/renderer/src/components/WebviewCard.tsx`

- [ ] **Step 1: Add Animation Frame Logic to ResizeObserver**

```typescript
// src/renderer/src/components/WebviewCard.tsx
// Inside useEffect for initView, modify the ResizeObserver implementation:
          let animationFrameId: number | null = null;
          let latestRect: DOMRect | null = null;

          if (hostRef.current) {
            resizeObserver = new ResizeObserver((entries) => {
              for (const entry of entries) {
                latestRect = entry.target.getBoundingClientRect()
              }
              
              if (latestRect && animationFrameId === null) {
                animationFrameId = requestAnimationFrame(() => {
                  if (!latestRect || !activeViewId) {
                    animationFrameId = null
                    return
                  }
                  
                  const width = Math.round(latestRect.width)
                  const height = Math.round(latestRect.height)
                  
                  if (width <= 0 || height <= 0) {
                    window.api.hideWebviewView({ viewId: activeViewId })
                  } else {
                    window.api.showWebviewView({ viewId: activeViewId })
                    window.api.setWebviewBounds({
                      viewId: activeViewId,
                      bounds: {
                        x: Math.round(latestRect.left),
                        y: Math.round(latestRect.top),
                        width,
                        height
                      }
                    })
                  }
                  animationFrameId = null
                })
              }
            })
            resizeObserver.observe(hostRef.current)
          }
```

- [ ] **Step 2: Cleanup Animation Frame**

```typescript
// src/renderer/src/components/WebviewCard.tsx
// Add cleanup inside the useEffect return:
      return () => {
        if (animationFrameId !== null) cancelAnimationFrame(animationFrameId)
        if (resizeObserver) resizeObserver.disconnect()
        if (activeViewId) {
          window.api.removeWebviewView({ viewId: activeViewId })
        }
      }
```

- [ ] **Step 3: Run Full Validation**

Run: `npm run build`
Expected: Build succeeds with no type errors.

- [ ] **Step 4: Commit**

```bash
git add src/renderer/src/components/WebviewCard.tsx
git commit -m "perf(renderer): throttle webview bounds sync with requestAnimationFrame"
```
