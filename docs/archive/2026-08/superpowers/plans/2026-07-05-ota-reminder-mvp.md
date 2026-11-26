# 更新提醒 OTA MVP（纯提醒版）实施计划

> Created: 2026-07-05 12:35 (UTC+08:00)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 Settings Drawer 现有「使用说明」区块下方挂载更新检查 UI；用户点击「检查更新」后主进程查询 GitHub Releases 最新版本并与本地版本对比，发现新版本即提示并提供跳转下载外链，不做自动下载/安装。

**Architecture:** 主进程新增 `src/main/updater/checker.ts`，封装一次 `fetch` GitHub Releases API + semver 数值比较，返回结构化 `UpdateCheckResult`。通过单条 IPC invoke 通道 `update:check` 暴露给渲染端。渲染端新增 `AboutSection.tsx` 组件，本地 `useState` 管理检查状态（不进 Zustand），挂在 SettingsDrawer 现有「使用说明」区块下方，复用 `window.api.openBrowserWindow` 跳转外链、复用 `react-markdown` 渲染 release notes。

**Tech Stack:** Electron 42, React 18, TypeScript (strict), electron-vite, Tailwind CSS 3（项目自定义类 `glass-panel` / `text-text-primary` / `text-primary`），react-markdown + remark-gfm（已存在依赖）

## Global Constraints

- **不引入新依赖**：`react-markdown`、`remark-gfm`、`openBrowserWindow` IPC、`app.getVersion()` 均已就位，禁止新增 npm 包。
- **不改打包配置**：不修改 `electron-builder.yml` / `electron-builder-portable.yml`，不新增 `publish` 字段。
- **全平台一致行为**：NSIS / 便携 / macOS 均只提醒+跳转，不涉及安装/签名，无需 `isPortableMode()` 分支。
- **IPC 契约约束**：新增 IPC 必须同步 `src/main/ipcHandlers.ts` + `src/preload/index.ts` + `src/preload/index.d.ts`，返回结构统一 `{ success, data?, error? }`。
- **分层约束**：fetch/比较逻辑在 main；preload 仅桥接；renderer 仅 UI + 调用。`checker.ts` 不依赖 Electron 渲染 API。
- **GitHub API**：未认证限流 60 次/小时/IP；仅用户手动点击触发，无启动自动检查、无轮询。
- **版本号格式**：仅支持 `vX.Y.Z` / `X.Y.Z` 三段；pre-release（如 `1.2.0-beta`）按格式异常处理，判 `hasUpdate: false`。
- **风格对齐**：UI 复用项目自定义 Tailwind 类（`glass-panel` / `text-text-primary` / `text-text-secondary` / `text-primary`），匹配 SettingsDrawer 既有「使用说明」区块样式，不引入 `bg-gray-800` 等通用类。
- **使用说明外链**：SettingsDrawer 现有「使用说明」区块指向飞书文档 `https://ai.feishu.cn/docx/TiLFdnaPjo7ZnQx7J5JcFMLInsd`，保持不动；本计划**不替换**该链接，仅在区块内新增「检查更新」入口与结果展示。

---

## 文件结构

| 文件 | 类型 | 职责 |
|---|---|---|
| `src/main/updater/checker.ts` | 新增 | `checkForUpdate()`：fetch GitHub Releases API + semver 比较 + 结构化返回 |
| `src/main/ipcHandlers.ts` | 修改 | 注册 `update:check` handler（插入到 `registerIpcHandlers` 函数末尾，`automation:collect` 之后、闭合 `}` 之前） |
| `src/preload/index.ts` | 修改 | 在 `api` 对象内 `openBrowserWindow` 之后新增 `updateCheck` |
| `src/preload/index.d.ts` | 修改 | 新增 `UpdateCheckResult` 接口 + `window.api.updateCheck` 声明 |
| `src/renderer/src/components/AboutSection.tsx` | 新增 | 「检查更新」UI：当前版本 + 检查按钮 + 结果展示 + release notes 折叠 |
| `src/renderer/src/components/SettingsDrawer.tsx` | 修改 | 在「使用说明」区块（line 1381-1406）的 `glass-panel` div 内、`</a>` 之后挂载 `<AboutSection />` |

