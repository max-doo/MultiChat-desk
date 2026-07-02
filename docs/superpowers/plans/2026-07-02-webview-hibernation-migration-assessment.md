# Webview 休眠机制移植评估

> Created: 2026-07-02 10:53 (+08:00)
> Revised: 2026-07-02 12:39 (+08:00) — 修正 suspend 事实描述、补正 key schema 历史偏差、将开放问题转为已决策结论、新增总结页/快捷窗口/主窗口关闭后休眠需求与各场景延迟矩阵。

## 背景与目标

项目历史上曾实现一套 webview 休眠机制，存在两个版本：

- **原始版本（commit `57efc27`，2026-07-01 22:13）**：改动 2 文件 +305。`suspend` 仅 `setIsHibernated(true)` + className 隐藏（**未调 `loadURL('about:blank')`**），调度器用 **`modelId`** 直接查 `webviewRefs.get(modelId)`。
- **merge 后版本（commit `eb4791d`，2026-07-01 22:23）**：调度器 key 改为 **`${productMode}-${i}`** + `key.split('-')` 解析，比原始版复杂且与 main 不兼容。

`eb4791d` 当时处于一条悬空开发线上，未被任何分支引用，已于本次会话通过 `git branch recover-hibernation eb4791d` 建立保护分支，对象已永久安全。**实施时应以更简洁、与 main 兼容的原始版 `57efc27` 为基底，而非 `eb4791d`。**

但 `eb4791d` 是一个 merge commit，整体 diff 含 39 文件 / +683 / -9494，其中大量是已删除的 `.agent/`、`.trae/` 目录与 `.memory/` 早期初始化文件，**不能整体 cherry-pick 回 main**。此外，该休眠实现后来引发了 webview 永久白屏回归（commit `cc975a5` 已修复），而修复引入的 `readonlySnapshot` / `urlMismatch` 可见性门控在 main 上已与休眠逻辑共存于 `WebviewCard.tsx` 的同一段 `className`，二者若直接合并会再次踩坑。

> **⚠️ 原始实现的事实纠正**：早期文档（含本评估初稿）将 suspend 描述为「将 webview 导航到 about:blank 以释放渲染进程内存」。经核查 `57efc27` 与 `eb4791d` 两版代码，**suspend 实际只 `setIsHibernated(true)` + className `invisible` 隐藏，并未 `loadURL('about:blank')`，渲染进程未真正卸载**。而 `resume` 却调用了 `loadURL(targetUrl)`——二者语义矛盾：suspend 没卸载，resume 的重载变成冗余刷新。这是原始实现的半成品缺陷，移植时必须修正（见「已决策结论 D1」）。

本文档的目标：评估「将休眠逻辑选择性移植回当前 main」所需的适配点、风险与验证方案，**不直接改代码**，为后续实施提供可审阅的依据。

## 用户原始需求（最终确认矩阵）

经会话讨论澄清，休眠机制的最终需求如下：

| # | 场景 | 延迟 | 作用对象 | 休眠深度 |
|---|------|------|---------|---------|
| R1 | 主页面切换模型 | **5 分钟** | 被切走的旧模型 | 真卸载进程 |
| R2 | 快捷窗口切换模型 | **5 分钟** | 被切走的旧模型（当前模型永不休眠） | 真卸载进程 |
| R3 | 总结页长时间使用 | **10 分钟** | 总结页显示中的 webview | 真卸载进程 |
| R4 | 主窗口关闭（托盘隐藏） | **15 分钟** | 主页面所有显示中的模型 | 真卸载进程，更宽容 |
| R5 | 唤醒 | 即时 | 被切回/重显的模型 | loadURL 重载 + 草稿恢复 |
| R6 | 白名单（不休眠） | — | 活动会话 / 监控中 / 发送中 / 回溯历史态 | 4 项 |

**核心原则**：优化性能（真省渲染进程内存）的同时保持用户体验——休眠后用户可恢复，不丢失对话（登录态靠 `persist:shared`，输入草稿靠保存/恢复，SPA 对话上下文接受丢失）。

