# Session Log

## 2026-06-28

### 20:24 | claude-code

- done: 测试 CLI 功能：daemon status/exec/collect 命令，验证参数校验、错误处理、JSON 输出。CLI 通信正常，豆包 exec 成功，collect 返回空（选择器过期）
- context: 在 feature/cli-daemon worktree 中测试 CLI，开发服务器已启动
- unresolved: ['豆包 collect 选择器过期；ChatGPT/DeepSeek 输入框选择器过期']

### 20:11 | Antigravity

- done: 实现 CLI Daemon 架构 (Tasks 1-5): SessionManager, AutomationService, Named Pipe Server, CLI Client, IPC Bridge
- decision: automation:send-prompt uses fixed 5s delay between exec and collect; callers needing precise completion should use exec+poll pattern instead
- added:
  - `src/main/services/SessionManager.ts`
  - `src/main/services/AutomationService.ts`
  - `src/main/daemon/ipcServer.ts`
  - `src/cli/index.ts`
  - `src/cli/commands.ts`
  - `src/cli/client.ts`
  - `src/shared/config/selectors.ts`
  - `src/shared/utils/webviewScripts.ts`
  - `src/shared/utils/htmlToMarkdown.ts`
  - `build/multichat-cli.cmd`
  - `build/multichat-cli.sh`
- modified:
  - `src/main/index.ts`
  - `src/main/ipcHandlers.ts`
  - `src/main/webviewManager.ts`
  - `src/preload/index.ts`
  - `src/preload/index.d.ts`
  - `src/renderer/src/store/appStore.ts`
  - `src/renderer/src/config/selectors.ts`
  - `src/renderer/src/utils/webviewScripts.ts`
  - `src/renderer/src/utils/htmlToMarkdown.ts`
  - `package.json`
  - `electron-builder.yml`
  - `tsconfig.node.json`
- lesson: CLI --json mode: ALL output (including errors) must use process.stderr.write for errors; only final successful data goes to stdout via console.log

### 20:06 | Antigravity

- done: Task 5: 重构 Renderer 与 Main 的通信桥梁
- decision: appStore.sendMessageToAll 使用 WebviewCardRef 抽象层而非直接 executeJavaScript，无需迁移；新的 automationSendPrompt/automationCollect 是独立的 CLI 驱动接口
- modified:
  - `src/main/ipcHandlers.ts`
  - `src/preload/index.ts`
  - `src/preload/index.d.ts`
  - `src/renderer/src/store/appStore.ts`

### 20:03 | claude-code

- done: 新增 Task 4 事件驱动自动保存：sniffer 推送 __MM_REPLY_DONE__(含请求体提取的 prompt)→WebviewCard console-message 接收→appStore.recordSniffedTurn(活跃monitor直接落库+跳过DOM轮询；手动聊天续接同平台同URL历史)。消除 pollPlatforms 反复 DOM 爬取、补齐单webview手动聊天盲区。无新增 IPC
- context: 复用既有 __MM_LOG__ console-message 通道与 shouldStartNewConversation URL 判定；用户选定手动聊天续接同平台最近一条
- decision: 请求体解析 prompt 只读不改、低风险不触 TOS；pollPlatforms 降级为 sniffer 失效站点兜底
- modified:
  - `docs/superpowers/plans/2026-06-28-resilient-webview-automation.md`

### 19:49 | Antigravity

- done: Implement CLI client and packaging scripts
- added:
  - `src/cli/index.ts`
  - `src/cli/commands.ts`
  - `src/cli/client.ts`
  - `build/multichat-cli.cmd`
  - `build/multichat-cli.sh`
- modified:
  - `package.json`
  - `package-lock.json`
  - `electron-builder.yml`
  - `electron-builder-portable.yml`
  - `tsconfig.node.json`

### 19:47 | claude-code

- done: 按二级菜单/正则区分搜索反馈重做方案二：step schema 扩展 regex/exclude/wordBoundary/caseSensitive/menuOpenerFallback；findElement 匹配层升级为 matchText(单词边界解决Search/Research误匹配)；新增跨步菜单兜底 findMenuOpener；selectors.ts 易误匹配条目改用 regex+exclude；记录非DOM替代方案调研(网络改写/CDP输入)经评估暂不采用
- context: 用户选定 DOM 强化路线、CDP 暂不纳入
- modified:
  - `docs/superpowers/plans/2026-06-28-resilient-webview-automation.md`

### 19:34 | Antigravity

- done: Resolve stream buffering race condition and improve parameter fallback in ipcServer
- modified:
  - `src/main/daemon/ipcServer.ts`

### 19:26 | Antigravity

- done: Implement Named Pipe daemon server for CLI commands
- added:
  - `src/main/daemon/ipcServer.ts`
- modified:
  - `src/main/index.ts`

### 19:21 | claude-code

- done: 按评审意见修订 Resilient Webview Automation 方案：方案二改为最小增量兜底并收紧匹配；方案三补多平台 payload 适配/行缓冲/流完成判定/降级日志；Task3 锚点精确化、commit 改为需用户确认
- modified:
  - `docs/superpowers/plans/2026-06-28-resilient-webview-automation.md`

### 19:15 | Antigravity

- done: Fix Code Quality Reviewer issues in AutomationService
- decision: Inject electron-store into AutomationService to support reading custom selectors in main process, and clean up load listeners on timeout.
- modified:
  - `src/main/index.ts`
  - `src/main/services/AutomationService.ts`

### 18:59 | Antigravity