无 Zustand slice、无全局 hook、无状态订阅——一次性请求/响应，组件本地 `useState` 管理。

---

## Spec 与代码事实的对齐说明

实施前复审发现 spec 有两处假设与真实代码不符，本计划以**代码事实**为准（AGENTS.md：「规则与代码冲突时以代码事实为准」）：

1. **使用说明链接**：spec 写「跳 GitHub README」，实际 SettingsDrawer:1389 已用飞书文档链接。本计划不动该链接，仅在区块内追加更新检查入口。
2. **UI 样式类**：spec 草图用 `bg-gray-800/border-gray-700`，实际项目用 `glass-panel` / `text-text-primary` 等自定义类。本计划 UI 全部对齐既有样式。

这两点不改变架构、IPC 契约、数据流，仅影响渲染层样式与现有区块的整合方式。

---

### Task 1: 主进程 checker 模块

**Files:**
- Create: `src/main/updater/checker.ts`

**Interfaces:**
- Consumes: `app.getVersion()`（Electron 内置）、全局 `fetch`（Node 18+ 内置，Electron 42 主进程可用）
- Produces: `checkForUpdate()` 函数与 `UpdateCheckResult` 接口，供 Task 2 IPC handler 调用

- [ ] **Step 1: 创建 `src/main/updater/checker.ts`**

```typescript
import { app } from 'electron'

/**
 * 更新检查结果（纯提醒版：仅检测与提示，不下载不安装）
 */
export interface UpdateCheckResult {
  hasUpdate: boolean
  currentVersion: string   // 去 v 前缀，如 "1.1.0"
  latestVersion: string    // 去 v 前缀，如 "1.2.0"
  releaseUrl: string       // GitHub Release HTML 页面 URL
  releaseNotes?: string    // Release body（markdown 原文），可能为空
}

const GITHUB_API_URL = 'https://api.github.com/repos/max-doo/multichat/releases/latest'
const REQUEST_TIMEOUT_MS = 10000

/**
 * 去除版本号 v 前缀。仅支持 vX.Y.Z / X.Y.Z 三段格式。
 * 返回 null 表示格式异常。
 */
function normalizeVersion(raw: string): string | null {
  const cleaned = raw.trim().replace(/^v/i, '')
  const parts = cleaned.split('.')
  if (parts.length !== 3) return null
  for (const p of parts) {
    if (!/^\d+$/.test(p)) return null
  }
  return cleaned
}

/**
 * 三段 semver 数值比较。
 * 前提：current 与 latest 均已 normalize 通过（非 null）。
 * 返回 true 表示 latest 严格大于 current。
 */
function isLaterVersion(current: string, latest: string): boolean {
  const c = current.split('.').map(Number)
  const l = latest.split('.').map(Number)
  for (let i = 0; i < 3; i++) {
    if (l[i] > c[i]) return true
    if (l[i] < c[i]) return false
  }
  return false
}

/**
 * 查询 GitHub Releases 最新版本并与本地版本对比。
 * 网络/HTTP/解析错误统一封装为 { success: false, error }，不抛出。
 */
export async function checkForUpdate(): Promise<{
  success: boolean
  data?: UpdateCheckResult
  error?: string
}> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)

  try {
    const response = await fetch(GITHUB_API_URL, {
      headers: { 'User-Agent': 'MultiChat-Desk' },
      signal: controller.signal
    })

    if (response.status === 403) {
      return { success: false, error: '更新服务繁忙，请稍后再试' }
    }
    if (!response.ok) {
      return { success: false, error: '暂时无法获取更新信息' }
    }

    const json = (await response.json()) as {
      tag_name?: string
      html_url?: string
      body?: string
    }

    const tagName = json.tag_name
    const htmlUrl = json.html_url
    if (typeof tagName !== 'string' || typeof htmlUrl !== 'string') {
      return { success: false, error: '暂时无法获取更新信息' }
    }

    const currentVersion = normalizeVersion(app.getVersion())
    const latestVersion = normalizeVersion(tagName)
    if (currentVersion === null || latestVersion === null) {
      return { success: false, error: '暂时无法获取更新信息' }
    }

    return {
      success: true,
      data: {
        hasUpdate: isLaterVersion(currentVersion, latestVersion),
        currentVersion,
        latestVersion,
        releaseUrl: htmlUrl,
        releaseNotes: typeof json.body === 'string' && json.body.trim() ? json.body : undefined
      }
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    // AbortController 触发或网络层错误均归为网络提示
    if (message.includes('aborted') || message.includes('fetch')) {
      return { success: false, error: '检查失败，请检查网络后重试' }
    }
    return { success: false, error: '检查失败，请检查网络后重试' }
  } finally {
    clearTimeout(timer)
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add src/main/updater/checker.ts
git commit -m "feat(updater): add pure-reminder update checker module

Queries GitHub Releases latest, compares semver, returns structured
UpdateCheckResult. No electron-updater, no auto-download.

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 2: IPC handler

**Files:**
- Modify: `src/main/ipcHandlers.ts`（顶部 import 区 + `registerIpcHandlers` 函数末尾，line 1236 `automation:collect` handler 之后、line 1238 闭合 `}` 之前）

**Interfaces:**
- Consumes: `checkForUpdate` from `./updater/checker`（Task 1 产出）
- Produces: IPC 通道 `update:check`（R→M invoke），返回 `{ success, data?, error? }`

- [ ] **Step 1: 导入 checker 模块**

在 `src/main/ipcHandlers.ts` 顶部现有 import 之后（line 29 `import { automationService }` 之后、line 31 注释之前）添加：

```typescript
import { checkForUpdate } from './updater/checker'
```

- [ ] **Step 2: 在 `registerIpcHandlers` 函数末尾注册 handler**

找到 line 1236 `automation:collect` handler 的闭合 `})`，在其之后、line 1238 函数闭合 `}` 之前添加：

```typescript

    // ============ 更新检查 IPC（纯提醒版） ============
    ipcMain.handle('update:check', async () => {
        try {
            return await checkForUpdate()
        } catch (err: unknown) {
            const error = err instanceof Error ? err.message : String(err)
            return { success: false, error }
        }
    })