> **需求澄清记录**：用户最初表述中「快捷窗口永不休眠」与「快捷窗口被切换的 WebView 隔 5 分钟销毁」曾自相矛盾。经确认：**快捷窗口的当前模型永不休眠；被切走的旧模型 5 分钟后销毁**（后者为准）。

## 参考实现位置（recover-hibernation 分支 / eb4791d）

> **注意**：下表行号基于 `eb4791d`。MainPage 调度器部分的 key schema（`${productMode}-${i}` + split）是 `eb4791d` 退化版，**实施时改用原始版 `57efc27` 的 `modelId` schema**（见片段 B）。WebviewCard 部分两版基本一致，但 `suspend` 缺 `loadURL('about:blank')` 是两版共同缺陷，**实施时按 D1 补上**。

| 片段 | 文件 | 行号（recovery 版） |
|---|---|---|
| `WebviewCardRef` 类型：`suspend`/`resume`/`isHibernated` | `src/renderer/src/components/WebviewCard.tsx` | 120-125 |
| 休眠状态：`isHibernated`/`hibernatedUrlRef`/`hibernatedDraftRef`/`isResumingRef` | 同上 | 145-148 |
| `suspend` 实现（保存 URL+草稿，置 isHibernated） | 同上 | 812-862 |
| `resume` 实现（loadURL 恢复 + 轮询恢复草稿） | 同上 | 866-935 |
| `isHibernated` 查询 | 同上 | 941-943 |
| 休眠覆盖层 UI（`bedtime` 图标 + 唤醒按钮） | 同上 | 1209-1237 |
| webview tag 可见性（`isHibernated ? 'invisible'`） | 同上 | 1239-1241 |
| 调度器常量与 refs（`HIBERNATE_DELAY_MS`/`hibernateTimersRef`/`lastActiveTimeRef`/`prevDisplayedIdsRef`） | `src/renderer/src/pages/MainPage.tsx` | 55-59 |
| `clearHibernateTimer`/`executeHibernate`/`scheduleHibernate`/`wakeWebview` | 同上 | 61-143 |
| `displayedModels` 变化触发的唤醒/休眠 useEffect | 同上 | 152-172 |
| `isActive` 变化触发的唤醒/休眠 useEffect | 同上 | 176-189 |
| 卸载清理 useEffect | 同上 | 192-199 |

## 当前 main 对应位置与差异

### WebviewCard.tsx（main）

- 可见性门控已存在（cc975a5 修复后）：
  ```tsx
  // main: 行 1165
  className={`w-full h-full ${(loadError || urlMismatch) && readonlySnapshot ? 'invisible pointer-events-none' : ''}`}
  ```
- 覆盖层条件：`(urlMismatch || loadError) && readonlySnapshot`（行 1091），以及 `loadError && !readonlySnapshot`（行 1134）两套。
- **main 没有 `isHibernated` 状态、没有 `suspend/resume/isHibernated` 方法、没有休眠覆盖层。** `WebviewCardRef` 类型也无这三项。
- `webview` 标签 `src="about:blank"`（行 1163），靠 `loadedUrlRef` + `loadURL` 在 ready 后导航，与 recovery 一致。

### MainPage.tsx（main）

- **关键差异 1 — ref 注册的 key schema（已澄清，应以原始版为准）**：
  - `eb4791d` 版用 `${productMode}-${i}` 作为休眠调度 key，并在 `executeHibernate` 内 `key.split('-')` → `[mode, indexStr]` 再查 `webviewRefs.get(key)`。
  - 但**原始版 `57efc27` 用的是 `modelId`**，直接 `webviewRefs.get(modelId)`，无 split、无 modeModels 查找——更简洁。
  - main 的 `getRefCallback`（行 75-94）把 ref 同时注册到 **`slot-${slotIndex}`** 和 **`model.id`** 两个键（行 84-85：`registerWebviewRef(slotKey, ref)` + `registerWebviewRef(id, ref)`）。
  - **结论：原始版 `57efc27` 的 `modelId` schema 与 main 零适配**——main 已注册 `model.id` 键，照搬原始版即可。`eb4791d` 的 `${productMode}-${i}` + split 是退化的复杂版本，**不采用**。初稿基于 `eb4791d` 评估得出「必须重写 key 解析」的结论，对 `eb4791d` 成立，但忽略了原始版 `57efc27` 本就兼容——本修订予以补正。
