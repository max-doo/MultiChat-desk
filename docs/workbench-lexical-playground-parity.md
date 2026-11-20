# 工作台富文本编辑器：对齐 Lexical Playground 交互

> Created: 2026-11-20 10:05 (Asia/Shanghai, UTC+08:00)

本文件记录 <https://playground.lexical.dev/> 的交互探索结果，以及工作台编辑器复刻这些交互的实现说明。Playground 源码位于 `meta/lexical` 仓库 `packages/lexical-playground`（已通过 sparse checkout 拉取参考）。

## Playground 交互清单（探索结论）

以下行为均在 playground 中实际验证或在其源码中确认（`plugins/ToolbarPlugin`、`ui/DropDown.tsx`、`plugins/FloatingTextFormatToolbarPlugin`、`plugins/ShortcutsExtension/shortcuts.ts`）：

### 顶部工具栏

- **撤销/重做**：绑定 `CAN_UNDO_COMMAND` / `CAN_REDO_COMMAND`，无可用历史时按钮置灰（`disabled`）。编辑器只读时整体禁用。
- **段落格式下拉**：按钮文本回显当前选区的块类型（Normal / Heading 1-3 / Bulleted List / Numbered List / Check List / Quote / Code Block）。再次点击当前类型会切回 Normal。
- **行内格式按钮**：Bold / Italic / Underline / Strikethrough / Inline Code / Link 均按选区 `selection.hasFormat()` 显示 active 高亮。Code 实际是 `format_text` 的 `code` 标记（行内代码），Code Block 在段落格式下拉里。
- **链接**：光标不在链接内时按钮为"插入链接"；在链接内时按钮高亮，点击直接移除链接（`TOGGLE_LINK_COMMAND null`），不弹输入框。快捷键 Ctrl+K。
- **对齐方式**：下拉回显当前 `element.getFormatType()`，四项：左 / 居中 / 右 / 两端。
- **下拉的打开方式**：`ui/DropDown.tsx` 用 `createPortal` 将菜单挂到 `document.body`，`position: fixed` 按触发按钮 `getBoundingClientRect()` 定位——这是解决"菜单被容器裁剪"的标准做法。菜单打开时自动高亮第一项并支持 `ArrowUp`/`ArrowDown` 循环移动焦点、`Esc`/`Tab`/点击外部关闭，关闭后焦点返回触发按钮。

### 选中浮动格式条

`FloatingTextFormatToolbarPlugin`：出现条件为"非折叠 RangeSelection + 选区含文本 + 不在代码块内"。工具条默认位于选区矩形**上方** 10px、左对齐 -5px；贴近编辑器顶部时翻转到选区下方；横向溢出时向内收敛。选区或滚动变化时实时重算 `transform: translate(x, y)`，隐藏时用 `translate(-10000px)` 而非 `display:none` 避免布局抖动。

### 键盘快捷键（SHORTCUT_BINDINGS）

