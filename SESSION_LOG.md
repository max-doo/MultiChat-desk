# Session Log

## 2026-11-21

### 15:55 | Codex

- done: 工作台导图文件化设计文档收尾（验收编号重排 1-63、接口与状态机对齐、DOCS_INDEX 收录）
- decision: 最终方案：导图落 .multichat/mindmaps/*.mindmap.md；索引为工作区 .multichat/index.json（不存 conversationId，按 source 归属）；frontmatter 只保留 id/source/title；正文与绑定冲突一律不自动选边
- modified:
  - `docs/workbench-mindmap-file-binding-design.md`
  - `docs/DOCS_INDEX.md`
- lesson: 设计文档里的验收清单编号必须唯一且连续，否则逐条验收时会漏项；跨段落引用的状态名与 reason 枚举要与状态机保持单一来源
- unresolved: 尚未实现；需按 §13 改动清单落地，并在 npm run dev 中逐条走 §14 的 63 项验收

### 15:55 | Codex

- done: 统一工作区 footer 三类弹层：共用 420px 锚定弹层容器与标题栏，Git 状态采用动态截断并补充完整状态 tooltip
- context: 用户指出 Git 按钮需明确展示信息与宽度策略，且 Git、设置、仓库管理弹层样式和宽度不一致。
- added:
  - `src/renderer/src/components/workbench/WorkbenchFooterPopover.tsx`
- modified:
  - `src/renderer/src/components/workbench/WorkbenchFileTree.tsx`
  - `src/renderer/src/components/workbench/WorkbenchGitPanel.tsx`
  - `src/renderer/src/components/workbench/WorkbenchWorkspaceSettings.tsx`
- lesson: footer 弹层统一用锚定容器和共享标题栏，避免各弹窗各自定义宽度与定位；Git 状态用固定状态徽标 + 可截断分支名，不按静态总宽度设计。

### 15:54 | Codex

- done: 工作台导图文件化与相对绑定设计文档（含独立审核两轮修订，补 DOCS_INDEX 索引）
- decision: 导图正文落 .multichat/mindmaps/*.mindmap.md，索引为工作区 .multichat/index.json，绑定用 frontmatter 的 source 相对路径；正文与绑定冲突一律不自动选边
- modified:
  - `docs/workbench-mindmap-file-binding-design.md`
  - `docs/DOCS_INDEX.md`
- lesson: 同一条绑定同时存在于 JSON 与文件时，必须指定唯一权威并让另一方只做缓存；用可变快照字段做比对会让校验永远成立
- unresolved: 尚未实现；需要按 §13 改动清单落地，并在 npm run dev 中逐条走 §14 的 63 项验收

### 15:54 | Codex

- done: 工作台导图文件化与相对绑定设计文档（含独立审核两轮修订）
- decision: 导图正文落 .multichat/mindmaps/*.mindmap.md，索引为工作区 .multichat/index.json，绑定用 frontmatter 的 source 相对路径；正文与绑定冲突一律不自动选边
- modified:
  - `docs/workbench-mindmap-file-binding-design.md`
- lesson: 同一条绑定同时存在于 JSON 与文件时，必须指定唯一权威并让另一方只做缓存；用可变快照字段做比对会让校验永远成立
- unresolved: 尚未实现；需要按 §13 改动清单落地，并在 npm run dev 中逐条走 §14 的 63 项验收

### 15:44 | Codex

- done: 工作区 Git：gitignore 改为按类型复选分类，压缩包与 IDE 配置改为可选，修复刷新请求叠加与设置弹窗静默丢弃未保存规则，补文档
- modified:
  - `src/main/services/gitignoreService.ts`
  - `src/main/services/gitService.ts`
  - `src/renderer/src/components/workbench/WorkbenchWorkspaceSettings.tsx`
  - `src/renderer/src/store/workbenchStore.ts`
  - `docs/workbench-git-sync.md`
- lesson: 文件移动后用 update-index 搬原 blob 可保留重命名历史；git status 用 --no-optional-locks 避免递归监听自激；Git 状态刷新应合并并发请求，否则图标会长时间转圈

### 15:41 | Codex

- done: 调整 footer 三个入口间距，并将 Git 弹层宽度统一为仓库管理弹窗的 420px
- context: 用户反馈 Git 图标与设置图标距离过远，以及仓库管理和 Git 管理弹窗宽度不一致。
- modified:
  - `src/renderer/src/components/workbench/WorkbenchFileTree.tsx`
  - `src/renderer/src/components/workbench/WorkbenchGitPanel.tsx`

### 15:37 | Codex

- done: 实现方案1底部 footer：工作区切换、Git、设置三个独立入口，移除横向分隔线和重复设置入口
- context: 用户选择 HTML 原型方案1，并明确三个按钮之间不需要横向分隔竖线。
- modified:
  - `src/renderer/src/components/workbench/WorkbenchFileTree.tsx`
  - `src/renderer/src/components/workbench/WorkbenchGitPanel.tsx`
- lesson: 设置入口只保留 footer 齿轮；工作区菜单和管理仓库弹窗不再重复放置工作区设置。

### 15:25 | Codex

- done: 补齐开发依赖忽略：默认与模板加入 Python 缓存/虚拟环境/测试工具、Node 依赖、IDE 文件；新增 Python 项目模板；文件树同步隐藏 Python 缓存目录
- modified:
  - `src/main/services/gitignoreService.ts`
  - `src/main/services/gitService.ts`
  - `src/main/services/workbenchService.ts`
  - `docs/workbench-git-sync.md`

### 15:20 | Codex

- done: 工作区设置的忽略规则改为整组模板：知识库/含大文件/全量，一次填入缺失规则，模板前置并区分已填入与已保存
- modified:
  - `src/shared/types/workbench.ts`
  - `src/main/services/gitignoreService.ts`
  - `src/main/ipcHandlers.ts`
  - `src/preload/index.ts`
  - `src/renderer/src/components/workbench/WorkbenchWorkspaceSettings.tsx`
  - `docs/workbench-git-sync.md`

### 14:39 | Codex

- done: 调整 Git 提交标题预填：普通提交只保留日期时间，首次提交使用 Initial commit，并同步文档
- modified:
  - `src/renderer/src/components/workbench/WorkbenchGitPanel.tsx`
  - `docs/workbench-git-sync.md`

### 14:34 | Codex

- done: 工作台 Git 接入收尾：修复子目录路径匹配、未跟踪文件误阻止拉取、SSH 凭据误脱敏、大文件提交兜底与索引刷新循环，并完成回归验证
- lesson(promoted): 目录移动必须逐文件映射索引；.gitignore 编辑按行差异写回并保留注释；push 前必须 fetch；带凭据远程地址不可回填脱敏值
- modified:
  - `src/main/services/gitService.ts`
  - `src/main/services/gitignoreService.ts`
  - `src/main/ipcHandlers.ts`
  - `src/preload/index.ts`
  - `src/shared/types/workbench.ts`
  - `src/renderer/src/store/workbenchStore.ts`
  - `src/renderer/src/components/workbench/WorkbenchGitPanel.tsx`
  - `src/renderer/src/components/workbench/WorkbenchWorkspaceSettings.tsx`
  - `src/renderer/src/components/workbench/WorkbenchFileTree.tsx`
  - `src/main/services/workbenchService.ts`
  - `docs/workbench-git-sync.md`
  - `docs/DOCS_INDEX.md`
  - `.memory/INDEX.md`
  - `.memory/KNOWLEDGE.md`
  - `SESSION_LOG.md`

### 14:28 | Antigravity

- done: 修复工作台标签 Obsidian 格式兼容性、无井号紫色胶囊样式对齐、中文输入法防抢断与无尾换行解析
- modified:
  - `src/renderer/src/components/workbench/FrontmatterPanel.tsx`
  - `src/shared/utils/workbenchTags.ts`
  - `src/renderer/src/components/workbench/MarkdownSyncPlugin.tsx`
  - `src/renderer/src/store/workbenchStore.ts`
  - `scripts/test-tags-obsidian-parity.ts`
- lesson: Obsidian 标签 chip 样式应为原有 violet-500 圆角 badge 且不带井号；Frontmatter 正则必须兼容文件末尾无换行的边界；标签输入框需拦截 IME isComposing 避免中文输入空格误提交

### 14:02 | Codex

- done: 工作台 Git 最终验证：类型检查、全量 lint、构建与 22 项 Git 行为脚本全部通过
- modified:
  - `src/renderer/src/components/workbench/WorkbenchWorkspaceSettings.tsx`

### 14:00 | Codex

- done: 工作台 Git 终审：.gitignore 原子写入、沿用已有远程名、同步更新说明文档
- modified:
  - `src/main/services/gitignoreService.ts`
  - `src/main/services/gitService.ts`
  - `src/shared/types/workbench.ts`
  - `src/renderer/src/components/workbench/WorkbenchWorkspaceSettings.tsx`
  - `docs/workbench-git-sync.md`

### 13:57 | Codex

- done: 工作台 Git 收口复查：空仓库推送提示、已是最新反馈、footer 宽度约束与弹窗尺寸边界
- modified:
  - `src/main/services/gitService.ts`
  - `src/renderer/src/store/workbenchStore.ts`
  - `src/renderer/src/components/workbench/WorkbenchGitPanel.tsx`
  - `src/renderer/src/components/workbench/WorkbenchWorkspaceSettings.tsx`

### 13:52 | Codex

- done: 补充工作台 Git 同步边界知识路由与长期经验
- modified:
  - `.memory/INDEX.md`
  - `.memory/KNOWLEDGE.md`
  - `SESSION_LOG.md`

### 13:52 | Codex

- done: 工作台 Git：footer 整合、工作区设置与忽略规则、大文件提示、远程配置与拉取/推送校准
- added:
  - `src/main/services/gitService.ts`
  - `src/main/services/gitignoreService.ts`
  - `src/renderer/src/components/workbench/WorkbenchGitPanel.tsx`
  - `src/renderer/src/components/workbench/WorkbenchWorkspaceSettings.tsx`
  - `docs/workbench-git-sync.md`
- modified:
  - `src/main/services/gitService.ts`
  - `src/main/services/gitignoreService.ts`
  - `src/main/services/workbenchService.ts`
  - `src/main/ipcHandlers.ts`
  - `src/preload/index.ts`
  - `src/shared/types/workbench.ts`
  - `src/renderer/src/store/workbenchStore.ts`
  - `src/renderer/src/components/workbench/WorkbenchGitPanel.tsx`
  - `src/renderer/src/components/workbench/WorkbenchFileTree.tsx`
  - `src/renderer/src/components/workbench/WorkbenchWorkspaceSettings.tsx`
  - `docs/workbench-git-sync.md`
  - `docs/DOCS_INDEX.md`
- lesson: 目录移动必须逐文件映射索引；.gitignore 编辑按行差异写回并保留注释；push 前必须 fetch；带凭据远程地址不可回填脱敏值

### 13:51 | Antigravity

- done: 恢复工作台笔记属性 tag chip 原有无井号 badge 样式与 Obsidian YAML 标签格式兼容
- context: 用户反馈 Obsidian Frontmatter 源码格式为 tags 多行列表无井号，要求界面 tag chip 保持原先不带井号的 badge 样式
- decision: 标签 chip 与补全浮层均移除井号前缀，恢复原有 rounded-full 胶囊样式；测试集补充覆盖 Obsidian 引号列表标签格式
- modified:
  - `src/renderer/src/components/workbench/FrontmatterPanel.tsx`
  - `src/main/services/workbenchService.ts`
  - `scripts/test-tags-obsidian-parity.ts`

### 13:37 | Codex

- done: 修复工作台 Markdown 预览与源码切换丢失滚动位置：按工作区+文件+视图分别记忆，切回预览时等待内容解析并在尺寸变化时重试恢复，源码切回时首帧恢复 textarea 与行号层
- context: 根因是 editorMode 切换会整棵卸载当前编辑器，两套滚动容器各自从顶部重新挂载；用 Playwright 对构建产物实测长文：预览 2400->2400、源码 900->900
- decision: 滚动位置只保留在渲染层内存 Map，不写配置；预览恢复最多 2 秒并在用户主动滚动/输入时立即让出控制权，避免恢复逻辑抢占交互
- added:
  - `src/renderer/src/components/workbench/workbenchEditorScroll.ts`
- modified:
  - `src/renderer/src/components/workbench/WorkbenchEditor.tsx`
  - `src/renderer/src/components/workbench/WorkbenchSourceEditor.tsx`
- lesson(promoted): 编辑器双视图切换若采用条件渲染整树卸载，浏览器不会保留滚动状态；恢复滚动还要防止内容未撑开时的夹紧值反写记忆，并监听内容尺寸变化重试

### 13:36 | Antigravity

- done: 工作台笔记标签规范对齐Obsidian、标签检索与输入自动补全优化
- decision: Frontmatter存储不带#前缀保持Obsidian Properties兼容；标签输入框支持工作区已有标签关键词模糊匹配下拉选用
- added:
  - `src/shared/utils/workbenchTags.ts`
  - `docs/workbench-tags-obsidian-parity-plan.md`
  - `scripts/test-tags-obsidian-parity.ts`
- modified:
  - `src/shared/types/workbench.ts`
  - `src/main/services/workbenchService.ts`
  - `src/main/ipcHandlers.ts`
  - `src/preload/index.ts`
  - `src/renderer/src/store/workbenchStore.ts`
  - `src/renderer/src/components/workbench/FrontmatterPanel.tsx`
  - `src/renderer/src/components/workbench/WorkbenchSearch.tsx`
- lesson(promoted): Obsidian YAML Frontmatter标签规范不带#前缀，但正文行内标签以#引导；标签输入框需做剥离#前缀与去重清洗

### 13:33 | Antigravity

- done: 统一工作台模式顶栏右侧面板切换按钮（思维导图与AI侧栏）的尺寸与视觉规范，将其与窗口系统控制按钮分离
- context: 用户反馈在进入工作台模式后顶部的两个面板切换按钮明显与其他按钮大小不统一，显得不协调
- decision: 将 WorkbenchPaneToggles 从原先 win32 专属的 w-[46px] 撑满矩形块重构为全平台统一的 w-7 h-7 离散圆角按钮（size=16），并在 Windows 下将其与原生窗口最小化/最大化/关闭按钮分离（保留 mr-2 间距），使其与应用顶栏其他功能按钮规范保持协调一致
- modified:
  - `src/renderer/src/components/Layout.tsx`

### 13:16 | Codex

- done: 来源会话入口改用严格会话页判定：新增 isPlatformConversationPage 按平台枚举真实会话路径与 query 会话键，非会话页/非 AI 链接不再显示“在侧边栏打开会话”，仅保留浏览器打开
- context: 用户反馈 source 填其他链接仍出现打开对话图标；根因是来源入口复用了为后台恢复设计的宽松 isConversationUrlForPlatform
- decision: 自动化链路继续用宽松判定以免影响恢复；UI 入口用严格判定，未确认的 chatglm query 规则不猜；新增严格正负样例进 agent-cli-acceptance.mjs
- modified:
  - `src/shared/utils/conversationUrl.ts`
  - `src/renderer/src/utils/noteSourceConversation.ts`
  - `scripts/agent-cli-acceptance.mjs`
- lesson(promoted): “能否恢复会话”与“是否显示会话入口”是两个判定口径，UI 入口必须用逐平台严格路径白名单，且负例要覆盖同域名非会话页

### 13:11 | Codex

- done: 工作台接入 Git：移动/重命名写入暂存区，新增提交、快进拉取、显式合并与冲突自动撤销、推送与首次关联上游，左栏新增版本管理面板
- context: 验证：tsc node/web 通过，lint 0 error，npm run build 通过；用临时仓库跑通 13 项行为验证（移动暂存、子目录提交范围、快进、分叉、冲突撤销、脏工作区、推送、初始化）
- decision: 不引入 Git 库，直接调用系统 Git；移动用 update-index 只记录路径变化，不连带暂存内容改动；拉取默认只允许快进，分叉需显式合并，冲突自动 merge --abort 回到操作前；提交与状态均限定在工作区范围
- added:
  - `src/main/services/gitService.ts`
  - `src/renderer/src/components/workbench/WorkbenchGitPanel.tsx`
- modified:
  - `src/main/services/workbenchService.ts`
  - `src/main/ipcHandlers.ts`
  - `src/preload/index.ts`
  - `src/shared/types/workbench.ts`
  - `src/renderer/src/store/workbenchStore.ts`
  - `src/renderer/src/components/workbench/WorkbenchFileTree.tsx`
  - `src/renderer/src/components/icons/AppIcon.tsx`
- lesson(promoted): execFile 不支持 input 选项，需要写 stdin 时必须用 spawn；status 的 ahead/behind 基于本地缓存的远程引用，拉取/合并前必须先 fetch，否则会把远程新提交误判为已是最新

### 13:06 | Codex

- done: 修正笔记属性图标映射：补充 sell/calendar_month 的 Lucide 图标，并按属性名识别 source/url/tag/date/title/description
- context: 用户截图显示笔记属性 tag/date 等图标错误；仅修改本次图标映射，保留工作区其他未提交改动。
- modified:
  - `src/renderer/src/components/icons/AppIcon.tsx`
  - `src/renderer/src/components/workbench/FrontmatterPanel.tsx`
- lesson: AppIcon 对未映射名称会回退为警告三角；属性面板新增图标名时必须同步 APP_ICON_MAP，且空值字段应由属性名而非值类型决定语义图标。

### 13:06 | Antigravity

- done: 优化工作台搜索结果在窄宽度下的UI布局，防止行号标签被挤压拉长
- modified:
  - `src/renderer/src/components/workbench/WorkbenchSearch.tsx`

### 12:55 | Codex

- done: 笔记属性 source 链接值支持 Ctrl/Cmd+点击用本地浏览器打开，普通点击仍进入行内编辑；title 提示补齐修饰键用法
- context: 用户反馈上一版只保留编辑动作，缺少本地浏览器打开入口，询问能否用 Ctrl+点击
- decision: 值恢复为 <a href target=_blank>，普通点击 preventDefault 进编辑，修饰键放行给主窗口 setWindowOpenHandler → shell.openExternal；不新增 IPC
- modified:
  - `src/renderer/src/components/workbench/FrontmatterPanel.tsx`
- lesson(promoted): Electron 渲染层给 <a target=_blank> 的普通点击做 preventDefault 不影响修饰键/中键外链：setWindowOpenHandler 只在未被拦截的新窗口请求时触发

### 12:49 | Codex

- done: 修复工作台笔记属性中 source 链接无法直接修改：链接值改为点击即行内编辑（Esc 取消、Enter/失焦提交），打开动作拆为独立图标（会话链接进 AI 侧栏、普通链接进浏览器）
- context: 用户反馈工作台 Markdown 编辑区编辑时不能修改 source 链接；原实现只有 Ctrl/Cmd+点击进入编辑且输入框未自动聚焦
- decision: 链接值与打开动作分离：值文本承担编辑，右侧图标承担打开；保留 source 会话链接解析后走 AI 侧栏，其他 URL 走系统浏览器
- modified:
  - `src/renderer/src/components/workbench/FrontmatterPanel.tsx`
- lesson(promoted): 工作台 FrontmatterPanel 的 URL 字段不能直接把 <a> 当编辑入口，否则普通点击会导航走；编辑态需优先于 URL 渲染分支，且 Esc 要用标记跳过 blur 提交

### 11:59 | Codex

- done: 产出工作台导图文件化与工作区身份设计文档，经独立 worker 四轮审核后修正删除顺序、文件删除出口、收养哈希口径、targets 语义等 6 处契约矛盾
- decision: 导图以 Markdown 落盘到 .multichat/mindmaps，绑定键改为 workspaceId+relativePath，工作区身份用 marker id + 本机 dev/ino 映射
- added:
  - `docs/workbench-mindmap-file-binding-design.md`
- lesson: 对账删除必须区分 ENOENT 与其他错误，空索引不能当成删除依据；导图文件哈希与源文档哈希是两套口径，不可混用

### 09:39 | Codex

- done: 修复 WorkbenchDocxCard 类型报错：为 FileTypeIcon 传入的节点补 fullPath
- context: npx tsc -p tsconfig.web.json 报 WorkbenchFileNode 缺少 fullPath
- modified:
  - `src/renderer/src/components/workbench/WorkbenchDocxCard.tsx`
- lesson(promoted): WorkbenchFileNode 的 fullPath 为必填，新增图标节点时需同时提供绝对路径

### 09:36 | Codex

- done: 按独立审查意见加固主页模式迁移：版本号改为自 1 起的 schema 版本、迁移写入加 await 保证先配置后版本、修复 App 初始化 effect 依赖 [isInitialized] 导致的每次启动重复执行
- decision: hidden 为空视为默认配置；显式清空过的用户会被覆盖，按产品预期接受并在注释留痕
- modified:
  - `src/renderer/src/store/appStore.ts`
  - `src/renderer/src/App.tsx`

### 09:34 | Codex

- done: 修复主页模式默认显隐对存量用户与新装均不生效：新增 productModeConfigVersion 一次性迁移，未保存配置按默认值、hidden 为空补默认隐藏、已自定义保持原样，并落盘版本号
- context: normalizeProductModeConfig(undefined) 会把 hidden 收成空数组，导致 DEFAULT_PRODUCT_MODE_CONFIG 只在首次渲染瞬间生效
- decision: 用版本号区分一次性迁移，避免每次启动覆盖用户后续在设置里的显隐调整
- modified:
  - `src/renderer/src/store/appStore.ts`

### 09:10 | Codex

- done: 将主页模式默认显隐改为只显示多AI和工作台，任务分配/辩论默认隐藏，用户可在设置-主页模式设置中恢复
- modified:
  - `src/renderer/src/store/appStore.ts`

### 09:06 | Codex

- done: 应用户要求将发布版本号从 1.4.0 改为 1.3.5，amend 发布提交并重新打包 NSIS
- modified:
  - `package.json`
  - `package-lock.json`
  - `CHANGELOG.md`

## 2026-11-20

### 22:25 | Codex

- done: 发布 v1.4.0：版本号 1.3.1→1.4.0，CHANGELOG 新增工作台模式（三栏布局/Obsidian 式属性面板/多格式预览/AI 侧边栏/上传落盘/导图绑定）、Lucide 图标迁移与 Chrome UA 安全加固条目
- context: 1.3.1 后累计 33 个提交以 Workbench 本地知识库为主线，构成 minor 级发布
- modified:
  - `package.json`
  - `package-lock.json`
  - `CHANGELOG.md`

### 21:57 | Codex

- done: 字数统计改为 Word 口径（CJK 字符 + 非 CJK 词），emoji 字符数修正
- context: 原实现纯空格分词对中文完全不准，一段无空格中文只算 1 词
- decision: 采用 Intl.Segmenter word 粒度 + CJK Unicode 属性范围，回退空白切分；统计基于 Markdown 源码
- added:
  - `src/renderer/src/utils/wordCount.ts`
- modified:
  - `src/renderer/src/components/workbench/WorkbenchStatusPill.tsx`

### 21:47 | Codex

- done: 笔记属性 source 链接后新增会话图标，可在工作台 AI 侧边栏打开来源会话
- context: source 可能被改写或指向非平台链接，需在渲染期判定而不是依赖创建时记录
- decision: 用 isConversationUrlForPlatform 校验链接归属平台会话页，非会话链接或被改写的 source 不显示入口
- added:
  - `src/renderer/src/utils/noteSourceConversation.ts`
- modified:
  - `src/renderer/src/components/workbench/FrontmatterPanel.tsx`
  - `src/renderer/src/components/workbench/WorkbenchAiSidebar.tsx`
  - `src/renderer/src/store/workbenchStore.ts`

### 21:22 | Codex

- done: 工作台模式下 AI Webview 原生下载自动落到当前工作区，其他模式保持系统保存框；同名文件自动追加序号，生图批量下载链路保持独立
- added:
  - `src/main/services/workbenchDownloadService.ts`
- modified:
  - `src/main/index.ts`
  - `src/main/services/ImageDownloadService.ts`
- lesson: Electron session 的 will-download 可通过 webContents.getType() === 'webview' 识别 AI 侧 Webview；setSavePath 会跳过保存框，需自行做文件名清洗、同名避让和并发占位

### 21:15 | Codex

- done: 修复 WorkbenchFileTree 重复导入导致的 dev 启动失败，并在 PDF 顶部工具栏加入缩放控件
- context: 第 5 行重复 import MARKDOWN_EXTENSIONS 触发 Babel Identifier already declared，dev 直接起不来
- decision: 缩放以 10% 为步进，范围 50%-300%，点击百分比回到 100%；页面宽度=适配宽度×缩放，容器横向滚动承接溢出
- modified:
  - `src/renderer/src/components/workbench/WorkbenchFileTree.tsx`
  - `src/renderer/src/components/workbench/WorkbenchPdfPreview.tsx`
  - `src/renderer/src/components/workbench/WorkbenchPdfViewer.tsx`

### 21:14 | Codex

- done: 采用方案1，将 AI 工作台注入按钮从绿色主题调整为项目主题蓝，并补齐蓝色 hover 效果
- modified:
  - `src/shared/utils/webviewScripts.ts`

### 21:03 | Codex

- done: 工作台 PDF 预览改用 PDF.js 渲染，补文本层让选中文字可弹右键菜单
- context: Electron 42 内置 PDFium 把正文放在 embed，DOM 无文本层，context-menu 的 selectionText 恒为空且 copy() 无效
- decision: 改用 pdfjs-dist canvas + TextLayer，主进程新增 workbench:read-pdf-bytes 供渲染层取字节；按视口懒渲染并释放位图
- added:
  - `src/renderer/src/components/workbench/WorkbenchPdfViewer.tsx`
- modified:
  - `src/renderer/src/components/workbench/WorkbenchPdfPreview.tsx`
  - `src/main/services/workbenchService.ts`
  - `src/main/ipcHandlers.ts`
  - `src/preload/index.ts`
  - `src/renderer/index.html`
  - `src/renderer/src/assets/index.css`
  - `electron.vite.config.ts`
  - `package.json`

### 20:56 | Codex

- done: 统一快捷窗口固定/思维导图等顶栏图标与工作台侧边栏按钮的视觉尺寸
- modified:
  - `src/renderer/src/pages/QuickPage.tsx`
  - `src/renderer/src/pages/MainPage.tsx`
  - `src/renderer/src/components/Layout.tsx`
  - `src/renderer/src/components/workbench/WorkbenchAiSidebar.tsx`
  - `src/renderer/src/components/workbench/WorkbenchFileTree.tsx`
- lesson(promoted): AppIcon 的 size 会乘 0.85 光学缩放；要求与 WebviewCard 的 20px 导航图标视觉一致，需要传 size={20}，不能只沿用旧 material text-base 对应的 16。

### 20:56 | Codex

- done: 按用户要求进一步恢复图片文件原来的 image/draw 图标；Markdown/TXT 的 description 图标继续保留，PDF、Word、Excel、PPT 与代码类仍使用统一 Material 文件图标
- context: 用户明确要求图片也用原来的
- modified:
  - `src/renderer/src/components/workbench/FileTypeIcon.tsx`
  - `src/renderer/src/components/workbench/WorkbenchFileTree.tsx`
  - `scripts/verify_workbench_previews.py`

### 20:52 | Codex

- done: 按用户要求恢复 Markdown 与 TXT 的原有 description 图标；PDF、Word、Excel、PPT、代码、图片等文件类型仍统一使用工作区 Material SVG 图标
- context: 用户明确要求不要改 Markdown 和 TXT 的 logo
- modified:
  - `src/renderer/src/components/workbench/FileTypeIcon.tsx`
  - `src/renderer/src/components/workbench/WorkbenchFileTree.tsx`
  - `scripts/verify_workbench_previews.py`

### 20:49 | Codex

- done: 按批注调整工作台划词 AI：改写解释与润色提示词，删除续写动作及文档旧模板，并同步两处右键菜单
- modified:
  - `src/renderer/src/store/workbenchStore.ts`
  - `src/renderer/src/components/workbench/WorkbenchSelectionMenuPlugin.tsx`
  - `src/renderer/src/components/CustomContextMenu.tsx`
  - `docs/workbench_product_spec.md`

### 20:46 | Codex

- done: 将 ControlBar 通知状态残留 Material Symbols 图标替换为 AppIcon
- context: 按用户要求处理最后一处应用自身 material-symbols-outlined 残留；通知 success/error/info 分别映射 check_circle/error/info，保留原颜色与 16px 尺寸。
- modified:
  - `src/renderer/src/components/ControlBar.tsx`
- lesson: AppIcon 默认 optical scale 0.85，旧 font-size 16px 的图标改用 size={16} 即可保持接近原视觉尺寸。

### 20:44 | Codex

- done: 替换 AI 工作台注入回复按钮图标为 Lucide file-plus-corner 与 pilcrow-left，并升级注入脚本绑定标记以刷新旧页面按钮
- modified:
  - `src/shared/utils/webviewScripts.ts`

### 20:43 | Codex

- done: 统一工作台文件类型图标：所有代码、PDF、Word、Excel、PPT、Markdown、图片与文本均使用同一套工作区 Material SVG 图标，并让文件树、PDF 预览和 Office 预览复用同一组件
- decision: 根因是文件树按代码/非代码分成 SVG 与 AppIcon 两套图标来源；收敛为 FileTypeIcon 单一映射并复用在预览头部
- added:
  - `src/renderer/src/assets/file-icons/pdf.svg`
  - `src/renderer/src/assets/file-icons/word.svg`
  - `src/renderer/src/assets/file-icons/table.svg`
  - `src/renderer/src/assets/file-icons/powerpoint.svg`
  - `src/renderer/src/assets/file-icons/markdown.svg`
  - `src/renderer/src/assets/file-icons/image.svg`
  - `src/renderer/src/assets/file-icons/svg.svg`
  - `src/renderer/src/assets/file-icons/log.svg`
  - `src/renderer/src/assets/file-icons/zip.svg`
- modified:
  - `src/renderer/src/components/workbench/FileTypeIcon.tsx`
  - `src/renderer/src/components/workbench/WorkbenchFileTree.tsx`
  - `src/renderer/src/components/workbench/WorkbenchDocxCard.tsx`
  - `src/renderer/src/components/workbench/WorkbenchPdfPreview.tsx`
  - `scripts/verify_workbench_previews.py`

### 20:35 | Codex

- done: 核实 Material Symbols、Lucide 与 Material 风格文件图标的迁移边界
- context: 用户询问现有 Material 风格文件图标是否应已全部迁移至 Lucide；检查 AppIcon、FileTypeIcon、ControlBar 残留、依赖与文档。
- lesson(promoted): Material Symbols 通用字体图标与 vscode-material-icon-theme 文件类型 SVG 是两个体系；后者按扩展名显示语言品牌图标，不属于 Lucide 迁移范围。当前仍有 ControlBar 通知提示一处 material-symbols-outlined 残留，外部网页选择器中的 material-icons 不算应用图标残留。

### 20:33 | Codex

- done: 自定义 Lucide 风格 PDF 图标，替换 AppIcon 中 picture_as_pdf 对通用 FileText 的复用
- modified:
  - `src/renderer/src/components/icons/AppIcon.tsx`

### 20:27 | Codex

- done: 核验并修正设置中过时的 API Key 备份说明：确认应用已不再存储 API Key，更新备份说明和使用说明文案，移除恢复弹窗中的失效兼容提示。
- context: 用户指出截图中的 API Key 脱敏说明已过时；核验 ApiConfig 仅保留总结模板与平台字段，旧备份兼容清理继续保留。
- modified:
  - `src/renderer/src/components/SettingsDrawer.tsx`
  - `src/renderer/src/components/ImportCacheConfirmModal.tsx`

### 20:24 | Codex

- done: 将当前思维导图的入口图标统一替换为 diagram-flow-horizontal
- context: 用户要求把当前思维导图图标统一换成 diagram-flow-horizontal；保留任务分配等非导图语义的 account_tree 不变。
- modified:
  - `src/renderer/src/components/icons/AppIcon.tsx`
  - `src/main/webviewManager.ts`
  - `src/renderer/src/components/Layout.tsx`
  - `src/renderer/src/components/ConversationMindmapPanel.tsx`
  - `src/renderer/src/components/MindmapSidebarView.tsx`
  - `src/renderer/src/components/NotesConversationCards.tsx`
  - `src/renderer/src/components/LocalMindmapPanel.tsx`
  - `src/renderer/src/components/workbench/WorkbenchMindmapPanel.tsx`
  - `src/renderer/src/components/workbench/WorkbenchSelectionMenuPlugin.tsx`
  - `src/renderer/src/pages/MainPage.tsx`
  - `src/renderer/src/pages/QuickPage.tsx`

### 20:22 | Codex

- done: 工作台文件树右键菜单新增上传到 AI，复用现有节点上传事件并支持多选节点
- context: 用户截图指向工作区文件列表右键菜单，要求新增上传到 AI 命令。
- decision: 沿用 WORKBENCH_UPLOAD_NODES_EVENT 与 WorkbenchAiSidebar 已实现的节点上传链路，不改 IPC；右键未选中节点沿用现有单选处理，已多选时批量上传。
- modified:
  - `src/renderer/src/components/workbench/WorkbenchFileTree.tsx`

### 20:15 | Codex

- done: 将工作台 AI 侧栏文件上传 toast 从 top-12 下移至 top-28，避免遮挡平台 header
- modified:
  - `src/renderer/src/components/workbench/WorkbenchAiSidebar.tsx`

### 20:14 | Codex

- done: 调整 ControlBar 文件上传 toast 定位，改为相对控制栏右侧下移显示，避免遮挡页面 header
- modified:
  - `src/renderer/src/components/ControlBar.tsx`

### 20:13 | Codex

- done: 补充统一 .txt 的 Markdown 行为：重命名后按共享扩展集合刷新内容，文件树清理未引用图片菜单对 .txt 可见
- context: Follow-up sweep after TXT-to-Markdown editor change found remaining .md/.markdown-only hardcodes.
- decision: Reuse MARKDOWN_EXTENSIONS instead of duplicating extension literals.
- modified:
  - `src/renderer/src/components/workbench/WorkbenchFileTree.tsx`
  - `src/renderer/src/store/workbenchStore.ts`

### 20:13 | Codex

- done: 工作台 PDF 预览改用 webview，复用 Webview 右键菜单链路
- context: PDF object 插件文档选区不进入主页面 window.getSelection，无法触发现有 DOM 菜单
- modified:
  - `src/renderer/src/components/workbench/WorkbenchPdfPreview.tsx`

### 20:12 | Codex

- done: 工作台将 .txt 视同 Markdown：复用 Markdown 富文本/源码编辑器，并同步文件树图标、AI 回复插入、资产联动与导图支持
- context: User requested TXT files in the workbench to use the Markdown editor instead of the plain code editor.
- decision: Treat .txt as MARKDOWN_EXTENSIONS; keep .log/.csv/.tsv as TEXT_EXTENSIONS so the existing category-driven editor routing applies end-to-end.
- modified:
  - `src/shared/types/workbench.ts`
  - `src/renderer/src/components/workbench/WorkbenchFileTree.tsx`

### 20:12 | Codex

- done: 修复工作区拖拽上传偶发永久卡死：为 Webview 脚本调用与 dispatchFileDrop 增加超时，上传锁改为带时间戳可自愈，新增停止等待入口与批次代际校验，避免迟到结果覆盖新一批状态
- context: 用户截图显示元宝侧边栏长期停留在'正在上传上一批文件，请稍候'；根因是 uploadingRef 仅在 finally 释放，而 executeJavaScript/dispatchFileDrop 无超时，Promise 永不 settle 时锁永久占用
- decision: 脚本读取 5s、CDP 派发 15s、附件就绪仍为 90s；锁超过 3 分钟视为僵死可接管；停止等待通过 uploadGenerationRef 使旧批次静默退出，不改写新批次 toast
- modified:
  - `src/renderer/src/hooks/useWebviewActions.ts`
  - `src/renderer/src/components/workbench/WorkbenchAiSidebar.tsx`
  - `scripts/verify_workspace_drag_drop.py`
- lesson(promoted): 上传互斥锁必须只保护有界的等待；任何 await 的 executeJavaScript/CDP Promise 都要 withTimeout，否则页面重载或调试器挂起会让 finally 永不执行，锁永久卡住
- lesson(promoted): 可取消批次要同时有代际号与 toast 归属校验；旧批次迟到时不得清空新批次的锁或覆盖新提示，否则会出现'停止后又被上一批写回'的假状态

### 20:11 | Codex

- done: 为 PDF、PPT、Excel、Word 预览底部新增发送到 AI 按钮，复用现有文件上传事件与轻量强调样式
- context: PDF 和 Office 文档分类共用 WorkbenchPdfPreview / WorkbenchDocxCard 两个预览组件；PPT、Excel、Word 均归入 document 类别。
- added:
  - `src/renderer/src/components/workbench/WorkbenchSendToAiButton.tsx`
- modified:
  - `src/renderer/src/components/workbench/WorkbenchPdfPreview.tsx`
  - `src/renderer/src/components/workbench/WorkbenchDocxCard.tsx`

### 20:02 | Codex

- done: 精简工作台 AI 侧边栏文件上传失败提示，超长错误详情改为控制台输出
- modified:
  - `src/renderer/src/components/workbench/WorkbenchAiSidebar.tsx`

### 20:02 | Codex

- done: 修复 Markdown 编辑区滚动到底部无留白：flex 行容器默认 stretch 使内容盒固定为视口高度，padding-bottom 不进入滚动范围；改为 items-start 让内容随文档增高
- modified:
  - `src/renderer/src/components/workbench/WorkbenchEditor.tsx`
- lesson: flex 行容器里给滚动子项加 padding-bottom 不产生末尾留白：align-items 默认 stretch 把子项高度拉到容器高度，padding 位于盒内而内容溢出盒外；需要 items-start/self-start 让子项按内容高度撑开（或改成 block + mx-auto），min-h-full 仍保留短文档铺满

### 19:58 | Codex

- done: 按用户反馈调整 Markdown 编辑区底部安全区：保留右下角悬浮状态条，仅增加滚动到底部时的底部留白
- decision: 放弃预留 footer 占位带，恢复悬浮效果；富文本画布 pb-20，源码模式 pre/textarea 底部内边距 80px，滚到底后最后一行与浮层之间保留约 32px 间距
- modified:
  - `src/renderer/src/components/workbench/WorkbenchEditor.tsx`
  - `src/renderer/src/components/workbench/WorkbenchSourceEditor.tsx`

### 19:58 | Codex

- done: 简化工作台不支持文件打开的提醒：移除详情卡片和多余操作，仅保留背景提示与主题色默认应用打开按钮
- modified:
  - `src/renderer/src/components/workbench/WorkbenchDocxCard.tsx`

### 19:57 | Codex

- done: 修正工作台 Markdown 编辑区底部安全区：改为预留固定空白带，滚动视口在状态条上方结束，避免内容在任何滚动位置被浮层遮挡
- modified:
  - `src/renderer/src/components/workbench/WorkbenchEditor.tsx`
  - `src/renderer/src/components/workbench/WorkbenchSourceEditor.tsx`
- lesson: 悬浮底栏场景下，仅给滚动内容加 padding-bottom 只在滚到底时留白，中途滚动仍会被覆盖；要保证任何位置不遮挡必须为浮层预留独立布局空间（如 shrink-0 占位带或静态 footer）

### 19:54 | codex

- done: 工作台 AI 侧栏上传提示改为仅显示进度，不再显示文件名与目标模型名
- context: 用户反馈截图中的上传 toast 文案冗余
- decision: 进行中显示 正在上传 (i/n)，完成显示 上传完成 (n/n)；保留失败详情与跳过文件夹数量
- modified:
  - `src/renderer/src/components/workbench/WorkbenchAiSidebar.tsx`

### 19:53 | Codex

- done: 为工作台 Markdown 编辑区底部增加空白安全区，避免最后一行内容被右下角悬浮的状态条遮挡
- decision: 富文本画布由 py-6 改为 pt-6 pb-24；源码模式的 pre 与 textarea 底部内边距同步加到 96px，保持高亮层与输入层对齐
- modified:
  - `src/renderer/src/components/workbench/WorkbenchEditor.tsx`
  - `src/renderer/src/components/workbench/WorkbenchSourceEditor.tsx`

### 19:50 | Codex

- done: 补齐工作台发送到 AI 轻量强调方案：按钮从状态胶囊拆分为独立浅蓝按钮，并完善 hover、禁用与键盘焦点状态
- modified:
  - `src/renderer/src/components/workbench/WorkbenchStatusPill.tsx`

### 19:48 | Codex

- done: 采用轻量强调方案：优化工作台底部发送到 AI 按钮样式
- modified:
  - `src/renderer/src/components/workbench/WorkbenchStatusPill.tsx`

### 19:48 | Codex

- done: 补充独立审查：确认代码提问入口已全部移除，保留全局右键/非代码划词公式化提示词与思维导图入口
- context: 最终范围复核：代码预览无 askAi 调用；CustomContextMenu 与 WorkbenchSelectionMenuPlugin 在 activeFileCategory=code 时不显示 AI 提问项；workbenchStore 删除 isCode 条件分支
- modified:
  - `SESSION_LOG.md`

### 19:48 | Codex

- done: 删除工作台代码提问提示词注入：移除代码预览的提问/解释/重构悬浮入口，代码文件右键仅保留思维导图，全局右键与 askAi 去掉代码专用提示词分支
- context: 用户澄清当前只有发送功能，要删掉代码提问的提示词注入功能；保留发送到 AI，以及非代码编辑器的 AI 划词能力
- modified:
  - `src/renderer/src/components/workbench/WorkbenchCodePreview.tsx`
  - `src/renderer/src/components/workbench/WorkbenchSelectionMenuPlugin.tsx`
  - `src/renderer/src/components/CustomContextMenu.tsx`
  - `src/renderer/src/store/workbenchStore.ts`

### 19:43 | Codex

- done: 补充折叠条带上传在 React 布局完成后再启动、右侧条带外部文件守卫，并增加外部文件优先于残留 draggingNodes 的回归用例；将跨栏上传教训提升到 KNOWLEDGE/INDEX
- context: Playwright 主路径与 5c-5e、7b 全部通过后，针对真实 Electron 折叠态 Webview 可能为 0 尺寸补两帧等待；5f 验证陈旧 store 节点不再劫持外部文件
- modified:
  - `src/renderer/src/components/workbench/WorkbenchAiSidebar.tsx`
  - `src/renderer/src/pages/WorkbenchPage.tsx`
  - `scripts/verify_workspace_drag_drop.py`
  - `.memory/KNOWLEDGE.md`
  - `.memory/INDEX.md`
  - `SESSION_LOG.md`

### 19:39 | Codex

- done: 修复工作区文件拖拽上传到 AI 侧边栏的假成功、折叠面板丢文件、外部拖拽状态残留，并补充混选提示、上传互斥和主进程文件校验；同时恢复 WorkbenchCodePreview 中缺失的 saveStatus/activeFileSize/formattedSize 声明以消除运行时崩溃
- context: 按用户确认的 P1→P3 顺序修复；改前先用 Playwright 复现折叠条带 drop=0、外部拖拽遮罩残留、混选静默丢文件夹、陈旧 draggingNodes 劫持
- decision: 上传成功改为以附件新增信号（文件名命中或附件计数增加）连续稳定 3 次为准；折叠条带改为拖拽释放后一次完成展开与上传；外部文件 drop 优先于 store 残留节点
- modified:
  - `src/shared/utils/webviewScripts.ts`
  - `src/renderer/src/hooks/useWebviewActions.ts`
  - `src/renderer/src/components/workbench/WorkbenchAiSidebar.tsx`
  - `src/renderer/src/components/workbench/workbenchAiEvents.ts`
  - `src/renderer/src/pages/WorkbenchPage.tsx`
  - `src/main/services/AutomationService.ts`
  - `src/renderer/src/components/workbench/WorkbenchCodePreview.tsx`
  - `scripts/verify_workspace_drag_drop.py`
- lesson(promoted): CDP Input.dispatchDragEvent 返回成功只代表事件已派发，不代表附件已挂载；必须轮询 generateFileUploadStateScript，并以基线与新增计数/文件名命中判断，否则会稳定产生假成功
- lesson(promoted): 工作台右侧条带不能在 dragenter 就卸载并只 openRightPane，drop 会被吞；应在 drop 时把 draggingNodes 快照交给常驻侧边栏，一次完成展开与上传
- unresolved: 尚未在真实 Electron Webview 内对 ChatGPT/Claude/Gemini 等平台做上传就绪验收；需 npm run dev 后逐平台拖拽图片/PDF/大文件确认，尤其关注无附件 chip 的平台是否出现 90 秒超时

### 19:36 | Codex

- done: Increase-status-pill-height
- context: User requested increasing the height of the bottom status pill after moving the send-to-AI capsule into it.
- modified:
  - `src/renderer/src/components/workbench/WorkbenchStatusPill.tsx`

### 19:36 | Codex

- done: 删除工作台编辑器空状态中的说明文字，并保留按钮间距
- modified:
  - `src/renderer/src/components/workbench/WorkbenchEditor.tsx`

### 19:34 | Codex

- done: Emphasize-send-to-ai-capsule-button
- context: User requested blue text/icon for the status-pill send button and a blue background with white text on hover.
- modified:
  - `src/renderer/src/components/workbench/WorkbenchStatusPill.tsx`

### 19:32 | Codex

- done: 删除工作台顶部栏工作区名称前的文件夹图标
- context: 用户截图红框标记的是顶部工作区名称前的黄色文件夹图标；仅移除该图标，保留工作区名称、文件路径和其余按钮。
- modified:
  - `src/renderer/src/components/Layout.tsx`

### 19:31 | Codex

- done: Move-send-file-button-to-status-pill
- context: User requested moving the send-file button from the code toolbar into the bottom-right character-count floating pill as a matching capsule button.
- modified:
  - `src/renderer/src/components/workbench/WorkbenchCodePreview.tsx`
  - `src/renderer/src/components/workbench/WorkbenchStatusPill.tsx`

### 19:25 | Antigravity

- done: 彻底移除右侧 AI 对话框拖拽上传时的蒙层和提示卡片，保持完全透明无感上传，并刷新当前运行中的 Electron 调试实例
- decision: 采用完全透明的 cursor-copy 感应层，阻断 guest webview 吞噬拖拽事件的同时避免视觉遮挡与弹窗打扰
- modified:
  - `src/renderer/src/components/workbench/WorkbenchAiSidebar.tsx`
  - `scripts/verify_workspace_drag_drop.py`

### 19:23 | Antigravity

- done: 修复工作区文件跨栏拖拽上传至AI侧边栏问题：消除2.5s阻塞、适配Windows路径与MIME补全、解决拖拽遮罩残存与布局抖动并补全端到端验证
- modified:
  - `src/renderer/src/components/workbench/WorkbenchAiSidebar.tsx`
  - `src/renderer/src/hooks/useWebviewActions.ts`
  - `src/renderer/src/pages/WorkbenchPage.tsx`
  - `scripts/verify_workspace_drag_drop.py`
  - `scripts/verify_workbench_frontend.py`
  - `scripts/verify_workbench_previews.py`

### 19:23 | Antigravity

- done: 修复并完善左侧工作区拖拽文件上传至右侧AI对话框机制：解决上传成功Toast静默被吞、ESLint无用转义错误、全透明拖拽感应层防Guest Webview事件吞噬、Escape按键与窗口边界清理、工作区搜索列表项拖拽能力
- modified:
  - `src/renderer/src/components/workbench/WorkbenchAiSidebar.tsx`
  - `src/renderer/src/components/workbench/WorkbenchSearch.tsx`
  - `src/renderer/src/components/workbench/WorkbenchCodePreview.tsx`
  - `scripts/verify_workspace_drag_drop.py`

### 19:22 | Codex

- done: 修正 Markdown 编辑区前进按钮图标
- modified:
  - `src/renderer/src/components/icons/AppIcon.tsx`
- lesson(promoted): 重做按钮应使用成套的 Undo2/Redo2；Repeat 是循环播放语义，不应作为前进图标。

### 19:20 | Codex

- done: 移除文件编辑器代码预览中文件名后的文件类型标签
- modified:
  - `src/renderer/src/components/workbench/WorkbenchCodePreview.tsx`

### 19:16 | Codex

- done: 修复工作台 Markdown 富文本预览的标题换行行距与引用左缩进
- context: 工作台 Lexical Markdown 渲染；用户提供两张预览截图
- decision: 标题按层级设置相对行高；引用移除额外 20px 左边距，保留左边线与内边距
- modified:
  - `src/renderer/src/assets/index.css`
- lesson(promoted): PlaygroundEditorTheme 标题使用固定 px 字号时需显式设置相对 line-height，否则会继承 body 的 24px 固定行高，标题换行后行距过紧

### 19:11 | Codex

- done: 保留工作台文件上传成功提示，并将上传 toast 统一为项目现有 ControlBar/ModelOutputCard 样式；进度、成功、失败分别使用信息、成功、错误状态。
- context: 用户要求成功 toast 保留，且不能自造样式。
- decision: 直接复用 notification-popup、shadow-float、白底半透明与绿色/红色/蓝色细边框；部分成功改用信息态，不新增警告样式。
- modified:
  - `src/renderer/src/components/workbench/WorkbenchAiSidebar.tsx`
  - `.memory/KNOWLEDGE.md`
- lesson(promoted): 项目内 toast 应复用 ControlBar/ModelOutputCard 的既有视觉类，不单独设计新的上传提示条。

### 19:06 | Antigravity

- done: 移除拖拽文件至 AI 对话框时的遮罩与提示卡片，保持无感透明感应与直接拖拽上传能力
- decision: 保留覆盖于 webview 上层的透明感应层以确保 Electron host 接收 drag/drop 事件，但彻底移除 backdrop-blur、蒙层及弹窗提示，实现无感平滑拖拽上传
- modified:
  - `src/renderer/src/components/workbench/WorkbenchAiSidebar.tsx`
  - `scripts/verify_workspace_drag_drop.py`

### 18:57 | Codex

- done: WorkbenchCodePreview 工具栏简化：删除文件名后的语言标签，发送到AI按钮改蓝色+纸飞机图标
- modified:
  - `src/renderer/src/components/workbench/WorkbenchCodePreview.tsx`
  - `src/renderer/src/components/icons/AppIcon.tsx`

### 18:53 | Codex

- done: 工作台代码预览的 AI 助手下拉改为一键发送当前完整文件；上传前自动保存未落盘修改，上传成功静默收尾。
- context: 截图指向 WorkbenchCodePreview 的 AI 助手下拉菜单，侧边栏已有工作区文件上传能力。
- decision: 复用 WorkbenchAiSidebar 的 uploadFile 链路，通过渲染层自定义事件触发，不新增 IPC；保留划词解释和重构入口。
- added:
  - `src/renderer/src/components/workbench/workbenchAiEvents.ts`
- modified:
  - `src/renderer/src/components/workbench/WorkbenchCodePreview.tsx`
  - `src/renderer/src/components/workbench/WorkbenchAiSidebar.tsx`
- lesson(promoted): 文件上传成功无需 toast；若先展示持久进度提示，成功时必须主动清除，避免无自动隐藏的提示滞留。

### 18:46 | Antigravity

- done: 验证并补全工作区拖拽上传到右侧 AI 对话框链路，增加完整 DOM-ready 与 dispatchFileDrop 端到端自动化验收
- added:
  - `scripts/verify_workspace_drag_drop.py`

### 18:19 | Antigravity

- done: 实现工作台左侧工作区文件拖拽直接上传到右侧 AI 对话框
- decision: 工作区拖拽通过 store 记录 draggingNodes 跨栏感知，配合 AI 侧边栏浮层遮罩捕获宿主 drop 事件，调用已有 CDP dispatchFileDrop 直连输入框
- modified:
  - `src/renderer/src/components/workbench/WorkbenchFileTree.tsx`
  - `src/renderer/src/components/workbench/WorkbenchAiSidebar.tsx`
  - `src/renderer/src/pages/WorkbenchPage.tsx`
  - `src/renderer/src/store/workbenchStore.ts`
  - `src/shared/utils/webviewScripts.ts`
- lesson(promoted): Electron guest webview 运行时会吞噬宿主 DOM 的拖拽事件；内部元素拖放至 webview 必须在宿主侧挂载拖拽遮罩层以截获 drop 事件并借由 CDP Input.dispatchDragEvent 发送给 webContents

### 18:03 | Antigravity

- done: 修复 Windows 窗口控件中向下还原(restore)图标与原生 Windows MDL2 资产不一致的问题
- modified:
  - `src/renderer/src/components/Layout.tsx`

### 17:47 | Codex

- done: 修复工作台代码块连续 Enter 光标跳转，以及最后一个代码块无法点击外部退出：高亮重建改为微任务提交，按字符偏移恢复支持 Element Point 与连续 LineBreakNode 的选区；在编辑根空白处 mousedown 时补建代码块外段落，并用 code-exit 标签阻止幻影空段落写回 Markdown
- context: 内置浏览器直接打开 Vite 页面会因缺少 Electron preload 在 window.api.platform 处白屏，因此用 Electron CDP 加真实键盘事件验证实际编辑行为；临时测试文档已删除
- decision: 只修改代码块高亮插件与 Markdown 同步插件，不调整编辑器整体结构或 Lexical 配置
- modified:
  - `src/renderer/src/components/workbench/WorkbenchCodeHighlightPlugin.tsx`
  - `src/renderer/src/components/workbench/MarkdownSyncPlugin.tsx`
- lesson(promoted): Lexical CodeNode mutation listener 内不能同步 editor.update 重建 children：重建会并入当前提交并被随后状态覆盖，选区却按新节点恢复而落到幸存旧节点；应 queueMicrotask 延后，并以块内字符偏移恢复选区。连续 LineBreakNode 的空行必须用 CodeNode element point 表示，selectNext 会越过空行。代码块是文档末节点时 Chromium 会把下方空白点击映射回代码末尾，需要在根元素 mousedown 捕获并主动插入段落，相关更新要跳过 Markdown 回写，避免只点击就产生空段落落盘
- unresolved: 全量 npm run lint 仍被既有 AppIcon.tsx:308 unused eslint-disable 阻塞，与本次改动无关；定向 ESLint 已通过

### 17:41 | Codex

- done: 修正主窗口 Windows 最大化/最小化/关闭控件字形，并将附件回形针旋转为垂直方向
- context: 用户截图指出附件图标呈 45 度、Windows 标题栏最小化按钮不是原生样式
- decision: 窗口三键使用 10x10 的 Windows 字形 SVG，保留现有自绘标题栏与 IPC；附件仅调整 Lucide Paperclip 的旋转角度
- modified:
  - `src/renderer/src/components/Layout.tsx`
  - `src/renderer/src/components/ControlBar.tsx`
- lesson(promoted): Lucide Paperclip 默认斜向，叠加 -rotate-90 仍是另一种 45 度斜线；需要 -rotate-45 才呈垂直。

### 17:32 | Codex

- done: Material→Lucide迁移完成：codemod替换378处span为AppIcon(55文件)，FrontmatterPanel button图标手动改，3处fontVariationSettings改fill/strokeWidth，CSS选择器改svg[data-icon]且font-size→width/height，main.tsx移除字体import+uninstall material-symbols，verify断言改svg[data-icon]；tsc+lint+build全过，woff2减3.86MB
- modified:
  - `src/renderer/src/components/icons/AppIcon.tsx`
  - `src/renderer/src/main.tsx`
  - `src/renderer/src/assets/index.css`
  - `src/renderer/src/styles/notesWorkspace.css`
  - `scripts/verify_workbench_previews.py`
  - `55个tsx组件`
  - `package.json`
  - `package-lock.json`
- lesson: 批量图标迁移codemod要点:动态className含插值不能拍平成字符串要透传;title是tooltip要转title子节点或加进Props;fontVariationSettings对svg无效要改fill/strokeWidth;CSS的font-size控图标尺寸迁svg要改width/height;button直接挂图标类的形态正则匹配不到要手动找
- unresolved: npm run dev视觉巡检未做(stroke可读性/基线/小尺寸),待手动验证

### 17:14 | Codex

- done: 修复代码块 Enter 光标跳回上一行行首：WorkbenchCodeHighlightPlugin 在 mutation 回调 discrete 重建 children 把 insertNewAfter 刚设的新行选区删掉重置；改为去掉 discrete + 重建前记录块首字符偏移、重建后按偏移恢复选区
- modified:
  - `src/renderer/src/components/workbench/WorkbenchCodeHighlightPlugin.tsx`
- lesson: CodeNode 高亮重建 children（clear+append）会销毁选区锚点节点导致光标重置到块首；mutation listener 里用 discrete:true 会抢在 selection 提交前执行——正确做法是记录『块首字符偏移』重建后恢复，并走 Lexical 默认异步调度

### 17:08 | Codex

- done: 修复 wysiwyg 代码块：新增 WorkbenchCodeHighlightPlugin 复刻 playground 算法——registerCodeGutter 写行号 + CodeNode mutation 触发 Prism.tokenize 重建 CodeHighlightNode children；theme 补 codeHighlight token 映射与 PlaygroundEditorTheme__token* 配色（含 dark）
- added:
  - `src/renderer/src/components/workbench/WorkbenchCodeHighlightPlugin.tsx`
- modified:
  - `src/renderer/src/components/workbench/WorkbenchEditor.tsx`
  - `src/renderer/src/assets/index.css`
  - `src/renderer/src/types/prismjs.d.ts`
- lesson: @lexical/code 0.53 移除了 registerCodeHighlighting，行号 registerCodeGutter 在 @lexical/code-core、Prism 高亮需自行实现（@lexical/code-prism 未安装）；CodeNode children 重建要 tag 跳过自身 mutation 回声 + 逐项比较防止无限重建

### 17:03 | Codex

- done: workbench 标题栏去后缀显示、字号 28→32 比 h1 大；frontmatter 属性面板去卡片边框/底色与背景融为一体（对齐 Obsidian）
- modified:
  - `src/renderer/src/components/workbench/WorkbenchTitleBar.tsx`
  - `src/renderer/src/components/workbench/FrontmatterPanel.tsx`
  - `src/renderer/src/components/workbench/WorkbenchEditor.tsx`

### 17:01 | Codex

- done: workbench 预览区顶部加 Obsidian 式文档标题栏：去扩展名显示、点击行内重命名（Enter/blur 提交、Esc 取消）、提交前先落盘清 dirty 再 renameNode 联动 assets；顺带把 placeholder 定位改为相对正文容器修复与标题/属性面板重叠
- modified:
  - `src/renderer/src/components/workbench/WorkbenchTitleBar.tsx`
  - `src/renderer/src/components/workbench/WorkbenchEditor.tsx`
- lesson: workbench 重命名文档必须先 saveActiveFile 清 dirty+防抖计时器再 renameNode，否则 autosave 会用旧路径覆盖新文件；Lexical placeholder 用 absolute top 硬编码会随前置块（标题/属性面板）高度变化漂移，应包 relative 容器相对正文定位

### 16:54 | Codex

- done: 修复重复 Ctrl+C/Ctrl+V 副本互相覆盖：workbenchService.importExternalPaths 查空名与 cp 落盘存在跨 IPC TOCTOU 竞态，两次粘贴并发拿到同一个 -1 目标名；按目标目录加进程内 promise 链锁(copyTargetLocks)串行化临界区
- context: 用户反馈重复复制粘贴时 -1 副本被覆盖，应生成 -1/-2/-3 递增副本
- decision: 锁放主进程而非前端串行：外部拖拽导入、菜单'创建副本'同样走 importExternalPaths，主进程锁对全部入口统一生效
- modified:
  - `src/main/services/workbenchService.ts`
- lesson: fs 异步复制的'查空名→落盘'是典型的 TOCTOU；校验和落盘必须处于同一互斥临界区，仅在查名前加一次 stat 不能修复并发覆盖

### 16:53 | Codex

- done: workbench 笔记属性面板改为 Obsidian 式可编辑：值行内编辑、key 重命名、tags chip 增删、添加属性入口，frontmatter 通过自定义事件同步回 MarkdownSyncPlugin
- modified:
  - `src/renderer/src/components/workbench/FrontmatterPanel.tsx`
  - `src/renderer/src/components/workbench/WorkbenchEditor.tsx`
  - `src/renderer/src/components/workbench/MarkdownSyncPlugin.tsx`
- lesson: workbench 编辑器 frontmatter 与正文分离存放于 MarkdownSyncPlugin.frontmatterRef；面板直接改 activeFileContent 会被 Lexical 回写覆盖，必须同步 ref + lastSyncedContentRef

### 16:48 | Codex

- done: 采纳独立 worker 审查意见：保持 binding 优先语义（每张导图记住自己的模型，新视图用全局上次选择）；applyPlatform 持久化调用补 .catch 防御
- modified:
  - `src/renderer/src/components/ConversationMindmapPanel.tsx`

### 16:48 | Codex

- done: 修复 Markdown 预览（富文本）模式下查找无定位无高亮：新增 WorkbenchFindHighlightPlugin，把 markdown 偏移区间映射成 Lexical TextNode 选区并聚焦+滚动；查找替换仍走 activeFileContent 字符串层（统一口径，MarkdownSyncPlugin 自动重灌 AST）；源码 textarea 沿用 setSelection 定位
- added:
  - `src/renderer/src/components/workbench/WorkbenchFindHighlightPlugin.tsx`
- modified:
  - `src/renderer/src/components/workbench/WorkbenchEditor.tsx`
  - `src/renderer/src/components/workbench/WorkbenchFindReplaceBar.tsx`
- lesson: markdown 偏移→Lexical 选区映射用「按文档序 TextNode.getTextContent() 在 markdown 中 indexOf 顺序定位」建锚点：语法字符(# ** | ![]() frontmatter)不进入节点文本自然落在锚点间隙，匹配只命中纯文本区间；Lexical command listener 运行在 updateEditorSync 上下文，；reveal 时需 editor.focus() 让预览态原生选区高亮可见

### 16:46 | Codex

- done: 思维导图模型选择持久化：面板 dropdown 写入 mindmapPlatformId；初始/兜底逻辑改为优先使用上次保存值
- modified:
  - `src/renderer/src/components/ConversationMindmapPanel.tsx`

### 16:46 | Codex

- done: 修复工作台文件树无法复制粘贴/创建副本的问题：新增树内剪贴板状态 + Ctrl+C/Ctrl+V 键盘接管 + onCopy 捕获，右键菜单补齐'复制/粘贴/创建副本'项，复用 importExternalItems 后端复制（自动 -n 重名 + 克隆导图绑定），过滤目录复制进自身内部
- context: 用户反馈工作台无法复制文档、Ctrl+C/Ctrl+V 失效、不能创建副本
- decision: 应用内剪贴板存节点相对路径而非操作系统剪贴板（避免污染用户系统剪贴板），粘贴复用后端 importExternalPaths（本就支持工作区内路径复制+导图克隆）
- modified:
  - `src/renderer/src/components/workbench/WorkbenchFileTree.tsx`

### 16:36 | Codex

- done: 删除确认文案澄清：导图随文档删除且不可恢复，文档本身仍可从回收站还原
- context: 原文案删除后不可恢复容易被理解为文件也不可恢复
- modified:
  - `src/renderer/src/components/workbench/WorkbenchFileTree.tsx`

### 16:35 | Codex

- done: 对账映射支持连续改名：a→b→c 时沿映射链解析到最终记录，并在命中后把旧路径直接收敛到最终路径，visited 防环
- context: 生成任务持有最早路径，期间可能连续改名两次
- modified:
  - `src/main/noteManager.ts`

### 16:31 | Codex

- done: 生成期间改名改为按对账映射跟随：NoteManager 记录旧路径到新路径的映射，保存导图时据此定位改绑后的记录，替换按内容哈希回查，避免编辑过正文或同内容文档导致的误判
- decision: 跨会话/生成期间的重连都以对账产出的显式路径映射为准，不再用内容相似度兜底
- modified:
  - `src/main/noteManager.ts`
  - `.memory/KNOWLEDGE.md`

### 16:30 | Codex

- done: 补跨会话改名恢复：文件树载入时先完成对账，记录旧路径到新路径映射，启动恢复上次打开的文档时跟随新路径；映射键带工作区并有上限，避免切换工作区串味与无界增长
- context: 应用关闭期间外部改名后重启，恢复上次打开文档会失败
- modified:
  - `src/renderer/src/store/workbenchStore.ts`

### 16:26 | Codex

- done: 补生成期间文档被外部改名的保存守卫：旧来源键找不到记录时，按工作区 + 正文哈希 + size/mtime 回查改绑后的记录，唯一命中才写入，避免导图在生成完成时被丢弃
- context: 对账会把记录改绑到新路径，生成任务仍持有旧 sourceKey
- modified:
  - `src/main/noteManager.ts`

### 16:22 | Codex

- done: 工作台导图绑定最终收口：批量删除改回单次 IPC 调用、删除提示的文档数只统计真正带导图的记录、重命名同步记录标题
- context: 删除即删语义下复查批量删除路径，避免逐项调用导致重复重扫与对账
- modified:
  - `src/main/noteManager.ts`
  - `src/renderer/src/store/workbenchStore.ts`
  - `src/renderer/src/components/workbench/WorkbenchFileTree.tsx`

### 16:15 | Codex

- done: 工作台导图绑定收口：对账改为必须传入文件树索引（删除主进程自行扫盘兜底），按 size+mtime 建桶索引避免整目录删除时的平方复杂度，补充生成期间文档被删则拒绝写回的守卫，应用内改名同步记录标题
- context: 第二步性能优化的收尾：把可选兜底路径与 O(n²) 候选筛选去掉
- decision: 对账只保留一条可预测路径：索引由渲染层随文件树传入，缺失即报错而不是静默全盘扫描
- modified:
  - `src/main/noteManager.ts`
  - `src/main/ipcHandlers.ts`
  - `src/preload/index.ts`
  - `src/renderer/src/store/workbenchStore.ts`
  - `.memory/INDEX.md`
  - `.memory/KNOWLEDGE.md`

### 16:05 | Codex

- done: 工作台思维导图绑定语义收敛与性能优化：取消软删除（删除即删导图）、外部改名按 size+mtime 重连并让编辑器跟随新路径、对账复用文件树索引实现零额外 IO、保存后同步指纹但不推进快照、补充误删守卫与副本歧义保护
- context: 用户要求删除文档时导图立即删除（提示不可恢复），外部改名要重连，并关注对账性能
- decision: 取消 deletedAt/软删除与 30 天保留期，改为删除即删；对账分两阶段（先占位再改名匹配），删除前单独 stat 守卫 ENOENT
- modified:
  - `src/main/noteManager.ts`
  - `src/main/ipcHandlers.ts`
  - `src/preload/index.ts`
  - `src/renderer/src/store/workbenchStore.ts`
  - `src/renderer/src/components/workbench/WorkbenchFileTree.tsx`
  - `src/shared/types/notes.ts`
- lesson(promoted): 工作台文档与导图的绑定对账应复用文件树已扫描的 size/mtime 作为索引，避免二次遍历；外部改名与外部删除在文件系统层面不可区分，只能靠 size+mtime 唯一候选判定，多候选时必须放弃而不是猜
- unresolved: 需在 npm run dev 中手动验收：外部改名后导图重连与编辑器跟随、外部删除后导图消失、删除确认提示、复制副本克隆导图

### 16:01 | Codex

- done: 独立worker二轮审核AppIcon映射表148条按图形语义逐条核对：修正8处P0错配(rocket_launch→Rocket/build→Wrench/edit_square→SquarePen/folder_managed→FolderCog/folder_special→FolderBookmark/filter_none→SquareStack/ios_share→SquareArrowOutUpRight/select_all→SquareDashed)+3处P1(biotech→Microscope/summarize→TextQuote/bedtime→MoonStar)；方案附录记录
- modified:
  - `src/renderer/src/components/icons/AppIcon.tsx`
  - `docs/lucide-migration-plan.md`
- lesson: 图标映射审核要看图形语义非名字相似度；lucide多数material名有同形对应(Rocket/Wrench/SquarePen等)，少数需语义近似(FolderStar不存在用FolderBookmark)；有意合并项(多material名→同lucide)是合理的
- unresolved: 映射表已审定，待批准执行B1-B5分批替换

### 15:46 | Codex

- done: 工作台编辑器补 Ctrl+F/Ctrl+H 查找替换：新增 WorkbenchFindReplaceBar 浮动条，作用于 store.activeFileContent；markdown 源码/富文本、code/text 编辑/预览全接入；源码 textarea 经 setSelection 定位，code 只读/渲染预览禁用替换；附带补全 markdown 编辑器缺失的 Ctrl+S 保存
- added:
  - `src/renderer/src/components/workbench/WorkbenchFindReplaceBar.tsx`
- modified:
  - `src/renderer/src/components/workbench/WorkbenchEditor.tsx`
  - `src/renderer/src/components/workbench/WorkbenchCodePreview.tsx`
  - `src/renderer/src/components/workbench/WorkbenchSourceEditor.tsx`
- lesson: workbench 编辑器 Ctrl+F 统一走 activeFileContent 字符串查找替换：与既有全文搜索 searchFiles 口径一致、source/wysiwyg 无缝切换；富文本由 MarkdownSyncPlugin 的 isReturningToWysiwyg 路径重灌同步（不走 Lexical 坐标，避免 markdown↔AST 映射复杂度，代价是富文本模式下不可 undo）；WorkbenchSearch 是文件树全文搜索，与编辑器内查找是两个功能

### 15:37 | Codex

- done: 工作台思维导图：文档绑定、软删除、改名/复制/外部删除对账，右侧栏 AI 与导图互斥
- added:
  - `src/renderer/src/components/workbench/WorkbenchMindmapPanel.tsx`
- modified:
  - `src/shared/types/notes.ts`
  - `src/main/noteManager.ts`
  - `src/main/ipcHandlers.ts`
  - `src/main/services/MindmapService.ts`
  - `src/main/services/AutomationService.ts`
  - `src/main/services/workbenchService.ts`
  - `src/preload/index.ts`
  - `src/shared/utils/mindmap.ts`
  - `src/renderer/src/components/ConversationMindmapPanel.tsx`
  - `src/renderer/src/components/Layout.tsx`
  - `src/renderer/src/components/workbench/WorkbenchAiSidebar.tsx`
  - `src/renderer/src/components/workbench/WorkbenchFileTree.tsx`
  - `src/renderer/src/components/workbench/WorkbenchSelectionMenuPlugin.tsx`
  - `src/renderer/src/pages/WorkbenchPage.tsx`
  - `src/renderer/src/store/workbenchStore.ts`
- lesson: 工作台导图绑定走 sourceKey 派生 + 软删除(deletedAt) + 文件树刷新后对账，外部删除/还原无需拦截即可收敛；convert() 必须显式保留新增可选字段，否则读盘即丢。

### 15:36 | Codex

- done: 修复 AI 回复转 Markdown 表格多出空列：htmlToMarkdown 的 tr 分支在 td 已自带 ' | ' 收尾后再追加 ' |'，导致每行结尾 '| a | b | |' 被 Lexical TABLE_ROW_REG_EXP 解析出额外空单元格；改为 tr 只补行首管道
- context: 用户在工作台模式把 GPT/Gemini 回复插入文档，表格总是多一个空列；排查确认是转换器 bug 而非源数据
- modified:
  - `src/shared/utils/htmlToMarkdown.ts`
- lesson: htmlToMarkdown 的 td 返回 'x | ' 自带尾管道后 tr 又 ' | '+cells+' |' 包边，形成 '... | |' 双管道；tr 内 endsWith(' | ') 判断因 cells 已 trim 永不命中，清理分支失效

### 15:32 | Codex

- done: 源码模式编辑器支持 Tab/Shift+Tab 缩进
- context: 工作台 Markdown 源码编辑器
- modified:
  - `src/renderer/src/components/workbench/WorkbenchSourceEditor.tsx`

### 15:25 | Codex

- done: 编辑器并发冲突处理：saveActiveFile 落盘前 statFile 比对磁盘 mtime，dirty+外部新则置 saveStatus='conflict' 拒绝覆盖并拉回磁盘版本；handleExternalFsChanged 对 dirty 文档同样标冲突；WorkbenchStatusPill 冲突态展示磁盘内容预览 + 重载磁盘/保留我的两按钮；code/text 预览区挂载状态药丸
- decision: 不做 diff merge/文件锁：按 VS Code/Obsidian 惯例把裁决权给用户（重载磁盘版/保留我的），冲突概率低、merge 成本与出错面不成比例
- modified:
  - `src/main/services/workbenchService.ts`
  - `src/main/ipcHandlers.ts`
  - `src/preload/index.ts`
  - `src/renderer/src/store/workbenchStore.ts`
  - `src/renderer/src/components/workbench/WorkbenchStatusPill.tsx`
  - `src/renderer/src/components/workbench/WorkbenchCodePreview.tsx`
  - `src/renderer/src/components/workbench/WorkbenchEditor.tsx`
- lesson: 乐观并发：文件级冲突用 mtime 比对（statFile 轻量接口，不带全文），mtime 差>2ms 判外部更新——Windows 文件系统时间戳精度 ~1ms；进入 conflict 态后必须短路自动写盘，否则 autosave 防抖会反复触发 readFile
- unresolved: 冲突浮层展示磁盘全文（max-h-40 滚动），无 diff 视图；take-disk 是整文件覆盖

### 15:24 | Codex

- done: 实现 Obsidian 风格默认工作区：Documents/MultiChat Vault 自动创建 + 欢迎笔记 + 禁删/禁关 + 删除空状态引导页
- modified:
  - `src/main/services/workbenchService.ts`
  - `src/main/ipcHandlers.ts`
  - `src/preload/index.ts`
  - `src/renderer/src/store/workbenchStore.ts`
  - `src/renderer/src/components/workbench/WorkbenchFileTree.tsx`
  - `src/renderer/src/pages/WorkbenchPage.tsx`

### 15:16 | Codex

- done: 工作台文件树外部变更自动同步：主进程 fs.watch 递归监听 + 350ms 去抖 + 应用自写抑制，广播 workbench:fs-changed；渲染层静默重扫树并对激活文件做删除/外部改动处理
- decision: 不用增量 diff/patch 同步：事件去抖后直接 readTree 全量重扫，代价一次 IPC + readdir 递归，换来对 rename/批量移动/丢事件的最终一致性
- modified:
  - `src/main/services/workbenchService.ts`
  - `src/main/ipcHandlers.ts`
  - `src/main/index.ts`
  - `src/preload/index.ts`
  - `src/renderer/src/store/workbenchStore.ts`
- lesson: Electron 文件监听最佳实践（VS Code/chokidar 共识）：单 recursive watcher + 事件聚合去抖后整树重扫优于增量 patch（rename 成对事件、缓冲溢出会漂移）；应用自写操作用时间窗抑制回声，避免每 1.2s autosave 触发整树重扫；扫描忽略规则与 watcher 过滤必须同源（此处事件本身不解析文件名，靠重扫时 isIgnoredName 收敛）
- unresolved: dirty 文档遭遇外部改动时目前不重载不提示（保护用户编辑）；父目录外部 rename 导致激活文件路径失配时清空编辑器而不重定向新路径

### 15:09 | Codex

- done: 代码文件编辑模式补语法高亮：WorkbenchCodePreview 编辑态改为透明 textarea 叠加 highlightCodeLine 高亮层，与查看态共用高亮器
- modified:
  - `src/renderer/src/components/workbench/WorkbenchCodePreview.tsx`

### 15:08 | Codex

- done: 工作台各预览统计信息统一为右下角状态 Pill：代码预览去掉标题栏行/词/字符统计，改为悬浮 Pill 显示行数+大小；PDF/图片/DocxCard 大小(图片含尺寸)移出标题栏/卡片到编辑区右下角 Pill，样式与 Markdown StatusPill 一致
- modified:
  - `src/renderer/src/components/workbench/WorkbenchCodePreview.tsx`
  - `src/renderer/src/components/workbench/WorkbenchPdfPreview.tsx`
  - `src/renderer/src/components/workbench/WorkbenchImagePreview.tsx`
  - `src/renderer/src/components/workbench/WorkbenchDocxCard.tsx`

### 15:07 | Codex

- done: 统一工作台预览工具栏：PDF/图片/Office 文档去掉文件类型徽标，'本地应用打开'改为与代码预览一致的纯图标按钮，无高亮底色；DocxCard 顶栏补资源管理器定位图标
- modified:
  - `src/renderer/src/components/workbench/WorkbenchPdfPreview.tsx`
  - `src/renderer/src/components/workbench/WorkbenchImagePreview.tsx`
  - `src/renderer/src/components/workbench/WorkbenchDocxCard.tsx`

### 15:07 | Codex

- done: 重构工作台原型为单文件树、文档优先的统一笔记模型，答复保存/整段会话保存/选区摘录统一生成 Markdown 文档
- context: 用户反馈旧版对话与文件双标签、独立高亮数据造成交互和心智割裂
- decision: 用户可见对象只保留本地 Markdown 文档；保存单条答复、保存整段会话、选区摘录只是不同来源的建文档入口，不再设置独立高亮笔记页或标注侧栏
- added:
  - `docs/prototypes/workbench-notes-unified-v2.png`
- modified:
  - `docs/prototypes/workbench-notes-unified.html`
  - `docs/prototypes/workbench-notes-unified.png`
  - `docs/prototypes/workbench-notes-unified-1366.png`

### 14:58 | Codex

- done: 工作台 HTML 文件支持浏览器渲染预览
- context: 工作台模式下点击 HTML 文件默认进入渲染预览,像浏览器一样渲染页面,同时保留源码查看与编辑模式
- modified:
  - `src/main/services/workbenchService.ts(workbench-file:// URL 改走 pathname 承载 + readFile 对 html/htm 附带 fileUrl)`
  - `src/renderer/src/components/workbench/WorkbenchCodePreview.tsx(HTML 文件新增 渲染/源码/编辑 三态切换`
  - `iframe sandbox 渲染)`
- lesson: workbench-file:// 协议从 ?path=query 改为 /pathname 分段编码, 使 HTML 内相对路径资源(./style.css)可由 Chromium 按目录层级自然解析到同 workspace 白名单内文件; resolveWorkbenchFileRequest 保留旧 query 格式兼容 PDF 已生成 URL

### 14:51 | Codex

- done: 新增工作台统一笔记与高亮标注的高保真交互原型，并完成浏览器交互验收
- context: 用户需要先看统一工作台笔记视图的实际效果，暂不修改生产代码
- decision: 以 Markdown 文档为单一正文来源，标注采用引用、定位与评论分离的数据结构，收藏作为独立导航元数据
- added:
  - `docs/prototypes/workbench-notes-unified.html`
  - `docs/prototypes/workbench-notes-unified.png`
  - `docs/prototypes/workbench-notes-unified-1366.png`
- lesson(promoted): 自包含原型用 innerHTML 重建含 id 的子节点后，后续渲染不得继续引用旧节点

### 14:49 | Codex

- done: 插入链路不再写 conversationUrl 到 frontmatter(仅新建时带 source)
- context: 用户反馈:不希望『插入到当前文档』把对话链接写进现有文档 frontmatter,只有『存为新文档』应保留来源链接
- decision: insertReplyIntoActiveMarkdown 移除 upsertFrontmatterSource 调用,meta 参数改 _meta 标记未用;saveReplyAsNewMarkdown 保持 conversationUrl 不变
- modified:
  - `src/renderer/src/store/workbenchStore.ts`

### 14:46 | Codex

- done: wysiwyg 模式下 frontmatter 渲染为 Obsidian 式笔记属性面板
- context: 用户反馈:存为新文档已有 source frontmatter,但 wysiwyg 预览面板完全不渲染元数据;参考 Obsidian 笔记属性布局(仅样式参考非复刻)
- decision: MarkdownSyncPlugin 剥离出的 frontmatter 渲染为只读属性面板,tags→chip/URL→可点链接(经 mainWindow.setWindowOpenHandler→系统浏览器);YAML 用极简正则解析不引 js-yaml 依赖,折叠交互同 Obsidian
- added:
  - `src/renderer/src/components/workbench/FrontmatterPanel.tsx`
- modified:
  - `src/renderer/src/components/workbench/WorkbenchEditor.tsx`

### 14:38 | Codex

- done: 工作台 Markdown 源码模式下补齐顶部工具栏（格式/段落/插入/撤销重做），通过 SourceEditor 命令式 API 对 textarea 选区执行 markdown 文本操作
- added:
  - `src/renderer/src/components/workbench/WorkbenchSourceToolbar.tsx`
- modified:
  - `src/renderer/src/components/workbench/WorkbenchEditor.tsx`
  - `src/renderer/src/components/workbench/WorkbenchSourceEditor.tsx`

### 14:33 | Codex

- done: 工作台文件树支持外部文件拖入与粘贴导入（VSCode 风格）
- modified:
  - `src/main/services/workbenchService.ts`
  - `src/main/ipcHandlers.ts`
  - `src/preload/index.ts`
  - `src/renderer/src/store/workbenchStore.ts`
  - `src/renderer/src/components/workbench/WorkbenchFileTree.tsx`
- lesson(promoted): Electron 42 中 File.path 已移除，拖入/粘贴的本地路径用 window.electron.webUtils.getPathForFile 获取（@electron-toolkit/preload 的 electronAPI 已自带 webUtils）；目录拖入项也会出现在 dataTransfer.files 中，getPathForFile 返回目录路径，主进程 stat.isDirectory 区分后 fs.cp recursive 即可

### 14:30 | Codex

- done: 存为新文档补 frontmatter source 链接
- context: 用户反馈:侧边栏回复下「存为新文档」生成的文档缺 source frontmatter,设计文档要求补上;插入链路已有,save链路漏传
- decision: 复用 upsertFrontmatterSource:meta 增加 conversationUrl 透传,saveReplyAsNewMarkdown 写盘前先补 frontmatter,与 insertReplyIntoActiveMarkdown 行为对齐
- modified:
  - `src/renderer/src/store/workbenchStore.ts`
  - `src/renderer/src/components/workbench/WorkbenchAiSidebar.tsx`

### 14:28 | Codex

- done: 修复 tsc 报错（node 8 处、web 11 处）：Electron 42 移除的 webContents 'crashed' 事件删除、YAML frontmatter 值类型放宽、tsconfig.web 补 target ES2020 解决 Map 迭代 TS2802、selectors.ts 通过局部 store bridge 类型取 window.api、QuickPage ref 回调按模型缓存并补 unregister 的 ref 参数、resume 恢复草稿前判空 selectors
- context: 用户要求核验并修复 tsc 报错且避免回归
- decision: QuickPage 的 ref 回调若不缓存，每次渲染 React 会以 null 调旧回调，新增的真实注销会反复清 activeWebviewTimes，故按 modelId 缓存回调身份
- modified:
  - `src/main/summaryPrompts.ts`
  - `src/main/webviewManager.ts`
  - `tsconfig.web.json`
  - `src/renderer/src/pages/QuickPage.tsx`
  - `src/renderer/src/hooks/useWebviewLifecycle.ts`
  - `src/shared/config/selectors.ts`
- lesson: tsconfig.web.json 原先缺 target，默认 ES3/ES5 导致 for..of Map 报 TS2802；补 ES2020 与 node 侧一致，比逐个改 Array.from 更贴根因
- unresolved: npm run lint 仍有 1 个既有 error：src/renderer/src/components/icons/AppIcon.tsx:300 未使用的 eslint-disable，未在本次范围内

### 14:18 | Codex

- done: 提交本会话工作台改动为 dc808f5：图片插入/粘贴、assets 附件目录联动、未引用图片清理、AppIcon/lucide 迁移基础、回复装饰图过滤、选择器诊断；一次性分析脚本 dry.cjs 未提交
- added:
  - `docs/lucide-migration-plan.md`
  - `docs/workbench-office-preview-plan.md`
  - `src/renderer/src/components/icons/AppIcon.tsx`
  - `src/renderer/src/components/workbench/WorkbenchImageNode.tsx`
  - `src/renderer/src/components/workbench/WorkbenchImagePlugin.tsx`
- modified:
  - `src/main/index.ts`
  - `src/main/ipcHandlers.ts`
  - `src/main/services/workbenchService.ts`
  - `src/preload/index.ts`
  - `src/renderer/index.html`
  - `src/renderer/src/assets/index.css`
  - `src/renderer/src/components/**`
  - `src/renderer/src/hooks/useWebviewActions.ts`
  - `src/renderer/src/store/*.ts`
  - `src/renderer/src/utils/selectorDiagnostics.ts`
  - `src/shared/config/selectors.ts`
  - `src/shared/utils/htmlToMarkdown.ts`
  - `src/shared/utils/webviewScripts.ts`
  - `package.json`
  - `package-lock.json`
  - `SESSION_LOG.md`
  - `.memory/*`
- unresolved: dry.cjs 一次性图标扫描脚本保留在工作区未提交

### 14:16 | Codex

- done: DeepSeek 按钮位置二次修正: replyItem 改 div:has(> div.ds-message + div.ds-flex) 命中含回复+操作栏的父容器; actionBar 用 div.ds-flex:has(> div.ds-button ~ div.ds-button) 命中底部原生操作行(6个ds-button); 之前误挂'已思考'行 _5ab5d64
- modified:
  - `src/shared/config/selectors.ts`

### 14:11 | Codex

- done: DeepSeek 按钮位置修正: replyItem 改 div.ds-message(整轮),actionBar 用 div:has(> div.ds-icon ~ div.ds-icon)命中回复顶部原生操作栏,contentItem 缩到 ds-markdown.ds-assistant-message-main-content; observer 存实例支持 disconnect 防 SPA 内重复注入
- modified:
  - `src/shared/utils/webviewScripts.ts`
  - `src/shared/config/selectors.ts`
- lesson: DeepSeek 回复操作栏在回复块顶部(think-content上方)非底部,按钮是 div.ds-icon 非 ds-button; 平台 hash 类全失效时用 :has(> X ~ X)结构选择器定位比记 hash 稳

### 14:00 | Codex

- done: DeepSeek 注入循环修复: fallback bar 复用已有不再重复新建,幂等检查区分 createBar 平台; 新增 deepseek 配置(replyItem=ds-markdown.ds-assistant-message-main-content+createBar); 按钮尺寸改 CFG.btnSize/iconSize 可调(Gemini 34/18 其余 30/16); 修复 fallback 迁移时按钮顺序反转
- modified:
  - `src/shared/utils/webviewScripts.ts`
  - `src/shared/config/selectors.ts`
- lesson: 注入 fallback bar 必须先查 replyEl 内是否已有可复用的,否则 MutationObserver 每次 scan 都 append 导致无限循环(DeepSeek 实测 2412 个); 幂等判断要区分『有原生 bar 待迁移』和『本就无原生 bar』两种情况

### 13:56 | Codex

- done: 独立worker评审Lucide迁移方案并修正：补draft漏映射(FileSignature)；AppIcon加data-icon/verticalAlign:middle/strokeWidth默认2.2/兜底改AlertTriangle；方案文档同步P0/P1修正(替换锚点=渲染span、CSS font-size失效、verify断言改svg[data-icon])
- modified:
  - `src/renderer/src/components/icons/AppIcon.tsx`
  - `docs/lucide-migration-plan.md`
- lesson: icon字体迁移坑：object-map的icon:字段是定义行不是渲染点，间接模式(getNodeIcon().icon)要改渲染span；verify脚本靠inner_text断言图标名，迁SVG必须改data-icon属性；Lucide线稿比Material填充偏细需strokeWidth校准+verticalAlign:middle对齐基线
- unresolved: 方案+组件就绪待批准执行B1-B5分批替换

### 13:54 | Codex

- done: Material→Lucide迁移评估+方案+映射组件+干跑分析：建AppIcon.tsx封装(147图标静态映射)，docs/lucide-migration-plan.md开发方案，lucide-react@1.76.0已装待替换
- context: material-symbols字体3.86MB占renderer产物32.8%；51文件~290静态span/49动态/65 object-map
- added:
  - `src/renderer/src/components/icons/AppIcon.tsx`
  - `docs/lucide-migration-plan.md`
- modified:
  - `package.json`
  - `package-lock.json`
- lesson: icon:/iconName:字段混有业务token(success/asc/updated等)与CSS visibility，不能按名字纯文本批量替换；静态映射表保tree-shaking优于运行时名转换
- unresolved: 独立worker评审中；待批准后按B1-B5分批替换

### 13:49 | Codex

- done: 修复工作台回复按钮注入: Gemini Trusted Types CSP 拦 innerHTML/DOMParser 致按钮静默失败改 createElementNS; ChatGPT actionBar 误挂用户气泡行改限定 actionRow 容器; 提取内容克隆清洗剥掉 sr-only 说话人标签和操作按钮
- modified:
  - `src/shared/utils/webviewScripts.ts`
  - `src/shared/config/selectors.ts`
  - `src/main/index.ts`
- lesson: Gemini/ChatGPT 等高 CSP 平台禁止 innerHTML/DOMParser 字符串→DOM,注入 UI 必须 createElementNS 程序化构建; ChatGPT 一轮有用户行+AI行两个 turn-action-controls 需按 actionRow 类名区分; 平台 sr-only 说话人标签(你说:/ChatGPT 说:)会被 htmlToMarkdown 当正文,提取前须克隆清洗
- unresolved: dev 实例已验证 Gemini+ChatGPT 注入位置与提取纯度; 豆包/元宝/千问未实机复验(选择器按先前 DOM 调查已配 userItemMarker/--ai 限定,建议用户在真实平台各发一条验证)

### 13:41 | Codex

- done: 修复工作台 Markdown 编辑器文字粘贴失效：WorkbenchImagePlugin 的 PASTE/DROP_COMMAND 处理器无论剪贴板内容均返回 true，高优先级吞掉默认粘贴；改为同步检查有无图片文件后再决定是否拦截
- modified:
  - `src/renderer/src/components/workbench/WorkbenchImagePlugin.tsx`
- lesson: Lexical registerCommand 返回值决定处理器是否继续执行；注册为 COMMAND_PRIORITY_HIGH 的异步处理器必须在同步阶段先判断再返回，否则会无条件吞掉后续所有默认处理

### 13:06 | Codex

- done: 修复 workbench Markdown 预览表格过窄：表格改 auto layout+100%宽，单元格 75px 改 min-width
- modified:
  - `src/renderer/src/assets/index.css`
- lesson: Lexical TableCellNode 在无 colWidths 时内联 width:75px，配 table-layout:fixed+fit-content 会把 md 表格压成一列；渲染层用 table-layout:auto+width:100%+单元格 min-width 即可自适应，内联 75px 只作下限不阻塞分配

### 13:02 | Codex

- done: 修复工作台回复按钮注入三处 bug：ChatGPT 提取含用户消息、豆包按钮挂用户气泡、Gemini 按钮不可见
- context: 上会话已修过一轮去重/hover，本会话用户实测回报三平台仍有问题，用 iab 实 DOM 验证定位
- decision: AssistantReplyConfig 新增 contentItem（整轮容器内取 AI 正文块）与 userItemMarker（用户消息特征跳过）；bar 定位上爬限高 56px 防止爬进块级 footer（Gemini）；豆包靠 message_action_edit 区分用户/AI
- modified:
  - `src/shared/config/selectors.ts`
  - `src/shared/utils/webviewScripts.ts`
- lesson(promoted): 豆包用户消息与 AI 回复共用 w-full pl-14 和 message-action-bar，判别特征是操作栏内 message_action_edit（用户）vs message_action_like/dislike（AI）；ChatGPT 一轮对话是单 .group 容器含用户气泡+AI 正文，AI 正文用 [data-chatgpt-search-unit-key$=:assistant]；Gemini buttons-container-v2 的父级是 block footer，bar 上爬必须限高

### 12:47 | Codex

- done: 修复撤回后无法重试插入bug:lastInsertHash用===永久记录replyHash,撤回/采纳后重试同一条回复被永久跳过;改为{hash,at}时间窗防抖(1.5s内同payload双击跳过,撤回/采纳后重试必然超窗允许)
- modified:
  - `src/renderer/src/components/workbench/WorkbenchAiSidebar.tsx`
- lesson: 防重复防抖要用时间窗而非永久标记;采纳/撤回在Lexical内部完成、sidebar无感知,防双击与'允许重试'的边界只能按时间而非状态划分

### 12:45 | Codex

- done: 内置浏览器逐一核验并修复工作台'回复插入'按钮注入点：豆包 replyItem 加 :has(message-action-bar) 限定+actionBar 换失效 hash 为语义类；元宝 replyItem 限定 --ai 变体+actionBar 换 toolbar__right；ChatGPT replyItem/actionBar 全换（data-message-author-role 已失效→turn-action-controls）；千问 replyItem 换 message-select-wrapper-answer（区分 question/answer）；findReplyItems 兜底 firstMatch→lastMatch
- modified:
  - `src/shared/config/selectors.ts`
  - `src/shared/utils/webviewScripts.ts`
- lesson: 各平台 replyItem/actionBar 选器全量失效（hash 类名 actionButton-m1fXIC/ToolbarCopy_icon__5Odjl/data-message-author-role 都变了）；iab 内置浏览器登录态独立：豆包/元宝/Gemini/ChatGPT/千问/Grok(部分)可核验，DeepSeek/Kimi/Claude/文心/智谱/Perplexity/Arena 未登录或验证码拦截；通用注入选器要用 :has() 区分用户/AI 气泡，避免把按钮挂到用户消息下
- unresolved: DeepSeek/Kimi/Claude/Grok/文心/智谱/Perplexity/Arena 无法在 iab 核验（未登录）；Grok 全 CSS-in-JS 混淆类无语义选器可用，维持兜底

### 12:34 | Codex

- done: 修复主页面模式切换设置不生效：normalizeProductModeConfig 中 hidden 数组在自身 filter 回调里被引用（TDZ ReferenceError），导致隐藏非空时整个 set 抛错回退；改为 forEach 累加写法
- modified:
  - `src/renderer/src/store/appStore.ts`
  - `src/renderer/src/components/ProductModeOrderModal.tsx`
- lesson: 数组常量在其自身 .filter/.map 回调里被引用会触发 TDZ ReferenceError 且只在数据非空时暴露；去重场景改用 forEach+累加数组

### 12:22 | Codex

- done: 修复工作台'回复插入'按钮重复注入与错位：findReplyItems 去重嵌套 replyItem（元宝同回复外层气泡+内层 markdown 各挂一组→6组），ensureButtons 加 DOM 级幂等（.mc-workbench-btn 存在即跳过），bar 定位收紧为横向单行按钮行（flex row/h≤48/textLen<30，避免 prepend 到回复卡顶部），按钮 hover 加灰色背景
- modified:
  - `src/shared/utils/webviewScripts.ts`
  - `src/renderer/src/utils/selectorDiagnostics.ts`
  - `src/renderer/src/hooks/useWebviewActions.ts`
  - `src/renderer/src/components/WebviewCard.tsx`
- lesson: webview 内嵌页面可用 CUA getAXState 直接读（Electron webview 暴露给 a11y tree）；元宝 replyItem 选器命中嵌套容器导致重复注入，须按 contains 去重取最外层；bar 定位不能只看'含≥2交互子元素'，回复卡本身满足该条件会错位
- unresolved: probeActionBar 探针已挂到 WebviewCardRef（与 probeMessageContainer 同族 dev 诊断能力），未接 UI；其他平台（kimi/deepseek/claude/grok/yiyan 等未配置 assistantReplyConfigs 走 createBar 兜底）注入位置未逐一真机核验

### 12:13 | Codex

- done: 工作台删除当前打开文件后自动切换到排序上的相邻文件（先向后再向前），删除包含当前文件的目录同样生效；无剩余文件才显示空状态
- context: 用户反馈：删除当前打开的笔记后出现'未打开任何文档'空状态，希望自动打开下一个文件
- decision: 删除前按 fileSort 排序拍平文件树预取后继者，删除成功并 loadFileTree 后调用 openFile 切换；openFile 内部处理了 dirty 刷盘与 lastActiveFilePath 持久化
- lesson(promoted): tsconfig.web.json 缺少 target 导致存量 TS2802 等 12 个类型错误，验证时以"错误清单未新增"为准（已并入 KNOWLEDGE 主题12）
- modified:
  - `src/renderer/src/store/workbenchStore.ts`

### 12:11 | Codex

- done: 设置面板新增'主页面模式切换'自定义：4 个模式（多AI/任务分配/辩论/工作台）支持拖拽排序、上下移、显隐开关，至少保留两个可见；配置持久化到 productModeConfig 键，当前模式被隐藏时自动回落第一个可见模式
- added:
  - `src/renderer/src/components/ProductModeOrderModal.tsx`
- modified:
  - `src/renderer/src/store/appStore.ts`
  - `src/renderer/src/components/Layout.tsx`
  - `src/renderer/src/components/SettingsDrawer.tsx`
- lesson: ProductMode 分 tab 显示/排序配置可走 electron-store 单键（order+hidden），normalize 时按 ALL_PRODUCT_MODES 白名单过滤并保证≥2 可见

### 12:09 | Codex

- done: v4增量：插入到光标上次停留处(lastAnchorRef序列化锚点+isAttached校验,失效时selectEnd兜底)+待确认高亮PendingInsertNode容器(非黄淡蓝,含PendingBarNode装饰器✓采纳/✗撤回)+失效修复(先saveActiveFile清dirty再经Lexical editor.update内部插入,消除双向回写竞争)+新文档名=对话名重名-2/-3+frontmatter补source链接+actionBar挂载改向上找含≥2按钮容器prepend+insert图标换落笔
- decision: MarkNode isInline=true跨不了block,改PendingInsertNode Element容器一处解决高亮+撤回;;frontmatter归store层管body归Lexical
- added:
  - `src/renderer/src/components/workbench/PendingInsertNode.tsx`
  - `src/renderer/src/components/workbench/PendingBarNode.tsx`
- modified:
  - `src/renderer/src/components/workbench/MarkdownSyncPlugin.tsx`
  - `src/renderer/src/components/workbench/WorkbenchEditor.tsx`
  - `src/renderer/src/store/workbenchStore.ts`
  - `src/renderer/src/components/workbench/WorkbenchAiSidebar.tsx`
  - `src/shared/utils/webviewScripts.ts`
  - `src/renderer/src/assets/index.css`
  - `docs/reply-insert-into-workbench-design.md`
- lesson: Lexical 0.53自定义ElementNode/DecoratorNode: exportJSON需兼容compact overload,SerializedXNode直接用基类型勿用Spread<Record<string,never>>否则type/version推成never;ElementNode容器法比MarkNode更适合跨block临时高亮

### 12:08 | Antigravity

- done: 移除工作台内容区域最外层容器的半透明暗背景，使页面底部渐变背景直接通透呈现
- modified:
  - `src/renderer/src/pages/WorkbenchPage.tsx`

### 12:02 | Codex

- done: 修复工作台侧边栏无法切换到未启用模型（DeepSeek/元宝等）的问题
- modified:
  - `src/renderer/src/components/workbench/WorkbenchAiSidebar.tsx`
- lesson: 侧边栏为 isolated 隔离场景，切换目标需与下拉选项一致使用全量 models；若沿用主界面 enabled 过滤，选中未启用模型时 webview 不挂载、currentModel 回退到首个 enabled 模型，表现为点击无效

### 12:01 | Codex

- done: 工作台模式：为中间编辑区顶部两角、右侧 AI 侧栏左上角加适中圆角(rounded-xl)，新增外层灰色衬底容器使圆角可见
- context: 用户截图红框标注三处角需圆角，圆角不要太大
- decision: 用 bg-black/[0.03] 外层衬底 + rounded-xl + 补边框/bg，圆角自然且不影响 webview 内容
- modified:
  - `src/renderer/src/pages/WorkbenchPage.tsx`

### 11:45 | Codex

- done: 实现工作台 AI 回复一键插入 Markdown：selectors.ts 新增 assistantReplyConfigs(chatgpt/gemini/qwen/doubao/yuanbao)；webviewScripts.ts 新增 generateInsertReplyButtonScript(MutationObserver 幂等挂两按钮,console.log __MC_前缀回传)；WebviewCardRef 新增 getWebview() 只读访问器;WorkbenchAiSidebar 注入脚本+console-message 监听(仅此模式注入,其他模式零感知);workbenchStore 新增 insertReplyIntoActiveMarkdown(仅.md追加落盘)/saveReplyAsNewMarkdown(平台-时间戳.md 自动打开)；主窗口 minWidth 900→1100 防工作台三栏挤压
- decision: 回传通道=console-message(webview无preload);只WorkbenchAiSidebar注入其他模式零感知;插入仅markdown类文件
- added:
  - `docs/reply-action-dom/*.md`
- modified:
  - `src/shared/config/selectors.ts`
  - `src/shared/utils/webviewScripts.ts`
  - `src/renderer/src/components/WebviewCard.tsx`
  - `src/renderer/src/hooks/useWebviewActions.ts`
  - `src/renderer/src/components/workbench/WorkbenchAiSidebar.tsx`
  - `src/renderer/src/store/workbenchStore.ts`
  - `src/main/webviewManager.ts`
  - `docs/reply-insert-into-workbench-design.md`
- unresolved: 8家未登录平台选择器待补;dev实机验证按钮出现/插入/存新待跑

### 11:45 | Codex

- done: 修复工作台小窗口下两侧分隔条无法拖拽问题（webview 原生层遮挡命中）；中栏最小宽 360→480；字数/保存状态从工具栏移至编辑区右下角悬浮胶囊（WYSIWYG 与源码模式共用）
- added:
  - `src/renderer/src/components/workbench/WorkbenchStatusPill.tsx`
- modified:
  - `src/renderer/src/pages/WorkbenchPage.tsx`
  - `src/renderer/src/components/workbench/WorkbenchEditor.tsx`
  - `src/renderer/src/components/workbench/WorkbenchToolbar.tsx`
- lesson: Electron <webview> 是原生插件层，会遮挡相邻 DOM 的指针命中；分隔条需要足够大的命中区域并在拖拽时用全屏透明遮罩接管事件

### 11:38 | Codex

- done: 文件树代码文件图标改用 vscode-material-icon-theme 官方 SVG；非代码文件还原 Material Symbols
- added:
  - `src/renderer/src/components/workbench/FileTypeIcon.tsx`
  - `src/renderer/src/assets/file-icons/*.svg`
- modified:
  - `src/renderer/src/components/workbench/WorkbenchFileTree.tsx`

### 11:38 | Codex

- done: 工作台左栏最小宽度 180→260px，容纳头部全部 7 个图标（搜索/新建笔记/新建文件夹/排序/折叠全部/刷新/收起侧边栏），防止最小宽度下图标被挤出
- modified:
  - `src/renderer/src/store/workbenchStore.ts`

### 11:34 | Codex

- done: 工作台文件树图标改为 Seti/VSCode 风格 SVG 图标组件，按语言/格式区分
- added:
  - `src/renderer/src/components/workbench/FileTypeIcon.tsx`
- modified:
  - `src/renderer/src/components/workbench/WorkbenchFileTree.tsx`

### 11:33 | Codex

- done: 用户澄清 DOM 探针只能在 Codex 内置浏览器 IAB 执行，不可探测 MultiChat 应用内 webview;核查 tracked diff 均为工作台既有功能(文件树拖拽/多选/Office预览/窗口拖动修复)与SESSION_LOG记录一致，src/ 下无探针残留代码，无需代码撤回;docs/reply-action-dom 五家探针文档与设计文档保留
- context: 已探5家: chatgpt/gemini/qwen/doubao/yuanbao;未登录8家走通用回退
- decision: DOM探索通道=IAB而非应用内webvieview

### 11:32 | Codex

- done: 工作台文件树多选（VSCode风格）：Ctrl/Cmd 切换、Shift 从锚点范围选（基于当前展开态扁平化），普通点击单选并打开/折叠，选中态底色高亮；拖拽整组移动、右键未选中项先单选、多选批量删除（数量确认弹窗）；新建位置跟随最后一个选中项（anchorPath）
- decision: selectedPaths/anchorPath 为组件本地 state（不入 zustand），范围选择基于 flatVisibleNodes 保证只覆盖可见项
- modified:
  - `src/renderer/src/components/workbench/WorkbenchFileTree.tsx`

### 11:30 | Codex

- done: 工作台文件识别扩展：Excel/PPT/ODF/RTF 等 Office 格式纳入 document 类别
- modified:
  - `src/shared/types/workbench.ts`
  - `src/main/services/workbenchService.ts`
  - `src/renderer/src/components/workbench/WorkbenchFileTree.tsx`
  - `src/renderer/src/components/workbench/WorkbenchDocxCard.tsx`

### 11:28 | Codex

- done: 工作台文件树：新增拖拽移动（文件/文件夹拖到目录上归位、拖到文件上入其父目录、拖到空白回根目录，目标目录高亮+自动展开，循环嵌套与原地拖放防护，复用 renameNode 同步 activeFilePath）；新建位置跟随选中文件父目录（activeFilePath）
- decision: 拖拽移动复用既有 workbench:rename-node IPC 实现跨目录移动，无新增 IPC；拖到文件上等价归入其父目录（VSCode 行为）
- modified:
  - `src/renderer/src/components/workbench/WorkbenchFileTree.tsx`
  - `src/renderer/src/store/workbenchStore.ts`

### 11:26 | Codex

- done: 修复自绘标题栏拖动飞出屏幕：首个 drag-move 时无条件重置 startContentBounds 导致窗口漂移出屏；改为仅在最大化还原那一帧重置基准并更新 startMousePoint，非最大化拖动恢复原逻辑
- modified:
  - `src/main/ipcHandlers.ts`
- lesson: 对拖动基准点（startMousePoint/startContentBounds）的写操作要严格限定在状态转换的那一帧；每帧无条件重置会破坏 delta 语义，窗口以帧数×位移漂移出屏

### 11:23 | Codex

- done: 修复最大化状态下单击标题栏空白误还原窗口：restoreCustomMaximizedWindowForDrag 从 window-drag-start 移到首次 window-drag-move，最大化时只有实际拖动才还原（对齐原生行为）
- modified:
  - `src/main/ipcHandlers.ts`
- lesson: 自绘窗口拖动链路上 mousedown 不等于拖动开始；最大化还原、窗口尺寸变化等副作用应挂在首个 move 事件上

### 11:22 | Codex

- done: 工作台侧边栏交互优化：新建文件/文件夹改为树内联输入框（VSCode风格，右键文件→其父目录、文件夹→其内部、空白→根目录，Enter/失焦提交、Esc取消），新增文件树排序菜单（名称/修改时间/大小 + 升降序），排序偏好持久化到 electron-store
- decision: 排序放 renderer 端对已有 fileTree 重排，主进程 readTree 排序保留作为默认顺序，避免改 IPC 契约
- modified:
  - `src/renderer/src/components/workbench/WorkbenchFileTree.tsx`
  - `src/renderer/src/store/workbenchStore.ts`

### 11:14 | Codex

- done: 统一 AI 侧边栏折叠按钮:WorkbenchAiSidebar 内部按钮改 QuickPage 风(w-7 h-7 rounded-full + text-base + right_panel_close),Layout.tsx 三处标题栏按钮图标由 dock_to_right/vertical_split 改为 right_panel_open/right_panel_close,与左栏 left_panel_open/close 同系列
- modified:
  - `src/renderer/src/components/Layout.tsx`
  - `src/renderer/src/components/workbench/WorkbenchAiSidebar.tsx`

### 11:13 | Codex

- done: 工作台侧边栏视觉对齐 QuickPage:折叠/展开图标换为 left_panel_close/left_panel_open+w-7 h-7 rounded-full 风格,header 高度 h-10→h-12 与中间编辑区统一,图标 text-[19px]→text-[20px],移除顶部工作区名,其他按钮左对齐折叠按钮单独靠右,最外层容器去背景与模糊
- modified:
  - `src/renderer/src/components/workbench/WorkbenchFileTree.tsx`
  - `src/renderer/src/components/workbench/WorkbenchToolbar.tsx`
  - `src/renderer/src/components/workbench/WorkbenchEditor.tsx`

### 11:12 | Codex

- done: 工作台分割线：2px 改细一档，颜色 #9ca3af→#b9bfc7，保持比标题线重的层级但不过重
- modified:
  - `src/renderer/src/assets/index.css`
  - `docs/workbench-lexical-playground-parity.md`

### 11:08 | Codex

- done: 工作台分割线：移植 playground HR transformer(triggerOnEnter+末尾insertBefore)，主题分隔线加粗至3px
- modified:
  - `src/renderer/src/components/workbench/MarkdownSyncPlugin.tsx`
  - `src/renderer/src/assets/index.css`
  - `docs/workbench-lexical-playground-parity.md`

### 11:06 | Codex

- done: 工作台左栏改为可折叠侧边栏+底部仓库管理入口:顶部 close 改为折叠按钮,底部新增 Obsidian 风格的当前仓库条(点击上弹最近工作区+管理仓库),管理弹窗支持切换/移除/选择新文件夹/关闭工作区;折叠后展开按钮嵌入中间工具栏最左(富文本+源码模式);store 新增 recentWorkspaces 持久化
- modified:
  - `src/renderer/src/store/workbenchStore.ts`
  - `src/renderer/src/components/workbench/WorkbenchFileTree.tsx`
  - `src/renderer/src/components/workbench/WorkbenchToolbar.tsx`
  - `src/renderer/src/components/workbench/WorkbenchEditor.tsx`

### 10:57 | Codex

- done: 工作台第六轮：段落格式下拉/表格操作菜单/浮动条定位由useEffect改useLayoutEffect+去掉animate-in入场动画(修复菜单先闪现页面顶部再瞬移的跳动)；标题层级按typographic scale调整(h1=28/h2=22/h3=18/h4+=16全部加粗)并加段前间距与首标题豁免
- modified:
  - `src/renderer/src/components/workbench/WorkbenchDropDown.tsx`
  - `src/renderer/src/components/workbench/WorkbenchTableActionMenuPlugin.tsx`
  - `src/renderer/src/components/workbench/WorkbenchFloatingToolbarPlugin.tsx`
  - `src/renderer/src/assets/index.css`
  - `docs/workbench-lexical-playground-parity.md`

### 10:56 | Codex

- done: 工作台第五轮：表格GFM双向序列化(移植playground TABLE transformer进MarkdownSyncPlugin)、新增WorkbenchTableActionMenuPlugin单元格角标菜单(插删行列/合并拆分/表头/斑马纹)
- added:
  - `src/renderer/src/components/workbench/WorkbenchTableActionMenuPlugin.tsx`
- modified:
  - `src/renderer/src/components/workbench/MarkdownSyncPlugin.tsx`
  - `src/renderer/src/components/workbench/WorkbenchEditor.tsx`
  - `src/renderer/src/assets/index.css`
  - `docs/workbench-lexical-playground-parity.md`

### 10:48 | Codex

- done: 工作台第四轮：标题加粗分级+h1/h2浅色下边框、无序列表圆点修复(disc+ulDepth)、代码块/行内代码加圆角、新增highlight高亮格式(toolbar+浮动条+主题类)、源码模式改为行号+Prism markdown高亮的WorkbenchSourceEditor并删返回按钮、'已保存'改灰字
- added:
  - `src/renderer/src/components/workbench/WorkbenchSourceEditor.tsx`
  - `src/renderer/src/types/prismjs.d.ts`
- modified:
  - `src/renderer/src/components/workbench/WorkbenchEditor.tsx`
  - `src/renderer/src/components/workbench/WorkbenchToolbar.tsx`
  - `src/renderer/src/components/workbench/WorkbenchFloatingToolbarPlugin.tsx`
  - `src/renderer/src/assets/index.css`
  - `docs/workbench-lexical-playground-parity.md`

### 10:38 | Codex

- done: 工作台第三轮：渲染主题整体换为 playground PlaygroundEditorTheme（段落/标题/引用/代码/列表/表格/分割线/行内格式全套类名+样式写入 index.css）、移植 TableCellResizer 单元格行列拖拽调整、'+'菜单去掉筛选输入框
- added:
  - `src/renderer/src/components/workbench/WorkbenchTableCellResizerPlugin.tsx`
- modified:
  - `src/renderer/src/components/workbench/WorkbenchEditor.tsx`
  - `src/renderer/src/components/workbench/WorkbenchDraggableBlockPlugin.tsx`
  - `src/renderer/src/assets/index.css`
  - `docs/workbench-lexical-playground-parity.md`

### 10:23 | Codex

- done: 工作台第二轮：拖拽 handle 加 '+' 按钮+组件选择菜单（移植 playground DraggableBlockPlugin/ComponentPickerPlugin）、富文本/源码改预览/源码、编辑器与左侧文件树整体 UI 放大
- added:
  - `src/renderer/src/components/workbench/WorkbenchDraggableBlockPlugin.tsx`
- modified:
  - `src/renderer/src/components/workbench/WorkbenchEditor.tsx`
  - `src/renderer/src/components/workbench/WorkbenchToolbar.tsx`
  - `src/renderer/src/components/workbench/WorkbenchFileTree.tsx`
  - `src/renderer/src/components/workbench/WorkbenchDropDown.tsx`
  - `src/renderer/src/components/workbench/WorkbenchFloatingToolbarPlugin.tsx`
  - `src/renderer/src/components/workbench/WorkbenchSelectionMenuPlugin.tsx`
  - `src/renderer/src/components/workbench/WorkbenchSearch.tsx`
  - `src/renderer/src/components/workbench/WorkbenchAiSidebar.tsx`
  - `src/renderer/src/components/workbench/WorkbenchDocxCard.tsx`
  - `src/renderer/src/components/workbench/WorkbenchImagePreview.tsx`
  - `src/renderer/src/components/workbench/WorkbenchPdfPreview.tsx`
  - `src/renderer/src/components/workbench/WorkbenchCodePreview.tsx`
  - `docs/workbench-lexical-playground-parity.md`

### 10:15 | Codex

- done: 修拆解无返回：严格 <task_split> 包络解析失败时退到 parseSubtasksLenient 逐 <subtask> 兜底（平台回显/松包裹场景）；<subtask> 标签正则容空格
- modified:
  - `src/shared/utils/taskSplit.ts`
  - `src/main/services/TaskSplitService.ts`
- unresolved: DeepSeek 后台拆解端到端仍需 npm run dev 实测确认

### 10:11 | Codex

- done: 删拆解弹窗，平台选择器改为控制条内联 CustomDropdown（direction=up、全部 models、持久化 apiConfig.taskSplitPlatform），拆分左右加「查看网页/取消」；useTaskSplit 暴露 task 状态与 trim 对齐
- modified:
  - `src/renderer/src/components/modes/TaskModePanel.tsx`
  - `src/renderer/src/hooks/useTaskSplit.ts`
- removed:
  - `src/renderer/src/components/modes/TaskSplitModal.tsx`

### 10:07 | Codex

- done: 工作台编辑器对齐 Lexical Playground：下拉 portal 化防裁剪、工具栏状态回显与 toggle 语义、新增选中浮动格式条、移除手动保存改为纯防抖自动保存
- context: playground 源码 packages/lexical-playground (meta/lexical) 已 sparse checkout 到 %TEMP%\lexical-repo
- added:
  - `src/renderer/src/components/workbench/WorkbenchDropDown.tsx`
  - `src/renderer/src/components/workbench/WorkbenchFloatingToolbarPlugin.tsx`
  - `docs/workbench-lexical-playground-parity.md`
- modified:
  - `src/renderer/src/components/workbench/WorkbenchToolbar.tsx`
  - `src/renderer/src/components/workbench/WorkbenchEditor.tsx`
- lesson: Electron 工具栏下拉要复刻 playground 必须用 createPortal+fixed 到 body，不能用 absolute 塞在 overflow-x-auto 容器里

### 10:03 | Codex

- done: 修任务拆解两处：平台下拉复用 webview 顶部样式（renderButton/renderOption logo+名称）、放开全部 models 不再限 enabled；确认 tasksplit:start 未注册是主进程未重启的 HMR 现象
- modified:
  - `src/renderer/src/components/modes/TaskSplitModal.tsx`
  - `src/renderer/src/components/modes/TaskModePanel.tsx`
- lesson: Electron 改主进程 IPC 后必须重启 npm run dev/electron，HMR 只热渲染层，preload/主进程不生效——报 'No handler registered' 先想到重启而非代码缺失

### 09:53 | Codex

- done: 按设计文档落地任务拆解后台 Web AI：TaskSplitService+tasksplit:*IPC+<task_split>XML输出+三态解析；删 API 模式全部链路（供应商/模型/IPC/弹层/迁移）；lint 0 errors、build 通过
- added:
  - `src/main/services/TaskSplitService.ts`
  - `src/shared/utils/taskSplit.ts`
  - `src/shared/types/taskSplit.ts`
- modified:
  - `src/main/ipcHandlers.ts`
  - `src/preload/index.ts`
  - `src/renderer/src/hooks/useTaskSplit.ts`
  - `src/renderer/src/components/modes/TaskSplitModal.tsx`
  - `src/renderer/src/components/modes/TaskModePanel.tsx`
  - `src/renderer/src/components/SettingsDrawer.tsx`
  - `src/renderer/src/store/appStore.ts`
  - `src/shared/utils/webviewScripts.ts`
  - `src/renderer/src/components/ImportCacheConfirmModal.tsx`
  - `docs/task-split-web-backend-design.md`
- removed:
  - `src/main/api/taskSplitApi.ts`
  - `src/main/config/requestBodyConfig.ts`
  - `src/main/config/taskSplitPrompt.ts`
- unresolved: npm run dev 手动验证未做：后台拆解端到端（登录态、<task_split>解析、取消/查看网页）需真实平台确认

### 09:44 | Codex

- done: 按独立评审修订拆解设计方案：输出格式由 JSON 改为 <task_split><subtask> 标签、补三态解析与 goal+taskId 双校验；原型标注子任务可编辑
- modified:
  - `docs/task-split-web-backend-design.md`
  - `docs/prototypes/task-split-web.html`

### 09:28 | Codex

- done: 设计任务拆解改走后台 Web AI 的方案：TaskSplitService 仿 MindmapService，删除 API 模式；交付设计文档与高保真 HTML 原型（沿用现有控制条/弹层形态）
- added:
  - `docs/task-split-web-backend-design.md`
  - `docs/prototypes/task-split-web.html`

### 09:25 | Antigravity

- done: 将 add_workbench_markdown_knowledge_base 分支合并至主分支 main，完成依赖同步与全量打包验证，并清理该 worktree

### 02:14 | Antigravity

- done: 修复工作台多格式预览(代码/图片/PDF/DOCX)致命写盘覆盖Bug、超大文件防御降级与代码语法高亮优化
- decision: 保持DOCX零生产依赖决策，以专属元信息卡片呈现并提供系统默认办公软件一键打开；对超大图片(>20MB)、超大PDF(>50MB)与大代码(>5MB)采用友好降级卡片替代Toast报错阻断
- modified:
  - `src/shared/types/workbench.ts`
  - `src/main/services/workbenchService.ts`
  - `src/renderer/src/store/workbenchStore.ts`
  - `src/renderer/src/components/workbench/WorkbenchEditor.tsx`
  - `src/renderer/src/components/workbench/WorkbenchImagePreview.tsx`
  - `src/renderer/src/components/workbench/WorkbenchPdfPreview.tsx`
  - `src/renderer/src/components/workbench/WorkbenchCodePreview.tsx`
  - `src/renderer/src/components/workbench/WorkbenchFileTree.tsx`
  - `scripts/verify_workbench_previews.py`
- lesson(promoted): 在扩展编辑器支持只读或二进制文件（图片/PDF/Word）时，必须严格在 store、UI 全局快捷键与主进程文件写入三层严密拦截写盘调用，否则 Ctrl+S 会将空文本写入二进制文件造成不可逆数据破坏；此外，文件预览组件必须带有 key={activeFilePath} 确保文件切换时重置缩放旋转与编辑等局部状态

### 01:52 | Antigravity

- done: 支持工作台代码、图片、PDF预览及同系列专属图标，完成DOCX依赖评估与卡片集成
- decision: DOCX渲染需引入ZIP解压与OpenXML解析重型依赖(mammoth/docx-preview)，不宜静默引入；采用专属Word卡片与1-click系统默认程序打开方案
- added:
  - `src/renderer/src/components/workbench/WorkbenchCodePreview.tsx`
  - `src/renderer/src/components/workbench/WorkbenchImagePreview.tsx`
  - `src/renderer/src/components/workbench/WorkbenchPdfPreview.tsx`
  - `src/renderer/src/components/workbench/WorkbenchDocxCard.tsx`
  - `scripts/verify_workbench_previews.py`
- modified:
  - `src/shared/types/workbench.ts`
  - `src/main/services/workbenchService.ts`
  - `src/main/ipcHandlers.ts`
  - `src/preload/index.ts`
  - `src/main/webviewManager.ts`
  - `src/renderer/src/store/workbenchStore.ts`
  - `src/renderer/src/components/workbench/WorkbenchFileTree.tsx`
  - `src/renderer/src/components/workbench/WorkbenchEditor.tsx`
- lesson: 文件树图标使用Material Symbols统一体系可避免引入外部图标包；二进制文件通过Base64 DataUrl经IPC传递到Renderer可规避Chromium跨协议file://安全拦截

### 01:31 | Antigravity

- done: 修复工作台DraggableBlockPlugin文字块拖拽handle未绑定ref、侧边栏折叠销毁Webview导致状态丢失、分割线HR Markdown转换缺失及Splitter拖拽被Webview拦截问题，并通过Playwright完成完整前端网页验收
- added:
  - `scripts/verify_workbench_frontend.py`
  - `workbench_verified.png`
- modified:
  - `src/renderer/src/components/workbench/WorkbenchEditor.tsx`
  - `src/renderer/src/components/workbench/WorkbenchAiSidebar.tsx`
  - `src/renderer/src/components/workbench/MarkdownSyncPlugin.tsx`
  - `src/renderer/src/components/Layout.tsx`
  - `src/renderer/src/pages/WorkbenchPage.tsx`
- lesson: Lexical的DraggableBlockPlugin_EXPERIMENTAL不会自动为menuComponent包裹或注入ref，必须显式在自定义Handle根节点声明ref={menuRef}，否则menuRef.current始终为null导致setMenuPosition不生效、handle无法定位；侧边栏内嵌Webview组件折叠时切勿直接return null，应利用容器display:none维持挂载以保证模型常驻不重载；拖拽Splitter调整窗格必须使用setPointerCapture以防鼠标滑入webview被原生截获

### 01:14 | Antigravity

- done: 优化工作台 UI 设计规范与字体大小、将侧边栏入口移至最小化按钮前、支持源码模式双向无缝切回、补齐 Lexical 全部富文本能力（含文字块拖动、待办清单、表格、水平分割线等），并在侧边栏直接复用 WebviewCard
- decision: 在标题栏右侧最小化按钮前增加工作台 AI 侧边栏展开/折叠入口；侧边栏直接复用 WebviewCard 标准头部与平台下拉；富文本采用 Meta Lexical 官方 DraggableBlockPlugin_EXPERIMENTAL 实现文字块拖拽重排
- modified:
  - `src/renderer/src/assets/index.css`
  - `src/renderer/src/components/Layout.tsx`
  - `src/renderer/src/components/workbench/MarkdownSyncPlugin.tsx`
  - `src/renderer/src/components/workbench/WorkbenchAiSidebar.tsx`
  - `src/renderer/src/components/workbench/WorkbenchEditor.tsx`
  - `src/renderer/src/components/workbench/WorkbenchFileTree.tsx`
  - `src/renderer/src/components/workbench/WorkbenchSearch.tsx`
  - `src/renderer/src/components/workbench/WorkbenchSelectionMenuPlugin.tsx`
  - `src/renderer/src/components/workbench/WorkbenchToolbar.tsx`
  - `src/renderer/src/pages/WorkbenchPage.tsx`

### 00:34 | Antigravity

- done: 修复 MainPage 在 workbench 模式下 modeModels 未定义导致 TypeError: Cannot read properties of undefined (reading 'length') 的问题
- decision: 在 MainPage modeModels 中补全 workbench: []，并对 currentModeModels、prevModeModels、currentModels 增加兜底守卫，避免模式切换导致 React 崩溃
- modified:
  - `src/renderer/src/pages/MainPage.tsx`

### 00:04 | Antigravity

- done: 修复 Windows 下 npm run dev 触发 EACCES 5173 端口排除冲突问题
- modified:
  - `electron.vite.config.ts`
- lesson: Windows 下 Hyper-V/WSL/WinNAT 动态排除端口范围（如 5141-5240）会导致 Vite 默认 5173 绑定报错 EACCES: permission denied；在 electron.vite.config.ts 中将 renderer.server.port 避开该区间（如 5300）并指定 host 127.0.0.1 即可彻底解决

## 2026-11-19

### 23:43 | Antigravity

- done: 实现工作台本地Markdown知识库功能（Obsidian式文件树、三栏布局、Meta Lexical富文本编辑器、AI侧边栏与划词右键提问）
- decision: 采用Meta Lexical作为Markdown富文本内核配合YAML Frontmatter保留管道；工作台顶层容器挂载彻底隔离MainPage底部ControlBar；右侧复用WebviewCard并打通划词注入
- added:
  - `docs/workbench_product_spec.md`
  - `src/main/services/workbenchService.ts`
  - `src/shared/types/workbench.ts`
  - `src/renderer/src/store/workbenchStore.ts`
  - `src/renderer/src/pages/WorkbenchPage.tsx`
  - `src/renderer/src/components/workbench/WorkbenchFileTree.tsx`
  - `src/renderer/src/components/workbench/WorkbenchSearch.tsx`
  - `src/renderer/src/components/workbench/WorkbenchEditor.tsx`
  - `src/renderer/src/components/workbench/WorkbenchToolbar.tsx`
  - `src/renderer/src/components/workbench/MarkdownSyncPlugin.tsx`
  - `src/renderer/src/components/workbench/WorkbenchSelectionMenuPlugin.tsx`
  - `src/renderer/src/components/workbench/WorkbenchAiSidebar.tsx`
- modified:
  - `package.json`
  - `package-lock.json`
  - `src/main/ipcHandlers.ts`
  - `src/preload/index.ts`
  - `src/renderer/src/App.tsx`
  - `src/renderer/src/components/Layout.tsx`
  - `src/renderer/src/components/CustomContextMenu.tsx`
  - `src/shared/types/history.ts`

### 23:42 | Antigravity

- done: Conduct Phase 3 Acceptance Verification for Workbench feature
- decision: Acceptance Verification PASSED: verified Layout entry, 3-column layout, Lexical kernel, YAML frontmatter preservation, auto-save, scoped AI contextual menu, isolated WebviewCard sidebar, assertSafePath realpath symlink defense, clean lint/build.
- added:
  - `docs/workbench_product_spec.md`
  - `src/main/services/workbenchService.ts`
  - `src/shared/types/workbench.ts`
  - `src/renderer/src/store/workbenchStore.ts`
  - `src/renderer/src/pages/WorkbenchPage.tsx`
  - `src/renderer/src/components/workbench/WorkbenchFileTree.tsx`
  - `src/renderer/src/components/workbench/WorkbenchSearch.tsx`
  - `src/renderer/src/components/workbench/WorkbenchEditor.tsx`
  - `src/renderer/src/components/workbench/WorkbenchToolbar.tsx`
  - `src/renderer/src/components/workbench/MarkdownSyncPlugin.tsx`
  - `src/renderer/src/components/workbench/WorkbenchSelectionMenuPlugin.tsx`
  - `src/renderer/src/components/workbench/WorkbenchAiSidebar.tsx`
- modified:
  - `src/renderer/src/components/Layout.tsx`
  - `src/renderer/src/App.tsx`
  - `src/main/ipcHandlers.ts`
  - `src/preload/index.ts`
  - `src/renderer/src/components/CustomContextMenu.tsx`
  - `src/shared/types/history.ts`
  - `package.json`
  - `package-lock.json`

### 23:36 | Antigravity

- done: Implement MultiChat Desk Workbench UI, Lexical editor, Obsidian-like file tree, search, and AI Webview sidebar
- decision: Decoupled WorkbenchPage in App.tsx with display:none to isolate ControlBar and chat monitors; preserved YAML frontmatter during Lexical AST sync; reused WebviewCard with isolated=true and unique instance ID
- added:
  - `src/renderer/src/components/workbench/WorkbenchFileTree.tsx`
  - `src/renderer/src/components/workbench/WorkbenchSearch.tsx`
  - `src/renderer/src/components/workbench/WorkbenchEditor.tsx`
  - `src/renderer/src/components/workbench/WorkbenchToolbar.tsx`
  - `src/renderer/src/components/workbench/MarkdownSyncPlugin.tsx`
  - `src/renderer/src/components/workbench/WorkbenchSelectionMenuPlugin.tsx`
  - `src/renderer/src/components/workbench/WorkbenchAiSidebar.tsx`
  - `src/renderer/src/pages/WorkbenchPage.tsx`
  - `src/renderer/src/store/workbenchStore.ts`
- modified:
  - `src/renderer/src/App.tsx`
  - `src/renderer/src/components/Layout.tsx`
  - `src/renderer/src/components/CustomContextMenu.tsx`
  - `src/shared/types/history.ts`

### 23:24 | Antigravity

- done: 实现工作台 (Workbench) 共享类型、文件系统服务与安全校验、IPC 处理器与 Preload 桥接
- decision: IPC 支持对象与位置参数双重解构，兼容多种前端调用风格；Preload 同时暴露 api.workbench 命名空间与扁平别名；文件路径校验严格比对 realpath 双向解析以彻底阻断符号链接逃逸
- added:
  - `src/shared/types/workbench.ts`
  - `src/main/services/workbenchService.ts`
- modified:
  - `src/main/ipcHandlers.ts`
  - `src/preload/index.ts`

### 23:13 | Antigravity

- done: 根据评审意见修订工作台(Workbench)设计规范
- decision: 在设计规范中完善realpath软链接防范、Frontmatter保护、App.tsx顶层挂载隔离、切文件脏数据保护、搜索300ms防抖与序列锁、右键菜单编辑器作用域隔离以及生产依赖审批说明
- modified:
  - `docs/workbench_product_spec.md`

### 23:06 | Antigravity

- done: 编写工作台(Workbench)产品与技术设计规范
- decision: 采用Meta Lexical作为Markdown知识库编辑内核，三栏布局无缝复用WebviewCard与共享Session，主进程实现assertSafePath严格防范路径遍历
- added:
  - `docs/workbench_product_spec.md`

### 21:37 | Codex

- done: 修正 Client Hints 品牌一致性：sec-ch-ua 改用 Electron 实际发送的 Not/A)Brand+Chromium，与 navigator.userAgentData.brands 保持同源，避免请求头与页面 JS 品牌矛盾
- context: 用户要求按最小方案实施浏览器伪装补强
- decision: 只用 Electron 自身真实品牌值补齐主文档缺失的 Client Hints，不伪造 Google Chrome 品牌，避免引入跨层不一致
- modified:
  - `src/main/webviewManager.ts`
- lesson: 伪造 Client Hints 时必须与 navigator.userAgentData.brands 同源：把 Google Chrome 写进 sec-ch-ua 而 JS 层只有 Chromium 会制造新矛盾；Electron 的 getHighEntropyValues 内部不读被覆盖的 brands，页面级 patch 不可靠
- unresolved: window.chrome 空对象与 outerWidth/innerWidth 差值未处理；未在 npm run dev 真实站点端到端验证

### 21:34 | Codex

- done: 重建共享 Session 标准 Chrome UA 并补齐主文档 Client Hints，消除 Electron 指纹中的 UA 应用名泄漏与 sec-ch-ua 缺失
- context: 用户询问浏览器伪装是否可能被识别为 Electron，先做审计后用独立 worker 复核并查外部文档，最终按'先补 sec-ch-ua、再重建 UA'的顺序实施
- decision: 只改主进程 setupSharedSessionUserAgent，不动渲染层与 preload；不引入 window.chrome shim 等 stealth 手段，避免过度工程化
- modified:
  - `src/main/webviewManager.ts`
- lesson: Electron 默认 UA 为 <平台段> <应用名>/<版本> Chrome/x Electron/x Safari/x，只删 Electron/ 仍留应用名 token，需整段重建；主文档导航请求默认不发 Client Hints，可用 session.webRequest.onBeforeSendHeaders 按 mainFrame/subFrame 补齐，子资源请求本身会发需判重避免覆盖
- unresolved: 未在 npm run dev 中做真实站点端到端验证；window.chrome 空对象与 outerWidth/innerWidth 差值未处理

### 15:56 | Codex

- done: 审核 1.3.1 CHANGELOG 并修正 4 处过度承诺表述
- context: 发版前审核：原生下载按钮改为'优先点击+兜底提取'，引导卡片补 PATH 前提，日期更新为实际发布日
- modified:
  - `CHANGELOG.md`

### 00:12 | Codex

- done: 按新模板简化 Agent Skill 安装指引文案：路径由运行时解析、去掉硬编码 .agents/skills 与 POSIX 家目录写法，天然兼容 macOS
- modified:
  - `src/renderer/src/utils/cliGuide.ts`

## 2026-11-18

### 17:46 | agent

- done: README 更新 macOS 支持声明
- context: mac dmg 已在 Release 提供，README 此前只写 Windows 下载
- modified:
  - `README.md`

### 17:28 | agent

- done: macOS CLI/Skill 集成缺口修复：CliAgentHint 在 darwin 打包版可弹出、status 增加 platform 字段、设置页加复制调用命令、multichat.sh/run_task.sh 加执行位、SKILL.md 补 mac/Linux cli.json 路径
- modified:
  - `src/shared/types/cli.ts`
  - `src/main/cliIntegration.ts`
  - `src/renderer/src/components/CliAgentHint.tsx`
  - `src/renderer/src/components/CliIntegrationSection.tsx`
  - `.agents/skills/multichat-cli/SKILL.md`
  - `build/cli/multichat.sh`
  - `.agents/skills/multichat-cli/scripts/run_task.sh`
- lesson: macOS Electron 应用常驻旧进程会让 open 只激活而不重启，验证新版本前必须先 kill 旧实例（单实例锁）；electron-builder extraFiles 不会自动补可执行位，.sh 入口需在仓库内 chmod +x

### 17:46 | Codex

- done: 核查 CliAgentHint 弹窗触发逻辑：isPackaged+onPath+!hintDismissed；.install-stamp 由 NSIS 每次安装重写，关闭时清除
- context: 用户截图询问 multichat 就绪弹窗是否只在安装后首次打开提醒

### 16:59 | Codex

- done: 生图捕获修复+附件改粘贴式上传：doubao/chatgpt 图+文生图实测全通过
- context: doubao/chatgpt --image + --gen-image 图生图链路验收
- modified:
  - `src/shared/config/selectors.ts`
  - `src/shared/utils/webviewScripts.ts`
  - `src/main/services/AgentTaskService.ts`
  - `src/main/services/AutomationService.ts`
- lesson(promoted): CLI --image 附件上传改用'粘贴式'优于 CDP 拖拽：主进程 readFile→base64→页内 new File+DataTransfer+ClipboardEvent(paste) 派发到输入框，主流 AI 编辑器(ProseMirror/Slate/Lexical)都监听 paste 解析附件，不依赖 drop 监听/落点坐标/附件区 DOM；doubao 实测一次通过，旧拖拽 90s 超时根因是附件 chip 只渲染缩略图不落文件名文本致 found 检测永远 false
- lesson(promoted): extractImages 生图探针必须只认生图专用容器(genImageOnly)：messageContainer 兜底 document.body 会把用户上传附件的回显缩略图当'已生成'产物，chatgpt 实测提前 done 抓到上传参考图而非生成图

### 16:39 | Codex

- done: Raised attachment upload timeouts for CLI --image path: uploadAttachments 30s->90s, generateSendMessageScript secondary confirm 15s->30s (named constant + comment), based on agent report of gemini/doubao image-upload timeouts
- modified:
  - `src/main/services/AutomationService.ts`
  - `src/shared/utils/webviewScripts.ts`
- lesson: --image upload has two layered timeouts (drop->ready 30s, ready->send 15s) both hardcoded; gemini/doubao OCR/preview latency can exceed the short ones — keep primary poll long enough to absorb that

### 16:36 | Codex

- done: 修复豆包/ChatGPT 生图捕获：消息容器补生图选择器+extractImages 过滤过程产物
- context: CLI --gen-image 生图下载链路验收
- modified:
  - `src/shared/config/selectors.ts`
  - `src/shared/utils/webviewScripts.ts`
- lesson: extractImages 的 findLatestContainer 依赖 messageContainer 命中含图容器——豆包生图 message_image_content 是文本容器[data-streaming]的兄弟节点，须把生图容器并入 messageContainer;ChatGPT 生成中 Placeholder 骨架含半成品 img 会被误判为完成,需 isInProgressArtifact 按 data-finished/placeholder 标记过滤

### 16:32 | Codex

- done: Addressed agent feedback on multichat-cli skill: simplified cli.json lookup to install dir, flagged gemini/doubao image-upload flakiness, documented imageError markdown-URL recovery, and steered cli.json reads away from cat
- modified:
  - `.agents/skills/multichat-cli/SKILL.md`
- lesson: External agents reported real failure modes not covered by the skill: platform-specific --image upload flakiness, imageError recovery via reply markdown URLs, and the implicit cat habit for reading APPDATA manifests — these belong in the skill, not left for the agent to discover

### 13:22 | Codex

- done: 提交 11-18 CLI Agent 链路改动（feat 2225c7b + chore 7350e34）并重新构建 NSIS 安装包 dist/MultiChat Setup 1.3.1.exe（签名通过，124.3MB）；删除脚本误产生的 nul 残留文件
- context: 用户要求提交修改并重新打包安装包；lint 0 errors（存量 warning），electron-builder 签名通过
- modified:
  - `dist/MultiChat Setup 1.3.1.exe`
- removed:
  - 
ul`
- lesson: Windows 下脚本把输出重定向到 nul 会在仓库根目录生成名为 nul 的实体文件，需用 \\?\ 前缀路径删除

### 13:16 | Codex

- done: 把主进程选择器版本校验写入 KNOWLEDGE，并标记对应 lesson 已提升
- modified:
  - `.memory/KNOWLEDGE.md`

### 13:16 | Codex

- done: 补上主进程选择器版本校验：低于默认版本的已保存配置整体作废，避免旧版 qwen 域名继续生效；验证 v19 回退默认、v20/21 仍用自定义
- modified:
  - `src/main/services/AutomationService.ts`
- lesson(promoted): 主进程 AutomationService 读 store 选择器时要和渲染层 getSelectors 一样做 version 比较，否则旧配置里的废弃域名会长期生效

### 13:13 | Codex

- done: 把千问域名切换的实测结论（发送链路、研究模式幂等、三处域名落点）并入 KNOWLEDGE 既有条目
- modified:
  - `.memory/KNOWLEDGE.md`
- lesson(promoted): 千问切换 qianwen.com 后自动化可用：contenteditable + execCommand 写入正常，发送按钮由 disabled 变可用

### 13:13 | Codex

- done: 千问域名切换验收：qianwen.com 首页与会话页的输入/发送按钮试运行均通过，研究模式开关幂等；旧域名 tongyi.aliyun.com 301 到 www.qianwen.com，origin 统一
- context: 用户批注：千问域名切换是否影响自动化入口
- decision: 桌面端默认入口、后台自动化兜底 URL 一并改为 https://www.qianwen.com/；笔记平台名保留新旧两个 hostname 映射
- modified:
  - `src/renderer/src/store/appStore.ts`
  - `src/main/services/AutomationService.ts`
  - `src/main/webviewManager.ts`
  - `scripts/agent-cli-acceptance.mjs`
- lesson(promoted): 千问自动化实测：首页与 /chat/<id> 的输入框是普通 contenteditable div，走 execCommand('insertText') 分支可用；发送按钮 aria-label 为「发送消息」，输入后由 disabled 变可用
- lesson(promoted): 域名迁移要同时检查四类落点：选择器 newConversationUrl、主进程兜底 URL 表、渲染层默认模型列表、按 hostname 映射的展示名

### 13:04 | Codex

- done: 登录态值判定收尾：域名按标签边界匹配，补注释说明名字命中不等于已登录
- modified:
  - `src/main/services/AuthStateService.ts`

### 13:02 | Codex

- done: 补正登录态判定：chatglm/yuanbao 游客态会写同名 cookie，改为按 JWT is_guest 与 a_did_ 前缀做值判定
- modified:
  - `src/shared/config/selectors.ts`
  - `src/main/services/AuthStateService.ts`
  - `.agents/skills/multichat-cli/SKILL.md`
  - `.memory/KNOWLEDGE.md`
  - `.memory/INDEX.md`
- lesson: 登录态名单必须用游客态与登录态双向取样；只看登录态会把游客写同名 cookie 的平台误判

### 12:53 | Codex

- done: CLI 登录态识别修复：补齐 chatglm/yiyan/arena/qwen 的 cookie 名单与 kimi localStorage 通道；修正 deepseek 空壳 userToken 误判；qwen 自动化站对齐 qianwen.com 并给 aria-pressed 开关加幂等守卫
- decision: qwen 自动化目标站从 chat.qwen.ai 改为 www.qianwen.com，与登录态和选择器同源
- modified:
  - `src/shared/config/selectors.ts`
  - `src/main/services/AuthStateService.ts`
  - `src/main/services/AgentTaskService.ts`
  - `src/shared/utils/webviewScripts.ts`
  - `.agents/skills/multichat-cli/SKILL.md`
  - `.memory/KNOWLEDGE.md`
  - `.memory/INDEX.md`
- lesson: 登录态判定必须 cookie + localStorage 双通道，且 cookie 未命中不等于游客；aria-pressed 开关类步骤需要 skipIfPressed 幂等守卫

### 11:47 | Codex

- done: 登录态判定改为双通道：cookie 名单 + 页面 localStorage；deepseek 认 userToken，qwen 认 qwen_token_logged_out_marker；localStorage 只读已打开 WebContents，不额外开窗
- context: 真实 persist:shared 实测：deepseek 已登录任务 9.5s 正常返回；qwen 会话落在 /c/guest 为游客；应用运行期 cookie 库被文件锁，外部读取不可靠
- decision: 不采用游客 URL 模式与通用 cookie 启发式，只用可验证的明确键；判不出返回 unknown 由页面侧兜底
- modified:
  - `src/shared/config/selectors.ts`
  - `src/main/services/AuthStateService.ts`
  - `.agents/skills/multichat-cli/SKILL.md`
  - `.memory/KNOWLEDGE.md`
  - `.memory/INDEX.md`
- lesson(promoted): 应用运行期间 Chromium 的 Cookies 库被独占锁，离线复制会得到空库或旧快照；判定登录态必须在应用进程内读，且凭证可能只在 localStorage（deepseek userToken）而非 cookie

### 11:03 | Codex

- done: 新增 cookie 级登录态判定：AuthStateService 按平台账号 cookie 名单区分已登录/游客，platforms 暴露 signedIn/loginRequired，新增 multichat auth 命令，登录门槛平台在 submit 阶段快速失败
- context: 隔离环境 --user-data-dir 全新目录；真实 persist:shared 只读导出 cookie 名验证名单：chatgpt/gemini/doubao/grok/yuanbao 命中，qwen/deepseek/claude 为游客
- decision: 移除通用'名字像凭证'启发式：__Host-id-token-nonce 等访客 cookie 会被误判为已登录；只保留平台名单精确匹配，判不出时返回 unknown 交由页面检测
- added:
  - `src/main/services/AuthStateService.ts`
- modified:
  - `src/shared/config/selectors.ts`
  - `src/shared/types/agentTask.ts`
  - `src/main/services/AgentTaskService.ts`
  - `src/main/daemon/ipcServer.ts`
  - `src/cli/commands.ts`
  - `.agents/skills/multichat-cli/SKILL.md`
- lesson(promoted): cookie 是区分游客与已登录的唯一可靠信号：游客态同样有大量指纹/统计 cookie，甚至 deepseek 的 ds_session_id 游客态就存在，必须按平台账号 cookie 名精确匹配，不能靠'有 cookie'或通用命名规则
- unresolved: qwen/deepseek/claude 尚无可靠的登录态 cookie 名单，当前返回 unknown，其登录门槛仍靠页面侧检测兜底

### 10:34 | Codex

- done: CLI 任务链路增加登录态识别：preparing 阶段人机验证/密码框强信号连续两次判 AUTH_REQUIRED；发送失败后用页内登录入口归因；URL 登录墙正则支持 sign_in 等分隔写法
- context: 隔离验收用 --user-data-dir 指向全新目录，未复用本机缓存；DeepSeek 落 /sign_in 未被旧正则命中；gemini/doubao/yiyan/chatglm 游客可正常作答
- decision: 页内登录按钮不作提前判墙依据，只在发送失败后归因，避免误伤游客可用平台
- modified:
  - `src/shared/config/selectors.ts`
  - `src/shared/utils/webviewScripts.ts`
  - `src/shared/utils/conversationUrl.ts`
  - `src/shared/types/agentTask.ts`
  - `src/main/services/AgentTaskService.ts`
  - `.agents/skills/multichat-cli/SKILL.md`
- lesson(promoted): 未登录页的输入框同样可见，不能靠 ready 探针判断登录态；页面顶栏常驻登录入口也不等于未登录，只有在提交失败后归因才可靠
- unresolved: chatglm 未登录时实际可作答，若后续平台收紧游客策略需重新实测

### 09:54 | Codex

- done: Reviewed multichat-cli SKILL.md vs CLI impl; fixed busySignal/gen-image/imageFiles drift
- modified:
  - `.agents/skills/multichat-cli/SKILL.md`
- lesson: --gen-image submit check only requires imageDownload.steps (AgentTaskService:196); imageGeneration is an optional page-side mode toggle, not a gate. busySignal=adapted covers only chatgpt/claude/gemini/deepseek via generationStopSelectors.

### 09:52 | Codex

- done: 更新 1.3.1 CHANGELOG 的 CLI 条目并新增 README CLI 章节
- modified:
  - `CHANGELOG.md`
  - `README.md`

### 09:28 | Codex

- done: CLI --gen-image 验收完成：6/7 imageDownload 平台实测通过，qwen click 兜底回退生效，yiyan 受平台登录限制（非框架 bug）
- decision: click-download 未命中时回退 generateExtractImagesScript + data:/downloadURL 直存；done 态空 reply 也强制写 TXT 占位
- modified:
  - `src/main/services/AgentTaskService.ts`
  - `src/main/services/ImageDownloadService.ts`
  - `docs/cli-image-generation-plan.md`
- lesson: 多平台一次性跑比单平台更暴露问题：qwen 的 imageItem- class 已改版 → click steps 选不中 → 必须留 extract 兜底；yiyan 未登录不会真生图，框架容错合理

### 09:16 | Codex

- done: CLI 生图改为 prompt 直发模式并多平台验收：--gen-image 不调生图入口，extractImages 探针 + imageDownload 点下载；6/7 平台端到端真实出图落盘（chatgpt/gemini/doubao/yuanbao/grok，yiyan 未登录未出图，qwen SEND_FAILED 为平台兼容问题）
- decision: --gen-image 不再调 imageGeneration.steps 入口（headless 下不通用且多数平台凭 prompt 出图）；图片探针用 generateExtractImagesScript 而非 imageDownload.steps[0]；poll 把图片挂载+!busy 计入完成信号解决纯图回复卡死
- modified:
  - `src/main/services/AgentTaskService.ts`
  - `src/shared/config/selectors.ts`
  - `.agents/skills/multichat-cli/SKILL.md`
  - `docs/cli-image-generation-plan.md`
- unresolved: yiyan 需登录才真实生图；qwen sendButton/verifySubmission 失效为平台发送适配问题，与生图无关

### 00:55 | Codex

- done: 按调研结论修改 selectors.ts：chatgpt/perplexity/qwen/gemini/grok/doubao researchMode 全量重写，新增 yuanbao researchMode；version 18→19；iab 实测验收 chatgpt/perplexity/qwen/gemini/yuanbao 全链路选择器命中
- modified:
  - `src/shared/config/selectors.ts`
- lesson(promoted): qwen 模式入口是 div.mode-select-open[role=button] 不是 button；AutomationStep 验收需模拟 selector 数组顺序取第一个可见命中+text/regex/exclude 过滤链
- unresolved: grok/claude/chatglm/deepseek 选择器未在登录态实测；cancelSteps 选中态钩子未复核

### 00:49 | Codex

- done: CLI 生图与产物落盘端到端验证通过：task submit --gen-image + --artifact-dir（默认 cwd/.multichat）+ results/image 目录 + replyFile/imageFiles 契约 + doubao 真实出图落盘
- decision: 产物根目录由 CLI --artifact-dir（默认 cwd/.multichat）透传给 daemon，回退应用数据目录；image-ready 探针用 imageDownload.steps[0].selector；TXT 文件名 {platform}-{taskId[:8]}.txt
- modified:
  - `src/shared/types/agentTask.ts`
  - `src/main/services/AgentTaskService.ts`
  - `src/main/daemon/ipcServer.ts`
  - `src/cli/commands.ts`
  - `.agents/skills/multichat-cli/SKILL.md`
  - `docs/cli-image-generation-plan.md`
- unresolved: grok/yiyan/qwen/gemini 等平台 imageGeneration.steps 需在真实登录态与 UI 下逐平台复测（headless 下选择器未命中或未激活），CLI 框架已在 doubao 验证

### 00:42 | Codex

- done: Deep Research DOM 探索：主进程 iab 实测 13 平台 + 3 audit worker 复核，14 份报告落 docs/deep-research-dom/；chatgpt/perplexity/qwen steps 全失效，doubao/grok/deepseek 无 DR 功能或入口
- added:
  - `docs/deep-research-dom/{chatgpt`
  - `perplexity`
  - `gemini`
  - `grok`
  - `qwen`
  - `doubao`
  - `kimi`
  - `yuanbao`
  - `yiyan`
  - `arena`
  - `claude`
  - `chatglm`
  - `deepseek}.md`
- modified:
  - `docs/deep-research-dom/README.md`
- lesson(promoted): 各平台已弃用 data-testid/data-log-*/tagBtn-* 钩子，转向 aria-label+role+文本语义；菜单 role 多样化（button/listbox+option/menu+menuitem/自定义元素），选择器须多 role 候选；iab 不共享 persist:shared 登录态，子 agent 无独立 iab 面
- unresolved: grok/claude/chatglm/deepseek 需在已登录 persist:shared webview 复核；selectors.ts 修复未实施（仅出报告）