- **关键差异 2 — main 已有 `mountedWebviews` / `prevSlotModelIds` 跟踪机制**（行 251-312），语义与 recovery 的 `prevDisplayedIdsRef` 部分重叠（都跟踪「哪些 slot 曾挂载过」）。recovery 的 `prevDisplayedIdsRef` 用于判定「不再显示的模型启动休眠倒计时」。main 的 `mountedWebviews` 是「只增不减」地保留所有曾挂载的 webview（这正是 KNOWLEDGE.md 第 79 条记录的「隐藏未销毁的 webview」内存来源）。移植时 `prevDisplayedIdsRef` 的逻辑可复用 `mountedWebviews` 的 Set，但要区分「曾挂载」与「当前应休眠」两个语义。
- 白名单字段全部存在且语义一致：`state.activeModels`（appStore.ts:317）、`state.monitor?.isMonitoring`（appStore.ts:340）、`state.isSending`（appStore.ts:313）。**白名单逻辑可直接移植，无需适配。** 回溯态白名单第 4 项 `activeHistoryId` 见「已决策结论 D3」。
- `productMode` / `displayedModels` / `isActive` / `modeModels` 均存在，结构一致。

## 三个移植片段与适配点

### 片段 A — WebviewCard 休眠能力（suspend/resume/isHibernated + 状态 + 覆盖层 UI）

**可几乎原样移植**，与现有 state 无耦合：

- 新增 state：`isHibernated`、`hibernatedUrlRef`、`hibernatedDraftRef`、`isResumingRef`。
- `suspend`/`resume`/`isHibernated` 三方法加入 `useImperativeHandle` 的返回对象，并同步更新 `WebviewCardRef` 类型定义。
- `resume` 内恢复草稿依赖 `generateGetInputTextScript` / `generateInsertTextScript` / `selectors` / `isReady` —— 这些在 main 的 WebviewCard 内均已存在（自动化注入链路），需确认 import 与变量名一致后再搬。
- 休眠覆盖层 UI（`bedtime` 图标 + 唤醒按钮）原样新增，放在现有 `readonlySnapshot` 覆盖层与 `loadError` 覆盖层之后、`<webview>` 之前。

**必须修正的：suspend 补 `loadURL('about:blank')`（决策 D1）**。原始版 `suspend` Phase 3 只 `setIsHibernated(true)`，渲染进程未卸载——与「真省内存」目标冲突。修正后 suspend 应在保存 URL+草稿后、置 `isHibernated` 前，调用 `webview.loadURL('about:blank')` 释放渲染进程页面（V8 堆释放）。这样 resume 的 `loadURL(targetUrl)` 不再冗余，suspend/resume 语义自洽（卸载/重载）。

> **注意**：`loadURL('about:blank')` 后 webview 仍挂载在 DOM，渲染进程对象不立即销毁（Electron webview tag 生命周期决定），但页面层卸载会释放 SPA 的 V8 堆与 DOM 树，实测内存可显著下降。若要彻底释放渲染进程，需从 DOM 移除 `<webview>` 并重新挂载，但这会破坏 ref 稳定性与 `persist:shared` 绑定，**不采用**，以 `loadURL('about:blank')` 为深度上限。

**webview 可见性 className 必须合并两套 invisible 逻辑**（见下方真值表）。recovery 原文是：

```tsx
// recovery: 行 1241（注意 src 三元两侧都是 about:blank，实际靠 loadURL 恢复）
className={`w-full h-full ${loadError ? 'invisible pointer-events-none' : ''} ${isHibernated ? 'invisible' : ''}`}
```

main 当前是：

```tsx
// main: 行 1165
className={`w-full h-full ${(loadError || urlMismatch) && readonlySnapshot ? 'invisible pointer-events-none' : ''}`}
```

合并后应为（草案，以真值表验证为准）：

```tsx
className={`w-full h-full ${
  ((loadError || urlMismatch) && readonlySnapshot) || isHibernated
    ? 'invisible pointer-events-none'
    : ''
}`}
```

