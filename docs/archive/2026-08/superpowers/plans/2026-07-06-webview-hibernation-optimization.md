# Webview 休眠机制优化与内存控制实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 优化多 Webview 在切换模式、切换模型及主窗口隐藏/关闭到托盘时的休眠（挂起）时间与白名单策略，解决应用闲置和运行中内存占用过大（高达2G）的问题。

**Architecture:** 将处于隐藏状态的 Webview 的休眠延迟从 5 分钟缩短为 30 秒；主页面显示的 Webview 在主窗口隐藏后由 15 分钟改为 5 分钟自动休眠。休眠白名单排除空闲活跃会话（`activeModels` 检查），仅保留真正运行中任务（发送、监控抓取、文件上传、辩论运行中）。在主页面、快捷窗口和总结页面同步应用此优化。

**Tech Stack:** TypeScript (strict), React 18, Zustand, Electron

---

## 拟修改文件

- `src/renderer/src/pages/MainPage.tsx`
- `src/renderer/src/pages/QuickPage.tsx`
- `src/renderer/src/components/SummaryPanel.tsx`

---

### Task 1: 优化主页面 (MainPage.tsx) 的休眠时值与白名单策略

**Files:**
- Modify: `src/renderer/src/pages/MainPage.tsx`

- [ ] **Step 1: 修改休眠延迟常量及添加窗口可见性 Ref 追踪**

修改 `src/renderer/src/pages/MainPage.tsx` 中的常量定义，将 `HIBERNATE_DELAY_MS` 修改为 30 秒，`HIBERNATE_DELAY_HIDE_MS` 修改为 5 分钟，并新增 `isWindowVisibleRef` 用于追踪窗口是否可见。

原代码范围（第 75 至 82 行）：
```typescript
  // R1: 主页面切换模型后，被切走的旧模型 5 分钟后真卸载（D1）
  const HIBERNATE_DELAY_MS = 5 * 60 * 1000 // 5 分钟
  // R4: 主窗口关闭(托盘隐藏)后，显示中的模型 15 分钟后休眠（片段 B'）
  const HIBERNATE_DELAY_HIDE_MS = 15 * 60 * 1000 // 15 分钟
  // 各模型的休眠倒计时定时器；key = model.id
  const hibernateTimersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map())
  // 跟踪上一轮显示的模型 id，用于判定「被切走」启动倒计时 vs「仍显示」保持唤醒
  const prevDisplayedIdsRef = useRef<string[]>([])
```

修改为：
```typescript
  // R1: 主页面切换模型后，被切走的旧模型 30 秒后真卸载（D1）
  const HIBERNATE_DELAY_MS = 30 * 1000 // 30 秒
  // R4: 主窗口关闭(托盘隐藏)后，显示中的模型 5 分钟后休眠（片段 B'）
  const HIBERNATE_DELAY_HIDE_MS = 5 * 60 * 1000 // 5 分钟
  // 各模型的休眠倒计时定时器；key = model.id
  const hibernateTimersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map())
  // 跟踪上一轮显示的模型 id，用于判定「被切走」启动倒计时 vs「仍显示」保持唤醒
  const prevDisplayedIdsRef = useRef<string[]>([])
  // 追踪主窗口是否可见，以便在窗口隐藏时即使在回溯历史态也允许休眠
  const isWindowVisibleRef = useRef<boolean>(true)
```

- [ ] **Step 2: 重构休眠执行策略 (executeHibernate)**

更新 `executeHibernate` 的白名单校验：
1. 移除全局 `state.activeModels.length > 0` 这一长期阻止休眠的空闲对话检查，确保无活动任务的 Webview 能正常休眠；
2. 细化正在运行的活动任务检查，当正在发送消息、监控抓取、进行辩论或文件上传中时，跳过休眠；
3. 回溯历史态（`activeHistoryIdRef.current`）仅在窗口可见时拦截休眠，窗口不可见时（在后台/托盘）同样允许休眠。

