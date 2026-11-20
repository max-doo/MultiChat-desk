import { useEffect } from 'react'
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext'
import Prism from 'prismjs'
import 'prismjs/components/prism-markdown'
import 'prismjs/components/prism-javascript'
import 'prismjs/components/prism-typescript'
import 'prismjs/components/prism-css'
import 'prismjs/components/prism-json'
import 'prismjs/components/prism-python'
import 'prismjs/components/prism-bash'
import 'prismjs/components/prism-yaml'
import 'prismjs/components/prism-java'
import 'prismjs/components/prism-c'
import 'prismjs/components/prism-cpp'
import 'prismjs/components/prism-csharp'
import 'prismjs/components/prism-go'
import 'prismjs/components/prism-rust'
import 'prismjs/components/prism-sql'
import 'prismjs/components/prism-jsx'
import 'prismjs/components/prism-tsx'
import {
  $createCodeHighlightNode,
  $isCodeHighlightNode,
  $isCodeNode,
  CodeHighlightNode,
  CodeNode,
} from '@lexical/code'
import { registerCodeGutter } from '@lexical/code-core'
import {
  $createLineBreakNode,
  $createParagraphNode,
  $getRoot,
  $getNodeByKey,
  $isLineBreakNode,
  $getSelection,
  $isRangeSelection,
  $isTabNode,
  $isTextNode,
  $onUpdate,
  mergeRegister,
  TextNode,
  type LexicalNode,
  type NodeKey
} from 'lexical'

// prismjs 本地 d.ts 里 Token 是 interface，Prism.tokenize 返回 Array<string|Token>
interface PrismToken {
  type: string
  alias?: string | string[]
  content: string | PrismToken | Array<string | PrismToken>
}
type TokenContent = string | PrismToken | Array<string | PrismToken>

const DEFAULT_CODE_LANGUAGE = 'javascript'

// Prism 语言别名归一（对齐 playground 的 LANG_ALIAS 思路）
const LANGUAGE_ALIAS: Record<string, string> = {
  js: 'javascript',
  ts: 'typescript',
  py: 'python',
  sh: 'bash',
  shell: 'bash',
  yml: 'yaml',
  md: 'markdown',
  html: 'markup',
  xml: 'markup',
  svg: 'markup',
  cs: 'csharp',
  objc: 'objectivec',
  kt: 'kotlin'
}

function getPrismLanguage(codeNode: CodeNode): string {
  const raw = (codeNode.getLanguage() || DEFAULT_CODE_LANGUAGE).toLowerCase()
  const normalized = LANGUAGE_ALIAS[raw] || raw
  return normalized in Prism.languages ? normalized : DEFAULT_CODE_LANGUAGE
}

// token.content 递归拍平为字符串片段流，遇到 \n 记为断行
function tokenizeToNodes(
  token: TokenContent,
  inheritedType: string | null,
  out: LexicalNode[]
): void {
  if (typeof token === 'string') {
    // 一段文本里可能跨行：按 \n 拆开，行间插 LineBreakNode
    const parts = token.split('\n')
    parts.forEach((part, i) => {
      if (i > 0) out.push($createLineBreakNode())
      if (part) out.push($createCodeHighlightNode(part, inheritedType))
    })
    return
  }
  if (Array.isArray(token)) {
    token.forEach((t) => tokenizeToNodes(t, inheritedType, out))
    return
  }
  // Prism.Token：type 决定高亮类名
  const type = token.type || inheritedType
  tokenizeToNodes(token.content, type, out)
}

function isSameCodeChild(nodeA: LexicalNode, nodeB: LexicalNode): boolean {
  return (
    ($isCodeHighlightNode(nodeA) &&
      $isCodeHighlightNode(nodeB) &&
      nodeA.getTextContent() === nodeB.getTextContent() &&
      nodeA.getHighlightType() === nodeB.getHighlightType()) ||
    ($isTabNode(nodeA) && $isTabNode(nodeB)) ||
    ($isLineBreakNode(nodeA) && $isLineBreakNode(nodeB))
  )
}

function getDiffRange(
  oldChildren: LexicalNode[],
  newChildren: LexicalNode[]
): { from: number; to: number; nodesForReplacement: LexicalNode[] } {
  let leadingMatch = 0
  while (
    leadingMatch < oldChildren.length &&
    isSameCodeChild(oldChildren[leadingMatch], newChildren[leadingMatch])
  ) {
    leadingMatch++
  }

  const oldLength = oldChildren.length
  const newLength = newChildren.length
  const maxTrailingMatch = Math.min(oldLength, newLength) - leadingMatch
  let trailingMatch = 0
  while (trailingMatch < maxTrailingMatch) {
    trailingMatch++
    if (
      !isSameCodeChild(
        oldChildren[oldLength - trailingMatch],
        newChildren[newLength - trailingMatch]
      )
    ) {
      trailingMatch--
      break
    }
  }

  return {
    from: leadingMatch,
    to: oldLength - trailingMatch,
    nodesForReplacement: newChildren.slice(leadingMatch, newLength - trailingMatch)
  }
}

