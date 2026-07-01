import { useState, useCallback, useRef, useEffect } from 'react'
import { useAppStore } from '../store/appStore'

/**
 * 封装任务拆解 IPC：复用总结供应商配置，调用 split-task。
 * 成功后写入 store 的 taskState.subtasks（按槽位顺序指派默认模型）。
 */
export function useTaskSplit() {
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const abortRef = useRef(false)

  const apiConfig = useAppStore((s) => s.apiConfig)
  const summaryModels = useAppStore((s) => s.summaryModels)
  const models = useAppStore((s) => s.models)
  const setTaskSubtasks = useAppStore((s) => s.setTaskSubtasks)
  const setTaskPhase = useAppStore((s) => s.setTaskPhase)
  const toggleTaskCollapsed = useAppStore((s) => s.toggleTaskCollapsed)

  const resolveProvider = useCallback(() => {
    const providerId = apiConfig.activeProviderId
    const provider = apiConfig.providers.find(p => p.id === providerId && p.enabled)
    if (!provider) return null
    // 解析 model：优先 lastSelectedAgentId 对应的 summaryModel，否则取该供应商下第一个 summaryModel
    const agentId = apiConfig.lastSelectedAgentId
    let model = summaryModels.find(m => m.id === agentId && m.providerId === provider.id)?.name
    if (!model) model = summaryModels.find(m => m.providerId === provider.id)?.name
    if (!model) return null
    return { apiKey: provider.apiKey, baseUrl: provider.baseUrl, model }
  }, [apiConfig, summaryModels])

  const split = useCallback(async (goal: string) => {
    if (!goal.trim() || isLoading) return
    const provider = resolveProvider()
    if (!provider) {
      setError('未配置可用的总结 API 供应商，请先在设置中配置')
      return
    }
    setIsLoading(true)
    setError(null)
    abortRef.current = false
    try {
      const result = await window.api.splitTask({
        apiKey: provider.apiKey,
        baseUrl: provider.baseUrl,
        model: provider.model,
        goal,
        temperature: 0.4,
        maxTokens: 1500
      })
      if (abortRef.current) return
      if (!result.success || !result.data) {
        setError(result.error || '拆解失败')
        return
      }
      // 按槽位顺序指派默认模型（启用模型优先）
      const enabled = models.filter(m => m.enabled)
      const subtasks = result.data.map((st, i) => ({
        text: st.text,
        modelId: (enabled[i % Math.max(1, enabled.length)] || models[0])?.id || ''
      }))
      setTaskSubtasks(subtasks)
      setTaskPhase('split')
      // 展开弹层
      if (useAppStore.getState().taskState.collapsed) toggleTaskCollapsed()
    } catch (err) {
      if (!abortRef.current) setError(String(err))
    } finally {
      setIsLoading(false)
    }
  }, [isLoading, resolveProvider, models, setTaskSubtasks, setTaskPhase, toggleTaskCollapsed])

  const abort = useCallback(async () => {
    abortRef.current = true
    await window.api.abortSplitTask()
    setIsLoading(false)
  }, [])

  useEffect(() => () => { abortRef.current = true }, [])

  return { split, abort, isLoading, error }
}
