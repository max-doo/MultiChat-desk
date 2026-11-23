import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext'
import { useLexicalEditable } from '@lexical/react/useLexicalEditable'
import { mergeRegister } from '@lexical/utils'
import {
  $getSelection,
  $isRangeSelection,
  $isTextNode,
  $isParagraphNode,
  $isElementNode,
  COMMAND_PRIORITY_LOW,
  FORMAT_TEXT_COMMAND,
  getDOMSelection,
  getDOMSelectionPoints,
  SELECTION_CHANGE_COMMAND,
  type LexicalEditor
} from 'lexical'
import { $isLinkNode } from '@lexical/link'
import { $isCodeNode } from '@lexical/code'
import { $isAtNodeEnd } from '@lexical/selection'
import type { RangeSelection, TextNode, ElementNode } from 'lexical'
import WorkbenchLinkEditor from './WorkbenchLinkEditor'
import {
  WORKBENCH_FLOATING_TOOLBAR_BASE_CLASS,
  WorkbenchFloatingToolbarButton
} from './WorkbenchFloatingToolbarChrome'
import { WORKBENCH_ANNOTATE_COMMAND } from './WorkbenchAnnotationPlugin'

/**
 * 参考 lexical-playground FloatingTextFormatToolbarPlugin 实现的浮动文本格式工具栏：
 * - 仅在存在非折叠的文本选区（非代码块内）时出现，位于选区上方
 * - 按钮 active 态实时跟随选区格式；链接按钮在光标进入链接时提供移除能力
 * - 通过 createPortal 挂到 anchorElem（编辑器画布容器），按选区 DOMRect 做绝对定位
 */

function getSelectedNode(selection: RangeSelection): TextNode | ElementNode {
  const anchor = selection.anchor
  const focus = selection.focus
  const anchorNode = selection.anchor.getNode()
  const focusNode = selection.focus.getNode()
  if (anchorNode === focusNode) {
    return anchorNode
  }
  const isBackward = selection.isBackward()
  if (isBackward) {
    return $isAtNodeEnd(focus) ? anchorNode : focusNode
  }
  return $isAtNodeEnd(anchor) ? anchorNode : focusNode
}

function getDOMRangeRect(nativeSelection: Selection, rootElement: HTMLElement): DOMRect {
  const range =
    nativeSelection.rangeCount > 0 ? nativeSelection.getRangeAt(0) : null
  if (range === null) {
    return rootElement.getBoundingClientRect()
  }
  return range.getBoundingClientRect()
}

interface ToolbarState {
  isText: boolean
  isLink: boolean
  linkUrl: string | null
  isBold: boolean
  isItalic: boolean
  isUnderline: boolean
  isStrikethrough: boolean
  isCode: boolean
  isHighlight: boolean
}

const VERTICAL_GAP = 10
const HORIZONTAL_OFFSET = 5

function FloatingToolbar({
  editor,
  anchorElem,
  state,
  onOpenLinkEditor
}: {
  editor: LexicalEditor
  anchorElem: HTMLElement
  state: ToolbarState
  onOpenLinkEditor: (anchor: HTMLElement, initialUrl: string | null) => void
}): JSX.Element {
  const popupRef = useRef<HTMLDivElement | null>(null)
  const linkButtonRef = useRef<HTMLButtonElement | null>(null)
  const isEditable = useLexicalEditable()

  const updatePosition = useCallback(() => {
    const popup = popupRef.current
    const nativeSelection = getDOMSelection(editor._window)
    const rootElement = editor.getRootElement()
    if (popup === null || rootElement === null || nativeSelection === null) {
      return
    }

    const points = getDOMSelectionPoints(nativeSelection, rootElement)
    const collapsed =
      points.anchorNode === points.focusNode && points.anchorOffset === points.focusOffset
    if (
      collapsed ||
      !rootElement.contains(points.anchorNode) ||
      popup === null
    ) {
      popup.style.opacity = '0'
      return
    }

    const targetRect = getDOMRangeRect(nativeSelection, rootElement)
    const popupRect = popup.getBoundingClientRect()
    const anchorRect = anchorElem.getBoundingClientRect()
    const scrollerRect = (anchorElem.parentElement ?? anchorElem).getBoundingClientRect()

    let top = targetRect.top - popupRect.height - VERTICAL_GAP
    let left = targetRect.left - HORIZONTAL_OFFSET

    // 选区贴近顶部时翻到选区下方
    if (top < scrollerRect.top) {
      top += popupRect.height + targetRect.height + VERTICAL_GAP * 2
    }
    if (left + popupRect.width > scrollerRect.right) {
      left = scrollerRect.right - popupRect.width - HORIZONTAL_OFFSET
    }
    if (left < scrollerRect.left) {
      left = scrollerRect.left + HORIZONTAL_OFFSET
    }

    popup.style.opacity = '1'
    popup.style.transform = `translate(${Math.round(left - anchorRect.left)}px, ${Math.round(
      top - anchorRect.top
    )}px)`
  }, [editor, anchorElem])

  useLayoutEffect(() => {
    editor.read('latest', updatePosition)
    return mergeRegister(
      editor.registerUpdateListener(({ editorState }) => {
        editorState.read(updatePosition)
      }),
      editor.registerCommand(
        SELECTION_CHANGE_COMMAND,
        () => {
          editor.read('latest', updatePosition)
          return false
        },
        COMMAND_PRIORITY_LOW
      )
    )
  }, [editor, updatePosition])

  const openLinkEditor = (): void => {
    if (linkButtonRef.current) {
      onOpenLinkEditor(linkButtonRef.current, state.linkUrl)
    }
  }

  return (
    <div
      ref={popupRef}
      role="toolbar"
      aria-label="浮动格式工具栏"
      className={`${WORKBENCH_FLOATING_TOOLBAR_BASE_CLASS} absolute left-0 top-0 z-40 opacity-0 will-change-transform`}
      style={{ transform: 'translate(-10000px, -10000px)' }}
    >
      {isEditable && (
        <>
          <WorkbenchFloatingToolbarButton
            icon="format_bold"
            label="粗体"
            active={state.isBold}
            onClick={() => editor.dispatchCommand(FORMAT_TEXT_COMMAND, 'bold')}
          />
          <WorkbenchFloatingToolbarButton
            icon="format_italic"
            label="斜体"
            active={state.isItalic}
            onClick={() => editor.dispatchCommand(FORMAT_TEXT_COMMAND, 'italic')}
          />
          <WorkbenchFloatingToolbarButton
            icon="format_underlined"
            label="下划线"
            active={state.isUnderline}
            onClick={() => editor.dispatchCommand(FORMAT_TEXT_COMMAND, 'underline')}
          />
          <WorkbenchFloatingToolbarButton
            icon="format_strikethrough"
            label="删除线"
            active={state.isStrikethrough}
            onClick={() => editor.dispatchCommand(FORMAT_TEXT_COMMAND, 'strikethrough')}
          />
          <WorkbenchFloatingToolbarButton
            icon="code"
            label="行内代码"
            active={state.isCode}
            onClick={() => editor.dispatchCommand(FORMAT_TEXT_COMMAND, 'code')}
          />
          <WorkbenchFloatingToolbarButton
            icon="ink_highlighter"
            label="高亮"
            active={state.isHighlight}
            onClick={() => editor.dispatchCommand(FORMAT_TEXT_COMMAND, 'highlight')}
          />
          <WorkbenchFloatingToolbarButton
            icon="annotation"
            label="标注"
            onClick={() => editor.dispatchCommand(WORKBENCH_ANNOTATE_COMMAND, undefined)}
          />
          <WorkbenchFloatingToolbarButton
            buttonRef={linkButtonRef}
            icon="link"
            label={state.isLink ? '编辑链接' : '插入链接'}
            active={state.isLink}
            onClick={openLinkEditor}
          />
        </>
      )}
    </div>
  )
}

