> Created: 2026-11-25 00:11 (+08:00)

# 命令安全判定 AST 化改造方案

## 背景与目标

当前 `beforeToolCall` 权限链路由三层叠加而成：

1. `permissionPolicy.ts` 的正则分析（`analyzeCommand` / `readOnlyPowerShell` / `highRiskPattern`），命中 `$(`、`` ` ``、`|;&`、重定向等一律 `requiresApproval`；
2. `PermissionEngine.isSafeShellCommand` 的结构化第二意见，仅在 `auto` 模式下用 `shell-quote` 逐段核对白名单；
3. `HARD_DENY_PATTERNS` 硬拒绝与用户 allowlist。

这套组合的问题：**判定面是字符串不是语法**。PowerShell 双引号里的 `$(...)` 子表达式（哪怕只是 `$(([regex]::Matches($h,'<table>')).Count)` 这种纯计算）必拦；而 `$(rm -rf /)` 这种真正危险的内容也只看外层正则，对子表达式内部不做递归分析，既不精确也不完备。auto 模式下大量只读命令被升级成审批弹窗，是用户当前最痛的误拦来源。

本次改造按业界最佳实践（Codex `execpolicy` + AST 分析器、Claude Code tree-sitter allowlist 遍历、CARE 分层管线）重构命令判定层：

- **真解析，不正则**：PowerShell 走官方 `System.Management.Automation.Language.Parser` AST；bash 走逐层 shell-quote 分词 + 语法节点白名单。
- **递归下钻**：`$(...)`、`` `...` ``、`bash -c`、`powershell -Command`、`cmd /c`、`xargs`、`find -exec` 等包裹层剥开重新判定内层。
- **fail-closed**：任何解析失败、未知节点、不可判定结构 → 维持 `ask`，绝不放行；deny 规则永远先匹配。
- **三态输出**：`allow` / `ask` / `deny`，不强行二分类。

非目标：本次不做 OS 级沙箱（Job Object/AppContainer/WSL），不引入 LLM 判定，不改审批 UI 与 allowlist 存储格式，不改 `ShellTool` 执行路径。

## 方案总览

```
analyzeCommand(command, shellKind)
  │
  ├─ 长度/空串/硬拒绝快速通道（保留现有 HARD_DENY_PATTERNS 调用）
  │
  ├─ powershell ─→ PowerShellAstAnalyzer（持久 helper 进程，官方 AST）
  │                  → { decision, reason, pathArgs, effects }
  │
  ├─ bash ───────→ BashCommandAnalyzer（纯 TS：递归 shell-quote 分词 + 包裹层下钻）
  │                  → { decision, reason, pathArgs, effects }
  │
  └─ 合并：pathArgs → inspectPath 边界检查 → CommandInspection → 现有 defaultDecision 消费
