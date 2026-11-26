import { mkdir, writeFile } from 'fs/promises'
import { join } from 'path'
import { randomUUID } from 'crypto'
import type {
  ExtensionAPI,
  ExtensionContext,
  SessionBeforeCompactEvent,
  TurnEndEvent,
  BoundaryResult,
  ContextEditEntryDraft,
  ContextEditableContent,
  ToolResultEvent,
  ToolResultEventResult,
  SessionMessageEntry
} from '@earendil-works/pi-coding-agent'
import type {
  TextContent,
  Usage,
  Model,
  Api,
  ToolCall,
  ToolResultMessage,
  AssistantMessage
} from '@earendil-works/pi-ai'
import type { CompressionConfig } from '../../shared/types/agentCompression'

export type { CompressionConfig }

type AgentMessage = SessionMessageEntry['message']

// pi-coding-agent is pure ESM; the CJS main bundle must resolve it lazily.
const importEsm = new Function('s', 'return import(s)') as <T>(s: string) => Promise<T>

export const DEFAULT_COMPRESSION_CONFIG: CompressionConfig = {
  toolResultHardCap: 8000,
  triggerPercent: 70,
  keepRecentToolCalls: 4,
  toolCallMaxChars: 20000,
  /** L2: chars above which an old tool result is masked. Independent of L1's cap so it isn't dead code. */
  maskResultChars: 4000,
  excludeTools: [],
  toolResultUseModel: false,
  summarizerMode: 'sdk',
  modelOverride: null
}

const INPUT_LONG_FIELDS: Record<string, string[]> = {
  bash: ['command'],
  powershell: ['command'],
  write: ['content'],
  edit: ['edits']
}

const PLACEHOLDER_PREFIX = '[context-compressed:'
const MODEL_SUMMARY_TIMEOUT_MS = 30_000

function dumpPathFor(dir: string, toolCallId: string, kind: string): string {
  const safe = toolCallId.replace(/[^a-zA-Z0-9_-]/g, '_')
  return join(dir, `${safe}-${kind}.txt`)
}

async function dumpText(dir: string, toolCallId: string, kind: string, text: string, meta: Record<string, unknown>): Promise<void> {
  try {
    await mkdir(dir, { recursive: true })
    const header = `# compressed ${kind}\n# toolCallId=${toolCallId}\n# meta=${JSON.stringify(meta)}\n\n`
    await writeFile(dumpPathFor(dir, toolCallId, kind), header + text, 'utf8')
  } catch {
    // best-effort: the placeholder still points at the path
  }
}

function isPlaceholder(v: unknown): boolean {
  return typeof v === 'string' && v.includes(PLACEHOLDER_PREFIX)
}

function contentText(content: unknown): string {
  if (!Array.isArray(content)) return ''
  return (content as Array<{ type?: string; text?: string }>)
    .filter((c) => c?.type === 'text' && typeof c.text === 'string')
    .map((c) => c.text as string)
    .join('\n')
}

function isToolResultMessage(m: AgentMessage): m is ToolResultMessage {
  return !!m && typeof m === 'object' && (m as { role?: string }).role === 'toolResult'
}

function isAssistantMessage(m: AgentMessage): m is AssistantMessage {
  return !!m && typeof m === 'object' && (m as { role?: string }).role === 'assistant'
}

function toolCallsOf(m: AssistantMessage): ToolCall[] {
  return (m.content ?? []).filter((c): c is ToolCall => c?.type === 'toolCall')
}

function recentToolCallIds(messages: AgentMessage[], keep: number): Set<string> {
  const ordered: string[] = []
  const seen = new Set<string>()
  for (const m of messages) {
    if (!isAssistantMessage(m)) continue
    for (const tc of toolCallsOf(m)) {
      if (tc.id && !seen.has(tc.id)) {
        seen.add(tc.id)
        ordered.push(tc.id)
      }
    }
  }
  return new Set(ordered.slice(Math.max(0, ordered.length - keep)))
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('compression summarization timed out')), ms)
    promise.then(
      (v) => { clearTimeout(t); resolve(v) },
      (e) => { clearTimeout(t); reject(e) }
    )
  })
}

