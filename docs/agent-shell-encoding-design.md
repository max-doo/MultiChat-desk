> Created: 2026-11-24 09:45 (UTC+8)

# Agent Shell 执行与编码方案设计

## 背景

Workbench 的 Agent 能力基于 `@earendil-works/pi-coding-agent@1.6.0`（Electron 主进程内嵌）。当前需要解决三块问题：**权限模式、UTF-8 编码、跨设备 shell 工具挂载**。本文档先调研本组织内两个已调好的 Agent 项目（`D:\Project\WebAI-to-API\agent` 和 `D:\Project\mu-agent`），再结合业界主流 coding agent（Claude Code、opencode、Pi 本体）的做法与在本机 Windows 环境的实测数据，给出最简约、稳健的设计。

## 一、现状盘点

### 1.1 sidebar 现有代码

| 文件 | 状态 |
|---|---|
| `src/main/services/ShellTool.ts` | 手写 `spawn('powershell.exe', ['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-Command', cmd])`，Unix 走 `/bin/sh -c`；输出 `data.toString('utf-8')` 解码。**当前没有任何调用方**，是预留实现。 |
| `src/main/services/PermissionEngine.ts` | 自研三档模式 `full / restricted / readonly` + 硬拒正则 + 安全命令白名单 + allowlist（`shell-quote` 解析命令头）+ IPC 审批卡（`agent:approval-request` → `ApprovalCard.tsx`）。通过 `session.agent.beforeToolCall` 钩子拦截。 |
| `src/main/services/AgentSessionService.ts` | `createAgentSession` **未传 `excludeTools`**，模型侧 `bash` 和 `powershell` 两个工具同时挂载；`beforeToolCall` 已接通 PermissionEngine。 |

### 1.2 本机环境实测（2026-11-24，本仓库 dev 机）

- `getShellConfig()`（pi 内置）→ `C:\Program Files\Git\bin\bash.exe`（Git Bash 存在）
- `getPowerShellConfig()` → `C:\Program Files\PowerShell\7\pwsh.exe`（pwsh 7 存在）
- `C:\Windows\System32\bash.exe` 存在但 **WSL 未真正安装**（执行返回 `wsl: Unknown key ...`，挂起退出码 1）——**PATH 上存在 bash.exe 不等于可用**
- 控制台 `chcp` = 65001，Git Bash `LANG` = `C.UTF-8`

## 二、两个参考项目调研

### 2.1 mu-agent（`D:\Project\mu-agent`，TS，pi `0.85.0`）

三块能力全部存在，工程质量最高，可迁移性最强：

- **权限**：`src/permissions.ts`（~730 行）纯函数策略引擎 `decidePermission`，决策优先级 `hard deny > deny > ask > allow`；`inspectPath` 用 `realpathSync` 做真实路径边界（workspace / allowed-read-root / outside / protected / invalid）；`analyzeCommand` 做高危正则、git 危险子命令、PowerShell 只读 cmdlet 白名单（含管道分析）；规则文件原子写回，项目级规则只能收紧不能 allow。`src/modes.ts` 定义 `MODE_IDS = ['default','auto','bypass']`（`acceptEdits`/`build`→`auto` 别名）。接线走 `pi.on('tool_call')` → ask 时 `ctx.ui.select` 弹审批。
- **shell 挂载**：`src/shell.ts`（~20 行）`shellToolForPlatform()` → win32 返回 `'powershell'`、否则 `'bash'`；`createAgentSession({ excludeTools: [platform==='win32' ? 'bash':'powershell'] })`；`shellEnvironmentPrompt()` 生成 `<mu-environment>` 提示词块（OS / cwd / 路径风格 / 实际可执行文件路径）注入 systemPrompt。
- **UTF-8**：主要依靠 pi SDK 内置 `UTF8_OUTPUT_PREFIX`（见下），自己只补 `PYTHONIOENCODING=utf-8` 和 `setEncoding('utf8')`。