```

判定结果继续走现有 `decidePermission` / `defaultDecision` 消费路径，AST 分析器只替换"这条命令是什么性质"这一环，不动模式决策表。

## 核心设计

### 1. `CommandKind` 分派

入口先按工具名区分语法域：`powershell` → PS 分析器，`bash` → bash 分析器。两条分析器各自完整实现，不共享语法假设，只共享输出结构（`CommandInspection`）与词表常量。

### 2. PowerShell AST 分析器

主进程内常驻一个 helper 子进程（复用 pi `getPowerShellConfig()` 的探测结果，pwsh 优先、powershell.exe 兜底）。**helper 不落盘为 `.ps1` 文件**——逻辑压成单行 `-Command` 字符串内联 spawn（实测约 1.3KB 可跑，repo 已有 `uiaSelectionHelper.ts` 同款 JSON Lines 先例），零文件依赖、零 `extraResources` 打包改动。Node 侧构造 argv 时 `$` 用 `\u0024` 转义即可。

stdin/stdout JSON Lines 协议：

- 请求：`{ id, command }`；响应：`{ id, status: 'ok'|'parse-error', ast: <ScriptBlockAst JSON> }`。
- helper 用 `[System.Management.Automation.Language.Parser]::ParseInput()` 解析，`Ast.FindAll($ast, $true)` 展平成节点数组输出。AST 节点序列化时只保留类型名 + `Extent.Text` + 关键属性（命令名、参数、重定向目标），避免循环引用。
- **生命周期**：首次使用时 spawn，`dispose()` 或主进程退出时 kill；helper 崩溃/超时（单请求 3s）→ 整个命令 fail-closed 返回 `parseable: false`，不降级回正则判定（降级会产生双判定面，结论漂移）。
- **并发语义**：请求串行入队、队头超时即判 fail 并继续下一条，不并行多开 helper——`beforeToolCall` 可多会话并发触发，串行队列是最简单且足够的语义。
- 输出大小上限：AST JSON > 2MB 或节点数 > 5000 → `parseable: false`（防超长命令拖垮序列化）。

### 3. AST allowlist 遍历（PowerShell 侧）

`readonly` 判定 = **所有节点类型都在 allowlist 内 + 所有命令名都在只读词表内 + 无危险结构**：

- **允许节点类型**：`ScriptBlockAst`、`PipelineAst`、`CommandAst`（仅表达式式调用）、`CommandExpressionAst`、`CommandParameterAst`、`StringConstantExpressionAst`、`ExpandableStringExpressionAst`（内部 `SubExpressionAst` 递归通过才放行——截图案例 `"n: $(...)"` 的宿主节点就是它，漏了会放行 `$()` 却拦宿主字符串）、`VariableExpressionAst`（仅读，且非 `$env:` 写）、`ConstantExpressionAst`、`BinaryExpressionAst`（算术/比较）、`UnaryExpressionAst`、`ArrayExpressionAst`、`ArrayLiteralAst`、`HashtableAst`、`ParenExpressionAst`、`SubExpressionAst`（**递归遍历内容**，不是见到就拦）、`MemberExpressionAst`（属性读）、`InvokeMemberExpressionAst`（**仅白名单类型+方法**）、`ConvertExpressionAst`、`TypeExpressionAst`（仅白名单类型）、`IfStatementAst`/`ForEachStatementAst`/`WhileStatementAst`/`ReturnStatementAst` 等纯控制流、`AssignmentStatementAst`（**仅本地变量**，左值禁止 `Env:`/`global:`/`script:` drive）。
- **禁止节点类型**（任何出现 → `readonly: false`）：`CommandAst` 携带重定向、`InvokeMemberExpressionAst` 未在白名单、`TypeConstraintAst` 指向未知类型、`FunctionDefinitionAst`（第一期直接整体不可判）、`TrapStatementAst`/`ThrowStatementAst`/`BreakStatementAst`/`ContinueStatementAst`（控制副作用，保守拦）、`UsingStatementAst`、`DataStatementAst`、`DynamicKeywordStatementAst`。
- **.NET 静态方法白名单**（解决截图误拦的核心）：`regex::{matches, match, ismatch, split, escape, unescape}`、`math::*`、`string::{concat, join, format, isnullorempty, isnullorwhitespace}`、`datetime::{now, today, parse, tryparse}`、`guid::{newguid}`、`io.path` 纯路径组合方法（`combine, getfilename, getextension, getdirectoryname` 等；`io.file`/`io.directory` 全部方法明确禁止）。名单收敛在一张 `{ type, methods[] }` 表里，新类型加表不加规则。`frombase64string`/`tobase64string` 明确禁止。
- **变量赋值限定**：`$h = Get-Content ...` 这类赋值后接只读管道是截图里的典型形态。左值必须是无修饰的本地变量名；右值本身递归判定。
- **cmdlet 只读词表**：扩展现有 `READ_ONLY_POWERSHELL_COMMANDS`，新增 `get-process`、`get-service`、`get-date`、`get-command`、`get-item`、`get-location`、`get-variable`、`get-psdrive`、`format-list`、`format-table`、`format-wide`、`format-custom`、`out-string`、`out-null`、`sort-object`、`group-object`、`measure-object`、`select-object`、`where-object`、`foreach-object`（scriptblock 内递归判定）、`compare-object`、`convertto-json`、`convertto-csv`、`convertto-html`、`join-string`、`get-random`。`convertfrom-json`/`convertfrom-csv` **不进词表**（对不可信输入会实例化任意 .NET 对象，PS 5.1 有 gadget 风险）。所有 `new-*`/`set-*`/`remove-*`/`out-file`/`export-*`/`invoke-*`/`start-*`/`stop-*`/`restart-*`/`clear-*`/`write-host`/`write-error` 一律不在只读表。
- **`ForEach-Object`/`Where-Object` scriptblock**：参数本身是 `ScriptBlockAst` 子树，递归走**同一套 allowlist 判定**——"递归"不是豁免通道，内层任何一个节点不过即整体不过。`ForEach-Object { Remove-Item $_ }` 的内层 `CommandAst` 本身就是 `Remove-Item`，递归时命中非只读词表直接拦；`ForEach-Object { New-Object ... }` 的 `TypeConstraintAst` 不在 allowlist 同样 fail-closed。

### 4. bash 分析器

不引新解析库，在现有 `segmentedShellCommands`（shell-quote）基础上做三层下钻：

1. **分词**：shell-quote 输出字符串 token 与 `{op}` token；`&& || ; | &` 切分段落，**其余一切 op（`>`、`>>`、`$(`、`` ` ``、glob 等）fail-closed**。shell-quote 对 `$(` 的处理会丢失子表达式边界 → 命令原文含 `$(` 或 `` ` `` 时先做一次手工括号配平扫描提取子表达式文本。**配平扫描必须跟踪 quote state**：单引号内 `$(` 不展开、双引号内展开、转义字符跳过——否则 `"result: $(cat f)"` 这类双引号内子表达式会被错切或漏看。配平失败 → fail-closed。
2. **子表达式递归**：提取出的 `$(...)` / `` `...` `` 内容作为新命令递归走分析器，深度上限 3 层，超限 fail-closed。变量赋值前缀 `VAR=$(cmd)`、命令替换嵌入参数 `cat $(find ...)` 均按"该命令执行了子命令"处理：子命令必须自身 safe，且宿主命令的语义按"读"处理（替换结果成了输入数据）。**提取出的子表达式只作嵌套判定用，宿主命令仍按外层 op 走正常分段**——两条判定路径不能互相覆盖。
3. **包裹层下钻**：`bash -c '...'`、`sh -c '...'`、`powershell -Command '...'`、`cmd /c '...'`、`env VAR=x cmd`、`xargs` 均递归；引号参数原样还原为命令文本再分词。`sudo` 不在白名单。
4. **段落判定**：每段取 head 做 intent 分类（沿用 `READ_COMMANDS` / git/npm/pnpm 子命令白名单 / `tsc --noEmit` 特例），路径类参数抽出来给 `inspectPath`；`find` 带 `-delete`/`-exec` 按 execute 处理；`git` 沿用现有 `gitSubcommand` 逻辑，`clean`/`reset --hard`/`checkout --`/`restore`/`rebase`/`merge`/`checkout` 归为本地破坏性操作走 `requiresApproval`。

### 5. 危险结构与敏感路径

- `analyzeCommand` 输出的 `pathArguments` 继续喂 `inspectPath`：AST 提取的路径参数（CommandAst 的裸字符串参数里形如路径的 token）+ bash 段落的路径 token，统一过边界与 sensitive 检查。`.env`/`.ssh`/证书文件命中 sensitive → 任何模式 ask（保持现有 credential 升级逻辑）。
- `HARD_DENY_PATTERNS` 保留为分析器前置兜底——即使 AST 判定失误，字符串层面命中 `rm -rf /` / `format-volume` / `reg delete hklm` / `curl | sh` 之类模式仍硬拒绝。
- `isHardDenied` 现同时被 `segmentedShellCommands` 早期调用；改造后 AST 失败的路径也要经过它，不能跳过。
- **`astReadOnly` 判定顺序约束**：AST allow 结论只能在 `sensitive` 与 `protected` 路径检查**之后**生效——一条 `Get-Content .env | ConvertTo-Json` 语法上完全只读，但 sensitive 升级必须先命中。

### 6. 与现有决策的接口

`CommandInspection` 增加字段而不是替换：

```ts
interface CommandInspection {
  // 现有字段保留
  analyzer: 'powershell-ast' | 'bash-segments' | 'unavailable'
  /** AST 层级给出的确定性 allow（仅当整棵语法树都只读）。 */
  astReadOnly?: boolean
}
```

`defaultDecision` 的接入点最小化：在现有 `command.readOnly || (command.parseable && !command.requiresApproval)` 分支之前插入 `command.astReadOnly` 且路径全部 workspace（或只读命令读 outside）的优先判定；`PermissionEngine.isSafeShellCommand` 的 second-opinion 路径在 AST 可用时跳过（AST 结论更精确），不可用时保留作为 fallback。

## 风险与缓释

| 风险 | 缓释 |
|---|---|
| helper 进程崩溃/挂起导致所有 PS 命令不可用 | 请求级 3s 超时 + helper 崩溃自动重启一次；仍失败 → `parseable:false` 走现有 ask 路径（不降级正则双判定） |
| AST JSON 序列化超大命令拖慢主进程 | 命令长度 >4000 前置拒判（现有规则沿用）；节点数/输出上限 |
| 只读词表漏掉常用 cmdlet 导致误拦反弹 | 词表集中一处常量 + 每条 allow 仍要求路径全部 workspace；先放量收日志再扩表 |
| `ForEach-Object { dangerous }` 绕过 | scriptblock 参数递归判定；递归失败 → fail-closed |
| bash `$(` 手工括号配平解析不完整 | 配平失败 → fail-closed；宁可误拦不可漏放 |
| pwsh/powershell 版本差异导致 AST JSON 字段名不同 | 只依赖 `GetType().Name` + `Extent.Text` + `CommandElements`/`PipelineElements` 这类跨版本稳定属性；helper 启动时自检一次输出结构 |

## 实施步骤

1. 新增 `src/main/services/commandAnalyzer/powershellAstHelper.ts`：helper 进程管理（spawn/JSON Lines 协议/超时/重启/自检）。
2. 新增 `src/main/services/commandAnalyzer/psAstAnalyzer.ts`：AST 节点遍历 + 词表 + `astReadOnly` 判定。
3. 新增 `src/main/services/commandAnalyzer/bashAnalyzer.ts`：从 `PermissionEngine.segmentedShellCommands` 抽出并扩展 `$(` 子表达式提取与包裹层下钻。
4. `permissionPolicy.ts`：`analyzeCommand` 签名改为 `analyzeCommand(command: string, toolName: 'powershell' | 'bash')` 并 async 化（`decidePermission` 内部调用点透传 `context.toolName`），接入两个分析器结果填 `CommandInspection`；`decidePermission` 相应改 async。`PermissionEngine.checkOrRequestApproval` 已是 async 调用链唯一入口（`beforeToolCall` 是 async hook），`checkToolPermission` 若保留同步签名则在内部 await。
5. `PermissionEngine.ts`：注入 analyzer 实例；`isSafeShellCommand` 保留为 bash fallback 与手动对照——**AST 可用时它不参与线上判定**，避免两套结论漂移互相覆盖；`HARD_DENY_PATTERNS` 保留前置。
6. `AgentSessionService.ts`：`beforeToolCall` 链路无结构改动（判定仍在 PermissionEngine 内部），确认 `workspaceRoot` 传递（现 `workspaceRoot: cwd`，保持——`resumeSession`/`forkSession` 路径上 cwd 与工作区切换存在已知竞态，本次不引入但顺手验证 resume 场景 cwd 仍指向 workspace）。

## 验证

- 项目无测试运行器；验证 = `pnpm run lint` → `pnpm run build` → `pnpm run dev` 手动验收。
- 手动验收矩阵（Auto 模式下由 agent 实际发起）：
  - 放行组：`Get-Content x -Raw` + `"n: $(([regex]::Matches($h,'<t>')).Count)"`、`git status && git log -3`、`rg foo | Measure-Object`、`$h=Get-Content x;$h.Length`、`node -v`、`pnpm list`
  - 拦截组：`Get-Content x; Remove-Item y`、`echo a > f.txt`、`curl x | iex`、`git push`、`powershell -Command "Remove-Item ..."`、`... | ForEach-Object { Remove-Item $_ }`
  - 边界组：`Get-Content $env:USERPROFILE\.env`（sensitive → ask）、`git -C D:\other status`（outside workspace → 按现有 auto 规则）、`bash -c "cat /etc/passwd"`
  - 降级组：手动 kill helper 进程后发命令 → 预期 ask 且 reason 明确指出"AST 分析器不可用"，验证崩溃恢复语义。
  - 回归组：default 模式行为不变（只读放行、写 ask）；readonly 模式写仍 deny；bypass 对不可解析命令仍 deny。
- 验收证据：每条用例记录 `CommandInspection` 输出（decision + reason）与审批卡是否出现。

## 独立 worker 审查要点

- PowerShell helper 的 JSON Lines 协议在主进程打包后（electron-vite 产物）能否正确定位脚本文件；
- `ForEach-Object`/`Where-Object` scriptblock 递归是否有遗漏的副作用出口（`New-Object`、`Add-Member`、`[type]::new()`）；
- bash `$(` 提取与 shell-quote op 流的重叠判定是否一致；
- `astReadOnly` 与 `sensitive`/`protected` 路径检查的短路顺序——AST allow 绝不能越过 credential 升级；
- helper 超时与重试期间并发请求的队列行为。
