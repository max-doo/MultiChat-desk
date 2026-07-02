import { useState, useEffect, useCallback } from 'react'
import { useAppStore } from '../../store/appStore'
import { useTaskSplit } from '../../hooks/useTaskSplit'
import CustomDropdown from '../CustomDropdown'

interface TaskSplitModalProps {
  open: boolean
  initialError: string | null
  onClose: () => void
  showNotification: (type: 'success' | 'error' | 'info', msg: string, autoHide?: number) => void
}

function TaskSplitModal({ open, initialError, onClose, showNotification }: TaskSplitModalProps): JSX.Element | null {
  const apiConfig = useAppStore((s) => s.apiConfig)
  const summaryModels = useAppStore((s) => s.summaryModels)
  const models = useAppStore((s) => s.models)
  const taskAssignmentSlots = useAppStore((s) => s.taskAssignmentSlots)
  const setTaskAssignmentSlot = useAppStore((s) => s.setTaskAssignmentSlot)
  const setSettingsOpen = useAppStore((s) => s.setSettingsOpen)
  const query = useAppStore((s) => s.taskState.query)
  const { split, abort, isLoading, persistProvider } = useTaskSplit()

  const enabledProviders = apiConfig.providers.filter(p => p.enabled)
  const [providerId, setProviderId] = useState(apiConfig.activeProviderId || '')
  const [agentId, setAgentId] = useState(apiConfig.lastSelectedAgentId || '')
  const [error, setError] = useState<string | null>(initialError)

  // 打开时同步当前配置；initialError 变化时同步错误
  useEffect(() => {
    if (open) {
      setProviderId(apiConfig.activeProviderId || '')
      setAgentId(apiConfig.lastSelectedAgentId || '')
      setError(initialError)
    }
  }, [open, initialError, apiConfig.activeProviderId, apiConfig.lastSelectedAgentId])

  // 关闭前若仍在 loading，显式中止（!open 时组件 return null 不卸载，cleanup 不可靠）
  const closeWithAbort = useCallback(() => {
    if (isLoading) void abort()
    onClose()
  }, [isLoading, abort, onClose])

  // Esc 关闭
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeWithAbort()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, closeWithAbort])

  if (!open) return null

  const providerModels = summaryModels.filter(m => m.providerId === providerId)
  const selectedProvider = enabledProviders.find(p => p.id === providerId)
  const selectedModel = providerModels.find(m => m.id === agentId)

  const handleProviderChange = (newProviderId: string) => {
    setProviderId(newProviderId)
    const newModels = summaryModels.filter(m => m.providerId === newProviderId)
    const stillValid = agentId && newModels.some(m => m.id === agentId)
    setAgentId(stillValid ? agentId : (newModels[0]?.id || ''))
  }

  const handleSplit = async () => {
    if (!providerId || !agentId) {
      setError('请先选择供应商和模型')
      return
    }
    persistProvider(providerId, agentId)
    setError(null)
    const r = await split(query)
    if (r.ok) {
      showNotification('success', '拆解完成')
      onClose()
    } else {
      setError(r.error || '拆解失败')
    }
  }

  const canSplit = !!providerId && !!agentId && !isLoading

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
      {/* 遮罩层 */}
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm animate-in fade-in duration-200"
        onClick={closeWithAbort}
      />
      {/* 弹窗内容 */}
      <div className="relative w-[480px] max-w-[90vw] bg-app border border-gray-200 rounded-2xl shadow-2xl p-6 animate-in zoom-in-95 duration-200">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-bold text-text-primary">任务拆解</h2>
          <button onClick={closeWithAbort} className="text-text-secondary hover:text-text-primary">
            <span className="material-symbols-outlined">close</span>
          </button>
        </div>

        {/* 进度 / 错误 */}
        {isLoading && (
          <div className="flex items-center gap-2 mb-4 text-text-secondary text-sm">
            <span className="material-symbols-outlined animate-spin">sync</span>
            拆解中…
          </div>
        )}
        {error && !isLoading && (
          <div className="mb-4 px-3 py-2 rounded-md bg-red-50 border border-red-200 text-red-600 text-sm">
            {error}
          </div>
        )}

        {/* 拆解模型区 */}
        <div className="mb-4">
          <div className="text-xs font-medium text-text-secondary mb-2">拆解模型</div>
          <div className="flex items-center gap-2">
            <CustomDropdown
              value={providerId}
              onChange={handleProviderChange}
              placeholder="选择供应商"
              className="min-w-[120px]"
              displayText={selectedProvider?.name || '选择供应商'}
              renderContent={(onCloseDropdown) => (
                <>
                  {enabledProviders.map(p => (
                    <button
                      key={p.id}
                      onClick={() => { handleProviderChange(p.id); onCloseDropdown() }}
                      className={`block w-full px-3 py-2 text-left text-sm transition-colors hover:bg-gray-100 whitespace-nowrap ${providerId === p.id ? 'text-primary bg-primary/5' : 'text-text-secondary'}`}
                    >
                      {p.name}
                    </button>
                  ))}
                  {enabledProviders.length === 0 && (
                    <div className="px-3 py-2 text-gray-500 text-xs whitespace-nowrap">请先启用供应商</div>
                  )}
                </>
              )}
            />
            <CustomDropdown
              value={agentId}
              onChange={setAgentId}
              placeholder="选择模型"
              className="min-w-[120px]"
              displayText={selectedModel?.name || '选择模型'}
              renderContent={(onCloseDropdown) => (
                <>
                  {providerModels.map(m => (
                    <button
                      key={m.id}
                      onClick={() => { setAgentId(m.id); onCloseDropdown() }}
                      className={`block w-full px-3 py-2 text-left text-sm transition-colors hover:bg-gray-100 whitespace-nowrap ${agentId === m.id ? 'text-primary bg-primary/5' : 'text-text-secondary'}`}
                    >
                      {m.name}
                    </button>
                  ))}
                  {providerModels.length === 0 && (
                    <div className="px-3 py-2 text-gray-500 text-xs whitespace-nowrap">该供应商下无模型</div>
                  )}
                </>
              )}
            />
          </div>
          <button
            onClick={() => { closeWithAbort(); setSettingsOpen(true) }}
            className="mt-2 text-xs text-primary hover:underline"
          >
            管理供应商…
          </button>
        </div>

        {/* 槽位分配区 */}
        <div className="mb-4">
          <div className="text-xs font-medium text-text-secondary mb-2">槽位分配（每个槽位 = 一个 webview 窗口）</div>
          <div className="flex flex-col gap-2">
            {taskAssignmentSlots.map((slotModelId, i) => {
              const slotModel = models.find(m => m.id === slotModelId)
              return (
                <div key={i} className="flex items-center gap-2">
                  <span className="text-sm text-text-secondary w-12">槽位 {i}</span>
                  <CustomDropdown
                    value={slotModelId}
                    onChange={(newId) => setTaskAssignmentSlot(i, newId)}
                    placeholder="选择 AI"
                    className="min-w-[160px]"
                    displayText={slotModel?.name || '选择 AI'}
                    renderContent={(onCloseDropdown) => (
                      <>
                        {models.map(m => (
                          <button
                            key={m.id}
                            onClick={() => { setTaskAssignmentSlot(i, m.id); onCloseDropdown() }}
                            className={`block w-full px-3 py-2 text-left text-sm transition-colors hover:bg-gray-100 whitespace-nowrap ${slotModelId === m.id ? 'text-primary bg-primary/5' : 'text-text-secondary'}`}
                          >
                            {m.name}
                          </button>
                        ))}
                      </>
                    )}
                  />
                </div>
              )
            })}
          </div>
        </div>

        {/* 底部 */}
        <div className="flex items-center justify-end gap-2">
          <button
            onClick={closeWithAbort}
            disabled={isLoading}
            className="px-3 py-1.5 rounded-xl bg-sidebar text-text-secondary hover:bg-gray-100 border border-gray-200 text-sm disabled:opacity-50 disabled:cursor-not-allowed"
          >
            取消
          </button>
          <button
            onClick={handleSplit}
            disabled={!canSplit}
            className="px-4 py-1.5 rounded-xl bg-primary text-white hover:opacity-90 text-sm disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isLoading ? '拆解中…' : '拆解'}
          </button>
        </div>
      </div>
    </div>
  )
}

export default TaskSplitModal
