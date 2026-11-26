# Webview 总结模式 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 SummaryPage 既能用 OpenAI 兼容 API 总结（现有），也能用嵌入的厂商 Webview 总结（新），用户在面板上一键切换。

**Architecture:** 总结面板顶部加 `API / Webview` 模式开关；Webview 模式下面板内嵌一个独立的 `WebviewCard`，新建 `useWebviewSummary` hook 负责"loadURL → 注入 prompt → 轮询抓取 → DOM diff 流式 → 静默判定完成"。两条数据流路径独立，UI 状态共用同一组 messages / streamingContent。

**Tech Stack:** Electron 28 + React 18 + TypeScript（strict）+ Tailwind 3 + Zustand 4，复用现有 `WebviewCard`、`generateSendMessageScript`、`generateGetLatestResponseScript`、`turndown`。

**关联设计文档**：`docs/superpowers/specs/2026-05-03-webview-summary-design.md`

**项目验证方式**：本仓库未配置 test runner（见 `CLAUDE.md`）。每个 Task 的验收 = `npm run lint` 通过 + 必要时 `npm run dev` 手动验证。最终 Task 6 跑 `npm run build` 整体把关。

---

## 文件结构概览

新增：
- `src/renderer/src/hooks/useWebviewSummary.ts` — Webview 总结 hook

修改：
- `src/renderer/src/config/selectors.ts` — 各平台加 `newConversationUrl`
- `src/renderer/src/store/appStore.ts` — `ApiConfig` 加 `summarySource / lastWebviewSummaryPlatform`；`SummaryHistoryItem` 加 `summarySource / webviewPlatformId`
- `src/renderer/src/components/SummaryPanel.tsx` — 顶部模式开关、Webview 模式下 UI 分支、嵌入 `WebviewCard`
- `src/renderer/src/components/SummaryHistoryDrawer.tsx` — 条目右上角按 `summarySource` 加小标签
- `src/renderer/src/types/summary.ts`（如有需要） — 共享类型

不修改：
- `src/preload/index.d.ts`、`src/main/**`（Webview 模式纯渲染层）
- `useSummaryPanel.ts`（保持 API 模式不变，由 `SummaryPanel` 同时调两个 hook 分流）

---

## Task 1: 类型与配置扩展

**Files:**
- Modify: `src/renderer/src/config/selectors.ts:7-46`
- Modify: `src/renderer/src/config/selectors.ts:64-271`（11 个平台条目各加一个字段）
- Modify: `src/renderer/src/store/appStore.ts:46-59`（ApiConfig）
- Modify: `src/renderer/src/store/appStore.ts:72-94`（SummaryHistoryItem）

- [ ] **Step 1: 在 ModelSelector 接口加 newConversationUrl**

修改 `src/renderer/src/config/selectors.ts` 顶部 `ModelSelector` 接口，在 `customCSS` 字段附近加：

```ts
export interface ModelSelector {
  textarea: string[]
  sendButton: string[]
  messageContainer: string[]
  reportContainer?: string[]
  customCSS: string
  /** Webview 总结模式专用：打开此 URL 进入一个全新的对话页 */
  newConversationUrl?: string
  researchMode?: { /* 不变 */ }
}
```

- [ ] **Step 2: 给 11 个平台填入 newConversationUrl**

在每个平台条目末尾（`customCSS` 之后或 `researchMode` 之后）加一行 `newConversationUrl`，按下表填：

| 平台 | URL |
|---|---|
| chatgpt | `https://chat.openai.com/?temporary-chat=true` |
| perplexity | `https://www.perplexity.ai/` |
| claude | `https://claude.ai/new` |
| chatglm | `https://chatglm.cn/main/alltoolsdetail` |
| yiyan | `https://yiyan.baidu.com/` |
| gemini | `https://gemini.google.com/app` |
| grok | `https://grok.com/` |
| qwen | `https://chat.qwen.ai/` |
| kimi | `https://www.kimi.com/` |
| doubao | `https://www.doubao.com/chat/` |
| yuanbao | `https://yuanbao.tencent.com/chat` |

