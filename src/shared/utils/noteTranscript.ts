export interface SnapshotBlock {
  type: 'user' | 'assistant' | 'markdown'
  time?: string
  content: string
  startLine: number
}

const USER_MARKER_HEADING_RE =
  /^#{1,6}\s*(?:\*\*)?(?:你说|你|用户|User|Human|You said|问题|用户问题)(?:\*\*)?\s*[:：]?\s*$/i
const USER_MARKER_INLINE_RE =
  /^(?:\*\*)?(?:你说|用户|User|Human|You said)(?:\*\*)?\s*[:：]/i
const ASSISTANT_MARKER_HEADING_RE =
  /^#{1,6}\s*(?:\*\*)?(?:ChatGPT|Claude|Gemini|Grok|豆包|DeepSeek|Kimi|千问|元宝|智谱清言|文心一言|Perplexity|AI|助手|Assistant|AI\s*回复)(?:\s*说|\s*said)?(?:\*\*)?\s*[:：]?\s*$/i
const ASSISTANT_MARKER_INLINE_RE =
  /^(?:\*\*)?(?:ChatGPT|Claude|Gemini|Grok|豆包|DeepSeek|Kimi|千问|元宝|智谱清言|文心一言|Perplexity|AI|助手|Assistant)(?:\s*说|\s*said)(?:\*\*)?\s*[:：]/i

/**
 * 判断正文是否像一份完整会话记录，而不是单条回复摘录。
 * 完整会话至少应出现用户轮次，并在其后出现助手轮次；只有助手内容的
 * 回复摘录、普通笔记和代码块中的示例都不算会话记录。
 */
