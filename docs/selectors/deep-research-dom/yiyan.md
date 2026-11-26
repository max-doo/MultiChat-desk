# 文心一言 — wenxin.baidu.com (chat.baidu.com)

> Updated: 2026-11-18 00:27 (Asia/Shanghai)

## 登录态

iab 已登录（chat.baidu.com 跳到 wenxin.baidu.com）。HTTP `GET /` 静态骨架，UI 由 JS 渲染。

## 配置状态

`models.yiyan` **未配置 `researchMode`**（未配 reportContainer）。

## 实测发现（iab）

工具条 `ci-tools` 展开后只有：

```
对话 / 图片生成 / 帮我写作 / PPT生成 / 更多
更多子项：应用开发 / 文献速读 / 测运势 / 音乐生成
```

输入区**没有"深度研究"文本/图标按钮**。

## HTTP 响应中的 modelFunction（关键）

静态页面里带一组 `modelFunction`，其中：

```
"自动"/smartMode   → deepSearch: "1"
"文心5.1"/ERINE-5.1 → deepSearch: "0"
其他模型           → deepSearch: ""
```

`deepSearch` 是**模型级功能开关**（挂在模型上），不是 composer 里的独立开关钮。要触发很可能靠选 `smartMode/自动` 模型 + 联网搜索，而不是"点一个 Deep Research 按钮"。

## 结论

- **没有可点选的独立 "Deep Research" 入口**（工具条/更多里没有该文本）。
- 深度搜索以模型功能 `deepSearch` 存在，绑定在 `smartMode` 上——自动化层面**无法用 step 点击开启**，需要走"选模型/联网搜索"路径（不属于现有 researchMode.steps 抽象）。
- 建议：`researchMode` 保持不配置；若要支持文心深度搜索，应做"切换模型到 smartMode"的独立链路。
- `reportContainer` 未核验；深度搜索产出在消息流 `md-stream-desktop` 内，可被现有 `messageContainer` 覆盖。
