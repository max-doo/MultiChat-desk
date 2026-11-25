import { memo, useState, useEffect, useRef, useMemo, useCallback } from 'react'
import { useAppStore, DEEP_RESEARCH_SUPPORTED_MODEL_IDS, IMAGE_GENERATION_SUPPORTED_MODEL_IDS } from '../../store/appStore'
import agentAvatar from '../../assets/logos/agent.png'
import { useWorkbenchStore } from '../../store/workbenchStore'
import { useAgentSessionStore } from '../../store/agentSessionStore'
import CustomDropdown, { type DropdownOption } from '../CustomDropdown'
import { AppIcon } from '../icons/AppIcon'
import ConfirmModal from '../ConfirmModal'
import RenameModal from '../RenameModal'
import { AgentPopover } from './agent/AgentPopover'
import { ToolGroup } from './agent/ToolGroup'
import { ApprovalCard } from './agent/ApprovalCard'
import { ThinkingBlock } from './agent/ThinkingBlock'
import { AgentComposer } from './agent/AgentComposer'
import ChangedFilesCard from './agent/ChangedFilesCard'
import { MarkdownRenderer } from './agent/MarkdownRenderer'
import { WorkPhaseBlock } from './agent/WorkPhaseBlock'
import { AttachmentChips, InlineMentionText, collectToolAttachmentPaths, extractInlineFilePaths } from './agent/AttachmentChips'
import type { AgentMessage, PiContentPart } from '../../types/agent'
import type { AgentTurnFileChanges } from '../../../../shared/types/agentRuntime'

interface AgentCardProps {
  isVisible?: boolean
  onModelChange?: (modelId: string) => void
  headerActions?: React.ReactNode
}

const EMPTY_PATHS: string[] = []

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
}

