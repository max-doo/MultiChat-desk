import { noteConversationKey } from './noteIdentity'

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
  const url = fields.source_url || fields.source || ''
  const title = fields.title || ''
  const platform = fields.platform || ''
  const key = fields.source_key || ''
  let sourceKey = key
  // 只有 source_key 的文档同样可以投影 source 标注；url 仅用于原文回显。
  if (!sourceKey && /^https:\/\//i.test(url)) {
    try {
      sourceKey = noteConversationKey(url, title)
    } catch {
      return null
    }
  }
  if (!sourceKey) return null
  return { sourceKey, url, title, platform }
}
