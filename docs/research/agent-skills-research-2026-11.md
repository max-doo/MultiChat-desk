> Created: 2026-11-26 17:50 (UTC+8)，2026-11-27 整理定稿

# 侧边栏 Agent 默认 Skill / 插件配置方案

本文是侧边栏 Agent 默认 Skill 与插件配置的定稿方案，可直接指导开发。内容综合了两轮调研：2026-11-26 的产品现状盘点与开源生态调研，以及 2026-11-27 的 X 平台社区核验与 MiniMax 办公四件套专项对比。所有许可证、星数、技术栈事实的核验时间为 2026-11-26 至 2026-11-27。

## 一、最终方案总览

默认包共 **9 个 Skill + MCP 集成**，分三层：

| 层 | Skill | 来源 | 作用 |
| --- | --- | --- | --- |
| 一、产品独有方法论（自研） | `multi-ai-research` | 自研 | 多平台深度研究编排：拆题、扇出、回收、去重、引用归并 |
| | `multi-ai-review` | 自研 | 多模型评审合成：分发评审视角、归类合并意见、输出修订版 |
| | `workbench-assets` | 自研 | 工作台资产整理：笔记/导图/历史/提示词模板的落盘约定与检索 |
| 二、通用文档处理（改编开源） | `docx` | anthropics 版为主干，吸收 MiniMax 中文排版参考 | Word 新建/编辑/套模板/红线修订，中文排版 |
| | `xlsx` | MiniMax 版为主干 | Excel 零损失编辑、从零创建、公式校验 |
| | `pptx` | anthropics 版改编 | PPT 创建/编辑/视觉验证 |
| | `pdf` | anthropics 版改编 | PDF 读取/表单/合并/生成 |
| | `skill-creator` | OpenAI 版改编，吸收 Anthropic 评测方法论 | 用户把私藏工作流固化成自己的 Skill |
| 三、MCP 插件层 | 内核能力接线 | 产品集成开发 | 打通内核已有的 MCP 客户端，预置少量 deferred 服务器 |

**每个格式只进一套主实现**，避免同格式多 Skill 稀释触发准确度。anthropics 完整四件套与其余候选 skill 作为可选增强包（见第八节阶段 5）。

实施顺序与验收标准见第八节。环境依赖（Node/Python/LibreOffice 的运行时供给与 bootstrap 策略）见第七节，是所有打包工作的前置。

## 二、目标与非目标

**目标**：让侧边栏 Agent 对产品的目标用户（多模型重度用户，含大量非程序员）开箱即用——能编排多平台研究、能产出 docx/xlsx/pptx/pdf 成品、能把工作流沉淀为知识资产。

**非目标**：不做 Skill 市场/商店（用可选包 + 自定义目录过渡）；不追求 MCP 服务器数量（预置严格收敛）；不把 Agent 变成通用 coding agent 的复制品——它的独特性在于同时持有本地文件系统、自动化执行力和 multichat CLI 的多平台调度能力。

## 三、产品现状（边界条件）

以下事实均核验自当前代码，是方案的边界条件。

**Agent 会话构成**（`src/main/services/AgentSessionService.ts`）：基础工具为 pi 默认集 read/bash/edit/write 加 find/grep/ls（Windows 用 powershell 替换 bash）；自定义工具 web_search、image_gen；inline extensions 为上下文压缩与系统提示词裁剪；`agentDir` 指向应用数据目录 `multichat/agent/`。

**Skills 加载链路已完整存在**：`AgentResourceLoader` 支持 `additionalSkillPaths`，预置五个候选扫描目录，设置页 `AgentSkillsSettings.tsx` 提供勾选 UI。加载机制本身零架构改动，但**随包分发落位存在缺口**——扫描候选不含安装目录 `resources/skill/`，需要一处小改动补齐（见第八节阶段 0）。

**内核生态事实**（核验自 `node_modules/@earendil-works/pi-coding-agent` dist）：Skills 遵循 Anthropic Agent Skills 开放标准（name 小写连字符不超 64 字符、description 不超 1024 字符），整个开源 Skills 生态拷进扫描目录即可用；内核已内置完整 MCP 客户端（`mcp.json` 配置 + direct/deferred/codemode/hidden 四档暴露 + OAuth），但**当前会话创建路径完全未接 MCP 配置——这是集成缺口，不是能力缺失**。社区的 `pi-mcp-adapter` 与内核内置 MCP 重复，勿用。

