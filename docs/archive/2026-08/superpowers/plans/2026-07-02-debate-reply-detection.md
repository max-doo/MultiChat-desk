# 辩论模式回复检测修复 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修复辩论模式在未真正检测到对方新回复时即推进下一轮发送的缺陷，改为「基线快照 + 变化后稳定」判定，超时无新回复则中止整场辩论。

**Architecture:** 改造 `appStore.getResponseFromSlot` 增加可选 `baseline` 参数，轮询必须先观察到与基线不同的新内容、再连续稳定若干次才返回；超时一律返回空。`useDebateRunner.runNextTurn` 在 `sendToSlot` 成功后取基线传入，空回复时 `setDebatePhase('finished')` 中止而非写占位回合继续推进。仅动渲染层 2 个文件，不碰 main/preload/IPC/选择器/总结链路。

**Tech Stack:** TypeScript (strict), React 18, Zustand 4, Electron 28 Webview。

## Global Constraints

- 包管理器固定 npm，禁止其他。
- 严格 TypeScript，禁止 `any` 静默错误；故意未用变量以 `_` 前缀。
- **禁止擅自切分支**：只在当前分支工作，不创建/切换/删除分支。
- 项目无自动化测试运行器；验证 = `npm run lint` → `npm run build` → `npm run dev` 手动验证。
- IPC 契约不变（本修复不涉及 IPC）。
- 改动前先检索现有实现，避免重复实现；不顺手重构无关代码。
- 设计依据：`docs/superpowers/specs/2026-07-02-debate-reply-detection-design.md`。

## File Structure

| 文件 | 职责 | 改动类型 |
|---|---|---|
| `src/renderer/src/store/appStore.ts` | `getResponseFromSlot` 类型声明(333) + 实现(1149-1163) | Modify |
| `src/renderer/src/hooks/useDebateRunner.ts` | `runNextTurn` 取基线、传参、空回复中止(53-64) | Modify |

无新增文件。两个文件各自单一职责不变，仅修改既有函数体。

---

### Task 1: 改造 `getResponseFromSlot` 类型声明

**Files:**
- Modify: `src/renderer/src/store/appStore.ts:333`

**Interfaces:**
- Produces: `getResponseFromSlot: (slotIndex: number, timeoutMs?: number, baseline?: string) => Promise<string>` —— Task 2 实现需与此签名一致；Task 3 调用方传第三参。

- [ ] **Step 1: 修改类型声明**

打开 `src/renderer/src/store/appStore.ts`，定位第 333 行：

```ts
  getResponseFromSlot: (slotIndex: number, timeoutMs?: number) => Promise<string>
```

改为：

```ts
  getResponseFromSlot: (slotIndex: number, timeoutMs?: number, baseline?: string) => Promise<string>
```

- [ ] **Step 2: 类型检查确认声明改动无破坏**

Run: `npx tsc --noEmit -p tsconfig.web.json.json 2>nul || npm run build`
Expected: 不因该行报错（实际用 `npm run build` 覆盖，见 Step 2 完整版）。

更稳妥：直接跑完整 build。

Run: `npm run build`
Expected: 类型检查通过、打包成功；若仅因本行签名扩展导致调用点（仅 `useDebateRunner.ts:60` 当前只传 2 参）报错——不会报错，因为新参可选。

- [ ] **Step 3: Commit**

```bash
git add src/renderer/src/store/appStore.ts
git commit -m "refactor(debate): extend getResponseFromSlot signature with baseline param"
```

---

### Task 2: 改造 `getResponseFromSlot` 实现为基线对比轮询

**Files:**
- Modify: `src/renderer/src/store/appStore.ts:1149-1163`

**Interfaces:**
- Consumes: Task 1 的新签名。
- Produces: 行为——传 `baseline` 时必须先观察到 `cur !== base` 才进入稳定判定；超时返回 `''`；默认 `timeoutMs=120000`、`pollInterval=500`、`stableThreshold=3`。

- [ ] **Step 1: 替换实现**

定位 `src/renderer/src/store/appStore.ts:1149-1163`，当前为：

