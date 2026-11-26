# Gemini — gemini.google.com

> Updated: 2026-11-17 16:04 (Asia/Shanghai)

## 登录态

iab 已登录（galaxydmx0@gmail.com）。

## 生图结果 DOM

```
<response-element>
  <div class="attachment-container generated-images md-has-block-component">
    <generated-image class="luminous-layout ng-star-inserted">
      <single-image class="generated-image large luminous-layout">
        <img class="image animate loaded" src="blob:...">           ← blob 预览
        <div class="overlay-container">
          <div class="generated-image-controls hide-from-message-actions">
            <download-generated-image-button class="ng-star-inserted"
                                             arialabel="下载完整尺寸的图片"
                                             data-test-id="download-generated-image">
              <gem-icon-button class="mat-mdc-tooltip-trigger on-hover-button">
                <button aria-label="下载完整尺寸的图片" class="mdc-icon-button mat-mdc-icon-button">
```

## 实测验证

- `download-generated-image-button` 是 Angular 组件 tag，稳定。
- `data-test-id="download-generated-image"` 也可用作 hook。
- 按钮 aria-label="下载完整尺寸的图片"（中文）；英文是 `Download full-size image`。
- AX tree 显示按钮文本就是 `button 下载完整尺寸的图片`。
- **点击按钮后 Playwright `download` 事件不触发**——可能 Gemini 走 `fetch → blob → URL.createObjectURL` 内部下载。但 Electron `will-download` 是 Chromium 网络层事件，**会捕获这种下载**——Playwright 事件不触发不代表 webview 下载失败。
- `img.src` 是 `blob:` URL，所以 `extractImages` 兜底路径只能拿到低质预览。

## 现有配置评估

```ts
imageDownload: {
  steps: [
    { selector: 'generated-image, single-image.generated-image, div.generated-images generated-image', delay: 300, hover: true },
    { selector: 'button[aria-label="下载完整尺寸的图片"], download-generated-image-button button', delay: 300 }
  ]
}
```

**选择器正确**。问题可能在：
1. hover 步骤触发不了 on-hover-button 显示（但按钮即使透明也在 DOM 中可点）。
2. 主进程 will-download 是否捕获了 Gemini 的 blob 下载——待真实 dev 环境验证。

## 建议（可选优化）

把 hover 步骤去掉（按钮本就在 DOM）：

```ts
imageDownload: {
  steps: [
    { selector: 'button[aria-label="下载完整尺寸的图片"], button[aria-label="Download full-size image"], download-generated-image-button button', delay: 300 }
  ]
}
```
