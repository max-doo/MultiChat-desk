> Created: 2026-11-26 17:50 (UTC+8)

# 侧边栏 Agent 默认 Skill / 插件深度调研

## 一、结论摘要

侧边栏 Agent 的内核（`@earendil-works/pi-coding-agent` v1.6.0，pi-mono 的分支）本身是一套相当完整的生态载体：Skills 遵循 Anthropic 公开的 Agent Skills 标准（`SKILL.md` + frontmatter），**整个开源 Skills 生态的产物可以直接套用**；内核还内置 MCP 支持（`mcp.json` 配置，工具暴露分 direct/deferred/codemode/hidden 四档）和 extensions 插件机制。目前产品的问题不在"能不能用"，而在于"完全没配"：

1. 随包分发的 Skill 只有 `multichat-cli` 一个，且它只是工具说明书（CLI 用法），**没有任何方法论型 Skill**（什么时候扇出、怎么提问、怎么汇总、结果怎么落盘）。
2. 内核的 MCP 能力在产品里完全未接入（没有 `mcp.json` 的生成、管理、UI），等于放弃了整个 MCP 服务器生态。
3. 产品自身的独有资产——工作台（Workbench 文件树）、笔记、思维导图、历史会话、自动化（AutomationService）——对 Agent 没有任何暴露或方法论引导。

建议分三层建设：**第一层产品独有能力**（多模型调度方法论、知识整理、提示词库）自己写，数量少而精，这是竞对抄不走的部分；**第二层通用知识工作 Skill**（文档生产、研究、写作）直接从开源仓库改编打包；**第三层 MCP 插件层**打通内核已有能力，用配置而不是代码换来生态规模。

## 二、产品现状盘点

以下事实均来自当前代码，是后续建议的边界条件。

**Agent 会话的构成**（`src/main/services/AgentSessionService.ts` 三处 `createAgentSession` 调用）：

- 基础工具为 pi 默认集 read / bash / edit / write（Windows 用 powershell 替换 bash，见 `src/main/services/shell.ts`），另有 find/grep/ls 等。
- 自定义工具三个：`web_search`（`src/main/services/webSearchTool.ts`）、`image_gen`（`src/main/services/imageGenTool.ts`）、shell 自定义工具。
- Inline extensions 两个：上下文压缩（`src/main/extensions/contextCompression.ts`）与系统提示词裁剪（`src/main/extensions/systemPromptTrim.ts`）。
- `agentDir` 指向应用数据目录 `multichat/agent/`（不用 pi 默认的 `~/.pi/agent`），`agentDir/skills` 是内核自动扫描的全局 Skills 根。

**Skills 加载链路已经完整存在**：`AgentResourceLoader` 支持 `additionalSkillPaths`；`AgentSessionService.ts` 预置了五个候选目录（`agentDir/skills`、`~/.agents/skills`、`~/.claude/skills`、`~/.pi/agent/skills`、`~/.mu/skills`）；设置页 `AgentSkillsSettings.tsx` 提供目录勾选与自定义目录。也就是说，**"加 Skill"不需要任何架构改动，只需要内容和分发**。

**目前唯一的随包 Skill**：`resources/skill/multichat-cli`（源文件 `.agents/skills/multichat-cli/SKILL.md`），内容是 multichat CLI 的调用手册——提交任务、等待、收结果、平台能力与登录态探测。它覆盖"怎么调"，但不覆盖"什么时候该调、调完怎么处理"。

**内核版本生态事实**（核验自 `node_modules/@earendil-works/pi-coding-agent` dist 与上游 pi-mono 文档）：

- Skills 加载遵循 Agent Skills 开放标准（`dist/core/skills.ts` 中有明确的标准校验逻辑：name 小写连字符、不超过 64 字符、description 不超过 1024 字符）。这意味着 anthropics/skills、openai/skills、vercel-labs/skills 等公开仓库的 Skill 目录拷进扫描根即可用。
- MCP 支持内置：`dist/core/mcp-servers.js` 实现了 `mcp.json` 配置的校验，工具暴露支持 direct（直接注入）/ deferred（按需激活）/ codemode（代码模式）/ hidden 四档，OAuth（含 loopback redirect）在内核实现。**当前 createAgentSession 路径未加载 MCP 配置，这是纯集成缺口，不是能力缺失**。
- pi 生态原生的扩展形态是 extensions（TypeScript 单文件或包，`pi.registerMcpServer()`、`registerTool` 等 API），而非常规意义的"插件市场"；上游 `pi install` 走 npm/git 包分发。公开社区内容（awesome-pi-coding-agent 收录）目前以配置、主题、示例扩展为主，体量远小于 Skills 生态。老生态里的 `pi-mcp-adapter` 已过时——本 fork 内核自带 MCP，不需要它。

