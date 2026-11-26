# Kimi — kimi.com

> Updated: 2026-11-18 00:27 (Asia/Shanghai)

## 登录态

iab 未登录 / 公开首页。HTTP `GET /` 确认 sidebar 里有 `深度研究` 导航项。

## 配置状态

`models.kimi` **未配置 `researchMode`**（也没有 reportContainer）。现有 textarea/sendButton 与 Deep Research 无关。

## Deep Research 入口（实测）

**不是输入框内的模式切换，而是独立页面链接**：

```
左侧导航 / 推荐区：
<a href="/deep-research"
   class="next-sidebar-nav-item"
   data-testid="sidebar-nav-deep-researcher">
   <span class="next-sidebar-nav-item__label">深度研究</span>
</a>

homepage 快捷入口形态：
<a class="publisher-shortcut__link" data-v-5111445e
   href="/deep-research">深度研究</a>
```

`GET /` 静态 HTML 中同时出现 `data-testid="sidebar-nav-deep-researcher"` 与 `href="/deep-research"`——两种 placement 都是普通 `<a>` 链接。

## 结论

- **功能存在**，但形态是"独立 Deep Research 会话页"（`kimi.com/deep-research`），不是普通会话内的开关。
- `researchMode.steps`（输入框内点击序列）这个抽象 **不适用**：要启用应直接导航到 `https://www.kimi.com/deep-research`，而不是在普通聊天里点按钮。
- 建议：平台级判断"走 deep-research 会话 URL"。如必须保留 step 抽象，可写成打开链接：

```ts
// 方案 A（推荐）：独立页面，不走 steps
researchConversationUrl: 'https://www.kimi.com/deep-research'

// 方案 B（若必须走 steps）：点导航链接
steps: [
  { selector: 'a[href="/deep-research"], [data-testid="sidebar-nav-deep-researcher"]', delay: 500 }
]
```

- `reportContainer`：Deep Research 报告在专属页内呈现（`/deep-research` 路由），未核验其容器结构；如需抓取报告需在 deep-research 会话页复测。
