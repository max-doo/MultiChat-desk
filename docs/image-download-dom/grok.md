# Grok — grok.com

> Updated: 2026-11-17 16:15 (Asia/Shanghai)

## 登录态

iab 已登录（`galaxydmx12@gmail.com`，X 账号 `X Doo`）。无 cookie banner 拦截（登录后消失）。

## 生图结果 DOM

```
<div class="response-<uuid>">
  <div> /* 已生成的图像 容器 */
    <button aria-label="一只蓝色的猫，简单风格..."   ← 点图开预览
            class="grok-XXX ...">
      <span><span>
        <img src="https://assets.grok.com/users/<uid>/generated/<uuid>/image.jpg" />
      </span></span>
    </button>
    <button aria-label="下载"
            data-icon-button
            data-base-ui-tooltip-trigger
            id="base-ui-_r_96_"
            class="grok-XXX ...">
      <svg><use href="#icon-xs-cloud-download"/></svg>
    </button>
  </div>
</div>
```

## 实测验证

- **`button[aria-label="下载"]` 一键下载原图**——已实测点击后浏览器 `download` 事件触发，保存为 `*.jpg`。
- **无需开预览**：下载按钮跟"点图开预览"按钮是兄弟节点，直接在生图容器里。
- img `src` 就是 HTTPS URL（`assets.grok.com/.../image.jpg`），不是 blob——`extractImages` 兜底也能拿到原图。
- class 是混淆的 `grok-XXX` 哈希，**不要依赖**；稳定 hook 是 `aria-label` 和 `data-icon-button`。
- 英文 UI 下载按钮大概率是 `aria-label="Download"`。

## 建议配置

```ts
imageDownload: {
  steps: [
    // 一步：点生图旁的"下载"按钮（icon-xs-cloud-download SVG + aria-label）
    { selector: [
      'button[aria-label="下载"]',
      'button[aria-label="Download"]',
      'button[data-icon-button][aria-label*="下载"]',
      'button[data-icon-button][aria-label*="Download"]'
    ], delay: 300 }
  ]
}
```

## 注意

- 原配置里 `imageGeneration.steps` 按文本 `生图/画图/Image` 匹配——实测首页就显示"创建图像"建议按钮，**发送中文生图提示词后 Grok 自动识别为生图请求**（模型会自动调 image gen），不需要先点"创建图像"按钮。
- 但也有可能模型把它当文本问答（尤其英文模型），所以保留 `imageGeneration` 切换逻辑作为兜底是合理的。
