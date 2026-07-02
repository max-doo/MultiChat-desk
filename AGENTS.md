# Repository Guidelines

## Project Overview

MultiChat Desk 是基于 Electron 的桌面应用，通过多个 Webview 并行接入不同 AI 平台，提供统一发送、历史记录和 AI 总结能力。
主要用户群体为多模型大语言模型的重度使用者，主要产品形态为 Electron 桌面端应用。

## Tech Stack

- Language/runtime: TypeScript (strict), Node.js, Electron 28
- Frameworks: React 18, Tailwind CSS 3, Zustand 4
- Package manager: npm (禁止使用其他包管理器)
- Build Tool: electron-vite (HMR dev), electron-builder

## Project Structure & Module Organization

- `src/main/`：Electron 主进程，负责窗口、Session、IPC、数据持久化与多供应商总结链路。关键文件：`index.ts`、`webviewManager.ts`、`ipcHandlers.ts`、`agentPrompts.ts`、`api/summaryApi.ts`、`config/requestBodyConfig.ts`。
- `src/preload/`：仅做安全桥接，向渲染层暴露 `window.api`。`index.d.ts` 是 IPC 契约文件。
- `src/renderer/src/`：React UI、状态、页面逻辑与 Webview 交互。包含 `pages/`、`components/`、`store/appStore.ts`、`hooks/useSummaryPanel.ts`。Webview 选择器集中在 `config/selectors.ts`，注入脚本集中在 `utils/webviewScripts.ts`。
- `docs/`：构建、打包、Windows 命令、API 配置等参考文档。
- `out/`、`dist/`：构建产物，禁止手改;`scripts/`、`build/`：构建辅助脚本与资源。

## Build, Test, and Development Commands

- `npm run dev`：启动 electron-vite 开发服务器（HMR）；打开桌面窗口。
- `npm run build`：类型检查 + 打包 main / preload / renderer 到 `out/`。
- `npm run lint` / `npm run lint:fix`：对 `src/**/*.{ts,tsx}` 跑 ESLint。
- `npm run build:win:nsis` / `build:win:portable` / `build:win:all`：Windows 安装包 / 便携版 / 全部。
- `npm run build:mac` / `build:linux`:对应平台打包，需在该 OS 上执行。
- `npm run clean:store`：清理本地配置（`%APPDATA%\MultiChat Desk{,-dev}\config*.json`），用于重置开发态。
- 调试可读 bundle：`MM_OBFUSCATE=0 npm run build` 关闭混淆。
- 项目未配置测试运行器；验证 = `npm run lint` + `npm run build` + `npm run dev` 中手动验证。

## Coding Style & Naming Conventions

- 严格 TypeScript，禁止用 `any` 静默错误；故意未使用的变量以 `_` 前缀标记。
- ESLint 警告 `@typescript-eslint/no-explicit-any` 与未使用变量。
- 改前先检索现有实现和相邻调用点，优先复用 `src/main/`、`src/renderer/src/utils/` 与现有组件。
- 不做无关重构，不顺手改命名 / 结构 / 样式；保持 DRY 与小步修改。

## Architecture Constraints

- **分层边界**：`src/main` 主进程能力 / 窗口 / Session / IPC / 数据 / 总结链路；`src/preload` 仅做安全桥接;`src/renderer` 仅做 UI / 状态 / 页面逻辑 / Webview 交互。禁止跨层塞逻辑。
- **IPC 约束**：新增或修改 IPC 必须同时同步 `src/main/ipcHandlers.ts`、`src/preload/index.ts`、`src/preload/index.d.ts` 及渲染层调用点;返回结构统一为 `{ success, data?, error? }`。
- **Webview 自动化约束**: 站点选择器统一维护在 `src/renderer/src/config/selectors.ts`，注入脚本统一在 `src/renderer/src/utils/webviewScripts.ts`；优先多候选选择器与可见性判断，避免脆弱 DOM 依赖。
- **总结链路约束**：涉及总结请求 / 供应商适配 / 流式解析 / reasoning / thinking / 中止能力时必须同步 `src/main/config/requestBodyConfig.ts`、`src/main/api/summaryApi.ts`、`src/main/ipcHandlers.ts`、`src/preload/index.ts` 与相关前端调用，确保 `abortSummary`、流式回调与思考内容兼容。
- **Session 约束**：所有 Webview 共享 `persist:shared` Session，登录态全局；任何涉及 Session / Cookie / 账户切换的改动必须评估全局影响。

## Working Rules

- Explore first: For non-trivial changes, first inspect relevant files and existing tests, then propose a short plan, then edit. (探索优先：非微小改动先审阅再执行)
- Use Plan Mode for broad refactors, migrations, architecture changes, or tasks touching more than 5 files.
- Keep changes scoped to the requested task.
- Ask before adding new production dependencies.
- End implementation tasks with: changed files, what changed, validation commands run, and any follow-up items.
- 改动前先检索现有实现，避免重复实现。
- 如果规则与当前代码冲突，以代码事实为准，并先修正本文件。规则改动需与影响目录边界 / 分层 / IPC / Webview / 总结链路 / 构建命令的代码改动同批提交。
- **禁止擅自切分支**：不允许创建、切换或删除分支（包括 `git checkout -b`、`git switch`、`git branch -d` 等），除非用户明确同意。在用户未主动要求切分支的情况下，只能在当前分支上工作。

