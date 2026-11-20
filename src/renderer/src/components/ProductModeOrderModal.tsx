import { useState, useEffect } from 'react'
import { useAppStore, DEFAULT_PRODUCT_MODE_CONFIG, type ProductMode, type ProductModeConfig } from '../store/appStore'

interface ProductModeOrderModalProps {
  isOpen: boolean
  onClose: () => void
}

const MODE_META: Record<ProductMode, { label: string; description: string; icon: string }> = {
  multi_ai: { label: '多AI', description: '多个平台并排展示不同 AI', icon: 'grid_view' },
  task_assignment: { label: '任务分配', description: '同一 AI 多窗口分配不同子任务', icon: 'account_tree' },
  debate: { label: '辩论', description: '两个 AI 围绕话题交互对抗', icon: 'gavel' },
  workbench: { label: '工作台', description: '本地 Markdown 知识库与 AI 协同', icon: 'work' }
}

export default function ProductModeOrderModal({ isOpen, onClose }: ProductModeOrderModalProps): JSX.Element | null {
  const productModeConfig = useAppStore((state) => state.productModeConfig)
  const setProductModeConfig = useAppStore((state) => state.setProductModeConfig)

  const [orderedList, setOrderedList] = useState<ProductMode[]>(productModeConfig.order)
  const [hiddenList, setHiddenList] = useState<ProductMode[]>(productModeConfig.hidden)
  const [draggedIndex, setDraggedIndex] = useState<number | null>(null)
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null)

  // 弹窗打开或外部配置变化时同步本地编辑态
  useEffect(() => {
    if (isOpen) {
      setOrderedList(productModeConfig.order)
      setHiddenList(productModeConfig.hidden)
      setDraggedIndex(null)
      setDragOverIndex(null)
    }
  }, [isOpen, productModeConfig])

  if (!isOpen) return null

  const commit = (order: ProductMode[], hidden: ProductMode[]): void => {
    const next: ProductModeConfig = { order, hidden }
    setOrderedList(order)
    setHiddenList(hidden)
    setProductModeConfig(next)
  }

  const handleDragStart = (e: React.DragEvent<HTMLDivElement>, index: number): void => {
    setDraggedIndex(index)
    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.setData('text/plain', String(index))
  }

  const handleDragOver = (e: React.DragEvent<HTMLDivElement>, index: number): void => {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    if (dragOverIndex !== index) {
      setDragOverIndex(index)
    }
  }

  const handleDragLeave = (e: React.DragEvent<HTMLDivElement>, index: number): void => {
    if (e.currentTarget.contains(e.relatedTarget as Node)) return
    if (dragOverIndex === index) {
      setDragOverIndex(null)
    }
  }

  const handleDrop = (e: React.DragEvent<HTMLDivElement>, targetIndex: number): void => {
    e.preventDefault()
    if (draggedIndex === null || draggedIndex === targetIndex) {
      setDraggedIndex(null)
      setDragOverIndex(null)
      return
    }

    const nextList = [...orderedList]
    const [movedItem] = nextList.splice(draggedIndex, 1)
    nextList.splice(targetIndex, 0, movedItem)

    setDraggedIndex(null)
    setDragOverIndex(null)
    commit(nextList, hiddenList)
  }

  const handleDragEnd = (): void => {
    setDraggedIndex(null)
    setDragOverIndex(null)
  }

  const handleMove = (index: number, direction: 'up' | 'down'): void => {
    const targetIndex = direction === 'up' ? index - 1 : index + 1
    if (targetIndex < 0 || targetIndex >= orderedList.length) return

    const nextList = [...orderedList]
    const [movedItem] = nextList.splice(index, 1)
    nextList.splice(targetIndex, 0, movedItem)
    commit(nextList, hiddenList)
  }

  const handleToggleVisible = (mode: ProductMode): void => {
    if (hiddenList.includes(mode)) {
      commit(orderedList, hiddenList.filter(m => m !== mode))
    } else {
      // 至少保留两个可见模式
      if (orderedList.length - hiddenList.length <= 2) return
      commit(orderedList, [...hiddenList, mode])
    }
  }

  const handleResetDefault = (): void => {
    commit([...DEFAULT_PRODUCT_MODE_CONFIG.order], [...DEFAULT_PRODUCT_MODE_CONFIG.hidden])
  }

  const visibleCount = orderedList.length - hiddenList.length

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
      {/* 遮罩层 */}
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />

      {/* 弹窗主体 */}
      <div className="relative w-full max-w-lg max-h-[85vh] glass-panel-heavy rounded-2xl shadow-float flex flex-col overflow-hidden animate-in fade-in zoom-in-95 duration-150">
        {/* 头部 */}
        <div className="flex items-center justify-between p-4 border-b border-white/60">
          <div className="flex items-center gap-2.5">
            <span className="material-symbols-outlined text-primary text-2xl">view_column_2</span>
            <div>
              <h3 className="text-base font-semibold text-text-primary">主页模式设置</h3>
              <p className="text-xs text-text-secondary mt-0.5">
                调整标题栏模式切换的顺序与显示，至少保留两个
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="w-8 h-8 flex items-center justify-center rounded-full text-text-secondary hover:text-text-primary hover:bg-black/5 transition-colors"
            title="关闭"
          >
            <span className="material-symbols-outlined">close</span>
          </button>
        </div>

        {/* 列表内容 */}
        <div className="flex-1 p-4 overflow-y-auto space-y-2 select-none">
          {orderedList.map((mode, index) => {
            const meta = MODE_META[mode]
            const isDragging = draggedIndex === index
            const isDragOver = dragOverIndex === index && draggedIndex !== index
            const isHidden = hiddenList.includes(mode)
            // 仅剩两个可见时，可见项禁止再隐藏
            const hideDisabled = !isHidden && visibleCount <= 2

            return (
              <div
                key={mode}
                draggable
                onDragStart={(e) => handleDragStart(e, index)}
                onDragOver={(e) => handleDragOver(e, index)}
                onDragLeave={(e) => handleDragLeave(e, index)}
                onDrop={(e) => handleDrop(e, index)}
                onDragEnd={handleDragEnd}
                className={`flex items-center justify-between p-2.5 rounded-xl border transition-all cursor-grab active:cursor-grabbing ${
                  isDragging
                    ? 'opacity-40 bg-gray-100 border-dashed border-gray-400 scale-[0.98]'
                    : isDragOver
                      ? 'bg-primary/10 border-primary shadow-sm -translate-y-0.5'
                      : `glass-panel hover:bg-white/80 border-white/60 hover:shadow-soft ${isHidden ? 'opacity-55' : ''}`
                }`}
              >
                {/* 左侧：拖拽手柄 + 图标 + 名称 */}
                <div className="flex items-center gap-3 min-w-0">
                  <span
                    className="material-symbols-outlined text-gray-400 hover:text-gray-600 cursor-grab text-lg shrink-0"
                    title="拖拽排序"
                  >
                    drag_indicator
                  </span>
                  <span className={`material-symbols-outlined text-xl shrink-0 ${isHidden ? 'text-gray-400' : 'text-primary'}`}>
                    {meta.icon}
                  </span>
                  <div className="truncate">
                    <span className={`text-sm font-medium truncate block ${isHidden ? 'text-text-secondary' : 'text-text-primary'}`}>
                      {meta.label}
                    </span>
                    <span className="text-[11px] text-text-secondary/80 truncate block">
                      {meta.description}
                    </span>
                  </div>
                </div>

                {/* 右侧：上移/下移 + 显隐开关 */}
                <div className="flex items-center gap-1 shrink-0 ml-2">
                  <button
                    type="button"
                    disabled={index === 0}
                    onClick={(e) => {
                      e.stopPropagation()
                      handleMove(index, 'up')
                    }}
                    className="w-7 h-7 flex items-center justify-center rounded-lg text-text-secondary hover:text-primary hover:bg-black/5 disabled:opacity-30 disabled:hover:bg-transparent transition-colors"
                    title="上移"
                  >
                    <span className="material-symbols-outlined text-base">arrow_upward</span>
                  </button>
                  <button
                    type="button"
                    disabled={index === orderedList.length - 1}
                    onClick={(e) => {
                      e.stopPropagation()
                      handleMove(index, 'down')
                    }}
                    className="w-7 h-7 flex items-center justify-center rounded-lg text-text-secondary hover:text-primary hover:bg-black/5 disabled:opacity-30 disabled:hover:bg-transparent transition-colors"
                    title="下移"
                  >
                    <span className="material-symbols-outlined text-base">arrow_downward</span>
                  </button>
                  <button
                    type="button"
                    disabled={hideDisabled}
                    onClick={(e) => {
                      e.stopPropagation()
                      handleToggleVisible(mode)
                    }}
                    className={`w-7 h-7 flex items-center justify-center rounded-lg transition-colors ${
                      isHidden
                        ? 'text-gray-400 hover:text-primary hover:bg-black/5'
                        : 'text-primary hover:bg-black/5'
                    } disabled:opacity-30 disabled:hover:bg-transparent`}
                    title={isHidden ? '显示' : hideDisabled ? '至少保留两个模式' : '隐藏'}
                  >
                    <span className="material-symbols-outlined text-base">
                      {isHidden ? 'visibility_off' : 'visibility'}
                    </span>
                  </button>
                </div>
              </div>
            )
          })}
        </div>

        {/* 底部操作栏 */}
        <div className="flex items-center justify-between p-4 border-t border-white/60 bg-white/40">
          <button
            type="button"
            onClick={handleResetDefault}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium text-text-secondary hover:text-primary hover:bg-black/5 transition-colors"
          >
            <span className="material-symbols-outlined text-sm">restart_alt</span>
            恢复默认
          </button>
          <button
            type="button"
            onClick={onClose}
            className="px-5 py-2 rounded-full bg-primary text-white font-medium shadow-soft hover:opacity-90 transition-all text-sm"
          >
            完成
          </button>
        </div>
      </div>
    </div>
  )
}
