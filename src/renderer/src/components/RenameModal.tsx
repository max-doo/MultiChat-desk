import { useEffect, useState } from 'react'

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

  if (!isOpen) return null

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
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm animate-in fade-in duration-200"
        onClick={onCancel}
      />
      <div className="relative w-full max-w-md bg-gray-900 border border-gray-800 rounded-xl shadow-2xl animate-in zoom-in-95 duration-200">
        <div className="px-6 pt-5 pb-4 border-b border-gray-800">
          <h3 className="text-lg font-semibold text-white">{title}</h3>
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
            className="w-full px-4 py-2.5 rounded-lg bg-gray-800 border border-gray-700 focus:outline-none focus:border-primary/60 text-gray-200 placeholder-gray-500"
            placeholder={placeholder}
            autoFocus
          />
          {error ? (
            <div className="mt-2 text-sm text-red-400">{error}</div>
          ) : null}
        </div>
        <div className="px-6 pb-5 flex items-center justify-end gap-3">
          <button
            onClick={onCancel}
            disabled={isConfirming}
            className="text-sm px-4 py-2 rounded-lg bg-gray-800 text-gray-300 hover:bg-gray-700 transition-all border border-gray-700 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {cancelText}
          </button>
          <button
            onClick={handleConfirm}
            disabled={isConfirming}
            className="text-sm px-4 py-2 rounded-lg bg-primary text-black hover:opacity-90 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {confirmText}
          </button>
        </div>
      </div>
    </div>
  )
}

export default RenameModal

