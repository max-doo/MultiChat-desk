import type {
  Annotation,
  AnnotationAnchor,
  AnnotationAnchorReason,
  AnnotationAnchorState,
  ResolvedAnnotationAnchor
} from '../types/annotations'

const COMPACT_RE = /[\s\u200b-\u200d\ufeff]/g
const COMPACT_TEST_RE = /[\s\u200b-\u200d\ufeff]/
const VALID_ANCHOR_STATES = new Set<AnnotationAnchorState>([
  'anchored',
  'shifted',
  'ambiguous',
  'unlocated'
])
const VALID_ANCHOR_REASONS = new Set<AnnotationAnchorReason>([
  'not-found',
  'cross-block',
  'unsupported',
  'overlap'
])

const FUZZY_MIN_LENGTH = 16
const FUZZY_MAX_LENGTH = 2000
const FUZZY_SEED_LENGTH = 24
const FUZZY_MAX_CANDIDATES = 16
const FUZZY_MIN_MARGIN = 0.08

export const compactAnnotationText = (value: string): string => value.replace(COMPACT_RE, '')

/** 忽略空白和零宽字符，记录压缩文本到原文本的偏移。 */
export function compactWithOffsets(text: string): { compact: string; offsets: number[] } {
  const offsets: number[] = []
  let compact = ''
  for (let i = 0; i < text.length; i++) {
    if (COMPACT_TEST_RE.test(text[i])) continue
    offsets.push(i)
    compact += text[i]
  }
  return { compact, offsets }
}

function lowerBound(values: number[], target: number): number {
  let low = 0
  let high = values.length
  while (low < high) {
    const middle = (low + high) >> 1
    if (values[middle] < target) low = middle + 1
    else high = middle
  }
  return low
}

export interface AnnotationAnchorBlock {
  /** 全文可见文本中的原始起止位置。 */
  start: number
  end: number
}

export interface AnnotationAnchorResolution {
  id: string
  state: AnnotationAnchorState
  reason?: AnnotationAnchorReason
  start?: number
  end?: number
}

export interface ResolveAnnotationAnchorOptions {
  blocks?: AnnotationAnchorBlock[]
  allowFuzzy?: boolean
}

