> Updated: 2026-11-20 11:28 (+08:00)

# 千问 — qianwen.com

## 登录态

IAB 已登录。

## 回复消息结构

```
body
  └─ div.wrapper-Yv2YGq                     ← 消息流容器
       └─ div.auto-center-wrapper-VqwKSm    ← msgRoot
            ├─ text 用户 prompt
            ├─ container
            │    └─ container qk-markdown-react   ← 回复正文
            │         ├─ heading "测试标题" [level=2, class="qk-md-head"]
            │         ├─ list
            │         ├─ container "js"        ← code block
            │         │    ├─ button "编辑"
            │         │    ├─ button ×3 (icon only)
            │         │    └─ code
            │         ├─ list
            │         ├─ text 引用句。
            │         └─ container "加粗 和 inline code。"
            └─ image / button (单 icon)      ← 消息底部右侧散落按钮
```

## 关键选择器

| 层级 | 选择器 | 说明 |
|---|---|---|
| 消息根 | `div.auto-center-wrapper-VqwKSm` | 类名带 hash，不稳定但当前可用 |
| 正文 | `div.qk-markdown-react` | 稳定 |
| actionBar | 无统一容器；操作按钮分散在 code block 内（`编辑`+3 icon）和消息底部 | 需要自定义注入点 |

## actionBar 特征

千问**没有集中的"消息底部 actionBar"**：
- code block 内：编辑 + 3 个 icon 按钮（复制/执行/保存）
- 消息底部右侧：1 个 icon 按钮（用途不明，可能是"更多"）

## 注入点建议

在 `qk-markdown-react` 末尾追加一个自定义 `div` 作为 actionBar，内含两个按钮。由于千问操作区分散，建议在消息容器底部新建一个 `div.mc-action-bar` 而不是挂到现有按钮组。
