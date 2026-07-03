> Created: 2026-07-03 12:57 (+08:00)
> Relation: 2026-07-02-selector-diagnostics-v2-design.md 已落地独立诊断窗口（双 Tab：message + research，探针纯函数 + relay IPC 通道）。本设计在其上新增第三种能力「DOM 结构探测（检拾模式）」，复用既有 relay 通道与 DOM 序列化范式，不改窗口形态。

# 诊断窗口 DOM 结构探测（检拾模式）设计

> **Status:** Draft — awaiting review
> **Scope:** dev-only 诊断能力增强，不触碰生产抓取逻辑、不新增生产依赖、不改 `selectors.ts` 数据结构。

## 1. 问题陈述

现状诊断窗口（`DiagnosticsPage.tsx` + 独立 `BrowserWindow` + `diagnostics:probe-request/response` relay IPC）只能**验证预设选择器是否命中**：message tab 跑 `messageContainer` 候选，research tab 跑 `researchMode.steps`。当某平台改版、需要更新 `selectors.ts` 时，用户无法直接"看到"目标元素在真实 DOM 里的层级位置和可用属性，只能盲猜选择器再试。

用户要求：在诊断窗口里实现类似浏览器 DevTools Elements 面板的**检拾（pick）能力**——进入模式后在平台 webview 里鼠标移动高亮元素、点击选中，返回选中元素的 DOM 结构（祖先链 + 自身 + 子树），用于判断该用什么选择器去定位。

## 2. 非目标

- **不做原生 DevTools inspect**：`<webview>` 标签不暴露 `webContents` 的 inspect/highlight 原生 API，高亮只能靠注入 JS 自画覆盖层（DevTools 内部原理的简化版）。
- **不做完整 Elements 树浏览器**（全 DOM 大树），仅围绕"选中元素"返回有限深度结构。
- **不做选择器自动生成/合并到 `selectors.ts`**：仅展示候选指纹供人工复制，仍人工审核落盘。
- **不改生产抓取逻辑**：picker 脚本与 DOM 序列化脚本均为 dev-only 注入，不进 `webviewScripts.ts` 的生产路径。
- **不做多平台同时检拾**：同一时刻同一平台只允许一个活跃 picker；跨平台互不干扰。
- **不做持久化**：检拾结果不落盘，仅当前会话展示。

## 3. 架构

### 3.1 复用既有 relay 通道

诊断窗口与平台 webview 分处两个 renderer（诊断窗口是独立 `BrowserWindow`，平台 `<webview>` 在主窗口 renderer），无法直接互访。沿用 v2 已建的请求/响应中转：

```
诊断窗口 renderer              主进程                  主窗口 renderer
──────────────                ──────                 ───────────────
diagnosticsProbe(modelId,     ipcMain.handle         onDiagnosticsProbeRequest
  'pick')                ──→   'diagnostics:probe'   ──→  webviewRefs.get(id)
  （挂起，等回传）                                          .probeDomStructure('pick')
                                                   ←──   返回 DomProbeReport
  ←── DomProbeReport            ←──                   ←──
```

`diagnostics:probe` 的 `type` 联合类型从 `'message' | 'research'` 扩展为 `'message' | 'research' | 'pick'`。`type === 'pick'` 时主窗口 relay 调 `ref.probeDomStructure('pick')`，该方法注入 picker 脚本，**单次往返**完成"进入检拾 → 用户点选 → 返回结构"（picker 脚本内部挂起监听，点选/取消后 resolve）。

> 为何单次往返：picker 脚本注入后立即返回一个 Promise，其在平台页内监听 `click/keydown`，用户点选后才 resolve 回传。诊断窗口侧 `diagnosticsProbe` 仍是单次 invoke。relay 的 5s 超时（`ipcHandlers.ts:114`）对检拾太短——见 §6 改为 `type==='pick'` 时用 60s 超时。

### 3.2 路由

