# messageContainer 选择器诊断面板 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 dev 模式下提供一个集中诊断面板，2 秒内报告每个平台每个 `messageContainer` 候选在真实页面上的命中情况，并给出脱敏元素指纹，让失效选择器的修复从"猜测"变成"读表"。

**Architecture:** 纯渲染层方案。复用两个现成 seam：`useAppStore.webviewRefs.get(id)` 取各卡片 webview ref，`webview.executeJavaScript(code)` 在平台页内跑探针。探针的 `safeQueryAll`/shadow兜底/去重/`isVisible` 四函数**同源拷贝**自 `src/shared/utils/webviewScripts.ts:1509-1572`，保证"探针命中 = 生产命中"。仅 `import.meta.env.DEV` 下渲染，不进 production build。

**Tech Stack:** TypeScript (strict), React 18, Zustand 4, Tailwind 3, Electron 28 webview `executeJavaScript`，electron-vite `import.meta.env.DEV`。

## Global Constraints

- **分层**：本计划全部改动在 `src/renderer/`（渲染层），不碰 `src/main/`、`src/preload/`、IPC 契约。
- **不修改生产逻辑**：`src/shared/config/selectors.ts`（数据，仅 Task 6 示范修复时改 `version`）与 `src/shared/utils/webviewScripts.ts`（生产匹配逻辑，仅作同源拷贝来源，不改其内容）。
- **脱敏铁律**：探针报告 `firstHit` 只含 `tagName`+`className`+`id`+`data-testid`+可见正文**长度**；不含 `outerHTML` 原文、正文文本、其他属性值。
- **同源铁律**：探针四函数实现必须与 `webviewScripts.ts:1509-1572` 一致，注释注明来源行号。
- **DEV 门控**：诊断入口与面板仅在 `import.meta.env.DEV` 为真时渲染；`npm run build` 产物中不得出现。
- **包管理器**：npm only。
- **无测试运行器**：验证 = `npm run lint` → `npm run build` → `npm run dev` 手动。
- **分支**：禁止擅自切分支，只在 `main` 上工作（除非用户明确同意）。
- **Commit**：Conventional Commits，消息结尾加 `Co-Authored-By: Claude <noreply@anthropic.com>`。

---

## File Structure

| 文件 | 责任 | 类型 |
|---|---|---|
| `src/renderer/src/utils/selectorDiagnostics.ts` | 探针脚本构建 + 结果解析（纯函数，无 React 依赖） | 新增 |
| `src/renderer/src/components/SelectorDiagnosticsPanel.tsx` | 集中 Dev 诊断面板（抽屉形态） | 新增 |
| `src/renderer/src/components/WebviewCard.tsx` | `WebviewCardRef` 新增 `probeMessageContainer` 方法 | 小改 |
| `src/renderer/src/components/Layout.tsx` | 顶栏 dev 入口按钮 + 面板挂载 | 小改 |
| `tsconfig.web.json` | 加 `vite/client` 类型，使 `import.meta.env.DEV` 类型通过 | 小改 |
| `docs/选择器维护方法论.md` | 可复用维护闭环文档 | 新增 |

**不改动**：`src/shared/config/selectors.ts`（数据）、`src/shared/utils/webviewScripts.ts`（生产逻辑）、主进程、preload、IPC、`electron.vite.config.ts`。

---

## Task 1: 加 vite/client 类型，启用 import.meta.env.DEV 类型通道

**Files:**
- Modify: `tsconfig.web.json`（`compilerOptions` 加 `types`）

**Interfaces:**
- Produces: `import.meta.env.DEV: boolean` 在渲染层类型通过，供 Task 4 / Task 5 门控使用。

**Why:** 现有 `tsconfig.web.json` 无 `vite/client` 类型，`import.meta.env.DEV` 在 strict TS 下不通过类型检查，`npm run build` 会失败。这是 DEV 门控的前置条件。

- [ ] **Step 1: 查看 tsconfig.web.json 当前内容**

Run: `cat tsconfig.web.json`
Expected: 见到 `compilerOptions` 块，无 `types` 字段。

- [ ] **Step 2: 在 compilerOptions 加 types 字段**

把 `tsconfig.web.json` 的 `compilerOptions` 块内，紧接 `"skipLibCheck": true,` 之后，加入 `"types": ["vite/client"],`。