**目前唯一的随包 Skill** `multichat-cli` 只是 CLI 调用手册，覆盖"怎么调"但不覆盖"什么时候该调、调完怎么处理"——第一层自研 Skill 正是补这个缺口。

## 四、第一层：产品独有方法论 Skill（自研，最高优先级）

这层是竞对抄不走的差异化核心：别家没有 13 个平台的登录态会话，也没有工作台文件系统。每个都是 100-400 行纯 Markdown，内容工作量为主，写完即可用 dev 实测。

**1. `multi-ai-research`（多平台深度研究编排）**——最高优先级。教的是战法而非语法：什么规模的问题值得扇出到多平台 Deep Research；如何按 `multichat platforms` 的能力位把调研目标拆成各家擅长的子问题；并发提交后轮询节奏；多份报告的去重、冲突标记、引用归并流程；最终产出落盘到工作台目录的约定（文件名、frontmatter 标签规范，衔接工作台全文搜索）。

**2. `multi-ai-review`（多模型评审合成）**。固定套路：产出初稿 → 按评审视角（事实核查/逻辑/表达/合规）拆分提示词分发多平台 → 收集意见 → 按"采纳/驳回/存疑"归类合并 → 输出修订版与评审纪要。辩论模式的 CLI 化延展。

**3. `workbench-assets`（工作台资产整理）**。把产品已有的文件约定教给 Agent，一个 skill 覆盖两类资产：知识类——什么时候该把结论写成笔记而不是只在对话里说完，目录组织与 frontmatter 标签规范，思维导图何时创建，历史会话（`history/conversations`）如何检索引用；提示词类——Markdown 模板库格式（变量插槽、适用平台标注、效果备注），放工作台约定目录，Agent 负责检索、实例化、按使用反馈修订。两者共用同一套工作台目录约定，合并为一个 skill 可减少默认包数量、缓解触发准确度稀释。

**编写约束**：第一层 skill 的 fan-out 编排依赖 multichat CLI 的后台轮询，会话中断后的恢复能力有限，skill 内应写明长任务的分批与进度落盘约定（每完成一个子任务就把中间结果写入工作台），不假设 Agent 能一口气跑完整个编排。

## 五、第二层：文档四件套的选型与改造方案

### 选型结论（含完整证据链）

四件套存在两个合规上游，按格式分工取用：

**anthropics/skills**（约 20 万 stars、2.3 万 forks，文档四件套 Apache-2.0）是社区事实标准。X 平台核验（Simon Willison 2137 赞、jerryjliu 402 赞、多篇数百至数千赞盘点帖）显示几乎所有"最佳 skill"清单最终都指向它；OpenAI 自家 Codex 产品随包的四个文档 skill 也是它的深度改编。技术上 2026-11 已完成换代：docx/pptx 创建改用 npm 的 docx-js/pptxgenjs（Electron 直接受益），工程深度独有——unpack→编辑 XML→zip 重打包的编辑路径、validate.py XSD 校验、tracked-changes 红线工作流、soffice 渲染的视觉验证回路。

**MiniMax-AI/skills**（约 1.39 万 stars，整仓 MIT，Beta 阶段）是唯一独立的重量级竞争者，2026-03 随官方文章《Open-Sourcing Our Office Skills》发布。它不是 anthropics 的下游，在两个关键场景更强：**中文排版**（`minimax-docx` 有专门的 CJK 排版参考，引用 GB/T 9704 公文标准与主流学术格式规范，是公开生态唯一系统处理中文排版的实现）和**存量文件零损失编辑**（`minimax-xlsx` 用 XML 直接编辑且明确禁止 openpyxl 往返——往返会破坏 VBA、数据透视表、迷你图）。

