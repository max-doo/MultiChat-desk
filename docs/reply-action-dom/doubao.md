> Updated: 2026-11-20 11:28 (+08:00)

# 豆包 — doubao.com/chat

## 登录态

IAB 已登录。

## 回复消息结构

```
body
  └─ container chat-route-layout
       └─ container
            ├─ container (用户消息)
            │    ├─ text 用户 prompt
            │    ├─ button ×2 (icon)
            │    └─ button "更多"
            │
            └─ container doc_editor          ← AI 回复（msgRoot 候选）
                 ├─ heading "测试标题" [level=2]
                 ├─ list
                 ├─ container (code block)
                 │    ├─ button "免费"       ← code 操作
                 │    └─ code
                 ├─ list
                 ├─ text 引用句。
                 ├─ container "加粗 和 inline code。"
                 ├─ button ×5 (右下角 icon)   ← actionBar：actionButton-m1fXIC
                 │    ├─ 复制
                 │    ├─ 朗读
                 │    ├─ 免费
                 │    └─ 更多
                 └─ text 今天 11:26
```

## 关键选择器

| 层级 | 选择器 | 说明 |
|---|---|---|
| 消息根 | `div.doc_editor` 或 `div[class*="w-full pl-14"]` | `doc_editor` 是输入框容器类名，复用可能冲突；需验证 |
| 正文 | `div[class*="content-"]` 或 `div.my-0.w-full.mx-auto` | 类名带 hash |
| actionBar | `button.actionButton-m1fXIC` 的公共父容器 | 右下角 5 个 icon 按钮 |

## actionBar 按钮明细

| 文本/aria | 元素 | 说明 |
|---|---|---|
| - | `button.actionButton-m1fXIC` ×5 | 复制 / 朗读 / 免费 / 更多 / 其他 icon |

## 注入点建议

在 `actionButton-m1fXIC` 的公共父容器末尾追加两个 `button`。样式继承 `dbd-button dbd-button--type-ms dbd-button--glyph-m`。
