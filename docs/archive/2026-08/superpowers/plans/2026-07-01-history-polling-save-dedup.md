# 会话轮询保存去重优化 Implementation Plan

> Created: 2026-07-01 21:59 (+08:00)

> **实施状态（2026-07-02 审核 + 落地）**：本计划经代码核查后调整实施：
> - **Task 1 已舍弃**：`updatePlatformAnswer` 在整个 `src/` 中无任何调用方（仅类型声明 + 定义），是死代码路径。其前提“网络流式高频调用 `updatePlatformAnswer` 写盘”不成立——实际内容流是 `pollPlatforms` 每 3s 调 `getLatestResponse()` 轮询爬 DOM。优化死路径零收益，故不改。
> - **Task 2 已实施**：`anyChanged` 脏标记 + 完成分支显式写终态。补充了原计划遗漏的 `!ref` 分支 `anyChanged = true`（完成态翻转需落盘）。
> - **Task 3 已实施并简化**：`stopMonitoring` 兜底写已加；进一步把 `startMonitoring` 重置路径从裸 `clearInterval` 改为调 `stopMonitoring()`（在 `set` 新 turn 之前，`currentConversationId` 仍指向旧会话，可正确定位旧 `historyItem`），真正统一三个停止出口；超时分支去掉冗余 `saveCurrentTurn()` 消除双写。原计划的“Step 3 需核实否则跳过”分支已通过核实（唯一调用点 `appStore.ts:1030` 调用前不改 `monitor.currentConversationId`），照做。
> - 行号已以当前文件为准（计划原文行号偏移约 +5）。
> - 验证：`npm run lint`（0 error，37 均为既有 `no-explicit-any` 警告，无新增）+ `npm run build` 通过。单 commit `9975d25` 合入（两任务在完成路径上耦合，未拆分）。

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 消除"会话监控轮询每次都全量覆盖写盘"的 I/O 放大——内容未变不写、网络流式同内容跳过、完成/停止时显式写一次终态，存储引擎仍沿用 electron-store (JSON)。

**Architecture:** 所有改动局限在渲染层 `src/renderer/src/store/appStore.ts`。引入"本轮是否有平台内容变化"的脏标记，仅变化时落盘；`pollPlatforms` 完成分支与 `stopMonitoring` 兜底分支强制写一次终态；`updatePlatformAnswer` 同内容直接 return。不新增 IPC、不动主进程持久化、不碰分层边界。

**Tech Stack:** TypeScript (strict), Zustand 4, electron-store (JSON, 不变)

## Global Constraints

- 存储引擎保持 electron-store (JSON)，不引入 SQLite 或任何新依赖。
- 改动仅限 `src/renderer/src/store/appStore.ts`；不动 `src/main/ipcHandlers.ts` 的 `store-set` 处理器、不动 `src/preload` IPC 契约。
- 严格遵守分层边界：保存逻辑留在渲染层 store，主进程只做无脑 `store.set`。
- 保留现有停止语义：全部平台稳定完成 / 超时 5 分钟 / 新消息重置 三个出口不变。
- `MONITOR_CONFIG` 常量（`pollIntervalMs: 3000`、`stableThreshold: 3`、`maxMonitorDurationMs: 5*60*1000`）本次不改。
- 历史上限保持 `historyLimit = 100`（commit `ea55c8d` 已落地，本次不动）。
- 验证流程：`npm run lint` -> `npm run build` -> `npm run dev` 手动验证（项目无自动化测试运行器）。

---

## File Structure

| 文件 | 角色 | 改动类型 |
|---|---|---|
| `src/renderer/src/store/appStore.ts` | 唯一改动文件。监控轮询 + 会话保存逻辑全在此 | Modify |

**不新增文件。** 本任务是单一文件内的策略修正，拆成 3 个独立可测、可单独 commit 的任务：

