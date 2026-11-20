# Knowledge

Long-term reusable lessons, durable decisions, and recurring project gotchas.

Do not copy ordinary session history here. Promote only stable knowledge that is likely to help future agents across sessions.

先读 INDEX.md，仅加载匹配的 `###` 主题。各主题中的实现位置以当前代码为准；站点 DOM、依赖版本和桌面交互结论仍需在对应环境验证。源码核对不等于运行时验收，具体待验收事项留在 SESSION_LOG/TODO，不在这里改写任务状态。

新增知识应写清适用条件、有效结论和依据；未经证实的原因留在日志。新证据推翻旧结论时在原条目修正，避免并列冲突；新增主题同时更新 INDEX。具体样式数值、性能观测和工具默认值不升级为普遍规则。

## Candidates for AGENTS.md

- None yet. 全局纪律已在 AGENTS 中声明；领域经验经 INDEX 读取，不为凑数量提升 Known Gotchas。

## Debugging Lessons

### 1. Webview 输入、选择器与回复采集

- 更新站点回复选择器时，必须检查前台总结、后台导图和整段对话快照的实际执行路径，并确认本地旧配置不会屏蔽新增候选。站点补充候选统一维护在共享配置中，按主机名合并到实际采集脚本；类名有变化的后缀时匹配稳定前缀。快照还需识别用户与助手角色，并去除嵌套容器的重复命中，不能以最新助手回复替代整段对话。

- 网页版 AI 将 Markdown 渲染为 DOM 后不能依赖标记整行相等或通用 HTML 转换保留列表缩进；结构化输出应保留代码块原文，并将未完成与已完成但无法解析分开处理。

- **虚拟代码框需要读取完整文档模型**：CodeMirror 只将视口附近内容渲染到 DOM，代码块复制结果完整并不代表 `textContent` 完整。需要按最新助手回复限定范围，从编辑器 `state.doc` 读取全文，再回退普通代码块；识别到虚拟编辑器却无法读取模型时应明确失败，禁止保存可见片段。DOM 到 EditorView 的关联属于内部实现，必须兼容版本变化并保留只含计数的诊断，不能以构建成功替代实际网页验证。

- **第三方响应式工具栏选择器需结合语义**：同一 `item-icon` 哈希类在窄屏可能是三点菜单，宽屏可能是直接复制按钮；结合父级工具栏与 SVG 语义区分操作。

- **拖拽上传不能信任 renderer 的 `File.path`**：renderer 文件对象的本地路径可能为空或不可用。应把文件内容经受限 IPC 写入主进程管理的临时目录，再将该路径交给 Webview/CDP 上传，并在流程结束后清理临时文件。

- **正则匹配包含中文或其他非单词字符时要显式关闭 wordBoundary**：某些匹配器默认会给模式自动补 `\b`，而中文、连字符、符号类文本会因此匹配失败。遇到这类场景时，必须显式设置 `wordBoundary: false`，不要默认沿用单词边界。

- **富文本注入需区分 DOM 文本、框架状态与幂等守卫**：Slate/Lexical/contenteditable 会将换行编码为节点，直接比较 `textContent` 与含换行提示词可造成重复注入。不能仅因 DOM 插入完成就认定编辑器状态同步成功，也不能统一删除已有校验。优先复用现有插入/粘贴脚本及防重复守卫，使用编辑器适配的规范化读取，并在实际网页核对输入框内容与发送按钮状态。

- **Webview 选择器抓取平台回复内容时的两类高频踩坑（以豆包/千问为例）**：
  1. **hash 后缀 class 必须用属性子串选择器 `[class*="..."]`，不能用精确 class**：AI 平台前端打包后 class 常带 hash 后缀（豆包 `md-box-root`、千问 `source-card-item-mo9ULH` / `message-select-wrapper-answer-rqWekn`）。`document.querySelectorAll('.source-card-item')` 只匹配 class 列表里**精确等于** `source-card-item` 的元素，**不匹配** `source-card-item-mo9ULH`（hash 后缀是 class 名的一部分，不是独立 class）。后果：选择器静默 miss（`length===0`），抓取直接失败或漏数据，且无报错。**判别手法**：Console 跑 `document.querySelectorAll('.xxx').length` 得 0，但 `document.querySelectorAll('[class*="xxx"]').length` 得 N → 必是 hash 后缀。**规则**：抓取第三方平台 DOM 的选择器，凡 class 可能带 hash 的，一律用 `[class*="语义前缀"]`（如 `[class*="source-card-item"]`、`[class*="message-select-wrapper-answer"]`），只有确认无 hash 的纯语义 class（如 `.answer-common-card`）才用精确写法。`selectors.ts` 的 `messageContainer` 候选同样遵循此规则。
  2. **平台改名 class 是选择器失效的首要根因，而非"选择器写法错"**：豆包把 `mdbox-theme-next` 改名 `md-box-root`、千问把 `tongyi-markdown` 体系整体换成 `qk-markdown`/`qk-md-*`，导致旧候选全 miss。**排查第一步永远是先 Console 查当前真实 class**（`document.querySelector('已知回复容器').className`），再据此写候选，不要凭旧 DOM 记忆改。新增候选应**容器级优先**（如 `#qk-markdown-react`、`[data-chat-answers-wrap]`），**段落级靠后或不用**——抓取逻辑取"最后一个可见候选"，段落级候选（如 `.qk-md-paragraph`）会命中回复末尾的多模态卡片块（视频/笔记卡 `.qk-md-has-multi-modal`），导致只抓到卡片标题而丢失正文。
  3. **React `:hover`/合成事件驱动的 tooltip 无法用程序化 `dispatchEvent` 触发挂载**：千问引用来源明细只在悬停上标的 tooltip（`[class*="source-card-item"]`）里，且**常驻 DOM 但仅悬停过的上标才有**。程序化 `el.dispatchEvent(new MouseEvent('mouseover/mouseenter/pointerover',{bubbles:true}))` **无效**（`increased:false` 实测验证）——React 合成事件系统 + `:hover` CSS 只认真实鼠标位置。**结论**：这类 tooltip 来源**无法自动抓全**，只能靠用户手动悬停或 CDP `Input.dispatchMouseEvent` 真实硬件鼠标（重、跨层、违反"避免脆弱 DOM 依赖"）。可接受的降级：正文上标转 `[N]` 标记（`htmlToMarkdown.ts` 里对 `[data-index]` + class 含 `options-item` 的 span 输出 `[N]`）+ 抓取时尽力抓已挂载的 tooltip（能抓几个是几个，无速度影响），不强求完整。判别 tooltip 是否程序化可触发：Console 对未挂载 tooltip 的上标 dispatchEvent 各类 hover 事件，800ms 后看 `[class*="source-card-item"]` 数量是否增加。
  4. **豆包单轮回复已被拆成多个并列渲染块，"取最后可见候选"会命中末块只抓到最后一句**：豆包现把一条助手回复拆成多个并列 `<div data-render-engine="node">` 块，每块内含 `.md-box-root[data-streaming="false"]`，外层包在 `<div data-container-type="block-v2">` 里。**末块常常只是"需要我帮你…/需要我帮你压缩字数…"之类的收尾提示**，不是正文。抓取逻辑取"最后一个可见候选"（`for i=unique.length-1; lastMessage=el; break`）会命中末块，导致只抓到最后一句。既有 `findMergedContentRoot` 只认 `id` 匹配 `/^markdown-content-[0-9]+$/` 的容器，对豆包 hash 后缀 id（`container-qX9Csx` 等）**完全失效**，救不回来。**判别手法（最近公共祖先，勿用长度守卫）**：选定块向上逐级 `parentElement`，对每个祖先跑 `querySelectorAll('[data-streaming], .md-box-root').length`，**第一个 `>=2` 的祖先立即返回、绝不再向上**——这就是单轮容器（含 ≥2 个本回复块的最近祖先必是单轮容器，更近的祖先只含 1 块）。**反例（已踩）**：用 `1.5x` 下限长度守卫（`rootText >= 末块×1.5`）方向反了——它只挡"合并到比正文还短的容器"，挡不住"爬过头到跨多轮根容器"；末块极短或正文短时不满足下限就跳过单轮容器，继续向上爬到跨轮根容器（含全部历史对话+用户query，blockCount 远≥2 且文本远超下限），把**全部对话+query**都抓下来。**修复**：`webviewScripts.ts` 的 `generateGetLatestResponseScript` 加 `findDoubaoMultiBlockRoot`，放 `findMergedContentRoot` 之后，**无长度守卫**，第一个 blockCount≥2 即返回，向上层数收紧到 6（单轮容器离末块约 3 层）作双保险。判别此坑：豆包抓取结果①明显短于屏幕可见正文且恰是末尾收尾句→命中末块；②反而把全部历史对话+用户query抓下来→合并爬过头到跨轮容器。

- **语义兜底与诊断需有边界**：共享自动化步骤支持 regex、exclude、wordBoundary 和菜单入口候选；静态选择器失效时先核对真实 DOM，再使用可见性与语义兜底。网络嗅探仅用于受控开发诊断，不能默认启用或把全量模型回复写入生产日志；它不是当前回复采集必然可用的兜底数据源。

- **诊断与生产匹配语义保持一致**：`selectorDiagnostics.ts` 的只读探针应与共享脚本中的候选筛选、exclude、wordBoundary、可见性和排序语义一致，避免探针命中但实际操作失败。诊断不能触发点击；修改生产匹配时检查对应探针，不把复制代码的逐字相等当成行为正确性的充分证明。

- **任务分配“两段式”发送失败的根因与替代方案**（任务分配模式两段式发送重构得出）：在第一段“注入(insertText)”阶段使用 `generateInsertTextScript` 注入富文本，而忽略了需要同步触发 `InputEvent` 来通知前端框架（如 Slate/React 受控组件）将输入框值更新，导致发送按钮被禁用。且若对 Slate 编辑器使用直接操作 DOM span 等元素会引发 Slate 的内部 `Cannot resolve a Slate node from DOM node` 错误。**修复**：改用人工两步流程，第一步注入使用多 AI 模式下已验证的 insertText 单脚本（带 `isAlreadySame` 防重复注入守卫），第二步确认发送使用已验证的 `sendMessage` 单脚本，以此复用经过磨练的底层脚本路径，最大化减少脆弱 DOM 依赖。

- **Webview 加载失败提示的三个静默漏洞**（WebviewCard 加载失败无提示回归修复得出）：① **`chrome-error://` 被当成功加载**：Chromium 对连接/DNS/SSL 错误（`ERR_CONNECTION_REFUSED`/`ERR_NAME_NOT_RESOLVED`/`ERR_SSL_PROTOCOL_ERROR` 等）会直接渲染内部 `chrome-error://` 错误页并**正常走完 `dom-ready`→`did-stop-loading`，主帧 `did-fail-load` 不再发出**。`handleDomReady` 检测到 `chrome-error://`/`data:text/html` 时若裸 `return`（不清计时器也不设 `loadError`），覆盖层永远不弹，用户只见白屏或 Chromium 自带错误页。**修复**：该分支必须主动 `clearLoadTimers()`+`setIsLoading(false)`+`setLoadError({category:'connection', errorCode:null, ...})`。② **慢速失败超时被 `did-stop-loading` 清掉**：`handleLoadStop` 第一行 `clearLoadTimers()`，若 Chromium 在失败路径上先发一次中间态 `did-stop-loading`，30s 超时兜底被清，之后既无 `did-fail-load` 也无超时，覆盖层不出现。**修复**：`handleLoadStop` 在 `loadError` 已存在或 `getURL()` 仍处 `chrome-error://` 残留态时短路 `return`（只 `syncNavigationState()`），不清计时器/不改状态。③ **休眠唤醒后 `-3` 静默**：`resume()` 重载 URL 时未把 `isFirstLoadRef.current` 置 `true`，唤醒后遇 `-3`（TUN/路由切换中断常见）走 `if (isFirstLoadRef.current)` 分支为 false → 不设 `loadError`。**修复**：`resume()` 中 `setIsHibernated(false)` 后立即 `isFirstLoadRef.current=true`。判别：连接类失败无覆盖层、慢速失败无超时兜底、唤醒失败静默 = 命中本坑。**关联**：与 `urlMismatch` 不能在加载途中触发的既有坑（KNOWLEDGE 上条）同属 WebviewCard 加载事件链，改动时一并审。

