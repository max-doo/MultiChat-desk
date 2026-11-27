> Created: 2026-11-27 16:17 (Asia/Shanghai)（2026-11-27 16:43 按用户决策重构：本期只做预览，编辑延后）

# 工作台 Office 文档预览与编辑开发方案（Word / Excel / PPT）

## 0. 本期范围决策（2026-11-27 用户确认）

**本期只做预览补齐，不做编辑功能**。具体：

- `.xlsx` / `.pptx` 新建应用内预览（目前两者只有提示卡片）；
- 两种新预览都必须支持**选中内容并发送给 AI 处理**（复用 docx 预览已有的划词链路）；
- `.docx` 预览维持现状，不动；
- 编辑功能（有损重写 / 闭环生成 / 保真 patch）整体延后。用户决策背景：有损重写会必然丢失文档结构层格式（docx 页眉页脚/批注/修订，xlsx 图表/条件格式/冻结窗格），在保真问题有更成熟的路线之前不开放编辑入口。

编辑方向的完整调研与设计保留在附录 A，后续重新启动编辑功能时直接续用，不重新调研。

## 1. 背景

工作台三种 Office 格式现状：`.docx` 已有基于 `docx-preview` 的高保真只读预览（分页重流、WMF/EMF 转换、大纲导航、字数统计、划词发送 AI）；`.xlsx`/`.pptx` 只有 `WorkbenchDocxCard` 提示卡片，引导用户用系统程序打开。本期把后两者的预览补齐到与 docx 同等的可用水位。

关键约束（2026-11-27 库调研实测结论，详见附录 A）：

- 预览是只读场景，**不参与有损重写的任何取舍**，库选型只需考虑解析能力与体积；
- npm 的 `xlsx@0.18.5` 停在 2023 年且有已知 CVE，用活跃分支 `@e965/xlsx`（Apache-2.0）；
- pptx 没有成熟轻量读入渲染器，预览走 jszip 定向提取的自研路径，定位为**内容预览**而非拟真渲染；
- 字节读取通道目前只有 `readDocxBytes`（硬编码 `.docx` 校验），xlsx/pptx 连字节都拿不到，必须先行泛化。

## 2. 总体方案

### 2.1 架构

```
main 进程
 └─ workbenchService: readOfficeBytes（readDocxBytes 泛化：
     扩展名白名单 .docx/.xlsx/.pptx + 统一 10MB 上限，
     IPC 通道 workbench:read-office-bytes，原 read-docx-bytes 兼容保留或合并迁移）

renderer（全部动态 import，不进首屏主 chunk）
 ├─ WorkbenchXlsxPreview（新建：@e965/xlsx 解析 + 表格渲染）
 └─ WorkbenchPptxPreview（新建：jszip 提取 + HTML 绝对定位渲染）
```

路由：`WorkbenchEditor` 在 `category === 'document'` 分支内按扩展名分发——`.docx` 走现有 `WorkbenchDocxPreview`，`.xlsx` 走 `WorkbenchXlsxPreview`，`.pptx` 走 `WorkbenchPptxPreview`，其余（`.doc/.xls/.ppt` 老 OLE 格式、`.odt/.odp` 等）继续落 `WorkbenchDocxCard` 卡片。老 OLE 格式不是 zip 容器，jszip 无法解析，本期不做；解析失败（含加密文件）统一落卡片兜底。

### 2.2 体积预算（gzip，2026-11-27 本机 esbuild 实测）

| 库 | 实测 gzip | 加载时机 |
| --- | --- | --- |
| `@e965/xlsx` | ~140 KB（按 xlsx 0.18.5 实测，版本相近） | 首次打开 xlsx |
| jszip | 30 KB | 首次打开 pptx |
| 合计 | **~170 KB** | 两个独立异步 chunk，首屏增量 0 |

与编辑方案相比缩减了一个数量级（原编辑方案含 FortuneSheet 单库 604 KB）。`manualChunks` 拆为 `office-xlsx`、`office-ppt` 两个 chunk 互不阻塞。
## 3. Excel 预览技术方案（`.xlsx`）

### 3.1 解析与渲染

