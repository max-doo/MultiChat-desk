# Repository Guidelines

ModelMash 是基于 Electron 的桌面应用，通过多个 Webview 并行接入不同 AI 平台，提供统一发送、历史记录和 AI 总结能力。前端使用 React + TypeScript，开发与构建均在 Windows + PowerShell 环境运行。

## Project Structure & Module Organization

- `src/main/`：Electron 主进程，负责窗口、Session、IPC、数据持久化与多供应商总结链路。关键文件：`index.ts`、`webviewManager.ts`、`ipcHandlers.ts`、`api/summaryApi.ts`、`config/requestBodyConfig.ts`。
- `src/preload/`：仅做安全桥接，向渲染层暴露 `window.api`。`index.d.ts` 是 IPC 契约文件。
- `src/renderer/src/`：React UI、状态、页面逻辑与 Webview 交互。Webview 选择器集中在 `config/selectors.ts`，注入脚本集中在 `utils/webviewScripts.ts`。
- `docs/`：构建、打包、Windows 命令、API 配置等参考文档。
- `out/`、`dist/`：构建产物，禁止手改;`scripts/`、`build/`：构建辅助脚本与资源。

## Build, Test, and Development Commands

- `npm run dev`：启动 electron-vite 开发服务器（HMR）。
- `npm run build`：类型检查 + 打包 main / preload / renderer 到 `out/`。
- `npm run lint` / `npm run lint:fix`：对 `src/**/*.{ts,tsx}` 跑 ESLint。
- `npm run build:win:nsis` / `build:win:portable` / `build:win:all`：Windows 安装包 / 便携版 / 全部。
- `npm run build:mac` / `build:linux`:对应平台打包，需在该 OS 上执行。
- `npm run clean:store`：清理本地配置（`%APPDATA%\ModelMash{,-dev}\config*.json`），用于重置开发态。
- 调试可读 bundle：`MM_OBFUSCATE=0 npm run build` 关闭混淆。
- 项目未配置测试运行器；验证 = `npm run lint` + `npm run build` + `npm run dev` 中手动验证。

## Coding Style & Naming Conventions

- 严格 TypeScript，禁止用 `any` 静默错误；故意未使用的变量以 `_` 前缀标记。
- ESLint 警告 `@typescript-eslint/no-explicit-any` 与未使用变量。
- 改前先检索现有实现和相邻调用点，优先复用 `src/main/`、`src/renderer/src/utils/` 与现有组件。
- 不做无关重构，不顺手改命名 / 结构 / 样式；保持 DRY 与小步修改。

## Architecture Constraints

- 分层边界：`src/main` 主进程能力 / 窗口 / Session / IPC / 数据 / 总结链路；`src/preload` 仅做安全桥接;`src/renderer` 仅做 UI / 状态 / 页面逻辑 / Webview 交互。禁止跨层塞逻辑。
- IPC 约束：新增或修改 IPC 必须同时同步 `src/main/ipcHandlers.ts`、`src/preload/index.ts`、`src/preload/index.d.ts` 及渲染层调用点;返回结构统一为 `{ success, data?, error? }`。
- Webview 约束:站点选择器统一维护在 `src/renderer/src/config/selectors.ts`，注入脚本统一在 `src/renderer/src/utils/webviewScripts.ts`；优先多候选选择器与可见性判断，避免脆弱 DOM 依赖。
- 总结链路约束：涉及总结请求 / 供应商适配 / 流式解析 / reasoning / thinking / 中止能力时必须同步 `src/main/config/requestBodyConfig.ts`、`src/main/api/summaryApi.ts`、`src/main/ipcHandlers.ts`、`src/preload/index.ts` 与相关前端调用，确保 `abortSummary`、流式回调与思考内容兼容。
- 所有 Webview 共享 `persist:shared` Session，登录态全局；任何涉及 Session / Cookie / 账户切换的改动必须评估全局影响。

## Done Criteria

一项改动只有在以下条件全部满足时才算完成：
- 行为已落到正确的层（main / preload / renderer），IPC 契约端到端同步。
- `npm run lint` 与 `npm run build` 通过。
- 受影响的链路在 `npm run dev` 中已被实际触发验证；如无法验证，需明确说明并给出最小等价检查。
- 没有牵动无关文件。

## Commit & Pull Request Guidelines

- Commit 消息遵循 Conventional Commits（`feat:` / `fix:` / `refactor:` / `docs:` / `chore:` 等）。
- PR 描述应包含改动摘要、验证证据、关联 issue;UI 改动附截图。
- 改动尽量聚焦，避免顺手重构。

## Security & Configuration

- 禁止泄露 API Key、Token、Cookie、用户输入或模型输出中的敏感内容。`electron-store` 与 `persist:shared` 中的数据视为敏感。
- 涉及登录态、账户切换、深度链接等敏感路径时，先评估再动手。
- 添加生产依赖、修改打包配置或安全敏感代码前先确认。

## Agent-Specific Instructions

- 改动前先检索现有实现，避免重复实现。
- 改动后跑与改动直接相关的最小验证；无法验证时明确说明未验证项与风险，不要在未验证下声称完成。
- 如果规则与当前代码冲突，以代码事实为准，并先修正本文件。规则改动需与影响目录边界 / 分层 / IPC / Webview / 总结链路 / 构建命令的代码改动同批提交。

## Tracking Files

- `SESSION_LOG.md`：会话级操作日志，会话结束后追加 `HH:MM | type: path - summary` 条目，按 `## YYYY-MM-DD` 分组。修 bug 时如有复用价值，记录现象、根因、踩坑点和最终修复。
- `TODO.md`：用户授权下由 AI 辅助维护的项目级 backlog，记录重要待完成与已完成事项;默认不读取、不编辑，必要时建议新增或勾选条目，并在用户同意后更新。
- `CHANGELOG.md`：可选的 release-facing 变更日志，仅记录用户可见或发布相关变化;不放分钟级操作日志。
