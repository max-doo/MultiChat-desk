# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Stack

Electron 28 + React 18 + TypeScript (strict) + Tailwind 3 + Zustand 4. Built with electron-vite (HMR dev) and packaged with electron-builder. Package manager: npm.

## Common commands

- `npm run dev` — start electron-vite dev server with HMR; opens the desktop window.
- `npm run build` — type-check + bundle main / preload / renderer into `out/` (no installer).
- `npm run lint` / `npm run lint:fix` — ESLint over `src/**/*.{ts,tsx}`.
- `npm run build:win:nsis` — Windows NSIS installer.
- `npm run build:win:portable` — Windows portable ZIP (also runs `add-portable-marker`).
- `npm run build:win:all` — both NSIS and portable in one go.
- `npm run build:mac` / `npm run build:linux` — packaged for the respective OS (run on that OS).
- `npm run clean:store` — wipes local app config (`%APPDATA%\ModelMash{,-dev}\config*.json`); use to reset dev state.
- No test runner is configured. Verification = `npm run lint` + `npm run build` + manual run of `npm run dev`.

Build obfuscation is on by default. To produce a readable bundle for debugging: `MM_OBFUSCATE=0 npm run build`.

## Architecture

Three-process split — keep features in the right layer.

- **`src/main/`** — Electron main process. Window/Webview lifecycle, Session, electron-store data, IPC, and the multi-vendor summary backend.
  - `index.ts` — app bootstrap, portable-mode detection (looks for `portable.txt` next to the app), Session path config, global shortcuts (Ctrl+R / F5).
  - `webviewManager.ts` — main window + injected scripts + context menu.
  - `ipcHandlers.ts` — every renderer-callable handler.
  - `agentPrompts.ts` — file-backed Agent prompt templates.
  - `api/summaryApi.ts` — OpenAI-compatible streaming client (handles `reasoning_content`, `<thought>` tags, abort).
  - `config/requestBodyConfig.ts` — per-vendor request shape (Qwen `enable_thinking`, Gemini `thinking_config`, etc.). Add new vendors here.
- **`src/preload/`** — bridge only. Exposes a typed `window.api` to the renderer.
  - `index.d.ts` is the IPC contract. **Any IPC change must update main + preload + this `.d.ts` together** or the renderer types drift.
- **`src/renderer/src/`** — React app (alias `@renderer`).
  - `pages/` (MainPage, SummaryPage, BrowserPage), `components/`, `store/appStore.ts` (Zustand global state), `hooks/useSummaryPanel.ts`.
  - `config/selectors.ts` — DOM selectors for the 11 chat platforms.
  - `utils/webviewScripts.ts` — scripts injected into Webviews to drive those selectors.

### Two crosscutting flows that span layers

1. **Webview automation** (sending messages, file uploads, Deep Research toggles, output extraction). The only legitimate entry points are `src/renderer/src/config/selectors.ts` + `src/renderer/src/utils/webviewScripts.ts`. When a platform's UI changes, edit `defaultSelectors` and restart. Use multiple candidate selectors and visibility checks — never bind to brittle single-class hooks.
2. **AI summary**: renderer → preload `generateSummary` / `abortSummary` → main `summaryApi.ts` → vendor endpoint. Vendor quirks (thinking modes, reasoning fields, base URL conventions) live exclusively in `requestBodyConfig.ts`. The user references for this are `docs/API_CONFIG_GUIDE.md` and the request-body table inside `requestBodyConfig.ts`.

### Sessions are shared

All Webviews use `persist:shared`. Cookie/login state is global — any change touching session, partition, or auth-affecting injected scripts impacts every platform at once.

### IPC convention

Handlers return `{ success: boolean, data?: T, error?: string }`. New handlers must follow this shape so renderer error handling stays uniform.

## Project rules (distilled from `.agent/rules/project-rule.md`)

- Edit only under `src/`. Never hand-edit `out/` or `dist/` — they are regenerated.
- Keep TypeScript strict; do not introduce `any` to silence errors. ESLint warns on `@typescript-eslint/no-explicit-any` and unused vars (prefix with `_` to suppress when intentional).
- Search first, then add. Reuse helpers in `src/main/`, `src/renderer/src/utils/`, and existing components before introducing new ones.
- Do not perform unrelated refactors while implementing a focused change.
- Do not log or persist API keys, cookies, tokens, or user content. Treat anything in `electron-store` and the `persist:shared` Session as sensitive.
- Commit messages follow Conventional Commits (`feat:`, `fix:`, `refactor:`, …).

## Where things live (when looking is not obvious)

- Per-vendor base URLs and feature support: `README.md` "支持的 API 供应商" table + `src/main/config/requestBodyConfig.ts`.
- Reference docs (build, packaging, Windows commands, API config): `docs/`.
- Design notes and DOM-extraction rationale (per platform): `docs/`.
- Default Agent prompt templates: `src/renderer/src/store/agent-prompts-defaults/`.

## Changelog

- End of every session, append one line per change to `CHANGELOG.md` as `HH:MM | type: path - summary`; group same-day entries under `## YYYY-MM-DD`.

## Done criteria

A change is done only when:
- The behavior is implemented in the right layer (main/preload/renderer) with the IPC contract updated end-to-end.
- `npm run lint` and `npm run build` pass.
- The affected flow has been exercised in `npm run dev` (or the blocker is reported with the smallest equivalent check performed).
- No unrelated files are modified.
