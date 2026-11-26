# 内存泄漏修复 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

> Created: 2026-07-02 00:48 (local)

**Goal:** 修复代码库内存泄漏审核发现的 10 处问题（覆盖高/中/低严重度链路与磁盘临时文件），按层（main / renderer）小步落地，每步可独立 lint+build 验证。

**Architecture:** 主进程侧聚焦"总结/任务拆解链路的 AbortController 与流式 reader/sender 生命周期"（#1#2#3）+ 临时文件清理扩展（#10）；渲染层侧聚焦 Zustand 内存上限收口（#6）、webview ref 缓存回收（#5）、导航定时器清理（#7）；并在 `registerWebviewHandlers` 加去重守卫（#8）、监控写盘降频（#9）。#4（mountedWebviews 模式切换保留进程）按用户决定**不在本计划处理**，仅作为已知取舍记录。

**Tech Stack:** TypeScript (strict), Electron 28, React 18, Zustand 4, electron-vite, npm。无自动化测试运行器，验证 = `npm run lint` + `npm run build` + `npm run dev` 手动验证。

## Global Constraints

- 包管理器固定 npm（AGENTS.md 禁止其他）。
- 严格 TS，禁止 `any` 静默错误；未用变量以 `_` 前缀。
- **IPC 契约约束**：涉及 IPC 新增/修改必须同步 `src/main/ipcHandlers.ts`、`src/preload/index.ts`、`src/preload/index.d.ts` 及渲染层调用点；返回结构统一 `{ success, data?, error? }`。本计划仅 Task 6 新增一个 IPC（`cleanup-paste-temp`），需端到端同步。channel 命名遵循现有连字符风格（`read-clipboard-image` 等），不用冒号风格。
- **分层约束**：main 仅做进程能力/IPC/数据；renderer 仅做 UI/状态。不跨层塞逻辑。
- **日期/时间戳**：写入文件前用 `date`/`Get-Date` 取真实时间，禁止凭记忆捏造。
- 禁止顺手重构、无关样式/命名改动。每个 Task 聚焦自身交付物。
- 验证流程：每个 Task 末尾跑 `npm run lint` + `npm run build`；功能验证在 `npm run dev` 桌面环境手动进行。
- 提交规范：Conventional Commits（`fix:` / `refactor:` / `chore:` 等），小步频繁提交。

## Out of Scope（已知取舍，不在本计划处理）

- **#4 `mountedWebviews` Set 只增不减（模式切换靠 `display:none` 保留 webview 进程）**：KNOWLEDGE.md 已记录为"牺牲会话连续性才能省"的有意取舍。用户决定暂不处理。**不要在本计划改动 `MainPage.tsx` 的 `mountedWebviews` 逻辑。** 若后续需要，另起计划评估"新建会话时清空 Set"方案。

---

## File Structure

修改文件清单（按 Task 顺序）：

| 文件 | 责任 | 改动 Task |
|---|---|---|
| `src/main/api/summaryApi.ts` | 总结/拆解流式请求；reader 生命周期 | T1, T2 |
| `src/main/ipcHandlers.ts` | `generate-summary`/`split-task` IPC；AbortController；`onChunk` 守卫；`read-clipboard-image` 临时目录清理 IPC | T3, T4, T6 |
| `src/preload/index.ts` | 暴露 `cleanupPasteTemp`（`cleanup-paste-temp`）桥接 | T6 |
| `src/preload/index.d.ts` | IPC 契约类型 | T6 |
| `src/main/index.ts` | 启动时清理 `multichat-paste-*` 与残留 `multichat-copy-*.vbs` | T7 |
| `src/main/shortcutManager.ts` | VBS 临时文件兜底清理 | T8 |
| `src/main/webviewManager.ts` | `registerWebviewHandlers` 去重守卫 | T9 |
| `src/renderer/src/store/appStore.ts` | `loadMore*` 内存上限收口；监控写盘降频 | T10, T11 |
| `src/renderer/src/pages/MainPage.tsx` | `refCallbacks` 旧键回收；导航 `setTimeout` 清理 | T12, T13 |

---

## Task 1: summaryApi 流 reader 加 finally 释放锁（#2）

**Files:**
- Modify: `src/main/api/summaryApi.ts`（`generateSummary` 函数内，`const reader = response.body?.getReader()` 处 ~`:210`，以及 `try { ... } catch (streamError) { ... }` ~`:233-429`）

**Interfaces:**
- Consumes: 无（首个 Task）
- Produces: `generateSummary` 在 abort/异常/正常结束三条路径都保证 `reader` 被释放，供 T3 的 `onChunk isDestroyed` 守卫与 T4 的 AbortController 复用链路依赖此稳定行为。

**背景**：当前 `reader = response.body?.getReader()`（`:210`）在 `try`（`:233`）内消费；`catch`（`:412`）的 AbortError 路径直接 `return`，reader 锁未释放，底层流/TCP 连接挂起到服务端超时。需加 `finally` 调 `reader.cancel()`（释放锁并取消流）。

- [ ] **Step 1: 在 reader 取得后包一层 try/catch/finally**

把 `try { ... } catch (streamError) { ... }` 整段（`:233` 到 `:429`）外面加 `finally`。当前结构（精简示意，实施时按真实行号定位）：

```ts
// 现状（精简）
try {
  let streamActive = true
  while (streamActive) {
    const { done, value } = await reader.read()
    // ... 解析 + onChunk ...
  }
  onChunk({ done: true, content: '' })
  return { success: true, data: fullContent }
} catch (streamError) {
  if (streamError instanceof Error && streamError.name === 'AbortError') {
    onChunk({ done: true, content: '' })
    return { success: false, error: '已终止生成', aborted: true, partialData: fullContent || undefined }
  }
  console.error(`[Summary API] ❌ 流读取异常:`, streamError)
  onChunk({ done: true, content: '' })
  throw streamError
}
```

改为（新增 `finally`，在 `catch` 块之后、闭合 `}` 之前插入）：

```ts
} catch (streamError) {
  if (streamError instanceof Error && streamError.name === 'AbortError') {
    console.log(`[Summary API] 请求被用户终止，已生成 ${fullContent.length} 字符，耗时: ${Date.now() - startTime}ms`)
    onChunk({ done: true, content: '' })
    return {
      success: false,
      error: '已终止生成',
      aborted: true,
      partialData: fullContent || undefined
    }
  }

  console.error(`[Summary API] ❌ 流读取异常:`, streamError)
  onChunk({ done: true, content: '' })
  throw streamError
} finally {
  // 释放 reader 锁并取消底层流，避免 abort/异常路径下 TCP 连接与缓冲区挂起
  try {
    await reader.cancel()
  } catch (cancelErr) {
    // reader 可能已关闭/释放，忽略
    console.warn('[Summary API] reader.cancel 失败（可能已关闭）:', String(cancelErr))
  }
}
```

注意：`reader` 在 `:210` 取得，`finally` 在同一作用域内可见。`cancel()` 在流已正常结束时是 no-op，安全。

- [ ] **Step 2: lint + build 验证**

Run: `npm run lint`
Expected: 无新增 `@typescript-eslint` 错误（`cancelErr` 已用、无 `any`）。

Run: `npm run build`
Expected: 类型检查通过，打包成功。

- [ ] **Step 3: 手动验证 abort 路径不再挂起（在 dev 环境）**

Run: `npm run dev`

验证步骤：
1. 打开总结面板，发起一次较长的总结（选长文本）。
2. 流式输出进行中点"中止"按钮。
3. 观察主进程控制台：应打印 `请求被用户终止` + 之后无持续 chunk 日志（说明流已被 cancel，不再回调）。
4. （可选）用任务管理器观察主进程网络连接：中止后不再有挂起的 TLS 连接到该 API host。

- [ ] **Step 4: Commit**

```bash
git add src/main/api/summaryApi.ts
git commit -m "fix(summary): release stream reader on abort/error path to prevent connection leak"
```

---

