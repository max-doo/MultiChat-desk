import { useRef, useEffect, useState, useMemo } from 'react'
import { useAppStore } from '../../store/appStore'
import { useWorkbenchStore } from '../../store/workbenchStore'
import WebviewCard, { type WebviewCardRef } from '../WebviewCard'

export default function WorkbenchAiSidebar(): JSX.Element {
  const models = useAppStore((s) => s.models)
  const sidebarModelId = useWorkbenchStore((s) => s.sidebarModelId)
  const setSidebarModelId = useWorkbenchStore((s) => s.setSidebarModelId)
  const isRightCollapsed = useWorkbenchStore((s) => s.isRightCollapsed)
  const toggleRightCollapse = useWorkbenchStore((s) => s.toggleRightCollapse)

  const webviewRef = useRef<WebviewCardRef | null>(null)
  const [modelDropdownOpen, setModelDropdownOpen] = useState(false)

  // 筛选可用模型
  const availableModels = useMemo(() => models.filter((m) => m.enabled), [models])
  const currentModel = useMemo(() => {
    return (
      availableModels.find((m) => m.id === sidebarModelId) ||
      availableModels[0] ||
      models[0]
    )
  }, [availableModels, models, sidebarModelId])

  // 监听来自划词动作的文本注入事件
  useEffect(() => {
    const handleInsertPrompt = (e: Event) => {
      const customEvent = e as CustomEvent<{ prompt: string }>
      const prompt = customEvent.detail?.prompt
      if (prompt && webviewRef.current) {
        void webviewRef.current.insertText(prompt)
      }
    }

    window.addEventListener('workbench:insert-prompt', handleInsertPrompt)
    return () => {
      window.removeEventListener('workbench:insert-prompt', handleInsertPrompt)
    }
  }, [])

  if (isRightCollapsed) {
    return (
      <div className="w-10 h-full bg-slate-50/70 dark:bg-gray-900/50 backdrop-blur-md border-l border-black/5 dark:border-white/5 flex flex-col items-center py-3 select-none">
        <button
          type="button"
          onClick={toggleRightCollapse}
          className="w-7 h-7 flex items-center justify-center rounded-lg hover:bg-black/5 dark:hover:bg-white/5 text-text-secondary hover:text-text-primary transition-colors"
          title="展开 AI 侧边栏"
        >
          <span className="material-symbols-outlined text-[18px]">dock_to_right</span>
        </button>
        <div
          className="mt-6 writing-mode-vertical text-[11px] font-medium text-text-secondary tracking-widest cursor-pointer hover:text-text-primary transition-colors"
          onClick={toggleRightCollapse}
        >
          AI 侧边栏
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full bg-white dark:bg-gray-900 border-l border-black/5 dark:border-white/5 overflow-hidden">
      {/* 头部控制栏 */}
      <div className="h-10 px-3 bg-white/70 dark:bg-gray-800/70 backdrop-blur-md border-b border-black/5 dark:border-white/5 flex items-center justify-between shrink-0 select-none text-xs">
        {/* 平台选择下拉 */}
        <div className="relative">
          <button
            type="button"
            onClick={() => setModelDropdownOpen(!modelDropdownOpen)}
            className="flex items-center gap-2 px-2 py-1 rounded-lg hover:bg-black/5 dark:hover:bg-white/5 transition-colors font-medium text-text-primary"
          >
            {currentModel?.logo && (
              <img
                src={currentModel.logo}
                alt={currentModel.name}
                className="w-4 h-4 rounded-full object-cover"
              />
            )}
            <span className="truncate max-w-[120px]">{currentModel?.name || '选择平台'}</span>
            <span className="material-symbols-outlined text-[15px] text-text-secondary">
              arrow_drop_down
            </span>
          </button>

          {modelDropdownOpen && (
            <div
              className="absolute left-0 top-full mt-1 w-44 py-1 bg-white dark:bg-gray-800 rounded-xl shadow-xl border border-black/10 dark:border-white/10 z-30 max-h-64 overflow-y-auto animate-in fade-in zoom-in-95 duration-100"
              onMouseLeave={() => setModelDropdownOpen(false)}
            >
              {availableModels.map((m) => (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => {
                    setSidebarModelId(m.id)
                    setModelDropdownOpen(false)
                  }}
                  className={`w-full flex items-center gap-2 px-3 py-1.5 text-left text-xs transition-colors ${
                    m.id === currentModel?.id
                      ? 'bg-blue-50 dark:bg-blue-900/30 text-primary dark:text-blue-400 font-medium'
                      : 'text-text-primary hover:bg-black/5 dark:hover:bg-white/5'
                  }`}
                >
                  <img src={m.logo} alt={m.name} className="w-4 h-4 rounded-full object-cover" />
                  <span className="truncate flex-1">{m.name}</span>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* 右侧动作按钮 */}
        <div className="flex items-center gap-0.5 text-text-secondary">
          <button
            type="button"
            onClick={() => webviewRef.current?.reload()}
            className="w-7 h-7 flex items-center justify-center rounded hover:bg-black/5 dark:hover:bg-white/5 hover:text-text-primary transition-colors"
            title="刷新网页"
          >
            <span className="material-symbols-outlined text-[16px]">refresh</span>
          </button>
          <button
            type="button"
            onClick={toggleRightCollapse}
            className="w-7 h-7 flex items-center justify-center rounded hover:bg-black/5 dark:hover:bg-white/5 hover:text-text-primary transition-colors"
            title="折叠 AI 侧边栏"
          >
            <span className="material-symbols-outlined text-[16px]">chevron_right</span>
          </button>
        </div>
      </div>

      {/* Webview 卡片容器 */}
      <div className="flex-1 relative overflow-hidden bg-white dark:bg-gray-900">
        {currentModel && (
          <WebviewCard
            ref={webviewRef}
            id={currentModel.id}
            name={currentModel.name}
            url={currentModel.url}
            logo={currentModel.logo}
            enabled={currentModel.enabled}
            slotIndex={99}
            isolated={true}
            hideHeader={true}
            flat={true}
            compact={true}
            webviewInstanceId={`workbench-ai-sidebar-${currentModel.id}`}
          />
        )}
      </div>
    </div>
  )
}
