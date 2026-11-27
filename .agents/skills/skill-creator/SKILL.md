---
name: skill-creator
description: "创建或改进 Agent skill 的指南。当用户想从零创建一个新 skill、修改/优化现有 skill、把某个工作流沉淀为可复用技能、或想验证 skill 的触发与产出质量时使用。涵盖：skill 的目录结构（SKILL.md/scripts/references/assets）、description 触发边界写法、渐进式披露设计、脚手架初始化与结构校验，以及进阶的评测闭环（测试用例、盲测对比、触发率优化）。Use this skill when users want to create a new skill, update an existing one, or evaluate skill quality and triggering."
license: Complete terms in LICENSE.txt
---

# Skill Creator

本 skill 提供创建高质量 skill 的方法论。skill 是模块化、自包含的目录，通过专业知识、工作流和工具扩展 Agent 的能力——可以把它们理解成特定领域的"入职指南"，把通用 Agent 变成装备了程序化知识的领域专家。

## skill 提供什么

1. **专业化工作流**——特定领域的多步骤流程
2. **工具集成**——操作特定文件格式或 API 的指引
3. **领域知识**——公司特有知识、schema、业务逻辑
4. **打包资源**——复杂重复任务所需的脚本、参考文档、资产

## 核心原则

### 简洁为王

上下文窗口是公共资源。skill 与其他一切共享上下文：系统提示、会话历史、其他 skill 的元数据、用户的真实请求。

**默认假设：Agent 已经很聪明。** 只补充 Agent 不知道的信息。逐条拷问每一段内容："Agent 真的需要这个解释吗？""这段话值回它占的 token 吗？"

优先用精炼的示例代替冗长的解释。

### 设定合适的自由度

按任务的脆弱性和可变性匹配约束强度：

**高自由度（文字指引）**：多种方法都合理、决策依赖上下文、启发式指导即可。

**中自由度（伪代码或带参脚本）**：存在优选模式、允许一定变化、配置影响行为。

**低自由度（具体脚本、少量参数）**：操作脆弱易错、一致性关键、必须遵循特定顺序。

把 Agent 想成在探路：悬崖上的窄桥需要具体护栏（低自由度），开阔草地允许多条路线（高自由度）。

### skill 的结构

每个 skill 由必需的 SKILL.md 和可选的打包资源组成：

```
skill-name/
├── SKILL.md（必需）
│   ├── YAML frontmatter（必需）
│   │   ├── name:（必需）
│   │   └── description:（必需）
│   └── Markdown 正文（必需）
└── 打包资源（可选）
    ├── scripts/      - 可执行代码（Node/Python/PowerShell 等）
    ├── references/   - 按需加载进上下文的参考文档
    └── assets/       - 用于产出物的文件（模板、图标、字体等）
```

#### SKILL.md（必需）

- **frontmatter**（YAML）：`name` 和 `description` 是 Agent 决定何时使用 skill 的唯一依据，因此必须把"skill 是什么、什么时候用"写得清晰全面。
- **正文**（Markdown）：使用 skill 的指引。只在触发后才加载（如果触发的话）。

#### 打包资源（可选）

