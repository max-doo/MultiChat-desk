# 「AI 回复一键插入工作台」开发文档（评审稿 v3）
> Created: 2026-11-20 11:15 (+08:00)
> Updated: 2026-11-20 12:10 (+08:00)

## 1. 需求与目标

在工作台（Workbench）模式下，为每家 AI 平台的回复消息底部操作区注入一个按钮，实现：

- **插入到当前 Markdown**：把该条回复的 Markdown 内容追加/插入到当前打开的 `.md` 文件末尾（或光标处）。
- **保存为新 Markdown**：把该条回复的 Markdown 内容另存为工作区里的新 `.md` 文件。

约束：
- **注入边界：只在 Workbench 模式注入**。脚本只挂在 `WorkbenchAiSidebar` 渲染的 webview（`workbench-sidebar-${modelId}`，`slotIndex=99`）上；聊天、任务分配、辩论、总结等其他模式下的 `WebviewCard` 一律不注入。实现上，注入与 `console-message` 监听代码只写进 `WorkbenchAiSidebar`，不改 `WebviewCard` 的通用挂载路径。
- 复用现有 `generateGetLatestResponseScript` 的 HTML→Markdown 转换，保证正文提取一致。
- 按钮注入必须 **幂等**：同一消息容器只挂一个按钮，且页面 SPA 重渲染后能自愈。
- 不新增生产依赖；全部在现有 `src/` 层内完成。

## 2. 技术方案总览

```
Workbench 侧边栏 Webview（Electron <webview>，仅 WorkbenchAiSidebar 内的实例）
   │
   ├─ injectButtonScript（页面内 JS，MutationObserver 驱动）
   │     ├─ 定位所有 AI 回复容器（per-platform assistantReplyConfig.messageRoot）
   │     ├─ 在其底部 actionBar 追加两个 <button>（插入当前 / 存为新）
   │     └─ 点击 → console.log('__MC_*__'+JSON.stringify(payload)) 发到 renderer
   │
   ├─ WorkbenchAiSidebar（renderer，仅此处监听）
   │     ├─ webview 'console-message' 监听前缀，解析出 replyMd
   │     └─ 调用 workbenchStore 插入/保存
   │
   └─ workbenchStore / workbenchService
         ├─ insertReplyIntoActiveMarkdown(replyMd) → 追加到 activeFileContent + 落盘
         └─ saveReplyAsNewMarkdown(replyMd, meta)  → 创建新文件 + 打开
```

**模式隔离**：注入脚本与 `console-message` 监听均只存在于 `WorkbenchAiSidebar.tsx`。`WebviewCard` 仅新增一个 `getWebview()` 访问器（把内部 `webviewRef.current` 暴露出去），不新增任何注入/监听逻辑，因此聊天/任务/总结等其他模式不受影响。

## 3. 关键链路拆解

### 3.1 回复容器定位

每家平台维护一个 `assistantReplyConfig`：

```ts
export interface AssistantReplyConfig {
  /** 命中最外层"消息卡"根元素（用于限定 actionBar 注入范围） */
  messageRoot: string[]        // 候选，取最后一个
  /** 正文容器（可选，缺省时用 messageRoot 内 markdown 区） */
  body?: string[]
  /** 底部操作区：注入按钮的挂载点（可选，缺省时在 messageRoot 尾部新建一个 bar） */
  actionBar?: string[]
  /** 当 actionBar 不存在时，是否直接在 messageRoot 尾部新建 bar（千问） */
  createBar?: boolean
}
```

现有 `src/shared/config/selectors.ts` 只有 `messageContainer`（正文）和 `responseMessageSelectors`（正文补充），**没有** per-platform 的"消息根"和"actionBar"。需要新增一张映射表（见 §6）。

### 3.2 按钮注入与自愈

- 在 `WorkbenchAiSidebar` 挂载 webview 后注入 `injectWorkbenchInsertButton` 脚本（`dom-ready` + `did-navigate-in-page`/`did-navigate` 后重新注入，因多数站点是 SPA）。
- 脚本内部用 `MutationObserver` 监听消息流容器；发现新 assistant 回复且未挂按钮时，插入 `<button class="mc-insert-btn">`。
- 按钮样式：继承页面按钮基础样式，追加固定 class `mc-insert-btn`，文案用 `插入工作台` + `存为新 md`（两个按钮或一个下拉，见 §4）。
- **防重复**：按钮挂到 actionBar 末尾时，先检查是否已有 `.mc-insert-btn`/`aria-label="插入工作台"`；SPA 重渲染时 MutationObserver 会重新触发，靠该检查保证幂等。

### 3.3 回传通道（评审 P0-1：修正为 console-message）

`<webview>` 标签无 `preload`，页面内脚本无法调用 `ipcRenderer.send`，因此 **`ipc-message` 事件不存在**，不可用作回传通道。

