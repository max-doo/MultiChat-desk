# 快捷窗口 Webview 缓存 + 输入文本携带 实现计划

> Created: 2026-06-29 12:46 (+08:00)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 快捷窗口切换模型时保留已加载的 webview 页面状态（不重新加载），并将未发送的输入框文本自动携带到切换后的模型输入框中。

**Architecture:** 参考 MainPage 的 `mountedWebviews` + `display:none/block` 策略，将 QuickPage 从"单 webview 销毁重建"改为"多 webview 隐藏切换"。新增 `getInputText` 能力用于提取 webview 输入框中的未发送文本，在模型切换时先提取后注入。两个功能协同：缓存保证切换瞬间完成，文本携带保证未发送的输入不丢失。

**Tech Stack:** React 18, Electron webview, TypeScript, Zustand

---

## 文件变更总览

| 操作 | 文件 | 职责 |
|------|------|------|
| MODIFY | `src/shared/utils/webviewScripts.ts` | 新增 `generateGetInputTextScript` 导出函数 |
| MODIFY | `src/renderer/src/components/WebviewCard.tsx` | `WebviewCardRef` 新增 `getInputText` 方法 + 导入 + 实现 |
| MODIFY | `src/renderer/src/pages/QuickPage.tsx` | 核心重构：多 webview 缓存渲染 + 切换时文本携带 |

> [!NOTE]
> 本方案不涉及 IPC / preload / 主进程改动，所有变更限于渲染层。

---

### Task 1: 新增 `generateGetInputTextScript` 脚本生成函数

**Files:**
- Modify: `src/shared/utils/webviewScripts.ts` (在 `generateClearInputScript` 后追加)

- [ ] **Step 1: 在 `webviewScripts.ts` 中新增 `generateGetInputTextScript` 导出函数**

在 `generateClearInputScript` 函数（约 L1003-1026）结束后追加新函数。此函数复用已有的 `buildFindTextareaScript` 定位输入框，提取当前文本内容：

```ts
/**
 * 生成读取输入框当前文本内容的注入脚本
 * @param selectors 选择器配置
 */
export function generateGetInputTextScript(selectors: ModelSelector): string {
  const findTextarea = buildFindTextareaScript(selectors)

  return `
    (async function() {
      try {
        ${findTextarea}

        if (!textarea) {
          return { success: false, text: '', error: '未找到输入框' };
        }

        let text = '';
        try {
          if (textarea.value !== undefined && textarea.value !== '') {
            text = textarea.value;
          }
        } catch (e) {}

        if (!text) {
          text = textarea.innerText || textarea.textContent || '';
        }

        // 清理零宽字符
        text = (text || '').replace(/\\u200B/g, '').trim();

        return { success: true, text: text };
      } catch (error) {
        return { success: false, text: '', error: error.message };
      }
    })();
  `
}
```

> [!NOTE]
> 文本读取逻辑与 `generateSendMessageScript` 内部 of `readCurrentInputValue` (L902-907) 一致，但封装为独立导出函数以保持 DRY——`readCurrentInputValue` 是嵌在发送脚本中的局部函数，无法直接复用。

- [ ] **Step 2: 验证 lint**

Run: `npx eslint src/shared/utils/webviewScripts.ts --no-error-on-unmatched-pattern`
Expected: 无新增错误

- [ ] **Step 3: Commit**

```bash
git add src/shared/utils/webviewScripts.ts
git commit -m "feat: add generateGetInputTextScript for reading webview input text"
```

---

### Task 2: WebviewCardRef 新增 `getInputText` 方法

**Files:**
- Modify: `src/renderer/src/components/WebviewCard.tsx` (接口定义 + 导入 + 实现)

- [ ] **Step 1: 在导入语句中添加 `generateGetInputTextScript`**

在 `src/renderer/src/components/WebviewCard.tsx` 的导入区域（L7-16），找到从 `webviewScripts` 导入的块，添加新函数：

