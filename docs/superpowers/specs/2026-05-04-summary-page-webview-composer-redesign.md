# 总结页 Webview 模式 Composer 重构设计

## 背景

当前 `SummaryPage` 在 Webview 总结模式下，右侧面板将控件切成 4 段堆叠：

1. 顶部「模式」dropdown 单独一行
2. 顶部 `customPrompt` textarea（h-16）单独一行
3. 中间 `WebviewCard` 嵌入完整 AI 平台聊天 UI
4. 底部「开始 Webview 总结」按钮 + 三段状态指示（`已发送` / `已选 3 个模型` / `正在生成回复…`）单独一行

由此产生四个明显问题：

- **WebView 被夹太窄**：右栏本就只有 40% 宽度，再被顶/底各夹掉 100+px，截图里 Gemini 聊天内容只剩碎片显示。
- **两套聊天输入并存**：上方 ModelMash 自带 textarea + 模式 + 发送按钮，下方 WebView 内嵌「问问 Gemini」+ 麦克风 + 发送，用户分不清该用哪个。
- **垂直空间被切碎**：模式行 + textarea 行 + WebView + 状态行 = 4 段，密度差。
- **状态文字噪声**：底部三段状态指示提供的是冗余信息，用户已经知道自己点了什么。

## 目标

- 把 Webview 模式右栏的所有控件压成 **底部一条单行 composer**：`[模式▼][输入框][发送按钮]`，参考 API 模式 composer 形态但更紧凑。
- WebViewCard 直接吃掉 composer 之外的全部垂直空间。
- 首次发送后 composer 锁定，追问由 WebView 自带输入框承担，从根上消除「双聊天 UI」问题。
- 完全移除「已选 N 个模型」「正在生成…」等状态指示文字。

## 非目标

- 不动 API 模式的任何布局（顶部供应商/模型工具条 + 双行 composer 全部保留）。
- 不动左栏 60% 的模型输出卡片。
- 不动顶部 Header（返回 / API·Webview 切换 / 历史）。
- 不修改 `useWebviewSummary` 钩子的状态机。
- 不新增重置 / 新建会话按钮，「再做一次总结」通过返回再进入实现。

## 重构后布局

```
┌───────────────────────────────────────────────────┐
│ Header (返回 | API/Webview | ModelMash | 历史)        │
├──────────────────┬────────────────────────────────┤
│                  │                                │
│                  │                                │
│                  │                                │
│   Model Output   │       WebviewCard              │
│   Cards (60%)    │       (吃掉除 composer 外全高)   │
│                  │                                │
│                  │                                │
│                  │                                │
│                  │                                │
│                  ├────────────────────────────────┤
│                  │  [模式▼][输入框........][发送]│
└──────────────────┴────────────────────────────────┘
```

右栏自上而下只剩两段：WebviewCard（`flex-1 min-h-0`）+ Composer（`shrink-0`）。

## Composer 详细形态

### 视觉结构

```
┌─────────────────────────────────────────────┐
│ [模式 pill] [auto-grow textarea] [发送] │
└─────────────────────────────────────────────┘
```

- 容器：`flex flex-row items-end gap-2 p-2 bg-gray-800 border border-gray-700 rounded-lg shrink-0`，单行高度约 56px（含 padding）。
- 模式 pill（左）：复用现有 `CustomDropdown`，沿用 API 模式底部的 pill 样式（圆角胶囊 + primary 主题色），固定 `min-w-max`。
- 输入框（中，`flex-1`）：`textarea`，单行起步（`rows={1}`），自动按内容高度增长，最高 5 行（`max-h-[120px]`），样式：`bg-transparent border-none focus:outline-none resize-none text-sm leading-5 py-2 px-2`。Placeholder：`输入额外的分析要求（可选）`。
- 发送按钮（右）：图标按钮，primary 背景；图标用 `send`（与 API 模式一致），`shrink-0`。

### 交互

- `Enter` 发送，`Shift + Enter` 换行（与 API 模式一致）。
- 模式 pill 点击展开下拉，与现有逻辑一致。

### 状态机

新增本地状态 `summaryFired: boolean`（默认 `false`）。

| 条件 | composer 表现 |
|---|---|
| `summaryFired === false` 且 `webviewSummary.phase === 'idle'` | enabled，发送按钮高亮 |
| `webviewSummary.phase ∈ {'loading-page', 'uploading-file', 'sending', 'streaming'}` | disabled（`opacity-60 cursor-not-allowed`，textarea 禁止输入），发送按钮变灰 |
| `summaryFired === true` 且 `phase === 'done'` | 永久 disabled，textarea placeholder 切到「已发送，请在右侧对话窗口继续追问」 |
| `phase === 'error'` 或 `'aborted'` | 重置 `summaryFired = false`，composer 重新 enabled，允许重试 |

「永久 disabled」仅在当前 SummaryPanel 实例生命周期内成立。用户点返回再进入页面，组件重新挂载，`summaryFired` 自动归零。

### 发送行为

`handleWebviewSend` 内已有逻辑保留不动（`buildWebviewPrompt` 拼装 system prompt + 模型回答 context + custom prompt → `webviewRef.sendMessage(prompt)`）。新增一行：成功调用 `webviewSummary.startSummary()` 后立即 `setSummaryFired(true)`。

## 删除项

| 当前位置 | 当前代码 | 处理 |
|---|---|---|
| `SummaryPanel.tsx:1010-1045` | 顶部模式 dropdown + textarea | 删除，模式 pill 与 textarea 合并下沉到 composer |
| `SummaryPanel.tsx:1063-1091` | 底部「开始 Webview 总结」按钮 + 状态指示 3 段 | 删除，发送按钮移到 composer 右侧；3 段状态文字（`已选 N 个模型` / `正在上传文件` / `正在发送` / `正在生成回复`）**全部移除** |

## 改动文件

- `src/renderer/src/components/SummaryPanel.tsx` — 仅替换 `summarySource === 'webview'` 分支（约 1007-1093 行），其余分支与 helper 函数不动。

## 数据流

发送流程不变：

```
点发送 → handleWebviewSend()
        → 拼装 userMessage、addSummaryHistory、setSummaryFired(true)
        → webviewSummary.startSummary()
            → useWebviewSummary 内部按现有逻辑：
              判断长短文本 → 直接粘贴 / 文件上传 → polling 流式抓取
        → 完成时回调 onAssistantMessage 写入 messages
```

锁定逻辑通过 `summaryFired` 与 `phase` 共同决定 composer 的 disabled 状态。

## 视觉验证清单

实现完成后，在 `npm run dev` 下逐项确认：

- [ ] 进入总结页 → Webview 模式：右栏只看到 WebviewCard 与底部一条 composer，无其他控件。
- [ ] Composer 默认单行（约 40px 输入区高度），输入多行时输入区向上撑高，最大 5 行。
- [ ] `Enter` 发送，`Shift+Enter` 换行。
- [ ] 点发送后：composer 立刻 disabled，WebView 出现首条用户消息并开始流式回复。
- [ ] 流式完成后：composer 仍 disabled，placeholder 变为「已发送，请在右侧对话窗口继续追问」；用户在 WebView 自带输入框可继续追问。
- [ ] 点返回 → 重新进入：composer 重新 enabled，可再次发起总结。
- [ ] API 模式与原来完全一致（顶部供应商/模型工具条、底部双行 composer 都没变）。
- [ ] 左栏 60% 模型输出卡片与原来一致。

## 验收

- `npm run lint` 通过。
- `npm run build` 通过。
- 上述视觉验证清单全部勾选。
