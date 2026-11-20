import { defaultSelectors } from '../../../shared/config/selectors'
import { isConversationUrlForPlatform } from '../../../shared/utils/conversationUrl'

export interface SourceConversationTarget {
  platformId: string
  url: string
}

/**
 * 把笔记 frontmatter 里的来源链接解析成「平台 + 会话页」。
 * 只有链接确实属于某个已配置平台的会话页时才返回结果：
 * - 链接被改写成首页、文档或其它站点时返回 null，调用方不展示入口；
 * - 平台基准地址优先用选择器里的 newConversationUrl，再回退模型配置的 url，
 *   兼容 kimi 这类配置域名与当前站点域名不同的情况。
 */
export function resolveSourceConversation(
  rawUrl: string,
  models: Array<{ id: string; url: string }>
): SourceConversationTarget | null {
  const value = rawUrl.trim()
  if (!value) return null

  let parsed: URL
  try {
    parsed = new URL(value)
  } catch {
    return null
  }
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password) return null

  for (const model of models) {
    const baseUrls = [defaultSelectors.models[model.id]?.newConversationUrl, model.url]
    if (
      baseUrls.some(
        (baseUrl) => !!baseUrl && isConversationUrlForPlatform(model.id, parsed.href, baseUrl)
      )
    ) {
      return { platformId: model.id, url: parsed.href }
    }
  }
  return null
}
