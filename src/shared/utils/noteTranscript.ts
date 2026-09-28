export interface SnapshotBlock {
  type: 'user' | 'assistant' | 'markdown'
  time?: string
  content: string
  startLine: number
}

const isUserHeadingOrLabel = (line: string): boolean => {
  const trimmed = line.trim()
  if (/^#{1,4}\s*(?:\*\*)?(?:你说|用户|我|User|Human|You said)(?:\*\*)?\s*[:：]?\s*$/i.test(trimmed)) return true
  if (/^(?:\*\*)?(?:你说|用户|User|Human|You said)(?:\*\*)?\s*[:：]\s*(.*)$/i.test(trimmed)) return true
  return false
}

const isAssistantHeadingOrLabel = (line: string): boolean => {
  const trimmed = line.trim()
  if (/^#{1,4}\s*(?:\*\*)?(?:ChatGPT|Claude|Gemini|Grok|豆包|DeepSeek|Kimi|千问|元宝|智谱清言|文心一言|Perplexity|AI|助手|Assistant)(?:\s*说|\s*said)?(?:\*\*)?\s*[:：]?\s*$/i.test(trimmed)) return true
  if (/^(?:\*\*)?(?:ChatGPT|Claude|Gemini|Grok|豆包|DeepSeek|Kimi|千问|元宝|智谱清言|文心一言|Perplexity|AI|助手|Assistant)(?:\s*说|\s*said)(?:\*\*)?\s*[:：]\s*(.*)$/i.test(trimmed)) return true
  if (/^#{1,4}\s*AI\s*回复\s*$/i.test(trimmed)) return true
  return false
}

/** 整理对话文本，用 <user time="..."> 和 <assistant> XML 标签隔离用户提问与 AI 回复。 */
export function normalizeNoteTranscriptMarkdown(snapshot: string): string {
  if (!snapshot || !snapshot.trim()) return ''

  // 若已包含 <user> 与 <assistant> 标签，直接标准化换行后返回
  if (/<user[\s>]/.test(snapshot) && /<\/user>/.test(snapshot)) {
    return snapshot.replace(/\r\n?/g, '\n').replace(/\n{3,}/g, '\n\n').trim()
  }

  const lines = snapshot.replace(/\r\n?/g, '\n').split('\n')
  const timeRegex = /^(?:昨天|今天|\d{4}[-/.]\d{1,2}[-/.]\d{1,2}|\d{1,2}[-/.]\d{1,2})?\s*\d{1,2}:\d{2}(?::\d{2})?\s*$/

  const hasUser = lines.some(l => isUserHeadingOrLabel(l))
  if (!hasUser) {
    // 兼容历史老版本可能存在的 "# 问题" 与 "## AI 回复" 结构
    const aiIndex = lines.findIndex(l => /^#{1,4}\s*AI\s*回复\s*$/i.test(l.trim()))
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
    if (!body) return
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
      const userMatch = /^(?:\*\*)?(?:你说|用户|User|Human|You said)(?:\*\*)?\s*[:：]\s*(.+)$/i.exec(trimmed)
      if (userMatch && userMatch[1]) content.push(userMatch[1].trim())
      i++
      continue
    }

    if (isAssistantHeadingOrLabel(line)) {
      flush()
      role = 'assistant'
      const aiMatch = /^(?:\*\*)?(?:ChatGPT|Claude|Gemini|Grok|豆包|DeepSeek|Kimi|千问|元宝|智谱清言|文心一言|Perplexity|AI|助手|Assistant)(?:\s*说|\s*said)?(?:\*\*)?\s*[:：]\s*(.+)$/i.exec(trimmed)
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

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const trimmed = line.trim()

    const userOpenMatch = /^<user(?:\s+time=["']([^"']*)["'])?\s*>$/i.exec(trimmed)
    if (userOpenMatch) {
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

    if (/^<\/user>$/i.test(trimmed)) {
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

    if (/^<assistant>$/i.test(trimmed)) {
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

    if (/^<\/assistant>$/i.test(trimmed)) {
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