被核验后排除的候选：tfriedel/claude-office-skills（850 星，实为 anthropics 下游镜像，作者已宣告废弃并指向官方仓库）；glebis/claude-skills 与 daymade/claude-code-skills 的文档 skill 均为 HTML/Pandoc 路线，产出不是原生可编辑 Office 文件；OpenAI 版许可证（Copyright 2026 OpenAI, All rights reserved）明确禁止提取、复制分发与衍生转授，只能借鉴方法不能拷贝文本；公开 openai/skills 仓库无 LICENSE 且只有不完整的 pdf。

### 逐格式采纳方案

**`docx`：以 anthropics 版为主干，吸收 MiniMax 的文本知识资产——不引入 .NET 依赖**

关键转折：MiniMax 版相对 anthropics 版的真实增量不是 XSD 校验（anthropics 自带 validate.py XSD 校验与 `--auto-repair`，且校验本身不依赖 .NET），而是三样：(1) 编译验证过的 `Samples/*.cs` 模式库；(2) 套模板场景的确定性 CLI（`apply-template`/`merge-runs`/`fix-order` 把多步 XML 操作固化成命令，对比 Agent 手工即兴编辑 XML 的高方差）；(3) gate-check"不过门禁不交付"的流程纪律。这三样都绑定 .NET OpenXML SDK，而 .NET SDK 首次安装 200MB+ 下载伴随 UAC 弹窗——为套模板的高阶场景让全体普通用户承担这个成本，代价不成比例。

但独立评审核实了一个关键事实：MiniMax 套模板能力的**核心知识不绑定 .NET**——`scenario_c_apply_template.md` 中风格映射三层级、Zone B 边界定位、Overlay vs Base-Replace 决策、禁止复制直接格式等规则全部是 XML 级、运行时无关的知识。因此定稿为：anthropics 版为主干（docx-js npm 创建 + unpack/XML 编辑 + validate.py XSD 校验 + tracked-changes 红线修订全套，全部 Node/Python 依赖），**移植 MiniMax 的 MIT 文本资产补齐中文排版与模板方法**：

- `references/cjk_typography.md`（10.7KB）：CJK 排版完整指南，含 GB/T 9704 公文配方与学术格式规范——覆盖"写什么"
- `references/scenario_c_apply_template.md`：套模板决策与方法——覆盖"怎么做"
- `references/openxml_element_order.md`、`openxml_units.md`：XML 元素顺序与单位换算——覆盖"怎么不出错"
- `references/troubleshooting.md`：症状索引排错——覆盖"出错了怎么办"

只移植排版指南会拿到"写什么"却丢掉"怎么不出错"，后者恰是 XML 手工编辑路线最大的失败源，四个文件必须成套移植。

**场景边界要划清**：docx 的主场景精确定义为**从零创建中文文档、表单/占位符填充、简单模板重排**（覆盖用户高频需求，docx-js 与移植资产完全够用）；**降级弱项限定为多模板合并、逐节页眉页脚等结构性套版**——发生时 Agent 依据移植的 scenario_c 知识直接操作 XML 尽力处理，不为它引入 .NET 运行时。track changes 指南 MiniMax 版与 anthropics 版重叠度高，不单独移植。

**依赖修正**：anthropics 版的文档读取路径默认走 `pandoc -t markdown`，而 pandoc 不在第七节任何一类供给里——改编时必须把读取路径替换为 `markitdown`（已随 Python bootstrap 安装），否则干净机器上"读取现有文档"这个编辑前置步骤第一天就是坏的。

**`xlsx`：以 MiniMax 版为主干**

存量表格零损失编辑（改预算表、填模板）是重度用户最高频场景，MiniMax 的 XML 编辑路径（unpack→edit→pack + xlsx_insert_row/xlsx_add_column/xlsx_pack 成套辅助脚本 + 金融格式规范）是唯一可靠方案。公式重算无需额外移植——`minimax-xlsx` 自带 `libreoffice_recalc.py` 动态重算与 `formula_check.py` 静态校验，与 anthropics 的 recalc.py 能力等价（都依赖 LibreOffice headless，同样做探测式可选增强）。批量数据读写保留 pandas 路径（两家一致）。anthropics 版在此格式上无需吸收任何组件。

**`pptx`：anthropics 版改编，中文场景适配**

