/**
 * Agent 上下文压缩配置（本项目自定义，存 electron-store 键 agent_compression）。
 * SDK 原生 compaction.* 走 settingsManager，不经此结构。
 */
export interface CompressionConfig {
  /** L1: a single tool result whose text exceeds this is truncated on append (zero cache cost). */
  toolResultHardCap: number
  /** L2: context usage percent that must be reached before observation masking runs (token watermark, not a char guess). */
  triggerPercent: number
  /** L2: number of most-recent tool call+result pairs always preserved verbatim. */
  keepRecentToolCalls: number
  /** L2: chars above which an old tool-call argument field is masked. */
  toolCallMaxChars: number
  /** L2: chars above which an old tool result is masked. Independent of L1's cap so the L2 branch isn't dead code. */
  maskResultChars: number
  /** Tool names whose args/results are never compressed. */
  excludeTools: string[]
  /** true = summarize oversized tool results with the current model; false = hard truncate. */
  toolResultUseModel: boolean
  /** 'sdk' = pi built-in summary; 'custom' = our prompt via ctx.model. */
  summarizerMode: 'sdk' | 'custom'
  /** Optional 'provider/modelId' override for the summarizer model. null = current model. */
  modelOverride: string | null
}