例（chatgpt）：

```ts
chatgpt: {
  textarea: [...],
  sendButton: [...],
  messageContainer: [...],
  customCSS: `...`,
  newConversationUrl: 'https://chat.openai.com/?temporary-chat=true',
  researchMode: { /* 原内容 */ }
},
```

注意：在记得在最近一次发布的 `version` 字段处把它 +1（当前 `version: 8` → 改 `version: 9`），并刷新 `lastUpdated`。`getSelectors()` 用 version 比较来决定是否覆盖本地存储——不升 version 老用户读不到新字段。

- [ ] **Step 3: 扩展 ApiConfig**

在 `src/renderer/src/store/appStore.ts:46-59` 的 `ApiConfig` 接口里加两个可选字段：

```ts
export interface ApiConfig {
  providers: ApiProvider[]
  activeProviderId?: string
  lastSelectedAgentId?: string
  agentPrompts?: AgentPrompt[]
  exportDirectory?: string
  systemPrompt?: string
  temperature?: number
  topP?: number
  maxTokens?: number
  includeReasoning?: boolean
  contextRounds?: number
  favoriteModelIds?: string[]
  /** 'api'（接 OpenAI 兼容）或 'webview'（嵌入式厂商页面） */
  summarySource?: 'api' | 'webview'
  /** Webview 模式下上次选中的目标平台 id */
  lastWebviewSummaryPlatform?: string
}
```

不需要写 migration 代码——这两个字段都是可选的，旧 store 读出来 `undefined`，UI 层用默认值 `'api'` / `'chatgpt'` 兜底。

- [ ] **Step 4: 扩展 SummaryHistoryItem**

在 `src/renderer/src/store/appStore.ts:72-94` 的 `SummaryHistoryItem` 接口里加两个可选字段：

```ts
export interface SummaryHistoryItem {
  id: string
  title: string
  timestamp: number
  messages: Array<{ /* 原内容 */ }>
  selectedModels: string[]
  modelResponses?: Record<string, string>
  /** 'api' 或 'webview'，缺省视为 'api'（兼容旧记录） */
  summarySource?: 'api' | 'webview'
  /** summarySource = 'webview' 时记录目标平台 id */
  webviewPlatformId?: string
}
```

- [ ] **Step 5: lint 验证**

运行：

```
npm run lint
```

期望：无错误（`@typescript-eslint/no-explicit-any` 等不报警）。如果某处旧代码因新增字段出现"未处理"警告，按本次任务范围只修因本次改动直接引入的。

- [ ] **Step 6: 提交**

```
git add src/renderer/src/config/selectors.ts src/renderer/src/store/appStore.ts
git commit -m "feat: extend types and selectors for webview summary mode"
```

---

## Task 2: 新增 useWebviewSummary hook

**Files:**
- Create: `src/renderer/src/hooks/useWebviewSummary.ts`

- [ ] **Step 1: 写 hook 骨架**

新建 `src/renderer/src/hooks/useWebviewSummary.ts`，写入以下内容（可作完整初版直接保存，注释里描述每段职责）：