### 2.2 WebAI-to-API agent（`D:\Project\WebAI-to-API\agent`，TS，pi-agent-core `1.5.2`）

- **权限**：**不存在**，设计上"全 auto"，只有 `resolveInCwd` 工作区前缀围栏（`tools.ts:98`）。无 auto 模式可迁移。
- **UTF-8**：`src/encoding.ts`（~19KB，自包含，仅依赖 `iconv-lite`），业界级方案：
  - `decodeCommandOutput`：NUL→UTF-16LE → 严格 UTF-8 → **按行**回退系统 ANSI 代码页（GBK 936 / Big5 950 / Shift_JIS 932…，从注册表 `HKLM\...\Nls\CodePage` 读 ACP/OEMCP，`chcp` 兜底）；
  - `readTextFile` / `encodeFileText`：BOM→UTF-8→ANSI 回退，**写回永远保留原编码/BOM/EOL**，`UnrepresentableCharError` 往返校验防 `?` 替换损坏；
  - 这套直接解决了 Claude Code #7134、opencode #30187 的同类 bug。
- **shell**：极简——Win 固定 `cmd.exe /d /s /c "…"` + `windowsVerbatimArguments`（保住内层引号），POSIX `sh -c`；输出 `encoding:'buffer'` → `decodeCommandOutput`。

## 三、pi SDK 1.6.0 自带能力（`node_modules` 实测）

| API | 行为 |
|---|---|
| `getShellConfig(customShellPath?)` | Win：Git Bash 已知路径 → PATH `bash.exe`（**命中 `C:\Windows\System32\bash.exe` 时自动切 stdin 传输 `commandTransport:'stdin'`**，`isLegacyWslBashPath` 识别 WSL launcher）；Unix：`/bin/bash` → PATH bash → `sh` 兜底。找不到抛错。 |
| `getPowerShellConfig()` | Win：PATH `pwsh.exe` → `ProgramFiles\PowerShell\7\pwsh.exe` → `powershell.exe` → `SystemRoot\...\powershell.exe`；固定 `POWERSHELL_ARGS = -NoProfile -NonInteractive -ExecutionPolicy Bypass -Command`。非 Win 抛错。 |
| powershell 工具 | 每条命令前缀 `UTF8_OUTPUT_PREFIX = "try { [Console]::OutputEncoding=[System.Text.Encoding]::UTF8 } catch {}\n"`（`tools/powershell.js:5`）。 |
| `excludeTools` | `CreateAgentSessionOptions.excludeTools?: string[]`（`sdk.d.ts:54`），已在 1.6.0 确认存在。 |
| `BashOperations` | 可自定义 `exec`（`tools/bash.d.ts:35`），`createLocalShellOperations(shellName, resolveShellConfig)` 复用 pi 的进程管理（killProcessTree / detached pid 追踪 / sanitizeBinaryOutput）。 |

## 四、Windows UTF-8 实测数据

通过 `spawn`（`windowsHide:true`）逐条实测，输出 Buffer `toString('utf-8')`：

| 用例 | 结果 |
|---|---|
| Git Bash → `cmd.exe //c "echo 中文测试"` | `d6d0 cec4 b2e2 cad4`（**GBK**，UTF-8 解码乱码） |
| Git Bash → `echo "你好世界"`（bash 内建） | UTF-8 正常（Git Bash 进程本身 UTF-8） |
| Git Bash → `git status` / `git log` | UTF-8 正常（git 自身输出 UTF-8） |
| Git Bash → `ipconfig` | **GBK 乱码**；`ipconfig \| iconv -f GBK -t UTF-8` 正常 |
| Git Bash → `cmd /c "chcp 65001 & echo 中文"` | **仍 GBK**——`chcp` 只影响该 cmd 进程自身的控制台代码页查询，cmd `echo` 仍按 OEM 代码页输出字节；**注入 chcp 救不了单次 `cmd /c`** |
| Git Bash → 两次独立 `cmd /c`（先 chcp 再 echo） | UTF-8 正常——因为 Electron 父进程控制台 `chcp`=65001，新 cmd 继承的是**进程代码页**而非前一条命令的设置 |
| pwsh 无前缀 → `cmd /c echo 中文` / `Write-Output 中文` | GBK 乱码 |
| pwsh / powershell.exe 加 `UTF8_OUTPUT_PREFIX` → `cmd /c echo 中文` / `Write-Output 中文` | **UTF-8 正常**——`[Console]::OutputEncoding=UTF8` 改变的是 .NET 控制台的输出编码，cmd 子进程继承控制台后 echo 也输出 UTF-8 |

