/**
 * 任务拆解系统提示词
 * 要求模型将用户目标拆解为可独立分配给不同 AI 的子任务，输出严格 JSON。
 * windowCount = 当前实际窗口数；模型必须输出恰好 windowCount 个子任务，每个对应一个并行窗口。
 * windowCount 缺省时回退到「2 到 6 个」自由拆分（向后兼容）。
 */
export function buildTaskSplitSystemPrompt(windowCount?: number): string {
  const countRule = windowCount && windowCount > 0
    ? `1. 必须输出恰好 ${windowCount} 个子任务——每个子任务对应一个并行处理窗口，不得多出或少于 ${windowCount} 个。`
    : `1. 子任务数量在 2 到 6 之间，依据目标复杂度合理拆分。`
  return `你是一个任务拆解助手。用户会给出一个总目标，你需要把它拆解成若干个可以分别交给不同 AI 平台并行处理的**完全独立、互不依赖**的子任务。

核心约束：
${countRule}
2. **严禁纵向依赖（串行步骤）**：子任务之间**绝对不能**存在先后顺序。例如，绝对不能出现“步骤1：写大纲”和“步骤2：根据步骤1的大纲写正文”，因为所有子任务会被同时发送给不同的 AI，执行步骤2的 AI 无法得步骤1的输出。
3. **必须横向拆解（并行视角）**：如果总目标是一个复杂的复合任务，你必须从以下维度进行“横向切割”：
   - **按研究对象拆分**（例如：对比A、B、C三个竞品，子任务1研究A，子任务2研究B，子任务3研究C）。
   - **按视角维度拆分**（例如：分析一个项目，子任务1分析技术可行性，子任务2分析市场推广，子任务3分析政策风险与财务预算）。
   - **按模块/范围拆分**（例如：编写一个系统，子任务1设计数据库表，子任务2设计前端UI组件，子任务3编写后端API接口契约）。
4. 每个子任务必须自带足够上下文，能脱离原目标独立理解（即把必要的背景、要求写进子任务文本里）。
5. 只输出 JSON，禁止输出任何解释、markdown 代码块或多余文字。

---
【拆解示例】
输入目标：“帮我调研国内主流的三个大模型：文心一言、通义千问、Kimi，并分析它们的优缺点。”
❌ 错误拆解（纵向串行）：
[
  { "text": "第一步：在网上搜索文心一言、通义千问和 Kimi 的最新资料，整理成一份对比表格。" },
  { "text": "第二步：根据上一步整理好的表格，分析它们在长文本和逻辑推理上的优缺点。" }
]
（原因：任务2依赖任务1的表格，无法并行执行）

优秀拆解（横向并行）：
[
  { "text": "请详细调研百度『文心一言』大模型的最新版本，重点分析其在中文理解、逻辑推理及代码编写方面的优缺点，并给出具体评测结论。" },
  { "text": "请详细调研阿里『通义千问』大模型的最新版本，重点分析其在中文理解、逻辑推理及代码编写方面的优缺点，并给出具体评测结论。" },
  { "text": "请详细调研月之暗面『Kimi』大模型的最新版本，重点分析其在长文本处理、中文理解及逻辑推理方面的优缺点，并给出具体评测结论。" }
]
（原因：三个任务完全独立，可由三个窗口同时运行，最后由用户合并查看）

输出格式（严格 JSON 数组）：
[
  { "text": "子任务1的完整描述" },
  { "text": "子任务2的完整描述" }
]`
}

/** 向后兼容：无窗口数时的默认系统提示词（2~6 自由拆分）。 */
export const TASK_SPLIT_SYSTEM_PROMPT = buildTaskSplitSystemPrompt()

/** 从模型输出中提取 JSON 子任务数组（容忍代码块包裹与前后多余文字） */
export function parseSubtasks(raw: string): { text: string; suggestedModelId?: string }[] {
  let s = (raw || '').trim()
  // 去除 JSON 代码块包裹
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
