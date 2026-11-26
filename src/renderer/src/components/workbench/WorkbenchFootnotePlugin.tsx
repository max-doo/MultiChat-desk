import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext'
import {
  $getSelection,
  $isElementNode,
  $isParagraphNode,
  $isRangeSelection,
  $isTextNode,
  $getRoot,
  $createTextNode,
  COMMAND_PRIORITY_EDITOR,
  COMMAND_PRIORITY_HIGH,
  PASTE_COMMAND,
  createCommand,
  type LexicalCommand,
  type LexicalNode,
  type NodeKey,
  type PasteCommandType
} from 'lexical'
import { $isCodeNode } from '@lexical/code'
import { $generateNodesFromMarkdownString } from '@lexical/markdown'
import { mergeRegister } from '@lexical/utils'
import {
  $createWorkbenchFootnoteDefNode,
  $createWorkbenchFootnoteRefNode,
  $isWorkbenchFootnoteDefNode,
  $isWorkbenchFootnoteRefNode,
  WorkbenchFootnoteDefNode,
  WorkbenchFootnoteRefNode
} from './WorkbenchFootnoteNode'
import {
  FOOTNOTE_DEF_LINE_RE,
  FOOTNOTE_REF_MATCH_RE,
  collectFootnoteStateFromLexical,
  isValidFootnoteId
} from './workbenchFootnotes'
import { WORKBENCH_TRANSFORMERS } from './MarkdownSyncPlugin'
import { splitEquationPaste } from './equationPaste'
import type { FootnoteInsertMode } from './WorkbenchFootnotePopover'
import {
  $isWorkbenchCitationNode,
  $isWorkbenchCommentNode
} from './WorkbenchInlineMarkupNodes'

export const INSERT_FOOTNOTE_COMMAND: LexicalCommand<{
  id: string
  content: string
  mode?: FootnoteInsertMode
}> = createCommand('INSERT_FOOTNOTE')

interface FootnoteTip {
  id: string
  content: string
  missing: boolean
  left: number
  top: number
  width: number
  placement: 'above' | 'below'
}

const VIEWPORT_MARGIN = 8
const MAX_TIP_WIDTH = 360
const FLASH_DURATION_MS = 1200

function flashElement(el: HTMLElement): void {
  el.classList.remove('workbench-footnote-flash')
  // 强制重排以重启同一元素的动画
  void el.offsetWidth
  el.classList.add('workbench-footnote-flash')
  window.setTimeout(() => {
    el.classList.remove('workbench-footnote-flash')
  }, FLASH_DURATION_MS)
}

function findDefElementById(root: HTMLElement, id: string): HTMLElement | null {
  for (const el of root.querySelectorAll<HTMLElement>('.PlaygroundEditorTheme__footnoteDef[data-footnote-def-id]')) {
    if (el.getAttribute('data-footnote-def-id') === id) return el
  }
  return null
}

function findRefElementsById(root: HTMLElement, id: string): HTMLElement[] {
  const list: HTMLElement[] = []
  for (const el of root.querySelectorAll<HTMLElement>('.PlaygroundEditorTheme__footnoteRef[data-footnote-ref-id]')) {
    if (el.getAttribute('data-footnote-ref-id') === id) list.push(el)
  }
  return list
}

function isClickOnDefBadge(defEl: HTMLElement, event: MouseEvent): boolean {
  const rect = defEl.getBoundingClientRect()
  const firstChild = defEl.firstChild
  if (!firstChild) return false
  const range = document.createRange()
  if (firstChild.nodeType === Node.TEXT_NODE) {
    range.setStart(firstChild, 0)
    range.setEnd(firstChild, 0)
  } else {
    range.setStartBefore(firstChild)
    range.setEndBefore(firstChild)
  }
  const contentRect = range.getBoundingClientRect()
  if (contentRect.left <= rect.left) return false
  return (
    event.clientX >= rect.left &&
    event.clientX < contentRect.left &&
    event.clientY >= rect.top &&
    event.clientY <= Math.max(contentRect.bottom, rect.top + 32)
  )
}

function containsFootnoteNode(nodes: LexicalNode[]): boolean {
  for (const node of nodes) {
    if ($isWorkbenchFootnoteRefNode(node) || $isWorkbenchFootnoteDefNode(node)) {
      return true
    }
    if ($isElementNode(node) && containsFootnoteNode(node.getChildren())) {
      return true
    }
  }
  return false
}

