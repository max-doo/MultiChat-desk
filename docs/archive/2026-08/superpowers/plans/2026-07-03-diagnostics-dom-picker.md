# 诊断窗口 DOM 结构探测（检拾模式）实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在诊断窗口新增「DOM 探测」Tab，支持检拾模式——进入模式后在平台 webview 鼠标移动高亮元素、点击选中，返回选中元素的祖先链 + 自身 + 子树结构，用于更新 `selectors.ts` 时确认目标元素层级与可用属性。

**Architecture:** 复用 v2 诊断窗口已有的 `diagnostics:probe-request/response` relay IPC 通道，扩展 `type` 联合类型新增 `'pick'`。检拾脚本注入平台 webview（覆盖层 + `elementFromPoint` 高亮 + click 选中 + Esc/超时取消），单次 `executeJavaScript` 往返完成"进检拾→点选→回结构"。DOM 序列化沿用 `selectorDiagnostics.ts` 既有的脱敏指纹范式（白名单属性 + 正文仅长度）。

**Tech Stack:** TypeScript (strict), Electron 28 `<webview>.executeJavaScript`, React 18, Tailwind CSS 3。

**Spec:** `docs/superpowers/specs/2026-07-03-diagnostics-dom-picker-design.md`

## Global Constraints

- 严格 TypeScript，禁止 `any` 静默错误；故意未用变量以 `_` 前缀标记。
- 包管理器仅 npm，禁止新增生产依赖。
- IPC 端到端同步 5 处：`ipcHandlers.ts`、`preload/index.ts`、`preload/index.d.ts`、`renderer/env.d.ts`、`appStore.ts` relay + `WebviewCard`。
- 安全/脱敏：序列化节点仅含白名单属性（`role`/`aria-label`/`aria-haspopup`/`name`/`type`/`href`）+ `visibleTextLen` 长度，**不含正文内容、不含用户对话文本**。
- picker 脚本只读：不点击平台按钮、不改平台 DOM 结构；覆盖层为独立 `<div>`，选中/取消/超时后立即 `remove()`。
- picker 默认参数：`ancestorDepth: 8`，`childDepth: 3`；picker 自身超时 120s，relay 超时 60s。
- dev-only 能力，不进 `webviewScripts.ts` 生产路径；不改 `selectors.ts` 数据结构。
- 项目无自动化测试运行器；验证 = `npm run lint` → `npm run build` → `npm run dev` 手动验证。
- 禁止擅自切分支，只在当前分支工作。

---

## File Structure

- **Modify** `src/renderer/src/utils/selectorDiagnostics.ts` — 新增 DOM 序列化类型、`buildDomProbeScript`/`parseDomProbeResult`、`buildPickerScript`（单元 1+2，纯函数，注入脚本字符串生成与解析）。
- **Modify** `src/renderer/src/components/WebviewCard.tsx` — `WebviewCardRef` 加 `probeDomStructure`，实现注入 picker（单元 3）。
- **Modify** `src/renderer/src/store/appStore.ts` — relay `type==='pick'` 分支（单元 4）。
- **Modify** `src/main/ipcHandlers.ts` — `diagnostics:probe` 支持 `type:'pick'` + `options` + 60s 超时（单元 5a）。
- **Modify** `src/preload/index.ts` + `src/preload/index.d.ts` + `src/renderer/src/env.d.ts` — IPC 契约类型同步（单元 5b）。
- **Modify** `src/renderer/src/pages/DiagnosticsPage.tsx` — 新增 DOM Tab + 检拾 UI + `DomTreeView`（单元 6）。

---

### Task 1: DOM 序列化与 picker 脚本纯函数（`selectorDiagnostics.ts`）

**Files:**
- Modify: `src/renderer/src/utils/selectorDiagnostics.ts`（在文件末尾追加）

**Interfaces:**
- Produces: `NodeFingerprint`、`TreeNode`、`DomProbeReport`、`DomProbeOptions` 类型；`buildDomProbeScript(opts)`、`parseDomProbeResult(raw)`、`buildPickerScript(opts)` 函数。供 Task 3（`WebviewCard`）与 Task 6（`DiagnosticsPage`）消费。

- [ ] **Step 1: 在 `selectorDiagnostics.ts` 末尾追加类型定义与 `buildDomProbeScript`/`parseDomProbeResult`**

在文件末尾（`parseResearchProbeResult` 函数之后）追加：

