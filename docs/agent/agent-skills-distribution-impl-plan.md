> Created: 2026-11-27 17:10 (UTC+8)

# 侧边栏 Agent 预设 Skill 分发与运行时供给实施方案

本文是 `docs/research/agent-skills-research-2026-11.md`（定稿调研）的落地实施计划。调研文档已定稿，本文不重复论证选型，只解决三个落地问题：**随包 skill 如何在新版本安装后自动对侧边栏 Agent 生效**、**Node/Python 运行时如何到达普通用户机器**、**各 skill 内容与验收如何组织**。范围说明：按用户要求，自研 `multi-ai-research` 本期不做；其余 skill 全部按调研文档执行；MCP 集成（调研文档阶段 4）是独立的较大开发工作，本期不含，仅在文末列出后续衔接。

## 一、目标与非目标

**目标**：用户安装新版本后，打开工作台侧边 Agent，无需任何手动复制操作，`multichat-cli`、`multi-ai-review`、`workbench-assets`、`docx`、`xlsx`、`pptx`、`pdf`、`skill-creator` 共 8 个 skill 自动可用；docx/pptx 的 npm 链路在非程序员机器（无系统 Node/Python）上开箱可跑；xlsx/pdf 的 python 链路在首次使用时自动完成 bootstrap。

**非目标**：不做 `multi-ai-research`；不做 MCP 集成（调研文档阶段 4）；不做 skill 市场/可选包；不做 skill 的 UI 启停开关（见第三节的已知限制）。

**平台范围声明（2026-11-27 修订）**：分平台分层的实际成本差异很大，按层处理而非整平台降级——

| 层 | Windows | mac/linux |
| --- | --- | --- |
| skill 扫描挂载 | 可用 | 可用（纯路径逻辑，三平台一致） |
| Node 入口（spawnHook/ELECTRON_RUN_AS_NODE） | 可用 | 可用（unix shell 无 cmd/ps1 两类坑，机制更简单；mac 有 multichat.sh 先例） |
| python 系统探测 + venv 转化 | 可用 | 可用（linux 发行版多自带 python3） |
| python embeddable 全自动兜底 | 可用 | **降级**：embeddable zip 是 Windows 独占格式，mac/linux 无系统 python 时提示用户手动安装（brew/apt 一行命令）并给链接 |
| LibreOffice/poppler 探测增强 | 可用 | 可用（探测命令适配） |

**验证能力边界（诚实声明）**：开发机是 Windows，mac/linux 链路只能做到代码级审查与静态核验（shim 执行位、Electron.app 二进制路径推导、shell 语法），**真实验收需要 Mac 主机实测**；无 Mac 时 mac 验收标注为"未实机验证"而非通过。

## 二、现状事实（已核验代码）

以下事实决定了方案形态，均为当前代码核验结果：

- **内核扫描链路与优先级**：pi 内核 `resource-loader.js` 按 project（rank 0-1）→ user（rank 2-3）→ additionalSkillPaths（最后）的顺序合并 skill 路径，`loadSkills` 按序"先扫描者获胜"做同名去重。`agentDir/skills`（即 `<userData>/agent/skills`）是 user scope 全局目录，天然压过随包目录。仓库内 skill 源选址 `build/skills` 后，dev 环境不再有 project scope 抢先问题（选址理由见第四节末尾）。
- **当前缺口**：`AgentSessionService` 创建会话时 `extraSkillDirs` 只传用户勾选的目录，**随包的 `resources/skill/` 从未进入扫描链**——这就是 `multichat-cli` 至今需要用户手动复制的根因（`src/main/services/AgentSessionService.ts` 会话创建处）。
- **shell 环境继承**：内核 `getShellEnv()`（`dist/utils/shell.js`）以 `process.env` 为底展开 PATH，主进程在启动早期修改 `process.env`（注入 PATH 与自定义变量）即可通达所有 Agent shell，无需改内核。
- **体积实测（2026-11-27 本机实测）**：Node v26.13.1 LTS win-x64 zip 39.3MB、解压 107.7MB（node.exe 95.5MB + npm 树 12MB）；node.exe 经 deflate-optimal 压缩 37MB，说明其已是高熵二进制、二次压缩收益有限；`docx@9.16.1 + pptxgenjs@4.0.1` npm 依赖解压 29.6MB、压缩后仅 7.4MB。
- **Electron 本体即 Node（决定性实测）**：`ELECTRON_RUN_AS_NODE=1` 时 Electron 二进制就是完整 Node 解释器（本机实测 electron 42 返回 node v24.17.0）。安装版 `MultiChat.exe` 与 electron.exe 是同一二进制，意味着用户机器上必然存在一个 Node 运行时——**不需要随包再嵌入 node.exe**。唯一要解决的是给 Agent shell 一个 `node` 命令入口，这用一个几百字节的 shim 就能做到（见第五节）。

