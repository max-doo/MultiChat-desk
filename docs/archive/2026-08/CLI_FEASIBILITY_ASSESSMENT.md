# MultiChat CLI 与轻量化架构评估

## 1. 结论摘要

基于当前代码库和“保留现有网页容器/页面自动化能力”的前提，结论如下：

- `CLI 可行`
  适合做，而且应该尽快做，但不应直接把现有 React/Electron UI 逻辑硬包成命令行。
- `常驻后台进程 + CLI 是主方案`
  页面自动化天然依赖常驻 Webview 会话、登录态、Cookie、已加载页面和稳定的 DOM 状态，因此真正的执行内核应是常驻服务。
- `单次命令 CLI 仍然值得做`
  但它更适合作为对外入口，本质上应是常驻服务的薄客户端，而不是每次冷启动一个桌面壳执行任务。
- `Tauri 不是当前阶段的优先迁移目标`
  如果产品核心仍然是多站点嵌入与页面级自动化，Electron 的能力边界更成熟，迁移到 Tauri 的重写成本和不确定性都偏高。

推荐路线：

```text
Client / Shell / Script
        |
      CLI
        |
Local IPC / Named Pipe
        |
Automation Service (Electron Main)
        |
Webview Sessions + Existing DOM Automation
```

---

## 2. 评估范围

本评估回答三个问题：

1. 在保留现有网页容器能力的前提下，CLI 是否可行？
2. 单次命令执行 CLI 与常驻后台进程两种方案，哪个更适合当前项目？
3. 是否值得借这个机会迁移到更轻的框架，例如 Tauri？

本评估不讨论“彻底改成 API-first、放弃页面自动化”的路线，因为这已经改变了产品核心。

---

## 3. 当前项目的真实架构约束

从现有代码可以看出，MultiChat 的核心价值并不是“桌面 UI”，而是：

- 同时承载多个目标站点的真实页面会话
- 通过选择器和注入脚本操作输入框、发送按钮、上传、Deep Research 等交互
- 从页面 DOM 中提取结果
- 把多个模型的输出再做汇总

关键证据：

- 主进程负责窗口、会话路径、IPC、存储与 Webview 容器
  - `src/main/index.ts`
  - `src/main/ipcHandlers.ts`
  - `src/main/webviewManager.ts`
- 页面自动化依赖选择器与注入脚本
  - `src/renderer/src/config/selectors.ts`
  - `src/renderer/src/utils/webviewScripts.ts`
- 当前“编排”逻辑大量在 renderer 的 Zustand store 中
  - `src/renderer/src/store/appStore.ts`
- Prompt 管理与摘要 API 本质上已经接近可复用的 Node 侧能力
  - `src/main/agentPrompts.ts`
  - `src/main/api/summaryApi.ts`

这意味着：

- `CLI 不是简单加一个 commander/yargs 就能完成`
- 真正要做的是把“执行内核”从 UI 里拆出来

---

## 4. 方案 A：单次命令执行 CLI

### 4.1 目标形态

典型调用：

```powershell
multichat exec --model gemini --prompt "总结这篇网页"
multichat collect --session s-001 --json
multichat summarize --input outputs.json --provider openrouter --model openai/gpt-4o-mini
```

特点：

- 脚本/程序每次通过一个进程调用
- 输入来自命令参数或 stdin
- 输出走 stdout/stderr/JSON

### 4.2 技术可行性

`可行，但不适合作为真实执行内核。`

如果这条路线的真实含义是：

- 每次命令都冷启动一个桌面应用
- 新建 Webview
- 恢复页面与登录态
- 执行自动化
- 等到页面响应后退出

那么它会遇到几个明显问题：

- 启动慢
- 会话恢复不稳定
- 页面状态不可预测
- 并发差
- 自动化工具多次调用时资源浪费大

对当前产品来说，单次命令 CLI 最合理的用法是：

- 作为对外接口
- 底层把命令转发给已存在的常驻进程

### 4.3 优点

- 最符合自动化脚本使用习惯
- 最容易被 Shell、脚本、Codex 类工具消费
- `--json` 输出天然适合自动化链路
- 学习成本低

### 4.4 缺点

- 如果没有常驻服务托底，稳定性会明显不足
- 很容易把状态机藏进 CLI 参数里，后期难维护
- 错误处理、超时、取消、重试都需要额外定义协议

### 4.5 结论

| 维度 | 结论 |
| --- | --- |
| 可行性 | 中高 |
| 适合做对外入口 | 是 |
| 适合做底层执行模型 | 否 |

---

## 5. 方案 B：常驻后台进程 + CLI/SDK 调用

### 5.1 目标形态

典型调用：