```ts
import { useRef, useState, useCallback } from 'react'
import type { WebviewCardRef } from '../components/WebviewCard'
import type { ChatMessage } from '../types/summary'

const POLL_INTERVAL_MS = 600
const STREAM_IDLE_TIMEOUT_MS = 4000
const STREAM_HARD_TIMEOUT_MS = 5 * 60 * 1000
const PAGE_READY_TIMEOUT_MS = 5000
const PAGE_READY_BUFFER_MS = 800

export type WebviewSummaryPhase =
  | 'idle'
  | 'loading-page'
  | 'sending'
  | 'streaming'
  | 'done'
  | 'aborted'
  | 'error'

interface UseWebviewSummaryParams {
  webviewRef: React.RefObject<WebviewCardRef>
  /** 用户在 SummaryPanel 上选择的目标平台 id（chatgpt / claude / ...） */
  targetPlatformId: string
  /** 复用 useSummaryPanel 已经拼好的 system + user 三明治内容，外层负责拼接 */
  buildPrompt: () => string
  /** 完成时落库一条 assistant 消息；user 消息由外层负责（与 API 模式一致） */
  onAssistantMessage: (msg: ChatMessage) => void
}

interface UseWebviewSummaryReturn {
  phase: WebviewSummaryPhase
  isGenerating: boolean
  streamingContent: string
  error: string | null
  startSummary: () => Promise<void>
  abortSummary: () => void
}

export function useWebviewSummary({
  webviewRef,
  targetPlatformId: _targetPlatformId,
  buildPrompt,
  onAssistantMessage
}: UseWebviewSummaryParams): UseWebviewSummaryReturn {
  const [phase, setPhase] = useState<WebviewSummaryPhase>('idle')
  const [streamingContent, setStreamingContent] = useState('')
  const [error, setError] = useState<string | null>(null)

  const intervalRef = useRef<number | null>(null)
  const lastTextRef = useRef('')
  const lastChangeAtRef = useRef(0)
  const startedAtRef = useRef(0)
  const consecutiveFailsRef = useRef(0)
  const abortedRef = useRef(false)

  const cleanupPolling = () => {
    if (intervalRef.current !== null) {
      clearInterval(intervalRef.current)
      intervalRef.current = null
    }
  }

  const finish = useCallback((kind: 'done' | 'aborted') => {
    cleanupPolling()
    const finalText = lastTextRef.current
    if (finalText && kind === 'done') {
      onAssistantMessage({
        id: `webview-${Date.now()}`,
        role: 'assistant',
        content: finalText,
        timestamp: Date.now()
      } as ChatMessage)
    }
    setPhase(kind)
  }, [onAssistantMessage])

  const startSummary = useCallback(async () => {
    if (phase === 'streaming' || phase === 'sending' || phase === 'loading-page') return
    setError(null)
    setStreamingContent('')
    lastTextRef.current = ''
    lastChangeAtRef.current = 0
    consecutiveFailsRef.current = 0
    abortedRef.current = false
    setPhase('loading-page')

    // 等 webview 就绪：调用方在切平台后已经触发了 loadURL，这里只确保 ref 在
    const ref = webviewRef.current
    if (!ref) {
      setPhase('error')
      setError('webview ref 未就绪')
      return
    }

    // 简单等一段缓冲（dom-ready 已经由 WebviewCard 内部触发 isReady=true）
    await new Promise(r => setTimeout(r, PAGE_READY_BUFFER_MS))
    if (abortedRef.current) return

    setPhase('sending')
    const prompt = buildPrompt()
    let sendResult: { success: boolean; error?: string }
    try {
      sendResult = await ref.sendMessage(prompt)
    } catch (e) {
      setPhase('error')
      setError((e as Error)?.message || '发送失败')
      return
    }
    if (!sendResult.success) {
      setPhase('error')
      setError(sendResult.error || '发送失败')
      return
    }
    if (abortedRef.current) return

    setPhase('streaming')
    startedAtRef.current = Date.now()
    lastChangeAtRef.current = Date.now()
    intervalRef.current = window.setInterval(async () => {
      if (abortedRef.current) return
      const now = Date.now()
      try {
        const result = await ref.getLatestResponse()
        const current = (result?.content || '').trim()
        if (current && current !== lastTextRef.current) {
          if (current.length >= lastTextRef.current.length && current.startsWith(lastTextRef.current)) {
            // 增量
            lastTextRef.current = current
            setStreamingContent(current)
          } else {
            // 整段重写（少数平台流式中途回填整段）
            lastTextRef.current = current
            setStreamingContent(current)
          }
          lastChangeAtRef.current = now
          consecutiveFailsRef.current = 0
        }
      } catch (e) {
        consecutiveFailsRef.current += 1
        if (consecutiveFailsRef.current >= 5) {
          cleanupPolling()
          setPhase('error')
          setError('无法读取回复内容，请确认是否已登录该平台')
          return
        }
      }

      if (lastTextRef.current && now - lastChangeAtRef.current > STREAM_IDLE_TIMEOUT_MS) {
        finish('done')
        return
      }
      if (now - startedAtRef.current > STREAM_HARD_TIMEOUT_MS) {
        finish('done')
      }
    }, POLL_INTERVAL_MS)
  }, [phase, webviewRef, buildPrompt, finish])

  const abortSummary = useCallback(() => {
    if (intervalRef.current === null && phase !== 'sending' && phase !== 'loading-page') return
    abortedRef.current = true
    cleanupPolling()
    setPhase('aborted')
  }, [phase])

  const isGenerating = phase === 'loading-page' || phase === 'sending' || phase === 'streaming'

  return { phase, isGenerating, streamingContent, error, startSummary, abortSummary }
}
```

