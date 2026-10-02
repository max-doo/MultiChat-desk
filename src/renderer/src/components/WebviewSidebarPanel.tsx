import React from 'react'
import WebviewCard, { type WebviewCardRef } from './WebviewCard'
import MindmapSidebarView from './MindmapSidebarView'
import type { SidebarMode } from '../hooks/useWebviewSidebar'

export interface WebviewSidebarPanelProps {
  isOpen: boolean
  mode: SidebarMode
  width: number
  models: Array<{ id: string; name: string; url: string; logo: string }>
  sidebarModelId: string
  mountedSidebarModels: Set<string>
  isMindmapMounted: boolean
  sidebarError: string
  instancePrefix: string
  sidebarRefs: React.MutableRefObject<Map<string, WebviewCardRef>>
  mindmapRef: React.MutableRefObject<WebviewCardRef | null>
  onClose: () => void
  onModelChange: (modelId: string) => void
  onClearError: () => void
  onPointerDownResize: (e: React.PointerEvent<HTMLDivElement>) => void
  onPointerMoveResize: (e: React.PointerEvent<HTMLDivElement>) => void
  onPointerUpResize: () => void
}

export default function WebviewSidebarPanel({
  isOpen,
  mode,
  width,
  models,
  sidebarModelId,
  mountedSidebarModels,
  isMindmapMounted,
  sidebarError,
  instancePrefix,
  sidebarRefs,
  mindmapRef,
  onClose,
  onModelChange,
  onClearError,
  onPointerDownResize,
  onPointerMoveResize,
  onPointerUpResize
}: WebviewSidebarPanelProps): JSX.Element | null {
  if (!isOpen && mountedSidebarModels.size === 0 && !isMindmapMounted) {
    return null
  }

  return (
    <>
      {isOpen && (
        <div
          className="w-1 shrink-0 bg-gray-200 hover:bg-blue-300 cursor-col-resize select-none"
          onPointerDown={onPointerDownResize}
          onPointerMove={onPointerMoveResize}
          onPointerUp={onPointerUpResize}
          onLostPointerCapture={onPointerUpResize}
          title="拖动调整侧边栏宽度"
        />
      )}
      <div
        className={`h-full min-w-0 shrink-0 ${isOpen ? 'border-l border-gray-200' : 'hidden'}`}
        style={isOpen ? { width, maxWidth: 'calc(100% - 324px)' } : undefined}
      >
        {/* 副模型区域 */}
        <div className="h-full relative" style={{ display: mode === 'model' ? 'block' : 'none' }}>
          {sidebarError && (
            <div className="absolute right-2 top-14 z-30 rounded-lg bg-amber-50 border border-amber-200 px-3 py-2 text-xs text-amber-900 flex items-center gap-2 shadow-sm">
              <span>{sidebarError}</span>
              <button type="button" onClick={onClearError} className="underline">
                重试
              </button>
            </div>
          )}
          {models.map(model => {
            if (!mountedSidebarModels.has(model.id)) return null
            return (
              <div
                key={model.id}
                className="h-full"
                style={{ display: model.id === sidebarModelId ? 'block' : 'none' }}
              >
                <WebviewCard
                  id={model.id}
                  name={model.name}
                  url={model.url}
                  logo={model.logo}
                  enabled={true}
                  slotIndex={1}
                  compact={true}
                  isolated={true}
                  flat={true}
                  webviewInstanceId={`${instancePrefix}-sidebar-${model.id}`}
                  onModelChange={onModelChange}
                  headerActions={
                    <button
                      type="button"
                      onClick={onClose}
                      className="w-7 h-7 rounded-full text-text-secondary hover:text-red-500 hover:bg-red-50 flex items-center justify-center transition-colors"
                      title="收起侧边栏"
                      aria-label="收起侧边栏"
                    >
                      <span className="material-symbols-outlined text-base">close</span>
                    </button>
                  }
                  ref={ref => {
                    if (ref) sidebarRefs.current.set(model.id, ref)
                    else sidebarRefs.current.delete(model.id)
                  }}
                />
              </div>
            )
          })}
        </div>

        {/* 思维导图区域（支持本地/在线双模与双视图） */}
        {isMindmapMounted && (
          <div className="h-full flex flex-col" style={{ display: mode === 'mindmap' ? 'flex' : 'none' }}>
            <MindmapSidebarView
              instancePrefix={instancePrefix}
              mindmapRef={mindmapRef}
              onClose={onClose}
            />
          </div>
        )}
      </div>
    </>
  )
}