## 三、关键决策一：分发机制——扫描挂载，而非复制安装

用户原始诉求是"新版本安装时自动安装到全局 skill 目录"。两个候选机制：

| | 方案 A：扫描挂载（推荐） | 方案 B：启动时复制到 `agentDir/skills` |
| --- | --- | --- |
| 机制 | 会话创建时把随包 `resources/skill/` 追加进 `additionalSkillPaths`，内核直接扫描 | 应用启动时把随包 skill 复制进 `<userData>/agent/skills`，内核原本就扫该目录 |
| 升级行为 | 随安装包原子更新，永不过期 | 需处理覆盖/版本比对/失败重试 |
| 用户魔改 | 不可能（安装目录只读），但用户可在全局目录放同名 skill 覆盖 | 用户改了会被下次覆盖或不再更新，语义复杂 |
| 用户删除 | 不适用（不存在副本） | 被删的 skill 会在下次启动"复活"，需要额外状态机记住用户删除意图 |
| 实现复杂度 | 约几十行主进程改动，零状态 | 复制 + 清单哈希 + 删除保护 + 迁移，数百行状态逻辑 |

**推荐方案 A（扫描挂载）**，理由：调研文档第八节阶段 0 的定稿就是它；它与内核优先级语义天然吻合（user > bundled，零额外代码）；方案 B 独有的"用户可见副本"价值很低，因为 skill 本来就不需要用户阅读或编辑——想覆盖的用户直接在全局目录放同名文件即可，该路径在方案 A 下同样成立。方案 A 以功能性方式满足"全局可用、免手动复制"的诉求，`agentDir/skills` 保持为用户自己的全局目录、不被应用写入污染。

**冲突与覆盖规则**（内核原生语义，写进设置页说明）：同名 skill 优先级为 项目目录 > 用户全局目录 > 用户自定义附加目录 > 随包目录。用户在 `agentDir/skills` 放同名 skill 即生效用户版本，随包版本静默让位，这也是官方推荐的定制路径。

**已知限制**：随包 skill 暂不提供逐个启停的 UI 开关。技术上 pi 内核确有 `skillsOverride` 钩子，但仓库封装层 `AgentResourceLoader` 的 options 目前没有该字段，未来做启停开关需要同时扩展封装层（评审修正：并非零成本透传）。本期不做。

## 四、分发链路改造（开发项 S1）

1. **新增 `src/main/services/bundledSkills.ts`**：导出 `getBundledSkillsRoot()`——`app.isPackaged` 时返回 `join(process.resourcesPath, 'skill')`；dev 时返回 `join(app.getAppPath(), 'build', 'skills')`。目录不存在时返回 null（防御构建缺漏）。
2. **会话创建接线**：`AgentSessionService` 中**全部四处** `AgentResourceLoader` 构造点（`newSession`、`resumeSession`、`forkSessionAtLeaf`、`listSkills`——独立评审发现方案初稿漏掉 fork 路径，漏接会导致 fork 出的分支会话丢失全部随包 skill 且常规验收测不到）统一改为 `[...this.getExtraSkillDirs(), ...bundled]`（用户附加目录在前、随包在后，保证用户目录在 additional 序列里也优先）。实现上收敛为一个私有方法 `resolveSkillDirs()` 供四处调用，避免逐处改数组再次漏点。这是**追加而非替换**：用户勾选目录语义不变。
3. **设置页展示**：`AgentSkillsSettings` 目录列表末尾追加一行随包目录（只读、标注"随包内置"），并在区块内写清覆盖优先级一句话：同名 skill 以用户目录中的版本优先于随包版本。
4. **打包配置**：`electron-builder.yml` 的 `extraResources` 把 `.agents/skills/multichat-cli` 单条改为 `build/skills → skill`（整目录），`electron-builder-portable.yml` 同步重复声明（extends 数组是覆盖语义，这是已踩过的坑）。整目录拷贝的前提是 `build/skills` 不混入非分发内容——本期新增的 7 个 skill 全部是分发内容，成立。
5. **`cliIntegration` 保持不动**：它的 `getSkillDir()` 服务的是"复制安装命令给外部 agent"流程，与侧边栏 Agent 的自动加载互不冲突，继续指向 `resources/skill/multichat-cli`。

