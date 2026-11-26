import { useMemo } from 'react'
import type { JSX } from 'react'
import type {
  EditorConfig,
  LexicalNode,
  NodeKey,
  SerializedLexicalNode,
  Spread
} from 'lexical'
import { $applyNodeReplacement, DecoratorNode } from 'lexical'
import { flattenSortedFiles, useWorkbenchStore } from '../../store/workbenchStore'
import { FileChipIcon, FileChipMissingIcon, WorkbenchFileChip } from './WorkbenchFileChip'
import { resolveWikiLinkTarget, wikiLinkDefaultDisplay } from './workbenchWikiLinks'

export type SerializedWorkbenchWikiLinkNode = Spread<
  {
    target: string
    display: string | null
  },
  SerializedLexicalNode
>

/**
 * 工作台双链节点（行内装饰）：
 * - Markdown 序列化为 [[target]] 或 [[target|display]]；
 * - 正文呈现为 chip：文件类型图标 + 显示名；
 * - 目标在工作区中不存在时以虚线描边标记。
 */
export class WorkbenchWikiLinkNode extends DecoratorNode<JSX.Element> {
  __target: string
  __display: string | null

  static getType(): string {
    return 'workbench-wiki-link'
  }

  static clone(node: WorkbenchWikiLinkNode): WorkbenchWikiLinkNode {
    return new WorkbenchWikiLinkNode(node.__target, node.__display, node.__key)
  }

  constructor(target: string, display?: string | null, key?: NodeKey) {
    super(key)
    this.__target = target
    this.__display = display ?? null
  }

  exportJSON(): SerializedWorkbenchWikiLinkNode {
    return {
      ...super.exportJSON(),
      target: this.__target,
      display: this.__display
    }
  }

  static importJSON(
    serializedNode: SerializedWorkbenchWikiLinkNode
  ): WorkbenchWikiLinkNode {
    const { target, display } = serializedNode
    return $applyNodeReplacement($createWorkbenchWikiLinkNode(target, display))
  }

  getTarget(): string {
    return this.getLatest().__target
  }

  getDisplayText(): string {
    return this.getLatest().__display ?? wikiLinkDefaultDisplay(this.getLatest().__target)
  }

  createDOM(config: EditorConfig): HTMLElement {
    const element = document.createElement('span')
    element.className = config.theme.wikiLink ?? 'workbench-wiki-link'
    element.setAttribute('data-wiki-target', this.__target)
    return element
  }

  updateDOM(prevNode: WorkbenchWikiLinkNode, dom: HTMLElement): boolean {
    if (prevNode.__target !== this.__target) {
      dom.setAttribute('data-wiki-target', this.__target)
    }
    return false
  }

  isInline(): boolean {
    return true
  }

  decorate(): JSX.Element {
    return <WikiLinkChip target={this.__target} display={this.getDisplayText()} />
  }
}

function WikiLinkChip({ target, display }: { target: string; display: string }): JSX.Element {
  const fileTree = useWorkbenchStore((s) => s.fileTree)
  const fileSort = useWorkbenchStore((s) => s.fileSort)
  const resolution = useMemo(
    () => resolveWikiLinkTarget(target, flattenSortedFiles(fileTree, fileSort)),
    [target, fileTree, fileSort]
  )
  const missing = resolution.path === null

  return (
    <WorkbenchFileChip
      missing={missing}
      label={display}
      title={missing ? `${target}（未找到目标文件）` : resolution.path ?? target}
      icon={
        missing || !resolution.node ? (
          <FileChipMissingIcon />
        ) : (
          <FileChipIcon absPath={resolution.node.fullPath || resolution.node.path} name={resolution.node.name} />
        )
      }
    />
  )
}

export function $createWorkbenchWikiLinkNode(
  target: string,
  display?: string | null
): WorkbenchWikiLinkNode {
  return $applyNodeReplacement(new WorkbenchWikiLinkNode(target, display))
}

export function $isWorkbenchWikiLinkNode(
  node: LexicalNode | null | undefined
): node is WorkbenchWikiLinkNode {
  return node instanceof WorkbenchWikiLinkNode
}
