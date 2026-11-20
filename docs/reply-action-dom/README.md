> Updated: 2026-11-20 11:28 (+08:00)

# AI 回复消息 DOM 结构探索

## 探索方式

通过 Codex 内置浏览器（IAB）登录各平台，发送结构化 Markdown 测试消息，回复完成后用 `locator.evaluate` 抓取 DOM 指纹。

## 平台状态

| 平台 | 登录 | 回复结构已探 | actionBar 已定位 | 备注 |
|---|---|---|---|---|
| ChatGPT | ✅ | ✅ | ✅ `div.flex.items-center.gap-0.5` | 5 个 icon 按钮 |
| Gemini | ✅ | ✅ | ✅ `div.buttons-container-v2` | 5 个 icon 按钮 |
| 千问 | ✅ | ✅ | ⚠️ 分散（code block 内 + 底部单按钮） | 无集中 actionBar，需新建挂载点 |
| 豆包 | ✅ | ✅ | ✅ `button.actionButton-m1fXIC` 组 | 右下角 5 个 icon |
| 元宝 | ✅ | ✅ | ✅ `div.ToolbarCopy_icon__5Odjl` 组 | `DIV` 非 `BUTTON` |
| Claude | ❌ | ❌ | ❌ | IAB 未登录，待补 |
| DeepSeek | ❌ | ❌ | ❌ | IAB 未登录，待补 |
| Kimi | ❌ | ❌ | ❌ | IAB 未登录，待补 |
| 文心一言 | ❌ | ❌ | ❌ | IAB 未登录，待补 |
| ChatGLM | ❌ | ❌ | ❌ | IAB 未登录，待补 |
| Perplexity | ❌ | ❌ | ❌ | Cloudflare 验证拦截 |
| Grok | ❌ | ❌ | ❌ | 待探 |
| Arena | ❌ | ❌ | ❌ | 待探 |

## 结论

1. **可行**：所有已探平台的回复消息都有稳定的"消息根 + 正文 + 底部操作区"三层结构，可以在 actionBar 末尾追加自定义按钮。
2. **选择器不统一**：每家平台的 actionBar 选择器差异很大（`div.flex` / `div.buttons-container-v2` / `button.actionButton-m1fXIC` / `div.ToolbarCopy_icon__*`），必须做 per-platform 配置。
3. **千问是例外**：没有集中 actionBar，按钮分散在 code block 内和消息底部，建议在 `qk-markdown-react` 末尾新建 `div.mc-action-bar`。
4. **注入方式**：MutationObserver 监听消息流容器，发现新 assistant 回复且未挂按钮时插入；SPA 导航后通过 `did-navigate-in-page` 重新注入。
5. **回传通道**：`webview.send('ipc-message', { channel: 'workbench:insert-reply', payload: { replyMd } })`，renderer 侧 `webview.addEventListener('ipc-message', handler)` 接收。