```ts
// ─────────────────────────────────────────────────────────────
// DOM 结构探测（dev-only 检拾模式）
// ─────────────────────────────────────────────────────────────

/** 序列化节点指纹：白名单属性 + 正文仅长度（脱敏，不含正文内容） */
export interface NodeFingerprint {
  tag: string
  className: string | null
  id: string | null
  dataTestid: string | null
  /** 白名单属性：role/aria-label/aria-haspopup/name/type/href，其余丢弃 */
  attrs: Record<string, string | null>
  childCount: number
  /** 元素可见正文长度（脱敏：仅长度，不含正文内容） */
  visibleTextLen: number
  isVisible: boolean
}

/** 子树节点：指纹 + 递归 children（截断到 childDepth 层） */
export interface TreeNode extends NodeFingerprint {
  children: TreeNode[]
}

export interface DomProbeOptions {
  /** 祖先链深度，默认 8 */
  ancestorDepth?: number
  /** 子树深度，默认 3 */
  childDepth?: number
}

export interface DomProbeReport {
  ok: boolean
  /** 命中元素的选择器（picker 模式下为构造的候选选择器） */
  selector?: string
  target?: NodeFingerprint
  /** 从根方向 → 目标，最远祖先在前 */
  ancestors?: NodeFingerprint[]
  subtree?: TreeNode
  error?: string
  /** 用户按 Esc 取消 */
  cancelled?: boolean
}

const DOM_ATTR_WHITELIST = ['role', 'aria-label', 'aria-haspopup', 'name', 'type', 'href']
const DEFAULT_ANCESTOR_DEPTH = 8
const DEFAULT_CHILD_DEPTH = 3

/**
 * 构建在平台页内执行的 DOM 结构序列化脚本（选择器驱动，dev-only）。
 * querySelector(selector) 取首个命中，向上取 ancestorDepth 层祖先，向下取 childDepth 层子树。
 * @param opts.selector CSS 选择器（可逗号分隔多候选，取首个命中）
 * @param opts.ancestorDepth 祖先深度，默认 8
 * @param opts.childDepth 子树深度，默认 3
 */
export function buildDomProbeScript(opts: { selector: string; ancestorDepth?: number; childDepth?: number }): string {
  const selector = opts.selector
  const ancestorDepth = opts.ancestorDepth ?? DEFAULT_ANCESTOR_DEPTH
  const childDepth = opts.childDepth ?? DEFAULT_CHILD_DEPTH
  return `(function () {
    var selector = ${JSON.stringify(selector)};
    var ancestorDepth = ${ancestorDepth};
    var childDepth = ${childDepth};
    var ATTR_WHITELIST = ${JSON.stringify(DOM_ATTR_WHITELIST)};

    function isVisible(element) {
      try {
        if (!element || !element.isConnected) return false;
        if (!element.getClientRects || element.getClientRects().length === 0) return false;
        var rect = element.getBoundingClientRect();
        if (!rect || rect.width <= 0 || rect.height <= 0) return false;
        var cur = element;
        while (cur && cur.nodeType === 1) {
          var style = window.getComputedStyle(cur);
          if (!style) return false;
          if (style.display === 'none' || style.visibility === 'hidden') return false;
          var opacity = Number(style.opacity || '1');
          if (!Number.isNaN(opacity) && opacity <= 0.01) return false;
          cur = cur.parentElement;
        }
        return true;
      } catch (e) { return false; }
    }

    function fingerprint(el) {
      if (!el || el.nodeType !== 1) return null;
      var text = '';
      try { text = (el.innerText || el.textContent || '') + ''; } catch (e) { text = ''; }
      var attrs = {};
      for (var i = 0; i < ATTR_WHITELIST.length; i++) {
        var k = ATTR_WHITELIST[i];
        try { attrs[k] = el.getAttribute(k); } catch (e) { attrs[k] = null; }
      }
      var childCount = 0;
      try { childCount = el.children ? el.children.length : 0; } catch (e) { childCount = 0; }
      return {
        tag: (el.tagName || '').toLowerCase(),
        className: (typeof el.className === 'string' ? el.className : null),
        id: el.getAttribute('id') || null,
        dataTestid: el.getAttribute('data-testid') || null,
        attrs: attrs,
        childCount: childCount,
        visibleTextLen: text.replace(/\\u200B/g, '').trim().length,
        isVisible: isVisible(el)
      };
    }

    function buildSubtree(el, depth) {
      var fp = fingerprint(el);
      if (!fp) return null;
      var node = { tag: fp.tag, className: fp.className, id: fp.id, dataTestid: fp.dataTestid, attrs: fp.attrs, childCount: fp.childCount, visibleTextLen: fp.visibleTextLen, isVisible: fp.isVisible, children: [] };
      if (depth <= 0) return node;
      var children = el.children || [];
      for (var i = 0; i < children.length; i++) {
        var sub = buildSubtree(children[i], depth - 1);
        if (sub) node.children.push(sub);
      }
      return node;
    }

    function suggestSelector(el) {
      if (!el) return null;
      var tag = (el.tagName || '').toLowerCase();
      var testid = el.getAttribute('data-testid');
      if (testid) return '[data-testid=' + JSON.stringify(testid) + ']';
      var id = el.getAttribute('id');
      if (id) return tag + '#' + id;
      var cn = typeof el.className === 'string' ? el.className.trim().split(/\\s+/)[0] : '';
      if (cn) return tag + '.' + cn;
      return tag;
    }

    var target = null;
    try { target = document.querySelector(selector); } catch (e) { return JSON.stringify({ ok: false, error: '选择器语法错误: ' + String(e && e.message ? e.message : e) }); }
    if (!target) return JSON.stringify({ ok: false, error: '选择器未命中任何元素' });

    var ancestors = [];
    var cur = target.parentElement;
    for (var i = 0; i < ancestorDepth && cur; i++) {
      var fp = fingerprint(cur);
      if (fp) ancestors.unshift(fp);
      cur = cur.parentElement;
    }

    return JSON.stringify({
      ok: true,
      selector: suggestSelector(target),
      target: fingerprint(target),
      ancestors: ancestors,
      subtree: buildSubtree(target, childDepth)
    });
  })();`
}

/**
 * 解析 executeJavaScript 返回的 DOM 探测结果。
 */
export function parseDomProbeResult(raw: unknown): DomProbeReport {
  if (typeof raw !== 'string') {
    return { ok: false, error: '探针返回非字符串' }
  }
  try {
    const parsed = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object') {
      return { ok: false, error: '探针返回结构异常' }
    }
    return parsed as DomProbeReport
  } catch (e) {
    return { ok: false, error: `结果解析失败: ${String(e)}` }
  }
}
```

- [ ] **Step 2: 在 `selectorDiagnostics.ts` 末尾追加 `buildPickerScript`（检拾模式注入脚本）**

紧跟 Step 1 内容之后追加：

