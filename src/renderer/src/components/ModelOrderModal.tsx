import { useState, useEffect } from 'react'
import { useAppStore, DEFAULT_MODEL_ORDER, type ModelConfig } from '../store/appStore'

interface ModelOrderModalProps {
  isOpen: boolean
  onClose: () => void
}

export default function ModelOrderModal({ isOpen, onClose }: ModelOrderModalProps): JSX.Element | null {
  const models = useAppStore((state) => state.models)
  const reorderModels = useAppStore((state) => state.reorderModels)

  const [orderedList, setOrderedList] = useState<ModelConfig[]>(models)
  const [draggedIndex, setDraggedIndex] = useState<number | null>(null)
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null)

  // 当外部 models 变化或弹窗打开时同步状态
  useEffect(() => {
    if (isOpen) {
      setOrderedList(models)
      setDraggedIndex(null)
      setDragOverIndex(null)
    }
  }, [isOpen, models])

  if (!isOpen) return null

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

    setOrderedList(nextList)
    setDraggedIndex(null)
    setDragOverIndex(null)

    // 拖拽释放时立即自动保存生效
    reorderModels(nextList.map((m) => m.id))
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

    setOrderedList(nextList)
    reorderModels(nextList.map((m) => m.id))
  }

  const handleResetDefault = (): void => {
    reorderModels(DEFAULT_MODEL_ORDER)
    const modelMap = new Map(models.map((m) => [m.id, m]))
    const resetList = DEFAULT_MODEL_ORDER.map((id) => modelMap.get(id)).filter(Boolean) as ModelConfig[]
    setOrderedList(resetList)
  }

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
      {/* 遮罩层 */}
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />

      {/* 弹窗主体 */}
      <div className="relative w-full max-w-lg max-h-[85vh] glass-panel-heavy rounded-2xl shadow-float flex flex-col overflow-hidden animate-in fade-in zoom-in-95 duration-150">
        {/* 头部 */}
        <div className="flex items-center justify-between p-4 border-b border-white/60">
          <div className="flex items-center gap-2.5">
            <span className="material-symbols-outlined text-primary text-2xl">swap_vert</span>
            <div>
              <h3 className="text-base font-semibold text-text-primary">模型下拉列表排序</h3>
              <p className="text-xs text-text-secondary mt-0.5">
                拖拽调整模型在窗口卡片及各下拉菜单中的顺序，常用模型可排在前面
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
          {orderedList.map((model, index) => {
            const isDragging = draggedIndex === index
            const isDragOver = dragOverIndex === index && draggedIndex !== index

            return (
              <div
                key={model.id}
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
                      : 'glass-panel hover:bg-white/80 border-white/60 hover:shadow-soft'
                }`}
              >
                {/* 左侧：拖拽手柄 + 序号 + Logo + 名称 */}
                <div className="flex items-center gap-3 min-w-0">
                  <span
                    className="material-symbols-outlined text-gray-400 hover:text-gray-600 cursor-grab text-lg shrink-0"
                    title="拖拽排序"
                  >
                    drag_indicator
                  </span>
                  <span className="w-5 text-center text-xs font-semibold text-gray-400 shrink-0">
                    {index + 1}
                  </span>
                  <img
                    src={model.logo}
                    alt={model.name}
                    className="w-6 h-6 rounded shrink-0 object-contain"
                  />
                  <div className="truncate">
                    <span className="text-sm font-medium text-text-primary truncate block">
                      {model.name}
                    </span>
                  </div>
                </div>

                {/* 右侧：上移/下移辅助按钮 */}
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
            恢复默认排序
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