### 片段 B — MainPage 调度器（定时器 + 白名单 + 唤醒/休眠编排）

**采用原始版 `57efc27` 的 `modelId` schema，不重写 key 解析**：

- `HIBERNATE_DELAY_MS = 5 * 60 * 1000`（**5 分钟**，决策 R1；原始版是 10 分钟，按需求改为 5）、`hibernateTimersRef`、`lastActiveTimeRef` 原样新增。
- `clearHibernateTimer` 原样移植。
- `executeHibernate` / `wakeWebview` 内的 key→ref 查找**采用原始版 `webviewRefs.get(modelId)`**，放弃 `eb4791d` 的 `key.split('-')` + `modeModels[mode][index]`。调度 key 直接用 `model.id`，与 main 的 `getRefCallback` 注册键（行 84-85）对齐，零适配。
- 白名单三检查（`activeModels.length` / `monitor.isMonitoring` / `isSending`）原样移植。
- **白名单第 4 项（决策 D3）**：`executeHibernate` 增加检查 `state.activeHistoryId`，回溯态下跳过休眠，从源头消除真值表 case 10-12。
- `scheduleHibernate` 原样移植。
- 两个 useEffect（`displayedModels` 变化、`isActive` 变化）的依赖数组需核对：main 的 `displayedModels` 是 `useMemo`（行 240），`productMode` 来自 store，`isActive` 是 props —— 依赖项一致，可移植。但「不再显示的模型启动倒计时」的判定，建议复用 main 已有的 `mountedWebviews` Set 差集，而非再引入 `prevDisplayedIdsRef`，避免双份跟踪状态。
- 卸载清理 useEffect 原样移植。

### 片段 B' — 主窗口关闭后休眠（新增，决策 R4）

原始实现**无此路径**，需新增：

- main 的 `isActive` 仅在页面内切换（main↔summary）时变化，主窗口 hide 到托盘时 renderer 无感知。
- 需在 preload 暴露 `onWindowHide`/`onWindowShow` 监听（main 进程 `webviewManager` 的窗口 hide/show 事件 → renderer），并在 MainPage 监听：`onWindowHide` → 对当前显示模型 `scheduleHibernate`（用 **15 分钟**延迟，决策 R4）；`onWindowShow` → 立即 `wakeWebview`。
- **IPC 契约同步**（AGENTS.md 强制）：新增 `onWindowHide`/`onWindowShow` 需同步 `src/main/ipcHandlers.ts` 或 `webviewManager.ts` 的事件广播、`src/preload/index.ts`、`src/preload/index.d.ts`、渲染层调用点。
- 15 分钟延迟与切换的 5 分钟延迟**分用不同常量**：`HIBERNATE_DELAY_HIDE_MS = 15 * 60 * 1000`。

### 片段 C — 不移植的部分

- `eb4791d` 的 `.agent/`、`.trae/` 目录删除、`.memory/` 早期初始化、docs 新增 —— 全部不移植。
- recovery 的 `src={isHibernated ? 'about:blank' : 'about:blank'}` 这种「三元两侧同值」写法不移植（main 已是 `src="about:blank"`，保持不变；休眠改的是 className 可见性 + 由 `suspend` 调 `loadURL('about:blank')` 真正卸载页面层，决策 D1）。

### 片段 D — SummaryPage 休眠调度（新增，决策 R3）

原始实现 SummaryPage **零休眠代码**，需新增。SummaryPage 的 webview 由 `SummaryPage.tsx` 管理（隔离模式 `isolated`），与 MainPage 的调度器独立：

- 在 SummaryPage 内新增独立调度器（常量 `HIBERNATE_DELAY_SUMMARY_MS = 10 * 60 * 1000`，决策 R3），结构同 MainPage 片段 B：`hibernateTimersRef` + `scheduleHibernate`/`executeHibernate`/`wakeWebview` + 卸载清理。
- key 同样用 `model.id`（SummaryPage 的 webview ref 注册方式需核查，若未走 `getRefCallback` 则需补注册或用本地 ref Map）。
- 触发：`isActive`（summary 页是否前台）变化时——`isActive=false`（切走）启动 10 分钟倒计时，`isActive=true`（切回）立即唤醒。
- 白名单：SummaryPage 隔离模式下 `activeModels`/`monitor`/`isSending` 语义可能不适用，需核查是否复用同一白名单或简化（隔离页无活动会话概念，主要看是否正在总结/抓取）。**实施时需确认 SummaryPage 的活跃状态判定字段。**
- **风险**：SummaryPage 的 webview 用于抓取 AI 响应做总结，休眠时机不当会打断正在进行的总结/抓取。白名单必须覆盖「总结进行中」「抓取进行中」状态。

