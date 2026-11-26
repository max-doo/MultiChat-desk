# Webview 总结自适应传输实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为 webview 总结模式增加自适应传输：短文本直接粘贴，长文本（>= 8000 字符）自动切换为临时 markdown 文件上传。

**Architecture:** 在 `useWebviewSummary` 的 `startSummary()` 中增加长度判断分支。超过阈值时，将 `buildPrompt()` 的结果包装为 markdown 写入临时文件，通过 `WebviewCard.uploadFile()` 上传，再发送简洁分析指令。所有改动集中在 main/preload/renderer 三层 IPC 和 `useWebviewSummary` hook 中。

**Tech Stack:** Electron 28, React 18, TypeScript, electron-vite

---

## 文件结构

| 文件 | 职责 |
|------|------|
| `src/main/ipcHandlers.ts` | 新增 `write-temp-markdown` handler：将内容写入 `os.tmpdir()` 并返回路径 |
| `src/preload/index.ts` | 暴露 `writeTempMarkdown` IPC 调用 |
| `src/preload/index.d.ts` | `window.api` 类型声明增加 `writeTempMarkdown` |
| `src/renderer/src/hooks/useWebviewSummary.ts` | 核心：增加长度判断、`uploading-file` phase、文件上传分支、fallback 逻辑 |
| `src/renderer/src/components/SummaryPanel.tsx` | 在操作栏显示当前传输策略（直接输入 / 文件上传） |
| `src/main/index.ts` | 应用启动时清理 `multichat-*` 临时目录 |

---

### Task 1: 主进程 IPC — 临时文件写入

**Files:**
- Modify: `src/main/ipcHandlers.ts`

**上下文：** 此 handler 接收 markdown 内容，写入 `os.tmpdir()` 下的临时目录，返回文件路径供 uploadFile 使用。

- [ ] **Step 1: 导入所需模块**

在 `src/main/ipcHandlers.ts` 顶部现有 import 后添加：

```typescript
import { mkdtemp, writeFile, rm } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
```

- [ ] **Step 2: 注册 `write-temp-markdown` handler**

在 `registerIpcHandlers` 函数内，现有 IPC handler 之后添加：

```typescript
  // IPC 处理器：将内容写入临时 markdown 文件
  ipcMain.handle('write-temp-markdown', async (_event, params: {
    content: string
    fileName?: string
  }) => {
    try {
      const tempDir = await mkdtemp(join(tmpdir(), 'multichat-uploads-'))
      const fileName = params.fileName || `multichat-summary-${Date.now()}.md`
      const filePath = join(tempDir, fileName)
      await writeFile(filePath, params.content, 'utf-8')
      return { success: true, filePath }
    } catch (error) {
      return { success: false, error: String(error) }
    }
  })
```

- [ ] **Step 3: 验证导入和 handler 位置正确**

确认 `mkdtemp`、`writeFile`、`rm` 的导入位于文件顶部，handler 注册在 `registerIpcHandlers` 函数体内。

- [ ] **Step 4: Commit**

```bash
git add src/main/ipcHandlers.ts
git commit -m "feat: add write-temp-markdown IPC handler

Writes markdown content to os.tmpdir() for webview file upload fallback.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Preload 桥接 — 暴露 writeTempMarkdown

**Files:**
- Modify: `src/preload/index.ts`
- Modify: `src/preload/index.d.ts`

- [ ] **Step 1: 在 preload/index.ts 暴露 API**

在 `src/preload/index.ts` 的 `api` 对象中，现有 API 之后添加：

```typescript
  // 写入临时 markdown 文件
  writeTempMarkdown: (params: {
    content: string
    fileName?: string
  }): Promise<{ success: boolean; filePath?: string; error?: string }> =>
    ipcRenderer.invoke('write-temp-markdown', params),
```

- [ ] **Step 2: 在 preload/index.d.ts 添加类型声明**

在 `src/preload/index.d.ts` 的 `window.api` 接口中，现有方法之后添加：

```typescript
      writeTempMarkdown: (params: {
        content: string
        fileName?: string
      }) => Promise<{ success: boolean; filePath?: string; error?: string }>
```

- [ ] **Step 3: Commit**

```bash
git add src/preload/index.ts src/preload/index.d.ts
git commit -m "feat: expose writeTempMarkdown via preload bridge

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Core — useWebviewSummary 自适应逻辑

