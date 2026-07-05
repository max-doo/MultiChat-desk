# 修复 AI 生图一键下载（触发网页内置下载按钮 + will-download 拦截）

> Created: 2026-07-05 17:51 (local)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

> **替代上一版计划** [`2026-07-04-batch-download-generated-images.md`](./2026-07-04-batch-download-generated-images.md)：上一版"扫 img.src + 主进程 fetch"方案对豆包/Gemini/GPT 三平台失败，且扩大扫描范围导致误下载大量无关图片并已回滚。本版换路线。

## Context

一键下载对豆包 / Gemini / GPT 三平台不生效。上一轮"扩大 imageContainer 扫描范围"方案失败并已回滚——根因是宽泛容器选择器误伤大量无关图片。

本计划换路线：**不再扫 img.src 去 fetch，改为注入脚本触发网页自带的下载按钮**，由网站自己产出原图（绕开 GPT 鉴权、Gemini blob 跨进程两大难题），主进程通过 `session.on('will-download')` 拦截并 `setSavePath` 跳过保存弹窗。

智谱按用户要求本次不动。

### 关键决策（已与用户确认）

| 决策点 | 选择 | 理由 |
|---|---|---|
| 配对策略 | **按 webContents 串行 + 标记位** | will-download 给的 `getFilename()`/`getURL()` 在 blob（Gemini）和无后缀 estuary（GPT）上不可靠，无法靠文件名配对；用 webContents id 关联最稳，多窗口并行互不串 |
| 取图范围 | **只点最新回复内的下载按钮** | 用 `selectors.messageContainer` 限定最新助手回复气泡，避免误触历史回复的下载按钮，防止重蹈"误下载无关图"覆辙 |
| 配置结构 | **`imageDownload.steps` 多步序列** | 三平台下载按钮都是 hover/交互后才出现（豆包/Gemini hover 浮层、GPT 点图开预览），单个下载按钮选择器无法表达前置交互；复用 `AutomationStep` + `findElement`/`simulateClick` |
| GPT 关预览 | **自动关闭** | 点保存后追加点击 `button[aria-label="关闭全屏显示"]`，避免预览残留挡住后续窗口 |
| 超时阈值 | **30s** | 生图原图通常几秒内开始下载，30s 偏保守 |
| 旧 `image:download-all` | **保留作 fallback** | 不删，新链路独立；其他路径仍可调用 |

## 总体链路

```
[ControlBar 一键下载]
  → appStore.triggerNativeDownloads()           // 新方法
  → 对每个窗口：webview.executeJavaScript(按 imageDownload.steps 触发下载按钮)
  → 同时主进程为该 wcId 开"批量下载标记位" + 准备路径队列
  → 网页按钮 click → persist:shared session 触发 will-download
  → 主进程 will-download 回调：webContents id 命中标记位 → item.setSavePath(预算路径) + 累计计数
  → item 'done' → 标记完成；超时/全部 done → 关闭标记位，回执结果
  → ControlBar 收到 perModel {saved, failed, errors} → 通知
```

## 改动方案

### 1. `src/shared/config/selectors.ts` — 新增 `imageDownload` 步骤配置

三平台下载按钮都是 **hover/交互后才出现**（豆包/Gemini hover 浮层、GPT 点图开预览），单个下载按钮选择器无法表达前置交互。改用与 `imageGeneration` 同构的 `steps` 序列，复用现有 `AutomationStep` + `findElement`/`simulateClick` 基础设施。

在 `ModelSelector` 接口新增（与 `imageGeneration` 平级）：

```ts
/** 生图结果"下载"自动化步骤序列。
 *  复用 AutomationStep；每步 selector+可选 text/regex+delay+hover。
 *  注入脚本按序执行：findElement→scrollIntoView→(hover 或 click)→delay。
 *  用于触发网页内置下载（原图，绕开鉴权/blob）。 */
imageDownload?: {
  steps: AutomationStep[]
  /** 跑完 steps 后自动点击的"关闭预览"按钮选择器（best-effort，失败不影响下载回执）。
   *  GPT 全屏预览场景用：点完保存后关掉预览，避免挡住后续窗口。 */
  closePreviewSelector?: string
}
```

> 约束：每步选择器**只匹配该步目标元素**（hover 目标图、预览里的保存按钮等），靠 `aria-label`/语义 tag/`:last-of-type` 精准区分，不匹配通用容器。`version` 15→16，`lastUpdated` 用 `Get-Date` 取真实日期。

