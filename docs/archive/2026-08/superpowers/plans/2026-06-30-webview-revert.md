# Webview Revert Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Revert the recent WebContentsView architecture back to the original `<webview>` tag implementation while keeping Electron 42（当前版本）to preserve audio context bug fixes and其他升级收益。

**Architecture:** Remove `webContentsViewManager.ts` and all related IPC wrappers from main and preload layers. Revert `WebviewCard.tsx`, `Layout.tsx`, and other UI overlays to rely on standard `<webview>` DOM rendering, allowing standard CSS z-index layering to resolve ghost window and overlay issues without screenshot hacks.

**Tech Stack:** Electron 42+, React 18, Zustand, Tailwind CSS.

**迁移来源 Commit:** `29b7fa0` (feat(webview): migrate to WebContentsView architecture (Phase 3)) 及其后续修复 `310e546`, `31ed636`, `a39b4ed`, `da3a9b2`。

> [!IMPORTANT]
> **回退策略核心原则**：仅移除 WebContentsView 相关代码，不触碰与迁移无关的功能（选择器增强 `1301e19`、布局优化 `299f4e9`、网络 Sniffer `updatePlatformAnswer` 等）。对于大文件（如 WebviewCard.tsx），优先使用 `git show 29b7fa0^:<path>` 获取迁移前基准版本作为参考。

---

### Task 0: Electron 42 下 `<webview>` 标签兼容性验证（前置必做）

**目的：** 在动手回退前确认 Electron 42（Chromium ~134）仍支持 `<webview>` 标签且行为与 Electron 28（Chromium 120）一致。

- [ ] **Step 1: 查阅 Electron 官方文档**

使用 Context7 MCP 工具查询 Electron 的 `<webview>` 标签文档：
```
resolve-library-id: "electron"
query-docs: "webview tag" / "webviewTag" / "webview deprecation"
```
重点确认以下信息：
1. `<webview>` 标签在 Electron 42 中是否仍然可用（是否有 deprecation warning）
2. `webviewTag: true` 在 `webPreferences` 中是否仍然是必要的开关
3. `<webview>` 标签的 `partition`、`allowpopups` 等属性是否行为一致
4. `did-attach-webview` 事件是否仍然被触发
5. `<webview>.executeJavaScript()` 方法是否仍然可用

- [ ] **Step 2: 网络搜索补充验证**

搜索以下关键词以补充 Context7 可能遗漏的 breaking change：
- `"Electron 42 webview tag deprecated"`
- `"Electron webview tag breaking changes" site:github.com/electron/electron`
- `"webviewTag" electron changelog`

- [ ] **Step 3: 评估结果与风险决策**

根据查询结果，记录以下结论并报告给用户确认：
- ✅ 完全兼容：继续执行后续 Task
- ⚠️ 有变化但可适配：列出需要的额外改动，更新计划后继续
- ❌ 已废弃/不可用：中止回退计划，改为修复现有 WebContentsView 架构

---

### Task 1: Revert Main Process & Preload API

**Files:**
- Delete: `src/main/webContentsViewManager.ts`
- Modify: `src/main/ipcHandlers.ts`
- Modify: `src/main/webviewManager.ts`
- Modify: `src/preload/index.ts`
- Modify: `src/preload/index.d.ts`

- [ ] **Step 1: Delete `webContentsViewManager.ts`**

Run: `Remove-Item src/main/webContentsViewManager.ts -Force`
Expected: File deleted without errors.

- [ ] **Step 2: Revert `ipcHandlers.ts`**

Open `src/main/ipcHandlers.ts`：
1. 移除顶部的 `import * as viewManager from './webContentsViewManager'`
2. 移除以下全部 WebContentsView IPC handlers（约 930–1267 行区间）：

