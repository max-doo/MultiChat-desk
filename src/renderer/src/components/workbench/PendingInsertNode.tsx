import {
  ElementNode,
  type EditorConfig,
  type LexicalNode,
  type NodeKey,
  type SerializedElementNode,
  $applyNodeReplacement,
  createCommand,
  COMMAND_PRIORITY_EDITOR
} from 'lexical'

export type SerializedPendingInsertNode = SerializedElementNode

/** 自定义 Lexical 命令：确认（采纳）待插入内容 */
export const CONFIRM_INSERT_COMMAND = createCommand('CONFIRM_INSERT')
/** 自定义 Lexical 命令：撤回待插入内容 */
export const CANCEL_INSERT_COMMAND = createCommand('CANCEL_INSERT')
/** 自定义 Lexical 命令：在当前光标处插入待确认回复 */
export const INSERT_REPLY_COMMAND = createCommand<string>('INSERT_REPLY')

export { COMMAND_PRIORITY_EDITOR }

/**
 * 「待确认插入」容器节点：children 正常参与编辑与 markdown 导出；
 * 最后一个 child 是 ✓/✗ 工具条。采纳解包 children，撤回整体删除。
 */
export class PendingInsertNode extends ElementNode {
  static getType(): string {
    return 'pending-insert'
  }

  static clone(node: PendingInsertNode): PendingInsertNode {
    return new PendingInsertNode(node.__key)
  }

  constructor(key?: NodeKey) {
    super(key)
  }

  static importJSON(_serialized: SerializedPendingInsertNode): PendingInsertNode {
    return $createPendingInsertNode()
  }

  exportJSON(compact?: boolean): SerializedPendingInsertNode {
    return {
      ...super.exportJSON(),
      type: 'pending-insert',
      version: 1
    }
  }

  createDOM(config: EditorConfig): HTMLElement {
    const dom = document.createElement('div')
    dom.className = 'mc-pending-insert'
    const themeClass = (config.theme as Record<string, string> | undefined)?.pendingInsert
    if (themeClass) dom.classList.add(themeClass)
    return dom
  }

  updateDOM(): boolean {
    return false
  }

  static importDOM(): null {
    return null
  }

  isInline(): false {
    return false
  }

  canBeEmpty(): false {
    return false
  }
}

export function $createPendingInsertNode(): PendingInsertNode {
  return $applyNodeReplacement(new PendingInsertNode())
}

export function $isPendingInsertNode(
  node: LexicalNode | null | undefined
): node is PendingInsertNode {
  return node instanceof PendingInsertNode
}
