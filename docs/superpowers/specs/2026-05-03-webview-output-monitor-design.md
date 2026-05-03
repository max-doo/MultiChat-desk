# Webview AI 输出实时监控与自动保存设计文档

## 背景与目标

ModelMash 当前的历史记录（`history`）仅保存用户发送的消息文本和各平台的对话 URL，不保存 AI 的实际回复内容。历史回溯依赖于平台提供的对话 ID（如 Gemini 的 `/app/xxx`、ChatGPT 的 `/c/xxx`），鲁棒性弱——平台 UI 变化或对话被删除时，历史记录失效。

**目标：** 在后台静默监控各 webview 中的 AI 输出，当输出完成后自动将完整的对话数据（用户问题 + AI 回复）保存到本地，替代现有的 `history` 存储方式，且不依赖平台对话 ID。

## 需求要点

1. **后台静默监控**：不需要 UI 展示，不干扰现有 webview 体验
2. **输出完成判定**：统一策略——内容连续稳定即判定完成
3. **多轮累积**：同一对话窗口中的多轮问答累积到一条记录
4. **保留 URL**：保存对话 URL 用于快速回溯
5. **替代现有 history**：新格式完全替代旧格式，保持向后兼容

## 数据模型

### HistoryItem（新格式）

```typescript
export interface ConversationTurn {
  turnId: string
  userMessage: string
  timestamp: number
  responses: Record<string, string>  // modelId -> Markdown
}

export interface HistoryItem {
  id: string
  createdAt: number
  updatedAt: number
  models: string[]
  turns: ConversationTurn[]
  urls?: Record<string, string>
}
```

### 监控状态（Store 内部状态，不持久化）

```typescript
interface PlatformMonitorState {
  lastContent: string
  stableCount: number
  isComplete: boolean
}

interface TurnMonitor {
  turnId: string
  userMessage: string
  platforms: Record<string, PlatformMonitorState>
}

interface MonitorState {
  isMonitoring: boolean
  currentConversationId: string | null
  currentTurn: TurnMonitor | null
  intervalId: ReturnType<typeof setInterval> | null
  startTime: number
}
```

### 与现有格式的映射

| 现有字段 | 新字段 |
|---------|-------|
| `id` | `id` |
| `message` | `turns[0].userMessage` |
| `timestamp` | `createdAt` |
| `responses` | `turns[n].responses` |
| `models` | `models` |
| `urls` | `urls` |

## 架构方案：Store 中心化轮询

### 方案对比

| 维度 | Store 中心化轮询（选定） | WebviewCard 自治 | 主进程后台监控 |
|------|------------------------|-----------------|---------------|
| IPC 改动 | 无 | 无 | 需新增 |
| 主进程改动 | 无 | 无 | 大幅 |
| 与现有架构契合 | 高（复用 appStore、WebviewCardRef） | 中（需额外协调） | 低 |
| 实现复杂度 | 低 | 中 | 高 |
| 实时性 | 中（3s 轮询） | 中 | 高 |

### 选择理由

- 零 IPC 改动，复用现有 `executeJavaScript` 和 `storeSet`
- 状态集中在 Zustand store，便于调试和后续扩展
- 追加逻辑（新对话 vs 累积）天然好做

## 监控配置

```typescript
const MONITOR_CONFIG = {
  pollIntervalMs: 3000,                 // 每 3 秒轮询一次
  stableThreshold: 3,                   // 连续 3 次不变即完成（约 9 秒）
  maxMonitorDurationMs: 5 * 60 * 1000,  // 最长监控 5 分钟（防死等）
}
```

## 核心流程

### 1. 发送消息 → 启动监控

```
sendMessageToAll(message)
  │
  ├── 1. 发送消息到各 webview（现有逻辑）
  │
  ├── 2. 获取各平台当前 URL
  │
  ├── 3. 判定：新对话还是继续现有对话
  │     └── shouldStartNewConversation(currentUrls, previousUrls, isNewSession)
  │           ├── isNewSession === true       → 新对话
  │           ├── 无历史 URL                  → 新对话
  │           ├── 参与模型集合变化             → 新对话
  │           └── 任一平台 URL 变了           → 新对话
  │
  ├── 4a. 新对话：创建 HistoryItem（turns: []）
  ├── 4b. 旧对话：更新现有 HistoryItem 的 urls
  │
  └── 5. 创建 TurnMonitor，启动定时轮询器
```

### 2. 轮询器工作逻辑

```
pollPlatforms()  // 每 3 秒执行
  │
  ├── 超时检测：超过 5 分钟？
  │     └── 是 → 保存当前 turn，停止监控
  │
  ├── 对每个未完成的平台：
  │     ├── 调用 webviewRef.getLatestResponse()
  │     ├── 内容变化？
  │     │     ├── 是 → stableCount = 0，更新 lastContent
  │     │     └── 否 → stableCount++，达到 threshold？
  │     │                 └── 是 → isComplete = true
  │     └── 仍有未完成的？→ allComplete = false
  │
  ├── 保存当前进度到 history（部分完成也保存）
  │
  └── allComplete？
        └── 是 → 停止轮询器
```