修改后 `compilerOptions` 顶部应为：

```json
{
  "compilerOptions": {
    "composite": true,
    "jsx": "react-jsx",
    "lib": ["DOM", "DOM.Iterable", "ESNext"],
    "module": "ESNext",
    "moduleResolution": "bundler",
    "baseUrl": ".",
    "paths": {
      "@renderer/*": ["src/renderer/src/*"]
    },
    "resolveJsonModule": true,
    "allowSyntheticDefaultImports": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "types": ["vite/client"],
    "strict": true,
    "noEmit": true
  },
```

- [ ] **Step 3: 验证类型检查通过**

Run: `npm run build`
Expected: 构建成功，无 `Cannot find name 'import'` / `Property 'env' does not exist on 'ImportMeta'` 错误。（此时还未使用 `import.meta.env`，只是确保加了类型不破坏现有构建。）

- [ ] **Step 4: Commit**

```bash
git add tsconfig.web.json
git commit -m "chore: add vite/client types to renderer tsconfig

为后续 dev-only 诊断面板的 import.meta.env.DEV 门控提供类型支撑。

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 2: 探针纯函数（buildProbeScript + parseProbeResult）

**Files:**
- Create: `src/renderer/src/utils/selectorDiagnostics.ts`

**Interfaces:**
- Consumes: 无（纯函数，输入为 `string[]`）
- Produces:
  ```typescript
  export interface CandidateReport {
    selector: string
    hitCount: number
    visibleHitCount: number
    firstHit: {
      tag: string
      className: string | null
      id: string | null
      dataTestid: string | null
      visibleTextLen: number
    } | null
    error?: string
  }
  export interface ProbeReport {
    ok: boolean
    candidates: CandidateReport[]
    error?: string
  }
  export function buildProbeScript(selectors: string[]): string
  export function parseProbeResult(raw: unknown): ProbeReport
  ```
  供 Task 3（`WebviewCard.probeMessageContainer`）与 Task 4（面板）使用。

**Why:** 探针是被 `executeJavaScript` 注入到平台页内执行的字符串。把"构建脚本"和"解析结果"拆成纯函数，便于在不启动 webview 的情况下用 Node 单测脚本验证逻辑，也使 `WebviewCard` 侧只剩一行调用。

- [ ] **Step 1: 创建 selectorDiagnostics.ts，定义类型**

新建 `src/renderer/src/utils/selectorDiagnostics.ts`，写入类型与文件头注释：

```typescript
/**
 * messageContainer 选择器诊断工具（dev-only）
 * 探针逻辑同源拷贝自 src/shared/utils/webviewScripts.ts:1509-1572，
 * 保证"探针命中 = 生产命中"。修改 webviewScripts.ts 的匹配逻辑时必须同步本文件。
 */

export interface CandidateReport {
  selector: string
  hitCount: number
  visibleHitCount: number
  firstHit: {
    tag: string
    className: string | null
    id: string | null
    dataTestid: string | null
    /** 元素可见正文长度（脱敏：仅长度，不含正文内容） */
    visibleTextLen: number
  } | null
  error?: string
}

export interface ProbeReport {
  ok: boolean
  candidates: CandidateReport[]
  error?: string
}
```

- [ ] **Step 2: 实现 buildProbeScript**

在同文件追加。返回的字符串将被 `webview.executeJavaScript` 执行，必须以 `return` 形式返回可序列化 JSON。探针四函数同源拷贝自 `webviewScripts.ts`，注释标注来源行号：

```typescript
/**
 * 构建在平台页内执行的探针脚本字符串。
 * @param selectors 候选选择器数组（来自 selectors.models[id].messageContainer）
 * @returns 可传入 webview.executeJavaScript 的脚本字符串
 */
