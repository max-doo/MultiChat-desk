# 历史快照兜底机制 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 当用户回溯历史会话后，若某平台 webview 因未登录、被重定向或网页打不开而没有停在历史会话页，提示用户并可查看本地最后一轮 turn 的历史快照；点「生成总结」时若 `getAllResponses` 抓空，自动用本地历史快照补齐并标注「历史快照模式」。

**Architecture:** 纯渲染层改动，三层兜底：
1. **URL 不匹配检测（提醒信号，非精确判定）**——`WebviewCard` 在 `dom-ready`/`did-navigate`/`did-navigate-in-page` 时把当前 `getURL()` 与父组件传入的 `expectedUrl`（来自 `HistoryItem.urls[modelId]`）做规范化比较（`origin+pathname`），不一致则 set `urlMismatch`，渲染只读 Markdown 覆盖层（复用 `ModelOutputCard`）替代真实页面，并保留「重试加载」出口。用户可选择查看快照或忽略。
2. **总结兜底（最终保底，最可靠）**——`MainPage.handleGenerateReport` 在 `getAllResponses` 抓空后，对缺失模型用当前会话最后一轮 turn 的 `responses` 补上，标记 `snapshotModelIds`。
3. **总结页标注**——`SummaryPage` 顶部「历史快照模式」横幅 + `ModelOutputCard` 徽标。

> **关键定位：** URL 不匹配检测是「提醒信号」而非「精确判定」——SPA 正常的 URL normalize 也可能触发不一致，故只用于提示用户、不静默切换。**真正可靠的兜底是第 2 层总结兜底**，它不依赖任何 URL 判定。

**Tech Stack:** TypeScript (strict), React 18, Zustand 4, electron-webview tag, react-markdown + remark-gfm。验证：`npm run lint` + `npm run build` + `npm run dev` 手动（项目无测试运行器）。

## Global Constraints

- 严格 TypeScript，禁止 `any` 静默错误；故意未使用的变量以 `_` 前缀标记。
- 分层边界：本特性纯渲染层（`src/renderer`），禁止改 `src/main`、`src/preload`、IPC 契约。
- 改前先检索现有实现优先复用；小步修改，不顺手重构。
- 验证流程：`npm run lint` → `npm run build` → `npm run dev` 手动验证。
- Commit 消息遵循 Conventional Commits（`feat:` / `fix:` / `refactor:` 等）。
- 每个 Task 结束时：跑 `npm run lint` + `npm run build` 通过后 commit 一次。
- 获取时间戳必须用终端命令（`Get-Date`），不凭记忆。

## File Structure

| 文件 | 职责 | 创建/修改 |
|------|------|----------|
| `src/renderer/src/store/appStore.ts` | `SummarySessionInit` 加 `snapshotModelIds` 字段 | 修改 |
| `src/renderer/src/components/WebviewCard.tsx` | 加 `readonlySnapshot`/`expectedUrl` prop、`urlMismatch` state、URL 不匹配检测、只读覆盖层 | 修改 |
| `src/renderer/src/pages/MainPage.tsx` | 计算快照+expectedUrl 传 prop、`handleGenerateReport` 兜底、修复 `history[0]` 误取 | 修改 |
| `src/renderer/src/pages/SummaryPage.tsx` | 顶部「历史快照模式」横幅 + ModelOutputCard 徽标 | 修改 |
| `src/renderer/src/components/ModelOutputCard.tsx` | 加 `badge` prop | 修改 |

> **已删除原 Task 1（`authUrls.ts`）**：登录页 URL 模式方案被 URL 不匹配检测替代，不再需要 per-platform 登录页 URL 维护。grok/perplexity/arena 的登录页真实 URL 记为阻塞项（见「阻塞项与后续」段），本方案绕过该阻塞。

---

### Task 1: SummarySessionInit 加 snapshotModelIds 字段

**Files:**
- Modify: `src/renderer/src/store/appStore.ts:142-147`

**Interfaces:**
- Produces: `SummarySessionInit.snapshotModelIds?: string[]`——Task 3 的 `MainPage.handleGenerateReport` 写入，Task 5 的 `SummaryPage` 读取。
- Consumes: 无（纯类型扩展）。

**Background:**
- `SummarySessionInit`（`appStore.ts:142-147`）是从主界面导航到总结页的一次性数据包，当前含 `modelResponses / urls / sourceHistoryId / timestamp`。
- 加 `snapshotModelIds` 用于让总结页知道哪些模型回复来自本地历史快照兜底（而非实时抓取），以便标注。

- [ ] **Step 1: 修改 SummarySessionInit 类型**

在 `src/renderer/src/store/appStore.ts` 找到（约 142-147 行）：