| 功能 | Windows/Linux | macOS |
| --- | --- | --- |
| 正文段落 | Ctrl+Alt+0 | ⌘⌥0 |
| H1 / H2 / H3 | Ctrl+Alt+1/2/3 | ⌘⌥1/2/3 |
| 有序 / 无序 / 待办 | Ctrl+Shift+7 / 8 / 9 | ⌘⇧7/8/9 |
| 代码块 | Ctrl+Alt+C | ⌘⌥C |
| 引用 | Ctrl+Shift+Q | ⌃⇧Q |
| 删除线 | Ctrl+Shift+X | ⌘⇧X |
| 小写 / 大写 / 首字母 | Ctrl+Shift+1/2/3 | ⌃⇧1/2/3 |
| 居中 / 两端 / 左 / 右对齐 | Ctrl+Shift+E/J/L/R | ⌘⇧E/J/L/R |
| 下标 / 上标 | Ctrl+, / Ctrl+. | ⌘, / ⌘. |
| 缩进 / 减少缩进 | Ctrl+] / Ctrl+[ | ⌘] / ⌘[ |
| 清除格式 | Ctrl+\ | ⌘\ |
| 插入链接 | Ctrl+K | ⌘K |
| 加粗 / 斜体 / 下划线 / 撤销 | Ctrl+B/I/U/Z | ⌘B/I/U/Z |
| 重做 | Ctrl+Y 或 Ctrl+Shift+Z | ⇧⌘Z |
| 字号增 / 减 | Ctrl+Shift+. / Ctrl+Shift+, | ⌘⇧. / ⌘⇧, |

### 未复刻项（有意裁剪，与本项目无关）

字体家族/字号下拉、文字与背景色板、Ruby 注音、图片/Excalidraw/投票/YouTube/Twitter 嵌入、分页布局、评论、协作编辑、语音输入、目录树、调试树视图、Markdown/HTML 导出按钮、查找替换等。工作台只保留"所见即所得 Markdown 写作"所需的核心格式化能力，其余属于 playground 的 demo 特性。

## 本次实现

改动全部位于 `src/renderer/src/components/workbench/`：

- `WorkbenchDropDown.tsx`（新增）：通用下拉组件，移植 `ui/DropDown.tsx`——`createPortal` 到 body、`fixed` 定位防裁剪、打开后自动高亮首项、`ArrowUp/Down`/`Esc`/`Tab`/外部点击关闭、关闭后焦点还给触发按钮。
- `WorkbenchToolbar.tsx`（重写）：段落格式与对齐下拉改用新组件；新增选区状态跟踪（`$updateToolbar`，监听 `SELECTION_CHANGE`/`CAN_UNDO`/`CAN_REDO`/`registerUpdateListener`），块类型按钮文本回显当前块，列表/引用/代码块再点切回段落；行内格式按钮与链接按钮加 active 态；撤销/重做按 `canUndo`/`canRedo` 禁用；删除手动保存按钮（自动保存由 store 1200ms 防抖承担，状态指示保留"保存中/保存失败/已保存"）。
- `WorkbenchFloatingToolbarPlugin.tsx`（新增）：移植 `FloatingTextFormatToolbarPlugin`——非折叠文本选区上方浮动 B/I/U/S/Code/Link 工具条，超出视口自动翻转/收敛。
- `WorkbenchDraggableBlockPlugin.tsx`（新增）：移植 `DraggableBlockPlugin` + `ComponentPickerPlugin`——拖拽 handle 左侧加 "+" 按钮，点击弹出"在该块下方插入"的块类型选择菜单（含 `Filter blocks...` 搜索、`NxM` 动态表格、键盘上下/回车导航、Alt/Ctrl+点击改为上方插入）。
- `WorkbenchEditor.tsx`：挂载浮动工具条插件（锚定到 `max-w-[860px]` 画布容器）；删除 Ctrl+S 全局快捷键与源码模式下的保存按钮；源码模式顶部保留"返回富文本"与状态/统计。

### 第二轮调整（2026-11-20）

- 顶部"富文本/源码"分段改为"预览/源码"；源码模式顶部返回按钮同步改为"返回预览"。
- 整体 UI 放大：顶部工具栏 `h-10→h-12`，按钮 `w-7 h-7→w-8 h-8`，图标 `text-[17/18px]→text-[20px]`，文字 `text-xs→text-sm`；左侧文件树同步放大（行高 `py-1→py-1.5`、图标 16/17→19px）；预览器（图片/PDF）顶栏同步放大；编辑器正文字号 15px→16px、画布宽度 860px→900px、左侧留白给 "+"+拖拽双按钮让位。

### 第三轮调整（2026-11-20）

- **渲染主题整体替换为 playground `PlaygroundEditorTheme`**：`WorkbenchEditor` 中 `lexicalTheme` 不再用 Tailwind 类名，改为直接引用 `PlaygroundEditorTheme__*` 类名（段落/标题/引用/代码块/列表/表格/分割线/行内格式/链接），对应样式规则写入 `src/renderer/src/assets/index.css`（含暗色适配）。移除 `prose` 排版类避免与主题样式冲突。h1/h2/h3 现在是 playground 的 24px 正文级 / 16px 灰字加粗 / 12px 大写，与之前的中文笔记风格不同，这是 playground 的真实观感。
- **表格**：新增 `WorkbenchTableCellResizerPlugin.tsx`（移植 `plugins/TableCellResizer`，单元格右侧/下侧拖拽条改列宽行高，portal 到 body），主题含 `tableCellResizer`/`tableCellSelected`/`tableSelection`/`tableRowStriping`/`tableScrollableWrapper`/`tableAlignment` 全套类。
- **"+" 菜单**：移除筛选输入框与 `NxM` 动态表格选项，只保留固定块类型列表（正文/三级标题/表格/三种列表/引用/代码块/分割线），键盘与点击交互不变。

### 第四轮调整（2026-11-20）

- **标题分级与样式**：playground 原版 h2 是"灰字 + 全大写"，中文环境下观感差，本轮改为更符合中文笔记的层级——h1=24px 加粗带浅色下边框、h2=20px 加粗带浅色下边框、h3=17px 加粗、h4–h6=14px 加粗（所有标题统一 `font-weight: 700`，h2 颜色回正文色）。无序列表圆点修复：显式 `list-style-type: disc`（Tailwind preflight 会重置 `ul` 默认样式），嵌套 `ul` 用 `ulDepth` 主题给 circle/square。
- **行内代码/代码块圆角**：行内代码 `border-radius:4px`、代码块 `border-radius:8px`（playground 为直角，按用户要求加圆角）。
- **文本高亮**：`format_text` 的 `highlight` 位 mask 早已存在（`==text==` Markdown 短语法天然支持，HIGHLIGHT transformer 在 TRANSFORMERS 内）；本轮补主题类 `PlaygroundEditorTheme__textHighlight`（黄色底）+ 顶部工具栏与浮动工具条各加一个 `ink_highlighter` 按钮（带 active 态）。
- **源码模式**：删除"返回预览"按钮（顶部 tab 已可切换）；改为 `WorkbenchSourceEditor`——透明 `textarea` 叠加 Prism `markdown` 语法高亮 `<pre>` + 左侧行号槽（滚动同步），高亮配色按 VSCode GitHub light/dark 风格写入 index.css。
- **保存状态**："已保存"从"绿点+绿字"改为纯灰色文字，去点。

### 第五轮调整（2026-11-20）

- **表格 Markdown 序列化**：`@lexical/markdown` 默认 `TRANSFORMERS` 不含表格转换器，之前插表在源码里只导出空段落、切回即消失。移植 playground `plugins/MarkdownTransformers` 的 `TABLE` `ElementTransformer` 进 `MarkdownSyncPlugin.tsx`，表格现在以 GFM `| a | b |` + `| --- |` 分隔行双向转换（表头行用 `headerState.ROW` 标记）。
- **表格行列增删**：新增 `WorkbenchTableActionMenuPlugin.tsx`（移植 `plugins/TableActionMenuPlugin` 裁剪版）——光标进入单元格时右上角浮出 `∨` 按钮，菜单含：合并/拆分单元格（TableSelection 多选时）、上/下插行、左/右插列、删行/删列/删表、行/列表头切换、斑马纹切换。菜单 `createPortal` 到 body、按按钮 rect 定位、溢出自动翻左、外部点击关闭。

### 第六轮调整（2026-11-20）

- **下拉菜单跳动修复**：portal 菜单的定位逻辑原来在 `useEffect`（绘制后执行），叠加自定义 `animate-in` 入场动画导致用户先看到菜单出现在页面顶部、再瞬移到按钮旁。改为 `useLayoutEffect`（浏览器绘制前同步完成定位），并移除 animate-in 类与 playground 一致（playground 下拉无入场动画）。`WorkbenchTableActionMenuPlugin` 与 `WorkbenchFloatingToolbarPlugin` 的定位 effect 同样改用 `useLayoutEffect`。
- **标题层级**：按 16px 正文 × typographic scale 重排——h1=28px（段前 1.5em+下边框）、h2=22px（段前 1.4em+下边框）、h3=18px（段前 1.2em）、h4–h6=16px（段前 1em），全部 `font-weight:700`；文档开头第一个标题 `margin-top:0` 豁免。


### 第七轮调整（2026-11-20）

- **分割线支持**：`@lexical/markdown` 的 `TRANSFORMERS` 自带 HR 只在"行尾空格后触发"时才转换；playground 自定义的 `HR` transformer 额外开启 `triggerOnEnter: true`，使 `---`/`***`/`___` 输入后按 Enter 即转换，且末尾行改为 `insertBefore` + `selectNext()` 保证光标落点。已将 playground 版 HR 逻辑移植到 `MarkdownSyncPlugin.tsx` 的 `HR_TRANSFORMER`。
- **分割线视觉加粗**：主题 `.PlaygroundEditorTheme__hr` 由 `height:2px; background:#ccc; margin:1em 0` 改为 `height:2px; background:#b9bfc7; border-radius:999px; margin:1.5em 0`（暗色 `#5d6470`），保持 2px 高度、用更深色+大留白体现比标题 `border-bottom:1px #e5e7eb` 更重的层级，避免 3px 版本过重。
### 保存行为

保存完全依赖 `workbenchStore.updateActiveContent` 中的防抖自动落盘（1200ms），无任何手动入口。状态栏仍显示 `saving`/`error`/`saved` 三种状态；未保存态不再单独呈现"未保存"标签。

### 验证

`npx tsc --noEmit -p tsconfig.web.json`（workbench 相关零错误，其余为存量告警）、`npx eslint` 涉及文件零告警、`npm run build` 成功。实际交互需在 `npm run dev` 中验证：下拉不被裁剪、块类型回显、浮动条定位、防抖保存。
