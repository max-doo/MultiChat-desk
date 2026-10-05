# 知识索引与路由表

> Created: 2026-10-05 11:09 (Asia/Shanghai, UTC+08:00)

复杂修改、调试或需要历史经验时，先匹配任务关键词与文件路径，再读取 KNOWLEDGE.md 中对应的 `###` 章节。多个主题命中时只读确有依赖的章节；不要因此全文加载知识或归档日志。没有匹配主题时先查代码，确认有可复用经验后再新增主题和路由。

## L0 全局规则（已由 AGENTS.md 提供）

| 范围 | 内容 | 位置 |
|---|---|---|
| 全局纪律 | npm、生成产物、分层、IPC、共享 Session、安全与禁止擅自切分支 | AGENTS.md 对应章节 |
| 工作方式 | 最小充分复杂度、文档写作、真实时间、验证与完成要求 | AGENTS.md 对应章节 |
| 记忆维护 | 脚本写日志、知识路由、冲突修正、用户管理 TODO | AGENTS.md Working Rules / Memory Layer |

## L1 知识路由（按触发条件读取对应章节）

| id | 触发词或文件路径 | KNOWLEDGE 章节 | 适用说明 |
|---|---|---|---|
| `webview-extraction` | selectors.ts、webviewScripts.ts、contenteditable、Slate、DOM、CodeMirror、回复采集 | ### 1. Webview 输入、选择器与回复采集 | 先确认当前 DOM 与调用链 |
| `research-frames` | Deep Research、研究报告、Qwen、iframe、CDP、OOPIF | ### 2. 深度研究与跨 frame 提取 | 提取方案不等于已验收能力 |
| `markmap-layout` | localMindmap.css、foreignObject、连线、折叠按钮、中文竖排、点击遮挡 | ### 3. Markmap 布局、连线与命中区域 | 布局与按钮测量 |
| `markmap-viewport` | useMindmapCanvas.ts、Markmap.create、fit、zoom、ResizeObserver、隐藏画布 | ### 4. Markmap 可见性、缩放与视口 | 初始化和后续更新区分 |
| `markmap-editing` | Markmap、setData、treeRef、contenteditable、节点编辑、选中态、preventScroll | ### 5. Markmap 编辑与状态生命周期 | 布局问题另读主题 3 |
| `react-state` | useState、useMemo、useCallback、callback ref、闭包、共享抽屉、受控状态、旧计划 | ### 6. React 状态与共享 UI | 按实际时序选择状态方案 |
| `selection-windows` | inputHookManager.ts、uiaSelectionHelper.ts、selectionReader.ts、shortcutManager.ts、UIA、monio、划词、焦点、标题栏、拖动 | ### 7. 划词、快捷键与窗口交互 | 自动划词与主动快捷键分开 |
| `notes-identity` | noteManager.ts、noteIdentity.ts、noteTranscript.ts、笔记、快照、URL路径、XML、批注 | ### 8. 笔记、快照与会话身份 | 整段对话采集另读主题 1 |
| `history-lifecycle` | appStore.ts、useWebviewLifecycle.ts、历史恢复、currentConversationId、轮询、休眠、hibernate、内存、日志量 | ### 9. 历史恢复、轮询、休眠与内存 | 保持磁盘/内存与会话边界 |
| `task-api` | taskSplitApi.ts、requestBodyConfig.ts、useTaskSplit.ts、useDebateRunner.ts、ipcHandlers.ts、env.d.ts、任务分配、辩论、model ID、AbortController | ### 10. 任务分配、辩论与 API 请求 | 旧总结链路仅在历史主题 |
| `cli-daemon` | src/cli/、src/main/daemon/、SessionManager.ts、AutomationService.ts、Named Pipe、CLI、后台会话、诊断透传 | ### 11. CLI 与后台会话 | 通信顺序和输出协议 |
| `build-verification` | electron.vite.config.ts、electron-builder、NSIS、winCodeSign、TUN、QUIC、混淆、toString、打包、tsc、构建验证 | ### 12. 构建、打包与开发验证 | 平台/版本经验需核对环境 |
| `historical-only` | WebContentsView、Electron 28、Chromium 120、summaryApi.ts、useSummaryPanel.ts、generate-summary、EnterWorktree、worktree、旧架构 | ### 13. 历史架构与版本限定经验 | 只在明确追溯或已授权工作中加载 |

日常实现不默认读 TODO、CHANGELOG 或归档。需要近期上下文时读 SESSION_LOG；只有追溯更早会话才读 `.memory/sessions/` 对应日期。既有脚本只提示缺少路由的三级标题，不检查 INDEX 缺失、触发词质量或反向失效条目；维护时需确认章节标题与表格一致。
