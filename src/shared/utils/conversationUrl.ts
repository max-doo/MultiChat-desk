/**
 * 平台会话 URL 判定与规范化。
 * 合并两处既有规则：
 * - MindmapService.sessionBinding（origin + 会话路径/参数 + new/login/auth/temporary 排除）
 * - appStore.isSavableSessionUrl（gemini 特殊路径与各平台新建对话页排除）
 * 渲染层（appStore）与主进程（MindmapService/AgentTaskService）共用。
 */

const CONVERSATION_PATH = /\/(?:c|chat|app|search|thread|conversation|session|s)\/[^/]+/i
const CONVERSATION_QUERY_KEYS = ['conversation_id', 'conversationId', 'chatId']
const EXCLUDED_SEGMENT = /\/(?:new|login|auth|temporary)(?:\/|$)/i
const EXCLUDED_EXACT_PATHS = new Set(['/new', '/chat', '/app', '/main/alltoolsdetail'])
/** 各平台"新建对话落地页"专属后缀（通用排除之外的补充）。 */
const PLATFORM_NEW_PAGE_SUFFIXES: Record<string, string> = {
  claude: '/new',
  doubao: '/chat',
  yuanbao: '/chat',
  chatglm: '/alltoolsdetail'
}
/**
 * 各平台已知的会话页路径。用于“来源会话入口”这类需要高准确率的 UI 判定：
 * 通用 CONVERSATION_PATH 只校验路径中出现会话段，平台站内的设置、搜索等页面
 * 也可能命中，不能直接拿来决定是否展示“打开会话”入口。
 */
const PLATFORM_CONVERSATION_PATH: Record<string, RegExp> = {
  chatgpt: /^\/(?:c|g\/[^/]+\/c)\/[^/]+\/?$/i,
  claude: /^\/chat\/[^/]+\/?$/i,
  gemini: /^\/(?:app\/[^/]+|u\/[^/]+\/app\/[^/]+)\/?$/i,
  grok: /^\/c\/[^/]+\/?$/i,
  perplexity: /^\/search\/[^/]+\/?$/i,
  doubao: /^\/chat\/[^/]+\/?$/i,
  yuanbao: /^\/chat\/[^/]+\/?$/i,
  qwen: /^\/chat\/[^/]+\/?$/i,
  kimi: /^\/chat\/[^/]+\/?$/i,
  deepseek: /^\/a\/chat\/s\/[^/]+\/?$/i,
  arena: /^\/c\/[^/]+\/?$/i,
  yiyan: /^\/chat\/[^/]+\/?$/i
}
/**
 * 少数平台把会话 ID 放在 query 上；仅对明确平台启用，避免首页参数误判。
 * 新增平台时先用真实会话页核实参数名，未确认前不要猜测加入。
 */
const PLATFORM_CONVERSATION_QUERY_KEYS: Record<string, string[]> = {
  yiyan: ['conversation_id', 'conversationId', 'chatId']
}
/** 兼容 sign_in / sign-in / log_in 等带分隔符写法（deepseek 落在 /sign_in）。 */
const AUTH_WALL_SEGMENT = /\/(?:log[-_]?in|sign[-_]?in|sign[-_]?up|auth)(?:\/|$)/i
/** 跨 origin 跳转时，仅知名鉴权主机判登录墙（如 accounts.google.com），避免误伤正常站内跳转。 */
const AUTH_WALL_HOST = /^(?:accounts|login|auth|signin|sso|passport)\./i

function isGeminiConversationUrl(url: URL): boolean {
  const parts = url.pathname.split('/').filter(Boolean)
  if (parts[0] === 'app' && typeof parts[1] === 'string' && parts[1].length > 0) return true
  if (parts[0] === 'u' && parts[2] === 'app' && typeof parts[3] === 'string' && parts[3].length > 0) return true
  return false
}

function canonicalGeminiConversationUrl(url: URL): string {
  const parts = url.pathname.split('/').filter(Boolean)
  let conversationId: string | undefined
  if (parts[0] === 'app') conversationId = parts[1]
  else if (parts[0] === 'u' && parts[2] === 'app') conversationId = parts[3]
  return conversationId ? `https://gemini.google.com/app/${conversationId}` : ''
}