- [ ] **Step 2: lint 验证**

```
npm run lint -- src/renderer/src/hooks/useWebviewSummary.ts
```

期望：无错误。如果有"未使用变量"警告（如 `_targetPlatformId`），保持 `_` 前缀按项目规则即可。

- [ ] **Step 3: 提交**

```
git add src/renderer/src/hooks/useWebviewSummary.ts
git commit -m "feat: add useWebviewSummary hook for webview-driven summary"
```

---

## Task 3: SummaryPanel 加模式开关 UI

**Files:**
- Modify: `src/renderer/src/components/SummaryPanel.tsx:35-50`（顶部 hook 调用）
- Modify: `src/renderer/src/components/SummaryPanel.tsx:188-220`（头部 UI 区域）

- [ ] **Step 1: 在 SummaryPanel 顶部加模式状态读取**

在 `SummaryPanel` 函数体顶部（约 35 行 `function SummaryPanel(...)` 之后）追加：

```tsx
const summarySource: 'api' | 'webview' = apiConfig.summarySource ?? 'api'
const lastWebviewPlatform = apiConfig.lastWebviewSummaryPlatform ?? 'chatgpt'
const [webviewPlatformId, setWebviewPlatformId] = useState<string>(lastWebviewPlatform)

const setSummarySource = (next: 'api' | 'webview') => {
  setApiConfig({ ...apiConfig, summarySource: next })
}
const setLastWebviewPlatform = (id: string) => {
  setWebviewPlatformId(id)
  setApiConfig({ ...apiConfig, lastWebviewSummaryPlatform: id })
}
```

`setApiConfig` 已经从 `useAppStore()` 解构出来；如果没有，加到现有解构里：

```ts
const { apiConfig, setApiConfig } = useAppStore()
```

（`apiConfig` 在 35 行之后已经引用，确认 `setApiConfig` 一并解构。）

- [ ] **Step 2: 在头部 UI 加模式开关**

在 `SummaryPanel.tsx:189` 的"头部：供应商和模型选择"`<div>` 之前插入：

```tsx
{/* 模式开关：API / Webview */}
<div className="flex items-center gap-1 mb-3 shrink-0 bg-gray-800 border border-gray-700 rounded-md p-1 w-fit">
  <button
    type="button"
    onClick={() => setSummarySource('api')}
    className={`px-3 py-1 text-xs rounded transition-colors ${
      summarySource === 'api' ? 'bg-primary text-white' : 'text-gray-400 hover:text-white'
    }`}
  >
    API
  </button>
  <button
    type="button"
    onClick={() => setSummarySource('webview')}
    className={`px-3 py-1 text-xs rounded transition-colors ${
      summarySource === 'webview' ? 'bg-primary text-white' : 'text-gray-400 hover:text-white'
    }`}
  >
    Webview
  </button>
</div>
```

- [ ] **Step 3: 把现有"供应商 + 模型选择"区域包到 API 模式分支**

