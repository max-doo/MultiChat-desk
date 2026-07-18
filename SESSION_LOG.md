# Session Log

## 2026-07-18

### 23:28 | Codex

- done: 修复 Windows 自绘窗口控制引入的标题栏拖动失效：右侧三键外层容器由 no-drag 改为 drag-region，仅按钮本身通过标签过滤禁止拖动；win32 BrowserWindow 保持纯 frame:false，不设置 titleBarStyle。
- context: 用户在最大化黑闪修复后立即反馈窗口无法拖动。运行态断点确认 renderer 收到 pointerdown，但右侧空白命中带 no-drag 的整列容器，因此 window-drag-start IPC 未发送。
- decision: 标题栏空白容器必须保持 drag-region；no-drag 只能标在实际交互控件上，不能标在占据 grid 1fr 的窗口控制外层。
- modified:
  - `scripts/verify-titlebar-drag-contract.js`
  - `src/main/ipcHandlers.ts`
  - `src/main/webviewManager.ts`
  - `src/renderer/src/components/Layout.tsx`
- unresolved: 用户需在当前开发窗口中复测手感；自动化已验证普通拖动位移 40x25 且尺寸稳定，并验证最大化后拖回可继续移动、无原生 IsZoomed 和无采样黑帧。

### 23:20 | Codex

- done: 消除 Windows 主窗口点击最大化时的瞬时黑闪：移除 win32 的 titleBarOverlay 原生三键，改为 renderer 自绘窗口控制；最大化使用 setBounds(workArea) 绕过原生 maximize 的 DWM/Chromium swap-chain 重建，并支持再次点击还原及从最大化状态拖动恢复。
- context: 用户在恢复 frame:false 后复测仍有黑闪。查明右上角按钮来自 titleBarOverlay，点击直接进入 Windows 原生最大化路径，不经过既有 window-maximize IPC。Electron 官方 issue 35362 仍记录 frameless + maximize 的闪烁问题。
- decision: Windows 主窗口使用自绘三键和无动画工作区边界切换；Linux 保留 titleBarOverlay，macOS 保留 hiddenInset/app-region。
- modified:
  - `scripts/verify-titlebar-drag-contract.js`
  - `src/main/ipcHandlers.ts`
  - `src/main/webviewManager.ts`
  - `src/renderer/src/assets/index.css`
  - `src/renderer/src/components/Layout.tsx`
- lesson: Windows Electron 的 titleBarOverlay 最大化按钮绕过 renderer IPC 并直接触发原生 maximize；多 WebView 无框窗口若出现最大化黑闪，应移除 win32 overlay 控件，以自绘按钮调用 setBounds(display.workArea) 规避 swap-chain 重建，同时保存还原边界。
- unresolved: 用户仍需在当前已重启的开发窗口中确认真实观感；运行态自动验收已确认 NativeIsZoomed=false、最大化/还原边界切换成功，并连续采样 45 帧未检测到黑帧。

### 23:07 | Codex

- done: 修复本轮窗口拖动改造引入的最大化闪黑回归：撤销 Windows 原生标题栏/原生 app-region 方案，恢复主窗口 frame:false 基线；保留 PointerCapture、rAF 合帧与 setContentBounds 的手动拖动实现。
- context: 用户实测最大化时会短暂黑屏；对比 session 前基线后确认 maximize IPC 未变化，差异来自 BrowserWindow 原生 frame/titlebar 组合。开发实例已完整重启并加载新 bundle。
- decision: Windows/Linux 继续使用无框窗口与手动 IPC 拖动；macOS 保留原生 app-region。禁止再次以 setPosition 或 Windows 原生 app-region 替代当前拖动链路。
- modified:
  - `scripts/verify-titlebar-drag-contract.js`
  - `src/main/ipcHandlers.ts`
  - `src/renderer/src/assets/index.css`
  - `src/renderer/src/components/Layout.tsx`
- unresolved: 最大化视觉闪黑与拖动手感需要用户在当前已重启的开发窗口中手动确认；自动化环境无法可靠观察瞬时桌面合成画面。