## Task 2: summaryApi generateSummary 入口对旧 AbortController 无依赖确认（#2 收尾，无代码改动则跳过）

**Files:**
- Read-only: `src/main/api/summaryApi.ts`

**说明**：本 Task 是核查步骤，确认 `generateSummary(params, signal, onChunk)` 完全依赖外部传入的 `signal`，自身不持有控制器——这样 T4 在 IPC 层做"覆盖前 abort"才能真正生效。若发现 `generateSummary` 内部另有模块级 AbortController（不太可能），需在此抽出。

- [ ] **Step 1: 核查 generateSummary 签名与内部 signal 来源**

Run（在仓库根）: `grep -n "signal" src/main/api/summaryApi.ts`
Expected: `signal` 仅作为函数形参出现（如 `export async function generateSummary(params, signal, onChunk)`），内部 `fetch(url, { signal, ... })` 直接用形参；**无**模块级 `let xxxAbortController`。

- [ ] **Step 2: 若核查通过，无代码改动，直接进 T3**

若核查不通过（发现内部持有控制器），把该控制器抽出为形参 `signal`，并在调用方（`ipcHandlers.ts` T4）传入。本计划假设核查通过。

- [ ] **Step 3: 无改动则不提交；若有改动则提交**

```bash
# 仅当有改动时
git add src/main/api/summaryApi.ts
git commit -m "refactor(summary): rely solely on external AbortSignal"
```

---

## Task 3: generate-summary 的 onChunk 加 isDestroyed 守卫（#3）

> **范围澄清**：本 Task **仅作用于 `generate-summary` handler**。`split-task` handler（`ipcHandlers.ts:657`）调用 `splitTask(params, signal)`，而 `splitTask`（`src/main/api/taskSplitApi.ts:41`）请求体为 `stream: false`，是**非流式一次性 fetch**，无 `getReader()`、无 `onChunk`、无 reader 锁。因此 split-task 不存在 onChunk 守卫问题，本 Task 不改 split-task。

**Files:**
- Modify: `src/main/ipcHandlers.ts`（`generate-summary` handler 内 `onChunk` 闭包 ~`:629-633`）

**背景**：`generate-summary` handler 的 `onChunk = (chunk) => { event.sender.send('summary-stream-chunk', chunk) }` 无 `isDestroyed()` 守卫。渲染窗口中途关闭 → 主进程继续 `reader.read()` 并对死 sender `send`，整条流被消费到结束。

**Interfaces:**
- Consumes: T1 的 reader cancel 行为（若 sender 已 destroyed，需中止整个请求，不只是跳过 chunk——否则 reader 还会继续读）。
- Produces: 一个稳定的 `onChunk` 闭包，sender destroyed 时既跳过 send 又触发 abort（通过外部 controller）。

- [ ] **Step 1: 改写 generate-summary 的 onChunk，sender destroyed 时 abort**

当前（`ipcHandlers.ts` ~`:620-643`）：

```ts
currentSummaryAbortController = new AbortController()
const { signal } = currentSummaryAbortController

try {
  const result = await generateSummary(
    params,
    signal,
    (chunk) => {
      // 通过 IPC 发送流式数据块到渲染进程
      event.sender.send('summary-stream-chunk', chunk)
    }
  )
  currentSummaryAbortController = null
  return result
} catch (error) {
  currentSummaryAbortController = null
  throw error
}
```

改为（`onChunk` 内加 `isDestroyed` 守卫，destroyed 则 abort 当前 controller）：

```ts
currentSummaryAbortController = new AbortController()
const { signal } = currentSummaryAbortController
const controller = currentSummaryAbortController

try {
  const result = await generateSummary(
    params,
    signal,
    (chunk) => {
      // 渲染进程已销毁（窗口关闭等）：中止请求，避免对死 sender 持续 send + 空转 reader
      if (event.sender.isDestroyed()) {
        controller.abort()
        return
      }
      // 通过 IPC 发送流式数据块到渲染进程
      event.sender.send('summary-stream-chunk', chunk)
    }
  )
  currentSummaryAbortController = null
  return result
} catch (error) {
  currentSummaryAbortController = null
  throw error
}
```

注意：`const controller = currentSummaryAbortController` 取一份本地引用，防止 T4 修改模块变量后 `onChunk` 闭包持有的引用错位（T4 会改模块变量，但此处闭包应中止的是"自己这次"的 controller，本地引用正解）。

- [ ] **Step 2: lint + build**

Run: `npm run lint`
Expected: 通过。

Run: `npm run build`
Expected: 类型检查通过。`BrowserWindow`/`WebContents` 的 `isDestroyed()` 是 Electron 公开 API，TS 类型应能识别。

- [ ] **Step 3: 手动验证窗口中途关闭不再空转**

Run: `npm run dev`

验证步骤：
1. 发起一次长总结（流式输出中）。
2. **流式进行中关闭主窗口**（或切到不触发 summary 的页面后关闭）。
3. 观察主进程控制台：应看到中止相关日志（`请求被用户终止`），且之后**不再**有 chunk 处理日志、不再向已销毁 sender send 的告警。
4. 任务管理器：主进程对应 API host 的连接应随后释放。

- [ ] **Step 4: Commit**

```bash
git add src/main/ipcHandlers.ts
git commit -m "fix(summary): abort stream when renderer destroyed to stop dead-sender send"
```

---

## Task 4: generate-summary / split-task 覆盖前 abort 旧 controller（#1）

**Files:**
- Modify: `src/main/ipcHandlers.ts`（`generate-summary` handler 入口 ~`:622`，`split-task` handler 入口 ~`:654`）

**背景**：`currentSummaryAbortController = new AbortController()` 直接覆盖旧引用，从不 `.abort()`。且两个 handler 共用同一模块变量——split-task 进行中再发 summary 会丢掉 split-task 的中止能力，反之亦然。最易触发的真实泄漏。

**Interfaces:**
- Consumes: T3 的 `onChunk isDestroyed` 守卫（同处 handler，已就位）。
- Produces: 模块级 `currentSummaryAbortController` 在任何新请求到来前，旧的一定被 abort。

- [ ] **Step 1: 抽出 abort 辅助函数并在两个 handler 入口调用**

在 `ipcHandlers.ts` 顶部，`let currentSummaryAbortController`（~`:31`）下方新增辅助函数：

```ts
// 存储当前的 AbortController，用于终止请求
let currentSummaryAbortController: AbortController | null = null

/**
 * 中止并清理当前的 AbortController。
 * 在发起新的 summary / split-task 之前调用，确保上一个请求的流被真正取消，
 * 避免 fetch + reader 挂起（旧 controller 被覆盖而不 abort 会泄漏连接）。
 */
function abortCurrentSummaryRequest(): void {
  if (currentSummaryAbortController) {
    currentSummaryAbortController.abort()
    currentSummaryAbortController = null
  }
}
```

- [ ] **Step 2: generate-summary handler 入口改为 abort-then-create**

把 `generate-summary` handler 内（~`:621-622`）：

```ts
// 创建 AbortController 用于支持终止请求
currentSummaryAbortController = new AbortController()
const { signal } = currentSummaryAbortController
```

改为：

```ts
// 先中止上一个进行中的请求（覆盖而不 abort 会泄漏 fetch + reader），再创建新的
abortCurrentSummaryRequest()
currentSummaryAbortController = new AbortController()
const { signal } = currentSummaryAbortController
```

- [ ] **Step 3: split-task handler 入口同样改造**

把 `split-task` handler 内（~`:654-655`）：

```ts
currentSummaryAbortController = new AbortController()
const { signal } = currentSummaryAbortController
```

改为：

```ts
// 与 generate-summary 共用同一 controller：先 abort 上一个（可能是正在进行的 summary），
// 避免旧流挂起；这也是 split-task 能正确获得中止能力的前提
abortCurrentSummaryRequest()
currentSummaryAbortController = new AbortController()
const { signal } = currentSummaryAbortController
```