const AgentUserMessageItem = memo(function AgentUserMessageItem({
  message,
  cwd,
  canRewind,
  isCopied,
  onCopy,
  onRewindClick
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
    () => message.content.filter((c) => c.type === 'image'),
    [message.content]
  )

  return (
    <div className="group my-1">
      {userImages.length > 0 && (
        <div className="mb-1 flex flex-wrap justify-end gap-1.5">
          {userImages.map((img, i) => (
            <img
              key={i}
              src={img.data ?? ''}
              alt="粘贴的图片"
              className="max-h-32 max-w-[220px] rounded-lg border border-slate-200/70 dark:border-white/10 object-cover shadow-sm"
            />
          ))}
        </div>
      )}
      <div className="flex justify-end">
        <div className="max-w-[85%] bg-primary text-white text-body leading-relaxed px-4 py-2.5 rounded-2xl rounded-tr-sm shadow-sm break-words whitespace-pre-wrap select-text">
          <InlineMentionText text={userText} cwd={cwd} />
        </div>
      </div>
      <div className="mt-1 flex items-center justify-end gap-0.5 pr-1 opacity-0 transition-opacity group-hover:opacity-100">
        {canRewind && (
          <button
            type="button"
            onClick={onRewindClick}
            className="flex items-center gap-1 rounded-md px-1.5 py-0.5 text-caption text-text-secondary transition-colors hover:bg-gray-100 hover:text-text-primary dark:hover:bg-white/10"
            title="编辑并撤回此条消息"
          >
            <AppIcon name="edit" size={14} />
            <span>编辑</span>
          </button>
        )}
        <button
          type="button"
          onClick={() => onCopy(message.id, userText)}
          className="flex items-center gap-1 rounded-md px-1.5 py-0.5 text-caption text-text-secondary transition-colors hover:bg-gray-100 hover:text-text-primary dark:hover:bg-white/10"
          title="复制消息内容"
        >
          <AppIcon name="content_copy" size={14} />
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

  // 先找组内"最后一个非空 text part"作为 final answer 外显；
  // 其余 text 视为中间过渡，进折叠区。
  let lastTextPart: PiContentPart | null = null
  for (const m of groupMsgs) {
    for (const p of m.content) {
      if (p.type === 'text' && p.text?.trim()) lastTextPart = p
    }
  }
  const assistantText = lastTextPart?.text?.trim() ?? ''

  // 附件 Chips：主数据源是工具结果（image_gen 的 imageFiles 等），
  // 兜底是正文任意位置的绝对路径——仅在非流式运行态时计算，避免流式输出期间反复跑正则。
  const attachmentPaths = useMemo(() => {
    if (isGroupRunning) return EMPTY_PATHS
    const merged = [
      ...collectToolAttachmentPaths(groupMsgs),
      ...extractInlineFilePaths(assistantText)
    ]
    if (merged.length === 0) return EMPTY_PATHS
    const seen = new Set<string>()
    return merged.filter((p) => {
      const key = p.replace(/\\/g, '/').toLowerCase()
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
  }, [isGroupRunning, groupMsgs, assistantText])

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
        const running = block.parts.find(
          (p) => block.isRunning && p.result === undefined && !p.isError
        )
        if (running) activityPart = running
        workBlocks.push({
          key,
          node: <ToolGroup parts={block.parts} isRunning={block.isRunning} cwd={cwd ?? undefined} />
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
      {/* 发送后等待首个 part 的间隙：组内还没有任何 block */}
      {isGroupRunning && workBlocks.length === 0 && textBlocks.length === 0 && (
        <WorkPhaseBlock isRunning durationMs={undefined}>
          <ThinkingBlock thinking="" isRunning />
        </WorkPhaseBlock>
      )}

      {/* final answer 之前的所有工作 → "思考中"折叠区 */}
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

      {/* final answer */}
      {textBlocks.map((b) => (
        <div key={b.key}>{b.node}</div>
      ))}

      {attachmentPaths.length > 0 && !isGroupRunning && (
        <AttachmentChips paths={attachmentPaths} cwd={cwd ?? undefined} />
      )}

      {turnFileChanges && sessionId && cwd && (
        <ChangedFilesCard
          sessionId={sessionId}
          cwd={cwd}
          record={turnFileChanges}
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
            className="flex items-center gap-1 rounded-md px-1.5 py-0.5 text-caption text-text-secondary transition-colors hover:bg-gray-100 hover:text-text-primary dark:hover:bg-white/10"
            title="从当前位置创建分支会话"
          >
            <AppIcon name="git_branch" size={14} />
            <span>分支</span>
          </button>
          <AgentPopover
            open={isForkMenuOpen}
            onClose={onCloseForkMenu}
            align="left"
            placement="top"
            className="w-32 py-1"
          >
            <button
              type="button"
              disabled={isForking}
              onClick={() => {
                onCloseForkMenu()
                void onConfirmFork()
              }}
              className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-caption text-text-primary transition-colors hover:bg-gray-50 dark:hover:bg-white/5 disabled:opacity-50"
            >
              <AppIcon name="git_branch" size={14} className="text-primary" />
              <span>{isForking ? '创建中…' : '创建分支'}</span>
            </button>
          </AgentPopover>
          <button
            type="button"
            onClick={() => onCopy(finalMsg.id, assistantText)}
            className="flex items-center gap-1 rounded-md px-1.5 py-0.5 text-caption text-text-secondary transition-colors hover:bg-gray-100 hover:text-text-primary dark:hover:bg-white/10"
            title="复制本轮回复文本"
          >
            <AppIcon name="content_copy" size={14} />
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
  const setResumeAfterSwitchCwd = useAgentSessionStore((s) => s.setResumeAfterSwitchCwd)
  const consumeResumeAfterSwitchCwd = useAgentSessionStore((s) => s.consumeResumeAfterSwitchCwd)

  const [historyMenuOpen, setHistoryMenuOpen] = useState(false)
  const [foreignHistoryOpen, setForeignHistoryOpen] = useState(false)
  const [historySearchQuery, setHistorySearchQuery] = useState('')
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; title: string } | null>(null)
  const [renameTarget, setRenameTarget] = useState<{ id: string; title: string } | null>(null)
  /** 待确认的跨工作区会话：cwd 与当前工作区不一致时先弹窗再恢复。 */
  const [pendingForeignSession, setPendingForeignSession] = useState<{ id: string; cwd: string } | null>(null)
  const [rewindConfirmOpen, setRewindConfirmOpen] = useState(false)
  const [copiedId, setCopiedId] = useState<string | null>(null)
  const [forkMenuOpenFor, setForkMenuOpenFor] = useState<string | null>(null)
  const [isForking, setIsForking] = useState(false)
  const isForkingRef = useRef(false)
  const viewportRef = useRef<HTMLDivElement>(null)
  const autoFollowRef = useRef(true)
  const scrollRafRef = useRef<number | null>(null)

  const handleConfirmFork = useCallback(async (): Promise<void> => {
    if (isForkingRef.current) return
    isForkingRef.current = true
    setIsForking(true)
    try {
      await forkSession()
    } finally {
      isForkingRef.current = false
      setIsForking(false)
    }
  }, [forkSession])

  const handleToggleForkMenu = useCallback((msgId: string): void => {
    setForkMenuOpenFor((cur) => (cur === msgId ? null : msgId))
  }, [])

  const handleCloseForkMenu = useCallback((): void => {
    setForkMenuOpenFor(null)
  }, [])

  const handleRewindClick = useCallback((): void => {
    setRewindConfirmOpen(true)
  }, [])

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

  // Initialize IPC listeners on mount
  useEffect(() => {
    const cleanup = initListeners()
    return () => cleanup()
  }, [initListeners])

  const renderItems = useMemo(() => computeRenderItems(messages), [messages])
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
    }
  }, [])

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

  // Model picker options
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

  return (
    <div className="flex flex-col h-full bg-white dark:bg-gray-900 overflow-hidden">
      {/* Header */}
      <div className="relative p-3 border-b border-gray-200/60 dark:border-white/10 bg-white dark:bg-gray-900 flex justify-between items-center shrink-0">
        {/* Left: Model Picker Dropdown — matches WebviewCard CustomDropdown pattern */}
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

        {/* Center: current conversation title */}
        {currentSessionTitle && (
          <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 max-w-[42%] px-2 pointer-events-none">
            <span
              className="block truncate text-label text-text-secondary"
              title={currentSessionTitle}
            >
              {currentSessionTitle}
            </span>
          </div>
        )}

          {/* Right Header Actions — matches WebviewCard icon button pattern */}
          <div className="flex items-center gap-1">
            {/* New Session */}
            <button
              type="button"
              onClick={handleNewSession}
              className="w-7 h-7 rounded-full flex items-center justify-center text-text-secondary hover:text-text-primary hover:bg-black/5 dark:hover:bg-white/10 transition-all duration-200"
              title="新建会话"
              aria-label="新建会话"
            >
              <AppIcon name="annotation" size={20} />
            </button>

            {/* History Popover */}
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
                    {/* Header: 对话历史 + 强调的新对话按钮 */}
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

                    {/* Compact Search Bar (方案二：轻量搜索行) */}
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
                        const model = (item.model || '').toLowerCase()
                        const cwd = (item.cwd || '').toLowerCase()
                        return title.includes(query) || model.includes(query) || cwd.includes(query)
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

                      const renderSessionItem = (item: (typeof sessions)[number], isForeign: boolean) => {
                        const isCurrent = item.id === currentSessionId
                        const isItemRunning = item.isRunning ?? false
                        const foreignWorkspace = isForeign && item.cwd ? baseName(item.cwd) : null
                        const dateStr = item.updatedAt
                          ? new Date(item.updatedAt).toLocaleTimeString([], {
                              hour: '2-digit',
                              minute: '2-digit'
                            })
                          : ''

                        return (
                          <div
                            key={item.id}
                            onClick={() => handleSelectSession(item.id)}
                            className={`group px-3.5 py-2.5 hover:bg-gray-100/70 dark:hover:bg-slate-700/50 cursor-pointer flex items-start gap-2.5 transition-colors ${
                              isCurrent ? 'bg-blue-50/60 dark:bg-blue-900/20' : ''
                            }`}
                          >
                            <AppIcon
                              name="chat"
                              size={16}
                              className="shrink-0 mt-0.5 text-text-secondary dark:text-gray-400"
                            />
                            <div className="min-w-0 flex-1">
                              <div className="font-medium text-text-primary dark:text-gray-100 truncate text-body leading-snug">
                                {item.title || '新对话'}
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
                            </div>
                            {isItemRunning && (
                              <AppIcon
                                name="progress_activity"
                                size={14}
                                className="shrink-0 mt-0.5 text-primary animate-spin"
                              />
                            )}
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation()
                                setRenameTarget({ id: item.id, title: item.name || item.title || '' })
                              }}
                              className="shrink-0 mt-0.5 p-0.5 rounded text-gray-400 opacity-0 group-hover:opacity-100 hover:text-primary hover:bg-blue-50 dark:hover:bg-primary/20 transition-all"
                              title="重命名"
                            >
                              <AppIcon name="edit" size={15} />
                            </button>
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation()
                                setDeleteTarget({ id: item.id, title: item.title || '新对话' })
                              }}
                              className="shrink-0 mt-0.5 p-0.5 rounded text-gray-400 opacity-0 group-hover:opacity-100 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/30 transition-all"
                              title="删除会话"
                            >
                              <AppIcon name="delete" size={15} />
                            </button>
                          </div>
                        )
                      }

                      return (
                        <>
                          {/* Current Workspace Sessions (Scrollable) */}
                          <div className="max-h-[380px] overflow-y-auto py-1">
                            {currentWorkspaceSessions.length === 0 ? (
                              <div className="px-3 py-4 text-center text-text-secondary text-caption">
                                {query ? '无匹配对话' : '暂无历史对话'}
                              </div>
                            ) : (
                              currentWorkspaceSessions.map((item) => renderSessionItem(item, false))
                            )}
                          </div>

                          {/* Foreign Workspace Sessions (Pinned Footer, Collapsed by Default) */}
                          {foreignWorkspaceSessions.length > 0 && (
                            <div className="border-t border-gray-100 dark:border-gray-700/70 bg-gray-50/50 dark:bg-slate-800/80 shrink-0">
                              <button
                                type="button"
                                onClick={() => setForeignHistoryOpen(!foreignHistoryOpen)}
                                className="w-full px-3.5 py-2.5 flex items-center gap-2 text-text-secondary hover:text-text-primary hover:bg-gray-100/60 dark:hover:bg-slate-700/40 cursor-pointer select-none transition-colors"
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
                                  {foreignWorkspaceSessions.map((item) => renderSessionItem(item, true))}
                                </div>
                              )}
                            </div>
                          )}
                        </>
                      )
                    })()}
              </AgentPopover>
            </div>

            {/* Collapse Panel or Custom Header Actions */}
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

        {/* Main Thread Viewport */}
        <div className="flex-1 flex flex-col min-h-0 relative">
          {/* 失效工作区回看提示：cwd 已失效的会话恢复后，新消息会在当前工作区开新会话 */}
          {foreignReview && (
            <div className="px-4 pt-2 shrink-0">
              <div className="text-caption text-text-secondary bg-gray-50 border border-gray-200/60 rounded-lg px-3 py-1.5 dark:bg-white/5 dark:border-white/10">
                回看已失效工作区的对话 · 新消息将在当前工作区开始新对话
              </div>
            </div>
          )}
          <div
            ref={viewportRef}
            onScroll={handleViewportScroll}
            className="flex-1 overflow-y-auto px-4 py-3 space-y-3"
          >
            {/* Empty state */}
            {messages.length === 0 && (
              <div className="h-full flex flex-col items-center justify-center text-center p-6 my-auto select-none">
                {/* Hero Icon */}
                <div className="relative mb-4 flex items-center justify-center">
                  <img src={agentAvatar} alt="Agent" className="w-12 h-12 avatar-breathing select-none" />
                </div>

                {/* Title */}
                <h3 className="font-semibold text-text-primary text-title tracking-tight mb-2">
                  今天想梳理或写点什么？
                </h3>

                {/* Vault Badge or Subtitle */}
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

                {/* 2x2 Suggestion Grid */}
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
            )}

            {/* Messages Stream */}
            {renderItems.map((item) => {
              if (item.kind === 'user') {
                const canRewind = !isRunning && item.isLastUserMessage
                return (
                  <AgentUserMessageItem
                    key={item.msg.id}
                    message={item.msg}
                    cwd={currentCwd ?? undefined}
                    canRewind={canRewind}
                    isCopied={copiedId === item.msg.id}
                    onCopy={handleCopy}
                    onRewindClick={handleRewindClick}
                  />
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
                <AgentWorkGroupItem
                  key={item.firstMsgId}
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
              )
            })}

            {/* 用户消息已发出、assistant message_start 还没到的间隙 */}
            {isRunning &&
              messages.length > 0 &&
              messages[messages.length - 1].role === 'user' && (
                <div className="my-2">
                  <ThinkingBlock thinking="" isRunning />
                </div>
              )}

            {/* Pending Approvals */}
            {pendingApprovals.map((req) => (
              <ApprovalCard key={req.requestId} request={req} />
            ))}
          </div>

          {/* Composer */}
          <AgentComposer />
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

        <ConfirmModal
          isOpen={rewindConfirmOpen}
          title="撤回并编辑"
          message="将回到这条提问之前的状态，原提问会重新填入输入框供修改后重新发送。本轮 Agent 已修改的文件不会被还原（当前版本不支持代码回滚）。"
          confirmText="撤回并编辑"
          type="warning"
          onConfirm={async () => {
            setRewindConfirmOpen(false)
            await rewindLastUserMessage()
          }}
          onCancel={() => setRewindConfirmOpen(false)}
        />

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
      </div>
  )
}

export default memo(AgentCard)
