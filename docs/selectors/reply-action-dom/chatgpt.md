> Updated: 2026-11-20 11:28 (+08:00)

# ChatGPT — chatgpt.com

## 登录态

IAB 已登录（`persist:shared` 独立，不影响 MultiChat 的 webview session）。

## 回复消息结构

```
main
  └─ container (region "对话")
       └─ container
            ├─ container "你说："          ← 用户消息
            │    ├─ text 用户 prompt
            │    ├─ button "复制消息"
            │    ├─ button "共享提示"
            │    └─ button "编辑消息"
            │
            └─ container                    ← AI 回复（msgRoot，无稳定选择器）
                 ├─ heading "ChatGPT 说：" [level=4]
                 ├─ heading "测试标题" [level=2]    ← 正文第一个内容块
                 ├─ list                      ← 有序列表
                 ├─ container "JavaScript"    ← code block
                 │    ├─ checkbox "启用自动换行"
                 │    ├─ button "复制代码"
                 │    └─ code console.log("hi")
                 ├─ list                      ← 无序列表
                 ├─ blockquote                ← 引用
                 ├─ container "加粗 和 inline code。"
                 ├─ button "复制"              ← actionBar 第 1 个
                 ├─ pop up button "评价回复"   ← actionBar 第 2 个
                 ├─ checkbox "朗读"           ← actionBar 第 3 个
                 ├─ button "分享"             ← actionBar 第 4 个
                 └─ pop up button "更多操作"   ← actionBar 第 5 个
```

## 关键选择器

| 层级 | 选择器 | 说明 |
|---|---|---|
| 消息根 | 无稳定 `data-*`，靠 `h2` 向上找含 `ChatGPT 说：` 的祖先 | 可用 `article` 或 `div:has(> h4:has-text("ChatGPT 说："))` |
| 正文 | `h2` 到 actionBar 之前的兄弟容器 | 复用 `generateGetLatestResponseScript` |
| actionBar | `div.flex.items-center.gap-0.5.browser\:gap-0.min-h-5.min-w-0.flex-wrap` | 5 个 icon 按钮组 |

## actionBar 按钮明细

| aria-label | 元素 | 说明 |
|---|---|---|
| 复制 | `button` | 复制全文 |
| 评价回复 | `pop up button` | 展开评价面板 |
| 朗读 | `checkbox` | 语音朗读开关 |
| 分享 | `button` | 分享链接 |
| 更多操作 | `pop up button` | 更多菜单（编辑/重新生成/删除）|

## 注入点建议

在 actionBar 末尾（`更多操作` 之后）追加两个 `button`：`插入到当前文档` / `存为新文档`。按钮样式继承 `button` 基础样式 + `cursor-interaction` class。
