/**
 * Pandoc 风格引文（citation）与 HTML 注释的共享匹配规则。
 * 渲染模式（Lexical）与源码模式（CodeMirror）共用同一套判定，避免两侧行为漂移。
 *
 * Pandoc citekey 规则：`@` 后首字符为字母/数字/下划线，
 * 后续允许字母数字、下划线与内部标点（不允许空白与分号）。
 */

/** 键入/导入共用的方括号引文候选：括号内含 @ 即进入候选，再用 key 校验兜底 */
export const CITATION_BRACKET_RE = /\[[^\]\n]*@[^\]\n]*\]/

/** 键入即时转换用的行尾变体（$ 截断到光标位置） */
export const CITATION_BRACKET_AT_END_RE = /\[[^\]\n]*@[^\]\n]*\]$/

/** 全局扫描变体（源码模式装饰用，使用方负责维护 lastIndex） */
export const CITATION_BRACKET_GLOBAL_RE = /\[[^\]\n]*@[^\]\n]*\]/g

const CITATION_KEY_SCAN_RE = /@([\p{L}\p{N}_][\p{L}\p{N}_:.#$%&+?<>~/-]*)/gu

/**
 * 提取方括号引文 inner 中的全部合法 citekey。
 * 无合法 key 时返回空数组，调用方应视为普通方括号文本（如 [a @ b]）。
 * 与 Pandoc 一致：`@` 前紧邻字母/数字/下划线时不构成引文，避免邮箱
 * `[联系 a@b.com]` 这类文本被误转换。
 */
export function extractCitationKeys(inner: string): string[] {
  const keys: string[] = []
  CITATION_KEY_SCAN_RE.lastIndex = 0
  let match: RegExpExecArray | null
  while ((match = CITATION_KEY_SCAN_RE.exec(inner)) !== null) {
    const prev = match.index > 0 ? inner[match.index - 1] : ''
    if (/[\p{L}\p{N}_]/u.test(prev)) continue
    keys.push(match[1])
  }
  return keys
}

/** 判断一段方括号 inner 文本是否构成 Pandoc 引文（至少含一个合法 key） */
export function isCitationInner(inner: string): boolean {
  return extractCitationKeys(inner).length > 0
}

/** 行内 HTML 注释：<!-- 内容 -->（非贪婪匹配到最近的闭合） */
export const HTML_COMMENT_RE = /<!--[\s\S]*?-->/

/** 键入即时转换用的行尾变体 */
export const HTML_COMMENT_AT_END_RE = /<!--[\s\S]*?-->$/
