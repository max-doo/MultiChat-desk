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


### 2. 深度研究与跨 frame 提取

- **Deep Research 跨域报告提取的边界**：顶层 Webview 脚本不能直接读取跨域报告 iframe。历史排查发现 ChatGPT 报告可能同时跨 child target 和 execution context；仅递归 target 或仅按 URL 筛选都不完整，`about:blank` frame 也可能承载报告。探索时可结合递归 `Target.setAutoAttach`、`Page.getFrameTree`、`Page.createIsolatedWorld` 与带 session/context 的 `Runtime.evaluate`，并只 detach 自己附加的 debugger。此为排查经验，不能视为当前已验收的产品能力；TODO 仍保留提取失败事项，真实报告完整性与耗时必须重新验证。

- **关键回退在能力边界识别稳定信号**：当多个调用点容易漏传可选参数时，Webview 能力边界可根据稳定页面信号识别是否需要回退，上层参数只表达等待模式等业务意图。需核对当前 Hooks 与调用链，不把历史 Deep Research 参数方案当成已实现能力。Electron main 改动后完整退出并重启开发应用；renderer HMR 或构建成功不能证明运行中的 main 已加载新代码。


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

- **Windows 多 WebView 无框窗口的最大化黑闪应绕开原生 overlay**：`titleBarOverlay` 的最大化按钮可能绕过 renderer IPC，直接触发原生 `maximize()` 并重建 Chromium swap chain。出现黑闪时，应移除 win32 overlay 控件，由自绘按钮调用基于工作区的 `setBounds`，同时保存还原边界。

- **Windows 多 WebView 主窗口的拖动必须合并高频 pointermove**：保留 Pointer Capture 与 `setContentBounds`，按渲染帧限速合并移动事件，并在 `pointerup` / `pointercancel` 提交最终位置，避免 IPC 和窗口合成队列堆积导致卡顿与拖影。

- 快捷操作快捷键（Ctrl+Shift+S/E/T/Q）的提示词注入流程：先通过 VBScript 模拟 `Ctrl+C` 自动复制选中文本，读取成功后，再展示并聚焦快捷窗口，最后发送 `quick:inject-prompt` IPC 完成一键总结。

- quickWindow 初始配置 `alwaysOnTop: false, skipTaskbar: false`，让用户通过 pin 按钮自行决定是否置顶。`skipTaskbar: true` 会导致窗口被其他窗口遮挡后无法通过任务栏找回，用户体验差。isPinned 状态由前端 toggle 按钮驱动，通过 `quick:get-always-on-top` / `quick:set-always-on-top` IPC 控制。

- **Frameless Electron 独立窗口使用 w-screen h-screen overflow-hidden 消除 body 背景溢出**：在 Electron 的无边框窗口（`frame: false`）中渲染独立页面时，如果该页面的最外层容器声明为 `w-full h-full`，但父级 HTML/Body 及 React `#root` 未声明高度（默认 height: auto），会导致容器高度发生塌陷，退化为内容高度。由于 Electron 窗口具有物理固定宽高（例如 900x700），塌陷容器下方多余的视口空间会被 `body` 的 CSS 背景（如 radial-gradient 等渐变背景）直接填充，表现为“诊断页底栏下方出现大片无用空白/渐变底色”。**正确做法**：将独立窗口的顶层容器直接声明为绝对视口宽高的 `w-screen h-screen overflow-hidden`，使其强制填充 Electron Window 并阻止 body 溢出滚动，同时使用 flex 布局的 `flex-1 overflow-auto` 赋予内部面板响应式滚动能力，底栏自然贴合底边。


## Stable Decisions

### 8. 笔记、快照与会话身份

- 来源会话键应保留完整规范化URL路径，截取第一个chat片段会把chat/s/id1和chat/s/id2错误分为同一会话

- 抓取网页对话时，ChatGPT 等平台 DOM 自带无障碍头 (如 <h4>你说：</h4>)，在 htmlToMarkdown 时会被转为 Markdown 噪音；因此提取消息必须主动过滤 DOM 伴生噪点，使用 XML 标签隔离结构，彻底避免语法与格式污染


### 9. 历史恢复、轮询、休眠与内存

- **轮询抓取空结果不能累计稳定次数**：空字符串表示页面尚未产出、跨 frame 目标尚未出现或本次读取失败，不是“内容稳定”。只有非空且满足业务基线条件的内容才能累计稳定计数；空结果必须保持未完成并继续轮询，否则会在真实回复出现前误判结束。

- **恢复历史时产品模式切换会重置会话锚点**：若恢复流程调用 `setProductMode`，必须在模式恢复完成后重新设置 `isNewSession`、`activeModels` 与 `currentConversationId`，否则后续总结或续写会失去当前历史会话上下文。

- **轮询「等回复稳定」必须每轮重新校验与基线不同，禁用单向闩锁**：`getResponseFromSlot` 早期实现只用「连续两次 `getLatestResponse()` 内容相同」判定回复完成，缺少与发送前状态对比。修复 v1 加了 `sawNew` 闩锁（首次 `cur !== base` 即置 true 永久开门），但仍漏 bug——闩锁是错误抽象：①基线读空（`base=''`，发送脚本扰动 DOM / 慢平台未渲染 / 读取瞬时空）后平台渲染出上一轮旧回复 `OLD`，`cur=OLD !== ''` 触发闩锁，稳定后**返回旧回复**；②`base=OLD` 时流式渲染中途 `cur` 瞬时为空触发闩锁，新回复未真正出现 `cur` 又回稳到 `OLD`，稳定后**返回旧回复**。`sendMessage` 在「点发送」即 resolve、不保证对方已回复，进一步放大。**正确模式（修复 v2）**：发送后立即取基线 `baseline = await ref.getLatestResponse()`，轮询每次循环都要求 `cur && cur !== base` 才计入稳定计数（`cur` 等于基线或为空则重置 `stableCount=0`），连续 N 次相同且 `!==base` 才返回；到 deadline 仍未稳定返回空串，调用方中止。**不要用 `sawNew` 一类的单向闩锁**——稳定达标时必须再校验返回值 `!==base`。判别：辩论/任务链等「轮转发送+读回复」场景若出现回合内容不递进、拿上一轮旧话当本轮，即命中此坑。

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