- **平台图片下载 DOM 选择器适配经验（image-download-dom 7 家实测得出）**：写 `imageDownload.steps` 时优先用语义 hook——`aria-label` / `data-testid` / `data-icon-button` / `data-image-resource-id` / 语义标签（`download-generated-image-button`），**避开 CSS Modules 哈希后缀类**（`grok-XXX`、`D5bm-XXXXX`、`imageItem-XXXXX`）。中文 UI 平台补中文 label，同时加英文兜底（`下载`/`Download`、`保存`/`Save`、`关闭`/`Close`）。**实测踩过的坑**：ChatGPT 预览 header 下载按钮 aria-label 已从"保存"改成"下载"（UI 改版致旧选择器失效）；豆包生图下载链从 hover 浮层改为"点 `[data-testid=mdbox_image]` → 点 `[data-testid=edit_image_download_button]`"；文心一言 action bar 用 `i.cos-icon-download`（i 元素不是 button，无 aria-label，靠 class 名定位）；Grok 生图旁 `button[aria-label="下载"]` + `data-icon-button` 一键直触下载无需开预览；千问 `popMenuItem` 默认 `invisible`，**必须 hover 触发**且下载项无 aria-label/text，只能靠 `popMenuItem:has(svg[class*="downloadIcon"])` 或 `:nth-of-type(2)` 定位；元宝下载按钮 aria-label 是**小写英文 `download`**（不是"下载"），预览组件是 `hyc-photo-view-chrome-v2`。**iab（Codex 内置浏览器）与 MultiChat `persist:shared` session 不共享登录态**，跨 session 验证要单独登录；智谱 chatglm.cn 有滑块 CAPTCHA 反爬。iab 用 `mcp__cua_repl__js` 的 `cua.listTabs/getTab/createBrowserTab` 驱动，`tab.playwright.evaluate` 只读 DOM（不能 dispatchEvent），`tab.playwright.waitForEvent('download')` 可验证下载触发。
- **CLI `--gen-image` 兜底与平台实测**：`AgentTaskService.captureGeneratedImage` 在 `imageDownload.steps` click 未命中时**必须回退** `generateExtractImagesScript` 拿 `src` 列表，再按 `data:`/`blob:`/`http(s):` 分路径落盘（`data:` 主进程 Buffer 写文件；`blob:`/`http(s):` 走 `webContents.downloadURL`+`will-download` ctx）。qwen `imageItem-`/`imageWrapper-` class 已在 2026-11 改版，click 必失败但 extract 兜底可用，一次回复可能产 4 张图变体要全保。yiyan 未登录态永远只回文本反问"要不要试试"——平台侧行为非框架 bug，`imageError='生成超时未检测到图片'` 是正确容错。`phase==='done'` 时空 reply 也要写 TXT 占位文件，否则 Agent 拿不到结果路径。
- **`generateExtractImagesScript` 生图探针的两个边界**（2026-11 doubao/chatgpt 实测）：① **探针须 `genImageOnly=true`，只认生图专用容器**（`generated-image-gallery`/`generated-image-preview`/`message_image_content`/`mdbox_image`/`image-box-grid`）——`findLatestContainer` 回落 `messageContainer`/`document.body` 会把**用户 `--image` 上传附件的回显缩略图**当"已生成"产物，chatgpt 实测 `imageReady` 提前为真 → 30s 提前 done 抓到上传参考图而非生成图。② **消息容器选择器要把生图容器并入 `messageContainer`**——豆包 `message_image_content` 是文本容器 `[data-streaming]` 的兄弟节点而非子节点，只放文本容器会 `images:[]` 永远探不到。③ 生成中骨架/占位（`[data-finished="false"]`、placeholder/skeleton 祖先）内的 img 是过程产物，`isInProgressArtifact` 过滤，但已确认生图容器（preview/mdbox）内的不算。

- **工作台回复按钮注入的三平台实测坑（2026-11 chatgpt/doubao/gemini）**：`generateInsertReplyButtonScript` 的 `replyItem` 命中容器与「提取正文容器」「用户消息」三者必须分开判定，混用会同时踩中：① ChatGPT 一轮对话是**单个 `.group` 容器同时含用户气泡+AI 正文+AI 操作行**（`turn-action-controls`），replyItem 只能命中整轮，提取 Markdown 必须用 `contentItem: ['[data-chatgpt-search-unit-key$=":assistant"]']` 缩到 AI 正文块，否则把用户消息也抓进去；② 豆包用户消息与 AI 回复**共用 `w-full pl-14` 容器 + `message-action-bar` 操作栏**，判别特征是操作栏内 `data-testid="message_action_edit"`（用户独有「编辑」按钮，AI 是 `like/dislike/朗读`）——`userItemMarker` 命中即跳过该容器；③ Gemini `buttons-container-v2` 的父级是 `display:block` 的 `response-container-footer`，bar 定位向上爬必须**限高 ~56px**，否则从单行按钮行爬进块级 footer、按钮被挤出可视行表现为「注入成功但看不到」。
- **工作台回复按钮注入第二轮实测坑（2026-11 修复）**：④ **高 CSP 平台禁字符串→DOM**：Gemini 开 Trusted Types，`el.innerHTML = svgString` 与 `DOMParser.parseFromString` 都抛 `requires 'TrustedHTML' assignment`，且异常发生在 `bar.__mcBtnsAttached=true` 之后、`insertBefore` 之前——标记已设但按钮不存在，表现为「`attached:true` 但 `mcBtns:0`」极难排查。**修复**：注入 SVG 必须 `document.createElementNS(SVG_NS,'svg'/'path')` 程序化构建，不走任何 HTML/SVG 字符串解析。⑤ **ChatGPT 一轮有两个 `turn-action-controls`**：用户气泡行的（祖先 `flex-row-reverse`）+ AI 回复底部的（`actionRow-xxx` CSS-module 类）。`firstMatch` 按 DOM 序命中第一个 → 按钮挂到用户气泡下方。actionBar 选择器必须限定 `[class*="actionRow"]`。⑥ **平台 `sr-only` 说话人标签会被 htmlToMarkdown 当正文**：ChatGPT 的 `h4.sr-only` 里有「你说：」「ChatGPT 说：」、Gemini 有「Gemini 说」——`elementToMarkdown` 前必须 `cloneNode(true)` 删 `.sr-only/[class*="sr-only"]/[aria-hidden="true"]/actionBar/.mc-*/button` 再转换，否则插入文档带 UI 标签和用户消息。⑦ **流式渲染时序**：actionBar 在回复流式完成后才出现，`ensureButtons` 不能在「没命中 actionBar 就建 fallback bar」时给 `replyEl` 打 `__mcBtnsAttached`——否则原生 bar 出现后 ensureButtons 直接 return，按钮永远停在 fallback（`all:initial` 还会把 `display:flex` 重置成 0 高空壳）。fallback 用专用标记并在原生 bar 出现后迁移按钮。
- **工作台回复按钮注入第三轮实测坑（2026-11 deepseek 修复）**：⑧ **fallback bar 无限 append**：`!bar` 分支每次都 `createElement('div')` 新建 `mc-action-bar` 挂到 replyEl 末尾，但幂等检查 `replyEl.querySelector('.mc-workbench-btn')` 找到的按钮在 fallback 里被判定「不算完事」→ 下次 scan 又建一个——DeepSeek（无原生 actionBar、走 createBar/fallback）实测堆了 2412 个节点。**修复**：① 建 fallback 前先 `replyEl.querySelector('.mc-action-bar')` 复用已有的；② 幂等判断区分「有原生 bar 待迁移」（`!CFG.createBar && CFG.actionBar`）和「本就无原生 bar」（`createBar` 或无 actionBar 配置）——后者按钮在 fallback 里也算完事直接 return。⑨ **DeepSeek 选择器**：AI 正文块是 `div.ds-markdown.ds-assistant-message-main-content`（思考块是另一个**不带该后缀**的 `ds-markdown`），DeepSeek 回复无集中操作栏 → `createBar: true`，replyItem 直接命中正文块。
- **工作台回复按钮注入第四轮实测坑（2026-11 deepseek 位置修正）**：⑩ **DeepSeek 原生操作栏在回复块顶部而非底部**：`_245c867`（hash）是含 `div.ds-icon` 的容器，位于 `_74c0879` 内、`ds-think-content` **上方**、正文块之前——不是常规的「回复底部操作行」。按钮本身是 `div.ds-icon`（语义类）不是 `ds-button`。**选择器**：hash 类会随重渲染失效，用结构选择器 `div:has(> div.ds-icon ~ div.ds-icon)`（含 ≥2 个平级 ds-icon 子元素的容器）稳定命中，replyItem 配 `div.ds-message:has(...)` 整轮 + `contentItem` 缩到正文块。⑪ **observer 要存实例而非布尔标记**：旧版 `window.__mcInsertBtnObserver=true` 无法在重复注入时 disconnect，SPA 内导航/重复注入会并存新旧两套 scan（旧闭包按旧选择器再建 fallback → 重复按钮）。改存 `MutationObserver` 实例、重复注入先 `disconnect()`。
- **工作台回复按钮注入第五轮实测坑（2026-11 deepseek 二次修正）**：⑫ **「已思考」行的按钮组会被误当回复操作栏**：DeepSeek `_5ab5d64`（`ds-think-content` 所在 `_74c0879` 顶部、含 div.ds-icon）其实是思考块的头部按钮组，不是回复底部操作栏。真正的回复操作栏 `div.ds-flex._965abe9`（含 6 个 `div.ds-button` 复制/重试/👍👎/朗读/分享）是 `ds-message` 的**兄弟节点**（同在父容器 `_4f9bf79` 下），不在 ds-message 内部。**配置**：`replyItem` 用 `div:has(> div.ds-message + div.ds-flex)` 命中含两者的父容器（`+` 紧邻兄弟限定，全页只命中 AI 那组；用户消息父容器不满足）；`actionBar` 用 `div.ds-flex:has(> div.ds-button ~ div.ds-button)`。**教训**：回复操作栏不一定在 replyItem 容器内部，可能在其兄弟容器——replyItem 要命中能同时包住回复+操作栏的公共祖先。


### 2. 深度研究与跨 frame 提取

- **Deep Research 跨域报告提取的边界**：顶层 Webview 脚本不能直接读取跨域报告 iframe。历史排查发现 ChatGPT 报告可能同时跨 child target 和 execution context；仅递归 target 或仅按 URL 筛选都不完整，`about:blank` frame 也可能承载报告。探索时可结合递归 `Target.setAutoAttach`、`Page.getFrameTree`、`Page.createIsolatedWorld` 与带 session/context 的 `Runtime.evaluate`，并只 detach 自己附加的 debugger。此为排查经验，不能视为当前已验收的产品能力；TODO 仍保留提取失败事项，真实报告完整性与耗时必须重新验证。

- **关键回退在能力边界识别稳定信号**：当多个调用点容易漏传可选参数时，Webview 能力边界可根据稳定页面信号识别是否需要回退，上层参数只表达等待模式等业务意图。需核对当前 Hooks 与调用链，不把历史 Deep Research 参数方案当成已实现能力。Electron main 改动后完整退出并重启开发应用；renderer HMR 或构建成功不能证明运行中的 main 已加载新代码。

