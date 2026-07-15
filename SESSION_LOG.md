# Session Log

## 2026-07-15

### 23:40 | Antigravity

- done: Bump version to 1.2.1 and update CHANGELOG.md
- modified:
  - `package.json package-lock.json CHANGELOG.md`

### 23:32 | Antigravity

- done: Remove expressions of '总结 Agent' and the word 'Agent' from documentation files
- modified:
  - `README.md`
  - `docs/USER_GUIDE.md`
  - `docs/API_CONFIG_GUIDE.md`
  - `docs/ModelMashPRD 3 simple.md`
  - `docs/总结模块提示词架构方案.md`
  - `docs/settings-config-design.md`
  - `docs/CLI_FEASIBILITY_ASSESSMENT.md`

### 23:19 | codex

- done: Fixed the summary-page webview prompt bug and promoted the triggered reusable lessons into long-term knowledge.
- context: The webview summary prompt was reading the wrong composer state; memory promotion was required after session_log surfaced stable lesson candidates.
- decision: Keep the functional fix minimal, then update knowledge/session markers to preserve reuse for future debugging.
- modified:
  - `src/renderer/src/components/SummaryPanel.tsx .memory/KNOWLEDGE.md .memory/sessions/2026-07-06.md .memory/sessions/2026-07-05.md`

### 23:18 | Codex

- done: 修复底部对话框拖拽文件上传依赖 renderer File.path 导致路径不支持的问题：拖拽内容经 IPC 写入主进程临时文件后复用上传链路，并在完成后清理
- modified:
  - `src/main/ipcHandlers.ts`
  - `src/preload/index.ts`
  - `src/preload/index.d.ts`
  - `src/renderer/src/env.d.ts`
  - `src/renderer/src/components/ControlBar.tsx`
- lesson: 拖拽上传不要直接信任 renderer File.path；应将文件内容写入主进程受限临时目录后再交给 Webview/CDP。

### 23:17 | codex

- done: Fixed summary-page webview prompt assembly so the user's extra requirement is taken from the webview composer state and included in the prompt sent to the webview summary flow.
- context: The bug was in the webview summary path, not the API summary path: buildWebviewPrompt was reading customPrompt from the API flow instead of webviewCustomPrompt.
- decision: Keep the fix minimal and local to SummaryPanel so API summary behavior remains unchanged.
- modified:
  - `src/renderer/src/components/SummaryPanel.tsx`

## 2026-07-11

### 14:09 | Codex

- done: Completed_macos_followup_gaps_for_selection_toolbar_packaging_and_unsigned_release
- decision: Use_macos_System_Events_accessibility_reading_without_a_new_production_dependency_and_keep_unsigned_release_explicit
- added:
  - `build/generate-mac-assets.sh`
  - `build/MACOS_FIRST_OPEN.md`
  - `scripts/generate-release-checksums.js`
- modified:
  - `src/main/platform/selectionReader.ts`
  - `src/main/ipcHandlers.ts`
  - `src/renderer/src/components/SettingsDrawer.tsx`
  - `src/renderer/src/assets/index.css`
  - `electron-builder.yml`
  - `package.json`
  - `build/multichat-cli.sh`
  - `src/main/daemon/ipcServer.ts`
  - `src/cli/client.ts`
  - `.gitignore`
- unresolved: Validate_on_clean_Intel_and_Apple_Silicon_macs

### 13:52 | Codex

- done: macOS-plan-execution
- added:
  - `src/main/platform/selectionReader.ts`
- modified:
  - `electron-builder.yml`
  - `scripts/verify-titlebar-drag-contract.js`
  - `src/cli/client.ts`
  - `src/main/daemon/ipcServer.ts`
  - `src/main/index.ts`
  - `src/main/inputHookManager.ts`
  - `src/main/ipcHandlers.ts`
  - `src/main/webviewManager.ts`
  - `src/preload/index.d.ts`
  - `src/preload/index.ts`
  - `src/renderer/src/assets/index.css`
  - `src/renderer/src/components/Layout.tsx`
  - `src/renderer/src/components/SettingsDrawer.tsx`
  - `src/renderer/src/env.d.ts`
- lesson(promoted): macOS-selection-must-not-invoke-Windows-PowerShell-UIA

### 13:42 | Codex

- done: Removed_nonfunctional_macos_titlebar_status_indicator_from_plan
- decision: Keep_macos_titlebar_right_side_limited_to_history_and_settings
- modified:
  - `docs/MACOS_DEVELOPMENT_PLAN.md`

### 13:26 | Codex

- done: Saved_macOS_adaptation_and_unsigned_release_plan
- decision: Unsigned_DMG_validation_phase_with_documented_Gatekeeper_confirmation_and_integrity_checks
- added:
  - `docs/MACOS_DEVELOPMENT_PLAN.md`
- unresolved: Implement_and_validate_on_Intel_and_Apple_Silicon

