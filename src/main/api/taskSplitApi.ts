/**
 * Task Split API
 * 复用 OpenAI 兼容端点做一次性（非流式）任务拆解。
 */
import { TASK_SPLIT_SYSTEM_PROMPT, parseSubtasks } from '../config/taskSplitPrompt'

export interface SplitTaskParams {
  apiKey: string
  baseUrl?: string
  model: string
  goal: string
  temperature?: number
  maxTokens?: number
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

  const body = {
    model: params.model,
    messages: [
      { role: 'system', content: TASK_SPLIT_SYSTEM_PROMPT },
      { role: 'user', content: `请拆解以下目标：\n\n${goal}` }
    ],
    temperature: params.temperature ?? 0.4,
    max_tokens: params.maxTokens ?? 1500,
    stream: false
  }

  try {
    const resp = await fetch(apiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${params.apiKey}`
      },
      body: JSON.stringify(body),
      signal
    })
    if (!resp.ok) {
      const text = await resp.text().catch(() => '')
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