export function looksLikeConversationTranscript(markdown: string): boolean {
  if (!markdown.trim()) return false
  let fence: string | null = null
  let userIndex = -1
  let assistantIndex = -1
  const lines = markdown.split(/\r?\n/)

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const fenceMatch = /^ {0,3}(`{3,}|~{3,})/.exec(line)
    if (fenceMatch) {
      const marker = fenceMatch[1][0]
      if (!fence) fence = marker
      else if (fence === marker) fence = null
      continue
    }
    if (fence) continue

    const trimmed = line.trim()
    if (userIndex < 0) {
      if (
        /^<user(?:\s+time=["'][^"']*["'])?\s*>$/i.test(trimmed) ||
        USER_MARKER_HEADING_RE.test(trimmed) ||
        USER_MARKER_INLINE_RE.test(trimmed)
      ) {
        userIndex = i
      }
    }
    if (userIndex < 0) continue
    if (
      /^<assistant>$/i.test(trimmed) ||
      ASSISTANT_MARKER_HEADING_RE.test(trimmed) ||
      ASSISTANT_MARKER_INLINE_RE.test(trimmed)
    ) {
      assistantIndex = i
      break
    }
    // 兼容未知平台的「## 平台：」标题；只在用户轮次之后才算助手轮次。
    if (/^#{1,6}\s+\S.*[：:]\s*$/.test(trimmed)) {
      const label = trimmed.replace(/^#{1,6}\s+/, '').replace(/[：:]\s*$/, '').trim()
      if (!/^(?:你说|你|用户|User|Human|You said|问题|用户问题)$/i.test(label)) {
        assistantIndex = i
        break
      }
    }
  }

  return userIndex >= 0 && assistantIndex > userIndex
}

/** 去掉文件开头的 frontmatter，只保留正文；没有 frontmatter 时原样返回。 */
export function stripFrontmatter(markdown: string): string {
  const match = markdown.match(/^---[ \t]*\r?\n[\s\S]*?\r?\n---[ \t]*(?:\r?\n|$)/)
  return match ? markdown.slice(match[0].length) : markdown
}

const isUserHeadingOrLabel = (line: string): boolean => {
  const trimmed = line.trim()
  if (/^(?:#{1,6}\s*)?(?:\*\*)?(?:你说|你|用户|我|User|Human|You said)(?:\*\*)?\s*[:：]?\s*$/i.test(trimmed)) return true
  if (/^(?:\*\*)?(?:你说|你|用户|User|Human|You said)(?:\*\*)?\s*[:：]\s*(.*)$/i.test(trimmed)) return true
  return false
}

const isAssistantHeadingOrLabel = (line: string): boolean => {
  const trimmed = line.trim()
  if (/^#{1,6}\s*(?:\*\*)?(?:ChatGPT|Claude|Gemini|Grok|豆包|DeepSeek|Kimi|千问|元宝|智谱清言|文心一言|Perplexity|AI|助手|Assistant)(?:\s*说|\s*said)?(?:\*\*)?\s*[:：]?\s*$/i.test(trimmed)) return true
  if (/^(?:\*\*)?(?:ChatGPT|Claude|Gemini|Grok|豆包|DeepSeek|Kimi|千问|元宝|智谱清言|文心一言|Perplexity|AI|助手|Assistant)(?:\s*说|\s*said)(?:\*\*)?\s*[:：]?\s*$/i.test(trimmed)) return true
  if (/^(?:\*\*)?(?:ChatGPT|Claude|Gemini|Grok|豆包|DeepSeek|Kimi|千问|元宝|智谱清言|文心一言|Perplexity|AI|助手|Assistant)(?:\s*说|\s*said)?(?:\*\*)?\s*[:：]\s*(.*)$/i.test(trimmed)) return true
  if (/^#{1,6}\s*AI\s*回复\s*$/i.test(trimmed)) return true
  return false
}

/** 整理对话文本，用 <user time="..."> 和 <assistant> XML 标签隔离用户提问与 AI 回复。 */
export function normalizeNoteTranscriptMarkdown(snapshot: string): string {
  if (!snapshot || !snapshot.trim()) return ''

  snapshot = snapshot.replace(/\r\n?/g, '\n')

  // 已有角色标签时保留正文的空白和代码格式，也支持只有一种角色的快照。
  if (/^<(user(?:\s+time=["'][^"']*["'])?|assistant)>$/m.test(snapshot)) {
    return snapshot.trim()
  }

  const lines = snapshot.replace(/\r\n?/g, '\n').split('\n')
  const timeRegex = /^(?:昨天|今天|\d{4}[-/.]\d{1,2}[-/.]\d{1,2}|\d{1,2}[-/.]\d{1,2})?\s*\d{1,2}:\d{2}(?::\d{2})?\s*$/

  const hasUser = lines.some(l => isUserHeadingOrLabel(l))
  if (!hasUser) {
    // 兼容历史老版本可能存在的 "# 问题" 与 "## AI 回复" 结构
    const aiIndex = lines.findIndex(l => /^#{1,6}\s*AI\s*回复\s*$/i.test(l.trim()))
    if (aiIndex > 0 && lines.some(l => /^#\s+[^#]/.test(l.trim()))) {
      const userParts = lines.slice(0, aiIndex).filter(l => !/^-{3,}$/.test(l.trim()))
      const aiParts = lines.slice(aiIndex + 1)
      const userText = userParts.join('\n').replace(/^#\s+/gm, '').trim()
      const aiText = aiParts.join('\n').trim()
      return `<user>\n${userText}\n</user>\n\n<assistant>\n${aiText}\n</assistant>`
    }
    return snapshot.trim()
  }

  const output: string[] = []
  let role: 'user' | 'assistant' | null = null
  let content: string[] = []
  let timeStr = ''

  const flush = (): void => {
    if (!role) return
    const body = content.join('\n').trim()
    if (!body) { content = []; return }
    if (role === 'user') {
      const timeAttr = timeStr ? ` time="${timeStr}"` : ''
      output.push(`<user${timeAttr}>\n${body}\n</user>`)
    } else if (role === 'assistant') {
      output.push(`<assistant>\n${body}\n</assistant>`)
    }
    content = []
    timeStr = ''
  }

  let i = 0
  if (/^#{1,2}\s*对话内容\s*$/.test(lines[0]?.trim() || '')) i = 1

  while (i < lines.length) {
    const line = lines[i]
    const trimmed = line.trim()

    // 检查是否为提问前一行的时间戳
    if (timeRegex.test(trimmed) && i + 1 < lines.length && isUserHeadingOrLabel(lines[i + 1])) {
      flush()
      timeStr = trimmed
      i++
      continue
    }

    if (isUserHeadingOrLabel(line)) {
      flush()
      role = 'user'
      const userMatch = /^(?:\*\*)?(?:你说|你|用户|User|Human|You said)(?:\*\*)?\s*[:：]\s*(.+)$/i.exec(trimmed)
      if (userMatch && userMatch[1]) content.push(userMatch[1].trim())
      i++
      continue
    }

    if (isAssistantHeadingOrLabel(line)) {
      flush()
      role = 'assistant'
      const aiMatch = /^(?:\*\*)?(?:ChatGPT|Claude|Gemini|Grok|豆包|DeepSeek|Kimi|千问|元宝|智谱清言|文心一言|Perplexity|AI|助手|Assistant)(?:\s*说|\s*said)?(?:\*\*)?\s*[:：]\s*(.*)$/i.exec(trimmed)
      if (aiMatch && aiMatch[1]) content.push(aiMatch[1].trim())
      i++
      continue
    }

    content.push(line)
    i++
  }
  flush()

  return output.join('\n\n').trim()
}

/** 解析包含 <user> 和 <assistant> XML 标签的快照为结构化块，保留原行号 */
export function parseSnapshotBlocks(markdown: string): SnapshotBlock[] {
  const lines = markdown.split('\n')
  const blocks: SnapshotBlock[] = []
  let currentBlock: {
    type: 'user' | 'assistant' | 'markdown'
    time?: string
    contentLines: string[]
    startLine: number
  } | null = null

  let inTag: 'user' | 'assistant' | null = null
  let fence: { marker: string; length: number } | null = null

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const trimmed = line.trim()
    const fenceMatch = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line)
    const inCode = fence !== null || fenceMatch !== null
    if (fenceMatch) {
      const marker = fenceMatch[1]
      if (!fence) fence = { marker: marker[0], length: marker.length }
      else if (marker[0] === fence.marker && marker.length >= fence.length && !fenceMatch[2].trim()) fence = null
    }

    const userOpenMatch = /^<user(?:\s+time=["']([^"']*)["'])?\s*>$/i.exec(trimmed)
    if (!inCode && userOpenMatch) {
      if (currentBlock && currentBlock.contentLines.some(l => l.trim())) {
        blocks.push({
          type: currentBlock.type,
          time: currentBlock.time,
          content: currentBlock.contentLines.join('\n'),
          startLine: currentBlock.startLine
        })
      }
      inTag = 'user'
      currentBlock = {
        type: 'user',
        time: userOpenMatch[1]?.trim() || undefined,
        contentLines: [],
        startLine: i + 2
      }
      continue
    }

    if (!inCode && /^<\/user>$/i.test(trimmed)) {
      if (currentBlock && inTag === 'user') {
        blocks.push({
          type: 'user',
          time: currentBlock.time,
          content: currentBlock.contentLines.join('\n'),
          startLine: currentBlock.startLine
        })
        currentBlock = null
      }
      inTag = null
      continue
    }

    if (!inCode && /^<assistant>$/i.test(trimmed)) {
      if (currentBlock && currentBlock.contentLines.some(l => l.trim())) {
        blocks.push({
          type: currentBlock.type,
          time: currentBlock.time,
          content: currentBlock.contentLines.join('\n'),
          startLine: currentBlock.startLine
        })
      }
      inTag = 'assistant'
      currentBlock = {
        type: 'assistant',
        contentLines: [],
        startLine: i + 2
      }
      continue
    }

    if (!inCode && /^<\/assistant>$/i.test(trimmed)) {
      if (currentBlock && inTag === 'assistant') {
        blocks.push({
          type: 'assistant',
          content: currentBlock.contentLines.join('\n'),
          startLine: currentBlock.startLine
        })
        currentBlock = null
      }
      inTag = null
      continue
    }

    if (!currentBlock) {
      currentBlock = {
        type: 'markdown',
        contentLines: [line],
        startLine: i + 1
      }
    } else {
      currentBlock.contentLines.push(line)
    }
  }

  if (currentBlock && currentBlock.contentLines.some(l => l.trim())) {
    blocks.push({
      type: currentBlock.type,
      time: currentBlock.time,
      content: currentBlock.contentLines.join('\n'),
      startLine: currentBlock.startLine
    })
  }

  if (blocks.length === 0) {
    return [{ type: 'markdown', content: markdown, startLine: 1 }]
  }

  return blocks
}

/**
 * 把内部 <user>/<assistant> 快照转成标准 Markdown。
 * 会话文档的正文必须走这里，不能直接把 XML 标签交给 Lexical。
 */
export function snapshotToDocumentMarkdown(
  snapshot: string,
  platform: string,
  title: string
): string {
  const safePlatform = (platform || 'AI').trim()
  const safeTitle = (title || '未命名会话').trim()
  const blocks = parseSnapshotBlocks(normalizeNoteTranscriptMarkdown(snapshot || ''))
    .filter(block => block.content.trim())
  const lines: string[] = [`# ${safePlatform} - ${safeTitle}`]
  let lastRole: SnapshotBlock['type'] | null = null
  for (const block of blocks) {
    const role = block.type === 'user' ? 'user' : block.type === 'assistant' ? 'assistant' : 'markdown'
    if (role === 'markdown') {
      lines.push('', block.content.trim())
      lastRole = role
      continue
    }
    if (lastRole !== role) {
      lines.push('', `## ${role === 'user' ? '你' : safePlatform}：`)
    }
    lines.push('', block.content.trim())
    lastRole = role
  }
  return `${lines.join('\n').trim()}\n`
}