```ts
export interface SummarySessionInit {
  modelResponses: Record<string, string>
  urls?: Record<string, string>
  sourceHistoryId?: string
  timestamp: number
}
```

改为：

```ts
export interface SummarySessionInit {
  modelResponses: Record<string, string>
  urls?: Record<string, string>
  sourceHistoryId?: string
  timestamp: number
  /** 哪些模型的回复来自本地历史快照兜底（实时页面不可用），供总结页标注 */
  snapshotModelIds?: string[]
}
```

- [ ] **Step 2: 类型检查**

Run: `npm run build`
Expected: 通过（可选字段，不破坏现有 `setPendingSummarySession` 调用）。

- [ ] **Step 3: Lint**

Run: `npm run lint`
Expected: 无告警。

- [ ] **Step 4: Commit**

```bash
git add src/renderer/src/store/appStore.ts
git commit -m "feat: add snapshotModelIds to SummarySessionInit"
```

---

### Task 2: WebviewCard URL 不匹配检测 + 只读快照覆盖层

**Files:**
- Modify: `src/renderer/src/components/WebviewCard.tsx`

**Interfaces:**
- Consumes: `ModelOutputCard`（已存在，`src/renderer/src/components/ModelOutputCard.tsx`）。
- Produces: `WebviewCard` 新增 props：
  - `readonlySnapshot?: { content: string; reason: 'url_mismatch' | 'load_error' | 'no_snapshot' } | null`——Task 3 的 `MainPage` 传入，`content` 是该模型最后一轮历史回复。
  - `expectedUrl?: string`——历史记录里该模型的原始 URL（`HistoryItem.urls[modelId]`），用于不匹配检测。为空则跳过检测（旧记录无基准）。

**Background（关键代码位置，全部已核实）：**
- `WebviewCardProps` 定义在 `WebviewCard.tsx:84-99`。
- 组件函数解构在 `:127`。
- 内部 state 在 `:129-140`（isLoading/isReady/sendStatus/loadError/canGoBack/canGoForward/elapsedSeconds）。
- `syncNavigationState`（`:165-175`）。
- `handleDomReady`（`:226-241`）：`webview.getURL()` 取当前 URL（`:228`），chrome-error/data 分支 `:229` return，否则 `setLoadError(null)` + `setIsReady(true)` + `syncNavigationState()`。
- `handleDidNavigate`（`:323-326`）、`handleDidNavigateInPage`（`:328`）：只 `syncNavigationState()`。
- Webview 容器 `<div className="flex-1 relative min-h-0">`（`:1023`）。Loading 覆盖层 `:1024-1042`（条件 `isLoading && !loadError`，`absolute inset-0 z-10 bg-app/50`）。LoadError 覆盖层 `:1044-1061`（条件 `loadError`，`absolute inset-0 z-10 bg-app/80`，含重试按钮调 `handleRetry`）。webview 标签 `:1070-1078`，loadError 时 className 含 `invisible pointer-events-none`（`:1075`）。
- `ModelOutputCard` props（`ModelOutputCard.tsx:6-13`）：`{ id, name, logo, content, selected, onToggle }`，内部用 `ReactMarkdown`+`remark-gfm` 渲染（`:222-227`），自带展开收起/复制/外链系统浏览器。
- `isolated` prop 已存在（`:94`），隔离模式（如总结页）下不跑此检测。

- [ ] **Step 1: 加 import**

在 `WebviewCard.tsx` 顶部 import 区加：

```ts
import ModelOutputCard from './ModelOutputCard'
```

- [ ] **Step 2: 加 readonlySnapshot / expectedUrl prop**

找到 `WebviewCardProps`（`:84-99`），在 `draggableHeader?: boolean` 那行之后、`flat?: boolean` 之前加：

```ts
  /** 只读历史快照：URL 不匹配/网页打不开时，用本地存的该模型历史回复替代真实页面。reason 表示触发原因。 */
  readonlySnapshot?: { content: string; reason: 'url_mismatch' | 'load_error' | 'no_snapshot' } | null
  /** 历史记录里该模型的原始 URL，用于检测 webview 是否仍停在历史会话页。为空则跳过检测。 */
  expectedUrl?: string
```

在 `forwardRef<WebviewCardRef, WebviewCardProps>` 的解构参数（`:127`）末尾加 `readonlySnapshot, expectedUrl`：

```ts
  ({ id, name, url, logo, enabled, slotIndex, compact, hideHeader, onModelChange, isolated, headerActions, draggableHeader, flat, onDragStart, readonlySnapshot, expectedUrl }, ref) => {
```

- [ ] **Step 3: 加 urlMismatch state**

找到 state 定义区（`:129-140`，`const [loadError, setLoadError] = useState<LoadErrorInfo | null>(null)` 那行附近），加：

```ts
  const [urlMismatch, setUrlMismatch] = useState(false)
```

