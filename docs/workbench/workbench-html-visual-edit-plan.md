> Created: 2026-11-23 12:35 (Asia/Shanghai)

# 工作台 HTML 预览可视化编辑方案

## 目标

在工作台预览 HTML 文件时，提供"编辑模式"：在渲染结果上直接修改文字、对卡片/列表项做拖拽排序、增删同级元素、简单样式调整（加粗/颜色/字号），并把结果序列化写回磁盘文件。

适用对象是 **AI 生成的单文件 HTML 落地页/报告页**——以静态结构为主、含少量内联脚本、不含复杂构建产物。重交互的完整小应用不在本期范围。

## 现状锚点

- 预览路径：`src/renderer/src/components/workbench/WorkbenchCodePreview.tsx` 在 `isHtmlFile && viewMode==='render'` 时渲染 `<iframe sandbox="allow-scripts" src={activeFileUrl}>`，预览的是 `workbench-file://` 白名单协议吐出的**磁盘已保存版本**（`src/main/services/workbenchService.ts` 的 `WORKBENCH_FILE_SCHEME` + `handle`）。
- 协议约束：`workbench-file://` 在 `persist:shared` session 上 `protocol.handle` 流式回源，白名单校验落在已授权工作区根目录（`workbenchService.ts:347`）。iframe 保持 `sandbox="allow-scripts"`，**没有 `allow-same-origin`**。
- 编辑资源：主进程在同一个 `workbench-file://` 路径下提供编辑文档、编辑运行时和样式资源，分别由 `workbench-edit`、`workbench-edit-runtime`、`workbench-edit-style` 查询参数区分。三者同源，但编辑 iframe 仍不获得同源特权。
- 探路验证：独立 spike（`D:\Project\html-visual-edit-spike\index.html` + `serve.js` + `verify.js`）已在浏览器里验证了完整编辑链路，核心交互结论已迁移到正式实现。

## 探路验证结论（为什么这么做）

三条关键经验，全部来自实机验收而非假设：

1. **`designMode` 下原生 HTML5 拖拽失效**。`draggable`/`dragstart`/`drop` 在 contenteditable 文档里会被浏览器的"文本拖选"机制抢占，`dragstart` 根本不按预期派发——表现为元素变灰（`beginDrag` 生效）但之后无反应。**不能用原生 DnD**。
2. **拖拽期间不能让指针事件跨 iframe 边界失联**。最初把 `mousemove`/`mouseup` 只挂在主文档 `window`，指针进入 iframe 后会被 iframe 文档捕获，外层收不到事件。正式实现用外层覆盖层与 Pointer Capture 固定事件归属，再把相对坐标通过 `postMessage` 下发给 iframe，避免跨文档事件丢失。
3. **MutationObserver 不能回调内又改 DOM 形成自激**。最初 `observer` 回调里调 `markDraggables` 又 `setAttribute`/`removeAttribute`，产生新 mutation → 无限循环卡死页面。修法：observer 过滤掉 `class`/`draggable`/`style` 属性变化，`markDraggables` 改成幂等。

## 技术方案

编辑逻辑不依赖外部编辑器库（GrapesJS/Onlook 均评估过——前者对任意 HTML 导入"editing feels broken"，后者只支持 Next.js+Tailwind，均排除）；主进程只负责在既有白名单协议下提供编辑文档与静态资源。

### 1. 编辑文档隔离与通信

- 编辑态使用独立 URL 加载由主进程拼装的编辑文档。原 HTML 内容保持不变，编辑样式和运行时作为同源静态资源额外引入。
- 不把 iframe 改为 `allow-same-origin`。外层渲染进程不直接读取 `iframe.contentDocument`；选中框、元素信息、脏状态和序列化结果通过带来源标识的 `postMessage` 协议传递。
- 工具条位于外层渲染进程，避免被 iframe 内页面样式覆盖；iframe 只上报选区矩形和可用操作，由外层负责定位与命令下发。

### 2. 编辑模式