```ts
/**
 * 构建在平台页内执行的检拾（picker）脚本字符串（dev-only）。
 * 注入全屏透明覆盖层 + 高亮框 + 浮标；mousemove 用 elementFromPoint 高亮，click 选中后序列化并回传，Esc 取消。
 * 单次 executeJavaScript 往返：注入即挂起监听，点选/取消/超时后 resolve。
 * @param opts.ancestorDepth 祖先深度，默认 8
 * @param opts.childDepth 子树深度，默认 3
 */
export function buildPickerScript(opts: DomProbeOptions = {}): string {
  const ancestorDepth = opts.ancestorDepth ?? DEFAULT_ANCESTOR_DEPTH
  const childDepth = opts.childDepth ?? DEFAULT_CHILD_DEPTH
  return `(function () {
    var ancestorDepth = ${ancestorDepth};
    var childDepth = ${childDepth};
    var ATTR_WHITELIST = ${JSON.stringify(DOM_ATTR_WHITELIST)};
    var PICKER_TIMEOUT_MS = 120000;

    // 防重入：先清理旧注入物
    function cleanup() {
      var ids = ['mc-picker-overlay', 'mc-picker-highlight', 'mc-picker-tip'];
      for (var i = 0; i < ids.length; i++) {
        var el = document.getElementById(ids[i]);
        if (el && el.parentNode) el.parentNode.removeChild(el);
      }
    }
    cleanup();

    var currentEl = null;

    function isVisible(element) {
      try {
        if (!element || !element.isConnected) return false;
        if (!element.getClientRects || element.getClientRects().length === 0) return false;
        var rect = element.getBoundingClientRect();
        if (!rect || rect.width <= 0 || rect.height <= 0) return false;
        var cur = element;
        while (cur && cur.nodeType === 1) {
          var style = window.getComputedStyle(cur);
          if (!style) return false;
          if (style.display === 'none' || style.visibility === 'hidden') return false;
          var opacity = Number(style.opacity || '1');
          if (!Number.isNaN(opacity) && opacity <= 0.01) return false;
          cur = cur.parentElement;
        }
        return true;
      } catch (e) { return false; }
    }

    function fingerprint(el) {
      if (!el || el.nodeType !== 1) return null;
      var text = '';
      try { text = (el.innerText || el.textContent || '') + ''; } catch (e) { text = ''; }
      var attrs = {};
      for (var i = 0; i < ATTR_WHITELIST.length; i++) {
        var k = ATTR_WHITELIST[i];
        try { attrs[k] = el.getAttribute(k); } catch (e) { attrs[k] = null; }
      }
      var childCount = 0;
      try { childCount = el.children ? el.children.length : 0; } catch (e) { childCount = 0; }
      return {
        tag: (el.tagName || '').toLowerCase(),
        className: (typeof el.className === 'string' ? el.className : null),
        id: el.getAttribute('id') || null,
        dataTestid: el.getAttribute('data-testid') || null,
        attrs: attrs,
        childCount: childCount,
        visibleTextLen: text.replace(/\\u200B/g, '').trim().length,
        isVisible: isVisible(el)
      };
    }

    function buildSubtree(el, depth) {
      var fp = fingerprint(el);
      if (!fp) return null;
      var node = { tag: fp.tag, className: fp.className, id: fp.id, dataTestid: fp.dataTestid, attrs: fp.attrs, childCount: fp.childCount, visibleTextLen: fp.visibleTextLen, isVisible: fp.isVisible, children: [] };
      if (depth <= 0) return node;
      var children = el.children || [];
      for (var i = 0; i < children.length; i++) {
        var sub = buildSubtree(children[i], depth - 1);
        if (sub) node.children.push(sub);
      }
      return node;
    }

    function suggestSelector(el) {
      if (!el) return null;
      var tag = (el.tagName || '').toLowerCase();
      var testid = el.getAttribute('data-testid');
      if (testid) return '[data-testid=' + JSON.stringify(testid) + ']';
      var id = el.getAttribute('id');
      if (id) return tag + '#' + id;
      var cn = typeof el.className === 'string' ? el.className.trim().split(/\\s+/)[0] : '';
      if (cn) return tag + '.' + cn;
      return tag;
    }

    function describeTip(el) {
      if (!el) return '';
      var tag = (el.tagName || '').toLowerCase();
      var testid = el.getAttribute('data-testid');
      var id = el.getAttribute('id');
      var cn = typeof el.className === 'string' ? el.className.trim().split(/\\s+/).slice(0, 2).join('.') : '';
      var parts = [tag];
      if (id) parts.push('#' + id);
      if (cn) parts.push('.' + cn);
      if (testid) parts.push('[data-testid=' + testid + ']');
      return parts.join('');
    }

    var overlay = document.createElement('div');
    overlay.id = 'mc-picker-overlay';
    overlay.style.cssText = 'position:fixed;inset:0;z-index:2147483647;cursor:crosshair;background:transparent;';

    var highlight = document.createElement('div');
    highlight.id = 'mc-picker-highlight';
    highlight.style.cssText = 'position:fixed;z-index:2147483647;pointer-events:none;border:2px solid #2563eb;background:rgba(37,99,235,0.12);display:none;';

    var tip = document.createElement('div');
    tip.id = 'mc-picker-tip';
    tip.style.cssText = 'position:fixed;z-index:2147483648;pointer-events:none;background:#1e293b;color:#fff;font:12px/1.4 monospace;padding:2px 6px;border-radius:3px;display:none;max-width:60vw;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;';

    document.body.appendChild(overlay);
    document.body.appendChild(highlight);
    document.body.appendChild(tip);

    function updateHighlight(e) {
      var el = document.elementFromPoint(e.clientX, e.clientY);
      // 跳过注入物自身
      if (el && (el.id === 'mc-picker-overlay' || el.id === 'mc-picker-highlight' || el.id === 'mc-picker-tip')) {
        el = null;
      }
      currentEl = el;
      if (!el) {
        highlight.style.display = 'none';
        tip.style.display = 'none';
        return;
      }
      var rect = el.getBoundingClientRect();
      highlight.style.display = 'block';
      highlight.style.left = rect.left + 'px';
      highlight.style.top = rect.top + 'px';
      highlight.style.width = rect.width + 'px';
      highlight.style.height = rect.height + 'px';
      tip.style.display = 'block';
      tip.textContent = describeTip(el);
      var tipLeft = e.clientX + 12;
      var tipTop = e.clientY + 12;
      if (tipLeft + 200 > window.innerWidth) tipLeft = e.clientX - 200;
      tip.style.left = tipLeft + 'px';
      tip.style.top = tipTop + 'px';
    }

    function onMove(e) { updateHighlight(e); }

    function onClick(e) {
      e.preventDefault();
      e.stopPropagation();
      var el = currentEl;
      cleanup();
      document.removeEventListener('keydown', onKey, true);
      if (!el) {
        window.__mcPickerResolve({ ok: false, error: '未选中任何元素' });
        return;
      }
      var ancestors = [];
      var cur = el.parentElement;
      for (var i = 0; i < ancestorDepth && cur; i++) {
        var fp = fingerprint(cur);
        if (fp) ancestors.unshift(fp);
        cur = cur.parentElement;
      }
      window.__mcPickerResolve({
        ok: true,
        selector: suggestSelector(el),
        target: fingerprint(el),
        ancestors: ancestors,
        subtree: buildSubtree(el, childDepth)
      });
    }

    function onKey(e) {
      if (e.key === 'Escape' || e.keyCode === 27) {
        e.preventDefault();
        e.stopPropagation();
        cleanup();
        overlay.removeEventListener('mousemove', onMove);
        overlay.removeEventListener('click', onClick);
        document.removeEventListener('keydown', onKey, true);
        window.__mcPickerResolve({ ok: false, cancelled: true });
      }
    }

    overlay.addEventListener('mousemove', onMove);
    overlay.addEventListener('click', onClick);
    document.addEventListener('keydown', onKey, true);

    // 超时自清
    setTimeout(function () {
      var ol = document.getElementById('mc-picker-overlay');
      if (!ol) return; // 已通过 click/Esc 清理
      cleanup();
      document.removeEventListener('keydown', onKey, true);
      window.__mcPickerResolve({ ok: false, error: '检拾超时' });
    }, PICKER_TIMEOUT_MS);

    return new Promise(function (resolve) {
      window.__mcPickerResolve = resolve;
    });
  })();`
}
```