原代码范围（第 144 至 178 行）：
```typescript
  // 执行休眠：白名单检查通过后调用 ref.suspend()（D1 真卸载）
  const executeHibernate = useCallback(async (modelId: string) => {
    const state = useAppStore.getState()

    // 白名单 1: 活动会话中的模型不休眠（避免误销毁活跃对话）
    if (state.activeModels.length > 0) {
      console.log(`[MainPage] ${modelId} 处于活动会话中，跳过休眠`)
      return
    }
    // 白名单 2: 监控进行中不休眠
    if (state.monitor?.isMonitoring) {
      console.log(`[MainPage] 监控进行中，跳过休眠`)
      return
    }
    // 白名单 3: 发送进行中不休眠
    if (state.isSending) {
      console.log(`[MainPage] 发送进行中，跳过休眠`)
      return
    }
    // 白名单 4（决策 D3）: 回溯历史态不休眠 —— 回溯是用户主动查看历史，属活跃操作，从源头消除真值表 case 10-12
    if (activeHistoryIdRef.current) {
      console.log(`[MainPage] 回溯历史态，跳过休眠`)
      return
    }

    const ref = state.webviewRefs.get(modelId)
    if (ref && !ref.isHibernated()) {
      console.log(`[MainPage] 休眠 webview: ${modelId}`)
      const result = await ref.suspend()
      if (result.success) {
        console.log(`[MainPage] ${modelId} 已休眠，保存 URL: ${result.savedUrl}`)
      } else {
        console.warn(`[MainPage] ${modelId} 休眠失败:`, result.error)
      }
    }
  }, [])
```

修改为：
```typescript
  // 执行休眠：白名单检查通过后调用 ref.suspend()（D1 真卸载）
  const executeHibernate = useCallback(async (modelId: string) => {
    const state = useAppStore.getState()

    // 活动任务判断：发送中、抓取监控中、辩论运行中、上传文件进行中
    const isTaskRunning =
      state.isSending ||
      !!state.monitor?.isMonitoring ||
      state.debateState?.phase === 'running' ||
      state.isUploading

    if (isTaskRunning) {
      console.log(`[MainPage] 活动任务运行中，跳过休眠: ${modelId}`)
      return
    }

    // 只有在主窗口可见时，才应用以下白名单保护：
    // 1. 回溯历史态（用户在主动浏览历史，属于活跃交互）
    // 2. 属于当前活跃会话的模型（避免后台被休眠导致漏收接下来的消息）
    // 如果主窗口已隐藏（关闭至托盘），则允许它们休眠以释放内存。
    if (isWindowVisibleRef.current) {
      if (activeHistoryIdRef.current) {
        console.log(`[MainPage] 主窗口可见且处于回溯历史态，跳过 ${modelId} 休眠`)
        return
      }
      if (state.activeModels.some(m => m.id === modelId)) {
        console.log(`[MainPage] 主窗口可见且 ${modelId} 属于当前活跃会话，跳过休眠`)
        return
      }
    }

    const ref = state.webviewRefs.get(modelId)
    if (ref && !ref.isHibernated()) {
      console.log(`[MainPage] 休眠 webview: ${modelId}`)
      const result = await ref.suspend()
      if (result.success) {
        console.log(`[MainPage] ${modelId} 已休眠，保存 URL: ${result.savedUrl}`)
      } else {
        console.warn(`[MainPage] ${modelId} 休眠失败:`, result.error)
      }
    }
  }, [])
```

- [ ] **Step 3: 更新窗口可见性订阅函数**

在窗口可见性发生改变时，同步更新 `isWindowVisibleRef.current` 变量，确保 `executeHibernate` 能读到最新的窗口状态。

原代码范围（第 502 至 516 行）：
```typescript
  useEffect(() => {
    const off = window.api.onWindowVisibility((visible) => {
      const models = displayedModelsRef.current
      if (visible) {
        for (const model of models) {
          void wakeWebview(model.id)
        }
      } else {
        for (const model of models) {
          scheduleHibernate(model.id, HIBERNATE_DELAY_HIDE_MS)
        }
      }
    })
    return () => { off() }
  }, [scheduleHibernate, wakeWebview])
```

修改为：
```typescript
  useEffect(() => {
    const off = window.api.onWindowVisibility((visible) => {
      isWindowVisibleRef.current = visible
      const state = useAppStore.getState()
      
      // 合并显示的 Webview 和属于活跃会话的 Webview
      // 避免后台隐藏的 activeModels 错过休眠调度或唤醒
      const modelsToHandle = Array.from(new Set([
        ...displayedModelsRef.current.map(m => m.id),
        ...state.activeModels.map(m => m.id)
      ]))
      
      if (visible) {
        for (const id of modelsToHandle) {
          void wakeWebview(id)
        }
      } else {
        for (const id of modelsToHandle) {
          scheduleHibernate(id, HIBERNATE_DELAY_HIDE_MS)
        }
      }
    })
    return () => { off() }
  }, [scheduleHibernate, wakeWebview])
```

- [ ] **Step 4: 本地静态校验编译与 Lint 状态**

运行编译和 lint 命令：
- `npm run lint`
- `npm run build`
预期结果：编译成功且无相关文件的 TypeScript / ESLint 错误。

- [ ] **Step 5: 提交当前 MainPage 修改**

