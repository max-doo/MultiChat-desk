export interface MathEntry {
  tex: string
  display: boolean
}

export interface PreparedMarkdownMath {
  processed: string
  entries: MathEntry[]
  prefix: string
}

interface HastText {
  type: 'text'
  value: string
}

interface HastElement {
  type: 'element'
  tagName: string
  properties?: Record<string, unknown>
  children: HastChild[]
}

interface HastComment {
  type: 'comment'
  value: string
}

type HastChild = HastText | HastElement | HastComment | { type: string; children?: HastChild[] }

export interface HastRoot {
  type: 'root'
  children: HastChild[]
}

const BARE_BLOCK_ENVS = new Set([
  'equation',
  'equation*',
  'align',
  'align*',
  'gather',
  'gather*'
])

const SKIP_HAST_TAGS = new Set(['pre', 'code', 'script', 'style', 'textarea'])

function isBlankLineAhead(text: string, index: number): boolean {
  if (text[index] !== '\n' && !(text[index] === '\r' && text[index + 1] === '\n')) {
    return false
  }
  let pos = text[index] === '\r' ? index + 2 : index + 1
  while (pos < text.length && (text[pos] === ' ' || text[pos] === '\t')) {
    pos++
  }
  return (
    pos < text.length &&
    (text[pos] === '\n' || (text[pos] === '\r' && text[pos + 1] === '\n'))
  )
}

function getLineStartIndex(text: string, index: number): number {
  const prevNewline = text.lastIndexOf('\n', index - 1)
  return prevNewline === -1 ? 0 : prevNewline + 1
}

function hasOnlyBlockquotePrefixBefore(text: string, index: number): boolean {
  const lineStart = getLineStartIndex(text, index)
  const before = text.slice(lineStart, index)
  return /^[ \t]*(?:>[ \t]*)+$/.test(before)
}

function stripBlockquotePrefixes(raw: string, strip: boolean): string {
  if (!strip) return raw
  return raw.replace(/^[ \t]*(?:>[ \t]*)+/gm, '')
}

function findFencedCodeBlockEnd(text: string, lineStart: number): number {
  const lineEnd = text.indexOf('\n', lineStart)
  const firstLine = lineEnd === -1 ? text.slice(lineStart) : text.slice(lineStart, lineEnd)
  const openMatch = /^(?:[ ]{0,3}>)*[ ]{0,3}(`{3,}|~{3,})([^\r\n]*)\r?$/.exec(firstLine)
  if (!openMatch) return -1

  const fence = openMatch[1]
  const fenceChar = fence[0]
  const fenceLen = fence.length
  const info = openMatch[2]
  if (fenceChar === '`' && info.includes('`')) {
    return -1
  }

  if (lineEnd === -1) return text.length

  let cursor = lineEnd + 1
  const closeRegex = new RegExp(
    `^(?:[ ]{0,3}>)*[ ]{0,3}${fenceChar}{${fenceLen},}[ \\t]*\\r?$`
  )
  while (cursor < text.length) {
    const nextNl = text.indexOf('\n', cursor)
    const line = nextNl === -1 ? text.slice(cursor) : text.slice(cursor, nextNl)
    if (closeRegex.test(line)) {
      return nextNl === -1 ? text.length : nextNl + 1
    }
    if (nextNl === -1) break
    cursor = nextNl + 1
  }
  return text.length
}

function findClosingBackticks(text: string, startIndex: number, tickLen: number): number {
  let j = startIndex
  while (j < text.length) {
    if (isBlankLineAhead(text, j)) return -1
    if (text[j] === '`') {
      let run = 0
      while (j + run < text.length && text[j + run] === '`') run++
      if (run === tickLen) {
        return j + run
      }
      j += run
      continue
    }
    j++
  }
  return -1
}

function findClosingEscapedDelimiter(
  text: string,
  startIndex: number,
  closingChar: ')' | ']',
  stopOnBlankLine: boolean
): number {
  let j = startIndex
  while (j < text.length) {
    if (stopOnBlankLine && isBlankLineAhead(text, j)) return -1
    if (text[j] === '\\' && j + 1 < text.length) {
      if (text[j + 1] === closingChar) {
        return j
      }
      j += 2
      continue
    }
    j++
  }
  return -1
}

function findClosingDoubleDollar(text: string, startIndex: number): number {
  let j = startIndex
  while (j < text.length) {
    if (text[j] === '\\' && j + 1 < text.length) {
      j += 2
      continue
    }
    if (text[j] === '$' && text[j + 1] === '$') {
      return j
    }
    j++
  }
  return -1
}