| IPC Channel | 类型 |
|---|---|
| `webview:create-view` | `handle` |
| `webview:remove-view` | `handle` |
| `webview:show-view` | `handle` |
| `webview:hide-view` | `handle` |
| `webview:focus-view` | `handle` |
| `webview:set-bounds` | `on` (fire-and-forget) |
| `webview:execute-script` | `handle` |
| `webview:load-url` | `handle` |
| `webview:reload` | `handle` |
| `webview:go-back` | `handle` |
| `webview:go-forward` | `handle` |
| `webview:stop` | `handle` |
| `webview:get-url` | `handle` |
| `webview:get-nav-state` | `handle` |
| `webview:clear-history` | `handle` |
| `webview:get-webcontents-id` | `handle` |
| `webview:capture-page` | `handle` |
| `webview:show-model-menu` | `handle` |

> [!NOTE]
> **不要误删非 WebContentsView 的 handler**（如总结链路、历史、自动化等）。操作后搜索确认无残留的 `viewManager.` 引用。

- [ ] **Step 3: Restore `webviewTag: true` in `webviewManager.ts`**

In `src/main/webviewManager.ts`，为 `mainWindow` 和 `quickWindow` 的 `webPreferences` 添加 `webviewTag: true`：
```typescript
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
      webviewTag: true,
      partition: 'persist:shared'
    }
```

同时确认 `did-attach-webview` 事件监听器仍完好存在（mainWindow 约 392 行、quickWindow 约 671 行），它们是 `<webview>` 标签运行时必需的，**不要删除**。

- [ ] **Step 4: Revert `preload/index.ts` and `index.d.ts`**

从两个文件中移除以下全部 18 个 WebContentsView API 定义（声明 + 实现）：

`createWebviewView`, `removeWebviewView`, `showWebviewView`, `hideWebviewView`, `focusWebviewView`, `setWebviewBounds`, `executeWebviewScript`, `loadWebviewURL`, `reloadWebview`, `webviewGoBack`, `webviewGoForward`, `webviewStop`, `getWebviewURL`, `getWebviewNavState`, `clearWebviewHistory`, `getWebviewWebContentsId`, `captureWebviewPage`, `showModelMenu`, `onWebviewEvent`

**保留以下非 WebContentsView API**（迁移前已存在）：
`sendMouseClick`, `dispatchFileDrop`, 及所有总结/历史/配置/自动化相关 API。

---

### Task 2: Revert WebviewCard.tsx

**Files:**
- Modify: `src/renderer/src/components/WebviewCard.tsx`

> [!IMPORTANT]
> 这是最复杂的回退步骤。当前文件有 1015 行，迁移引入了大量改动。建议先用 `git show 29b7fa0^:src/renderer/src/components/WebviewCard.tsx` 获取迁移前基准版本，与当前版本 diff 对比后操作。

- [ ] **Step 1: Replace host `div` with `<webview>` tag**

将 JSX 中的 host `<div ref={hostRef} data-mm-view-id={viewId}>` 替换回 `<webview>` 标签：
```tsx
          {/* 
            partition: 使用共享的 partition 名称，让所有 webview 共享 cookie 和 session
            - 在一个窗口中登录 Google 账户后，其他窗口也能自动使用已登录状态
            - persist: 前缀确保 session 持久化，关闭应用再打开不需要重新登录
            注意：需要 allowpopups 以便 setWindowOpenHandler 能够拦截弹窗请求
            实际的弹窗控制由主进程的 setWindowOpenHandler 处理
          */}
          <webview
            ref={webviewRef as React.RefObject<Electron.WebviewTag>}
            id={`webview-${id}`}
            src="about:blank"
            partition="persist:shared"
            className={`w-full h-full ${loadError ? 'invisible pointer-events-none' : ''}`}
            allowpopups
            tabIndex={-1}
          />
```

- [ ] **Step 2: Revert IPC calls to direct DOM method calls**