- 解析：`@e965/xlsx` 的 `read(arrayBuffer)` → `sheet_to_json(sheet, { header: 1, raw: false, defval: '' })` 得二维数组。解析放入 Web Worker（大表 XML 解包与字符串处理在主线程会造成可感卡顿），结果以 transferable 回传。
- 渲染分两档（合并单元格是分水岭）：
  - **小表**（行 × 列 ≤ 5000 单元格）：普通 `<table>` 全量渲染，按 sheet 的 `!merges` 补 `colSpan/rowSpan`，合并单元格视觉正确，整表任意可选中；
  - **大表**：`react-virtuoso` 虚拟滚动（已在依赖内，无新增），**忽略合并**（合并结构与虚拟行高模型冲突，是已声明的取舍），仅视口内行可选中复制。列数过多（>50 列）时启用横向滚动，列宽按内容采样前 200 行估算并设上限。
- sheet 切换：顶部 tab 条，惰性解析——只在切到某 sheet 时才对那张表跑 `sheet_to_json`，避免打开即全量解析所有 sheet。
- 样式：不还原单元格样式（颜色/边框/字体），统一用工作台表格样式呈现，定位是**读数据**。表头首行视觉加粗冻结（`position: sticky`）。

### 3.2 选中与发送 AI

选中链路与 docx 预览同构，但针对表格有一个关键增强：**发送给 AI 的文本转 Markdown 表格**。

- 容器挂 `onMouseUp` 读 `window.getSelection()`，**校验选区公共祖先落在本预览容器内**（防止把文件树/编辑器选区误判为表格内容，`WorkbenchDocxPreview` 已有同款守卫）；
- **Markdown 表格转换（新增 `workbenchTableSelection.ts` 定向工具，约 80 行）**：`range.cloneContents()` 克隆选区 DOM 后遍历 `tr/td/th` 重建行列网格，输出 Markdown 表格——首行作表头，单元格内 `|` 转义为 `\|`、换行折叠为空格；合并单元格（colSpan/rowSpan）按覆盖区域重复填充值，保证网格矩形化。选区不含任何表格单元格时（理论上不会发生在本组件，作防御）回退 `selection.toString()` 纯文本。与 `shared/utils/htmlToMarkdown.ts` 的关系：那是 webview 注入形态的通用转换器，不可 import 复用；本工具是表格选区专用的定向实现，不复用但同样放 shared 之外的 renderer utils。
- 为什么转 Markdown 而不是纯文本：`getSelection().toString()` 会损失列边界，单元格文本内的空格让 AI 无法可靠切列；Markdown 表格是多平台 AI 理解最稳的结构化表格表达，且在侧边栏输入框与多数平台的渲染中都可读。
- 非空时右下角浮出"已选 N 字"气泡（发送 AI / 解释 / 要点 / 复制四键）+ 右键 `onContextMenu` 弹 `WorkbenchSelectionMenu`；动作统一走 `workbenchStore.askAi(markdownText, action)`，无新增 IPC；处理 `insertText` 返回 `{success:false}` 的侧边栏未就绪兜底。
- **复制动作不走 Markdown**：`copy` 保留系统剪贴板默认行为（Chromium 对 table 选区自带 TSV/HTML 富格式），用户粘贴到 Excel/Sheets 能保持行列结构；Markdown 转换只作用于发送 AI 的三个动作。
- **单元格区域框选**（Excel 式拖矩形选一片单元格、结构化拼文本）列为可选增强项，本期不做。

### 3.3 边界

- `.xls`（OLE 老二进制）：落卡片，不解析（`@e965/xlsx` 虽声称支持 xls，但 OLE 解析路径在浏览器侧不稳定，本期不开放）。
- `.xlsm/.xltx`：同 xlsx 处理（zip 容器一致），宏不执行只读数据。
- 公式：显示缓存的计算值（`raw: false` 走格式化文本），不解析公式本身。
- 超限（>10MB）/ 加密 / 解析异常：落 `WorkbenchDocxCard` 卡片兜底。

## 4. PPT 预览技术方案（`.pptx`）

### 4.1 解析与渲染

- 解析（Web Worker 内）：jszip 解包 → `ppt/presentation.xml` 取画布尺寸（`p:sldSz`，EMU 单位）与幻灯片顺序 → 逐张解析 `ppt/slides/slideN.xml`：文本框/占位符的坐标（`a:off`/`a:ext`）、文本内容（`a:p` 段落 + `a:r` run，提取字号/粗体/颜色的**直出值**，不解算完整主题级联）、图片引用（经 rels 映射到 `ppt/media/*`，转 blob URL）、简单表格（`a:tbl` 按文本块处理）。形状 geometry、主题、母版装饰、动画、SmartArt、图表**不还原**——定位是内容预览：能读清每张幻灯片的文字与配图、看懂结构。
- 渲染：**HTML 绝对定位**而非 SVG。外层按比例缩放的 slide 容器（白底卡片，纵向滚动排列，与 docx 分页预览的阅读节奏一致），内部每个文本框/图片一个绝对定位 `div`。选 HTML 的决定性理由正是本期的选中需求：HTML 文本**原生可选中**，SVG `<text>` 的选区跨元素行为在 Chromium 下不可靠，还要额外写命中检测与选区重组——为只读预览不值。
- 缩放：slide 按容器宽度等比缩放（transform scale），与 docx 预览的 fitToWidth 同款思路但更简单（EMU→px 是固定比例换算）。

