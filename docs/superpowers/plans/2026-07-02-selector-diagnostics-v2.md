# 选择器诊断独立窗口 v2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development 或 superpowers:executing-plans 按 task 执行。Steps 用 `- [ ]` 跟踪。

**Goal:** 把 v1 的 messageContainer 诊断抽屉升级为独立 BrowserWindow 双 Tab 诊断窗口（messageContainer + researchMode 只读探针 + researchMode 实跑按钮），入口移入 SettingsDrawer，经跨窗口 IPC 代理访问主窗口 webview。

**Architecture:** 主进程新建 `diagnosticsWindow`（仿 `quickWindow`，loadURL `#diagnostics`）。renderer 加 `#diagnostics` hash 路由 → `DiagnosticsPage` 双 Tab。诊断窗口经 IPC（`diagnostics:probe`/`diagnostics:run-research`）由主进程透传给主窗口 renderer，主窗口查 `webviewRefs.get(id)` 执行 `probeMessageContainer`/`probeResearchMode`/`enableDeepResearch`，结果回传。researchMode 探针复刻 `webviewScripts.ts:640-781` 的 `findElement`+`findMenuOpener`（同源，只读不点击）。

**Tech Stack:** TypeScript (strict), React 18, Zustand 4, Tailwind 3, Electron 28 (BrowserWindow + ipcMain/ipcRenderer), electron-vite。

## Global Constraints

- **分层**：窗口/IPC 逻辑在 `src/main`，桥接在 `src/preload`，页面/UI 在 `src/renderer`。禁止跨层塞逻辑。
- **IPC 约束**：新增 IPC 必须同时同步 `src/main/ipcHandlers.ts`、`src/preload/index.ts`、`src/preload/index.d.ts` 及调用点；返回结构统一 `{ success, data?, error? }`。
- **同源铁律**：researchMode 探针的 `findElement`/`findMenuOpener` 必须与 `src/shared/utils/webviewScripts.ts:640-781` 一致，注释注明来源行号。
- **脱敏铁律**：探针报告只含 tagName+className+id+data-testid+可见正文长度；不含 outerHTML/正文/其他属性值。
- **DEV 门控**：诊断入口与窗口仅在 `import.meta.env.DEV` 为真时可用；production build 不含入口按钮（窗口函数仍存在但无 UI 触发点）。
- **不修改生产匹配逻辑**：`webviewScripts.ts` 的 `findElement`/`findMenuOpener` 只作同源拷贝来源，不改其本体。
- **包管理器**：npm only。
- **无测试运行器**：验证 = `npm run lint` → `npm run build` → `npm run dev` 手动。
- **不擅自切分支**。本计划在 worktree `selector-diagnostics-v2` 执行。
- **Commit**：Conventional Commits，结尾 `Co-Authored-By: Claude <noreply@anthropic.com>`。
- **复用 v1**：`buildProbeScript`/`parseProbeResult`/`ProbeReport`/`probeMessageContainer` 不动。

---

## File Structure

| 文件 | 责任 | 类型 |
|---|---|---|
| `src/renderer/src/utils/selectorDiagnostics.ts` | v1 messageContainer 探针 + 新增 researchMode 探针 | 扩展 |
| `src/renderer/src/components/WebviewCard.tsx` | v1 probeMessageContainer + 新增 probeResearchMode | 小改 |
| `src/main/webviewManager.ts` | 新增 `diagnosticsWindow` + `openDiagnosticsWindow()` | 新增函数 |
| `src/main/ipcHandlers.ts` | 新增 `diagnostics:open-window`/`probe`/`run-research` 透传 | 新增 |
| `src/preload/index.ts` | 新增 `diagnosticsOpenWindow`/`diagnosticsProbe`/`diagnosticsRunResearch` + 主窗口侧 `onDiagnosticsProbeRequest`/`onDiagnosticsRunResearchRequest` + `diagnosticsProbeResponse`/`diagnosticsRunResearchResponse` | 新增 |
| `src/preload/index.d.ts` | 上述 API 类型声明 | 新增 |
| `src/renderer/src/store/appStore.ts` | `currentPage` 加 `'diagnostics'`；新增主窗口透传响应 action | 小改 |
| `src/renderer/src/App.tsx` | `#diagnostics` hash 监听 + 渲染分支 | 小改 |
| `src/renderer/src/pages/DiagnosticsPage.tsx` | 双 Tab 诊断页面 | 新增 |
| `src/renderer/src/components/SettingsDrawer.tsx` | dev-only "选择器诊断" 按钮 → `diagnosticsOpenWindow()` | 小改 |
| `src/renderer/src/components/Layout.tsx` | 移除 v1 顶栏 🔬 按钮 + isDiagnosticsOpen + SelectorDiagnosticsPanel 挂载 | 小改 |
| `docs/选择器维护方法论.md` | 补 researchMode 闭环 + 独立窗口用法 | 更新 |

---

## Task 1: researchMode 探针纯函数

**Files:**
- Modify: `src/renderer/src/utils/selectorDiagnostics.ts`（v1 已存在，扩展）

**Interfaces:**
- Consumes: `AutomationStep` 类型（来自 `../../shared/config/selectors`）
- Produces:
  ```typescript
  export interface StepReport {
    index: number
    selector: string
    found: boolean
    matchedVia: 'selector' | 'semantic-fallback' | 'menu-opener-fallback' | null
    firstHit: { tag: string; className: string | null; id: string | null; dataTestid: string | null; visibleTextLen: number } | null
    error?: string
  }
  export interface ResearchProbeReport { ok: boolean; steps: StepReport[]; error?: string }
  export function buildResearchProbeScript(steps: AutomationStep[]): string
  export function parseResearchProbeResult(raw: unknown): ResearchProbeReport
  ```