## 三、用户与使用场景推断

产品面向多模型大模型重度用户。从现有功能反推，这类用户的核心工作流是：把同一个问题或多个子问题分发到多个网页 AI 平台（统一发送、任务拆解）、组织多模型互评（辩论）、汇总多平台回答（Webview 总结）、沉淀结果（历史记录、本地笔记、思维导图）。他们的典型诉求可以归为四类：

1. **深度研究**：用各家平台的 Deep Research 能力做多源调研，然后交叉验证、去重、合成一份带引用的报告。这类用户手上往往同时开着 ChatGPT Deep Research、Gemini Deep Research、Perplexity，痛点是"每家给一份，合成靠手工"。
2. **多模型质量把关**：一个重要产出（方案、文章、代码）先让一个模型产出，再分发多家评审挑错，最后合并修订意见。辩论模式是这个诉求的产品化雏形。
3. **内容生产**：调研结果最终要变成交付物——报告、文章、PPT、表格。重度用户里有大量非程序员（咨询、运营、学生、创作者），他们要的是 docx/pptx/xlsx 成品，不是 markdown。
4. **知识沉淀**：调研结论、会话精华进入笔记和思维导图，可检索、可复用。

侧边栏 Agent 的独特位置在于：它是**唯一同时持有本地文件系统、自动化执行力和 multichat CLI（多平台调度能力）的角色**。网页里的单个 AI 做不到跨平台调度，普通 coding agent 拿不到各平台登录态。默认 Skill 的设计应当围绕这个独特性展开，而不是把 Agent 做成又一个通用 coding agent。

## 四、推荐的默认 Skill 配置

按"差异化程度 × 复用成本"分三层。每层标注了内容来源和实施成本。

### 第一层：产品独有方法论 Skill（必须自己写，各 100-400 行 Markdown）

**1. `multi-ai-research`（多平台深度研究编排）** — 最高优先级

`multichat-cli` 教的是语法，这个 Skill 教的是战法：什么规模的问题值得扇出到多平台 Deep Research；如何把调研目标拆成各家平台擅长的子问题（依据 `multichat platforms` 的能力位选择 deepResearch 平台）；并发提交后轮询的节奏；回收多份报告后的去重、冲突标记、引用归并流程；最终产出落盘到工作台目录的约定（文件名、frontmatter 标签规范，衔接工作台的全文搜索）。它是"多模型重度用户"这个定位的直接兑现，也是竞对无法复制的——因为他们没有 13 个平台的登录态会话。

**2. `multi-ai-review`（多模型评审合成）**

固定套路的评审工作流：产出初稿（本地或某平台）→ 按评审视角拆分提示词（事实核查/逻辑/表达/合规）分发多平台 → 收集意见 → 按"采纳/驳回/存疑"归类合并 → 输出修订版与评审纪要。辩论模式的 CLI 化延展，实现成本极低（纯方法论 Markdown + 复用 multichat-cli 调用）。

**3. `workbench-knowledge`（工作台知识整理）**

工作台已是带 frontmatter 标签、全文搜索、git 集成的文件系统（`workbenchService.ts`），但 Agent 不知道这些约定。这个 Skill 定义：什么时候该把结论写成笔记而不是只在对话里说完；目录组织与标签规范；思维导图文件（NoteManager 管理）何时创建、结构约定；历史会话 JSON（`history/conversations`）如何检索引用。成本极低，因为它只是"把产品已有的文件约定教给 Agent"。

**4. `prompt-library`（提示词资产库）**

重度多模型用户手里都有私藏提示词。Skill 定义一套 Markdown 模板库格式（变量插槽、适用平台标注、效果备注），放在工作台约定目录，Agent 负责检索、实例化、按使用反馈修订。这是典型的"轻量约定换长期粘性"。

### 第二层：通用知识工作 Skill（直接改编开源，按优先级排序）

> 文档四件套的源选型在 2026-11-26 做过专项对比调研（见本节末尾），结论：anthropics/skills 是当前唯一可选的合规上游，且本身就是社区事实标准。

以下按目标用户的相关度排序，仓库出处见第五节。实施成本主要在运行时依赖（见第六节）。