- [ ] **Step 4: 加 normalizeUrl + checkUrlMismatch 函数**

找到 `syncNavigationState`（`:165-175`）之后，加：

```ts
  /**
   * 规范化 URL：只保留 origin + pathname，去掉 query/hash。
   * 用于和历史记录的 expectedUrl 比较——query/hash 常含无关参数（ref/utm/continued 等），
   * 直接字符串比较会误判。会话 ID 在 chatgpt/gemini/claude 均在 pathname 中，此规范够用。
   * ⚠️ 若实测某平台会话 ID 在 query，需在此函数对该平台做特例保留——见计划「阻塞项与后续」。
   */
  const normalizeUrl = (raw: string): string => {
    if (!raw) return ''
    try {
      const u = new URL(raw)
      return u.origin + u.pathname
    } catch {
      return raw
    }
  }

  // 检测当前 webview URL 是否偏离历史会话页（被重定向到登录页/错误页/别的会话等）。
  // 仅作提醒信号：SPA 正常的 URL normalize 也可能触发不一致，故不静默切换，只设 urlMismatch 供覆盖层提示。
  const checkUrlMismatch = (): void => {
    if (!expectedUrl) {
      setUrlMismatch(false)
      return
    }
    const webview = webviewRef.current
    if (!webview) {
      setUrlMismatch(false)
      return
    }
    try {
      const currentUrl = webview.getURL() || ''
      setUrlMismatch(normalizeUrl(currentUrl) !== normalizeUrl(expectedUrl))
    } catch {
      setUrlMismatch(false)
    }
  }
```

- [ ] **Step 5: 在 handleDomReady 挂检测**

找到 `handleDomReady`（`:226-241`），在 `setLoadError(null)`（`:239`）之后、`syncNavigationState()`（`:240`）之前加 `checkUrlMismatch()`：

```ts
        setIsLoading(false)
        setIsReady(true)
        setLoadError(null)
        checkUrlMismatch()
        syncNavigationState()
```

- [ ] **Step 6: 在 did-navigate / did-navigate-in-page 挂检测**

找到 `handleDidNavigate`（`:323-326`）和 `handleDidNavigateInPage`（`:328`），各自在 `syncNavigationState()` 之后加 `checkUrlMismatch()`：

```ts
      const handleDidNavigate = (_event: any): void => {
        // 不在这里清空 setLoadError(null)，由 handleDomReady、主动 loadURL 或重试操作负责清空
        syncNavigationState()
        checkUrlMismatch()
      }

      const handleDidNavigateInPage = (_event: any): void => {
        syncNavigationState()
        checkUrlMismatch()
      }
```

> 说明：`did-navigate-in-page` 是抓 SPA 客户端路由二次跳转的关键点；`dom-ready` 抓首次加载。两者都挂以覆盖不同时序。

- [ ] **Step 7: 加只读快照覆盖层**

找到 LoadError 覆盖层（`:1044-1061`）。在它**之前**（即 Loading 覆盖层 `:1042` 之后）插入只读快照覆盖层。

> ⚠️ **实现直接采用此最终版覆盖层逻辑**（已合并 Task 3 Step 4 的防白屏补丁）：条件用 `readonlySnapshot`（非 `readonlySnapshot?.content`），并含 `content` 为空时的「无本地快照」分支。这样 Task 3 Step 4 不再需要回改 WebviewCard。

```tsx
          {(urlMismatch || loadError) && readonlySnapshot && (
            <div className="absolute inset-0 z-20 bg-app flex flex-col">
              <div className="flex items-center gap-1.5 px-3 py-1.5 bg-amber-50 border-b border-amber-200 text-amber-800 text-xs">
                <span className="material-symbols-outlined" style={{ fontSize: 16 }}>history</span>
                <span className="font-medium">历史快照模式</span>
                <span className="text-amber-600">
                  {loadError
                    ? '· 页面加载失败'
                    : readonlySnapshot.reason === 'no_snapshot'
                      ? '· URL 与历史不符且无本地快照'
                      : '· URL 与历史记录不符，显示本地历史回复'}
                </span>
              </div>
              {readonlySnapshot.content ? (
                <div className="flex-1 min-h-0 overflow-auto">
                  <ModelOutputCard
                    id={id}
                    name={name}
                    logo={logo}
                    content={readonlySnapshot.content}
                    selected={true}
                    onToggle={() => {}}
                  />
                </div>
              ) : (
                <div className="flex-1 flex items-center justify-center text-text-secondary text-sm">
                  无该模型的本地历史快照，请刷新页面或重试加载
                </div>
              )}
              {loadError && (
                <div className="flex justify-center py-2 border-t border-gray-100">
                  <button
                    type="button"
                    onClick={handleRetry}
                    className="px-4 py-1.5 bg-primary text-white rounded-lg hover:opacity-90 transition-opacity text-sm"
                  >
                    重试加载
                  </button>
                </div>
              )}
            </div>
          )}
```

