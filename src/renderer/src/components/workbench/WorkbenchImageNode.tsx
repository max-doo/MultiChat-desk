import { useCallback, useEffect, useRef, useState } from 'react'
import type { JSX } from 'react'
import type { LexicalNode, NodeKey, Spread } from 'lexical'
import type { ElementFormatType } from 'lexical'
import { $applyNodeReplacement } from 'lexical'
import { DecoratorBlockNode, type SerializedDecoratorBlockNode } from '@lexical/react/LexicalDecoratorBlockNode'
import { BlockWithAlignableContents } from '@lexical/react/LexicalBlockWithAlignableContents'
import { useLexicalNodeSelection } from '@lexical/react/useLexicalNodeSelection'
import { useWorkbenchStore } from '../../store/workbenchStore'

export type SerializedWorkbenchImageNode = Spread<
  {
    src: string
    altText: string
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

  static getType(): string {
    return 'workbench-image'
  }

  static clone(node: WorkbenchImageNode): WorkbenchImageNode {
    return new WorkbenchImageNode(node.__src, node.__altText, node.__key)
  }

  constructor(src: string, altText: string, key?: NodeKey) {
    super('', key)
    this.__src = src
    this.__altText = altText
  }

  exportJSON(): SerializedWorkbenchImageNode {
    return {
      ...super.exportJSON(),
      src: this.__src,
      altText: this.__altText
    }
  }

  static importJSON(serializedNode: SerializedWorkbenchImageNode): WorkbenchImageNode {
    const { src, altText } = serializedNode
    return $applyNodeReplacement($createWorkbenchImageNode(src, altText))
  }

  getSrc(): string {
    return this.getLatest().__src
  }

  getAltText(): string {
    return this.getLatest().__altText
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
        nodeKey={this.getKey()}
        format={this.__format as ElementFormatType}
      />
    )
  }
}

export function $createWorkbenchImageNode(src: string, altText = ''): WorkbenchImageNode {
  return $applyNodeReplacement(new WorkbenchImageNode(src, altText))
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
  nodeKey: NodeKey
  format: ElementFormatType | '' | null | undefined
}

function WorkbenchImageComponent({
  src,
  altText,
  nodeKey,
  format
}: WorkbenchImageComponentProps): JSX.Element {
  const workspacePath = useWorkbenchStore((s) => s.workspacePath)
  const activeFilePath = useWorkbenchStore((s) => s.activeFilePath)
  const [isSelected, setSelected, clearSelection] = useLexicalNodeSelection(nodeKey)

  // 缩略图 dataUrl 缓存：组件内 state，加载一次后常驻
  const [thumb, setThumb] = useState<string | null>(null)
  const [loadError, setLoadError] = useState(false)
  const imgRef = useRef<HTMLImageElement | null>(null)

  // 请求缩略图：若 src 是 http(s) 则直接用，否则经 IPC 读盘生成 dataUrl
  useEffect(() => {
    let cancelled = false
    if (!src) {
      setThumb(null)
      return
    }
    if (/^https?:\/\//i.test(src)) {
      setThumb(src)
      setLoadError(false)
      return
    }
    // dataUrl 已经可直接渲染（如刚插入时 store 已缓存）
    if (src.startsWith('data:')) {
      setThumb(src)
      setLoadError(false)
      return
    }
    if (!workspacePath) return

    // 把相对文档目录的 src resolve 成相对工作区根的路径供 readFile 使用
    const docDir = activeFilePath?.includes('/')
      ? activeFilePath.slice(0, activeFilePath.lastIndexOf('/'))
      : ''
    const resolveRelativePath = (docDirPath: string, relPath: string): string => {
      if (!relPath) return relPath
      if (/^([a-zA-Z]:[\\/]|\/|https?:|data:)/.test(relPath)) return relPath // 绝对路径或 URL 不动
      const docSegs = docDirPath ? docDirPath.split('/') : []
      const relSegs = relPath.split('/')
      const out: string[] = [...docSegs]
      for (const seg of relSegs) {
        if (!seg || seg === '.') continue
        if (seg === '..') out.pop()
        else out.push(seg)
      }
      return out.join('/')
    }
    const resolvedSrc = resolveRelativePath(docDir, src)

    void (async () => {
      try {
        const res = await window.api.workbench.readFile(workspacePath, resolvedSrc)
        if (cancelled) return
        if (res.success && res.data?.dataUrl) {
          setThumb(res.data.dataUrl)
          setLoadError(false)
        } else {
          setLoadError(true)
        }
      } catch {
        if (!cancelled) setLoadError(true)
      }
    })()

    return () => {
      cancelled = true
    }
  }, [src, workspacePath, activeFilePath])

  const openInSystem = useWorkbenchStore((s) => s.openInSystem)

  const handleOpenSystem = useCallback(() => {
    if (src && !src.startsWith('data:') && !/^https?:/i.test(src) && activeFilePath) {
      const docDir = activeFilePath.includes('/')
        ? activeFilePath.slice(0, activeFilePath.lastIndexOf('/'))
        : ''
      const docSegs = docDir ? docDir.split('/') : []
      const relSegs = src.split('/')
      const out: string[] = [...docSegs]
      for (const seg of relSegs) {
        if (!seg || seg === '.') continue
        if (seg === '..') out.pop()
        else out.push(seg)
      }
      void openInSystem(out.join('/'))
    }
  }, [src, openInSystem, activeFilePath])

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
      >
        {loadError ? (
          <div className="flex items-center gap-2 px-4 py-3 rounded-lg border border-dashed border-red-300 dark:border-red-700 bg-red-50 dark:bg-red-950/30 text-red-600 dark:text-red-400 text-sm select-none">
            <span className="material-symbols-outlined text-[18px]">broken_image</span>
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
          <div className="flex items-center gap-2 px-4 py-6 rounded-lg border border-black/10 dark:border-white/10 bg-black/5 dark:bg-white/5 text-text-secondary text-sm">
            <span className="material-symbols-outlined text-[18px] animate-pulse">image</span>
            <span>加载中…</span>
          </div>
        )}

        {/* 选中态工具条：打开原图 / 显示路径 */}
        {isSelected && (
          <div className="absolute top-2 right-2 flex items-center gap-1 px-1.5 py-1 rounded-md bg-black/60 dark:bg-white/20 backdrop-blur-sm text-white text-xs opacity-0 group-hover:opacity-100 transition-opacity">
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation()
                handleOpenSystem()
              }}
              className="w-6 h-6 flex items-center justify-center rounded hover:bg-white/20 transition-colors"
              title="在系统默认程序中打开"
            >
              <span className="material-symbols-outlined text-[14px]">open_in_new</span>
            </button>
            <span className="px-1 font-mono text-[10px] max-w-[200px] truncate" title={src}>
              {src}
            </span>
          </div>
        )}
      </div>
    </BlockWithAlignableContents>
  )
}
