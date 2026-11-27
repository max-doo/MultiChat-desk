# Knowledge

Long-term reusable lessons, durable decisions, and recurring project gotchas. Do not copy ordinary session history here. Promote only stable knowledge that is likely to help future agents across sessions.

新增知识应写清适用条件、有效结论和依据；未经证实的原因留在日志。新证据推翻旧结论时在原条目修正，避免并列冲突；新增主题同时更新 INDEX。具体样式数值、性能观测和工具默认值不升级为普遍规则。

## 领域知识

### Webview 采集与平台自动化

- **更新站点选择器时必须同时核对三条链路**：前台总结、后台导图和整段对话快照都走同一套共享选择器与采集脚本；站点补充候选统一维护在 `src/shared/config/selectors.ts` 与 `webviewScripts.ts`，渲染层对应路径只重导出。新增候选要按主机名合并，并确认本地旧配置不会屏蔽它；整段对话要识别用户与助手角色、去掉嵌套容器的重复命中，不能用最新助手回复替代整段对话。

- **不要把渲染后的 DOM 文本直接当 Markdown**：列表缩进、代码块和格式在网页渲染后会丢失或被改写。结构化输出应保留代码块原文，并把“尚未完成”和“已完成但无法解析”分开处理；快照和总结都不能用通用 HTML 转换替代平台适配。

- **虚拟代码框必须读取编辑器完整文档模型**：CodeMirror 只渲染视口附近内容，复制结果完整不代表 `textContent` 完整。先限定最新助手回复范围，优先从编辑器 `state.doc` 读取全文，再回退普通代码块；识别到虚拟编辑器却读不到模型时应明确失败，禁止保存可见片段。DOM 到 EditorView 的关联属于内部实现，需要兼容版本变化，诊断只保留计数。

- **富文本注入要区分 DOM 文本、框架状态与幂等守卫**：Slate/Lexical/contenteditable 会把换行编码为节点，直接比较 `textContent` 与含换行提示词会造成重复注入。不能因 DOM 插入完成就认定框架状态同步成功；优先复用现有 insertText/paste 脚本和 `isAlreadySame` 守卫，使用编辑器适配的规范化读取，并在实际网页核对输入框内容与发送按钮状态。任务分配的两段式发送应复用已验证的 insertText 与 sendMessage 单脚本，不要直接操作 Slate 的 DOM span。

- **正则匹配中文或非单词字符时显式关闭 `wordBoundary`**：某些匹配器默认给模式补 `\b`，中文、连字符和符号文本会因此匹配失败；共享自动化步骤应显式设置 `wordBoundary: false`，不要默认沿用单词边界。

- **第三方响应式工具栏选择器要结合语义**：同一 `item-icon` 哈希类在窄屏可能是三点菜单，宽屏可能是复制按钮；结合父级工具栏和 SVG 语义区分操作。抓取第三方 DOM 时，class 可能带 hash 后缀，必须用 `[class*="语义前缀"]`，只有确认无 hash 的纯语义 class 才用精确写法；`selectors.ts` 的 `messageContainer` 同样遵循。

- **平台改版时先查真实 DOM，再改候选**：豆包 `mdbox-theme-next` 改为 `md-box-root`、千问 `tongyi-markdown` 改为 `qk-markdown`，都会让旧候选全部 miss。排查第一步是用 Console 查当前真实 class，不要凭旧 DOM 记忆改。候选应容器级优先、段落级靠后，因为“最后一个可见候选”可能命中末尾多模态卡片或收尾提示。

- **豆包单轮回复可能是多个并列块**：一条助手回复被拆成多个 `data-render-engine="node"` 块，末块常是“需要我帮你……”收尾提示。`findMergedContentRoot` 对 hash 后缀 id 失效；应在 `generateGetLatestResponseScript` 中增加 `findDoubaoMultiBlockRoot`，从末块向上找第一个含至少两个 `[data-streaming], .md-box-root` 的祖先并立即返回，不要用长度守卫，向上层数收紧到 6。抓取结果明显短于屏幕正文，或把全部历史加用户 query 抓下来，分别说明命中末块或爬过头。

- **React hover tooltip 不能靠 dispatchEvent 自动抓全**：千问引用来源明细只在真实悬停后挂载，程序化 `mouseover`/`mouseenter`/`pointerover` 无效。可接受的降级是正文上标转 `[N]` 标记，抓取已经挂载的 tooltip，不强求完整；需要完整证据时只能使用真实鼠标或 CDP `Input.dispatchMouseEvent`，这属于重且跨层的验证手段。

- **诊断探针与生产匹配必须同语义**：`selectorDiagnostics.ts` 的只读探针应复用共享脚本的候选筛选、exclude、wordBoundary、可见性和排序语义；诊断不能触发点击。网络嗅探只用于受控开发诊断，不能默认启用，也不能把全量模型回复写入生产日志。

- **工作台回复按钮注入要分开 replyItem、contentItem 和 userItemMarker**：ChatGPT 单轮 `.group` 同时含用户气泡、AI 正文和操作行，提取正文必须用 `[data-chatgpt-search-unit-key$=":assistant"]` 缩到 AI 块；豆包用户消息与 AI 回复共用 `w-full pl-14` 和 `message-action-bar`，用 `message_action_edit` 判别用户；Gemini `buttons-container-v2` 的父级是块级 footer，bar 向上爬要限高约 56px。高 CSP 平台（Gemini Trusted Types）禁止字符串到 DOM，`el.innerHTML = svgString` 或 `DOMParser.parseFromString` 会抛 `requires 'TrustedHTML' assignment`，SVG 必须用 `createElementNS` 程序化构建；ChatGPT 有两个 `turn-action-controls`，actionBar 必须限定 `[class*="actionRow"]`。

- **工作台按钮的 fallback 与 observer 必须幂等**：没有原生 actionBar 时先复用已有 `.mc-action-bar`，不要每次 scan 新建；幂等判断要区分“有原生 bar 待迁移”（`!CFG.createBar && CFG.actionBar`）和“本就无原生 bar”（`createBar` 或无 actionBar 配置）。`MutationObserver` 要保存实例，重复注入先 `disconnect()`，不能只存布尔标记。不要在没命中原生 bar 时先给 replyEl 打 `__mcBtnsAttached`，否则 native bar 出现后按钮永远停在 fallback；`all:initial` 还会把 fallback 的 `display:flex` 重置成 0 高空壳，fallback 应用专用标记并在原生 bar 出现后迁移。DeepSeek 的正文是 `div.ds-markdown.ds-assistant-message-main-content`（思考块是不带该后缀的 `ds-markdown`），原生操作栏可能在回复块顶部或兄弟容器，`replyItem` 要命中同时包住回复和操作栏的公共祖先，`actionBar` 用 `div.ds-flex:has(> div.ds-button ~ div.ds-button)`；思考块头部按钮组不是回复操作栏。

- **提取正文前要清理 DOM 伴生噪点**：ChatGPT `h4.sr-only` 的“你说 / ChatGPT 说”、Gemini 的“Gemini 说”、`aria-hidden`、actionBar、`button`、`.mc-*` 都会污染 Markdown。`elementToMarkdown` 前先 `cloneNode(true)` 删除这些节点，再转换；不要只靠 XML 标签隔离。

- **图片下载优先语义 hook，不绑 CSS Modules 哈希类**：`aria-label`、`data-testid`、`data-icon-button`、`data-image-resource-id`、语义标签优先；中文 UI 补中文 label，同时加英文兜底。ChatGPT 预览下载按钮 aria-label 已从“保存”改为“下载”，语义标签可用 `download-generated-image-button`；豆包从 hover 浮层改为点 `[data-testid=mdbox_image]` 再点 `[data-testid=edit_image_download_button]`；文心用 `i.cos-icon-download`；Grok 生图旁按钮可直接下载；千问 `popMenuItem` 默认 invisible，必须 hover，下载项无 aria-label，只能靠 `popMenuItem:has(svg[class*="downloadIcon"])` 或 `:nth-of-type(2)`；元宝 aria-label 是小写 `download`，预览组件为 `hyc-photo-view-chrome-v2`。

- **CLI `--gen-image` 必须有提取兜底**：`AgentTaskService.captureGeneratedImage` 在 click 未命中时回退 `generateExtractImagesScript`，按 `data:`、`blob:`、`http(s):` 分路径落盘；`data:` 由主进程 Buffer 写文件，`blob:`/`http(s):` 走 `webContents.downloadURL` 和 `will-download` ctx。qwen `imageItem-`/`imageWrapper-` 改版后 extract 仍可用，一次可能产四张变体，要全部保留。yiyan 未登录只回文本反问，`imageError='生成超时未检测到图片'` 是正确容错；`phase==='done'` 时空 reply 也要写 TXT 占位文件。

- **生图探针必须限定生图容器**：设置 `genImageOnly=true`，只认 `generated-image-gallery`、`generated-image-preview`、`message_image_content`、`mdbox_image`、`image-box-grid`；不要回落到 `findLatestContainer` 的 `messageContainer` 或 `document.body`，否则会把用户 `--image` 上传缩略图当成生成结果。豆包生图容器可能是文本容器的兄弟，要并入 `messageContainer`；生成中骨架或占位内的 img 用 `isInProgressArtifact` 过滤，但已确认生图容器内的不算。

- **Deep Research 跨域 iframe 提取是排查能力，不是已验收产品能力**：顶层 Webview 不能直接读取跨域报告 iframe，报告可能跨 child target 和 execution context，`about:blank` frame 也可能承载内容。可结合递归 `Target.setAutoAttach`、`Page.getFrameTree`、`Page.createIsolatedWorld` 与带 session/context 的 `Runtime.evaluate`，只 detach 自己附加的 debugger。真实报告完整性和耗时必须重新验证。

- **Deep Research 选择器 2026-11 实测**：各平台已弃用 `data-testid`、`data-log-*`、`tagBtn-*`，转向 `aria-label`、`role` 和文本语义；菜单 role 多样，包括无 role 的 `button`、`listbox/option`、`menu/menuitem` 和自定义 `TOOLBOX-DRAWER-ITEM`。ChatGPT 的 `+` 用 `button[data-composer-navigation-target="add-context"]`；Perplexity 研究在 `+` 菜单的 `div[role=option]`；Qwen 经 `button[aria-label="选择模式"]` 到 `div[role=menuitem]` 的“深入研究”；Gemini 是“上传和工具”到“更多工具”的两级；豆包“深入研究”已下架；Kimi 是 `/deep-research` 独立页；元宝有 `data-application-id="application_id_deep_research"`；文心没有 DR 开关；DeepSeek“深度思考”是推理开关，不是 DR。

- **AutomationStep 的菜单入口不一定是 button**：Qwen 是 `div.mode-select-open[role="button"]`，Gemini 是 `TOOLBOX-DRAWER-ITEM`，ChatGPT 菜单项是无 role 的 `<button>`；先查真实 tag/role，再写复合选择器。验收应在 iab 按 step 顺序 evaluate、点击、下一步，模拟整条链，不能只验证单个 selector。iab 用 `mcp__cua_repl__js` 的 `cua.listTabs/getTab/createBrowserTab` 驱动，`tab.playwright.evaluate` 只读 DOM，`tab.playwright.waitForEvent('download')` 可验证下载触发。iab 不共享 `persist:shared` 登录态；spawn 的子 agent 没有独立 iab 浏览器面，CUA 工作要由持有会话的 agent 执行。

- **图生图两条独立坑：附件没进编辑器 + 生图模式没开**：①`generatePasteFileUploadScript` 的合成 paste 事件只能落在 contenteditable/`role=textbox` 类编辑器上——命中纯 `<textarea>` 时 `clipboardData` 里的 File 被静默丢弃，附件根本没进输入框；豆包 `textarea` 首选选择器命中的是真实 `textarea.semi-input-textarea`，而图片监听挂在并存的 contenteditable 编辑器上，需在该脚本里对兄弟/同级 contenteditable 编辑器兜底再派发一次（就近优先、排除 input/deepEditor、限前几个）。②`genImage` 任务除 `captureGeneratedImage` 产物捕获外，还必须显式开生图模式——`AgentTaskService.execute` 原只调了 deep_research 分支的 `generateEnableDeepResearchScript`，漏调 `generateEnableImageGenerationScript(imageGeneration)`；豆包等平台必须先点"生图"技能项进入生图上下文，否则即使附件传上去也只是普通附件不出图。

### 工作台编辑器

- **受控与非受控混用时不要监听内部 markdown 反向同步**：组件同时接受 `initialMarkdown` 和内部编辑状态时，如果把内部 `markdown` 放进 effect 依赖，任何内部更新都会被判定为与外部不同并触发强制回滚。同步只应由外部显式变更触发；hover 操作按钮还要避免父子之间出现事件空隙导致 hover 闪退。

- **Lexical CodeNode 高亮重建不能在同一次 mutation 提交内执行**：Prism 插件在 CodeNode mutation listener 中同步调用 `editor.update` 会并入当前提交并被覆盖。应使用 `queueMicrotask` 延后，重建前记录代码内字符偏移；恢复选区要同时处理 Text Point 和 CodeNode Element Point。连续 `LineBreakNode` 形成的空行必须用 element point；代码块是文档末节点时，Chromium 会把下方空白点击映射回代码末尾，需在根元素 `mousedown` 捕获，在代码外补段落并选中，该更新带独立 tag 让 Markdown 同步跳过。

- **Markdown 预览不能只改字号或套 playground 边距**：`PlaygroundEditorTheme__h1` 等标题使用固定 px 字号，却会继承 `body` 的 24px 行高，标题换行后行距小于字号；标题层级应分别声明相对 `line-height`，约为 1.3 到 1.4。引用块的 `margin-left: 20px` 会与边框、内边距叠成额外缩进，应移除外边距，只保留左边线和必要内边距。

- **裸链接导入和导出不能复用普通链接序列化**：`@lexical/markdown` 的 `LINK` transformer 会跳过 `AutoLinkNode`，需为裸 URL 单独增加 text-match transformer，并用 `$findMatchingParent(...)` 防止在已有链接内嵌套。导出不能拿 `exportChildren()` 与 URL 比较，`exportTextFormat` 会转义下划线、方括号等字符；应改用 `node.getTextContent()`，仅在子节点无格式时原样输出裸 URL。链接插入弹层复用应用内输入框，不用 `window.prompt`；hover 提示跳过“文字本身就是地址”的裸链接。

- **Lexical 本地文件链接不能交给默认 URL 归一化**：`LinkNode.sanitizeUrl()` 会把无协议文件名补成 `https://`；Markdown 导入与链接弹层应在进入 `LinkNode` 前识别已知文件扩展名并补 `./`。点击时按当前文档目录解析为工作区相对路径并交给 `openFile()`，不要使用 `anchor.href`。目标不存在时保留当前文档，不能复用“启动恢复时文件已删除就清空编辑器”的分支。

- **GFM 表格导入必须裁掉单元格两侧的填充空白**：`TABLE_ROW_REG_EXP` 只负责取出首尾管道之间的整段内容，直接按 `|` 切分会把 `| a | b |` 的排版空格写进 Lexical 单元格。拆分后用 `[ \t]` 去掉首尾 ASCII 空格和制表符，不要用 `String.trim()`，它会删除全角空格和不换行空格。主页 `remark-gfm` 会按规范裁剪，编辑器必须保持一致。

- **块级 HTML 表格要用占位标记桥接并保留原始 HTML**：`@lexical/markdown` 只识别 GFM 管道表格，`<table>` 会落入普通段落。导入前在代码围栏外扫描完整 `<table>…</table>`，替换为唯一占位标记，再由 element transformer 创建自定义 `DecoratorBlockNode`；节点保存原始 HTML，导出原样返回，保留 `rowspan`、`colspan` 和源码模式。预览用 `DOMParser` 加 React 白名单节点，不要注入原始 HTML。编辑单元格时在 focus 记录内容基线，blur 或 Ctrl/Cmd+S 只回写该单元格，不在输入过程中更新 Lexical 节点。

- **标注投影不能参与正文 Markdown 判定**：`exportTextFormat` 只检查直接相邻的 `TextNode`，`MarkNode` 会隔断粗体、斜体等格式的连续性，导致同一段文本包标注后被导出成重复格式标记。所有正文序列化路径（标注安全校验、普通编辑回写）必须共用同一个无 `MarkNode` 的导出函数：存在标注时先从 `toJSON(true)` 递归展开 `type === 'mark'` 的节点，再用 `parseEditorState` 建立影子状态导出；保留原有 guard 和 `annotation-sync` 过滤。

- **Markdown 源码块与 Lexical 顶层节点数量不等时不能做贪心 1:1 对齐**：松散列表后的续行段落可能让一个源码 `list` 块对应多个 Lexical 顶层节点。若 Patience 对齐在数量不一致时仍按类型配对前缀或后缀，剩余节点会既没有单块映射、也没有进入 `CompositeSourceGroup`；增量拼装随后先透传整块原始 Markdown，再逐个导出这些节点，造成同一段内容重复并在每次载入后持续膨胀。数量不等且两侧都非空的区间必须整体降为复合块，保证未编辑时只输出一次 raw，组内变更拆组后也只逐节点导出一次。扫描器的块边界还必须容忍 CommonMark 的闭合代码围栏尾随空格/制表符；修改 `MarkdownSyncPlugin.tsx` 中 `ElementTransformer` 的块级正则（如 `IMAGE_TRANSFORMER`）时，也必须与 `markdownSourceMap.ts` 共用导出正则常量，避免与 Lexical 顶层节点切分错位导致保真退化为复合块及邻块编辑误伤原文。预览高亮不参与回写，可对未匹配的 1:N 复合段按块类型做有界近似映射，避免源码已有标记而预览整段缺失；预览覆盖层首次测量不能依赖 `requestAnimationFrame`，窗口遮挡或后台时可能长期暂停，应先同步测量，再用 `ResizeObserver` 加 rAF 合并后续重算。

- **标注后台更新必须阻止 Lexical 迁移选区焦点**：打开已有标注、定位锚点以及失焦后的标注对账都会触发 `editor.update`；即使带自定义 `annotation-sync` tag，Lexical 仍可能在选区更新时调用 `rootElement.focus()`，把评论输入框的焦点抢回 `contenteditable`。所有此类后台更新应同时附加 `SKIP_SELECTION_FOCUS_TAG`，并用真实桌面交互确认输入停留在 textarea 且未写入正文。

- **Lexical 块拖拽控件需要独立左侧 gutter**：`DraggableBlockPlugin_EXPERIMENTAL` 默认把 handle 定位在锚点左缘加 4px，不会为自定义 `menuComponent` 预留宽度。工作台的 `+` 与拖拽手柄合计约 60px，文章容器至少保留 64px 左侧空间，否则首个正文字符会被控件覆盖。不能只靠浮动控件的透明背景判断布局是否安全。

- **工作台多格式预览与写盘安全**：只读或二进制文件（图片、PDF、DOCX 等）必须在 Zustand store、全局 Ctrl+S 和主进程 `writeFile` 三层拦截写盘，否则 Ctrl+S 会把空文本写入二进制文件。各格式专属预览组件在路由分发时绑定 `key={activeFilePath}`，切换文件时重置缩放、旋转和编辑状态。

- **HTML 可视化编辑不要为了访问 DOM 放开 iframe 同源**：`workbench-file://` 可以在同一路径下按查询参数提供编辑文档、运行时和样式三份同源资源，iframe 继续使用 `sandbox="allow-scripts"`；父子页面只通过带来源标识的 `postMessage` 传递选区、脏状态、命令和序列化结果。跨 iframe 拖拽不要依赖事件冒泡，应由外层 Pointer Capture 加覆盖层保持指针归属，再把相对坐标下发 iframe。保存复用既有 `saveActiveFile()` 序列化后覆写原文件，不要为可视编辑另开一条没有冲突检测的写盘 IPC。

- **代码文件预览里的强制浅色浮层不能使用语义文字类**：代码文件外层有意同时挂载 `.dark` 与 `data-reader-theme="dark"`，后者会把后代 `.text-text-primary` / `.text-text-secondary` 统一刷成浅色。HTML 可视化编辑工具条若要脱离预览主题固定为浅色，不能只在容器上移除 `dark:` 背景类，还必须用 `text-gray-800`、`text-gray-600` 等具体色值替代语义文字类；取色弹层同理需要避免继承 `liquid-glass-menu` 的暗色分支。

- **iframe 编辑工具条的实时调色不能抢宿主焦点**：编辑运行时若无条件执行 `window.focus()`，颜色滑杆和 Hex 输入的每次完整色值更新都会把焦点从宿主工具条抢回 iframe，父层输入失焦后菜单随即关闭，连续输入也被打断。颜色菜单的实时预览命令应携带 `preserveFocus` 并让运行时跳过聚焦；使用 palette 或 Enter 确认并关闭菜单后可保留原聚焦行为。sandbox iframe 内的 `execCommand` 在宿主持有焦点时仍能作用于 iframe 已保存的文字 Range，但仍需用真实文字选区做回归。

- **HTML 渲染预览标注不要把评论塞进 iframe**：`workbench-file://` 同一路径用标注 query 提供文档、CSS 与运行时三份同源资源，运行时只建立可见文本索引、CSS Highlight、选区与点击命中，`postMessage` 只传 `id` 与 anchor；评论正文、编辑卡和持久化留在宿主 renderer，iframe 仍保持 `sandbox="allow-scripts"`。空白点击、滚动和 Esc 必须由运行时主动发 `dismiss`，否则新建评论卡会在 iframe 内交互后残留；关闭编辑卡时还要发 `focus` 空 id 清掉聚焦高亮。

- **注释锚点生命周期先保证未定位可见与对账完整，再引入模糊匹配**：应用标注前先收集 MarkNode 当前范围，不能先 `unwrapAllMarks()` 再全文搜索；只合并连续片段，分离副本按“同一 id 保留第一个”剥离，段落拆分导致的多 block 片段进入 `cross-block`。MarkNode 丢失后才走精确/模糊解析。未解决记录（unlocated/ambiguous/overlap）必须持久化状态并在旁注栏单独展示，批量清理按 document/source 分区，source 只能走独立删除且不能在文档选区重锚定。对账载荷携带 `baseAnchorRevision`，主进程只写真实变化并返回 `stale/skipped`；评论编辑只 patch comment，重新定位单独校验修订号。投影更新必须带 `HISTORIC_TAG` 以免进入撤销栈；切换文件、关闭工作区和关闭到托盘都必须 `await` 注释 flush。不要用按时间自动删除代替显式清理；模糊匹配只作为最后兜底，成功状态是 `shifted` 而不伪装成 `anchored`。

- **新建注释在评论保存前不能被磁盘对账回写**：打开评论卡会让编辑器失焦并触发对账，若此时用磁盘结果 `setDocumentAnnotations`，会把尚未落盘的新建草稿从 store 冲掉，之后点“保存标注”找不到记录而静默失败。create 模式要跳过 store 回写，但显式 flush（切文件、关窗、退出）仍必须先保存正文，不能连正文一起跳过。

- **Lexical 选区端点可能是 ElementNode 而不是 TextNode**：整段选中、行首行尾或跨格式选择时，`selection.anchor/focus.getNode()` 常返回 ElementNode，offset 是子节点索引而不是字符偏移。只按 TextNode 匹配会读不到选区，表现为“重新定位”无效。要同时处理两种端点，统一换算成 block 内纯文本偏移。该偏移仍是段落内坐标，构建全文锚点前必须加上所属 block 的 `start`；直接和全文偏移比较会让首段以外的创建静默失败。