#### 三平台 steps 定稿（基于用户提供的真实 DOM）

**chatgpt (GPT)** — 两步：点图开预览 → 点保存；跑完自动关预览：
```ts
imageDownload: {
  steps: [
    // 步骤1：点最新生图，打开全屏预览
    { selector: 'div[class*="imagegen-image"] img, div.group\\/imagegen-image img, img[id^="_r_"]', delay: 600 }
    // 步骤2：点预览 header 里的"保存"按钮（aria-label="保存" = 中文环境下载原图）
    { selector: 'header[data-testid="fullscreen-shell-header"] button[aria-label="保存"], button[aria-label="保存"]', delay: 300 }
  ],
  closePreviewSelector: 'header[data-testid="fullscreen-shell-header"] button[aria-label="关闭全屏显示"]'
}
```

**doubao (豆包)** — 两步：hover 触发浮层 → 点最后一个 action（下载）：
```ts
imageDownload: {
  steps: [
    // 步骤1：hover 最新 image-box-grid 内的图片，触发 hover-actions-slot 浮层
    { selector: 'div.image-box-grid-EYaIcP img, div[class*="image-box-grid"] img', delay: 300, hover: true }
    // 步骤2：点浮层最后一个 action（下载）—— DOM 证实下载是最后一个 action-nxGadz
    { selector: 'div.hover-actions-slot-_hVW2k div.action-nxGadz:last-of-type, div[class*="hover-actions-slot"] div.action-nxGadz:last-of-type', delay: 300 }
  ]
}
```

**gemini** — 两步：hover 触发 on-hover-button → 点下载：
```ts
imageDownload: {
  steps: [
    // 步骤1：hover 最新 generated-image，触发 on-hover-button 显示
    { selector: 'generated-image, single-image.generated-image, div.generated-images generated-image', delay: 300, hover: true }
    // 步骤2：点"下载完整尺寸的图片"按钮（双候选：aria-label + 语义 tag）
    { selector: 'button[aria-label="下载完整尺寸的图片"], download-generated-image-button button', delay: 300 }
  ]
}
```

> `hover: true` 是 `AutomationStep` 新增可选字段（见下节）。多候选选择器遵循 AGENTS.md「多候选选择器与可见性判断」。`group/imagegen-image` 的 `/` 在选择器转义为 `\\/`。

### 2. `src/shared/config/selectors.ts` — `AutomationStep` 新增 `hover?: boolean`

在 `AutomationStep` 接口（约 6–18 行）新增：

```ts
hover?: boolean  // 新：本步不 click 而是 dispatch mouseenter/mouseover/mousemove 触发 hover 浮层（豆包/Gemini 下载按钮 hover 才显）
```

向后兼容：未设 `hover` 时按现状 click。

### 3. `src/shared/utils/webviewScripts.ts` — 新增 `generateClickDownloadButtonsScript`

新函数，与 `generateDisableImageGenerationScript` 同文件、同导出风格（复用其 `helpers` 内的 `findElement`/`simulateClick`/`isElementVisible` 基础设施，参考 lines 1390–1435 的 cancelSteps 执行结构）：

```ts
/**
 * 生成"按 imageDownload.steps 触发网页内置下载"的注入脚本。
 * 复用 imageGeneration 的 findElement/simulateClick；支持 step.hover 模式。
 * 跑完 steps 后若配置了 closePreviewSelector，自动关预览（best-effort）。
 * 返回 { success, clicked } —— clicked 表示下载按钮步骤是否执行成功；
 * 真正落盘由主进程 will-download 统计。
 */
export function generateClickDownloadButtonsScript(selectors: ModelSelector): string
```

脚本骨架：