- **Deep Research 选择器 2026-11 实测（docs/deep-research-dom/ 13 平台报告）**：各平台已弃用 `data-testid`/`data-log-*`/`tagBtn-*` 类钩子，转向 `aria-label` + `role` + 文本语义；菜单 role 多样化（无 role 的 `<button>`、`listbox/option`、`menu/menuitem`、自定义元素 `TOOLBOX-DRAWER-ITEM`），选择器须备多 role 候选。具体：chatgpt `+` 改 `button[data-composer-navigation-target="add-context"]`、菜单项为无 role button；perplexity 研究在 `+` 菜单 `div[role=option]`；qwen 经 `button[aria-label="选择模式"]` 菜单 → `div[role=menuitem]`"深入研究"；gemini 变两级（`aria-label="上传和工具"` → `更多工具` → item）；doubao "深入研究"已从 skill 栏下架；kimi 是 `<a href="/deep-research">` 独立页非切换；yuanbao 有 `data-application-id="application_id_deep_research"` 稳定钩子；文心无 DR 开关；deepseek"深度思考"是推理开关非 DR。iab 不共享 `persist:shared` 登录态；spawn 的子 agent 无独立 iab 浏览器面，CUA 浏览器工作须由持有会话的 agent 执行。
- **AutomationStep 选择器编写/验收要点（2026-11 selectors v19 实测）**：`selector` 数组按顺序取第一个可见命中，之后 text/regex/exclude 过滤；菜单/模式入口不一定是 `<button>`（qwen 为 `div.mode-select-open[role="button"]`、gemini 为自定义 `TOOLBOX-DRAWER-ITEM`、chatgpt 菜单项为无 role `<button>`），写 opener 时先查真实 tag/role 再写 `tag[role=...]` 复合选择器。验收方式：iab 里按 step 顺序 evaluate 命中→点击→下一步，simulate 整个链而非只看单个 selector。


### 3. Markmap 布局、连线与命中区域

- **Markmap 节点内中文文本坍塌为单字竖排（垂直折行）**：Markmap 在初次向 SVG 插入 `<foreignObject>` 时尚未计算和指定其 `width` 属性。Chromium 渲染引擎在测量 `scrollWidth` 之前，面对无固定宽度的 SVG 容器，会将包含可断行字符（如中文 CJK 字符）的行内块级元素压缩至其最小内容宽度（min-content），导致每个汉字在字间断行坍塌为单字一行的竖排文本；随后 `_relayout()` 测得的 `scrollWidth` 仅为单个汉字宽度（~16px），并将 `foreignObject` 宽度永久固定为 16px。**解决方案**：在 CSS 中必须为外层容器 `.markmap-foreign`、其内部嵌套 `div` 以及 `.mm-node-item`、`.mm-node-title` 统一强制声明 `white-space: nowrap !important;` 与 `width: max-content !important;`，彻底杜绝软折行与竖向坍塌。

- **外溢按钮影响节点测量**：Markmap 的 scrollWidth 可能包含绝对定位子元素，opacity:0 或父层零尺寸不等于不参与测量。非显示态按钮需核对 display:none，连线端点结合节点 offsetWidth、布局 rect 与 foreignObject 的 x/paddingX 校正，避免悬空。历史约 40px 偏移与 1–2px 穿透量是当时样式观测，当前值以实现和视觉验证为准。

- **节点按钮与折叠状态**：隐藏 Markmap 原生 circle，避免与自定义添加/折叠按钮重叠。按钮应脱离文本尺寸计算并保持稳定命中；是否显示不能改变连线几何。`initialExpandLevel: -1` 对应初始全展开，运行时展开全部需更新树的 fold 状态并 setData；仅在用户要求适配视图或视口无效时 fit，正常编辑与展开操作保留用户视口。

- **尺寸与连线几何保持一致**：Markmap 根据布局 rect 测量连线端点，外溢的绝对定位按钮可能增大 scrollWidth；需要结合真实节点 offsetWidth 和 paddingX 计算边缘，不能用透明度隐藏来假定按钮不占测量宽度。正交连线的中心点、折角和 spacing 应由当前实现计算；历史 46px、0.42 或其他数值是视觉取舍，不是通用约束。

- **包装层不能遮挡子孙节点**：默认大宽度的 foreignObject 包装 div 在 overflow:visible 下可成为透明命中遮罩。核对 localMindmap.css 中包装层的尺寸与 pointer-events，仅真实节点/按钮接受点击，SVG 连线不拦截事件；保留文字 nowrap/max-content 与按钮外溢需求，不能全层统一 width:auto 导致中文再次坍塌。


### 4. Markmap 可见性、缩放与视口

- **隐藏画布不能参与首次 fit**：Markmap.create(svg, options, data) 在数据布局完成后会 fit，autoFit:false 不能阻止这次初始化行为。当前 `useMindmapCanvas.ts` 创建实例时不传 data；SVG 可见且宽高有效后 setData，再按首次适配或变换无效状态 fit。正常树更新保留缩放和偏移，避免编辑或 ResizeObserver 的细微变化反复触发适配；尺寸阈值是实现取舍，不能固定为通用的 40px 规则。此机制可由源码核对；隐藏重开、拖动、缩放与新增节点的验收状态应查对应日志，不能由 lint/build 推断验收完成。


### 5. Markmap 编辑与状态生命周期

- **编辑状态不能重建节点 DOM**：selectedNodeId/editingNodeId 的纯 UI 变化不要触发 setData，避免销毁正在编辑的 DOM、Range 和焦点。树数据变化才 setData，选中/编辑态通过 DOM class/属性同步；setData 后恢复高亮。Markmap 的 fit/centerNode 依赖完整 D3 transition 接口，不能把 transition 替换为原始 selection；当前采用 duration: 0，保留接口。点击命中需兼顾 foreignObject、包装 div 与节点本体。

- **树更新与事件命中**：避免在 setTree 更新函数里再次调用触发 setTree 的提交函数；基于 treeRef 的最新树执行编辑，保持持久化与 React 状态一致。透明包装层和 SVG 连线不应截获点击，只给实际节点与按钮开启 pointer-events。节点微背景是历史命中问题的处理经验，需结合当前样式及桌面 Hit Test 验证，不宣称对所有 Chromium 版本必然有效。

- 在包含 SVG foreignObject 和 D3 zoom 的画布中，使用 DOM focus() 必须显式传入 { preventScroll: true }，否则 Chromium 会自动滚动最近的祖先容器导致整块画布视口突变；为浮动在节点边缘的操作按钮配置扩大命中范围的伪元素时，必须确保按钮自身具备独立的定位层级（relative + z-index），防止其父级绝对定位的伪元素将真实按钮遮挡拦截


### 6. React 状态与共享 UI

- **跨页提升共享 UI 必须迁移实例与消费回调**：把抽屉、弹窗等共享 UI 提升到 App 层时，必须同时移除原页面实例，并把原页面回调接到新的 pending 状态消费点；只替换顶部状态变量会造成按钮触发但没有实际恢复逻辑。

- **持久化列表按稳定业务 ID 双层去重**：提示词、模型等列表来自磁盘配置时，读取侧和渲染侧都应按稳定业务 ID 去重；局部变量命名还应避免与旧 HMR 模块中的同名绑定产生歧义。

- **同一事件中的状态更新不立即改变闭包值**：先 setState 再同步调用读取该 state 的函数，仍可能读到当前渲染的旧值。可直接传入新值，或在必须跨异步回调读取时同步更新 ref 镜像；不要一律增加镜像层。历史 API 总结的空快照问题说明了这种风险，但旧 useSummaryPanel 已删除，当前修改应定位实际持久化调用点。

- **定时回调需要最新状态时选择合适的同步方式**：依赖数组会按状态变化重建回调/定时器，这是可接受的实现选择；只有需要稳定调度器时才用 ref。effect 同步镜像适用于后续定时触发，同一事件立刻读取新值应直接传参或同步写 ref，不能把两种时序混用。

- **React 初始化顺序与 TDZ**：渲染期执行的 useMemo/派生表达式不能引用尚未初始化的 const/state，否则会触发 ReferenceError。useEffect 回调在提交后执行，不应笼统认定为渲染期立即执行；其依赖数组表达式仍在渲染期求值。被依赖状态先声明，递归树纯函数优先放模块作用域，避免初始化时自引用 useCallback。定向类型检查与实际页面触发应结合使用。

- **执行旧计划前重新核对代码锚点**：行号、Find/Replace 块和函数签名可能随代码演进漂移。修改前用 rg 和文件读取核对实际入口；在原授权范围内调整实施细节，只有目标、范围或风险发生实质变化时才重新确认。不能盲套旧计划，也不为每次锚点漂移增设计划文件。

- 当React组件在不同模式分支下分别渲染挂载了同一个ref的DOM元素时，若useEffect仅监听isActive而不监听DOM节点或模式切换，会导致ResizeObserver滞留于已卸载节点并上报0宽度，新节点未被监听从而永久冻结在0px。必须使用callback ref追踪DOM节点变化，并在CSS Grid列宽处提供minmax(0, 1fr)安全保底

- UI 组件尺寸必须与应用核心面板（如 SettingsDrawer）规范看齐，避免局部页面为了紧凑而过度使用 text-xs 或 text-[10px] 导致可读性与点击舒适度下降

- 在包含受控/非受控混用场景（如 initialMarkdown）的 React 组件中，避免在依赖项中监听内部编辑状态（markdown）来进行同步，否则内部任何状态更新都会被判定为与外部不同并触发强制回滚；对于绝对定位的 hover 操作按钮，需避免子元素与父元素之间出现事件空隙导致 hover 闪退

- **工作台多格式预览与写盘安全**：在扩展文本编辑器支持只读或二进制文件（图片/PDF/DOCX 等）时，必须严格在 Zustand store、全局快捷键（Ctrl+S）与主进程 `writeFile` 三层严密拦截写盘调用，否则 Ctrl+S 会将空文本写入二进制文件造成不可逆数据破坏；各格式专属预览组件必须在路由分发时绑定 `key={activeFilePath}`，确保切换文件时自动重置缩放、旋转与编辑等局部状态。


- **工作台文件树外部文件导入（拖入/粘贴）**：Electron 32+ 已移除 `File.path`，本地路径取 `window.electron.webUtils.getPathForFile(file)`（`@electron-toolkit/preload` 的 `electronAPI` 已自带 `webUtils`）；拖入的**目录也会作为条目出现在 `dataTransfer.files` 中**且 `getPathForFile` 返回目录路径，主进程 `stat.isDirectory` 区分后 `fs.cp recursive` 即可。区分内部移动与外部导入用 `e.dataTransfer.types.includes('Files')`（内部拖拽只设 `text/plain`）。paste 事件只派发到焦点元素，文件树容器需 `tabIndex={-1}` + `onMouseDown` 里 `currentTarget.focus()`（跳过 `HTMLInputElement`）才能接 `onPaste`；剪贴板文件经 `clipboardData.files` 取，为空的文本/图片粘贴放行给编辑器。

### 7. 划词、快捷键与窗口交互

- **可重复交互的 Electron 悬浮窗口**：避免同时使用 `focusable: false` 和依赖完整 `click` 事件。用 `showInactive` 控制弹出时不抢焦点，让窗口保持可聚焦，并在 `pointerdown` 派发一次性动作。

- **后台自愈按失效资源重启**：原生 Hook 静默失活时重启 Hook/UIA 并清理手势状态；仍健康的工具条 BrowserWindow 保持运行，避免重建后按钮失效。

- **macOS 选区读取不得复用 Windows UIA helper**：Windows 的 PowerShell UIA helper 只能在 `win32` 启动；macOS 选区读取必须经过平台抽象，并在 AX 原生模块不可用或辅助功能权限不足时返回明确的 unsupported/permission 错误，不能静默启动 PowerShell、模拟复制或伪造读取成功。