/**
 * 判定 url 是否属于 platformId 平台的具体会话页（非首页/登录页/新建页）。
 * @param baseUrl 平台基准地址（newConversationUrl 或平台默认 URL），用于 origin 归属校验
 */
export function isConversationUrlForPlatform(platformId: string, url: string, baseUrl: string): boolean {
  if (!url || url === 'about:blank') return false
  try {
    const target = new URL(url)
    const base = new URL(baseUrl)
    if (target.protocol !== 'https:' || target.username || target.password) return false
    if (target.origin !== base.origin) return false
    if (platformId === 'gemini') return isGeminiConversationUrl(target)
    if (EXCLUDED_SEGMENT.test(target.pathname)) return false

    // 会话 ID 在 query 上的平台（如 ?chatId=x）不受路径形态约束——与旧 sessionBinding 等价
    if (CONVERSATION_QUERY_KEYS.some(key => !!target.searchParams.get(key))) return true

    const cleanPath = target.pathname.replace(/\/+$/, '')
    if (!cleanPath) return false
    if (EXCLUDED_EXACT_PATHS.has(cleanPath)) return false
    const newPageSuffix = PLATFORM_NEW_PAGE_SUFFIXES[platformId]
    if (newPageSuffix && cleanPath.endsWith(newPageSuffix)) return false

    return CONVERSATION_PATH.test(target.pathname)
  } catch {
    return false
  }
}

/**
 * 严格判定某个 URL 是否是该平台的具体会话页。
 *
 * 与 isConversationUrlForPlatform 的区别：
 * - 后者服务自动化恢复，允许通用会话路径，覆盖尚未逐一枚举的平台；
 * - 本函数服务“是否显示来源会话入口”，只接受已确认的平台会话路径或会话 ID 参数。
 *   同域名下的设置页、搜索页、文档页等不会被误判为会话。
 */
export function isPlatformConversationPage(
  platformId: string,
  url: string,
  baseUrl: string
): boolean {
  if (!url || url === 'about:blank') return false
  try {
    const target = new URL(url)
    const base = new URL(baseUrl)
    if (target.protocol !== 'https:' || target.username || target.password) return false
    if (target.origin !== base.origin) return false
    if (EXCLUDED_SEGMENT.test(target.pathname)) return false

    if (platformId === 'gemini') return isGeminiConversationUrl(target)

    const queryKeys = PLATFORM_CONVERSATION_QUERY_KEYS[platformId]
    if (queryKeys?.some((key) => !!target.searchParams.get(key))) return true

    const cleanPath = target.pathname.replace(/\/+$/, '') || '/'
    if (EXCLUDED_EXACT_PATHS.has(cleanPath)) return false
    const newPageSuffix = PLATFORM_NEW_PAGE_SUFFIXES[platformId]
    if (newPageSuffix && cleanPath.endsWith(newPageSuffix)) return false

    const pathPattern = PLATFORM_CONVERSATION_PATH[platformId]
    return !!pathPattern && pathPattern.test(target.pathname)
  } catch {
    return false
  }
}

/** 规范化会话 URL：gemini 归一到 /app/{id}，其余返回解析后的完整 href（含必要 query）。 */
export function canonicalizeConversationUrl(platformId: string, url: string): string {
  try {
    const parsed = new URL(url)
    if (platformId === 'gemini') return canonicalGeminiConversationUrl(parsed) || parsed.href
    return parsed.href
  } catch {
    return url
  }
}

/** 判定页面是否跳转到登录/鉴权墙（路径含 login/auth/signin，或跨 origin 至知名鉴权主机）。 */
export function isAuthWallUrl(url: string, baseUrl: string): boolean {
  if (!url || url === 'about:blank') return false
  try {
    const target = new URL(url)
    const base = new URL(baseUrl)
    if (AUTH_WALL_SEGMENT.test(target.pathname)) return true
    return target.origin !== base.origin && AUTH_WALL_HOST.test(target.hostname)
  } catch {
    return false
  }
}