> **注意**：picker 脚本返回一个 Promise（`executeJavaScript` 支持 await 注入脚本返回的 Promise）。`window.__mcPickerResolve` 是临时挂载，resolve 后残留——可接受（dev-only，下次注入覆盖）。若需清理可在 resolve 前 `delete window.__mcPickerResolve`，但 Promise 内部已 captured，删除不影响 resolve。

- [ ] **Step 3: 类型检查**

Run: `npm run build`
Expected: 通过，无类型错误。（`buildDomProbeScript`/`parseDomProbeResult`/`buildPickerScript` 已导出但暂无消费方，TS 不会因未使用导出报错。）

- [ ] **Step 4: Lint**

Run: `npm run lint`
Expected: 通过，无 `no-explicit-any` / 未使用变量警告。

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/utils/selectorDiagnostics.ts
git commit -m "feat(diagnostics): 新增 DOM 序列化与检拾脚本纯函数"
```

---

### Task 2: IPC 契约端到端同步（main + preload + env.d.ts）

**Files:**
- Modify: `src/main/ipcHandlers.ts:33-34`（类型注释）、`:107-121`（probe handler）
- Modify: `src/preload/index.ts:38-46`
- Modify: `src/preload/index.d.ts:70-72`
- Modify: `src/renderer/src/env.d.ts:85-87`

**Interfaces:**
- Consumes: Task 1 的 `DomProbeOptions` 类型。
- Produces: `diagnosticsProbe(modelId, type, options?)` 与 `onDiagnosticsProbeRequest` payload 含 `options?`，`type` 含 `'pick'`。供 Task 4（relay）与 Task 6（UI）消费。

- [ ] **Step 1: 修改 `src/preload/index.ts:38-46` — `diagnosticsProbe` 加 options，`onDiagnosticsProbeRequest` payload 加 options**

将：
```ts
  diagnosticsProbe: (modelId: string, type: 'message' | 'research'): Promise<{ success: boolean; data?: unknown; error?: string }> =>
    ipcRenderer.invoke('diagnostics:probe', { modelId, type }),
```
改为：
```ts
  diagnosticsProbe: (modelId: string, type: 'message' | 'research' | 'pick', options?: { ancestorDepth?: number; childDepth?: number }): Promise<{ success: boolean; data?: unknown; error?: string }> =>
    ipcRenderer.invoke('diagnostics:probe', { modelId, type, options }),
```

将：
```ts
  onDiagnosticsProbeRequest: (cb: (payload: { reqId: string; modelId: string; type: 'message' | 'research' }) => void) => {
    const handler = (_e: Electron.IpcRendererEvent, payload: { reqId: string; modelId: string; type: 'message' | 'research' }): void => cb(payload)
    ipcRenderer.on('diagnostics:probe-request', handler)
    return () => { ipcRenderer.removeListener('diagnostics:probe-request', handler) }
  },
```
改为：
```ts
  onDiagnosticsProbeRequest: (cb: (payload: { reqId: string; modelId: string; type: 'message' | 'research' | 'pick'; options?: { ancestorDepth?: number; childDepth?: number } }) => void) => {
    const handler = (_e: Electron.IpcRendererEvent, payload: { reqId: string; modelId: string; type: 'message' | 'research' | 'pick'; options?: { ancestorDepth?: number; childDepth?: number } }): void => cb(payload)
    ipcRenderer.on('diagnostics:probe-request', handler)
    return () => { ipcRenderer.removeListener('diagnostics:probe-request', handler) }
  },