**仓库内路径选址（2026-11-27 用户反馈后修订）**：skill 源放 `build/skills/` 而非 `.agents/skills/`——`.agents/skills` 是 agent 生态的自动扫描约定目录（pi 内核扫描 cwd 祖先的 `.agents/skills`，其他宿主 agent 同惯例），仓库根存在该目录会让任何在仓库内工作的 agent 自动加载全部随包 skill，污染开发上下文（已实证发生）。`build/skills` 与 `build/cli`、`build/installer.nsh` 同属打包资源的家，dev 模式经 `getBundledSkillsRoot()` 显式挂载，行为与生产一致。

## 五、关键决策二：Node 供给——复用 Electron 本体做解释器，零体积增量

**为什么 skill 需要 Node**：这是最容易误解的一点——skill 的资产（Markdown、脚本、依赖库）确实随安装包解压即落地，但 docx/pptx 的核心生成脚本（docx-js/pptxgenjs）是 **JavaScript 程序，用户每次让 Agent 生成文档时都要在本机执行它们**。普通用户机器上没有 Node 解释器，脚本落了地也跑不起来。Electron 自带的 Node 只存在于主进程内部，Agent 的 shell 是独立进程够不着它。所以问题从来不是"装资产"而是"给用户机器一个 JS 解释器"。

**关键事实（已实测）**：`ELECTRON_RUN_AS_NODE=1` 环境下 Electron 二进制就是完整 Node（v24.x，满足 docx/pptxgenjs 的 node>=18 要求）。安装版用户机器上 `MultiChat.exe` 必然存在，因此**嵌入 node.exe 的 37MB 体积增量整个取消**——这是本方案相对调研文档第七节"随包嵌入 Node"的重要优化，调研写作时未验证 Electron run-as-node 的可行性。

**落地机制——spawnHook 函数注入为主，`.cmd` shim 兜底（2026-11-27 经独立评审修正）**：

评审实测否决了两个朴素方案：`.cmd` shim 的 `%*` 转发经 cmd 二次分词会破坏含 `&` 等元字符的参数，且 libuv 的 `\"` 转义 cmd 不理解；`.ps1` shim 则因 PowerShell 脚本参数绑定把 `-e` 当脚本参数而根本不可用。最终采用双层设计：

- **主链路（spawnHook）**：pi 内核 `createPowerShellToolDefinition` 支持 `spawnHook`（`bash.d.ts` 已核型），而 `AgentSessionService` 本来就以 customTools 替换了 shell 工具。在 `shellCustomTool` 里注册 spawnHook，向每条发往 PowerShell 的命令前部注入一个 `node` 函数定义：
  ```powershell
  function node { $env:ELECTRON_RUN_AS_NODE='1'; & '<exe绝对路径>' @args; $script:LASTEXITCODE = $LASTEXITCODE }
  ```
  （`<exe绝对路径>` 打包版为 `process.execPath` 即 MultiChat.exe，dev 版直接不注入、用系统 node）。`@args` 是 PowerShell 原生转发，不经 cmd 二次分词，含空格/`&`/引号的参数无损到达 `process.argv`（评审已对照实测）；`ELECTRON_RUN_AS_NODE` 只存在于本次 `-Command` 进程作用域，不进主进程 `process.env`，Chromium 子进程风险归零；零随包文件、不占 PATH。
- **兜底链路（`.cmd` shim）**：spawnHook 注入的函数不进嵌套 shell（skill 脚本内部再 `powershell -Command` 或调 cmd 的极端情况）。为此仍在 `resources/runtime/bin/` 放一个 `node.cmd`（`set ELECTRON_RUN_AS_NODE=1` + 调 exe 的 `%*` 版，布局推算 `%~dp0..\..\..\MultiChat.exe` 经评审核验与真实安装布局吻合），其目录 prepend 进 PATH。skill 指令主用顶层 powershell 工具调用 node（主链路），嵌套场景遇到 `%*` 元字符破坏属已知局限，在 SKILL.md 写作纪律中规避（脚本一律 `node script.js` 式调用，不经 cmd 手工拼接复杂参数）。
- **为什么不在主进程全局 export `ELECTRON_RUN_AS_NODE=1`**：该变量会被 Chromium 的 GPU/renderer/utility 子进程继承，让它们全部退化为 Node 模式、整个应用直接坏掉（这正是项目记忆里"Electron 系 IDE 终端必须清除该变量"的同型事故）。
- bash shim 不做：Windows 上 Agent shell 是 PowerShell 专属（bash 被 excludeTools 排除），Git Bash 兼容不是验收项。
- dev 环境：直接用系统 node（开发机必有），spawnHook 注入与 shim 都只在打包版生效。