逐项还原：
1. **移除 `viewId` 状态** — 删除 `useState<string | null>(null)` 和所有 `viewId` 引用
2. **移除生命周期中的 `createWebviewView` / `removeWebviewView`** — 替换为 `webviewRef.current.loadURL(url)` 直接加载
3. **移除 `ResizeObserver` + `requestAnimationFrame` bounds 同步** — `<webview>` 标签自动跟随 CSS 布局，无需手动同步位置
4. **移除 `window.api.onWebviewEvent()` 事件订阅** — 替换为直接 DOM 事件监听：
   ```tsx
   webviewRef.current.addEventListener('dom-ready', handler)
   webviewRef.current.addEventListener('did-start-loading', handler)
   webviewRef.current.addEventListener('did-stop-loading', handler)
   webviewRef.current.addEventListener('did-fail-load', handler)
   webviewRef.current.addEventListener('did-navigate', handler)
   // ... etc
   ```
5. **还原 `useImperativeHandle` 中的方法调用**：
   - `window.api.executeWebviewScript(viewId, code)` → `webviewRef.current.executeJavaScript(code)`
   - `window.api.loadWebviewURL(viewId, url)` → `webviewRef.current.loadURL(url)`
   - `window.api.webviewGoBack(viewId)` → `webviewRef.current.goBack()`
   - `window.api.webviewGoForward(viewId)` → `webviewRef.current.goForward()`
   - `window.api.webviewStop(viewId)` → `webviewRef.current.stop()`
   - `window.api.getWebviewURL(viewId)` → `webviewRef.current.getURL()`
   - `window.api.getWebviewNavState(viewId)` → `{ canGoBack: webviewRef.current.canGoBack(), canGoForward: webviewRef.current.canGoForward() }`
   - `window.api.clearWebviewHistory(viewId)` → `webviewRef.current.clearHistory()`
   - `window.api.getWebviewWebContentsId(viewId)` → `webviewRef.current.getWebContentsId()`

- [ ] **Step 3: 移除截图 overlay workaround**

删除以下 WebContentsView 专属的截图逻辑：
1. `overlayActive` / `screenshotDataUrl` state（约 137 行）
2. `leftOverlayOpen` / `rightOverlayOpen` / `modalOpen` 读取（约 140–142 行）
3. `needsOverlay` 计算和 `captureWebviewPage` 截图逻辑（约 161–190 行）
4. `shouldHideWebview` 中的 `overlayActive` 条件（约 192 行）
5. 截图背景 overlay `<div>` 渲染（约 953–957 行）

> [!NOTE]
> `isDropdownOpen` state 和 `CustomDropdown` 的 `onOpenChange` 回调也是迁移期间引入的（用于触发截图），回退后可以保留（不影响功能），但如果追求极致干净也可以移除。

---

### Task 3: Revert Gemini Canvas Extractor and Layout

**Files:**
- Modify: `src/renderer/src/utils/geminiCanvasExtractor.ts`
- Modify: `src/renderer/src/components/Layout.tsx`

> [!WARNING]
> `geminiCanvasExtractor.ts` 当前处于**半坏状态**：迁移只改了部分函数的参数签名和调用方式，但 `findAndClickCopyButton()` 仍使用已删除的 `WebviewAPI` 类型，`waitForCopyToast()` 参数签名改为 `viewId: string` 但函数体仍调用 `webview.executeJavaScript()`（编译会报错）。

- [ ] **Step 1: 恢复 `WebviewAPI` interface**

在文件顶部（约 35 行位置）恢复迁移前删除的接口定义：
```typescript
interface WebviewAPI {
  executeJavaScript: (script: string) => Promise<any>
  getWebContentsId: () => number
}
```

- [ ] **Step 2: 逐函数还原调用方式**

| 函数 | 当前状态 | 回退操作 |
|---|---|---|
| `checkCanvasMode()` | 参数 `viewId: string`，用 `window.api.executeWebviewScript(viewId, ...)` | 改回 `webview: WebviewAPI`，用 `webview.executeJavaScript(...)` |
| `findAndClickCopyButton()` | 参数仍为 `webview: WebviewAPI`（但类型已被删除）| 恢复 interface 后自动修复 |
| `waitForCopyToast()` | 参数改为 `viewId: string`，但函数体仍用 `webview.executeJavaScript()` ❌ | 参数改回 `webview: WebviewAPI`，函数体已正确 |
| `extractReferenceLinks()` | 参数 `viewId: string`，用 `window.api.executeWebviewScript(viewId, ...)` | 改回 `webview: WebviewAPI`，用 `webview.executeJavaScript(...)` |
| `extractGeminiCanvasContent()` | 参数 `viewId: string`，内部用 `window.api.getWebviewWebContentsId(viewId)` | 改回 `webview: WebviewAPI`，用 `webview.getWebContentsId()` |