- done: Task 2: 抽取执行内核 - Automation Service (Main Process)
- decision: Move selectors and webviewScripts (with htmlToMarkdown) to src/shared and re-export in renderer to maintain backward compatibility.
- added:
  - `src/shared/config/selectors.ts`
  - `src/shared/utils/webviewScripts.ts`
  - `src/shared/utils/htmlToMarkdown.ts`
  - `src/main/services/AutomationService.ts`
- modified:
  - `src/renderer/src/config/selectors.ts`
  - `src/renderer/src/utils/webviewScripts.ts`
  - `src/renderer/src/utils/htmlToMarkdown.ts`
  - `src/main/ipcHandlers.ts`
  - `src/preload/index.ts`
  - `src/preload/index.d.ts`

### 18:38 | Antigravity

- done: Code Review fixes for Task 1: disable backgroundThrottling and handle about:blank
- decision: 在后台 BrowserWindow 设置 backgroundThrottling: false 确保定时器和DOM轮询不被降频；完善页面初始状态 URL 为 '' 或 'about:blank' 时的导航判断
- modified:
  - `src/main/services/SessionManager.ts`

### 18:31 | Antigravity

- done: Task 1: 抽取执行内核 - Session Manager (Main Process)
- decision: 使用 BrowserWindow(show: false, partition: 'persist:shared') 构建后台长驻会话管理单例，复用现有 webview 拦截与脚本注入逻辑
- added:
  - `src/main/services/SessionManager.ts`
- modified:
  - `src/main/webviewManager.ts`
  - `src/main/index.ts`

### 18:26 | Antigravity

- done: 移除 Google Fonts 远程 CDN 依赖，通过 npm 内置 Material Symbols Outlined 和 Roboto 字体
- modified:
  - `package.json`
  - `package-lock.json`
  - `src/renderer/index.html`
  - `src/renderer/src/main.tsx`

### 18:21 | Antigravity

- done: Create git worktree for CLI daemon development at ../MultiChat-desk-cli
- added:
  - `../MultiChat-desk-cli (worktree)`

### 18:12 | Antigravity

- done: Update git remote origin URL to the new repository address https://github.com/max-doo/MultiChat-desk.git
- modified:
  - `.git/config`

### 17:55 | Antigravity

- done: 在生图模式下将总结按钮动态切换为一键下载按钮，并在 TODO.md 中记录后续具体下载功能实现的待办项
- modified:
  - `src/renderer/src/components/ControlBar.tsx`
  - `TODO.md`

### 17:42 | Antigravity

- done: 重构 AI 生图模式为提示词注入（Prompt Injection）模式，大幅优化交互响应和鲁棒性
- decision: 弃用容易因 UI 改版或多语言定位失效的 DOM 模拟点击开启生图菜单逻辑，改为在发送时判断开启状态自动追加生图指令前缀
- modified:
  - `src/renderer/src/components/ControlBar.tsx`

### 17:30 | Antigravity

- done: 交换新建对话与AI生图按钮位置，增加二选一互斥逻辑并统一AI生图的主题高亮样式
- modified:
  - `src/renderer/src/components/ControlBar.tsx`

### 17:27 | Antigravity

- done: Change the deep research and image generation icon colors to gray in the model selection dropdown menu
- modified:
  - `src/renderer/src/components/WebviewCard.tsx`

### 17:24 | Antigravity

- done: 在主页面单窗口模式下隐藏底部工具栏
- modified:
  - `src/renderer/src/pages/MainPage.tsx`

### 17:18 | claude-code

- done: 划词悬浮工具条改用 UI Automation 读取选区替代 Ctrl+C：新增常驻 PowerShell UIA helper（行JSON协议+base64传文本+UTF-8），inputHookManager 按下/松手两次 UIA 读取对比实现拖拽+新选区双条件触发，toolbar:trigger-action 改用缓存文本不发 Ctrl+C，启动预建工具条窗口。修复终端选词杀进程/Word迷你工具条被抢占/拖窗口误弹三个bug
- added:
  - `src/main/uiaSelectionHelper.ts`
- modified:
  - `src/main/inputHookManager.ts`
  - `src/main/webviewManager.ts`
  - `src/main/ipcHandlers.ts`
  - `src/main/index.ts`
- removed:
  - `scripts/diag-uia-selection.ps1`
- lesson(promoted): 划词工具条读取选区应用 UI Automation(TextPattern.GetSelection)替代 Ctrl+C 模拟复制：非侵入、不杀终端进程、不抢Word工具条、可对比新旧选区避免拖窗口误弹。需常驻 PowerShell helper(行JSON协议，文本走base64规避 PS5.1 ConvertTo-Json不转义换行 与中文Windows GBK乱码)，stdin关闭即exit+懒重启防僵尸。覆盖:Word/WindowsTerminal/Chrome可读;VS Code编辑器/记事本不可读→安全降级不弹(其AI划词由全局快捷键Ctrl+C路径覆盖)

### 15:27 | claude-code

- done: 为 WebviewCard 增加初始加载诊断：错误分类(无网络/DNS/超时/连接失败)、30s 首次加载超时、动态计时与取消按钮、分类驱动的错误覆盖层
- modified:
  - `src/renderer/src/components/WebviewCard.tsx`

### 15:20 | claude-code

- done: 排查划词工具条是否会让 Word 迷你工具条消失：用 MM_TOOLBAR_SKIP_PROBE 诊断开关对比，两种方式无差异且 Word 工具条均正常显示，证伪 Ctrl+C 探测与窗口显示两个假设；问题在当前构建未复现。移除临时诊断开关，保留选区探测
- context: 用户报告 Word 弹窗被覆盖/消失；诊断未复现，疑为中途 UI 调整(14:13/14:30)顺带缓解或偶发。如再次复现需补充具体场景(应用/选区方式/时序)
- modified:
  - `src/main/inputHookManager.ts`

