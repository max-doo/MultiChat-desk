import { useState, useEffect, useRef, useMemo, useCallback } from 'react'
import {
  Sparkles,
  PenTool,
  ListChecks,
  BookOpen,
  FolderOpen,
  GitBranch,
  Copy,
  Pencil,
  ArrowUpRight
} from 'lucide-react'
import { useAppStore } from '../../store/appStore'
import agentAvatar from '../../assets/logos/agent.png'
import { useWorkbenchStore } from '../../store/workbenchStore'
import { useAgentSessionStore } from '../../store/agentSessionStore'
import CustomDropdown, { type DropdownOption } from '../CustomDropdown'
import { AppIcon } from '../icons/AppIcon'
import ConfirmModal from '../ConfirmModal'
import { ToolGroup } from './agent/ToolGroup'
import { ApprovalCard } from './agent/ApprovalCard'
import { ThinkingBlock } from './agent/ThinkingBlock'
import { AgentComposer } from './agent/AgentComposer'
import ChangedFilesCard from './agent/ChangedFilesCard'
import { MarkdownRenderer } from './agent/MarkdownRenderer'
import { WorkPhaseBlock } from './agent/WorkPhaseBlock'
import type { AgentMessage, PiContentPart } from '../../types/agent'

interface AgentCardProps {
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

export default function AgentCard({
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
  const initListeners = useAgentSessionStore((s) => s.initListeners)
  const rewindLastUserMessage = useAgentSessionStore((s) => s.rewindLastUserMessage)
  const forkSession = useAgentSessionStore((s) => s.forkSession)
  const copyText = useAgentSessionStore((s) => s.copyText)
  const foreignReview = useAgentSessionStore((s) => s.foreignReview)
  const setForeignReview = useAgentSessionStore((s) => s.setForeignReview)

  const [historyMenuOpen, setHistoryMenuOpen] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; title: string } | null>(null)
  /** 待确认的跨工作区会话：cwd 与当前工作区不一致时先弹窗再恢复。 */
  const [pendingForeignSession, setPendingForeignSession] = useState<{ id: string; cwd: string } | null>(null)
  const [rewindConfirmOpen, setRewindConfirmOpen] = useState(false)
  const [copiedId, setCopiedId] = useState<string | null>(null)
  const [forkMenuOpenFor, setForkMenuOpenFor] = useState<string | null>(null)
  const [isForking, setIsForking] = useState(false)
  const viewportRef = useRef<HTMLDivElement>(null)

  const handleConfirmFork = useCallback(async (): Promise<void> => {
    if (isForking) return
    setIsForking(true)
    try {
      await forkSession()
    } finally {
      setIsForking(false)
    }
  }, [forkSession, isForking])

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

  // Auto-scroll to bottom on messages update
  useEffect(() => {
    if (viewportRef.current) {
      viewportRef.current.scrollTop = viewportRef.current.scrollHeight
    }
  }, [messages, pendingApprovals])

  // Sync workspacePath to AgentSession
  const prevWorkspaceRef = useRef<string | null>(workspacePath)
  /** 工作区切换是"为了 resume 某条该工作区会话"而触发时置位；effect1 据此跳过 draft 重置，避免清掉即将恢复的消息。 */
  const resumeAfterSwitchRef = useRef<string | null>(null)
  useEffect(() => {
    if (workspacePath && prevWorkspaceRef.current !== null && workspacePath !== prevWorkspaceRef.current) {
      if (resumeAfterSwitchRef.current && normalizePath(resumeAfterSwitchRef.current) === normalizePath(workspacePath)) {
        resumeAfterSwitchRef.current = null
        prevWorkspaceRef.current = workspacePath
        return
      }
      setForeignReview(false)
      void newSession(workspacePath)
    }
    prevWorkspaceRef.current = workspacePath
  }, [workspacePath, newSession])

  useEffect(() => {
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
    if (workspacePath && currentCwd && currentCwd !== workspacePath) {
      void newSession(workspacePath)
    }
  }, [currentCwd, workspacePath, newSession, foreignReview])

  // Model picker options
  const modelOptions = useMemo<DropdownOption<string>[]>(() => {
    const list: DropdownOption<string>[] = [
      {
        value: 'local-agent',
        label: 'Agent',
        description: '工作台知识与写作智能体'
      }
    ]
    for (const m of models) {
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

  const suggestions = useMemo(
    () => [
      {
        icon: PenTool,
        label: '方案大纲起草',
        prompt: '请帮我起草一份结构严谨、逻辑清晰的方案大纲，包含核心目标、实施要点与具体步骤：'
      },
      {
        icon: Sparkles,
        label: activeFileName ? '润色当前文档' : '文档深度润色',
        prompt: activeFilePath
          ? `请结合当前正在编辑的文档 @${activeFilePath}，帮我进行深度润色与结构优化，修正错别字与语病，提升专业度并保持行文连贯。`
          : '请帮我润色以下内容，修正语法与冗余表达，提升专业度并保持行文连贯：\n\n'
      },
      {
        icon: ListChecks,
        label: '提炼要点与待办',
        prompt: activeFilePath
          ? `请阅读当前文档 @${activeFilePath}，帮我提炼核心要点与关键结论，并整理出清晰的后续待办清单（Action Items）。`
          : '请帮我提炼长文材料的核心要点与关键结论，并整理出清晰的后续待办清单（Action Items）：\n\n'
      },
      {
        icon: BookOpen,
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
    resumeAfterSwitchRef.current = pending.cwd
    const result = await setWorkspaceFolder(pending.cwd)
    if (result === 'switched') {
      setForeignReview(false)
      void resumeSession(pending.id)
      return
    }
    resumeAfterSwitchRef.current = null
    // 用户取消（可视化编辑未保存选择留下）：不进回看，保持现状。
    if (result === 'cancelled') return
    // 目录失效（已删除/改名/盘符脱机）：setWorkspaceFolder 的 error 通道已提示；
    // 降级为只读回看——不切工作区直接恢复消息，标记豁免防 effect 清空。
    setForeignReview(true)
    void resumeSession(pending.id)
  }, [pendingForeignSession, resumeSession, setWorkspaceFolder])

  const handleConfirmDeleteSession = useCallback(async (): Promise<void> => {
    if (!deleteTarget) return
    await deleteSession(deleteTarget.id)
    setDeleteTarget(null)
  }, [deleteTarget, deleteSession])

  type GroupedBlock =
    | { type: 'reasoning'; reasoning: string; isRunning: boolean; part: PiContentPart }
    | { type: 'text'; text: string; part: PiContentPart }
    | { type: 'tool-group'; parts: PiContentPart[]; isRunning: boolean }

  const groupContentParts = (parts: PiContentPart[], isMsgRunning: boolean): GroupedBlock[] => {
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
  type RenderItem =
    | { kind: 'user'; msg: AgentMessage }
    | { kind: 'work'; msgs: AgentMessage[]; hasText: boolean }

  const buildRenderItems = (list: AgentMessage[]): RenderItem[] => {
    const items: RenderItem[] = []
    for (const m of list) {
      if (m.role === 'user') {
        items.push({ kind: 'user', msg: m })
        continue
      }
      const text = m.content
        .filter((c) => c.type === 'text')
        .map((c) => c.text ?? '')
        .join('')
        .trim()
      const last = items[items.length - 1]
      if (last && last.kind === 'work') {
        last.msgs.push(m)
        if (text) last.hasText = true
      } else {
        items.push({ kind: 'work', msgs: [m], hasText: Boolean(text) })
      }
    }
    return items
  }

  // 折叠区标题的动态动作描述：跟随当前进行中的 part
  // （正在读 xxx / 正在编辑 xxx / 正在运行 xxx / 正在搜 xxx / 正在思考…）。
  const describeActivity = (part: PiContentPart): string => {
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

  return (
    <div className="flex flex-col h-full bg-white dark:bg-gray-900 overflow-hidden">
      {/* Header */}
      <div className="p-3 border-b border-gray-200/60 dark:border-white/10 bg-white dark:bg-gray-900 flex justify-between items-center shrink-0">
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
                <h2 className="font-semibold text-text-primary">Agent</h2>
              </div>
            )}
            renderOption={(option, _isSelected, onSelect): JSX.Element => {
              const model = models.find((m) => m.id === option.value)
              const isLocalAgent = option.value === 'local-agent'
              return (
                <button
                  type="button"
                  onClick={onSelect}
                  className="w-full flex items-center justify-between gap-3 px-3 py-2 hover:bg-gray-100 transition-colors text-left"
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
                    <span className="text-text-primary text-sm truncate">{option.label}</span>
                  </div>
                </button>
              )
            }}
            options={modelOptions}
          />
        </div>

          {/* Right Header Actions — matches WebviewCard icon button pattern */}
          <div className="flex items-center gap-3">
            {/* New Session */}
            <button
              type="button"
              onClick={handleNewSession}
              className="flex items-center justify-center rounded-full text-text-secondary hover:text-primary transition-colors"
              title="新建会话"
            >
              <AppIcon name="annotation" size={20} />
            </button>

            {/* History Popover */}
            <div className="relative">
              <button
                type="button"
                onClick={() => setHistoryMenuOpen(!historyMenuOpen)}
                className="flex items-center justify-center rounded-full text-text-secondary hover:text-primary transition-colors"
                title="对话历史"
              >
                <AppIcon name="history" size={20} />
              </button>

              {historyMenuOpen && (
                <>
                  <div
                    className="fixed inset-0 z-popover"
                    onClick={() => setHistoryMenuOpen(false)}
                  />
                  <div className="absolute right-0 top-full mt-1.5 w-64 rounded-xl border border-gray-200 py-1 shadow-lg z-popover bg-white text-text-primary text-label">
                    <div className="px-3 py-1.5 flex items-center justify-between border-b border-gray-100">
                      <span className="text-caption font-semibold text-text-secondary uppercase tracking-wider">
                        对话历史
                      </span>
                      <button
                        type="button"
                        onClick={handleNewSession}
                        className="text-caption text-primary hover:opacity-80 font-medium"
                      >
                        + 新对话
                      </button>
                    </div>

                    <div className="max-h-64 overflow-y-auto py-1">
                      {sessions.length === 0 ? (
                        <div className="px-3 py-4 text-center text-text-secondary text-caption">
                          暂无历史对话
                        </div>
                      ) : (
                        sessions.map((item) => {
                          const isCurrent = item.id === currentSessionId
                          const isItemRunning = item.isRunning ?? false
                          const foreignWorkspace =
                            item.cwd && normalizePath(item.cwd) !== normalizePath(workspacePath)
                              ? baseName(item.cwd)
                              : null
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
                              className={`group px-3 py-2 hover:bg-blue-50/60 cursor-pointer flex items-start gap-2 transition-colors ${
                                isCurrent ? 'bg-blue-50/40' : ''
                              }`}
                            >
                              <span
                                className={`w-1.5 h-1.5 rounded-full mt-1.5 shrink-0 ${
                                  isCurrent ? 'bg-primary' : 'bg-transparent'
                                }`}
                              />
                              <div className="min-w-0 flex-1">
                                <div className="font-medium text-text-primary truncate">
                                  {item.title || '新对话'}
                                </div>
                                <div className="text-tiny font-mono text-text-secondary mt-0.5">
                                  {dateStr ? `${dateStr} · ` : ''}
                                  {item.model || 'SWE-2'}
                                </div>
                                {foreignWorkspace && (
                                  <div
                                    className="text-tiny text-text-secondary/70 mt-0.5 truncate flex items-center gap-1"
                                    title={item.cwd}
                                  >
                                    <AppIcon name="folder" size={11} />
                                    {foreignWorkspace}
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
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation()
                                  setDeleteTarget({ id: item.id, title: item.title || '新对话' })
                                }}
                                className="shrink-0 mt-0.5 p-0.5 rounded text-gray-400 opacity-0 group-hover:opacity-100 hover:text-red-500 hover:bg-red-50 transition-all"
                                title="删除会话"
                              >
                                <AppIcon name="delete" size={14} />
                              </button>
                            </div>
                          )
                        })
                      )}
                    </div>
                  </div>
                </>
              )}
            </div>

            {/* Collapse Panel or Custom Header Actions */}
            {headerActions || (
              <button
                type="button"
                onClick={closeRightPane}
                className="flex items-center justify-center rounded-full text-text-secondary hover:text-primary transition-colors"
                title="折叠 AI 侧边栏"
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
              <div className="text-tiny text-text-secondary bg-gray-50 border border-gray-200/60 rounded-lg px-3 py-1.5">
                回看已失效工作区的对话 · 新消息将在当前工作区开始新对话
              </div>
            </div>
          )}
          <div
            ref={viewportRef}
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
                <h3 className="font-semibold text-text-primary text-xl tracking-tight mb-2">
                  今天想梳理或写点什么？
                </h3>

                {/* Vault Badge or Subtitle */}
                {workspacePath ? (
                  <div
                    className="inline-flex items-center gap-1.5 text-caption text-text-secondary bg-gray-100 dark:bg-gray-800 hover:bg-gray-200/80 dark:hover:bg-gray-700 px-3 py-1 rounded-full border border-gray-200/60 dark:border-white/10 transition-colors mb-6 cursor-default"
                    title={workspacePath}
                  >
                    <FolderOpen className="w-3.5 h-3.5 text-primary/80 shrink-0" />
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
                      className="group flex flex-col items-start p-3.5 rounded-xl border border-gray-200/80 dark:border-white/10 bg-white dark:bg-gray-800/80 hover:border-primary/40 hover:shadow-xs hover:-translate-y-0.5 transition-all text-left disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                      <div className="flex items-center justify-between w-full mb-2.5">
                        <div className="w-7 h-7 rounded-lg bg-gray-50 dark:bg-gray-700/60 border border-gray-200/60 dark:border-white/10 flex items-center justify-center text-text-secondary group-hover:text-primary group-hover:bg-blue-50/80 transition-colors shadow-2xs">
                          <item.icon className="w-4 h-4" />
                        </div>
                        <ArrowUpRight className="w-3.5 h-3.5 text-gray-300 opacity-0 group-hover:opacity-100 group-hover:text-primary transition-all -translate-x-0.5 group-hover:translate-x-0" />
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
            {buildRenderItems(
              messages.filter((m) => m.role === 'user' || m.role === 'assistant')
            ).map((item) => {
              if (item.kind === 'user') {
                const message = item.msg
                const userText = message.content
                  .filter((c) => c.type === 'text')
                  .map((c) => c.text)
                  .join('')
                // Resolve the session-entry id bound to this bubble by text.
                // The main process already restricts rewind to the LAST user
                // message, so the edit button is only meaningful there.
                const lastUserIdx = messages.reduce((acc, m, i) => (m.role === 'user' ? i : acc), -1)
                const isLastUserMessage = messages.indexOf(message) === lastUserIdx
                const canRewind = !isRunning && isLastUserMessage
                return (
                  <div key={message.id} className="group my-1">
                    <div className="flex justify-end">
                      <div className="max-w-[85%] bg-primary text-white text-body leading-relaxed px-4 py-2.5 rounded-2xl rounded-tr-sm shadow-xs break-words whitespace-pre-wrap select-text">
                        {userText}
                      </div>
                    </div>
                    <div className="mt-1 flex items-center justify-end gap-0.5 pr-1 opacity-0 transition-opacity group-hover:opacity-100">
                      {canRewind && (
                        <button
                          type="button"
                          onClick={() => setRewindConfirmOpen(true)}
                          className="flex items-center gap-1 rounded-md px-1.5 py-0.5 text-caption text-text-secondary transition-colors hover:bg-gray-100 hover:text-text-primary"
                          title="编辑并撤回此条消息"
                        >
                          <Pencil className="h-3.5 w-3.5" />
                          <span>编辑</span>
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => handleCopy(message.id, userText)}
                        className="flex items-center gap-1 rounded-md px-1.5 py-0.5 text-caption text-text-secondary transition-colors hover:bg-gray-100 hover:text-text-primary"
                        title="复制消息内容"
                      >
                        <Copy className="h-3.5 w-3.5" />
                        <span>{copiedId === message.id ? '已复制' : '复制'}</span>
                      </button>
                    </div>
                  </div>
                )
              }

              // Work group：连续 assistant 消息的工作段（reasoning/tool-call
              // 折叠进"思考中"，最后一条的 final text 外显）。
              const groupMsgs = item.msgs
              const finalMsg = groupMsgs[groupMsgs.length - 1]
              const isGroupRunning = groupMsgs.some((m) => m.status === 'running')
              const finalMsgIndex = messages.indexOf(finalMsg)
              const nextMsg = messages[finalMsgIndex + 1]
              const isTurnFinal = !nextMsg || nextMsg.role === 'user'
              const isForkMenuTarget = forkMenuOpenFor === finalMsg.id

              // Turn number = count of user messages before this group
              let messageTurnIndex = 0
              for (let i = 0; i < finalMsgIndex; i++) {
                if (messages[i].role === 'user') messageTurnIndex++
              }
              const isLastTurnFinal =
                isTurnFinal &&
                !messages
                  .slice(finalMsgIndex + 1)
                  .some((m) => m.role === 'assistant')

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
              // 当前动作：最后一个仍在进行中的 part（reasoning 尾块 or 未返结果的 tool-call）
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
                      node: <ToolGroup parts={block.parts} isRunning={block.isRunning} cwd={currentCwd ?? undefined} />
                    })
                  } else if (block.type === 'text') {
                    if (block.part === lastTextPart) {
                      textBlocks.push({
                        key,
                        node: (
                          <div className="w-full">
                            <MarkdownRenderer content={block.text} />
                          </div>
                        )
                      })
                    } else {
                      // 中间过渡文字：斜体灰字，与 reasoning 同级
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

              // 组耗时：该组第一条消息的 timestamp 到 finalMsg 结束；
              // turnDurationMs（整轮耗时）只在最后一组存在，直接用。
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
                <div key={finalMsg.id} className="group space-y-2.5 my-2">
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

                  {!isGroupRunning && isTurnFinal && currentSessionId && currentCwd && (
                    <ChangedFilesCard
                      sessionId={currentSessionId}
                      cwd={currentCwd}
                      turnIndex={messageTurnIndex}
                      allowLegacy={isLastTurnFinal}
                    />
                  )}

                  {finalMsg.error && (
                    <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-red-600 text-body font-medium">
                      {finalMsg.error}
                    </div>
                  )}

                  {!isGroupRunning && isTurnFinal && (
                    <div className="relative flex items-center gap-0.5 -ml-1.5 opacity-0 transition-opacity group-hover:opacity-100">
                      <button
                        type="button"
                        onClick={() =>
                          setForkMenuOpenFor((cur) => (cur === finalMsg.id ? null : finalMsg.id))
                        }
                        className="flex items-center gap-1 rounded-md px-1.5 py-0.5 text-caption text-text-secondary transition-colors hover:bg-gray-100 hover:text-text-primary"
                        title="从当前位置创建分支会话"
                      >
                        <GitBranch className="h-3.5 w-3.5" />
                        <span>分支</span>
                      </button>
                      {isForkMenuTarget && (
                        <>
                          <div
                            className="fixed inset-0 z-popover"
                            onClick={() => setForkMenuOpenFor(null)}
                          />
                          <div className="absolute left-0 bottom-full mb-1.5 z-popover w-32 rounded-lg border border-gray-200 bg-white py-1 shadow-lg">
                            <button
                              type="button"
                              disabled={isForking}
                              onClick={() => {
                                setForkMenuOpenFor(null)
                                void handleConfirmFork()
                              }}
                              className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-caption text-text-primary transition-colors hover:bg-gray-50 disabled:opacity-50"
                            >
                              <GitBranch className="h-3.5 w-3.5 text-primary" />
                              <span>{isForking ? '创建中…' : '创建分支'}</span>
                            </button>
                          </div>
                        </>
                      )}
                      <button
                        type="button"
                        onClick={() => handleCopy(finalMsg.id, assistantText)}
                        className="flex items-center gap-1 rounded-md px-1.5 py-0.5 text-caption text-text-secondary transition-colors hover:bg-gray-100 hover:text-text-primary"
                        title="复制本轮回复文本"
                      >
                        <Copy className="h-3.5 w-3.5" />
                        <span>{copiedId === finalMsg.id ? '已复制' : '复制'}</span>
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