- **文档生产三件套 `docx` / `xlsx` / `pptx`**（来源：anthropics/skills，Apache-2.0）：调研报告和数据分析的最终交付形态。重度用户的非编程场景几乎都会落到这里。**这是第二层里最值得打包的一组**。
- **`pdf`**（同上）：合同、论文、报告的读取、填写、生成。
- **`skill-creator`**（anthropics/skills 与 openai/skills 均有）：让用户把私藏工作流固化成自己的 Skill。它是生态飞轮的种子——重度用户一旦开始攒自己的 Skill，迁移成本就建立了。打包成本为零，优先级很高。
- **`webapp-testing`**（anthropics/skills，Playwright 驱动）：对产品内用户而言价值在于验收自动化产出物（如让 Agent 生成 HTML 报告后自检渲染），通用性中等，可后置。
- **`frontend-design` / `canvas-design` / `theme-factory`**（anthropics/skills）：面向做演示、海报、简单前端的用户，属于锦上添花，建议作为"可选 Skill 包"而不是默认。
- **`find-skills` / Skills 目录检索类**（vercel-labs/skills 生态）：一个元 Skill，教 Agent 按需检索公共 Skills 目录，是"内容市场"的轻量替代。可在自有技能市场成熟前作为过渡。

不建议默认打包的：`claude-api`、`mcp-builder` 等面向 Anthropic 生态开发的 Skill（与最终用户无关）；`brand-guidelines`（Anthropic 品牌资产，许可证和适用性都不合适）；`internal-comms`、`slack-gif-creator`（场景不符）。

#### 文档四件套的源选型专项对比（2026-11-26 核验）

结论先行：**anthropics/skills 是唯一合规且社区事实标准的上游**，"用 Anthropic 版"不是将就而是当前唯一正确的答案。证据链：

1. **采用度断层第一**：anthropics/skills 约 20.1 万 stars、2.3 万 forks（作为参照 facebook/react 约 25.3 万 stars）；同生态的 openai/skills 约 2.9 万、vercel-labs/skills 约 4.1 万。2.3 万+ forks 意味着几乎所有文档类 Skill 的"社区实现"本质都是它的下游改编，不存在独立的竞品实现。社区星数最高的 obra/superpowers（约 32.7 万）是纯工程方法论库，不含任何文档处理 Skill。
2. **官方背书最强**：OpenAI 自家 Codex 产品随包分发的 documents/spreadsheets/presentations/pdf 四个 Skill 就是 anthropics 版的深度改编（本地缓存可对照），覆盖 redline、评论、模板蒸馏等场景——说明行业另一家头部厂商也认它是最佳上游。
3. **OpenAI 版不能用作分发源**：其 LICENSE.txt 明确"Copyright 2026 OpenAI, All rights reserved"，禁止提取出 OpenAI 服务、禁止复制分发、禁止衍生作品转授——只能作设计参考，**绝不可拷贝进本产品**。公开的 openai/skills GitHub 仓库本身无 LICENSE 文件，且只放出不完整的 pdf skill，没有 docx/xlsx/pptx，本来就不构成替代源。
4. **Anthropic 版许可证是刻意放开**：2026-11-06 的提交"Move Office skills to the Apache 2.0 license (#2146)"把 docx/pptx/xlsx/pdf 四件套统一迁到 Apache-2.0（各子目录附 LICENSE.txt），这是官方明确鼓励再分发的姿态。
5. **维护极活跃且近期有大升级**：2026-11-14/16 连续更新四件套（validate.py、soffice.py、zip 处理修复），且**技术栈已换代**：docx 创建从 python-docx 改为 docx-js（npm），pptx 创建改为 pptxgenjs（npm），xlsx 仍用 openpyxl/pandas，pdf 仍用 pypdf。JS 化对 Electron 产品极有利——docx/pptx 两个最高频场景不再依赖 Python。
6. **工程深度是其他实现没有的**：unpack→编辑 XML→zip 重打包的编辑路径、merge_runs.py 解决 run 碎片化、validate.py XSD 校验与 --auto-repair、tracked-changes 红线工作流、视觉验证回路（soffice 转 PDF→pdftoppm 渲染→看图验收）——这些 footgun 文档（docx-js 的表格双宽度、标题样式必须显式声明等）是大量实战沉淀，重写成本远高于改编。

**遗留的依赖风险（需在打包方案中解决）**：

- xlsx/pdf 仍是 Python 依赖（openpyxl/pandas/pypdf），且公式重算依赖 LibreOffice（recalc.py 通过 soffice 实现）。LibreOffice 对 Windows 用户是重依赖，策略上应做成"有则启用、无则降级跳过公式重算验证"的可选增强，而不是硬前置。
- 视觉验证回路（soffice + pdftoppm）同样依赖外部工具，可降级为"生成后提示用户在 Word 中检查"，或探测到本机装了 Office/WPS/LibreOffice 时启用。
- OpenAI 版有一些值得借鉴的**方法**（逐页渲染验收闭环、写作质量编辑清单、模板蒸馏流程），借鉴的是思路而非文本，不涉及其许可证限制。

