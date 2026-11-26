# Gemini — gemini.google.com/app

> Updated: 2026-11-18 00:27 (Asia/Shanghai)

## 登录态

iab 已登录（Google 账号在 `persist:shared` 中）。composer 为 `rich-textarea .ql-editor`（Quill）。

## 现有选择器核验

| 配置选择器 | 结果 | 说明 |
|---|---|---|
| `rich-textarea .ql-editor[contenteditable="true"]` | ✅ 命中 | aria-label="为 Gemini 输入提示" |
| `rich-textarea [contenteditable="true"]` | ✅ 命中 | 2 个候选（编辑器 + 备用） |
| `button.send-button.submit` | ⚠️ 待复验 | 发送钮由 aria-label 兜底覆盖 |
| `button[aria-label*="发送"]` | ✅ 语义存在 | 发送按钮存在 |
| `button.toolbox-drawer-button` | ❌ 失效 | 页面上无此类名按钮 |
| `mat-list-item.mat-mdc-list-item` text=Deep Research | ⚠️ 部分 | 类仍在内层 button，但被两级菜单遮挡 |
| `button.toolbox-drawer-item-list-button` | ⚠️ 部分 | 同上 |
| `button.toolbox-drawer-item-deselect-button` (cancel) | ⚠️ 待复验 | 需选中后核对 |

## 实际 Deep Research 启用链路（实测）

入口已变成两级菜单，**不是**单击一个工具按钮：

1. 点 `button[aria-label="上传和工具"]`（原"工具"抽屉钮已重命名 aria-label）。
2. 弹层出现 `上传文件 / 从云端硬盘添加 / 更多上传选项 / 制作图片 / 制作视频 / 更多工具`。
3. 点 `button` 文本 `更多工具`（mat-list-item）。
4. 第二层出现 `TOOLBOX-DRAWER-ITEM`（`制作音乐 / Canvas / Deep Research / 学习辅导`），其内层 `<button class="mat-mdc-list-item ...">` 文本 `Deep Research`。

### 关键 DOM（来自 iab 实测）

```
第 1 级 opener：
<button aria-label="上传和工具" class="mdc-icon-button mat-mdc-icon-button ...">

第 1 级"更多工具"项：
<button class="mat-mdc-list-item ... toolbox-...">更多工具</button>

第 2 级 Deep Research：
<TOOLBOX-DRAWER-ITEM class="mat-mdc-tooltip-trigger toolbox-drawer-menu-item ...">
  <button class="mat-mdc-list-item mdc-list-item mat-mdc-list-item-interactive ..."
          mat-list-item type="button">Deep Research</button>
</TOOLBOX-DRAWER-ITEM>
```

## 建议替换 AutomationStep

```ts
researchMode: {
  steps: [
    { selector: 'button[aria-label="上传和工具"], button[aria-label="Tools"], button[aria-label*="工具"]', delay: 500, menuOpenerFallback: true },
    { selector: 'button.mat-mdc-list-item, mat-list-item button, [role="menuitem"]', text: ['更多工具', 'More tools', 'Tools'], delay: 400, optional: true },
    { selector: ['toolbox-drawer-item button.mat-mdc-list-item', 'button.mat-mdc-list-item', 'mat-list-item button', '[role="menuitem"]'], text: 'Deep Research', delay: 500 }
  ],
  cancelSteps: [
    { selector: ['toolbox-drawer-item button.mat-mdc-list-item', 'button.mat-mdc-list-item'], text: 'Deep Research', delay: 200 }
  ]
}
```

第 2 步 optional：若 Deep Research 已在第 1 级可见可跳过"更多工具"。

## 备注

- `reportContainer` 未配置。Deep Research 产出出现在右侧/会话内 mat-card 区，需单独核验再补。
- 取消态：Deep Research 选中后该项出现选中样式；`toolbox-drawer-item-deselect-button` 是否仍存在需在选中态复核。