### 4.2 选中与发送 AI

与 Excel 完全同一条链路：`onMouseUp` + 容器内选区校验 + 气泡/右键菜单 + `askAi`。跨文本框的连续选中由浏览器原生支持（都在同一 DOM 树），无需自研。

### 4.3 边界

- `.ppt`（OLE 老格式）：落卡片。
- 文字重叠/占位符继承缺失导致的布局偏差属已知取舍，UI 不做"拟真预览"宣传；预览头部保留"系统打开"入口方便查看原版式。
- 图片 blob URL 在组件卸载/切文件时全部 `URL.revokeObjectURL` 回收（`revokeDocxBlobUrls` 同款）。

## 5. 内存控制

- 文件字节只在预览组件 effect 内流转，不进全局 store；Worker 用后 `terminate()`。
- xlsx 大表：二维数组按 sheet 惰性生成，非活跃 sheet 的 JSON 在切走时不保留（重新切回重新生成，解析结果 workbook 对象本身常驻会话期间）。
- pptx：media blob URL 随组件销毁回收；幻灯片数量无上限问题（单页 DOM 量小，百页级 PPT 全量渲染无压力，实测后再决定是否需要分页惰性渲染）。
- 连续打开/关闭 10 份大文件做内存回归验收（堆内存回落基线 ±20%）。
## 6. 实施步骤（本期）

| 步 | 内容 | 出口标准 |
| --- | --- | --- |
| S1 | `readDocxBytes` 泛化为 `readOfficeBytes`（扩展名白名单 + 统一上限）+ IPC/preload 契约同步（`ipcHandlers.ts` / `preload/index.ts` / `index.d.ts` / `env.d.ts`） | docx 预览回归无损 |
| S2 | xlsx 预览：Worker 解析 + 两档渲染 + sheet 切换 + 划词链路 | 真实 xlsx 样本可滚可读可选可发 AI |
| S3 | pptx 预览：Worker 解包 + HTML 绝对定位渲染 + 图片 blob + 划词链路 | 真实 pptx 样本文字图片可读、可选可发 AI |
| S4 | 路由分发 + 老格式/加密/超限兜底 + manualChunks 分包验证 | 首屏无 office 库、兜底路径正确 |

依赖：`@e965/xlsx`、`jszip` 两个新生产依赖（渲染层使用，进 devDependencies 随 electron-vite 打包，与现有库同处理）。

涉及文件预估：

- 改：`src/main/services/workbenchService.ts`（readOfficeBytes 泛化）、`src/main/ipcHandlers.ts`、`src/preload/index.ts`、`src/preload/index.d.ts`、`src/renderer/src/env.d.ts`（如需）
- 改：`src/renderer/src/components/workbench/WorkbenchEditor.tsx`（按扩展名分发）
- 新：`src/renderer/src/components/workbench/WorkbenchXlsxPreview.tsx`、`WorkbenchPptxPreview.tsx`、`src/renderer/src/workers/officePreviewWorker.ts`、`src/renderer/src/utils/workbenchTableSelection.ts`（选区 DOM → Markdown 表格）
- 改：`electron.vite.config.ts`（manualChunks）
- 改：`package.json`（两个依赖）

## 7. 验收标准

- `.xlsx` 打开后直接内嵌渲染：小表合并单元格正确、整表可选；大表虚拟滚动流畅（万行级）、视口内可选；多 sheet 可切换。
- `.pptx` 打开后按页展示文字与图片，布局接近原版式（允许偏差）；跨文本框连续选中可用。
- 两种格式选中后气泡与右键菜单可用，"发送 AI / 解释 / 要点 / 复制"四动作真实到达侧边栏输入框；侧边栏未就绪时有可见兜底提示。Excel 选区发送 AI 的文本为合法 Markdown 表格（首行表头、列数矩形化、管道符转义），复制动作保持系统富格式不受影响。
- `.docx` 预览零回归（分页/大纲/统计/WMF/EMF/划词）。
- 老格式 `.doc/.xls/.ppt`、加密文件、超限文件落卡片，无报错弹窗。
- 内存：连续打开关闭 10 份大文件后堆内存回落基线 ±20%。
- `pnpm run build` 后主 chunk 不含 `@e965/xlsx`/`jszip`；`pnpm run lint` 与定向 tsc 通过；`pnpm run dev` 真实窗口人工验收。