### 3. 保存逻辑

```
saveCurrentTurn()
  │
  ├── 查找 currentConversationId 对应的 HistoryItem
  ├── 构建 responses（只包含有内容的平台）
  ├── 查找是否已有同 turnId
  │     ├── 有 → 替换该 turn
  │     └── 无 → 追加到 turns 末尾
  ├── 更新 updatedAt
  └── 写 store + 持久化到 electron-store
```

## 新对话判定规则

### URL 归一化

```typescript
function normalizeUrl(url: string): string {
  if (!url || url === 'about:blank') return ''
  try {
    const u = new URL(url)
    return `${u.origin}${u.pathname}`  // 忽略 query 参数
  } catch {
    return url
  }
}
```

忽略 query 参数是合理的——对话 ID 在 pathname 中，query 参数通常是 UI 状态（如 model 选择）。

### 判定函数

```typescript
function shouldStartNewConversation(
  currentUrls: Record<string, string>,
  previousUrls: Record<string, string> | undefined,
  isNewSession: boolean
): boolean {
  if (isNewSession) return true
  if (!previousUrls || Object.keys(previousUrls).length === 0) return true

  const currentKeys = Object.keys(currentUrls)
  const previousKeys = Object.keys(previousUrls)

  if (currentKeys.length !== previousKeys.length) return true
  if (!currentKeys.every(k => previousKeys.includes(k))) return true

  for (const modelId of currentKeys) {
    const curr = normalizeUrl(currentUrls[modelId])
    const prev = normalizeUrl(previousUrls[modelId])
    if (curr && prev && curr !== prev) return true
  }

  return false
}
```

### `isNewSession` 的重置点

`isNewSession` 需要在以下场景重置为 `true`：

1. **WebviewCard `handleNewConversation`**：用户点击"新对话"按钮时
2. **SummaryPage 完成总结后**：从总结页返回主页面时

这样 `isNewSession` 才能成为可靠的用户意图信号。

## 边界情况处理

| 场景 | 处理策略 |
|------|---------|
| 监控中用户又发了新消息 | 先保存当前 turn，然后启动新 turn 监控 |
| 某平台在监控期间刷新/跳转 | 当前 turn 保存已获取内容；URL 变了则下次发送时视为新对话 |
| 某平台回复为空（网络错误等） | stableThreshold 到达后内容为空 → 保存空字符串，不阻塞其他平台 |
| 用户禁用了某平台 | 只监控发送时启用的平台 |
| 5 分钟超时 | 标记超时完成，保存已有内容，停止轮询 |
| 轮询期间应用关闭 | 无法保存，接受此限制（类似现有行为） |

## 向后兼容：旧格式迁移

启动时检查 `history` 格式：

```typescript
function migrateHistoryItem(old: OldHistoryItem): HistoryItem {
  return {
    id: old.id,
    createdAt: old.timestamp,
    updatedAt: old.timestamp,
    models: old.models,
    turns: [{
      turnId: `${old.id}-0`,
      userMessage: old.message,
      timestamp: old.timestamp,
      responses: old.responses || {}
    }],
    urls: old.urls
  }
}
```

## 改动文件清单

| 文件 | 改动类型 | 说明 |
|------|---------|------|
| `src/renderer/src/store/appStore.ts` | 大幅修改 | 核心：新 HistoryItem 类型、监控状态机、轮询逻辑、保存逻辑、发送消息流程重构 |
| `src/renderer/src/components/WebviewCard.tsx` | 小幅修改 | `handleNewConversation` 中重置 `isNewSession = true` |
| `src/renderer/src/components/HistoryDrawer.tsx` | 中等修改 | 适配 `turns[]` 格式展示 |

## 无改动的模块

- `src/preload/index.d.ts`：零 IPC 新增
- `src/main/ipcHandlers.ts`：零主进程改动
- `src/main/webviewManager.ts`：零主进程改动
- `src/renderer/src/config/selectors.ts`：复用现有选择器
- `src/renderer/src/utils/webviewScripts.ts`：复用 `generateGetLatestResponseScript`

## Context7 自检结论

通过 Electron 官方文档确认：

1. `executeJavaScript` 在当前无-preload 架构下是唯一的跨 webview 内容获取方式
2. 轮询方案的 IPC 开销在可接受范围内（完成后立即停止）
3. 如需更实时方案，未来可通过 webview `preload` + `ipcRenderer.sendToHost` 升级，但不属于当前需求范围

## 后续可扩展方向

1. **实时进度面板**：store 中已有各平台 `lastContent`，可以暴露给 UI 做输出预览
2. **preload 推送方案**：为 webview 添加轻量 preload 脚本，用 `MutationObserver` + `sendToHost` 替代轮询
3. **导出功能**：基于 `turns[]` 格式，可以导出完整对话为 Markdown/JSON