export function buildProbeScript(selectors: string[]): string {
  // 探针四函数同源拷贝自 webviewScripts.ts:1509-1572，注释行号对应原文件
  return `(function () {
    var containerSelectors = ${JSON.stringify(selectors)};

    // 来源: webviewScripts.ts:1512
    function safeQueryAll(root, selector) {
      try {
        return Array.from(root.querySelectorAll(selector));
      } catch (e) {
        return [];
      }
    }

    // 来源: webviewScripts.ts:1553
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
      } catch (e) {
        return false;
      }
    }

    // 来源: webviewScripts.ts:1524-1538（shadow root 兜底）
    function queryAllWithShadow(selector) {
      var hits = safeQueryAll(document, selector);
      if (hits.length > 0) return hits;
      var docRoot = document.body || document.documentElement;
      if (docRoot && document.createTreeWalker) {
        var walker = document.createTreeWalker(docRoot, NodeFilter.SHOW_ELEMENT);
        var node = walker.currentNode;
        while (node) {
          var el = node;
          if (el && el.shadowRoot) {
            hits = hits.concat(safeQueryAll(el.shadowRoot, selector));
          }
          node = walker.nextNode();
        }
      }
      return hits;
    }

    function describeFirst(el) {
      if (!el) return null;
      var text = '';
      try {
        text = (el.innerText || el.textContent || '') + '';
      } catch (e) {
        text = '';
      }
      // 脱敏：仅长度，不含正文
      return {
        tag: (el.tagName || '').toLowerCase(),
        className: (typeof el.className === 'string' ? el.className : null),
        id: el.getAttribute('id') || null,
        dataTestid: el.getAttribute('data-testid') || null,
        visibleTextLen: text.replace(/​/g, '').trim().length
      };
    }

    var candidates = containerSelectors.map(function (selector) {
      var hits = [];
      var err = null;
      try {
        hits = queryAllWithShadow(selector);
      } catch (e) {
        err = String(e && e.message ? e.message : e);
      }
      // 去重（来源: webviewScripts.ts:1545-1551）
      var seen = {};
      var unique = [];
      for (var i = 0; i < hits.length; i++) {
        var h = hits[i];
        if (!h || seen[k]) continue; // 注：此处占位，见 Step 3 修正
      }
      var firstVisible = null;
      var visibleCount = 0;
      for (var j = 0; j < unique.length; j++) {
        if (isVisible(unique[j])) {
          visibleCount++;
          if (!firstVisible) firstVisible = unique[j];
        }
      }
      var report = {
        selector: selector,
        hitCount: hits.length,
        visibleHitCount: visibleCount,
        firstHit: describeFirst(firstVisible)
      };
      if (err) report.error = err;
      return report;
    });

    return JSON.stringify({ ok: true, candidates: candidates });
  })();`
}
```

- [ ] **Step 3: 修正去重逻辑（Step 2 占位处的 bug）**

Step 2 的去重循环里有占位 bug（`seen[k]` 未定义 `k`）。用 `el` 本身做 Set key 不可靠（对象作 key 变成字符串），改用数组+indexOf 去重。把 Step 2 中的去重块替换为：

```typescript
      // 去重（来源: webviewScripts.ts:1545-1551，用 indexOf 实现以适配注入环境）
      var unique = [];
      for (var i = 0; i < hits.length; i++) {
        var h = hits[i];
        if (!h) continue;
        if (unique.indexOf(h) === -1) unique.push(h);
      }
```

（删除原 `var seen = {};` 及其循环。）

- [ ] **Step 4: 实现 parseProbeResult**

在同文件追加：

```typescript
/**
 * 解析 executeJavaScript 返回的探针结果。
 * 异常兜底返回 { ok: false, candidates: [], error }。
 */
export function parseProbeResult(raw: unknown): ProbeReport {
  if (typeof raw !== 'string') {
    return { ok: false, candidates: [], error: '探针返回非字符串' }
  }
  try {
    const parsed = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.candidates)) {
      return { ok: false, candidates: [], error: '探针返回结构异常' }
    }
    return {
      ok: !!parsed.ok,
      candidates: parsed.candidates as CandidateReport[]
    }
  } catch (e) {
    return { ok: false, candidates: [], error: `结果解析失败: ${String(e)}` }
  }
}
```

- [ ] **Step 5: 用 Node 脚本做离线验证（无需 webview）**

Run:
```bash
node -e "
const m = require('./src/renderer/src/utils/selectorDiagnostics.ts');
" 2>&1 | head -5 || true
```
说明：`.ts` 不能直接 require。改用下面的离线校验：把 `buildProbeScript` 的输出字符串粘进浏览器 DevTools 控制台（或用 `npm run dev` 起后在任一 webview DevTools 里粘）来手验。此步先只做**静态校验**：

Run: `npx tsc --noEmit -p tsconfig.web.json`
Expected: 无类型错误（确认 `selectorDiagnostics.ts` 类型通过）。

- [ ] **Step 6: Commit**

```bash
git add src/renderer/src/utils/selectorDiagnostics.ts
git commit -m "feat(renderer): add messageContainer selector probe utils