function findClosingSingleDollar(text: string, startIndex: number): number {
  let j = startIndex
  while (j < text.length) {
    if (isBlankLineAhead(text, j)) return -1
    if (text[j] === '\\' && j + 1 < text.length) {
      j += 2
      continue
    }
    if (text[j] === '$') {
      if (text[j + 1] === '$') return -1
      const before = text[j - 1]
      const after = j + 1 < text.length ? text[j + 1] : ''
      if (!/[ \t\r\n]/.test(before) && !/[0-9]/.test(after)) {
        return j
      }
      return -1
    }
    j++
  }
  return -1
}

function makeUniquePrefix(content: string): string {
  let prefix = 'MCKATEXMATH'
  while (content.includes(prefix)) {
    prefix += 'X'
  }
  return prefix
}

/**
 * 在 CommonMark / GFM 解析之前提取并屏蔽 LaTeX 数学公式，
 * 避免公式内部的 `_`、`*`、`\\`、`|`、`<`、`>` 被 Markdown 或 rehypeRaw 误解析；
 * 同时跳过围栏代码块、行内代码与转义符号 `\$`。
 */
export function extractMathPlaceholders(content: string): PreparedMarkdownMath {
  if (
    !content ||
    (!content.includes('$') && !content.includes('\\(') && !content.includes('\\[') && !content.includes('\\begin{'))
  ) {
    return { processed: content, entries: [], prefix: '' }
  }

  const prefix = makeUniquePrefix(content)
  const entries: MathEntry[] = []
  let out = ''
  let i = 0

  const pushMath = (tex: string, display: boolean): string => {
    const idx = entries.length
    entries.push({ tex, display })
    return `${prefix}${idx}END`
  }

  while (i < content.length) {
    const atLineStart = i === 0 || content[i - 1] === '\n'

    if (atLineStart) {
      const fenceEnd = findFencedCodeBlockEnd(content, i)
      if (fenceEnd !== -1) {
        out += content.slice(i, fenceEnd)
        i = fenceEnd
        continue
      }

      // 裸 \begin{equation|align|gather}...\end{...}（行首或引用前缀后）
      const sliceFromLine = content.slice(i)
      const envMatch = /^((?:[ ]{0,3}>[ ]?)*[ \t]*)(\\begin\{(equation\*?|align\*?|gather\*?)\})/.exec(
        sliceFromLine
      )
      if (envMatch && BARE_BLOCK_ENVS.has(envMatch[3])) {
        const bqPrefix = envMatch[1]
        const envName = envMatch[3]
        const envStart = i + bqPrefix.length
        const endToken = `\\end{${envName}}`
        const endIdx = content.indexOf(endToken, envStart + envMatch[2].length)
        if (endIdx !== -1) {
          const rawBlock = content.slice(envStart, endIdx + endToken.length)
          const cleaned = stripBlockquotePrefixes(rawBlock, bqPrefix.includes('>')).trim()
          if (cleaned) {
            out += bqPrefix + pushMath(cleaned, true)
            i = endIdx + endToken.length
            continue
          }
        }
      }
    }

    const ch = content[i]

    // 行内代码 `...`
    if (ch === '`') {
      let tickLen = 0
      while (i + tickLen < content.length && content[i + tickLen] === '`') {
        tickLen++
      }
      const closeEnd = findClosingBackticks(content, i + tickLen, tickLen)
      if (closeEnd !== -1) {
        out += content.slice(i, closeEnd)
        i = closeEnd
      } else {
        out += content.slice(i, i + tickLen)
        i += tickLen
      }
      continue
    }

    // 反斜杠转义及 \(...\), \[...\]
    if (ch === '\\') {
      if (i + 1 >= content.length) {
        out += ch
        i++
        continue
      }
      const next = content[i + 1]
      if (next === '\\' || next === '$') {
        out += content.slice(i, i + 2)
        i += 2
        continue
      }
      if (next === '(') {
        const closeIdx = findClosingEscapedDelimiter(content, i + 2, ')', true)
        if (closeIdx !== -1) {
          const tex = content.slice(i + 2, closeIdx).trim()
          if (tex) {
            out += pushMath(tex, false)
            i = closeIdx + 2
            continue
          }
        }
        out += '\\('
        i += 2
        continue
      }
      if (next === '[') {
        const closeIdx = findClosingEscapedDelimiter(content, i + 2, ']', false)
        if (closeIdx !== -1) {
          const afterClose = content[closeIdx + 2] ?? ''
          // \[text\](url) 或 \[text\]\[ref\] 是 Markdown 链接转义，非公式
          if (afterClose !== '(' && afterClose !== '[') {
            const hasBq = hasOnlyBlockquotePrefixBefore(content, i)
            const tex = stripBlockquotePrefixes(content.slice(i + 2, closeIdx), hasBq).trim()
            if (tex) {
              out += pushMath(tex, true)
              i = closeIdx + 2
              continue
            }
          }
        }
        out += '\\['
        i += 2
        continue
      }
      out += content.slice(i, i + 2)
      i += 2
      continue
    }

    // 块级 $$...$$ 与行内 $...$
    if (ch === '$') {
      if (content[i + 1] === '$') {
        const closeIdx = findClosingDoubleDollar(content, i + 2)
        if (closeIdx !== -1) {
          const hasBq = hasOnlyBlockquotePrefixBefore(content, i)
          const tex = stripBlockquotePrefixes(content.slice(i + 2, closeIdx), hasBq).trim()
          if (tex) {
            out += pushMath(tex, true)
            i = closeIdx + 2
            continue
          }
        }
        out += '$$'
        i += 2
        continue
      }

      const prevChar = i > 0 ? content[i - 1] : ''
      const nextChar = i + 1 < content.length ? content[i + 1] : ''
      if (!/[0-9]/.test(prevChar) && nextChar && !/[ \t\r\n]/.test(nextChar)) {
        const closeIdx = findClosingSingleDollar(content, i + 1)
        if (closeIdx !== -1) {
          const tex = content.slice(i + 1, closeIdx).trim()
          if (tex) {
            out += pushMath(tex, false)
            i = closeIdx + 1
            continue
          }
        }
      }

      out += '$'
      i++
      continue
    }

    out += ch
    i++
  }

  return {
    processed: out,
    entries,
    prefix
  }
}

