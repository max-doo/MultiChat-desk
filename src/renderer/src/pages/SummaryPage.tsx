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
  const { models, displayMode, productMode, taskAssignmentSlots, multiAiSlots, debateSlots, pendingSummarySession, setPendingSummarySession, history, isHistoryOpen, setHistoryOpen } = useAppStore()

  const [activeHistoryId, setActiveHistoryId] = useState<string | undefined>(undefined)

  // 获取当前实际显示的模型（根据 displayMode 和产品模式插槽配置）
  const displayedModels = useMemo(() => {
    return getDisplayedModels(models, displayMode, productMode, taskAssignmentSlots, multiAiSlots, debateSlots)
  }, [models, displayMode, productMode, taskAssignmentSlots, multiAiSlots, debateSlots])

  // 默认选中所有显示的模型
  const [selectedModels, setSelectedModels] = useState<string[]>(
    displayedModels.map(m => m.id)
  )
  const [modelResponses, setModelResponses] = useState<Record<string, string>>({})

  // 仅渲染真正有回复内容的模型卡片。
  // getDisplayedModels 的槽位兜底（models[index % models.length]）与历史会话恢复时的
  // 「未参与模型回填进槽位」（MainPage.tsx 历史恢复 newOrder）会把用户当前页面根本没打开的模型
  // （如 gemini/claude 等禁用模型）也列入 displayedModels。若直接渲染全部，这些模型
  // 在 modelResponses 中无内容，会显示成「暂无回复内容」的空回复框 —— 即多 AI 模式下的 phantom 空框。
  // 这里复用 selectedModels 已采用的过滤口径（见下方 modelsWithData），保持渲染与选中口径一致。
  // 注意：必须声明在 modelResponses 的 useState 之后，否则 useMemo 在渲染期访问会触发 TDZ。
  // 回落分支不返回 displayedModels：当 modelResponses 全空（抓取全失败 / 异常 / 未发消息即点总结）
  // 时，displayedModels 仍含被 newOrder 回填的未参与模型，回落会把这些模型渲染成 phantom 空框。
  // 无数据时返回空数组，由外层空态承载，比一排假空框更诚实。
  const renderableModels = useMemo(() => {
    return displayedModels.filter(m => (modelResponses[m.id] || '').trim().length > 0)
  }, [displayedModels, modelResponses])
  const [snapshotModelIds, setSnapshotModelIds] = useState<string[]>([])
  // 从辩论模式进入总结页时预选的总结模板 id（仅首次挂载消费一次）
  const [presetSummaryMode, setPresetSummaryMode] = useState<string | undefined>(undefined)
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
    summarySource?: 'api' | 'webview'
    webviewPlatformId?: string
    webviewUrl?: string
  } | null>(null)

  // 切换模型选择状态
  const toggleModelSelection = (modelId: string): void => {
    setSelectedModels(prev => 
      prev.includes(modelId)
        ? prev.filter(id => id !== modelId)
        : [...prev, modelId]
    )
  }

  // 抽取恢复历史记录的逻辑
  const handleRestoreHistory = (item: SummaryHistoryItem): void => {
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
      modelResponses: item.modelResponses || {},
      summarySource: item.summarySource,
      webviewPlatformId: item.webviewPlatformId,
      webviewUrl: item.webviewUrl
    })

    setTimeout(() => {
      setIsLoadingResponses(false)
    }, 200)
  }

  // 初始化：响应 pendingSummarySession 或 initialHistoryItem 变化以更新模型回复
  const initDoneRef = useRef(false)
  const lastHistoryItemRef = useRef<SummaryHistoryItem | undefined>(undefined)

  useEffect(() => {
    if (initialHistoryItem && initialHistoryItem !== lastHistoryItemRef.current) {
      lastHistoryItemRef.current = initialHistoryItem
      initDoneRef.current = true
      handleRestoreHistory(initialHistoryItem)
      return
    }

    const session = pendingSummarySession
    if (session) {
      initDoneRef.current = true
      lastHistoryItemRef.current = undefined
      setIsLoadingResponses(true)
      const data = session.modelResponses || {}
      if (session.presetSummaryMode) setPresetSummaryMode(session.presetSummaryMode)
      setPendingSummarySession(null)
      console.log('[SummaryPage] 从 pendingSummarySession 加载:', Object.keys(data))
      setModelResponses(data)
      setSnapshotModelIds(session.snapshotModelIds ?? [])

      const modelsWithData = displayedModels
        .filter(m => data[m.id]?.trim().length > 0)
        .map(m => m.id)
      setSelectedModels(modelsWithData.length > 0 ? modelsWithData : displayedModels.map(m => m.id))
      setRestoreHistoryData(null)
      setIsLoadingResponses(false)
      return
    }

    if (!initDoneRef.current) {
      initDoneRef.current = true
      setIsLoadingResponses(true)
      let data: Record<string, string> = {}
      const latestItem = history[0]
      const latestTurn = latestItem?.turns?.[latestItem.turns.length - 1]
      if (latestTurn?.responses && Object.keys(latestTurn.responses).length > 0) {
        data = latestTurn.responses
        console.log('[SummaryPage] 从 history fallback 加载:', Object.keys(data))
      }
      setModelResponses(data)
      const modelsWithData = displayedModels
        .filter(m => data[m.id]?.trim().length > 0)
        .map(m => m.id)
      setSelectedModels(modelsWithData.length > 0 ? modelsWithData : displayedModels.map(m => m.id))
      setIsLoadingResponses(false)
    }
  }, [initialHistoryItem, pendingSummarySession, displayedModels, history, setPendingSummarySession])

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

        {snapshotModelIds.length > 0 && (
          <div className="flex items-center gap-2 px-4 py-2 bg-amber-50 border-b border-amber-200 text-amber-800 text-sm mb-4 shrink-0">
            <span className="material-symbols-outlined" style={{ fontSize: 18 }}>history</span>
            <span>
              本次总结包含 {snapshotModelIds.length} 个模型的本地历史快照（实时页面不可用）
            </span>
          </div>
        )}

        {isLoadingResponses ? (
          <div className="flex flex-col items-center justify-center h-full text-text-secondary">
            <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin mb-3"></div>
            <p>正在加载模型回复...</p>
          </div>
        ) : (
          <div className="flex-1 overflow-y-auto space-y-4 pr-2 min-h-0">
            {/* 只显示真正有回复内容的模型卡片，避免 phantom 空回复框 */}
            {renderableModels.map((model) => (
              <ModelOutputCard
                key={model.id}
                id={model.id}
                name={model.name}
                logo={model.logo}
                content={modelResponses[model.id] || '暂无回复内容'}
                selected={selectedModels.includes(model.id)}
                onToggle={() => toggleModelSelection(model.id)}
                badge={snapshotModelIds.includes(model.id) ? '快照' : undefined}
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
          isActive={isActive}
          presetSummaryMode={presetSummaryMode}
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
