import { agentTaskService } from './AgentTaskService'
import type { AgentToolResult } from '@earendil-works/pi-coding-agent'
import { join, resolve } from 'path'
import {
  AGENT_TASK_DEFAULT_TIMEOUT_MS,
  AGENT_TASK_MAX_TIMEOUT_MS,
  isAgentTaskTerminal,
  type AgentTaskView
} from '../../shared/types/agentTask'

interface ImageGenParams {
  prompt: string
  platform?: string
  timeout_sec?: number
  images?: string[]
}

const importEsm = new Function('s', 'return import(s)') as <T>(s: string) => Promise<T>

/**
 * 工作台 Agent 的 image_gen 工具定义。
 * 通过已登录的 AI 平台触发其原生"AI 生图"能力，等生成完成后由 AgentTaskService
 * 注入点击触发下载，落盘到 Agent 会话工作区的 `.multichat/image/`。
 * pi 内核与 typebox 都经运行时动态 import（`new Function` 逃逸 bundler 解析），
 * 与 webSearchTool / AgentSessionService.getPi() 同一模式。
 */
export async function createImageGenTool(workspaceCwd?: string) {
  const { defineTool } = await importEsm<typeof import('@earendil-works/pi-coding-agent')>(
    '@earendil-works/pi-coding-agent'
  )
  // typebox 是 pi 的传递依赖；运行时经 Node 解析，TS 侧无类型声明可用。
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { Type } = await importEsm<{ Type: any }>('typebox')

  // 仅列出 imageDownload 已适配的平台（submit 唯一门槛）；chatglm/kimi 只有
  // imageGeneration 无下载链路，submit 会被 CAPABILITY_UNSUPPORTED 拦下，故不入选项。
  const PLATFORM_IDS = [
    'auto',
    'chatgpt',
    'gemini',
    'grok',
    'qwen',
    'doubao',
    'yiyan',
    'yuanbao'
  ] as const

  const IMAGE_PROMPT = (p: string) =>
    `请使用当前平台的 AI 生图能力，根据以下描述生成图片。\n\n` +
    `图片描述：${p}\n\n` +
    `要求：\n` +
    `1. 必须真正触发生图（不要在回复里只给文字描述或 ASCII 示意）。\n` +
    `2. 生成完成后把图片作为本次回复的产物输出；回复正文可以只写一句完成说明。`

  const IMAGE_GEN_WITH_REF_PROMPT = (p: string) =>
    `请基于附带的参考图，使用当前平台的 AI 生图能力，根据以下描述生成图片（图生图/参考改图）。\n\n` +
    `图片描述：${p}\n\n` +
    `要求：\n` +
    `1. 必须真正以参考图为输入进行生图（不要在回复里只给文字描述或 ASCII 示意）。\n` +
    `2. 生成完成后把图片作为本次回复的产物输出；回复正文可以只写一句完成说明。`

  const POLL_INTERVAL_MS = 2_000

  /** platform=auto 时挑一个已登录且生图/下载链路均适配的平台。 */
  async function resolvePlatform(requested: string): Promise<string> {
    if (requested !== 'auto') return requested
    const caps = await agentTaskService.capabilities()
    const signedIn = caps.filter((c) => c.signedIn === true)
    // submit 的实际门槛是 imageDownload（AgentTaskService 只校验它的 steps 非空）；
    // imageGeneration 仅是页面侧"生图模式开关"适配标记，不影响能否跑通。
    const usable = signedIn.filter((c) => c.imageDownload)
    // 偏好 busySignal 已适配的平台，完成判定更可靠。
    usable.sort((a, b) => (a.busySignal === 'adapted' ? 0 : 1) - (b.busySignal === 'adapted' ? 0 : 1))
    const pick = usable[0]
    if (!pick) {
      throw new Error(
        signedIn.length === 0
          ? '没有已登录的可用平台，请先在 MultiChat 中登录至少一个 AI 平台'
          : '当前已登录平台均未适配 AI 生图下载链路（imageDownload 未配置），可用平台：chatgpt/gemini/grok/qwen/doubao/yiyan/yuanbao'
      )
    }
    return pick.id
  }

  async function waitTerminal(taskId: string, signal: AbortSignal | undefined): Promise<AgentTaskView> {
    for (;;) {
      if (signal?.aborted) {
        await agentTaskService.cancel(taskId).catch(() => null)
        throw new Error('image_gen 已被取消')
      }
      const view = await agentTaskService.getView(taskId)
      if (!view) throw new Error(`任务不存在: ${taskId}`)
      if (isAgentTaskTerminal(view.phase)) return view
      await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS))
    }
  }

  return defineTool({
    name: 'image_gen',
    label: 'Image Generation',
    description:
      '通过 MultiChat 已登录的 AI 平台调用其原生 AI 生图能力，生成图片并落盘到当前工作区的 .multichat/image/ 目录。' +
      '返回图片本地绝对路径列表（通常 1 张）与会话 URL。支持的平台：chatgpt/gemini/grok/qwen/doubao/yiyan/yuanbao；' +
      '默认 platform=auto 自动挑选已登录且生图下载链路已适配的平台。',
    promptSnippet: 'generate images via logged-in AI platforms, returns local file paths',
    promptGuidelines: [
      'Use image_gen when the user asks to generate, draw, or create an image/illustration/artwork.',
      'Pass images (absolute file paths) to do image-to-image / reference-based generation. Omit images for pure text-to-image.',
      'Prefer the default platform="auto"; only pin a platform when the user names one.',
      'The returned paths point into the workspace .multichat/image/ directory. Read/copy the file from there if the user wants it elsewhere.',
      'In your final response, mention each generated image path inline using backticks (e.g. `C:\\path\\to\\image.png`).'
    ],
    parameters: Type.Object({
      prompt: Type.String({ description: '图像描述（自然语言，会原样发给平台）' }),
      images: Type.Optional(
        Type.Array(Type.String({ description: '参考图本地绝对路径' }), {
          description: '参考图绝对路径列表（图生图/参考改图）；留空表示纯文生图',
          maxItems: 10
        })
      ),
      platform: Type.Optional(
        Type.Union(
          PLATFORM_IDS.map((id) => Type.Literal(id)) as unknown as [ReturnType<typeof Type.Literal>, ...ReturnType<typeof Type.Literal>[]],
          { description: '目标平台；auto 自动挑选已登录且生图下载链路已适配的平台' }
        )
      ),
      timeout_sec: Type.Optional(
        Type.Number({ description: '任务硬超时秒数，默认 600s', minimum: 30, maximum: AGENT_TASK_MAX_TIMEOUT_MS / 1000 })
      )
    }),
    outputSchema: Type.Object({
      imageFiles: Type.Array(Type.String()),
      platform: Type.String(),
      reply: Type.String(),
      conversationUrl: Type.Optional(Type.String()),
      imageError: Type.Optional(Type.String())
    }),
    async execute(_toolCallId: string, params: ImageGenParams, signal: AbortSignal | undefined): Promise<AgentToolResult<Record<string, unknown>>> {
      const platform = await resolvePlatform(params.platform ?? 'auto')
      const timeoutMs = params.timeout_sec ? Math.round(params.timeout_sec * 1000) : AGENT_TASK_DEFAULT_TIMEOUT_MS
      const images = Array.isArray(params.images) ? params.images.filter((v) => typeof v === 'string' && v.trim().length > 0) : []

      // 生图落盘到 Agent 会话工作区；cwd 缺失（非工作台会话）时回退应用数据目录。
      const artifactDir = workspaceCwd && workspaceCwd.trim() ? join(resolve(workspaceCwd.trim()), '.multichat') : undefined

      const submit = await agentTaskService.submit({
        platform,
        query: images.length ? IMAGE_GEN_WITH_REF_PROMPT(params.prompt) : IMAGE_PROMPT(params.prompt),
        mode: 'chat',
        genImage: true,
        ...(images.length ? { images } : {}),
        timeoutMs,
        ...(artifactDir ? { artifactDir } : {})
      })
      if (!submit.success || !submit.data) {
        const msg = submit.error ?? 'submit failed'
        return {
          content: [{ type: 'text', text: `image_gen 提交失败: ${msg}` }],
          details: { error: msg, code: submit.code },
          isError: true
        }
      }

      const view = await waitTerminal(submit.data.taskId, signal)
      if (view.phase !== 'done') {
        const msg = view.error ? `${view.error.code}: ${view.error.message}` : `任务终态=${view.phase}`
        return {
          content: [{ type: 'text', text: `image_gen 未完成: ${msg}` }],
          details: { error: msg, taskId: view.taskId, phase: view.phase },
          isError: true
        }
      }

      const imageFiles = view.imageFiles ?? []
      const reply = view.reply ?? ''
      const imageError = view.imageError
      const summary =
        imageFiles.length > 0
          ? `已生成 ${imageFiles.length} 张图片（platform=${view.platform}）：\n${imageFiles.map((p) => `- ${p}`).join('\n')}` +
            (view.conversationUrl ? `\n会话：${view.conversationUrl}` : '')
          : `生图任务已完成但未拿到落盘文件（platform=${view.platform}）${imageError ? `：${imageError}` : ''}` +
            (view.conversationUrl ? `\n会话：${view.conversationUrl}` : '')

      return {
        content: [{ type: 'text', text: summary }],
        details: { platform: view.platform, taskId: view.taskId, imageFiles, imageError },
        structuredContent: {
          imageFiles,
          platform: view.platform,
          reply,
          ...(view.conversationUrl ? { conversationUrl: view.conversationUrl } : {}),
          ...(imageError ? { imageError } : {})
        }
      }
    }
  })
}
