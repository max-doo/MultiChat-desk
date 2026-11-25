import type { JSX } from 'react'
import type {
  EditorConfig,
  LexicalNode,
  NodeKey,
  ParagraphNode,
  RangeSelection,
  SerializedElementNode,
  SerializedLexicalNode,
  Spread
} from 'lexical'
import {
  $applyNodeReplacement,
  $createParagraphNode,
  DecoratorNode,
  ElementNode
} from 'lexical'

export type SerializedWorkbenchFootnoteRefNode = Spread<
  {
    footnoteId: string
  },
  SerializedLexicalNode
>

export type SerializedWorkbenchFootnoteDefNode = Spread<
  {
    footnoteId: string
  },
  SerializedElementNode
>

/**
 * 工作台脚注引用节点（行内）：
 * - Markdown 序列化为 [^id]，正文里呈现为上标编号胶囊；
 * - 悬停可预览定义正文，点击可平滑跳转到对应定义行。
 */
export class WorkbenchFootnoteRefNode extends DecoratorNode<JSX.Element> {
  __footnoteId: string

  static getType(): string {
    return 'workbench-footnote-ref'
  }

  static clone(node: WorkbenchFootnoteRefNode): WorkbenchFootnoteRefNode {
    return new WorkbenchFootnoteRefNode(node.__footnoteId, node.__key)
  }

  constructor(footnoteId: string, key?: NodeKey) {
    super(key)
    this.__footnoteId = footnoteId
  }

  exportJSON(): SerializedWorkbenchFootnoteRefNode {
    return {
      ...super.exportJSON(),
      footnoteId: this.__footnoteId
    }
  }

  static importJSON(
    serializedNode: SerializedWorkbenchFootnoteRefNode
  ): WorkbenchFootnoteRefNode {
    const { footnoteId } = serializedNode
    return $applyNodeReplacement($createWorkbenchFootnoteRefNode(footnoteId))
  }

  getFootnoteId(): string {
    return this.getLatest().__footnoteId
  }

  setFootnoteId(footnoteId: string): this {
    const self = this.getWritable()
    self.__footnoteId = footnoteId
    return self
  }

  createDOM(config: EditorConfig): HTMLElement {
    const element = document.createElement('span')
    element.className = config.theme.footnoteRef ?? 'PlaygroundEditorTheme__footnoteRef'
    element.setAttribute('data-footnote-ref-id', this.__footnoteId)
    return element
  }

  updateDOM(prevNode: WorkbenchFootnoteRefNode, dom: HTMLElement): boolean {
    if (prevNode.__footnoteId !== this.__footnoteId) {
      dom.setAttribute('data-footnote-ref-id', this.__footnoteId)
    }
    return false
  }

  isInline(): boolean {
    return true
  }

  decorate(): JSX.Element {
    return (
      <sup
        data-footnote-ref-id={this.__footnoteId}
        className="workbench-footnote-ref-pill mx-0.5 inline-flex items-center rounded px-1 py-px font-medium leading-none select-none cursor-pointer transition-colors"
      >
        {this.__footnoteId}
      </sup>
    )
  }
}

export function $createWorkbenchFootnoteRefNode(footnoteId = ''): WorkbenchFootnoteRefNode {
  return $applyNodeReplacement(new WorkbenchFootnoteRefNode(footnoteId))
}

export function $isWorkbenchFootnoteRefNode(
  node: LexicalNode | null | undefined
): node is WorkbenchFootnoteRefNode {
  return node instanceof WorkbenchFootnoteRefNode
}

/**
 * 工作台脚注定义块节点（块级 ElementNode）：
 * - Markdown 序列化为 `[^id]: 内容`（内容为空时为 `[^id]:`）；
 * - 左侧通过 CSS `::before` 渲染与正文引用一致的序号徽章，隐藏 `[^id]:` 原格式；
 * - 内部保留完整 Lexical 行内富文本、查找高亮与标注能力。
 */
export class WorkbenchFootnoteDefNode extends ElementNode {
  __footnoteId: string

  static getType(): string {
    return 'workbench-footnote-def'
  }

  static clone(node: WorkbenchFootnoteDefNode): WorkbenchFootnoteDefNode {
    return new WorkbenchFootnoteDefNode(node.__footnoteId, node.__key)
  }

  constructor(footnoteId: string, key?: NodeKey) {
    super(key)
    this.__footnoteId = footnoteId
  }

  exportJSON(): SerializedWorkbenchFootnoteDefNode {
    return {
      ...super.exportJSON(),
      footnoteId: this.__footnoteId
    }
  }

  static importJSON(
    serializedNode: SerializedWorkbenchFootnoteDefNode
  ): WorkbenchFootnoteDefNode {
    const node = $createWorkbenchFootnoteDefNode(serializedNode.footnoteId)
    node.setFormat(serializedNode.format)
    node.setIndent(serializedNode.indent)
    node.setDirection(serializedNode.direction)
    return node
  }

  getFootnoteId(): string {
    return this.getLatest().__footnoteId
  }

  setFootnoteId(footnoteId: string): this {
    const self = this.getWritable()
    self.__footnoteId = footnoteId
    return self
  }

  createDOM(config: EditorConfig): HTMLElement {
    const element = document.createElement('div')
    element.className = config.theme.footnoteDef ?? 'PlaygroundEditorTheme__footnoteDef'
    element.setAttribute('data-footnote-def-id', this.__footnoteId)
    return element
  }

  updateDOM(prevNode: WorkbenchFootnoteDefNode, dom: HTMLElement): boolean {
    if (prevNode.__footnoteId !== this.__footnoteId) {
      dom.setAttribute('data-footnote-def-id', this.__footnoteId)
    }
    return false
  }

  insertNewAfter(_selection: RangeSelection, restoreSelection = true): ParagraphNode {
    const newBlock = $createParagraphNode()
    newBlock.setDirection(this.getDirection())
    this.insertAfter(newBlock, restoreSelection)
    return newBlock
  }

  collapseAtStart(): true {
    const paragraph = $createParagraphNode()
    for (const child of this.getChildren()) {
      paragraph.append(child)
    }
    this.replace(paragraph)
    return true
  }

  extractWithChild(): boolean {
    return true
  }

  canIndent(): boolean {
    return false
  }
}

export function $createWorkbenchFootnoteDefNode(footnoteId = ''): WorkbenchFootnoteDefNode {
  return $applyNodeReplacement(new WorkbenchFootnoteDefNode(footnoteId))
}

export function $isWorkbenchFootnoteDefNode(
  node: LexicalNode | null | undefined
): node is WorkbenchFootnoteDefNode {
  return node instanceof WorkbenchFootnoteDefNode
}
