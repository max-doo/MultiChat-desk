/**
 * 任务拆解提示词与回复解析（后台 Web AI 版）。
 * 输出格式与思维导图同构：唯一 <task_split> 块，内部恰好 N 个 <subtask>。
 */
import { extractMindmapTaggedBlock } from './mindmapEdits'

export const SUBTASK_TAGS = { begin: '<task_split>', end: '</task_split>' } as const

export interface SplitSubtask {
  text: string
  suggestedModelId?: string
}

export type SubtaskParseResult =
  | { status: 'pending' }
  | { status: 'invalid'; error: string }
  | { status: 'ready'; subtasks: SplitSubtask[] }

/** 构建发给 Web 平台的单条拆解提示词（平台无 system 角色，全部进用户消息）。 */
export function buildTaskSplitPrompt(goal: string, windowCount?: number): string {
  const countRule = windowCount && windowCount > 0
    ? `1. 必须输出恰好 ${windowCount} 个子任务——每个子任务对应一个并行处理窗口，不得多出或少于 ${windowCount} 个 <subtask> 标签。`
    : `1. 子任务数量在 2 到 6 之间，依据目标复杂度合理拆分。`
  return `请按以下要求拆解我的目标，只输出 <task_split>…</task_split>，不要输出任何其他文字。

你是一个任务拆解助手。用户会给出一个总目标，你需要把它拆解成若干个可以分别交给不同 AI 平台并行处理的**完全独立、互不依赖**的子任务。

核心约束：
${countRule}
2. **严禁纵向依赖（串行步骤）**：子任务之间**绝对不能**存在先后顺序。例如，绝对不能出现"步骤1：写大纲"和"步骤2：根据步骤1的大纲写正文"，因为所有子任务会被同时发送给不同的 AI，执行步骤2的 AI 无法得到步骤1的输出。
3. **必须横向拆解（并行视角）**：如果总目标是一个复杂的复合任务，你必须从以下维度进行"横向切割"：
   - **按研究对象拆分**（例如：对比A、B、C三个竞品，子任务1研究A，子任务2研究B，子任务3研究C）。
   - **按视角维度拆分**（例如：分析一个项目，子任务1分析技术可行性，子任务2分析市场推广，子任务3分析政策风险与财务预算）。
   - **按模块/范围拆分**（例如：编写一个系统，子任务1设计数据库表，子任务2设计前端UI组件，子任务3编写后端API接口契约）。
4. 每个子任务必须自带足够上下文，能脱离原目标独立理解（即把必要的背景、要求写进子任务文本里）。

---
【拆解示例】
输入目标："帮我调研国内主流的三个大模型：文心一言、通义千问、Kimi，并分析它们的优缺点。"
优秀拆解（横向并行）：
<task_split>
<subtask>请详细调研百度「文心一言」大模型的最新版本，重点分析其在中文理解、逻辑推理及代码编写方面的优缺点，并给出具体评测结论。</subtask>
<subtask>请详细调研阿里「通义千问」大模型的最新版本，重点分析其在中文理解、逻辑推理及代码编写方面的优缺点，并给出具体评测结论。</subtask>
<subtask>请详细调研月之暗面「Kimi」大模型的最新版本，重点分析其在长文本处理、中文理解及逻辑推理方面的优缺点，并给出具体评测结论。</subtask>
</task_split>
（原因：三个任务完全独立，可由三个窗口同时运行，最后由用户合并查看）

输出格式（严格遵守）：
- 整个回复只包含一个 <task_split> 块，块外不输出任何文字、解释或代码块标记。
- 块内恰好放置规定数量的 <subtask>…</subtask> 标签；子任务文本写在标签内部。
- 子任务文本允许真实换行，不需要转义引号或括号；标签必须成对闭合。

【我的目标】
${goal.trim()}`
}

/**
 * 三态解析：
 * - pending：<task_split> 未闭合（流式中途），继续等。
 * - invalid：闭合但结构坏（多份块、缺标签、数量不符），网页空闲稳定后才报。
 * - ready：唯一完整块，按 <subtask> 逐段切出文本。
 */
export function parseSubtasksXml(raw: string, windowCount?: number): SubtaskParseResult {
  const text = (raw || '').replace(/&lt;(\/?task_split|subtask)&gt;/g, '<$1>')
  const hasBegin = text.includes(SUBTASK_TAGS.begin)
  const hasEnd = text.includes(SUBTASK_TAGS.end)
  if (!hasBegin && !hasEnd) {
    // 还没出现任何标签：流式输出可能尚未写到标签处，先按 pending 等待。
    return { status: 'pending' }
  }
  if (!hasEnd) return { status: 'pending' }
  const envelope = extractMindmapTaggedBlock(text, SUBTASK_TAGS)
  if (envelope.status !== 'ready') {
    return envelope.status === 'pending' ? { status: 'pending' } : { status: 'invalid', error: envelope.error }
  }
  const body = envelope.content
  const items: string[] = []
  const itemRe = /<subtask[^>]*>([\s\S]*?)<\/subtask>/g
  let match: RegExpExecArray | null
  while ((match = itemRe.exec(body)) !== null) {
    const value = match[1].trim()
    if (value) items.push(value)
  }
  // 块内除子任务标签外的残留文字视为格式不干净。
  const leftover = body.replace(itemRe, '').trim()
  if (!items.length) return { status: 'invalid', error: '<task_split> 内没有可解析的 <subtask> 子任务' }
  if (leftover) return { status: 'invalid', error: '<task_split> 内含有 <subtask> 之外的多余内容' }
  if (windowCount && windowCount > 0 && items.length < windowCount) {
    return { status: 'invalid', error: `只拆出 ${items.length} 个子任务，要求恰好 ${windowCount} 个` }
  }
  const trimmed = windowCount && windowCount > 0 ? items.slice(0, windowCount) : items
  return { status: 'ready', subtasks: trimmed.map(text => ({ text })) }
}

/**
 * Lenient fallback: pull <subtask>…</subtask> items anywhere in the reply,
 * ignoring the <task_split> envelope. Web platforms often echo the prompt or
 * wrap the block loosely; the envelope may be incomplete/dirty while the
 * per-item tags are still intact. Returns subtask texts.
 */
export function parseSubtasksLenient(raw: string, windowCount?: number): SplitSubtask[] {
  const text = (raw || '').replace(/&lt;(\/?task_split|subtask)&gt;/g, '<$1>')
  const items: string[] = []
  const itemRe = /<subtask[^>]*>([\s\S]*?)<\/subtask>/g
  let match: RegExpExecArray | null
  while ((match = itemRe.exec(text)) !== null) {
    const value = match[1].trim()
    if (value && !items.includes(value)) items.push(value)
  }
  const trimmed = windowCount && windowCount > 0 ? items.slice(0, windowCount) : items
  return trimmed.map(t => ({ text: t }))
}