```ts
import {
  generateSendMessageScript,
  generateInsertTextScript,
  generateClearInputScript,
  generateGetInputTextScript,    // ← 新增
  generateEnableDeepResearchScript,
  generateDisableDeepResearchScript,
  generateEnableImageGenerationScript,
  generateDisableImageGenerationScript,
  generateGetLatestResponseScript,
```

- [ ] **Step 2: 在 `WebviewCardRef` 接口中添加 `getInputText` 方法**

在 `src/renderer/src/components/WebviewCard.tsx` L104-118 的 `WebviewCardRef` 接口中，在 `clearInput` 之后添加：

```ts
export interface WebviewCardRef {
  sendMessage: (message: string) => Promise<{ success: boolean; error?: string }>
  insertText: (message: string) => Promise<{ success: boolean; error?: string }>
  clearInput: () => Promise<{ success: boolean; error?: string }>
  getInputText: () => Promise<{ success: boolean; text?: string; error?: string }>  // ← 新增
  uploadFile: (fileData: FileUploadData) => Promise<{ success: boolean; error?: string }>
  // ... 其余不变
}
```

- [ ] **Step 3: 在 `useImperativeHandle` 中实现 `getInputText`**

在 `clearInput` 方法（约 L432-445）之后添加实现。遵循与 `clearInput` 相同的 guard 模式：

```ts
      /**
       * 读取输入框中的当前文本内容（不清空、不发送）
       */
      getInputText: async (): Promise<{ success: boolean; text?: string; error?: string }> => {
        const webview = webviewRef.current
        if (!webview || !isReady || !selectors) {
          return { success: false, text: '', error: 'Webview 未就绪' }
        }

        try {
          const code = generateGetInputTextScript(selectors)
          const result = await webview.executeJavaScript(code)
          return { success: result.success, text: result.text || '', error: result.error }
        } catch (error) {
          console.error(`[${name}] getInputText 异常:`, error)
          return { success: false, text: '', error: String(error) }
        }
      },
```

- [ ] **Step 4: 验证 lint**

