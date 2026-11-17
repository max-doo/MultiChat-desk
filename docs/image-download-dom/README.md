# 图片下载 DOM 适配 — 平台探索记录

> Created: 2026-11-17 15:29 (Asia/Shanghai)

## 背景

一键批量图片下载走 `image:download-via-native:prepare` + 注入脚本点页面原生下载按钮 + 主进程 `will-download` 拦截落盘。注入脚本由 `generateClickDownloadButtonsScript` 按 `selectors.imageDownload.steps` 生成，支持 `hover` 步骤。

现状问题：部分平台下载不到、或只能拿到低质图（blob/canvas 抓取的 `extractImages` 兜底路径质量差）。目标：所有能生图的平台都走"平台 UI 原生下载"拿到原图。

## 关键实现位置

- `src/shared/config/selectors.ts` — `imageDownload.steps` / `closePreviewSelector` 配置
- `src/shared/utils/webviewScripts.ts` — `generateClickDownloadButtonsScript` / `generateExtractImagesScript`
- `src/main/ipcHandlers.ts` — `will-download` 拦截与 `image:download-via-native:*` IPC

## 平台总览

| 平台 | 选择器 key | 实测生图 | 实测下载入口 | imageDownload 状态 | 备注 |
|---|---|---|---|---|---|
| ChatGPT | `chatgpt` | ✅ | `button[aria-label="下载"]`（预览 header） | ✅ 已更新 | 需点开预览；中英 label 兜底 |
| Gemini | `gemini` | ✅ | `download-generated-image-button button` | ✅ 已更新（去 hover 步骤） | 按钮常驻 DOM |
| 文心一言 | `yiyan` | ✅ | `i.cos-icon-download`（action bar） | ✅ 已新增 | 未登录也可生图 |
| 豆包 | `doubao` | ✅ | `[data-testid="edit_image_download_button"]`（预览） | ✅ 已更新 | 点击图开预览→testid 下载 |
| Grok | `grok` | ✅ | `button[aria-label="下载"]`（生图旁 icon-btn） | ✅ 已更新 | 一键下载，无需开预览 |
| 千问 | `qwen` | ✅ | `popMenuItem:has(svg.downloadIcon)` | ✅ 已更新（hover+点击两步） | 域名已迁 qianwen.com |
| 元宝 | `yuanbao` | ✅ | `button[aria-label="download"]`（预览 toolbar） | ✅ 已更新 | 点图开预览→英文 aria-label |
| Kimi | `kimi` | ⛔ 跳过 | - | 不补 | 用户确认无生图下载需求（未登录 iab） |
| 智谱清言 | `chatglm` | ⛔ 跳过 | - | 不补 | 用户确认无生图下载需求（iab 滑块验证未解） |
| Perplexity | `perplexity` | - | - | 不适用 | 无生图配置 |
| Arena | `arena` | - | - | 不适用 | 无生图配置 |
| DeepSeek | `deepseek` | - | - | 不适用 | 本身不生图 |
| Claude | `claude` | - | - | 不适用 | 不生图 |

## 已落地的 selectors.ts 改动（2026-11-17）

- `chatgpt.imageDownload`：步骤1 加 `已生成图像`/`Generated image` 语义按钮；步骤2 把"保存"改成"下载"为主、四语兜底；closePreviewSelector 加"关闭查看器"/"Close viewer"。
- `gemini.imageDownload`：去掉 hover 步骤（按钮常驻 DOM），下载按钮加英文兜底。
- `doubao.imageDownload`：从 hover 浮层改为"点图→预览→`data-testid=edit_image_download_button`"两步链。
- `yiyan.imageDownload`：新增，一步点 action bar `i.cos-icon-download`。
- `grok.imageDownload`：新增，一步点 `button[aria-label="下载"]`（data-icon-button 兜底）。
- `qwen.imageDownload`：新增，hover 图容器 → 点 `popMenuItem:has(svg.downloadIcon)`。
- `yuanbao.imageDownload`：新增，点 `img.dic-card-item__img` → 点预览 `button[aria-label="download"]`。

## 备注

- iab（Codex 内置浏览器）与 MultiChat `persist:shared` session **不共享登录态**，需在各平台单独登录。
- 实测环境：Codex in-app browser（Chromium），DOM 与 Electron webview 基本一致；web-components / shadow DOM 平台需注意穿透。