**npm 依赖仍然是打包期预装**：新增 `scripts/prepare-runtime.mjs`，对每个含 `package.json` 的 skill（`build/skills/*/package.json`）执行 `npm install --omit=dev`（用开发机的系统 npm，与用户机器无关），生成的 `node_modules` 随 skill 目录一起进包。**运行时完全不需要 npm/npx 命令**，skill 脚本一律 `node xxx.js` 直调，依赖经 node 的相对路径解析命中同目录 `node_modules`。npm 依赖压缩后约 7.4MB（docx+pptxgenjs 合计实测），是本期唯一的体积增量，远小于嵌入 Node 的 37MB。

**构建接线（评审指出的遗漏）**：`.gitignore` 全局忽略 `node_modules/`，预装产物不进 git——**每次打包都必须先跑 prepare-runtime**，手工步骤必然被遗忘，因此把 `prepare-runtime` 直接接线进 `package.json` 的 `build:win`/`build:win:all`/`build:win:portable` 脚本链（mac/linux 见下方范围声明）。dev 前置条件同步明确：dev 模式的 python/node skill 链路要求先跑过一次 `node scripts/prepare-runtime.mjs`（生成 `build/runtime/`），否则 `MULTICHAT_RUNTIME_DIR` 指向不存在目录、bootstrap 不可验——写进 S1/S2 验收前置。

**pptx 图标链的替代方案（2026-11-27 修订，弃用原生依赖路线）**：上游 pptx skill 的图标链路（react-icons→ReactDOMServer 渲 SVG→sharp 栅格化 PNG）依赖 sharp 这个平台相关原生模块，跨平台预装成本高，原方案一度排除整个图标能力。**实测发现更优路径**：pptxgenjs 的 `addImage` 直接支持 `data: "image/svg+xml;base64,..."` 静态嵌入 SVG，且自动生成 PNG 回退双部件（本机实测生成 pptx 内含 `image-1-1.png` 占位 + `image-1-2.svg` 实体）——PowerPoint 2016+ 原生渲染 SVG，**整个图标链不需要 sharp、react、react-dom 任何一个**。最终方案：图标素材改为纯数据——IconifyJSON 格式（lucide 集，ISC/MIT 许可）经 `@iconify/utils`（纯 JS）离线生成 SVG 字符串直接嵌入，包清单为 `@iconify/utils` + `@iconify-json/lucide`（本机实测两包解压合计仅 0.9MB），全纯 JS、零原生依赖。已确认的限制写进 SKILL.md：老版本 PowerPoint/WPS 不支持 SVG 渲染时会显示空白占位（回退 PNG 是空图），此时应不用图标改用文字/色块排版——这是排版风格选择而非错误。不用 emoji 充数（emoji 在严肃商务演示中不专业，且渲染随平台漂移）。

**运行时无 npm/npx 的文案清零（验收硬指标）**：staging skill 中"npm install 兜底""node/npm/npx 保证可用"一类指引在目标用户机器上必然走进死路（评审实测）。集成时全文检索 `npm`/`npx` 命中必须清零或改写为"依赖已随包预装，直接 require 命中同目录 node_modules"，`S3` 验收包含此条全文检索。

**主进程环境注入（`src/main/index.ts` 启动早期）**：新增 `src/main/services/agentRuntimeEnv.ts`：

- 把 shim 目录（打包版 `resources/runtime/bin`）prepend 到 `process.env` 的 PATH（大小写不敏感查找键，与内核 `getShellEnv` 同款防御；dev 时跳过，用系统 node）；
- 设置 `process.env.MULTICHAT_AGENT_DIR`，**推导口径写死为 `join(dirname(store.path), 'agent')` 并复用 `AgentSessionService` 的同一 store 实例**——禁止用 `app.getPath('userData')` 推导：便携模式下 userData 被重定向为 `<install>/data/session` 而 store cwd 是 `<install>/data`，两者推导结果不同，写错了只有便携版坏（评审指出的最难发现的一类 bug）。`process.env.MULTICHAT_RUNTIME_DIR = <resources/runtime 或 build/runtime>` 同理；
- 全部操作幂等（重复 prepend 前先检查）。

