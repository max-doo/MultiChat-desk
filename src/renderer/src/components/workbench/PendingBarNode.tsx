import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext'
import { AppIcon } from '../icons/AppIcon'
import {
  DecoratorNode,
  type EditorConfig,
  type LexicalNode,
  type NodeKey,
  type SerializedLexicalNode,
  $applyNodeReplacement
} from 'lexical'
import { CONFIRM_INSERT_COMMAND, CANCEL_INSERT_COMMAND } from './PendingInsertNode'

export type SerializedPendingBarNode = SerializedLexicalNode

function PendingBarComponent(): JSX.Element {
  const [editor] = useLexicalComposerContext()
  return (
    <div className="mc-pending-bar" contentEditable={false}>
      <button
        type="button"
        className="mc-pending-btn mc-pending-accept"
        title="采纳"
        aria-label="采纳"
        onClick={(e) => {
          e.preventDefault()
          e.stopPropagation()
          editor.dispatchCommand(CONFIRM_INSERT_COMMAND, undefined)
        }}
      >
        <AppIcon name="check" />
      </button>
      <button
        type="button"
        className="mc-pending-btn mc-pending-reject"
        title="撤回"
        aria-label="撤回"
        onClick={(e) => {
          e.preventDefault()
          e.stopPropagation()
          editor.dispatchCommand(CANCEL_INSERT_COMMAND, undefined)
        }}
      >
        <AppIcon name="close" />
      </button>
    </div>
  )
}

/**
 * 待确认插入的底部工具条节点（Decorator）。
 * 作为 PendingInsertNode 的最后一个 child 存在，渲染 ✓/✗ 按钮。
 */
export class PendingBarNode extends DecoratorNode<JSX.Element> {
  static getType(): string {
    return 'pending-bar'
  }

  static clone(node: PendingBarNode): PendingBarNode {
    return new PendingBarNode(node.__key)
  }

  constructor(key?: NodeKey) {
    super(key)
  }

  static importJSON(_serialized: SerializedPendingBarNode): PendingBarNode {
    return $createPendingBarNode()
  }

  exportJSON(_compact?: boolean): SerializedPendingBarNode {
    return {
      type: 'pending-bar',
      version: 1
    }
  }

  createDOM(_config: EditorConfig): HTMLElement {
    const dom = document.createElement('div')
    dom.className = 'mc-pending-bar-wrap'
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

  decorate(): JSX.Element {
    return <PendingBarComponent />
  }
}

export function $createPendingBarNode(): PendingBarNode {
  return $applyNodeReplacement(new PendingBarNode())
}

export function $isPendingBarNode(
  node: LexicalNode | null | undefined
): node is PendingBarNode {
  return node instanceof PendingBarNode
}