编辑运行时在 iframe 内接管页面交互，实现：

- **文字编辑**：运行时把 `document.designMode` 设为 `on`，全页文字原地可改。
- **元素点选**：`click` capture 拦截 → 选中元素加高亮 class → 顶部浮出工具条（相对 iframe 偏移定位），底部状态栏显示面包屑 `body › section › div.card`。
- **拖拽排序**：可排序元素被选中后，在容器左上角外侧显示拖拽手柄，避免覆盖正文；只有手柄能完整落在容器外时才显示，贴边无外侧空间时隐藏而不是压住正文。按住手柄时，外层用 Pointer Capture 配合覆盖层持续接收移动，再把相对坐标下发 iframe；运行时按 flex-row/grid 判横向、块流判纵向计算落点，松开后完成换位。这样指针移入 iframe 区域时外层也不会丢失拖拽阶段。不可排序元素不渲染拖拽手柄。
- **结构操作**：`＋` 克隆选中项并把叶子文字重置为占位符插入其后；`⧉` 原样复制；`🗑` 删除。
- **样式微调**：选区内文字 `execCommand('bold'/'italic'/'foreColor'/'hiliteColor')`，或对整个元素 `style.fontWeight/fontSize/color/backgroundColor` 直改。工具条会读取当前文字色和背景色并回显为色块；背景色独立于文字高亮，可设为透明。颜色菜单提供色相、饱和度/明度、不透明度与 Hex 输入，透明背景直接作为背景调色板中的一个选项；实时调色时保持宿主窗口焦点，避免 iframe 抢焦点导致菜单关闭。
- **hover 高亮**：`mouseover`/`mouseout` capture 加虚线 outline；同时 `e.stopPropagation()` 拦掉页面 JS 的 mouseover 弹层/下拉菜单，但 **CSS `:hover` 样式保留**（浏览器渲染层，stopPropagation 不影响）。

### 3. 编辑边界规则（哪些能改，哪些不能）

原则：编辑的是**文档结构**，不是**页面行为**。行为一律冻结，元素本体能否删/挪按对页面语义的破坏度分档。

| 判定 | 类型 | 删除 | 排序 |
|---|---|---|---|
| 同标签兄弟 ≥2 | 卡片/列表项/非交互导航项（可排序项） | ✅ | ✅（同容器内） |
| 孤立非交互元素 | h1/p/img/装饰 span | 仅文字 | 禁（无排序语义） |
| 纯展示按钮/CTA | `button`/`a[href^="#"]` 无钩子 | 仅文字 | 禁 |
| 交互元素 | `onclick`/`form` 控件/`a` 真实 href/`role=button`/`data-*` 钩子 | ❌ | ❌ |

实现上两条启发式：`canReorder(el)` 要求同标签兄弟 ≥2（天然把孤立标题排除在排序外）；`isInteractive(el)` 命中表单控件、所有 `a`/`button`、`onclick`、`role=button` 或 `data-*` 行为钩子时，工具条 `🗑/＋/⧉` 置灰，只放文字编辑与样式，拖拽手柄不渲染。JS `addEventListener` 无法探测（无公开 API），靠 `onclick`/`data-*`/`form`/`role` 这些可观测特征近似覆盖。

### 4. 保存与序列化

- `serialize()`：克隆 `documentElement` → 移除注入的编辑样式与运行时 → 清掉所有 `__mve_*`、`draggable`、`contenteditable` 残留 → 拼 `doctype` + `outerHTML`。
- **已知边界**：`outerHTML` 会固化运行时 DOM 状态——页面脚本动态新增的节点（如 `addBtn` 追加的 `li`）会被一并写回。对静态单文件落地页可接受；若预览对象高度依赖 JS 渲染，需在注入脚本里只序列化 `<body>` 或给可编辑区打标限定范围。
- **写回路径**：可视化编辑不新增保存 IPC。保存前由编辑组件把当前 iframe DOM 序列化到 `activeFileContent`，随后复用既有 `saveActiveFile()` / `workbench.writeFile` 直接覆写原文件，并沿用现有 mtime 冲突检测。
- **不做自动保存**：可视化编辑只维护脏状态，必须点击工具条保存、按 `Ctrl+S` 或在离开确认框中选择“保存并退出”才写盘。
- **离开确认**：退出编辑模式、切换文件、切换工作区、关闭工作区、切换到其他产品模式和从托盘退出应用，都会经过统一的三选一确认框：保存并退出、放弃修改、取消。保存失败或发生冲突时留在编辑态，由现有冲突处理入口裁决。
- 保存后刷新只读预览及 iframe 基线，确保下一次编辑从最新磁盘内容开始。