### 22:59 | Codex

- done: 回滚失效的 Windows 原生拖动 helper：外部 PowerShell 线程的 WM_NCLBUTTONDOWN 请求未使 Electron 主窗口进入移动循环，而入队成功分支错误禁用了手动 dragState，导致窗口完全不能拖动。已删除 helper 文件、生命周期接线和 IPC 分支，恢复始终初始化 PointerCapture + setContentBounds 的可靠路径。
- context: 用户实测原生 helper 版本完全不能拖动。当前唯一开发主进程启动于 22:58:20，编译产物不含 NativeDrag、beginNativeWindowDrag 或 setPosition，且无 native-drag helper 子进程。
- decision: 停止继续尝试未经真实 UI 验证的原生辅助方案；恢复已由用户验证过能拖动且不会递归放大的固定 content bounds 路径，保留 requestAnimationFrame 合并与松手尾帧提交。
- modified:
  - `src/main/index.ts`
  - `src/main/ipcHandlers.ts`
  - `src/renderer/src/components/Layout.tsx`
  - `scripts/verify-titlebar-drag-contract.js`
  - `SESSION_LOG.md`
- removed:
  - `src/main/nativeWindowDragHelper.ts`
- unresolved: 主窗口当前已加载安全拖动路径；仍需用户确认本轮恢复可拖动。流畅度优化须以不破坏此可靠基线为前提。

### 22:54 | Codex

- done: 纠正主窗口拖动回归：撤销会递归放大窗口的 setPosition；新增常驻 Windows 原生拖动 helper，通过 ReleaseCapture 与 WM_NCLBUTTONDOWN/HTCAPTION 让系统接管移动；helper 不可用时才回退到逐帧合并、固定 content bounds 的安全路径。
- context: 用户实测上一版拖动会越变越大并出现残影，确认 docs/drag-fix-experience.md 与 KNOWLEDGE.md 记录的 setPosition 隐形边框累加问题在 Electron 42.5.1 下仍存在。
- decision: 原生 helper 命令成功入队后禁用本次手动 dragState，避免原生移动与 setContentBounds 竞争；pointerup、pointercancel、lostpointercapture 或 buttons 清零都会结束 renderer 拖动状态。
- added:
  - `src/main/nativeWindowDragHelper.ts`
- modified:
  - `src/main/index.ts`
  - `src/main/ipcHandlers.ts`
  - `src/renderer/src/components/Layout.tsx`
  - `scripts/verify-titlebar-drag-contract.js`
  - `SESSION_LOG.md`
- unresolved: 开发进程已重启且 NativeDrag helper 常驻进程已确认存活；Computer Use 仍无法控制该 Electron 窗口，需用户手动确认原生移动、窗口尺寸稳定和残影表现。

### 22:42 | Codex

- done: 修复主窗口原生拖动回归：保留 Windows titleBarOverlay 与 CSS app-region 原生路径，并增加仅在原生命中失败时触发的 pointer/IPC 降级；降级从 setContentBounds 改为逐帧合并的 setPosition，避免拖动期间反复尺寸换算和 WebView 重排。
- context: Electron 42.5.1 运行态中 CSS app-region 计算值、Window Controls Overlay 和元素尺寸均正确，但 WM_NCHITTEST 仍返回 HTCLIENT；官方 issue 显示 draggable regions 存在多次 Chromium/Electron 回归。隐藏 iframe workaround 实测无效并已移除。
- decision: 主窗口采用原生优先、位置更新降级的双路径；macOS 保持原生 traffic lights，快捷窗口继续兼容 IPC。保留 AutomationControlled 开关，不升级 Electron，因为 42.7.0 发布说明未包含对应修复。
- modified:
  - `src/renderer/src/components/Layout.tsx`
  - `src/renderer/src/assets/index.css`
  - `src/main/webviewManager.ts`
  - `src/main/ipcHandlers.ts`
  - `scripts/verify-titlebar-drag-contract.js`
  - `SESSION_LOG.md`
