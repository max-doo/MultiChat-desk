# Arena — arena.ai (lmarena 新站)

> Updated: 2026-11-18 00:27 (Asia/Shanghai)

## 登录态 / 可达性

- HTTP `GET /` 直连 → **403 + Cloudflare "Just a moment"** 挑战页（managed challenge）。
- iab 实测进入后是普通 SPA（过了 CF）。

## 配置状态

`models.arena` **未配置 `researchMode`**。

## 实测发现（iab）

首页 chat 区域只有模式选择，没有 Deep Research：

```
combobox（模式）值域：
  Battle Mode   — Battle 2 anonymous models
  Agent Mode    — Built for complex tasks
  Side by Side  — Compare 2 models
  Direct        — Chat with 1 model

输入区旁只有：
  Add files (+) / modality Auto / Send message
```

页面无 `Deep Research / 深度研究 / research` 相关按钮或菜单项。

## 结论

- **Arena 无 Deep Research 功能**（模型竞技场站，只有 battle/agent/side-by-side/direct 四种模式）。
- 保持 `researchMode` 不配置的现状；task 的 `--research` 在该平台应视为不支持。
- `reportContainer` 无意义。
