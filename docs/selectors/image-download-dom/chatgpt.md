# ChatGPT — chatgpt.com

> Updated: 2026-11-17 15:56 (Asia/Shanghai)

## 登录态

iab 已登录（Cloudflare 一次验证后进入）。

## 生图结果 DOM

AI 回复消息内嵌 image card：

```
<button aria-label="已生成图像 1">            ← 卡片本身可点击 → 打开预览
  <img alt="已生成图像 1"
       class="ImageTransparencyBackdrop-jTfEPD block h-full ..."
       src="blob:https://chatgpt.com/...">     ← blob URL，不是原图
</button>
<button aria-label="编辑生成的图像 1">编辑</button>    ← hover 浮现
<button aria-label="分享生成的图像 1"></button>       ← hover 浮现

消息 action bar：
<button aria-label="复制图像"></button>
<checkbox aria-label="喜欢此图像">
<checkbox aria-label="不喜欢此图像">
<button aria-label="分享">
<button aria-label="重试">
<button aria-label="更多操作">
```

**消息内无下载按钮**——必须点卡片开预览。

## 预览面板 DOM

顶部 header（fullscreen shell）：
```
<button aria-label="极简红色圆形 的文件操作">图像</button>   ← 标题
<button>52%</button>                                          ← 缩放控制
<button aria-label="下载">                                    ← ★ 下载按钮（新 UI 改成了"下载"）
<button aria-label="分享">分享</button>
<button aria-label="在侧面板中打开">在侧面板中打开</button>
<button aria-label="关闭查看器">                              ← 关闭预览
```

下载得到 `极简红色圆形.webp`（原图 webp）。

## 现有配置为什么失效

```ts
{ selector: 'header[data-testid="fullscreen-shell-header"] button[aria-label="保存"], button[aria-label="保存"]', delay: 300 }
```

- **`aria-label="保存"` 在新版改成了 `"下载"`** —— 这是失效的根因。
- 旧 UI 是"保存"，新 UI（图像预览 viewer）是"下载"。
- `header[data-testid="fullscreen-shell-header"]` 前缀未必命中（实测无 data-testid，是普通 header）。

## 实测验证通过的选择器（新）

```ts
imageDownload: {
  steps: [
    // 步骤1：点最新生图卡片，打开全屏预览
    {
      selector: [
        'button[aria-label^="已生成图像"]',         // 中文 "已生成图像 1/2/..."
        'button[aria-label^="Generated image"]',    // 英文 "Generated image 1"
        'div[class*="imagegen-image"] img',
        'div.group\\/imagegen-image img',
        'img[id^="_r_"]'
      ],
      delay: 800
    },
    // 步骤2：点预览 header 的"下载"按钮（兼容旧"保存"和英文 Download/Save）
    {
      selector: [
        'header button[aria-label="下载"]',
        'button[aria-label="下载"]',
        'header button[aria-label="Download"]',
        'button[aria-label="Download"]',
        // 旧 UI 兼容
        'header button[aria-label="保存"]',
        'button[aria-label="保存"]',
        'header button[aria-label="Save"]',
        'button[aria-label="Save"]'
      ],
      delay: 300
    }
  ],
  closePreviewSelector: 'button[aria-label="关闭查看器"], button[aria-label="Close viewer"], button[aria-label="关闭全屏显示"], button[aria-label="Close"]'
}
```

## 注意

- 大图预览会渲染成"白色卡片包住红色圆形"——`ImageTransparencyBackdrop` 是 ChatGPT 给透明 PNG 加的白色底，不影响下载的原图。
- 下载文件名是 AI 给的标题（`极简红色圆形.webp`），不是固定名。
- 同一消息可能有多张图（`已生成图像 1`、`2`、`3`…）；批量下载要逐张点 + 逐张下载，或增强脚本支持循环。
- 目前脚本是"选最新一张"，多张场景只能拿到最后一张，后续可扩展成"循环所有 `已生成图像 N`"。