- unresolved: Computer Use 连续两次因 SetIsBorderRequired 0x80004002 无法对 Electron 窗口执行真实拖动；开发进程已重启并加载新代码，需用户手动确认拖动是否恢复以及流畅度。

### 22:20 | Codex

- done: 将主窗口拖动从 JS IPC 模拟移窗切换为 Electron 系统原生 app-region，并修复复杂 Grid 下顶部空白区未被采集为拖拽命中区域的问题
- context: 实际依赖为 Electron 42.5.1；官方推荐 titleBarStyle hidden + titleBarOverlay + app-region。主窗口增加直属纯拖拽面并显式标记内部 drag-region，交互控件继续 no-drag；快捷窗口保留手动拖动
- decision: Windows/Linux 主窗口移除遗留 frame:false，恢复系统 frame/非客户区拖动、吸附和双击最大化；macOS 与快捷窗口边界不变
- modified:
  - `src/main/webviewManager.ts`
  - `src/renderer/src/components/Layout.tsx`
  - `src/renderer/src/assets/index.css`
  - `scripts/verify-titlebar-drag-contract.js`
- unresolved: BrowserWindow frame 配置变更必须完整重启 npm run dev 后手动验证顶部左侧/中间空白拖动、按钮点击、双击最大化、贴边吸附及窗口尺寸不漂移

### 22:04 | Codex

- done: 修复主窗口拖动卡顿与残影：将高频 pointermove 合并为与渲染帧对齐、约 60 FPS 的窗口移动更新，并在松手或取消时补交最终位置和清理拖动状态
- context: 保留既有 Pointer Capture 与 setContentBounds 契约，避免恢复 Windows 无边框窗口持续放大问题；未改动承担 WebView 黑屏兼容的 use-angle=gl
- decision: 先做单文件、低风险的拖动事件背压；GPU 后端仅在真实拖动复验后仍有残影时再做 A/B
- modified:
  - `src/renderer/src/components/Layout.tsx`
- lesson: Windows 多 WebView 主窗口的手动拖动必须合并高频 pointermove：保留 Pointer Capture 与 setContentBounds，同时按渲染帧限速并在 pointerup/pointercancel 提交最终位置，避免 IPC 和窗口合成队列堆积导致卡顿与拖影
- unresolved: 当前已安装版进程正在运行且 Computer Use 无法捕获无边框 Electron 窗口，尚未在 npm run dev 中完成真实主窗口拖动复验

### 21:38 | Antigravity

- done: 更新 CHANGELOG 并进行 git commit、git push，且成功完成 Windows 平台打包
- modified:
  - `CHANGELOG.md`

### 21:31 | Antigravity

- done: 根据最近的修改更新 CHANGELOG.md 中的 1.2.1 版本记录
- modified:
  - `CHANGELOG.md`

### 21:26 | Codex

- done: 修复划词快捷工具条滚轮触发、UIA请求竞态与长时间运行失效
- context: 保留MultiChat自身窗口内不弹工具条；当前运行中的Electron旧实例未重启
- decision: 滚轮使用去抖后的当前选区读取；UIA读取改为JS队列并在超时/异常时重启helper；native hook增加5秒健康检查；工具条renderer崩溃或加载失败后下次触发重建
- modified:
  - `src/main/inputHookManager.ts`
  - `src/main/uiaSelectionHelper.ts`
  - `src/main/webviewManager.ts`
- unresolved: 需重启开发实例后在外部TextArea实际拖选并滚轮验证

### 14:55 | codex

- done: 修复更新缓存未随当前版本重算导致本地 1.2.1 仍提示远程 1.2.0 的问题
- context: 读取旧缓存时按 app.getVersion() 与缓存远程版本重新计算 hasUpdate，不增加网络请求；保留现有未提交改动
- decision: 启动加载缓存时校正 currentVersion、latestVersion 与 hasUpdate，并立即持久化校正后的状态
- modified:
  - `src/main/updater/checker.ts`