> 注意：`urlMismatch` 时不放底部「重试加载」按钮（页面并未加载失败，重试无意义）；仅 `loadError` 时保留。用户想回实时页面可手动刷新 webview（已有刷新入口）。

- [ ] **Step 8: LoadError 覆盖层降级**

找到 LoadError 覆盖层条件（`:1044`）：

```tsx
          {loadError && (
```

改为：

```tsx
          {loadError && !readonlySnapshot && (
```

- [ ] **Step 9: webview 可见性**

找到 webview 标签 className（`:1075`）：

```tsx
            className={`w-full h-full ${loadError ? 'invisible pointer-events-none' : ''}`}
```

改为：

```tsx
            className={`w-full h-full ${loadError || readonlySnapshot || urlMismatch ? 'invisible pointer-events-none' : ''}`}
```

- [ ] **Step 10: 类型检查**

Run: `npm run build`
Expected: 通过。`readonlySnapshot`/`expectedUrl` 是可选 prop，现有 MainPage 渲染 WebviewCard 处（`MainPage.tsx:493-502`）未传也不会报错。

- [ ] **Step 11: Lint**

Run: `npm run lint`
Expected: 无告警。`onToggle={() => {}}` 是合法 noop。

- [ ] **Step 12: Commit**

```bash
git add src/renderer/src/components/WebviewCard.tsx
git commit -m "feat: add URL mismatch detection and readonly snapshot overlay to WebviewCard"
```

---

### Task 3: MainPage 快照+expectedUrl 计算 + 总结兜底 + history[0] 修复

**Files:**
- Modify: `src/renderer/src/pages/MainPage.tsx`

**Interfaces:**
- Consumes: `WebviewCard` 的 `readonlySnapshot`/`expectedUrl` prop（Task 2）；`SummarySessionInit.snapshotModelIds`（Task 1）；`getDisplayedModels`（已 import，`MainPage.tsx:5`）；`history`、`activeHistoryId`（`MainPage.tsx:19/33`）。
- Produces: 无新对外接口——内部改造 `handleGenerateReport` 和 WebviewCard 渲染。

**Background（关键代码位置，全部已核实）：**
- `activeHistoryId` 是 MainPage 局部 state（`:19`），回溯历史时设为 `item.id`（`:547` 附近）。
- `history` 从 store 取（`:33`，已确认解构）。
- `handleGenerateReport`（`:78-160`）：`:98` 调 `getAllResponses`；`:107-112` 过滤 `validResponses`；`:119-130` modelCount 判断；`:133` `const latestHistoryItem = history[0]`（**bug：回溯非最新会话时取错**）；`:134-139` `setPendingSummarySession`。
- WebviewCard 渲染在 `:493-502`，传 `id/name/url/logo/enabled/slotIndex`。
- `getDisplayedModels` 已 import（`:5`）。
- `getAllResponses`（`appStore.ts:1142-1149`）在会话活跃（`!isNewSession || textInserted`）且 `activeModels.length>0` 时用 `state.activeModels`，否则回落 `getDisplayedModels`——**兜底循环必须复刻同一判定**，否则会遍历到本次未参与对话的模型、误补多余快照。
- `HistoryItem.urls`（`appStore.ts:138`，`urls?: Record<string, string>`）存每轮各模型原始 URL，作 `expectedUrl` 来源。
- `ConversationTurn.responses`（`appStore.ts:88-93`）是 `Record<string,string>`，作快照 `content` 来源。
- `debateSlots`（MainPage.tsx:29）、`history`（:33）已解构；`isNewSession/textInserted/activeModels` 需实现时确认是否已解构，缺则补。

- [ ] **Step 1: 确认 store 解构**

在 `MainPage` 组件体顶部（`:24-36` 附近）确认已解构 `history`、`debateSlots`（已核实有）。确认是否有 `isNewSession`、`textInserted`、`activeModels`——若没有，加上：

```ts
  const isNewSession = useAppStore((state) => state.isNewSession)
  const textInserted = useAppStore((state) => state.textInserted)
  const activeModels = useAppStore((state) => state.activeModels)
```

（实现时先读文件确认，避免重复声明。）

- [ ] **Step 2: 加 historySnapshots / historyUrls useMemo**

在 `handleGenerateReport` 定义之前（组件体内其他 useMemo 附近）加：

