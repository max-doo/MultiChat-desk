# Webview 总结模式 设计文档

**日期**：2026-05-03
**作者**：协同设计（用户 + Claude Code）
**状态**：草稿，待用户审阅

---

## 1. 目标

让总结页面在不依赖 OpenAI 兼容 API 的情况下，也能用各家 AI 厂商的 Webview 页面完成"对多模型回答的二次总结"。同时保留现有"接 API 总结"功能，两套并存、用户在总结面板上可切换。

### 1.1 核心动机

- 用户没有可用 API key，或不希望把多模型素材发往第三方 API
- 直接落到厂商网页端可获得"思考过程可视化、Deep Research、附件、画布"等网页端独有能力
- 复用项目已有的 11 平台自动化能力（选择器、注入脚本、Session 共享），边际成本低

### 1.2 范围

**包含**：
- 在 `SummaryPage` 增加"Webview 模式"，与"API 模式"同级切换
- 在总结面板内嵌一个独立的 `WebviewCard` 作为"总结器"，目标平台由用户在 UI 上选择
- 单次总结流程：拼 prompt → 注入到 webview → 流式镜像抓取 → 判定完成 → 落库
- 取消（停止抓取）、超时保护
- 历史记录格式向前兼容，新增 `summarySource` 字段

**不包含（非目标）**：
- Webview 模式下的多轮追问（用户已确认第一版不做）
- Webview 模式与 API 模式的混合编排
- 自动绕过厂商风控、模拟人类行为节奏的对抗逻辑
- 平台账号管理（沿用现有 `persist:shared` Session）
- 总结 prompt 模板的重新设计（直接复用 `docs/总结模块提示词架构方案.md` 中定义的三明治结构）

---

## 2. 架构概览

```
SummaryPage
  └─ SummaryPanel
       ├─ 模式开关：API / Webview
       ├─ Webview 模式 UI
       │    ├─ 平台选择器（11 个已配置平台）
       │    ├─ "开始总结" / "停止" 按钮
       │    ├─ 流式镜像区（复用现有 streamingContent / messages）
       │    └─ 嵌入的 WebviewCard（实时显示 webview 内对话）
       └─ API 模式 UI（保持不变）
```

数据流分两条独立路径，由模式开关分流，互不影响：

| 模式 | 来源 | 流式机制 | 取消机制 |
|---|---|---|---|
| API（现有） | `window.api.generateSummary` → main 进程 | IPC `onChunk` 回调 | `window.api.abortSummary` → AbortController |
| Webview（新） | 嵌入的 `WebviewCard` 注入脚本 | 轮询 `getLatestResponse()` + DOM diff | 停止轮询；webview 内的生成不强行打断 |

关键不变量：UI 层（messages 列表、streamingContent、export、historyDrawer）保持单一抽象，不感知数据来源。两条路径都最终把"一条用户消息 + 一条 assistant 消息"写入 messages，触发同样的渲染。

---

## 3. 用户流程

1. 用户从 MainPage 点"生成报告"，进入 SummaryPage（与现有流程一致）
2. 在 SummaryPanel 顶部把模式从默认 "API" 切到 "Webview"
3. 选目标平台（默认记住上次选择；首次进入时默认 ChatGPT，若无 `newConversationUrl` 则取列表中首个已配置该字段的平台）；UI 即时挂载嵌入 webview，加载该平台的"新会话 URL"
4. 选总结 Agent（系统模板）+ 输入用户要求（保持不变）
5. 点"开始总结"
6. UI 状态：
   - 流式镜像区显示"正在打开 webview / 等待页面就绪 / 注入 prompt / 等待回复"等阶段提示
   - webview 中可以看到原生对话（厂商自己的流式动画、Deep Research 进度等）
   - 镜像区随轮询每次抓到新内容做增量追加（用户视觉上看到"两边同步打字机"）
7. 完成判定后（连续 N 秒无新增），把最终内容落入 messages 列表，停留在面板顶部（与 API 模式一致）
8. 用户可选：导出为 md / 文件、保存到历史记录（与 API 模式一致）

---

## 4. 组件清单

### 4.1 新增文件

#### `src/renderer/src/hooks/useWebviewSummary.ts`

承载 Webview 模式的全部业务逻辑。导出形态参考现有 `useSummaryPanel`：