- [ ] **Step 1: 加 AutomationStep import 与新类型**

在 `src/renderer/src/utils/selectorDiagnostics.ts` 顶部 import 区加：
```typescript
import type { AutomationStep } from '../../shared/config/selectors'
```
在文件末尾追加 `StepReport`/`ResearchProbeReport` 接口（见 Produces 块）。

- [ ] **Step 2: 实现 buildResearchProbeScript**

追加。该脚本被 `webview.executeJavaScript` 注入，复刻 `webviewScripts.ts:640-781` 的 `findElement`+`findMenuOpener`，但**只读不点击**。对每个 step 报告 found/matchedVia/firstHit：

```typescript
export function buildResearchProbeScript(steps: AutomationStep[]): string {
  return `(function () {
    var steps = ${JSON.stringify(steps)};

    // 来源: webviewScripts.ts:640-748 findElement（只读复刻，去掉 normalizeClickable 的点击相关）
    function matchText(content, ariaLabel, o) {
      var text = o.text;
      var textList = Array.isArray(text) ? text : [text];
      for (var ti = 0; ti < textList.length; ti++) {
        var t = textList[ti];
        if (!t) continue;
        if (o.regex) {
          var pat = String(o.regex);
          var flags = o.caseSensitive ? '' : 'i';
          if (o.wordBoundary !== false) {
            if (!/^\\^/.test(pat)) pat = '\\\\b(?:' + pat + ')';
            if (!/\\$$/.test(pat)) pat = pat + '\\\\b';
          }
          try {
            var re = new RegExp(pat, flags);
            if (re.test(content) || re.test(ariaLabel)) return true;
          } catch (e) {}
        } else if (o.exact) {
          if (content === t || ariaLabel === t) return true;
        } else {
          var lc = (content || '').toLowerCase();
          var la = (ariaLabel || '').toLowerCase();
          var lt = String(t).toLowerCase();
          if (lc.includes(lt) || la.includes(lt)) return true;
        }
      }
      return false;
    }

    function describeFirst(el) {
      if (!el) return null;
      var text = '';
      try { text = (el.innerText || el.textContent || '') + ''; } catch (e) { text = ''; }
      return {
        tag: (el.tagName || '').toLowerCase(),
        className: (typeof el.className === 'string' ? el.className : null),
        id: el.getAttribute('id') || null,
        dataTestid: el.getAttribute('data-testid') || null,
        visibleTextLen: text.replace(/\\u200B/g, '').trim().length
      };
    }

    function findElementForStep(step) {
      var selector = step.selector;
      var text = step.text;
      var o = step;
      var selectorList = Array.isArray(selector) ? selector : [selector];
      for (var si = 0; si < selectorList.length; si++) {
        var sel = selectorList[si];
        var elements = null;
        try { elements = document.querySelectorAll(sel); } catch (e) { continue; }
        if (!text && !o.regex) {
          for (var vi = 0; vi < elements.length; vi++) {
            var vel = elements[vi];
            if (vel.getBoundingClientRect().width > 0 || vel.offsetParent !== null) {
              return { el: vel, via: 'selector' };
            }
          }
          if (elements && elements[0]) return { el: elements[0], via: 'selector' };
          continue;
        }
        for (var mi = 0; mi < elements.length; mi++) {
          var el = elements[mi];
          if (el.getBoundingClientRect().width === 0 && el.offsetParent === null) continue;
          var content = (el.innerText || el.textContent || '').trim();
          var ariaLabel = el.getAttribute('aria-label') || el.getAttribute('title') || '';
          if (matchText(content, ariaLabel, o)) return { el: el, via: 'selector' };
        }
      }
      // 来源: webviewScripts.ts:726-745 策略二降级（语义兜底）
      if (text || (o && o.regex)) {
        var semanticSelectors = 'button, [role="button"], [role="radio"], [role="switch"], [role="checkbox"], [role="menuitem"], [role="menuitemradio"], [role="tab"], label, input[type="checkbox"], input[type="radio"]';
        var semanticElements = [];
        try { semanticElements = document.querySelectorAll(semanticSelectors); } catch (e) {}
        for (var sei = 0; sei < semanticElements.length; sei++) {
          var sel2 = semanticElements[sei];
          if (sel2.getBoundingClientRect().width === 0 && sel2.offsetParent === null) continue;
          var content2 = (sel2.innerText || sel2.textContent || '').trim();
          var ariaLabel2 = sel2.getAttribute('aria-label') || sel2.getAttribute('title') || '';
          if (matchText(content2, ariaLabel2, o)) return { el: sel2, via: 'semantic-fallback' };
        }
      }
      return null;
    }

    // 来源: webviewScripts.ts:765-781 findMenuOpener
    function findMenuOpener() {
      var openerRegex = /\\+|plus|more|tools?|menu|菜单|更多|工具|附加|添加/i;
      var all = document.querySelectorAll('[aria-haspopup="menu"], [aria-haspopup="true"], button, [role="button"]');
      var candidates = [];
      for (var i = 0; i < all.length; i++) {
        var el = all[i];
        if (el.getBoundingClientRect().width === 0 && el.offsetParent === null) continue;
        var aria = el.getAttribute('aria-label') || el.getAttribute('title') || '';
        var txt = (el.innerText || el.textContent || '').trim();
        var hasMenu = /^(menu|true)$/i.test(el.getAttribute('aria-haspopup') || '');
        var score = (hasMenu ? 2 : 0) + (openerRegex.test(aria) ? 2 : 0) + (openerRegex.test(txt) ? 1 : 0);
        if (score > 0) candidates.push({ el: el, score: score });
      }
      if (!candidates.length) return null;
      candidates.sort(function(a, b) { return b.score - a.score; });
      return { el: candidates[0].el, via: 'menu-opener-fallback' };
    }

    var reports = steps.map(function (step, idx) {
      var err = null;
      var found = null;
      try {
        found = findElementForStep(step);
        if (!found && step.menuOpenerFallback) {
          found = findMenuOpener();
        }
      } catch (e) {
        err = String(e && e.message ? e.message : e);
      }
      var r = {
        index: idx,
        selector: Array.isArray(step.selector) ? step.selector[0] : String(step.selector),
        found: !!found,
        matchedVia: found ? found.via : null,
        firstHit: found ? describeFirst(found.el) : null
      };
      if (err) r.error = err;
      return r;
    });

    return JSON.stringify({ ok: true, steps: reports });
  })();`
}
```

