# Arena.ai Webview 平台接入设计

## 背景

将 [arena.ai](https://arena.ai/)（LMSYS Chatbot Arena）接入 ModelMash 的 Webview 平台列表，作为第 12 个可用的聊天平台。Arena 是一个 AI 模型比较/竞技场平台，用户可以在其中与不同模型进行对话、盲测对战和并排比较。

## 方案

采用**标准 Webview 接入**方案，与现有 11 个平台（Gemini、ChatGPT、Claude 等）完全一致。

## 修改范围

### 文件 1：`src/renderer/src/store/appStore.ts`

在 `defaultModels` 数组末尾添加 arena 配置：

```ts
{ id: 'arena', name: 'Arena', url: 'https://arena.ai/', logo: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABwAAAAcCAAAAABXZoBIAAAAp0lEQVR4AdWSLwjEIBSH7Xm9l/WyaGdlzWIXLphWbOvtFatRLiy/ZjILdjAJ9uod3LG5O1gc7OO1j/eHH4/UE24oM+HsACd572TosMEha8YW7L3b8D2WdudK5WND0rU9KKgIGr5oiCo2EsKAquSU31UUDgEOnRaNpHWaKpUGrQrtTjt2SVi/LN6I1I3PnxBMFOYjo/lLSO9SXyUhcO3m2Wke4K4/dMIL1Ne5UmnGphQAAAAASUVORK5CYII=', enabled: false }
```

- `enabled: false` — 默认不启用，与其他新增平台保持一致
- `logo` — 用户提供 base64 PNG

### 文件 2：`src/renderer/src/config/selectors.ts`

在 `defaultSelectors.models` 中添加 `arena` 的 DOM 选择器配置：

| 配置项 | 初始值 |
|---|---|
| `textarea` | `['textarea[placeholder*="Message"]','textarea[placeholder*="message"]','textarea','[contenteditable="true"]']` |
| `sendButton` | `['button[type="submit"]','button[aria-label*="Send"]','button[aria-label*="send"]','form button:last-child']` |
| `messageContainer` | `['.prose','[class*="markdown"]','.message-content','[data-testid*="message"]','.chat-message']` |
| `customCSS` | （空，视实际界面后补充） |
| `newConversationUrl` | `'https://arena.ai/'` |

同时更新版本信息：`version: 11`，`lastUpdated: '2026-05-03'`。

### 不修改的文件

- `WebviewCard.tsx` — 纯通用组件，无平台硬编码
- `ControlBar.tsx` — 无平台特定逻辑
- `SettingsDrawer.tsx` — arena 作为模型比较平台，不支持 Deep Research / AI 生图，不加入对应支持列表
- `requestBodyConfig.ts`、`summaryApi.ts` — 仅涉及 Webview 平台，不涉及 API 供应商

## 数据流

完全复用现有机制，无新增数据流：

1. 用户输入消息 → `insertTextToAll` / `sendMessageToAll`
2. → `webviewRef.sendMessage()` / `insertText()`
3. → 注入脚本根据 `selectors.ts` 中的 arena 选择器查找输入框
4. → 填入文字 / 点击发送按钮
5. → Arena 页面响应

回复提取：
1. 轮询监控 → `pollPlatforms()`
2. → `webviewRef.getLatestResponse()`
3. → 注入脚本根据 `messageContainer` 选择器抓取 DOM
4. → 转换为 Markdown 保存到历史记录

## 已知限制

- Arena 首页可能有"Enter arena"或模式选择入口，用户需要手动先进入聊天界面，自动化才能找到输入框
- 若用户未进入聊天模式，代码会正常返回 `未找到输入框` 错误
- 选择器为初始推测值，需在实际运行后根据 Arena 的真实 DOM 结构微调

## 测试计划

1. `npm run lint` + `npm run build` — 确保无编译错误
2. `npm run dev` — 实际打开 arena.ai，测试：
   - 文字是否能正确输入到输入框
   - 点击发送后消息是否能发出
   - 模型回复是否能被抓取并转换为 Markdown
3. 根据实际 DOM 微调选择器（预期内的迭代步骤）
