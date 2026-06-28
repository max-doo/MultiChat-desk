> Created: 2026-06-28 20:19 (+08:00)

# Automated Selector Discovery Design

> **Status:** Draft — awaiting review

## 1. Problem Statement

MultiChat Desk 依赖 `src/renderer/src/config/selectors.ts` 中手动维护的 CSS 选择器来定位 AI 平台的输入框、发送按钮、消息容器、研究/生图开关等 DOM 元素。当前维护 12 个平台，每个平台 5-20 个候选选择器。AI 平台频繁改版导致选择器持续失效，人工获取真实 DOM 结构效率低、易出错。

**目标**：构建一个 agent 驱动的自动化管线，用浏览器工具直接探索已登录 AI 平台的真实 DOM 结构，生成并验证候选选择器，输出可直接审核合并的 `selectors.ts` 更新。

## 2. Non-Goals

- 不做全自动持续监控（不引入定时任务或订阅机制）
- 不做选择器自动合并（合并仍由人工审核确认）
- 不引入新的生产依赖（Playwright 仅在开发/维护时通过 npx 使用）
- 不修改现有 `selectors.ts` 的数据结构和运行时行为

## 3. Architecture Overview

### 3.1 Two-Phase Strategy

```
Phase 1 (现在)                     Phase 2 (后续)
─────────────                      ─────────────
Playwright CDP 外部浏览器          Electron 内建导出
  ┌──────────┐                      ┌──────────────┐
  │ 你的浏览器 │                      │ MultiChat App │
  │ (已登录)  │                      │  webview 标签  │
  └─────┬────┘                      └──────┬───────┘
        │ CDP                               │ executeJavaScript
  ┌─────▼────┐                      ┌──────▼───────┐
  │ Playwright│                      │ DOM Explorer  │
  │ 脚本      │                      │ 注入脚本      │
  └─────┬────┘                      └──────┬───────┘
        │                                  │ IPC/store
  ┌─────▼────┐                      ┌──────▼───────┐
  │ Agent    │                      │ JSON 文件     │
  │ 分析+生成 │                      │ (磁盘)        │
  └─────┬────┘                      └──────┬───────┘
        │                                  │
  ┌─────▼────┐                      ┌──────▼───────┐
  │selectors │                      │ Agent 分析    │
  │.ts 更新  │                      │ + 生成        │
  └──────────┘                      └──────────────┘
```

Phase 1 立即可用，Phase 2 在 CLI Daemon 架构落地后自然衔接。

### 3.2 Agent 角色

Agent 负责以下步骤，但不做任何自动写入：

1. 连接浏览器（Phase 1）或读取导出文件（Phase 2）
2. 注入 DOM 探索脚本，收集结构化数据
3. 分析数据，按平台生成候选选择器列表
4. 在页面中实时验证选择器有效性（`document.querySelector` + 可见性检查）
5. 将结果写入 `selectors.ts`（需用户审核确认后）

## 4. Core Component: DOM Exploration Script

### 4.1 设计原则

- **只读**：不修改 DOM、不触发事件、不提交数据
- **结构化输出**：返回 JSON，而非自由文本
- **分层探索**：按"元素类别"分层收集（输入框 → 按钮 → 容器 → 开关），方便按需分析
- **语义优先**：优先记录 ARIA role、label、data-testid 等稳定属性，CSS 类名作为辅助

### 4.2 收集的数据结构

```typescript
interface DomExplorationResult {
  url: string                    // 探索时的页面 URL
  title: string                  // 页面标题
  timestamp: number
  elements: {
    textareas: TextareaInfo[]    // 输入框
    buttons: ButtonInfo[]        // 按钮（含发送按钮候选）
    containers: ContainerInfo[]  // 消息容器候选
    toggles: ToggleInfo[]        // 开关/菜单项（研究/生图模式）
  }
}

interface TextareaInfo {
  tag: string
  selector: string               // 唯一 CSS 选择器路径
  candidateSelectors: string[]   // 多个候选（ID > data-testid > aria > class > 层级）
  placeholder: string | null
  ariaLabel: string | null
  dataTestId: string | null
  contenteditable: boolean
  visible: boolean
  rect: { x: number, y: number, w: number, h: number }
}

interface ButtonInfo {
  tag: string
  selector: string
  candidateSelectors: string[]
  text: string                   // innerText
  ariaLabel: string | null
  dataTestId: string | null
  role: string | null
  type: string | null            // submit / button
  visible: boolean
  rect: { x: number, y: number, w: number, h: number }
  // 启发式分类
  heuristics: {
    isSendButton: boolean        // 离输入框最近的 submit button
    isPrimaryAction: boolean     // 页面主操作按钮
    isToolToggle: boolean        // 工具开关（研究/生图等）
  }
}

interface ContainerInfo {
  tag: string
  selector: string
  candidateSelectors: string[]
  role: string | null
  dataTestId: string | null
  className: string | null
  containsMarkdown: boolean      // 内部是否包含 markdown 渲染内容
  childCount: number
  textLength: number
  visible: boolean
  rect: { x: number, y: number, w: number, h: number }
}

interface ToggleInfo {
  tag: string
  selector: string
  candidateSelectors: string[]
  text: string
  ariaLabel: string | null
  dataTestId: string | null
  role: string | null            // switch / radio / menuitem / menuitemradio / tab
  ariaChecked: boolean | null
  ariaExpanded: boolean | null
  visible: boolean
  rect: { x: number, y: number, w: number, h: number }
}
```

