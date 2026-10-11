# 待办事项

<!--
项目级 backlog，用于记录重要的待办和已完成事项。
由用户授权、AI 辅助维护。Agent 可在用户同意或明确请求后建议更新和编辑此文件。
-->

## 待完成

### 平台 DOM 选择器与网页自动化
- [ ] **注入 DOM 选择器全面更新与鲁棒性提升**：当前 `selectors.ts` 中部分平台注入选择器因网站改版失效，需逐平台验证修正，并落地鲁棒性方案（见 `docs/superpowers/plans/2026-06-28-resilient-webview-automation.md`）及探索自动抓取 DOM 辅助更新选择器的方案
- [ ] **AI 生图 DOM 适配与一键下载修复**：
  - [ ] 修复一键下载图片对豆包、Gemini、ChatGPT、智谱不生效的问题
  - [ ] 在 `npm run dev` 中逐一验证并修正 9 个平台的 `imageGeneration` 选择器（chatgpt/gemini/grok/qwen/kimi/doubao/yuanbao/chatglm/yiyan）
- [ ] **arena.ai DOM 适配**：在 `npm run dev` 中打开 arena webview，验证输入框/发送按钮/消息容器选择器是否匹配实际 DOM 结构并修正 (`selectors.ts`)
- [ ] **遗留：ChatGPT Deep Research 报告提取重构**：报告正文跨域、多层 OOPIF 提取仍失败且会拖长爬取时间；相关提取器暂存于 `feat/chatgpt-deep-research-extractor`，主分支暂不启用，后续需重新设计并在真实报告上验收
- [ ] **上游跟踪：Gemini 历史会话恢复失败（Gemini 网页端缺陷）**：`loadURL(/app/<id>)` deep-link 冷加载有概率落在初始页不渲染对话内容（浏览器直开同理，仅点击网页左侧栏历史可稳定恢复）。跟踪条件：日后浏览器直开 `https://gemini.google.com/app/<id>` 若能稳定显示历史，可恢复 `loadURL` 路径

### CLI 能力完善
- [ ] **CLI 平台选择器验收**：daemon 通信已就绪，需结合 `selectors.ts` 更新逐平台验证 `exec` / `collect` 稳定性
- [ ] **CLI `exec` 命令一体式轮询改进**：当前 `exec` 发送提示词后立即返回，需再手动 `collect` 取结果；期望支持发送后终端挂起轮询等待 AI 回复完成并直接输出完整结果

### 打包分发与工程优化
- [ ] **macOS 真机打包验收与签名公证**：标题栏 UI 适配与构建脚本已就绪，需在 macOS 设备上运行 `npm run build:mac` 验证 DMG 产物，并配置 Apple Developer ID 签名与公证（Notarization）
- [ ] **Electron OTA 自动下载安装更新**：当前已完成后台版本检测与 NEW 提醒；完整 NSIS 自动下载与安装更新见 `docs/superpowers/plans/2026-05-04-electron-ota.md` 与 `docs/superpowers/specs/2026-05-04-electron-ota-design.md`
- [ ] **ModalShell 统一与 SettingsDrawer 拆分**：抽取通用 `ModalShell` 组件并将 SettingsDrawer 内嵌 Modal 拆分至 `components/settings/`（计划见 `docs/superpowers/plans/2026-07-05-modal-shell-unification.md`）
- [ ] **Webview 渲染进程回收评估（可选）**：当前保留 `mountedWebviews` Set 以保障会话连续性；后续如需进一步降低多平台切换后的内存占用，可评估「新建会话时清空 `mountedWebviews` Set」方案

## 已完成

### 2026-10-10

- [x] Webview 单卡片独立页面查找（`Ctrl+F` / `Cmd+F`）：新增 `WebviewFindBar` 组件，支持按键转发、匹配计数、大小写敏感切换与上下跳转 (`WebviewFindBar.tsx`, `webviewManager.ts`)
- [x] WebView 与全局自绘毛玻璃右键菜单：统一圆角浮层视觉、矢量图标与快捷键提示，支持仅在会话已存在思维导图时动态展示「加入当前导图」 (`CustomContextMenu.tsx`, `webviewManager.ts`)
- [x] 模型下拉列表自定义排序：设置面板新增拖拽排序弹窗 `ModelOrderModal`，支持拖拽重排与恢复默认顺序 (`ModelOrderModal.tsx`, `SettingsDrawer.tsx`, `appStore.ts`)
- [x] 笔记快照角色识别与回复自动轮询修复：适配 ChatGPT DOM 修复 `<user>` / `<assistant>` 角色丢失；恢复多 AI 与任务分配自动轮询快照，修复辩论模式 `WebContents ID` 实例绑定与同模型槽位历史恢复 (`noteTranscript.ts`, `useDebateRunner.ts`, `appStore.ts`)

### 2026-10-09