## Testing Guidelines

- 项目未配置自动化测试运行器，所有的测试都必须在 `npm run dev` 桌面环境下手动进行验证。
- 验证流程需要遵循：`npm run lint` -> `npm run build` -> `npm run dev` 运行测试流程。
- 如果某项功能无法在当前开发机独立完成测试，必须在任务结束时清楚说明原因并列出最小等价验证步骤。

## Done Criteria

A session or task is considered complete when:
- **Requirements Met**: All aspects of the user's original request have been fully implemented without omissions.
- **Scope Minimized**: Diffs have been reviewed to ensure changes are strictly scoped to the task, with no unrelated file modifications or accidental formatting.
- **Validation Passed**: Relevant tests, linting, and type checks pass; if blocked, reasons and mitigation plans are explicitly documented.
- **Risks Evaluated**: Potential side effects or blast radius of critical changes have been assessed and communicated.
- **Build Succeeds**: The project builds successfully, or any breakage is acknowledged and tracked.
- **Lessons Promoted**: Stable lessons prompted in the terminal after running `session_log.py` have been promoted to `.memory/KNOWLEDGE.md`.

项目专属完成标准：
- 行为已落到正确的层（main / preload / renderer），IPC 契约端到端同步。
- 受影响的链路在 `npm run dev` 中已被实际触发验证；如无法验证，需明确说明并给出最小等价检查。
- 没有牵动无关文件。

## Commit & Pull Request Guidelines

- Commit 消息遵循 Conventional Commits（`feat:` / `fix:` / `refactor:` / `docs:` / `chore:` 等）。
- PR 描述应包含改动摘要、验证证据、关联 issue;UI 改动附截图。
- 改动尽量聚焦，避免顺手重构。

## Security & Configuration

- Never commit secrets, tokens, private keys, or real credentials.
- 禁止泄露 API Key、Token、Cookie、用户输入或模型输出中的敏感内容。`electron-store` 与 `persist:shared` 中的数据视为敏感。
- 涉及登录态、账户切换、深度链接等敏感路径时，先评估再动手。
- 添加生产依赖、修改打包配置或安全敏感代码前先确认。

## Dates & Document Headers

- 在写入任何时间戳之前，必须通过终端命令（如 `Get-Date` 或 `date`）获取系统当前真实时间，绝不要凭记忆捏造。
- 独立文档（如评估报告、计划书、分析报告等）在落盘时，必须在文档顶部包含 `> Created: YYYY-MM-DD HH:MM (TZ)` 格式的时间戳行。

## Memory Layer

- `SESSION_LOG.md`: recent 7-day collaboration log; read directly when recent context is needed. Manually appending or overwriting session entries is prohibited by default; the only allowed manual edit: after a lesson has been written to KNOWLEDGE.md, modify the corresponding `- lesson:` tag to `- lesson(promoted):`.
- After adding, deleting, or modifying files, run `python .memory/session_log.py` to append a log. Required argument: Task Summary (--done), File Operations (--added/modified/removed). Optional arguments (if necessary): high-value experience or pitfalls (`--lesson`), context (`--context`), key decisions (`--decision`), and unresolved items (`--unresolved`). The script automatically handles timestamps, file lock retries, archiving of older entries, and structured entry formatting.
- `.memory/KNOWLEDGE.md`: long-term reusable lessons and decisions. Read it only for recurring issues, debugging, architecture decisions, or when the current task likely depends on prior project experience. When running the `session_log.py` script, if the terminal outputs the prompt `Consider promoting stable lessons to .memory/KNOWLEDGE.md.`, you MUST immediately extract and append those lessons to `.memory/KNOWLEDGE.md`, and after doing so, change the corresponding `- lesson:` tag in `SESSION_LOG.md` (or the archived daily session markdown) to `- lesson(promoted):`.
- `.memory/sessions/`: archived daily session logs older than the recent window. Do not read by default unless tracing older history.
- `TODO.md`: user-governed, agent-assisted backlog; do not read or edit by default; if a session ends with unresolved items, suggest the user update TODO and apply changes only after user approval.
- `CHANGELOG.md`: Release-oriented changelog, updated for release-specific changes or when recording milestones.

## Known Gotchas

- Keep only high-frequency gotchas that must be followed every session here, ideally 3-7 bullets.
- Promote lessons from `.memory/KNOWLEDGE.md` into this section when they are recurring across tasks, costly when missed, not obvious from code structure, and expressible as one concrete operating rule.
- Keep other long-term lessons, debugging notes, and stable decisions in `.memory/KNOWLEDGE.md`; read that file first for recurring issues, debugging, architecture decisions, or tasks that clearly depend on prior project history.