**注入即生效的依据**：内核 shell spawn 经 `getShellEnv()` 展开 `process.env`，而 `AgentSessionService` 每次创建会话时才构造 loader 与 spawn，启动早期注入先于任何会话创建，无缓存问题。

## 六、关键决策三：Python bootstrap——统一共享脚本，首用幂等安装

**先回答"要不要自带运行时"这个根问题（业界对照，2026-11-27 核验）**：担心用户已有 Node/Python 会造成重复安装，这个判断对开发者成立、对产品目标用户不成立——调研文档明确定义目标用户是"多模型重度用户，含大量非程序员"。业界两类产品的做法分界清晰：面向消费者的 Agent 桌面应用一律自供运行时（本机实证：Codex 桌面应用为文档四件套在 `~/.cache/codex-runtimes/` 预置了 node 350MB + python 226MB + poppler/powershell 等 native 依赖共约 3GB；SkillsBench 论文记录其工程经验正是"provide a clean, dependency-free skill that already bundles the correct runtime"）；面向开发者的 CLI agent（Claude Code/Codex CLI/pi）才依赖宿主环境。uv/astral 的官方安装指南把"无管理员权限、无系统 Python 也可安装"列为卖点，Homebrew 文档将 python 管理形容为"如果你跟随足够多的教程，机器上会有十几个可执行文件打架"——都说明"假设用户已有环境"从来不是面向消费者的可接受策略。MultiChat 的产品形态属于前者。

但用户的质疑有一半应当吸收：**不重复占用已有环境**。因此 Python 采用三级回退而非无条件自备：

- **单一共享实现** `build/runtime/shared/ensure-python.mjs`（Node 编写、零依赖），经 `prepare-runtime` 拷入 `resources/runtime/shared/`。skill 内约定统一调用方式：`node "$env:MULTICHAT_RUNTIME_DIR/shared/ensure-python.mjs" --packages "openpyxl pandas"`，输出 JSON 状态行（包含 `pythonExe` 绝对路径与 `source` 标记：`managed`/`system`/`bootstrapped`）。skill 流程拿到 `pythonExe` 后显式用绝对路径调用。
- **三级回退顺序**：(1) 已就绪的应用内 managed python（`$MULTICHAT_AGENT_DIR/python` 或 `$MULTICHAT_AGENT_DIR/python-venv`）直接用，零成本；(2) 系统 python——**安全探测**后，版本 ≥3.10 且有 pip 则一次性 `python -m venv $MULTICHAT_AGENT_DIR/python-venv` 把它转化为 managed python，**开发者用户零重复安装且不污染其系统环境**（venv 隔离，pip 包只进 venv）；(3) 两者皆无才走 embeddable bootstrap（约 10MB 解压，普通用户无感获得能力）。这样既吸收"不重复安装"的诉求，又不让非程序员用户面对"请自行安装 Python"的死路——对后者来说那不是提醒，是功能不可用。venv 方案取代初稿的 `pip install --user`：--user 会把包装进用户全局 user-site，与用户其他项目的包版本互相覆盖且依赖解析无一致性保证；venv 一次性创建（python.org 安装器自带 ensurepip）后三个层级的依赖解析完全一致（独立评审意见，采纳）。
- **系统 python 的安全探测姿势（写死）**：只允许 `python --version` / `py -3 --version` 带超时执行并解析 stdout 的 `Python 3.x.y`——**严禁 `where python` 或裸调 `python` 判存在**：Windows 应用商店的 app execution alias stub（`%LOCALAPPDATA%\Microsoft\WindowsApps\python.exe`）在很多干净机器 PATH 里，裸调会弹出 Microsoft Store 窗口，Agent 后台触发极其恶劣。版本合格后再验证 `python -m pip --version`，无 pip 则直接降级 tier3 而不是安装失败。
- **并发锁（必备）**：多个 Agent 会话并行首次触发 python 链路时，解压覆盖与并发 pip 会真实损坏环境。`ensure-python.mjs` 必须用原子 mkdir lockdir 做跨进程互斥（含陈旧锁超时回收），三级全部路径共用；此项进验收标准。
- bootstrap 职责：探测 → 下载 embeddable zip（固定 3.12.x 版本，带 checksum）解压 → get-pip 引导 → **取消 `python*._pth` 中 `import site` 注释**（已知坑，不做则 pip 无效）→ pip 安装指定包（已装则跳过，幂等）→ 网络失败最多重试 2 次，超限输出手动安装指引并以非零码退出。
- **版本统一**：embeddable 固定 3.13.x（与 worker 已实测验证的 3.13.9 保持一致，修正初稿 3.12.x 的笔误）。
- 支持 `--target-dir` 覆盖安装目标，供开发与验收在临时目录安全演练。
- 各 skill 的 SKILL.md 只写调用约定与包清单，不内嵌安装逻辑。worker 产出的 skill 目录里自带的 `ensure-python.mjs` 副本在集成时统一替换为上述共享调用约定（worker 已知悉接口契约）。
- **首次 bootstrap 的用户可见性**：Agent 执行 bootstrap 时应在回复中说明正在为用户准备 python 运行环境（一次性、约 10MB），不做静默下载——这既是透明度要求，也让网络慢时用户理解等待原因。

