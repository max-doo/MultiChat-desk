# Webview 休眠机制移植评估

> Created: 2026-07-02 10:53 (+08:00)

## 背景与目标

项目历史上曾实现一套 webview 休眠机制（commit `eb4791d`，10 分钟无活动后 `suspend()` 将 webview 导航到 `about:blank` 以释放渲染进程占用的活跃内存，唤醒时 `resume()` 重新加载原 URL 并恢复草稿）。该提交当时处于一条悬空开发线上，未被任何分支引用，已于本次会话通过 `git branch recover-hibernation eb4791d` 建立保护分支，对象已永久安全。

但 `eb4791d` 是一个 merge commit，整体 diff 含 39 文件 / +683 / -9494，其中大量是已删除的 `.agent/`、`.trae/` 目录与 `.memory/` 早期初始化文件，**不能整体 cherry-pick 回 main**。此外，该休眠实现后来引发了 webview 永久白屏回归（commit `cc975a5` 已修复），而修复引入的 `readonlySnapshot` / `urlMismatch` 可见性门控在 main 上已与休眠逻辑共存于 `WebviewCard.tsx` 的同一段 `className`，二者若直接合并会再次踩坑。

本文档的目标：评估「将 `eb4791d` 的休眠逻辑选择性移植回当前 main」所需的适配点、风险与验证方案，**不直接改代码**，为后续实施提供可审阅的依据。

## 参考实现位置（recover-hibernation 分支 / eb4791d）

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

- **关键差异 1 — ref 注册的 key schema 不同**：
  - recovery 用 `${productMode}-${i}` 作为休眠调度 key，并在 `executeHibernate` 内 `key.split('-')` → `[mode, indexStr]` 再查 `webviewRefs.get(key)`。
  - main 的 `getRefCallback`（行 75-94）把 ref 同时注册到 **`slot-${slotIndex}`** 和 **`model.id`** 两个键，**没有 `${productMode}-${i}` 这个键**。
  - 后果：若照搬 recovery 的 `executeHibernate`，`'slot-0'.split('-')` → `['slot','0']`，`modeModels['slot']` 为 `undefined` → 直接 return，休眠永不触发。**必须重写 key 解析**，改用 `slot-${i}` 或 `model.id` 查 ref。
- **关键差异 2 — main 已有 `mountedWebviews` / `prevSlotModelIds` 跟踪机制**（行 251-312），语义与 recovery 的 `prevDisplayedIdsRef` 部分重叠（都跟踪「哪些 slot 曾挂载过」）。recovery 的 `prevDisplayedIdsRef` 用于判定「不再显示的模型启动休眠倒计时」。main 的 `mountedWebviews` 是「只增不减」地保留所有曾挂载的 webview（这正是 KNOWLEDGE.md 第 79 条记录的「隐藏未销毁的 webview」内存来源）。移植时 `prevDisplayedIdsRef` 的逻辑可复用 `mountedWebviews` 的 Set，但要区分「曾挂载」与「当前应休眠」两个语义。
- 白名单字段全部存在且语义一致：`state.activeModels`（appStore.ts:317）、`state.monitor?.isMonitoring`（appStore.ts:340）、`state.isSending`（appStore.ts:313）。**白名单逻辑可直接移植，无需适配。**
- `productMode` / `displayedModels` / `isActive` / `modeModels` 均存在，结构一致。

## 三个移植片段与适配点

### 片段 A — WebviewCard 休眠能力（suspend/resume/isHibernated + 状态 + 覆盖层 UI）

**可几乎原样移植**，与现有 state 无耦合：

- 新增 state：`isHibernated`、`hibernatedUrlRef`、`hibernatedDraftRef`、`isResumingRef`。
- `suspend`/`resume`/`isHibernated` 三方法加入 `useImperativeHandle` 的返回对象，并同步更新 `WebviewCardRef` 类型定义。
- `resume` 内恢复草稿依赖 `generateGetInputTextScript` / `generateInsertTextScript` / `selectors` / `isReady` —— 这些在 main 的 WebviewCard 内均已存在（自动化注入链路），需确认 import 与变量名一致后再搬。
- 休眠覆盖层 UI（`bedtime` 图标 + 唤醒按钮）原样新增，放在现有 `readonlySnapshot` 覆盖层与 `loadError` 覆盖层之后、`<webview>` 之前。

**唯一需要改的：webview 可见性 className 必须合并两套 invisible 逻辑**（见下方真值表）。recovery 原文是：

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

**需要重写 key 解析，其余可移植**：

- `HIBERNATE_DELAY_MS`、`hibernateTimersRef`、`lastActiveTimeRef` 原样新增。
- `clearHibernateTimer` 原样移植。
- `executeHibernate` / `wakeWebview` 内的 **key→ref 查找必须重写**：放弃 `key.split('-')` + `modeModels[mode][index]`，改为直接用 `slot-${i}` 查 `webviewRefs.get('slot-' + i)`（或传 `model.id` 进来）。建议调度 key 直接采用 main 已有的 `slot-${i}`，与 `getRefCallback` 注册键对齐。
- 白名单三检查（`activeModels.length` / `monitor.isMonitoring` / `isSending`）原样移植。
- `scheduleHibernate` 原样移植。
- 两个 useEffect（`displayedModels` 变化、`isActive` 变化）的依赖数组需核对：main 的 `displayedModels` 是 `useMemo`（行 240），`productMode` 来自 store，`isActive` 是 props —— 依赖项一致，可移植。但「不再显示的模型启动倒计时」的判定，建议复用 main 已有的 `mountedWebviews` Set 差集，而非再引入 `prevDisplayedIdsRef`，避免双份跟踪状态。
- 卸载清理 useEffect 原样移植。

