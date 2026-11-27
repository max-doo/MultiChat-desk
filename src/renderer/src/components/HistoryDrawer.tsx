import type { HistoryListItem, SummaryHistoryListItem } from '../../../shared/types/history'
import { useState, useEffect } from 'react'
import { Virtuoso } from 'react-virtuoso'
import { useAppStore, HistoryItem, SummaryHistoryItem } from '../store/appStore'
import { useAgentSessionStore } from '../store/agentSessionStore'
import ConfirmModal from './ConfirmModal'
import RenameModal from './RenameModal'
import logo from '../assets/logo.png'
import { openUpdateRelease, useUpdateReminder } from '../hooks/useUpdateState'
import { AppIcon } from './icons/AppIcon'
import WorkbenchSidebarSearchBar from './workbench/WorkbenchSidebarSearchBar'
import type { AgentSessionSummary } from '../types/agent'

type HistoryTab = 'conversation' | 'summary' | 'agent'

interface HistoryDrawerProps {
  isOpen: boolean
  onClose: () => void
  onSelectHistory?: (item: HistoryItem) => void
  onSelectSummaryHistory?: (item: SummaryHistoryItem) => void
  onSelectAgentSession?: (sessionId: string) => void
  activeHistoryId?: string
  /** 打开时自动定位到该 Tab；不传则维持上次状态 */
  initialTab?: HistoryTab
}

/**
 * 历史记录抽屉组件
 * 从左侧滑出，显示对话历史记录、总结历史记录和 Agent 会话记录
 */
