import type {
  EditorState,
  LexicalEditor,
  LexicalNode,
  NodeKey,
  ParsableSerializedNode
} from 'lexical'
import {
  $getNodeByKey,
  $getRoot,
  $isDecoratorNode,
  $isElementNode,
  $isParagraphNode,
  $isTextNode,
  HISTORIC_TAG
} from 'lexical'
import { $isHeadingNode, $isQuoteNode } from '@lexical/rich-text'
import { $isListNode } from '@lexical/list'
import { $isCodeNode } from '@lexical/code'
import { $isTableNode } from '@lexical/table'
import { $isMarkNode } from '@lexical/mark'
import { $convertToMarkdownString, type Transformer } from '@lexical/markdown'
import { $isPendingInsertNode } from './PendingInsertNode'
import { $isWorkbenchHtmlTableNode } from './WorkbenchHtmlTableNode'
import { $isWorkbenchEquationNode } from './WorkbenchEquationNode'
import { $isWorkbenchHorizontalRuleNode } from './WorkbenchHorizontalRuleNode'
import { $isWorkbenchImageNode } from './WorkbenchImageNode'
import { $isWorkbenchFootnoteDefNode } from './WorkbenchFootnoteNode'
import { FOOTNOTE_DEF_LINE_RE, FOOTNOTE_DEF_PREFIX_RE } from './workbenchFootnotes'

export type SourceBlockKind =
  | 'heading'
  | 'paragraph'
  | 'footnote-def'
  | 'list'
  | 'quote'
  | 'code'
  | 'table'
  | 'html-table'
  | 'equation'
  | 'horizontalrule'
  | 'image'
  | 'other'

export interface MarkdownEnvelope {
  bom: string
  frontmatter: string | null
  body: string
  eol: '\r\n' | '\n'
  hadTrailingNewline: boolean
}

export interface SourceBlock {
  id: string
  kind: SourceBlockKind
  raw: string
  gapBefore: string
  textHint: string
  baselineExport?: string
  /** 在 bodyRaw（LF 归一化）中的起始行号，0-indexed */
  startLine?: number
  /** 在 bodyRaw 中的结束行号（含），0-indexed */
  endLine?: number
}

export interface CompositeSourceGroup {
  id: string
  nodeKeys: NodeKey[]
  rawSlice: string
  gapBefore: string
  firstOriginalBlockId: string
  broken: boolean
  /** 载入完成时各节点的单块序列化结果，用于区分“仅标脏”和真实内容变化 */
  baselineExports?: Map<NodeKey, string>
}

export interface WorkbenchSourceState {
  originalFullContent: string
  envelope: MarkdownEnvelope
  leadingGap: string
  trailingGap: string
  blocksById: Map<string, SourceBlock>
  nodeKeyToBlockId: Map<NodeKey, string>
  compositeGroupsById: Map<string, CompositeSourceGroup>
  nodeKeyToGroupId: Map<NodeKey, string>
  originalFirstBlockId: string | null
  originalNodeOrder: NodeKey[]
  dirtyBlockKeys: Set<NodeKey>
  /** 单块导出字符串缓存：仅当块本次变脏时重算，避免已改旧块/新增块每 250ms 重复重建 Shadow EditorState */
  exportedBlockCache: Map<NodeKey, string>
  /** Lexical nodes whose key already got mapped into baseline when loaded */
  hasStructuralChanges: boolean
}

interface RawLine {
  text: string
  eol: string
  raw: string
}

interface PreparedLine {
  text: string
  rawStartLine: number
  rawEndLine: number
  isHtmlTable: boolean
}

const FRONTMATTER_RE = /^---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/
const HTML_TABLE_MARKER_PREFIX = '@@MC_WORKBENCH_HTML_TABLE_V1:'
const HTML_TABLE_MARKER_SUFFIX = '@@'

// 与 @lexical/markdown MarkdownTransformers.ts 保持一致的正则，确保顶层块切分同源对齐
const ORDERED_LIST_REGEX = /^(\s*)(\d{1,})\.\s/
const UNORDERED_LIST_REGEX = /^(\s*)[-*+]\s/
const CHECK_LIST_REGEX = /^(\s*)(?:[-*+]\s)?\s?(\[(\s|x)?\])\s/i
const HEADING_REGEX = /^(#{1,6})\s/
const QUOTE_REGEX = /^>\s/
const CODE_START_REGEX = /^([ \t]*`{3,})([\w-]+)?[ \t]?/
const CODE_SINGLE_LINE_REGEX = /^[ \t]*```[^`]+(?:(?:`{1,2}|`{4,})[^`]+)*```(?:[^`]|$)/
const HR_REGEX = /^(---|\*\*\*|___)\s?$/
// 与 MarkdownSyncPlugin 的 IMAGE_TRANSFORMER 共用：支持行尾硬换行空白、含空格本地路径（如 Pasted image）、<...> 路径、可选标题及 Pandoc {#fig-...} 属性
export const IMAGE_BLOCK_REGEX =
  /^[ \t]{0,3}!\[([^\]]*)\]\([ \t]*(?:<([^>\n]*[^\s>\n][^>\n]*)>|((?:[^\s()]|\([^()\n]*\))(?:[^()\n]|\([^()\n]*\))*?))(?:[ \t]+(?:"([^"\n]*)"|'([^'\n]*)'))?[ \t]*\)(\{[^}\n]+\})?[ \t]*$/
const TABLE_ROW_REGEX = /^(?:\|)(.+)(?:\|)\s?$/
const BLOCK_EQUATION_START_REGEX = /^\$\$/
const BLOCK_EQUATION_END_REGEX = /^\$\$\s*$/

/**
 * 分离 BOM、YAML Frontmatter、正文、主换行符与文件尾换行状态。
 */
export function parseMarkdownWithFrontmatter(rawContent: string): {
  bom: string
  frontmatter: string | null
  markdownBody: string
} {
  const bom = rawContent.startsWith('\uFEFF') ? '\uFEFF' : ''
  const withoutBom = bom ? rawContent.slice(1) : rawContent
  const match = withoutBom.match(FRONTMATTER_RE)
  if (match) {
    return {
      bom,
      frontmatter: match[0],
      markdownBody: withoutBom.slice(match[0].length)
    }
  }
  return { bom, frontmatter: null, markdownBody: withoutBom }
}

function detectDominantEol(text: string): '\r\n' | '\n' {
  let crlf = 0
  let lfOnly = 0
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '\r' && text[i + 1] === '\n') {
      crlf++
      i++
    } else if (text[i] === '\n') {
      lfOnly++
    }
  }
  return crlf > 0 && crlf >= lfOnly ? '\r\n' : '\n'
}