### 00:41 | Codex

- done: Deep Research DOM 审核 worker：claude/chatglm/deepseek 三个被拦平台分别记录为 BLOCKED(login)/BLOCKED(captcha)/BLOCKED(login)，deepseek 的 researchMode 语义确认为'深度思考'而非 Deep Research；三份报告写入 docs/deep-research-dom/
- context: 子 agent 无独立 iab 浏览器面，三平台分别被登录态/滑块验证拦截，报告记录可验证的选择器静态分析与登录后复核步骤
- modified:
  - `docs/deep-research-dom/claude.md`
  - `docs/deep-research-dom/chatglm.md`
  - `docs/deep-research-dom/deepseek.md`

### 00:37 | Codex

- done: CLI 生图与产物落盘：task submit --gen-image + .multichat/image 落盘 + .multichat/results TXT + replyFile/imageFiles 契约字段 + platforms 新列 + will-download 框架抽为 ImageDownloadService
- decision: will-download 框架从 ipcHandlers 抽到独立 ImageDownloadService，杜绝 services→ipcHandlers 反向 import；image-ready 探针改用 imageDownload.steps[0].selector 而非 extractImages；--text 模式产物路径写 stderr 保 stdout 纯净
- added:
  - `src/main/services/ImageDownloadService.ts`