- [ ] **Step 4: 同步更新 abort-summary / abort-split-task 复用辅助函数（可选 DRY，但保持行为不变）**

`abort-summary`（~`:596-604`）与 `abort-split-task`（~`:667-674`）当前各自手写 `if (currentSummaryAbortController) { .abort(); = null }`。为保持 DRY，可替换为 `abortCurrentSummaryRequest()`，但**这两个 handler 需要返回 `{success:true}` vs `{success:false, error}` 来区分"有/无进行中请求"**，所以替换时要保留返回值逻辑。

把 `abort-summary`（~`:596-604`）：

```ts
ipcMain.handle('abort-summary', async () => {
  if (currentSummaryAbortController) {
    currentSummaryAbortController.abort()
    currentSummaryAbortController = null
    return { success: true }
  }
  return { success: false, error: '没有正在进行的请求' }
})
```

改为（行为完全等价，仅复用辅助函数）：

```ts
ipcMain.handle('abort-summary', async () => {
  if (currentSummaryAbortController) {
    abortCurrentSummaryRequest()
    return { success: true }
  }
  return { success: false, error: '没有正在进行的请求' }
})
```

`abort-split-task`（~`:667-674`）同理替换内部三行为 `abortCurrentSummaryRequest()` + 保留返回值。

- [ ] **Step 5: lint + build**

Run: `npm run lint`
Expected: 通过；`abortCurrentSummaryRequest` 已被使用，无未用警告。

Run: `npm run build`
Expected: 通过。

- [ ] **Step 6: 手动验证覆盖前 abort**

Run: `npm run dev`

验证步骤：
1. 发起一次长 summary，流式进行中。
2. **不中止**，直接再点"发送/重新生成"发第二次 summary。
3. 观察：第一次的流应**立即停止**（不再有新 chunk 日志），第二次正常开始。第一次的 API 连接应释放（任务管理器或主进程日志）。
4. 验证 split-task 与 summary 互斥：summary 进行中触发 split-task（任务拆解），summary 应被中止；split-task 进行中再发 summary，split-task 应被中止。两端"中止"按钮仍各自有效。
   - **注意 split-task 是非流式一次性 fetch**（`taskSplitApi.ts:41` `stream:false`）：中止它的表现是 fetch 迅速 reject、`taskSplitApi.ts:66` 返回 `{success:false, aborted:true}`，**没有 chunk 流式输出的"流立即停"视觉**。不要期待 split-task 中止时看到 chunk 日志停止——它本就没有流式 chunk。

- [ ] **Step 7: Commit**

```bash
git add src/main/ipcHandlers.ts
git commit -m "fix(summary): abort previous AbortController before overwrite to leak fetch/reader"
```

---

## Task 5: 验证总结/拆解链路端到端（无代码改动，回归闸门）

**Files:**
- Read-only: `src/main/ipcHandlers.ts`, `src/main/api/summaryApi.ts`

**说明**：T1-T4 改动集中在 main 层总结/拆解链路，未触碰 IPC 契约（无新增 channel、无返回结构变化）。本 Task 是回归闸门，确认行为正确且未回归。

- [ ] **Step 1: 全量 lint + build**

Run: `npm run lint && npm run build`
Expected: 全绿。

- [ ] **Step 2: dev 环境完整回归**

Run: `npm run dev`

回归清单（逐项手动确认）：
1. 正常 summary：流式输出正常、reasoning/thinking 正常、完成正确、`[DONE]` 收到。
2. 中止 summary：中止按钮生效，主进程打印终止日志，流停止。
3. 中途关窗：窗口关闭后主进程不再空转 send（T3）。
4. 连续发起（覆盖）：旧流立即停（T4），新流正常。
5. summary ↔ split-task 互斥：彼此能中止对方（T4）。
6. split-task 正常完成、`abort-split-task` 生效。

- [ ] **Step 3: 若全部通过，无提交；若发现回归，回到对应 Task 修正**

---

## Task 6: 新增 `cleanup-paste-temp` IPC + paste 临时目录即时清理（#10 一半）

**Files:**
- Modify: `src/main/ipcHandlers.ts`（`read-clipboard-image` handler → 写 `multichat-paste-*` 的 handler ~`:413-437`；新增 cleanup handler）
- Modify: `src/preload/index.ts`（暴露 `cleanupPasteTemp`）
- Modify: `src/preload/index.d.ts`（类型声明）

**背景**：`read-clipboard-image` handler（注意：channel 名是 `read-clipboard-image` 连字符风格，**非** `clipboard:read-image`）把图片写入 `mkdtemp(tmpdir(), 'multichat-paste-')` 后返回路径，**无任何清理**。图片上传完成（成功或失败）后应清理该目录。

> **命名约定**：现有 IPC channel 一律用连字符风格（`read-clipboard-image`、`abort-summary`、`generate-summary`）。本 Task 新增的 cleanup channel 遵循同一风格，命名为 **`cleanup-paste-temp`**（**非** `temp:cleanup-paste` 冒号风格），保持一致性。

**Interfaces:**
- Consumes: 无
- Produces: 渲染层可调用 `window.api.cleanupPasteTemp(dirPath)` 删除指定 paste 临时目录。

- [ ] **Step 1: 在 ipcHandlers.ts 新增 cleanup handler**

在 `read-clipboard-image` handler 之后新增（channel 名用连字符风格，与现有一致）：

```ts
// IPC 处理器：清理粘贴图片产生的临时目录（multichat-paste-*）
ipcMain.handle('cleanup-paste-temp', async (_event, filePath: string) => {
  if (!filePath || typeof filePath !== 'string') {
    return { success: false, error: 'invalid filePath' }
  }
  // main 层自行 dirname，渲染层无需正则提取目录
  const targetDir = dirname(filePath)
  // 仅允许清理本应用 tmpdir 下的 multichat-paste-* 目录，防止任意路径删除
  const tempRoot = tmpdir()
  const resolved = resolve(targetDir)
  const base = resolve(join(tempRoot, 'multichat-paste-'))
  if (!resolved.startsWith(base)) {
    return { success: false, error: 'path not under multichat-paste temp root' }
  }
  try {
    await rm(resolved, { recursive: true, force: true })
    return { success: true }
  } catch (e) {
    return { success: false, error: String(e) }
  }
})
```

注意：
- handler 接收 **filePath**（`readClipboardImage` 返回的 `data.filePath`，形如 `<dir>/pasted-image.png`），由 main 层 `dirname()` 取目录——渲染层无需自己拼/正则，更稳健。
- 需确保 `ipcHandlers.ts` 顶部已 import `rm`, `resolve`, `join`, `tmpdir`, `dirname`。`mkdtemp`/`writeFile`/`join`/`tmpdir` 已在该文件使用（见 `:421`），`rm`、`resolve`、`dirname` 可能需补 import——实施时检查 `import { ... } from 'node:fs/promises'` 与 `from 'node:path'` 并按需补齐。`dirname` 来自 `node:path`。

- [ ] **Step 2: preload/index.ts 暴露桥接**

在 `src/preload/index.ts` 的 `api` 对象中（与 `readClipboardImage` 暴露处相邻）新增：

```ts
cleanupPasteTemp: (filePath: string) => ipcRenderer.invoke('cleanup-paste-temp', filePath),
```

- [ ] **Step 3: preload/index.d.ts 类型声明**

在 `src/preload/index.d.ts` 的 `Api` 接口中（`readClipboardImage` 声明相邻处）新增：

```ts
cleanupPasteTemp: (filePath: string) => Promise<{ success: boolean; error?: string }>
```

- [ ] **Step 4: 渲染层调用点——图片上传完成后清理**

渲染层调用点是 `src/renderer/src/components/ControlBar.tsx`（`readClipboardImage` 在 `:236/243`，粘贴后立即 `uploadFileToAll(fileData)` 在 `:252`）。**流程是"粘贴 → 立即上传到所有模型"，没有独立的"用户删除该图片"分支**——因此清理的**唯一确定性时机是"上传完成（成功或失败）之后"**，无论 success/fail 都应清理临时目录（失败时图片同样不再需要）。