### 4.3 选择器生成策略（优先级从高到低）

对每个发现的元素，按以下优先级生成候选选择器：

| 优先级 | 策略 | 示例 | 稳定性 |
|--------|------|------|--------|
| 1 | `data-testid` 属性 | `[data-testid="send-button"]` | 高 |
| 2 | `aria-label` 精确匹配 | `button[aria-label="发送"]` | 高 |
| 3 | `role` + 文本 | `[role="menuitemradio"]` + text match | 高 |
| 4 | 语义标签 + 稳定类名片段 | `button[class*="send"]` | 中 |
| 5 | 语义标签 + 结构定位 | `form button[type="submit"]` | 中 |
| 6 | 纯类名组合 | `.send-btn.primary` | 低 |

**关键规则**：
- 不使用随机后缀（如 `tagBtn-OADWVI`，`selected-OsA38F`），这类哈希类名是改版重灾区
- 不使用深层嵌套路径（超过 3 层），结构变动会连锁失效
- 每个元素至少生成 3 个不同优先级的候选，排前面的优先使用

### 4.4 注入脚本伪代码

```javascript
// 注入到目标页面的自执行函数
(function() {
  const result = {
    url: location.href,
    title: document.title,
    timestamp: Date.now(),
    elements: { textareas: [], buttons: [], containers: [], toggles: [] }
  };

  // 收集所有输入区域
  document.querySelectorAll('textarea, [contenteditable="true"], [role="textbox"]')
    .forEach(el => {
      if (!isVisible(el)) return;
      result.elements.textareas.push(buildTextareaInfo(el));
    });

  // 收集所有按钮
  document.querySelectorAll('button, [role="button"], input[type="submit"], input[type="button"]')
    .forEach(el => {
      if (!isVisible(el)) return;
      result.elements.buttons.push(buildButtonInfo(el));
    });

  // 收集消息容器候选（含 markdown 的大块区域）
  document.querySelectorAll('[class*="markdown"], [class*="prose"], [class*="message"], [class*="response"], [class*="answer"], article, [role="article"]')
    .forEach(el => {
      if (!isVisible(el)) return;
      result.elements.containers.push(buildContainerInfo(el));
    });

  // 收集开关/菜单项
  document.querySelectorAll('[role="switch"], [role="radio"], [role="menuitem"], [role="menuitemradio"], [role="tab"], [role="checkbox"]')
    .forEach(el => {
      if (!isVisible(el)) return;
      result.elements.toggles.push(buildToggleInfo(el));
    });

  return JSON.stringify(result, null, 2);
})()
```

## 5. Phase 1: Playwright CDP 管线

### 5.1 前置条件

用户以调试模式启动浏览器：

```bash
# Chrome
chrome.exe --remote-debugging-port=9222

# Edge
msedge.exe --remote-debugging-port=9222

# 或使用临时 Profile（推荐，不影响日常使用）
chrome.exe --remote-debugging-port=9222 --user-data-dir="%TEMP%\chrome-debug-profile"
```

### 5.2 Agent 执行流程

```
1. npx playwright 连接 CDP
   └─ chromium.connectOverCDP('http://localhost:9222')

2. 遍历所有已打开的标签页
   └─ 匹配已知 AI 平台 URL 模式
   └─ 未匹配的跳过

3. 对每个平台标签页：
   a. 确认页面已加载完成（networkidle）
   b. 注入 DOM 探索脚本 → 获取结构化 JSON
   c. 分析 JSON，生成候选选择器
   d. 验证候选选择器：page.$$eval(selector, els => els.length)
   e. 记录验证结果（命中数、是否唯一）

4. 汇总所有平台结果
   └─ 生成 selectors.ts 更新 diff
   └─ 展示给用户审核
```

### 5.3 平台 URL 匹配表