在验证无误后，进行暂存并提交当前更改：
```bash
git add src/renderer/src/pages/MainPage.tsx
git commit -m "perf(webview): optimize hibernation timeouts and whitelist logic in MainPage"
```

---

### Task 2: 优化快捷窗口页面 (QuickPage.tsx) 的休眠时间

**Files:**
- Modify: `src/renderer/src/pages/QuickPage.tsx`

- [ ] **Step 1: 修改 Quick 页面休眠延迟常量**

将被切走的旧模型的休眠倒计时时间从 5 分钟缩短为 30 秒。

原代码范围（第 13 至 17 行）：
```typescript
  // ── 休眠调度（片段 E，决策 R2）──
  // 快捷窗口当前模型永不休眠；被切走的旧模型 5 分钟后真卸载（D1）。
  const HIBERNATE_DELAY_QUICK_MS = 5 * 60 * 1000 // 5 分钟
```

修改为：
```typescript
  // ── 休眠调度（片段 E，决策 R2）──
  // 快捷窗口当前模型永不休眠；被切走的旧模型 30 秒后真卸载（D1）。
  const HIBERNATE_DELAY_QUICK_MS = 30 * 1000 // 30 秒
```

- [ ] **Step 2: 本地编译与检查**

运行 `npm run lint` 和 `npm run build` 确保通过。

- [ ] **Step 3: 提交 QuickPage 修改**

在验证无误后，进行暂存并提交当前更改：
```bash
git add src/renderer/src/pages/QuickPage.tsx
git commit -m "perf(webview): shorten quick page webview hibernation delay to 1 minute"
```

---

### Task 3: 优化总结面板 (SummaryPanel.tsx) 的休眠时间与窗口隐藏响应

**Files:**
- Modify: `src/renderer/src/components/SummaryPanel.tsx`

- [ ] **Step 1: 修改总结页面 webview 休眠延迟常量**

将总结 Webview 被切走时的休眠时间缩短到 30 秒。

原代码范围（第 226 至 229 行）：
```typescript
  // ── 休眠调度（片段 D，决策 R3）──
  // 总结页 webview 仅在 webview 模式下存在；切走总结页 10 分钟后真卸载（D1），切回立即唤醒。
  const HIBERNATE_DELAY_SUMMARY_MS = 10 * 60 * 1000 // 10 分钟
```

修改为：
```typescript
  // ── 休眠调度（片段 D，决策 R3）──
  // 总结页 webview 仅在 webview 模式下存在；切走总结页 30 秒后真卸载（D1），切回立即唤醒。
  const HIBERNATE_DELAY_SUMMARY_MS = 30 * 1000 // 30 秒
```

- [ ] **Step 2: 订阅主窗口隐藏/显示事件**

在 `SummaryPanel.tsx` 中订阅窗口可见性事件。当主窗口隐藏时，如果处于 webview 总结模式，则启动 5 分钟休眠倒计时；窗口重新显示且当前处于激活状态时立即唤醒，从而降低后台闲置时的内存占用。

在 `isActive` 状态监听的 Effect 下方加入以下 Effect（约第 296 行）：
```typescript
  // 监听主窗口 hide/show 事件：隐藏后 5 分钟休眠总结页 webview，重新显示且 isActive 时立即唤醒。
  const isWindowVisibleRef = useRef(true)
  useEffect(() => {
    const off = window.api.onWindowVisibility((visible) => {
      isWindowVisibleRef.current = visible
      if (visible) {
        if (isActive) {
          void wakeSummaryWebview()
        }
      } else if (summarySource === 'webview') {
        if (summaryHibernateTimerRef.current) {
          clearTimeout(summaryHibernateTimerRef.current)
        }
        summaryHibernateTimerRef.current = setTimeout(() => {
          void executeSummaryHibernate()
        }, 5 * 60 * 1000) // 5 分钟
        console.log('[SummaryPanel] 窗口隐藏，总结页 webview 5 分钟休眠倒计时启动')
      }
    })
    return () => { off() }
  }, [isActive, summarySource, executeSummaryHibernate, wakeSummaryWebview])
```

- [ ] **Step 3: 静态检查与提交**

运行 `npm run lint` 和 `npm run build` 确保完全通过。
运行暂存与提交：
```bash
git add src/renderer/src/components/SummaryPanel.tsx
git commit -m "perf(webview): optimize summary panel webview hibernation delay and background sleep"
```

---

### Task 4: 实现全局 Webview 容量控制（LRU 淘汰机制）

**Files:**
- Modify: `src/renderer/src/store/appStore.ts`
- Modify: `src/renderer/src/pages/MainPage.tsx`
- Modify: `src/renderer/src/pages/QuickPage.tsx`
- Modify: `src/renderer/src/components/SummaryPanel.tsx`