- **Task 1**：`updatePlatformAnswer` 同内容跳过写盘（网络流式去重）。
- **Task 2**：`pollPlatforms` 引入脏标记，仅内容变化才写；完成分支显式写终态。
- **Task 3**：`stopMonitoring` 兜底写终态，保证停止时最后一帧落盘。

三个任务的公共依赖是现有函数签名（见下"Interfaces"），相互独立、可按序也可单独合入。

---

## Interfaces

以下为现有（未改）签名，三个任务都消费它们，本计划不新增任何对外接口：

- `updatePlatformAnswer: (modelId: string, text: string, isComplete?: boolean) => void`
  - 现位置：`appStore.ts:1411`。消费 `monitor.currentTurn.platforms[modelId]`，其中 `PlatformMonitorState` 含 `lastContent: string`、`stableCount: number`、`isComplete: boolean`。
- `pollPlatforms: async () => Promise<void>`
  - 现位置：`appStore.ts:1357`。遍历 `displayedModels`，对每个未完成平台调 `ref.getLatestResponse()`，比对 `state.lastContent`，连续 `stableThreshold` 次不变则 `state.isComplete = true`。
- `saveCurrentTurn: () => void`
  - 现位置：`appStore.ts:1437`。从 `monitor.currentTurn.platforms` 构建 `responses`，更新对应 `HistoryItem.turns`，`set({ history })` + `window.api.storeSet('history', newHistory)`。
- `stopMonitoring: () => void`
  - 现位置：`appStore.ts:1341`。`clearInterval` + 重置 `monitor` 状态。
- `MONITOR_CONFIG`（`appStore.ts:26-30`）：`pollIntervalMs=3000`、`stableThreshold=3`、`maxMonitorDurationMs=300000`。

**Task 间契约**：Task 2 的脏标记是 `pollPlatforms` 内的局部变量，不暴露给其他任务；Task 3 在 `stopMonitoring` 内调 `get().saveCurrentTurn()`，依赖 `saveCurrentTurn` 已存在且对 `monitor.currentTurn === null` 安全（`appStore.ts:1439` 已有 early return）。Task 1/2/3 无执行顺序硬依赖，但建议按序合入以便逐个验证。

---

### Task 1: `updatePlatformAnswer` 同内容跳过写盘

**Files:**
- Modify: `src/renderer/src/store/appStore.ts:1411-1435`（`updatePlatformAnswer` 函数体）

**Interfaces:**
- Consumes: `monitor.currentTurn.platforms[modelId].lastContent`（现有字段）
- Produces: 无新接口；行为变化——同 `text` 不再触发 `saveCurrentTurn()`

**背景**：网络流式推送（如 Gemini 实时流）会高频调用 `updatePlatformAnswer`，当前每次都 `set` + `saveCurrentTurn()` 全量写盘。若推送的 `text` 与上一次相同，写盘纯属冗余。

- [ ] **Step 1: 阅读 `updatePlatformAnswer` 当前实现**

Run: 读 `src/renderer/src/store/appStore.ts` 第 1411-1435 行。
Expected: 看到函数开头取 `const { monitor, saveCurrentTurn } = get()`，校验 `monitor.isMonitoring` 与 `platform`，随后无条件 `set(...)` + `saveCurrentTurn()`。无任何 `text === platform.lastContent` 判断。

- [ ] **Step 2: 修改 `updatePlatformAnswer`，同内容 early return**

将 `appStore.ts:1411-1435` 的 `updatePlatformAnswer` 替换为：

```ts
  updatePlatformAnswer: (modelId: string, text: string, isComplete?: boolean) => {
    const { monitor, saveCurrentTurn } = get()
    if (!monitor.isMonitoring || !monitor.currentTurn) return
    const platform = monitor.currentTurn.platforms[modelId]
    if (!platform) return

    // 同内容跳过：避免网络流式高频推送造成冗余全量写盘
    if (text === platform.lastContent && (isComplete === undefined || isComplete === platform.isComplete)) {
      return
    }

    set({
      monitor: {
        ...monitor,
        currentTurn: {
          ...monitor.currentTurn,
          platforms: {
            ...monitor.currentTurn.platforms,
            [modelId]: {
              ...platform,
              lastContent: text,
              isComplete: isComplete ?? platform.isComplete,
              stableCount: 0 // Reset stable count since it just updated via network
            }
          }
        }
      }
    })
    saveCurrentTurn()
  },
```