### 15:09 | Antigravity

- done: 优化快捷工具条的UI，减少padding，降低工具条及窗口高度，且不改变图标和文字大小
- modified:
  - `src/renderer/src/pages/ToolbarPage.tsx`
  - `src/main/webviewManager.ts`

### 15:08 | claude-code

- done: 完成划词悬浮工具条完整功能：ToolbarPage UI 重构、文本选区探测、ShortcutRecorder 组件、搜索/快捷动作、monio-napi 数组派发修复、工具条开关设置
- added:
  - `src/renderer/src/components/ShortcutRecorder.tsx`
- modified:
  - `src/main/index.ts`
  - `src/main/inputHookManager.ts`
  - `src/main/ipcHandlers.ts`
  - `src/main/shortcutManager.ts`
  - `src/main/webviewManager.ts`
  - `src/preload/index.d.ts`
  - `src/preload/index.ts`
  - `src/renderer/src/components/SettingsDrawer.tsx`
  - `src/renderer/src/pages/QuickPage.tsx`
  - `src/renderer/src/pages/ToolbarPage.tsx`
  - `.memory/KNOWLEDGE.md`
  - `SESSION_LOG.md`

### 15:07 | Antigravity

- done: Optimize floating selection toolbar UI by reducing padding and sizes to decrease its overall height from 48px to 36px
- modified:
  - `src/renderer/src/pages/ToolbarPage.tsx`
  - `src/main/webviewManager.ts`

### 14:55 | Antigravity

- done: Slightly increased other action icon sizes (search, compress, translate, copy) from 16px to 20px on selection floating toolbar.
- modified:
  - `src/renderer/src/pages/ToolbarPage.tsx`

### 14:51 | Antigravity

- done: Increased size of '问问' icon on selection floating toolbar to twice as large (w-7 h-7 / 28px).
- modified:
  - `src/renderer/src/pages/ToolbarPage.tsx`

### 14:50 | Antigravity

- done: Adjusted selection floating toolbar UI: removed capsule pill rounded corners, removed button divider lines, reduced padding/spacing for compactness, added '问问' button with product logo to copy selected text into quick window input, adjusted button order (quick, search, summarize, translate, copy), and updated summarize icon to compress.
- modified:
  - `src/renderer/src/pages/ToolbarPage.tsx`
  - `src/renderer/src/pages/QuickPage.tsx`
  - `src/main/ipcHandlers.ts`
  - `src/preload/index.ts`
  - `src/preload/index.d.ts`

### 14:49 | claude-code

- done: 修复划词悬浮工具条无选中文本也弹出的问题：松手后先用 getSelectedTextAsync(false) 探测选区，空则不弹；恢复 isAppFocused 守卫与收紧手势阈值
- modified:
  - `src/main/inputHookManager.ts`
- lesson(promoted): 划词工具条不能仅凭鼠标手势弹窗：全局鼠标钩子无法判断光标下是否为可文本选区，唯一可靠的跨进程选区信号是模拟 Ctrl+C 探测剪贴板；手势→直接弹窗 必然导致拖窗口/滚动条/空白也误弹

### 14:30 | Antigravity

- done: 优化工具条阴影使其更加轻盈，并修复点击外部需要等待2-3s才消失的BUG，实现取消划词时点击外部区域秒级立即隐藏
- modified:
  - `src/renderer/src/pages/ToolbarPage.tsx`
  - `src/main/webviewManager.ts`
  - `src/main/inputHookManager.ts`

### 14:29 | Antigravity

- done: 修复快捷键录制组件在Windows中文输入法下按住Ctrl+Shift会被过早截断只能记录2个键的Bug
- modified:
  - `src/renderer/src/components/ShortcutRecorder.tsx`
- lesson(promoted): Windows Chrome/Electron中中文输入法对Ctrl+Shift热键响应时会发送e.key='Process'或keyCode=229事件，快捷键录制组件必须将其过滤并视为暂态修饰事件，防止过早触发提交

### 14:24 | Antigravity

- done: 优化快捷键设置UX为业界标准的交互式捕获录制组件，支持按键徽章展示、一键清空与重置默认值
- added:
  - `src/renderer/src/components/ShortcutRecorder.tsx`
- modified:
  - `src/renderer/src/components/SettingsDrawer.tsx`

### 14:22 | Antigravity

- done: 修复划词工具条外部矩形容器问题：在ToolbarPage挂载时强制清除全局 body/html/root 的背景样式，实现真正无边框纯圆角胶囊悬浮效果
- modified:
  - `src/renderer/src/pages/ToolbarPage.tsx`

### 14:19 | Antigravity

- done: 设置其他快捷键默认值为空时 placeholder 采用之前默认设置组合键
- modified:
  - `src/renderer/src/components/SettingsDrawer.tsx`

### 14:13 | Antigravity

- done: 优化划词工具条UI：去除了所有Icon的高亮颜色采用统一无色文字说明，去除了包裹外部容器使页面呈现出只有毛玻璃样态工具条的纯粹UI效果，调整窗口宽高适配文本按钮
- modified:
  - `src/renderer/src/pages/ToolbarPage.tsx`
  - `src/main/webviewManager.ts`

### 14:10 | Antigravity

- done: 为快捷窗口增加搜索提示词及搜索动作支持，默认关闭除召唤以外的全局快捷键，并在设置中增加划词悬浮工具条开启/关闭开关与搜索按钮
- modified:
  - `src/main/shortcutManager.ts`
  - `src/main/ipcHandlers.ts`
  - `src/main/index.ts`
  - `src/preload/index.d.ts`
  - `src/preload/index.ts`
  - `src/renderer/src/pages/QuickPage.tsx`
  - `src/renderer/src/pages/ToolbarPage.tsx`
  - `src/renderer/src/components/SettingsDrawer.tsx`