- [ ] **Step 3: 实现 parseResearchProbeResult**

```typescript
export function parseResearchProbeResult(raw: unknown): ResearchProbeReport {
  if (typeof raw !== 'string') {
    return { ok: false, steps: [], error: '探针返回非字符串' }
  }
  try {
    const parsed = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.steps)) {
      return { ok: false, steps: [], error: '探针返回结构异常' }
    }
    return { ok: !!parsed.ok, steps: parsed.steps as StepReport[] }
  } catch (e) {
    return { ok: false, steps: [], error: `结果解析失败: ${String(e)}` }
  }
}
```

- [ ] **Step 4: 类型检查 + lint**

Run: `npx tsc --noEmit -p tsconfig.web.json`
Expected: 无新增类型错误（注意：仓库有预存 tsc 错误在无关文件，只确认本文件无错）。

Run: `npm run lint`
Expected: 无新增错误。

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/utils/selectorDiagnostics.ts
git commit -m "feat(renderer): add researchMode probe utils

buildResearchProbeScript/parseResearchProbeResult，复刻
webviewScripts.ts:640-781 的 findElement+findMenuOpener（同源只读）。

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 2: WebviewCardRef 加 probeResearchMode

**Files:**
- Modify: `src/renderer/src/components/WebviewCard.tsx`

**Interfaces:**
- Consumes: `buildResearchProbeScript`, `parseResearchProbeResult`, `ResearchProbeReport`（Task 1）；`selectors.researchMode?.steps`
- Produces: `WebviewCardRef.probeResearchMode: () => Promise<ResearchProbeReport>`

- [ ] **Step 1: 扩展 import**

在 `src/renderer/src/components/WebviewCard.tsx` 现有 `import { buildProbeScript, parseProbeResult, type ProbeReport } from '../utils/selectorDiagnostics'` 行追加：
```typescript
import { buildResearchProbeScript, parseResearchProbeResult, type ResearchProbeReport } from '../utils/selectorDiagnostics'
```
（或合并为一行 import，按代码风格）

- [ ] **Step 2: 接口加方法**

`WebviewCardRef` 接口（v1 已有 `probeMessageContainer`）追加：
```typescript
  /** dev-only：对当前页面跑 researchMode 探针，返回每步命中报告（只读） */
  probeResearchMode: () => Promise<ResearchProbeReport>
```

- [ ] **Step 3: useImperativeHandle 实现**

在 `probeMessageContainer` 实现之后追加：
```typescript
      probeResearchMode: async (): Promise<ResearchProbeReport> => {
        const webview = webviewRef.current
        if (!webview) {
          return { ok: false, steps: [], error: 'Webview ref 为空' }
        }
        const steps = selectors?.researchMode?.steps ?? []
        if (steps.length === 0) {
          return { ok: false, steps: [], error: '该平台无 researchMode 配置' }
        }
        try {
          const raw = await webview.executeJavaScript(buildResearchProbeScript(steps))
          return parseResearchProbeResult(raw)
        } catch (error) {
          return { ok: false, steps: [], error: `页面未就绪或执行失败: ${String(error)}` }
        }
      },
```

- [ ] **Step 4: lint + tsc**

Run: `npm run lint` → 无新增错误。
Run: `npx tsc --noEmit -p tsconfig.web.json` → WebviewCard.tsx 无新增错误。

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/components/WebviewCard.tsx
git commit -m "feat(webview): expose probeResearchMode on WebviewCardRef

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 3: 主进程 diagnosticsWindow + IPC 透传

**Files:**
- Modify: `src/main/webviewManager.ts`（新增 `diagnosticsWindow` + `openDiagnosticsWindow()`）
- Modify: `src/main/ipcHandlers.ts`（新增 3 个 handler）

**Interfaces:**
- Consumes: `BrowserWindow`、`is.dev`、`process.env['ELECTRON_RENDERER_URL']`、主窗口 `mainWindow.webContents`
- Produces: `openDiagnosticsWindow()` 导出；3 个 ipcMain handler：`diagnostics:open-window`、`diagnostics:probe`、`diagnostics:run-research`

- [ ] **Step 1: webviewManager 加 diagnosticsWindow**

在 `src/main/webviewManager.ts` 的 `quickWindow` 声明（`:20`）附近追加：
```typescript
let diagnosticsWindow: BrowserWindow | null = null
export function getDiagnosticsWindow(): BrowserWindow | null { return diagnosticsWindow }
```

