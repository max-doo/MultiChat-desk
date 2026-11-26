# 本地 Agent（Pi）生态调研：规则加载 / Skills / Shell 工具

> Created: 2026-11-23 23:12 (Asia/Shanghai, UTC+08:00)

调研对象：`@mariozechner/pi-coding-agent`（Pi，badlogic 出品的极简终端编码 agent，TypeScript，模块化为 `pi-ai` / `pi-agent-core` / `pi-tui` / `pi-coding-agent` 四个包）及其生态约定。目标是回答三个问题：AGENTS.md 如何自动加载、skills 如何发现、Electron 主进程里怎么给 agent 提供 shell 工具。结论均可直接落地，文末附本项目建议。

---

## 一、AGENTS.md 自动加载

### 业界现状：已收敛到 AGENTS.md 这个标准

`AGENTS.md` 已从"各家自定义"收敛为跨工具事实标准。agents.md 规范站明确将其定位为"README for agents"，当前被 60k+ 开源项目采用，支持方包括 OpenAI Codex、Cursor 工厂、Jules、Factory、Amp、Devin、Copilot coding agent、Gemini CLI 等。规范本身刻意保持简单：就是放在仓库根目录的 Markdown 文件，agent 启动时读取并注入 system prompt；可选配 `AGENTS.override.md` 做覆盖。

各家发现与加载顺序对比：

| 工具 | 识别文件名 | 全局层 | 项目层加载策略 |
|---|---|---|---|
| Codex | `AGENTS.md` | `~/.codex/AGENTS.md` | 从 cwd 向上递归到仓库根，沿途每层 AGENTS.md 都注入；进入子目录时该目录自己的 AGENTS.md 优先级更高 |
| Claude Code | `CLAUDE.md`（含 `CLAUDE.local.md`） | `~/.claude/CLAUDE.md` | 启动时从 cwd 向上递归收集所有祖先目录的 CLAUDE.md 一次性注入；子目录 CLAUDE.md 按需懒加载（读到该目录文件时才拉入）；子目录覆盖父级、项目覆盖全局 |
| Cursor | `.cursor/rules` 目录 + `AGENTS.md` | 用户级 Memories | `.cursor/rules` 下每个 `.mdc` 文件带 frontmatter（description/globs/alwaysApply），按四种模式加载：Always / Auto-Attached（按 glob 命中）/ Agent-Requested / Manual |
| Aider | `CONVENTIONS.md` / `AGENTS.md` 等约定文件名 | `--read` 指定 | 主要靠显式 `--read` / `.aider.conf.yml` 声明；对 `AGENTS.md` 自动识别，多文件可叠加 |
| Cline | `.clinerules`（文件或目录） | `~/Documents/Cline/Rules` | `.clinerules` 可为单文件或目录（目录下多文件合并）；与全局目录叠加 |
| Continue | `AGENTS.md` + `.continue/rules` | `~/.continue` | hub 上 rules 是独立包，支持 frontmatter globs/alwaysApply 按需注入；本地 AGENTS.md 自动读 |

共同模式归纳（Pi 应照搬的最小集）：

1. 文件名优先级：`AGENTS.md` > `CLAUDE.md`（fallback），不要再发明新文件名。
2. 向上递归：从 cwd 一路向父目录找，直到 git 仓库根；每层命中的文件都参与，深层覆盖浅层。
3. 全局 + 项目两级：全局习惯 → 仓库根约定 → 子目录局部覆盖，冲突时后者赢。
4. 多文件拼接而非只取第一个：按"全局→根→子目录"顺序拼成一段注入并标注来源路径；Cursor/Continue 的 glob 按需注入是加分项不是必需。

### Pi 的内置机制：已经有，不用自己造

Pi 已经把上述规范实现，核心是 `DefaultResourceLoader`（`pi-coding-agent` 包内）。无扩展时它等价于不带参数直接跑 `pi`：