```ts
  // 回溯历史时，预计算各模型最后一轮 turn 的快照 + 历史原始 URL，
  // 供 WebviewCard 做 URL 不匹配检测与只读快照显示。非回溯态（无 activeHistoryId）返回空。
  const { historySnapshots, historyUrls } = useMemo(() => {
    if (!activeHistoryId) return { historySnapshots: {} as Record<string, string>, historyUrls: {} as Record<string, string> }
    const item = history.find((h) => h.id === activeHistoryId)
    if (!item || item.turns.length === 0) return { historySnapshots: {}, historyUrls: {} }
    const lastTurn = item.turns[item.turns.length - 1]
    return {
      historySnapshots: lastTurn.responses ?? {},
      historyUrls: item.urls ?? {}
    }
  }, [activeHistoryId, history])
```

- [ ] **Step 3: WebviewCard 传 readonlySnapshot / expectedUrl prop**

找到 WebviewCard 渲染（`:493-502`），在 `slotIndex={i}` 之后加：

```tsx
                <WebviewCard
                  key={`webview-${mode}-${i}-${model.id}`}
                  ref={productMode === mode ? getRefCallback(model.id, i) : undefined}
                  id={model.id}
                  name={model.name}
                  url={model.url}
                  logo={model.logo}
                  enabled={true}
                  slotIndex={i}
                  expectedUrl={historyUrls[model.id]}
                  readonlySnapshot={
                    historySnapshots[model.id]
                      ? { content: historySnapshots[model.id], reason: 'url_mismatch' as const }
                      : null
                  }
                />
```

> `reason` 此处固定 `url_mismatch`；覆盖层在 `loadError` 时会自动改显「页面加载失败」文案（Task 2 Step 7 已按 `loadError` 分支处理）。无快照（`historySnapshots[model.id]` 为空）则不传覆盖层，`urlMismatch` 仍会触发但不显示快照（仅 webview 不可见）——为避免「既无快照又不显示页面」的白屏，见 Step 4 的备注。

- [ ] **Step 4: readonlySnapshot 传法（含无快照占位，防白屏）**

> Task 2 Step 7 已采用最终版覆盖层逻辑（含 `content` 为空时的「无本地快照」分支、`!readonlySnapshot` 降级条件、`readonlySnapshot` 可见性判断），**无需回改 WebviewCard**。本步只确定 `readonlySnapshot` 的传法：

```tsx
                  readonlySnapshot={
                    historySnapshots[model.id]
                      ? { content: historySnapshots[model.id], reason: 'url_mismatch' as const }
                      : { content: '', reason: 'no_snapshot' as const }
                  }
```

> 注意 `expectedUrl` 仍按 Step 3 传 `historyUrls[model.id]`；非回溯态（无 `activeHistoryId`）`historyUrls` 为空对象，`expectedUrl` 为 undefined，Task 2 Step 4 的 `checkUrlMismatch` 会跳过检测、`urlMismatch` 恒为 false。但此时 `readonlySnapshot` 仍被传了 `no_snapshot` 占位——**必须确保覆盖层条件 `(urlMismatch || loadError)` 在非回溯态为 false**，否则正常对话也会弹覆盖层。`loadError` 在正常对话时本就 false，`urlMismatch` 因 `expectedUrl` 为空而 false，故安全。

- [ ] **Step 5: 修复 history[0] 误取**

找到 `handleGenerateReport` 内（`:133`）：

```ts
      const latestHistoryItem = history[0]
```

改为：

```ts
      const latestHistoryItem = history.find((h) => h.id === activeHistoryId) ?? history[0]
```

> 同样需检查 `:162` 的异常分支 `const latestHistoryItem = history[0]`，一并改为同一表达式。

- [ ] **Step 6: 加总结兜底循环**

找到 `handleGenerateReport` 内 validResponses 过滤（`:107-112`）之后、modelCount 判断（`:119`）之前，插入兜底循环。先看 `:107-112` 现有代码：

```ts
      const validResponses: Record<string, string> = {}
      Object.entries(responses).forEach(([id, content]) => {
        if (content && content.trim().length > 0) {
          validResponses[id] = content
        }
      })
```

在它之后插入：