两家同为 PptxGenJS 技术栈，anthropics 版工程更成熟：模板重排/文本替换的编辑路径、HTML-to-PPTX 转换、soffice 渲染缩略图网格的视觉验证回路（能抓住文字溢出和布局问题）。MiniMax 版的设计系统（配色/字体/样式配方）可作为内容参考借鉴到适配改写中。适配重点是中文演示场景：中文字体回退、中文排版的字数密度经验。

**`pdf`：anthropics 版改编**

读取、表单填写、合并拆分、生成的完整覆盖，poppler 渲染验收回路。jerryjliu 在 X 上的批评（"PDF skill 偏简单"）针对的是 2025-10 的旧版，该 skill 在 2026-11 已经历多轮升级，批评不再成立。MiniMax 的 token 化设计系统（按文档类型推导排版、15 种封面风格）仅作为"从零生成设计感 PDF 报告"的参考思路，不合并进默认包。如后续发现 PDF 文本/图片抽取质量不足，可将解析层替换为 PyMuPDF（社区方向，验证过优于 pypdf），届时再评估。

### 打包与路由纪律

- 每个格式默认只进上述一套主实现。改编时**必须在 description 中写清触发边界**，尤其 docx（主场景为从零创建中文文档、表单填充与简单模板重排；结构性套版为降级弱项，见前述场景边界）——description 是触发准确度的唯一杠杆，system prompt 里每个 skill 的 description 都占 token。
- anthropics 上游固定 commit 打包，不跟踪 main；MiniMax 仓库处于 Beta（README 自述格式可能变动），同样固定 commit，并记录上游版本号便于后续核对更新。
- 所有 skill 内的英文流程说明做中文场景适配改写；许可证文件（Apache-2.0 / MIT 的 LICENSE）随 skill 目录一并分发，保留版权声明。

## 六、skill-creator 的选型与实现方案

**结论：直接改编 OpenAI 版为主干（Apache-2.0 可合法再分发），吸收 Anthropic 版的评测方法论作为进阶章节。**

许可证事实需要特别澄清，这是本方案返修过的点：OpenAI 的"Copyright 2026, All rights reserved"限制性许可**只覆盖其随包分发的文档四件套**（documents/spreadsheets/presentations/pdf），而 `openai/skills` 仓库 `skills/.system/skill-creator/LICENSE.txt` 与本机安装版 `~/.codex/skills/.system/skill-creator/license.txt` **均为完整 Apache-2.0**，无任何附加限制——可以合法改编再分发。因此原定的"自研重写"失去必要性，改为直接改编，省去数天工期。

两个上游的对比：

| 维度 | Anthropic 版 | OpenAI 版 |
| --- | --- | --- |
| 核心方法论 | 评测闭环驱动：访谈 → 草稿 → 测试用例 → eval-viewer 人工评审 → 量化 evals → 迭代 → 触发率优化 | 渐进式披露写作框架：三阶段信息披露、脚本/参考/资产结构规范、init/validate 脚手架 |
| 宿主耦合 | 深耦合 claude CLI 子进程、子代理并行等机制，在 pi-coding-agent 上无法直接执行 | 宿主无关，纯写作与结构规范 |
| 体量 | 约 33KB，流程重，强制评测循环 | 约 18.6KB，按需深入，符合最小充分复杂度 |
| 许可证 | Apache-2.0 | Apache-2.0（仅限 skill-creator 等 .system 目录；文档四件套仍为限制性许可，禁止拷贝） |

**实现方式**：以 OpenAI 版 skill-creator 为骨架改编——保留渐进式披露三阶段、description 触发边界、脚本/参考/资产目录规范、"假设 Agent 已有能力、只写改变决策的信息"的写作纪律，剥离其中 Codex/openai.yaml 等宿主专属机制（pi 运行时无此概念），做中文场景适配。Anthropic 版独有的资产是评测方法论（断言评分、盲测 A/B 对比、方差分析、description 触发率优化），这部分概念可自由吸收，但 eval 回路要用 pi-coding-agent 自己的会话能力重新设计，不照抄 claude CLI 的调用方式；产品的 skill-creator 面向终端用户而非专职 skill 开发者，评测闭环做成可选进阶章节而非强制流程。

skill-creator 是生态飞轮的种子：重度用户一旦开始攒自己的 Skill，迁移成本就建立了。改编成本低、用户价值高，优先级高。

