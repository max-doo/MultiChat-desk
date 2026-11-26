import type {
  EditorConfig,
  LexicalNode,
  NodeKey,
  SerializedElementNode
} from 'lexical'
import { $applyNodeReplacement, ElementNode } from 'lexical'

/**
 * Pandoc 引文节点（行内纯文本容器）：
 * 内容 verbatim 保存方括号与全部原始字符，编辑器等价于一段带颜色的普通文本，
 * 不做胶囊/徽章等复杂渲染；导出直接拼回原文，保证源码逐字节保真。
 */
export class WorkbenchCitationNode extends ElementNode {
  static getType(): string {
    return 'workbench-citation'
  }

  static clone(node: WorkbenchCitationNode): WorkbenchCitationNode {
    return new WorkbenchCitationNode(node.__key)
  }

  constructor(key?: NodeKey) {
    super(key)
  }

  exportJSON(): SerializedElementNode {
    return super.exportJSON()
  }

  static importJSON(serializedNode: SerializedElementNode): WorkbenchCitationNode {
    const node = $createWorkbenchCitationNode()
    node.setFormat(serializedNode.format)
    node.setIndent(serializedNode.indent)
    node.setDirection(serializedNode.direction)
    return node
  }

  createDOM(config: EditorConfig): HTMLElement {
    const element = document.createElement('span')
    element.className = config.theme.citation ?? 'PlaygroundEditorTheme__citation'
    return element
  }

  updateDOM(): boolean {
    return false
  }

  isInline(): boolean {
    return true
  }

  extractWithChild(): boolean {
    return true
  }

  canIndent(): boolean {
    return false
  }
}

export function $createWorkbenchCitationNode(): WorkbenchCitationNode {
  return $applyNodeReplacement(new WorkbenchCitationNode())
}

export function $isWorkbenchCitationNode(
  node: LexicalNode | null | undefined
): node is WorkbenchCitationNode {
  return node instanceof WorkbenchCitationNode || node?.getType() === 'workbench-citation'
}

/**
 * HTML 注释节点（行内纯文本容器）：
 * 与引文节点同构，内容 verbatim 含 <!-- 与 --> 定界符；
 * 编辑器内以弱化字体样式呈现，无额外装饰元素。
 */
export class WorkbenchCommentNode extends ElementNode {
  static getType(): string {
    return 'workbench-comment'
  }

  static clone(node: WorkbenchCommentNode): WorkbenchCommentNode {
    return new WorkbenchCommentNode(node.__key)
  }

  constructor(key?: NodeKey) {
    super(key)
  }

  exportJSON(): SerializedElementNode {
    return super.exportJSON()
  }

  static importJSON(serializedNode: SerializedElementNode): WorkbenchCommentNode {
    const node = $createWorkbenchCommentNode()
    node.setFormat(serializedNode.format)
    node.setIndent(serializedNode.indent)
    node.setDirection(serializedNode.direction)
    return node
  }

  createDOM(config: EditorConfig): HTMLElement {
    const element = document.createElement('span')
    element.className = config.theme.comment ?? 'PlaygroundEditorTheme__comment'
    return element
  }

  updateDOM(): boolean {
    return false
  }

  isInline(): boolean {
    return true
  }

  extractWithChild(): boolean {
    return true
  }

  canIndent(): boolean {
    return false
  }
}

export function $createWorkbenchCommentNode(): WorkbenchCommentNode {
  return $applyNodeReplacement(new WorkbenchCommentNode())
}

export function $isWorkbenchCommentNode(
  node: LexicalNode | null | undefined
): node is WorkbenchCommentNode {
  return node instanceof WorkbenchCommentNode || node?.getType() === 'workbench-comment'
}