```ts
  getResponseFromSlot: async (slotIndex, timeoutMs = 8000) => {
    const { webviewRefs } = get()
    const ref = webviewRefs.get(`slot-${slotIndex}`)
    if (!ref) return ''
    const deadline = Date.now() + timeoutMs
    let last = ''
    // 轮询：等回复稳定（与 monitor 思路一致，但只针对单槽位、轻量）
    while (Date.now() < deadline) {
      const cur = await ref.getLatestResponse().catch(() => '')
      if (cur && cur.trim().length > 0 && cur === last) break
      last = cur
      await new Promise((r) => setTimeout(r, 1000))
    }
    return last
  },
```

整段替换为：

```ts
  getResponseFromSlot: async (slotIndex, timeoutMs = 120000, baseline) => {
    const { webviewRefs } = get()
    const ref = webviewRefs.get(`slot-${slotIndex}`)
    if (!ref) return ''
    const base = (baseline ?? '').trim()
    const deadline = Date.now() + timeoutMs
    const pollInterval = 500
    const stableThreshold = 3 // 连续 3 次相同 ≈ 1.5s 无变化
    let last = ''
    let stableCount = 0
    let sawNew = false // 是否出现过与基线不同的内容
    while (Date.now() < deadline) {
      const cur = (await ref.getLatestResponse().catch(() => '')).trim()
      if (cur && cur !== base) {
        sawNew = true
      }
      if (sawNew) {
        // 进入「等稳定」阶段：连续 stableThreshold 次相同即完成
        if (cur && cur === last) {
          stableCount++
          if (stableCount >= stableThreshold) return cur
        } else {
          stableCount = 0
        }
      }
      // sawNew 仍为 false 时：继续等新回复出现，不记稳定
      last = cur
      await new Promise((r) => setTimeout(r, pollInterval))
    }
    // 超时：到 deadline 仍未稳定 → 一律返回空，交由调用方中止
    return ''
  },
```

- [ ] **Step 2: Lint**

Run: `npm run lint`
Expected: 无新增错误（无 `any`、无未用变量；`baseline` 已被使用）。

- [ ] **Step 3: Build**

Run: `npm run build`
Expected: 类型检查通过、打包成功。

- [ ] **Step 4: Commit**

```bash
git add src/renderer/src/store/appStore.ts
git commit -m "fix(debate): require new-reply baseline before settling in getResponseFromSlot"
```

---

### Task 3: 改造 `useDebateRunner.runNextTurn` 取基线并空回复中止

**Files:**
- Modify: `src/renderer/src/hooks/useDebateRunner.ts:53-64`

**Interfaces:**
- Consumes: Task 2 的 `getResponseFromSlot(slotIndex, timeoutMs, baseline)`；`useAppStore.getState().webviewRefs.get(\`slot-${slotIndex}\`)` 返回的 ref 暴露 `getLatestResponse(): Promise<string>`（已存在于 `WebviewCard.tsx:726`）。
- Produces: 辩论单轮在空回复时 `setDebatePhase('finished')` 中止，不再写占位回合。

- [ ] **Step 1: 替换 runNextTurn 中发送→记录段落**

定位 `src/renderer/src/hooks/useDebateRunner.ts:53-64`，当前为：

```ts
    // 发送 + 等待回复
    const sendRes = await store.sendToSlot(slotIndex, prompt)
    if (abortRef.current || useAppStore.getState().debateState.phase !== 'running') return
    if (!sendRes.success) {
      // 发送失败：标记 finished 并通知（通知由 UI 层读 phase 处理）
      store.setDebatePhase('finished')
      return
    }
    const speech = await store.getResponseFromSlot(slotIndex, 30000)
    if (abortRef.current || useAppStore.getState().debateState.phase !== 'running') return

    store.appendDebateSpeech(currentRound, currentTurn, speech || '（无回复）')
    store.advanceDebateTurn()
```

整段替换为：

```ts
    // 发送 + 等待回复
    const sendRes = await store.sendToSlot(slotIndex, prompt)
    if (abortRef.current || useAppStore.getState().debateState.phase !== 'running') return
    if (!sendRes.success) {
      // 发送失败：标记 finished 并通知（通知由 UI 层读 phase 处理）
      store.setDebatePhase('finished')
      return
    }
    // 发送后立即取基线：此刻新回复尚未渲染，getLatestResponse 读到的是上一轮旧回复或空，
    // 作为「必须出现与之不同的新内容」的参照，避免把旧回复误判为新回复。
    const baselineRef = useAppStore.getState().webviewRefs.get(`slot-${slotIndex}`)
    const baseline = baselineRef ? await baselineRef.getLatestResponse().catch(() => '') : ''
    if (abortRef.current || useAppStore.getState().debateState.phase !== 'running') return

    const speech = await store.getResponseFromSlot(slotIndex, 120000, baseline)
    if (abortRef.current || useAppStore.getState().debateState.phase !== 'running') return

    // 空回复（超时未出现新回复或未稳定）→ 中止辩论，不再写占位回合继续推进
    if (!speech || !speech.trim()) {
      store.setDebatePhase('finished')
      return
    }

    store.appendDebateSpeech(currentRound, currentTurn, speech)
    store.advanceDebateTurn()
```

