import { HorizontalRuleNode } from '@lexical/react/LexicalHorizontalRuleNode'
import type { SerializedHorizontalRuleNode } from '@lexical/react/LexicalHorizontalRuleNode'
import type {
  LexicalNode,
  LexicalUpdateJSON,
  NodeKey,
  SerializedLexicalNode
} from 'lexical'
import { $applyNodeReplacement } from 'lexical'

export type HorizontalRuleMarkerStyle = '---' | '***' | '___'

export interface SerializedWorkbenchHorizontalRuleNode extends SerializedHorizontalRuleNode {
  markerStyle?: HorizontalRuleMarkerStyle
}

export class WorkbenchHorizontalRuleNode extends HorizontalRuleNode {
  __markerStyle: HorizontalRuleMarkerStyle | null

  constructor(markerStyle?: HorizontalRuleMarkerStyle | null, key?: NodeKey) {
    super(key)
    this.__markerStyle = markerStyle ?? null
  }

  static getType(): string {
    return 'workbench-horizontalrule'
  }

  static clone(node: WorkbenchHorizontalRuleNode): WorkbenchHorizontalRuleNode {
    return new WorkbenchHorizontalRuleNode(node.__markerStyle, node.__key)
  }

  static importJSON(serializedNode: SerializedLexicalNode): WorkbenchHorizontalRuleNode {
    const { markerStyle } = serializedNode as SerializedWorkbenchHorizontalRuleNode
    return $applyNodeReplacement(
      new WorkbenchHorizontalRuleNode(markerStyle ?? null)
    )
  }

  updateFromJSON(
    serializedNode: LexicalUpdateJSON<SerializedWorkbenchHorizontalRuleNode>
  ): this {
    return super
      .updateFromJSON(serializedNode)
      .setMarkerStyle(serializedNode.markerStyle ?? null)
  }

  setMarkerStyle(markerStyle: HorizontalRuleMarkerStyle | null): this {
    const self = this.getWritable()
    self.__markerStyle = markerStyle
    return self
  }

  getMarkerStyle(): HorizontalRuleMarkerStyle | null {
    return this.getLatest().__markerStyle
  }

  exportJSON(): SerializedWorkbenchHorizontalRuleNode {
    return {
      ...super.exportJSON(),
      markerStyle: this.__markerStyle ?? undefined
    } as SerializedWorkbenchHorizontalRuleNode
  }
}

export function $createWorkbenchHorizontalRuleNode(
  markerStyle?: HorizontalRuleMarkerStyle | null
): WorkbenchHorizontalRuleNode {
  return $applyNodeReplacement(new WorkbenchHorizontalRuleNode(markerStyle ?? null))
}

export function $isWorkbenchHorizontalRuleNode(
  node: LexicalNode | null | undefined
): node is WorkbenchHorizontalRuleNode {
  return node instanceof WorkbenchHorizontalRuleNode
}
