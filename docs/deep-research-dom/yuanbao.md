# 元宝 — yuanbao.tencent.com/chat

> Updated: 2026-11-18 00:27 (Asia/Shanghai)

## 登录态

iab 未登录（公开聊天页可进）。HTTP `GET /chat` 返回 SPA 骨架，深度研究入口由 JS 渲染——以 iab DOM 实测为准。

## 配置状态

`models.yuanbao` **未配置 `researchMode`**（也未配 reportContainer）。

## Deep Research 入口（实测）

输入区（composer）附件/工具条里有专门的深度研究钮：

```
<button type="button"
        aria-label="深度研究"
        data-application-id="application_id_deep_research"   ← 稳定语义钩子
        data-atom-index="1"
        class="flex h-7 shrink-0 items-center justify-center gap-1 ...">
  深度研究
</button>
```

特点：
- `data-application-id="application_id_deep_research"` 是平台给的稳定 id，比文本匹配更可靠。
- 钮在输入框上方工具条（`div.new-framework-input_searchContent__*`），**不在弹层里，无需先点开**。

## 取消/退出态

实测未点到选中态；按元宝惯例选中后钮 aria-label 不变、出现选中样式或 `aria-pressed="true"`，需在选中态复核退出钩子。

## 建议补配置

```ts
researchMode: {
  steps: [
    { selector: 'button[aria-label="深度研究"][data-application-id="application_id_deep_research"], button[data-application-id="application_id_deep_research"], button[aria-label="深度研究"]', delay: 500 }
  ],
  cancelSteps: [
    { selector: 'button[data-application-id="application_id_deep_research"][aria-pressed="true"], button[data-application-id="application_id_deep_research"]', delay: 200, optional: true }
  ]
}
```

## reportContainer

未核验。深度研究产出一般在消息流内（`hyc-common-markdown` 系），现有 `messageContainer` 可能已能覆盖；若要抓整份报告需单独复测报告容器。
