/**
 * Task Split API
 * 复用 OpenAI 兼容端点做一次性（非流式）任务拆解。
 * 请求体统一走 buildRequestBody，确保与总结链路形状一致（含 top_p / reasoning 适配），
 * 避免部分供应商网关（如讯飞）对非标准请求体返回 Model Not Found。
 */
import { buildRequestBody } from '../config/requestBodyConfig'
import { buildTaskSplitSystemPrompt, parseSubtasks } from '../config/taskSplitPrompt'

export interface SplitTaskParams {
  apiKey: string
  baseUrl?: string
  model: string
  goal: string
  temperature?: number
  maxTokens?: number
  /** 当前实际窗口数：模型须输出恰好 windowCount 个子任务。缺省回退 2~6 自由拆分。 */
  windowCount?: number
}

export interface SplitTaskResult {
  success: boolean
  data?: Array<{ text: string; suggestedModelId?: string }>
  error?: string
  aborted?: boolean
}

export async function splitTask(
  params: SplitTaskParams,
  signal: AbortSignal
): Promise<SplitTaskResult> {
  const goal = (params.goal || '').trim()
  if (!goal) return { success: false, error: '目标不能为空' }

  const baseUrl = (params.baseUrl || 'https://api.openai.com/v1').replace(/\/+$/, '')
  const apiUrl = `${baseUrl}/chat/completions`

  // 复用总结链路的请求体构建：保持 top_p / reasoning 等字段与供应商适配一致，
  // 仅把 stream 覆盖为 false（任务拆解走一次性 JSON 解析，无流式 reader）。
  const windowCount = params.windowCount && params.windowCount > 0 ? params.windowCount : undefined
  const userContent = windowCount
    ? `请将以下目标拆解为恰好 ${windowCount} 个独立子任务（对应 ${windowCount} 个并行处理窗口，不可多不可少）：\n\n${goal}`
    : `请拆解以下目标：\n\n${goal}`
  const requestBody = buildRequestBody({
    model: params.model,
    messages: [
      { role: 'system', content: buildTaskSplitSystemPrompt(windowCount) },
      { role: 'user', content: userContent }
    ],
    temperature: params.temperature ?? 0.4,
    maxTokens: params.maxTokens ?? 1500,
    baseUrl: params.baseUrl,
    stream: false
  })

  const IS_DEV = process.env.NODE_ENV !== 'production'
  if (IS_DEV) {
    console.log('[TaskSplit API] 请求地址:', apiUrl)
    console.log('[TaskSplit API] 模型:', params.model)
    console.log('[TaskSplit API] 请求体:', JSON.stringify(requestBody, null, 2))
  }

  try {
    const resp = await fetch(apiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${params.apiKey}`
      },
      body: JSON.stringify(requestBody),
      signal
    })
    if (IS_DEV) {
      console.log('[TaskSplit API] 响应状态:', resp.status, resp.statusText)
    }
    if (!resp.ok) {
      const text = await resp.text().catch(() => '')
      if (IS_DEV) {
        console.error('[TaskSplit API] ❌ 失败原始响应:', text)
      }
      return { success: false, error: `拆解请求失败 (${resp.status}): ${text.slice(0, 200)}` }
    }
    const json = (await resp.json()) as { choices?: Array<{ message?: { content?: string } }> }
    const content = json.choices?.[0]?.message?.content || ''
    const subtasks = parseSubtasks(content)
    if (subtasks.length === 0) {
      return { success: false, error: '模型未返回有效子任务 JSON' }
    }
    return { success: true, data: subtasks }
  } catch (err) {
    if (signal.aborted) return { success: false, aborted: true, error: '已中止' }
    return { success: false, error: String(err) }
  }
}