在 `quickWindow` 创建函数（`openQuickWindow` 约 `:654`）之后追加新函数：
```typescript
export function openDiagnosticsWindow(): void {
  if (diagnosticsWindow && !diagnosticsWindow.isDestroyed()) {
    if (diagnosticsWindow.isMinimized()) diagnosticsWindow.restore()
    diagnosticsWindow.show()
    diagnosticsWindow.focus()
    return
  }
  diagnosticsWindow = new BrowserWindow({
    width: 900,
    height: 700,
    minWidth: 480,
    minHeight: 400,
    show: false,
    frame: false,
    alwaysOnTop: false,
    skipTaskbar: false,
    backgroundColor: '#ffffff',
    icon: getWindowIcon(),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false,
      webviewTag: false,
      partition: 'persist:shared'
    }
  })
  diagnosticsWindow.on('closed', () => { diagnosticsWindow = null })
  const hash = 'diagnostics'
  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    void diagnosticsWindow.loadURL(`${process.env['ELECTRON_RENDERER_URL']}/#${hash}`)
  } else {
    void diagnosticsWindow.loadFile(join(__dirname, '../renderer/index.html'), { hash })
  }
  diagnosticsWindow.once('ready-to-show', () => {
    diagnosticsWindow?.show()
  })
}
```

- [ ] **Step 2: ipcHandlers 加 open-window handler**

在 `src/main/ipcHandlers.ts` 适当位置（其他 handler 附近）加：
```typescript
import { openDiagnosticsWindow, getMainWindow } from './webviewManager'

ipcMain.handle('diagnostics:open-window', () => {
  openDiagnosticsWindow()
  return { success: true }
})
```
（若 `getMainWindow` 已 import 则不重复；按文件现有 import 调整）

- [ ] **Step 3: ipcHandlers 加 probe 透传 handler**

透传机制：主进程生成 `reqId`，发给主窗口，主窗口处理后回 `diagnostics:probe-response`，主进程用 `Map<reqId, {resolve,reject}>` 关联，5s 超时。

```typescript
const pendingProbeRequests = new Map<string, { resolve: (v: unknown) => void; reject: (e: unknown) => void; timer: ReturnType<typeof setTimeout> }>()

ipcMain.handle('diagnostics:probe', async (_e, payload: { modelId: string; type: 'message' | 'research' }) => {
  const mainWin = getMainWindow()
  if (!mainWin || mainWin.isDestroyed()) {
    return { success: false, error: '主窗口未就绪' }
  }
  const reqId = `probe-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      pendingProbeRequests.delete(reqId)
      resolve({ success: false, error: '主窗口响应超时' })
    }, 5000)
    pendingProbeRequests.set(reqId, { resolve, reject: resolve as never, timer })
    mainWin.webContents.send('diagnostics:probe-request', { reqId, ...payload })
  })
})

ipcMain.on('diagnostics:probe-response', (_e, payload: { reqId: string; result: unknown }) => {
  const pending = pendingProbeRequests.get(payload.reqId)
  if (!pending) return
  clearTimeout(pending.timer)
  pendingProbeRequests.delete(payload.reqId)
  pending.resolve({ success: true, data: payload.result })
})
```

- [ ] **Step 4: ipcHandlers 加 run-research 透传 handler**

同理：
```typescript
const pendingRunResearchRequests = new Map<string, { resolve: (v: unknown) => void; timer: ReturnType<typeof setTimeout> }>()

ipcMain.handle('diagnostics:run-research', async (_e, payload: { modelId: string }) => {
  const mainWin = getMainWindow()
  if (!mainWin || mainWin.isDestroyed()) {
    return { success: false, error: '主窗口未就绪' }
  }
  const reqId = `run-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      pendingRunResearchRequests.delete(reqId)
      resolve({ success: false, error: '主窗口响应超时' })
    }, 15000)
    pendingRunResearchRequests.set(reqId, { resolve, timer })
    mainWin.webContents.send('diagnostics:run-research-request', { reqId, ...payload })
  })
})

ipcMain.on('diagnostics:run-research-response', (_e, payload: { reqId: string; result: { success: boolean; error?: string } }) => {
  const pending = pendingRunResearchRequests.get(payload.reqId)
  if (!pending) return
  clearTimeout(pending.timer)
  pendingRunResearchRequests.delete(payload.reqId)
  pending.resolve({ success: true, data: payload.result })
})
```

- [ ] **Step 5: 构建验证**

Run: `npm run build`
Expected: 主进程 bundle 构建成功，无 TS 错误（主进程用 tsconfig.node.json，应无预存错误）。

- [ ] **Step 6: Commit**

```bash
git add src/main/webviewManager.ts src/main/ipcHandlers.ts
git commit -m "feat(main): add diagnosticsWindow + IPC relay handlers

openDiagnosticsWindow 仿 quickWindow 加载 #diagnostics；
diagnostics:probe/run-research 经 reqId 透传主窗口，超时兜底。

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 4: preload IPC 契约（端到端同步）

**Files:**
- Modify: `src/preload/index.ts`（api 加方法）
- Modify: `src/preload/index.d.ts`（类型声明）

**Interfaces:**
- Consumes: Task 3 的 IPC channel 名
- Produces: `window.api.diagnosticsOpenWindow()`、`diagnosticsProbe(modelId, type)`、`diagnosticsRunResearch(modelId)`、`onDiagnosticsProbeRequest(cb)`、`diagnosticsProbeResponse(reqId, result)`、`onDiagnosticsRunResearchRequest(cb)`、`diagnosticsRunResearchResponse(reqId, result)`

- [ ] **Step 1: index.ts 加诊断窗口侧 API**

