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

const wordSegmenter =
  typeof Intl !== 'undefined' && typeof Intl.Segmenter === 'function'
    ? new Intl.Segmenter(undefined, { granularity: 'word' })
    : null

function countNonCjkWords(text: string): number {
  if (wordSegmenter) {
    let count = 0
    for (const { segment, isWordLike } of wordSegmenter.segment(text)) {
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

  let chars = 0
  let cjkChars = 0
  let nonCjkWords = 0
  let nonCjkStart = -1

  for (let i = 0; i < text.length; ) {
    const cp = text.codePointAt(i)!
    const step = cp > 0xffff ? 2 : 1
    chars += 1

    // ASCII 字符（<= 0x7F）绝不命中 CJK，跳过单字符 slice 与正则匹配
    const isCjk = cp > 0x7f && CJK_CHAR_REGEX.test(text.slice(i, i + step))
    if (isCjk) {
      cjkChars += 1
      if (nonCjkStart !== -1) {
        nonCjkWords += countNonCjkWords(text.slice(nonCjkStart, i))
        nonCjkStart = -1
      }
    } else if (nonCjkStart === -1) {
      nonCjkStart = i
    }

    i += step
  }

  if (nonCjkStart !== -1) {
    nonCjkWords += countNonCjkWords(text.slice(nonCjkStart))
  }

  return {
    words: cjkChars + nonCjkWords,
    chars
  }
}
