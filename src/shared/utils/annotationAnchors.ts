import type { Annotation, AnnotationAnchor, ResolvedAnnotationAnchor } from '../types/annotations'

const COMPACT_RE = /[\s\u200b-\u200d\ufeff]/g
const COMPACT_TEST_RE = /[\s\u200b-\u200d\ufeff]/
const compactText = (value: string): string => value.replace(COMPACT_RE, '')

/** 与原文高亮脚本保持一致：忽略空白和零宽字符，记录压缩文本到原文本的偏移。 */
function compactWithOffsets(text: string): { compact: string; offsets: number[] } {
  const offsets: number[] = []
  let compact = ''
  for (let i = 0; i < text.length; i++) {
    if (COMPACT_TEST_RE.test(text[i])) continue
    offsets.push(i)
    compact += text[i]
  }
  return { compact, offsets }
}

const contextScore = (text: string, start: number, end: number, anchor: AnnotationAnchor): number => {
  let score = 0
  const prefix = compactText(anchor.prefix)
  if (prefix) {
    const actual = text.slice(Math.max(0, start - prefix.length), start)
    if (actual === prefix) score += prefix.length >= 8 ? 6 : 3
    else if (actual.includes(prefix)) score += 1
  }
  const suffix = compactText(anchor.suffix)
  if (suffix) {
    const actual = text.slice(end, end + suffix.length)
    if (actual === suffix) score += suffix.length >= 8 ? 6 : 3
    else if (actual.includes(suffix)) score += 1
  }
  return score
}

const occurrencesOf = (text: string, exact: string): number[] => {
  const positions: number[] = []
  if (!exact) return positions
  let from = 0
  for (;;) {
    const index = text.indexOf(exact, from)
    if (index === -1) break
    positions.push(index)
    from = index + Math.max(1, exact.length)
  }
  return positions
}

/**
 * 在一段纯文本中定位标注。匹配顺序：exact → 上下文打分 → occurrence → offsetHint。
 * 找不到返回空数组；调用方应保留记录并显示“未定位”，而不是删除。
 */
export function resolveAnchors(
  text: string,
  annotations: Array<Pick<Annotation, 'id' | 'anchor'>>
): ResolvedAnnotationAnchor[] {
  if (!text) return []
  const { compact, offsets } = compactWithOffsets(text)
  if (!compact) return []
  const resolved: ResolvedAnnotationAnchor[] = []
  for (const annotation of annotations) {
    const exact = compactText(annotation.anchor?.exact || '')
    if (!exact) continue
    const positions = occurrencesOf(compact, exact)
    if (!positions.length) continue

    const scored = positions.map((start, index) => {
      let score = contextScore(compact, start, start + exact.length, annotation.anchor)
      if (typeof annotation.anchor.occurrence === 'number') {
        score += index === annotation.anchor.occurrence ? 4 : -Math.min(2, Math.abs(index - annotation.anchor.occurrence))
      }
      const hint = annotation.anchor.offsetHint
      if (typeof hint === 'number') {
        score -= Math.min(6, Math.abs(offsets[start] - hint) / 2000)
      }
      return { start, index, score }
    })
    scored.sort((a, b) =>
      b.score - a.score ||
      Math.abs(offsets[a.start] - (annotation.anchor.offsetHint ?? offsets[a.start])) -
        Math.abs(offsets[b.start] - (annotation.anchor.offsetHint ?? offsets[b.start])) ||
      a.start - b.start
    )
    const best = scored[0]
    const ambiguous = positions.length > 1 && scored.length > 1 && Math.abs(scored[0].score - scored[1].score) < 0.5
    const start = offsets[best.start]
    const end = offsets[best.start + exact.length - 1] + 1
    resolved.push({
      id: annotation.id,
      start,
      end,
      ambiguous
    })
  }
  return resolved.sort((a, b) => a.start - b.start || a.end - b.end)
}

/** 计算新标注的上下文与出现序号，供文档创建时落盘。 */
export function buildAnchorAt(
  text: string,
  start: number,
  end: number,
  contextLength = 48
): AnnotationAnchor {
  const exact = text.slice(start, end)
  const prefix = text.slice(Math.max(0, start - contextLength), start)
  const suffix = text.slice(end, Math.min(text.length, end + contextLength))
  const before = text.slice(0, start)
  const occurrence = occurrencesOf(before, exact).length
  return { exact, prefix, suffix, occurrence, offsetHint: start }
}

/** 校验并清理用户输入的标注记录，主进程与渲染层共用。 */
export function normalizeAnnotation(
  input: Annotation,
  scope: Annotation['scope'],
  now = Date.now()
): Annotation {
  const quote = String(input.quote || '').slice(0, 20_000)
  const exact = String(input.anchor?.exact || quote).slice(0, 20_000)
  return {
    id: input.id,
    scope,
    quote,
    anchor: {
      exact,
      prefix: String(input.anchor?.prefix || '').slice(0, 20_000),
      suffix: String(input.anchor?.suffix || '').slice(0, 20_000),
      occurrence: typeof input.anchor?.occurrence === 'number' ? Math.max(0, Math.floor(input.anchor.occurrence)) : undefined,
      offsetHint: typeof input.anchor?.offsetHint === 'number' ? Math.max(0, Math.floor(input.anchor.offsetHint)) : undefined
    },
    comment: String(input.comment || '').slice(0, 20_000),
    source: input.source,
    createdAt: Number.isFinite(input.createdAt) ? input.createdAt : now,
    updatedAt: Number.isFinite(input.updatedAt) ? input.updatedAt : now
  }
}

export const ANNOTATION_MAX_PER_FILE = 500
export const ANNOTATION_MAX_FILE_BYTES = 2 * 1024 * 1024
export const ANNOTATION_MAX_TEXT = 20_000