**LibreOffice/poppler** 维持探测式增强：xlsx 的 `libreoffice_recalc.py`、pptx/pdf 的渲染验证仅在探测命中时启用，否则走降级提示。**注意：`where` 在 PowerShell 里是 `Where-Object` 别名，探测必须写 `where.exe soffice` 或用 `Get-Command`**（评审指出的事实错误，skill 文案中同样修正）。验收机需预装两者（见第九节）。

## 七、skill 内容生产分工与集成路径

上游快照已固定到 `scratch/skill-workshop/_upstream/`：anthropics/skills @ `e4bb5d9`（2026-11-16）、MiniMax-AI/skills @ `02853d8`（2026-11-10）、openai/skills @ `49f948f`（仅 `.system/skill-creator` 可用）。

| skill | 生产者 | 来源与改造要点 |
| --- | --- | --- |
| `docx` | worker A | anthropics 主干 + MiniMax 五件文本资产成套移植（cjk_typography/scenario_c_apply_template/openxml_element_order/openxml_units/troubleshooting），无 .NET，pandoc 改 markitdown，场景边界写进 description |
| `xlsx` | worker A | MiniMax 主干：XML 直改 + 辅助脚本 + libreoffice_recalc 探测式 + pandas 批量路径 |
| `pptx` | worker B | anthropics 改编：中文排版适配、soffice 视觉验证探测式 |
| `pdf` | worker B | anthropics 改编：读取/表单/合并/生成全覆盖，poppler 探测式 |
| `skill-creator` | worker B | OpenAI 版改编（核实 Apache-2.0），剥离宿主专属机制 + Anthropic 评测方法论作进阶章节 |
| `multi-ai-review` | 主 agent | 自研：初稿 → 评审视角拆分 → 多平台分发 → 意见归类（采纳/驳回/存疑）→ 修订版与纪要；分批落盘约定 |
| `workbench-assets` | 主 agent | 自研：知识资产（笔记/frontmatter/导图/历史检索）+ 提示词资产（模板库格式/实例化/修订）共用工作台目录约定 |

**流水线**：worker 在 `scratch/skill-workshop/skills/` staging 产出 → 主 agent 逐个验收（规范合规、description 质量、license 文件齐全、脚本实测证据、与宿主契约一致性）→ 不合格打回返修 → 验收通过后落到 `build/skills/`、统一替换 ensure-python 调用约定、补齐 `package.json` 与 ORIGIN 记录 → 独立 worker 做终验（对照调研文档逐条核对 + 真实运行抽查）。

**许可证纪律**：anthropics Apache-2.0、MiniMax MIT 的 LICENSE 文件随各 skill 目录分发；OpenAI 仅 `.system/skill-creator`（Apache-2.0）可用，**documents/spreadsheets/presentations/pdf 四件套任何文本不得进包**（worker 简报已明示）；上游 commit 记录进各 skill 的 ORIGIN.md。

## 八、description 与触发回归基线

调研文档阶段 2 要求先建立触发回归任务集：构造 10 个该触发 + 10 个不该触发的真实任务，实测中文/英文/双语 description 的触发准确度。落地安排：

- 默认采用**中文为主 + 英文关键词**的双语 description（产品用户为中文用户，英文关键词保留生态互操作性），回归实测若显著劣于纯中文再调整。
- 任务集固化为 `docs/agent/skill-trigger-regression-set.md`，覆盖每个随包 skill 的正负触发例，验收在 dev 实机进行（Agent 实际对话观察触发行为），结果记录进验收报告。此基线同时服务后续 skill 增删的回归。

## 九、实施顺序与验收标准

按依赖关系分四步，每步有明确验收：