/** 引文/注释与脚注共用同一粘贴转换管线：命中任一自定义行内节点即接管粘贴 */
function containsInlineMarkupNode(nodes: LexicalNode[]): boolean {
  for (const node of nodes) {
    if ($isWorkbenchCitationNode(node) || $isWorkbenchCommentNode(node)) {
      return true
    }
    if ($isElementNode(node) && containsInlineMarkupNode(node.getChildren())) {
      return true
    }
  }
  return false
}

function hasFootnoteSyntax(text: string): boolean {
  if (!text.includes('[^')) return false
  if (FOOTNOTE_REF_MATCH_RE.test(text)) return true
  return text.split(/\r?\n/).some((line) => FOOTNOTE_DEF_LINE_RE.test(line))
}

/** 引文/注释语法粗筛：命中即进入转换管线，最终仍以转换产物是否真的生成节点为准 */
function hasInlineMarkupSyntax(text: string): boolean {
  if (text.includes('<!--') && text.includes('-->')) return true
  return /\[[^\]\n]*@[^\]\n]*\]/.test(text)
}

/**
 * 工具栏"插入脚注"命令：
 * - 在当前选区位置插入 [^id] 引用节点；
 * - 仅当当前文档中尚无该 id 的定义且非复用模式时，在文末追加渲染态定义块，绝不覆盖旧定义。
 */
function $insertFootnote(
  rawId: string,
  rawContent: string,
  mode: FootnoteInsertMode = 'create'
): void {
  const id = rawId.trim()
  const content = rawContent.trim()
  if (!isValidFootnoteId(id)) return

  const selection = $getSelection()
  if (!$isRangeSelection(selection)) return

  const snapshot = collectFootnoteStateFromLexical()
  const hasExistingDef = snapshot.defIds.has(id)

  const refNode = $createWorkbenchFootnoteRefNode(id)
  selection.insertNodes([refNode])
  refNode.selectNext()

  if (!hasExistingDef && mode !== 'reuse-ref') {
    const definition = $createWorkbenchFootnoteDefNode(id)
    if (content.length > 0) {
      definition.append($createTextNode(content))
    }
    $getRoot().append(definition)
  }
}

