import { useState } from 'react'
import { useAppStore, SummaryHistoryItem } from '../store/appStore'
import ConfirmModal from './ConfirmModal'
import RenameModal from './RenameModal'

interface SummaryHistoryDrawerProps {
  isOpen: boolean
  onClose: () => void
  onSelectHistory?: (item: SummaryHistoryItem) => void
}

/**
 * 总结历史记录抽屉组件
 * 从右侧滑出，显示总结对话历史记录
 */
function SummaryHistoryDrawer({ isOpen, onClose, onSelectHistory }: SummaryHistoryDrawerProps): JSX.Element {
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
        className={`fixed inset-0 overlay z-40 transition-opacity duration-200 ${
          isOpen ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'
        }`}
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

      {/* 抽屉面板 - 从右侧弹出 */}
      <div
        className={`fixed right-0 top-0 bottom-0 w-[400px] bg-background-dark border-l border-gray-800 z-50 flex flex-col transform transition-transform duration-300 ${
          isOpen ? 'translate-x-0' : 'translate-x-full'
        }`}
      >
        {/* 头部 */}
        <div className="flex items-center justify-between p-6 border-b border-gray-800">
          <h2 className="text-xl font-semibold text-white">总结历史记录</h2>
          <div className="flex items-center gap-2">
            <button
              onClick={onClose}
              className="text-gray-400 hover:text-white transition-colors"
            >
              <span className="material-symbols-outlined text-2xl">close</span>
            </button>
          </div>
        </div>

        {/* 搜索框 */}
        <div className="p-4 border-b border-gray-800">
          <div className="flex items-center gap-3 px-4 py-2 bg-gray-800 rounded-lg border border-gray-700 focus-within:border-primary/50">
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="搜索历史记录..."
              className="flex-1 bg-transparent border-0 focus:outline-none text-gray-300 placeholder-gray-500"
            />
            <span className="material-symbols-outlined text-gray-400">search</span>
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
            <div className="space-y-3">
              {filteredHistory.map((item) => (
                <div
                  key={item.id}
                  onClick={() => handleSelect(item)}
                  className="group p-4 rounded-lg bg-gray-800/50 border border-gray-700 hover:border-primary/50 cursor-pointer transition-colors"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex-1 min-w-0">
                      <h3 className="text-white font-medium mb-1 line-clamp-1">{item.title}</h3>
                      <p className="text-gray-400 text-sm line-clamp-2">{getPreviewText(item)}</p>
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
                              className="inline-block h-6 w-6 rounded-full ring-1 ring-gray-800 bg-gray-700 object-contain p-0.5"
                            />
                          )
                        })}
                        {item.selectedModels.length > 5 && (
                          <div className="inline-block h-6 w-6 rounded-full ring-1 ring-gray-800 bg-gray-700 flex items-center justify-center text-xs">
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
              ))}
            </div>
          )}
        </div>

        {/* 底部统计 */}
        {summaryHistory.length > 0 && (
          <div className="p-4 border-t border-gray-800 text-xs text-gray-500 text-center">
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