- modified:
  - `src/shared/types/agentTask.ts`
  - `src/main/services/AgentTaskService.ts`
  - `src/main/daemon/ipcServer.ts`
  - `src/main/ipcHandlers.ts`
  - `src/cli/commands.ts`
  - `.agents/skills/multichat-cli/SKILL.md`
  - `.agents/skills/multichat-cli/scripts/run_task.ps1`
  - `.agents/skills/multichat-cli/scripts/run_task.sh`
  - `docs/cli-image-generation-plan.md`
- unresolved: 各平台 imageGeneration.steps 在 headless BrowserWindow 下部分不生效（doubao 技能条不激活/qwen 工具栏缺/gemini toolbox 未命中/grok 需登录），属平台级选择器适配遗留，需真实 UI 逐平台复测

### 00:27 | Codex

- done: Deep Research DOM 审计（audit_a：chatgpt/perplexity/qwen/doubao）— 每个平台的失效选择器与新 DOM 链记录到 docs/deep-research-dom/
- context: iab 浏览器在子代理中不可用（Browser is not available: iab）— live DOM 验证由 /root 在同一 iab 会话执行，audit_a 负责整合与报告
- modified:
  - `docs/deep-research-dom/`
- unresolved: claude/chatglm/deepseek 未验证（无登录/滑块/登出）;doubao 的深入研究疑似被移除;chatgpt sendButton/reportContainer 需实测