function HistoryDrawer({ isOpen, onClose, onSelectHistory, onSelectSummaryHistory, onSelectAgentSession, activeHistoryId, initialTab }: HistoryDrawerProps): JSX.Element {
  const [searchQuery, setSearchQuery] = useState('')
  const [isSelectionMode, setIsSelectionMode] = useState(false)
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [activeTab, setActiveTab] = useState<HistoryTab>('conversation')
  const [showConfirmDelete, setShowConfirmDelete] = useState(false)
  const [showRenameModal, setShowRenameModal] = useState(false)
  const [renameType, setRenameType] = useState<'conversation' | 'summary' | 'agent'>('conversation')
  const [renameTargetId, setRenameTargetId] = useState<string>('')
  const [renameValue, setRenameValue] = useState('')
  const [isLoadingMore, setIsLoadingMore] = useState(false)
  const { hasUpdate, releaseUrl } = useUpdateReminder()

  // 当 isOpen 从 false 变为 true 时，若指定了 initialTab 则切换到该 Tab
  useEffect(() => {
    if (isOpen && initialTab) {
      setActiveTab(initialTab)
    }
  }, [isOpen, initialTab])
  const {
    historyList: history,
    summaryHistoryList: summaryHistory,
    historySaveError,
    historyReadWarning,
    retryHistorySave,
    historyTotalCount,
    summaryHistoryTotalCount,
    loadMoreHistory,
    loadMoreSummaryHistory,
    removeHistories,
    removeSummaryHistories,
    updateHistory,
    updateSummaryHistory,
    models
  } = useAppStore()
  const agentSessions = useAgentSessionStore((s) => s.sessions)
  const agentFetchSessions = useAgentSessionStore((s) => s.fetchSessions)
  const agentDeleteSession = useAgentSessionStore((s) => s.deleteSession)
  const agentRenameSession = useAgentSessionStore((s) => s.renameSession)
  const agentCurrentSessionId = useAgentSessionStore((s) => s.currentSessionId)

  // 抽屉打开时拉取一次 Agent 会话列表；会话内新消息返回后列表已在 store 中
  useEffect(() => {
    if (isOpen) {
      void agentFetchSessions()
    }
  }, [isOpen, agentFetchSessions])

  // 是否还有更老的磁盘记录未加载进内存
  const hasMoreHistory = history.length < historyTotalCount
  const hasMoreSummaryHistory = summaryHistory.length < summaryHistoryTotalCount

  const handleLoadMore = async (type: 'conversation' | 'summary'): Promise<void> => {
    if (isLoadingMore) return
    // 搜索激活时分页会与过滤索引错位，禁用加载更多
    if (searchQuery.trim() !== '') return
    setIsLoadingMore(true)
    try {
      if (type === 'conversation') {
        await loadMoreHistory()
      } else {
        await loadMoreSummaryHistory()
      }
    } catch (err) {
      console.error('[HistoryDrawer] loadMore failed:', err)
    } finally {
      setIsLoadingMore(false)
    }
  }

  const [searchResults, setSearchResults] = useState<(HistoryListItem | SummaryHistoryListItem)[] | null>(null)
  useEffect(() => {
    let active = true
    setSearchResults(null)
    // Agent 会话仅内存中已有列表，直接本地过滤；历史/总结走磁盘搜索
    if (!searchQuery.trim() || activeTab === 'agent') return
    const timer = setTimeout(() => {
      void window.api.historySearch(activeTab as 'conversation' | 'summary', searchQuery).then(result => {
        if (active && result.success) setSearchResults(result.data || [])
      })
    }, 200)
    return () => { active = false; clearTimeout(timer) }
  }, [searchQuery, activeTab, history, summaryHistory])
  const filteredHistory = (searchResults && activeTab === 'conversation' ? searchResults as HistoryListItem[] : history.filter(item => item.title.toLowerCase().includes(searchQuery.toLowerCase())))
  const filteredSummaryHistory = (searchResults && activeTab === 'summary' ? searchResults as SummaryHistoryListItem[] : summaryHistory.filter(item => item.title.toLowerCase().includes(searchQuery.toLowerCase()) || item.preview.toLowerCase().includes(searchQuery.toLowerCase())))
  const queryLower = searchQuery.trim().toLowerCase()
  const filteredAgentSessions: AgentSessionSummary[] = queryLower === ''
    ? agentSessions
    : agentSessions.filter(item =>
      (item.title || '').toLowerCase().includes(queryLower) ||
      (item.model || '').toLowerCase().includes(queryLower) ||
      (item.cwd || '').toLowerCase().includes(queryLower)
    )

  // 获取模型名称
  const getModelNames = (modelIds: string[]) => {
    return modelIds
      .map(id => models.find(m => m.id === id)?.name || id)
      .join(', ')
  }

  // 获取第一条总结用户消息作为预览
  const getSummaryPreviewText = (item: SummaryHistoryListItem): string => item.preview || '无预览内容'

  const openRename = (type: 'conversation' | 'summary' | 'agent', id: string, currentText: string) => {
    setRenameType(type)
    setRenameTargetId(id)
    setRenameValue(currentText)
    setShowRenameModal(true)
  }

  const closeRename = () => {
    setShowRenameModal(false)
    setRenameTargetId('')
    setRenameValue('')
  }

  // 切换选择模式
  const toggleSelectionMode = () => {
    if (isSelectionMode) {
      setSelectedIds([])
    }
    setIsSelectionMode(!isSelectionMode)
  }

  // 确认删除所选项
  const confirmDelete = () => {
    if (selectedIds.length > 0) {
      if (activeTab === 'conversation') {
        removeHistories(selectedIds)
      } else if (activeTab === 'summary') {
        removeSummaryHistories(selectedIds)
      } else {
        selectedIds.forEach(id => void agentDeleteSession(id))
      }
      setSelectedIds([])
      setIsSelectionMode(false)
      setShowConfirmDelete(false)
    }
  }

  // 处理选择对话历史
  const handleSelect = async (item: HistoryListItem) => {
    if (isSelectionMode) {
      setSelectedIds(prev =>
        prev.includes(item.id) ? prev.filter(i => i !== item.id) : [...prev, item.id]
      )
      return
    }
    if (onSelectHistory) {
      const result = await window.api.historyGet('conversation', item.id)
      if (!result.success || !result.data) { alert(result.error || '读取历史失败'); return }
      const full = result.data as HistoryItem
      useAppStore.setState(state => ({ history: [full, ...state.history.filter(old => old.id !== full.id)].slice(0, 100) }))
      onSelectHistory(full)
      onClose()
    }
  }

  // 处理选择总结历史
  const handleSelectSummary = async (item: SummaryHistoryListItem) => {
    if (isSelectionMode) {
      setSelectedIds(prev =>
        prev.includes(item.id) ? prev.filter(i => i !== item.id) : [...prev, item.id]
      )
      return
    }
    if (onSelectSummaryHistory) {
      const result = await window.api.historyGet('summary', item.id)
      if (!result.success || !result.data) { alert(result.error || '读取总结历史失败'); return }
      const full = result.data as SummaryHistoryItem
      useAppStore.setState(state => ({ summaryHistory: [full, ...state.summaryHistory.filter(old => old.id !== full.id)].slice(0, 100) }))
      onSelectSummaryHistory(full)
      onClose()
    }
  }

  // 处理选择 Agent 会话
  const handleSelectAgent = (item: AgentSessionSummary) => {
    if (isSelectionMode) {
      setSelectedIds(prev =>
        prev.includes(item.id) ? prev.filter(i => i !== item.id) : [...prev, item.id]
      )
      return
    }
    onSelectAgentSession?.(item.id)
  }

  return (
    <>
      {/* 遮罩层 */}
      <div
        className={`fixed inset-0 overlay z-40 transition-opacity duration-200 ${isOpen ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'
          }`}
        style={{ WebkitAppRegion: 'no-drag' } as any}
        onClick={isOpen ? onClose : undefined}
      />
      <RenameModal
        isOpen={showRenameModal}
        title="重命名"
        placeholder={renameType === 'summary' ? '输入新的总结标题' : '输入新的对话标题'}
        initialValue={renameValue}
        onCancel={closeRename}
        onConfirm={async (value) => {
          if (renameType === 'conversation') {
            await updateHistory(renameTargetId, { title: value })
          } else if (renameType === 'summary') {
            await updateSummaryHistory(renameTargetId, { title: value })
          } else {
            await agentRenameSession(renameTargetId, value)
          }
          closeRename()
        }}
      />

        {/* 抽屉面板 */}
        <div 
          className={`fixed left-0 top-0 bottom-0 w-[500px] glass-panel-heavy border-r border-white/40 z-50 flex flex-col rounded-r-3xl overflow-hidden transform transition-all duration-300 ease-in-out ${
            isOpen ? 'translate-x-0 shadow-2xl' : '-translate-x-full shadow-none'
          }`}
          style={{ WebkitAppRegion: 'no-drag' } as any}
          onClick={e => e.stopPropagation()}
        >
          {/* 头部 */}
          <div className="relative flex items-center justify-between p-4 border-b border-white/40">
            {/* 左侧 Logo 和产品名称 */}
            {hasUpdate ? (
              <button
                type="button"
                onClick={() => openUpdateRelease(releaseUrl)}
                className="flex items-center gap-2 text-text-primary rounded-lg hover:bg-white/60 transition-colors"
                title="发现新版本，打开发布页"
              >
                <img src={logo} alt="MultiChat Logo" className="w-6 h-6 object-contain" />
                <span className="font-semibold text-primary text-body tracking-wide">MultiChat</span>
                <span className="text-tiny leading-none font-bold text-red-500 bg-red-50 border border-red-200 px-1.5 py-0.5 rounded-full">NEW</span>
              </button>
            ) : (
              <div className="flex items-center gap-2 text-text-primary">
                <img src={logo} alt="MultiChat Logo" className="w-6 h-6 object-contain" />
                <span className="font-semibold text-primary text-body tracking-wide">MultiChat</span>
              </div>
            )}

            {historyReadWarning && <span className="text-caption text-amber-700" title={historyReadWarning}>历史读取提示</span>}
            {historySaveError && <button className="text-label text-red-600 hover:underline" title={historySaveError} onClick={() => void retryHistorySave()}>历史保存失败，重试</button>}
            {/* 中间标题 */}
            <div className="absolute left-1/2 transform -translate-x-1/2">
              <h2 className="text-title font-semibold text-text-primary">历史记录</h2>
            </div>

            <div className="flex items-center gap-2 z-10">
              {!isSelectionMode ? (
                <>
                  {(activeTab === 'conversation' ? history.length > 0 : activeTab === 'summary' ? summaryHistory.length > 0 : agentSessions.length > 0) && (
                    <button
                      onClick={toggleSelectionMode}
                      className="text-text-secondary hover:text-red-500 transition-colors p-1 rounded-md hover:bg-black/5"
                      title="开启多选删除"
                    >
                      <AppIcon name="delete" size={16} />
                    </button>
                  )}
                </>
              ) : (
                <>
                  <button
                    onClick={toggleSelectionMode}
                    className="text-label px-2.5 py-1 rounded-lg bg-sidebar text-text-secondary hover:text-text-primary hover:bg-gray-100 transition-all border border-gray-200"
                  >
                    取消
                  </button>
                  <button
                    disabled={selectedIds.length === 0}
                    onClick={() => setShowConfirmDelete(true)}
                    className="text-label px-2.5 py-1 rounded-lg bg-red-500/10 text-red-500 hover:bg-red-500 hover:text-white border border-red-500/20 hover:border-red-500 transition-all disabled:opacity-30 disabled:cursor-not-allowed flex items-center gap-1.5"
                  >
                    <AppIcon name="delete" size={14} />
                    确认删除 {selectedIds.length > 0 && `(${selectedIds.length})`}
                  </button>
                </>
              )}
              <button
                onClick={onClose}
                className="text-text-secondary hover:text-text-primary transition-colors ml-1"
              >
                <AppIcon name="close" size={20} />
              </button>
            </div>
          </div>

        {/* 搜索框 */}
        <WorkbenchSidebarSearchBar
          value={searchQuery}
          onChange={setSearchQuery}
          placeholder="搜索历史记录..."
          onClose={searchQuery ? () => setSearchQuery('') : undefined}
          closeLabel="清空搜索"
          className="p-3 pb-2 shrink-0"
        />

        {/* 标签页 */}
        <div className="flex px-4 gap-6 border-b border-gray-200">
          <button
            onClick={() => {
              setActiveTab('conversation')
              setIsSelectionMode(false)
              setSelectedIds([])
            }}
            className={`py-2.5 text-body font-medium transition-all border-b-2 ${activeTab === 'conversation'
              ? 'border-primary text-primary'
              : 'border-transparent text-text-secondary hover:text-text-primary'
              }`}
          >
            对话历史
          </button>
          <button
            onClick={() => {
              setActiveTab('summary')
              setIsSelectionMode(false)
              setSelectedIds([])
            }}
            className={`py-2.5 text-body font-medium transition-all border-b-2 ${activeTab === 'summary'
              ? 'border-primary text-primary'
              : 'border-transparent text-text-secondary hover:text-text-primary'
              }`}
          >
            总结历史
          </button>
          <button
            onClick={() => {
              setActiveTab('agent')
              setIsSelectionMode(false)
              setSelectedIds([])
            }}
            className={`py-2.5 text-body font-medium transition-all border-b-2 ${activeTab === 'agent'
              ? 'border-primary text-primary'
              : 'border-transparent text-text-secondary hover:text-text-primary'
              }`}
          >
            Agent 会话
          </button>
        </div>

        {/* 历史记录列表 */}
        <div className="flex-1 overflow-y-auto p-3">
          {activeTab === 'conversation' ? (
            /* 对话历史列表 */
            filteredHistory.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full text-gray-500">
                <AppIcon name="forum" size={36} className="mb-2" />
                <p>{searchQuery ? '未找到匹配的对话' : '暂无对话历史'}</p>
              </div>
            ) : (
              <>
              <Virtuoso
                data={filteredHistory}
                itemContent={(_index, item) => {
                  const isSelected = selectedIds.includes(item.id)
                  const isActive = activeHistoryId === item.id
                  const displayTitle = item.title || '(无消息)'
                  return (
                    <div className="pb-2.5">
                      <div
                        onClick={() => handleSelect(item)}
                        className={`group p-3 rounded-lg bg-sidebar/50 border transition-all ${isSelected
                          ? 'border-primary bg-primary/5'
                          : isActive
                            ? 'border-primary/60 bg-primary/10'
                            : 'border-gray-200 hover:border-primary/50'
                          } cursor-pointer flex items-center gap-3 relative`}
                      >
                        {isActive && (
                          <div className="absolute left-0 top-3 bottom-3 w-1 rounded-r-full bg-primary" />
                        )}
                        {isSelectionMode && (
                          <div className={`w-5 h-5 rounded border flex items-center justify-center transition-colors flex-shrink-0 ${isSelected ? 'bg-primary border-primary' : 'border-gray-500'
                            }`}>
                            {isSelected && <AppIcon name="check" size={12} className="text-black font-bold" />}
                          </div>
                        )}
                        <div className="flex-1 min-w-0">
                          <div className="flex items-start justify-between gap-2">
                            <p className={`text-body font-medium line-clamp-2 flex-1 transition-colors ${isSelected ? 'text-primary' : 'text-text-primary'}`}>
                              {displayTitle}
                            </p>
                            {!isSelectionMode && (
                              <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-all">
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation()
                                    openRename('conversation', item.id, displayTitle)
                                  }}
                                  className="text-gray-500 hover:text-primary transition-all p-1"
                                  title="重命名"
                                >
                                  <AppIcon name="edit" size={16} />
                                </button>
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation()
                                    setSelectedIds([item.id])
                                    setShowConfirmDelete(true)
                                  }}
                                  className="text-gray-500 hover:text-red-400 transition-all p-1"
                                  title="删除记录"
                                >
                                  <AppIcon name="delete" size={16} />
                                </button>
                              </div>
                            )}
                          </div>
                          <div className="flex items-center justify-between text-caption text-text-secondary mt-2">
                            <div className="flex items-center gap-2">
                              <span>{new Date(item.createdAt).toLocaleString('zh-CN')}</span>
                              {item.productMode && (
                                <span className="px-1.5 py-0.5 rounded text-tiny bg-primary/10 text-primary border border-primary/20 leading-none">
                                  {item.productMode === 'multi_ai' ? '多模型' : item.productMode === 'task_assignment' ? '任务分发' : '双主辩论'}
                                </span>
                              )}
                              <span className="text-text-secondary">
                                {item.productMode === 'debate'
                                  ? `${item.turnCount} 轮辩论`
                                  : `${item.turnCount} 轮`}
                              </span>
                            </div>
                            <div className="flex items-center gap-2" title={getModelNames(item.models)}>
                              <span className="whitespace-nowrap">{item.models.length} 个模型</span>
                              <div className="flex -space-x-1.5 overflow-hidden">
                                {item.models.map((modelId) => {
                                  const model = models.find((m) => m.id === modelId)
                                  if (!model) return null
                                  return (
                                    <img
                                      key={modelId}
                                      src={model.logo}
                                      alt={model.name}
                                      className="inline-block h-5 w-5 rounded-full ring-1 ring-white/80 bg-gray-100 object-contain p-0.5"
                                    />
                                  )
                                })}
                              </div>
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>
                  )
                }}
              />
                {hasMoreHistory && (
                  <button
                    onClick={() => handleLoadMore('conversation')}
                    disabled={isLoadingMore || searchQuery.trim() !== ''}
                    className="w-full mt-2 py-2 text-sm text-text-secondary hover:text-primary border border-gray-200 rounded-lg transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {isLoadingMore ? '加载中...' : searchQuery.trim() !== '' ? '搜索时不支持加载更多' : '加载更多历史记录'}
                  </button>
                )}
              </>
            )
          ) : activeTab === 'summary' ? (
            /* 总结历史列表 */
            filteredSummaryHistory.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full text-gray-500">
                <AppIcon name="summarize" size={36} className="mb-2" />
                <p>{searchQuery ? '未找到匹配的总结' : '暂无总结历史'}</p>
              </div>
            ) : (
              <>
              <Virtuoso
                data={filteredSummaryHistory}
                itemContent={(_index, item) => {
                  const isSelected = selectedIds.includes(item.id)
                  const isActive = activeHistoryId === item.id
                  return (
                    <div className="pb-2.5">
                      <div
                        onClick={() => handleSelectSummary(item)}
                        className={`group p-3 rounded-lg bg-sidebar/50 border transition-all ${isSelected
                          ? 'border-primary bg-primary/5'
                          : isActive
                            ? 'border-primary/60 bg-primary/10'
                            : 'border-gray-200 hover:border-primary/50'
                          } cursor-pointer flex items-center gap-3 relative`}
                      >
                        {isActive && (
                          <div className="absolute left-0 top-3 bottom-3 w-1 rounded-r-full bg-primary" />
                        )}
                        {isSelectionMode && (
                          <div className={`w-5 h-5 rounded border flex items-center justify-center transition-colors flex-shrink-0 ${isSelected ? 'bg-primary border-primary' : 'border-gray-500'
                            }`}>
                            {isSelected && <AppIcon name="check" size={12} className="text-black font-bold" />}
                          </div>
                        )}
                        <div className="flex-1 min-w-0">
                          <div className="flex items-start justify-between gap-2">
                            <div className="flex-1 min-w-0">
                              <h3 className={`text-body font-medium mb-1 line-clamp-1 ${isSelected ? 'text-primary' : 'text-text-primary'}`}>
                                {item.title}
                              </h3>
                              <p className="text-text-secondary text-label line-clamp-2">{getSummaryPreviewText(item)}</p>
                            </div>
                            {!isSelectionMode && (
                              <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-all flex-shrink-0">
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation()
                                    openRename('summary', item.id, item.title)
                                  }}
                                  className="text-gray-500 hover:text-primary transition-all p-1"
                                  title="重命名"
                                >
                                  <AppIcon name="edit" size={16} />
                                </button>
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation()
                                    setSelectedIds([item.id])
                                    setShowConfirmDelete(true)
                                  }}
                                  className="text-gray-500 hover:text-red-400 transition-all p-1"
                                  title="删除记录"
                                >
                                  <AppIcon name="delete" size={16} />
                                </button>
                              </div>
                            )}
                          </div>
                          <div className="flex items-center justify-between text-caption text-text-secondary mt-2">
                            <span>{new Date(item.timestamp).toLocaleString('zh-CN')}</span>
                            <div className="flex items-center gap-2" title={getModelNames(item.selectedModels)}>
                              <span className="whitespace-nowrap">{item.selectedModels.length} 个模型</span>
                              <div className="flex -space-x-1.5 overflow-hidden">
                                {item.selectedModels.slice(0, 5).map((modelId) => {
                                  const model = models.find((m) => m.id === modelId)
                                  if (!model) return null
                                  return (
                                    <img
                                      key={modelId}
                                      src={model.logo}
                                      alt={model.name}
                                      className="inline-block h-5 w-5 rounded-full ring-1 ring-white/80 bg-gray-100 object-contain p-0.5"
                                    />
                                  )
                                })}
                              </div>
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>
                  )
                }}
              />
                {hasMoreSummaryHistory && (
                  <button
                    onClick={() => handleLoadMore('summary')}
                    disabled={isLoadingMore || searchQuery.trim() !== ''}
                    className="w-full mt-2 py-2 text-sm text-text-secondary hover:text-primary border border-gray-200 rounded-lg transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {isLoadingMore ? '加载中...' : searchQuery.trim() !== '' ? '搜索时不支持加载更多' : '加载更多总结历史'}
                  </button>
                )}
              </>
            )
          ) : (
            /* Agent 会话列表 */
            filteredAgentSessions.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full text-gray-500">
                <AppIcon name="smart_toy" size={36} className="mb-2" />
                <p>{searchQuery ? '未找到匹配的会话' : '暂无 Agent 会话'}</p>
              </div>
            ) : (
              <Virtuoso
                data={filteredAgentSessions}
                itemContent={(_index, item) => {
                  const isSelected = selectedIds.includes(item.id)
                  const isActive = agentCurrentSessionId === item.id
                  return (
                    <div className="pb-2.5">
                      <div
                        onClick={() => handleSelectAgent(item)}
                        className={`group p-3 rounded-lg bg-sidebar/50 border transition-all ${isSelected
                          ? 'border-primary bg-primary/5'
                          : isActive
                            ? 'border-primary/60 bg-primary/10'
                            : 'border-gray-200 hover:border-primary/50'
                          } cursor-pointer flex items-center gap-3 relative`}
                      >
                        {isActive && (
                          <div className="absolute left-0 top-3 bottom-3 w-1 rounded-r-full bg-primary" />
                        )}
                        {isSelectionMode && (
                          <div className={`w-5 h-5 rounded border flex items-center justify-center transition-colors flex-shrink-0 ${isSelected ? 'bg-primary border-primary' : 'border-gray-500'
                            }`}>
                            {isSelected && <AppIcon name="check" size={12} className="text-black font-bold" />}
                          </div>
                        )}
                        <div className="flex-1 min-w-0">
                          <div className="flex items-start justify-between gap-2">
                            <div className="flex-1 min-w-0">
                              <h3 className={`text-body font-medium line-clamp-1 ${isSelected ? 'text-primary' : 'text-text-primary'}`}>
                                {item.title || '新对话'}
                              </h3>
                              <p className="text-caption text-text-secondary mt-1 line-clamp-1">
                                {[
                                  item.model,
                                  item.cwd,
                                  new Date(item.updatedAt || item.createdAt).toLocaleString('zh-CN')
                                ].filter(Boolean).join(' · ')}
                              </p>
                            </div>
                            {!isSelectionMode && (
                              <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-all flex-shrink-0">
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation()
                                    openRename('agent', item.id, item.name || item.title || '')
                                  }}
                                  className="text-gray-500 hover:text-primary transition-all p-1"
                                  title="重命名"
                                >
                                  <AppIcon name="edit" size={16} />
                                </button>
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation()
                                    setSelectedIds([item.id])
                                    setShowConfirmDelete(true)
                                  }}
                                  className="text-gray-500 hover:text-red-400 transition-all p-1"
                                  title="删除记录"
                                >
                                  <AppIcon name="delete" size={16} />
                                </button>
                              </div>
                            )}
                          </div>
                        </div>
                      </div>
                    </div>
                  )
                }}
              />
            )
          )}
        </div>

        {/* 底部统计 */}
        <div className="px-4 py-3 border-t border-gray-200 text-caption text-text-secondary text-center">
          {isSelectionMode
            ? `已选择 ${selectedIds.length} 条记录`
            : activeTab === 'agent'
              ? `共 ${agentSessions.length} 条会话`
              : `已加载 ${activeTab === 'conversation' ? history.length : summaryHistory.length} / 共 ${activeTab === 'conversation' ? historyTotalCount : summaryHistoryTotalCount} 条记录`
          }
          <div className="mt-1">新增时每类最多保留 1000 条，优先移除最早更新的记录；可在设置中导出完整备份。</div>
        </div>
      </div>

      <ConfirmModal
        isOpen={showConfirmDelete}
        title="确认删除"
        message={selectedIds.length === 1
          ? `确定要删除这条${activeTab === 'conversation' ? '对话' : activeTab === 'summary' ? '总结' : 'Agent 会话'}记录吗？此操作无法撤销。`
          : `确定要删除选中的 ${selectedIds.length} 条${activeTab === 'conversation' ? '对话' : activeTab === 'summary' ? '总结' : 'Agent 会话'}记录吗？此操作无法撤销。`
        }
        confirmText="确认删除"
        onConfirm={confirmDelete}
        onCancel={() => {
          setShowConfirmDelete(false)
          // 如果不是在复选模式下取消的，清空选中
          if (!isSelectionMode) {
            setSelectedIds([])
          }
        }}
      />
    </>
  )
}

export default HistoryDrawer