### 14:00 | claude-code

- done: 清除划词工具条 inputHookManager.ts 中两条每次触发都打印的调试日志（MouseReleased / Double click detected），逻辑与判定不变。
- context: 上一条会话条目的收尾清理；保留 start/stop/Failed/Detected selection gesture 等关键节点日志。
- modified:
  - `src/main/inputHookManager.ts`

### 13:56 | claude-code

- done: 修复划词悬浮工具条永不触发：monio-napi 的 startListen 回调运行时按 EventJs[] 数组批量派发（d.ts 标注为单个 EventJs，与运行时不符），直接读 event.eventType/event.mouse 全得 undefined，导致探针条件永不命中、button=undefined、distance=NaN。改为 Array.isArray(payload)?payload:[payload] 解包后逐条 processEvent。实测工具条可正常触发。
- context: 本轮用 systematic-debugging 证伪了交接报告里的 4 个假设（原生二进制缺失/eventMask 漏发/out bundle 陈旧/electron-vite 打包破坏），并用 console.log(JSON.stringify(event)) 揭示 raw=[{...}] 即数组真身，定位真因。同时纠正 KNOWLEDGE.md 中前一会话误写的“嵌套对象”教训（实为数组）。临时诊断脚本 scripts/diag-monio.js 与 index.ts 临时 process 异常监听均为本轮创建后删除/还原，净零未留存。
- decision: 保留 startListen 单回调用法（而非退回 InputHook），因为 eventMask=2047、isRunning=true 已证实库在 Electron 内正常工作，真因仅在载荷形状。
- modified:
  - `src/main/inputHookManager.ts`
  - `.memory/KNOWLEDGE.md`
- lesson(promoted): monio-napi startListen 回调实为 EventJs[] 数组派发，d.ts 与运行时不符；回调字段全 undefined 时，先用 JSON.stringify(event) 看输出是否以方括号开头（数组），勿猜嵌套字段名、勿归咎 OS 消息循环或库损坏。修复：Array.isArray(payload)?payload:[payload] 逐条处理。
- unresolved: ['InputHook.onMouseXxx 是否同样按数组派发未单独验证（仅见历史 button=undefined 症状）；如未来用回 InputHook 需先确认。']

### 13:08 | Antigravity

- done: 全面迁移 monio-napi 的 InputHook 至官方主推的 startListen API，解决底层事件包装结构差异导致坐标为 0 的问题
- decision: 废弃偏差较多的 InputHook 类，改用官方 README 中提供完整结构保证和实战示例的全局 startListen 回调
- modified:
  - `src/main/inputHookManager.ts`

### 13:04 | Antigravity

- done: 修复 monio-napi 底层嵌套结构导致划词坐标与按键为 undefined 从而计算出 distance=NaN 的Bug
- modified:
  - `src/main/inputHookManager.ts`
- lesson(promoted): 在使用 monio-napi 的 InputHook (如 onMouseDown / onMouseUp) 时，虽然 TypeScript 声明为扁平结构 MouseButtonEventJs { x, y, button }，但运行时实际传递的是嵌套的 EventJs { mouse: { x, y, button } } 对象，必须使用兼容函数优先从 e.mouse 中解包获取坐标与按键

### 13:02 | Antigravity

- done: 修复划词悬浮工具条无法触发的问题：移除应用内焦点拦截、放宽手势判定门槛并增强按键兼容性
- decision: 放宽左键判定以兼容 N-API 跨层传递的 button 字段差异；移除 duration 上限以支持长文本慢速划选；移除 isAppFocused 拦截支持全局触发
- modified:
  - `src/main/inputHookManager.ts`

### 12:54 | Antigravity

- done: 实现类似豆包与桌面划词翻译的悬浮工具条（Selection Floating Toolbar）
- decision: 采用无焦点（focusable: false）和 showInactive() 悬浮工具条，避免抢夺外部应用焦点导致选区高亮丢失；基于 screen 逻辑坐标系定位消除高 DPI 错位风险；动作触发时严格遵循先复制后 focus 规则
- added:
  - `src/main/inputHookManager.ts`
  - `src/renderer/src/pages/ToolbarPage.tsx`
- modified:
  - `package.json`
  - `package-lock.json`
  - `electron-builder.yml`
  - `src/main/index.ts`
  - `src/main/shortcutManager.ts`
  - `src/main/webviewManager.ts`
  - `src/main/ipcHandlers.ts`
  - `src/preload/index.ts`
  - `src/preload/index.d.ts`
  - `src/renderer/src/App.tsx`

### 12:07 | Antigravity

- done: 修复快捷键注入内容时重复注入及发送后继续注入的Bug
- modified:
  - `src/renderer/src/utils/webviewScripts.ts`
- lesson(promoted): 在往富文本编辑器（如 Slate/Lexical/contenteditable）注入带有换行符或多行文本时，编辑器会将其格式化为 HTML 标签，读取 textContent 会丢失换行导致全等校验失败，因此执行完插入后应直接返回成功从而停止重试轮询

### 12:02 | claude-code

- done: 将 AI 平台 logo 从外部 CDN 链接迁移为本地资源，支持离线显示
- added:
  - `src/renderer/src/assets/logos/ (13 个 logo 文件: chatgpt.svg`
  - `gemini.png`
  - `grok.png`
  - `claude.svg`
  - `perplexity.png`
  - `arena.png`
  - `doubao.png`
  - `yuanbao.png`
  - `qwen.svg`
  - `deepseek.png`
  - `kimi.ico`
  - `chatglm.ico`
  - `yiyan.ico)`