```ts
      // 兜底：对实时抓空的模型，用当前会话最后一轮 turn 的历史快照补上。
      // 这是三层兜底里最可靠的一层——不依赖任何 URL 判定，只要 getAllResponses 抓空且 history 有该模型回复就补。
      // 注意：兜底针对 webview 抓空（未登录/打不开/被重定向到非会话页导致 getLatestResponse 返回空），
      // 不是"抓到了旧内容"——回溯历史时 webview 显示旧会话，实时值与 history 最后一轮同源，
      // 兜底仅在 webview 真正不可用时才有意义。
      const snapshotModelIds: string[] = []
      const lastTurn = latestHistoryItem?.turns?.[latestHistoryItem.turns.length - 1]
      const lastResponses = lastTurn?.responses ?? {}
      // ⚠️ 目标模型列表必须与 getAllResponses 内部选取逻辑完全一致：
      // getAllResponses（appStore.ts:1146-1149）在会话活跃（!isNewSession || textInserted）且
      // activeModels 非空时用 state.activeModels，否则才回落到 getDisplayedModels。
      // 若这里用 getDisplayedModels 而 getAllResponses 用 activeModels，会遍历到本次根本没参与
      // 对话的模型（其 validResponses[id] 本就 undefined），把它误判为"抓空"并补上多余快照。
      // 因此这里复刻同一判定：
      const isSessionActive = !isNewSession || textInserted
      const targetModelList = isSessionActive && activeModels.length > 0
        ? activeModels
        : getDisplayedModels(models, displayMode, productMode, taskAssignmentSlots, multiAiSlots, debateSlots)
      for (const model of targetModelList) {
        if (!validResponses[model.id] && lastResponses[model.id]?.trim()) {
          validResponses[model.id] = lastResponses[model.id]
          snapshotModelIds.push(model.id)
        }
      }
```

- [ ] **Step 7: 改 modelCount 提示逻辑**

找到 modelCount 判断（`:119-130`）：

```ts
      const modelCount = Object.keys(validResponses).length
      if (modelCount > 0) {
        // 显示成功通知
        if (controlBarRef.current) {
          controlBarRef.current.showNotification('success', `成功爬取 ${modelCount} 个模型的回答`)
        }
      } else {
        // 没有获取到有效回复
        if (controlBarRef.current) {
          controlBarRef.current.showNotification('error', '未获取到有效的模型回复')
        }
      }
```

改为：

```ts
      const modelCount = Object.keys(validResponses).length
      if (modelCount > 0) {
        if (controlBarRef.current) {
          const snapshotNote =
            snapshotModelIds.length > 0
              ? `（含 ${snapshotModelIds.length} 个历史快照）`
              : ''
          controlBarRef.current.showNotification('success', `成功获取 ${modelCount} 个模型的回答${snapshotNote}`)
        }
      } else {
        if (controlBarRef.current) {
          controlBarRef.current.showNotification('error', '未获取到有效的模型回复')
        }
      }
```

- [ ] **Step 8: setPendingSummarySession 加 snapshotModelIds**

找到 `:134-139`：

```ts
      setPendingSummarySession({
        modelResponses: validResponses,
        urls: latestHistoryItem?.urls,
        sourceHistoryId: latestHistoryItem?.id,
        timestamp: Date.now()
      })
```

改为：

```ts
      setPendingSummarySession({
        modelResponses: validResponses,
        urls: latestHistoryItem?.urls,
        sourceHistoryId: latestHistoryItem?.id,
        timestamp: Date.now(),
        snapshotModelIds
      })
```

> 异常分支（`:162` 附近）的 `setPendingSummarySession({ modelResponses: {}, ... })` 不加 `snapshotModelIds`（异常时无快照）。

- [ ] **Step 9: 类型检查**

Run: `npm run build`
Expected: 通过。若报 `isNewSession`/`textInserted`/`activeModels` 未定义，回到 Step 1 补 store 解构。

- [ ] **Step 10: Lint**

Run: `npm run lint`
Expected: 无告警。

- [ ] **Step 11: Commit**

```bash
git add src/renderer/src/pages/MainPage.tsx src/renderer/src/components/WebviewCard.tsx
git commit -m "feat: fallback to history snapshot on URL mismatch and empty scrape in MainPage"
```

> Task 2 已采用最终版覆盖层逻辑，Task 3 无需回改 WebviewCard；本 commit 仅 `src/renderer/src/pages/MainPage.tsx`。

---

### Task 4: ModelOutputCard 加 badge prop

**Files:**
- Modify: `src/renderer/src/components/ModelOutputCard.tsx`

**Interfaces:**
- Produces: `ModelOutputCard` 新增可选 prop `badge?: string`——Task 5 的 `SummaryPage` 传 `'快照'`。

**Background:**
- `ModelOutputCardProps`（`ModelOutputCard.tsx:6-13`）：`{ id, name, logo, content, selected, onToggle }`。
- 组件函数解构在 `:19-25`。
- name 渲染位置：`:185`，确切为 `<span className="font-medium text-text-primary">{name}</span>`，处于含 logo+name 的 flex 容器内。

- [ ] **Step 1: 加 badge prop 到 interface**

找到 `ModelOutputCardProps`（`:6-13`），加 `badge?: string`：

```ts
interface ModelOutputCardProps {
  id: string
  name: string
  logo: string
  content: string
  selected: boolean
  onToggle: () => void
  badge?: string
}
```

- [ ] **Step 2: 解构 badge**

找到组件函数（`:19-25`）：

