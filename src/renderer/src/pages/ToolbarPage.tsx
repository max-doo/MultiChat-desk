import React, { useEffect } from 'react'
import logo from '../assets/logo.png'

export default function ToolbarPage(): JSX.Element {
  useEffect(() => {
    // 强制清除全局 body/html 带来的默认矩形实体背景，实现真正的悬浮窗
    document.documentElement.style.setProperty('background', 'transparent', 'important')
    document.body.style.setProperty('background', 'transparent', 'important')
    const rootEl = document.getElementById('root')
    if (rootEl) {
      rootEl.style.setProperty('background', 'transparent', 'important')
    }
    return () => {
      document.documentElement.style.removeProperty('background')
      document.body.style.removeProperty('background')
      if (rootEl) {
        rootEl.style.removeProperty('background')
      }
    }
  }, [])

  const handleAction = (
    event: React.PointerEvent<HTMLButtonElement>,
    action: 'quick' | 'summarize' | 'translate' | 'copy' | 'search'
  ): void => {
    if (event.button !== 0) return
    event.preventDefault()
    if (window.api?.toolbarAction) {
      window.api.toolbarAction(action)
    }
  }

  return (
    <div className="w-full h-full flex items-center justify-center bg-transparent overflow-hidden select-none">
      <div className="flex items-center gap-0.5 px-2.5 py-1.5 bg-white/95 dark:bg-neutral-900/95 border border-black/10 dark:border-white/10 shadow-md rounded-xl transition-all duration-200">
        {/* 快捷窗口 (问问) */}
        <button
          type="button"
          onPointerDown={(event) => handleAction(event, 'quick')}
          className="flex items-center gap-1 px-2 py-0.5 rounded-lg text-neutral-700 dark:text-neutral-200 hover:text-neutral-950 dark:hover:text-white hover:bg-black/5 dark:hover:bg-white/10 transition-colors duration-150 cursor-pointer"
          title="问问"
        >
          <img src={logo} alt="问问" className="w-5 h-5 object-contain" />
          <span className="text-xs font-medium leading-none">问问</span>
        </button>

        {/* 搜索按钮 */}
        <button
          type="button"
          onPointerDown={(event) => handleAction(event, 'search')}
          className="flex items-center gap-1 px-2 py-0.5 rounded-lg text-neutral-700 dark:text-neutral-200 hover:text-neutral-950 dark:hover:text-white hover:bg-black/5 dark:hover:bg-white/10 transition-colors duration-150 cursor-pointer"
          title="搜索"
        >
          <span className="material-symbols-outlined text-[20px]">search</span>
          <span className="text-xs font-medium leading-none">搜索</span>
        </button>

        {/* 总结按钮 */}
        <button
          type="button"
          onPointerDown={(event) => handleAction(event, 'summarize')}
          className="flex items-center gap-1 px-2 py-0.5 rounded-lg text-neutral-700 dark:text-neutral-200 hover:text-neutral-950 dark:hover:text-white hover:bg-black/5 dark:hover:bg-white/10 transition-colors duration-150 cursor-pointer"
          title="总结"
        >
          <span className="material-symbols-outlined text-[20px]">compress</span>
          <span className="text-xs font-medium leading-none">总结</span>
        </button>

        {/* 翻译按钮 */}
        <button
          type="button"
          onPointerDown={(event) => handleAction(event, 'translate')}
          className="flex items-center gap-1 px-2 py-0.5 rounded-lg text-neutral-700 dark:text-neutral-200 hover:text-neutral-950 dark:hover:text-white hover:bg-black/5 dark:hover:bg-white/10 transition-colors duration-150 cursor-pointer"
          title="翻译"
        >
          <span className="material-symbols-outlined text-[20px]">translate</span>
          <span className="text-xs font-medium leading-none">翻译</span>
        </button>

        {/* 复制按钮 */}
        <button
          type="button"
          onPointerDown={(event) => handleAction(event, 'copy')}
          className="flex items-center gap-1 px-2 py-0.5 rounded-lg text-neutral-700 dark:text-neutral-200 hover:text-neutral-950 dark:hover:text-white hover:bg-black/5 dark:hover:bg-white/10 transition-colors duration-150 cursor-pointer"
          title="复制"
        >
          <span className="material-symbols-outlined text-[20px]">content_copy</span>
          <span className="text-xs font-medium leading-none">复制</span>
        </button>
      </div>
    </div>
  )
}