```powershell
multichat daemon start
multichat daemon status
multichat exec --model claude --prompt "..."
multichat session list --json
```

特点：

- 桌面端或后台服务长期存在
- Webview 会话长期存在
- CLI 只是命令转发器
- 将来还可以继续扩展为 SDK/MCP 风格适配层

### 5.2 技术可行性

`高可行，而且最符合当前产品的真实约束。`

原因：

- 页面自动化本来就依赖长会话
- 现有代码已经有主进程 IPC 模型，天然适合继续服务化
- 多模型页面容器、Cookie、账号切换、Research 模式都更适合在常驻实例中维护

### 5.3 推荐通信方式

Windows 环境建议优先：

- `Named Pipe`

原因：

- 本地进程通信够用
- 不需要额外开本地 TCP 端口
- 安全边界更清晰
- 与 CLI 的请求/响应模型匹配

协议建议：

- 第一阶段：同步 JSON request/response
- 第二阶段：增加流式事件和任务句柄

### 5.4 优点

- 自动化成功率最高
- 会话复用最好
- 最容易控制排队、并发、抢占和锁
- 后续既能服务桌面 UI，也能服务 CLI

### 5.5 缺点

- 生命周期管理会更复杂
- 需要解决“服务未启动/版本不匹配/正在忙”问题
- 需要定义本地权限边界

### 5.6 结论

| 维度 | 结论 |
| --- | --- |
| 可行性 | 高 |
| 适合做底层执行模型 | 是 |
| 适合承载 Webview 自动化 | 是 |

---

## 6. 推荐方案：Hybrid

推荐不是二选一，而是：

- `对外`：单次命令 CLI
- `对内`：常驻后台执行进程

这是对当前项目最稳的路线，因为它同时满足：

- 自动化程序需要简洁入口
- 页面自动化需要常驻上下文

### 6.1 推荐架构

```text
CLI
  - 参数解析
  - stdout/stderr/JSON
  - 任务轮询
  - 超时与退出码

Local Transport
  - Named Pipe
  - 请求/响应
  - 取消/状态查询

Automation Service (Main Process)
  - 会话管理
  - 任务排队
  - Webview 生命周期
  - 命令执行

Browser Engine
  - Webview
  - selectors
  - injected scripts
  - DOM extraction
```

### 6.2 推荐首批命令

- `multichat daemon start`
- `multichat daemon status`
- `multichat exec`
- `multichat collect`
- `multichat summarize`
- `multichat session list`
- `multichat session reset`

### 6.3 推荐首批输出规范

- 默认输出面向人读
- `--json` 输出稳定机器格式
- 非零退出码表示失败
- 预留 `taskId` 以支持长任务

---

## 7. 为了做 CLI，必须先做的重构

这一步比“写 CLI”本身更重要。

### 7.1 把执行编排从 renderer 下沉

当前很多动作仍然依赖：

- React 组件实例
- `WebviewCardRef`
- renderer store 中的 orchestration

这会导致 CLI 无法直接复用。

正确方向是：

- Renderer 只做 UI
- Main 维护自动化服务
- CLI 和 UI 都调用同一套服务

### 7.2 建议新增的服务边界

- `AutomationSessionManager`
  负责模型页面实例、账号会话、Webview 生命周期
- `AutomationCommandService`
  负责 send / collect / upload / research mode 等命令
- `PromptRegistryService`
  复用现有 Prompt 文件管理
- `SummaryService`
  复用现有摘要 API 能力

### 7.3 哪些可以直接复用

可直接迁移或轻量改造：

- Prompt 文件管理
- Summary API 调用
- 请求体构建
- 选择器定义
- 注入脚本模板

需要重构后才能复用：

- 多模型发送编排
- 历史记录与 session 语义
- 上传/拖拽/鼠标事件派发
- CLI 的任务状态和错误码

### 7.4 DRY 风险

本次改造最容易写成屎山的地方是：

- UI 一套命令逻辑
- CLI 一套命令逻辑
- Main 再包一层命令逻辑

必须坚持：

- 自动化执行逻辑只保留一份
- CLI 和 UI 只做入口，不做业务复制

---

## 8. 是否可以换成更轻的框架，比如 Tauri

结论先说：

`可以，但不建议作为当前阶段的主方向。`

### 8.1 Tauri 的优势

从官方文档看，Tauri 确实具备这些能力：

- 支持多窗口
- 支持前端调用 Rust command
- 支持 sidecar
- 支持加载外部 URL 的 webview

官方文档还说明：

- Tauri v2 支持 multiwebview，但该能力仍处于 `unstable` 特性下
- sidecar 适合短命令场景；若进程需要长驻并处理多并发任务，官方建议考虑更合适的 IPC 机制