```

- [ ] **Step 3: Commit**

```bash
git add src/main/ipcHandlers.ts
git commit -m "feat(ipc): register update:check handler

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 3: Preload 桥接

**Files:**
- Modify: `src/preload/index.d.ts`（新增 `UpdateCheckResult` 接口 + `window.api.updateCheck` 声明）
- Modify: `src/preload/index.ts`（`api` 对象内 `openBrowserWindow` 之后新增 `updateCheck`）

**Interfaces:**
- Consumes: IPC 通道 `update:check`（Task 2 产出）
- Produces: `window.api.updateCheck()` 类型化方法，供 Task 4 组件调用

- [ ] **Step 1: 在 `src/preload/index.d.ts` 添加类型声明**

在 `GetFileInfoResult` 接口（line 11 起）之后、`declare global`（line 52）之前，添加 `UpdateCheckResult` 接口：

```typescript
/** 更新检查结果（纯提醒版：仅检测与提示，不下载不安装） */
interface UpdateCheckResult {
  hasUpdate: boolean
  currentVersion: string
  latestVersion: string
  releaseUrl: string
  releaseNotes?: string
}
```

然后在 `window.api` 接口内、`openBrowserWindow`（line 151）之后添加：

```typescript
      // 更新检查（纯提醒版）
      updateCheck: () => Promise<{ success: boolean; data?: UpdateCheckResult; error?: string }>
```

- [ ] **Step 2: 在 `src/preload/index.ts` 暴露 API**

在 `api` 对象内、`openBrowserWindow`（line 226）之后添加：

```typescript
  // 更新检查（纯提醒版）
  updateCheck: (): Promise<{ success: boolean; data?: UpdateCheckResult; error?: string }> =>
    ipcRenderer.invoke('update:check'),
```

- [ ] **Step 3: 类型与构建检查**

```bash
npm run build
```

Expected: 构建成功，无类型错误。`out/main`、`out/preload`、`out/renderer` 均生成。

- [ ] **Step 4: Commit**