在 `src/preload/index.ts` 的 `api` 对象（`quickShow` 附近）加：
```typescript
  diagnosticsOpenWindow: (): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke('diagnostics:open-window'),
  diagnosticsProbe: (modelId: string, type: 'message' | 'research'): Promise<{ success: boolean; data?: unknown; error?: string }> =>
    ipcRenderer.invoke('diagnostics:probe', { modelId, type }),
  diagnosticsRunResearch: (modelId: string): Promise<{ success: boolean; data?: { success: boolean; error?: string }; error?: string }> =>
    ipcRenderer.invoke('diagnostics:run-research', { modelId }),
```

- [ ] **Step 2: index.ts 加主窗口侧监听 + 回传 API**

```typescript
  onDiagnosticsProbeRequest: (cb: (payload: { reqId: string; modelId: string; type: 'message' | 'research' }) => void) => {
    const handler = (_e: Electron.IpcRendererEvent, payload: { reqId: string; modelId: string; type: 'message' | 'research' }): void => cb(payload)
    ipcRenderer.on('diagnostics:probe-request', handler)
    return () => { ipcRenderer.removeListener('diagnostics:probe-request', handler) }
  },
  diagnosticsProbeResponse: (reqId: string, result: unknown): void =>
    ipcRenderer.send('diagnostics:probe-response', { reqId, result }),
  onDiagnosticsRunResearchRequest: (cb: (payload: { reqId: string; modelId: string }) => void) => {
    const handler = (_e: Electron.IpcRendererEvent, payload: { reqId: string; modelId: string }): void => cb(payload)
    ipcRenderer.on('diagnostics:run-research-request', handler)
    return () => { ipcRenderer.removeListener('diagnostics:run-research-request', handler) }
  },
  diagnosticsRunResearchResponse: (reqId: string, result: { success: boolean; error?: string }): void =>
    ipcRenderer.send('diagnostics:run-research-response', { reqId, result }),
```

- [ ] **Step 3: index.d.ts 加类型声明**

在 `src/preload/index.d.ts` 的 `window.api` 类型（通常用 `interface Api { ... }` 或 `declare global`）补全上述 7 个方法签名，与 Step 1/2 一致。若文件用 `interface` 形式，照搬签名；若用别的形式，按现有模式补。

- [ ] **Step 4: lint + build**

Run: `npm run lint` → 无新增错误。
Run: `npm run build` → preload bundle 成功。

- [ ] **Step 5: Commit**

```bash
git add src/preload/index.ts src/preload/index.d.ts
git commit -m "feat(preload): expose diagnostics IPC bridge (end-to-end)

诊断窗口侧 diagnosticsOpenWindow/Probe/RunResearch；
主窗口侧 onDiagnosticsProbeRequest/Response + run-research 对称。
返回结构统一 {success,data?,error?}。

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 5: 主窗口 renderer 响应透传请求

**Files:**
- Modify: `src/renderer/src/store/appStore.ts`（新增 action + currentPage 类型）

**Interfaces:**
- Consumes: `window.api.onDiagnosticsProbeRequest`/`onDiagnosticsRunResearchRequest`/`diagnosticsProbeResponse`/`diagnosticsRunResearchResponse`（Task 4）；`webviewRefs`、`WebviewCardRef.probeMessageContainer`/`probeResearchMode`/`enableDeepResearch`
- Produces: `currentPage` 含 `'diagnostics'`；store 初始化时注册透传监听

- [ ] **Step 1: currentPage 加 diagnostics**

`src/renderer/src/store/appStore.ts` `:372`：
```typescript
  currentPage: 'main' | 'summary' | 'quick' | 'diagnostics'
```
`:373` setter 同步：
```typescript
  setCurrentPage: (page: 'main' | 'summary' | 'quick' | 'diagnostics') => void
```
`:1355-1356` 默认值与实现同步加 `'diagnostics'`。

- [ ] **Step 2: 新增 registerDiagnosticsRelay action**

在 store 接口加：
```typescript
  registerDiagnosticsRelay: () => () => void
```
实现（放在 store 末尾 actions 区）：
```typescript
  registerDiagnosticsRelay: () => {
    const offProbe = window.api.onDiagnosticsProbeRequest(async ({ reqId, modelId, type }) => {
      const { webviewRefs } = get()
      const ref = webviewRefs.get(modelId)
      let result: unknown
      if (!ref) {
        result = { ok: false, error: '平台未加载' }
      } else {
        try {
          result = type === 'message' ? await ref.probeMessageContainer() : await ref.probeResearchMode()
        } catch (error) {
          result = { ok: false, error: String(error) }
        }
      }
      window.api.diagnosticsProbeResponse(reqId, result)
    })
    const offRun = window.api.onDiagnosticsRunResearchRequest(async ({ reqId, modelId }) => {
      const { webviewRefs } = get()
      const ref = webviewRefs.get(modelId)
      let result: { success: boolean; error?: string }
      if (!ref) {
        result = { success: false, error: '平台未加载' }
      } else {
        try {
          result = await ref.enableDeepResearch()
        } catch (error) {
          result = { success: false, error: String(error) }
        }
      }
      window.api.diagnosticsRunResearchResponse(reqId, result)
    })
    return () => { offProbe(); offRun() }
  },
```

- [ ] **Step 3: App.tsx 注册 relay**

`src/renderer/src/App.tsx` 加 effect（在 init effect 附近）：
```typescript
  const registerDiagnosticsRelay = useAppStore((s) => s.registerDiagnosticsRelay)
  useEffect(() => {
    const off = registerDiagnosticsRelay()
    return off
  }, [registerDiagnosticsRelay])
