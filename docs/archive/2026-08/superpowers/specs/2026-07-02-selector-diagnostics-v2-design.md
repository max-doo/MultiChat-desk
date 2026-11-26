> Created: 2026-07-02 22:31 (CST, UTC+8)
> Revises: 2026-07-02-selector-diagnostics-design.md（v1，抽屉形态、仅 messageContainer）

# 选择器诊断独立窗口设计 (v2)

> **Status:** Draft — awaiting review
> **Relation:** v1 已实现 Task 1-5（探针纯函数、probeMessageContainer、SelectorDiagnosticsPanel 抽屉、Layout 顶栏入口、方法论）。本 v2 改造为独立 BrowserWindow + 双 Tab（messageContainer + researchMode），入口移入 SettingsDrawer。v1 的探针纯函数与 probeMessageContainer 直接复用。

## 1. 问题陈述（v2 增量）

v1 解决了 messageContainer 选择器的快速体检。用户进一步要求：
1. 诊断入口从顶栏移入设置抽屉（更整洁，与配置类入口同处）。
2. 诊断面板独立为窗口（类似 DevTools），可在主窗口操作平台页面的同时并行查看诊断结果——抽屉形态覆盖主窗口、无法并行操作。
3. 支持深度研究按钮调试：`researchMode.steps` 是 `AutomationStep[]`（含 selector/text/regex/exclude/menuOpenerFallback + 语义兜底），失效排查比 messageContainer 更难，需要专门的只读探针 + 一个"实跑"按钮（真实执行 enableDeepResearch 看能否开启）。

## 2. 非目标

- 不自动生成 / 合并选择器（仍人工审核）
- 不覆盖 textarea/sendButton/imageGeneration（本设计仅 messageContainer + researchMode）
- 不引入新生产依赖
- 不修改 selectors.ts 数据结构、不修改 webviewScripts.ts 生产匹配逻辑（researchMode 探针只复刻 findElement，不改其本体）
- "实跑"按钮只调用既有 enableDeepResearch 路径，不新增点击逻辑

## 3. 架构

### 3.1 独立窗口 + IPC 代理

诊断窗口是一个独立 `BrowserWindow`（仿 `quickWindow`，`webviewManager.ts:655-712`），加载同一 renderer 的 `#diagnostics` hash 路由。但平台 webview 存在于**主窗口 renderer**，诊断窗口 renderer 无法直接访问 `useAppStore.webviewRefs`。故经主进程中转：

```
诊断窗口 renderer                主进程                 主窗口 renderer
─────────────────               ──────                ───────────────
window.api.diagnosticsProbe     ipcMain.handle         window.api.onDiagnosticsProbeRequest
  (modelId, 'message')    ──→   'diagnostics:probe'   ──→  主窗口渲染层查 webviewRefs.get(id)
                                                                  .probeMessageContainer()
                                                        ←──   返回 ProbeReport
  ←── ProbeReport 回传            ←──                   ←──
```

主进程做透传：诊断窗口发 `diagnostics:probe` → 主进程 `webContents.send('diagnostics:probe-request', {reqId, modelId, type})` 给主窗口 → 主窗口处理后 `ipcRenderer.send('diagnostics:probe-response', {reqId, result})` 回主进程 → 主进程 `event.reply`/`webContents.send` 给诊断窗口。用 `reqId` 关联请求与响应（支持并发）。

"实跑"按钮同理走 `diagnostics:run-research`(modelId) → 主进程透传 → 主窗口调 `webviewRefs.get(id).enableDeepResearch()` → 回传 `{success, error?}`。

### 3.2 路由

- `appStore.currentPage` 类型加 `'diagnostics'`（`:372`）
- `App.tsx` hash 监听加 `#diagnostics` → `setCurrentPage('diagnostics')`（`:20` 模式）
- `App.tsx` 渲染分支加 `if (currentPage === 'diagnostics') return <DiagnosticsPage/>`
- 主进程 `openDiagnosticsWindow()`：`loadURL(${ELECTRON_RENDERER_URL}/#diagnostics)`（dev）/ `loadFile(...index.html, { hash: 'diagnostics' })`（build），仿 `:707-710`

### 3.3 双 Tab 页面

新文件 `src/renderer/src/pages/DiagnosticsPage.tsx`：
- Tab 1 messageContainer：从 v1 的 `SelectorDiagnosticsPanel` 抽屉内容迁移为页面内 Tab，调用改为 `window.api.diagnosticsProbe(id, 'message')`
- Tab 2 researchMode：调用 `window.api.diagnosticsProbe(id, 'research')`，渲染每步命中报告；"实跑"按钮调 `window.api.diagnosticsRunResearch(id)`