buildProbeScript/parseProbeResult 纯函数，探针四函数同源拷贝自
webviewScripts.ts:1509-1572，严格脱敏仅返回元素元数据+正文长度。

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 3: WebviewCardRef 加 probeMessageContainer 方法

**Files:**
- Modify: `src/renderer/src/components/WebviewCard.tsx`（接口 `:110-131` 与 `useImperativeHandle` 块 `:456`）

**Interfaces:**
- Consumes: `buildProbeScript`, `parseProbeResult`, `ProbeReport`（来自 Task 2）；`webviewRef`、`selectors`（`WebviewCard` 内已有）
- Produces: `WebviewCardRef.probeMessageContainer: () => Promise<ProbeReport>`，供 Task 4 面板经 `useAppStore.webviewRefs.get(id).probeMessageContainer()` 调用。

**Why:** 面板不能直接拿 webview ref（封装在 `WebviewCard` 内），必须经 `WebviewCardRef` 暴露方法。沿用文件内既有 `executeJavaScript` 模式（`:479` 等）。

- [ ] **Step 1: 加 import**

在 `src/renderer/src/components/WebviewCard.tsx` 顶部 import 区（`defaultSelectors` import 行 `:4` 附近）追加：

```typescript
import { buildProbeScript, parseProbeResult, type ProbeReport } from '../utils/selectorDiagnostics'
```

- [ ] **Step 2: 接口加方法签名**

在 `WebviewCardRef` 接口（`:110`）末尾、`isHibernated` 之前或之后，追加一行：

```typescript
  /** dev-only：对当前页面跑 messageContainer 探针，返回每候选命中报告 */
  probeMessageContainer: () => Promise<ProbeReport>
```

- [ ] **Step 3: 在 useImperativeHandle 实现该方法**

在 `useImperativeHandle`（`:456`）返回的对象内，紧接 `getCurrentUrl` / `loadURL` 实现之后（约 `:855` 附近，`suspend` 之前），追加：

```typescript
      probeMessageContainer: async (): Promise<ProbeReport> => {
        const webview = webviewRef.current
        if (!webview) {
          return { ok: false, candidates: [], error: 'Webview ref 为空' }
        }
        const list = selectors?.messageContainer ?? []
        if (list.length === 0) {
          return { ok: false, candidates: [], error: '该平台无 messageContainer 配置' }
        }
        try {
          const raw = await webview.executeJavaScript(buildProbeScript(list))
          return parseProbeResult(raw)
        } catch (error) {
          return { ok: false, candidates: [], error: `页面未就绪或执行失败: ${String(error)}` }
        }
      },
```

- [ ] **Step 4: 类型检查 + lint**

Run: `npm run lint`
Expected: 无新增错误。

Run: `npx tsc --noEmit -p tsconfig.web.json`
Expected: 无类型错误。

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/components/WebviewCard.tsx
git commit -m "feat(webview): expose probeMessageContainer on WebviewCardRef

面板经此方法在平台页内跑探针，沿用既有 executeJavaScript 模式。

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 4: 集中 Dev 诊断面板组件

**Files:**
- Create: `src/renderer/src/components/SelectorDiagnosticsPanel.tsx`

**Interfaces:**
- Consumes:
  - `useAppStore`（取 `webviewRefs: Map<string, WebviewCardRef>`、`models`）
  - `defaultSelectors.models`（取 14 平台 id 列表与 `messageContainer` 候选）
  - `WebviewCardRef.probeMessageContainer()`（来自 Task 3）
- Produces: `SelectorDiagnosticsPanel` 组件，props `{ isOpen: boolean; onClose: () => void }`，供 Task 5 挂载。

**Why:** 集中入口需要遍历所有平台并按 id 取 ref，组件封装这一逻辑 + 报告渲染。

- [ ] **Step 1: 创建组件骨架（抽屉形态，沿用 SettingsDrawer 模式）**