```typescript
const PLATFORM_URLS: Record<string, string[]> = {
  chatgpt:    ['chat.openai.com', 'chatgpt.com'],
  claude:     ['claude.ai'],
  gemini:     ['gemini.google.com'],
  deepseek:   ['chat.deepseek.com'],
  qwen:       ['chat.qwen.ai', 'tongyi.aliyun.com'],
  perplexity: ['perplexity.ai'],
  chatglm:    ['chatglm.cn'],
  kimi:       ['kimi.moonshot.cn'],
  doubao:     ['doubao.com', 'www.doubao.com'],
  yiyan:      ['yiyan.baidu.com', 'chat.baidu.com'],
  grok:       ['grok.com', 'x.com/i/grok'],
  yuanbao:    ['yuanbao.tencent.com'],
  arena:      ['arena.ai'],
};
```

### 5.4 安全措施

- 探索脚本只读（不 `click()`、不 `focus()`、不 `dispatchEvent()`）
- 不操作页面 Cookie/Storage
- 不截图页面内容（可能含敏感对话）
- 中间 JSON 文件只包含元素元数据（标签、属性、innerText 截断至 200 字符、位置），不包含对话内容或模型回复
- 不通过网络传输任何数据，全部本地处理

## 6. Phase 2: Electron 内建导出（后续）

### 6.1 触发方式

在 `WebviewCard` 组件中，通过开发者快捷键（如 `Ctrl+Shift+E`）或右键菜单触发：

```
触发 → executeJavaScript(domExplorerScript)
     → 结果通过 IPC 写入磁盘文件
     → Agent 读取文件进行分析
```

### 6.2 新增文件

```
src/renderer/src/utils/domExplorer.ts   # DOM 探索脚本生成器
scripts/explore-dom.ts                  # Agent 调用的分析脚本
```

### 6.3 与 CLI Daemon 的衔接

当 CLI Daemon 架构落地后（`docs/superpowers/plans/2026-05-15-cli-daemon-architecture.md`），DOM 探索能力可作为 CLI 子命令：

```bash
multichat-cli explore-dom --platform chatgpt --output chatgpt-dom.json
multichat-cli explore-dom --all --output all-platforms.json
```

Agent 直接调用 CLI 命令，完全自动化，无需手动操作浏览器。

## 7. 文件结构

```
项目根目录/
├── scripts/
│   └── explore-dom.ts              # Phase 1: Playwright CDP 探索脚本
├── src/renderer/src/
│   ├── config/
│   │   └── selectors.ts            # 现有选择器配置（目标文件）
│   └── utils/
│       └── domExplorer.ts          # Phase 2: DOM 探索脚本生成器
├── docs/superpowers/
│   └── specs/
│       └── 2026-06-28-auto-selector-discovery-design.md  # 本文档
└── .temp/                          # gitignore'd
    └── dom-exploration/
        ├── chatgpt-2026-06-28.json # 探索中间产物
        ├── claude-2026-06-28.json
        └── ...
```

## 8. Selector 生成算法

### 8.1 输入框选择器（textarea）

```
输入：TextareaInfo[]
输出：string[] （候选选择器列表，按优先级排序）

1. 优先 data-testid 属性 → [data-testid="chat-input"]
2. 其次 placeholder 文本属性 → textarea[placeholder*="发送消息"]
3. 再次 contenteditable + role → [contenteditable="true"][role="textbox"]
4. 最后语义标签 → textarea（fallback）
```

### 8.2 发送按钮选择器（sendButton）

```
输入：ButtonInfo[]（已过滤 isSendButton）
输出：string[]

1. data-testid → [data-testid="send-button"]
2. aria-label 精确 → button[aria-label="发送"]
3. type="submit" → button[type="submit"]
4. 语义标签 + 类名片段 → button[class*="send"]
5. 表单内最后一个 button → form button:last-child
```

### 8.3 消息容器选择器（messageContainer）

```
输入：ContainerInfo[]（已过滤 containsMarkdown 或 textLength > 阈值）
输出：string[]

1. data-testid → [data-testid="message_content"]
2. role 属性 → [role="article"]
3. 语义类名 → .markdown.prose, .ds-markdown
4. 自定义元素 → message-content, .response-content
```

### 8.4 研究/生图开关步骤（researchMode.steps）

```
输入：ToggleInfo[]（已过滤 role 为 switch/radio/menuitem/menuitemradio/tab）
输出：steps 数组

对每个匹配的开关：
1. 生成主选择器：role + text → [role="menuitemradio"]（文本匹配在 text 字段）
2. 生成备选选择器：button（回退到语义标签 + text 匹配）
3. 生成 cancel 选择器：同主选择器或 aria-label 含"删除/remove"
```

### 8.5 去重与排序

- 同一平台同一元素类型，相邻优先级的候选选择器如果实际命中相同元素，只保留优先级最高的
- 候选选择器按稳定性（data-testid > aria > role > class > structure）排序，而非按特异性排序
- 每个元素类型至少保留 2 个候选，最多 5 个

