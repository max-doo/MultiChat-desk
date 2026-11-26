# Disable Quick Window Auto-Hide on Blur Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Disable auto-hide on blur for the quick/shortcut window, allowing it to remain visible when focus is lost, and only close via manual actions.

**Architecture:** Comment out the `blur` event listener on `quickWindow` to stop auto-hiding. Add explicit hiding of `quickWindow` when opening/focusing the main window via tray click, tray menu, or "主界面" transition button.

**Tech Stack:** TypeScript, Electron, Electron IPC.

---

### Task 1: Main Process Window & Tray Modification

**Files:**
- Modify: `src/main/webviewManager.ts`

- [ ] **Step 1: Comment out blur/focus auto-hide events in `createQuickWindow`**
  In `createQuickWindow` function, comment out the event listeners for `'blur'` and `'focus'`.

- [ ] **Step 2: Update tray context menu item `'显示主界面'`**
  In `createTray`, update the click callback for `'显示主界面'` to also hide the quick window:
  ```typescript
  { label: '显示主界面', click: () => { mainWindow?.show(); mainWindow?.focus(); getQuickWindow()?.hide() } }
  ```

- [ ] **Step 3: Update tray click event handler**
  In `createTray`, update `tray.on('click')` to also hide the quick window when showing the main window:
  ```typescript
  tray.on('click', () => {
      if (!mainWindow) return
      if (mainWindow.isVisible()) mainWindow.hide()
      else { mainWindow.show(); mainWindow.focus(); getQuickWindow()?.hide() }
  })
  ```

### Task 2: IPC Handlers Modification

**Files:**
- Modify: `src/main/ipcHandlers.ts`

- [ ] **Step 1: Update `'tray:show-main'` IPC handler**
  Update `'tray:show-main'` to hide the quick window:
  ```typescript
  ipcMain.handle('tray:show-main', () => {
      const w = getMainWindow()
      if (w) { w.show(); w.focus() }
      getQuickWindow()?.hide()
      return { success: true }
  })
  ```

### Task 3: Build & Verification

**Files:**
- None

- [ ] **Step 1: Run linter**
  Run: `npm run lint`
  Expected: Clean run, no new warnings/errors.

- [ ] **Step 2: Build project**
  Run: `npm run build`
  Expected: Build succeeds.

- [ ] **Step 3: Manual test**
  Run: `npm run dev`
  Verify the following scenarios:
  1. Open quick window via shortcut, click outside it (desktop or other app), verify it does not close.
  2. Toggle quick window via shortcut, verify it hides.
  3. Open quick window, click "✕", verify it hides.
  4. Open quick window, click "主界面", verify main window opens and quick window hides.
  5. Use tray icon to show main window when quick window is open, verify quick window hides.
