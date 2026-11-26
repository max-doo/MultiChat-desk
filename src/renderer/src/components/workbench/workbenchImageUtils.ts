import { useCallback, useRef, useState } from 'react'
import { createCommand, type LexicalCommand, type NodeKey } from 'lexical'
import { getFileCategory, type WorkbenchFileNode } from '../../../../shared/types/workbench'
import type { ImageBackgroundTheme, WorkbenchSortPreference } from '../../store/workbenchStore'

export const IMAGE_SCALE_MIN = 0.2
export const IMAGE_SCALE_MAX = 5
export const IMAGE_SCALE_STEP = 0.25

export interface OpenImageLightboxPayload {
  nodeKey: NodeKey
  src: string
  altText: string
  title?: string
}

/** 编辑器内双击/按钮/空格唤起图片查看视窗的 Lexical 命令。 */
export const OPEN_WORKBENCH_IMAGE_LIGHTBOX_COMMAND: LexicalCommand<OpenImageLightboxPayload> =
  createCommand('OPEN_WORKBENCH_IMAGE_LIGHTBOX')

export type ImageSourceKind = 'remote' | 'data' | 'local'

export function zoomInImageScale(scale: number): number {
  return Math.min(IMAGE_SCALE_MAX, Math.round((scale + IMAGE_SCALE_STEP) * 100) / 100)
}

export function zoomOutImageScale(scale: number): number {
  return Math.max(IMAGE_SCALE_MIN, Math.round((scale - IMAGE_SCALE_STEP) * 100) / 100)
}

export function cycleImageBackgroundTheme(current: ImageBackgroundTheme): ImageBackgroundTheme {
  if (current === 'checkerboard') return 'light'
  if (current === 'light') return 'dark'
  return 'checkerboard'
}

export function getImageBackgroundLabel(theme: ImageBackgroundTheme): string {
  if (theme === 'checkerboard') return '透明棋盘格'
  if (theme === 'light') return '纯白背景'
  return '深色背景'
}

export function getImageBackgroundIcon(theme: ImageBackgroundTheme): string {
  if (theme === 'checkerboard') return 'grid_4x4'
  if (theme === 'light') return 'wb_sunny'
  return 'dark_mode'
}

export function getImageBackgroundClass(
  theme: ImageBackgroundTheme,
  variant: 'preview' | 'lightbox' = 'preview'
): string {
  if (theme === 'checkerboard') {
    if (variant === 'lightbox') {
      return 'bg-[linear-gradient(45deg,#262b36_25%,transparent_25%),linear-gradient(-45deg,#262b36_25%,transparent_25%),linear-gradient(45deg,transparent_75%,#262b36_75%),linear-gradient(-45deg,transparent_75%,#262b36_75%)] bg-[size:20px_20px] bg-[position:0_0,0_10px,10px_-10px,-10px_0px] bg-[#1b1f27]'
    }
    return 'bg-[linear-gradient(45deg,#ccc_25%,transparent_25%),linear-gradient(-45deg,#ccc_25%,transparent_25%),linear-gradient(45deg,transparent_75%,#ccc_75%),linear-gradient(-45deg,transparent_75%,#ccc_75%)] bg-[size:20px_20px] bg-[position:0_0,0_10px,10px_-10px,-10px_0px] dark:bg-[linear-gradient(45deg,#242424_25%,transparent_25%),linear-gradient(-45deg,#242424_25%,transparent_25%),linear-gradient(45deg,transparent_75%,#242424_75%),linear-gradient(-45deg,transparent_75%,#242424_75%)]'
  }
  if (theme === 'light') {
    return 'bg-white'
  }
  return 'bg-gray-950'
}