把 `SummaryPanel.tsx:188` 起的`{/* 头部：供应商和模型选择 */}` 整段（截至 `</div>` 闭合）外面包一层条件：

```tsx
{summarySource === 'api' && (
  <div className="flex items-center gap-2 relative shrink-0 mb-4">
    {/* 原内容不变 */}
  </div>
)}
```

并在它之后添加 Webview 模式的平台选择 UI：

```tsx
{summarySource === 'webview' && (
  <div className="flex items-center gap-2 relative shrink-0 mb-4">
    <CustomDropdown
      value={webviewPlatformId}
      onChange={(id) => setLastWebviewPlatform(id)}
      placeholder="选择平台"
      className="min-w-[120px]"
      dropdownWidth="min-w-[200px]"
      buttonClassName="w-full px-3 py-1.5 rounded-md text-sm flex items-center justify-between gap-2 bg-primary/10 border border-primary/50 text-primary hover:border-primary"
      displayText={models.find(m => m.id === webviewPlatformId)?.name || '选择平台'}
      renderContent={(onClose) => (
        <>
          {models.map(m => (
            <button
              key={m.id}
              onClick={() => { setLastWebviewPlatform(m.id); onClose() }}
              className={`block w-full px-3 py-2 text-left text-sm transition-colors hover:bg-gray-700 ${
                webviewPlatformId === m.id ? 'text-primary bg-primary/5' : 'text-gray-300'
              }`}
            >
              {m.name}
            </button>
          ))}
        </>
      )}
    />
  </div>
)}
```

注意 `models` 已经从 `useAppStore()` 解构（约 35 行附近），如未解构请加上。

- [ ] **Step 4: lint 验证**

```
npm run lint
```

- [ ] **Step 5: 启动 dev 手动检查**

```
npm run dev
```

打开应用 → 进入总结页面 → 顶部应该看到 `[API | Webview]` 切换按钮；切到 Webview 时下面出现平台选择下拉。**此时还不能真的总结**——业务逻辑在下一个 Task。验证 UI 出现即可。

- [ ] **Step 6: 提交**

```
git add src/renderer/src/components/SummaryPanel.tsx
git commit -m "feat: add api/webview mode switch in SummaryPanel"
```

---

## Task 4: SummaryPanel 嵌入 WebviewCard + 联调 useWebviewSummary

**Files:**
- Modify: `src/renderer/src/components/SummaryPanel.tsx`（多处）

- [ ] **Step 1: 在 SummaryPanel 顶部 import 与 ref**

在文件顶部 import 区追加：

```ts
import WebviewCard, { WebviewCardRef } from './WebviewCard'
import { useWebviewSummary } from '../hooks/useWebviewSummary'
import { defaultSelectors } from '../config/selectors'
```

在 SummaryPanel 函数体内（约 `useState<webviewPlatformId>` 之后）加：

```ts
const webviewSummaryRef = useRef<WebviewCardRef>(null)

// 用于 useWebviewSummary：当前选中平台的展示名 / URL / 选择器
const webviewPlatformInfo = useMemo(() => {
  const m = models.find(x => x.id === webviewPlatformId)
  const sel = defaultSelectors.models[webviewPlatformId]
  return {
    name: m?.name || webviewPlatformId,
    logo: m?.logo,
    url: sel?.newConversationUrl || m?.url || ''
  }
}, [models, webviewPlatformId])
```

确保 `useRef` 与 `useMemo` 已 import。

- [ ] **Step 2: 接 useWebviewSummary hook**

在 useSummaryPanel 解构之后追加：