function resolveSummarizerModel(ctx: ExtensionContext, modelOverride: string | null): Model<Api> | undefined {
  if (modelOverride) {
    const idx = modelOverride.indexOf('/')
    if (idx > 0) {
      const found = ctx.modelRegistry.find(modelOverride.slice(0, idx), modelOverride.slice(idx + 1)) as Model<Api> | undefined
      if (found) return found
    }
  }
  return ctx.model as Model<Api> | undefined
}

function textOfAssistantMessage(response: { content: Array<{ type: string; text?: string }> }): string {
  return response.content
    .filter((c): c is { type: 'text'; text: string } => c.type === 'text' && typeof c.text === 'string')
    .map((c) => c.text)
    .join('\n')
    .trim()
}

async function completeWithCurrentModel(
  ctx: ExtensionContext,
  model: Model<Api>,
  promptText: string,
  signal: AbortSignal | undefined,
  maxTokens: number
): Promise<{ text: string; usage?: Usage } | null> {
  try {
    const response = await withTimeout(
      ctx.modelRegistry.complete(
        model,
        { messages: [{ role: 'user', content: [{ type: 'text', text: promptText }], timestamp: Date.now() }] },
        { maxTokens, signal, cacheRetention: 'none', sessionId: randomUUID() }
      ) as Promise<{ content: Array<{ type: string; text?: string }>; usage?: Usage }>,
      MODEL_SUMMARY_TIMEOUT_MS
    )
    const text = textOfAssistantMessage(response)
    return text ? { text, usage: response.usage } : null
  } catch {
    return null
  }
}

