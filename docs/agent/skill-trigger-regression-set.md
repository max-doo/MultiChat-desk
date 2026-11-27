> Created: 2026-11-27 18:45 (Asia/Shanghai)

# Skill 触发回归任务集

本文档是随包 skill 分发链路（`docs/agent/agent-skills-distribution-impl-plan.md` S4）的验收基准之一：一组固定的正/负触发例，用于回归验证 Agent 会话中 skill 是否**该触发的触发、不该触发的不触发**。

## 执行方式

在工作台新建 Agent 会话，逐条发送"用户输入"列的原文，观察 Agent 是否加载对应 skill（可在 skill 生效的标志判断：回复中出现该 skill 特有的流程/脚本调用，或会话日志中 `skills` 激活记录）。**只需判断触发与否，不要求完成完整任务**——触发确认后即可中断。

判定标准：
- 正例：对应 skill 被激活（回复中明确按其流程行动，如 docx 任务先跑 ensure-python 或调用 docx 脚本）。
- 负例：对应 skill **不**被激活。Agent 直接回答/用通用手段解决均属正确。

注意：触发判定存在模型非确定性，单条偶发偏差不算回归；同批连续 ≥3 条同向错误才构成回归信号。

## 正例（应触发）

| # | 用户输入 | 期望触发 |
|---|---------|---------|
| P1 | 帮我写一份项目周报 Word 文档，要有标题层级和页码 | docx |
| P2 | 这个合同.docx 里第三条的赔偿金额改成 50 万，保留修订痕迹 | docx |
| P3 | 把这三个 PDF 合并成一个，然后给每页右下角加上页码 | pdf |
| P4 | 帮我填一下这份 PDF 表格，姓名张三，日期今天 | pdf |
| P5 | 做一份产品介绍 PPT，五页，风格简洁一点 | pptx |
| P6 | 读一下 deck.pptx 里都写了什么，帮我整理成摘要 | pptx |
| P7 | 这个 Excel 表帮我加一列利润率，公式写进去 | xlsx |
| P8 | 分析这个 csv 里的销售数据，做个透视表给我 | xlsx |
| P9 | 把刚才的结论沉淀成工作台笔记，打上"评审"标签 | workbench-assets |
| P10 | 这份方案让几个 AI 都看看，给我汇总评审意见 | multi-ai-review |
| P11 | 我想把"周报生成"这个流程沉淀成一个 skill，帮我创建 | skill-creator |

## 负例（不应触发）

| # | 用户输入 | 不应触发 |
|---|---------|---------|
| N1 | 帮我写一个 Markdown 格式的会议纪要，直接放在笔记里 | docx / pptx（纯 Markdown 笔记不是 Word 任务） |
| N2 | Excel 这软件怎么禁用启动画面？ | xlsx（软件使用问答，无文件操作） |
| N3 | PDF 和 PDF/A 有什么区别？ | pdf（概念问答，无文件操作） |
| N4 | 帮我在网页版 PowerPoint 里写一段 VBA | pptx（无 .pptx 文件读写需求） |
| N5 | 这几行 csv 数据直接读一下：a,b,c\n1,2,3 | xlsx（description 明确豁免几行数据的直接查看） |
| N6 | 把这张图片压缩到 200KB 以内 | pdf / docx / xlsx（纯图片处理） |
| N7 | 去 ChatGPT 上帮我问一个问题：xxx | multi-ai-review（单平台单发，非多模型评审编排） |
| N8 | 今天天气怎么样 | 全部（无关闲聊） |
| N9 | 帮我把这个 txt 文件改成 UTF-8 编码 | 全部（纯文本转码，无办公文档语义） |
| N10 | 帮我写个 Python 脚本统计目录下文件数 | 全部（通用编码任务） |

## 回归触发条件

以下情况应执行本回归集：
- 随包 skill 集合变更（增删 skill、改 description）。
- pi-coding-agent 内核升级（skill 注入/激活机制可能变化）。
- 系统提示词或 skill 发现机制调整（如 additionalSkillPaths 顺序、目录覆盖语义变化）。
