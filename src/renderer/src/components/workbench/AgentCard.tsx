import { Fragment, memo, useState, useEffect, useLayoutEffect, useRef, useMemo, useCallback } from 'react'
import { useAppStore, DEEP_RESEARCH_SUPPORTED_MODEL_IDS, IMAGE_GENERATION_SUPPORTED_MODEL_IDS } from '../../store/appStore'
import agentAvatar from '../../assets/logos/agent.png'
import { useWorkbenchStore } from '../../store/workbenchStore'
import { useAgentSessionStore } from '../../store/agentSessionStore'
import CustomDropdown, { type DropdownOption } from '../CustomDropdown'
import { AppIcon } from '../icons/AppIcon'
import ConfirmModal from '../ConfirmModal'
import RenameModal from '../RenameModal'
import Modal from '../ui/Modal'
import { AgentPopover } from './agent/AgentPopover'
import { ToolGroup } from './agent/ToolGroup'
import { ApprovalCard } from './agent/ApprovalCard'
import { ThinkingBlock } from './agent/ThinkingBlock'
import { AgentComposer } from './agent/AgentComposer'
import ChangedFilesCard from './agent/ChangedFilesCard'
import { MarkdownRenderer } from './agent/MarkdownRenderer'
import { WorkPhaseBlock } from './agent/WorkPhaseBlock'
import { InlineMentionText } from './agent/AttachmentChips'
import WorkbenchImageLightbox, { type LightboxImageItem } from './WorkbenchImageLightbox'
import type { AgentMessage, PiContentPart } from '../../types/agent'
import type { AgentTurnFileChanges } from '../../../../shared/types/agentRuntime'

interface AgentCardProps {
  isVisible?: boolean
  onModelChange?: (modelId: string) => void
  headerActions?: React.ReactNode
}

/** 规范化路径用于工作区相等比较：统一分隔符、去尾斜杠；按 Windows 语义不区分大小写。 */
function normalizePath(p: string | null | undefined): string {
  if (!p) return ''
  return p.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase()
}

function baseName(p: string): string {
  const parts = p.replace(/[/\\]+$/, '').split(/[/\\]/)
  return parts[parts.length - 1] || p
}

function formatMessageTime(timestamp: number): string {
  const date = new Date(timestamp)
  const now = new Date()
  const sameDay = date.toDateString() === now.toDateString()
  if (sameDay) {
    return date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
  }
  return date.toLocaleString('zh-CN', {
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  })
}

function formatDuration(durationMs: number): string {
  if (!Number.isFinite(durationMs) || durationMs < 0) return ''
  if (durationMs < 1000) return `${Math.round(durationMs)}ms`
  const totalSeconds = durationMs / 1000
  if (totalSeconds < 60) return `${totalSeconds.toFixed(1)}s`
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = Math.round(totalSeconds % 60)
  return seconds > 0 ? `${minutes}m ${seconds}s` : `${minutes}m`
}

type GroupedBlock =
  | { type: 'reasoning'; reasoning: string; isRunning: boolean; part: PiContentPart }
  | { type: 'text'; text: string; part: PiContentPart }
  | { type: 'tool-group'; parts: PiContentPart[]; isRunning: boolean }

function groupContentParts(parts: PiContentPart[], isMsgRunning: boolean): GroupedBlock[] {
  const blocks: GroupedBlock[] = []
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i]
    if (part.type === 'reasoning') {
      blocks.push({
        type: 'reasoning',
        reasoning: part.reasoning || '',
        isRunning: isMsgRunning && i === parts.length - 1,
        part
      })
    } else if (part.type === 'text') {
      if (part.text?.trim()) {
        blocks.push({
          type: 'text',
          text: part.text,
          part
        })
      }
    } else if (part.type === 'tool-call') {
      const last = blocks[blocks.length - 1]
      const isPartRunning = isMsgRunning && part.result === undefined && !part.isError
      if (last && last.type === 'tool-group') {
        last.parts.push(part)
        last.isRunning = last.isRunning || isPartRunning
      } else {
        blocks.push({
          type: 'tool-group',
          parts: [part],
          isRunning: isPartRunning
        })
      }
    }
  }
  return blocks
}

// 把消息流分组成"工作段"：一个 user query 后面连续的 assistant 全合并成
// 一个 work-group——组内所有 reasoning/tool-call/中间过渡 text 都折叠进
// "思考中/已完成"，只有组内最后一个非空 text 外显为 final answer。
type PrecomputedRenderItem =
  | {
      kind: 'user'
      msg: AgentMessage
      isLastUserMessage: boolean
    }
  | {
      kind: 'work'
      msgs: AgentMessage[]
      hasText: boolean
      firstMsgId: string
      hasRunningMsg: boolean
      isLatestGroup: boolean
      isTurnFinal: boolean
      isLastTurnFinal: boolean
      messageTurnIndex: number
    }

function computeRenderItems(messages: AgentMessage[]): PrecomputedRenderItem[] {
  let lastUserIdx = -1
  let lastAssistantIdx = -1
  for (let i = messages.length - 1; i >= 0; i--) {
    const role = messages[i].role
    if (lastUserIdx === -1 && role === 'user') lastUserIdx = i
    if (lastAssistantIdx === -1 && role === 'assistant') lastAssistantIdx = i
    if (lastUserIdx !== -1 && lastAssistantIdx !== -1) break
  }

  const items: PrecomputedRenderItem[] = []
  let userCount = 0
  for (let i = 0; i < messages.length; i++) {
    const m = messages[i]
    if (m.role !== 'user' && m.role !== 'assistant') continue
    if (m.role === 'user') {
      userCount++
      items.push({
        kind: 'user',
        msg: m,
        isLastUserMessage: i === lastUserIdx
      })
      continue
    }
    const hasMsgText = m.content.some((c) => c.type === 'text' && Boolean(c.text?.trim()))
    const last = items[items.length - 1]
    const nextMsg = messages[i + 1]
    const isTurnFinal = !nextMsg || nextMsg.role === 'user'
    const isLastTurnFinal = isTurnFinal && i >= lastAssistantIdx
    const isLatestGroup = i === messages.length - 1
    if (last && last.kind === 'work') {
      last.msgs.push(m)
      if (hasMsgText) last.hasText = true
      if (m.status === 'running') last.hasRunningMsg = true
      last.isLatestGroup = isLatestGroup
      last.isTurnFinal = isTurnFinal
      last.isLastTurnFinal = isLastTurnFinal
    } else {
      items.push({
        kind: 'work',
        msgs: [m],
        hasText: hasMsgText,
        firstMsgId: m.id,
        hasRunningMsg: m.status === 'running',
        isLatestGroup,
        isTurnFinal,
        isLastTurnFinal,
        messageTurnIndex: userCount
      })
    }
  }
  return items
}

// 折叠区标题的动态动作描述：跟随当前进行中的 part
// （正在读 xxx / 正在编辑 xxx / 正在运行 xxx / 正在搜 xxx / 正在思考…）。
function describeActivity(part: PiContentPart): string {
  if (part.type === 'reasoning') return '正在思考…'
  const name = (part.toolName || '').toLowerCase()
  const args = typeof part.args === 'object' && part.args !== null ? part.args : {}
  const rawPath = (args as { path?: string; filePath?: string; file_path?: string }).path
    || (args as { filePath?: string }).filePath
    || (args as { file_path?: string }).file_path
    || ''
  const fileName = rawPath ? rawPath.split(/[/\\]/).pop() || rawPath : ''
  const command = typeof part.args === 'string'
    ? part.args
    : ((args as { command?: string; cmd?: string }).command || (args as { cmd?: string }).cmd || '')
  const inline = (args as { query?: string; prompt?: string; pattern?: string }).query
    || (args as { prompt?: string }).prompt
    || (args as { pattern?: string }).pattern
    || ''

  if (name === 'read' || name === 'read_file') return fileName ? `正在读取 ${fileName}` : '正在读取文件'
  if (['edit', 'write', 'edit_file', 'str_replace', 'multi_edit', 'apply_patch'].includes(name)) {
    return fileName ? `正在编辑 ${fileName}` : '正在编辑文件'
  }
  if (['bash', 'powershell', 'cmd', 'terminal', 'shell'].includes(name)) {
    return command ? `正在运行 ${command}` : '正在运行命令'
  }
  if (name === 'web_search') return inline ? `正在搜索 ${inline}` : '正在联网搜索'
  if (name === 'grep' || name === 'find') return inline ? `正在查找 ${inline}` : '正在查找'
  if (name === 'ls') return fileName ? `正在列出 ${fileName}` : '正在列出目录'
  if (name === 'image_gen') return inline ? `正在生成图片 ${inline}` : '正在生成图片'
  return name ? `正在调用 ${name}` : '正在调用工具'
}

interface AgentUserMessageItemProps {
  message: AgentMessage
  cwd?: string
  canRewind: boolean
  isCopied: boolean
  onCopy: (key: string, text: string) => void
  onRewindClick: () => void
  onPreviewImage: (messageId: string, imageIndex: number) => void
}

// 用户气泡折叠策略（对齐主流 Agent 产品：Claude/ChatGPT 均为默认折叠+手动展开）：
// 按渲染高度而非行数判断——引号/链接/mention 芯片换行宽度不定，行数不可靠。
// 正文 14px × 1.6 行高 ≈ 22.4px/行：>8 行（180px）折叠；折叠后预览 5 行（112px）。
// 展开分两层：中等长度全量展示；极端超长粘贴（>480px，约 21 行）封顶为内嵌滚动，
// 否则一条消息能占满多个视口，聊天流彻底无法浏览。滚轮到底后自然链到外层聊天流。
const USER_BUBBLE_COLLAPSE_THRESHOLD_PX = 180
const USER_BUBBLE_COLLAPSED_HEIGHT_PX = 112
const USER_BUBBLE_EXPANDED_MAX_HEIGHT_PX = 480
const USER_BUBBLE_EXPANDED_PADDING_BOTTOM_PX = 22

