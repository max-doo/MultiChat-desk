# Claude — claude.ai

> Updated: 2026-11-18 00:40 (Asia/Shanghai)
> 状态：**BLOCKED(login)** — 本次核验无法到达聊天页

## 登录态

- iab 打开 `https://claude.ai/new` 被强制重定向：
  `claude.ai/logout?involuntary=1&returnTo=%2Flogin%3Ffrom%3Dlogout%26reauth%3D1...`
  最终落在 `https://claude.ai/login`（"登录或创建账户"页）。
- 服务端同时套了 Cloudflare managed challenge（`Just a moment...`，403），未登录时连首页 HTML 都拿不到。
- **无法在未登录状态下看到 composer**，Deep Research 入口不可达。

## 现有配置核对（src/shared/config/selectors.ts models.claude）

| 配置项 | 选择器 | 可达性 | 备注 |
|---|---|---|---|
| textarea | `[contenteditable="true"]` / `div[data-placeholder]` / `.ProseMirror` / `div[class*="ProseMirror"]` | ⚠️ 未验证 | 登录页无可测 |
| sendButton | `button[aria-label*="Send"]` / `button[type="submit"]` / `fieldset button:last-child` | ⚠️ 未验证 | 同上 |
| messageContainer | `[data-is-streaming]` / `.prose` / `[class*="contents"] .prose` | ⚠️ 未验证 | 同上 |
| researchMode | **未配置** | — | 正确：Claude 网页端的研究能力在工具菜单内，而非独立开关 |

## Deep Research 功能说明（供后续核验）

Claude 的"深度研究"在 2025 年后半已合并进 **工具/功能菜单**（Composer 内 `+` 或工具图标 → "Research"/"深度研究"）。特征：

- 打开入口通常是 composer 工具条上的 `button[aria-label*="Attach"]` / `+` 按钮或 `button[aria-label*="tools" i]`；
- 菜单项是 `div[role="menuitem"]` 或带 `data-testid` 的按钮，文案 "Research"；
- 开启后 composer 出现 pill/标签态，可再次点击取消；
- 报告产出在正常消息流中（`.prose` / `[data-testid="assistant-message"]`），无独立 report 容器。

**待登录态下复核**：需要在已登录的 MultiChat webview（`persist:shared`）里开 `claude.ai/new` 实际点一次菜单，确认 role/testid。届时若补 `researchMode` 配置，建议步骤形态：

```ts
researchMode: {
  steps: [
    { selector: ['button[aria-label*="Attach" i]', 'button[aria-label*="附加" i]', 'button[aria-label*="tools" i]', 'button[aria-label*="工具" i]'], delay: 500, menuOpenerFallback: true },
    { selector: ['div[role="menuitem"]', '[role="menuitem"]', 'button'], text: ['Research', '研究', '深度研究'], delay: 500 }
  ],
  cancelSteps: [
    { selector: ['button[aria-label*="Remove" i]', 'button[aria-label*="移除" i]', '[class*="pill"] button'], delay: 300, optional: true }
  ]
}
```

## 最小等价验证步骤（登录后）

1. `npm run dev` 打开 MultiChat，加 claude.ai webview 并登录。
2. 在 webview console（`Ctrl+Shift+I` 或注入）执行：`[...document.querySelectorAll('[role="menuitem"],button')].filter(e=>/research|研究/i.test(e.innerText||''))`。
3. 记录命中元素的 tag/role/aria/data-testid，回填到本文件与 selectors.ts。

## 备注

- Cloudflare challenge 对 iab 与 Electron webview 行为一致；`persist:shared` 已登录会话一般可直接进入，不需额外过墙。
- 本次未对任何登录表单输入凭据。