export default function WorkbenchFootnotePlugin(): JSX.Element | null {
  const [editor] = useLexicalComposerContext()
  const [tip, setTip] = useState<FootnoteTip | null>(null)
  const activeRefEl = useRef<HTMLElement | null>(null)
  const backCycleIndexRef = useRef<Map<string, number>>(new Map())

  useEffect(() => {
    const syncStatuses = (): void => {
      const root = editor.getRootElement()
      if (!root) return
      const snapshot = editor.getEditorState().read(() => collectFootnoteStateFromLexical())

      root
        .querySelectorAll<HTMLElement>('.PlaygroundEditorTheme__footnoteRef[data-footnote-ref-id]')
        .forEach((el) => {
          const id = el.getAttribute('data-footnote-ref-id') ?? ''
          if (!id || snapshot.defIds.has(id)) {
            if (el.hasAttribute('data-footnote-missing')) {
              el.removeAttribute('data-footnote-missing')
            }
          } else if (el.getAttribute('data-footnote-missing') !== 'true') {
            el.setAttribute('data-footnote-missing', 'true')
          }
        })

      root
        .querySelectorAll<HTMLElement>('.PlaygroundEditorTheme__footnoteDef[data-footnote-def-id]')
        .forEach((el) => {
          const id = el.getAttribute('data-footnote-def-id') ?? ''
          if (!id || snapshot.refIds.has(id)) {
            if (el.hasAttribute('data-footnote-unreferenced')) {
              el.removeAttribute('data-footnote-unreferenced')
            }
          } else if (el.getAttribute('data-footnote-unreferenced') !== 'true') {
            el.setAttribute('data-footnote-unreferenced', 'true')
          }
        })
    }

    const hideTip = (): void => {
      activeRefEl.current = null
      setTip((prev) => (prev === null ? prev : null))
    }

    const footnoteRefKeys = new Set<NodeKey>()
    const footnoteDefKeys = new Set<NodeKey>()
    let syncRafId = 0

    editor.getEditorState().read(() => {
      const walk = (node: LexicalNode): void => {
        if ($isWorkbenchFootnoteRefNode(node)) {
          footnoteRefKeys.add(node.getKey())
          return
        }
        if ($isWorkbenchFootnoteDefNode(node)) {
          footnoteDefKeys.add(node.getKey())
        }
        if ($isElementNode(node)) {
          for (const child of node.getChildren()) walk(child)
        }
      }
      walk($getRoot())
    })

    const scheduleSyncStatuses = (): void => {
      if (footnoteRefKeys.size === 0 && footnoteDefKeys.size === 0) return
      if (syncRafId) return
      syncRafId = requestAnimationFrame(() => {
        syncRafId = 0
        syncStatuses()
      })
    }

    let detachDom = (): void => {}

    const attachDom = (root: HTMLElement | null): void => {
      detachDom()
      detachDom = () => {}
      if (!root) return

      const handlePointerOver = (event: PointerEvent): void => {
        const target = event.target
        if (!(target instanceof Element)) return
        const refWrap = target.closest('.PlaygroundEditorTheme__footnoteRef[data-footnote-ref-id]')
        if (!(refWrap instanceof HTMLElement) || !root.contains(refWrap)) {
          hideTip()
          return
        }
        if (activeRefEl.current === refWrap) return

        const id = refWrap.getAttribute('data-footnote-ref-id') ?? ''
        if (!id) {
          hideTip()
          return
        }

        const snapshot = editor.getEditorState().read(() => collectFootnoteStateFromLexical())
        const hasDef = snapshot.defIds.has(id)
        const content = hasDef ? (snapshot.definitions.get(id) ?? '') : ''

        const rect = refWrap.getBoundingClientRect()
        const width = Math.min(MAX_TIP_WIDTH, window.innerWidth - VIEWPORT_MARGIN * 2)
        const left = Math.min(
          Math.max(rect.left + rect.width / 2, width / 2 + VIEWPORT_MARGIN),
          window.innerWidth - width / 2 - VIEWPORT_MARGIN
        )
        const placement = rect.top > 72 ? 'above' : 'below'

        activeRefEl.current = refWrap
        setTip({
          id,
          content,
          missing: !hasDef,
          left,
          top: placement === 'above' ? rect.top - 8 : rect.bottom + 8,
          width,
          placement
        })
      }

      const handlePointerOut = (event: PointerEvent): void => {
        const current = activeRefEl.current
        const related = event.relatedTarget
        if (current && related instanceof Node && current.contains(related)) return
        hideTip()
      }

      const handleClick = (event: MouseEvent): void => {
        const target = event.target
        if (!(target instanceof Element)) return

        const selection = editor.getEditorState().read(() => $getSelection())
        if ($isRangeSelection(selection) && !selection.isCollapsed()) return

        const refWrap = target.closest('.PlaygroundEditorTheme__footnoteRef[data-footnote-ref-id]')
        if (refWrap instanceof HTMLElement && root.contains(refWrap)) {
          const id = refWrap.getAttribute('data-footnote-ref-id') ?? ''
          if (!id) return
          const defEl = findDefElementById(root, id)
          if (!defEl) return
          event.preventDefault()
          hideTip()
          defEl.scrollIntoView({ behavior: 'smooth', block: 'center' })
          flashElement(defEl)
          return
        }

        const defEl = target.closest('.PlaygroundEditorTheme__footnoteDef[data-footnote-def-id]')
        if (defEl instanceof HTMLElement && root.contains(defEl) && isClickOnDefBadge(defEl, event)) {
          const id = defEl.getAttribute('data-footnote-def-id') ?? ''
          if (!id) return
          const refs = findRefElementsById(root, id)
          if (refs.length === 0) return
          event.preventDefault()
          const nextIdx = ((backCycleIndexRef.current.get(id) ?? -1) + 1) % refs.length
          backCycleIndexRef.current.set(id, nextIdx)
          const targetRef = refs[nextIdx]
          targetRef.scrollIntoView({ behavior: 'smooth', block: 'center' })
          flashElement(targetRef)
        }
      }

      root.addEventListener('pointerover', handlePointerOver)
      root.addEventListener('pointerout', handlePointerOut)
      root.addEventListener('click', handleClick)
      window.addEventListener('scroll', hideTip, { capture: true, passive: true })
      window.addEventListener('blur', hideTip)

      if (footnoteRefKeys.size > 0 || footnoteDefKeys.size > 0) {
        syncStatuses()
      }

      detachDom = () => {
        root.removeEventListener('pointerover', handlePointerOver)
        root.removeEventListener('pointerout', handlePointerOut)
        root.removeEventListener('click', handleClick)
        window.removeEventListener('scroll', hideTip, { capture: true })
        window.removeEventListener('blur', hideTip)
      }
    }

    attachDom(editor.getRootElement())

    const unregister = mergeRegister(
      editor.registerCommand(
        INSERT_FOOTNOTE_COMMAND,
        (payload) => {
          editor.update(() => {
            $insertFootnote(payload.id, payload.content, payload.mode)
          })
          return true
        },
        COMMAND_PRIORITY_EDITOR
      ),
      editor.registerCommand(
        PASTE_COMMAND,
        (event: PasteCommandType) => {
          if (!(event instanceof ClipboardEvent) || !event.clipboardData) return false
          if (event.clipboardData.files.length > 0) return false
          // Lexical 内部复制粘贴自带节点载荷，交还给默认处理器完整还原
          if (event.clipboardData.types.includes('application/x-lexical-editor')) return false

          const text = event.clipboardData.getData('text/plain')
          if (!hasFootnoteSyntax(text) && !hasInlineMarkupSyntax(text)) return false
          // 含块级 $$ 公式时交由 WorkbenchEquationPastePlugin 一并处理（其同样使用 WORKBENCH_TRANSFORMERS）
          if (text.includes('$$') && splitEquationPaste(text)) return false

          const selection = $getSelection()
          if (!$isRangeSelection(selection)) return false

          const anchorNode = selection.anchor.getNode()
          if (
            $isCodeNode(anchorNode) ||
            $isCodeNode(anchorNode.getParent()) ||
            ($isTextNode(anchorNode) && anchorNode.hasFormat('code'))
          ) {
            return false
          }

          const nodes = $generateNodesFromMarkdownString(text, WORKBENCH_TRANSFORMERS)
          if (
            nodes.length === 0 ||
            (!containsFootnoteNode(nodes) && !containsInlineMarkupNode(nodes))
          ) {
            return false
          }

          // 单行纯行内粘贴（例如只粘贴 `[^2]` 或含引用的短句）：拆出子节点行内插入，不打断当前段落
          if (!text.includes('\n') && nodes.length === 1 && $isParagraphNode(nodes[0])) {
            const inlineNodes = nodes[0].getChildren()
            if (inlineNodes.length === 0) return false
            selection.insertNodes(inlineNodes)
          } else {
            selection.insertNodes(nodes)
          }
          event.preventDefault()
          return true
        },
        COMMAND_PRIORITY_HIGH
      ),
      editor.registerMutationListener(WorkbenchFootnoteRefNode, (mutations) => {
        for (const [key, kind] of mutations) {
          if (kind === 'destroyed') footnoteRefKeys.delete(key)
          else footnoteRefKeys.add(key)
        }
        scheduleSyncStatuses()
      }),
      editor.registerMutationListener(WorkbenchFootnoteDefNode, (mutations) => {
        for (const [key, kind] of mutations) {
          if (kind === 'destroyed') footnoteDefKeys.delete(key)
          else footnoteDefKeys.add(key)
        }
        scheduleSyncStatuses()
      }),
      editor.registerRootListener((nextRoot) => {
        hideTip()
        attachDom(nextRoot)
      }),
      editor.registerUpdateListener(({ dirtyElements, dirtyLeaves, tags }) => {
        if (tags.has('annotation-sync')) return
        if (dirtyElements.size === 0 && dirtyLeaves.size === 0) return
        hideTip()
        scheduleSyncStatuses()
      })
    )

    return () => {
      if (syncRafId) {
        cancelAnimationFrame(syncRafId)
        syncRafId = 0
      }
      detachDom()
      unregister()
    }
  }, [editor])

  if (!tip) return null

  return createPortal(
    <div
      role="tooltip"
      /* z-[110] 压在普通浮层之上用于正文悬浮预览；采用实色白底避免正文文字透底干扰阅读 */
      className="pointer-events-none fixed z-[110] rounded-lg border border-black/10 bg-white px-2.5 py-1.5 text-caption text-text-primary shadow-lg dark:border-white/10 dark:bg-gray-800"
      style={{
        left: tip.left,
        top: tip.top,
        maxWidth: tip.width,
        transform: tip.placement === 'above' ? 'translate(-50%, -100%)' : 'translate(-50%, 0)'
      }}
    >
      <div className="flex items-start gap-2">
        <span
          className={`shrink-0 rounded px-1.5 py-0.5 text-tiny font-semibold leading-none ${
            tip.missing
              ? 'bg-amber-500/15 text-amber-700 dark:text-amber-300'
              : 'bg-primary/15 text-primary'
          }`}
        >
          {tip.id}
        </span>
        <div className="min-w-0 flex-1 break-words leading-relaxed">
          {tip.missing ? (
            <span className="text-amber-700 dark:text-amber-300">
              未找到 [^{tip.id}] 的脚注定义
            </span>
          ) : tip.content ? (
            <span>{tip.content}</span>
          ) : (
            <span className="text-text-secondary">（空脚注内容，点击可跳转编辑）</span>
          )}
        </div>
      </div>
    </div>,
    document.body
  )
}
