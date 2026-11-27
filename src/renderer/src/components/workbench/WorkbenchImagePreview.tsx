import { useMemo, useEffect, useLayoutEffect, useCallback, useState, useRef } from 'react'
import { createPortal } from 'react-dom'
import { useWorkbenchStore } from '../../store/workbenchStore'
import { formatFileSize } from '../../utils/formatBytes'
import { AppIcon } from '../icons/AppIcon'
import { copyImageElementToClipboard } from '../CustomContextMenu'
import { requestSendImageToAi } from './workbenchAiEvents'
import {
  PreviewFallbackState,
  PreviewHeader
} from './WorkbenchPreviewChrome'
import {
  cycleImageBackgroundTheme,
  collectMoveFolderTargets,
  getImageBackgroundClass,
  getImageBackgroundIcon,
  getImageBackgroundLabel,
  getSiblingImagePaths,
  IMAGE_SCALE_MAX,
  IMAGE_SCALE_MIN,
  useImageViewport
} from './workbenchImageUtils'

/** 画布右键菜单状态，菜单尺寸由真实 DOM 测量后钳位进视口 */
interface PreviewMenuState {
  x: number
  y: number
}

export default function WorkbenchImagePreview(): JSX.Element {
  const activeFilePath = useWorkbenchStore((s) => s.activeFilePath)
  const activeFileDataUrl = useWorkbenchStore((s) => s.activeFileDataUrl)
  const activeFileUrl = useWorkbenchStore((s) => s.activeFileUrl)
  const activeFileSize = useWorkbenchStore((s) => s.activeFileSize)
  const activeFileOversized = useWorkbenchStore((s) => s.activeFileOversized)
  const fileTree = useWorkbenchStore((s) => s.fileTree)
  const fileSort = useWorkbenchStore((s) => s.fileSort)
  const openFile = useWorkbenchStore((s) => s.openFile)
  const openInSystem = useWorkbenchStore((s) => s.openInSystem)
  const revealFile = useWorkbenchStore((s) => s.revealFile)
  const moveNode = useWorkbenchStore((s) => s.moveNode)
  const bgTheme = useWorkbenchStore((s) => s.imageBackgroundTheme)
  const setBgTheme = useWorkbenchStore((s) => s.setImageBackgroundTheme)

  const [menu, setMenu] = useState<PreviewMenuState | null>(null)
  const [menuPos, setMenuPos] = useState<{ left: number; top: number; flippedY?: boolean } | null>(null)
  const [submenuPos, setSubmenuPos] = useState<{ left: number; top: number; maxHeight: number; flippedX?: boolean } | null>(null)
  const [isMoveMenuOpen, setIsMoveMenuOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement | null>(null)
  const moveTriggerRef = useRef<HTMLDivElement | null>(null)
  const moveMenuRef = useRef<HTMLDivElement | null>(null)
  const imgRef = useRef<HTMLImageElement | null>(null)

  const {
    scale,
    rotation,
    pan,
    isDragging,
    naturalDimensions,
    isLoaded,
    loadError,
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
    handleImageLoad,
    handleImageError
  } = useImageViewport()

  useEffect(() => {
    resetAll()
  }, [activeFilePath, resetAll])

  const formattedSize = useMemo(() => formatFileSize(activeFileSize), [activeFileSize])

  const siblingImages = useMemo(
    () => getSiblingImagePaths(fileTree, activeFilePath, fileSort),
    [fileTree, activeFilePath, fileSort]
  )
  const currentIndex = useMemo(() => {
    if (!activeFilePath) return -1
    return siblingImages.indexOf(activeFilePath)
  }, [siblingImages, activeFilePath])
  const hasMultiple = siblingImages.length > 1

  const handlePrevImage = useCallback(() => {
    if (siblingImages.length <= 1 || currentIndex < 0) return
    const prevPath = siblingImages[(currentIndex - 1 + siblingImages.length) % siblingImages.length]
    void openFile(prevPath, { preview: true })
  }, [siblingImages, currentIndex, openFile])

  const handleNextImage = useCallback(() => {
    if (siblingImages.length <= 1 || currentIndex < 0) return
    const nextPath = siblingImages[(currentIndex + 1) % siblingImages.length]
    void openFile(nextPath, { preview: true })
  }, [siblingImages, currentIndex, openFile])

  const toggleBgTheme = (): void => {
    setBgTheme(cycleImageBackgroundTheme(bgTheme))
  }

  /** 「移动到」候选目录：排除当前所在目录与 `.multichat` 内部目录 */
  const moveTargets = useMemo(
    () => collectMoveFolderTargets(fileTree, activeFilePath),
    [fileTree, activeFilePath]
  )

  const closeMenu = useCallback(() => {
    setMenu(null)
    setIsMoveMenuOpen(false)
  }, [])

  const handleContextMenu = useCallback(
    (event: React.MouseEvent) => {
      if (!activeFilePath) return
      event.preventDefault()
      event.stopPropagation()
      setIsMoveMenuOpen(false)
      setMenuPos(null)
      setSubmenuPos(null)
      setMenu({ x: event.clientX, y: event.clientY })
    },
    [activeFilePath]
  )

  const handleMoveToFolder = useCallback(
    (targetDir: string) => {
      const path = activeFilePath
      closeMenu()
      if (!path) return
      void moveNode(path, targetDir)
    },
    [activeFilePath, closeMenu, moveNode]
  )

  /** 图片源地址：workbench-file:// 优先，主进程侧可解析真实路径 */
  const imageSrcUrl = activeFileUrl || activeFileDataUrl || ''

  /** 复制图片：优先主进程 copyImageAt 保留原图编码，失败退化渲染层转码 */
  const handleCopyImage = useCallback(() => {
    closeMenu()
    const img = imgRef.current
    if (!img) return
    void (async () => {
      try {
        if (img.src.startsWith('workbench-file://') && img.naturalWidth > 0) {
          const rect = img.getBoundingClientRect()
          const x = rect.left + rect.width / 2
          const y = rect.top + rect.height / 2
          const result = await window.api?.workbench?.copyHtmlImageAt?.(x, y)
          if (result?.success) return
        }
        await copyImageElementToClipboard(img)
      } catch (err) {
        console.error('[ImagePreview] 复制图片失败:', err)
      }
    })()
  }, [closeMenu])

  // 主菜单按真实尺寸贴合光标并钳位进视口，避免右下角溢出
  useLayoutEffect(() => {
    if (!menu || !menuRef.current) {
      setMenuPos(null)
      return
    }
    const EDGE = 8
    const rect = menuRef.current.getBoundingClientRect()
    const left = Math.max(
      EDGE,
      Math.min(menu.x, Math.max(EDGE, window.innerWidth - rect.width - EDGE))
    )
    const top = Math.max(
      EDGE,
      Math.min(menu.y, Math.max(EDGE, window.innerHeight - rect.height - EDGE))
    )
    setMenuPos({ left, top, flippedY: top < menu.y - 8 })
  }, [menu])

  // 「移动到」子菜单贴合触发项，右侧放不下时翻到左侧，垂直方向防溢出
  useLayoutEffect(() => {
    if (!menu || !isMoveMenuOpen || !moveTriggerRef.current || !moveMenuRef.current) {
      setSubmenuPos(null)
      return
    }
    const EDGE = 8
    const triggerRect = moveTriggerRef.current.getBoundingClientRect()
    const subRect = moveMenuRef.current.getBoundingClientRect()
    const maxHeight = Math.min(320, Math.max(120, window.innerHeight - EDGE * 2))
    const effectiveHeight = Math.min(subRect.height, maxHeight)
    const flippedX = triggerRect.right + subRect.width + EDGE > window.innerWidth
    const left = !flippedX
      ? triggerRect.right
      : Math.max(EDGE, triggerRect.left - subRect.width)
    const top = Math.max(
      EDGE,
      Math.min(triggerRect.top - 4, window.innerHeight - effectiveHeight - EDGE)
    )
    setSubmenuPos({ left, top, maxHeight, flippedX })
  }, [menu, isMoveMenuOpen, menuPos])

  // 右键菜单：外部点击 / Esc / 失焦 / 缩放窗口关闭
  useEffect(() => {
    if (!menu) return
    const handlePointerDown = (event: MouseEvent): void => {
      if (menuRef.current?.contains(event.target as Node)) return
      closeMenu()
    }
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') closeMenu()
    }
    document.addEventListener('mousedown', handlePointerDown)
    document.addEventListener('keydown', handleKeyDown)
    window.addEventListener('blur', closeMenu)
    window.addEventListener('resize', closeMenu)
    return () => {
      document.removeEventListener('mousedown', handlePointerDown)
      document.removeEventListener('keydown', handleKeyDown)
      window.removeEventListener('blur', closeMenu)
      window.removeEventListener('resize', closeMenu)
    }
  }, [menu, closeMenu])

  // 快捷键：同文件夹左右切换、+/- 缩放、0 复位、R 旋转（不抢占输入框/按钮/富文本焦点）
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.ctrlKey || event.metaKey || event.altKey) return
      const target = event.target as HTMLElement | null
      if (
        target &&
        (target.closest('input, textarea, select, button, a[href]') || target.isContentEditable)
      ) {
        return
      }
      if (event.key === 'ArrowLeft') {
        if (siblingImages.length > 1) {
          event.preventDefault()
          handlePrevImage()
        }
        return
      }
      if (event.key === 'ArrowRight') {
        if (siblingImages.length > 1) {
          event.preventDefault()
          handleNextImage()
        }
        return
      }
      if (event.key === '+' || event.key === '=') {
        event.preventDefault()
        handleZoomIn()
        return
      }
      if (event.key === '-') {
        event.preventDefault()
        handleZoomOut()
        return
      }
      if (event.key === '0') {
        event.preventDefault()
        handleResetView()
        return
      }
      if (event.key === 'r' || event.key === 'R') {
        event.preventDefault()
        handleRotate()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [
    siblingImages.length,
    handlePrevImage,
    handleNextImage,
    handleZoomIn,
    handleZoomOut,
    handleResetView,
    handleRotate
  ])

  const isDefaultZoom = Math.abs(scale - 1) < 0.05
  const canManipulateImage = !activeFileOversized && !loadError
  const toolBtnClass =
    'flex h-7 w-7 items-center justify-center rounded-lg text-white/85 transition-colors hover:bg-white/15 hover:text-white disabled:opacity-35 disabled:hover:bg-transparent'

  return (
    <div className="flex-1 h-full flex flex-col overflow-hidden bg-slate-100 dark:bg-gray-900 select-none">
      <PreviewHeader
        left={
          <>
            <AppIcon name="image" size={19} className="text-purple-500" />
            <span className="font-medium text-text-primary truncate" title={activeFilePath || ''}>
              {activeFilePath}
            </span>
          </>
        }
        right={
          <>
            <button
              type="button"
              onClick={toggleBgTheme}
              className="w-8 h-8 flex items-center justify-center rounded-md hover:bg-black/5 dark:hover:bg-white/10 hover:text-text-primary transition-colors"
              title={`切换画布衬底 (当前: ${getImageBackgroundLabel(bgTheme)})`}
            >
              <AppIcon name={getImageBackgroundIcon(bgTheme)} size={19} />
            </button>

            <div className="w-[1px] h-4 bg-black/10 dark:bg-white/10 mx-1" />

            <button
              type="button"
              onClick={() => {
                if (activeFilePath) void openInSystem(activeFilePath)
              }}
              className="w-8 h-8 flex items-center justify-center rounded-md hover:bg-black/5 dark:hover:bg-white/10 hover:text-text-primary transition-colors"
              title="在操作系统默认看图软件中打开"
            >
              <AppIcon name="open_in_new" size={19} />
            </button>

            <button
              type="button"
              onClick={() => {
                if (activeFilePath) void revealFile(activeFilePath)
              }}
              className="w-8 h-8 flex items-center justify-center rounded-md hover:bg-black/5 dark:hover:bg-white/10 hover:text-text-primary transition-colors"
              title="在系统资源管理器中定位"
            >
              <AppIcon name="folder_open" size={19} />
            </button>
          </>
        }
      />

      {/* 画布视图主体：复刻 Lightbox 交互（滚轮缩放、拖拽平移、双击切换缩放）并保留衬底 */}
      <div
        onWheel={canManipulateImage ? handleWheel : undefined}
        onContextMenu={handleContextMenu}
        className={`relative flex-1 overflow-hidden flex items-center justify-center px-16 pt-8 pb-24 transition-colors ${getImageBackgroundClass(
          bgTheme,
          'preview'
        )}`}
      >
        {activeFileOversized ? (
          <PreviewFallbackState
            framed
            icon={
              <div className="w-14 h-14 rounded-2xl bg-amber-500/10 flex items-center justify-center text-amber-500 mb-1">
                <AppIcon name="image" size={24} />
              </div>
            }
            title="图片超出内嵌预览上限"
            description={
              <>
                该图片大小为 <span className="font-semibold text-text-primary">{formattedSize}</span>，超出工作台内嵌 20MB 预览限制。推荐在操作系统默认看图软件中全速查看。
              </>
            }
            actionLabel="在外部看图软件中打开"
            onAction={() => {
              if (activeFilePath) void openInSystem(activeFilePath)
            }}
          />
        ) : loadError ? (
          <PreviewFallbackState
            icon={<AppIcon name="broken_image" size={24} className="text-rose-500 mb-2" />}
            title="无法加载或解析该图片文件"
            actionLabel="在外部看图软件中打开"
            onAction={() => {
              if (activeFilePath) void openInSystem(activeFilePath)
            }}
          />
        ) : (
          <img
            ref={imgRef}
            src={activeFileUrl || activeFileDataUrl || undefined}
            alt={activeFilePath || 'image'}
            draggable={false}
            onDoubleClick={handleToggleZoom}
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
            className={`max-w-full max-h-full object-contain shadow-lg rounded-sm ${
              isDragging ? 'cursor-grabbing' : scale > 1 ? 'cursor-grab' : 'cursor-default'
            } ${isLoaded ? 'opacity-100' : 'opacity-0'}`}
          />
        )}

        {hasMultiple && (
          <>
            <button
              type="button"
              onClick={handlePrevImage}
              className="absolute left-4 top-1/2 z-dropdown flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full border border-white/15 bg-black/45 text-white/90 shadow-lg transition-colors hover:bg-black/75 hover:text-white"
              title="上一张 (←)"
              aria-label="上一张图片"
            >
              <AppIcon name="chevron_left" size={20} />
            </button>
            <button
              type="button"
              onClick={handleNextImage}
              className="absolute right-4 top-1/2 z-dropdown flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full border border-white/15 bg-black/45 text-white/90 shadow-lg transition-colors hover:bg-black/75 hover:text-white"
              title="下一张 (→)"
              aria-label="下一张图片"
            >
              <AppIcon name="chevron_right" size={20} />
            </button>
          </>
        )}

        {(siblingImages.length > 0 || canManipulateImage) && (
          <div className="pointer-events-none absolute bottom-4 left-1/2 z-dropdown flex max-w-[92%] -translate-x-1/2 flex-col items-center gap-1.5">
            {canManipulateImage && (naturalDimensions || formattedSize) && (
              <div className="flex items-center gap-2 rounded-full bg-black/50 px-3 py-0.5 text-caption text-white/85">
                <span className="whitespace-nowrap tabular-nums">
                  {naturalDimensions && `${naturalDimensions.width} × ${naturalDimensions.height} px`}
                  {naturalDimensions && formattedSize && ' · '}
                  {formattedSize}
                </span>
              </div>
            )}

            {(hasMultiple || canManipulateImage) && (
              <div className="pointer-events-auto flex items-center gap-0.5 rounded-xl border border-white/15 bg-neutral-900/90 px-2 py-1.5 text-white shadow-2xl">
                {siblingImages.length > 0 && (
                  <>
                    <button
                      type="button"
                      onClick={handlePrevImage}
                      disabled={!hasMultiple}
                      className={toolBtnClass}
                      title={hasMultiple ? '同文件夹上一张 (←)' : '当前文件夹仅此一张图片'}
                      aria-label="上一张"
                    >
                      <AppIcon name="chevron_left" size={16} />
                    </button>
                    <span className="px-1.5 text-label font-medium tabular-nums text-white/85">
                      {currentIndex >= 0 ? `${currentIndex + 1}/${siblingImages.length}` : `1/${siblingImages.length}`}
                    </span>
                    <button
                      type="button"
                      onClick={handleNextImage}
                      disabled={!hasMultiple}
                      className={toolBtnClass}
                      title={hasMultiple ? '同文件夹下一张 (→)' : '当前文件夹仅此一张图片'}
                      aria-label="下一张"
                    >
                      <AppIcon name="chevron_right" size={16} />
                    </button>
                  </>
                )}

                {siblingImages.length > 0 && canManipulateImage && (
                  <div className="mx-1 h-4 w-[1px] bg-white/15" />
                )}

                {canManipulateImage && (
                  <>
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
                      aria-label="切换适应/200% 缩放"
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
                  </>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      {/* 画布右键菜单：发送到 AI / 复制图片 / 另存为 / 移动 / 外部打开 / 资源管理器定位 */}
      {menu &&
        createPortal(
          <div
            ref={menuRef}
            key={`${menu.x}-${menu.y}`}
            role="menu"
            className={`fixed z-popover min-w-[176px] select-none liquid-glass-menu rounded-xl py-1.5 text-body ${
              menuPos
                ? menuPos.flippedY
                  ? 'context-menu-animate context-menu-animate-up'
                  : 'context-menu-animate'
                : ''
            }`}
            style={{
              left: menuPos?.left ?? menu.x,
              top: menuPos?.top ?? menu.y,
              visibility: menuPos ? 'visible' : 'hidden'
            }}
            onContextMenu={(e) => e.preventDefault()}
          >
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                const src = imageSrcUrl
                closeMenu()
                if (src) requestSendImageToAi({ srcURL: src })
              }}
              className="flex w-full cursor-pointer items-center gap-2 px-3 py-1.5 text-left font-medium text-text-primary transition-colors hover:bg-black/5 dark:hover:bg-white/5"
            >
              <AppIcon name="send" size={19} className="shrink-0 text-blue-500" />
              发送到 AI 侧边栏
            </button>
            {canManipulateImage && (
              <button
                type="button"
                role="menuitem"
                onClick={handleCopyImage}
                className="flex w-full cursor-pointer items-center gap-2 px-3 py-1.5 text-left font-medium text-text-primary transition-colors hover:bg-black/5 dark:hover:bg-white/5"
              >
                <AppIcon name="image" size={19} className="shrink-0 text-text-secondary" />
                复制图片
              </button>
            )}
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                const src = imageSrcUrl
                closeMenu()
                if (src) void window.api?.saveImageFromURL?.(src)
              }}
              className="flex w-full cursor-pointer items-center gap-2 px-3 py-1.5 text-left font-medium text-text-primary transition-colors hover:bg-black/5 dark:hover:bg-white/5"
            >
              <AppIcon name="download" size={19} className="shrink-0 text-text-secondary" />
              图片另存为...
            </button>
            {moveTargets.length > 0 && (
              <div className="my-1 border-t border-black/5 dark:border-white/5" role="separator" />
            )}
            {moveTargets.length > 0 && (
              <div
                ref={moveTriggerRef}
                className="relative"
                onMouseEnter={() => setIsMoveMenuOpen(true)}
                onMouseLeave={() => setIsMoveMenuOpen(false)}
              >
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => setIsMoveMenuOpen((v) => !v)}
                  className="flex w-full cursor-pointer items-center gap-2 px-3 py-1.5 text-left font-medium text-text-primary transition-colors hover:bg-black/5 dark:hover:bg-white/5"
                >
                  <AppIcon name="folder_output" size={19} className="shrink-0 text-amber-500" />
                  <span className="flex-1">移动到</span>
                  <AppIcon name="chevron_right" size={16} className="shrink-0 text-text-secondary" />
                </button>
                {isMoveMenuOpen && (
                  <div
                    ref={moveMenuRef}
                    role="menu"
                    onMouseEnter={() => setIsMoveMenuOpen(true)}
                    style={{
                      left: submenuPos?.left ?? menu.x,
                      top: submenuPos?.top ?? menu.y,
                      maxHeight: submenuPos?.maxHeight ?? 320,
                      visibility: submenuPos ? 'visible' : 'hidden'
                    }}
                    className={`fixed z-popover min-w-[190px] max-w-[260px] overflow-y-auto liquid-glass-menu rounded-xl py-1.5 text-body ${
                      submenuPos
                        ? submenuPos.flippedX
                          ? 'context-menu-animate context-menu-animate-left'
                          : 'context-menu-animate context-menu-animate-right'
                        : ''
                    }`}
                  >
                    {moveTargets.map((target) => (
                      <button
                        key={target.path || '__root__'}
                        type="button"
                        role="menuitem"
                        onClick={() => handleMoveToFolder(target.path)}
                        className="flex w-full cursor-pointer items-center gap-2 px-3 py-1.5 text-left text-text-primary transition-colors hover:bg-black/5 dark:hover:bg-white/5"
                        title={target.path ? target.path : '移动到工作区根目录'}
                      >
                        <span
                          className="flex min-w-0 flex-1 items-center gap-2"
                          style={{ paddingLeft: `${target.depth * 12}px` }}
                        >
                          <AppIcon
                            name={target.path ? 'folder' : 'home'}
                            size={19}
                            className={`shrink-0 ${target.path ? 'text-amber-500' : 'text-text-secondary'}`}
                          />
                          <span className="truncate">{target.name}</span>
                        </span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                const path = activeFilePath
                closeMenu()
                if (path) void openInSystem(path)
              }}
              className="flex w-full cursor-pointer items-center gap-2 px-3 py-1.5 text-left font-medium text-text-primary transition-colors hover:bg-black/5 dark:hover:bg-white/5"
            >
              <AppIcon name="open_in_new" size={19} className="shrink-0 text-text-secondary" />
              使用系统默认程序打开
            </button>
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                const path = activeFilePath
                closeMenu()
                if (path) void revealFile(path)
              }}
              className="flex w-full cursor-pointer items-center gap-2 px-3 py-1.5 text-left font-medium text-text-primary transition-colors hover:bg-black/5 dark:hover:bg-white/5"
            >
              <AppIcon name="folder_open" size={19} className="shrink-0 text-text-secondary" />
              在资源管理器中显示
            </button>
          </div>,
          document.body
        )}
    </div>
  )
}
