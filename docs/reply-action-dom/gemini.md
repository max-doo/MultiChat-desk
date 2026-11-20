> Updated: 2026-11-20 11:28 (+08:00)

# Gemini — gemini.google.com/app

## 登录态

IAB 已登录。

## 回复消息结构

```
body
  └─ infinite-scroller.chat-history          ← msgRoot（稳定 tag+class）
       └─ container (conversation)
            ├─ container "你说 ..."          ← 用户消息
            │    ├─ text 用户 prompt
            │    ├─ button "复制提示"
            │    └─ button "修改"
            │
            └─ container model-response-message-contentr_<id>  ← AI 回复正文
                 ├─ heading "Gemini 说" [level=6]
                 ├─ heading "测试标题" [level=2]
                 ├─ list
                 ├─ container "JavaScript"    ← code block
                 │    ├─ button "下载代码"
                 │    ├─ button "复制代码"
                 │    └─ code
                 ├─ list
                 ├─ blockquote
                 ├─ container "加粗 和 inline code。"
                 ├─ checkbox "答得好"          ← actionBar 第 1 个
                 ├─ checkbox "答得不好"        ← actionBar 第 2 个
                 ├─ button "重做"             ← actionBar 第 3 个
                 ├─ button "复制"             ← actionBar 第 4 个
                 └─ button "显示更多选项"      ← actionBar 第 5 个
```

## 关键选择器

| 层级 | 选择器 | 说明 |
|---|---|---|
| 消息根 | `infinite-scroller.chat-history` | 稳定 tag + class |
| 正文 | `div[class*="model-response-message-content"]` | 带会话 ID 的类名 |
| actionBar | `div.buttons-container-v2` | 5 个 icon 按钮组 |

## actionBar 按钮明细

| aria-label | 元素 | 说明 |
|---|---|---|
| 答得好 | `checkbox` | 好评 |
| 答得不好 | `checkbox` | 差评 |
| 重做 | `button` | 重新生成 |
| 复制 | `button` | 复制全文 |
| 显示更多选项 | `button` | 更多菜单 |

## 注入点建议

在 `buttons-container-v2` 末尾追加两个 `button`。样式继承 `mdc-icon-button mat-mdc-icon-button`。