- [ ] **Step 1: 在 appStore 中新增唤醒时间追踪与主动淘汰方法**

在 `appStore.ts` 的 `AppState` 中新增：
- `activeWebviewTimes: Map<string, number>`（无需持久化）：记录各模型最近一次被唤醒的时间戳。
- `markWebviewActive: (modelId: string) => void`：更新指定 Webview 的唤醒时间戳。
- `enforceWebviewCapacity: () => Promise<void>`：容量检查函数。
  - 获取当前所有 `webviewRefs` 中处于唤醒状态 (`!ref.isHibernated()`) 的实例列表。
  - 如果数量超过 8 个，且超过部分不在白名单（非 `isSending` / `isMonitoring` / `debate running` / `isUploading` 等活动状态）。
  - 则根据 `activeWebviewTimes` 挑选时间戳最旧（最久未活跃）的一个执行 `ref.suspend()`，并清除它的时间戳。

- [ ] **Step 2: 优化淘汰白名单判定逻辑**

在 `appStore.ts` 实现 `enforceWebviewCapacity` 时，需要抽离出全局统一的“活动任务判定逻辑”（包含发送中、监控中、辩论中、上传中），不仅供给容量淘汰检查使用，也可替换 `MainPage.tsx` 中分散的校验。

**关键约束**：在挑选被强制淘汰的旧 Webview 时，**必须豁免**当前在 `activeModels` 中且主窗口处于可见状态的模型。否则如果它们被强制淘汰休眠，后续发送消息时会因未就绪而导致丢失。

- [ ] **Step 3: 修改全局唤醒逻辑 (wakeWebview 等)**

在 `MainPage.tsx`、`QuickPage.tsx`、`SummaryPanel.tsx` 的相关唤醒函数中，成功调用 `ref.resume()` 之后，立即调用 `useAppStore.getState().markWebviewActive(modelId)` 记录活跃时间，随后调用 `useAppStore.getState().enforceWebviewCapacity()` 触发一次容量淘汰检查。

- [ ] **Step 4: 静态检查与提交**

运行 `npm run lint` 和 `npm run build` 确保没有类型错误。
提交修改：
```bash
git add src/renderer/src/store/appStore.ts src/renderer/src/pages/MainPage.tsx src/renderer/src/pages/QuickPage.tsx src/renderer/src/components/SummaryPanel.tsx
git commit -m "perf(webview): enforce maximum of 8 active webviews via LRU eviction policy"
```

---

## 最终集成验证 (手动)

- [ ] **Step 1: 运行本地开发应用**
  运行：`npm run dev` 并开启开发工具控制台与系统资源管理器。

- [ ] **Step 2: 验证切模式与模型休眠 (30 秒)**
  - 在 MultiChat 应用中打开多个模型，并发送测试对话。
  - 在侧边栏切换运行模式或更换插槽的模型，打开控制台检查休眠日志。
  - 观察 30 秒后控制台是否输出 `[MainPage] 休眠 webview: <modelId>` 以及系统任务管理器中 Electron webview 渲染进程内存下降。
  - 切换回原模型，确认其正常 `resume` 唤醒并恢复之前的对话 URL 及草稿。

- [ ] **Step 3: 验证窗口隐藏自动休眠 (5 分钟)**
  - 正常在主页面保持展示模型，并将主窗口关闭至系统托盘 (隐藏)。
  - 等待 5 分钟，确认主页面显示的所有模型 Webview 都成功休眠释放内存。
  - 从托盘双击重新显示主窗口，确认所有页面模型能立即被唤醒，不需要用户手动刷新。

- [ ] **Step 4: 验证正在运行的任务不休眠保护**
  - 开始一轮辩论模式 (`DebateMode`，多轮自动对话运行中)，然后立刻将主窗口最小化隐藏。
  - 观察 5 分钟后，控制台是否正常输出跳过休眠日志 `[MainPage] 活动任务运行中，跳过休眠: <modelId>`，且辩论任务不被阻断地持续运行。

- [ ] **Step 5: 验证全局 Webview 8个上限与 LRU 强制淘汰**
  - 在 `MainPage` 快速切换模型插槽，并在 `QuickPage` 和 `SummaryPanel` 也唤醒不同模型，使其同时处于 `!isHibernated()` 状态的总数超过 8 个。
  - 观察控制台，当第 9 个 Webview 被唤醒时，是否立刻输出了容量淘汰日志，并且将最早且不活跃的 Webview 强制置入休眠状态，保证系统中的存活总数始终受控。