具体定位：Run: `grep -n "readClipboardImage\|uploadFileToAll" src/renderer/src/components/ControlBar.tsx`
在 `ControlBar.tsx` 的 `const results = await uploadFileToAll(fileData)`（`:252`）**之后**（即上传完成的 finally/末尾分支），对 `fileData.filePath` 调用清理：

```ts
// 上传完成后（成功或失败）清理 paste 临时目录，避免 %TEMP% 堆积 multichat-paste-*
const filePath = fileData.filePath
if (filePath) window.api?.cleanupPasteTemp?.(filePath)
```

注意：
- 用 `?.` 防 API 未就绪；`fileData` 即 `result.data`（`readClipboardImage` 返回 `{ filePath, fileName, mimeType, size }`，`fileName` 恒为 `'pasted-image.png'`）。
- 把清理放在 `uploadFileToAll` 之后、函数 return 之前的**统一出口**（若 ControlBar 该段有 try/finally，放 finally 最稳；若没有，在所有 return 分支前调用一次或用 try/finally 包裹）。**不要**在"成功"和"失败"两个分支各写一遍——易漏。
- 若实施时 grep 发现存在"用户删除已粘贴图片"的独立分支（当前未见，但需复核 `ControlBar.tsx` 后续行），在该分支也加同一清理。以代码事实为准。

- [ ] **Step 5: lint + build**

Run: `npm run lint && npm run build`
Expected: 通过；IPC 契约三层同步（handler / preload / d.ts）。

- [ ] **Step 6: 手动验证 paste 临时目录被清理**

Run: `npm run dev`

验证步骤：
1. 截图/复制一张图片到剪贴板。
2. 在输入框粘贴 → 触发 `read-clipboard-image` → 记录返回的 `filePath`（在 `%TEMP%` 下 `multichat-paste-XXXX/pasted-image.png`）。
3. 发送消息（图片随之 `uploadFileToAll` 上传）→ 上传完成（成功或失败）后，检查 `%TEMP%` 下该 `multichat-paste-XXXX` 目录**已删除**。
4. 反向：粘贴后上传**失败**（如断网/无可用模型）→ 目录同样应被清理（清理在统一出口，不依赖上传成功）。

- [ ] **Step 7: Commit**

```bash
git add src/main/ipcHandlers.ts src/preload/index.ts src/preload/index.d.ts src/renderer/
git commit -m "fix(clipboard): cleanup paste temp dir after image sent or removed"
```

---

## Task 7: 启动时清理 multichat-paste-* 与残留 multichat-copy-*.vbs（#10 另一半）

**Files:**
- Modify: `src/main/index.ts`（`cleanupTempUploadDirs` ~`:62-77`，扩展匹配前缀）

**背景**：`cleanupTempUploadDirs()` 当前只匹配 `multichat-uploads-*`（`:67`）。`multichat-paste-*`（Task 6 已做即时清理，但崩溃/异常残留仍需启动兜底）与 `multichat-copy-*.vbs`（shortcutManager 的 VBS 文件，AV 锁定会残留）从不清理。

- [ ] **Step 1: 扩展 cleanupTempUploadDirs 匹配范围**

当前（`index.ts` ~`:62-77`）：

```ts
async function cleanupTempUploadDirs(): Promise<void> {
  try {
    const tempRoot = tmpdir()
    const entries = await readdir(tempRoot, { withFileTypes: true })
    const multichatDirs = entries
      .filter(e => e.isDirectory() && e.name.startsWith('multichat-uploads-'))
      .map(e => join(tempRoot, e.name))

    for (const dir of multichatDirs) {
      try {
        await rm(dir, { recursive: true, force: true })
        console.log('[Main] 清理临时目录:', dir)
      } catch (e) {
        console.warn('[Main] 清理临时目录失败:', dir, e)
      }
    }
```

改为（同时匹配 `multichat-paste-*` 目录与 `multichat-copy-*.vbs` 文件）：

```ts
async function cleanupTempUploadDirs(): Promise<void> {
  try {
    const tempRoot = tmpdir()
    const entries = await readdir(tempRoot, { withFileTypes: true })

    // 1) multichat-uploads-* 与 multichat-paste-* 目录
    const multichatDirs = entries
      .filter(e => e.isDirectory() && (e.name.startsWith('multichat-uploads-') || e.name.startsWith('multichat-paste-')))
      .map(e => join(tempRoot, e.name))

    for (const dir of multichatDirs) {
      try {
        await rm(dir, { recursive: true, force: true })
        console.log('[Main] 清理临时目录:', dir)
      } catch (e) {
        console.warn('[Main] 清理临时目录失败:', dir, e)
      }
    }

    // 2) 残留的 multichat-copy-*.vbs 文件（shortcutManager VBS，AV 锁定/崩溃残留）
    const multichatVbs = entries
      .filter(e => e.isFile() && e.name.startsWith('multichat-copy-') && e.name.endsWith('.vbs'))
      .map(e => join(tempRoot, e.name))

    for (const file of multichatVbs) {
      try {
        await rm(file, { force: true })
        console.log('[Main] 清理残留 VBS:', file)
      } catch (e) {
        console.warn('[Main] 清理 VBS 失败:', file, e)
      }
    }
```

注意：`readdir` 的 `withFileTypes` 已支持 `isDirectory()`/`isFile()`；`rm` 已 import（`:72` 在用）。函数名保持 `cleanupTempUploadDirs` 不变（避免触动调用点 `:130`），仅扩展内部逻辑——这不算"顺手重构"，是本 Task 的交付物。

- [ ] **Step 2: lint + build**

Run: `npm run lint && npm run build`
Expected: 通过。

- [ ] **Step 3: 手动验证启动清理**

准备：先制造残留——`npm run dev`，做一次划词（生成 VBS）、粘贴一张图片后**强制退出**（任务管理器结束进程，跳过正常清理路径），使 `%TEMP%` 下留有 `multichat-copy-*.vbs` 与 `multichat-paste-*`。

Run: `npm run dev`（再次启动）
Expected: 主进程启动日志打印 `[Main] 清理...` 对应残留文件/目录，`%TEMP%` 下对应条目消失。

- [ ] **Step 4: Commit**

```bash
git add src/main/index.ts
git commit -m "fix(main): cleanup multichat-paste-* dirs and residual multichat-copy-*.vbs on startup"
```

---

## Task 8: shortcutManager VBS 临时文件兜底清理（#10 配套）

**Files:**
- Modify: `src/main/shortcutManager.ts`（`simulateCopyWin32VBS` ~`:151-175`）

**背景**：`execFile` 的 callback 里 `unlinkSync`（`:165`）在 AV 锁定/进程异常时失败仅 warn，文件残留。`timeout: 1500` 超时后 cscript 可能仍存活（Windows 上 `execFile` timeout 发 SIGTERM 不一定杀掉 cscript.exe），callback 可能延迟触发甚至不触发。

- [ ] **Step 1: 把 unlinkSync 改为异步 + 增加进程退出兜底**

当前（`shortcutManager.ts` ~`:159-170`）：

```ts
execFile('cscript.exe', ['//NoLogo', tempVbsPath], { timeout: 1500, windowsHide: true }, (err) => {
  if (err) {
    console.warn('[ShortcutManager] VBS 模拟复制执行出错:', err.message)
  }
  // 清理临时文件
  try {
    unlinkSync(tempVbsPath)
  } catch (cleanupErr) {
    console.warn('[ShortcutManager] 无法删除临时 VBS 文件:', cleanupErr)
  }
  resolve()
})
```

改为（异步 unlink + 进程级 kill 兜底 + 即便 callback 延迟也能清）：

