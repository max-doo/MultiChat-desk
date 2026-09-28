> Created: 2026-09-28 18:07 (+08:00)

# Quick Window Mindmap (Mubu) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在桌面端快捷窗口（Quick Window）顶部操作栏添加思维导图按钮，复用现有侧边栏并在 Webview 中加载幕布（`https://mubu.com/app`），同时实现关闭 30 秒后自动休眠/销毁的统一资源管理逻辑。

**Architecture:** 在 `QuickPage.tsx` 中引入双模式侧边栏状态（`'model' | 'mindmap'`），复用现有的宽度调整手柄与窗口扩展 IPC 链路。通过 `WebviewCard` 配合 `hideHeader` 渲染幕布容器并共享持久化 session，同时扩展侧边栏休眠调度器，确保副模型与思维导图在切走或关闭 30 秒后自动调用 `suspend()` 释放内存并在重新打开时 `resume()` 唤醒。

**Tech Stack:** React 18, TypeScript, Electron 42, Tailwind CSS, Material Symbols.

---

### Task 1: 扩展侧边栏状态与统一 30 秒休眠/唤醒调度逻辑

**Files:**
- Modify: `src/renderer/src/pages/QuickPage.tsx`

- [ ] **Step 1: 在 `QuickPage.tsx` 中定义侧边栏模式类型与状态变量**
引入 `sidebarMode`（`'model' | 'mindmap'`）、`sidebarModeRef`、`isMindmapMounted`、`mindmapRef` 以及常量 `MINDMAP_SIDEBAR_ID = '__mindmap__'`:
```tsx
type SidebarMode = 'model' | 'mindmap'
const MINDMAP_SIDEBAR_ID = '__mindmap__'

const [sidebarMode, setSidebarMode] = useState<SidebarMode>('model')
const sidebarModeRef = useRef<SidebarMode>('model')
const [isMindmapMounted, setIsMindmapMounted] = useState(false)
const mindmapRef = useRef<WebviewCardRef | null>(null)
```

- [ ] **Step 2: 升级 `scheduleSidebarHibernate` 与 `openSidebar` / `openMindmapSidebar`**
将 `scheduleSidebarHibernate` 统一扩展为支持传入 `MINDMAP_SIDEBAR_ID`：
- 若为 `MINDMAP_SIDEBAR_ID`：检查如果 `quickVisibleRef.current && sidebarOpenRef.current && sidebarModeRef.current === 'mindmap'` 则放弃休眠；否则调用 `mindmapRef.current?.suspend()`；
- 新增 `openMindmapSidebar` 函数：唤醒处于休眠的幕布并展开侧边栏；
- 在 `closeSidebar`、`onQuickHidden`、`onQuickShown` 及 `onQuickAskSidebar` 中适配当前是 `model` 还是 `mindmap` 的休眠/唤醒分支。

- [ ] **Step 3: 添加思维导图与副模型的切换函数**
定义 `toggleMindmapSidebar` 与 `toggleModelSidebar`：
- `toggleMindmapSidebar`：若侧边栏打开且处于 `mindmap`，调用 `closeSidebar()`；若处于 `model`，调度副模型 30s 休眠并切换为 `mindmap`；若未打开，设置 `mindmap` 并展开。
- `toggleModelSidebar`：若侧边栏打开且处于 `model`，调用 `closeSidebar()`；若处于 `mindmap`，调度思维导图 30s 休眠并切换为 `model`；若未打开，设置 `model` 并展开。

---

### Task 2: 顶部操作栏新增思维导图按钮与侧边栏幕布卡片渲染

**Files:**
- Modify: `src/renderer/src/pages/QuickPage.tsx`

- [ ] **Step 1: 在主卡片的 `headerActions` 中添加思维导图按钮**
在“主界面”按钮与原侧边栏按钮之间添加思维导图按钮：
```tsx
<button
  type="button"
  onClick={toggleMindmapSidebar}
  className={`w-7 h-7 flex items-center justify-center rounded-full transition-all duration-200 ${
    sidebarOpen && sidebarMode === 'mindmap'
      ? 'text-primary bg-blue-50 hover:bg-blue-100'
      : 'text-text-secondary hover:text-text-primary hover:bg-gray-100'
  }`}
  title="思维导图"
  aria-label="思维导图"
>
  <span className="material-symbols-outlined text-base">account_tree</span>
</button>
```
同时调整原侧边栏按钮的点击事件为 `toggleModelSidebar`，高亮条件为 `sidebarOpen && sidebarMode === 'model'`。

- [ ] **Step 2: 在侧边栏容器中渲染思维导图视图**
侧边栏容器挂载条件调整为 `(mountedSidebarModels.size > 0 || isMindmapMounted)`。
在副模型容器旁，条件渲染思维导图：
- 专属头部：标题“思维导图 (幕布)”、刷新按钮（`mindmapRef.current?.reload()`）、收起按钮（`closeSidebar()`）；
- 嵌入 `WebviewCard`：`id="quick-sidebar-mindmap-card"`，`url="https://mubu.com/app"`，`hideHeader={true}`，`webviewInstanceId="quick-sidebar-mindmap"`，`ref={ref => { mindmapRef.current = ref }}`。

---

### Task 3: 构建、类型校验与验证

**Files:**
- Test / Verification:
  - 运行 `npm run lint` 验证 ESLint 与类型约束
  - 运行 `npm run build` 验证打包无编译报错

- [ ] **Step 1: 运行 Lint 检查**
Run: `npm run lint`
Expected: 检查通过，无语法与类型错误。

- [ ] **Step 2: 运行前端构建**
Run: `npm run build`
Expected: 成功构建 main、preload 与 renderer，无打包错误。

- [ ] **Step 3: 运行并提交更改**
使用 `git commit` 保存变更。
