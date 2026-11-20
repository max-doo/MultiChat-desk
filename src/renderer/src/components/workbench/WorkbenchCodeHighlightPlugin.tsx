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
  CodeNode,
} from '@lexical/code'
import { registerCodeGutter } from '@lexical/code-core'
import {
  $createLineBreakNode,
  $getNodeByKey,
  $isLineBreakNode,
  $getSelection,
  $isRangeSelection,
  $isTabNode,
  $isTextNode,
  type LexicalNode
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

// 对单个 CodeNode 重新跑 Prism 高亮并重建 children
function highlightCodeNode(codeNode: CodeNode): void {
  const language = getPrismLanguage(codeNode)
  const grammar = Prism.languages[language]
  if (!grammar) return

  const text = codeNode.getTextContent()
  const tokens = Prism.tokenize(text, grammar)

  const newChildren: LexicalNode[] = []
  tokenizeToNodes(tokens as TokenContent, null, newChildren)

  // 与现有 children 比较：结构+文本+类型全同则跳过，避免无谓重建触发二次 mutation
  const oldChildren = codeNode.getChildren()
  if (
    oldChildren.length === newChildren.length &&
    oldChildren.every((old, i) => {
      const nw = newChildren[i]
      if ($isLineBreakNode(old) && $isLineBreakNode(nw)) return true
      if ($isCodeHighlightNode(old) && $isCodeHighlightNode(nw)) {
        return (
          old.getTextContent() === nw.getTextContent() &&
          old.getHighlightType() === nw.getHighlightType()
        )
      }
      // TabNode 保留：索引对不上就重建（tab 在 code 块里也是 token 文本）
      if ($isTabNode(old)) return false
      return false
    })
  ) {
    return
  }

  // 重建前若选区落在本 CodeNode 内，记录「块首字符偏移」，
  // 否则 clear+append 会把选区锚点节点删掉，光标被重置到块首（Enter 跳行首的成因）
  let charOffset: number | null = null
  const sel = $getSelection()
  if ($isRangeSelection(sel) && sel.isCollapsed()) {
    const anchorNode = sel.anchor.getNode()
    if (anchorNode.getParents().includes(codeNode)) {
      const children = codeNode.getChildren()
      let acc = 0
      for (const child of children) {
        if (child.getKey() === anchorNode.getKey()) {
          charOffset = acc + sel.anchor.offset
          break
        }
        if ($isLineBreakNode(child)) acc += 1
        else acc += child.getTextContentSize()
      }
    }
  }

  codeNode.clear()
  codeNode.append(...newChildren)

  // 选区恢复：按块首字符偏移找回落点（CodeHighlightNode 内 text offset）
  if (charOffset !== null) {
    let acc = 0
    let restored = false
    for (const child of codeNode.getChildren()) {
      if ($isLineBreakNode(child)) {
        if (charOffset === acc) {
          // 恰好在换行处：选区落在该 LineBreak 之后
          child.selectNext()
          restored = true
          break
        }
        acc += 1
        continue
      }
      const size = child.getTextContentSize()
      if (charOffset <= acc + size) {
        // CodeHighlightNode/TabNode 都是 TextNode：select(anchor, focus)
        if ($isTextNode(child)) {
          child.select(charOffset - acc, charOffset - acc)
          restored = true
        }
        break
      }
      acc += size
    }
    // 兜底：末尾
    if (!restored) {
      codeNode.selectEnd()
    }
  }
}

/**
 * 复刻 playground 的 CodeHighlightPlugin：
 * - registerCodeGutter 写 data-gutter 行号（CSS ::before 渲染）
 * - CodeNode mutation → Prism.tokenize → 重建 CodeHighlightNode/LineBreakNode children
 */
export default function WorkbenchCodeHighlightPlugin(): null {
  const [editor] = useLexicalComposerContext()

  useEffect(() => {
    const unregisterGutter = registerCodeGutter(editor)

    const unregisterMutation = editor.registerMutationListener(
      CodeNode,
      (mutations, { updateTags }) => {
        // 跳过我们自己重建 children 触发的回声
        if (updateTags.has('code-highlight')) return

        editor.update(
          () => {
            for (const [key, type] of mutations) {
              if (type === 'destroyed') continue
              const node = $getNodeByKey(key)
              if (node && $isCodeNode(node)) {
                highlightCodeNode(node)
              }
            }
          },
          { tag: 'code-highlight' }
        )
      },
      { skipInitialization: false }
    )

    return () => {
      unregisterGutter()
      unregisterMutation()
    }
  }, [editor])

  return null
}
