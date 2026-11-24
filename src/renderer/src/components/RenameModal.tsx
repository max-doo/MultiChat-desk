import { useEffect, useState } from 'react'
import Modal from './ui/Modal'

interface RenameModalProps {
  isOpen: boolean
  title?: string
  placeholder?: string
  initialValue?: string
  confirmText?: string
  cancelText?: string
  onConfirm: (value: string) => void | Promise<void>
  onCancel: () => void
}

function RenameModal({
  isOpen,
  title = '重命名',
  placeholder = '输入新的名称',
  initialValue = '',
  confirmText = '保存',
  cancelText = '取消',
  onConfirm,
  onCancel
}: RenameModalProps): JSX.Element | null {
  const [value, setValue] = useState('')
  const [error, setError] = useState('')
  const [isConfirming, setIsConfirming] = useState(false)

  useEffect(() => {
    if (!isOpen) return
    setValue(initialValue || '')
    setError('')
    setIsConfirming(false)
  }, [isOpen, initialValue])

  const handleConfirm = async (): Promise<void> => {
    const trimmed = value.trim()
    if (!trimmed) {
      setError('名称不能为空')
      return
    }
    if (isConfirming) return
    setIsConfirming(true)
    try {
      await onConfirm(trimmed)
    } finally {
      setIsConfirming(false)
    }
  }

  return (
    <Modal open={isOpen} onClose={onCancel} size="md" variant="solid">
      <div>
        <div className="border-b border-gray-200 px-6 pb-4 pt-5 dark:border-white/10">
          <h3 className="text-title font-semibold text-text-primary">{title}</h3>
        </div>
        <div className="px-6 py-5">
          <input
            value={value}
            onChange={(e) => {
              setValue(e.target.value)
              if (error) setError('')
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleConfirm()
              if (e.key === 'Escape') onCancel()
            }}
            className="w-full rounded-lg border border-gray-200 bg-sidebar px-4 py-2.5 text-body text-text-primary placeholder-gray-500 focus:border-primary/60 focus:outline-none dark:border-white/10 dark:bg-white/5"
            placeholder={placeholder}
            autoFocus
          />
          {error ? (
            <div className="mt-2 text-body text-red-400">{error}</div>
          ) : null}
        </div>
        <div className="flex items-center justify-end gap-3 px-6 pb-5">
          <button
            onClick={onCancel}
            disabled={isConfirming}
            className="rounded-lg border border-gray-200 bg-sidebar px-4 py-2 text-body text-text-secondary transition-all hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-50 dark:border-white/10"
          >
            {cancelText}
          </button>
          <button
            onClick={handleConfirm}
            disabled={isConfirming}
            className="rounded-lg bg-primary px-4 py-2 text-body font-medium text-white transition-all hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {confirmText}
          </button>
        </div>
      </div>
    </Modal>
  )
}

export default RenameModal

