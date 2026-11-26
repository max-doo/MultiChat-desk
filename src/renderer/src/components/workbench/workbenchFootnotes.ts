import { $getRoot, $isElementNode, $isParagraphNode, $isTextNode, type LexicalNode } from 'lexical'
import { $isCodeNode } from '@lexical/code'
import { $isPendingInsertNode } from './PendingInsertNode'
import {
  $isWorkbenchFootnoteDefNode,
  $isWorkbenchFootnoteRefNode
} from './WorkbenchFootnoteNode'

/** GFM 脚注合法编号：非空，且不含空白字符、右方括号与冒号 */
export const FOOTNOTE_ID_VALID_RE = /^[^\]\s:]+$/

/** 脚注定义行完整匹配：允许最多 3 个前导空格 */
export const FOOTNOTE_DEF_LINE_RE = /^[ \t]{0,3}\[\^([^\]\s:]+)\]:[ \t]*(.*)$/

/** 脚注定义行前缀匹配：用于 Lexical ElementTransformer 剥离 `[^id]: ` */
export const FOOTNOTE_DEF_PREFIX_RE = /^[ \t]{0,3}\[\^([^\]\s:]+)\]:[ \t]*/

/** 行内脚注引用匹配（排除紧跟冒号的定义标记） */
export const FOOTNOTE_REF_MATCH_RE = /\[\^([^\]\s:]+)\](?!:)/
export const FOOTNOTE_REF_TOKEN_RE = /\[\^([^\]\s:]+)\](?!:)/g

const FRONTMATTER_STRIP_RE = /^---[ \t]*\r?\n[\s\S]*?\r?\n---[ \t]*(?:\r?\n|$)/
const FENCE_RE = /^\s{0,3}(`{3,}|~{3,})/

export interface FootnoteUsageSnapshot {
  refIds: Set<string>
  defIds: Set<string>
  usedIds: Set<string>
  /** 已有定义的正文摘要（按 GFM First Definition Wins 保留首条定义） */
  definitions: Map<string, string>
  nextId: string
}

export function isValidFootnoteId(id: string): boolean {
  return FOOTNOTE_ID_VALID_RE.test(id)
}

export function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * 计算下一个可用递增数字编号：
 * 取现有纯数字编号最大值 + 1，并跳过任何已占用编号，保证不撞号也不倒挂。
 */
export function computeNextFootnoteId(usedIds: Iterable<string>): string {
  const usedSet = usedIds instanceof Set ? usedIds : new Set(usedIds)
  let maxNumeric = 0
  for (const id of usedSet) {
    if (!/^\d+$/.test(id)) continue
    const parsed = Number.parseInt(id, 10)
    if (Number.isSafeInteger(parsed) && parsed > maxNumeric) {
      maxNumeric = parsed
    }
  }
  let candidate = maxNumeric + 1
  while (usedSet.has(String(candidate))) {
    candidate++
  }
  return String(candidate)
}

/** 移除单行内的反引号行内代码片段，避免把示例代码里的 `[^1]` 误算作脚注 */
function stripInlineCodeSpans(line: string): string {
  return line.replace(/(`+)([^`\n]*?)\1/g, (match) => ' '.repeat(match.length))
}

function scanRefTokens(text: string, refIds: Set<string>, usedIds: Set<string>): void {
  const cleaned = stripInlineCodeSpans(text)
  FOOTNOTE_REF_TOKEN_RE.lastIndex = 0
  let match: RegExpExecArray | null
  while ((match = FOOTNOTE_REF_TOKEN_RE.exec(cleaned)) !== null) {
    const id = match[1]
    if (!id) continue
    refIds.add(id)
    usedIds.add(id)
  }
}

/**
 * 从 Markdown 源码采集脚注占用状态与现有定义摘要（跳过 Frontmatter 与围栏代码块）。
 */
export function collectFootnoteStateFromMarkdown(markdown: string): FootnoteUsageSnapshot {
  const refIds = new Set<string>()
  const defIds = new Set<string>()
  const usedIds = new Set<string>()
  const definitions = new Map<string, string>()

  const withoutBom = markdown.startsWith('\uFEFF') ? markdown.slice(1) : markdown
  const body = withoutBom.replace(FRONTMATTER_STRIP_RE, '')
  const lines = body.split(/\r?\n/)

  let fence: { char: string; length: number } | null = null
  for (const line of lines) {
    const fenceMatch = line.match(FENCE_RE)
    if (fenceMatch) {
      const marker = fenceMatch[1]
      if (!fence) {
        fence = { char: marker[0], length: marker.length }
      } else if (marker[0] === fence.char && marker.length >= fence.length) {
        fence = null
      }
      continue
    }
    if (fence) continue

    const defMatch = line.match(FOOTNOTE_DEF_LINE_RE)
    if (defMatch) {
      const id = defMatch[1]
      const content = defMatch[2].trim()
      defIds.add(id)
      usedIds.add(id)
      if (!definitions.has(id)) {
        definitions.set(id, content)
      }
      scanRefTokens(defMatch[2], refIds, usedIds)
      continue
    }

    scanRefTokens(line, refIds, usedIds)
  }

  return {
    refIds,
    defIds,
    usedIds,
    definitions,
    nextId: computeNextFootnoteId(usedIds)
  }
}

/**
 * 从当前 Lexical EditorState 直接采集脚注占用状态（须在 read / update 回调内调用），
 * 避免受 MarkdownSyncPlugin 250ms 防抖延迟影响。
 */
export function collectFootnoteStateFromLexical(): FootnoteUsageSnapshot {
  const refIds = new Set<string>()
  const defIds = new Set<string>()
  const usedIds = new Set<string>()
  const definitions = new Map<string, string>()

  const walk = (node: LexicalNode): void => {
    if ($isCodeNode(node) || $isPendingInsertNode(node)) return

    if ($isWorkbenchFootnoteRefNode(node)) {
      const id = node.getFootnoteId()
      if (id) {
        refIds.add(id)
        usedIds.add(id)
      }
      return
    }

    if ($isWorkbenchFootnoteDefNode(node)) {
      const id = node.getFootnoteId()
      if (id) {
        defIds.add(id)
        usedIds.add(id)
        if (!definitions.has(id)) {
          definitions.set(id, node.getTextContent().trim())
        }
      }
      for (const child of node.getChildren()) {
        walk(child)
      }
      return
    }

    if ($isParagraphNode(node)) {
      // 兼容尚未转换为 FootnoteDefNode 的普通段落定义行
      const lines = node.getTextContent().split(/\r?\n/)
      for (const line of lines) {
        const defMatch = line.match(FOOTNOTE_DEF_LINE_RE)
        if (defMatch) {
          const id = defMatch[1]
          defIds.add(id)
          usedIds.add(id)
          if (!definitions.has(id)) {
            definitions.set(id, defMatch[2].trim())
          }
        }
      }
    }

    if ($isTextNode(node)) {
      if (!node.hasFormat('code')) {
        scanRefTokens(node.getTextContent(), refIds, usedIds)
      }
      return
    }

    if ($isElementNode(node)) {
      for (const child of node.getChildren()) {
        walk(child)
      }
    }
  }

  walk($getRoot())

  return {
    refIds,
    defIds,
    usedIds,
    definitions,
    nextId: computeNextFootnoteId(usedIds)
  }
}
