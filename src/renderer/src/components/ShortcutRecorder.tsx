import React, { useState, useRef, useEffect } from 'react'

interface ShortcutRecorderProps {
  value: string
  onChange: (val: string) => void
  placeholder?: string
  defaultShortcut?: string
}

export default function ShortcutRecorder({
  value,
  onChange,
  placeholder,
  defaultShortcut
}: ShortcutRecorderProps): JSX.Element {
  const [isRecording, setIsRecording] = useState(false)
  const [activeModifiers, setActiveModifiers] = useState<string[]>([])
  const inputRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent): void => {
      if (inputRef.current && !inputRef.current.contains(e.target as Node)) {
        setIsRecording(false)
        setActiveModifiers([])
      }
    }
    if (isRecording) {
      document.addEventListener('mousedown', handleClickOutside)
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [isRecording])

  const formatToBadges = (shortcutStr?: string): string[] => {
    if (!shortcutStr) return []
    return shortcutStr.split('+').map((part) => {
      if (part === 'CommandOrControl' || part === 'CmdOrCtrl') return 'Ctrl'
      if (part === 'Command' || part === 'Cmd') return 'Ctrl'
      if (part === 'Control' || part === 'Ctrl') return 'Ctrl'
      return part
    })
  }

  const handleKeyDown = (e: React.KeyboardEvent): void => {
    if (!isRecording) return

    e.preventDefault()
    e.stopPropagation()

    // ESC 退出录制（如果没有按任何修饰键）
    if (e.key === 'Escape' && !e.ctrlKey && !e.metaKey && !e.shiftKey && !e.altKey) {
      setIsRecording(false)
      setActiveModifiers([])
      return
    }

    // 收集修饰键
    const mods: string[] = []
    if (e.ctrlKey || e.metaKey) mods.push('CommandOrControl')
    if (e.altKey) mods.push('Alt')
    if (e.shiftKey) mods.push('Shift')

    // 过滤纯修饰键本身以及 Windows 中文输入法事件副产物 (Process/229/Dead/Unidentified等)
    const ignoreKeys = [
      'Control', 'Shift', 'Alt', 'Meta',
      'Process', 'Unidentified', 'Dead', 'Hyper', 'Super', 'Symbol'
    ]
    if (ignoreKeys.includes(e.key) || e.keyCode === 229) {
      setActiveModifiers(mods)
      return
    }

    // 处理主按键名称转换
    let keyName = e.key
    if (keyName === ' ') keyName = 'Space'
    else if (keyName === '+') keyName = 'Plus'
    else if (keyName === 'ArrowUp') keyName = 'Up'
    else if (keyName === 'ArrowDown') keyName = 'Down'
    else if (keyName === 'ArrowLeft') keyName = 'Left'
    else if (keyName === 'ArrowRight') keyName = 'Right'
    else if (/^[a-z]$/.test(keyName)) keyName = keyName.toUpperCase()

    // 组合快捷键部分
    const parts = [...mods]
    parts.push(keyName)

    // 校验：必须有修饰键或者是 F1-F12 功能键
    const isFunctionKey = /^F[1-9]$|^F1[0-2]$/.test(keyName)
    if (mods.length === 0 && !isFunctionKey) {
      // 如果没有修饰键且不是功能键，忽略该普通按键（防止误触发）
      return
    }

    const finalShortcut = parts.join('+')
    onChange(finalShortcut)
    setIsRecording(false)
    setActiveModifiers([])
  }

  const handleKeyUp = (e: React.KeyboardEvent): void => {
    if (isRecording) {
      const mods: string[] = []
      if (e.ctrlKey || e.metaKey) mods.push('CommandOrControl')
      if (e.altKey) mods.push('Alt')
      if (e.shiftKey) mods.push('Shift')
      setActiveModifiers(mods)
    }
  }

  const handleClear = (e: React.MouseEvent): void => {
    e.stopPropagation()
    onChange('')
    setIsRecording(false)
  }

  const handleReset = (e: React.MouseEvent): void => {
    e.stopPropagation()
    if (defaultShortcut !== undefined) {
      onChange(defaultShortcut)
    }
    setIsRecording(false)
  }

  return (
    <div className="flex items-center gap-1.5">
      <div
        ref={inputRef}
        tabIndex={0}
        onClick={() => setIsRecording(true)}
        onKeyDown={handleKeyDown}
        onKeyUp={handleKeyUp}
        className={`w-64 px-3 py-1.5 bg-app border rounded-md text-xs cursor-pointer select-none transition-all outline-none flex items-center min-h-[30px] ${
          isRecording
            ? 'border-primary ring-2 ring-primary/20 bg-primary/5'
            : 'border-gray-200 hover:border-gray-300'
        }`}
        title="点击后直接在键盘上按下组合快捷键"
      >
        {isRecording ? (
          <div className="flex items-center gap-1 text-primary text-xs w-full overflow-hidden">
            <span className="w-2 h-2 rounded-full bg-primary animate-ping mr-1" />
            {activeModifiers.length > 0 ? (
              <div className="flex items-center gap-1 flex-wrap">
                {formatToBadges(activeModifiers.join('+')).map((b, i) => (
                  <span
                    key={i}
                    className="px-1 py-0.5 text-[10px] font-mono bg-primary/10 text-primary border border-primary/20 rounded"
                  >
                    {b}
                  </span>
                ))}
                <span>+ ?</span>
              </div>
            ) : (
              <span>请按下快捷键组合 (Esc取消)</span>
            )}
          </div>
        ) : value ? (
          <div className="flex items-center gap-1 flex-wrap">
            {formatToBadges(value).map((badge, idx) => (
              <span
                key={idx}
                className="px-1.5 py-0.5 text-[11px] font-mono bg-gray-100 border border-gray-300 rounded text-text-primary shadow-2xs font-medium"
              >
                {badge}
              </span>
            ))}
          </div>
        ) : (
          <div className="flex items-center gap-1 flex-wrap opacity-60">
            <span className="text-[10px] text-gray-400 mr-0.5">未设置:</span>
            {formatToBadges(placeholder || '').map((badge, idx) => (
              <span
                key={idx}
                className="px-1.5 py-0.5 text-[10px] font-mono bg-gray-50 border border-gray-200 rounded text-gray-500"
              >
                {badge}
              </span>
            ))}
          </div>
        )}
      </div>

      {/* 清空按钮 */}
      {value ? (
        <button
          type="button"
          onClick={handleClear}
          className="p-1 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded transition-colors flex items-center justify-center"
          title="清空快捷键 (关闭)"
        >
          <span className="material-symbols-outlined text-sm">close</span>
        </button>
      ) : (
        <div className="w-6" />
      )}

      {/* 重置默认按钮 */}
      {defaultShortcut !== undefined && value !== defaultShortcut && (
        <button
          type="button"
          onClick={handleReset}
          className="p-1 text-gray-400 hover:text-primary hover:bg-primary/10 rounded transition-colors flex items-center justify-center"
          title={`恢复推荐默认值 (${defaultShortcut})`}
        >
          <span className="material-symbols-outlined text-sm">restart_alt</span>
        </button>
      )}
    </div>
  )
}