```ts
interface UseWebviewSummaryParams {
  selectedModels: string[]
  modelResponses: Record<string, string>
  agentPrompt: string                  // 选中的 agent 系统模板
  userRequirement: string              // 用户要求
  targetPlatformId: string             // 目标平台 id（chatgpt / claude / ...）
  webviewRef: React.RefObject<WebviewCardRef>  // 内嵌 webview 的 ref
}

interface UseWebviewSummaryReturn {
  isGenerating: boolean
  streamingContent: string
  error: string | null
  phase: 'idle' | 'loading-page' | 'sending' | 'streaming' | 'done' | 'aborted' | 'error'
  startSummary: () => Promise<void>
  abortSummary: () => void
}
```

内部职责：
- 拼 prompt（复用现有三明治拼接逻辑，把 system + user 合并成单段纯文本）
- `loadURL(newConversationUrl)` → 等 `dom-ready` + 800ms 缓冲
- `webviewRef.sendMessage(prompt)`
- 启动轮询：每 600ms 调 `getLatestResponse()`，做前缀 diff 算增量
- 完成判定：内容连续 4 秒无新增 → 落库
- 超时保护：单次总结上限 5 分钟（达到则视为完成，使用当前已抓内容）
- 取消：清掉 interval、设 phase = 'aborted'、保留已抓内容

### 4.2 修改文件

#### `src/renderer/src/components/SummaryPanel.tsx`

- 顶部加"模式"开关组件（segmented control 或 tab，`API | Webview`），状态写入 `appStore.apiConfig.summaryMode`（新字段）以记忆用户选择
- Webview 模式渲染分支：
  - 替换原"供应商 + 模型"两个下拉为"目标平台"单个下拉
  - 替换右侧"streamingContent + messages"区域为"上半 streamingContent / 下半嵌入 WebviewCard"分屏。分屏比例用本组件内 `useState` 维护（默认 0.5），不接入 `appStore.paneRatios`（与 MainPage 拖拽不耦合）；首版用固定 50/50，是否加拖拽留到实现阶段视体验决定
- 生成路径分流：模式 = api → 走 `useSummaryPanel.handleGenerate`；模式 = webview → 走 `useWebviewSummary.startSummary`
- 取消按钮分流：分别调用 `abortSummary()`（API）或 webview 模式的 `abortSummary()`

#### `src/renderer/src/hooks/useSummaryPanel.ts`

不修改其内部 API 模式逻辑。SummaryPanel 同时调用 `useSummaryPanel`（API 模式）和 `useWebviewSummary`（webview 模式），按当前模式只把对应那套 `isGenerating / streamingContent / messages` 接到 UI 上；另一套保持空状态、不订阅、不发请求。

历史落库与导出由 SummaryPanel 在写入时统一加上 `summarySource` / `webviewPlatformId` 字段（webview 模式从 `useWebviewSummary` 取，API 模式默认 'api'）。两个 hook 不互相感知。

#### `src/renderer/src/config/selectors.ts`

每个平台增加可选字段 `newConversationUrl?: string`，例：

```ts
chatgpt: { ..., newConversationUrl: 'https://chat.openai.com/?temporary-chat=true' }
claude:  { ..., newConversationUrl: 'https://claude.ai/new' }
gemini:  { ..., newConversationUrl: 'https://gemini.google.com/app' }
```

未配置的平台 fallback 到 model 列表中已配置的 `url`（即 MainPage 默认 URL）。

#### `src/renderer/src/store/appStore.ts`

- `apiConfig` 新增字段 `summaryMode: 'api' | 'webview'`（默认 'api'，持久化）
- `apiConfig` 新增字段 `lastWebviewSummaryPlatform: string`（默认 'chatgpt'）
- `SummaryHistoryItem` 增加可选字段：`summarySource?: 'api' | 'webview'`、`webviewPlatformId?: string`
- 历史记录读写要兼容旧记录（无字段视为 'api'）

#### `src/preload/index.d.ts`

无改动（webview 模式纯渲染层）。

---

## 5. 关键流程详细设计

### 5.1 Prompt 拼接

复用 `docs/总结模块提示词架构方案.md` 中的三明治结构。把 `[{role:system, ...}, {role:user, ...}]` 合并成单段：

```
[系统指令]
{systemPrompt}

[待分析内容]
<context>
<model_output name="ChatGPT">...</model_output>
<model_output name="Claude">...</model_output>
...
</context>

[用户要求]
{userRequirement || "请生成标准总结报告。"}
```

