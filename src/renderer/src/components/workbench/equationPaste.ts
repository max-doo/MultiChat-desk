/**
 * 行尾奇数个 \ 在 LaTeX 粘贴里是续行标记（Typora/Obsidian 习惯），KaTeX 行尾孤立
 * 反斜杠会抛 ParseError，剥掉一个让 \\ 这类换行命令保持原样。
 */
export function sanitizeLatexEquation(raw: string): string {
  return raw
    .split('\n')
    .map((line) => {
      const trimmed = line.trimEnd()
      const trailing = trimmed.match(/(\\+)$/)
      return trailing && trailing[1].length % 2 === 1 ? trimmed.slice(0, -1) : trimmed
    })
    .filter((line) => line !== '')
    .join('\n')
    .trim()
}

export interface EquationPasteSlice {
  kind: 'text' | 'equation'
  text: string
}

/**
 * 把剪贴板纯文本按 $$...$$ 切成若干段。$$ 块不交给 markdown 导入，
 * 由调用方直接建公式节点——@lexical/markdown 的 CommonMark 语义会把行尾
 * 落单 \ 当硬换行剥掉、把 \{/\[ 等当成转义吃掉，LaTeX 源码必须逐字符保留。
 * 有未闭合的 $$ 时返回 null，表示不识别、放行默认粘贴。
 */
export function splitEquationPaste(text: string): EquationPasteSlice[] | null {
  if (!text.includes('$$')) return null

  const slices: EquationPasteSlice[] = []
  const buffer: string[] = []
  const eqBuffer: string[] = []
  let inEquation = false
  let hasEquation = false

  const flushText = (): void => {
    const chunk = buffer.join('\n')
    buffer.length = 0
    if (chunk.trim() !== '') slices.push({ kind: 'text', text: chunk })
  }

  for (const line of text.split('\n')) {
    if (!inEquation) {
      if (line.trimStart().startsWith('$$')) {
        flushText()
        const rest = line.slice(line.indexOf('$$') + 2)
        if (rest.trimEnd().endsWith('$$')) {
          // 单行 $$...$$
          const equation = sanitizeLatexEquation(rest.slice(0, rest.lastIndexOf('$$')))
          if (equation !== '') {
            slices.push({ kind: 'equation', text: equation })
            hasEquation = true
          } else {
            buffer.push(line)
          }
        } else {
          inEquation = true
          eqBuffer.length = 0
          eqBuffer.push(rest)
        }
      } else {
        buffer.push(line)
      }
    } else {
      if (line.trimEnd().endsWith('$$')) {
        const closing = line.lastIndexOf('$$')
        if (closing > 0) eqBuffer.push(line.slice(0, closing))
        const equation = sanitizeLatexEquation(eqBuffer.join('\n'))
        eqBuffer.length = 0
        inEquation = false
        if (equation !== '') {
          slices.push({ kind: 'equation', text: equation })
          hasEquation = true
        }
      } else {
        eqBuffer.push(line)
      }
    }
  }

  // 未闭合的 $$ 不拦截，避免吞掉用户文本
  if (inEquation || !hasEquation) return null
  flushText()
  return slices.length > 0 ? slices : null
}