### 片段 C — 不移植的部分

- `eb4791d` 的 `.agent/`、`.trae/` 目录删除、`.memory/` 早期初始化、docs 新增 —— 全部不移植。
- recovery 的 `src={isHibernated ? 'about:blank' : 'about:blank'}` 这种「三元两侧同值」写法不移植（main 已是 `src="about:blank"`，保持不变；休眠改的是 className 可见性 + 由 `suspend` 不主动 `loadURL('about:blank')`，而是靠 `isHibernated` 门控 hide —— **此处需决策，见下方开放问题 1**）。

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

## 开放问题（需用户/实施前确认）

1. **休眠时 webview 的 src 处理**：recovery 的 `suspend` 实现里**并没有调用 `loadURL('about:blank')`**（注释说「导航到 about:blank」但代码只 `setIsHibernated(true)`，靠 className `invisible` 隐藏 + 不再交互）。这意味着 webview 渲染进程**并未真正销毁/卸载**，只是视觉隐藏 —— 这与 KNOWLEDGE.md 第 79 条「隐藏未销毁的 webview 仍占完整渲染进程」的内存结论一致，**休眠并不省渲染进程内存**，只省了 SPA 的活跃 JS 执行/网络轮询。若目标是真正释放渲染进程，`suspend` 需额外 `webview.loadURL('about:blank')` 或 `<webview>` 卸载（后者会丢登录态外的页面状态，且与 `persist:shared` session 无关）。**需明确休眠的内存目标**：仅降活跃度（现状）vs 真正释放进程（需改 suspend）。

2. **休眠与 `mountedWebviews` 内存策略的关系**：KNOWLEDGE.md 记录用户曾决策「webview 销毁策略选全部保留现状，保留会话连续性，牺牲内存」。休眠机制是「不销毁但降活跃」，与该决策一致。但若 case 1 的真目标是省渲染进程内存，则与「保留会话连续性」冲突（唤醒需重新 loadURL，页面状态丢失，仅靠草稿 + persist:shared 登录态恢复）。需确认用户是否接受「唤醒后页面回到 URL 初始态、草稿恢复」这一折中。

3. **白名单第 4 项（回溯态跳过休眠）**：见 case 10-12 决策，建议加入，待确认。

4. **HIBERNATE_DELAY_MS 是否可配置**：recovery 硬编码 10 分钟。是否需要进 electron-store 配置？建议先硬编码，后续按需配置化。

## 验证方案

移植完成后按 AGENTS.md 流程：

1. `npm run lint` — 0 errors。
2. `npm run build` — 类型检查 + 打包通过。
3. `npm run dev` 手动验证，重点覆盖真值表 case：
   - Case 1：正常对话，webview 可见、无覆盖层。
   - Case 7：打开应用后**不操作**等待 10 分钟（或临时把 `HIBERNATE_DELAY_MS` 调小到 30s 测），确认休眠覆盖层出现、webview 隐藏、点击「立即唤醒」后 URL+草稿恢复。
   - Case 4：回溯历史且 URL 不符，快照覆盖层显示，且此时不应触发休眠（白名单第 4 项）。
   - 唤醒后发送消息、监控、活动会话期间确认不被休眠（白名单 1-3）。
   - 切换 productMode 后，旧模式 webview 启动倒计时、新模式唤醒。
   - 关闭主窗口（hide）后再显示，确认休眠定时器行为符合预期（recovery 的 `isActive` useEffect 会处理）。
4. 最小等价检查（若 10 分钟等待不可行）：临时改 `HIBERNATE_DELAY_MS = 30 * 1000` 测完再改回，或在 dev 控制台手动调用 `useAppStore.getState().webviewRefs.get('slot-0')?.suspend()` 触发。

## 风险评估

- **最高风险：白屏回归**。已通过 12 种真值表 + 覆盖层渲染顺序 + 白名单第 4 项三重防御。实施时必须逐 case 在 dev 中实测，不可只靠推演（cc975a5 教训）。
- **中风险：唤醒后页面状态丢失**。`loadURL` 会重载页面，SPA 的对话上下文（非草稿部分）丢失。这是休眠机制的固有代价，需用户接受（开放问题 2）。
- **低风险：key schema 不匹配**。已识别，移植时重写 `executeHibernate`/`wakeWebview` 的 ref 查找即可。
- **低风险：定时器泄漏**。recovery 已有卸载清理 useEffect，移植后确认 `hibernateTimersRef` 在 MainPage 卸载、productMode 切换、插槽数变化时都正确清理。

## 后续步骤建议

1. 本文档评审通过后，进入 Plan Mode 出实施计划（精确到 WebviewCard/MainPage 的代码改动 diff 草案）。
2. 实施按片段 A → B 顺序，每步 lint + build。
3. dev 验证按真值表逐 case 覆盖。
4. 完成后运行 `python .memory/session_log.py` 记录，若白屏防御经验稳定则提升进 `.memory/KNOWLEDGE.md`。

## 关联

- 保护分支：`recover-hibernation`（指向 `eb4791d`）。
- 白屏回归修复：`cc975a5`（已在 main）。
- 内存策略决策：`SESSION_LOG.md` 行 125-134、`.memory/KNOWLEDGE.md` 第 79 条。
