# Webview Mode-Switch Hibernation Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修复当用户切换模式（productMode：multi_ai / task_assignment / debate）时，被切换到后台的旧模式 webview 无法进入休眠状态的 Bug。

**Architecture:** 在 `MainPage.tsx` 中引入独立的休眠 ref 追踪映射 `hibernationRefsMap`（以 `mode-slotIndex` 为键），确保所有模式已挂载保持挂载的 webview 都能维持 ref 引用；新增模式切换专用的 `useEffect` 对比切换前后的模型，对不再可见的 webview 触发 30s 休眠；同时保证 `store.webviewRefs` 只包含当前活跃模式下的 webview，实现对原有发送与读取回复等逻辑的无缝兼容。

**Tech Stack:** TypeScript (strict), React 18, Zustand 4, Electron 28

---

## 拟修改文件

- `src/renderer/src/pages/MainPage.tsx`

---

### Task 1: 初始化 MainPage 内部休眠 Ref 跟踪机制

**Files:**
- Modify: `src/renderer/src/pages/MainPage.tsx`

- [ ] **Step 1: 新增休眠专用 ref 变量与回调**
  
  在 `MainPage.tsx` 组件顶部的 Ref 声明区域，新增用于追踪所有已挂载模式 WebviewCard refs 的 Map 变量，并实现其对应的注册回调函数。

  在 `prevDisplayedIdsRef` 声明下方（约第 82 行附近）插入：
  ```typescript
  // ── 模式感知休眠追踪 ──
  // 休眠专用 ref 追踪：key = `${mode}-${slotIndex}`，所有已挂载模式的 WebviewCard 都在此注册
  // 独立于 store.webviewRefs，确保后台模式（display: none）下的 webview 在被切走后仍能通过 ref 调用 suspend 进入休眠
  const hibernationRefsMap = useRef<Map<string, WebviewCardRef>>(new Map())

  // 获取模式感知的休眠 ref 回调，使用 ref 缓存防止重复创建导致 react re-render 时冲突
  const hibernationRefCallbacks = useRef<Record<string, (ref: WebviewCardRef | null) => void>>({})
  const getHibernationRefCallback = useCallback((mode: string, slotIndex: number) => {
    const key = `${mode}-${slotIndex}`
    if (!hibernationRefCallbacks.current[key]) {
      hibernationRefCallbacks.current[key] = (ref: WebviewCardRef | null) => {
        if (ref) {
          hibernationRefsMap.current.set(key, ref)
        } else {
          hibernationRefsMap.current.delete(key)
        }
      }
    }
    return hibernationRefCallbacks.current[key]
  }, [])
  ```

- [ ] **Step 2: 绑定 WebviewCard 的 ref 回调**

  修改 `renderLayoutChildren` 中的 WebviewCard 渲染部分，使所有的 WebviewCard 无论是否活跃，都始终将 ref 注册到 `hibernationRefsMap` 中。

  定位到约第 837-858 行代码：
  ```tsx
              return (
                <div key={`mode-wrapper-${mode}-${i}`} style={{ display: productMode === mode ? 'block' : 'none', width: '100%', height: '100%' }}>
                  <WebviewCard
                    key={`webview-${mode}-${i}-${model.id}`}
                    ref={productMode === mode ? getRefCallback(model.id, i) : undefined}
                    id={model.id}
  ```

  修改为：
  ```tsx
              return (
                <div key={`mode-wrapper-${mode}-${i}`} style={{ display: productMode === mode ? 'block' : 'none', width: '100%', height: '100%' }}>
                  <WebviewCard
                    key={`webview-${mode}-${i}-${model.id}`}
                    ref={getHibernationRefCallback(mode, i)}
                    id={model.id}
  ```