### 片段 E — QuickPage 旧模型休眠调度（新增，决策 R2）

原始实现 QuickPage **零休眠代码**。按决策 R2，快捷窗口的当前模型永不休眠，被切走的旧模型 5 分钟后销毁：

- 在 QuickPage 内新增调度器（常量 `HIBERNATE_DELAY_QUICK_MS = 5 * 60 * 1000`，决策 R2），结构同片段 B。
- 触发：`handleModelChange(newModelId)` 中，对 `oldModelId`（`oldModelId !== newModelId`）调 `scheduleHibernate(oldModelId)`；对新模型 `wakeModel(newModelId)`。
- key 用 `model.id`（QuickPage 已有 `cardRefs: Map<string, WebviewCardRef>`，可直接用，无需走 store 的 `webviewRefs`）。
- **当前模型保护**：`scheduleHibernate` 内检查 `modelId === selectedModelIdRef.current` 则跳过（防止竞态）；`executeHibernate` 定时器触发时再次确认非当前模型。
- 卸载清理 useEffect 清理所有定时器。
- QuickPage 无白名单需求（隔离快捷窗口，无活动会话/监控/发送概念），但需确认切换瞬间 `getInputText` 文本携带逻辑（已有）不与休眠冲突——文本携带在 `handleModelChange` 同步进行，5 分钟后才休眠，无时序冲突。

## 已决策结论（原开放问题，已全部确认）

- **D1（原开放问题 1）— 休眠深度：真卸载进程。** `suspend()` 在保存 URL+草稿后、置 `isHibernated` 前调用 `webview.loadURL('about:blank')`，释放页面层 V8 堆与 DOM 树，真正省内存。`resume()` 调 `loadURL(targetUrl)` 重载 + 恢复草稿。用户接受唤醒后 SPA 对话上下文丢失（仅草稿 + `persist:shared` 登录态恢复）。**不采用**「仅视觉隐藏」——那不省内存，与「优化性能」初衷冲突。
- **D2（原开放问题 2）— 与「保留会话连续性」决策的关系：接受折中。** KNOWLEDGE.md 记录的「webview 销毁全保留、牺牲内存」决策是在无休眠机制时的兜底；现休眠仅针对「5-15 分钟空闲」窗口，活跃会话有白名单保护不休眠，不破坏「避免误销毁活跃会话」语义，只是给真空闲加回收出口。
- **D3（原开放问题 3）— 白名单第 4 项：加入。** `executeHibernate` 增查 `state.activeHistoryId`，回溯态跳过休眠，从源头消除真值表 case 10-12 的覆盖层重叠（方案 a）。
- **D4（原开放问题 4）— 延迟是否配置化：先硬编码。** 各场景延迟（5/5/10/15 分钟）硬编码为独立常量，不进 electron-store，避免过早增加设置项 UI 与 IPC 契约成本。后续按需配置化。

## 白屏坑防御：12 种真值表

cc975a5 的根因教训写明：「计划只推演了覆盖层条件，没推演可见性条件」。当前 main 的可见性条件已含 `readonlySnapshot` 维度（6 种模式），引入 `isHibernated` 后扩展为 **2（休眠/非休眠）× 6 = 12 种**，必须逐一验证三个量：

- **V** = webview 是否 `invisible pointer-events-none`（应隐藏）
- **O_snapshot** = readonlySnapshot 覆盖层是否显示
- **O_hibern** = 休眠覆盖层是否显示
- **一致**：隐藏 webview 时，必须有某个覆盖层填补视觉（否则白屏）；显示 webview 时，不应有覆盖层遮挡。