## 七、运行时供给与依赖策略（所有打包工作的前置）

运行时依赖分四类，供给方式各不相同。这里有一个必须正视的事实：Agent 的执行环境是普通 PowerShell shell，**PATH 里不保证有 node**——"Electron 自带 Node"只存在于主进程内部，shell 工具够不着。因此 docx-js/pptxgenjs 的 npm 依赖链和 MCP 生态主流的 `npx` 启动方式，都需要先解决 Node 供给，否则 npm 系 skill 和绝大多数 MCP 服务器在非程序员机器上集体不可达。

**Node：随包嵌入 + 预装依赖，不走 bootstrap。** Node 单文件运行时体积小、无安装向导、无 UAC、位数单一（只发 x64），是四类依赖里唯一"随包嵌入"成本低于 bootstrap 的。具体做法：打包时把 node.exe 与四件套所需 npm 依赖放入 `resources/runtime/`，主进程启动时把它 prepend 到 `process.env.PATH`——内核 shell spawn 经 `getShellEnv()` 继承 `process.env`，所有 Agent shell 自然获得 node/npx。两个体积账目要点：(1) zip 发行版的 npm/npx 依赖 `node_modules/npm` 目录树，必须全量保留（解压约 8-10MB、压缩后约 2-3MB），否则 `npx` 不可用、MCP 供给分档失效；(2) node.exe 本身是已压缩二进制，NSIS 的 LZMA 二次压缩收益有限，若总增量超 40MB，Plan B 是改为首启时从 nodejs.org 官方 zip 下载解压（固定 LTS 版本号），而不是裁剪 npm 依赖树。

**Python：Agent 首次使用时自动 bootstrap，不随包预装。** embeddable 发行版（约 10MB 级解压）不带 pip，需要 get-pip.py 引导链，skill 内写清幂等步骤：检测 → 下载 embeddable 解压到应用数据目录 → get-pip 引导 → pip 安装 openpyxl/pandas/pypdf/markitdown。winget 路径存在 UAC 与源协议确认的交互弹窗，不作为主路径，只作为用户手动安装时的提示文案。不选"随包分发 embeddable Python"（体积 + pip 引导链仍需在线，收益小）；不把 xlsx 改写为 SheetJS 等 Node 实现（丢失 openpyxl 格式保真度与校验脚本，不划算）。

**.NET：不引入。** docx 选型已在第五节改走无 .NET 依赖的轻路径，.NET 从依赖清单中移除。

**LibreOffice 与 poppler：探测式可选增强。** 公式重算（recalc）和视觉验证（soffice 渲染 + pdftoppm 缩略图）只在探测到本机已安装时启用；未安装时降级为"生成后提示用户在 Excel/Word 中检查"。绝不做硬前置——LibreOffice 对普通用户是数百 MB 的重依赖。

**MCP 服务器供给随之分两档**：纯远程 HTTP 服务器（无需本地运行时）预置进默认 `mcp.json` 模板但 `enabled` 默认为关，用户在设置页显式开启；依赖 `npx`/`uvx` 的服务器在 Node 环境就绪前在 UI 标注为不可用或引导完成初始化。

## 八、实施路径与验收标准

按依赖关系排序，共五个阶段。阶段 0 的两项前置（分发链路 + Node 供给）不完成，后续所有 skill 都落不到用户机器上，工期按里程碑交付物计而不按天数硬估。

**阶段 0：分发链路与运行时供给（前置，唯一必须先做的开发）**

两件事，都是小改动但缺一不可：