## 8. 风险

1. **xlsx 大文件解析峰值**：Worker 内 `sheet_to_json` 全量字符串化对超大 sheet 仍有一次数倍内存峰值，靠 10MB 上限 + 超限卡片兜底控制。
2. **pptx 布局偏差引发预期差**：文字框继承自 layout 的坐标缺失时会落在默认位置——spike 阶段用 3-5 份真实 pptx 验证"大部分幻灯片可读"即达标，不追求版式还原。
3. **加密/损坏文件的报错噪音**：解析异常统一捕获落卡片，不向用户抛技术错误。
4. **obfuscation 构建耗时**：`createObfuscationPlugin` 对所有 chunk 混淆，`@e965/xlsx` chunk 会拉长构建时间，落地时验证一次，不可接受再针对性排除。

---

## 9. 范围扩展：CSV/TSV 表格预览（2026-11-27 用户追加，已落地）

用户在 xlsx/pptx 验收后追加需求：CSV 文件也要支持表格预览，分**预览视图（表格）与源码视图**两种视图，且**表格预览必须用浅色模式**。TSV 同链路覆盖。

### 9.1 方案要点

- **共享渲染器抽取**：xlsx 预览的两档表格渲染（小表全量 + 合并/sticky 表头，大表 TableVirtuoso 虚拟滚动）连同划词转 Markdown 链路抽取为 `WorkbenchDataTable.tsx`，xlsx 与 csv 同源复用，调用方只负责把数据矩形化。
- **解析器**：`src/renderer/src/utils/csvTable.ts` 手写状态机（不引第三方库），覆盖 RFC4180 核心规则：双引号转义、引号内逗号/换行保留、ragged 行矩形化、BOM 剥离、分隔符按表头行频率在 `, ; \t` 间自动探测（.tsv 误命名也稳）、孤立引号容错。
- **路由**：csv/tsv 本就落在 text 分类 → `WorkbenchCodePreview`，在其中扩展 `viewMode` 状态机加入 `table` 档（HTML 的 渲染/编辑/源码 同族），源码态即文本编辑（同 HTML 源码语义，Ctrl+S 保存），表格态只读。切换视图前 flush 防抖同步，表格永远渲染用户当下编辑态。
- **浅色模式**：text 分支根容器此前硬编码 `dark` 强制类，导致 `dark:` 变体无条件生效、表格呈现黑底深字不可读。将 store 的 `htmlRenderSurface` 泛化重命名为 `lightPreviewSurface`（语义即浅色内容表面），csv 表格态上报浅色，宿主容器与顶栏 chrome（分段控件/按钮/文字色）同步切浅色系；源码态保持深色编辑器 chrome，与全部代码文件惯例一致。
- **GBK 编码**：`workbenchService` 的文本解码链新增 UTF-8/16 BOM 检测 + csv/tsv 非法 UTF-8 时 GBK 回退（iconv-lite 已在依赖）；已声明取舍：编辑保存统一写回 UTF-8。
- **多行单元格**：含 `\n` 的单元格（引号内换行）在 `WorkbenchDataTable` 中带 title 提示完整内容，与超长截断同规则。

### 9.2 验收（全部通过）

- 静态 harness（`scripts/verify_office_previews.py`）T12–T17：引号边界/换行单元格/浅色 chrome（data-reader-theme、toolbar light、白底）、源码编辑→表格联动→Ctrl+S 写回、划词转 Markdown（竖线转义）、large.csv 万行虚拟滚动、TSV 分列、UTF-8 BOM 剥离；T1–T11 xlsx/pptx/docx 回归零损失。
- 实机 CDP（隔离 profile + MULTICHAT_DEBUG_PORT）L1–L8：GBK 中文无乱码（主进程 iconv-lite 链）、浅色模式、划词气泡、源码编辑写回真实磁盘、大表虚拟滚动、xlsx 回归。证据 `scratch/office-preview-acceptance/live-*.png`。
- 注意点：dev 模式下应用按 `MULTICHAT_DEBUG_PORT || 9223` 自绑 CDP 端口，CLI 传参无效；僵尸实例持单例锁时新实例静默退出，必须先清干净。