```ts
function ModelOutputCard({
  name,
  logo,
  content,
  selected,
  onToggle
}: ModelOutputCardProps): JSX.Element {
```

加 `badge`：

```ts
function ModelOutputCard({
  name,
  logo,
  content,
  selected,
  onToggle,
  badge
}: ModelOutputCardProps): JSX.Element {
```

- [ ] **Step 3: 渲染 badge**

找到 name 标题渲染处（`ModelOutputCard.tsx:185`，确切行号已核实）：

```tsx
          <span className="font-medium text-text-primary">{name}</span>
```

在该 `{name}` 所在 `<span>` 之后（同级、紧随其后）加：

```tsx
{badge && (
  <span className="ml-2 px-1.5 py-0.5 text-xs bg-amber-100 text-amber-700 rounded">
    {badge}
  </span>
)}
```

> 已核实 `:185` 是 `<span className="font-medium text-text-primary">{name}</span>`，处于含 logo+name 的 flex 容器内，badge 紧随该 span 即可。

- [ ] **Step 4: 类型检查**

Run: `npm run build`
Expected: 通过。`badge` 可选，现有调用不传不受影响。

- [ ] **Step 5: Lint**

Run: `npm run lint`
Expected: 无告警。

- [ ] **Step 6: Commit**

```bash
git add src/renderer/src/components/ModelOutputCard.tsx
git commit -m "feat: add badge prop to ModelOutputCard"
```

---

### Task 5: SummaryPage 历史快照横幅 + 徽标

**Files:**
- Modify: `src/renderer/src/pages/SummaryPage.tsx`

**Interfaces:**
- Consumes: `pendingSummarySession.snapshotModelIds`（Task 1/3 写入）；`ModelOutputCard.badge`（Task 4）。

**Background（关键代码位置，全部已核实）：**
- `SummaryPage` 从 store 读 `pendingSummarySession`（`:18` 解构）。
- session 初始化在 `:110-154` 的 useEffect，`const session = pendingSummarySession`（`:118`）、`const data = session.modelResponses || {}`（`:123`）、`setModelResponses(data)`（`:126`）。
- ModelOutputCard 渲染在 `:177-186`，传 `content={modelResponses[model.id] || '暂无回复内容'}`（`:182`）。
- 顶部返回按钮在 `:160-166`。

- [ ] **Step 1: 加 snapshotModelIds state**

在 `SummaryPage` 组件体 state 区（其他 useState 附近，约 `:31-33`）加：

```ts
  const [snapshotModelIds, setSnapshotModelIds] = useState<string[]>([])
```

- [ ] **Step 2: 从 session 读 snapshotModelIds**

找到 session 初始化 useEffect（`:110-154`），在 `setModelResponses(data)`（`:126`）附近加：

```ts
      setSnapshotModelIds(session.snapshotModelIds ?? [])
```

> 放在与 `setModelResponses(data)` 同处（`:126` 之后）。注意此分支读 `pendingSummarySession` 后立即 `setPendingSummarySession(null)`（`:124`），所以 `session.snapshotModelIds` 必须在置 null 前读，已满足。

- [ ] **Step 3: 加顶部横幅**

找到 return 内返回按钮之后（`:166` 之后，`isLoadingResponses ?` 判断 `:168` 之前）加：

```tsx
        {snapshotModelIds.length > 0 && (
          <div className="flex items-center gap-2 px-4 py-2 bg-amber-50 border-b border-amber-200 text-amber-800 text-sm mb-4 shrink-0">
            <span className="material-symbols-outlined" style={{ fontSize: 18 }}>history</span>
            <span>
              本次总结包含 {snapshotModelIds.length} 个模型的本地历史快照（实时页面不可用）
            </span>
          </div>
        )}
```

> 已核实返回按钮在 `:160-166`、其后是 `:168` 的 loading 判断。横幅放两者之间。

- [ ] **Step 4: ModelOutputCard 传 badge**

找到 ModelOutputCard 渲染（`:177-186`），在现有 props 里加 `badge`：

```tsx
                  badge={snapshotModelIds.includes(model.id) ? '快照' : undefined}
```

> 加在 `onToggle={...}` 之后即可。

- [ ] **Step 5: 类型检查**

Run: `npm run build`
Expected: 通过。

- [ ] **Step 6: Lint**

Run: `npm run lint`
Expected: 无告警。

- [ ] **Step 7: Commit**

```bash
git add src/renderer/src/pages/SummaryPage.tsx
git commit -m "feat: show history snapshot banner and badges in SummaryPage"
```

---

## 端到端验证（npm run dev 手动）

全部 Task 完成后，跑 `npm run dev`，按以下场景手动验证：

