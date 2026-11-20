> Created: 2026-11-20 14:13 (Asia/Shanghai)

# 工作台 Office 文档预览开发方案（Word / Excel，最小依赖）

## 目标

在工作台文件树中点击 `.docx` / `.xlsx` 时，直接内嵌渲染文档内容，替代当前的"建议本地打开"占位卡片；并支持在预览区选中文字后，通过右键/浮动操作把选中内容发送到右侧 AI 侧边栏对话框。

PPT（`.pptx`）本期不做内嵌预览，保留现有卡片降级。

## 现状锚点（不重复建设）

- PDF：已实现，`WorkbenchPdfPreview` 用 Chromium PDFium + Blob `<object>` 内嵌渲染。
- Office：主进程 `workbenchService.readFile` 已对 `category === 'document'` 返回元信息（**但不读二进制、不回传 dataUrl**）；`WorkbenchDocxCard` 只是提示卡片。
- 发送链路：`workbenchStore.askAi(text, action)` 已实现"自动展开右栏 → 派发 `workbench:insert-prompt` → `WorkbenchAiSidebar` 调 `insertText` 注入输入框"（`useWebviewActions.insertText` 最终 `executeJavaScript` 写进 AI 平台输入框）。**选中文字发送只需调用这一个函数，无新增 IPC。**
  - **注意**：`insertText` 有 `isReady` 守卫——目标平台 webview 未挂载/未加载完成时返回 `{success:false}` 静默失败。划词发送必须处理返回值，失败时提示"侧边栏加载中"或先确保平台已挂载再重试。
- 选中交互：`WorkbenchCodePreview` 有现成模式——`onMouseUp` 读 `window.getSelection()`、浮动"已选 N 字"气泡、AI 菜单。

## 依赖选择（路线 B，最轻）

| 库 | 用途 | 体积（含传递依赖） | 说明 |
|---|---|---|---|
| `docx-preview` | docx → DOM | ~1.7MB | 只依赖 jszip；渲染为可选中 DOM，天然支持划词 |
| `xlsx` (SheetJS) | xlsx → JSON | ~1.0MB | npm 停在 0.18.5，只读够用；不引入重型表格库 |

合计约 **2.7MB**，不引 Konva / PDF.js / WASM。docx-preview 渲染成真实 DOM 元素，文字可被 `window.getSelection()` 捕获，是划词发送能成立的关键（这也是放弃 `docx-renderer`/WASM Canvas 方案的原因之一：Canvas 位图无法选中文字）。

## 实现步骤

### 1. 主进程：`workbenchService.readFile` 补 dataUrl

`src/main/services/workbenchService.ts` 的 `document` 分支目前只返回元信息。对 `.docx`/`.xlsx` 改为读取 Buffer 并回传 `dataUrl`；上限定 **10MB**（base64 膨胀 ~33%，20MB 文件实际传 ~27MB 字符串 + 解码，IPC 序列化与 `atob` 对 UI 线程有可见卡顿；docx 一般 <10MB），超上限 `isOversized: true` 走卡片兜底。

- 无新 IPC，`workbench:read-file` 契约不变，`WorkbenchFileInfo.dataUrl` 字段已存在。
- `.doc`/`.ppt`/`.odt` 等老格式不在白名单内，继续只回元信息 → 落卡片。

### 2. 渲染层：新增两个预览组件

`src/renderer/src/components/workbench/`：

- `WorkbenchDocxPreview.tsx`：`dataUrl → ArrayBuffer → docx-preview` 的 `renderAsync` 渲染进一个 `<div ref>` 容器。需配置渲染选项——`inWrapper:false` + `breakPages:false` 避免默认 A4 白底分页卡片，`ignoreWidth/ignoreHeight` 适配容器宽；外层套浅色（白）容器与工作台深色 shell 隔离（文档本就白底，不强行 invert）。工具栏壳沿用 `WorkbenchPdfPreview`。
- `WorkbenchXlsxPreview.tsx`：`xlsx.read(arrayBuffer)` → `sheet_to_json(header:1)` → `<table>` 渲染。**大表直接用已内置的 `react-virtuoso` 虚拟滚动**（普通 table 渲染千行会卡），顶部带 sheet 切换 tab。

两个组件容器统一加 `select-text`，并复用 CodePreview 的选中模式：

- `onMouseUp` 读 `window.getSelection()`，**须校验 `selection.anchorNode` 是否落在本预览容器内**（`getSelection()` 是全局的，会把文件树/编辑器里的选区误判为 docx 内容），`selectedText` 非空时右下角浮出"已选 N 字"气泡 + 动作按钮。
- **右键菜单为一期必做**（用户明确要"右键操作"）：容器挂 `onContextMenu`，右键时若 `getSelection()` 在本容器内非空则 `preventDefault` 弹自定义小菜单（复用 FileTree 的 `contextMenu` state 模式或 `CustomContextMenu`），放"发送到侧边栏 / 解释 / 总结"。气泡与右键并存，气泡作快捷提示、右键作主动作。
- 动作均调 `askAi(selectedText, action)`（`isCode=false` 走文本分支，`'ask'`/`'explain'`/`'summarize'` 模板就绪），**并处理 `insertText` 返回 `{success:false}` 的加载未完成兜底**。

### 3. 路由：`WorkbenchEditor` 分发