---

## 10. 表格预览 Excel 化（2026-11-27 用户追加，已落地）

用户要求：表格预览视图样式与 Excel 保持一致，交互参照 Excel 的单元格和行列选中操作。xlsx/csv 共用的 `WorkbenchDataTable` 全部重写。

### 10.1 方案要点

- **交互模型换代**：弃用浏览器 DOM 文本选区，改为数据驱动的单元格范围选区（锚点/焦点 {r,c} 对）。网格化与序列化直接读数据数组，大表虚拟滚动下未渲染的行也能正确进入选区与导出——这是 DOM 选区方案做不到的。
- **chrome**：列字母表头（A…Z/AA 进制换算）+ 行号列 + 左上角全选格，全部 sticky 冻结；首行不再有"表头"特殊地位，全部行都是数据行（Excel 语义）。
- **选中**：点选/拖选矩形、行列头整行整列（按下可横扫扩列扩行）、Shift+点击扩选、合并单元格触及即迭代扩张整区入选；拖到视口边缘自动滚动（帧驱动 hit-test，指针不动也持续推进），大表可拖选任意远处。
- **视觉**：选中范围灰底 #e9e9e9 + 周圈 1px 绿框（inset box-shadow 按边缘拼合），活动格白底 + 2px 完整绿框 #107c41；行列头联动高亮（深灰底 + 绿色加粗字）。
- **导出**：复制（气泡/右键/Ctrl+C）统一 TSV，可直接粘贴进 Excel 成结构；发送 AI 为矩形化 Markdown 表格（首行作表头是语法强制）。Excel 复制语义：合并区域的值只在锚点位置，覆盖格为空。
- **AI Markdown 表头语义（2026-11-27 用户明确）**：发送 AI 的表头固定取**表格第 1 行（数据行 0）**在选区列范围内的切片，而不是选区首行——用户语义里"表格的表头"是文件首行。选区含第 1 行时二者自然重合（不重复进数据行）；表头切片全空时（xlsx 合并标题行只覆盖部分列）回退选区首行保证合法表格。TSV 复制不受此规则影响，始终只含选中内容（Excel 粘贴语义）。
- **右键语义**：落在选区内保持原选区弹菜单；落在选区外先改选该格再弹菜单。
- **hook 扩展**：`useWorkbenchSelectionAi` 新增 `captureOverride` 程序化选区通道，表格走此通道完全绕过 DOM 选区；docx/pptx 预览的浏览器文本划词链路不受影响。

### 10.2 验收（全部通过）

- 静态 harness T17 专项：拖选矩形高亮格数/活动格绿框/周圈框、Ctrl+C TSV 矩形结构（竖线不转义、制表符分列）、整列/整行/Shift 扩选、合并 A5:B6 扩张复制（锚点有值覆盖格空）、右键改选发送 AI、large.csv 边缘滚选（焦点行 0→43）；T1–T16 既有项零回归，T18 无 console error。
- 实机 CDP L9/L10：拖选/整列/chrome/气泡、边缘滚选（焦点行 0→45）。
- 证据 `scratch/office-preview-acceptance/t17-excel-interactions.png`、`live-excel-interactions.png`、`live-excel-edge-scroll.png`。
- 独立 worker 验收 + 返修复核（2026-11-27）：第一轮发现 hit-test 在滚动条带与网格空白区失效（边缘滚选冻结）、Escape 后气泡与高亮状态脱节；返修为探针式夹紧（指针位置先夹紧到「表格矩形 ∩ 滚动容器客户区」再 elementFromPoint）与 Escape 同步清空选区。复核全部通过：横向滚选跨滚动条带（0→19 列）、四向边界钳制、virtuoso 正反向滚选、Escape 三层状态同步清零。
- 明确不做：Ctrl+点击多区域选区（multi-range，只读预览场景收益不抵复杂度）；反向滚选恒速参数特性不调整。

---

## 附录 A：编辑功能调研与设计存档（本期不实施，后续续用）

> 以下为 2026-11-27 编辑方案调研与独立评审的完整结论。重新启动编辑功能时，应先重读本节并验证库版本是否漂移。

### A.1 编辑保真度三种模式