**S1 分发链路与环境注入**：第四节全部改造 + 第五节环境注入。
验收：dev 模式下（cwd 置于非仓库目录的工作区）新开会话 `listSkills` 返回 `multichat-cli` 及全部 staging 完成后的 skill；把同名 skill 放入 `agentDir/skills` 后触发的是用户版本；**fork 出的分支会话同样持有全部随包 skill**（评审指出的第四构造点回归项）；Agent shell 里 `node --version`、`echo $env:MULTICHAT_AGENT_DIR` 可用。前置：dev 前须跑过一次 `node scripts/prepare-runtime.mjs`。

**S2 运行时供给**（与 S1 同批）：`prepare-runtime.mjs` + `ensure-python.mjs` + 打包配置。
验收：干净 Windows 环境（无系统 Node/Python，或用 PATH 隔离的子 shell 模拟）→ spawnHook 注入后 `node -e` 可用且含 `&`/空格/引号的参数无损到达 argv；触发"创建中文 pptx"任务跑通 npm 依赖链路；触发"读取 xlsx"任务自动完成 python bootstrap 且二次触发不重复安装；**两个并行会话同时首触 python 链路时锁生效、环境不损坏**；商店 stub 环境下探测不弹 Microsoft Store 窗口；NSIS 打包体积增量实测记录（预期仅 npm 依赖约 7-8MB 压缩）。

**S3 skill 内容集成**（worker 产出验收后）：落 `build/skills/` + 自研两 skill 编写。
集成硬指标：staging skill 全文检索 `npm`/`npx` 运行时指引命中清零（依赖一律命中随包 node_modules）；`ensure-python.mjs` 统一替换为共享调用约定（含锁与 venv 逻辑）；pptx 图标链改写为探测式降级。

验收（对照调研文档第八节，每格式三个真实任务）：xlsx=存量表加列加公式/从零建财务模型/读取分析现有表格；docx=从零写中文公文/填表单模板/改稿留红线；pptx=从零中文演示/模板替换文本/视觉验证回路；pdf=表单填写/合并拆分/渲染验收。**产出文件必须打开人眼检查排版**，不能只看生成成功；验收机预装 LibreOffice + poppler，否则视觉验证被静默降级、验收失真。`multi-ai-review` 用一次真实多平台评审流程验收扇出-回收-修订链路；`workbench-assets` 用真实笔记/模板沉淀任务验收；`skill-creator` 用"把一个真实工作流固化成 skill 并成功触发"验收。

**S4 触发回归与终验**：独立 worker 对照调研文档与本方案逐条核对实现，用第八节任务集实跑触发回归，输出验收报告；问题返修闭环后才能宣告完成。

**全局纪律**：skill 修改后必须重新打包或至少重启 dev 实测（main 进程改动不热重载）；`pnpm run lint` + 定向 tsc（node/web 两侧）+ `pnpm run build` 全绿；自始至终不提交与本任务无关的脏工作区文件。

## 十、风险与对策

- **体积增量集中在 npm 依赖**：复用 Electron 本体后不再嵌入 node.exe，安装包增量只有 npm 依赖（实测压缩后约 7.4MB）与 skill 资产本身；`prepare-runtime` 输出实测报告。
- **spawnHook/shim 兼容性**：spawnHook 主链路依赖 pi 内核 hook 语义（`spawnContext` 流经自定义 ops 已经评审代码核验），集成后须用真实会话验证函数注入生效；`.cmd` 兜底 shim 的 `%*` 对含 `&` 等元字符的参数有已知破坏（评审实测），skill 写作纪律规避嵌套 shell 复杂参数场景；`%~dp0` 相对路径推算已对照真实安装布局核验；MultiChat.exe 被重命名安装的极端情况不考虑（electron-builder 不支持）。
- **首次 bootstrap 失败**：网络受限时 python 链路会失败——skill 内写清降级路径与手动安装链接，重试不超 2 次；embeddable python 的 `import site` 取消注释是必须覆盖的坑。
- **触发准确度稀释**：8 个默认 skill 已是收敛后的数量；description 全部写清触发与排除边界；S4 回归基线持续看护。
- **同名冲突**：优先级语义内核原生保证，设置页一句话明示；验收包含覆盖测试。
- **Beta 上游漂移**：上游固定 commit 且 ORIGIN.md 记录版本，升级作为独立任务评估。
- **合规**：OpenAI 四件套限制性许可为红线，worker 验收时逐目录核查来源文件不含其文本。
- **dev 验收失真**：cwd 在仓库内时 project scope 抢先，"用户目录优先"验收必须在非仓库工作区进行；验收清单中显式标注。

