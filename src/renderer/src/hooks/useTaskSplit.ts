import { useState, useCallback, useEffect } from 'react'
import { useAppStore, getDisplayedModels } from '../store/appStore'
import type { TaskSplitTask } from '../../../shared/types/taskSplit'

// 拆解任务跨组件共享（TaskModePanel 发起并显示进度/错误），
// 不能各持一份 hook state——用模块级单例跟踪 pending 任务与错误回调。
const shared = {
  pendingTaskId: null as string | null,
  onError: null as ((msg: string) => void) | null,
  task: null as TaskSplitTask | null,
  listeners: new Set<(loading: boolean) => void>(),
  taskListeners: new Set<(task: TaskSplitTask | null) => void>(),
  offTaskChanged: null as (() => void) | null
}
const emitLoading = (v: boolean): void => shared.listeners.forEach(l => l(v))
const emitTask = (t: TaskSplitTask | null): void => { shared.task = t; shared.taskListeners.forEach(l => l(t)) }

/**
 * 封装任务拆解：经 tasksplit:* IPC 由后台 Web AI 平台拆解。
 * start 即刻返回 task，完成靠 tasksplit:task-changed 事件与 tasksplit:task 轮询；
 * 归属校验 = task.id === pendingTaskIdRef 且 taskState.query === task.goal。
 */
export function useTaskSplit() {
  const [isLoading, setIsLoading] = useState(false)
  const [task, setTask] = useState<TaskSplitTask | null>(shared.task)

  useEffect(() => {
    const l = (v: boolean): void => setIsLoading(v)
    const tl = (t: TaskSplitTask | null): void => setTask(t)
    shared.listeners.add(l)
    shared.taskListeners.add(tl)
    return () => { shared.listeners.delete(l); shared.taskListeners.delete(tl) }
  }, [])

  const setTaskSubtasks = useAppStore((s) => s.setTaskSubtasks)
  const setTaskPhase = useAppStore((s) => s.setTaskPhase)
  const toggleTaskCollapsed = useAppStore((s) => s.toggleTaskCollapsed)

  const applyDone = useCallback((task: TaskSplitTask) => {
    const curState = useAppStore.getState()
    const slotModels = getDisplayedModels(
      curState.models, curState.displayMode, 'task_assignment', curState.taskAssignmentSlots
    )
    const slotCount = Math.max(1, slotModels.length)
    const subtasks = (task.subtasks || []).map((st, i) => {
      const slotIndex = i % slotCount
      return {
        text: st.text,
        slotIndex,
        modelId: slotModels[slotIndex]?.id || curState.taskAssignmentSlots[slotIndex] || curState.models[0]?.id || ''
      }
    })
    setTaskSubtasks(subtasks)
    setTaskPhase('split')
    if (useAppStore.getState().taskState.collapsed) toggleTaskCollapsed()
  }, [setTaskSubtasks, setTaskPhase, toggleTaskCollapsed])

  const handleTask = useCallback((task: TaskSplitTask) => {
    // 同步任务快照给所有订阅者（即使非本窗口发起的任务，也可供「查看网页」）。
    if (task.id === shared.pendingTaskId || !shared.pendingTaskId) emitTask(task)
    if (task.id !== shared.pendingTaskId) return
    // goal 校验（两端 trim 对齐）：拆解中改过目标，丢弃旧结果。
    if (useAppStore.getState().taskState.query.trim() !== task.goal) {
      if (task.phase !== 'loading' && task.phase !== 'generating') shared.pendingTaskId = null
      return
    }
    if (task.phase === 'done') {
      shared.pendingTaskId = null
      emitLoading(false)
      applyDone(task)
    } else if (task.phase === 'error') {
      shared.pendingTaskId = null
      emitLoading(false)
      shared.onError?.(task.error || '拆解失败')
    } else if (task.phase === 'cancelled') {
      shared.pendingTaskId = null
      emitLoading(false)
    }
  }, [applyDone])

  // 事件订阅模块级唯一：两个组件实例都挂 hook 时，避免 done 事件被 applyDone 两次
  // （toggleTaskCollapsed 会因此翻转两次抵消）。
  useEffect(() => {
    if (shared.offTaskChanged) return
    shared.offTaskChanged = window.api.onTaskSplitChanged(handleTask)
    return () => {
      // 仅当没有其它实例存活时才退订；简化处理：保留订阅，off 由下一次挂载复用判断。
      if (shared.listeners.size <= 1) {
        shared.offTaskChanged?.()
        shared.offTaskChanged = null
      }
    }
  }, [handleTask])

  /** goal 为空直接拒；platform 为空由弹层兜底传入已启用平台。 */
  const split = useCallback(async (goal: string, platform: string, onError?: (msg: string) => void): Promise<{ ok: boolean; error?: string }> => {
    if (!goal.trim() || isLoading) return { ok: false, error: '目标为空或正在拆解中' }
    if (!platform) return { ok: false, error: '未选择拆解平台' }
    shared.onError = onError || null
    const curState = useAppStore.getState()
    const slotModels = getDisplayedModels(
      curState.models, curState.displayMode, 'task_assignment', curState.taskAssignmentSlots
    )
    const slotCount = Math.max(1, slotModels.length)
    emitLoading(true)
    try {
      const result = await window.api.taskSplitStart(goal.trim(), platform, slotCount)
      if (!result.success || !result.data) {
        emitLoading(false)
        return { ok: false, error: result.error || '启动拆解失败' }
      }
      shared.pendingTaskId = result.data.id
      return { ok: true }
    } catch (err) {
      emitLoading(false)
      return { ok: false, error: String(err) }
    }
  }, [isLoading])

  const cancel = useCallback(async () => {
    const id = shared.pendingTaskId
    if (!id) return
    await window.api.taskSplitCancel(id)
    shared.pendingTaskId = null
    emitLoading(false)
  }, [])

  const show = useCallback(async () => {
    // 展示最近一次的拆解网页（进行中或已结束都可）。
    const t = await window.api.taskSplitTask()
    if (t.success && t.data) return window.api.taskSplitShow(t.data.id)
    return { success: false, error: '没有可查看的拆解任务' }
  }, [])

  return { split, cancel, show, isLoading, task }
}
