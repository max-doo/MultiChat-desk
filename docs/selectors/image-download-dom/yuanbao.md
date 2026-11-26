# 腾讯元宝 — yuanbao.tencent.com/chat

> Updated: 2026-11-17 16:20 (Asia/Shanghai)

## 登录态

iab 已登录（`木土日月`）。

## 生图结果 DOM

生成 4 张图（swiper 轮播，400x400 预览）：

```
<div class="swiper-slide swiper-slide-active dic-list__slide">
  <div class="dic-card-item dic-card-item--light">
    <img class="dic-card-item__img dic-card-item__img--loaded"
         src="https://hunyuan-prod-1258344703.cos.ap-guangzhou.myqcloud.com/text2img/<hash>/<ts>_<rand>"
         <!-- 400x400 预览，无扩展名 -->
  </div>
</div>
<!-- + 3 张兄弟 swiper-slide -->
```

点图 → 打开 `hyc-photo-view-chrome-v2` 预览弹层：

```
<div class="hyc-photo-view-chrome-v2">
  <div class="hyc-photo-view-chrome-v2__header">
    <button aria-label="close" class="hyc-photo-view-chrome-v2__close">
  <div class="hyc-photo-view-chrome-v2__toolbar">
    <button aria-label="zoom in">
    <button aria-label="zoom out">
    <button aria-label="download"                        ← 下载按钮
            class="hyc-photo-view-chrome-v2__btn hyc-photo-view-chrome-v2__btn--download">
    <button aria-label="无水印保存设置"                   ← 设置入口
            class="watermark-free-save_action-button--web-toolbar__9M+Ls
                   hyc-photo-view-chrome-v2__btn hyc-photo-view-chrome-v2__btn--watermark">
```

## 实测验证

- **`button[aria-label="download"]` 实测点击后浏览器 `download` 事件触发**，保存为 `*.png`（无水印版本）。
- `dic-card-item__img` 是稳定 BEM class，不带哈希后缀。
- 预览 toolbar 按钮都是英文 aria-label (`download`/`zoom in`/`zoom out`/`close`)，**只有"无水印保存设置"是中文**。
- 预览图本身是 `hunyuan-prod-*.cos.myqcloud.com` HTTPS URL，但 `src` 是 400x400 缩放预览——**必须走下载按钮拿原图**，不能 extractImages。
- 底部 action bar 没有"下载"，只有"复制/收藏/点赞/点踩/重新生成/分享/更多"——**只能开预览下载**。

## 建议配置（已落地）

```ts
imageDownload: {
  steps: [
    { selector: [
      'img.dic-card-item__img',
      'div.dic-card-item img',
      '[class*="dic-card-item"] img'
    ], delay: 800 },
    { selector: [
      'button[aria-label="download"]',
      'button.hyc-photo-view-chrome-v2__btn--download',
      '[class*="hyc-photo-view"] button[aria-label="download"]'
    ], delay: 300 }
  ]
}
```

## 注意

- "无水印保存设置"按钮触发的是设置菜单（切换保存时是否带水印），**不是直接下载**——选 `aria-label="download"` 而不是 `无水印`。
- 生图默认一次产 4 张，下载按钮下载的是**当前 swiper active 那张**——批量下载需要循环切换 swiper（不在本次适配范围）。