### 第三层：MCP 插件层（打通内核已有能力）

内核已实现完整的 MCP 客户端（stdio + HTTP + OAuth，含工具暴露分档），产品只需做三件事：启动会话时把 `agentDir/mcp.json` 接入加载链路、设置页加服务器管理 UI、用内核的 deferred/codemode 档位控制上下文成本。配置面板无需发明格式——直接采用 `mcp.json` 标准（与 Claude Code / Cursor 同构），用户可以从任何 MCP 目录站抄配置。

打通后建议预置引导（而非强装）的 MCP 服务器，按用户价值排序：

- **`fetch` / 网页抓取类**：补齐 web_search 只能"搜"不能"精读"的短板，研究工作流刚需。官方 mcp-servers 仓库有参考实现。
- **浏览器自动化（Playwright MCP）**：让 Agent 能操作无适配器覆盖的网页，与产品自身的 webview 自动化形成互补（产品自动化走登录态页面，Playwright 走独立实例，适合无需登录的抓取与验收）。
- **记忆类（memory/knowledge-graph）**：跨会话持久记忆的参考实现，在自家知识管理成熟前可作为过渡；长期看应与 `workbench-knowledge` 合并为一套。
- **Obsidian / 文件系统类**：对已有个人知识库的重度用户是直接卖点——他们很多人笔记就在 Obsidian 里，这类集成本质是"读取用户已有资产"，风险低价值高。

注意上下文成本：MCP 工具全量 direct 注入会显著抬高每轮 token 消耗。内核的 deferred 档位（模型按需激活）正是为此设计，**默认服务器应一律用 deferred 或 codemode 注册**，这是集成方案里最容易做错的一点。

## 五、可直接套用的开源项目清单

按"拿来即用程度"排序。许可核验时间为 2026-11-26。

**可直接复制 Skill 目录进包的：**

- **`anthropics/skills`**（github.com/anthropics/skills）：Anthropic 官方 Skills 合集。文档类 Skill（docx/pptx/xlsx/pdf）为 Apache-2.0（各子目录自带 LICENSE.txt，可合法随包分发，保留版权声明即可），包含完整脚本资产（python-docx 等）和经过实战打磨的流程说明。质量是公开生态里最高的，很多社区 Skill 是它的改写版。
- **`vercel-labs/skills`**：Vercel 维护的开放目录，主打 `find-skills` 元 Skill 与工程最佳实践类，格式同标准。
- **`openai/skills`**：OpenAI 官方"Skills Catalog for Codex"，含 imagegen、documents、spreadsheets、presentations、pdf 等。**注意：GitHub API 返回的 license 字段为空，打包前必须核验各 Skill 子目录的许可条款**；在核验通过前只作格式参考，不作分发源。
- **`obra/superpowers`**：高星社区库，强在工程方法论型 Skill（brainstorming、systematic-debugging、test-driven-development 等"教 Agent 怎么干活"的 Skill）。对产品内的开发者用户价值高；其方法论 Skill 的写作方式本身也是第一层自研 Skill 的最好范文。打包前复核其仓库许可。
- **`hesreallyhim/awesome-claude-code`**（及其子资源）：不是 Skill 库而是最大规模的 Skill/插件索引站，适合作为"可选 Skill 市场"的内容源持续选品。

**用于打通插件层的：**

- **pi-mono**（github.com/badlogic/pi-mono）：上游母项目。本 fork 已内置 MCP，**不需要** `pi-mcp-adapter`（那是内置支持落地前的过渡方案，上游 awesome 列表仍收录它，属过时信息）。需要的是把内核已有的 `mcp.json` 加载链路接到产品会话创建路径上。awesome-pi-coding-agent 索引可用于跟踪生态动向。
- **`modelcontextprotocol/servers`**：MCP 官方参考服务器合集（fetch、memory、filesystem 等），TypeScript 实现，MIT 许可。既是预置服务器来源，也是自研服务器的模板。
- **`microsoft/playwright-mcp`**：浏览器自动化 MCP，是目前生态里最成熟的浏览器服务器。
- **MCP 目录站**（mcp.so、smithery 等）：第三方索引数千服务器，供选品，不建议无脑接入——大多数质量参差，预置清单应严格收敛。

**不建议引入的（针对本产品受众）：**