- modified:
  - `src/renderer/src/store/appStore.ts (logo 引用从外部 URL/base64 改为 Vite 静态资源 import)`

### 11:58 | Antigravity

- done: 修复划词快捷键未选中内容时呼出弹窗及误把陈旧剪贴板当做选中文本的Bug
- modified:
  - `src/main/shortcutManager.ts`
- lesson(promoted): 遇到划词快捷键时需区分主动呼出和划词操作，获取选中文本失败后切勿兜底返回陈旧剪贴板数据

### 11:45 | Antigravity

- done: 优化快捷弹窗召唤置顶逻辑，解决 Windows 下后台召唤仅闪烁和不可见隐藏问题
- modified:
  - `src/main/webviewManager.ts`
  - `src/main/shortcutManager.ts`
  - `src/main/ipcHandlers.ts`
- lesson(promoted): 在 Windows 平台下，Electron 后台窗口直接调用 focus() 会被操作系统防抢焦点机制拦截导致任务栏闪烁，通过临时开启 alwaysOnTop 置顶再取消可实现稳定强行聚焦置顶

### 11:36 | Antigravity

- done: 修改了快捷弹窗的翻译提示词，调整为如果是英文则翻译成中文，如果是中文则翻译成英文
- modified:
  - `src/renderer/src/pages/QuickPage.tsx`

### 11:33 | Antigravity

- done: 快捷键自动复制文本优化：采用 VBScript 与按键释放缓冲方案解决修饰键冲突与焦点抢占问题
- modified:
  - `src/main/shortcutManager.ts`
- lesson: 在全局快捷键触发自动复制时，必须：1) 延迟250ms等待用户释放物理按键以防Ctrl+Shift+C冲突；2) 在展示/聚焦快捷窗口前执行复制以防焦点被抢占；3) 采用 VBS 脚本启动速度更快(约10ms)且不抢焦点。

### 01:31 | claude-code

- done: 添加三个 TODO 到 TODO.md
- modified:
  - `TODO.md`

### 01:26 | claude-code

- done: 提交综合 commit：快捷窗口 pin 切换、拖拽支持、尺寸约束、修复剪贴板自动复制焦点顺序 Bug、提取 webview 处理器公共函数
- modified:
  - `src/main/ipcHandlers.ts src/main/shortcutManager.ts src/main/webviewManager.ts src/preload/index.d.ts src/preload/index.ts src/renderer/src/components/WebviewCard.tsx src/renderer/src/pages/QuickPage.tsx .memory/KNOWLEDGE.md SESSION_LOG.md`

### 01:20 | Antigravity

- done: 修复快捷窗口自动复制 Bug：焦点顺序错误导致 SendKeys 打到错误窗口
- decision: 改用 execFileSync + Atomics.wait 实现同步阻塞式等待：确保按键模拟、剪贴板读取全部在 show/focus 之前完成
- modified:
  - `src/main/shortcutManager.ts`
- lesson(promoted): 全局快捷键触发后若立即 show/focus 自身窗口，焦点会从用户原始窗口转移，导致 SendKeys 模拟 Ctrl+C 打到 Electron 自己而非目标应用；必须先完成 SendKeys+读剪贴板，再 show/focus 窗口

### 01:16 | Antigravity

- done: 快捷窗口自动复制选中文本：去掉手动 Ctrl+C 步骤
- decision: 用 PowerShell SendKeys 模拟 Ctrl+C 自动复制，零新依赖，Windows 专属；非 Windows 降级读现有剪贴板
- modified:
  - `src/main/shortcutManager.ts`
- lesson(promoted): PowerShell execFile 方式比 exec 字符串更安全，避免引号转义问题；先清空剪贴板再模拟复制，可以可靠地检测是否真的有内容被选中

### 01:14 | Antigravity

- done: 修复快捷窗口外部链接无法打开系统浏览器的 Bug
- modified:
  - `src/main/webviewManager.ts`
- lesson(promoted): 快捷窗口（quickWindow）是独立的 BrowserWindow，主窗口的 did-attach-webview 监听器不会自动继承给快捷窗口；任何新增窗口都需要单独为其 webContents 注册 did-attach-webview 事件，否则该窗口内 Webview 的脚本注入和链接拦截将完全失效

### 01:10 | Antigravity

- done: Fix quick window: default alwaysOnTop=false, skipTaskbar=false, isPinned=false
- modified:
  - `src/main/webviewManager.ts`
  - `src/renderer/src/pages/QuickPage.tsx`
- lesson(promoted): quickWindow 初始配置 alwaysOnTop 和 skipTaskbar 应默认关闭，让用户通过 pin 按钮自行决定；skipTaskbar=true 会导致被遮挡后无任务栏入口找不回窗口

### 01:05 | Antigravity

- done: Implement shortcut window size constraints (320x480), window pinning toggle, and icon updates
- modified:
  - `src/main/webviewManager.ts`
  - `src/main/ipcHandlers.ts`
  - `src/preload/index.ts`
  - `src/preload/index.d.ts`
  - `src/renderer/src/pages/QuickPage.tsx`

### 00:59 | Antigravity

- done: Implement dragging functionality for the shortcut window header blank area by integrating WebviewCard onDragStart with QuickPage isDraggingRef
- modified:
  - `src/renderer/src/components/WebviewCard.tsx`
  - `src/renderer/src/pages/QuickPage.tsx`

### 00:56 | Antigravity

- done: Disable quick window auto-hide on blur/loss of focus
- modified:
  - `src/main/webviewManager.ts`
  - `src/main/ipcHandlers.ts`
  - `docs/superpowers/plans/2026-06-28-disable-quick-window-blur-hide.md`