这段文本即为塞给 webview 的 `prompt`。

### 5.2 加载阶段

```
phase: 'idle' → 'loading-page'
webviewRef.loadURL(newConversationUrl)
监听 webview 'dom-ready' 事件，并 setTimeout(800) 缓冲 SPA 后续 hydration
phase: 'loading-page' → 'sending'
```

如果 5 秒内未触发 dom-ready → `phase = 'error'`，error 文案"webview 加载超时"。

### 5.3 注入 prompt

```
const result = await webviewRef.sendMessage(prompt)
if (!result.success) { phase = 'error'; error = result.error; return }
phase: 'sending' → 'streaming'
开始轮询
```

`sendMessage` 已经处理 ProseMirror / Lexical / Slate / Ant Design / Semi UI 等富文本输入兼容，本设计直接复用，不做修改。

### 5.4 轮询与流式镜像

```ts
let last = ''
let lastChangeAt = Date.now()
const interval = setInterval(async () => {
  const result = await webviewRef.getLatestResponse()
  const current = result?.content || ''
  if (current.length > last.length && current.startsWith(last)) {
    setStreamingContent(current)   // 前缀匹配 → 增量追加
    last = current
    lastChangeAt = Date.now()
  } else if (current !== last) {
    // 整段重写（少数平台流式中途回填整段），全量替换
    setStreamingContent(current)
    last = current
    lastChangeAt = Date.now()
  }
  if (Date.now() - lastChangeAt > 4000 && last.length > 0) {
    finish()
  }
  if (Date.now() - startedAt > 5 * 60_000) {
    finish() // 5 分钟超时保护
  }
}, 600)
```

完成判定阈值参数化为常量（`STREAM_IDLE_TIMEOUT_MS = 4000`、`STREAM_HARD_TIMEOUT_MS = 300_000`、`POLL_INTERVAL_MS = 600`），写在 `useWebviewSummary` 文件顶部，便于后续调参。

### 5.5 完成 / 取消

完成（`finish`）：
- clearInterval
- 把 `last` 作为 assistant message 推入 messages（与 API 模式同款 ChatMessage 结构）
- 写入历史记录，标记 `summarySource: 'webview'`、`webviewPlatformId`
- phase: 'streaming' → 'done'

取消（`abortSummary`）：
- clearInterval
- 当前 `last` 不为空 → 与 finish 相同处理但不写入历史，给用户机会决定是否保存
- phase → 'aborted'
- 不强行点击 webview 内的"停止生成"按钮（实现复杂、跨 11 平台不一致），生成会在 webview 里继续；视觉上 webview 内的对话仍可见、可手动操作

---

## 6. 平台配置

第一版 `newConversationUrl` 默认值：

| 平台 id | URL | 说明 |
|---|---|---|
| chatgpt | `https://chat.openai.com/?temporary-chat=true` | 用临时对话避免污染历史 |
| claude | `https://claude.ai/new` | 新对话 |
| chatglm | `https://chatglm.cn/main/alltoolsdetail` | 默认主页即新对话 |
| yiyan | `https://yiyan.baidu.com/` | 主页 |
| gemini | `https://gemini.google.com/app` | 主页即新对话 |
| grok | `https://grok.com/` | 主页 |
| qwen | `https://chat.qwen.ai/` | 主页 |
| kimi | `https://www.kimi.com/` | 主页 |
| doubao | `https://www.doubao.com/chat/` | 主页 |
| yuanbao | `https://yuanbao.tencent.com/chat` | 主页 |
| perplexity | `https://www.perplexity.ai/` | 主页 |

具体 URL 在实现阶段以"打开后自动落到一个空对话"为准，逐个目测验证；与 model 列表里 MainPage 用的 URL 不一定相同（MainPage 可能停留在某次具体对话的页面）。

---

## 7. 错误处理

| 场景 | 处理 | 用户文案 |
|---|---|---|
| webview dom-ready 超时（>5s） | phase = 'error' | "页面加载超时，请检查网络后重试" |
| sendMessage 注入失败 | phase = 'error' | 显示 sendMessage 返回的具体 error |
| 轮询 getLatestResponse 抛异常 | 单次跳过、不中断轮询；连续 5 次失败 → phase = 'error' | "无法读取回复内容，请确认是否已登录该平台" |
| webview 内未登录 / 跳转登录页 | 不做特殊检测，依赖用户从 phase 提示和 webview 视觉反馈识别 | （沿用 webview 自身的登录提示） |
| 5 分钟硬超时 | finish + 落库当前内容 | 流式镜像最后追加一行 "（已达到 5 分钟上限，截断）" |

