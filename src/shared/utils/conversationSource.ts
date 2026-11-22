import { noteConversationKey } from './noteIdentity'
import { looksLikeConversationTranscript } from './noteTranscript'

export interface ConversationSourceInfo {
  sourceKey: string
  url: string
  title: string
  platform: string
}

const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---\s*(?:\r?\n|$)/

const unquote = (value: string): string => {
  const trimmed = value.trim()
  if (trimmed.length >= 2 && trimmed.startsWith('"') && trimmed.endsWith('"')) {
    return trimmed.slice(1, -1).replace(/\\(["\\])/g, '$1')
  }
  return trimmed
}

/**
 * 从文档 frontmatter 读取会话来源。
 * 新格式用 `source_key + source_url`；旧格式 `source: https://...` 继续按 URL 等价处理。
 * 没有可用来源时返回 null，界面据此隐藏“原文”动作。
 */
export function readConversationSource(markdown: string): ConversationSourceInfo | null {
  const match = markdown.match(FRONTMATTER_RE)
  if (!match) return null
  const fields: Record<string, string> = {}
  for (const line of match[1].split('\n')) {
    const item = line.match(/^([A-Za-z_][\w-]*)\s*:\s*(.*)$/)
    if (!item) continue
    fields[item[1].toLowerCase()] = unquote(item[2])
  }
  // 显式标成普通文档后，source 只是普通属性，不再产生会话关联
  // （原文入口、原文标注）。没有类型标记的文档只有正文确为完整对话时
  // 才按来源推断，避免单条回复摘录被当成整段会话。
  const declaredKind = (fields.source_kind || '').trim().toLowerCase()
  if (declaredKind && declaredKind !== 'conversation') return null
  if (!declaredKind && !looksLikeConversationTranscript(markdown.slice(match[0].length))) {
    return null
  }
  const title = fields.title || ''
  const platform = fields.platform || ''
  const key = fields.source_key || ''
  const url = fields.source_url || fields.source || (/^https:\/\//i.test(key) ? key : '')
  // source_key 是创建时算好的会话身份，能保留就保留（根路径会话依赖标题，
  // 仅凭地址无法重新算出同一个键）。只有它本身是地址、且与当前 source
  // 指向不同会话时，才说明用户改过链接，此时按新地址重新计算。
  let sourceKey = key
  if (url) {
    try {
      const urlKey = noteConversationKey(url, title)
      if (!key) {
        sourceKey = urlKey
      } else if (/^https:\/\//i.test(key)) {
        const keyKey = noteConversationKey(key, title)
        if (keyKey !== urlKey) sourceKey = urlKey
      }
    } catch {
      if (!key) sourceKey = ''
    }
  }
  if (!sourceKey) return null
  return { sourceKey, url, title, platform }
}
