> Updated: 2026-11-20 11:28 (+08:00)

# 元宝 — yuanbao.tencent.com

## 登录态

IAB 已登录。

## 回复消息结构

```
body
  └─ div.agent-chat__list.agent-chat__list__hunyuan.agent-chat__list--qa-nav  ← msgRoot
       ├─ container (用户消息)
       │    ├─ text 用户 prompt
       │    ├─ container 编辑
       │    ├─ container 复制
       │    └─ container 分享
       │
       └─ container                          ← AI 回复
            ├─ container
            │    ├─ heading "测试标题" [level=2]
            │    ├─ list
            │    ├─ container "js"         ← code block
            │    │    ├─ container 复制
            │    │    ├─ container 保存
            │    │    └─ code
            │    ├─ list
            │    ├─ text 引用句。
            │    └─ text 加粗 和 inline code。
            ├─ container 复制               ← actionBar 第 1 个
            ├─ container 更多复制选项        ← actionBar 第 2 个
            ├─ container 收藏              ← actionBar 第 3 个
            ├─ container 点赞              ← actionBar 第 4 个
            ├─ container 点踩              ← actionBar 第 5 个
            ├─ container 重新生成           ← actionBar 第 6 个
            ├─ container 分享              ← actionBar 第 7 个
            └─ container 更多              ← actionBar 第 8 个
```

## 关键选择器

| 层级 | 选择器 | 说明 |
|---|---|---|
| 消息根 | `div.agent-chat__list` | 稳定类名 |
| 正文 | `div.hyc-common-markdown` 或 `div[class*="markdown"]` | 待验证 |
| actionBar | `div.ToolbarCopy_icon__5Odjl` 的公共父容器 | `DIV` 非 `BUTTON`，aria-label="复制" |

## actionBar 按钮明细

| 文本/aria | 元素 | 说明 |
|---|---|---|
| 复制 | `div.ToolbarCopy_icon__5Odjl` (aria-label="复制") | 复制全文 |
| 更多复制选项 | `div.ToolbarCopy_arrowIconWrap__GR0vU` | 复制格式选择 |
| 收藏 | `div` | 收藏 |
| 点赞 | `div` | 点赞 |
| 点踩 | `div` | 点踩 |
| 重新生成 | `div` | 重新生成 |
| 分享 | `div` | 分享 |
| 更多 | `div` | 更多菜单 |

## 注入点建议

在 actionBar 末尾（`更多` 之后）追加两个 `div`/`button`。样式继承 `ToolbarCopy_icon__5Odjl` 的基础样式。