const AgentUserMessageItem = memo(function AgentUserMessageItem({
  message,
  cwd,
  canRewind,
  isCopied,
  onCopy,
  onRewindClick,
  onPreviewImage
}: AgentUserMessageItemProps): JSX.Element {
  const userText = useMemo(
    () =>
      message.content
        .filter((c) => c.type === 'text')
        .map((c) => c.text)
        .join(''),
    [message.content]
  )
  const userImages = useMemo(
    () => message.content.filter((c) => c.type === 'image' && Boolean(c.data)),
    [message.content]
  )

  const contentRef = useRef<HTMLDivElement | null>(null)
  const [collapsible, setCollapsible] = useState(false)
  const [capScroll, setCapScroll] = useState(false)
  const [expanded, setExpanded] = useState(false)

  // 观察未裁剪内层内容高度，宽度变化引起重排时也会重新评估是否需要折叠。
  useLayoutEffect(() => {
    const el = contentRef.current
    if (!el) return
    const measure = (): void => {
      const h = el.offsetHeight
      setCollapsible(h > USER_BUBBLE_COLLAPSE_THRESHOLD_PX)
      setCapScroll(h > USER_BUBBLE_EXPANDED_MAX_HEIGHT_PX)
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  const isClipped = collapsible && !expanded
  const scrollable = expanded && capScroll

  return (
    <div className="group my-1">
      {userImages.length > 0 && (
        <div data-agent-history-images="true" className="mb-1 flex flex-wrap justify-end gap-1.5">
          {userImages.map((img, i) => (
            <button
              key={i}
              type="button"
              onClick={() => onPreviewImage(message.id, i)}
              className="group/hist-img relative overflow-hidden rounded-lg border border-slate-200/70 shadow-sm transition-transform hover:scale-[1.02] cursor-zoom-in dark:border-white/10"
              title="点击查看大图"
              aria-label="查看大图"
            >
              <img
                src={img.data ?? ''}
                alt=""
                draggable={false}
                className="max-h-32 max-w-[220px] object-cover"
              />
            </button>
          ))}
        </div>
      )}
      <div className="flex justify-end">
        <div
          className="relative max-w-[85%] rounded-2xl rounded-tr-sm bg-primary text-white text-body leading-relaxed shadow-sm"
        >
          <div
            className={`px-4 py-2.5 rounded-2xl rounded-tr-sm break-words whitespace-pre-wrap select-text ${
              isClipped ? 'overflow-hidden' : scrollable ? 'overflow-y-auto overflow-x-hidden' : ''
            }`}
            style={
              isClipped
                ? { maxHeight: USER_BUBBLE_COLLAPSED_HEIGHT_PX }
                : scrollable
                  ? { maxHeight: USER_BUBBLE_EXPANDED_MAX_HEIGHT_PX }
                  : undefined
            }
          >
            <div
              ref={contentRef}
              style={collapsible ? { paddingBottom: USER_BUBBLE_EXPANDED_PADDING_BOTTOM_PX } : undefined}
            >
              <InlineMentionText text={userText} cwd={cwd} />
            </div>
          </div>
          {isClipped && (
            <div
              className="pointer-events-none absolute inset-x-0 bottom-0 h-10 rounded-b-2xl bg-gradient-to-t from-primary to-transparent"
            />
          )}
          {collapsible && (
            <button
              type="button"
              onClick={() => setExpanded((v) => !v)}
              title={expanded ? '收起' : '展开'}
              aria-expanded={expanded}
              className="absolute bottom-1 left-1/2 flex h-4 w-8 -translate-x-1/2 items-center justify-center rounded-full bg-white/15 text-white/80 transition-colors hover:bg-white/30 hover:text-white"
            >
              <AppIcon
                name="expand_more"
                size={14}
                className={`transition-transform duration-200 ${expanded ? 'rotate-180' : ''}`}
              />
            </button>
          )}
        </div>
      </div>
      <div className="mt-1 flex items-center justify-end gap-0.5 pr-1 opacity-0 transition-opacity group-hover:opacity-100">
        {canRewind && (
          <button
            type="button"
            onClick={onRewindClick}
            className="flex items-center gap-1 rounded-md px-1.5 py-0.5 text-body text-text-secondary transition-colors hover:bg-gray-100 hover:text-text-primary dark:hover:bg-white/10"
            title="编辑并撤回此条消息"
          >
            <AppIcon name="undo" size={16} />
            <span>编辑</span>
          </button>
        )}
        <button
          type="button"
          onClick={() => onCopy(message.id, userText)}
          className="flex items-center gap-1 rounded-md px-1.5 py-0.5 text-body text-text-secondary transition-colors hover:bg-gray-100 hover:text-text-primary dark:hover:bg-white/10"
          title="复制消息内容"
        >
          <AppIcon name="content_copy" size={16} />
          <span>{isCopied ? '已复制' : '复制'}</span>
        </button>
      </div>
    </div>
  )
})

interface AgentWorkGroupItemProps {
  msgs: AgentMessage[]
  sessionId: string | null
  cwd: string | null
  isGroupRunning: boolean
  isTurnFinal: boolean
  turnFileChanges: AgentTurnFileChanges | null
  isCopied: boolean
  isForkMenuOpen: boolean
  isForking: boolean
  onCopy: (key: string, text: string) => void
  onToggleForkMenu: (msgId: string) => void
  onCloseForkMenu: () => void
  onConfirmFork: () => Promise<void>
}

function areWorkGroupPropsEqual(
  prev: AgentWorkGroupItemProps,
  next: AgentWorkGroupItemProps
): boolean {
  if (
    prev.sessionId !== next.sessionId ||
    prev.cwd !== next.cwd ||
    prev.isGroupRunning !== next.isGroupRunning ||
    prev.isTurnFinal !== next.isTurnFinal ||
    prev.turnFileChanges !== next.turnFileChanges ||
    prev.isCopied !== next.isCopied ||
    prev.isForkMenuOpen !== next.isForkMenuOpen ||
    prev.isForking !== next.isForking ||
    prev.onCopy !== next.onCopy ||
    prev.onToggleForkMenu !== next.onToggleForkMenu ||
    prev.onCloseForkMenu !== next.onCloseForkMenu ||
    prev.onConfirmFork !== next.onConfirmFork
  ) {
    return false
  }
  if (prev.msgs.length !== next.msgs.length) return false
  for (let i = 0; i < prev.msgs.length; i++) {
    if (prev.msgs[i] !== next.msgs[i]) return false
  }
  return true
}

const AgentWorkGroupItem = memo(function AgentWorkGroupItem({
  msgs: groupMsgs,
  sessionId,
  cwd,
  isGroupRunning,
  isTurnFinal,
  turnFileChanges,
  isCopied,
  isForkMenuOpen,
  isForking,
  onCopy,
  onToggleForkMenu,
  onCloseForkMenu,
  onConfirmFork
}: AgentWorkGroupItemProps): JSX.Element {
  const finalMsg = groupMsgs[groupMsgs.length - 1]
  // Session-level running state gates the file revert/redo buttons: writing
  // files while the agent is mid-turn could overwrite in-flight edits.
  const sessionIsRunning = useAgentSessionStore((s) => s.isRunning)

  // 先找组内"最后一个非空 text part"作为 final answer 外显；
  // 其余 text 视为中间过渡，进折叠区。
  let lastTextPart: PiContentPart | null = null
  for (const m of groupMsgs) {
    for (const p of m.content) {
      if (p.type === 'text' && p.text?.trim()) lastTextPart = p
    }
  }
  const assistantText = lastTextPart?.text?.trim() ?? ''

  // 折叠区内容：组内所有 reasoning + tool-group + 非 final 的 text
  const workBlocks: { key: string; node: JSX.Element }[] = []
  const textBlocks: { key: string; node: JSX.Element }[] = []
  let activityPart: PiContentPart | null = null
  for (const m of groupMsgs) {
    const mRunning = m.status === 'running'
    const blocks = groupContentParts(m.content, mRunning)
    blocks.forEach((block, bIdx) => {
      const key = `${m.id}:${bIdx}`
      if (block.type === 'reasoning') {
        if (block.isRunning) activityPart = block.part
        workBlocks.push({
          key,
          node: (
            <ThinkingBlock
              thinking={block.reasoning}
              isRunning={block.isRunning}
            />
          )
        })
      } else if (block.type === 'tool-group') {
        // 运行判定以组级信号为准（agent run 存活即权威），消息级 status 只做辅助。
        // 根因背景：pi 的 message_end 在 tool_execution_start 之前到达，个别形态
        // 下消息的 allToolsDone 会被误判/误翻转；长任务（image_gen 60-90s）期间
        // 若只信消息级 running，工具行会提前停止闪烁并显示"成功"。
        const toolGroupRunning = isGroupRunning || block.isRunning
        const running = block.parts.find(
          (p) => toolGroupRunning && p.result === undefined && !p.isError
        )
        if (running) activityPart = running
        workBlocks.push({
          key,
          node: <ToolGroup parts={block.parts} isRunning={toolGroupRunning} cwd={cwd ?? undefined} />
        })
      } else if (block.type === 'text') {
        if (block.part === lastTextPart) {
          textBlocks.push({
            key,
            node: (
              <div className="w-full">
                <MarkdownRenderer content={block.text} cwd={cwd ?? undefined} />
              </div>
            )
          })
        } else {
          workBlocks.push({
            key,
            node: (
              <div className="py-0.5 text-caption italic text-slate-400 select-text">
                {block.text}
              </div>
            )
          })
        }
      }
    })
  }

  let workDurationMs = finalMsg.turnDurationMs
  if (workDurationMs === undefined && finalMsg.timestamp !== undefined) {
    const end = finalMsg.timestamp + (finalMsg.durationMs ?? 0)
    const firstTs = groupMsgs[0]?.timestamp
    if (firstTs !== undefined) {
      const d = end - firstTs
      if (d > 0) workDurationMs = d
    }
  }

  return (
    <div className="group space-y-2.5 my-2">
      {isGroupRunning && workBlocks.length === 0 && textBlocks.length === 0 && (
        <WorkPhaseBlock isRunning durationMs={undefined}>
          <ThinkingBlock thinking="" isRunning />
        </WorkPhaseBlock>
      )}

      {workBlocks.length > 0 && (
        <WorkPhaseBlock
          isRunning={isGroupRunning}
          durationMs={workDurationMs}
          activity={isGroupRunning && activityPart ? describeActivity(activityPart) : undefined}
        >
          {workBlocks.map((b) => (
            <div key={b.key}>{b.node}</div>
          ))}
        </WorkPhaseBlock>
      )}

      {textBlocks.map((b) => (
        <div key={b.key}>{b.node}</div>
      ))}

      {turnFileChanges && sessionId && cwd && (
        <ChangedFilesCard
          sessionId={sessionId}
          cwd={cwd}
          record={turnFileChanges}
          interactive={!sessionIsRunning}
        />
      )}

      {finalMsg.error && (
        <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-red-600 text-body font-medium dark:bg-rose-500/10 dark:border-rose-500/30 dark:text-rose-300">
          {finalMsg.error}
        </div>
      )}

      {!isGroupRunning && isTurnFinal && (
        <div className="relative flex items-center gap-0.5 -ml-1.5 opacity-0 transition-opacity group-hover:opacity-100">
          <button
            type="button"
            onClick={() => onToggleForkMenu(finalMsg.id)}
            className="flex items-center gap-1 rounded-md px-1.5 py-0.5 text-body text-text-secondary transition-colors hover:bg-gray-100 hover:text-text-primary dark:hover:bg-white/10"
            title="从当前位置创建分支会话"
          >
            <AppIcon name="git_branch" size={16} />
            <span>分支</span>
          </button>
          <AgentPopover
            open={isForkMenuOpen}
            onClose={onCloseForkMenu}
            align="left"
            placement="top"
            className="w-36 py-1"
          >
            <button
              type="button"
              disabled={isForking}
              onClick={() => {
                void onConfirmFork().finally(() => onCloseForkMenu())
              }}
              className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-caption text-text-primary transition-colors hover:bg-gray-50 dark:hover:bg-white/5 disabled:opacity-50"
            >
              <AppIcon
                name={isForking ? 'progress_activity' : 'git_branch'}
                size={14}
                className={`text-primary ${isForking ? 'animate-spin' : ''}`}
              />
              <span>{isForking ? '正在创建分支…' : '创建分支'}</span>
            </button>
          </AgentPopover>
          <button
            type="button"
            onClick={() => onCopy(finalMsg.id, assistantText)}
            className="flex items-center gap-1 rounded-md px-1.5 py-0.5 text-body text-text-secondary transition-colors hover:bg-gray-100 hover:text-text-primary dark:hover:bg-white/10"
            title="复制本轮回复文本"
          >
            <AppIcon name="content_copy" size={16} />
            <span>{isCopied ? '已复制' : '复制'}</span>
          </button>
          {(finalMsg.timestamp || finalMsg.createdAt) && (
            <span
              className="px-1 text-caption text-text-secondary select-none"
              title={
                finalMsg.turnDurationMs !== undefined
                  ? `完成于 ${formatMessageTime(finalMsg.timestamp ?? finalMsg.createdAt!)} · 用时 ${formatDuration(finalMsg.turnDurationMs)}`
                  : `开始于 ${formatMessageTime(finalMsg.timestamp ?? finalMsg.createdAt!)}`
              }
            >
              {formatMessageTime(finalMsg.timestamp ?? finalMsg.createdAt!)}
              {finalMsg.turnDurationMs !== undefined &&
                ` · ${formatDuration(finalMsg.turnDurationMs)}`}
            </span>
          )}
        </div>
      )}
    </div>
  )
}, areWorkGroupPropsEqual)

interface ForkOriginDividerProps {
  parentSessionId?: string
  parentSessionTitle?: string
  parentExists: boolean
  onJumpToParent: (sessionId: string) => void
}

function ForkOriginDivider({
  parentSessionId,
  parentSessionTitle,
  parentExists,
  onJumpToParent
}: ForkOriginDividerProps): JSX.Element {
  const titleText = parentSessionTitle || '原对话'
  const canJump = Boolean(parentExists && parentSessionId)

  return (
    <div className="my-2 flex items-center gap-2 select-none" data-fork-origin-divider>
      <div className="h-px flex-1 bg-gradient-to-r from-transparent via-gray-200 to-gray-200 dark:via-white/15 dark:to-white/15" />
      <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-gray-50/90 dark:bg-white/[0.04] border border-gray-200/80 dark:border-white/10 text-caption text-text-secondary dark:text-gray-400 max-w-[90%]">
        <AppIcon name="git_branch" size={12} className="text-primary shrink-0" />
        <span className="shrink-0">分支自</span>
        {canJump ? (
          <button
            type="button"
            onClick={() => onJumpToParent(parentSessionId!)}
            className="inline-flex items-center gap-0.5 font-medium text-text-primary dark:text-gray-200 hover:text-primary dark:hover:text-blue-400 underline decoration-gray-300 dark:decoration-white/25 underline-offset-2 transition-colors max-w-[160px] truncate"
            title={`点击返回原对话：${titleText}`}
          >
            <span className="truncate">「{titleText}」</span>
            <AppIcon name="arrow_outward" size={12} className="shrink-0" />
          </button>
        ) : (
          <span
            className="truncate max-w-[160px] text-text-secondary/80 dark:text-gray-500"
            title={`原对话已删除：${titleText}`}
          >
            「{titleText}」(原对话已删除)
          </span>
        )}
      </div>
      <div className="h-px flex-1 bg-gradient-to-l from-transparent via-gray-200 to-gray-200 dark:via-white/15 dark:to-white/15" />
    </div>
  )
}

function AgentCard({
  isVisible = true,
  onModelChange,
  headerActions
}: AgentCardProps): JSX.Element {
  const models = useAppStore((s) => s.models)
  const workspacePath = useWorkbenchStore((s) => s.workspacePath)
  const activeFilePath = useWorkbenchStore((s) => s.activeFilePath)
  const closeRightPane = useWorkbenchStore((s) => s.closeRightPane)
  const setWorkspaceFolder = useWorkbenchStore((s) => s.setWorkspaceFolder)

  const messages = useAgentSessionStore((s) => s.messages)
  const isRunning = useAgentSessionStore((s) => s.isRunning)
  const sessions = useAgentSessionStore((s) => s.sessions)
  const currentSessionId = useAgentSessionStore((s) => s.currentSessionId)
  const currentCwd = useAgentSessionStore((s) => s.currentCwd)
  const pendingApprovals = useAgentSessionStore((s) => s.pendingApprovals)
  const setComposerInput = useAgentSessionStore((s) => s.setComposerInput)
  const newSession = useAgentSessionStore((s) => s.newSession)
  const resumeSession = useAgentSessionStore((s) => s.resumeSession)
  const deleteSession = useAgentSessionStore((s) => s.deleteSession)
  const renameSession = useAgentSessionStore((s) => s.renameSession)
  const initListeners = useAgentSessionStore((s) => s.initListeners)
  const fetchSessions = useAgentSessionStore((s) => s.fetchSessions)
  const rewindLastUserMessage = useAgentSessionStore((s) => s.rewindLastUserMessage)
  const forkSession = useAgentSessionStore((s) => s.forkSession)
  const copyText = useAgentSessionStore((s) => s.copyText)
  const foreignReview = useAgentSessionStore((s) => s.foreignReview)
  const setForeignReview = useAgentSessionStore((s) => s.setForeignReview)
  const fileChangesRecord = useAgentSessionStore((s) => s.fileChangesRecord)
  const forkOrigin = useAgentSessionStore((s) => s.forkOrigin)
  const setResumeAfterSwitchCwd = useAgentSessionStore((s) => s.setResumeAfterSwitchCwd)
  const consumeResumeAfterSwitchCwd = useAgentSessionStore((s) => s.consumeResumeAfterSwitchCwd)

  const [historyMenuOpen, setHistoryMenuOpen] = useState(false)
  const [foreignHistoryOpen, setForeignHistoryOpen] = useState(false)
  const [historySearchQuery, setHistorySearchQuery] = useState('')
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; title: string } | null>(null)
  const [renameTarget, setRenameTarget] = useState<{ id: string; title: string } | null>(null)
  /** 历史行"更多"菜单：锚定会话 id + 触发按钮的视口坐标。 */
  const [historyMoreMenu, setHistoryMoreMenu] = useState<{ id: string; x: number; y: number; yUp: number } | null>(null)
  const [historyListToast, setHistoryListToast] = useState<string | null>(null)
  /** 待确认的跨工作区会话：cwd 与当前工作区不一致时先弹窗再恢复。 */
  const [pendingForeignSession, setPendingForeignSession] = useState<{ id: string; cwd: string } | null>(null)
  const [rewindConfirmOpen, setRewindConfirmOpen] = useState(false)
  /** Analysis of the turn about to be abandoned, driving the rewind dialog's choices. */
  const [rewindAnalysis, setRewindAnalysis] = useState<{
    fileCount: number
    revertible: boolean
    blockedReason: string | null
    alreadyUndone: boolean
  } | null>(null)
  const [rewindError, setRewindError] = useState<string | null>(null)
  const [rewindBusy, setRewindBusy] = useState(false)
  const [copiedId, setCopiedId] = useState<string | null>(null)
  const [forkMenuOpenFor, setForkMenuOpenFor] = useState<string | null>(null)
  const [isForking, setIsForking] = useState(false)
  const [forkToast, setForkToast] = useState<{
    sessionId: string
    parentSessionId?: string
    parentSessionTitle?: string
  } | null>(null)
  const isForkingRef = useRef(false)
  const forkToastTimerRef = useRef<number | null>(null)
  const viewportRef = useRef<HTMLDivElement>(null)
  const autoFollowRef = useRef(true)
  const scrollRafRef = useRef<number | null>(null)

  const clearForkToastTimer = useCallback((): void => {
    if (forkToastTimerRef.current !== null) {
      window.clearTimeout(forkToastTimerRef.current)
      forkToastTimerRef.current = null
    }
  }, [])

  const scheduleForkToastDismiss = useCallback((): void => {
    clearForkToastTimer()
    forkToastTimerRef.current = window.setTimeout(() => {
      forkToastTimerRef.current = null
      setForkToast(null)
    }, 4500)
  }, [clearForkToastTimer])

  const dismissForkToast = useCallback((): void => {
    clearForkToastTimer()
    setForkToast(null)
  }, [clearForkToastTimer])

  const handleConfirmFork = useCallback(async (): Promise<void> => {
    if (isForkingRef.current) return
    isForkingRef.current = true
    setIsForking(true)
    try {
      const ok = await forkSession()
      if (ok) {
        const nextState = useAgentSessionStore.getState()
        if (nextState.currentSessionId) {
          setForkToast({
            sessionId: nextState.currentSessionId,
            parentSessionId: nextState.forkOrigin?.parentSessionId,
            parentSessionTitle: nextState.forkOrigin?.parentSessionTitle
          })
          scheduleForkToastDismiss()
        }
      }
    } finally {
      isForkingRef.current = false
      setIsForking(false)
    }
  }, [forkSession, scheduleForkToastDismiss])

  const handleToggleForkMenu = useCallback((msgId: string): void => {
    setForkMenuOpenFor((cur) => (cur === msgId ? null : msgId))
  }, [])

  const handleCloseForkMenu = useCallback((): void => {
    setForkMenuOpenFor(null)
  }, [])

  const handleRewindClick = useCallback(async (): Promise<void> => {
    setRewindError(null)
    // Determine whether the turn about to be abandoned produced file changes.
    // The tracker indexes turns by user-message count, so the count here must
    // mirror it: number of user messages currently in the rendered timeline.
    const state = useAgentSessionStore.getState()
    const userTurnCount = state.messages.filter((m) => m.role === 'user').length
    const record = state.fileChangesRecord
    const recordMatchesTurn =
      record !== null &&
      record.files.length > 0 &&
      (record.turnIndex === undefined ? true : record.turnIndex === userTurnCount)

    if (!recordMatchesTurn || !record || !state.currentSessionId) {
      setRewindAnalysis({ fileCount: 0, revertible: true, blockedReason: null, alreadyUndone: false })
      setRewindConfirmOpen(true)
      return
    }

    if (record.status === 'undone') {
      setRewindAnalysis({ fileCount: record.files.length, revertible: true, blockedReason: null, alreadyUndone: true })
      setRewindConfirmOpen(true)
      return
    }

    if (record.files.some((f) => f.noBaselineBlob)) {
      setRewindAnalysis({
        fileCount: record.files.length,
        revertible: false,
        blockedReason: '包含通过命令修改或超大文件，缺少修改前快照',
        alreadyUndone: false
      })
      setRewindConfirmOpen(true)
      return
    }

    // Files may have been externally modified since the turn ended — a stale
    // file makes a full revert unsafe, so the revert-all choice must be off.
    try {
      const staleRes = await window.api.agentCheckFilesStale(
        state.currentSessionId,
        record.files.map((f) => f.path),
        'target'
      )
      const staleCount = Object.values(staleRes?.data ?? {}).filter(Boolean).length
      if (staleCount > 0) {
        setRewindAnalysis({
          fileCount: record.files.length,
          revertible: false,
          blockedReason: `${staleCount} 个文件已被外部修改`,
          alreadyUndone: false
        })
      } else {
        setRewindAnalysis({ fileCount: record.files.length, revertible: true, blockedReason: null, alreadyUndone: false })
      }
    } catch {
      // Staleness check failed — stay conservative and offer no file revert.
      setRewindAnalysis({
        fileCount: record.files.length,
        revertible: false,
        blockedReason: '无法确认文件当前状态',
        alreadyUndone: false
      })
    }
    setRewindConfirmOpen(true)
  }, [])

  const handleRewindConfirm = useCallback(
    async (revertFiles: boolean): Promise<void> => {
      if (rewindBusy) return
      setRewindBusy(true)
      setRewindError(null)
      try {
        const result = await rewindLastUserMessage({ revertFiles })
        if (result.ok) {
          setRewindConfirmOpen(false)
        } else {
          // Keep the dialog open so the failure (and its reason) stays visible
          // and the user can pick the other option instead.
          setRewindError(result.error ?? '撤回失败')
        }
      } finally {
        setRewindBusy(false)
      }
    },
    [rewindBusy, rewindLastUserMessage]
  )

  const copyTimerRef = useRef<number | null>(null)
  const handleCopy = useCallback(
    (key: string, text: string): void => {
      void copyText(text).then((ok) => {
        if (!ok) return
        setCopiedId(key)
        if (copyTimerRef.current) window.clearTimeout(copyTimerRef.current)
        copyTimerRef.current = window.setTimeout(() => setCopiedId(null), 1500)
      })
    },
    [copyText]
  )

  useEffect(() => {
    const cleanup = initListeners()
    return () => cleanup()
  }, [initListeners])

  const renderItems = useMemo(() => computeRenderItems(messages), [messages])
  const [lightboxIndex, setLightboxIndex] = useState(-1)
  const conversationImages = useMemo(
    () =>
      messages.flatMap((m) => {
        if (m.role !== 'user') return []
        return m.content
          .filter((c) => c.type === 'image' && Boolean(c.data))
          .map((c, idx) => ({
            key: `${m.id}:${idx}`,
            src: c.data!,
            mimeType: c.mimeType || 'image/png'
          }))
      }),
    [messages]
  )
  const conversationLightboxItems = useMemo<LightboxImageItem[]>(
    () =>
      conversationImages.map((img) => ({
        nodeKey: img.key,
        src: img.src,
        altText: '',
        hideTitle: true
      })),
    [conversationImages]
  )
  const handlePreviewUserImage = useCallback(
    (messageId: string, imageIndex: number) => {
      const targetKey = `${messageId}:${imageIndex}`
      const idx = conversationImages.findIndex((img) => img.key === targetKey)
      if (idx >= 0) setLightboxIndex(idx)
    },
    [conversationImages]
  )
  const handleAttachLightboxImage = useCallback((item: LightboxImageItem) => {
    const mimeMatch = item.src.match(/^data:([^;]+);/i)
    const mimeType = mimeMatch?.[1] || 'image/png'
    useAgentSessionStore.getState().addImageAttachment({
      dataUrl: item.src,
      mimeType,
      name: 'image'
    })
  }, [])
  const lastUserMsgId = useMemo(() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role === 'user') return messages[i].id
    }
    return null
  }, [messages])
  const hasPendingApproval = useMemo(
    () => pendingApprovals.some((r) => !currentSessionId || r.sessionId === currentSessionId),
    [pendingApprovals, currentSessionId]
  )

  const prevLastUserMsgIdRef = useRef<string | null>(lastUserMsgId)
  const prevSessionIdRef = useRef<string | null>(currentSessionId)

  const handleViewportScroll = useCallback((): void => {
    if (!isVisible) return
    const el = viewportRef.current
    if (!el) return
    const distanceToBottom = el.scrollHeight - el.scrollTop - el.clientHeight
    autoFollowRef.current = distanceToBottom <= 80
  }, [isVisible])

  // Smart auto-scroll: follow streaming via rAF only when near bottom,
  // and always jump to bottom when the user sends a message or switches session.
  useEffect(() => {
    if (currentSessionId !== prevSessionIdRef.current) {
      prevSessionIdRef.current = currentSessionId
      autoFollowRef.current = true
    }
    if (lastUserMsgId !== prevLastUserMsgIdRef.current) {
      prevLastUserMsgIdRef.current = lastUserMsgId
      if (lastUserMsgId !== null) {
        autoFollowRef.current = true
      }
    }
    if (!isVisible || !autoFollowRef.current) return
    if (!viewportRef.current) return
    if (scrollRafRef.current !== null) return
    scrollRafRef.current = requestAnimationFrame(() => {
      scrollRafRef.current = null
      const el = viewportRef.current
      if (el && autoFollowRef.current) {
        el.scrollTop = el.scrollHeight
      }
    })
  }, [messages, pendingApprovals, isVisible, currentSessionId, lastUserMsgId])

  useEffect(() => {
    return () => {
      if (scrollRafRef.current !== null) {
        cancelAnimationFrame(scrollRafRef.current)
        scrollRafRef.current = null
      }
      if (copyTimerRef.current) {
        window.clearTimeout(copyTimerRef.current)
        copyTimerRef.current = null
      }
      clearForkToastTimer()
    }
  }, [clearForkToastTimer])

  useEffect(() => {
    setForkToast((prev) => (prev && prev.sessionId !== currentSessionId ? null : prev))
    setLightboxIndex(-1)
  }, [currentSessionId])

  // Sync workspacePath to AgentSession (only active/visible instance acts to avoid dual-sidebar double resets)
  const prevWorkspaceRef = useRef<string | null>(workspacePath)
  useEffect(() => {
    if (!isVisible) return
    if (workspacePath && prevWorkspaceRef.current !== null && workspacePath !== prevWorkspaceRef.current) {
      if (consumeResumeAfterSwitchCwd(workspacePath)) {
        prevWorkspaceRef.current = workspacePath
        return
      }
      setForeignReview(false)
      void newSession(workspacePath)
    }
    prevWorkspaceRef.current = workspacePath
  }, [workspacePath, newSession, isVisible, consumeResumeAfterSwitchCwd, setForeignReview])

  useEffect(() => {
    if (!isVisible) return
    // Only reset the draft when the bound workspace actually diverges; a null
    // session id is already the draft state and needs no further reset.
    // 失效工作区回看态下不重置：currentCwd 是失效路径，用户仍在浏览历史消息。
    // 回看态在 cwd 重新对齐工作区时自动退出（回看中新提问会在当前工作区开新会话）。
    if (foreignReview) {
      if (!currentCwd || !workspacePath || normalizePath(currentCwd) === normalizePath(workspacePath)) {
        setForeignReview(false)
      }
      return
    }
    if (workspacePath && currentCwd && normalizePath(currentCwd) !== normalizePath(workspacePath)) {
      void newSession(workspacePath)
    }
  }, [currentCwd, workspacePath, newSession, foreignReview, isVisible, setForeignReview])

  const modelOptions = useMemo<DropdownOption<string>[]>(() => {
    const list: DropdownOption<string>[] = [
      {
        value: 'local-agent',
        label: 'Agent',
        description: '工作台知识与写作智能体'
      }
    ]
    const visibleModels = models.filter((m) => !m.hidden)
    for (const m of visibleModels) {
      list.push({
        value: m.id,
        label: m.name,
        logo: m.logo
      })
    }
    return list
  }, [models])

  const vaultName = useMemo(() => {
    if (!workspacePath) return ''
    const parts = workspacePath.replace(/[/\\]+$/, '').split(/[/\\]/)
    return parts[parts.length - 1] || workspacePath
  }, [workspacePath])

  const activeFileName = useMemo(() => {
    if (!activeFilePath) return ''
    const parts = activeFilePath.split(/[/\\]/)
    return parts[parts.length - 1] || activeFilePath
  }, [activeFilePath])

  const currentSessionTitle = useMemo(() => {
    if (!currentSessionId) return ''
    const title = sessions.find((s) => s.id === currentSessionId)?.title || ''
    return title === '新会话' ? '' : title
  }, [currentSessionId, sessions])

  const activeSessionSummary = useMemo(
    () => (currentSessionId ? sessions.find((s) => s.id === currentSessionId) : undefined),
    [currentSessionId, sessions]
  )

  const branchNumberById = useMemo(() => {
    const grouped = new Map<string, Array<{ id: string; createdAt: number }>>()
    for (const s of sessions) {
      if (!s.parentSessionId) continue
      const list = grouped.get(s.parentSessionId) ?? []
      list.push({ id: s.id, createdAt: s.createdAt })
      grouped.set(s.parentSessionId, list)
    }
    const map = new Map<string, number>()
    for (const list of grouped.values()) {
      list.sort((a, b) => a.createdAt - b.createdAt)
      list.forEach((item, idx) => map.set(item.id, idx + 1))
    }
    return map
  }, [sessions])

  const effectiveForkOrigin = useMemo(() => {
    if (forkOrigin) return forkOrigin
    if (activeSessionSummary?.parentSessionId || activeSessionSummary?.parentSessionTitle) {
      const parentExists = activeSessionSummary.parentSessionId
        ? sessions.some((s) => s.id === activeSessionSummary.parentSessionId)
        : false
      return {
        parentSessionId: activeSessionSummary.parentSessionId,
        parentSessionTitle: activeSessionSummary.parentSessionTitle,
        parentExists
      }
    }
    return null
  }, [forkOrigin, activeSessionSummary, sessions])

  const currentBranchNumber = currentSessionId ? branchNumberById.get(currentSessionId) : undefined
  const canJumpToParent = Boolean(
    effectiveForkOrigin?.parentSessionId && effectiveForkOrigin.parentExists !== false
  )

  const suggestions = useMemo(
    () => [
      {
        icon: 'pen_tool',
        label: '方案大纲起草',
        prompt: '请帮我起草一份结构严谨、逻辑清晰的方案大纲，包含核心目标、实施要点与具体步骤：'
      },
      {
        icon: 'auto_awesome',
        label: activeFileName ? '润色当前文档' : '文档深度润色',
        prompt: activeFilePath
          ? `请结合当前正在编辑的文档 @${activeFilePath}，帮我进行深度润色与结构优化，修正错别字与语病，提升专业度并保持行文连贯。`
          : '请帮我润色以下内容，修正语法与冗余表达，提升专业度并保持行文连贯：\n\n'
      },
      {
        icon: 'checklist',
        label: '提炼要点与待办',
        prompt: activeFilePath
          ? `请阅读当前文档 @${activeFilePath}，帮我提炼核心要点与关键结论，并整理出清晰的后续待办清单（Action Items）。`
          : '请帮我提炼长文材料的核心要点与关键结论，并整理出清晰的后续待办清单（Action Items）：\n\n'
      },
      {
        icon: 'auto_stories',
        label: '知识库脉络梳理',
        prompt: '请结合当前知识库中的笔记与文档，帮我梳理主要的主题内容与知识关联脉络。'
      }
    ],
    [activeFileName, activeFilePath]
  )

  const handleFillPrompt = useCallback(
    (promptText: string): void => {
      setComposerInput(promptText)
      setTimeout(() => {
        const textarea = viewportRef.current?.parentElement?.querySelector('textarea')
        if (textarea) {
          textarea.focus()
          const len = promptText.length
          textarea.setSelectionRange(len, len)
        }
      }, 0)
    },
    [setComposerInput]
  )

  const handleNewSession = useCallback((): void => {
    setHistoryMenuOpen(false)
    void newSession(workspacePath || undefined)
  }, [newSession, workspacePath])

  const handleSelectSession = useCallback(
    (sessionId: string): void => {
      setHistoryMenuOpen(false)
      if (sessionId !== currentSessionId) {
        const session = sessions.find((s) => s.id === sessionId)
        const sessionCwd = session?.cwd
        // 跨工作区会话：先弹窗确认；失效路径走只读回看；同工作区直接恢复。
        if (sessionCwd && normalizePath(sessionCwd) !== normalizePath(workspacePath)) {
          setPendingForeignSession({ id: sessionId, cwd: sessionCwd })
          return
        }
        void resumeSession(sessionId)
      }
    },
    [currentSessionId, resumeSession, sessions, workspacePath]
  )

  const handleConfirmForeignSession = useCallback(async (): Promise<void> => {
    const pending = pendingForeignSession
    setPendingForeignSession(null)
    if (!pending) return
    // 标记"接下来发生的工作区切换是为了 resume 这条会话"，effect1 见标记跳过 draft 重置。
    setResumeAfterSwitchCwd(pending.cwd)
    const result = await setWorkspaceFolder(pending.cwd)
    if (result === 'switched') {
      setForeignReview(false)
      void resumeSession(pending.id)
      return
    }
    setResumeAfterSwitchCwd(null)
    // 用户取消（可视化编辑未保存选择留下）：不进回看，保持现状。
    if (result === 'cancelled') return
    // 目录失效（已删除/改名/盘符脱机）：setWorkspaceFolder 的 error 通道已提示；
    // 降级为只读回看——不切工作区直接恢复消息，标记豁免防 effect 清空。
    setForeignReview(true)
    void resumeSession(pending.id)
  }, [pendingForeignSession, resumeSession, setWorkspaceFolder, setResumeAfterSwitchCwd, setForeignReview])

  const handleConfirmDeleteSession = useCallback(async (): Promise<void> => {
    if (!deleteTarget) return
    await deleteSession(deleteTarget.id)
    setDeleteTarget(null)
  }, [deleteTarget, deleteSession])

  const historyToastTimerRef = useRef<number | null>(null)
  const showHistoryToast = useCallback((text: string): void => {
    setHistoryListToast(text)
    if (historyToastTimerRef.current) window.clearTimeout(historyToastTimerRef.current)
    historyToastTimerRef.current = window.setTimeout(() => setHistoryListToast(null), 2500)
  }, [])

  // 历史行"更多"菜单：点击外部 / Esc 关闭。
  useEffect(() => {
    if (!historyMoreMenu) return
    const onPointerDown = (e: MouseEvent): void => {
      // 菜单内部与"更多"触发按钮的按下不算"外部"：否则 capture 阶段先卸载菜单，
      // 菜单项的 click 将落在已脱离文档的节点上而无法触发。
      const target = e.target as HTMLElement | null
      if (target?.closest?.('[data-history-more-menu], [data-history-more-trigger]')) return
      setHistoryMoreMenu(null)
    }
    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        setHistoryMoreMenu(null)
      }
    }
    window.addEventListener('mousedown', onPointerDown, true)
    window.addEventListener('keydown', onKeyDown, true)
    return () => {
      window.removeEventListener('mousedown', onPointerDown, true)
      window.removeEventListener('keydown', onKeyDown, true)
    }
  }, [historyMoreMenu])

  const handleCopySession = useCallback(
    async (sessionId: string, kind: 'transcript' | 'path'): Promise<void> => {
      setHistoryMoreMenu(null)
      try {
        const res = await window.api.agentGetSessionExport(sessionId)
        if (!res.success || !res.data) {
          showHistoryToast(res.error || '读取会话失败')
          return
        }
        if (kind === 'transcript') {
          if (!res.data.transcript.trim()) {
            showHistoryToast('该会话还没有对话内容')
            return
          }
          const ok = await copyText(res.data.transcript)
          showHistoryToast(ok ? '对话已复制' : '复制失败')
        } else {
          if (!res.data.filePath) {
            showHistoryToast('该会话还没有落盘文件')
            return
          }
          const ok = await copyText(res.data.filePath)
          showHistoryToast(ok ? '路径已复制' : '复制失败')
        }
      } catch (err) {
        console.warn('[AgentCard] copy session export failed:', err)
        showHistoryToast('复制失败')
      }
    },
    [copyText, showHistoryToast]
  )

  return (
    <div className="flex flex-col h-full bg-white dark:bg-gray-900 overflow-hidden">
      <div className="relative p-3 border-b border-gray-200/60 dark:border-white/10 bg-white dark:bg-gray-900 flex justify-between items-center shrink-0">
        <div>
          <CustomDropdown
            value="local-agent"
            disabled={isRunning}
            onChange={(modelId): void => {
              if (modelId !== 'local-agent') {
                onModelChange?.(modelId)
              }
            }}
            placeholder="Agent"
            className="relative"
            dropdownWidth="w-48"
            buttonClassName={`flex items-center justify-between gap-2 rounded-lg px-2 py-1 -ml-2 transition-colors ${isRunning ? 'opacity-50 cursor-not-allowed' : 'hover:bg-gray-100 dark:hover:bg-gray-800'}`}
            renderButton={(): JSX.Element => (
              <div className="flex items-center gap-2">
                <img src={agentAvatar} alt="Agent" className="w-6 h-6 shrink-0" />
                <h2 className="text-body-lg font-semibold text-text-primary">Agent</h2>
              </div>
            )}
            renderOption={(option, _isSelected, onSelect): JSX.Element => {
              const model = models.find((m) => m.id === option.value)
              const hasDeepResearch = model && DEEP_RESEARCH_SUPPORTED_MODEL_IDS.has(model.id)
              const hasImageGen = model && IMAGE_GENERATION_SUPPORTED_MODEL_IDS.has(model.id)
              const isLocalAgent = option.value === 'local-agent'
              return (
                <button
                  type="button"
                  onClick={onSelect}
                  className="w-full flex items-center justify-between gap-3 px-3 py-2 hover:bg-black/[0.05] dark:hover:bg-white/[0.08] transition-colors text-left"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    {option.logo ? (
                      <img
                        alt={model?.name || option.label}
                        className="w-5 h-5 shrink-0"
                        src={model?.logo || option.logo}
                      />
                    ) : isLocalAgent ? (
                      <img src={agentAvatar} alt="Agent" className="w-5 h-5 shrink-0" />
                    ) : null}
                    <span className="text-text-primary text-body truncate">{option.label}</span>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    {hasDeepResearch && (
                      <AppIcon name="biotech" size={16} className="text-gray-400 hover:text-gray-600 transition-colors" title="深度研究" />
                    )}
                    {hasImageGen && (
                      <AppIcon name="image" size={16} className="text-gray-400 hover:text-gray-600 transition-colors" title="AI 生图" />
                    )}
                  </div>
                </button>
              )
            }}
            options={modelOptions}
          />
        </div>

        {(currentSessionTitle || effectiveForkOrigin) && (
          <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 max-w-[42%] px-2 flex items-center gap-1.5 justify-center">
            {effectiveForkOrigin && (
              <button
                type="button"
                disabled={!canJumpToParent}
                onClick={() => {
                  if (effectiveForkOrigin.parentSessionId && canJumpToParent) {
                    handleSelectSession(effectiveForkOrigin.parentSessionId)
                  }
                }}
                className={`shrink-0 inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full bg-blue-50 dark:bg-primary/20 text-primary dark:text-blue-300 text-tiny font-semibold border border-blue-200/70 dark:border-primary/30 transition-colors ${
                  canJumpToParent
                    ? 'hover:bg-blue-100 dark:hover:bg-primary/30 cursor-pointer'
                    : 'cursor-default opacity-80'
                }`}
                title={
                  canJumpToParent
                    ? `分支自「${effectiveForkOrigin.parentSessionTitle || '原对话'}」· 点击返回原对话`
                    : `分支自「${effectiveForkOrigin.parentSessionTitle || '原对话'}」(原对话已删除)`
                }
              >
                <AppIcon name="git_branch" size={12} />
                <span>{currentBranchNumber ? `分支 #${currentBranchNumber}` : '分支'}</span>
              </button>
            )}
            {currentSessionTitle && (
              <span
                className="block truncate text-label text-text-secondary min-w-0 pointer-events-none"
                title={currentSessionTitle}
              >
                {currentSessionTitle}
              </span>
            )}
          </div>
        )}

          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={handleNewSession}
              className="w-7 h-7 rounded-full flex items-center justify-center text-text-secondary hover:text-text-primary hover:bg-black/5 dark:hover:bg-white/10 transition-all duration-200"
              title="新建会话"
              aria-label="新建会话"
            >
              <AppIcon name="new_session" size={20} />
            </button>

            <div className="relative flex items-center justify-center">
              <button
                type="button"
                onClick={() => {
                  const nextOpen = !historyMenuOpen
                  setHistoryMenuOpen(nextOpen)
                  if (nextOpen) {
                    setForeignHistoryOpen(false)
                    setHistorySearchQuery('')
                    void fetchSessions()
                  }
                }}
                className={`w-7 h-7 rounded-full flex items-center justify-center transition-all duration-200 ${
                  historyMenuOpen
                    ? 'text-primary bg-blue-50 hover:bg-blue-100 dark:bg-primary/20 dark:hover:bg-primary/25'
                    : 'text-text-secondary hover:text-text-primary hover:bg-black/5 dark:hover:bg-white/10'
                }`}
                title="对话历史"
                aria-label="对话历史"
              >
                <AppIcon name="history" size={20} />
              </button>

              <AgentPopover
                open={historyMenuOpen}
                onClose={() => setHistoryMenuOpen(false)}
                align="right"
                placement="bottom"
                className="w-80 max-h-[80vh] flex flex-col text-text-primary"
              >
                    <div className="px-3.5 py-2.5 flex items-center justify-between border-b border-gray-100 dark:border-gray-700/60 shrink-0">
                      <span className="text-body font-semibold text-text-primary dark:text-gray-100 tracking-tight">
                        对话历史
                      </span>
                      <button
                        type="button"
                        onClick={handleNewSession}
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-primary hover:bg-primary/90 text-white text-label font-medium shadow-sm transition-all active:scale-95"
                      >
                        <AppIcon name="add" size={14} strokeWidth={2.5} />
                        <span>新对话</span>
                      </button>
                    </div>

                    <div className="px-3 py-2 border-b border-gray-100 dark:border-gray-700/60 bg-gray-50/50 dark:bg-slate-800/50 shrink-0">
                      <div className="flex items-center gap-2 px-2.5 py-1.5 bg-white dark:bg-slate-700/60 rounded-lg border border-gray-200/70 dark:border-gray-600/60 focus-within:border-primary/60 transition-colors">
                        <AppIcon name="search" size={14} className="text-text-secondary/60 shrink-0" />
                        <input
                          type="text"
                          value={historySearchQuery}
                          onChange={(e) => setHistorySearchQuery(e.target.value)}
                          placeholder="搜索历史对话..."
                          className="w-full bg-transparent text-label text-text-primary dark:text-gray-100 placeholder:text-text-secondary/50 focus:outline-none"
                        />
                        {historySearchQuery && (
                          <button
                            type="button"
                            onClick={() => setHistorySearchQuery('')}
                            className="text-text-secondary/60 hover:text-text-primary p-0.5 rounded"
                          >
                            <AppIcon name="close" size={12} />
                          </button>
                        )}
                      </div>
                    </div>

                    {historyMenuOpen && (() => {
                      const query = historySearchQuery.trim().toLowerCase()
                      const matchesQuery = (item: (typeof sessions)[number]) => {
                        if (!query) return true
                        const title = (item.title || '').toLowerCase()
                        const name = (item.name || '').toLowerCase()
                        const branchPrompt = (item.firstBranchMessage || '').toLowerCase()
                        const parentTitle = (item.parentSessionTitle || '').toLowerCase()
                        const model = (item.model || '').toLowerCase()
                        const cwd = (item.cwd || '').toLowerCase()
                        return (
                          title.includes(query) ||
                          name.includes(query) ||
                          branchPrompt.includes(query) ||
                          parentTitle.includes(query) ||
                          model.includes(query) ||
                          cwd.includes(query)
                        )
                      }

                      const currentWorkspaceSessions = sessions
                        .filter(
                          (item) => !item.cwd || normalizePath(item.cwd) === normalizePath(workspacePath)
                        )
                        .filter(matchesQuery)
                      const foreignWorkspaceSessions = sessions
                        .filter(
                          (item) => item.cwd && normalizePath(item.cwd) !== normalizePath(workspacePath)
                        )
                        .filter(matchesQuery)

                      const isForeignSectionOpen = foreignHistoryOpen || Boolean(query)

                      interface HistoryTreeRow {
                        item: (typeof sessions)[number]
                        depth: number
                        isLastChild: boolean
                        hasChildren: boolean
                        ancestorLineContinuing: boolean
                      }

                      const buildTreeRows = (list: (typeof sessions)): HistoryTreeRow[] => {
                        if (query) {
                          return list.map((item) => ({
                            item,
                            depth: 0,
                            isLastChild: true,
                            hasChildren: false,
                            ancestorLineContinuing: false
                          }))
                        }
                        const presentIds = new Set(list.map((s) => s.id))
                        const childrenByParent = new Map<string, (typeof sessions)>()
                        const roots: (typeof sessions) = []
                        for (const s of list) {
                          if (s.parentSessionId && presentIds.has(s.parentSessionId)) {
                            const arr = childrenByParent.get(s.parentSessionId) ?? []
                            arr.push(s)
                            childrenByParent.set(s.parentSessionId, arr)
                          } else {
                            roots.push(s)
                          }
                        }
                        const rows: HistoryTreeRow[] = []
                        const visited = new Set<string>()
                        const walk = (
                          item: (typeof sessions)[number],
                          depth: number,
                          isLastChild: boolean,
                          ancestorLineContinuing: boolean
                        ) => {
                          if (visited.has(item.id)) return
                          visited.add(item.id)
                          const children = childrenByParent.get(item.id) ?? []
                          rows.push({
                            item,
                            depth,
                            isLastChild,
                            hasChildren: children.length > 0,
                            ancestorLineContinuing
                          })
                          children.forEach((child, idx) => {
                            walk(child, Math.min(depth + 1, 2), idx === children.length - 1, !isLastChild)
                          })
                        }
                        roots.forEach((root, idx) => walk(root, 0, idx === roots.length - 1, false))
                        return rows
                      }

                      const renderSessionRow = (row: HistoryTreeRow, isForeign: boolean) => {
                        const { item, depth, isLastChild } = row
                        const isCurrent = item.id === currentSessionId
                        const isItemRunning = item.isRunning ?? false
                        const isFork = Boolean(item.parentSessionId || item.parentSessionTitle)
                        const branchNo = branchNumberById.get(item.id)
                        const foreignWorkspace = isForeign && item.cwd ? baseName(item.cwd) : null
                        const dateStr = item.updatedAt
                          ? new Date(item.updatedAt).toLocaleTimeString([], {
                              hour: '2-digit',
                              minute: '2-digit'
                            })
                          : ''
                        const isNested = depth > 0
                        const isPendingBranch = isFork && !item.name && !item.firstBranchMessage
                        const primaryLabel = isNested
                          ? (item.name || item.firstBranchMessage || '待继续提问…')
                          : isFork
                            ? (item.name || item.firstBranchMessage || item.title || '新对话')
                            : (item.title || '新对话')
                        const indentClass = depth === 0 ? 'px-3.5' : depth === 1 ? 'pl-8 pr-3.5' : 'pl-11 pr-3.5'

                        return (
                          <div
                            key={item.id}
                            onClick={() => handleSelectSession(item.id)}
                            className={`relative group ${indentClass} ${isNested ? 'py-2' : 'py-2.5'} cursor-pointer flex items-start gap-2.5 transition-colors ${
                              isCurrent
                                ? 'bg-primary/10 hover:bg-primary/15 dark:bg-primary/15 dark:hover:bg-primary/20'
                                : 'hover:bg-black/[0.05] dark:hover:bg-white/[0.08]'
                            }`}
                          >
                            {/* 树形连接线：父行从自身图标底部向下引竖线，子行竖线与其对齐衔接，
                                横向短线延伸到子图标边缘。AppIcon 有 0.85 光学缩放，size=16 的
                                实际渲染盒为 13.6px，竖线包壳宽度与图标盒对齐保证中心重合。 */}
                            {!isNested && row.hasChildren && (
                              <span className="pointer-events-none absolute left-3.5 top-[25px] bottom-0 flex w-[13.6px] justify-center">
                                <span className="w-px h-full bg-gray-200 dark:bg-white/15" />
                              </span>
                            )}
                            {isNested && (
                              <>
                                <span
                                  className={`pointer-events-none absolute top-0 flex w-[13.6px] justify-center ${
                                    depth === 1 ? 'left-3.5' : 'left-8'
                                  } ${
                                    isLastChild ? 'h-[17px]' : 'bottom-0'
                                  }`}
                                >
                                  <span className="w-px h-full bg-gray-200 dark:bg-white/15" />
                                </span>
                                <span
                                  className={`pointer-events-none absolute top-4 h-px bg-gray-200 dark:bg-white/15 ${
                                    depth === 1 ? 'left-[21px] w-[11px]' : 'left-[39px] w-[5px]'
                                  }`}
                                />
                                {depth === 1 && row.hasChildren && (
                                  <span className="pointer-events-none absolute left-8 top-[23px] bottom-0 flex w-[13.6px] justify-center">
                                    <span className="w-px h-full bg-gray-200 dark:bg-white/15" />
                                  </span>
                                )}
                                {depth === 2 && row.ancestorLineContinuing && (
                                  <span className="pointer-events-none absolute left-3.5 top-0 bottom-0 flex w-[13.6px] justify-center">
                                    <span className="w-px h-full bg-gray-200 dark:bg-white/15" />
                                  </span>
                                )}
                              </>
                            )}
                            <AppIcon
                              name={isFork ? 'git_branch' : 'chat'}
                              size={16}
                              className={`shrink-0 mt-0.5 ${
                                isFork ? 'text-primary' : 'text-text-secondary dark:text-gray-400'
                              }`}
                            />
                            <div className="min-w-0 flex-1">
                              <div className="flex items-center gap-1.5 min-w-0">
                                {isFork && (
                                  <span className="shrink-0 px-1.5 rounded-full bg-blue-50 dark:bg-primary/20 text-primary dark:text-blue-300 text-tiny font-semibold">
                                    {branchNo ? `#${branchNo}` : '分支'}
                                  </span>
                                )}
                                <span
                                  className={`truncate leading-snug ${
                                    isNested ? 'text-label font-medium' : 'text-body font-medium'
                                  } ${
                                    isPendingBranch
                                      ? 'text-text-secondary dark:text-gray-400 italic font-normal'
                                      : 'text-text-primary dark:text-gray-100'
                                  }`}
                                  title={primaryLabel}
                                >
                                  {primaryLabel}
                                </span>
                              </div>
                              <div className="text-caption font-mono text-text-secondary dark:text-gray-400 mt-1 flex items-center gap-1.5">
                                <span>{[dateStr, item.model].filter(Boolean).join(' · ')}</span>
                                {foreignWorkspace && (
                                  <span
                                    className="inline-flex items-center gap-1 text-text-secondary/70 truncate max-w-[130px]"
                                    title={item.cwd}
                                  >
                                    <AppIcon name="folder" size={12} className="shrink-0" />
                                    <span className="truncate">{foreignWorkspace}</span>
                                  </span>
                                )}
                              </div>
                              {isFork && !isNested && item.parentSessionTitle && (
                                <div className="text-caption text-text-secondary/80 dark:text-gray-400 mt-0.5 truncate">
                                  分支自「{item.parentSessionTitle}」
                                </div>
                              )}
                            </div>
                            {isItemRunning && (
                              <AppIcon
                                name="progress_activity"
                                size={14}
                                className="shrink-0 mt-0.5 text-primary animate-spin"
                              />
                            )}
                            {/* 行内操作浮层：不占布局宽度，仅 hover 该行时浮现，盖住右侧长文本。 */}
                            <div
                              className={`absolute right-2 top-1/2 -translate-y-1/2 z-10 flex items-center gap-0.5 rounded-lg bg-white dark:bg-slate-800 shadow-sm border border-gray-200/70 dark:border-white/10 px-1 py-0.5 transition-opacity duration-150 ${
                                historyMoreMenu?.id === item.id
                                  ? 'opacity-100'
                                  : 'opacity-0 pointer-events-none group-hover:opacity-100 group-hover:pointer-events-auto'
                              }`}
                            >
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation()
                                  setRenameTarget({ id: item.id, title: item.name || item.title || '' })
                                }}
                                className="p-1 rounded-md text-gray-400 hover:text-primary hover:bg-blue-50 dark:hover:bg-primary/20 transition-colors"
                                title="重命名"
                              >
                                <AppIcon name="edit" size={14} />
                              </button>
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation()
                                  setDeleteTarget({ id: item.id, title: item.title || '新对话' })
                                }}
                                className="p-1 rounded-md text-gray-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/30 transition-colors"
                                title="删除会话"
                              >
                                <AppIcon name="delete" size={14} />
                              </button>
                              <button
                                type="button"
                                data-history-more-trigger
                                onClick={(e) => {
                                  e.stopPropagation()
                                  const rect = e.currentTarget.getBoundingClientRect()
                                  setHistoryMoreMenu(
                                    historyMoreMenu?.id === item.id
                                      ? null
                                      : { id: item.id, x: rect.right, y: rect.bottom + 4, yUp: rect.top - 4 }
                                  )
                                }}
                                className={`p-1 rounded-md transition-colors ${
                                  historyMoreMenu?.id === item.id
                                    ? 'text-primary bg-blue-50 dark:bg-primary/20'
                                    : 'text-gray-400 hover:text-primary hover:bg-blue-50 dark:hover:bg-primary/20'
                                }`}
                                title="更多"
                              >
                                <AppIcon name="more_horiz" size={14} />
                              </button>
                            </div>
                          </div>
                        )
                      }

                      const currentRows = buildTreeRows(currentWorkspaceSessions)
                      const foreignRows = buildTreeRows(foreignWorkspaceSessions)

                      return (
                        <>
                          <div className="max-h-[380px] overflow-y-auto py-1">
                            {currentRows.length === 0 ? (
                              <div className="px-3 py-4 text-center text-text-secondary text-caption">
                                {query ? '无匹配对话' : '暂无历史对话'}
                              </div>
                            ) : (
                              currentRows.map((row) => renderSessionRow(row, false))
                            )}
                          </div>

                          {foreignRows.length > 0 && (
                            <div className="border-t border-gray-100 dark:border-gray-700/70 bg-gray-50/50 dark:bg-slate-800/80 shrink-0">
                              <button
                                type="button"
                                onClick={() => setForeignHistoryOpen(!foreignHistoryOpen)}
                                className="w-full px-3.5 py-2.5 flex items-center gap-2 text-text-secondary hover:text-text-primary hover:bg-black/[0.05] dark:hover:bg-white/[0.08] cursor-pointer select-none transition-colors"
                              >
                                <AppIcon
                                  name={isForeignSectionOpen ? 'expand_more' : 'chevron_right'}
                                  size={15}
                                  className="text-text-secondary transition-transform"
                                />
                                <span className="text-label font-medium">其他工作区</span>
                              </button>
                              {isForeignSectionOpen && (
                                <div className="border-t border-gray-100 dark:border-gray-700/60 max-h-60 overflow-y-auto py-1 bg-white dark:bg-slate-800">
                                  {foreignRows.map((row) => renderSessionRow(row, true))}
                                </div>
                              )}
                            </div>
                          )}
                        </>
                      )
                    })()}

                    {/* 复制结果反馈：吸附在列表底部，不占布局。 */}
                    {historyListToast && (
                      <div className="absolute bottom-2.5 left-1/2 -translate-x-1/2 z-10 px-3 py-1.5 rounded-full bg-gray-800/90 dark:bg-black/80 text-white text-caption whitespace-nowrap shadow-lg pointer-events-none">
                        {historyListToast}
                      </div>
                    )}
              </AgentPopover>
            </div>

            {/* 历史行"更多"菜单：fixed 定位避免被 popover 的 overflow 裁剪。 */}
            {historyMoreMenu && (
              <div
                key={historyMoreMenu.id}
                data-history-more-menu
                onMouseDown={(e) => e.stopPropagation()}
                onClick={(e) => e.stopPropagation()}
                className={`fixed z-modal liquid-glass-menu rounded-xl py-1 min-w-[148px] text-label text-text-primary shadow-float context-menu-animate ${
                  historyMoreMenu.y + 72 < window.innerHeight
                    ? 'context-menu-origin-top-right'
                    : 'context-menu-animate-up context-menu-origin-bottom-right'
                }`}
                style={
                  historyMoreMenu.y + 72 < window.innerHeight
                    ? {
                        top: historyMoreMenu.y,
                        right: Math.max(8, window.innerWidth - historyMoreMenu.x)
                      }
                    : {
                        bottom: Math.max(8, window.innerHeight - historyMoreMenu.yUp),
                        right: Math.max(8, window.innerWidth - historyMoreMenu.x)
                      }
                }
              >
                <button
                  type="button"
                  onClick={() => void handleCopySession(historyMoreMenu.id, 'transcript')}
                  className="w-full px-3 py-1.5 flex items-center gap-2 text-left hover:bg-black/[0.05] dark:hover:bg-white/[0.08] transition-colors"
                >
                  <AppIcon name="content_copy" size={14} className="text-text-secondary shrink-0" />
                  <span>复制对话</span>
                </button>
                <button
                  type="button"
                  onClick={() => void handleCopySession(historyMoreMenu.id, 'path')}
                  className="w-full px-3 py-1.5 flex items-center gap-2 text-left hover:bg-black/[0.05] dark:hover:bg-white/[0.08] transition-colors"
                >
                  <AppIcon name="link" size={14} className="text-text-secondary shrink-0" />
                  <span>复制文件路径</span>
                </button>
              </div>
            )}

            {headerActions || (
              <button
                type="button"
                onClick={closeRightPane}
                className="w-7 h-7 rounded-full flex items-center justify-center text-text-secondary hover:text-text-primary hover:bg-black/5 dark:hover:bg-white/10 transition-all duration-200"
                title="折叠 AI 侧边栏"
                aria-label="折叠 AI 侧边栏"
              >
                <AppIcon name="right_panel_close" size={20} />
              </button>
            )}
          </div>
        </div>

        <div className="flex-1 flex flex-col min-h-0 relative">
          {forkToast && forkToast.sessionId === currentSessionId && (
            <div
              onMouseEnter={clearForkToastTimer}
              onMouseLeave={scheduleForkToastDismiss}
              className="pointer-events-auto absolute top-3 left-1/2 -translate-x-1/2 z-popover max-w-[92%] liquid-glass-menu rounded-full pl-3 pr-2 py-1.5 flex items-center gap-2 text-caption text-text-primary dark:text-gray-100 shadow-float"
            >
              <span className="w-4 h-4 rounded-full bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 flex items-center justify-center shrink-0">
                <AppIcon name="check" size={12} />
              </span>
              <span className="truncate">已创建并切换至新分支</span>
              {forkToast.parentSessionId && (
                <button
                  type="button"
                  onClick={() => {
                    dismissForkToast()
                    handleSelectSession(forkToast.parentSessionId!)
                  }}
                  className="px-2 py-0.5 rounded-full bg-primary/10 hover:bg-primary/20 text-primary dark:text-blue-300 font-medium transition-colors shrink-0"
                >
                  回原对话
                </button>
              )}
              <button
                type="button"
                onClick={dismissForkToast}
                className="p-0.5 rounded-full text-text-secondary hover:text-text-primary dark:hover:text-gray-200 transition-colors shrink-0"
                aria-label="关闭提示"
              >
                <AppIcon name="close" size={12} />
              </button>
            </div>
          )}

          {/* 失效工作区回看提示：cwd 已失效的会话恢复后，新消息会在当前工作区开新会话 */}
          {foreignReview && (
            <div className="px-5 pt-2 shrink-0">
              <div className="text-caption text-text-secondary bg-gray-50 border border-gray-200/60 rounded-lg px-3 py-1.5 dark:bg-white/5 dark:border-white/10">
                回看已失效工作区的对话 · 新消息将在当前工作区开始新对话
              </div>
            </div>
          )}
          <div className="flex-1 flex flex-col min-h-0 relative">
            <div
              ref={viewportRef}
              onScroll={handleViewportScroll}
              className="flex-1 overflow-y-auto px-5 py-3 space-y-3"
            >
              {(() => {
              const totalRenderableCount = renderItems.reduce(
                (sum, item) => sum + (item.kind === 'user' ? 1 : item.msgs.length),
                0
              )
              const inheritedCount = effectiveForkOrigin?.inheritedMessageCount
              const hasKnownBoundary = inheritedCount !== undefined
              const targetBoundaryCount = hasKnownBoundary
                ? Math.min(Math.max(0, inheritedCount), totalRenderableCount)
                : undefined

              let cumulativeCount = 0
              let dividerInserted = false
              const forkDividerEl = effectiveForkOrigin ? (
                <ForkOriginDivider
                  key="fork-origin-divider"
                  parentSessionId={effectiveForkOrigin.parentSessionId}
                  parentSessionTitle={effectiveForkOrigin.parentSessionTitle}
                  parentExists={canJumpToParent}
                  onJumpToParent={handleSelectSession}
                />
              ) : null

              const showDividerAtTop =
                Boolean(forkDividerEl) &&
                ((hasKnownBoundary && targetBoundaryCount === 0) ||
                  (!hasKnownBoundary && renderItems.length > 0))
              if (showDividerAtTop) {
                dividerInserted = true
              }

              return (
                <>
                  {showDividerAtTop && forkDividerEl}
                  {renderItems.map((item) => {
                    const prevCount = cumulativeCount
                    cumulativeCount += item.kind === 'user' ? 1 : item.msgs.length
                    const insertDividerAfter =
                      Boolean(forkDividerEl) &&
                      !dividerInserted &&
                      targetBoundaryCount !== undefined &&
                      targetBoundaryCount > 0 &&
                      prevCount < targetBoundaryCount &&
                      cumulativeCount >= targetBoundaryCount
                    if (insertDividerAfter) {
                      dividerInserted = true
                    }

                    if (item.kind === 'user') {
                      const canRewind = !isRunning && item.isLastUserMessage
                      return (
                        <Fragment key={item.msg.id}>
                          <AgentUserMessageItem
                            message={item.msg}
                            cwd={currentCwd ?? undefined}
                            canRewind={canRewind}
                            isCopied={copiedId === item.msg.id}
                            onCopy={handleCopy}
                            onRewindClick={handleRewindClick}
                            onPreviewImage={handlePreviewUserImage}
                          />
                          {insertDividerAfter && forkDividerEl}
                        </Fragment>
                      )
                    }

                    const finalMsg = item.msgs[item.msgs.length - 1]
                    const isGroupRunning =
                      item.hasRunningMsg || (item.isLatestGroup && (isRunning || hasPendingApproval))
                    const turnFileChanges =
                      !isGroupRunning &&
                      item.isTurnFinal &&
                      currentSessionId &&
                      currentCwd &&
                      fileChangesRecord &&
                      fileChangesRecord.files.length > 0 &&
                      (fileChangesRecord.turnIndex !== undefined
                        ? fileChangesRecord.turnIndex === item.messageTurnIndex
                        : item.isLastTurnFinal)
                        ? fileChangesRecord
                        : null
                    const isForkMenuOpen = forkMenuOpenFor === finalMsg.id

                    return (
                      <Fragment key={item.firstMsgId}>
                        <AgentWorkGroupItem
                          msgs={item.msgs}
                          sessionId={currentSessionId}
                          cwd={currentCwd}
                          isGroupRunning={isGroupRunning}
                          isTurnFinal={item.isTurnFinal}
                          turnFileChanges={turnFileChanges}
                          isCopied={copiedId === finalMsg.id}
                          isForkMenuOpen={isForkMenuOpen}
                          isForking={isForkMenuOpen ? isForking : false}
                          onCopy={handleCopy}
                          onToggleForkMenu={handleToggleForkMenu}
                          onCloseForkMenu={handleCloseForkMenu}
                          onConfirmFork={handleConfirmFork}
                        />
                        {insertDividerAfter && forkDividerEl}
                      </Fragment>
                    )
                  })}
                </>
              )
            })()}

            {/* 用户消息已发出、assistant message_start 还没到的间隙 */}
            {isRunning &&
              messages.length > 0 &&
              messages[messages.length - 1].role === 'user' && (
                <div className="my-2">
                  <ThinkingBlock thinking="" isRunning />
                </div>
              )}

            {pendingApprovals.map((req) => (
              <ApprovalCard key={req.requestId} request={req} />
            ))}
            </div>

            {/* 空态欢迎区脱离 flex-1 高度流，避免底部输入框粘贴图片或换行增高时挤压居中偏移 */}
            {messages.length === 0 && pendingApprovals.length === 0 && (
              <div className="absolute inset-x-0 top-0 bottom-[124px] overflow-y-auto px-5 py-3">
                <div className="min-h-full flex flex-col items-center justify-center text-center p-6 select-none">
                  <div className="relative mb-4 flex items-center justify-center">
                    <img src={agentAvatar} alt="Agent" className="w-12 h-12 avatar-breathing select-none" />
                  </div>

                  <h3 className="font-semibold text-text-primary text-title tracking-tight mb-2">
                    今天想梳理或写点什么？
                  </h3>

                  {workspacePath ? (
                    <div
                      className="inline-flex items-center gap-1.5 text-caption text-text-secondary bg-gray-100 dark:bg-gray-800 hover:bg-gray-200/80 dark:hover:bg-gray-700 px-3 py-1 rounded-full border border-gray-200/60 dark:border-white/10 transition-colors mb-6 cursor-default"
                      title={workspacePath}
                    >
                      <AppIcon name="folder_open" size={14} className="text-primary/80 shrink-0" />
                      <span className="font-medium text-text-primary truncate max-w-[200px]">
                        {vaultName}
                      </span>
                    </div>
                  ) : (
                    <p className="text-body text-text-secondary mb-6">
                      在左侧工作台打开文件夹以启用知识库
                    </p>
                  )}

                  <div className="grid grid-cols-2 gap-2.5 w-full max-w-sm">
                    {suggestions.map((item) => (
                      <button
                        key={item.label}
                        type="button"
                        disabled={!workspacePath}
                        onClick={() => handleFillPrompt(item.prompt)}
                        className="group flex flex-col items-start p-3.5 rounded-xl border border-gray-200/80 dark:border-white/10 bg-white dark:bg-gray-800/80 hover:border-primary/40 hover:shadow-sm hover:-translate-y-0.5 transition-all text-left disabled:opacity-40 disabled:cursor-not-allowed"
                      >
                        <div className="flex items-center justify-between w-full mb-2.5">
                          <div className="w-7 h-7 rounded-lg bg-gray-50 dark:bg-gray-700/60 border border-gray-200/60 dark:border-white/10 flex items-center justify-center text-text-secondary group-hover:text-primary group-hover:bg-blue-50/80 dark:group-hover:bg-primary/15 transition-colors shadow-sm">
                            <AppIcon name={item.icon} size={16} />
                          </div>
                          <AppIcon name="arrow_outward" size={14} className="text-gray-300 dark:text-gray-600 opacity-0 group-hover:opacity-100 group-hover:text-primary transition-all -translate-x-0.5 group-hover:translate-x-0" />
                        </div>
                        <span className="text-body font-medium text-text-primary group-hover:text-primary transition-colors leading-snug">
                          {item.label}
                        </span>
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            )}

            <AgentComposer />
          </div>
        </div>

        <ConfirmModal
          isOpen={deleteTarget !== null}
          title="删除会话"
          message={deleteTarget ? `确定要删除会话「${deleteTarget.title}」吗？此操作无法撤销。` : ''}
          confirmText="确认删除"
          onConfirm={handleConfirmDeleteSession}
          onCancel={() => setDeleteTarget(null)}
        />

        <RenameModal
          isOpen={renameTarget !== null}
          title="重命名会话"
          placeholder="输入新的会话标题"
          initialValue={renameTarget?.title ?? ''}
          onConfirm={async (value) => {
            if (renameTarget) {
              await renameSession(renameTarget.id, value)
            }
            setRenameTarget(null)
          }}
          onCancel={() => setRenameTarget(null)}
        />

        <Modal open={rewindConfirmOpen} onClose={() => setRewindConfirmOpen(false)} size="sm" variant="glass">
          <div className="p-5">
            <div className="mb-4 flex items-center gap-3">
              <AppIcon name="undo" size={20} className="text-primary" />
              <h3 className="text-title font-semibold text-text-primary">撤回这条提问</h3>
            </div>

            <div className="mb-5 text-body leading-relaxed text-text-secondary">
              {rewindAnalysis && rewindAnalysis.fileCount > 0 ? (
                rewindAnalysis.alreadyUndone ? (
                  <p>本轮修改的文件已回滚到修改前状态。撤回后回到这条提问之前，原提问会重新填入输入框。</p>
                ) : (
                  <>
                    <p>这一轮 Agent 修改了 {rewindAnalysis.fileCount} 个文件。撤回后回到这条提问之前，原提问会重新填入输入框。</p>
                    {rewindAnalysis.revertible ? (
                      <p className="mt-2">可以同时把这些文件回滚到修改前的状态，或只撤回对话、保留文件现状。</p>
                    ) : (
                      <p className="mt-2">
                        {rewindAnalysis.blockedReason}，无法安全回滚文件；只能选择保留文件、仅撤回对话。
                      </p>
                    )}
                  </>
                )
              ) : (
                <p>将回到这条提问之前的状态，原提问会重新填入输入框供修改后重新发送。本轮没有文件修改。</p>
              )}
              {rewindError && (
                <p className="mt-3 rounded-lg bg-rose-50 px-3 py-2 text-caption text-rose-600 dark:bg-rose-500/10 dark:text-rose-400">
                  {rewindError}
                </p>
              )}
            </div>

            <div className="flex flex-col-reverse gap-2">
              <button
                type="button"
                onClick={() => setRewindConfirmOpen(false)}
                disabled={rewindBusy}
                className="h-9 rounded-lg border border-black/10 bg-black/[0.04] px-4 text-body font-medium text-text-secondary transition-colors hover:bg-black/[0.08] hover:text-text-primary disabled:opacity-50 dark:border-white/10 dark:bg-white/[0.06] dark:hover:bg-white/[0.12]"
              >
                取消
              </button>
              {rewindAnalysis && rewindAnalysis.fileCount > 0 && rewindAnalysis.revertible && !rewindAnalysis.alreadyUndone && (
                <button
                  type="button"
                  onClick={() => void handleRewindConfirm(false)}
                  disabled={rewindBusy}
                  className="h-9 rounded-lg border border-black/10 px-4 text-body font-medium text-text-primary transition-colors hover:bg-black/[0.06] disabled:opacity-50 dark:border-white/15 dark:hover:bg-white/10"
                >
                  保留文件，仅撤回对话
                </button>
              )}
              <button
                type="button"
                onClick={() =>
                  void handleRewindConfirm(
                    Boolean(rewindAnalysis && rewindAnalysis.fileCount > 0 && rewindAnalysis.revertible && !rewindAnalysis.alreadyUndone)
                  )
                }
                disabled={rewindBusy}
                className="h-9 rounded-lg bg-primary px-4 text-body font-medium text-white transition-colors hover:bg-primary/80 disabled:opacity-50"
              >
                {rewindBusy
                  ? '正在撤回…'
                  : rewindAnalysis && rewindAnalysis.fileCount > 0 && rewindAnalysis.revertible && !rewindAnalysis.alreadyUndone
                    ? '撤回文件修改和对话'
                    : '撤回对话'}
              </button>
            </div>
          </div>
        </Modal>

        <ConfirmModal
          isOpen={pendingForeignSession !== null}
          title="切换工作区"
          message={
            pendingForeignSession
              ? `该对话属于工作区「${baseName(pendingForeignSession.cwd)}」，切换并继续？`
              : ''
          }
          confirmText="切换并打开"
          type="info"
          onConfirm={handleConfirmForeignSession}
          onCancel={() => setPendingForeignSession(null)}
        />

        <WorkbenchImageLightbox
          open={lightboxIndex >= 0 && lightboxIndex < conversationLightboxItems.length}
          items={conversationLightboxItems}
          activeIndex={lightboxIndex}
          onSelectIndex={setLightboxIndex}
          onClose={() => setLightboxIndex(-1)}
          hideSendToAi
          onAttachToComposer={handleAttachLightboxImage}
        />
      </div>
  )
}

export default memo(AgentCard)
