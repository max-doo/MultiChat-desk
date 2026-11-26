> Created: 2026-06-27 17:24 (+08:00)

# Open External Links in Default Browser Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Modify the application so that opening external links (from AI outputs, summaries, or webview clicks) launches the operating system's default browser directly instead of opening an in-app browser window.

**Architecture:** Update `openBrowserWindowInternal` in `src/main/webviewManager.ts` to call Electron's native `shell.openExternal(url)` API. This preserves the existing IPC contract (`open-browser-window`) and architecture boundaries while unifying external link handling across the application.

**Tech Stack:** TypeScript, Node.js, Electron (`shell.openExternal`)

---

## Scope Check

This plan covers a single, focused change in the main process (`src/main/webviewManager.ts`). It alters the implementation of `openBrowserWindowInternal` without changing its function signature or the IPC contract, ensuring zero breaking changes to renderer pages or preload scripts.

## File Structure

- Modify: `src/main/webviewManager.ts` - Replaces the implementation of `openBrowserWindowInternal` to call `shell.openExternal(url)` instead of instantiating a new `BrowserWindow`.

## Task 1: Update openBrowserWindowInternal to use shell.openExternal

**Files:**
- Modify: `src/main/webviewManager.ts:108-158`

- [ ] **Step 1: Inspect current implementation and run pre-check**

Run: `npm run lint`
Expected: PASS

- [ ] **Step 2: Replace openBrowserWindowInternal implementation with shell.openExternal**

Replace lines 108-158 in `src/main/webviewManager.ts` with the following implementation:

```typescript
export function openBrowserWindowInternal(url: string): void {
    if (!url || !(url.startsWith('http://') || url.startsWith('https://'))) return
    console.log('[Main] openBrowserWindowInternal -> shell.openExternal:', url)
    shell.openExternal(url)
}
```

- [ ] **Step 3: Run build and type check**

Run: `npm run build`
Expected: PASS with no TypeScript or ESLint errors.

- [ ] **Step 4: Commit**

```bash
git add src/main/webviewManager.ts
git commit -m "feat: open external links in system default browser using shell.openExternal"
```

## Manual Verification Plan

Since the project does not configure an automated test runner (as documented in `AGENTS.md`), validation must follow the manual test flow in the desktop environment:
1. Run `npm run dev` to launch the application.
2. In any AI Webview or Chat output containing an external hyperlink (e.g., `https://github.com`), click the link.
3. Verify that the link opens directly in the operating system's default web browser (Chrome/Edge) instead of popping up an in-app Electron window.
