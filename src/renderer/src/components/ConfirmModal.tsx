import { useState } from 'react'
import { AppIcon } from './icons/AppIcon'
import Modal from './ui/Modal'

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
 * 以模态弹窗形式显示（默认无全屏视觉遮罩，仅保留透明点击拦截层）
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
    <Modal open={isOpen} onClose={onCancel} size="sm" variant="solid">
      <div className="p-5">
        <div className="mb-4 flex items-center gap-3">
          <AppIcon name={theme.iconName} size={20} className={theme.icon} />
          <h3 className="text-title font-semibold text-text-primary">{title}</h3>
        </div>

        <p className="mb-6 text-body leading-relaxed text-text-secondary">{message}</p>

        <div className="flex gap-3">
          <button
            onClick={onCancel}
            disabled={isConfirming}
            className="h-9 flex-1 rounded-lg border border-gray-200 bg-sidebar px-4 text-body font-medium text-text-secondary transition-colors hover:bg-gray-100 disabled:opacity-50 dark:border-white/10"
          >
            {cancelText}
          </button>
          <button
            onClick={handleConfirm}
            disabled={isConfirming}
            className={`h-9 flex-1 rounded-lg px-4 text-body font-medium text-white transition-colors disabled:opacity-50 ${theme.button}`}
          >
            {confirmText}
          </button>
        </div>
      </div>
    </Modal>
  )
}

export default ConfirmModal