- **source 投影要参与本地解析，但不能写回磁盘锚点**：只解析 `documentAnnotations` 会让 source 投影在目标文字被删后既不显示、也不进入未解决分组。本地 UI 状态要同时包含 document 与 source 的解析结果，写盘对账只提交 document，source 锚点始终以原文页面为准。

- **编辑停止后的解析必须回灌锚点，否则撤销后高亮不重现**：撤销可能恢复正文文字但不再恢复 MarkNode，此时只更新 `resolutionById` 不会触发重新投影，高亮会一直缺失。600ms 本地解析要把新的 `quote/anchor`（以及 `unlocated -> anchored` 的状态跃迁）回灌到本地标注列表触发重绘；回灌只改内存，写盘仍走失焦、保存和显式 flush。

- **旁注栏的未解决面板要计入卡片布局**：未解决面板绝对定位在旁注栏顶部、不占文档流，已定位卡片若仍从 `headerOffset` 起排就会被第一条面板盖住。用 `ResizeObserver` 量面板实际高度，把它作为卡片 `top` 的下限，并随“清理未解决”展开收起重算。

- **重命名或外部改名命中当前文件时必须原子刷新 `activeFileUrl` 与分类**：`renameNode` 与 `handleExternalFsChanged` 只改 `activeFilePath` 而不重读 `fileUrl`/`category`（外部改名不会改变 `mtime`），会导致 HTML 标注/编辑 iframe 与图片预览继续请求已删除的旧 `workbench-file://` 地址并报 `Preview unavailable`。受影响时需先校验可视化编辑离开守卫与未保存落盘，再在单次 `set` 中原子更新路径、URL 与元数据；`WorkbenchCodePreview` 应直接按文件类型初始化 `viewMode` 并把 `activeFileUrl` 纳入 iframe 预览组件 `key`。

- **HTML 渲染预览的 `Ctrl+滚轮` 缩放应在 iframe 运行时内设置 `documentElement.style.zoom`**：渲染预览由独立源 `sandbox="allow-scripts"` iframe 承载，滚轮事件不会冒泡到宿主；需在标注运行时内以 `{ passive: false, capture: true }` 拦截 `Ctrl/Cmd + wheel`（带阈值累加）并通过 `postMessage` 与宿主工具栏双向同步缩放比例。在 Electron 42（Chromium）中 `document.documentElement.style.zoom` 会随视口自然重排排版且 `Range.getBoundingClientRect()` 与 `clientX/Y` 已按缩放比同步，标注命中与评论卡定位无需额外换算，也不会污染可视编辑源码。

- **Lexical `ElementNode` 承载块级 Markdown 前缀语法时需同步切分 Source Map、只匹配前缀并补齐粘贴转换**：当用自定义 `ElementNode`（如脚注定义 `WorkbenchFootnoteDefNode`）渲染 `[^id]: 内容` 时，`markdownSourceMap.ts` 的 `isSpecialBlockLine` 与 `scanMarkdownSourceBlocks` 必须同步识别该块边界，否则连续多条定义行会被扫描器合并成单段落并引发 1:N 错位；同时 `ElementTransformer.regExp` 只应匹配行首前缀（如 `[^id]: `），让 `@lexical/markdown` 对剩余文本节点继续执行加粗、链接等行内转换。此外 `MarkdownShortcutPlugin` 仅响应键入不拦截粘贴，手贴 `[^id]:` 或 `[^id]` 落入普通 `TextNode` 后会被 `exportTextFormat` 转义为 `&#91;^id&#93;`，需在 `PASTE_COMMAND`（`COMMAND_PRIORITY_HIGH`）跳过 `application/x-lexical-editor` 与代码上下文后用 `$generateNodesFromMarkdownString` 即时转换（单行纯行内片段需拆出段落子节点避免拆段）。

- **CodeMirror 6 行号 gutter 宽度自适应与防抖动**：CM6 原生 `lineNumbers()` 通过隐藏的 `spacer`（按 `maxLineNumber(doc.lines)` 向上取整到 `9/99/999…`）计算宽度，滚动时不重测、不会抖动；真正易引发滚动/点击跳动的是旁边的自定义 gutter 列塌缩（见下条）。不要用 `formatNumber` 固定 `padStart(N, '\u00a0')` 锁死位数（会导致小文件过宽），也不要对 `.cm-gutterElement` 硬写 `width`（大文件会被 `.cm-gutter` 的 `overflow:hidden` 截断）；应恢复原生 `lineNumbers()`，在 `.cm-lineNumbers` 加 `fontVariantNumeric: 'tabular-nums'`，并在 `.cm-lineNumbers .cm-gutterElement` 设带 padding 的轻量下限（`minWidth: 'calc(2ch + 16px)'`，无额外 padding 的编辑器如 `MindmapMarkdownEditor` 用 `'calc(2ch + 8px)'`），兼顾小文件紧凑与大文件自适应。

- **`.cm-gutters` 总宽 = 各 gutter 列宽度之和，任一列塌缩都会让整体抖动**：CM6 gutter 按 `renderEmptyElements` 决定空行是否渲染占位元素——`false` 时若视口内没有 marker 该列直接塌到 0 宽，行号 gutter 自身固定宽度也救不了旁边的自定义列（如 `cm-gitGutter`）。锁 gutter 宽度必须同时处理所有列：自定义列加 `renderEmptyElements: true` 让空行也渲染占位 + 给该列固定 `width` + `flexShrink: 0`，不能只改 `lineNumbers.formatNumber`。

- **同一套 gutter 修复要同步给所有用 CodeMirror 的组件**：本项目有 3 处独立配置 `cm-lineNumbers`/`cm-gitGutter`——`WorkbenchSourceEditor.tsx`（Markdown 源码编辑）、`WorkbenchCodePreview.tsx`（代码文件预览/编辑）、`MindmapMarkdownEditor.tsx`（导图 Markdown）。修抖动时如果只改 SourceEditor 而用户实际看的是 CodePreview，症状照旧；改前先确认用户实际看到的组件路径（`lineNumbers` + `cm-gitGutter` 出现的位置就是入口），或者 grep 全量同步改。

- **可视化 HTML 编辑的撤销/重做用 post-mutation 快照 + 线性 index 移动**：无需记录反向操作——每次变更批结束后捕获 body innerHTML+attrs 快照（连续输入 250ms 防抖合并，离散命令执行前先冲刷批次），undo/redo 只是 index 前后移动并恢复快照。恢复期间必须 observer.disconnect() 再重连来吞掉回声变更，比时间窗口标志可靠（MutationObserver 微任务时序存在竞态）；快照要临时剥离 __mve_ 编辑器类、注入样式/脚本挪到 head，恢复用 innerHTML 替换 + 属性重放 + 保留滚动位。脏状态与快照基线比对双向报告，撤销回到保存点自动清脏。

- **workbench 注释精简不能按行数指标硬压**：该范围大量注释承载代码中不可见的约束（Lexical 节点生命周期/序列化边界、标注锚点对账、二进制写盘安全、iframe sandbox 隔离、性能取舍），机械 JSDoc 与步骤旁白删完后剩余多为高价值注释，强行凑百分比会丢失真实契约。可删的确定性冗余集中在：noise JSX 注释（`{/* Header */}` 类）、复述 props/类型的 JSDoc、重复的 gutter 说明、步骤编号旁白；过期表述（如 textarea 已换 CodeMirror）以代码事实为准改写或删除。有未提交功能改动的文件（如他人正在改 AgentModelPicker/FileTree）只做最小注释删改，绝不触碰功能代码。

- **Vite HMR 重载 Lexical 自定义 Node 模块时 instanceof 会失真**：HMR 替换模块后，已挂载编辑器持有的旧节点实例与新模块导出的 class 不是同一引用，`instanceof` 判定返回 false，相关命令/插件对自定义节点全部"失灵"。节点识别应兼容 `node.getType()` 字符串校验，不要把 `instanceof` 作为唯一判据；排查此类问题先触发一次整页刷新确认是否 HMR 伪影。

