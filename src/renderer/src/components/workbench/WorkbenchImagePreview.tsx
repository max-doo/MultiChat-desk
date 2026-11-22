import { useState, useRef, useMemo, useEffect, useCallback } from 'react'
import { useWorkbenchStore } from '../../store/workbenchStore'
import { AppIcon } from '../icons/AppIcon'

type BackgroundTheme = 'checkerboard' | 'light' | 'dark'

export default function WorkbenchImagePreview(): JSX.Element {
  const activeFilePath = useWorkbenchStore((s) => s.activeFilePath)
  const activeFileDataUrl = useWorkbenchStore((s) => s.activeFileDataUrl)
  const activeFileUrl = useWorkbenchStore((s) => s.activeFileUrl)
  const activeFileSize = useWorkbenchStore((s) => s.activeFileSize)
  const activeFileOversized = useWorkbenchStore((s) => s.activeFileOversized)
  const openInSystem = useWorkbenchStore((s) => s.openInSystem)
  const revealFile = useWorkbenchStore((s) => s.revealFile)

  const [scale, setScale] = useState(1)
  const [rotation, setRotation] = useState(0)
  const [bgTheme, setBgTheme] = useState<BackgroundTheme>('checkerboard')
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

  const formattedSize = useMemo(() => {
    if (!activeFileSize && activeFileSize !== 0) return ''
    if (activeFileSize < 1024) return `${activeFileSize} B`
    if (activeFileSize < 1024 * 1024) return `${(activeFileSize / 1024).toFixed(1)} KB`
    return `${(activeFileSize / (1024 * 1024)).toFixed(1)} MB`
  }, [activeFileSize])

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
    setBgTheme((current) => {
      if (current === 'checkerboard') return 'light'
      if (current === 'light') return 'dark'
      return 'checkerboard'
    })
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
      <div className="h-12 px-3 bg-white/80 dark:bg-gray-800/80 border-b border-black/5 dark:border-white/5 flex items-center justify-between gap-2 shrink-0 text-sm">
        {/* 左侧：文件信息与规格 */}
        <div className="flex items-center gap-2 truncate">
          <AppIcon name="image" size={19} className="text-purple-500" />
          <span className="font-medium text-text-primary truncate" title={activeFilePath || ''}>
            {activeFilePath}
          </span>
        </div>

        {/* 右侧：缩放旋转与系统集成 */}
        <div className="flex items-center gap-1 text-text-secondary">
          {/* 缩放控制 */}
          <button
            type="button"
            onClick={handleZoomOut}
            className="w-8 h-8 flex items-center justify-center rounded-md hover:bg-black/5 dark:hover:bg-white/10 hover:text-text-primary transition-colors"
            title="缩小"
          >
            <AppIcon name="zoom_out" size={19} />
          </button>
          <button
            type="button"
            onClick={handleResetZoom}
            className="px-1.5 h-7 flex items-center justify-center font-mono text-sm rounded-md hover:bg-black/5 dark:hover:bg-white/10 hover:text-text-primary transition-colors"
            title="重置为 100%"
          >
            {Math.round(scale * 100)}%
          </button>
          <button
            type="button"
            onClick={handleZoomIn}
            className="w-8 h-8 flex items-center justify-center rounded-md hover:bg-black/5 dark:hover:bg-white/10 hover:text-text-primary transition-colors"
            title="放大"
          >
            <AppIcon name="zoom_in" size={19} />
          </button>

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
        </div>
      </div>

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
          <div className="flex flex-col items-center gap-3 text-text-secondary max-w-sm text-center p-6 bg-white/80 dark:bg-gray-800/80 rounded-2xl shadow-lg border border-black/5 dark:border-white/5">
            <div className="w-14 h-14 rounded-2xl bg-amber-500/10 flex items-center justify-center text-amber-500 mb-1">
              <AppIcon name="image" size={30} />
            </div>
            <h3 className="text-sm font-semibold text-text-primary">图片超出内嵌预览上限</h3>
            <p className="text-sm text-text-secondary leading-relaxed">
              该图片大小为 <span className="font-semibold text-text-primary">{formattedSize}</span>，超出工作台内嵌 20MB 预览限制。推荐在操作系统默认看图软件中全速查看。
            </p>
            <button
              type="button"
              onClick={() => {
                if (activeFilePath) void openInSystem(activeFilePath)
              }}
              className="mt-2 px-4 py-2 rounded-xl bg-primary text-white text-sm font-medium flex items-center gap-1.5 shadow-sm hover:bg-primary/90 transition-all"
            >
              <AppIcon name="open_in_new" size={19} />
              <span>在外部看图软件中打开</span>
            </button>
          </div>
        ) : loadError ? (
          <div className="flex flex-col items-center gap-3 text-text-secondary">
            <AppIcon name="broken_image" size={36} className="text-rose-500" />
            <p className="text-sm">无法加载或解析该图片文件</p>
            <button
              type="button"
              onClick={() => {
                if (activeFilePath) void openInSystem(activeFilePath)
              }}
              className="px-3 py-1.5 rounded-lg bg-primary text-white text-sm font-medium"
            >
              在外部看图软件中打开
            </button>
          </div>
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

        {/* 右下角状态 Pill（与 Markdown 源码一致） */}
        {(naturalDimensions || formattedSize) && !activeFileOversized && !loadError && (
          <div className="pointer-events-none absolute bottom-3 right-3 z-10 flex items-center gap-2 rounded-full border border-black/5 bg-white/85 px-2.5 py-1 text-xs text-text-secondary shadow-sm backdrop-blur-md dark:border-white/10 dark:bg-gray-900/80">
            <span className="whitespace-nowrap">
              {naturalDimensions && `${naturalDimensions.width} × ${naturalDimensions.height} px`}
              {naturalDimensions && formattedSize && ' · '}
              {formattedSize}
            </span>
          </div>
        )}
      </div>
    </div>
  )
}
