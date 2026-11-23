import { useCallback, useEffect, useRef, useState } from 'react'
import type { JSX } from 'react'
import type { EditorConfig, LexicalNode, NodeKey, SerializedLexicalNode, Spread } from 'lexical'
import { $applyNodeReplacement, $getNodeByKey, DecoratorNode } from 'lexical'
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext'
import { useLexicalNodeSelection } from '@lexical/react/useLexicalNodeSelection'
import katex from 'katex'
import { AppIcon } from '../icons/AppIcon'

export type SerializedWorkbenchEquationNode = Spread<
  {
    equation: string
    inline: boolean
  },
  SerializedLexicalNode
>

/**
 * 工作台 Markdown 数学公式节点（KaTeX 渲染）
 * - inline=true: 行内公式，Markdown 序列化为 $...$，作为行内元素嵌在段落里
 * - inline=false: 块级公式，Markdown 序列化为 $$...$$
 * - 双击弹出源码编辑框，Enter/失焦保存，Esc 取消
 */
export class WorkbenchEquationNode extends DecoratorNode<JSX.Element> {
  __equation: string
  __inline: boolean

  static getType(): string {
    return 'workbench-equation'
  }

  static clone(node: WorkbenchEquationNode): WorkbenchEquationNode {
    return new WorkbenchEquationNode(node.__equation, node.__inline, node.__key)
  }

  constructor(equation: string, inline: boolean, key?: NodeKey) {
    super(key)
    this.__equation = equation
    this.__inline = inline
  }

  exportJSON(): SerializedWorkbenchEquationNode {
    return {
      ...super.exportJSON(),
      equation: this.__equation,
      inline: this.__inline
    }
  }

  static importJSON(serializedNode: SerializedWorkbenchEquationNode): WorkbenchEquationNode {
    const { equation, inline } = serializedNode
    return $applyNodeReplacement($createWorkbenchEquationNode(equation, inline))
  }

  getEquation(): string {
    return this.getLatest().__equation
  }

  isInlineMode(): boolean {
    return this.getLatest().__inline
  }

  setEquation(equation: string): this {
    const self = this.getWritable()
    self.__equation = equation
    return self
  }

  createDOM(config: EditorConfig): HTMLElement {
    const element = document.createElement(this.__inline ? 'span' : 'div')
    element.className = config.theme.equation ?? ''
    return element
  }

  updateDOM(): false {
    return false
  }

  isInline(): boolean {
    return this.__inline
  }

  decorate(): JSX.Element {
    return (
      <WorkbenchEquationComponent
        equation={this.__equation}
        inline={this.__inline}
        nodeKey={this.getKey()}
      />
    )
  }
}

export function $createWorkbenchEquationNode(equation = '', inline = false): WorkbenchEquationNode {
  return $applyNodeReplacement(new WorkbenchEquationNode(equation, inline))
}

export function $isWorkbenchEquationNode(
  node: LexicalNode | null | undefined
): node is WorkbenchEquationNode {
  return node instanceof WorkbenchEquationNode
}

function $getEquationNodeByKey(key: NodeKey): WorkbenchEquationNode | null {
  const node = $getNodeByKey(key)
  return $isWorkbenchEquationNode(node) ? node : null
}

// ---- React 组件：KaTeX 渲染 + 双击编辑 ----

interface WorkbenchEquationComponentProps {
  equation: string
  inline: boolean
  nodeKey: NodeKey
}

function WorkbenchEquationComponent({
  equation,
  inline,
  nodeKey
}: WorkbenchEquationComponentProps): JSX.Element {
  const [editor] = useLexicalComposerContext()
  const [isSelected, setSelected, clearSelection] = useLexicalNodeSelection(nodeKey)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(equation)
  const katexRef = useRef<HTMLElement | null>(null)
  const textareaRef = useRef<HTMLTextAreaElement | null>(null)
  const [renderError, setRenderError] = useState<string | null>(null)

  useEffect(() => {
    const element = katexRef.current
    if (!element) return
    try {
      katex.render(equation, element, {
        displayMode: !inline,
        throwOnError: true,
        errorColor: '#cc0000'
      })
      setRenderError(null)
    } catch (error) {
      setRenderError(error instanceof Error ? error.message : String(error))
      element.textContent = equation
    }
  }, [equation, inline])

  useEffect(() => {
    if (editing) {
      setDraft(equation)
      // 等 textarea 挂载后聚焦
      requestAnimationFrame(() => {
        textareaRef.current?.focus()
        textareaRef.current?.select()
      })
    }
  }, [editing, equation])

  const commitEdit = useCallback(() => {
    const next = draft.trim()
    setEditing(false)
    if (next && next !== equation) {
      editor.update(() => {
        $getEquationNodeByKey(nodeKey)?.setEquation(next)
      })
    }
  }, [draft, equation, editor, nodeKey])

  const openEditor = useCallback(() => {
    clearSelection()
    setSelected(true)
    setEditing(true)
  }, [clearSelection, setSelected])

  const Wrapper = inline ? 'span' : 'div'

  return (
    <Wrapper
      className={
        inline
          ? `workbench-equation workbench-equation-inline relative cursor-default rounded px-0.5 transition-colors ${
              isSelected ? 'bg-primary/15 ring-1 ring-primary/40' : 'hover:bg-black/5 dark:hover:bg-white/5'
            }`
          : `workbench-equation workbench-equation-block relative my-2 cursor-default rounded-lg px-3 py-2 text-center transition-colors ${
              isSelected ? 'bg-primary/10 ring-1 ring-primary/40' : 'hover:bg-black/5 dark:hover:bg-white/5'
            }`
      }
      onClick={() => {
        if (!isSelected) {
          clearSelection()
          setSelected(true)
        }
      }}
      onDoubleClick={openEditor}
      title={renderError ? `公式语法错误: ${renderError}` : undefined}
    >
      <span ref={katexRef} className={renderError ? 'text-red-500 font-mono text-sm' : ''} />

      {editing && (
        <div
          className="absolute left-0 top-full z-50 mt-1 w-80 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 shadow-float p-2 text-left"
          onClick={(e) => e.stopPropagation()}
        >
          <textarea
            ref={textareaRef}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                commitEdit()
              } else if (e.key === 'Escape') {
                e.preventDefault()
                setEditing(false)
              }
            }}
            onBlur={commitEdit}
            className="w-full h-20 resize-y rounded-md border border-gray-300 dark:border-gray-600 bg-transparent px-2 py-1 font-mono text-xs text-text-primary focus:outline-none focus:ring-1 focus:ring-primary/40"
            spellCheck={false}
          />
          <div className="mt-1 flex items-center justify-between text-[10px] text-text-secondary">
            <span className="flex items-center gap-1">
              <AppIcon name="function" size={12} />
              LaTeX · Enter 保存 / Esc 取消
            </span>
            <button
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={commitEdit}
              className="px-2 py-0.5 rounded bg-primary text-white text-[10px] hover:opacity-90"
            >
              保存
            </button>
          </div>
        </div>
      )}
    </Wrapper>
  )
}
