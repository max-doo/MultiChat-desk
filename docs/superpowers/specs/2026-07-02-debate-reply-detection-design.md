> Created: 2026-07-02 11:37 (UTC+8)

# 辩论模式回复检测修复 — 设计方案

## 1. 问题与目标

### 根因
`getResponseFromSlot`（`src/renderer/src/store/appStore.ts:1149-1163`）只用「连续两次读取内容相同」判定回复完成，没有与发送前的状态对比。发送后新回复尚未渲染时，DOM 里仍是上一轮旧回复，连续两次读到同一份旧文本即满足「稳定」条件，于是把**旧回复当成新回复**记下并立刻发下一轮 —— 表现为「没检测到是否真有回复就开始发送」。`WebviewCard.sendMessage` 在「点发送」即 resolve、不保证对方已回复，进一步放大了这个问题。

相关代码位置：
- `src/renderer/src/hooks/useDebateRunner.ts:runNextTurn`（38-71）：发送→读回复→记录→推进。
- `src/renderer/src/store/appStore.ts:1149-1163`：`getResponseFromSlot` 轮询逻辑。
- `src/renderer/src/components/WebviewCard.tsx:448` / `726`：`sendMessage`（点发送即返回）、`getLatestResponse`（抓 DOM 最新回复气泡）。

### 目标
辩论每一轮必须**等到对方真正产生新回复**（与发送前基线不同）且**生成稳定**后才记录并推进；超时未出现新回复则**中止整场辩论**，绝不拿旧回复凑数。

## 2. 改动边界

只动两层，不碰 main / preload / IPC / 选择器 / 总结链路：

- `src/renderer/src/store/appStore.ts` — 改造 `getResponseFromSlot`。
- `src/renderer/src/hooks/useDebateRunner.ts` — 取基线、传参、空回复时中止。

`getResponseFromSlot` 目前只被辩论 hook 调用（已用 grep 确认无其他调用点），改签名安全。Webview 注入脚本、`getLatestResponse`、选择器配置**不动**。

## 3. 数据流（修复后单轮）

```
runNextTurn()
  ├─ sendToSlot(slot, prompt)                 // 点发送，success 仅代表提交成功
  ├─ if !sendRes.success → setDebatePhase('finished')，return
  ├─ baseline = await ref.getLatestResponse() // ★ 新增：发送后立即取基线（此刻新回复还没渲染，基线=旧回复或空）
  ├─ speech = await getResponseFromSlot(slot, 120000, baseline)  // ★ 传入 baseline
  ├─ if !speech → setDebatePhase('finished')，return   // ★ 空回复即中止，不再 append+advance
  ├─ appendDebateSpeech(round, turn, speech)
  └─ advanceDebateTurn() → setTimeout(runNextTurn, 600)
```

关键时序：**基线在 `sendToSlot` resolve 之后、`getResponseFromSlot` 之前取**。此时点发送已触发但对方新回复尚未渲染，`getLatestResponse()` 读到的正是「上一轮旧回复 / 空」，这正是要排除的基线。

## 4. `getResponseFromSlot` 改造（appStore.ts）

### 新签名
```ts
getResponseFromSlot: async (
  slotIndex: number,
  timeoutMs = 120000,
  baseline?: string        // ★ 新增可选参数
) => Promise<string>
```

### 新逻辑（替换 appStore.ts:1149-1163）
```ts
getResponseFromSlot: async (slotIndex, timeoutMs = 120000, baseline) => {
  const { webviewRefs } = get()
  const ref = webviewRefs.get(`slot-${slotIndex}`)
  if (!ref) return ''
  const base = (baseline ?? '').trim()
  const deadline = Date.now() + timeoutMs
  const pollInterval = 500
  const stableThreshold = 3            // 连续 3 次相同 ≈ 1.5s 无变化
  let last = ''
  let stableCount = 0
  let sawNew = false                   // 是否出现过与基线不同的内容

  while (Date.now() < deadline) {
    const cur = (await ref.getLatestResponse().catch(() => '')).trim()

    if (cur && cur !== base) {
      sawNew = true                    // 新回复已出现
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

  // 超时：到 deadline 仍未稳定 → 一律返回空，交由 hook 中止辩论
  return ''
}
```