export function classifyImageSource(src: string): ImageSourceKind {
  if (/^https?:\/\//i.test(src)) return 'remote'
  if (src.startsWith('data:')) return 'data'
  return 'local'
}

/** 把相对当前 Markdown 文档目录的引用路径解析为工作区根相对路径。 */
export function resolveDocRelativePath(activeFilePath: string | null, relPath: string): string {
  if (!relPath) return relPath
  if (/^([a-zA-Z]:[\\/]|\/|https?:|data:)/i.test(relPath)) return relPath
  const docDir =
    activeFilePath && activeFilePath.includes('/')
      ? activeFilePath.slice(0, activeFilePath.lastIndexOf('/'))
      : ''
  const docSegs = docDir ? docDir.split('/') : []
  const relSegs = relPath.split('/')
  const out: string[] = [...docSegs]
  for (const seg of relSegs) {
    if (!seg || seg === '.') continue
    if (seg === '..') out.pop()
    else out.push(seg)
  }
  return out.join('/')
}

export interface ResolvedImageSource {
  url: string | null
  kind: ImageSourceKind
  resolvedPath: string | null
  error: boolean
}

export async function resolveWorkbenchImageSource(
  workspacePath: string | null,
  activeFilePath: string | null,
  src: string
): Promise<ResolvedImageSource> {
  if (!src) {
    return { url: null, kind: 'local', resolvedPath: null, error: true }
  }
  const kind = classifyImageSource(src)
  if (kind === 'remote' || kind === 'data') {
    return { url: src, kind, resolvedPath: null, error: false }
  }
  const resolvedPath = resolveDocRelativePath(activeFilePath, src)
  if (!workspacePath) {
    return { url: null, kind: 'local', resolvedPath, error: false }
  }
  try {
    const res = await window.api.workbench.readFile(workspacePath, resolvedPath)
    const url = res.success ? res.data?.fileUrl || res.data?.dataUrl || null : null
    return {
      url,
      kind: 'local',
      resolvedPath,
      error: !url
    }
  } catch {
    return { url: null, kind: 'local', resolvedPath, error: true }
  }
}

function findDirectoryChildren(
  nodes: WorkbenchFileNode[],
  dirPath: string
): WorkbenchFileNode[] | null {
  if (!dirPath) return nodes
  for (const node of nodes) {
    if (node.isDirectory && node.path === dirPath) {
      return node.children ?? []
    }
    if (node.isDirectory && node.children && dirPath.startsWith(`${node.path}/`)) {
      const hit = findDirectoryChildren(node.children, dirPath)
      if (hit) return hit
    }
  }
  return null
}

/** 收集与当前文件同目录下的全部图片路径，排序规则与侧边栏文件树保持一致。 */
export function getSiblingImagePaths(
  fileTree: WorkbenchFileNode[],
  activeFilePath: string | null,
  fileSort: WorkbenchSortPreference
): string[] {
  if (!activeFilePath) return []
  const parentDir = activeFilePath.includes('/')
    ? activeFilePath.slice(0, activeFilePath.lastIndexOf('/'))
    : ''
  const siblings = findDirectoryChildren(fileTree, parentDir)
  if (!siblings) return [activeFilePath]

  const dir = fileSort.order === 'asc' ? 1 : -1
  const images = siblings.filter(
    (node) => !node.isDirectory && (node.category ?? getFileCategory(node.path)) === 'image'
  )
  images.sort((a, b) => {
    if (fileSort.key === 'name') {
      return dir * a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' })
    }
    if (fileSort.key === 'mtime') {
      return dir * ((a.mtime ?? 0) - (b.mtime ?? 0))
    }
    const diff = (a.size ?? 0) - (b.size ?? 0)
    return diff !== 0
      ? dir * diff
      : a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' })
  })
  return images.map((node) => node.path)
}

/** Lightbox 与独立图片预览共用的缩放 / 旋转 / 拖拽平移状态与事件处理。 */
export function useImageViewport() {
  const [scale, setScale] = useState(1)
  const [rotation, setRotation] = useState(0)
  const [pan, setPan] = useState<{ x: number; y: number }>({ x: 0, y: 0 })
  const [isDragging, setIsDragging] = useState(false)
  const [naturalDimensions, setNaturalDimensions] = useState<{ width: number; height: number } | null>(null)
  const [isLoaded, setIsLoaded] = useState(false)
  const [loadError, setLoadError] = useState(false)

  const dragStateRef = useRef<{
    active: boolean
    moved: boolean
    startX: number
    startY: number
    originX: number
    originY: number
  }>({ active: false, moved: false, startX: 0, startY: 0, originX: 0, originY: 0 })
  const suppressStageClickRef = useRef(false)

  const handleZoomIn = useCallback(() => {
    setScale((s) => zoomInImageScale(s))
  }, [])

  const handleZoomOut = useCallback(() => {
    setScale((s) => zoomOutImageScale(s))
  }, [])

  const handleResetView = useCallback(() => {
    setScale(1)
    setPan({ x: 0, y: 0 })
  }, [])

  const handleToggleZoom = useCallback(() => {
    setPan({ x: 0, y: 0 })
    setScale((s) => (Math.abs(s - 1) < 0.05 ? 2 : 1))
  }, [])

  const handleRotate = useCallback(() => {
    setRotation((r) => (r + 90) % 360)
  }, [])

  const resetAll = useCallback(() => {
    setScale(1)
    setRotation(0)
    setPan({ x: 0, y: 0 })
    setIsDragging(false)
    setNaturalDimensions(null)
    setIsLoaded(false)
    setLoadError(false)
  }, [])

  const handleWheel = useCallback(
    (event: React.WheelEvent<HTMLElement>) => {
      event.preventDefault()
      if (event.deltaY < 0) handleZoomIn()
      else if (event.deltaY > 0) handleZoomOut()
    },
    [handleZoomIn, handleZoomOut]
  )

  const handlePointerDown = useCallback(
    (event: React.PointerEvent<HTMLImageElement>) => {
      if (event.button !== 0) return
      event.stopPropagation()
      event.currentTarget.setPointerCapture(event.pointerId)
      dragStateRef.current = {
        active: true,
        moved: false,
        startX: event.clientX,
        startY: event.clientY,
        originX: pan.x,
        originY: pan.y
      }
      setIsDragging(true)
    },
    [pan.x, pan.y]
  )

  const handlePointerMove = useCallback((event: React.PointerEvent<HTMLImageElement>) => {
    const state = dragStateRef.current
    if (!state.active) return
    const dx = event.clientX - state.startX
    const dy = event.clientY - state.startY
    if (!state.moved && Math.hypot(dx, dy) > 4) {
      state.moved = true
    }
    if (state.moved) {
      setPan({ x: state.originX + dx, y: state.originY + dy })
    }
  }, [])

  const finishDrag = useCallback((event: React.PointerEvent<HTMLImageElement>) => {
    const state = dragStateRef.current
    if (!state.active) return
    if (state.moved) {
      suppressStageClickRef.current = true
    }
    state.active = false
    state.moved = false
    setIsDragging(false)
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
  }, [])

  const consumeSuppressedStageClick = useCallback((): boolean => {
    if (!suppressStageClickRef.current) return false
    suppressStageClickRef.current = false
    return true
  }, [])

  const handleImageLoad = useCallback((event: React.SyntheticEvent<HTMLImageElement>) => {
    const target = event.currentTarget
    setNaturalDimensions({ width: target.naturalWidth, height: target.naturalHeight })
    setIsLoaded(true)
    setLoadError(false)
  }, [])

  const handleImageError = useCallback(() => {
    setLoadError(true)
  }, [])

  return {
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
  }
}