### 00:51 | Antigravity

- done: 同步修改主进程中主窗口控件背景色，消除标题栏与渐变背景色差
- modified:
  - `src/main/webviewManager.ts`

### 00:48 | Antigravity

- done: 将应用背景渐变色调淡一点
- modified:
  - `src/renderer/src/assets/index.css`

### 00:41 | Antigravity

- done: 修复快捷助手模型切换受限 Bug，并增加 flat 属性彻底去除 WebviewCard 外层容器视觉
- decision: QuickPage 放开已开启模型过滤查询全量 models；WebviewCard 支持 flat 无边框模式，外层 padding 设为 p-0。
- modified:
  - `src/renderer/src/components/WebviewCard.tsx`
  - `src/renderer/src/pages/QuickPage.tsx`

### 00:36 | Antigravity

- done: 直接复用 WebviewCard 渲染快捷助手窗口，移除外层包装容器，并将主界面与关闭操作按钮直接无缝嵌入 WebviewCard 头部。
- decision: WebviewCard 扩展 headerActions 与 draggableHeader 属性；QuickPage 根节点直接渲染 WebviewCard。
- modified:
  - `src/renderer/src/components/WebviewCard.tsx`
  - `src/renderer/src/pages/QuickPage.tsx`

### 00:28 | Antigravity

- done: 重构快捷助手弹窗 (QuickPage)，直接复用 WebviewCard 组件，移除底部多余输入框，支持将提示词直接注入目标 AI 网页输入框，并对齐应用浅色毛玻璃主题风格。
- decision: 直接复用 WebviewCard (设置 compact, hideHeader, isolated)；增加 15 次/500ms 的异步重试注入机制以应对 Webview 初始启动延迟。
- modified:
  - `src/renderer/src/pages/QuickPage.tsx`

### 00:12 | Antigravity

- done: Mark all checkboxes complete in Desktop Quick Access plan
- modified:
  - `docs/superpowers/plans/2026-05-04-desktop-quick-access-plan.md`

### 00:10 | Antigravity

- done: Task 7: shortcutManager module and custom shortcuts setting drawer UI
- added:
  - `src/main/shortcutManager.ts`
- modified:
  - `src/main/index.ts`
  - `src/main/ipcHandlers.ts`
  - `src/preload/index.ts`
  - `src/preload/index.d.ts`
  - `src/renderer/src/components/SettingsDrawer.tsx`
  - `CHANGELOG.md`

### 00:04 | Antigravity

- done: Task 6: clipboard text summon and prompt injection MVP shortcuts
- modified:
  - `src/main/index.ts`
  - `CHANGELOG.md`

### 00:01 | Antigravity

- done: Task 5: cross-window state broadcast via stateBus and Zustand subscribe
- added:
  - `src/main/stateBus.ts`
- modified:
  - `src/main/ipcHandlers.ts`
  - `src/preload/index.ts`
  - `src/preload/index.d.ts`
  - `src/renderer/src/store/appStore.ts`
  - `CHANGELOG.md`

## 2026-06-27

### 23:58 | Antigravity

- done: Task 4: QuickPage renderer and #quick routing
- added:
  - `src/renderer/src/pages/QuickPage.tsx`
- modified:
  - `src/renderer/src/App.tsx`
  - `src/renderer/src/store/appStore.ts`
  - `src/preload/index.ts`
  - `src/preload/index.d.ts`
  - `CHANGELOG.md`

### 23:55 | Antigravity

- done: Task 3: quick window lifecycle and global summon shortcut
- modified:
  - `src/main/webviewManager.ts`
  - `src/main/index.ts`
  - `src/main/ipcHandlers.ts`
  - `src/preload/index.ts`
  - `src/preload/index.d.ts`
  - `CHANGELOG.md`

### 23:52 | Antigravity

- done: Task 2: system tray with show/hide/quit menu
- modified:
  - `src/main/webviewManager.ts`
  - `src/main/index.ts`
  - `src/main/ipcHandlers.ts`
  - `src/preload/index.ts`
  - `src/preload/index.d.ts`
  - `CHANGELOG.md`

### 23:48 | Antigravity

- done: Task 1: intercept main window close to hide instead of quit
- modified:
  - `src/main/webviewManager.ts`
  - `src/main/index.ts`
  - `CHANGELOG.md`

### 23:45 | Antigravity

- done: Clean up obsolete BrowserPage legacy component and associated routing/state
- modified:
  - `README.md`
  - `src/renderer/src/App.tsx`
  - `src/renderer/src/components/ModelOutputCard.tsx`
  - `src/renderer/src/components/SummaryPanel.tsx`
  - `src/renderer/src/store/appStore.ts`
- removed:
  - `src/renderer/src/pages/BrowserPage.tsx`

### 23:39 | Antigravity

- done: 将抽屉 Header 内的 Logo 尺寸由 w-8 h-8 进一步放大至 w-10 h-10
- modified:
  - `src/renderer/src/components/HistoryDrawer.tsx`
  - `src/renderer/src/components/SettingsDrawer.tsx`
  - `src/renderer/src/components/SummaryHistoryDrawer.tsx`

### 23:38 | Antigravity

- done: 将历史记录抽屉宽度改为500px，统一放大 Logo 图标尺寸至 w-8 h-8
- modified:
  - `src/renderer/src/components/HistoryDrawer.tsx`
  - `src/renderer/src/components/SettingsDrawer.tsx`
  - `src/renderer/src/components/SummaryHistoryDrawer.tsx`

### 23:37 | Antigravity