要点：
- 跳过条件同时覆盖"内容相同且完成态也没变"——避免 `isComplete` 从 undefined→true 这种语义变化被误跳。
- 只要内容或完成态之一变化，仍走原 `set` + `saveCurrentTurn()` 路径，保证流式终态能落盘。
- **有意行为变化**：原实现每次网络推送无条件 `stableCount: 0`；改后同内容被 early return，**不再重置 `stableCount`**。这是预期行为——若网络推送的内容与上次相同（说明页面真没变化），就不应推迟完成判定，`pollPlatforms` 的 `stableCount` 应继续正常累加直至 `stableThreshold`。即：同内容网络推送不再人为延长稳定等待期。审核时勿误判为 bug。

- [ ] **Step 3: 类型检查与 lint**

Run:
```bash
npm run lint
npm run build
```
Expected: 两条命令均通过，无 `no-explicit-any` / 未使用变量告警，类型检查无误。

- [ ] **Step 4: 手动验证（dev 环境）**

Run: `npm run dev`
验证步骤：
1. 打开桌面应用，进入主页面，选中含网络流式推送的平台（如 Gemini）。
2. 发送一条会触发较长流式回复的消息。
3. 观察控制台 / 磁盘 `config-dev.json` 的 `history` 字段更新频率——应明显低于改动前（改动前每条流式 chunk 都写一次）。
4. 确认最终回复完整保存（流式结束后 `history` 中该 turn 的 `responses` 含完整文本）。
Expected: 流式期间写盘次数显著减少；终态完整。

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/store/appStore.ts
git commit -m "perf(monitor): skip redundant disk write in updatePlatformAnswer when content unchanged"
```

---

### Task 2: `pollPlatforms` 脏标记——仅内容变化才写，完成时写终态

**Files:**
- Modify: `src/renderer/src/store/appStore.ts:1357-1409`（`pollPlatforms` 函数体，尤其 1382-1408 的抓取循环与 1403-1408 的保存/完成分支）

**Interfaces:**
- Consumes: `ref.getLatestResponse()`、`state.lastContent`、`MONITOR_CONFIG.stableThreshold`
- Produces: 无新接口；`pollPlatforms` 行为变化——稳定等待期（内容连续不变）不再每 3 秒全量写盘，仅在内容变化或全部完成时写。

**背景**：`pollPlatforms` 末尾 `get().saveCurrentTurn()`（`appStore.ts:1404`）无条件执行。即使本轮所有平台 `content === lastContent`（只是 `stableCount` 在涨），也会全量覆盖写 history。这是 I/O 放大的主源头。

- [ ] **Step 1: 阅读 `pollPlatforms` 当前实现**

Run: 读 `src/renderer/src/store/appStore.ts` 第 1357-1409 行。
Expected: 看到超时分支（1362-1366）已先 `saveCurrentTurn()` 再 `stopMonitoring()`（正确，不动）；循环里 `if (content !== state.lastContent)` 重置 `stableCount`，否则 `stableCount++` 达阈值置 `isComplete`；循环后无条件 `saveCurrentTurn()`（1404），再 `if (allComplete) stopMonitoring()`（1406-1408）。

- [ ] **Step 2: 引入脏标记，改写保存/完成分支**

将 `appStore.ts:1371-1408`（从 `for` 循环到函数结尾）替换为：

```ts
    let allComplete = true
    let anyChanged = false  // 脏标记：本轮是否有平台内容变化

    for (let index = 0; index < displayedModels.length; index++) {
      const model = displayedModels[index]
      const state = monitor.currentTurn.platforms[model.id]
      if (!state || state.isComplete) continue

      const ref = webviewRefs.get(`slot-${index}`) || webviewRefs.get(model.id)
      if (!ref) {
        state.isComplete = true
        continue
      }

      try {
        const content = await ref.getLatestResponse()

        if (content !== state.lastContent) {
          state.lastContent = content
          state.stableCount = 0
          anyChanged = true
        } else {
          state.stableCount++
          if (state.stableCount >= MONITOR_CONFIG.stableThreshold) {
            state.isComplete = true
            anyChanged = true  // 完成态翻转也视为变化，需落盘
          }
        }
      } catch {
        // 获取失败，不影响其他平台，继续轮询
      }

      if (!state.isComplete) {
        allComplete = false
      }
    }

    // 仅本轮有内容/完成态变化时才落盘，稳定等待期跳过冗余全量写
    if (anyChanged) {
      get().saveCurrentTurn()
    }

    if (allComplete) {
      get().saveCurrentTurn()  // 完成时显式写终态，保证最后一帧落盘
      get().stopMonitoring()
    }
  },