- **Lexical verbatim 行内容器节点（引文/注释类"原文保真"标记）的正确做法**：纯文本 ElementNode（isInline+extractWithChild+canIndent:false）+ TextMatchTransformer，xport 直接用 `node.getTextContent()` 回写原文可做到逐字节保真——xportChildren 会经 xportTextFormat 转义方括号/下划线，citekey 里的 `_` 会被改成 `\_` 造成假脏文件。
eplace 内手动 `append((match[0]))` 可阻断行内格式二次转换。TextMatch 同位置候选冲突由 transformers 数组顺序决定（先注册者赢），自定义引文必须放在内置 LINK 之后，否则 `[see @x](url)` 的链接文本被抢先转换；Pandoc key 判定须校验 `@` 前置字符非字母数字下划线，否则邮箱 `[联系 a@b.com]` 被误转换。lezer-markdown 把 HTML 注释（行内/块级）标记为 `tags.comment` 而非 `tags.processingInstruction`，HighlightStyle 缺该条目即"注释无高亮"；lezer 不识别的语法（如 Pandoc 引文）用 ViewPlugin+Decoration.mark 全文扫描补色即可，须按行扫描跳过围栏代码块、用等长空格屏蔽行内代码、并排除后随 `(`/`[` 的链接语法。CDP 验证渲染层 DOM 时注意 `contenteditable` 选择器会先命中 CodeMirror（源码模式），必须先确认 `editorMode` 再取 DOM。- **行内双链/提及类节点用 DecoratorNode + TextMatchTransformer 即可实现键入即转换**：`importRegExp` 与 `regExp` 共用同一非全局正则（脚注引用同款模式），splitText 后无需 `$` 锚定；@/[[ 唤起文件菜单用 LexicalTypeaheadMenuPlugin，多个触发实例必须分开保存 query 状态，否则无匹配实例会用 null 覆盖有匹配实例的查询；typeahead 触发是纯文本模式匹配，每次 update（含单纯移动光标）都会评估，并非输入行为；要在“敲下触发符”时才触发，需在 triggerFn 闭包内维护会话状态：仅空查询匹配激活会话，匹配消失（空白字符、光标移走、超限、删除触发符）即结束，Esc 经根节点捕获监听提前终止当前会话；查询必须排除空白字符，否则在引用键（如 @fig-xxx）后输入正文会把查询无限延长、菜单悬挂在“未找到匹配文件”。文件树拖入编辑器在 DROP_COMMAND 中用 document.caretRangeFromPoint + domSelection.setBaseAndExtent + createRangeSelectionFromDom 精确落点，不用 current selection；chip 点击用 capture 阶段委托监听 preventDefault+stopPropagation。

- **Markdown 存储模型的编辑器里 Tab 缩进必须限定 `$canIndent` 为 `$isListItemNode`**：Lexical `TabIndentationPlugin` 默认对所有 `canIndent()` 块生效，段落/标题/引用的块级 indent 只是 `padding-inline-start` 视觉态，`@lexical/markdown` 导出直接丢弃——产生“看着缩进了其实没落盘”的假状态。Markdown 唯一有缩进语义的承载是嵌套列表（`ListItemNode.setIndent` 会真实重构为嵌套列表结构，无损序列化）；`CodeNode`/`ListNode` 自身 `canIndent()` 返回 false 不受影响。判定 Tab 走 indent 还是插字符的是 `$indentOverTab`：仅当光标位于块起始或跨块选择时 dispatch INDENT/OUTDENT_CONTENT，行中按 Tab 落到 rich-text 的 INSERT_TAB_COMMAND 插入字面 TabNode。验证/选择嵌套列表 DOM 时注意：父级包装 li 的 `textContent` 会连带包含所有子孙列表文本，取叶子 li 必须过滤 `!li.querySelector('li')`。CDP 行为验证 Tab 语义可用 `Input.dispatchKeyEvent` rawKeyDown+keyUp（`windowsVirtualKeyCode: 9`），caret 用 TreeWalker 首个 TextNode offset 0 精确定位到块起始。
### React 状态与组件生命周期

- **跨页提升共享 UI 必须迁移实例与消费回调**：把抽屉、弹窗等共享 UI 提升到 App 层时，必须同时移除原页面实例，并把原页面回调接到新的 pending 状态消费点；只替换顶部状态变量会造成按钮可以触发，但没有实际恢复逻辑。

- **持久化列表按稳定业务 ID 双层去重**：提示词、模型等列表来自磁盘配置时，读取侧和渲染侧都应按稳定业务 ID 去重；局部变量命名还应避免与旧 HMR 模块中的同名绑定产生歧义。

- **同一事件或定时回调读取最新状态要区分时序**：先 `setState` 再同步调用读取该 state 的函数，仍可能读到当前渲染的旧值。可直接传入新值，或在必须跨异步回调读取时同步更新 ref 镜像，但不要一律增加镜像层。依赖数组会按状态变化重建回调或定时器，这是可接受的实现选择；只有需要稳定调度器时才用 ref，不能把两种时序混用。

- **React 初始化顺序与 TDZ**：渲染期执行的 `useMemo` 或派生表达式不能引用尚未初始化的 const/state，否则会触发 `ReferenceError`。`useEffect` 回调在提交后执行，不应笼统认定为渲染期立即执行；其依赖数组表达式仍在渲染期求值。被依赖状态先声明，递归树纯函数优先放模块作用域，避免初始化时自引用 `useCallback`。定向类型检查与实际页面触发应结合使用。

- **ResizeObserver 必须追踪 DOM 节点和父级提交时序**：同一组件在不同模式分支下分别渲染挂载了同一个 ref 的 DOM 元素时，如果 effect 只监听 `isActive` 而不监听 DOM 节点，Observer 会滞留旧节点并上报 0 宽度，新节点则永久冻结在 0px；应使用 callback ref 追踪 DOM 节点变化，并在 CSS Grid 列宽处提供 `minmax(0, 1fr)` 安全保底。子组件的 `useLayoutEffect` 先于父组件 ref 挂载执行，读取父级 `stageRef.current` 会拿到 `null` 并直接返回；应改为 `useEffect` 初始化 ResizeObserver，或在 ref 回调里建立观察，断点同时按容器 `clientWidth` 判定，不要误用窗口宽度。

- **浮层/面板组件必须定义在模块级，状态对象整传避免 props 枚举**：组件在父组件函数体内定义时每次渲染都是新引用，React 视为不同类型而整棵重挂载，输入焦点与内部状态丢失；拆分重构时把组件提升为模块级函数。跨层传递整组状态时，可用状态 hook 的 `ReturnType` 推导类型并将 state 对象整体下传，避免逐个枚举 props 导致的漏传与签名漂移。半透明 sticky 浮层类方案若被否决，结构性布局（固定头+独立滚动区）通常是正确方向，不要继续在浮层上叠加补丁。

- **`useSyncExternalStore` 驱动的订阅版本号必须进入 `useMemo` 依赖数组**：订阅 bump 只触发重渲染，不会使 deps 未变的 `useMemo` 失效——异步结果（如磁盘 stat）到达后组件确实重渲染了，但 memo 缓存的 null 原样返回，"unknown→exists 升级"链路静默断裂且无任何报错。凡是在 memo 内消费的外部可变状态（模块级缓存、版本计数），其版本号必须入 deps。

### 工作台文件与上传
- **文件树剪切（Ctrl+X）与系统剪贴板互操作**：剪切语义靠 Windows 剪贴板 `Preferred DropEffect` 位掩码 `DROPEFFECT_MOVE=2`（PowerShell `DataObject.SetFileDropList` + `SetData('Preferred DropEffect', MemoryStream(int32))` 写入，读取时 `BinaryReader.ReadInt32() -band 2`）。**PowerShell 5.1 的 `ConvertFrom-Json` 会把 JSON 数组作为单个 Object[] 元素返回**，`@()` 包裹后元素被空格拼接成整串（多文件复制因此被拼成单路径的存量 bug），必须用 `[string[]]($json | ConvertFrom-Json)` 强转逐元素展开；ps1 脚本传数组参数都要走这个模式。粘贴完成后要清空剪贴板剪切态，但仅在文件列表与预期完全一致时清，避免误清用户随后复制的内容；清空时机统一在 store 层全部移动成功零失败时，不在 main handler 分叉。**移动语义的跨盘 cp 绝不能带 `isBlockedImportName` 排除过滤**——那是复制/导入的规则（跳过 .git/node_modules 等），移动时源会被整体删除，被排除内容直接数据丢失。内部剪切粘贴走 `moveNode→renameNode` 联动链（assets 目录/导图绑定/标注/标签页重映射全保留）；外部源走 `moveExternalPaths`（同盘 rename、跨盘复制后删除回滚），store 按小写归一化分流内外路径。原地剪切粘贴为无操作（Explorer 语义，不产生 -n 副本）；原地判定与防自我包含比较在 Windows 必须 `toLowerCase()` 归一（Explorer 剪贴板路径大小写不保证与工作区一致）。剪切项用 opacity-50 半透明（只作用图标与名称，不影响选中高亮），Esc 取消剪切态；paste 事件必须有 input/textarea 守卫——移动不可撤销，重命名输入框内的 Ctrl+V 不能接管。CDP 行为验收文件树可用 `window.__workbenchStore` 钩子 + dispatchEvent 合成 KeyboardEvent（React 合成事件不校验 isTrusted），但 paste 事件的 clipboardData 无法合成，外部粘贴链需直接驱动 store 动作验证。

- **外部文件导入不能信任 renderer 的 `File.path`**：Electron 32+ 已移除 `File.path`，本地路径用 `window.electron.webUtils.getPathForFile(file)`，`@electron-toolkit/preload` 的 `electronAPI` 已自带 `webUtils`。拖入目录也会作为条目出现在 `dataTransfer.files`，`getPathForFile` 返回目录路径，主进程 `stat.isDirectory` 区分后 `fs.cp recursive`。区分内部移动与外部导入看 `dataTransfer.types.includes('Files')`；paste 事件只派发到焦点元素，文件树容器需 `tabIndex={-1}` 并在 `onMouseDown` 里聚焦（跳过 `HTMLInputElement`）才能接 `onPaste`；`clipboardData.files` 为空时放行给编辑器。

- **交给 Webview/CDP 的上传路径必须由主进程管理**：renderer 文件对象的本地路径可能为空或不可用，不能直接传给 webview。应把文件内容经受限 IPC 写入主进程管理的临时目录，再把临时路径交给 Webview/CDP，流程结束清理。跨 webview 拖拽时，宿主侧挂 `absolute inset-0 z-40` 拖拽遮罩，用 Zustand `draggingNodes` 激活，捕获 drop 后经 `window.api.dispatchFileDrop` 发送 `Input.dispatchDragEvent`；文件夹要拦截并提示。

- **拖拽上传的成功必须以附件就绪为准**：`Input.dispatchDragEvent` 返回成功只代表事件已派发，未登录、页面未就绪、附件超限或落点错误时同样返回成功。drop 前读取 `generateFileUploadStateScript` 基线，drop 后以“文件名新命中或附件计数增加”且 `!busy` 连续稳定 3 次判定成功；落点脚本必须过滤不可见或禁用的输入框，找不到时明确失败，禁止回退到 `document.body` 的 `(10,10)`。折叠侧边栏不能靠 `dragenter` 展开后卸载条带，那会在 drop 前移除目标；应在 drop 时把 `draggingNodes` 快照交给常驻侧边栏，一次完成展开与上传。外部文件 drop 优先看 `dataTransfer.types.includes('Files')`；树节点或编辑器的 `stopPropagation` 会让窗口冒泡清理失效时，在 document 捕获阶段清理。

- **同名附件才改后缀，临时副本要等附件就绪后再删**：基线 `attachmentCount > 0` 不等于“已有同名附件”，输入框里可能挂着上一轮的其他文件；只有 `nameMatched` 才需要加 8 位短后缀。CDP 拖拽按磁盘真实文件名派发，需要改名就复制到临时目录，但不能在 `dispatchFileDrop` 返回后立刻删，平台读取大文件是异步的；临时目录收集到列表，在整批附件解析稳定后的 `finally` 统一删除。

- **上传互斥锁必须有超时与代际号**：`uploadingRef` 只在 `finally` 释放时，如果 `webview.executeJavaScript` 或 `window.api.dispatchFileDrop` 永不 settle，后续上传会永久停在“正在上传上一批文件”。给脚本调用 5 秒、CDP 派发 15 秒的 `withTimeout`，锁记录 `startedAt` 并允许超时接管，用递增的 `uploadGenerationRef` 判定批次归属；旧批次迟到时既不能释放新批次的锁，也不能覆盖新批次的提示。“停止等待”只推进代际号并清空当前提示，不强行中断已经派发的拖拽。

- **上传提示复用项目 Toast**：一键发送当前文档前先保存未落盘内容；上传中显示信息态进度，成功后恢复成功提示，统一样式来自 `ControlBar`/`ModelOutputCard` 的 `notification-popup`、白底半透明、彩色细边框和 `shadow-float`，不另造状态条。失败和部分成功分别使用错误态和信息态。

- **CLI `--image` 优先粘贴式上传，CDP 拖拽兜底**：`--image` 逐张走 `uploadAttachments` 和 `generateFileUploadStateScript` 轮询就绪。主进程 `readFile` 得到 base64，再由 `generatePasteFileUploadScript` 在页内用 `new File + DataTransfer + ClipboardEvent('paste')` 派发到输入框；主流编辑器都监听 paste，不依赖页面监听 drop，也不挑落点坐标。paste 失败再退回 `dispatchFileDrop`。就绪检测不能只按全文件名匹配，图片常只渲染缩略图或 chip；`nameMatches` 依次试全名、去扩展名主干、主干前 16 字符，并加 `hasAttachmentNode` 兜底。

- **二进制文档只记指纹，不按 UTF-8 读正文**：PDF、Word（`doc/docx/docm`）、PPT（`ppt/pptx/pptm`）不能 `readFile(..., 'utf8')`，否则快照、哈希和“基于旧版本”判断全部失真。版本指纹统一为 `binary:<sha256(size:mtime)>`，生成时只 `stat` 补指纹，快照保持空串，复制或移动克隆记录也走同一分支。扩展名判定要覆盖 `docm`、`pptm`；多个同 size+mtime 候选无法可靠区分时返回 null 让用户确认，不猜绑定。思维导图文本材料（含 PDF/Word/PPT 选区）写成 `.md` 附件，原文件材料直接上传工作区文件，大文件跳过 Base64、优先 CDP 拖拽。

- **本地文件预览不要把完整内容塞进 renderer**：图片经 `workbench-file://` 交给 `<img>` 流式解码，避免 base64 约 4/3 的文本放大；PDF 使用受信 IPC 分段，由 `PDFDataRangeTransport` 按需取块，renderer/store 不保留完整字节或 data URL。`workbench-file://` 只服务图片和 HTML iframe，CSP 的 `connect-src` 不列入该 scheme，也不为 PDF 打开 `corsEnabled` 或跨源 fetch。PDF.js 的 `requestDataRange(begin, end)` 是 end-exclusive，本项目 `readPdfRange` IPC 是闭区间，适配层必须传 `end - 1` 并处理 `end <= begin`；开发版已验证尾段 `[262144, 467290)` 转为 IPC `[262144, 467289]`，文字层和图片预览正常。

- **PDF 滚轮缩放要拦截非被动 wheel 并累加增量**：缩放状态留在 `WorkbenchPdfPreview`，`WorkbenchPdfViewer` 只通过 `onZoomStep(direction)` 上报方向，工具栏与滚轮共用同一档位和上下限。方向按 `deltaY` 语义映射：负值（向上）放大、正值（向下）缩小，与图片预览及浏览器默认一致。`Ctrl/⌘ + 滚轮` 监听必须注册在 PDF 滚动容器上且 `passive: false`，否则 `preventDefault()` 无效、会同时触发 Chromium 页面缩放；触控板一次手势会连续派发小 `deltaY`，需按方向重置并累加，超过阈值才推进一步，否则会一帧跳过多档。`deltaMode` 为行或页时要换算成像素增量。

- **pdf.js 深色模式图片保留依赖正确包围盒与运行时资源**：`Util.axialAlignedBoundingBox(rect, ctm, output)` 的 `output` 是并集累加语义（与既有值取 min/max 合并），必须初始化为 `[Infinity, Infinity, -Infinity, -Infinity]`；用 `[0,0,0,0]` 初始化会让每个图片框都被并集扩展到页面左上角，表现为照片所在的整行区域发白。覆盖页面面积 >=85% 的图片应视为整页扫描件随页面一起反色，否则扫描书在深色模式下等于没开深色。JBIG2/CCITT 扫描件、CJK cmap 与标准字体依赖 `pdfjs/{wasm,cmaps,standard_fonts}` 运行时资源：dev 下 vite SPA fallback 会把这些路径返回成 `text/html` 的 index.html（fetch 状态 200 但内容错误，解码静默失败页面空白），排查 dev 资源加载先查 Content-Type 而不是状态码；`electron.vite.config.ts` 需用 dev 中间件从 `node_modules/pdfjs-dist` 按正确 MIME 提供，且插件不能写 `apply: 'build'` 否则 `configureServer` 不生效。实验验证：Electron 打包环境 `file://` 页面内 fetch/XHR 同目录文件均可正常读取，跨 scheme 自定义协议 fetch 反而会被拦。

- **pdf.js worker 资源路径必须绝对化且 worker bundle 不能过 vite 管线**：module worker 内 `fetch(relativeUrl)` 与动态 `import` 都相对 **worker 脚本自身 URL** 解析而非 document base（实测 `/sub/dir/worker.js` 里 `fetch('x')` -> `/sub/dir/x`）。pdf.js 传相对路径 `pdfjs/wasm` 时若 worker 在 `/pdfjs/pdf.worker.min.mjs`，会被解析为 `/pdfjs/pdfjs/wasm` 404，wasm 实例化与 nowasm fallback 双挂，JBIG2 decode 永久 pending、`renderTask.promise` 永不 resolve——页面彻底空白且零报错（worker console 不进主控制台）。`cMapUrl/standardFontDataUrl/wasmUrl/iccUrl/workerSrc` 必须 `new URL(path, location.href).href` 绝对化。另外 vite dev 对 `/@fs/` 模块做 import 分析会注入 `@vite/client`（DOM 环境代码）并用 injectQuery 改写动态 import，worker bundle 必须原始字节直出（dev 中间件 + 构建复制到 `out/renderer/pdfjs`），不能用 `?url` import。调试 worker 内部：browser 级 CDP `Target.attachToTarget` 非 flatten + `Target.receivedMessageFromTarget` 隧道可注入探针，但 worker 事件循环卡死时无解，此时用分步 promise 超时定位卡点。

- **Word 预览走二进制 IPC，不用 base64 dataUrl**：`workbench:read-docx-bytes` 返回 `Uint8Array`，渲染层解析完即释放，不写入 store。实测 10.5MB 文档：直接传字节时渲染进程外部内存增加约 1x 文件大小；base64 链路在主进程多常驻约 1.4x（字符串），渲染层再叠加约 2.3x（字符串 + `atob` 二进制串 + `Uint8Array`）。`docx-preview` 体积约 578KB，必须 `await import()` 懒加载，否则拖慢工作台首屏。

- **`docx-preview` 的 `ignoreWidth` 会破坏版式**：它会去掉 `section` 的页宽，正文被压成约 360px 窄条并保持固定宽度，仅用 CSS 拉宽 `section` 无法让段落重排。正确做法是 `ignoreWidth: false` 保留 Word 页宽，渲染后测量 `section.docx` 宽度并按容器宽度对 `.docx-wrapper` 设置 `zoom`（只缩小不放大），再用 `ResizeObserver` 跟随右栏展开重算。

- **`docx-preview` 默认会引入两个风险点**：`renderAltChunks` 会把文档内嵌的原始 HTML 写入 iframe `srcdoc`，等同执行未审查内容，预览应关闭；文档超链接是普通 `<a href>`，点击会让主窗口整页导航，必须在容器上拦截并改为 `shell` 外链或容器内锚点滚动（书签渲染为 `span[id]`）。内嵌图片和字体是 `URL.createObjectURL` 生成的 blob URL，卸载或重渲染前必须遍历 `img[src^="blob:"]` 与 `<style>` 中的 blob 地址 `revokeObjectURL`。

- **docx 大纲识别要走 `WordDocument` 树，不能按渲染 className 匹配**：`docx-preview` 0.4.1 的 `renderAsync` 直接返回 `parseAsync` 产出的 `WordDocument`，不必拆成 `parseAsync + renderDocument` 两步。OOXML 大纲层级在 `paragraph.outlineLevel` 顶层字段和 `style.paragraphProps.outlineLevel` 样式继承上；渲染输出只把 styleId escape 成 `docx_<id>` class，中文论文模板的自定义 styleId（如 `a7`、`a0`）按 className 正则识别完全失效。悬浮大纲 UI 抽成 `WorkbenchTocRail` 公共组件，Lexical 与 docx 各自只做数据源适配（`items` + `resolveElement` 回调），避免平行复制交互。

- **Office 预览三件坑**：(1) Chromium Web Worker 无 DOMParser/DOM API，worker 内解析 OOXML 必须自研定向 XML 解析器（OOXML 输入域规整：预定义实体、固定前缀、无 DOCTYPE，150 行足够）；(2) IPC 返回的 Uint8Array 可能是共享池视图（byteOffset≠0），transferable 传 .buffer 会把视图外字节带进 worker，必须 slice 精确副本；(3) @e965/xlsx 对非 zip 输入静默降级 CSV 解析不报错，损坏/加密文件必须靠 PK 魔数前置校验拒绝。office 解析库放 worker chunk 天然与主 chunk 隔离（xlsx 160KB gzip/pptx 37KB gzip），无需 manualChunks。

- **pptx 预览高保真路线实测结论（2026-11）**：当前 officePptx.worker 定位"内容预览"，对设计型 PPT 失真根因是架构性缺失——schemeClr 主题色/solidFill 形状填充/prstGeom 几何/母版与版式合成/组合 chExt→ext 缩放/文本排版属性（lnSpc、anchor、insets、buChar、字体族）全部丢弃。npm 生态无可直接采用的开源高保真 pptx 渲染器（pptxjs 系失修、pptxtojson 只解析不渲染且 PPTist 是 AGPL）。高保真现实路径是 MS Office COM 后台转 PDF：`New-Object -ComObject PowerPoint.Application` 启动 ~1s，`Presentations.Open(copy, -1, 0, 0)` 只读无窗口 + `SaveAs(pdf, 32)`，29 页 6.6MB 实测全程 5.4s（PNG 逐页路线 3.2s），文字可选中、可复用 WorkbenchPdfViewer；COM 是 attach 语义，必须以文档路径跟踪自己开的 Presentation，只 Close 自己开的、只在自己拉起的进程上 Quit。分析 zip 类文件用 node_repl + jszip 比 PowerShell 传中文路径参数稳（pwsh 策略常拦截含中文/复合删除的直传命令）。

- **pptx 高保真预览落地经验（2026-11 方案 B 实施）**：(1) `Kwpp.Application` 与 `PowerPoint.Application` 都可能被 WPS 接管——本机两个 ProgID 产出的 PDF 完全一致且 creator 均为 WPS，探测顺序按优先级排列即可、不必区分；(2) COM 脚本内自探测 ProgID + 转换前快照 POWERPNT/wpp 进程，只有进程是自己拉起的才 Quit；(3) 缓存键用 `sha1(绝对路径) + size-mtime` 指纹命名，命中 4ms vs 转换 5s 级；(4) PdfViewer 泛化 `readRange` 回调供数 + `invertContent` 开关是 PPT 复用的关键——幻灯片等彩色版面暗色主题只许改画布衬底，`isDark` 传 false 后连图片叠加层提取（getOperatorList）都跳过；(5) 主题配置按格式独立持久化（pptxBackgroundTheme 与 pdfBackgroundTheme 互不干扰），picker 加 options 过滤子集；(6) CDP 验收跨应用重启后 node_repl 内核绑定丢失，WS 客户端需重建。

- **工作区搜索要把取消判断与扫描预算分开**：`workbenchService.search` 的停止条件分两层——`isCancelled`（同工作区新搜索到达，一切立即停止）与 `isContentStopped`（内容扫描额外受条数/1500ms 预算约束）。文件名匹配不受时间预算截断（纯字符串比对开销极小），否则大工作区里排在后面的目录文件名永远搜不到；文件名结果独立收集后按"前缀命中 > 名称包含 > 路径包含"排序并整体排在内容结果前，最后统一截断到 MAX_SEARCH_RESULTS。验证时可用 esbuild `--alias:electron=<stub>` 把 service bundle 成 cjs 在纯 Node 下跑真搜索，不必起 Electron。

- **`data:` base64 图片在渲染层复制与上传的三个坑**：(1) CSP `connect-src` 不含 `data:` 时 `fetch(dataUrl)` 直接被拦，应直接解析 `data:` URL 解码字节或放行 `data:`；(2) `new URL(dataUrl).pathname.split('/').pop()` 会把整段 base64 荷载当成文件名，传给 `create-temp-upload-file` 触发 `ENAMETOOLONG`，`data:`/`blob:` 必须跳过 `URL.pathname` 取名；(3) 跨源 `sandbox="allow-scripts"` iframe 内 `webContents.copyImageAt` 与 `navigator.clipboard.write`（受聚焦/SVG/JPEG 限制）不可靠，统一在渲染层解码/canvas 栅格化 SVG/WebP 为 PNG 后走主进程 `nativeImage.createFromBuffer` + `clipboard.writeImage` 写剪贴板。

### 笔记、快照与导图

- **来源会话键保留完整规范化 URL 路径**：截取第一个 chat 片段会把 `chat/s/id1` 和 `chat/s/id2` 错误分到同一会话。来源会话入口的 UI 判定必须用 `isPlatformConversationPage` 的逐平台真实路径枚举，不能复用后台恢复用的宽松 `isConversationUrlForPlatform`，后者会命中同域名的设置页、搜索页和文档页。新增平台或路径时同步补 `scripts/agent-cli-acceptance.mjs` 的正负样例，负例至少覆盖同域名非会话页和非 AI 站点。

- **工作台文档与导图以路径为身份、以指纹判改名**：记录键由“规范化工作区路径 + 相对路径”派生，不写文档 frontmatter。文档删除时导图立即删除；外部改名或移动无法与删除区分，只能在文件树刷新后对账：先让路径仍在的记录占位，再对路径消失的记录按 `size + mtime` 完全一致筛候选，唯一候选直接重连，多候选读文件比内容哈希，仍不唯一就按删除处理，绝不猜。对账索引必须由渲染层随文件树传入，主进程不自行扫盘；按 size+mtime 建桶后再匹配，避免整目录删除时的平方复杂度。删除前单独 `stat`，只有 ENOENT 才删；工作区根不可读时整轮跳过。保存成功后只更新哈希与指纹、不推进快照。生成任务持有生成开始时的 sourceKey，改名重连后用“旧路径到新路径”的映射跟随新记录。

- **导图文件即索引，不落 `index.json`**：`.multichat/mindmaps/*.mindmap.md` 由 `workbenchIndex` 按需扫描目录，`updatedAt` 取 frontmatter，外部新建文件回退 `mtime`；不存在索引损坏、索引与文件不一致、重建索引这些状态。`noteManager` 的 `serial` 队列是 promise 链且不可重入，public 方法不得在 serial 内再调用另一个也包 serial 的方法；`read()` 的返回值会被写路径透传，按文件组装的 `mindmaps` 只能放在 `readWithMindmaps()`，否则组装值写回记录 JSON 后 `prepareWorkbenchSource` 会产生第二份持久化副本，导图唯一权威是文件。判断文件是否还在盘上必须用 `stat`，不能把 `EACCES` 等读失败误判成不存在。删除、改名、覆盖前校验 `id + source + 正文` 三者一致，正文比对两侧统一 `normalizeMindmapNewlines`。外部软件改导图正文不会更新 frontmatter 的 `updatedAt`，保存必须额外带编辑前正文 `expectedMarkdown` 与磁盘比对，冲突返回 `conflict:'file-changed'`。应用自写不能按时间窗抑制 watcher，写后记录 `size + mtime` 指纹，去抖后逐文件比对。工作区换盘或改名后旧记录绝对根失效，按相对路径认领要同时满足“旧根不存在 + 全库唯一 + 正文哈希一致”。

- **导图追加修改必须复用生成页地址**：`.mindmap.md` frontmatter 只保存 `id/source/title/updatedAt`，`workbenchMindmapsFor()` 组装对象也没有 `generationSession`，文件读回后不能据此恢复原生成对话。`MindmapService` 在本次进程内按 `mapId` 保存最近生成页地址，`modify()` 按 `mapId + platformId` 取出并补进候选的 `generationSession`；`lastPage` 只作兜底，不能作为唯一来源，否则生成另一张导图会覆盖前一张地址。`run()` 只有拿到可校验的 `conversationUrl` 才会 `reused=true`，进而跳过来源文件读取和附件上传；地址缺失就会重新上传并新建对话。

- **文档来源在记录建立前只有路径，读记录必须先换 UUID**：工作台面板的 `source.id` 在尚未建档时是 `record?.id || activeFilePath`，而 `notes:get` 最终落到 `noteManager.file(id)` 的 UUID 校验，直接传路径会得到“无效的笔记 ID”。凡文档来源的读记录入口都必须先走 `resolveId()`（内部 `ensureRecord()` 建档）再 `notesGet`，并给 `resolveId` 加失败分支。可编辑 HTML 走原文件上传时必须先 `saveActiveFile()` 落盘，否则拖上去的是磁盘旧版本；它的版本哈希仍按文本计算，不能套二进制文档的 `size:mtime` 指纹。

- **旧 `NoteManager.list()` 是破坏性读取，迁移和旧页读取不能复用**：`listUnlocked()` 会按 `sourceKey` 合并记录、按 `quote` 合并批注并 `rm` 旧 JSON。旧笔记迁移必须直接 `readdir + JSON.parse` 做只读原始快照，迁移期间 `notes:list/summaries/source/anchors-for-url/export/get` 也只能读快照；任务结束后普通 `list()` 不应再自动删除旧 JSON，同源合并只做内存视图。验收必须覆盖“同一 quote 两条不同评论都保留”和“迁移前后旧 JSON 数量不变”。

- **旧笔记迁移的完成标记以目标回读为准，进度以磁盘任务为准**：`migrateOne()` 写文档、source/document 旁路或导图成功只说明调用没有抛错，不代表目标真的落盘；写 `migratedAt` 前必须回读三类目标，缺任一项就写 `migrationBlocked`（普通会话用 `verify-failed`，工作台目标文档缺失用 `workbench-unresolved`）。工作台目标文档不存在但仍有快照时，旧快照是唯一副本，必须保留 JSON 并标阻塞；只有系统临时目录下工作区已消失的早期误标记录可以重开迁移，普通工作区里用户主动删除的文档不能复活。新格式 `version: 2` 且无正文、无批注、无导图、无迁移标记的空工作台记录应直接跳过。迁移循环每处理一条都要重新读取持久化 job 再写进度，本地持有的 `running` 对象不能把用户刚点的 `paused/abandoned` 覆盖回去；默认库不可写属于任务级暂停，不应把剩余记录逐条记成失败。验收口径同时核对旧 JSON 的 `migratedAt` 与 `migrationBlocked` 互斥、默认库文档/旁路/导图唯一性、备份数量，以及 `pendingSummary` 与 `legacyMigrationJob` 是否一致。

- **迁移机制是否必要取决于数据格式是否真的进入过已发布版本**：删除或保留迁移代码前，先用 `git log`/`git tag`/`git merge-base --is-ancestor` 核实引入旧格式的提交是否在任一发布版本里。v1.3.5（未发布）曾把工作台导图写进 `NoteConversation.mindmaps` JSON，文件化改造（`.multichat/mindmaps`）落地后确认 v1.3.5 从未分发，`migrateWorkspace` 自动迁移及其在复制/移动/对账里的 legacy 分支已整链删除；工作台记录的 `mindmaps` 残留直接清空，不再收养为文件。普通会话旧笔记手动迁移（LegacyMigrationService）服务的 v1.3.1 及更早已发布用户仍然存在，不能一起删。

- **笔记属性的 URL 字段默认动作是编辑，打开动作必须有独立入口**：`FrontmatterPanel` 把 `<a>` 直接当值渲染时，普通点击会按链接导航，编辑入口只能藏在修饰键里，用户无法发现。URL 值保留 `<a href>` 以维持修饰键和中键的浏览器打开语义，但普通点击必须 `preventDefault` 进入受控输入框并自动聚焦、全选；同时提供右侧独立图标（会话链接进 AI 侧栏、普通链接进浏览器），并在 `title` 中写明 `Ctrl/Cmd+点击在浏览器打开`。编辑态分支必须排在 URL 渲染分支之前，`Esc` 取消时用标记跳过随后触发的 blur 提交。主窗口 `setWindowOpenHandler` 已把 `target="_blank"` 转给 `shell.openExternal`，无需为外链另加 IPC。

- **工作台标签对齐 Obsidian 并且要防泛滥**：YAML frontmatter 中的标签不含 `#` 前缀，`#` 只用于正文行内引导符；带 `#` 会被 YAML 包成引号字符串，破坏标准识别。解析与序列化需自动剔除 `#`、去重并格式化为 YAML 列表；属性面板聚合工作区已有标签，提供前缀或模糊匹配的下拉建议，支持方向键、Enter、Tab、鼠标点击和新建回车。检索端支持 `tag:#name`、`tag:name`、`#name` 语法，以及斜杠 `/` 的父子层级继承匹配。

- **frontmatter 多来源不能改 `source` 为列表**：`source` 同时承担原文入口、会话去重与 source 标注归属的 1:1 身份锚点。普通文档累积多来源时第一来源仍在 `source`，后续来源进独立 `sources` 列表（YAML 块状 `- url`，属性面板按行解析、逐条展示与移除，URL 含逗号等标点不能用内联 `[a, b]` 或空格拼接）；`platform`/`captured_at` 只描述主来源，本次插入未成为主来源时不补写。会话文档保持单来源，跨会话插入继续返回 conflict。行内改写与插入要按原始索引记录编辑再从后往前应用，否则前面的插入会让后续行号整体偏移。

### 导图渲染与交互

- **Markmap 中文文本会坍塌成单字竖排**：Markmap 首次向 SVG 插入 `<foreignObject>` 时尚未计算 width，Chromium 会把可断行中文压缩到最小内容宽度，随后 `_relayout()` 把宽度永久固定为约 16px。外层 `.markmap-foreign`、内部嵌套 div、`.mm-node-item` 和 `.mm-node-title` 必须统一声明 `white-space: nowrap !important` 与 `width: max-content !important`，不能只改其中一个节点。

- **外溢按钮会同时影响测量和命中**：Markmap 的 `scrollWidth` 可能包含绝对定位子元素，`opacity: 0` 或父层零尺寸不等于不参与测量；非显示态按钮应核对 `display: none`。连线端点要结合节点 `offsetWidth`、布局 rect 与 `foreignObject` 的 x/paddingX 校正，不能用透明度隐藏来假定按钮不占宽度。包装层默认大宽度在 `overflow: visible` 下可能成为透明命中遮罩，必须让真实节点和按钮接受点击、SVG 连线不拦截事件；保留文字 nowrap/max-content 与按钮外溢需求，不能全层统一 `width: auto` 导致中文再次坍塌。历史约 40px 偏移和 1–2px 穿透量只是当时观测，当前值以实现和视觉验证为准。

- **节点按钮与折叠状态不能改变连线几何**：隐藏 Markmap 原生 circle，避免与自定义添加/折叠按钮重叠；按钮应脱离文本尺寸计算并保持稳定命中，是否显示不能改变连线几何。`initialExpandLevel: -1` 对应初始全展开，运行时展开全部需更新树的 fold 状态并 `setData`。

- **隐藏画布不能参与首次 fit**：`Markmap.create(svg, options, data)` 在数据布局完成后会 fit，`autoFit: false` 不能阻止这次初始化行为。当前 `useMindmapCanvas.ts` 创建实例时不传 data；SVG 可见且宽高有效后再 `setData`，再按首次适配或变换无效状态 fit。正常树更新保留缩放和偏移，避免编辑或 ResizeObserver 的细微变化反复触发适配；尺寸阈值是实现取舍，不固定为通用 40px 规则。隐藏重开、拖动、缩放和新增节点的验收状态要查对应日志，不能由 lint/build 推断。

- **编辑状态不能重建节点 DOM**：`selectedNodeId`/`editingNodeId` 的纯 UI 变化不要触发 `setData`，避免销毁正在编辑的 DOM、Range 和焦点；树数据变化才 `setData`，选中或编辑态通过 DOM class/属性同步，`setData` 后恢复高亮。`fit/centerNode` 依赖完整 D3 transition 接口，不能把 transition 替换为原始 selection；当前采用 `duration: 0`，保留接口。避免在 `setTree` 更新函数里再次调用触发 `setTree` 的提交函数，基于 `treeRef` 的最新树执行编辑，保持持久化与 React 状态一致。

- **foreignObject 画布中的 focus 和命中区要显式处理**：包含 SVG foreignObject 和 D3 zoom 的画布中，DOM `focus()` 必须显式传入 `{ preventScroll: true }`，否则 Chromium 会滚动最近祖先容器导致视口突变。为浮动在节点边缘的操作按钮配置扩大命中范围的伪元素时，按钮自身必须具备独立定位层级（`relative + z-index`），防止父级绝对定位的伪元素遮挡真实按钮。

### 工作台 UI 与图标

- **`AppIcon` 的 `size` 不是最终渲染像素**：组件会乘 `OPTICAL_SCALE = 0.85` 抵消 Lucide 相对 Material 字体图标的视觉膨胀。旧 Material `text-base` 对应的 `size={16}` 只是保持原视觉尺寸；要与 `WebviewCard` 中 `size={20}` 的前进/后退/刷新图标看齐，应用按钮也应传 `size={20}`。统一顶栏或侧边栏图标时先按最终视觉尺寸比较，不要只看 prop 数值。
  用 absolute 定位元素对齐图标中心（如历史树的连接线、角标）时必须按渲染盒计算：`size={16}` 的实际盒是 13.6px 而非 16px，水平中心 = 左内边距 + 6.8px；直接用 `size` 数值假设会系统偏右约 1.2px。最稳的做法是让包壳宽度等于渲染盒宽（如 `w-[13.6px]` + `justify-center`），不要手算中心点写死 left。

- **图标方向不能沿用 Material 的旋转角度**：`Paperclip` 默认是左下到右上的 45° 斜向，沿用 Material 字体图标时期的 `-rotate-90` 会变成另一条 45° 斜线；要垂直应使用 `-rotate-45`。重做按钮应使用成套的 `Undo2`/`Redo2`，`Repeat` 表示循环播放，不应作为编辑器的前进/重做图标。迁移同类图标时先核对 SVG 原始方向和图形语义，不要机械保留旧 rotate 类或按名称接近程度猜。

- **未映射的 `AppIcon` 名称会静默回退成警告三角**：`AppIcon` 对不在 `APP_ICON_MAP` 中的名称使用 `AlertTriangle` 兜底，主进程右键菜单传入的新图标名必须在映射表中同步登记，否则用户看到的是看似业务警告的三角形。来源会话入口应使用会话语义图标（如 `forum`），不要用文档图标表达打开会话。
- **新增 toast/提示条必须复用 `StatusBanner`（ui/FormControls.tsx）**：项目统一的顶部居中悬浮条，`absolute top-3 left-1/2 -translate-x-1/2 z-popover`，支持 tone（error/success/warning/info）+ actions + onClose（内建 x 图标按钮）。不要在组件里另写 fixed 定位的私造提示条样式——fixed 在视觉上虽然等同视口，但既偏离统一外观，位置也容易偏离居中惯例。操作类 CTA 按钮样式对齐 `px-2 py-1 bg-white/20 hover:bg-white/30 rounded`。

- **同一业务图标只能保留一个语义名，不同业务不要共用语义名**：标注图标统一用 `annotation` 映射，当前图形为 `MessageSquareText`（message-square-text），不要再保留 `add_comment`、`sticky_note_2` 等多个名字指向同一或相近图形；Agent 新建会话必须使用独立的 `new_session` 语义名映射 `MessageSquarePlus`。修改单个业务图标前先检查 `AppIcon name` 是否被别处复用，被复用时先拆分语义名再改映射；右键菜单传入的 `icon` 字符串也要与 `APP_ICON_MAP` 使用同一个名字。

- **文件类型图标收敛时保留 Markdown/TXT 与图片原图标**：Material Symbols/Lucide 是通用操作图标体系，vscode-material-icon-theme 是按扩展名显示语言或文件品牌的另一体系，不能把后者当作 Lucide 迁移残留。工作台的 PDF、Word、Excel、PPT、代码与压缩包可以统一走 `FileTypeIcon` 本地 SVG；`.md`、`.markdown`、`.txt` 继续沿用原来的 `description` AppIcon，位图继续用 `image`，`.svg` 用 `draw`，不纳入这次 SVG 统一范围。

- **临时构造 `FileTypeIcon` 节点要补齐 `WorkbenchFileNode` 必填字段**：`FileTypeIcon` 接收完整的 `WorkbenchFileNode`，其中 `fullPath` 是必填绝对路径。预览类组件按 `activeFilePath` 临时拼节点时，`path` 和 `fullPath` 都要赋值；只补 `path` 会触发 TS2741。

- **`AppIcon` 块级化后要显式居中**：`AppIcon` 统一渲染为 SVG，赋予 `block` 类名后会脱离父级 inline 或 `text-center` 的影响，默认 `margin-left: 0` 靠左。空状态提示中要与居中文本对齐，必须配合 `mx-auto`，或把父容器设为 `flex flex-col items-center`。

- **UI 组件尺寸向核心面板看齐**：组件尺寸应与 SettingsDrawer 等核心面板规范一致，避免局部页面为了紧凑过度使用 `text-xs` 或 `text-[10px]`，否则可读性和点击舒适度都会下降。

- **设置弹窗用单一面板承载，层级靠分区与留白建立**：远程地址、预设选项和文本编辑器不要各自包成带描边的卡片，否则在弹层 framework 内形成卡片套卡片。用标题行和细分隔线划分区块；预设复选框采用无边框网格，hover 时只给轻微背景；底部只保留一个主保存动作并统一处理多个表单字段，取消按钮降为文字按钮。

- **工作台三栏布局与高频拖拽写盘要解耦**：三栏 Flex 布局中，左栏 `shrink-0`、中栏 `min-w`、右栏 `shrink-0 + overflow-hidden`；中间编辑器最小宽度不可设过大，保底约 380px 为宜，右栏用 `maxWidth: calc(100% - ...)` 做纯 CSS 硬件保底，防止 1100px 小窗口下总宽溢出。Store 动态 clamp 要联动窗口实际宽度、中栏保底线和左栏折叠状态；Splitter 的高频 `pointermove` 只更新内存状态，持久化 `storeSet` 延迟到 `pointerup` 单次执行，窗口 resize 监听用 `requestAnimationFrame` 防抖并单向收敛。

- **工作台双视图切换要按文件记忆各自滚动位置**：`WorkbenchEditor` 用 `editorMode` 条件渲染预览与源码，切换时整棵编辑器卸载，两套滚动容器都会从顶部重新挂载。滚动记忆键要包含工作区、相对路径与视图，避免同名文件或跨工作区串位；只存内存即可。恢复预览时不能只赋值一次：Lexical 解析、字体和图片缩略图会继续改变内容高度，内容未撑开时 `scrollTop` 会被浏览器夹紧，若此时写回记忆就会覆盖原位置。正确做法是恢复期间忽略 `scroll` 记录，用 `ResizeObserver` 或有限帧重试直到目标位置可达，并在用户滚轮、触摸或按键时立即结束恢复；源码侧在 `useLayoutEffect` 中恢复 `textarea.scrollTop` 并同步高亮层和行号列。

- **旁注和评论卡定位不要复用正文选区联动**：选中标注会触发编辑器选区定位，浮动格式条会停在评论卡上方遮挡输入区；窄屏旁注入口应自行滚动定位，再直接打开共享评论卡，不依赖选中态滚动。旁注栏头必须挂到滚动层外并按滚动视口定位：把栏头放在随正文滚动的旁注列内，即使 `position: sticky` 也会随列内容离开可视区；展开态栏头应 portal 到编辑器根节点，用滚动容器的 `getBoundingClientRect()` 计算顶部内边距。吸附控件要同时读首行锚点和滚动容器视口，不能只按文档坐标 clamp，否则滚动后会飞出屏幕或展开瞬间跳回文档顶部。

- **切换文档的闪现要同时约束浮层和侧栏列表**：旧评论卡和旧旁注卡片来自两份异步状态，只清理其中一份仍会在新文档首帧闪出。浮层要记录打开时的文档身份并在提交阶段比对；侧栏要同时校验 `workspaceRoot` 与 `relativePath` 后才渲染标注列表。

- **旁注不参与正文布局流，正文始终居中；大纲贴编辑区左缘**：把旁注列作为 flex 兄弟节点会在展开时挤动正文，任何“占位补回”都只是把横向位移转移到别处。正文列应固定 `mx-auto` 居中，旁注改为绝对定位，水平基准取正文文本右缘加固定间距；用 `ResizeObserver` 测量右侧实际留白，够宽才展开卡片列，不足则收成计数入口，不留占位元素。大纲导航的锚点是编辑区左缘而不是正文左缘，直接用固定 `left` 定位，悬停标题用 body 级 `fixed` 浮层向右展开，既不被目录自身滚动裁切，也不改变正文与滚动位置。

- **弹窗遮罩不要叠加全屏模糊与淡入动画**：Electron 下 `fixed inset-0` 的 `backdrop-blur-sm` 再配透明度动画，会让合成器跨 `<webview>` 与下层 glass-panel 反复全屏采样重绘，确认弹窗出现明显卡顿。统一 `Modal` 的 `backdrop` 分两档：`none` 用透明拦截层保留阻断 webview 穿透与点外部关闭的语义，`dim` 用 `bg-black/25` 纯色压暗且不做遮罩动画；只保留面板自身的 `modal-zoom-in`。

- **工作台局部阅读暗黑主题不能只靠 `.dark` 类名切换**：`tailwind.config.js` 的 `text-primary`（`#1f2937`）与 `text-secondary`（`#6b7280`）是静态 Hex 值，局部挂载 `.dark` 时这两类字色不会自动反转；必须配合容器属性选择器（如 `[data-reader-theme='dark']` / `[data-reader-toolbar='dark']`）显式覆写字色与下拉菜单容器（`WorkbenchDropDown`、块插入菜单等 portal 到 `body` 的浮层需单独透传暗黑状态）。HTML 原生 `<mark>` 元素在 Chromium UA 样式表默认带 `color: black`，暗黑模式下必须在 `.PlaygroundEditorTheme__mark` 显式声明 `color: inherit`。对 Word `section.docx` 施加 `invert(...) hue-rotate(180deg)` 暗化纸张时，需清除原有 `box-shadow` 改用细 `outline`（避免阴影反色成白光圈），并对内部 `img/svg/video/canvas` 做反向 `invert(1) hue-rotate(180deg)` 还原媒体原色；PDF 页面则用浅色 `mix-blend-mode: multiply` 着色、暗黑 `invert(0.882) hue-rotate(180deg)`。

- **工作台文件树搜索是局部状态，不是独立模式**：工具栏搜索按钮首次点击只进入搜索态并聚焦输入框，已处于搜索态时再次点击应聚焦输入框，不应反向退出；退出统一收敛到输入框关闭按钮、`Esc` 和“打开结果成功”三条路径。`WorkbenchSearch` 不需要同时放“清空”和“返回”两个语义相近的按钮，退出时由文件树侧把焦点还给工具栏搜索按钮。点击搜索结果后调用 `openFile`，其返回值表示文档是否真正打开；成功后才退出搜索，`openFile` 自身已经展开祖先目录，文件树的 `activeFilePath` 跟随 effect 会完成滚动定位。

- **宿主 UI 配色要跟随内容表面而非容器主题偏好**：工作台代码/文本预览容器曾无条件挂 dark 类，HTML 渲染白底页面上状态胶囊和「发送到 AI」按钮被 dark: 变体染成半透明暗色不可见；正确解法是按内容表面驱动——预览组件把『是否 HTML 渲染表面/是否可编辑』上报 store，宿主容器据此摘掉 dark 类、状态徽标按可编辑态显隐，比给单个组件加 forceLight 补丁更可扩展。PDF/DOCX 预览的深浅色由各自的 reader 主题偏好控制，不受此影响。

- **flex(row) 容器内的 flex-col 子根元素必须声明 w-full min-w-0**：不声明时子元素按内容最小宽度收缩而不是填满分配宽度，右侧面板会出现大块空白、尾部的关闭/操作按钮随之偏移，视觉上像"布局整体失效"。三栏侧栏类布局改容器结构后，逐层核对每个 flex 子项的 width/shrink 约束。

- **布局类方案评审与验收都以代码事实为准**：改全局布局前先 rg 全量审计目标 class（如 max-w/mx-auto）的命中点——各分页若有独立容器（固定头+独立滚动区）会逃逸主滚动容器的约束，只改主容器页面不变；反过来，方案中列出的"待改点"可能早已存在，落地清单要先核对现状，避免把存量样式当成新增改动重复实现。

- **工作台局部浮层尺寸遵循 DESIGN.md 语义 token**：局部工具卡片/浮层优先用语义字号与 32px 控件高度，不要用 text-caption/tiny 配 py-0.5 把操作目标压得过小；违反时先查 DESIGN.md 的对应档位再局部对齐，不为单个浮层新造尺寸体系。

- **CSS 裁剪容器必须自带圆角**：`rounded` 写在父级而 `overflow-hidden/auto` 在内层时圆角会失效——裁剪边界取的是内层矩形容器的边框盒，父级圆角管不到内层的溢出裁剪。圆角与 overflow 要落在同一元素上，或裁剪发生在已带圆角的那层。

- **行内文件 chip 统一为 WorkbenchFileChip 形态（文末附件胶囊已删除）**：回复正文内联 chip 是图标+主题色文字（text-primary/hover 浅底）、无背景无描边、字号继承上下文，编辑器双链 chip 复用同一形态；用户消息气泡的 @mention chip 是白底半透明独立样式。曾经存在的"回复底部附件胶囊"（描边 rounded-full）因与行内 chip 冗余已整体删除，不要再恢复。图标尺寸用 em 字符串（AppIcon 支持 em 分支并与数值路径同乘 0.85 光学系数），FileChipIcon 默认 1em 随字号缩放。

- **下拉菜单的"点击外部关闭"不能在 capture 阶段无条件卸载菜单**：window 上 capture 阶段的 `mousedown` 监听先于菜单项的 `click` 触发，直接卸载会让 click 落在已脱离文档的节点上不触发（菜单看似点了没反应）。外部判定必须排除菜单本体与触发按钮（如用 `data-*` 属性 + `closest` 检查），React 18 根监听是 bubble 阶段的 `click`，节点提前脱链后事件不会再派发到根。

- **`backdrop-filter` 元素会劫持所有 `position: fixed` 后代的定位**：Chromium/Electron 中，元素带 `backdrop-filter`（含 `-webkit-` 前缀，如 `liquid-glass-menu` 毛玻璃菜单）时，其 fixed 后代的包含块变为该元素的 padding box 而非视口——按视口坐标算好的 left/top 会被二次偏移，浮层渲染到视口外（实测 fixed 子元素坐标 = 视口坐标 + 祖先偏移，absolute 后代不受影响）。菜单内嵌套子菜单/fixed 浮层必须 `createPortal` 到 `document.body`；portal 后 DOM 父子断开，`mouseenter/leave` 的层级语义失效，hover 展开要用可取消的短延迟关闭定时器（约 250ms），并把"点击外部关闭"的 contains 判定扩展到 portal 出去的浮层节点。

- **拖选类交互的 elementFromPoint hit-test 必须用探针式夹紧**：指针位于滚动条带（`clientWidth/clientHeight` 之外的 8px 条带）或网格内容以外的空白区时，`elementFromPoint` 命中的是滚动容器而非内容元素，焦点会冻结。正确做法是把探针坐标先夹紧到「内容矩形 ∩ 滚动容器客户区（`scroller.clientWidth/clientHeight` 换算的右/下边界）」的交集内再 hit-test，命中最近边缘元素——这正是 Excel 拖选的钳制语义，还能让帧驱动的边缘自动滚动在双向（正反向）都成立。配套教训：`element.style.boxShadow` 读回被浏览器序列化为 `rgb(16, 124, 65)` 而非 hex，验收断言必须兼容两种形式。


- **Tailwind 同一属性的多个类共存时生效方由编译产物排序决定**：g-white 与 g-[#e9e9e9] 同时挂在一个元素上时，谁生效取决于 CSS 文件里两个类的先后位置而非 className 书写顺序，且 dev JIT 增量追加与 build 全量排序的结果可能不一致（曾导致表格选区灰色遮罩在构建产物中被 bg-white 覆盖丢失）。互斥状态的样式必须保证每种状态只输出一个类；验证这类视觉属性要用 getComputedStyle 计算样式断言，className 存在性断言在级联被覆盖时照样通过。

### 窗口、划词与快捷键

- **快捷窗口保持可聚焦，被动弹出不要抢焦点**：避免同时使用 `focusable: false` 和依赖完整 `click` 事件；用 `showInactive` 控制被动弹出时不抢焦点，让窗口保持可聚焦，并在 `pointerdown` 派发一次性动作。快捷窗口初始配置应为 `alwaysOnTop: false`、`skipTaskbar: false`，让用户通过 pin 按钮决定是否置顶；`skipTaskbar: true` 会让窗口被其他窗口遮挡后无法从任务栏找回。`isPinned` 由前端 toggle 驱动，通过 `quick:get-always-on-top` / `quick:set-always-on-top` IPC 控制。

- **Windows 强制聚焦要临时置顶并恢复用户状态**：Electron 后台或隐藏窗口直接 `show()/focus()` 会被 `SetForegroundWindow` 限制拦截，并引发任务栏或边框闪烁。需要强制聚焦时，先 `win.setAlwaysOnTop(true)`，再 `win.focus()`，约 50ms 后恢复原来的 `isAlwaysOnTop` 状态；不要永久把窗口设为置顶。

- **全局快捷键自动复制必须先读取再显示窗口**：快捷键回调中先模拟复制，读取成功后再 `qw.show()/focus()`，最后发送 `quick:inject-prompt` 完成一键总结；顺序反了焦点会被 Electron 抢走，模拟按键打在 Electron 自身。触发全局快捷键后先等待约 250ms 释放物理按键，避免用户仍按着 Ctrl/Shift 导致组合键冲突。复制可通过写入临时 `.vbs` 并用 `execFile('cscript.exe', ['//NoLogo', path])` 异步执行，启动快且隐藏。先 `clipboard.clear()`，等待约 150ms 再读；若无新数据，恢复旧剪贴板但必须返回空字符串，回调中拦截空文本，不唤起弹窗。

- **快捷窗口的 Webview 处理器要单独注册**：`quickWindow` 是独立 `BrowserWindow`，主窗口的 `did-attach-webview` 监听不会自动继承。任何新增宿主窗口都要为其 `webContents` 注册 `did-attach-webview`，否则窗口内 Webview 的脚本注入和链接拦截完全失效；把注册逻辑提取为 `registerWebviewHandlers(webContents)` 公共函数复用。

- **自动划词与主动快捷键是两条路径**：全局鼠标手势不足以证明产生了文本选区；自动划词工具条要通过 UIA 的 `TextPattern.GetSelection` 非侵入读取外部选区，并比较按下/松开快照确认本次新选区，鼠标距离只作粗筛，不发送 Ctrl+C。UIA 不可读时安全降级不弹，不能把旧剪贴板或手势当选区。用户主动触发的快捷操作走 `shortcutManager.ts` 的复制路径，必须先读取再显示或聚焦窗口，并处理剪贴板恢复。

- **Windows UIA helper 不能复用到 macOS**：Windows 的 PowerShell UIA helper 只能在 `win32` 启动；macOS 选区读取必须经平台抽象，在 AX 原生模块不可用或辅助功能权限不足时返回明确的 unsupported 或 permission 错误，不能静默启动 PowerShell、模拟复制或伪造读取成功。常驻 PowerShell helper 的行协议使用 base64 文本、显式 UTF-8、`Console.Out.WriteLine/Flush` 输出；stdin 关闭和超时需清理或重启。

- **原生 Hook 的健康检查不能只看 `isRunning`**：原生对象仍标记运行中，不代表回调线程还在派发事件。记录最后一次 Hook 回调时间，并用 `powerMonitor.getSystemIdleTime()` 确认系统近期确有输入；系统输入活跃而 Hook 回调持续陈旧时，主动重建监听。重建失败使用有上限的退避重试，显式停止时取消待执行重试；设置开关只能在 Hook 实际启动成功后持久化为启用，失败路径回滚状态和窗口。原生 Hook 静默失活时重启 Hook/UIA 并清理手势状态，仍健康的工具条 BrowserWindow 保持运行。

- **monio-napi 回调按实际载荷形状解包**：`inputHookManager` 支持 `EventJs` 或 `EventJs[]`，批量载荷要逐个 `processEvent`；不能只根据 d.ts 把数组当对象。字段全 undefined 时先检查脱敏后的形状信息，不猜字段或 OS 原因。纯 Node 隔离诊断还要排除消息泵和测试代码自身的解包问题；未经运行时证据证实的根因不能升为有效知识。

- **不要用未经运行时验证的 `EventJs.time` 给拖选加硬时长门槛**：类型声明只能证明字段存在，不能证明不同原生后端的单位、基准和批量派发语义适合业务阈值。曾新增 `150–2000ms` 过滤后，用户重启开发服务器实测所有划词都无法进入工具条链路。已有 UIA 按下/松开选区快照能确认是否产生本次新选区时，鼠标层只保留必要的拖动距离粗筛；双击间隔继续用主进程 `Date.now()`。`startListen` 的运行时回调可能一次派发多个事件，用主进程时间做最小时长门槛会把真实拖拽误判为无效；应以实际位移和松手时的选区读取作为最终判断。

- **快捷键录制要过滤输入法暂态事件**：`Process`、`Unidentified`、`Dead` 以及 `keyCode 229` 不能作为最终主键；Ctrl+Shift 输入法切换可能产生这些事件，需等待有效物理键或功能键，避免仅按修饰键就提交。

- **主窗口拖动和最大化要按平台分支处理**：当前 Windows/Linux 标题栏由 Pointer Capture 与主进程拖动 IPC 实现，macOS 使用原生 `app-region`；不要把历史 Windows 拖动缺陷扩大成所有平台禁止 drag-region。Windows 多 WebView 主窗口拖动要合并高频 `pointermove`，按渲染帧限速，并在 `pointerup`/`pointercancel` 提交最终位置，避免 IPC 和窗口合成队列堆积。`titleBarOverlay` 的最大化按钮可能绕过 renderer IPC，直接触发原生 `maximize()` 并重建 Chromium swap chain；出现黑闪时移除 win32 overlay，由自绘按钮基于工作区 `setBounds`，同时保存还原边界。

- **含 `<webview>` 的分隔条要留足命中区域**：`<webview>` 是原生插件层，会优先接管落其矩形范围内的指针命中，DOM 的 `z-index` 和负 margin 无法保证分隔条可点中。分隔条应做宽于视觉线的命中区（如 10px 外框加 4px 视觉线，避免负 margin 叠进 webview 矩形），`onPointerDown` 后用 `setPointerCapture` 加 window 级 `pointermove/pointerup`，并配合全屏透明遮罩接管事件直到松手。

- **无边框独立窗口用 `w-screen h-screen overflow-hidden` 消除 body 背景溢出**：Electron 无边框窗口中，最外层 `w-full h-full` 在 HTML/Body/#root 未声明高度时会塌陷为内容高度，下方多余视口被 body 背景填充，表现为诊断页底部大片空白。顶层容器直接声明 `w-screen h-screen overflow-hidden`，内部面板用 `flex-1 overflow-auto` 获得滚动能力，底栏自然贴底。

- **`WebContents.findInPage` 的 `findNext` 语义与直觉相反**：Electron 底层把 `options.findNext` 映射给 `blink::mojom::FindOptions::new_session`。首次搜索或修改关键词时传 `findNext: true` 开启新查找会话，上下步进时传 `findNext: false` 延续当前会话。

- **macOS 26 的 System Events 改读 `AXFocusedUIElement`**：`focused UI element of <process>` 在 macOS 26 编译报错 `-2741`；改读进程属性 `value of attribute "AXFocusedUIElement"`（`selectionReader.ts`）。AX 和系统事件脚本跨版本易失效，升级 macOS 后要实测。

- **macOS 红绿灯和 Tray 图标有平台约束**：`trafficLightPosition` 只对 `titleBarStyle: 'hidden'` 生效，对 `hiddenInset` 不生效；坐标是 OS 点单位，红绿灯圆心约等于设定值加 6.5，无头机截屏像素坐标不等于 OS 坐标。Tray 彩色图标不能走 template，template 只保留 alpha 剪影会渲染成黑色；彩色应用图标不要调用 `setTemplateImage`，建议 `resize` 到约 22px。`Tray` 实例本身没有 `setTemplateImage` 方法，误调会崩溃，应对 `nativeImage` 调用；`assets/` 下没有 `tray-iconTemplate.png` 时回退 `logo.png`。

- **跨源 sandbox iframe 的划词右键要由主进程转发**：iframe 内的 DOM `contextmenu` 不会冒泡到宿主 renderer。主窗口 `webContents` 的 `context-menu` 事件能取得子 frame 的 `frameURL` 和 `selectionText`；仅对目标协议且存在选区的 frame 调用 `preventDefault()`，再用“屏幕光标坐标减窗口内容区坐标”定位并经 IPC 交给宿主菜单。这样不改变 iframe 的 sandbox 边界，也不影响普通 DOM 和独立 webview 的右键链路。

- **图片右键「发送到 AI」复用既有上传管线，`workbench-file://` 要专用 resolve IPC**：右键菜单通过 `WORKBENCH_SEND_IMAGE_EVENT` 把 `srcURL` 交给 AI 侧边栏，上传走既有 `FileUploadData`/`uploadFilesToCurrentModel` 管线。`workbench-file://` 的真实路径只有主进程能在授权白名单内解析（`resolveWorkbenchFileRequest`），渲染层不自行解码 URL，需 `workbench:resolve-file-url` IPC 把真实路径交还后直接按磁盘文件上传，不复制临时文件；`blob:`/`data:`/`http(s):` 则 `fetch` 取字节经 `create-temp-upload-file` 落临时目录，上传完 `cleanupUploadTemp` 清理。

- **组件级右键菜单只需 `preventDefault` 即可与全局 `CustomContextMenu` 共存，但接管前必须盘点存量菜单项**：Layout 里的全局 DOM 右键处理器先检查 `e.defaultPrevented` 退让，组件自建菜单（如图片预览画布、公式节点）不需要 `stopPropagation` 或额外标记；反过来如果忘了 `preventDefault`，自绘菜单之外还会叠加全局复制/粘贴菜单。**接管一个已走全局菜单的区域时，新建菜单会顶掉全部存量项**——`<img>` 上原本有「发送到 AI 侧边栏 / 复制图片 / 图片另存为」三件套（复制优先主进程 `copyImageAt` 保原编码，渲染层 `copyImageElementToClipboard` 兜底），曾因此造成用户可感知回归；接入前先按全局菜单的构造逻辑逐项迁移或明确裁剪。二级 hover 菜单（级联子菜单）与主菜单必须保持 DOM 嵌套（`position: fixed` 定位不影响 `contains` 命中），否则主菜单的 `mouseleave` 与外部点击关闭会在移向子菜单时误触发。

- **模态层（`z-modal`=100）内的右键不能依赖全局 `CustomContextMenu`**：全局菜单浮层是 `z-50`，即使 contextmenu 事件链正常走完，菜单也会被模态遮罩盖住而不可见，表现为“右键完全无反应”（图片 Lightbox 曾因此失效）。正确做法是在模态组件内自建接管式右键菜单，层级按 DESIGN.md 特例用 `z-[110+]` 并在注释说明；菜单 Esc 关闭要防模态 capture 阶段的快捷键监听先一步吞掉事件（Lightbox 是 Esc 先关菜单、无菜单才关查看器），切换内容（翻页/换文档）时应联动收菜单避免陈旧上下文。

- **托盘退出要经过渲染层未保存守卫时不能提前置 quitting**：主窗口关闭是本应用“隐藏到托盘”的正常路径，只有真正退出才应 `setQuitting(true)`。托盘和 `tray:quit-app` 统一调用 `app.quit()`，主进程在 `before-quit` 中先 `preventDefault()`，显示主窗口并通过 `app:quit-guard-ready` 确认渲染层已注册监听，再发送退出请求；渲染层复用编辑离开守卫后回传 allow/cancel，确认后才置 quitting 并再次 `app.quit()`。若在托盘入口提前置 quitting，用户取消后窗口关闭将不再隐藏，状态也会污染后续生命周期。

### 历史、会话与运行时

- **Webview 加载失败有三个静默漏洞**：Chromium 对连接、DNS、SSL 错误会渲染 `chrome-error://` 错误页，并正常走完 `dom-ready` 到 `did-stop-loading`，主帧 `did-fail-load` 可能不再发出；`handleDomReady` 检测到 `chrome-error://` 或 `data:text/html` 时必须 `clearLoadTimers()`、`setIsLoading(false)` 并设置 `loadError`，不能裸 `return`。`handleLoadStop` 第一行 `clearLoadTimers()` 会清掉慢速失败的 30s 兜底；如果 `loadError` 已存在或 `getURL()` 仍是 `chrome-error://` 残留态，应短路并只同步导航状态。`resume()` 重载 URL 后遇到 `-3`（TUN 或路由切换常见）时，`isFirstLoadRef.current` 若为 false 不会设置 `loadError`；应在 `setIsHibernated(false)` 后立即置 `true`。判别：连接类失败无覆盖层、慢速失败无超时兜底、唤醒失败静默。

- **恢复历史时产品模式切换会重置会话锚点**：如果恢复流程调用 `setProductMode`，必须在模式恢复完成后重新设置 `isNewSession`、`activeModels` 和 `currentConversationId`。恢复非第一条历史记录并续写时，`sendMessageToAll` 内部不能继续用 `lastItem` 或 `history[0]` 兜底，否则 `conversationId` 会锚定到最新一条历史造成串台。所有新对话、续写、历史恢复、删除历史路径都要同步更新 `currentConversationId`，发送和监测时按 ID 查找。

- **`urlMismatch` 不能在加载途中的中间导航事件触发**：`WebviewCard` 的 `checkUrlMismatch()` 原在 `dom-ready` 与 `did-navigate` 无条件调用，而 SPA 重定向链每一跳都会让 `getURL()` 偏离历史 `expectedUrl`，表现为覆盖层加载途中一闪而过。最终判定放在 `did-stop-loading`，从 `dom-ready`/`did-navigate` 移除；保留 `did-navigate-in-page` 的检测，用于首屏加载后的 SPA 路由变化。`readonlySnapshot` 的覆盖层条件与 webview `invisible` 门控共用该状态，非回溯态必须传 `null` 而不是空内容对象。

- **点击拦截注入按文档幂等，不靠多触发点空转**：`registerWebviewHandlers` 原给同一 webContents 挂 `dom-ready`、`did-finish-load`、`did-frame-finish-load` 和 3 秒 `attach-timeout`，实际只有第一次生效，其余被 `__mmClickInterceptorInjected` 挡掉，只产生空转执行和刷屏日志。主进程侧用 `documentGeneration`/`injectedGeneration` 记录状态：`dom-ready` 递增 generation 并注入，`did-finish-load` 与 `attach-timeout` 只作失败兜底；注入中收到新触发用 `pendingSource` 排队，结束后补跑。`tryInject` 先判 `webContents.getURL().startsWith('http')` 跳过 `about:blank`，仅在返回 `'injected'` 时打日志。保留 DOM 注入而不是改成主进程 `will-navigate` 白名单，是因为外链拦截必须发生在导航开始之前，`<a>` 点击的捕获监听是唯一可靠拦截点；主进程白名单还要为 13 个平台维护登录和 SSO 域名，漏一项就打断登录。

- **轮询抓取空结果不能累计稳定次数**：空字符串表示页面尚未产出、跨 frame 目标尚未出现或本次读取失败，不是“内容稳定”。只有非空且满足业务基线条件的内容才能累计稳定计数；空结果必须保持未完成并继续轮询。辩论轮询还要在发送前通过非交互采集取基线，发送后读取可能已得到本轮快速回复；只有当前内容非空、不同于基线且连续稳定才推进。暂停后继续等待已经发送的消息，不重复注入；超时保留已完成发言和当前发送状态。

- **辩论轮询要绑定 WebContents ID，空回复应中止流程**：`WebviewCard` 的 `useImperativeHandle` 会在发送状态、加载状态或其他 React 渲染后创建新 ref 对象，比较 ref 引用会把同一网页误判为已替换，导致首轮轮询提前退出。应比较 `getWebContentsId()`，每次读取使用当前 ref，同时保留模式、会话 ID 与 URL 校验。`useDebateRunner.runNextTurn` 在 `getResponseFromSlot` 返回空时不能用“（无回复）”占位后继续下一轮，否则空轮会串起来掩盖故障；检测到空回复应立即 `setDebatePhase('finished')` 并返回，不 append、不 advance。适用于一切自动轮转、依赖对方真回复的驱动场景。

- **内存优化先识别资源类型**：多个 AI SPA/WebContents 有基础内存开销，历史 80–150MB 只是观测量，不是固定预算或不可优化下限。先测 main 日志、内存历史缓存、隐藏页面和后台会话，再处理真实占用。共享 `persist:shared` 是项目约束；隐藏、休眠、卸载会影响会话连续性，不能默认清空 `mountedWebviews`。磁盘与内存历史上限必须分开维护，不能把裁剪后的内存数组直接覆写为全部磁盘记录；Chromium 内存开关需实测，不能当现成修复。

- **Electron main 进程日志泄漏具有隐蔽性**：`console.log(JSON.stringify(bigObj, null, 2))` 在流式场景会按 chunk 数量放大，每个大字符串在 main 进程 stdout 缓冲区累积，导致稳态内存上涨且不触发 GC。生产构建必须用 `is.dev` 守卫所有调试级日志，只保留错误级别和低频生命周期日志（开始、完成、耗时、字符数）。main 进程 `console-message` 处理器要显式过滤高危前缀（如嗅探器的 `NETWORK_RESPONSE:`），避免 webview 内全量响应体日志回流主进程。

- **保活、休眠与销毁是三种语义**：`display: none` 保留 WebContents 和 live 页面；`suspend/resume` 导航 `about:blank` 再恢复 URL，可释放页面层资源但丢失进行中的 live 状态；卸载 React Webview 会销毁底层 WebContents。短暂面板切换优先保活，长期释放按现有白名单休眠，明确销毁需求才卸载。休眠实现应在保存 URL 和草稿后、置 `isHibernated` 前调用 `webview.loadURL('about:blank')`，恢复时 `loadURL(targetUrl)` 并恢复草稿；`about:blank` 后 webview 仍挂在 DOM，渲染进程对象不会立即销毁，页面层卸载已能显著降内存，彻底释放需移除 `<webview>` 但会破坏 ref 稳定性和 `persist:shared` 绑定，不采用。导航或卸载不等于删除 `persist:shared` 登录态。

- **工作台 AI 侧栏的非当前平台必须纳入生命周期治理**：只把其他平台容器 `display: none` 会保留完整 SPA 的 WebContents/DOM。应按“窗口隐藏、离开工作台、右栏不是 AI、平台不是当前选择”统一延迟调用现有 `suspend()`，当前平台保持 live；恢复后只恢复当前平台，不能顺带唤醒历史平台。生命周期操作要串行排队并取消旧 timer，避免 AI 到标注再到 AI 的竞态误休眠。休眠前检查生成中的 Stop 控件、composer 附件和上传状态、本应用的注入和上传活动；平台专用 Stop selector 与通用候选都要查，无法确认页面就绪或忙碌时保守保活。独立实测中，非当前 Gemini/ChatGPT Guest 约 30–39 秒后变为 `about:blank`，当前 Gemini 保持 644 节点；`about:blank` 只释放页面层，Guest 进程底座仍在，多平台累计不应解释为零成本。

- **Webview 总结的当前入口是 SummaryPanel**：`SummaryPage` 渲染 `ModelOutputCard` 与 `SummaryPanel`；`SummaryPanel` 使用 `WebviewCard`/`useWebviewSummary` 注入提示词，长文本走 Markdown 附件，由用户手动发送。旧 API/webview 模式切换、`useSummaryPanel` 和 `generate-summary` 全局中止链路都已删除，不作为当前实现依据。修改前核对真实 ref 和调用点。

- **总结页模型卡片必须按“有回复内容”过滤**：`SummaryPage.tsx` 若直接 `displayedModels.map(...)`，会把用户当前页面没打开的模型（如 gemini/claude 等禁用模型）显示成“暂无回复内容”的空框。phantom 模型进入 `displayedModels` 的两条路径是：`getDisplayedModels` 的 `models[index % models.length]` 兜底不按 `enabled` 过滤；`MainPage.tsx` 历史恢复时 `newOrder = [...item.models, ...其他所有模型]` 把未参与模型回填进 `multiAiSlots`。渲染前应按 `(modelResponses[m.id] || '').trim()` 过滤出 `renderableModels`，与 `selectedModels` 的 `modelsWithData`、`getAllResponses` 的 `targetModels`、`MainPage.tsx` 快照兜底的 `targetModelList` 保持一致；无任何回复时回落 `displayedModels` 保留加载/空态。

- **下载监听要区分全局与单次任务**：`will-download` 属于 Session，多窗口共享同一登录 Session。全局批量下载路由应幂等注册；当前图片另存为等路径会按任务临时绑定监听，不能一律禁止。临时监听要匹配发起 WebContents 和 URL，在命中、失败、取消或超时等结束路径清理，避免误拦其他窗口下载或累积监听；实际清理覆盖要按对应代码核对。

- **will-download 的保存框与默认目录**：在 `will-download` 中调用 `item.setSavePath()` 会跳过系统保存框并直接落盘；需要保留保存框、只指定默认位置时，应调用 `item.setSaveDialogOptions({ defaultPath })`，不要设置 savePath。

- **代理/TUN 加载故障要分层诊断**：当前 main 初始化含 disable-quic 与 AutomationControlled 开关，Session 处理会清理 Electron UA 标识；这些是既有兼容配置，不能保证所有代理、站点或验证码可用，更不能把白屏一律归因于 QUIC 或自动化探针。应按加载事件、错误码、`render-process-gone` 和实际网络证据排查；导航超时和取消处理需与休眠/唤醒配合，详见 Webview 加载失败条目。

### 任务分配、辩论与 API

- **模型切换必须携带业务上下文**：复用 Webview 面板时显式区分 `productMode`、slot 与窗口来源，防止全局模型选择污染其他面板。避免用永久 ref 加载锁阻断必要生命周期更新；核对当前 Webview Hooks 与调用点。任务和辩论通过 `slot-N` 的 Webview ref 发送，优先复用共享自动化脚本；任务拆解的请求取消由 `split-task` / `abort-split-task` 及 `currentTaskSplitAbortController` 管理，当前不存在 `generate-summary` 全局中止器。

- **任务分配子任务必须携带 `slotIndex`，不能用 modelId 反查槽位**：`taskAssignmentSlots` 是按槽位顺序排列的模型 id 数组，同一个 AI 可以占多个窗口。用 `findIndex(id => st.modelId)` 反查会把所有同模型子任务命中第一个匹配槽位，叠加 `slotIndex === -1` 兜底后，一键派发会全部塞进 slot 0。`TaskSubtask` 直接存 `slotIndex`，拆解时按 `i % slotCount` 赋值，`handleSend` 按 `st.slotIndex` 聚合后从 `webviewRefs.get('slot-' + slotIndex)` 分发；SubtaskList 的 cycle 按钮在 `0..slotCount-1` 间取模切槽位，并同步更新派生 modelId。任何“slot 数组里同一值可出现多次”的语义都禁止用值反查 index。拆解数量也要告诉模型：`buildTaskSplitSystemPrompt(windowCount)` 强制输出恰好 `windowCount` 个子任务，`windowCount` 由渲染层 `getDisplayedModels(...).length` 实时算出并经 `SplitTaskParams.windowCount` 端到端透传。

- **IPC 类型的单一事实源是 preload 的 `API` 类型**：`src/preload/index.d.ts` 和 `src/renderer/src/env.d.ts` 都只声明 `api: API`，从 preload 导出的 `API` 类型派生，不维护两份方法签名。新增或修改 `window.api` 方法时，改 `src/preload/index.ts` 的实现和 `API` 类型即可；`index.d.ts`、`env.d.ts` 不应再手写一份方法列表。验证时运行两侧 tsc：
  `npx tsc --noEmit -p tsconfig.node.json --composite false --incremental false`
  `npx tsc --noEmit -p tsconfig.web.json --composite false --incremental false`
  如果 renderer 报 `Window['api']` 缺方法，先检查 `API` 类型是否正确导出，而不是继续往 `env.d.ts` 补重复声明。

- **IPC 的主窗口 getter 由注册函数注入**：`ipcHandlers` 中依赖 `getMainWindow` 的 handler 注册在 `registerIpcHandlers` 的参数作用域，沿用既有注入方式；`reqId` Map、控制器等持久状态按生命周期管理。不能因模块顶层没有该绑定就绕开当前层次结构；旧 `currentSummaryAbortController` 名称已不适用。

- **任务拆解复用供应商请求体配置**：`taskSplitApi` 通过 `buildRequestBody` 构建请求体并传 `stream: false`，保留 `top_p`、reasoning 等供应商适配，响应按一次性 JSON 解析。复用配置有维护价值，但不能据静态 body 差异断言 `Model Not Found` 的根因；排查先核对真实 model 标识、端点与错误证据，再检查供应商参数。

- **API model 使用平台标识，name 仅展示**：`useTaskSplit` 从 `summaryModels` 取 `.id`，不能传用户别名 `.name`。历史讯飞 `PathDomainError` 的已纠正原因是 model 取值错误；请求体复用是独立改进。诊断可核对脱敏后的 id/name 和调用代码，禁止输出完整配置、API Key 或请求内容。当前 Webview 总结没有 API model 请求，不沿用旧 `selectedAgent` 调用示例。

- **持久化提示词保持稳定 ID，升级以当前实现为准**：模板展示名称可修改，ID 是跨代码和磁盘的主键，不能随改名更换。当前入口为 `summaryPrompts.ts` / `summary-prompts`；旧 `agent-prompts` 在新目录不存在时迁移。bootstrap 按 ID 补缺失预设，对已存在条目比较本地 body hash 与当前 seed hash：相同才按当前 seed 重写并保留本地 id/name，不同保留正文、只补缺失 description。不能假定改 seed 后所有旧文件都会自动升级，也不能为更新模板直接删除用户目录。辩论的阶段分派与动态变量构建保留在 `debatePrompts.ts`，不强塞进扁平文件模板。

### CLI、Daemon 与登录态

- **跨窗口访问主窗口 webview 必须经主进程透传**：独立诊断窗口不持有平台 `<webview>`，它们在主窗口 renderer 的 `useAppStore.webviewRefs`。正确模式是：诊断窗口调用 `window.api.diagnosticsProbe(modelId, type)`，主进程 `ipcMain.handle('diagnostics:probe')` 用 `reqId` Map 关联，再 `mainWin.webContents.send('diagnostics:probe-request', { reqId, ... })`；主窗口收到请求后查 `webviewRefs.get(id).probeMessageContainer/probeResearchMode`，通过 `diagnosticsProbeResponse(reqId, result)` 回传，主进程按 reqId resolve。主进程必须设超时（probe 5s、run-research 15s），返回统一 `{ success, data?, error? }`。任何“A 窗口要操作 B 窗口的 webview/DOM”需求都走此透传，不要让 A 直接访问 B 的渲染进程对象。

- **Headless BrowserWindow 必须关闭后台限流**：通过 `new BrowserWindow({ show: false, ... })` 创建的隐藏 Daemon 会话窗口，Chromium 默认开启 `backgroundThrottling: true`，会把后台 tab 的 `setTimeout/setInterval` 降频到 ≤1Hz。必须在 `webPreferences` 显式设置 `backgroundThrottling: false`，否则 `AutomationService` 注入的轮询脚本会严重超时。

- **Named Pipe Server 要串行化异步请求**：Node `net.Socket` 的 `'data'` 回调在 `async` 函数中，`await handleRequest(...)` 暂停时后续数据包仍会同步触发新的 `'data'`，修改共享 `buffer` 变量，造成 lines 跳行或乱序。正确模式是在同步 `'data'` 回调中只做行分割，把完整行推入 per-socket `requestQueue: string[]`，再用 `processQueue(socket)` 串行消费，并用 `processing` flag 防止重入。

- **CLI `--json` 模式必须分离 stdout/stderr**：连接失败、解析错误等错误信息都必须走 `process.stderr.write(...)`，不能用 `console.log` 写 stdout；只有最终成功的结构化数据才输出到 stdout，外部脚本才能安全地管道解析。

- **commander `exitOverride` 必须在注册子命令之前调用**：子命令在 `command()` 创建时通过 `copyInheritedSettings` 拷贝 `_exitCallback`，后设 `program.exitOverride()` 对已注册子命令不生效，缺必填参数或未知 option 仍会默认 exit 1。契约要求参数错误为 2 时，先 `exitOverride()` 再 `registerCommands()`，在 catch 中把 `commander.*` 错误码映射为 exit 2，`commander.helpDisplayed`/`version` 映射 exit 0。

- **daemon token 文件必须放在 `getDataPath()` 下**：Windows `\\.\pipe\multichat-daemon` 是内核对象名，不是文件路径；旧代码用 `${PIPE_PATH}.token` 在 Windows 下不可写，导致 token 机制被绕过。正确做法是 `startDaemonServer(dataPath)` 时写 `<dataPath>/daemon.token`（0600），CLI 按 `%APPDATA%/<name>`、`%APPDATA%/<productName>`、`-dev` 后缀和便携版 `exeDir/data` 候选目录探测读取；鉴权检查放进 `handleRequest` 全平台统一执行，token 缺失时 fail-closed 拒绝所有请求。

- **后台任务轮询要容忍 `executeJavaScript` 瞬时失败**：页面发送消息后的整页导航或重载会让单轮 `executeJavaScript` reject，直接冒泡会把整个任务判 INTERNAL。单轮脚本失败应按“空采”计数累计，含连续上限升级为 `PAGE_NOT_READY`；`wc.isDestroyed` 或 `isCrashed` 判 `SESSION_LOST`，不因一次失败终止轮询。

- **取消 queued 任务必须直接 finalize 出队**：仅置 `cancelRequested` 和 `abort()` 对未执行任务是空操作，`pump()` 仍会提取执行，产生取消后的幽灵窗口创建与导航副作用。`cancel()` 中 `phase === 'queued'` 应 `splice` 出队并直接 `finalize('cancelled')`；`finalize` 对所有终态（含 `cancelled`）都要落盘，否则重启后 `status` 丢终态视图。

- **done 终态的单任务响应已内嵌 reply**：`task.status` 和 `task.submit --wait` 在 `phase=done` 时直接在 view 里带完整 `reply`（`respondTaskView` 内嵌），`task.list` 批量视图不内嵌。Agent 轮询到 done 即拿全文，多数场景无需再调 `task.result`。这是对齐 Google LRO/AIP-151 的异步任务模式：单任务内嵌省一次往返，批量不内嵌防爆列表体积。

- **daemon/CLI 评审易漏的真实约束**：`ensureSessionReady` 只保证窗口存在，不负责导航，已加载会话原样返回，导航须调用方显式 `loadURL`；`DaemonResponse.error` 是 `string`，稳定机器码走顶层 `code`；每请求一新 socket，`waitMs` 长轮询挂起期间必须注册 `socket.once('close')` 清理订阅，否则泄漏；`generateSendMessageScript` 的 verifySubmission 原本仅附件场景启用，agent 任务需显式开关；`generationStopSelectors` 只适配 chatgpt/claude/gemini/deepseek 四个平台，其余靠回复稳定兜底。

- **无 Electron 环境可做 CLI 与 daemon 的协议契约测试**：用 `NODE_OPTIONS=--require <shim>` 注入 `net.connect` 重定向 shim，在不启动 Electron 的情况下模拟管道。历史坑位是 commander 缺必填参数默认 exit 1 与“参数错误=2”契约不符，以及 `AgentTaskService.cancel` 对 queued 任务不落地终态。

- **`.cmd` 批处理 shim 的 `endlocal` 会吞掉子进程退出码**：`setlocal`/`endlocal` 配对中，`endlocal` 会把 `ERRORLEVEL` 恢复到 `setlocal` 前的值；shim 末行裸写 `endlocal` 会导致 CLI 永远 exit 0。正确写法是 `endlocal & exit /b %ERRORLEVEL%`，`%ERRORLEVEL%` 在行解析时展开，先于 `endlocal` 执行取到真实码。下游脚本在修复铺量前必须按 JSON `success`/`code` 判错，不能只信退出码。

- **PowerShell 任务脚本有两个坑**：函数 `return @($x)` 的单元素数组在赋值给变量时会被 PowerShell 解包成标量，`$v[0]` 取到字符串首字符；调用处必须用 `$v = @(Func)` 强制数组。包装脚本里显式 `-Query`/`-QueryFile` 参数必须先于 stdin 读取判定；宿主 shell 把 stdin 挂成不关闭的管道时，`[Console]::In.ReadToEnd()` 会永久阻塞。

- **`submit --wait` 的防丢 taskId 两段化放在客户端**：CLI 先发无 `waitMs` 的 `task.submit` 立即拿 taskId，把 ack JSON 写到 stderr，再发 `task.status waitMs` 长轮询；daemon 协议和 stdout 契约零改动，新旧 CLI/daemon 任意交叉兼容。若改 daemon 在 submit 上先回一行 ack 再挂起，旧 client 会把 ack 当最终响应提前退出。`readStdinIfPiped` 只在未给 `--query`/`--query-file` 时读 stdin，根治宿主开放管道挂死；`--idempotency-key` 在同 sessionKey 的内存任务表去重，终态也命中，跨重启不落盘。

- **未登录检测不能靠输入框或登录入口提前判墙**：ChatGPT、Qwen、ChatGLM 未登录页的 composer 照常渲染，`generateMindmapPageStateScript` 的 `ready` 仍为 true；Gemini、豆包、文心游客可用却常驻“登录”按钮，提前按 CTA 判墙会把可用平台误杀。可靠判据只有两类：Cloudflare challenge 容器、`input[type=password]` 或 `tel` 等强信号连续 2 次命中即 `AUTH_REQUIRED`；发送脚本返回失败后再探测登录入口归因，命中才升级为 `AUTH_REQUIRED`，否则维持 `SEND_FAILED`。`isAuthWallUrl` 的正则必须容忍 `sign_in`、`log-in` 这类分隔写法，DeepSeek 未登录会落 `/sign_in`。

- **游客与已登录只能靠凭证区分，且“有同名 cookie”不等于已登录**：游客态同样持有大量 cookie（Qwen 游客的 `cna`/`tfstk`/`isg`，DeepSeek 游客已有 `ds_session_id`，Grok 游客的 `__Host-id-token-nonce` 会被 `token` 正则命中）；部分平台游客态还会写同名账号 cookie，ChatGLM 游客写 `chatglm_token`（JWT 内 `is_guest:true`），元宝游客写 `hy_user`（值形如 `a_did_...`）。判定顺序是：先按 `platformAuthCookies` 精确匹配名字，名字命中后再按 `platformAuthCookieRules` 看值否决游客；cookie 未命中时读 localStorage，仍无结论才返回未知。不能因为 cookie 未命中就直接 `signedIn:false`。已实测可纯靠名字判定的名单：ChatGPT `__Secure-next-auth.session-token`（`.0/.1` 分片）、Gemini `SID`/`SAPISID`、豆包 `sessionid`/`sid_tt`/`sid_guard`、Grok `sso`/`sso-rw`、Qwen `tongyi_sso_ticket`、文心 `BDUSS`（须限定 `.baidu.com` 域）、Arena `arena-auth-prod-v1`（实际名为 `.0/.1` 分片）。名单必须靠登录态与游客态双向取样验证。

- **登录凭证不只在 cookie 里，localStorage 也要剥壳**：DeepSeek 已登录时 `chat.deepseek.com` 的 localStorage 有 `userToken`，cookie 只有设备标识；Kimi 的 cookie 全是 `acw_tc`/`theme`/`Hm_lvt_*`，凭证是 localStorage 的 `refresh_token`（JWT）。localStorage 判定要解析 JSON 看 `value` 是否为空：DeepSeek 游客态的 `userToken` 值是 `{"value":null,"__version":"0"}`，非空字符串按“非空即登录”会把游客判成已登录。

- **应用运行期间 Cookie 库被独占锁，离线读盘拿不到真实数据**：`Partitions/shared/Network/Cookies` 被 network service 进程以独占方式持有，`FileShare.ReadWrite` 和 `Copy-Item` 全部失败。用 `NtQuerySystemInformation(SystemExtendedHandleInformation)` 加 `DuplicateHandle` 复制句柄可只读取出完整快照（327 条，对比复制文件的 35 条），但这只适合取证；登录态判定必须走应用进程内的 `session.fromPartition('persist:shared')`。

- **Qwen 的自动化站与登录站必须同源**：`chat.qwen.ai`（Qwen Chat 国际版）和 `www.qianwen.com`（千问国内站，models 配置和用户登录所在）是不同站点，登录态和 DOM 都不通用。历史 `newConversationUrl` 指向 `chat.qwen.ai`，但选择器（`#qianwen-layout-right-panel`、`#qk-markdown-react`、`.tongyi-markdown`）和 `tongyi_sso_ticket` 都属于 `qianwen.com`，导致“用户已登录却报未登录”。现两者统一到 `www.qianwen.com/`，但 researchMode 两个站点的入口并存：`chat.qwen.ai` 是 `div.mode-select-open[role=button]` 加 `menuitem`“深入研究”，`qianwen.com` 是 `button[aria-label="研究"]` 的 `aria-pressed` 开关。域名迁移的落点不止选择器：`AutomationService.PLATFORM_DEFAULT_URLS`、渲染层 `defaultModels` 的初始 `url`、`webviewManager` 按 hostname 取平台名的映射三处都要同步；映射需保留旧 hostname，否则历史笔记会显示裸域名。

- **主进程读选择器也要做版本校验**：渲染层 `getSelectors` 只接受 `stored.version >= defaultSelectors.version`，但 `AutomationService.getPlatformSelectors` 曾无条件采用 store 里的 `selectors.models[platformId]`。用户保存过旧版选择器后，后台自动化会长期沿用废弃字段，改 `selectors.ts` 对 CLI 完全不生效。主进程也要按版本比较，低于默认版本整体回退默认配置。具体版本号只是当时证据，不要写死成规则。

- **`aria-pressed` 开关类入口必须加幂等守卫**：`qianwen.com` 的“研究”按钮点一次取反，`generateEnableDeepResearchScript`/`generateDisableDeepResearchScript` 若被重复执行（重试、追问复用会话）会把状态翻回去。做法是在 `AutomationStep` 上加 `skipIfPressed`/`skipIfReleased`，`buildDeepResearchHelperFunctions` 里 `alreadyInState(step, el)` 命中即跳过点击并计入成功。实测连开两次仍为 `aria-pressed=true`，连关两次仍为 `false`。

### Git 与开发工作流

- **永不使用 PowerShell 管道重写数据文件**：`Get-Content | -replace | Set-Content` 这条链有三个叠加的坑——`-replace` 塌缩换行、`Set-Content` 引入 BOM/CRLF、`Get-Content -TotalCount N` 或任何只读头部的用法都会把文件静默截断。SESSION_LOG.md 曾因此被截断到 100 行，靠 git blob 拼接才无损恢复。小范围行级编辑一律用 apply_patch（含 SESSION_LOG/KNOWLEDGE 这类记忆文件），shell 只用于读取和搜索。

- **文件改名用 `update-index` 写路径变化，不用 `git mv`**：Git 不存储重命名，普通 `fs.rename` 后执行 `git add -A` 同样会被识别为 rename；根因是路径变化没有进暂存区。文件改名后先用 `git ls-files -s -z --full-name` 取原 blob，再用一次 `git update-index -z --index-info` 同时写入“删除旧路径 + 原 blob 写入新路径”，只记录路径变化，不会把内容改动一并暂存。路径基准不统一：`ls-files` 与 `update-index` 需要仓库根相对路径，`status --porcelain=v1 -z` 也输出根相对路径，而 `status --porcelain=v2` 输出工作区相对路径，因此要先 `rev-parse --show-prefix` 补前缀。仅大小写改名在 Windows 上也可直接用同一套 `update-index`。变基或合并进行中（`.git/rebase-merge`、`rebase-apply`、`MERGE_HEAD` 存在）要跳过写索引，否则破坏可恢复性。

- **目录移动必须逐文件映射，索引查询按仓库根执行**：只对“被移动的目录路径”执行 `update-index` 不会命中目录内文件，Git 仍显示删除加新增。读取旧目录前缀下的全部索引条目，按“新前缀 + 旧路径剩余部分”逐个写入删除旧路径和原 blob 到新路径；目标前缀已有索引条目时跳过，避免覆盖未提交的同名文件。查询统一在 `repoRoot` 下执行并加 `--literal-pathspecs`：在子目录 cwd 下 `ls-files` 会把 pathspec 当成工作区相对路径，`[draft].md` 这类文件名还会被当通配符而漏匹配；literal 目录 pathspec 即使目录已从磁盘移走仍能命中索引。

- **Git 同步状态必须先 fetch 再判断 ahead/behind**：`git status --porcelain=v2 --branch` 的 `branch.ab` 比较的是本地缓存的 `refs/remotes/*`，远程有新提交但未 fetch 时会显示 `+0 -0`，导致拉取被误判为“已是最新”。顺序应是先做干净/分叉等本地前置检查，再 `git fetch --prune`，重新读状态后决定快进、显式合并或拒绝。拉取用 `pull --ff-only`，分叉交给显式的 `merge --no-edit`；合并冲突后立刻 `merge --abort` 回到操作前，比 `pull --rebase --autostash` 更可控。`execFile` 不支持 `input` 选项，需要写 stdin（如 `update-index --index-info`）必须用 `spawn` 并显式 `stdin.end()`。

- **提交图的远程状态用一次 `rev-list` 差集计算**：判断显示中的提交是否已进入任一远程跟踪分支，执行 `git rev-list --all --not --remotes --topo-order -n <limit>` 得到本地独有提交集合，再与 `git log --all --topo-order` 的结果比对即可；不要为每个节点执行 `branch -r --contains`。两次命令使用同一显示上限和拓扑顺序，避免为不可见提交付出遍历成本。`refs/remotes/*` 仍是本地缓存，历史读取保持只读、不自动 fetch；未 fetch 时状态可能滞后。

- **首次推送不要依赖 `push.default`**：无上游分支时直接 `git push` 在 `simple`/`current`/`upstream` 配置下行为不同，可能报错或推到意外分支。界面确认后统一用 `push -u origin HEAD` 建立跟踪关系；未确认时返回 `no-upstream`，不执行推送。

- **未跟踪大文件只提示、不自动处理**：用 `git status --porcelain=v2 -z --untracked-files=all` 后独立收集未跟踪路径并 `stat`，超过 50 MB 的记录到 `largeUntracked`；不要复用被 500 项上限截断的展示列表，否则大文件会漏报。主进程提交接口需用 `allowLargeFiles` 做兜底拒绝，避免只靠界面确认被绕过。未跟踪文件不阻止拉取（与远程同名时 Git 会拒绝），只有已跟踪改动阻止同步；`blockingChangeCount` 要独立计数，不能从截断列表推导。忽略必须由用户在设置里选择，不自动写 `.gitignore`、不自动 `git add`；GitHub 50 MiB 警告、100 MiB 拒绝，GitLab 与 Azure DevOps 限制不同，应用侧不自动启用 LFS。

- **`.gitignore` 可视化编辑按行差异写回**：不要整体重排后覆写，否则会丢失用户注释、空行与取反规则的位置。只删除目标列表中不存在的规则行，在末尾追加缺失规则；同一模式重复出现时按次数保留。保存前比较打开时的磁盘快照，若已被其他程序修改则提示确认，避免静默覆盖。

- **带凭据的远程地址不能脱敏后回填输入框**：`git remote get-url` 可能返回 `https://user:token@host/repo.git`。界面只展示脱敏值，但若把脱敏值填回输入框，用户直接保存就会把 `***` 写进 `.git/config`。应返回 `redacted` 标记，含凭据时不回填，要求重新输入；保存走 `remote set-url` 保留 refspec，凭据交给系统 Git 凭据管理器。

- **`git status` 会刷新并写回 `.git/index`，会与递归 watcher 形成自激循环**：工作区监听若不过滤 `.git`，每次状态刷新都会触发新的文件事件，表现为刷新图标持续闪烁。watcher 要忽略 `.git` 下的事件；读取状态时加 `--no-optional-locks`，让 `status` 只读、不改索引。后台刷新不要切换 loading，只有用户手动刷新才显示旋转。

- **Git 写操作队列清理要比较存储值**：`serialize` 中若把 `next.catch(() => undefined)` 存进 Map，清理时却比较原始 `next`，队列永远不会删除，同一工作区的所有后续操作都会排在一个已结束的 Promise 后面。应保存 `stored` 并在 `finally` 中比较 `stored`。

- **文件树隐藏规则以 Git 真实忽略结果为准**：`git ls-files --others --ignored --exclude-standard --directory -z -- .` 在任意工作区子目录执行都会返回相对该目录的 POSIX 路径，整目录被忽略时折叠为 `dir/`，目录内有已跟踪文件时返回其中被忽略的具体文件。因此既能显示未被忽略的 `.agents`/`.claude`/`.memory`，又不会因“名字以点开头”吞掉用户目录。非 Git 工作区该命令失败时退回内置名单。`.git`、`.multichat`、`.trash`、Git 元文件、`node_modules`、虚拟环境、`__pycache__` 仍需无条件隐藏；前两类属于配置而非工作区内容，后者未必被 `.gitignore` 覆盖。外部导入拿不到源的忽略结果，只能按名字拦截同一批目录。文件树、标签扫描和全文搜索必须复用同一个过滤函数。

- **worktree 工作要先核对实际基线**：历史 Claude `EnterWorktree` 默认从远端默认分支创建，与本地未推送代码可能不同；具体工具默认值可能随版本变化。必须核对实际 ref、未提交改动及计划锚点；不要自动 stash/rebase/reset。创建或切换分支仍遵循 AGENTS 的明确授权要求，不能把历史操作命令当默认工作流。被其他 worktree 检出的分支不能强移指针；合并、切分支、处理未提交工作需有用户授权，不能自动 force、stash 或任选更长文档覆盖冲突。

- **新 checkout 的 Electron 安装缺失要先核对文件和安装输出**：旧 worktree 曾在 `npm install` 后缺少 `node_modules/electron/path.txt/dist`，开发启动失败。先核对安装输出和实际文件，不宣称每个 worktree 必然需要手动下载；只有确认 Electron 安装阶段缺失时才按现有依赖的 `install.js` 修复。此处不是创建 worktree 的授权。

- **执行旧计划前重新核对代码锚点**：行号、Find/Replace 块和函数签名可能随代码演进漂移。修改前用 `rg` 和文件读取核对实际入口；在原授权范围内调整实施细节，只有目标、范围或风险发生实质变化时才重新确认。不能盲套旧计划，也不为每次锚点漂移增设计划文件。

- **暂停后被恢复的任务必须以新 git 事实为准**：并行协作期间其他 worker 或用户会持续提交，恢复时旧基线统计、旧文件内容、旧工作区假设全部失效。先重新 `git status`/`git diff` 核对他人未提交改动（这些文件只允许最小范围叠加自己的职责内修改，绝不能回退），重新读取当前文件内容再动手，不沿用暂停前的任何内容记忆。

- **杀 dev 进程要杀 Electron 主进程而不是 npm 壳**：`kill_shell` 或 Ctrl+C 只终止 `npm run dev` 的 node 包装进程，`electron.exe` 主进程会变孤儿继续持有 Named Pipe 和端口，导致“新实例”实际仍是旧代码在响应。Windows 下用 `taskkill //PID <electron主进程PID> //T` 杀整棵树；在 git-bash 里，`node -e` 内联串和 heredoc 中的 `\\.\pipe\` 反斜杠会被 MSYS 二次坍缩，写管道测试应落盘为 `.mjs` 文件或用 `String.fromCharCode(92)` 构造路径。

- **`session_log.py` 在 GBK 控制台打印 Unicode 会崩**：Windows GBK 终端无法编码 lesson 候选中的 `↔` 或 emoji，`main()` 打印 candidates 时抛 `UnicodeEncodeError`，日志本身已写入，崩在提示阶段。修复是在 `main()` 开头执行 `sys.stdout.reconfigure(encoding="utf-8", errors="replace")`。

- **落地页和宣传文案不是代码事实**：产品页里的数字、角色名、预设数量可能滞后于真实实现。改 README、方案文档或宣传页前，先 `ls`/`rg --files` 以实际预设目录和代码定义为准，不能照抄营销描述。

- **apply_patch 的上下文行必须整行精确匹配**：patch 语法按整行处理，截取行内片段做替换（如只匹配 `docs/` 条目后半段）必然找不到预期行，报错信息不会提示这是截断问题。含全角标点、弯引号、CRLF 的长中文行，先用字节级读取（`[System.IO.File]::ReadAllBytes` + UTF8 解码）确认原文再整行粘贴；不要凭 PowerShell 控制台输出逐字手打，控制台可能吞字符或改引号。

### 构建、打包与验证

- **Node `execFile`/`execFileSync` 在 Windows 无法直接 spawn `.cmd`/`.bat`（EINVAL）**：CVE-2024-27980 安全修复后，spawn 批处理文件不经 `cmd.exe` 中介会被直接拒绝；打包期脚本里跑 `npm install` 必须 `execSync(cmdString, { shell: true })`（参数全为字面量时无注入面）或显式 `cmd.exe /c`。这不影响 PowerShell 侧直接调用 `npm`——PowerShell 会自己解析 `npm.cmd`。

- **TypeScript 模板字符串内的行内代码反引号必须转义，esbuild 不报错但运行时静默产出 NaN**：`systemPromptTrim.ts` 曾在模板字面量里写裸 `` `.tmp/` ``，模板提前闭合后整段变成 `string.tmp / string.tmp / string` 除法链——语法合法、esbuild 静默通过、运行时 `MIAO_PREAMBLE` 求值为 `NaN`（`string.tmp` 是 `undefined`，`undefined/undefined` 为 `NaN`），只有 tsc 的类型检查（"Property 'tmp' does not exist on type string"）能暴露。构建链不跑 tsc 的项目这类 bug 会直进生产且表象离奇（替换注入的是字面量 "NaN"），这是"build 不等于类型检查"教训的实证强化版；在模板字面量正文里引用 Markdown 行内代码时统一写 `\`...\``。

- **Electron CommonJS 主进程与纯 ESM 依赖的兼容**：在 `electron.vite.config.ts` 中开启 `build.externalizeDeps: true` 时，Vite 会将 `import ... from 'esm-pkg'` 转换为 CommonJS 的 `require('esm-pkg')`。若外部依赖（如 `@earendil-works/pi-coding-agent`）为纯 ESM 且 `package.json` 的 `exports` 仅定义了 `import` 而无 `require`/`default`，会导致 Node CJS 加载器抛出 `ERR_PACKAGE_PATH_NOT_EXPORTED`。解决方法：主进程中仅保留该包的 `import type` 静态类型导入，并在异步生命周期（如 `init()`）中使用 `new Function('s', 'return import(s)')('esm-pkg')` 动态加载运行时符号，既规避 Vite 编译期的 require 改写，又保证在 Node/Electron 运行时正确通过 ESM 解析器加载。

- **pnpm 接管 npm 安装的 `node_modules` 前必须关闭运行中的 Electron 实例**：`pnpm install` 会把旧包迁移到 `node_modules/.ignored`；若本 worktree 的 `node_modules/electron/dist/electron.exe` 仍被 dev 进程占用，重命名会报 `EPERM`。先按命令行中的 worktree 路径找到并关闭对应的 `npm run dev`/Electron 进程，再执行 `pnpm install`，安装后确认 `install-electron` 已下载二进制再重新启动。

- **启用 JavaScript 混淆时不要用函数 `toString()` 生成 Webview 注入脚本**：生产打包开启混淆后，通过 `Function.prototype.toString()` 生成注入脚本，函数体内部变量可能被主进程混淆器重命名，并依赖混淆器注入的主进程全局映射，进入隔离 Webview 后执行报错。注入脚本应直接使用自包含的字符串模板或 IIFE 源码字符串，避免在主进程代码中使用函数 toString 注入。

- **`@electron-toolkit/utils` 的 `is.dev` 不能在 renderer/shared 中使用**：`is` 对象依赖 `__dirname`、`child_process.spawnSync`、`path.join` 等 Node API；`shared/` 文件被 Vite 依赖预构建加载到浏览器环境时，会触发 `__dirname is not defined` 和 `child_process has been externalized`，导致开发服务器黑屏。任何可能被渲染进程引用的代码（`shared/`、`renderer/`）都应使用 `process.env.NODE_ENV !== 'production'`；`src/main/` 下的纯主进程文件使用 `is.dev` 是安全的，但为一致性也可统一使用 `process.env.NODE_ENV`。判别：错误堆栈指向 `node_modules/.vite/deps/@electron-toolkit_utils.js` 且含 `__dirname`/`child_process`。

- **开发组件的构建裁剪要检查引用图**：renderer 用 `import.meta.env.DEV` 控制动态 import 和路由/监听入口；只隐藏按钮不能证明静态导入和依赖已从包中移除。是否剔除以构建后产物搜索为准，不笼统断言只有动态 import 才可能 tree-shake。

- **开发 IPC 要显式限制运行时入口**：主进程 `handle/on` 注册有副作用，不能仅由 renderer 隐藏入口推断生产功能不可访问。沿用 main 的开发态守卫，并核对注册条件；若要控制构建体积，检查实际 bundle，不把“永远无法静态剔除”当普遍结论。main 可用工具库 `is.dev`，renderer/shared 不导入 Node 工具库。

- **build 不等于类型检查或桌面验收**：electron-vite build 不执行 tsc。按 AGENTS 分别检查 `tsconfig.node.json` 与 `tsconfig.web.json`，根配置只有 references，单独 `npx tsc --noEmit` 不能代表两侧检查。验证时实时运行：
  `npx tsc --noEmit -p tsconfig.node.json --composite false --incremental false`

- **CDP 自动化驱动 Lexical 编辑器输入的正确姿势**：`Input.insertText` 整串输入不触发 @lexical/markdown 快捷键转换（其按单字符 trigger 判定），必须逐字符发送；`document.execCommand('insertText')` 在页面 Runtime.evaluate 内可用且走真实 beforeinput 管道，但 `'\n'` 不会换行而是直接拼接文本（换行需 insertParagraph）。打开文件用 store 直调——vite dev 下页面内 `await import('/src/store/workbenchStore.ts')` 拿得到 useWorkbenchStore，比文件树 DOM 点击可靠（折叠态节点不在 DOM 中）。**向 contenteditable 输入前必须守卫 activeFilePath 是测试文件**，否则会污染用户真实文档（已发生过一次：测试文本被 autosave 写进论文文件，靠 git diff 精确切除恢复）。
  `npx tsc --noEmit -p tsconfig.web.json --composite false --incremental false`
  不要记录一次性错误数量作为长期基线；当前 `tsconfig.web.json` 已设置 `target: ES2020`，两侧均以实际输出为准。已有类型错误与当前改动的错误要明确区分，UI、站点 DOM 与 main 行为需在重启后的 dev 中实际触发。

- **vite dev 下页面内裸 import() 拿到的是幻影模块副本而非应用真实 store 实例**（HMR 带 ?t= 参数会进一步分裂实例），CDP 行为验证必须经应用真实加载路径暴露的同一实例：已在 workbenchStore.ts 末尾加 import.meta.env.DEV 守卫的 window.__workbenchStore 调试钩子（生产 tree-shake 剔除）。openFile 等在 initWorkbench 完成前调用会静默 return，测试脚本必须轮询 isInitialized+workspacePath 再操作。
- **跨窗口跳转工作台文档时不能只看 isInitialized 标志**：initWorkbench 把 isInitialized 连同偏好快照一起提前 set，随后才异步执行 setWorkspaceFolder/恢复标签页。此时调用方若直接切换工作区或 openFile，恢复流程完成后会把目标状态覆盖掉；必须先 `await initWorkbench()`（模块级单例守卫，重复调用是同一 Promise 语义）再操作工作区。openFile 本身读盘不依赖文件树，文件树陈旧不影响打开。
- **dev server 端到端验收可走 remote-debugging-port=9223 CDP**：`pnpm run dev` 的 Electron 主进程对 renderer 暴露 `--remote-debugging-port=9223`。Node ≥22 用原生 `WebSocket` 连 `http://127.0.0.1:9223/json/list` 里 `type=page && url==='http://127.0.0.1:5300/'` 的目标，`Runtime.evaluate` 里 `await import('/src/store/workbenchStore.ts')`（Vite 模块路径）即可拿到真实 Zustand store 实例，直接驱动 `openFile`/`saveActiveFile`/`refreshGitStatus`/`searchFiles`/`handleExternalFsChanged` 等动作做行为级验收，无需 UI 自动化。注意 `WorkbenchFileNode` 字段是 `path`/`isDirectory`（非 `relativePath`/`type`）；改动的真实文件务必读后写回恢复原内容。IPC 也可走 `window.api.workbench.*`。

- **Electron 系 IDE 终端的 `ELECTRON_RUN_AS_NODE=1` 必须清除**：Devin/VSCode 等 Electron 应用的集成终端会向子进程继承该变量，`npm run dev` 启动的 electron 退化为纯 Node，`require('electron').app` 为 undefined，main bundle 顶层 `app.isPackaged` 处即崩。bash 用 `env -u ELECTRON_RUN_AS_NODE npm run dev`，PowerShell 先 `Remove-Item Env:ELECTRON_RUN_AS_NODE` 再启动；该变量不是用户/系统环境变量，普通终端不受影响。

- **NSIS 安装后启动要区分权限与路径**：历史安装后启动曾出现约一分钟卡顿，排查涉及 elevated 安装进程通过 ExecShellAsUser、快捷方式落盘及 Shell/DCOM 降权路径。现有 installer.nsh 按账户类型选择启动方式，提权分支使用可执行文件路径而非快捷方式，普通分支避免不必要的降权调用。不能只凭时长认定具体 COM 根因；修改安装脚本要按实际权限场景打包验收。

- **electron-builder `nsis.include` 会注入到生成脚本头部，自定义代码要自带依赖**：`build/installer.nsh` 被 `scriptGenerator.include` 插到 makensis 脚本最前，先于 installer.nsi 的 common.nsh/MUI2/UAC 和 LogicLib。顶层 `Function` 体在定义点立即解析，用到的宏必须在本文件自行 `!include`：`nsDialogs.nsh` 会连带引入 `LogicLib.nsh` 和 `WinMessages.nsh`（含 `HWND_BROADCAST`/`WM_SETTINGCHANGE`/`BST_CHECKED`），而 `!macro` 体延迟到插入点展开，可以依赖后文。可用钩子：`customInit`（.onInit 内设默认值，覆盖静默安装）、`customPageAfterChangeDir`（目录页后插 `Page custom`，MUI_HEADER_TEXT 不可用，需用 `GetDlgItem 1037/1038` + `WM_SETTEXT` 改页头）、`customInstall`、`customUnInstall`。写用户 PATH 用 `WriteRegExpandStr HKCU Environment Path` 保住 `REG_EXPAND_SZ` 并广播 `WM_SETTINGCHANGE`；移除时分号分段精确匹配 `$INSTDIR\cli`，避免前缀误伤。

- **NSIS 环境变量广播会按每个挂起窗口累计阻塞**：`SendMessage ${HWND_BROADCAST} ${WM_SETTINGCHANGE} ... /TIMEOUT=5000` 等价于 `SendMessageTimeoutW` 加 `SMTO_NORMAL`，超时按每个无响应顶层窗口分别累计，27 个挂起窗口乘 5 秒可能卡死两分钟以上。修复是用 `System::Call` 直调 `SendMessageTimeoutW(..., SMTO_ABORTIFHUNG(0x0002), 1000, ...)`，挂起窗口立即跳过，典型小于 100ms；`installer.nsh` 的 `McBroadcastEnvChange` 宏在装/卸两处共用，宏定义放在 `!ifndef BUILD_UNINSTALLER` 之外。要彻底零阻塞可换 `SendNotifyMessage` 异步投递，注册表先于广播写好，PATH 场景没有送达时序依赖。

- **electron-builder NSIS 卸载键不写 `InstallLocation`**：1.3.1 实测 `HKLM\...\Uninstall\<appId>` 只有 `DisplayIcon`（`<dir>\MultiChat.exe,0`）和 `UninstallString`（`"<dir>\Uninstall MultiChat.exe" /allusers`）。Agent 或脚本要定位安装目录（如找 `cli\multichat.cmd`）须反推：从 `DisplayIcon` 截掉 `,` 后缀取 dirname，或从 `UninstallString` 取首个引号路径 dirname；HKCU/HKLM/WOW6432Node 三视图都查一遍。`installer.nsh` 的 `customInstall` 可补写 `WriteRegStr SHELL_CONTEXT "${UNINSTALL_REGISTRY_KEY}" "InstallLocation" "$INSTDIR"`，卸载键名为 `UUID.v5(appId)`，`UNINSTALL_REGISTRY_KEY`/`SHELL_CONTEXT` 随 per-user/allusers 自动选 HKCU/HKLM。

- **electron-builder `extends` 对数组字段是覆盖语义而非合并**：`electron-builder-portable.yml` 重定义 `extraResources` 时父配置条目全部丢失，曾静默丢掉 `skill/multichat-cli` 资源目录。派生配置重定义数组字段（`extraResources`/`files`/`extraFiles` 等）必须重复声明父配置全部所需条目。

- **`extraResources` 按文件系统取文件，未提交进 git 的文件照样进安装包**：`run_task.ps1` 曾长期是未跟踪文件，本地打包一直带上它，但干净克隆或 CI 会静默缺文件。迁移或新增随包资源时顺手核对 `git status` 的 `??` 条目，确认该跟踪的都 `git add`。

- **macOS Dock 图标显大通常是图稿没有留边距**：Apple 图标规范图稿约占画布 82% 并配透明边距，不是尺寸问题。`sips` 没有合成能力，可用 Swift/AppKit `NSImage` 生成带透明边距的 PNG（`build/generate-mac-assets.sh`、`assets/dock-icon.png`），dev Dock 图标与打包 icns 共用该图。

- **Windows 签名工具解压与符号链接权限是历史版本经验**：历史 winCodeSign 包含 macOS 符号链接，Windows 7za 解压曾因权限不足失败；当时通过开发者模式或适当权限并在清缓存后重打验证。诊断先核对当前工具版本、实际 `ERROR: Cannot create symbolic link` 和系统权限，不把旧版本号或“必复现”当通用事实，也不擅自改系统设置。不要用 `.cmd` 包装 7za 吞错误码；缓存存在会掩盖解压失败，验证修复要区分缓存命中和新下载路径。

- **注入式运行时可用 headless Edge + CDP 做行为级验收**：msedge --headless=new --remote-debugging-port=N --user-data-dir=临时目录 加载嵌入了运行时的 fixture.html，Node >=22 原生 WebSocket 连 /json/list 目标，Runtime.evaluate 驱动 DOM、Input.dispatchKeyEvent 模拟 Ctrl+Z/Y、Input.dispatchMouseEvent 模拟点击选中；沙箱内 localhost WebSocket 被拒需提权运行。注意 console.log 后 process.exit() 会截断 stdout，改赋 process.exitCode 自然退出。

- **Edge headless 截图在沙箱内因 GPU 进程拦截失败，需提权运行**：`msedge --headless=new --screenshot` 配合 `--window-size` 的超大高度可一次性截整页长图，再用 `System.Drawing` 按区域裁剪分块检查细节；截图失败先区分是沙箱拦截还是页面问题，不要直接判定布局缺陷。

- **完整构建失败先区分责任边界：脏工作区语法错误 vs 本次改动**：`pnpm run build` 可能被工作区既有的未提交语法错误（其他任务的半成品文件）阻断，报错文件与本次改动无关时不要顺手修，用定向 `tsc --noEmit`（node/web 两侧）确认本次改动自身的类型责任即可。

- **CDP `Runtime.evaluate` 中 Windows 路径注入陷阱**：把 `D:\Project\tmp\x.png` 这类路径直接拼进 evaluate 的 JS 表达式文本时，反斜杠会被浏览器 JS 解析器当转义符吞掉（`\t` 变制表符、`\.` 变 `.`），被测代码拿到的是已损坏的串，表现为提取/匹配逻辑"没生效"的假阴性。必须用 `JSON.stringify` 注入路径字符串（外层模板插值也安全），或统一使用正斜杠路径。验证用例出意外结果时先核对输入是否完好到达被测代码。

- **批量注释精简不能按注释行号机械删除**：TypeScript interface/type 的字段注释常位于字段上一行，按“注释行”删除时若不核对下一行是字段声明，会把 `name`/`fileName`/`documentName` 这类可执行类型字段一并删掉；web 类型检查会立刻暴露，但根因不是类型问题而是文本编辑越界。先 token/AST 或逐 hunk 人工确认删除行只包含注释。

- **空 catch 里的说明注释是 lint 语义的一部分**：`eslint:recommended` 的 `no-empty` 会把有注释的空块视为非空；清理时如果把 `catch { // JSON 解析失败时忽略 }` 中的注释删掉，原本合法的有意忽略会变成 error。保留一句短“有意忽略/兜底原因”注释即可，不要为满足空块规则改逻辑或吞掉语义。

- **含注入脚本的 template literal 不能只做文本 diff 验收**：`webviewScripts.ts`/`htmlToMarkdown.ts` 这类字符串模板里的 `//`、`/* */` 不是宿主 TS 注释，但仍是运行时脚本注释；直接逐行 diff 会把注释删除误判成字符串内容改动。验收应先做排除 TS 注释的 token 序列对比，再对 template token 的嵌入 JS 做注释/空白归一化后比对，差异必须归因到纯注释或明确并行功能改动。

 - **真实窗口 CDP 验收的完整链路**：未打包态 main/index.ts 自动暴露 remote-debugging-port 9223（MULTICHAT_DEBUG_PORT 可覆盖），electron 二进制直跑（node_modules/electron/dist/electron.exe <appPath>）即加载 out/ 生产构建渲染层；--user-data-dir 可隔离验收 profile，预置 config.json 的 workbench_lastWorkspacePath 直接免 UI 进入目标工作区（store 名按 is.dev 分 config/config-dev）；__workbenchStore 仅 import.meta.env.DEV 暴露且会被 tree-shake，生产构建不可用——验收驱动工作区要靠预置 config 或 UI 路径。同一 dev/prod 构建混合会导致 main 卡死 CDP 监听但 /json 无响应，先杀干净 electron 进程再启动。
   - 端口生效细节：端口由应用自身 appendSwitch 控制，**CLI 传 --remote-debugging-port 无效**，必须用 MULTICHAT_DEBUG_PORT 环境变量；9223 常被用户自己的 dev 实例占用，隔离实例要用别的端口。
   - **僵尸实例持单例锁时新实例静默退出不报错**：launch 后 CDP 连不上先按命令行（live-profile 等特征）杀干净既有 electron 进程再启动，杀漏一个主进程就会一直无窗口无端口。
   - **连接后先核对目标实例身份**：枚举文件树节点内容确认是隔离工作区再操作（用户的 dev 实例同样开着 CDP，连错会往真实数据里发输入）；页面选择排除 #toolbar/#quick 锚点小窗页，取无锚点的 index.html 主页面。

### 历史架构与版本限定

仅在追溯旧架构、旧版本或用户授权的隔离开发时读取。本项目当前使用 Electron 42 与 Webview；本节不授权迁移架构、修改分支或照搬旧兼容补丁。

- **通义千问点击即黑屏/渲染进程崩溃是 Chromium 120 的 ScriptProcessorNode use-after-free**：Electron 28（Chromium 120）在 `ScriptProcessorNode::Process()` 存在 use-after-free，崩溃码 `STATUS_ACCESS_VIOLATION / 0xC0000005`（退出码 `-1073741819`），上游在 Chrome 121 修复。阿里云风控 SDK 在用户点击（手势）时创建 `ScriptProcessorNode` 做音频指纹，因 `AudioContext` 只能在手势后创建或恢复，所以表现为点击即黑屏。控制台的 `gyroscope/accelerometer ... not allowed` 与 `deviceorientation blocked by permissions policy` 只是 Permissions-Policy 告警，Electron 没有 `sensors` 权限类型，`setPermissionRequestHandler` 对此无效；`use-angle=gl`/`disableHardwareAcceleration` 也不对症。当时的修复是在 `getWebviewClickInterceptorScript` 中 patch 阿里云/通义域名的 `AudioContext`/`webkitAudioContext`/`OfflineAudioContext`/`webkitOfflineAudioContext` 的 `createScriptProcessor` 为纯 JS 桩对象；彻底方案是升级 Electron 28 到 29+。判别：点击触发 + 退出码 `-1073741819` + `ScriptProcessorNode is deprecated` 告警。

- **WebContentsView 的 Windows 圆角、遮挡和截图还原**：`setBorderRadius` 在 Windows 下是 no-op；要实现圆角裁剪，需把 native view 设为透明并向页面注入 CSS，给 `html` 容器设置 `border-radius` 和 `overflow: hidden`。DOM 覆盖物激活时会被 native view 遮挡；当时最稳健的做法是在覆盖层打开时统一对所有 active WebContentsView 截图，隐藏真实视图并把截图作为静态背景，待抽屉关闭 300ms 动画结束后恢复。简单 dropdown 或侧滑菜单可以用 Electron 原生 Menu 重构，避开 z-index 冲突。截图做遮罩时要先用主进程 `image.resize()` 缩放到 1:1 DIP 物理尺寸，不能靠 CSS `background-size: 100% 100%` 拉伸，否则高分屏会出现重采样锯齿和尺寸抖动。

- **旧 API 流式总结的生命周期经验**：`summaryApi`、`useSummaryPanel` 和 `generate-summary` 已删除，旧共享控制器互斥方案不再代表当前调用关系。可复用原则是：覆盖控制器前中止旧请求，异步闭包捕获本次控制器，完成时只清理仍属于本次请求的引用；流式 reader 在异常或取消路径取消并释放，避免向已销毁 sender 发送或继续空转。当前 taskSplit 是 `stream: false`，没有 reader/onChunk；未来引入流式接口时按新接口实际生命周期设计，不能照搬旧 IPC。

### 本地 Agent 与 AI 侧边栏

- **pi-coding-agent v1.6 fork 内核自带 MCP 与标准 Skills，无需外部适配器**：内核 `dist/core/mcp-servers.js` 已实现 `mcp.json` 配置校验与工具暴露分档（direct/deferred/codemode/hidden，deferred/codemode 是控制上下文成本的默认正确档位），OAuth 也在内核；`pi-mcp-adapter` 是内置支持落地前的过渡产物，已过时勿用。Skills 加载（`dist/core/skills.ts`）遵循 Anthropic Agent Skills 开放标准（name 小写连字符不超过 64 字符、description 不超过 1024 字符），anthropics/skills（文档类 Apache-2.0，各子目录自带 LICENSE）、vercel-labs/skills 等公开仓库的 Skill 目录拷进扫描根即可用。MultiChat 侧 Skills 链路（`agentDir/skills` + `agent_extra_skill_dirs` + AgentSkillsSettings UI）已完整存在，加 Skill 不需要架构改动，只需要内容与 extraResources 分发（照抄 multichat-cli 模式）；MCP 则需在会话创建路径上接 `mcp.json` 加载，属集成缺口而非能力缺失。

- **文档四件套 Skill 源选型已定型：anthropics/skills 是唯一合规上游**：OpenAI Codex 随包的 documents/spreadsheets/presentations/pdf skills 虽是 anthropics 版的深度改编（质量更高，含逐页渲染验收、写作质量清单、模板蒸馏），但其 LICENSE 为 "Copyright 2026 OpenAI, All rights reserved" 明确禁止提取、复制分发与衍生转授，只能借鉴方法不能拷贝文本；公开 openai/skills 仓库无 LICENSE 且只有不完整的 pdf。anthropics/skills（约 20 万 stars，2.3 万 forks，社区实现全是其下游改编）2026-11-06 已将 Office 四件套统一迁 Apache-2.0（commit "Move Office skills to the Apache 2.0 license #2146"），且技术栈换代：docx/pptx 创建改用 npm 的 docx-js/pptxgenjs（Electron 直接受益），xlsx 仍用 openpyxl/pandas、pdf 仍用 pypdf，公式重算与视觉验证依赖 LibreOffice（应做探测式可选增强而非硬前置）。
- **文档四件套 skill 定稿方案（2026-11-27 两轮独立评审后）**：xlsx 用 MiniMax 主干（`libreoffice_recalc.py` 自带无需移植）；pptx/pdf 用 anthropics；docx 用 anthropics 主干 + 移植 MiniMax 的 MIT 文本资产（cjk_typography/scenario_c_apply_template/openxml_element_order/openxml_units/troubleshooting 五件成套，少移植排错类就等于丢掉"怎么不出错"），**不引入 .NET**——MiniMax 套模板核心知识是 XML 级运行时无关文本，.NET 独有的只是编译样本库/确定性 CLI/门禁纪律三样，不值得 200MB SDK 成本。关键纠偏：① OpenAI 限制性许可只覆盖文档四件套，`skills/.system/skill-creator` 实为 **Apache-2.0 可直接改编**；② anthropics docx 读取路径硬编码 `pandoc`，改编必须换 `markitdown`（随 Python bootstrap 走）；③ minimax-xlsx 自带公式重算，与 anthropics 能力等价。运行时供给：Agent shell PATH 无 node，"Electron 自带 Node"够不着——Node 随包嵌入 `resources/runtime/`（npm 目录树必须全量保留否则 npx 失效）+ 主进程 prepend `process.env.PATH` 即可继承（内核 `getShellEnv()` 展开 process.env）；embeddable Python 两坑：不带 pip 需 get-pip 引导、`python*._pth` 的 `import site` 必须取消注释。分发链路：内核扫描候选**不含** `resources/skill/`，已通过 `additionalSkillPaths` 追加挂载（`bundledSkills.ts` + `AgentSessionService.resolveSkillDirs` 四处构造点统一）；内核同名去重"先扫描者获胜"且 additionalSkillPaths 排在自动扫描之后，"用户目录优先"规则零额外开发。**仓库内 skill 源必须放 `build/skills/` 而非 `.agents/skills/`**（扫描隔离补充：pi 内核 skill 扫描是递归的，仅跳过 node_modules 与点号目录——同一扫描树内无法排除单个 skill，唯一可靠隔离是目录分层：`build/skills/internal/` 作侧边 Agent 扫描根，外部专属 skill 放根部不进入扫描根；为脚本类 skill 打补丁后 py_compile 不足以验证（NameError 编译期不报错），必须真实执行一次）（skill 写作纪律：必须逐功能对照代码核实宿主能力，不可按 agentskills 生态常识推断——workbench-assets 曾虚构"提示词模板库"章节被用户指出；标签系统、导图契约等引用前必须 grep 验证存在性）——后者是 agent 生态自动扫描约定目录（pi 内核扫描 cwd 祖先的 `.agents/skills`，其他宿主 agent 同惯例），会污染本仓库的开发上下文（已实证：Codex 类 agent 在仓库内工作时自动加载了全部随包 skill）。skill-creator 定稿：OpenAI 版改编（宿主无关渐进式披露框架）+ Anthropic 评测方法论作进阶章节。**核验 skill 仓库必须读 README 确认是否独立实现**——tfriedel/claude-office-skills（850 星）实为 anthropics 下游镜像且作者已废弃。

- **本地 Agent 交互UI避免引入外部重型聊天运行时库，优先采用 Zustand + 原生组件接管**：`@assistant-ui/react` 等库对消息格式有严苛的内部 schema 约束（例如 user 消息不可携带 status，或者子组件强制要求 AuiProvider 上下文），且与底层 Pi Coding Agent 的事件流模型存在语义分歧。采用 Zustand 统一维护消息、工具调用、思考过程与权限确认，直接驱动自定义组件（如 `BashToolUI`、`ThinkingBlock`），既解除了外部库崩溃风险，又能够与工作台 `WebviewCard` 保持完全一致的视觉与交互基线。

- **动态高度文本输入框必须设置 min-height 兜底**：基于 `scrollHeight` 动态计算高度的 textarea，若在被隐藏（如父容器 `display: none`）或挂载动画帧内初始化，`scrollHeight` 会被浏览器计算为 `0`，从而把 inline style 锁定为 `0px` 造成输入框塌陷且不可聚焦。textarea 必须声明 `min-h-[44px]` 或在 auto-resize effect 中强制 `Math.max(minHeight, ...)` 兜底。

- **ReactMarkdown 行内代码组件必须配合 isBlock 校验与 Tailwind prose 规范**：`react-markdown` 的 `code` 组件传参在不同版本中可能不附带 `inline` 布尔值，直接以 `!inline` 判断会导致所有行内变量与文件名被渲染为巨型黑色 `<pre>` 块。必须通过 `className && /language-/.test(className)` 判定代码块；同时配合 Tailwind `prose-code:before:content-none prose-code:after:content-none` 消除伪元素自动添加的字面量反引号。

- **Electron 主进程加载纯 ESM 的 Pi Coding Agent 需使用动态 import**：当 Electron 主进程构建输出为 CommonJS 时，静态 `import ... from '@earendil-works/pi-coding-agent'` 会被打包器转换为 `require()`，触发 `ERR_PACKAGE_PATH_NOT_EXPORTED`。必须使用 `new Function('s', 'return import(s)')` 包装动态导入，避免构建器重写。

- **Pi 的 `getContextUsage()` 必须区分"未知"与 0**：该方法读取最近一次 assistant 响应的 `usage.totalTokens`，compaction 之后、下一次响应之前会返回 `{ tokens: null, percent: null }`；模型没有 `contextWindow` 时直接返回 `undefined`。UI 不能把 `null` 当 0 渲染，也不要用 `input + output` 自行重算；上下文占用用 `getContextUsage()`，会话累计成本与 token 用 `getSessionStats()`，两者口径不同。

- **`registerProvider()` 的可用性刷新是异步的，初始化要等一次 `refresh()`**：`ModelRegistry.registerProvider()` 内部只触发 `void this.refresh({ allowNetwork: false })`，注册后立刻读取 `getAvailableSnapshot()` 可能还没有把新 provider 标为可用，表现为模型 Picker 首次打开是空态。动态注册内置 provider 后应显式 `await modelRuntime.refresh({ allowNetwork: false, providers: [id] })`，再对外提供快照。

- **`setThinkingLevel()` 会自动 clamp，必须回读实际值**：模型只支持部分档位时，SDK 会把越界档位收敛到最近可用档位，并且 `persist: true` 写入的是用户请求值而非实际生效值。UI 不能乐观写入请求档位，必须用 `session.thinkingLevel` 与 `getAvailableThinkingLevels()` 回读后再更新状态。没有活动会话时若要保留用户选择，应只持久化选择，等建会话时由 SDK 再 clamp。

- **Pi 自定义 provider 目录更新的可靠路径是 `registerProvider` 重注册，不是 `refreshModels` 返回值**：pi-coding-agent 的 extension `refreshModels(context)` 返回值要经过 composer 闭包 `refreshedExtensionModels` 投影才进 `getModels()`，实测该投影链路在反复 recompose（`ModelRuntime.refresh({providers})` 每次先 `recomposeProvider` 重建闭包）下拿不到结果，模型数始终停在注册时的静态列表。可行的做法：后台 `fetch` 目录后直接 `registerProvider(providerId, {models, baseUrl, ...})` 重注册 —— `registerProvider` 会 merge 进 `extensionProviders` 并 `recomposeProvider` 重建 provider，`applyExtension` 把 `extension.models` 全量投影，不依赖 refreshedExtensionModels。两个坑：① `registerProvider` 里 `validateExtensionProvider` 校验的是**裸入参**不是 merge 后的 effective，重注册只传 `{models}` 会因 `config.baseUrl` 缺失抛 `"baseUrl" is required when defining custom models`，必须连同 `baseUrl`（以及 name/apiKey）一起传；② 持久化自己读写 `agentDir/models-store.json`（结构 `{providerId:{models,checkedAt}}`，与 FileModelsStore 同格式），启动时先读缓存 seed 注册，网关离线也能拿到完整目录。`anthropic-messages` 类模型的 `baseUrl` 必须是不含 `/v1` 的网关根地址，Anthropic SDK 会自己拼 `/v1/messages`，带 `/v1` 会变成 `/v1/v1/messages` 404。网关 `/v1/models` 每条记录用 `native_endpoints` 标出原生协议，映射规则：`/v1/messages`→`anthropic-messages`、`/v1/responses`→`openai-responses`、其他→`openai-completions`；`reasoning_levels` 可精确转成 `thinkingLevelMap`（不支持的档位置 `null`，pi 自动 clamp），`none` 要映射到 `off`。验证时注意：`remote-debugging-port 9223` 被已运行的 dev 实例占用时，spawn 新实例 CDP 会连到旧进程上得出"代码没生效"的假阴性，应把端口改成 env 可控（`MULTICHAT_DEBUG_PORT`）或先杀旧实例。

- **自定义 OpenAI 兼容网关 provider 应该做成通用层而非厂商专属**：标准 `/v1/models` 只保证 `id`/`object`/`owned_by`，模型→api adapter 的区分需要 `native_endpoints` 这类非标准字段；没有这个字段的网关（LiteLLM/one-api 等）只能把全部模型默认 `openai-completions` 或让用户手选 protocol。通用实现 = `CustomGatewayProvider`（baseUrl+apiKey+fetch/persist/re-register）+ 可选 `enrichModel` hook 处理异构字段，具体网关（如本地 magpie）只保留一个配置实例而不是专属文件。

- **AgentCard 的 cwd/workspacePath 同步 effect 是跨工作区会话"点击无反应"的根因**：`agentSessionStore.resumeSession` 恢复一条 `cwd` ≠ 当前 `workspacePath` 的会话后，`AgentCard` 顶部两个 effect 检测到分叉会 `newSession()` 把刚恢复的消息清空，表现为历史 popover 点了没反应。跨工作区恢复的正确顺序必须是「先 `setWorkspaceFolder` → 等 effect 把会话重置到新工作区 draft → 再 `resumeSession`」，且工作区切换与 `resumeSession` 的 `set({messages})` 之间存在 React 调度竞态——需用 ref 标记「本次切换是为了 resume 该 cwd 的会话」让 effect1 跳过 draft 重置。回看失效工作区会话的豁免标志（`foreignReview`）必须放 `agentSessionStore` 共享，不能放组件 state：两个 AI 侧栏实例各自挂 `AgentCard` 时，组件内标志会导致一侧进入回看后被另一侧的同步 effect 清空共享 `messages`。

- **pi 消息自带 `timestamp`/`durationMs`，直接透传不要自己计时**：`AssistantMessage`/`UserMessage` 都有 `timestamp`（请求/创建时间，毫秒）和 `durationMs`（该轮响应耗时，monotonic clock 测量）。`message_start`/`message_update`/`message_end` 事件的 `event.message` 以及 `resumeSession` 返回的 `rawData.messages` 都携带这两个字段，渲染层只需要在 `PiRawMessage`/`AgentMessage` 上加透传字段即可，不需要自己在 `turn_start`/`turn_end` 上打点。

- **任务产物目录已统一改名 esults/\ → \	ask-results/\，内嵌 Agent 的中间产物不落工作区（业界惯例）**：\AgentTaskService\ 产物子目录统一为 \	ask-results\（启动时一次性迁移旧 esults/\：搬移 TXT + 原子改写 agent-tasks JSON 里的 eplyFile\ 路径；CLI 项目里用户自己的旧目录不动）。大原则：搜索原文、压缩转储等中间产物(intermediates)放用户级/应用级存储（\getDataPath()/.multichat/\、\gentDir/compression/\），与 Claude Code/Codex CLI/OpenCode/Amp 一致，避免污染用户工作区 git status；只有用户显式索取的交付物(deliverables)才写工作区——CLI 场景 \rtifactDir\ 传 \<cwd>/.multichat\ 属后者，语义成立。\web_search\ 不传 \rtifactDir\，打捞链靠工具返回里直带 \	askId\/eplyFile\ 绝对路径 + 正文末尾 \[完整回复已存档: ...]\ 脚注（压缩掩码后仍可打捞，不依赖压缩占位符）；注意 reply TXT 落盘在 persist() 内异步完成，轮询终态可能早一拍，需短窗口重试 \getResult\ 兜底。

- **会话列表项的运行态标注必须取"后端快照 ∪ 本地事件 set"的并集**：`agentSessionStore` 里 `sessions[].isRunning`（来自 `agentListSessions` IPC 快照）与 `runningSessionIds`（`agent_start`/`agent_end` 事件实时维护）是两个不同步的来源——`agent_start` 不触发 `fetchSessions`，而后端 `listSessions` 的 `active.isRunning` 也可能滞后于事件到达。合并规则：`item.isRunning = backend.isRunning || running.has(id)`，同时把后端报告 running 但本地 set 缺失的 id 回填进 set（否则 `setSessionId`/`resumeSession` 派生的顶层 `isRunning` 在"侧栏挂载前已在跑"的会话上会丢状态）。三个生命周期事件（`agent_start`/`agent_end`/`auto_retry_end`）还要同步刷 `sessions` 列表项，不等下一次 fetch。UI 侧打开历史菜单时主动 `fetchSessions()` 一次兜底"新跑起来但从未进过列表"的条目。

- **PowerShell AST 分析的关键设计要点**：① `[type]::method()` 与实例方法 `$x.Foo()` 都是 `InvokeMemberExpressionAst`，`TypeExpressionAst` 只是 `[type]` 字面量；不应在 Node 侧对截断的 `Extent.Text` 做正则猜测（会丢末尾方法如 `(Get-ChildItem).Get(0).Delete()`、丢失超长命令路径或漏剥引号/`*>`/`-Path`），而应直接在 PowerShell helper 内把 `CommandAst.GetCommandName()`/`CommandElements`、`FileRedirectionAst.Location`、`InvokeMemberExpressionAst.Static/.Member/.Expression`、`AssignmentStatementAst.Left.VariablePath.IsUnqualified` 等结构化字段序列化输出，且节点超限必须标记 `status='truncated'` fail-closed；② `[System.Predicate[T]]` 泛型参数不能用变量类型，但 `FindAll` 直接收 scriptblock `{ param($a) $true }` 即可；③ `$x.prop = v`、`$a[i] = v` 与 `[int]$x = 1`（`Left` 为 `ConvertExpressionAst` 包裹 `VariableExpressionAst`）都是 `AssignmentStatementAst`，需拆包后校验 `IsUnqualified` 与类型白名单。

- **bash 命令分析的 wrapper 陷阱**：`bash -lc`/`bash -ic` 这类合并 flag 不会匹配独立的 `-c` token，unwrap 逻辑必须正则识别 `/^-[a-z]*c[a-z]*$/`；`env VAR=x cmd` 要跳过 `VAR=` 前缀对再判内层；`xargs` 参数本身就是新命令。`shell-quote` 对 `$(` 不产 op 且**把 `\n` 当普通空白而不是语句分隔符**，因此字符扫描阶段必须同时完成引号感知的 `$( )` 配平提取与未引号保护的 `\n`/`\r` 转 `;` 切分；无路径前缀的敏感文件名（`.env`/`id_rsa`/`*.pem`）也必须纳入路径提取送入 `inspectPath`。

- **命令安全判定器的 fail-closed 分层**：仅当分析器不可用（`analyzerVerdict === null`，且仅限 `bash` 而不对 PowerShell 走 `shell-quote`）时才允许回退到 segment 白名单；无论是 `PermissionEngine` 二判还是 `permissionPolicy.analyzeCommand` 内的旧正则 `readOnlyPowerShell` / `simpleCommand`，只要 `analyzerVerdict` 存在且 `readOnly === false` 都绝对不能翻案为 `readOnly` 或 `!requiresApproval`。
- **Agent Shell 执行包装与权限硬拒的已知陷阱**：① `ShellTool.createBashOperations` 直接包装 `@earendil-works/pi-coding-agent` 的 `createLocalPowerShellOperations` / `createLocalBashOperations`，继承其秒级 `timeout`（无强制 30s 默认超时）、`killProcessTree` 进程树终止、`waitForChildProcess` 与 `timeout:<sec>`/`aborted` 标准错误，仅在外层做行缓冲 UTF-16LE（偶数偏移扫描 `0x0a 0x00`）/UTF-8/GBK 解码、`redactShellOutput` 脱敏与 `JSON.stringify` 单行审计日志；② `PermissionEngine` 优先走 PowerShell AST / bash segment 结构化硬拒（不可解析时回退正则，避免 `HARD_DENY_PATTERNS` 误杀 `Format-*`/`--format`/字符串字面量，并递归解析 `pwsh -Command` 内层）；③ `permissionPolicy.expandPathInput` 在 Windows 上做 `resolve(homedir(), suffix)` 前必须先剥离 `~` / `%USERPROFILE%` / `$env:` 后的前导 `/` 或 `\`（否则 `resolve(homedir(), '\\.ssh\\id_rsa')` 会退化为盘符根目录 `C:\.ssh\id_rsa` 漏过受保护根目录检查），且需兼容 `${env:...}`/`${HOME}` 花括号语法；④ `bashAnalyzer` 解析 `env`/`xargs` wrapper 时短参数必须区分大小写（`-P` vs `-p`、`-i` vs `-I`）并在重拼内层命令时重新加引号（`quoteBashToken`），避免吞掉嵌套 `bash -c "..."` 的引号或参数。
- **Magpie 是本地聚合网关而非远端供应商，客户端不需要 API Key 与额度查询**：Magpie 运行在本机（默认 `http://127.0.0.1:3425/v1`），上游各厂商账号的凭据与额度都在网关自身管理界面中配置；MultiChat 连接它只用一个静态占位 key（`'magpie'`，因为 pi 注册模型目录时 `apiKey` 必填），因此设置页对 magpie 隐藏 Key 按钮是符合架构的，`setCredential` 对其也会拒绝（`provider.auth.apiKey?.login` 不存在）。同理额度链路要在 `buildQuotaTargets` 直接跳过 magpie——网关没有公开的额度接口语义，查询只会得到无意义错误。已废弃功能的教训：UI 删除入口时要把 IPC/服务/类型全链路一并删（如每模型 spec override 的 `agent:set-model-spec-override` → `ModelCatalogEnricher` overrides → `AgentModelSpecEditor` 组件），只藏按钮会留死代码与孤儿写盘逻辑。
- **Agent 文件变更追踪必须按用户回合（`agent_start`→`agent_end`）聚合，且基线内容必须在写盘前捕获**：`pi-agent-core` 单次用户提问内每轮工具调用都会触发 `turn_start`/`turn_end`，若在 `turn_start` 重置累加器或在 `turn_end` 覆写 `file-changes/index.json`，多步编辑后卡片只会残留最后一个子轮的文件；同时 `.before` 基线字节必须在 `beforeToolCall` 写盘前读入，绝不能在结束落盘时再从修改后的磁盘补读。对非只读 shell 命令的变更识别采用“首条写命令前 + 回合结束最多 2 次元数据扫描（10k 文件 / 300ms 熔断）”，只读命令零扫描开销；缺少修改前基线快照的条目通过 `noBaselineBlob` 标记禁用不安全撤销。

- **Agent 文件回滚/撤回的安全不变量（2026-11 加固后）**：① pi 并行批次中所有 `beforeToolCall`（权限+基线捕获+pre-shell 扫描）都先于任何工具执行，因此 pre-shell 扫描是严格的"回合前真值"——扫描在 32MiB 总预算/10MiB 单文件预算内捕获内容，shell 修改/删除的文件因此可回滚；合并时 edit 基线的可信判定是 `capturedAt < preShellScanStartedAt`（先于扫描=回合前真值），否则用扫描内容替换基线，两者皆不可得则 `noBaselineBlob` fail-closed，绝不允许"回滚后仍残留 shell 修改"的假回滚。② 回滚写入必须原子：`<file>.multichat-revert-<pid>-<ts>.tmp` 先写完整内容再同目录 rename 覆盖（Windows 下 rename 覆盖已验证原子），崩溃不可能留下半个文件。③ 校验必须幂等：文件"已是目标态"或"已是基线态"都算已满足，否则中途失败后重试会因已回滚的文件不匹配 target 而永久死锁。④ 会话运行中必须服务端硬拒 revert/reapply/rewind（UI 禁用不够，期间写盘会覆盖 agent 正在编辑的文件）。⑤ rewind 撤回需先 `waitForFileChangePersist` 再读记录；撤回成功且记录 turnIndex 匹配被弃回合时必须删除 `file-changes` 目录——重发会复用同一 turnIndex，不删会让旧卡片错误挂到新回合上。⑥ 用户显式选"回滚文件"时若无匹配记录必须让整个撤回失败，不能静默降级成仅撤回对话；`status==='undone'` 的重试路径要按 baseline 校验而非直接报错。无头测试法：esbuild 把 AgentSessionService 打成 cjs + `Module._load` stub electron，即可脱离 Electron 对 revert/reapply 做真实文件级测试。

- **Agent 侧栏文件入口点击必须显式声明 preview/forcePermanent 语义**：`openFile(rel)` 裸调用会落入 `syncTabsOnOpen` 的无条件常驻分支（每点必开 `isPreview:false` 新标签），高频查看场景（chip、变更文件卡、工具文件名）会刷屏标签栏。正确语义：普通点击 `{ preview: true }` 复用 VS Code 式预览槽位（与文件树单击一致，编辑自动转正），Ctrl/Cmd+点击或中键点击 `{ forcePermanent: true }` 表达明确新标签意图；`agent/filePathUtils.ts` 的 `agentChipOpenOptions(e)` 统一封装该判定。新增任何打开入口时先确认语义归属，不要裸传路径。

- **contenteditable chip 编辑器（AgentComposerEditor）的稳定模式是"纯文本模型 + DOM 镜像"，绝不反过来**：文本模型保持纯字符串 `@token`（发送链路与消息气泡零改动），chip 只是视觉替换。关键机制：① 输入时序列化 DOM 与模型比对，**文本一致即跳过 DOM 重建**——普通打字不动 DOM，光标与 IME 组合输入（`composingRef` 期间禁止重建）自然不受干扰；② chip 宿主是 `contenteditable=false` 的原子 span，退格/删除整体移除，React 内容经 `createPortal` 注入宿主；③ 需要重建时（外部 append、@菜单完成、chip 化状态翻转）先按纯文本偏移量度量光标，重建后按偏移恢复（命中 chip 内部则落到 chip 之后）；④ 粘贴统一 `execCommand('insertText')` 扁平化纯文本，Shift+Enter 统一 `insertLineBreak` 产 `<br>`，避免浏览器生成 `<div>` 块结构导致序列化分叉。已知边界：chip 化那一刻的 DOM 重建会清空浏览器 contenteditable 原生 undo 栈。chip 图标分派要查文件树节点 `isDirectory`（目录 → folder 图标），且输入框 chip、消息气泡 mention、回复附件 chip 三处需同步。

- **Agent 工具运行态判定必须以"组级 agent run 存活"为权威，消息级 status 与 part.result 都不可信**：image_gen/web_search 这类 60–90s 长任务曾出现"仍在生成、UI 却显示成功且标题停止闪烁"的假成功，根因链上三个信号各有盲区：① pi 的 `message_end` 在 `tool_execution_start` **之前**到达，个别形态下其 content 快照不含 toolCall 或为空数组，`content.every(无未完成 tool)` 会 vacuous true 把消息误标 complete；② `message_update`/`message_end` 的整体覆盖式 merge 会把 `tool_execution_start` 已插入的本地 tool-call part 连同 result 抹掉；③ `resumeSession`（HMR/重载/切换会话 mid-flight）曾一律标 complete，且恢复的 toolResult 只存裸 content 数组丢失 details/structuredContent。防御四层缺一不可：merge 保留本地 orphan tool-call；`tool_execution_start` 强制 status 回 running；`turn_end` 兜底不得越过未出结果的 tool-call；渲染层 ToolGroup 的 isRunning 用组级（agent_start→agent_end 存活）而非消息级。resume 恢复运行中会话要靠后端 `isRunning` 权威标记还原 running。实证排查用 `MM_AGENT_EVENTLOG=1`（sessionsDir/\<id\>/event-timeline.jsonl）。会话已结束仍无 result 的工具要显示"未返回结果"而非"成功"。

- **正则交替分支的捕获组编号：`(​?:FP(\d+)|(\d+))` 中第一分支是 group 1、第二分支是 group 2**——误用 `match[1]` 读第二分支得到 `undefined`，`Number(undefined)` 转 `NaN` 后索引静默失效，占位符还原整链失败且无任何报错（数学公式曾因此全部渲染为原始占位文本）。写完交替正则必须用两个分支的真实样本分别验证捕获组取值。markdownMath 的裸路径提取复用公式占位管线：同一遍扫描跳过行内/围栏代码与 `](...)` 链接目的地，`prefixFP{n}END` 占位符与数学 `prefix{n}END` 共享 restore，rehype 阶段还原为 `data-file-chip` 元素由 components.span 分支渲染成 InlineFileChip。

- **给 Agent shell 提供 `node` 入口的正确机制是 pi spawnHook 注入函数，`.ps1`/`.cmd` shim 都有致命缺陷**：`.ps1` shim 完全不可用——PowerShell 对 `.ps1` 脚本做参数绑定，`node -e` 的 `-e` 会被当作脚本参数（歧义匹配 `-ErrorAction`）而非转发；`.cmd` shim 的 `%*` 转发经 cmd 二次分词，含 `&` 的参数即使加引号也会被截断，且 libuv 的 `\"` 内嵌引号转义 cmd 不理解（对 JSON-in-argv 类调用是真实威胁）。正确做法：pi `createPowerShellToolDefinition` 支持 `spawnHook`（`bash.d.ts` 已核型），hook 改写后的 command 确定流经自定义 ops（`bash.js` spawnContext 链），注入 `function node { $env:ELECTRON_RUN_AS_NODE='1'; & '<exe路径>' @args }`——`@args` 是 PowerShell 原生转发无二次分词、零随包文件、不占 PATH、变量不污染主进程。注意 spawnHook 函数不进嵌套 shell（脚本内再 `powershell -Command`），极端场景可用 `.cmd` 兜底但接受 `%*` 元字符局限。

- **Electron 本体即 Node 解释器，面向消费者的 agent 应用应自供运行时**：`ELECTRON_RUN_AS_NODE=1` 环境下 electron.exe/打包后的应用 exe 就是完整 Node 解释器（electron 42 → node v24，实测退出码透传、stdout 管道正常、spawn 开销约 125ms）——skill 的 JS 脚本链路零体积增量可用，但该变量绝不能写进主进程 `process.env`（会被 Chromium GPU/renderer 子进程继承导致整个应用退化崩溃，只能存在于 shim/hook 的子进程作用域）。业界分界：面向消费者的 agent 桌面应用自供运行时（Codex 桌面应用为文档四件套在 `~/.cache/codex-runtimes/` 预置 node 350MB+python 226MB+native 依赖共约 3GB 实证；SkillsBench 论文同样记录"provide a clean, dependency-free skill that already bundles the correct runtime"），面向开发者的 CLI agent 才依赖宿主环境。"用户已有 Node/Python"对开发者成立、对非程序员目标用户不成立；折中策略是三级回退（managed→安全探测 system python 转 venv→embeddable bootstrap），system python 探测严禁裸调（Windows 商店 stub 会弹窗），只允许带 `--version` 解析 stdout 加超时。

  实测补充（2026-11-27 全链路真跑验证）：`py` launcher 装在 `C:\Windows` 而非 `C:\Windows\System32`——模拟"无 python 环境"测试剥离 PATH 时**不能保留 `C:\Windows`**，否则 system-venv 分支被误命中掩盖 bootstrap 分支。ensure-python 三级回退全部实测通过：system python→venv 转化（`reused:false,source:"system-venv"`）、二次运行幂等复用（`source:"managed"`）、PATH 只剩 System32 时 embeddable 下载→get-pip→pip 安装全链（`source:"bootstrapped"`）。

- **右键发送 `blob:`/`data:`/`http(s):` 图片到 `local-agent` 必须走 `addImageAttachment`**：`handleSendImage` 原先先落盘 `multichat-uploads-*` 临时文件、调 `uploadFilesToCurrentModel`，在 `finally` 里立刻 `cleanupUploadTemp` 删目录；网页平台在 `uploadFile` 完成时已完成上传，但 `local-agent` 分支只调 `mentionFile` 插入 `@path` 并立即返回，导致用户发送前文件已被删（`ENOENT`）。对 `local-agent` 应把非 `workbench-file://` 图片直接转为 `dataUrl` 注入 `addImageAttachment`；同时主进程 `save-image-from-url` 对 `data:` URL 需按 MIME 推导 `image.<ext>` 默认文件名，避免 `new URL(dataUrl).pathname` 把 base64 串写进保存对话框。

### 原型与视觉验收

- **用 `innerHTML` 重建含 `id` 的子节点后，后续渲染不能再引用旧节点**：自包含 HTML 原型中，如果渲染函数先写入容器 `innerHTML`，之后再按旧 `id` 查询该容器内的节点，首次渲染可能成功，但切换文档、新增标注等第二次渲染会得到 `null` 并中断交互。修复应删除冗余的旧节点引用，或始终在重建完成后重新查询；验收不能只截首屏，还要实际触发一次文档切换或数据更新后的重渲染。

- **静态原型验收要覆盖交互状态和重复渲染**：首屏截图只能证明初始布局，不能证明切换、重复渲染、空态、错误态和窄屏分支。验收时应实际触发关键路径，并把浏览器截图与 DOM 状态一起作为证据；具体样式数值是视觉取舍，不升级为通用规则。

- **彩色文件图标搬上品牌色背景前必须逐色相检查对比度**：文件树的 md 图标本色 `text-blue-500`(#3b82f6) 与 primary 用户气泡底色完全相同，取消图标强制刷白后会直接隐形；TS/TSX 图标 #0288d1 与气泡蓝也只有弱对比。可行做法是 md 类单色 AppIcon 取同色系浅色（如 text-blue-200）保持色调又保证辨识，多色 FileTypeIcon 位图可用 `saturate(1.1)` 做低成本分离补偿。
