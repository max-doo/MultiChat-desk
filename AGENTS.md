# ModelMash Codex Rules

- 项目快照：这是一个基于 Electron 的桌面应用，前端使用 React + TypeScript。
- 核心形态：通过多个 Webview 并行接入不同 AI 平台，并提供统一发送、历史记录和 AI 总结能力。
- 结构主线：主进程处理窗口、Session、IPC 和总结链路；预加载层提供安全桥接；渲染层负责 UI、状态和 Webview 交互。
- 环境：Windows + PowerShell。
- 代码要求：禁止屎山代码；保持 DRY；优先小步修改，避免大面积重写。
- 规则维护：`AGENTS.md` 必须反映当前仓库的真实硬约束。凡是改动影响目录边界、核心分层、IPC 暴露面、Webview 注入入口、总结链路或构建/验证命令，必须在同一批改动中同步更新 `AGENTS.md`。如果规则与当前代码冲突，以代码事实为准，并先修正规则。
- 改动范围：优先只改 `src/` 和必要配置文件；禁止手改 `out/`、`dist/` 等构建产物。
- 修改前先检索：先搜索现有实现和相邻调用点，优先复用已有类型、工具函数、配置和模式，禁止重复实现。
- 不做无关重构：只处理当前任务直接相关的代码；除非当前改动必需，否则不要顺手调整命名、结构或样式。
- 分层边界：`src/main` 负责 Electron 主进程能力、窗口、Session、IPC、数据与总结链路；`src/preload` 只做安全桥接；`src/renderer` 只做 UI、状态、页面逻辑和 Webview 交互。禁止跨层塞逻辑。
- IPC 约束：新增或修改 IPC 时，必须同时检查并同步 `src/main/ipcHandlers.ts`、`src/preload/index.ts`、`src/preload/index.d.ts` 和渲染层调用点；返回结构保持 `{ success, data?, error? }` 风格一致。
- Webview 约束：模型站点选择器统一维护在 `src/renderer/src/config/selectors.ts`；注入脚本统一维护在 `src/renderer/src/utils/webviewScripts.ts`；不要把站点 DOM 逻辑分散到其他文件；选择器优先多候选和可见性判断，避免脆弱 DOM 依赖。
- 总结链路约束：涉及总结请求、供应商适配、流式解析、reasoning/thinking 处理或中止能力时，必须同时检查 `src/main/config/requestBodyConfig.ts`、`src/main/api/summaryApi.ts`、`src/main/ipcHandlers.ts`、`src/preload/index.ts` 与相关前端调用，确保 `abortSummary`、流式回调和思考内容兼容。
- Session 与安全：项目使用 `persist:shared` 共享登录态；任何涉及 Session、Cookie、登录态或账户切换的改动都必须评估全局影响。禁止泄露 API Key、Token、Cookie、用户输入或模型输出中的敏感内容。
- 验证要求：改动后至少执行与改动直接相关的最小验证；无法验证时要明确说明未验证项和风险，不要在未验证的情况下声称完成。
