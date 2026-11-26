import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { JSX, MouseEvent as ReactMouseEvent } from 'react'
import type { LexicalNode, NodeKey, Spread } from 'lexical'
import type { ElementFormatType } from 'lexical'
import { $applyNodeReplacement, $getNodeByKey } from 'lexical'
import { DecoratorBlockNode, type SerializedDecoratorBlockNode } from '@lexical/react/LexicalDecoratorBlockNode'
import { BlockWithAlignableContents } from '@lexical/react/LexicalBlockWithAlignableContents'
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext'
import { useLexicalNodeSelection } from '@lexical/react/useLexicalNodeSelection'
import { useWorkbenchStore } from '../../store/workbenchStore'
import { AppIcon } from '../icons/AppIcon'
import {
  classifyImageSource,
  OPEN_WORKBENCH_IMAGE_LIGHTBOX_COMMAND,
  resolveDocRelativePath,
  resolveWorkbenchImageSource
} from './workbenchImageUtils'

export type SerializedWorkbenchImageNode = Spread<
  {
    src: string
    altText: string
    title?: string
    attributes?: string
  },
  SerializedDecoratorBlockNode
>

/**
 * 工作台 Markdown 图片节点
 * - 序列化: ![alt](src)
 * - 编辑器内渲染缩略图 dataUrl（异步通过 IPC 获取）
 */
export class WorkbenchImageNode extends DecoratorBlockNode {
  __src: string
  __altText: string
  __title?: string
  __attributes?: string

  static getType(): string {
    return 'workbench-image'
  }

  static clone(node: WorkbenchImageNode): WorkbenchImageNode {
    return new WorkbenchImageNode(
      node.__src,
      node.__altText,
      node.__key,
      node.__title,
      node.__attributes
    )
  }

  constructor(
    src: string,
    altText: string,
    key?: NodeKey,
    title?: string,
    attributes?: string
  ) {
    super('', key)
    this.__src = src
    this.__altText = altText
    this.__title = title
    this.__attributes = attributes
  }

  exportJSON(): SerializedWorkbenchImageNode {
    return {
      ...super.exportJSON(),
      src: this.__src,
      altText: this.__altText,
      ...(this.__title !== undefined ? { title: this.__title } : {}),
      ...(this.__attributes !== undefined ? { attributes: this.__attributes } : {})
    }
  }

  static importJSON(serializedNode: SerializedWorkbenchImageNode): WorkbenchImageNode {
    const { src, altText, title, attributes } = serializedNode
    return $applyNodeReplacement($createWorkbenchImageNode(src, altText, title, attributes))
  }

  getSrc(): string {
    return this.getLatest().__src
  }

  getAltText(): string {
    return this.getLatest().__altText
  }

  getTitle(): string | undefined {
    return this.getLatest().__title
  }

  getAttributes(): string | undefined {
    return this.getLatest().__attributes
  }

  setAltText(altText: string): this {
    const self = this.getWritable()
    self.__altText = altText
    return self
  }

  createDOM(): HTMLElement {
    return document.createElement('div')
  }

  updateDOM(): false {
    return false
  }

  isInline(): false {
    return false
  }

  decorate(): JSX.Element {
    return (
      <WorkbenchImageComponent
        src={this.__src}
        altText={this.__altText}
        title={this.__title}
        nodeKey={this.getKey()}
        format={this.__format as ElementFormatType}
      />
    )
  }
}

export function $createWorkbenchImageNode(
  src: string,
  altText = '',
  title?: string,
  attributes?: string
): WorkbenchImageNode {
  return $applyNodeReplacement(new WorkbenchImageNode(src, altText, undefined, title, attributes))
}

export function $isWorkbenchImageNode(
  node: LexicalNode | null | undefined
): node is WorkbenchImageNode {
  return node instanceof WorkbenchImageNode
}

// ---- React 组件：负责异步加载缩略图并渲染 ----

interface WorkbenchImageComponentProps {
  src: string
  altText: string
  title?: string
  nodeKey: NodeKey
  format: ElementFormatType | '' | null | undefined
}