**Files:**
- Modify: `src/renderer/src/hooks/useWebviewSummary.ts`

**上下文：** 当前 `startSummary()` 直接调用 `ref.sendMessage(prompt)`。需要增加长度判断：短文本保持现有逻辑，长文本先写临时文件、上传、再发指令。

- [ ] **Step 1: 扩展 phase 类型和常量**

将文件顶部的常量和类型替换为：

```typescript
const POLL_INTERVAL_MS = 600
const STREAM_IDLE_TIMEOUT_MS = 4000
const STREAM_HARD_TIMEOUT_MS = 5 * 60 * 1000
const PAGE_READY_BUFFER_MS = 800
const FILE_UPLOAD_THRESHOLD = 8000  // 字符阈值，超过则使用文件上传

export type WebviewSummaryPhase =
  | 'idle'
  | 'loading-page'
  | 'uploading-file'
  | 'sending'
  | 'streaming'
  | 'done'
  | 'aborted'
  | 'error'
```

- [ ] **Step 2: 新增 `sendViaFileUpload` 辅助函数**

在 `useWebviewSummary` 函数体内、`startSummary` 之前添加：

```typescript
  const sendViaFileUpload = async (ref: WebviewCardRef, promptText: string): Promise<{ success: boolean; error?: string }> => {
    // 将提示词包装为 markdown 文件内容
    const markdownContent = `# MultiChat 模型回答汇总\n\n${promptText}`

    // 写入临时文件
    let filePath: string
    try {
      const writeResult = await window.api.writeTempMarkdown({ content: markdownContent })
      if (!writeResult.success || !writeResult.filePath) {
        return { success: false, error: writeResult.error || '写入临时文件失败' }
      }
      filePath = writeResult.filePath
    } catch (e) {
      return { success: false, error: `写入临时文件异常: ${String(e)}` }
    }

    // 获取文件信息
    let fileData: { filePath: string; fileName: string; mimeType: string; size: number }
    try {
      const infoResult = await window.api.getFileInfo(filePath)
      if (!infoResult.success || !infoResult.data) {
        return { success: false, error: infoResult.error || '获取文件信息失败' }
      }
      fileData = infoResult.data
    } catch (e) {
      return { success: false, error: `获取文件信息异常: ${String(e)}` }
    }

    // 上传文件到 webview
    setPhase('uploading-file')
    const uploadResult = await ref.uploadFile(fileData)
    if (!uploadResult.success) {
      return { success: false, error: uploadResult.error || '文件上传失败' }
    }

    // 上传成功后，发送分析指令
    const instruction = '请分析附件中的内容，按照其中的系统指令要求生成总结报告。'
    return await ref.sendMessage(instruction)
  }