```

要点：
- `anyChanged` 在两种情况置 true：内容变化（`content !== lastContent`）、完成态翻转（`stableCount` 达阈值）。后者确保"某平台刚判定完成"这一状态变化能落盘。
- `allComplete` 分支额外调一次 `saveCurrentTurn()`——即便 `anyChanged` 已触发过写，这里再写一次终态是幂等的，代价仅一次写，换取"最终态必落盘"的确定性。
- 超时分支（1362-1366）保持不动，它已经先写后停。

- [ ] **Step 3: 类型检查与 lint**

Run:
```bash
npm run lint
npm run build
```
Expected: 通过。`anyChanged` 已被使用（无未使用变量告警）。

- [ ] **Step 4: 手动验证（dev 环境）**

Run: `npm run dev`
验证步骤：
1. 主页选 2-3 个模型，发送一条消息。
2. 回复生成期间，观察 `config-dev.json` 的 `history` 写盘频率：稳定等待期（所有平台内容已不变、在等 `stableThreshold`）应**不再**每 3 秒写一次。
3. 等待全部完成（约 9 秒稳定后），确认 `history` 中该 turn 的最终回复完整、且 `updatedAt` 时间戳为完成时刻。
4. 边界验证：仅部分平台完成、另一平台仍在生成时，确认已完成平台的内容已落盘（因 `isComplete` 翻转触发 `anyChanged`）。
Expected: 稳定期写盘停止；终态完整；部分完成的内容也保存。

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/store/appStore.ts
git commit -m "perf(monitor): skip disk write during stable polling, write final state on completion"
```

---

### Task 3: `stopMonitoring` 兜底写终态

**Files:**
- Modify: `src/renderer/src/store/appStore.ts:1341-1355`（`stopMonitoring` 函数体）

**Interfaces:**
- Consumes: `get().saveCurrentTurn()`（现有，对 `monitor.currentTurn === null` 安全——见 `appStore.ts:1439` 的 early return）
- Produces: 无新接口；`stopMonitoring` 行为变化——停止前补写一次当前 turn（若有）。

**背景**：`stopMonitoring` 被三处调用——超时分支（1364，已先写）、完成分支（Task 2 已加写）、新消息重置（`startMonitoring` 内 1305-1307 先 `clearInterval` 但**未写**）。后者意味着用户在上一轮还没判定完成时就发新消息，上一轮的最后一次内容变化可能未落盘。本任务补这个兜底。

- [ ] **Step 1: 确认 `stopMonitoring` 当前实现与其调用点**

Run: 读 `src/renderer/src/store/appStore.ts` 第 1341-1355 行；并 Grep `stopMonitoring` 调用点。
Expected: `stopMonitoring` 仅 `clearInterval` + 重置 `monitor` 状态，无 `saveCurrentTurn()`。调用点：`pollPlatforms` 超时分支（1364）、完成分支（Task 2 改后）、`startMonitoring` 内重置（1306 间接——实为 `clearInterval`，非调 `stopMonitoring`，需确认）。

