# 智谱清言 — chatglm.cn/main/alltoolsdetail

> Updated: 2026-11-18 00:40 (Asia/Shanghai)
> 状态：**BLOCKED(captcha)** — 滑动验证页拦截，未能进入聊天页

## 拦截情况

- iab 打开 `https://chatglm.cn/main/alltoolsdetail` 被重定向到带 `refer__991=...` 的验证页：
  `capture-container` → `访问验证 / 别离开，为了更好的访问体验，请进行验证`（TraceID 页）。
- 这是智谱的网关级滑块验证，不是页面内验证码；自动化滑块一次未尝试（按任务约束只允许一次且预期成功率低）。
- **无法到达输入框与工具区**，所有 DOM 核验均不可达。

## 现有配置核对（src/shared/config/selectors.ts models.chatglm）

| 配置项 | 选择器 | 可达性 | 备注 |
|---|---|---|---|
| textarea | `textarea[placeholder*="输入/请输入/提问"]` / `textarea` / `[contenteditable="true"]...` | ⚠️ 未验证 | 被拦在验证页 |
| sendButton | `button[type="submit"]` / `button[aria-label*="发送"]` / `form button[type="submit"]` / `[role="button"][aria-label*="发送"]` | ⚠️ 未验证 | 同上 |
| messageContainer | `[data-message-author-role]` / `[data-role]` / `[data-testid]` / `.assistant .prose` / `.markdown-body` / `.prose` / `[class*="markdown"]` | ⚠️ 未验证 | 同上 |
| reportContainer | `#app > section > div.task-aside-container` / `div.task-aside-container` | ⚠️ 未验证 | 研究报告右侧栏，需到 alltoolsdetail 实测 |
| researchMode.steps | `['button','[role=button]','[role=menuitem]','[role=menuitemradio]','[role=tab]']` text=`深度研究/联网研究/研究模式/Deep Research/Research` | ⚠️ 未验证（弱匹配风险高） | 纯文本匹配，无 role/data 锚点，命中面过宽 |
| researchMode.cancelSteps | 同上 | ⚠️ 未验证 | 与 steps 相同，若按钮文案不变则无法区分"开/关" |

## Deep Research 功能说明（供后续核验）

智谱清言的"深度研究"历史形态（`alltoolsdetail` 页面）：输入区上方或工具栏出现"深度研究"入口，开启后右侧出现 `div.task-aside-container` 报告栏（与配置的 `reportContainer` 吻合）。特征：

- 入口可能是 `button` 或 `[role="button"]` 带"深度研究"文案；
- 老选择器只按文本过滤，若页面文案改为"联网研究/AI 搜索/AutoGLM 沉思"等同义词则失配；
- 开启态常以按钮高亮/描边表达，cancel 需找激活态元素。

**待过验证后复核**：

1. 在已登录 MultiChat webview 打开 `chatglm.cn/main/alltoolsdetail`。
2. 找到研究入口元素，记录真实 tag/role/aria/data-*（若有 `data-log-*`、`data-testid`、`track` 类语义属性，优先用作锚点）。
3. 确认 `div.task-aside-container` 仍是报告容器。

## 建议的新选择器方向（验证后填写）

```ts
researchMode: {
  steps: [
    // 先用语义属性 + 文本双锚点收窄命中面，避免误点"联网搜索"等其它入口
    { selector: ['button', '[role="button"]'], regex: '深度研究|Deep ?Research', delay: 700 }
  ],
  cancelSteps: [
    // 需要区分激活态：优先 aria-pressed/selected 类，退而找退出/移除图标
    { selector: ['button[aria-pressed="true"]', 'button[class*="selected"], button[class*="active"]'], regex: '深度研究|Deep ?Research', delay: 300, optional: true }
  ]
}
```

## 最小等价验证步骤（验证页解除后）

1. 在 MultiChat webview 手动过一次滑动验证（或等 IP 冷却）。
2. Console：`[...document.querySelectorAll('button,[role=button],[role=menuitem],[role=tab]')].filter(e=>/研究|Research|research/i.test(e.innerText||''))` 收集候选。
3. 点开入口，确认 `div.task-aside-container` 出现 → `reportContainer` 可用。
4. 记录激活态与取消按钮 DOM，回填本文件与 selectors.ts。

## 备注

- 该站点对自动化访问极敏感，iab 与 webview 都会触发同一网关验证；建议在已登录 `persist:shared` 会话中完成核验。
- 本次未尝试绕过验证。
