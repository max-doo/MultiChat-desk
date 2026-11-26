import { useCallback, useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { useWorkbenchStore } from '../../store/workbenchStore'
import { AppIcon } from '../icons/AppIcon'
import { PreviewFallbackState } from './WorkbenchPreviewChrome'
import {
  IMAGE_SCALE_MAX,
  IMAGE_SCALE_MIN,
  resolveWorkbenchImageSource,
  useImageViewport,
  type ImageSourceKind
} from './workbenchImageUtils'

export interface LightboxImageItem {
  nodeKey: string
  src: string
  altText: string
  title?: string
}

interface WorkbenchImageLightboxProps {
  open: boolean
  items: LightboxImageItem[]
  activeIndex: number
  onSelectIndex: (index: number) => void
  onClose: () => void
}

/**
 * Markdown 预览模式图片查看视窗（Lightbox）：
 * - 参照飞书文档风格：半透明暗色遮罩保留文档空间感 + 右上角关闭 + 底部居中悬浮胶囊工具栏
 * - 支持滚轮缩放、拖拽平移、双击切换 100%/200%、旋转、文档多图翻页与快捷键
 */
export default function WorkbenchImageLightbox({
  open,
  items,
  activeIndex,
  onSelectIndex,
  onClose
}: WorkbenchImageLightboxProps): JSX.Element | null {
  const workspacePath = useWorkbenchStore((s) => s.workspacePath)
  const activeFilePath = useWorkbenchStore((s) => s.activeFilePath)
  const openInSystem = useWorkbenchStore((s) => s.openInSystem)
  const revealFile = useWorkbenchStore((s) => s.revealFile)

  const currentItem = items[activeIndex] ?? null

  const {
    scale,
    rotation,
    pan,
    isDragging,
    naturalDimensions,
    isLoaded,
    loadError,
    setLoadError,
    handleZoomIn,
    handleZoomOut,
    handleResetView,
    handleToggleZoom,
    handleRotate,
    resetAll,
    handleWheel,
    handlePointerDown,
    handlePointerMove,
    finishDrag,
    consumeSuppressedStageClick,
    handleImageLoad,
    handleImageError
  } = useImageViewport()

  const [resolvedUrl, setResolvedUrl] = useState<string | null>(null)
  const [sourceKind, setSourceKind] = useState<ImageSourceKind>('local')
  const [resolvedPath, setResolvedPath] = useState<string | null>(null)

  // 切换图片或重新打开时复位视口状态
  useEffect(() => {
    if (!open) return
    resetAll()
  }, [open, activeIndex, currentItem?.nodeKey, currentItem?.src, resetAll])

  // 异步解析当前图片真实地址
  useEffect(() => {
    if (!open || !currentItem) {
      setResolvedUrl(null)
      setLoadError(false)
      return
    }
    let cancelled = false
    setLoadError(false)
    setResolvedUrl(null)

    void resolveWorkbenchImageSource(workspacePath, activeFilePath, currentItem.src).then((res) => {
      if (cancelled) return
      setResolvedUrl(res.url)
      setSourceKind(res.kind)
      setResolvedPath(res.resolvedPath)
      setLoadError(res.error)
    })

    return () => {
      cancelled = true
    }
  }, [open, currentItem, workspacePath, activeFilePath, setLoadError])

  const hasMultiple = items.length > 1

  const handlePrev = useCallback(() => {
    if (items.length <= 1) return
    onSelectIndex((activeIndex - 1 + items.length) % items.length)
  }, [activeIndex, items.length, onSelectIndex])

  const handleNext = useCallback(() => {
    if (items.length <= 1) return
    onSelectIndex((activeIndex + 1) % items.length)
  }, [activeIndex, items.length, onSelectIndex])

  const handleOpenExternal = useCallback(() => {
    if (!currentItem) return
    if (sourceKind === 'remote') {
      try {
        const url = new URL(currentItem.src)
        if (url.protocol === 'http:' || url.protocol === 'https:') {
          window.open(url.href, '_blank', 'noopener')
        }
      } catch {
        // ignore invalid url
      }
      return
    }
    if (sourceKind === 'local' && resolvedPath) {
      void openInSystem(resolvedPath)
    }
  }, [currentItem, openInSystem, resolvedPath, sourceKind])

  // 键盘快捷键：Esc 关闭、左右翻页、+/- 缩放、0 复位、R 旋转、Space 关闭
  useEffect(() => {
    if (!open) return
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.preventDefault()
        event.stopPropagation()
        onClose()
        return
      }
      if (event.key === 'ArrowLeft') {
        if (items.length > 1) {
          event.preventDefault()
          event.stopPropagation()
          handlePrev()
        }
        return
      }
      if (event.key === 'ArrowRight') {
        if (items.length > 1) {
          event.preventDefault()
          event.stopPropagation()
          handleNext()
        }
        return
      }
      if (event.code === 'Space' && !event.ctrlKey && !event.metaKey && !event.altKey) {
        const target = event.target as HTMLElement | null
        if (!target || !target.closest('button, a, input, textarea, select')) {
          event.preventDefault()
          event.stopPropagation()
          onClose()
        }
        return
      }
      if (event.key === '+' || event.key === '=') {
        event.preventDefault()
        event.stopPropagation()
        handleZoomIn()
        return
      }
      if (event.key === '-') {
        event.preventDefault()
        event.stopPropagation()
        handleZoomOut()
        return
      }
      if (event.key === '0') {
        event.preventDefault()
        event.stopPropagation()
        handleResetView()
        return
      }
      if ((event.key === 'r' || event.key === 'R') && !event.ctrlKey && !event.metaKey && !event.altKey) {
        event.preventDefault()
        event.stopPropagation()
        handleRotate()
      }
    }

    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [
    open,
    items.length,
    onClose,
    handlePrev,
    handleNext,
    handleZoomIn,
    handleZoomOut,
    handleResetView,
    handleRotate
  ])

  const displayTitle = useMemo(() => {
    if (!currentItem) return ''
    if (currentItem.altText.trim()) return currentItem.altText.trim()
    const raw = currentItem.src
    if (raw.startsWith('data:')) return '内嵌图片'
    const clean = raw.split(/[?#]/)[0]
    const name = clean.split('/').pop()
    return name || raw
  }, [currentItem])

  if (!open || !currentItem) return null

  const handleBackdropClick = (event: React.MouseEvent<HTMLDivElement>): void => {
    if (consumeSuppressedStageClick()) return
    if (event.target === event.currentTarget) {
      onClose()
    }
  }

  const canOpenExternal = sourceKind === 'remote' || (sourceKind === 'local' && Boolean(resolvedPath))
  const canRevealLocal = sourceKind === 'local' && Boolean(resolvedPath)
  const isDefaultZoom = Math.abs(scale - 1) < 0.05
  const toolBtnClass =
    'flex h-7 w-7 items-center justify-center rounded-lg text-white/85 transition-colors hover:bg-white/15 hover:text-white disabled:opacity-35 disabled:hover:bg-transparent'

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`图片查看器: ${displayTitle}`}
      onWheel={handleWheel}
      onClick={handleBackdropClick}
      className="fixed inset-0 z-modal flex items-center justify-center bg-black/70 px-16 pt-12 pb-24 select-none"
    >
      {/* 右上角轻量关闭按钮 */}
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation()
          onClose()
        }}
        className="absolute top-4 right-4 z-dropdown flex h-9 w-9 items-center justify-center rounded-full border border-white/15 bg-black/55 text-white/90 shadow-lg transition-colors hover:bg-black/80 hover:text-white"
        title="关闭 (Esc / 空格)"
        aria-label="关闭图片查看器"
      >
        <AppIcon name="close" size={19} />
      </button>

      {/* 中央图片主体：保留文档上下文，仅图片自身随缩放/旋转变换 */}
      {loadError ? (
        <div
          onClick={(e) => e.stopPropagation()}
          className="max-w-sm rounded-xl border border-white/15 bg-neutral-900/95 p-6 shadow-2xl animate-[modal-zoom-in_0.18s_ease-out]"
        >
          <PreviewFallbackState
            theme="dark"
            icon={<AppIcon name="broken_image" size={24} className="mb-2 text-rose-400" />}
            title="无法加载该图片"
            description={currentItem.src}
            actionLabel={canOpenExternal ? '在外部程序中打开' : undefined}
            onAction={canOpenExternal ? handleOpenExternal : undefined}
          />
        </div>
      ) : resolvedUrl ? (
        <img
          src={resolvedUrl}
          alt={currentItem.altText}
          draggable={false}
          onClick={(e) => e.stopPropagation()}
          onDoubleClick={(e) => {
            e.stopPropagation()
            handleToggleZoom()
          }}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={finishDrag}
          onPointerCancel={finishDrag}
          onLoad={handleImageLoad}
          onError={handleImageError}
          style={{
            transform: `translate3d(${pan.x}px, ${pan.y}px, 0) scale(${scale}) rotate(${rotation}deg)`,
            transformOrigin: 'center center',
            transition: isDragging ? 'none' : 'transform 0.14s ease-out'
          }}
          className={`max-h-full max-w-full rounded-sm object-contain shadow-2xl animate-[modal-zoom-in_0.18s_ease-out] ${
            isDragging ? 'cursor-grabbing' : scale > 1 ? 'cursor-grab' : 'cursor-default'
          } ${isLoaded ? 'opacity-100' : 'opacity-0'}`}
        />
      ) : (
        <div className="flex items-center gap-2 rounded-full bg-neutral-900/85 px-4 py-2 text-body text-white/90 shadow-lg">
          <AppIcon name="progress_activity" size={16} className="animate-spin" />
          <span>正在加载图片…</span>
        </div>
      )}

      {/* 多图左右悬浮箭头 */}
      {hasMultiple && (
        <>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation()
              handlePrev()
            }}
            className="absolute left-5 top-1/2 z-dropdown flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full border border-white/15 bg-black/50 text-white/90 shadow-lg transition-colors hover:bg-black/75 hover:text-white"
            title="上一张 (←)"
            aria-label="上一张图片"
          >
            <AppIcon name="chevron_left" size={20} />
          </button>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation()
              handleNext()
            }}
            className="absolute right-5 top-1/2 z-dropdown flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full border border-white/15 bg-black/50 text-white/90 shadow-lg transition-colors hover:bg-black/75 hover:text-white"
            title="下一张 (→)"
            aria-label="下一张图片"
          >
            <AppIcon name="chevron_right" size={20} />
          </button>
        </>
      )}

      {/* 底部居中悬浮胶囊工具栏（参照飞书文档样式） */}
      <div className="pointer-events-none fixed bottom-4 left-1/2 z-dropdown flex max-w-[92vw] -translate-x-1/2 flex-col items-center gap-1.5">
        {!loadError && (displayTitle || naturalDimensions) && (
          <div className="flex max-w-md items-center gap-2 rounded-full bg-black/50 px-3 py-0.5 text-caption text-white/80">
            {displayTitle && (
              <span className="truncate" title={currentItem.src}>
                {displayTitle}
              </span>
            )}
            {naturalDimensions && (
              <span className="shrink-0 tabular-nums text-white/65">
                {naturalDimensions.width} × {naturalDimensions.height}
              </span>
            )}
          </div>
        )}

        <div
          onClick={(e) => e.stopPropagation()}
          className="pointer-events-auto flex items-center gap-0.5 rounded-xl border border-white/15 bg-neutral-900/90 px-2 py-1.5 text-white shadow-2xl"
        >
          {hasMultiple && (
            <>
              <button
                type="button"
                onClick={handlePrev}
                className={toolBtnClass}
                title="上一张 (←)"
                aria-label="上一张"
              >
                <AppIcon name="chevron_left" size={16} />
              </button>
              <span className="px-1.5 text-label font-medium tabular-nums text-white/85">
                {activeIndex + 1}/{items.length}
              </span>
              <button
                type="button"
                onClick={handleNext}
                className={toolBtnClass}
                title="下一张 (→)"
                aria-label="下一张"
              >
                <AppIcon name="chevron_right" size={16} />
              </button>
              <div className="mx-1 h-4 w-[1px] bg-white/15" />
            </>
          )}

          <button
            type="button"
            onClick={handleZoomOut}
            disabled={scale <= IMAGE_SCALE_MIN}
            className={toolBtnClass}
            title="缩小 (-)"
            aria-label="缩小"
          >
            <AppIcon name="zoom_out" size={16} />
          </button>
          <button
            type="button"
            onClick={handleResetView}
            className="h-7 min-w-[46px] rounded-lg px-1.5 text-label font-medium tabular-nums text-white/90 transition-colors hover:bg-white/15 hover:text-white"
            title="复位为适应视窗 (快捷键 0)"
          >
            {Math.round(scale * 100)}%
          </button>
          <button
            type="button"
            onClick={handleZoomIn}
            disabled={scale >= IMAGE_SCALE_MAX}
            className={toolBtnClass}
            title="放大 (+)"
            aria-label="放大"
          >
            <AppIcon name="zoom_in" size={16} />
          </button>
          <button
            type="button"
            onClick={handleToggleZoom}
            className={toolBtnClass}
            title={isDefaultZoom ? '放大至 200% (或双击图片)' : '适应视窗 (或双击图片)'}
            aria-label="切换缩放"
          >
            <AppIcon name={isDefaultZoom ? 'center_focus_strong' : 'compress'} size={16} />
          </button>

          <div className="mx-1 h-4 w-[1px] bg-white/15" />

          <button
            type="button"
            onClick={handleRotate}
            className={toolBtnClass}
            title="顺时针旋转 90° (快捷键 R)"
            aria-label="顺时针旋转 90°"
          >
            <AppIcon name="rotate_right" size={16} />
          </button>

          {(canOpenExternal || canRevealLocal) && (
            <>
              <div className="mx-1 h-4 w-[1px] bg-white/15" />
              {canOpenExternal && (
                <button
                  type="button"
                  onClick={handleOpenExternal}
                  className={toolBtnClass}
                  title={sourceKind === 'remote' ? '在浏览器中打开原图' : '在系统默认程序中打开'}
                  aria-label="在外部打开"
                >
                  <AppIcon name="open_in_new" size={16} />
                </button>
              )}
              {canRevealLocal && (
                <button
                  type="button"
                  onClick={() => {
                    if (resolvedPath) void revealFile(resolvedPath)
                  }}
                  className={toolBtnClass}
                  title="在系统资源管理器中定位"
                  aria-label="在资源管理器中定位"
                >
                  <AppIcon name="folder_open" size={16} />
                </button>
              )}
            </>
          )}
        </div>
      </div>
    </div>,
    document.body
  )
}