**采用 `console-message`**（与 `useWebviewNotes.ts` 的 `NOTE_CLICK_PREFIX` 同一模式）：

- 页面内脚本点击时 `console.log('__MC_INSERT_CURRENT__' + JSON.stringify(payload))` 或 `console.log('__MC_SAVE_NEW__' + JSON.stringify(payload))`。
- `WorkbenchAiSidebar` 通过 `webview.addEventListener('console-message', handler)` 监听 `event.message` 前缀，解析 JSON。
- `payload = { platformId, replyMd, replyHash, conversationUrl, title }`；`replyHash` 为回复正文短 hash，用于防重复插入。
- 前缀 `__MC_` 足够独特，与站点自身日志冲突概率极低。

### 3.4 插入/保存逻辑（renderer）

在 `workbenchStore` 里实现两个动作：

```ts
// 追加到当前 md 末尾；边界校验（评审 P1-4）：
//   activeFilePath 为空 → error '请先在左侧打开一个 Markdown 文件'
//   activeFileCategory !== 'text'/'markdown' → error '当前文件不是 Markdown'
//   扩展名不在 MARKDOWN_EXTENSIONS → error '当前文件不是 Markdown'
//   成功后 isRightCollapsed=true 时先 toggleRightCollapse() 展开右栏（见 §4）
insertReplyIntoActiveMarkdown(replyMd: string): Promise<{ success: boolean; error?: string }>

// 新建 <平台>-<时间戳>.md（评审决议），写入 replyMd，自动 openFile 打开
saveReplyAsNewMarkdown(replyMd: string, meta: { platformId: string; title?: string }): Promise<{ success: boolean; error?: string }>
```

复用现有 `createFile` + `saveActiveFile`（内部已走 `workbenchService` 的 `writeFile`/`createNode`，路径安全校验一致）；新文件创建后用 `openFile` 打开。

## 4. UI 决策

- **两个独立 icon 按钮**（评审决议），紧跟 actionBar 末尾：
  - `插入到当前文档` —— `arrow_downward` / `input`
  - `存为新文档` —— `note_add` / `description`
- 文案为动词短语，不写说明句（AGENTS.md 界面文案规范）。
- 点击 `插入到当前文档` 时若 `isRightCollapsed=true`，先 `toggleRightCollapse()` 展开右栏再插入（评审决议）。

按钮注入到 **每条消息自己的 actionBar 末尾**，而非全局工具栏，保证语义清晰、随消息滚动；一条回复挂一组按钮，多条历史回复各自可插入。

## 5. 平台覆盖范围

13 家已适配平台全量覆盖：`chatgpt, gemini, claude, deepseek, qwen, doubao, kimi, yiyan, yuanbao, chatglm, perplexity, grok, arena`。

## 6. 需要新增的 selector 配置（探针结果）

| 平台 | messageRoot 候选 | actionBar 候选 | 备注 |
|---|---|---|---|
| chatgpt | `div:has(> h4:has-text("ChatGPT 说："))` 向上 2 层 | `div.flex.items-center.gap-0.5` | 5 个 icon button |
| gemini | `infinite-scroller.chat-history` 向上 1 层 | `div.buttons-container-v2` | 5 个 icon button |
| claude | 待探 | 待探 | 未登录 |
| deepseek | `.ds-assistant-message` 向上 2 层 | 待探 | 未登录 |
| qwen | `div.auto-center-wrapper-VqwKSm` | `createBar: true` → `div.qk-markdown-react` 末尾 | 无集中 actionBar |
| doubao | `div[class*="w-full pl-14"]` 向上 1 层 | `button.actionButton-m1fXIC` 的公共父容器 | 评审 P0-2：`doc_editor` 是输入框容器类名会误命中 |
| kimi | `.segment-container` 向上 2 层 | 待探 | 未登录 |
| yiyan | `.dialog-card-wrapper` 向上 1 层 | 待探 | 未登录 |
| yuanbao | `div.agent-chat__list` 向上 0 层 | `div.ToolbarCopy_icon__5Odjl` 的公共父容器 | 评审 P0-3：DIV 非 BUTTON，需 `role="button"`+合成事件 |
| chatglm | 待探 | 待探 | 未登录 |
| perplexity | 待探 | 待探 | Cloudflare 拦截 |
| grok | 待探 | 待探 | 待探 |
| arena | 待探 | 待探 | 待探 |

`createBar` 为 `true` 时，不找 actionBar，直接在 `messageRoot` **外部尾部**（`afterend`）插入 `<div class="mc-action-bar">`；评审 P1-5：千问正文容器是 `qk-markdown-react`，bar 若挂内部会被 Markdown 样式污染，需挂到 `messageRoot` 外或给 bar 加 `all: initial` 样式隔离。

