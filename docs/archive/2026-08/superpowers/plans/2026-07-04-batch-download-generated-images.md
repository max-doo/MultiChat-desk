# 一键下载所有窗口生图 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

> Created: 2026-07-04 12:23 (local)

**Goal:** 在生图模式下，点「一键下载」按钮，弹一次目录选择框，把所有窗口当前 DOM 里的生图原图批量存到该目录，文件名 `{modelId}-{时间戳}-{序号}.{ext}`，无逐张系统保存弹框。

**Architecture:** 复用 `enableImageGenerationForAll` 的"遍历 displayedModels → webviewRefs.get(slot-N) → 并发 executeJavaScript"模式。新增一条注入脚本 `generateExtractImagesScript`，在 webview 页内把 blob:/canvas/data:/img.src/a[href] 统一转成 `{src, mime?}` 数组返回渲染层；渲染层收齐后调 `downloadAllImages` IPC，主进程弹一次目录框、逐张 base64 解码或 fetch buffer 写盘。ControlBar 现有的「一键下载」按钮（当前只弹 TODO toast）接线到这套链路。

**Tech Stack:** TypeScript (strict), Electron 28, React 18, Zustand 4。无测试运行器——验证流程固定为 `npm run lint` → `npm run build` → `npm run dev` 手动验证。

## Global Constraints

- 严格 TypeScript，禁止 `any` 静默错误；故意未用变量以 `_` 前缀。
- IPC 端到端同步：新增 IPC 必须同时改 `src/main/ipcHandlers.ts` + `src/preload/index.ts` + `src/preload/index.d.ts` + 渲染层调用点 + `src/renderer/src/env.d.ts`（如该处也声明了类型）。返回结构统一 `{ success, data?, error? }`。
- Webview 自动化：注入脚本统一在 `src/shared/utils/webviewScripts.ts`；选择器统一在 `src/shared/config/selectors.ts`。
- 禁止擅自切分支。提交遵循 Conventional Commits。
- 验证 = `npm run lint` + `npm run build` + `npm run dev` 手动跑流程。
- 时间戳须用终端真实时间，不在代码里写死；主进程落盘时用 `new Date()` 生成一次同批时间戳。

## File Structure

| 文件 | 责任 | 改动 |
|---|---|---|
| `src/shared/utils/webviewScripts.ts` | 新增 `generateExtractImagesScript(selectors)` 注入脚本 | 新增函数 |
| `src/renderer/src/components/WebviewCard.tsx` | 在 `WebviewCardRef` 加 `extractGeneratedImages()`，调 `executeJavaScript` | 加方法 |
| `src/renderer/src/store/appStore.ts` | 加 `extractImagesFromAll()` 遍历方法 + 类型 | 加方法+类型 |
| `src/main/ipcHandlers.ts` | 新增 `image:download-all` handler：选目录+批量落盘 | 加 handler |
| `src/preload/index.ts` | 暴露 `downloadAllImages` | 加方法 |
| `src/preload/index.d.ts` | 声明 `downloadAllImages` 类型 | 加类型 |
| `src/renderer/src/env.d.ts` | 声明 `downloadAllImages` 类型（与 index.d.ts 对齐） | 加类型 |
| `src/renderer/src/components/ControlBar.tsx` | 「一键下载」按钮接线 | 改 onClick |

类型定义集中放在 store（`ExtractedImage`、`ExtractImagesResult`、`DownloadAllImagesPayload`），其它文件 import 复用，避免重复声明。

---

### Task 1: 新增提取生图注入脚本

**Files:**
- Modify: `src/shared/utils/webviewScripts.ts`（在 `generateDisableImageGenerationScript` 之后，约 `:1416` 附近新增导出函数）

**Interfaces:**
- Consumes: `ModelSelector`（来自 `src/shared/config/selectors.ts`，已有 `messageContainer: string[]`）
- Produces: `generateExtractImagesScript(selectors: ModelSelector): string` —— 返回一段 IIFE 脚本字符串，注入后 resolve 为 `{ success: boolean; images: Array<{ src: string; mime?: string }>; error?: string }`