- [ ] **Step 3: 实现活跃模式 webview refs 动态注册到 store**

  为了维持 `store.webviewRefs` 原本只保留“当前活跃模型”的语义，我们在 `MainPage.tsx` 中新增一个 `useEffect`，在 `productMode` 改变时，主动将新活跃模式的 refs 注册到 store，并将老活跃模式的 refs 注销。

  在组件生命周期区域（如 `mountedWebviews` 状态变化的 useEffect 下方，约第 437 行附近）插入：
  ```typescript
  // 当产品模式切换时，动态更新 store 中的 webviewRefs（供 sendMessage/getAllResponses 等使用）
  useEffect(() => {
    const state = useAppStore.getState()
    const currentModeModels = modeModels[productMode as keyof typeof modeModels]
    
    // 1. 注册当前活跃模式的所有 slots 实例
    for (let i = 0; i < currentModeModels.length; i++) {
      const ref = hibernationRefsMap.current.get(`${productMode}-${i}`)
      if (ref) {
        state.registerWebviewRef(`slot-${i}`, ref)
        state.registerWebviewRef(currentModeModels[i].id, ref)
      }
    }

    return () => {
      // 2. 清理注销（在下一次切换模式前触发）
      const prevModeModels = modeModels[productMode as keyof typeof modeModels]
      for (let i = 0; i < prevModeModels.length; i++) {
        const ref = hibernationRefsMap.current.get(`${productMode}-${i}`)
        if (ref) {
          state.unregisterWebviewRef(`slot-${i}`, ref)
          state.unregisterWebviewRef(prevModeModels[i].id, ref)
        }
      }
    }
  }, [productMode, modeModels])
  ```

---

### Task 2: 实现模式切换感知休眠调度逻辑

**Files:**
- Modify: `src/renderer/src/pages/MainPage.tsx`

- [ ] **Step 1: 新增基于 mode-slot 维度的休眠与唤醒函数族**

  实现以 `mode-slotIndex` 为主键的休眠、唤醒与延迟调度函数。由于不同模式可能使用相同的 `modelId`，传统的 `modelId` 键会导致调度器被错误覆盖，因此必须使用明确指代特定 WebviewCard 实例的 `mode-slotIndex` 键。

  在现有 `wakeWebview` 声明下方（约第 210 行附近）插入：
  ```typescript
  // 各 mode-slot 的休眠倒计时定时器；key = `${mode}-${slotIndex}`
  const hibernateModeTimersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map())

  // 清理指定 mode-slot 的休眠定时器
  const clearHibernateModeTimer = useCallback((modeSlotKey: string) => {
    const timer = hibernateModeTimersRef.current.get(modeSlotKey)
    if (timer) {
      clearTimeout(timer)
      hibernateModeTimersRef.current.delete(modeSlotKey)
    }
  }, [])

  // 执行指定 mode-slot 的休眠（D1 真卸载）
  const executeHibernateByModeSlot = useCallback(async (modeSlotKey: string) => {
    const state = useAppStore.getState()

    // 活动任务判断：发送中、抓取监控中、辩论运行中、上传文件进行中（跳过休眠）
    const isTaskRunning =
      state.isSending ||
      !!state.monitor?.isMonitoring ||
      state.debateState?.phase === 'running' ||
      state.isUploading

    if (isTaskRunning) {
      console.log(`[MainPage] 活动任务运行中，跳过模式休眠: ${modeSlotKey}`)
      return
    }

    const ref = hibernationRefsMap.current.get(modeSlotKey)
    if (ref && !ref.isHibernated()) {
      console.log(`[MainPage] 休眠 webview (mode-slot): ${modeSlotKey}`)
      const result = await ref.suspend()
      if (result.success) {
        console.log(`[MainPage] ${modeSlotKey} 已休眠，保存 URL: ${result.savedUrl}`)
      } else {
        console.warn(`[MainPage] ${modeSlotKey} 休眠失败:`, result.error)
      }
    }
  }, [])

  // 调度模式休眠
  const scheduleHibernateByModeSlot = useCallback((modeSlotKey: string, delayMs: number = HIBERNATE_DELAY_MS) => {
    clearHibernateModeTimer(modeSlotKey)
    const timer = setTimeout(() => {
      void executeHibernateByModeSlot(modeSlotKey)
    }, delayMs)
    hibernateModeTimersRef.current.set(modeSlotKey, timer)
    console.log(`[MainPage] ${modeSlotKey} 模式休眠倒计时启动: ${delayMs}ms`)
  }, [clearHibernateModeTimer, executeHibernateByModeSlot])

  // 唤醒模式 webview
  const wakeWebviewByModeSlot = useCallback(async (modeSlotKey: string) => {
    clearHibernateModeTimer(modeSlotKey)
    const ref = hibernationRefsMap.current.get(modeSlotKey)
    if (ref && ref.isHibernated()) {
      console.log(`[MainPage] 唤醒 webview (mode-slot): ${modeSlotKey}`)
      await ref.resume()
    }
  }, [clearHibernateModeTimer])
  ```