- [x] 笔记工作台瀑布流重构与原文对照侧栏：重构为会话卡片瀑布流首页 + 右侧原文对照侧栏（原网页优先/快照切换、CSS Custom Highlight 黄色高亮双向定位、同页展开思维导图画布） (`NotesPage.tsx`, `NotesConversationCards.tsx`, `NotesSourcePane.tsx`)
- [x] 思维导图节点格式工具条与修改协议三方合并：支持单选/多选批量设置节点加粗与高亮、就地编辑保留样式；加固修改协议容错与三方合并冲突保留调整 (`useMindmapCanvas.ts`, `mindmapInlineFormat.ts`, `mindmapEdits.ts`)

### 2026-10-06

- [x] 思维导图全套能力与双协议持续修改：本地 Markmap 导图（正交连线、就地编辑、左键框选多选、跨层级分支拖拽吸附、导出 PNG/SVG）、CodeMirror 6 大纲编辑器、`<mindmap_edits>` 局部替换与 `<mindmap_rewrite>` 整份覆写双协议、完整来源 Markdown 附件上传、后台生成会话闲置超时释放与独立平台偏好记忆 (`MindmapService.ts`, `ConversationMindmapPanel.tsx`, `LocalMindmapPanel.tsx`, `MindmapMarkdownEditor.tsx`)
- [x] 本地数据治理与单会话独立持久化：新增 `HistoryManager` 将对话与总结历史重构为单会话独立 JSON 文件（`history/conversations`、`history/summaries`），彻底解决旧 `storeSet('history')` 整数组覆写问题；启动自动平滑迁移，支持历史、笔记、导图与设置缓存的完整备份与恢复 (`historyManager.ts`, `noteManager.ts`, `ipcHandlers.ts`)
- [x] 总结页极简浮岛输入栏与附件智能复用：底部输入栏重构为毛玻璃浮岛（最多 3 行自适应），支持发送后单按钮原位撤回提示词及 `uploadedOutputsRef` 附件内容指纹复用 (`SummaryPanel.tsx`, `useWebviewSummary.ts`)
- [x] 快捷窗口尺寸持久化与失焦自动隐藏恢复：自动保存并恢复快捷窗口宽高（扣除侧栏动态宽度），恢复未固定（unpinned）状态下的失焦自动隐藏 (`webviewManager.ts`, `index.ts`)

### 2026-09-28

- [x] 本地会话笔记系统与划词批注：集成 `NoteManager` 原子化存储、右键“记为笔记”快照截取、`<user>`/`<assistant>` XML 结构解耦与 Markdown/JSON 导出 (`noteManager.ts`, `noteTranscript.ts`, `NotesPage.tsx`)
- [x] 快捷窗口与主窗口单窗侧边栏：支持拖拽调节宽度（最大 1200px）、划词追问注入、思维导图视图集成及 30 秒无活动自动休眠 (`QuickPage.tsx`, `MainPage.tsx`, `useWebviewSidebar.ts`)
- [x] 构建混淆兼容与外链安全加固：修复生产构建 JS 混淆导致 Webview 注入脚本 `toString()` 失效问题；移除废弃 API 总结模式；支持 ChatGPT `/branch/` 同页导航并收紧外链校验 (`webviewScripts.ts`, `webviewManager.ts`)

### 2026-08-07

- [x] 划词悬浮工具条托盘开关与后台自愈：新增 `selectionToolbarManager` 统一管理设置与托盘菜单开关同步，默认开启划词工具条，修复系统休眠/锁屏恢复后失活与连续触发丢包问题 (`selectionToolbarManager.ts`, `inputHookManager.ts`)
- [x] 通义千问深度研究报告抓取适配：适配 `qianwen-layout-right-panel` 宽窄屏布局与 `deep-research-iframe` 跨源提取 (`webviewScripts.ts`, `selectors.ts`)

### 2026-07-19

- [x] 划词快捷工具条事件流与状态退避重试加固：增加 event.time 心跳检查与生命周期重建，修复拖选门槛误伤 (`src/main/inputHookManager.ts`)

### 2026-07-18

- [x] 低频后台更新检查与提醒：实现启动延迟检查、24h 缓存、GitHub API 限流降级与设置/历史抽屉 NEW 红点提示 (`src/main/updater/checker.ts`, `useUpdateState.ts`, `AboutSection.tsx`)
- [x] Windows 标题栏与拖动/闪黑重构：自绘无框窗口控制按钮、解决最大化闪黑与拖动手感的 Pointer Capture + drag-region 方案 (`Layout.tsx`, `ipcHandlers.ts`)
- [x] macOS 标题栏适配与构建脚本：完成 `mac-titlebar` 防重叠适配、拖拽契约校验脚本与 macOS 构建资源生成脚本 (`Layout.tsx`, `index.css`, `generate-mac-assets.sh`)

### 2026-07-16

- [x] 历史抽屉统一与架构提升：HistoryDrawer 提升至 App.tsx 统一渲染，总结页复用 HistoryDrawer，删除 SummaryHistoryDrawer (`App.tsx`, `HistoryDrawer.tsx`)

### 2026-07-06

