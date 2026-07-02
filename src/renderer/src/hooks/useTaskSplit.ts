import { useState, useCallback, useRef, useEffect } from 'react'
import { useAppStore } from '../store/appStore'

/**
 * 封装任务拆解 IPC：复用总结供应商配置，调用 split-task。
 * 成功后写入 store 的 taskState.subtasks（按槽位顺序指派默认模型）。
 * 错误经返回值 { ok, error? } 传递，不维护内部 error state。
 */
export function useTaskSplit() {
  const [isLoading, setIsLoading] = useState(false)
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

  const split = useCallback(async (goal: string): Promise<{ ok: boolean; error?: string }> => {
    if (!goal.trim() || isLoading) return { ok: false, error: '目标为空或正在拆解中' }
    const provider = resolveProvider()
    if (!provider) {
      return { ok: false, error: '未配置可用的总结 API 供应商，请在弹窗中选择或先在设置中配置' }
    }
    setIsLoading(true)
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
      if (abortRef.current) return { ok: false, error: '已中止' }
      if (!result.success || !result.data) {
        return { ok: false, error: result.error || '拆解失败' }
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
      return { ok: true }
    } catch (err) {
      return { ok: false, error: String(err) }
    } finally {
      setIsLoading(false)
    }
  }, [isLoading, resolveProvider, models, setTaskSubtasks, setTaskPhase, toggleTaskCollapsed])

  // 写回拆解供应商+模型到 apiConfig（setApiConfig 已内置 storeSet 持久化，会剥离 agentPrompts）
  const persistProvider = useCallback((providerId: string, agentId: string) => {
    const setApiConfig = useAppStore.getState().setApiConfig
    const current = useAppStore.getState().apiConfig
    setApiConfig({
      ...current,
      activeProviderId: providerId,
      lastSelectedAgentId: agentId
    })
  }, [])

  const abort = useCallback(async () => {
    abortRef.current = true
    await window.api.abortSplitTask()
    setIsLoading(false)
  }, [])

  useEffect(() => () => { abortRef.current = true }, [])

  return { split, abort, isLoading, persistProvider }
}