- done: 调整抽屉面板 UI 布局，添加 Logo 及产品名称，标题居中，设置页使用说明移至选项内并去除 footer
- modified:
  - `src/renderer/src/components/HistoryDrawer.tsx`
  - `src/renderer/src/components/SettingsDrawer.tsx`
  - `src/renderer/src/components/SummaryHistoryDrawer.tsx`

### 23:36 | claude-code

- done: 修正 Desktop Quick Access Plan 文档中的 8 项技术问题
- context: 评估 desktop-quick-access-plan 合理性后修正文档
- modified:
  - `docs/superpowers/plans/2026-05-04-desktop-quick-access-plan.md`
- lesson: Electron webview 内部点击触发父 BrowserWindow blur;setTemplateImage 是 Tray 方法而非 NativeImage 方法;Quick Window 不应包裹主窗 Layout 组件;Ctrl+Shift+C 与 Chrome DevTools 冲突需全局拦截

### 23:35 | Antigravity

- done: 为抽屉组件添加圆角，抽屉打开时，遮罩去掉模糊效果
- modified:
  - `src/renderer/src/assets/index.css`
  - `src/renderer/src/components/HistoryDrawer.tsx`
  - `src/renderer/src/components/SettingsDrawer.tsx`
  - `src/renderer/src/components/SummaryHistoryDrawer.tsx`

### 23:30 | Antigravity

- done: 调整 WebView 卡片和底部 control bar 之间的间距为最初的1/2 (pb-3 -> pb-5)
- modified:
  - `src/renderer/src/pages/MainPage.tsx`

### 23:29 | Antigravity

- done: 修复主界面会话锁定（模型锁定）污染并导致总结页 Webview 模式下模型切换下拉框被禁用的 Bug
- decision: 为 WebviewCard 增加 isolated 属性，使得总结页等独立工作区的 Webview 组件不受主界面会话锁定的影响
- modified:
  - `src/renderer/src/components/WebviewCard.tsx`
  - `src/renderer/src/components/SummaryPanel.tsx`

### 23:29 | Antigravity

- done: 减小 WebView 卡片和底部 control bar 之间的间距 (pb-10 -> pb-3)
- modified:
  - `src/renderer/src/pages/MainPage.tsx`

### 22:57 | Antigravity

- done: Lock layout mode buttons when restoring a history session
- modified:
  - `src/renderer/src/pages/MainPage.tsx`

### 22:55 | Antigravity

- done: Hide individual 'New Conversation' button in multi_ai and debate modes to enforce global session consistency
- modified:
  - `src/renderer/src/components/WebviewCard.tsx`

### 22:46 | Antigravity

- done: Preserve Webview states in the background when switching productMode to prevent conversation loss
- modified:
  - `src/renderer/src/pages/MainPage.tsx`

### 22:31 | Antigravity

- done: Decouple sending logic from displayMode and lock layout switcher
- modified:
  - `src/renderer/src/store/appStore.ts src/renderer/src/components/Layout.tsx`

### 22:24 | Antigravity

- done: Fix webview ref leak and duplicate refreshes, lock session model choices
- modified:
  - `src/renderer/src/store/appStore.ts src/renderer/src/pages/MainPage.tsx src/renderer/src/components/ControlBar.tsx src/renderer/src/components/WebviewCard.tsx`

### 22:20 | Antigravity

- done: Implement pointer-capture IPC window dragging, independent Multi-AI slots configuration, and Google login UA bypass
- added:
  - `docs/drag-fix-experience.md`
  - `scripts/verify-titlebar-drag-contract.js`
- modified:
  - `src/main/ipcHandlers.ts`
  - `src/main/webviewManager.ts`
  - `src/preload/index.d.ts`
  - `src/preload/index.ts`
  - `src/renderer/src/assets/index.css`
  - `src/renderer/src/components/Layout.tsx`
  - `src/renderer/src/env.d.ts`
  - `src/renderer/src/pages/MainPage.tsx`
  - `src/renderer/src/store/appStore.ts`
- lesson: Complex Electron titlebar dragging with app-region:drag on Windows can cause hit-test click-through issues and recursive window-resizing bugs; use JS pointer capture and IPC win.setContentBounds as a reliable workaround.

### 21:51 | Antigravity

- done: Fix webview refs memory leak causing New Chat to refresh historic and duplicate model windows
- modified:
  - `src/renderer/src/pages/MainPage.tsx`
  - `src/renderer/src/components/ControlBar.tsx`

### 21:04 | Antigravity

- done: Fixed window dragging functionality by replacing inline WebkitAppRegion styles with explicit CSS classes on all header layout components to bypass React style stripping and Chromium bubbling bugs.
- modified:
  - `src/renderer/src/components/Layout.tsx`

### 20:52 | Antigravity

- done: 基于全 CSS Grid 的统一布局重构完成，利用 position: absolute 及 visibility: hidden 安全隐藏 Webview 插槽以实现零重载瞬间切换
- modified:
  - `src/renderer/src/pages/MainPage.tsx`

### 20:47 | Antigravity

- done: 恢复此前因冲突丢失的 MainPage.tsx 关于生成总结时爬取模型回答的 10 秒超时限制和 ESC 按键强行退出机制修改
- modified:
  - `src/renderer/src/pages/MainPage.tsx`

### 20:45 | Antigravity

- done: 修复因为缺少 currentPage 和 apiConfig 解构导致应用白屏崩溃的问题
- modified:
  - `src/renderer/src/components/Layout.tsx`

### 20:43 | Antigravity

- done: 恢复了被意外删除的总结页顶部 API/Webview 切换控件并对齐了样式
- modified:
  - `src/renderer/src/components/Layout.tsx`

### 20:37 | Antigravity