## 9. 验证策略

### 9.1 实时验证（Phase 1）

agent 在生成选择器后，立即在页面中验证：

```javascript
// 验证选择器是否命中且唯一
const count = await page.$$eval(selector, els => els.length);
const visible = await page.$$eval(selector, els =>
  els.filter(el => el.offsetParent !== null || el.getBoundingClientRect().width > 0).length
);
// 通过条件：count > 0 && count === visible（所有命中元素都可见，无隐藏重复）
```

### 9.2 人工验证（Phase 1 & 2）

- agent 输出的 `selectors.ts` diff 需人工审核
- 审核重点：选择器是否过于宽泛（可能误匹配）、是否依赖不稳定类名
- 审核后在 `npm run dev` 中实际测试目标平台

## 10. 错误处理与边界情况

| 场景 | 处理方式 |
|------|---------|
| 浏览器未启动调试端口 | agent 输出明确错误信息，提示启动命令 |
| 平台页面未打开 | agent 列出缺失平台，询问是否用 `page.goto()` 导航 |
| 页面需要登录 | 如果已登录（正常情况），跳过；如果重定向到登录页，提示用户手动登录后重试 |
| 平台反自动化检测 | Playwright 使用 `--disable-blink-features=AutomationControlled` |
| 选择器命中 0 个元素 | 标记为 FAILED，不写入 selectors.ts |
| 选择器命中 > 10 个元素 | 标记为 TOO_BROAD，降级使用更具体的选择器 |
| 页面动态加载（SPA） | 等待 `networkidle` 后再注入探索脚本 |
| 探索脚本执行超时（> 10s） | 终止当前平台，记录失败原因，继续下一个 |

## 11. 与现有代码的关系

### 11.1 不修改的部分

- `selectors.ts` 的数据结构（`ModelSelector` 接口、`SelectorsConfig` 接口）保持不变
- `webviewScripts.ts` 的 `findElement` 函数保持不变
- `WebviewCard.tsx` 的注入/抓取逻辑保持不变

### 11.2 新增的部分

- `scripts/explore-dom.ts`：Phase 1 的 Playwright 探索脚本（不参与构建，仅开发维护时使用）
- `src/renderer/src/utils/domExplorer.ts`：Phase 2 的 DOM 探索脚本生成器（参与构建）
- `.temp/dom-exploration/`：中间产物目录（gitignore）

## 12. 使用示例

### Phase 1 典型工作流

```bash
# 1. 用户启动浏览器（调试模式）
start chrome --remote-debugging-port=9222

# 2. 用户在浏览器中打开需要探索的 AI 平台（已登录）

# 3. 用户告诉 agent："帮我更新 chatgpt 和 claude 的选择器"
#    Agent 执行：
#    a. npx playwright 连接 CDP
#    b. 注入 DOM 探索脚本到 chatgpt / claude 标签页
#    c. 分析 JSON，生成候选选择器
#    d. 在页面中验证选择器
#    e. 展示 diff 给用户审核
#    f. 用户确认后，更新 selectors.ts

# 4. 用户验证
npm run dev  # 确认 chatgpt / claude 功能正常
```

### Phase 2 典型工作流（后续）

```bash
# 1. 用户在 MultiChat app 中打开目标平台

# 2. 按 Ctrl+Shift+E 触发 DOM 导出
#    → 生成 .temp/dom-exploration/chatgpt-2026-06-28.json

# 3. 告诉 agent："根据最新的探索数据更新 chatgpt 选择器"

# 4. Agent 读取 JSON，分析，生成 diff，用户审核确认
```

## 13. 风险与缓解

| 风险 | 影响 | 缓解 |
|------|------|------|
| Playwright 被平台识别为 bot | 无法探索 | 使用 CDP 模式（连接真实浏览器，非自动化实例） |
| 平台需要手机验证/验证码 | 探索中断 | 提示用户手动完成验证，agent 等待后继续 |
| 生成的类名选择器有效期短 | 选择器快速失效 | 优先使用 data-testid、aria-label、role，类名仅作 fallback |
| 探索脚本影响页面性能 | 页面卡顿 | 脚本纯同步遍历，无网络请求，执行时间 < 500ms |

## 14. 成功标准

- [ ] 能在 10 分钟内完成一个平台的 DOM 探索 + 选择器生成 + 验证
- [ ] 生成的选择器中，至少 1 个为 data-testid 或 aria 级别（高稳定性）
- [ ] 生成的选择器在 `npm run dev` 中实际验证通过
- [ ] 中间产物（JSON）可人工审查，不含敏感对话内容
- [ ] Phase 1 不引入新的生产依赖