### 行为说明
- **baseline 缺省（向后兼容）**：不传时 `base=''`，任何非空 `cur` 都算「新回复」，退化成原逻辑但增加了稳定计数（更保守），不影响潜在的其他调用方。
- **baseline 存在**：必须先观察到 `cur !== base` 才进入稳定判定，从根本上排除「旧回复被当成新回复」。
- **超时语义**：到 deadline 仍未稳定 → 返回 `''`，交由 hook 中止辩论。
- **超时拉长到 120s**、轮询降到 500ms：原 30s 对慢模型太短，会把流式生成截断成半截；120s 覆盖绝大多数模型一轮回复。

## 5. `useDebateRunner` 改造（useDebateRunner.ts）

### 改动点 1：取基线并传参（替换 runNextTurn 内 53-63 行附近）
```ts
const sendRes = await store.sendToSlot(slotIndex, prompt)
if (abortRef.current || useAppStore.getState().debateState.phase !== 'running') return
if (!sendRes.success) {
  store.setDebatePhase('finished')
  return
}

// ★ 新增：发送后取基线（此刻新回复尚未渲染）
const baselineRef = useAppStore.getState().webviewRefs.get(`slot-${slotIndex}`)
const baseline = baselineRef ? await baselineRef.getLatestResponse().catch(() => '') : ''

const speech = await store.getResponseFromSlot(slotIndex, 120000, baseline)
if (abortRef.current || useAppStore.getState().debateState.phase !== 'running') return

// ★ 空回复 → 中止辩论，不再 append '（无回复）' + advance
if (!speech || !speech.trim()) {
  store.setDebatePhase('finished')
  return
}

store.appendDebateSpeech(currentRound, currentTurn, speech)
store.advanceDebateTurn()
```

### 改动点 2
原 `appendDebateSpeech(..., speech || '（无回复）')` 的 `|| '（无回复）'` 兜底删除 —— 空回复现在直接中止，不再写占位回合。

## 6. 错误处理

| 情况 | 修复前 | 修复后 |
|---|---|---|
| 新回复未出现，DOM 仍是旧回复 | 误判旧回复为新回复，继续发下一轮 | 等到超时 → 返回空 → `setDebatePhase('finished')` 中止 |
| 新回复流式生成中 | 30s 截断成半截，继续发下一轮 | 120s 内等稳定；超时仍返回空 → 中止 |
| `sendToSlot` 失败 | 已中止（不变） | 不变 |
| `getLatestResponse` 抛错 | `.catch(()=>')'` 静默，可能误判 | 同样 catch，但必须先 `sawNew` 才算，不会把空读当成稳定 |
| 用户 pause/stop | `abortRef` + phase 检查已处理（不变） | 不变 |

## 7. 测试（手动，遵循项目规范）

项目无自动化测试，按 `lint → build → dev` 验证：

1. `npm run lint` + `npm run build` 通过。
2. `npm run dev`，辩论模式设 2 个平台（建议一个快回复如 ChatGPT、一个慢/会思考如 Gemini 或 DeepSeek）。
3. **正常流**：跑 3 轮，确认每轮记录的是当轮新回复而非上一轮旧回复；UI 回合内容递进。
4. **无回复流**：手动让某平台在发送后无法回复（如断网或平台卡住），确认辩论在该轮超时后 `finished`，而非拿旧回复继续空转。
5. **慢生成流**：让回复 >30s 的平台跑一轮，确认不会被截断、能完整记录。
6. **pause/resume/stop**：中途操作，确认不串回合、不泄漏 timer。

无法在开发机独立验证的项（如特定平台账号态）会在任务结束时说明并给最小等价检查。

## 8. 风险与回滚

- **风险**：120s 超时让单场辩论在异常情况下最长多等；可接受，因为异常本就该中止。
- **风险**：基线取的是 `getLatestResponse()` 全量文本，若某平台在「点发送后、新回复前」会先插入一条用户消息气泡改变 DOM，可能让基线与「旧回复」不一致 —— 但这反而让 `cur !== base` 更早成立，偏向「等新回复」安全侧，不会误判旧回复为新回复。
- **回滚**：改动只涉及 2 个文件、纯渲染层逻辑，git revert 即可全量回滚，无数据/IPC/选择器影响。
