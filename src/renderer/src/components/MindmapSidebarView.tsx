import React, { useState, useCallback } from 'react'
import WebviewCard, { type WebviewCardRef } from './WebviewCard'
import LocalMindmapPanel from './LocalMindmapPanel'
import ConversationMindmapPanel, { type MindmapSource as ConversationSource } from './ConversationMindmapPanel'

export interface MindmapSidebarViewProps {
  instancePrefix: string
  mindmapRef: React.MutableRefObject<WebviewCardRef | null>
  onClose: () => void
  conversationSource?: ConversationSource
  draggableHeader?: boolean
  onDragStart?: (e: React.PointerEvent<HTMLDivElement>) => void
}

type MindmapSource = 'local' | 'online'

const SOURCE_STORAGE_KEY = 'multichat_mindmap_source_preference'

export default function MindmapSidebarView({
  instancePrefix,
  mindmapRef,
  onClose,
  conversationSource,
  draggableHeader,
  onDragStart
}: MindmapSidebarViewProps): JSX.Element {
  // 思维导图数据源：'local'（自研本地） | 'online'（幕布在线），默认 local
  const [source, setSource] = useState<MindmapSource>(() => {
    try {
      const saved = localStorage.getItem(SOURCE_STORAGE_KEY)
      if (saved === 'online' || saved === 'local') return saved
    } catch {
      // 忽略存储错误
    }
    return 'local'
  })

  const handleSourceChange = useCallback((newSource: MindmapSource) => {
    setSource(newSource)
    try {
      localStorage.setItem(SOURCE_STORAGE_KEY, newSource)
    } catch (err) {
      console.warn('[MindmapSidebarView] 无法保存思维导图偏好:', err)
    }
  }, [])

  return (
    <div className="h-full flex flex-col bg-white select-none">
      {/* 顶部 Header 控制栏：只放本地与在线切换 Tab 与关闭按钮 */}
      <div
        className={`px-3 py-2.5 border-b border-gray-200/70 bg-white flex justify-between items-center gap-2 ${
          draggableHeader ? 'drag-region select-none' : ''
        }`}
        onPointerDown={draggableHeader ? (e) => {
          const target = e.target as HTMLElement
          if (target.closest('button') || target.closest('.no-drag') || target.closest('input') || target.closest('select')) return
          if (target.closest('.drag-region') || target === e.currentTarget) {
            e.currentTarget.setPointerCapture(e.pointerId)
            window.api.windowDragStart()
            if (onDragStart) {
              onDragStart(e)
            }
          }
        } : undefined}
      >
        {/* 左侧：图标 + [ 本地 | 在线 ] 分段控件（字号放大，视觉清晰） */}
        <div className="flex items-center gap-2 min-w-0">
          <span className="material-symbols-outlined text-primary text-xl shrink-0">account_tree</span>
          <div className="flex items-center bg-gray-100 p-0.5 rounded-lg text-sm font-medium text-text-secondary select-none no-drag">
            <button
              type="button"
              onClick={() => handleSourceChange('local')}
              className={`px-3 py-1 rounded-md text-xs sm:text-[13px] transition-all ${
                source === 'local'
                  ? 'bg-white text-primary font-semibold shadow-xs'
                  : 'hover:text-text-primary'
              }`}
            >
              本地
            </button>
            <button
              type="button"
              onClick={() => handleSourceChange('online')}
              className={`px-3 py-1 rounded-md text-xs sm:text-[13px] transition-all ${
                source === 'online'
                  ? 'bg-white text-primary font-semibold shadow-xs'
                  : 'hover:text-text-primary'
              }`}
            >
              在线
            </button>
          </div>
        </div>

        {/* 右侧：在线模式下的刷新按钮 + 收起侧边栏按钮 */}
        <div className="flex items-center gap-1 shrink-0">
          {source === 'online' && (
            <button
              type="button"
              onClick={() => mindmapRef.current?.reload()}
              className="w-7 h-7 rounded-full text-text-secondary hover:text-text-primary hover:bg-gray-100 flex items-center justify-center transition-colors"
              title="刷新在线网页"
            >
              <span className="material-symbols-outlined text-base">refresh</span>
            </button>
          )}

          <button
            type="button"
            onClick={onClose}
            className="w-7 h-7 rounded-full text-text-secondary hover:text-red-500 hover:bg-red-50 flex items-center justify-center transition-colors"
            title="收起侧边栏"
            aria-label="收起侧边栏"
          >
            <span className="material-symbols-outlined text-base">close</span>
          </button>
        </div>
      </div>

      {/* 主体展示区域 */}
      <div className="flex-1 min-h-0 relative">
        {/* 本地思维导图区域 */}
        <div
          className="h-full w-full"
          style={{ display: source === 'local' ? 'block' : 'none' }}
        >
          {conversationSource ? <ConversationMindmapPanel source={conversationSource} /> : <LocalMindmapPanel />}
        </div>

        {/* 在线思维导图（幕布）区域：切换为本地时 display: none 保留会话不重新加载 */}
        <div
          className="h-full w-full"
          style={{ display: source === 'online' ? 'block' : 'none' }}
        >
          <WebviewCard
            id={`${instancePrefix}-sidebar-mindmap-card`}
            name="在线思维导图"
            url="https://mubu.com/app"
            logo=""
            enabled={true}
            slotIndex={1}
            compact={true}
            isolated={true}
            flat={true}
            hideHeader={true}
            webviewInstanceId={`${instancePrefix}-sidebar-mindmap`}
            ref={(ref) => {
              mindmapRef.current = ref
            }}
          />
        </div>
      </div>
    </div>
  )
}
