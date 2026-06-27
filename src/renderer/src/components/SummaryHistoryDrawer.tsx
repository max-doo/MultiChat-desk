import { useState } from 'react'
import { Virtuoso } from 'react-virtuoso'
import { useAppStore, SummaryHistoryItem } from '../store/appStore'
import ConfirmModal from './ConfirmModal'
import RenameModal from './RenameModal'

interface SummaryHistoryDrawerProps {
  isOpen: boolean
  onClose: () => void
  onSelectHistory?: (item: SummaryHistoryItem) => void
  activeHistoryId?: string
}

/**
 * 总结历史记录抽屉组件
 * 从右侧滑出，显示总结对话历史记录
 */
function SummaryHistoryDrawer({ isOpen, onClose, onSelectHistory, activeHistoryId }: SummaryHistoryDrawerProps): JSX.Element {
  const [searchQuery, setSearchQuery] = useState('')
  const [itemToDelete, setItemToDelete] = useState<string | null>(null)
  const [showRenameModal, setShowRenameModal] = useState(false)
  const [renameTargetId, setRenameTargetId] = useState<string>('')
  const [renameValue, setRenameValue] = useState('')
  const { summaryHistory, removeSummaryHistory, updateSummaryHistory, models } = useAppStore()

  // 过滤历史记录
  const filteredHistory = summaryHistory.filter(item =>
    item.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
    item.messages.some(msg => msg.content.toLowerCase().includes(searchQuery.toLowerCase()))
  )

  // 获取模型名称
  const getModelNames = (modelIds: string[]) => {
    return modelIds
      .map(id => models.find(m => m.id === id)?.name || id)
      .join(', ')
  }

  // 处理删除单条记录
  const handleRemove = (id: string, e: React.MouseEvent) => {
    e.stopPropagation()
    setItemToDelete(id)
  }

  // 确认删除单条记录
  const confirmDelete = () => {
    if (itemToDelete) {
      removeSummaryHistory(itemToDelete)
      setItemToDelete(null)
    }
  }

  // 处理选择历史记录
  const handleSelect = (item: SummaryHistoryItem) => {
    if (onSelectHistory) {
      onSelectHistory(item)
      onClose()
    }
  }

  const openRename = (item: SummaryHistoryItem, e: React.MouseEvent) => {
    e.stopPropagation()
    setRenameTargetId(item.id)
    setRenameValue(item.title)
    setShowRenameModal(true)
  }

  const closeRename = () => {
    setShowRenameModal(false)
    setRenameTargetId('')
    setRenameValue('')
  }

  // 获取第一条用户消息作为预览
  const getPreviewText = (item: SummaryHistoryItem) => {
    const firstUserMessage = item.messages.find(msg => msg.role === 'user')
    if (firstUserMessage) {
      return firstUserMessage.content.length > 100
        ? firstUserMessage.content.substring(0, 100) + '...'
        : firstUserMessage.content
    }
    return '无预览内容'
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
        placeholder="输入新的总结标题"
        initialValue={renameValue}
        onCancel={closeRename}
        onConfirm={async (value) => {
          updateSummaryHistory(renameTargetId, { title: value })
          closeRename()
        }}
      />

      {/* 抽屉面板 - 从左侧弹出 */}
      <div
        className={`fixed left-0 top-0 bottom-0 w-[400px] bg-app border-r border-gray-200 z-50 flex flex-col transform transition-transform duration-300 ${isOpen ? 'translate-x-0' : '-translate-x-full'
          }`}
        style={{ WebkitAppRegion: 'no-drag' } as any}
      >
        {/* 头部 */}
        <div className="flex items-center justify-between p-6 border-b border-gray-200">
          <h2 className="text-xl font-semibold text-text-primary">总结历史记录</h2>
          <div className="flex items-center gap-2">
            <button
              onClick={onClose}
              className="text-text-secondary hover:text-text-primary transition-colors"
            >
              <span className="material-symbols-outlined text-2xl">close</span>
            </button>
          </div>
        </div>

        {/* 搜索框 */}
        <div className="p-4 border-b border-gray-200">
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

        {/* 历史记录列表 */}
        <div className="flex-1 overflow-y-auto p-4">
          {filteredHistory.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-gray-500">
              <span className="material-symbols-outlined text-4xl mb-2">history</span>
              <p>{searchQuery ? '未找到匹配的记录' : '暂无历史记录'}</p>
            </div>
          ) : (
            <Virtuoso
              data={filteredHistory}
              itemContent={(_index, item) => {
                const isActive = activeHistoryId === item.id
                return (
                <div className="pb-3">
                  <div
                    onClick={() => handleSelect(item)}
                    className={`group p-4 rounded-lg bg-sidebar/50 border cursor-pointer transition-all ${isActive
                      ? 'border-primary/60 bg-primary/10'
                      : 'border-gray-200 hover:border-primary/50'
                    } relative`}
                  >
                    {isActive && (
                      <div className="absolute left-0 top-3 bottom-3 w-1 rounded-r-full bg-primary" />
                    )}
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <h3 className="text-text-primary font-medium line-clamp-1">{item.title}</h3>
                          {item.summarySource === 'webview' && (
                            <span className="px-1.5 py-0.5 text-[10px] rounded bg-blue-500/20 text-blue-300 border border-blue-500/40 flex-shrink-0">
                              Webview · {item.webviewPlatformId || '未知'}
                            </span>
                          )}
                        </div>
                        <p className="text-text-secondary text-sm line-clamp-2">{getPreviewText(item)}</p>
                      </div>
                      <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-all flex-shrink-0">
                        <button
                          onClick={(e) => openRename(item, e)}
                          className="text-gray-500 hover:text-primary transition-all p-1"
                          title="重命名"
                        >
                          <span className="material-symbols-outlined text-xl">edit</span>
                        </button>
                        <button
                          onClick={(e) => handleRemove(item.id, e)}
                          className="text-gray-500 hover:text-red-400 transition-all p-1"
                          title="删除此记录"
                        >
                          <span className="material-symbols-outlined text-xl">delete</span>
                        </button>
                      </div>
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
                          {item.selectedModels.length > 5 && (
                            <div className="inline-block h-6 w-6 rounded-full ring-1 ring-gray-800 bg-gray-100 flex items-center justify-center text-xs">
                              +{item.selectedModels.length - 5}
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                    <div className="text-xs text-gray-500 mt-2">
                      {item.messages.length} 条消息
                    </div>
                  </div>
                </div>
              )}}
            />
          )}
        </div>

        {/* 底部统计 */}
        {summaryHistory.length > 0 && (
          <div className="p-4 border-t border-gray-200 text-xs text-gray-500 text-center">
            共 {summaryHistory.length} 条记录
          </div>
        )}
      </div>

      {/* 弹窗组件 */}
      <ConfirmModal
        isOpen={!!itemToDelete}
        title="删除记录"
        message="确定要删除这条总结记录吗？"
        confirmText="确认删除"
        onConfirm={confirmDelete}
        onCancel={() => setItemToDelete(null)}
      />
    </>
  )
}

export default SummaryHistoryDrawer