```

- [ ] **Step 2: 修改 `src/preload/index.d.ts:70-72` — 同步类型契约**

将：
```ts
      diagnosticsProbe: (modelId: string, type: 'message' | 'research') => Promise<{ success: boolean; data?: unknown; error?: string }>
```
改为：
```ts
      diagnosticsProbe: (modelId: string, type: 'message' | 'research' | 'pick', options?: { ancestorDepth?: number; childDepth?: number }) => Promise<{ success: boolean; data?: unknown; error?: string }>
```

将：
```ts
      onDiagnosticsProbeRequest: (cb: (payload: { reqId: string; modelId: string; type: 'message' | 'research' }) => void) => () => void
```
改为：
```ts
      onDiagnosticsProbeRequest: (cb: (payload: { reqId: string; modelId: string; type: 'message' | 'research' | 'pick'; options?: { ancestorDepth?: number; childDepth?: number } }) => void) => () => void
```

- [ ] **Step 3: 修改 `src/renderer/src/env.d.ts:85-87` — 同步渲染层类型**

将：
```ts
      diagnosticsProbe: (modelId: string, type: 'message' | 'research') => Promise<{ success: boolean; data?: unknown; error?: string }>
```
改为：
```ts
      diagnosticsProbe: (modelId: string, type: 'message' | 'research' | 'pick', options?: { ancestorDepth?: number; childDepth?: number }) => Promise<{ success: boolean; data?: unknown; error?: string }>
```

将：
```ts
      onDiagnosticsProbeRequest: (cb: (payload: { reqId: string; modelId: string; type: 'message' | 'research' }) => void) => () => void
```
改为：
```ts
      onDiagnosticsProbeRequest: (cb: (payload: { reqId: string; modelId: string; type: 'message' | 'research' | 'pick'; options?: { ancestorDepth?: number; childDepth?: number } }) => void) => () => void
```

- [ ] **Step 4: 修改 `src/main/ipcHandlers.ts:107-121` — probe handler 支持 type:'pick' + options + 60s 超时**

将：
```ts
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
            pendingProbeRequests.set(reqId, { resolve, timer })
            mainWin.webContents.send('diagnostics:probe-request', { reqId, ...payload })
        })
    })