export function extractMarkdownEnvelope(rawContent: string): MarkdownEnvelope {
  const { bom, frontmatter, markdownBody } = parseMarkdownWithFrontmatter(rawContent)
  const eol = detectDominantEol(markdownBody || rawContent)
  const hadTrailingNewline = rawContent.endsWith('\n') || rawContent.endsWith('\r')
  return {
    bom,
    frontmatter,
    body: markdownBody,
    eol,
    hadTrailingNewline
  }
}

export function convertEol(text: string, eol: '\r\n' | '\n'): string {
  if (!text) return text
  const lf = text.replace(/\r\n?/g, '\n')
  return eol === '\r\n' ? lf.replace(/\n/g, '\r\n') : lf
}

export function joinMarkdownEnvelope(
  envelope: Pick<MarkdownEnvelope, 'bom' | 'frontmatter' | 'eol' | 'hadTrailingNewline'>,
  assembledBody: string
): string {
  let result = envelope.bom
  if (envelope.frontmatter !== null) {
    result += envelope.frontmatter
    if (
      assembledBody.length > 0 &&
      !envelope.frontmatter.endsWith('\n') &&
      !envelope.frontmatter.endsWith('\r')
    ) {
      result += envelope.eol
    }
  }
  result += assembledBody
  if (
    envelope.hadTrailingNewline &&
    assembledBody.length > 0 &&
    !result.endsWith('\n') &&
    !result.endsWith('\r')
  ) {
    result += envelope.eol
  }
  return result
}

function encodeHtmlTableMarker(html: string): string {
  const bytes = new TextEncoder().encode(html)
  let hex = ''
  for (const byte of bytes) {
    hex += byte.toString(16).padStart(2, '0')
  }
  return `${HTML_TABLE_MARKER_PREFIX}${hex}${HTML_TABLE_MARKER_SUFFIX}`
}

function splitRawLines(body: string): RawLine[] {
  if (!body) return []
  const lines: RawLine[] = []
  let lineStart = 0
  let i = 0
  while (i < body.length) {
    const ch = body[i]
    if (ch === '\r' || ch === '\n') {
      const text = body.slice(lineStart, i)
      const eol = ch === '\r' && body[i + 1] === '\n' ? '\r\n' : ch
      i += eol.length
      lines.push({ text, eol, raw: text + eol })
      lineStart = i
    } else {
      i++
    }
  }
  if (lineStart < body.length) {
    const text = body.slice(lineStart)
    lines.push({ text, eol: '', raw: text })
  }
  return lines
}

/**
 * 统一坐标系下的 HTML 表格预处理：
 * 在代码围栏外把块级 `<table>...</table>` 折叠成单行标记供 Lexical 导入，
 * 同时保留每行对应的原始 `RawLine` 起止范围。
 */