- [ ] **Step 2: 新增 productMode 变化的休眠调度 useEffect**

  在组件内新增一个监听 `productMode` 变化的副作用，在用户切换模式时，立即对比上一次的模式，对被切到后台的旧模式所有 webview 启动 30 秒的休眠倒计时，并立即唤醒当前新激活模式下的所有 webview。

  在新增的 store 注册 useEffect 下方插入：
  ```typescript
  // ── 模式切换休眠调度 ──
  const prevProductModeRef = useRef<string>(productMode)

  useEffect(() => {
    const prevMode = prevProductModeRef.current
    prevProductModeRef.current = productMode

    if (prevMode === productMode) return

    // 1. 旧模式的所有 webview 启动休眠倒计时
    const oldModeModels = modeModels[prevMode as keyof typeof modeModels]
    if (oldModeModels) {
      for (let i = 0; i < oldModeModels.length; i++) {
        const modeSlotKey = `${prevMode}-${i}`
        scheduleHibernateByModeSlot(modeSlotKey)
      }
    }

    // 2. 新模式的所有 webview 立即唤醒
    const newModeModels = modeModels[productMode as keyof typeof modeModels]
    if (newModeModels) {
      for (let i = 0; i < newModeModels.length; i++) {
        const modeSlotKey = `${productMode}-${i}`
        void wakeWebviewByModeSlot(modeSlotKey)
      }
    }
  }, [productMode, modeModels, scheduleHibernateByModeSlot, wakeWebviewByModeSlot])
  ```

---

### Task 3: 优化与适配现有的生命周期事件

**Files:**
- Modify: `src/renderer/src/pages/MainPage.tsx`

