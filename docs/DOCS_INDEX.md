# MultiChat 文档索引

> Created: 2026-11-26 18:48 (+08:00)
>
> 本文档是 docs 目录结构的权威索引。新增或移动文档时同步更新本文件。

---

## 目录结构总览

```
docs/
├── *.md / screenshot.png     # 常青指南（构建、配置、用户手册）
├── readme/                   # README 引用的产品截图
├── agent/                    # Agent 模式设计稿（进行中）
├── workbench/                # 工作台设计稿（进行中）
├── mindmap/                  # 思维导图设计与原型
├── selectors/                # Webview DOM 选择器调研（维护中）
├── prototypes/               # UI 原型 HTML 与验收截图
├── design/                   # 界面设计原型（设置页等）
├── research/                 # 行业与技术调研报告
└── archive/                  # 已落地或被取代的历史文档
    ├── 2026-08/              # 早期文档 + superpowers 计划/规格全集
    ├── 2026-10/              # 导图重写与数据治理（随 v1.3.0 落地）
    └── 2026-11/              # 已完成迁移（Lucide 图标等）
```

---

## 常青指南（根目录）

面向所有使用者，长期有效、按需更新，不归档。

| 文档 | 内容 |
| --- | --- |
| [BUILD_GUIDE.md](BUILD_GUIDE.md) | 完整打包指南：环境准备、构建命令、发布流程、常见问题 |
| [PORTABLE_BUILD_GUIDE.md](PORTABLE_BUILD_GUIDE.md) | 便携版工作原理、数据存储机制、配置说明 |
| [QUICK_BUILD_REFERENCE.md](QUICK_BUILD_REFERENCE.md) | 常用命令速查与发布检查清单 |
| [API_CONFIG_GUIDE.md](API_CONFIG_GUIDE.md) | API 供应商与模型配置 |
| [USER_GUIDE.md](USER_GUIDE.md) | 用户手册（README 引用） |
| [GITHUB_GUIDE.md](GITHUB_GUIDE.md) | Git 工作流、分支与提交规范、版本发布 |
| [WINDOWS_COMMANDS.md](WINDOWS_COMMANDS.md) | Bash 与 PowerShell 命令对照、开发常用命令 |
| [MACOS_DEVELOPMENT_PLAN.md](MACOS_DEVELOPMENT_PLAN.md) | macOS 构建配置与适配说明 |

---

## 活跃设计稿

进行中的功能设计与调研，落地完成后移入 `archive/`。

### agent/ — Agent 模式

- [agent/agent-cli-dev-plan.md](agent/agent-cli-dev-plan.md) — CLI 任务链路总设计
- [agent/cli-image-generation-plan.md](agent/cli-image-generation-plan.md) — CLI 图片生成
- [agent/agent-sidebar-dev-plan.md](agent/agent-sidebar-dev-plan.md) / [agent-sidebar-dev-plan-review.md](agent/agent-sidebar-dev-plan-review.md) / [agent-sidebar-ui-research.md](agent/agent-sidebar-ui-research.md) — Agent 侧栏方案、评审与 UI 调研
- [agent/agent-provider-model-context-design.md](agent/agent-provider-model-context-design.md) — 供应商、模型与上下文管理
- [agent/agent-context-compression-plan.md](agent/agent-context-compression-plan.md) — 上下文压缩分层
- [agent/agent-shell-encoding-design.md](agent/agent-shell-encoding-design.md) — Shell 编码处理
- [agent/command-safety-ast-plan.md](agent/command-safety-ast-plan.md) — 命令安全 AST 化判定
- [agent/web-ai-mode-design.md](agent/web-ai-mode-design.md) — Web AI 模式设计
- [agent/task-split-web-backend-design.md](agent/task-split-web-backend-design.md) — 任务拆解改走后台 Web AI
- [agent/pi-agent-ecosystem-research.md](agent/pi-agent-ecosystem-research.md) — π 系 Agent 生态调研

### workbench/ — 工作台

