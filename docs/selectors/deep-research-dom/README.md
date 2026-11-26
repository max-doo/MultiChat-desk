# Deep Research DOM 适配 — 平台探索记录

> Created: 2026-11-18 00:24 (Asia/Shanghai)
> 完成: 2026-11-18，主进程 + 3 个 audit worker（均基于 Codex in-app browser iab 实测/状态观察）

## 背景

`task submit --research` / 研究模式由 `selectors.researchMode.steps`（`src/shared/config/selectors.ts`）驱动注入脚本逐步点击开启；`cancelSteps` 负责退出。`reportContainer` 用于抓取研究产物（部分平台是独立 iframe/面板）。多平台 DOM 已改版，选择器失效 — 本目录记录各平台实测 DOM 与新旧选择器比对。

实测环境：Codex in-app browser（Chromium, iab），视口 ~753px（等同 MultiChat webview 窄屏场景）。iab 与 MultiChat `persist:shared` session **不共享登录态** — 未登录平台上控件可能少于登录后，BLOCKED 项需在已登录 webview 复核。

## 平台总览

| 平台 | selectors key | DR 功能 | 配置 steps 命中 | 真实开启链（2026-11 实测） | 文件 |
|---|---|---|---|---|---|
| ChatGPT | `chatgpt` | ✅ | **0/4 全失效** | `button[data-composer-navigation-target="add-context"]` → `<button>`"深度研究"（menu 无 role） | `chatgpt.md` |
| Perplexity | `perplexity` | ✅（+菜单内, Pro 标） | **0/3 全失效** | `button[aria-label="添加文件、插件等"]` → `div[role="option"]`"深度研究" | `perplexity.md` |
| Gemini | `gemini` | ✅ | step1 失效, step2 文本仍命中 | `button[aria-label="上传和工具"]` → `更多工具` → `TOOLBOX-DRAWER-ITEM>button`"Deep Research" | `gemini.md` |
| Grok | `grok` | ⚠️ 未登录无入口（疑 Premium 或并入默认） | 全失效（无目标） | 待登录 webview 复核；草案 `button[data-slot]` text=DeepSearch | `grok.md` |
| 千问 | `qwen` | ✅ | **0/5 全失效** | `button[aria-label="选择模式"]` → `div[role="menuitem"]`"深入研究" | `qwen.md` |
| 豆包 | `doubao` | ❌ UI 中已移除/改名 | 全失效（无目标） | 功能不存在 — researchMode 应停用 | `doubao.md` |
| Kimi | `kimi` | ✅ 独立页 `/deep-research` | —（未配置，正确） | `<a href="/deep-research">` 直达，非输入框切换 — steps 抽象不适用 | `kimi.md` |
| 元宝 | `yuanbao` | ✅ | —（未配置，应新增） | `button[aria-label="深度研究"][data-application-id="application_id_deep_research"]` | `yuanbao.md` |
| 文心 | `yiyan` | ❌ 无独立开关 | —（未配置，正确） | deepSearch 只是 smartMode 模型标志，非 composer 切换 | `yiyan.md` |
| Arena | `arena` | ❌ 无 | —（未配置，正确） | 仅 Battle/Agent/Side-by-Side/Direct 模式 | `arena.md` |
| Claude | `claude` | 未验证 | —（未配置） | BLOCKED(login) — 登录后草案见文件 | `claude.md` |
| 智谱 | `chatglm` | 未验证 | ⚠️ 未验证 | BLOCKED(captcha 滑块) — 需过验证后实测 | `chatglm.md` |
| DeepSeek | `deepseek` | ❌ 无 DR（"深度思考"是推理开关） | ⚠️ 语义错位 | 保留则改 `text:'深度思考', exact:true`；否则移除 | `deepseek.md` |

## 全局变化总结

- **泛化趋势**：各平台从"稳定 id/testid"转向 aria-label + role + 文本语义定位；`data-testid`/`data-log-*`/`tagBtn-*` 全部消失。
- **菜单角色降级**：ChatGPT 菜单项变 `<button>`（无 role）；Perplexity 用 `role=listbox/option`；Qwen 用 `role=menu/menuitem`；Gemini 用自定义元素 `TOOLBOX-DRAWER-ITEM`。选择器必须给多种 role 候选。
- **开启层级加深**：Gemini 变两级（工具→更多工具→项）；Qwen 需先开模式菜单；Perplexity 需先开 + 菜单。
- **textarea/sendButton 漂移**：ChatGPT/Perplexity 的 textarea 只剩 `[contenteditable="true"]` 兜底存活；ChatGPT `sendButton` 需改 `button[aria-label="发送"]/["Send"]`；Doubao `chat_input_input` 的 `contenteditable`/`role=textbox` 属性被移除。
- **语义陷阱**：DeepSeek"深度思考"是推理开关非 DR；Doubao"深入研究"整体下架；文心 deepSearch 是模型级标志不可点击。

## 修复优先级建议

1. **chatgpt / perplexity / qwen**：researchMode steps 全失效，按各文件"建议替换"改（均给出 AutomationStep 列表）。
2. **gemini**：step1 改为 `button[aria-label="上传和工具"]` + 中间"更多工具"optional 步。
3. **doubao**：功能已下架，researchMode 配置移除或禁用 `--research`。
4. **yuanbao**：新增 researchMode（钩子稳定 `data-application-id`）。
5. **kimi**：`--research` 应改为"导航至 /deep-research 页"路径，不适合 steps 抽象。
6. **grok / claude / chatglm / deepseek**：需在已登录 `persist:shared` webview 复核后定稿（各文件附最小等价验证步骤）。

## 备注

- 所有建议替换选择器见各平台文件末尾（AutomationStep 格式，含 selector 数组 + text/regex + optional/exclude）。
- 旧的 `docs/深度研究dom.md`（2026-08）记录的是改版前 DOM，仅作历史对照，勿再作为现状依据。
- 未向任何平台输入凭据；Cloudflare/滑块验证未绕过；验证码平台标 BLOCKED。