- **有损重写**：导入保留语义结构与尽力而为的直出格式，保存时用生成库重造文件。**必然损失**（不是"可能"）：docx 的页眉页脚/分节/页码/目录域/批注/修订/样式表；xlsx 的图表/图片/条件格式/数据验证/冻结窗格/打印设置。正文视觉层（字体/字号/颜色/对齐/表格/图片）能否保住取决于导入链对具名样式级联的解算能力。
- **闭环生成**：本应用内创建的文档，源 JSON 内嵌文件（pptx 用 jszip 后处理注入 customXml part，不用 sidecar——`.multichat/office/` 无重命名迁移挂钩，sidecar 会孤儿化），编辑零损失。
- **保真 patch**：不经编辑器，jszip 直接 XML 级修改（批量替换/占位符填充），格式 100% 保留，是 Agent 批量处理通道。

### A.2 库调研实测结论（2026-11-27）

- `docx`（9.16.1）、`pptxgenjs`（4.0.1）：**纯生成库，无读取 API**。
- `mammoth`（1.13.0）：内部模型解析了 font/fontSize/color/highlight/alignment/indent（body-reader.js 确认），但默认 HTML 输出全部丢弃；`transformDocument` 只能救直出格式，**具名样式级联救不回**。
- `@fortune-sheet/react`（1.0.4，gzip 604 KB）：导入依赖 2023 年停更的 luckyexcel，**导出链生态缺失**；undo/redo 官方 FAQ 称不支持但 dist 内有 undoList/handleUndo 结构，可用性存疑需实测；一年未发版。
- `@tiptap/core`+StarterKit+Table 实测 138 KB gzip，与项目已有 Lexical 0.53 功能重复，不引入。
- 实测体积：mammoth 91 KB / docx 67 KB / docx-preview 50 KB / pptxgenjs 123 KB / jszip 30 KB / xlsx 0.18.5 140 KB（gzip）。
### A.3 编辑架构要点存档

- **双 tab 模型**：预览/编辑分离对齐 HTML viewMode；预览↔编辑切换不销毁编辑会话（用户编辑中切去看排版是高频需求）；离开守卫只拦截离开文件/关闭 tab。
- **保存链**：离开守卫复用的是交互与状态机（promise 化决策、六处调用点模式），save-and-leave 路径必须实现字节版 flusher 分叉（`editFlusher: () => bytes | string`）；写入沿用 temp+rename 原子模式 + `markWorkspaceSelfWrite` 抑制 watcher 自激；二进制冲突 UI 无 diff 可展示，简化为双方时间/大小 + 系统应用查看入口。
- **保存前备份**：首次保存某文件前复制原件到 `.multichat/office-backup/`（每文件留最近 3 份）——有损重写唯一的后悔药。
- **Word 导入 spike 候选四路线**：A. mammoth+transformDocument（只救直出格式）；B. 自研 OOXML 定向解析（400–600 行，唯一能完整解算样式级联）；C. docx-preview 渲染产物直喂 `$generateNodesFromDOM`（级联样式已被解算成 inline style、保真最高、体积零增量，但列表语义丢失）；D. hybrid 注入式保存——不重造 zip，只把 `docx` 库生成的新 document.xml 注回原文件 zip，页眉页脚/样式表/编号定义全保留，还能绕开具名样式级联问题，代价是关系管理（media/rels）复杂度中等偏上。**D 是显著降低有损重写损失的关键候选**。
- **Word 编辑内核**：复用 Lexical（playground 有现成字体/字号/颜色控件可搬），行高/段距需自定义 paragraph node 扩展。
- **Excel spike 对比项**：FortuneSheet（luckyexcel 导入 + `@e965/xlsx` 重建导出）vs 自研 virtuoso 数据网格降级方案；`xlsx-js-style` 列入对比可把基础样式保留从零拉到及格线；公式重算不做。
- **PPT 编辑**：仅闭环生成，存量 pptx 编辑 tab 禁用；画布自研（文本框/图片/基本形状/z-order/拖拽缩放）。
- **验收必备项**：生成文件在真实 Word/WPS/Excel 打开不出现修复对话框（zip 合规性只有真实 Office 软件能暴露）。

### A.4 独立评审记录（2026-11-27）

评审 worker 对照代码实证给出 5 阻塞 + 5 重要 + 5 建议，已全部吸收进 A.1–A.3：xlsx/pptx 字节读取 IPC 缺口、离开守卫保存链改造量、二进制冲突 UI 缺口、原子写必要性、老格式三级分发、具名样式级联盲区、FortuneSheet undo 表述修正、Excel 有损清单补全、sidecar 孤儿化、编辑会话跨 tab 存活语义。