无需新路由。检拾入口挂在 `DiagnosticsPage` 新增的第三个 Tab「DOM 探测」内，窗口与路由沿用 v2。

## 4. 组件拆分

### 4.1 单元 1 — DOM 序列化纯函数（扩展 `selectorDiagnostics.ts`）

新增导出（与现有 `buildProbeScript`/`buildResearchProbeScript` 同源只读风格并列）：

- `interface NodeFingerprint`：`tag`、`className`、`id`、`dataTestid`、`attrs`（白名单：`role`/`aria-label`/`aria-haspopup`/`name`/`type`/`href`，其余丢弃）、`childCount`、`visibleTextLen`（长度，不含正文）、`isVisible`。
- `interface DomProbeReport`：`{ ok: boolean; selector?: string; target?: NodeFingerprint; ancestors?: NodeFingerprint[]; subtree?: TreeNode; error?: string; cancelled?: boolean }`，其中 `TreeNode = NodeFingerprint & { children: TreeNode[] }`。
- `function buildDomProbeScript(opts: { selector: string; ancestorDepth: number; childDepth: number }): string`：注入脚本，`querySelector(selector)` 取目标元素（多候选逗号分隔取首个命中），向上取 `ancestorDepth` 层祖先，向下取 `childDepth` 层子树，每节点序列化为脱敏指纹，返回 JSON。未命中返回 `{ ok: false, error: '选择器未命中任何元素' }`。**该函数在检拾模式里被 picker 脚本内部复用**（picker 点选中元素后，调用同一段序列化逻辑）。
- `function parseDomProbeResult(raw: unknown): DomProbeReport`：解析 `executeJavaScript` 返回，异常兜底 `{ ok: false, error }`。

序列化与脱敏范式严格沿用 `selectorDiagnostics.ts` 既有 `describeFirst`（`:89-105`），仅扩字段。

### 4.2 单元 2 — Picker 注入脚本（新，`selectorDiagnostics.ts`）

- `function buildPickerScript(opts: { ancestorDepth: number; childDepth: number }): string`：注入平台页的检拾脚本。流程：
  1. 创建全屏透明覆盖层 `<div data-mc-picker-overlay>`（`position:fixed; inset:0; z-index:2147483647; cursor:crosshair`），再创建一个高亮框 `<div data-mc-picker-highlight>`（2px 蓝边 + 半透明蓝底）和一个浮标 `<div data-mc-picker-tip>` 显示当前元素指纹。
  2. 覆盖层监听 `mousemove`：用 `document.elementFromPoint` 取真实元素（覆盖层自身 `pointer-events:none` 让事件穿透到平台页，但用 `elementFromPoint` 而非依赖事件目标，避免穿透歧义），更新高亮框位置/尺寸 + 浮标内容。
  3. 覆盖层监听 `click`：`preventDefault + stopPropagation`，取当前元素，**立即移除覆盖层/高亮/浮标/监听**，序列化选中元素（复用单元 1 的序列化逻辑，祖先 `ancestorDepth` + 子树 `childDepth`），resolve 回传 `{ ok: true, target, ancestors, subtree }`。
  4. `document` 监听 `keydown`：Esc 键 → 移除注入物、回传 `{ ok: false, cancelled: true }`。
  5. 防重入：注入前先清理同名注入物（同平台重复进入先清旧 picker）。
  6. 超时自清：注入后 120s 未点选自动取消，回传 `{ ok: false, error: '检拾超时' }`。
- picker 脚本内部把序列化逻辑**内联**（不跨 `executeJavaScript` 调用第二次），保证一次注入完成"进检拾→点选→回结构"。

### 4.3 单元 3 — `WebviewCard` 方法（扩展 `WebviewCardRef`）

新增 `probeDomStructure(mode: 'pick', opts: { ancestorDepth: number; childDepth: number }): Promise<DomProbeReport>`，与既有 `probeMessageContainer`(`:866`)/`probeResearchMode`(`:886`) 并列。实现：