- [ ] **Step 1: 适配主窗口可见性事件中的模式休眠控制**

  原有的窗口可见性事件仅对 `displayedModels` 进行休眠（即只休眠当前模式的显示模型），这会导致隐藏在后台的其他模式 webview 躲过休眠。需要更新为：当窗口隐藏时，对 `hibernationRefsMap` 中的所有模式已挂载 webview 均启动 5 分钟的延迟休眠；窗口恢复可见时，立即唤醒当前活跃模式下的 webview。

  定位到约第 522-546 行的 `onWindowVisibility` 注册 Effect：
  ```typescript
    useEffect(() => {
      const off = window.api.onWindowVisibility((visible) => {
        isWindowVisibleRef.current = visible
        const state = useAppStore.getState()
        state.setMainWindowVisible(visible)
        
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

  修改为：
  ```typescript
    useEffect(() => {
      const off = window.api.onWindowVisibility((visible) => {
        isWindowVisibleRef.current = visible
        const state = useAppStore.getState()
        state.setMainWindowVisible(visible)
        
        if (visible) {
          // 重新显示时：只唤醒当前模式下的显示模型
          const currentModels = modeModels[productMode as keyof typeof modeModels]
          for (let i = 0; i < currentModels.length; i++) {
            void wakeWebviewByModeSlot(`${productMode}-${i}`)
          }
        } else {
          // 隐藏到托盘时：将所有挂载模式的所有 webview 均投入 5 分钟休眠倒计时
          for (const [modeSlotKey] of hibernationRefsMap.current.entries()) {
            scheduleHibernateByModeSlot(modeSlotKey, HIBERNATE_DELAY_HIDE_MS)
          }
        }
      })
      return () => { off() }
    }, [productMode, modeModels, scheduleHibernateByModeSlot, wakeWebviewByModeSlot])
  ```

- [ ] **Step 2: 适配组件卸载时的定时器清理**

  在 MainPage 组件卸载时，除了清理 bare `modelId` 的 timers，还需要将新增 of `hibernateModeTimersRef` 一并清空。

  定位到约第 548-556 行的卸载 Effect：
  ```typescript
    // 组件卸载时清理所有休眠倒计时，避免卸载后仍触发 suspend
    useEffect(() => {
      return () => {
        for (const [, timer] of hibernateTimersRef.current.entries()) {
          clearTimeout(timer)
        }
        hibernateTimersRef.current.clear()
      }
    }, [])
  ```

  修改为：
  ```typescript
    // 组件卸载时清理所有休眠倒计时，避免卸载后仍触发 suspend
    useEffect(() => {
      return () => {
        for (const [, timer] of hibernateTimersRef.current.entries()) {
          clearTimeout(timer)
        }
        hibernateTimersRef.current.clear()
        for (const [, timer] of hibernateModeTimersRef.current.entries()) {
          clearTimeout(timer)
        }
        hibernateModeTimersRef.current.clear()
      }
    }, [])
  ```

---

## Verification Plan

### Automated Tests

```bash
npm run lint
npm run build
```

### Manual Verification

1. **同模型配置切模式测试（测试 Bug 1、Bug 2 修复情况）：**
   - 启动项目 `npm run dev`，打开控制台。
   - 模式处于默认的 `multi_ai`，让 4 个模型正常显示并完成加载。
   - 点击顶部切换到 `task_assignment` 模式（slots 没有改变，使用的模型还是相同的 4 个）。
   - 观察控制台输出，应打印：
     `[MainPage] multi_ai-0 模式休眠倒计时启动: 30000ms` ... （一共启动 4 个旧模式 slot 倒计时）。
   - 等待 30 秒，确认控制台输出：
     `[MainPage] 休眠 webview (mode-slot): multi_ai-0` 并打印保存 URL 成功。
   - 此时在 task_assignment 模式的任一模型中发送一条测试消息，确认发送及回复抓取流程完全正常（证明 store refs 没有被误注销，能正常拿到 refs 交互）。
   - 重新切回 `multi_ai` 模式，应立即打印 `[MainPage] 唤醒 webview (mode-slot): multi_ai-0`，并确认 4 个 webview 均正常从 `about:blank` 状态恢复加载了原 URL。

2. **跨模式切换与 activeModels 白名单绕过测试（测试 Bug 3 修复情况）：**
   - 在 `multi_ai` 发送一段对话以激活会话（这会让 `activeModels` 填充这些模型 id）。
   - 切换到 `task_assignment`。
   - 等待 30 秒。
   - 观察控制台，确认旧模式 `multi_ai` 的 webview 仍然正常输出 `[MainPage] 休眠 webview (mode-slot): multi_ai-X`。
   - 切换回 `multi_ai`，检查会话记录，确认被休眠的 webview 已经成功唤醒，会话连续性没有被破坏，且草稿箱恢复正常。

3. **窗口最小化托盘的广域休眠测试：**
   - 先后切换一下三个模式，使 `mountedWebviews` 挂载了所有 3 种模式的 webviews（一共 10 个 webview 实例）。
   - 关闭应用主窗口至托盘（触发窗口隐藏事件）。
   - 观察控制台日志，此时所有模式的 10 个已挂载 slot 都应该被启动了 5 分钟的休眠倒计时。
   - 从托盘区双击唤起窗口，确认仅当前显示的活跃模式对应的 webview 被唤醒（例如当前处于 debate，只唤醒 `debate-0` 和 `debate-1`）。