## 2026-11-17

### 21:54 | agent

- done: 删除 v1.3.1 CHANGELOG 中针对未发布功能的修复条目（安装器 PATH 卡死、CLI 鉴权）；macOS 26 划词修复并入 macOS 打磨条目
- modified:
  - `CHANGELOG.md`
- lesson: 发版说明只写对上一正式版用户可见的变化，开发周期内引入又修掉的问题不写入

### 21:53 | agent

- done: 去除 v1.3.1 发版文案营销化表述（重磅新能力、外挂大脑、emoji 标题等），CHANGELOG 条目标题同步去修饰
- modified:
  - `CHANGELOG.md`
- lesson: 用户对发布文案偏好事实性、克制表达，避免“重磅”“附赠”等营销话术

### 21:44 | agent

- done: 精简 v1.3.1 CHANGELOG 表述：去除 52px 等 UI 像素级与底层实现细节，macOS 与修复条目改为概括性描述
- modified:
  - `CHANGELOG.md`

### 21:43 | agent

- done: 按反馈修正 v1.3.1 CHANGELOG：Agent Skill 表述去掉「随包附赠」，编码助手示例改为 Codex、Claude Code、Workbuddy
- modified:
  - `CHANGELOG.md`

### 21:37 | agent

- done: 撰写 v1.3.1 发版内容：CHANGELOG.md 新增 1.3.1 条目（multichat CLI/Agent 集成、生图下载全平台适配、macOS 打磨与修复），并输出 GitHub Release 发版信息草稿
- modified:
  - `CHANGELOG.md`

