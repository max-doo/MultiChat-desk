import { agentTaskService } from './AgentTaskService'
import type { AgentToolResult } from '@earendil-works/pi-coding-agent'
import {
  AGENT_TASK_DEFAULT_TIMEOUT_MS,
  AGENT_TASK_MAX_TIMEOUT_MS,
  AGENT_TASK_RESEARCH_TIMEOUT_MS,
  isAgentTaskTerminal,
  type AgentTaskView
} from '../../shared/types/agentTask'

interface WebSearchParams {
  query: string
  platform?: string
  research?: boolean
  timeout_sec?: number
}

const importEsm = new Function('s', 'return import(s)') as <T>(s: string) => Promise<T>

/**
 * 工作台 Agent 的 web_search 工具定义。
 * pi 内核与 typebox 都经运行时动态 import（`new Function` 逃逸 bundler 解析），
 * 与 AgentSessionService.getPi()/ShellTool.resolveShell() 同一模式。
 * 每次会话创建时调用 createWebSearchTool() 取一个新的 ToolDefinition。
 */
export async function createWebSearchTool() {
  const { defineTool } = await importEsm<typeof import('@earendil-works/pi-coding-agent')>(
    '@earendil-works/pi-coding-agent'
  )
  // typebox 是 pi 的传递依赖；运行时经 Node 解析，TS 侧无类型声明可用。
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { Type } = await importEsm<{ Type: any }>('typebox')

  const PLATFORM_IDS = [
    'auto',
    'chatgpt',
    'gemini',
    'claude',
    'deepseek',
    'grok',
    'qwen',
    'kimi',
    'doubao',
    'perplexity',
    'chatglm',
    'yiyan',
    'yuanbao',
    'arena'
  ] as const

  const SEARCH_PROMPT = (q: string) =>
    `请使用联网搜索功能，搜索以下关键词并提供最新、准确的信息。\n\n` +
    `搜索关键词：${q}\n\n` +
    `要求：\n` +
    `1. 给出结论摘要，直接回答问题。\n` +
    `2. 每个关键事实必须附上原始来源链接（完整 URL），不要使用二手转载。\n` +
    `3. 标注关键信息的发布时间或时效性。\n` +
    `4. 如果不同来源说法冲突，列出分歧点。\n` +
    `5. 用 Markdown 格式回复。`

  const POLL_INTERVAL_MS = 2_000

  /** platform=auto 时挑一个已登录且有深度研究能力的平台；research=false 时放宽到仅已登录。 */
  async function resolvePlatform(requested: string, research: boolean): Promise<string> {
    if (requested !== 'auto') return requested
    const caps = await agentTaskService.capabilities()
    const signedIn = caps.filter((c) => c.signedIn === true)
    const usable = signedIn.filter((c) => !research || c.deepResearch)
    // 偏好带 busySignal 适配的平台，回复完成判定更可靠。
    usable.sort((a, b) => (a.busySignal === 'adapted' ? 0 : 1) - (b.busySignal === 'adapted' ? 0 : 1))
    const pick = usable[0]
    if (!pick) {
      throw new Error(
        signedIn.length === 0
          ? '没有已登录的可用平台，请先在 MultiChat 中登录至少一个 AI 平台'
          : 'research=true 需要已登录的深度研究适配平台（如 chatgpt/gemini/claude），请在 MultiChat 中登录后重试'
      )
    }
    return pick.id
  }

  function extractSources(markdown: string): string[] {
    const urls = new Set<string>()
    for (const m of markdown.matchAll(/\((https?:\/\/[^)\s]+)\)/g)) urls.add(m[1])
    for (const m of markdown.matchAll(/(?<![\w/])(https?:\/\/[^\s"'<>\]]+)/g)) urls.add(m[1])
    return [...urls].filter((u) => !/\.(png|jpe?g|gif|webp|svg|ico)($|\?)/i.test(u)).slice(0, 30)
  }

  async function waitTerminal(taskId: string, signal: AbortSignal | undefined): Promise<AgentTaskView> {
    for (;;) {
      if (signal?.aborted) {
        await agentTaskService.cancel(taskId).catch(() => null)
        throw new Error('web_search 已被取消')
      }
      const view = await agentTaskService.getView(taskId)
      if (!view) throw new Error(`任务不存在: ${taskId}`)
      if (isAgentTaskTerminal(view.phase)) return view
      await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS))
    }
  }

  return defineTool({
    name: 'web_search',
    label: 'Web Search',
    description:
      '通过 MultiChat 已登录的 AI 平台执行联网搜索，返回带来源链接的答案。' +
      '适用于需要最新/实时信息的查询；research=true 走深度研究模式（分钟级，产出长报告），' +
      'research=false 走普通联网问答（快，通常几十秒）。平台用 platform 参数指定，默认 auto 自动挑选已登录平台。',
    promptSnippet: 'search the live web via logged-in AI platforms, returns answers with source links',
    promptGuidelines: [
      'Use web_search when the user asks for current/recent information, facts that may have changed, or explicit web lookup.',
      'Prefer the default platform="auto"; only pin a platform when the user names one.',
      'research=true produces a long-form report (minutes); use it only when the user wants deep research, otherwise leave it off.',
      'The full reply is archived to the replyFile path; if the visible answer is truncated or later compressed away, re-read that file with shell/read tools.'
    ],
    parameters: Type.Object({
      query: Type.String({ description: '要搜索的关键词或问题' }),
      platform: Type.Optional(
        Type.Union(
          PLATFORM_IDS.map((id) => Type.Literal(id)) as unknown as [ReturnType<typeof Type.Literal>, ...ReturnType<typeof Type.Literal>[]],
          { description: '目标平台；auto 自动挑选已登录平台' }
        )
      ),
      research: Type.Optional(
        Type.Boolean({ description: 'true=深度研究模式（分钟级长报告）；false/缺省=普通联网问答（快）' })
      ),
      timeout_sec: Type.Optional(
        Type.Number({ description: '任务硬超时秒数，默认普通 600s / research 1800s', minimum: 30, maximum: AGENT_TASK_MAX_TIMEOUT_MS / 1000 })
      )
    }),
    outputSchema: Type.Object({
      answer: Type.String(),
      sources: Type.Array(Type.String()),
      platform: Type.String(),
      taskId: Type.Optional(Type.String()),
      replyFile: Type.Optional(Type.String()),
      conversationUrl: Type.Optional(Type.String())
    }),
    async execute(_toolCallId: string, params: WebSearchParams, signal: AbortSignal | undefined): Promise<AgentToolResult<Record<string, unknown>>> {
      const research = params.research === true
      const platform = await resolvePlatform(params.platform ?? 'auto', research)
      const timeoutMs = params.timeout_sec
        ? Math.round(params.timeout_sec * 1000)
        : research
          ? AGENT_TASK_RESEARCH_TIMEOUT_MS
          : AGENT_TASK_DEFAULT_TIMEOUT_MS

      const submit = await agentTaskService.submit({
        platform,
        query: SEARCH_PROMPT(params.query),
        mode: research ? 'deep_research' : 'chat',
        timeoutMs
      })
      if (!submit.success || !submit.data) {
        const msg = submit.error ?? 'submit failed'
        return {
          content: [{ type: 'text', text: `web_search 提交失败: ${msg}` }],
          details: { error: msg, code: submit.code },
          isError: true
        }
      }

      const view = await waitTerminal(submit.data.taskId, signal)
      if (view.phase !== 'done') {
        const msg = view.error ? `${view.error.code}: ${view.error.message}` : `任务终态=${view.phase}`
        return {
          content: [{ type: 'text', text: `web_search 未完成: ${msg}` }],
          details: { error: msg, taskId: view.taskId, phase: view.phase },
          isError: true
        }
      }

      // getView() 不带正文（replyChars 才有长度）；done 后 reply 在 getResult() 里。
      const result = await agentTaskService.getResult(view.taskId)
      const answer = result?.reply ?? ''
      const sources = extractSources(answer)
      // reply TXT 落盘在 persist() 内异步完成；轮询终态可能早一拍，短窗口兜底拿到 replyFile。
      let replyFile = result?.replyFile
      if (!replyFile) {
        for (let i = 0; i < 5 && !replyFile; i++) {
          await new Promise((r) => setTimeout(r, 200))
          replyFile = (await agentTaskService.getResult(view.taskId))?.replyFile
        }
      }
      const archiveNote = replyFile ? `\n\n[完整回复已存档: ${replyFile}]` : ''
      return {
        content: [{ type: 'text', text: answer + archiveNote }],
        details: { platform: view.platform, taskId: view.taskId, sources, ...(replyFile ? { replyFile } : {}) },
        structuredContent: {
          answer,
          sources,
          platform: view.platform,
          taskId: view.taskId,
          ...(replyFile ? { replyFile } : {}),
          ...(result?.conversationUrl ?? view.conversationUrl ? { conversationUrl: result?.conversationUrl ?? view.conversationUrl } : {})
        }
      }
    }
  })
}
