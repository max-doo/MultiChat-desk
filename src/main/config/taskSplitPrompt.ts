/**
 * 任务拆解系统提示词
 * 要求模型将用户目标拆解为可独立分配给不同 AI 的子任务，输出严格 JSON。
 */
export const TASK_SPLIT_SYSTEM_PROMPT = `你是一个任务拆解助手。用户会给出一个总目标，你需要把它拆解成若干个可以分别交给不同 AI 平台并行处理的独立子任务。

规则：
1. 子任务数量在 2 到 6 之间，依据目标复杂度合理拆分。
2. 每个子任务必须自带足够上下文，能脱离原目标独立理解（即把必要的背景写进子任务文本里）。
3. 子任务之间尽量互不依赖，可并行执行。
4. 只输出 JSON，禁止输出任何解释、markdown 代码块或多余文字。

输出格式（严格 JSON 数组）：
[
  { "text": "子任务1的完整描述" },
  { "text": "子任务2的完整描述" }
]`

/** 从模型输出中提取 JSON 子任务数组（容忍代码块包裹与前后多余文字） */
export function parseSubtasks(raw: string): { text: string; suggestedModelId?: string }[] {
  let s = (raw || '').trim()
  // 去除 ```json ... ``` 包裹
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/i)
  if (fence) s = fence[1].trim()
  // 截取第一个 [ 到最后一个 ]
  const start = s.indexOf('[')
  const end = s.lastIndexOf(']')
  if (start === -1 || end === -1 || end <= start) return []
  const slice = s.slice(start, end + 1)
  try {
    const arr = JSON.parse(slice) as unknown
    if (!Array.isArray(arr)) return []
    return arr
      .map((item) => {
        if (typeof item === 'string') return { text: item }
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        if (item && typeof item === 'object' && typeof (item as any).text === 'string') {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          return { text: (item as any).text, suggestedModelId: (item as any).suggestedModelId }
        }
        return null
      })
      .filter((x): x is { text: string; suggestedModelId?: string } => !!x && x.text.trim().length > 0)
  } catch {
    return []
  }
}