- **自动划词工具条用 UIA 真值校验**：Windows 工具条通过 TextPattern.GetSelection 非侵入读取外部选区，并比较按下/松开快照确认本次新选区；鼠标距离仅作粗筛，不发送 Ctrl+C。UIA 不可读时安全降级不弹，不把旧剪贴板或手势当选区。常驻 PowerShell helper 的行协议采用 base64 文本，显式 UTF-8，Console.Out.WriteLine/Flush 输出，stdin 关闭及超时需清理/重启。macOS 经平台 selectionReader，不能启动 Windows helper。

- **Windows 后台窗口抢焦与置顶闪烁**：在 Windows 平台下，当 Electron 后台窗口或隐藏窗口试图直接调用 `window.show()` / `window.focus()` 时，操作系统防抢焦点机制（SetForegroundWindow 限制）会阻止其置顶并引发任务栏或窗口边框闪烁。解决方案：通过临时开启 `win.setAlwaysOnTop(true)` 再调用 `win.focus()`，并在 50ms 后自动恢复 `setAlwaysOnTop(false)`（需注意保存并尊重用户原本的 isAlwaysOnTop 状态），即可实现稳定强行聚焦与置顶。

- 快捷窗口（quickWindow）是独立的 `BrowserWindow`，主窗口的 `did-attach-webview` 监听器不会自动继承给快捷窗口。任何新增窗口都必须单独为其 `webContents` 注册 `did-attach-webview` 事件，否则该窗口内 Webview 的脚本注入与链接拦截将完全失效，导致外部链接无法在系统浏览器中打开。修复方案：将注册逻辑提取为 `registerWebviewHandlers(webContents)` 公共函数，在所有宿主窗口中复用。

- Electron 快捷键自动复制选中文本（Windows）：
  1. **等待按键释放**：触发全局快捷键时先 `sleep(250)`，以防用户的物理手指仍按在 `Ctrl/Shift` 上导致模拟按键冲突（触发 `Ctrl+Shift+C`）。
  2. **轻量模拟脚本**：使用 VBScript 写入 `.vbs` 文件并使用 `execFile('cscript.exe', ['//NoLogo', path])` 异步执行。VBS 启动仅需 ~10ms 且完全隐藏，比 PowerShell 更快且绝不抢焦。
  3. **精确监测与兜底**：先 `clipboard.clear()` 再模拟按键，等待 150ms 写入缓冲后读取；若无新数据写入（说明用户未选中文本），将旧数据写回剪贴板还原，**但必须返回空字符串 `''`**，切勿将陈旧的旧剪贴板内容作为选中文本返回；且划词操作回调中必须拦截空文本，不唤起弹窗。

- **[关键陷阱] 全局快捷键 + SendKeys 焦点顺序**：在全局快捷键回调中必须先执行模拟复制动作，**最后**再执行 `qw.show() / qw.focus()` 唤起并聚焦 Electron 快捷窗口。若顺序相反，焦点会立即被 Electron 夺走，按键模拟将打在 Electron 自身，导致外部文本复制失效。

- **主窗口拖动按平台分支**：当前 Windows/Linux 标题栏由 Pointer Capture 与主进程拖动 IPC 实现，macOS 使用原生 app-region。不要将历史 Windows 拖动缺陷扩大为所有平台禁止 drag-region；修改时核对 Layout 与 ipcHandlers 的平台分支、最终 pointerup/cancel 提交及最大化行为。

- **monio-napi 回调按实际载荷形状解包**：当前 inputHookManager 支持 EventJs 或 EventJs[]，批量载荷逐个 processEvent；不能只根据 d.ts 把数组当对象。字段全 undefined 时先检查脱敏后的形状信息，不猜字段或 OS 原因。纯 Node 隔离诊断还需排除消息泵和测试代码自身的解包问题。未单独验证的其他 callback 形状只能作为待查假设；未经运行时证据证实的根因不能升为有效知识。

- **原生输入 Hook 的健康检查不能只看 `isRunning`**：原生对象仍标记为运行中，不代表回调线程还在持续派发事件。长运行场景应使用独立信号交叉判断：记录最后一次 Hook 回调时间，并用 Electron `powerMonitor.getSystemIdleTime()` 确认系统近期确有用户输入；当系统输入活跃而 Hook 回调持续陈旧时，主动重建监听。重建失败使用有上限的退避重试，并确保显式停止时取消待执行重试，避免用户关闭功能后监听自行复活。设置开关也只能在 Hook 实际启动成功后持久化为启用，失败路径必须回滚状态和窗口。

- **不要用未经运行时验证的 `EventJs.time` 给拖选增加硬时长门槛**：`monio-napi` 的类型声明只能证明字段存在，不能证明不同原生后端的单位、基准和批量派发语义适合业务阈值。曾新增 `150–2000ms` 过滤后，用户重启开发服务器实测所有划词都无法进入工具条链路。已有 UIA 按下/松开选区快照能够确认是否产生本次新选区时，鼠标层只保留必要的拖动距离粗筛；不要在进入真值校验前用未验证的事件时长丢弃快速或长时间的合法选词。双击间隔继续使用主进程 `Date.now()`。

- **划词与快捷键是两条路径**：全局鼠标手势不足以证明产生了文本选区，工具条还需 UIA 快照与本应用焦点守卫。用户主动触发的快捷操作可走 `shortcutManager.ts` 的复制路径，必须先读取再显示/聚焦窗口，并处理剪贴板恢复。

- **快捷键录制过滤输入法暂态事件**：Process、Unidentified、Dead 以及 keyCode 229 不能作为最终主键；Ctrl+Shift 输入法切换可能产生这些事件，需等待有效物理键/功能键，避免仅按修饰键就提交。

- **monio-napi 事件批处理会破坏拖拽时长判定**：`startListen` 的运行时回调可能一次派发多个事件；如果使用主进程 `Date.now()` 的最小时长门槛过滤拖拽，会把真实拖拽误判为无效。应以实际位移和松手时的选区读取作为最终判断，不要把跨事件的时间阈值当作唯一依据。

- **工作台/含 `<webview>` 布局的分隔条要留足命中区域**：`<webview>` 是原生插件层，会优先接管落其矩形范围内的指针命中，DOM 侧的 `z-index` 与负 margin 无法保证分隔条可被点中（表现为窗口变小/非最大化时"拖不动"）。分隔条应做宽于视觉线的命中区（如 10px 外框 + 4px 视觉线、避免负 margin 叠进 webview 矩形），`onPointerDown` 后用 `setPointerCapture` + window 级 `pointermove/pointerup`，并配合全屏透明遮罩接管事件直到松手。

- **Windows 多 WebView 无框窗口的最大化黑闪应绕开原生 overlay**：`titleBarOverlay` 的最大化按钮可能绕过 renderer IPC，直接触发原生 `maximize()` 并重建 Chromium swap chain。出现黑闪时，应移除 win32 overlay 控件，由自绘按钮调用基于工作区的 `setBounds`，同时保存还原边界。

- **Windows 多 WebView 主窗口的拖动必须合并高频 pointermove**：保留 Pointer Capture 与 `setContentBounds`，按渲染帧限速合并移动事件，并在 `pointerup` / `pointercancel` 提交最终位置，避免 IPC 和窗口合成队列堆积导致卡顿与拖影。

- 快捷操作快捷键（Ctrl+Shift+S/E/T/Q）的提示词注入流程：先通过 VBScript 模拟 `Ctrl+C` 自动复制选中文本，读取成功后，再展示并聚焦快捷窗口，最后发送 `quick:inject-prompt` IPC 完成一键总结。

- quickWindow 初始配置 `alwaysOnTop: false, skipTaskbar: false`，让用户通过 pin 按钮自行决定是否置顶。`skipTaskbar: true` 会导致窗口被其他窗口遮挡后无法通过任务栏找回，用户体验差。isPinned 状态由前端 toggle 按钮驱动，通过 `quick:get-always-on-top` / `quick:set-always-on-top` IPC 控制。

- **Frameless Electron 独立窗口使用 w-screen h-screen overflow-hidden 消除 body 背景溢出**：在 Electron 的无边框窗口（`frame: false`）中渲染独立页面时，如果该页面的最外层容器声明为 `w-full h-full`，但父级 HTML/Body 及 React `#root` 未声明高度（默认 height: auto），会导致容器高度发生塌陷，退化为内容高度。由于 Electron 窗口具有物理固定宽高（例如 900x700），塌陷容器下方多余的视口空间会被 `body` 的 CSS 背景（如 radial-gradient 等渐变背景）直接填充，表现为“诊断页底栏下方出现大片无用空白/渐变底色”。**正确做法**：将独立窗口的顶层容器直接声明为绝对视口宽高的 `w-screen h-screen overflow-hidden`，使其强制填充 Electron Window 并阻止 body 溢出滚动，同时使用 flex 布局的 `flex-1 overflow-auto` 赋予内部面板响应式滚动能力，底栏自然贴合底边。

- **`WebContents.findInPage` 的 `findNext` 参数语义相反**：Electron `WebContents::FindInPage` 底层 C++ 将 `options.findNext` 直接映射给 `blink::mojom::FindOptions::new_session`。因此首次搜索或修改关键词时需传 `findNext: true`（开启新查找会话），而上下步进跳转时需传 `findNext: false`（延续当前查找会话）。

- **macOS 26 System Events 移除了 `focused UI element` 对象语法**：`focused UI element of <process>` 在 macOS 26 编译报错 -2741；改读进程属性 `value of attribute "AXFocusedUIElement"`（selectionReader.ts）。AX/系统事件脚本跨版本易失效，升级 macOS 后需实测。

- **macOS 红绿灯定位须用 `titleBarStyle: 'hidden'` + `trafficLightPosition`**：`trafficLightPosition` 对 `hiddenInset` 不生效（Inset 强制内嵌位）；坐标是 OS 点单位，红绿灯圆心≈设定值+6.5，无头机截屏像素坐标≠OS 坐标需按实际像素对齐。

- **macOS Tray 彩色图标不能走 template 且方法在 nativeImage 上**：template image 只保留 alpha 剪影会渲染成黑色；要显示彩色应用图标不能调 `setTemplateImage`，图标建议 `resize` 到 ~22px。`Tray` 实例本身没有 `setTemplateImage` 方法（误调直接崩溃），应对 `nativeImage` 调用 `nativeImage.setTemplateImage(true)`；`assets/` 下无 `tray-iconTemplate.png` 时回退 `logo.png`。


## Stable Decisions

### 8. 笔记、快照与会话身份

- 来源会话键应保留完整规范化URL路径，截取第一个chat片段会把chat/s/id1和chat/s/id2错误分为同一会话

- **工作台文档与导图的绑定以路径为身份、以指纹判改名**：记录键由「规范化工作区路径 + 相对路径」派生，不写文档 frontmatter。文档删除时导图立即删除（应用内删除提示“不可恢复”，不做保留期）；外部改名/移动无法与删除区分，只能在文件树刷新后对账：先让路径仍在的记录占位，再对路径消失的记录按「size + mtime 完全一致」筛候选，唯一候选直接重连，多候选读文件比内容哈希，仍不唯一就按删除处理，绝不猜。对账索引必须由渲染层随文件树传入，主进程不再自行扫盘；按 size+mtime 建桶后再匹配，避免整目录删除时的平方复杂度。删除前再单独 stat 一次，只有 ENOENT 才删，工作区根不可读时整轮跳过。保存成功后只更新哈希与指纹、不推进快照，避免自动保存把导图面板刷成高频重载。生成任务持有的是生成开始时的 sourceKey，期间若被改名重连，保存时查对账留下的「旧路径→新路径」映射跟随新记录，比按内容回查更准，不会误挂到同内容的另一篇文档。

