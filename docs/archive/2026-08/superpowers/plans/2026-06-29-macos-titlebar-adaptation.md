> Created: 2026-06-29 12:41 (+08:00)

# macOS Title Bar Adaptation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 适配 macOS 原生无边框窗口“红绿灯”控制按钮，解决主窗口标题栏 UI 与控制按钮重叠冲突问题，同时保持 Windows 系统原有样式不变。

**Architecture:** 通过 Preload 安全桥接向渲染进程暴露 `process.platform` 标识；主进程针对 macOS 设定 `trafficLightPosition` 进行坐标微调；渲染层 `Layout.tsx` 根据平台标识为左侧导航区动态注入 `pl-[75px]` 安全边距。

**Tech Stack:** TypeScript, Electron 28 (IPC & BrowserWindow), React 18, Tailwind CSS 3.

---

## 视觉 UI 架构方案 (UI Layout Design)

### ❌ 未适配前 (macOS 冲突态)
在 macOS 系统中，`titleBarStyle: 'hidden'` 会将系统控制按钮（红绿灯）放置在顶部最左侧。如果前端直接贴边布局，会导致严重的 UI 覆盖：
```
+-----------------------------------------------------------------------------------+
| (🔴)(🟡)(🟢) [Logo] [多AI | 任务分配 | 辩论]               [反馈] [设置] [－][口][✕] |
|  ↑ 红绿灯直接覆盖/重叠了 Logo 和模式切换按钮！                                    |
+-----------------------------------------------------------------------------------+
```

### ✅ 适配后 (macOS 完美适配态)
主进程微调红绿灯垂直居中（`y: 10`），前端检测到 `darwin` 平台自动增加 `75px` 左安全边距：
```
+-----------------------------------------------------------------------------------+
| (🔴)(🟡)(🟢)   <-- 75px 安全间距 -->   [Logo] [多AI | 任务分配 | 辩论]   [反馈] [设置] |
| ↑ 红绿灯 (x:16, y:10)                  ↑ 往右平移避开红绿灯，保持布局干净整洁     |
+-----------------------------------------------------------------------------------+
```

### 💻 Windows 系统 (对照态 - 保持原样 100% 一致)
Windows 下 `process.platform !== 'darwin'`，不添加额外内边距，右上角由 `titleBarOverlay` (WCO) 承载系统按钮：
```
+-----------------------------------------------------------------------------------+
| [Logo] [多AI | 任务分配 | 辩论]                                [反馈] [设置] [－][口][✕] |
| ↑ 最左侧紧贴内边距，右上角由 WCO 提供原生控制按钮                                 |
+-----------------------------------------------------------------------------------+
```

---

## Task 1: 在 Preload 安全桥接层暴露平台标识

**Files:**
- Modify: `src/preload/index.d.ts:25-35`
- Modify: `src/preload/index.ts:18-25`

- [ ] **Step 1: 修改类型定义 `src/preload/index.d.ts`**

在 `api` 接口中添加 `platform: string` 属性定义：

```typescript
declare global {
  interface Window {
    electron: ElectronAPI
    api: {
      // 系统平台标识
      platform: string
      minimizeWindow: () => void
      maximizeWindow: () => void
      closeWindow: () => void
```

- [ ] **Step 2: 在 `src/preload/index.ts` 中实现暴露**

将 `process.platform` 挂载到暴露给渲染层的 `api` 对象中：

```typescript
// 自定义 API
const api = {
  // 系统平台标识
  platform: process.platform,

  // 窗口控制
  minimizeWindow: (): void => ipcRenderer.send('window-minimize'),
  maximizeWindow: (): void => ipcRenderer.send('window-maximize'),
  closeWindow: (): void => ipcRenderer.send('window-close'),
```

- [ ] **Step 3: 运行类型与构建校验**

Run: `npm run lint && npm run build`
Expected: 编译与代码检查通过无报错。

- [ ] **Step 4: 提交代码**

```bash
git add src/preload/index.d.ts src/preload/index.ts
git commit -m "feat(preload): expose process.platform to renderer API for OS-specific UI adjustments"
```

---

## Task 2: 配置主进程窗口红绿灯坐标

**Files:**
- Modify: `src/main/webviewManager.ts:322-346`

- [ ] **Step 1: 为 `mainWindow` 添加 `trafficLightPosition` 配置**

修改 `src/main/webviewManager.ts` 中的 `createWindow` 方法，加上红绿灯位置配置：

```typescript
    mainWindow = new BrowserWindow({
        width: 1400,
        height: 900,
        minWidth: 900,
        minHeight: 600,
        show: true,
        autoHideMenuBar: true,
        frame: false,
        titleBarStyle: 'hidden',
        trafficLightPosition: { x: 16, y: 10 },
        titleBarOverlay: {
            color: '#EBF4FF',
            symbolColor: '#333333',
            height: 38
        },
        backgroundColor: 'rgba(0,0,0,0)',
        icon: getWindowIcon(),
```

- [ ] **Step 2: 运行类型与构建校验**

Run: `npm run lint && npm run build`
Expected: 构建成功输出到 `out/` 目录。

- [ ] **Step 3: 提交代码**

```bash
git add src/main/webviewManager.ts
git commit -m "feat(main): configure trafficLightPosition for macOS main window"
```

---

## Task 3: 适配前端主标题栏 UI 布局

**Files:**
- Modify: `src/renderer/src/components/Layout.tsx:335-342`

- [ ] **Step 1: 修改 `src/renderer/src/components/Layout.tsx` 动态添加内边距**

找到第 `337` 行附近的左侧容器，动态检测 `window.api?.platform === 'darwin'` 并添加 `pl-[75px]`：

```tsx
      >
        <div className={`flex items-center gap-3 select-none drag-region h-full ${window.api?.platform === 'darwin' ? 'pl-[75px]' : ''}`}>
          <div className="flex items-center gap-3 drag-region">
            <img src="./assets/logo.png" alt="logo" className="w-4 h-4 opacity-80" onError={(e) => e.currentTarget.style.display = 'none'} />
```

- [ ] **Step 2: 运行构建与检查**

Run: `npm run lint && npm run build`
Expected: 检查与构建完全通过。

- [ ] **Step 3: 手动验证**

Run: `npm run dev`
Expected: 启动应用桌面窗口，验证在 Windows 下界面左侧无多余空白，样式保持原有对齐；相关拖拽和模式切换点击正常。

- [ ] **Step 4: 提交代码**

```bash
git add src/renderer/src/components/Layout.tsx
git commit -m "feat(renderer): add macOS traffic lights safe area padding to Layout header"
```