新建 `src/renderer/src/components/SelectorDiagnosticsPanel.tsx`：

```typescript
import { useState } from 'react'
import { useAppStore } from '../store/appStore'
import { defaultSelectors } from '../config/selectors'
import type { WebviewCardRef } from './WebviewCard'
import type { CandidateReport, ProbeReport } from '../utils/selectorDiagnostics'

interface SelectorDiagnosticsPanelProps {
  isOpen: boolean
  onClose: () => void
}

type RowStatus = 'idle' | 'running' | 'ok' | 'partial' | 'failed' | 'unloaded' | 'error'

interface PlatformRow {
  status: RowStatus
  report?: ProbeReport
  error?: string
}

function statusBadge(status: RowStatus): { icon: string; text: string; cls: string } {
  switch (status) {
    case 'ok': return { icon: '✅', text: '全部命中', cls: 'text-green-600' }
    case 'partial': return { icon: '⚠️', text: '命中空元素', cls: 'text-yellow-600' }
    case 'failed': return { icon: '❌', text: '全失效', cls: 'text-red-600' }
    case 'unloaded': return { icon: '⚫', text: '未加载', cls: 'text-text-secondary' }
    case 'running': return { icon: '⏳', text: '诊断中', cls: 'text-blue-600' }
    case 'error': return { icon: '⚠️', text: '错误', cls: 'text-red-600' }
    default: return { icon: '⚪', text: '未诊断', cls: 'text-text-secondary' }
  }
}

function deriveStatus(report: ProbeReport): RowStatus {
  if (!report.ok) return 'error'
  const cands = report.candidates
  if (cands.length === 0) return 'failed'
  const anyVisible = cands.some(c => c.visibleHitCount > 0)
  const firstHasText = cands.some(c => c.firstHit && c.firstHit.visibleTextLen > 0)
  if (firstHasText) return 'ok'
  if (anyVisible) return 'partial'
  return 'failed'
}

function SelectorDiagnosticsPanel({ isOpen, onClose }: SelectorDiagnosticsPanelProps): JSX.Element | null {
  const webviewRefs = useAppStore((s) => s.webviewRefs)
  const [rows, setRows] = useState<Record<string, PlatformRow>>({})
  const [expanded, setExpanded] = useState<string | null>(null)

  if (!isOpen) return null

  const platformIds = Object.keys(defaultSelectors.models)

  const diagnose = async (id: string): Promise<void> => {
    const ref: WebviewCardRef | undefined = webviewRefs.get(id)
    if (!ref) {
      setRows((prev) => ({ ...prev, [id]: { status: 'unloaded' } }))
      return
    }
    setRows((prev) => ({ ...prev, [id]: { status: 'running' } }))
    try {
      const report = await ref.probeMessageContainer()
      setRows((prev) => ({ ...prev, [id]: { status: deriveStatus(report), report } }))
    } catch (error) {
      setRows((prev) => ({ ...prev, [id]: { status: 'error', error: String(error) } }))
    }
  }

  const diagnoseAll = async (): Promise<void> => {
    await Promise.all(platformIds.map((id) => diagnose(id)))
  }

  return (
    <div className="fixed inset-0 z-50 flex">
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />
      <div className="relative ml-auto h-full w-[640px] max-w-[90vw] bg-bg-secondary shadow-xl flex flex-col">
        <div className="flex items-center justify-between px-5 py-4 border-b border-border">
          <h2 className="text-lg font-semibold text-text-primary">🔬 选择器诊断 (dev)</h2>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={diagnoseAll}
              className="px-3 py-1.5 text-sm rounded-lg bg-primary text-white hover:opacity-90"
            >全部诊断</button>
            <button type="button" onClick={onClose} className="w-7 h-7 flex items-center justify-center text-text-secondary hover:text-text-primary">✕</button>
          </div>
        </div>
        <div className="flex-1 overflow-auto px-5 py-3 space-y-1">
          {platformIds.map((id) => {
            const row = rows[id] ?? { status: 'idle' as RowStatus }
            const badge = statusBadge(row.status)
            const isExpanded = expanded === id
            return (
              <div key={id} className="border border-border rounded-lg">
                <div className="flex items-center gap-3 px-3 py-2">
                  <span className="w-5 text-center">{badge.icon}</span>
                  <span className="flex-1 text-sm text-text-primary">{id}</span>
                  <span className={`text-xs ${badge.cls}`}>{badge.text}</span>
                  <button
                    type="button"
                    disabled={row.status === 'running'}
                    onClick={() => diagnose(id)}
                    className="px-2 py-1 text-xs rounded bg-white/60 hover:bg-white/80 text-text-primary disabled:opacity-40"
                  >诊断</button>
                  <button
                    type="button"
                    onClick={() => setExpanded(isExpanded ? null : id)}
                    className="text-xs text-text-secondary hover:text-text-primary"
                  >{isExpanded ? '收起' : '展开'}</button>
                </div>
                {isExpanded && row.report && (
                  <CandidateTable report={row.report} />
                )}
                {isExpanded && row.error && (
                  <div className="px-3 py-2 text-xs text-red-600">{row.error}</div>
                )}
              </div>
            )
          })}
        </div>
        <div className="px-5 py-3 border-t border-border text-xs text-text-secondary">
          先在该平台窗口触发一次 AI 回复并等流式结束，再点诊断。报告仅含元素元数据与正文长度，不含正文内容。
        </div>
      </div>
    </div>
  )
}

function CandidateTable({ report }: { report: ProbeReport }): JSX.Element {
  const copy = (text: string): void => {
    navigator.clipboard?.writeText(text).catch(() => {})
  }
  return (
    <div className="px-3 pb-2 overflow-x-auto">
      <table className="w-full text-xs">
        <thead>
          <tr className="text-text-secondary text-left">
            <th className="py-1 pr-2">选择器</th>
            <th className="py-1 pr-2">命中</th>
            <th className="py-1 pr-2">可见</th>
            <th className="py-1 pr-2">正文长</th>
            <th className="py-1">元素指纹</th>
          </tr>
        </thead>
        <tbody>
          {report.candidates.map((c: CandidateReport, i: number) => (
            <tr key={i} className="border-t border-border/50">
              <td className="py-1 pr-2 font-mono break-all max-w-[200px]">
                <button type="button" onClick={() => copy(c.selector)} className="hover:text-primary text-left" title="点击复制">
                  {c.selector}
                </button>
              </td>
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
    </div>
  )
}

export default SelectorDiagnosticsPanel
```