（a）**随包 skill 分发落位**。现状缺口：内核扫描目录是 `agentDir/skills` + `~/.agents/skills` 等五个候选，**不含安装目录的 `resources/skill/`**——multichat-cli 目前是打包后靠用户手动复制，对"开箱即用"目标不成立。方案：在 `AgentSessionService` 的 `skillDirCandidates` 中追加 `resources/skill/` 路径（安装版经 `process.resourcesPath` 解析，dev 版指向仓库 `.agents/skills/`），扫描链路零改动。冲突规则：**同名 skill 以用户目录优先于随包目录**——内核同名去重是"先扫描者获胜"，`additionalSkillPaths` 排在自动扫描目录之后，该规则与内核行为天然吻合、零额外开发；规则写进设置页 skill 管理 UI 的说明。验收：干净安装后打开 Agent 会话，随包 skill 无需任何手动操作即可触发；用户在 `agentDir/skills` 放同名 skill 后触发的是用户版本。注意 dev 环境差异：内核会自动扫描 cwd 祖先目录的 `.agents/skills`，在仓库根目录跑 dev 时仓库内 skill 会以 project 身份先于 user 身份加载，"用户目录优先"的验收必须在 cwd 非仓库根的会话中进行，否则结果失真。

（b）**Node 运行时随包嵌入**（做法见第七节）。验收：干净 Windows 环境（无系统 Node/Python）触发 pptx 创建任务能跑通 npm 依赖链。

**阶段 1：Python bootstrap 基础设施**
统一的幂等安装脚本与检测逻辑（embeddable + get-pip 引导链），做成 skill 可复用的公共资产。验收：干净环境触发 xlsx 任务，Agent 自动完成 bootstrap 并产出文件；二次触发不重复安装。

**阶段 2：第一层自研 Skill**
第 0 个交付物是**触发回归任务集与 description 语言决策**：构造 10 个该触发 + 10 个不该触发的真实任务集，实测中文/英文/双语 description 的触发准确度并定版——这套任务集同时成为后续所有 skill 的触发回归基线。然后按 `multi-ai-research` → `workbench-assets` → `multi-ai-review` 顺序编写，每个进 `.agents/skills/` 并加入 `electron-builder.yml` 的 extraResources（照抄 multichat-cli 模式）。验收：让 Agent 执行一次多平台深度研究，验证扇出、回收、落盘全链路符合 skill 约定；触发回归任务集通过。

**阶段 3：文档四件套 + skill-creator**
顺序：`xlsx` → `docx` → `pptx` → `pdf` → `skill-creator`（按用户使用频率排）。改编工作含三块：中文场景适配改写、依赖 bootstrap 接线、上游固定 commit 快照进包（固定 commit 并记录版本号，MiniMax 上游处于 Beta 必做）。docx 改编时**必须把 pandoc 读取路径替换为 markitdown**（见第五节）。验收标准：**每个格式三个真实任务端到端验收**——xlsx 做"存量表格加列加公式"、"从零建财务模型"、"读取分析现有表格"；docx 做"从零写中文公文/报告"、"填表单模板"、"改稿留红线"；pptx 做"从零创建中文演示"、"基于模板替换文本"、"跑视觉验证回路抓排版问题"；pdf 做"表单填写"、"合并拆分"、"渲染验收"。**验收机须预装 LibreOffice + poppler**，否则视觉验证与公式重算任务会被静默降级跳过、验收失真。验收必须打开产出文件人工确认排版质量，不能只看文件生成成功；skill-creator 用"把一个真实工作流固化成 skill 并触发使用"验收。

**阶段 4：MCP 集成（最后，唯一的较大开发工作）**
三件事：会话创建路径接入 `agentDir/mcp.json` 加载；设置页加服务器管理 UI；**默认服务器的暴露档位按类型定**：单工具服务器（如 fetch）可 direct——它只有一个工具，direct 成本低；多工具服务器一律 deferred 或 codemode——全量 direct 注入会显著抬高每轮 token 成本。配置格式直接采用 `mcp.json` 标准（与 Claude Code/Cursor 同构），预置服务器的初始 enabled 默认为关（用户显式开启，避免静默扩大攻击面与 token 消耗）。验收：开启 fetch 服务器后，Agent 能精读给定 URL 内容；上下文占用对比验证 deferred 生效。

**预置引导（而非强装）的 MCP 服务器**，按用户价值排序：`fetch` 网页抓取类（补齐 web_search 只能搜不能精读的短板，研究刚需）；浏览器自动化（Playwright MCP，操作无适配器覆盖的网页，与产品自身 webview 自动化互补）；记忆类（memory/knowledge-graph，跨会话持久记忆过渡方案）；Obsidian/文件系统类（对已有个人知识库的用户是直接卖点）。