function WorkbenchImageComponent({
  src,
  altText,
  title,
  nodeKey,
  format
}: WorkbenchImageComponentProps): JSX.Element {
  const [editor] = useLexicalComposerContext()
  const workspacePath = useWorkbenchStore((s) => s.workspacePath)
  const activeFilePath = useWorkbenchStore((s) => s.activeFilePath)
  const openInSystem = useWorkbenchStore((s) => s.openInSystem)
  const revealFile = useWorkbenchStore((s) => s.revealFile)
  const [isSelected, setSelected, clearSelection] = useLexicalNodeSelection(nodeKey)

  // 图片源缓存：优先使用 workbench-file://，旧 dataUrl 仅作兼容回退
  const [thumb, setThumb] = useState<string | null>(null)
  const [loadError, setLoadError] = useState(false)
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null)
  const imgRef = useRef<HTMLImageElement | null>(null)
  const menuRef = useRef<HTMLDivElement | null>(null)

  const sourceKind = classifyImageSource(src)
  const resolvedLocalPath =
    sourceKind === 'local' ? resolveDocRelativePath(activeFilePath, src) : null
  const canOpenExternal =
    sourceKind === 'remote' || (sourceKind === 'local' && Boolean(resolvedLocalPath))

  // 请求图片源：若 src 是 http(s) 或 dataUrl 则直接用，否则经 IPC 换得可流式加载的 fileUrl
  useEffect(() => {
    let cancelled = false
    if (!src) {
      setThumb(null)
      setLoadError(false)
      return
    }
    if (sourceKind === 'local' && !workspacePath) return

    void resolveWorkbenchImageSource(workspacePath, activeFilePath, src).then((res) => {
      if (cancelled) return
      setThumb(res.url)
      setLoadError(res.error)
    })

    return () => {
      cancelled = true
    }
  }, [src, sourceKind, workspacePath, activeFilePath])

  // 关闭右键菜单
  useEffect(() => {
    if (!menu) return
    const close = (): void => setMenu(null)
    const handleKeyDown = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') close()
    }
    const handlePointerDown = (e: MouseEvent): void => {
      if (menuRef.current?.contains(e.target as Node)) return
      close()
    }
    document.addEventListener('mousedown', handlePointerDown)
    document.addEventListener('keydown', handleKeyDown)
    window.addEventListener('blur', close)
    window.addEventListener('resize', close)
    return () => {
      document.removeEventListener('mousedown', handlePointerDown)
      document.removeEventListener('keydown', handleKeyDown)
      window.removeEventListener('blur', close)
      window.removeEventListener('resize', close)
    }
  }, [menu])

  const handleOpenLightbox = useCallback(() => {
    if (loadError || !thumb) return
    setMenu(null)
    editor.dispatchCommand(OPEN_WORKBENCH_IMAGE_LIGHTBOX_COMMAND, {
      nodeKey,
      src,
      altText,
      title
    })
  }, [altText, editor, loadError, nodeKey, src, thumb, title])

  const handleOpenExternal = useCallback(() => {
    setMenu(null)
    if (sourceKind === 'remote') {
      try {
        const url = new URL(src)
        if (url.protocol === 'http:' || url.protocol === 'https:') {
          window.open(url.href, '_blank', 'noopener')
        }
      } catch {
        // ignore invalid url
      }
      return
    }
    if (sourceKind === 'local' && resolvedLocalPath) {
      void openInSystem(resolvedLocalPath)
    }
  }, [openInSystem, resolvedLocalPath, sourceKind, src])

  const handleRevealFile = useCallback(() => {
    setMenu(null)
    if (sourceKind === 'local' && resolvedLocalPath) {
      void revealFile(resolvedLocalPath)
    }
  }, [resolvedLocalPath, revealFile, sourceKind])

  const handleCopySrc = useCallback(() => {
    setMenu(null)
    void navigator.clipboard.writeText(src)
  }, [src])

  const handleRemoveImage = useCallback(() => {
    setMenu(null)
    editor.update(() => {
      $getNodeByKey(nodeKey)?.remove()
    })
  }, [editor, nodeKey])

  const handleContextMenu = useCallback(
    (e: ReactMouseEvent): void => {
      e.preventDefault()
      e.stopPropagation()
      if (!isSelected) {
        clearSelection()
        setSelected(true)
      }
      const menuWidth = 192
      const menuHeight = 220
      setMenu({
        x: Math.max(8, Math.min(e.clientX, window.innerWidth - menuWidth - 8)),
        y: Math.max(8, Math.min(e.clientY, window.innerHeight - menuHeight - 8))
      })
    },
    [clearSelection, isSelected, setSelected]
  )

  const canPreviewLightbox = !loadError && Boolean(thumb)

  return (
    <BlockWithAlignableContents
      className={{
        base: 'my-2 relative',
        focus: 'ring-2 ring-primary/40 rounded-lg'
      }}
      format={format}
      nodeKey={nodeKey}
    >
      <div
        className="group relative inline-block max-w-full"
        onClick={() => {
          if (!isSelected) {
            clearSelection()
            setSelected(true)
          }
        }}
        onDoubleClick={(e) => {
          if (!canPreviewLightbox) return
          e.preventDefault()
          e.stopPropagation()
          handleOpenLightbox()
        }}
        onContextMenu={handleContextMenu}
      >
        {loadError ? (
          <div className="flex items-center gap-2 px-4 py-3 rounded-lg border border-dashed border-red-300 dark:border-red-700 bg-red-50 dark:bg-red-950/30 text-red-600 dark:text-red-400 text-body select-none">
            <AppIcon name="broken_image" size={19} />
            <span>图片加载失败: {src}</span>
          </div>
        ) : thumb ? (
          <img
            ref={imgRef}
            src={thumb}
            alt={altText}
            className="max-w-full h-auto rounded-lg border border-black/10 dark:border-white/10 shadow-sm cursor-default"
            draggable={false}
          />
        ) : (
          <div className="flex items-center gap-2 px-4 py-6 rounded-lg border border-black/10 dark:border-white/10 bg-black/5 dark:bg-white/5 text-text-secondary text-body">
            <AppIcon name="image" size={19} className="animate-pulse" />
            <span>加载中…</span>
          </div>
        )}

        {/* 悬停 / 选中态悬浮工具条：查看大图 / 外部打开 / 路径 */}
        <div
          className={`absolute top-2 right-2 flex items-center gap-1 px-1.5 py-1 rounded-md bg-black/65 dark:bg-gray-900/80 backdrop-blur-sm text-white text-caption transition-opacity ${
            isSelected
              ? 'opacity-100 pointer-events-auto'
              : 'opacity-0 pointer-events-none group-hover:opacity-100 group-hover:pointer-events-auto'
          }`}
        >
          {canPreviewLightbox && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation()
                handleOpenLightbox()
              }}
              className="w-6 h-6 flex items-center justify-center rounded hover:bg-white/20 transition-colors"
              title="查看大图 (双击或选中按空格)"
              aria-label="查看大图"
            >
              <AppIcon name="zoom_in" size={14} />
            </button>
          )}
          {canOpenExternal && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation()
                handleOpenExternal()
              }}
              className="w-6 h-6 flex items-center justify-center rounded hover:bg-white/20 transition-colors"
              title={sourceKind === 'remote' ? '在浏览器中打开原图' : '在系统默认程序中打开'}
              aria-label="在外部打开"
            >
              <AppIcon name="open_in_new" size={14} />
            </button>
          )}
          <span className="px-1 font-mono text-caption max-w-[200px] truncate" title={src}>
            {sourceKind === 'data' ? '内嵌图片' : src}
          </span>
        </div>

        {/* 右键菜单 */}
        {menu &&
          createPortal(
            <div
              ref={menuRef}
              role="menu"
              className="liquid-glass-menu fixed z-popover min-w-[192px] select-none rounded-xl py-1.5 text-body"
              style={{ left: menu.x, top: menu.y }}
              onContextMenu={(e) => e.preventDefault()}
            >
              {canPreviewLightbox && (
                <button
                  type="button"
                  role="menuitem"
                  className="flex w-full cursor-pointer items-center gap-2 px-3 py-1.5 text-left font-medium text-text-primary transition-colors hover:bg-black/5 dark:hover:bg-white/5"
                  onClick={handleOpenLightbox}
                >
                  <AppIcon name="zoom_in" size={16} className="shrink-0 text-primary" />
                  查看大图
                </button>
              )}
              {canOpenExternal && (
                <button
                  type="button"
                  role="menuitem"
                  className="flex w-full cursor-pointer items-center gap-2 px-3 py-1.5 text-left font-medium text-text-primary transition-colors hover:bg-black/5 dark:hover:bg-white/5"
                  onClick={handleOpenExternal}
                >
                  <AppIcon name="open_in_new" size={16} className="shrink-0 text-text-secondary" />
                  {sourceKind === 'remote' ? '在浏览器中打开' : '在系统程序中打开'}
                </button>
              )}
              {sourceKind === 'local' && resolvedLocalPath && (
                <button
                  type="button"
                  role="menuitem"
                  className="flex w-full cursor-pointer items-center gap-2 px-3 py-1.5 text-left font-medium text-text-primary transition-colors hover:bg-black/5 dark:hover:bg-white/5"
                  onClick={handleRevealFile}
                >
                  <AppIcon name="folder_open" size={16} className="shrink-0 text-text-secondary" />
                  在资源管理器中定位
                </button>
              )}
              <button
                type="button"
                role="menuitem"
                className="flex w-full cursor-pointer items-center gap-2 px-3 py-1.5 text-left font-medium text-text-primary transition-colors hover:bg-black/5 dark:hover:bg-white/5"
                onClick={handleCopySrc}
              >
                <AppIcon name="content_copy" size={16} className="shrink-0 text-text-secondary" />
                复制图片地址
              </button>
              <div className="my-1 border-t border-black/5 dark:border-white/10" />
              <button
                type="button"
                role="menuitem"
                className="flex w-full cursor-pointer items-center gap-2 px-3 py-1.5 text-left font-medium text-red-500 transition-colors hover:bg-red-50 dark:hover:bg-red-500/10"
                onClick={handleRemoveImage}
              >
                <AppIcon name="delete" size={16} className="shrink-0" />
                删除图片
              </button>
            </div>,
            document.body
          )}
      </div>
    </BlockWithAlignableContents>
  )
}