```ts
const buildWebviewPrompt = useCallback(() => {
  // 复用三明治结构：systemPrompt + 模型回答 + 用户要求 → 单段纯文本
  const agentTemplate = (apiConfig.agentPrompts || []).find(a => a.id === selectedAgent)
  const systemPrompt = agentTemplate?.prompt || apiConfig.systemPrompt || ''
  const contextBlock = selectedModels
    .map(id => {
      const name = models.find(m => m.id === id)?.name || id
      const content = modelResponses[id] || ''
      return `<model_output name="${name}">\n${content}\n</model_output>`
    })
    .join('\n')
  const requirement = customPrompt?.trim() || '请生成标准总结报告。'
  return [
    '[系统指令]',
    systemPrompt,
    '',
    '[待分析内容]',
    '<context>',
    contextBlock,
    '</context>',
    '',
    '[用户要求]',
    requirement
  ].join('\n')
}, [selectedAgent, apiConfig.agentPrompts, apiConfig.systemPrompt, selectedModels, models, modelResponses, customPrompt])

const handleWebviewAssistantMessage = useCallback((msg: ChatMessage) => {
  // 复用 useSummaryPanel 内部已有的 messages setter；这里简化为通过 store 落库历史
  // 实际方案：把 useSummaryPanel 的 setMessages / persistSummaryHistory 暴露出来
  // —— 见 Step 3
}, [])

const webviewSummary = useWebviewSummary({
  webviewRef: webviewSummaryRef,
  targetPlatformId: webviewPlatformId,
  buildPrompt: buildWebviewPrompt,
  onAssistantMessage: handleWebviewAssistantMessage
})
```

- [ ] **Step 3: 把 useSummaryPanel 的 messages 入口暴露给 webview 模式**

打开 `src/renderer/src/hooks/useSummaryPanel.ts`，在 return 对象末尾追加（其他字段保持不变）：

```ts
return {
  /* ... existing fields ... */
  setMessages,
  persistSummaryHistory,
}
```

回到 `SummaryPanel.tsx`，在 useSummaryPanel 解构里加上 `setMessages, persistSummaryHistory`，并修改 `handleWebviewAssistantMessage`：

```ts
const handleWebviewAssistantMessage = useCallback((msg: ChatMessage) => {
  // 把刚生成的 assistant 消息推入 messages，并落库（标 webview）
  const userMsg: ChatMessage = {
    id: `webview-user-${Date.now() - 1}`,
    role: 'user',
    content: customPrompt || '请生成标准总结报告。',
    timestamp: Date.now() - 1
  } as ChatMessage
  const next = [userMsg, msg]
  setMessages(prev => [...prev, ...next])
  // 持久化时附加 summarySource / webviewPlatformId
  persistSummaryHistory([...messages, ...next], {
    summarySource: 'webview',
    webviewPlatformId
  })
}, [customPrompt, messages, setMessages, persistSummaryHistory, webviewPlatformId])
```

`persistSummaryHistory` 现签名只接 `source` 一个参数。需要扩展为接收第二个 optional 参数：

打开 `useSummaryPanel.ts:77` 的 `persistSummaryHistory` 函数签名改为：

```ts
const persistSummaryHistory = (
  source: ChatMessage[],
  extra?: { summarySource?: 'api' | 'webview'; webviewPlatformId?: string }
) => {
  if (source.length === 0) return
  const title = getSummaryTitle(source)
  // ... existing body ...
  // 在最终 addSummaryHistory / updateSummaryHistory 调用处合并 extra：
  // addSummaryHistory({ ...item, ...extra })
}
```

注意：现有 `persistSummaryHistory` 落库逻辑里有 `addSummaryHistory` 与 `updateSummaryHistory` 两条分支（看具体 76-160 行），两处都要把 `extra` 字段合并进去。

- [ ] **Step 4: Webview 模式的右侧布局**

把 SummaryPanel 现有"右侧 streamingContent / messages"主体（约 320 行起）外层加条件，并新增 Webview 模式的并列分支。

简化思路：原来主体在 `<div className="flex-1 ...">` 里。把它拆成两个分支：