```

- [ ] **Step 3: 修改 `startSummary` 增加长度判断和分支**

将现有的 `startSummary` 替换为：

```typescript
  const startSummary = useCallback(async () => {
    if (isRunningRef.current) return
    isRunningRef.current = true
    setError(null)
    setStreamingContent('')
    lastTextRef.current = ''
    lastChangeAtRef.current = 0
    consecutiveFailsRef.current = 0
    abortedRef.current = false
    setPhase('loading-page')

    const ref = webviewRef.current
    if (!ref) {
      isRunningRef.current = false
      setPhase('error')
      setError('webview ref 未就绪')
      return
    }

    await new Promise((r) => setTimeout(r, PAGE_READY_BUFFER_MS))
    if (abortedRef.current) {
      isRunningRef.current = false
      return
    }

    const prompt = buildPromptRef.current()
    const promptLength = prompt.length

    // 长文本：使用文件上传模式
    if (promptLength >= FILE_UPLOAD_THRESHOLD) {
      console.log(`[useWebviewSummary] 提示词长度 ${promptLength} >= 阈值 ${FILE_UPLOAD_THRESHOLD}，使用文件上传模式`)
      let sendResult: { success: boolean; error?: string }
      try {
        sendResult = await sendViaFileUpload(ref, prompt)
      } catch (e) {
        isRunningRef.current = false
        setPhase('error')
        setError((e as Error)?.message || '文件上传发送失败')
        return
      }
      if (!sendResult.success) {
        // 文件上传失败时，降级到直接粘贴
        console.warn(`[useWebviewSummary] 文件上传失败: ${sendResult.error}，降级到直接粘贴`)
        try {
          sendResult = await ref.sendMessage(prompt)
        } catch (e) {
          isRunningRef.current = false
          setPhase('error')
          setError((e as Error)?.message || '发送失败')
          return
        }
      }
      if (!sendResult.success) {
        isRunningRef.current = false
        setPhase('error')
        setError(sendResult.error || '发送失败')
        return
      }
      if (abortedRef.current) {
        isRunningRef.current = false
        return
      }

      setPhase('streaming')
      startedAtRef.current = Date.now()
      lastChangeAtRef.current = Date.now()
      scheduleNextPoll(ref)
      return
    }

    // 短文本：直接粘贴（原有逻辑）
    console.log(`[useWebviewSummary] 提示词长度 ${promptLength} < 阈值 ${FILE_UPLOAD_THRESHOLD}，使用直接粘贴模式`)
    setPhase('sending')
    let sendResult: { success: boolean; error?: string }
    try {
      sendResult = await ref.sendMessage(prompt)
    } catch (e) {
      isRunningRef.current = false
      setPhase('error')
      setError((e as Error)?.message || '发送失败')
      return
    }
    if (!sendResult.success) {
      isRunningRef.current = false
      setPhase('error')
      setError(sendResult.error || '发送失败')
      return
    }
    if (abortedRef.current) {
      isRunningRef.current = false
      return
    }

    setPhase('streaming')
    startedAtRef.current = Date.now()
    lastChangeAtRef.current = Date.now()
    scheduleNextPoll(ref)
  }, [webviewRef, scheduleNextPoll])
```

**注意：** `sendViaFileUpload` 在 Step 2 中已定义，且它内部调用了 `setPhase('uploading-file')`，所以不需要在 `startSummary` 中额外设置 phase。

- [ ] **Step 4: Commit**

```bash
git add src/renderer/src/hooks/useWebviewSummary.ts
git commit -m "feat: adaptive transmission in webview summary

Short text (< 8000 chars): direct paste. Long text: temp markdown file upload.
File upload failures automatically fall back to direct paste.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: UI — SummaryPanel 操作栏显示传输策略

**Files:**
- Modify: `src/renderer/src/components/SummaryPanel.tsx`

**上下文：** 在 webview 总结的操作栏中，根据 `webviewSummary.phase` 显示当前使用的传输方式，让用户知道系统在做什么。

- [ ] **Step 1: 在操作栏添加策略提示**

找到 `SummaryPanel.tsx` 中 webview 操作栏的 JSX（约第 971-991 行，在 `summarySource === 'webview'` 区域内）。将现有按钮区域替换为：

```tsx
          {/* 操作栏 */}
          <div className="shrink-0 flex items-center gap-2">
            {!webviewSummary.isGenerating ? (
              <button
                type="button"
                onClick={() => webviewSummary.startSummary()}
                disabled={selectedModels.length === 0}
                className="px-4 py-2 rounded bg-primary hover:bg-primary/90 text-black text-sm font-medium disabled:opacity-50"
              >
                开始 Webview 总结
              </button>
            ) : (
              <button
                type="button"
                onClick={() => webviewSummary.abortSummary()}
                className="px-4 py-2 rounded bg-red-600 hover:bg-red-700 text-white text-sm font-medium"
              >
                停止
              </button>
            )}
            <span className="text-xs text-gray-500">{`已选 ${selectedModels.length} 个模型`}</span>
            {/* 传输策略提示 */}
            {webviewSummary.phase === 'uploading-file' && (
              <span className="text-xs text-primary flex items-center gap-1">
                <span className="material-symbols-outlined text-sm">upload_file</span>
                正在上传文件...
              </span>
            )}
            {webviewSummary.phase === 'sending' && (
              <span className="text-xs text-gray-500 flex items-center gap-1">
                <span className="material-symbols-outlined text-sm">send</span>
                正在发送...
              </span>
            )}
            {webviewSummary.phase === 'streaming' && (
              <span className="text-xs text-gray-500 flex items-center gap-1">
                <span className="material-symbols-outlined text-sm">psychology</span>
                正在生成回复...
              </span>
            )}
          </div>
```

- [ ] **Step 2: Commit**