```ts
probeDomStructure: async (_mode, opts) => {
  const webview = webviewRef.current
  if (!webview) return { ok: false, error: 'Webview ref 为空' }
  try {
    const raw = await webview.executeJavaScript(buildPickerScript(opts))
    return parseDomProbeResult(raw)
  } catch (error) {
    return { ok: false, error: `页面未就绪或执行失败: ${String(error) }` }
  }
}
```

> 签名预留 `mode` 参数（当前仅 `'pick'`，未来若加"选择器驱动"可扩 `'selector'` 走 `buildDomProbeScript`，不在本设计实现）。

### 4.4 单元 4 — relay 适配（`appStore.ts:1600`）

`registerDiagnosticsRelay` 的 probe 分支扩展：

```ts
if (type === 'message') result = await ref.probeMessageContainer()
else if (type === 'research') result = await ref.probeResearchMode()
else if (type === 'pick') result = await ref.probeDomStructure('pick', options)  // 新增
```

`options` 从 relay payload 取（`{ ancestorDepth, childDepth }`），缺省默认 `{ ancestorDepth: 8, childDepth: 3 }`。

### 4.5 单元 5 — `DiagnosticsPage` DOM Tab（UI）

`DiagnosticsPage.tsx` 新增 Tab 3「DOM 探测」：
- 顶部两个数值输入：祖先层数（默认 8）、子树层数（默认 3）。
- **"进入检拾"** 按钮 → `window.api.diagnosticsProbe(modelId, 'pick', { ancestorDepth, childDepth })`。按钮在请求挂起期间显示"检拾中…（点平台页元素 / Esc 取消）"，期间禁用重复点击。
- 结果区 `DomTreeView`：
  - **祖先链**：从根方向 → 目标，缩进树状列表，每行显示指纹（`tag.class#id[data-testid]` + 可见性标记），可折叠。
  - **目标元素**：高亮卡片，完整指纹 + **"复制选择器"** 按钮（生成候选：`[data-testid="…"]`（若有）优先、`tag#id`（若有）、`tag.首个class`，复制即用）。
  - **子树**：`TreeNode` 递归渲染，默认展开 2 层，更深层折叠。
- 沿用底部脱敏提示："仅元素指纹 + 正文长度，不含正文内容。"

## 5. 数据流

1. 用户在诊断窗口选平台 → 点"进入检拾"。
2. 诊断窗口 `diagnosticsProbe(modelId, 'pick', {ancestorDepth:8, childDepth:3})`。
3. 主进程 `ipcHandlers.ts` 收 `diagnostics:probe`，`type==='pick'` → 60s 超时表，relay `diagnostics:probe-request` 给主窗口。
4. 主窗口 `appStore` relay 取 `webviewRefs.get(modelId).probeDomStructure('pick', opts)`。
5. `WebviewCard` 注入 `buildPickerScript`，平台页出现覆盖层 + 高亮跟随鼠标。
6. 用户移动鼠标看高亮 → 点击目标元素。
7. picker 脚本移除注入物，序列化选中元素 → resolve 回 `executeJavaScript`。
8. 主窗口 relay `diagnostics:probe-response` → 主进程 → 诊断窗口 `diagnosticsProbe` Promise resolve。
9. 诊断窗口渲染 `DomTreeView`。
- 任意阶段 Esc / 超时 / 平台未加载 → `{ ok:false, cancelled|error }`，UI 显示对应提示。

## 6. IPC 契约变更（端到端同步，4 处 + relay）