```

- [ ] **Step 4: lint + tsc + build**

Run: `npm run lint` → 无新增错误。
Run: `npx tsc --noEmit -p tsconfig.web.json` → appStore.ts/App.tsx 无新增错误（预存 window.api 错误照旧）。
Run: `npm run build` → exit 0。

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/store/appStore.ts src/renderer/src/App.tsx
git commit -m "feat(renderer): wire diagnostics relay in main window + diagnostics route

currentPage 加 diagnostics；registerDiagnosticsRelay 监听透传请求
查 webviewRefs 调 probe/enableDeepResearch 回传。

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 6: DiagnosticsPage 双 Tab 页面 + App 路由

**Files:**
- Create: `src/renderer/src/pages/DiagnosticsPage.tsx`
- Modify: `src/renderer/src/App.tsx`（hash + 渲染分支，与 Task 5 同一文件分步改）

**Interfaces:**
- Consumes: `window.api.diagnosticsProbe`/`diagnosticsRunResearch`；`defaultSelectors.models`
- Produces: `DiagnosticsPage` 组件（默认导出）

- [ ] **Step 1: App.tsx 加 #diagnostics hash + 渲染分支**

在 `src/renderer/src/App.tsx` 的 `checkHash`（`:19-23`）加：
```typescript
      if (window.location.hash === '#diagnostics') {
        setCurrentPage('diagnostics')
      }
```
在渲染分支（`if (currentPage === 'quick')` 附近）加：
```typescript
  if (currentPage === 'diagnostics') {
    return <DiagnosticsPage />
  }
```
顶部 import 加：
```typescript
import DiagnosticsPage from './pages/DiagnosticsPage'
```

- [ ] **Step 2: 创建 DiagnosticsPage 双 Tab**

新建 `src/renderer/src/pages/DiagnosticsPage.tsx`。复用 v1 `SelectorDiagnosticsPanel` 的候选表格 + 状态徽标逻辑（可从该文件拷贝 `statusBadge`/`CandidateTable` 思路，但调用改 `window.api.diagnosticsProbe(id, 'message')`）。结构：

```typescript
import { useState } from 'react'
import { defaultSelectors } from '../config/selectors'
import type { CandidateReport, ProbeReport, ResearchProbeReport, StepReport } from '../utils/selectorDiagnostics'

function DiagnosticsPage(): JSX.Element {
  const [tab, setTab] = useState<'message' | 'research'>('message')
  const platformIds = Object.keys(defaultSelectors.models)
  const [selectedId, setSelectedId] = useState<string>(platformIds[0] ?? '')

  return (
    <div className="w-full h-full flex flex-col bg-bg-secondary">
      <div className="flex border-b border-border">
        <TabButton active={tab === 'message'} onClick={() => setTab('message')} label="消息容器 (messageContainer)" />
        <TabButton active={tab === 'research'} onClick={() => setTab('research')} label="深度研究 (researchMode)" />
      </div>
      <div className="flex flex-1 min-h-0">
        <div className="w-48 border-r border-border overflow-auto">
          {platformIds.map((id) => (
            <button key={id} type="button" onClick={() => setSelectedId(id)}
              className={`w-full text-left px-3 py-2 text-sm ${selectedId === id ? 'bg-white/60 text-primary' : 'text-text-primary hover:bg-white/40'}`}>
              {id}
            </button>
          ))}
        </div>
        <div className="flex-1 overflow-auto p-4">
          {tab === 'message'
            ? <MessageTab modelId={selectedId} />
            : <ResearchTab modelId={selectedId} />}
        </div>
      </div>
      <div className="px-4 py-2 border-t border-border text-xs text-text-secondary">
        dev-only 诊断。先在主窗口对应平台触发一次回复再诊断。报告仅含元素指纹+正文长度，不含正文。
      </div>
    </div>
  )
}

function TabButton({ active, onClick, label }: { active: boolean; onClick: () => void; label: string }): JSX.Element {
  return (
    <button type="button" onClick={onClick}
      className={`px-4 py-2 text-sm border-b-2 ${active ? 'border-primary text-primary' : 'border-transparent text-text-secondary'}`}>
      {label}
    </button>
  )
}

function MessageTab({ modelId }: { modelId: string }): JSX.Element {
  const [report, setReport] = useState<ProbeReport | null>(null)
  const [running, setRunning] = useState(false)
  const run = async (): Promise<void> => {
    setRunning(true)
    try {
      const res = await window.api.diagnosticsProbe(modelId, 'message')
      setReport(res.success && res.data ? res.data as ProbeReport : { ok: false, candidates: [], error: res.error })
    } finally { setRunning(false) }
  }
  return (
    <div>
      <button type="button" onClick={run} disabled={running || !modelId}
        className="px-3 py-1.5 text-sm rounded-lg bg-primary text-white disabled:opacity-40 mb-3">
        {running ? '诊断中...' : '诊断 messageContainer'}
      </button>
      {report && <MessageReportView report={report} />}
    </div>
  )
}