- [ ] **Step 2: 类型检查 + lint**

Run: `npm run lint`
Expected: 无新增错误。若 `useAppStore.webviewRefs` 选择器返回类型报错，确认 `appStore.ts:276` 的 `webviewRefs: Map<string, WebviewCardRef>` 已导出 `WebviewCardRef` 类型可见（必要时把 import 改为 `import type`）。

Run: `npx tsc --noEmit -p tsconfig.web.json`
Expected: 无类型错误。

- [ ] **Step 3: Commit**

```bash
git add src/renderer/src/components/SelectorDiagnosticsPanel.tsx
git commit -m "feat(renderer): add SelectorDiagnosticsPanel dev drawer

集中遍历 14 平台，经 webviewRefs 取 ref 调 probeMessageContainer，
渲染候选表格与状态徽标，严格脱敏仅显示元素指纹+正文长度。

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 5: Layout 顶栏 dev 入口 + 面板挂载

**Files:**
- Modify: `src/renderer/src/components/Layout.tsx`（import 区 `:3`、顶栏按钮块 `:332-349`、SettingsDrawer 挂载处 `:430`）

**Interfaces:**
- Consumes: `SelectorDiagnosticsPanel`（来自 Task 4）；`import.meta.env.DEV`（来自 Task 1 类型支撑）
- Produces: dev 模式下顶栏出现"🔬 选择器诊断"按钮 + 面板可打开。

**Why:** 把面板接到 UI 入口，并用 DEV 门控确保 production build 不含。

- [ ] **Step 1: 加 import 与本地状态**

在 `Layout.tsx` import 区（`SettingsDrawer` import `:3` 附近）追加：

```typescript
import SelectorDiagnosticsPanel from './SelectorDiagnosticsPanel'
```

在 `Layout` 函数内（`useState` 区，`:14` 附近）追加：

```typescript
  const [isDiagnosticsOpen, setDiagnosticsOpen] = useState(false)
```

并在组件顶部加一个 dev 门控常量（紧接 `isDiagnosticsOpen` 之后）：

```typescript
  const isDev = import.meta.env.DEV === true