**阶段 5（后续，非本方案范围）**：可选 Skill 包/市场，用 find-skills 元 skill 或自建索引做按需安装。anthropics 完整四件套、`webapp-testing`、`frontend-design`/`canvas-design`、obra/superpowers 的工程方法论 skill（brainstorming/systematic-debugging 等，MIT，同时也是第一层自研 skill 的写作范文）进入可选包候选。

**全局验收纪律**：skill 修改后必须重新打包并在 dev 实测；文档类 skill 的验收以打开产出物的人眼检查为准；触发准确度用阶段 2 建立的回归任务集持续回归。

## 九、关键风险与对策

- **触发准确度稀释**：默认 skill 越多，description 噪音越大。对策：默认包收敛在 9 个；每个 description 写清触发与排除边界；同格式不留两套实现。description 语言（中文/英文/双语）在阶段 2 开工前用回归任务集实测定夺。
- **同名 skill 冲突**：用户从公开渠道自装的 skill 可能与随包同名。对策：第八节阶段 0 的用户目录优先规则 + 设置页明示。
- **Beta 上游变动**：MiniMax 仓库自述 Beta，固定 commit + 记录版本号，升级作为独立任务评估。
- **首次 bootstrap 失败**：下载超时或网络受限时 bootstrap 会失败。对策：skill 内写清降级路径（提示用户手动安装并给出链接），Agent 不得静默重试超过两次。embeddable Python 的两个已知坑 bootstrap 脚本必须覆盖：发行版不带 pip 需要 get-pip 引导链，且 `python*._pth` 文件中的 `import site` 必须取消注释否则 pip 无法生效。
- **Node 嵌入体积失控**：`resources/runtime/` 的 node + npm 依赖若超 40MB 会显著增大安装包。对策：阶段 0 验收时实测，超标则裁剪依赖（如 pptxgenjs 按需打包）或重评估。
- **许可证合规**：anthropics 部分 Apache-2.0、MiniMax 整仓 MIT、OpenAI .system 目录（skill-creator 等）Apache-2.0，均可再分发但需保留版权声明；**OpenAI 文档四件套（documents/spreadsheets/presentations/pdf）为限制性许可，任何文本都不得拷贝进包**；`brand-guidelines` 等含品牌资产的 anthropics 子目录不打包。

## 十、参考来源

- anthropics/skills（文档四件套 Apache-2.0）：https://github.com/anthropics/skills
- MiniMax-AI/skills（整仓 MIT）：https://github.com/MiniMax-AI/skills ；官方发布文章：https://x.com/MiniMax_AI/status/2036888404890378258
- openai/skills（仅作方法参考，禁止复制）：https://github.com/openai/skills
- vercel-labs/skills：https://github.com/vercel-labs/skills ；obra/superpowers：https://github.com/obra/superpowers
- awesome-claude-code 索引：https://github.com/hesreallyhim/awesome-claude-code
- pi-mono：https://github.com/badlogic/pi-mono ；awesome-pi-coding-agent：https://github.com/breatheinthefrost/awesome-pi-coding-agent
- MCP 参考服务器：https://github.com/modelcontextprotocol/servers ；Playwright MCP：https://github.com/microsoft/playwright-mcp
- X 平台社区核验：Simon Willison https://x.com/simonw/status/1976799855701000552 ；jerryjliu https://x.com/jerryjliu0/status/1979340893850341569 （针对旧版，已不成立）；zodchiii/Mr_Buzzoni/humzaakhalid/KanikaBK 等盘点帖
- 已排除候选：tfriedel/claude-office-skills（anthropics 下游镜像，作者已废弃）；glebis/claude-skills、daymade/claude-code-skills（HTML/Pandoc 路线，非原生 Office 格式）；BMAD-METHOD、github/spec-kit（重型研发流程，与产品定位不符）
- 产品内事实：`src/main/services/AgentSessionService.ts`、`src/main/services/AgentResourceLoader.ts`、`src/main/services/shell.ts`、`src/main/cliIntegration.ts`、`src/renderer/src/components/workbench/agent/AgentSkillsSettings.tsx`、`electron-builder.yml`、`node_modules/@earendil-works/pi-coding-agent` dist 产物