- AGENTS.md：从 cwd 向上递归（到 git root 为止）收集所有 `AGENTS.md`；一个都找不到时回退识别 `CLAUDE.md`（可用 `agentsFilesOverride` 替换整套解析）。多文件按层级拼接注入 system prompt。
- 全局层：`~/.pi/agent/` 下的 AGENTS.md / skills / prompt templates / themes 作为全局级，与项目层叠加。
- 追加 system prompt：`--append-system-prompt` 选项把 `~/.pi/agent/APPEND_SYSTEM_PROMPT.md` 和 `<cwd>/.pi/APPEND_SYSTEM_PROMPT.md` 拼到系统提示末尾（也可由 skill 或 extension 动态补充）。
- @file 注入：消息里写 `@path/to/file` 会把文件内容就地内联（prompt 模板机制），是临时补充上下文的手动通道。

### 落地建议（规则文件）

- 直接用 `DefaultResourceLoader` 默认行为即满足"自动识别 + 全局/项目/子目录分层"，不要自己再写一套向上递归扫描。
- 确认两个边界：① 向上递归终止于 git root（`git rev-parse --show-toplevel`），用户在不带 `.git` 的散目录里工作时只命中 cwd 一层——对"agent 工作在任意项目目录"是合理行为；② 保留 CLAUDE.md fallback 以便 Claude Code 用户无缝迁移。
- 风险：多层 AGENTS.md 拼接显著膨胀 system prompt。建议 UI 暴露"本项目注入了哪几个规则文件"（loader 有 `getAgentsFiles()` 返回列表），既透明又方便裁剪；Windows 下路径大小写/符号链接可能导致同一文件被算成两层，去重时按 `fs.realpath` 归一。

## 二、Skills 的发现与加载

### SKILL.md 已是事实标准，但字段分两派

`SKILL.md`（文件夹 + YAML frontmatter + Markdown body）已被 Anthropic（Claude Code / Agent Skills）和 OpenAI（Codex skills）共同采用，agentskills.io / agentskills.to / skills.sh 等社区站都推同一结构。渐进式披露三段式是共识：`name`+`description` 常驻用于路由 → body 命中时加载 → `references/`/`scripts/`/`assets/` 按需读取。

但 frontmatter 字段尚未完全收敛，分两派：

- Anthropic 派（agentskills/agentskills 规范 + anthropics/skills 仓库）：必填 `name`+`description`；可选字段最全——`license`、`compatibility`、`metadata`、`allowed-tools`（空格分隔工具白名单，Claude Code 实测支持）、`disable-model-invocation`、`user-invocable`、`context`、`agent`、`model`、`hooks`。
- OpenAI 派（openai/skills 仓库）：同样只强制 `name`+`description`；可选收敛为 `license`/`compatibility`/`allowed-tools`/`metadata`，外加 `agents/openai.yaml` 承载 UI 元数据（display name、分类、默认启用）和调用策略，把产品侧展示配置从 SKILL.md 正文剥离。

`allowed-tools` 两家语义一致（允许该 skill 调用的工具名列表），但是否强制由宿主决定，不是沙箱。

### 路径约定：项目级在收敛，全局级仍各家分裂

- 项目级：`.agents/skills/<name>/SKILL.md` 正在收敛成跨工具目录（Pi、agentskills.to 都认）；Claude Code 历史路径 `.claude/skills/` 仍大量存在；Codex 也读 `.agents/skills`。扫 `.agents/skills` + `.claude/skills` 两个目录可覆盖绝大多数存量项目。
- 全局级没有统一：`~/.claude/skills`、`~/.codex/skills`、`~/.pi/agent/skills`、Continue 的 `~/.continue`、Cline 全局 rules 目录各不相同。

### Pi 的机制

Pi 内置 skill 发现（同样由 DefaultResourceLoader 负责），约定与上面一致：

- 项目级 `.agents/skills`（从 cwd 向上递归每层都扫）+ 全局 `~/.pi/agent/skills`。
- 每个 skill 是一个目录，入口 `SKILL.md`；loader 把 `name`+`description` 汇总给模型做路由，命中后按需读 body 和资源文件。
- `~/.pi/agent/` 同时是全局配置根（settings、prompt templates、themes、skills），相当于 Pi 的 `~/.claude`。
- 覆盖点齐全：`skillsOverride`、`promptTemplatesOverride`、`themeOverride`、`agentsFilesOverride` 等，每个维度都能换实现，适合做 UI 侧定制（比如加一层应用内置 skill 包）。