```

- [ ] **Step 2: 顶栏加按钮（仅 dev）**

在顶栏按钮块（`:332` `<div className="flex items-center gap-1 no-drag">`）内，于"设置"按钮**之前**插入：

```tsx
            {isDev && (
              <button
                type="button"
                onClick={() => setDiagnosticsOpen(true)}
                className="w-7 h-7 flex items-center justify-center text-text-secondary hover:text-primary hover:bg-white/60 rounded-full transition-all duration-200"
                title="选择器诊断 (dev)"
              >
                <span className="material-symbols-outlined text-lg">science</span>
              </button>
            )}
```

- [ ] **Step 3: 挂载面板**

在 `<SettingsDrawer ... />` 挂载处（`:430`）之后追加：

```tsx
      {isDev && (
        <SelectorDiagnosticsPanel
          isOpen={isDiagnosticsOpen}
          onClose={() => setDiagnosticsOpen(false)}
        />
      )}
```

- [ ] **Step 4: lint + 类型检查 + build**

Run: `npm run lint`
Expected: 无新增错误。

Run: `npx tsc --noEmit -p tsconfig.web.json`
Expected: 无类型错误。

Run: `npm run build`
Expected: 构建成功。**抽查** dev 门控：构建产物中诊断按钮不应出现（production 默认 `import.meta.env.DEV === false`，`{isDev && ...}` 被剔除）。

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/components/Layout.tsx
git commit -m "feat(layout): add dev-only selector diagnostics entry in top bar

import.meta.env.DEV 门控，production build 不含诊断入口。

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 6: 方法论文档 + ChatGPT/Kimi 示范验证

**Files:**
- Create: `docs/选择器维护方法论.md`
- Modify（仅在示范发现失效时）: `src/shared/config/selectors.ts`（bump `version` + 修失效候选）

**Why:** 这是用户要的核心产出（方法论 + 1-2 平台示范），固化可复用闭环。

- [ ] **Step 1: 写方法论文档**

新建 `docs/选择器维护方法论.md`：

```markdown
# messageContainer 选择器维护方法论

> Created: <填入 Get-Date 结果> (CST, UTC+8)

## 铁律

1. **探针逻辑必须与 `src/shared/utils/webviewScripts.ts` 同源**。诊断工具 `src/renderer/src/utils/selectorDiagnostics.ts` 的 `safeQueryAll`/shadow兜底/去重/`isVisible` 四函数拷贝自 `webviewScripts.ts:1509-1572`。改 `webviewScripts.ts` 的匹配逻辑时必须同步探针，否则"探针命中 ≠ 生产命中"。
2. **严格脱敏**：探针报告只含元素元数据（tag/className/id/data-testid）+ 正文长度，**不含正文内容 / outerHTML**，避免泄露模型输出与用户输入。
3. **仅 dev 可见**：诊断入口经 `import.meta.env.DEV` 门控，production build 不含。

## 闭环

1. 开 dev（`npm run dev`），打开目标平台卡片，发一条一次性 prompt，**等回复流式结束**。
2. 顶栏点 🔬 打开诊断面板 → 点该平台"诊断"（或"全部诊断"）。
3. 读状态徽标与候选表格：
   - ✅ 全部命中：首位候选 visibleHitCount>0 且正文长>0，无需动。
   - ⚠️ 命中空元素：有 visibleHitCount>0 但正文长=0，说明命中了占位/空容器，需重排或删除该候选。
   - ❌ 全失效：所有候选 visibleHitCount=0，需补新选择器。
4. 补新选择器时**优先稳定信号**（优先级从高到低）：
   1. `data-testid` 精确属性
   2. `aria-label` 精确
   3. `role` + 语义
   4. 语义类名片段（如 `[class*="markdown"]`）
   5. 结构定位（如 `form button[type="submit"]`）
   
   **避开哈希类名**（如 `tagBtn-OADWVI`、`selected-OsA38F`），这是改版重灾区。元素指纹列直接给出可复制的 className/data-testid。
5. 改 `src/shared/config/selectors.ts` 对应平台的 `messageContainer`，**bump `version`**（如 13→14），重启 dev。
6. 再点诊断确认新候选 visibleHitCount>0 且正文长>0。