```js
(async function() {
  try {
    const config = ${JSON.stringify(config)};  // { steps: [...], closePreviewSelector?: string }
    ${helpers}  // findElement / simulateClick / isElementVisible

    if (!config.steps || !config.steps.length) return { success: false, error: '未配置下载步骤', clicked: 0 };

    let downloadClicked = false;
    for (let i = 0; i < config.steps.length; i++) {
      const step = config.steps[i];
      let element = null;
      let attempts = 0;
      while (!element && attempts < 10) {  // 与 cancelSteps 同：10 次重试，200ms 间隔
        element = findElement(step.selector, step.text, step);
        if (!element) { await new Promise(r => setTimeout(r, 200)); attempts++; }
      }
      if (!element) {
        if (step.optional) continue;
        return { success: false, error: '未找到元素: ' + step.selector, clicked: downloadClicked ? 1 : 0 };
      }
      element.scrollIntoView({ block: 'center', inline: 'center' });
      if (step.hover) {
        // hover 模式：dispatch 鼠标事件触发浮层，不 click
        element.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
        element.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
        element.dispatchEvent(new MouseEvent('mousemove', { bubbles: true }));
      } else {
        simulateClick(element);
        downloadClicked = true;  // 标记"下载按钮已点"（最后一步是下载按钮）
      }
      await new Promise(r => setTimeout(r, step.delay || 300));
    }

    // GPT 专用：跑完 steps 后自动关预览（best-effort，失败不影响结果）
    if (config.closePreviewSelector) {
      try {
        const closeBtn = document.querySelector(config.closePreviewSelector);
        if (closeBtn) closeBtn.click();
      } catch (e) { /* 忽略 */ }
    }

    return { success: downloadClicked, clicked: downloadClicked ? 1 : 0 };
  } catch (error) {
    return { success: false, clicked: 0, error: String(error?.message ?? error) };
  }
})();
```

> `clicked` 语义：下载按钮步骤（最后一个非 hover 步骤）执行成功则=1，否则=0。主进程据此设 `expectedFromClick`。**保留** `generateExtractImagesScript` 不动（旧"扫 src+fetch"路径仍作 fallback，不改它避免回归）。

### 4. `src/main/ipcHandlers.ts` — 新增 will-download 拦截 + `image:download-via-native` IPC

**a. 顶部 import 补 `session`**：

```ts
import { app, ipcMain, dialog, clipboard, BrowserWindow, shell, session } from 'electron'
```

**b. 模块级维护"批量下载上下文"，按 webContents id 分桶**：

```ts
interface NativeDownloadCtx {
  dir: string
  modelId: string
  ts: string
  seq: number           // 已分配序号（用于文件名）
  saved: number
  failed: number
  errors: string[]
  resolve: (r: { modelId: string; saved: number; failed: number; errors: string[] }) => void
  timer: NodeJS.Timeout
  expectedFromClick: number  // 注入脚本报告的点击数，用于判定"是否全部到账"
  arrived: number            // will-download 实际触达数
}
const nativeCtxByWcId = new Map<number, NativeDownloadCtx>()
```

**c. 应用启动时（与 webviewManager 初始化同处或 ipcHandlers 顶部一次性）注册 will-download**：

```ts
const shared = session.fromPartition('persist:shared')
shared.on('will-download', (event, item, webContents) => {
  const wcId = webContents?.id
  const ctx = wcId ? nativeCtxByWcId.get(wcId) : undefined
  if (!ctx) return  // 非批量下载 → 放行，走系统默认（弹窗）
  event.preventDefault()  // 阻止默认弹窗行为（双保险，配合 setSavePath）
  const seq = ++ctx.seq
  // 文件名：用 item.getFilename() 兜底扩展名，否则按 url 后缀，否则 png（blob/estuary 无后缀时）
  const url = item.getURL() || ''
  const fn = item.getFilename() || ''
  const ext = /\.(png|jpe?g|webp|gif|bmp)$/i.test(fn) ? fn.match(/\.(png|jpe?g|webp|gif|bmp)$/i)![1].toLowerCase()
           : /\.(png|jpe?g|webp|gif|bmp)$/i.test(url) ? (url.match(/\.(png|jpe?g|webp|gif|bmp)$/i)![1].toLowerCase())
           : 'png'
  const fileName = `${ctx.modelId}-${ctx.ts}-${seq}.${ext === 'jpg' ? 'jpg' : ext}`
  item.setSavePath(join(ctx.dir, fileName))
  item.on('done', (_e, state) => {
    ctx.arrived++
    if (state === 'completed') ctx.saved++
    else { ctx.failed++; ctx.errors.push(`图 ${seq}: ${state}`) }
    finalizeIfDone(wcId!)
  })
})
```

> 注意：`will-download` 是 session 级单次注册，不能在 IPC handler 内重复注册（会重复触发）。必须在模块初始化时注册一次。`join` 来自已 import 的 `path`。

**d. `finalizeIfDone(wcId)`**：当 `ctx.arrived >= ctx.expectedFromClick` 或超时到时，清理标记位、清 timer、resolve 回执、从 Map 删该项。

**e. 新 IPC handler `image:download-via-native`**（替换旧 `image:download-all` 在生图场景的职责；旧 handler 保留不动，供其他路径/未来 fallback）：