- 抓取网页对话时，ChatGPT 等平台 DOM 自带无障碍头 (如 <h4>你说：</h4>)，在 htmlToMarkdown 时会被转为 Markdown 噪音；因此提取消息必须主动过滤 DOM 伴生噪点，使用 XML 标签隔离结构，彻底避免语法与格式污染


### 9. 历史恢复、轮询、休眠与内存

- **轮询抓取空结果不能累计稳定次数**：空字符串表示页面尚未产出、跨 frame 目标尚未出现或本次读取失败，不是“内容稳定”。只有非空且满足业务基线条件的内容才能累计稳定计数；空结果必须保持未完成并继续轮询，否则会在真实回复出现前误判结束。

- **恢复历史时产品模式切换会重置会话锚点**：若恢复流程调用 `setProductMode`，必须在模式恢复完成后重新设置 `isNewSession`、`activeModels` 与 `currentConversationId`，否则后续总结或续写会失去当前历史会话上下文。

- **辩论轮询必须在发送前取基线，并用 WebContents ID 绑定网页实例**：WebviewCard 的 useImperativeHandle 会在发送状态、加载状态或其他 React 渲染后创建新 ref 对象；比较 ref 对象引用会把同一网页误判为已替换，导致首轮轮询提前退出、后续轮次不再注入。应比较 getWebContentsId()，每次读取使用当前 ref，同时保留模式、会话 ID 与 URL 校验。基线必须在发送前通过非交互采集取得；发送后读取可能已得到本轮快速回复，导致一直等待到超时。只有当前内容非空、不同于基线且连续稳定才允许推进；空值或等于基线时重置稳定次数，禁止使用首次变化后永久放行的单向闩锁。暂停后继续等待已经发送的消息，不重复注入；超时保留已完成发言与当前发送状态供继续采集。

- **轮转驱动的空回复应中止流程而非写占位继续推进**：`useDebateRunner.runNextTurn` 早期在 `getResponseFromSlot` 返回空时用 `appendDebateSpeech(..., speech || '（无回复）')` 写一条占位发言再 `advanceDebateTurn()` 继续下一轮——这会让没回复的空轮串起来，掩盖故障。**正确做法**：检测到空回复（`!speech || !speech.trim()`）时立即 `setDebatePhase('finished')` 并 `return`，不 `append`、不 `advance`，保留已完成的真实回合供用户查看。适用于一切「自动轮转、依赖对方真回复」的驱动场景。

- **内存优化先识别资源类型**：多个 AI SPA/WebContents 有基础内存开销，但历史 80–150MB 只是观测量，不是固定预算或不可优化下限。先测 main 日志、内存历史缓存、隐藏页面和后台会话，再处理真实占用。共享 persist:shared 是项目约束；隐藏/休眠/卸载影响会话连续性，不能默认清空 mountedWebviews。磁盘与内存历史上限必须分开维护，不能把裁剪后的内存数组直接覆写为全部磁盘记录。Chromium 内存开关需实测，不能当作现成修复。

- **Electron main 进程日志泄漏的隐蔽性**：`console.log(JSON.stringify(bigObj, null, 2))` 在流式场景下会按 chunk 数量（数百-数千次）放大，每个大字符串在 main 进程 stdout 缓冲区累积，导致稳态内存上涨且不触发 GC。生产构建必须用 `is.dev` 守卫所有调试级日志，仅保留错误级别和低频生命周期日志（开始/完成/耗时/字符数）。配套：main 进程 `console-message` 处理器要显式过滤高危前缀（如嗅探器的 `NETWORK_RESPONSE:`），避免 webview 内的全量响应体日志回流主进程。

- **Webview 休眠必须 `loadURL('about:blank')` 才真省内存**：仅 `setIsHibernated(true)` + className `invisible` 隐藏（57efc27/eb4791d 原始版即如此）渲染进程页面层并未卸载，与 KNOWLEDGE「隐藏未销毁 webview 仍占完整渲染进程」结论一致，与「优化性能」初衷冲突。**正确做法（决策 D1）**：`suspend()` 在保存 URL+草稿后、置 `isHibernated` 前调 `webview.loadURL('about:blank')` 释放 V8 堆/DOM；`resume()` 调 `loadURL(targetUrl)` 重载 + 恢复草稿。注意：`loadURL('about:blank')` 后 webview 仍挂载 DOM（渲染进程对象不立即销毁），但页面层卸载已显著降内存；彻底释放需从 DOM 移除 `<webview>` 但会破坏 ref 稳定性与 persist:shared 绑定，不采用。

- **Webview 总结的实际入口**：当前 SummaryPage 渲染 ModelOutputCard 与 SummaryPanel；SummaryPanel 使用 WebviewCard/useWebviewSummary 注入提示词，长文本走 Markdown 附件，由用户手动发送。修改前核对真实 ref 和调用点，旧 API/webview 模式切换及 useSummaryPanel 文档不适用于当前代码。

- **总结页模型卡片渲染口径必须按「有回复内容」过滤，不能直接渲染 getDisplayedModels 全集**：`SummaryPage.tsx` 渲染 `ModelOutputCard` 时若用 `displayedModels.map(...)` 全量渲染，会把用户当前页面根本没打开的模型（如 gemini/claude 等禁用模型）显示成「暂无回复内容」的 phantom 空回复框。phantom 模型进入 `displayedModels` 的两条路径：① `getDisplayedModels` 的 `models[index % models.length]` 兜底——空槽位直接取全局 `defaultModels` 第 N 个（index=1→gemini），不过滤 `enabled`；② `MainPage.tsx` 历史恢复时 `newOrder = [...item.models, ...其他所有模型]` 把未参与模型（含禁用）回填进 `multiAiSlots`。**正确做法**：渲染前按 `(modelResponses[m.id] || '').trim()` 过滤出 `renderableModels`，与同文件 `selectedModels` 的 `modelsWithData` 口径、`getAllResponses` 的 `targetModels`、`MainPage.tsx` 快照兜底的 `targetModelList` 保持一致；无任何回复时回落 `displayedModels` 保留加载/空态。口径不一致是本类 bug 根源。

- **历史快照 `urlMismatch` 检测不能在加载途中的中间导航事件触发**：`WebviewCard` 的 `checkUrlMismatch()` 原在 `dom-ready` 与 `did-navigate` 里无条件调用，而这两个事件在 SPA 重定向链的**每一跳**都触发——加载途中 `getURL()` 必然偏离历史 `expectedUrl`（如先落 home URL 再重定向到 `/c/abc`），先误报 `urlMismatch=true` 弹「历史快照模式」覆盖层，等最终 URL 落定后又被后续事件纠正为 `false`，表现为覆盖层加载途中一闪而过、加载完成后消失（即使最终 URL 匹配成功也闪）。**正确做法**：最终判定放在 `did-stop-loading`（`handleLoadStop`，页面稳定、URL 已落定）；从 `dom-ready`/`did-navigate` 移除该调用。**保留** `did-navigate-in-page` 里的检测——它是首屏加载**之后**的 SPA 路由变化（`isLoading=false`、无 frame load），用来捕获「页面加载后被重定向到登录/错误页」这类真实偏离，且因不在加载途中而不会闪。判别：覆盖层只在加载途中瞬现、加载完即消失 = 命中本坑。**关联**：`readonlySnapshot` 的可见性/覆盖层条件 `(loadError || urlMismatch) && readonlySnapshot` 与 webview `invisible` 门控共用 `readonlySnapshot`，非回溯态必须传 `null` 而非空内容对象（见 plan 2026-07-02-history-snapshot-fallback）。

- **保活、休眠与销毁的语义不同**：display:none 保留 WebContents 与 live 页面；suspend/resume 导航 about:blank 再恢复 URL，可释放页面资源但丢失进行中的 live 状态；卸载 React Webview 会销毁底层 WebContents。短暂面板切换优先保活，长期释放按现有白名单休眠，明确销毁需求才卸载。导航或卸载不等于删除 persist:shared 登录态；旧总结 API 模式守卫不作为当前实现依据。

- **恢复历史与续写分支时防串台策略**（history-summary 串台修复得出）：在恢复非第一条历史记录（`history[0]`）并进行续写分支时，若 `appStore.ts` 中 `sendMessageToAll` 内部的 `lastItem` 仍使用默认的 `history[0]`，会导致续写时的 `conversationId` 仍锚定到最新一条历史对话中，造成串台。**修复**：全面引入并持久化 `currentConversationId` Store 字段，所有涉及新对话创建、续写、历史恢复、删除历史的路径必须同步更新 `currentConversationId`，且在所有消息发送和监测时均使用 ID 查找，而非无条件使用 `history[0]` 兜底。


### 10. 任务分配、辩论与 API 请求

- **模型切换携带业务上下文**：复用 Webview 面板时显式区分 productMode、slot 与窗口来源，防止全局模型选择污染其他面板。避免用永久 ref 加载锁阻断必要生命周期更新；核对当前 Webview Hooks 与调用点。

- **模式复用限于当前能力**：任务/辩论通过 slot-N 的 Webview ref 发送，优先复用共享自动化脚本。任务拆解的请求取消由 `split-task` / `abort-split-task` 及 currentTaskSplitAbortController 管理；当前已不存在 generate-summary 全局中止器，不能继续依赖旧总结取消链路。

- **renderer 的 `window.api` 类型有双源，加 IPC 方法必须两边都补**：本仓库 `tsconfig.web.json` 同时引用 `src/preload/index.d.ts` 和 `src/renderer/src/env.d.ts`，二者各自 `declare global { interface Window { api: {...} } }` 重复声明同一接口。只在 `index.d.ts` 加新方法，renderer 侧（appStore/DiagnosticsPage）tsc 仍报 `Property 'xxx' does not exist on Window['api']`，因为 `env.d.ts` 的独立声明没更新。**正确做法**：新增 `window.api` 方法时，`src/preload/index.ts`（实现）+ `src/preload/index.d.ts`（preload 侧类型）+ `src/renderer/src/env.d.ts`（renderer 侧类型）三处同步，签名逐字一致。这是预存技术债（双源），未统一前每次加方法都要两边补。判别：renderer tsc 报 Window.api 缺方法但 preload/index.d.ts 明明有 → 检查 env.d.ts 是否也声明了 Window.api。

- **IPC 的主窗口 getter 由注册函数注入**：ipcHandlers 中依赖 getMainWindow 的 handler 注册在 registerIpcHandlers 的参数作用域，沿用既有注入方式；reqId Map/控制器等持久状态按生命周期管理。不能因模块顶层没有该绑定就绕开当前层次结构；旧 currentSummaryAbortController 名称不再适用。

- **任务拆解复用供应商请求体配置**：taskSplitApi 通过 buildRequestBody 构建请求体并传 stream:false，保留 top_p、reasoning 等供应商适配，响应按一次性 JSON 解析。复用配置有维护价值，但不能据静态 body 差异断言 Model Not Found 的根因；排查先核对真实 model 标识、端点与错误证据，再检查供应商参数。

- **API model 使用平台标识，name 仅展示**：useTaskSplit 从 summaryModels 取 `.id`，不能传用户别名 `.name`。历史讯飞 PathDomainError 的已纠正原因是 model 取值错误；请求体复用是独立改进。诊断可核对脱敏后的 id/name 和调用代码，禁止输出完整配置、API Key 或请求内容；当前 Webview 总结没有 API model 请求，不沿用旧 selectedAgent 调用示例。

- **持久化提示词保持稳定 ID，升级以当前实现为准**：模板展示名称可修改，ID 是跨代码/磁盘主键，不能随改名更换。当前入口为 summaryPrompts.ts / summary-prompts；旧 agent-prompts 在新目录不存在时迁移。bootstrap 按 ID 补缺失预设，对已存在条目比较本地 body hash 与当前 seed hash：相同才按当前 seed 重写并保留本地 id/name，不同保留正文、只补缺失 description。不能假定改 seed 后所有旧文件都会自动升级，也不能为更新模板直接删除用户目录。辩论中的阶段分派与动态变量构建保留在 debatePrompts.ts，不强塞进扁平文件模板。

