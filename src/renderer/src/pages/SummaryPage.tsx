import { useState, useEffect, useMemo, useRef } from 'react'
import ModelOutputCard from '../components/ModelOutputCard'
import SummaryPanel from '../components/SummaryPanel'
import SummaryHistoryDrawer from '../components/SummaryHistoryDrawer'
import { useAppStore, getDisplayedModels, SummaryHistoryItem } from '../store/appStore'

interface SummaryPageProps {
  onNavigateBack: () => void
  initialHistoryItem?: SummaryHistoryItem
}

/**
 * 总结页面组件
 * 显示各模型输出和 AI 总结面板
 */
function SummaryPage({ onNavigateBack, initialHistoryItem }: SummaryPageProps): JSX.Element {
  const { models, displayMode, apiConfig, setApiConfig, pendingSummarySession, setPendingSummarySession, history } = useAppStore()

  // 从 store 读取当前总结模式，缺省 'webview'
  const summarySource: 'api' | 'webview' = apiConfig.summarySource ?? 'webview'
  const setSummarySource = (next: 'api' | 'webview') => {
    setApiConfig({ ...apiConfig, summarySource: next })
  }
  const [historyOpen, setHistoryOpen] = useState(false)
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
    <div className="flex flex-col h-full">
      {/* 顶部导航栏 */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-gray-800">
        <button
          onClick={onNavigateBack}
          className="flex items-center gap-2 text-gray-400 hover:text-white transition-colors"
        >
          <span className="material-symbols-outlined">arrow_back</span>
          <span>返回对话窗口</span>
        </button>

        {/* 模式开关：API / Webview */}
        <div className="flex items-center gap-1 shrink-0 bg-gray-800 border border-gray-700 rounded-md p-1">
          <button
            type="button"
            onClick={() => setSummarySource('api')}
            className={`px-3 py-1 text-xs rounded transition-colors ${
              summarySource === 'api' ? 'bg-primary text-black' : 'text-gray-400 hover:text-white'
            }`}
          >
            API
          </button>
          <button
            type="button"
            onClick={() => setSummarySource('webview')}
            className={`px-3 py-1 text-xs rounded transition-colors ${
              summarySource === 'webview' ? 'bg-primary text-black' : 'text-gray-400 hover:text-white'
            }`}
          >
            Webview
          </button>
        </div>

        <div className="flex items-center gap-4">
          <h1 className="text-xl font-semibold text-white">ModelMash</h1>
          {/* 历史记录按钮 */}
          <button
            onClick={() => setHistoryOpen(true)}
            className="flex flex-col items-center justify-center gap-2 text-xs font-medium text-gray-400 hover:text-white group transition-colors duration-200"
            title="总结历史记录"
          >
            <span className="flex items-center justify-center w-10 h-10 bg-gray-800 rounded-full group-hover:bg-primary/20 group-hover:text-primary border border-transparent group-hover:border-primary/50 transition-all duration-200">
              <span className="material-symbols-outlined text-2xl">history</span>
            </span>
          </button>
        </div>
      </div>

      {/* 主内容区域 */}
      <div className="flex-1 flex overflow-hidden">
        {/* 左侧：模型输出列表 */}
        <div className="w-3/5 p-6 overflow-y-auto border-r border-gray-800">
          {isLoadingResponses ? (
            <div className="flex flex-col items-center justify-center h-full text-gray-400">
              <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin mb-3"></div>
              <p>正在加载模型回复...</p>
            </div>
          ) : (
            <div className="space-y-4">
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

        {/* 右侧：总结面板 */}
        <div className="w-2/5 p-6 overflow-y-auto">
          <SummaryPanel 
            selectedModels={selectedModels} 
            modelResponses={modelResponses}
            restoreHistoryData={restoreHistoryData}
          />
        </div>
      </div>

      {/* 总结历史记录抽屉 */}
      <SummaryHistoryDrawer
        isOpen={historyOpen}
        onClose={() => setHistoryOpen(false)}
        onSelectHistory={handleRestoreHistory}
        activeHistoryId={activeHistoryId}
      />
    </div>
  )
}

export default SummaryPage