- [x] 任务分配模式（`task_assignment`）与 `TaskSplitModal` 拆解失败上拉弹窗：支持目标拆解、槽位对齐分发、失败重试与中止 (`TaskModePanel.tsx`, `SubtaskList.tsx`, `useTaskSplit.ts`, `taskSplitApi.ts`)
- [x] 辩论模式（`debate`）与回复轮询稳定性：双窗正反方轮转、基线快照对比 + 连续稳定判定、进行中禁用模式切换及历史状态完整持久化 (`DebateModePanel.tsx`, `useDebateRunner.ts`, `Layout.tsx`)
- [x] AI 生图一键下载、历史记录分层存储、十处内存泄漏审计修复、会话轮询去重与 Webview 智能休眠调度 (`WebviewCard.tsx`, `appStore.ts`, `ipcHandlers.ts`)

### 2026-06-28

- [x] 桌面端快捷访问特性与项目更名 MultiChat：系统托盘、主窗关闭转隐藏、`#quick` 快捷窗口、跨窗口状态广播、剪贴板快捷召唤与快捷键录制管理
- [x] CLI Daemon 基础架构（Tasks 1-5）：SessionManager（后台 BrowserWindow 会话管理）、AutomationService（主进程自动化执行内核）、Named Pipe Server（`\\.\pipe\multichat-daemon`）、CLI Client（`daemon status/exec/collect`）、IPC Bridge（main↔renderer 通信桥梁）
- [x] 划词悬浮 Toolbar 完整体验：monio-napi 全局鼠标钩子 + UI Automation 选区读取 + 无焦点悬浮 ToolbarWindow，支持"问问"/搜索/总结/翻译/复制等动作
- [x] 全局快捷键设置 UX 重构：ShortcutRecorder 交互式捕获录制组件，按键徽章展示、一键清空与重置默认值
- [x] 修复 electron-builder Windows 打包失败（winCodeSign 符号链接需开发者模式）

### 2026-05-04

- [x] Webview 总结 composer 重构与自适应传输：右栏全高 WebviewCard + 底部自适应 composer，支持短文本直接注入与长文本自动上传 Markdown 附件 (`SummaryPanel.tsx`, `useWebviewSummary.ts`)
- [x] 重构总结页数据流：移除全局 `reportData`，改为一次性 `pendingSummarySession` 导航数据包，实现总结 session 的完全数据隔离 (`appStore.ts`, `MainPage.tsx`, `SummaryPage.tsx`, `SummaryPanel.tsx`)
- [x] 修复：启动 Webview 空白问题（冷启动白屏，需 Ctrl+R）

### 2026-05-03

- [x] 修复 #1: 删除 API 供应商时同步移除其下的总结模型 (`SettingsDrawer.tsx`)
- [x] 修复 #3: 恢复历史记录后保持保护状态，防止 reportData 覆盖历史模型回复 (`SummaryPage.tsx`)
- [x] 修复 #9: 导出文件时若用户删除后缀名自动补回 .md (`ipcHandlers.ts`)
- [x] 修复 #10: 更新历史记录时保留用户重命名的标题 (`useSummaryPanel.ts`)
- [x] 修复 #11: 文件上传成功后不再因 DOM 未检测到文件名而误报失败 (`WebviewCard.tsx`)
- [x] 修复 #13: 多行文本注入时因 trim() 导致首尾换行被误报为输入失败 (`webviewScripts.ts`)
- [x] 修复 #16: 首次生成总结时快照 modelResponses，避免新对话输出覆盖历史总结 (`useSummaryPanel.ts`)
- [x] 修复 #17: 为 ChatGPT 添加 reportContainer 选择器，修复 Deep Research 输出无法提取 (`selectors.ts`)
- [x] 新增 #4: 总结重新生成时支持修改用户要求后再生成 (`useSummaryPanel.ts`, `SummaryPanel.tsx`)
- [x] 新增 #5: 历史记录列表中高亮当前打开的历史项 (`HistoryDrawer.tsx`, `SummaryHistoryDrawer.tsx`)
- [x] 新增 #6: 首次总结成功后异步调用 AI 生成历史记录标题 (`useSummaryPanel.ts`)
- [x] 新增 #7: Webview 顶部工具栏增加新建对话按钮 (`WebviewCard.tsx`)
- [x] 新增 #12: 设置面板增加缓存数据导出功能，API Key 自动脱敏 (`ipcHandlers.ts`, `SettingsDrawer.tsx`)
- [x] 新增 #15: 支持从剪贴板直接粘贴图片并上传到各模型 (`ControlBar.tsx`, `ipcHandlers.ts`)
- [x] 补齐 macOS 打包配置：新增 `mac`/`dmg` 配置、entitlements、`.icns` 图标 (`electron-builder.yml`, `package.json`)
- [x] 新增：ControlBar 增加 AI 生图一键切换按钮，支持 9 个平台，复用 DeepResearch 注入脚本架构 (`selectors.ts`, `webviewScripts.ts`, `WebviewCard.tsx`, `appStore.ts`, `ControlBar.tsx`)
