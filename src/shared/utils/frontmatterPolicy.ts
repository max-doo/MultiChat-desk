/**
 * Markdown frontmatter 字段归属。
 *
 * 约定的是「谁维护这个字段」，用于面板分组和写回保护。普通 Markdown 没有
 * 系统字段；只有显式标成会话的文档才启用会话字段，导图文件按扩展名识别。
 */

export type FrontmatterDocumentKind = 'conversation' | 'mindmap' | 'plain'
export type FrontmatterFieldRole = 'source' | 'identity' | 'user'

export interface FrontmatterOwnership {
  kind: FrontmatterDocumentKind
  sourceKeys: ReadonlySet<string>
  identityKeys: ReadonlySet<string>
  roleOf: (key: string) => FrontmatterFieldRole
  isReserved: (key: string) => boolean
}

const CONVERSATION_SOURCE_KEYS = new Set(['source', 'source_url', 'platform', 'captured_at'])
const CONVERSATION_IDENTITY_KEYS = new Set(['source_kind', 'source_key', 'id', 'updated_at'])
const MINDMAP_SOURCE_KEYS = new Set(['source'])
const MINDMAP_IDENTITY_KEYS = new Set(['id', 'title', 'updatedat'])
const EMPTY_KEYS = new Set<string>()
/** 文档类型是应用语义，任何文档都不应把它当普通属性新增或改名。 */
const GLOBAL_RESERVED_KEYS = new Set(['source_kind'])

/** 会话文档中由应用维护的键（小写）。写回时只允许改动这些键。 */
export const CONVERSATION_APP_KEYS: ReadonlySet<string> = new Set([
  ...CONVERSATION_SOURCE_KEYS,
  ...CONVERSATION_IDENTITY_KEYS
])

/** 只影响应用自身状态的键；普通文档里出现这些键不代表来源冲突。 */
export const APP_STATE_ONLY_KEYS: ReadonlySet<string> = new Set(['id', 'updated_at'])

function ownership(
  kind: FrontmatterDocumentKind,
  sourceKeys: ReadonlySet<string>,
  identityKeys: ReadonlySet<string>
): FrontmatterOwnership {
  const roleOf = (key: string): FrontmatterFieldRole => {
    const normalized = key.trim().toLowerCase()
    if (sourceKeys.has(normalized)) return 'source'
    if (identityKeys.has(normalized)) return 'identity'
    return 'user'
  }
  return {
    kind,
    sourceKeys,
    identityKeys,
    roleOf,
    isReserved: (key) =>
      GLOBAL_RESERVED_KEYS.has(key.trim().toLowerCase()) || roleOf(key) !== 'user'
  }
}

const OWNERSHIP: Record<FrontmatterDocumentKind, FrontmatterOwnership> = {
  conversation: ownership('conversation', CONVERSATION_SOURCE_KEYS, CONVERSATION_IDENTITY_KEYS),
  mindmap: ownership('mindmap', MINDMAP_SOURCE_KEYS, MINDMAP_IDENTITY_KEYS),
  plain: ownership('plain', EMPTY_KEYS, EMPTY_KEYS)
}

export function getFrontmatterOwnership(kind: FrontmatterDocumentKind): FrontmatterOwnership {
  return OWNERSHIP[kind]
}

/**
 * 导图文件以扩展名为准；会话文档以 source_kind 为准。没有显式类型标记的
 * 普通笔记即使带 source/platform，也仍然按用户字段处理。
 */
export function resolveFrontmatterDocumentKind(
  frontmatter: string | null,
  filePath?: string | null
): FrontmatterDocumentKind {
  if (filePath && /\.mindmap\.md$/i.test(filePath)) return 'mindmap'
  if (!frontmatter) return 'plain'
  const block = frontmatter.match(/^---[ \t]*\r?\n([\s\S]*?)\r?\n---/)
  if (!block) return 'plain'
  const raw = block[1].match(/^source_kind\s*:\s*(.*)$/im)?.[1]?.trim() ?? ''
  const kind = raw.replace(/^["']|["']$/g, '').toLowerCase()
  return kind === 'conversation' ? 'conversation' : 'plain'
}

