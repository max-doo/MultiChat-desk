import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { JSX, MouseEvent as ReactMouseEvent } from 'react'
import type { EditorConfig, LexicalNode, NodeKey, SerializedLexicalNode, Spread } from 'lexical'
import { $applyNodeReplacement, $getNodeByKey, DecoratorNode } from 'lexical'
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext'
import { useLexicalNodeSelection } from '@lexical/react/useLexicalNodeSelection'
import katex from 'katex'
import { AppIcon } from '../icons/AppIcon'
import { useWorkbenchStore } from '../../store/workbenchStore'
import WorkbenchEquationEditor from './WorkbenchEquationEditor'

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
 * - 双击弹出共享公式编辑弹层（WorkbenchEquationEditor），支持 KaTeX 预览与清除
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

interface EquationMenuState {
  x: number
  y: number
}

function WorkbenchEquationComponent({
  equation,
  inline,
  nodeKey
}: WorkbenchEquationComponentProps): JSX.Element {
  const [editor] = useLexicalComposerContext()
  const [isSelected, setSelected, clearSelection] = useLexicalNodeSelection(nodeKey)
  const [editing, setEditing] = useState(false)
  const katexRef = useRef<HTMLElement | null>(null)
  const [renderError, setRenderError] = useState<string | null>(null)
  const [menu, setMenu] = useState<EquationMenuState | null>(null)
  const menuRef = useRef<HTMLDivElement | null>(null)
  const wrapperRef = useRef<HTMLElement | null>(null)

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

  // 右键菜单：点击外部 / Esc / 失焦关闭
  useEffect(() => {
    if (!menu) return
    const close = (): void => setMenu(null)
    const handleKeyDown = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setMenu(null)
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

  const openEditor = useCallback(() => {
    clearSelection()
    setSelected(true)
    setEditing(true)
  }, [clearSelection, setSelected])

  const applyEquation = useCallback(
    (next: string) => {
      if (next === equation) return
      editor.update(() => {
        $getEquationNodeByKey(nodeKey)?.setEquation(next)
      })
    },
    [editor, equation, nodeKey]
  )

  // 清除公式：整体删除节点（弹层"清除"按钮 + 清空内容保存两条入口共用）
  const clearEquation = useCallback(() => {
    editor.update(() => {
      $getEquationNodeByKey(nodeKey)?.remove()
    })
  }, [editor, nodeKey])

  const handleContextMenu = useCallback(
    (e: ReactMouseEvent): void => {
      // 公式是 decorator，浏览器选区拿不到源码；这里接管右键，
      // 给全局 CustomContextMenu 让位前先阻止它。
      e.preventDefault()
      e.stopPropagation()
      if (!isSelected) {
        clearSelection()
        setSelected(true)
      }
      const menuWidth = 176
      const menuHeight = 320
      setMenu({
        x: Math.max(8, Math.min(e.clientX, window.innerWidth - menuWidth - 8)),
        y: Math.max(8, Math.min(e.clientY, window.innerHeight - menuHeight - 8))
      })
    },
    [clearSelection, isSelected, setSelected]
  )

  const copyLatex = useCallback(() => {
    setMenu(null)
    const source = inline ? `$${equation}$` : `$$${equation}$$`
    void navigator.clipboard.writeText(source)
  }, [equation, inline])

  const handleAiAction = useCallback(
    (actionType: 'ask' | 'explain' | 'polish' | 'summarize') => {
      setMenu(null)
      useWorkbenchStore.getState().askAi(equation, actionType)
    },
    [equation]
  )

  const editEquation = useCallback(() => {
    setMenu(null)
    openEditor()
  }, [openEditor])

  const removeEquation = useCallback(() => {
    setMenu(null)
    editor.update(() => {
      $getEquationNodeByKey(nodeKey)?.remove()
    })
  }, [editor, nodeKey])

  const Wrapper = inline ? 'span' : 'div'
  const editingRect = editing ? wrapperRef.current?.getBoundingClientRect() : null

  return (
    <Wrapper
      // @ts-expect-error span/div 的 ref 类型在联合标签下不一致，这里只用于读布局
      ref={wrapperRef}
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
      onContextMenu={handleContextMenu}
      title={renderError ? `公式语法错误: ${renderError}` : undefined}
    >
      <span ref={katexRef} className={renderError ? 'text-red-500 font-mono text-sm' : ''} />

      {menu &&
        createPortal(
          <div
            ref={menuRef}
            role="menu"
            className="fixed z-popover min-w-[176px] select-none rounded-xl border border-black/10 bg-white/95 py-1.5 text-body shadow-xl backdrop-blur-md dark:border-white/10 dark:bg-gray-800/95"
            style={{ left: menu.x, top: menu.y }}
            onContextMenu={(e) => e.preventDefault()}
          >
            <button
              type="button"
              role="menuitem"
              className="flex w-full cursor-pointer items-center gap-2 px-3 py-1.5 text-left font-medium text-text-primary transition-colors hover:bg-black/5 dark:hover:bg-white/5"
              onClick={() => handleAiAction('ask')}
            >
              <AppIcon name="chat" size={19} className="shrink-0 text-blue-500" />
              向 AI 提问
            </button>
            <button
              type="button"
              role="menuitem"
              className="flex w-full cursor-pointer items-center gap-2 px-3 py-1.5 text-left font-medium text-text-primary transition-colors hover:bg-black/5 dark:hover:bg-white/5"
              onClick={() => handleAiAction('explain')}
            >
              <AppIcon name="psychology" size={19} className="shrink-0 text-purple-500" />
              解释此公式
            </button>
            <button
              type="button"
              role="menuitem"
              className="flex w-full cursor-pointer items-center gap-2 px-3 py-1.5 text-left font-medium text-text-primary transition-colors hover:bg-black/5 dark:hover:bg-white/5"
              onClick={() => handleAiAction('polish')}
            >
              <AppIcon name="auto_fix_high" size={19} className="shrink-0 text-emerald-500" />
              语言润色
            </button>
            <button
              type="button"
              role="menuitem"
              className="flex w-full cursor-pointer items-center gap-2 px-3 py-1.5 text-left font-medium text-text-primary transition-colors hover:bg-black/5 dark:hover:bg-white/5"
              onClick={() => handleAiAction('summarize')}
            >
              <AppIcon name="format_list_bulleted" size={19} className="shrink-0 text-cyan-500" />
              提取关键要点
            </button>
            <div className="my-1 border-t border-black/5 dark:border-white/5" role="separator" />
            <button
              type="button"
              role="menuitem"
              className="flex w-full cursor-pointer items-center gap-2 px-3 py-1.5 text-left font-medium text-text-primary transition-colors hover:bg-black/5 dark:hover:bg-white/5"
              onClick={editEquation}
            >
              <AppIcon name="edit" size={19} className="shrink-0 text-text-secondary" />
              编辑公式
            </button>
            <button
              type="button"
              role="menuitem"
              className="flex w-full cursor-pointer items-center gap-2 px-3 py-1.5 text-left font-medium text-text-primary transition-colors hover:bg-black/5 dark:hover:bg-white/5"
              onClick={copyLatex}
            >
              <AppIcon name="content_copy" size={19} className="shrink-0 text-text-secondary" />
              复制 LaTeX
            </button>
            <button
              type="button"
              role="menuitem"
              className="flex w-full cursor-pointer items-center gap-2 px-3 py-1.5 text-left font-medium text-red-500 transition-colors hover:bg-black/5 dark:hover:bg-white/5"
              onClick={removeEquation}
            >
              <AppIcon name="delete" size={19} className="shrink-0" />
              删除公式
            </button>
          </div>,
          document.body
        )}

      {editing && (
        <WorkbenchEquationEditor
          anchorRect={editingRect ?? new DOMRect(8, 8, 0, 0)}
          initialEquation={equation}
          inline={inline}
          onApply={applyEquation}
          onClear={clearEquation}
          onClose={() => setEditing(false)}
        />
      )}
    </Wrapper>
  )
}