## 实现步骤

1. `WorkbenchCodePreview.tsx` 提供“渲染 / 编辑 / 源码”三态切换；HTML 源码仍走原 textarea 编辑链路，编辑态单独加载 `WorkbenchHtmlVisualEditor`。
2. `src/shared/utils/workbenchHtmlEditor.ts` 提供编辑文档拼装、运行时、样式和消息常量；主进程 `workbench-file://` 协议按查询参数返回对应资源。
3. `WorkbenchHtmlVisualEditor.tsx` 负责 iframe 生命周期、选区与工具条定位、拖拽坐标转发、脏状态、序列化和保存 flusher；`WorkbenchHtmlEditToolbar.tsx` 复用 `WorkbenchFloatingToolbarChrome` 的容器、按钮与分隔线。
   顶栏保持既有工作台结构：编辑态的保存按钮位于模式分段控件之前，复制、系统打开和资源管理器定位按钮始终保留，模式分组的位置不随编辑态切换而移动。悬停、选中和拖拽落点统一使用应用主色，离开确认框沿用工作台弹窗的浅色面板、边框和主按钮样式。
4. `workbenchStore` 增加编辑 flusher、离开守卫和可视化编辑状态；文件/工作区切换先等待用户决定。顶部产品模式切换也走同一守卫。
5. 主进程 `before-quit` 与 preload 建立退出确认握手：主窗口在托盘退出时先显示并等待渲染层完成编辑守卫，确认后才真正退出。
6. 边界情况：iframe `load` 后重新握手；编辑态下 `isDirty` 徽标改为“有未保存修改”；`Esc` 取消选中、`Ctrl+S` 显式保存。

## 待验证 / 风险

- **编辑文档隔离**：iframe 继续使用 `allow-scripts`，不放开同源；父页面与编辑文档只通过 `postMessage` 协作。新增资源仍在已授权工作区根目录内，并携带 `no-store`。
- **JS 重渲染页面**：动态脚本改 DOM 的页面序列化结果与源文件差异大，必要时只序列化 `<body>` 或限定可编辑容器。
- **大文件**：`outerHTML` 序列化是字符串拷贝，MB 级 HTML 在保存与写盘时有可见延迟；当前沿用工作台的大文件加载保护，未单独增加分块写。
- **跨容器拖拽**：本期不做（语义与样式继承复杂），仅同父容器内排序。

## 验收标准

- 载入单文件 HTML → 开编辑模式 → 文字可直接改、卡片可拖拽换位、`＋` 可新增同款卡片、交互按钮删挪被置灰、JS hover 弹层冻结而 CSS `:hover` 保留。
- 保存后文件内容与编辑结果一致，无 `__mve_*`/`draggable`/`contenteditable` 残留，且直接覆写原文件。
- 编辑态不触发自动保存；退出编辑模式、切文件、切工作区、关闭工作区、切到其他产品模式或从托盘退出应用时，未保存改动必须出现确认框。
- 确认框的取消保留编辑现场，放弃不写盘，保存并退出写回原文件后再离开。
- 只读预览和编辑 iframe 都不使用 `allow-same-origin`。
- 颜色菜单在外部点击、焦点移出、`Esc` 或窗口失焦后关闭；透明背景可从背景调色板直接选择。
