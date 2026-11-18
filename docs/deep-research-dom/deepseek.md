# DeepSeek — chat.deepseek.com

> Updated: 2026-11-18 00:40 (Asia/Shanghai)
> 状态：**BLOCKED(login)** — 停在手机号/微信扫码登录页

## 登录态

- iab 打开 `https://chat.deepseek.com/` 被重定向到 `https://chat.deepseek.com/sign_in`：
  手机号+验证码 / 密码登录 / Apple 登录 / 微信扫码，无法匿名进入聊天。
- **无未登录可用区**，composer/工具栏不可达。

## 现有配置核对（src/shared/config/selectors.ts models.deepseek）

| 配置项 | 选择器 | 可达性 | 备注 |
|---|---|---|---|
| textarea | `#chat-input` / `textarea[placeholder*="DeepSeek/发送/Message"]` / `textarea` | ⚠️ 未验证 | 登录页无 `#chat-input`（实测：登录页不存在该元素） |
| sendButton | `.ds-textarea-send-button` / `div[class*="send-button"]` / `button[class*="send-button"]` / `#chat-input + button` / `#chat-input ~ button` | ⚠️ 未验证 | 同上 |
| messageContainer | `div.ds-message` / `.ds-markdown.ds-assistant-message-main-content` / `div.ds-markdown` / `.ds-markdown` | ⚠️ 未验证 | 同上 |
| researchMode.steps | `['button','[role=button]','div']` text=`深度思考/Deep Thinking` | ❌ **语义错误** | 配置匹配的是"深度思考"（thinking），**不是** Deep Research；DeepSeek 网页端没有 Deep Research 功能 |
| researchMode.cancelSteps | 同上 | ❌ 语义错误 | 同上 |

## Deep Research 语义核验

DeepSeek 网页版功能与"Deep Research"不同名同构：

- **深度思考（Deep Thinking / R1 reasoning）**：输入框下方的"深度思考"开关，`button`/`div` 文案匹配，对应推理模式。**现有 steps 实际控制的是这个**——如果产品把"深度思考"当作 deepseek 的 researchMode 语义，那文案本身没问题，但注释与字段名容易误导（CLI `--research` 打开的是思考模式，不是联网调研）。
- **联网搜索**：单独的"联网搜索"开关，与研究无关。
- **无 Deep Research 报告流**：DeepSeek 不产出带侧边栏的长报告，消息正文就是 `div.ds-markdown`（与 messageContainer 配置一致，无独立 reportContainer 需求）。

结论：**DeepSeek 不存在 Deep Research 功能**。现有 researchMode 实际是"深度思考"开关的自动化——建议保留功能但在注释中说明语义差异，或按产品定义把 deepseek 的 researchMode 移除。

## 待登录态下复核

1. 在已登录 MultiChat webview 打开 `chat.deepseek.com`。
2. 确认"深度思考"开关元素（历史为 `div[role="button"]` 或 `button`，文案"深度思考"），记录其激活态类名（如 `ds-*`/`active`/`selected`）。
3. 确认 `#chat-input` 与 `.ds-textarea-send-button` 仍存在（DeepSeek 前端改版频繁）。
4. 若决定让 `--research` 在该平台语义="深度思考"，把 selectors.ts 里 steps 的 text 改为更精确的 `深度思考` 精确匹配（`exact: true`），避免命中"联网搜索"等相邻开关。

## 建议选择器方向（登录后填写/确认）

```ts
researchMode: {
  // ⚠️ 语义：这是"深度思考(推理)"开关，不是 Deep Research
  steps: [
    { selector: ['div[role="button"]', 'button'], text: '深度思考', exact: true, delay: 300 }
  ],
  cancelSteps: [
    { selector: ['div[role="button"]', 'button'], text: '深度思考', exact: true, delay: 300 }
  ]
}
```

## 备注

- 未对登录表单输入任何凭据。
- DeepSeek 无滑动验证门槛，登录后 DOM 可直接测；建议在 `persist:shared` 已登录 webview 里复核。