```ts
const child = execFile('cscript.exe', ['//NoLogo', tempVbsPath], { timeout: 1500, windowsHide: true }, (err) => {
  if (err) {
    console.warn('[ShortcutManager] VBS 模拟复制执行出错:', err.message)
  }
  // 异步清理临时文件（unlinkSync 在 AV 锁定时阻塞事件循环；改异步且忽略失败，
  // 残留由启动时 cleanupTempUploadDirs 兜底）
  rm(tempVbsPath, { force: true }).catch((cleanupErr) => {
    console.warn('[ShortcutManager] 无法删除临时 VBS 文件:', String(cleanupErr))
  })
  resolve()
})

// execFile 的 timeout 仅发 SIGTERM，Windows 下不一定杀掉 cscript.exe；
// 超时后强制 kill 整个进程树，避免僵尸 cscript 占用
child.on('exit', (code, _signal) => {
  if (code === null) {
    try { child.kill() } catch { /* 已退出 */ }
  }
})
```

注意：`execFile` 返回 `ChildProcess`；`rm` 来自 `node:fs/promises`，需在 `shortcutManager.ts` 顶部 import 检查并补齐（`unlinkSync` 来自 `node:fs`，`rm` 来自 `node:fs/promises`，二者不同模块，按需 import）。`child.on('exit')` 兜底是补充而非替代 callback。

- [ ] **Step 2: lint + build**

Run: `npm run lint && npm run build`
Expected: 通过；`_signal` 用 `_` 前缀符合未用变量规则。

- [ ] **Step 3: 手动验证 VBS 不残留 + 无僵尸 cscript**

Run: `npm run dev`

验证步骤：
1. 触发划词/快捷操作（Ctrl+Shift+S 等，会调 `simulateCopyWin32VBS`）。
2. 检查 `%TEMP%`：`multichat-copy-*.vbs` 在操作完成后应被删除（允许短暂延迟，因改异步）。
3. 任务管理器：不应出现长期存活的 `cscript.exe`。

- [ ] **Step 4: Commit**

```bash
git add src/main/shortcutManager.ts
git commit -m "fix(shortcut): async cleanup VBS temp file + force-kill zombie cscript on timeout"
```

---

## Task 9: registerWebviewHandlers 加去重守卫（#8）

**Files:**
- Modify: `src/main/webviewManager.ts`（`registerWebviewHandlers` ~`:411-...`）

**背景**：每次 `did-attach-webview` 都对同一 webContents 挂一整套 `will-navigate`/`did-navigate`/`did-navigate-in-page`/`dom-ready`/`did-finish-load`/`did-frame-finish-load`/`console-message`/`did-create-window` 监听，无去重。guest 重 parent（OAuth 重定向循环）可能重复 attach → 监听线性累积。

**Interfaces:**
- Produces: `registerWebviewHandlers` 对同一 webContents 只挂一次监听（幂等）。

- [ ] **Step 1: 用 webContents 的私有标记做幂等守卫**

在 `registerWebviewHandlers`（`webviewManager.ts` ~`:411`）函数体最开头加守卫：

```ts
export function registerWebviewHandlers(webContents: Electron.WebContents): void {
  // 幂等守卫：同一 webContents 只注册一次，避免 re-attach（OAuth 重定向/guest 重 parent）时
  // 监听线性累积导致内存与 CPU 增长
  const registeredKey = '__multichat_handlers_registered__'
  if ((webContents as unknown as Record<string, unknown>)[registeredKey]) {
    if (process.env.NODE_ENV === 'development') {
      console.log('[Main][WebviewHandlers] 已注册，跳过重复注册 wcId:', webContents.id)
    }
    return
  }
  ;(webContents as unknown as Record<string, unknown>)[registeredKey] = true

  setupContextMenu(webContents)
  // ... 原有逻辑不变 ...
```

注意：用字符串键挂在 webContents 实例上做幂等，是 Electron 常见模式（webContents 是对象，可挂自定义属性）。`as unknown as Record<string, unknown>` 绕过 TS 严格类型，但**不引入 `any`**——这是合规的类型断言（项目规则禁止 `any` 静默错误，但 `unknown` + Record 是类型安全的窄化）。dev 日志用于 Step 4 验证"重复注册被跳过"是否真的发生，发布构建可去掉。若 ESLint 仍报错，改用 `WeakSet<Electron.WebContents>` 模块级集合替代（见 Step 2 备选）。

- [ ] **Step 2（备选，仅当 Step 1 的属性挂载被 lint/类型拒绝时采用）: WeakSet 方案**

在 `webviewManager.ts` 顶部加：

```ts
// 已注册 handler 的 webContents 集合，用于幂等守卫
const registeredWebContentsSet = new WeakSet<Electron.WebContents>()
```

`registerWebviewHandlers` 开头改为：

```ts
export function registerWebviewHandlers(webContents: Electron.WebContents): void {
  if (registeredWebContentsSet.has(webContents)) {
    return
  }
  registeredWebContentsSet.add(webContents)
  setupContextMenu(webContents)
  // ...
}
```

`WeakSet` 不阻止 webContents 被 GC，安全。二选一，**优先 Step 1**（更简单），lint 不通过再换 Step 2。

- [ ] **Step 3: lint + build**

Run: `npm run lint && npm run build`
Expected: 通过。若 Step 1 被 lint 拒，切 Step 2。

- [ ] **Step 4: 手动验证 re-attach 不累积监听**

Run: `npm run dev`

验证步骤：
1. 打开一个 webview（如 Gemini），触发 Google 账号登录流程（OAuth 重定向）。
2. 多次进出登录页，使 webview 经历多次导航。
3. 主进程控制台：`[Main][DEBUG] will-navigate:` 等日志**不应**线性翻倍（每次导航各 handler 只触发一次，而非 N 次）。同时应能看到 `[Main][WebviewHandlers] 已注册，跳过重复注册 wcId:` 日志，证明守卫生效。
4. （可选）在 DevTools 主进程 console 跑：无法直接查 `_events`，但日志数量是直观指标。

- [ ] **Step 5: Commit**

```bash
git add src/main/webviewManager.ts
git commit -m "fix(webview): idempotent registerWebviewHandlers to prevent listener accumulation on re-attach"
```

---

## Task 10: loadMoreHistory / loadMoreSummaryHistory 收口内存上限 100（#6）

**Files:**
- Modify: `src/renderer/src/store/appStore.ts`（`loadMoreHistory` ~`:900-914`，`loadMoreSummaryHistory` ~`:916-929`）

**背景**：`loadMore*` 用 `[...s.history, ...result.data!]` 直接拼接，**无 `.slice(0,100)`**，绕过 `addHistory` 的内存上限。反复点"加载更多"可把内存涨到磁盘上限（1000 条），每条含完整 `ConversationTurn[]` 正文。

**用户决定的语义**：**内存硬上限 100，超出裁剪最旧**。即：加载更多后，若总数 > 100，保留最新的 100 条，更旧的从内存裁掉（但仍可再次"加载更多"从磁盘翻页取回）。

**关键设计**：`loadMoreHistory` 当前按 `state.history.length` 作为 offset 去磁盘取"下一页"。若内存只保留最新 100，offset 用 `history.length` 会**重复取已加载页**。需改为用**独立的"已加载到磁盘第几条"游标**作为 offset，而非 `history.length`。

- [ ] **Step 1: 在 store state 增加"已加载游标"字段**

在 `appStore.ts` 的 state 类型定义与初始值处（`historyTotalCount`/`summaryHistoryTotalCount` 声明相邻，~`:874-876`）新增两个字段：

类型声明处（interface/AppState）加：

```ts
historyLoadedCount: number          // 已从磁盘加载到内存+被裁剪掉的历史总数（游标）
summaryHistoryLoadedCount: number   // 总结历史的已加载游标
loadMoreHistory: () => Promise<void>
loadMoreSummaryHistory: () => Promise<void>
```

初始值处（~`:874-876`）加：

```ts
historyLoadedCount: 0,
summaryHistoryLoadedCount: 0,
```