```ts
ipcMain.handle('image:download-via-native', async (_event, payload: {
  items: Array<{ modelId: string; wcId: number; clicked: number }>
}) => {
  // 1. 选目录（一次）
  const dirResult = await dialog.showOpenDialog({ title:'选择图片保存目录', properties:['openDirectory'] })
  if (dirResult.canceled || !dirResult.filePaths?.length) return { success:false, error:'用户取消' }
  const dir = dirResult.filePaths[0]
  const ts = /* 同现有 ts 格式 */
  // 2. 为每个 wcId 建上下文，并行等待
  const perModel = await Promise.all(payload.items.map(async (it) => {
    return await new Promise<{modelId:string;saved:number;failed:number;errors:string[]}>(resolve => {
      const timer = setTimeout(() => {  // 超时兜底（如点了但没触发 will-download），30s
        const ctx = nativeCtxByWcId.get(it.wcId)
        if (ctx) { ctx.failed += (it.clicked - ctx.arrived); ctx.errors.push('超时未触发下载'); finalizeForce(it.wcId) }
      }, 30000)
      nativeCtxByWcId.set(it.wcId, { dir, modelId: it.modelId, ts, seq:0, saved:0, failed:0, errors:[], resolve, timer, expectedFromClick: it.clicked, arrived:0 })
    })
  }))
  return { success: true, data: { perModel } }
})
```

> 关键：handler 只负责"建上下文 + 等回执"。真正的点击在渲染层 webview.executeJavaScript 完成（见下）。handler 收到 `clicked` 计数后设 `expectedFromClick`，will-download 每到一项就 `arrived++`，齐了或超时就 resolve。

### 5. `src/preload/index.ts` + `index.d.ts` — 新增 IPC 桥接

```ts
// index.ts
triggerNativeDownloads: (payload: {
  items: Array<{ modelId: string; wcId: number; clicked: number }>
}) => ipcRenderer.invoke('image:download-via-native', payload),

// index.d.ts
triggerNativeDownloads: (payload: {
  items: Array<{ modelId: string; wcId: number; clicked: number }>
}) => Promise<{ success: boolean; data?: { perModel: Array<{ modelId: string; saved: number; failed: number; errors: string[] }> }; error?: string }>
```

> IPC 契约按 AGENTS.md 同步：main handler / preload index.ts / index.d.ts 三处一致；返回 `{success, data?, error?}`。

### 6. `src/renderer/src/components/WebviewCard.tsx` — 新增 `clickDownloadButtons`

在 `WebviewCardRef` 接口（约 120–149 行）新增方法声明，并在 `useImperativeHandle`（约 480 行起）的实现对象里新增（与 `extractGeneratedImages` 同位置）：

```ts
/** 按平台 imageDownload.steps 触发网页内置下载（hover/click），返回 {clicked, wcId}。
 *  clicked=1 表示下载按钮步骤执行成功；落盘由主进程 will-download 统计。 */
clickDownloadButtons: async (): Promise<{ clicked: number; wcId: number | null; error?: string }> => {
  const webview = webviewRef.current
  if (!webview || !isReady || !selectors) return { clicked: 0, wcId: null, error: 'Webview 未就绪' }
  if (!selectors.imageDownload?.steps?.length) return { clicked: 0, wcId: null, error: '此模型未配置下载步骤' }
  const wcId = typeof (webview as any).getWebContentsId === 'function' ? (webview as any).getWebContentsId() : null
  try {
    const code = generateClickDownloadButtonsScript(selectors)
    const result = await webview.executeJavaScript(code)
    return { clicked: result?.clicked ?? 0, wcId, error: result?.error }
  } catch (error) { return { clicked: 0, wcId, error: String(error) } }
}
```

> `WebviewCardRef` 接口同步加 `clickDownloadButtons: () => Promise<{ clicked: number; wcId: number | null; error?: string }>`。

### 7. `src/renderer/src/store/appStore.ts` — 新增 `triggerNativeDownloads`

```ts
triggerNativeDownloads: async (): Promise<ExtractImagesResult[]> => {
  // 复用 getDisplayedModels/webviewRefs 取窗口列表
  // 对每个窗口并行调 webviewRef.clickDownloadButtons()
  // 收集 {modelId, wcId, clicked}
  // 过滤 clicked>0 的项 → 调 window.api.triggerNativeDownloads({items})
  // 返回 perModel 用于通知
}
```

> `extractImagesFromAll` 保留不动（其他路径可能仍用）。