### 14:39 | Antigravity

- done: 将本地版本号改回 1.2.1
- modified:
  - `package.json`
  - `package-lock.json`

### 14:29 | codex

- done: 完成更新提醒 UI 优化：设置卡片单行操作、更新态隐藏检查按钮、设置按钮红点、设置与历史记录抽屉 logo NEW 发布入口
- context: 保留现有 HistoryDrawer.tsx 和 SettingsDrawer.tsx 未提交头部改动；共享 renderer 更新状态 hook，所有入口复用主进程推送的 release 状态
- decision: 以 useUpdateState 统一读取缓存和订阅 update:state，更新卡片有新版本时只展示前往下载
- added:
  - `src/renderer/src/hooks/useUpdateState.ts`
- modified:
  - `docs/superpowers/specs/2026-07-18-update-reminder-background-check-design.md`
  - `src/renderer/src/components/AboutSection.tsx`
  - `src/renderer/src/components/Layout.tsx`
  - `src/renderer/src/components/SettingsDrawer.tsx`
  - `src/renderer/src/components/HistoryDrawer.tsx`

### 13:53 | codex

- done: 修复更新检查 IPC 异常导致检查中卡住，并将本地版本降至 1.1.0 以验证远程 1.2.0 更新提示
- context: 保留现有 HistoryDrawer.tsx 和 SettingsDrawer.tsx 未提交头部改动；更新检查仍按主进程/IPC/preload/renderer 分层
- decision: AboutSection 捕获 updateCheck IPC 异常并显示可重试错误，避免状态永久停留在 checking
- modified:
  - `package.json`
  - `package-lock.json`
  - `src/renderer/src/components/AboutSection.tsx`

### 13:45 | codex

- done: 实现低频后台更新提醒：启动延迟检查、24小时缓存、GitHub API限流回退、设置抽屉提醒与发布页入口
- context: 保留现有 HistoryDrawer.tsx 和 SettingsDrawer.tsx 未提交头部改动；按主进程/IPC/preload/renderer 分层
- decision: API 403 时回退到 GitHub /releases/latest 重定向页，避免未认证限流让更新提示永久失效
- added:
  - `src/main/updater/checker.ts`
- modified:
  - `docs/superpowers/specs/2026-07-18-update-reminder-background-check-design.md`
  - `src/main/index.ts`
  - `src/main/ipcHandlers.ts`
  - `src/preload/index.ts`
  - `src/preload/index.d.ts`
  - `src/renderer/src/env.d.ts`
  - `src/renderer/src/components/AboutSection.tsx`

### 13:20 | Antigravity

- done: 移除 Logo 圆角，保持直角设计，仅优化 Logo 与文字的尺寸比例
- modified:
  - `src/renderer/src/components/SettingsDrawer.tsx`
  - `src/renderer/src/components/HistoryDrawer.tsx`

### 13:18 | Antigravity

- done: 调整设置抽屉与历史记录抽屉头部左上角的 Logo 尺寸与产品名字体样式，添加圆角以提升视觉协调性
- modified:
  - `src/renderer/src/components/SettingsDrawer.tsx`
  - `src/renderer/src/components/HistoryDrawer.tsx`

## 2026-07-17

### 00:03 | Codex

- done: 将 ChatGPT Deep Research 报告 OOPIF 提取链路暂存到 feat/chatgpt-deep-research-extractor，并从 main 移除失败链路；TODO 已记录遗留事项
- context: 用户确认该逻辑会拖慢爬取且提取失败，要求保留到已有 GPT 分支、主分支恢复普通抓取
- decision: 不改写历史；在 GPT 分支提交专用提取器及 IPC/preload/renderer 依赖，在 main 新提交清理专用代码并保留 TODO；保留普通 Deep Research 模式开关和既有 reportContainer 选择器
- modified:
  - `TODO.md src/main/ipcHandlers.ts src/preload/index.ts src/preload/index.d.ts src/renderer/src/components/WebviewCard.tsx src/renderer/src/env.d.ts`