设 `snap = (loadError || urlMismatch) && readonlySnapshot`（main 现行可见性条件），合并后 `V = snap || isHibernated`。

| # | isHibernated | activeHistoryId | loadError | urlMismatch | readonlySnapshot | snap | V (隐藏) | O_snapshot | O_hibern | 一致性 | 说明 |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | F | 无(null) | F | F | null | F | F | F | F | ✓ | 正常对话 |
| 2 | F | 无 | T | F | null | F | F | F | F | F | ⚠️ 见下 |
| 3 | F | 有 | F | F | {url_mismatch} | F | F | F | F | ✓ | 回溯且URL匹配 |
| 4 | F | 有 | F | T | {url_mismatch} | T | T | T | F | ✓ | 回溯URL不符有快照 |
| 5 | F | 有 | F | T | {no_snapshot} | T | T | T | F | ✓ | 回溯URL不符无快照 |
| 6 | F | 有 | T | * | {load_error} | T | T | T | F | ✓ | 回溯+加载失败 |
| 7 | T | 无 | F | F | null | F | T | F | T | ✓ | **休眠(正常态)** |
| 8 | T | 无 | T | F | null | F | T | F | T | ✓ | 休眠+加载失败→优先休眠覆盖层 |
| 9 | T | 有 | F | F | {url_mismatch} | F | T | F | T | ✓ | 休眠(回溯态) |
| 10 | T | 有 | F | T | {url_mismatch} | T | T | T? | T? | ⚠️ 见下 |
| 11 | T | 有 | F | T | {no_snapshot} | T | T | T? | T? | ⚠️ 见下 |
| 12 | T | 有 | T | * | {load_error} | T | T | T? | T? | ⚠️ 见下 |

### 三个需要决策的边界（开放问题）

- **Case 2（非休眠+无历史+加载失败）**：`snap=F`（因 `readonlySnapshot=null`），故 `V=F`（webview 可见），但页面加载失败应显示 `loadError && !readonlySnapshot` 覆盖层（main 行 1134，仍生效）。✓ 无需改 —— 此 case 不受休眠影响，仅列出确认。

- **Case 7（休眠+正常态）**：核心目标 case。`V=T`（隐藏 webview），`O_hibern=T`（休眠覆盖层显示）。✓ 一致，无白屏。

- **Case 10/11/12（休眠+回溯态）**：理论上「正在回溯历史快照」与「webview 已休眠」不应同时发生 —— 回溯是用户主动查看历史，属于活跃操作，白名单或调度器应阻止此态。但若调度时序导致二者重叠，`V=T`（隐藏），此时 `O_snapshot` 与 `O_hibern` 两个覆盖层会同时渲染（z-index 都是 20，后渲染者在上）。**决策**：
  - 方案 a（推荐）：在 `suspend` 前检查 `activeHistoryId`，回溯态下跳过休眠（加入白名单第 4 项），从源头消除 case 10-12。
  - 方案 b：允许重叠，但让休眠覆盖层 `O_hibern` 的渲染条件加 `&& !readonlySnapshot`，回溯态优先显示快照覆盖层。
  - 建议采用 a，更简单且语义清晰（回溯=活跃查看，不该休眠）。

### 覆盖层渲染顺序建议（WebviewCard JSX 内）

```
{readonlySnapshot 覆盖层}      // O_snapshot，条件 (urlMismatch || loadError) && readonlySnapshot
{loadError 独立覆盖层}          // 条件 loadError && !readonlySnapshot
{休眠覆盖层}                    // O_hibern，条件 isHibernated && !readonlySnapshot  （方案b）/ isHibernated （方案a）
<webview className={V ? invisible : ''} />
```

## 验证方案

移植完成后按 AGENTS.md 流程：