### 18:49 | agent

- done: 修复 NSIS 安装器 PATH 广播卡死：SendMessage(SMTO_NORMAL,5s/窗) 改为 System::Call SendMessageTimeoutW + SMTO_ABORTIFHUNG + 1s 宏（装/卸两处）；同批提交另一会话的 .install-stamp 覆盖安装重弹引导；已重新构建 dist/MultiChat Setup 1.3.1.exe（17:01）
- modified:
  - `build/installer.nsh`
  - `src/main/cliIntegration.ts`
  - `src/main/ipcHandlers.ts`
  - `src/renderer/src/components/CliAgentHint.tsx`
  - `dist/MultiChat Setup 1.3.1.exe`
- lesson(promoted): NSIS SendMessage /TIMEOUT= 是 SMTO_NORMAL：HWND_BROADCAST 超时会按每个无响应顶层窗口累计，桌面挂起窗口多时安装器可卡死分钟级；修复要么 SMTO_ABORTIFHUNG+短超时，要么 SendNotifyMessage 异步（Scoop #6706）

### 17:00 | agent

- done: 让 Agent Skill 引导卡片在每次安装/覆盖安装后重新弹出；梳理设置面板 PATH 状态逻辑
- context: 用户反馈重装安装包后不再弹出 Agent Skill 引导，根因是 cliAgentHintDismissed 存于 electron-store config.json，卸载不清除
- decision: 用 NSIS customInstall 写入 cli/.install-stamp 标记方案，而非按版本号重置 dismissed 标记，以覆盖同版本覆盖安装场景
- modified:
  - `build/installer.nsh`
  - `src/main/cliIntegration.ts`
  - `src/main/ipcHandlers.ts`
  - `src/renderer/src/components/CliAgentHint.tsx`