const contextScore = (text: string, start: number, end: number, anchor: AnnotationAnchor): number => {
  let score = 0
  const prefix = compactAnnotationText(anchor.prefix)
  if (prefix) {
    const actual = text.slice(Math.max(0, start - prefix.length), start)
    if (actual === prefix) score += prefix.length >= 8 ? 6 : 3
    else if (actual.includes(prefix)) score += 1
  }
  const suffix = compactAnnotationText(anchor.suffix)
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

function compactBlockRanges(
  blocks: AnnotationAnchorBlock[] | undefined,
  offsets: number[]
): AnnotationAnchorBlock[] | undefined {
  if (!blocks?.length) return undefined
  return blocks.map(block => ({
    start: lowerBound(offsets, block.start),
    end: lowerBound(offsets, block.end)
  }))
}

function blockContains(
  blocks: AnnotationAnchorBlock[] | undefined,
  start: number,
  end: number
): boolean {
  if (!blocks?.length) return true
  return blocks.some(block => start >= block.start && end <= block.end)
}

function longestCommonPrefix(left: string, right: string): number {
  const limit = Math.min(left.length, right.length)
  let index = 0
  while (index < limit && left[index] === right[index]) index += 1
  return index
}

function longestCommonSuffix(left: string, right: string): number {
  const limit = Math.min(left.length, right.length)
  let count = 0
  while (count < limit && left[left.length - 1 - count] === right[right.length - 1 - count]) {
    count += 1
  }
  return count
}

function normalizedContext(
  text: string,
  start: number,
  end: number,
  anchor: AnnotationAnchor
): number {
  const prefix = compactAnnotationText(anchor.prefix)
  const suffix = compactAnnotationText(anchor.suffix)
  let total = 0
  let score = 0
  if (prefix) {
    const actual = text.slice(Math.max(0, start - prefix.length), start)
    score += longestCommonSuffix(actual, prefix) / prefix.length
    total += 1
  }
  if (suffix) {
    const actual = text.slice(end, end + suffix.length)
    score += longestCommonPrefix(actual, suffix) / suffix.length
    total += 1
  }
  return total ? score / total : 0
}

function normalizedPosition(textLength: number, start: number, anchor: AnnotationAnchor): number {
  if (typeof anchor.offsetHint !== 'number') return 0.5
  const denominator = Math.max(2000, textLength * 0.25)
  return 1 - Math.min(1, Math.abs(start - anchor.offsetHint) / denominator)
}

function trigrams(text: string): Set<string> {
  const result = new Set<string>()
  for (let i = 0; i + 3 <= text.length; i += 1) result.add(text.slice(i, i + 3))
  return result
}

function intersectionSize(left: Set<string>, right: Set<string>): number {
  let count = 0
  for (const value of left) if (right.has(value)) count += 1
  return count
}

interface FuzzyCandidate {
  start: number
  end: number
  retention: number
  purity: number
  context: number
  position: number
  score: number
}

function fuzzyCandidates(
  text: string,
  exact: string,
  anchor: AnnotationAnchor,
  blocks: AnnotationAnchorBlock[] | undefined
): FuzzyCandidate[] {
  if (exact.length < FUZZY_MIN_LENGTH || exact.length > FUZZY_MAX_LENGTH) return []
  const quoteLength = exact.length
  const seedOffsets = [
    0,
    Math.floor(quoteLength / 4),
    Math.floor(quoteLength / 2),
    Math.floor((quoteLength * 3) / 4),
    Math.max(0, quoteLength - FUZZY_SEED_LENGTH)
  ]
  const ratios = [0.5, 0.75, 1, 1.25, 1.5]
  const ranges = new Map<string, { start: number; end: number; preRank: number }>()
  const seenSeeds = new Set<string>()

  for (const seedOffset of seedOffsets) {
    const seed = exact.slice(seedOffset, Math.min(quoteLength, seedOffset + FUZZY_SEED_LENGTH))
    if (seed.length < 5 || seenSeeds.has(seed)) continue
    seenSeeds.add(seed)
    const seedPositions = occurrencesOf(text, seed).slice(0, 8)
    for (const seedPosition of seedPositions) {
      for (const ratio of ratios) {
        const length = Math.max(8, Math.round(quoteLength * ratio))
        const start = Math.max(
          0,
          Math.min(text.length - length, seedPosition - Math.round(seedOffset * ratio))
        )
        const end = start + length
        if (end > text.length || !blockContains(blocks, start, end)) continue
        const key = `${start}:${end}`
        if (ranges.has(key)) continue
        const preRank =
          normalizedPosition(text.length, start, anchor) * 0.4 +
          normalizedContext(text, start, end, anchor) * 0.6
        ranges.set(key, { start, end, preRank })
      }
    }
  }

  const quoteGrams = trigrams(exact)
  if (!quoteGrams.size) return []
  const candidates: FuzzyCandidate[] = []
  for (const range of [...ranges.values()]
    .sort((left, right) => right.preRank - left.preRank)
    .slice(0, FUZZY_MAX_CANDIDATES)) {
    const candidateText = text.slice(range.start, range.end)
    const candidateGrams = trigrams(candidateText)
    if (!candidateGrams.size) continue
    const overlap = intersectionSize(quoteGrams, candidateGrams)
    const retention = overlap / quoteGrams.size
    const purity = overlap / candidateGrams.size
    const context = normalizedContext(text, range.start, range.end, anchor)
    const position = normalizedPosition(text.length, range.start, anchor)
    candidates.push({
      start: range.start,
      end: range.end,
      retention,
      purity,
      context,
      position,
      score: 0.5 * purity + 0.3 * context + 0.2 * position
    })
  }
  return candidates
}

function resolveOne(
  text: string,
  compact: string,
  offsets: number[],
  blocks: AnnotationAnchorBlock[] | undefined,
  annotation: Pick<Annotation, 'id' | 'anchor'>,
  allowFuzzy: boolean
): AnnotationAnchorResolution {
  const exact = compactAnnotationText(annotation.anchor?.exact || '')
  if (!exact) return { id: annotation.id, state: 'unlocated', reason: 'not-found' }

  const positions = occurrencesOf(compact, exact)
  const valid = positions
    .map((start, index) => ({ start, index }))
    .filter(item => blockContains(blocks, item.start, item.start + exact.length))
  if (positions.length && !valid.length) {
    return { id: annotation.id, state: 'unlocated', reason: 'cross-block' }
  }
  if (valid.length) {
    const scored = valid.map(item => {
      let score = contextScore(compact, item.start, item.start + exact.length, annotation.anchor)
      if (typeof annotation.anchor.occurrence === 'number') {
        score +=
          item.index === annotation.anchor.occurrence
            ? 4
            : -Math.min(2, Math.abs(item.index - annotation.anchor.occurrence))
      }
      const hint = annotation.anchor.offsetHint
      if (typeof hint === 'number') {
        score -= Math.min(6, Math.abs(offsets[item.start] - hint) / 2000)
      }
      return { ...item, score }
    })
    scored.sort((left, right) => right.score - left.score || left.start - right.start)
    const best = scored[0]
    const ambiguous = scored.length > 1 && Math.abs(scored[0].score - scored[1].score) < 0.5
    if (ambiguous) return { id: annotation.id, state: 'ambiguous' }
    const start = offsets[best.start]
    const end = offsets[best.start + exact.length - 1] + 1
    return { id: annotation.id, state: 'anchored', start, end }
  }

  if (!allowFuzzy) return { id: annotation.id, state: 'unlocated', reason: 'not-found' }
  const candidates = fuzzyCandidates(compact, exact, annotation.anchor, blocks)
    .filter(candidate => {
      const strict = exact.length < 32
      return (
        candidate.retention >= (strict ? 0.7 : 0.5) &&
        candidate.purity >= (strict ? 0.9 : 0.8) &&
        candidate.score >= 0.7
      )
    })
    .sort((left, right) => right.score - left.score || left.start - right.start)
  if (!candidates.length) return { id: annotation.id, state: 'unlocated', reason: 'not-found' }
  if (candidates.length > 1 && candidates[0].score - candidates[1].score < FUZZY_MIN_MARGIN) {
    return { id: annotation.id, state: 'ambiguous' }
  }
  const best = candidates[0]
  return {
    id: annotation.id,
    state: 'shifted',
    start: offsets[best.start],
    end: offsets[best.end - 1] + 1
  }
}

/**
 * 解析全部标注，返回每个 id 的状态；命中项带正文原始偏移。
 * 精确匹配优先，阶段 B 的有限模糊匹配只在显式启用且精确失败后执行。
 */
export function resolveAnnotationAnchors(
  text: string,
  annotations: Array<Pick<Annotation, 'id' | 'anchor'>>,
  options: ResolveAnnotationAnchorOptions = {}
): AnnotationAnchorResolution[] {
  if (!annotations.length) return []
  const { compact, offsets } = compactWithOffsets(text)
  if (!compact) {
    return annotations.map(annotation => ({
      id: annotation.id,
      state: 'unlocated' as const,
      reason: 'not-found' as const
    }))
  }
  const blocks = compactBlockRanges(options.blocks, offsets)
  return annotations.map(annotation =>
    resolveOne(text, compact, offsets, blocks, annotation, options.allowFuzzy === true)
  )
}

/**
 * 兼容旧调用：只返回可投影的命中项。
 * ambiguous/unlocated 不会出现在结果里，调用方应使用 resolveAnnotationAnchors 获取完整状态。
 */
export function resolveAnchors(
  text: string,
  annotations: Array<Pick<Annotation, 'id' | 'anchor'>>,
  options: ResolveAnnotationAnchorOptions = {}
): ResolvedAnnotationAnchor[] {
  return resolveAnnotationAnchors(text, annotations, options)
    .filter(
      (
        result
      ): result is AnnotationAnchorResolution & { start: number; end: number } =>
        typeof result.start === 'number' &&
        typeof result.end === 'number' &&
        (result.state === 'anchored' || result.state === 'shifted')
    )
    .map(result => ({
      id: result.id,
      start: result.start,
      end: result.end,
      ambiguous: false
    }))
    .sort((left, right) => left.start - right.start || left.end - right.end)
}

/** 计算新标注的全文压缩坐标，供文档创建与重新定位时落盘。 */
export function buildAnchorAt(
  text: string,
  start: number,
  end: number,
  contextLength = 48
): AnnotationAnchor {
  const { compact, offsets } = compactWithOffsets(text)
  const compactStart = lowerBound(offsets, Math.max(0, Math.min(start, text.length)))
  const compactEnd = lowerBound(offsets, Math.max(0, Math.min(end, text.length)))
  const exact = compact.slice(compactStart, compactEnd)
  const prefix = compact.slice(Math.max(0, compactStart - contextLength), compactStart)
  const suffix = compact.slice(compactEnd, Math.min(compact.length, compactEnd + contextLength))
  const before = compact.slice(0, compactStart)
  return {
    exact,
    prefix,
    suffix,
    occurrence: occurrencesOf(before, exact).length,
    offsetHint: compactStart
  }
}

function normalizedState(value: unknown): AnnotationAnchorState | undefined {
  return typeof value === 'string' && VALID_ANCHOR_STATES.has(value as AnnotationAnchorState)
    ? (value as AnnotationAnchorState)
    : undefined
}

function normalizedReason(value: unknown): AnnotationAnchorReason | undefined {
  return typeof value === 'string' && VALID_ANCHOR_REASONS.has(value as AnnotationAnchorReason)
    ? (value as AnnotationAnchorReason)
    : undefined
}

function normalizedTimestamp(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? Math.floor(value)
    : undefined
}

/** 校验并清理用户输入或磁盘读入的标注记录，主进程与渲染层共用。 */
export function normalizeAnnotation(
  input: Annotation,
  scope: Annotation['scope'],
  now = Date.now()
): Annotation {
  const quote = String(input.quote || '').slice(0, ANNOTATION_MAX_TEXT)
  const anchorQuote = String(input.anchor?.exact || quote || '')
  const state = normalizedState(input.anchorState)
  const base: Annotation = {
    id: input.id,
    scope,
    quote,
    anchor: {
      exact: compactAnnotationText(anchorQuote).slice(0, ANNOTATION_MAX_TEXT),
      prefix: compactAnnotationText(String(input.anchor?.prefix || '')).slice(0, ANNOTATION_MAX_TEXT),
      suffix: compactAnnotationText(String(input.anchor?.suffix || '')).slice(0, ANNOTATION_MAX_TEXT),
      occurrence:
        typeof input.anchor?.occurrence === 'number'
          ? Math.max(0, Math.floor(input.anchor.occurrence))
          : undefined,
      offsetHint:
        typeof input.anchor?.offsetHint === 'number'
          ? Math.max(0, Math.floor(input.anchor.offsetHint))
          : undefined
    },
    comment: String(input.comment || '').slice(0, ANNOTATION_MAX_TEXT),
    source: input.source,
    createdAt: Number.isFinite(input.createdAt) ? input.createdAt : now,
    updatedAt: Number.isFinite(input.updatedAt) ? input.updatedAt : now
  }

  const originalQuote =
    typeof input.originalQuote === 'string' && input.originalQuote
      ? input.originalQuote.slice(0, ANNOTATION_MAX_TEXT)
      : undefined
  if (originalQuote) base.originalQuote = originalQuote

  if (scope !== 'document') return base

  base.anchorRevision =
    typeof input.anchorRevision === 'number' && Number.isFinite(input.anchorRevision)
      ? Math.max(1, Math.floor(input.anchorRevision))
      : 1
  if (state) base.anchorState = state
  if (state === 'ambiguous' || state === 'unlocated') {
    const reason = normalizedReason(input.anchorReason)
    if (reason) base.anchorReason = reason
  }
  const orphanedAt = normalizedTimestamp(input.orphanedAt)
  if (orphanedAt) base.orphanedAt = orphanedAt
  const lastAnchoredAt = normalizedTimestamp(input.lastAnchoredAt)
  if (lastAnchoredAt) base.lastAnchoredAt = lastAnchoredAt
  return base
}

export const ANNOTATION_MAX_PER_FILE = 500
export const ANNOTATION_MAX_FILE_BYTES = 2 * 1024 * 1024
export const ANNOTATION_MAX_TEXT = 20_000

export const isUnresolvedAnchorState = (state: AnnotationAnchorState | undefined): boolean =>
  state === 'ambiguous' || state === 'unlocated'
