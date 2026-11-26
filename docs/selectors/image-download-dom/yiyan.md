# 文心一言 — chat.baidu.com

> Updated: 2026-11-17 15:50 (Asia/Shanghai)

## 登录态

iab **未登录也可生图**——这是少数不强制登录的平台。发送"生图：xxx"直接出 4 张。

## 生图结果 DOM

```
AI 回复气泡内：
<div class="_final-image_31xi4_149">          ← hash class 会变
  <span class="cos-tooltip">
    <img class="_image-visible_31xi4_184"     ← hash class
         src="https://gips2.baidu.com/it/u=...,JPEG&w=1024&h=1024">  ← 已是 1024 原图
  </span>
  × 4 张并排
</div>
```

## 实测下载链路（最简方案）

消息底部 action bar 直接有下载图标，无需开预览：

```
<i class="cos-icon cos-icon-download _icon_10v63_12"></i>   ← xy ≈ (99, 385)
<i class="cos-icon cos-icon-share1 ..."></i>
<i class="cos-icon cos-icon-feedback ..."></i>
<i class="cos-icon cos-icon-exchange ..."></i>
```

**`i.cos-icon-download` 是 cos-ui 图标库的语义 class**，不随业务发版改 hash，比 `_icon_10v63_12` 这类后缀稳定得多。

点击后真实下载 `downloaded-image.jpeg`（4 张合成一张 JPEG 网格图）。

## 实测验证通过的选择器

```ts
imageDownload: {
  steps: [
    // 一步：点消息 action bar 的下载图标（取最后一个，对应最新一条 AI 回复）
    { selector: 'i.cos-icon-download, [class*="cos-icon-download"]', delay: 300 }
  ]
}
```

## 备选链路（点击图 → 右侧预览面板 → 顶部下载图标）

```
<i class="cos-icon cos-icon-download _button_84ekk_1"></i>   ← 预览面板右上
```
**未登录时点这个不响应**（要登录才能用预览面板的"变清晰/消除/抠图/扩图"等高级工具），所以走 action bar 更稳。

## 注意

- 多图消息时 action bar 下载是"4 张合一张 JPEG"；要单独一张需走预览面板（登录态才可用）。
- `gips*.baidu.com` 图片 src 已是 `w=1024&h=1024` 的原图 CDN URL，质量足够，**不需要走 extractImages 兜底**。
- 若一定要逐张下载，登录后改走"点击图→预览→`cos-icon-download`"的两步链。