### 16:41 | agent

- done: 提交待入库改动（feat: skill 迁移 .agents + 生图下载选择器 + CLI Agent 链路；chore: 记忆层）并重新构建 NSIS 安装包 dist/MultiChat Setup 1.3.1.exe（electron-builder 签名通过，覆盖同版本旧产物）
- modified:
  - `dist/MultiChat Setup 1.3.1.exe`

### 16:34 | agent

- done: 仓库 skill 源从 .devin/skills/multichat-cli 迁移到 .agents/skills/multichat-cli：git mv 三个文件（SKILL.md、run_task.sh、run_task.ps1），同步 electron-builder.yml / electron-builder-portable.yml 的 extraResources from、cliIntegration.ts dev 回退、cli.ts 注释；顺带将一直未跟踪的 run_task.ps1 纳入 git
- added:
  - `.agents/skills/multichat-cli/SKILL.md`
  - `.agents/skills/multichat-cli/scripts/run_task.sh`
  - `.agents/skills/multichat-cli/scripts/run_task.ps1`
- modified:
  - `electron-builder.yml`
  - `electron-builder-portable.yml`
  - `src/main/cliIntegration.ts`
  - `src/shared/types/cli.ts`
- removed:
  - `.devin/skills/multichat-cli`
- lesson(promoted): run_task.ps1 历史上从未被 git 跟踪（非 ignore），打包靠文件系统带上；仓库迁移类操作要顺手核对 git status 里的 ?? 文件