### 8. `src/renderer/src/components/ControlBar.tsx` — 切换 `handleDownloadAllImages`

```ts
const handleDownloadAllImages = async () => {
  const results = await triggerNativeDownloads()  // 替换 extractImagesFromAll
  const items = results.filter(r => r.clicked > 0).map(...)
  if (!items.length) { showNotification('info','未检测到可下载的生图（或未配置下载按钮）'); return }
  const res = await window.api?.triggerNativeDownloads?.({ items })
  // 通知逻辑同现有：saved/failed 汇总
}
```

## 涉及文件清单

| 文件 | 改动 |
|---|---|
| `src/shared/config/selectors.ts` | `AutomationStep` 加 `hover?` 字段；`ModelSelector` 加 `imageDownload?` 字段（含 `closePreviewSelector?`）；为 chatgpt/doubao/gemini 配置 steps（DOM 已定稿）；version+1 |
| `src/shared/utils/webviewScripts.ts` | 新增 `generateClickDownloadButtonsScript`；`generateExtractImagesScript` 不动 |
| `src/main/ipcHandlers.ts` | 顶部 import 补 `session`；模块级 `nativeCtxByWcId` + `will-download` 注册；新增 `image:download-via-native` handler；`finalizeIfDone`/`finalizeForce` |
| `src/preload/index.ts` | 新增 `triggerNativeDownloads` 桥接 |
| `src/preload/index.d.ts` | 新增 `triggerNativeDownloads` 类型 |
| `src/renderer/src/components/WebviewCard.tsx` | `WebviewCardRef` 加 `clickDownloadButtons`；`useImperativeHandle` 实现 |
| `src/renderer/src/store/appStore.ts` | 新增 `triggerNativeDownloads` action |
| `src/renderer/src/components/ControlBar.tsx` | `handleDownloadAllImages` 改调新链路 |

`src/renderer/src/config/selectors.ts`、`src/renderer/src/utils/webviewScripts.ts` 是 re-export shim，无需改。

## 验证（手动，遵循 AGENTS.md）

`npm run lint` → `npm run build` → `npm run dev`：

1. lint 无新增告警；build 类型检查通过。
2. **豆包**：生图 → 一键下载 → 应弹"选目录"一次 → 该窗口的图全部落盘（无每张保存弹窗）。
3. **GPT**：同上，原图落盘（鉴权由网页自带 Cookie 解决），下载后预览自动关闭。
4. **Gemini**：同上，原图落盘（blob 由网页自己处理）。
5. **多窗口并行**：3 个窗口同时生图 → 一键下载 → 各窗口图分别落盘，互不串号。
6. **回归**：
   - 未配置 `imageDownload` 的平台（如 grok/qwen/yiyan/智谱）→ 走"未配置"提示，不报错。
   - 用户日常手动在任一 webview 里点下载 → `will-download` ctx 不命中 → 放行弹窗，行为不变。
7. **超时**：若某窗口点了按钮但网页没触发下载（如按钮失效）→ 30s 后该窗口计入 failed"超时未触发"，其余正常。

## 风险与回滚

- **下载按钮选择器失效**：平台改版会使按钮点不到 → `clicked=0` → 提示"未检测到"，不 worse。多候选 + 强特征（aria-label/download 属性）降低脆弱性。
- **will-download 误拦日常下载**：靠 `nativeCtxByWcId` 标记位严格区分，未标记的 webContents 一律放行；标记位在 handler resolve/超时后立即删除，窗口期小。
- **多图并发竞态**：注入脚本内 `click` 间隔 300ms；主进程按 `arrived` 计数，序号靠 `++seq`，无并发写冲突（JS 单线程）。
- **will-download 重复注册**：必须在模块初始化时注册一次，不能放 IPC handler 内。代码注释会强调。
- **blob 文件名缺失**：`item.getFilename()` 对 blob 返回空 → 走扩展名兜底（按 url 后缀，否则 png）。Gemini 落盘为 png，可接受。
- 回滚：新链路独立于旧 `image:download-all`，可单独 revert；selectors 仅加字段不破坏现有消费方。

## 已完成的前置确认

- [x] 豆包下载按钮真实 DOM（浮层多按钮，下载是最后一个 `action-nxGadz`）
- [x] GPT 下载按钮真实 DOM（点图开预览，header `button[aria-label="保存"]`）
- [x] Gemini 下载按钮真实 DOM（`button[aria-label="下载完整尺寸的图片"]`）

选择器已定稿填入上文「### 1」steps，无需再补。