- [ ] **Step 3: 更新调用方**

检索 `extractGeminiCanvasContent` 的调用方（位于 `WebviewCard.tsx` 的 `useImperativeHandle` 中），确保传入的参数从 `viewId` 改回 webview ref 对象。

- [ ] **Step 4: Revert Layout Menu Webview detection**

In `Layout.tsx`，将 `target.closest('[data-mm-view-id]')` 回退为：
```tsx
const webviewElement = target.closest('webview');
```

---

### Task 4: Revert UI Overlays and Hacks

**Files:**
- Modify: `src/renderer/src/components/ConfirmModal.tsx`
- Modify: `src/renderer/src/components/RenameModal.tsx`
- Modify: `src/renderer/src/components/HistoryDrawer.tsx`
- Modify: `src/renderer/src/components/SettingsDrawer.tsx`
- Modify: `src/renderer/src/components/SummaryHistoryDrawer.tsx`
- Modify: `src/renderer/src/components/ControlBar.tsx`
- Modify: `src/renderer/src/store/appStore.ts`
- Modify: `src/renderer/src/assets/index.css`

- [ ] **Step 1: 移除各组件中的 Overlay 状态同步**

以下 5 个组件在迁移中各加了一个 `useEffect` 来同步 overlay 状态到 appStore，全部移除：

| 组件 | 移除内容 |
|---|---|
| `ConfirmModal.tsx` | 移除 `useEffect`（setModalOpen true/false）、移除 `useAppStore` 和 `useEffect` import |
| `RenameModal.tsx` | 移除 `useEffect`（setModalOpen true/false）、移除 `useAppStore` import |
| `HistoryDrawer.tsx` | 移除 `useEffect`（setLeftOverlayOpen true/false）、从 `useAppStore` 解构中移除 `setLeftOverlayOpen`、移除多余的 `useEffect` import |
| `SettingsDrawer.tsx` | 移除 `useEffect`（setLeftOverlayOpen true/false）、从 `useAppStore` 解构中移除 `setLeftOverlayOpen` |
| `SummaryHistoryDrawer.tsx` | 移除 `useEffect`（setRightOverlayOpen true/false）、从 `useAppStore` 解构中移除 `setRightOverlayOpen`、移除多余的 `useEffect` import |

- [ ] **Step 2: 移除 `ControlBar.tsx` 的 `createPortal` hack**

迁移中 `ControlBar.tsx` 的通知弹窗从 `absolute` 定位被改为 `createPortal(... , document.body)` + `fixed` 定位（为了穿透 WebContentsView 层级）。回退操作：

1. 移除 `import { createPortal } from 'react-dom'`
2. 将通知弹窗的 JSX 从 `createPortal(<div className="fixed top-12 ...">...</div>, document.body)` 还原为原始的 `<div className="absolute bottom-full left-1/2 transform -translate-x-1/2 mb-3 ...">...</div>`
3. 移除 `z-[9999]`，恢复为 `z-50`

- [ ] **Step 3: 清理 appStore overlay 状态**

从 `src/renderer/src/store/appStore.ts` 中移除以下 6 个 state/setter（约 253–258 行声明、777–782 行实现）：

```diff
- // 细粒度的覆盖层开启状态，用于实现局部 Webview 隐藏，提升交互体验
- leftOverlayOpen: boolean
- setLeftOverlayOpen: (open: boolean) => void
- rightOverlayOpen: boolean
- setRightOverlayOpen: (open: boolean) => void
- modalOpen: boolean
- setModalOpen: (open: boolean) => void
```