- removed:
  - `src/main/chatgptDeepResearchExtractor.ts`
- unresolved: 后续需重新设计 ChatGPT Deep Research 正文提取方案，并在真实报告上进行耗时与成功率验收

## 2026-07-16

### 23:47 | Codex

- done: 将 Deep Research target/frame-context 两级遍历及待处理的稳定经验提升到项目知识库，并标记对应会话 lesson 为 promoted。
- modified:
  - `.memory/KNOWLEDGE.md`
  - `SESSION_LOG.md`

### 23:46 | Codex

- done: 根据运行日志补齐 Deep Research 混合 frame 遍历：递归 Target session 后，在每个 session 内通过 Page.getFrameTree 与 Page.createIsolatedWorld 枚举本地子 frame execution context，探测与提取均支持 sessionId+contextId。
- context: 用户日志只发现 root 和 connector iframe target，证明报告内层没有独立 Target.attachedToTarget；真实报告位于 connector target 内的本地 frame context。lint/build 通过。
- decision: 采用两级模型：Target.setAutoAttach 处理跨进程 OOPIF，Page.getFrameTree/createIsolatedWorld 处理同一 target 内的嵌套 frame；不再把两者视为互斥方案。失败日志增加每个 target 检查的 context 数。
- modified:
  - `src/main/chatgptDeepResearchExtractor.ts`
- lesson(promoted): Electron WebView 的嵌套 iframe 可能跨进程成为 child target，也可能只是在现有 target 内拥有独立 execution context。完整遍历必须组合递归 Target.setAutoAttach 与每个 session 内的 Page.getFrameTree/createIsolatedWorld，不能只实现其中一层。
- unresolved: 需重启 Electron 主进程后再次验收；若失败，记录新日志中的 contexts 数量。

### 23:40 | Codex

- done: 修复 ChatGPT Deep Research 回退完全未触发且无日志的问题：WebviewCard 自动识别报告 iframe 并在普通 DOM 前优先提取；getAllResponses/pollPlatforms 恢复 Deep Research 参数；空结果不再判完成；main IPC 输出提取结果。
- context: 用户反馈仍失败且无 Console 提示。代码事实显示所有调用均为无参数 getLatestResponse，allowDeepResearchFallback 永远为 false；运行中的 Electron 主进程自 23:33 未重启。lint/build 通过。
- decision: 将 Deep Research iframe 识别下沉到 WebviewCard，避免依赖每个调用方正确传参；iframe 已出现但报告未读到时返回空值继续等待，不回退到进度外壳；主进程与宿主 renderer 双侧记录错误。
- modified:
  - `src/main/ipcHandlers.ts`
  - `src/renderer/src/components/WebviewCard.tsx`
  - `src/renderer/src/store/appStore.ts`
- lesson(promoted): 关键回退能力不能只靠可选调用参数触发；当调用点多且容易被覆盖时，应由能力拥有者根据稳定页面信号自动识别，并让上层参数仅表达等待语义。Electron main 代码修改后必须重启主进程，renderer HMR 或 npm run build 不能证明运行进程已加载新代码。
- unresolved: 用户需重启当前 npm run dev/Electron 进程后重新验收，并查看终端 [ChatGPT Deep Research] 日志或宿主 renderer Console。

### 23:31 | Codex

- done: 纠正项目知识库中单层 OOPIF 提取的旧结论，统一为递归 Target.setAutoAttach，并标记本次稳定经验已提升。
- modified:
  - `.memory/KNOWLEDGE.md`
  - `SESSION_LOG.md`

### 23:30 | Codex

- done: 修正 ChatGPT Deep Research 报告抓取：将单层 Target.getTargets/attachToTarget 改为递归 Target.setAutoAttach，逐层探测 child session 直到定位真实报告 DOM，并补充 renderer 失败原因日志。
- context: 真实页面结构为 ChatGPT -> connector 沙盒 iframe -> 第二层报告 iframe；外层 document 没有 main h1，内层包含完整报告。npm run lint 与 npm run build 通过。
- decision: 不再按 target URL 判断报告 frame；对 page/iframe child session 递归 auto-attach，并以 main h1、正文长度和结构节点作为目标探针。调试通道已被占用时显式失败，避免破坏其他 CDP 使用者。
- modified:
  - `src/main/chatgptDeepResearchExtractor.ts`
  - `src/renderer/src/components/WebviewCard.tsx`