这两点对当前项目非常关键。

### 8.2 为什么 Tauri 现在不适合优先迁移

当前 MultiChat 的困难点不是“桌面壳太重”，而是：

- 需要多个真实网页会话并存
- 需要持续操控外部站点 DOM
- 需要处理导航、弹窗、账号切换、上传、鼠标事件、研究模式等细节
- 需要长期保持可复用上下文

而当前 Electron 代码明显依赖这些成熟能力：

- `webviewTag`
- WebContents 事件
- 调试器/CDP 风格操作
- 窗口与页面事件细粒度控制

这些在 Electron 里是项目当前已经验证过的能力边界。

Tauri 的问题不在于“不能做桌面应用”，而在于：

- 迁移需要重写主进程能力为 Rust
- 现有 Electron Webview 相关机制不能直接平移
- 多 Webview 恰好是 Tauri v2 里仍偏敏感的能力区
- 对当前项目来说，迁移收益主要是包体与运行时变轻，但不会减少页面自动化本身的复杂度

### 8.3 什么时候 Tauri 才值得认真考虑

只有在以下前提同时成立时，Tauri 才更值得评估：

- 产品开始明显弱化嵌入第三方网站的能力
- 主要工作负载转向 API-first
- 页面容器数量大幅减少
- 自动化行为从“重 Webview 操作”转向“轻命令调度”

如果未来的 MultiChat 是：

- 一个本地控制台
- 背后主要调 API 和本地服务
- 页面容器只是少量辅助能力

那时 Tauri 才可能是更合理的壳层选择。

### 8.4 对当前项目的最终判断

| 方向 | 判断 |
| --- | --- |
| 现在把 Electron 换成 Tauri | 不推荐 |
| 现在保留 Electron，先做 daemon + CLI | 推荐 |
| 未来在执行内核稳定后再评估 Tauri 壳层 | 可以 |

---

## 9. 风险清单

### 9.1 主要技术风险

- 页面选择器会持续漂移
- 多客户端并发调用可能产生 session 抢占
- 命令协议若一开始设计过大，后期会很难演进
- 如果仍把关键编排留在 renderer，CLI 会持续失血

### 9.2 主要产品风险

- CLI 若暴露过多隐式状态，自动化工具很难稳定使用
- 如果任务边界不清晰，日志和错误会难以定位
- 如果直接追求“轻框架迁移”，可能会把真正应该解决的架构问题推迟

---

## 10. 推荐实施顺序

### Phase 1：抽执行内核

目标：

- 把自动化编排从 renderer/store 下沉到主进程服务层

交付：

- 自动化服务接口
- 统一命令模型

### Phase 2：增加本地 IPC

目标：

- 在主进程暴露本地 daemon 协议

交付：

- Named Pipe server
- 健康检查
- 状态查询

### Phase 3：增加 CLI

目标：

- 提供自动化脚本可直接调用的入口

交付：

- `exec`
- `collect`
- `summarize`
- `session *`

### Phase 4：补充自动化程序友好特性

目标：

- 提升自动化稳定性

交付：

- `--json`
- 流式输出
- 超时/取消
- 任务 ID
- 更稳定的错误码

---

## 11. 最终建议

如果目标是“让外部自动化工具能直接使用这个产品”，当前最优路线不是重写壳层，而是：

1. 保留 Electron/Webview 作为执行引擎
2. 把执行逻辑服务化
3. 用本地 IPC 暴露 daemon
4. 用 CLI 作为自动化程序的统一入口

对当前 MultiChat 来说，`Electron -> Tauri` 不是第一优先级，`UI 驱动 -> 服务驱动` 才是第一优先级。

---

## 12. 官方资料

以下判断参考了 Tauri 官方文档：

- 架构与前后端消息传递
  - https://github.com/tauri-apps/tauri-docs/blob/v2/src/content/docs/concept/architecture.mdx
- 前端调用 Rust command
  - https://github.com/tauri-apps/tauri-docs/blob/v2/src/content/docs/develop/calling-rust.mdx
- sidecar 与短命令/长驻进程边界
  - https://github.com/tauri-apps/tauri-docs/blob/v2/src/content/docs/learn/sidecar-nodejs.mdx
- 多窗口
  - https://github.com/tauri-apps/tauri-docs/blob/v2/src/content/docs/learn/Security/capabilities-for-windows-and-platforms.mdx
- 外部 URL Webview
  - https://github.com/tauri-apps/tauri-docs/blob/v2/src/content/docs/plugin/localhost.mdx
- multiwebview 在 Tauri v2 中仍为 unstable
  - https://github.com/tauri-apps/tauri-docs/blob/v2/src/content/docs/start/migrate/from-tauri-1.mdx