Run: `npx eslint src/renderer/src/components/WebviewCard.tsx --no-error-on-unmatched-pattern`
Expected: 无新增错误

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/components/WebviewCard.tsx
git commit -m "feat: add getInputText method to WebviewCardRef interface"
```

---

### Task 3: QuickPage 重构 — 多 Webview 缓存 + 文本携带切换

**Files:**
- Modify: `src/renderer/src/pages/QuickPage.tsx` (核心改动)

这是最大的一个 Task，将 QuickPage 从"单 webview + key 销毁重建"改为"多 webview + display 切换 + 输入文本携带"。

- [ ] **Step 1: 更新导入和 Ref 类型**

在 `src/renderer/src/pages/QuickPage.tsx` L1-3，更新导入以支持多 ref 管理：

```ts
import React, { useEffect, useState, useRef, useCallback } from 'react'
import { useAppStore } from '../store/appStore'
import WebviewCard, { type WebviewCardRef } from '../components/WebviewCard'
```

- [ ] **Step 2: 替换状态管理——从单 ref 到多 ref + mountedModels**

将 QuickPage 组件内部的状态声明（L6-10）替换为：

```ts
export default function QuickPage(): JSX.Element {
  const { models, registerWebviewRef, unregisterWebviewRef } = useAppStore()
  const [selectedModelId, setSelectedModelId] = useState<string>('')
  const cardRefs = useRef<Map<string, WebviewCardRef>>(new Map())
  const isDraggingRef = useRef(false)
  const [isPinned, setIsPinned] = useState(false)

  // 已挂载的模型集合（只增不减，实现懒加载缓存）
  const [mountedModelIds, setMountedModelIds] = useState<Set<string>>(new Set())
  // 待注入到目标模型的文本（切换时携带）
  const pendingTextRef = useRef<string>('')
```

**关键设计决策：**
- `cardRefs` 从单个 ref 变为 `Map<modelId, WebviewCardRef>`，保持对所有已挂载 webview 的引用
- `mountedModelIds` 参考 MainPage 的 `mountedWebviews`，只增不减，确保已加载的 webview 不被销毁
- `pendingTextRef` 用于在切换间传递未发送的输入文本

- [ ] **Step 3: 添加 ref 回调工厂函数**

在状态声明之后、`useEffect` 块之前，添加 ref 回调：

```ts
  // 为每个模型生成稳定的 ref 回调
  const getCardRefCallback = useCallback((modelId: string) => {
    return (ref: WebviewCardRef | null) => {
      if (ref) {
        cardRefs.current.set(modelId, ref)
        registerWebviewRef(modelId, ref)
      } else {
        cardRefs.current.delete(modelId)
        unregisterWebviewRef(modelId)
      }
    }
  }, [registerWebviewRef, unregisterWebviewRef])
```

- [ ] **Step 4: 重写 `handleModelChange` 函数**

替换原有的 `handleModelChange`（L78-81）为带文本携带逻辑的新版本：

```ts
  const handleModelChange = async (newModelId: string): Promise<void> => {
    const oldModelId = selectedModelId

    // 1. 从当前 webview 提取未发送的输入文本
    if (oldModelId) {
      const oldRef = cardRefs.current.get(oldModelId)
      if (oldRef) {
        try {
          const result = await oldRef.getInputText()
          if (result.success && result.text) {
            pendingTextRef.current = result.text
            // 提取后清空原输入框，避免用户回切时看到重复内容
            await oldRef.clearInput()
          } else {
            pendingTextRef.current = ''
          }
        } catch {
          pendingTextRef.current = ''
        }
      }
    }

    // 2. 切换到新模型
    setSelectedModelId(newModelId)
    window.api.storeSet('quickModelId', newModelId)

    // 3. 确保新模型被加入已挂载集合
    setMountedModelIds(prev => {
      if (prev.has(newModelId)) return prev
      return new Set(prev).add(newModelId)
    })
  }
```

- [ ] **Step 5: 添加文本注入 effect——当目标 webview 就绪时注入待携带文本**

在 `handleModelChange` 之后添加 effect，监听 `selectedModelId` 变化以注入携带的文本：

```ts
  // 当选中模型变化且有待注入文本时，尝试注入到目标 webview
  useEffect(() => {
    if (!selectedModelId || !pendingTextRef.current) return

    const text = pendingTextRef.current
    pendingTextRef.current = '' // 立即清空，防止重复注入

    const tryInject = async (attempts = 0): Promise<void> => {
      if (attempts >= 20) {
        console.warn('[QuickPage] 文本携带注入超时')
        return
      }

      const ref = cardRefs.current.get(selectedModelId)
      if (ref) {
        const result = await ref.insertText(text)
        if (result.success) {
          console.log('[QuickPage] 成功携带文本到新模型输入框')
          return
        }
      }

      // webview 可能还未就绪，等待后重试
      await new Promise(r => setTimeout(r, 300))
      return tryInject(attempts + 1)
    }

    tryInject()
  }, [selectedModelId])
```

- [ ] **Step 6: 更新初始加载 effect**

修改"加载上次选中的快捷模型 ID" effect（L62-68），使其同时初始化 `mountedModelIds`：

```ts
  // 加载上次选中的快捷模型 ID
  useEffect(() => {
    window.api.storeGet('quickModelId').then((saved) => {
      if (saved && typeof saved === 'string') {
        setSelectedModelId(saved)
        setMountedModelIds(prev => new Set(prev).add(saved))
      }
    }).catch(() => {})
  }, [])
```

同时更新 fallback 初始化 effect（原 L72-76）：

```ts
  useEffect(() => {
    if (currentModel && !selectedModelId) {
      setSelectedModelId(currentModel.id)
      setMountedModelIds(prev => new Set(prev).add(currentModel.id))
    }
  }, [currentModel, selectedModelId])
```

- [ ] **Step 7: 更新 `injectTextWithRetry` 以使用 `cardRefs`**

修改 `injectTextWithRetry`（L84-96）以使用新的多 ref 结构。因为这个函数只在 `onQuickInject` 中使用，它应该向当前选中的模型注入：

```ts
  // 带重试机制的文本注入（确保 Webview 异步加载完成后能成功注入）
  const injectTextWithRetry = async (prompt: string, maxAttempts = 15): Promise<void> => {
    for (let i = 0; i < maxAttempts; i++) {
      const ref = cardRefs.current.get(selectedModelId || currentModel?.id || '')
      if (ref) {
        const res = await ref.insertText(prompt)
        if (res.success) {
          console.log('[QuickPage] 成功注入文本至网页输入框')
          return
        }
      }
      await new Promise(r => setTimeout(r, 500))
    }
    console.warn('[QuickPage] 注入文本超时或失败')
  }
```

> [!IMPORTANT]
> `injectTextWithRetry` 内部引用了 `selectedModelId`，由于该函数在 `useEffect` 的闭包中被调用，需要注意闭包捕获问题。但在当前实现中，`onQuickInject` listener 在组件挂载时注册一次且不随 `selectedModelId` 变化重新注册（L99-116 的 effect 无依赖 `selectedModelId`）。这里使用 `cardRefs.current.get(selectedModelId || currentModel?.id || '')` 中的 `selectedModelId` 会被闭包锁死为初始值。
>
> **解决方案**：将 `selectedModelId` 存入一个 ref 以保证闭包内始终获取最新值：
>
> 在状态声明区域添加：
> ```ts
> const selectedModelIdRef = useRef<string>('')
> ```
>
> 然后在 `handleModelChange` 和初始化 effect 中同步更新：
> ```ts
> selectedModelIdRef.current = newModelId
> ```
>
> `injectTextWithRetry` 中改用：
> ```ts
> const ref = cardRefs.current.get(selectedModelIdRef.current || currentModel?.id || '')
> ```

- [ ] **Step 8: 重写 JSX 渲染——多 webview 并存 + display 切换**

替换 L118-189 的整个 return 块：

```tsx
  return (
    <div className="h-screen w-screen overflow-hidden p-0">
      {models.length > 0 ? (
        <>
          {models.map((model) => {
            // 只渲染已挂载的模型
            if (!mountedModelIds.has(model.id)) return null

            const isActive = model.id === currentModel?.id

            return (
              <div
                key={model.id}
                style={{
                  display: isActive ? 'block' : 'none',
                  width: '100%',
                  height: '100%'
                }}
              >
                <WebviewCard
                  id={model.id}
                  name={model.name}
                  url={model.url}
                  logo={model.logo}
                  enabled={true}
                  slotIndex={0}
                  compact={true}
                  isolated={true}
                  draggableHeader={true}
                  flat={true}
                  onDragStart={() => {
                    isDraggingRef.current = true
                  }}
                  onModelChange={(modelId) => void handleModelChange(modelId)}
                  headerActions={
                    <div className="flex items-center gap-2 pl-2 border-l border-gray-200/60 ml-1 no-drag">
                      <button
                        type="button"
                        onClick={toggleAlwaysOnTop}
                        className={`w-7 h-7 flex items-center justify-center rounded-full transition-all duration-200 ${
                          isPinned 
                            ? 'text-primary bg-blue-50 hover:bg-blue-100' 
                            : 'text-text-secondary hover:text-text-primary hover:bg-gray-100'
                        }`}
                        title={isPinned ? '取消固定' : '固定窗口'}
                      >
                        <span 
                          className="material-symbols-outlined text-base"
                          style={isPinned ? { fontVariationSettings: "'FILL' 1" } : undefined}
                        >
                          push_pin
                        </span>
                      </button>
                      <button
                        type="button"
                        onClick={() => void window.api.trayShowMain()}
                        className="text-xs px-2.5 py-1 bg-gray-100 hover:bg-gray-200 border border-gray-200/60 rounded-md text-text-primary transition-all duration-200 flex items-center gap-1"
                        title="展开至主窗口"
                      >
                        <span className="material-symbols-outlined text-xs">open_in_new</span> 主界面
                      </button>
                      <button
                        type="button"
                        onClick={() => void window.api.quickHide()}
                        className="w-7 h-7 flex items-center justify-center text-text-secondary hover:text-red-500 hover:bg-red-50 rounded-full transition-all duration-200"
                        title="关闭"
                      >
                        ✕
                      </button>
                    </div>
                  }
                  ref={getCardRefCallback(model.id)}
                />
              </div>
            )
          })}
        </>
      ) : (
        <div className="flex items-center justify-center h-full text-text-secondary text-sm">
          暂无可用模型配置
        </div>
      )}
    </div>
  )
```

**关键变化点：**
- 移除 `key={currentModel.id}` 的强制重建机制
- 遍历 `models` 但只渲染 `mountedModelIds` 中的模型（懒加载）
- 通过 `display: isActive ? 'block' : 'none'` 切换可见性
- 每个 webview 使用 `model.id` 作为 `key`（稳定不变）
- ref 使用 `getCardRefCallback(model.id)` 而非内联回调

- [ ] **Step 9: 验证 lint**

Run: `npx eslint src/renderer/src/pages/QuickPage.tsx --no-error-on-unmatched-pattern`
Expected: 无新增错误

- [ ] **Step 10: Commit**

```bash
git add src/renderer/src/pages/QuickPage.tsx
git commit -m "feat: QuickPage webview caching + input text carry-over on model switch"
```

---

### Task 4: 构建验证 + 手动测试

- [ ] **Step 1: 全量 lint 检查**

Run: `npm run lint`
Expected: 无新增错误/警告

- [ ] **Step 2: 构建检查**

Run: `npm run build`
Expected: 构建成功，无类型错误

- [ ] **Step 3: 手动验证 — 启动开发环境**

Run: `npm run dev`

**验证清单：**

| # | 测试场景 | 预期结果 |
|---|---------|---------|
| 1 | 打开快捷窗口，选择模型 A | 模型 A 正常加载 |
| 2 | 在模型 A 输入框中输入一段文字（不发送） | 文字显示在输入框中 |
| 3 | 切换到模型 B | 模型 B 加载，且模型 A 的文字出现在模型 B 的输入框中 |
| 4 | 切回模型 A | 模型 A 的页面仍然保留（对话没丢），输入框已清空（文字被携带走了） |
| 5 | 在模型 B 输入一些新文字，切换到模型 C | 模型 C 输入框出现模型 B 的文字 |
| 6 | 连续快速切换 3 个模型 | 不崩溃，最后一个模型正常显示 |
| 7 | 工具栏触发快捷窗口注入文本 | 文本正确注入到当前选中的模型 |
| 8 | 关闭快捷窗口再重新打开 | 上次选中的模型仍然显示，缓存的 webview 仍在 |

- [ ] **Step 4: Commit 最终确认**

```bash
git add -A
git commit -m "chore: verify quick window caching and text carry-over"
```

---

## 验证计划

### 自动化检查
- `npm run lint` — ESLint 全量检查
- `npm run build` — TypeScript 类型检查 + 构建

### 手动验证
- `npm run dev` — 桌面环境下按 Task 4 Step 3 中的验证清单逐项测试
- 重点关注：
  - 内存占用变化（任务管理器观察 webview 进程数）
  - 文本携带在不同 AI 平台间的兼容性（contenteditable vs textarea）
  - 快捷窗口隐藏后再显示时缓存 webview 的状态