- done: 应用户要求，回滚 MainPage.tsx 代码至修改前的状态
- modified:
  - `src/renderer/src/pages/MainPage.tsx`

### 17:38 | Antigravity

- done: Prepare batch commits and clean up unused imports
- modified:
  - `src/renderer/src/components/HistoryDrawer.tsx`

### 17:27 | Antigravity

- done: Replace top product title with mode segmented control (Multi-AI, Task Assignment, Debate) and support same model multi-slot selection in task assignment mode
- modified:
  - `src/renderer/src/store/appStore.ts`
  - `src/renderer/src/pages/MainPage.tsx`
  - `src/renderer/src/components/WebviewCard.tsx`
  - `src/renderer/src/components/Layout.tsx`

### 17:26 | Antigravity

- done: Investigated opening external links in default browser and drafted implementation plan using writing-plans skill and context7 official Electron docs
- added:
  - `docs/superpowers/plans/2026-06-27-open-external-links-in-default-browser.md`

### 17:18 | Antigravity

- done: 修复设置抽屉及其他抽屉顶部关闭按钮在 Electron 窗口拖拽区域被拦截导致无法点击的热区冲突问题
- modified:
  - `src/renderer/src/components/SettingsDrawer.tsx`
  - `src/renderer/src/components/HistoryDrawer.tsx`
  - `src/renderer/src/components/SummaryHistoryDrawer.tsx`

### 17:09 | Antigravity

- done: 将底部的设置和历史记录按钮迁移到顶部标题栏红框区域，与窗口控件放在一行，改造为纯图标按钮
- modified:
  - `src/renderer/src/store/appStore.ts`
  - `src/renderer/src/components/Layout.tsx`
  - `src/renderer/src/components/ControlBar.tsx`
  - `src/renderer/src/pages/MainPage.tsx`
  - `src/renderer/src/pages/SummaryPage.tsx`
  - `src/renderer/src/App.tsx`

### 17:01 | Antigravity

- done: Change Claude's logo icon to a custom SVG path with brand color
- modified:
  - `src/renderer/src/store/appStore.ts`

### 16:41 | Antigravity

- done: Updated Grok logo to black variant for light themes
- modified:
  - `src/renderer/src/store/appStore.ts`

### 16:36 | Antigravity

- done: Updated Grok logo to stable public jsDelivr CDN icon URL
- modified:
  - `src/renderer/src/store/appStore.ts`

### 16:28 | Antigravity

- done: 使用 Material Symbol 'biotech'（显微镜）代表深度研究，使用 'image'（图片）代表生图，只在下拉列表选项中显示，并同步更新底部控制栏中的深度研究按钮图标
- modified:
  - `src/renderer/src/components/WebviewCard.tsx`
  - `src/renderer/src/components/ControlBar.tsx`

### 16:23 | Antigravity

- done: Updated Grok logo to official favicon
- modified:
  - `src/renderer/src/store/appStore.ts`

### 16:21 | Antigravity

- done: 将模型下拉列表中的深度研究标签替换为望远镜图标，并在支持生图的模型后面展示生图（图片）图标；同时同步替换底部控制栏中的深度研究按钮图标
- modified:
  - `src/renderer/src/components/WebviewCard.tsx`
  - `src/renderer/src/components/ControlBar.tsx`

### 16:20 | Antigravity

- done: Updated Wenxin Yiyan website URL to chat.baidu.com and updated its logo
- modified:
  - `src/renderer/src/config/selectors.ts`
  - `src/renderer/src/store/appStore.ts`

### 16:10 | Antigravity

- done: 删除设置抽屉中的模型排序功能，并在 Webview 窗口的模型下拉列表中的模型名称后面显示深度研究标签
- modified:
  - `src/renderer/src/components/SettingsDrawer.tsx`
  - `src/renderer/src/components/WebviewCard.tsx`

### 16:05 | Antigravity

- done: Added DeepSeek web support with logo and elements integration
- modified:
  - `src/renderer/src/config/selectors.ts`
  - `src/renderer/src/store/appStore.ts`
  - `src/renderer/src/utils/webviewScripts.ts`

### 16:00 | Antigravity

- done: Updated minimum pane width to 320 for four window layout
- modified:
  - `src/renderer/src/pages/MainPage.tsx`

### 15:58 | Antigravity

- done: 将下拉列表组件的背景改成毛玻璃效果
- modified:
  - `src/renderer/src/components/CustomDropdown.tsx`

### 15:58 | Antigravity

- done: Adjusted MIN_PANE_WIDTH to 280 for better responsiveness on scaled resolutions
- modified:
  - `src/renderer/src/pages/MainPage.tsx`

### 15:53 | Antigravity

- done: Reduce segmented layout control padding and height to prevent touching title bar edges
- modified:
  - `src/renderer/src/components/Layout.tsx`

### 15:49 | Antigravity

- done: Updated four-window display mode layout logic
- modified:
  - `src/renderer/src/pages/MainPage.tsx`

### 15:47 | Antigravity

- done: Update segmented layout control styling to match bottom toolbar buttons using glass-panel
- modified:
  - `src/renderer/src/components/Layout.tsx`

### 15:44 | Antigravity

- done: Change layout controls to segmented control, remove reset button, and trigger reset on layout change
- modified:
  - `src/renderer/src/components/Layout.tsx`

### 15:25 | Antigravity

- done: Move window layout buttons to top title bar
- modified:
  - `src/renderer/src/components/Layout.tsx`
  - `src/renderer/src/components/SettingsDrawer.tsx`

### 15:19 | Antigravity

- done: Fix minimum window size missing properties
- modified:
  - `src/main/webviewManager.ts`