未登录平台（claude/deepseek/kimi/yiyan/chatglm/perplexity/grok/arena）的 `messageRoot`/`actionBar` 暂缺，统一用 **通用回退**：`messageRoot` 回退到现有 `messageContainer` 选择器命中项，`actionBar` 缺失时 `createBar` 兜底。待补登录态后再精细化。

## 7. 验证方案

1. `npm run lint` + `npm run build` 无报错。
2. `npm run dev` 起 Workbench，打开一个 `.md` 文件；
   - 对 ChatGPT/Gemini 发测试消息 → 回复完成后页面底部出现两个新按钮；
   - 点 `插入到当前文档` → 当前 `.md` 末尾追加 Markdown；
   - 点 `存为新文档` → 工作区新增 `<title>-<platform>-<ts>.md` 并自动打开；
   - 切换工作台平台（`sidebarModelId` 变化）后，旧 webview 按钮不重复注入。
3. 对 4 家代表平台（chatgpt / gemini / doubao / qwen）做上述验收；元宝额外验证 `DIV` 型按钮点击是否触发 ipc-message。

## 8. 风险与回退

- **SPA 重渲染导致按钮丢失**：MutationObserver 监听消息流容器子树 + `did-navigate-in-page` 重新注入；若仍丢，把注入放进 `executeJavaScript` 轮询兜底。
- **actionBar 找不到**：回退为在 messageRoot 外部尾部 `afterend` 新建 `div.mc-action-bar`，不影响正文。
- **回复正文选择器漂移**：复用 `generateGetLatestResponseScript` 的现有逻辑，漂移风险与现有总结链路一致。
- **性能**：MutationObserver 只监听消息流容器子树，且只挂一次按钮，开销可控。
- **元宝 DIV 按钮（评审 P0-3）**：actionBar 是 `DIV` 非 `BUTTON`，注入按钮用 `<div role="button" tabindex="0">`，点击用 `dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))`；同时绑 `keydown` Enter/Space 保证键盘可达。
- **千问样式污染（评审 P1-5）**：`createBar` 生成的 `div.mc-action-bar` 加 `all: initial; display: flex; gap: 4px;` 或挂到 `messageRoot` 的 `afterend`，避免 `qk-markdown-react` 正文样式继承。
- **重复插入（评审 P1-6）**：`payload.replyHash` 记录最近一次插入的回复 hash，同一条回复短时间重复点击 `插入到当前文档` 时跳过追加并提示。
- **注入范围误伤**：脚本通过 `assistantReplyConfigs[platformId]` 只对命中的平台生效；`platformId` 由 `WorkbenchAiSidebar` 注入时显式传入，与 `modelId` 一一对应。

## 9. 实施步骤（开发顺序）

1. **DOM 探针**：已通过 IAB 完成 5 家（chatgpt/gemini/qwen/doubao/yuanbao），剩余 8 家走通用回退、待补登录态后精细化。
2. **回填 selector**：`src/shared/config/selectors.ts` 新增 `assistantReplyConfigs: Record<platformId, AssistantReplyConfig>`。
3. **注入脚本**：`src/shared/utils/webviewScripts.ts` 新增 `generateInsertReplyButtonScript(cfg)`——MutationObserver 幂等挂按钮，点击时 `console.log` 前缀 payload（`replyMd` 复用 `generateGetLatestResponseScript` 的 HTML→Markdown 转换）。
4. **WebviewCardRef 口子**：`WebviewCardRef` 新增 `getWebview(): Electron.WebviewTag | null`，仅暴露只读引用。
5. **Renderer 集成（仅 WorkbenchAiSidebar）**：`WorkbenchAiSidebar` 通过 `sidebarRefs` 取 `getWebview()`，`dom-ready`/`did-navigate-in-page` 注入脚本，`console-message` 监听两个前缀，解析后调 `workbenchStore` 的两个新 action；按钮点击/存文件成功时若 `isRightCollapsed` 先 `toggleRightCollapse()`。
6. **workbenchStore**：新增 `insertReplyIntoActiveMarkdown` / `saveReplyAsNewMarkdown`，含 §3.4 边界校验。
7. **验证**：按 §7 跑验收。

## 10. 待评审问题

评审已决议：

1. **按钮形态**：两个独立 icon 按钮（实现简单，各平台 actionBar 都有空间）。
2. **插入位置**：v1 追加到当前文件末尾；光标处插入需 Lexical selection 同步，留 v2。
3. **文件名**：`<平台>-<时间戳>.md`（避免文件名过长/特殊字符）。
4. **未登录平台**：8 家走通用回退（`messageContainer` 尾部 `createBar`），待补登录态后精细化。
5. **回传通道**：`console-message`（`<webview>` 无 preload，`ipc-message` 不存在）。
6. **注入边界**：只挂 `WorkbenchAiSidebar` 的 webview，其他模式零感知；`WebviewCard` 仅加 `getWebview()` 只读访问器。
