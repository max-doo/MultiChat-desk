import React, { useState, useCallback } from 'react'
import WebviewCard, { type WebviewCardRef } from './WebviewCard'
import StandaloneMindmapPanel from './StandaloneMindmapPanel'
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

export default function MindmapSidebarView({
  instancePrefix,
  mindmapRef,
  onClose,
  conversationSource,
  draggableHeader,
  onDragStart
}: MindmapSidebarViewProps): JSX.Element {
  const [source, setSource] = useState<MindmapSource>('local')
  const [isMubuMounted, setIsMubuMounted] = useState(false)
  const openMubu = useCallback(() => {
    setIsMubuMounted(true)
    setSource('online')
    if (mindmapRef.current?.isHibernated()) void mindmapRef.current.resume()
  }, [mindmapRef])

  return (
    <div className="h-full flex flex-col bg-white select-none">
      {/* 幕布在线模式下的 Header */}
      {source === 'online' && (
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
          <div className="flex items-center gap-2 min-w-0">
            <button
              type="button"
              onClick={() => setSource('local')}
              className="flex items-center gap-1 px-2 py-1 rounded-md text-xs sm:text-[13px] text-text-secondary hover:text-primary hover:bg-gray-100 transition-colors no-drag shrink-0"
              title="返回本地导图"
            >
              <span className="material-symbols-outlined text-base">arrow_back</span>
              返回本地导图
            </button>
            <span className="text-sm font-medium text-text-primary truncate">幕布</span>
          </div>

          {/* 右侧：在线模式下的刷新按钮 + 收起侧边栏按钮 */}
          <div className="flex items-center gap-1 shrink-0">
            <button
              type="button"
              onClick={() => mindmapRef.current?.reload()}
              className="w-7 h-7 rounded-full text-text-secondary hover:text-text-primary hover:bg-gray-100 flex items-center justify-center transition-colors no-drag"
              title="刷新幕布"
              aria-label="刷新幕布"
            >
              <span className="material-symbols-outlined text-base">refresh</span>
            </button>

            <button
              type="button"
              onClick={onClose}
              className="w-7 h-7 rounded-full text-text-secondary hover:text-red-500 hover:bg-red-50 flex items-center justify-center transition-colors no-drag"
              title="收起侧边栏"
              aria-label="收起侧边栏"
            >
              <span className="material-symbols-outlined text-base">close</span>
            </button>
          </div>
        </div>
      )}

      {/* 主体展示区域 */}
      <div className="flex-1 min-h-0 relative">
        {/* 本地思维导图区域 */}
        <div
          className="h-full w-full"
          style={{ display: source === 'local' ? 'block' : 'none' }}
        >
          {conversationSource ? (
            <ConversationMindmapPanel
              source={conversationSource}
              onOpenMubu={openMubu}
              onClose={onClose}
              draggableHeader={draggableHeader}
              onDragStart={onDragStart}
            />
          ) : (
            <div className="h-full flex flex-col">
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
                <div className="flex items-center gap-2 min-w-0">
                  <span className="material-symbols-outlined text-primary text-xl shrink-0">account_tree</span>
                  <span className="text-sm font-medium text-text-primary truncate">思维导图</span>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <button
                    type="button"
                    onClick={onClose}
                    className="w-7 h-7 rounded-full text-text-secondary hover:text-red-500 hover:bg-red-50 flex items-center justify-center transition-colors no-drag"
                    title="收起侧边栏"
                    aria-label="收起侧边栏"
                  >
                    <span className="material-symbols-outlined text-base">close</span>
                  </button>
                </div>
              </div>
              <div className="flex-1 min-h-0">
                <StandaloneMindmapPanel onOpenMubu={openMubu} />
              </div>
            </div>
          )}
        </div>

        {/* 幕布按需加载，返回本地时保留页面，沿用侧栏休眠管理。 */}
        {isMubuMounted && (
          <div
            className="h-full w-full"
            style={{ display: source === 'online' ? 'block' : 'none' }}
          >
            <WebviewCard
              id={`${instancePrefix}-sidebar-mindmap-card`}
              name="幕布"
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
        )}
      </div>
    </div>
  )
}