同时在 `initializeStore`（~`:1542+`）加载 `history` 初始页后，把 `historyLoadedCount` 初始化为已加载条数——需读 `initializeStore` 现有逻辑确认初始加载方式（很可能用 `historyGetPage(0, 100)`）。若初始加载就是取前 100，则 `historyLoadedCount` 初始 = 加载到的条数。实施时定位 `initializeStore` 内 `history`/`summaryHistory` 的 set 调用，在其 set 内同步设 `historyLoadedCount`。

- [ ] **Step 2: 改写 loadMoreHistory 用游标 + 内存裁剪**

把 `loadMoreHistory`（~`:900-914`）：

```ts
loadMoreHistory: async () => {
  const state = get()
  if (!window.api?.historyGetPage) return
  const result = await window.api.historyGetPage(state.history.length, 100)
  if (result.success && result.data) {
    set((s) => ({
      history: [...s.history, ...result.data!],
    }))
    const countResult = await window.api.historyGetTotalCount()
    if (countResult.success && countResult.data !== undefined) {
      set({ historyTotalCount: countResult.data })
    }
  }
},
```

改为：

```ts
loadMoreHistory: async () => {
  const state = get()
  if (!window.api?.historyGetPage) return
  // 用"已加载游标"作 offset，而非 history.length——内存只保留最新 100，
  // 用 history.length 会重复取已被裁剪的旧页
  const offset = state.historyLoadedCount
  const result = await window.api.historyGetPage(offset, 100)
  if (result.success && result.data && result.data.length > 0) {
    set((s) => {
      // 拼接后裁剪：内存硬上限 100，超出从最旧端裁掉（更旧的仍可再次 loadMore 翻页取回）
      const merged = [...s.history, ...result.data!]
      const trimmed = merged.length > 100 ? merged.slice(merged.length - 100) : merged
      const dropped = merged.length - trimmed.length
      return {
        history: trimmed,
        historyLoadedCount: s.historyLoadedCount + result.data!.length
      }
    })
    const countResult = await window.api.historyGetTotalCount()
    if (countResult.success && countResult.data !== undefined) {
      set({ historyTotalCount: countResult.data })
    }
  }
},
```

注意 `dropped` 变量若未使用会被 lint 报——本步它确实未用（仅记录语义），**删掉 `const dropped = ...` 这行**，避免 lint 未用变量。最终不保留 `dropped`。

修正后该段为：

```ts
    set((s) => {
      const merged = [...s.history, ...result.data!]
      const trimmed = merged.length > 100 ? merged.slice(merged.length - 100) : merged
      return {
        history: trimmed,
        historyLoadedCount: s.historyLoadedCount + result.data!.length
      }
    })
```

- [ ] **Step 3: loadMoreSummaryHistory 同样改造**

把 `loadMoreSummaryHistory`（~`:916-929`）同样改为游标 + 裁剪（字段名换成 `summaryHistory` / `summaryHistoryLoadedCount`）：

```ts
loadMoreSummaryHistory: async () => {
  const state = get()
  if (!window.api?.summaryHistoryGetPage) return
  const offset = state.summaryHistoryLoadedCount
  const result = await window.api.summaryHistoryGetPage(offset, 100)
  if (result.success && result.data && result.data.length > 0) {
    set((s) => {
      const merged = [...s.summaryHistory, ...result.data!]
      const trimmed = merged.length > 100 ? merged.slice(merged.length - 100) : merged
      return {
        summaryHistory: trimmed,
        summaryHistoryLoadedCount: s.summaryHistoryLoadedCount + result.data!.length
      }
    })
    const countResult = await window.api.summaryHistoryGetTotalCount()
    if (countResult.success && countResult.data !== undefined) {
      set({ summaryHistoryTotalCount: countResult.data })
    }
  }
},
```

- [ ] **Step 4: initializeStore 同步初始化游标**

定位 `initializeStore`（~`:1542+`）。找到加载 `history` 初始页的 set 调用，把 `historyLoadedCount` 一并设为初始已加载条数。例如若现状是 `set({ history: loaded })`，改为 `set({ history: loaded, historyLoadedCount: loaded.length })`。对 `summaryHistory` 同理。

实施时先 Run: `grep -n "historyGetPage\|summaryHistoryGetPage\|set({ history\|set({ summaryHistory" src/renderer/src/store/appStore.ts` 定位 `initializeStore` 内的确切行，再精确改。

- [ ] **Step 5: lint + build**

Run: `npm run lint && npm run build`
Expected: 通过；新字段已声明+初始化+使用，无未用/未声明。

- [ ] **Step 6: 手动验证加载更多不超 100 + 翻页不重复**

Run: `npm run dev`

验证步骤：
1. 前置：确保磁盘有 > 100 条历史（不足则先造数据：多次对话产生 150+ 条）。
2. 打开 HistoryDrawer，初始显示最新 100 条。
3. 点"加载更多" → 应追加下一批 100 条，但**内存（store.getState().history.length）始终 ≤ 100**（可在 DevTools 控制台 `useAppStore.getState().history.length` 验证）。最新加载的那批进入可视，最旧的那批被裁出内存。
4. 再次"加载更多" → 取下一批，offset 用游标递增，**不应重复出现上一批已显示的条目**。
5. `historyTotalCount` 正确显示总数。

- [ ] **Step 7: Commit**

```bash
git add src/renderer/src/store/appStore.ts
git commit -m "fix(history): cap in-memory history to 100 via load cursor + eviction on load-more"
```

---

## Task 11: 监控轮询 saveCurrentTurn 写盘降频（#9）

**Files:**
- Modify: `src/renderer/src/store/appStore.ts`（`saveCurrentTurn` ~`:1525-1538`，及其调用点 `pollPlatforms` ~`:1406-1457`）

**背景**：流式期间约每 3s 一次 `saveCurrentTurn`，把**整个** `history` 数组（≤1000 条，每条含 `ConversationTurn[]` 正文）全量 `storeSet('history', newHistory)`。O(n) 写盘且 payload 随轮次增长。

**注意**：这是**效率**问题（CPU/IO/磁盘写放大），不是内存泄漏（数据已在内存且 T10 后内存封顶 100）。改动需谨慎不破坏历史持久化正确性。

**Interfaces:**
- Produces: `saveCurrentTurn` 在监控期间降频写盘（节流），但流结束/中止时强制 flush。

- [ ] **Step 1: 给 saveCurrentTurn 增加节流 + 强制 flush 参数**

定位 `saveCurrentTurn` 签名与实现（~`:1525-1538`）。当前是每次调用都 `storeSet('history', newHistory)`。

改为：增加模块级 `lastPersistTs` 时间戳，监控期间的常规调用走节流（如 ≥ 10s 才真正写盘），但提供 `forceFlush` 选项在流结束时强制写。

在 `appStore.ts` 顶部（store 定义之外，模块作用域）加：

```ts
// saveCurrentTurn 写盘节流：监控期间每 10s 落盘一次，避免每轮（~3s）全量写盘
let historyPersistLastTs = 0
const HISTORY_PERSIST_MIN_INTERVAL = 10_000
```

`saveCurrentTurn`（接口签名加可选参数，调用点传 `true` 走强制）：

接口类型处把 `saveCurrentTurn: () => void` 改为 `saveCurrentTurn: (forceFlush?: boolean) => void`。

实现（~`:1525-1538`）改为：

```ts
saveCurrentTurn: (forceFlush) => set((state) => {
  // ... 现有的 newTurns / updatedItem / newHistory 构造逻辑不变 ...
  const newHistory = state.history.map(h =>
    h.id === state.currentConversationId ? updatedItem : h
  )

  set({ history: newHistory })

  // 节流写盘：流式中每 10s 落盘一次；forceFlush=true（流结束/中止）时立即写
  const now = Date.now()
  const shouldPersist = forceFlush || (now - historyPersistLastTs >= HISTORY_PERSIST_MIN_INTERVAL)
  if (shouldPersist && window.api?.storeSet) {
    window.api.storeSet('history', newHistory)
    historyPersistLastTs = now
  }
  return { history: newHistory }
}),
```