```tsx
{summarySource === 'api' && (
  <div className="flex-1 flex flex-col overflow-hidden">
    {/* 原 messages + streamingContent + 发送框 区域，不动 */}
  </div>
)}

{summarySource === 'webview' && (
  <div className="flex-1 flex flex-col overflow-hidden gap-3">
    {/* 上半：streamingContent / messages 镜像区 */}
    <div className="flex-1 min-h-[200px] overflow-y-auto bg-gray-900/40 rounded p-3 text-sm text-gray-200">
      {webviewSummary.error && (
        <div className="text-red-400 mb-2">{webviewSummary.error}</div>
      )}
      {webviewSummary.streamingContent ? (
        <pre className="whitespace-pre-wrap font-sans">{webviewSummary.streamingContent}</pre>
      ) : (
        <div className="text-gray-500 text-xs">
          {webviewSummary.phase === 'idle' && '点击下方"开始 Webview 总结"'}
          {webviewSummary.phase === 'loading-page' && '正在加载平台页面...'}
          {webviewSummary.phase === 'sending' && '正在注入 prompt...'}
          {webviewSummary.phase === 'streaming' && '等待回复...'}
          {webviewSummary.phase === 'done' && '已完成'}
          {webviewSummary.phase === 'aborted' && '已停止'}
        </div>
      )}
    </div>

    {/* 下半：嵌入的 WebviewCard */}
    <div className="flex-[2] min-h-[300px]">
      <WebviewCard
        ref={webviewSummaryRef}
        id={`summary-${webviewPlatformId}`}
        name={webviewPlatformInfo.name}
        url={webviewPlatformInfo.url}
        logo={webviewPlatformInfo.logo || ''}
        enabled={true}
        slotIndex={0}
      />
    </div>

    {/* 操作栏 */}
    <div className="shrink-0 flex items-center gap-2">
      {!webviewSummary.isGenerating ? (
        <button
          type="button"
          onClick={() => webviewSummary.startSummary()}
          disabled={selectedModels.length === 0}
          className="px-4 py-2 rounded bg-primary hover:bg-primary/90 text-white text-sm disabled:opacity-50"
        >
          开始 Webview 总结
        </button>
      ) : (
        <button
          type="button"
          onClick={() => webviewSummary.abortSummary()}
          className="px-4 py-2 rounded bg-red-600 hover:bg-red-700 text-white text-sm"
        >
          停止
        </button>
      )}
      <span className="text-xs text-gray-500">{`已选 ${selectedModels.length} 个模型`}</span>
    </div>
  </div>
)}
```

注意：若 `WebviewCard` 的 `id` 与 MainPage 上同平台 `id` 相同，会造成 `webviewRefs` 注册冲突——本设计用 `summary-${platform}` 前缀避开。需要在 `WebviewCard` 内部确认 `registerWebviewRef` 用的就是这个 props.id（**已确认是 props.id**，见 `MainPage.tsx:303`）。

- [ ] **Step 5: lint 验证**

```
npm run lint
```

修复任何因引入 `useCallback` `useMemo` 等未在 import 列表里的报错。

- [ ] **Step 6: 启动 dev 手动联调（ChatGPT）**

```
npm run dev
```

操作步骤：
1. 在 MainPage 用 ChatGPT 等多个平台对同一问题获取回答
2. 点"生成报告"进入 SummaryPage
3. 顶部切到 Webview 模式
4. 平台选 ChatGPT
5. 点"开始 Webview 总结"

期望：
- 嵌入 webview 加载到 ChatGPT 的临时对话页
- 自动注入 prompt 并发送
- streamingContent 镜像区随 ChatGPT 输出每秒左右增量更新
- ChatGPT 输出完毕约 4 秒后判定完成，进入 messages 列表
- 不影响 MainPage 的 ChatGPT 对话

如果某个步骤卡住，按 spec 第 11 节的"已识别风险"逐项排查。

- [ ] **Step 7: 提交**

```
git add src/renderer/src/components/SummaryPanel.tsx src/renderer/src/hooks/useSummaryPanel.ts
git commit -m "feat: wire webview summary into SummaryPanel with embedded WebviewCard"
```

---

## Task 5: 历史记录标签

**Files:**
- Modify: `src/renderer/src/components/SummaryHistoryDrawer.tsx`

