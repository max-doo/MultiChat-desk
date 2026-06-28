import React from 'react'

export default function ToolbarPage(): JSX.Element {
  const handleAction = (action: 'summarize' | 'translate' | 'copy'): void => {
    if (window.api?.toolbarAction) {
      window.api.toolbarAction(action)
    }
  }

  return (
    <div className="h-screen w-screen flex items-center justify-center bg-transparent overflow-hidden">
      <div className="flex items-center gap-1 px-2.5 py-1 bg-white/95 border border-gray-200 shadow-md rounded-full backdrop-blur-md transition-all duration-200">
        {/* 复制按钮 */}
        <button
          type="button"
          onClick={() => handleAction('copy')}
          className="w-7 h-7 flex items-center justify-center rounded-full text-gray-500 hover:text-gray-800 hover:bg-gray-100 transition-colors duration-150"
          title="复制"
        >
          <span className="material-symbols-outlined text-base">content_copy</span>
        </button>

        <div className="w-[1px] h-3 bg-gray-200/80 mx-0.5" />

        {/* AI 总结按钮 */}
        <button
          type="button"
          onClick={() => handleAction('summarize')}
          className="w-7 h-7 flex items-center justify-center rounded-full text-blue-500 hover:text-blue-700 hover:bg-blue-50 transition-colors duration-150"
          title="AI总结"
        >
          <span className="material-symbols-outlined text-base">summarize</span>
        </button>

        {/* AI 翻译按钮 */}
        <button
          type="button"
          onClick={() => handleAction('translate')}
          className="w-7 h-7 flex items-center justify-center rounded-full text-purple-500 hover:text-purple-700 hover:bg-purple-50 transition-colors duration-150"
          title="翻译"
        >
          <span className="material-symbols-outlined text-base">translate</span>
        </button>
      </div>
    </div>
  )
}
