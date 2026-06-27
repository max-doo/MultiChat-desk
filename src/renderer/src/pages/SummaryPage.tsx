import { useState, useEffect, useMemo, useRef } from 'react'
import ModelOutputCard from '../components/ModelOutputCard'
import SummaryPanel from '../components/SummaryPanel'
import SummaryHistoryDrawer from '../components/SummaryHistoryDrawer'
import { useAppStore, getDisplayedModels, SummaryHistoryItem } from '../store/appStore'

interface SummaryPageProps {
  onNavigateBack: () => void
  initialHistoryItem?: SummaryHistoryItem
  isActive?: boolean
}

/**
 * 总结页面组件
 * 显示各模型输出和 AI 总结面板
 */
function SummaryPage({ onNavigateBack, initialHistoryItem, isActive }: SummaryPageProps): JSX.Element {
  const { models, displayMode, pendingSummarySession, setPendingSummarySession, history, isHistoryOpen, setHistoryOpen } = useAppStore()

  const [activeHistoryId, setActiveHistoryId] = useState<string | undefined>(undefined)
  
  // 获取当前实际显示的模型（根据 displayMode）
  const displayedModels = useMemo(() => {
    return getDisplayedModels(models, displayMode)
  }, [models, displayMode])
  
  // 默认选中所有显示的模型
  const [selectedModels, setSelectedModels] = useState<string[]>(
    displayedModels.map(m => m.id)
  )
  const [modelResponses, setModelResponses] = useState<Record<string, string>>({})
  const [isLoadingResponses, setIsLoadingResponses] = useState(true)
  const [restoreHistoryData, setRestoreHistoryData] = useState<{
    historyId?: string
    messages: Array<{
      id: string
      role: 'user' | 'assistant'
      content: string
      reasoningContent?: string
      timestamp: number
      modeName?: string
      versions?: Array<{
        content: string
        reasoningContent?: string
        timestamp: number
        modelId: string
        modelName: string
      }>
      currentVersionIndex?: number
    }>
    selectedModels: string[]
    modelResponses: Record<string, string>
  } | null>(null)

  // 初始化：挂载时从 pendingSummarySession 或 history 加载模型回复（只执行一次）
  const initDoneRef = useRef(false)
  useEffect(() => {
    if (initDoneRef.current) return
    initDoneRef.current = true

    if (initialHistoryItem) {
      handleRestoreHistory(initialHistoryItem)
      return
    }

    setIsLoadingResponses(true)

    const session = pendingSummarySession
    let data: Record<string, string> = {}

    if (session) {
      data = session.modelResponses || {}
      setPendingSummarySession(null)
      console.log('[SummaryPage] 从 pendingSummarySession 加载:', Object.keys(data))
    } else {
      // Fallback：从 history 最新 turn 读取
      const latestItem = history[0]
      const latestTurn = latestItem?.turns?.[latestItem.turns.length - 1]
      if (latestTurn?.responses && Object.keys(latestTurn.responses).length > 0) {
        data = latestTurn.responses
        console.log('[SummaryPage] 从 history fallback 加载:', Object.keys(data))
      }
    }

    setModelResponses(data)

    // 同步选中模型：有数据的默认选中，否则全选
    const modelsWithData = displayedModels
      .filter(m => data[m.id]?.trim().length > 0)
      .map(m => m.id)
    setSelectedModels(modelsWithData.length > 0 ? modelsWithData : displayedModels.map(m => m.id))

    setIsLoadingResponses(false)
  }, []) // 只在挂载时执行一次

  // 切换模型选择状态
  const toggleModelSelection = (modelId: string): void => {
    setSelectedModels(prev => 
      prev.includes(modelId)
        ? prev.filter(id => id !== modelId)
        : [...prev, modelId]
    )
  }

  // 抽取恢复历史记录的逻辑
  const handleRestoreHistory = (item: SummaryHistoryItem) => {
    console.log('[SummaryPage] 恢复历史记录:', item)

    // 记录当前激活的历史记录 ID
    setActiveHistoryId(item.id)
    setIsLoadingResponses(true)

    // 恢复选中的模型
    if (item.selectedModels && item.selectedModels.length > 0) {
      setSelectedModels(item.selectedModels)
      console.log('[SummaryPage] 恢复选中模型:', item.selectedModels)
    }

    // 恢复模型回复数据
    if (item.modelResponses && Object.keys(item.modelResponses).length > 0) {
      setModelResponses(item.modelResponses)
      console.log('[SummaryPage] 恢复模型回复数据:', Object.keys(item.modelResponses))
    } else {
      console.warn('[SummaryPage] 历史记录中没有模型回复数据')
      setModelResponses({})
    }

    // 恢复对话消息
    setRestoreHistoryData({
      historyId: item.id,
      messages: item.messages,
      selectedModels: item.selectedModels,
      modelResponses: item.modelResponses || {}
    })

    setTimeout(() => {
      setIsLoadingResponses(false)
    }, 200)
  }

  return (
    <div className="flex h-full overflow-hidden">
      {/* 左侧：返回按钮 + 模型回复内容 */}
      <div className="w-3/5 p-6 flex flex-col h-full border-r border-gray-200 overflow-hidden">
        <button
          onClick={onNavigateBack}
          className="flex items-center gap-2 text-text-secondary hover:text-text-primary transition-colors mb-4 shrink-0 self-start"
        >
          <span className="material-symbols-outlined">arrow_back</span>
          <span>返回对话窗口</span>
        </button>

        {isLoadingResponses ? (
          <div className="flex flex-col items-center justify-center h-full text-text-secondary">
            <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin mb-3"></div>
            <p>正在加载模型回复...</p>
          </div>
        ) : (
          <div className="flex-1 overflow-y-auto space-y-4 pr-2 min-h-0">
            {/* 只显示当前实际显示的模型（根据 displayMode） */}
            {displayedModels.map((model) => (
              <ModelOutputCard
                key={model.id}
                id={model.id}
                name={model.name}
                logo={model.logo}
                content={modelResponses[model.id] || '暂无回复内容'}
                selected={selectedModels.includes(model.id)}
                onToggle={() => toggleModelSelection(model.id)}
              />
            ))}
          </div>
        )}
      </div>

      {/* 右侧：总结的对话框 + 底部输入框 */}
      <div className="w-2/5 p-6 flex flex-col h-full overflow-hidden">
        <SummaryPanel 
          selectedModels={selectedModels} 
          modelResponses={modelResponses}
          restoreHistoryData={restoreHistoryData}
        />
      </div>

      {/* 总结历史记录抽屉 */}
      <SummaryHistoryDrawer
        isOpen={isHistoryOpen && (isActive ?? true)}
        onClose={() => setHistoryOpen(false)}
        onSelectHistory={handleRestoreHistory}
        activeHistoryId={activeHistoryId}
      />
    </div>
  )
}

export default SummaryPage
