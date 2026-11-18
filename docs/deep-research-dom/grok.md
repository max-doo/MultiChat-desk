# Grok — grok.com

> Updated: 2026-11-18 00:27 (Asia/Shanghai)

## 登录态

iab 未登录（grok.com 首加载报 `Something went wrong`，刷新后进入未登录 UI）。HTTP 探测确认页面含 `deepSearchSupportsTrace`、`deepsearch_workspace_id`、`show_deepsearch_suggestion_pill` 等功能开关——**DeepSearch 功能存在**。

## 现有选择器核验

| 配置选择器 | 结果 | 说明 |
|---|---|---|
| `textarea[placeholder*="Ask"]` | ✅ 命中 | 未登录 composer 有 textarea |
| `button[aria-label*="Send"]` | ✅ 语义存在 | 发送钮存在 |
| `button` text=`DeepSearch` | ❌ 失效 | 输入区旁无 DeepSearch 文本按钮 |
| `button[aria-label*="删除"]` (cancel) | ❌ 无关 | 非研究退出钮 |

## 实测发现（未登录 iab）

输入区右侧只有：

```
<button aria-label="添加文件、技能和连接器">   ← + 菜单（文件/技能/连接器）
<button aria-label="型号: Fast" id="model-select-trigger">  ← 模型下拉
  选项：Fast / Build / Auto / Expert / Heavy   ← 无 DeepSearch
<button aria-label="听写">
<button aria-label="语音模式">
```

`+ 菜单` → `技能` 子菜单只列 `docx / pdf / pptx / xlsx / 管理技能`，**无 DeepSearch**。

## 结论

- **未登录态下 DeepSearch 入口不可见**。功能在响应配置里存在（`deepsearch_workspace_id`、suggestion pill 开关），但 UI 入口很可能要登录/Premium 才渲染，或被合并进默认搜索行为。
- 现有 `button` text=DeepSearch 选择器在未登录页 **找不到目标**，等同失效。
- **需要在已登录 MultiChat webview（`persist:shared`）里复核**：若登录后输入区出现独立 `DeepSearch` pill 钮（参考旧 `深度研究dom.md` 里的 `button[data-slot="button"]DeepSearch`），则把选择器补为：

```ts
researchMode: {
  steps: [
    { selector: 'button[data-slot="button"], button', text: ['DeepSearch', 'DeeperSearch', '深度搜索'], delay: 500 }
  ],
  cancelSteps: [
    { selector: 'button[data-slot="button"], button', text: ['DeepSearch', 'DeeperSearch'], delay: 200, optional: true }
  ]
}
```

- 若登录后依然没有入口，则 Deep Research 在 Grok 侧应视为不可用/已并入默认搜索，相应任务模式要禁掉。

## 备注

需在已登录 MultiChat webview 里开 grok.com 复核输入区是否出现 DeepSearch 文本按钮/图标钮。未登录态不构成最终结论。
