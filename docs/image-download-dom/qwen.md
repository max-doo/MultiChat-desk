# 通义千问 — qianwen.com

> Updated: 2026-11-17 16:18 (Asia/Shanghai)

## 登录态

iab 已登录（`Qwen8716`）。**域名已从 `tongyi.aliyun.com` 迁到 `qianwen.com`**（旧文档记载 `tongyi.aliyun.com/qianwen` 已过时）。

## 生图结果 DOM

```
<div class="card card_card_ai_generate_image">          ← 稳定 class：card_card_ai_generate_image
  <div class="image-card-wrapper">
    <div class="imageCard-D5bm-cgsHJ">
      <div class="imagesContainer-D5bm-GvC0T complete-D5bm-3pXsZ">
        <div class="verticalImageContainer-D5bm-3Phkm">
          <div class="imageItem-D5bm-1LmyV imageWrapper-D5bm-2rQuh
                      complete-D5bm-3pXsZ singleImage-D5bm-1cDG-
                      lessThanFourImage-D5bm-1g8Jx ratioHeightLess2To1-D5bm-1y-wC"
               style="aspect-ratio: 3 / 4;">
            <img src="https://workspace-zb-cdn.qianwen.com/.../o/....png?auth_key=..."
                 data-image-resource-id="<hash>"
                 data-image-resource-width="1760"
                 data-image-resource-height="2368"
                 data-image-menu-items="add-to-chat"
                 data-image-watermark-url="..."  />
            <div class="popMenu-D5bm-6d5SJ">              ← 默认 display:none，hover 图才显示
              <div class="popMenuItem-D5bm-3vNEz">
                <svg class="addChatIcon-D5bm-2xIV2">...</svg>
                <span>添加到对话</span>
              </div>
              <div class="popMenuItem-D5bm-3vNEz">          ← 下载按钮（无 aria-label/text）
                <svg class="downloadIcon-D5bm-2Z72q">...</svg>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</div>
```

## 实测验证

- 生图是单张 PNG（1760x2368），走 `workspace-zb-cdn.qianwen.com` HTTPS URL（**不是 blob**——`extractImages` 兜底也能拿到原图）。
- `data-image-resource-id` / `data-image-resource-width/height` 是稳定 hook（不由 CSS Modules 哈希影响）。
- **`div.popMenu-*` 默认 `display:none`，需要 hover 图片才显示**——`popMenuItem` 直接 `click` 会报 not_visible。
- 下载项**没有 aria-label 也没有文本**，只能通过内含的 `svg[class*="downloadIcon"]` 匹配。
- `card_card_ai_generate_image` 是少见的不带哈希后缀的稳定 class。

## 建议配置（已落地）

```ts
imageDownload: {
  steps: [
    { selector: [
      'div[class*="imageItem-"][class*="imageWrapper-"]',
      'div[class*="imageWrapper-"]:has(img[data-image-resource-id])',
      'img[data-image-resource-id]'
    ], delay: 500, hover: true },
    { selector: [
      'div[class*="popMenuItem"]:has(svg[class*="downloadIcon"])',
      'div[class*="popMenuItem"]:has(svg.downloadIcon)',
      'div[class*="popMenu-"] div[class*="popMenuItem-"]:nth-of-type(2)'
    ], delay: 300 }
  ]
}
```

## 注意

- 选择器里的 `has()` 是 CSS Selectors Level 4，**Electron Chromium 支持**，注入脚本可放心用。
- popMenuItem 的 class 哈希后缀 (`D5bm-XXXXX`) 是构建产物，前缀 `popMenuItem-` / `downloadIcon-` / `imageItem-` 稳定。
- "添加到对话" 是第一项，"下载" 是第二项；nth-of-type 兜底可用。
- 界面有 "AI生图" checkbox，但**实测直接发中文生图提示词模型也会自动生图**——无需先切模式。
