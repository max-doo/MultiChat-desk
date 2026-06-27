import { useState } from 'react'

interface ConfirmModalProps {
  isOpen: boolean
  title: string
  message: string
  confirmText?: string
  cancelText?: string
  onConfirm: () => void | Promise<void>
  onCancel: () => void
  type?: 'danger' | 'warning' | 'info'
}

/**
 * 通用确认弹窗组件
 * 以全屏遮罩形式显示
 */
function ConfirmModal({
  isOpen,
  title,
  message,
  confirmText = '确认',
  cancelText = '取消',
  onConfirm,
  onCancel,
  type = 'danger'
}: ConfirmModalProps): JSX.Element | null {
  if (!isOpen) return null
  const [isConfirming, setIsConfirming] = useState(false)

  const handleConfirm = async (): Promise<void> => {
    if (isConfirming) return
    setIsConfirming(true)
    try {
      await onConfirm()
    } finally {
      setIsConfirming(false)
    }
  }

  const getThemeClasses = () => {
    switch (type) {
      case 'danger':
        return {
          button: 'bg-red-600 hover:bg-red-500',
          icon: 'text-red-500',
          iconName: 'error'
        }
      case 'warning':
        return {
          button: 'bg-yellow-600 hover:bg-yellow-500',
          icon: 'text-yellow-500',
          iconName: 'warning'
        }
      default:
        return {
          button: 'bg-primary hover:bg-primary/80',
          icon: 'text-primary',
          iconName: 'info'
        }
    }
  }

  const theme = getThemeClasses()

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
      {/* 遮罩层 */}
      <div 
        className="absolute inset-0 bg-black/60 backdrop-blur-sm animate-in fade-in duration-200"
        onClick={onCancel}
      />
      
      {/* 弹窗内容 */}
      <div className="relative w-full max-w-sm bg-app border border-gray-200 rounded-xl shadow-2xl p-6 animate-in zoom-in-95 duration-200">
        <div className="flex items-center gap-3 mb-4">
          <span className={`material-symbols-outlined text-3xl ${theme.icon}`}>
            {theme.iconName}
          </span>
          <h3 className="text-xl font-semibold text-text-primary">{title}</h3>
        </div>
        
        <p className="text-text-secondary mb-8 leading-relaxed">
          {message}
        </p>
        
        <div className="flex gap-3">
          <button
            onClick={onCancel}
            disabled={isConfirming}
            className="flex-1 px-4 py-2 bg-sidebar text-text-secondary rounded-lg hover:bg-gray-100 transition-colors font-medium"
          >
            {cancelText}
          </button>
          <button
            onClick={handleConfirm}
            disabled={isConfirming}
            className={`flex-1 px-4 py-2 text-text-primary rounded-lg transition-colors font-medium ${theme.button}`}
          >
            {confirmText}
          </button>
        </div>
      </div>
    </div>
  )
}

export default ConfirmModal