> [!NOTE]
> 移除前请再次 grep `leftOverlayOpen|rightOverlayOpen|modalOpen` 全量搜索确认无其他消费者。已验证的完整消费者清单：WebviewCard.tsx（读取）、ConfirmModal.tsx、RenameModal.tsx、HistoryDrawer.tsx、SettingsDrawer.tsx、SummaryHistoryDrawer.tsx（写入）——全部在此 Task 中处理。

- [ ] **Step 4: 恢复 index.css 中的 webview 样式规则**

迁移中从 `index.css` **删除**了 `<webview>` 标签的基础样式。回退需要**恢复**这些规则（注意：是恢复，不是删除 hack）：

```css
/* Webview 样式 */
webview {
  width: 100%;
  height: 100%;
  border: none;
  /* 防止 webview 拦截键盘焦点 */
  outline: none;
  /* 禁用 webview 的焦点 */
  pointer-events: auto;
}

/* 防止 webview 获得输入法焦点 */
webview[tabindex="-1"] {
  /* webview 不应该获得键盘焦点 */
  -webkit-user-select: none;
  user-select: none;
}
```

- [ ] **Step 5: 处理 CustomDropdown 的 `onOpenChange` 回调**

迁移中 `CustomDropdown.tsx` 新增了 `onOpenChange` prop 和 `resize` 事件关闭逻辑。这两个改动属于合理增强，回退后保留不影响功能。**不需要修改此文件**。

---

### Task 5: 清理迁移残留文件

**Files:**
- Delete: `refactor_extractor.py`（47 行，迁移辅助脚本）
- Delete: `refactor_webview.py`（611 行，迁移辅助脚本）
- Delete: `test-corners.js`（16 行，圆角测试脚本）

- [ ] **Step 1: 删除迁移辅助文件**

```powershell
Remove-Item refactor_extractor.py, refactor_webview.py, test-corners.js -Force
```

这些文件由迁移 commit `29b7fa0` 引入，是一次性使用的自动化脚本，回退后不再有任何用途。

---

### Task 6: 验证与回归测试

- [ ] **Step 1: 静态检查**

```powershell
npm run lint
npm run build
```

确认零 TypeScript 编译错误和零 ESLint 错误。重点关注：
- `webContentsViewManager` 的残留引用（应为零）
- `WebviewAPI` interface 的类型完整性
- `window.api.executeWebviewScript` 等已删除 API 的残留调用（应为零）

- [ ] **Step 2: 运行时验证**

```powershell
npm run dev
```

手动验证以下场景：

| # | 验证场景 | 预期行为 |
|---|---|---|
| 1 | 主窗口多模型加载 | 所有 webview 正确加载 AI 平台页面 |
| 2 | 打开设置/历史 Drawer | Drawer 自然覆盖在 webview 上方，无穿透 |
| 3 | 打开 ConfirmModal / RenameModal | Modal 自然覆盖在 webview 上方 |
| 4 | 切换布局（单列/双列/四宫格） | 无 ghost window 残留 |
| 5 | 统一发送消息 | 所有 webview 正确注入并提交 |
| 6 | 快捷窗口（QuickWindow） | WebviewCard 正常渲染和交互 |
| 7 | ControlBar 通知弹窗 | 正确显示在输入框上方 |
| 8 | Gemini Canvas 提取（如可测试） | 导出/复制流程正常 |
| 9 | `did-attach-webview` 事件 | 检查控制台应有 `[Main] did-attach-webview 触发` 日志 |
| 10 | 右键菜单 | webview 内右键走主进程 themed-contextmenu，非 webview 区域走渲染进程菜单 |

- [ ] **Step 3: 确认无残留**

全量搜索以下关键词确认零残留：
```powershell
Select-String -Path src/**/*.ts,src/**/*.tsx -Pattern "webContentsViewManager|viewManager\.|data-mm-view-id|captureWebviewPage|createWebviewView|removeWebviewView|setWebviewBounds|showWebviewView|hideWebviewView|focusWebviewView|onWebviewEvent" -List
```