## 成本

探针让第 2 步变 2 秒检查，单平台成本主要由"触发一次回复"决定。14 平台约半小时。
```

> ⚠️ 写文档前先跑 `powershell -Command "Get-Date -Format 'yyyy-MM-dd HH:mm'"` 获取真实时间，填入 `<Created:>` 行，不要凭记忆。

- [ ] **Step 2: 在 npm run dev 中走通 ChatGPT 示范**

Run: `npm run dev`
手动步骤：
1. 主窗口打开 ChatGPT 卡片，登录态已有（`persist:shared`）。
2. 发一条简单 prompt（如"hi"），等回复流完。
3. 顶栏点 🔬 → 面板里点 chatgpt 行"诊断"。
4. 记录候选表格：首位候选 selector、hitCount、visibleHitCount、正文长。
5. 截图或抄录结果作为验证证据。

Expected: 首位候选 visibleHitCount>0 且正文长>0，状态 ✅。若为 ❌/⚠️，按方法论第 4-5 步修 `selectors.ts` 的 chatgpt.messageContainer，bump version，重启再验。

- [ ] **Step 3: 走通 Kimi 示范**

同 Step 2，对 kimi 平台重复。Expected 同上。

- [ ] **Step 4: 若任一平台被修，commit 选择器改动**

```bash
git add src/shared/config/selectors.ts
git commit -m "fix(selectors): repair <平台> messageContainer per diagnostics probe

bump version, 基于诊断面板实测命中结果更新候选。

Co-Authored-By: Claude <noreply@anthropic.com>"
```

若两平台都未失效，跳过此 Step。

- [ ] **Step 5: Commit 方法论文档**

```bash
git add docs/选择器维护方法论.md
git commit -m "docs: add selector maintenance methodology

固化 messageContainer 选择器维护闭环与三条铁律。

Co-Authored-By: Claude <noreply@anthropic.com>"
```

- [ ] **Step 6: 跑 session_log.py 记录**

Run: `python .memory/session_log.py --done "messageContainer 选择器诊断面板" --added "src/renderer/src/utils/selectorDiagnostics.ts;src/renderer/src/components/SelectorDiagnosticsPanel.tsx;docs/选择器维护方法论.md" --modified "src/renderer/src/components/WebviewCard.tsx;src/renderer/src/components/Layout.tsx;tsconfig.web.json"`

若终端提示 `Consider promoting stable lessons...`，把对应 lesson 追加到 `.memory/KNOWLEDGE.md`，并把 SESSION_LOG.md 对应 `- lesson:` 改为 `- lesson(promoted):`。

---

## Self-Review

**1. Spec coverage：**
- §4.1 探针纯函数 → Task 2 ✅
- §4.2 WebviewCardRef 方法 → Task 3 ✅
- §4.3 集中面板 → Task 4 ✅
- §4.4 Layout 入口 → Task 5 ✅
- §5 错误处理（非法选择器 try/catch、ref 取不到、executeJavaScript reject、结构异常）→ Task 2 Step 2/4 + Task 3 Step 3 + Task 4 deriveStatus/`unloaded` 全覆盖 ✅
- §6 测试（DEV 门控、命中、脱敏、未加载禁用、非法选择器不崩）→ Task 5 Step 4 + Task 6 Step 2/3 ✅
- §7 方法论文档 → Task 6 Step 1 ✅
- §8 示范 → Task 6 Step 2/3 ✅
- §10 风险（同源漂移、DEV 门控遗漏、脱敏、流式中诊断）→ 铁律 + Task 5 build 抽查 + 文档提示 ✅

**2. Placeholder scan：** Task 6 Step 1 文档 `<Created:>` 与 Step 1 的 `<填入>` 有显式"跑 Get-Date 填入"说明，非占位偷懒；其余无 TBD/TODO。

**3. Type consistency：** `ProbeReport`/`CandidateReport` 在 Task 2 定义，Task 3/4 引用一致；`probeMessageContainer` 签名在 Task 3 定义 `() => Promise<ProbeReport>`，Task 4 调用 `ref.probeMessageContainer()` 一致；`WebviewCardRef` import 在 Task 4 用 `import type`，与 Task 3 导出一致。`RowStatus` / `PlatformRow` 在 Task 4 内部自洽。

无遗漏。