function MessageReportView({ report }: { report: ProbeReport }): JSX.Element {
  if (!report.ok) return <div className="text-red-600 text-sm">{report.error ?? '探针失败'}</div>
  return (
    <table className="w-full text-xs">
      <thead><tr className="text-text-secondary text-left">
        <th className="py-1 pr-2">选择器</th><th className="py-1 pr-2">命中</th>
        <th className="py-1 pr-2">可见</th><th className="py-1 pr-2">正文长</th><th className="py-1">元素指纹</th>
      </tr></thead>
      <tbody>
        {report.candidates.map((c: CandidateReport, i: number) => (
          <tr key={i} className="border-t border-border/50">
            <td className="py-1 pr-2 font-mono break-all max-w-[200px]">{c.selector}</td>
            <td className="py-1 pr-2">{c.hitCount}</td>
            <td className="py-1 pr-2">{c.visibleHitCount}</td>
            <td className="py-1 pr-2">{c.firstHit?.visibleTextLen ?? 0}</td>
            <td className="py-1 font-mono text-text-secondary break-all max-w-[200px]">
              {c.firstHit ? `${c.firstHit.tag}.${c.firstHit.className ?? ''}${c.firstHit.id ? '#' + c.firstHit.id : ''}${c.firstHit.dataTestid ? ' [data-testid=' + c.firstHit.dataTestid + ']' : ''}` : (c.error ?? '—')}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

function ResearchTab({ modelId }: { modelId: string }): JSX.Element {
  const [report, setReport] = useState<ResearchProbeReport | null>(null)
  const [running, setRunning] = useState(false)
  const [runResult, setRunResult] = useState<string | null>(null)
  const probe = async (): Promise<void> => {
    setRunning(true); setRunResult(null)
    try {
      const res = await window.api.diagnosticsProbe(modelId, 'research')
      setReport(res.success && res.data ? res.data as ResearchProbeReport : { ok: false, steps: [], error: res.error })
    } finally { setRunning(false) }
  }
  const runReal = async (): Promise<void> => {
    setRunResult('执行中...')
    const res = await window.api.diagnosticsRunResearch(modelId)
    setRunResult(res.success && res.data ? (res.data.success ? '✅ 开启成功' : `❌ ${res.data.error}`) : `❌ ${res.error}`)
  }
  return (
    <div>
      <div className="flex gap-2 mb-3">
        <button type="button" onClick={probe} disabled={running || !modelId}
          className="px-3 py-1.5 text-sm rounded-lg bg-primary text-white disabled:opacity-40">
          {running ? '探测中...' : '只读探测 steps'}
        </button>
        <button type="button" onClick={runReal} disabled={!modelId}
          className="px-3 py-1.5 text-sm rounded-lg bg-red-500 text-white disabled:opacity-40"
          title="将真实点击页面触发 Deep Research">
          实跑 enableDeepResearch
        </button>
      </div>
      {runResult && <div className="text-sm mb-2">{runResult}</div>}
      {report && <ResearchReportView report={report} />}
    </div>
  )
}

function ResearchReportView({ report }: { report: ResearchProbeReport }): JSX.Element {
  if (!report.ok) return <div className="text-red-600 text-sm">{report.error ?? '探针失败'}</div>
  return (
    <table className="w-full text-xs">
      <thead><tr className="text-text-secondary text-left">
        <th className="py-1 pr-2">步</th><th className="py-1 pr-2">选择器</th>
        <th className="py-1 pr-2">命中</th><th className="py-1 pr-2">来源</th><th className="py-1">元素指纹</th>
      </tr></thead>
      <tbody>
        {report.steps.map((s: StepReport) => (
          <tr key={s.index} className="border-t border-border/50">
            <td className="py-1 pr-2">{s.index}</td>
            <td className="py-1 pr-2 font-mono break-all max-w-[200px]">{s.selector}</td>
            <td className="py-1 pr-2">{s.found ? '✅' : '❌'}</td>
            <td className="py-1 pr-2">{s.matchedVia ?? '—'}</td>
            <td className="py-1 font-mono text-text-secondary break-all max-w-[200px]">
              {s.firstHit ? `${s.firstHit.tag}.${s.firstHit.className ?? ''}${s.firstHit.id ? '#' + s.firstHit.id : ''}${s.firstHit.dataTestid ? ' [data-testid=' + s.firstHit.dataTestid + ']' : ''}` : (s.error ?? '—')}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

export default DiagnosticsPage
```

- [ ] **Step 3: lint + tsc + build**

Run: `npm run lint` → 无新增错误。
Run: `npx tsc --noEmit -p tsconfig.web.json` → DiagnosticsPage.tsx 无错误。
Run: `npm run build` → exit 0。

- [ ] **Step 4: Commit**

```bash
git add src/renderer/src/pages/DiagnosticsPage.tsx src/renderer/src/App.tsx
git commit -m "feat(renderer): add DiagnosticsPage with message+research dual tabs

#diagnostics hash 路由；双 Tab 调 diagnosticsProbe/RunResearch；
research Tab 含只读探测 + 实跑 enableDeepResearch 按钮。

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 7: SettingsDrawer 入口 + 移除 Layout 顶栏入口

**Files:**
- Modify: `src/renderer/src/components/SettingsDrawer.tsx`
- Modify: `src/renderer/src/components/Layout.tsx`

- [ ] **Step 1: SettingsDrawer 加 dev 入口**

在 `src/renderer/src/components/SettingsDrawer.tsx` 抽屉内（合适位置，如底部按钮区）加：
```typescript
{import.meta.env.DEV && (
  <button type="button"
    onClick={() => { void window.api.diagnosticsOpenWindow() }}
    className="px-3 py-2 text-sm rounded-lg border border-border text-text-primary hover:bg-white/60 w-full">
    🔬 选择器诊断 (dev)
  </button>
)}
```

- [ ] **Step 2: Layout 移除 v1 顶栏入口**

`src/renderer/src/components/Layout.tsx` 移除：
- v1 的 `import SelectorDiagnosticsPanel from './SelectorDiagnosticsPanel'`
- `const [isDiagnosticsOpen, setDiagnosticsOpen] = useState(false)`（保留 `isDev` 常量，因 SettingsDrawer 不在此文件；若 isDev 仅被 v1 入口用则一并移除）
- 顶栏 `{isDev && (<button...>science</button>)}` 块
- 底部 `{isDev && (<SelectorDiagnosticsPanel .../>)}` 块

注意：`SelectorDiagnosticsPanel.tsx` 文件本身暂保留（v1 候选表格逻辑可被 DiagnosticsPage 复用参考），但不再被 Layout 引用。若 DiagnosticsPage 已自带表格逻辑（Task 6 是自带的），则可删除 `SelectorDiagnosticsPanel.tsx` 与 `Layout` 的 `isDev` 一并清理——**只在确认无其他引用时删除**（grep `SelectorDiagnosticsPanel` 确认）。

- [ ] **Step 3: grep 确认无悬空引用**

Run: `grep -rn "SelectorDiagnosticsPanel\|isDiagnosticsOpen" src/`
Expected: 若已删除该文件，应 0 命中；若保留，仅 DiagnosticsPage 或无引用。

- [ ] **Step 4: lint + build + DEV 门控**

Run: `npm run lint` → 无新增错误。
Run: `npm run build` → exit 0。
Run: `grep -c "选择器诊断" out/renderer/assets/index-*.js` → 报告数值（dev 入口在 prod build 应被 `import.meta.env.DEV` 剔除，期望 0；若非 0 说明门控失效，需修）。

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/components/SettingsDrawer.tsx src/renderer/src/components/Layout.tsx
git commit -m "feat(settings): move diagnostics entry into SettingsDrawer, remove topbar entry

入口移入设置抽屉（dev-only）；移除 v1 顶栏 🔬 按钮与抽屉挂载。
production build 经 import.meta.env.DEV 剔除入口。

Co-Authored-By: Claude <noreply@anthropic.com>"
```
（若删除了 SelectorDiagnosticsPanel.tsx，一并 `git add`/`git rm`）

---

## Task 8: 方法论文档更新 + 实机示范

**Files:**
- Modify: `docs/选择器维护方法论.md`
- 可能 Modify: `src/shared/config/selectors.ts`（仅当示范发现失效时）

- [ ] **Step 1: 更新方法论文档**

在 `docs/选择器维护方法论.md` 补：
- 独立窗口用法（设置抽屉 → 🔬 → 独立窗口双 Tab）
- researchMode 闭环：开窗口 → 选平台 → research Tab → 只读探测看每步命中 → 失效步用元素指纹撰新 selector → 改 selectors.ts bump version → 重启 → 再探
- "实跑"按钮警示：真实点击页面，建议在新对话页测试

- [ ] **Step 2: dev 实机示范（手动，需用户配合）**

Run: `npm run dev`
手动：主窗口打开 ChatGPT 发 prompt 等流完 → 设置抽屉点 🔬 → 独立窗口出 → Tab1 诊断 chatgpt 看 visibleTextLen>0 → Tab2 探测 + 实跑看 Deep Research 开启。Kimi 同理。记录结果。

- [ ] **Step 3: 若失效则修 selectors.ts + bump version**

仅当示范发现某平台 messageContainer/researchMode 失效时改 `src/shared/config/selectors.ts` 并 bump `version`。

- [ ] **Step 4: Commit 文档（+ 选择器若有改）**

```bash
git add docs/选择器维护方法论.md
# 若改了选择器：git add src/shared/config/selectors.ts
git commit -m "docs: update methodology for independent window + researchMode

Co-Authored-By: Claude <noreply@anthropic.com>"
```

- [ ] **Step 5: session_log.py**

Run: `python .memory/session_log.py --done "选择器诊断独立窗口 v2" --added "src/renderer/src/pages/DiagnosticsPage.tsx" --modified "src/renderer/src/utils/selectorDiagnostics.ts;src/renderer/src/components/WebviewCard.tsx;src/main/webviewManager.ts;src/main/ipcHandlers.ts;src/preload/index.ts;src/preload/index.d.ts;src/renderer/src/store/appStore.ts;src/renderer/src/App.tsx;src/renderer/src/components/SettingsDrawer.tsx;src/renderer/src/components/Layout.tsx;docs/选择器维护方法论.md"`
若提示 promote lesson，追加到 `.memory/KNOWLEDGE.md` 并改 SESSION_LOG 标签。

---

## Self-Review

**1. Spec coverage：**
- §4.1 researchMode 探针 → Task 1 ✅
- §4.2 probeResearchMode → Task 2 ✅
- §4.3 窗口 + IPC 透传 → Task 3 ✅
- §4.4 preload 契约 → Task 4 ✅
- §4.5 主窗口响应透传 → Task 5 ✅
- §4.6 SettingsDrawer 入口 + 移除顶栏 → Task 7 ✅
- §4.7 DiagnosticsPage + 路由 → Task 6 ✅
- §3.2 路由（currentPage + App hash）→ Task 5/6 ✅
- §5 错误处理（窗口已存在、ref 未注册、超时、findElement 抛错、实跑未就绪）→ Task 3 Step1/3/4 + Task 5 Step2 + Task 1 Step2 ✅
- §6 测试（DEV 门控、双 Tab、实跑、脱敏）→ Task 7 Step4 + Task 8 Step2 ✅
- §7 方法论更新 → Task 8 Step1 ✅

**2. Placeholder scan：** Task 4 Step3 "若文件用 interface 形式..." 是有条件指引非占位（给出两种情况的写法）；Task 7 Step2 "只在确认无其他引用时删除" 有 grep 确认步骤；无 TBD/TODO。

**3. Type consistency：** `ResearchProbeReport`/`StepReport` Task 1 定义，Task 2/6 引用一致；`probeResearchMode` 签名 Task 2 定义 `() => Promise<ResearchProbeReport>`，Task 5 调用一致；IPC channel 名 `diagnostics:probe`/`probe-request`/`probe-response`/`run-research`(+`-request`/`-response`) 在 Task 3/4/5 一致；`diagnosticsProbe(modelId, 'message'|'research')` Task 4 定义，Task 6 调用一致。

无遗漏。