- [ ] **Step 1: 编写 `generateExtractImagesScript` 函数**

在 `src/shared/utils/webviewScripts.ts` 末尾追加。脚本逻辑：定位 `selectors.messageContainer` 最后一个可见匹配项为 root（找不到则 `document.body`）；在 root 内 `querySelectorAll('img')` 取 `currentSrc || src`，过滤 `naturalWidth < 100` 且非 `data:`/`blob:` 的；`querySelectorAll('canvas')` 用 `toDataURL('image/png')`；`querySelectorAll('a[download], a[href$=".png" i], a[href$=".jpg" i], a[href$=".jpeg" i], a[href$=".webp" i]')` 取 href 作原图候选；对 `blob:` src 页内 `fetch→blob→FileReader.readAsDataURL` 转 data:；按 src 去重；从 `data:image/png;base64,` 头部或 URL pathname 推断 mime。复用 `buildDeepResearchHelperFunctions()` 里的 `isElementVisible`/`findElement`。

```ts
/**
 * 生成"提取当前 webview 最新回复中生图"的注入脚本。
 * 在页内把 img.src / canvas / a[download] / blob: 统一转成 {src, mime?} 数组返回。
 * @param selectors 平台选择器配置（用 messageContainer 定位最新回复气泡）
 */
export function generateExtractImagesScript(selectors: ModelSelector): string {
  const messageContainer = JSON.stringify(selectors.messageContainer || [])
  return `
    (async function() {
      try {
        const messageContainerSelectors = ${messageContainer};
        function isElementVisible(el) {
          if (!el) return false;
          const rect = el.getBoundingClientRect();
          const style = window.getComputedStyle(el);
          return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none' && style.opacity !== '0';
        }
        function findLatestContainer() {
          for (const sel of messageContainerSelectors) {
            const all = document.querySelectorAll(sel);
            for (let i = all.length - 1; i >= 0; i--) {
              if (isElementVisible(all[i])) return all[i];
            }
          }
          return document.body;
        }
        function inferMime(src) {
          const dataMatch = src.match(/^data:(image\\/[a-zA-Z0-9.+-]+);/);
          if (dataMatch) return dataMatch[1];
          const extMatch = src.match(/\\.(png|jpe?g|webp|gif|bmp|svg)(?:\\?|#|$)/i);
          if (extMatch) {
            const e = extMatch[1].toLowerCase();
            if (e === 'jpg') return 'image/jpeg';
            return 'image/' + e;
          }
          return 'image/png';
        }
        function blobToDataUrl(blobUrl) {
          return fetch(blobUrl).then(function(r){ return r.blob(); }).then(function(b){
            return new Promise(function(resolve, reject){
              var fr = new FileReader();
              fr.onload = function(){ resolve(fr.result); };
              fr.onerror = function(){ reject(fr.error); };
              fr.readAsDataURL(b);
            });
          });
        }

        var root = findLatestContainer();
        var seen = Object.create(null);
        var images = [];

        // 1) img 元素
        var imgs = root.querySelectorAll('img');
        for (var i = 0; i < imgs.length; i++) {
          var img = imgs[i];
          var src = img.currentSrc || img.src || img.getAttribute('data-src') || '';
          if (!src) continue;
          // 过滤小图标/头像（data:/blob: 不过滤尺寸，因为是生成的图）
          var nw = img.naturalWidth || 0;
          if (nw && nw < 100 && !/^data:/.test(src) && !/^blob:/.test(src)) continue;
          if (seen[src]) continue;
          seen[src] = true;
          images.push({ src: src, mime: inferMime(src) });
        }

        // 2) canvas
        var canvases = root.querySelectorAll('canvas');
        for (var c = 0; c < canvases.length; c++) {
          try {
            var dataUrl = canvases[c].toDataURL('image/png');
            if (dataUrl && !seen[dataUrl]) {
              seen[dataUrl] = true;
              images.push({ src: dataUrl, mime: 'image/png' });
            }
          } catch (e) { /* canvas 跨域 tainted，跳过 */ }
        }

        // 3) a[download] / a[href$=图片]
        var anchors = root.querySelectorAll('a[download], a[href$=".png" i], a[href$=".jpg" i], a[href$=".jpeg" i], a[href$=".webp" i]');
        for (var a = 0; a < anchors.length; a++) {
          var href = anchors[a].href || '';
          if (!href || seen[href]) continue;
          seen[href] = true;
          images.push({ src: href, mime: inferMime(href) });
        }

        // 4) blob: 转 data:（必须在页内做，主进程跨进程拿不到 blob）
        for (var k = 0; k < images.length; k++) {
          if (/^blob:/.test(images[k].src)) {
            try {
              var dataUrl2 = await blobToDataUrl(images[k].src);
              images[k].src = dataUrl2;
              images[k].mime = inferMime(dataUrl2);
            } catch (e) {
              // 转换失败，保留 blob: src，主进程会记录失败
            }
          }
        }

        return { success: true, images: images };
      } catch (error) {
        return { success: false, images: [], error: String(error && error.message || error) };
      }
    })();
  `;
}
```

确认文件顶部已 `import type { ModelSelector }`（若未导入则补；该文件其它 `generate*` 函数已使用 `selectors` 参数，按现有写法对齐——若现有函数用 `any`，这里仍显式标注 `ModelSelector` 以满足 strict，但不要改动既有函数签名）。

- [ ] **Step 2: 类型检查**

Run: `npm run build`
Expected: 通过，无新增 TS 错误（脚本字符串内的 JS 不被 tsc 检查，只检查函数签名与 import）。

- [ ] **Step 3: Lint**

Run: `npm run lint`
Expected: 无 error。

- [ ] **Step 4: Commit**

```bash
git add src/shared/utils/webviewScripts.ts
git commit -m "feat(image): 新增 generateExtractImagesScript 提取 webview 生图"
```

---

### Task 2: WebviewCardRef 暴露 extractGeneratedImages

**Files:**
- Modify: `src/renderer/src/components/WebviewCard.tsx`（`WebviewCardRef` 接口 `:113-140` + `enableImageGeneration` 实现附近 `:708-723` 加新方法）

**Interfaces:**
- Consumes: `generateExtractImagesScript`（Task 1）、`selectors`（WebviewCard 已有 props/selectors）、`Electron.WebviewTag`
- Produces: `WebviewCardRef.extractGeneratedImages(): Promise<{ images: Array<{ src: string; mime?: string }>; wcId: number | null; error?: string }>` —— `wcId` 来自 `webview.getWebContentsId()`

- [ ] **Step 1: 在 `WebviewCardRef` 接口加方法声明**

在 `disableImageGeneration` 声明之后（约 `:122`）加：

```ts
  /** 提取当前 webview 最新回复中的生图（img/canvas/a[href]/blob→data），返回 src 列表与 wcId */
  extractGeneratedImages: () => Promise<{ images: Array<{ src: string; mime?: string }>; wcId: number | null; error?: string }>
```

- [ ] **Step 2: 在 `useImperativeHandle` 实现里加方法**

在 `disableImageGeneration` 实现之后（约 `:745`，紧跟其 `catch` 块后）加。模式照抄 `enableImageGeneration`（`:708-723`）：拿 `webviewRef.current`、判 `isReady`/`selectors`、`executeJavaScript`、try/catch。同时取 wcId（参考 `:595` 的 `(webview as any).getWebContentsId()` 写法，但这里只读不改）。

```ts
      extractGeneratedImages: async () => {
        const webview = webviewRef.current
        if (!webview || !isReady || !selectors) {
          return { images: [], wcId: null, error: 'Webview 未就绪' }
        }
        const wcId = typeof (webview as any).getWebContentsId === 'function' ? (webview as any).getWebContentsId() : null
        try {
          const code = generateExtractImagesScript(selectors)
          const result = await webview.executeJavaScript(code)
          if (result && result.success) {
            return { images: result.images || [], wcId }
          }
          return { images: [], wcId, error: result?.error || '提取失败' }
        } catch (error) {
          return { images: [], wcId, error: String(error) }
        }
      },
```

确认文件顶部已 import `generateExtractImagesScript`（与 `generateEnableImageGenerationScript` 同一模块，按现有 import 行追加）。

- [ ] **Step 3: 类型检查 + Lint**

Run: `npm run build && npm run lint`
Expected: 通过。

- [ ] **Step 4: Commit**

```bash
git add src/renderer/src/components/WebviewCard.tsx
git commit -m "feat(image): WebviewCardRef 暴露 extractGeneratedImages"
```

---

### Task 3: appStore 加 extractImagesFromAll 遍历方法

**Files:**
- Modify: `src/renderer/src/store/appStore.ts`（接口类型 `:363-367` 附近 + 实现 `:1342` `disableImageGenerationForAll` 之后）

**Interfaces:**
- Consumes: `WebviewCardRef.extractGeneratedImages`（Task 2）、`getDisplayedModels`/`webviewRefs`/`displayMode` 等（store 内已有）、`IMAGE_GENERATION_SUPPORTED_MODEL_IDS`（已有 `:459`）
- Produces: `AppStore.extractImagesFromAll(): Promise<ExtractImagesResult[]>`，其中 `ExtractImagesResult = { modelId: string; wcId: number | null; images: Array<{ src: string; mime?: string }>; error?: string }`

- [ ] **Step 1: 定义类型**

在 store 类型定义区（`IMAGE_GENERATION_UNSUPPORTED_ERROR` 附近 `:471` 后）加：

```ts
export interface ExtractedImage {
  src: string
  mime?: string
}

export interface ExtractImagesResult {
  modelId: string
  wcId: number | null
  images: ExtractedImage[]
  error?: string
}
```

- [ ] **Step 2: 在 `AppStore` 接口加方法签名**

在 `disableImageGenerationForAll` 声明之后（约 `:367`）加：

```ts
  // 一键提取所有窗口生图
  extractImagesFromAll: () => Promise<ExtractImagesResult[]>
```

- [ ] **Step 3: 实现方法**

在 `disableImageGenerationForAll` 实现之后（约 `:1364`）加。照抄 `enableImageGenerationForAll`（`:1322-1342`）的遍历模式，但不过滤不支持生图的模型（用户可能在非生图模式窗口里也有图要下）——对所有 displayedModels 都尝试提取：

```ts
  extractImagesFromAll: async (): Promise<ExtractImagesResult[]> => {
    const { models, webviewRefs, displayMode, productMode, taskAssignmentSlots, multiAiSlots, debateSlots } = get()
    const displayedModels = getDisplayedModels(models, displayMode, productMode, taskAssignmentSlots, multiAiSlots, debateSlots)
    const extractPromises = displayedModels.map(async (model, index) => {
      const webviewRef = webviewRefs.get(`slot-${index}`) || webviewRefs.get(model.id)
      if (!webviewRef) return { modelId: model.id, wcId: null, images: [], error: 'Webview 未注册' }
      try {
        const result = await webviewRef.extractGeneratedImages()
        return { modelId: model.id, wcId: result.wcId, images: result.images, error: result.error }
      } catch (error) {
        return { modelId: model.id, wcId: null, images: [], error: String(error) }
      }
    })
    return Promise.all(extractPromises)
  },
```

- [ ] **Step 4: 类型检查 + Lint**

Run: `npm run build && npm run lint`
Expected: 通过。

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/store/appStore.ts
git commit -m "feat(image): appStore 新增 extractImagesFromAll 遍历方法"
```

---

### Task 4: 主进程 image:download-all IPC

**Files:**
- Modify: `src/main/ipcHandlers.ts`（在 `save-image-from-url` handler `:925-967` 之后新增）
- Modify: `src/preload/index.ts`（在 `saveImageFromURL` `:212-213` 之后新增）
- Modify: `src/preload/index.d.ts`（在 `saveImageFromURL` `:140` 之后新增）
- Modify: `src/renderer/src/env.d.ts`（在 `saveImageFromURL` `:83` 之后新增）

**Interfaces:**
- Consumes: `dialog`（electron，已 import）、`fs/promises writeFile`、`path.join`/`basename`（已 import `basename`）、`ExtractedImage`/`ExtractImagesResult`（Task 3，但主进程不直接依赖 store 类型——payload 用结构化类型自描述，避免 main↔renderer 类型耦合）
- Produces: IPC `image:download-all`，入参 `{ items: Array<{ modelId: string; wcId: number | null; images: Array<{ src: string; mime?: string }> }> }`，返回 `{ success: boolean; data?: { perModel: Array<{ modelId: string; saved: number; failed: number; errors: string[] }> }; error?: string }`；preload 暴露 `downloadAllImages(payload): Promise<{ success; data?; error? }>`

- [ ] **Step 1: 在主进程注册 handler**

在 `save-image-from-url` handler 之后（约 `:967`）加。逻辑：`dialog.showOpenDialog({ properties: ['openDirectory'], title: '选择图片保存目录' })`；取消则返回 `{ success:false, error:'用户取消' }`；同批用一次 `new Date()` 生成 `ts = YYYYMMDD-HHmmss`；对每个 item 的每张图：`data:` → 正则取 base64 + mime → `Buffer.from(b64,'base64')` + `writeFile`；`http(s):`/`blob:`（blob 未转成功的情况）→ `fetch(src)` 取 `arrayBuffer` → `Buffer` + `writeFile`；扩展名从 mime 映射（`image/png`→`png`，`image/jpeg`→`jpg`，`image/webp`→`webp`，`image/gif`→`gif`，其它→`png`）；命名 `{modelId}-{ts}-{idx}.{ext}`；单张失败记入 `errors` 并继续。

```ts
    ipcMain.handle('image:download-all', async (_event, payload: {
      items: Array<{ modelId: string; wcId: number | null; images: Array<{ src: string; mime?: string }> }>
    }) => {
        try {
            if (!payload?.items?.length) {
                return { success: false, error: '无可下载的图片' }
            }
            const dirResult = await dialog.showOpenDialog({
                title: '选择图片保存目录',
                properties: ['openDirectory']
            })
            if (dirResult.canceled || !dirResult.filePaths?.length) {
                return { success: false, error: '用户取消' }
            }
            const dir = dirResult.filePaths[0]
            const now = new Date()
            const pad = (n: number) => String(n).padStart(2, '0')
            const ts = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`
            const { writeFile } = await import('fs/promises')
            const extByMime: Record<string, string> = {
                'image/png': 'png',
                'image/jpeg': 'jpg',
                'image/webp': 'webp',
                'image/gif': 'gif',
                'image/bmp': 'bmp'
            }
            const perModel: Array<{ modelId: string; saved: number; failed: number; errors: string[] }> = []
            for (const item of payload.items) {
                let saved = 0
                let failed = 0
                const errors: string[] = []
                item.images.forEach((img, idx) => {
                    try {
                        const mime = img.mime || 'image/png'
                        const ext = extByMime[mime] || 'png'
                        const fileName = `${item.modelId}-${ts}-${idx + 1}.${ext}`
                        const filePath = path.join(dir, fileName)
                        // 异步写入收集，保持顺序与错误隔离
                        ;(async () => {
                            try {
                                if (img.src.startsWith('data:')) {
                                    const match = img.src.match(/^data:.*?;base64,(.*)$/)
                                    if (!match) throw new Error('无效 data URL')
                                    await writeFile(filePath, Buffer.from(match[1], 'base64'))
                                } else {
                                    const resp = await fetch(img.src)
                                    if (!resp.ok) throw new Error(`HTTP ${resp.status}`)
                                    const buf = Buffer.from(await resp.arrayBuffer())
                                    await writeFile(filePath, buf)
                                }
                                saved++
                            } catch (e) {
                                failed++
                                errors.push(`图 ${idx + 1}: ${String(e)}`)
                            }
                        })()
                    } catch (e) {
                        failed++
                        errors.push(`图 ${idx + 1}: ${String(e)}`)
                    }
                })
                perModel.push({ modelId: item.modelId, saved, failed, errors })
            }
            return { success: true, data: { perModel } }
        } catch (error) {
            return { success: false, error: String(error) }
        }
    })
```

> **注意上面 forEach 内的 IIFE 异步问题**：`saved`/`failed` 在异步 IIFE 里自增，但 return 时可能还没完成。**修正**：把内层改成 `await` 串行或用 `Promise.all`。最终落地用如下同步可 await 的写法替换上面的 forEach 块：

```ts
                for (let idx = 0; idx < item.images.length; idx++) {
                    const img = item.images[idx]
                    const mime = img.mime || 'image/png'
                    const ext = extByMime[mime] || 'png'
                    const fileName = `${item.modelId}-${ts}-${idx + 1}.${ext}`
                    const filePath = path.join(dir, fileName)
                    try {
                        if (img.src.startsWith('data:')) {
                            const match = img.src.match(/^data:.*?;base64,(.*)$/)
                            if (!match) throw new Error('无效 data URL')
                            await writeFile(filePath, Buffer.from(match[1], 'base64'))
                        } else {
                            const resp = await fetch(img.src)
                            if (!resp.ok) throw new Error(`HTTP ${resp.status}`)
                            const buf = Buffer.from(await resp.arrayBuffer())
                            await writeFile(filePath, buf)
                        }
                        saved++
                    } catch (e) {
                        failed++
                        errors.push(`图 ${idx + 1}: ${String(e)}`)
                    }
                }
                perModel.push({ modelId: item.modelId, saved, failed, errors })
```

确认 `path` 已 import（文件已有 `basename`，说明 `import path from 'path'` 或等价存在；若无则补 `import path from 'path'`）。

- [ ] **Step 2: preload 暴露**

在 `src/preload/index.ts` `saveImageFromURL` 之后（`:213`）加：

```ts
  downloadAllImages: (payload: {
    items: Array<{ modelId: string; wcId: number | null; images: Array<{ src: string; mime?: string }> }>
  }): Promise<{ success: boolean; data?: { perModel: Array<{ modelId: string; saved: number; failed: number; errors: string[] }> }; error?: string }> =>
    ipcRenderer.invoke('image:download-all', payload),
```

- [ ] **Step 3: index.d.ts 声明类型**

在 `src/preload/index.d.ts` `saveImageFromURL` 之后（`:140`）加：

```ts
      downloadAllImages: (payload: {
        items: Array<{ modelId: string; wcId: number | null; images: Array<{ src: string; mime?: string }> }>
      }) => Promise<{ success: boolean; data?: { perModel: Array<{ modelId: string; saved: number; failed: number; errors: string[] }> }; error?: string }>
```

- [ ] **Step 4: env.d.ts 声明类型**

在 `src/renderer/src/env.d.ts` `saveImageFromURL` 之后（`:83`）加同样声明：

```ts
      downloadAllImages: (payload: {
        items: Array<{ modelId: string; wcId: number | null; images: Array<{ src: string; mime?: string }> }>
      }) => Promise<{ success: boolean; data?: { perModel: Array<{ modelId: string; saved: number; failed: number; errors: string[] }> }; error?: string }>
```

- [ ] **Step 5: 类型检查 + Lint**

Run: `npm run build && npm run lint`
Expected: 通过。

- [ ] **Step 6: Commit**

```bash
git add src/main/ipcHandlers.ts src/preload/index.ts src/preload/index.d.ts src/renderer/src/env.d.ts
git commit -m "feat(image): 新增 image:download-all IPC 批量落盘"
```

---

### Task 5: ControlBar 一键下载按钮接线

**Files:**
- Modify: `src/renderer/src/components/ControlBar.tsx`（onClick `:802-811`）

**Interfaces:**
- Consumes: `extractImagesFromAll`（Task 3，从 `useAppStore` 取）、`downloadAllImages`（`window.api`，Task 4）、`showNotification`（已有）

- [ ] **Step 1: 确认 ControlBar 已从 store 取到 `extractImagesFromAll`**

搜索 ControlBar 顶部 `useAppStore` 取值处，若未取 `extractImagesFromAll` 则补加（与 `isImageGeneration` 同处取）：

```ts
const extractImagesFromAll = useAppStore(s => s.extractImagesFromAll)
```

- [ ] **Step 2: 新增下载处理函数**

在组件内（`handleSend` 附近或组件顶部）加 `handleDownloadAllImages`：

```ts
  const handleDownloadAllImages = async () => {
    try {
      const results = await extractImagesFromAll()
      const items = results
        .filter(r => r.images.length > 0)
        .map(r => ({ modelId: r.modelId, wcId: r.wcId, images: r.images }))
      const noImageCount = results.length - items.length
      if (items.length === 0) {
        showNotification('info', '未检测到生图，请确认图片已生成')
        return
      }
      const res = await window.api?.downloadAllImages?.({ items })
      if (!res?.success) {
        showNotification('error', res?.error || '下载失败')
        return
      }
      const saved = res.data!.perModel.reduce((s, p) => s + p.saved, 0)
      const failed = res.data!.perModel.reduce((s, p) => s + p.failed, 0)
      showNotification(
        saved && !failed ? 'success' : 'info',
        `已下载 ${saved} 张${failed ? `，失败 ${failed} 张` : ''}${noImageCount ? `，${noImageCount} 个窗口无图` : ''}`
      )
    } catch (error) {
      showNotification('error', `下载异常: ${String(error)}`)
    }
  }
```

- [ ] **Step 3: 替换 TODO toast**

把 `:807` 的 `showNotification('info', '一键下载图片功能已记录 TODO')` 替换为 `handleDownloadAllImages()`：

```tsx
              } else if (isImageGeneration) {
                handleDownloadAllImages()
              } else {
```

- [ ] **Step 4: 类型检查 + Lint**

Run: `npm run build && npm run lint`
Expected: 通过。

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/components/ControlBar.tsx
git commit -m "feat(image): 一键下载按钮接线批量下载链路"
```

---

### Task 6: 手动验证

项目无测试运行器，验证必须在 `npm run dev` 桌面环境手动进行。

- [ ] **Step 1: 启动 dev**

Run: `npm run dev`
Expected: 桌面窗口打开。

- [ ] **Step 2: 主流程验证**

操作：开 AI 生图模式 → 至少 gemini/grok/chatgpt 三个窗口各发一次生图提示词 → 等图片在窗口内显示 → 点「一键下载」→ 选一个空目录 → 检查目录。
Expected: 目录里出现 `gemini-{ts}-1.png`、`grok-{ts}-1.png`、`chatgpt-{ts}-1.png`（扩展名按实际平台），文件可正常打开且为原图（非缩略图/头像）。

- [ ] **Step 3: 边界验证**

- 某窗口无图：点下载 → toast 含「X 个窗口无图」，其它窗口正常下载。
- 目录取消：选目录框点取消 → toast「用户取消」。
- blob 渲染平台：若某平台图为 blob:，验证落盘文件可打开（说明页内转 data: 成功）。

- [ ] **Step 4: 记录 session log**

Run: `python .memory/session_log.py --done "一键下载所有窗口生图" --modified "src/shared/utils/webviewScripts.ts,src/renderer/src/components/WebviewCard.tsx,src/renderer/src/store/appStore.ts,src/main/ipcHandlers.ts,src/preload/index.ts,src/preload/index.d.ts,src/renderer/src/env.d.ts,src/renderer/src/components/ControlBar.tsx"`

---

## Self-Review 结果

**Spec coverage**：设计稿各节均有对应 Task——脚本(Task1)、ref方法(Task2)、store遍历(Task3)、IPC+契约同步(Task4)、按钮接线(Task5)、验证(Task6)。

**Placeholder scan**：无 TBD/TODO 占位；所有代码块完整。Task 4 已内联修正 forEach→for await 的异步竞态问题。

**Type consistency**：`ExtractedImage`/`ExtractImagesResult` 在 Task 3 定义，Task 2/4/5 用结构化类型；`extractGeneratedImages`/`extractImagesFromAll`/`downloadAllImages` 名称跨 Task 一致；payload 结构 `{items:[{modelId,wcId,images}]}` 在 Task 4/5 一致。

**已知限制**：blob: 转 data: 若页内 fetch 失败（跨域 tainted），该图会以 blob: src 传回主进程，主进程 fetch 会失败计入 `failed`——这是预期行为，无更好兜底。