### 16:24 | agent

- done: 复制安装命令的 skills 目标目录从 .devin/skills 改为跨客户端通用约定 .agents/skills（项目级）与 ~/.agents/skills（全局），附兜底说明'客户端有专属目录时按其约定'
- decision: 采用 .agents/skills 而非 .agent：agentskills.io 规范、Cursor/Codex/OpenCode、skills.sh 生态均以复数 .agents/skills 为 canonical 位置
- modified:
  - `src/renderer/src/utils/cliGuide.ts`

### 16:22 | Codex

- done: 图片下载 DOM 适配落地：7 家平台实测选择器写入 selectors.ts；Kimi/智谱/DeepSeek 用户确认跳过
- context: 一键批量下载改走平台 UI 原生下载链；iab 浏览器实测 DOM 结构；choose aria-label/data-testid/data-icon-button 语义 hook，避开 CSS 哈希类名
- added:
  - `docs/image-download-dom/{chatgpt`
  - `gemini`
  - `yiyan`
  - `doubao`
  - `grok`
  - `qwen`
  - `yuanbao`
  - `kimi`
  - `chatglm`
  - `perplexity`
  - `arena}.md`
- modified:
  - `src/shared/config/selectors.ts`
  - `docs/image-download-dom/README.md`
- lesson(promoted): ChatGPT 下载按钮 aria-label 从 '保存' 改成了 '下载'；豆包 UI 改版从 hover 浮层改为点图→预览→testid 下载；Grok/文心/Gemini 有稳定的语义 hook（aria-label/data-icon-button/cos-icon-download）可一键下载无需开预览