> 注意：`startMonitoring` 第 1305-1307 是直接 `clearInterval(monitor.intervalId)`，并未调用 `stopMonitoring`。因此新消息重置时不会触发本任务的兜底写。若要覆盖该路径，需在 `startMonitoring` 重置前也补写——见 Step 2 末尾的可选增强。

- [ ] **Step 2: 在 `stopMonitoring` 内补兜底写**

将 `appStore.ts:1341-1355` 的 `stopMonitoring` 替换为：

```ts
  stopMonitoring: () => {
    const { monitor } = get()
    if (monitor.intervalId) {
      clearInterval(monitor.intervalId)
    }
    // 兜底：停止前补写一次当前 turn，防止最后一次内容变化未落盘
    // saveCurrentTurn 对 currentTurn 为 null 时安全 early return
    get().saveCurrentTurn()
    set({
      monitor: {
        isMonitoring: false,
        currentConversationId: null,
        currentTurn: null,
        intervalId: null,
        startTime: 0,
      },
    })
  },
```

要点：
- `saveCurrentTurn()` 必须在 `set` 重置 `monitor.currentTurn = null` **之前**调用，否则拿到 null 直接 return。
- **超时分支统一收口**：原超时分支（1362-1366）是 `saveCurrentTurn()` → `stopMonitoring()`。改后 `stopMonitoring` 内已自带兜底写，若超时分支仍保留 `saveCurrentTurn()` 会造成超时路径双写（`window.api.storeSet` 是真实 IPC 写盘，非免费幂等）。**建议把超时分支改为只调 `stopMonitoring()`**，依赖其内部写，消除双写、统一停止出口。即将 `appStore.ts:1362-1366`：
```ts
    if (Date.now() - monitor.startTime > MONITOR_CONFIG.maxMonitorDurationMs) {
      get().saveCurrentTurn()
      get().stopMonitoring()
      return
    }
```
改为：
```ts
    if (Date.now() - monitor.startTime > MONITOR_CONFIG.maxMonitorDurationMs) {
      get().stopMonitoring()
      return
    }
```
- 此改动与 Task 2 完成分支（`allComplete` 时先 `saveCurrentTurn()` 再 `stopMonitoring()`）风格不同：完成分支保留显式写是因为"写终态"语义更清晰且完成路径写盘次数本就少；超时路径则用统一收口避免双写。两处权衡不同，保留差异。

- [ ] **Step 3: 覆盖 `startMonitoring` 重置路径（需先核实，否则跳过）**

`startMonitoring`（1301-1339）在已有轮询运行时，第 1305-1307 直接 `clearInterval` 后重置，未写上一轮。**但 `saveCurrentTurn` 依赖 `monitor.currentConversationId` 定位 `historyItem`**——若用户发新消息时上层已切换到新会话、`startMonitoring` 收到的 `conversationId` 指向新会话，则此时 `monitor.currentConversationId` 仍是旧值（重置发生在 1330 的 `set` 里，Step 3 补写在它之前，故仍指向旧会话）→ 旧 `historyItem` 可被找到 → 兜底写**可能生效**。

**但存在前提条件**：调用 `startMonitoring` 时，外部代码不能在调它之前先把 `monitor.currentConversationId` 改成新会话（例如通过其它 `set` 提前置位）。这需先核实：

Run: Grep `startMonitoring` 的所有调用点，确认调用时 `monitor.currentConversationId` 仍指向旧会话（即未被提前改写）。

- 若核实通过：将第 1305-1307 改为在 `clearInterval` 前补写：
```ts
    // 如果已有轮询器在运行，先停止并兜底写上一轮
    if (monitor.intervalId) {
      get().saveCurrentTurn()
      clearInterval(monitor.intervalId)
    }
```
- 若核实不通过（`currentConversationId` 已被提前改写，或调用点不可控）：**跳过本步**，保持原 `clearInterval` 不动。在此情况下，未完成的上一轮内容会丢失——需在 Self-Review 风险节明确记录为已知限制，而非假装已覆盖。

