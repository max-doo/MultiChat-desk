import { useState, useRef, useMemo, useEffect, useCallback } from 'react'
import { useWorkbenchStore } from '../../store/workbenchStore'
import { formatFileSize } from '../../utils/formatBytes'
import { AppIcon } from '../icons/AppIcon'
import {
  PreviewFallbackState,
  PreviewHeader,
  PreviewMetaPill,
  PreviewZoomControls
} from './WorkbenchPreviewChrome'

export default function WorkbenchImagePreview(): JSX.Element {
  const activeFilePath = useWorkbenchStore((s) => s.activeFilePath)
  const activeFileDataUrl = useWorkbenchStore((s) => s.activeFileDataUrl)
  const activeFileUrl = useWorkbenchStore((s) => s.activeFileUrl)
  const activeFileSize = useWorkbenchStore((s) => s.activeFileSize)
  const activeFileOversized = useWorkbenchStore((s) => s.activeFileOversized)
  const openInSystem = useWorkbenchStore((s) => s.openInSystem)
  const revealFile = useWorkbenchStore((s) => s.revealFile)
  const bgTheme = useWorkbenchStore((s) => s.imageBackgroundTheme)
  const setBgTheme = useWorkbenchStore((s) => s.setImageBackgroundTheme)

  const [scale, setScale] = useState(1)
  const [rotation, setRotation] = useState(0)
  const [naturalDimensions, setNaturalDimensions] = useState<{ width: number; height: number } | null>(null)
  const [isLoaded, setIsLoaded] = useState(false)
  const [loadError, setLoadError] = useState(false)

  const imgRef = useRef<HTMLImageElement | null>(null)

  // 当切换文件时，重置所有缩放旋转和加载状态
  useEffect(() => {
    setScale(1)
    setRotation(0)
    setNaturalDimensions(null)
    setIsLoaded(false)
    setLoadError(false)
  }, [activeFilePath])

  const formattedSize = useMemo(() => formatFileSize(activeFileSize), [activeFileSize])

  const handleZoomIn = useCallback(() => setScale((s) => Math.min(5, Math.round((s + 0.25) * 100) / 100)), [])
  const handleZoomOut = useCallback(() => setScale((s) => Math.max(0.2, Math.round((s - 0.25) * 100) / 100)), [])
  const handleResetZoom = useCallback(() => setScale(1), [])
  const handleRotate = useCallback(() => setRotation((r) => (r + 90) % 360), [])

  const handleWheel = (e: React.WheelEvent) => {
    if (e.ctrlKey) {
      e.preventDefault()
      if (e.deltaY < 0) handleZoomIn()
      else handleZoomOut()
    }
  }

  const toggleBgTheme = () => {
    const next = bgTheme === 'checkerboard' ? 'light' : bgTheme === 'light' ? 'dark' : 'checkerboard'
    setBgTheme(next)
  }

  const handleImageLoad = (e: React.SyntheticEvent<HTMLImageElement>) => {
    const target = e.currentTarget
    setNaturalDimensions({ width: target.naturalWidth, height: target.naturalHeight })
    setIsLoaded(true)
    setLoadError(false)
  }

  return (
    <div className="flex-1 h-full flex flex-col overflow-hidden bg-slate-100 dark:bg-gray-900 select-none">
      {/* 顶部工具栏 */}
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
            <PreviewZoomControls
              zoom={scale}
              minZoom={0.2}
              maxZoom={5}
              onZoomOut={handleZoomOut}
              onZoomIn={handleZoomIn}
              onReset={handleResetZoom}
              resetTitle="重置为 100%"
            />

            {/* 顺时针旋转 90 度 */}
            <button
              type="button"
              onClick={handleRotate}
              className="w-8 h-8 flex items-center justify-center rounded-md hover:bg-black/5 dark:hover:bg-white/10 hover:text-text-primary transition-colors"
              title="顺时针旋转 90°"
            >
              <AppIcon name="rotate_right" size={19} />
            </button>

            {/* 背景板切换 (透明棋盘 / 白色 / 深色) */}
            <button
              type="button"
              onClick={toggleBgTheme}
              className="w-8 h-8 flex items-center justify-center rounded-md hover:bg-black/5 dark:hover:bg-white/10 hover:text-text-primary transition-colors"
              title={`切换画布背景 (当前: ${
                bgTheme === 'checkerboard' ? '透明棋盘格' : bgTheme === 'light' ? '纯白背景' : '深色背景'
              })`}
            >
              <AppIcon name={bgTheme === 'checkerboard' ? 'grid_4x4' : bgTheme === 'light' ? 'wb_sunny' : 'dark_mode'} size={19} />
            </button>

            <div className="w-[1px] h-4 bg-black/10 dark:bg-white/10 mx-1" />

            {/* 在系统相册中打开 */}
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

            {/* 在资源管理器定位 */}
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

      {/* 画布视图主体 */}
      <div
        onWheel={handleWheel}
        className={`flex-1 overflow-auto flex items-center justify-center p-6 relative transition-colors ${
          bgTheme === 'checkerboard'
            ? 'bg-[linear-gradient(45deg,#ccc_25%,transparent_25%),linear-gradient(-45deg,#ccc_25%,transparent_25%),linear-gradient(45deg,transparent_75%,#ccc_75%),linear-gradient(-45deg,transparent_75%,#ccc_75%)] bg-[size:20px_20px] bg-[position:0_0,0_10px,10px_-10px,-10px_0px] dark:bg-[linear-gradient(45deg,#242424_25%,transparent_25%),linear-gradient(-45deg,#242424_25%,transparent_25%),linear-gradient(45deg,transparent_75%,#242424_75%),linear-gradient(-45deg,transparent_75%,#242424_75%)]'
            : bgTheme === 'light'
            ? 'bg-white'
            : 'bg-gray-950'
        }`}
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
            onLoad={handleImageLoad}
            onError={() => setLoadError(true)}
            style={{
              transform: `scale(${scale}) rotate(${rotation}deg)`,
              transformOrigin: 'center center',
              transition: 'transform 0.15s ease-out'
            }}
            className={`max-w-full max-h-full object-contain shadow-lg rounded-sm ${
              isLoaded ? 'opacity-100' : 'opacity-0'
            }`}
          />
        )}

        {/* 右下角状态 Pill */}
        {(naturalDimensions || formattedSize) && !activeFileOversized && !loadError && (
          <PreviewMetaPill className="pointer-events-none absolute bottom-3 right-3 z-dropdown">
            <span className="whitespace-nowrap">
              {naturalDimensions && `${naturalDimensions.width} × ${naturalDimensions.height} px`}
              {naturalDimensions && formattedSize && ' · '}
              {formattedSize}
            </span>
          </PreviewMetaPill>
        )}
      </div>
    </div>
  )
}