1. **`src/main/ipcHandlers.ts:107`** — `diagnostics:probe` payload `type` 联合类型加 `'pick'`，新增可选 `options?: { ancestorDepth?: number; childDepth?: number }` 透传；`type==='pick'` 时超时 60000ms（其余维持 5000/15000）。
2. **`src/preload/index.ts:38` + `index.d.ts:69-75`** — `diagnosticsProbe` 签名改 `(modelId: string, type: 'message'|'research'|'pick', options?: { ancestorDepth?: number; childDepth?: number })`；`onDiagnosticsProbeRequest` 回调 payload 加 `options?`。
3. **`src/renderer/src/env.d.ts:87`** — 同步 `onDiagnosticsProbeRequest` payload 类型加 `options?`。
4. **`src/renderer/src/store/appStore.ts:1600`** — relay `type==='pick'` 分支调 `ref.probeDomStructure('pick', options)`。
5. **`src/renderer/src/components/WebviewCard.tsx`** — `WebviewCardRef` 类型加 `probeDomStructure`；实现见 §4.3。

## 7. 安全 / 边界

- **只读**：picker 脚本不点击平台按钮、不改平台 DOM 结构（覆盖层是独立 `<div>`，选中/取消/超时后立即 `remove()`）。
- **临时注入**：覆盖层、高亮、浮标、监听器在 resolve 前全部清理；防重入先清同名注入物；120s 超时自清。断网/关页等极端情况下注入物可能残留——picker 脚本用 `data-mc-picker-*` 属性标记，可二次清理。
- **脱敏**：序列化白名单属性（§4.1），正文仅 `visibleTextLen` 长度，不含用户对话文本——沿用 `selectorDiagnostics.ts` 既有范式。
- **Session**：仍走 `persist:shared` 的 `<webview>.executeJavaScript`，无新权限、无新 Session。
- **干扰**：检拾期间平台页鼠标交互被覆盖层接管（`cursor:crosshair`），退出即恢复。用户须主动进入/退出，不会被动触发。

## 8. 测试（手动，dev 环境）

`npm run lint` → `npm run build` → `npm run dev`：

1. **基本路径**：chatgpt 平台触发一次回复 → 打开诊断窗口 DOM tab → 设祖先 8 / 子树 3 → "进入检拾" → 平台页出现高亮跟随鼠标 → 点中一条 AI 回复消息 → 诊断窗口渲染祖先链（含 `body > … > article`）+ 目标指纹 + 子树可展开。
2. **复制选择器**：选中目标后点"复制选择器"，粘贴验证可命中同一元素。
3. **Esc 取消**：进入检拾后按 Esc → 诊断窗口显示"已取消"，平台页覆盖层消失、交互恢复。
4. **超时**：进入检拾后 120s 不操作 → 自动取消、覆盖层清理。
5. **未加载平台**：选一个未加载的平台进入检拾 → 显示"平台未加载"。
6. **重复进入**：连续点两次"进入检拾" → 旧 picker 被清理，只保留一个活跃覆盖层。
7. **跨平台不串扰**：在 chatgpt 检拾中切到 claude 平台操作，互不影响。

无法在当前开发机独立完成测试的项目：无（全部可在 dev 桌面环境手动验证）。

## 9. 待确认 / 风险

- **`elementFromPoint` vs 事件目标**：覆盖层 `pointer-events:none` 让鼠标事件穿透，但用 `document.elementFromPoint(e.clientX, e.clientY)` 取真实元素更可靠（避免平台页自身 `pointer-events` 干扰）。实现时采用 `elementFromPoint`，并在取到覆盖层自身时跳过。
- **Shadow DOM**：`elementFromPoint` 不穿透 shadow root，部分平台（如 claude）的回复容器可能在 shadow tree 内。首版不处理 shadow，若命中失败在结果里提示"目标可能在 Shadow DOM 内，请改用选择器驱动（未实现）"。
- **relay 超时**：检拾需要用户手动操作，5s 默认超时必触发，必须按 §6 改为 60s（picker 自身 120s 兜底，relay 60s 是第二道闸）。若用户操作极慢（>60s）会被 relay 切断——picker 侧 120s 仍未 resolve 时自清，relay 超时后诊断窗口显示"检拾超时"。
