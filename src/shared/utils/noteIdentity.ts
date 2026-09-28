/** 同一会话在 SPA 导航、查询参数和 Webview 重建后保持相同分组键。 */
export function noteConversationKey(url: string, title: string): string {
  const parsed = new URL(url)
  const path = parsed.pathname.replace(/\/$/, '') || '/'
  const stable = path.match(/\/(?:c|chat|app|search|thread|conversation)\/[^/]+/i)
  if (stable) return `${parsed.origin}${stable[0]}`
  const id = parsed.searchParams.get('conversation_id') || parsed.searchParams.get('conversationId') || parsed.searchParams.get('chatId')
  if (id) return `${parsed.origin}/conversation/${id}`
  if (path !== '/') return `${parsed.origin}${path}`
  const cleanedTitle = title.replace(/\s*[-–|]\s*(ChatGPT|Claude|Gemini|Grok|豆包).*$/i, '').trim().toLowerCase()
  if (cleanedTitle && !/^(chatgpt|claude|gemini|grok|豆包|new chat|新对话)$/.test(cleanedTitle)) {
    return `${parsed.origin}/title/${encodeURIComponent(cleanedTitle)}`
  }
  return `${parsed.origin}${path}${parsed.search}`
}