---

## 8. 持久化

### 8.1 历史记录

`SummaryHistoryItem` 在保留旧字段基础上加：

```ts
interface SummaryHistoryItem {
  // 旧字段保持
  id: string
  messages: ChatMessage[]
  selectedModels: string[]
  modelResponses?: Record<string, string>
  // 新增（可选）
  summarySource?: 'api' | 'webview'      // 缺省视为 'api'
  webviewPlatformId?: string              // summarySource = 'webview' 时记录
}
```

读旧记录时不需要迁移，缺失字段按 'api' 处理。`SummaryHistoryDrawer` 可在条目右侧显示一个小标签（"API" / "Webview · ChatGPT"），便于辨识。

### 8.2 模式与平台记忆

`apiConfig.summaryMode` 与 `apiConfig.lastWebviewSummaryPlatform` 走 electron-store 持久化，重启后恢复用户上次选择。

---

## 9. 验证清单

实现完成的判定条件：

- [ ] API 模式现有行为完全不变（消息发送、流式、取消、导出、历史记录）
- [ ] Webview 模式：在至少 3 个平台（ChatGPT、Claude、Gemini）跑通端到端
- [ ] 完成判定阈值（4s 静默）在三个平台均能正确触发
- [ ] 取消按钮立刻停止轮询、保留当前镜像内容
- [ ] 历史记录里能看到 webview 模式条目，重新打开能恢复 messages
- [ ] 切换模式时 UI 状态干净（不残留对方模式的 streamingContent）
- [ ] `npm run lint` 通过
- [ ] `npm run build` 通过
- [ ] 不引入新的 `any`、不修改 `out/` `dist/`、不动 IPC 契约

---

## 10. 工作量与里程碑

| 里程碑 | 内容 | 估时 |
|---|---|---|
| M1 | `useWebviewSummary` hook + 单平台（ChatGPT）跑通 | 0.5 天 |
| M2 | SummaryPanel 模式开关 + 双布局 + 状态隔离 | 0.5 天 |
| M3 | 11 平台 newConversationUrl 配置 + 逐个目测 | 0.5 天 |
| M4 | 历史记录字段 + Drawer 标签 + 取消 / 超时 | 0.5 天 |
| M5 | lint / build / 端到端验证 + Changelog | 0.25 天 |

**合计：约 2.25 个工作日**（不含因平台 DOM 结构变化触发的选择器修补）。

---

## 11. 已识别的实现期风险与兜底

1. **超长输入 prompt 在 ProseMirror 上变慢**
   - 现状：`generateSendMessageScript` 用 `execCommand('insertText')` + `InputEvent`，逐字符同步注入；4 个模型回答合集可能数万字符，ChatGPT 端会卡顿数秒
   - 兜底：实现阶段如果出现 >10s 卡顿，加一条"超过 8000 字符走粘贴事件路径"的快路径（`buildContentEditableInputScript` 中追加 ClipboardEvent('paste') 注入分支）
2. **完成判定误触发**
   - 风险：长篇推理过程中模型短暂停顿（>4s）导致提前判定
   - 兜底：把阈值常量化，调到 4s 不行再调 6s/8s，写一行注释说明判定原理
3. **平台风控**
   - 风险：ChatGPT / Claude 对自动化输入有零星检测，可能要求人机验证
   - 现状：MainPage 已经在用同套脚本日常运转，沿用即可
   - 兜底：用户如遇验证页可在 webview 内手动通过，过后重新点"开始总结"
4. **平台 DOM 升级**
   - 风险：选择器随时可能失效
   - 现有机制：`selectors.ts` 已经是单一改动点，沿用现有维护流程

---

## 12. 与现有文档的关系

- prompt 三明治结构：详见 `docs/总结模块提示词架构方案.md`，本设计直接复用
- DOM 选择器与抓取：详见 `docs/输入框dom.md` `docs/输出内容dom.md` `docs/深度研究dom.md`，本设计在其上调用，不修改
- API 配置（保留路径）：详见 `docs/API_CONFIG_GUIDE.md`，与本设计无交集