```
改为：
```ts
    ipcMain.handle('diagnostics:probe', async (_e, payload: { modelId: string; type: 'message' | 'research' | 'pick'; options?: { ancestorDepth?: number; childDepth?: number } }) => {
        const mainWin = getMainWindow()
        if (!mainWin || mainWin.isDestroyed()) {
            return { success: false, error: '主窗口未就绪' }
        }
        const reqId = `probe-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
        // pick 模式需用户手动点选平台页元素，超时放宽到 60s（其余维持 5s）
        const timeoutMs = payload.type === 'pick' ? 60000 : 5000
        return new Promise((resolve) => {
            const timer = setTimeout(() => {
                pendingProbeRequests.delete(reqId)
                resolve({ success: false, error: '主窗口响应超时' })
            }, timeoutMs)
            pendingProbeRequests.set(reqId, { resolve, timer })
            mainWin.webContents.send('diagnostics:probe-request', { reqId, ...payload })
        })
    })
```

- [ ] **Step 5: 类型检查 + Lint**

Run: `npm run build && npm run lint`
Expected: 通过。

- [ ] **Step 6: Commit**

```bash
git add src/main/ipcHandlers.ts src/preload/index.ts src/preload/index.d.ts src/renderer/src/env.d.ts
git commit -m "feat(diagnostics): IPC 契约支持 type:'pick' 与 options 透传"
```

---

### Task 3: `WebviewCard` 新增 `probeDomStructure`（单元 3）

**Files:**
- Modify: `src/renderer/src/components/WebviewCard.tsx:20`（import）、`:134-138`（WebviewCardRef 类型）、`:886-901`（实现，紧接 probeResearchMode 之后）

**Interfaces:**
- Consumes: Task 1 的 `buildPickerScript`、`parseDomProbeResult`、`DomProbeReport`、`DomProbeOptions`；Task 2 的 IPC 已就绪（此任务不直接用 IPC，relay 在 Task 4）。
- Produces: `WebviewCardRef.probeDomStructure(mode: 'pick', opts): Promise<DomProbeReport>`，供 Task 4 relay 调用。

- [ ] **Step 1: 修改 `WebviewCard.tsx:20` import 行，加新导出**

将：
```ts
import { buildProbeScript, parseProbeResult, type ProbeReport, buildResearchProbeScript, parseResearchProbeResult, type ResearchProbeReport } from '../utils/selectorDiagnostics'
```
改为：
```ts
import { buildProbeScript, parseProbeResult, type ProbeReport, buildResearchProbeScript, parseResearchProbeResult, type ResearchProbeReport, buildPickerScript, parseDomProbeResult, type DomProbeReport, type DomProbeOptions } from '../utils/selectorDiagnostics'
```

- [ ] **Step 2: 修改 `WebviewCard.tsx:134-138` — `WebviewCardRef` 加方法签名**

将：
```ts
  /** dev-only：对当前页面跑 messageContainer 探针，返回每候选命中报告 */
  probeMessageContainer: () => Promise<ProbeReport>
  /** dev-only：对当前页面跑 researchMode 探针，返回每步命中报告（只读） */
  probeResearchMode: () => Promise<ResearchProbeReport>
}
```
改为：
```ts
  /** dev-only：对当前页面跑 messageContainer 探针，返回每候选命中报告 */
  probeMessageContainer: () => Promise<ProbeReport>
  /** dev-only：对当前页面跑 researchMode 探针，返回每步命中报告（只读） */
  probeResearchMode: () => Promise<ResearchProbeReport>
  /** dev-only：进入检拾模式，鼠标点选平台页元素后返回其 DOM 结构（祖先链 + 子树） */
  probeDomStructure: (mode: 'pick', opts?: DomProbeOptions) => Promise<DomProbeReport>
}
```

- [ ] **Step 3: 修改 `WebviewCard.tsx:886-901` — 在 `probeResearchMode` 实现之后追加 `probeDomStructure` 实现**

在 `probeResearchMode` 实现的闭合 `},`（`:901`）之后、`suspend` 之前（`:903` 注释之前）插入：

```ts
      /**
       * dev-only：进入检拾模式，鼠标点选平台页元素后返回其 DOM 结构（祖先链 + 子树）。
       * 注入 picker 脚本（覆盖层 + 高亮 + click 选中 + Esc/超时取消），单次 executeJavaScript 往返。
       * mode 参数预留扩展（当前仅 'pick'）。
       */
      probeDomStructure: async (_mode: 'pick', opts?: DomProbeOptions): Promise<DomProbeReport> => {
        const webview = webviewRef.current
        if (!webview) {
          return { ok: false, error: 'Webview ref 为空' }
        }
        try {
          const raw = await webview.executeJavaScript(buildPickerScript(opts))
          return parseDomProbeResult(raw)
        } catch (error) {
          return { ok: false, error: `页面未就绪或执行失败: ${String(error)}` }
        }
      },
```

- [ ] **Step 4: 类型检查 + Lint**

Run: `npm run build && npm run lint`
Expected: 通过。`probeDomStructure` 已在 ref 上声明，未被外部调用——TS 不会报未使用（ref 方法）。

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/components/WebviewCard.tsx
git commit -m "feat(diagnostics): WebviewCard 新增 probeDomStructure 检拾方法"
```

---

### Task 4: relay `type==='pick'` 分支（`appStore.ts`，单元 4）

**Files:**
- Modify: `src/renderer/src/store/appStore.ts:1600-1614`

**Interfaces:**
- Consumes: Task 2 的 `onDiagnosticsProbeRequest` payload（含 `options`、`type:'pick'`）；Task 3 的 `ref.probeDomStructure`。
- Produces: relay 支持 `'pick'`，把 `options` 透传到 `probeDomStructure`。

- [ ] **Step 1: 修改 `appStore.ts:1600-1614` — probe relay 加 pick 分支**

将：
```ts
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
```
改为：
```ts
    const offProbe = window.api.onDiagnosticsProbeRequest(async ({ reqId, modelId, type, options }) => {
      const { webviewRefs } = get()
      const ref = webviewRefs.get(modelId)
      let result: unknown
      if (!ref) {
        result = { ok: false, error: '平台未加载' }
      } else {
        try {
          if (type === 'message') {
            result = await ref.probeMessageContainer()
          } else if (type === 'research') {
            result = await ref.probeResearchMode()
          } else {
            // type === 'pick'：进入检拾模式，options 透传给 picker（缺省 ancestorDepth:8 / childDepth:3）
            result = await ref.probeDomStructure('pick', options)
          }
        } catch (error) {
          result = { ok: false, error: String(error) }
        }
      }
      window.api.diagnosticsProbeResponse(reqId, result)
    })
```

- [ ] **Step 2: 类型检查 + Lint**

Run: `npm run build && npm run lint`
Expected: 通过。

- [ ] **Step 3: Commit**

```bash
git add src/renderer/src/store/appStore.ts
git commit -m "feat(diagnostics): relay 支持 type:'pick' 透传到 probeDomStructure"
```

---

### Task 5: `DiagnosticsPage` DOM 探测 Tab + `DomTreeView`（单元 6）

**Files:**
- Modify: `src/renderer/src/pages/DiagnosticsPage.tsx`（顶部 import、Tab 栏、新增 `DomTab` 与 `DomTreeView` 组件）

**Interfaces:**
- Consumes: Task 2 的 `window.api.diagnosticsProbe(modelId, 'pick', options)`；Task 1 的 `DomProbeReport`、`NodeFingerprint`、`TreeNode` 类型。
- Produces: 用户可见的 DOM 探测 Tab UI。

- [ ] **Step 1: 修改 `DiagnosticsPage.tsx` 顶部 import，加 DOM 探测类型**

将：
```ts
import { defaultSelectors } from '../config/selectors'
import type { CandidateReport, ProbeReport, ResearchProbeReport, StepReport } from '../utils/selectorDiagnostics'
```
改为：
```ts
import { defaultSelectors } from '../config/selectors'
import type { CandidateReport, ProbeReport, ResearchProbeReport, StepReport, DomProbeReport, NodeFingerprint, TreeNode } from '../utils/selectorDiagnostics'
```

- [ ] **Step 2: 修改 `DiagnosticsPage.tsx` Tab 栏，加 DOM Tab**

将：
```tsx
      <div className="flex border-b border-border">
        <TabButton active={tab === 'message'} onClick={() => setTab('message')} label="消息容器 (messageContainer)" />
        <TabButton active={tab === 'research'} onClick={() => setTab('research')} label="深度研究 (researchMode)" />
      </div>
```
改为：
```tsx
      <div className="flex border-b border-border">
        <TabButton active={tab === 'message'} onClick={() => setTab('message')} label="消息容器 (messageContainer)" />
        <TabButton active={tab === 'research'} onClick={() => setTab('research')} label="深度研究 (researchMode)" />
        <TabButton active={tab === 'dom'} onClick={() => setTab('dom')} label="DOM 探测 (检拾)" />
      </div>
```

并将 `tab` state 类型扩展。将：
```tsx
  const [tab, setTab] = useState<'message' | 'research'>('message')
```
改为：
```tsx
  const [tab, setTab] = useState<'message' | 'research' | 'dom'>('message')
```

并将 Tab 内容渲染分支扩展。将：
```tsx
          {tab === 'message'
            ? <MessageTab modelId={selectedId} />
            : <ResearchTab modelId={selectedId} />}
```
改为：
```tsx
          {tab === 'message'
            ? <MessageTab modelId={selectedId} />
            : tab === 'research'
              ? <ResearchTab modelId={selectedId} />
              : <DomTab modelId={selectedId} />}
```

- [ ] **Step 3: 在 `DiagnosticsPage.tsx` 文件末尾（`export default DiagnosticsPage` 之前）追加 `DomTab` 与 `DomTreeView` 组件**

在 `ResearchReportView` 组件之后、`export default DiagnosticsPage` 之前插入：

```tsx
function DomTab({ modelId }: { modelId: string }): JSX.Element {
  const [report, setReport] = useState<DomProbeReport | null>(null)
  const [running, setRunning] = useState(false)
  const [ancestorDepth, setAncestorDepth] = useState(8)
  const [childDepth, setChildDepth] = useState(3)

  const pick = async (): Promise<void> => {
    setRunning(true); setReport(null)
    try {
      const res = await window.api.diagnosticsProbe(modelId, 'pick', { ancestorDepth, childDepth })
      setReport(res.success && res.data ? res.data as DomProbeReport : { ok: false, error: res.error })
    } finally { setRunning(false) }
  }

  return (
    <div>
      <div className="flex items-center gap-3 mb-3">
        <label className="text-xs text-text-secondary">祖先层数
          <input type="number" min={1} max={20} value={ancestorDepth}
            onChange={(e) => setAncestorDepth(Math.max(1, Math.min(20, Number(e.target.value) || 8)))}
            className="ml-1 w-14 px-2 py-0.5 text-sm border border-border rounded bg-bg-primary" />
        </label>
        <label className="text-xs text-text-secondary">子树层数
          <input type="number" min={1} max={6} value={childDepth}
            onChange={(e) => setChildDepth(Math.max(1, Math.min(6, Number(e.target.value) || 3)))}
            className="ml-1 w-14 px-2 py-0.5 text-sm border border-border rounded bg-bg-primary" />
        </label>
        <button type="button" onClick={pick} disabled={running || !modelId}
          className="px-3 py-1.5 text-sm rounded-lg bg-primary text-white disabled:opacity-40">
          {running ? '检拾中…（点平台页元素 / Esc 取消）' : '进入检拾'}
        </button>
      </div>
      {report && <DomReportView report={report} />}
    </div>
  )
}

function DomReportView({ report }: { report: DomProbeReport }): JSX.Element {
  if (!report.ok) {
    if (report.cancelled) return <div className="text-text-secondary text-sm">已取消（Esc）</div>
    return <div className="text-red-600 text-sm">{report.error ?? '检拾失败'}</div>
  }
  return (
    <div className="space-y-3">
      {report.target && <TargetCard target={report.target} selector={report.selector} />}
      {report.ancestors && report.ancestors.length > 0 && (
        <div>
          <div className="text-xs text-text-secondary mb-1">祖先链（根 → 目标）</div>
          <div className="space-y-0.5">
            {report.ancestors.map((n, i) => <FingerprintRow key={i} node={n} depth={0} />)}
          </div>
        </div>
      )}
      {report.subtree && (
        <div>
          <div className="text-xs text-text-secondary mb-1">子树</div>
          <SubtreeView node={report.subtree} depth={0} defaultOpenDepth={2} />
        </div>
      )}
    </div>
  )
}

function TargetCard({ target, selector }: { target: NodeFingerprint; selector?: string }): JSX.Element {
  const copy = (text: string): void => { navigator.clipboard?.writeText(text).catch(() => {}) }
  return (
    <div className="border-2 border-primary rounded-lg p-3 bg-blue-50/40">
      <div className="text-xs text-text-secondary mb-1">选中元素</div>
      <div className="font-mono text-sm break-all">{formatFingerprint(target)}</div>
      {selector && (
        <div className="mt-2 flex items-center gap-2">
          <code className="text-xs bg-bg-primary px-2 py-0.5 rounded border border-border break-all">{selector}</code>
          <button type="button" onClick={() => copy(selector)}
            className="px-2 py-0.5 text-xs rounded bg-white/60 hover:bg-white/80 text-text-primary border border-border">
            复制选择器
          </button>
        </div>
      )}
    </div>
  )
}

function FingerprintRow({ node, depth }: { node: NodeFingerprint; depth: number }): JSX.Element {
  return (
    <div className="font-mono text-xs text-text-secondary break-all" style={{ paddingLeft: depth * 12 }}>
      {formatFingerprint(node)} {!node.isVisible && <span className="text-red-500">(不可见)</span>}
    </div>
  )
}

function SubtreeView({ node, depth, defaultOpenDepth }: { node: TreeNode; depth: number; defaultOpenDepth: number }): JSX.Element {
  const [open, setOpen] = useState(depth < defaultOpenDepth)
  const hasChildren = node.children.length > 0
  return (
    <div style={{ paddingLeft: depth > 0 ? 12 : 0 }}>
      <div className="font-mono text-xs break-all flex items-center gap-1">
        {hasChildren ? (
          <button type="button" onClick={() => setOpen(!open)} className="text-text-secondary hover:text-primary w-4">
            {open ? '▼' : '▶'}
          </button>
        ) : (
          <span className="w-4 inline-block" />
        )}
        <span className={depth === 0 ? 'text-primary font-semibold' : 'text-text-primary'}>
          {formatFingerprint(node)}
        </span>
        {!node.isVisible && <span className="text-red-500">(不可见)</span>}
      </div>
      {open && hasChildren && (
        <div className="mt-0.5">
          {node.children.map((c, i) => <SubtreeView key={i} node={c} depth={depth + 1} defaultOpenDepth={defaultOpenDepth} />)}
        </div>
      )}
    </div>
  )
}

function formatFingerprint(n: NodeFingerprint): string {
  const cls = n.className ? '.' + n.className.trim().split(/\s+/).slice(0, 2).join('.') : ''
  const id = n.id ? '#' + n.id : ''
  const testid = n.dataTestid ? ` [data-testid=${n.dataTestid}]` : ''
  const role = n.attrs?.role ? ` [role=${n.attrs.role}]` : ''
  return `${n.tag}${id}${cls}${testid}${role}`
}
```

- [ ] **Step 4: 类型检查 + Lint**

Run: `npm run build && npm run lint`
Expected: 通过。`TreeNode`、`NodeFingerprint`、`DomProbeReport` 已在 import 中引入并使用。

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/pages/DiagnosticsPage.tsx
git commit -m "feat(diagnostics): 新增 DOM 探测 Tab（检拾模式 + DOM 树渲染）"
```

---

### Task 6: 手动验证（dev 环境）

**Files:** 无代码改动，仅运行验证。

- [ ] **Step 1: 启动 dev**

Run: `npm run dev`
Expected: 桌面窗口打开。

- [ ] **Step 2: 基本路径验证**

步骤：
1. 在 chatgpt 平台卡片触发一次 AI 回复，等流式结束。
2. 打开诊断窗口（设置抽屉入口）→ 切到「DOM 探测」Tab。
3. 祖先 8 / 子树 3 → 点「进入检拾」。
4. 鼠标移到 chatgpt 页面，确认出现蓝色高亮框跟随鼠标 + 浮标显示 `tag.id.class[data-testid]`。
5. 点中一条 AI 回复消息。
6. 确认诊断窗口渲染：祖先链（应含 `body > … > article` 等）、选中元素卡片（指纹 + 复制选择器按钮）、子树可展开。
Expected: 高亮跟随正常，点选后 DOM 结构正确返回。

- [ ] **Step 3: Esc 取消验证**

步骤：进入检拾后按 Esc。
Expected: 诊断窗口显示"已取消（Esc）"，平台页覆盖层消失、交互恢复。

- [ ] **Step 4: 复制选择器验证**

步骤：选中目标后点「复制选择器」，到 chatgpt 页面 DevTools Console 粘贴运行 `document.querySelector('...')`。
Expected: 命中同一元素。

- [ ] **Step 5: 未加载平台验证**

步骤：选一个未加载/未登录的平台，点「进入检拾」。
Expected: 显示"平台未加载"或对应错误，不卡死。

- [ ] **Step 6: 重复进入验证**

步骤：连续快速点两次「进入检拾」。
Expected: 旧 picker 被清理（防重入 `cleanup()`），只保留一个活跃覆盖层。

- [ ] **Step 7: 记录验证结果到 SESSION_LOG**

Run: `python .memory/session_log.py --done "诊断窗口新增 DOM 检拾模式 Tab（检拾→DOM 结构回传）" --modified "src/renderer/src/utils/selectorDiagnostics.ts,src/renderer/src/components/WebviewCard.tsx,src/renderer/src/store/appStore.ts,src/main/ipcHandlers.ts,src/preload/index.ts,src/preload/index.d.ts,src/renderer/src/env.d.ts,src/renderer/src/pages/DiagnosticsPage.tsx"`

> 注意脚本输出的 lesson 提示：若有 `Consider promoting stable lessons`，需提取到 `.memory/KNOWLEDGE.md` 并把对应 `- lesson:` 改为 `- lesson(promoted):`。

---

## Self-Review 记录

**1. Spec 覆盖：**
- §4.1 DOM 序列化纯函数 → Task 1（`buildDomProbeScript`/`parseDomProbeResult` + 类型）。✅
- §4.2 Picker 脚本 → Task 1 Step 2（`buildPickerScript`）。✅
- §4.3 WebviewCard 方法 → Task 3。✅
- §4.4 relay 适配 → Task 4。✅
- §4.5 DiagnosticsPage DOM Tab → Task 5。✅
- §6 IPC 5 处同步 → Task 2（ipcHandlers + preload ×2 + env.d.ts）、Task 4（appStore relay）。✅
- §8 测试 7 项 → Task 6 步骤 2-6（超时 120s 难手动触发，spec 已标注 picker 自身兜底，省略实跑 120s 等待，保留 relay 60s 亦不强制触发）。⚠️ 超时项未手动覆盖——可在 SESSION_LOG unresolved 记录。
- §7 安全/脱敏 → picker 脚本白名单属性 + 仅 `visibleTextLen`，Task 1 代码已落实。✅

**2. Placeholder 扫描：** 无 TBD/TODO；所有代码步骤含完整代码块。✅

**3. 类型一致性：**
- `probeDomStructure(mode: 'pick', opts?: DomProbeOptions)`：Task 3 声明与 Task 4 调用 `ref.probeDomStructure('pick', options)` 一致。✅
- `DomProbeReport`：Task 1 定义，Task 5 消费（`res.data as DomProbeReport`）。✅
- `diagnosticsProbe(modelId, type, options?)`：Task 2 定义，Task 5 调用 `window.api.diagnosticsProbe(modelId, 'pick', { ancestorDepth, childDepth })` 一致。✅
- `buildPickerScript(opts: DomProbeOptions)`：Task 1 定义，Task 3 调用 `buildPickerScript(opts)` 一致。✅

**4. 风险/遗留：**
- Shadow DOM 不穿透 `elementFromPoint`（spec §9）——首版不处理，UI 在 picker 未命中时返回 error，用户可感知。可在 Task 6 后视情况加提示文案。
- 120s 超时项未手动触发验证——属极端路径，picker 自身 `setTimeout` 兜底已覆盖代码层，记入 unresolved。