export default function WorkbenchFloatingToolbarPlugin({
  anchorElem
}: {
  anchorElem: HTMLElement | null
}): JSX.Element | null {
  const [editor] = useLexicalComposerContext()
  const [state, setState] = useState<ToolbarState>({
    isText: false,
    isLink: false,
    linkUrl: null,
    isBold: false,
    isItalic: false,
    isUnderline: false,
    isStrikethrough: false,
    isCode: false,
    isHighlight: false
  })
  const [linkEditor, setLinkEditor] = useState<{
    anchorRect: DOMRect
    initialUrl: string | null
  } | null>(null)

  const updatePopup = useCallback(() => {
    editor.read('latest', () => {
      if (editor.isComposing()) {
        return
      }
      const selection = $getSelection()
      const nativeSelection = getDOMSelection(editor._window)
      const rootElement = editor.getRootElement()

      if (
        nativeSelection !== null &&
        (!$isRangeSelection(selection) ||
          rootElement === null ||
          !rootElement.contains(
            getDOMSelectionPoints(nativeSelection, rootElement).anchorNode
          ))
      ) {
        setState((prev) => ({ ...prev, isText: false }))
        return
      }

      if (!$isRangeSelection(selection)) {
        return
      }

      const node = getSelectedNode(selection)
      const parent = node.getParent()
      const linkNode = $isLinkNode(parent) ? parent : $isLinkNode(node) ? node : null
      const isLink = linkNode !== null
      const isCodeBlock = $isCodeNode(selection.anchor.getNode().getParent())

      let isText =
        !isCodeBlock &&
        selection.getTextContent() !== '' &&
        ($isTextNode(node) || $isParagraphNode(node) || $isElementNode(node))

      const rawTextContent = selection.getTextContent().replace(/\n/g, '')
      if (!selection.isCollapsed() && rawTextContent === '') {
        isText = false
      }

      setState({
        isText,
        isLink,
        linkUrl: linkNode?.getURL() ?? null,
        isBold: selection.hasFormat('bold'),
        isItalic: selection.hasFormat('italic'),
        isUnderline: selection.hasFormat('underline'),
        isStrikethrough: selection.hasFormat('strikethrough'),
        isCode: selection.hasFormat('code'),
        isHighlight: selection.hasFormat('highlight')
      })
    })
  }, [editor])

  useEffect(() => {
    return mergeRegister(
      editor.registerUpdateListener(() => {
        updatePopup()
      }),
      editor.registerRootListener(() => {
        if (editor.getRootElement() === null) {
          setState((prev) => ({ ...prev, isText: false }))
        }
      })
    )
  }, [editor, updatePopup])

  const openLinkEditor = useCallback((anchor: HTMLElement, initialUrl: string | null) => {
    setLinkEditor({ anchorRect: anchor.getBoundingClientRect(), initialUrl })
  }, [])

  if (anchorElem === null) return null

  return (
    <>
      {state.isText &&
        createPortal(
          <FloatingToolbar
            editor={editor}
            anchorElem={anchorElem}
            state={state}
            onOpenLinkEditor={openLinkEditor}
          />,
          anchorElem
        )}
      {linkEditor && (
        <WorkbenchLinkEditor
          editor={editor}
          anchorRect={linkEditor.anchorRect}
          initialUrl={linkEditor.initialUrl}
          onClose={() => setLinkEditor(null)}
        />
      )}
    </>
  )
}
