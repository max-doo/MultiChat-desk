# 豆包 — www.doubao.com/chat

> Updated: 2026-11-17 15:44 (Asia/Shanghai)

## 登录态

iab 已登录（用户手动登录）。

## 生图结果 DOM（实测）

```
消息气泡内：
<div class="image-box-grid-EYaIcP"                          ← hash class 会变
     data-finished="true"
     data-testid="message_image_content"                    ← 稳定标识
     style="grid-template-columns: repeat(4, 1fr); ...">
  <div class="image-box-grid-item-FTeESI image-box-item-radius-q1bM2P">
    <div class="relative inline-flex h-fit w-fit" draggable="true">
      <div class="target-eNSH4R"><div class="container-dLabXv"><div class="container-MzuYIN">
        <div class="image-wrapper-YJelRW clickable-axeVcZ"
             data-testid="mdbox_image"                      ← 稳定标识，可点击
             style="...">
          <picture>
            <source type="image/avif" srcset="https://p11-flow-imagex-sign.byteimg.com/...rc_gen_image/...">
            <img alt="" src="data:image/svg+xml,...">      ← 实际是 svg 占位 + picture source
          </picture>
```

## 实测下载链路

**关键**：点击图片会**直接打开预览面板**（不是 hover）。预览面板右上工具栏有：
- `创建画布` 按钮（左上）
- 一组编辑工具图标
- `...` 更多
- **`[data-testid="edit_image_download_button"]`** ← 蓝色 ↓ 下载按钮
- `x` 关闭预览

点击下载按钮后真实下载 `生图：红色圆形在白色背景.png`（原图 PNG）到 `Downloads/`。

## 实测验证通过的选择器（新）

```ts
imageDownload: {
  steps: [
    // 步骤1：点最新生图，打开预览面板
    { selector: '[data-testid="mdbox_image"], [data-testid="message_image_content"] img, [class*="image-box-grid"] img', delay: 800 },
    // 步骤2：点预览面板的下载按钮
    { selector: '[data-testid="edit_image_download_button"]', delay: 300 }
  ],
  closePreviewSelector: 'button[aria-label="关闭"], [class*="preview"] button[class*="close"]'
}
```

## 现有配置为什么失效

```ts
{ selector: 'div.image-box-grid-EYaIcP img, ...', hover: true },
{ selector: 'div.hover-actions-slot-_hVW2k div.action-nxGadz:last-of-type, ...' }
```

- `image-box-grid-EYaIcP` 仍在（实测确认），但 **没有 hover-actions-slot 浮层了**——豆包把"下载"从图片 hover 浮层挪到了点击后的预览面板。
- 需要改成"点击图 → 等预览 → 点 `[data-testid=edit_image_download_button]`"。

## 注意

- `data-testid="mdbox_image"` 是**列表里所有图片**共用，注入脚本要选**最新一张**（`.last()` 或 `Array.at(-1)`）。
- 多张生图时，预览面板默认显示点击的那一张。
- 图片源是 `p11-flow-imagex-sign.byteimg.com` CDN，签名 URL，需走浏览器原生点击下载。