- lesson(promoted): Target.setAutoAttach 只覆盖当前 target 的直接相关 target；多层 OOPIF 必须监听 Target.attachedToTarget，并在每个 child session 上递归启用 autoAttach。报告 target 可能显示 about:blank，不能仅按 URL 过滤，应直接探测目标 DOM。
- unresolved: 需由用户在桌面开发环境对现有 ChatGPT Deep Research 报告执行一次总结验收，并根据新增 console.warn 核对失败阶段。

### 23:25 | Antigravity

- done: Add widescreen deep research selector for ChatGPT and bump selectors version to 18
- modified:
  - `src/shared/config/selectors.ts`

### 23:23 | Antigravity

- done: 提交所有本地修改，清理冗余的 SummaryHistoryDrawer 历史抽屉组件
- removed:
  - `src/renderer/src/components/SummaryHistoryDrawer.tsx`

### 22:56 | Codex

- done: 修复 MainPage 历史抽屉变量残留导致的 isHistoryOpen 未定义错误
- context: 用户 DevTools 报告 MainPage.tsx 中 isHistoryOpen 未定义；工作区含其他未提交改动，本次仅继续修复 MainPage。
- decision: 由 App.tsx 唯一渲染 HistoryDrawer，MainPage 通过 pendingHistoryRestore useEffect 调用原历史恢复逻辑。
- modified:
  - `src/renderer/src/pages/MainPage.tsx`
- lesson(promoted): 跨页提升共享 UI 后，必须同时移除原页面实例并把原回调接到 pending 状态消费点，不能只替换顶部状态变量。

### 22:50 | Codex

- done: 修复 MainPage 初始化错误与设置面板重复 React key
- context: 用户截图显示重复 key 2 与 MainPage models TDZ；工作区存在其他未提交修改，未触碰无关文件。
- decision: 提示词列表在主进程返回前去重，设置面板对提示词和总结模型再做防御性去重；MainPage 将局部 models 改名为 availableModels。
- modified:
  - `src/main/summaryPrompts.ts`
  - `src/renderer/src/components/SettingsDrawer.tsx`
  - `src/renderer/src/pages/MainPage.tsx`
- lesson(promoted): React 列表数据来自可持久化文件或配置时，读取和渲染两侧都应按稳定业务 ID 去重；局部变量命名应避免与旧 HMR 代码产生歧义。

### 22:40 | Antigravity

- done: 修复总结页打开历史抽屉未正确弹出的Bug，将HistoryDrawer提升至App.tsx渲染
- decision: 在App.tsx层统一渲染HistoryDrawer解决隐藏主页面DOM导致总结页无法弹出抽屉的问题，通过store的pendingHistoryRestore跨页面触发MainPage的恢复逻辑
- modified:
  - `src/renderer/src/App.tsx`
  - `src/renderer/src/pages/MainPage.tsx`
  - `src/renderer/src/store/appStore.ts`

### 22:34 | Antigravity

- done: 总结页历史抽屉复用主页HistoryDrawer
- decision: 移除SummaryHistoryDrawer独立实例，改为在appStore增加historyInitialTab状态，Layout历史按钮根据currentPage设置初始Tab，HistoryDrawer支持initialTab prop，MainPage的HistoryDrawer去掉isActive限制全局可用
- modified:
  - `src/renderer/src/store/appStore.ts`
  - `src/renderer/src/components/HistoryDrawer.tsx`
  - `src/renderer/src/pages/MainPage.tsx`
  - `src/renderer/src/pages/SummaryPage.tsx`
  - `src/renderer/src/components/Layout.tsx`

### 22:32 | Codex