```bash
git add src/preload/index.ts src/preload/index.d.ts
git commit -m "feat(preload): expose updateCheck IPC bridge

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 4: AboutSection 组件

**Files:**
- Create: `src/renderer/src/components/AboutSection.tsx`

**Interfaces:**
- Consumes: `window.api.updateCheck()`（Task 3 产出）、`window.api.openBrowserWindow(url)`（既有）、`react-markdown` + `remark-gfm`（既有依赖）
- Produces: `AboutSection` 默认导出组件，供 Task 5 挂载

- [ ] **Step 1: 创建 `src/renderer/src/components/AboutSection.tsx`**

注意：UI 类名全部对齐 SettingsDrawer 既有样式（`glass-panel` / `text-text-primary` / `text-text-secondary` / `text-primary`），不引入 `bg-gray-800` 等通用类。

```tsx
import { useState, useCallback } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

type CheckStatus = 'idle' | 'checking' | 'has-update' | 'no-update' | 'error'

interface CheckState {
  status: CheckStatus
  latestVersion?: string
  currentVersion?: string
  releaseUrl?: string
  releaseNotes?: string
  error?: string
}

const INITIAL_STATE: CheckState = { status: 'idle' }

export default function AboutSection(): JSX.Element {
  const [state, setState] = useState<CheckState>(INITIAL_STATE)
  const [showNotes, setShowNotes] = useState(false)

  const handleCheck = useCallback(async () => {
    setState({ status: 'checking' })
    setShowNotes(false)
    const result = await window.api.updateCheck()
    if (result.success && result.data) {
      const d = result.data
      setState({
        status: d.hasUpdate ? 'has-update' : 'no-update',
        latestVersion: d.latestVersion,
        currentVersion: d.currentVersion,
        releaseUrl: d.releaseUrl,
        releaseNotes: d.releaseNotes
      })
    } else {
      setState({ status: 'error', error: result.error ?? '检查失败，请稍后重试' })
    }
  }, [])

  const handleDownload = useCallback(() => {
    if (state.releaseUrl) {
      void window.api.openBrowserWindow(state.releaseUrl)
    }
  }, [state.releaseUrl])

  const isChecking = state.status === 'checking'

  return (
    <div className="mt-3 p-3 rounded-xl glass-panel space-y-3">
      {/* 当前版本 */}
      <div className="flex items-center justify-between text-sm">
        <span className="text-text-secondary">当前版本</span>
        <span className="text-text-primary font-mono">
          v{state.currentVersion ?? '—'}
        </span>
      </div>

      {/* 检查按钮 + 结果文案 */}
      <div className="flex items-center justify-between gap-3">
        <div className="text-sm flex-1">
          {state.status === 'checking' && (
            <span className="text-text-secondary">正在检查…</span>
          )}
          {state.status === 'has-update' && state.latestVersion && (
            <span className="text-text-primary">
              发现新版本 <span className="text-primary font-medium">v{state.latestVersion}</span>
            </span>
          )}
          {state.status === 'no-update' && (
            <span className="text-text-secondary">当前已是最新版本</span>
          )}
          {state.status === 'error' && state.error && (
            <span className="text-red-400">{state.error}</span>
          )}
          {state.status === 'idle' && (
            <span className="text-text-secondary">检查是否有新版本</span>
          )}
        </div>

        {/* 操作按钮 */}
        <div className="flex items-center gap-2 shrink-0">
          {state.status === 'has-update' && (
            <button
              type="button"
              onClick={handleDownload}
              className="px-3 py-1.5 text-xs rounded-full glass-panel text-text-primary hover:text-primary hover:bg-blue-50/50 transition-all font-medium"
            >
              前往下载
            </button>
          )}
          <button
            type="button"
            onClick={handleCheck}
            disabled={isChecking}
            className="px-3 py-1.5 text-xs rounded-full glass-panel text-text-primary hover:text-primary hover:bg-blue-50/50 transition-all font-medium disabled:opacity-50"
          >
            {isChecking ? '检查中…' : state.status === 'error' ? '重试' : '检查更新'}
          </button>
        </div>
      </div>

      {/* Release Notes 折叠 */}
      {state.releaseNotes && state.status === 'has-update' && (
        <div className="border-t border-black/10 dark:border-white/10 pt-2">
          <button
            type="button"
            onClick={() => setShowNotes((v) => !v)}
            className="text-xs text-primary hover:underline flex items-center gap-1"
          >
            <span className="material-symbols-outlined text-sm">
              {showNotes ? 'expand_less' : 'expand_more'}
            </span>
            {showNotes ? '收起更新说明' : '查看更新说明'}
          </button>
          {showNotes && (
            <div className="mt-2 text-sm text-text-primary prose prose-sm max-w-none">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>
                {state.releaseNotes}
              </ReactMarkdown>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add src/renderer/src/components/AboutSection.tsx
git commit -m "feat(ui): add AboutSection component for update check

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 5: SettingsDrawer 集成

**Files:**
- Modify: `src/renderer/src/components/SettingsDrawer.tsx`（顶部 import + 「使用说明」区块 line 1381-1406 内挂载）

**Interfaces:**
- Consumes: `AboutSection` 默认导出（Task 4 产出）

- [ ] **Step 1: 导入 AboutSection**

在 `src/renderer/src/components/SettingsDrawer.tsx` 顶部现有 import 区域添加（跟随其他相对路径组件 import 的位置）：

```typescript
import AboutSection from './AboutSection'
```

- [ ] **Step 2: 在「使用说明」区块内挂载 AboutSection**

找到 line 1387-1405 的 `glass-panel` div（包含「查看使用说明」`<a>` 链接）。在 `</a>`（line 1404）之后、`</div>`（line 1405，关闭 `glass-panel`）之前，插入 `<AboutSection />`。

改前（line 1387-1405 摘要）：

```tsx
            <div className="p-4 rounded-xl glass-panel">
              <a
                href="https://ai.feishu.cn/docx/TiLFdnaPjo7ZnQx7J5JcFMLInsd"
                ...
              >
                ...
              </a>
            </div>
```

改后：

```tsx
            <div className="p-4 rounded-xl glass-panel">
              <a
                href="https://ai.feishu.cn/docx/TiLFdnaPjo7ZnQx7J5JcFMLInsd"
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center justify-between p-3 glass-panel rounded-xl hover:bg-blue-50/40 transition-all group"
              >
                <div className="flex items-center gap-3">
                  <span className="material-symbols-outlined text-primary text-xl">help</span>
                  <div className="flex flex-col">
                    <span className="text-text-primary text-sm font-medium">查看使用说明</span>
                    <span className="text-text-secondary text-[10px]">了解如何配置、使用和管理 API Key</span>
                  </div>
                </div>
                <span className="material-symbols-outlined text-text-secondary group-hover:text-primary transition-colors">
                  open_in_new
                </span>
              </a>
              <AboutSection />
            </div>
```

> 说明：使用说明飞书链接保持不动；`AboutSection` 用 `mt-3` 与上方链接拉开间距（已在 Task 4 组件根 div 上设置）。

- [ ] **Step 3: Commit**

```bash
git add src/renderer/src/components/SettingsDrawer.tsx
git commit -m "feat(ui): mount AboutSection in SettingsDrawer usage section

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 6: 验证

- [ ] **Step 1: ESLint 检查**

```bash
npm run lint
```

Expected: 无错误，无新增 warning（既有 warning 可忽略）。

- [ ] **Step 2: TypeScript 构建检查**

```bash
npm run build
```

Expected: 构建成功，`out/main`、`out/preload`、`out/renderer` 均生成，无类型错误。

- [ ] **Step 3: 开发环境手动验证**

```bash
npm run dev
```

验证场景：

1. **基础渲染**
   - 打开 Settings Drawer → 滚动到「使用说明」区块
   - 预期：飞书「查看使用说明」链接仍在；其下方出现「当前版本 vX.Y.Z」+「检查更新」按钮

2. **无更新场景（当前为最新）**
   - 点击「检查更新」
   - 预期：按钮短暂显示「检查中…」禁用 → 结果文案「当前已是最新版本」

3. **有更新场景（版本降级触发真实检测）**
   - 临时修改 `package.json` 的 `version` 为 `0.0.1`
   - 重新 `npm run dev`
   - 打开 Settings → 「使用说明」区块 → 点击「检查更新」
   - 预期：显示「发现新版本 v1.1.0」+「前往下载」按钮 + 可展开「查看更新说明」
   - 点击「前往下载」→ 在默认浏览器打开对应 GitHub Release 页面
   - **测试完成后务必恢复 `package.json` version 为原值**

4. **失败场景**
   - 断网后点击「检查更新」
   - 预期：显示「检查失败，请检查网络后重试」+ 按钮变为「重试」

- [ ] **Step 4: 恢复版本号并提交（如 Step 3 中改过版本）**

```bash
# 确认 package.json version 已恢复
git status
# 若 package.json 无未提交改动则跳过；若改动则仅提交验证修复（如有）
git add -A
git commit -m "fix: address lint/build issues from update-check implementation

Co-Authored-By: Claude <noreply@anthropic.com>"
```

> 注意：Step 3 场景 3 临时改的 `0.0.1` **不可提交**，验证后必须恢复。若 `git status` 显示 package.json 有改动，先手工恢复再继续。

---

## 自审查

### Spec 覆盖检查

| Spec 要求 | 对应 Task |
|---|---|
| 主进程 fetch GitHub Releases + semver 比较 | Task 1 (`checkForUpdate` + `normalizeVersion` + `isLaterVersion`) |
| 结构化 `UpdateCheckResult` 返回 | Task 1 (接口定义) + Task 3 (preload 类型) |
| 单 IPC 通道 `update:check` | Task 2 |
| preload 桥接 + 类型声明 | Task 3 |
| Settings Drawer「关于」区块 UI | Task 4 (组件) + Task 5 (挂载) |
| 当前版本号展示 | Task 4 (根 div 第一行) |
| 检查更新按钮 + 检查中禁用态 | Task 4 (`handleCheck` + `isChecking`) |
| 有更新 → 新版号 + 前往下载外链 | Task 4 (`has-update` 分支 + `handleDownload`) |
| 无更新 → 友好提示 | Task 4 (`no-update` 分支) |
| 失败 → 友好提示 + 重试 | Task 4 (`error` 分支 + 按钮文案切换) |
| release notes 折叠展示（react-markdown） | Task 4 (折叠面板) |
| 全平台一致行为 | Task 1 无平台分支，Task 4 无平台判断 |
| 网络失败/超时友好提示 | Task 1 (catch 分支) |
| GitHub 403 限流提示 | Task 1 (`response.status === 403`) |
| 响应体结构异常处理 | Task 1 (typeof 校验 + normalize null) |
| 版本号格式异常处理 | Task 1 (`normalizeVersion` 返回 null) |
| 不引入新依赖 | 全程复用 fetch / app.getVersion / react-markdown / openBrowserWindow |
| 不改打包配置 | 无 Task 涉及 electron-builder.yml |
| `npm run lint` + `npm run build` + dev 手动验证 | Task 6 |

### Placeholder 扫描

无 TBD / TODO / "implement later" / "add appropriate error handling" / "Similar to Task N"。所有错误处理、版本比较、UI 分支均给出完整代码。

### 类型一致性检查

- `UpdateCheckResult` 字段在以下位置完全一致：
  - Task 1 `src/main/updater/checker.ts`（定义与导出）
  - Task 3 `src/preload/index.d.ts`（renderer 可见类型）
- `checkForUpdate` 签名：Task 1 定义 `() => Promise<{ success, data?, error? }>`，Task 2 IPC handler 直接 `return await checkForUpdate()`，对齐。
- IPC 通道名 `update:check`：Task 2 (handler)、Task 3 (preload invoke)、Task 4 (组件调用 `window.api.updateCheck`) 全部对齐。
- `window.api.updateCheck` 返回类型：Task 3 声明 `Promise<{ success, data?: UpdateCheckResult, error?: string }>`，Task 4 `handleCheck` 按 `result.success && result.data` 解构，对齐。
- `AboutSection` 默认导出：Task 4 `export default function AboutSection`，Task 5 `import AboutSection from './AboutSection'`，对齐。

### 与既有 OTA 文档关系

本计划实施纯提醒版，与 `2026-05-04-electron-ota-design.md`（半自动 electron-updater 版）互不冲突。旧方案作为未来升级路径保留，本次不实施。`src/main/updater/checker.ts` 与旧方案假设的 `src/main/updater/index.ts` 文件名不同，不会同时存在。