function $updateAndRetainSelection(
  codeNodeKey: NodeKey,
  update: () => boolean
): void {
  const codeNode = $getNodeByKey(codeNodeKey)
  if (!$isCodeNode(codeNode) || !codeNode.isAttached()) return

  const selection = $getSelection()
  if (!$isRangeSelection(selection) || !selection.isCollapsed()) {
    update()
    return
  }

  const anchor = selection.anchor
  const anchorNode = anchor.getNode()
  if (anchorNode !== codeNode && !codeNode.isParentOf(anchorNode)) {
    update()
    return
  }

  const anchorOffset = anchor.offset
  let textOffset = 0
  if (anchor.type === 'element' && anchorNode === codeNode) {
    const children = codeNode.getChildren()
    for (let index = 0; index < anchorOffset && index < children.length; index++) {
      const child = children[index]
      textOffset += $isLineBreakNode(child) ? 1 : child.getTextContentSize()
    }
  } else if (anchor.type === 'text' && $isTextNode(anchorNode)) {
    textOffset =
      anchorOffset +
      anchorNode.getPreviousSiblings().reduce((offset, node) => {
        return offset + node.getTextContentSize()
      }, 0)
  } else {
    update()
    return
  }

  if (!update()) return

  const children = codeNode.getChildren()
  for (let index = 0; index < children.length; index++) {
    const child = children[index]
    if ($isTextNode(child)) {
      const size = child.getTextContentSize()
      if (size >= textOffset) {
        child.select(textOffset, textOffset)
        return
      }
      textOffset -= size
    } else if ($isLineBreakNode(child)) {
      if (textOffset === 0) {
        codeNode.select(index, index)
        return
      }
      textOffset -= 1
    }
  }
  codeNode.select(children.length, children.length)
}

function $highlightCodeNode(codeNode: CodeNode): boolean {
  const language = getPrismLanguage(codeNode)
  const grammar = Prism.languages[language]
  if (!grammar) return false

  const text = codeNode.getTextContent()
  const tokens = Prism.tokenize(text, grammar)

  const newChildren: LexicalNode[] = []
  tokenizeToNodes(tokens as TokenContent, null, newChildren)

  const { from, to, nodesForReplacement } = getDiffRange(
    codeNode.getChildren(),
    newChildren
  )
  if (from !== to || nodesForReplacement.length > 0) {
    codeNode.splice(from, to - from, nodesForReplacement)
    return true
  }
  return false
}

interface HighlightTransformState {
  didTransform: boolean
  nodesCurrentlyHighlighting: Set<NodeKey>
}

function $transformCodeNode(
  state: HighlightTransformState,
  codeNode: CodeNode
): void {
  const codeNodeKey = codeNode.getKey()
  if (state.nodesCurrentlyHighlighting.has(codeNodeKey)) return

  state.nodesCurrentlyHighlighting.add(codeNodeKey)
  if (!state.didTransform) {
    state.didTransform = true
    $onUpdate(() => {
      state.didTransform = false
      state.nodesCurrentlyHighlighting.clear()
    })
  }

  $updateAndRetainSelection(codeNodeKey, () => {
    const currentNode = $getNodeByKey(codeNodeKey)
    if (!$isCodeNode(currentNode) || !currentNode.isAttached()) return false
    return $highlightCodeNode(currentNode)
  })
}

function $transformTextNode(
  state: HighlightTransformState,
  node: TextNode
): void {
  const parent = node.getParent()
  if ($isCodeNode(parent)) {
    $transformCodeNode(state, parent)
  }
}

/**
 * 复刻 playground 的 CodeHighlightPlugin：
 * - registerCodeGutter 写 data-gutter 行号（CSS ::before 渲染）
 * - 节点变换 → Prism.tokenize → 仅替换有差异的 CodeHighlightNode/LineBreakNode
 */
export default function WorkbenchCodeHighlightPlugin(): null {
  const [editor] = useLexicalComposerContext()

  useEffect(() => {
    const state: HighlightTransformState = {
      didTransform: false,
      nodesCurrentlyHighlighting: new Set()
    }
    const unregisterHighlighting = mergeRegister(
      registerCodeGutter(editor),
      editor.registerNodeTransform(CodeNode, (node) => {
        $transformCodeNode(state, node)
      }),
      editor.registerNodeTransform(TextNode, (node) => {
        $transformTextNode(state, node)
      }),
      editor.registerNodeTransform(CodeHighlightNode, (node) => {
        $transformTextNode(state, node)
      })
    )

    const rootElement = editor.getRootElement()
    const handleMouseDown = (event: MouseEvent): void => {
      if (event.button !== 0 || !rootElement || event.target !== rootElement) return

      const firstBlock = rootElement.firstElementChild
      const lastBlock = rootElement.lastElementChild
      if (!firstBlock || !lastBlock) return

      const isBelowLastCode =
        lastBlock.classList.contains('PlaygroundEditorTheme__code') &&
        event.clientY > lastBlock.getBoundingClientRect().bottom
      const isAboveFirstCode =
        firstBlock.classList.contains('PlaygroundEditorTheme__code') &&
        event.clientY < firstBlock.getBoundingClientRect().top
      if (!isBelowLastCode && !isAboveFirstCode) return

      event.preventDefault()
      event.stopPropagation()
      rootElement.focus({ preventScroll: true })
      editor.update(
        () => {
          const root = $getRoot()
          const block = isBelowLastCode ? root.getLastChild() : root.getFirstChild()
          if (!block || !$isCodeNode(block)) return

          const paragraph = $createParagraphNode()
          if (isBelowLastCode) {
            block.insertAfter(paragraph)
          } else {
            block.insertBefore(paragraph)
          }
          paragraph.selectStart()
        },
        { tag: 'code-exit' }
      )
    }
    rootElement?.addEventListener('mousedown', handleMouseDown, true)

    return () => {
      unregisterHighlighting()
      rootElement?.removeEventListener('mousedown', handleMouseDown, true)
    }
  }, [editor])

  return null
}