- [workbench/workbench_product_spec.md](workbench/workbench_product_spec.md) — 产品规格
- [workbench/workbench-unified-notes-annotation-design.md](workbench/workbench-unified-notes-annotation-design.md) — 统一笔记与标注设计（核心）
- [workbench/workbench-annotation-anchor-lifecycle-design.md](workbench/workbench-annotation-anchor-lifecycle-design.md) — 注释锚点生命周期
- [workbench/workbench-performance-memory-optimization-plan.md](workbench/workbench-performance-memory-optimization-plan.md) — 性能与内存优化（P0/P1 已落地，后续阶段进行中）
- [workbench/workbench-markdown-source-fidelity-fix.md](workbench/workbench-markdown-source-fidelity-fix.md) — Markdown 源码保真修复
- [workbench/workbench-git-gutter-design.md](workbench/workbench-git-gutter-design.md) / [workbench/workbench-git-sync.md](workbench/workbench-git-sync.md) — Git 变更标记与版本同步策略
- [workbench/workbench-mindmap-file-binding-design.md](workbench/workbench-mindmap-file-binding-design.md) — 导图文件化与绑定
- [workbench/workbench-html-visual-edit-plan.md](workbench/workbench-html-visual-edit-plan.md) — HTML 可视化编辑
- [workbench/workbench-office-preview-plan.md](workbench/workbench-office-preview-plan.md) — Office 预览
- [workbench/workbench-tags-obsidian-parity-plan.md](workbench/workbench-tags-obsidian-parity-plan.md) — 标签能力对齐 Obsidian
- [workbench/workbench-lexical-playground-parity.md](workbench/workbench-lexical-playground-parity.md) — 编辑器能力对齐
- [workbench/reply-insert-into-workbench-design.md](workbench/reply-insert-into-workbench-design.md) — AI 回复插入工作台

### mindmap/ — 思维导图

- [mindmap/mindmap-selection-scope-design.md](mindmap/mindmap-selection-scope-design.md) / [mindmap-selection-scope-prototype.html](mindmap/mindmap-selection-scope-prototype.html) — 选区范围导图设计与原型
- [mindmap/mindmap-mvp-prototype.html](mindmap/mindmap-mvp-prototype.html) — 早期 MVP 原型（参考）

---

## 参考资料

### selectors/ — DOM 选择器调研

选择器维护的长期参考，站点改版时更新。

- [selectors/选择器维护方法论.md](selectors/选择器维护方法论.md) — 选择器维护总方法论
- `selectors/deep-research-dom/` — 各平台深度研究入口 DOM（13 平台 + README）
- `selectors/image-download-dom/` — 各平台生图下载 DOM（8 平台适配 + README）
- `selectors/reply-action-dom/` — 回复操作按钮 DOM（复制/重生成等）
- [selectors/Gemini canvas dom.md](selectors/Gemini%20canvas%20dom.md) / [selectors/gemin开启推理.md](selectors/gemin开启推理.md) — Gemini 专项笔记

### prototypes/ / design/ — UI 原型

交互与视觉原型 HTML 及验收截图，按文件名对应到对应设计稿。`design/` 目前为设置页重设计原型。

### research/ — 调研报告

- `research/agent-skills-research-2026-11.md` — Agent Skills 生态调研
- `research/browser-extension-deep-research.md` — 浏览器扩展方向调研

---

## 归档 archive/

已落地、被取代或不再适用的历史文档，仅供回溯，不再更新。

- **archive/2026-08/** — 项目早期文档：`superpowers/` 全套计划与规格（2026-03 ~ 2026-10）、早期 DOM 笔记（已被 selectors/ 取代）、`ModelMashPRD 3 simple.md`、早期评估报告（CLI 可行性、WebContentsView 迁移）、`settings-config-design.md`（旧版设置设计）等
- **archive/2026-10/** — 导图重写与数据治理系列（随 v1.3.0 落地）：`mindmap-rewrite-design.md`、`single-conversation-mindmap-design/mvp-design.md`、`conversation-mindmap-prompt-optimization.md`、`data-governance-optimization-plan.md`
- **archive/2026-11/** — 已完成的一次性迁移：`lucide-migration-plan.md`

归档规则：设计稿对应功能落地并稳定后移入 `archive/<落地年月>/`；被新文档取代时移入 `archive/<取代年月>/`。归档文档不再维护，内容以代码事实为准。