```bash
git add src/renderer/src/components/SummaryPanel.tsx
git commit -m "feat: show transmission strategy in webview summary UI

Displays uploading/sending/streaming phase indicators.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: 主进程 — 启动时清理临时目录

**Files:**
- Modify: `src/main/index.ts`

**上下文：** 临时文件写入 `os.tmpdir()` 后不会自动删除。在应用启动时清理所有 `multichat-uploads-*` 目录，避免磁盘堆积。

- [ ] **Step 1: 导入所需模块**

在 `src/main/index.ts` 顶部现有 import 之后添加：

```typescript
import { readdir, rm } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
```

- [ ] **Step 2: 添加清理函数并在 app ready 时调用**

在 `configureSessionPath()` 函数定义之后、`app.whenReady()` 之前添加：

```typescript
// 清理应用遗留的临时上传目录
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
  } catch (e) {
    console.warn('[Main] 读取临时目录失败:', e)
  }
}
```

然后在 `app.whenReady().then(() => {` 内的第一行（`electronApp.setAppUserModelId` 之前）添加：

```typescript
  // 清理遗留的临时文件
  void cleanupTempUploadDirs()
```

- [ ] **Step 3: Commit**

```bash
git add src/main/index.ts
git commit -m "feat: cleanup temp upload dirs on app startup

Removes multichat-uploads-* directories from os.tmpdir() at launch.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: 验证

- [ ] **Step 1: ESLint 检查**

```bash
npm run lint
```

Expected: 无错误，无新增 warning（现有 warning 可忽略）。

- [ ] **Step 2: TypeScript 构建检查**

```bash
npm run build
```

Expected: 构建成功，`out/` 目录生成，无类型错误。

- [ ] **Step 3: 开发环境手动验证**

```bash
npm run dev
```

验证场景：
1. 选择少量模型（如 1-2 个），发送一条短消息，切换到 SummaryPage → Webview 模式 → 点击"开始 Webview 总结"
   - 预期：phase 直接跳到 `sending` → `streaming`，console 中显示"使用直接粘贴模式"
2. 选择多个模型，发送一条长消息（或选择已有长回复的模型），切换到 SummaryPage → Webview 模式 → 点击"开始 Webview 总结"
   - 预期：phase 显示 `uploading-file`，UI 显示"正在上传文件..."，然后进入 `streaming`
   - console 中显示"提示词长度 X >= 阈值 8000，使用文件上传模式"
3. 文件上传失败的 fallback：人为制造失败（如临时断开网络后再点击总结，或在代码中临时把 `uploadFile` mock 为失败）
   - 预期：上传失败后自动降级到直接粘贴，console 中显示降级警告

- [ ] **Step 4: Commit（如有任何修复）**

```bash
git add -A
git commit -m "fix: address lint/build issues from adaptive transmission

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## 自审查

### Spec 覆盖检查

| Spec 要求 | 对应 Task |
|-----------|-----------|
| 阈值 8000 字符 | Task 3, Step 1 (`FILE_UPLOAD_THRESHOLD`) |
| 短文本直接粘贴 | Task 3, Step 3 (原有逻辑保留) |
| 长文本文件上传 | Task 3, Step 2-3 (`sendViaFileUpload`) |
| markdown 文件格式 | Task 3, Step 2 (`# MultiChat 模型回答汇总` 前缀) |
| XML 标签隔离 | 复用现有 `buildWebviewPrompt` 中的 `<model_output>` 标签 |
| 发送指令 | Task 3, Step 2 (`请分析附件中的内容...`) |
| uploading-file phase | Task 3, Step 1 + Task 4 |
| 文件上传失败 fallback | Task 3, Step 3 (降级到 `ref.sendMessage(prompt)`) |
| 临时文件清理 | Task 5 (`cleanupTempUploadDirs`) |
| UI 策略提示 | Task 4 |

### Placeholder 扫描

无 TBD、TODO、"implement later"、"add appropriate error handling"、"Similar to Task N"。

### 类型一致性检查

- `writeTempMarkdown` 的返回类型在 main (ipcHandlers)、preload (index.ts + index.d.ts) 中一致：`{ success: boolean; filePath?: string; error?: string }`
- `WebviewSummaryPhase` 在 Task 3 中扩展，`uploading-file` 值与 Task 4 中的条件判断一致
- `sendViaFileUpload` 返回类型与 `ref.sendMessage` 一致：`{ success: boolean; error?: string }`
