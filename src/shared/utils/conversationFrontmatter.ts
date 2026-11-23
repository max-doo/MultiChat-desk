/**
 * 会话文档 frontmatter 的唯一写入与收敛规则。
 *
 * 会话文档只保留四个语义字段：source_kind、source、platform、captured_at。
 * source_key 是来源身份缓存，只有归一化身份与原始地址不同时才保留；
 * id / updated_at 属于旧格式的应用状态，不再写入；title 归用户维护。
 *
 * 普通文档可以累积多个来源：第一个来源仍写在 source（原文入口、会话去重都只认
 * 它），后续来源进 sources 列表。会话文档保持单来源，插入其他会话一律拒绝。
 */

import { CONVERSATION_APP_KEYS } from './frontmatterPolicy'
import { noteConversationKey } from './noteIdentity'

const FRONTMATTER_RE = /^---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/
const FIELD_RE = /^([A-Za-z0-9_-]+)\s*:\s*(.*)$/
const SOURCES_KEY = 'sources'

const unquote = (value: string): string => {
  const trimmed = value.trim()
  if (trimmed.length >= 2 && trimmed.startsWith('"') && trimmed.endsWith('"')) {
    return trimmed.slice(1, -1).replace(/\\(["\\])/g, '$1')
  }
  if (trimmed.length >= 2 && trimmed.startsWith("'") && trimmed.endsWith("'")) {
    return trimmed.slice(1, -1).replace(/''/g, "'")
  }
  return trimmed
}

const isUrl = (value: string): boolean => /^https:\/\//i.test(value)

/** YAML 双引号标量：URL 里常带冒号和问号，统一加引号最省心。 */
function quoteScalar(value: string): string {
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`
}

function sourcesLines(items: string[]): string[] {
  return [`${SOURCES_KEY}:`, ...items.map(item => `  - ${quoteScalar(item)}`)]
}

/** 读取 sources 列表：兼容块状 `- url`、单行 `[a, b]` 和误写的标量。 */
function parseSourcesItems(lines: string[], span: FieldSpan): string[] {
  const blockItems: string[] = []
  for (let i = span.start + 1; i <= span.end; i++) {
    const match = lines[i].match(/^\s*-\s+(.*)$/)
    if (match) blockItems.push(unquote(match[1]))
  }
  if (blockItems.length) return blockItems.filter(Boolean)
  const inline = span.value.trim()
  if (inline.startsWith('[') && inline.endsWith(']')) {
    return inline.slice(1, -1).split(',').map(item => unquote(item)).filter(Boolean)
  }
  return inline ? [unquote(inline)] : []
}

/**
 * 同一会话的 SPA 地址常带不同的查询参数或末尾斜杠；比较来源时先去掉这些
 * 噪声，避免把同一会话误判成两个来源。
 */
export function sameSourceUrl(a: string, b: string): boolean {
  if (a === b) return true
  try {
    if (noteConversationKey(a, '') === noteConversationKey(b, '')) return true
  } catch {
    // 非标准 URL 继续走下面的字符串比较。
  }
  if (!isUrl(a) || !isUrl(b)) return false
  try {
    const left = new URL(a)
    const right = new URL(b)
    return (
      left.origin === right.origin &&
      left.pathname.replace(/\/$/, '') === right.pathname.replace(/\/$/, '')
    )
  } catch {
    return false
  }
}

function normalizeTimestamp(value: string): string {
  if (!/^\d{10,13}$/.test(value)) return value
  const numeric = Number(value)
  const timestamp = numeric < 1e12 ? numeric * 1000 : numeric
  const date = new Date(timestamp)
  return Number.isFinite(date.getTime()) ? date.toISOString() : value
}

interface FrontmatterParts {
  lines: string[]
  body: string
  newline: string
}

function splitFrontmatter(content: string): FrontmatterParts | null {
  const match = content.match(FRONTMATTER_RE)
  if (!match) return null
  return {
    lines: match[1].split(/\r?\n/),
    body: content.slice(match[0].length),
    newline: content.includes('\r\n') ? '\r\n' : '\n'
  }
}

function fieldValue(lines: string[], key: string): string {
  const line = lines.find(item => new RegExp(`^${key}\\s*:`, 'i').test(item))
  const match = line?.match(FIELD_RE)
  return match ? unquote(match[2]) : ''
}

export interface ConversationFrontmatterInput {
  url?: string
  sourceKey?: string
  platform?: string
  capturedAt?: string | number
}

export interface ConversationFrontmatterUpsertResult {
  content: string
  /** 普通文档里已存在、但语义与应用要写入的值不一致的字段。 */
  conflict: string[]
}

/** 生成规范化的会话文档头部；调用方负责拼接正文。 */
export function buildConversationFrontmatter(input: ConversationFrontmatterInput): string {
  const lines = ['---', 'source_kind: conversation']
  const url = (input.url || '').trim()
  const sourceKey = (input.sourceKey || '').trim()
  if (url) lines.push(`source: ${url}`)
  if (sourceKey && sourceKey !== url) lines.push(`source_key: ${sourceKey}`)
  if (input.platform?.trim()) lines.push(`platform: ${input.platform.trim()}`)
  const capturedAt = input.capturedAt === undefined
    ? new Date().toISOString()
    : typeof input.capturedAt === 'number'
      ? new Date(input.capturedAt).toISOString()
      : input.capturedAt
  if (capturedAt) lines.push(`captured_at: ${capturedAt}`)
  lines.push('---', '')
  return lines.join('\n')
}

/**
 * 生成单条回复摘录的头部：它是普通文档，不写 source_kind。
 * 只把来源信息留作可选属性，便于回看；与整段会话快照不同，摘录没有
 * 完整的对话轮次和采集边界，不能参与会话去重、原文标注或会话库统计。
 */
export function buildReplyExcerptFrontmatter(input: ConversationFrontmatterInput): string {
  const lines = ['---']
  const url = (input.url || '').trim()
  if (url) lines.push(`source: ${url}`)
  if (input.platform?.trim()) lines.push(`platform: ${input.platform.trim()}`)
  const capturedAt = input.capturedAt === undefined
    ? new Date().toISOString()
    : typeof input.capturedAt === 'number'
      ? new Date(input.capturedAt).toISOString()
      : input.capturedAt
  if (capturedAt) lines.push(`captured_at: ${capturedAt}`)
  lines.push('---', '')
  return lines.join('\n')
}

export interface FieldSpan {
  key: string
  lowerKey: string
  /** 字段在 frontmatter 内部行数组中的起始行（含）。 */
  start: number
  /** 字段在 frontmatter 内部行数组中的结束行（含）。 */
  end: number
  value: string
}

export function parseFieldSpans(lines: string[]): FieldSpan[] {
  const spans: FieldSpan[] = []
  let current: FieldSpan | null = null
  for (let i = 0; i < lines.length; i++) {
    const match = lines[i].match(FIELD_RE)
    if (match) {
      current = {
        key: match[1],
        lowerKey: match[1].toLowerCase(),
        start: i,
        end: i,
        value: unquote(match[2])
      }
      spans.push(current)
      continue
    }
    // 缩进行属于上一个字段（列表项、嵌套值或缩进注释）。顶层注释和空行
    // 不进入字段 span，删除字段时不会被一并带走。
    if (current && /^\s+\S/.test(lines[i])) current.end = i
  }
  return spans
}

function buildDocument(lines: string[], body: string, newline: string): string {
  return `---${newline}${lines.join(newline)}${newline}---${newline}${body}`
}

/**
 * 把已有头部收敛成规范字段，同时保留用户自定义字段、注释和未知行。
 *
 * 会话文档中应用字段可以改写；普通文档只补缺失字段，遇到同名不同值就返回
 * 冲突，绝不把用户的 source/platform 静默解释成会话来源。
 */
function normalizeLines(
  lines: string[],
  overrides: {
    url?: string
    sourceKey?: string
    platform?: string
    capturedAt?: string
  } = {},
  conversation = false
): { lines: string[]; conflict: string[] } {
  const spans = parseFieldSpans(lines)
  const first = new Map<string, FieldSpan>()
  const duplicates: FieldSpan[] = []
  for (const span of spans) {
    if (first.has(span.lowerKey)) duplicates.push(span)
    else first.set(span.lowerKey, span)
  }
  const valueOf = (key: string): string => first.get(key)?.value ?? ''
  const existingKind = valueOf('source_kind').trim().toLowerCase()
  const isConversation = conversation || existingKind === 'conversation'

  const source = valueOf('source')
  const sourceUrl = valueOf('source_url')
  const sourceKey = valueOf('source_key')
  const platform = valueOf('platform')
  const capturedAt = normalizeTimestamp(valueOf('captured_at'))

  const existingUrl = isUrl(source)
    ? source
    : isUrl(sourceUrl)
      ? sourceUrl
      : isUrl(sourceKey)
        ? sourceKey
        : source || sourceUrl
  const requestedUrl = (overrides.url || '').trim()
  // 原始地址优先用 source；旧格式只有 source_url/source_key 时按同样语义回退。
  // 同一会话只是查询参数不同时保留已有写法，避免无意义的整行改写。
  const primaryUrl =
    requestedUrl && !sameSourceUrl(requestedUrl, existingUrl) ? requestedUrl : existingUrl || requestedUrl
  const identity = (overrides.sourceKey || '').trim() || sourceKey
  const nextPlatform = (overrides.platform || '').trim() || platform
  const nextCapturedAt = overrides.capturedAt || capturedAt

  if (!isConversation) {
    // 普通文档：所有已存在的同名属性都归用户所有，只能补空位，不能改写。
    // 用户显式标成普通文档（source_kind: plain）时，插入回复等后续动作
    // 也不再补来源字段，尊重用户已经做出的类型选择。
    if (existingKind === 'plain') return { lines, conflict: [] }
    const url = (overrides.url || '').trim()
    const appKey = (overrides.sourceKey || '').trim()
    // 回复摘录不是会话快照：补来源信息即可，不写 source_kind，避免把
    // 普通笔记自动升级成会话文档。
    const next = [...lines]
    const missing: string[] = []
    // 行内改写与插入都按原始索引记录，最后从后往前应用，避免前面的插入
    // 让后面的行号整体偏移。
    const edits: Array<{ start: number; end: number; lines: string[] | null }> = []

    // 普通文档可以累积多个来源：第一个来源写 source（原文入口与会话去重
    // 都只认它），之后的来源进 sources 列表，已有值一律不覆盖。
    const sourcesSpan = first.get(SOURCES_KEY)
    const listed = sourcesSpan ? parseSourcesItems(lines, sourcesSpan) : []
    const known = [source, sourceUrl, isUrl(sourceKey) ? sourceKey : '', ...listed].filter(
      (item): item is string => !!item
    )
    const alreadyLinked = !url || known.some(item => sameSourceUrl(item, url))
    // 旧格式可能只有 source_url：它也承担“主来源”的位置，不能再补一个
    // 指向别的会话的 source，否则同一篇文档会出现两个互不相同的来源地址。
    const declared = first.get('source') ?? first.get('source_url')
    const declaredName = first.get('source') ? 'source' : 'source_url'
    const declaredUrl = declared?.value ?? ''
    // 只写了 sources、没写 source 的文档：最早列出的来源升为主来源，避免
    // 新插入的地址抢占 source 的位置。
    const promote = !declaredUrl && listed.length ? listed[0] : ''
    // 主来源优先级：已有 source / source_url > 列表里最早的一条 > 本次插入。
    const primaryUrl = declaredUrl || promote || url
    const rest = promote ? listed.slice(1) : [...listed]
    if (url && !alreadyLinked && url !== primaryUrl) rest.push(url)

    const writeSource = (value: string): void => {
      if (declared) {
        if (declared.value !== value) {
          edits.push({ start: declared.start, end: declared.start, lines: [`${declaredName}: ${value}`] })
        }
        return
      }
      missing.push(`source: ${value}`)
    }
    if (primaryUrl) writeSource(primaryUrl)

    const writeSources = (items: string[]): void => {
      if (sourcesSpan) {
        const replacement = items.length ? sourcesLines(items) : null
        edits.push({ start: sourcesSpan.start, end: sourcesSpan.end, lines: replacement })
        return
      }
      if (!items.length) return
      const replacement = sourcesLines(items)
      // 紧跟主来源放附加来源，属性面板里两个来源相邻更易读。
      if (declared) edits.push({ start: declared.end + 1, end: declared.end, lines: replacement })
      else missing.push(...replacement)
    }
    writeSources(rest)

    if (appKey && appKey !== url) {
      const span = first.get('source_key')
      if (!span) missing.push(`source_key: ${appKey}`)
      else if (!span.value) edits.push({ start: span.start, end: span.start, lines: [`source_key: ${appKey}`] })
    }
    // 平台与采集时间描述的是主来源。只有本次插入确实成为主来源时才补写，
    // 否则会把第二个来源的平台写到第一个来源头上。
    const describesPrimary = !!url && primaryUrl === url
    if (nextPlatform && describesPrimary) {
      const span = first.get('platform')
      if (!span) missing.push(`platform: ${nextPlatform}`)
      else if (!span.value) edits.push({ start: span.start, end: span.start, lines: [`platform: ${nextPlatform}`] })
    }
    if (nextCapturedAt && describesPrimary) {
      const span = first.get('captured_at')
      if (!span) missing.push(`captured_at: ${nextCapturedAt}`)
      else if (!span.value) edits.push({ start: span.start, end: span.start, lines: [`captured_at: ${nextCapturedAt}`] })
    }
    for (const edit of [...edits].sort((a, b) => b.start - a.start)) {
      next.splice(edit.start, edit.end - edit.start + 1, ...(edit.lines ?? []))
    }
    // 新字段放在最前，便于在属性面板中看到来源。
    next.unshift(...missing)
    return { lines: next, conflict: [] }
  }

  // 会话文档：只改写应用自己的键；未知字段、注释和缩进内容原样保留。
  // 已有关联来源时，插入另一段会话的回复不能静默改掉来源；需要用户在属性
  // 面板里显式改写 source，或先把文档转为普通文档。
  if (requestedUrl && existingUrl && !sameSourceUrl(requestedUrl, existingUrl)) {
    return { lines, conflict: ['source'] }
  }

  const desired: Array<[string, string]> = [['source_kind', 'conversation']]
  if (primaryUrl) desired.push(['source', primaryUrl])
  if (sourceUrl && sourceUrl !== primaryUrl) desired.push(['source_url', sourceUrl])
  if (identity && identity !== primaryUrl && identity !== sourceUrl) {
    desired.push(['source_key', identity])
  }
  if (nextPlatform) desired.push(['platform', nextPlatform])
  if (nextCapturedAt) desired.push(['captured_at', nextCapturedAt])

  const desiredMap = new Map(desired)
  const edits: Array<{ start: number; end: number; lines: string[] | null }> = []
  for (const span of spans) {
    if (!CONVERSATION_APP_KEYS.has(span.lowerKey)) continue
    if (duplicates.includes(span)) {
      edits.push({ start: span.start, end: span.end, lines: null })
      continue
    }
    const value = desiredMap.get(span.lowerKey)
    if (!value) {
      edits.push({ start: span.start, end: span.end, lines: null })
      continue
    }
    if (span.value !== value) {
      edits.push({ start: span.start, end: span.end, lines: [`${span.lowerKey}: ${value}`] })
    }
  }

  const missing = desired.filter(([key]) => !first.has(key))
  const insertAt = spans.length ? spans[0].start : lines.length
  const out: string[] = []
  for (let i = 0; i <= lines.length; i++) {
    if (i === insertAt) out.push(...missing.map(([key, value]) => `${key}: ${value}`))
    if (i === lines.length) break
    const edit = edits.find(item => item.start === i)
    if (edit) {
      if (edit.lines) out.push(...edit.lines)
      i = edit.end
      continue
    }
    out.push(lines[i])
  }
  return { lines: out, conflict: [] }
}

/**
 * 收敛旧会话文档：去掉 id/updated_at 和同值来源别名，数值时间转 ISO。
 * 普通 Markdown、自定义字段、注释和未知行保持原样。
 */
export function normalizeConversationFrontmatter(content: string): string {
  const parts = splitFrontmatter(content)
  if (!parts) return content
  const kind = fieldValue(parts.lines, 'source_kind').toLowerCase()
  // 只有显式标成会话的文档才收敛；普通 Markdown 和无类型的历史文档
  // 由调用方先做会话来源判定，再补 source_kind。
  if (kind !== 'conversation') return content

  const normalized = normalizeLines(parts.lines, {}, true)
  if (normalized.conflict.length) return content
  return buildDocument(normalized.lines, parts.body, parts.newline)
}

/**
 * 给无类型的历史会话文档补 source_kind，再按统一规则收敛。
 * 只用于已确认来源属于平台会话页的文档；普通 Markdown 不经过这里。
 */
export function adoptLegacyConversationFrontmatter(content: string): string {
  const parts = splitFrontmatter(content)
  if (!parts) return content
  if (fieldValue(parts.lines, 'source_kind')) return content
  return normalizeConversationFrontmatter(
    `---${parts.newline}source_kind: conversation${parts.newline}${parts.lines.join(parts.newline)}${parts.newline}---${parts.newline}${parts.body}`
  )
}

/**
 * 另存/插入回复摘录时补来源字段。已有会话文档保持 conversation 类型；
 * 普通文档只补来源属性，不写 source_kind。
 */
export function upsertConversationFrontmatter(
  content: string,
  input: ConversationFrontmatterInput
): ConversationFrontmatterUpsertResult {
  const parts = splitFrontmatter(content)
  if (!parts) {
    const header = buildReplyExcerptFrontmatter(input)
    return { content: `${header}${content}`, conflict: [] }
  }
  const kind = fieldValue(parts.lines, 'source_kind').trim().toLowerCase()
  const normalized = normalizeLines(parts.lines, {
    url: input.url,
    sourceKey: input.sourceKey,
    platform: input.platform,
    capturedAt: input.capturedAt === undefined
      ? undefined
      : typeof input.capturedAt === 'number'
        ? new Date(input.capturedAt).toISOString()
        : input.capturedAt
  }, kind === 'conversation')
  if (normalized.conflict.length) return { content, conflict: normalized.conflict }
  if (!normalized.lines.length) return { content, conflict: [] }
  return {
    content: buildDocument(normalized.lines, parts.body, parts.newline),
    conflict: []
  }
}