- done: 恢复总结页 Webview 长文本自动 Markdown 上传功能；上传后仅注入附件分析指令，不自动发送
- decision: 保留 8000 字阈值、临时 Markdown、getFileInfo 与 uploadFile 链路；将上传后的 sendMessage 改为 insertText，上传失败仍降级为直接注入完整提示词
- modified:
  - `src/renderer/src/hooks/useWebviewSummary.ts`

### 22:27 | Codex

- done: 将本次及待处理的稳定调试经验提升到项目知识库，并把对应会话记录标记为 promoted。
- modified:
  - `.memory/KNOWLEDGE.md`
  - `SESSION_LOG.md`

### 22:27 | Codex

- done: 同步总结页 Webview 注入状态注释与休眠判断，完成最终 lint/build 验证
- context: 前一条会话记录已记录主要逻辑改动；本条仅补充后续注释和休眠判断收口
- modified:
  - `src/renderer/src/components/SummaryPanel.tsx`

### 22:27 | Codex

- done: 实现 ChatGPT Deep Research 跨域 OOPIF 报告提取：main 进程通过 CDP 子 target/session 读取报告 DOM，经受限 IPC 交给 renderer 转 Markdown；监控忽略空结果并将深度研究上限延长到 30 分钟。
- context: 深度研究报告位于 connector_openai_deep_research.web-sandbox.oaiusercontent.com 沙盒 iframe；页面下载和剪贴板路径不可依赖。用户决定自行完成桌面端验收。
- decision: 采用固定 main 层提取脚本和受限 webContentsId IPC，不向 renderer 暴露任意 CDP 脚本执行能力；普通 DOM 优先，仅 ChatGPT 深度研究空结果时节流回退。
- added:
  - `src/main/chatgptDeepResearchExtractor.ts`
- modified:
  - `src/main/ipcHandlers.ts`
  - `src/preload/index.ts`
  - `src/preload/index.d.ts`
  - `src/renderer/src/env.d.ts`
  - `src/renderer/src/components/WebviewCard.tsx`
  - `src/renderer/src/store/appStore.ts`
- lesson(promoted): 跨域 OOPIF 不能从顶层 webview executeJavaScript 读取；必须附加目标 iframe 并在 Target.attachToTarget 返回的 child sessionId 上执行 Runtime.evaluate。
- lesson(promoted): 轮询抓取的空字符串代表尚未产出或读取失败，不能累计稳定次数并判定完成。
- unresolved: 需由用户在 npm run dev 桌面环境触发 ChatGPT Deep Research 总结链路，确认目标 target 可发现且报告 Markdown 完整。

### 22:26 | Codex

- done: 总结页 Webview 模式改为只注入总结提示词，不自动发送；完成 lint/build/dev 启动验证
- decision: 复用 WebviewCard.insertText 注入路径，移除总结页专用的自动发送、文件上传和回复轮询；由用户在右侧平台页面手动发送
- modified:
  - `src/renderer/src/hooks/useWebviewSummary.ts`
  - `src/renderer/src/components/SummaryPanel.tsx`
- unresolved: 未能在真实登录 Webview 中完成点击级手动验证：Computer Use 捕获 Electron 窗口时返回 SetIsBorderRequired 不支持此接口

### 22:21 | Antigravity

- done: 新增千问深度研究报告提取器（复制按钮法）
- added:
  - `src/renderer/src/utils/qwenReportExtractor.ts`
- modified:
  - `src/renderer/src/components/WebviewCard.tsx`

### 21:58 | Antigravity

- done: Change history button label text from 历史会话 to 历史
- modified:
  - `src/renderer/src/components/Layout.tsx`

### 21:58 | Codex

- done: 修复 GPT 新建会话误打开临时会话：普通会话改用 chatgpt.com，并为总结页保留独立临时会话地址
- context: 工作区存在其他未提交改动；本次仅修改选择器契约、GPT 默认 URL和总结页取址逻辑
- decision: 拆分普通新会话 URL 与总结页隔离会话 URL，避免全局移除 temporary-chat 破坏总结页隔离行为
- modified:
  - `src/shared/config/selectors.ts`
  - `src/renderer/src/components/SummaryPanel.tsx`