## 4. 组件拆分

### 4.1 单元 1 — researchMode 探针（纯函数，扩展 selectorDiagnostics.ts）

`src/renderer/src/utils/selectorDiagnostics.ts` 新增：
- `buildResearchProbeScript(steps: AutomationStep[]): string` —— 复刻 `webviewScripts.ts:640-781` 的 `findElement` + `findMenuOpener` 逻辑（同源拷贝，注释行号），但只读不点击。对每个 step 报告：
  ```typescript
  interface StepReport {
    index: number
    selector: string                    // 原始 selector（数组取首项展示）
    found: boolean                      // findElement 是否命中
    matchedVia: 'selector' | 'semantic-fallback' | 'menu-opener-fallback' | null
    firstHit: { tag, className, id, dataTestid, visibleTextLen } | null  // 同 v1 脱敏
    error?: string
  }
  interface ResearchProbeReport { ok: boolean; steps: StepReport[]; error?: string }
  ```
- `parseResearchProbeResult(raw): ResearchProbeReport`
- **同源铁律**：`findElement` 的 selector+text/regex/exclude/wordBoundary/exact/caseSensitive + 语义兜底 + `menuOpenerFallback` 必须与 `webviewScripts.ts:640-781` 一致。

### 4.2 单元 2 — WebviewCardRef 加 probeResearchMode

`src/renderer/src/components/WebviewCard.tsx`：
- `WebviewCardRef` 加 `probeResearchMode: () => Promise<ResearchProbeReport>`
- `useImperativeHandle` 实现：`webview.executeJavaScript(buildResearchProbeScript(selectors.researchMode?.steps ?? []))` → `parseResearchProbeResult`

### 4.3 单元 3 — 主进程窗口 + IPC 透传

`src/main/webviewManager.ts`：
- `let diagnosticsWindow: BrowserWindow | null = null`
- `openDiagnosticsWindow()`：仿 `quickWindow` 创建（独立窗口，不 share webview），`loadURL(.../#diagnostics)`

`src/main/ipcHandlers.ts`：
- `ipcMain.handle('diagnostics:open-window', () => openDiagnosticsWindow())`
- `ipcMain.handle('diagnostics:probe', async (_e, { modelId, type }) => { /* 透传给主窗口 */ })`
- `ipcMain.handle('diagnostics:run-research', async (_e, { modelId }) => { /* 透传 */ })`
- 透传用 `reqId`（主进程生成）+ 主窗口 `webContents.send` request / 监听 response

### 4.4 单元 4 — preload IPC 契约（端到端同步）

- `src/preload/index.ts`：暴露 `diagnosticsOpenWindow()`、`diagnosticsProbe(modelId, type)`、`diagnosticsRunResearch(modelId)`、`onDiagnosticsProbeRequest(cb)`、`onDiagnosticsProbeResponse(cb)` 等
- `src/preload/index.d.ts`：补全类型
- 返回结构统一 `{ success, data?, error? }`（AGENTS.md IPC 约束）

### 4.5 单元 5 — 主窗口 renderer 响应透传请求

`src/renderer/src/` 某处（App 顶层 effect 或 store action）：
- 监听 `onDiagnosticsProbeRequest` → 查 `webviewRefs.get(modelId)` → 调 `probeMessageContainer`/`probeResearchMode` → `diagnosticsProbeResponse(reqId, result)`
- 监听 `onDiagnosticsRunResearchRequest` → `webviewRefs.get(id).enableDeepResearch()` → 回传

### 4.6 单元 6 — SettingsDrawer 入口 + 移除顶栏

- `src/renderer/src/components/SettingsDrawer.tsx`：dev-only "选择器诊断" 按钮 → `window.api.diagnosticsOpenWindow()`
- `src/renderer/src/components/Layout.tsx`：移除 v1 顶栏 🔬 按钮 + isDiagnosticsOpen 状态 + SelectorDiagnosticsPanel 挂载（保留 isDev 常量复用）

### 4.7 单元 7 — DiagnosticsPage + 路由

- `src/renderer/src/pages/DiagnosticsPage.tsx`：双 Tab 页面
- `src/renderer/src/store/appStore.ts`：`currentPage` 加 `'diagnostics'`
- `src/renderer/src/App.tsx`：hash 监听 + 渲染分支