export function prepareBodyWithLineMap(bodyRaw: string): {
  rawLines: RawLine[]
  preparedLines: PreparedLine[]
  preparedMarkdown: string
} {
  const rawLines = splitRawLines(bodyRaw)
  const preparedLines: PreparedLine[] = []
  let fence: { char: string; length: number } | null = null

  for (let index = 0; index < rawLines.length; index++) {
    const line = rawLines[index].text
    const fenceMatch = line.match(/^\s{0,3}(`{3,}|~{3,})/)
    if (fenceMatch) {
      const marker = fenceMatch[1]
      if (!fence) {
        fence = { char: marker[0], length: marker.length }
      } else if (marker[0] === fence.char && marker.length >= fence.length) {
        fence = null
      }
      preparedLines.push({
        text: line,
        rawStartLine: index,
        rawEndLine: index,
        isHtmlTable: false
      })
      continue
    }

    if (fence || !/^\s{0,3}<table(?:\s|>)/i.test(line)) {
      preparedLines.push({
        text: line,
        rawStartLine: index,
        rawEndLine: index,
        isHtmlTable: false
      })
      continue
    }

    let endLineIndex = -1
    let closingIndex = -1
    for (let cursor = index; cursor < rawLines.length; cursor++) {
      const found = rawLines[cursor].text.toLowerCase().indexOf('</table>')
      if (found >= 0) {
        endLineIndex = cursor
        closingIndex = found + '</table>'.length
        break
      }
    }
    if (endLineIndex < 0) {
      preparedLines.push({
        text: line,
        rawStartLine: index,
        rawEndLine: index,
        isHtmlTable: false
      })
      continue
    }

    const trailing = rawLines[endLineIndex].text.slice(closingIndex)
    if (trailing.trim()) {
      preparedLines.push({
        text: line,
        rawStartLine: index,
        rawEndLine: index,
        isHtmlTable: false
      })
      continue
    }

    const htmlNormalized = rawLines
      .slice(index, endLineIndex + 1)
      .map((item) => item.text)
      .join('\n')
    preparedLines.push({
      text: encodeHtmlTableMarker(htmlNormalized),
      rawStartLine: index,
      rawEndLine: endLineIndex,
      isHtmlTable: true
    })
    index = endLineIndex
  }

  return {
    rawLines,
    preparedLines,
    preparedMarkdown: preparedLines.map((item) => item.text).join('\n')
  }
}

function getListLineType(line: string): 'check' | 'bullet' | 'number' | null {
  if (CHECK_LIST_REGEX.test(line)) return 'check'
  if (UNORDERED_LIST_REGEX.test(line)) return 'bullet'
  if (ORDERED_LIST_REGEX.test(line)) return 'number'
  return null
}

function getListLeadingSpaces(line: string): number {
  const m = line.match(/^(\s*)/)
  if (!m) return 0
  let count = 0
  for (const ch of m[1]) {
    count += ch === '\t' ? 4 : 1
  }
  return count
}

function isSpecialBlockLine(line: string): boolean {
  return (
    line.trim() === '' ||
    HEADING_REGEX.test(line) ||
    QUOTE_REGEX.test(line) ||
    HR_REGEX.test(line) ||
    IMAGE_BLOCK_REGEX.test(line) ||
    TABLE_ROW_REGEX.test(line) ||
    CODE_START_REGEX.test(line) ||
    CODE_SINGLE_LINE_REGEX.test(line) ||
    BLOCK_EQUATION_START_REGEX.test(line) ||
    FOOTNOTE_DEF_LINE_RE.test(line) ||
    getListLineType(line) !== null
  )
}

function sliceRawLinesRange(rawLines: RawLine[], startLine: number, endLine: number): string {
  if (startLine > endLine || startLine < 0 || endLine >= rawLines.length) return ''
  let out = ''
  for (let i = startLine; i <= endLine; i++) {
    out += i < endLine ? rawLines[i].raw : rawLines[i].text
  }
  return out
}

function sliceGapAfter(rawLines: RawLine[], prevEndLine: number, nextStartLine: number): string {
  if (prevEndLine < 0) {
    let out = ''
    for (let i = 0; i < nextStartLine; i++) {
      out += rawLines[i].raw
    }
    return out
  }
  let out = rawLines[prevEndLine]?.eol ?? ''
  for (let i = prevEndLine + 1; i < nextStartLine; i++) {
    out += rawLines[i].raw
  }
  return out
}

function buildTextHint(kind: SourceBlockKind, raw: string): string {
  let text = raw
  if (kind === 'heading') {
    text = text.replace(/^#{1,6}\s+/, '')
  } else if (kind === 'quote') {
    text = text.replace(/^>\s?/gm, '')
  } else if (kind === 'code') {
    const lines = text.split(/\r?\n/)
    if (lines.length >= 2) {
      text = lines.slice(1, lines[lines.length - 1].trim().startsWith('`') ? -1 : undefined).join(' ')
    }
  } else if (kind === 'equation') {
    text = text.replace(/^\$\$|\$\$\s*$/g, '')
  } else if (kind === 'footnote-def') {
    text = text.replace(FOOTNOTE_DEF_PREFIX_RE, '')
  }
  return text.replace(/\s+/g, ' ').trim().slice(0, 80)
}

/**
 * 扫描正文为与 @lexical/markdown 顶层块切分对齐的 SourceBlock[]。
 */
export function scanMarkdownSourceBlocks(bodyRaw: string): {
  preparedMarkdown: string
  leadingGap: string
  trailingGap: string
  blocks: SourceBlock[]
} {
  const { rawLines, preparedLines, preparedMarkdown } = prepareBodyWithLineMap(bodyRaw)
  if (preparedLines.length === 0) {
    return { preparedMarkdown, leadingGap: '', trailingGap: '', blocks: [] }
  }

  interface PendingSpan {
    kind: SourceBlockKind
    pStart: number
    pEnd: number
    listType?: 'check' | 'bullet' | 'number'
  }

  const spans: PendingSpan[] = []
  const len = preparedLines.length

  for (let i = 0; i < len; i++) {
    const pl = preparedLines[i]
    const line = pl.text

    if (pl.isHtmlTable) {
      spans.push({ kind: 'html-table', pStart: i, pEnd: i })
      continue
    }

    if (line.trim() === '') {
      continue
    }

    if (BLOCK_EQUATION_START_REGEX.test(line)) {
      let endIdx = i
      let closed = false
      if (i < len && line.trim() !== '$$' && BLOCK_EQUATION_END_REGEX.test(line.slice(2))) {
        closed = true
      } else {
        for (let j = i + 1; j < len; j++) {
          if (BLOCK_EQUATION_END_REGEX.test(preparedLines[j].text)) {
            endIdx = j
            closed = true
            break
          }
        }
      }
      if (closed) {
        spans.push({ kind: 'equation', pStart: i, pEnd: endIdx })
        i = endIdx
        continue
      }
    }

    const singleCode = CODE_SINGLE_LINE_REGEX.test(line)
    if (singleCode) {
      spans.push({ kind: 'code', pStart: i, pEnd: i })
      continue
    }
    const codeOpen = line.match(CODE_START_REGEX)
    if (codeOpen) {
      const fenceLen = codeOpen[1].trim().length
      const afterFence = line.slice(codeOpen[1].length)
      const singleEnd = new RegExp(`\`{${fenceLen},}$`)
      if (singleEnd.test(afterFence)) {
        spans.push({ kind: 'code', pStart: i, pEnd: i })
        continue
      }
      // CommonMark 允许闭合围栏后有尾随空格/制表符；若不接受，扫描器会把后续
      // 整篇正文都吞进代码块，而 Lexical 仍按正常块解析，再次产生 1:N 错位。
      const multiEnd = new RegExp(`^[ \\t]*\`{${fenceLen},}[ \\t]*$`)
      let endIdx = len - 1
      for (let j = i + 1; j < len; j++) {
        if (multiEnd.test(preparedLines[j].text)) {
          endIdx = j
          break
        }
      }
      spans.push({ kind: 'code', pStart: i, pEnd: endIdx })
      i = endIdx
      continue
    }

    if (HEADING_REGEX.test(line)) {
      spans.push({ kind: 'heading', pStart: i, pEnd: i })
      continue
    }
    if (HR_REGEX.test(line)) {
      spans.push({ kind: 'horizontalrule', pStart: i, pEnd: i })
      continue
    }
    if (IMAGE_BLOCK_REGEX.test(line)) {
      spans.push({ kind: 'image', pStart: i, pEnd: i })
      continue
    }
    if (FOOTNOTE_DEF_LINE_RE.test(line)) {
      spans.push({ kind: 'footnote-def', pStart: i, pEnd: i })
      continue
    }

    if (TABLE_ROW_REGEX.test(line)) {
      let endIdx = i
      while (endIdx + 1 < len && !preparedLines[endIdx + 1].isHtmlTable && TABLE_ROW_REGEX.test(preparedLines[endIdx + 1].text)) {
        endIdx++
      }
      spans.push({ kind: 'table', pStart: i, pEnd: endIdx })
      i = endIdx
      continue
    }

    if (QUOTE_REGEX.test(line)) {
      let endIdx = i
      while (endIdx + 1 < len) {
        const next = preparedLines[endIdx + 1]
        if (next.isHtmlTable) break
        if (QUOTE_REGEX.test(next.text)) {
          endIdx++
          continue
        }
        if (!isSpecialBlockLine(next.text)) {
          endIdx++
          continue
        }
        break
      }
      spans.push({ kind: 'quote', pStart: i, pEnd: endIdx })
      i = endIdx
      continue
    }

    const listType = getListLineType(line)
    if (listType !== null) {
      let endIdx = i
      while (endIdx + 1 < len) {
        const next = preparedLines[endIdx + 1]
        if (next.isHtmlTable) break
        const nextListType = getListLineType(next.text)
        if (nextListType !== null) {
          const indent = getListLeadingSpaces(next.text)
          if (nextListType === listType || indent > 0) {
            endIdx++
            continue
          }
          break
        }
        if (next.text.trim() === '') {
          // 向前探看跨越空行后的下一非空行是否仍属同一列表
          let k = endIdx + 2
          while (k < len && !preparedLines[k].isHtmlTable && preparedLines[k].text.trim() === '') {
            k++
          }
          if (k < len && !preparedLines[k].isHtmlTable) {
            const afterBlankType = getListLineType(preparedLines[k].text)
            if (
              afterBlankType !== null &&
              (afterBlankType === listType || getListLeadingSpaces(preparedLines[k].text) > 0)
            ) {
              endIdx = k
              continue
            }
          }
          break
        }
        if (!isSpecialBlockLine(next.text)) {
          endIdx++
          continue
        }
        break
      }
      spans.push({ kind: 'list', pStart: i, pEnd: endIdx, listType })
      i = endIdx
      continue
    }

    let endIdx = i
    while (endIdx + 1 < len) {
      const next = preparedLines[endIdx + 1]
      if (next.isHtmlTable || isSpecialBlockLine(next.text)) break
      endIdx++
    }
    spans.push({ kind: 'paragraph', pStart: i, pEnd: endIdx })
    i = endIdx
  }

  if (spans.length === 0) {
    return {
      preparedMarkdown,
      leadingGap: '',
      trailingGap: bodyRaw,
      blocks: []
    }
  }

  const blocks: SourceBlock[] = []
  let prevRawEnd = -1
  let leadingGap = ''

  spans.forEach((span, idx) => {
    const rawStartLine = preparedLines[span.pStart].rawStartLine
    const rawEndLine = preparedLines[span.pEnd].rawEndLine
    const gap = sliceGapAfter(rawLines, prevRawEnd, rawStartLine)
    const raw = sliceRawLinesRange(rawLines, rawStartLine, rawEndLine)
    if (idx === 0) {
      leadingGap = gap
    }
    blocks.push({
      id: `blk_${idx}`,
      kind: span.kind,
      raw,
      gapBefore: idx === 0 ? '' : gap,
      textHint: buildTextHint(span.kind, raw),
      startLine: rawStartLine,
      endLine: rawEndLine
    })
    prevRawEnd = rawEndLine
  })

  const trailingGap =
    (rawLines[prevRawEnd]?.eol ?? '') +
    rawLines
      .slice(prevRawEnd + 1)
      .map((item) => item.raw)
      .join('')

  return {
    preparedMarkdown,
    leadingGap,
    trailingGap,
    blocks
  }
}

export function getLexicalBlockKind(node: LexicalNode): SourceBlockKind {
  if ($isHeadingNode(node)) return 'heading'
  if ($isParagraphNode(node)) return 'paragraph'
  if ($isListNode(node)) return 'list'
  if ($isQuoteNode(node)) return 'quote'
  if ($isCodeNode(node)) return 'code'
  if ($isTableNode(node)) return 'table'
  if ($isWorkbenchHtmlTableNode(node)) return 'html-table'
  if ($isWorkbenchEquationNode(node)) return 'equation'
  if ($isWorkbenchHorizontalRuleNode(node)) return 'horizontalrule'
  if ($isWorkbenchImageNode(node)) return 'image'
  if ($isWorkbenchFootnoteDefNode(node)) return 'footnote-def'
  return 'other'
}

export function getLexicalNodeHint(node: LexicalNode): string {
  if ($isWorkbenchHtmlTableNode(node)) return ''
  if ($isWorkbenchEquationNode(node)) return node.getEquation().replace(/\s+/g, ' ').trim().slice(0, 80)
  return node.getTextContent().replace(/\s+/g, ' ').trim().slice(0, 80)
}

export function kindsCompatible(nodeKind: SourceBlockKind, blockKind: SourceBlockKind): boolean {
  if (nodeKind === blockKind) return true
  if (nodeKind === 'paragraph' && blockKind === 'image') return true
  return false
}

/**
 * 对两个区间做 O(K log K) 唯一锚点耐心对齐（Patience LIS），
 * 仅将锚点之间真正无法 1:1 对应的局部小段包成 CompositeSourceGroup。
 */
export function alignWithPatienceAnchors(
  nodeInfos: Array<{ key: NodeKey; kind: SourceBlockKind; hint: string }>,
  blocks: SourceBlock[]
): Array<{ cStart: number; cEnd: number; bStart: number; bEnd: number; matched: boolean }> {
  const sigCountNode = new Map<string, number>()
  const sigNodeIdx = new Map<string, number>()
  nodeInfos.forEach((info, idx) => {
    const sig = `${info.kind}:${info.hint}`
    sigCountNode.set(sig, (sigCountNode.get(sig) ?? 0) + 1)
    if (!sigNodeIdx.has(sig)) sigNodeIdx.set(sig, idx)
  })

  const sigCountBlock = new Map<string, number>()
  const sigBlockIdx = new Map<string, number>()
  blocks.forEach((blk, idx) => {
    const sig = `${blk.kind}:${blk.textHint}`
    sigCountBlock.set(sig, (sigCountBlock.get(sig) ?? 0) + 1)
    if (!sigBlockIdx.has(sig)) sigBlockIdx.set(sig, idx)
  })

  // 收集在两侧均唯一的锚点对 (cIdx, bIdx)，按 cIdx 升序排列
  const candidates: Array<{ c: number; b: number }> = []
  nodeInfos.forEach((info, cIdx) => {
    if (!info.hint) return
    const sig = `${info.kind}:${info.hint}`
    if (sigCountNode.get(sig) === 1 && sigCountBlock.get(sig) === 1) {
      const bIdx = sigBlockIdx.get(sig)
      if (bIdx !== undefined) candidates.push({ c: cIdx, b: bIdx })
    }
  })

  // 按 b 求 LIS，得到保序的锚点序列
  const lisPairs: Array<{ c: number; b: number }> = []
  if (candidates.length > 0) {
    const tails: number[] = []
    const tailIdx: number[] = []
    const prev = new Array<number>(candidates.length).fill(-1)

    for (let i = 0; i < candidates.length; i++) {
      const bVal = candidates[i].b
      let lo = 0
      let hi = tails.length
      while (lo < hi) {
        const mid = (lo + hi) >> 1
        if (tails[mid] < bVal) lo = mid + 1
        else hi = mid
      }
      tails[lo] = bVal
      tailIdx[lo] = i
      if (lo > 0) prev[i] = tailIdx[lo - 1]
    }

    let cur = tailIdx[tails.length - 1]
    while (cur !== -1) {
      lisPairs.push(candidates[cur])
      cur = prev[cur]
    }
    lisPairs.reverse()
  }

  const segments: Array<{ cStart: number; cEnd: number; bStart: number; bEnd: number; matched: boolean }> = []
  let cCursor = 0
  let bCursor = 0

  const flushGap = (cTo: number, bTo: number): void => {
    let cs = cCursor
    let ce = cTo
    let bs = bCursor
    let be = bTo

    // Lexical 的一个顶层源码块可能被解析成多个顶层节点（例如松散列表后的
    // 续行段落）。两侧数量不等时，任何贪心的 1:1 前后缀绑定都会漏掉剩余节点，
    // 拼装时便会先透传整块原文、再重复导出未绑定节点。此时必须把整个区间
    // 交给 CompositeSourceGroup，保证要么整块原文输出一次，要么拆组逐节点导出。
    if (ce - cs !== be - bs) {
      if (cs < ce || bs < be) {
        segments.push({ cStart: cs, cEnd: ce, bStart: bs, bEnd: be, matched: false })
      }
      return
    }

    const prefixMatches: Array<{ c: number; b: number }> = []
    while (cs < ce && bs < be && kindsCompatible(nodeInfos[cs].kind, blocks[bs].kind)) {
      prefixMatches.push({ c: cs, b: bs })
      cs++
      bs++
    }
    const suffixMatches: Array<{ c: number; b: number }> = []
    while (cs < ce && bs < be && kindsCompatible(nodeInfos[ce - 1].kind, blocks[be - 1].kind)) {
      suffixMatches.push({ c: ce - 1, b: be - 1 })
      ce--
      be--
    }
    for (const p of prefixMatches) {
      segments.push({ cStart: p.c, cEnd: p.c + 1, bStart: p.b, bEnd: p.b + 1, matched: true })
    }
    if (cs < ce || bs < be) {
      segments.push({ cStart: cs, cEnd: ce, bStart: bs, bEnd: be, matched: false })
    }
    for (let k = suffixMatches.length - 1; k >= 0; k--) {
      const s = suffixMatches[k]
      segments.push({ cStart: s.c, cEnd: s.c + 1, bStart: s.b, bEnd: s.b + 1, matched: true })
    }
  }

  for (const anchor of lisPairs) {
    flushGap(anchor.c, anchor.b)
    segments.push({
      cStart: anchor.c,
      cEnd: anchor.c + 1,
      bStart: anchor.b,
      bEnd: anchor.b + 1,
      matched: true
    })
    cCursor = anchor.c + 1
    bCursor = anchor.b + 1
  }
  flushGap(nodeInfos.length, blocks.length)

  return segments
}

/**
 * 在 Lexical `$convertFromMarkdownString` 刚完成后的 editor.update 内部调用，
 * 构建 `WorkbenchSourceState` 并绑定顶层节点 Key 到原始源码块。
 */
export function buildWorkbenchSourceState(
  originalFullContent: string,
  envelope: MarkdownEnvelope,
  scanned: {
    leadingGap: string
    trailingGap: string
    blocks: SourceBlock[]
  }
): WorkbenchSourceState {
  const topNodes = $getRoot()
    .getChildren()
    .filter((n) => !$isPendingInsertNode(n))

  const blocksById = new Map<string, SourceBlock>()
  for (const b of scanned.blocks) {
    blocksById.set(b.id, b)
  }

  const nodeKeyToBlockId = new Map<NodeKey, string>()
  const compositeGroupsById = new Map<string, CompositeSourceGroup>()
  const nodeKeyToGroupId = new Map<NodeKey, string>()
  const originalNodeOrder = topNodes.map((n) => n.getKey())
  const originalFirstBlockId = scanned.blocks[0]?.id ?? null

  const nodeInfos = topNodes.map((n) => ({
    key: n.getKey(),
    kind: getLexicalBlockKind(n),
    hint: getLexicalNodeHint(n)
  }))

  // Fast-path：长度与块类型完全一致时 1:1 绑定
  const isExactFastPath =
    nodeInfos.length === scanned.blocks.length &&
    nodeInfos.every((info, i) => kindsCompatible(info.kind, scanned.blocks[i].kind))

  if (isExactFastPath) {
    for (let i = 0; i < nodeInfos.length; i++) {
      nodeKeyToBlockId.set(nodeInfos[i].key, scanned.blocks[i].id)
    }
  } else if (scanned.blocks.length > 0 && nodeInfos.length > 0) {
    // Anchor-LCS 局部对齐兜底：仅局部不对齐的相邻小区间落入 CompositeSourceGroup
    const segments = alignWithPatienceAnchors(nodeInfos, scanned.blocks)
    let groupCounter = 0
    for (const seg of segments) {
      if (seg.matched && seg.cEnd - seg.cStart === 1 && seg.bEnd - seg.bStart === 1) {
        nodeKeyToBlockId.set(nodeInfos[seg.cStart].key, scanned.blocks[seg.bStart].id)
        continue
      }
      if (seg.cStart < seg.cEnd && seg.bStart < seg.bEnd) {
        const groupId = `grp_${groupCounter++}`
        const groupBlocks = scanned.blocks.slice(seg.bStart, seg.bEnd)
        let rawSlice = ''
        for (let bi = 0; bi < groupBlocks.length; bi++) {
          if (bi > 0) rawSlice += groupBlocks[bi].gapBefore
          rawSlice += groupBlocks[bi].raw
        }
        const nodeKeys = nodeInfos.slice(seg.cStart, seg.cEnd).map((item) => item.key)
        compositeGroupsById.set(groupId, {
          id: groupId,
          nodeKeys,
          rawSlice,
          gapBefore: groupBlocks[0].gapBefore,
          firstOriginalBlockId: groupBlocks[0].id,
          broken: false
        })
        for (const k of nodeKeys) {
          nodeKeyToGroupId.set(k, groupId)
        }
      }
    }
  }

  return {
    originalFullContent,
    envelope,
    leadingGap: scanned.leadingGap,
    trailingGap: scanned.trailingGap,
    blocksById,
    nodeKeyToBlockId,
    compositeGroupsById,
    nodeKeyToGroupId,
    originalFirstBlockId,
    originalNodeOrder,
    dirtyBlockKeys: new Set<NodeKey>(),
    exportedBlockCache: new Map<NodeKey, string>(),
    hasStructuralChanges: false
  }
}

function $serializeNodeSubtreeWithoutMarks(node: LexicalNode): ParsableSerializedNode[] {
  if ($isMarkNode(node)) {
    return node.getChildren().flatMap($serializeNodeSubtreeWithoutMarks)
  }
  const json = node.exportJSON(true) as ParsableSerializedNode
  if ($isElementNode(node)) {
    return [
      {
        ...json,
        children: node.getChildren().flatMap($serializeNodeSubtreeWithoutMarks)
      }
    ]
  }
  return [json]
}

/**
 * 仅导出单个顶层节点为 Markdown（局部剥离 MarkNode，绝不触碰其余文档块）。
 */
export function exportSingleTopLevelNode(
  editor: LexicalEditor,
  state: EditorState,
  nodeKey: NodeKey,
  transformers: Transformer[]
): string | null {
  let rootShell: ParsableSerializedNode | null = null
  let serializedNodes: ParsableSerializedNode[] = []

  state.read(() => {
    const node = $getNodeByKey(nodeKey)
    if (!node || !node.isAttached() || $isPendingInsertNode(node)) return
    const rootJson = $getRoot().exportJSON(true) as ParsableSerializedNode
    serializedNodes = $serializeNodeSubtreeWithoutMarks(node)
    rootShell = {
      ...rootJson,
      children: serializedNodes
    }
  })

  if (!rootShell) return null
  const shadow = editor.parseEditorState({ root: rootShell })
  return shadow.read(() => $convertToMarkdownString(transformers))
}

/**
 * 记录复合块内各节点的初始导出，供后续增量拼装判断节点是否真的发生内容变化。
 */
export function initializeCompositeGroupBaselines(
  editor: LexicalEditor,
  editorState: EditorState,
  sourceState: WorkbenchSourceState,
  transformers: Transformer[]
): void {
  for (const group of sourceState.compositeGroupsById.values()) {
    const baselineExports = new Map<NodeKey, string>()
    for (const nodeKey of group.nodeKeys) {
      const exported = exportSingleTopLevelNode(editor, editorState, nodeKey, transformers)
      if (exported !== null) baselineExports.set(nodeKey, exported)
    }
    group.baselineExports = baselineExports
  }
}

function isTopLevelNodeEmptyParagraph(node: LexicalNode): boolean {
  if (!$isParagraphNode(node)) return false
  if (node.getTextContentSize() > 0) return false
  for (const child of node.getChildren()) {
    if ($isDecoratorNode(child) || (!$isTextNode(child) && !$isMarkNode(child))) {
      return false
    }
    if ($isTextNode(child) && child.getTextContentSize() > 0) {
      return false
    }
  }
  return true
}

/**
 * 从当前 EditorState + SourceState 收集本次 update 变脏的顶层块，并存入 `sourceState.dirtyBlockKeys`。
 * 若某原始块是首次变脏，同步从 `prevEditorState` 懒缓存其单块基线，确保后续即使经历多次输入再 Undo 回原状，
 * 也能识别并还原为 clean 透传。
 */
export function collectDirtyTopLevelBlocks(
  editor: LexicalEditor,
  editorState: EditorState,
  prevEditorState: EditorState,
  dirtyElements: Map<NodeKey, boolean>,
  dirtyLeaves: Set<NodeKey>,
  sourceState: WorkbenchSourceState,
  transformers: Transformer[],
  tags?: Set<string>
): void {
  const newlyDirtiedKeys: NodeKey[] = []

  // undo/redo 或显式历史回退时全表失效，避免任何缓存命中旧文本
  if (tags?.has(HISTORIC_TAG) || tags?.has('history-merge')) {
    sourceState.exportedBlockCache.clear()
  }

  editorState.read(() => {
    const markKey = (key: NodeKey): void => {
      if (key === 'root') return
      const node = $getNodeByKey(key)
      if (!node || !node.isAttached()) return
      const top = node.getTopLevelElement()
      if (!top || $isPendingInsertNode(top)) return
      const topKey = top.getKey()
      // 任何变脏均立刻使单块导出缓存失效
      sourceState.exportedBlockCache.delete(topKey)
      if (!sourceState.dirtyBlockKeys.has(topKey)) {
        sourceState.dirtyBlockKeys.add(topKey)
        newlyDirtiedKeys.push(topKey)
      }
    }

    dirtyElements.forEach((_intentionallyMarked, key) => {
      markKey(key)
    })
    dirtyLeaves.forEach((key) => {
      markKey(key)
    })

    // 若顶层节点顺序/数量相对初始发生变化（插/删/拆/并/拖拽），记为结构变化；
    // 直接遍历兄弟链避免每次击键分配 3 个全顶层块数组
    const expectedOrder = sourceState.originalNodeOrder
    const expectedLen = expectedOrder.length
    let idx = 0
    let structuralChanged = false
    let child = $getRoot().getFirstChild()
    while (child !== null) {
      if (!$isPendingInsertNode(child)) {
        if (idx >= expectedLen || child.getKey() !== expectedOrder[idx]) {
          structuralChanged = true
          break
        }
        idx++
      }
      child = child.getNextSibling()
    }
    if (idx !== expectedLen) {
      structuralChanged = true
    }
    sourceState.hasStructuralChanges = structuralChanged
  })

  // 仅为首次变脏的已映射原始块，从 prevEditorState 抽取一次单块导出基线（O(1 block)）
  for (const topKey of newlyDirtiedKeys) {
    const blockId = sourceState.nodeKeyToBlockId.get(topKey)
    if (!blockId) continue
    const block = sourceState.blocksById.get(blockId)
    if (!block || block.baselineExport !== undefined) continue
    const prevExport = exportSingleTopLevelNode(editor, prevEditorState, topKey, transformers)
    if (prevExport !== null) {
      block.baselineExport = prevExport
    }
  }
}

/**
 * 基于 Source Map 增量拼装完整 Markdown（含 BOM、Frontmatter、EOL 与末尾换行）。
 * 未编辑的块、拖拽后未编辑内容的老块、或 Undo 回到原状的块均原样透传其 `raw` 源码。
 */
export function assembleIncrementalMarkdown(
  editor: LexicalEditor,
  editorState: EditorState,
  sourceState: WorkbenchSourceState,
  transformers: Transformer[],
  prevEditorState?: EditorState
): string {
  const { envelope } = sourceState
  const eol = envelope.eol

  // 收集当前顶层节点与元信息
  interface NodeSnapshot {
    key: NodeKey
    isEmptyPara: boolean
  }
  const snapshots: NodeSnapshot[] = []
  editorState.read(() => {
    for (const child of $getRoot().getChildren()) {
      if ($isPendingInsertNode(child)) continue
      snapshots.push({
        key: child.getKey(),
        isEmptyPara: isTopLevelNodeEmptyParagraph(child)
      })
    }
  })

  // 快速校验：无任何脏块且顺序完全与加载时一致 → 字节级零拷贝返回原文
  if (sourceState.dirtyBlockKeys.size === 0 && !sourceState.hasStructuralChanges) {
    return joinMarkdownEnvelope(envelope, sourceState.envelope.body)
  }

  // 检查是否退化为空文档
  if (
    snapshots.length === 0 ||
    (snapshots.length === 1 &&
      snapshots[0].isEmptyPara &&
      sourceState.blocksById.size === 0 &&
      sourceState.dirtyBlockKeys.size === 0)
  ) {
    if (sourceState.blocksById.size === 0 && !sourceState.dirtyBlockKeys.has(snapshots[0]?.key ?? '')) {
      return joinMarkdownEnvelope(envelope, sourceState.envelope.body)
    }
    return joinMarkdownEnvelope(envelope, '')
  }

  if (snapshots.length === 1 && snapshots[0].isEmptyPara && sourceState.dirtyBlockKeys.size > 0) {
    // 原本非空但被用户删光为单个空段落
    const firstBlockId = sourceState.nodeKeyToBlockId.get(snapshots[0].key)
    const firstBlock = firstBlockId ? sourceState.blocksById.get(firstBlockId) : undefined
    if (!firstBlock || firstBlock.raw.trim() !== '') {
      return joinMarkdownEnvelope(envelope, '')
    }
  }

  const getOrExportBlock = (nodeKey: NodeKey): string | null => {
    const cached = sourceState.exportedBlockCache.get(nodeKey)
    if (cached !== undefined) return cached
    const exported = exportSingleTopLevelNode(editor, editorState, nodeKey, transformers)
    if (exported !== null) {
      sourceState.exportedBlockCache.set(nodeKey, exported)
    }
    return exported
  }

  // 清理已从文档删除的陈旧缓存键，防止长会话编辑后持续累积
  if (sourceState.exportedBlockCache.size > snapshots.length + 64) {
    const liveKeys = new Set(snapshots.map((s) => s.key))
    for (const key of sourceState.exportedBlockCache.keys()) {
      if (!liveKeys.has(key)) {
        sourceState.exportedBlockCache.delete(key)
      }
    }
  }

  const parts: string[] = []
  let prevEmittedEmpty = false
  let hasEmittedAny = false
  let i = 0

  while (i < snapshots.length) {
    const snap = snapshots[i]
    const groupId = sourceState.nodeKeyToGroupId.get(snap.key)
    const group = groupId ? sourceState.compositeGroupsById.get(groupId) : undefined

    // 1. 检查是否命中完整未破坏的 CompositeSourceGroup
    if (group && !group.broken) {
      const expectedLen = group.nodeKeys.length
      let intact = i + expectedLen <= snapshots.length
      const unchangedDirtyKeys: NodeKey[] = []
      if (intact) {
        for (let k = 0; k < expectedLen; k++) {
          const nodeKey = snapshots[i + k].key
          if (nodeKey !== group.nodeKeys[k]) {
            intact = false
            break
          }
          if (!sourceState.dirtyBlockKeys.has(nodeKey)) continue
          const baselineExport = group.baselineExports?.get(nodeKey)
          const currentExport = getOrExportBlock(nodeKey)
          if (baselineExport === undefined || currentExport === null || currentExport !== baselineExport) {
            intact = false
            break
          }
          unchangedDirtyKeys.push(nodeKey)
        }
      }

      if (intact) {
        for (const nodeKey of unchangedDirtyKeys) {
          sourceState.dirtyBlockKeys.delete(nodeKey)
          sourceState.exportedBlockCache.delete(nodeKey)
        }
        if (!hasEmittedAny) {
          if (sourceState.originalFirstBlockId === group.firstOriginalBlockId) {
            parts.push(sourceState.leadingGap)
          }
        } else if (group.gapBefore.length > 0) {
          parts.push(group.gapBefore)
        } else {
          parts.push(!prevEmittedEmpty ? eol + eol : eol)
        }
        parts.push(group.rawSlice)
        hasEmittedAny = true
        prevEmittedEmpty = false
        i += expectedLen
        continue
      } else {
        // 一旦区间内发生编辑/移动/删除，标记组拆开，仅对组内实际变更节点导出
        group.broken = true
      }
    }

    // 2. 单块处理
    const blockId = sourceState.nodeKeyToBlockId.get(snap.key)
    const block = blockId ? sourceState.blocksById.get(blockId) : undefined
    let blockText: string
    let isCleanOriginal = false

    if (block) {
      if (!sourceState.dirtyBlockKeys.has(snap.key)) {
        blockText = block.raw
        isCleanOriginal = true
      } else {
        // 懒加载 prevEditorState 单块基线，用于识别 Undo 回原状 / 拖拽 / 无语义变化
        if (block.baselineExport === undefined && prevEditorState) {
          const prevExport = exportSingleTopLevelNode(editor, prevEditorState, snap.key, transformers)
          if (prevExport !== null) {
            block.baselineExport = prevExport
          }
        }
        const currentExport = getOrExportBlock(snap.key) ?? ''
        if (block.baselineExport !== undefined && currentExport === block.baselineExport) {
          sourceState.dirtyBlockKeys.delete(snap.key)
          sourceState.exportedBlockCache.delete(snap.key)
          blockText = block.raw
          isCleanOriginal = true
        } else {
          blockText = convertEol(currentExport, eol)
        }
      }
    } else {
      const currentExport = getOrExportBlock(snap.key) ?? ''
      blockText = convertEol(currentExport, eol)
    }

    // 计算当前块之前的分隔符
    if (!hasEmittedAny) {
      if (isCleanOriginal && block && block.id === sourceState.originalFirstBlockId) {
        parts.push(sourceState.leadingGap)
      }
    } else if (block && block.gapBefore.length > 0) {
      parts.push(block.gapBefore)
    } else {
      parts.push(!snap.isEmptyPara && !prevEmittedEmpty ? eol + eol : eol)
    }

    parts.push(blockText)
    hasEmittedAny = true
    prevEmittedEmpty = snap.isEmptyPara
    i++
  }

  parts.push(sourceState.trailingGap)
  return joinMarkdownEnvelope(envelope, parts.join(''))
}