**scripts/**：需要确定性可靠或被反复重写的可执行代码。

- **何时引入**：同一段代码被反复重写，或需要确定性保障时
- **收益**：省 token、确定性、可不经加载直接执行
- **注意**：Agent 仍可能读脚本做修补或环境适配

**references/**：按需加载进上下文的参考文档。

- **何时引入**：Agent 工作时需要参考的文档——数据库 schema、API 文档、领域知识、公司政策、详细流程指南
- **收益**：保持 SKILL.md 精简，只在需要时加载
- **大文件**（>1 万词）：在 SKILL.md 中给出 grep 检索模式
- **避免重复**：信息只在一处——要么 SKILL.md 要么 references，不要两处都写。细节性参考放 references，SKILL.md 只留核心流程指引

**assets/**：不加载进上下文、直接用于产出物的文件。

- **例**：品牌 logo、演示文稿模板、前端样板工程、字体文件、会被复制或修改的样例文档
- **收益**：与文档分离，Agent 可以直接使用而不占用上下文

#### 不要放进 skill 的东西

skill 只包含直接支撑功能的必需文件。**不要**创建多余文档：README.md、INSTALLATION_GUIDE.md、QUICK_REFERENCE.md、CHANGELOG.md 等。skill 应该只装"让 Agent 干好活"所需的信息，不装创作过程记录、安装说明、面向用户的文档——那些只是噪声。

### 渐进式披露

skill 用三层加载机制管理上下文：

1. **元数据**（name + description）——始终在上下文（约 100 词）
2. **SKILL.md 正文**——触发时加载（控制在 500 行内）
3. **打包资源**——按需加载（理论上无限，因为脚本可以不经加载直接执行）

SKILL.md 接近行数上限时拆分出去，并在 SKILL.md 中清楚引用——写明何时该读哪个文件，确保读者知道它们的存在和用途。

**关键原则**：skill 支持多种变体、框架或选项时，SKILL.md 只留核心流程和选择指引，变体细节（模式、示例、配置）拆进独立参考文件。

**模式 1：高层指南 + 参考文件**

```markdown
# PDF 处理

## 快速上手
用 pdfplumber 抽取文本：[代码示例]

## 进阶特性
- **表单填写**：见 FORMS.md 完整指南
- **API 参考**：见 REFERENCE.md 全部方法
```

**模式 2：按领域组织**

```
cloud-deploy/
├── SKILL.md（工作流 + 平台选择指引）
└── references/
    ├── aws.md
    ├── gcp.md
    └── azure.md
```

用户选 AWS 就只读 aws.md。

**模式 3：条件细节**

```markdown
## 编辑文档
简单编辑直接改 XML。
**修订留痕**：见 REDLINING.md
**OOXML 细节**：见 OOXML.md
```

**重要约束：**

- **避免深层嵌套引用**——references 从 SKILL.md 直达一层，不要 reference 套 reference
- **长参考文件**（>100 行）开头放目录，预览时就能看清全貌

## 创建流程

按顺序执行以下步骤，有明确理由才跳过：

1. 用具体例子理解 skill
2. 规划可复用资源（scripts/references/assets）
3. 初始化 skill（init-skill.mjs）
4. 编辑 skill（实现资源、撰写 SKILL.md）
5. 校验 skill（validate-skill.mjs）
6. 基于真实使用迭代

### 命名规则

- 只用小写字母、数字、连字符；用户给的标题规范化为 hyphen-case（"Plan Mode" -> `plan-mode`）
- 64 字符以内
- 优先简短的动宾结构
- 有助于触发时按工具加命名空间（如 `gh-address-comments`）
- 目录名与 skill 名完全一致

### 第一步：用具体例子理解 skill

只有当用法模式已经很清楚时才跳过。即使是改进现有 skill，这一步也有价值。

当前对话可能已经包含用户想沉淀的工作流（"把这个变成 skill"）——先从对话历史提取答案：用了什么工具、步骤顺序、用户做过的纠正、输入输出格式。缺口再问用户，确认后再进下一步。

要问的具体问题示例：

- "这个 skill 应该支持哪些功能？"
- "能举几个使用场景的例子吗？"
- "用户会说什么样的话来触发它？"

别一次问太多问题。先问最关键的，按需追问。

### 第二步：规划可复用资源

逐个分析具体例子：

1. 考虑从零执行这个例子需要什么
2. 识别哪些脚本、参考文档、资产在反复执行时会有帮助

例：处理"帮我旋转这个 PDF"类请求——旋转代码每次重写，值得固化为 `scripts/rotate_pdf.py`。
例：搭建前端应用——同样的 HTML/React 样板每次重写，值得做 `assets/hello-world/` 模板。
例：查询业务数据——表结构每次重新发现，值得写 `references/schema.md`。

### 第三步：初始化 skill

从零创建新 skill 时，**总是**运行脚手架脚本（Node，无需 Python）：

```powershell
node scripts/init-skill.mjs <skill-name> --path <输出目录> [--resources scripts,references,assets] [--examples]
```

示例：

```powershell
node scripts/init-skill.mjs my-skill --path ./skills
node scripts/init-skill.mjs my-skill --path ./skills --resources scripts,references
node scripts/init-skill.mjs my-skill --path ./skills --resources scripts --examples
```

脚本会：创建目录、生成带 TODO 占位的 SKILL.md 模板、按 `--resources` 建资源目录、按 `--examples` 加示例文件。名称自动规范化为 hyphen-case 并校验长度。

初始化后按需定制。用了 `--examples` 就替换或删除占位文件。

### 第四步：编辑 skill

记住：skill 是给**另一个 Agent 实例**用的。写入对它有益且非显而易见的信息——程序化知识、领域细节、可复用资产。

**先做资源**：实现第二步识别的 scripts/references/assets。这一步可能需要用户输入——品牌资产、模板文件、内部文档。加入的脚本必须真实运行测试，确认无 bug、输出符合预期；同类脚本很多时，抽样测试代表性的一部分即可。

**再写 SKILL.md**：

- 始终用祈使句/动词原形
- **frontmatter**：`name` + `description`，不要加其他字段（`license` 字段仅在分发第三方改编 skill 时按原样保留）
- **description 是唯一的触发机制**，把"何时使用"全部写在这里——写在正文里没用，因为正文只在触发后才加载。包括：skill 做什么 + 具体触发场景/文件类型/任务。用户的语言习惯要考虑到：中文用户说"帮我弄个 PPT"和英文 "create a deck" 都应能命中——**中英双语 description 在中文用户场景下通常更稳**（见进阶章节的触发率优化）
- 反面示例（太被动）："How to build a dashboard."
- 正面示例（明确触发边界）："Comprehensive document creation, editing, and analysis... Use when the agent needs to work with .docx files for: (1) creating new documents, (2) modifying content, (3) tracked changes..."。中文同理写清"当……时使用本技能"

**写作风格：解释"为什么"而不是堆砌"必须"。** 今天的模型有足够的理解力——给出指令背后的原因，它们能超越教条完成任务。发现自己在写全大写的 ALWAYS/NEVER 或超刚性结构时，是个黄色信号：尽量改写为解释性的表述。但这不适用于真正会损坏文件的硬约束（破坏性操作、安全红线）——那些就该说死。

**写示例**：输入/输出对照格式很有效：

```markdown
**示例 1：**
输入：添加了 JWT 用户认证
输出：feat(auth): implement JWT-based authentication
```

### 第五步：校验 skill

完成后运行结构校验：

```powershell
node scripts/validate-skill.mjs <skill目录>
```

校验 frontmatter 格式、必填字段、命名规则（hyphen-case、≤64 字符）、description 长度（≤1024 字符、无尖括号）。失败就按报告修复重跑。

### 第六步：迭代

测试后用户常会提出改进——趁热打铁：

1. 在真实任务上使用 skill
2. 观察吃力或低效之处
3. 确定 SKILL.md 或资源该怎么改
4. 改了再测

## 进阶：评测闭环

以下方法论改编自 Anthropic 版 skill-creator（Apache-2.0）的评测体系，重新设计为通用 Agent 会话可执行的流程。它是**可选进阶**，不是强制流程——简单 skill 走前六步就够了；当 skill 会被高频使用、产出质量需要量化、或触发准确度出问题时，启用本节。详细操作模板见 `references/eval-loop.md`。

### 什么时候值得做评测

- skill 产出**客观可验证**（文件转换、数据抽取、固定流程）——值得做断言评分
- skill 产出主观（文风、设计）——以人审为主，不强行量化
- 触发不准（该触发不触发/不该触发乱触发）——做 description 触发率优化

### 评测闭环概览

```
访谈明确意图 -> 写 skill 草稿 -> 构造 2-3 个真实测试用例
  -> 对照运行（带 skill vs 不带 skill，或新版 vs 旧版）
  -> 断言评分 + 用户人工评审 -> 按反馈改写 -> 重复直至满意
  -> 扩大测试集规模 -> （可选）description 触发率优化
```

### 测试用例

写 2-3 个**真实用户会说的**测试提示（不是抽象的"测试功能 X"），存为 `evals/evals.json`：

```json
{
  "skill_name": "example-skill",
  "evals": [
    {
      "id": 1,
      "prompt": "用户的任务提示原文",
      "expected_output": "预期结果的描述",
      "files": []
    }
  ]
}
```

好的测试提示有具体细节：文件路径、用户背景、列名数值、公司名、URL，甚至口语、缩写、错别字。

### 对照运行与评分

运行时若支持子代理/并行会话，为每个用例同时跑**带 skill** 与**基线**（新 skill 用"无 skill"做基线；改进现有 skill 用"旧版快照"做基线）；不支持并行就串行跑。结果按 `workspace/iteration-N/eval-名称/` 组织。

**断言要客观可验证、名字能读**：看一眼就知道它在查什么。可程序化的断言写成脚本跑（更快更可靠，还能跨迭代复用）；主观质量交给用户人审。运行结束记录每个断言的 `text/passed/evidence` 三要素。

**盲测对比**（可选、更严格）：把两个版本的产出打乱顺序交给独立的评审者（另一个会话或用户本人），不告知哪个是新版本，避免"新的肯定好"的心理偏向。

### 改进心法

1. **从反馈中泛化**——skill 要在千万种提示下工作，不要为过拟合几个测试例子打补丁。某个问题顽固时，换个比喻、换种工作模式推荐，成本很低
2. **保持 skill 精简**——删掉不出力的内容。读运行过程而不只是最终产出：如果 skill 让模型做了一堆无用功，删掉诱因再测
3. **解释为什么**——模型有足够的心智理解指令背后的原因，解释性文字比刚性 MUST 更有力
4. **留意重复劳动**——多个测试用例中模型各自写了相似的辅助脚本或走了同样的多步路径，就是把它固化进 `scripts/` 的强信号

### description 触发率优化

触发机制的本质：skill 的 name + description 出现在可用列表里，Agent 据此决定是否查阅。要点——**简单一步任务即使 description 匹配也可能不触发**（Agent 自己能搞定就不会查 skill），所以触发评测的用例必须足够实质。

流程（详见 `references/eval-loop.md`）：

1. 构造 20 条评测查询：8-10 条**应触发**（覆盖不同表述——正式/口语/不点名文件类型/边缘场景），8-10 条**不应触发**（重点是近似误判——共享关键词但实际需要别的东西）。"写个斐波那契函数"这种明显无关的负例没有测试价值
2. 给用户确认评测集——坏用例会导致坏 description
3. 划分训练集（60%）与留出集（40%），逐条评测当前 description 的触发情况，分析失败模式后改写，用留出集验证防过拟合
4. 对比前后触发率，把最优 description 写回 frontmatter

## 安全红线

skill 不得包含恶意软件、利用代码或任何危害系统安全的内容；其意图对描述它的用户不应有意外。不配合创建误导性 skill 或便于未授权访问、数据外泄的 skill。角色扮演类（"扮演某某"）是正常的。

## 参考文件

- `references/eval-loop.md`——评测闭环的操作模板：evals.json 模式、断言设计、对照运行组织方式、触发率优化的逐步流程