> 不要在未核实前盲目加这行：若 `currentConversationId` 已指向新会话，`saveCurrentTurn` 会因找不到旧 `historyItem` 而 early return，兜底写形同虚设，徒增复杂度与误导。

- [ ] **Step 4: 类型检查与 lint**

Run:
```bash
npm run lint
npm run build
```
Expected: 通过。

- [ ] **Step 5: 手动验证（dev 环境）**

Run: `npm run dev`
验证步骤：
1. **停止路径**：发消息触发监控，等回复生成中手动关闭会话或触发停止（如有停止按钮）；确认 `history` 中该 turn 的最后内容已落盘。
2. **新消息重置路径**（若 Step 3 已做）：发消息 A，A 回复生成中（未完成）立即发消息 B；确认 A 的 turn 在 `history` 中保留了生成到那一刻的内容。
3. **超时路径**：构造一个永不完成的场景（如断网），等 5 分钟超时；确认超时分支写盘正常（可能双写，无功能问题）。
Expected: 各停止出口均落盘；无丢数据。

- [ ] **Step 6: Commit**

```bash
git add src/renderer/src/store/appStore.ts
git commit -m "fix(monitor): flush current turn before stopping monitoring to prevent data loss"
```

---

## Self-Review

**1. Spec coverage（对照原始目标）**
- "内容未变不写" → Task 2 的 `anyChanged` 脏标记覆盖（稳定期跳过）。✅
- "网络流式同内容跳过" → Task 1 的 `updatePlatformAnswer` early return。✅
- "完成时显式写终态" → Task 2 的 `allComplete` 分支 + Task 3 的 `stopMonitoring` 兜底。✅
- "存储引擎沿用 JSON" → 全程不碰 electron-store / IPC。✅
- "局限渲染层、不破分层" → 唯一改动文件 `appStore.ts`。✅

**2. Placeholder scan**：无 TBD/TODO；每个 Step 含具体代码或具体命令。✅

**3. Type / 一致性**：
- `anyChanged`、`allComplete` 命名在 Task 2 内一致。✅
- `saveCurrentTurn` 对 `currentTurn === null` 的 early return（`appStore.ts:1439`）是 Task 3 兜底写安全的前提，已在 Task 3 Interfaces 中显式标注。✅
- Task 1 跳过条件 `isComplete === undefined || isComplete === platform.isComplete` 与 `set` 内 `isComplete ?? platform.isComplete` 语义对齐——仅当完成态确有变化时才写。✅
- Task 2 完成分支：`anyChanged` 已写时 `allComplete` 再写一次——经评估为可接受（完成是低频事件，多一次写换取"最终态必落盘"确定性）。✅
- Task 3 超时分支改为只调 `stopMonitoring()`（统一收口、消除双写），与完成分支保留显式写的差异已在 Task 3 要点说明。✅

**4. 风险**：
- 稳定期不再写盘 → 若用户在稳定期（内容已不变但未达 `stableThreshold` 的 ~9 秒内）崩溃，可能丢"最后那一帧"——但该帧内容与上次写盘相同（稳定期定义即内容不变），故无实际数据损失。✅ 可接受。
- Task 1 同内容跳过不再重置 `stableCount` → 行为变化，详见 Task 1 要点。非风险，但需审核者知晓。
- 超时分支改为只调 `stopMonitoring()` → 依赖其内部 `saveCurrentTurn()` 落盘。需确认 `stopMonitoring` 改动（Step 2）与超时分支改动在同一次 commit 内合入，避免中间态超时路径不写盘。
- **`startMonitoring` 重置路径可能未覆盖**（Task 3 Step 3）：若核实不通过而跳过，用户在上一轮未完成时发新消息，上一轮最后内容会丢失。这是已知限制，非缺陷——需在落实时根据核实结果如实记录。