**结论**：

1. PowerShell 前缀是**根治方案**：一行代码把整条命令链（包括嵌套的 `cmd`/`Write-Output`/多数原生 exe）的输出统一为 UTF-8。
2. Git Bash 解决不了原生命令的 GBK 输出——`chcp` 注入对单次 `cmd /c` 无效，唯一可靠路径是 `iconv -f GBK -t UTF-8` 管道或宿主侧 ANSI 回退解码（WebAI `encoding.ts`）。
3. **"UTF-8 解决后 Windows 就能用 bash"不成立**：bash 工具的原生命令输出仍需 GBK 兜底解码；而且模型写出的 `ls/grep/sed` 命令在 Git Bash 下语义与 PowerShell 完全不同（`Get-ChildItem` vs `ls`），工具选择影响的是**模型生成哪种命令**，不只是编码。

## 五、业界做法对照

| Agent | Windows shell 策略 | 编码策略 |
|---|---|---|
| Pi 本体 | 平台二选一挂载 `powershell`/`bash` 工具（mu 照抄），SDK 内置探测 | powershell 工具内置 UTF8 前缀；bash 工具输出 buffer 不做转码（`sanitizeBinaryOutput` 只清控制字符） |
| Claude Code (#7134 等) | Windows 走 Git Bash 踩坑多年，后转向 PowerShell/原生 | 社区反复报 GBK/CP932 乱码，无统一注入方案 |
| opencode (#30187) | 同样踩 Windows 编码坑 | 与上同类 |
| mu-agent | 平台二选一 + 环境提示词 | SDK 前缀 + `PYTHONIOENCODING` |
| WebAI agent | 固定 `cmd /d /s /c` | `encoding.ts` ANSI 回退解码（最彻底） |

收敛模式：**工具按平台单挂**（避免模型在错误 shell 里生成命令）+ **执行层注入 UTF-8 前缀**（PowerShell）+ **宿主侧 ANSI 回退解码兜底**（覆盖 bash/原生 exe 的 GBK 输出）。

## 六、设计方案（最简约、稳健）

原则：能靠 SDK 就不自己写，能注入就不解析，兜底解码只加一处。

### 6.1 Shell 工具挂载：平台二选一 + 环境提示词

迁移 mu-agent `shell.ts` 的两个函数，在 `AgentSessionService` 两处 `createAgentSession` 调用上加：

```ts
const shellTool = process.platform === 'win32' ? 'powershell' : 'bash'
const { session } = await createAgentSession({
  cwd, agentDir, modelRuntime, model: modelObj, sessionManager,
  resourceLoader: resourceLoader.getRawLoader(),
  excludeTools: [shellTool === 'powershell' ? 'bash' : 'powershell'],
})
```

同时把 `shellEnvironmentPrompt(cwd, shellExe)` 的输出拼进 systemPrompt（pi 支持 `appendSystemPrompt` 或 resourceLoader 注入），内容只含：OS、cwd、路径风格、shell 可执行文件解析后的真实路径。**目的不是教模型用 shell，而是让它知道"该生成 PowerShell 还是 bash 语法的命令"**——这是业界验证过的防错手段（模型在 Windows 挂 `bash` 工具时会生成 `ls`/`grep` 命令打不通原生命令）。

`ShellTool.ts` 保留为独立 spawn 通道（CLI / 审批预检 / 非会话命令用），但平台分支改为复用 `getPowerShellConfig()`/`getShellConfig()` 的探测结果，不再硬编码 `powershell.exe`。

### 6.2 UTF-8：两层处理，一次到位

**第一层（模型工具路径，SDK 自带）**：pi 的 `powershell` 工具已注入 `UTF8_OUTPUT_PREFIX`，模型调 `powershell` 工具天然不乱码——无需改动。

**第二层（自研 `ShellTool.execute` + bash 兜底）**：

- Windows PowerShell 分支：在 `-Command` 前拼 `UTF8_OUTPUT_PREFIX`（复制那一行常量，或直接从 pi 源码拿字符串），覆盖 `ShellTool` 自己的 spawn 通道。
- 解码兜底：所有 spawn 输出**不要直接 `toString('utf-8')`**。迁移 WebAI `agent/src/encoding.ts` 的 `decodeCommandOutput` 作为唯一解码入口（整文件复制 + `iconv-lite` 依赖）：先严格 UTF-8 → 失败按行回退 ANSI 代码页。这一处兜底同时覆盖 Git Bash 下原生命令 GBK、未来 macOS/Linux 的非 UTF-8 遗留输出，**一行接入换掉所有裸 `toString('utf-8')`**。
- `encoding.ts` 的文件 IO 部分（`readTextFile`/`encodeTextFile`/`UnrepresentableCharError`）暂时**不迁移**——sidebar 的 read/write/edit 工具由 pi SDK 提供，等出现真实文件编码 bug 再引入（最小充分原则）。

**不做的**：不向命令注入 `chcp 65001`（实测无效）、不要求用户安装 iconv、不做 pty（非交互 spawn 足够，见 `pi-agent-ecosystem-research.md` 已有结论）。

### 6.3 权限模式：复用 mu 决策引擎，保留现有接线

不推翻现有 `PermissionEngine.ts` 的 `beforeToolCall` + IPC 审批卡链路（已端到端可用），只替换/升级决策内核：

- **模式语义对齐业界三档**：`default`（原 `restricted`：只读安全命令放行、工作区内 write/edit 直放、其余 ask）、`auto`（原 `full`：写操作与一般命令自动放行，仍受 hard deny 和高危拦截）、`bypass`（全放行可确认项，未知/高危仍拒）。**收敛为 `default / auto / bypass` 三档 UI**；`readonly` 不并入——它语义上比 `default` 更严（禁一切写），保留为旧持久化会话的兼容档：只读命令与读工具放行、一切写与高危 deny，避免旧"只读"用户恢复后权限放宽。`full`→`auto`、`restricted`→`default` 别名映射兼容存量配置。
- **决策内核迁移** `mu-agent/src/permissions.ts` 的 `decidePermission` + `inspectPath`（`realpathSync` 路径边界 + 受保护目录硬拒）+ `analyzeCommand`（PowerShell 只读管道识别比现有 `SAFE_COMMAND_HEADS` 集合精细得多，能识别 `Get-Process | Stop-Process` 这类管道危险）。
- **规则持久化**：mu 的 `mu-permissions.json` 原子写回 + "项目级规则只能收紧" 语义迁移到 sidebar 的持久层（electron-store 或数据目录 JSON），替换现有简单 allowlist。
- **ask 交互**：`ctx.ui.select` → 现有 `agent:approval-request` IPC + `ApprovalCard.tsx`（放行 / 拒绝 / 模式匹配放行(always+pattern)），复用 `resolveApproval` 的 `allow/always/deny` 分支。未引入 mu 的 `Allow for session` 会话级规则——属交互层裁剪，后续如需可再扩。

**前置核对项**：mu 用 pi `0.85.0` 的 `pi.on('tool_call')` 事件，sidebar 用 `1.6.0` 的 `session.agent.beforeToolCall` 钩子——决策逻辑可平移，但 `PermissionContext` 字段（`modeId`/`toolName`/`args`/`cwd`/`workspaceRoot`/`interactive`）需对照 1.6.0 的 `beforeToolCall` 入参重建。

### 6.4 设备识别：不做"识别"，做"探测 + 提示词"

业界没有"识别设备类型"的说法，实际是**按平台探测可用 shell + 把结果告诉模型**。设计即 6.1 的两行 `excludeTools` + `getPowerShellConfig()`/`getShellConfig()` 探测结果注入提示词。WSL `bash.exe` 的坑 SDK 已处理（`isLegacyWslBashPath` → stdin 传输），不用自己判。

## 七、实施顺序与验收

按"小改动先见效"排序，每步独立可验：

| 步骤 | 改动 | 验收 |
|---|---|---|
| S1 shell 挂载 | `shell.ts`（新，~30 行）+ `createAgentSession` 两处加 `excludeTools` + systemPrompt 注入 | `pnpm run dev` 起会话，问模型"列出当前目录文件"——Windows 应生成 `Get-ChildItem` 而非 `ls`；`tools` 列表里另一平台工具不可见 |
| S2 UTF-8 | `ShellTool.execute` PS 分支加 `UTF8_OUTPUT_PREFIX`；引入 `encoding.ts` 的 `decodeCommandOutput` 替换 `toString('utf-8')`；`package.json` 加 `iconv-lite` | `ShellTool.execute('cmd /c "echo 中文"')` 与 `execute('Write-Output 中文')` 在 GBK 控制台下返回正常中文；Git Bash 路径 `ipconfig` 经解码兜底不乱码 |
| S3 权限内核 | 复制改造 `permissions.ts`+`modes.ts`，`PermissionContext` 适配 `beforeToolCall` 1.6.0 签名；三档模式收敛 + 别名兼容；规则持久化迁移 | 对着 `mu-agent/tests/permissions.test.ts` 的决策矩阵人工核对 `default/auto/bypass` 行为；`Get-Process \| Stop-Process` 在 auto 下被拦；`git status` 在 default 下直放 |

## 八、风险与边界

- **pi 版本差**：mu(`0.85.0`) → sidebar(`1.6.0`)，`beforeToolCall` 入参/`excludeTools` 语义需以 1.6.0 的 `.d.ts` 为准（`excludeTools` 已确认存在，`sdk.d.ts:54`）。
- **Git Bash 探测的假象**：`where bash` 命中 `System32\bash.exe` 不代表 WSL 可用——SDK 的 stdin 传输兜底了执行，但**提示词里应如实报告解析出的 bash 路径**，让模型自己判断（已纳入 6.1）。
- **`iconv-lite` 是新生产依赖**：仅 S2 引入，体积 ~300KB，无 native 编译，符合"最小充分"；若拒绝引入，S2 可降级为只加 UTF8 前缀 + UTF-8 严格解码（GBK 原生命令仍会乱码，属于可接受的已知缺口）。
- **不引入 pty / tmux**：与 `pi-agent-ecosystem-research.md` 结论一致，非交互 spawn 已够。
- **文件 IO 编码暂不处理**：pi SDK 的 read/write 工具自带处理，WebAI `encoding.ts` 的完整文件编码策略待真实需求再迁。

## 九、参考来源

- mu-agent：`src/permissions.ts`、`src/modes.ts`、`src/shell.ts`、`tests/permissions.test.ts`、`docs/permissions.md`
- WebAI-to-API：`agent/src/encoding.ts`、`agent/src/tools.ts`、`agent/test/file-encoding.ts`、`agent/docs/DESIGN.md`
- pi SDK：`node_modules/@earendil-works/pi-coding-agent/dist/utils/shell.js`、`dist/core/tools/powershell.js`、`dist/core/sdk.d.ts`
- 既有调研：`docs/pi-agent-ecosystem-research.md`（spawn vs pty 结论、安全边界）