### 16:20 | Codex

- done: Grok/千问/元宝 imageDownload DOM 实测并落地 selectors.ts
- context: iab 内置浏览器实测 12 家 AI 平台生图下载入口；Grok/千问/元宝本轮完成，Kimi 未登录、智谱滑块验证未解、DeepSeek 不生图跳过
- added:
  - `docs/image-download-dom/grok.md`
  - `docs/image-download-dom/qwen.md`
  - `docs/image-download-dom/yuanbao.md`
- modified:
  - `src/shared/config/selectors.ts`
  - `docs/image-download-dom/README.md`
- removed:
  - `docs/image-download-dom/grok.md`
  - `docs/image-download-dom/qwen.md`
  - `docs/image-download-dom/yuanbao.md(重写)`
- lesson: iab 登录态与 MultiChat persist:shared session 不共享，需各平台独立登录；智谱 chatglm.cn 有滑块反爬；Playwright evaluate 是 read-only，不能 dispatchEvent

### 15:58 | Codex

- done: 实测4家AI平台图片下载DOM并更新imageDownload选择器
- context: 用户反馈一键批量下载图片部分平台失败/低质，需逐平台探索DOM改走原生UI下载
- decision: imageDownload.steps保持两步结构(点开预览→点下载按钮)，优先用语义aria-label/data-testid而非hash class
- added:
  - `docs/image-download-dom/README.md;docs/image-download-dom/chatgpt.md;docs/image-download-dom/gemini.md;docs/image-download-dom/doubao.md;docs/image-download-dom/yiyan.md;docs/image-download-dom/qwen.md;docs/image-download-dom/kimi.md;docs/image-download-dom/yuanbao.md;docs/image-download-dom/chatglm.md;docs/image-download-dom/grok.md;docs/image-download-dom/perplexity.md;docs/image-download-dom/arena.md`
- modified:
  - `src/shared/config/selectors.ts`
- unresolved: Grok/千问/元宝三家登录后未实测DOM；智谱被滑块拦；Kimi未登录。等待CUA工具恢复或用户手动确认

### 15:50 | agent

- done: CLI task submit 接入 --image 图片上传：CLI 解析绝对路径并校验文件存在，daemon 透传 images，AgentTaskService 复用 dispatchFileDrop 逐张拖拽上传 + generateFileUploadStateScript 确认解析，最后经 generateSendMessageScript(attachmentFileName) 门控发送；query 与 image 至少其一；同步 SKILL.md/run_task 包装脚本/验收脚本用例，ChatGPT 图文与纯图片两条链路实测通过
- modified:
  - `src/shared/types/agentTask.ts;src/main/services/AutomationService.ts;src/main/services/AgentTaskService.ts;src/main/daemon/ipcServer.ts;src/cli/commands.ts;scripts/agent-cli-acceptance.mjs;.devin/skills/multichat-cli/SKILL.md;.devin/skills/multichat-cli/scripts/run_task.sh;.devin/skills/multichat-cli/scripts/run_task.ps1`
- lesson(promoted): dev 环境 ELECTRON_RUN_AS_NODE=1 残留会让 electron 以纯 Node 模式启动即崩（isPackaged undefined），须 env -u 彻底移除而非置空；图片附件在部分平台不渲染文件名，generateFileUploadStateScript 按文件名匹配在 Gemini 上 30s 超时（ChatGPT 正常），属平台适配差异非链路 bug
- unresolved: Gemini 平台 --image 上传检测超时（附件状态脚本按文件名匹配，图片缩略图无文件名渲染或未接受 drop），后续若要全平台需为图片类附件增加非文件名的存在性检测

### 11:29 | agent

- done: 精简 CLI/Skill 引导：安装后引导卡片只保留'复制安装命令（给 Agent）'与'打开 Skill 目录'两个动作；剪贴板内容改为一句 Agent 可执行的安装指令（含 skillDir 源路径，项目/全局目标由 Agent 决定）；设置页'命令行与 Agent 集成'砍掉大段说明文字，改为与'模型下拉列表排序'一致的标题+一行说明+右侧操作密度，已加 PATH 时隐藏 CLI 路径行
- decision: 复制内容用自然语言安装指令而非 shell 命令：跨平台且让 Agent 自行决定装到项目 .devin/skills 还是全局 ~/.devin/skills
- modified:
  - `src/renderer/src/components/CliAgentHint.tsx`
  - `src/renderer/src/components/CliIntegrationSection.tsx`
  - `src/renderer/src/utils/cliGuide.ts`

### 11:07 | agent

- done: 更新 Gemini 与文心一言平台图标为官方现行版本
- context: gemini.png 换成 Google 2025-07 启用的圆角四芒星彩色渐变新 logo（Wikimedia 官方 SVG 渲染 960px 源缩放至 256px）；yiyan 图标换成 chat.baidu.com webmanifest 官方 512px 文心助手图标（蓝紫圆角声波方块），格式由 .ico 改为 .png 并同步 import
- added:
  - `src/renderer/src/assets/logos/yiyan.png`
- modified:
  - `src/renderer/src/assets/logos/gemini.png`
  - `src/renderer/src/store/appStore.ts`
- removed:
  - `src/renderer/src/assets/logos/yiyan.ico`
- lesson: Wikimedia Commons 缩略图已限流标准尺寸（256px 请求 400），应通过 API iiurlwidth 取最近标准桶（330px/960px）再用 System.Drawing 缩放；找中文站点现行图标可查其 webmanifest 的 icons 字段，比 favicon 更准

### 10:47 | agent

- done: 修复 tsconfig.web.json 的 baseUrl 弃用告警：移除 baseUrl，paths 改为 ./ 相对路径（TS6.0 迁移写法）
- modified:
  - `tsconfig.web.json`
- lesson: tsconfig.web.json 缺少 target 导致存量 TS2802（Map 迭代需 es2015+）等 12 个类型错误，与本次改动无关；验证存量错误需 stash 对比

## 2026-11-16

### 23:14 | agent

- done: 实施评审 P0-P3 全部代码层根治项：commands.ts 显式 query 参数跳过 readStdinIfPiped（根治开放 stdin 管道挂死）+ submit --wait 客户端两段化（stderr 早吐 taskId ack，实测对 1.3.1 daemon 正常）；idempotencyKey 全链贯通（CLI flag→ipcServer buildSubmitRequest→AgentTaskService 同 sessionKey 内存去重）；index.ts 启动写 cli.json（cliCmdPath/skillDir，覆盖便携版）；electron-builder-portable.yml 补回 skill extraResources（extends 数组覆盖语义，原为缺 skill 的 bug）；installer.nsh customInstall 补写 InstallLocation 到卸载键；SKILL.md/双包装脚本同步新契约与 --idempotency-key
- context: 评审 P0-P3 落地；端到端对运行中的 1.3.1 daemon 实测：stdin 跳过/管道读取/两段式 stderr ack/cancel/task list 均正常；daemon 侧新功能（幂等键、cli.json）因已装实例占管无法实测，留 dev 验证
- modified:
  - `src/cli/commands.ts`
  - `src/shared/types/agentTask.ts`
  - `src/main/daemon/ipcServer.ts`
  - `src/main/services/AgentTaskService.ts`
  - `src/main/cliIntegration.ts`
  - `src/main/index.ts`
  - `electron-builder-portable.yml`
  - `build/installer.nsh`
  - `.devin/skills/multichat-cli/SKILL.md`
  - `.devin/skills/multichat-cli/scripts/run_task.ps1`
  - `.devin/skills/multichat-cli/scripts/run_task.sh`
- lesson(promoted): electron-builder extends 对 extraResources 等数组字段是覆盖语义非合并：portable yml 重定义时必须重复声明父配置全部条目，否则静默丢资源（本次便携版丢 skill 目录实证）
- lesson(promoted): submit --wait 的正确两段化在客户端而非协议层：daemon 协议不变（client 先 submit 无 wait 回 taskId 吐 stderr 再 task.status 长轮询），新旧 CLI/daemon 交叉兼容；若在 daemon 侧加 ack 先行响应，旧 client 首行即 resolve 会提前退出
- unresolved: daemon 侧新代码（idempotencyKey 去重、writeCliManifest）需在安装版退出后 npm run dev 实测：关闭 MultiChat → npm run dev → node out/cli/index.js task submit --platform deepseek --query x --idempotency-key k1 两次应返回同 taskId；%APPDATA%\multichat-dev\cli.json 应生成

### 23:02 | agent

- done: 独立评审后修复 skill 脚本层缺陷：run_task.ps1 重构为两段式（submit 不带 --wait 先拿 taskId 吐 stderr → status --wait 轮询）、MULTICHAT_CLI 先 Test-Path 再分词（修含空格路径自伤）、CLI 调用统一 '' | 给空 stdin（堵住子进程继承开放管道的挂死）、Poll/Timeout 加 ValidateRange、加 Get-Process 便携版兜底解析；run_task.sh 同步两段式+taskId ack+stdin 防护+JSON success 判错（原退出码判错对已装 shim 无效）；SKILL.md 补开放 stdin 管道警告、便携版无卸载键说明、data.phase 终态判定表述、Get-Process 备选定位
- context: subagent 独立评审结论：方案近优但缺 CLI 代码层根治；electron-builder-portable.yml 重定义 extraResources 会丢 skill 目录（extends 数组覆盖语义，疑似 bug 待修）
- modified:
  - `.devin/skills/multichat-cli/SKILL.md`
  - `.devin/skills/multichat-cli/scripts/run_task.ps1`
  - `.devin/skills/multichat-cli/scripts/run_task.sh`
- lesson(promoted): 评审抓到的关键缺口：文档层缓解（两段式/警告）无法根治 CLI 源码缺陷——readStdinIfPiped 无条件先读 stdin 会让开放管道场景下所有提交挂死（连 --query-file 也救不了）；submit --wait 被杀丢 taskId 需客户端两段化（submit 不带 wait 先回 stderr ack 再 status 长轮询）
- unresolved: CLI 代码层根治项待定：readStdinIfPiped 显式参数跳过、submit --wait 客户端两段化、cli.json 入口指示文件、portable extraResources 补 skill、installer 补写 InstallLocation、idempotencyKey 幂等提交

### 22:48 | agent

- done: 修复 multichat-cli skill 的 Agent 调用摩擦：SKILL.md 补注册表确定性入口定位、两段式 submit/status 后台等待范式、被杀调用≠任务取消的恢复警告、Windows 引号坑与旧 shim 吞退出码警告（顺带修正 run_task.sh 示例中不存在的 --wait 参数）；新增 run_task.ps1（自解析入口+临时文件传 query+JSON success 判定）；修复 multichat.cmd endlocal 吞 ERRORLEVEL 的退出码 bug
- context: Devin 会话截图显示 agent 调 multichat CLI 走了 15+ 步：PATH 陈旧找不到入口 5 步 + submit --wait 前台超时被杀丢 taskId 重投 + 多次 status 轮询
- added:
  - `.devin/skills/multichat-cli/scripts/run_task.ps1`
- modified:
  - `.devin/skills/multichat-cli/SKILL.md`
  - `build/cli/multichat.cmd`
- lesson(promoted): cmd 批处理 setlocal/endlocal 会把子进程 ERRORLEVEL 复位吞掉退出码：退出码必须 endlocal & exit /b %ERRORLEVEL% 同行显式透传（%E% 在行解析时展开先于 endlocal 执行）
- lesson(promoted): electron-builder NSIS 卸载键不写 InstallLocation，反推安装目录用 DisplayIcon（去 ,0 后缀）或 UninstallString 首个引号路径
- lesson(promoted): PowerShell 函数 return @(x) 单元素数组在赋值时被解包成标量，x[0] 会取到字符串首字符；调用处必须 @(func) 强制数组

### 22:23 | agent

- done: 拉取 origin/main（5 个 macOS 相关提交）并与本地 CLI 功能提交 9c1ce6f 合并为 merge commit df31db8；仅 SESSION_LOG.md 冲突，按日期新旧保留双段（2026-11-16 在前、2026-11-14 在后）；Layout.tsx 自动合并（本地 CliAgentHint + 远程 entryButtons 重构共存）；.memory/sessions/2026-10-21.md 双侧内容一致自动落齐
- context: 合并前本地曾有大量未提交改动，期间被提交为 9c1ce6f 后与远程分叉
- modified:
  - `SESSION_LOG.md`
- unresolved: 本地领先 origin/main 2 个提交，尚未 push；tsconfig.web.json 定向检查存在 TaskModePanel/useWebviewLifecycle/MainPage/QuickPage/appStore 等历史 TS 报错，与本次合并无关

### 22:02 | agent

- done: 安装器 CLI 选项页说明文案中的 Agent 示例由 Devin 改为 Codex（Codex、Claude Code 等）
- modified:
  - `build/installer.nsh`

### 21:42 | agent

- done: 升级应用版本至 v1.3.1 并完成 NSIS 安装包打包（dist/MultiChat Setup 1.3.1.exe，125MB，latest.yml 已更新）
- context: 版本号由 app.getVersion() 从 package.json 读取，package.json 与 package-lock.json 为唯一需同步位置；npm run build:win:nsis 一次性完成编译与 electron-builder NSIS 打包
- modified:
  - `package.json`
  - `package-lock.json`
- removed:
  - 
ul`

### 18:06 | agent

- done: 实现安装包可选装 multichat CLI 并加入 PATH + 应用内 Agent Skill 集成引导：NSIS 复选框页与 PATH 注册/卸载清理、cliIntegration 主进程模块（状态查询/PowerShell 补挂 PATH/Skill 目录定位）、cli:* IPC 与 preload 契约、设置抽屉集成区块、首启一次性引导卡片
- context: 用户希望安装期可选装 CLI 并提醒用户给 AI Agent 装配套 Skill；验证过 npm run build 与 electron-builder NSIS 双侧编译，shim 实测 daemon status 连通
- decision: CLI 对外命令名统一为 multichat（cli/ 子目录 shim，不污染 INSTDIR）；Skill 只给说明不代装；首启引导卡片用 PATH 检测 + store 标记实现一次性提示
- added:
  - `build/cli/multichat.cmd`
  - `build/cli/multichat.sh`
  - `src/shared/types/cli.ts`
  - `src/main/cliIntegration.ts`
  - `src/renderer/src/components/CliIntegrationSection.tsx`
  - `src/renderer/src/components/CliAgentHint.tsx`
  - `src/renderer/src/utils/cliGuide.ts`
- modified:
  - `build/installer.nsh`
  - `electron-builder.yml`
  - `src/main/ipcHandlers.ts`
  - `src/preload/index.ts`
  - `src/renderer/src/components/SettingsDrawer.tsx`
  - `src/renderer/src/components/Layout.tsx`
  - `.devin/skills/multichat-cli/SKILL.md`
  - `.devin/skills/multichat-cli/scripts/run_task.sh`
  - `build/MACOS_FIRST_OPEN.md`
  - `AGENTS.md`
- removed:
  - `build/multichat-cli.cmd`
  - `build/multichat-cli.sh`
- lesson(promoted): electron-builder nsis.include 被注入到生成脚本头部（先于 common.nsh/MUI2/LogicLib），自定义 Function 体内用到的宏必须在 installer.nsh 自己 include（nsDialogs.nsh 会连带 LogicLib+WinMessages）；PATH 操作用 WriteRegExpandStr 保 REG_EXPAND_SZ，改完需 SendMessage HWND_BROADCAST WM_SETTINGCHANGE 广播

### 17:39 | agent

- done: 验证 session_log.py stdout UTF-8 修复
- modified:
  - `.memory/session_log.py`

### 17:39 | agent

- done: 为 multichat CLI 创建专属 skill（.devin/skills/multichat-cli）：SKILL.md 涵盖入口解析、preflight、submit→wait→result 工作流、research/追问/多平台 fan-out 场景、错误码表；scripts/run_task.sh 封装提交+轮询闭环，已用 deepseek 实测端到端通过
- context: CLI 契约来自 src/cli/commands.ts + src/main/daemon/ipcServer.ts + docs/agent-cli-dev-plan.md；daemon 实测在线，platforms 返回 13 个平台
- added:
  - `.devin/skills/multichat-cli/SKILL.md`
  - `.devin/skills/multichat-cli/scripts/run_task.sh`
- lesson(promoted): done 终态的 task.status/submit --wait 响应已内嵌 reply，多数场景无需再调 task.result

### 17:26 | agent

- done: CLI输出契约优化：默认输出翻转为JSON（--json变兼容no-op），新增--text人类可读模式；done终态在单任务响应（submit --wait/status）内嵌reply省去一次result往返（Google LRO/AIP-151模式），task.list批量视图不内嵌；AgentTaskView加可选reply字段；验收脚本同步--text用例+新增D8内嵌断言，89 PASS/0 FAIL/0 SKIP，持久化记录内嵌链路实机验证
- modified:
  - `src/cli/commands.ts`
  - `src/main/daemon/ipcServer.ts`
  - `src/shared/types/agentTask.ts`
  - `scripts/agent-cli-acceptance.mjs`
- lesson(promoted): 异步任务API的业界模式：Google LRO(AIP-151)在operation done时直接内嵌response，单任务响应内嵌reply+批量列表不内嵌是省一次工具调用又不爆列表体积的平衡点；CLI翻转默认输出时isJsonMode改为!opts.text比加env开关更直观

### 16:59 | agent

- done: Agent CLI 真机E2E全量验收：新daemon起服后platforms(13平台)/task.list/token鉴权/submit-wait-done实测gemini21.5s+chatgpt27.3s均done，conversationUrl捕获归一，conversation追问落同页，FIFO排队queuedPosition=1，cancel三相(queued/preparing/generating)正确落地，CAPABILITY_UNSUPPORTED(claude research)正确，终态全量落盘；修复cancelled不落盘遗漏；验收脚本token感知后88 PASS/0 FAIL/0 SKIP
- modified:
  - `src/main/services/AgentTaskService.ts`
  - `scripts/agent-cli-acceptance.mjs`
- lesson(promoted): Electron系IDE终端自带ELECTRON_RUN_AS_NODE=1，须env -u ELECTRON_RUN_AS_NODE npm run dev否则electron.app undefined崩溃；kill_shell只杀npm壳electron主进程成孤儿仍占管道须taskkill //PID main //T；git-bash下node -e与heredoc中反斜杠管道路径被MSYS二次坍缩，管道测试要落盘为文件或用fromCharCode构造
- unresolved: research深度研究实机路径未跑(耗时10min+)；wait超时返回实时快照与queueTimeout边界仅代码审查+mock验证

### 16:10 | agent

- done: Agent CLI 全量实施+独立worker验收：agentTask.ts契约、conversationUrl.ts共享URL工具、AgentTaskService（状态机/FIFO租约/就绪探针/轮询/双超时/取消/持久化200条7天TTL/shutdown）、ipcServer鉴权全平台修复+task.*路由+waitMs长轮询、CLI task命令组+platforms+三通道query+exit2语义；worker深审13项全修（queued取消不出队、poll单次exec零容忍、query型会话URL回归、auth墙跨origin误伤、taskId路径穿越、commander exitOverride顺序、双导航等），验收脚本84 PASS/0 FAIL
- added:
  - `src/shared/types/agentTask.ts`
  - `src/shared/utils/conversationUrl.ts`
  - `src/main/services/AgentTaskService.ts`
  - `scripts/agent-cli-acceptance.mjs`
- modified:
  - `src/main/daemon/ipcServer.ts`
  - `src/main/index.ts`
  - `src/main/services/AutomationService.ts`
  - `src/main/services/MindmapService.ts`
  - `src/shared/utils/webviewScripts.ts`
  - `src/cli/client.ts`
  - `src/cli/commands.ts`
  - `src/cli/index.ts`
- lesson(promoted): commander exitOverride 必须在 registerCommands 之前调用——子命令在创建时拷贝 _exitCallback，后设不生效；daemon token 文件须放 getDataPath() 下而非管道名派生路径（Windows Named Pipe 名不能当文件路径）；executeJavaScript 在页面导航/重载期间会瞬时 reject，轮询需按空采计数容错而非单次失败即 INTERNAL；取消 queued 任务必须直接 finalize 出队，仅置标志会导致 pump 仍提取执行产生幽灵窗口
- unresolved: 真实 E2E 未跑：需关闭旧版 MultiChat 实例释放 \.\pipe\multichat-daemon 后 npm run dev，再执行 platforms/task.submit→wait→result/FIFO排队/取消/DR/追问/断连清理等人工验收（验收脚本D5/D6会自动检测新daemon并执行协议级用例）

### 16:04 | agent

- done: Agent CLI 独立验收：深审 task.* 链路 + 新增 scripts/agent-cli-acceptance.mjs（88 用例：PASS=83 FAIL=1 SKIP=4）
- context: 旧版 daemon 常驻本机管道（无 task.* 路由），新版 task.* 端到端需 npm run dev 实测
- added:
  - `scripts/agent-cli-acceptance.mjs`
- lesson(promoted): 验收脚本：NODE_OPTIONS --require 注入 net.connect 重定向 shim 可在无 Electron 下做 CLI↔daemon 协议契约测试；commander 缺必填参数 exit 1 与契约'参数错误=2'不符；AgentTaskService.cancel 对 queued 任务不落地终态是状态机高危缺口

### 15:02 | agent

- done: 按独立 worker 深审结论修订 agent-cli-dev-plan.md：修正导航语义、waitMs 单请求原子化、socket 泄漏清理、响应契约兼容、双超时、verifySubmission、busy 分档、URL 校验、Windows 无鉴权、数据路径、终态顺序等 15 项设计错误
- modified:
  - `docs/agent-cli-dev-plan.md`
- lesson(promoted): 评审 MultiChat daemon/CLI 设计时易漏的真实约束：ensureSessionReady 不负责导航（已加载会话原样返回）；sendResponse 引用作用域外 req 使非 Windows CLI 全挂；Windows Named Pipe 无 token 且 pipe 路径不能存 token 文件；DaemonResponse.error 是 string；每请求一新 socket，wait 挂起需 socket close 清理；generateSendMessageScript 仅附件场景 verifySubmission；generationStopSelectors 只适配 4 平台

### 14:52 | agent

- done: 合并 Agent CLI PRD 与技术方案为单一开发方案文档
- added:
  - `docs/agent-cli-dev-plan.md`
- removed:
  - `docs/agent-cli-prd.md`
  - `docs/agent-cli-technical-design.md`

### 14:48 | agent

- done: 制定 Agent CLI 开发方案：PRD + 技术方案文档（task.* 异步任务协议、AgentTaskService 状态机、回复完成检测、wait 长轮询、会话语义）
- context: 借鉴 WebAI-to-API 把网页版 AI 包装成本地 Agent 可调用服务；基于已有 cli/daemon/AutomationService/SessionManager 雏形
- decision: model 参数一期仅声明元数据；MCP 二期；会话=每次新对话+可选追问；任务类型不固定，通用 query 提交
- added:
  - `docs/agent-cli-prd.md`
  - `docs/agent-cli-technical-design.md`