1. `npm run lint` — 0 errors。
2. `npm run build` — 类型检查 + 打包通过。
3. `npm run dev` 手动验证，重点覆盖真值表 case 与各场景延迟：
   - Case 1：正常对话，webview 可见、无覆盖层。
   - Case 7：主页面切换模型后，旧模型 5 分钟（或临时调 `HIBERNATE_DELAY_MS = 30s` 测）进入休眠，确认休眠覆盖层出现、webview 隐藏、点击「立即唤醒」后 URL+草稿恢复。
   - Case 4：回溯历史且 URL 不符，快照覆盖层显示，且此时不应触发休眠（白名单第 4 项 D3）。
   - **R2 快捷窗口**：快捷窗口切换模型，旧模型 5 分钟后休眠；切回旧模型立即唤醒、草稿恢复；当前模型不触发休眠。
   - **R3 总结页**：切到总结页 10 分钟后其 webview 休眠；切回主页面再回总结页立即唤醒；总结进行中/抓取中不休眠（白名单）。
   - **R4 主窗口关闭**：主窗口 hide 到托盘后 15 分钟，主页面显示中的模型休眠；重新 show 后立即唤醒。
   - 唤醒后发送消息、监控、活动会话期间确认不被休眠（白名单 1-3）。
   - 切换 productMode 后，旧模式 webview 启动倒计时、新模式唤醒。
4. **内存效果实测**（验证 D1 真卸载是否生效）：用任务管理器观察，4 个 webview 全部休眠后，应用内存应较活跃态明显下降（预期降 200-400MB）。若内存几乎不降，说明 `loadURL('about:blank')` 未真正释放，需排查。
5. 最小等价检查（若长延迟等待不可行）：临时把各 `HIBERNATE_DELAY_*_MS` 调到 30s 测完再改回，或在 dev 控制台手动调用 `useAppStore.getState().webviewRefs.get('<modelId>')?.suspend()` 触发。

## 风险评估

- **最高风险：白屏回归**。已通过 12 种真值表 + 覆盖层渲染顺序 + 白名单第 4 项三重防御。实施时必须逐 case 在 dev 中实测，不可只靠推演（cc975a5 教训）。D1 引入 `loadURL('about:blank')` 后，休眠态 webview 的 src 实际变为 `about:blank`，需复核真值表 case 7-12 在「src 已是 about:blank」下的可见性/覆盖层一致性。
- **中风险：唤醒后页面状态丢失**。`loadURL` 重载页面，SPA 对话上下文（非草稿部分）丢失。这是休眠机制固有代价，用户已接受（D2）。
- **中风险：SummaryPage/QuickPage 调度器新增**。两页原本无休眠逻辑，新增调度器需确保与现有文本携带、总结抓取等流程无时序冲突。QuickPage 的 `handleModelChange` 文本携带在切换瞬间同步完成，5 分钟后才休眠，无冲突；SummaryPage 须白名单覆盖总结/抓取进行中。
- **中风险：主窗口 hide/show IPC 新增**（R4）。需端到端同步 IPC 契约（main 广播 + preload 暴露 + renderer 监听），漏同步任一层会导致关闭后不休眠或唤醒失效。
- **低风险：key schema**。采用原始版 `modelId`，与 main `getRefCallback` 注册键零适配，已识别。
- **低风险：定时器泄漏**。各调度器均有卸载清理 useEffect，移植后确认 `hibernateTimersRef` 在页面卸载、productMode 切换、插槽数变化、窗口 hide/show 时都正确清理。

## 后续步骤建议

1. 本文档评审通过后，进入 Plan Mode 出实施计划（精确到各文件改动 diff 草案）。
2. 实施按片段顺序：**A（WebviewCard 补 loadURL + 覆盖层）→ B（MainPage modelId 调度器 + 5min + 白名单 4 项）→ B'（主窗口 hide/show IPC + 15min）→ D（SummaryPage 10min 调度器）→ E（QuickPage 5min 旧模型调度器）**，每步 lint + build。
3. dev 验证按真值表逐 case + 各场景延迟覆盖 + 内存实测。
4. 完成后运行 `python .memory/session_log.py` 记录，若白屏防御与真卸载经验稳定则提升进 `.memory/KNOWLEDGE.md`。

## 关联

- 保护分支：`recover-hibernation`（指向 `eb4791d`）。
- 白屏回归修复：`cc975a5`（已在 main）。
- 内存策略决策：`SESSION_LOG.md` 行 125-134、`.memory/KNOWLEDGE.md` 第 79 条。