export function createContextCompressionExtension(
  config: CompressionConfig,
  compressionDir: string
): { name: string; factory: (pi: ExtensionAPI) => void; hidden: boolean } {
  const exclude = new Set(config.excludeTools)

  return {
    name: 'context-compression',
    hidden: true,
    factory: (pi) => {
      // Runs the moment a tool result is produced, before it enters context. Only
      // this new message is shortened; earlier prefixes are untouched so the
      // KV-cache stays warm. Industry-preferred layer for re-fetchable results.
      pi.on('tool_result', async (event: ToolResultEvent): Promise<ToolResultEventResult | undefined> => {
        if (exclude.has(event.toolName)) return undefined
        const rawText = contentText(event.content)
        if (rawText.length <= config.toolResultHardCap) return undefined

        const path = dumpPathFor(compressionDir, event.toolCallId, 'result')
        await dumpText(compressionDir, event.toolCallId, 'result', rawText, {
          tool: event.toolName, isError: event.isError, chars: rawText.length
        })
        const kept = rawText.slice(0, config.toolResultHardCap)
        return {
          content: [{
            type: 'text',
            text: `${kept}\n\n${PLACEHOLDER_PREFIX} truncated ${rawText.length - kept.length} chars, original saved to ${path}]`
          } as TextContent],
          structuredContent: undefined
        }
      })

      // Fires once per turn_end. Masks OLD tool calls + results via durable
      // `context_edit` entries (appendContextEdit) so the projected context
      // shrinks for good — percent then drops and masking stops re-triggering.
      // The `keep` window (fresh tool calls) is preserved verbatim. This mirrors
      // Anthropic's `clear_tool_uses`: a one-time transcript edit, not a
      // per-request projection rewrite.
      pi.on('turn_end', async (event: TurnEndEvent, ctx): Promise<BoundaryResult | undefined> => {
        const percent = ctx.getContextUsage?.()?.percent
        if (percent === null || percent === undefined || percent < config.triggerPercent) return undefined

        const messages = ctx.sessionManager
          .getEntries()
          .filter((e): e is SessionMessageEntry => e.type === 'message')
          .map((e) => e.message)
        if (messages.length === 0) return undefined

        const keepIds = recentToolCallIds(messages, config.keepRecentToolCalls)
        const drafts: ContextEditEntryDraft[] = []
        const resultMasks: Array<{ targetId: string; summarize: () => Promise<string> }> = []

        for (const entry of ctx.sessionManager.getEntries()) {
          if (entry.type !== 'message') continue
          const m = (entry as SessionMessageEntry).message
          const targetId = entry.id

          // Old tool-call arguments → replacement assistant content with masked args.
          if (isAssistantMessage(m)) {
            const newContent = m.content.map((block) => {
              if (block?.type !== 'toolCall' || !block.id || keepIds.has(block.id)) return block
              if (exclude.has(block.name)) return block
              const fields = INPUT_LONG_FIELDS[block.name]
              if (!fields) return block
              const args = { ...(block.arguments as Record<string, unknown>) }
              let argChanged = false
              for (const field of fields) {
                if (field === 'edits') {
                  const edits = args.edits
                  if (Array.isArray(edits)) {
                    args.edits = edits.map((e) => {
                      if (!e || typeof e !== 'object') return e
                      const rec = { ...(e as Record<string, unknown>) }
                      for (const k of ['oldText', 'newText']) {
                        const v = rec[k]
                        if (typeof v === 'string' && v.length > config.toolCallMaxChars && !isPlaceholder(v)) {
                          const path = dumpPathFor(compressionDir, block.id, `input-${block.name}-${k}`)
                          void dumpText(compressionDir, block.id, `input-${block.name}-${k}`, v, { tool: block.name, field: k })
                          rec[k] = `${PLACEHOLDER_PREFIX} ${v.length} chars, original saved to ${path}]`
                          argChanged = true
                        }
                      }
                      return rec
                    })
                  }
                } else {
                  const v = args[field]
                  if (typeof v === 'string' && v.length > config.toolCallMaxChars && !isPlaceholder(v)) {
                    const path = dumpPathFor(compressionDir, block.id, `input-${block.name}-${field}`)
                    void dumpText(compressionDir, block.id, `input-${block.name}-${field}`, v, { tool: block.name, field })
                    args[field] = `${PLACEHOLDER_PREFIX} ${v.length} chars, original saved to ${path}]`
                    argChanged = true
                  }
                }
              }
              return argChanged ? { ...block, arguments: args } : block
            })
            const changed = newContent.some((b, i) => b !== m.content[i])
            if (changed) {
              drafts.push({ type: 'context_edit', targetId, replacement: { content: newContent as ContextEditableContent } })
            }
            continue
          }

          // Old tool results → replacement result content with a mask placeholder.
          if (isToolResultMessage(m) && m.toolCallId && !keepIds.has(m.toolCallId)) {
            if (exclude.has(m.toolName)) continue
            const rawText = contentText(m.content)
            if (rawText.length <= config.maskResultChars || isPlaceholder(rawText.trim())) continue
            const path = dumpPathFor(compressionDir, m.toolCallId, 'result')
            void dumpText(compressionDir, m.toolCallId, 'result', rawText, { tool: m.toolName, isError: m.isError, chars: rawText.length })

            const summarize = async (): Promise<string> => {
              if (config.toolResultUseModel) {
                const model = resolveSummarizerModel(ctx, config.modelOverride)
                const res = model
                  ? await completeWithCurrentModel(
                      ctx,
                      model,
                      "Condense this " + m.toolName + " tool output into 1-2 short paragraphs. Preserve exact file paths, line numbers, error messages, and key values needed to continue the task. Drop noise and repetition.\n\n<tool-output>\n" + rawText.slice(0, config.maskResultChars * 4) + "\n</tool-output>",
                      ctx.signal,
                      Math.min(2048, (model as { maxTokens?: number }).maxTokens ?? 2048)
                    )
                  : null
                if (res) return res.text + "\n\n" + PLACEHOLDER_PREFIX + " " + rawText.length + " chars, original saved to " + path + "]"
              }
              return rawText.slice(0, config.maskResultChars) + "\n\n" + PLACEHOLDER_PREFIX + " truncated " + (rawText.length - config.maskResultChars) + " chars, original saved to " + path + "]"
            }
            resultMasks.push({ targetId, summarize })
          }
        }

        const maskedResults = await Promise.all(resultMasks.map(async (r) => ({ targetId: r.targetId, text: await r.summarize() })))
        for (const r of maskedResults) {
          drafts.push({
            type: 'context_edit',
            targetId: r.targetId,
            replacement: { content: [{ type: 'text', text: r.text } as TextContent] }
          })
        }

        return drafts.length > 0 ? { entries: drafts } : undefined
        return drafts.length > 0 ? { entries: drafts } : undefined
      })

      pi.on('session_before_compact', async (event: SessionBeforeCompactEvent, ctx) => {
        if (config.summarizerMode !== 'custom') return undefined
        const { preparation, signal } = event
        const model = resolveSummarizerModel(ctx, config.modelOverride)
        if (!model) return undefined

        const maxTokens = Math.min(8192, (model as { maxTokens?: number }).maxTokens ?? 8192)
        const { convertToLlm, serializeConversation } = await importEsm<
          typeof import('@earendil-works/pi-coding-agent')
        >('@earendil-works/pi-coding-agent')

        const readFiles = preparation.fileOps?.read ? Array.from(preparation.fileOps.read) : []
        const modifiedFiles = [
          ...(preparation.fileOps?.written ? Array.from(preparation.fileOps.written) : []),
          ...(preparation.fileOps?.edited ? Array.from(preparation.fileOps.edited) : [])
        ]
        // Pinned invariant: appended programmatically so the file index survives
        // verbatim regardless of what the model writes.
        const fileIndex =
          (readFiles.length ? `\n\n<read-files>\n${readFiles.join('\n')}\n</read-files>` : '') +
          (modifiedFiles.length ? `\n<modified-files>\n${modifiedFiles.join('\n')}\n</modified-files>` : '')

        const historyText = serializeConversation(convertToLlm(preparation.messagesToSummarize))
        const historyPrompt = buildSummaryPrompt(historyText, preparation.previousSummary, event.customInstructions)
        const historyRes = await completeWithCurrentModel(ctx, model, historyPrompt, signal, maxTokens)
        if (!historyRes) return undefined
        let summary = historyRes.text
        const usage: Usage | undefined = historyRes.usage

        if (preparation.isSplitTurn && preparation.turnPrefixMessages.length > 0) {
          const turnText = serializeConversation(convertToLlm(preparation.turnPrefixMessages))
          const turnPrompt = buildSummaryPrompt(turnText, undefined, event.customInstructions)
          const turnRes = await completeWithCurrentModel(ctx, model, turnPrompt, signal, maxTokens)
          if (turnRes) summary = `${summary}\n\n## Current Turn Prefix\n${turnRes.text}`
        }

        summary = summary + fileIndex
        if (!summary.trim()) return undefined
        return {
          compaction: {
            summary,
            firstKeptEntryId: preparation.firstKeptEntryId,
            tokensBefore: preparation.tokensBefore,
            usage,
            details: { readFiles, modifiedFiles, custom: true }
          }
        }
      })
    }
  }
}

function buildSummaryPrompt(conversationText: string, previousSummary: string | undefined, customInstructions: string | undefined): string {
  const prev = previousSummary ? `\n\nPrevious summary (update it, preserving all still-relevant info):\n${previousSummary}` : ''
  const custom = customInstructions ? `\n\nFocus additionally on: ${customInstructions}` : ''
  return `The messages below are a conversation to summarize. Create a structured context checkpoint that another LLM will use to continue the work.

Use this EXACT format:

## Goal
[What is the user trying to accomplish?]

## Constraints & Preferences
- [Requirements mentioned by user, or "(none)"]

## Progress
### Done
- [x] [Completed tasks]
### In Progress
- [ ] [Current work]
### Blocked
- [Issues, if any]

## Key Decisions
- **[Decision]**: [Brief rationale]

## Next Steps
1. [Ordered next steps]

## Critical Context
- [Data/examples/references needed to continue, or "(none)"]

Keep each section concise. Preserve exact file paths, function names, and error messages.${prev}${custom}

<conversation>
${conversationText}
</conversation>`
}