`WorkbenchEditor.tsx` 第 193-199 行附近：在 `category === 'document'` 内再按扩展名细分——`.docx` → `WorkbenchDocxPreview`，`.xlsx` → `WorkbenchXlsxPreview`，其余（含 `.pptx`/`.doc`/`.ppt`）仍走 `WorkbenchDocxCard`。

### 4. 边界与降级

- 超上限 / 解析失败 / 加密文档 → 显示现有 `WorkbenchDocxCard`（统一错误兜底）。
- `.docx` 中的图片资源经 docx-preview 内联 blob 渲染，CSP 需确认 `img-src blob:`（当前 `img-src 'self' data: https:`，**需补 `blob:`**，与 PDF 修复同一处）。
- `.doc`/`.ppt` 老二进制格式 docx-preview/xlsx 均不支持 → 保持卡片。

## 涉及文件

- 改：`src/main/services/workbenchService.ts`（document 分支读 dataUrl + 上限）
- 改：`src/renderer/src/components/workbench/WorkbenchEditor.tsx`（按 ext 分发）
- 改：`src/renderer/index.html`（CSP `img-src` 补 `blob:`，docx-preview 内嵌图走 blob；`style-src 'unsafe-inline'` 已放行其注入的 `<style>`）
- 新：`src/renderer/src/components/workbench/WorkbenchDocxPreview.tsx`
- 新：`src/renderer/src/components/workbench/WorkbenchXlsxPreview.tsx`
- 改：`package.json`（`docx-preview`、`xlsx`）

不改：preload IPC 契约、`askAi`/`insert-prompt` 链路、PDF 组件。

## 风险

- docx-preview 版式保真一般（复杂表格/文本框可能错位），属已知取舍；不满意可平替 `docx-renderer`。
- SheetJS 老版本 0.18.5 对新版 xlsx 特性覆盖有限，只读预览可接受。
- docx-preview 渲染大文档会一次性生成全部 DOM，20MB 上限 + 超上限兜底控制风险。

## 性能与内存（重点）

### 内存放大链路（dataUrl 方案的真实成本）

二进制文件从磁盘到渲染，base64 dataUrl 会经多次拷贝，峰值内存约为文件大小的 **4-5 倍**：

1. 主进程 `fsReadFile` → Buffer（1×原始大小）
2. `toString('base64')` → dataUrl 字符串（+33%，~1.33×）
3. IPC 序列化传输到渲染进程（字符串跨进程拷贝一份）
4. renderer `atob(base64)` → 二进制字符串（1×）→ `new Uint8Array`（再 1×）
5. docx-preview/`xlsx.read` 持有 ArrayBuffer + 解析出的中间结构（1×~2×）

10MB 的 docx 峰值可能到 ~50MB，且其中 base64 字符串（~13MB）会**常驻 `workbenchStore.activeFileDataUrl`** 直到切换文件。这也是把上限压到 10MB 的根本原因。

### 优化（可选，按收益排序）

- **改走 `file://` 直读（最大收益）**：渲染进程默认 `webSecurity` 允许 `file:` 协议，docx-preview/`xlsx` 都能直接 `fetch('file:///abs/path')` 拿 ArrayBuffer，完全跳过 base64 拷贝链，峰值降到 ~2×。代价是要传绝对路径（`readFile` 已返回 `activeFilePath`，workbench 根目录已知可拼）。**建议 docx/xlsx 走这条路**，PDF 保持 dataUrl 不动。
- **`atob` 改分块解码**：若仍用 dataUrl，`atob` 对大字符串是同步阻塞且产生中间二进制串；可用 `Uint8Array.fromBase64`（ES2025）或 `fetch(dataUrl).arrayBuffer()` 一步到 buffer，省掉第 4 步的一次拷贝。

### 内存泄漏防线

- **Blob URL 必须 `revokeObjectURL`**：docx-preview 会把文档内嵌图转 blob URL 挂到 `<img>`，组件卸载时若不 revoke，每次打开都在泄漏。`WorkbenchPdfPreview` 已有 `useEffect` cleanup 模式可照搬；docx-preview 的容器需在 `useEffect` cleanup 里 `container.innerHTML=''` + 遍历 `img.src` revoke。
- **切换文件即清数据**：`activeFileDataUrl` 在 openFile/closeWorkspace/deleteNode 都会置 null（已验证），组件再负责把 `getSelection`/DOM 清掉即可，无 store 泄漏。
- **`xlsx.read` 结果释放**：解析出的 workbook 对象 + `sheet_to_json` 的二维数组只留在组件 state/局部变量，卸载即释放；不要塞进全局 store。
- **重复打开防抖**：组件 `useMemo`/`useEffect` 依赖 `activeFileDataUrl`/`activeFilePath`，切换文件时 key 强制重建（`WorkbenchEditor` 已用 `key={activeFilePath}`），避免新旧文档 DOM 并存。

### 渲染性能

- docx-preview 一次性同步生成全部 DOM，10MB 文档可能上千节点——配合 `ignoreHeight` 限制 + CSS `content-visibility: auto` 可推迟屏外渲染。
- xlsx 大表必须 `react-virtuoso`（见上），普通 table 千行即卡。
- 划词 `getSelection()` 在 `onMouseUp` 同步调用即可，无需节流；但 docx-preview 大量节点下 selection 计算本身有开销，属正常范围。

## 验证

`npm run lint` → `npm run build` → `npm run dev`，实测：点击 docx/xlsx 出渲染 → 划词 → 浮动气泡"发送到侧边栏" → 右侧展开且文本进输入框。