### 落地建议（skills）

- 扫描逻辑直接用 loader 的 `.agents/skills` + `~/.pi/agent/skills`；为兼容 Claude Code 存量项目，额外把 `.claude/skills` 加入扫描源（低成本高收益，可经扩展 loader 的 skill 来源实现）。
- frontmatter 解析只需保证 `name`/`description` 必填、把 `allowed-tools`/`disable-model-invocation`/`user-invocable` 透传出来——`allowed-tools` 对接权限模式是天然钩子；其余字段原样保留不要丢，避免用户复制的现成 skill 失效。
- 本项目已有先例：`.agents/skills/multichat-cli/` 就是按此结构组织（SKILL.md + scripts/），electron-builder 已配 `extraResources` 打包——"应用自带 skill"链路已走通，新 agent 直接复用同一目录约定。
- 风险：不同工具对同一 skill 目录可能放互斥辅助文件（openai.yaml vs Claude hooks），按目录粒度隔离、不做跨目录同名合并；同名按"项目级 > 全局级"取一个，与 AGENTS.md 深层覆盖浅层一致。

## 三、Electron main 里执行 shell 命令

### 核心结论：别用 node-pty，`child_process.spawn` + cmd/PowerShell 即可

给 agent 的 shell 工具本质是"跑一条命令、拿回 stdout/stderr/exit code"，不需要真终端。node-pty 的价值是交互式 TTY（vim、提示符、ANSI 光标控制），而 agent 的命令是一次性非交互调用——Pi 自己的 bash 工具就是 spawn 模型：提供 `bash`（`bash -c` / Windows 下走 PowerShell）和 `tmux` 两个后端，tmux 只为持久会话管理异步长任务，不是 pty 刚需。node-pty 在 Electron 里要按 ABI 用 electron-rebuild 重编 native 模块、分发还要带 prebuild，纯属自找成本。

推荐分层（按最小充分排）：

1. 首选 `child_process.spawn`：`{ shell: false, windowsVerbatimArguments: true }`，直接拉起 `powershell.exe -NoProfile -NonInteractive -Command <cmd>` 或 `cmd.exe /d /s /c <cmd>`。非交互、无 profile 副作用、stdout/stderr 分流、可设 cwd/env/timeout。零依赖，Electron 主进程原生支持。
2. 需要流式输出/超时/取消更省心时上 `execa`：拿到 AbortSignal、超时 kill、maxBuffer、逐行流式回调，比裸 spawn 少写胶水。Windows 下注意 `.cmd`/`.bat` 处理，配 `shell: true` 或显式指定解释器。
3. 必须交互式 REPL/SSH/TUI 时才考虑 node-pty，本期不需要。
4. Windows 坑：spawn 不能直接执行 `.cmd`/`.bat`/`.ps1`（ENOENT 或 CreateProcess 拒绝），要么 `shell: true` 要么显式 `cmd.exe /c`；PowerShell 脚本还要 `-ExecutionPolicy Bypass`。Node 20.12+/22 已修 libuv 的 CVE-2024-27980 bat 注入，保持 Node 版本新即可。

### 高危命令检测：没有现成判定库，有现成解析器

业界没人发布过"危险命令黑名单库"（这类列表永远不完整），成熟做法是两段式：

1. 用解析器拿结构化命令，不要 regex 裸扫字符串：
   - `shell-quote`（substack）：把 shell 串解析成 op 序列，能识别 `;` `&&` `|` `>` `>>` 重定向、命令替换，是检测"链式命令里藏 rm -rf / Format-Volume"的基础。
   - `bash-parser` / mvdan-sh 的 JS 绑定：真 AST，能区分"删除语句"和"恰好含 rm 字样的 echo"。
   - PowerShell 侧 npm 上没等价成熟 AST 解析器，但可用 `powershell -Command "[System.Management.Automation.PSParser]::Tokenize(...)"` 借 Windows 自带解析器做一层（成本是一次额外进程调用）。