- [ ] **Step 1: 在 Drawer 条目右上角加标签**

打开 `SummaryHistoryDrawer.tsx`，找到渲染单条 history item 的 JSX（每条记录的 `<button>` 或 `<div>`），在标题旁/右上角加：

```tsx
{item.summarySource === 'webview' && (
  <span className="ml-2 px-1.5 py-0.5 text-[10px] rounded bg-blue-500/20 text-blue-300 border border-blue-500/40">
    Webview · {item.webviewPlatformId || '未知'}
  </span>
)}
```

可选：API 模式的旧记录不显示标签（缺省即可）。

- [ ] **Step 2: lint + dev 手动验证**

```
npm run lint
npm run dev
```

验证：
- 跑一次 Webview 模式总结后，进入 SummaryPage 历史抽屉，刚生成的条目应有"Webview · chatgpt" 标签
- 旧 API 记录无标签

- [ ] **Step 3: 提交**

```
git add src/renderer/src/components/SummaryHistoryDrawer.tsx
git commit -m "feat: tag webview summary entries in history drawer"
```

---

## Task 6: 端到端验证 + Changelog

**Files:**
- Modify: `CHANGELOG.md`

- [ ] **Step 1: 全量 lint 与 build**

```
npm run lint
npm run build
```

期望：两个命令都通过，无 strict mode 警告。

- [ ] **Step 2: 手动验证 3 个平台**

```
npm run dev
```

逐个跑通 ChatGPT / Claude / Gemini：
- 每个平台都从一次新会话开始
- streamingContent 镜像有内容更新
- 4 秒静默后判定完成
- 落入 messages 与历史记录
- 标签正确显示

发现哪个平台不稳定，回到 `useWebviewSummary.ts` 顶部调整 `STREAM_IDLE_TIMEOUT_MS`（4000 → 6000 / 8000），单独 commit 一个调参 patch。

- [ ] **Step 3: API 模式回归**

不切到 Webview 模式，跑一次 API 模式总结，确认：
- 无任何行为变化
- 历史记录无 summarySource（缺省视为 'api'）

- [ ] **Step 4: 写 Changelog**

按 `CLAUDE.md` 末尾"Changelog"约定，在 `CHANGELOG.md` 顶部追加（用本日日期 `## 2026-05-03`）：

```
## 2026-05-03
HH:MM | feat: src/renderer - 总结页面新增 Webview 模式（保留 API 模式），可选 11 个平台之一直接在面板内嵌 webview 完成总结
```

`HH:MM` 用实际本地时间。

- [ ] **Step 5: 最终提交**

```
git add CHANGELOG.md
git commit -m "chore: changelog for webview summary mode"
```

---

## Self-Review

执行完上述 Task 后做以下检查：

1. **Spec 覆盖**：spec 第 1.2 节"包含"项每条对应到上面哪个 Task：
   - 模式开关 → Task 3
   - 嵌入 WebviewCard → Task 4
   - 单次总结全流程 → Task 2 + 4
   - 取消、超时 → Task 2
   - 历史记录字段 → Task 1, 4, 5

2. **占位符扫描**：本计划无 "TBD/TODO/补充实现" 等空缺。Step 中描述"按本次任务范围只修因本次改动直接引入的"是合规的，因为它是规则、不是占位符。

3. **类型一致**：`summarySource` 字段名在 spec / Task 1 / Task 4 / Task 5 各处一致（`'api' | 'webview'`）；`webviewPlatformId` 同理。

4. **执行顺序**：Task 1 → 2 → 3 → 4 → 5 → 6 形成单调依赖（前者完成才能开始后者），无并行机会但也无环。

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-05-03-webview-summary.md`. Two execution options:

1. **Subagent-Driven（推荐）** - 每个 Task 派一个新 subagent 执行，主 session 在 Task 间做 review
2. **Inline Execution** - 当前 session 顺序执行，按 checkpoint 暂停 review

选哪种？