function isDisplayMathElement(node: HastChild): boolean {
  return (
    node.type === 'element' &&
    'tagName' in node &&
    node.tagName === 'span' &&
    Boolean(node.properties && node.properties['data-katex-display'] === '1')
  )
}

function isWhitespaceText(node: HastChild): boolean {
  return node.type === 'text' && 'value' in node && /^[ \t\r\n]*$/.test(String(node.value))
}

function splitTextWithMathNodes(
  text: string,
  entries: MathEntry[],
  tokenRegex: RegExp
): HastChild[] | null {
  tokenRegex.lastIndex = 0
  let match = tokenRegex.exec(text)
  if (!match) return null

  const nodes: HastChild[] = []
  let lastIndex = 0

  while (match) {
    if (match.index > lastIndex) {
      nodes.push({ type: 'text', value: text.slice(lastIndex, match.index) })
    }
    const entryIndex = Number(match[1])
    const entry = entries[entryIndex]
    if (entry) {
      nodes.push({
        type: 'element',
        tagName: 'span',
        properties: {
          'data-katex-math': '1',
          'data-katex-display': entry.display ? '1' : '0',
          'data-katex-tex': entry.tex
        },
        children: []
      })
    } else {
      nodes.push({ type: 'text', value: match[0] })
    }
    lastIndex = match.index + match[0].length
    match = tokenRegex.exec(text)
  }

  if (lastIndex < text.length) {
    nodes.push({ type: 'text', value: text.slice(lastIndex) })
  }

  return nodes
}

function transformHastNode(
  node: HastChild,
  entries: MathEntry[],
  tokenRegex: RegExp
): void {
  if (!('children' in node) || !Array.isArray(node.children)) return
  if (node.type === 'element' && 'tagName' in node && SKIP_HAST_TAGS.has(node.tagName)) {
    return
  }

  const nextChildren: HastChild[] = []
  let changed = false

  for (const child of node.children) {
    if (child.type === 'text' && 'value' in child && typeof child.value === 'string') {
      const replaced = splitTextWithMathNodes(child.value, entries, tokenRegex)
      if (replaced) {
        nextChildren.push(...replaced)
        changed = true
        continue
      }
    } else {
      transformHastNode(child, entries, tokenRegex)
    }
    nextChildren.push(child)
  }

  if (changed) {
    node.children = nextChildren
  }

  // 若 <p> 仅包含块级公式与空白符，转为 div 容器避免多余段落间距与结构嵌套
  if (node.type === 'element' && 'tagName' in node && node.tagName === 'p') {
    let hasDisplayMath = false
    let onlyDisplayOrWhitespace = node.children.length > 0
    for (const child of node.children) {
      if (isDisplayMathElement(child)) {
        hasDisplayMath = true
      } else if (!isWhitespaceText(child)) {
        onlyDisplayOrWhitespace = false
        break
      }
    }
    if (hasDisplayMath && onlyDisplayOrWhitespace) {
      const el = node as HastElement
      el.tagName = 'div'
      el.properties = { className: ['last:mb-0'] }
    }
  }
}

/**
 * 创建 rehype 插件：在 rehypeRaw 之后把数学占位符还原为待 KaTeX 渲染的节点。
 */
export function createRehypeRestoreMath(entries: MathEntry[], prefix: string) {
  const tokenRegex = new RegExp(`${prefix}(\\d+)END`, 'g')
  return function rehypeRestoreMath() {
    return function transformer(tree: HastRoot): void {
      transformHastNode(tree, entries, tokenRegex)
    }
  }
}