- **`bmad-code-org/BMAD-METHOD`**：完整的敏捷团队角色扮演框架（分析师/PM/架构师/开发/测试多角色长流程），面向软件项目全生命周期。对非研发用户过重，对研发用户又与产品的多平台调度定位无关。可作为高阶可选，不进默认包。
- **`github/spec-kit`**：规格驱动开发（spec → plan → tasks → implement），同上，纯研发流程，且与第一层方法论 Skill 思路冲突（一个是重型仪式，一个是轻量战法）。
- **`pi-mcp-adapter`**：已过时，内核自带 MCP（见上）。

## 六、实施路径与关键风险

按依赖关系和投入产出，建议的顺序是：

1. **第一层 Skill 编写**（纯内容工作，无架构改动）：`multi-ai-research` → `workbench-knowledge` → `multi-ai-review` → `prompt-library`。每个都是 Markdown 文件进 `.agents/skills/`，并加入 `electron-builder.yml` 的 extraResources（照抄 multichat-cli 的现有模式）。写完即可用 dev 环境实测。
2. **`skill-creator` + 文档三件套打包**（改编 anthropics/skills）：主要工作是依赖问题的解决（见下）和中文场景的适配改写（原版流程说明以英文写作习惯为前提）。
3. **MCP 集成**（唯一的真开发工作）：加载链路接线 + 设置 UI + deferred 默认策略。这是中期最大的生态杠杆。
4. **可选 Skill 包 / 市场**：用 `find-skills` 或自建索引做"按需安装"，默认包保持克制——默认 Skill 过多会稀释触发准确度，且每个 Skill 的 description 都占用系统提示词。

关键风险与对策：

- **Python 依赖范围已缩小但仍存在**：2026-11 升级后 docx/pptx 创建走 npm（docx-js/pptxgenjs），Electron 自带 Node 可直接承接；xlsx（openpyxl/pandas）与 pdf（pypdf）仍是 Python 依赖。Windows 目标用户大多没有 Python 环境，三个选项：(a) Skill 内写清 bootstrap 步骤让 Agent 自动装（winget 或内嵌式 Python 解压到应用目录）——成本最低；(b) 随包分发 embeddable Python——体积代价约 15-30MB；(c) xlsx 改写为 SheetJS 等 Node 实现——会丢失 openpyxl 的公式/格式保真度和现成校验脚本，不划算。建议 (a) 并把 bootstrap 做成幂等检测；LibreOffice 相关的公式重算与视觉验证做成探测式可选增强（见第二节末的专项对比）。
- **Web AI 模式的约束**：第一层 Skill 必须同时兼容 API 与网页 AI 内核。网页 AI 模式下工具调用走文本协议（WAA），长流程 fan-out 的稳定性弱于 API 模式——Skill 里应明确标注"深度研究编排建议在 API 模式下进行"之类的模式提示，而不是假设两种内核等价。
- **MCP 默认暴露档位**：前文已述，全量 direct 是上下文成本灾难，集成方案必须把 deferred/codemode 作为默认。
- **许可证**：anthropics/skills 文档类 Apache-2.0 已核验；`brand-guidelines` 等含品牌资产的子目录许可不同，不打包即可；openai/skills 许可证未明，核验前不分发。

## 七、参考来源

- anthropics/skills 仓库与各 Skill 子目录 LICENSE（Apache-2.0）：https://github.com/anthropics/skills
- openai/skills（Skills Catalog for Codex）：https://github.com/openai/skills
- vercel-labs/skills：https://github.com/vercel-labs/skills
- obra/superpowers：https://github.com/obra/superpowers
- awesome-claude-code 索引：https://github.com/hesreallyhim/awesome-claude-code
- pi-mono：https://github.com/badlogic/pi-mono ；awesome-pi-coding-agent：https://github.com/breatheinthefrost/awesome-pi-coding-agent
- pi-skills（社区维护的跨 agent skill 源）：https://github.com/zellelin/pi-skills
- MCP 参考服务器：https://github.com/modelcontextprotocol/servers ；Playwright MCP：https://github.com/microsoft/playwright-mcp
- BMAD-METHOD：https://github.com/bmad-code-org/BMAD-METHOD ；spec-kit：https://github.com/github/spec-kit （评估后排除）
- 产品内事实：`src/main/services/AgentSessionService.ts`、`src/main/services/AgentResourceLoader.ts`、`src/main/services/shell.ts`、`src/main/cliIntegration.ts`、`src/renderer/src/components/workbench/agent/AgentSkillsSettings.tsx`、`electron-builder.yml`、`node_modules/@earendil-works/pi-coding-agent` dist 产物