注意：`Date.now()` 在渲染进程是可用的（renderer 不是 workflow 沙箱），合法。`set` 内先 `set({history:newHistory})` 再返回 `{history:newHistory}` 是 Zustand 惯用法（部分实现里直接 return 即可）——若 lint/行为提示重复，删掉内部的 `set({history:newHistory})`，仅 `return { history: newHistory }`。**以现有代码的写法为准**：若现有 `saveCurrentTurn` 就是 `set((state) => { ...; return { history: newHistory } })`，则保持该结构，只把 `storeSet` 包进 `shouldPersist` 判断。

- [ ] **Step 2: 在流结束/中止处传 forceFlush=true**

定位 `pollPlatforms`（~`:1406-1457`）中 `if (anyChanged) { get().saveCurrentTurn() }`（~`:1457`）。流仍在进行时的常规调用保持 `get().saveCurrentTurn()`（走节流）。

另需在**监控结束**（轮询停止、用户中止、组件 unmount 的清理路径）处调用 `get().saveCurrentTurn(true)` 强制 flush。grep 定位监控停止点：

Run: `grep -n "stopMonitoring\|abortSummary\|cleanupPolling\|isMonitoring.*false\|setIsMonitoring" src/renderer/src/store/appStore.ts src/renderer/src/hooks/useWebviewSummary.ts`

在找到的"停止监控/中止"分支末尾加 `get().saveCurrentTurn(true)`（若该处已在 store action 内则用 `get()`，若在 hook 里则用 `useAppStore.getState().saveCurrentTurn(true)`）。

- [ ] **Step 3: lint + build**

Run: `npm run lint && npm run build`
Expected: 通过；`forceFlush` 参数类型正确，调用点同步。

- [ ] **Step 4: 手动验证降频 + 不丢数据**

Run: `npm run dev`

验证步骤：
1. 发起多模型对话，触发监控（轮询）。
2. 流式期间观察：主进程/渲染进程不再每 3s 全量写盘（可通过 Electron DevTools 的 Network/Storage 或在 `storeSet` 处临时 `console.log` 计数——验证后删除 log）。
3. 监控正常结束 → 末尾内容**已落盘**（forceFlush 生效）：重启 app，历史末轮内容在。
4. 监控中途中止 → 已落盘的部分内容保留（forceFlush 在中止路径生效）。

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/store/appStore.ts
git commit -m "perf(history): throttle saveCurrentTurn disk writes during polling, force flush on stop"
```

---

## Task 12: refCallbacks 旧键回收（#5）

**Files:**
- Modify: `src/renderer/src/pages/MainPage.tsx`（`refCallbacks` ~`:55-76`，及插槽换模型的 effect/handler）

**背景**：`getRefCallback(id, slotIndex)` 以 `${slotIndex}-${id}`（id=modelId）为键缓存回调，只增不删。换模型时产生新键，旧键的回调**永不被 React 以 `null` 调用**（React 只对同一回调实例调 null，新键是新实例）→ 旧 `lastRef`（持 webview DOM ref）永不置空，`unregisterWebviewRef` 也永不被调。

**修复思路**：在插槽的 modelId 变化时，对旧的 `(slotIndex, oldModelId)` 键主动调用其缓存的回调传 `null`（触发 unregister + 置空 lastRef），然后从 `refCallbacks.current` 删除该键。

**Interfaces:**
- Produces: `refCallbacks.current` 在换模型后不再保留陈旧 webview ref。

- [ ] **Step 1: 定位"插槽 modelId 变化"的检测点**

Run: `grep -n "getRefCallback\|activeModels\|displayedModels\|productMode" src/renderer/src/pages/MainPage.tsx`

理解 `displayedModels`（按 productMode 派生的每插槽模型数组，~`:185-188`）如何变化。当 `displayedModels[i]` 的 modelId 与上一轮不同 → 该插槽换模型 → 需回收旧键。

- [ ] **Step 2: 用一个 effect 跟踪 displayedModels 的 modelId 变化并回收旧键**

在 `MainPage.tsx` 的 `getRefCallback` 定义（~`:55-76`）之后、`handleGenerateReport` 之前，加一个 `useEffect` 跟踪 `displayedModels` 的 modelId 数组，变化时回收旧键：

```ts
// 跟踪每插槽 modelId 的变化：换模型时回收旧 (slotIndex-oldModelId) 的 ref 回调，
// 避免 refCallbacks.current 只增不减、陈旧 webview ref 无法 GC
const prevSlotModelIds = useRef<string[]>([])
useEffect(() => {
  const currentIds = displayedModels.map(m => m?.id ?? '').filter(Boolean)
  const prev = prevSlotModelIds.current

  // 对每个插槽，若 modelId 变了，回收旧键
  currentIds.forEach((modelId, slotIndex) => {
    const oldId = prev[slotIndex]
    if (oldId && oldId !== modelId) {
      const oldKey = `${slotIndex}-${oldId}`
      const oldCb = refCallbacks.current[oldKey]
      if (oldCb) {
        // 以 null 触发旧回调：unregister 旧 webview ref + 置空 lastRef
        oldCb(null)
        delete refCallbacks.current[oldKey]
      }
    }
  })

  prevSlotModelIds.current = currentIds
}, [displayedModels])
```

注意：
- `displayedModels` 是 `useMemo`（~`:188`），依赖 `models`/各 slot 配置；其引用在内容变时才变，effect 依赖 `[displayedModels]` 合理。
- `oldCb(null)` 会走到 `getRefCallback` 里定义的 `else` 分支（`:68-72`），即 `state.unregisterWebviewRef(slotKey, lastRef)` + `unregisterWebviewRef(id, lastRef)` + `lastRef = null`，正是想要的回收。
- 插槽数变化（如 multi_ai 4 槽 → debate 2 槽）时，`currentIds` 比 `prev` 短，多出的旧插槽 `oldId` 不在上面的 forEach 里被回收——需补一段处理"消失的插槽"。在 forEach 后加：

```ts
  // 处理插槽数减少：prev 比 current 长的部分，回收所有旧键
  if (prev.length > currentIds.length) {
    for (let slotIndex = currentIds.length; slotIndex < prev.length; slotIndex++) {
      const oldId = prev[slotIndex]
      if (!oldId) continue
      const oldKey = `${slotIndex}-${oldId}`
      const oldCb = refCallbacks.current[oldKey]
      if (oldCb) {
        oldCb(null)
        delete refCallbacks.current[oldKey]
      }
    }
  }
```

- [ ] **Step 3: lint + build**

Run: `npm run lint && npm run build`
Expected: 通过；`prevSlotModelIds` ref 已用。

- [ ] **Step 4: 手动验证换模型后旧 ref 被回收**

Run: `npm run dev`

验证步骤：
1. 在某插槽（如 slot-0）用模型 A，发几条消息（webview ref 已注册）。
2. 把该插槽换成模型 B。
3. DevTools 控制台：
   ```js
   const s = useAppStore.getState()
   // 检查 registerWebviewRef 维护的 ref map 中，slot-0 与旧 modelId A 的条目应已被 unregister
   ```
   具体 ref map 字段名需 grep `registerWebviewRef` 实现（很可能存在 store 的某个 ref 字段）。验证旧 modelId 的 ref 不再残留。
4. 多次切换模式 + 换模型，`refCallbacks.current` 的键数应随换模型回收、不再单调增长（可在 `getRefCallback` 临时加 `console.log(Object.keys(refCallbacks.current).length)`，验证后删除）。

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/pages/MainPage.tsx
git commit -m "fix(webview): evict stale refCallbacks entries on slot model change to release webview refs"
```

---

## Task 13: handleGenerateReport 的 setTimeout 清理（#7）

**Files:**
- Modify: `src/renderer/src/pages/MainPage.tsx`（`handleGenerateReport` ~`:78-160`，timeout ~`:142-144`）

**背景**：`setTimeout(() => { onNavigateToSummary() }, 500)` 未存 id、未在重入/unmount 时 clear。500ms 内重复触发会叠加多个定时器多次跳转；unmount 后仍触发（闭包捕获 `history` 等）。