## 十一、后续衔接（本期不做）

- MCP 集成（调研文档阶段 4）：会话创建接 `mcp.json` + 设置页管理 UI + 暴露档位策略；届时 npx 供给需单独评估（shim 模式不提供 npm/npx，可选方案是届时再嵌入 npm 树或 lazy 下载）。
- `multi-ai-research`：用户明确本期不做，编排战法依赖的分批落盘约定已在 `multi-ai-review` 中先行验证。
- 可选 skill 包/市场（阶段 5）。
- 随包 skill 的逐个启停开关（`skillsOverride` 钩子已确认可行，需求驱动再做）。

## 实施结果速记（2026-11-27 验收通过后补记）

S1/S2/S3 实施完成并经独立验收 worker 终审通过（一轮返修闭环：设置页补充覆盖优先级说明、embeddable python 下载补 sha256 校验）。关键实测证据：

- **打包版端到端**：真实构建 NSIS 后直接运行 win-unpacked 产物（隔离 profile + CDP），干净环境下 `bundledSkillDir` 解析为 `<install>/resources/skill`、8 个 skill 自动挂载、会话创建正常；用打包 exe 本体走 spawnHook 函数注入，`node script.cjs "a&b.txt" "x y"` 参数无损到达（Node v24.17.0）。
- **python 三级回退全量实测**：system-venv 转化、managed 幂等复用、PATH 隔离下 embeddable bootstrap（含 sha256 校验、`_pth` 修正、get-pip、pip 装包）全链路通过；负向篡改 hash 后正确 fail-closed。
- **体积**：skill 全量未压缩 18.4MB（裁剪后），实测 solid-deflate 约 4.2MB 净增量，远低于 40MB 预算红线。
- **附带修复**：`systemPromptTrim.ts` 模板字符串未转义反引号导致 `MIAO_PREAMBLE` 运行时求值为 `NaN` 的生产缺陷（esbuild 静默通过、只有 tsc 暴露）。

**后续修订（2026-11-27 用户反馈）**：skill 仓库内源目录从 `.agents/skills` 迁至 `build/skills`（避免 agent 生态自动扫描污染开发上下文，详见第四节末尾修订说明），`bundledSkills.ts`/`cliIntegration.ts`/extraResources/prepare-runtime 全部同步；NSIS 重打验证 8 skill 落位正确。workbench-assets 移除"提示词模板库"章节（该功能在产品中不存在，属虚构功能引用——教训：skill 写作必须逐功能对照代码核实，不可按常识推断宿主能力）。

**第二次修订（2026-11-27 用户两条反馈后）**：
1. **multichat-cli 与侧边 Agent 分离**：该 skill 定位是外部 agent 驾驶本产品 CLI 的文档，不挂载给侧边 Agent（避免与内部 web_search/评审工具的能力重叠）。内核扫描是递归的，唯一可靠隔离是目录分层——仓库与打包布局同构为 `build/skills/internal/`（侧边 Agent 扫描根，7+1 个内部 skill）+ 根部 `multichat-cli`（外部专属，保持 `resources/skill/multichat-cli` 安装路径不变、cliIntegration 零改动）。multi-ai-review 的扇出战法仍走 CLI 命令但不再依赖该 skill 文档，已内联自洽的 CLI 使用契约；`multichat` 命令入口经 spawnHook 注入函数（dev/打包统一 ELECTRON_RUN_AS_NODE + CLI bundle），实测 daemon status 连通。
2. **新增 html-report 为第 8 个内部 skill**（用户提供的 max-doo/html-report 快照）：剔除 README/.gitignore/.git，四脚本补 UTF-8 stdout 重配（scaffold.py 补 import sys），SKILL.md 接入 ensure-python 契约（纯标准库无需 packages）；scaffold→validate→build_report 端到端实测通过。**许可风险：上游无 LICENSE 文件**，ORIGIN.md 已如实标注，分发前需用户确认权属。

未竟项（归属后续专项，本期验收不阻断）：S3 内容级人眼验收（每格式 3 个真实任务 + 打开产出物检查排版，需预装 LibreOffice/poppler 的验收机）；触发回归任务集（`docs/agent/skill-trigger-regression-set.md`）的实跑——执行会消耗 Agent 供应商额度，需用户授权后进行；soffice 真实渲染链路未验证（开发机无 LibreOffice）。