- **任务分配模式子任务必须携带 slotIndex（槽位索引），派发/cycle 一律按 slotIndex 走，modelId 仅作展示派生**：`taskAssignmentSlots` 是「按槽位顺序排列的模型 id 数组」（index=窗口位置），任务模式明确支持「多个窗口选同一个 AI」（见 Layout.tsx 文案）。用 `taskAssignmentSlots.findIndex(id => st.modelId)` 反查槽位会把所有同模型子任务命中第一个匹配槽位（slot 0），叠加 `if (slotIndex === -1) slotIndex = 0` 兜底 → 一键派发全部塞进 slot 0、其余窗口空转。**正确做法**：`TaskSubtask` 直接存 `slotIndex`，拆解时 `i % slotCount` 赋值，`handleSend` 按 `st.slotIndex` 聚合后 `webviewRefs.get(\`slot-${slotIndex}\`)` 分发，SubtaskList 的 cycle 按钮在 `0..slotCount-1` 间 +1 取模切槽位（同步更新派生 modelId）。同理：任何「slot 数组里同一值可出现多次」的语义都禁止用值反查 index，应让数据直接携带目标 index。**关联**：拆解数量也需告知模型——`buildTaskSplitSystemPrompt(windowCount)` 强制输出恰好 windowCount 个子任务，windowCount 由渲染层 `getDisplayedModels(...).length` 实时算出经 IPC 透传（`SplitTaskParams.windowCount` 端到端同步：taskSplitApi / ipcHandlers / preload index.ts / index.d.ts）。


### 11. CLI 与后台会话

- **Electron 跨窗口访问主窗口 webview 必须经主进程透传**：独立诊断窗口（`openDiagnosticsWindow`）不持有平台 `<webview>`（它们在主窗口 renderer 的 `useAppStore.webviewRefs`），诊断窗口 renderer 无法直接读主窗口 store。**正确模式**：诊断窗口 `window.api.diagnosticsProbe(modelId,type)` → 主进程 `ipcMain.handle('diagnostics:probe')` 用 `reqId` Map 关联 → `mainWin.webContents.send('diagnostics:probe-request',{reqId,...})` → 主窗口 `onDiagnosticsProbeRequest` 查 `webviewRefs.get(id).probeMessageContainer/probeResearchMode` → `diagnosticsProbeResponse(reqId,result)` → 主进程按 reqId resolve。主进程必须设超时（probe 5s / run-research 15s）兜底，返回统一 `{success,data?,error?}`。Map 放模块顶层，handler 注册在 `registerIpcHandlers` 体内。判别：任何「A 窗口要操作 B 窗口的 webview/DOM」需求都走此透传，不要试图让 A 窗口直接访问 B 的渲染进程对象。

- **Headless BrowserWindow 后台限流**：通过 `new BrowserWindow({ show: false, ... })` 创建的隐藏 Daemon 会话窗口，Chromium 默认开启 `backgroundThrottling: true`，会将后台 tab 的 `setTimeout/setInterval` 降频至 ≤1Hz。必须在 `webPreferences` 中显式设置 `backgroundThrottling: false`，否则 `AutomationService` 注入的轮询脚本会严重超时。

- **Named Pipe Server 异步事件循环竞态**：Node `net.Socket` 的 `'data'` 事件回调在 `async` 函数中，当 `await handleRequest(...)` 暂停时，后续到达的数据包仍会同步触发新的 `'data'` 事件，修改共享的 `buffer` 变量，造成 lines 跳行或乱序。**正确模式**：在同步的 `'data'` 回调中仅做行分割，将完整行推入 per-socket `requestQueue: string[]`，然后用 `processQueue(socket)` 串行消费（加一个 `processing` flag 防止重入）。

- **CLI `--json` 模式 stdout/stderr 分离**：在 `--json` 模式下，凡是连接失败、解析错误等错误信息都必须走 `process.stderr.write(...)`，而不是 `console.log`（会写 stdout）。只有最终成功的结构化数据才输出到 `stdout`，这样外部脚本才能安全地管道解析 stdout。

- **commander `exitOverride` 必须在注册子命令之前调用**：子命令在 `command()` 创建时通过 `copyInheritedSettings` 拷贝 `_exitCallback`，后设 `program.exitOverride()` 对已注册子命令不生效，缺必填参数/未知 option 仍以默认 exit 1 退出。契约要求参数错误=2 时，先 `exitOverride()` 再 `registerCommands()`，在 catch 中把 `commander.*` 错误码映射为 exit 2，`commander.helpDisplayed`/`version` 映射 exit 0。

- **daemon token 文件必须放 `getDataPath()` 下而非管道名派生路径**：Windows `\\.\pipe\multichat-daemon` 是内核对象名不是文件路径，旧代码 `${PIPE_PATH}.token` 在 Windows 下不可写导致 token 机制被绕过。正确做法：`startDaemonServer(dataPath)` 时写 `<dataPath>/daemon.token`（0600），CLI 按 `%APPDATA%/<name>`、`%APPDATA%/<productName>`、`-dev` 后缀与便携版 `exeDir/data` 候选目录探测读取；鉴权检查放进 `handleRequest` 全平台统一执行，token 缺失（''）时 fail-closed 拒绝一切请求。

- **后台任务轮询须容忍 `executeJavaScript` 瞬时失败**：页面发送消息后的整页导航/重载会使 `executeJavaScript` 单轮 reject，直接冒泡会把整个任务判 INTERNAL。正确做法：单轮脚本失败按"空采"计数累计（含连续上限升级 PAGE_NOT_READY / `wc.isDestroyed||isCrashed` 判 SESSION_LOST），不因一次失败终止轮询。

- **取消 queued 任务必须直接 finalize 出队**：仅置 `cancelRequested`+`abort()` 对未执行任务是空操作——`pump()` 检查 `phase==='queued'` 仍会提取执行，产生取消后的幽灵窗口创建与导航副作用。`cancel()` 中 `phase==='queued'` 应 `splice` 出队并直接 `finalize('cancelled')`；同理 `finalize` 对所有终态（含 `cancelled`）都要落盘，否则重启后 `status` 丢终态视图。

- **杀 dev 进程要杀 Electron 主进程而非 npm 壳**：`kill_shell`/`Ctrl+C` 只终止 `npm run dev` 的 node 包装进程，`electron.exe` 主进程会变孤儿继续持有 Named Pipe 与端口，导致"新实例"实际仍是旧代码在响应（排查旧 bug 复现假象的元凶）。Windows 下须 `taskkill //PID <electron主进程PID> //T` 杀整棵树；git-bash 里 `node -e` 内联串与 heredoc 中的 `\\.\pipe\` 反斜杠会被 MSYS 二次坍缩成单斜杠导致 ENOENT，写管道测试须落盘为 `.mjs` 文件或用 `String.fromCharCode(92)` 构造路径。

- **done 终态的单任务响应已内嵌 reply**：`task.status`/`task.submit --wait` 在 `phase=done` 时直接在 view 里带完整 `reply`（`respondTaskView` 内嵌），`task.list` 批量视图不内嵌。Agent 轮询到 done 即拿全文，多数场景无需再调 `task.result`。这是异步任务 API 的业界模式（对齐 Google LRO/AIP-151：operation done 时内嵌 response）——单任务内嵌省一次往返，批量不内嵌防爆列表体积。

- **daemon/CLI 评审易漏的真实约束清单**：`ensureSessionReady` 只保证窗口存在、不负责导航（已加载会话原样返回，导航须调用方显式 `loadURL`）；`DaemonResponse.error` 是 `string`（不是对象），稳定机器码走顶层 `code` 字段；每请求一新 socket，`waitMs` 长轮询挂起期间必须注册 `socket.once('close')` 清理订阅否则泄漏；`generateSendMessageScript` 的 verifySubmission 原本仅附件场景启用，agent 任务需显式开关；`generationStopSelectors` 只适配 chatgpt/claude/gemini/deepseek 4 平台，其余靠回复稳定兜底。

- **无 Electron 环境做 CLI↔daemon 契约测试**：`NODE_OPTIONS=--require <shim>` 注入 `net.connect` 重定向 shim 可在不启动 Electron 的情况下模拟管道做协议契约测试。历史坑位：commander 缺必填参数默认 exit 1 与"参数错误=2"契约不符（须 `exitOverride` 前置，见上条）；`AgentTaskService.cancel` 对 queued 任务不落地终态曾是状态机缺口。

- **session_log.py 在 GBK 控制台打印 Unicode 会崩**：Windows GBK 终端无法编码 lesson 候选中的 `↔`/emoji 等字符，`main()` 打印 candidates 时 UnicodeEncodeError（日志本身已写入，崩在提示阶段）。修复：`main()` 开头 `sys.stdout.reconfigure(encoding="utf-8", errors="replace")`。

- **`.cmd` 批处理 shim 的 `endlocal` 会吞掉子进程退出码**：`setlocal`/`endlocal` 配对中 `endlocal` 把 ERRORLEVEL 恢复到 setlocal 前的值，shim 末行裸写 `endlocal` 导致 CLI 永远 exit 0（≤1.3.1 安装版实测 `task submit` 失败仍返回 0）。正确写法 `endlocal & exit /b %ERRORLEVEL%`——`%ERRORLEVEL%` 在行解析时展开，先于 `endlocal` 执行取到真实码。下游脚本/Agent 在修复铺量前必须按 JSON `success`/`code` 字段判错，不能信退出码。

- **PowerShell 任务脚本两个坑**：① 函数 `return @($x)` 的单元素数组在赋值给变量时被 PS 解包成标量，`$v[0]` 取到的是字符串首字符——调用处必须 `$v = @(Func)` 强制数组；② 包装脚本里显式 `-Query`/`-QueryFile` 参数必须先于 stdin 读取判定，宿主 shell 若把 stdin 挂成不关闭的管道，`[Console]::In.ReadToEnd()` 会永久阻塞（复现了 CLI `readStdinIfPiped` 在 Agent shell 卡死的同类隐患）。

- **`task submit --image` 附件上传：粘贴式优先于 CDP 拖拽，文件名匹配放宽**（2026-11 实测 doubao/chatgpt 图+文生图全过）：`--image` 链路 → `uploadAttachments` 逐张上传 → `generateFileUploadStateScript` 轮询就绪。**上传改用"粘贴式"**：主进程 `readFile`→base64→`generatePasteFileUploadScript` 在页内 `new File + DataTransfer + ClipboardEvent('paste')` 派发到输入框，主流 AI 编辑器（ProseMirror/Slate/Lexical）都监听 paste 解析附件，不依赖页面是否监听 drop、不挑落点坐标、不碰附件区 DOM——doubao 实测一次通过，paste 失败才退回 `dispatchFileDrop` 兜底。**就绪检测放宽**：`generateFileUploadStateScript` 原按全文件名文本匹配，图片类附件常只渲染缩略图/chip 不落全名（doubao 51 字符文件名 90s 超时根因）——现 `nameMatches` 依次试 全名→去扩展名主干→主干前 16 字符前缀，并加 `hasAttachmentNode` 兜底信号（composer 内可见附件容器/缩略图节点）。改之前先确认附件真落上去而非文件名漏检。

- **`submit --wait` 的防丢 taskId 两段化要在客户端做而非协议层**：正确实现是 CLI 先发无 waitMs 的 `task.submit` 立即拿 taskId → 把 ack JSON 吐 **stderr** → 再发 `task.status waitMs` 长轮询；daemon 协议与 stdout 契约零改动，新旧 CLI/daemon 任意交叉兼容。若改 daemon 在 submit 上先回一行 ack 再挂起，旧 client（首行 `\n` 即 resolve+cleanup）会把 ack 当最终响应提前退出。**配套**：`readStdinIfPiped` 改为仅未给 `--query`/`--query-file` 时读 stdin，根治宿主开放管道挂死；`--idempotency-key` 在同 sessionKey 的内存任务表去重（终态也命中），跨重启不落盘。

- **未登录检测不能靠"输入框是否存在"，也不能靠"页内登录入口"提前判墙**（2026-11 隔离实测）：chatgpt/qwen/chatglm 未登录页的 composer 照常渲染，`generateMindmapPageStateScript` 的 `ready` 为 true，旧逻辑会直接进入发送再失败；反向地，gemini/doubao/yiyan 游客可用却常驻"登录"按钮，提前按 CTA 判墙会把可用平台全部误杀（实测 gemini 从 done 变 AUTH_REQUIRED）。可靠判据只有两类：① 强信号（Cloudflare challenge 容器、`input[type=password]`/`tel`）连续 2 次命中即 `AUTH_REQUIRED`；② 发送脚本返回失败后再探测登录入口归因，命中才升级为 `AUTH_REQUIRED`，否则维持 `SEND_FAILED`。另：`isAuthWallUrl` 的正则必须容忍 `sign_in`/`log-in` 这类分隔写法——deepseek 未登录落 `/sign_in`，旧的 `signin` 字面量匹配不到，只能等满 30s 探针超时。

- **"游客"与"已登录"只能靠凭证区分，DOM 做不到；但"有同名 cookie"也不等于已登录**（2026-11 两次隔离实测）：游客态同样持有大量 cookie（qwen 游客全是 `cna`/`tfstk`/`isg` 指纹类；deepseek 游客已有 `ds_session_id`；grok 游客的 `__Host-id-token-nonce` 会被 `token` 正则命中）。更关键的是**部分平台游客态会写同名账号 cookie**——chatglm 游客写 `chatglm_token`（JWT 里 `is_guest:true`）、yuanbao 游客写 `hy_user`（值形如 `a_did_...`）。因此判定必须两层：先按 `platformAuthCookies` 精确匹配名字，名字命中后再按 `platformAuthCookieRules` 看值否决游客。已实测可纯靠名字判定的名单：chatgpt `__Secure-next-auth.session-token`（`.0/.1` 分片）、gemini `SID`/`SAPISID`、doubao `sessionid`/`sid_tt`/`sid_guard`、grok `sso`/`sso-rw`、qwen `tongyi_sso_ticket`、yiyan `BDUSS`（须限定 `.baidu.com` 域，`.apollo.auto`/`.yoojia.com` 也有同名值）、arena `arena-auth-prod-v1`（实际名为 `.0`/`.1` 分片）。名单只能靠"登录态 vs 游客态"双向取样验证，只测登录态必然漏掉游客误判。

- **登录凭证不只在 cookie 里，必须双通道且"未命中 cookie"不等于游客**（2026-11 实测）：deepseek 已登录时 `chat.deepseek.com` 的 localStorage 有 `userToken`，cookie 只有设备标识；kimi 的 cookie 全是 `acw_tc`/`theme`/`Hm_lvt_*`，凭证是 localStorage 的 `refresh_token`（JWT）。因此判定顺序必须是「cookie 命中 → 已登录；否则 localStorage 给结论 → 采用；都没有 → 未知」，若在 cookie 未命中时直接返回 `signedIn:false`，会把 kimi/deepseek 的已登录用户挡在 `AUTH_REQUIRED` 前。localStorage 判定还要剥壳：deepseek 游客态的 `userToken` 值是 `{"value":null,"__version":"0"}`，非空字符串，按"非空即登录"会把游客判成已登录——须解析 JSON 后看 `value` 是否为空。

- **qwen 的自动化站与登录站曾是两个产品，改动前先确认同源**（2026-11 实测）：`chat.qwen.ai`（Qwen Chat 国际版）与 `www.qianwen.com`（千问国内站，models 配置与用户登录所在）是不同站点，登录态与 DOM 都不通用。历史 `newConversationUrl` 指向 `chat.qwen.ai`，而选择器（`#qianwen-layout-right-panel`、`#qk-markdown-react`、`.tongyi-markdown`）与 `tongyi_sso_ticket` 都属于 `qianwen.com`，导致"用户已登录却报未登录"。现两者统一到 `www.qianwen.com/`，researchMode 两个站点的入口并存：`chat.qwen.ai` 是 `div.mode-select-open[role=button]` + `menuitem"深入研究"`，`qianwen.com` 是 `button[aria-label="研究"]` 的 `aria-pressed` 开关。切换后已实测不破坏自动化：首页与 `/chat/<id>` 都能写入输入框（普通 `contenteditable` div，走 `execCommand('insertText')` 分支）、发送按钮 `aria-label="发送消息"` 由 disabled 变为可用；`tongyi.aliyun.com/qianwen` 与 `qianwen.com` 均 301 到 `www.qianwen.com`，origin 统一，`isConversationUrlForPlatform` 的 `/chat/` 判定成立。域名迁移的落点不止选择器：`AutomationService.PLATFORM_DEFAULT_URLS`（无 `newConversationUrl` 时的兜底）、渲染层 `defaultModels` 的初始 `url`、`webviewManager` 按 hostname 取平台名的映射，三处都要同步；映射需保留旧 hostname，否则历史笔记会显示裸域名。