- [ ] **Step 1: 用 ref 存 timer id，重入与 unmount 时清理**

在 `MainPage.tsx` 顶部 ref 区（`scrapingControllerRef` ~`:53` 旁）加：

```ts
const navigateTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
```

- [ ] **Step 2: 改写 handleGenerateReport 的 setTimeout 段**

当前（~`:141-144`）：

```ts
// 延迟一下再跳转，让用户看到提示
setTimeout(() => {
  onNavigateToSummary()
}, 500)
```

改为（先清旧 timer 再设新 timer）：

```ts
// 延迟一下再跳转，让用户看到提示
if (navigateTimerRef.current) {
  clearTimeout(navigateTimerRef.current)
}
navigateTimerRef.current = setTimeout(() => {
  navigateTimerRef.current = null
  onNavigateToSummary()
}, 500)
```

- [ ] **Step 3: 组件 unmount 时清理 timer**

在 `MainPage.tsx` 已有的某个 `useEffect(() => { ... return () => { ... } }, [])`（顶层 unmount 清理）中，或新增一个，加清理：

```ts
useEffect(() => {
  return () => {
    if (navigateTimerRef.current) {
      clearTimeout(navigateTimerRef.current)
      navigateTimerRef.current = null
    }
  }
}, [])
```

若 MainPage 已有顶层 `useEffect(..., [])` 的清理函数，把 clearTimeout 并入其中而非新增 effect（避免多一个 effect）。实施时先 grep `useEffect(() =>` 确认。

- [ ] **Step 4: lint + build**

Run: `npm run lint && npm run build`
Expected: 通过；`navigateTimerRef` 已用。

- [ ] **Step 5: 手动验证重复触发不叠加跳转 + unmount 不触发**

Run: `npm run dev`

验证步骤：
1. 触发"生成报告"，在 500ms 内**连续触发第二次**。
2. 观察应只跳转一次（旧 timer 被 clear）。
3. 触发后 500ms 内切走页面（unmount MainPage，如切到 QuickPage），再等 > 500ms：不应再触发 `onNavigateToSummary`（控制台无相关跳转/警告）。

- [ ] **Step 6: Commit**

```bash
git add src/renderer/src/pages/MainPage.tsx
git commit -m "fix(report): clear pending navigate timer on re-trigger and unmount"
```

---

## Task 14: 全量回归 + SESSION_LOG 记录

**Files:**
- 无代码改动；运行 `python .memory/session_log.py` 记录

- [ ] **Step 1: 全量 lint + build**

Run: `npm run lint && npm run build`
Expected: 全绿。

- [ ] **Step 2: dev 环境完整回归（覆盖所有修复点）**

Run: `npm run dev`

回归清单：
1. **#1** 连续发 summary / summary↔split-task 互斥：旧流立即停（T4）。
2. **#2** 中止 summary：reader 释放，无连接挂起（T1）。
3. **#3** 流式中关窗：主进程不空转 send（T3）。
4. **#10** 粘贴图片发送/删除后临时目录清理（T6）+ 启动清理残留（T7）+ VBS 不残留/无僵尸 cscript（T8）。
5. **#8** OAuth 重定向不累积监听日志（T9）。
6. **#6** 加载更多：内存始终 ≤ 100、翻页不重复（T10）。
7. **#9** 监控期间写盘降频、停止/中止时 flush 不丢数据（T11）。
8. **#5** 换模型后旧 ref 回收（T12）。
9. **#7** 重复触发报告不叠加跳转、unmount 不触发（T13）。

- [ ] **Step 3: 记录 SESSION_LOG**

Run:
```bash
python .memory/session_log.py \
  --done "内存泄漏审核修复：覆盖 10 处发现（AbortController 覆盖前 abort / reader finally 释放 / onChunk isDestroyed 守卫 / paste 临时目录即时+启动清理 / VBS 兜底清理 / registerWebviewHandlers 幂等 / loadMore 内存上限 100+游标 / saveCurrentTurn 写盘节流 / refCallbacks 旧键回收 / navigate setTimeout 清理）。#4 mountedWebviews 按用户决定不处理、记录为已知取舍。" \
  --modified "src/main/api/summaryApi.ts src/main/ipcHandlers.ts src/main/index.ts src/main/shortcutManager.ts src/main/webviewManager.ts src/preload/index.ts src/preload/index.d.ts src/renderer/src/store/appStore.ts src/renderer/src/pages/MainPage.tsx" \
  --lesson "AbortController 覆盖前必须 abort 旧实例+共享同一控制器的多个入口要互斥；ReadableStream getReader() 的 abort/异常路径必须有 finally { reader.cancel() } 释放锁；Electron 流式 onChunk 必须检查 sender.isDestroyed() 否则关窗后空转消费整条流" \
  --decision "#4 mountedWebviews 模式切换保留 webview 进程为有意取舍（会话连续性），暂不处理；#6 加载更多语义定为内存硬上限 100+游标翻页，超出裁最旧" \
  --unresolved "#4 若后续需回收渲染进程，另起计划评估'新建会话时清空 mountedWebviews Set'方案"
```

若终端输出 `Consider promoting stable lessons to .memory/KNOWLEDGE.md.`，按 AGENTS.md 规定把对应 lesson 追加进 `.memory/KNOWLEDGE.md`，并把 SESSION_LOG 中对应 `- lesson:` 改为 `- lesson(promoted):`。

- [ ] **Step 4: 最终提交（若有 KNOWLEDGE/SESSION_LOG 改动）**

```bash
git add .memory/KNOWLEDGE.md SESSION_LOG.md
git commit -m "docs: record memory-leak audit fixes and lessons"
```

---

## Self-Review

**1. Spec coverage（10 处发现 → Task 映射）:**
- #1 AbortController 覆盖不 abort → T4 ✅
- #2 reader 未释放 → T1 ✅（+ T2 核查依赖）
- #3 onChunk 无 isDestroyed → T3 ✅
- #4 mountedWebviews → **Out of Scope，已声明** ✅（用户决定）
- #5 refCallbacks 只增不删 → T12 ✅
- #6 loadMore 绕过上限 → T10 ✅（语义=内存硬上限 100+游标，符合用户选择）
- #7 setTimeout 未清理 → T13 ✅
- #8 registerWebviewHandlers 无去重 → T9 ✅
- #9 监控全量写盘 → T11 ✅
- #10 临时文件清理缺口 → T6（paste 即时）+ T7（启动兜底 paste+VBS）+ T8（VBS 进程级兜底）✅

**2. Placeholder scan:** 无 TBD/TODO/"implement later"/"add error handling" 等占位。每个 code step 都给了完整代码或精确 grep 定位。Task 6 Step 4 的渲染层调用点已核查确认为 `src/renderer/src/components/ControlBar.tsx:252`（`uploadFileToAll` 之后），并已给出"统一出口清理（成功或失败都清）"的代码模板；唯一仍需实施时复核的是 ControlBar 后续行是否存在"用户删除已粘贴图片"的独立分支（当前未见，以代码事实为准）。

**3. Type consistency:**
- `abortCurrentSummaryRequest(): void` — T4 定义，T4 内部多处调用，签名一致 ✅
- `cleanupPasteTemp(filePath: string) => Promise<{success:boolean; error?:string}>` — T6 三层（handler/preload/d.ts）签名一致，handler 接收 filePath 后由 main 层 `dirname()` 取目录 ✅
- `historyLoadedCount` / `summaryHistoryLoadedCount` — T10 类型声明+初始值+使用一致 ✅
- `saveCurrentTurn(forceFlush?: boolean) => void` — T11 接口+实现+调用点一致 ✅
- `navigateTimerRef: useRef<ReturnType<typeof setTimeout> | null>` — T13 定义+使用一致 ✅
- `registeredWebContentsSet: WeakSet<Electron.WebContents>`（备选）— T9 自洽 ✅

无跨 Task 的命名/签名漂移。