## 5. 错误处理

| 场景 | 处理 |
|---|---|
| 诊断窗口已存在 | `openDiagnosticsWindow` focus 已有窗口而非新建 |
| 主窗口未注册某平台 ref | 透传响应 `{ ok:false, error:'平台未加载' }` |
| 透传超时（主窗口未响应 5s） | 主进程 reqId 超时，回 `{ ok:false, error:'主窗口响应超时' }` |
| findElement 抛错 | 单步 try/catch，该 step 报 error，不拖垮整次探针 |
| "实跑"页面未就绪 | enableDeepResearch 已有 `{success:false, error:'Webview 未就绪'}` 路径，原样回传 |

## 6. 测试（无测试运行器）

`npm run lint` → `npm run build` → `npm run dev` 手动：
1. dev 下 SettingsDrawer 出现"选择器诊断"按钮；build 产物不含（DEV 门控）
2. 点按钮 → 独立诊断窗口弹出，双 Tab 可见
3. 主窗口打开 ChatGPT，发 prompt 等流完 → 诊断窗口 Tab1 点 chatgpt → 报告 visibleTextLen>0 ✅
4. Tab2 点 chatgpt → researchMode.steps 每步报告命中/兜底/失败
5. Tab2 "实跑" → 真实触发 ChatGPT Deep Research 开启（看到菜单弹出/选项被点）
6. 脱敏：Tab1/Tab2 报告无 outerHTML/正文，仅指纹+长度

## 7. 改动文件清单

| 文件 | 类型 | 说明 |
|---|---|---|
| `src/renderer/src/utils/selectorDiagnostics.ts` | 扩展 | 加 researchMode 探针（buildResearchProbeScript/parseResearchProbeResult） |
| `src/renderer/src/components/WebviewCard.tsx` | 小改 | WebviewCardRef 加 probeResearchMode |
| `src/main/webviewManager.ts` | 新增函数 | openDiagnosticsWindow + diagnosticsWindow |
| `src/main/ipcHandlers.ts` | 新增 | diagnostics:open-window/probe/run-research 透传 |
| `src/preload/index.ts` | 新增 | diagnostics* 桥接 |
| `src/preload/index.d.ts` | 新增 | 类型声明 |
| `src/renderer/src/store/appStore.ts` | 小改 | currentPage 加 'diagnostics'；主窗口透传响应 action |
| `src/renderer/src/App.tsx` | 小改 | #diagnostics hash + 渲染分支 |
| `src/renderer/src/pages/DiagnosticsPage.tsx` | 新增 | 双 Tab 页面 |
| `src/renderer/src/components/SettingsDrawer.tsx` | 小改 | dev 入口按钮 |
| `src/renderer/src/components/Layout.tsx` | 小改 | 移除 v1 顶栏入口 + 抽屉挂载 |
| `docs/选择器维护方法论.md` | 更新 | 补 researchMode 闭环 + 独立窗口用法 |

**复用 v1**：`buildProbeScript`/`parseProbeResult`/`probeMessageContainer`/`ProbeReport` 类型不动。

## 8. 风险与缓解

| 风险 | 影响 | 缓解 |
|---|---|---|
| IPC 透传链路长，调试难 | 请求/响应错配 | reqId 关联 + 主进程超时兜底 |
| researchMode 探针与 findElement 漂移 | 探针不可信 | 同源铁律 + 注释行号 |
| 跨窗口并发 probe | 主窗口 renderer 同时被多请求打断 | 单平台串行（主窗口按 modelId 排队）即可，无需复杂并发控制 |
| "实跑"真实点击页面 | 可能误开启 Deep Research 污染用户对话 | 按钮明确标注"将真实点击页面"，建议在新对话页测试 |
| v1 抽屉代码迁移 | 重复/死代码 | 迁移后删除 Layout 里的抽屉挂载，DiagnosticsPage 复用候选表格组件 |

## 9. 成功标准

- [ ] SettingsDrawer dev 入口打开独立诊断窗口
- [ ] 双 Tab：messageContainer + researchMode 都能出报告
- [ ] researchMode 探针四函数与 webviewScripts.ts:640-781 同源
- [ ] "实跑"按钮真实触发 enableDeepResearch
- [ ] 脱敏严格，无正文/outerHTML 泄露
- [ ] production build 不含诊断入口
- [ ] IPC 契约端到端同步（main/preload/index.d.ts/调用点）