2. 解析结果上跑策略表：命中危险动词（rm/del/Remove-Item、mkfs、Format-Volume、dd、reg delete、写 System32/$env:WINDIR、管道进 iex/Invoke-Expression、curl|sh 远程执行模式）→ 进需确认队列；命中只读动词（Get-*、ls、git status）→ 只读模式也放行。Pi 生态这类策略都是宿主自己维护，没有可抄的公共表——参考 Codex 的 sandbox_permissions + prefix_rule 思路：按解析出的命令头做前缀白名单，而不是关键字黑名单。

### 权限模式映射

| 模式 | 实现 |
|---|---|
| 完全访问 | spawn 直接跑，仅记录审计日志 |
| 受限模式 | 解析器先过一遍；白名单（只读/构建/测试命令）自动跑，灰名单弹确认 UI，黑名单（写系统目录、rm -rf 根、远程执行）直接拒绝 |
| 只读 | 只允许解析结果为无副作用的命令（文件读取、Get-*、git status/log/diff、npm ls）；任何带 `>`/`>>`/Set-Content/Remove-* 的直接拒 |

### 落地建议（shell）

- 包选型：`child_process.spawn` 起步；要流式/取消上加 `execa`；命令解析加 `shell-quote`。Pi 的 bash 工具可保留 tmux 后端做长任务，但 Windows 下 tmux 不可用，需退化到 spawn——这点要在适配层处理。
- 架构：命令执行放主进程（有 Node 能力），通过 IPC 暴露给渲染层确认 UI，别在 webview 里跑。
- 风险：① PowerShell/CMD 解析差异大，同一语义两种写法，策略表要覆盖双套动词；② 解析器只管单条命令，命令里嵌脚本文件（./deploy.ps1）时检测不到脚本内部动作，受限模式下应对"执行脚本文件"整体升一级确认；③ 审计日志务必落盘（命令原文、cwd、exit code、时间戳），出问题是唯一回溯依据。

---

## 综合落地路线（本项目）

1. 规则文件：直接用 `DefaultResourceLoader` 默认 AGENTS.md 向上递归 + `~/.pi/agent` 全局层；UI 暴露注入文件清单；保留 CLAUDE.md fallback。
2. Skills：默认 `.agents/skills`（含向上递归）+ `~/.pi/agent/skills`，扩展 loader 增加 `.claude/skills` 兼容源；frontmatter 全字段透传、`allowed-tools` 接权限层；复用已验证的 `extraResources` 打包链路发内置 skill。
3. Shell：主进程 `spawn`/`execa` 起步，`shell-quote` 做解析，自建三段式策略表（白/灰/黑）接权限模式；交互式需求出现前不碰 node-pty。
4. 任意目录工作：以上三层全部以用户指定的 cwd 为锚点，不绑定 MultiChat-desk 自身路径——loader 和 spawn 都吃 cwd 参数，天然满足。

## 参考来源

- Pi 官方文档 SDK 章节（DefaultResourceLoader / 资源加载）：https://pi.dev/docs/sdk
- Pi README（pi-coding-agent，含 tmux/bash 后端、--append-system-prompt）：https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/README.md
- Pi monorepo：https://github.com/badlogic/pi-mono
- agents.md 规范站：https://agents.md/
- anthropics/skills（SKILL.md + frontmatter 规范）：https://github.com/anthropics/skills
- openai/skills（含 agents/openai.yaml 约定）：https://github.com/openai/skills
- agentskills.to 目录站（路径约定实测）：https://agentskills.to/
- Claude Code memory 文档（CLAUDE.md 递归/懒加载语义）：https://code.claude.com/docs/en/memory
- Cursor rules 文档（.mdc 四种加载模式）：https://cursor.com/docs/context/rules
- Cline rules 文档（.clinerules + 全局目录）：https://docs.cline.bot/features/cline-rules
- execa：https://github.com/sindresorhus/execa；shell-quote：https://github.com/substack/node-shell-quote
- 本机实测：`C:\Users\DMX\.codex\skills\.system\skill-creator\SKILL.md`（OpenAI skill 结构）、`D:\Project\MultiChat-desk\.agents\skills\multichat-cli\`（本项目已有 skill 组织方式）