- [ ] **Step 2: Lint**

Run: `npm run lint`
Expected: 无新增错误。

- [ ] **Step 3: Build**

Run: `npm run build`
Expected: 类型检查通过、打包成功。注意 `baselineRef` 类型来自 `webviewRefs` 的 value（`WebviewCardRef`），其 `getLatestResponse` 已在接口定义（`WebviewCard.tsx:120`），类型可用。

- [ ] **Step 4: Commit**

```bash
git add src/renderer/src/hooks/useDebateRunner.ts
git commit -m "fix(debate): abort round on no-reply instead of recording stale placeholder"
```

---

### Task 4: 端到端手动验证（dev 环境）

**Files:** 无代码改动，仅运行验证。

**Interfaces:** 消费 Task 1-3 全部产物。

- [ ] **Step 1: 启动 dev**

Run: `npm run dev`
Expected: Electron 窗口打开，无控制台报错。

- [ ] **Step 2: 正常流验证**

辩论模式配置 2 个平台（建议一快一慢，如 ChatGPT + Gemini/DeepSeek），输入主题，启动辩论，观察 3 轮。
Expected: 每轮记录的是当轮新回复；UI 回合内容逐轮递进，不出现「上一轮旧回复被记成本轮」。

- [ ] **Step 3: 无回复/超时中止验证**

在某一轮发送后，人为让目标平台无法回复（如断网、或切走该 webview 让其暂停），等待至超时。
Expected: 辩论在该轮 `finished`，而非拿旧回复继续空转下一轮；UI 显示结束态。

- [ ] **Step 4: 慢生成验证**

让回复耗时 >30s 的平台跑一轮。
Expected: 不被截断，能完整记录该轮回复（120s 内稳定后返回）。

- [ ] **Step 5: pause/resume/stop 验证**

辩论运行中分别操作 pause→resume、stop。
Expected: 不串回合、不泄漏 setTimeout（`timerRef` 正常清理）。

- [ ] **Step 6: 记录验证结果**

若以上任一项无法在本机独立完成（如缺某平台账号态），在该任务结束时明确说明原因并列出最小等价检查步骤。无需 commit（仅验证）。

---

## Self-Review

**1. Spec coverage:**
- 第 1 节根因/目标 → Task 2+3 的基线对比 + 空回复中止覆盖。✓
- 第 2 节改动边界（仅 appStore + useDebateRunner）→ File Structure 表一致。✓
- 第 3 节数据流（sendToSlot→取基线→getResponseFromSlot(baseline)→空则中止→append+advance）→ Task 3 Step 1 代码逐行对应。✓
- 第 4 节 getResponseFromSlot 新签名 + 新逻辑 → Task 1(签名) + Task 2(逻辑)。✓
- 第 5 节 useDebateRunner 取基线 + 删 `|| '（无回复）'` → Task 3。✓
- 第 6 节错误处理矩阵 → Task 2(sawNew 防旧回复/超时返回空) + Task 3(空回复中止) + Task 4(手动验证各情形)。✓
- 第 7 节手动测试流程 → Task 4。✓
- 第 8 节风险与回滚 → 仅 2 文件、纯渲染层，与 File Structure 一致。✓

**2. Placeholder scan:** 无 TBD/TODO/"add error handling" 等占位；每步含完整代码或确切命令。✓

**3. Type consistency:** `getResponseFromSlot` 签名 `(slotIndex, timeoutMs?, baseline?)` 在 Task 1 声明、Task 2 实现参数列表 `async (slotIndex, timeoutMs = 120000, baseline)`、Task 3 调用 `getResponseFromSlot(slotIndex, 120000, baseline)` 三处一致。`baselineRef.getLatestResponse()` 返回 `Promise<string>`，与 Task 2 内 `ref.getLatestResponse()` 同源（`WebviewCard.tsx:726`）。✓
