import { useState } from 'react'
import { Virtuoso } from 'react-virtuoso'
import { useAppStore, HistoryItem, SummaryHistoryItem, ModelConfig } from '../store/appStore'
import ConfirmModal from './ConfirmModal'
import RenameModal from './RenameModal'

interface HistoryDrawerProps {
  isOpen: boolean
  onClose: () => void
  onSelectHistory?: (item: HistoryItem) => void
  onSelectSummaryHistory?: (item: SummaryHistoryItem) => void
  activeHistoryId?: string
}

/**
 * 历史记录抽屉组件
 * 从左侧滑出，显示对话历史记录和总结历史记录
 */
function HistoryDrawer({ isOpen, onClose, onSelectHistory, onSelectSummaryHistory, activeHistoryId }: HistoryDrawerProps): JSX.Element {
  const [searchQuery, setSearchQuery] = useState('')
  const [isSelectionMode, setIsSelectionMode] = useState(false)
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [activeTab, setActiveTab] = useState<'conversation' | 'summary'>('conversation')
  const [showConfirmDelete, setShowConfirmDelete] = useState(false)
  const [showRenameModal, setShowRenameModal] = useState(false)
  const [renameType, setRenameType] = useState<'conversation' | 'summary'>('conversation')
  const [renameTargetId, setRenameTargetId] = useState<string>('')
  const [renameValue, setRenameValue] = useState('')
  const { history, summaryHistory, removeHistories, removeSummaryHistories, updateHistory, updateSummaryHistory, models } = useAppStore()

  // 过滤对话历史记录
  const filteredHistory = history.filter(item =>
    (item.title ?? item.turns[0]?.userMessage ?? '').toLowerCase().includes(searchQuery.toLowerCase())
  )

  // 过滤总结历史记录
  const filteredSummaryHistory = summaryHistory.filter(item =>
    item.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
    item.messages.some(msg => msg.content.toLowerCase().includes(searchQuery.toLowerCase()))
  )

  // 获取模型名称
  const getModelNames = (modelIds: string[]) => {
    return modelIds
      .map(id => models.find(m => m.id === id)?.name || id)
      .join(', ')
  }

  // 获取第一条总结用户消息作为预览
  const getSummaryPreviewText = (item: SummaryHistoryItem) => {
    const firstUserMessage = item.messages.find(msg => msg.role === 'user')
    if (firstUserMessage) {
      return firstUserMessage.content.length > 100
        ? firstUserMessage.content.substring(0, 100) + '...'
        : firstUserMessage.content
    }
    return '无预览内容'
  }

  const openRename = (type: 'conversation' | 'summary', id: string, currentText: string) => {
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
      } else {
        removeSummaryHistories(selectedIds)
      }
      setSelectedIds([])
      setIsSelectionMode(false)
      setShowConfirmDelete(false)
    }
  }

  // 处理选择对话历史
  const handleSelect = (item: HistoryItem) => {
    if (isSelectionMode) {
      setSelectedIds(prev =>
        prev.includes(item.id) ? prev.filter(i => i !== item.id) : [...prev, item.id]
      )
      return
    }
    if (onSelectHistory) {
      onSelectHistory(item)
      onClose()
    }
  }

  // 处理选择总结历史
  const handleSelectSummary = (item: SummaryHistoryItem) => {
    if (isSelectionMode) {
      setSelectedIds(prev =>
        prev.includes(item.id) ? prev.filter(i => i !== item.id) : [...prev, item.id]
      )
      return
    }
    if (onSelectSummaryHistory) {
      onSelectSummaryHistory(item)
      onClose()
    }
  }

  return (
    <>
      {/* 遮罩层 */}
      <div
        className={`fixed inset-0 overlay z-40 transition-opacity duration-200 ${isOpen ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'
          }`}
        onClick={isOpen ? onClose : undefined}
      />
      <RenameModal
        isOpen={showRenameModal}
        title="重命名"
        placeholder={renameType === 'conversation' ? '输入新的对话标题' : '输入新的总结标题'}
        initialValue={renameValue}
        onCancel={closeRename}
        onConfirm={async (value) => {
          if (renameType === 'conversation') {
            updateHistory(renameTargetId, { title: value })
          } else {
            updateSummaryHistory(renameTargetId, { title: value })
          }
          closeRename()
        }}
      />

        {/* 抽屉面板 */}
        <div 
          className={`fixed left-0 top-0 bottom-0 w-[400px] glass-panel-heavy border-r border-white/40 z-50 flex flex-col transform transition-all duration-300 ease-in-out ${
            isOpen ? 'translate-x-0 shadow-2xl' : '-translate-x-full shadow-none'
          }`}
          onClick={e => e.stopPropagation()}
        >
          {/* 头部 */}
          <div className="flex items-center justify-between p-6 border-b border-white/40">
          <h2 className="text-xl font-semibold text-text-primary">历史记录</h2>
          <div className="flex items-center gap-2">
            {!isSelectionMode ? (
              <>
                {(activeTab === 'conversation' ? history.length > 0 : summaryHistory.length > 0) && (
                  <button
                    onClick={toggleSelectionMode}
                    className="text-text-secondary hover:text-red-400 transition-colors p-1"
                    title="开启多选删除"
                  >
                    <span className="material-symbols-outlined">delete</span>
                  </button>
                )}
              </>
            ) : (
              <>
                <button
                  onClick={toggleSelectionMode}
                  className="text-sm px-3 py-1.5 rounded-lg bg-sidebar text-text-secondary hover:text-text-primary hover:bg-gray-100 transition-all border border-gray-200"
                >
                  取消
                </button>
                <button
                  disabled={selectedIds.length === 0}
                  onClick={() => setShowConfirmDelete(true)}
                  className="text-sm px-3 py-1.5 rounded-lg bg-red-500/10 text-red-500 hover:bg-red-500 hover:text-text-primary border border-red-500/20 hover:border-red-500 transition-all disabled:opacity-30 disabled:cursor-not-allowed flex items-center gap-1.5"
                >
                  <span className="material-symbols-outlined text-sm">delete</span>
                  确认删除 {selectedIds.length > 0 && `(${selectedIds.length})`}
                </button>
              </>
            )}
            <button
              onClick={onClose}
              className="text-text-secondary hover:text-text-primary transition-colors ml-1"
            >
              <span className="material-symbols-outlined text-2xl">close</span>
            </button>
          </div>
        </div>

        {/* 搜索框 */}
        <div className="p-4">
          <div className="flex items-center gap-3 px-4 py-2 bg-sidebar rounded-lg border border-gray-200 focus-within:border-primary/50">
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="搜索历史记录..."
              className="flex-1 bg-transparent border-0 focus:outline-none text-text-secondary placeholder-gray-500"
            />
            <span className="material-symbols-outlined text-text-secondary">search</span>
          </div>
        </div>

        {/* 标签页 */}
        <div className="flex px-6 gap-8 border-b border-gray-200">
          <button
            onClick={() => {
              setActiveTab('conversation')
              setIsSelectionMode(false)
              setSelectedIds([])
            }}
            className={`py-3 text-sm font-medium transition-all border-b-2 ${activeTab === 'conversation'
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
            className={`py-3 text-sm font-medium transition-all border-b-2 ${activeTab === 'summary'
              ? 'border-primary text-primary'
              : 'border-transparent text-text-secondary hover:text-text-primary'
              }`}
          >
            总结历史
          </button>
        </div>

        {/* 历史记录列表 */}
        <div className="flex-1 overflow-y-auto p-4">
          {activeTab === 'conversation' ? (
            /* 对话历史列表 */
            filteredHistory.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full text-gray-500">
                <span className="material-symbols-outlined text-4xl mb-2">forum</span>
                <p>{searchQuery ? '未找到匹配的对话' : '暂无对话历史'}</p>
              </div>
            ) : (
              <Virtuoso
                data={filteredHistory}
                itemContent={(_index, item) => {
                  const isSelected = selectedIds.includes(item.id)
                  const isActive = activeHistoryId === item.id
                  return (
                    <div className="pb-3">
                      <div
                        onClick={() => handleSelect(item)}
                        className={`group p-4 rounded-lg bg-sidebar/50 border transition-all ${isSelected
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
                            {isSelected && <span className="material-symbols-outlined text-xs text-black font-bold">check</span>}
                          </div>
                        )}
                        <div className="flex-1 min-w-0">
                          <div className="flex items-start justify-between gap-2">
                            <p className={`line-clamp-2 flex-1 transition-colors ${isSelected ? 'text-primary' : 'text-text-secondary'}`}>
                              {item.title ?? item.turns[0]?.userMessage ?? '(无消息)'}
                            </p>
                            {!isSelectionMode && (
                              <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-all">
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation()
                                    openRename('conversation', item.id, item.title ?? item.turns[0]?.userMessage ?? '')
                                  }}
                                  className="text-gray-500 hover:text-primary transition-all p-1"
                                  title="重命名"
                                >
                                  <span className="material-symbols-outlined text-xl">edit</span>
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
                                  <span className="material-symbols-outlined text-xl">delete</span>
                                </button>
                              </div>
                            )}
                          </div>
                          <div className="flex items-center justify-between text-xs text-gray-500 mt-2">
                            <span>{new Date(item.createdAt).toLocaleString('zh-CN')}</span>
                            <span className="ml-2 text-gray-600">{item.turns.length} 轮</span>
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
                                      className="inline-block h-6 w-6 rounded-full ring-1 ring-gray-800 bg-gray-100 object-contain p-0.5"
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
            )
          ) : (
            /* 总结历史列表 */
            filteredSummaryHistory.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full text-gray-500">
                <span className="material-symbols-outlined text-4xl mb-2">summarize</span>
                <p>{searchQuery ? '未找到匹配的总结' : '暂无总结历史'}</p>
              </div>
            ) : (
              <Virtuoso
                data={filteredSummaryHistory}
                itemContent={(_index, item) => {
                  const isSelected = selectedIds.includes(item.id)
                  const isActive = activeHistoryId === item.id
                  return (
                    <div className="pb-3">
                      <div
                        onClick={() => handleSelectSummary(item)}
                        className={`group p-4 rounded-lg bg-sidebar/50 border transition-all ${isSelected
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
                            {isSelected && <span className="material-symbols-outlined text-xs text-black font-bold">check</span>}
                          </div>
                        )}
                        <div className="flex-1 min-w-0">
                          <div className="flex items-start justify-between gap-2">
                            <div className="flex-1 min-w-0">
                              <h3 className={`font-medium mb-1 line-clamp-1 ${isSelected ? 'text-primary' : 'text-text-primary'}`}>
                                {item.title}
                              </h3>
                              <p className="text-text-secondary text-sm line-clamp-2">{getSummaryPreviewText(item)}</p>
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
                                  <span className="material-symbols-outlined text-xl">edit</span>
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
                                  <span className="material-symbols-outlined text-xl">delete</span>
                                </button>
                              </div>
                            )}
                          </div>
                          <div className="flex items-center justify-between text-xs text-gray-500 mt-3">
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
                                      className="inline-block h-6 w-6 rounded-full ring-1 ring-gray-800 bg-gray-100 object-contain p-0.5"
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
            )
          )}
        </div>

        {/* 底部统计 */}
        <div className="p-4 border-t border-gray-200 text-xs text-gray-500 text-center">
          {isSelectionMode
            ? `已选择 ${selectedIds.length} 条记录`
            : `共 ${activeTab === 'conversation' ? history.length : summaryHistory.length} 条记录`
          }
        </div>
      </div>

      <ConfirmModal
        isOpen={showConfirmDelete}
        title="确认删除"
        message={selectedIds.length === 1
          ? `确定要删除这条${activeTab === 'conversation' ? '对话' : '总结'}记录吗？此操作无法撤销。`
          : `确定要删除选中的 ${selectedIds.length} 条${activeTab === 'conversation' ? '对话' : '总结'}记录吗？此操作无法撤销。`
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