- **主进程读选择器也要做版本校验**：渲染层 `getSelectors` 只接受 `stored.version >= defaultSelectors.version`，但 `AutomationService.getPlatformSelectors` 曾无条件采用 store 里的 `selectors.models[platformId]`。后果是用户一旦保存过旧版选择器，后台自动化会长期沿用其中的废弃字段（如 qwen 指向 `chat.qwen.ai`），改 `selectors.ts` 对 CLI 完全不生效。修法是主进程同样按版本比较，低于默认版本整体回退默认配置；实测 v19 回退默认、v20/21 仍用自定义。

- **`aria-pressed` 开关类入口必须加幂等守卫**：`qianwen.com` 的"研究"按钮点一次取反，`generateEnableDeepResearchScript`/`generateDisableDeepResearchScript` 若被重复执行（重试、追问复用会话）会把状态翻回去。做法是在 `AutomationStep` 上加 `skipIfPressed`/`skipIfReleased`，`buildDeepResearchHelperFunctions` 里 `alreadyInState(step, el)` 命中即跳过点击并计入成功。实测连开两次仍为 `aria-pressed=true`，连关两次仍为 `false`。

- **应用运行期间 cookie 库被独占锁，离线读盘拿不到真实数据**：`Partitions/shared/Network/Cookies` 被 network service 进程以独占方式持有，`FileShare.ReadWrite` 与 `Copy-Item` 全部失败；用 `NtQuerySystemInformation(SystemExtendedHandleInformation)` + `DuplicateHandle` 复制句柄可只读取出完整快照（327 条 vs 复制文件的 35 条），但这只适合取证。判定必须走应用进程内的 `session.fromPartition('persist:shared')`。


### 12. 构建、打包与开发验证

- **构建启用 JavaScript 混淆时不要通过函数 toString 生成 Webview 注入脚本**：在生产打包开启 JavaScript 混淆时，若通过 `Function.prototype.toString()` 生成要注入 Webview 执行的脚本，函数体内部变量可能会被主进程混淆器重命名，且可能依赖混淆器注入的主进程全局名称映射，进入隔离的 Webview 页面后执行报错（如变量未定义）。Webview 注入脚本应直接使用自包含的字符串模板（或 IIFE 源码字符串）编写，避免在主进程代码中使用函数 toString 注入。

- **落地页文案不是代码事实**：产品页里的数字、角色名、预设数量等文案可能滞后于真实实现。改 README、方案文档或宣传页前，必须先 `ls` / `rg --files` 以实际预设目录和代码定义为准，不能照抄落地页的营销描述。

- **下载监听区分全局与单次任务**：will-download 属于 Session，多窗口共享同一登录 Session。全局批量下载路由应幂等注册；当前图片另存为等路径会按任务临时绑定监听，不能一律禁止。临时监听需匹配发起 WebContents 与 URL，在命中、失败或取消/超时等结束路径清理，避免误拦其他窗口下载或累积监听；实际清理覆盖需按对应代码核对，不能由本条推断所有路径已验收。

- **Windows 签名工具解压与符号链接权限**：历史 winCodeSign-2.6.0 包含 macOS 符号链接，Windows 7za 解压曾因权限不足失败；当时通过开发者模式/适当权限并在清缓存后重打验证。诊断先核对当前工具版本、实际 ERROR: Cannot create symbolic link 与系统权限，不把旧版本号或“必复现”当通用事实，也不擅自改系统设置。不要用 .cmd 包装 7za 吞错误码：历史 Go 解压链与 Node execFile 打包链对此兼容不同，出现过解压通过而 NSIS spawn EINVAL；应修真实权限/工具问题。缓存存在会掩盖解压失败，验证修复需区分缓存命中和新下载路径；具体版本与缓存位置以当前安装输出为准。

- **代理/TUN 加载故障分层诊断**：当前 main 初始化含 disable-quic 与 AutomationControlled 开关，Session 处理会清理 Electron UA 标识。它们是既有兼容配置，不能保证所有代理、站点或验证码可用，更不能把白屏一律归因于 QUIC/自动化探针。按加载事件、错误码、render-process-gone 和实际网络证据排查；每次导航超时和取消处理需与休眠/唤醒配合，详见 Webview 采集主题。

- **`@electron-toolkit/utils` 的 `is.dev` 在 Vite HMR 开发服务器中会崩溃**：`@electron-toolkit/utils` 的 `is` 对象内部使用了 `__dirname`、`child_process.spawnSync`、`path.join` 等 Node.js 特有 API。当 `shared/` 目录下的文件（如 `webviewScripts.ts`）被渲染进程引用时，`@electron-toolkit/utils` 会被 Vite 的依赖预构建（dependency pre-bundling）加载到浏览器环境中，触发 `__dirname is not defined` 和 `child_process has been externalized` 致命错误，导致开发服务器黑屏。**正确做法**：任何可能被渲染进程引用的代码（`shared/`、`renderer/` 目录），必须使用 `process.env.NODE_ENV !== 'production'` 替代 `is.dev`。`process.env.NODE_ENV` 是 Vite 等构建工具在编译时静态替换的环境变量，不依赖任何运行时模块，在主进程和渲染进程都能正确工作。`src/main/` 下的纯主进程文件使用 `is.dev` 是安全的，但为保持一致性也可统一使用 `process.env.NODE_ENV`。判别：若报错堆栈指向 `node_modules/.vite/deps/@electron-toolkit_utils.js` 且含 `__dirname`/`child_process` 字样，即命中本坑。

- **开发组件的构建裁剪要检查引用图**：renderer 用 import.meta.env.DEV 控制动态 import 和路由/监听入口；只隐藏按钮不能证明其静态导入与依赖已从包中移除。是否剔除以构建后产物搜索为准，不笼统断言只有动态 import 才可能 tree-shake。

- **开发 IPC 要显式限制运行时入口**：主进程 handle/on 注册有副作用，不能仅由 renderer 隐藏入口推断生产功能不可访问。沿用 main 开发态守卫，并核对注册条件；若要控制构建体积需检查实际 bundle，不把“永远无法静态剔除”当普遍结论。main 可用工具库 is.dev，renderer/shared 不导入 Node 工具库。

- **NSIS 安装后启动要区分权限与路径**：历史安装后启动曾出现约一分钟卡顿，排查涉及 elevated 安装进程通过 ExecShellAsUser、快捷方式落盘及 Shell/DCOM 降权路径。现有 installer.nsh 按账户类型选择启动方式，提权分支使用可执行文件路径而非快捷方式，普通分支避免不必要的降权调用。此为项目历史修复经验，不能只凭时长认定具体 COM 根因；修改安装脚本需按实际权限场景打包验收，并遵守打包配置变更的确认要求。

