/**
 * 会话文档 frontmatter 的唯一写入与收敛规则。
 *
 * 会话文档只保留四个语义字段：source_kind、source、platform、captured_at。
 * source_key 是来源身份缓存，只有归一化身份与原始地址不同时才保留；
 * id / updated_at 属于旧格式的应用状态，不再写入。
 */

const FRONTMATTER_RE = /^---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/
const FIELD_RE = /^([A-Za-z0-9_-]+)\s*:\s*(.*)$/

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

function headingTitle(body: string, platform: string): string {
  const heading = body.split(/\r?\n/).find(line => /^#\s+/.test(line))
  if (!heading) return ''
  let title = heading.replace(/^#\s+/, '').trim()
  if (platform) {
    const prefix = platform.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    title = title.replace(new RegExp(`^${prefix}\\s*[-·:]\\s*`), '').trim()
  }
  return title
}

export interface ConversationFrontmatterInput {
  url?: string
  sourceKey?: string
  platform?: string
  capturedAt?: string | number
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

function frontmatterFieldLines(lines: string[]): Map<string, string[]> {
  const fields = new Map<string, string[]>()
  for (const line of lines) {
    const match = line.match(FIELD_RE)
    if (!match) continue
    const key = match[1].toLowerCase()
    const values = fields.get(key) ?? []
    values.push(line)
    fields.set(key, values)
  }
  return fields
}

/**
 * 把已有头部收敛成规范字段，同时保留用户自定义字段。
 * - id / updated_at：应用状态，删除
 * - source / source_url：同值别名合并；不同值保留 source_url
 * - source_key：与来源地址相同或与归一化身份相同则删除，否则保留
 * - captured_at：数值时间转 ISO
 * - title：与正文 H1 相同则删除
 */
function normalizeLines(
  lines: string[],
  body: string,
  overrides: {
    url?: string
    sourceKey?: string
    platform?: string
    capturedAt?: string
  } = {}
): string[] {
  const fields = frontmatterFieldLines(lines)
  const valueOf = (key: string): string => {
    const line = fields.get(key)?.[0]
    return line?.match(FIELD_RE)?.[2] ? unquote(line.match(FIELD_RE)![2]) : ''
  }

  const source = valueOf('source')
  const sourceUrl = valueOf('source_url')
  const sourceKey = valueOf('source_key')
  const platform = valueOf('platform')
  const title = valueOf('title')
  const capturedAt = normalizeTimestamp(valueOf('captured_at'))

  // 原始地址优先用 source；旧格式只有 source_url/source_key 时按同样语义回退。
  const primaryUrl = (overrides.url || '').trim() ||
    (isUrl(source) ? source : isUrl(sourceUrl) ? sourceUrl : isUrl(sourceKey) ? sourceKey : source || sourceUrl)
  const identity = (overrides.sourceKey || '').trim() || sourceKey
  const nextPlatform = (overrides.platform || '').trim() || platform
  const nextCapturedAt = overrides.capturedAt || capturedAt
  const heading = headingTitle(body, nextPlatform)

  const kept: string[] = ['source_kind: conversation']
  if (primaryUrl) kept.push(`source: ${primaryUrl}`)
  // 同值 source_url 是旧格式的重复字段；不同值代表第二个来源，不能丢。
  if (sourceUrl && sourceUrl !== primaryUrl) kept.push(`source_url: ${sourceUrl}`)
  // 只有身份与地址不同才保留；相同值只是重复字段。
  if (identity && identity !== primaryUrl && identity !== sourceUrl) {
    kept.push(`source_key: ${identity}`)
  }
  if (nextPlatform) kept.push(`platform: ${nextPlatform}`)
  if (nextCapturedAt) kept.push(`captured_at: ${nextCapturedAt}`)

  for (const line of lines) {
    const match = line.match(FIELD_RE)
    if (!match) continue
    const key = match[1].toLowerCase()
    if (['source_kind', 'source', 'source_url', 'source_key', 'platform', 'captured_at', 'id', 'updated_at'].includes(key)) continue
    if (key === 'title' && title && heading && title === heading) continue
    kept.push(line)
  }
  return kept
}

/**
 * 收敛旧会话文档：去掉 id/updated_at 和同值来源别名，数值时间转 ISO，
 * 标题与正文 H1 重复时不重复存 title。普通 Markdown 和自定义字段保持原样。
 */
export function normalizeConversationFrontmatter(content: string): string {
  const parts = splitFrontmatter(content)
  if (!parts) return content
  const kind = fieldValue(parts.lines, 'source_kind').toLowerCase()
  // 只有显式标成会话的文档才收敛；普通 Markdown 和无类型的历史文档
  // 由调用方先做会话来源判定，再补 source_kind。
  if (kind !== 'conversation') return content

  const kept = normalizeLines(parts.lines, parts.body)
  if (!kept.length) return content
  return `---${parts.newline}${kept.join(parts.newline)}${parts.newline}---${parts.newline}${parts.body}`
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
 * 另存/插入会话资料时补来源字段。即使没有可回显的 URL，也必须写
 * source_kind: conversation，否则无法区分会话文档与普通 Markdown。
 */
export function upsertConversationFrontmatter(
  content: string,
  input: ConversationFrontmatterInput
): string {
  const parts = splitFrontmatter(content)
  if (!parts) {
    const header = buildConversationFrontmatter(input)
    return `${header}${content}`
  }
  const platform = (input.platform || '').trim()
  const source = (input.url || '').trim()
  const normalized = normalizeLines(parts.lines, parts.body, {
    url: input.url,
    sourceKey: input.sourceKey,
    platform,
    capturedAt: input.capturedAt === undefined
      ? undefined
      : typeof input.capturedAt === 'number'
        ? new Date(input.capturedAt).toISOString()
        : input.capturedAt
  })
  // 另存/插入的正文本身来自会话，即使 URL 暂时不可用也必须带 source_kind，
  // 否则这篇文档会被当成普通 Markdown。
  if (!source) {
    const kindIndex = normalized.findIndex(line => /^source_kind\s*:/i.test(line))
    if (kindIndex >= 0) normalized[kindIndex] = 'source_kind: conversation'
  }
  if (source && !normalized.some(line => /^source\s*:/i.test(line))) {
    normalized.splice(1, 0, `source: ${source}`)
  }
  return `---${parts.newline}${normalized.join(parts.newline)}${parts.newline}---${parts.newline}${parts.body}`
}


