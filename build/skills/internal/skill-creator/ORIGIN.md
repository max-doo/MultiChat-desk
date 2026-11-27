# ORIGIN — skill-creator 来源与改编记录

## 上游

| 来源 | 仓库 | commit | 许可证 |
|---|---|---|---|
| 主骨架 | openai/skills `skills/.system/skill-creator` | 49f948faa9258a0c61caceaf225e179651397431 | Apache-2.0（LICENSE.txt 随目录分发；已核实为完整 Apache-2.0 无附加限制） |
| 方法论参考 | anthropics/skills `skills/skill-creator`（评测闭环方法论） | e4bb5d960d87126ff3b3a8af1a104b7db67560ba | Apache-2.0 |

**许可证合规说明**：OpenAI 随包分发的文档四件套（documents/spreadsheets/presentations/pdf）为限制性许可（All rights reserved），本 skill 未使用其任何文本；仅 `.system/skill-creator` 目录为 Apache-2.0，是本次唯一改编来源。

## 复制文件清单（openai）

- `LICENSE.txt`（原样）

改编新增/重写：

- `SKILL.md`（中文适配重写，剥离宿主专属机制）
- `scripts/init-skill.mjs`（init_skill.py 的宿主无关 Node 移植）
- `scripts/validate-skill.mjs`（quick_validate.py 的零依赖 Node 移植）
- `references/eval-loop.md`（Anthropic 评测方法论的宿主无关重写）
- `ORIGIN.md`（本文件）

剥离未保留（宿主专属）：

- `agents/openai.yaml`、`scripts/generate_openai_yaml.py`、`references/openai_yaml.md`——Codex/ChatGPT UI 元数据机制，pi 运行时无此概念

## 改编决策清单

1. **SKILL.md 中文适配重写**：保留 OpenAI 版全部核心方法论——简洁为王、自由度分级、三层渐进式披露、scripts/references/assets 结构规范、"假设 Agent 已有能力、只写改变决策的信息"的写作纪律、六步创建流程、命名规则、安全红线。
2. **宿主专属机制剥离**：删除 agents/openai.yaml 全链路（生成脚本、参考文档、SKILL.md 中对应章节与 frontmatter `metadata` 字段示例）；frontmatter 规则改为"只允许 name/description（license 仅第三方改编分发时保留）"。
3. **脚手架 Node 化**：Python 在宿主不预装，而 skill-creator 是基础工具不应引导重型依赖——`init_skill.py`/`quick_validate.py` 移植为零依赖 Node 脚本 `init-skill.mjs`/`validate-skill.mjs`（node 由宿主保证在 PATH）。模板与示例改为中文，示例脚本从 Python 改为 Node。validate 用极简 frontmatter 解析器替代 PyYAML，规则与上游一致（hyphen-case、≤64、description ≤1024 无尖括号）。
4. **Anthropic 评测方法论吸收为进阶章节**：断言评分（text/passed/evidence 三要素）、对照运行（with/without 或新旧快照）、工作区按 iteration 组织、无区分度断言/高方差用例分析、盲测 A/B（不知情评审者）、description 触发率优化（20 条评测集、60/40 训练/留出、近似误判负例、"简单任务不触发"机制认知、适度强势的 description）。**概念吸收、实现重写**：不拷贝 claude CLI 子进程、eval-viewer HTML 服务等宿主耦合机制，改为通用 Agent 会话可执行的流程（串并行皆可、benchmark.md 人工汇总替代专用 viewer）。
5. **中文场景适配**：description 双语建议与"中文用户表述命中"写进正文；触发率优化示例全部中文化；评测闭环章节标注为可选进阶（产品面向终端用户而非专职 skill 开发者，符合定稿）。

## 依赖与版本

| 依赖 | 类型 | 供给方式 |
|---|---|---|
| Node | 运行时 | 宿主保证在 PATH（脚手架脚本的唯一依赖） |
| 无 pip/npm 包依赖 | — | validate/init 均为零依赖 |
