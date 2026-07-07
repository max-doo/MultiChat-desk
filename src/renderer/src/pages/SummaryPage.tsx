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
  const { models, displayMode, productMode, taskAssignmentSlots, multiAiSlots, debateSlots, pendingSummarySession, setPendingSummarySession, history, currentConversationId, isHistoryOpen, setHistoryOpen, activeModels, isNewSession, textInserted } = useAppStore()

  const [activeHistoryId, setActiveHistoryId] = useState<string | undefined>(undefined)

  // 获取当前实际显示的模型（根据 displayMode 和产品模式插槽配置）
  const displayedModels = useMemo(() => {
    return getDisplayedModels(models, displayMode, productMode, taskAssignmentSlots, multiAiSlots, debateSlots)
  }, [models, displayMode, productMode, taskAssignmentSlots, multiAiSlots, debateSlots])

  // 目标模型列表：如果会话活跃且 activeModels 非空，则展示参与本次对话的模型；否则展示全部当前槽位模型
  const targetModels = useMemo(() => {
    const isSessionActive = !isNewSession || textInserted
    return isSessionActive && activeModels.length > 0
      ? activeModels
      : displayedModels
  }, [isNewSession, textInserted, activeModels, displayedModels])

  // 默认选中所有目标模型
  const [selectedModels, setSelectedModels] = useState<string[]>(
    targetModels.map(m => m.id)
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

  const renderableModels = useMemo(() => {
    if (restoreHistoryData) {
      // 恢复历史记录时，不受当前主页面窗口显示的 displayedModels 限制，而是使用历史记录中实际有回复的模型
      const historicalModelIds = Object.keys(restoreHistoryData.modelResponses || {})
      return historicalModelIds
        .map(id => {
          const found = models.find(m => m.id === id)
          if (found) return found
          // 兜底，避免历史记录中的模型在当前配置中不存在
          return {
            id,
            name: id,
            url: '',
            logo: '',
            enabled: true
          }
        })
        .filter(m => (modelResponses[m.id] || '').trim().length > 0)
    }
    return targetModels
  }, [targetModels, modelResponses, restoreHistoryData, models])

  // 拖拽调整宽度状态
  const [rightPanelWidth, setRightPanelWidth] = useState(40) // 默认 40%
  const containerRef = useRef<HTMLDivElement>(null)

  const handleMouseDown = (e: React.MouseEvent) => {
    e.preventDefault()
    
    const handleMouseMove = (moveEvent: MouseEvent) => {
      if (containerRef.current) {
        const containerWidth = containerRef.current.offsetWidth
        const newWidth = ((containerWidth - moveEvent.clientX) / containerWidth) * 100
        // 限制宽度在 40% 到 60% 之间（最小和默认宽度为 40%，最大为 60%）
        setRightPanelWidth(Math.min(Math.max(newWidth, 40), 60))
      }
    }
    
    const handleMouseUp = () => {
      document.removeEventListener('mousemove', handleMouseMove)
      document.removeEventListener('mouseup', handleMouseUp)
      document.body.style.cursor = 'default'
    }
    
    document.body.style.cursor = 'col-resize'
    document.addEventListener('mousemove', handleMouseMove)
    document.addEventListener('mouseup', handleMouseUp)
  }


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
    // 恢复历史记录时，清空当前激活的本地历史快照 ID 列表，避免旧快照横幅依然显示
    setSnapshotModelIds([])

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

      const modelsWithData = targetModels
        .filter(m => data[m.id]?.trim().length > 0)
        .map(m => m.id)
      setSelectedModels(modelsWithData.length > 0 ? modelsWithData : targetModels.map(m => m.id))
      // 新进入总结页（非历史恢复）必须清空 restoreHistoryData，否则 renderableModels 会一直走历史分支，
      // 且 useSummaryPanel 的 useEffect([restoreHistoryData]) 会让新总结写回旧历史。
      setRestoreHistoryData(null)
      setIsLoadingResponses(false)
      return
    }

    if (!initDoneRef.current) {
      initDoneRef.current = true
      setIsLoadingResponses(true)
      let data: Record<string, string> = {}
      const latestItem = history.find(h => h.id === currentConversationId)
      const latestTurn = latestItem?.turns?.[latestItem.turns.length - 1]
      if (latestTurn?.responses && Object.keys(latestTurn.responses).length > 0) {
        data = latestTurn.responses
        console.log('[SummaryPage] 从 history fallback 加载:', Object.keys(data))
      }
      setModelResponses(data)
      const modelsWithData = targetModels
        .filter(m => data[m.id]?.trim().length > 0)
        .map(m => m.id)
      setSelectedModels(modelsWithData.length > 0 ? modelsWithData : targetModels.map(m => m.id))
      setIsLoadingResponses(false)
    }
  }, [initialHistoryItem, pendingSummarySession, targetModels, setPendingSummarySession])

  return (
    <div className="flex h-full overflow-hidden" ref={containerRef}>
      {/* 左侧：返回按钮 + 模型回复内容 */}
      <div className="p-6 flex flex-col h-full overflow-hidden flex-1">
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
                onContentChange={(newContent) => {
                  setModelResponses(prev => ({
                    ...prev,
                    [model.id]: newContent
                  }))
                }}
              />
            ))}
          </div>
        )}
      </div>

      {/* 拖拽调整宽度的把手 */}
      <div
        className="w-1 cursor-col-resize hover:bg-primary/50 active:bg-primary bg-gray-200 transition-colors z-10 shrink-0"
        onMouseDown={handleMouseDown}
        title="拖拽调整宽度"
      />

      {/* 右侧：总结的对话框 + 底部输入框 */}
      <div 
        className="p-6 flex flex-col h-full overflow-hidden"
        style={{ width: `${rightPanelWidth}%` }}
      >
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