- **场景 1 正常实时总结（回归）**：非回溯态正常对话一轮（2+ 模型，已登录）→ 点「生成总结」→ webview 无快照覆盖层、总结页无横幅、ModelOutputCard 无「快照」徽标、总结正常生成。
- **场景 2 URL 不匹配回退**：对话一轮产生 history（含 `urls`）→ 回溯该会话 → 手动让某 webview 偏离（如退登后被重定向到登录页，或 loadURL 跳到首页）→ 该 webview 显示只读 Markdown 覆盖层（顶部「历史快照模式 · URL 与历史记录不符」+ 该模型最后一轮回复），其他平台正常 → 点「生成总结」→ 提示「成功获取 N 个模型的回答（含 1 个历史快照）」+ 总结页顶部 amber 横幅 + 该模型 ModelOutputCard「快照」徽标 + 总结可生成。
- **场景 3 网页打不开回退**：对话一轮 → 断网或 hosts 屏蔽某平台 → 回溯 → 该 webview 快照覆盖层（loadError 分支，底部「重试加载」按钮）→ 重试恢复网络后回实时页面 → 点总结同场景 2 预期。
- **场景 4 无快照可回退**：回溯会话，某平台既 URL 不符且该 turn 无 responses（首轮流式中断）→ webview 显示「无该模型的本地历史快照，请刷新页面或重试」覆盖层 → 点总结 → 该模型不被补快照，若全部抓空则「未获取到有效回复」error。
- **场景 5 history[0] 误取修复**：产生 2 条历史 A（更新）、B → 回溯 B → 点总结 → 总结页 urls/sourceHistoryId 指向 B（非 A）。
- **场景 6 非回溯态不误弹**：非回溯态正常对话中 → webview 不应出现「历史快照模式」覆盖层（`expectedUrl` 为空，`urlMismatch` 恒 false）。

## 风险与边界

- **URL 规范化误判（核心风险）**：`normalizeUrl` 只比 `origin+pathname`，去掉 query/hash。会话 ID 在 chatgpt/gemini/claude 均在 pathname，够用；但**若某平台会话 ID 在 query**（grok/perplexity 待实测），去掉 query 会比不出差异 → 漏判。缓解：URL 检测只是提醒信号，漏判不致命（总结兜底仍保底）；误判（SPA normalize 触发假不一致）会让用户看到覆盖层，但可手动刷新 webview 回实时页面，不静默丢数据。
- **SPA 二次跳转假阳性**：`did-navigate-in-page` 抓 SPA 客户端路由跳转，跳转后 URL 字符串可能与 history 记录不等（即使内容正确）→ 误弹覆盖层。缓解：覆盖层始终保留手动刷新出口；首版接受可能误弹，按 dev 实测反馈细化 `normalizeUrl` 的 per-platform 保留 query 规则。
- **三层兜底定位**：URL 不匹配检测 = 提醒信号（可能误判/漏判）；`loadError` = 页面加载失败硬信号；**总结兜底循环 = 最可靠保底**（不依赖 URL 判定，抓空就补）。即使前两层全失效，总结兜底仍能保证总结可生成（前提：history 有该模型回复）。
- **`HistoryItem.urls` 数据质量**：旧历史记录可能无 `urls` 字段 → `expectedUrl` 为 undefined → 跳过 URL 检测，仅靠总结兜底。属预期降级。
- **非回溯态护栏**：`expectedUrl` 为空时 `checkUrlMismatch` 早退、`urlMismatch` 恒为 false，覆盖层不触发——正常对话不会误弹。`isolated` prop 本身不参与此检测（全仓库无 WebviewCard 传入 `isolated`，SummaryPage 亦不渲染 WebviewCard），护栏完全由 `expectedUrl` 提供。
- **纯渲染层**：未动 main/preload/IPC，符合 AGENTS.md 分层约束。

## 阻塞项与后续

- **grok / perplexity / arena 登录页真实 URL 未实测**：本方案已用「URL 不匹配检测」绕过登录页 URL 模式维护，不阻塞实现。但 `normalizeUrl` 的 per-platform query 保留规则（若会话 ID 在 query）需在 dev 中逐平台实测后细化。建议实测顺序：chatgpt/gemini/claude（已知会话 ID 在 pathname，验证 `normalizeUrl` 基线）→ grok/perplexity/arena（确认会话 ID 位置，必要时加 query 保留）。
- **URL 不匹配的"差异类型"判定**：当前只判"不一致"，不区分"跳到登录页"vs"跳到别的会话"vs"SPA normalize"。若后续想区分，仍需 per-platform 路径白名单（如 `pathname` 含 `/login`、`/`、`/error` 才算跑偏），此为后续增强，非本计划范围。

## 收尾

实现完成后，按 AGENTS.md 要求运行 `python .memory/session_log.py` 记录本次会话（Task Summary、File Operations、若有关键经验用 --lesson）。