- **build 不等于类型检查或桌面验收**：electron-vite build 不执行 tsc。按 AGENTS 分别检查 tsconfig.node.json 与 tsconfig.web.json，根配置只有 references，单独 `npx tsc --noEmit` 不能代表两侧检查。已有类型错误与当前改动的错误应明确区分，不能把旧日志的通过记录当当前结果；UI、站点 DOM 与 main 行为需在重启后的 dev 中实际触发。
  存量基线：`tsconfig.web.json` 未设 `target`，renderer 侧有 12 个既有类型错误（多为 TS2802 Map 迭代需 es2015+，另有 useWebviewLifecycle/QuickPage 各一处）。验证改动只需确认错误清单未新增、不涉及所改文件；需要精确区分时可 stash 对比。

- **electron-builder `nsis.include` 注入到生成脚本头部，自定义代码须自带依赖**：`build/installer.nsh` 被 `scriptGenerator.include` 插到 makensis 脚本最前（先于 installer.nsi 的 common.nsh/MUI2/UAC→LogicLib），其中顶层 `Function` 体在定义点立即解析，用到的宏必须在本文件自行 `!include`——`nsDialogs.nsh` 会连带引入 `LogicLib.nsh`+`WinMessages.nsh`（含 `HWND_BROADCAST`/`WM_SETTINGCHANGE`/`BST_CHECKED`），而 `!macro` 体则延迟到插入点展开可依赖后文。可用钩子：`customInit`（.onInit 内设默认值，覆盖静默安装）、`customPageAfterChangeDir`（目录页后插 `Page custom`，MUI_HEADER_TEXT 不可用需用 `GetDlgItem 1037/1038`+`WM_SETTEXT` 改页头）、`customInstall`（装完文件后执行）、`customUnInstall`（卸载清理）。写用户 PATH 用 `WriteRegExpandStr HKCU Environment Path` 保住 `REG_EXPAND_SZ` 并 `SendMessage ${HWND_BROADCAST} ${WM_SETTINGCHANGE}` 广播；移除时分号分段精确匹配 `$INSTDIR\cli`，避免前缀误伤。

- **Electron 系 IDE 终端自带 `ELECTRON_RUN_AS_NODE=1`，起 dev 必须清除**：Devin/VSCode 等 Electron 应用的集成终端会向子进程继承 `ELECTRON_RUN_AS_NODE=1`，`npm run dev` 启动的 electron 退化为纯 Node，`require('electron').app` 为 undefined，main  bundle 顶层 `app.isPackaged` 处即崩（Cannot read properties of undefined）。用 `env -u ELECTRON_RUN_AS_NODE npm run dev`（bash）或先 `Remove-Item Env:ELECTRON_RUN_AS_NODE`（PowerShell）再启动；该变量非用户/系统环境变量，普通终端不受影响。

- **macOS Dock 图标显大通常是图稿没有留边距**：Apple 图标规范图稿约占画布 82% 并配透明边距，不是尺寸问题；`sips` 无合成能力，可用 Swift/AppKit `NSImage` 生成带透明边距的 PNG（`build/generate-mac-assets.sh`、`assets/dock-icon.png`），dev Dock 图标与打包 icns 共用该图。

- **electron-builder NSIS 卸载键不写 `InstallLocation`**：1.3.1 实测 `HKLM\...\Uninstall\<appId>` 只有 `DisplayIcon`（`<dir>\MultiChat.exe,0`）与 `UninstallString`（`"<dir>\Uninstall MultiChat.exe" /allusers`）。Agent/脚本要定位安装目录（如找 `cli\multichat.cmd`）须反推：`DisplayIcon` 截 `,` 后缀取 dirname，或 `UninstallString` 取首个引号路径 dirname；HKCU/HKLM/WOW6432Node 三视图都查一遍。已在 `installer.nsh` `customInstall` 补写 `WriteRegStr SHELL_CONTEXT "${UNINSTALL_REGISTRY_KEY}" "InstallLocation" "$INSTDIR"`（卸载键名 = `UUID.v5(appId)`，模板 define `UNINSTALL_REGISTRY_KEY`/`SHELL_CONTEXT` 随 per-user/allusers 自动选 HKCU/HKLM）。

- **electron-builder `extends` 对数组字段是覆盖语义非合并**：`electron-builder-portable.yml` 重定义 `extraResources` 时父配置条目全部丢失——曾静默丢 `skill/multichat-cli` 资源目录。派生配置重定义数组字段（extraResources/files/extraFiles 等）必须重复声明父配置全部所需条目。

- **extraResources 按文件系统取文件，未提交进 git 的文件照样进安装包**：`run_task.ps1` 曾长期 `??` 未跟踪（非 .gitignore），本地打包一直带上它，但干净克隆或 CI 会静默缺文件。迁移/新增随包资源时顺手核对 `git status` 的 `??` 条目，确认该跟踪的都 `git add`。

- **NSIS 环境变量广播会按每个挂起窗口累计阻塞**：`SendMessage ${HWND_BROADCAST} ${WM_SETTINGCHANGE} ... /TIMEOUT=5000` 等价 `SendMessageTimeoutW` + `SMTO_NORMAL`，超时按每个无响应顶层窗口分别累计（27 个挂起窗口 × 5s ≈ 卡死 2 分钟+，Scoop #6706 同型；桌面浏览器/IDE/终端挂起窗口很常见）。修复：`System::Call` 直调 `SendMessageTimeoutW(..., SMTO_ABORTIFHUNG(0x0002), 1000, ...)`，已挂起窗口立即跳过，典型 <100ms——`installer.nsh` 的 `McBroadcastEnvChange` 宏（装/卸两处共用，宏定义在 `!ifndef BUILD_UNINSTALLER` 之外两侧可见）；要彻底零阻塞可换 `SendNotifyMessage` 异步投递（注册表先于广播写好，PATH 场景无送达时序依赖）。


### 13. 历史架构与版本限定经验

仅在追溯旧架构、旧版本或用户授权的隔离开发时读取。本项目当前使用 Electron 42 与 Webview；本节不授权迁移架构、修改分支或照搬旧兼容补丁。

- **通义千问点击即黑屏/渲染进程崩溃（0xC0000005）= Chromium 120 ScriptProcessorNode use-after-free**：Electron 28（Chromium 120）在 `ScriptProcessorNode::Process()` 中存在 use-after-free，崩溃码 `STATUS_ACCESS_VIOLATION / 0xC0000005`（退出码 `-1073741819`），上游已在 Chrome 121 修复。阿里云风控 SDK 在**用户点击（手势）**时创建 `ScriptProcessorNode` 做音频指纹——因 `AudioContext` 只能在手势后创建/恢复，故崩溃表现为"点击即黑屏"而非"加载即崩"。**干扰项**：控制台 `gyroscope/accelerometer ... not allowed` 与 `deviceorientation blocked by permissions policy` 只是 Permissions-Policy 阻断告警（已被策略挡掉，不会崩），且 Electron 无 `sensors` 权限类型，故 `setPermissionRequestHandler` 对此无效；`use-angle=gl` / `disableHardwareAcceleration` 等 GPU 开关也不对症（非 GPU/合成崩溃）。**正确修复**：在 webview 注入脚本（`getWebviewClickInterceptorScript`，`dom-ready` 即注入、先于点击）中对阿里云/通义域名（`hostname` 含 `aliyun.com` 或 `qwen.ai`）patch `AudioContext`/`webkitAudioContext`/`OfflineAudioContext`/`webkitOfflineAudioContext` 的 `createScriptProcessor` 为纯 JS 桩对象（含 `connect/disconnect/onaudioprocess/addEventListener` 等接口），永不进入原生音频线程，崩溃路径消除；指纹仍得确定性零缓冲结果，不影响页面功能。**彻底方案**：升级 Electron 28→29+（Chromium 121+ 含上游修复）。判别要点：点击触发 + 退出码 `-1073741819` + `ScriptProcessorNode is deprecated` 告警 = 命中本坑。

- **Webview 假象覆盖层截图 DPI 缩放比例跳跃**：当使用截图做 native window 的遮罩层时，应在主进程中使用 `image.resize()` 强制将图片尺寸调整为 1:1 DIP 物理尺寸，而非依靠浏览器 CSS 的 `background-size: 100% 100%` 让浏览器拉伸，否则会在高分屏（DPI > 1）下产生明显的重采样锯齿和尺寸抖动。

- **Windows 平台 WebContentsView 圆角与遮挡漏洞**：(1) `setBorderRadius` 方法在 Windows 平台下为 no-op。若要实现 WebContentsView 无缝圆角裁剪，必须将 native view 设为透明（`#00000000`）并向 web 页面注入 CSS 样式，给 `html` 容器设置 `border-radius` 和 `overflow: hidden`。(2) 当 modal 框或抽屉组件等 DOM 覆盖物处于激活状态时，它们会被 native view 遮挡。相较于为每个插槽单独配置截图，最稳健的做法是在任何覆盖层打开时，统一对所有 active WebContentsView 启用“截屏障眼法”。

- **DOM 覆盖 native 窗口的截图还原机制**：在将 `<webview>` 迁移至 WebContentsView 架构时，页面的 HTML dropdown 或侧滑菜单等会被 native view 挡住。修复方法：(1) 使用 Electron 原生 Menu 来重构 model 选项，避开 z-index 冲突；(2) 对于复杂侧拉抽屉（如历史、设置等），在触发打开时利用 `capturePage` 截取 native 视图作为静态背景图显示，同时将真实的 WebContentsView 隐藏，待抽屉关闭 300ms 动画结束后再恢复显示，达成无缝视觉欺骗。

- **旧 API 流式总结的生命周期经验**：summaryApi/useSummaryPanel 和 generate-summary 已删除，旧共享控制器互斥方案不再作为当前调用关系。可复用原则是：覆盖控制器前中止旧请求，异步闭包捕获本次控制器，完成时只清理仍属于本次请求的引用；流式 reader 在异常/取消路径取消并释放，避免向已销毁 sender 发送或继续空转。当前 taskSplit 是 stream:false，无 reader/onChunk；如未来引入流式接口，按新接口实际生命周期设计，不能照搬旧 IPC。

- **仅在用户授权的 worktree 工作中核对基线**：历史 Claude EnterWorktree 默认从远端默认分支创建，与本地未推送代码可能不同，具体工具默认值可能随版本变化。必须核对实际 ref、未提交改动及计划锚点；不要自动 stash/rebase/reset。创建或切换分支需遵循 AGENTS 的明确授权要求，不能把历史操作命令当默认工作流。

- **新 checkout 的 Electron 安装缺失诊断**：旧 worktree 曾在 npm install 后缺少 node_modules/electron/path.txt/dist，开发启动失败。先核对安装输出与实际文件，不宣称每个 worktree 必然需要手动下载；只有确认 Electron 安装阶段缺失时才按现有依赖的 install.js 修复。此处不是创建 worktree 的授权。

- **跨 worktree 分支保护**：被其他 worktree 检出的分支不能强移指针。历史 develop 与 C:/Project 路径仅是当时布局，不是当前目标；实际位置由 git worktree list 确认。合并、切分支、处理未提交工作需有用户授权，不能自动 force、stash 或任选更长文档覆盖冲突。

### 14. 自包含原型与浏览器视觉验收

- **用 `innerHTML` 重建含 `id` 的子节点后，后续渲染不能再引用旧节点**：自包含 HTML 原型中，如果渲染函数先写入容器 `innerHTML`，之后再按旧 `id` 查询该容器内的节点，首次渲染可能成功，但切换文档、新增标注等第二次渲染会得到 `null` 并中断交互。修复应删除冗余的旧节点引用，或始终在重建完成后重新查询；验收不能只截首屏，还要实际触发一次文档切换或数据更新后的重渲染。
