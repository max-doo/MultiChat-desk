/** 整理新捕获的对话文本，让用户问题成为一级标题、AI 回复成为二级标题。 */
export function normalizeNoteTranscriptMarkdown(snapshot: string): string {
  const lines = snapshot.replace(/\r\n?/g, '\n').split('\n')
  const output: string[] = []
  let index = 0
  if (/^#{1,2}\s*对话内容\s*$/.test(lines[0]?.trim() || '')) index = 1

  const userLabel = /^(?:你说|用户|User|Human|You said)\s*[:：]\s*(.*)$/i
  const assistantLabel = /^(?:ChatGPT|Claude|Gemini|Grok|豆包|DeepSeek|Kimi|千问|元宝|智谱清言|文心一言|Perplexity|AI|助手)(?:\s*说|\s*said)?\s*[:：]\s*(.*)$/i
  const labelText = (line: string): string => line.trim().replace(/^\*\*(.+)\*\*$/, '$1').trim()
  if (!lines.some(line => userLabel.test(labelText(line))) && lines.some(line => /^# [^#]/.test(line.trim()) && !/^# 对话内容\s*$/.test(line.trim()))) {
    return lines.slice(index).join('\n').trim()
  }
  const flush = (role: 'user' | 'assistant' | null, content: string[]): void => {
    if (!role) { output.push(...content); return }
    const body = content.join('\n').trim()
    if (!body) return
    if (role === 'assistant') {
      output.push('## AI 回复', '', body.replace(/^# (.+)$/gm, '## $1'), '')
      return
    }
    const parts = body.split('\n')
    const first = parts.findIndex(line => line.trim())
    if (first < 0) return
    const question = parts[first].trim().replace(/^#+\s*/, '')
    parts.splice(first, 1)
    output.push(`# ${question}`, '')
    if (parts.join('\n').trim()) output.push(parts.join('\n').trim(), '')
  }

  let role: 'user' | 'assistant' | null = null
  let content: string[] = []
  for (; index < lines.length; index++) {
    const line = lines[index]
    const trimmed = labelText(line)
    const user = userLabel.exec(trimmed)
    const assistant = assistantLabel.exec(trimmed)
    if (user || assistant) {
      flush(role, content)
      role = user ? 'user' : 'assistant'
      content = []
      const inline = user?.[1] || assistant?.[1]
      if (inline) content.push(inline)
    } else {
      content.push(line)
    }
  }
  flush(role, content)
  return output.join('\n').replace(/\n{3,}/g, '\n\n').trim()
}