### 21:56 | Antigravity

- done: Add text labels to settings and history buttons in the top status bar
- modified:
  - `src/renderer/src/components/Layout.tsx`

### 21:53 | Codex

- done: 放开任务分配模式生成总结按钮的禁用条件
- context: 用户要求总结按钮任何情况下不因任务分配状态置灰；保留辩论模式裁判评析的结束态限制
- decision: ControlBar 仅保留 debateDisabled，移除 taskHasSent/taskDisabled 及对应的 disabled 和点击拦截路径
- modified:
  - `src/renderer/src/components/ControlBar.tsx`

### 21:50 | Codex

- done: 修复任务分配模式恢复历史后的生成总结按钮禁用状态，并让任务分配历史标题使用原始总目标
- context: 恢复历史切换产品模式时 setProductMode 会清空 currentConversationId；任务分配发送历史 userMessage 包含带 slot 前缀的完整子任务提示
- decision: 历史恢复完成模式切换后重新写回 isNewSession、activeModels 和 currentConversationId；beginConversation 增加可选 title，仅任务分配新会话传入原始总目标
- modified:
  - `src/renderer/src/pages/MainPage.tsx`
  - `src/renderer/src/store/appStore.ts`
  - `src/renderer/src/components/modes/TaskModePanel.tsx`
- lesson(promoted): 恢复历史时若产品模式切换会重置会话锚点，必须在模式恢复完成后重新设置 isNewSession、activeModels 和 currentConversationId。
- unresolved: 桌面 UI 点击验证因已有 Electron 窗口最小化且物理 Esc 中断，未完成交互复现。

### 21:40 | Codex

- done: 修正右键粘贴失效：宿主窗口恢复焦点后向目标 WebView 发送跨平台原生 Ctrl/Cmd+V
- context: 用户反馈 target.paste 在所有窗口无效；依据 Electron 类型定义中 sendInputEvent 需要宿主 BrowserWindow 聚焦，改为 focusedWindow.focus + target.focus + 平台快捷键事件；npm run lint/build 通过
- decision: Windows/Linux 使用 Control+V，macOS 使用 Command+V；不恢复 DOM value 注入，避免千问受控输入伪文字
- modified:
  - `src/main/ipcHandlers.ts`
  - `src/renderer/src/components/Layout.tsx`
- unresolved: 需在桌面观察接口可用时实际验证千问及其他 WebView 的右键粘贴、退格删除与光标替换

### 21:35 | Codex

- done: 修复右键 WebView 粘贴：改用目标 WebContents 原生 paste，避免千问 React 受控输入出现伪文字
- context: npm run lint 与 npm run build 通过；开发版窗口已发现，但桌面观察接口返回 SetIsBorderRequired 不支持接口 (0x80004002)，未执行 UI 输入验证
- decision: 右键粘贴不再读取剪贴板后注入 activeEl.value，统一调用 target.focus() + target.paste()，兼容 Windows/macOS/Linux
- modified:
  - `src/main/ipcHandlers.ts`
  - `src/renderer/src/components/Layout.tsx`
- unresolved: 需要在可用的桌面观察环境中实际验证千问右键粘贴后退格/删除与光标位置

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
- lesson(promoted): 拖拽上传不要直接信任 renderer File.path；应将文件内容写入主进程受限临时目录后再交给 Webview/CDP。

### 23:17 | codex

- done: Fixed summary-page webview prompt assembly so the user's extra requirement is taken from the webview composer state and included in the prompt sent to the webview summary flow.
- context: The bug was in the webview summary path, not the API summary path: buildWebviewPrompt was reading customPrompt from the API flow instead of webviewCustomPrompt.
- decision: Keep the fix minimal and local to SummaryPanel so API summary behavior remains unchanged.
- modified:
  - `src/renderer/src/components/SummaryPanel.tsx`

