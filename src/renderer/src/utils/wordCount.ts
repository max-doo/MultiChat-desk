/**
 * 字数统计：采用 Word/WPS 的口径
 *
 * - 字 = CJK 表意/音节字符逐字计数 + 非 CJK 部分按词计数
 *   - CJK 范围：汉字（含扩展区）、日文假名、韩文音节、全角/CJK 标点
 *   - 非 CJK 词：按 Unicode 词边界（Intl.Segmenter word granularity）分词，
 *     仅计含字母或数字的片段，排除孤立标点
 *   - 回退：Intl.Segmenter 不可用时退化为按空白切分
 * - 字符 = Unicode code point 数（emoji 等代理对计 1）
 *
 * 统计基于 Markdown 源码：标记符号（#、**、URL）按上述规则计入。
 */

const CJK_CHAR_REGEX =
  /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}\u3000-\u303f\uff00-\uff60\uffe0-\uffe6]/u

const WORD_LIKE_REGEX = /[\p{L}\p{N}]/u

export interface WordCountResult {
  /** 字（Word 口径：CJK 字符数 + 非 CJK 词数） */
  words: number
  /** 字符（code point 数，与用户视觉一致） */
  chars: number
}

function countNonCjkWords(text: string): number {
  if (typeof Intl !== 'undefined' && typeof Intl.Segmenter === 'function') {
    const segmenter = new Intl.Segmenter(undefined, { granularity: 'word' })
    let count = 0
    for (const { segment, isWordLike } of segmenter.segment(text)) {
      if (isWordLike && WORD_LIKE_REGEX.test(segment)) count += 1
    }
    return count
  }
  return text
    .split(/\s+/)
    .filter((token) => token.length > 0 && WORD_LIKE_REGEX.test(token)).length
}

export function countWords(text: string): WordCountResult {
  if (!text) return { words: 0, chars: 0 }

  const chars = Array.from(text)
  let cjkChars = 0
  const nonCjkParts: string[] = []
  let buffer = ''

  for (const ch of chars) {
    if (CJK_CHAR_REGEX.test(ch)) {
      cjkChars += 1
      if (buffer) {
        nonCjkParts.push(buffer)
        buffer = ''
      }
    } else {
      buffer += ch
    }
  }
  if (buffer) nonCjkParts.push(buffer)

  const nonCjkWords = nonCjkParts.reduce((sum, part) => sum + countNonCjkWords(part), 0)

  return {
    words: cjkChars + nonCjkWords,
    chars: chars.length
  }
}
